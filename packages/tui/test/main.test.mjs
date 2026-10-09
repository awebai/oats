import test from "node:test";
import assert from "node:assert/strict";
import { ACTIONS, bindings, keyLabel } from "../lib/actions.mjs";
import { NO_TERMINAL, USAGE, initialState, main, parseArgs, reduce } from "../lib/main.mjs";
import { ENTER, LEAVE } from "../lib/term/tty.mjs";
import { fakeProcess, fakeStdin, fakeStdout, fakeTimers, modesOf, readTerminalOutput } from "./helpers.mjs";

/** `oats tui` on a fake terminal: the run, its streams and what it wrote. */
function run({ argv = [], env = { TERM: "xterm-256color", LANG: "en_US.UTF-8" }, columns = 80, rows = 24, stdinTTY = true, stdoutTTY = true } = {}) {
  const log = [];
  const stdin = fakeStdin({ log, isTTY: stdinTTY }), stdout = fakeStdout({ log, columns, rows, isTTY: stdoutTTY }), proc = fakeProcess(), timers = fakeTimers();
  const errors = [];
  const stderr = { write(text) { errors.push(text); log.push(["stderr", text]); return true; } };
  let clock = 1000;
  const status = main({ argv, stdin, stdout, stderr, env, proc, now: () => clock, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  return { status, stdin, stdout, proc, timers, errors, log, tick(ms) { clock += ms; } };
}
/** The text a run has on screen after its writes, read naively: enough to find a word. */
const textOf = (output) => readTerminalOutput(output).text;

test("the action table binds each key to one action, and a key bound twice is refused when the table is read", () => {
  assert.deepEqual(Object.fromEntries(bindings(ACTIONS)), { "?": "help", escape: "close", q: "quit", "ctrl+c": "quit", "ctrl+z": "suspend", "ctrl+l": "redraw" });
  assert.throws(() => bindings([{ id: "a", keys: ["x"], label: "a" }, { id: "b", keys: ["x"], label: "b" }]), /key x is bound to a and to b/);
  assert.equal(Object.isFrozen(ACTIONS) && ACTIONS.every((a) => Object.isFrozen(a) && Object.isFrozen(a.keys)), true);
  assert.deepEqual(["?", "q", "escape", "ctrl+c", "shift+tab", "f5", "ctrl+alt+up", "space", "alt+x"].map(keyLabel), ["?", "q", "Esc", "Ctrl+C", "Shift+Tab", "F5", "Ctrl+Alt+Up", "Space", "Alt+X"]);
});

test("reduce is pure: ? opens and closes the help, Esc closes it, and quit, suspend and redraw are effects for the loop", () => {
  const start = initialState();
  assert.deepEqual({ view: start.view, ascii: start.ascii }, { view: "frame", ascii: false });
  const opened = reduce(start, { key: "?" });
  assert.deepEqual([opened.state.view, opened.effect], ["help", null]);
  assert.equal(start.view, "frame", "the state given is not changed");
  assert.equal(reduce(opened.state, { key: "?" }).state.view, "frame");
  assert.equal(reduce(opened.state, { key: "escape" }).state.view, "frame");
  assert.equal(reduce(start, { key: "escape" }).state, start, "Esc with nothing open does nothing");
  for (const [key, effect] of [["q", "quit"], ["ctrl+c", "quit"], ["ctrl+z", "suspend"], ["ctrl+l", "redraw"]]) {
    for (const state of [start, opened.state]) assert.deepEqual(reduce(state, { key }), { state, effect }, key);
  }
});

test("reduce ignores a key the table does not bind, a paste, and Ctrl+\\", () => {
  const start = initialState();
  for (const event of [{ key: "x" }, { key: "enter" }, { key: "ctrl+\\" }, { key: null }, { paste: true }, {}]) assert.deepEqual(reduce(start, event), { state: start, effect: null });
});

test("reduce acts on the table it is given: another table's keys work and the default ones do not", () => {
  const actions = [{ id: "help", keys: ["f1"], label: "help" }, { id: "quit", keys: ["ctrl+q"], label: "quit" }];
  const start = initialState({ actions });
  assert.equal(reduce(start, { key: "f1" }).state.view, "help");
  assert.equal(reduce(start, { key: "ctrl+q" }).effect, "quit");
  assert.deepEqual(reduce(start, { key: "q" }), { state: start, effect: null });
  assert.deepEqual(reduce(start, { key: "?" }), { state: start, effect: null });
});

test("the arguments are --ascii and --help; anything else is refused with E_BAD_ARGS and the usage, --dir and --server included", () => {
  assert.deepEqual(parseArgs([]), { options: { ascii: false, help: false } });
  assert.deepEqual(parseArgs(["--ascii"]), { options: { ascii: true, help: false } });
  assert.deepEqual(parseArgs(["-h"]).options.help, true);
  assert.deepEqual(parseArgs(["--ascii", "--help"]).options, { ascii: true, help: true });
  for (const argv of [["--dir", "/x"], ["--server", "build"], ["--json"], ["instances"], ["--ascii", "--no"], ["--ascii=1"]]) {
    const { error, options } = parseArgs(argv);
    assert.equal(options, undefined);
    assert.equal(error, `oats: \`oats tui\` takes no argument ${argv.find((a) => a !== "--ascii")} (E_BAD_ARGS); usage: ${USAGE}`);
  }
  const hostile = parseArgs(["\x1b[2J\x1b]0;owned\x07"]).error;
  assert.doesNotMatch(hostile, /[\x00-\x1f\x7f]/, "an argument is never echoed raw: this line goes to a terminal");
  assert.match(hostile, /E_BAD_ARGS/);
});

test("without a terminal on stdin and stdout, or with TERM unset, empty or dumb, it exits 1 with one line on stderr and draws nothing", async () => {
  const cases = [
    { stdinTTY: false }, { stdoutTTY: false }, { stdinTTY: false, stdoutTTY: false },
    { env: { LANG: "en_US.UTF-8" } }, { env: { TERM: "" } }, { env: { TERM: "dumb" } },
  ];
  for (const options of cases) {
    const r = run(options);
    assert.equal(await r.status, 1, JSON.stringify(options));
    assert.deepEqual(r.errors, [`${NO_TERMINAL}\n`]);
    assert.deepEqual(r.stdout.written, [], "no byte, so no escape byte, on a stream that is not a terminal");
    assert.equal(r.stdin.raw, false);
    assert.deepEqual(r.proc.eventNames(), [], "and it listens for nothing");
  }
  assert.equal(NO_TERMINAL, "oats: `oats tui` needs a terminal on stdin and stdout (E_NO_TERMINAL); `oats status` prints the instances once");
});

test("--help prints the usage and exits 0 with no terminal; a bad argument exits 1 before the terminal is looked at", async () => {
  const help = run({ argv: ["--help"], stdinTTY: false, stdoutTTY: false });
  assert.equal(await help.status, 0);
  assert.match(help.stdout.written.join(""), new RegExp(`^Usage:\\n  ${USAGE.replace(/[[\]]/g, "\\$&")}\\n`));
  assert.deepEqual(help.errors, []);
  const bad = run({ argv: ["--dir", "/x"] });
  assert.equal(await bad.status, 1);
  assert.deepEqual(bad.errors, [`oats: \`oats tui\` takes no argument --dir (E_BAD_ARGS); usage: ${USAGE}\n`]);
  assert.deepEqual(bad.stdout.written, []);
});

test("a run draws the frame, opens and closes the help, and q quits with status 0 and the terminal restored", async () => {
  const r = run();
  assert.match(textOf(r.stdout.take()), /oats.*preview.*1 Instances.*This preview draws the frame only\..*\? help/s);
  r.stdin.type("?");
  assert.match(textOf(r.stdout.take()), /Keys.*Ctrl\+Z.*suspend.*Esc or \? closes this help/s);
  r.stdin.type("?");
  assert.match(textOf(r.stdout.take()), /This preview draws the frame only\./);
  r.stdin.type("q");
  assert.equal(await r.status, 0);
  assert.equal(r.stdout.take(), LEAVE);
  assert.equal(r.stdin.raw, false);
  assert.deepEqual(r.errors, []);
});

test("the modes a whole run switches are exactly the list: four on at the start and again at Ctrl+L, the same four back at the end, and nothing else", async () => {
  const r = run();
  r.stdin.type("?");
  r.stdout.resize(100, 30);
  r.stdout.resize(40, 10);
  r.stdin.type("\x0c"); // Ctrl+L
  r.stdin.type("\x1b[200~pasted q\x1b[201~");
  r.stdin.type("\x03"); // Ctrl+C
  assert.equal(await r.status, 0);
  const output = r.stdout.written.join("");
  const on = ["?1049h", "?25l", "?7l", "?2004h"], off = ["?2004l", "?7h", "?25h", "?1049l"];
  assert.deepEqual(modesOf(output), [...on, ...on, ...off]);
  assert.deepEqual([...new Set(modesOf(output))].sort(), [...on, ...off].sort(), "the set of mode sequences is the list, and only it");
  const { sequences, foreign, text } = readTerminalOutput(output);
  assert.deepEqual(foreign, [], "no mouse or focus reporting, no keyboard protocol, no keypad mode, no title, no clipboard, no query");
  assert.deepEqual([...new Set(sequences.map((s) => s.kind))].sort(), ["erase", "mode", "position", "sgr"]);
  assert.doesNotMatch(text, /[\x00-\x1f\x7f-\x9f]/, "no bell, no other control byte");
  assert.equal(output.startsWith(ENTER) && output.endsWith(LEAVE), true);
});

test("Esc alone closes the help once nothing has followed it for 50 ms, and not before", async () => {
  const r = run();
  r.stdin.type("?");
  r.stdout.take();
  r.stdin.type("\x1b");
  assert.equal(r.stdout.take(), "", "a lone ESC may be the start of a key");
  assert.deepEqual(r.timers.delays(), [50]);
  r.tick(50);
  r.timers.fire();
  assert.match(textOf(r.stdout.take()), /This preview draws the frame only\./);
  r.stdin.type("q");
  assert.equal(await r.status, 0);
  assert.equal(r.timers.count, 0, "no timer outlives the run");
});

test("a paste is dropped whole: a pasted q, a pasted Ctrl+C and a pasted ? do nothing", async () => {
  const r = run();
  r.stdout.take();
  r.stdin.type("\x1b[200~q\x03?\x1a\x1b[201~");
  assert.equal(r.stdout.take(), "", "nothing changed, so nothing was written");
  assert.deepEqual(r.proc.kills, [], "it was not suspended");
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("a resize redraws in full; below 60x15 the screen is the too-small line, and back above it the frame returns", async () => {
  const r = run();
  r.stdout.take();
  r.stdout.resize(60, 15);
  let out = r.stdout.take();
  assert.equal(out.startsWith("\x1b[0m\x1b[2J"), true, "a resize clears first");
  assert.match(textOf(out), /oats.*preview.*\? help/s);
  r.stdout.resize(59, 14);
  out = r.stdout.take();
  assert.equal(textOf(out), "Terminal too small: 59x14, oats tui needs 60x15.");
  r.stdout.resize(80, 24);
  assert.match(textOf(r.stdout.take()), /This preview draws the frame only\. Views arrive in later releases\./);
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("a resize while a frame is being written makes no second write until the first has drained, then one frame at the newest size", async () => {
  const r = run();
  r.stdout.take();
  r.stdout.accepts = false;
  r.stdin.type("?");
  assert.equal(r.stdout.written.length, 1, "the help frame is being written");
  r.stdout.resize(100, 30);
  r.stdout.resize(59, 14);
  r.stdout.resize(120, 40);
  assert.equal(r.stdout.written.length, 1, "nothing is queued behind it");
  r.stdout.take();
  r.stdout.accepts = true;
  r.stdout.emit("drain");
  assert.equal(r.stdout.written.length, 1, "one frame for three resizes");
  const out = r.stdout.take();
  assert.equal(out.startsWith("\x1b[0m\x1b[2J"), true);
  assert.match(out, /\x1b\[40;1H/, "drawn for the 40 rows the terminal has now");
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("Ctrl+L sets the terminal's modes again and redraws in full, and Ctrl+\\ does nothing", async () => {
  const r = run();
  const first = r.stdout.take();
  assert.equal(first.startsWith(ENTER), true);
  r.stdin.type("\x1c");
  assert.equal(r.stdout.take(), "");
  r.log.length = 0;
  r.stdin.type("\x0c");
  assert.equal(r.stdout.take(), first, "the same bytes as the start: the modes, then the frame cleared and drawn whole");
  assert.deepEqual(r.log.filter(([what]) => what === "raw"), [["raw", false], ["raw", true]], "raw mode is set again too");
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("Ctrl+Z hands the terminal back and stops the process group; SIGCONT brings the frame back in full", async () => {
  const r = run();
  const first = r.stdout.take().replace(ENTER, "");
  r.stdin.type("\x1a");
  assert.equal(r.stdout.take(), LEAVE);
  assert.deepEqual(r.proc.kills, [[0, "SIGTSTP"]]);
  assert.equal(r.stdin.raw, false);
  r.proc.emit("SIGCONT", "SIGCONT");
  assert.equal(r.stdout.take(), ENTER + first);
  assert.equal(r.stdin.raw, true);
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("with --ascii, or a locale that is not UTF-8, the rules are hyphens and no byte outside ASCII is written", async () => {
  for (const options of [{ argv: ["--ascii"] }, { env: { TERM: "xterm", LANG: "C" } }, { env: { TERM: "xterm", LC_ALL: "POSIX", LANG: "en_US.UTF-8" } }]) {
    const r = run(options);
    r.stdin.type("?");
    r.stdin.type("q");
    assert.equal(await r.status, 0);
    const output = r.stdout.written.join("");
    assert.doesNotMatch(output, /[^\x00-\x7f]/, JSON.stringify(options));
    assert.match(textOf(output), /-{80}/);
  }
  const utf8 = run();
  utf8.stdin.type("q");
  await utf8.status;
  assert.match(textOf(utf8.stdout.written.join("")), /─{80}/);
});

test("each signal ends the run with its status and the terminal restored; the message of an uncaught error is printed after the alternate screen is left", async () => {
  for (const [signal, status] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129], ["SIGQUIT", 131]]) {
    const r = run();
    r.stdout.take();
    r.proc.emit(signal, signal);
    assert.equal(await r.status, status, signal);
    assert.equal(r.stdout.take(), LEAVE);
    assert.deepEqual(r.errors, []);
  }
  const r = run();
  r.proc.emit("uncaughtException", new Error("the view broke"));
  assert.equal(await r.status, 1);
  const order = r.log.map(([what, bytes]) => (what === "write" && bytes === LEAVE ? "leave" : what)).filter((what) => what === "leave" || what === "stderr");
  assert.deepEqual(order, ["leave", "stderr"]);
  assert.match(r.errors.join(""), /^oats: `oats tui` stopped on an internal error; the terminal was restored\n {2}Error: the view broke\n/);
});

test("an error's text is never written raw: a control sequence in its message is withheld from the terminal", async () => {
  const r = run();
  r.proc.emit("uncaughtException", new Error("name \x1b]0;owned\x07\x1b[2J"));
  assert.equal(await r.status, 1);
  assert.doesNotMatch(r.errors.join(""), /[\x00-\x09\x0b-\x1f\x7f-\x9f]/);
  const thrown = run();
  thrown.proc.emit("unhandledRejection", "a string, not an error");
  assert.equal(await thrown.status, 1);
  assert.match(thrown.errors.join(""), /\n {2}a string, not an error\n$/);
});
