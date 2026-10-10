// A retire and its recorded children, now that a stop takes the home's claim (awebai/oats#866, #890).
//
// A retire holds the claim of the home it retires (<instances>/.oats-retirement/claims/<name>.lock,
// lib/core.mjs claimHomeFor) and stops its recorded children first. It does NOT hold its children's
// claims: each child's stop (lib/core.mjs stopRecordedChildren → stopInstanceSession) takes that
// child's claim for the span of that one stop. This file pins what follows from that:
//
//   - a stop of a child beside its parent's retire is not refused: nobody holds the child's claim;
//   - a parent's retire that meets a child whose claim is held (by a stop of that child, or by a
//     retire of it) signals nothing of that child and answers E_CHILDREN_RUNNING: one row per child
//     of the plan, in the plan's order, whatever each row says. The held child's row carries the
//     claim's own refusal (E_LIFECYCLE_BUSY beside a stop, E_INSTANCE_RETIRING beside a retire) and
//     `stillRunning: null`: nothing was established about its processes;
//   - `details.reached.sessionStopAttempted` of that answer is true only when a signal was sent to
//     some child's harness;
//   - a claim a dead holder left on a child is taken over by the child's stop, and the retire goes on.
//
// No outcome rests on a sleep or on which process is faster. The command that holds a claim is the
// real CLI, started as a child and HELD right after the link that makes its claim file has returned
// (test/helpers/fs-gate-preload.mjs: a pause, and nothing else); the second command runs while it
// is held, and the held one is then released and must finish.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { oatsSocket, waitUntil } from "./helpers/host-fixture.mjs";
import { startGated } from "./helpers/fs-gate-preload.mjs";
import { CLI, v2Deployment } from "./helpers/v2-deployment.mjs";

const HAS_TMUX = (() => { try { execFileSync("tmux", ["-V"], { stdio: "ignore", timeout: 5000 }); return true; } catch { return false; } })();
const NO_TMUX = !HAS_TMUX && "tmux is not installed";
/** The shell of the fixture's tmux server and of its panes, on every host. */
const SHELL = "/bin/sh";
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
/** How long a held command waits for its release before it goes on by itself (the pause's own
 *  bound, which a test then reports): well above what the commands run meanwhile take on a slow host. */
const HOLD_MS = 120000;
/** The lifecycle claim of the home `home`: one file per home, beside the homes (lib/core.mjs retireClaimPath). */
const claimOf = (home) => join(dirname(home), ".oats-retirement", "claims", `${basename(home)}.lock`);
/** A real pid whose process has exited and been reaped. */
const exitedPid = () => spawnSync(process.execPath, ["-e", ""]).pid;

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

/** A capability whose retire hook records the instance it ran for in `<agents root>/retire-hook-ran`, outside every home. */
const recordingHook = {
  manifest: { hooks: { retire: "hook.mjs" } },
  files: { "hook.mjs": `import { appendFileSync } from "node:fs";\nimport { join } from "node:path";\nappendFileSync(join(process.env.OATS_ROOT, "retire-hook-ran"), process.env.OATS_INSTANCE + "\\n");\n` },
};

/** A deployment of the soul `dev` (work: directory), and what the tests do in it: a parent, its
 *  recorded children (idle, or with a stand-in harness running in a window of the fixture's own tmux
 *  server), a lifecycle command held right after it took a claim, and the reads of what is on disk. */
function family(t) {
  const fx = v2Deployment({ t, souls: { dev: { soul: { capabilities: { "test.recording": { from: "here" } } } } }, capabilities: { "test.recording": recordingHook } });
  const env = { ...fx.env, SHELL };
  const hookLog = join(fx.root, "retire-hook-ran");
  // A stand-in harness that says which process it is and idles until it is signalled. A spawn
  // records the launch executable it finds on PATH: a child that is to run is spawned with this
  // directory first on it, and no harness installed on the host is ever started.
  const idleBin = join(fx.base, "idle-bin");
  mkdirSync(idleBin);
  writeFileSync(join(idleBin, "pi"), `#!/bin/sh\necho $$ > "$OATS_INSTANCE_HOME/harness.pid"\nexec sleep 600\n`, { mode: 0o755 });
  // One that does not end on SIGTERM: a stop of it waits out its grace and finds it running. One
  // process, so that the row's `stillRunning` is that pid; the fixture's cleanup ends it.
  const stubbornBin = join(fx.base, "stubborn-bin");
  mkdirSync(stubbornBin);
  writeFileSync(join(stubbornBin, "pi"), `#!${process.execPath}\nprocess.on("SIGTERM", () => {});\nrequire("node:fs").writeFileSync(process.env.OATS_INSTANCE_HOME + "/harness.pid", String(process.pid));\nsetInterval(() => {}, 1000);\n`, { mode: 0o755 });
  const socket = oatsSocket(fx.env.TMUX_TMPDIR);
  const harnesses = [];
  // Whatever a failed assertion leaves: the harnesses and the server end before the fixture looks
  // for processes left in its base.
  fx.beforeCleanup(() => {
    for (const pid of harnesses) if (alive(pid)) process.kill(pid, "SIGKILL");
    if (HAS_TMUX && existsSync(socket)) { try { execFileSync("tmux", ["-f", "/dev/null", "-S", socket, "kill-server"], { stdio: "ignore", timeout: 10000 }); } catch { /* no server runs */ } }
  });
  let gateDirs = 0;
  const f = {
    fx, hookLog,
    /** The CLI in the deployment, as fx.cli runs it. */
    cli: (argv) => fx.cli(argv, { env: { SHELL } }),
    /** A spawned instance of `dev` (no launch) → { name, home, lock }: `lock` is its lifecycle claim. */
    spawn: async (name, opts = {}, path = fx.env.PATH) => {
      const saved = process.env.PATH;
      process.env.PATH = path;
      try { const { home } = await fx.spawn("dev", { name, ...opts }); return { name, home, lock: claimOf(home) }; } finally { process.env.PATH = saved; }
    },
    /** A recorded child of `parent`, not launched: its session reads as not-launched, and a stop of it signals nothing. */
    child: (name, parent) => f.spawn(name, { relativeTo: parent.name, relation: "child" }),
    /** A recorded child of `parent` whose stand-in harness runs → the child, with `harness`, that
     *  process's pid. `stubborn`: one that a stop does not end. */
    runningChild: async (name, parent, { stubborn = false } = {}) => {
      const kid = await f.spawn(name, { relativeTo: parent.name, relation: "child" }, `${stubborn ? stubbornBin : idleBin}:${fx.env.PATH}`);
      const started = f.cli(["session", "start", "--home", kid.home, "--json"]);
      assert.equal(started.status, 0, `fixture premise: \`oats session start\` starts ${name}\n${started.stdout}\n${started.stderr}`);
      const harness = () => { try { const text = readFileSync(join(kid.home, "harness.pid"), "utf8").trim(); return /^\d+$/.test(text) && Number(text) > 1 ? Number(text) : null; } catch { return null; } };
      await waitUntil(() => harness() !== null && alive(harness()), `the stand-in harness of ${name} to run`);
      harnesses.push(harness());
      await waitUntil(() => { const s = f.stopPlan(kid).targets[0].session; return s.present === true && s.state !== "shell"; }, `the session of ${name} to read as running`);
      return { ...kid, harness: harness() };
    },
    stopPlan: (i) => { const r = f.cli(["instance", "stop", i.name, "--plan", "--json"]); assert.equal(r.status, 0, `fixture premise: a stop plan of ${i.name}\n${r.stdout}\n${r.stderr}`); return r.json().result; },
    retirePlan: (i) => { const r = f.cli(["retire", i.name, "--plan", "--json"]); assert.equal(r.status, 0, `fixture premise: a retire plan of ${i.name}\n${r.stdout}\n${r.stderr}`); return r.json().result; },
    /** `oats <argv>` as a child process, held right after it has taken the lifecycle claim `lock`:
     *  the link that makes the claim file has returned, and the command has done nothing else yet. */
    heldAfterClaim: (argv, lock) => startGated([CLI, ...argv], { cwd: fx.dep, env, gateDir: join(fx.base, `gates-${++gateDirs}`), gates: [{ name: "claimed", fn: "linkSync", arg: 1, path: lock, when: "after", waitMs: HOLD_MS }] }),
    /** The instances a retire hook ran for, in order. */
    hookRuns: () => (existsSync(hookLog) ? readFileSync(hookLog, "utf8").split("\n").filter(Boolean) : []),
    /** The files of the claims directory of the agent `home` belongs to: claims, and what a takeover
     *  leaves. `held` is a command held right after its link: it stands before the removal of the
     *  private file it linked its claim from (`<claim>.tmp-<pid>-<nonce>`), which is left out. */
    claimFiles: (home, held) => {
      const dir = dirname(claimOf(home));
      return existsSync(dir) ? readdirSync(dir).filter((entry) => !(held && entry.includes(`.lock.tmp-${held.child.pid}-`))).sort() : [];
    },
    /** The recoveries a retire wrote for the agent's instances, and the staging of one. */
    recoveries: (home) => { const dir = join(dirname(home), ".oats-retirement", "recovery"); return existsSync(dir) ? readdirSync(dir) : []; },
    receipts: (home) => readdirSync(dirname(home)).filter((entry) => entry.startsWith(".oats-retire-receipt.")),
  };
  return f;
}

/** The held command took the claim `lock` for `action`, and stands still: the premise of every case. */
function assertHolds(run, lock, action) {
  assert.equal(run.child.exitCode, null, "fixture premise: the command that holds the claim is held, not finished");
  const claim = readJson(lock);
  assert.deepEqual({ action: claim.action, pid: claim.pid }, { action, pid: run.child.pid }, `fixture premise: ${lock} is the held command's claim, and names its verb`);
  return claim;
}
/** The one error envelope of a refused command (a spawnSync result): exit 1, one line on stdout. */
function refusal(r, what) {
  const said = `${what}\n  exit status: ${r.status}\n  stdout: ${r.stdout}\n  stderr: ${r.stderr}`;
  assert.equal(r.status, 1, said);
  const lines = r.stdout.trim().split("\n");
  assert.equal(lines.length, 1, `exactly one envelope on stdout: ${said}`);
  const envelope = JSON.parse(lines[0]);
  assert.deepEqual({ schemaVersion: envelope.schemaVersion, ok: envelope.ok }, { schemaVersion: 1, ok: false }, said);
  return envelope.error;
}
/** What a held command answered once it was released: it was let go by the test, and exited by itself. */
async function released(run) {
  run.release("claimed");
  const result = await run.done;
  assert.deepEqual(result.timedOut, [], "the gate was released in time: the held command did not go on by itself");
  assert.equal(result.signal, null, `the held command was not ended by a signal\n${result.stdout}\n${result.stderr}`);
  return result;
}
/** The row of a child that a retire's stop found idle, having signalled nothing. */
const idleRow = (kid) => ({ instance: kid.name, home: kid.home, ok: true, stopped: false, alreadyIdle: true });
const NOTHING_SIGNALLED = { phase: "before-hooks", sessionStopAttempted: false, hooksStarted: false, home: "kept", recovery: null };

// ---- 1. a stop of a child beside its parent's retire ----

test("a stop of an idle child beside its parent's retire is not refused: the retire holds its own claim, not its children's; released, the retire completes and its row for the child says it was idle", async (t) => {
  const f = family(t);
  const parent = await f.spawn("parent");
  const kid = await f.child("kid", parent);
  const run = f.heldAfterClaim(["retire", parent.name, "--json"], parent.lock);
  try {
    await run.waitGate("claimed");
    assertHolds(run, parent.lock, "retire");
    assert.deepEqual(f.claimFiles(parent.home, run), ["parent.lock"], "the retire holds its own claim, and no claim of its child");

    const plan = f.stopPlan(kid);
    assert.deepEqual(plan.targets.map((target) => [target.instance, target.retiring, target.stopPending]), [["kid", false, false]], "the child's stop plan: it is not being retired, and no stop of it runs");
    const applied = f.cli(["instance", "stop", kid.name, "--apply", "--plan-revision", plan.planRevision, "--idempotency-key", "k1", "--json"]);
    assert.equal(applied.status, 0, applied.stdout + applied.stderr);
    const receipt = applied.json().result;
    assert.equal(receipt.ok, true, JSON.stringify(receipt));
    assert.deepEqual(receipt.results, [{ instance: "kid", home: kid.home, ok: true, stopped: false, alreadyIdle: true, state: "not-launched" }]);
    assertHolds(run, parent.lock, "retire");
    assert.deepEqual(f.claimFiles(parent.home, run), ["parent.lock"], "the stop released the child's claim");

    const done = await released(run);
    assert.equal(done.code, 0, done.stdout + done.stderr);
    const retired = JSON.parse(done.stdout);
    assert.equal(retired.retired, "parent");
    assert.deepEqual(retired.childrenStopped, [idleRow(kid)], "the retire's own stop of the child found it idle");
    assert.equal(existsSync(parent.home), false, "the parent's home is removed");
    assert.equal(existsSync(join(kid.home, "instance.json")), true, "the child is kept");
    assert.deepEqual(f.hookRuns(), ["parent"], "the retire hook ran once, for the parent");
    assert.deepEqual(f.claimFiles(parent.home), [], "no claim is left");
  } finally { await run.finish(); }
});

test("a stop of a child whose session runs, beside its parent's retire: the stop ends the harness (stopped: true); released, the retire finds the child idle and completes", { skip: NO_TMUX }, async (t) => {
  const f = family(t);
  const parent = await f.spawn("parent");
  const kid = await f.runningChild("kid", parent);
  const run = f.heldAfterClaim(["retire", parent.name, "--json"], parent.lock);
  try {
    await run.waitGate("claimed");
    assertHolds(run, parent.lock, "retire");
    assert.equal(alive(kid.harness), true, "the retire has not reached its children: the child's harness runs");

    const plan = f.stopPlan(kid);
    assert.deepEqual(plan.targets.map((target) => [target.instance, target.retiring, target.stopPending, target.session.present]), [["kid", false, false, true]]);
    const applied = f.cli(["instance", "stop", kid.name, "--apply", "--plan-revision", plan.planRevision, "--idempotency-key", "k1", "--json"]);
    assert.equal(applied.status, 0, applied.stdout + applied.stderr);
    const receipt = applied.json().result;
    assert.equal(receipt.ok, true, JSON.stringify(receipt));
    assert.deepEqual(receipt.results, [{ instance: "kid", home: kid.home, ok: true, stopped: true, alreadyIdle: false, state: "shell" }], "the stop ended the child's harness");
    await waitUntil(() => !alive(kid.harness), "the stopped harness to have exited");
    assertHolds(run, parent.lock, "retire");

    const done = await released(run);
    assert.equal(done.code, 0, done.stdout + done.stderr);
    const retired = JSON.parse(done.stdout);
    assert.equal(retired.retired, "parent");
    assert.deepEqual(retired.childrenStopped, [idleRow(kid)], "the child is idle by then, and the retire's row for it says so");
    assert.equal(existsSync(parent.home), false, "the parent's home is removed");
    assert.equal(existsSync(join(kid.home, "instance.json")), true, "the child is kept");
    assert.deepEqual(f.claimFiles(parent.home), [], "no claim is left");
  } finally { await run.finish(); }
});

// ---- 2 and 3. a parent's retire that meets a child whose claim is held ----

/** Who holds the claim of the child `c2` while its parent is retired, and what the parent's row
 *  for that child then says: the refusal of a stop that meets that holder (lib/core.mjs
 *  lifecycleClaimRefusals, arriving verb "stop"). */
const HOLDERS = [
  { id: "a stop of that child", action: "stop", code: "E_LIFECYCLE_BUSY",
    argv: (f, kid) => ["instance", "stop", kid.name, "--apply", "--plan-revision", f.stopPlan(kid).planRevision, "--idempotency-key", "k-stop", "--json"],
    message: (kid, claim) => `a stop of ${kid.name} is already running (pid ${claim.pid}, since ${claim.at}); nothing was stopped — wait for it to finish`,
    /** Released, the stop finishes: the child was idle, and is kept. */
    finished: (f, kid, done) => {
      assert.equal(done.code, 0, done.stdout + done.stderr);
      const receipt = JSON.parse(done.stdout).result;
      assert.equal(receipt.ok, true, done.stdout);
      assert.deepEqual(receipt.results, [{ instance: kid.name, home: kid.home, ok: true, stopped: false, alreadyIdle: true, state: "not-launched" }]);
      assert.equal(existsSync(join(kid.home, "instance.json")), true, "the stopped child is kept");
      return true;
    } },
  { id: "a retire of that child", action: "retire", code: "E_INSTANCE_RETIRING",
    argv: (f, kid) => ["retire", kid.name, "--json"],
    message: (kid, claim) => `${kid.name} is being retired (pid ${claim.pid}, since ${claim.at}); nothing was stopped`,
    /** Released, the retire finishes: the child is gone. */
    finished: (f, kid, done) => {
      assert.equal(done.code, 0, done.stdout + done.stderr);
      assert.equal(JSON.parse(done.stdout).retired, kid.name);
      assert.equal(existsSync(kid.home), false, "the retired child's home is removed");
      return false;
    } },
];

for (const holder of HOLDERS) {
  test(`a parent's retire that meets a child whose claim ${holder.id} holds, plain and guarded, answers E_CHILDREN_RUNNING: one row per child in the plan's order, the held child's row ${holder.code} with stillRunning null; no signal was sent, the parent's home is kept and no retire hook ran`, async (t) => {
    const f = family(t);
    const parent = await f.spawn("parent");
    const kids = { c1: await f.child("c1", parent), c2: await f.child("c2", parent) };
    const plan = f.retirePlan(parent);
    const order = plan.facts.children.map((kid) => kid.instance);
    assert.deepEqual([...order].sort(), ["c1", "c2"], "fixture premise: the retire plan lists both recorded children");

    const run = f.heldAfterClaim(holder.argv(f, kids.c2), kids.c2.lock);
    try {
      await run.waitGate("claimed");
      const claim = assertHolds(run, kids.c2.lock, holder.action);
      const before = { parent: snapshot(parent.home), c1: snapshot(kids.c1.home), c2: snapshot(kids.c2.home) };
      const heldRow = { instance: "c2", home: kids.c2.home, ok: false, code: holder.code, message: holder.message(kids.c2, claim), stillRunning: null };
      const rows = order.map((name) => (name === "c2" ? heldRow : idleRow(kids[name])));

      for (const [what, extra] of [["plain", []], ["guarded", ["--plan-revision", plan.planRevision, "--idempotency-key", "k-retire"]]]) {
        const error = refusal(f.cli(["retire", parent.name, "--json", ...extra]), `\`oats retire parent\` (${what}) while ${holder.id} holds the claim of c2`);
        assert.equal(error.code, "E_CHILDREN_RUNNING", `${what}: ${JSON.stringify(error)}`);
        // No stop of that child ran: it is not said to be still running (before, every child that
        // did not stop was "still running after a bounded stop").
        assert.equal(error.message, `c2 could not be stopped (${holder.code}); nothing was retired and nothing was escalated`, `${what}: the message names the child that refused, why, and no other`);
        assert.deepEqual(Object.keys(error.details).sort(), what === "guarded" ? ["childrenStopped", "plan", "reached"] : ["childrenStopped", "reached"], what);
        assert.deepEqual(error.details.childrenStopped, rows, `${what}: one row per child of the plan, in the plan's order`);
        // `stillRunning: null` is not `[]`: the stop never ran, so nothing was established about the child's processes.
        assert.equal(error.details.childrenStopped.find((row) => row.instance === "c2").stillRunning, null, what);
        assert.deepEqual(error.details.reached, NOTHING_SIGNALLED, `${what}: no child had a session, so no signal was sent`);
        if (what === "guarded") {
          assert.deepEqual({ action: error.details.plan.action, instance: error.details.plan.instance, planRevision: error.details.plan.planRevision },
            { action: "retire", instance: "parent", planRevision: plan.planRevision }, "the guarded apply returns the plan it acted on");
        }
        // Nothing was retired: the three homes are what they were, and the held command still holds its claim.
        assert.deepEqual(snapshot(parent.home), before.parent, `${what}: the parent's home is byte for byte what it was`);
        assert.deepEqual([snapshot(kids.c1.home), snapshot(kids.c2.home)], [before.c1, before.c2], `${what}: both children's homes are byte for byte what they were`);
        assert.deepEqual(f.hookRuns(), [], `${what}: no retire hook ran`);
        assert.deepEqual(f.recoveries(parent.home), [], `${what}: no recovery was written`);
        assert.deepEqual(f.receipts(parent.home), [], `${what}: no receipt of the refused retire was written`);
        assertHolds(run, kids.c2.lock, holder.action);
        assert.deepEqual(f.claimFiles(parent.home, run), ["c2.lock"], `${what}: the parent's claim and the other child's are released; the held one is still its holder's`);
      }

      // The held command finishes once it is let go, and the same guarded apply then retires the parent.
      const stillAChild = holder.finished(f, kids.c2, await released(run));
      assert.deepEqual(f.claimFiles(parent.home), [], "no claim is left");
      const again = f.cli(["retire", parent.name, "--json", "--plan-revision", stillAChild ? plan.planRevision : f.retirePlan(parent).planRevision, "--idempotency-key", "k-retire"]);
      assert.equal(again.status, 0, again.stdout + again.stderr);
      const retired = JSON.parse(again.stdout);
      assert.deepEqual({ retired: retired.retired, replayed: retired.replayed, key: retired.idempotencyKey }, { retired: "parent", replayed: false, key: "k-retire" }, "the key the refused apply was given was not used up: this is its first receipt");
      assert.deepEqual(retired.childrenStopped, order.filter((name) => stillAChild || name !== "c2").map((name) => idleRow(kids[name])), "its rows: the children it has now, in the plan's order");
      assert.equal(existsSync(parent.home), false, "the parent's home is removed");
      assert.equal(existsSync(join(kids.c1.home, "instance.json")), true, "the other child is kept");
    } finally { await run.finish(); }
  });
}

test("a parent's retire that stops one child's harness and meets another child whose claim a stop holds: E_CHILDREN_RUNNING with reached.sessionStopAttempted true, the stopped child's row ok, the held child's E_LIFECYCLE_BUSY; the home is kept and no retire hook ran", { skip: NO_TMUX }, async (t) => {
  const f = family(t);
  const parent = await f.spawn("parent");
  const kids = { c1: await f.runningChild("c1", parent), c2: await f.child("c2", parent) };
  const order = f.retirePlan(parent).facts.children.map((kid) => kid.instance);
  assert.deepEqual([...order].sort(), ["c1", "c2"], "fixture premise: the retire plan lists both recorded children");

  const run = f.heldAfterClaim(["instance", "stop", "c2", "--apply", "--plan-revision", f.stopPlan(kids.c2).planRevision, "--idempotency-key", "k-stop", "--json"], kids.c2.lock);
  try {
    await run.waitGate("claimed");
    const claim = assertHolds(run, kids.c2.lock, "stop");
    assert.equal(alive(kids.c1.harness), true, "fixture premise: the other child's harness runs");
    const before = snapshot(parent.home);

    const error = refusal(f.cli(["retire", parent.name, "--json"]), "`oats retire parent` while a stop holds the claim of c2 and the harness of c1 runs");
    assert.equal(error.code, "E_CHILDREN_RUNNING", JSON.stringify(error));
    assert.deepEqual(error.details.childrenStopped, order.map((name) => (name === "c1"
      ? { instance: "c1", home: kids.c1.home, ok: true, stopped: true, alreadyIdle: false }
      : { instance: "c2", home: kids.c2.home, ok: false, code: "E_LIFECYCLE_BUSY", message: `a stop of c2 is already running (pid ${claim.pid}, since ${claim.at}); nothing was stopped — wait for it to finish`, stillRunning: null })),
    "one row per child of the plan, in the plan's order: the one it stopped, and the one whose claim was held");
    assert.deepEqual(error.details.reached, { ...NOTHING_SIGNALLED, sessionStopAttempted: true }, "a signal was sent to a child's harness: the answer says so");
    assert.equal(error.message, "c2 could not be stopped (E_LIFECYCLE_BUSY); nothing was retired and nothing was escalated", "the message names the child that did not stop, and not the one that did");
    await waitUntil(() => !alive(kids.c1.harness), "the harness the retire stopped to have exited");
    assert.deepEqual(snapshot(parent.home), before, "the parent's home is byte for byte what it was");
    assert.deepEqual(f.hookRuns(), [], "no retire hook ran");
    assert.deepEqual(f.recoveries(parent.home), [], "no recovery was written");
    assertHolds(run, kids.c2.lock, "stop");
    assert.deepEqual(f.claimFiles(parent.home, run), ["c2.lock"], "the claim the retire took for the child it stopped is released");

    const done = await released(run);
    assert.equal(done.code, 0, done.stdout + done.stderr);
    assert.equal(JSON.parse(done.stdout).result.ok, true, done.stdout);
    assert.deepEqual(f.claimFiles(parent.home), [], "no claim is left");
  } finally { await run.finish(); }
});

test("a parent's retire that meets a child still running after its bounded stop and a child whose claim a stop holds says each as it is: the first \"is still running after a bounded stop\", the second \"could not be stopped (E_LIFECYCLE_BUSY)\"; the rows carry the pid that runs, and null", { skip: NO_TMUX }, async (t) => {
  // The stop of the stubborn child waits out the default grace (20 s): a retire stops its children
  // with no grace of the caller's.
  const f = family(t);
  const parent = await f.spawn("parent");
  const kids = { c1: await f.runningChild("c1", parent, { stubborn: true }), c2: await f.child("c2", parent) };
  const order = f.retirePlan(parent).facts.children.map((kid) => kid.instance);
  assert.deepEqual([...order].sort(), ["c1", "c2"], "fixture premise: the retire plan lists both recorded children");
  const run = f.heldAfterClaim(["instance", "stop", "c2", "--apply", "--plan-revision", f.stopPlan(kids.c2).planRevision, "--idempotency-key", "k-stop", "--json"], kids.c2.lock);
  try {
    await run.waitGate("claimed");
    assertHolds(run, kids.c2.lock, "stop");
    const error = refusal(f.cli(["retire", parent.name, "--json"]), "`oats retire parent` while c1 does not end on SIGTERM and a stop holds the claim of c2");
    assert.equal(error.code, "E_CHILDREN_RUNNING", JSON.stringify(error));
    assert.equal(error.message, "c1 is still running after a bounded stop; c2 could not be stopped (E_LIFECYCLE_BUSY); nothing was retired and nothing was escalated");
    const rows = Object.fromEntries(error.details.childrenStopped.map((row) => [row.instance, row]));
    assert.deepEqual(error.details.childrenStopped.map((row) => row.instance), order, "one row per child of the plan, in the plan's order");
    assert.deepEqual([rows.c1.ok, rows.c1.stillRunning, rows.c2.ok, rows.c2.code, rows.c2.stillRunning], [false, [kids.c1.harness], false, "E_LIFECYCLE_BUSY", null], "the pid that still runs, and null for the child on which no stop ran");
    assert.equal(error.details.reached.sessionStopAttempted, true, "a signal was sent to the child that did not end");
    assert.equal(alive(kids.c1.harness), true, "nothing was escalated: the child that ignored SIGTERM runs");
    assert.equal(existsSync(join(parent.home, "instance.json")), true, "the parent's home is kept");
    assert.deepEqual(f.hookRuns(), [], "no retire hook ran");
    const done = await released(run);
    assert.equal(done.code, 0, done.stdout + done.stderr);
  } finally { await run.finish(); }
});

// ---- 4. a claim a dead holder left on a child ----

test("a child whose claim a dead holder left (a stop's, a retire's): the child's stop takes it over, its row is ok, the parent's retire completes and no claim file is left", async (t) => {
  const f = family(t);
  const parent = await f.spawn("parent");
  const kids = { c1: await f.child("c1", parent), c2: await f.child("c2", parent) };
  const order = f.retirePlan(parent).facts.children.map((kid) => kid.instance);
  assert.deepEqual([...order].sort(), ["c1", "c2"], "fixture premise: the retire plan lists both recorded children");
  // A claim as the protocol writes it, of a process that has exited: one a stop left, one a retire left.
  mkdirSync(dirname(kids.c1.lock), { recursive: true });
  for (const [kid, action, nonce] of [[kids.c1, "stop", "b".repeat(32)], [kids.c2, "retire", "c".repeat(32)]]) {
    writeFileSync(kid.lock, JSON.stringify({ action, pid: exitedPid(), processStart: "proc:1", nonce, at: "2026-10-10T00:00:00.000Z" }) + "\n");
  }
  assert.deepEqual(f.claimFiles(parent.home), ["c1.lock", "c2.lock"], "fixture premise: both children carry a claim nobody holds");

  const r = f.cli(["retire", parent.name, "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const retired = JSON.parse(r.stdout);
  assert.equal(retired.retired, "parent");
  assert.deepEqual(retired.childrenStopped, order.map((name) => idleRow(kids[name])), "each child's stop took the dead holder's claim over, and stopped it");
  assert.equal(existsSync(parent.home), false, "the parent's home is removed");
  for (const kid of Object.values(kids)) assert.equal(existsSync(join(kid.home, "instance.json")), true, `${kid.name} is kept`);
  assert.deepEqual(f.hookRuns(), ["parent"], "the retire hook ran once, for the parent");
  assert.deepEqual(f.claimFiles(parent.home), [], "the stale claims are gone, and no claim or takeover file is left");
});
