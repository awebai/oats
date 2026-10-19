// The guard: everything the TUI changes in the terminal, and the promise that it is put back.
// With term/screen.mjs it is the only module that writes an ESC byte to the terminal. docs/tui.md
// lists the changes for operators; ENTER and LEAVE below are that list, with the kitty keyboard
// protocol (PUSH, QUERY, POP), and nothing else is ever switched on: no mouse or focus reporting, no
// keypad or cursor-key mode, no title, no clipboard, no bell, and no query but the protocol's.
//
// Handing the terminal to someone else (the shell at a suspend) is leave() and enter(), and only
// that pair. An agent's terminal is never handed the terminal: the TUI draws it (lib/panel.mjs).

import { KEYBOARD_FLAGS } from "./kitty.mjs";

const mode = (number, on) => `\x1b[?${number}${on ? "h" : "l"}`;
/** After raw mode: the alternate screen, the cursor hidden, autowrap off, bracketed paste on.
 *  Autowrap is off so no row wraps where the terminal and width.mjs disagree about a character (a
 *  wrap on the last row would scroll the screen). Bracketed paste is on so pasted text arrives
 *  marked as a paste, not as keys. */
export const ENTER = mode(1049, true) + mode(25, false) + mode(7, false) + mode(2004, true);
/** The reverse, with the style reset; then raw mode off. */
export const LEAVE = mode(2004, false) + mode(7, true) + "\x1b[0m" + mode(25, true) + mode(1049, false);
/** The kitty keyboard protocol (term/kitty.mjs; docs/tui.md, "Chords"): pushed with the flags the TUI
 *  asks for, on the alternate screen (a terminal keeps one stack of flags per screen), and asked
 *  about; popped before the alternate screen is left, on every way out, at a suspend, and before any
 *  other program is given the terminal. A terminal that does not know it ignores all three. */
export const PUSH = `\x1b[>${KEYBOARD_FLAGS}u`;
export const QUERY = "\x1b[?u";
export const POP = "\x1b[<u";

/** 128 + the signal's number, as a shell reports a process the signal ended. */
export const SIGNAL_STATUS = Object.freeze({ SIGINT: 130, SIGTERM: 143, SIGHUP: 129, SIGQUIT: 131 });
/** The terminal went away with no signal (stdin ended, a write failed): as SIGHUP. */
export const TERMINAL_GONE_STATUS = SIGNAL_STATUS.SIGHUP;
/** How long a suspend waits for the stop before it concludes there was none. */
const STOP_GRACE_MS = 100;

/** A terminal on both ends that can be addressed: no escape byte is ever written to anything else. */
export function isTerminal({ stdin, stdout, env }) {
  return stdin.isTTY === true && stdout.isTTY === true && typeof env.TERM === "string" && env.TERM !== "" && env.TERM !== "dumb";
}

/** The guard of one run. `keyboard` true asks for the kitty keyboard protocol: PUSH and QUERY after
 *  ENTER; then `keyboardAnswered(true)` keeps it (it is pushed again after every LEAVE and ENTER),
 *  and `keyboardAnswered(false)` (an answer without flag 1, or none in time) pops it and never
 *  pushes it again. While pushed, every LEAVE is written after POP. `frame()` answers the bytes of
 *  the newest frame when it is time to write one; `onInput(bytes)`, `onResize()` and `onRedraw()` (the screen must be drawn in full: after a
 *  suspend, after SIGCONT) are the events. `done` resolves once, with `{ status, error }`, after the
 *  terminal is restored and every listener is removed.
 *  Three more, for whoever started work that outlives a frame (the reads of lib/read.mjs), each
 *  optional: `onStop()` is called when the process is about to be stopped by its own suspend, after
 *  the terminal is handed back and before the signal; `onResume(asked)` when it runs again, `asked`
 *  true after its own suspend and false when it was stopped and continued from outside; `onEnd()`
 *  once on every way out, after the terminal is restored and before `done` resolves. */
export function createGuard({ stdin, stdout, proc, frame, onInput, onResize, onRedraw, onStop = null, onResume = null, onEnd = null, keyboard = false, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let entered = false, raw = false, modes = false;
  /** The protocol: "asking" until the terminal answered, "on" once it did with flag 1, "off" without
   *  it; and whether it is pushed now. */
  let kb = keyboard ? "asking" : "off", pushed = false;
  /** What is written after ENTER: the protocol pushed, and asked about while no answer came. */
  const pushing = () => (kb === "off" ? "" : kb === "asking" ? PUSH + QUERY : PUSH);
  /** What is written before LEAVE: the protocol popped, when it is pushed. */
  const popping = () => { if (!pushed) return ""; pushed = false; return POP; };
  let suspended = false, stopTimer = null;
  let over = false, blocked = false, stale = false;
  let settle;
  const done = new Promise((resolve) => { settle = resolve; });
  const listeners = [];
  const on = (emitter, name, listener) => { emitter.on(name, listener); listeners.push([emitter, name, listener]); };
  /** A terminal that is gone cannot be restored, and saying so helps nobody. */
  const quietly = (act) => { try { act(); } catch { /* gone */ } };

  /** Raw mode, then the modes. Each step is recorded before it is taken, so leave() undoes exactly
   *  what was done, whenever it is called. */
  function enter() {
    if (over || entered) return;
    entered = true;
    raw = true;
    stdin.setRawMode(true);
    if (!entered) return; // left while entering: nothing more is switched on
    modes = true;
    const push = pushing();
    pushed = push !== "";
    stdout.write(ENTER + push);
  }
  /** Put the terminal back. Idempotent; never throws. */
  function leave() {
    if (!entered) return;
    entered = false;
    if (modes) { modes = false; const pop = popping(); quietly(() => stdout.write(pop + LEAVE)); }
    if (raw) { raw = false; quietly(() => stdin.setRawMode(false)); }
  }
  /** The terminal's answer to the protocol's query, or none in time (`false`): kept, or popped and
   *  never pushed again in this run. An answer after either is not taken. */
  function keyboardAnswered(on) {
    if (kb !== "asking" || over) return;
    kb = on ? "on" : "off";
    if (!on && entered) { const pop = popping(); if (pop) quietly(() => stdout.write(pop)); }
  }

  /** The end of the run, by any way out: restore, stop listening, report once. */
  function finish(status, error) {
    if (over) return;
    over = true;
    leave();
    // What it throws must not keep the run from ending, nor replace the status it ends with.
    if (onEnd) quietly(onEnd);
    if (stopTimer !== null) { clearTimer(stopTimer); stopTimer = null; }
    for (const [emitter, name, listener] of listeners) emitter.removeListener(name, listener);
    proc.removeListener("SIGTSTP", suspend);
    quietly(() => stdin.pause());
    settle({ status, error });
  }

  /** Run one of the loop's own steps. What it throws ends the run as an uncaught error would,
   *  without waiting for the process to say so. */
  function attempt(step) {
    try { step(); } catch (error) { out(1, error); }
  }

  /** One write per frame. While the last write has not drained nothing is queued: the newest frame
   *  is made when it has. */
  function draw() {
    if (!entered || over) return;
    if (blocked) { stale = true; return; }
    const bytes = frame();
    if (bytes && stdout.write(bytes) === false) blocked = true;
  }
  function drained() {
    blocked = false;
    if (stale) { stale = false; attempt(draw); }
  }

  /** Ctrl+Z, or SIGTSTP from outside: hand the terminal back, then stop as a cooked-mode program is
   *  stopped. In raw mode the terminal sends the byte, not the signal, so the TUI sends what the
   *  terminal would have: SIGTSTP to the whole foreground process group. A wrapper that did not
   *  exec (`sh -c`, `npx`) stops with it, and the shell sees a stopped job. */
  function suspend() {
    if (!entered || over) return;
    leave();
    if (onStop) { attempt(onStop); if (over) return; }
    suspended = true;
    proc.removeListener("SIGTSTP", suspend); // the default action stops the process
    quietly(() => proc.kill(0, "SIGTSTP"));
    // Stopped, this timer fires only once the process is continued. Not stopped (SIGTSTP ignored,
    // an orphaned process group), nothing would ever send SIGCONT: it brings the screen back.
    stopTimer = setTimer(resume, STOP_GRACE_MS);
  }
  function resume() {
    if (!suspended || over) return;
    suspended = false;
    if (stopTimer !== null) { clearTimer(stopTimer); stopTimer = null; }
    proc.on("SIGTSTP", suspend);
    try { enter(); } catch { return finish(TERMINAL_GONE_STATUS); }
    if (onResume) attempt(() => onResume(true));
    attempt(onRedraw);
  }
  /** Take the terminal again where it may no longer be as enter() left it: something outside the
   *  program reset it (a shell while the process was stopped, a `reset` typed elsewhere, the
   *  multiplexer). Node does nothing when asked for the raw mode it believes it is in, so raw goes
   *  off and on; then the modes, then a full redraw. This is what Ctrl+L asks for: a redraw that
   *  left bracketed paste off would let a paste act as keys.
   *  The modes are written as LEAVE and then ENTER, in one write: the pair a suspend and a resume
   *  write. Entering the alternate screen also saves the cursor, and a terminal that is still on
   *  it may take a second entry as a new save, over the shell's position: the prompt would then
   *  land on the wrong row at the end. Leaving first puts back the cursor the first entry saved,
   *  so the second saves the same one. On a terminal that was reset, the leave changes nothing.
   *  The kitty keyboard protocol goes with the modes: popped before LEAVE, pushed again after ENTER. */
  function reassert() {
    if (!entered || over) return;
    quietly(() => { stdin.setRawMode(false); stdin.setRawMode(true); });
    const pop = popping(), push = pushing();
    pushed = push !== "";
    quietly(() => stdout.write(pop + LEAVE + ENTER + push));
    attempt(onRedraw);
  }
  /** SIGCONT. After our own suspend: come back. Otherwise the process was stopped and continued
   *  from outside while it held the terminal. */
  function continued() {
    if (over) return;
    if (suspended) return resume();
    if (onResume && entered) { attempt(() => onResume(false)); if (over) return; }
    reassert();
  }

  /** Every way out the run can be told of: a signal, an error nobody caught, a terminal gone. */
  function out(status, error) {
    if (over) return;
    finish(status, error);
  }

  /** Every way out is registered before the terminal is touched; then enter. A signal cannot land
   *  inside enter(), which is synchronous, and one that lands after it finds its listener. */
  function start() {
    for (const [signal, status] of Object.entries(SIGNAL_STATUS)) on(proc, signal, () => out(status));
    on(proc, "SIGCONT", continued);
    proc.on("SIGTSTP", suspend);
    on(proc, "uncaughtException", (error) => out(1, error));
    on(proc, "unhandledRejection", (reason) => out(1, reason));
    on(proc, "exit", () => { leave(); if (onEnd) quietly(onEnd); }); // the last resort: a process.exit() nobody expected
    // A dead terminal answers a write or a read with an error event. These two listeners are never
    // removed: the write that restores the terminal can fail after the run is over, and an error
    // event nobody hears is an uncaught exception, which would turn the status into 1.
    for (const stream of [stdin, stdout]) stream.on("error", () => out(TERMINAL_GONE_STATUS));
    on(stdin, "end", () => out(TERMINAL_GONE_STATUS));
    on(stdin, "close", () => out(TERMINAL_GONE_STATUS));
    on(stdin, "data", (bytes) => { if (entered) attempt(() => onInput(bytes)); });
    on(stdout, "resize", () => { if (entered) attempt(onResize); });
    on(stdout, "drain", drained);
    try { enter(); } catch (error) { return finish(1, error); }
    if (!over) stdin.resume();
  }

  /** The terminal's size now; 80x24 when the terminal does not say. */
  const size = () => ({ cols: Number.isInteger(stdout.columns) && stdout.columns > 0 ? stdout.columns : 80, rows: Number.isInteger(stdout.rows) && stdout.rows > 0 ? stdout.rows : 24 });

  return { start, enter, leave, finish, suspend, reassert, attempt, draw, size, done, keyboardAnswered, get entered() { return entered; }, get keyboard() { return kb; } };
}
