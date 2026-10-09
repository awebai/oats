// Safe text: the only thing the screen draws. A terminal acts on what is written to it, so the
// screen takes strings from nobody: it takes values only this module can make (docs/tui.md,
// awebai/oats#855 section 3.9). There are two ways in, and no third:
//   lit(string)   the TUI's own words;
//   shown(value)  text the TUI did not write, through the shared display filter.
// A safe value is for display only: nothing compares it, selects by it or passes it to a command.
//
// Every view meets this: the filter folds a run of spaces into one and trims both ends, so lit()
// refuses a string with two spaces together or a space at an end. A row is therefore spans placed
// by column (`{ col, text, style }`), never one padded string: the gap between two spans is the
// screen's blank cells, not text.
import { displayLine, DETAIL_WITHHELD } from "../client.mjs";

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

export const isSafeText = (value) => TEXT.has(value);

/** The string of a safe value, for the screen (and the tests that read a row). A raw string and a
 *  forged object are refused. */
export function textOf(value) {
  if (!TEXT.has(value)) throw new TypeError("the screen draws safe text only: lit() for the TUI's own words, shown() for anything else");
  return TEXT.get(value);
}
