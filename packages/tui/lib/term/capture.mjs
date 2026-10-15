// An agent's terminal, as cells: what `tmux capture-pane -p -e -N` answered, turned into the
// screen's spans (term/screen.mjs). Pure: no IO.
//
// The capture is text the TUI did not write, from a program that may write anything, so nothing
// of it reaches the screen as it came. The characters are kept, measured by width.mjs, and set
// at the column each one takes; of the escape sequences only SGR is read, as a state machine
// over an allowlist, and the style of a cell is built from that state by style.mjs's
// agentStyle(). Every other sequence, every control character and every bidi control is
// dropped, and what is left becomes safe text through text.mjs's cellText(), which refuses
// anything this module should have dropped.
//
// How tmux writes a capture with `-e` (measured on tmux 3.7c): each row is the pane's cells from
// column 0 and ends at "\n"; a wide character is written once, the next character two cells on;
// a run of cells a tab left is one "\t"; an attribute is written where it changes from the cell
// before, ACROSS rows (a row that goes on in the style the last one ended in starts with no SGR
// at all), so the SGR state is carried from row to row and starts plain at the first row; and a
// hyperlink is an OSC 8, which is dropped with the rest.
import { cells } from "./width.mjs";
import { cellText } from "./text.mjs";
import { agentStyle, blankShows } from "./style.mjs";

/** Tab stops are every 8 columns: tmux writes a tab's cells as one "\t" and does not say how
 *  many there were, and a program that set its own stops is the rare case. Each row is set on its
 *  own, so a stop guessed wrong moves only the rest of that row. A tab moves to the stop and paints
 *  nothing: the cells it passes are blank. */
const TAB = 8;
/** A run of characters that are written as they are: no control (C0, DEL, C1) and no bidi
 *  control. Sticky, so each run is matched where the scan stands. */
const TEXT_RUN = /[^\x00-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]+/y;

// ── The SGR state ────────────────────────────────────────────────────────────────────────────────

/** The state with nothing set. A state is a plain object this module alone changes; agentStyle()
 *  interns the style made from it. */
const fresh = () => ({ bold: false, dim: false, italic: false, underline: false, blink: false, reverse: false, invisible: false, strikethrough: false, fg: null, bg: null });
/** Single parameters that set or clear attributes, and what each does to the state. */
const SIMPLE = new Map([
  [1, { bold: true }], [2, { dim: true }], [3, { italic: true }], [4, { underline: true }],
  [5, { blink: true }], [6, { blink: true }], [7, { reverse: true }], [8, { invisible: true }], [9, { strikethrough: true }],
  [21, { bold: false }], [22, { bold: false, dim: false }], [23, { italic: false }], [24, { underline: false }],
  [25, { blink: false }], [27, { reverse: false }], [28, { invisible: false }], [29, { strikethrough: false }],
  [39, { fg: null }], [49, { bg: null }],
]);
/** A parameter as a number: decimal digits only, at most three of them (no value this module
 *  keeps is larger), else null. An empty parameter is 0, as ECMA-48 has it. */
function number(text) {
  if (text === "") return 0;
  return /^\d{1,3}$/.test(text) ? Number(text) : null;
}
const byte = (text) => { const n = text === undefined ? null : number(text); return n !== null && n < 256 ? n : null; };
/** The colour an extended form names: `5;n` or `2;r;g;b`, as the list of what follows 38 or 48.
 *  Null when malformed or out of range. */
function extended(kind, values) {
  if (kind === 5 && values.length === 1) { const n = byte(values[0]); return n === null ? null : { index: n }; }
  if (kind === 2 && values.length === 3) { const rgb = values.map(byte); return rgb.includes(null) ? null : { rgb }; }
  return null;
}

/** Applies the parameters of one SGR (`ESC [ <params> m`, the params as written) to the state.
 *  An allowlist: a parameter not named here is dropped and the rest still apply. An extended
 *  colour (38, 48, and 58 which is dropped) consumes what its selector claims, 5 one value and 2
 *  three, even when a value is missing or out of range, so a malformed colour is dropped and
 *  never read as attributes; a selector that is neither leaves the rest of the list unreadable,
 *  and the rest is dropped. The colon forms (4:n, 38:5:n, 38:2::r:g:b, 38:2:r:g:b) are one parameter each. */
function applySgr(state, params) {
  const list = params.split(";");
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (p.includes(":")) { colon(state, p.split(":")); continue; }
    const n = number(p);
    if (n === null) continue;
    if (n === 0) Object.assign(state, fresh());
    else if (SIMPLE.has(n)) Object.assign(state, SIMPLE.get(n));
    else if (n >= 30 && n <= 37) state.fg = { ansi: n - 30 };
    else if (n >= 90 && n <= 97) state.fg = { ansi: n - 90 + 8 };
    else if (n >= 40 && n <= 47) state.bg = { ansi: n - 40 };
    else if (n >= 100 && n <= 107) state.bg = { ansi: n - 100 + 8 };
    else if (n === 38 || n === 48 || n === 58) {
      const kind = number(list[i + 1] ?? "x");
      const claims = kind === 5 ? 1 : kind === 2 ? 3 : null;
      if (claims === null) return;
      // 58, the underline's colour, is read as the other two are only to be dropped whole: its
      // values are not attributes (tmux writes it as 58;5;n, and its 5 is not a blink).
      const colour = n === 58 ? null : extended(kind, list.slice(i + 2, i + 2 + claims));
      if (colour) state[n === 38 ? "fg" : "bg"] = colour;
      i += 1 + claims;
    }
  }
}
/** One colon parameter: 4:n (0 off, 1 to 5 an underline of some kind, which is kept as on), or an
 *  extended colour 38:5:n, 38:2:r:g:b or 38:2:<colour space>:r:g:b (and 48). Anything else, the
 *  underline colour 58 among them, is dropped. */
function colon(state, sub) {
  if (sub[0] === "4" && sub.length === 2) {
    const n = number(sub[1]);
    if (n !== null && n <= 5) state.underline = n !== 0;
    return;
  }
  if (sub[0] !== "38" && sub[0] !== "48") return;
  const kind = number(sub[1] ?? "x");
  let values = sub.slice(2);
  if (kind === 2 && values.length === 4 && /^\d*$/.test(values[0])) values = values.slice(1);
  const colour = extended(kind, values);
  if (colour) state[sub[0] === "38" ? "fg" : "bg"] = colour;
}

// ── Sequences ────────────────────────────────────────────────────────────────────────────────────

/** Where a control string (OSC, DCS, SOS, PM, APC) that starts at `from` ends: past its BEL (OSC
 *  only), its ST (`ESC \` or U+009C), or before an ESC that starts something else. -1 when the row
 *  ends first: the string is cut, and the rest of the row with it. */
function stringEnd(row, from, bel) {
  for (let i = from; i < row.length; i++) {
    const c = row.charCodeAt(i);
    if ((bel && c === 0x07) || c === 0x9c) return i + 1;
    if (c === 0x1b) return row[i + 1] === "\\" ? i + 2 : i;
  }
  return -1;
}
/** Where a CSI whose parameters start at `from` ends, and its parameters and final byte:
 *  `{ end, params, final }`, with `final` null when a byte outside a CSI stops it (the sequence
 *  ends before that byte, which is read again). `end` -1 when the row ends first. */
function csiEnd(row, from) {
  let i = from;
  while (i < row.length && row.charCodeAt(i) >= 0x30 && row.charCodeAt(i) <= 0x3f) i++;
  const params = row.slice(from, i);
  let intermediate = false;
  while (i < row.length && row.charCodeAt(i) >= 0x20 && row.charCodeAt(i) <= 0x2f) { i++; intermediate = true; }
  if (i >= row.length) return { end: -1 };
  const c = row.charCodeAt(i);
  if (c >= 0x40 && c <= 0x7e) return { end: i + 1, params, final: intermediate ? null : row[i] };
  return { end: i, params, final: null };
}
/** Whether the parameters are an SGR's: a CSI with final `m` and no private marker (`<`, `=`, `>`,
 *  `?`: `CSI > 4;1 m` sets a keyboard mode, not a style). */
const isSgr = (final, params) => final === "m" && /^[0-9:;]*$/.test(params);

// ── Rows ─────────────────────────────────────────────────────────────────────────────────────────

/** One row of the capture as spans, from the SGR `state` it starts in, which it leaves as the row
 *  ended so the next row goes on from it. Past `cols` no character is kept, but the SGRs are
 *  still read: the next row may start in the style this one ended in. */
function captureRow(row, cols, state) {
  const placed = [];
  let col = 0, full = cols <= 0;
  let look = agentStyle(state), pending = "";
  /** Sets what was read in the current style, grapheme by grapheme, from the running column. */
  function flush() {
    if (pending === "") return;
    const text = pending;
    pending = "";
    if (full) return;
    for (const g of cells(text)) {
      // A wide grapheme that would cross the edge is dropped, and so is everything after it: the
      // terminal set the next one two cells on, past the edge too.
      if (col + g.width > cols) { full = true; return; }
      placed.push({ col, text: g.text, width: g.width, style: look });
      col += g.width;
    }
    if (col >= cols) full = true;
  }
  /** After an SGR: the same style goes on in the same run, so graphemes split by an SGR that
   *  changed nothing are measured together, as the screen will measure them. */
  function restyle() {
    if (full) return;
    const next = agentStyle(state);
    if (next !== look) { flush(); look = next; }
  }

  for (let i = 0; i < row.length;) {
    TEXT_RUN.lastIndex = i;
    const run = TEXT_RUN.exec(row);
    if (run) {
      if (!full) pending += run[0];
      i += run[0].length;
      continue;
    }
    const c = row.charCodeAt(i);
    if (c === 0x09) {
      flush();
      if (!full) { col = Math.min(col + TAB - (col % TAB), cols); full = col >= cols; }
      i++;
      continue;
    }
    if (c === 0x1b || c === 0x9b || c === 0x9d || c === 0x90 || c === 0x98 || c === 0x9e || c === 0x9f) {
      const eight = c !== 0x1b;
      const kind = eight ? String.fromCharCode(c - 0x40) : row[i + 1];
      const body = eight ? i + 1 : i + 2;
      // An ESC that ends the row: the sequence it began is cut, and dropped.
      if (kind === undefined) break;
      if (kind === "[") {
        const { end, params, final } = csiEnd(row, body);
        if (end < 0) break;
        // Only the 7-bit SGR is read: the 8-bit CSI (U+009B) is dropped whole, its style too.
        if (!eight && isSgr(final, params)) { applySgr(state, params); restyle(); }
        i = end;
      } else if (kind === "]" || kind === "P" || kind === "X" || kind === "^" || kind === "_") {
        const end = stringEnd(row, body, kind === "]");
        if (end < 0) break;
        i = end;
      } else {
        // ESC with intermediates and a final (ESC ( B), or ESC and one final byte; an ESC before
        // anything else is dropped alone and what follows it is read again.
        let j = i + 1;
        while (j < row.length && row.charCodeAt(j) >= 0x20 && row.charCodeAt(j) <= 0x2f) j++;
        if (j >= row.length) break;
        const f = row.charCodeAt(j);
        i = f >= 0x30 && f <= 0x7e ? j + 1 : j > i + 1 ? j : i + 1;
      }
      continue;
    }
    // Every other control character, and a bidi control: dropped.
    i++;
  }
  flush();
  return spans(placed);
}

/** The placed graphemes as spans: consecutive graphemes of one style, with no gap a tab left
 *  between them, are one span. Spaces in a style that shows nothing on a blank are left to the
 *  screen's own blank cells, so such a span never starts or ends with one, and a run of nothing
 *  else makes no span. */
function spans(placed) {
  const out = [];
  let open = null;
  for (const g of placed) {
    if (open && open.style === g.style && open.end === g.col) { open.graphemes.push(g); open.end += g.width; continue; }
    open = { style: g.style, graphemes: [g], end: g.col + g.width };
    out.push(open);
  }
  const result = [];
  for (const { style, graphemes } of out) {
    let first = 0, last = graphemes.length;
    if (!blankShows(style)) {
      while (first < last && graphemes[first].text === " ") first++;
      while (last > first && graphemes[last - 1].text === " ") last--;
    }
    if (first === last) continue;
    const kept = graphemes.slice(first, last);
    const width = kept.reduce((sum, g) => sum + g.width, 0);
    result.push(Object.freeze({ col: kept[0].col, text: cellText(kept.map((g) => g.text).join("")), style, width }));
  }
  return Object.freeze(result);
}

/** The rows of a capture-pane answer (`tmux capture-pane -p -e -N`) as the screen's spans, for a
 *  panel of `cols` by `rows` cells: exactly `rows` rows, the first ones of the capture, each an
 *  array of `{ col, text, style, width }` with `col` from 0 inside the panel, `text` safe text
 *  (cellText), `style` an agent style (or PLAIN) and `width` the cells it takes. A row holds at
 *  most `cols` cells: what is past the edge is dropped, never wrapped. A capture with fewer rows
 *  gives empty rows after them; the newline that ends the last row is not a row of its own. */
export function captureRows(text, { cols, rows }) {
  if (typeof text !== "string") throw new TypeError("a capture is the text tmux answered");
  if (!Number.isInteger(cols) || cols < 0 || !Number.isInteger(rows) || rows < 0) throw new RangeError("a panel's size is a number of cells");
  const lines = text.split("\n");
  if (text.endsWith("\n")) lines.pop();
  const state = fresh(), out = [];
  for (let r = 0; r < rows; r++) out.push(r < lines.length ? captureRow(lines[r], cols, state) : Object.freeze([]));
  return Object.freeze(out);
}
