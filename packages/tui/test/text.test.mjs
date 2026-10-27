import test from "node:test";
import assert from "node:assert/strict";
import { DETAIL_WITHHELD } from "../lib/client.mjs";
import { EMPTY, WITHHELD, cellText, isSafeText, lit, shown, textOf } from "../lib/term/text.mjs";

const ESC = "\x1b";
/** What must never reach a terminal as it is, by name. */
const HOSTILE = {
  "ESC": `red ${ESC}[31m alert`,
  "a C1 control (U+009B, the 8-bit CSI)": "a\u009B31mb",
  "a bidi override (U+202E)": "safe\u202Etxt.exe",
  "a secret shape": "token: ghp_abcdefghijklmnopqrstuvwxyz0123",
};

test("lit() makes safe text of the TUI's own one-line words, and textOf() reads it back", () => {
  for (const words of ["oats", "? help", "This preview draws the frame only.", "───", "q, Ctrl+C"]) assert.equal(textOf(lit(words)), words);
});

test("lit() throws on ESC, a C1 control, a bidi override and a secret shape, and its message never repeats the text", () => {
  for (const [name, text] of Object.entries(HOSTILE)) {
    assert.throws(() => lit(text), (error) => error instanceof TypeError && !error.message.includes(text) && !/[\x00-\x1f\x7f-\x9f]/.test(error.message), name);
  }
});

test("lit() throws on anything the display filter would change: a run of spaces, a space at an end, a tab, a line break, nothing at all, not a string", () => {
  for (const text of ["two  spaces", " leading", "trailing ", "a\tb", "a\nb", "", " "]) assert.throws(() => lit(text), TypeError, JSON.stringify(text));
  for (const value of [null, undefined, 7, ["oats"], { toString: () => "oats" }]) assert.throws(() => lit(value), TypeError);
});

test("shown() answers the withheld mark for text the filter withholds whole, and the replaced line for the rest", () => {
  assert.equal(shown(HOSTILE["ESC"]), WITHHELD);
  assert.equal(shown(HOSTILE["a secret shape"]), WITHHELD);
  assert.equal(shown(DETAIL_WITHHELD), WITHHELD, "the filter's own mark is never shown as content");
  assert.equal(textOf(shown(HOSTILE["a C1 control (U+009B, the 8-bit CSI)"])), "a\uFFFD31mb");
  assert.equal(textOf(shown(HOSTILE["a bidi override (U+202E)"])), "safe\uFFFDtxt.exe");
  assert.equal(textOf(WITHHELD), "[withheld]");
  for (const [name, text] of Object.entries(HOSTILE)) assert.doesNotMatch(textOf(shown(text)), /[\x00-\x1f\x7f-\x9f\u202A-\u202E]/, name);
});

test("shown() folds a line to one line, and nothing to show is the empty value", () => {
  assert.equal(textOf(shown("dev-1")), "dev-1");
  assert.equal(textOf(shown("two\nlines\tand   spaces ")), "two lines and spaces");
  for (const nothing of [null, undefined, "", "   ", "\n", 42, {}]) assert.equal(shown(nothing), EMPTY);
  assert.equal(textOf(EMPTY), "");
});

test("safe text cannot be forged: a string, a look-alike object, a copy and a subclass are all refused", () => {
  const real = lit("oats");
  assert.equal(isSafeText(real), true);
  assert.equal(Object.isFrozen(real), true);
  assert.deepEqual(Reflect.ownKeys(real), [], "it carries no property a caller could read or set");
  const forgeries = ["oats", new String("oats"), { text: "oats" }, { ...real }, Object.create(real), Object.freeze(Object.create(null)), structuredClone({}), null, undefined, 0, Symbol("oats")];
  for (const forged of forgeries) {
    assert.equal(isSafeText(forged), false);
    assert.throws(() => textOf(forged), TypeError);
  }
});

// ── shownEnd() and shownLines(): text the TUI did not write, cut by cells ─────────────────────────
// Both filter first and cut after, between graphemes: what they answer is safe text that shown()
// would have let through, in the cells the view has for it.
import { displayLine } from "../lib/client.mjs";
import { shownEnd, shownLines } from "../lib/term/text.mjs";
import { textWidth } from "../lib/term/width.mjs";

const FAMILY = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}", FLAG = "\u{1F1EA}\u{1F1F8}", THUMB = "\u{1F44D}\u{1F3FD}";
const PATH = "/srv/deploy/agents/acme-ledger-developer/instances/acme-ledger-developer-note-target";
const SENTENCE = "This deployment's last read failed: the mirror at build-7 did not answer in time. It shows what was last observed.";
const NEVER_WRITTEN = /[\x00-\x1f\x7f-\x9f\u2028\u2029\u202A-\u202E\u2066-\u2069]/;
const markOf = (ascii) => (ascii ? "..." : "…");
const rowsOf = (value, width, max, options) => shownLines(value, width, max, options).map(textOf);

test("shownEnd() answers a display line that fits its width unchanged", () => {
  assert.equal(textOf(shownEnd("/a/b", 10)), "/a/b");
  assert.equal(textOf(shownEnd("/a/b", 4)), "/a/b", "exactly as wide as the line");
  assert.equal(textOf(shownEnd("/a/b", 4, { ascii: true })), "/a/b");
  assert.equal(textOf(shownEnd("two\nlines\tand   spaces ", 40)), "two lines and spaces", "the display line, as shown() gives it");
  assert.equal(textOf(shownEnd("名前", 4)), "名前", "a wide grapheme takes two cells");
  assert.equal(textOf(shownEnd(`${FAMILY}${FLAG}${THUMB}`, 6)), `${FAMILY}${FLAG}${THUMB}`, "and so does an emoji sequence, however many code points it is");
  for (const ascii of [false, true]) for (const width of [PATH.length, PATH.length + 1, 500]) assert.equal(textOf(shownEnd(PATH, width, { ascii })), PATH);
});

test("shownEnd() answers a longer line as the cut mark and then the END of the line, in exactly `width` cells, with either mark", () => {
  assert.equal(textOf(shownEnd("/srv/deploy/agents/x", 8)), "…gents/x");
  assert.equal(textOf(shownEnd("/srv/deploy/agents/x", 8, { ascii: true })), "...nts/x");
  for (const ascii of [false, true]) for (let width = 0; width < PATH.length; width++) {
    const text = textOf(shownEnd(PATH, width, { ascii })), mark = markOf(ascii);
    assert.equal(textWidth(text) <= width, true, `${width} cells: never more`);
    if (width < mark.length) continue;
    assert.equal(text.startsWith(mark), true, `${width} cells: the mark stands first`);
    assert.equal(PATH.endsWith(text.slice(mark.length)), true, `${width} cells: then the end of the line`);
    assert.equal(text.length, width, `${width} cells: every cell is used`);
    if (width > mark.length) assert.equal(text.at(-1), PATH.at(-1), "the last cell is the last character of the line");
  }
  assert.equal(textOf(shownEnd(PATH, 1)), "…", "one cell is the mark alone");
  assert.equal(textOf(shownEnd(PATH, 3, { ascii: true })), "...");
  for (const [width, ascii] of [[0, false], [0, true], [1, true], [2, true], [-1, false], [-5, true]]) assert.equal(textOf(shownEnd(PATH, width, { ascii })), "", `${width} cells hold nothing`);
});

test("shownEnd() never splits a grapheme: a wide character or an emoji sequence is whole or left out, and the result is never wider than `width`", () => {
  for (const [name, grapheme] of [["a wide character", "名"], ["a family joined by ZWJ", FAMILY], ["a flag", FLAG], ["an emoji with a skin tone", THUMB]]) {
    const line = grapheme.repeat(12);
    for (const ascii of [false, true]) for (let width = 0; width < 24; width++) {
      const text = textOf(shownEnd(line, width, { ascii })), mark = markOf(ascii), at = `${name}, ${width} cells${ascii ? ", ASCII" : ""}`;
      assert.equal(textWidth(text) <= width, true, at);
      if (width < mark.length) continue;
      const kept = text.slice(mark.length);
      assert.equal(text.startsWith(mark), true, at);
      assert.equal(kept, grapheme.repeat(kept.length / grapheme.length), `${at}: only whole graphemes follow the mark`);
      assert.equal(kept.length / grapheme.length, Math.floor((width - mark.length) / 2), `${at}: as many as fit, and no half of one`);
    }
  }
  // A grapheme of a base and combining marks is one cell and stays together.
  const marked = "e\u0301".repeat(20);
  assert.equal(textOf(shownEnd(marked, 6)), `…${"e\u0301".repeat(5)}`);
  assert.equal(textOf(shownEnd(`ab${FAMILY}cd`, 5)), `…${FAMILY}cd`);
  assert.equal(textOf(shownEnd(`ab${FAMILY}cd`, 4)), "…cd", "three cells are left and the family would be cut: it is left out");
});

test("shownEnd() answers what the display filter shows and nothing else: nothing to show is empty, unsafe text is the withheld mark, and the result is safe text", () => {
  for (const nothing of [null, undefined, "", "   ", "\n", 42, {}]) for (const ascii of [false, true]) {
    assert.equal(textOf(shownEnd(nothing, 10, { ascii })), "");
    assert.equal(isSafeText(shownEnd(nothing, 10, { ascii })), true);
  }
  assert.equal(shownEnd(HOSTILE["ESC"], 40), WITHHELD);
  assert.equal(shownEnd(HOSTILE["a secret shape"], 40, { ascii: true }), WITHHELD);
  assert.equal(shownEnd(DETAIL_WITHHELD, 40), WITHHELD, "the filter's own mark is never shown as content");
  assert.equal(shownEnd(`${"x".repeat(300)}${ESC}[2J`, 10), WITHHELD, "unsafe text is withheld whole, whatever part of it would have been kept");
  assert.equal(textOf(shownEnd(HOSTILE["a bidi override (U+202E)"], 40)), "safe\uFFFDtxt.exe");
  assert.equal(textOf(shownEnd(HOSTILE["a bidi override (U+202E)"], 9)), "…\uFFFDtxt.exe", "a replaced character is cut like any other cell");
  assert.equal(textOf(shownEnd(HOSTILE["a bidi override (U+202E)"], 8)), "…txt.exe");
  assert.equal(textOf(shownEnd(HOSTILE["a C1 control (U+009B, the 8-bit CSI)"], 5)), "…31mb");
  for (const value of [PATH, SENTENCE, FAMILY.repeat(9), ...Object.values(HOSTILE)]) for (const ascii of [false, true]) for (const width of [0, 1, 2, 3, 5, 8, 12, 40, 400]) {
    const made = shownEnd(value, width, { ascii }), text = textOf(made);
    assert.equal(isSafeText(made), true);
    assert.equal(Object.isFrozen(made), true);
    assert.doesNotMatch(text, NEVER_WRITTEN, "no control character, C1 control or bidi control");
    assert.equal(text === "" || displayLine(text) === text, true, "what is answered is itself fit to show: no space at an end, no run of spaces");
  }
  assert.equal(textOf(shownEnd("one two three", 7)), "…three", "a cut that falls on a space leaves no space after the mark");
});

test("shownLines() breaks a display line at its spaces into rows of at most `width` cells, and joining the rows with one space gives the line back", () => {
  assert.deepEqual(rowsOf("one two three four", 9, 4), ["one two", "three", "four"]);
  assert.deepEqual(rowsOf("one two three four", 7, 4), ["one two", "three", "four"], "a row that ends exactly at a word's end");
  assert.deepEqual(rowsOf("one two three four", 13, 4), ["one two three", "four"]);
  assert.deepEqual(rowsOf("one two three four", 18, 4), ["one two three four"], "a line that fits is one row");
  assert.deepEqual(rowsOf("one two three four", 500, 1), ["one two three four"]);
  assert.deepEqual(rowsOf("two\nlines\tand   spaces ", 9, 4), ["two lines", "and", "spaces"], "the display line is what is wrapped");
  for (const ascii of [false, true]) for (let width = 12; width <= SENTENCE.length + 1; width++) {
    const rows = rowsOf(SENTENCE, width, 50, { ascii });
    assert.equal(rows.join(" "), SENTENCE, `${width} cells: nothing was cut, so the rows give the line back`);
    rows.forEach((row, i) => {
      assert.equal(textWidth(row) <= width && row.length > 0, true, `${width} cells: row ${i}`);
      assert.equal(row === row.trim(), true, `${width} cells: row ${i} has no space at an end`);
      if (i + 1 < rows.length) assert.equal(textWidth(row) + 1 + rows[i + 1].split(" ")[0].length > width, true, `${width} cells: row ${i} holds every word that fits`);
    });
  }
});

test("shownLines() with `first`: the first row is that wide, every other `width`; the cut mark keeps to the last row's own room", () => {
  assert.deepEqual(rowsOf("one two three four", 9, 4, { first: 3 }), ["one", "two three", "four"]);
  assert.deepEqual(rowsOf("one two three four", 9, 4, { first: 13 }), ["one two three", "four"]);
  assert.deepEqual(rowsOf("abcdefghij", 4, 5, { first: 2 }), ["ab", "cdef", "ghij"]);
  assert.deepEqual(rowsOf("one two three four", 9, 1, { first: 7 }), ["one tw…"], "a first row that is also the last ends in the mark inside its own room");
  assert.deepEqual(rowsOf("one two three four five", 9, 2, { first: 3 }), ["one", "two thre…"]);
  assert.deepEqual(rowsOf("one two", 9, 4, { first: 0 }), [], "a first row with no room gives no row");
  assert.deepEqual(rowsOf("one two three four", 9, 4, { first: 9 }), rowsOf("one two three four", 9, 4), "a first as wide as the rest changes nothing");
});

test("shownLines() cuts a word longer than the row between graphemes, never inside one", () => {
  assert.deepEqual(rowsOf("abcdefghij", 4, 5), ["abcd", "efgh", "ij"]);
  assert.deepEqual(rowsOf("abcdefghij", 10, 5), ["abcdefghij"]);
  const mixed = rowsOf("ab cdefghijklmnop qr", 5, 9);
  assert.equal(mixed.join("").replaceAll(" ", ""), "abcdefghijklmnopqr", "every character is on a row, in order");
  for (const row of mixed) assert.equal(textWidth(row) <= 5 && row === row.trim() && row.length > 0, true);
  assert.deepEqual(rowsOf("名前".repeat(5), 5, 9), ["名前", "名前", "名前", "名前", "名前"], "five cells hold two wide characters, not two and a half");
  assert.deepEqual(rowsOf("名前".repeat(3), 4, 9), ["名前", "名前", "名前"]);
  assert.deepEqual(rowsOf(FAMILY.repeat(4), 4, 9), [FAMILY.repeat(2), FAMILY.repeat(2)]);
  assert.deepEqual(rowsOf(FAMILY.repeat(3), 3, 9), [FAMILY, FAMILY, FAMILY], "an emoji sequence is whole on its row");
  assert.deepEqual(rowsOf(`${FLAG}${THUMB}${FLAG}${THUMB}`, 5, 9), [`${FLAG}${THUMB}`, `${FLAG}${THUMB}`]);
  assert.deepEqual(rowsOf("e\u0301".repeat(7), 3, 9), ["e\u0301".repeat(3), "e\u0301".repeat(3), "e\u0301"], "a base and its combining mark stay together");
  for (const [name, grapheme] of [["a wide character", "名"], ["a family", FAMILY], ["a flag", FLAG], ["a skin tone", THUMB]]) for (let width = 2; width < 15; width++) {
    const rows = rowsOf(grapheme.repeat(20), width, 100);
    assert.equal(rows.join(""), grapheme.repeat(20), `${name}, ${width} cells: nothing is lost`);
    for (const row of rows) { assert.equal(textWidth(row) <= width, true, `${name}, ${width} cells`); assert.equal(row, grapheme.repeat(row.length / grapheme.length), `${name}, ${width} cells: whole graphemes only`); }
  }
});

test("shownLines() answers at most `max` rows, and the last ends in the cut mark when more of the line was left", () => {
  assert.deepEqual(rowsOf("one two three four five six", 9, 2), ["one two", "three…"]);
  assert.deepEqual(rowsOf("one two three four five six", 9, 2, { ascii: true }), ["one two", "three..."]);
  assert.deepEqual(rowsOf("one two three four five six", 9, 1), ["one two…"]);
  assert.deepEqual(rowsOf("abcdefghi abcdefghi abc", 9, 2), ["abcdefghi", "abcdefgh…"], "a full last row gives up its end to the mark");
  assert.deepEqual(rowsOf("abcdefghi abcdefghi abc", 9, 2, { ascii: true }), ["abcdefghi", "abcdef..."]);
  assert.deepEqual(rowsOf("名前".repeat(9), 6, 2), ["名前名", "前名…"], "the mark takes the place of a whole wide character");
  assert.deepEqual(rowsOf("one two three four five six", 9, 3), ["one two", "three", "four fiv…"], "a last row that is full gives up its end, and no more");
  assert.deepEqual(rowsOf("one two three four", 9, 3), ["one two", "three", "four"], "nothing was left: no mark");
  for (const ascii of [false, true]) for (const value of [SENTENCE, PATH, "名前".repeat(40), FAMILY.repeat(30)]) for (let width = 4; width < 40; width += 3) for (const max of [1, 2, 4, 6]) {
    const rows = rowsOf(value, width, max, { ascii }), whole = rowsOf(value, width, 1000, { ascii }), mark = markOf(ascii), at = `${width} cells, ${max} rows${ascii ? ", ASCII" : ""}`;
    assert.equal(rows.length <= max, true, at);
    for (const row of rows) assert.equal(textWidth(row) <= width, true, `${at}: ${row}`);
    if (whole.length <= max) { assert.deepEqual(rows, whole, `${at}: all of it fits, and no mark is added`); continue; }
    assert.equal(rows.length, max, `${at}: every row it may take`);
    assert.deepEqual(rows.slice(0, -1), whole.slice(0, max - 1), `${at}: the rows before the last are the line's`);
    assert.equal(rows.at(-1).endsWith(mark), true, `${at}: the last row ends in the mark`);
    assert.equal(whole[max - 1].startsWith(rows.at(-1).slice(0, -mark.length).trimEnd()), true, `${at}: and begins as the line's row does`);
  }
});

test("shownLines() answers no row for nothing to show or for no room, one withheld row for unsafe text, and safe text only", () => {
  for (const nothing of [null, undefined, "", "   ", "\n", 42, {}]) assert.deepEqual(shownLines(nothing, 20, 4), []);
  for (const [width, max] of [[0, 4], [-1, 4], [20, 0], [20, -2], [0, 0]]) {
    assert.deepEqual(shownLines(SENTENCE, width, max), [], `${width} cells, ${max} rows`);
    assert.deepEqual(shownLines(HOSTILE["ESC"], width, max), [], "also for text that would be withheld");
  }
  for (const unsafe of [HOSTILE["ESC"], HOSTILE["a secret shape"], DETAIL_WITHHELD, `${SENTENCE} ${ESC}]0;owned\x07`]) for (const max of [1, 4]) {
    const rows = shownLines(unsafe, 40, max);
    assert.equal(rows.length === 1 && rows[0] === WITHHELD, true, "withheld whole, on one row");
  }
  assert.deepEqual(rowsOf(HOSTILE["a bidi override (U+202E)"], 6, 4), ["safe\uFFFDt", "xt.exe"], "a replaced character is a cell like any other");
  for (const value of [SENTENCE, PATH, FAMILY.repeat(9), `${SENTENCE}\u202E${SENTENCE}`, ...Object.values(HOSTILE)]) for (const ascii of [false, true]) for (const width of [3, 5, 8, 12, 40, 400]) for (const max of [1, 3, 6]) {
    for (const row of shownLines(value, width, max, { ascii })) {
      assert.equal(isSafeText(row), true);
      assert.doesNotMatch(textOf(row), NEVER_WRITTEN, "no control character, C1 control or bidi control");
      assert.equal(displayLine(textOf(row)), textOf(row), "a row is itself fit to show: no space at an end, no run of spaces");
    }
  }
});

test("shownLines() never answers a row wider than `width`, also when one grapheme, or the cut mark, is wider than the row", () => {
  for (const row of rowsOf("名前".repeat(4), 1, 20)) assert.equal(textWidth(row) <= 1, true, `a wide character in a row of one cell: ${row}`);
  for (const row of rowsOf(FAMILY.repeat(4), 1, 20)) assert.equal(textWidth(row) <= 1, true, "an emoji sequence in a row of one cell");
  for (const width of [1, 2]) for (const row of rowsOf(SENTENCE, width, 3, { ascii: true })) assert.equal(textWidth(row) <= width, true, `the ASCII mark in a row of ${width}: ${row}`);
  for (const row of rowsOf("名前".repeat(9), 2, 2)) assert.equal(textWidth(row) <= 2, true, `the mark after a wide character in a row of two cells: ${row}`);
});

// ── cellText(): an agent's cells, as term/capture.mjs filtered them ──────────────────────────────

test("cellText() keeps a terminal's cells as they are: runs of spaces, spaces at the ends, wide characters, combining marks, emoji and the replacement character", () => {
  for (const cells of ["a  b", "  indented", "trailing   ", " ", "", "中文 字", "e\u0301 a\u0308", "\u{1F600}\u{1F44D}\u{1F3FD}", "\u{1F1EF}\u{1F1F5}", "\uFFFD", "x\u200Dy", "tab\u00A0nbsp"]) {
    const value = cellText(cells);
    assert.equal(isSafeText(value), true);
    assert.equal(textOf(value), cells, JSON.stringify(cells));
  }
});

test("cellText() refuses every character capture.mjs drops: each C0 control, ESC among them, DEL, each C1 control and each bidi control, and its message never repeats the text", () => {
  const refused = [
    ...Array.from({ length: 0x20 }, (_, n) => String.fromCodePoint(n)),
    "\x7f",
    ...Array.from({ length: 0x20 }, (_, n) => String.fromCodePoint(0x80 + n)),
    ...[0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069].map((n) => String.fromCodePoint(n)),
  ];
  assert.equal(refused.length, 32 + 1 + 32 + 12);
  for (const character of refused) {
    const text = `ok ${character} ok`;
    assert.throws(() => cellText(text), (error) => error instanceof TypeError && !error.message.includes(text) && !/[\x00-\x1f\x7f-\x9f]/.test(error.message), `U+${character.codePointAt(0).toString(16).padStart(4, "0")}`);
  }
  assert.throws(() => cellText("\x1b[2J"), TypeError);
  for (const value of [null, undefined, 7, ["a"], { toString: () => "a" }, lit("oats")]) assert.throws(() => cellText(value), TypeError);
});
