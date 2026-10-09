import test from "node:test";
import assert from "node:assert/strict";
import { createScreen, glyphs } from "../lib/term/screen.mjs";
import { PLAIN, style } from "../lib/term/style.mjs";
import { lit, shown } from "../lib/term/text.mjs";
import { readTerminalOutput } from "./helpers.mjs";

const CSI = "\x1b[";
const size = (cols, rows) => ({ cols, rows });
const span = (col, text, look, width) => ({ col, text: lit(text), ...(look ? { style: look } : {}), ...(width === undefined ? {} : { width }) });

test("the first frame resets the style, clears the screen and writes each row that shows something at its own position", () => {
  const screen = createScreen();
  const bytes = screen.render([[span(0, "oats")], [], [span(2, "ok")]], size(10, 3));
  assert.equal(bytes, `${CSI}0m${CSI}2J${CSI}1;1Hoats${CSI}K${CSI}3;1H  ok${CSI}K`);
});

test("a style is written as a reset and its parameters, and the row ends in the plain style before it is erased", () => {
  const screen = createScreen();
  const bytes = screen.render([[span(0, "oats", style({ bold: true })), span(5, "dim", style({ dim: true })), span(9, "x")]], size(12, 1));
  assert.equal(bytes, `${CSI}0m${CSI}2J${CSI}1;1H${CSI}0;1moats${CSI}0m ${CSI}0;2mdim${CSI}0m x${CSI}K`);
  const coloured = createScreen().render([[span(0, "!", style({ fg: "red", bold: true }))]], size(4, 1));
  assert.equal(coloured, `${CSI}0m${CSI}2J${CSI}1;1H${CSI}0;1;31m!${CSI}0m${CSI}K`);
});

test("without colour the colour parameter is dropped and the attributes stay", () => {
  const bytes = createScreen({ color: false }).render([[span(0, "!", style({ fg: "red", bold: true })), span(1, "?", style({ fg: "green" }))]], size(4, 1));
  assert.equal(bytes, `${CSI}0m${CSI}2J${CSI}1;1H${CSI}0;1m!${CSI}0m?${CSI}K`);
});

test("a row that reaches the right edge is not erased, and nothing is written past the last column", () => {
  const bytes = createScreen().render([[span(0, "abcde")]], size(5, 1));
  assert.equal(bytes, `${CSI}0m${CSI}2J${CSI}1;1Habcde`);
});

test("an unchanged frame writes nothing, and one changed cell rewrites only its row, from that cell", () => {
  const screen = createScreen();
  const rows = (word) => [[span(0, "first row")], [span(0, `second ${word}`)], [span(0, "third row")]];
  screen.render(rows("row"), size(20, 3));
  assert.equal(screen.render(rows("row"), size(20, 3)), "");
  assert.equal(screen.render(rows("raw"), size(20, 3)), `${CSI}2;9Haw${CSI}K`);
  const { sequences } = readTerminalOutput(screen.render(rows("rows!"), size(20, 3)));
  assert.deepEqual(sequences.filter((s) => s.kind === "position").map((s) => s.body), ["2;9H"], "one row, one position");
});

test("every row write begins with an absolute position", () => {
  const screen = createScreen();
  const first = screen.render([[span(0, "a")], [span(3, "b", style({ bold: true }))], [span(0, "──")]], size(8, 3));
  const second = screen.render([[span(0, "b")], [span(3, "c", style({ bold: true }))], [span(0, "───")]], size(8, 3));
  for (const bytes of [first.replace(`${CSI}0m${CSI}2J`, ""), second]) {
    // Cut at each position: every piece that holds text starts with one.
    const pieces = bytes.split(/(?=\x1b\[\d+;\d+H)/);
    assert.equal(pieces.length, 3);
    for (const piece of pieces) assert.match(piece, /^\x1b\[\d+;\d+H/);
  }
});

test("a row that holds a grapheme outside printable ASCII is rewritten whole when any cell in it changes", () => {
  const screen = createScreen();
  screen.render([[span(0, "中文 name-a")]], size(20, 1));
  assert.equal(screen.render([[span(0, "中文 name-b")]], size(20, 1)), `${CSI}1;1H中文 name-b${CSI}K`);
  // Also when the character is only in the row being replaced.
  assert.equal(screen.render([[span(0, "plain name-b")]], size(20, 1)), `${CSI}1;1Hplain name-b${CSI}K`);
});

test("a row whose text got shorter is erased from the end of what is left", () => {
  const screen = createScreen();
  screen.render([[span(0, "long text here")]], size(20, 1));
  assert.equal(screen.render([[span(0, "long")]], size(20, 1)), `${CSI}1;5H${CSI}K`);
  assert.equal(screen.render([[]], size(20, 1)), `${CSI}1;1H${CSI}K`);
});

test("a full redraw clears first, and so does a change of size", () => {
  const screen = createScreen();
  const rows = [[span(0, "oats")]];
  screen.render(rows, size(10, 2));
  assert.equal(screen.render(rows, size(10, 2), { full: true }), `${CSI}0m${CSI}2J${CSI}1;1Hoats${CSI}K`);
  assert.equal(screen.render(rows, size(12, 2)), `${CSI}0m${CSI}2J${CSI}1;1Hoats${CSI}K`);
  assert.equal(screen.render(rows, size(12, 2)), "");
});

test("text is clipped to its row with the ellipsis mark, in UTF-8 and in ASCII", () => {
  const long = [[span(0, "abcdefghijklmnop")]];
  assert.equal(createScreen().render(long, size(8, 1)), `${CSI}0m${CSI}2J${CSI}1;1Habcdefg…`);
  assert.equal(createScreen({ utf8: true, ascii: true }).render(long, size(8, 1)), `${CSI}0m${CSI}2J${CSI}1;1Habcde...`);
  assert.equal(createScreen().render([[span(5, "abcdef")]], size(8, 1)), `${CSI}0m${CSI}2J${CSI}1;1H     ab…`);
  assert.equal(createScreen().render([[span(9, "off the row")]], size(8, 1)), `${CSI}0m${CSI}2J`, "a span that starts past the edge writes nothing");
});

test("a span is clipped to its own width, and the next span is not pushed", () => {
  const bytes = createScreen().render([[span(0, "a very long name", undefined, 8), span(10, "idle")]], size(20, 1));
  assert.equal(bytes, `${CSI}0m${CSI}2J${CSI}1;1Ha very …  idle${CSI}K`);
});

test("a two-cell grapheme takes two cells, is never cut in half, and one overwritten half blanks the other", () => {
  assert.equal(createScreen().render([[span(0, "中文"), span(5, "x")]], size(8, 1)), `${CSI}0m${CSI}2J${CSI}1;1H中文 x${CSI}K`);
  // Three cells left for two wide characters: one fits before the mark, not one and a half.
  assert.equal(createScreen().render([[span(5, "中文字")]], size(8, 1)), `${CSI}0m${CSI}2J${CSI}1;1H     中…`);
  assert.equal(createScreen().render([[span(0, "中文"), span(1, "x")]], size(8, 1)), `${CSI}0m${CSI}2J${CSI}1;1H x文${CSI}K`);
});

test("when the locale is not UTF-8 every non-ASCII grapheme of content is written as ?, one cell each", () => {
  const screen = createScreen(glyphs({ LANG: "C" }));
  const bytes = screen.render([[{ col: 0, text: shown("café 中文 \u{1F600}") }]], size(16, 1));
  assert.equal(bytes, `${CSI}0m${CSI}2J${CSI}1;1Hcaf? ?? ?${CSI}K`);
  assert.doesNotMatch(bytes, /[^\x00-\x7f]/);
});

test("the locale decides UTF-8 by LC_ALL, else LC_CTYPE, else LANG, and --ascii makes the TUI's own marks ASCII", () => {
  assert.deepEqual(glyphs({ LANG: "en_US.UTF-8" }), { utf8: true, ascii: false });
  assert.deepEqual(glyphs({ LANG: "C.utf8" }), { utf8: true, ascii: false });
  assert.deepEqual(glyphs({ LANG: "en_US.UTF-8" }, { ascii: true }), { utf8: true, ascii: true });
  for (const env of [{}, { LANG: "C" }, { LANG: "POSIX" }, { LANG: "en_US.ISO-8859-1" }, { LANG: "" }]) assert.deepEqual(glyphs(env), { utf8: false, ascii: true }, JSON.stringify(env));
  assert.deepEqual(glyphs({ LC_ALL: "C", LANG: "en_US.UTF-8" }), { utf8: false, ascii: true }, "LC_ALL overrides LANG");
  assert.deepEqual(glyphs({ LC_ALL: "en_US.UTF-8", LC_CTYPE: "C", LANG: "C" }), { utf8: true, ascii: false });
  assert.deepEqual(glyphs({ LC_CTYPE: "C", LANG: "en_US.UTF-8" }), { utf8: false, ascii: true }, "LC_CTYPE overrides LANG");
  assert.deepEqual(glyphs({ LC_ALL: "", LC_CTYPE: "en_US.UTF-8", LANG: "C" }), { utf8: true, ascii: false }, "an empty variable is not set");
});

test("the screen refuses a raw string and a forged object as text: a view cannot forget the filter", () => {
  const screen = createScreen();
  const real = lit("oats");
  for (const text of ["oats", "\x1b[2J", new String("oats"), { text: "oats" }, { ...real }, Object.create(real), null, undefined]) {
    assert.throws(() => screen.render([[{ col: 0, text }]], size(10, 1)), TypeError);
  }
  // And nothing of a refused frame was kept: the next frame is still the first one.
  assert.equal(screen.render([[{ col: 0, text: real }]], size(10, 1)), `${CSI}0m${CSI}2J${CSI}1;1Hoats${CSI}K`);
});

test("the screen refuses a style it did not get from style(), and a column that is not a cell index", () => {
  const screen = createScreen();
  assert.throws(() => screen.render([[{ col: 0, text: lit("x"), style: { bold: true } }]], size(4, 1)), TypeError);
  assert.throws(() => screen.render([[{ col: 0, text: lit("x"), style: "\x1b[31m" }]], size(4, 1)), TypeError);
  for (const col of [-1, 1.5, "0", NaN]) assert.throws(() => screen.render([[{ col, text: lit("x") }]], size(4, 1)), RangeError);
  assert.equal(PLAIN, style());
});

test("everything a frame writes is on the TUI's own list of sequences", () => {
  const screen = createScreen();
  const out = screen.render([[span(0, "oats", style({ bold: true, fg: "brightCyan" }))], [span(0, "─".repeat(30), style({ dim: true }))], [{ col: 2, text: shown("café 中文") }]], size(30, 3))
    + screen.render([[span(0, "oats")], [], [{ col: 0, text: shown("x".repeat(100)) }]], size(30, 3));
  const { sequences, foreign } = readTerminalOutput(out);
  assert.deepEqual(foreign, []);
  assert.deepEqual([...new Set(sequences.map((s) => s.kind))].sort(), ["erase", "position", "sgr"]);
});
