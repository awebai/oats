// Safe text: the only thing the screen draws. A terminal acts on what is written to it, so the
// screen takes strings from nobody: it takes values only this module can make (docs/tui.md,
// awebai/oats#855 section 3.9). There are three ways in, and no fourth:
//   lit(string)       the TUI's own words;
//   shown(value)      text the TUI did not write, through the shared display filter;
//   cellText(string)  the cells of an agent's terminal, which term/capture.mjs has already
//                     filtered, drawn only in the terminal panel.
// A safe value is for display only: nothing compares it, selects by it or passes it to a command.
//
// The third exists because the display filter is right for a line and wrong for a terminal's
// cells: it folds runs of spaces and trims, and a terminal's spaces are its layout. cellText()
// keeps the spaces and refuses, rather than filters: every character it would have to take out
// is one capture.mjs drops first, so a refusal is a bug there, never text to repair here.
//
// Every view meets this: the filter folds a run of spaces into one and trims both ends, so lit()
// refuses a string with two spaces together or a space at an end. A row is therefore spans placed
// by column (`{ col, text, style }`), never one padded string: the gap between two spans is the
// screen's blank cells, not text.
import { displayLine, DETAIL_WITHHELD } from "../client.mjs";
import { cells } from "./width.mjs";

/** The brand: a value is safe text when it is a key here. Nothing outside this module can add one,
 *  and a look-alike object is not one. */
const TEXT = new WeakMap();
function make(string) {
  const value = Object.freeze(Object.create(null));
  TEXT.set(value, string);
  return value;
}

/** Nothing to show. */
export const EMPTY = make("");
/** Text the filter withheld whole (a control character, a secret shape): the TUI's own mark. */
export const WITHHELD = make("[withheld]");

/** The TUI's own one-line text. It throws unless the display filter would show the string as it is:
 *  a developer who hands it kernel text by mistake still cannot write a control character. The
 *  message never repeats the string, which may be the very thing that must not be written. */
export function lit(string) {
  if (typeof string !== "string" || displayLine(string) !== string) throw new TypeError("lit() takes the TUI's own one-line text, exactly as the display filter shows it; text from anywhere else goes through shown()");
  return make(string);
}

/** Text the TUI did not write (a kernel answer, a name, anything relayed), as one display line. */
export function shown(value) {
  const line = displayLine(value);
  return line === null ? EMPTY : line === DETAIL_WITHHELD ? WITHHELD : make(line);
}

/** The cut mark, the screen's own (term/screen.mjs): one cell, or three in ASCII. */
const cutMark = (ascii) => (ascii ? "..." : "\u2026");
const widthOf = (graphemes) => graphemes.reduce((sum, g) => sum + g.width, 0);
const joined = (graphemes) => graphemes.map((g) => g.text).join("");

/** Text the TUI did not write, as the END of its display line: what fits `width` cells, with the
 *  cut mark in front when the start is left out. For a value read from its end (a path).
 *  Filtered first and cut after, by cells and between graphemes: a part of a display line is
 *  itself fit to show, so nothing reaches the screen that shown() would not have let through. */
export function shownEnd(value, width, { ascii = false } = {}) {
  const line = displayLine(value);
  if (line === null) return EMPTY;
  if (line === DETAIL_WITHHELD) return WITHHELD;
  const all = cells(line);
  if (widthOf(all) <= width) return make(joined(all));
  const mark = cutMark(ascii), room = width - mark.length;
  const kept = [];
  for (let i = all.length - 1, used = 0; i >= 0 && used + all[i].width <= room; used += all[i].width, i--) kept.unshift(all[i]);
  return make(room < 0 ? "" : mark + joined(kept).replace(/^ +/, ""));
}

/** Text the TUI did not write, as at most `max` rows of at most `width` cells: its display line
 *  broken at spaces where it can be and between graphemes where it cannot, the last row ending
 *  in the cut mark when more was left. For a sentence that must be read whole (a kernel's
 *  reason). Filtered first and cut after, as shownEnd is; nothing to show gives no row, and
 *  neither does a row too narrow for the first grapheme. */
export function shownLines(value, width, max, { ascii = false } = {}) {
  const line = displayLine(value);
  if (line === null || width < 1 || max < 1) return [];
  if (line === DETAIL_WITHHELD) return [WITHHELD];
  const rows = [];
  let rest = cells(line);
  while (rest.length && rows.length < max) {
    if (widthOf(rest) <= width) { rows.push(rest); rest = []; break; }
    let end = 0;
    for (let used = 0; end < rest.length && used + rest[end].width <= width; used += rest[end].width) end++;
    // Back to the last space inside the row, when there is one: the row ends before it.
    let cut = end;
    while (cut > 0 && rest[cut]?.text !== " " && rest[cut - 1].text !== " ") cut--;
    if (cut === 0) cut = end;
    if (cut === 0) break; // a grapheme wider than the row: nothing more can be set
    const row = rest.slice(0, cut);
    while (row.length && row[row.length - 1].text === " ") row.pop();
    rest = rest.slice(cut);
    while (rest.length && rest[0].text === " ") rest.shift();
    rows.push(row);
  }
  const mark = cutMark(ascii);
  if (rest.length && rows.length && mark.length <= width) {
    // More was left: the last row gives up its end to the mark. (A row too narrow for the mark
    // keeps what it has: no row is ever wider than `width`.)
    const last = rows[rows.length - 1];
    while (last.length && widthOf(last) + mark.length > width) last.pop();
    while (last.length && last[last.length - 1].text === " ") last.pop();
    last.push(...cells(mark));
  }
  return rows.map((row) => make(joined(row)));
}

/** What cellText() refuses: the C0 controls (ESC among them), DEL, the C1 controls, and the bidi
 *  controls (U+061C, U+200E, U+200F, U+202A to U+202E, U+2066 to U+2069), which would let a row
 *  reorder what is drawn in it. */
const NOT_A_CELL = /[\x00-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

/** The text of an agent's terminal cells, as term/capture.mjs read them from a capture: spaces
 *  kept as they are. It throws on any character capture.mjs drops, and its message never repeats
 *  the string. For capture.mjs alone; any other text goes through lit() or shown(). */
export function cellText(string) {
  if (typeof string !== "string" || NOT_A_CELL.test(string)) throw new TypeError("cellText() takes an agent's cells as term/capture.mjs filtered them: no control or bidi character");
  return make(string);
}

export const isSafeText = (value) => TEXT.has(value);

/** The string of a safe value, for the screen (and the tests that read a row). A raw string and a
 *  forged object are refused. */
export function textOf(value) {
  if (!TEXT.has(value)) throw new TypeError("the screen draws safe text only: lit() for the TUI's own words, shown() for anything else, cellText() for an agent's cells");
  return TEXT.get(value);
}
