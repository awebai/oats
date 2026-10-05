// A pane's environment is its tmux session's, PATH included, whoever creates the window, and the
// harness is looked up on that PATH (awebai/oats#616). docs/execution-targets.md owns the rule.
//
// The incident: a creator's PATH, handed to a new-window client without the state that interprets
// it, made a version-manager wrapper resolve its own bare name forever. The fake wrapper here is
// that shape without mise: it execs its own bare name unless a companion variable is set.
//
// Real tmux, never the operator's: the fixture owns a private TMUX_TMPDIR, so `-L oats` is the
// fixture's own server, and it is killed by socket.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isolateSessionEnvironment, oatsSocket, systemExecutable, waitUntil } from "./helpers/host-fixture.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-pane-path-")));
const restoreEnvironment = isolateSessionEnvironment(base);
const OATS = oatsSocket();
const SYSTEM = join(base, "system-bin"); // the fixture's tools, its tmux wrapper among them
const TMUX = join(SYSTEM, "tmux");
const ENV = systemExecutable("env"), SLEEP = systemExecutable("sleep");
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const lines = (text) => text.split("\n").filter(Boolean);
const envOf = (text) => Object.fromEntries(lines(text).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));

const bin = (name, files) => {
  const dir = join(base, name);
  mkdirSync(dir, { recursive: true });
  for (const [file, body] of Object.entries(files)) { writeFileSync(join(dir, file), body); chmodSync(join(dir, file), 0o755); }
  return dir;
};
// The harness: records the environment it started with, then idles.
const PROBE = `#!/bin/sh\n${ENV} > "$OATS_INSTANCE_HOME/pane-env.txt"\necho $$ > "$OATS_INSTANCE_HOME/harness-ready"\nexec ${SLEEP} 600\n`;
const probeBin = bin("probe-bin", { claude: PROBE });
// A claude only a creator has: it must never run.
const decoyBin = bin("decoy-bin", { claude: `#!/bin/sh\necho ran > "$OATS_INSTANCE_HOME/decoy-ran"\nexit 1\n` });
// The fake wrapper: counts its passes (bounded at 20, so a loop ends), then execs its own bare name,
// with the real tool's directory first only when its companion variable says where that is.
const wrapBin = bin("wrap-bin", { claude: `#!/bin/sh
echo run >> "$OATS_INSTANCE_HOME/runs"
c=0; while read -r _; do c=$((c+1)); done < "$OATS_INSTANCE_HOME/runs"
[ "$c" -ge 20 ] && exit 3
[ -n "$FAKE_STATE" ] && PATH="$FAKE_STATE:$PATH"
exec claude "$@"
` });
const WRAPPER = join(wrapBin, "claude"), PROBE_EXE = join(probeBin, "claude");
const SERVER_PATH = `${probeBin}:${SYSTEM}`;

const fx = v2Deployment({
  souls: { dev: {}, racer: { soul: { capabilities: { "test.racer": { from: "here" } } } } },
  // A spawn hook that, when asked, creates the spawn's session first, with its own PATH: another
  // creator that wins the race between the spawn's plan and its creation.
  capabilities: { "test.racer": { manifest: { layer: "knowledge", hooks: { spawn: "spawn.mjs" } }, files: { "spawn.mjs": `import { execFileSync } from "node:child_process";
if (process.env.RACE_KILL) execFileSync(${JSON.stringify(TMUX)}, ["-L", "oats", "kill-server"], { env: { HOME: process.env.HOME, TMUX_TMPDIR: process.env.TMUX_TMPDIR, LANG: "C.UTF-8" }, stdio: "ignore", timeout: 10000 });
if (process.env.RACE_SESSION) execFileSync(${JSON.stringify(TMUX)}, ["-L", "oats", "new-session", "-d", "-s", process.env.RACE_SESSION, "-n", "hq"], { env: { HOME: process.env.HOME, TMUX_TMPDIR: process.env.TMUX_TMPDIR, PATH: process.env.RACE_PATH, SHELL: "/bin/sh", LANG: "C.UTF-8" }, stdio: "ignore", timeout: 10000 });
process.stdout.write("{}\\n");
` } } },
  local: { "launch-configs": {
    abs: { harness: "claude", executable: PROBE_EXE },
    wrapped: { harness: "claude", executable: WRAPPER },
    withpath: { harness: "claude", env: { PATH: SERVER_PATH } },
    frompath: { harness: "claude", env: { PATH: { fromEnv: "FIXTURE_LAUNCH_PATH" } } },
    bare: { harness: "claude", executable: "claude" },
  } },
});

const tmuxOn = (...args) => execFileSync(TMUX, ["-u", "-S", OATS, ...args], { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"] }).trim();
async function killServer() {
  let pid;
  try { pid = Number(tmuxOn("display-message", "-p", "#{pid}")); } catch { return; }
  tmuxOn("kill-server");
  await waitUntil(() => { try { process.kill(pid, 0); return false; } catch { return true; } }, "the fixture's oats server has exited");
}
/** A fresh OATS server whose global environment is `env` (PATH `path`), with session `session`. */
async function startServer(path, session = "base", env = {}) {
  await killServer();
  execFileSync(TMUX, ["-L", "oats", "new-session", "-d", "-s", session, "-n", "hq", "-c", base], { env: { HOME: process.env.HOME, TMUX_TMPDIR: process.env.TMUX_TMPDIR, SHELL: "/bin/sh", LANG: "C.UTF-8", PATH: path, ...env }, stdio: "ignore", timeout: 10000 });
}
const newSession = (session) => tmuxOn("new-session", "-d", "-s", session, "-n", "hq", "-c", base);
const spawn = (name, { session = "base", path, env = {}, config } = {}) => fx.cli(["spawn", "dev", "--name", name, ...(config ? ["--launch-config", config] : ["--harness", "claude"]), "--json"], { env: { OATS_TMUX_SESSION: session, PI_AGENTS_TMUX_SESSION: session, LANG: "C.UTF-8", PATH: path, ...env } });
const spawned = (r) => { assert.equal(r.status, 0, r.stdout + r.stderr); return r.json().result; };
const ready = (home) => waitUntil(() => existsSync(join(home, "harness-ready")), `${home} harness started`);
const paneEnv = (home) => envOf(readFileSync(join(home, "pane-env.txt"), "utf8"));
const shimOf = (home) => join(home, ".oats", "bin");
const executableOf = (home) => readJson(join(home, "instance.json")).launch.executable;
const runs = (home) => { try { return lines(readFileSync(join(home, "runs"), "utf8")).length; } catch { return 0; } };
const homeOf = (name) => join(fx.root, "dev", "instances", name);
/** A refused spawn: its code, nothing left behind, and none of the PATH values in what it printed. */
function refused(r, name, code = "E_HARNESS_UNAVAILABLE") {
  assert.notEqual(r.status, 0, r.stdout);
  const error = r.json().error;
  assert.equal(error.code, code, error.message);
  assert.equal(existsSync(homeOf(name)), false, "nothing is left of the spawn");
  for (const value of [probeBin, decoyBin, SYSTEM, "/fixture/"]) assert.equal((r.stdout + r.stderr).includes(value), false, `no PATH value is printed: ${error.message}`);
  return error.message;
}
/** A fake login shell (OATS_TEST_LOGIN_SHELL, named bash; never the operator's): it sets the fixture's
 *  HOME, a plain shell and `path`, then runs the kernel's emitter. */
let shells = 0;
function loginShell(path) {
  const dir = join(base, `login-shell-${++shells}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "bash"), `#!/bin/sh\nexport HOME=${shq(process.env.HOME)} SHELL=/bin/sh LOGIN_MARKER=login PATH=${shq(path)}\nexec /bin/sh -c "$4"\n`);
  chmodSync(join(dir, "bash"), 0o755);
  return join(dir, "bash");
}
const REMEDIES = /declare the executable's absolute path in the launch configuration \(executable\), set PATH in the launch configuration \(env\), or start the OATS tmux server from your own shell/;

test.after(async () => {
  await killServer();
  restoreEnvironment();
  rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  fx.cleanup();
});

test("tmux gives a pane its session's environment over the server's, PATH included, when the window's client has no PATH; a client's PATH replaces it (the old rule this replaces)", async () => {
  await startServer(`/usr/bin:/bin:/fixture/global`);
  const seen = join(base, "tmux-rule");
  mkdirSync(seen);
  /** A window whose client runs with exactly `clientEnv`. */
  const client = (name, clientEnv, session = "base") => execFileSync(TMUX, ["-u", "-S", OATS, "new-window", "-d", "-t", `=${session}:`, "-n", name, `${ENV} > ${shq(join(seen, name))}; exec ${SLEEP} 30`], { env: clientEnv, stdio: "ignore", timeout: 10000 });
  client("no-path", { LANG: "C.UTF-8" });
  client("with-path", { LANG: "C.UTF-8", PATH: "/usr/bin:/bin:/fixture/client" });
  newSession("override");
  tmuxOn("set-environment", "-t", "=override", "PATH", "/usr/bin:/bin:/fixture/session");
  client("session-path", { LANG: "C.UTF-8" }, "override");
  await waitUntil(() => ["no-path", "with-path", "session-path"].every((f) => existsSync(join(seen, f)) && readFileSync(join(seen, f), "utf8").includes("PATH=")), "the three panes wrote their environment");
  const pathOf = (f) => envOf(readFileSync(join(seen, f), "utf8")).PATH;
  assert.equal(pathOf("no-path"), "/usr/bin:/bin:/fixture/global", "no client PATH: the server's");
  assert.equal(pathOf("with-path"), "/usr/bin:/bin:/fixture/client", "a client PATH: the client's");
  assert.equal(pathOf("session-path"), "/usr/bin:/bin:/fixture/session", "no client PATH and a session PATH: the session's");
});

test("a fake version-manager wrapper whose PATH arrives without its companion state loops under the old client-PATH handoff, and runs once now that a pane takes the server's PATH", async () => {
  // A coherent server: the real tool's directory, no wrapper directory, no companion variable.
  await startServer(`${probeBin}:${SYSTEM}`);
  // The creator runs inside the wrapper: the wrapper's directory first, then the real tool's, and the
  // companion variable that interprets them.
  const creatorPath = `${wrapBin}:${probeBin}:${SYSTEM}`;
  // The old handoff, replayed by hand: a window client that carries the creator's PATH and nothing
  // else of it. The wrapper finds itself again and again (bounded at 20 passes).
  const replay = join(base, "replay");
  mkdirSync(replay);
  execFileSync(TMUX, ["-u", "-S", OATS, "new-window", "-d", "-t", "=base:", "-n", "replay", "-c", replay, `OATS_INSTANCE_HOME=${shq(replay)} PATH=${shq(replay)}:"$PATH" ${shq(WRAPPER)}`], { env: { LANG: "C.UTF-8", PATH: creatorPath }, stdio: "ignore", timeout: 10000 });
  await waitUntil(() => runs(replay) >= 20, "the replayed wrapper looping to its bound");
  assert.equal(existsSync(join(replay, "harness-ready")), false, "the real tool never ran under the old handoff");
  // Now, through OATS, from inside an instance (the incident) and from another creator: the wrapper
  // is the declared executable, and it runs once.
  const parent = spawned(spawn("wrap-parent", { path: `${probeBin}:${SYSTEM}`, env: {} }));
  for (const [name, env] of [["wrap-child", { OATS_INSTANCE: "wrap-parent", OATS_INSTANCE_HOME: parent.home }], ["wrap-operator", {}]]) {
    const child = spawned(spawn(name, { path: creatorPath, config: "wrapped", env: { ...env, FAKE_STATE: probeBin } }));
    await ready(child.home);
    assert.equal(runs(child.home), 1, `${name}: the wrapper ran once, then the real tool`);
    assert.equal(paneEnv(child.home).FAKE_STATE, undefined, "the creator's companion variable is not in the pane");
  }
});

test("no creator, an instance or another, passes PATH to the window's client: the pane's PATH is its own shim and then the server's, with no directory only the creator has, and the harness is the server's", async () => {
  await startServer(SERVER_PATH);
  const clientSeen = join(base, "client-env");
  const front = bin("front-bin", { tmux: `#!/bin/sh\ncase " $* " in *" new-window "*) ${ENV} > ${shq(clientSeen)} ;; esac\nexec ${shq(TMUX)} "$@"\n` });
  const parent = spawned(spawn("client-parent", { path: SERVER_PATH }));
  for (const [name, env] of [["client-child", { OATS_INSTANCE: "client-parent", OATS_INSTANCE_HOME: parent.home }], ["client-operator", {}]]) {
    rmSync(clientSeen, { force: true });
    // The creator's own claude comes first on its PATH: a pane must not get it.
    const child = spawned(spawn(name, { path: `${front}:${decoyBin}:${SERVER_PATH}`, env }));
    await ready(child.home);
    const client = envOf(readFileSync(clientSeen, "utf8"));
    assert.equal("PATH" in client, false, `${name}: the new-window client has no PATH`);
    assert.equal(client.LANG, "C.UTF-8", `${name}: it has the creator's locale`);
    assert.equal(paneEnv(child.home).PATH, `${shimOf(child.home)}:${SERVER_PATH}`, `${name}: the pane's PATH`);
    assert.equal(executableOf(child.home), PROBE_EXE, `${name}: the harness is looked up on the server's PATH`);
    assert.equal(existsSync(join(child.home, "decoy-ran")), false);
  }
});

test("a session that does not exist yet on a running server: its pane takes the server's PATH, not the creating process's", async () => {
  await startServer(SERVER_PATH);
  const child = spawned(spawn("late-session", { session: "late", path: `${decoyBin}:${SYSTEM}` }));
  await ready(child.home);
  assert.equal(child.tmux.session, "late");
  assert.equal(executableOf(child.home), PROBE_EXE);
  assert.equal(paneEnv(child.home).PATH, `${shimOf(child.home)}:${SERVER_PATH}`);
});

test("two creators with different plans: the spawn that loses the server's creation looks its harness up again on the winner's PATH, or is refused and compensated when the winner's PATH has none", async () => {
  // The racer's spawn hook creates the session after the spawn planned (no server then: its plan is
  // its own environment, where only the decoy is) and before the spawn creates it.
  await killServer();
  let r = fx.cli(["spawn", "racer", "--name", "race-lost", "--harness", "claude", "--json"], { env: { OATS_TMUX_SESSION: "race", PI_AGENTS_TMUX_SESSION: "race", LANG: "C.UTF-8", PATH: `${decoyBin}:${SYSTEM}`, RACE_SESSION: "race", RACE_PATH: SERVER_PATH } });
  const child = spawned(r);
  await ready(child.home);
  assert.equal(executableOf(child.home), PROBE_EXE, "the winner's harness, recorded");
  assert.ok(readJson(join(child.home, "instance.json")).command.includes(PROBE_EXE), "and in the command");
  assert.equal(existsSync(join(child.home, "decoy-ran")), false, "the decoy the plan found never ran");
  assert.equal(paneEnv(child.home).PATH, `${shimOf(child.home)}:${SERVER_PATH}`);
  // The winner's PATH holds no harness: refused after the session was created, and the spawn is undone.
  await killServer();
  r = fx.cli(["spawn", "racer", "--name", "race-none", "--harness", "claude", "--json"], { env: { OATS_TMUX_SESSION: "race", PI_AGENTS_TMUX_SESSION: "race", LANG: "C.UTF-8", PATH: `${decoyBin}:${SYSTEM}`, RACE_SESSION: "race", RACE_PATH: SYSTEM } });
  assert.notEqual(r.status, 0, r.stdout);
  assert.equal(r.json().error.code, "E_HARNESS_UNAVAILABLE", r.json().error.message);
  assert.match(r.json().error.message, /claude was not found on the global PATH of the OATS tmux server/);
  assert.match(r.json().error.message, /spawn rolled back/);
  assert.equal(existsSync(join(fx.root, "racer", "instances", "race-none")), false, "the home was removed");
  assert.deepEqual(lines(tmuxOn("list-windows", "-t", "=race", "-F", "#{window_name}")), ["hq"], "no window was left");
});

test("a session whose environment overrides PATH: the pane takes the session's PATH, and the harness is looked up there", async () => {
  await startServer(`${decoyBin}:${SYSTEM}`);
  newSession("own-path");
  tmuxOn("set-environment", "-t", "=own-path", "PATH", SERVER_PATH);
  const child = spawned(spawn("session-path", { session: "own-path", path: `${decoyBin}:${SYSTEM}` }));
  await ready(child.home);
  assert.equal(executableOf(child.home), PROBE_EXE);
  assert.equal(paneEnv(child.home).PATH, `${shimOf(child.home)}:${SERVER_PATH}`);
  assert.equal(existsSync(join(child.home, "decoy-ran")), false);
});

test("the four states of a session's PATH: no entry uses the server's; a present empty value is used as it is; an explicit clear and a value the strict reader rejects are refused, never substituted", async () => {
  await startServer(SERVER_PATH); // the server's PATH holds the harness: a substitution would find it
  newSession("s-none");
  const child = spawned(spawn("state-none", { session: "s-none", path: SYSTEM }));
  assert.equal(executableOf(child.home), PROBE_EXE, "no entry: the server's PATH");
  newSession("s-empty");
  tmuxOn("set-environment", "-t", "=s-empty", "PATH", "");
  let message = refused(spawn("state-empty", { session: "s-empty", path: SERVER_PATH }), "state-empty");
  assert.match(message, /claude was not found on the PATH of tmux session s-empty/, "an empty PATH is looked up as it is");
  assert.match(message, REMEDIES);
  newSession("s-cleared");
  tmuxOn("set-environment", "-t", "=s-cleared", "-r", "PATH");
  assert.match(tmuxOn("show-environment", "-t", "=s-cleared", "-s"), /^unset PATH;$/m);
  message = refused(spawn("state-cleared", { session: "s-cleared", path: SERVER_PATH }), "state-cleared");
  assert.match(message, /tmux session s-cleared clears PATH \(unset PATH\), so its panes start with no PATH at all/);
  assert.match(message, REMEDIES);
  newSession("s-unreadable");
  tmuxOn("set-environment", "-t", "=s-unreadable", "PATH", `${probeBin}:/fixture/$HOME/bin`);
  message = refused(spawn("state-unreadable", { session: "s-unreadable", path: SERVER_PATH }), "state-unreadable");
  assert.match(message, /the PATH of tmux session s-unreadable cannot be read as data/);
  assert.match(message, REMEDIES);
});

test("precedence: a declared absolute executable is used with no lookup; a launch configuration's PATH is what the lookup uses; neither needs the session's PATH", async () => {
  await startServer(SERVER_PATH);
  newSession("cleared");
  tmuxOn("set-environment", "-t", "=cleared", "-r", "PATH");
  const declared = spawned(spawn("declared-exe", { session: "cleared", path: `${decoyBin}:${SYSTEM}`, config: "abs" }));
  await ready(declared.home);
  assert.equal(executableOf(declared.home), PROBE_EXE);
  const configured = spawned(spawn("configured-path", { session: "cleared", path: `${decoyBin}:${SYSTEM}`, config: "withpath" }));
  await ready(configured.home);
  assert.equal(executableOf(configured.home), PROBE_EXE, "looked up on the configuration's PATH");
  assert.equal(paneEnv(configured.home).PATH, `${shimOf(configured.home)}:${SERVER_PATH}`, "which is the pane's");
});

test("a harness found only on the creating process's PATH is refused before anything is created: the message names where it looked and the remedies, never a PATH's contents", async () => {
  await startServer(SYSTEM);
  const message = refused(spawn("caller-only", { path: SERVER_PATH }), "caller-only");
  assert.match(message, /^claude is not available to its pane: claude was not found on the global PATH of the OATS tmux server \(/);
  assert.match(message, REMEDIES);
  assert.deepEqual(lines(tmuxOn("list-windows", "-t", "=base", "-F", "#{window_name}")), ["hq"]);
});

test("a start: under a new selection the harness is looked up on the pane's PATH, before anything is stopped, and refused when it is not there; a start that reuses the recorded executable keeps it", async () => {
  await startServer(SERVER_PATH);
  const start = (home, extra = [], path = `${decoyBin}:${SYSTEM}`) => fx.cli(["session", "start", "--home", home, ...extra, "--json"], { env: { LANG: "C.UTF-8", PATH: path } });
  const unlaunched = (name, path) => spawned(fx.cli(["spawn", "dev", "--name", name, "--harness", "claude", "--no-launch", "--json"], { env: { OATS_TMUX_SESSION: "base", PI_AGENTS_TMUX_SESSION: "base", LANG: "C.UTF-8", PATH: path } }));
  // --no-launch looks the harness up on the creating process's PATH, as before: the decoy.
  const selected = unlaunched("start-selected", `${decoyBin}:${SYSTEM}`);
  assert.equal(executableOf(selected.home), join(decoyBin, "claude"));
  let r = start(selected.home, ["--harness", "claude"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  await ready(selected.home);
  assert.equal(executableOf(selected.home), PROBE_EXE, "the new selection is looked up on the server's PATH, and recorded");
  assert.equal(existsSync(join(selected.home, "decoy-ran")), false);
  // A frozen start keeps its recorded path, whatever the server's PATH holds.
  const frozen = unlaunched("start-frozen", SERVER_PATH);
  await startServer(SYSTEM);
  r = start(frozen.home);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  await ready(frozen.home);
  assert.equal(executableOf(frozen.home), PROBE_EXE);
  // A new selection on a server whose PATH has no harness: refused, nothing started.
  const none = unlaunched("start-none", SERVER_PATH);
  r = start(none.home, ["--harness", "claude"], SERVER_PATH);
  assert.notEqual(r.status, 0, r.stdout);
  assert.equal(r.json().error.code, "E_HARNESS_UNAVAILABLE", r.json().error.message);
  assert.match(r.json().error.message, /claude was not found on the global PATH of the OATS tmux server/);
  assert.equal(existsSync(join(none.home, "harness-ready")), false);
  assert.equal(readJson(join(none.home, "instance.json")).launched, false, "nothing was recorded as started");
  assert.deepEqual(lines(tmuxOn("list-windows", "-t", "=base", "-F", "#{window_name}")), ["hq", "start-frozen"]);
});

test("a start under a new selection with no OATS server running looks its harness up on the PATH the server will be created with (the login environment), never the creating process's, and is refused when that PATH has none, with no server started", async () => {
  const unlaunched = (name) => spawned(fx.cli(["spawn", "dev", "--name", name, "--harness", "claude", "--no-launch", "--json"], { env: { OATS_TMUX_SESSION: "boot", PI_AGENTS_TMUX_SESSION: "boot", LANG: "C.UTF-8", PATH: `${decoyBin}:${SYSTEM}` } }));
  const start = (home, loginPath) => fx.cli(["session", "start", "--home", home, "--harness", "claude", "--json"], { env: { LANG: "C.UTF-8", PATH: `${decoyBin}:${SYSTEM}`, OATS_TEST_LOGIN_SHELL: loginShell(loginPath) } });
  const found = unlaunched("boot-found");
  await killServer();
  let r = start(found.home, SERVER_PATH);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  await ready(found.home);
  assert.equal(executableOf(found.home), PROBE_EXE, "the login PATH's harness, recorded");
  assert.equal(existsSync(join(found.home, "decoy-ran")), false, "the creator's never ran");
  assert.equal(paneEnv(found.home).LOGIN_MARKER, "login", "the server was started with the login environment");
  const none = unlaunched("boot-none");
  await killServer();
  r = start(none.home, SYSTEM);
  assert.notEqual(r.status, 0, r.stdout);
  assert.equal(r.json().error.code, "E_HARNESS_UNAVAILABLE", r.json().error.message);
  assert.match(r.json().error.message, /claude was not found on the PATH the OATS tmux server is created with/);
  assert.throws(() => tmuxOn("list-sessions"), "no server was started");
  assert.equal(readJson(join(none.home, "instance.json")).launched, false);
});

test("a restart of a running instance under a new selection whose harness is not on its pane's PATH is refused before the running harness is stopped", async () => {
  await startServer(SERVER_PATH);
  const running = spawned(spawn("restart-running", { path: SERVER_PATH }));
  await ready(running.home);
  const pid = Number(readFileSync(join(running.home, "harness-ready"), "utf8").trim());
  tmuxOn("set-environment", "-g", "PATH", SYSTEM);
  const r = fx.cli(["session", "restart", "--home", running.home, "--harness", "claude", "--json"], { env: { LANG: "C.UTF-8", PATH: SERVER_PATH } });
  assert.notEqual(r.status, 0, r.stdout);
  assert.equal(r.json().error.code, "E_HARNESS_UNAVAILABLE", r.json().error.message);
  assert.doesNotThrow(() => process.kill(pid, 0), "the running harness was not stopped");
});

test("a declared bare executable is looked up on the pane's PATH (E_LAUNCH_EXECUTABLE when it is not there), and a launch configuration's PATH given as a reference is the lookup's", async () => {
  await startServer(SYSTEM);
  const message = refused(spawn("bare-missing", { path: SERVER_PATH, config: "bare" }), "bare-missing", "E_LAUNCH_EXECUTABLE");
  assert.match(message, /launch configuration bare: claude was not found on the global PATH of the OATS tmux server/);
  const child = spawned(spawn("from-env-path", { path: `${decoyBin}:${SYSTEM}`, config: "frompath", env: { FIXTURE_LAUNCH_PATH: SERVER_PATH } }));
  await ready(child.home);
  assert.equal(executableOf(child.home), PROBE_EXE, "looked up on the referenced PATH");
});

test("a server that exits between a spawn's plan and its creation is started again with what a server start gets (the login environment), not with what the plan read for the running one", async () => {
  await startServer(SERVER_PATH);
  // The racer's spawn hook kills the server after the plan (which saw it running) and before the creation.
  const r = fx.cli(["spawn", "racer", "--name", "race-gone", "--harness", "claude", "--json"], { env: { OATS_TMUX_SESSION: "gone", PI_AGENTS_TMUX_SESSION: "gone", LANG: "C.UTF-8", PATH: `${decoyBin}:${SERVER_PATH}`, RACE_KILL: "1", OATS_TEST_LOGIN_SHELL: loginShell(SERVER_PATH) } });
  const child = spawned(r);
  await ready(child.home);
  assert.equal(paneEnv(child.home).LOGIN_MARKER, "login", "the new server has the login environment");
  assert.equal(executableOf(child.home), PROBE_EXE, "and its harness");
  assert.equal(existsSync(join(child.home, "decoy-ran")), false);
});
