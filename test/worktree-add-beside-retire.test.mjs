// `oats worktree add` reads the home's lifecycle claim (awebai/oats#866, #890).
//
// A retire holds the claim of the home it retires (<instances>/.oats-retirement/claims/<name>.lock)
// for as long as it runs: it stops the session, runs the retire hooks, deals with the home's extra
// trees and removes the home. An `oats worktree add` that started in that span made a tree in a
// home on its way out, after the retire had listed the trees it would move or remove. It read only
// the pending marker of a scheduled self-retire. It now reads the claim too (lib/worktree.mjs
// readTreeHome, lib/core.mjs refuseBesideRetire), and takes nothing: an add runs hooks for minutes
// and has its purpose's claim.
//
//   - a live retire holds the claim            → E_INSTANCE_RETIRING, "… no tree was made";
//   - a retire whose liveness cannot be read   → E_LIFECYCLE_BUSY, `holder: "unknown"`;
//   - the file does not read as a claim        → E_LIFECYCLE_BUSY, `holder: "unknown"`;
//   - the holder is gone, or it is a stop      → not refused: the tree is made;
//   - `oats worktree remove` does not read it  → as before.
//
// The live retire and the live stop are the real CLI, each started as a child and HELD right after
// the link that makes its claim file has returned (test/helpers/fs-gate-preload.mjs: a pause, and
// nothing else): it holds the claim and has done nothing else. No outcome rests on a sleep.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn as spawnChild, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { processStartToken } from "../lib/worktree-hooks.mjs";
import { startGated } from "./helpers/fs-gate-preload.mjs";
import { CLI, v2Deployment } from "./helpers/v2-deployment.mjs";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
/** How long a held command waits for its release before it goes on by itself (the pause's own
 *  bound, which a test then reports): well above what the commands run meanwhile take on a slow host. */
const HOLD_MS = 120000;
const AT = "2026-10-10T00:00:00.000Z";
/** A real pid whose process has exited and been reaped. */
const exitedPid = () => spawnSync(process.execPath, ["-e", ""]).pid;
/** Whether `stderr` holds a JavaScript stack trace. */
const hasStack = (stderr) => /^\s+at .*\(.*:\d+:\d+\)/m.test(stderr) || stderr.includes("node:internal");

/** A tree as `{ <relative path>: what it is }`: mode and bytes of a file, target of a link, mode of a
 *  directory. Two snapshots that are deep-equal are the same tree, byte for byte. */
function snapshot(root) {
  const seen = {};
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name), at = rel ? `${rel}/${name}` : name;
      const st = lstatSync(path);
      const mode = (st.mode & 0o7777).toString(8);
      if (st.isSymbolicLink()) seen[at] = `link ${readlinkSync(path)}`;
      else if (st.isDirectory()) { seen[`${at}/`] = `directory ${mode}`; walk(path, at); }
      else seen[at] = `file ${mode} ${readFileSync(path).toString("base64")}`;
    }
  };
  walk(root, "");
  return seen;
}

/** A deployment whose soul `dev` works in a worktree of the member clone (which has an `origin`),
 *  with one spawned instance `name` (no launch), and what the tests do in its home. */
async function instance(t, name) {
  const fx = v2Deployment({ t, souls: { dev: { soul: { work: "worktree" } } } });
  // The harness a spawn finds, and records as the home's launch executable, is the fixture's inert one.
  const hostPath = process.env.PATH;
  process.env.PATH = fx.env.PATH;
  let home;
  try { ({ home } = await fx.spawn("dev", { name })); } finally { process.env.PATH = hostPath; }
  // The home's lifecycle claim: one file per home, beside the homes (lib/core.mjs retireClaimPath).
  const lock = join(dirname(home), ".oats-retirement", "claims", `${name}.lock`);
  const git = (...args) => execFileSync("git", ["-C", fx.member, ...args], { encoding: "utf8", env: fx.env, stdio: ["ignore", "pipe", "pipe"] }).trim();
  let gateDirs = 0;
  const w = {
    fx, name, home, lock,
    branchOf: (purpose) => `agents/${name}-${purpose}`,
    treeOf: (purpose) => join(home, `.work-${purpose}`),
    /** `oats worktree <args>` from the home, as an agent runs it. */
    wt: (args) => fx.cli(["worktree", ...args], { cwd: home, env: { OATS_INSTANCE_HOME: home } }),
    add: (purpose, more = []) => w.wt(["add", "--purpose", purpose, "--branch", w.branchOf(purpose), "--base", "main", ...more]),
    branchExists: (purpose) => { try { git("rev-parse", "--verify", "--quiet", `refs/heads/${w.branchOf(purpose)}`); return true; } catch { return false; } },
    registered: (purpose) => git("worktree", "list", "--porcelain").split("\n").includes(`worktree ${w.treeOf(purpose)}`),
    /** A claim written by hand where the home's lifecycle claim belongs → its bytes. */
    writeClaim: (record) => {
      mkdirSync(dirname(lock), { recursive: true });
      writeFileSync(lock, typeof record === "string" ? record : JSON.stringify(record) + "\n");
      return readFileSync(lock, "utf8");
    },
    /** A live process that is no oats command, a child of this test: it stands in for a holder.
     *  It is ended before the fixture looks for what was left. → its pid. */
    bystander: () => {
      const child = spawnChild("sleep", ["600"], { stdio: "ignore" });
      fx.beforeCleanup(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
      return child.pid;
    },
    /** `oats <argv>` as a child process, held right after it has taken the home's lifecycle claim. */
    heldAfterClaim: (argv) => startGated([CLI, ...argv], { cwd: fx.dep, env: fx.env, gateDir: join(fx.base, `gates-${++gateDirs}`), gates: [{ name: "claimed", fn: "linkSync", arg: 1, path: lock, when: "after", waitMs: HOLD_MS }] }),
    /** The add of `purpose` made its tree: the answer, the tree in the clone's list, its branch and its record. */
    assertMade: (r, purpose, what) => {
      assert.equal(r.status, 0, `${what}: ${r.stdout}${r.stderr}`);
      const result = r.json().result;
      assert.deepEqual({ purpose: result.purpose, path: result.path, branch: result.branch, state: result.state, resumed: result.resumed },
        { purpose, path: w.treeOf(purpose), branch: w.branchOf(purpose), state: "ready", resumed: false }, what);
      assert.ok(existsSync(w.treeOf(purpose)) && w.registered(purpose), `${what}: the tree is there, a worktree of the clone`);
      assert.equal(w.branchExists(purpose), true, `${what}: its branch is made`);
      assert.equal(readJson(join(home, ".oats", "trees", `${purpose}.json`)).state, "ready", `${what}: its record is ready`);
    },
    /** The refused add of `purpose` made nothing: `before` is the home's snapshot before it. */
    assertNothingMade: (purpose, before, what) => {
      assert.equal(existsSync(w.treeOf(purpose)), false, `${what}: no tree was made`);
      assert.equal(w.registered(purpose), false, `${what}: the clone lists no such worktree`);
      assert.equal(w.branchExists(purpose), false, `${what}: no branch was made in the clone`);
      assert.equal(existsSync(join(home, ".oats", "trees", `${purpose}.json`)), false, `${what}: no record of the tree`);
      assert.equal(existsSync(join(home, ".oats", "trees", `${purpose}.lock`)), false, `${what}: no claim of the purpose is left`);
      assert.deepEqual(snapshot(home), before, `${what}: the home is byte for byte what it was`);
    },
  };
  return w;
}

/** The one error envelope of a refused command (a spawnSync result): exit 1, one line on stdout, no stack. */
function refusal(r, what) {
  const said = `${what}\n  exit status: ${r.status}\n  stdout: ${r.stdout}\n  stderr: ${r.stderr}`;
  assert.equal(r.status, 1, said);
  const lines = r.stdout.trim().split("\n");
  assert.equal(lines.length, 1, `exactly one envelope on stdout: ${said}`);
  const envelope = JSON.parse(lines[0]);
  assert.deepEqual({ schemaVersion: envelope.schemaVersion, ok: envelope.ok }, { schemaVersion: 1, ok: false }, said);
  assert.equal(hasStack(r.stderr), false, `a refusal prints no stack: ${said}`);
  return envelope.error;
}
/** The held command took the claim for `action`, and stands still → its claim's record. */
function assertHolds(run, lock, action) {
  assert.equal(run.child.exitCode, null, "fixture premise: the command that holds the claim is held, not finished");
  const claim = readJson(lock);
  assert.deepEqual({ action: claim.action, pid: claim.pid }, { action, pid: run.child.pid }, `fixture premise: ${lock} is the held command's claim, and names its verb`);
  return claim;
}
/** What a held command answered once it was released: it was let go by the test, and exited by itself. */
async function released(run) {
  run.release("claimed");
  const result = await run.done;
  assert.deepEqual(result.timedOut, [], "the gate was released in time: the held command did not go on by itself");
  assert.equal(result.signal, null, `the held command was not ended by a signal\n${result.stdout}\n${result.stderr}`);
  return result;
}

test("oats worktree add beside a live retire of its home is refused E_INSTANCE_RETIRING, as an add and as a preview, in JSON mode and in text mode: no tree, no branch, no record and no claim of the purpose; released, the retire completes", async (t) => {
  const w = await instance(t, "leaving");
  const { name, home, lock } = w;
  const run = w.heldAfterClaim(["retire", name, "--json"]);
  try {
    await run.waitGate("claimed");
    const claim = assertHolds(run, lock, "retire");
    const before = snapshot(home);
    const message = `${name} is being retired (pid ${run.child.pid}, since ${claim.at}); no tree was made`;
    for (const [what, more] of [["add", []], ["add --preview", ["--preview"]]]) {
      const error = refusal(w.add("p", [...more, "--json"]), `\`oats worktree ${what}\` beside a live retire`);
      assert.equal(error.code, "E_INSTANCE_RETIRING", `${what}: ${JSON.stringify(error)}`);
      assert.equal(error.message, message, what);
      // `action` is the holder's verb. No `holder`: that key is E_LIFECYCLE_BUSY's.
      assert.deepEqual(error.details, { instance: name, home, lock, pid: run.child.pid, since: claim.at, action: "retire" }, what);
      w.assertNothingMade("p", before, what);
      assertHolds(run, lock, "retire");
    }
    // Text mode: the same message as the one line of stderr, and nothing on stdout.
    const text = w.add("p");
    assert.deepEqual([text.status, text.stdout, text.stderr], [1, "", `oats: ${message}\n`]);
    w.assertNothingMade("p", before, "text mode");
    assert.equal(readFileSync(lock, "utf8"), JSON.stringify(claim) + "\n", "the add read the claim and wrote nothing to it");

    const done = await released(run);
    assert.equal(done.code, 0, done.stdout + done.stderr);
    assert.equal(JSON.parse(done.stdout).retired, name);
    assert.equal(existsSync(home), false, "the home is retired");
    assert.equal(existsSync(lock), false, "the retire released its claim");
  } finally { await run.finish(); }
});

test("oats worktree add beside a retire whose liveness cannot be read (its claim names a pid that runs and no start time) is refused E_LIFECYCLE_BUSY with holder unknown, naming the pid and the file to remove; no tree was made and the claim is left as it is", async (t) => {
  const w = await instance(t, "unsure");
  const { name, home, lock } = w;
  const pid = w.bystander();
  // A claim without `action` is a retire's: a kernel before this one wrote none, and only its retire took the claim.
  for (const [which, record] of [["a claim that names its verb", { action: "retire", pid, nonce: "a".repeat(32), at: AT }], ["a claim an older kernel wrote, with no verb", { pid, nonce: "a".repeat(32), at: AT }]]) {
    const bytes = w.writeClaim(record);
    const before = snapshot(home);
    for (const [what, more] of [["add", []], ["add --preview", ["--preview"]]]) {
      const where = `${which}, ${what}`;
      const error = refusal(w.add("p", [...more, "--json"]), `\`oats worktree ${what}\` beside ${which} whose holder cannot be read`);
      assert.equal(error.code, "E_LIFECYCLE_BUSY", `${where}: ${JSON.stringify(error)}`);
      assert.match(String(error.details.unknown), /names no start time/, where);
      assert.deepEqual(error.details, { instance: name, home, lock, pid, since: AT, action: "retire", unknown: error.details.unknown, holder: "unknown" }, where);
      assert.equal(error.message, `whether the retire of ${name} that holds ${lock} (pid ${pid}, recorded start none) still runs cannot be read (${error.details.unknown}); no tree was made — check that pid by hand, and if it is not an oats retire, remove ${lock}, then retry`, where);
      assert.doesNotMatch(error.message, /wait for it to finish/, `${where}: nobody is said to be running`);
      w.assertNothingMade("p", before, where);
      assert.equal(readFileSync(lock, "utf8"), bytes, `${where}: the claim file is as it was`);
    }
  }
});

test("oats worktree add beside a claim file that does not read as a claim is refused E_LIFECYCLE_BUSY with holder unknown, naming the file to inspect; no tree was made and the file is not removed", async (t) => {
  const w = await instance(t, "garbled");
  const { name, home, lock } = w;
  for (const [which, garbage] of [["bytes that are no JSON", "{not json"], ["the JSON null", "null\n"], ["an empty file", ""]]) {
    const bytes = w.writeClaim(garbage);
    const before = snapshot(home);
    for (const [what, more] of [["add", []], ["add --preview", ["--preview"]]]) {
      const where = `${which}, ${what}`;
      const error = refusal(w.add("p", [...more, "--json"]), `\`oats worktree ${what}\` beside a claim file that holds ${which}`);
      assert.deepEqual(error, { code: "E_LIFECYCLE_BUSY",
        message: `${lock} is not a readable claim; no tree was made — inspect it and remove it if no oats retire or oats instance stop holds it, then retry`,
        details: { instance: name, home, lock, holder: "unknown" } }, where);
      w.assertNothingMade("p", before, where);
      assert.equal(readFileSync(lock, "utf8"), bytes, `${where}: the file is byte for byte what it was`);
    }
  }
});

test("oats worktree add is not refused by a claim whose holder is gone, by a claim a stop holds (a record of a live stop, a stop whose liveness cannot be read, and a stop apply in flight), or with no claim: each add makes its tree and writes nothing to the claim", async (t) => {
  const w = await instance(t, "staying");
  const { name, lock } = w;
  const pid = w.bystander();
  const start = processStartToken(pid);
  assert.equal(typeof start, "string", "fixture premise: the start of the stand-in holder can be read");

  // The control: no claim at all.
  assert.equal(existsSync(lock), false, "fixture premise: nobody holds the home's claim");
  w.assertMade(w.add("none", ["--json"]), "none", "no claim");

  // Claims written by hand, each left exactly as it was: the add reads the claim and takes nothing.
  for (const [purpose, what, record] of [
    ["gone", "a retire's claim whose holder is gone", { action: "retire", pid: exitedPid(), processStart: "proc:1", nonce: "a".repeat(32), at: AT }],
    ["gone-old", "an older kernel's claim (no verb) whose holder is gone", { pid: exitedPid(), processStart: "proc:1", nonce: "a".repeat(32), at: AT }],
    ["stop", "a live stop's claim", { action: "stop", pid, processStart: start, nonce: "b".repeat(32), at: AT }],
    ["stop-unsure", "a stop's claim whose holder's liveness cannot be read", { action: "stop", pid, nonce: "b".repeat(32), at: AT }],
  ]) {
    const bytes = w.writeClaim(record);
    w.assertMade(w.add(purpose, ["--json"]), purpose, what);
    assert.equal(readFileSync(lock, "utf8"), bytes, `${what}: the claim file is as it was`);
    assert.deepEqual(readdirSync(dirname(lock)), [`${name}.lock`], `${what}: no takeover file beside it`);
  }
  // The control of the control: the same live process as a RETIRE's holder is what refuses.
  w.writeClaim({ action: "retire", pid, processStart: start, nonce: "c".repeat(32), at: AT });
  const refused = refusal(w.add("never", ["--json"]), "`oats worktree add` beside the same holder recorded as a retire");
  assert.equal(refused.code, "E_INSTANCE_RETIRING", JSON.stringify(refused));
  assert.equal(existsSync(w.treeOf("never")), false, "no tree was made");
  rmSync(lock);

  // The real thing: a stop apply of this home, held right after it took the claim.
  const plan = w.fx.cli(["instance", "stop", name, "--plan", "--json"]);
  assert.equal(plan.status, 0, plan.stdout + plan.stderr);
  const run = w.heldAfterClaim(["instance", "stop", name, "--apply", "--plan-revision", plan.json().result.planRevision, "--idempotency-key", "k1", "--json"]);
  try {
    await run.waitGate("claimed");
    const claim = assertHolds(run, lock, "stop");
    w.assertMade(w.add("beside-stop", ["--json"]), "beside-stop", "a stop apply in flight");
    assert.equal(readFileSync(lock, "utf8"), JSON.stringify(claim) + "\n", "the stop's claim is as it was");
    const done = await released(run);
    assert.equal(done.code, 0, done.stdout + done.stderr);
    assert.equal(JSON.parse(done.stdout).result.ok, true, done.stdout);
    assert.equal(existsSync(lock), false, "the stop released its claim");
  } finally { await run.finish(); }
});

test("oats worktree remove beside a live retire of its home is unchanged: it does not read the lifecycle claim, removes a recorded tree and answers a purpose without a tree as before; released, the retire completes", async (t) => {
  const w = await instance(t, "pruning");
  const { name, home, lock } = w;
  w.assertMade(w.add("p", ["--json"]), "p", "fixture premise: a tree added while nobody retires the home");
  // Held before any effect: the retire has its claim and has not read the home's trees yet.
  const run = w.heldAfterClaim(["retire", name, "--json"]);
  try {
    await run.waitGate("claimed");
    assertHolds(run, lock, "retire");
    // What an add answers at this moment, for contrast.
    assert.equal(refusal(w.add("q", ["--json"]), "`oats worktree add` beside the live retire").code, "E_INSTANCE_RETIRING");

    const removed = w.wt(["remove", "--purpose", "p", "--json"]);
    assert.equal(removed.status, 0, removed.stdout + removed.stderr);
    assert.deepEqual(removed.json().result, { purpose: "p", path: w.treeOf("p"), removed: true, rolledBack: false, branch: w.branchOf("p"), branchKept: true });
    assert.equal(existsSync(w.treeOf("p")), false, "the tree is removed");
    assert.equal(w.registered("p"), false, "and is no longer a worktree of the clone");
    assert.equal(w.branchExists("p"), true, "its branch is kept");
    assert.equal(existsSync(join(home, ".oats", "trees", "p.json")), false, "its record is dropped");
    // A purpose without a tree: the answer it always had.
    const none = refusal(w.wt(["remove", "--purpose", "q", "--json"]), "`oats worktree remove` of a purpose without a tree, beside the live retire");
    assert.equal(none.code, "E_BAD_ARGS", JSON.stringify(none));
    assert.ok(none.message.startsWith(`no tree of purpose q was made by oats worktree add in this home (no ${join(home, ".oats", "trees", "q.json")})`), none.message);
    assertHolds(run, lock, "retire");

    const done = await released(run);
    assert.equal(done.code, 0, done.stdout + done.stderr);
    const retired = JSON.parse(done.stdout);
    assert.equal(retired.retired, name);
    assert.equal(retired.extraWorktrees, undefined, "the retire met no extra tree: the one there was is gone");
    assert.equal(existsSync(home), false, "the home is retired");
  } finally { await run.finish(); }
});
