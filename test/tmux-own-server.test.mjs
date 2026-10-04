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
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ensureOatsTmuxSession, inputInstanceSession, inspectInstanceSession, restartInstanceSession, retireInstance, shellWord, startInstanceSession } from "../lib/core.mjs";
import { prepareSessionViewer } from "../lib/session-viewer.mjs";
import { readEvents } from "../lib/instance-events.mjs";
import { isolateSessionEnvironment, oatsSocket, systemExecutable, waitUntil } from "./helpers/host-fixture.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

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
async function makeHome(name, { on, session = SESSION } = {}) {
  const { home } = await withPath(fx.env.PATH, () => fx.spawn("dev", { name, harness: "claude" }));
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
