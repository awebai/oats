// A tmux server outlives its removed socket file (#624). tmux then answers `error connecting to
// <socket> (No such file or directory)`, as it does after a reboot, when the server is really gone.
// So a missing socket file says "stopped" only when no process works in the instance's home (the
// process scan, #625): status shows a row whose home still has one as unreachable, start and restart
// refuse and create no server at that path, and stop refuses. A socket file that no server listens
// on ("no server running on") is definitive and needs no scan. tmux's own remedy, SIGUSR1 to the
// server, recreates the socket; OATS names it and never sends it.
//
// Real tmux on the fixture's private TMUX_TMPDIR: the instances run on the fixture's own `oats`
// server, never the operator's.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { listInstances, processesInHome, restartInstanceSession, startInstanceSession, stopInstanceSession } from "../lib/core.mjs";
import { fixtureBase, isolateSessionEnvironment, oatsSocket, systemExecutable, waitUntil } from "./helpers/host-fixture.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
// The host's tmux, before the fixture puts its own wrapper first on PATH.
const TMUX_VERSION = execFileSync(systemExecutable("tmux"), ["-V"], { encoding: "utf8", timeout: 10000 }).trim();
const base = fixtureBase("oats-msock-");
const restoreEnvironment = isolateSessionEnvironment(base);
const OATS = oatsSocket();
const SESSION = "msock";
const tmuxOn = (socket, ...args) => execFileSync("tmux", ["-u", "-S", socket, ...args], { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"] }).trim();
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
// Every server pid a test saw: one that lost its socket cannot be killed by socket, so it is ended by pid.
const serverPids = new Set();
const serverPid = () => { const pid = Number(tmuxOn(OATS, "display-message", "-p", "#{pid}")); serverPids.add(pid); return pid; };

// An inert "harness": it says it is ready, then idles as `sleep`, its working directory the home.
const probeBin = join(base, "probe-bin");
mkdirSync(probeBin);
const probe = join(probeBin, "claude");
writeFileSync(probe, `#!/bin/sh\necho $$ > "$OATS_INSTANCE_HOME/harness-ready"\nexec sleep 600\n`);
chmodSync(probe, 0o755);
const fx = v2Deployment();
const harnessPid = (home) => { try { const pid = Number(readFileSync(join(home, "harness-ready"), "utf8").trim()); return pid > 1 && alive(pid) ? pid : null; } catch { return null; } };
const ready = (home) => waitUntil(() => harnessPid(home) !== null, `${home} harness idle`);
const baselineOf = (home) => join(dirname(home), ".oats-retirement", "baselines", `${createHash("sha256").update(home).digest("hex")}.json`);
const withPath = async (path, fn) => { const saved = process.env.PATH; process.env.PATH = path; try { return await fn(); } finally { process.env.PATH = saved; } };

/** A real workspace-model home with a frozen launch command, never launched. */
async function makeHome(name) {
  const { home } = await withPath(fx.env.PATH, () => fx.spawn("dev", { name, harness: "claude" }));
  writeFileSync(join(home, "TASK.md"), "task\n");
  const command = `OATS_INSTANCE=${shq(name)} OATS_INSTANCE_HOME=${shq(home)} ${shq(probe)} --dangerously-skip-permissions -- "$(cat TASK.md)"`;
  const { launch: _recipe, ...spawned } = readJson(join(home, "instance.json"));
  writeFileSync(join(home, "instance.json"), JSON.stringify({ ...spawned, tmux: { session: SESSION, window: name }, command, launched: false }, null, 2) + "\n");
  writeFileSync(baselineOf(home), JSON.stringify({ ...readJson(baselineOf(home)), runtime: { launched: false } }, null, 2) + "\n", { mode: 0o600 });
  return { name, home };
}
const statusRow = (name) => {
  const r = fx.cli(["status", "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return JSON.parse(r.stdout).agents.flatMap((a) => a.instances).find((i) => i.instance === name);
};
const liveness = (row) => ({ running: row.running, runtimeState: row.runtimeState, runtimeError: row.runtimeError });
const NO_PROC = { procRoot: join(base, "no-proc") }; // a scan that cannot run

test.after(() => {
  for (const pid of serverPids) if (alive(pid)) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
  restoreEnvironment(); // kills the fixture's `oats` server, by socket
  rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  fx.cleanup();
});

// The version is in the test's name so that the run's log names the tmux these tests exercised.
test(`the tmux these tests run against: ${TMUX_VERSION}`, () => {});

test("a server whose socket file was removed while its window runs in the home: status is unreachable, start, restart and stop refuse, and SIGUSR1 brings it back", async (t) => {
  const h = await makeHome("alive");
  const started = await fx.inEnv(() => startInstanceSession(h.home));
  assert.equal(started.target.socket, OATS);
  await ready(h.home);
  const pid = serverPid();
  // Whatever happens here, the next test starts with no server left behind, socket file or none.
  t.after(async () => { if (alive(pid)) { process.kill(pid, "SIGKILL"); await waitUntil(() => !alive(pid), "the server exited"); } rmSync(OATS, { force: true }); });
  assert.equal(statusRow("alive").running, true);

  rmSync(OATS);
  const missing = new RegExp(`error connecting to ${OATS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(No such file or directory\\)`);
  const named = /; a process still works in this home \(pid \d+ (sh|sleep)\b.*\), so its tmux server may still be running without its socket file: tmux recreates a removed socket file when its server process receives SIGUSR1/;

  // status: unknown, not stopped, with why; the shape is the existing one.
  const row = liveness(statusRow("alive"));
  assert.equal(row.running, null, JSON.stringify(row));
  assert.equal(row.runtimeState, "unreachable");
  assert.match(row.runtimeError, missing);
  assert.match(row.runtimeError, named);
  assert.ok(row.runtimeError.includes(`pid ${harnessPid(h.home)} sleep`), row.runtimeError);
  // A scan that cannot run is unknown too, with its own error.
  const blind = await fx.inEnv(() => listInstances(fx.root, undefined, NO_PROC)).then((agents) => agents.flatMap((a) => a.instances).find((i) => i.instance === "alive"));
  assert.deepEqual(liveness(blind).running, null);
  assert.equal(blind.runtimeState, "unreachable");
  assert.match(blind.runtimeError, /; whether a process still works in this home could not be established \(.*no-proc cannot be read \(ENOENT\)\)$/);

  // start and restart: refused, nothing started, and no second server at the socket path.
  for (const [what, run] of [["start", (o) => startInstanceSession(h.home, o)], ["restart", (o) => restartInstanceSession(h.home, { stopGraceMs: 2000, ...o })]]) {
    for (const io of [undefined, NO_PROC]) {
      await assert.rejects(fx.inEnv(async () => run(io ? { io } : {})), (e) => {
        assert.equal(e.code, "E_SESSION_UNKNOWN", `${what}: ${e.message}`);
        assert.match(e.message, /nothing was started/);
        assert.match(e.message, io ? /could not be established \(.*no-proc cannot be read/ : named);
        return true;
      });
      assert.equal(existsSync(OATS), false, `${what} created no server at ${OATS}`);
    }
  }
  assert.ok(alive(harnessPid(h.home)), "the harness still runs");

  // stop: refused, nothing stopped, never "already idle".
  for (const io of [undefined, NO_PROC]) {
    await assert.rejects(fx.inEnv(() => stopInstanceSession(h.home, io ? { io } : {})), (e) => {
      assert.equal(e.code, "E_SESSION_UNAVAILABLE", e.message);
      assert.match(e.message, /nothing was stopped/);
      assert.match(e.message, io ? /could not be established/ : named);
      return true;
    });
  }
  assert.ok(alive(harnessPid(h.home)), "the harness still runs");

  // tmux's own remedy, which OATS names and never sends.
  process.kill(pid, "SIGUSR1");
  await waitUntil(() => existsSync(OATS), "the server recreated its socket");
  assert.equal(serverPid(), pid, "the same server answers");
  assert.equal(statusRow("alive").running, true);
  await assert.rejects(fx.inEnv(() => startInstanceSession(h.home)), (e) => e.code === "E_SESSION_RUNNING");
  tmuxOn(OATS, "kill-server");
  await waitUntil(() => !alive(pid), "the server exited");
});

test("a missing socket file with no process in the home reads as today: stopped, stop is idle, and start launches", async () => {
  const h = await makeHome("rebooted");
  await fx.inEnv(() => startInstanceSession(h.home));
  await ready(h.home);
  const harness = harnessPid(h.home);
  const pid = serverPid();
  // As after a reboot: the server and everything in it are gone, and so is its socket file.
  process.kill(pid, "SIGKILL");
  await waitUntil(() => !alive(pid), "the server exited");
  try { process.kill(harness, "SIGKILL"); } catch { /* the pane's process went with its server */ }
  rmSync(OATS, { force: true });
  await waitUntil(() => processesInHome(h.home).ok && !processesInHome(h.home).processes.length, "no process works in the home");

  assert.deepEqual(liveness(statusRow("rebooted")), { running: false, runtimeState: undefined, runtimeError: undefined });
  const stopped = await fx.inEnv(() => stopInstanceSession(h.home));
  assert.equal(stopped.alreadyIdle, true);
  assert.equal(stopped.state, "stopped");
  rmSync(join(h.home, "harness-ready"));
  const r = await fx.inEnv(() => startInstanceSession(h.home));
  assert.equal(r.reused, "new");
  assert.equal(r.target.socket, OATS);
  await ready(h.home);
  serverPid();
  assert.equal(statusRow("rebooted").running, true);
});

test("a socket file no server listens on is stopped with no process scan", async () => {
  const h = await makeHome("stale");
  await fx.inEnv(() => startInstanceSession(h.home));
  await ready(h.home);
  const harness = harnessPid(h.home);
  const pid = serverPid();
  process.kill(pid, "SIGKILL"); // leaves its socket file behind
  await waitUntil(() => !alive(pid), "the server exited");
  try { process.kill(harness, "SIGKILL"); } catch { /* gone with its server */ }
  assert.equal(existsSync(OATS), true, "a killed server leaves its socket file");
  // With a scan that cannot run, any row or stop that consulted it would read unknown.
  const row = await fx.inEnv(() => listInstances(fx.root, undefined, NO_PROC)).then((agents) => agents.flatMap((a) => a.instances).find((i) => i.instance === "stale"));
  assert.deepEqual(liveness(row), { running: false, runtimeState: undefined, runtimeError: undefined });
  assert.equal((await fx.inEnv(() => stopInstanceSession(h.home, { io: NO_PROC }))).alreadyIdle, true);
  rmSync(join(h.home, "harness-ready"));
  const r = await fx.inEnv(() => startInstanceSession(h.home, { io: NO_PROC }));
  assert.equal(r.target.socket, OATS);
  await ready(h.home);
  serverPid();
});

test("a home that records no socket reads the default server: a missing socket file there is checked against the scan only for a home that records a launch", async () => {
  const legacy = await makeHome("legacy");
  const meta = join(legacy.home, "instance.json");
  writeFileSync(meta, JSON.stringify({ ...readJson(meta), launched: true }, null, 2) + "\n"); // launched by a kernel before the OATS server
  const never = await makeHome("never"); // --no-launch: no socket, no launch
  // The default server's socket file is missing: a tmux in front answers so for calls that name
  // no socket, and hands the others to the fixture's. `from` is the first read that sees it gone:
  // has-session, or list-windows after has-session found the session (the file went in between).
  const fronts = {};
  for (const from of ["has-session", "list-windows"]) {
    const dir = fronts[from] = join(base, `default-missing-${from}-bin`);
    mkdirSync(dir);
    const passes = from === "list-windows" ? `[ "$1" = has-session ] && exit 0\n` : "";
    writeFileSync(join(dir, "tmux"), `#!/bin/sh\ncase " $* " in *" -S "*|*" -L "*) exec ${shq(join(base, "system-bin", "tmux"))} "$@" ;; esac\n${passes}echo "error connecting to /tmp/tmux-0/default (No such file or directory)" >&2\nexit 1\n`);
    chmodSync(join(dir, "tmux"), 0o755);
  }
  // A /proc where a process works in each home.
  const proc = (name, homes) => {
    const root = join(base, name);
    homes.forEach((home, i) => {
      const dir = join(root, String(900000 + i));
      mkdirSync(dir, { recursive: true });
      symlinkSync(home, join(dir, "cwd"));
      writeFileSync(join(dir, "comm"), "sleep\n");
      writeFileSync(join(dir, "stat"), `${900000 + i} (sleep) S 1 0 0\n`);
    });
    mkdirSync(join(root, "1"), { recursive: true }); symlinkSync("/", join(root, "1", "cwd")); writeFileSync(join(root, "1", "comm"), "init\n"); writeFileSync(join(root, "1", "stat"), "1 (init) S 0 0 0\n");
    return { procRoot: root };
  };
  const busyProc = proc("proc-busy", [legacy.home, never.home]), idleProc = proc("proc-idle", []);
  for (const [from, front] of Object.entries(fronts)) {
    const rows = (io) => withPath(`${front}:${process.env.PATH}`, () => fx.inEnv(() => listInstances(fx.root, undefined, io)))
      .then((agents) => Object.fromEntries(agents.flatMap((a) => a.instances).filter((i) => ["legacy", "never"].includes(i.instance)).map((i) => [i.instance, liveness(i)])));
    const busy = await rows(busyProc);
    assert.equal(busy.legacy.running, null, JSON.stringify(busy));
    assert.equal(busy.legacy.runtimeState, "unreachable");
    assert.match(busy.legacy.runtimeError, /No such file or directory\); a process still works in this home \(pid 90000\d sleep\), so its tmux server may still be running without its socket file: tmux recreates a removed socket file when its server process receives SIGUSR1$/);
    assert.deepEqual(busy.never, { running: false, runtimeState: undefined, runtimeError: undefined }, `${from}: a home with no launch is not running, whatever works in it`);
    const blind = await rows(NO_PROC);
    assert.equal(blind.legacy.runtimeState, "unreachable");
    assert.match(blind.legacy.runtimeError, /could not be established \(.*no-proc cannot be read \(ENOENT\)\)$/);
    assert.deepEqual(blind.never, { running: false, runtimeState: undefined, runtimeError: undefined });
    const idle = await rows(idleProc);
    assert.deepEqual(idle, { legacy: { running: false, runtimeState: undefined, runtimeError: undefined }, never: { running: false, runtimeState: undefined, runtimeError: undefined } }, `${from}: no process in the home: stopped, as after a reboot`);
  }
});
