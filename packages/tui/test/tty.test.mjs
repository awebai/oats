import test from "node:test";
import assert from "node:assert/strict";
import { ENTER, LEAVE, LEND_END_GRACE_MS, SIGNAL_STATUS, TERMINAL_GONE_STATUS, createGuard, isTerminal } from "../lib/term/tty.mjs";
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

test("SIGCONT with no suspend of ours sets raw mode off and on again, writes the leave and the enter sequence in one write and redraws in full", () => {
  const { stdout, proc, seen, log } = setup();
  stdout.take();
  log.length = 0;
  proc.emit("SIGCONT", "SIGCONT");
  assert.deepEqual(log, [["raw", false], ["raw", true], ["write", LEAVE + ENTER]]);
  assert.equal(seen.redraws, 1);
});

test("reassert, which Ctrl+L asks for, takes the terminal again the same way; it does nothing while the terminal is handed over or after the end", () => {
  const { guard, stdout, seen, log } = setup();
  stdout.take();
  log.length = 0;
  guard.reassert();
  // Leave, then enter, in ONE write: a second entry to the alternate screen with no leave before
  // it may save the cursor again, over the position the shell's prompt returns to.
  assert.deepEqual(log, [["raw", false], ["raw", true], ["write", LEAVE + ENTER]]);
  assert.deepEqual(modesOf(LEAVE + ENTER), ["?2004l", "?7h", "?25h", "?1049l", "?1049h", "?25l", "?7l", "?2004h"]);
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

/** A guard whose owner started work that outlives a frame: the three callbacks, recorded in the
 *  same log as the terminal's acts, so their order is part of what is asserted. */
function owned({ onStop, onResume, onEnd } = {}) {
  const log = [];
  const stdin = fakeStdin({ log }), stdout = fakeStdout({ log }), proc = fakeProcess(), timers = fakeTimers();
  const kill = proc.kill;
  proc.kill = (pid, signal) => { log.push(["kill", pid, signal]); return kill(pid, signal); };
  const guard = createGuard({
    stdin, stdout, proc, setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    frame: () => "", onInput() {}, onResize() {}, onRedraw: () => { log.push(["redraw"]); },
    onStop: () => { log.push(["stop"]); onStop?.(); },
    onResume: (asked) => { log.push(["resume", asked]); onResume?.(asked); },
    onEnd: () => { log.push(["end"]); onEnd?.(); },
  });
  guard.start();
  log.length = 0;
  return { guard, stdin, stdout, proc, timers, log };
}

test("onEnd is called once on every way out, after the terminal is restored and before done resolves, and what it throws changes neither", async () => {
  for (const [name, leave, status] of [
    ["quit", ({ guard }) => guard.finish(0), 0],
    ["a signal", ({ proc }) => proc.emit("SIGTERM", "SIGTERM"), SIGNAL_STATUS.SIGTERM],
    ["a hangup", ({ proc }) => proc.emit("SIGHUP", "SIGHUP"), SIGNAL_STATUS.SIGHUP],
    ["an internal error", ({ proc }) => proc.emit("uncaughtException", new Error("broke")), 1],
    ["the terminal going away", ({ stdin }) => stdin.emit("end"), TERMINAL_GONE_STATUS],
  ]) {
    const g = owned();
    let resolved = false;
    g.guard.done.then(() => { resolved = true; });
    leave(g);
    assert.deepEqual(g.log, [["write", LEAVE], ["raw", false], ["end"]], name);
    assert.equal(resolved, false, "the promise had not resolved when onEnd ran");
    assert.equal((await g.guard.done).status, status, name);
    g.guard.finish(0);
    g.proc.emit("SIGTERM", "SIGTERM");
    assert.equal(g.log.filter(([what]) => what === "end").length, 1, `${name}: once`);
  }
  const thrower = owned({ onEnd() { throw new Error("the cleanup broke"); } });
  thrower.guard.finish(0);
  assert.deepEqual(await thrower.guard.done, { status: 0, error: undefined });
});

test("a process.exit nobody expected still restores the terminal and calls onEnd", () => {
  const g = owned();
  g.proc.emit("exit", 3);
  assert.deepEqual(g.log, [["write", LEAVE], ["raw", false], ["end"]]);
});

test("onStop is called at a suspend after the terminal is handed back and before the signal; onResume(true) on the return, before the redraw", () => {
  const g = owned();
  g.guard.suspend();
  assert.deepEqual(g.log, [["write", LEAVE], ["raw", false], ["stop"], ["kill", 0, "SIGTSTP"]]);
  g.log.length = 0;
  g.proc.emit("SIGCONT", "SIGCONT");
  assert.deepEqual(g.log, [["raw", true], ["write", ENTER], ["resume", true], ["redraw"]]);
  // The same when nothing stopped the process (SIGTSTP ignored): the grace timer brings it back.
  g.guard.suspend();
  g.log.length = 0;
  g.timers.fire();
  assert.deepEqual(g.log, [["raw", true], ["write", ENTER], ["resume", true], ["redraw"]]);
  g.guard.finish(0);
});

test("a SIGTSTP from outside is a suspend like the key's: onStop first, then the stop", () => {
  const g = owned();
  g.proc.emit("SIGTSTP", "SIGTSTP");
  assert.deepEqual(g.log, [["write", LEAVE], ["raw", false], ["stop"], ["kill", 0, "SIGTSTP"]]);
  g.guard.finish(0);
});

test("stopped and continued from outside with no suspend of its own: onResume(false), then the modes again and the redraw; onStop was never called", () => {
  const g = owned();
  g.proc.emit("SIGCONT", "SIGCONT");
  assert.deepEqual(g.log, [["resume", false], ["raw", false], ["raw", true], ["write", LEAVE + ENTER], ["redraw"]]);
  g.guard.finish(0);
});

test("what onStop throws ends the run as an internal error, and the process is not stopped; what onResume throws ends it too", async () => {
  const stop = owned({ onStop() { throw new Error("could not drop the reads"); } });
  stop.guard.suspend();
  const ended = await stop.guard.done;
  assert.equal(ended.status, 1);
  assert.match(ended.error.message, /could not drop the reads/);
  assert.equal(stop.log.some(([what]) => what === "kill"), false, "no SIGTSTP after a failed hand-over");
  assert.deepEqual(stop.log.filter(([what]) => what === "write"), [["write", LEAVE]], "the terminal was restored once");

  const back = owned({ onResume() { throw new Error("could not read again"); } });
  back.proc.emit("SIGCONT", "SIGCONT");
  assert.equal((await back.guard.done).status, 1);
  assert.equal(back.stdin.raw, false);
});

test("the three callbacks are optional: a guard without them suspends, returns and ends as before", async () => {
  const { guard, proc, log } = setup();
  log.length = 0;
  guard.suspend();
  proc.emit("SIGCONT", "SIGCONT");
  proc.emit("SIGCONT", "SIGCONT");
  guard.finish(0);
  assert.equal((await guard.done).status, 0);
  assert.deepEqual(proc.kills, [[0, "SIGTSTP"]]);
});

/** A lend over a borrower the test holds: `close(value)` and `fail(error)` end it, `ended` counts
 *  the guard's requests that it end. */
function borrower() {
  let close, fail;
  const b = { started: 0, ended: 0, released: 0 };
  b.run = () => { b.started++; return new Promise((resolve, reject) => { close = resolve; fail = reject; }); };
  b.end = () => { b.ended++; };
  b.release = () => { b.released++; };
  b.close = (value) => close(value);
  b.fail = (error) => fail(error);
  return b;
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("lend leaves, pauses input, runs, then enters, resumes input and redraws in full, in that order", async () => {
  const g = owned();
  const b = borrower();
  g.stdin.pause = () => { g.log.push(["pause"]); g.stdin.paused = true; return g.stdin; };
  g.stdin.resume = () => { g.log.push(["resume input"]); g.stdin.paused = false; return g.stdin; };
  const lent = g.guard.lend(() => { g.log.push(["run", g.stdin.raw, g.stdin.paused]); return b.run(); }, { end: b.end });
  assert.equal(g.guard.lent, true);
  assert.deepEqual(g.log, [["write", LEAVE], ["raw", false], ["pause"], ["run", false, true]], "the suspend's leave, no stop, and the borrower starts on a cooked terminal nobody else reads");
  b.close({ status: 20 });
  assert.deepEqual(await lent, { value: { status: 20 } });
  assert.deepEqual(g.log.slice(4), [["raw", true], ["write", ENTER], ["resume input"], ["redraw"]]);
  assert.equal(g.guard.lent, false);
  assert.equal(g.guard.entered, true);
  assert.deepEqual(g.proc.kills, [], "nothing was stopped");
  g.guard.finish(0);
});

test("nothing is written between the leave and the enter of a lend, whatever asks for a draw: a frame, a resize, a redraw, SIGCONT, Ctrl+L, input", async () => {
  const { guard, stdin, stdout, proc, seen } = setup({ frame: () => "FRAME" });
  const b = borrower();
  const lent = guard.lend(b.run, { end: b.end });
  stdout.take();
  guard.draw();
  guard.reassert();
  guard.suspend();
  stdout.resize(100, 30);
  stdin.type("x");
  proc.emit("SIGCONT", "SIGCONT");
  assert.equal(stdout.take(), "");
  assert.deepEqual(proc.kills, []);
  assert.deepEqual(seen.input, []);
  assert.equal(seen.resizes, 0);
  b.close({ status: 0 });
  await lent;
  assert.equal(stdout.take(), ENTER, "the enter is the first write after the lend; the redraw is the loop's to ask");
  assert.equal(seen.redraws, 1);
  guard.finish(0);
});

test("SIGQUIT while the terminal is lent does not end the run; after the return it ends the run as before, with 131", async () => {
  const g = owned();
  const b = borrower();
  const lent = g.guard.lend(b.run, { end: b.end });
  g.proc.emit("SIGQUIT", "SIGQUIT");
  g.proc.emit("SIGQUIT", "SIGQUIT");
  await settle();
  assert.equal(b.ended, 0, "the viewer handles its own QUIT");
  assert.equal(g.log.some(([what]) => what === "end"), false);
  b.close({ status: 20 });
  await lent;
  g.proc.emit("SIGQUIT", "SIGQUIT");
  assert.deepEqual(await g.guard.done, { status: SIGNAL_STATUS.SIGQUIT, error: undefined });
});

for (const [name, cause, status] of [
  ["SIGINT", ({ proc }) => proc.emit("SIGINT", "SIGINT"), SIGNAL_STATUS.SIGINT],
  ["SIGTERM", ({ proc }) => proc.emit("SIGTERM", "SIGTERM"), SIGNAL_STATUS.SIGTERM],
  ["SIGHUP", ({ proc }) => proc.emit("SIGHUP", "SIGHUP"), SIGNAL_STATUS.SIGHUP],
  ["an uncaught error", ({ proc }) => proc.emit("uncaughtException", new Error("broke")), 1],
  ["an error in one of the loop's own steps", ({ guard }) => guard.attempt(() => { throw new Error("broke"); }), 1],
  ["the terminal going away", ({ stdin }) => stdin.emit("end"), TERMINAL_GONE_STATUS],
]) {
  test(`${name} while the terminal is lent ends the borrower first, then the run once it has closed, with status ${status}, writing nothing more to the terminal`, async () => {
    const g = owned();
    const b = borrower();
    const lent = g.guard.lend(b.run, { end: b.end });
    g.log.length = 0;
    let resolved = false;
    g.guard.done.then(() => { resolved = true; });
    cause(g);
    assert.equal(b.ended, 1, "the borrower is asked to end");
    await settle();
    assert.equal(resolved, false, "the run waits for the borrower to close");
    b.close({ status: 0 });
    await lent;
    const end = await g.guard.done;
    assert.equal(end.status, status);
    assert.deepEqual(g.log, [["end"]], "nothing written, no raw mode set: the terminal was restored at the lend");
    assert.equal(g.stdin.raw, false);
  });
}

test("a borrower that does not close after it was asked to end: the run ends LEND_END_GRACE_MS later, and a second signal does not wait; either way the borrower is let go first (release), so it holds the process no longer", async () => {
  const g = owned();
  const b = borrower();
  g.guard.lend(b.run, { end: b.end, release: b.release });
  g.proc.emit("SIGTERM", "SIGTERM");
  assert.deepEqual(g.timers.delays(), [LEND_END_GRACE_MS]);
  assert.deepEqual([b.ended, b.released], [1, 0], "asked to end, not yet let go");
  g.timers.fire();
  assert.equal((await g.guard.done).status, SIGNAL_STATUS.SIGTERM);
  assert.equal(b.released, 1);

  const h = owned();
  const c = borrower();
  h.guard.lend(c.run, { end: c.end, release: c.release });
  h.proc.emit("SIGHUP", "SIGHUP");
  h.proc.emit("SIGINT", "SIGINT");
  assert.equal((await h.guard.done).status, SIGNAL_STATUS.SIGINT);
  assert.equal(c.released, 1, "let go at the second signal");
  assert.equal(h.timers.count, 0, "the grace timer was cleared");
  c.close({ status: 0 }); // closing late changes nothing
  await settle();
  assert.deepEqual(h.log.filter(([what]) => what === "end"), [["end"]]);
});

test("a run that throws or rejects: the terminal is taken back and the run goes on, answered as an error", async () => {
  const g = owned();
  const boom = new Error("could not start");
  const thrown = await g.guard.lend(() => { throw boom; });
  assert.deepEqual(thrown, { error: boom });
  assert.equal(g.guard.entered, true);
  assert.equal(g.stdin.paused, false);
  const b = borrower();
  const rejected = g.guard.lend(b.run);
  b.fail(boom);
  assert.deepEqual(await rejected, { error: boom });
  assert.equal(g.guard.entered, true);
  assert.equal(g.log.filter(([what]) => what === "redraw").length, 2);
  g.guard.finish(0);
  assert.equal((await g.guard.done).status, 0);
});

test("SIGTSTP is not heard while lent, so its default action stops the group; after the return Ctrl+Z suspends as before", async () => {
  const g = owned();
  assert.equal(g.proc.listenerCount("SIGTSTP"), 1);
  const b = borrower();
  const lent = g.guard.lend(b.run, { end: b.end });
  assert.equal(g.proc.listenerCount("SIGTSTP"), 0, "no listener: the default action applies");
  b.close({ status: 20 });
  await lent;
  assert.equal(g.proc.listenerCount("SIGTSTP"), 1);
  g.log.length = 0;
  g.proc.emit("SIGTSTP", "SIGTSTP");
  assert.deepEqual(g.log, [["write", LEAVE], ["raw", false], ["stop"], ["kill", 0, "SIGTSTP"]]);
  g.proc.emit("SIGCONT", "SIGCONT");
  // A lend whose borrower failed puts it back too, and so does a run that ends while lent.
  const failed = g.guard.lend(() => { throw new Error("no"); });
  await failed;
  assert.equal(g.proc.listenerCount("SIGTSTP"), 1);
  const c = borrower();
  g.guard.lend(c.run, { end: c.end });
  g.proc.emit("SIGTERM", "SIGTERM");
  c.close({ status: 0 });
  await g.guard.done;
  assert.equal(g.proc.listenerCount("SIGTSTP"), 0, "after the end nothing is left listening");
});

test("a lend asked for when the terminal is not the TUI's (lent, suspended, over) runs nothing", async () => {
  const g = owned();
  const b = borrower();
  g.guard.lend(b.run, { end: b.end });
  assert.ok((await g.guard.lend(b.run)).error);
  assert.equal(b.started, 1);
  b.close({ status: 20 });
  await settle();
  g.guard.suspend();
  assert.ok((await g.guard.lend(b.run)).error);
  g.proc.emit("SIGCONT", "SIGCONT");
  g.guard.finish(0);
  assert.ok((await g.guard.lend(b.run)).error);
  assert.equal(b.started, 1);
});
