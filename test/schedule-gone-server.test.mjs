// A scheduled spawn job keeps its slot while the instance it launched has a home. When that
// instance's recorded tmux server is gone (a reboot, a crash), the instance reads `stopped` and the
// job is skipped with what to do, never "still running" with an `unknown` it cannot leave (#921).
// Gone is judged as session start and stop judge it (#624): a socket no server listens on is gone;
// a missing socket file is gone only when no process works in the home. Real tmux servers on
// private sockets, and the fixture's own `oats` server for the reboot.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { leaveEnclosingInstance, oatsSocket, waitUntil } from "./helpers/host-fixture.mjs";
import { alive, endServers, killServer, recordLaunch, startServer } from "./helpers/recorded-tmux-server.mjs";
import { addSchedule, jobLockInfo, readState, tickWorkspace } from "../lib/schedule.mjs";
import { inspectInstanceSession, shq, startInstanceSession, stopInstanceSession } from "../lib/core.mjs";

const fixtures = [];
test.afterEach(() => {
  endServers();
  for (const fx of fixtures.splice(0)) fx.cleanup();
});

/** A deployment whose soul dev works in a worktree, with the spawn job `nightly` every five minutes,
 *  or none (`{ job: false }`). */
async function scheduled({ job = true } = {}) {
  const fx = v2Deployment({ souls: { dev: { soul: { work: "worktree" } } } });
  fixtures.push(fx);
  for (const [k, v] of [["user.email", "test@example.invalid"], ["user.name", "Test"]]) execFileSync("git", ["-C", fx.member, "config", k, v]);
  await fx.prepare("dev"); // the soul's definition under agents/, as a spawn leaves it
  if (job) await fx.inEnv(() => addSchedule(fx.dep, { id: "nightly", cron: "*/5 * * * *", tz: "UTC", kind: "spawn", agent: "dev", task: "Fixture only." }));
  return fx;
}
/** One tick of the deployment's schedules at `iso`, as the host runs it. */
const tick = (fx, iso, io) => fx.inEnv(() => tickWorkspace(fx.dep, { now: new Date(iso), io, reg: { maxConcurrent: 5 }, wsList: [fx.dep] }));
const lastRun = (fx) => readState(fx.dep).jobs.nightly.lastRun;
/** The tick's spawn: a real `oats spawn` without a launch, then its home recorded as launched on a
 *  private server at `socket` that runs its window (in `cwd`, when given). Collects what it spawned. */
function spawnOnServer(fx, socket, spawned, { cwd } = {}) {
  return (root, agent, opts) => {
    const r = fx.cli(["spawn", "dev", "--purpose", opts.purpose, "--no-launch", "--json"]);
    assert.equal(r.status, 0, `${r.stderr}\n${r.stdout}`);
    const { home, instance } = r.json().result;
    recordLaunch(home, instance, socket);
    startServer(socket, instance, { cwd: cwd === "home" ? home : cwd });
    spawned.push({ home, instance });
    return { instance, home, launched: true };
  };
}
/** Run `fn`, in which a session start creates the fixture's `oats` server: the start says that it could
 *  not read the login environment (the fixture's login shell cannot run), that warning and nothing else. */
function creatingServer(fn) {
  const write = process.stderr.write;
  let written = "";
  process.stderr.write = (chunk) => { written += chunk; return true; };
  let result;
  try { result = fn(); } finally { process.stderr.write = write; }
  assert.match(written, /^oats: warning: could not read your login environment \([^\n]*\n$/);
  return result;
}
/** A real `oats spawn` without a launch whose session, once started on the fixture's own `oats`
 *  server, runs a frozen command in place of a harness: a fixture that writes its pid to
 *  `harness-ready` in the home (atomically) and execs a sleep. */
function startableHome(fx, purpose) {
  const harness = join(fx.base, "fixture-harness");
  writeFileSync(harness, `#!/bin/sh\necho $$ > "$OATS_INSTANCE_HOME/harness-ready.tmp"\n/bin/mv "$OATS_INSTANCE_HOME/harness-ready.tmp" "$OATS_INSTANCE_HOME/harness-ready"\nexec sleep 600\n`, { mode: 0o755 });
  const r = fx.cli(["spawn", "dev", "--purpose", purpose, "--harness", "claude", "--no-launch", "--json"]);
  assert.equal(r.status, 0, `${r.stderr}\n${r.stdout}`);
  const { home, instance } = r.json().result;
  const metaPath = join(home, "instance.json");
  const { launch: _recipe, ...meta } = JSON.parse(readFileSync(metaPath, "utf8"));
  const command = `OATS_INSTANCE=${shq(instance)} OATS_INSTANCE_HOME=${shq(home)} ${shq(harness)} --dangerously-skip-permissions -- "$(cat TASK.md)"`;
  writeFileSync(metaPath, JSON.stringify({ ...meta, command, launched: false }));
  return { home, instance };
}
/** Whether the pid the harness wrote is now the sleep it execs. Waiting on the pane alone is not
 *  enough: a step of the session's start before the harness (a transient non-shell) reads as running,
 *  and the harness's own shell before its exec reads as a shell, idle, to a stop that comes then. */
function harnessSleeps(home) {
  try {
    const pid = readFileSync(join(home, "harness-ready"), "utf8").trim();
    const comm = execFileSync("ps", ["-o", "comm=", "-p", pid], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", LC_ALL: "C" } }).trim();
    return comm.split("/").pop() === "sleep";
  } catch { return false; }
}
/** Whether `home`'s session runs its command: the harness sleeps, and the kernel reads it running. */
const active = (fx, home) => harnessSleeps(home) && fx.inEnv(() => { try { return inspectInstanceSession(home).state === "unknown"; } catch { return false; } });
/** Stop `home`'s session and wait until its start wrapper has exited, so that nothing the session ran
 *  is still exiting when the fixture checks that its processes are gone. */
async function stopSession(fx, home) {
  assert.equal((await fx.inEnv(() => stopInstanceSession(home, { graceMs: 5000 }))).stopped, true);
  await waitUntil(() => existsSync(join(home, ".oats-start-exited")), "the session's start wrapper to exit");
}
/** A reboot: the fixture's `oats` server is gone, and tmux's socket directory with it, and so is
 *  every harness it ran: their `harness-ready` files go too, for the next start to write. */
async function reboot(fx, ...homes) {
  const socket = oatsSocket(fx.env.TMUX_TMPDIR);
  const pid = Number(execFileSync("tmux", ["-S", socket, "display-message", "-p", "#{pid}"], { encoding: "utf8" }).trim());
  execFileSync("tmux", ["-S", socket, "kill-server"]);
  await waitUntil(() => !alive(pid), "the oats tmux server to exit");
  rmSync(dirname(socket), { recursive: true, force: true });
  for (const home of homes) rmSync(join(home, "harness-ready"), { force: true });
}
const stoppedReason = ({ instance, home }) => `previous instance stopped: retire it (oats retire ${instance}) or start it again (oats session start --home ${home})`;

/** Launch `nightly` at 10:05 on a private server; returns the fixture, the spawned instance and its socket. */
async function launched(t, { cwd } = {}) {
  t.diagnostic(execFileSync("tmux", ["-V"], { encoding: "utf8" }).trim());
  const fx = await scheduled();
  const socket = join(fx.base, "tmux-sockets", "tmux.sock");
  const spawned = [];
  const io = { spawn: spawnOnServer(fx, socket, spawned, { cwd: cwd ?? fx.base }) };
  const first = await tick(fx, "2026-09-07T10:05:00Z", io);
  assert.equal(first[0].action, "launched", JSON.stringify(first));
  return { fx, io, socket, spawned, run: spawned[0] };
}
/** The next due minute, 10:10: the instance reads stopped with its note and the job is skipped with what to do. */
async function skippedAsStopped({ fx, io, run }) {
  const c = await tick(fx, "2026-09-07T10:10:00Z", io);
  assert.deepEqual([c[0].action, c[0].reason], ["skipped", stoppedReason(run)]);
  const lr = lastRun(fx);
  assert.equal(lr.outcome, "stopped");
  assert.equal(lr.note, "its tmux server is gone");
  assert.equal(lr.error, undefined, "a stopped instance carries no inspection error");
  assert.ok(jobLockInfo(fx.dep, "nightly"), "a stopped instance keeps the job's slot");
}

test("a spawn job whose instance's server was killed and its socket file removed reads stopped and is skipped with what to do", async (t) => {
  const f = await launched(t);
  await killServer(f.socket);
  rmSync(f.socket);
  await skippedAsStopped(f);
});

test("a spawn job whose instance's server was killed, leaving a socket file no server listens on, reads stopped", async (t) => {
  const f = await launched(t);
  await killServer(f.socket);
  assert.equal(existsSync(f.socket), true, "tmux leaves its socket file behind when the server is killed");
  await skippedAsStopped(f);
});

test("a spawn job whose instance runs reads active and is skipped as still running", async (t) => {
  const { fx, io } = await launched(t);
  const c = await tick(fx, "2026-09-07T10:10:00Z", io);
  assert.deepEqual([c[0].action, c[0].reason], ["skipped", "still running"]);
  assert.equal(lastRun(fx).outcome, "active");
});

test("a spawn job whose instance's socket file is gone while a process still works in its home stays unknown", async (t) => {
  // A tmux server keeps running when its socket file is removed; its window still works in the home.
  const { fx, io, socket } = await launched(t, { cwd: "home" });
  rmSync(socket);
  const c = await tick(fx, "2026-09-07T10:10:00Z", io);
  assert.deepEqual([c[0].action, c[0].reason], ["skipped", "still running"]);
  const lr = lastRun(fx);
  assert.equal(lr.outcome, "unknown");
  assert.match(lr.error, /No such file or directory.*; a process still works in this home \(pid \d+ .*SIGUSR1/);
});

test("a spawn job whose instance's record cannot be read stays unknown", async (t) => {
  const { fx, io, run } = await launched(t);
  writeFileSync(join(run.home, "instance.json"), "{ not json");
  const c = await tick(fx, "2026-09-07T10:10:00Z", io);
  assert.deepEqual([c[0].action, c[0].reason], ["skipped", "still running"]);
  const lr = lastRun(fx);
  assert.equal(lr.outcome, "unknown");
  assert.match(lr.error, /cannot read session receipt/);
});

test("retiring a stopped instance frees its job: ended, the slot released, and the next due minute launches", async (t) => {
  const f = await launched(t);
  await killServer(f.socket);
  await skippedAsStopped(f);
  const r = f.fx.cli(["retire", f.run.instance, "--json"]);
  assert.equal(r.status, 0, `${r.stderr}\n${r.stdout}`);
  assert.equal(existsSync(f.run.home), false);
  assert.deepEqual(await tick(f.fx, "2026-09-07T10:11:00Z", f.io), [], "10:11 is not due");
  assert.equal(lastRun(f.fx).outcome, "ended");
  assert.equal(jobLockInfo(f.fx.dep, "nightly"), null, "the slot is released");
  endServers(); // the next run starts its own server on the same socket
  const c = await tick(f.fx, "2026-09-07T10:15:00Z", f.io);
  assert.equal(c[0].action, "launched", JSON.stringify(c));
  assert.equal(f.spawned.length, 2);
});

test("after a reboot a scheduled instance reads stopped with what to do, and once started again it is still running", async (t) => {
  t.diagnostic(execFileSync("tmux", ["-V"], { encoding: "utf8" }).trim());
  const fx = await scheduled();
  const comeBack = leaveEnclosingInstance(fx.base); // this worker starts a tmux server: as no instance
  t.after(comeBack);
  // The tick spawns, then starts the instance's session.
  const spawned = [];
  const io = {
    spawn: (root, agent, opts) => {
      const run = startableHome(fx, opts.purpose);
      creatingServer(() => startInstanceSession(run.home));
      spawned.push(run);
      return { ...run, launched: true };
    },
  };
  const first = await tick(fx, "2026-09-07T10:05:00Z", io);
  assert.equal(first[0].action, "launched", JSON.stringify(first));
  const [run] = spawned;
  await waitUntil(() => active(fx, run.home), "the instance's command runs");
  await reboot(fx, run.home);
  await skippedAsStopped({ fx, io, run });
  // Started again, as the reason says: active, and skipped as still running.
  await fx.inEnv(() => creatingServer(() => startInstanceSession(run.home)));
  await waitUntil(() => active(fx, run.home), "the instance's command runs again");
  const c = await tick(fx, "2026-09-07T10:15:00Z", io);
  assert.deepEqual([c[0].action, c[0].reason], ["skipped", "still running"]);
  assert.equal(lastRun(fx).outcome, "active");
  await stopSession(fx, run.home);
});

test("after a reboot a wake job starts its instance's session at its next due minute", async (t) => {
  t.diagnostic(execFileSync("tmux", ["-V"], { encoding: "utf8" }).trim());
  const fx = await scheduled({ job: false });
  const comeBack = leaveEnclosingInstance(fx.base); // this worker starts a tmux server: as no instance
  t.after(comeBack);
  const { home } = startableHome(fx, "woken");
  await fx.inEnv(() => creatingServer(() => startInstanceSession(home)));
  await waitUntil(() => active(fx, home), "the instance's command runs");
  await reboot(fx, home);
  await fx.inEnv(() => addSchedule(fx.dep, { id: "wake", cron: "*/5 * * * *", tz: "UTC", kind: "wake", home, message: "Fixture only." }));
  const c = await fx.inEnv(() => creatingServer(() => tickWorkspace(fx.dep, { now: new Date("2026-09-07T10:05:00Z"), reg: { maxConcurrent: 5 }, wsList: [fx.dep] })));
  assert.deepEqual([c[0].action, c[0].reason], ["started", "session was stopped; the message is pending until the session is active"]);
  await waitUntil(() => active(fx, home), "the instance's command runs again");
  await stopSession(fx, home);
});
