// `oats tui` (preview) end to end: the real CLI on a real terminal.
//
// Real tmux, never the operator's (docs/implementation.md; the conventions of
// test/session-attach-detach-key.test.mjs): the fixture owns a private TMUX_TMPDIR, and the one
// server here is a socket inside the fixture. A terminal is a session of that server whose pane
// runs an interactive shell; the command is typed at it, keys are sent as a terminal sends them,
// the screen is what `capture-pane` prints, and the shell records the exit status. A signal goes
// only to a pid the command's own wrapper wrote down. Every wait is on what a pane shows or on a
// file, and the file has a budget: once it is spent every further wait fails at once, so a
// program that hangs cannot hold a shard.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fixtureBase, fixtureEnv, isolateSessionEnvironment, systemExecutable, waitUntil } from "./helpers/host-fixture.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const hostTool = (name) => { try { return systemExecutable(name); } catch { return null; } };

// The host's own tools, found before the environment is isolated (PATH is then the fixture's).
const REAL_TMUX = hostTool("tmux");
/** Outside CI a host without tmux skips the terminal tests; in CI test/tmux-in-ci.test.mjs fails. */
const NO_TMUX = REAL_TMUX ? false : "tmux is not on PATH: these tests drive `oats tui` in a real tmux (test/tmux-in-ci.test.mjs fails for this in CI)";
const STTY = REAL_TMUX ? systemExecutable("stty") : null; // not one of the fixture's tools: called by its path
const base = fixtureBase("oats-tui-"); // short: a socket path lives in it
const restoreEnvironment = REAL_TMUX ? isolateSessionEnvironment(base) : () => {};
const TERM = join(base, "term.sock");

/** Alone the file takes under ten seconds, and about half a minute on a host three times
 *  oversubscribed. A program that never draws would cost a ten-second wait in every test. */
const BUDGET_MS = 90000;
const FILE_DEADLINE = Date.now() + BUDGET_MS;

const tmuxRaw = (...args) => execFileSync("tmux", ["-u", "-S", TERM, ...args], { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"] });
const tmuxOn = (...args) => tmuxRaw(...args).trim();
const lines = (text) => text.split("\n").filter(Boolean);
/** Everything on the private server: its sessions, windows and panes. The TUI makes none. */
const everything = () => lines(tmuxOn("list-panes", "-a", "-F", "#{session_name} #{window_id} #{pane_id}")).sort();
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; } };

if (REAL_TMUX) {
  // One session that only keeps the server: every test makes, and removes, its own.
  tmuxOn("new-session", "-d", "-s", "hold", "-n", "hold", "-x", "80", "-y", "24", "-c", base, "cat");
  tmuxOn("set-option", "-g", "default-terminal", "screen");
}

test.after(() => {
  if (REAL_TMUX) { try { execFileSync(REAL_TMUX, ["-S", TERM, "kill-server"], { stdio: "ignore", timeout: 10000 }); } catch { /* not running */ } }
  restoreEnvironment();
  rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

// ---- what the program says, as the spec gives it ------------------------------------------------
const TUI = `${shq(process.execPath)} ${shq(CLI)} tui`;
const PROMPT = "tui-test$";
const VIEWS = "1 Instances   2 Souls   3 Capabilities";
const BODY = ["This preview draws the frame only.", "Views arrive in later releases."];
const KEYS_ROW = "? help   q quit";
const HELP_KEYS = [/^ *\? {2,}help$/, /^ *Esc {2,}close$/, /^ *q, Ctrl\+C {2,}quit$/, /^ *Ctrl\+Z {2,}suspend$/, /^ *Ctrl\+L {2,}redraw$/];
const NO_TERMINAL = "oats: `oats tui` needs a terminal on stdin and stdout (E_NO_TERMINAL); `oats status` prints the instances once";
const tooSmallLine = (cols, rows) => `Terminal too small: ${cols}x${rows}, oats tui needs 60x15.`;
const UTF8 = { locale: "C.UTF-8", rule: "\u2500" };
const ASCII = { locale: "C", rule: "-" };

/** The rows around the body, the same in the frame and in the help: what is wrong with them. */
function chromeFaults(screen, { cols, rows, rule }) {
  const faults = [];
  const expect = (row, text, what) => { if (screen[row] !== text) faults.push(`${what} (row ${row + 1}) is ${JSON.stringify(screen[row])}, not ${JSON.stringify(text)}`); };
  if (screen.length !== rows) faults.push(`the screen has ${screen.length} rows, not ${rows}`);
  expect(0, `oats${" ".repeat(cols - "oats".length - "preview".length)}preview`, "the title row");
  expect(1, VIEWS, "the views row");
  expect(2, rule.repeat(cols), "the rule under the views");
  expect(rows - 2, rule.repeat(cols), "the rule over the keys");
  return faults;
}
/** What keeps a screen from being the frame at that size: nothing, when it is the frame. The body
 *  is one line where it fits, else a line per sentence, centred both ways; every other row of the
 *  body is empty. */
function frameFaults(screen, { cols = 80, rows = 24, rule = UTF8.rule } = {}) {
  const faults = chromeFaults(screen, { cols, rows, rule });
  if (screen[rows - 1] !== KEYS_ROW) faults.push(`the keys row (row ${rows}) is ${JSON.stringify(screen[rows - 1])}, not ${JSON.stringify(KEYS_ROW)}`);
  const want = BODY.join(" ").length <= cols ? [BODY.join(" ")] : BODY;
  const first = 3 + Math.floor((rows - 5 - want.length) / 2);
  const body = screen.slice(3, rows - 2).map((text, i) => ({ text, row: i + 3 })).filter((r) => r.text !== "");
  const wanted = want.map((text, i) => ({ text: " ".repeat(Math.floor((cols - text.length) / 2)) + text, row: first + i }));
  if (JSON.stringify(body) !== JSON.stringify(wanted)) faults.push(`the body is ${JSON.stringify(body)}, not ${JSON.stringify(wanted)}`);
  return faults;
}
/** The same for the help: the frame's rows around a `Keys` list, one row per action, in the
 *  table's order, and no body line. */
function helpFaults(screen, { cols = 80, rows = 24, rule = UTF8.rule } = {}) {
  const faults = chromeFaults(screen, { cols, rows, rule });
  const area = screen.slice(3, rows - 2);
  const title = area.findIndex((row) => row.trim() === "Keys");
  if (title < 0) faults.push("no row is the title `Keys`");
  const start = area.findIndex((row) => HELP_KEYS[0].test(row));
  if (start < 0 || start < title) faults.push("no row under the title is `?  help`");
  else HELP_KEYS.forEach((pattern, i) => { if (!pattern.test(area[start + i] ?? "")) faults.push(`row ${start + i + 4} is ${JSON.stringify(area[start + i])}, which is not ${pattern}`); });
  if (area.some((row) => BODY.some((sentence) => row.includes(sentence)))) faults.push("the frame's body line is still shown");
  return faults;
}

// ---- a terminal ---------------------------------------------------------------------------------
/** The pane's modes, as tmux tracks them. `bracket_paste_flag` is empty on a tmux that has no such
 *  format (it prints nothing for a name it does not know). */
const FLAGS = ["alternate_on", "cursor_flag", "wrap_flag", "mouse_any_flag", "keypad_flag", "keypad_cursor_flag", "insert_flag", "origin_flag", "bracket_paste_flag"];
let opened = 0, started = 0;

/** Wait for what a terminal shows (or for a file), within the file's budget. A timeout says what
 *  was waited for, what is missing (`faults()`, read when the wait gives up) and what the pane
 *  shows instead. */
async function until(term, predicate, what, faults = () => []) {
  const left = Math.max(0, FILE_DEADLINE - Date.now());
  try { await waitUntil(predicate, what, Math.min(10000, left)); } catch (error) {
    if (!/^timed out waiting for /.test(error?.message ?? "")) throw error;
    const missing = faults();
    assert.fail(`${error.message}${left === 0 ? ` (this file's budget of ${BUDGET_MS / 1000}s was spent before the wait began)` : ""}${missing.length ? `: ${missing.join("; ")}` : ""}; ${term.id} (${term.flagsLine()}) shows:\n${term.shows()}`);
  }
}
/** Wait for a whole screen: `faults(screen)` answers what keeps it from being the one waited for. */
const untilScreen = (term, faults, what) => until(term, () => faults(term.screen()).length === 0, what, () => faults(term.screen()));

/** A terminal of `cols`x`rows`: a new session of the private server, removed after the test. Its
 *  pane runs `command`, or an interactive bash with job control, a known prompt and the locale
 *  named (the TUI reads LC_ALL to choose its rules); then it resolves at the first prompt. */
async function terminal(t, { cols = 80, rows = 24, locale = UTF8.locale, command } = {}) {
  const id = `t${++opened}`;
  const shell = command ?? `env LC_ALL=${locale} LANG=${locale} HISTFILE=/dev/null PS1=${shq(`${PROMPT} `)} bash --norc --noprofile -i`;
  const [pane, session] = tmuxOn("new-session", "-d", "-P", "-F", "#{pane_id} #{session_id}", "-s", id, "-x", String(cols), "-y", String(rows), "-c", base, shell).split(" ");
  let files = 0;
  const term = {
    id, pane, session,
    /** The screen: one string per row, as `capture-pane` prints them (no trailing spaces). */
    screen() { return tmuxRaw("capture-pane", "-p", "-t", pane).split("\n").slice(0, -1); },
    /** The screen with wrapped rows joined: a line longer than the terminal is one line. */
    joined() { return tmuxRaw("capture-pane", "-p", "-J", "-t", pane).split("\n").map((row) => row.trimEnd()).filter(Boolean); },
    shows() { try { return term.screen().map((row) => `  |${row}`).join("\n"); } catch (error) { return `  (no pane: ${error.message})`; } },
    flags() { const values = tmuxOn("display-message", "-p", "-t", pane, FLAGS.map((flag) => `#{${flag}}`).join(",")).split(","); return Object.fromEntries(FLAGS.map((flag, i) => [flag, values[i] ?? ""])); },
    flagsLine() { try { return Object.entries(term.flags()).map(([flag, value]) => `${flag}=${value}`).join(" "); } catch { return "no flags"; } },
    size() { return tmuxOn("display-message", "-p", "-t", pane, "#{pane_width}x#{pane_height}"); },
    /** Keys, as tmux names them, typed at the terminal. */
    press(...keys) { tmuxOn("send-keys", "-t", pane, ...keys); },
    atPrompt() { return term.screen().filter(Boolean).at(-1) === PROMPT; },
    async prompt(why) { await until(term, () => term.atPrompt(), `the shell's prompt in ${id}, ${why}`); },
    /** A command line typed at the shell's prompt, and Enter. */
    async command(text, why) {
      await term.prompt(`before typing ${why}`);
      tmuxOn("send-keys", "-l", "-t", pane, text);
      tmuxOn("send-keys", "-t", pane, "Enter");
    },
    /** The terminal's line settings, as `stty -g` prints them in the pane's own shell. */
    async stty(when) {
      const file = join(base, `${id}-stty-${++files}`);
      await term.command(`${shq(STTY)} -g > ${shq(file)}`, `stty -g ${when}`);
      await until(term, () => existsSync(file) && /\n$/.test(readFileSync(file, "utf8")), `the output of stty -g ${when} in ${id}`);
      await term.prompt(`after stty -g ${when}`);
      return readFileSync(file, "utf8").trim();
    },
    /** Everything a program can leave changed: the line settings, the pane's modes and title, and
     *  every option of the server, the session, the window and the pane. Taken at the prompt. */
    async state(when) {
      const stty = await term.stty(when);
      return {
        stty, flags: term.flags(), title: tmuxOn("display-message", "-p", "-t", pane, "#{pane_title}"),
        options: {
          global: tmuxOn("show-options", "-g"), server: tmuxOn("show-options", "-s"), windowGlobal: tmuxOn("show-window-options", "-g"),
          session: tmuxOn("show-options", "-t", session), window: tmuxOn("show-window-options", "-t", pane), pane: tmuxOn("show-options", "-p", "-t", pane),
        },
      };
    },
    kill() { try { tmuxOn("kill-session", "-t", session); } catch { /* gone */ } },
  };
  t.after(term.kill); // a failed test leaves nothing for the next one
  if (!command) await term.prompt("when its shell has started");
  return term;
}

/** `oats tui`, the real CLI, typed at a terminal's prompt through a wrapper that writes its own pid
 *  and then becomes the CLI (so the pid is the TUI's, and the shell's job is the TUI). The shell
 *  records the exit status unless `record` is false. Resolves once the frame is on the screen. */
async function tui(term, look = {}, { record = true } = {}) {
  const n = ++started;
  const pidFile = join(base, `tui-${n}.pid`), statusFile = join(base, `tui-${n}.status`);
  await term.command(`sh -c ${shq(`echo $$ > ${shq(pidFile)}; exec ${TUI}`)}${record ? `; echo $? > ${shq(statusFile)}` : ""}`, "the oats tui command");
  const run = {
    statusFile,
    /** The exit status the pane's shell recorded; null while the command runs. */
    status() { const text = existsSync(statusFile) ? readFileSync(statusFile, "utf8") : ""; return /^\d+\n$/.test(text) ? Number(text) : null; },
    async ended(why) { await until(term, () => run.status() !== null, `oats tui in ${term.id} to end ${why}`); return run.status(); },
    /** The frame is on the screen and the program still runs. */
    async frame(why, at = look) {
      await untilScreen(term, (screen) => frameFaults(screen, at), `the frame ${why}`);
      assert.equal(run.status(), null, `oats tui still runs ${why}`);
    },
    async help(why) {
      await untilScreen(term, (screen) => helpFaults(screen, look), `the help ${why}`);
      assert.equal(run.status(), null, `oats tui still runs ${why}`);
    },
  };
  await run.frame("after the start");
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  assert.ok(Number.isInteger(pid) && pid > 1, `the wrapper wrote the pid (${pid})`);
  run.pid = pid;
  return run;
}
/** A shell's terminal: its own screen, with a cursor and autowrap. */
function assertShellModes(flags, why) {
  assert.deepEqual({ alternate_on: flags.alternate_on, cursor_flag: flags.cursor_flag, wrap_flag: flags.wrap_flag }, { alternate_on: "0", cursor_flag: "1", wrap_flag: "1" }, `${why}: the shell's own screen, with a cursor and autowrap`);
}
/** The modes the TUI switches on, and the ones it never touches (docs/tui.md). */
function assertRunningModes(term, why) {
  const { bracket_paste_flag: paste, insert_flag: _insert, origin_flag: _origin, ...flags } = term.flags();
  assert.deepEqual(flags, { alternate_on: "1", cursor_flag: "0", wrap_flag: "0", mouse_any_flag: "0", keypad_flag: "0", keypad_cursor_flag: "0" }, `${why}: the alternate screen, no cursor, no autowrap; no mouse, no keypad modes`);
  // The shell's readline switches bracketed paste off before it runs a command: on here, it is the TUI's.
  if (paste !== "") assert.equal(paste, "1", `${why}: bracketed paste is on`);
}

// ---- no terminal at all: plain children ---------------------------------------------------------
test("without a terminal on stdout `oats tui` prints the E_NO_TERMINAL line on stderr and exits 1 with no escape byte; --json is refused as one JSON envelope, --help prints the usage, and --dir and --server are refused", () => {
  // The worktree may live inside an agent's instance home: the children run in the fixture, with
  // its environment, and with no name that makes them an OATS instance.
  const env = REAL_TMUX ? { ...process.env } : fixtureEnv(base, { extra: { OATS_HOME_DIR: join(base, "oats-home") } });
  for (const key of Object.keys(env)) if (key !== "OATS_HOME_DIR" && /^(OATS_|PI_AGENT|TMUX)/.test(key)) delete env[key];
  const cli = (...args) => spawnSync(process.execPath, [CLI, "tui", ...args], { cwd: base, env: { ...env, TERM: "xterm-256color" }, encoding: "utf8", timeout: 20000, stdio: ["ignore", "pipe", "pipe"] });

  const none = cli();
  assert.deepEqual({ status: none.status, stdout: none.stdout, stderr: none.stderr }, { status: 1, stdout: "", stderr: `${NO_TERMINAL}\n` });

  const json = cli("--json");
  assert.equal(json.status, 1);
  assert.deepEqual(JSON.parse(json.stdout), { schemaVersion: 1, ok: false, error: { code: "E_BAD_ARGS", message: "oats tui is interactive and has no --json form; `oats status --json` is the machine view" } });
  assert.equal(json.stdout.trim().split("\n").length, 1, "one envelope, on one line");

  const help = cli("--help");
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /^Usage:\n/);
  assert.ok(help.stdout.includes("oats tui [--ascii]"), help.stdout);
  assert.equal(help.stderr, "");

  for (const flag of ["--dir", "--server"]) {
    const refused = cli(flag, "x");
    assert.equal(refused.status, 1, flag);
    assert.match(refused.stderr, /\(E_BAD_ARGS\)/, flag);
    assert.ok(refused.stderr.includes(flag), `${flag} is named: ${refused.stderr}`);
    assert.equal(refused.stdout, "", flag);
  }
  for (const r of [none, json, help]) assert.equal(/\x1b/.test(r.stdout + r.stderr), false, "no escape byte without a terminal");
});

// ---- on a terminal ------------------------------------------------------------------------------
const TMUX_VERSION = REAL_TMUX ? execFileSync(REAL_TMUX, ["-V"], { encoding: "utf8", timeout: 10000 }).trim() : "none";
test(`the tmux these tests run against: ${TMUX_VERSION}`, { skip: NO_TMUX }, async (t) => {
  const term = await terminal(t);
  t.diagnostic(`tmux -V: ${TMUX_VERSION}; pane modes it reports at a shell prompt: ${term.flagsLine()}`);
  assert.match(TMUX_VERSION, /^tmux /);
  assert.equal(term.size(), "80x24", "a detached session made with -x and -y has that size");
});

test("on a terminal of 80x24 the frame appears; ? shows the help, generated from the action table; Esc closes it; ? opens it and ? closes it; q exits with status 0 and the shell's screen is back", { skip: NO_TMUX }, async (t) => {
  const term = await terminal(t);
  const run = await tui(term);
  assert.deepEqual(term.screen(), [
    "oats                                                                     preview",
    VIEWS,
    "\u2500".repeat(80),
    ...Array(9).fill(""),
    "       This preview draws the frame only. Views arrive in later releases.",
    ...Array(9).fill(""),
    "\u2500".repeat(80),
    KEYS_ROW,
  ], "the frame, row for row");

  term.press("?");
  await run.help("after ?");
  term.press("Escape");
  await run.frame("after Esc closed the help");
  term.press("?");
  await run.help("after ? again");
  term.press("?");
  await run.frame("after ? closed the help");

  term.press("q");
  assert.equal(await run.ended("after q"), 0, term.shows());
  await term.prompt("after q");
  assert.equal(term.screen().includes(KEYS_ROW), false, `the frame is gone from the shell's screen:\n${term.shows()}`);
  assert.equal(alive(run.pid), false, "the process is gone");
});

for (const [how, status, leave] of [
  ["q", 0, (term) => term.press("q")],
  ["Ctrl+C, the byte 0x03 on a raw terminal", 0, (term) => term.press("C-c")],
  ["SIGINT", 130, (term, run) => process.kill(run.pid, "SIGINT")],
  ["SIGTERM", 143, (term, run) => process.kill(run.pid, "SIGTERM")],
  ["SIGQUIT", 131, (term, run) => process.kill(run.pid, "SIGQUIT")],
]) {
  test(`the terminal is intact after ${how}: status ${status}, and stty -g, the pane's modes and every tmux option are what they were before the start; while it ran, only the alternate screen, the cursor, autowrap and bracketed paste were changed`, { skip: NO_TMUX }, async (t) => {
    const term = await terminal(t);
    const before = await term.state("before the start");
    assertShellModes(before.flags, "before the start");
    const mine = everything();
    const run = await tui(term);
    assertRunningModes(term, `while it runs, before ${how}`);
    assert.deepEqual(everything(), mine, "the TUI made no session, window or pane");

    leave(term, run);
    assert.equal(await run.ended(`after ${how}`), status, term.shows());
    await until(term, () => !alive(run.pid), `the process ${run.pid} to be gone after ${how}`);
    const after = await term.state(`after ${how}`);
    assert.equal(after.stty, before.stty, `stty -g after ${how}`);
    assert.deepEqual(after.flags, before.flags, `the pane's modes after ${how}`);
    assertShellModes(after.flags, `after ${how}`);
    assert.deepEqual(after, before, `the terminal and the server after ${how}`);
    assert.equal(term.screen().includes(KEYS_ROW), false, `the shell's screen is back:\n${term.shows()}`);
  });
}

test("SIGHUP ends it with status 129 and SIGKILL ends it at once: either way the process is gone and the private server holds exactly the sessions, windows and panes the tests made", { skip: NO_TMUX }, async (t) => {
  for (const [signal, status] of [["SIGHUP", 129], ["SIGKILL", 137]]) {
    const term = await terminal(t);
    const mine = everything();
    const run = await tui(term);
    process.kill(run.pid, signal);
    assert.equal(await run.ended(`after ${signal}`), status, term.shows());
    await until(term, () => !alive(run.pid), `the process ${run.pid} to be gone after ${signal}`);
    assert.deepEqual(everything(), mine, `${signal}: nothing was added to the server, and nothing of the test's was taken`);
    // After SIGKILL nothing ran that could put the terminal back: it is left in the alternate
    // screen, which is expected and documented, and not asserted. The terminal goes with its session.
    t.diagnostic(`after ${signal} the pane reports ${term.flagsLine()}`);
    term.kill();
    assert.deepEqual(everything(), mine.filter((row) => !row.startsWith(`${term.id} `)), `${signal}: the test's terminal is removed`);
  }
});

test("Ctrl+Z suspends with the terminal handed back: the shell's prompt returns, the alternate screen is off, autowrap and the cursor are on and stty -g is what it was; fg draws the frame again; q then exits 0", { skip: NO_TMUX }, async (t) => {
  const term = await terminal(t);
  const before = await term.state("before the start");
  const run = await tui(term, {}, { record: false });
  assertRunningModes(term, "while it runs");

  term.press("C-z");
  await until(term, () => term.flags().alternate_on === "0" && term.atPrompt(), "the shell's prompt on its own screen after Ctrl+Z");
  await until(term, () => /^T/.test(execFileSync("ps", ["-o", "stat=", "-p", String(run.pid)], { encoding: "utf8", timeout: 10000 }).trim()), `the process ${run.pid} to be stopped`);
  assert.ok(term.joined().some((row) => /Stopped/.test(row)), `the shell reports a stopped job:\n${term.shows()}`);
  const stopped = await term.state("while it is stopped");
  assert.equal(stopped.stty, before.stty, "stty -g while stopped");
  assertShellModes(stopped.flags, "while stopped");
  assert.deepEqual(stopped.flags, before.flags, "the pane's modes while stopped");
  assert.deepEqual(stopped, before, "the terminal and the server while stopped");

  await term.command("fg", "fg");
  await run.frame("after fg");
  assertRunningModes(term, "after fg");
  term.press("?");
  await run.help("after fg: it reads keys again");
  term.press("Escape");
  await run.frame("after the help was closed");

  term.press("q");
  await term.command(`echo $? > ${shq(run.statusFile)}`, "the status of fg");
  assert.equal(await run.ended("after fg and q"), 0, term.shows());
  const after = await term.state("after q");
  assert.deepEqual(after, before, "the terminal and the server after a suspend, a return and q");
});

test("Ctrl+Z through a wrapper that does not exec: the wrapper stops with the TUI, the interactive shell's prompt returns with the alternate screen off, fg draws the frame again, and after q the wrapper goes on", { skip: NO_TMUX }, async (t) => {
  const term = await terminal(t);
  const before = await term.state("before the start");
  const statusFile = join(base, `${term.id}-wrapped.status`);
  await term.command(`sh -c ${shq(`${TUI}; echo after-the-tui`)}`, "oats tui under sh -c");
  await untilScreen(term, (screen) => frameFaults(screen), "the frame under a wrapper");
  assertRunningModes(term, "while it runs under a wrapper");

  term.press("C-z");
  await until(term, () => term.flags().alternate_on === "0" && term.atPrompt(), "the interactive shell's prompt on its own screen after Ctrl+Z under a wrapper");
  assert.ok(term.joined().some((row) => /Stopped/.test(row)), `the shell reports a stopped job:\n${term.shows()}`);
  assert.equal(term.screen().includes("after-the-tui"), false, "the wrapper stopped too: it has not gone on to its next command");
  const stopped = await term.state("while the wrapper is stopped");
  assertShellModes(stopped.flags, "while the wrapper is stopped");
  assert.deepEqual(stopped, before, "the terminal and the server while stopped");

  await term.command("fg", "fg");
  await untilScreen(term, (screen) => frameFaults(screen), "the frame after fg under a wrapper");
  assertRunningModes(term, "after fg under a wrapper");

  term.press("q");
  await until(term, () => term.screen().includes("after-the-tui") && term.atPrompt(), "the wrapper's next command to print after q");
  await term.command(`echo $? > ${shq(statusFile)}`, "the status of fg");
  await until(term, () => existsSync(statusFile) && /\n$/.test(readFileSync(statusFile, "utf8")), "the status of the wrapper");
  assert.equal(readFileSync(statusFile, "utf8"), "0\n");
  assert.deepEqual(await term.state("after q under a wrapper"), before, "the terminal and the server afterwards");
});

test("it follows the terminal's size: at 60x15 the frame still draws; below it, in either direction, one line gives the size found and the size needed; back at 80x24 the frame returns", { skip: NO_TMUX }, async (t) => {
  const term = await terminal(t);
  const run = await tui(term);
  // A detached session keeps the size it was made with, and resize-window sets window-size to
  // manual for that window itself: no server option is needed. tmux passes a pane's new size on
  // at most a few times a second, so every step here is a wait on the screen.
  const resize = (cols, rows) => { tmuxOn("resize-window", "-t", term.pane, "-x", String(cols), "-y", String(rows)); assert.equal(term.size(), `${cols}x${rows}`, "tmux resized the pane"); };
  const tooSmall = async (cols, rows) => {
    resize(cols, rows);
    const want = [tooSmallLine(cols, rows), ...Array(rows - 1).fill("")];
    await untilScreen(term, (screen) => (JSON.stringify(screen) === JSON.stringify(want) ? [] : [`the screen is not that one line and ${rows - 1} empty rows`]), `the one line of a terminal too small at ${cols}x${rows}, ${JSON.stringify(want[0])}`);
    assert.equal(run.status(), null, `oats tui still runs at ${cols}x${rows}`);
  };

  resize(60, 15);
  await run.frame("at 60x15, the smallest size it draws at", { cols: 60, rows: 15 });
  assert.equal(term.screen().at(-1), KEYS_ROW);
  await tooSmall(59, 15); // one column short
  await tooSmall(60, 14); // one row short
  await tooSmall(59, 14);
  resize(80, 24);
  await run.frame("back at 80x24");
  assertRunningModes(term, "after the resizes");

  term.press("q");
  assert.equal(await run.ended("after q"), 0, term.shows());
});

let refusals = 0;
for (const [what, set] of [["TERM=dumb", "env TERM=dumb"], ["an empty TERM", "env TERM="], ["no TERM", "env -u TERM"]]) {
  test(`with ${what} on a real terminal it refuses with the E_NO_TERMINAL line and status 1, and the terminal received no escape byte and changed no mode`, { skip: NO_TMUX }, async (t) => {
    // Nothing but the program writes to this pane: no shell prompt, no readline. The pane waits for
    // a line, so that the recording of what it receives starts before the program does, and for
    // another at its end: a dead pane kept by remain-on-exit reports its cursor as off.
    const n = ++refusals;
    const statusFile = join(base, `refusal-${n}.status`), record = join(base, `refusal-${n}.bytes`);
    const term = await terminal(t, { command: `read go; ${set} ${TUI}; echo $? > ${shq(statusFile)}; echo tui-ended; read stay` });
    tmuxOn("pipe-pane", "-o", "-t", term.pane, `cat > ${shq(record)}`);
    const before = term.flags();
    term.press("Enter");
    await until(term, () => existsSync(record) && readFileSync(record, "utf8").includes("tui-ended"), `everything the pane received with ${what}, to its end`);
    assert.equal(readFileSync(statusFile, "utf8"), "1\n", term.shows());
    const received = readFileSync(record);
    assert.equal(received.includes(0x1b), false, `no escape byte reached the terminal: ${JSON.stringify(received.toString("latin1"))}`);
    // The terminal's echo of the Enter, the program's one line, the pane's own last word.
    assert.equal(received.toString("utf8").replace(/\r/g, ""), `\n${NO_TERMINAL}\ntui-ended\n`);
    assert.ok(term.joined().includes(NO_TERMINAL), `the pane shows the line:\n${term.shows()}`);
    assert.deepEqual(term.flags(), before, "no mode of the terminal changed");
  });
}

test("a bracketed paste is dropped whole: a pasted q does not quit, nor does a longer paste with q and a newline in it; a typed q then quits with status 0", { skip: NO_TMUX }, async (t) => {
  const term = await terminal(t);
  const run = await tui(term);
  // -p pastes between the bracket codes only when the pane's program asked for them: it did.
  const paste = (text) => { tmuxOn("set-buffer", "-b", `${term.id}-paste`, text); tmuxOn("paste-buffer", "-d", "-p", "-b", `${term.id}-paste`, "-t", term.pane); };

  paste("q");
  term.press("?"); // input is read in order: once the help is open, the paste before it was read
  await run.help("after a pasted q, then ?");
  term.press("?");
  await run.frame("after the help was closed");

  paste("quit q\n?q\u0003");
  term.press("?");
  await run.help("after a longer paste, then ?");
  term.press("Escape");
  await run.frame("after the pastes");
  assertRunningModes(term, "after the pastes");

  term.press("q");
  assert.equal(await run.ended("after a typed q"), 0, term.shows());
});

test("Ctrl+L takes the terminal again: after the screen and the modes were reset from outside the program, the frame is complete, the modes are the TUI's again and a paste is still not keys", { skip: NO_TMUX }, async (t) => {
  const term = await terminal(t);
  const run = await tui(term);
  // `send-keys -R` resets the pane's terminal state inside tmux: the screen is cleared without the
  // program writing or knowing, so a program that only writes what changed would leave it empty.
  tmuxOn("send-keys", "-R", "-t", term.pane);
  assert.deepEqual(term.screen().filter(Boolean), [], `${TMUX_VERSION} wiped the pane's screen`);
  term.press("C-l");
  await run.frame("after Ctrl+L on a wiped screen");
  // tmux's reset also put the pane's modes back to a terminal's defaults (cursor shown, autowrap
  // on, bracketed paste off): Ctrl+L sets the TUI's own again, so a paste cannot act as keys.
  assertRunningModes(term, `after ${TMUX_VERSION}'s reset and Ctrl+L`);
  tmuxOn("set-buffer", "-b", `${term.id}-paste`, "q");
  tmuxOn("paste-buffer", "-d", "-p", "-b", `${term.id}-paste`, "-t", term.pane);
  term.press("C-l");
  term.press("?");
  await run.help("after another Ctrl+L, then ?");
  term.press("C-l");
  term.press("Escape");
  await run.frame("after Ctrl+L with the help open, then Esc");

  term.press("q");
  assert.equal(await run.ended("after q"), 0, term.shows());
});

test("in a locale that is not UTF-8 the frame's rules are ASCII, and the help and q work the same", { skip: NO_TMUX }, async (t) => {
  const term = await terminal(t, { locale: ASCII.locale });
  const run = await tui(term, { rule: ASCII.rule });
  const screen = term.screen();
  assert.equal(screen[2], "-".repeat(80));
  assert.equal(screen[22], "-".repeat(80));
  assert.equal(screen.some((row) => /[^\x20-\x7e]/.test(row)), false, `every character on the screen is printable ASCII:\n${term.shows()}`);
  term.press("?");
  await run.help("in an ASCII locale");
  term.press("Escape");
  await run.frame("after the help was closed");
  term.press("q");
  assert.equal(await run.ended("after q"), 0, term.shows());
});
