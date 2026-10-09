// `oats session attach --detach-key <key>` (awebai/oats#856): one key that leaves the viewer.
//
// Real tmux throughout, never the operator's (the conventions of test/tmux-own-server.test.mjs): the
// fixture owns a private TMUX_TMPDIR and every server here is a socket inside the fixture. AGENTS is
// the server the homes record. A viewer needs a terminal, so each one is the real CLI in a pane of
// TERM, a second private server: keys are sent to that pane as a terminal would send them, and the
// pane's shell records the command's exit status. docs/execution-targets.md owns the rules.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { SESSION_DETACHED_EXIT, isDetachKey, prepareSessionViewer } from "../lib/session-viewer.mjs";
import { fixtureBase, isolateSessionEnvironment, systemExecutable, waitUntil } from "./helpers/host-fixture.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

const REAL_TMUX = systemExecutable("tmux");
const base = fixtureBase("oats-dk-"); // short: two socket paths live in it
const restoreEnvironment = isolateSessionEnvironment(base);
const WRAPPER = join(base, "system-bin", "tmux");
const AGENTS = join(base, "agents.sock");
const TERM = join(base, "term.sock");
const SESSION = "team";
const fx = v2Deployment();

const tmuxOn = (socket, ...args) => execFileSync("tmux", ["-u", "-S", socket, ...args], { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"] }).trim();
const lines = (text) => text.split("\n").filter(Boolean);
const sessionsOf = (socket) => { try { return lines(tmuxOn(socket, "list-sessions", "-F", "#{session_name}")); } catch { return []; } };
const viewerSessions = () => sessionsOf(AGENTS).filter((s) => s.startsWith("oatsview-"));
/** The sessions that have a client attached, one entry per client. */
const attached = () => lines(tmuxOn(AGENTS, "list-clients", "-F", "#{session_name}"));
/** Every key table of a server and the keys it binds, from the UNFILTERED list: `list-keys -T
 *  <table>` prints nothing for a table that holds exactly one binding. tmux prints a key escaped
 *  for its own parser (`C-\` as `C-\\`); the keys here are as they are typed. */
function keyTables(socket = AGENTS) {
  const tables = {};
  for (const line of lines(tmuxOn(socket, "list-keys"))) {
    const bound = /^bind-key\s+(?:-r\s+)?-T\s+(\S+)\s+(\S+)/.exec(line);
    if (bound) (tables[bound[1]] ||= []).push(bound[2].replace(/\\(.)/g, "$1"));
  }
  for (const keys of Object.values(tables)) keys.sort();
  return tables;
}
/** The keys a viewer's table holds: the two mouse bindings, and its detach key when it has one. */
const bindings = (...keys) => ["MouseDrag1Pane", "WheelUpPane", ...keys].sort();
const LOCKED = "oatsview-locked";
const MOUSE_KEYS = ["MouseDrag1Pane", "WheelUpPane"];
/** After a test, whatever it left: a failed test must not fail the ones after it. Killing a viewer
 *  session ends its client, and so its command. */
function sweep() {
  for (const session of viewerSessions()) { try { tmuxOn(AGENTS, "kill-session", "-t", `=${session}`); } catch { /* gone */ } }
  for (const table of viewerTables()) { try { tmuxOn(AGENTS, "unbind-key", "-a", "-q", "-T", table); } catch { /* gone */ } }
}
/** The key tables viewers made for themselves: every `oatsview-` table but the locked one. */
const viewerTables = () => Object.keys(keyTables()).filter((name) => name.startsWith("oatsview-") && name !== LOCKED);
function nothingLeft(what) {
  assert.deepEqual(viewerSessions(), [], `${what}: no viewer session is left`);
  assert.deepEqual(viewerTables(), [], `${what}: no viewer key table is left`);
}

// What runs in an agent's pane: it fills some history (a wheel-up has somewhere to scroll), puts
// the terminal in raw mode and shows every byte it reads, control bytes in caret notation (C-\ is
// `^\`, C-b is `^B`, Escape is `^[`). A key that reaches the agent is on its screen.
const paneProgram = join(base, "agent-pane.mjs");
writeFileSync(paneProgram, `for (let i = 0; i < 200; i++) console.log("history " + i);
process.stdin.setRawMode(true);
process.stdin.on("data", (data) => process.stdout.write([...data].map((b) => (b < 32 ? "^" + String.fromCharCode(b + 64) : b === 127 ? "^?" : String.fromCharCode(b))).join("")));
process.stdout.write("pane-ready:");
`);
tmuxOn(AGENTS, "new-session", "-d", "-s", SESSION, "-n", "hq", "-x", "120", "-y", "40", "-c", base, "cat");
// The terminals. A pane stays after its command so that a failure can show what it printed.
tmuxOn(TERM, "new-session", "-d", "-s", "term", "-n", "hold", "-x", "120", "-y", "40", "-c", base, "cat");
tmuxOn(TERM, "set-option", "-g", "remain-on-exit", "on");
tmuxOn(TERM, "set-option", "-g", "default-terminal", "screen");

const withPath = async (path, fn) => { const saved = process.env.PATH; process.env.PATH = path; try { return await fn(); } finally { process.env.PATH = saved; } };
const baselineOf = (home) => join(dirname(home), ".oats-retirement", "baselines", `${createHash("sha256").update(home).digest("hex")}.json`);
const homes = new Map();
/** An agent: a real workspace-model home recorded as launched in the window `name` of AGENTS, and
 *  that window, new each time (its screen starts with the history and nothing else). */
async function agent(name) {
  if (!homes.has(name)) {
    const { home } = await withPath(fx.env.PATH, () => fx.spawn("dev", { name, harness: "claude" }));
    const { launch: _recipe, ...spawned } = readJson(join(home, "instance.json"));
    const tmux = { session: SESSION, window: name, socket: AGENTS };
    writeFileSync(join(home, "instance.json"), JSON.stringify({ ...spawned, tmux, command: "true", launched: true }, null, 2) + "\n");
    writeFileSync(baselineOf(home), JSON.stringify({ ...readJson(baselineOf(home)), runtime: { launched: true, tmux } }, null, 2) + "\n", { mode: 0o600 });
    homes.set(name, home);
  }
  try { tmuxOn(AGENTS, "kill-window", "-t", `=${SESSION}:=${name}`); } catch { /* not there yet */ }
  tmuxOn(AGENTS, "new-window", "-d", "-t", `=${SESSION}:`, "-n", name, "-c", base, `${shq(process.execPath)} ${shq(paneProgram)}`);
  const a = { name, home: homes.get(name), target: `=${SESSION}:=${name}` };
  await waitUntil(() => typed(a) !== null, `${name}'s pane reads its terminal`);
  return a;
}
/** What an agent's pane has read since it started, as it shows it; null before it reads. */
function typed(a) {
  const screen = tmuxOn(AGENTS, "capture-pane", "-p", "-J", "-t", a.target).replace(/\n/g, "");
  const at = screen.lastIndexOf("pane-ready:");
  return at < 0 ? null : screen.slice(at + "pane-ready:".length).trimEnd();
}
const inMode = (a) => tmuxOn(AGENTS, "display-message", "-p", "-t", a.target, "#{pane_in_mode}");
/** Remove the locked table, which a plain viewer of an earlier test left on the server: what a
 *  test then finds there, its own viewers made. */
const dropLockedTable = () => tmuxOn(AGENTS, "unbind-key", "-a", "-q", "-T", LOCKED);

/** A tmux in front of the fixture's: `body` decides a call before the real one runs. */
function tmuxInFront(name, body) {
  const dir = join(base, name);
  mkdirSync(dir);
  writeFileSync(join(dir, "tmux"), `#!/bin/sh\n${body}\nexec ${shq(WRAPPER)} "$@"\n`);
  chmodSync(join(dir, "tmux"), 0o755);
  return dir;
}

let opened = 0;
/** `oats session attach --home <home> [--detach-key <key>]`, the real CLI, in a new pane of TERM.
 *  Resolves once its client is attached to its viewer session (`attach: false`: at once). `front`
 *  is a directory put first on the command's PATH. */
async function view(a, { key, front, attach = true } = {}) {
  const id = `v${++opened}`;
  const statusFile = join(base, `${id}.status`);
  const before = new Set(viewerSessions());
  const argv = [process.execPath, CLI, "session", "attach", "--home", a.home, ...(key === undefined ? [] : ["--detach-key", key])];
  const script = `${front ? `PATH=${shq(`${front}:${process.env.PATH}`)}; export PATH; ` : ""}${argv.map(shq).join(" ")}; echo $? > ${shq(statusFile)}`;
  const pane = tmuxOn(TERM, "new-window", "-d", "-P", "-F", "#{pane_id}", "-t", "=term:", "-n", id, "-c", base, script);
  const viewer = {
    id, pane, agent: a, session: null,
    /** The command's exit status as the pane's shell recorded it; null while it runs. */
    status() { const text = existsSync(statusFile) ? readFileSync(statusFile, "utf8") : ""; return /^\d+\n$/.test(text) ? Number(text) : null; },
    /** What the terminal shows: the command's own messages, for a failure. */
    shows() { try { return tmuxOn(TERM, "capture-pane", "-p", "-t", pane).trim(); } catch (e) { return `(no pane: ${e.message})`; } },
    /** Keys, as tmux names them, typed at the terminal. */
    press(...keys) { tmuxOn(TERM, "send-keys", "-t", pane, ...keys); },
    /** Bytes as a terminal sends them (a mouse report). */
    send(bytes) { tmuxOn(TERM, "send-keys", "-l", "-t", pane, bytes); },
    isAttached() { return viewer.session !== null && attached().includes(viewer.session); },
    /** The `oats` process: the viewer session is named for it. */
    pid() { return Number(viewer.session.split("-")[1]); },
    async ended() { await waitUntil(() => viewer.status() !== null, `${id} has ended; its terminal shows: ${viewer.shows()}`); return viewer.status(); },
  };
  if (attach) {
    await waitUntil(() => {
      assert.equal(viewer.status(), null, `${id} ended before it attached; its terminal shows: ${viewer.shows()}`);
      viewer.session = viewerSessions().find((s) => !before.has(s)) ?? null;
      return viewer.isAttached();
    }, `${id} is attached`);
  }
  return viewer;
}
/** An SGR report of the wheel turned up over column 10, row 5: what a terminal sends tmux. */
const WHEEL_UP = "\u001b[<64;10;5M";

test.after(() => {
  for (const socket of [TERM, AGENTS]) { try { execFileSync(REAL_TMUX, ["-S", socket, "kill-server"], { stdio: "ignore", timeout: 10000 }); } catch { /* not running */ } }
  restoreEnvironment();
  rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  fx.cleanup();
});

const TMUX_VERSION = execFileSync(REAL_TMUX, ["-V"], { encoding: "utf8", timeout: 10000 }).trim();
test(`the tmux these tests run against: ${TMUX_VERSION}`, (t) => {
  t.diagnostic(`tmux -V: ${TMUX_VERSION}`);
  assert.match(TMUX_VERSION, /^tmux /);
});

/** Every key of the grammar, built from its three productions and not from the kernel's expression. */
const GRAMMAR = [
  ..."abcdefgjklnopqrstuvwxyz".split("").map((c) => `C-${c}`), "C-\\", "C-]", "C-^", "C-_",
  ..."abcdefghijklmnopqrstuvwxyz0123456789".split("").map((c) => `M-${c}`),
  ...["", "C-", "M-", "S-"].flatMap((modifier) => Array.from({ length: 12 }, (_, i) => `${modifier}F${i + 1}`)),
];

test("every key the grammar accepts is a key to this tmux: bound with the viewer's own command, each is listed back as one binding, and no two are the same key", () => {
  assert.equal(GRAMMAR.length, 111);
  for (const key of GRAMMAR) assert.equal(isDetachKey(key), true, key);
  const table = "grammar-scratch";
  try {
    // One table for all of them: two names for one key would leave fewer bindings than names.
    for (const key of GRAMMAR) tmuxOn(AGENTS, "bind-key", "-T", table, key, "set-option @oats-detached 1 ; detach-client");
    const listed = keyTables()[table];
    assert.deepEqual(listed, [...GRAMMAR].sort());
  } finally { tmuxOn(AGENTS, "unbind-key", "-a", "-q", "-T", table); }
  assert.equal(table in keyTables(), false, "tmux drops a table with its last binding");
});

test("the kernel's own viewer, prepared with a key: its table holds the two mouse bindings and the key, the key runs the marker and the detach as one command, and cleanup leaves neither the session nor the table", async (t) => {
  t.after(sweep);
  const a = await agent("prepared");
  dropLockedTable();
  for (const key of ["C-\\", "F12", "M-0", "C-]", "S-F1"]) {
    const viewer = prepareSessionViewer({ backend: "tmux", socket: AGENTS, session: SESSION, window: a.name }, { detachKey: key });
    try {
      const [session] = viewerSessions();
      assert.equal(viewer.args.at(-1), `=${session}`);
      assert.deepEqual(keyTables()[session], bindings(key), key);
      assert.equal(tmuxOn(AGENTS, "show-options", "-v", "-t", session, "key-table"), session);
      const binding = lines(tmuxOn(AGENTS, "list-keys")).find((line) => line.includes(`-T ${session} `) && !MOUSE_KEYS.some((m) => line.includes(m)));
      assert.match(binding, /\sset-option @oats-detached 1 \\; detach-client$/, "one binding of two commands");
      assert.equal(viewer.detached(), false, "prepared, never left");
      assert.equal(LOCKED in keyTables(), false, "a keyed viewer makes no locked table");
    } finally { viewer.cleanup(); }
    nothingLeft(key);
  }
});

for (const order of ["keyed, then plain", "plain, then keyed"]) {
  test(`two viewers on one server, ${order}: the key detaches the keyed viewer only, with status ${SESSION_DETACHED_EXIT}; the same key in the plain viewer is text for its agent; the tmux prefix in the keyed viewer is text for its agent; each table holds exactly its own bindings`, async (t) => {
    t.after(sweep);
    const tag = order.startsWith("keyed") ? "kp" : "pk";
    const keyedAgent = await agent(`keyed-${tag}`), plainAgent = await agent(`plain-${tag}`);
    let keyed, plain;
    if (tag === "kp") { keyed = await view(keyedAgent, { key: "C-\\" }); plain = await view(plainAgent); }
    else { plain = await view(plainAgent); keyed = await view(keyedAgent, { key: "C-\\" }); }
    const tables = () => { const all = keyTables(); return { locked: all[LOCKED], keyed: all[keyed.session] }; };
    // After the other viewer opened: the plain one emptied and bound the locked table again.
    assert.deepEqual(tables(), { locked: bindings(), keyed: bindings("C-\\") });
    assert.deepEqual(viewerTables(), [keyed.session], "the plain viewer has no table of its own");

    // The prefix is no prefix in a viewer: both keys go to the agent.
    keyed.press("C-b", "d");
    await waitUntil(() => typed(keyedAgent) === "^Bd", `the keyed viewer's agent read C-b d (it read ${JSON.stringify(typed(keyedAgent))})`);
    assert.equal(keyed.isAttached(), true);

    // The key in the plain viewer: text for its agent, and the client stays.
    plain.press("C-\\", "x");
    await waitUntil(() => typed(plainAgent) === "^\\x", `the plain viewer's agent read C-\\ (it read ${JSON.stringify(typed(plainAgent))})`);
    assert.equal(plain.isAttached(), true);
    assert.equal(plain.status(), null);

    // The key in the keyed viewer: that client leaves, its agent never reads the key.
    keyed.press("C-\\");
    assert.equal(await keyed.ended(), SESSION_DETACHED_EXIT, keyed.shows());
    assert.equal(typed(keyedAgent), "^Bd", "the key is taken from the agent's input");
    assert.equal(plain.isAttached(), true, "the other viewer is untouched");
    assert.equal(plain.status(), null);
    assert.deepEqual(viewerSessions(), [plain.session]);
    assert.deepEqual(viewerTables(), [], "the keyed viewer's table went with it");
    assert.deepEqual(keyTables()[LOCKED], bindings());
    assert.equal(inMode(keyedAgent), "0");

    // A plain viewer ends when its agent's window does, as before: status 0.
    tmuxOn(AGENTS, "kill-window", "-t", plainAgent.target);
    assert.equal(await plain.ended(), 0, plain.shows());
    nothingLeft(order);
    assert.deepEqual(keyTables()[LOCKED], bindings(), "the locked table is the server's and stays");
  });
}

test("two keyed viewers on one server, with the same key and with different keys: each has its own table, each key leaves its own viewer only, and the other viewer's key is text", async (t) => {
  t.after(sweep);
  const one = await agent("pair-one"), two = await agent("pair-two"), three = await agent("pair-three");
  dropLockedTable();
  const first = await view(one, { key: "C-\\" }), second = await view(two, { key: "C-\\" }), third = await view(three, { key: "F12" });
  const all = keyTables();
  assert.deepEqual([all[first.session], all[second.session], all[third.session]], [bindings("C-\\"), bindings("C-\\"), bindings("F12")]);
  assert.equal(LOCKED in all, false, "none of them made the locked table");

  third.press("C-\\", "x"); // another viewer's key
  await waitUntil(() => typed(three) === "^\\x", `the F12 viewer's agent read C-\\ (it read ${JSON.stringify(typed(three))})`);
  first.press("C-\\");
  assert.equal(await first.ended(), SESSION_DETACHED_EXIT, first.shows());
  assert.equal(second.isAttached() && third.isAttached(), true);
  assert.deepEqual(viewerTables().sort(), [second.session, third.session].sort());
  assert.deepEqual(keyTables()[second.session], bindings("C-\\"), "the same key, still bound for the viewer that stays");

  second.press("F12", "x");
  await waitUntil(() => typed(two).endsWith("x"), "the second viewer's agent read F12");
  assert.match(typed(two), /^\^\[\[24~x$/, "F12 arrives as the terminal's sequence, not as a detach");
  second.press("C-\\");
  assert.equal(await second.ended(), SESSION_DETACHED_EXIT, second.shows());
  third.press("F12");
  assert.equal(await third.ended(), SESSION_DETACHED_EXIT, third.shows());
  assert.equal(typed(one), "", "the first agent read nothing");
  assert.equal(typed(three), "^\\x");
  nothingLeft("three keyed viewers");
  assert.equal(LOCKED in keyTables(), false);
});

test("the lock still holds for a keyed viewer: beside a sibling window in the agents' session, window keys are text for the agent, the viewer session has one window, and when the agent's window ends the viewer ends with status 0 and the sibling read nothing", async (t) => {
  t.after(sweep);
  const sibling = await agent("lock-sibling"), a = await agent("lock-viewed");
  const viewer = await view(a, { key: "C-\\" });
  const windows = () => lines(tmuxOn(AGENTS, "list-windows", "-t", `=${viewer.session}`, "-F", "#{window_name}"));
  assert.deepEqual(windows(), [a.name]);
  viewer.press("C-b", "n", "C-b", "p", "C-b", "w", "C-b", "c", "C-b", "0");
  await waitUntil(() => typed(a) === "^Bn^Bp^Bw^Bc^B0", `the agent read the window keys (it read ${JSON.stringify(typed(a))})`);
  assert.deepEqual(windows(), [a.name], "no key selected, made or linked another window");
  assert.equal(viewer.isAttached(), true);

  tmuxOn(AGENTS, "kill-window", "-t", a.target);
  // A viewer that had fallen through to the sibling would still be attached.
  assert.equal(await viewer.ended(), 0, `the window ended, the key was not used: ${viewer.shows()}`);
  assert.equal(typed(sibling), "", "the sibling's pane read nothing");
  nothingLeft("the agent's window ended");
});

for (const mode of ["emacs", "vi"]) {
  test(`scrolled back through the viewer's own wheel binding, mode-keys ${mode}: C-\\ and F12, which copy mode does not bind, detach from copy mode with status ${SESSION_DETACHED_EXIT}; C-e, which it binds, acts there and detaches once the mode is left`, async (t) => {
    t.after(sweep);
    const a = await agent(`scrolled-${mode}`);
    tmuxOn(AGENTS, "set-option", "-w", "-t", a.target, "mode-keys", mode);
    const scrolled = () => Number(tmuxOn(AGENTS, "display-message", "-p", "-t", a.target, "#{scroll_position}"));
    // The first turn of the wheel enters copy mode, the second scrolls: far enough from the bottom
    // that a key which scrolls down a line (vi's C-e) does not leave the mode by itself.
    const scrollBack = async (viewer) => {
      assert.equal(inMode(a), "0");
      viewer.send(WHEEL_UP);
      await waitUntil(() => inMode(a) === "1", `the wheel put the pane in copy mode; the terminal shows: ${viewer.shows()}`);
      viewer.send(WHEEL_UP);
      await waitUntil(() => scrolled() > 1, `the wheel scrolled the pane back (it is at ${scrolled()})`);
    };
    for (const key of ["C-\\", "F12"]) {
      const viewer = await view(a, { key });
      await scrollBack(viewer);
      viewer.press(key);
      assert.equal(await viewer.ended(), SESSION_DETACHED_EXIT, `${key}: ${viewer.shows()}`);
      // As when a viewer is closed while scrolled back: the pane stays in copy mode for the next one.
      assert.equal(inMode(a), "1");
      tmuxOn(AGENTS, "send-keys", "-X", "-t", a.target, "cancel");
      nothingLeft(`${key} in copy mode`);
    }
    const viewer = await view(a, { key: "C-e" });
    await scrollBack(viewer);
    viewer.press("C-e", "q"); // copy mode's own C-e, then leave the mode
    await waitUntil(() => inMode(a) === "0", "q left copy mode");
    assert.equal(viewer.status(), null, `C-e in copy mode did not detach: ${viewer.shows()}`);
    assert.equal(viewer.isAttached(), true);
    viewer.press("C-e");
    assert.equal(await viewer.ended(), SESSION_DETACHED_EXIT, viewer.shows());
    assert.equal(typed(a), "", "none of the keys reached the agent");
    nothingLeft("C-e after copy mode");
  });
}

test(`SIGQUIT under a keyed viewer, whose key may be the terminal's QUIT character: after a leave by the key it changes nothing (status ${SESSION_DETACHED_EXIT}, nothing left), whether it lands on the marker read, on the cleanup, or before the client is seen to exit; without the key's binding it stops the attach with status 1, nothing left`, async (t) => {
  t.after(sweep);
  const a = await agent("quit");
  // A `tmux` in front sends QUIT to its parent, the `oats` process, at a chosen call. With no
  // listener Node would end there with status 131 and leave the viewer session and its table.
  const fronts = {
    "on the marker read": tmuxInFront("quit-at-marker", `case " $* " in *" show-options "*"@oats-detached"*) kill -QUIT $PPID ;; esac`),
    "on the cleanup": tmuxInFront("quit-at-cleanup", `case " $* " in *" kill-session "*|*" unbind-key -a -q -T oatsview-"[0-9]*) [ -e ${shq(join(base, "quit-armed"))} ] && kill -QUIT $PPID ;; esac`),
    // The client has left by the key and given the terminal back, but `oats` has not seen it exit
    // yet: the key pressed twice. The real client runs, then QUIT, then the wait.
    "before the client is seen to exit": tmuxInFront("quit-after-client", `case " $* " in *" attach-session "*) ${shq(WRAPPER)} "$@"; status=$?; kill -QUIT $PPID; sleep 1; exit $status ;; esac`),
  };
  for (const [when, front] of Object.entries(fronts)) {
    rmSync(join(base, "quit-armed"), { force: true });
    const viewer = await view(a, { key: "C-\\", front });
    writeFileSync(join(base, "quit-armed"), ""); // the cleanup calls that follow the detach, not the preparation's unbind
    viewer.press("C-\\");
    assert.equal(await viewer.ended(), SESSION_DETACHED_EXIT, `${when}: ${viewer.shows()}`);
    nothingLeft(`QUIT ${when}`);
  }

  // QUIT to the process while its client is attached: the key's binding did not run.
  const stopped = await view(a, { key: "C-\\" });
  process.kill(stopped.pid(), "SIGQUIT");
  assert.equal(await stopped.ended(), 1, stopped.shows());
  nothingLeft("QUIT while attached");

  // QUIT while the viewer is being prepared, before the client has the terminal.
  const early = await view(a, { key: "C-\\", front: tmuxInFront("quit-at-prepare", `case " $* " in *" link-window "*) kill -QUIT $PPID ;; esac`), attach: false });
  assert.equal(await early.ended(), 1, early.shows());
  nothingLeft("QUIT during preparation");
  assert.equal(typed(a), "", "the agent read none of it");
});

test("SIGTERM to a keyed viewer's process ends it as it ends a plain one, and its table is unbound with its session", async (t) => {
  t.after(sweep);
  const a = await agent("term");
  const viewer = await view(a, { key: "F12" });
  assert.deepEqual(viewerTables(), [viewer.session]);
  process.kill(viewer.pid(), "SIGTERM");
  assert.notEqual(await viewer.ended(), SESSION_DETACHED_EXIT, viewer.shows());
  nothingLeft("SIGTERM");
});

test("a keyed attach that cannot go on leaves nothing: a refused key makes no tmux call, and a failure after the key was bound, or a client with no terminal, removes the session and the table", async (t) => {
  t.after(sweep);
  const a = await agent("refused");
  const log = join(base, "calls.log");
  const logging = tmuxInFront("logging", `printf '%s\\n' "$*" >> ${shq(log)}`);
  const cli = (args, front = logging) => { writeFileSync(log, ""); return spawnSync(process.execPath, [CLI, "session", "attach", "--home", a.home, ...args], { encoding: "utf8", env: { ...process.env, PATH: `${front}:${process.env.PATH}` } }); };
  const calls = () => lines(readFileSync(log, "utf8"));

  for (const bad of ["C-h", "C-i", "C-m", "C-[", "M-[", "Any", "WheelUpPane", "a", "C-A", "C-b d", "C-]; kill-server", "F13", "true"]) {
    const r = cli(["--detach-key", bad]);
    assert.equal(r.status, 1, bad);
    assert.equal(r.stderr, `oats: --detach-key must be one key: C-<a letter except h, i and m, or one of \\ ] ^ _>, M-<a lowercase letter or digit>, or F1 to F12 with at most one of C-, M-, S- (got ${JSON.stringify(bad)})\n`);
    assert.deepEqual(calls(), [], `${bad}: refused before any tmux call`);
  }
  for (const args of [["--detach-key"], ["--detach-key", "--verbose"], ["--detach-key="]]) {
    const r = cli(args);
    assert.equal(r.status, 1, args.join(" "));
    assert.match(r.stderr, /^oats: --detach-key=? needs a value\n$/);
    assert.deepEqual(calls(), []);
  }
  const json = cli(["--detach-key", "C-\\", "--json"]);
  assert.equal(json.status, 1);
  assert.equal(JSON.parse(json.stdout).error.message, "session attach is interactive; omit --json", "--json with a local attach stays refused");
  assert.deepEqual(calls(), []);
  nothingLeft("refusals");

  // No terminal here: the client itself fails, after the viewer and its table were made.
  const noTerminal = cli(["--detach-key=C-\\"]);
  assert.notEqual(noTerminal.status, 0);
  assert.notEqual(noTerminal.status, SESSION_DETACHED_EXIT);
  assert.ok(calls().some((c) => / bind-key -T oatsview-\d+-[0-9a-f]{8} C-\\ /.test(c)) && calls().some((c) => c.includes(" attach-session ")), calls().join(" | "));
  nothingLeft("a client with no terminal");

  // tmux refuses the last option of the preparation: the key is already bound.
  const refusing = tmuxInFront("no-mouse", `printf '%s\\n' "$*" >> ${shq(log)}\ncase " $* " in *" mouse on "*) echo 'refused' >&2; exit 1 ;; esac`);
  const failed = cli(["--detach-key", "F12"], refusing);
  assert.equal(failed.status, 1);
  assert.ok(calls().some((c) => / bind-key -T oatsview-\d+-[0-9a-f]{8} F12 /.test(c)), calls().join(" | "));
  assert.equal(calls().some((c) => c.includes(" attach-session ")), false);
  nothingLeft("a failed preparation");
  assert.equal(typed(a), "");
});
