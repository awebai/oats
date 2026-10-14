// One writer for a file the kernel writes through a private file beside it (awebai/oats#1076).
//
// The rule, decided on awebai/oats#963: a private file is removed when its write or its rename
// fails, and the error answered is that failure's. Five writers did not hold it: the automations
// snapshot (automations.mjs writeSnapshot), the scheduler's files (schedule.mjs writeJson), the
// triggers' state (triggers.mjs writeTriggerState), a claim's recorded step (claim.mjs
// recordInClaim) and an extra tree's record (worktree.mjs writeRecord, and createRecord, which puts
// it in place with an exclusive link). On a file system with no space each failed write left one
// more empty file. Each now writes through lib/write-through-private-file.mjs (createRecord keeps
// its own code, with its write inside the block whose `finally` removes the private file).
//
// What the tests below hold, for the writer alone and for each of the five through its caller:
//   - the write failing once the private file is made (ENOSPC), and the rename failing (EIO):
//     the error answered is that failure's, nothing is left at the private path, and the file
//     it would have written is as it was;
//   - each again with the removal of the private file refused (EACCES): the error answered is the
//     first, not the removal's, and the private file is the one thing left.
//
// A write fails here by a fault at one named `node:fs` call of the kernel's own, in one child
// process the test starts (test/helpers/fs-gate-preload.mjs, `throws`), as in
// test/stop-private-files.test.mjs. Each child imports the kernel's module itself, so a module
// that is missing fails its own tests and no other.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CLI, v2Deployment } from "./helpers/v2-deployment.mjs";
import { inheritedEnv } from "./helpers/host-fixture.mjs";
import { runFaulted, startGated } from "./helpers/fs-gate-preload.mjs";

const LIB = new URL("../lib/", import.meta.url).href;

/** One call of a writer, through its caller, in a process of its own: `node <this> <which> <dir>`
 *  prints what the call threw, or that it threw nothing. Each `which` writes one file under `dir`
 *  (CALLERS below says which). */
const CALL = `import { join } from "node:path";
const LIB = ${JSON.stringify(LIB)};
const [, , which, dir] = process.argv;
const calls = {
  async writer() {
    const { writeThroughPrivateFile } = await import(LIB + "write-through-private-file.mjs");
    const path = join(dir, "file.json");
    writeThroughPrivateFile(path, path + ".tmp-" + process.pid, '{"written":true}\\n', 0o600);
  },
  async snapshot() { const { writeSnapshot } = await import(LIB + "automations.mjs"); writeSnapshot(dir, { written: true }); },
  async schedules() { const { writeState } = await import(LIB + "schedule.mjs"); writeState(dir, { written: true, jobs: {} }); },
  async triggers() { const { removeTrigger } = await import(LIB + "triggers.mjs"); removeTrigger(dir, "kb-review"); },
  async claim() { const { recordInClaim } = await import(LIB + "claim.mjs"); recordInClaim(join(dir, "p.lock"), { pid: process.pid, nonce: "n1" }, { written: true }); },
};
let threw = null;
try { await calls[which](); } catch (e) { threw = { code: e.code, syscall: e.syscall, path: e.path, message: e.message }; }
console.log(JSON.stringify({ threw }));
`;

/** A trigger of this host's own, and its state: what removeTrigger rewrites. */
const TRIGGER = { id: "kb-review", enabled: true, kind: "trigger",
  on: { source: "github.pull_request", repo: "github.com/acme/knowledge", events: ["opened"], poll: "2m" },
  spawn: { soul: "reviewer", purpose: "review-pr-{number}", task: "Review {url}" } };
const TRIGGER_STATE = { version: 1, triggers: { "local/kb-review": { lastPollAt: "2026-10-01T00:00:00.000Z", prs: {}, fired: {}, pending: {} } } };

/** Each writer, by the `which` of CALL: the file it writes under `dir`, what is there before the
 *  call (null: nothing), and the private file's name once the call made it (its pid, and the claim's
 *  nonce, follow the final name). */
const CALLERS = [
  { which: "writer", what: "the writer alone (write-through-private-file.mjs)", file: (dir) => join(dir, "file.json"), before: null, privateName: /^file\.json\.tmp-\d+$/ },
  { which: "snapshot", what: "the automations snapshot (automations.mjs writeSnapshot)", file: (dir) => join(dir, ".agents", "automations", "snapshot.json"), before: null, privateName: /^snapshot\.json\.tmp-\d+$/ },
  { which: "schedules", what: "the scheduler's state (schedule.mjs writeJson, through writeState)", file: (dir) => join(dir, ".agents", "schedules", "state.json"), before: { jobs: {} }, privateName: /^state\.json\.tmp-\d+$/ },
  { which: "triggers", what: "the triggers' state (triggers.mjs writeTriggerState, through removeTrigger)", file: (dir) => join(dir, ".agents", "schedules", "triggers.json"), before: TRIGGER_STATE, privateName: /^triggers\.json\.tmp-\d+$/,
    setup: (dir) => writeFileSync(join(dir, "oats-schedules.json"), JSON.stringify({ version: 1, jobs: { "kb-review": TRIGGER } })) },
  { which: "claim", what: "a claim's recorded step (claim.mjs recordInClaim)", file: (dir) => join(dir, "p.lock"), before: { pid: 1, nonce: "n1" }, privateName: /^p\.lock\.tmp-\d+-n1$/ },
];

/** The two ways a private file fails, for the file whose path starts with `prefix`: its write once
 *  the file is made (no space for its bytes), and its rename. → [way, gate, code, syscall] */
const WAYS = [
  ["the write, once the file is made", (prefix) => ({ name: "fault", fn: "writeFileSync", prefix, when: "after", throws: "ENOSPC" }), "ENOSPC", "write"],
  ["the rename", (prefix) => ({ name: "fault", fn: "renameSync", prefix, throws: "EIO" }), "EIO", "rename"],
];
/** The removal of the private file whose path starts with `prefix`, refused: it is not made. */
const removalRefused = (prefix, fn = "rmSync") => ({ name: "removal", fn, prefix, throws: "EACCES" });

/** A base of this test's own, removed after it. */
function base(t) {
  const dir = mkdtempSync(join(tmpdir(), "oats-private-writer-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "home"));
  return dir;
}

for (const c of CALLERS) {
  test(`${c.what}: when its private file's write fails once the file is made, or its rename fails, it answers that failure's own error and leaves nothing at the private path; with the removal refused too, the error is still the first (#1076)`, async (t) => {
    const at = base(t);
    writeFileSync(join(at, "call.mjs"), CALL);
    let runs = 0;
    /** A fresh directory for one call, holding what the file held before: → { dir, file, call(gates) } */
    const prepared = () => {
      const dir = join(at, `run-${++runs}`), file = c.file(dir);
      mkdirSync(dirname(file), { recursive: true });
      if (c.before) writeFileSync(file, JSON.stringify(c.before));
      c.setup?.(dir);
      const call = (gates) => {
        const args = [join(at, "call.mjs"), c.which, dir], env = { ...inheritedEnv(), HOME: join(at, "home") };
        const r = gates.length ? runFaulted(args, { cwd: dir, env, gateDir: join(at, "gates", String(runs)), gates }) : spawnSync(process.execPath, args, { cwd: dir, env, encoding: "utf8" });
        assert.equal(r.status, 0, `the call ran to its end: ${r.stdout}${r.stderr}`);
        return { r, threw: JSON.parse(r.stdout.trim().split("\n").at(-1)).threw };
      };
      const held = () => (existsSync(file) ? readFileSync(file, "utf8") : null);
      const beside = () => readdirSync(dirname(file)).filter((name) => name !== "locks" && name !== "scope.lock" && name.startsWith(`${file.slice(dirname(file).length + 1)}.`)).sort();
      return { dir, file, call, held, beside, was: held() };
    };

    await t.test("nothing fails: the file holds the bytes, and nothing is beside it", () => {
      const p = prepared();
      const { threw } = p.call([]);
      assert.equal(threw, null, `the call threw: ${JSON.stringify(threw)}`);
      assert.equal(JSON.parse(p.held()).written === true || c.which === "triggers", true, `the bytes are at ${p.file}: ${p.held()}`);
      if (c.which === "triggers") assert.deepEqual(JSON.parse(p.held()).triggers, {}, "the trigger's state is removed");
      assert.deepEqual(p.beside(), [], "no private file is left");
      if (c.which === "writer" || c.which === "claim") assert.equal(statSync(p.file).mode & 0o077, 0, "the file is created private (0600, less the umask)");
    });

    for (const [way, fault, code, syscall] of WAYS) {
      await t.test(way, () => {
        const p = prepared();
        const { r, threw } = p.call([fault(`${p.file}.tmp-`)]);
        assert.deepEqual(r.fired, ["fault"], "the fault was met");
        assert.deepEqual([threw?.code, threw?.syscall, String(threw?.path).startsWith(`${p.file}.tmp-`)], [code, syscall, true], `the error is that call's own, at the private path: ${JSON.stringify(threw)}`);
        assert.deepEqual(p.beside(), [], `nothing is left at the private path`);
        assert.equal(p.held(), p.was, `${p.file} is as it was`);
      });
      await t.test(`${way}, and the removal of the private file is refused: the error answered is the first, not the removal's`, () => {
        const p = prepared();
        const { r, threw } = p.call([fault(`${p.file}.tmp-`), removalRefused(`${p.file}.tmp-`)]);
        assert.deepEqual(r.fired, ["fault", "removal"], "both faults were met");
        assert.deepEqual([threw?.code, threw?.syscall], [code, syscall], `the error is the first: ${JSON.stringify(threw)}`);
        const left = p.beside();
        assert.deepEqual([left.length, c.privateName.test(left[0])], [1, true], `the private file is there, since its removal was refused, and nothing else: ${left}`);
        assert.equal(p.held(), p.was, `${p.file} is as it was`);
      });
    }
  });
}


/** A deployment whose soul works in a worktree, and one spawned instance of it. Each `add` takes a
 *  purpose of its own, so that what one leaves is no other's to recover. */
async function treeHome(t) {
  const fx = v2Deployment({ t, souls: { dev: { soul: { work: "worktree" } } } });
  // An in-process spawn finds its harness on this process's PATH: the fixture's inert ones.
  const hostPath = process.env.PATH;
  process.env.PATH = fx.env.PATH;
  let home;
  try { ({ home } = await fx.spawn("dev", { name: "w1", work: "worktree" })); } finally { process.env.PATH = hostPath; }
  const trees = join(home, ".oats", "trees");
  let runs = 0;
  const args = (purpose) => [CLI, "worktree", "add", "--purpose", purpose, "--branch", `agents/w1-${purpose}`, "--base", "main", "--json"];
  const env = { ...fx.env, OATS_INSTANCE_HOME: home };
  return {
    fx, home, trees,
    record: (purpose) => join(trees, `${purpose}.json`),
    /** `oats worktree add --purpose <purpose>` run to its end with `gates`, every one of which throws. */
    add: (purpose, gates) => runFaulted(args(purpose), { cwd: home, env, gateDir: join(fx.base, "gates", String(++runs)), gates }),
    /** The same, driven: `gates` may hold one. */
    start: (purpose, gates, gateDir = join(fx.base, "gates", String(++runs))) => ({ gateDir, run: startGated(args(purpose), { cwd: home, env, gateDir, gates }) }),
    /** The record of `purpose` and what is beside it, by name, other than its claim. */
    beside: (purpose) => (existsSync(trees) ? readdirSync(trees).filter((name) => name.startsWith(`${purpose}.json`)).sort() : []),
    state: (purpose) => JSON.parse(readFileSync(join(trees, `${purpose}.json`), "utf8")).state,
  };
}
/** The error of `oats worktree add` answered for a failure of the system's: E_LIFECYCLE_FAILED, the
 *  system's code and call in its cause. → [code, cause.code, cause.syscall, the message names the
 *  private file] */
const systemAnswer = (r, privatePrefix) => {
  const { ok, error } = r.json();
  assert.equal(ok, false, `the add failed: ${r.stdout}${r.stderr}`);
  return [error.code, error.details?.cause?.code, error.details?.cause?.syscall, error.message.includes(privatePrefix)];
};

test("an extra tree's record, made by createRecord (an exclusive link, its own code): when its private file's write fails once the file is made, `oats worktree add` answers that failure, no record is made and nothing is left at the private path; with the removal refused too, the answer is still the first (#1076)", async (t) => {
  const w = await treeHome(t);
  const write = (purpose) => ({ name: "fault", fn: "writeFileSync", prefix: `${w.record(purpose)}.tmp-`, when: "after", throws: "ENOSPC" });
  await t.test("the write fails", () => {
    const r = w.add("p1", [write("p1")]);
    assert.deepEqual(r.fired, ["fault"], "the fault was met");
    assert.deepEqual(systemAnswer(r, `${w.record("p1")}.tmp-`), ["E_LIFECYCLE_FAILED", "ENOSPC", "write", true], `the answer is the write's own failure: ${r.stdout}`);
    assert.deepEqual(w.beside("p1"), [], "no record, and nothing at the private path");
    assert.equal(existsSync(join(w.home, ".work-p1")), false, "no tree was made");
  });
  await t.test("the write fails, and the removal of the private file is refused", () => {
    const r = w.add("p2", [write("p2"), removalRefused(`${w.record("p2")}.tmp-`, "unlinkSync")]);
    assert.deepEqual(r.fired, ["fault", "removal"], "both faults were met");
    assert.deepEqual(systemAnswer(r, `${w.record("p2")}.tmp-`), ["E_LIFECYCLE_FAILED", "ENOSPC", "write", true], `the answer is the write's own failure, not the removal's: ${r.stdout}`);
    const left = w.beside("p2");
    assert.deepEqual([left.length, /^p2\.json\.tmp-\d+$/.test(left[0])], [1, true], `the private file is there, since its removal was refused, and nothing else: ${left}`);
  });
});

test("an extra tree's record, rewritten by writeRecord: when its last rewrite (the record made ready) fails at its write once the file is made, or at its rename, `oats worktree add` answers that failure, the record is the one before it, and nothing is left at the private path; with the removal refused too, the answer is still the first (#1076)", async (t) => {
  // The last rewrite, because nothing writes the record after it: an earlier one that fails is
  // followed by the rollback's own rewrites of the same private name, which would hide a file left
  // behind. Its write is told by its bytes; its rename by being the first one after that write.
  const w = await treeHome(t);
  const READY = '"state": "ready"';
  const write = (purpose) => ({ name: "fault", fn: "writeFileSync", prefix: `${w.record(purpose)}.tmp-`, contains: READY, when: "after", throws: "ENOSPC" });
  /** The add of `purpose` held once the ready record's bytes are written, its rename then made to
   *  fail (EIO), with `extra` gates. → what runFaulted gives, as far as the checks below read it */
  const renameFails = async (purpose, extra = []) => {
    const at = join(w.fx.base, "gates", `rename-${purpose}`);
    const { run } = w.start(purpose, [
      { name: "ready", fn: "writeFileSync", prefix: `${w.record(purpose)}.tmp-`, contains: READY, when: "after" },
      { name: "fault", fn: "renameSync", prefix: `${w.record(purpose)}.tmp-`, armed: join(at, "ready.entered"), throws: "EIO" },
      ...extra,
    ], at);
    try {
      await run.waitGate("ready");
      run.release("ready");
      const { stdout, stderr, timedOut } = await run.done;
      assert.deepEqual(timedOut, [], "no gate was left held");
      return { stdout, stderr, fired: ["fault", ...extra.map((g) => g.name)].filter((name) => run.entered(name)), json: () => JSON.parse(stdout.trim().split("\n").pop()) };
    } finally { await run.finish(); }
  };
  const ways = [
    ["the write, once the file is made", (purpose, extra) => w.add(purpose, [write(purpose), ...extra]), "ENOSPC", "write"],
    ["the rename", renameFails, "EIO", "rename"],
  ];
  let n = 0;
  for (const [way, fail, code, syscall] of ways) {
    await t.test(way, async () => {
      const purpose = `q${++n}`;
      const r = await fail(purpose, []);
      assert.deepEqual(r.fired, ["fault"], "the fault was met");
      assert.deepEqual(systemAnswer(r, `${w.record(purpose)}.tmp-`), ["E_LIFECYCLE_FAILED", code, syscall, true], `the answer is that failure's own: ${r.stdout}`);
      assert.deepEqual(w.beside(purpose), [`${purpose}.json`], "the record, and nothing at the private path");
      assert.equal(w.state(purpose), "creating", "the record is the one before the failed rewrite");
    });
    await t.test(`${way}, and the removal of the private file is refused: the answer is the first, not the removal's`, async () => {
      const purpose = `q${++n}`;
      const r = await fail(purpose, [removalRefused(`${w.record(purpose)}.tmp-`)]);
      assert.deepEqual(r.fired, ["fault", "removal"], "both faults were met");
      assert.deepEqual(systemAnswer(r, `${w.record(purpose)}.tmp-`), ["E_LIFECYCLE_FAILED", code, syscall, true], `the answer is that failure's own: ${r.stdout}`);
      const left = w.beside(purpose);
      assert.deepEqual([left.length, left[0], new RegExp(`^${purpose}\\.json\\.tmp-\\d+$`).test(left[1])], [2, `${purpose}.json`, true], `the record, and the private file, since its removal was refused: ${left}`);
    });
  }
});

// ---- packages.mjs writeFileAtomic: its own code, and the first error answered ----

/** One call of packages.mjs writeFileAtomic in a process of its own: `node <this> <file> [mode]`
 *  prints what the call threw, or that it threw nothing. */
const ATOMIC_CALL = `import { writeFileAtomic } from ${JSON.stringify(`${LIB}packages.mjs`)};
const [, , file, mode] = process.argv;
let threw = null;
try { writeFileAtomic(file, "written\\n", mode ? { mode: Number.parseInt(mode, 8) } : {}); } catch (e) { threw = { code: e.code, syscall: e.syscall, path: e.path }; }
console.log(JSON.stringify({ threw }));
`;

test("packages.mjs writeFileAtomic keeps its own code (an exact mode, a stale private file removed first); when its write or its rename fails and the removal of its private file fails too, it throws the first error, not the removal's (#1076)", async (t) => {
  const at = base(t);
  writeFileSync(join(at, "call.mjs"), ATOMIC_CALL);
  let runs = 0;
  // With a mode the bytes are written through a descriptor, which no path gate matches: that write
  // is not faulted here. Its private file is removed twice, before it is made and in the finally:
  // the second removal is the one refused.
  const cases = [
    ["the write, once the file is made", undefined, (prefix) => ({ name: "fault", fn: "writeFileSync", prefix, when: "after", throws: "ENOSPC" }), "ENOSPC", "write", 1],
    ["the rename", undefined, (prefix) => ({ name: "fault", fn: "renameSync", prefix, throws: "EIO" }), "EIO", "rename", 1],
    ["the rename, with a mode", "600", (prefix) => ({ name: "fault", fn: "renameSync", prefix, throws: "EIO" }), "EIO", "rename", 2],
  ];
  for (const [way, mode, fault, code, syscall, nth] of cases) {
    await t.test(`${way}, and the removal of the private file is refused`, () => {
      const dir = join(at, `run-${++runs}`), file = join(dir, "f.txt"), prefix = join(dir, ".f.txt.oats-tmp-");
      mkdirSync(dir);
      writeFileSync(file, "before\n");
      const r = runFaulted([join(at, "call.mjs"), file, ...(mode ? [mode] : [])], { cwd: dir, env: { ...inheritedEnv(), HOME: join(at, "home") }, gateDir: join(at, "gates", String(runs)),
        gates: [fault(prefix), { ...removalRefused(prefix), nth }] });
      assert.equal(r.status, 0, `the call ran to its end: ${r.stdout}${r.stderr}`);
      const { threw } = JSON.parse(r.stdout.trim().split("\n").at(-1));
      assert.deepEqual(r.fired, ["fault", "removal"], "both faults were met");
      assert.deepEqual([threw?.code, threw?.syscall, String(threw?.path).startsWith(prefix)], [code, syscall, true], `the error is the first, not the removal's: ${JSON.stringify(threw)}`);
      assert.equal(readFileSync(file, "utf8"), "before\n", `${file} is as it was`);
    });
  }
});
