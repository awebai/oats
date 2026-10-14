// Synchronized output (DEC mode 2026) for a terminal tab's output (#1193). tmux,
// given the `sync` client feature, wraps every redraw in BSU (`ESC[?2026h`) …
// ESU (`ESC[?2026l`); xterm 5.5 ignores the mode and paints whatever it has, so a
// redraw split across IPC messages showed its in-between state (a hidden cursor).
// The gate holds a block until its ESU arrives and writes it in one call. Bytes
// outside a block pass through at once and unchanged. xterm 6 honours 2026
// itself; upgrading to it retires this module.
export const SYNC_BEGIN = '\x1b[?2026h';
export const SYNC_END = '\x1b[?2026l';
/** A block whose end never comes is written after this long, as xterm 6 and tmux bound it. */
export const SYNC_TIMEOUT_MS = 1000;

// The longest proper prefix of `seq` that `text` ends with: kept back, since the
// next message may complete it. SYNC_BEGIN and SYNC_END share every proper prefix.
function trailingPrefix(text, seq) {
  for (let n = Math.min(text.length, seq.length - 1); n > 0; n--) {
    if (text.endsWith(seq.slice(0, n))) return n;
  }
  return 0;
}

/** `write` receives every string pushed, in order, each synchronized block whole
 * in one call. `push` takes what `desk.onTermData` delivers; `flush` writes what is
 * held and ends the block; `dispose` drops it and stops the timer for good. */
export function createSyncGate({ write, timeoutMs = SYNC_TIMEOUT_MS,
  clock = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: t => clearTimeout(t) } }) {
  // held: inside a block, the block so far (from its BSU); outside, at most a
  // trailing prefix of BSU. scanned: where the search for ESU resumes in held.
  let held = '', syncing = false, scanned = 0, timer = null, disposed = false;
  const disarm = () => { if (timer !== null) { clock.clearTimeout(timer); timer = null; } };
  const arm = () => { if (timer === null) timer = clock.setTimeout(() => { timer = null; flush(); }, timeoutMs); };
  function flush() {
    disarm();
    const out = held;
    held = ''; syncing = false; scanned = 0;
    if (out) write(out);
  }
  function push(data) {
    if (disposed) return;
    if (typeof data !== 'string') { flush(); write(data); return; }
    // carried: rest still starts with the prefix kept back last time, so a prefix kept
    // back now that is all of rest only extends it and keeps its deadline.
    let rest = held + data, from = scanned, out = '', carried = !syncing && held !== '';
    held = ''; scanned = 0;
    while (rest) {
      if (!syncing) {
        const at = rest.indexOf(SYNC_BEGIN);
        if (at < 0) {
          const keep = trailingPrefix(rest, SYNC_BEGIN);
          if (!(carried && keep === rest.length)) disarm(); // a new prefix gets its own bound
          out += rest.slice(0, rest.length - keep); held = rest.slice(rest.length - keep);
          break;
        }
        out += rest.slice(0, at); rest = rest.slice(at);
        syncing = true; from = SYNC_BEGIN.length;
        disarm(); // the block's own bound starts now
        arm();
      } else {
        const at = rest.indexOf(SYNC_END, from);
        if (at < 0) { held = rest; scanned = Math.max(SYNC_BEGIN.length, rest.length - (SYNC_END.length - 1)); break; }
        const end = at + SYNC_END.length;
        out += rest.slice(0, end); rest = rest.slice(end);
        syncing = false; from = 0;
        disarm();
      }
    }
    if (held) arm(); else disarm();
    if (out) write(out);
  }
  function dispose() { disposed = true; disarm(); held = ''; syncing = false; scanned = 0; }
  return { push, flush, dispose };
}
