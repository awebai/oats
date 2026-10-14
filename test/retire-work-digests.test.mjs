// The stored digests: two trees the legacy digest reads alike, the permission bits a copy carries, and the
// digests' version. One part of what was retire-work-safety.test.mjs (awebai/oats#1061); the fixtures it
// shares with the other parts are in helpers/retire-work-safety-fixture.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as nodeFs from "node:fs";
import { chmodSync, existsSync, lstatSync, lutimesSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fixtureBase, fixtureEnv } from "./helpers/host-fixture.mjs";
import { fingerprintTree, storedTreeDigest } from "../lib/core.mjs";
import {
  HOOK_BYTES, SCRATCH_BYTES, STATUS_WITH_SCRATCH, WRITES_SCRATCH, assertBothCopiedAgain, baselineOf, cli,
  commonDirOf, fixture, fixtureGit, gitDirOf, headOf, hookCapability, hookRan, porcelain, quietHook, readJson,
  recoveryRootOf, retireAfterQuietHook, spawn, stashListOf, statusRowsIn, temporaryDirectories, under, write,
} from "./helpers/retire-work-safety-fixture.mjs";

// ---- Two trees that the stored digest reads alike ----
// The legacy digest a spawn baseline was stored with before 0.49.0 (fingerprintTree) frames an entry as
// its path, NUL, its mode, NUL, its kind, NUL, and for a file its bytes and NUL, with no length. So a
// file whose bytes spell the entry that follows it reads like the two files. Such a baseline is still
// compared with it, so it cannot change. The proof that the retire hooks left a part as it was must not
// read the two alike.

const PAIR_A = "the first file\n", PAIR_B = "the second file\n";
/** Write the files `a` and `b` into `dir`, each with the mode 0644. */
function writePair(dir) {
  for (const [name, bytes] of [["a", PAIR_A], ["b", PAIR_B]]) {
    write(join(dir, name), bytes);
    chmodSync(join(dir, name), 0o644);
  }
}
/** What stands in the stored digest between the bytes of `a` and the bytes of `b`, in a directory at
 *  `under` (its path from the root the digest is taken of): NUL, b's path, NUL, its mode in decimal,
 *  NUL, "file", NUL. `dir` is a directory that holds the pair. */
const pairGlue = (dir, under) => `\0${join(...under, "b")}\0${lstatSync(join(dir, "b")).mode & 0o7777}\0file\0`;
const mergedPair = (glue) => `${PAIR_A}${glue}${PAIR_B}`;
/** Hook source: replace the pair in the directory `dirSource` (an expression of the hook) by the one
 *  file `a` that holds a's bytes, the glue and b's bytes. Needs readFileSync, unlinkSync,
 *  writeFileSync and join. */
const mergesPair = (dirSource, glue) => `const pair = ${dirSource};
writeFileSync(join(pair, 'a'), Buffer.concat([readFileSync(join(pair, 'a')), Buffer.from(${JSON.stringify(glue)}), readFileSync(join(pair, 'b'))]));
unlinkSync(join(pair, 'b'));`;
const PAIR_IMPORTS = "import { readFileSync, unlinkSync } from 'node:fs';";
/** The fixture premise of these tests, on two temporary trees: with the pair at `under`, the stored
 *  digest (fingerprintTree) of the two files and of the one merged file is the same. → the glue.
 *  `directory(prefix)` makes each tree (fixtureBase, for a test that takes the shared fixture base). */
function storedDigestReadsThePairAlike(under, { directory = (prefix) => mkdtempSync(join(tmpdir(), prefix)) } = {}) {
  const two = directory("oats-pair-two-"), one = directory("oats-pair-one-");
  temporaryDirectories.push(two, one);
  writePair(join(two, ...under));
  const glue = pairGlue(join(two, ...under), under);
  write(join(one, ...under, "a"), mergedPair(glue));
  chmodSync(join(one, ...under, "a"), 0o644);
  for (let depth = 1; depth <= under.length; depth++) chmodSync(join(one, ...under.slice(0, depth)), lstatSync(join(two, ...under.slice(0, depth))).mode & 0o7777);
  assert.deepEqual([readdirSync(join(two, ...under)).sort(), readdirSync(join(one, ...under))], [["a", "b"], ["a"]], "fixture premise: two files in one tree, one file in the other");
  assert.equal(fingerprintTree(one), fingerprintTree(two), "fixture premise: the stored digest reads the two layouts alike");
  return glue;
}
/** What a directory that held the pair holds after the hook: the one file, with the merged bytes. */
function assertMerged(dir, glue, what) {
  assert.deepEqual(readdirSync(dir), ["a"], `${what} holds the one file the hook left`);
  assert.equal(readFileSync(join(dir, "a"), "utf8"), mergedPair(glue), `${what} holds the bytes the hook wrote`);
}
/** What it held before: the two files. */
function assertPair(dir, what) {
  assert.deepEqual(readdirSync(dir).sort(), ["a", "b"], `${what} holds the two files`);
  assert.equal(readFileSync(join(dir, "a"), "utf8"), PAIR_A);
  assert.equal(readFileSync(join(dir, "b"), "utf8"), PAIR_B);
}

test("a retire hook that replaces two files of the work, under a directory Git reports as ignored whole, by one file that the stored digest reads like the two, and writes a home note: the work is copied again, and after-hooks/repo/ holds the hook's layout", () => {
  const under = ["human-ignored", "pair"];
  const glue = storedDigestReadsThePairAlike(under);
  const f = fixture({ capabilities: hookCapability(quietHook(`${PAIR_IMPORTS}\n${mergesPair("join(work, 'human-ignored', 'pair')", glue)}`)) });
  const spawned = spawn(f, "hook-pair-work");
  const work = join(spawned.home, "work");
  writePair(join(work, ...under));
  assert.equal(pairGlue(join(work, ...under), under), glue, "fixture premise: the files have the mode the premise was shown with");
  const statusBefore = porcelain(work);
  assert.deepEqual(statusRowsIn(statusBefore), ["!! human-ignored/"], "fixture premise: Git reports the directory whole, so the status text cannot change");

  const { recovery, afterRepo } = retireAfterQuietHook(f, spawned, statusBefore);
  assertPair(join(recovery.path, "repo", ...under), "the snapshot taken before the hooks");
  assert.equal(existsSync(join(afterRepo, ".git")), true, "the work is copied again under after-hooks/repo/: the hook changed its files, in a way the stored digest does not tell apart");
  assertMerged(join(afterRepo, ...under), glue, "the work copied after the hooks");
  assertBothCopiedAgain(recovery);
});

test("a retire hook that replaces two files of the home by one file that the stored digest reads like the two, and writes a file in the work: the home is copied again, and after-hooks/home/ holds the hook's layout", () => {
  const under = ["notes", "pair"];
  const glue = storedDigestReadsThePairAlike(under);
  // The hook writes no note of its own in the home: the only thing it changes there is the pair.
  const f = fixture({ capabilities: hookCapability(quietHook(`${PAIR_IMPORTS}\n${mergesPair("join(home, 'notes', 'pair')", glue)}\n${WRITES_SCRATCH}`, { home: false })) });
  const spawned = spawn(f, "hook-pair-home");
  const work = join(spawned.home, "work");
  writePair(join(spawned.home, ...under));
  assert.equal(pairGlue(join(spawned.home, ...under), under), glue, "fixture premise: the files have the mode the premise was shown with");
  assert.equal(porcelain(work), "", "fixture premise: the worktree is clean before the retire");

  // The helper is given the status the hook leaves: the one new row.
  const { recovery, afterRepo } = retireAfterQuietHook(f, spawned, STATUS_WITH_SCRATCH, { home: false });
  assert.equal(readFileSync(join(afterRepo, "scratch.txt"), "utf8"), SCRATCH_BYTES, "fixture premise: the work moved and is copied under after-hooks/repo/");
  assertPair(join(recovery.path, "home", ...under), "the snapshot taken before the hooks");
  assert.equal(existsSync(join(recovery.path, "after-hooks", "home")), true, "the home is copied again under after-hooks/home/: the hook changed its files, in a way the stored digest does not tell apart");
  assertMerged(join(recovery.path, "after-hooks", "home", ...under), glue, "the home copied after the hooks");
  assertBothCopiedAgain(recovery);
});

test("a retire hook that replaces two files of a directory instance's work/ by one file that the stored digest reads like the two, and writes a home note: the work is copied again, and after-hooks/work/ holds the hook's layout", () => {
  const under = ["pair"];
  const glue = storedDigestReadsThePairAlike(under);
  const retire = `import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const home = process.env.OATS_INSTANCE_HOME;
${mergesPair("join(home, 'work', 'pair')", glue)}
writeFileSync(join(home, 'hook-note.txt'), ${JSON.stringify(HOOK_BYTES)});
console.log(JSON.stringify({ meta: { retired: true } }));
`;
  const f = fixture({ work: "directory", capabilities: hookCapability(retire) });
  const spawned = spawn(f, "hook-pair-directory");
  writePair(join(spawned.home, "work", ...under));
  assert.equal(pairGlue(join(spawned.home, "work", ...under), under), glue, "fixture premise: the files have the mode the premise was shown with");

  const retired = cli(f, ["retire", basename(spawned.home), "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const recovery = JSON.parse(retired.stdout).workRecovery;
  assert.deepEqual(readdirSync(recoveryRootOf(spawned.home)), [basename(recovery.path)], "one recovery directory");
  assert.equal(readFileSync(join(recovery.path, "after-hooks", "home", "hook-note.txt"), "utf8"), HOOK_BYTES, "fixture premise: the retire hook ran, and its home note is copied under after-hooks/");
  assertPair(join(recovery.path, "work", ...under), "the snapshot taken before the hooks");
  assert.equal(existsSync(join(recovery.path, "after-hooks", "work")), true, "the work is copied again under after-hooks/work/: the hook changed its files, in a way the stored digest does not tell apart");
  assertMerged(join(recovery.path, "after-hooks", "work", ...under), glue, "the work copied after the hooks");
  assertBothCopiedAgain(recovery);
  assert.equal(existsSync(spawned.home), false, "the home is removed");
});

// The directory a digest is taken of has permission bits of its own, and no digest held them. A copy
// of a directory instance's work/ carries them (copyTreeSafe ends with a chmod of the copy); the copy
// of a worktree and of a home does not.

/** Whether the file system keeps the permission bits 0700 and 0755 on a directory. Where it does
 *  not, the test is skipped with the reason. On Linux that is a failure. */
function directoryModesKept(t) {
  const probe = mkdtempSync(join(tmpdir(), "oats-mode-"));
  temporaryDirectories.push(probe);
  const kept = (mode) => { chmodSync(probe, mode); return (lstatSync(probe).mode & 0o7777) === mode; };
  if (kept(0o700) && kept(0o755)) return true;
  const reason = "the file system does not keep the permission bits 0700 and 0755 on a directory";
  assert.notEqual(process.platform, "linux", `this test is not skipped on Linux: ${reason}`);
  t.skip(reason);
  return false;
}

test("a retire hook that changes the permission bits of a directory instance's work/ itself, and writes a home note: the work is copied again, and after-hooks/work has the hook's bits", (t) => {
  if (!directoryModesKept(t)) return;
  // The kernel before one recovery per retire kept the hook's bits: the home note moves its state
  // hash, its second recovery is whole, and the copy of work/ in it has the bits work/ has then.
  const KEPT = "bytes the hook leaves alone\n";
  const retire = `import { chmodSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
const home = process.env.OATS_INSTANCE_HOME;
const work = join(home, 'work');
const seen = { before: lstatSync(work).mode & 0o7777 };
chmodSync(work, 0o700);
seen.after = lstatSync(work).mode & 0o7777;
seen.entries = readdirSync(work);
seen.kept = readFileSync(join(work, 'kept.txt'), 'utf8');
writeFileSync(join(home, 'hook-note.txt'), ${JSON.stringify(HOOK_BYTES)});
writeFileSync(join(dirname(home), 'hook-saw-' + basename(home)), JSON.stringify(seen));
console.log(JSON.stringify({ meta: { retired: true } }));
`;
  const f = fixture({ work: "directory", capabilities: hookCapability(retire) });
  const spawned = spawn(f, "hook-root-mode");
  const work = join(spawned.home, "work");
  const bitsOf = (dir) => lstatSync(dir).mode & 0o7777;
  write(join(work, "kept.txt"), KEPT);
  chmodSync(work, 0o755);
  assert.equal(bitsOf(work), 0o755, "fixture premise: work/ has the bits 0755 before the retire");

  const retired = cli(f, ["retire", basename(spawned.home), "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const recovery = JSON.parse(retired.stdout).workRecovery;
  assert.deepEqual(readdirSync(recoveryRootOf(spawned.home)), [basename(recovery.path)], "one recovery directory");
  assert.deepEqual(readJson(join(dirname(spawned.home), `hook-saw-${basename(spawned.home)}`)), { before: 0o755, after: 0o700, entries: ["kept.txt"], kept: KEPT },
    "fixture premise: the hook found the bits 0755, left 0700, and left the files under work/ as they were");
  assert.equal(readFileSync(join(recovery.path, "after-hooks", "home", "hook-note.txt"), "utf8"), HOOK_BYTES, "fixture premise: the hook's home note is copied under after-hooks/");
  assert.equal(bitsOf(join(recovery.path, "work")), 0o755, "the snapshot taken before the hooks has work/ with the bits it had then");
  assert.equal(readFileSync(join(recovery.path, "work", "kept.txt"), "utf8"), KEPT);
  const after = join(recovery.path, "after-hooks", "work");
  assert.equal(existsSync(after), true, "the work is copied again under after-hooks/work/: the hook changed the permission bits of work/ itself");
  assert.equal(bitsOf(after), 0o700, "the work copied after the hooks has the bits the hook gave work/");
  assert.equal(readFileSync(join(after, "kept.txt"), "utf8"), KEPT);
  assertBothCopiedAgain(recovery);
  assert.equal(existsSync(spawned.home), false, "the home is removed");
});

// Every path the recovery copier copies gets the permission bits its source has: copyTreeSafe ends
// with a chmod of what it made, and copyFileSync gives the copy the source's mode. So those bits are part
// of what a work copy carries, and a hook that changes only them has changed it. Each test below writes
// a home note too, so the post-hook pass runs, and has the work in the snapshot taken before the hooks.

const bitsOf = (path) => lstatSync(path).mode & 0o7777;
/** quietHook body: chmod the entry at `...path` under the worktree's own Git directory (`dir: "git"`) or
 *  under the repository's common directory (`dir: "common"`) to `mode`, and leave its bits before and
 *  after in `seen`. */
const hookChmods = (dir, mode, ...path) => `import { chmodSync, lstatSync } from 'node:fs';
const target = join(git('rev-parse', '--path-format=absolute', ${JSON.stringify(dir === "git" ? "--absolute-git-dir" : "--git-common-dir")}).trim(), ${path.map((part) => JSON.stringify(part)).join(", ")});
seen.before = lstatSync(target).mode & 0o7777;
chmodSync(target, ${mode});
seen.after = lstatSync(target).mode & 0o7777;`;

test("a retire hook that changes only the permission bits of an in-progress rebase's directory: the work is copied again, and after-hooks/repo/ has the hook's bits", (t) => {
  if (!directoryModesKept(t)) return;
  const f = fixture({ capabilities: hookCapability(quietHook(hookChmods("git", "0o700", "rebase-merge"))) });
  const spawned = spawn(f, "hook-operation-mode");
  const work = join(spawned.home, "work");
  write(join(spawned.home, "notes.md"), "A rebase is unfinished.\n");
  const head = headOf(work);
  const operation = join(gitDirOf(work), "rebase-merge");
  write(join(operation, "head-name"), `${execFileSync("git", ["-C", work, "symbolic-ref", "HEAD"], { encoding: "utf8" }).trim()}\n`);
  write(join(operation, "onto"), `${head}\n`);
  write(join(operation, "orig-head"), `${head}\n`);
  chmodSync(operation, 0o755);
  const statusBefore = porcelain(work);
  assert.equal(statusBefore, "", "fixture premise: no status row before the retire");

  const { recovery, seen, afterRepo } = retireAfterQuietHook(f, spawned, statusBefore);
  assert.deepEqual({ before: seen.before, after: seen.after }, { before: 0o755, after: 0o700 }, "fixture premise: the hook found the bits 0755 and left 0700");
  assert.equal(bitsOf(join(recovery.path, "repo", ".git", "rebase-merge")), 0o755, "the snapshot taken before the hooks has the directory with the bits it had then");
  assert.equal(existsSync(join(afterRepo, ".git")), true, "the work is copied again under after-hooks/repo/: the hook changed the bits of the operation's directory, which a work copy carries");
  assert.equal(bitsOf(join(afterRepo, ".git", "rebase-merge")), 0o700, "the copy made after the hooks has the bits the hook gave the directory");
  assert.equal(readFileSync(join(afterRepo, ".git", "rebase-merge", "onto"), "utf8"), `${head}\n`);
  assertBothCopiedAgain(recovery);
});

test("a retire hook that changes only the permission bits of the stash's log: the work is copied again, and after-hooks/repo/ has the hook's bits", (t) => {
  if (!directoryModesKept(t)) return;
  const f = fixture({ capabilities: hookCapability(quietHook(hookChmods("common", "0o600", "logs", "refs", "stash"))) });
  const spawned = spawn(f, "hook-stash-log-mode");
  const work = join(spawned.home, "work");
  write(join(work, "tracked.txt"), "stashed before the retire\n");
  execFileSync("git", ["-C", work, "stash", "push", "-qm", "worktree stash"]);
  chmodSync(join(commonDirOf(work), "logs", "refs", "stash"), 0o644);
  // Something in the work to preserve before the hooks: a file under the ignored directory.
  write(join(work, "human-ignored", "kept.txt"), "ignored\n");
  const statusBefore = porcelain(work);
  assert.deepEqual(statusRowsIn(statusBefore), ["!! human-ignored/"], "fixture premise: the stash left the tracked file as it was");

  const { recovery, seen, afterRepo } = retireAfterQuietHook(f, spawned, statusBefore);
  assert.deepEqual({ before: seen.before, after: seen.after }, { before: 0o644, after: 0o600 }, "fixture premise: the hook found the bits 0644 and left 0600");
  assert.equal(bitsOf(join(recovery.path, "repo", ".git", "logs", "refs", "stash")), 0o644, "the snapshot taken before the hooks has the stash's log with the bits it had then");
  assert.equal(existsSync(join(afterRepo, ".git")), true, "the work is copied again under after-hooks/repo/: the hook changed the bits of the stash's log, which a work copy carries");
  assert.equal(bitsOf(join(afterRepo, ".git", "logs", "refs", "stash")), 0o600, "the copy made after the hooks has the bits the hook gave the stash's log");
  assert.match(stashListOf(afterRepo), /worktree stash/);
  assertBothCopiedAgain(recovery);
});

test("a retire hook that changes only the permission bits of the repository's info/attributes: the work is copied again, and after-hooks/repo/ has the hook's bits", (t) => {
  if (!directoryModesKept(t)) return;
  const f = fixture({ capabilities: hookCapability(quietHook(hookChmods("common", "0o600", "info", "attributes"))) });
  const spawned = spawn(f, "hook-attributes-mode");
  const work = join(spawned.home, "work");
  write(join(commonDirOf(work), "info", "attributes"), "*.bin binary\n");
  chmodSync(join(commonDirOf(work), "info", "attributes"), 0o644);
  write(join(work, "human-ignored", "kept.txt"), "ignored\n");
  const statusBefore = porcelain(work);
  assert.deepEqual(statusRowsIn(statusBefore), ["!! human-ignored/"], "fixture premise: the attributes change no status row");

  const { recovery, seen, afterRepo } = retireAfterQuietHook(f, spawned, statusBefore);
  assert.deepEqual({ before: seen.before, after: seen.after }, { before: 0o644, after: 0o600 }, "fixture premise: the hook found the bits 0644 and left 0600");
  assert.equal(bitsOf(join(recovery.path, "repo", ".git", "info", "attributes")), 0o644, "the snapshot taken before the hooks has info/attributes with the bits it had then");
  assert.equal(existsSync(join(afterRepo, ".git")), true, "the work is copied again under after-hooks/repo/: the hook changed the bits of info/attributes, which a work copy carries");
  assert.equal(bitsOf(join(afterRepo, ".git", "info", "attributes")), 0o600, "the copy made after the hooks has the bits the hook gave info/attributes");
  assertBothCopiedAgain(recovery);
});

test("a retire hook that changes only the permission bits of the worktree's index: the work is copied again", (t) => {
  if (!directoryModesKept(t)) return;
  // Git's status writes the index anew (a new file, with the bits Git gives a new file) whenever its
  // refresh changes the stat data the index holds, and it does for an entry whose file is not older than
  // the index: such an entry is racily clean, and it is checked and written again on every status. The
  // fixture makes every entry older than the index, so that no status, the test's, the retire's or the
  // hook's, writes the index; and the hook takes its status first and changes the bits last.
  const retire = `import { execFileSync } from 'node:child_process';
import { chmodSync, lstatSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
const home = process.env.OATS_INSTANCE_HOME;
const git = (...args) => execFileSync('git', ['-C', join(home, 'work'), ...args], { encoding: 'utf8' });
const seen = {};
writeFileSync(join(home, 'hook-note.txt'), ${JSON.stringify(HOOK_BYTES)});
seen.status = git('status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching', '--ignore-submodules=none');
const target = join(git('rev-parse', '--absolute-git-dir').trim(), 'index');
seen.before = lstatSync(target).mode & 0o7777;
seen.ino = lstatSync(target).ino;
chmodSync(target, 0o600);
seen.after = lstatSync(target).mode & 0o7777;
writeFileSync(join(dirname(home), 'hook-saw-' + basename(home)), JSON.stringify(seen));
console.log(JSON.stringify({ meta: { retired: true } }));
`;
  const f = fixture({ capabilities: hookCapability(retire) });
  const spawned = spawn(f, "hook-index-mode");
  const work = join(spawned.home, "work");
  write(join(work, "human-ignored", "kept.txt"), "ignored\n");
  const index = join(gitDirOf(work), "index");
  const older = new Date(Date.now() - 60_000);
  const entries = execFileSync("git", ["-C", work, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean).map((name) => join(work, name));
  for (const entry of entries) lutimesSync(entry, older, older); // a link's own times, which its entry holds
  porcelain(work); // the entries' stat data changed: Git writes the index anew, newer than every entry
  chmodSync(index, 0o644); // whatever bits Git gave it here, under whatever umask
  assert.deepEqual(entries.filter((entry) => lstatSync(entry).mtimeMs >= lstatSync(index).mtimeMs), [], "fixture premise: every entry of the index is older than the index");
  const indexFile = () => { const st = lstatSync(index); return { ino: st.ino, mode: st.mode & 0o7777 }; };
  const settled = indexFile();
  const statusBefore = porcelain(work);
  assert.deepEqual(indexFile(), settled, "fixture premise: Git's status leaves the index as it is, the same file with the same bits");
  assert.equal(settled.mode, 0o644);
  assert.deepEqual(statusRowsIn(statusBefore), ["!! human-ignored/"]);

  const { recovery, seen, afterRepo } = retireAfterQuietHook(f, spawned, statusBefore);
  assert.deepEqual({ ino: seen.ino, before: seen.before, after: seen.after }, { ino: settled.ino, before: 0o644, after: 0o600 }, "fixture premise: the hook found the index the test left, the same file with the bits 0644, and left 0600");
  assert.equal(existsSync(join(afterRepo, ".git")), true, "the work is copied again under after-hooks/repo/: the hook changed the bits of the index, which a work copy carries");
  // The copy's own bits are not asserted: the copy's verification runs Git's status in it, which may
  // write its index anew, with the bits Git gives a new file.
  assertBothCopiedAgain(recovery);
});

test("fingerprintTree's digest of a tree whose names are all valid UTF-8 is the one it has always been: a file, a directory with a file, a symbolic link and a name that is not ASCII", () => {
  // A spawn baseline written by an earlier kernel holds such digests, and a retire compares with them.
  // The expected value is the SHA-256 of this byte stream, written out by hand from the algorithm
  // (per entry, in the order of the names: its path, NUL, its permission bits in decimal, NUL, then
  // "file" NUL its bytes NUL, or "link" NUL its target NUL, or "dir" NUL followed by its entries):
  //   a.txt\0420\0file\0alpha\n\0  dir\0493\0dir\0  dir/inner.txt\0416\0file\0inner\n\0
  //   link\0511\0link\0a.txt\0  zé.txt\0384\0file\0zed\n\0
  const root = mkdtempSync(join(tmpdir(), "oats-fingerprint-"));
  temporaryDirectories.push(root);
  for (const [name, content, mode] of [["a.txt", "alpha\n", 0o644], [join("dir", "inner.txt"), "inner\n", 0o640], ["zé.txt", "zed\n", 0o600]]) {
    write(join(root, name), content);
    chmodSync(join(root, name), mode);
  }
  chmodSync(join(root, "dir"), 0o755);
  symlinkSync("a.txt", join(root, "link"));
  // A link has permission bits of its own only where the platform gives it some; there they follow the umask.
  if ((lstatSync(join(root, "link")).mode & 0o7777) !== 0o777) nodeFs.lchmodSync?.(join(root, "link"), 0o777);
  assert.equal(lstatSync(join(root, "link")).mode & 0o7777, 0o777, "fixture premise: the link's permission bits are 0777");
  assert.equal(fingerprintTree(root), "sha256:612e407ca91d0e9258ab0cc9d929db7bbc9e6b6d81179a74ce745dcd7638e71a");
});

// ---- The stored digests' version (#660, #661) ----
// A spawn baseline written by this kernel says `digestVersion: 2`: its stored digests order entries by the
// bytes of their names, frame every field whose length is not fixed with that length, and take the
// untracked and ignored paths from the status's bytes, each tested with lstat. A baseline without the
// field holds the legacy digests, and is compared with them as before.

test("the stored digest of version 2 is the one spelled out here: entries in the order of their names' bytes, each field whose length is not fixed framed with its length", () => {
  // A spawn baseline holds this digest, so it never changes. Per entry: its path's length, NUL, its path,
  // its permission bits in decimal, NUL, then "file" NUL and its bytes' length, NUL, its bytes, or "link"
  // NUL and its target the same way, or "dir" NUL followed by its entries; after "tree" NUL for the root.
  const root = fixtureBase("oats-fingerprint-v2-");
  temporaryDirectories.push(root);
  for (const [name, content, mode] of [["a.txt", "alpha\n", 0o644], [join("dir", "inner.txt"), "inner\n", 0o640], ["zé.txt", "zed\n", 0o600]]) {
    write(join(root, name), content);
    chmodSync(join(root, name), mode);
  }
  chmodSync(join(root, "dir"), 0o755);
  symlinkSync("a.txt", join(root, "link"));
  if ((lstatSync(join(root, "link")).mode & 0o7777) !== 0o777) nodeFs.lchmodSync?.(join(root, "link"), 0o777);
  assert.equal(lstatSync(join(root, "link")).mode & 0o7777, 0o777, "fixture premise: the link's permission bits are 0777");
  const stream = Buffer.concat([
    "tree\0",
    "5\0a.txt", "420\0", "file\0", "6\0alpha\n",
    "3\0dir", "493\0", "dir\0",
    `${join("dir", "inner.txt").length}\0${join("dir", "inner.txt")}`, "416\0", "file\0", "6\0inner\n",
    "4\0link", "511\0", "link\0", "5\0a.txt",
    "7\0zé.txt", "384\0", "file\0", "4\0zed\n",
  ].map((part) => Buffer.from(part)));
  assert.equal(storedTreeDigest(root, 2), `sha256:${createHash("sha256").update(stream).digest("hex")}`);
});

test("two trees the legacy stored digest reads alike (a file whose bytes spell the entry after it, and those two entries) have two stored digests of version 2", () => {
  const glue = storedDigestReadsThePairAlike(["pair"], { directory: fixtureBase });
  const [two, one] = temporaryDirectories.slice(-2);
  assert.ok(readFileSync(join(one, "pair", "a"), "utf8").includes(glue), "fixture premise: the one tree holds the merged file");
  assert.notEqual(storedTreeDigest(one, 2), storedTreeDigest(two, 2), "the length of a's bytes tells the two apart");
});

test("the stored digest of version 2 is the same under every locale, where the legacy digest's order follows the locale", (t) => {
  // Under Node, LC_ALL=C orders as en-US does, so locales whose collation differs from it name the case:
  // Swedish sorts ä after z, Danish sorts aa after ä, English sorts both before z.
  const base = fixtureBase("oats-fingerprint-locale-");
  temporaryDirectories.push(base);
  const root = join(base, "tree");
  for (const name of ["z.txt", "ä.txt", "aa.txt", "B.txt", "a.txt"]) write(join(root, name), `${name}\n`);
  const core = new URL("../lib/core.mjs", import.meta.url).href;
  const script = `const { fingerprintTree, storedTreeDigest } = await import(${JSON.stringify(core)});
console.log(JSON.stringify({ locale: new Intl.Collator().resolvedOptions().locale, legacy: fingerprintTree(process.argv[1]), v2: storedTreeDigest(process.argv[1], 2) }));`;
  const under = (locale) => {
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", script, root], { encoding: "utf8", env: fixtureEnv(base, { extra: { LC_ALL: locale, LANG: locale } }) });
    assert.equal(r.status, 0, r.stderr);
    return { asked: locale, ...JSON.parse(r.stdout) };
  };
  const runs = ["C", "en_US.UTF-8", "sv_SE.UTF-8", "da_DK.UTF-8"].map(under);
  if (new Set(runs.map((r) => r.legacy)).size < 2) {
    t.skip(`this Node orders the names alike under every locale tried (${runs.map((r) => `${r.asked} → ${r.locale}`).join(", ")}): its ICU has no collation data for them`);
    return;
  }
  assert.deepEqual(runs.map((r) => r.v2), runs.map(() => runs[0].v2), "one tree, one digest of version 2, whatever the locale");
});

/** A capability whose spawn hook leaves, in the worktree, before the spawn baseline is taken: an
 *  untracked file, an ignored directory with a file, an untracked link whose target does not exist, an
 *  untracked file whose name is not valid UTF-8 (where the file system takes such a name), and two
 *  files in an ignored directory. Its meta says whether the odd name was written. */
const SEEDED_ODD_NAME = Buffer.concat([Buffer.from("caf"), Buffer.from([0xe9]), Buffer.from(".txt")]);
const SEEDS_WORK = `import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const work = join(process.env.OATS_INSTANCE_HOME, 'work');
writeFileSync(join(work, 'scratch.txt'), 'scratch\\n');
mkdirSync(join(work, 'cache'), { recursive: true });
writeFileSync(join(work, 'cache', 'build.txt'), 'built\\n');
symlinkSync('missing-a', join(work, 'dangling'));
mkdirSync(join(work, 'human-ignored', 'pair'), { recursive: true });
for (const [name, bytes] of [['a', ${JSON.stringify(PAIR_A)}], ['b', ${JSON.stringify(PAIR_B)}]]) { writeFileSync(join(work, 'human-ignored', 'pair', name), bytes); chmodSync(join(work, 'human-ignored', 'pair', name), 0o644); }
let odd = 'written';
try { writeFileSync(Buffer.concat([Buffer.from(work + '/'), Buffer.from(${JSON.stringify([...SEEDED_ODD_NAME])})]), 'odd\\n'); }
catch (e) { odd = e.code || String(e); }
console.log(JSON.stringify({ meta: { odd } }));
`;
const seedingCapability = () => ({ "acme.seed": { manifest: { description: "leaves untracked and ignored bytes in the work at spawn", hooks: { spawn: "spawn.mjs" } }, files: { "spawn.mjs": SEEDS_WORK } } });
/** Spawn an instance whose work the spawn hook seeded → { spawned, work, odd } (`odd`: the odd-named
 *  file's path as bytes, or null with the reason where the file system refused the name). */
function spawnSeeded(f, purpose) {
  const spawned = spawn(f, purpose);
  const work = join(spawned.home, "work");
  assert.equal(readlinkSync(join(work, "dangling")), "missing-a", "fixture premise: the spawn hook left the dangling link");
  const odd = readdirSync(work, { encoding: "buffer" }).some((name) => name.equals(SEEDED_ODD_NAME)) ? Buffer.concat([Buffer.from(`${work}/`), SEEDED_ODD_NAME]) : null;
  return { spawned, work, odd, oddRefused: odd ? undefined : `the file system refused a name that is not valid UTF-8, as APFS does` };
}
const retireJson = (f, instance) => {
  const retired = cli(f, ["retire", instance, "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  return JSON.parse(retired.stdout);
};
/** The legacy generatedWorkFingerprint, spelled out from the kernel before 0.49.0: the status decoded as
 *  text, its `??` and `!!` paths sorted as text, each hashed as its path, NUL, then "missing" NUL where
 *  existsSync is false, else its legacy stored digest and NUL. */
function legacyGeneratedWorkFingerprint(work) {
  const status = fixtureGit(work, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching", "--ignore-submodules=none"]).toString("utf8");
  const paths = status.split("\0").filter((row) => row.startsWith("?? ") || row.startsWith("!! ")).map((row) => row.slice(3)).sort();
  const hash = createHash("sha256");
  for (const rel of paths) {
    hash.update(rel); hash.update("\0");
    if (!existsSync(join(work, rel))) { hash.update("missing\0"); continue; }
    hash.update(fingerprintTree(join(work, rel))); hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}
/** Rewrite a home's spawn baseline as a kernel before 0.49.0 wrote it: no `digestVersion`, and the
 *  legacy digests of the home and of the work as they are now. */
function rewriteAsLegacyBaseline(home) {
  const path = baselineOf(home);
  const { digestVersion, ...baseline } = readJson(path);
  assert.equal(digestVersion, 2, "fixture premise: the spawn wrote digest version 2");
  baseline.homeFingerprint = fingerprintTree(home, { excludeRoot: new Set(["work"]), instanceHome: true });
  baseline.generatedWorkFingerprint = legacyGeneratedWorkFingerprint(join(home, "work"));
  writeFileSync(path, JSON.stringify(baseline, null, 2) + "\n", { mode: 0o600 });
}

test("a new spawn's baseline says digestVersion 2 beside version 2, and with untracked and ignored bytes, a dangling link and a name that is not UTF-8 there since the spawn, a retire that changed nothing has no class and writes no recovery", () => {
  const f = fixture({ capabilities: seedingCapability() });
  const { spawned } = spawnSeeded(f, "seeded");
  const baseline = readJson(baselineOf(spawned.home));
  assert.equal(baseline.version, 2, "RETIRE_BASELINE_VERSION is not bumped");
  assert.equal(baseline.digestVersion, 2);
  const result = retireJson(f, "dev-seeded");
  assert.equal(result.workRecovery, undefined, "spawn and the class agree on every seeded path");
  assert.equal(existsSync(spawned.home), false);
});

test("an untracked symbolic link whose missing target changes adds the untracked and ignored class, and the recovery holds the new target", () => {
  const f = fixture({ capabilities: seedingCapability() });
  const { work } = spawnSeeded(f, "dangling");
  rmSync(join(work, "dangling"));
  symlinkSync("missing-b", join(work, "dangling"));
  const recovery = retireJson(f, "dev-dangling").workRecovery;
  assert.deepEqual(recovery?.classes, ["untracked or ignored worktree bytes"]);
  assert.equal(readlinkSync(join(recovery.path, "repo", "dangling")), "missing-b");
});

test("an untracked file whose name is not valid UTF-8 and whose bytes change adds the untracked and ignored class, and the recovery holds the new bytes", (t) => {
  const f = fixture({ capabilities: seedingCapability() });
  const { work, odd, oddRefused } = spawnSeeded(f, "odd-name");
  if (!odd) {
    assert.notEqual(process.platform, "linux", `this test is not skipped on Linux: ${oddRefused}`);
    t.skip(oddRefused);
    return;
  }
  assert.equal(existsSync(join(work, SEEDED_ODD_NAME.toString("utf8"))), false, "fixture premise: the name read as text names no file");
  writeFileSync(odd, "changed\n");
  const recovery = retireJson(f, "dev-odd-name").workRecovery;
  assert.deepEqual(recovery?.classes, ["untracked or ignored worktree bytes"]);
  assert.equal(readFileSync(Buffer.concat([Buffer.from(`${join(recovery.path, "repo")}/`), SEEDED_ODD_NAME]), "utf8"), "changed\n");
});

test("two ignored files replaced by one whose bytes spell the second entry, which the legacy digest reads alike, add the untracked and ignored class", () => {
  const f = fixture({ capabilities: seedingCapability() });
  const { work } = spawnSeeded(f, "pair");
  const pair = join(work, "human-ignored", "pair");
  // The legacy digest is taken of the status path, `human-ignored/`, so the glue names `pair/b`.
  const glue = pairGlue(pair, ["pair"]);
  const before = fingerprintTree(join(work, "human-ignored"));
  writeFileSync(join(pair, "a"), mergedPair(glue));
  rmSync(join(pair, "b"));
  assert.equal(fingerprintTree(join(work, "human-ignored")), before, "fixture premise: the legacy digest reads the two layouts alike");
  const recovery = retireJson(f, "dev-pair").workRecovery;
  assert.deepEqual(recovery?.classes, ["untracked or ignored worktree bytes"]);
  assertMerged(join(recovery.path, "repo", "human-ignored", "pair"), glue, "the recovery");
});

test("a baseline written before 0.49.0, without digestVersion, is compared with the legacy digests: with no change no class fires, and a changed untracked file still adds its class", () => {
  const f = fixture({ capabilities: seedingCapability() });
  const clean = spawnSeeded(f, "legacy-clean");
  rewriteAsLegacyBaseline(clean.spawned.home);
  assert.equal(Object.hasOwn(readJson(baselineOf(clean.spawned.home)), "digestVersion"), false, "fixture premise: a legacy baseline");
  assert.equal(retireJson(f, "dev-legacy-clean").workRecovery, undefined, "an unchanged instance with a legacy baseline retires with no class");

  const changed = spawnSeeded(f, "legacy-changed");
  rewriteAsLegacyBaseline(changed.spawned.home);
  writeFileSync(join(changed.work, "scratch.txt"), "changed\n");
  const recovery = retireJson(f, "dev-legacy-changed").workRecovery;
  assert.deepEqual(recovery?.classes, ["untracked or ignored worktree bytes"], "the legacy comparison still sees what it saw");
  assert.equal(readFileSync(join(recovery.path, "repo", "scratch.txt"), "utf8"), "changed\n");
});

test("a baseline whose digestVersion this kernel does not take matches no digest: the home and the untracked and ignored classes fire, and its authority still holds", () => {
  const f = fixture({ capabilities: seedingCapability() });
  const { spawned } = spawnSeeded(f, "future");
  const path = baselineOf(spawned.home);
  writeFileSync(path, JSON.stringify({ ...readJson(path), digestVersion: 3 }, null, 2) + "\n", { mode: 0o600 });
  const recovery = retireJson(f, "dev-future").workRecovery;
  assert.deepEqual(recovery?.classes, ["changed instance-home bytes", "untracked or ignored worktree bytes"], "not unknown provenance: the baseline's version still holds");
});

test("an ignored directory with an entry the retire cannot read refuses the retire at its first inspection, before any retire hook, with E_WORK_INSPECTION_FAILED naming the path and saying that nothing was stopped, run or removed", (t) => {
  // Git lists the ignored directory whole (`!! cache/`), so the digest reads it, and meets a directory
  // of mode 000 under it. A directory of mode 000 that is not under such a row Git does not list at
  // all: it prints a warning, and its paths leave the status, which the class sees.
  if (process.getuid?.() === 0) {
    t.skip("root reads a directory of mode 000, so the case cannot be built");
    return;
  }
  const f = fixture({ capabilities: { ...seedingCapability(), ...hookCapability(quietHook("")) } });
  const { spawned, work } = spawnSeeded(f, "unreadable");
  const locked = join(work, "cache", "locked");
  write(join(locked, "inside.txt"), "bytes\n");
  chmodSync(locked, 0o000);
  try {
    assert.match(fixtureGit(work, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching"]).toString("utf8"), /!! cache\/\0/, "fixture premise: Git lists the ignored directory whole");
    const retired = cli(f, ["retire", basename(spawned.home), "--json"]);
    assert.notEqual(retired.status, 0, `an ignored directory that cannot be read was retired: ${retired.stdout}`);
    const error = JSON.parse(retired.stdout).error;
    assert.equal(error.code, "E_WORK_INSPECTION_FAILED", retired.stdout);
    assert.match(error.message, new RegExp(`^could not inspect ${join(work, "cache").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: EACCES\\b.*\\. Nothing was stopped, run or removed\\.$`), "the message names the path and the reason, and says what the retire did not do");
    assert.equal(hookRan(spawned.home), false, "no retire hook ran");
    assert.equal(existsSync(recoveryRootOf(spawned.home)), false, "no recovery was written");
    assert.equal(existsSync(spawned.home), true, "the home is kept");
    assert.equal(readFileSync(join(work, "scratch.txt"), "utf8"), "scratch\n", "the work is kept");
  } finally {
    chmodSync(locked, 0o755);
  }
});
