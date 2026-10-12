process.env.TZ = "UTC";
import test from "node:test";
import assert from "node:assert/strict";
import { ACTIONS, bindings, keyLabel } from "../lib/actions.mjs";
import { INSTANCE_VARIABLES } from "../lib/client.mjs";
import { effectiveConfig } from "../lib/config.mjs";
import { NO_TERMINAL, USAGE, main, noDeployment, noKernel, parseArgs } from "../lib/main.mjs";
import { ENTER, LEAVE } from "../lib/term/tty.mjs";
import { CLI, DEPLOYMENT, failed, fakeProcess, fakeStdin, fakeStdout, fakeTimers, instanceRow, modesOf, observed, readTerminalOutput } from "./helpers.mjs";

/** The reader of a run, faked: what the loop asked of it, in order, and a way to answer. */
function fakeReader(log, options) {
  let number = 0;
  const did = (what, ...more) => { log.push(["reader", what, ...more]); };
  return {
    options, calls: [],
    start() { did("start"); return Promise.resolve(); },
    request(how) { did("request", how); return Promise.resolve(); },
    touch() { did("touch"); },
    voidInFlight() { did("void"); },
    stop() { did("stop"); },
    children: () => [],
    /** An answer of a cycle, as lib/read.mjs gives it. */
    answer(entry) { options.onEntry({ entry, number: ++number }); },
  };
}
/** `oats tui` on a fake terminal: the run, its streams and what it wrote. Everything outside the
 *  terminal (the user's file, the deployment, the kernel, the reader) is the test's own. */
function run({ argv = [], env = { TERM: "xterm-256color", LANG: "en_US.UTF-8" }, columns = 80, rows = 24, stdinTTY = true, stdoutTTY = true, config = { ok: true, actions: ACTIONS, ascii: false }, deployment = { ok: true, deployment: DEPLOYMENT }, kernel = { ok: true, cli: CLI }, cwd = "/work/here" } = {}) {
  const log = [];
  const stdin = fakeStdin({ log, isTTY: stdinTTY }), stdout = fakeStdout({ log, columns, rows, isTTY: stdoutTTY }), proc = fakeProcess(), timers = fakeTimers();
  const kill = proc.kill;
  proc.kill = (pid, signal) => { log.push(["kill", pid, signal]); return kill(pid, signal); };
  const errors = [];
  const stderr = { write(text) { errors.push(text); log.push(["stderr", text]); return true; } };
  let clock = Date.parse("2026-10-11T10:00:30.000Z");
  const r = { stdin, stdout, proc, timers, errors, log, reader: null, tick(ms) { clock += ms; } };
  let up;
  r.up = new Promise((resolve) => { up = resolve; });
  const effects = {
    loadConfig(asked) { log.push(["effect", "config", { ...asked.env }]); return config; },
    findDeployment(start) { log.push(["effect", "deployment", start]); return deployment; },
    async probeKernel(asked) { log.push(["effect", "kernel", { ...asked.env }]); return kernel; },
    createReader(options) { r.reader = fakeReader(log, options); const start = r.reader.start; r.reader.start = () => { const answer = start(); queueMicrotask(up); return answer; }; return r.reader; },
  };
  r.status = main({ argv, stdin, stdout, stderr, env, proc, now: () => clock, setTimer: timers.setTimer, clearTimer: timers.clearTimer, cwd: () => cwd, home: "/home/u", effects });
  r.status.then(up);
  return r;
}
/** A run that has taken its terminal and drawn its first frame. */
async function started(options) { const r = run(options); await r.up; return r; }
/** The text a run has on screen after its writes, read naively: enough to find a word. */
const textOf = (output) => readTerminalOutput(output).text;
const readerDid = (r) => r.log.filter(([what]) => what === "reader").map(([, ...rest]) => rest);
const ENTRY = observed([instanceRow("oats-expert", "oats-expert-tui"), instanceRow("oats-maintainer", "oats-maintainer-lfx", { running: false, runtimeState: "stopped" })]);

test("the action table binds each key to one action, and a key bound twice is refused when the table is read", () => {
  assert.deepEqual(Object.fromEntries(bindings(ACTIONS)), {
    up: "up", k: "up", down: "down", j: "down", g: "top", home: "top", G: "bottom", end: "bottom", pageup: "page-up", pagedown: "page-down",
    left: "collapse", h: "collapse", right: "expand", l: "expand", tab: "detail", "/": "filter", r: "refresh", 1: "instances",
    "?": "help", escape: "close", q: "quit", "ctrl+c": "quit", "ctrl+z": "suspend", "ctrl+l": "redraw",
  });
  assert.throws(() => bindings([{ id: "a", keys: ["x"], label: "a" }, { id: "b", keys: ["x"], label: "b" }]), /key x is bound to a and to b/);
  assert.equal(Object.isFrozen(ACTIONS) && ACTIONS.every((a) => Object.isFrozen(a) && Object.isFrozen(a.keys)), true);
  assert.deepEqual(["?", "q", "escape", "ctrl+c", "shift+tab", "f5", "ctrl+alt+up", "space", "alt+x"].map(keyLabel), ["?", "q", "Esc", "Ctrl+C", "Shift+Tab", "F5", "Ctrl+Alt+Up", "Space", "Alt+X"]);
  // Enter opens an agent in a later version and the capitals are that version's acts: neither is bound, but for G.
  assert.equal(bindings(ACTIONS).has("enter"), false);
  assert.deepEqual([...bindings(ACTIONS).keys()].filter((key) => /^[A-Z]$/.test(key)), ["G"]);
});

test("the arguments are --ascii, --help and --dir with a path, in both spellings; anything else is refused with E_BAD_ARGS and the usage, --server included", () => {
  assert.deepEqual(parseArgs([]), { options: { ascii: false, help: false, dir: null } });
  assert.deepEqual(parseArgs(["--ascii"]).options, { ascii: true, help: false, dir: null });
  assert.equal(parseArgs(["-h"]).options.help, true);
  assert.deepEqual(parseArgs(["--ascii", "--help"]).options, { ascii: true, help: true, dir: null });
  assert.equal(parseArgs(["--dir", "/srv/deploy"]).options.dir, "/srv/deploy");
  assert.equal(parseArgs(["--dir=/srv/deploy", "--ascii"]).options.dir, "/srv/deploy");
  assert.equal(parseArgs(["--dir", "--ascii"]).options.dir, "--ascii", "what follows --dir is its path, whatever it looks like");
  assert.equal(parseArgs(["--dir=a=b"]).options.dir, "a=b");
  for (const argv of [["--dir"], ["--dir="], ["--ascii", "--dir"], ["--dir", ""]]) assert.equal(parseArgs(argv).error, `oats: \`oats tui --dir\` takes a path (E_BAD_ARGS); usage: ${USAGE}`, argv.join(" "));
  for (const argv of [["--server", "build"], ["--json"], ["instances"], ["--ascii", "--no"], ["--ascii=1"], ["--directory", "/x"]]) {
    const { error, options } = parseArgs(argv);
    assert.equal(options, undefined);
    assert.equal(error, `oats: \`oats tui\` takes no argument ${argv.find((a) => a !== "--ascii")} (E_BAD_ARGS); usage: ${USAGE}`);
  }
  const hostile = parseArgs(["\x1b[2J\x1b]0;owned\x07"]).error;
  assert.doesNotMatch(hostile, /[\x00-\x1f\x7f]/, "an argument is never echoed raw: this line goes to a terminal");
  assert.match(hostile, /E_BAD_ARGS/);
  assert.equal(USAGE, "oats tui [--dir <path>] [--ascii]");
});

test("without a terminal on stdin and stdout, or with TERM unset, empty or dumb, it exits 1 with one line on stderr, draws nothing and reads nothing", async () => {
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
    assert.deepEqual(r.log.filter(([what]) => what === "effect"), [], "the user's file, the deployment and the kernel are not looked at");
  }
  assert.equal(NO_TERMINAL, "oats: `oats tui` needs a terminal on stdin and stdout (E_NO_TERMINAL); `oats status` prints the instances once");
});

test("--help prints the usage and exits 0 with no terminal; a bad argument exits 1 before the terminal is looked at", async () => {
  const help = run({ argv: ["--help"], stdinTTY: false, stdoutTTY: false });
  assert.equal(await help.status, 0);
  assert.equal(help.stdout.written.join("").startsWith(`Usage:\n  ${USAGE}\n`), true);
  assert.match(help.stdout.written.join(""), /--dir <path>.*--ascii/s);
  assert.deepEqual(help.errors, []);
  const bad = run({ argv: ["--server", "build"] });
  assert.equal(await bad.status, 1);
  assert.deepEqual(bad.errors, [`oats: \`oats tui\` takes no argument --server (E_BAD_ARGS); usage: ${USAGE}\n`]);
  assert.deepEqual(bad.stdout.written, []);
});

test("the eight instance variables are removed from the process environment itself before anything is read or started, so the user's file, the kernel and every child see none", async () => {
  const env = { TERM: "xterm-256color", LANG: "en_US.UTF-8", KEEP: "this", ...Object.fromEntries(INSTANCE_VARIABLES.map((name) => [name, `/an/agent/${name}`])) };
  assert.equal(INSTANCE_VARIABLES.length, 8);
  const r = await started({ env });
  for (const name of INSTANCE_VARIABLES) assert.equal(name in env, false, name);
  assert.equal(env.KEEP, "this");
  for (const [, , seen] of r.log.filter(([what, which]) => what === "effect" && which !== "deployment")) assert.deepEqual(Object.keys(seen).filter((name) => INSTANCE_VARIABLES.includes(name)), []);
  assert.equal(r.reader.options.env, env, "the reader is given that same environment, the one its children inherit");
  r.stdin.type("q");
  assert.equal(await r.status, 0);
  // Also when the run then stops for want of a terminal: the removal comes before that check.
  const none = { ...Object.fromEntries(INSTANCE_VARIABLES.map((name) => [name, "x"])) };
  await run({ env: none }).status;
  assert.deepEqual(Object.keys(none), []);
});

test("before the alternate screen, in this order and each a line on stderr with status 1: the user's file, the deployment, the kernel", async () => {
  const lines = ["oats: `oats tui` cannot use /home/u/.config/oats/tui.json: quit has no key; give it one (E_TUI_CONFIG)", "oats: `oats tui` cannot use /home/u/.config/oats/tui.json: unknown action reload; the actions are up (E_TUI_CONFIG)"];
  const cases = [
    [{ config: { ok: false, lines } }, lines.map((line) => `${line}\n`).join(""), ["config"]],
    [{ deployment: { ok: false, dir: "/work/here" } }, `${noDeployment("/work/here")}\n`, ["config", "deployment"]],
    [{ kernel: { ok: false, reason: "version 0.24.0 outside >=0.25.8 <0.53.0" } }, `${noKernel("version 0.24.0 outside >=0.25.8 <0.53.0")}\n`, ["config", "deployment", "kernel"]],
  ];
  for (const [options, said, asked] of cases) {
    const r = run(options);
    assert.equal(await r.status, 1);
    assert.equal(r.errors.join(""), said);
    assert.deepEqual(r.log.filter(([what]) => what === "effect").map(([, which]) => which), asked);
    assert.deepEqual(r.stdout.written, [], "nothing is drawn");
    assert.equal(r.stdin.raw, false);
    assert.equal(r.reader, null, "and nothing is read");
    assert.deepEqual(r.proc.eventNames(), []);
  }
  assert.equal(noDeployment("/work/here"), "oats: no OATS deployment at or above /work/here (E_NO_DEPLOYMENT); name one with `oats tui --dir <path>`");
  assert.equal(noKernel("version 0.24.0 outside >=0.25.8 <0.53.0"), "oats: `oats tui` could not use its own kernel (E_TUI_KERNEL): version 0.24.0 outside >=0.25.8 <0.53.0");
});

test("a path or a reason in those lines is never written raw: a path that is not plain reads `that directory`, and a reason goes through the display filter", () => {
  for (const dir of ["/tmp/\x1b[2J", "/tmp/café", `/${"d".repeat(200)}`, "", null]) {
    assert.equal(noDeployment(dir), "oats: no OATS deployment at or above that directory (E_NO_DEPLOYMENT); name one with `oats tui --dir <path>`", JSON.stringify(dir));
  }
  assert.equal(noDeployment("/srv/my deployments/one").includes("/srv/my deployments/one"), true, "a space is plain");
  assert.doesNotMatch(noKernel("not the oats CLI (name: \x1b]0;owned\x07)"), /[\x00-\x1f\x7f-\x9f]/);
  assert.match(noKernel("not the oats CLI (name: \x1b]0;owned\x07)"), /\(E_TUI_KERNEL\): \[Detail withheld\]$/);
  assert.match(noKernel("two\nlines"), /: two lines$/);
  assert.match(noKernel(""), /: it gave no reason$/);
});

test("the deployment is looked for from --dir, a relative one from where the user is, else from where the user is", async () => {
  for (const [argv, from] of [[[], "/work/here"], [["--dir", "/srv/deploy/agents"], "/srv/deploy/agents"], [["--dir=../there"], "/work/there"], [["--dir", "."], "/work/here"]]) {
    const r = run({ argv, deployment: { ok: false, dir: from } });
    await r.status;
    assert.deepEqual(r.log.find(([what, which]) => what === "effect" && which === "deployment"), ["effect", "deployment", from], argv.join(" "));
  }
});

test("a run says it is reading, draws the instances when the reader answers, opens and closes the help, and q quits with status 0, the terminal restored and the reader stopped before the run is over", async () => {
  const r = await started();
  assert.deepEqual([r.reader.options.deployment, r.reader.options.cli], [DEPLOYMENT, CLI], "the reader reads the deployment that was found, with the kernel that was accepted");
  assert.equal(r.reader.options.getEntry().deployment.status, "pending", "and is told the entry the store holds");
  assert.match(textOf(r.stdout.take()), /oats.*1 Instances.*2 Souls.*3 Capabilities.*Reading the deployment\..*\? help.*q quit/s);
  r.reader.answer(ENTRY);
  assert.match(textOf(r.stdout.take()), /lfx-workspace.*1 running.*1 stopped.*oats-expert-tui.*claude.*oats-maintainer-lfx.*stopped/s);
  assert.equal(r.reader.options.getEntry(), ENTRY);
  r.stdin.type("?");
  assert.match(textOf(r.stdout.take()), /Keys.*Ctrl\+Z.*suspend.*more below/s);
  r.stdin.type("G");
  assert.match(textOf(r.stdout.take()), /Not in this version.*oats session attach --home <home>.*closes this help/s, "the movement keys scroll the help to its end");
  r.stdin.type("?");
  assert.match(textOf(r.stdout.take()), /oats-expert-tui/);
  r.log.length = 0;
  r.stdin.type("q");
  assert.equal(await r.status, 0);
  assert.equal(r.stdout.take(), LEAVE);
  assert.equal(r.stdin.raw, false);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.log.filter(([what, which]) => (what === "write" || which === "stop")).map(([what, which]) => (what === "write" ? "leave" : which)), ["leave", "stop"], "the terminal first, then the reads");
  r.reader.answer(ENTRY);
  assert.equal(r.stdout.take(), "", "an answer that arrives after the end draws nothing");
});

test("every key press tells the reader the user is there; r asks for a live read, at once", async () => {
  const r = await started();
  r.log.length = 0;
  r.stdin.type("j");
  r.stdin.type("r");
  assert.deepEqual(readerDid(r), [["touch"], ["touch"], ["request", { live: true }]]);
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("the modes a whole run switches are exactly the list: four on at the start, the same four off and on again at Ctrl+L, the four back at the end, and nothing else, with the view drawn, filtered and scrolled", async () => {
  const r = await started();
  r.reader.answer(ENTRY);
  r.stdin.type("?");
  r.stdout.resize(100, 30);
  r.stdout.resize(40, 10);
  r.stdin.type("\x0c"); // Ctrl+L
  r.stdin.type("?");
  r.stdin.type("j\t/");
  r.stdin.type("\x1b[200~pasted q\nand a second line\x1b[201~");
  r.stdin.type("\r");
  r.reader.answer(failed(ENTRY, { code: "E_NEW_CODE", message: "a refusal with \x1b[2J in it" }));
  r.stdin.type("\x03"); // Ctrl+C
  assert.equal(await r.status, 0);
  const output = r.stdout.written.join("");
  const on = ["?1049h", "?25l", "?7l", "?2004h"], off = ["?2004l", "?7h", "?25h", "?1049l"];
  assert.deepEqual(modesOf(output), [...on, ...off, ...on, ...off]);
  assert.deepEqual([...new Set(modesOf(output))].sort(), [...on, ...off].sort(), "the set of mode sequences is the list, and only it");
  const { sequences, foreign, text } = readTerminalOutput(output);
  assert.deepEqual(foreign, [], "no mouse or focus reporting, no keyboard protocol, no keypad mode, no title, no clipboard, no query");
  assert.deepEqual([...new Set(sequences.map((s) => s.kind))].sort(), ["erase", "mode", "position", "sgr"]);
  assert.doesNotMatch(text, /[\x00-\x1f\x7f-\x9f]/, "no bell, no other control byte");
  assert.equal(output.startsWith(ENTER) && output.endsWith(LEAVE), true);
});

test("Esc alone closes the help once nothing has followed it for 50 ms, and not before", async () => {
  const r = await started();
  r.stdin.type("?");
  r.stdout.take();
  r.stdin.type("\x1b");
  assert.equal(r.stdout.take(), "", "a lone ESC may be the start of a key");
  assert.deepEqual(r.timers.delays(), [50]);
  r.tick(50);
  r.timers.fire();
  assert.match(textOf(r.stdout.take()), /Reading the deployment\./);
  r.stdin.type("q");
  assert.equal(await r.status, 0);
  assert.equal(r.timers.count, 0, "no timer outlives the run");
});

test("a paste into the list is dropped whole: a pasted q, a pasted Ctrl+C and a pasted ? do nothing; into the filter field its first line is text", async () => {
  const r = await started();
  r.reader.answer(ENTRY);
  r.stdout.take();
  r.stdin.type("\x1b[200~q\x03?\x1a\x1b[201~");
  assert.equal(r.stdout.take(), "", "nothing changed, so nothing was written");
  assert.equal(r.log.some(([what]) => what === "kill"), false, "it was not suspended");
  r.stdin.type("/");
  r.stdout.take();
  r.stdin.type("\x1b[200~maintainer\nq\x1b[201~");
  const filtered = textOf(r.stdout.take());
  assert.match(filtered, /maintainer/);
  assert.doesNotMatch(filtered, /oats-expert-tui/, "the row that does not match is gone");
  r.stdin.type("q");
  assert.match(textOf(r.stdout.take()), /No instance matches the filter\./, "q is text in the field");
  r.stdin.type("\x03");
  assert.equal(await r.status, 0, "Ctrl+C still quits from the field");
});

test("a resize redraws in full; below 60x15 the screen is the too-small line, and back above it the view returns as it was", async () => {
  const r = await started();
  r.reader.answer(ENTRY);
  r.stdin.type("j");
  r.stdout.take();
  r.stdout.resize(60, 15);
  let out = r.stdout.take();
  assert.equal(out.startsWith("\x1b[0m\x1b[2J"), true, "a resize clears first");
  assert.match(textOf(out), /oats.*oats-maintainer-lfx.*\? help/s);
  r.stdout.resize(59, 14);
  out = r.stdout.take();
  assert.equal(textOf(out), "Terminal too small: 59x14, oats tui needs 60x15.");
  r.stdout.resize(80, 24);
  assert.match(textOf(r.stdout.take()), />.*oats-maintainer-lfx.*soul.*oats-maintainer/s, "the selection is where it was");
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("a resize while a frame is being written makes no second write until the first has drained, then one frame at the newest size", async () => {
  const r = await started();
  r.stdout.take();
  r.stdout.accepts = false;
  r.stdin.type("?");
  assert.equal(r.stdout.written.length, 1, "the help frame is being written");
  r.stdout.resize(100, 30);
  r.stdout.resize(59, 14);
  r.reader.answer(ENTRY);
  r.stdout.resize(120, 40);
  assert.equal(r.stdout.written.length, 1, "nothing is queued behind it, an answer of the reader included");
  r.stdout.take();
  r.stdout.accepts = true;
  r.stdout.emit("drain");
  assert.equal(r.stdout.written.length, 1, "one frame for three resizes and an answer");
  const out = r.stdout.take();
  assert.equal(out.startsWith("\x1b[0m\x1b[2J"), true);
  assert.match(out, /\x1b\[40;1H/, "drawn for the 40 rows the terminal has now");
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("Ctrl+L sets the terminal's modes again and redraws in full, and Ctrl+\\ does nothing", async () => {
  const r = await started();
  const first = r.stdout.take();
  assert.equal(first.startsWith(ENTER), true);
  r.stdin.type("\x1c");
  assert.equal(r.stdout.take(), "");
  r.log.length = 0;
  r.stdin.type("\x0c");
  assert.equal(r.stdout.take(), LEAVE + first, "the terminal left, then the same bytes as the start: the modes, then the frame cleared and drawn whole");
  assert.deepEqual(r.log.filter(([what]) => what === "raw"), [["raw", false], ["raw", true]], "raw mode is set again too");
  assert.deepEqual(readerDid(r), [["touch"]], "a redraw reads nothing and drops nothing");
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("the bytes Ctrl+L writes, in order: raw mode off and on, then the leave and the enter sequence in ONE write, then the frame; three in a row write that three times, and q then leaves once", async () => {
  const r = await started();
  const frame = r.stdout.take().replace(ENTER, "");
  assert.equal(frame.includes("\x1b[?"), false, "the frame itself switches no mode");
  r.log.length = 0;
  r.stdin.type("\x0c");
  // One write for the pair: a terminal never shows the shell's screen between the two halves, and
  // no other write of the program can land between them.
  const acts = r.log.filter(([what]) => what !== "reader");
  assert.deepEqual(acts.slice(0, 3), [["raw", false], ["raw", true], ["write", LEAVE + ENTER]]);
  assert.equal(acts.slice(3).every(([what]) => what === "write"), true);
  assert.equal(acts.slice(3).map(([, bytes]) => bytes).join(""), frame, "then the frame, cleared and drawn whole");
  assert.equal(r.stdout.take(), LEAVE + ENTER + frame);

  r.stdin.type("\x0c");
  r.stdin.type("\x0c");
  assert.equal(r.stdout.take(), (LEAVE + ENTER + frame).repeat(2));
  r.stdin.type("q");
  assert.equal(await r.status, 0);
  assert.equal(r.stdout.take(), LEAVE, "after any number of Ctrl+L the end is one leave: every entry was matched by a leave before it");
  assert.equal(r.stdin.raw, false);
});

test("Ctrl+Z hands the terminal back, drops the reads in flight and only then stops the process group; SIGCONT brings the frame back in full and reads at once", async () => {
  const r = await started();
  const first = r.stdout.take().replace(ENTER, "");
  r.log.length = 0;
  r.stdin.type("\x1a");
  assert.equal(r.stdout.take(), LEAVE);
  // A cycle in flight when the process stops is no evidence about the deployment: it is dropped
  // BEFORE the signal, while the process can still do it.
  assert.deepEqual(r.log.filter(([what]) => what !== "raw"), [["reader", "touch"], ["write", LEAVE], ["reader", "void"], ["kill", 0, "SIGTSTP"]]);
  assert.equal(r.stdin.raw, false);
  r.log.length = 0;
  r.proc.emit("SIGCONT", "SIGCONT");
  assert.equal(r.stdout.take(), ENTER + first);
  assert.equal(r.stdin.raw, true);
  assert.deepEqual(readerDid(r), [["request", { live: true }]], "the return reads at once, and has nothing more to drop");
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("stopped and continued from outside, which it could not prepare for: the reads in flight are dropped on the return, the modes are set again and it reads at once", async () => {
  const r = await started();
  const first = r.stdout.take().replace(ENTER, "");
  r.log.length = 0;
  r.proc.emit("SIGCONT", "SIGCONT");
  assert.deepEqual(readerDid(r), [["void"], ["request", { live: true }]]);
  assert.equal(r.stdout.take(), LEAVE + ENTER + first);
  r.stdin.type("q");
  assert.equal(await r.status, 0);
});

test("with --ascii, the user's file saying ascii, or a locale that is not UTF-8, the rules are hyphens and no byte outside ASCII is written", async () => {
  for (const options of [{ argv: ["--ascii"] }, { config: { ok: true, actions: ACTIONS, ascii: true } }, { env: { TERM: "xterm", LANG: "C" } }, { env: { TERM: "xterm", LC_ALL: "POSIX", LANG: "en_US.UTF-8" } }]) {
    const r = await started(options);
    r.reader.answer(ENTRY);
    r.stdin.type("?");
    r.stdin.type("q");
    assert.equal(await r.status, 0);
    const output = r.stdout.written.join("");
    assert.doesNotMatch(output, /[^\x00-\x7f]/, JSON.stringify(options.argv ?? options.env ?? "tui.json"));
    assert.match(textOf(output), /-{80}/);
    assert.match(textOf(output), /\+-{41}/, "the joint of the two panes is a plus");
  }
  const utf8 = await started();
  utf8.stdin.type("q");
  await utf8.status;
  assert.match(textOf(utf8.stdout.written.join("")), /─{80}/);
});

test("the keys are the effective table's: with the user's file giving quit to x, x quits and q does nothing, and the footer says so", async () => {
  const config = effectiveConfig({ keys: { quit: ["x"] } });
  const r = await started({ config: { ...config, path: "/home/u/.config/oats/tui.json" } });
  assert.match(textOf(r.stdout.take()), /x quit/);
  r.stdin.type("q");
  assert.equal(r.stdout.take(), "");
  r.stdin.type("x");
  assert.equal(await r.status, 0);
});

test("each signal ends the run with its status, the terminal restored and the reader stopped; the message of an uncaught error is printed after the alternate screen is left", async () => {
  for (const [signal, status] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129], ["SIGQUIT", 131]]) {
    const r = await started();
    r.stdout.take();
    r.log.length = 0;
    r.proc.emit(signal, signal);
    assert.equal(await r.status, status, signal);
    assert.equal(r.stdout.take(), LEAVE);
    assert.deepEqual(readerDid(r), [["stop"]], signal);
    assert.deepEqual(r.errors, []);
  }
  const r = await started();
  r.proc.emit("uncaughtException", new Error("the view broke"));
  assert.equal(await r.status, 1);
  const order = r.log.map(([what, bytes]) => (what === "write" && bytes === LEAVE ? "leave" : what === "reader" ? bytes : what)).filter((what) => ["leave", "stop", "stderr"].includes(what));
  assert.deepEqual(order, ["leave", "stop", "stderr"]);
  assert.match(r.errors.join(""), /^oats: `oats tui` stopped on an internal error; the terminal was restored\n {2}Error: the view broke\n/);
});

test("an error's text is never written raw: a control sequence in its message is withheld from the terminal", async () => {
  const r = await started();
  r.proc.emit("uncaughtException", new Error("name \x1b]0;owned\x07\x1b[2J"));
  assert.equal(await r.status, 1);
  assert.doesNotMatch(r.errors.join(""), /[\x00-\x09\x0b-\x1f\x7f-\x9f]/);
  const thrown = await started();
  thrown.proc.emit("unhandledRejection", "a string, not an error");
  assert.equal(await thrown.status, 1);
  assert.match(thrown.errors.join(""), /\n {2}a string, not an error\n$/);
});

test("a reader that throws when asked ends the run as an internal error, with the terminal restored", async () => {
  const r = await started();
  r.reader.request = () => { throw new Error("the reader broke"); };
  r.stdin.type("r");
  assert.equal(await r.status, 1);
  assert.match(r.errors.join(""), /stopped on an internal error.*the reader broke/s);
  assert.equal(r.stdin.raw, false);
});
