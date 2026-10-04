// OATS sessions run on an OATS-owned tmux server (awebai/oats#602, part 1): `tmux -L oats`.
//
// New sessions are created there, so a tool that restyles the user's default server cannot reach an
// agent terminal; a home recorded on another server keeps working where it is, and moves only when
// its window has to be created again. docs/execution-targets.md owns the rule.
//
// Real tmux throughout, never the operator's: the fixture owns a private TMUX_TMPDIR, so `-L oats`
// is the fixture's own server, and every other server here is a socket inside the fixture. OTHER
// stands for a server OATS did not choose (a user's default server, where homes started before this
// change live). The fixture's HOME has a .tmux.conf, loaded as a user's is: it binds a key and sets
// global styles, a cursor colour and a window size that an OATS window must not inherit.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ensureOatsTmuxSession, inputInstanceSession, inspectInstanceSession, parseTmuxShellEnvironment, restartInstanceSession, retireInstance, shellWord, startInstanceSession } from "../lib/core.mjs";
import { prepareSessionViewer } from "../lib/session-viewer.mjs";
import { readEvents } from "../lib/instance-events.mjs";
import { isolateSessionEnvironment, oatsSocket, systemExecutable, waitUntil } from "./helpers/host-fixture.mjs";
import { git, v2Deployment } from "./helpers/v2-deployment.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const CORE = pathToFileURL(resolve(new URL("../lib/core.mjs", import.meta.url).pathname)).href;
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

const REAL_TMUX = systemExecutable("tmux"); // for the "plain tmux" a user types: no -L, no -S
const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-own-tmux-")));
const restoreEnvironment = isolateSessionEnvironment(base, { userConfig: true });
const WRAPPER = join(base, "system-bin", "tmux");
const OATS = oatsSocket();
const OTHER = join(base, "default.sock");
const DEFAULT = join(dirname(OATS), "default"); // the default server of the same private TMUX_TMPDIR
const SESSION = "own";
const USER_TMUX_CONF = [
  "bind-key -T prefix F9 display-message oats-fixture-binding",
  "set-option -g default-shell /bin/sh",
  "set-option -g window-style fg=red,bg=blue",
  "set-option -g window-active-style fg=green",
  "set-option -g cursor-colour red",
  "set-option -g window-size smallest",
  "set-option -ga update-environment FIXTURE_IDENTITY",
  "",
].join("\n");
writeFileSync(join(process.env.HOME, ".tmux.conf"), USER_TMUX_CONF);

const tmuxOn = (socket, ...args) => execFileSync("tmux", ["-u", "-S", socket, ...args], { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"] }).trim();
const lines = (text) => text.split("\n").filter(Boolean);
const windowsOf = (socket, session = SESSION) => { try { return lines(tmuxOn(socket, "list-windows", "-t", `=${session}`, "-F", "#{window_name}")); } catch { return []; } };
const sessionsOf = (socket) => { try { return lines(tmuxOn(socket, "list-sessions", "-F", "#{session_name}")); } catch { return []; } };
const panesOf = (socket) => lines(tmuxOn(socket, "list-panes", "-a", "-F", "#{session_name}:#{window_name}"));
const windowId = (socket, window, session = SESSION) => tmuxOn(socket, "display-message", "-p", "-t", `=${session}:=${window}`, "#{window_id}");
/** A window's own value of an option: empty when the window does not override it. */
const localOption = (socket, id, option) => tmuxOn(socket, "show-options", "-q", "-w", "-v", "-t", id, option);
const localOptions = (socket, id) => tmuxOn(socket, "show-options", "-w", "-t", id);
const globalOption = (socket, option) => tmuxOn(socket, "show-options", "-g", "-w", "-v", option);
/** Everything a server holds beyond its sessions: its options at each global scope and its environment. */
const serverState = (socket) => ({
  server: tmuxOn(socket, "show-options", "-s"),
  session: tmuxOn(socket, "show-options", "-g"),
  window: tmuxOn(socket, "show-options", "-g", "-w"),
  environment: tmuxOn(socket, "show-environment", "-g"),
});
/** Kill the server on a fixture socket and wait until it no longer answers. */
async function killServer(socket) {
  const pid = Number(tmuxOn(socket, "display-message", "-p", "#{pid}"));
  tmuxOn(socket, "kill-server");
  await waitUntil(() => { try { process.kill(pid, 0); return false; } catch { return true; } }, `the server on ${socket} has exited`);
}
const ensureSession = (socket, session = SESSION) => { if (!sessionsOf(socket).includes(session)) tmuxOn(socket, "new-session", "-d", "-s", session, "-n", "hq", "-c", base); };
const OATS_WINDOW = { "window-style": "default", "window-active-style": "default", "cursor-colour": "default", "window-size": "latest", "aggressive-resize": "on" };
const ownOptions = (socket, id) => Object.fromEntries(Object.keys(OATS_WINDOW).map((option) => [option, localOption(socket, id, option)]));
const UNSET = Object.fromEntries(Object.keys(OATS_WINDOW).map((option) => [option, ""]));
const USER_GLOBALS = { "window-style": "fg=red,bg=blue", "window-active-style": "fg=green", "cursor-colour": "red", "window-size": "smallest", "aggressive-resize": "off" };
const userGlobals = (socket) => Object.fromEntries(Object.keys(USER_GLOBALS).map((option) => [option, globalOption(socket, option)]));

// One inert "harness" for every pane: it records the environment it was started with, then idles
// as `sleep` (a pane holding only shells reads as the fallback prompt).
const probeBin = join(base, "probe-bin");
mkdirSync(probeBin);
const probe = join(probeBin, "claude");
writeFileSync(probe, `#!/bin/sh\nenv > "$OATS_INSTANCE_HOME/pane-env.txt"\necho $$ > "$OATS_INSTANCE_HOME/harness-ready"\nexec sleep 600\n`);
chmodSync(probe, 0o755);
const fx = v2Deployment();
writeFileSync(join(fx.env.HOME, ".tmux.conf"), USER_TMUX_CONF); // the CLI runs with the deployment fixture's HOME
const spawnPath = `${probeBin}:${fx.env.PATH}`;
const harnessPid = (home) => {
  try {
    const pid = Number(readFileSync(join(home, "harness-ready"), "utf8").trim());
    if (!Number.isSafeInteger(pid) || pid <= 1) return null;
    return execFileSync("ps", ["-o", "comm=", "-p", String(pid)], { encoding: "utf8" }).trim() === "sleep" ? pid : null;
  } catch { return null; }
};
const ready = (home) => waitUntil(() => harnessPid(home) !== null, `${home} harness idle`);
const paneEnv = (home) => Object.fromEntries(lines(readFileSync(join(home, "pane-env.txt"), "utf8")).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const warningsOf = (home) => readEvents(home).events.filter((e) => e.kind === "launch-warning").map((e) => e.data.message);
const baselineOf = (home) => join(dirname(home), ".oats-retirement", "baselines", `${createHash("sha256").update(home).digest("hex")}.json`);
const withPath = async (path, fn) => { const saved = process.env.PATH; process.env.PATH = path; try { return await fn(); } finally { process.env.PATH = saved; } };

/** A real workspace-model home with a frozen launch command, recorded as launched on `on` (a socket)
 *  or never launched. */
async function makeHome(name, { on, session = SESSION, deployment = fx } = {}) {
  const { home } = await withPath(deployment.env.PATH, () => deployment.spawn("dev", { name, harness: "claude" }));
  writeFileSync(join(home, "TASK.md"), "task\n");
  const command = `OATS_INSTANCE=${shq(name)} OATS_INSTANCE_HOME=${shq(home)} ${shq(probe)} --dangerously-skip-permissions -- "$(cat TASK.md)"`;
  const { launch: _recipe, ...spawned } = readJson(join(home, "instance.json"));
  writeFileSync(join(home, "instance.json"), JSON.stringify({ ...spawned, tmux: { session, window: name, ...(on ? { socket: on } : {}) }, command, launched: !!on }, null, 2) + "\n");
  writeFileSync(baselineOf(home), JSON.stringify({ ...readJson(baselineOf(home)), runtime: on ? { launched: true, tmux: { session, window: name, socket: on } } : { launched: false } }, null, 2) + "\n", { mode: 0o600 });
  return { name, home, command, session };
}
const recorded = (home) => ({ meta: readJson(join(home, "instance.json")).tmux, receipt: readJson(baselineOf(home)).runtime });
const both = (session, window, socket) => ({ meta: { session, window, socket }, receipt: { launched: true, tmux: { session, window, socket } } });
/** A tmux in front of the fixture's: `body` decides a call before the real one runs. */
function tmuxInFront(name, body) {
  const dir = join(base, name);
  mkdirSync(dir);
  writeFileSync(join(dir, "tmux"), `#!/bin/sh\n${body}\nexec ${shq(WRAPPER)} "$@"\n`);
  chmodSync(join(dir, "tmux"), 0o755);
  return dir;
}

test.after(() => {
  for (const socket of [OTHER, DEFAULT]) { try { execFileSync(REAL_TMUX, ["-S", socket, "kill-server"], { stdio: "ignore", timeout: 10000 }); } catch { /* not running */ } }
  restoreEnvironment(); // kills the fixture's `oats` server, by socket
  rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  fx.cleanup();
});

// The version is in the test's name so that the run's log names the tmux these tests exercised.
const TMUX_VERSION = execFileSync(REAL_TMUX, ["-V"], { encoding: "utf8", timeout: 10000 }).trim();
test(`the tmux these tests run against: ${TMUX_VERSION}`, (t) => {
  t.diagnostic(`tmux -V: ${TMUX_VERSION}`);
  assert.match(TMUX_VERSION, /^tmux /);
});

test("a paste-safe word: left as it is when it needs no quote, single-quoted otherwise, and a shell reads it back", () => {
  const cases = [
    ["/tmp/tmux-1000/oats", "/tmp/tmux-1000/oats"],
    ["oats-agents:dev_1", "oats-agents:dev_1"],
    ["", "''"],
    ["/tmp/a b/oats", "'/tmp/a b/oats'"],
    ["/tmp/it's/oats", `'/tmp/it'\\''s/oats'`],
    ["~/oats", "'~/oats'"],
    ["=oats", "'=oats'"],
    ["a@b", "'a@b'"],
    ["$(touch never)", "'$(touch never)'"],
  ];
  for (const [word, quoted] of cases) {
    assert.equal(shellWord(word), quoted, JSON.stringify(word));
    const read = execFileSync("/bin/sh", ["-c", `for word in ${quoted}; do printf '%s\\n' "$word"; done`], { encoding: "utf8", cwd: base });
    assert.equal(read, `${word}\n`, `a shell reads ${quoted} back as one word`);
  }
  assert.equal(existsSync(join(base, "never")), false);
});

test("a spawn on a host with no OATS server yet: the session is created on the server named oats, its socket is recorded and printed, the pane has no COLORFGBG, the window carries its own colours and sizing, and nothing is set server-global", async () => {
  rmSync(dirname(OATS), { recursive: true, force: true }); // tmux makes its per-user socket directory itself
  // The creating process: a terminal that exports COLORFGBG, inside some other tmux.
  const env = { PATH: spawnPath, OATS_TMUX_SESSION: SESSION, PI_AGENTS_TMUX_SESSION: SESSION, COLORFGBG: "15;0", TMUX: `${join(base, "bogus.sock")},1,0`, TMUX_PANE: "%9" };
  const r = fx.cli(["spawn", "dev", "--name", "fresh", "--harness", "claude", "--json"], { env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const result = r.json().result;
  assert.equal(result.launched, true);
  assert.deepEqual(result.tmux, { session: SESSION, window: "fresh", socket: OATS });
  assert.equal(result.attach, `tmux -S ${OATS} attach -t ${SESSION}`, "the attach line names the recorded socket");
  assert.deepEqual(recorded(result.home), both(SESSION, "fresh", OATS), "instance.json and the lifecycle receipt record the same socket");
  assert.deepEqual(sessionsOf(OATS), [SESSION]);
  assert.equal(existsSync(join(base, "bogus.sock")), false, "an inherited TMUX is not followed");
  assert.equal(existsSync(DEFAULT), false, "nothing was created on the default server");
  await ready(result.home);
  assert.equal("COLORFGBG" in paneEnv(result.home), false, "the pane has no COLORFGBG");
  assert.doesNotMatch(serverState(OATS).environment, /^COLORFGBG=/m, "a server OATS starts does not take COLORFGBG from the creating process");
  assert.match(tmuxOn(OATS, "list-keys", "-T", "prefix"), /F9.*oats-fixture-binding/, "the user's tmux configuration is loaded");
  assert.deepEqual(ownOptions(OATS, windowId(OATS, "fresh")), OATS_WINDOW, "the agent window's own options");
  assert.deepEqual(ownOptions(OATS, windowId(OATS, "hq")), { ...UNSET, "window-size": "latest", "aggressive-resize": "on" }, "the hq window is sized, and nothing else");
  assert.deepEqual(userGlobals(OATS), USER_GLOBALS, "the server's global options are the user's");

  // The text answer prints the same line.
  const text = fx.cli(["spawn", "dev", "--name", "fresh-text", "--harness", "claude"], { env });
  assert.equal(text.status, 0, text.stdout + text.stderr);
  assert.match(text.stdout, new RegExp(`^  attach: tmux -S ${OATS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} attach -t ${SESSION}$`, "m"));
  assert.doesNotMatch(text.stdout, /attach: tmux attach/);
  assert.deepEqual(windowsOf(OATS), ["hq", "fresh", "fresh-text"]);
});

test("plain tmux, as a host tool runs it, addresses the default server: it changes nothing on the OATS server and lists none of its panes", () => {
  const plain = (...args) => execFileSync(REAL_TMUX, args, { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"] }).trim();
  plain("-f", "/dev/null", "new-session", "-d", "-s", "user", "-n", "shell", "sleep 600");
  assert.equal(existsSync(DEFAULT), true, "plain tmux started the default server of the same TMUX_TMPDIR");
  const before = serverState(OATS), panesBefore = panesOf(OATS);
  assert.ok(panesBefore.includes(`${SESSION}:fresh`));
  plain("set-option", "-g", "window-style", "fg=black,bg=magenta");
  plain("set-option", "-g", "cursor-colour", "magenta");
  plain("set-environment", "-g", "COLORFGBG", "0;15");
  const listed = lines(plain("list-panes", "-a", "-F", "#{session_name}:#{window_name}"));
  assert.deepEqual(listed, ["user:shell"], "the default server lists its own panes only");
  assert.deepEqual(serverState(OATS), before, "options and global environment of the OATS server are untouched");
  assert.deepEqual(panesOf(OATS), panesBefore);
  assert.deepEqual(ownOptions(OATS, windowId(OATS, "fresh")), OATS_WINDOW);
  plain("kill-server");
});

test("a server named oats that already runs: a never-launched home's first start opens there, foreign sessions, global options and global environment are exactly as before, and the pane still has no COLORFGBG", async () => {
  await killServer(OATS);
  // Not created by OATS: two foreign sessions, one with its own sizing, and a global COLORFGBG.
  tmuxOn(OATS, "new-session", "-d", "-s", "foreign-sized", "-n", "sized", "sleep 600");
  tmuxOn(OATS, "new-session", "-d", "-s", "foreign-plain", "-n", "plain", "sleep 600");
  const sized = windowId(OATS, "sized", "foreign-sized"), plainWindow = windowId(OATS, "plain", "foreign-plain");
  tmuxOn(OATS, "set-option", "-w", "-t", sized, "window-size", "largest");
  tmuxOn(OATS, "set-option", "-w", "-t", sized, "aggressive-resize", "off");
  tmuxOn(OATS, "set-environment", "-g", "COLORFGBG", "0;15");
  const before = { state: serverState(OATS), sized: localOptions(OATS, sized), plain: localOptions(OATS, plainWindow) };
  assert.match(before.state.environment, /^COLORFGBG=0;15$/m);
  assert.deepEqual(ownOptions(OATS, plainWindow), UNSET, "the plain foreign window overrides none of these options");

  const h = await makeHome("first");
  const r = startInstanceSession(h.home);
  assert.equal(r.reused, "new");
  assert.deepEqual(r.target, { backend: "tmux", session: SESSION, window: "first", socket: OATS });
  assert.deepEqual(r.warnings, [], "a first start moves nothing: no warning");
  assert.deepEqual(recorded(h.home), both(SESSION, "first", OATS));
  assert.deepEqual(warningsOf(h.home), []);
  await ready(h.home);
  assert.equal("COLORFGBG" in paneEnv(h.home), false, "the server's global environment holds COLORFGBG; the pane does not");
  assert.deepEqual(ownOptions(OATS, windowId(OATS, "first")), OATS_WINDOW);
  assert.deepEqual(ownOptions(OATS, windowId(OATS, "hq")), { ...UNSET, "window-size": "latest", "aggressive-resize": "on" });
  assert.deepEqual({ state: serverState(OATS), sized: localOptions(OATS, sized), plain: localOptions(OATS, plainWindow) }, before, "nothing global changed and no foreign window gained an option");
  assert.deepEqual(userGlobals(OATS), USER_GLOBALS);
  assert.deepEqual(sessionsOf(OATS).sort(), ["foreign-plain", "foreign-sized", SESSION]);
  assert.deepEqual(windowsOf(OATS, "foreign-sized"), ["sized"]);
  assert.match(tmuxOn(OATS, "list-keys", "-T", "prefix"), /F9.*oats-fixture-binding/);
});

test("a stale socket left by a killed server: the next start replaces it", async () => {
  const pid = Number(tmuxOn(OATS, "display-message", "-p", "#{pid}"));
  assert.ok(Number.isSafeInteger(pid) && pid > 1);
  process.kill(pid, "SIGKILL");
  await waitUntil(() => { try { process.kill(pid, 0); return false; } catch { return true; } }, "the fixture's oats server is gone");
  assert.equal(existsSync(OATS), true, "the killed server left its socket file");
  const h = await makeHome("after-crash");
  const r = startInstanceSession(h.home);
  assert.equal(r.target.socket, OATS);
  assert.deepEqual(windowsOf(OATS), ["hq", "after-crash"]);
  await ready(h.home);
});

test("a live instance on another server restarts in place: same pane, record unchanged, no warning, no option set", async () => {
  ensureSession(OTHER);
  tmuxOn(OTHER, "set-environment", "-g", "COLORFGBG", "0;15");
  const h = await makeHome("stays", { on: OTHER });
  tmuxOn(OTHER, "new-window", "-d", "-t", `=${SESSION}:`, "-n", "stays", "-c", h.home, `${h.command}; exec /bin/sh`);
  await ready(h.home);
  const pane = tmuxOn(OTHER, "display-message", "-p", "-t", `=${SESSION}:=stays`, "#{pane_id}");
  rmSync(join(h.home, "harness-ready"));
  const r = restartInstanceSession(h.home, { stopGraceMs: 5000 });
  assert.equal(r.reused, "pane");
  assert.deepEqual(r.target, { backend: "tmux", session: SESSION, window: "stays", socket: OTHER });
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(recorded(h.home), both(SESSION, "stays", OTHER), "the record does not change");
  assert.deepEqual(warningsOf(h.home), []);
  assert.equal(tmuxOn(OTHER, "display-message", "-p", "-t", `=${SESSION}:=stays`, "#{pane_id}"), pane);
  assert.equal(windowsOf(OATS).includes("stays"), false, "nothing was opened on the OATS server");
  await ready(h.home);
  assert.equal("COLORFGBG" in paneEnv(h.home), false, "the command a restart runs in place also drops COLORFGBG");
  assert.deepEqual(ownOptions(OTHER, windowId(OTHER, "stays")), UNSET, "a restart in place sets no option: the window keeps what it has");
});

test("a start that has to create the window again opens it on the OATS server and says so: the recorded window is gone, or the recorded server is gone", async () => {
  ensureSession(OTHER);
  const gone = await makeHome("window-gone", { on: OTHER });
  const other = { windows: windowsOf(OTHER), state: serverState(OTHER) };
  let r = startInstanceSession(gone.home);
  assert.equal(r.reused, "new");
  assert.deepEqual(r.target, { backend: "tmux", session: SESSION, window: "window-gone", socket: OATS });
  assert.equal(r.warnings.length, 1, JSON.stringify(r.warnings));
  for (const part of ["window-gone", JSON.stringify(OTHER), JSON.stringify(OATS)]) assert.ok(r.warnings[0].includes(part), `the warning names ${part}: ${r.warnings[0]}`);
  assert.deepEqual(warningsOf(gone.home), r.warnings, "the same text is a launch-warning event");
  assert.deepEqual(recorded(gone.home), both(SESSION, "window-gone", OATS), "the new socket is in both records");
  assert.deepEqual({ windows: windowsOf(OTHER), state: serverState(OTHER) }, other, "the server it left is untouched");
  await ready(gone.home);
  assert.deepEqual(ownOptions(OATS, windowId(OATS, "window-gone")), OATS_WINDOW);
  // Once it lives on the OATS server it stays there, silently.
  rmSync(join(gone.home, "harness-ready"));
  r = restartInstanceSession(gone.home, { stopGraceMs: 5000 });
  assert.equal(r.reused, "pane"); assert.equal(r.target.socket, OATS); assert.deepEqual(r.warnings, []);
  assert.equal(warningsOf(gone.home).length, 1);
  await ready(gone.home);

  // The recorded server is gone: everything reads as it did before this change, and a start moves it.
  const lost = join(base, "lost.sock");
  const dead = await makeHome("server-gone", { on: lost });
  assert.throws(() => inspectInstanceSession(dead.home), (e) => e.code === "E_SESSION_UNAVAILABLE");
  assert.throws(() => inputInstanceSession(dead.home, "hello"), (e) => e.code === "E_SESSION_INPUT_FAILED");
  const status = fx.cli(["status", "--json"]);
  assert.equal(status.status, 0, status.stdout + status.stderr);
  assert.equal(JSON.parse(status.stdout).agents.flatMap((a) => a.instances).find((i) => i.instance === "server-gone").running, false);
  r = startInstanceSession(dead.home);
  assert.deepEqual(r.target, { backend: "tmux", session: SESSION, window: "server-gone", socket: OATS });
  assert.equal(r.warnings.length, 1);
  for (const part of ["server-gone", JSON.stringify(lost), JSON.stringify(OATS)]) assert.ok(r.warnings[0].includes(part), r.warnings[0]);
  assert.deepEqual(warningsOf(dead.home), r.warnings);
  assert.deepEqual(recorded(dead.home), both(SESSION, "server-gone", OATS));
  assert.equal(existsSync(lost), false, "the recorded socket path is not recreated");
  await ready(dead.home);
});

test("a start that moved the window but could not record it: the start that adopts the pending target records the new socket and gives the warning, once", async () => {
  ensureSession(OTHER);
  const h = await makeHome("adopted", { on: OTHER });
  assert.throws(() => startInstanceSession(h.home, { io: { failBeforeMetadataWrite: true } }), (e) => e.code === "E_SESSION_START_INCOMPLETE");
  assert.equal(readJson(join(h.home, ".oats-start-pending.json")).target.socket, OATS, "the pending receipt carries the new target");
  assert.equal(readJson(join(h.home, "instance.json")).tmux.socket, OTHER, "the metadata still names the old socket");
  assert.deepEqual(warningsOf(h.home), [], "a start that could not record says nothing yet");
  await ready(h.home);
  const r = startInstanceSession(h.home);
  assert.equal(r.reused, "adopted");
  assert.deepEqual(r.target, { backend: "tmux", session: SESSION, window: "adopted", socket: OATS });
  assert.equal(r.warnings.length, 1, JSON.stringify(r.warnings));
  for (const part of ["adopted", JSON.stringify(OTHER), JSON.stringify(OATS)]) assert.ok(r.warnings[0].includes(part), r.warnings[0]);
  assert.deepEqual(warningsOf(h.home), r.warnings);
  assert.deepEqual(recorded(h.home), both(SESSION, "adopted", OATS));
  assert.deepEqual(windowsOf(OATS).filter((w) => w === "adopted"), ["adopted"], "adopted, not duplicated");
  assert.throws(() => startInstanceSession(h.home), (e) => e.code === "E_SESSION_RUNNING");
  assert.equal(warningsOf(h.home).length, 1, "the warning is not repeated");
});

test("one deployment, one home on another server and one on the OATS server: status, inspect, input, the viewer and retire each act on the home's own recorded socket", async () => {
  ensureSession(OTHER);
  ensureSession(OATS);
  const homes = { "on-default": OTHER, "on-oats": OATS };
  const made = {};
  for (const [name, socket] of Object.entries(homes)) {
    made[name] = await makeHome(name, { on: socket });
    tmuxOn(socket, "new-window", "-d", "-t", `=${SESSION}:`, "-n", name, "-c", made[name].home, "cat"); // inert: no harness, no delivery
  }
  const rows = () => {
    const r = fx.cli(["status", "--json"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return Object.fromEntries(JSON.parse(r.stdout).agents.flatMap((a) => a.instances).filter((i) => i.instance in homes).map((i) => [i.instance, { running: i.running, socket: i.tmux?.socket }]));
  };
  assert.deepEqual(rows(), { "on-default": { running: true, socket: OTHER }, "on-oats": { running: true, socket: OATS } });
  for (const name of Object.keys(homes)) assert.equal(inspectInstanceSession(made[name].home).present, true, `${name} inspect`);

  // Input reaches the pane on the home's own server, and only that one.
  const screen = (name) => tmuxOn(homes[name], "capture-pane", "-p", "-t", `=${SESSION}:=${name}`);
  assert.equal(inputInstanceSession(made["on-default"].home, "to-the-default-server").submitted, true);
  assert.equal(inputInstanceSession(made["on-oats"].home, "to-the-oats-server").submitted, true);
  await waitUntil(() => screen("on-default").includes("to-the-default-server") && screen("on-oats").includes("to-the-oats-server"), "each pane shows its own input");
  assert.equal(screen("on-default").includes("to-the-oats-server"), false);
  assert.equal(screen("on-oats").includes("to-the-default-server"), false);

  // `oats session attach` builds its viewer on the recorded socket. No terminal here, so the final
  // attach fails; every tmux call it made is logged, and the viewer session is cleaned up.
  const log = join(base, "attach-calls.log");
  const logging = tmuxInFront("logging-bin", `printf '%s\\n' "$*" >> ${shq(log)}`);
  for (const [name, socket] of Object.entries(homes)) {
    writeFileSync(log, "");
    const r = spawnSync(process.execPath, [CLI, "session", "attach", "--home", made[name].home], { encoding: "utf8", env: { ...process.env, PATH: `${logging}:${process.env.PATH}` } });
    assert.notEqual(r.status, 0, "no terminal: the attach itself cannot succeed here");
    const calls = lines(readFileSync(log, "utf8"));
    assert.ok(calls.some((c) => c.includes(" link-window ")) && calls.some((c) => c.includes(" attach-session ")), `${name}: ${calls.join(" | ")}`);
    for (const call of calls) assert.ok(call.startsWith(`-u -S ${socket} `), `${name}: every viewer call names the recorded socket: ${call}`);
  }
  for (const socket of [OTHER, OATS]) assert.deepEqual(sessionsOf(socket).filter((s) => s.startsWith("oatsview-")), [], "the viewer is gone");

  // Liveness is read per row, and retire removes the window on the recorded server.
  tmuxOn(OTHER, "kill-window", "-t", `=${SESSION}:=on-default`);
  assert.deepEqual(rows(), { "on-default": { running: false, socket: OTHER }, "on-oats": { running: true, socket: OATS } });
  tmuxOn(OTHER, "new-window", "-d", "-t", `=${SESSION}:`, "-n", "on-default", "-c", made["on-default"].home, "cat");
  const untouched = windowsOf(OATS);
  assert.equal(retireInstance(fx.root, "on-default").retired, "on-default");
  assert.equal(windowsOf(OTHER).includes("on-default"), false, "retire killed the window on the server the home recorded");
  assert.deepEqual(windowsOf(OATS), untouched);
  const kept = windowsOf(OTHER);
  assert.equal(retireInstance(fx.root, "on-oats").retired, "on-oats");
  assert.equal(windowsOf(OATS).includes("on-oats"), false);
  assert.deepEqual(windowsOf(OTHER), kept);
});

test("option commands tmux refuses: an unknown cursor-colour is no error; a refused sizing command is ignored at session creation and at launch, each on its own, also when the recorded server is gone; a refused window-style is a launch failure, compensated on the recorded socket", async () => {
  // tmux before 3.3 has no cursor-colour: with -q it answers 0 and sets nothing, without -q it fails.
  const noCursor = tmuxInFront("no-cursor-bin", `case " $* " in *" cursor-colour "*) case " $* " in *" -q "*) exit 0 ;; esac; echo 'invalid option: cursor-colour' >&2; exit 1 ;; esac`);
  const old = await makeHome("old-tmux");
  const started = await withPath(`${noCursor}:${process.env.PATH}`, () => startInstanceSession(old.home));
  assert.equal(started.target.socket, OATS);
  assert.deepEqual(ownOptions(OATS, windowId(OATS, "old-tmux")), { ...OATS_WINDOW, "cursor-colour": "" }, "the other options are set; cursor-colour is skipped");
  await ready(old.home);

  // tmux 3.0 has no `window-size latest`: the command's failure is ignored, as it always was.
  const noSize = tmuxInFront("no-size-bin", `case " $* " in *" window-size "*) echo 'unknown value: latest' >&2; exit 1 ;; esac`);
  const env = { PATH: `${noSize}:${spawnPath}`, OATS_TMUX_SESSION: "unsized", PI_AGENTS_TMUX_SESSION: "unsized" };
  let r = fx.cli(["spawn", "dev", "--name", "unsized-spawn", "--harness", "claude", "--json"], { env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(r.json().result.tmux, { session: "unsized", window: "unsized-spawn", socket: OATS });
  assert.deepEqual(ownOptions(OATS, windowId(OATS, "hq", "unsized")), { ...UNSET, "aggressive-resize": "on" }, "the session was created; only the refused option is missing");
  assert.deepEqual(ownOptions(OATS, windowId(OATS, "unsized-spawn", "unsized")), { ...OATS_WINDOW, "window-size": "" });
  const unsized = await makeHome("unsized-start", { session: "unsized-two" });
  assert.equal((await withPath(`${noSize}:${process.env.PATH}`, () => startInstanceSession(unsized.home))).target.socket, OATS);
  assert.deepEqual(ownOptions(OATS, windowId(OATS, "unsized-start", "unsized-two")), { ...OATS_WINDOW, "window-size": "" });
  await ready(unsized.home);

  // The second sizing command is attempted on its own too. And the case that changed: a start whose
  // recorded server is gone used to fail when a sizing command was refused (it recreated that server
  // and set both, uncaught); it now creates the session and the window on the OATS server all the same.
  const noSizing = tmuxInFront("no-sizing-bin", `case " $* " in *" window-size "*|*" aggressive-resize "*) echo 'refused' >&2; exit 1 ;; esac`);
  const lost = join(base, "lost-unsized.sock");
  const stranded = await makeHome("unsized-gone", { on: lost, session: "unsized-three" });
  const moved = await withPath(`${noSizing}:${process.env.PATH}`, () => startInstanceSession(stranded.home));
  assert.deepEqual(moved.target, { backend: "tmux", session: "unsized-three", window: "unsized-gone", socket: OATS });
  assert.equal(moved.warnings.length, 1, JSON.stringify(moved.warnings));
  assert.deepEqual(recorded(stranded.home), both("unsized-three", "unsized-gone", OATS));
  assert.deepEqual(ownOptions(OATS, windowId(OATS, "hq", "unsized-three")), UNSET, "the session was created with neither sizing option");
  assert.deepEqual(ownOptions(OATS, windowId(OATS, "unsized-gone", "unsized-three")), { ...OATS_WINDOW, "window-size": "", "aggressive-resize": "" }, "the colours are set; both sizing options are skipped");
  assert.equal(existsSync(lost), false);
  await ready(stranded.home);

  // A refused window-style is a real failure (a server, permission or transport problem).
  const noStyle = tmuxInFront("no-style-bin", `case " $* " in *" window-style "*) echo 'server exited unexpectedly' >&2; exit 1 ;; esac`);
  const refused = await makeHome("style-start");
  await withPath(`${noStyle}:${process.env.PATH}`, () => assert.throws(() => startInstanceSession(refused.home), (e) => e.code === "E_SESSION_START_FAILED" && /evidence is retained/.test(e.message)));
  assert.deepEqual(readJson(join(refused.home, ".oats-start-pending.json")).target, { backend: "tmux", session: SESSION, window: "style-start", socket: OATS }, "the pending receipt is kept, with the target");
  assert.equal(readJson(join(refused.home, "instance.json")).launched, false, "nothing was recorded as started");
  tmuxOn(OATS, "kill-window", "-t", `=${SESSION}:=style-start`);
  r = fx.cli(["spawn", "dev", "--name", "style-spawn", "--harness", "claude", "--json"], { env: { PATH: `${noStyle}:${spawnPath}`, OATS_TMUX_SESSION: SESSION, PI_AGENTS_TMUX_SESSION: SESSION } });
  assert.notEqual(r.status, 0, r.stdout);
  const error = r.json().error;
  assert.equal(error.code, "E_SPAWN_FAILED", "the CLI's code for a spawn that failed; the kernel's E_SPAWN_LAUNCH_FAILED text follows");
  assert.match(error.message, /tmux set-option failed for style-spawn/);
  assert.ok(error.message.includes(`run tmux -S ${OATS} list-windows -t ${SESSION} to inspect`), `the hint names the socket and the session: ${error.message}`);
  assert.match(error.message, /spawn rolled back/);
  assert.equal(windowsOf(OATS).includes("style-spawn"), false, "the window was removed on the socket the spawn recorded");
  assert.equal(existsSync(join(fx.root, "dev", "instances", "style-spawn")), false);
});

test("two creators of the same absent session both succeed and name one socket", async () => {
  // Interleaved exactly: the session appears between this call's lookup and its create.
  let interleaved = false;
  const io = { exec: (bin, args, options) => {
    if (!interleaved && args.includes("new-session")) { interleaved = true; tmuxOn(OATS, "new-session", "-d", "-s", "raced", "-n", "hq", "-c", base); }
    return execFileSync(bin, args, options);
  } };
  assert.equal(ensureOatsTmuxSession("raced", base, io), OATS);
  assert.equal(interleaved, true);
  assert.deepEqual(sessionsOf(OATS).filter((s) => s === "raced"), ["raced"]);
  // And for real: two processes at once.
  const script = `import(${JSON.stringify(CORE)}).then((core) => process.stdout.write(core.ensureOatsTmuxSession("raced-two", ${JSON.stringify(base)})))`;
  const run = () => new Promise((done, fail) => execFile(process.execPath, ["-e", script], { timeout: 30000 }, (error, stdout, stderr) => (error ? fail(new Error(`${error.message}\n${stderr}`)) : done(stdout))));
  assert.deepEqual(await Promise.all([run(), run()]), [OATS, OATS]);
  assert.deepEqual(sessionsOf(OATS).filter((s) => s === "raced-two"), ["raced-two"]);
  assert.deepEqual(windowsOf(OATS, "raced-two"), ["hq"]);
});

test("viewers at different sizes: the agent window follows the latest client through its own window-size, and detaching leaves the window and its options in place", async () => {
  const h = await makeHome("viewed");
  const target = startInstanceSession(h.home).target;
  await ready(h.home);
  const id = windowId(OATS, "viewed");
  assert.equal(globalOption(OATS, "window-size"), "smallest", "the server's own default is not what sizes the agent window");
  const size = () => tmuxOn(OATS, "display-message", "-p", "-t", id, "#{window_width}x#{window_height}");
  const clients = [];
  /** A viewer as the kernel prepares it, attached by a control-mode client of a given size (no terminal). */
  const view = async (width, height) => {
    const viewer = prepareSessionViewer(target);
    const child = spawn(viewer.binary, [...viewer.args.slice(0, 3), "-C", ...viewer.args.slice(3)], { env: viewer.env, stdio: ["pipe", "pipe", "pipe"] });
    child.stdout.resume(); child.stderr.resume();
    clients.push({ viewer, child });
    child.stdin.write(`refresh-client -C ${width},${height}\n`);
    await waitUntil(() => size() === `${width}x${height}`, `the window follows the ${width}x${height} client (it is ${size()})`);
  };
  try {
    await view(100, 30);
    await view(120, 40); // larger: "smallest" would have kept 100x30
    await view(60, 20); // smaller: "largest" would have kept 120x40
    assert.equal(sessionsOf(OATS).filter((s) => s.startsWith("oatsview-")).length, 3);
  } finally {
    for (const { viewer, child } of clients) {
      const exited = child.exitCode !== null ? Promise.resolve() : once(child, "exit");
      child.kill();
      await exited;
      viewer.cleanup();
    }
  }
  assert.deepEqual(sessionsOf(OATS).filter((s) => s.startsWith("oatsview-")), [], "every viewer is cleaned up");
  assert.deepEqual(windowsOf(OATS).filter((w) => w === "viewed"), ["viewed"], "the agent window stays");
  assert.equal(windowId(OATS, "viewed"), id);
  assert.deepEqual(ownOptions(OATS, id), OATS_WINDOW, "and keeps its options");
  assert.equal(inspectInstanceSession(h.home).present, true);
  assert.deepEqual(userGlobals(OATS), USER_GLOBALS);
});

test("an explicit name is taken by a live window on the OATS server, not by one on another server; a home that is not launched is attached through oats", async () => {
  ensureSession(OTHER);
  ensureSession(OATS);
  tmuxOn(OATS, "new-window", "-d", "-t", `=${SESSION}:`, "-n", "ghost", "sleep 600");
  tmuxOn(OTHER, "new-window", "-d", "-t", `=${SESSION}:`, "-n", "ghost-elsewhere", "sleep 600");
  const sessions = sessionsOf(OATS);
  await withPath(fx.env.PATH, () => assert.rejects(fx.spawn("dev", { name: "ghost", harness: "claude", tmuxSession: SESSION }), (e) => e.code === "E_INSTANCE_NAME_TAKEN" && /live tmux window/.test(e.message)));
  // A session the OATS server does not hold: the read creates neither a server nor a session.
  const spawned = await withPath(fx.env.PATH, () => fx.spawn("dev", { name: "ghost-elsewhere", harness: "claude", tmuxSession: SESSION }));
  assert.equal(spawned.launched, false);
  assert.equal(spawned.attach, `oats session attach --home ${spawned.home}`);
  await withPath(fx.env.PATH, () => fx.spawn("dev", { name: "no-session", harness: "claude", tmuxSession: "never-created" }));
  assert.deepEqual(sessionsOf(OATS), sessions, "the name check created no session");
});

test("tmux's shell-format environment is read strictly and never executed: the whole text or nothing", () => {
  const read = (text) => parseTmuxShellEnvironment(Buffer.from(text));
  assert.deepEqual(read(""), {});
  assert.deepEqual(read('A="1"; export A;\n'), { A: "1" });
  assert.deepEqual(read('EMPTY=""; export EMPTY;\nEQ="a=b=c"; export EQ;\n'), { EMPTY: "", EQ: "a=b=c" });
  assert.deepEqual(read('Q="a\\"b\\\\c\\$d\\`e"; export Q;\n'), { Q: 'a"b\\c$d`e' }, "the four escapes tmux writes are undone");
  assert.deepEqual(read('META="; rm -rf ~ | & ( ) < > * ? ! # \' export X;"; export META;\n'), { META: "; rm -rf ~ | & ( ) < > * ? ! # ' export X;" }, "shell metacharacters are characters");
  // A line feed inside a value stays inside it: the variable is dropped whole, and the line that
  // looks like an assignment (of a reserved name, of an ordinary one) is never read as one.
  assert.deepEqual(read('M="first\nOATS_INSTANCE_HOME=/smuggled"; export M;\nN="first\nINJECTED=1"; export N;\nKEPT="1"; export KEPT;\n'), { KEPT: "1" });
  assert.deepEqual(read('unset GONE;\nKEPT="1"; export KEPT;\n'), { KEPT: "1" }, "a removed variable carries nothing");
  // tmux 3.4 and 3.5 write each printed line through vis(3). 3.4 puts one more backslash before a
  // `$` that a letter, `_` or `{` follows; both write a control character or a byte that is not
  // UTF-8 as an escape. The same value in both forms reads the same; an encoded value is dropped.
  const DOLLARS = "$HOME ${B} $_x $1 $ \\$HOME";
  assert.deepEqual(read('D="\\$HOME \\${B} \\$_x \\$1 \\$ \\\\\\$HOME"; export D;\n'), { D: DOLLARS }, "as tmux's shell format alone writes it");
  assert.deepEqual(read('D="\\\\$HOME \\\\${B} \\\\$_x \\$1 \\$ \\\\\\\\$HOME"; export D;\n'), { D: DOLLARS }, "as tmux 3.4 writes it");
  assert.deepEqual(read('E="a\\033b"; export E;\nF="a\\rb"; export F;\nG="a\\303\\050b"; export G;\nKEPT="1"; export KEPT;\n'), { KEPT: "1" }, "a value tmux wrote encoded is dropped whole");
  assert.deepEqual(read('BASH_FUNC_x%%="() { :; }"; export BASH_FUNC_x%%;\nKEPT="1"; export KEPT;\n'), { KEPT: "1" }, "a name that is no plain identifier is not carried");
  // Anything the grammar does not consume to the end is a failed read, never a partial environment.
  for (const [what, text] of [
    ["cut inside a value", 'A="1"; export A;\nB="unfinished'],
    ["cut before the last line feed", 'A="1"; export A;'],
    ["cut inside the export", 'A="1"; export'],
    ["another name exported", 'A="1"; export B;\n'],
    ["an escape tmux does not write", 'A="a\\nb"; export A;\n'],
    ["a bare dollar sign", 'A="a$b"; export A;\n'],
    ["a bare backtick", 'A="a`b"; export A;\n'],
    ["two octal digits", 'A="a\\03"; export A;\n'],
    ["an unquoted assignment", "A=1\n"],
    ["a stray line", 'A="1"; export A;\nrm -rf /\n'],
    ["an unset without a name", "unset ;\n"],
    ["text after an entry", 'A="1"; export A; echo x\n'],
  ]) assert.equal(read(text), null, what);
  assert.equal(parseTmuxShellEnvironment(Buffer.concat([Buffer.from('A="'), Buffer.from([0xff, 0xfe]), Buffer.from('"; export A;\n')])), null, "bytes that are not UTF-8");
});

test("the environment OATS creates a tmux session and a window with: an instance passes its recorded server's, never its own, or is refused; another creator passes its own without the kernel's names; PATH follows whoever creates the window", async () => {
  const globalEnv = (socket) => Object.fromEntries(lines(tmuxOn(socket, "show-environment", "-g")).filter((l) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  const sessionEnv = (session) => tmuxOn(OATS, "show-environment", "-t", `=${session}`);
  /** One process that ensures a session on the OATS server, with its own environment and directory. */
  const ensureScript = (session) => `import(${JSON.stringify(CORE)}).then((core) => process.stdout.write(core.ensureOatsTmuxSession(${JSON.stringify(session)}, ${JSON.stringify(base)}))).catch((e) => { process.stdout.write(JSON.stringify({ code: e.code, message: e.message })); process.exit(1); })`;
  const ensureIn = (session, { env = {}, cwd = base } = {}) => spawnSync(process.execPath, ["-e", ensureScript(session)], { cwd, env: { ...process.env, PWD: cwd, ...env }, encoding: "utf8", timeout: 30000 });
  const refusal = (r) => { assert.equal(r.status, 1, r.stdout + r.stderr); assert.doesNotMatch(r.stdout + r.stderr, /s3cret|smuggled/, "no value is in what a refusal prints"); return JSON.parse(r.stdout); };
  const tree = (dir) => readdirSync(dir, { recursive: true }).sort();
  const shimOf = (home) => join(home, ".oats", "bin");
  // What an agent's process holds and must not hand on: a credential, a launch reference and the
  // name it stands for, a harness's marker, a variable update-environment names, its terminal.
  const SECRETS = ["FIXTURE_SECRET", "OATS_LAUNCH_REF_FIXTURE_TOKEN", "FIXTURE_TOKEN", "CLAUDECODE"];
  const KERNEL = ["OATS_INSTANCE", "OATS_INSTANCE_HOME", "OATS_ROOT", "PI_AGENTS_ROOT", "TMUX", "TMUX_PANE", "COLORFGBG"];
  const NOT_CARRIED = ["OATS_FIXTURE_MULTI_RESERVED", "OATS_FIXTURE_MULTI_PLAIN", "FIXTURE_INJECTED", "OATS_FIXTURE_HIDDEN", "OATS_FIXTURE_REMOVED"];
  const agent = { FIXTURE_SECRET: "s3cret", OATS_LAUNCH_REF_FIXTURE_TOKEN: "s3cret", FIXTURE_TOKEN: "s3cret", CLAUDECODE: "1", FIXTURE_IDENTITY: "creator", TMUX: `${OTHER},1,0`, TMUX_PANE: "%1", COLORFGBG: "15;0" };
  const operator = { FIXTURE_OPERATOR: "kept", FIXTURE_IDENTITY: "operator", PI_AGENTS_ROOT: "/fixture/operator/agents", OATS_LAUNCH_REF_FIXTURE_TOKEN: "s3cret", FIXTURE_TOKEN: "s3cret", TMUX: `${OTHER},1,0`, COLORFGBG: "15;0" };
  const absent = (env, names, what) => { for (const name of names) assert.equal(name in env, false, `${what} holds no ${name}`); };
  // Every character tmux escapes, a `$` in each position tmux 3.4 treats differently, and text
  // shaped like the end of an entry. (Not ending in `;`: tmux takes that off a command's argument.)
  const SPECIAL = "a \"quoted\" $HOME `tick` back\\slash lit\\$HOME ${B} $_x $1 $ = ; export X; end";
  const CONTROL = "a\u001bb";
  /** The server's global environment as the kernel's reader gives it: tmux's plain listing is not
   *  the same text in every tmux version. A pane's own `env` is the independent check below. */
  const shellEnv = (socket) => parseTmuxShellEnvironment(execFileSync("tmux", ["-u", "-S", socket, "show-environment", "-g", "-s"], { timeout: 10000, stdio: ["ignore", "pipe", "pipe"] }));

  // The server the calling instance is recorded on: a marker; a value every escaped character is in;
  // an empty value; two multi-line values, one followed by a line shaped like the assignment of a
  // reserved name and one by a line shaped like an ordinary assignment; a hidden and a removed
  // variable; and names the kernel sets.
  await killServer(OATS);
  ensureSession(OTHER);
  const source = (...args) => tmuxOn(OTHER, "set-environment", "-g", ...args);
  source("OATS_FIXTURE_MARKER", "from the recorded server");
  source("OATS_FIXTURE_SPECIAL", SPECIAL);
  source("OATS_FIXTURE_EMPTY", "");
  source("OATS_FIXTURE_CONTROL", CONTROL);
  source("OATS_FIXTURE_MULTI_RESERVED", "first line\nOATS_INSTANCE_HOME=/smuggled");
  source("OATS_FIXTURE_MULTI_PLAIN", "first line\nFIXTURE_INJECTED=1");
  source("-h", "OATS_FIXTURE_HIDDEN", "hidden");
  source("-r", "OATS_FIXTURE_REMOVED");
  source("OATS_ROOT", "/recorded/root");
  source("COLORFGBG", "0;15");
  const sourceEnvironment = (server) => {
    absent(server, [...SECRETS, ...KERNEL, ...NOT_CARRIED, "FIXTURE_IDENTITY", "FIXTURE_OPERATOR"], "a server started with the recorded server's environment");
    assert.equal(server.OATS_FIXTURE_MARKER, "from the recorded server");
    assert.equal(shellEnv(OATS).OATS_FIXTURE_SPECIAL, SPECIAL, "a value is carried exactly, whatever characters it holds");
    assert.equal(server.OATS_FIXTURE_EMPTY, "");
    assert.doesNotMatch(tmuxOn(OATS, "show-environment", "-g"), /s3cret|smuggled|first line|creator/, "no value of the instance's; a multi-line value is dropped whole");
  };
  const caller = await makeHome("env-caller", { on: OTHER });
  const unlaunched = await makeHome("env-unlaunched");
  const stranded = await makeHome("env-stranded", { on: join(base, "env-lost.sock") });
  const mismatched = await makeHome("env-mismatched", { on: OTHER });
  writeFileSync(join(mismatched.home, "instance.json"), JSON.stringify({ ...readJson(join(mismatched.home, "instance.json")), tmux: { session: SESSION, window: "env-mismatched", socket: join(base, "elsewhere.sock") } }, null, 2) + "\n");
  const as = (h) => ({ ...agent, OATS_INSTANCE: h.name, OATS_INSTANCE_HOME: h.home, PATH: `${shimOf(h.home)}:${spawnPath}` });
  const spawnEnv = { OATS_TMUX_SESSION: "envs", PI_AGENTS_TMUX_SESSION: "envs" };

  // No session, and a caller that may not create it: refused before anything exists, by a spawn and
  // by a start. A home that records no tmux server; a recorded server that is gone; a receipt that
  // disagrees with instance.json; an instance's identity with no home to be found.
  const homes = tree(fx.root), refs = git(fx.repo, "for-each-ref");
  let r = fx.cli(["spawn", "dev", "--name", "env-refused", "--harness", "claude", "--json"], { env: { ...spawnEnv, ...as(unlaunched) } });
  assert.notEqual(r.status, 0, r.stdout);
  assert.equal(r.json().error.code, "E_SPAWN_FAILED");
  assert.match(r.json().error.message, /cannot create tmux session envs on the OATS tmux server from inside an OATS instance: the home of env-unlaunched records no tmux server/);
  assert.match(r.json().error.message, /the session was not created\. Create it from your own shell, outside every instance home \(tmux -L oats new-session -d -s envs -n hq\)/);
  assert.doesNotMatch(r.stdout + r.stderr, /s3cret/, "no value of the caller's is in what the refusal prints");
  assert.deepEqual(tree(fx.root), homes, "no home, no receipt, nothing under the agents root");
  assert.equal(git(fx.repo, "for-each-ref"), refs, "no branch");
  const never = await makeHome("env-never", { session: "envs" });
  const neverTree = tree(never.home), neverMeta = readFileSync(join(never.home, "instance.json"), "utf8");
  r = fx.cli(["session", "start", "--home", never.home, "--json"], { env: as(stranded) });
  assert.notEqual(r.status, 0, r.stdout);
  assert.equal(r.json().error.code, "E_RUNTIME_ENDPOINT_UNKNOWN");
  assert.match(r.json().error.message, /the environment of the tmux server that env-stranded is recorded on \(.*env-lost\.sock\) could not be read/);
  assert.deepEqual(tree(never.home), neverTree, "the start wrote nothing: no pending receipt, no event");
  assert.equal(readFileSync(join(never.home, "instance.json"), "utf8"), neverMeta);
  let refused = refusal(ensureIn("envs", { env: as(mismatched) }));
  assert.equal(refused.code, "E_RUNTIME_ENDPOINT_UNKNOWN");
  assert.match(refused.message, /the session receipt of env-mismatched could not be used \(E_RUNTIME_AUTHORITY_MISMATCH\)/);
  refused = refusal(ensureIn("envs", { env: { ...agent, PI_AGENT_HOME: "" } }));
  assert.equal(refused.code, "E_RUNTIME_ENDPOINT_UNKNOWN");
  assert.match(refused.message, /this process carries an instance's identity \(PI_AGENT_HOME\) and neither OATS_INSTANCE_HOME nor the working directory names its home/);
  assert.deepEqual(sessionsOf(OATS), [], "no refusal started a server");

  // Another creator (an operator's shell, a runner): its own environment, without the names the
  // kernel sets. An exported agents root is no sign of an instance. The session imports what
  // update-environment names from it, as tmux does for anyone.
  r = ensureIn("envs", { env: operator });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  let server = globalEnv(OATS);
  absent(server, ["OATS_LAUNCH_REF_FIXTURE_TOKEN", "FIXTURE_TOKEN", "PI_AGENTS_ROOT", "TMUX", "TMUX_PANE", "COLORFGBG", "OATS_FIXTURE_MARKER"], "the server another creator started");
  assert.equal(server.FIXTURE_OPERATOR, "kept");
  assert.match(sessionEnv("envs"), /^FIXTURE_IDENTITY=operator$/m);
  // The session now exists, so the instance that was refused above spawns: nothing is read, nothing
  // global changes, and of its creator the new window takes only PATH, without the creator's shim.
  const before = serverState(OATS);
  r = fx.cli(["spawn", "dev", "--name", "env-child", "--harness", "claude", "--json"], { env: { ...spawnEnv, ...as(unlaunched) } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const child = r.json().result;
  assert.equal(child.tmux.socket, OATS);
  assert.deepEqual(serverState(OATS), before, "a window on a running server changes nothing global");
  await ready(child.home);
  let pane = paneEnv(child.home);
  absent(pane, SECRETS, "the pane an instance opened");
  assert.equal(pane.FIXTURE_IDENTITY, "operator", "the session's, not the creator's");
  assert.equal(pane.FIXTURE_OPERATOR, "kept", "the rest of its environment is the server's");
  assert.equal(pane.OATS_INSTANCE_HOME, child.home, "its identity is its own, from its launch command");
  assert.equal(pane.PATH.split(":").includes(shimOf(unlaunched.home)), false, "the creator's kernel shim is not on its PATH");
  assert.equal(pane.PATH.split(":")[0], shimOf(child.home), "its own shim is first");
  assert.ok(pane.PATH.split(":").includes(probeBin), "the creator's tool directories are");
  // An instance that has to create another SESSION on the running server passes its recorded
  // server's environment for it too, and one that cannot read it is refused there as well.
  r = ensureIn("envs-two", { env: as(caller) });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(serverState(OATS), before, "a session on a running server changes nothing global");
  assert.doesNotMatch(sessionEnv("envs-two"), /creator|s3cret/, "the new session imported nothing of the instance's");
  refused = refusal(ensureIn("envs-three", { env: as(stranded) }));
  assert.match(refused.message, /cannot create tmux session envs-three .* could not be read/);
  assert.deepEqual(sessionsOf(OATS).sort(), ["envs", "envs-two"]);
  // PATH follows whoever creates the window: this start runs with another PATH than the server has.
  const three = await makeHome("env-three", { session: "envs" });
  r = fx.cli(["session", "start", "--home", three.home, "--json"], { env: { PATH: `/fixture/starter/bin:${spawnPath}` } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  await ready(three.home);
  assert.ok(paneEnv(three.home).PATH.split(":").includes("/fixture/starter/bin"), "the pane's PATH is the starting process's");
  assert.equal(paneEnv(three.home).FIXTURE_OPERATOR, "kept");

  // The locale names. tmux's client does not start without a UTF-8 locale, so an instance's
  // new-window client carries LANG, LC_ALL and LC_CTYPE besides PATH. tmux imports none of them:
  // the pane, the session and the server keep the values they had, whatever the client holds.
  const BASELINE = { LANG: "fixture_BASELINE_LANG.UTF-8", LC_ALL: "fixture_BASELINE_ALL.UTF-8", LC_CTYPE: "fixture_BASELINE_CTYPE.UTF-8" };
  const CLIENT = { LANG: "fixture_CLIENT_LANG.UTF-8", LC_ALL: "fixture_CLIENT_ALL.UTF-8", LC_CTYPE: "fixture_CLIENT_CTYPE.UTF-8" };
  for (const [name, value] of Object.entries(BASELINE)) tmuxOn(OATS, "set-environment", "-g", name, value);
  const clientSeen = join(base, "new-window-client-env.txt");
  const recording = tmuxInFront("locale-front", `case " $* " in *" new-window "*) env > ${shq(clientSeen)} ;; esac`);
  const localised = await makeHome("env-locale", { session: "envs" });
  r = fx.cli(["session", "start", "--home", localised.home, "--json"], { env: { ...as(caller), ...CLIENT, PATH: `${recording}:${as(caller).PATH}` } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  await ready(localised.home);
  const client = Object.fromEntries(lines(readFileSync(clientSeen, "utf8")).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  for (const [name, value] of Object.entries(CLIENT)) assert.equal(client[name], value, `the new-window client runs with the creator's ${name}`);
  absent(client, [...SECRETS, "OATS_INSTANCE", "OATS_INSTANCE_HOME", "FIXTURE_IDENTITY", "TMUX", "TMUX_PANE", "COLORFGBG"], "the new-window client of an instance");
  pane = paneEnv(localised.home);
  server = globalEnv(OATS);
  for (const [name, value] of Object.entries(BASELINE)) {
    assert.equal(pane[name], value, `the pane's ${name} is the server's`);
    assert.equal(server[name], value, `the server's ${name} is unchanged`);
  }
  assert.doesNotMatch(`${tmuxOn(OATS, "show-environment", "-g")}\n${sessionEnv("envs")}\n${readFileSync(join(localised.home, "pane-env.txt"), "utf8")}`, /fixture_CLIENT_/, "no value of the client's is in the server's environment, the session's or the pane's");

  // An instance that has to START the server, identified by OATS_INSTANCE_HOME, through the CLI.
  await killServer(OATS);
  const one = await makeHome("env-one", { session: "envs" });
  r = fx.cli(["session", "start", "--home", one.home, "--json"], { env: as(caller) });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.json().result.target.socket, OATS);
  sourceEnvironment(globalEnv(OATS));
  assert.doesNotMatch(sessionEnv("envs"), /creator|s3cret/);
  // A later start from a clean environment: neither pane holds what the first creator held.
  const two = await makeHome("env-two", { session: "envs" });
  assert.equal(startInstanceSession(two.home).target.socket, OATS);
  await ready(one.home); await ready(two.home);
  for (const h of [one, two]) {
    pane = paneEnv(h.home);
    absent(pane, [...SECRETS, ...NOT_CARRIED, "FIXTURE_IDENTITY"], `the pane of ${h.name}`);
    assert.equal(pane.OATS_FIXTURE_MARKER, "from the recorded server");
    assert.equal(pane.OATS_FIXTURE_SPECIAL, SPECIAL, "a process in the pane holds the value exactly");
    // A value with a control character: carried exactly, or not carried where tmux prints it encoded.
    assert.ok(pane.OATS_FIXTURE_CONTROL === undefined || pane.OATS_FIXTURE_CONTROL === CONTROL, "never an altered value");
    assert.equal(pane.OATS_INSTANCE_HOME, h.home, "its identity is its own");
    assert.equal(pane.PATH.split(":").includes(shimOf(caller.home)), false);
  }

  // The working directory alone identifies an instance (a harness that strips the session environment).
  await killServer(OATS);
  r = ensureIn("envs", { cwd: caller.home, env: agent });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  sourceEnvironment(globalEnv(OATS));

  // A destination that is there at the lookup and gone at the creation: the creation still runs with
  // the safe environment, on the socket the lookup named.
  await killServer(OATS);
  const ambient = { ...process.env };
  Object.assign(process.env, as(caller), { PATH: ambient.PATH });
  try {
    let lookups = 0;
    const io = { exec: (bin, args, options) => (args.includes("list-sessions") && lookups++ === 0 ? `someone-else\t${OATS}\n` : execFileSync(bin, args, options)) };
    assert.equal(ensureOatsTmuxSession("envs", base, io), OATS);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in ambient)) delete process.env[key];
    Object.assign(process.env, ambient);
  }
  sourceEnvironment(globalEnv(OATS));

  // Two creators at once, an instance and another: tmux starts the server once, with the environment
  // of one of them, whole. Never a mix, and neither changes what the other started.
  for (let round = 0; round < 4; round++) {
    await killServer(OATS);
    const run = (env) => new Promise((done) => execFile(process.execPath, ["-e", ensureScript("envs")], { timeout: 30000, cwd: base, env: { ...process.env, PWD: base, ...env } }, (error, stdout, stderr) => done({ error, stdout, stderr })));
    const both = await Promise.all([run(as(caller)), run(operator)]);
    for (const done of both) { assert.equal(done.error, null, done.stdout + done.stderr); assert.equal(done.stdout, OATS); }
    server = globalEnv(OATS);
    absent(server, [...SECRETS, ...KERNEL, ...NOT_CARRIED], "the server two creators raced to start");
    assert.ok((server.OATS_FIXTURE_MARKER === "from the recorded server") !== (server.FIXTURE_OPERATOR === "kept"), `the environment is exactly one creator's: ${JSON.stringify({ marker: server.OATS_FIXTURE_MARKER ?? null, operator: server.FIXTURE_OPERATOR ?? null })}`);
    assert.deepEqual(sessionsOf(OATS), ["envs"]);
  }

  // A session someone made by hand, before anything else: found by its exact name and used as it is.
  await killServer(OATS);
  execFileSync("tmux", ["-L", "oats", "new-session", "-d", "-s", "by-hand", "-n", "hq"], { stdio: "ignore", timeout: 10000 });
  const four = await makeHome("env-four", { session: "by-hand" });
  assert.equal(startInstanceSession(four.home).target.socket, OATS);
  assert.deepEqual(windowsOf(OATS, "by-hand"), ["hq", "env-four"]);
  assert.deepEqual(ownOptions(OATS, windowId(OATS, "hq", "by-hand")), UNSET, "the window OATS did not create keeps its options");
  await ready(four.home);
});

test("the kernel's own environment names: every OATS_ and PI_ name the kernel gives a spawn hook, a retire hook, a dispatched command and an operation is kept out of the environment a session is created with, and the ones that identify an instance refuse", async () => {
  // The inventory in lib/core.mjs is kept by hand. This ties it to the code that generates the
  // names: each kind of process the kernel starts for a capability reports the names it received.
  const seen = join(base, "kernel-names.jsonl");
  const report = (kind, answer) => `import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(seen)}, JSON.stringify({ kind: ${JSON.stringify(kind)}, names: Object.keys(process.env).filter((name) => /^(OATS|PI)_/.test(name)) }) + "\\n");
process.stdout.write(${JSON.stringify(`${answer}\n`)});
`;
  const envelope = JSON.stringify({ schemaVersion: 1, ok: true, result: {} });
  const dep = v2Deployment({
    souls: { dev: { soul: { capabilities: { "test.names": { from: "here" } } } } },
    capabilities: { "test.names": {
      manifest: { layer: "knowledge", command: "envnames", commands: { show: "show.mjs", act: "act.mjs" }, operations: { act: { command: "act", context: "home" } }, hooks: { spawn: "spawn.mjs", retire: "retire.mjs" } },
      files: { "spawn.mjs": report("spawn hook", "{}"), "retire.mjs": report("retire hook", "{}"), "show.mjs": report("command", envelope), "act.mjs": report("operation", envelope) },
    } },
  });
  try {
    const ran = (r, what) => assert.equal(r.status, 0, `${what}: ${r.stdout}${r.stderr}`);
    const { home } = await withPath(dep.env.PATH, () => dep.spawn("dev", { name: "names-one", harness: "claude" }));
    ran(dep.cli(["envnames", "show", "--soul", "dev", "--json"]), "the command, dispatched for a soul");
    ran(dep.cli(["envnames", "show", "--json"], { cwd: home, env: { OATS_INSTANCE_HOME: home } }), "the command, dispatched in a home");
    ran(dep.cli(["operation", "run", "knowledge:act", "--home", home, "--json"]), "the operation");
    ran(dep.cli(["retire", "names-one", "--json"]), "the retire");
    const reports = lines(readFileSync(seen, "utf8")).map((line) => JSON.parse(line));
    assert.deepEqual([...new Set(reports.map((r) => r.kind))].sort(), ["command", "operation", "retire hook", "spawn hook"], "each kind of process reported");
    // Beyond the operator's own: the fixture's CLI environment holds host settings under OATS_.
    const generated = [...new Set(reports.flatMap((r) => r.names))].filter((name) => !(name in dep.env)).sort();
    for (const name of ["OATS_CAPABILITY", "OATS_SETTINGS", "OATS_CLI_BIN", "OATS_INSTANCE_HOME", "OATS_EVENT", "OATS_OPERATION"]) assert.ok(generated.includes(name), `${name} is among the names reported: ${generated.join(" ")}`);

    const IDENTITY = ["OATS_INSTANCE", "OATS_INSTANCE_HOME", "OATS_HOME", "PI_AGENT_INSTANCE", "PI_AGENT_HOME"];
    const socket = join(base, "names.sock");
    const created = [];
    // No tmux runs: a server that has other sessions, and a creation that records its environment.
    const io = { exec: (_bin, args, options) => {
      if (args.includes("list-sessions")) return `someone-else\t${socket}\n`;
      if (args.includes("new-session")) { created.push(options.env); return `${socket}\t@1\n`; }
      return "";
    } };
    const ambient = { ...process.env };
    try {
      for (const name of generated) if (!IDENTITY.includes(name)) process.env[name] = "kernel-name-fixture";
      process.env.FIXTURE_KEPT = "kept";
      assert.equal(ensureOatsTmuxSession("names", base, io), socket);
      assert.equal(created.length, 1);
      assert.equal(created[0].FIXTURE_KEPT, "kept", "a name the kernel does not own is passed on");
      assert.deepEqual(generated.filter((name) => name in created[0]), [], "no name the kernel generates is in the environment the session is created with");
      // The names that identify an instance are not removed from an operator's environment: a
      // process that carries one is an instance, and one that names no home is refused.
      for (const name of generated.filter((n) => IDENTITY.includes(n))) {
        process.env[name] = "";
        assert.throws(() => ensureOatsTmuxSession("names", base, io), { code: "E_RUNTIME_ENDPOINT_UNKNOWN" }, name);
        delete process.env[name];
      }
      assert.equal(created.length, 1, "a refused creation runs no new-session");
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in ambient)) delete process.env[key];
      Object.assign(process.env, ambient);
    }
  } finally { dep.cleanup(); }
});

test("a retire hook that spawns: its process is the retiring instance, so with that home's server gone and no session on the OATS server the spawn is refused, the retire is incomplete and keeps the home, and the next retire runs the hook again", async () => {
  await killServer(OATS);
  const flags = join(base, "hook-flags");
  mkdirSync(flags);
  // The hook runs `oats spawn` as a capability's retire hook would, reports what it was answered,
  // and fails when the spawn fails.
  const hook = `import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
const r = spawnSync(process.execPath, [process.env.OATS_CLI_BIN, "spawn", "dev", "--dir", process.env.FIXTURE_DEPLOYMENT, "--name", "hook-child", "--harness", "claude", "--json"], { encoding: "utf8" });
let answer = null; try { answer = JSON.parse(r.stdout.trim().split("\\n").pop()); } catch { /* no envelope */ }
appendFileSync(${JSON.stringify(join(flags, "ran"))}, JSON.stringify({ status: r.status, ok: answer?.ok ?? null, code: answer?.error?.code ?? null, message: answer?.error?.message ?? null, identity: process.env.OATS_INSTANCE_HOME ?? null }) + "\\n");
if (r.status !== 0) process.exit(1);
console.log(JSON.stringify({ meta: { retired: true } }));
`;
  const dep = v2Deployment({ souls: { dev: { soul: { capabilities: { "test.spawner": { from: "here" } } } } },
    capabilities: { "test.spawner": { manifest: { hooks: { retire: "hook.mjs" } }, files: { "hook.mjs": hook } } } });
  try {
    writeFileSync(join(dep.env.HOME, ".tmux.conf"), USER_TMUX_CONF);
    // The server the retiring home is recorded on was killed: its socket file is left, and refuses.
    const lost = join(base, "hook-lost.sock");
    tmuxOn(lost, "new-session", "-d", "-s", SESSION, "-n", "hq", "-c", base);
    const lostPid = Number(tmuxOn(lost, "display-message", "-p", "#{pid}"));
    process.kill(lostPid, "SIGKILL");
    await waitUntil(() => { try { process.kill(lostPid, 0); return false; } catch { return true; } }, "the retiring home's server is gone");
    const retiring = await makeHome("hook-retiring", { on: lost, deployment: dep });
    const runs = () => (existsSync(join(flags, "ran")) ? lines(readFileSync(join(flags, "ran"), "utf8")).map((l) => JSON.parse(l)) : []);
    // Run by an operator-style process: no instance identity, a working directory outside every home.
    const retire = () => dep.cli(["retire", "hook-retiring", "--json"], { env: { PATH: `${probeBin}:${dep.env.PATH}`, FIXTURE_DEPLOYMENT: dep.dep } });
    let r = retire();
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.equal(runs().length, 1, "the hook ran");
    const [first] = runs();
    assert.equal(first.identity, retiring.home, "the hook's process carries the retiring instance's identity");
    assert.equal(first.status, 1);
    assert.equal(first.code, "E_SPAWN_FAILED");
    assert.match(first.message, /cannot create tmux session .* from inside an OATS instance: the environment of the tmux server that hook-retiring is recorded on \(.*hook-lost\.sock\) could not be read/, "a person running the retire is no exception for the hook's child");
    assert.deepEqual(sessionsOf(OATS), [], "nothing was created on the OATS server");
    assert.equal(existsSync(join(dep.root, "dev", "instances", "hook-child")), false);
    const result = JSON.parse(r.stdout);
    assert.ok(result.rollbackIncomplete?.some((m) => m.startsWith("retire hook test.spawner: ")), `the failed hook is reported as outstanding, not as a cleanup: ${JSON.stringify(result.rollbackIncomplete)}`);
    assert.equal(existsSync(join(retiring.home, "instance.json")), true, "the home is kept for the retry");
    // The next retire runs the hook again.
    r = retire();
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.equal(runs().length, 2, "the retry reached the hook");
    assert.equal(existsSync(join(retiring.home, "instance.json")), true);
  } finally { dep.cleanup(); }
});
