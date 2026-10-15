// A faster retire, with every proof kept (#1247). Three parts:
//
//   - the read-ahead (lib/read-ahead.mjs): while a digest reads a tree, worker threads read the
//     files it reads next, so a cold tree comes from the page cache. It changes no digest and no
//     error, and it is bounded: a few files read at once, a window of bytes and files ahead;
//   - one read of a worktree for both of its digests (worktreeDigests): the untracked and ignored
//     digest and the bytes, as generatedWorkDigest and worktreeBytes give them apart, or nothing,
//     and the retire then takes them apart;
//   - the pre-hook copy of a directory instance's work is verified by reading the copy back and
//     holding it against the inspected digest, without reading the source again: a change made
//     during the copy to a file already copied is preserved after the hooks, and one that reached
//     the copy, or a change to the copy, still refuses before any retire hook runs.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { exactTreeDigest, fingerprintTree, generatedWorkDigest, storedTreeDigest, worktreeBytes, worktreeDigests, worktreeGitPaths } from "../lib/core.mjs";
import { configureReadAhead, readAheadStats } from "../lib/read-ahead.mjs";
import { fixtureBase } from "./helpers/host-fixture.mjs";
import { startGated } from "./helpers/fs-gate-preload.mjs";
import { CLI, v2Deployment } from "./helpers/v2-deployment.mjs";

const bases = [];
test.after(() => {
  configureReadAhead();
  for (const dir of bases.splice(0)) {
    const unlock = (path) => { try { chmodSync(path, 0o700); for (const name of readdirSync(path)) unlock(join(path, name)); } catch { /* a file, or gone */ } };
    unlock(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});
const base = (prefix) => { const dir = fixtureBase(prefix); bases.push(dir); return dir; };
const write = (path, bytes, mode) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); if (mode !== undefined) chmodSync(path, mode); };
/** `name`, a Buffer, joined under `dir`. */
const at = (dir, name) => Buffer.concat([Buffer.from(`${dir}/`), name]);
/** A name that is not valid UTF-8, or null where the file system refuses one (APFS does). */
function oddName(dir) {
  const name = Buffer.from([0x63, 0x61, 0x66, 0xe9]);
  try { writeFileSync(at(dir, name), "not utf-8\n"); return name; }
  catch (e) { assert.notEqual(process.platform, "linux", `Linux keeps a name that is not valid UTF-8 (${e.code})`); return null; }
}

/** A tree with what the digests treat apart: names whose order by bytes is not their order by
 *  localeCompare ("B", "a", "ä"), a name that is not UTF-8, symbolic links (a dangling one, one to a
 *  directory), an empty file, a file larger than the read-ahead's window, permission bits, nested
 *  directories, a home's instance.json and receipts, and entries a digest is told to pass over. */
function tree(root) {
  write(join(root, "B"), "upper\n", 0o644);
  write(join(root, "a"), "lower\n", 0o600);
  write(join(root, "ä"), "umlaut\n", 0o755);
  write(join(root, "empty"), "");
  write(join(root, "large"), Buffer.alloc(3 * 1024 * 1024 + 17, 7));
  write(join(root, "nested", "deeper", "file"), "deep\n", 0o640);
  write(join(root, "nested", "B", "x"), "x\n");
  write(join(root, "nested", "a", "x"), "x\n");
  for (let i = 0; i < 40; i++) write(join(root, "many", `f${String(i).padStart(2, "0")}`), `file ${i}\n`.repeat(i * 50));
  symlinkSync("missing-target", join(root, "dangling"));
  symlinkSync("nested", join(root, "to-dir"));
  write(join(root, "instance.json"), JSON.stringify({ instance: "x", launched: true }) + "\n");
  write(join(root, ".oats-events.jsonl"), "{}\n");
  write(join(root, ".claude", "settings.json"), "{}\n");
  write(join(root, "work", "passed-over"), "work\n");
  write(join(root, "skip", "me", "file"), "excluded path\n");
  chmodSync(join(root, "nested", "deeper"), 0o750);
  return { odd: oddName(root) };
}

/** Every digest kind and option the retire takes, of `root`. */
function digests(root) {
  const options = [
    {},
    { excludeRoot: new Set(["work"]) },
    { excludePaths: [Buffer.from(join("skip", "me")), Buffer.from("dangling")] },
    { instanceHome: true, excludeRoot: new Set(["work"]) },
    { children: true },
  ];
  return options.flatMap((o) => [
    fingerprintTree(root, o),
    storedTreeDigest(root, 2, o),
    exactTreeDigest(root, o),
  ]);
}

/** The settings under which a read-ahead must work for its place in the digest: few readers, a small window. */
const SMALL = { readers: 3, windowKiB: 256, windowFiles: 8 };

test("the read-ahead changes no digest: the stored digests of version 1 and 2 and the exact digest, with every option the retire takes, are the ones the digest takes alone", () => {
  const root = join(base("oats-read-ahead-"), "tree");
  tree(root);
  configureReadAhead({ enabled: false });
  const alone = digests(root);
  for (const settings of [SMALL, {}]) {
    configureReadAhead(settings);
    for (let run = 0; run < 3; run++) assert.deepEqual(digests(root), alone, `read ahead with ${JSON.stringify(settings)}, run ${run + 1}`);
  }
  configureReadAhead();
});

test("the read-ahead is bounded: no more files read at once than its readers, never more than its window of bytes and files ahead of the digest, and it does read ahead", () => {
  const root = join(base("oats-read-ahead-bound-"), "tree");
  for (let i = 0; i < 300; i++) write(join(root, `d${i % 7}`, `f${String(i).padStart(3, "0")}`), Buffer.alloc(32 * 1024, i));
  configureReadAhead({ enabled: false });
  const alone = exactTreeDigest(root);
  configureReadAhead(SMALL);
  // The first read-ahead starts its threads; a digest of this tree can end before they are up. Each
  // run is held to the bounds, until one has read ahead.
  let ran = false;
  for (let run = 0; run < 50 && !ran; run++) {
    assert.equal(exactTreeDigest(root), alone);
    const stats = readAheadStats();
    assert.ok(stats.maxInFlight <= SMALL.readers, `at most ${SMALL.readers} files read at once: ${JSON.stringify(stats)}`);
    assert.ok(stats.maxAheadKiB <= SMALL.windowKiB, `at most ${SMALL.windowKiB} KiB ahead: ${JSON.stringify(stats)}`);
    assert.ok(stats.maxAheadFiles <= SMALL.windowFiles, `at most ${SMALL.windowFiles} files ahead: ${JSON.stringify(stats)}`);
    ran = stats.maxInFlight > 0;
  }
  assert.ok(ran, "the read-ahead read files ahead of the digest");
  configureReadAhead();
});

/** What a digest throws: its class, code and message, or "no error". */
const thrown = (fn) => { try { fn(); return "no error"; } catch (e) { return { class: e.constructor.name, code: e.code, message: e.message }; } };

test("an entry the digest cannot read, or of a kind it does not take, fails the digest with the same error, of the same class, read ahead or not", (t) => {
  const dir = base("oats-read-ahead-errors-");
  const unreadable = join(dir, "unreadable");
  write(join(unreadable, "a"), "a\n");
  write(join(unreadable, "b", "locked"), "locked\n", 0o000);
  write(join(unreadable, "c"), "c\n");
  const fifo = join(dir, "fifo");
  write(join(fifo, "a"), "a\n");
  execFileSync("mkfifo", [join(fifo, "pipe")]);
  const cases = [[fifo, "a FIFO"]];
  if (process.getuid?.() === 0) t.diagnostic("running as root, which reads a file without permission: the unreadable case is not taken");
  else cases.push([unreadable, "a file without read permission"]);
  for (const [root, what] of cases) {
    const all = () => [() => fingerprintTree(root), () => storedTreeDigest(root, 2), () => exactTreeDigest(root), () => worktreeBytes(root, [])].map(thrown);
    configureReadAhead({ enabled: false });
    const alone = all();
    for (const e of alone) assert.notEqual(e, "no error", `${what} fails the digest`);
    configureReadAhead(SMALL);
    assert.deepEqual(all(), alone, `${what}: the same errors read ahead`);
  }
  configureReadAhead();
});

/** A status listing (`git status --porcelain=v1 -z`) of `rows`, each [XY, path as text or bytes]. */
const status = (rows) => Buffer.concat(rows.flatMap(([xy, path]) => [Buffer.from(`${xy} `), Buffer.from(path), Buffer.from([0])]));

test("one read of a worktree gives the untracked and ignored digest and the bytes that generatedWorkDigest and worktreeBytes give apart: for a directory, a file, a link, a path that is not there, one inside another, one holding a repository, a disposable root and a name that is not UTF-8", () => {
  const work = join(base("oats-one-read-"), "work");
  write(join(work, ".git"), "gitdir: /elsewhere/worktrees/work\n");
  write(join(work, "tracked.txt"), "tracked\n");
  write(join(work, "node_modules", "pkg", "index.js"), "module.exports = 1;\n");
  write(join(work, "node_modules", "pkg", "bin"), "#!/bin/sh\n", 0o755);
  write(join(work, "node_modules", "B", "x"), "x\n");
  write(join(work, "node_modules", "a", "x"), "x\n");
  write(join(work, "notes.txt"), "untracked\n");
  write(join(work, "empty"), "");
  symlinkSync("missing", join(work, "link"));
  symlinkSync("node_modules", join(work, "dir-link"));
  write(join(work, "outer", "inner", "file"), "nested taps\n");
  write(join(work, "vendor", "repo", ".git"), "gitdir: /elsewhere/vendor\n");
  write(join(work, "vendor", "repo", "file"), "in a nested repository\n");
  write(join(work, "cache", "big"), "disposable\n");
  const odd = oddName(work);
  const rows = [
    ["!!", "node_modules/"], ["??", "notes.txt"], ["??", "empty"], ["??", "link"], ["!!", "dir-link/"],
    ["??", "gone.txt"], ["??", "outer/"], ["??", "outer/inner/file"], ["??", "vendor/"], ["??", "vendor/repo/.git"],
    ["!!", "cache/"], [" M", "tracked.txt"], ...(odd ? [["??", odd]] : []),
  ];
  for (const disposable of [[], ["cache"]]) {
    const statusBytes = status(rows);
    const both = worktreeDigests(work, statusBytes, disposable);
    assert.ok(both, "the one read gives both digests");
    const gitPaths = worktreeGitPaths(work);
    assert.deepEqual(both, { generated: generatedWorkDigest(work, statusBytes, disposable), bytes: worktreeBytes(work, gitPaths), gitPaths }, `disposable roots ${JSON.stringify(disposable)}`);
  }
});

test("one read of a worktree that meets an entry it cannot read gives nothing, so the retire takes the two digests apart, each failing as it fails alone", (t) => {
  if (process.getuid?.() === 0) { t.skip("running as root, which reads a file without permission"); return; }
  const work = join(base("oats-one-read-fails-"), "work");
  write(join(work, ".git"), "gitdir: /elsewhere/worktrees/work\n");
  write(join(work, "src", "locked"), "a tracked file the retire cannot read\n", 0o000);
  write(join(work, "notes.txt"), "untracked\n");
  const statusBytes = status([["??", "notes.txt"]]);
  assert.equal(worktreeDigests(work, statusBytes), undefined, "an unreadable tracked file: no digest from the one read");
  assert.equal(thrown(() => generatedWorkDigest(work, statusBytes)), "no error", "the untracked and ignored digest alone reads no tracked file");
  assert.match(thrown(() => worktreeBytes(work)).message, /EACCES/, "the bytes alone fail on that file");
  write(join(work, "build", "locked"), "an ignored file the retire cannot read\n", 0o000);
  const ignored = status([["??", "notes.txt"], ["!!", "build/"]]);
  assert.equal(worktreeDigests(work, ignored), undefined);
  assert.equal(thrown(() => generatedWorkDigest(work, ignored)).code, "E_WORK_INSPECTION_FAILED", "the untracked and ignored digest alone refuses as before");
});

// ---- The pre-hook copy of a directory instance's work ----

/** A retire hook that appends the home it ran for to `<agents root>/retire-hook.log`, outside every home. */
const HOOK = `import { appendFileSync } from "node:fs";
import { join } from "node:path";
appendFileSync(join(process.env.OATS_ROOT, "retire-hook.log"), process.env.OATS_INSTANCE_HOME + "\\n");
console.log(JSON.stringify({ meta: { retired: true } }));
`;

/** A directory instance with a retire hook, whose work/ holds files, and what a test reads of it. */
async function directoryInstance(t, name) {
  const fx = v2Deployment({ t,
    souls: { dev: { soul: { work: "directory", capabilities: { "test.retire": { from: "here" } } } } },
    capabilities: { "test.retire": { manifest: { hooks: { retire: "hook.mjs" } }, files: { "hook.mjs": HOOK } } },
  });
  const hostPath = process.env.PATH;
  process.env.PATH = fx.env.PATH;
  let home;
  try { ({ home } = await fx.spawn("dev", { name, work: "directory" })); } finally { process.env.PATH = hostPath; }
  const file = join(home, "work", "notes", "b.txt");
  write(join(home, "work", "notes", "a.txt"), "first\n");
  write(file, "as inspected\n");
  write(join(home, "work", "notes", "c.txt"), "last\n");
  const recoveryRoot = join(dirname(home), ".oats-retirement", "recovery");
  return {
    fx, home, file, recoveryRoot,
    hookRuns: () => { try { return readFileSync(join(fx.root, "retire-hook.log"), "utf8").split("\n").filter((line) => line === home).length; } catch (e) { if (e.code === "ENOENT") return 0; throw e; } },
    recoveries: () => { try { return readdirSync(recoveryRoot).sort(); } catch (e) { if (e.code === "ENOENT") return []; throw e; } },
    /** Retire it with one gate on the copy of `file`; `whileHeld` runs while the retire is held there. */
    retireHeldAtCopy: async (when, whileHeld) => {
      const run = startGated([CLI, "retire", name, "--json"], { cwd: fx.dep, env: fx.env, gateDir: join(fx.base, `gates-${when}`), gates: [{ name: "copy", fn: "copyFileSync", path: file, when }] });
      try {
        await run.waitGate("copy");
        whileHeld();
        run.release("copy");
        const r = await run.done;
        assert.deepEqual(r.timedOut, []);
        return { ...r, envelope: JSON.parse(r.stdout) };
      } finally { await run.finish(); }
    },
  };
}

test("a file of a directory instance's work changed during the pre-hook copy, after it was copied: the retire completes, and the change is preserved, verified, under after-hooks/", async (t) => {
  const w = await directoryInstance(t, "copied-then-changed");
  const r = await w.retireHeldAtCopy("after", () => writeFileSync(w.file, "changed after its copy\n"));
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.envelope.retired, "copied-then-changed", r.stdout);
  assert.equal(existsSync(w.home), false, "the home is removed");
  assert.equal(w.hookRuns(), 1, "the retire hook ran once");
  const [recovery] = w.recoveries();
  const dir = join(w.recoveryRoot, recovery);
  assert.equal(readFileSync(join(dir, "work", "notes", "b.txt"), "utf8"), "as inspected\n", "the pre-hook copy is the inspected state");
  assert.equal(readFileSync(join(dir, "after-hooks", "work", "notes", "b.txt"), "utf8"), "changed after its copy\n", "the change is under after-hooks/");
  const manifest = JSON.parse(readFileSync(join(dir, "recovery.json"), "utf8"));
  assert.equal(manifest.phase, "complete");
  assert.deepEqual(manifest.afterHooks, { home: false, work: true });
});

test("a file of a directory instance's work changed before the pre-hook copy read it: the copy is not the inspected state, and the retire refuses before any retire hook, keeping the home", async (t) => {
  const w = await directoryInstance(t, "changed-then-copied");
  const r = await w.retireHeldAtCopy("before", () => writeFileSync(w.file, "changed before its copy\n"));
  assert.notEqual(r.code, 0);
  assert.equal(r.envelope.ok, false, r.stdout);
  assert.equal(r.envelope.error.code, "E_WORK_PRESERVATION_FAILED", r.stdout);
  assert.match(r.envelope.error.message, /directory recovery verification disagreed with the inspected source/);
  assert.equal(w.hookRuns(), 0, "no retire hook ran");
  assert.equal(existsSync(w.home), true, "the home is kept");
  assert.deepEqual(w.recoveries(), [], "no recovery and no staging is left");
});

test("a pre-hook copy of a directory instance's work changed after it was written: its verification reads the copy back and refuses before any retire hook, keeping the home", async (t) => {
  const w = await directoryInstance(t, "copy-changed");
  const r = await w.retireHeldAtCopy("after", () => {
    const [staging] = w.recoveries();
    assert.match(staging, /^\./, "the copy is staged");
    writeFileSync(join(w.recoveryRoot, staging, "work", "notes", "b.txt"), "the copy changed\n");
  });
  assert.notEqual(r.code, 0);
  assert.equal(r.envelope.error.code, "E_WORK_PRESERVATION_FAILED", r.stdout);
  assert.match(r.envelope.error.message, /directory recovery verification disagreed with the inspected source/);
  assert.equal(w.hookRuns(), 0, "no retire hook ran");
  assert.equal(existsSync(w.home), true, "the home is kept");
  assert.deepEqual(w.recoveries(), [], "no recovery and no staging is left");
});
