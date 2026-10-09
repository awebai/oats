// The guard: everything the TUI changes in the terminal, and the promise that it is put back.
// With term/screen.mjs it is the only module that produces an ESC byte. docs/tui.md lists the
// changes for operators; ENTER and LEAVE below are that list, and nothing else is ever switched on:
// no mouse or focus reporting, no keyboard protocol, no keypad or cursor-key mode, no title, no
// clipboard, no bell, no query that expects a reply.
//
// Handing the terminal to someone else (the shell at a suspend; a viewer in later versions) is
// leave() and enter(), and only that pair.

const mode = (number, on) => `\x1b[?${number}${on ? "h" : "l"}`;
/** After raw mode: the alternate screen, the cursor hidden, autowrap off, bracketed paste on.
 *  Autowrap is off so no row wraps where the terminal and width.mjs disagree about a character (a
 *  wrap on the last row would scroll the screen). Bracketed paste is on so pasted text arrives
 *  marked as a paste, not as keys. */
export const ENTER = mode(1049, true) + mode(25, false) + mode(7, false) + mode(2004, true);
/** The reverse, with the style reset; then raw mode off. */
export const LEAVE = mode(2004, false) + mode(7, true) + "\x1b[0m" + mode(25, true) + mode(1049, false);

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

/** The guard of one run. `frame()` answers the bytes of the newest frame when it is time to write
 *  one; `onInput(bytes)`, `onResize()` and `onRedraw()` (the screen must be drawn in full: after a
 *  suspend, after SIGCONT) are the events. `done` resolves once, with `{ status, error }`, after the
 *  terminal is restored and every listener is removed. */
export function createGuard({ stdin, stdout, proc, frame, onInput, onResize, onRedraw, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let entered = false, raw = false, modes = false;
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
    stdout.write(ENTER);
  }
  /** Put the terminal back. Idempotent; never throws. */
  function leave() {
    if (!entered) return;
    entered = false;
    if (modes) { modes = false; quietly(() => stdout.write(LEAVE)); }
    if (raw) { raw = false; quietly(() => stdin.setRawMode(false)); }
  }

  /** The end of the run, by any way out: restore, stop listening, report once. */
  function finish(status, error) {
    if (over) return;
    over = true;
    leave();
    if (stopTimer !== null) { clearTimer(stopTimer); stopTimer = null; }
    for (const [emitter, name, listener] of listeners) emitter.removeListener(name, listener);
    proc.removeListener("SIGTSTP", suspend);
    quietly(() => stdin.pause());
    settle({ status, error });
  }

  /** Run one of the loop's own steps. What it throws ends the run as an uncaught error would,
   *  without waiting for the process to say so. */
  function attempt(step) {
    try { step(); } catch (error) { finish(1, error); }
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
    attempt(onRedraw);
  }
  /** Take the terminal again where it may no longer be as enter() left it: something outside the
   *  program reset it (a shell while the process was stopped, a `reset` typed elsewhere, the
   *  multiplexer). Node does nothing when asked for the raw mode it believes it is in, so raw goes
   *  off and on; then the modes, then a full redraw. This is what Ctrl+L asks for: a redraw that
   *  left bracketed paste off would let a paste act as keys. */
  function reassert() {
    if (!entered || over) return;
    quietly(() => { stdin.setRawMode(false); stdin.setRawMode(true); });
    quietly(() => stdout.write(ENTER));
    attempt(onRedraw);
  }
  /** SIGCONT. After our own suspend: come back. Otherwise the process was stopped and continued
   *  from outside while it held the terminal. */
  function continued() {
    if (over) return;
    if (suspended) return resume();
    reassert();
  }

  /** Every way out is registered before the terminal is touched; then enter. A signal cannot land
   *  inside enter(), which is synchronous, and one that lands after it finds its listener. */
  function start() {
    for (const [signal, status] of Object.entries(SIGNAL_STATUS)) on(proc, signal, () => finish(status));
    on(proc, "SIGCONT", continued);
    proc.on("SIGTSTP", suspend);
    on(proc, "uncaughtException", (error) => finish(1, error));
    on(proc, "unhandledRejection", (reason) => finish(1, reason));
    on(proc, "exit", leave); // the last resort: a process.exit() nobody expected
    // A dead terminal answers a write or a read with an error event. These two listeners are never
    // removed: the write that restores the terminal can fail after the run is over, and an error
    // event nobody hears is an uncaught exception, which would turn the status into 1.
    for (const stream of [stdin, stdout]) stream.on("error", () => finish(TERMINAL_GONE_STATUS));
    on(stdin, "end", () => finish(TERMINAL_GONE_STATUS));
    on(stdin, "close", () => finish(TERMINAL_GONE_STATUS));
    on(stdin, "data", (bytes) => { if (entered) attempt(() => onInput(bytes)); });
    on(stdout, "resize", () => { if (entered) attempt(onResize); });
    on(stdout, "drain", drained);
    try { enter(); } catch (error) { return finish(1, error); }
    if (!over) stdin.resume();
  }

  /** The terminal's size now; 80x24 when the terminal does not say. */
  const size = () => ({ cols: Number.isInteger(stdout.columns) && stdout.columns > 0 ? stdout.columns : 80, rows: Number.isInteger(stdout.rows) && stdout.rows > 0 ? stdout.rows : 24 });

  return { start, enter, leave, finish, suspend, reassert, attempt, draw, size, done, get entered() { return entered; } };
}
