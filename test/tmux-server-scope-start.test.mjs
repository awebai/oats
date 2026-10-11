// The OATS tmux server's start in a scope of its own (awebai/oats#915, C1-C3), on the fixture's
// private server: the creator's cgroup and platform are injected, and `systemd-run` is a fake in a
// fake system directory that records its arguments and runs the command after `--`, as a scope
// does. No host service manager is reached (isolateSessionEnvironment: PATH is the fixture's only).
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureOatsTmuxSession } from "../lib/core.mjs";
import { serverScopeUnit, serverScopeWarning } from "../lib/tmux-server-scope.mjs";
import { isolateSessionEnvironment, oatsSocket, systemExecutable } from "./helpers/host-fixture.mjs";

const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-scope-start-")));
const restoreEnvironment = isolateSessionEnvironment(base);
const OATS = oatsSocket();
const TMUX = join(base, "system-bin", "tmux"); // the tmux this process's PATH finds (creatorTmux)
test.after(() => { restoreEnvironment(); rmSync(base, { recursive: true, force: true }); });

const TICK = "0::/user.slice/user-1000.slice/user@1000.service/app.slice/oats-schedule-tick.service\n";
const SESSION_SCOPE = "0::/user.slice/user-1000.slice/session-3.scope\n";
const PANE_SCOPE = "0::/user.slice/user-1000.slice/user@1000.service/app.slice/tmux-spawn-1a2b.scope\n";
const V1 = "12:cpu,cpuacct:/\n1:name=systemd:/user.slice/user-1000.slice/user@1000.service/app.slice/oats-schedule-tick.service\n";

let n = 0;
const ENV = systemExecutable("env"); // the host's own env, linked into each fake system directory
/** A fake system directory; `systemdRun` is the body of its systemd-run (none when null), with the
 *  host's env beside it unless `env` is false. */
function systemDir(systemdRun, { env = true } = {}) {
  const dir = join(base, `system-${++n}`), log = join(dir, "systemd-run.args");
  mkdirSync(dir, { recursive: true });
  if (env) symlinkSync(ENV, join(dir, "env"));
  if (systemdRun !== null) {
    writeFileSync(join(dir, "systemd-run"), `#!/bin/sh\nprintf '%s\\n' "$@" > '${log}'\n${systemdRun}\n`);
    chmodSync(join(dir, "systemd-run"), 0o755);
  }
  return { dir, log, args: () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").slice(0, -1) : null) };
}
/** As a scope does: run what follows `--`, with the scope's INVOCATION_ID exported to it. */
const SCOPE_ID = "f00dfeed0123456789abcdef00000915";
const RUNS_COMMAND = `while [ "$1" != "--" ]; do shift; done; shift\nINVOCATION_ID=${SCOPE_ID}; export INVOCATION_ID\nexec "$@"`;
/** The server's own global environment, names and values. */
const serverEnvironment = () => execFileSync(TMUX, ["-u", "-S", OATS, "show-environment", "-g"], { encoding: "utf8" });
const killServer = () => { try { execFileSync(TMUX, ["-u", "-S", OATS, "kill-server"], { stdio: "ignore" }); } catch { /* none */ } };
const sessions = () => { try { return execFileSync(TMUX, ["-u", "-S", OATS, "list-sessions", "-F", "#{session_name}"], { encoding: "utf8" }).split("\n").filter(Boolean); } catch { return []; } };
/** Every call ensureOatsTmuxSession makes, run for real. */
function spy(extra = {}) {
  const calls = [];
  return { calls, io: { exec: (bin, args, options) => { calls.push({ bin, args, options }); return execFileSync(bin, args, options); }, ...extra } };
}
const plainArgs = (session) => ["-u", "-L", "oats", "new-session", "-d", "-s", session, "-n", "hq", "-c", base, "-P", "-F", "#{socket_path}\t#{window_id}"];
const starts = (calls) => calls.filter((c) => c.args.includes("new-session"));

test("the session environment's own kernel calls judge themselves outside any service (#915 isolation)", () => {
  assert.match(process.env.OATS_TEST_CGROUP ?? "", /^0::\/.*\.scope\n$/);
  const warnings = [];
  killServer();
  const { calls, io } = spy();
  ensureOatsTmuxSession("isolated", base, io, undefined, undefined, warnings);
  assert.equal(starts(calls)[0].bin, TMUX); assert.deepEqual(warnings, []);
  killServer();
});

test("inside a service on Linux: the server starts under systemd-run --user --scope, with today's argv and environment", () => {
  killServer();
  const sys = systemDir(RUNS_COMMAND);
  const { calls, io } = spy({ platform: "linux", cgroup: TICK, systemToolDirs: [sys.dir] });
  const warnings = [];
  assert.equal(ensureOatsTmuxSession("scoped", base, io, undefined, undefined, warnings), OATS);
  assert.deepEqual(sessions(), ["scoped"]);
  assert.deepEqual(warnings, []);
  const [start] = starts(calls);
  const unit = start.args[5];
  assert.match(unit, /^oats-tmux-[0-9a-f]{12}-[0-9a-f]{8}$/);
  assert.equal(unit.slice(0, 22), serverScopeUnit({ socket: null, env: start.options.env }).slice(0, 22), "under this address's prefix");
  assert.equal(start.bin, join(sys.dir, "systemd-run"), "from the system directories");
  assert.deepEqual(start.args, ["--user", "--scope", "--collect", "--quiet", "--unit", unit, "--", join(sys.dir, "env"), "-u", "INVOCATION_ID", TMUX, ...plainArgs("scoped")]);
  assert.deepEqual(sys.args(), start.args, "what systemd-run received");
  // The scope's INVOCATION_ID never reaches the server (condition 4): what the server holds of it is
  // what the environment handed to tmux holds, and we add none.
  assert.equal(serverEnvironment().includes(SCOPE_ID), false, "the scope's id is not in the server's environment");
  // The same environment object and options as an unwrapped start of the same server (condition 4).
  killServer();
  const plain = spy({ platform: "linux", cgroup: SESSION_SCOPE, systemToolDirs: [sys.dir] });
  ensureOatsTmuxSession("scoped", base, plain.io);
  const [unwrapped] = starts(plain.calls);
  assert.deepEqual(unwrapped.args, plainArgs("scoped"));
  assert.deepEqual(start.options, unwrapped.options, "the same options and environment object as an unwrapped start: none added, INVOCATION_ID included");
  killServer();
});

test("a session scope, an agent's pane, macOS and a running server: the start is today's, byte for byte", () => {
  const sys = systemDir(RUNS_COMMAND);
  for (const [platform, cgroup] of [["linux", SESSION_SCOPE], ["linux", PANE_SCOPE], ["darwin", TICK]]) {
    killServer();
    const { calls, io } = spy({ platform, cgroup, systemToolDirs: [sys.dir] });
    const warnings = [];
    assert.equal(ensureOatsTmuxSession("plain", base, io, undefined, undefined, warnings), OATS);
    const [start] = starts(calls);
    assert.equal(start.bin, TMUX, `${platform} ${cgroup}`); assert.deepEqual(start.args, plainArgs("plain"));
    assert.deepEqual(warnings, []);
  }
  // The server runs and the session exists: nothing is started, wrapped or not.
  const { calls, io } = spy({ platform: "linux", cgroup: TICK, systemToolDirs: [sys.dir] });
  ensureOatsTmuxSession("plain", base, io, undefined, undefined, []);
  assert.deepEqual(starts(calls), []);
  assert.equal(sys.args(), null, "systemd-run never ran");
  killServer();
});

test("the old or hybrid hierarchy: today's start, with the warning only when INVOCATION_ID says it is a service", () => {
  const sys = systemDir(RUNS_COMMAND);
  for (const invocationId of [undefined, "0123abcd"]) {
    killServer();
    const { calls, io } = spy({ platform: "linux", cgroup: V1, invocationId, systemToolDirs: [sys.dir] });
    const warnings = [];
    ensureOatsTmuxSession("legacy", base, io, undefined, undefined, warnings);
    assert.equal(starts(calls)[0].bin, TMUX);
    assert.deepEqual(warnings, invocationId ? [serverScopeWarning({ unit: "oats-schedule-tick.service", reason: "the cgroup hierarchy is not the unified one, so there is no unified cgroup path to judge" })] : []);
  }
  assert.equal(sys.args(), null);
  killServer();
});

test("no systemd-run in the system directories, or one that fails: today's start, and the warning says why", () => {
  for (const [sys, reason] of [
    [systemDir(null), (s) => `no executable systemd-run in ${s.dir}`],
    // The scope's INVOCATION_ID can only be kept out by the system's env: without it, no scope.
    [systemDir(RUNS_COMMAND, { env: false }), (s) => `no executable env in ${s.dir}`],
    [systemDir(`echo 'Failed to connect to bus: No medium found' >&2\nexit 1`), () => "Failed to connect to bus: No medium found"],
  ]) {
    killServer();
    const { calls, io } = spy({ platform: "linux", cgroup: TICK, systemToolDirs: [sys.dir] });
    const warnings = [];
    assert.equal(ensureOatsTmuxSession("fallback", base, io, undefined, undefined, warnings), OATS);
    assert.deepEqual(sessions(), ["fallback"]);
    const plain = starts(calls).filter((c) => c.bin === TMUX);
    assert.equal(plain.length, 1); assert.deepEqual(plain[0].args, plainArgs("fallback"));
    assert.deepEqual(warnings, [serverScopeWarning({ unit: "oats-schedule-tick.service", reason: reason(sys) })]);
  }
  killServer();
});

test("a wrapped start that fails while another creator's server now answers: success, no warning, no second start", () => {
  killServer();
  // The other creator wins: the session exists when systemd-run refuses the unit it already holds.
  const sys = systemDir(`while [ "$1" != "--" ]; do shift; done; shift\n"$@" >/dev/null\necho 'Failed to start transient scope unit: Unit oats-tmux-x.scope already exists.' >&2\nexit 1`);
  const { calls, io } = spy({ platform: "linux", cgroup: TICK, systemToolDirs: [sys.dir] });
  const warnings = [];
  assert.equal(ensureOatsTmuxSession("raced", base, io, undefined, undefined, warnings), OATS);
  assert.deepEqual(sessions(), ["raced"]);
  assert.deepEqual(warnings, []);
  assert.deepEqual(starts(calls).map((c) => c.bin), [join(sys.dir, "systemd-run")], "no unwrapped start after it");
  killServer();
});

test("a wrapped start that fails with no server: one unwrapped start; when that fails too, today's error", () => {
  killServer();
  const sys = systemDir(`echo 'tmux: could not start' >&2\nexit 1`);
  const started = [];
  const exec = (bin, args, options) => {
    if (args.includes("new-session")) started.push(bin);
    if (bin === TMUX && args.includes("new-session")) throw Object.assign(new Error("tmux new-session failed"), { status: 1, stderr: "fixture: plain start refused\n" });
    return execFileSync(bin, args, options);
  };
  const warnings = [];
  assert.throws(() => ensureOatsTmuxSession("failing", base, { exec, platform: "linux", cgroup: TICK, systemToolDirs: [sys.dir] }, undefined, undefined, warnings),
    (e) => e.code === "E_RUNTIME_ENDPOINT_UNKNOWN" && /fixture: plain start refused/.test(e.message));
  assert.deepEqual(started, [join(sys.dir, "systemd-run"), TMUX], "the wrapped start, then exactly one unwrapped start");
  assert.deepEqual(warnings, [], "nothing was started, so nothing is said to live inside the service");
  assert.deepEqual(sessions(), []);
});

test("a scope a dead server left behind (a process outlived it) does not block a later wrapped start", () => {
  killServer();
  // systemd refuses a unit name it has loaded: a scope stays loaded while any process is left in it.
  const sys = systemDir(`name=; prev=; for a do [ "$prev" = "--unit" ] && name=$a; prev=$a; done
loaded='${join(base, `loaded-${n + 1}`)}'
if grep -qx "$name" "$loaded" 2>/dev/null; then echo "Failed to start transient scope unit: Unit $name.scope was already loaded or has a fragment file." >&2; exit 1; fi
echo "$name" >> "$loaded"
${RUNS_COMMAND}`);
  const first = spy({ platform: "linux", cgroup: TICK, systemToolDirs: [sys.dir] });
  ensureOatsTmuxSession("left", base, first.io, undefined, undefined, []);
  killServer(); // its scope stays loaded: the fake never forgets a name
  const second = spy({ platform: "linux", cgroup: TICK, systemToolDirs: [sys.dir] });
  const warnings = [];
  assert.equal(ensureOatsTmuxSession("left", base, second.io, undefined, undefined, warnings), OATS);
  assert.deepEqual(warnings, [], "started in a scope of its own again, not inside the service");
  assert.deepEqual(starts(second.calls).map((c) => c.bin), [join(sys.dir, "systemd-run")]);
  assert.notEqual(starts(second.calls)[0].args[5], starts(first.calls)[0].args[5]);
  killServer();
});

test("a creator that loses the start to another one says nothing about the winner's server", () => {
  killServer();
  const sys = systemDir(RUNS_COMMAND);
  const warnings = [], started = [];
  // B looked and found no server; A starts it before B's wrapped start runs. B's tmux then finds the
  // session (duplicate session), B's scope empties, and B's second lookup finds A's server.
  const exec = (bin, args, options) => {
    if (args.includes("new-session")) {
      started.push(bin);
      if (bin === join(sys.dir, "systemd-run") && started.length === 1) execFileSync(TMUX, plainArgs("raced"), { ...options, stdio: "ignore" });
    }
    return execFileSync(bin, args, options);
  };
  assert.equal(ensureOatsTmuxSession("raced", base, { exec, platform: "linux", cgroup: TICK, systemToolDirs: [sys.dir] }, undefined, undefined, warnings), OATS);
  assert.deepEqual(sessions(), ["raced"]);
  assert.deepEqual(warnings, [], "B started nothing, so B says nothing");
  assert.deepEqual(started, [join(sys.dir, "systemd-run")], "and starts nothing unwrapped after the race");
  killServer();
});
