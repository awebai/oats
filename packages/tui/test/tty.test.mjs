import test from "node:test";
import assert from "node:assert/strict";
import { ENTER, LEAVE, SIGNAL_STATUS, TERMINAL_GONE_STATUS, createGuard, isTerminal } from "../lib/term/tty.mjs";
import { fakeProcess, fakeStdin, fakeStdout, fakeTimers, modesOf, readTerminalOutput } from "./helpers.mjs";

/** A guard on fake streams, with what it was told recorded. */
function setup({ frame = () => "", start = true } = {}) {
  const log = [];
  const stdin = fakeStdin({ log }), stdout = fakeStdout({ log }), proc = fakeProcess(), timers = fakeTimers();
  const seen = { input: [], resizes: 0, redraws: 0, frames: 0 };
  const guard = createGuard({
    stdin, stdout, proc, setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    frame() { seen.frames++; return frame(seen.frames); },
    onInput: (bytes) => seen.input.push(String(bytes)),
    onResize: () => { seen.resizes++; },
    onRedraw: () => { seen.redraws++; },
  });
  if (start) guard.start();
  return { guard, stdin, stdout, proc, timers, seen, log };
}
const listening = (proc) => proc.eventNames().filter((name) => proc.listenerCount(name) > 0).map(String).sort();

test("the terminal's changes are exactly: alternate screen, cursor hidden, autowrap off, bracketed paste on, and the reverse", () => {
  assert.equal(ENTER, "\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[?2004h");
  assert.equal(LEAVE, "\x1b[?2004l\x1b[?7h\x1b[0m\x1b[?25h\x1b[?1049l");
  assert.deepEqual(modesOf(ENTER), ["?1049h", "?25l", "?7l", "?2004h"]);
  assert.deepEqual(modesOf(LEAVE), ["?2004l", "?7h", "?25h", "?1049l"]);
  assert.deepEqual(readTerminalOutput(ENTER + LEAVE).foreign, []);
});

test("enter is raw mode first, then the modes in one write; leave is the modes back in one write, then raw mode off", () => {
  const { guard, stdin, log } = setup();
  assert.deepEqual(log, [["raw", true], ["write", ENTER]]);
  assert.equal(guard.entered, true);
  assert.equal(stdin.paused, false, "it reads its terminal");
  guard.leave();
  assert.deepEqual(log, [["raw", true], ["write", ENTER], ["write", LEAVE], ["raw", false]]);
  assert.equal(guard.entered, false);
});

test("leave called twice writes the sequences once; so do a quit and the exit handler after it", async () => {
  const { guard, proc, log } = setup();
  guard.leave();
  guard.leave();
  assert.equal(log.filter(([, bytes]) => bytes === LEAVE).length, 1);

  const second = setup();
  const exits = second.proc.listeners("exit");
  second.guard.finish(0);
  for (const listener of exits) listener(0); // the process's exit event, after the run is over
  second.proc.emit("exit", 0);
  assert.equal(second.log.filter(([, bytes]) => bytes === LEAVE).length, 1);
  assert.deepEqual(await second.guard.done, { status: 0, error: undefined });
  assert.deepEqual(listening(proc).includes("exit"), true, "the first guard, still running, still has its last resort");
});

test("a normal quit restores the terminal, stops reading and removes every listener but the two that swallow a dead terminal's errors", async () => {
  const { guard, stdin, stdout, proc, log } = setup();
  guard.finish(0);
  assert.deepEqual(await guard.done, { status: 0, error: undefined });
  assert.deepEqual(log.slice(-2), [["write", LEAVE], ["raw", false]]);
  assert.equal(stdin.paused, true);
  assert.deepEqual(listening(proc), []);
  assert.deepEqual(stdin.eventNames(), ["error"]);
  assert.deepEqual(stdout.eventNames(), ["error"]);
});

for (const [signal, status] of Object.entries({ SIGINT: 130, SIGTERM: 143, SIGHUP: 129, SIGQUIT: 131 })) {
  test(`${signal} restores the terminal and ends with status ${status}`, async () => {
    assert.equal(SIGNAL_STATUS[signal], status);
    const { guard, proc, log } = setup();
    proc.emit(signal, signal);
    assert.deepEqual(await guard.done, { status, error: undefined });
    assert.deepEqual(log.slice(-2), [["write", LEAVE], ["raw", false]]);
    assert.deepEqual(listening(proc), []);
    proc.emit(signal, signal); // a second one finds nobody, and nothing is written twice
    assert.equal(log.filter(([, bytes]) => bytes === LEAVE).length, 1);
  });
}

test("an uncaught error and an unhandled rejection restore the terminal and end with status 1 and the error", async () => {
  for (const event of ["uncaughtException", "unhandledRejection"]) {
    const { guard, proc, log } = setup();
    const boom = new Error("boom");
    proc.emit(event, boom);
    assert.deepEqual(await guard.done, { status: 1, error: boom }, event);
    assert.deepEqual(log.slice(-2), [["write", LEAVE], ["raw", false]]);
  }
});

test("an error thrown by one of the loop's own steps ends the run the same way: input, resize, redraw, a frame", async () => {
  const boom = new Error("boom");
  const fail = () => { throw boom; };
  const cases = {
    input: (s) => { s.guard.attempt(fail); },
    frame: (s) => { s.guard.attempt(() => s.guard.draw()); },
  };
  const first = setup();
  cases.input(first);
  assert.deepEqual(await first.guard.done, { status: 1, error: boom });
  const second = setup({ frame: fail });
  cases.frame(second);
  assert.deepEqual(await second.guard.done, { status: 1, error: boom });
  assert.deepEqual(second.log.slice(-2), [["write", LEAVE], ["raw", false]]);

  const log = [];
  const stdin = fakeStdin({ log }), stdout = fakeStdout({ log }), proc = fakeProcess();
  const guard = createGuard({ stdin, stdout, proc, frame: () => "", onInput: fail, onResize: fail, onRedraw: fail });
  guard.start();
  stdin.type("x");
  assert.deepEqual(await guard.done, { status: 1, error: boom });
  assert.deepEqual(log.slice(-2), [["write", LEAVE], ["raw", false]]);
});

test("SIGHUP with the terminal already gone: nothing throws, the status is 129, and a late error from the dead terminal is swallowed", async () => {
  const { guard, stdin, stdout, proc } = setup();
  stdin.gone = true;
  stdout.gone = true;
  assert.doesNotThrow(() => proc.emit("SIGHUP", "SIGHUP"));
  assert.deepEqual(await guard.done, { status: 129, error: undefined });
  // The failed write surfaces later, as an error event on the stream: it must find a listener.
  assert.doesNotThrow(() => stdout.emit("error", Object.assign(new Error("write EIO"), { code: "EIO" })));
  assert.doesNotThrow(() => stdin.emit("error", Object.assign(new Error("read EIO"), { code: "EIO" })));
  assert.doesNotThrow(() => guard.leave());
});

test("a terminal that goes away without a signal ends the run as SIGHUP does: stdin ends, stdin closes, either stream fails", async () => {
  assert.equal(TERMINAL_GONE_STATUS, 129);
  for (const gone of [(s) => s.stdin.emit("end"), (s) => s.stdin.emit("close"), (s) => s.stdin.emit("error", new Error("read EIO")), (s) => s.stdout.emit("error", new Error("write EIO"))]) {
    const s = setup();
    gone(s);
    assert.deepEqual(await s.guard.done, { status: 129, error: undefined });
    assert.equal(s.log.filter(([, bytes]) => bytes === LEAVE).length, 1);
  }
});

test("a signal that arrives during enter still leaves the terminal restored, and nothing more is switched on", async () => {
  const log = [];
  const stdin = fakeStdin({ log }), stdout = fakeStdout({ log }), proc = fakeProcess();
  const guard = createGuard({ stdin, stdout, proc, frame: () => "", onInput() {}, onResize() {}, onRedraw() {} });
  // The signal lands between the two steps of enter: raw mode is on, the modes are not.
  const setRawMode = stdin.setRawMode;
  stdin.setRawMode = (on) => { setRawMode(on); if (on) proc.emit("SIGTERM", "SIGTERM"); };
  guard.start();
  assert.deepEqual(await guard.done, { status: 143, error: undefined });
  assert.deepEqual(log, [["raw", true], ["raw", false]], "raw mode was undone, and no mode was ever written");
  assert.equal(stdin.raw, false);
  assert.equal(stdin.paused, true, "and it does not start reading a terminal it has given back");
});

test("an enter that fails is undone: raw mode that cannot be set ends the run with the error and writes nothing", async () => {
  const log = [];
  const stdin = fakeStdin({ log }), stdout = fakeStdout({ log }), proc = fakeProcess();
  stdin.gone = true;
  const guard = createGuard({ stdin, stdout, proc, frame: () => "", onInput() {}, onResize() {}, onRedraw() {} });
  guard.start();
  const end = await guard.done;
  assert.equal(end.status, 1);
  assert.equal(end.error.code, "EIO");
  assert.deepEqual(stdout.written, []);
});

test("suspend hands the terminal back with both modes restored, stops the whole process group, and SIGCONT sets them again and asks for a full redraw", () => {
  const { guard, stdout, proc, seen, log } = setup();
  assert.equal(proc.listenerCount("SIGTSTP"), 1);
  stdout.take();
  log.length = 0;
  guard.suspend();
  assert.deepEqual(log, [["write", LEAVE], ["raw", false]], "handing over is leave(), and nothing else");
  assert.deepEqual(modesOf(LEAVE).filter((m) => /^\?(2004|7)[hl]$/.test(m)), ["?2004l", "?7h"], "bracketed paste off and autowrap on while the shell has the terminal");
  assert.equal(proc.listenerCount("SIGTSTP"), 0, "the default action is restored, so the signal stops the process");
  assert.deepEqual(proc.kills, [[0, "SIGTSTP"]], "to the process group: what the terminal sends for Ctrl+Z in a cooked-mode program");
  assert.equal(guard.entered, false);

  log.length = 0;
  proc.emit("SIGCONT", "SIGCONT");
  assert.deepEqual(log, [["raw", true], ["write", ENTER]], "coming back is enter(), and nothing else");
  assert.deepEqual(modesOf(ENTER).filter((m) => /^\?(2004|7)[hl]$/.test(m)), ["?7l", "?2004h"]);
  assert.equal(proc.listenerCount("SIGTSTP"), 1);
  assert.equal(seen.redraws, 1);
  assert.equal(guard.entered, true);
});

test("SIGTSTP from outside suspends the same way as the key", () => {
  const { stdout, proc, log } = setup();
  stdout.take();
  log.length = 0;
  proc.emit("SIGTSTP", "SIGTSTP");
  assert.deepEqual(log, [["write", LEAVE], ["raw", false]]);
  assert.deepEqual(proc.kills, [[0, "SIGTSTP"]]);
});

test("a stop that does not take (SIGTSTP ignored, an orphaned group) brings the screen back by itself, once", () => {
  const { guard, proc, timers, seen, log } = setup();
  guard.suspend();
  assert.equal(timers.count, 1);
  log.length = 0;
  timers.fire();
  assert.deepEqual(log, [["raw", true], ["write", ENTER]]);
  assert.equal(seen.redraws, 1);
  proc.emit("SIGCONT", "SIGCONT"); // and the SIGCONT that never came would have done no more
  assert.equal(seen.redraws, 2, "a later SIGCONT is the one from outside: the modes are set again");
  assert.equal(timers.count, 0);
});

test("SIGCONT after a suspend cancels the waiting timer, and the timer firing after SIGCONT does nothing", () => {
  const { guard, proc, timers, seen, log } = setup();
  guard.suspend();
  proc.emit("SIGCONT", "SIGCONT");
  assert.equal(timers.count, 0);
  assert.equal(seen.redraws, 1);
  assert.equal(log.filter(([, bytes]) => bytes === ENTER).length, 2, "the start and the return");
});

test("SIGCONT with no suspend of ours sets raw mode off and on again, writes the modes again and redraws in full", () => {
  const { stdout, proc, seen, log } = setup();
  stdout.take();
  log.length = 0;
  proc.emit("SIGCONT", "SIGCONT");
  assert.deepEqual(log, [["raw", false], ["raw", true], ["write", ENTER]]);
  assert.equal(seen.redraws, 1);
});

test("reassert, which Ctrl+L asks for, takes the terminal again the same way; it does nothing while the terminal is handed over or after the end", () => {
  const { guard, stdout, seen, log } = setup();
  stdout.take();
  log.length = 0;
  guard.reassert();
  assert.deepEqual(log, [["raw", false], ["raw", true], ["write", ENTER]]);
  assert.equal(seen.redraws, 1);
  guard.suspend();
  log.length = 0;
  guard.reassert();
  assert.deepEqual(log, []);
  guard.finish(0);
  guard.reassert();
  assert.deepEqual(log, []);
  assert.equal(seen.redraws, 1);
});

test("a signal while suspended ends the run without writing to a terminal that is already restored", async () => {
  const { guard, proc, timers, log } = setup();
  guard.suspend();
  log.length = 0;
  proc.emit("SIGTERM", "SIGTERM");
  assert.deepEqual(await guard.done, { status: 143, error: undefined });
  assert.deepEqual(log, []);
  assert.equal(timers.count, 0);
  assert.deepEqual(listening(proc), []);
});

test("one write per frame; while a write has not drained no frame is made, and on drain only the newest is", () => {
  const { guard, stdout, seen } = setup({ frame: (n) => `frame ${n}` });
  stdout.take();
  guard.draw();
  assert.deepEqual(stdout.written, ["frame 1"]);
  stdout.accepts = false;
  guard.draw();
  assert.deepEqual(stdout.written, ["frame 1", "frame 2"], "the write was taken, and has not drained");
  guard.draw();
  guard.draw();
  guard.draw();
  assert.equal(seen.frames, 2, "nothing was rendered, so nothing is queued");
  stdout.accepts = true;
  stdout.emit("drain");
  assert.deepEqual(stdout.written, ["frame 1", "frame 2", "frame 3"], "one frame for the three asked: the newest");
  stdout.emit("drain");
  assert.equal(seen.frames, 3, "a drain with nothing asked makes no frame");
});

test("a frame with nothing to write writes nothing, and nothing is drawn while the terminal is handed over or after the end", () => {
  const { guard, stdout, seen } = setup({ frame: (n) => (n === 1 ? "" : "bytes") });
  stdout.take();
  guard.draw();
  assert.deepEqual(stdout.written, []);
  guard.suspend();
  stdout.take();
  guard.draw();
  assert.deepEqual(stdout.written, []);
  assert.equal(seen.frames, 1);
  guard.finish(0);
  guard.draw();
  assert.equal(seen.frames, 1);
});

test("input and resize reach the loop only while the terminal is ours", () => {
  const { guard, stdin, stdout, seen } = setup();
  stdin.type("q");
  stdout.resize(100, 30);
  assert.deepEqual(seen.input, ["q"]);
  assert.equal(seen.resizes, 1);
  assert.deepEqual(guard.size(), { cols: 100, rows: 30 });
  guard.suspend();
  stdin.type("x");
  stdout.resize(90, 20);
  assert.deepEqual(seen.input, ["q"]);
  assert.equal(seen.resizes, 1);
});

test("the size is the terminal's, and 80x24 when the terminal does not say", () => {
  const { guard, stdout } = setup();
  assert.deepEqual(guard.size(), { cols: 80, rows: 24 });
  Object.assign(stdout, { columns: undefined, rows: undefined });
  assert.deepEqual(guard.size(), { cols: 80, rows: 24 });
  Object.assign(stdout, { columns: 0, rows: 0 });
  assert.deepEqual(guard.size(), { cols: 80, rows: 24 });
});

test("a terminal is a tty on stdin and on stdout with a TERM that can be addressed", () => {
  const tty = { isTTY: true }, pipe = { isTTY: false }, file = {};
  assert.equal(isTerminal({ stdin: tty, stdout: tty, env: { TERM: "xterm-256color" } }), true);
  assert.equal(isTerminal({ stdin: pipe, stdout: tty, env: { TERM: "xterm" } }), false, "stdout is a tty and stdin is not");
  assert.equal(isTerminal({ stdin: tty, stdout: pipe, env: { TERM: "xterm" } }), false, "stdin is a tty and stdout is not");
  assert.equal(isTerminal({ stdin: file, stdout: file, env: { TERM: "xterm" } }), false);
  for (const env of [{}, { TERM: "" }, { TERM: "dumb" }]) assert.equal(isTerminal({ stdin: tty, stdout: tty, env }), false, JSON.stringify(env));
});
