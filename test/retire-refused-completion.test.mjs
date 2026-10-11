// A scheduled self-retire that does not complete says so, and keeps its marker only when the home
// is owed a retire (awebai/oats#954).
//
// `oats retire <name> --self` only schedules: it writes a pending marker beside the home and starts
// a detached completion (lib/core.mjs completeDeferredRetirement) that runs the retire later, with
// nobody at a terminal. This file pins what a completion that does not complete leaves:
//
//   - its outcome beside the home (the result file and its log), always, as before;
//   - its pending marker only when a retire hook was started or the removal of the home began. With
//     the marker gone the instance reads as any other: not RETIRING in `oats status`, `retiring:
//     false` in a stop plan, and a stop and a start are not answered E_INSTANCE_RETIRING;
//   - one `retire-refused` event, `data: { code, homeChanged, reason }`, in the workspace's log
//     alone, with the incarnation read before the retire ran. Never in the home's log: a completion
//     holds no claim when it writes, so it writes nothing into a home;
//   - only its own marker is removed: the one of the scheduling it completes (the same
//     `requestedAt`) whose named completion is absent, this process, or verifiably gone.
//
// The completion is the real one wherever a test needs no step in between: a self-retire scheduled
// with no delay, whose detached completion the test waits for. Where a test must choose the marker
// or stand between two steps, the completion is a child of the test that runs the same function
// with no delay, from an intent or from the marker's path, as the detached script does.
//
// The scheduling and its completion are two processes, and the scheduling writes the marker last,
// under the home's claim. A completion that gave up waiting for that claim before the marker was
// written finds none to remove; so the scheduling looks for the completion's outcome once it has
// written the marker, and fails when it is there. The last two tests hold the scheduling at each
// side of that look.
//
// "A recorded child that will not stop" is a child whose lifecycle claim cannot be read: its stop
// is refused at once (E_LIFECYCLE_BUSY) and nothing is signalled, so the parent's retire answers
// E_CHILDREN_RUNNING before it touches the parent's home. No outcome rests on a sleep.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { deferredRetireResultPath, retireInstance, retirePendingMarkerPath } from "../lib/core.mjs";
import { RETIRE_REFUSED_REASON_MAX } from "../lib/instance-events.mjs";
import { startGated } from "./helpers/fs-gate-preload.mjs";
import { killAndReap, waitUntil } from "./helpers/host-fixture.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const CORE = pathToFileURL(new URL("../lib/core.mjs", import.meta.url).pathname).href;
/** A mode no longer keeps root out: the shapes that rest on one are skipped for root. */
const ROOT = process.getuid?.() === 0;
const SKIP_FOR_ROOT = "root reads, writes and empties whatever the mode says: this shape cannot fail";
/** How long a completion on a loaded host is waited for. */
const COMPLETION_MS = 180000;
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const gone = (pid) => { try { process.kill(pid, 0); return false; } catch (e) { return e.code === "ESRCH"; } };
const oneLine = (text) => text.replace(/\s+/g, " ").trim();

/** Every entry under `dir`, one row each: its path, its mode, and a file's bytes (as a digest) or a
 *  link's target. Two listings that are equal are the same tree, byte for byte. */
function listing(dir, rel = "") {
  const rows = [];
  for (const name of readdirSync(join(dir, rel)).sort()) {
    const at = join(rel, name), abs = join(dir, at), st = lstatSync(abs), mode = (st.mode & 0o7777).toString(8);
    if (st.isSymbolicLink()) rows.push(`${at} -> ${readlinkSync(abs)}`);
    else if (st.isDirectory()) rows.push(`${at}/ ${mode}`, ...listing(dir, at));
    else rows.push(`${at} ${mode} ${createHash("sha256").update(readFileSync(abs)).digest("hex")}`);
  }
  return rows;
}

/** What the detached script of a self-retire runs, with no delay: from the marker's path when
 *  OATS_TEST_COMPLETION_MARKER names one, else from the intent in the environment. */
const COMPLETION = `import { completeDeferredRetirement } from ${JSON.stringify(CORE)};
const given = process.env.OATS_TEST_COMPLETION_MARKER || JSON.parse(process.env.OATS_RETIRE_INTENT);
process.exitCode = completeDeferredRetirement(given, { delaySec: 0 }) ? 0 : 1;`;

/** `oats retire <name> --self` as the instance's own process runs it, its completion due at once:
 *  the answer on stdout, an error as `{ error: { code, message, reached } }` with exit 1. */
const SCHEDULING = `import { retireInstance } from ${JSON.stringify(CORE)};
const { root, name } = JSON.parse(process.env.OATS_TEST_SCHEDULING);
try { console.log(JSON.stringify(retireInstance(root, name, { self: true, selfKillDelaySec: 0 }))); }
catch (e) { console.log(JSON.stringify({ error: { code: e.code, message: e.message, reached: e.details?.reached ?? null } })); process.exitCode = 1; }`;

/** The retire hook. It appends the instance it ran for to `<agents root>/retire-hook.log`, outside
 *  every home, and then does what the files beside that log ask: `hook-unreadable`, leave in the
 *  home a file nobody may read (the inspection after the hooks fails on it); `hook-incomplete`,
 *  report that its cleanup did not finish, in words of its own. */
const HOOK_TEXT = "HOOK-OWN-WORDS";
const HOOK = `import { appendFileSync, chmodSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const root = process.env.OATS_ROOT, home = process.env.OATS_INSTANCE_HOME;
appendFileSync(join(root, "retire-hook.log"), process.env.OATS_INSTANCE + "\\n");
if (existsSync(join(root, "hook-unreadable"))) { const left = join(home, "left-by-the-hook"); writeFileSync(left, "the hook's\\n"); chmodSync(left, 0o000); }
if (existsSync(join(root, "hook-incomplete"))) {
  console.error("${HOOK_TEXT} on stderr");
  console.log(JSON.stringify({ meta: { retired: false, reason: "${HOOK_TEXT} in its reason" } }));
  process.exit(1);
}
console.log(JSON.stringify({ meta: { retired: true } }));
`;

/** Give every directory under `path` back to its owner, so that the fixture can be removed. */
function makeRemovable(path) {
  let st;
  try { st = lstatSync(path); } catch { return; }
  if (!st.isDirectory()) return; // lstat: a link is never followed
  if ((st.mode & 0o700) !== 0o700) chmodSync(path, (st.mode & 0o7777) | 0o700);
  for (const name of readdirSync(path)) makeRemovable(join(path, name));
}

/** A deployment of the soul `dev` (work: directory) whose capability has the retire hook above, and
 *  what the tests do in it. Every completion a test starts is ended before the fixture's check for
 *  processes left in its base. */
function deployment(t) {
  const fx = v2Deployment({ t,
    souls: { dev: { soul: { work: "directory", capabilities: { "test.retire": { from: "here" } } } } },
    capabilities: { "test.retire": { manifest: { hooks: { retire: "hook.mjs" } }, files: { "hook.mjs": HOOK } } },
  });
  const completions = [];
  fx.beforeCleanup(() => {
    for (const pid of completions) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
    makeRemovable(fx.base);
  });
  let gateDirs = 0;
  // An in-process spawn or retire finds its harness on this process's PATH: the fixture's inert ones.
  const onFixturePath = async (fn) => {
    const hostPath = process.env.PATH;
    process.env.PATH = fx.env.PATH;
    try { return await fx.inEnv(fn); } finally { process.env.PATH = hostPath; }
  };
  const rowsOf = (file) => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []);
  const f = {
    fx,
    /** A spawned instance, not launched → its name, its home, the three files a self-retire keeps
     *  beside the home, its two event logs, and `created`, its incarnation. */
    spawn: async (name, opts = {}) => {
      const { home } = await onFixturePath(() => fx.spawn("dev", { name, ...opts }));
      assert.equal(home, join(fx.root, "dev", "instances", name));
      const result = deferredRetireResultPath(home);
      const i = { name, home, marker: retirePendingMarkerPath(home), result, log: result.replace(/\.json$/, ".log"),
        homeLog: join(home, ".oats-events.jsonl"), workspaceLog: join(fx.dep, ".agents", "events", `dev--${name}.jsonl`), created: readJson(join(home, "instance.json")).createdAt };
      assert.deepEqual([rowsOf(i.homeLog)[0]?.kind, rowsOf(i.workspaceLog)[0]?.kind], ["spawned", "spawned"], "fixture premise: these are the instance's two event logs");
      return i;
    },
    /** A recorded child of `parent`, not launched. */
    child: (name, parent) => f.spawn(name, { relativeTo: parent.name, relation: "child" }),
    /** From now on no stop of `kid` can take its claim: the file there is no claim, so the stop is
     *  refused at once and signals nothing. */
    unstoppable: (kid) => {
      const claim = join(dirname(kid.home), ".oats-retirement", "claims", `${kid.name}.lock`);
      mkdirSync(dirname(claim), { recursive: true });
      writeFileSync(claim, "not a claim\n");
      return claim;
    },
    ask: (what) => writeFileSync(join(fx.root, what), ""),
    hookRuns: () => (existsSync(join(fx.root, "retire-hook.log")) ? readFileSync(join(fx.root, "retire-hook.log"), "utf8").split("\n").filter(Boolean).length : 0),
    /** `oats retire <i> --self` as the instance's harness asks for it, its completion `delay`
     *  seconds away → the scheduling's answer. `children`: the recorded children the CLI reads from
     *  the plan and hands the retire. */
    schedule: async (i, { delay = 0, children } = {}) => {
      const r = await onFixturePath(() => retireInstance(fx.root, i.name, { self: true, selfKillDelaySec: delay, ...(children ? { children: children.map((kid) => ({ instance: kid.name, home: kid.home })) } : {}) }));
      assert.equal(r.deferred, true, "fixture premise: the self-retire was scheduled");
      if (r.completionPid) completions.push(r.completionPid);
      return r;
    },
    /** Wait until the detached completion `pid` has ended by itself. */
    ended: (pid) => waitUntil(() => gone(pid), `the completion (pid ${pid}) to end`, COMPLETION_MS),
    /** The intent of a scheduling of `i`, as scheduleDeferredSelfRetirement writes it. */
    intent: (i, { children, ...more } = {}) => ({ instance: i.name, agent: "dev", root: fx.root, requestedAt: "2026-10-10T00:00:00.000Z", requestedByPid: 1, delaySec: 0,
      options: { home: i.home, tmuxSession: "oats-agents", ...(children ? { children: children.map((kid) => ({ instance: kid.name, home: kid.home })) } : {}) }, resultPath: i.result, ...more }),
    /** A completion of the test's own, run to its end → { status, stdout, stderr }. `given` is an
     *  intent, or the path of a marker. */
    complete: (given) => {
      const r = spawnSync(process.execPath, ["--input-type=module", "-e", COMPLETION], { cwd: fx.dep, encoding: "utf8", timeout: COMPLETION_MS,
        env: { ...fx.env, ...(typeof given === "string" ? { OATS_TEST_COMPLETION_MARKER: given } : { OATS_RETIRE_INTENT: JSON.stringify(given) }) } });
      assert.equal(r.signal, null, `the completion ended by itself\n${r.stdout}\n${r.stderr}`);
      return r;
    },
    /** The same completion, held at `gates` (test/helpers/fs-gate-preload.mjs). */
    completeGated: (intent, gates) => startGated(["--input-type=module", "-e", COMPLETION], { cwd: fx.dep, env: { ...fx.env, OATS_RETIRE_INTENT: JSON.stringify(intent) }, gateDir: join(fx.base, `gates-${++gateDirs}`), gates }),
    /** The same scheduling, its completion far away, as the promise of its answer or its error. */
    scheduling: (i) => onFixturePath(() => retireInstance(fx.root, i.name, { self: true, selfKillDelaySec: 600 })),
    /** A scheduling of `i` in a process of its own, held at `gates`. */
    scheduleGated: (i, gates) => startGated(["--input-type=module", "-e", SCHEDULING], { cwd: fx.dep, env: { ...fx.env, OATS_TEST_SCHEDULING: JSON.stringify({ root: fx.root, name: i.name }) }, gateDir: join(fx.base, `gates-${++gateDirs}`), gates }),
    /** Wait until the completion of `i` has said, in its log, that it did not complete: the last
     *  thing it does. (Its scheduling is held and reaps nothing, so its pid stays a zombie.) */
    gaveUp: (i) => waitUntil(() => existsSync(i.log) && readFileSync(i.log, "utf8").includes(`deferred retirement of ${i.name} failed: `), `the completion of ${i.name} to give up and say so`, COMPLETION_MS),
    track: (pid) => { completions.push(pid); return pid; },
    /** The `retire-refused` rows of a log file. */
    refused: (file) => rowsOf(file).filter((row) => row.kind === "retire-refused"),
    kinds: (file) => rowsOf(file).map((row) => row.kind),
    /** The row of `i` in `oats status --json`, and the failed deferred retirements its agent lists. */
    status: (i) => {
      const r = fx.cli(["status", "--json"]);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const agent = JSON.parse(r.stdout).agents.find((a) => a.name === "dev"); // printed over several lines
      return { row: agent.instances.find((row) => row.instance === i.name), failures: (agent.retireFailures ?? []).filter((failure) => failure.instance === i.name) };
    },
    stopPlan: (i) => { const r = fx.cli(["instance", "stop", i.name, "--plan", "--json"]); assert.equal(r.status, 0, r.stdout + r.stderr); return r.json().result; },
    /** What `oats session start` answers for `i`: null when it started, else the error's code. */
    startCode: (i) => { const r = fx.cli(["session", "start", "--home", i.home, "--json"]); return r.status === 0 ? null : r.json().error.code; },
    /** The rows `oats instance events <i> --json` reads. */
    read: (i) => { const r = fx.cli(["instance", "events", i.name, "--json"]); assert.equal(r.status, 0, r.stdout + r.stderr); return r.json().result.events; },
  };
  return f;
}

/** The one `retire-refused` row of `file`, checked against the outcome the completion recorded. */
function oneRefusal(f, file, outcome, homeChanged, what) {
  const rows = f.refused(file);
  assert.equal(rows.length, 1, `${what}: exactly one retire-refused row in ${basename(file)}`);
  assert.deepEqual(rows[0].data, { code: outcome.error.code, homeChanged, reason: oneLine(outcome.error.message) }, what);
  assert.ok(rows[0].data.reason.length <= RETIRE_REFUSED_REASON_MAX, what);
  assert.deepEqual([rows[0].producer, rows[0].eventsApi], ["kernel", 2], what);
  return rows[0];
}

test("a scheduled self-retire refused before its home was touched: its marker is gone and the instance reads as any other, its outcome stays, and the workspace's log holds one retire-refused row, the home's none; a retire a person runs writes none", async (t) => {
  const f = deployment(t);
  const parent = await f.spawn("parent"), kid = await f.child("kid", parent);
  const kidClaim = f.unstoppable(kid);

  // A retire that a person runs is refused the same way, and answers the person: no event.
  const byHand = f.fx.cli(["retire", "parent", "--json"]);
  assert.equal(byHand.status, 1, byHand.stdout + byHand.stderr);
  assert.equal(byHand.json().error.code, "E_CHILDREN_RUNNING");
  assert.deepEqual(byHand.json().error.details.reached, { phase: "before-hooks", sessionStopAttempted: false, hooksStarted: false, home: "kept", recovery: null }, "fixture premise: the retire had started no hook and removed nothing");
  assert.deepEqual([f.refused(parent.homeLog), f.refused(parent.workspaceLog)], [[], []], "a retire that a person runs and that is refused writes no retire-refused row");

  const before = listing(parent.home);
  const scheduled = await f.schedule(parent, { children: [kid] });
  assert.equal(readJson(parent.marker).completionPid, scheduled.completionPid, "fixture premise: the marker names the completion that runs");
  await f.ended(scheduled.completionPid);
  assert.deepEqual(listing(parent.home), before, "neither the scheduling nor its completion changed a file of the home");

  // The outcome and its log stay, as before.
  const outcome = readJson(parent.result);
  assert.deepEqual({ ok: outcome.ok, code: outcome.error.code, retry: outcome.retry }, { ok: false, code: "E_CHILDREN_RUNNING", retry: `oats retire parent --home ${parent.home}` });
  assert.equal(outcome.error.message, "kid could not be stopped (E_LIFECYCLE_BUSY); nothing was retired and nothing was escalated");
  assert.deepEqual(outcome.childrenStopped.map((row) => [row.instance, row.ok, row.code]), [["kid", false, "E_LIFECYCLE_BUSY"]], "the outcome keeps the children's rows");
  const log = readFileSync(parent.log, "utf8");
  assert.ok(log.includes(`deferred retirement of parent failed: ${outcome.error.message}`), log);
  assert.ok(log.includes("its pending marker is removed; parent is not being retired"), log);

  // The marker is gone: the instance is one like any other.
  assert.equal(existsSync(parent.marker), false, "the marker is gone");
  const status = f.status(parent);
  assert.equal(Object.hasOwn(status.row, "retirePending"), false, "oats status: the row has no retirePending");
  assert.deepEqual(status.failures.map((failure) => [failure.error, failure.retry, failure.resultPath]), [[outcome.error.message, outcome.retry, parent.result]], "and still lists the failure");
  // The child can be stopped again: a stop of the parent is a stop of both.
  rmSync(kidClaim);
  const plan = f.stopPlan(parent);
  assert.deepEqual(plan.targets.map((target) => [target.instance, target.retiring]).sort(), [["kid", false], ["parent", false]], "a stop plan: retiring is false");
  const stopped = f.fx.cli(["instance", "stop", "parent", "--apply", "--plan-revision", plan.planRevision, "--idempotency-key", "k1", "--json"]);
  assert.equal(stopped.status, 0, stopped.stdout + stopped.stderr);
  assert.deepEqual(stopped.json().result.results.map((row) => [row.instance, row.ok, row.alreadyIdle]).sort(), [["kid", true, true], ["parent", true, true]], "a stop apply is answered as for any idle instance");
  assert.notEqual(f.startCode(parent), "E_INSTANCE_RETIRING", "a start is not answered E_INSTANCE_RETIRING");

  // One event, in the workspace's log; a read shows it.
  assert.equal(f.hookRuns(), 0, "fixture premise: no retire hook ran");
  const row = oneRefusal(f, parent.workspaceLog, outcome, false, "the workspace's log");
  assert.deepEqual(f.refused(parent.homeLog), [], "and the home's log holds none: a completion writes nothing into a home");
  assert.equal(row.incarnation, parent.created);
  assert.deepEqual(f.read(parent).filter((event) => event.kind === "retire-refused").map((event) => [event.data, event.incarnation]), [[row.data, parent.created]], "a read shows it");
});

test("a scheduled self-retire that fails after a retire hook started: its marker stays and the instance is owed a retire; one retire-refused row with homeChanged true", async (t) => {
  if (ROOT) { t.skip(SKIP_FOR_ROOT); return; }
  const f = deployment(t);
  const i = await f.spawn("hooked");
  f.ask("hook-unreadable");
  const scheduled = await f.schedule(i);
  const markerBytes = readFileSync(i.marker, "utf8");
  await f.ended(scheduled.completionPid);

  const outcome = readJson(i.result);
  assert.deepEqual({ ok: outcome.ok, code: outcome.error.code }, { ok: false, code: "E_WORK_INSPECTION_FAILED" });
  assert.ok(outcome.error.message.includes("The retire hooks have run"), outcome.error.message);
  assert.equal(f.hookRuns(), 1, "fixture premise: the retire hook ran");
  assert.equal(readFileSync(i.marker, "utf8"), markerBytes, "the marker stays, as it was");
  assert.equal(f.status(i).row.retirePending.instance, "hooked", "oats status: the row is owed a retirement");
  assert.deepEqual(f.stopPlan(i).targets.map((target) => target.retiring), [true], "a stop plan: retiring");
  assert.equal(f.startCode(i), "E_INSTANCE_RETIRING", "a start is refused beside the marker");

  const row = oneRefusal(f, i.workspaceLog, outcome, true, "the workspace's log");
  assert.equal(row.incarnation, i.created, "the row's incarnation is the home's");
  assert.deepEqual(f.refused(i.homeLog), [], "nothing is written into the home once the retire worked on it");
  assert.ok(!readFileSync(i.log, "utf8").includes("its pending marker is removed"), "the log does not say the marker went");
});

test("a scheduled self-retire whose removal of the home fails part way, with no hook started: its marker stays; the workspace's log holds the retired row and then the retire-refused one", async (t) => {
  if (ROOT) { t.skip(SKIP_FOR_ROOT); return; }
  const f = deployment(t);
  const i = await f.spawn("partial");
  // A home whose record names no repository, as an earlier kernel spawned it: its retire starts no
  // hook, so what keeps the marker here is the removal alone.
  const { repo, ...record } = readJson(join(i.home, "instance.json"));
  assert.equal(typeof repo, "string", "fixture premise: the spawn recorded the repository");
  writeFileSync(join(i.home, "instance.json"), JSON.stringify(record, null, 2) + "\n");
  // The inspections and the recovery copy read it; the removal cannot empty it.
  mkdirSync(join(i.home, "notes", "ro"), { recursive: true });
  writeFileSync(join(i.home, "notes", "ro", "f"), "in a read-only directory\n");
  chmodSync(join(i.home, "notes", "ro"), 0o555);
  const scheduled = await f.schedule(i);
  await f.ended(scheduled.completionPid);

  const outcome = readJson(i.result);
  assert.deepEqual({ ok: outcome.ok, code: outcome.error.code }, { ok: false, code: "E_LIFECYCLE_FAILED" });
  assert.ok(outcome.error.message.startsWith(`partial: the directory at ${i.home} could not be removed: `), outcome.error.message);
  assert.ok(outcome.error.message.includes("No retire hook was run"), outcome.error.message);
  assert.equal(f.hookRuns(), 0, "fixture premise: no retire hook was started");
  assert.equal(lstatSync(i.home).isDirectory(), true, "fixture premise: something is left at the home");
  assert.equal(existsSync(i.marker), true, "the marker stays");
  const row = oneRefusal(f, i.workspaceLog, outcome, true, "the workspace's log");
  assert.equal(row.incarnation, i.created);
  assert.deepEqual(f.kinds(i.workspaceLog).filter((kind) => kind === "retired" || kind === "retire-refused"), ["retired", "retire-refused"], "the retire's own row first");
  assert.deepEqual(f.refused(i.homeLog), [], "nothing is written into what is left of the home");
});

test("a completion whose cleanup is incomplete: code null, homeChanged true, a sentence of the kernel's own that holds no text of the hook, and the incarnation read before the retire ran", async (t) => {
  const f = deployment(t);
  const i = await f.spawn("quarantined");
  f.ask("hook-incomplete");
  // An older kernel's marker names no completion: it is this scheduling's, whoever completes it.
  const intent = f.intent(i);
  writeFileSync(i.marker, JSON.stringify(intent, null, 2) + "\n");
  // Held once its outcome is written: the retire has run, and the event is not written yet.
  const run = f.completeGated(intent, [{ name: "outcome", fn: "writeFileSync", path: i.result, when: "after", waitMs: COMPLETION_MS }]);
  try {
    await run.waitGate("outcome", COMPLETION_MS);
    const outcome = readJson(i.result);
    assert.equal(outcome.ok, false);
    assert.equal(Object.hasOwn(outcome, "error"), false, "fixture premise: this outcome is a result, not an error");
    assert.ok(Array.isArray(outcome.result.rollbackIncomplete) && outcome.result.rollbackIncomplete.length > 0, JSON.stringify(outcome));
    assert.ok(JSON.stringify(outcome.result.rollbackIncomplete).includes(HOOK_TEXT), `fixture premise: the outcome's items hold the hook's own words: ${JSON.stringify(outcome.result.rollbackIncomplete)}`);
    assert.deepEqual(f.refused(i.workspaceLog), [], "fixture premise: the event is not written yet");
    // What a removal that began would have taken first: the record the incarnation is read from.
    rmSync(join(i.home, "instance.json"));
    run.release("outcome");
    const done = await run.done;
    assert.deepEqual(done.timedOut, []);
    assert.equal(done.code, 1, done.stdout + done.stderr);
    assert.ok(done.stderr.includes("deferred retirement of quarantined is INCOMPLETE; the home is retained"), done.stderr);
    assert.ok(done.stderr.includes(HOOK_TEXT), "the log holds the items");

    const rows = f.refused(i.workspaceLog);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].data, { code: null, homeChanged: true, reason: "the retirement of quarantined is incomplete: its cleanup did not finish, and the home is retained" });
    assert.equal(rows[0].incarnation, i.created, "the incarnation read before the retire ran: instance.json is gone when the row is written");
    assert.deepEqual(f.refused(i.homeLog), [], "nothing is written into the retained home");
    assert.equal(existsSync(i.marker), true, "the marker stays: the home is owed a retire");
    assert.equal(lstatSync(i.home).isDirectory(), true, "the home is retained");
    assert.equal(f.hookRuns(), 1);
  } finally { await run.finish(); }
});

test("in this order: the outcome is written, then the marker goes, then the event is written", async (t) => {
  const f = deployment(t);
  const parent = await f.spawn("parent"), kid = await f.child("kid", parent);
  f.unstoppable(kid);
  const intent = f.intent(parent, { children: [kid] });
  writeFileSync(parent.marker, JSON.stringify(intent, null, 2) + "\n");
  const run = f.completeGated(intent, [
    { name: "marker", fn: "rmSync", path: parent.marker, when: "before", waitMs: COMPLETION_MS },
    { name: "event", fn: "appendFileSync", path: parent.workspaceLog, contains: "retire-refused", when: "before", waitMs: COMPLETION_MS },
  ]);
  try {
    // Held before the marker is removed: a second --self that reads the marker now finds the outcome beside it.
    await run.waitGate("marker", COMPLETION_MS);
    assert.equal(readJson(parent.result).error.code, "E_CHILDREN_RUNNING", "the outcome is written before the marker goes");
    assert.equal(existsSync(parent.marker), true);
    assert.deepEqual([f.refused(parent.homeLog), f.refused(parent.workspaceLog)], [[], []], "no event yet");
    run.release("marker");
    // Held before the event's row is written: the marker is gone by then.
    await run.waitGate("event", COMPLETION_MS);
    assert.equal(existsSync(parent.marker), false, "the marker goes before the event is written");
    assert.deepEqual([f.refused(parent.homeLog), f.refused(parent.workspaceLog)], [[], []], "the event is last");
    run.release("event");
    const done = await run.done;
    assert.deepEqual(done.timedOut, []);
    assert.equal(done.code, 1, done.stdout + done.stderr);
    assert.deepEqual([f.refused(parent.homeLog).length, f.refused(parent.workspaceLog).length], [0, 1]);
  } finally { await run.finish(); }
});

test("a completion that cannot take the home's claim: the refusal's code, no hook and nothing removed, so its marker goes; no file of the home the holder works on is changed", async (t) => {
  const f = deployment(t);
  const i = await f.spawn("claimed");
  // A stop of the instance holds its claim for longer than the completion waits: this process stands in for it.
  const claim = join(dirname(i.home), ".oats-retirement", "claims", "claimed.lock");
  mkdirSync(dirname(claim), { recursive: true });
  const { processStartToken } = await import("../lib/worktree-hooks.mjs");
  writeFileSync(claim, JSON.stringify({ pid: process.pid, processStart: processStartToken(process.pid), nonce: "a".repeat(32), at: "2026-10-10T00:00:00.000Z", action: "stop" }) + "\n");
  const claimBytes = readFileSync(claim, "utf8");
  const intent = f.intent(i);
  writeFileSync(i.marker, JSON.stringify(intent, null, 2) + "\n");
  const before = listing(i.home);

  const r = f.complete(intent);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const outcome = readJson(i.result);
  assert.deepEqual({ ok: outcome.ok, code: outcome.error.code }, { ok: false, code: "E_LIFECYCLE_BUSY" });
  assert.ok(outcome.error.message.startsWith(`a stop of claimed is already running (pid ${process.pid}, `), outcome.error.message);
  assert.equal(readFileSync(claim, "utf8"), claimBytes, "the holder's claim is as it was");
  assert.equal(existsSync(i.marker), false, "the marker goes");
  assert.equal(oneRefusal(f, i.workspaceLog, outcome, false, "the workspace's log").incarnation, i.created);
  assert.deepEqual(listing(i.home), before, "the completion holds no claim, and changed no file of the home: its log among them");
  assert.equal(f.hookRuns(), 0);
});

test("only its own marker: one that names this completion's process goes (above), one whose named completion is gone goes, one that names another process that runs is left, and so is the marker a later --self wrote", async (t) => {
  const f = deployment(t);
  const parent = await f.spawn("parent"), kid = await f.child("kid", parent);
  f.unstoppable(kid);

  // The completion of the first scheduling sleeps for the whole test.
  const first = await f.schedule(parent, { delay: 600, children: [kid] });
  const firstMarker = readFileSync(parent.marker, "utf8");
  const { completionPid, completionStart, ...firstIntent } = JSON.parse(firstMarker);
  assert.equal(completionPid, first.completionPid);

  // Another process completes from the marker while the one it names runs: refused by that marker, which is left.
  const beside = f.complete(parent.marker);
  assert.equal(beside.status, 1, beside.stdout + beside.stderr);
  assert.equal(readJson(parent.result).error.code, "E_LIFECYCLE_BUSY");
  assert.ok(readJson(parent.result).error.message.startsWith(`a retire of parent is already scheduled (its completion, pid ${completionPid}, `), readJson(parent.result).error.message);
  assert.equal(readFileSync(parent.marker, "utf8"), firstMarker, "a marker that names another process that runs is left, as it was");
  assert.ok(!beside.stderr.includes("its pending marker is removed"), beside.stderr);

  // The named completion died: a completion run from its marker is this scheduling's, and the marker goes.
  await killAndReap(completionPid);
  const after = f.complete(parent.marker);
  assert.equal(after.status, 1, after.stdout + after.stderr);
  assert.equal(readJson(parent.result).error.code, "E_CHILDREN_RUNNING");
  assert.equal(existsSync(parent.marker), false, "a marker whose named completion is gone is removed");
  assert.ok(after.stderr.includes("its pending marker is removed; parent is not being retired"), after.stderr);

  // A later --self schedules again; its completion dies too. The first scheduling's completion,
  // arriving now, leaves that marker: it is another scheduling's.
  const second = await f.schedule(parent, { delay: 600, children: [kid] });
  const secondMarker = readFileSync(parent.marker, "utf8");
  assert.notEqual(JSON.parse(secondMarker).requestedAt, firstIntent.requestedAt, "fixture premise: the two schedulings differ in requestedAt");
  await killAndReap(second.completionPid);
  const late = f.complete(firstIntent);
  assert.equal(late.status, 1, late.stdout + late.stderr);
  assert.equal(readJson(parent.result).error.code, "E_CHILDREN_RUNNING");
  assert.equal(readFileSync(parent.marker, "utf8"), secondMarker, "the marker a later --self wrote is left, as it was");
  assert.ok(!late.stderr.includes("its pending marker is removed"), late.stderr);

  assert.deepEqual(f.refused(parent.workspaceLog).map((row) => [row.data.code, row.data.homeChanged]), [["E_LIFECYCLE_BUSY", false], ["E_CHILDREN_RUNNING", false], ["E_CHILDREN_RUNNING", false]], "one row for each completion that did not complete");
  assert.deepEqual(f.refused(parent.homeLog), [], "none in the home's log");
  assert.equal(f.hookRuns(), 0);
});

test("a marker whose named completion cannot be told gone is left; an older kernel's marker and intent follow the same rule, and neither the marker nor the event depends on the result file", async (t) => {
  const f = deployment(t);
  const { processStartToken } = await import("../lib/worktree-hooks.mjs");
  assert.equal(typeof processStartToken(process.pid), "string", "fixture premise: this host reads a process's start");

  // A pid that runs and whose start was not recorded: never taken for gone.
  const unknown = await f.spawn("unknown");
  const named = { ...f.intent(unknown), completionPid: process.pid, completionStart: null };
  writeFileSync(unknown.marker, JSON.stringify(named, null, 2) + "\n");
  const markerBytes = readFileSync(unknown.marker, "utf8");
  const refused = f.complete(f.intent(unknown));
  assert.equal(refused.status, 1, refused.stdout + refused.stderr);
  assert.equal(readJson(unknown.result).error.code, "E_LIFECYCLE_BUSY");
  assert.ok(readJson(unknown.result).error.message.includes("still runs cannot be read"), readJson(unknown.result).error.message);
  assert.equal(readFileSync(unknown.marker, "utf8"), markerBytes, "the marker is left, as it was");
  assert.deepEqual(f.refused(unknown.workspaceLog).map((row) => row.data.homeChanged), [false]);

  // An older kernel: no completion named in its marker, --delete-branch in its intent. Its result
  // file cannot be written: the directory it names is not there.
  const parent = await f.spawn("older"), kid = await f.child("kid", parent);
  f.unstoppable(kid);
  const intent = f.intent(parent, { children: [kid], resultPath: join(f.fx.base, "no-such-directory", "result.json") });
  intent.options.deleteBranch = true;
  writeFileSync(parent.marker, JSON.stringify(intent, null, 2) + "\n");
  const r = f.complete(intent);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(r.stderr.includes(`deferred retirement: cannot write ${intent.resultPath}`), r.stderr);
  assert.equal(existsSync(parent.marker), false, "the marker goes, with no result file written");
  assert.deepEqual([existsSync(parent.result), existsSync(intent.resultPath)], [false, false]);
  const rows = f.refused(parent.workspaceLog);
  assert.deepEqual(rows.map((row) => row.data), [{ code: "E_CHILDREN_RUNNING", homeChanged: false, reason: "kid could not be stopped (E_LIFECYCLE_BUSY); nothing was retired and nothing was escalated" }]);
  assert.deepEqual(f.refused(parent.homeLog), [], "none in the home's log");

  // An intent that names no home: the retire finds the instance by its name, and the completion
  // has no home to answer for. It touches no marker and writes no event, and says so.
  const nameless = await f.spawn("nameless"), other = await f.child("other", nameless);
  f.unstoppable(other);
  const noHome = f.intent(nameless, { children: [other] });
  delete noHome.options.home;
  writeFileSync(nameless.marker, JSON.stringify(noHome, null, 2) + "\n");
  const left = readFileSync(nameless.marker, "utf8");
  const answered = f.complete(noHome);
  assert.equal(answered.status, 1, answered.stdout + answered.stderr);
  assert.deepEqual([readJson(nameless.result).error.code, readJson(nameless.result).retry], ["E_CHILDREN_RUNNING", "oats retire nameless"]);
  assert.ok(answered.stderr.includes("deferred retirement of nameless: no retire-refused event was recorded: its intent names no home"), answered.stderr);
  assert.equal(readFileSync(nameless.marker, "utf8"), left, "no marker is touched");
  assert.deepEqual([f.refused(nameless.homeLog), f.refused(nameless.workspaceLog)], [[], []]);
});

test("a completion whose home is already gone: no hook and nothing removed by it, the row has no incarnation; an event that cannot be written is said in the log and changes nothing else", async (t) => {
  const f = deployment(t);
  const i = await f.spawn("vanished");
  const intent = f.intent(i);
  const retired = f.fx.cli(["retire", "vanished", "--json"]);
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.equal(existsSync(i.home), false, "fixture premise: the home is gone before the completion runs");
  writeFileSync(i.marker, JSON.stringify(intent, null, 2) + "\n");

  const r = f.complete(intent);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const outcome = readJson(i.result);
  assert.deepEqual({ ok: outcome.ok, code: outcome.error.code }, { ok: false, code: "E_SESSION_UNKNOWN" });
  assert.equal(existsSync(i.marker), false, "the marker goes");
  assert.equal(existsSync(i.home), false, "no home was made to hold a log");
  const row = oneRefusal(f, i.workspaceLog, outcome, false, "the workspace's log");
  assert.equal(row.incarnation, null, "there was no home to read an incarnation from");
  assert.deepEqual(f.kinds(i.workspaceLog).slice(-2), ["retired", "retire-refused"]);

  if (ROOT) return; // a mode does not keep root from appending
  // The one log there is cannot be appended to.
  chmodSync(i.workspaceLog, 0o444);
  try {
    writeFileSync(i.marker, JSON.stringify(intent, null, 2) + "\n");
    const unwritten = f.complete(intent);
    assert.equal(unwritten.status, 1, unwritten.stdout + unwritten.stderr);
    assert.ok(unwritten.stderr.includes("deferred retirement of vanished: its retire-refused event could not be written: "), unwritten.stderr);
    assert.ok(unwritten.stderr.includes("deferred retirement of vanished failed: "), "the completion went on to its end");
    assert.equal(readJson(i.result).error.code, "E_SESSION_UNKNOWN", "the outcome is written");
    assert.equal(existsSync(i.marker), false, "the marker goes");
    assert.equal(f.refused(i.workspaceLog).length, 1, "no second row");
  } finally { chmodSync(i.workspaceLog, 0o644); }
});

test("a scheduling that writes its marker after its completion has given up: it answers E_SELF_RETIRE_SCHEDULE_FAILED, and no marker, outcome or log is left; the instance does not read as retiring", async (t) => {
  const f = deployment(t);
  const i = await f.spawn("late");
  const before = listing(i.home);
  // Held before the marker's write, under the home's claim, with the completion already started.
  const run = f.scheduleGated(i, [{ name: "marker", fn: "writeFileSync", path: i.marker, when: "before", waitMs: COMPLETION_MS }]);
  try {
    await run.waitGate("marker", COMPLETION_MS);
    await f.gaveUp(i);
    const outcome = readJson(i.result);
    assert.equal(outcome.error.code, "E_LIFECYCLE_BUSY");
    assert.ok(outcome.error.message.startsWith(`a retire of late is already running (pid ${run.child.pid}, `), outcome.error.message);
    const row = oneRefusal(f, i.workspaceLog, outcome, false, "the workspace's log");
    assert.equal(existsSync(i.marker), false, "fixture premise: the completion found no marker to remove");

    run.release("marker");
    const done = await run.done;
    assert.deepEqual(done.timedOut, []);
    assert.equal(done.code, 1, done.stdout + done.stderr);
    assert.deepEqual(JSON.parse(done.stdout.trim()).error, { code: "E_SELF_RETIRE_SCHEDULE_FAILED",
      message: `could not start the deferred retirement of late: its completion gave up waiting for this command and has ended. Nothing was inspected, run, or removed; the instance is still live and can be retired externally with \`oats retire late --home ${i.home}\``,
      reached: { phase: "before-effects", sessionStopAttempted: false, hooksStarted: false, home: "kept", recovery: null } });
    assert.deepEqual([existsSync(i.marker), existsSync(i.result), existsSync(i.log)], [false, false, false], "the marker this scheduling wrote, the outcome and the log are removed: the answer is the outcome");
    const status = f.status(i);
    assert.equal(Object.hasOwn(status.row, "retirePending"), false, "oats status: the row has no retirePending");
    assert.deepEqual(status.failures, [], "and lists no failed deferred retirement: the scheduling answered its caller");
    assert.deepEqual(f.stopPlan(i).targets.map((target) => target.retiring), [false]);
    assert.deepEqual(f.refused(i.workspaceLog), [row], "the row the completion wrote stays: a completion did not complete");
    assert.deepEqual(listing(i.home), before, "no file of the home changed");
  } finally { await run.finish(); }
});

test("a scheduling still holding the claim when its completion gives up, its marker written: the completion sees the marker and removes it; the instance does not read as retiring", async (t) => {
  const f = deployment(t);
  const i = await f.spawn("slow");
  const lock = join(dirname(i.home), ".oats-retirement", "claims", "slow.lock");
  // Held before it releases the claim: the marker is written, and the look for an outcome found none.
  const run = f.scheduleGated(i, [{ name: "release", fn: "unlinkSync", path: lock, when: "before", waitMs: COMPLETION_MS }]);
  try {
    await run.waitGate("release", COMPLETION_MS);
    assert.equal(readJson(lock).pid, run.child.pid, "fixture premise: the scheduling still holds the home's claim");
    assert.equal(existsSync(i.marker), true, "fixture premise: the scheduling wrote its marker before its completion gave up");
    const pid = f.track(readJson(i.marker).completionPid);
    await f.gaveUp(i);
    const outcome = readJson(i.result);
    assert.equal(outcome.error.code, "E_LIFECYCLE_BUSY");
    assert.equal(existsSync(i.marker), false, "the completion saw its marker and removed it");
    assert.ok(readFileSync(i.log, "utf8").includes("its pending marker is removed; slow is not being retired"));

    run.release("release");
    const done = await run.done;
    assert.deepEqual(done.timedOut, []);
    assert.equal(done.code, 0, done.stdout + done.stderr);
    const receipt = JSON.parse(done.stdout.trim());
    assert.deepEqual([receipt.deferred, receipt.completionPid], [true, pid], "the scheduling answers what it saw: a completion was on its way");
    assert.equal(existsSync(i.marker), false, "no marker is left");
    const status = f.status(i);
    assert.equal(Object.hasOwn(status.row, "retirePending"), false, "oats status: the row has no retirePending");
    assert.deepEqual(status.failures.map((failure) => failure.error), [outcome.error.message], "and lists the completion's failure");
    assert.deepEqual(f.stopPlan(i).targets.map((target) => target.retiring), [false]);
    oneRefusal(f, i.workspaceLog, outcome, false, "the workspace's log");
  } finally { await run.finish(); }
});

test("a scheduling that fails before it wrote its marker leaves the marker that was there: it removes only the one it wrote", async (t) => {
  if (ROOT) { t.skip(SKIP_FOR_ROOT); return; }
  const f = deployment(t);
  const i = await f.spawn("earlier");
  // An earlier scheduling's marker, with its completion's outcome beside it: a new --self schedules
  // again. The marker cannot be written over.
  const earlier = JSON.stringify(f.intent(i), null, 2) + "\n";
  writeFileSync(i.marker, earlier);
  writeFileSync(i.result, JSON.stringify({ ok: false }) + "\n");
  chmodSync(i.marker, 0o444);
  try {
    await assert.rejects(f.scheduling(i), (e) => {
      assert.equal(e.code, "E_SELF_RETIRE_SCHEDULE_FAILED");
      assert.ok(e.message.includes("EACCES") && e.message.includes("the completion this command had started is not running"), e.message);
      return true;
    });
    assert.equal(readFileSync(i.marker, "utf8"), earlier, "the marker this scheduling did not write is left, as it was");
  } finally { chmodSync(i.marker, 0o644); }
});
