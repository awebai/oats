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

// ── The fill span and the cell buffer ────────────────────────────────────────────────────────────

const REVERSE = style({ reverse: true });
/** A fill: no text, a width, a style. */
const fill = (col, width, look) => ({ col, width, ...(look ? { style: look } : {}) });
const texts = (line) => line.map((cell) => cell.text).join("");

test("a fill, a span with a width and no text, paints blank cells in its style: the bytes carry the style over the spaces", () => {
  assert.equal(createScreen().render([[fill(2, 3, REVERSE)]], size(8, 1)), `${CSI}0m${CSI}2J${CSI}1;1H  ${CSI}0;7m   ${CSI}0m${CSI}K`);
  assert.equal(createScreen().render([[fill(0, 2, style({ underline: true }))]], size(8, 1)), `${CSI}0m${CSI}2J${CSI}1;1H${CSI}0;4m  ${CSI}0m${CSI}K`);
  assert.equal(createScreen().render([[fill(0, 8, REVERSE)]], size(8, 1)), `${CSI}0m${CSI}2J${CSI}1;1H${CSI}0;7m        ${CSI}0m`, "a bar over the whole row, and no erase after the last column");
  assert.equal(createScreen({ color: false }).render([[fill(1, 2, style({ reverse: true, fg: "red" }))]], size(4, 1)), `${CSI}0m${CSI}2J${CSI}1;1H ${CSI}0;7m  ${CSI}0m${CSI}K`, "without colour the bar is still a bar");
  const [line] = createScreen().cells([[fill(2, 3, REVERSE)]], size(8, 1));
  assert.equal(texts(line), "        ");
  assert.deepEqual(line.map((cell) => cell.style === REVERSE), [false, false, true, true, true, false, false, false]);
  assert.deepEqual(line.map((cell) => cell.width), [1, 1, 1, 1, 1, 1, 1, 1]);
});

test("a fill in a style that draws nothing on a blank writes nothing, and a fill blanks the text under it", () => {
  assert.equal(createScreen().render([[fill(0, 4)]], size(8, 1)), `${CSI}0m${CSI}2J`, "plain blanks are the cleared screen");
  assert.equal(createScreen().render([[fill(0, 4, style({ bold: true, fg: "red" }))]], size(8, 1)), `${CSI}0m${CSI}2J`, "bold red blanks show nothing");
  assert.equal(createScreen().render([[span(0, "abcdef"), fill(2, 2)]], size(8, 1)), `${CSI}0m${CSI}2J${CSI}1;1Hab  ef${CSI}K`);
  assert.equal(createScreen().render([[span(0, "abcdef"), fill(0, 0, REVERSE)]], size(8, 1)), `${CSI}0m${CSI}2J${CSI}1;1Habcdef${CSI}K`, "a fill of no cells paints none");
});

test("later spans draw over a fill: text on a bar keeps the style it was given, and the bar shows between and after it", () => {
  const rows = [[fill(0, 6, REVERSE), span(1, "ab", REVERSE), span(4, "x")]];
  assert.equal(createScreen().render(rows, size(8, 1)), `${CSI}0m${CSI}2J${CSI}1;1H${CSI}0;7m ab ${CSI}0mx${CSI}0;7m ${CSI}0m${CSI}K`);
  const [line] = createScreen().cells(rows, size(8, 1));
  assert.equal(texts(line), " ab x   ");
  assert.deepEqual(line.map((cell) => cell.style.reverse), [true, true, true, true, false, true, false, false]);
  // And a fill drawn later covers what was there.
  assert.equal(texts(createScreen().cells([[span(0, "abcdef"), fill(1, 3, REVERSE)]], size(8, 1))[0]), "a   ef  ");
});

test("a fill past the right edge is clipped: nothing is painted past the last column", () => {
  assert.equal(createScreen().render([[fill(6, 10, REVERSE)]], size(8, 1)), `${CSI}0m${CSI}2J${CSI}1;1H      ${CSI}0;7m  ${CSI}0m`);
  assert.equal(createScreen().render([[fill(8, 3, REVERSE)]], size(8, 1)), `${CSI}0m${CSI}2J`, "a fill that starts at the edge paints nothing");
  assert.equal(createScreen().render([[fill(40, 3, REVERSE)]], size(8, 1)), `${CSI}0m${CSI}2J`);
  const cells = createScreen().cells([[fill(6, 10, REVERSE)], [fill(0, 3000, REVERSE)]], size(8, 2));
  assert.deepEqual(cells.map((line) => line.length), [8, 8]);
  assert.deepEqual(cells[0].map((cell) => cell.style.reverse), [false, false, false, false, false, false, true, true]);
  assert.deepEqual(cells[1].map((cell) => cell.style.reverse), Array.from({ length: 8 }, () => true));
});

test("a fill over one half of a two-cell grapheme blanks the other half", () => {
  assert.equal(createScreen().render([[span(0, "中文"), fill(1, 1, REVERSE)]], size(8, 1)), `${CSI}0m${CSI}2J${CSI}1;1H ${CSI}0;7m ${CSI}0m文${CSI}K`);
  assert.equal(createScreen().render([[span(0, "中文"), fill(2, 1, REVERSE)]], size(8, 1)), `${CSI}0m${CSI}2J${CSI}1;1H中${CSI}0;7m ${CSI}0m${CSI}K`);
  const [second] = createScreen().cells([[span(0, "中文"), fill(1, 1, REVERSE)]], size(6, 1));
  assert.deepEqual(second.map((cell) => [cell.text, cell.width]), [[" ", 1], [" ", 1], ["文", 2], ["", 0], [" ", 1], [" ", 1]]);
  const [first] = createScreen().cells([[span(0, "中文"), fill(2, 1, REVERSE)]], size(6, 1));
  assert.deepEqual(first.map((cell) => [cell.text, cell.width]), [["中", 2], ["", 0], [" ", 1], [" ", 1], [" ", 1], [" ", 1]]);
  assert.deepEqual(first.map((cell) => cell.style.reverse), [false, false, true, false, false, false]);
  // A bar over a whole wide grapheme leaves no half of it.
  assert.equal(texts(createScreen().cells([[span(1, "中"), fill(0, 4, REVERSE)]], size(6, 1))[0]), "      ");
});

test("a fill is only a span with a width and no text: a text that is undefined, or no text and no width, is still refused, and so is a width that is not a number of cells", () => {
  const screen = createScreen();
  for (const refused of [{ col: 0, text: undefined, width: 3 }, { col: 0, text: undefined, width: 3, style: REVERSE }, { col: 0, text: null, width: 3 }, { col: 0, text: "   ", width: 3 }, { col: 0 }, { col: 0, style: REVERSE }, { col: 0, text: undefined }]) {
    assert.throws(() => screen.render([[refused]], size(8, 1)), TypeError, JSON.stringify(Object.keys(refused)));
    assert.throws(() => screen.cells([[refused]], size(8, 1)), TypeError);
  }
  for (const width of [-1, 1.5, "3", NaN, null, Infinity]) assert.throws(() => screen.render([[{ col: 0, width, style: REVERSE }]], size(8, 1)), `a fill of ${String(width)} cells`);
  assert.throws(() => screen.render([[{ col: 0, width: 3, style: { reverse: true } }]], size(8, 1)), TypeError, "a fill's style is a style value too");
  for (const col of [-1, 1.5, "0", NaN]) assert.throws(() => screen.render([[{ col, width: 3, style: REVERSE }]], size(8, 1)), RangeError);
  // And nothing of a refused frame was kept: the next frame is still the first one.
  assert.equal(screen.render([[fill(0, 1, REVERSE)]], size(4, 1)), `${CSI}0m${CSI}2J${CSI}1;1H${CSI}0;7m ${CSI}0m${CSI}K`);
});

test("a row that changes only in a fill is rewritten like any other: a bar that moves from one row to the next", () => {
  const screen = createScreen(), frame = (selected) => [0, 1, 2].map((r) => [...(r === selected ? [fill(0, 6, REVERSE)] : []), span(1, `row ${r}`, r === selected ? REVERSE : undefined)]);
  screen.render(frame(0), size(8, 3));
  assert.equal(screen.render(frame(0), size(8, 3)), "", "the same frame writes nothing");
  const moved = screen.render(frame(1), size(8, 3));
  assert.equal(moved, `${CSI}1;1H row 0${CSI}K${CSI}2;1H${CSI}0;7m row 1${CSI}0m${CSI}K`);
  const { foreign, sequences } = readTerminalOutput(moved);
  assert.deepEqual(foreign, []);
  assert.deepEqual(sequences.filter((s) => s.kind === "position").map((s) => s.body), ["1;1H", "2;1H"], "the two rows that changed, and not the third");
});

test("cells() answers the frame as cells, one `{ text, width, style }` per column with the second cell of a wide grapheme empty and of no width, and writes nothing", () => {
  const bold = style({ bold: true }), screen = createScreen();
  const rows = [[span(0, "oats", bold)], [span(1, "中x"), fill(4, 9, REVERSE)]];
  const cells = screen.cells(rows, size(6, 3));
  assert.equal(Array.isArray(cells) && typeof cells !== "string", true, "cells, not bytes");
  assert.deepEqual(cells.map((line) => line.length), [6, 6, 6], "as many rows and columns as the size, also where the frame has no row");
  assert.deepEqual(cells[0].map((cell) => [cell.text, cell.width, cell.style === bold]), [["o", 1, true], ["a", 1, true], ["t", 1, true], ["s", 1, true], [" ", 1, false], [" ", 1, false]]);
  assert.deepEqual(cells[1].map((cell) => [cell.text, cell.width]), [[" ", 1], ["中", 2], ["", 0], ["x", 1], [" ", 1], [" ", 1]]);
  assert.deepEqual(cells[1].map((cell) => cell.style.reverse), [false, false, false, false, true, true]);
  assert.deepEqual(cells[2].map((cell) => [cell.text, cell.width, cell.style]), Array.from({ length: 6 }, () => [" ", 1, PLAIN]));
  assert.equal(texts(createScreen().cells([[span(0, "abcdefghij")]], size(6, 1))[0]), "abcde…", "clipped as the frame is, with the mark");
  assert.equal(texts(createScreen({ utf8: true, ascii: true }).cells([[span(0, "abcdefghij")]], size(6, 1))[0]), "abc...");
  assert.equal(texts(createScreen(glyphs({ LANG: "C" })).cells([[{ col: 0, text: shown("café 中") }]], size(8, 1))[0]), "caf? ?  ", "and as the locale has it");
  assert.throws(() => screen.cells([[{ col: 0, text: "a raw string" }]], size(6, 1)), TypeError, "cells() takes safe text only, as render() does");
});

test("cells() does not disturb what render() remembers: before a first frame the first frame is still whole, and after a frame the same rows write nothing", () => {
  const screen = createScreen(), rows = [[span(0, "oats")], [span(1, "中x")]];
  screen.cells(rows, size(6, 2));
  screen.cells(rows, size(6, 2));
  assert.equal(screen.render(rows, size(6, 2)), `${CSI}0m${CSI}2J${CSI}1;1Hoats${CSI}K${CSI}2;1H 中x${CSI}K`, "asking for the cells is not drawing them");
  // Cells of the same frame, of another frame and of another size, between two renders.
  screen.cells(rows, size(6, 2));
  screen.cells([[span(0, "other")], [fill(0, 6, REVERSE)]], size(6, 2));
  screen.cells([[span(0, "other")]], size(40, 10));
  assert.equal(screen.render(rows, size(6, 2)), "", "render, cells, render again of the same rows writes nothing");
  // And the next change is a difference from the frame that was rendered, not from what cells() was asked.
  screen.cells([[span(0, "oats")], [span(1, "中y")]], size(6, 2));
  assert.equal(screen.render([[span(0, "oats")], [span(1, "中y")]], size(6, 2)), `${CSI}2;1H 中y${CSI}K`);
  screen.cells([[span(0, "boats")]], size(6, 2));
  assert.equal(screen.render([[span(0, "oats")], [span(1, "中y")]], size(6, 2)), "");
});
