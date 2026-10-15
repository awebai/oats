// `oats tui` opens an agent's terminal in a panel beside the list: Enter on a running instance
// starts the kernel's own viewer, `oats session attach --home <home>` with no key of its own, in a
// pane of a private tmux server the run owns, and the TUI draws that pane's screen where the detail
// was (docs/tui.md, "Open an agent's terminal"). Typing goes to the agent; the back key (default
// `C-\`, the byte 0x1c) gives the focus to the list, z zooms, c closes.
//
// Real tmux throughout, never the operator's (the conventions of test/tui-terminal.test.mjs): the
// fixture owns a private TMUX_TMPDIR, and every server here is a socket inside the fixture. AGENTS
// is the server the homes record: the agent's window runs a small program that shows every byte it
// reads. TERM plays the user's terminal: its pane runs an interactive shell, the real `oats tui` is
// typed there through the checkout's CLI with TMPDIR a short directory of the fixture's, so the
// run's private directory, and the socket of its private server in it, are inside the fixture too
// (the fixture's tmux refuses any other socket, and a socket path has a short limit). A signal goes
// only to the pid the command's own wrapper wrote down. Every wait is on what a pane shows or on a
// file, within the file's budget.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { assertNoFixtureProcesses, fixtureBase, isolateSessionEnvironment, systemExecutable, waitUntil } from "./helpers/host-fixture.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const hostTool = (name) => { try { return systemExecutable(name); } catch { return null; } };

// The host's own tools, found before the environment is isolated (PATH is then the fixture's).
const REAL_TMUX = hostTool("tmux");
/** The panel makes its keeper's FIFO with the base system's `mkfifo` (packages/tui/lib/panel.mjs,
 *  THE KEEPER), which the fixture's PATH does not link: the host's is linked there for this file. */
const HOST_MKFIFO = hostTool("mkfifo");
/** Outside CI a host without tmux skips these tests; in CI test/tmux-in-ci.test.mjs fails. */
const NO_TMUX = REAL_TMUX ? false : "tmux is not on PATH: these tests drive `oats tui`, its private tmux server and the kernel's viewer in a real tmux (test/tmux-in-ci.test.mjs fails for this in CI)";
const base = fixtureBase("oats-tp-"); // short: the sockets of three servers live in it
/** Set by the setup (test.before below); test.after undoes what of it was done. */
let restoreEnvironment = () => {}, fx = null;
const AGENTS = join(base, "agents.sock");
const TERM = join(base, "term.sock");
const SESSION = "team";
const NAME = "alpha";

/** Every test starts the real CLI, which reads the fixture with the real kernel before it draws,
 *  and every open starts the real kernel's viewer: on a loaded host each takes seconds. Once the
 *  budget is spent every further wait fails at once, so a program that hangs cannot hold a shard. */
const BUDGET_MS = 240000;
const FILE_DEADLINE = Date.now() + BUDGET_MS;

const tmuxRaw = (socket, ...args) => execFileSync("tmux", ["-u", "-S", socket, ...args], { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"] });
const tmuxOn = (socket, ...args) => tmuxRaw(socket, ...args).trim();
const lines = (text) => text.split("\n").filter(Boolean);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; } };
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

// ---- the agents' server ------------------------------------------------------------------------
const sessionsOf = (socket) => { try { return lines(tmuxOn(socket, "list-sessions", "-F", "#{session_name}")); } catch { return []; } };
const viewerSessions = () => sessionsOf(AGENTS).filter((s) => s.startsWith("oatsview-"));
/** The sessions that have a client attached, one entry per client. */
const attached = () => { try { return lines(tmuxOn(AGENTS, "list-clients", "-F", "#{session_name}")); } catch { return []; } };
/** Every key table of a server, from the UNFILTERED list: `list-keys -T <table>` prints nothing for
 *  a table that holds exactly one binding. */
const keyTableNames = (socket) => [...new Set(lines(tmuxOn(socket, "list-keys")).map((line) => /^bind-key\s+(?:-r\s+)?-T\s+(\S+)/.exec(line)?.[1]).filter(Boolean))].sort();
/** The tables viewers made, the locked table of a viewer with no key included. */
const viewerTables = () => keyTableNames(AGENTS).filter((name) => name.startsWith("oatsview-"));
/** THE SHARED TABLE. The panel's viewer has no key of its own, and a viewer with no key binds its
 *  mouse keys in the kernel's one table for every such viewer, `oatsview-locked`
 *  (lib/session-viewer.mjs LOCKED_TABLE, bound at line 84 from MOUSE_BINDINGS), which its cleanup()
 *  leaves by design (line 68): it is every keyless viewer's, the Desktop's included, and one
 *  viewer's unbind would strip the others'. So a closed viewer leaves no session and no table of
 *  its own, and that table holds exactly the kernel's two mouse bindings, no detach among them. */
const LOCKED_TABLE = "oatsview-locked";
const LOCKED_KEYS = ["MouseDrag1Pane", "WheelUpPane"];
/** What is wrong with the agents' server's viewer tables after a viewer closed: a table of a
 *  viewer's own, or a shared table that holds anything but the mouse bindings. `seen`: a keyless
 *  viewer ran since the table was last emptied, so the shared table must be there. */
function viewerTableFaults({ seen = true } = {}) {
  const faults = [];
  const own = viewerTables().filter((name) => name !== LOCKED_TABLE);
  if (own.length) faults.push(`a viewer's own key table is left: ${JSON.stringify(own)}`);
  const bound = lines(tmuxOn(AGENTS, "list-keys")).filter((line) => new RegExp(`^bind-key\\s+(?:-r\\s+)?-T\\s+${LOCKED_TABLE}\\s`).test(line));
  const keys = bound.map((line) => /-T\s+\S+\s+(\S+)/.exec(line)?.[1]).sort();
  if ((seen || bound.length) && JSON.stringify(keys) !== JSON.stringify(LOCKED_KEYS)) faults.push(`${LOCKED_TABLE} binds ${JSON.stringify(keys)}, not the kernel's mouse bindings ${JSON.stringify(LOCKED_KEYS)}`);
  if (bound.some((line) => /detach/.test(line))) faults.push(`${LOCKED_TABLE} holds a detach: ${JSON.stringify(bound)}`);
  return faults;
}
/** After a test, whatever it left on the agents' server: a failed test must not fail the ones after it. */
function sweepAgents() {
  for (const session of viewerSessions()) { try { tmuxOn(AGENTS, "kill-session", "-t", `=${session}`); } catch { /* gone */ } }
  for (const table of viewerTables()) { try { tmuxOn(AGENTS, "unbind-key", "-a", "-q", "-T", table); } catch { /* gone */ } }
}

// ---- a run's private directory and server (packages/tui/lib/panel.mjs) ---------------------------
/** The run directories `oats-tui-*` in a TMPDIR the TUI was given. */
const runDirs = (tmp) => (existsSync(tmp) ? readdirSync(tmp).filter((name) => name.startsWith("oats-tui-")).sort().map((name) => join(tmp, name)) : []);
const panelSocket = (dir) => join(dir, "tmux");
/** Whether a server answers on a socket. */
const answers = (socket) => { try { tmuxOn(socket, "list-sessions"); return true; } catch { return false; } };
/** The windows of the panel's one session: its keeper, and one per viewer. */
const panelWindows = (socket) => { try { return lines(tmuxOn(socket, "list-windows", "-t", "=oats-tui", "-F", "#{window_id}")); } catch { return []; } };
/** The command line of each pane's own process (`#{pane_pid}`) in the panel's session, as ps says. */
const paneProcesses = (socket) => lines(tmuxOn(socket, "list-panes", "-s", "-t", "=oats-tui", "-F", "#{pane_pid}"))
  .map((pid) => { try { return execFileSync("ps", ["-o", "args=", "-p", pid], { encoding: "utf8", timeout: 10000 }).trim(); } catch { return `(no process ${pid})`; } });
/** After a test, every private server a run left (a failed test's): killed by its socket. */
function sweepPanels() {
  for (const tmp of tmps) for (const dir of runDirs(tmp)) if (existsSync(panelSocket(dir))) { try { tmuxOn(panelSocket(dir), "kill-server"); } catch { /* gone */ } }
}

// What runs in the agent's pane: it fills some history, puts the terminal in raw mode and shows
// every byte it reads, control bytes in caret notation (C-\ is `^\`). A key that reaches the agent
// is on its screen.
const paneProgram = join(base, "agent-pane.mjs");
const world = {};
/** TERM as the setup left it, before any test (termServer below). */
let TERM_BEFORE = null;
/** Every TMPDIR a run was given. */
const tmps = [];
// The setup runs in a hook: when a step of it fails, test.after still ends what the steps before it
// made. A file that fails while it loads runs no hook at all.
test.before(async () => {
  if (!REAL_TMUX) return;
  restoreEnvironment = isolateSessionEnvironment(base);
  assert.ok(HOST_MKFIFO, "mkfifo is on the host's PATH");
  symlinkSync(HOST_MKFIFO, join(process.env.PATH.split(delimiter)[0], "mkfifo"));
  fx = v2Deployment();
  writeFileSync(paneProgram, `for (let i = 0; i < 50; i++) console.log("history " + i);
process.stdin.setRawMode(true);
// F starts a flood: the agent prints without pause, as a busy agent does, until its window goes.
process.stdin.on("data", (data) => {
  if (data.includes(70)) setInterval(() => process.stdout.write("flood ".repeat(12) + "\\n"), 1);
  process.stdout.write([...data].map((b) => (b < 32 ? "^" + String.fromCharCode(b + 64) : b === 127 ? "^?" : String.fromCharCode(b))).join(""));
});
process.stdout.write("pane-ready:");
`);
  tmuxOn(AGENTS, "new-session", "-d", "-s", SESSION, "-n", "hq", "-x", "100", "-y", "30", "-c", base, "cat");
  // One session that only keeps the terminals' server: every test makes, and removes, its own.
  tmuxOn(TERM, "new-session", "-d", "-s", "hold", "-n", "hold", "-x", "80", "-y", "24", "-c", base, "cat");
  tmuxOn(TERM, "set-option", "-g", "default-terminal", "screen");

  // The one instance: a real workspace-model home recorded as launched in the window `alpha` of
  // AGENTS, receipt included. The kernel then reads it as running while that window is there, and
  // its viewer attaches to that window.
  const saved = process.env.PATH;
  process.env.PATH = fx.env.PATH;
  try { world.home = (await fx.spawn("dev", { name: NAME, harness: "claude" })).home; } finally { process.env.PATH = saved; }
  const baselineOf = (home) => join(dirname(home), ".oats-retirement", "baselines", `${createHash("sha256").update(home).digest("hex")}.json`);
  const { launch: _recipe, ...spawned } = readJson(join(world.home, "instance.json"));
  const tmux = { session: SESSION, window: NAME, socket: AGENTS };
  writeFileSync(join(world.home, "instance.json"), JSON.stringify({ ...spawned, tmux, command: "true", launched: true }, null, 2) + "\n");
  writeFileSync(baselineOf(world.home), JSON.stringify({ ...readJson(baselineOf(world.home)), runtime: { launched: true, tmux } }, null, 2) + "\n", { mode: 0o600 });
  // A terminal's shell is started through this: the fixture's environment, then its arguments.
  world.enter = join(fx.base, "enter.sh");
  writeFileSync(world.enter, `#!/bin/sh\n${Object.entries(fx.env).map(([name, value]) => `export ${name}=${shq(value)}`).join("\n")}\nexec "$@"\n`);
  TERM_BEFORE = termServer();
});
const AGENT_TARGET = `=${SESSION}:=${NAME}`;
/** What the agent's pane has read since it started, as it shows it; null before it reads, or with
 *  no window. */
function typed() {
  let screen;
  try { screen = tmuxOn(AGENTS, "capture-pane", "-p", "-J", "-t", AGENT_TARGET).replace(/\n/g, ""); } catch { return null; }
  const at = screen.lastIndexOf("pane-ready:");
  return at < 0 ? null : screen.slice(at + "pane-ready:".length).trimEnd();
}
const agentWindowThere = () => { try { tmuxOn(AGENTS, "display-message", "-p", "-t", AGENT_TARGET, "#{window_id}"); return true; } catch { return false; } };
/** The agent's window, new: its screen holds the history and nothing it read. */
async function agentWindow() {
  try { tmuxOn(AGENTS, "kill-window", "-t", AGENT_TARGET); } catch { /* not there */ }
  tmuxOn(AGENTS, "new-window", "-d", "-t", `=${SESSION}:`, "-n", NAME, "-c", base, `${shq(process.execPath)} ${shq(paneProgram)}`);
  await waitUntil(() => typed() !== null, "the agent's pane reads its terminal", Math.min(10000, Math.max(1, FILE_DEADLINE - Date.now())));
}
const killAgentWindow = () => tmuxOn(AGENTS, "kill-window", "-t", AGENT_TARGET);

/** The terminals' server as a person's own tmux would notice a change in it: its sessions and
 *  windows, its key bindings and its options. */
function termServer() {
  return {
    windows: lines(tmuxOn(TERM, "list-windows", "-a", "-F", "#{session_name}:#{window_index}:#{window_name}")).sort(),
    keys: tmuxOn(TERM, "list-keys"),
    global: tmuxOn(TERM, "show-options", "-g"), server: tmuxOn(TERM, "show-options", "-s"), windowGlobal: tmuxOn(TERM, "show-options", "-gw"),
    window: tmuxOn(TERM, "show-options", "-w", "-t", "=hold:"),
  };
}

test.after(() => {
  if (REAL_TMUX) {
    try { sweepPanels(); } catch { /* nothing left */ }
    for (const socket of [TERM, AGENTS]) { try { execFileSync(REAL_TMUX, ["-S", socket, "kill-server"], { stdio: "ignore", timeout: 10000 }); } catch { /* not running */ } }
  }
  const errors = [];
  // Every TUI, private server, viewer and agent of this file ran in `base`: none is left.
  if (REAL_TMUX) { try { assertNoFixtureProcesses(base, { settleMs: 6000 }); } catch (error) { errors.push(error); } }
  try { fx?.cleanup(); } catch (error) { errors.push(error); }
  restoreEnvironment();
  rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  if (errors.length) throw errors[0];
});

// ---- what the program says, as docs/tui.md and packages/tui/lib give it --------------------------
const TUI = `${shq(process.execPath)} ${shq(CLI)} tui`;
const PROMPT = "tui-panel$";
const OPEN_HINT = "Enter open   ";
const BACK = " C-\\ back to the list";
const LIST_HINTS = " Enter focus terminal   z zoom   c close terminal";
const FAILED = `${NAME} could not be opened.`;
/** The agent's row in the list, selected and running: the green mark and its name, and nothing
 *  after it (the harness is the detail's). */
const RUNNING_ROW = new RegExp(`^> +● ${NAME}$`);
const ROW = new RegExp(`^[> ] +[●○◌?◆] ${NAME}\\b`);
/** The columns the list keeps beside an open terminal (docs/tui.md); the panel starts after the
 *  list and its bar. The agent's row is read from as many columns of the list: its name is short,
 *  and the row has no word, so it is whole there with the detail beside the list too. */
const LIST_BESIDE = 30;
const COLS = 120, ROWS = 40;
const PANEL_COL = LIST_BESIDE + 1;

// ---- a terminal ---------------------------------------------------------------------------------
let opened = 0, started = 0;

/** Wait for what a terminal shows (or for a file), within the file's budget. A timeout says what
 *  was waited for, what is missing and what the pane shows instead. */
async function until(term, predicate, what, faults = () => [], ms = 15000) {
  const left = Math.max(0, FILE_DEADLINE - Date.now());
  try { await waitUntil(predicate, what, Math.min(ms, left)); } catch (error) {
    if (!/^timed out waiting for /.test(error?.message ?? "")) throw error;
    const missing = faults();
    assert.fail(`${error.message}${left === 0 ? ` (this file's budget of ${BUDGET_MS / 1000}s was spent before the wait began)` : ""}${missing.length ? `: ${missing.join("; ")}` : ""}; ${term.id} shows:\n${term.shows()}`);
  }
}

/** A terminal of `cols`x`rows`: a new session of TERM, removed after the test, whose pane runs an
 *  interactive bash with a known prompt, in the fixture's environment. Resolves at the first prompt. */
async function terminal(t, { cols = COLS, rows = ROWS } = {}) {
  const id = `t${++opened}`;
  const shell = `sh ${shq(world.enter)} env LC_ALL=C.UTF-8 LANG=C.UTF-8 HISTFILE=/dev/null PS1=${shq(`${PROMPT} `)} bash --norc --noprofile -i`;
  const [pane, session] = tmuxOn(TERM, "new-session", "-d", "-P", "-F", "#{pane_id} #{session_id}", "-s", id, "-x", String(cols), "-y", String(rows), "-c", base, shell).split(" ");
  const term = {
    id, pane, session,
    /** The screen: one string per row, as `capture-pane` prints them (no trailing spaces). */
    screen() { return tmuxRaw(TERM, "capture-pane", "-p", "-t", pane).split("\n").slice(0, -1); },
    shows() { try { return term.screen().map((row) => `  |${row}`).join("\n"); } catch (error) { return `  (no pane: ${error.message})`; } },
    /** Keys, as tmux names them, typed at the terminal. */
    press(...keys) { tmuxOn(TERM, "send-keys", "-t", pane, ...keys); },
    /** Text typed at the terminal, each character as itself. */
    type(text) { tmuxOn(TERM, "send-keys", "-l", "-t", pane, text); },
    atPrompt() { return term.screen().filter(Boolean).at(-1) === PROMPT; },
    async prompt(why) { await until(term, () => term.atPrompt(), `the shell's prompt in ${id}, ${why}`); },
    /** A command line typed at the shell's prompt, and Enter. */
    async command(text, why) {
      await term.prompt(`before typing ${why}`);
      term.type(text);
      term.press("Enter");
    },
    kill() { try { tmuxOn(TERM, "kill-session", "-t", session); } catch { /* gone */ } },
  };
  t.after(term.kill); // a failed test leaves nothing for the next one
  t.after(sweepAgents);
  t.after(sweepPanels);
  await term.prompt("when its shell has started");
  return term;
}

/** A new TMPDIR for a run, short and inside the fixture. */
function tmpFor() {
  const tmp = join(base, `d${tmps.length + 1}`);
  mkdirSync(tmp, { mode: 0o700 });
  tmps.push(tmp);
  return tmp;
}

/** `oats tui --dir <the deployment>`, the real CLI with TMPDIR `tmp`, typed at a terminal's prompt
 *  through a wrapper that writes its own pid and then becomes the CLI. The shell records the exit
 *  status. Resolves once the agent's row is selected and can be opened: the footer offers Enter. */
async function tui(term, { tmp = tmpFor() } = {}) {
  const n = ++started;
  const pidFile = join(base, `tui-${n}.pid`), statusFile = join(base, `tui-${n}.status`);
  await term.command(`sh -c ${shq(`echo $$ > ${shq(pidFile)}; TMPDIR=${shq(tmp)} exec ${TUI} --dir ${shq(fx.dep)}`)}; echo $? > ${shq(statusFile)}`, "the oats tui command");
  const run = {
    tmp,
    /** The exit status the pane's shell recorded; null while the command runs. */
    status() { const text = existsSync(statusFile) ? readFileSync(statusFile, "utf8") : ""; return /^\d+\n$/.test(text) ? Number(text) : null; },
    async ended(why) { await until(term, () => run.status() !== null, `oats tui in ${term.id} to end ${why}`); return run.status(); },
    /** The list pane's row of the agent, with the selection's mark and its state's mark; null when
     *  no list is drawn (a zoomed terminal). */
    row() { return term.screen().map((text) => [...text].slice(0, LIST_BESIDE).join("").trimEnd()).find((text) => ROW.test(text)) ?? null; },
    footer() { return term.screen().at(-1) ?? ""; },
    /** The panel's rows: each row of the screen from the panel's first column. */
    panel() { return term.screen().map((text) => [...text].slice(PANEL_COL).join("")); },
    /** The agent's screen is in the panel, beside the list: the marker after the panel's first column. */
    beside(after = "") { return run.panel().some((text) => text.startsWith(`pane-ready:${after}`)); },
    /** The agent's screen has the whole body: the marker at the first column, and no list. */
    zoomed(after = "") { return term.screen().some((text) => text.startsWith(`pane-ready:${after}`)) && run.row() === null; },
    /** Enter would open the agent now: its row is selected and running, and the footer says so. */
    openable() { return RUNNING_ROW.test(run.row() ?? "") && run.footer().startsWith(` ${OPEN_HINT}`); },
    async ready(why) {
      await until(term, () => run.openable(), `the agent's row, selected and running, with "Enter open" leading the footer, ${why}`);
      assert.equal(run.status(), null, `oats tui still runs ${why}`);
    },
    /** The line after an open (row 4, above the panes), or null when nothing stands above the
     *  panes: then the rule under the header is the one that opens them, with its joint. */
    outcome() { const screen = term.screen(); return (screen[2] ?? "").includes("┬") ? null : (screen[3] ?? "").trim(); },
    /** What stands under that line: the text the viewer printed, in quotation marks. */
    under() { return (term.screen()[4] ?? "").trim(); },
    /** The time of the last read, as the header shows it. */
    readAt() { return /read (\d\d:\d\d:\d\d)$/.exec(term.screen()[1] ?? "")?.[1] ?? null; },
    /** The run's private directory, once it has one (made at the first open). */
    dir() { const dirs = runDirs(tmp); assert.ok(dirs.length <= 1, `one run directory in ${tmp}: ${dirs}`); return dirs[0] ?? null; },
    /** Enter: the kernel's viewer starts in the panel, its client attached to a viewer session of
     *  AGENTS, and the agent's screen beside the list. Resolves with that session's name. */
    async open(why) {
      const before = new Set(viewerSessions());
      term.press("Enter");
      let session = null;
      await until(term, () => {
        assert.equal(run.status(), null, `oats tui ended after Enter ${why}`);
        session = viewerSessions().find((s) => !before.has(s)) ?? null;
        return session !== null && attached().includes(session) && run.beside() && RUNNING_ROW.test(run.row() ?? "");
      }, `the viewer, attached, with the agent's screen in the panel beside the list ${why}`);
      return session;
    },
    /** Two reads after now. A read is every five seconds while the TUI is used (lib/read.mjs). */
    async twoReadsLater(why) {
      for (const k of [1, 2]) {
        const at = run.readAt();
        await until(term, () => run.readAt() !== null && run.readAt() !== at, `read number ${k} after ${why}`, () => [], 20000);
      }
    },
  };
  await run.ready("after the start");
  run.pid = Number(readFileSync(pidFile, "utf8").trim());
  assert.ok(Number.isInteger(run.pid) && run.pid > 1, `the wrapper wrote the pid (${run.pid})`);
  return run;
}

// ---- on a terminal ------------------------------------------------------------------------------
const TMUX_VERSION = REAL_TMUX ? execFileSync(REAL_TMUX, ["-V"], { encoding: "utf8", timeout: 10000 }).trim() : "none";

test(`Enter on the running agent shows its terminal in the panel beside the list, the list still on screen and the footer naming the back key; c closes it, the detail comes back, and no viewer session and no viewer's own key table is left on the agents' server, the shared one holding only the mouse bindings (${TMUX_VERSION})`, { skip: NO_TMUX }, async (t) => {
  await agentWindow();
  const term = await terminal(t);
  const run = await tui(term);
  assert.equal(run.dir(), null, "no run directory before the first open");
  await run.open("on the running agent");
  assert.equal(run.footer(), BACK, `the footer names the back key alone:\n${term.shows()}`);
  assert.equal(run.panel()[3].trim(), NAME, "the panel's top row names the agent");
  const dir = run.dir();
  assert.ok(dir, "the run directory, made at the first open");
  assert.deepEqual(readJson(join(dir, "owner.json")).tool, "oats-tui");
  assert.equal(readJson(join(dir, "owner.json")).pid, run.pid, "owner.json names the run");
  assert.equal(answers(panelSocket(dir)), true, "the private server answers on its socket in the run directory");
  // The viewer is its pane's own process, not a shell's child: the pane's hang-up (c, or the
  // server killed) then reaches it at once, and it removes its session. A shell between them
  // passed it on only when the shell died, late on a busy machine (CI, tmux 3.4).
  const viewers = paneProcesses(panelSocket(dir)).filter((args) => !args.includes("oats-tui-keeper"));
  assert.equal(viewers.length, 1, `one viewer pane: ${JSON.stringify(viewers)}`);
  assert.match(viewers[0], /\bsession attach\b/, "the pane's process is the viewer itself");
  assert.doesNotMatch(viewers[0], /^\S*sh -c /, "no shell between the pane and the viewer");

  term.press("C-\\");
  await until(term, () => run.footer().startsWith(LIST_HINTS), "the list's focus, with the keys of the open terminal in the footer");
  term.press("c");
  await until(term, () => !run.beside() && (term.screen()[2] ?? "").includes("┬") && viewerSessions().length === 0,
    "the terminal closed: the detail beside the list again, and no viewer session", () => [`viewer sessions: ${JSON.stringify(viewerSessions())}`]);
  assert.equal(run.outcome(), null, "a close the person asked for says nothing");
  assert.deepEqual(viewerTableFaults(), [], "after its pane was killed no table of the viewer's own is left, and the shared one holds only the kernel's mouse bindings");
  assert.equal(agentWindowThere(), true, "the agent keeps running");
  assert.deepEqual(panelWindows(panelSocket(dir)).length, 1, "the panel's server holds its keeper alone");
  await run.ready("after the close");

  term.press("q");
  assert.equal(await run.ended("after q"), 0, term.shows());
});

test("what is typed reaches the agent and shows in the panel; the back key gives the focus to the list and never reaches the agent; z gives the terminal the whole body, and the back key brings the list back with the panel", { skip: NO_TMUX }, async (t) => {
  await agentWindow();
  const term = await terminal(t);
  const run = await tui(term);
  await run.open("before typing");
  term.type("abc");
  await until(term, () => typed() === "abc", `what was typed reached the agent (it read ${JSON.stringify(typed())})`);
  await until(term, () => run.beside("abc"), "the agent's screen, with what it read, in the panel");

  term.press("C-\\");
  await until(term, () => run.footer().startsWith(LIST_HINTS), "the list's focus after the back key");
  assert.equal(typed(), "abc", "the back key was taken from the agent's input");
  // The terminal goes on being drawn while the list has the focus: a key typed from outside shows.
  tmuxOn(AGENTS, "send-keys", "-l", "-t", AGENT_TARGET, "d");
  await until(term, () => run.beside("abcd"), "the panel redrawn with the list focused");

  term.press("z");
  await until(term, () => run.zoomed("abcd") && run.footer() === BACK, "the terminal zoomed: the agent's screen from the first column, no list, the back key in the footer");
  term.type("e");
  await until(term, () => typed() === "abcde", "typing reaches the agent while zoomed");
  term.press("C-\\");
  await until(term, () => run.beside("abcde") && RUNNING_ROW.test(run.row() ?? "") && run.footer().startsWith(LIST_HINTS), "the list back, with the panel beside it");
  assert.equal(typed(), "abcde");

  term.press("q");
  assert.equal(await run.ended("after q"), 0, term.shows());
});

test("an idle open terminal draws no frame for the 2 s it is watched: a frame comes when tmux says the agent's screen changed, and no timer draws one", { skip: NO_TMUX }, async (t) => {
  await agentWindow();
  const term = await terminal(t);
  const run = await tui(term);
  await run.open("before it is watched");
  // Every byte the TUI writes to its terminal, from the pane's side; a frame is one synchronized
  // update (ESC [ ? 2026 h … l), as the screen writes every frame.
  const file = join(base, `${term.id}-output`);
  writeFileSync(file, "");
  tmuxOn(TERM, "pipe-pane", "-o", "-t", term.pane, `cat >> ${shq(file)}`);
  t.after(() => { try { tmuxOn(TERM, "pipe-pane", "-t", term.pane); } catch { /* gone */ } });
  const frames = () => readFileSync(file, "latin1").split("\x1b[?2026h").length - 1;
  // The pipe sees frames: a key the agent shows is drawn.
  term.type("x");
  await until(term, () => typed() === "x" && frames() > 0, "a frame after a key the agent shows");
  // A window that a read of the deployment (every five seconds, and the frame that shows it) does
  // not fall in: watched from just after a read. One window with no frame is the proof; a TUI that
  // polled would draw in each.
  const watched = [];
  for (let attempt = 0; attempt < 4 && !watched.includes(0); attempt++) {
    const at = run.readAt();
    await until(term, () => run.readAt() !== null && run.readAt() !== at, "a read of the deployment, to watch from", () => [], 20000);
    await pause(300);
    const before = frames(), read = run.readAt();
    await pause(2000);
    const drawn = frames() - before;
    if (run.readAt() === read) watched.push(drawn);
  }
  t.diagnostic(`frames in each 2 s window with no read: ${JSON.stringify(watched)}`);
  assert.equal(watched.includes(0), true, `an idle open terminal drew a frame in every window it was watched: ${JSON.stringify(watched)}`);
  assert.equal(run.beside("x"), true, "the terminal is still drawn");
  term.press("C-\\");
  term.press("q");
  assert.equal(await run.ended("after q"), 0, term.shows());
});

test("a viewer that ends at once closes the terminal: the line says it could not be opened, what the viewer printed stands under it, and it is never opened again on its own", { skip: NO_TMUX }, async (t) => {
  await agentWindow();
  const term = await terminal(t);
  const run = await tui(term);
  // The window goes while the row still says running (reads are seconds apart): the viewer the
  // panel starts finds no window, says so on stderr and exits 1.
  killAgentWindow();
  term.press("Enter");
  await until(term, () => run.outcome() === FAILED && !run.beside() && run.footer() !== BACK, `the line ${JSON.stringify(FAILED)}, and the panel closed`, () => [`the line is ${JSON.stringify(run.outcome())}`]);
  // The kernel's viewer found no window to attach to (lib/session-viewer.mjs), said so and exited 1.
  assert.equal(run.under(), '"oats: session no longer exists"', `what the viewer printed stands under the line, in quotation marks:\n${term.shows()}`);
  const dir = run.dir();
  assert.ok(dir, "the panel was started");
  await run.twoReadsLater("the viewer ended");
  assert.deepEqual(panelWindows(panelSocket(dir)).length, 1, "the panel's server holds its keeper alone: nothing was opened again");
  assert.deepEqual(viewerSessions(), [], "no viewer session");
  assert.equal(run.beside(), false, `no terminal is shown:\n${term.shows()}`);
  assert.equal(run.status(), null, "oats tui still runs");
  term.press("q");
  assert.equal(await run.ended("after q"), 0, term.shows());
});

// When a viewer's session outlives a way out, what explains it: the viewer's two files (linked
// before the end, which removes them), its processes as ps shows them now, the agents' sessions,
// and how long the session took to go, if it went at all within 30 s.
/** The viewer's processes: its node (`session attach`) and its tmux client of the agents' server. */
const viewerProcesses = () => lines(execFileSync("ps", ["-eo", "pid,ppid,pgid,stat,args"], { encoding: "utf8", timeout: 10000 })).filter((line) => /session attach|agents\.sock/.test(line) && !/list-sessions|ps -eo| new-session -d -s team /.test(line));
/** Hard links to the run's view files, kept after the run removes its own. */
function keepViewFiles(dir, label) {
  const kept = join(base, `diag-${label}-${Date.now()}`);
  mkdirSync(kept);
  for (const name of readdirSync(dir).filter((entry) => /\.view\.(err|status)$/.test(entry))) { try { linkSync(join(dir, name), join(kept, name)); } catch { /* gone */ } }
  return kept;
}
function viewerFaults(kept, before) {
  const files = readdirSync(kept).map((name) => `${name}: ${JSON.stringify(readFileSync(join(kept, name), "utf8").slice(-2000))}`);
  const now = viewerProcesses(), sessions = sessionsOf(AGENTS);
  if (viewerSessions().length === 0) return [`view files: ${files.join("; ") || "none"}`, `viewer processes before the end: ${JSON.stringify(before)}`, `viewer processes now: ${JSON.stringify(now)}`, `agents' sessions: ${JSON.stringify(sessions)}`, "the session was gone by the time these were read"];
  const started = Date.now();
  while (viewerSessions().length > 0 && Date.now() - started < 30000) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  const went = viewerSessions().length === 0 ? `the session went ${Date.now() - started} ms after the wait gave up` : "the session was still there 30 s after the wait gave up";
  return [`view files: ${files.join("; ") || "none"}`, `viewer processes before the end: ${JSON.stringify(before)}`, `viewer processes now: ${JSON.stringify(now)}`, `agents' sessions: ${JSON.stringify(sessions)}`, went];
}

for (const [how, end, expected] of [
  ["q", (term) => { term.press("C-\\"); term.press("q"); }, 0],
  ["SIGTERM", (term, run) => process.kill(run.pid, "SIGTERM"), 143],
  ["kill -9", (term, run) => process.kill(run.pid, "SIGKILL"), 137],
]) {
  test(`${how} with a terminal open: the private server is gone, its viewer's session and own key table are gone from the agents' server, and the agent is untouched${how === "kill -9" ? "; the run directory is left for the next run's sweep" : "; the run directory is removed"}`, { skip: NO_TMUX }, async (t) => {
    await agentWindow();
    const term = await terminal(t);
    const run = await tui(term);
    await run.open(`before ${how}`);
    term.type("k");
    await until(term, () => typed() === "k", "the agent read a key");
    const dir = run.dir(), socket = panelSocket(dir);
    const kept = keepViewFiles(dir, how.replace(/\W/g, "")), before = viewerProcesses();
    end(term, run);
    assert.equal(await run.ended(`after ${how}`), expected, term.shows());
    await until(term, () => !alive(run.pid), `the process ${run.pid} to be gone after ${how}`);
    await until(term, () => !answers(socket), `the private server's socket to refuse after ${how}`);
    await until(term, () => viewerSessions().length === 0, `no viewer session on the agents' server after ${how}`, () => [`viewer sessions: ${JSON.stringify(viewerSessions())}`, ...viewerFaults(kept, before)]);
    assert.deepEqual(viewerTableFaults(), [], `no viewer's own key table on the agents' server after ${how}, and the shared one holds only the mouse bindings`);
    assert.equal(agentWindowThere(), true, `the agent keeps running after ${how}`);
    assert.equal(typed(), "k", "and nothing more reached it");
    if (how === "kill -9") {
      assert.equal(existsSync(join(dir, "owner.json")), true, "a run killed with no way to clean up leaves its directory, owner.json in it");
    } else {
      assert.equal(existsSync(socket), false, `the socket is removed after ${how}`);
      assert.equal(existsSync(dir), false, `the run directory is removed after ${how}`);
    }
  });
}

// The keeper (packages/tui/lib/panel.mjs, THE KEEPER) ends the private server when the TUI is gone,
// at any moment: a control client whose reader has gone while output is queued for it is never
// ended by tmux, so the stdin EOF alone does not do it. The program below is the panel alone, over
// the real tmux: killed with SIGKILL at a chosen moment of the start (as soon as the control client
// is spawned, at the first bytes it prints, or a few ms later), or (`hold`) left running with its
// viewer open, for the test to stop and kill.
const panelProgram = join(base, "panel-program.mjs");
const PANEL_MODULE = resolve(new URL("../packages/tui/lib/panel.mjs", import.meta.url).pathname);
function writePanelProgram() {
  writeFileSync(panelProgram, `import { spawn as nodeSpawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createPanel } from ${JSON.stringify(PANEL_MODULE)};
const [run, mark, when] = process.argv.slice(2);
const die = () => process.kill(process.pid, "SIGKILL");
const spawn = (...args) => {
  const child = nodeSpawn(...args);
  writeFileSync(mark, String(child.pid));
  if (when === "spawn") die();
  else if (when === "output") child.stdout.once("data", die);
  else if (when !== "hold") setTimeout(die, Number(when));
  return child;
};
const panel = createPanel({ dir: () => run, tmux: "tmux", spawn, env: process.env, capture: (text) => text, onScreen: () => {}, onClosed: () => {} });
panel.open({ argv: ["/bin/sh", "-c", "exec sleep 30"], cols: 40, rows: 10 }).then(() => writeFileSync(mark + ".opened", "")).catch(() => {});
setTimeout(() => {}, 20000);
`);
}
/** A run directory for the program, in a TMPDIR of the fixture's: sweepPanels and the last test see it. */
function programRun(tmp, name) {
  const run = join(tmp, `oats-tui-${name}`);
  mkdirSync(run, { mode: 0o700 });
  chmodSync(run, 0o700);
  return { run, mark: join(tmp, `${name}.pid`), socket: panelSocket(run) };
}
const budget = (ms = 10000) => Math.min(ms, Math.max(0, FILE_DEADLINE - Date.now()));
/** The pids of the processes in a private server's panes: its keeper's and its viewers'. */
const panePids = (socket) => { try { return lines(tmuxOn(socket, "list-panes", "-a", "-F", "#{pane_pid}")).map(Number); } catch { return []; } };

test("a TUI killed with SIGKILL while its private server starts leaves no server: killed at the control client's spawn, at its first bytes, or a few ms on", { skip: NO_TMUX }, async () => {
  writePanelProgram();
  const tmp = tmpFor();
  for (const when of ["spawn", "output", "0", "2", "5", "10", "20", "40"]) {
    const { run, mark, socket } = programRun(tmp, when);
    let signal = null;
    try { execFileSync(process.execPath, [panelProgram, run, mark, when], { timeout: 15000, stdio: "ignore" }); } catch (error) { signal = error.signal; }
    assert.equal(signal, "SIGKILL", `the program killed itself (${when})`);
    assert.equal(existsSync(mark), true, `the control client was spawned before the kill (${when})`);
    const client = Number(readFileSync(mark, "utf8"));
    await waitUntil(() => !alive(client), `the control client ${client} to end after the TUI was killed (${when})`, budget());
    await waitUntil(() => !answers(socket), `no private server to answer after a kill at ${when}`, budget());
    // These two fall inside the start by construction: the open never answered.
    if (when === "spawn" || when === "output") assert.equal(existsSync(`${mark}.opened`), false, `killed during the start (${when})`);
  }
});

test("a stopped TUI keeps its private server and its viewer (Ctrl+Z stops the TUI, and it holds the keeper's FIFO); killed afterwards, the server and the viewer go", { skip: NO_TMUX }, async (t) => {
  writePanelProgram();
  const { run, mark, socket } = programRun(tmpFor(), "hold");
  const program = spawn(process.execPath, [panelProgram, run, mark, "hold"], { stdio: "ignore" });
  t.after(() => { try { program.kill("SIGKILL"); } catch { /* gone */ } });
  await waitUntil(() => existsSync(`${mark}.opened`), "the program's viewer open", budget(15000));
  const panes = panePids(socket);
  assert.equal(panes.length, 2, "the keeper and the viewer");
  process.kill(program.pid, "SIGSTOP");
  await pause(1500);
  assert.equal(answers(socket), true, "a stopped TUI's server still answers");
  assert.deepEqual(panes.filter((pid) => !alive(pid)), [], "its keeper and its viewer still run");
  process.kill(program.pid, "SIGCONT");
  await pause(300);
  assert.equal(answers(socket), true, "and after it continues");
  process.kill(program.pid, "SIGKILL");
  await waitUntil(() => !answers(socket), "no private server to answer after the TUI was killed", budget());
  await waitUntil(() => panes.every((pid) => !alive(pid)), "the keeper and the viewer gone with the server", budget());
});

test("kill -9 while the agent prints without pause: the private server is gone, its viewer's session and own key table are gone from the agents' server, and the agent keeps running", { skip: NO_TMUX }, async (t) => {
  await agentWindow();
  t.after(() => { try { killAgentWindow(); } catch { /* gone */ } }); // the flood ends with its window
  const term = await terminal(t);
  const run = await tui(term);
  await run.open("before the flood");
  term.type("F");
  await until(term, () => run.panel().some((text) => text.startsWith("flood flood")), "the flood in the panel");
  await pause(300);
  const dir = run.dir(), socket = panelSocket(dir);
  process.kill(run.pid, "SIGKILL");
  assert.equal(await run.ended("after kill -9"), 137, term.shows());
  await until(term, () => !answers(socket), "the private server's socket to refuse after kill -9 with the agent printing");
  await until(term, () => viewerSessions().length === 0, "no viewer session on the agents' server after kill -9 with the agent printing", () => [`viewer sessions: ${JSON.stringify(viewerSessions())}`]);
  assert.deepEqual(viewerTableFaults(), [], "no viewer's own key table on the agents' server, and the shared one holds only the mouse bindings");
  assert.equal(agentWindowThere(), true, "the agent keeps running");
});

test("a run's sweep removes what a dead run left, its directory (its server SIGKILLed by the keeper: a socket that refuses, the FIFO, owner.json), and leaves a live run's directory and a look-alike without owner.json alone", { skip: NO_TMUX }, async (t) => {
  await agentWindow();
  const tmp = tmpFor();
  // A live run, with its terminal open.
  const liveTerm = await terminal(t);
  const live = await tui(liveTerm, { tmp });
  await live.open("in the live run");
  const liveDir = live.dir();
  assert.equal(answers(panelSocket(liveDir)), true);
  liveTerm.press("C-\\");
  await until(liveTerm, () => live.footer().startsWith(LIST_HINTS), "the live run's list focused, its terminal open");
  // A dead run: opened, then killed with no way to clean up.
  const deadTerm = await terminal(t);
  const dead = await tui(deadTerm, { tmp });
  const before = new Set(runDirs(tmp));
  deadTerm.press("Enter");
  await until(deadTerm, () => runDirs(tmp).some((dir) => !before.has(dir)) && dead.beside(), "the dead run's terminal open");
  const deadDir = runDirs(tmp).find((dir) => !before.has(dir));
  const deadPanes = panePids(panelSocket(deadDir));
  assert.equal(deadPanes.length, 2, "the dead run's keeper and viewer");
  process.kill(dead.pid, "SIGKILL");
  await dead.ended("after kill -9");
  await until(deadTerm, () => !answers(panelSocket(deadDir)), "the dead run's server gone");
  // Its keeper SIGKILLed the server: the socket file is left, and refuses; the keeper and the
  // viewer are gone, and so is the FIFO's writer; the FIFO and owner.json are left for the sweep.
  await until(deadTerm, () => deadPanes.every((pid) => !alive(pid)), "the dead run's keeper and viewer gone");
  assert.equal(lstatSync(panelSocket(deadDir)).isSocket(), true, "a SIGKILLed server leaves its socket file");
  assert.equal(lstatSync(join(deadDir, "alive")).isFIFO(), true, "and the keeper's FIFO");
  assert.equal(existsSync(join(deadDir, "owner.json")), true);
  // A dead run's directory made by hand: owner.json of a pid that has exited, and no socket.
  const goneDir = join(tmp, "oats-tui-gone00");
  mkdirSync(goneDir, { mode: 0o700 });
  chmodSync(goneDir, 0o700);
  const gonePid = Number(execFileSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8", timeout: 10000 }));
  writeFileSync(join(goneDir, "owner.json"), `${JSON.stringify({ tool: "oats-tui", pid: gonePid, started: new Date().toISOString() })}\n`, { mode: 0o600 });
  // A look-alike: the name and the mode, and no owner.json.
  const alike = join(tmp, "oats-tui-alike0");
  mkdirSync(alike, { mode: 0o700 });
  chmodSync(alike, 0o700);
  writeFileSync(join(alike, "keep"), "not the TUI's\n");
  assert.equal(existsSync(deadDir) && existsSync(goneDir), true, "both dead runs' directories are there before the new run");

  // A new run's sweep, once, at its start.
  const nextTerm = await terminal(t);
  const next = await tui(nextTerm, { tmp });
  await until(nextTerm, () => !existsSync(deadDir) && !existsSync(goneDir), "the dead runs' directories removed by the new run's sweep", () => [`left: ${JSON.stringify(runDirs(tmp))}`]);
  assert.equal(existsSync(join(liveDir, "owner.json")), true, "the live run's directory is left");
  assert.equal(answers(panelSocket(liveDir)), true, "and its server still answers");
  assert.equal(live.beside(), true, `and its terminal is still drawn:\n${liveTerm.shows()}`);
  assert.equal(readFileSync(join(alike, "keep"), "utf8"), "not the TUI's\n", "the look-alike is left as it was");
  assert.equal(agentWindowThere(), true, "the agent keeps running");

  nextTerm.press("q");
  assert.equal(await next.ended("after q"), 0, nextTerm.shows());
  liveTerm.press("q");
  assert.equal(await live.ended("after q"), 0, liveTerm.shows());
});

test("afterwards no viewer session and no viewer's own key table is on the agents' server, no private server answers, and the terminals' server has the sessions, windows, key bindings and options it had before the first test", { skip: NO_TMUX }, () => {
  assert.deepEqual(viewerSessions(), [], "no oatsview-* session on AGENTS");
  assert.deepEqual(viewerTableFaults({ seen: false }), [], "no table of a viewer's own on AGENTS, and the shared one, when there, holds only the mouse bindings");
  assert.deepEqual(sessionsOf(AGENTS), [SESSION], "the agents' server holds its own session only");
  for (const tmp of tmps) for (const dir of runDirs(tmp)) assert.equal(answers(panelSocket(dir)), false, `no private server answers in ${dir}`);
  const after = termServer();
  assert.deepEqual(after.windows, TERM_BEFORE.windows, "TERM's sessions and windows");
  assert.equal(after.keys, TERM_BEFORE.keys, "TERM's key bindings (list-keys)");
  assert.deepEqual(after, TERM_BEFORE, "TERM's options: show-options -g, -s, -gw and -w");
});
