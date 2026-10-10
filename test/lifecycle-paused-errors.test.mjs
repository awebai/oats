// What a retire answers when the home changes under one of its three inspections, and what it says
// it had done by then (awebai/oats#892; the kernel codes of the lifecycle verbs: #874 item 3, #891).
//
// A retire inspects the home and its work three times: before anything, after the session stop and
// after the retire hooks. Each inspection walks the home: it lists a directory, then reads each
// entry. An entry that another writer removes between the listing and the read used to be answered
// with Node's own code, `{"error":{"code":"ENOENT"}}`, and no word on how far the retire had got.
// It is now one envelope with a kernel code, E_WORK_INSPECTION_FAILED, the system error under
// `details.cause`, the retire's own statement as the last sentence of the message, and
// `details.reached`: the phase, whether a session stop was attempted, whether the hooks were
// started, what is at the home, and the recovery on disk.
//
// The window between the listing and the read is a few microseconds, so no test can hit it by
// timing. Each case runs the real CLI as a child that is HELD at the walk's own `lstatSync` of one
// file (test/helpers/fs-gate-preload.mjs: a pause, and nothing else; written for the reproduction
// of #866), removes the file, and lets the retire go on. The last tests pin the pause itself.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CLI, v2Deployment } from "./helpers/v2-deployment.mjs";
import { fixtureBase, waitUntil } from "./helpers/host-fixture.mjs";
import { startGated } from "./helpers/fs-gate-preload.mjs";

/** A capability whose retire hook records each run in `<agents root>/retire-hook-ran`, outside the home. */
const recordingHook = {
  manifest: { hooks: { retire: "hook.mjs" } },
  files: { "hook.mjs": `import { appendFileSync } from "node:fs";\nimport { join } from "node:path";\nappendFileSync(join(process.env.OATS_ROOT, "retire-hook-ran"), "ran\\n");\n` },
};
const GONE = "the second writer removes this\n";

/** Every entry under `root`, with its kind, its permission bits and its bytes (a link's target). */
function listing(root) {
  const entries = {};
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name), at = rel ? `${rel}/${name}` : name, st = lstatSync(path);
      const mode = (st.mode & 0o7777).toString(8);
      if (st.isSymbolicLink()) entries[at] = `link ${mode} ${readlinkSync(path)}`;
      else if (st.isDirectory()) { entries[`${at}/`] = `dir ${mode}`; walk(path, at); }
      else entries[at] = `file ${mode} ${readFileSync(path, "latin1")}`; // latin1: one character per byte
    }
  };
  walk(root, "");
  return entries;
}

/** A deployment with one spawned instance `name` (work: directory, not launched) whose home holds
 *  `notes/gone.md`: the home has changed since its spawn, and the file is what a walk is held at. */
async function instance(t, name) {
  const fx = v2Deployment({ t, souls: { dev: { soul: { capabilities: { "test.recording": { from: "here" } } } } }, capabilities: { "test.recording": recordingHook } });
  const { home } = await fx.spawn("dev", { name });
  const gone = join(home, "notes", "gone.md");
  mkdirSync(dirname(gone));
  writeFileSync(gone, GONE);
  const hookLog = join(fx.root, "retire-hook-ran");
  const recoveryRoot = join(dirname(home), ".oats-retirement", "recovery");
  const recoveryEntries = () => (existsSync(recoveryRoot) ? readdirSync(recoveryRoot) : []);
  return {
    fx, name, home, gone, hookLog, recoveryRoot,
    /** `oats retire <name> --json` as a child held at `gate`, a gate on the walk's lstatSync of the file. */
    retireHeldAt: (gate) => startGated([CLI, "retire", name, "--json"], { cwd: fx.dep, env: fx.env, gateDir: join(fx.base, "gates"), gates: [{ name: "walk", fn: "lstatSync", path: gone, when: "before", ...gate }] }),
    hookRuns: () => (existsSync(hookLog) ? readFileSync(hookLog, "utf8").split("\n").filter(Boolean).length : 0),
    /** This instance's recoveries, and the staging directories a copy in progress leaves (a name that starts with a dot). */
    recoveries: () => recoveryEntries().filter((entry) => entry.startsWith(`${name}-`)),
    staging: () => recoveryEntries().filter((entry) => entry.startsWith(".")),
  };
}

/** Hold the retire at its gate, remove the file as a second writer would, let the retire go on.
 *  → { result, atStart, atGate }: the child's result, and the home's listing before the retire
 *  started and at the gate, before the removal. */
async function retireWhileTheFileVanishes(w, gate, atTheGate = () => {}) {
  const atStart = listing(w.home);
  const run = w.retireHeldAt(gate);
  try {
    await run.waitGate("walk");
    assert.equal(run.child.exitCode, null, "the retire is held, not finished");
    atTheGate();
    const atGate = listing(w.home);
    rmSync(w.gone);
    run.release("walk");
    const result = await run.done;
    assert.deepEqual(result.timedOut, [], "the gate was released in time: the retire did not go on by itself");
    return { result, atStart, atGate };
  } finally { await run.finish(); }
}

/** The one error envelope of a refused command: exit 1, one line on stdout, no stack on stderr. */
function refusal(result) {
  assert.equal(result.code, 1, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  const lines = result.stdout.trim().split("\n");
  assert.equal(lines.length, 1, `exactly one envelope on stdout: ${result.stdout}`);
  const envelope = JSON.parse(lines[0]);
  assert.equal(envelope.schemaVersion, 1);
  assert.equal(envelope.ok, false);
  assert.doesNotMatch(result.stderr, /^\s+at /m, "a system error is not a defect: no stack is printed");
  return envelope.error;
}
/** The error of an inspection that met the vanished file: the kernel's code, the system error as
 *  its cause and in its text, and `statement` as the last sentence. */
function assertInspectionFailed(error, w, statement) {
  assert.equal(error.code, "E_WORK_INSPECTION_FAILED", JSON.stringify(error));
  assert.deepEqual(error.details.cause, { code: "ENOENT", syscall: "lstat" });
  assert.ok(error.message.startsWith(`could not inspect the home of ${w.name} or its work: `), error.message);
  assert.ok(error.message.includes("ENOENT"), error.message);
  assert.ok(error.message.includes(w.gone), error.message);
  assert.ok(error.message.endsWith(statement), `the message ends with what the retire had done: ${error.message}`);
}
/** The home is what `listed` holds, but for the file the test removed. */
function assertHomeKept(w, listed, what) {
  const expected = { ...listed };
  delete expected["notes/gone.md"];
  assert.deepEqual(listing(w.home), expected, `the home is byte-identical to what it was ${what}, apart from the file the test removed`);
}

test("an entry that vanishes under the retire's first inspection is answered E_WORK_INSPECTION_FAILED: nothing was stopped, run or removed, and the next retire succeeds", async (t) => {
  const w = await instance(t, "a1");
  const { result, atStart } = await retireWhileTheFileVanishes(w, { nth: 1 });
  const error = refusal(result);
  assertInspectionFailed(error, w, "Nothing was stopped, run or removed.");
  assert.deepEqual(error.details.reached, { phase: "before-effects", sessionStopAttempted: false, hooksStarted: false, home: "kept", recovery: null });
  assertHomeKept(w, atStart, "before the retire");
  assert.equal(w.hookRuns(), 0, "no retire hook ran");
  assert.deepEqual(w.recoveries(), [], "no recovery was written");
  assert.deepEqual(w.staging(), [], "no staging directory is left");
  // Nothing is owed: the same retire, with nothing vanishing, retires the instance.
  const again = w.fx.cli(["retire", w.name, "--json"]);
  assert.equal(again.status, 0, again.stderr + again.stdout);
  assert.equal(JSON.parse(again.stdout).retired, w.name);
  assert.equal(existsSync(w.home), false, "the home is removed");
  assert.equal(w.hookRuns(), 1, "its retire hook ran once");
});

test("an entry that vanishes under the inspection before the hooks: no retire hook has run, nothing was deleted, and this retire stopped no session", async (t) => {
  const w = await instance(t, "a2");
  // Each inspection reads the file's entry once: the second read of it is the second inspection's.
  const { result, atStart } = await retireWhileTheFileVanishes(w, { nth: 2 });
  const error = refusal(result);
  assertInspectionFailed(error, w, `No retire hook has run and nothing was deleted: ${w.name} is not retired and its home and work are kept; this retire stopped no session.`);
  assert.deepEqual(error.details.reached, { phase: "before-hooks", sessionStopAttempted: false, hooksStarted: false, home: "kept", recovery: null });
  assertHomeKept(w, atStart, "before the retire");
  assert.equal(w.hookRuns(), 0, "no retire hook ran");
  assert.deepEqual(w.recoveries(), [], "no recovery was written");
  assert.deepEqual(w.staging(), [], "no staging directory is left");
});

// ---- a launched instance: a stand-in harness in a window of a private tmux server ----------------

const SESSION = "oats-agents";
const tmux = (socket, ...args) => execFileSync("tmux", ["-f", "/dev/null", "-u", "-S", socket, ...args], { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"] }).trim();
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const windows = (socket) => tmux(socket, "list-windows", "-t", `=${SESSION}`, "-F", "#{window_name}").split("\n").filter(Boolean);
/** Record the home as launched in `SESSION:<name>` on `socket`, in instance.json and in the
 *  independent session receipt (the spawn's retirement baseline, which is the retire's authority),
 *  and start that server: a keeper window and the instance's, each a stand-in that idles. The
 *  socket is the fixture's own; the server is ended by its pid when the test ends. */
function launch(w, socket) {
  const endpoint = { session: SESSION, window: w.name, socket };
  const rewrite = (path, change, options) => writeFileSync(path, JSON.stringify(change(JSON.parse(readFileSync(path, "utf8"))), null, 2) + "\n", options);
  rewrite(join(w.home, "instance.json"), (meta) => ({ ...meta, launched: true, tmux: endpoint }));
  rewrite(join(dirname(w.home), ".oats-retirement", "baselines", `${createHash("sha256").update(w.home).digest("hex")}.json`), (baseline) => ({ ...baseline, runtime: { launched: true, tmux: endpoint } }), { mode: 0o600 });
  tmux(socket, "new-session", "-d", "-s", SESSION, "-n", "keeper", "sleep 600");
  const pid = Number(tmux(socket, "display-message", "-p", "#{pid}"));
  const end = async () => {
    try { tmux(socket, "kill-server"); } catch { /* gone */ }
    if (alive(pid)) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
    await waitUntil(() => !alive(pid), `the tmux server on ${socket} to exit`);
  };
  // Before the fixture's cleanup, which checks that no process still works in its base.
  w.fx.beforeCleanup(() => { try { tmux(socket, "kill-server"); } catch { /* ended by the test */ } });
  tmux(socket, "new-window", "-d", "-t", `${SESSION}:`, "-n", w.name, "sleep 600");
  return { end };
}

test("an entry that vanishes under the inspection before the hooks of a launched instance: its session has been stopped, and the answer says so", async (t) => {
  const w = await instance(t, "a3");
  const socket = join(w.fx.base, "tmux.sock");
  const server = launch(w, socket);
  try {
    assert.ok(windows(socket).includes(w.name), "the instance's window runs");
    const { result, atStart } = await retireWhileTheFileVanishes(w, { nth: 2 }, () => {
      assert.deepEqual(windows(socket), ["keeper"], "at the second inspection the retire has already ended the instance's window");
    });
    const error = refusal(result);
    assertInspectionFailed(error, w, `No retire hook has run and nothing was deleted: ${w.name} is not retired and its home and work are kept; its session has been stopped.`);
    assert.deepEqual(error.details.reached, { phase: "before-hooks", sessionStopAttempted: true, hooksStarted: false, home: "kept", recovery: null });
    assert.deepEqual(windows(socket), ["keeper"], "the instance's window is gone, and only that one");
    assertHomeKept(w, atStart, "before the retire");
    assert.equal(w.hookRuns(), 0, "no retire hook ran");
    assert.deepEqual(w.recoveries(), [], "no recovery was written");
    assert.deepEqual(w.staging(), [], "no staging directory is left");
  } finally { await server.end(); }
});

test("an entry that vanishes under the inspection after the hooks: the hooks have run, and the home, its work and the pre-hook recovery are kept", async (t) => {
  const w = await instance(t, "a4");
  // The first read of the file's entry once the retire hook has left its record is the third
  // inspection's. (Counted from the retire's start it is the fifth: the pre-hook recovery reads the
  // entry twice between the second inspection and the hooks, to copy it and to verify the copy.)
  let recoveryAtTheGate;
  const { result, atGate } = await retireWhileTheFileVanishes(w, { armed: w.hookLog }, () => {
    assert.equal(w.hookRuns(), 1, "the retire is held after its hook ran");
    recoveryAtTheGate = w.recoveries();
  });
  const error = refusal(result);
  assertInspectionFailed(error, w, `The retire hooks have run; the home, its work and the pre-hook recovery (if any) are kept; this retire stopped no session.`);
  // The home had changed since its spawn (notes/gone.md), so a recovery was written before the hooks.
  assert.equal(recoveryAtTheGate.length, 1, `one pre-hook recovery was on disk when the inspection began: ${recoveryAtTheGate}`);
  const recovery = join(w.recoveryRoot, recoveryAtTheGate[0]);
  assert.deepEqual(error.details.reached, { phase: "after-hooks", sessionStopAttempted: false, hooksStarted: true, home: "kept", recovery: { path: recovery, phase: "before-hooks" } });
  assert.deepEqual(w.recoveries(), recoveryAtTheGate, "that recovery is kept, and no other was written");
  assert.equal(JSON.parse(readFileSync(join(recovery, "recovery.json"), "utf8")).phase, "before-hooks", "its manifest on disk holds the phase the answer names");
  assert.equal(readFileSync(join(recovery, "home", "notes", "gone.md"), "utf8"), GONE, "and it holds the file as it was before the hooks");
  assert.deepEqual(w.staging(), [], "no staging directory is left");
  assert.equal(w.hookRuns(), 1, "the retire hook ran, once");
  assertHomeKept(w, atGate, "when the inspection began");
  assert.ok(lstatSync(join(w.home, "work")).isDirectory(), "its work is kept");
});

// ---- the pause itself ---------------------------------------------------------------------------

/** A directory for a child that is no kernel: a file to read, and the gate directory beside it. */
function scratch(t) {
  const base = fixtureBase("oats-gate-");
  t.after(() => rmSync(base, { recursive: true, force: true }));
  return { base, file: join(base, "read-me.txt"), gateDir: join(base, "gates") };
}
const READ_AND_PRINT = `const { readFileSync } = require("node:fs"); process.stdout.write(JSON.stringify({ read: readFileSync(process.argv[1], "utf8"), gates: process.env.OATS_TEST_GATES ?? null, gateDir: process.env.OATS_TEST_GATE_DIR ?? null }));`;

test("the pause holds one named fs call until it is released, and changes neither its result nor the child's environment", async (t) => {
  const s = scratch(t);
  writeFileSync(s.file, "the file's own bytes\n");
  const run = startGated(["-e", READ_AND_PRINT, s.file], { cwd: s.base, gateDir: s.gateDir, gates: [{ name: "read", fn: "readFileSync", path: s.file }] });
  try {
    await run.waitGate("read");
    assert.equal(run.entered("read"), true);
    assert.equal(run.child.exitCode, null, "the child is held at the call: it has not exited");
    assert.equal(existsSync(join(s.gateDir, "read.timeout")), false);
    run.release("read");
    const result = await run.done;
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { read: "the file's own bytes\n", gates: null, gateDir: null }, "the call returned the file's bytes, and the gate variables are not in the environment the child goes on with");
    assert.deepEqual(result.timedOut, []);
  } finally { await run.finish(); }
});

test("a gate with nth: 2 lets the first matching call through and holds the second", async (t) => {
  const s = scratch(t);
  const first = join(s.base, "first-read.txt");
  writeFileSync(s.file, "one\n");
  // Two reads of one file: the first is copied to a file at once, the second is printed.
  const script = `const fs = require("node:fs"); fs.writeFileSync(process.argv[2], fs.readFileSync(process.argv[1])); process.stdout.write(fs.readFileSync(Buffer.from(process.argv[1]), "utf8"));`;
  const run = startGated(["-e", script, s.file, first], { cwd: s.base, gateDir: s.gateDir, gates: [{ name: "second", fn: "readFileSync", path: s.file, nth: 2 }] });
  try {
    await run.waitGate("second");
    assert.equal(readFileSync(first, "utf8"), "one\n", "the first read was not held: its result is already written");
    assert.equal(run.child.exitCode, null, "the child is held at the second read");
    writeFileSync(s.file, "two\n"); // the second writer, at an exact moment
    run.release("second");
    const result = await run.done;
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, "two\n", "the second read, of the path as bytes, was held until the file had changed");
    assert.deepEqual(result.timedOut, []);
  } finally { await run.finish(); }
});

test("a gate that is never released does not hold its process for ever: the call goes on and the gate is reported as timed out", async (t) => {
  const s = scratch(t);
  writeFileSync(s.file, "still read\n");
  const run = startGated(["-e", READ_AND_PRINT, s.file], { cwd: s.base, gateDir: s.gateDir, gates: [{ name: "forgotten", fn: "readFileSync", path: s.file, waitMs: 50 }] });
  try {
    const result = await run.done; // no release: the bound ends the wait
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).read, "still read\n");
    assert.equal(run.entered("forgotten"), true);
    assert.deepEqual(result.timedOut, ["forgotten"], "a test that asserts timedOut is empty fails on this, by name");
    assert.ok(existsSync(join(s.gateDir, "forgotten.timeout")));
  } finally { await run.finish(); }
});
