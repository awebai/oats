// The door, hardened (awebai/oats#892, with #874 item 3, #891 and #866). Every answer of the
// lifecycle verbs goes through one door (bin/oats.mjs lifecycleFail, lib/errors.mjs): a kernel code,
// and, for a retire, what the retire had done by then (`error.details.reached`). Three edges of
// that door, each through the real CLI:
//
//   - a scheduled self-retire (`oats retire <name> --self`) whose marker cannot be written, after
//     its detached completion was started: the completion is ended before the command answers, so
//     that "nothing was inspected, run, or removed" (`reached.phase: "before-effects"`) stays true
//     after the answer, for as long as the completion would have waited (awebai/oats#892);
//   - a stop whose tmux call fails (awebai/oats#891): a child process that exits non-zero is a
//     plain Error without a code, not a kernel defect. It is its target's row
//     (E_SESSION_STOP_FAILED), and no stack is printed. The same call failing with a TypeError, a
//     defect, does print its stack: that is the whole difference;
//   - an exception thrown once the kernel's retire has returned is not answered through the door:
//     an error envelope without `reached` would say that nothing was done, after a retire that
//     completed. It leaves the process as an uncaught exception. One statement earlier, inside the
//     kernel's retire, the same exception is one envelope with a kernel code and `reached`.
//
// How each failure is made, always at one named call of the kernel's own, never by the clock:
// the self-retire is held at the write of its marker (test/helpers/fs-gate-preload.mjs), where
// the test sees the completion it started and puts a directory where the marker belongs; the two
// others load a preload, written into the fixture, that makes one call throw.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { CLI, v2Deployment } from "./helpers/v2-deployment.mjs";
import { ensureOatsSocketDir, waitUntil } from "./helpers/host-fixture.mjs";
import { startGated } from "./helpers/fs-gate-preload.mjs";
import { deferredRetireResultPath, processesInHome, retirePendingMarkerPath } from "../lib/core.mjs";
import { processLiveness, processStart } from "../lib/worktree-hooks.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

/** Every entry under `dir`, one row each: its path, its mode, and a file's bytes (as a digest) or a
 *  link's target. */
function listing(dir, rel = "") {
  const rows = [];
  for (const name of readdirSync(join(dir, rel)).sort()) {
    const at = join(rel, name), abs = join(dir, at), st = lstatSync(abs);
    const mode = (st.mode & 0o7777).toString(8);
    if (st.isSymbolicLink()) rows.push(`${at} -> ${readlinkSync(abs)}`);
    else if (st.isDirectory()) rows.push(`${at}/ ${mode}`, ...listing(dir, at));
    else if (st.isFile()) rows.push(`${at} ${mode} ${sha(readFileSync(abs))}`);
    else rows.push(`${at} ${mode} (not a file)`);
  }
  return rows;
}

/** A retire hook that appends the home it ran for to `<agents root>/retire-hook.log`, outside every home. */
const HOOK = `import { appendFileSync } from "node:fs";
import { join } from "node:path";
appendFileSync(join(process.env.OATS_ROOT, "retire-hook.log"), process.env.OATS_INSTANCE_HOME + "\\n");
console.log(JSON.stringify({ meta: { retired: true } }));
`;

/** A deployment whose soul `dev` has a capability with that retire hook. `add(name)` spawns an
 *  instance of it (no launch) → what a test reads of it. */
function deployment(t) {
  const fx = v2Deployment({ t,
    souls: { dev: { soul: { work: "directory", capabilities: { "test.retire": { from: "here" } } } } },
    capabilities: { "test.retire": { manifest: { hooks: { retire: "hook.mjs" } }, files: { "hook.mjs": HOOK } } },
  });
  const add = async (name) => {
    // An in-process spawn finds its harness on this process's PATH: the fixture's inert ones.
    const hostPath = process.env.PATH;
    process.env.PATH = fx.env.PATH;
    let home;
    try { ({ home } = await fx.spawn("dev", { name, work: "directory" })); } finally { process.env.PATH = hostPath; }
    assert.equal(home, join(fx.root, "dev", "instances", name));
    const instances = dirname(home);
    const retirement = join(instances, ".oats-retirement");
    return {
      fx, name, home, instances, retirement,
      /** How many times the retire hook ran for this home. */
      hookRuns: () => { try { return readFileSync(join(fx.root, "retire-hook.log"), "utf8").split("\n").filter((line) => line === home).length; } catch (e) { if (e.code === "ENOENT") return 0; throw e; } },
      /** What is in the recovery directory of its agent: a retire's copies, and (named `.…`) one left half-made. */
      recoveries: () => { try { return readdirSync(join(retirement, "recovery")).sort(); } catch (e) { if (e.code === "ENOENT") return []; throw e; } },
      /** The kinds of its events in the workspace log, in order. */
      events: () => { try { return readFileSync(join(fx.dep, ".agents", "events", `dev--${name}.jsonl`), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line).kind); } catch (e) { if (e.code === "ENOENT") return []; throw e; } },
    };
  };
  return { fx, add };
}

/** Run a stand-in harness for the instance `w` in a window of the fixture's own `oats` tmux server
 *  (its private TMUX_TMPDIR, which its cleanup kills by socket), and record the home as launched
 *  there, in instance.json and in the independent session receipt (the spawn's retirement
 *  baseline), which is the authority of a stop. The harness idles and ends on SIGTERM; whatever is
 *  left of it is ended before the fixture's cleanup. → { pid, socket, session, window }. */
async function launchHarness(w) {
  const { fx, home, name } = w;
  const socket = ensureOatsSocketDir(fx.env.TMUX_TMPDIR);
  const session = "door";
  const tmux = (...args) => execFileSync("tmux", ["-f", "/dev/null", "-u", "-S", socket, ...args], { encoding: "utf8", timeout: 10000, env: { ...fx.env, SHELL: "/bin/sh" }, stdio: ["ignore", "pipe", "pipe"] }).trim();
  const pidFile = join(fx.base, `harness-${name}.pid`), harness = join(fx.base, `harness-${name}`), launcher = join(fx.base, `launcher-${name}`);
  // The harness says which process it is, then idles; the pane's launcher runs it and stays as the
  // pane's shell once it has ended.
  writeFileSync(harness, `#!/bin/sh\necho $$ > '${pidFile}'\nexec sleep 86400\n`);
  writeFileSync(launcher, `#!/bin/sh\n'${harness}'\nexec /bin/sh\n`);
  for (const script of [harness, launcher]) chmodSync(script, 0o755);
  const endpoint = { session, window: name, socket };
  const metaPath = join(home, "instance.json");
  writeFileSync(metaPath, JSON.stringify({ ...readJson(metaPath), launched: true, tmux: endpoint }, null, 2) + "\n");
  const baselinePath = join(w.retirement, "baselines", `${sha(home)}.json`);
  writeFileSync(baselinePath, JSON.stringify({ ...readJson(baselinePath), runtime: { launched: true, tmux: endpoint } }, null, 2) + "\n");
  let hasSession = true;
  try { tmux("has-session", "-t", `=${session}`); } catch { hasSession = false; }
  if (!hasSession) tmux("new-session", "-d", "-s", session, "-n", "keeper", "-c", fx.base, "sleep 600");
  tmux("new-window", "-d", "-t", `${session}:`, "-n", name, "-c", home, launcher);
  const harnessPid = () => { try { const text = readFileSync(pidFile, "utf8").trim(); return /^\d+$/.test(text) && Number(text) > 1 ? Number(text) : null; } catch { return null; } };
  await waitUntil(() => harnessPid() !== null && alive(harnessPid()), "the stand-in harness to run");
  const pid = harnessPid();
  fx.beforeCleanup(() => { try { process.kill(pid, "SIGKILL"); } catch { /* it has ended */ } });
  /** Whether the instance's window is still on the fixture's server. */
  const windowPresent = () => tmux("list-windows", "-t", `=${session}`, "-F", "#{window_name}").split("\n").includes(name);
  return { pid, socket, session, window: name, windowPresent };
}

/** The plan of `oats instance stop <name>`, read once its pane reads as a running harness (the
 *  session's state is part of the plan's revision). */
async function stopPlanOfRunning(fx, name) {
  let plan;
  await waitUntil(() => {
    const r = fx.cli(["instance", "stop", name, "--plan", "--json"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    plan = r.json().result;
    const s = plan.targets[0].session;
    return s.present === true && s.state !== "shell";
  }, `the session of ${name} to read as running`);
  return plan;
}

/** The real CLI with `preload` loaded before it, as fx.cli runs the CLI. */
const cliWith = (fx, preload, args) => spawnSync(process.execPath, ["--import", pathToFileURL(preload).href, CLI, ...args], { cwd: fx.dep, env: fx.env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });

/** The one error of a CLI run that failed with `--json`: exit 1 and exactly one envelope on stdout. */
function refusal({ status, stdout, stderr }) {
  assert.equal(status, 1, `exit status\nstdout: ${stdout}\nstderr: ${stderr}`);
  const lines = stdout.trim().split("\n");
  assert.equal(lines.length, 1, `exactly one envelope on stdout: ${stdout}`);
  const envelope = JSON.parse(lines[0]);
  assert.equal(envelope.schemaVersion, 1);
  assert.equal(envelope.ok, false);
  assert.equal(typeof envelope.error.message, "string");
  return envelope.error;
}

/** A JavaScript stack: the frames of one, anywhere in `text`. */
const FRAME = /^\s+at .+:\d+:\d+\)?$/m;

// ---- A. a scheduled self-retire whose marker cannot be written ----

/** A process as it is found: its pid and when it started, so that a pid given to another process
 *  later is never taken for it. */
const identified = (pid) => ({ pid, processStart: processStart(pid).token ?? null });
/** Whether that process still runs. One that has ended and waits for its parent to read its exit
 *  status (a zombie, which /proc shows as state Z) has ended: it runs nothing. Anything that cannot
 *  be told reads as still running. */
function stillRuns(proc) {
  if (processLiveness(proc).state === "gone") return false;
  try { const stat = readFileSync(`/proc/${proc.pid}/stat`, "utf8"); return !stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z"); } catch { return alive(proc.pid); }
}

/** The pids of the processes that work in `dir` (the kernel's own scan: /proc, else lsof), but for
 *  this process and its direct children. */
function workingIn(dir) {
  const scan = processesInHome(dir);
  assert.equal(scan.ok, true, `the process scan: ${scan.error}`);
  return scan.processes.map((p) => p.pid);
}

/** `oats retire <name> --self --json`, run as the instance itself (the CLI knows the caller by
 *  OATS_INSTANCE and OATS_INSTANCE_HOME) and held at the write of the pending marker: the last step
 *  of the scheduling, after the detached completion was started. While the command is held, the
 *  completion is the one process that has appeared in the instances directory, where the kernel
 *  starts it: found by the kernel's own process scan, never by a name. `whileHeld(completion)` then
 *  does what the test wants done at that moment, and the command goes on.
 *  → { status, stdout, stderr, completion: { pid, processStart }, heldAt } */
async function selfRetireHeldAtMarker(w, { whileHeld = () => {} } = {}) {
  const { fx, name, home, instances } = w;
  const before = new Set(workingIn(instances));
  const run = startGated([CLI, "retire", name, "--self", "--json"], { cwd: fx.dep, env: { ...fx.env, OATS_INSTANCE: name, OATS_INSTANCE_HOME: home },
    gateDir: join(fx.base, `gate-${name}`), gates: [{ name: "marker", fn: "writeFileSync", path: retirePendingMarkerPath(home) }] });
  let completion, heldAt;
  try {
    await run.waitGate("marker");
    heldAt = Date.now();
    const appeared = workingIn(instances).filter((pid) => !before.has(pid));
    assert.equal(appeared.length, 1, `one process appeared in ${instances} while the retire was held at its marker: ${appeared.join(", ")}`);
    completion = identified(appeared[0]);
    fx.beforeCleanup(() => { if (stillRuns(completion)) process.kill(completion.pid, "SIGKILL"); });
    assert.equal(stillRuns(completion), true, "the completion was started, and runs, before the marker is written");
    // Where /proc shows a command line: it is the kernel's completion script.
    let commandLine = null;
    try { commandLine = readFileSync(`/proc/${completion.pid}/cmdline`, "utf8"); } catch { /* no /proc here */ }
    if (commandLine !== null) assert.match(commandLine, /--input-type=module[\s\S]*completeDeferredRetirement/, commandLine);
    whileHeld(completion);
    run.release("marker");
    const { code, stdout, stderr, timedOut } = await run.done;
    assert.deepEqual(timedOut, [], "the gate was released in time");
    return { status: code, stdout, stderr, completion, heldAt };
  } finally { await run.finish(); }
}

// SLOW ON PURPOSE (about 11 s): the test watches the instance for as long as a completion that had
// survived would have waited before it acted. That delay is the kernel's own (8 s) and the CLI has
// no flag for it. Nothing here sleeps to synchronise: the wait is a poll of the invariants until
// the delay has passed.
test("a self-retire that cannot write its marker ends the completion it had started: E_SELF_RETIRE_SCHEDULE_FAILED before-effects, no completion, result or log left, and the instance and its session untouched once the completion's delay has passed", async (t) => {
  const { fx, add } = deployment(t);

  // The control: the same command, held at the same call, with nothing done while it is held. It
  // schedules, and its answer names the completion that this test found while it was held.
  const ctl = await add("ctl");
  await launchHarness(ctl);
  const scheduled = await selfRetireHeldAtMarker(ctl);
  assert.equal(scheduled.status, 0, scheduled.stderr + scheduled.stdout);
  const receipt = JSON.parse(scheduled.stdout);
  assert.equal(receipt.deferred, true);
  assert.equal(receipt.retired, "ctl");
  assert.equal(receipt.completionPid, scheduled.completion.pid, "the process found while the command was held is the completion its answer names");
  assert.equal(receipt.pendingMarker, retirePendingMarkerPath(ctl.home));
  assert.equal(readJson(receipt.pendingMarker).completionPid, scheduled.completion.pid, "and the one its marker names");
  // How long a completion waits before it acts: the kernel's own word (the CLI has no flag for it).
  const delayMs = receipt.completesInSec * 1000;
  assert.ok(Number.isFinite(delayMs) && delayMs > 0, `completesInSec: ${receipt.completesInSec}`);
  // The control's completion is ended here, long before it would act: nothing is left running.
  assert.equal(stillRuns(scheduled.completion), true, "the control's completion waits for its delay");
  process.kill(scheduled.completion.pid, "SIGKILL");
  await waitUntil(() => !stillRuns(scheduled.completion), "the control's completion to be gone");
  assert.equal(existsSync(ctl.home), true);
  assert.equal(ctl.hookRuns(), 0);

  // The case: the same command on an instance of the same shape. While it is held, a directory is
  // put where the marker belongs: the write the kernel makes next fails (EISDIR, for root too), and
  // that is the only difference.
  const w = await add("a1");
  const session = await launchHarness(w);
  const { name, home, instances } = w;
  const marker = retirePendingMarkerPath(home), resultPath = deferredRetireResultPath(home), logPath = resultPath.replace(/\.json$/, ".log");
  const before = listing(home);
  const besideBefore = readdirSync(instances).sort();
  const eventsBefore = w.events();
  const failed = await selfRetireHeldAtMarker(w, { whileHeld: () => mkdirSync(marker) });

  // 1. The answer.
  const error = refusal(failed);
  assert.equal(error.code, "E_SELF_RETIRE_SCHEDULE_FAILED");
  const lead = `could not start the deferred retirement of ${name}: `;
  const tail = `; the completion this command had started is not running. Nothing was inspected, run, or removed; the instance is still live and can be retired externally with \`oats retire ${name} --home ${home}\``;
  assert.ok(error.message.startsWith(lead), error.message);
  assert.ok(error.message.endsWith(tail), error.message);
  const system = error.message.slice(lead.length, -tail.length);
  assert.match(system, /^EISDIR\b/, `the system's text: ${error.message}`);
  assert.ok(system.includes(marker), `which names the marker: ${error.message}`);
  assert.deepEqual(error.details.reached, { phase: "before-effects", sessionStopAttempted: false, hooksStarted: false, home: "kept", recovery: null });
  assert.doesNotMatch(failed.stderr, FRAME, `a system error is no defect: no stack\n${failed.stderr}`);

  // 2. No completion process is alive: the one seen running before the marker's write was ended.
  await waitUntil(() => !stillRuns(failed.completion), `the completion (pid ${failed.completion.pid}) to be gone`);
  assert.equal(workingIn(instances).includes(failed.completion.pid), false, "and it no longer works in the instances directory");

  // The directory this test put at the marker's path is the test's own: removed, so that what is
  // beside the home is the kernel's doing alone.
  assert.equal(lstatSync(marker).isDirectory(), true, "fixture premise: the kernel did not write over the directory");
  assert.deepEqual(readdirSync(marker), []);
  rmSync(marker, { recursive: true });

  // 3 and 4. Neither a result nor a log beside the home, and the instance as before: at once, and
  // for as long as a completion that had survived would have waited before it acted. The clock is
  // the completion's own: its process existed at `heldAt`, so it would have begun its delay once it
  // had loaded the kernel, and acted `delay` later, the home's claim long released. The margin is
  // for that load and for what it does to be seen.
  const asBefore = (when) => {
    assert.equal(stillRuns(failed.completion), false, `${when}: no completion runs`);
    assert.equal(existsSync(resultPath), false, `${when}: no result file`);
    assert.equal(existsSync(logPath), false, `${when}: no log`);
    assert.deepEqual(readdirSync(instances).sort(), besideBefore, `${when}: nothing new beside the home`);
    assert.deepEqual(readdirSync(join(w.retirement, "claims")), [], `${when}: the retire released the home's claim, and the completion left none of its own`);
    assert.deepEqual(listing(home), before, `${when}: the home is as it was, byte for byte`);
    assert.equal(w.hookRuns(), 0, `${when}: no retire hook ran`);
    assert.deepEqual(w.recoveries(), [], `${when}: no recovery copy`);
    assert.deepEqual(w.events(), eventsBefore, `${when}: no event, and no retired event`);
    assert.equal(alive(session.pid), true, `${when}: its harness runs`);
  };
  asBefore("when the command has answered");
  const deadline = failed.heldAt + delayMs + 2000;
  while (Date.now() <= deadline) {
    asBefore("while the completion's delay passes");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  asBefore("once the completion's delay has passed");
  assert.equal(w.events().includes("retired"), false);
  assert.equal(session.windowPresent(), true, "its window is still on the server");

  // "The instance is still live and can be retired externally with `oats retire <name> --home <home>`".
  const external = fx.cli(["retire", name, "--home", home, "--json"]);
  assert.equal(external.status, 0, external.stderr + external.stdout);
  assert.equal(JSON.parse(external.stdout).retired, name);
  assert.equal(existsSync(home), false, "the external retire removes the home");
  assert.equal(w.hookRuns(), 1, "and runs its retire hook, once");
});

// ---- B. a stop whose tmux call fails ----

/** A preload that makes ONE call of a stop fail: the `tmux … list-panes … -F #{pane_pid}` that only
 *  the step that signals the harness makes (lib/core.mjs harnessProcesses), after the plan was made
 *  and the stop has begun. `thrown` is the expression it throws there; every other call is the
 *  original. → its path. */
function failingPanePid(fx, file, thrown) {
  const preload = join(fx.base, file);
  writeFileSync(preload, `// Written by test/lifecycle-door-hardening.test.mjs.
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
const execFileSync = cp.execFileSync;
cp.execFileSync = function (file, args, ...rest) {
  if (file === "tmux" && Array.isArray(args) && args.includes("list-panes") && args[args.length - 1] === "#{pane_pid}") {
    const command = [file, ...args].join(" ");
    throw ${thrown};
  }
  return execFileSync.call(this, file, args, ...rest);
};
syncBuiltinESMExports();
`);
  return preload;
}
/** What tmux says on stderr when it fails, here. */
const TMUX_STDERR = "tmux: failed by the test preload\n";
/** The error Node's execFileSync throws for a child that exits non-zero (node:child_process
 *  checkExecSyncError): `Command failed: <command>` and the child's stderr as its message, the
 *  child's status and output as properties, and NO `code`. */
const CHILD_FAILED = `Object.assign(new Error("Command failed: " + command + "\\n" + ${JSON.stringify(TMUX_STDERR)}), { status: 1, signal: null, pid: 0, output: [null, "", ${JSON.stringify(TMUX_STDERR)}], stdout: "", stderr: ${JSON.stringify(TMUX_STDERR)} })`;
const DEFECT = `new TypeError("boom from the test preload")`;

test("instance stop --apply whose tmux call exits non-zero: the target is E_SESSION_STOP_FAILED in the receipt, naming the failed command, and no stack is printed; the same call failing with a TypeError prints its stack", async (t) => {
  const { fx, add } = deployment(t);
  const w = await add("b1");
  const { home, name } = w;
  const session = await launchHarness(w);
  const plan = await stopPlanOfRunning(fx, name);
  assert.deepEqual(plan.targets.map((target) => target.instance), [name]);
  const command = `tmux -u -S ${session.socket} list-panes -t =${session.session}:=${name} -F #{pane_pid}`;
  // The stop fails before it signals anything, and says that it does not know: it had reached the
  // step that signals, and that step gave no answer.
  const HARNESS = "whether its harness was signalled is not known";
  const apply = (preload, key) => cliWith(fx, preload, ["instance", "stop", name, "--apply", "--plan-revision", plan.planRevision, "--idempotency-key", key, "--json"]);
  /** The one target's row of an applied stop that answered its receipt: exit 0, one envelope, `ok: false` in the receipt. */
  const row = (r) => {
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const lines = r.stdout.trim().split("\n");
    assert.equal(lines.length, 1, `exactly one envelope on stdout: ${r.stdout}`);
    const envelope = JSON.parse(lines[0]);
    assert.equal(envelope.schemaVersion, 1);
    assert.equal(envelope.ok, true, "an applied stop answers its receipt, whatever its targets did");
    const receipt = envelope.result;
    assert.equal(receipt.ok, false);
    assert.equal(receipt.results.length, 1);
    const [result] = receipt.results;
    assert.deepEqual(Object.keys(result).sort(), ["code", "home", "instance", "message", "ok", "stillRunning"], "no new field in a target's result");
    assert.equal(result.instance, name);
    assert.equal(result.home, home);
    assert.equal(result.ok, false);
    assert.equal(result.code, "E_SESSION_STOP_FAILED");
    // No receipt of the step that signals: nothing was established of the harness.
    assert.equal(result.stillRunning, null);
    assert.doesNotMatch(r.stdout, /\bat .*:\d+:\d+|"stack"|core\.mjs/, `the answer carries no stack: ${r.stdout}`);
    return result;
  };
  /** What the row's last sentence leaves open, as it is: the harness was not signalled, and runs. */
  const untouched = (when) => {
    assert.equal(alive(session.pid), true, `${when}: the stand-in harness still runs`);
    assert.equal(session.windowPresent(), true, `${when}: in its window`);
    assert.equal(existsSync(join(home, ".oats-stop.json")), false, `${when}: the stop wrote no record of a stop`);
    assert.equal(w.events().some((kind) => kind === "stopped" || kind === "stop-refused"), false, `${when}: and no event of one`);
  };

  // The child process that failed: a plain Error without a code.
  const failed = apply(failingPanePid(fx, "tmux-exits-non-zero.mjs", CHILD_FAILED), "k1");
  const result = row(failed);
  assert.ok(result.message.startsWith(`${name}: `), result.message);
  assert.ok(result.message.includes(`Command failed: ${command}`), `the failed command's text: ${result.message}`);
  assert.ok(result.message.includes(TMUX_STDERR.trim()), `and what it said: ${result.message}`);
  assert.ok(result.message.endsWith(`; ${HARNESS}`), result.message);
  assert.doesNotMatch(failed.stderr, FRAME, `no stack on stderr: ${failed.stderr}`);
  assert.doesNotMatch(failed.stderr, /Error:/, `and no error line: ${failed.stderr}`);
  assert.equal(failed.stderr, "", "nothing at all on stderr");
  untouched("after the stop whose tmux call failed");

  // The contrast: the same stop of the same harness under the same plan, the same call failing,
  // with a TypeError. A defect prints its stack; the row differs by its text alone.
  const defect = apply(failingPanePid(fx, "tmux-call-defect.mjs", DEFECT), "k2");
  assert.deepEqual(row(defect), { ...result, message: `${name}: boom from the test preload; ${HARNESS}` });
  assert.match(defect.stderr, /^TypeError: boom from the test preload\n(?: {4}at .+\n)+/m, `the stack of the exception is on stderr: ${defect.stderr}`);
  untouched("after the stop that met a defect");
});

// ---- C. an exception after the retire has returned ----

/** A preload that throws a TypeError from something `oats retire <name>` does once the kernel's
 *  retire has returned: the print of its receipt (`console.log` of the receipt's JSON, or of the
 *  text mode's `Retired <name> …`). `console.log` itself is replaced: Node's console swallows what
 *  the stream's write throws. `thrown` is the source of what it throws (default: that TypeError).
 *  → its path. */
function throwsAfterTheRetire(fx, name, thrown = 'new TypeError("boom after the retire")') {
  const preload = join(fx.base, `throws-after-the-retire-of-${name}.mjs`);
  writeFileSync(preload, `// Written by test/lifecycle-door-hardening.test.mjs.
const name = ${JSON.stringify(name)};
const log = console.log;
const isReceipt = (text) => { try { return JSON.parse(text).retired === name; } catch { return false; } };
console.log = function (...args) {
  const [first] = args;
  if (typeof first === "string" && (first.startsWith("Retired " + name + " ") || isReceipt(first))) throw ${thrown};
  return log.apply(this, args);
};
`);
  return preload;
}
/** The same shape, one statement before the kernel's retire returns: the removal of the home
 *  (`rmSync(<home>, …)`, the last thing a retire does to it) throws the TypeError. → its path. */
function throwsBeforeTheRetireReturns(fx, home) {
  const preload = join(fx.base, "throws-before-the-retire-returns.mjs");
  writeFileSync(preload, `// Written by test/lifecycle-door-hardening.test.mjs.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const home = ${JSON.stringify(home)};
const rmSync = fs.rmSync;
fs.rmSync = function (path, ...rest) {
  if (String(path) === home) throw new TypeError("boom before the retire returned");
  return rmSync.call(this, path, ...rest);
};
syncBuiltinESMExports();
`);
  return preload;
}

test("an exception thrown after the retire has returned is not answered through the door, nor, when it is one of the two typed failures (unsafe-config-key, unsafe-config-value), under its own name: the home is retired, stdout holds no error envelope, and the process ends as an uncaught exception, in JSON mode and in text mode; thrown before the retire returns, it is one envelope with a kernel code and reached", async (t) => {
  const { fx, add } = deployment(t);
  const AFTER = /^TypeError: boom after the retire\n(?: {4}at .+\n)+/m;

  for (const [mode, flags] of [["JSON mode", ["--json"]], ["text mode", []]]) {
    const w = await add(mode === "JSON mode" ? "c1" : "c2");
    const r = cliWith(fx, throwsAfterTheRetire(fx, w.name), ["retire", w.name, ...flags]);
    const said = `${mode}\n  exit status: ${r.status}\n  stdout: ${r.stdout}\n  stderr: ${r.stderr}`;
    // The retire completed: the kernel's retire had returned its receipt.
    assert.equal(existsSync(w.home), false, `the home is removed: ${said}`);
    assert.equal(w.hookRuns(), 1, `its retire hook ran, once: ${said}`);
    assert.equal(w.events().filter((kind) => kind === "retired").length, 1, `its retired event is recorded: ${said}`);
    // No error answer: one without \`reached\` would say that nothing was done.
    assert.doesNotMatch(r.stdout, /"ok"\s*:\s*false|"error"\s*:|"code"\s*:\s*"E_|E_LIFECYCLE_FAILED/, `no error envelope on stdout: ${said}`);
    assert.equal(r.stdout, "", `the print that threw is the first one, so nothing is on stdout: ${said}`);
    // The process ended as an uncaught exception: not the door's exit, which prints `oats: <message>`
    // in text mode and nothing but the stack of a defect in JSON mode.
    assert.notEqual(r.status, 0, said);
    assert.equal(r.signal, null, said);
    assert.match(r.stderr, AFTER, `the exception and its stack are on stderr: ${said}`);
    assert.match(r.stderr, /^ {4}at retireCmd /m, `thrown from the retire command, after the kernel's retire: ${said}`);
    assert.doesNotMatch(r.stderr, /^oats: /m, `the door did not answer it: ${said}`);
  }

  // An error the CLI answers under its own name wherever it comes from (unsafe-config-key,
  // unsafe-config-value) is no exception to that: after the retire has returned it is a crash too,
  // not `{"ok":false,"error":{"code":"unsafe-config-key",…}}` of a home that is gone.
  let n = 0;
  for (const code of ["unsafe-config-key", "unsafe-config-value"]) {
    for (const [mode, flags] of [["JSON mode", ["--json"]], ["text mode", []]]) {
      const w = await add(`own${++n}`);
      const thrown = `Object.assign(new Error("a typed refusal after the retire"), { code: ${JSON.stringify(code)} })`;
      const r = cliWith(fx, throwsAfterTheRetire(fx, w.name, thrown), ["retire", w.name, ...flags]);
      const said = `${code}, ${mode}\n  exit status: ${r.status}\n  stdout: ${r.stdout}\n  stderr: ${r.stderr}`;
      assert.equal(existsSync(w.home), false, `the home is removed: ${said}`);
      assert.equal(w.hookRuns(), 1, `its retire hook ran, once: ${said}`);
      assert.equal(r.stdout, "", `no envelope, of any code, on stdout: ${said}`);
      assert.notEqual(r.status, 0, said);
      assert.equal(r.signal, null, said);
      assert.match(r.stderr, /^Error: a typed refusal after the retire\n(?: {4}at .+\n)+/m, `the exception and its stack are on stderr: ${said}`);
      assert.match(r.stderr, /^ {4}at retireCmd /m, `thrown from the retire command, after the kernel's retire: ${said}`);
      assert.doesNotMatch(r.stderr, /^oats: /m, `no handler of typed failures answered it: ${said}`);
    }
  }

  // The counter-case: the same exception from the last step of the kernel's retire, before it has
  // returned, is the door's to answer, with what the retire had done by then.
  const w = await add("c3");
  const r = cliWith(fx, throwsBeforeTheRetireReturns(fx, w.home), ["retire", w.name, "--json"]);
  const error = refusal(r);
  assert.equal(error.code, "E_LIFECYCLE_FAILED");
  assert.deepEqual(error.details.cause, { name: "TypeError" });
  assert.deepEqual(error.details.reached, { phase: "removal", sessionStopAttempted: false, hooksStarted: true, home: "partial", recovery: null });
  assert.equal(error.message, `${w.name}: the directory at ${w.home} could not be removed: boom before the retire returned. The retire hooks have run; it wrote no recovery; its retired event is recorded; what is left at ${w.home} may not be a whole instance home; this retire stopped no session.`);
  assert.match(r.stderr, /^TypeError: boom before the retire returned\n(?: {4}at .+\n)+/m, `a defect: its stack is on stderr: ${r.stderr}`);
  assert.doesNotMatch(r.stdout, /\bat .*:\d+:\d+|"stack"|core\.mjs/, `the answer carries no stack: ${r.stdout}`);
  // What `reached` says, on disk.
  assert.equal(lstatSync(w.home).isDirectory(), true, "home: partial, the directory is still there");
  assert.equal(w.hookRuns(), 1, "hooksStarted: true, and the retire hook ran exactly once");
  assert.deepEqual(w.recoveries(), [], "recovery: null, and none was written");
  assert.equal(w.events().filter((kind) => kind === "retired").length, 1, "its retired event is recorded");
});
