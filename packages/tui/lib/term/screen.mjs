// The screen: a buffer of cells and the bytes that turn the previous frame into the next one.
// With term/tty.mjs it is the only module that produces an ESC byte, and what it writes is a closed
// list: a position, an erase, an SGR of style.mjs's parameters. Text reaches it as safe text only
// (term/text.mjs); a string is refused.
//
// The rules a width disagreement cannot break (docs/tui.md): every row write starts with an
// absolute position and is erased to its end, so a character the terminal draws wider or narrower
// than width.mjs counts moves nothing outside its own row; nothing is written past the last column.
import { cells } from "./width.mjs";
import { textOf } from "./text.mjs";
import { PLAIN, isStyle, sgr } from "./style.mjs";

const CSI = "\x1b[";
const RESET = `${CSI}0m`;
const CLEAR = `${CSI}2J`;
const ERASE_TO_END = `${CSI}K`;
const position = (row, col) => `${CSI}${row + 1};${col + 1}H`;

const cell = (text, width, style) => Object.freeze({ text, width, style });
const BLANK = cell(" ", 1, PLAIN);
/** The second cell of a two-cell grapheme: it holds nothing to write. */
const TAIL = cell("", 0, PLAIN);
const PRINTABLE_ASCII = /^[\x20-\x7e]$/;
/** A cell that shows nothing: a space in a style that draws nothing on a space. */
const shows = (c) => c.text !== " " || c.style.underline || c.style.reverse;

/** What the locale and `--ascii` decide: `utf8`, whether the terminal is told to read UTF-8
 *  (LC_ALL, else LC_CTYPE, else LANG names it), and `ascii`, whether the TUI's own marks and rules
 *  are ASCII (not UTF-8, or asked for). */
export function glyphs(env, { ascii = false } = {}) {
  const locale = [env.LC_ALL, env.LC_CTYPE, env.LANG].find((value) => typeof value === "string" && value !== "") ?? "";
  const utf8 = /utf-?8/i.test(locale);
  return { utf8, ascii: ascii || !utf8 };
}

/** A screen. `render(rows, size, { full })` answers the bytes for one frame and remembers it.
 *  `rows[r]` is the spans of row r: `{ col, text, style?, width? }`, `text` safe text, `width` the
 *  cells the span may take (default: to the right edge). */
export function createScreen({ utf8 = true, ascii = !utf8, color = true } = {}) {
  const mark = cells(ascii ? "..." : "\u2026");
  let previous = null;

  /** Overwriting one half of a two-cell grapheme blanks the other half. */
  function clear(line, x) {
    if (line[x] === TAIL) line[x - 1] = BLANK;
    else if (line[x].width === 2) line[x + 1] = BLANK;
    line[x] = BLANK;
  }
  function place(line, span) {
    const { col, style = PLAIN } = span;
    const source = textOf(span.text);
    if (!isStyle(style)) throw new TypeError("a span's style is a style value: make one with style()");
    if (!Number.isInteger(col) || col < 0) throw new RangeError("a span's column is a cell index from 0");
    const limit = span.width === undefined ? line.length : Math.min(line.length, col + span.width);
    if (col >= limit) return;
    let drawn = cells(source);
    // A terminal that is not reading UTF-8 would show each byte of a character on its own.
    if (!utf8) drawn = drawn.map((g) => (PRINTABLE_ASCII.test(g.text) ? g : { text: "?", width: 1 }));
    if (drawn.reduce((sum, g) => sum + g.width, 0) > limit - col) {
      // Clipped: what fits before the mark, then the mark (or as much of it as the span holds).
      const room = limit - col - mark.reduce((sum, g) => sum + g.width, 0);
      const kept = [];
      for (let used = 0, i = 0; i < drawn.length && used + drawn[i].width <= room; used += drawn[i].width, i++) kept.push(drawn[i]);
      drawn = [...kept, ...mark];
    }
    let x = col;
    for (const g of drawn) {
      if (x + g.width > limit) break;
      clear(line, x);
      if (g.width === 2) { clear(line, x + 1); line[x + 1] = TAIL; }
      line[x] = cell(g.text, g.width, style);
      x += g.width;
    }
  }
  function layout(rows, size) {
    return Array.from({ length: size.rows }, (_, r) => {
      const line = Array.from({ length: size.cols }, () => BLANK);
      for (const span of rows[r] ?? []) place(line, span);
      return line;
    });
  }

  const same = (a, b) => a === b || (a.text === b.text && a.style === b.style);
  const asciiOnly = (line) => line.every((c) => PRINTABLE_ASCII.test(c.text));
  /** The bytes of one row from column `from`: a position, the cells up to the last one that shows,
   *  and an erase when the row ends before the right edge. Every row ends in the plain style, so the
   *  erase paints nothing and the next row starts from a known state. */
  function writeRow(r, line, from) {
    let end = line.length;
    while (end > 0 && !shows(line[end - 1])) end--;
    const start = Math.min(from, end);
    let out = position(r, start), current = RESET;
    for (let x = start; x < end; x++) {
      const c = line[x];
      if (c === TAIL) continue;
      // Always from a reset: a style never inherits from the cell before it.
      const look = `${CSI}${[0, ...sgr(c.style, { color })].join(";")}m`;
      if (look !== current) { out += look; current = look; }
      out += c.text;
    }
    if (current !== RESET) out += RESET;
    return end < line.length ? out + ERASE_TO_END : out;
  }

  function render(rows, size, { full = false } = {}) {
    const lines = layout(rows, size);
    const redraw = full || !previous || previous.cols !== size.cols || previous.rows !== size.rows;
    let out = redraw ? RESET + CLEAR : "";
    for (let r = 0; r < size.rows; r++) {
      const line = lines[r], old = redraw ? null : previous.lines[r];
      if (!old) { if (line.some(shows)) out += writeRow(r, line, 0); continue; }
      const changed = line.findIndex((c, x) => !same(c, old[x]));
      if (changed < 0) continue;
      // A row with any grapheme outside printable ASCII is rewritten whole: its columns are only
      // as sure as the width table, so nothing in it is addressed by column.
      out += writeRow(r, line, asciiOnly(line) && asciiOnly(old) ? changed : 0);
    }
    previous = { cols: size.cols, rows: size.rows, lines };
    return out;
  }
  return { render };
}
