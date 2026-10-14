// `oats tui` opens an agent's terminal here: Enter on a running instance lends the terminal to the
// kernel's own viewer, `oats session attach --home <home> --detach-key <key>` (default `C-\`, the
// byte 0x1c), and the key brings the TUI back (docs/tui.md, "Opening an agent" and "While an agent
// has the terminal").
//
// Real tmux throughout, never the operator's (the conventions of test/session-attach-detach-key.test.mjs
// and test/tui-terminal.test.mjs): the fixture owns a private TMUX_TMPDIR and both servers here are
// sockets inside the fixture. AGENTS is the server the homes record: the agent's window runs a small
// program that shows every byte it reads. TERM plays the user's terminal and the user's own tmux:
// its pane runs an interactive shell, the real `oats tui` is typed there through the checkout's CLI,
// keys are sent to that pane as a terminal sends them, the screen is what `capture-pane` prints and
// the shell records the exit status. A signal goes only to the pid the command's own wrapper wrote
// down. Every wait is on what a pane shows or on a file, within the file's budget.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { assertNoFixtureProcesses, fixtureBase, isolateSessionEnvironment, systemExecutable, waitUntil } from "./helpers/host-fixture.mjs";
import { comparableStty } from "./helpers/stty-line.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const hostTool = (name) => { try { return systemExecutable(name); } catch { return null; } };

// The host's own tools, found before the environment is isolated (PATH is then the fixture's).
const REAL_TMUX = hostTool("tmux");
/** Outside CI a host without tmux skips these tests; in CI test/tmux-in-ci.test.mjs fails. */
const NO_TMUX = REAL_TMUX ? false : "tmux is not on PATH: these tests drive `oats tui` and the kernel's viewer in a real tmux (test/tmux-in-ci.test.mjs fails for this in CI)";
const STTY = REAL_TMUX ? systemExecutable("stty") : null; // not one of the fixture's tools: called by its path
const base = fixtureBase("oats-to-"); // short: two socket paths live in it
const restoreEnvironment = REAL_TMUX ? isolateSessionEnvironment(base) : () => {};
const AGENTS = join(base, "agents.sock");
const TERM = join(base, "term.sock");
const SESSION = "team";
const NAME = "alpha";

/** Every test starts the real CLI, which reads the fixture with the real kernel before it draws,
 *  and every open starts the real kernel's viewer: on a loaded host each takes seconds. Once the
 *  budget is spent every further wait fails at once, so a program that hangs cannot hold a shard. */
const BUDGET_MS = 180000;
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
/** The tables viewers made, the locked table of a plain viewer included: a keyed viewer makes none
 *  but its own, and removes it with its session. */
const viewerTables = () => keyTableNames(AGENTS).filter((name) => name.startsWith("oatsview-"));
/** After a test, whatever it left on the agents' server: a failed test must not fail the ones after it. */
function sweep() {
  for (const session of viewerSessions()) { try { tmuxOn(AGENTS, "kill-session", "-t", `=${session}`); } catch { /* gone */ } }
  for (const table of viewerTables()) { try { tmuxOn(AGENTS, "unbind-key", "-a", "-q", "-T", table); } catch { /* gone */ } }
}

// What runs in the agent's pane: it fills some history, puts the terminal in raw mode and shows
// every byte it reads, control bytes in caret notation (C-\ is `^\`). A key that reaches the agent
// is on its screen.
const paneProgram = join(base, "agent-pane.mjs");
const fx = REAL_TMUX ? v2Deployment() : null;
const world = {};
if (REAL_TMUX) {
  writeFileSync(paneProgram, `for (let i = 0; i < 50; i++) console.log("history " + i);
process.stdin.setRawMode(true);
process.stdin.on("data", (data) => process.stdout.write([...data].map((b) => (b < 32 ? "^" + String.fromCharCode(b + 64) : b === 127 ? "^?" : String.fromCharCode(b))).join("")));
process.stdout.write("pane-ready:");
`);
  tmuxOn(AGENTS, "new-session", "-d", "-s", SESSION, "-n", "hq", "-x", "100", "-y", "30", "-c", base, "cat");
  // One session that only keeps the terminals' server: every test makes, and removes, its own.
  tmuxOn(TERM, "new-session", "-d", "-s", "hold", "-n", "hold", "-x", "80", "-y", "24", "-c", base, "cat");
  tmuxOn(TERM, "set-option", "-g", "default-terminal", "screen");

  // The one instance: a real workspace-model home recorded as launched in the window `alpha` of
  // AGENTS, receipt included, as session-attach-detach-key records one. The kernel then reads it as
  // running while that window is there, and its viewer attaches to that window.
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
}
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
const TERM_BEFORE = REAL_TMUX ? termServer() : null;

test.after(() => {
  if (REAL_TMUX) for (const socket of [TERM, AGENTS]) { try { execFileSync(REAL_TMUX, ["-S", socket, "kill-server"], { stdio: "ignore", timeout: 10000 }); } catch { /* not running */ } }
  const errors = [];
  // Every TUI, viewer and agent of this file ran in `base`: none is left.
  if (REAL_TMUX) { try { assertNoFixtureProcesses(base, { settleMs: 6000 }); } catch (error) { errors.push(error); } }
  try { fx?.cleanup(); } catch (error) { errors.push(error); }
  restoreEnvironment();
  rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  if (errors.length) throw errors[0];
});

// ---- what the program says, as docs/tui.md and lib/model.mjs OPEN_WORDS give it -----------------
const TUI = `${shq(process.execPath)} ${shq(CLI)} tui`;
const PROMPT = "tui-open$";
const OPEN_HINT = "Enter open (C-\\ returns)";
const LEFT = `You left ${NAME}. It keeps running.`;
const FAILED = `${NAME} could not be opened.`;
const NOT_RUNNING = `${NAME} is not running, so it has no terminal to open.`;
/** The agent's row in the list, selected: running (the green mark, then its harness), and
 *  stopped (the hollow mark and the word). */
const RUNNING_ROW = new RegExp(`^> +● ${NAME} +claude$`);
const STOPPED_ROW = new RegExp(`^> +○ ${NAME} +stopped$`);
/** The columns of the list pane where the terminal is wide enough for two panes (docs/tui.md). */
const listCols = (cols) => Math.min(60, Math.max(36, Math.floor(cols * 0.48)));

// ---- a terminal ---------------------------------------------------------------------------------
/** The pane's modes, as tmux tracks them. `bracket_paste_flag` is empty on a tmux that has no such format. */
const FLAGS = ["alternate_on", "cursor_flag", "wrap_flag", "mouse_any_flag", "keypad_flag", "keypad_cursor_flag", "insert_flag", "origin_flag", "bracket_paste_flag"];
let opened = 0, started = 0;

/** Wait for what a terminal shows (or for a file), within the file's budget. A timeout says what
 *  was waited for, what is missing and what the pane shows instead. */
async function until(term, predicate, what, faults = () => [], ms = 10000) {
  const left = Math.max(0, FILE_DEADLINE - Date.now());
  try { await waitUntil(predicate, what, Math.min(ms, left)); } catch (error) {
    if (!/^timed out waiting for /.test(error?.message ?? "")) throw error;
    const missing = faults();
    assert.fail(`${error.message}${left === 0 ? ` (this file's budget of ${BUDGET_MS / 1000}s was spent before the wait began)` : ""}${missing.length ? `: ${missing.join("; ")}` : ""}; ${term.id} (${term.flagsLine()}) shows:\n${term.shows()}`);
  }
}

/** A terminal of `cols`x`rows`: a new session of TERM, removed after the test, whose pane runs an
 *  interactive bash with a known prompt, in the fixture's environment. Resolves at the first prompt. */
async function terminal(t, { cols = 80, rows = 24 } = {}) {
  const id = `t${++opened}`;
  const shell = `sh ${shq(world.enter)} env LC_ALL=C.UTF-8 LANG=C.UTF-8 HISTFILE=/dev/null PS1=${shq(`${PROMPT} `)} bash --norc --noprofile -i`;
  const [pane, session] = tmuxOn(TERM, "new-session", "-d", "-P", "-F", "#{pane_id} #{session_id}", "-s", id, "-x", String(cols), "-y", String(rows), "-c", base, shell).split(" ");
  let files = 0;
  const term = {
    id, pane, session,
    /** The screen: one string per row, as `capture-pane` prints them (no trailing spaces). */
    screen() { return tmuxRaw(TERM, "capture-pane", "-p", "-t", pane).split("\n").slice(0, -1); },
    shows() { try { return term.screen().map((row) => `  |${row}`).join("\n"); } catch (error) { return `  (no pane: ${error.message})`; } },
    flags() { const values = tmuxOn(TERM, "display-message", "-p", "-t", pane, FLAGS.map((flag) => `#{${flag}}`).join(",")).split(","); return Object.fromEntries(FLAGS.map((flag, i) => [flag, values[i] ?? ""])); },
    flagsLine() { try { return Object.entries(term.flags()).map(([flag, value]) => `${flag}=${value}`).join(" "); } catch { return "no flags"; } },
    size() { return tmuxOn(TERM, "display-message", "-p", "-t", pane, "#{pane_width}x#{pane_height}"); },
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
    /** The terminal's line settings, as the real `stty -g` prints them in the pane's own shell,
     *  compared as test/tui-terminal.test.mjs compares them (helpers/stty-line.mjs: without
     *  macOS's PENDIN bit, which is the driver's state, not a setting). */
    async stty(when) {
      const file = join(base, `${id}-stty-${++files}`);
      await term.command(`${shq(STTY)} -g > ${shq(file)}`, `stty -g ${when}`);
      await until(term, () => existsSync(file) && /\n$/.test(readFileSync(file, "utf8")), `the output of stty -g ${when} in ${id}`);
      await term.prompt(`after stty -g ${when}`);
      return comparableStty(readFileSync(file, "utf8").trim());
    },
    kill() { try { tmuxOn(TERM, "kill-session", "-t", session); } catch { /* gone */ } },
  };
  t.after(term.kill); // a failed test leaves nothing for the next one
  t.after(sweep);
  await term.prompt("when its shell has started");
  return term;
}

/** `oats tui --dir <the deployment>`, the real CLI, typed at a terminal's prompt through a wrapper
 *  that writes its own pid and then becomes the CLI. The shell records the exit status, and with
 *  `hold` then waits on a line of its own (`read`, which leaves the terminal's modes alone): until
 *  `release()` the pane shows the terminal as the TUI left it, with no readline in front. Resolves
 *  once the agent's row is selected and can be opened: the footer offers Enter. */
async function tui(term, { hold = false } = {}) {
  const n = ++started;
  const pidFile = join(base, `tui-${n}.pid`), statusFile = join(base, `tui-${n}.status`);
  await term.command(`sh -c ${shq(`echo $$ > ${shq(pidFile)}; exec ${TUI} --dir ${shq(fx.dep)}`)}; echo $? > ${shq(statusFile)}${hold ? "; read -r held" : ""}`, "the oats tui command");
  const run = {
    /** The exit status the pane's shell recorded; null while the command runs. */
    status() { const text = existsSync(statusFile) ? readFileSync(statusFile, "utf8") : ""; return /^\d+\n$/.test(text) ? Number(text) : null; },
    async ended(why) { await until(term, () => run.status() !== null, `oats tui in ${term.id} to end ${why}`); return run.status(); },
    /** The list pane's row of the agent, with the selection's mark and its state's mark. */
    row() { const cols = Number(term.size().split("x")[0]); return term.screen().map((text) => (cols >= 80 ? [...text].slice(0, listCols(cols)).join("") : text).trimEnd()).find((text) => new RegExp(`^[> ] +[●○◌?◆] ${NAME}\\b`).test(text)) ?? null; },
    /** The TUI's own screen is on the terminal: its header, its footer, the agent's row. */
    drawn() { const screen = term.screen(); return /^ oats {2}/.test(screen[0] ?? "") && / help {3}q quit$/.test(screen.at(-1) ?? "") && run.row() !== null; },
    /** Enter would open the agent now: its row is selected and running, and the footer says so. */
    openable() { return run.drawn() && RUNNING_ROW.test(run.row() ?? "") && (term.screen().at(-1) ?? "").startsWith(` ${OPEN_HINT}`); },
    async ready(why) {
      await until(term, () => run.openable(), `the agent's row, selected and running, with ${JSON.stringify(OPEN_HINT)} in the footer, ${why}`);
      assert.equal(run.status(), null, `oats tui still runs ${why}`);
    },
    /** The line after an open (row 4, above the panes), or null when nothing stands above the
     *  panes: then the rule under the header is the one that opens them, with its joint. */
    outcome() { const screen = term.screen(); return (screen[2] ?? "").includes("┬") ? null : (screen[3] ?? "").trim(); },
    /** What stands under that line: the text the viewer printed, in quotation marks. */
    under() { return (term.screen()[4] ?? "").trim(); },
    /** The time of the last read, as the header shows it. */
    readAt() { return /read (\d\d:\d\d:\d\d)$/.exec(term.screen()[1] ?? "")?.[1] ?? null; },
    /** Enter: the kernel's viewer is started and its client is attached to a viewer session of
     *  AGENTS, with the agent's screen on the terminal. Resolves with that session's name. */
    async open(why) {
      const before = new Set(viewerSessions());
      term.press("Enter");
      let session = null;
      await until(term, () => {
        assert.equal(run.status(), null, `oats tui ended after Enter ${why}`);
        session = viewerSessions().find((s) => !before.has(s)) ?? null;
        return session !== null && attached().includes(session) && term.screen().some((row) => row.includes("pane-ready:"));
      }, `the viewer, attached, with the agent's screen on the terminal ${why}`);
      return session;
    },
    /** Back from the viewer: the TUI's screen is drawn again with `line` above the panes (null: no
     *  line of the TUI's), the viewer session is gone, and the TUI's modes are on again. */
    async back(why, line) {
      await until(term, () => run.drawn() && run.outcome() === line && viewerSessions().length === 0,
        `the TUI's screen again ${why}, ${line === null ? "with no line of its own" : `saying ${JSON.stringify(line)}`}, and no viewer session`,
        () => [`the line is ${JSON.stringify(run.outcome())}`, `viewer sessions: ${JSON.stringify(viewerSessions())}`]);
      assert.equal(run.status(), null, `oats tui still runs ${why}`);
      assertRunningModes(term, `back in the TUI ${why}`);
    },
    /** Two reads after now: whatever was in the terminal's input when this was called has long
     *  been read. A read is every five seconds while the TUI is used (lib/read.mjs). */
    async twoReadsLater(why) {
      for (const n of [1, 2]) {
        const at = run.readAt();
        await until(term, () => run.readAt() !== null && run.readAt() !== at, `read number ${n} after ${why}`, () => [], 20000);
      }
    },
    /** Out of the hold: Enter for the shell's `read`, and its prompt. */
    async release(why) { term.press("Enter"); await term.prompt(`after the hold ${why}`); },
  };
  await run.ready("after the start");
  run.pid = Number(readFileSync(pidFile, "utf8").trim());
  assert.ok(Number.isInteger(run.pid) && run.pid > 1, `the wrapper wrote the pid (${run.pid})`);
  return run;
}
/** The modes the TUI switches on, and the ones it never touches (docs/tui.md). */
function assertRunningModes(term, why) {
  const { bracket_paste_flag: paste, insert_flag: _insert, origin_flag: _origin, ...flags } = term.flags();
  assert.deepEqual(flags, { alternate_on: "1", cursor_flag: "0", wrap_flag: "0", mouse_any_flag: "0", keypad_flag: "0", keypad_cursor_flag: "0" }, `${why}: the alternate screen, no cursor, no autowrap; no mouse, no keypad modes`);
  if (paste !== "") assert.equal(paste, "1", `${why}: bracketed paste is on`);
}
/** The terminal as nobody holds it, seen while the shell waits in `read` after the command: the
 *  main screen, the cursor shown, autowrap on, no paste, mouse or keypad mode. Readline is not in
 *  front here, so a paste mode left on would show. */
function assertReleasedModes(term, why) {
  const { insert_flag: _insert, origin_flag: _origin, bracket_paste_flag: paste, ...flags } = term.flags();
  assert.deepEqual(flags, { alternate_on: "0", cursor_flag: "1", wrap_flag: "1", mouse_any_flag: "0", keypad_flag: "0", keypad_cursor_flag: "0" }, `${why}: the main screen, the cursor shown, autowrap on, no mouse and no keypad mode:\n${term.shows()}`);
  if (paste !== "") assert.equal(paste, "0", `${why}: bracketed paste is off`);
}

// ---- on a terminal ------------------------------------------------------------------------------
const TMUX_VERSION = REAL_TMUX ? execFileSync(REAL_TMUX, ["-V"], { encoding: "utf8", timeout: 10000 }).trim() : "none";

test(`Enter on the running agent lends the terminal to the kernel's viewer: what is typed reaches the agent; C-\\ brings the TUI back, saying ${JSON.stringify(LEFT)}, with its screen and its modes again, and the key never reaches the agent (${TMUX_VERSION})`, { skip: NO_TMUX }, async (t) => {
  await agentWindow();
  const term = await terminal(t);
  const run = await tui(term);
  assertRunningModes(term, "before the open");
  const session = await run.open("on the running agent");
  t.diagnostic(`while the viewer has the terminal the pane reports ${term.flagsLine()}`);
  assert.equal(term.flags().alternate_on, "1", "the viewer's client draws on the alternate screen");
  term.type("abc");
  await until(term, () => typed() === "abc", `what was typed reached the agent (it read ${JSON.stringify(typed())})`);
  assert.equal(attached().includes(session), true, "the viewer is still attached");

  term.press("C-\\");
  await run.back("after C-\\", LEFT);
  assert.equal(typed(), "abc", "the key was taken from the agent's input");
  assert.equal(agentWindowThere(), true, "the agent keeps running");
  assert.equal(run.openable(), true, `the row is selected and the footer offers Enter again:\n${term.shows()}`);
  assert.equal(alive(run.pid), true);

  term.press("q");
  assert.equal(await run.ended("after q"), 0, term.shows());
});

test("C-\\ twice in one burst: the second arrives as the viewer leaves, does nothing and is not shown, and the TUI stays with its line; C-\\ again with the TUI in front does nothing either", { skip: NO_TMUX }, async (t) => {
  await agentWindow();
  const term = await terminal(t);
  const run = await tui(term);
  await run.open("before the burst");
  term.press("C-\\", "C-\\"); // one write: both bytes in one burst
  await run.back("after the burst", LEFT);
  // Whatever became of the second byte (the viewer's client read it, the TUI read it, or the
  // terminal made it a SIGQUIT while it was cooked between the two), it was dealt with long before
  // two reads later: the TUI still runs, its line stands, and nothing shows the byte.
  await run.twoReadsLater("the burst");
  assert.equal(run.status(), null, `oats tui still runs after the burst:\n${term.shows()}`);
  assert.equal(run.outcome(), LEFT, `the line stands: a key bound to nothing does not take it away:\n${term.shows()}`);
  assert.equal(term.screen().some((row) => row.includes("^\\") || row.includes("\x1c")), false, `nothing on the screen shows the byte:\n${term.shows()}`);
  assert.equal(typed(), "", "the agent read neither of the two");
  assertRunningModes(term, "after the burst");
  assert.deepEqual(viewerSessions(), [], "the burst opened nothing");

  term.press("C-\\");
  await run.twoReadsLater("C-\\ with the TUI in front");
  assert.equal(run.status(), null, "oats tui still runs after C-\\ with the TUI in front");
  assert.equal(run.outcome(), LEFT, `the line still stands:\n${term.shows()}`);
  assert.equal(run.openable(), true, `the view is as it was:\n${term.shows()}`);
  assert.deepEqual(viewerSessions(), [], "C-\\ opened nothing");
  assertRunningModes(term, "after C-\\ with the TUI in front");
  // Keys are read in order: the help that answers this ? shows the TUI read the key before it.
  term.press("?");
  await until(term, () => term.screen().some((row) => row.trim() === "Keys"), "the help, after C-\\ and ?");
  term.press("Escape");
  await run.ready("after the help was closed");

  term.press("q");
  assert.equal(await run.ended("after q"), 0, term.shows());
});

test("the TUI comes back when the viewer ends without the key: (a) the viewer's session killed from outside, with no line; (b) the agent's window ended while viewed, with no line and the row then stopped; (c) Enter with the agent's window gone while the row still said running: the line that it could not be opened, and the viewer's own words under it", { skip: NO_TMUX }, async (t) => {
  await agentWindow();
  const term = await terminal(t);
  const run = await tui(term);

  // (a) The viewer's session, killed on the agents' server from outside.
  const session = await run.open("for (a)");
  tmuxOn(AGENTS, "kill-session", "-t", `=${session}`);
  await run.back("after the viewer's session was killed from outside", null);
  assert.equal(agentWindowThere(), true, "(a) the agent's window is untouched");
  await run.ready("after (a): the agent still runs and can be opened");
  t.diagnostic(`(a) the screen after the return:\n${term.shows()}`);

  // (b) The agent's window ended while it was viewed: the viewer ends with it, and the TUI says
  // nothing of its own (docs/tui.md): the list shows the agent as it now is.
  await run.open("for (b)");
  killAgentWindow();
  await run.back("after the agent's window ended while viewed", null);
  await until(term, () => STOPPED_ROW.test(run.row() ?? ""), "the agent's row, stopped, after a read", () => [`the row is ${JSON.stringify(run.row())}`]);
  assert.equal(run.outcome(), null, `(b) no line of the TUI's:\n${term.shows()}`);
  assert.equal((term.screen().at(-1) ?? "").includes(OPEN_HINT), false, `(b) the footer no longer offers Enter:\n${term.shows()}`);
  t.diagnostic(`(b) the screen after the return:\n${term.shows()}`);
  // Enter on the stopped row opens nothing, and says why.
  term.press("Enter");
  await until(term, () => run.outcome() === NOT_RUNNING, `the line ${JSON.stringify(NOT_RUNNING)} after Enter on the stopped row`);
  assert.deepEqual(viewerSessions(), [], "Enter on a stopped row starts no viewer");

  // (c) The window comes back, the row says running; then the window is killed and Enter pressed
  // at once, before any read can see it gone. A row read as stopped would answer NOT_RUNNING: the
  // line below says that the viewer was started and failed.
  await agentWindow();
  await run.ready("with the agent's window back");
  killAgentWindow();
  term.press("Enter");
  await run.back("after Enter on an agent whose window was gone", FAILED);
  const under = run.under();
  t.diagnostic(`(c) the screen after the return:\n${term.shows()}`);
  // The kernel's viewer found no window to attach to (lib/session-viewer.mjs), said so and exited 1.
  assert.equal(under, '"oats: session no longer exists"', `(c) what the viewer printed stands under the line, in quotation marks:\n${term.shows()}`);
  assert.deepEqual(viewerSessions(), [], "(c) no viewer session is left");

  term.press("q");
  assert.equal(await run.ended("after q"), 0, term.shows());
});

test("SIGQUIT to the TUI while the viewer has the terminal changes nothing: the viewer stays attached and keeps working, and C-\\ then brings the TUI back", { skip: NO_TMUX }, async (t) => {
  await agentWindow();
  const term = await terminal(t);
  const run = await tui(term);
  const session = await run.open("before SIGQUIT");
  process.kill(run.pid, "SIGQUIT");
  // The viewer still works after the signal: what is typed reaches the agent.
  await pause(500);
  term.type("q");
  await until(term, () => typed() === "q", `what was typed after SIGQUIT reached the agent (it read ${JSON.stringify(typed())})`);
  assert.equal(run.status(), null, `oats tui still runs after SIGQUIT:\n${term.shows()}`);
  assert.equal(alive(run.pid), true, "the process is there");
  assert.equal(attached().includes(session), true, "the viewer is still attached");

  term.press("C-\\");
  await run.back("after SIGQUIT and then C-\\", LEFT);
  assert.equal(typed(), "q");
  term.press("q");
  assert.equal(await run.ended("after q"), 0, term.shows());
});

test("SIGTERM to the TUI while the viewer has the terminal ends both: status 143, the viewer session is gone and the agent keeps running, the terminal is released, the shell's prompt is back and stty -g is what it was before the start", { skip: NO_TMUX }, async (t) => {
  await agentWindow();
  const term = await terminal(t);
  const before = await term.stty("before the start");
  const flagsBefore = term.flags();
  const run = await tui(term, { hold: true });
  await run.open("before SIGTERM");
  process.kill(run.pid, "SIGTERM");
  assert.equal(await run.ended("after SIGTERM"), 143, term.shows());
  await until(term, () => !alive(run.pid), `the process ${run.pid} to be gone after SIGTERM`);
  assert.deepEqual(viewerSessions(), [], "the viewer was ended with it");
  assert.deepEqual(viewerTables(), [], "and its key table");
  assert.equal(agentWindowThere(), true, "the agent keeps running");
  assertReleasedModes(term, "after SIGTERM, before the shell's prompt");
  await run.release("after SIGTERM");
  assert.equal(await term.stty("after SIGTERM"), before, "stty -g after SIGTERM");
  assert.deepEqual(term.flags(), flagsBefore, "the pane's modes at the prompt after SIGTERM");
});

test("a resize of the terminal while the viewer has it: after C-\\ the TUI draws at the new size", { skip: NO_TMUX }, async (t) => {
  await agentWindow();
  const term = await terminal(t);
  const run = await tui(term);
  await run.open("before the resize");
  // A detached session keeps the size it was made with; resize-window sets window-size to manual
  // for that window itself.
  tmuxOn(TERM, "resize-window", "-t", term.pane, "-x", "100", "-y", "30");
  assert.equal(term.size(), "100x30", "tmux resized the pane");
  // The viewer's client follows the new size; the TUI draws nothing while it is lent.
  await until(term, () => Number(tmuxOn(AGENTS, "display-message", "-p", "-t", AGENT_TARGET, "#{window_width}")) === 100, "the agent's window, viewed at the new width");
  term.press("C-\\");
  await run.back("after the resize and C-\\", LEFT);
  const rule = `${"─".repeat(listCols(100))}┬${"─".repeat(100 - listCols(100) - 1)}`;
  const faults = (screen) => [
    ...(screen.length === 30 ? [] : [`the screen has ${screen.length} rows, not 30`]),
    ...(screen[2] === "─".repeat(100) ? [] : [`row 3 is ${JSON.stringify(screen[2])}, not the rule under the header at 100 columns`]),
    ...(screen[4] === rule ? [] : [`row 5 is ${JSON.stringify(screen[4])}, not the rule that opens the two panes at 100 columns`]),
    ...(screen[28] === rule.replace("┬", "┴") ? [] : [`row 29 is ${JSON.stringify(screen[28])}, not the rule over the footer at 100 columns`]),
    ...(/^ oats {2}fixture +1 running$/.test(screen[0] ?? "") && [...screen[0]].length === 99 ? [] : [`the title row is ${JSON.stringify(screen[0])}, not one that ends one cell short of 100 columns`]),
    ...((screen[29] ?? "").startsWith(` ${OPEN_HINT}`) ? [] : [`the footer is ${JSON.stringify(screen[29])}`]),
  ];
  await until(term, () => faults(term.screen()).length === 0, "the TUI drawn at 100x30", () => faults(term.screen()));
  assertRunningModes(term, "after the resize");
  term.press("q");
  assert.equal(await run.ended("after q"), 0, term.shows());
});

test("after an open, C-\\ and q: status 0, stty -g what it was before the TUI, the main screen with the cursor shown, and the paste and mouse modes off", { skip: NO_TMUX }, async (t) => {
  await agentWindow();
  const term = await terminal(t);
  const before = await term.stty("before the start");
  const flagsBefore = term.flags();
  const run = await tui(term, { hold: true });
  await run.open("before q");
  term.press("C-\\");
  await run.back("after C-\\", LEFT);
  term.press("q");
  assert.equal(await run.ended("after q"), 0, term.shows());
  assertReleasedModes(term, "after q, before the shell's prompt");
  assert.equal(term.screen().some((row) => row.includes(OPEN_HINT) || row.includes(LEFT)), false, `the TUI's screen is gone:\n${term.shows()}`);
  await run.release("after q");
  assert.equal(await term.stty("after q"), before, "stty -g after q");
  assert.deepEqual(term.flags(), flagsBefore, "the pane's modes at the prompt after q");
});

test("afterwards no viewer session and no viewer key table is on the agents' server, and the terminals' server has the sessions, windows, key bindings and options it had before the first test", { skip: NO_TMUX }, () => {
  assert.deepEqual(viewerSessions(), [], "no oatsview-* session on AGENTS");
  assert.deepEqual(viewerTables(), [], "no oatsview-* key table on AGENTS");
  assert.deepEqual(sessionsOf(AGENTS), [SESSION], "the agents' server holds its own session only");
  const after = termServer();
  assert.deepEqual(after.windows, TERM_BEFORE.windows, "TERM's sessions and windows");
  assert.equal(after.keys, TERM_BEFORE.keys, "TERM's key bindings (list-keys)");
  assert.deepEqual(after, TERM_BEFORE, "TERM's options: show-options -g, -s, -gw and -w");
});
