/* oats desktop — the mouse in a terminal tab selects natively; the wheel still reaches tmux (#672).

   A terminal tab is a tmux client with tmux's mouse on, so tmux asks the terminal for mouse tracking
   (DECSET 1000/1002/1006, sent as separate sequences). If xterm obeyed, every button event would go
   to tmux and a drag would be tmux's copy-mode selection, which depends on the user's copy-mode
   bindings and OSC 52 and vanishes on release. Instead this module records the tracking requests and
   keeps xterm from applying them, so xterm's SelectionService always owns the buttons: a plain drag,
   a double-click (word) and a triple-click (line) select, a click focuses the terminal, and copy is
   ⌘C / Edit › Copy, right-click › Copy or the terminal.copySelection action. Programs in the panes
   no longer receive clicks or drags from the Desktop, only the wheel.

   The wheel is reported here while the far side tracks the mouse, the way xterm 5.5 would report it:
   one report per wheel event, button 64 (up) / 65 (down) plus xterm's modifier bits, at the pointer's
   cell, SGR (`ESC[<b;x;yM`) when 1006 is set, SGR pixels for 1016, else X10. It goes through
   term.input, so it takes the onData → pty path every report took before, and tmux's WheelUpPane /
   WheelDownPane bindings (tmux-target.mjs) drive scrollback exactly as in 0.43.0. X10 tracking (9)
   reports no wheel in xterm, so then, and with no tracking, the wheel is left to xterm.

   Fallback: a sequence that mixes tracking modes with other modes (tmux never sends one, verified
   with tmux 3.7c) is left to xterm, which applies all of it, tracking included: today's behaviour.
   While xterm itself tracks, tracking-only sequences are left to it too, so its state follows them
   and never sticks. RIS (`ESC c`) resets everything, as it resets xterm's mouse state.

   Pure: no DOM or node: imports; the terminal is passed in. */

/** DEC private modes that request mouse tracking (X10, VT200, highlight, button-event, any-event). */
export const TRACKING_MODES = Object.freeze([9, 1000, 1001, 1002, 1003]);
// The protocols xterm reports the wheel for (VT200, DRAG, ANY). X10 (9) reports no wheel, and xterm
// ignores 1001 entirely.
const WHEEL_PROTOCOLS = new Set([1000, 1002, 1003]);
const PROTOCOLS = new Set([9, 1000, 1002, 1003]);
const ENCODINGS = new Map([[1006, 'sgr'], [1016, 'sgr-pixels']]);
// WheelEvent.deltaMode values.
const DOM_DELTA_LINE = 1, DOM_DELTA_PAGE = 2;
// xterm's modifier bits in a mouse report.
const SHIFT = 4, ALT = 8, CTRL = 16;

// The DEC modes of a `CSI ? … h|l`: the parser's top-level parameters, as xterm's InputHandler reads them.
// A sub-parameter list (`1006:1000` is [1006, [1000]]) belongs to the mode before it and is no mode itself.
const modesOf = params => params.filter(param => !Array.isArray(param));

/** Install on one xterm Terminal. Returns { state(), dispose() }. */
export function attachTerminalMouse(term) {
  let protocol = 0;          // the far side's tracking request: 0 (none), 9, 1000, 1002 or 1003
  let encoding = 'default';  // 'default' (X10 bytes), 'sgr' or 'sgr-pixels'
  let xtermProtocol = 0;     // the protocol xterm itself applied, from sequences left to it (the fallback)
  let partial = 0;           // pixel deltas below one row, carried to the next event (xterm's arithmetic)
  let disposed = false;

  // xterm's own state machine: the last protocol set wins, resetting any protocol clears it.
  const step = (current, modes, set) => modes.reduce((value, mode) => (PROTOCOLS.has(mode) ? (set ? mode : 0) : value), current);
  const onMode = set => params => {
    if (disposed) return false;
    const modes = modesOf(params);
    protocol = step(protocol, modes, set);
    for (const mode of modes) if (ENCODINGS.has(mode)) encoding = set ? ENCODINGS.get(mode) : 'default';
    const tracking = modes.filter(mode => TRACKING_MODES.includes(mode)).length;
    if (!tracking) return false; // 1006, 2004 bracketed paste, 1049 and the rest are xterm's
    if (xtermProtocol !== 0 || tracking < modes.length) {
      // Left to xterm, which applies every mode in it: follow what xterm now tracks.
      xtermProtocol = step(xtermProtocol, modes, set);
      return false;
    }
    return true; // recorded, never obeyed: xterm's selection keeps the buttons
  };
  const reset = () => { protocol = 0; encoding = 'default'; xtermProtocol = 0; partial = 0; return false; };

  const subscriptions = [
    term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, onMode(true)),
    term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, onMode(false)),
    term.parser.registerEscHandler({ final: 'c' }, () => (disposed ? false : reset())),
  ];

  const screenRect = () => term.element?.querySelector?.('.xterm-screen')?.getBoundingClientRect?.() || null;

  // Viewport.getLinesScrolled in xterm 5.5: vertical only, never with Shift, the scroll modifier
  // applied, pixel deltas accumulated per row height, pages times rows.
  function linesScrolled(ev, rowHeight) {
    if (!ev.deltaY || ev.shiftKey) return 0;
    const options = term.options || {};
    const modifier = options.fastScrollModifier ?? 'alt';
    const sensitivity = options.scrollSensitivity ?? 1;
    const fast = (modifier === 'alt' && ev.altKey) || (modifier === 'ctrl' && ev.ctrlKey) || (modifier === 'shift' && ev.shiftKey);
    let amount = ev.deltaY * sensitivity * (fast ? (options.fastScrollSensitivity ?? 5) : 1);
    if (ev.deltaMode === DOM_DELTA_PAGE) return amount * term.rows;
    if (ev.deltaMode === DOM_DELTA_LINE) return amount;
    partial += amount / rowHeight;
    amount = Math.floor(Math.abs(partial)) * (partial > 0 ? 1 : -1);
    partial %= 1;
    return amount;
  }

  function report(ev, rect) {
    const cellWidth = rect.width / term.cols, cellHeight = rect.height / term.rows;
    // MouseService.getMouseReportCoords: clamped to the canvas, then the cell under it (1-based). The
    // position stays fractional for the cell (a scaled display or a centred grid puts edges between
    // pixels); only SGR pixels reports it in whole pixels.
    const x = Math.min(Math.max(ev.clientX - rect.left, 0), rect.width - 1);
    const y = Math.min(Math.max(ev.clientY - rect.top, 0), rect.height - 1);
    const col = Math.min(Math.floor(x / cellWidth), term.cols - 1) + 1;
    const row = Math.min(Math.floor(y / cellHeight), term.rows - 1) + 1;
    const code = 64 | (ev.deltaY < 0 ? 0 : 1) | (ev.shiftKey ? SHIFT : 0) | (ev.altKey ? ALT : 0) | (ev.ctrlKey ? CTRL : 0);
    if (encoding === 'sgr') return `\x1b[<${code};${col};${row}M`;
    if (encoding === 'sgr-pixels') return `\x1b[<${code};${Math.floor(x)};${Math.floor(y)}M`;
    // X10: one byte each, value + 32. xterm sends these as binary; through term.input a byte above
    // 127 would be UTF-8 encoded on its way to the pty, so such a report is not sent at all, as xterm
    // drops one past 255.
    const bytes = [code + 32, col + 32, row + 32];
    if (bytes.some(b => b > 127)) return '';
    return `\x1b[M${String.fromCharCode(...bytes)}`;
  }

  term.attachCustomWheelEventHandler(ev => {
    // No wheel tracking: xterm's default (its viewport, or arrow keys in the alternate screen).
    if (disposed || !WHEEL_PROTOCOLS.has(protocol)) return true;
    // The far side has the wheel: xterm cancelled every wheel event while it tracked, and so does this.
    ev.preventDefault?.();
    ev.stopPropagation?.();
    const rect = screenRect();
    if (!rect || !(rect.width > 0) || !(rect.height > 0) || !(term.cols > 0) || !(term.rows > 0)) return false;
    if (linesScrolled(ev, rect.height / term.rows) === 0) return false;
    const sequence = report(ev, rect);
    if (sequence) term.input(sequence, false);
    term.clearSelection(); // the content scrolls under it
    return false;
  });

  return {
    /** What the far side asked for (tests and live checks). */
    state: () => ({ tracking: protocol, wheel: WHEEL_PROTOCOLS.has(protocol), encoding, xtermTracks: xtermProtocol !== 0 }),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const subscription of subscriptions) subscription.dispose();
      term.attachCustomWheelEventHandler(() => true);
    },
  };
}
