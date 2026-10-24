import test from "node:test";
import assert from "node:assert/strict";
import { createScreen, glyphs } from "../lib/term/screen.mjs";
import { PLAIN, agentStyle, style } from "../lib/term/style.mjs";
import { cellText, lit, shown } from "../lib/term/text.mjs";
import { readTerminalOutput } from "./helpers.mjs";

const CSI = "\x1b[";
const size = (cols, rows) => ({ cols, rows });
// Every frame that writes anything is one synchronized update, and a redraw shows a cursor it is
// given (a hidden one is the guard's, which ENTER hid): what the tests below expect of a frame is
// its inside.
const BEGIN = `${CSI}?2026h`, END = `${CSI}?2026l`, SHOW = `${CSI}?25h`, HIDE = `${CSI}?25l`;
/** A frame that changes rows: its bytes inside the synchronized update. */
const update = (body) => `${BEGIN}${body}${END}`;
/** A whole frame (the first, a full one, one of a new size) with no cursor: reset, clear, the rows. */
const whole = (body = "") => update(`${CSI}0m${CSI}2J${body}`);
/** The inside of a frame, after checking it is one synchronized update: one 2026 set at its start,
 *  one reset at its end, and neither anywhere else. */
function inside(bytes) {
  assert.equal(bytes.startsWith(BEGIN) && bytes.endsWith(END), true, JSON.stringify(bytes));
  const body = bytes.slice(BEGIN.length, -END.length);
  assert.equal(body.includes("?2026"), false, "one pair, at the ends");
  return body;
}
const span = (col, text, look, width) => ({ col, text: lit(text), ...(look ? { style: look } : {}), ...(width === undefined ? {} : { width }) });

test("the first frame resets the style, clears the screen and writes each row that shows something at its own position", () => {
  const screen = createScreen();
  const bytes = screen.render([[span(0, "oats")], [], [span(2, "ok")]], size(10, 3));
  assert.equal(bytes, whole(`${CSI}1;1Hoats${CSI}K${CSI}3;1H  ok${CSI}K`));
});

test("a style is written as a reset and its parameters, and the row ends in the plain style before it is erased", () => {
  const screen = createScreen();
  const bytes = screen.render([[span(0, "oats", style({ bold: true })), span(5, "dim", style({ dim: true })), span(9, "x")]], size(12, 1));
  assert.equal(bytes, whole(`${CSI}1;1H${CSI}0;1moats${CSI}0m ${CSI}0;2mdim${CSI}0m x${CSI}K`));
  const coloured = createScreen().render([[span(0, "!", style({ fg: "red", bold: true }))]], size(4, 1));
  assert.equal(coloured, whole(`${CSI}1;1H${CSI}0;1;31m!${CSI}0m${CSI}K`));
});

test("without colour the colour parameter is dropped and the attributes stay", () => {
  const bytes = createScreen({ color: false }).render([[span(0, "!", style({ fg: "red", bold: true })), span(1, "?", style({ fg: "green" }))]], size(4, 1));
  assert.equal(bytes, whole(`${CSI}1;1H${CSI}0;1m!${CSI}0m?${CSI}K`));
});

test("a row that reaches the right edge is not erased, and nothing is written past the last column", () => {
  const bytes = createScreen().render([[span(0, "abcde")]], size(5, 1));
  assert.equal(bytes, whole(`${CSI}1;1Habcde`));
});

test("an unchanged frame writes nothing, and one changed cell rewrites only its row, from that cell", () => {
  const screen = createScreen();
  const rows = (word) => [[span(0, "first row")], [span(0, `second ${word}`)], [span(0, "third row")]];
  screen.render(rows("row"), size(20, 3));
  assert.equal(screen.render(rows("row"), size(20, 3)), "");
  assert.equal(screen.render(rows("raw"), size(20, 3)), update(`${CSI}2;9Haw${CSI}K`));
  const { sequences } = readTerminalOutput(inside(screen.render(rows("rows!"), size(20, 3))));
  assert.deepEqual(sequences.filter((s) => s.kind === "position").map((s) => s.body), ["2;9H"], "one row, one position");
});

test("every row write begins with an absolute position", () => {
  const screen = createScreen();
  const one = screen.render([[span(0, "a")], [span(3, "b", style({ bold: true }))], [span(0, "──")]], size(8, 3));
  const two = screen.render([[span(0, "b")], [span(3, "c", style({ bold: true }))], [span(0, "───")]], size(8, 3));
  for (const bytes of [inside(one).replace(`${CSI}0m${CSI}2J`, "").replace(HIDE, ""), inside(two)]) {
    // Cut at each position: every piece that holds text starts with one.
    const pieces = bytes.split(/(?=\x1b\[\d+;\d+H)/);
    assert.equal(pieces.length, 3);
    for (const piece of pieces) assert.match(piece, /^\x1b\[\d+;\d+H/);
  }
});

test("a row that holds a grapheme outside printable ASCII is rewritten whole when any cell in it changes", () => {
  const screen = createScreen();
  screen.render([[span(0, "中文 name-a")]], size(20, 1));
  assert.equal(screen.render([[span(0, "中文 name-b")]], size(20, 1)), update(`${CSI}1;1H中文 name-b${CSI}K`));
  // Also when the character is only in the row being replaced.
  assert.equal(screen.render([[span(0, "plain name-b")]], size(20, 1)), update(`${CSI}1;1Hplain name-b${CSI}K`));
});

test("a row whose text got shorter is erased from the end of what is left", () => {
  const screen = createScreen();
  screen.render([[span(0, "long text here")]], size(20, 1));
  assert.equal(screen.render([[span(0, "long")]], size(20, 1)), update(`${CSI}1;5H${CSI}K`));
  assert.equal(screen.render([[]], size(20, 1)), update(`${CSI}1;1H${CSI}K`));
});

test("a full redraw clears first, and so does a change of size", () => {
  const screen = createScreen();
  const rows = [[span(0, "oats")]];
  screen.render(rows, size(10, 2));
  assert.equal(screen.render(rows, size(10, 2), { full: true }), whole(`${CSI}1;1Hoats${CSI}K`));
  assert.equal(screen.render(rows, size(12, 2)), whole(`${CSI}1;1Hoats${CSI}K`));
  assert.equal(screen.render(rows, size(12, 2)), "");
});

test("text is clipped to its row with the ellipsis mark, in UTF-8 and in ASCII", () => {
  const long = [[span(0, "abcdefghijklmnop")]];
  assert.equal(createScreen().render(long, size(8, 1)), whole(`${CSI}1;1Habcdefg…`));
  assert.equal(createScreen({ utf8: true, ascii: true }).render(long, size(8, 1)), whole(`${CSI}1;1Habcde...`));
  assert.equal(createScreen().render([[span(5, "abcdef")]], size(8, 1)), whole(`${CSI}1;1H     ab…`));
  assert.equal(createScreen().render([[span(9, "off the row")]], size(8, 1)), whole(``), "a span that starts past the edge writes nothing");
});

test("a span is clipped to its own width, and the next span is not pushed", () => {
  const bytes = createScreen().render([[span(0, "a very long name", undefined, 8), span(10, "idle")]], size(20, 1));
  assert.equal(bytes, whole(`${CSI}1;1Ha very …  idle${CSI}K`));
});

test("a two-cell grapheme takes two cells, is never cut in half, and one overwritten half blanks the other", () => {
  assert.equal(createScreen().render([[span(0, "中文"), span(5, "x")]], size(8, 1)), whole(`${CSI}1;1H中文 x${CSI}K`));
  // Three cells left for two wide characters: one fits before the mark, not one and a half.
  assert.equal(createScreen().render([[span(5, "中文字")]], size(8, 1)), whole(`${CSI}1;1H     中…`));
  assert.equal(createScreen().render([[span(0, "中文"), span(1, "x")]], size(8, 1)), whole(`${CSI}1;1H x文${CSI}K`));
});

test("when the locale is not UTF-8 every non-ASCII grapheme of content is written as ?, one cell each", () => {
  const screen = createScreen(glyphs({ LANG: "C" }));
  const bytes = screen.render([[{ col: 0, text: shown("café 中文 \u{1F600}") }]], size(16, 1));
  assert.equal(bytes, whole(`${CSI}1;1Hcaf? ?? ?${CSI}K`));
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
  assert.equal(screen.render([[{ col: 0, text: real }]], size(10, 1)), whole(`${CSI}1;1Hoats${CSI}K`));
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
  const frames = [
    screen.render([[span(0, "oats", style({ bold: true, fg: "brightCyan" }))], [span(0, "─".repeat(30), style({ dim: true }))], [{ col: 2, text: shown("café 中文") }]], size(30, 3)),
    screen.render([[span(0, "oats")], [], [{ col: 0, text: shown("x".repeat(100)) }]], size(30, 3)),
  ];
  // The 2026 pair is each frame's two ends (inside() holds it there); between them, the list.
  const { sequences, foreign } = readTerminalOutput(frames.map(inside).join(""));
  assert.deepEqual(foreign, []);
  assert.deepEqual([...new Set(sequences.map((s) => s.kind))].sort(), ["erase", "position", "sgr"], "a frame with no cursor switches no mode: hiding it is the guard's");
});

// ── The fill span and the cell buffer ────────────────────────────────────────────────────────────

const REVERSE = style({ reverse: true });
/** A fill: no text, a width, a style. */
const fill = (col, width, look) => ({ col, width, ...(look ? { style: look } : {}) });
const texts = (line) => line.map((cell) => cell.text).join("");

test("a fill, a span with a width and no text, paints blank cells in its style: the bytes carry the style over the spaces", () => {
  assert.equal(createScreen().render([[fill(2, 3, REVERSE)]], size(8, 1)), whole(`${CSI}1;1H  ${CSI}0;7m   ${CSI}0m${CSI}K`));
  assert.equal(createScreen().render([[fill(0, 2, style({ underline: true }))]], size(8, 1)), whole(`${CSI}1;1H${CSI}0;4m  ${CSI}0m${CSI}K`));
  assert.equal(createScreen().render([[fill(0, 8, REVERSE)]], size(8, 1)), whole(`${CSI}1;1H${CSI}0;7m        ${CSI}0m`), "a bar over the whole row, and no erase after the last column");
  assert.equal(createScreen({ color: false }).render([[fill(1, 2, style({ reverse: true, fg: "red" }))]], size(4, 1)), whole(`${CSI}1;1H ${CSI}0;7m  ${CSI}0m${CSI}K`), "without colour the bar is still a bar");
  const [line] = createScreen().cells([[fill(2, 3, REVERSE)]], size(8, 1));
  assert.equal(texts(line), "        ");
  assert.deepEqual(line.map((cell) => cell.style === REVERSE), [false, false, true, true, true, false, false, false]);
  assert.deepEqual(line.map((cell) => cell.width), [1, 1, 1, 1, 1, 1, 1, 1]);
});

test("a fill in a style that draws nothing on a blank writes nothing, and a fill blanks the text under it", () => {
  assert.equal(createScreen().render([[fill(0, 4)]], size(8, 1)), whole(``), "plain blanks are the cleared screen");
  assert.equal(createScreen().render([[fill(0, 4, style({ bold: true, fg: "red" }))]], size(8, 1)), whole(``), "bold red blanks show nothing");
  assert.equal(createScreen().render([[span(0, "abcdef"), fill(2, 2)]], size(8, 1)), whole(`${CSI}1;1Hab  ef${CSI}K`));
  assert.equal(createScreen().render([[span(0, "abcdef"), fill(0, 0, REVERSE)]], size(8, 1)), whole(`${CSI}1;1Habcdef${CSI}K`), "a fill of no cells paints none");
});

test("later spans draw over a fill: text on a bar keeps the style it was given, and the bar shows between and after it", () => {
  const rows = [[fill(0, 6, REVERSE), span(1, "ab", REVERSE), span(4, "x")]];
  assert.equal(createScreen().render(rows, size(8, 1)), whole(`${CSI}1;1H${CSI}0;7m ab ${CSI}0mx${CSI}0;7m ${CSI}0m${CSI}K`));
  const [line] = createScreen().cells(rows, size(8, 1));
  assert.equal(texts(line), " ab x   ");
  assert.deepEqual(line.map((cell) => cell.style.reverse), [true, true, true, true, false, true, false, false]);
  // And a fill drawn later covers what was there.
  assert.equal(texts(createScreen().cells([[span(0, "abcdef"), fill(1, 3, REVERSE)]], size(8, 1))[0]), "a   ef  ");
});

test("a fill past the right edge is clipped: nothing is painted past the last column", () => {
  assert.equal(createScreen().render([[fill(6, 10, REVERSE)]], size(8, 1)), whole(`${CSI}1;1H      ${CSI}0;7m  ${CSI}0m`));
  assert.equal(createScreen().render([[fill(8, 3, REVERSE)]], size(8, 1)), whole(``), "a fill that starts at the edge paints nothing");
  assert.equal(createScreen().render([[fill(40, 3, REVERSE)]], size(8, 1)), whole(``));
  const cells = createScreen().cells([[fill(6, 10, REVERSE)], [fill(0, 3000, REVERSE)]], size(8, 2));
  assert.deepEqual(cells.map((line) => line.length), [8, 8]);
  assert.deepEqual(cells[0].map((cell) => cell.style.reverse), [false, false, false, false, false, false, true, true]);
  assert.deepEqual(cells[1].map((cell) => cell.style.reverse), Array.from({ length: 8 }, () => true));
});

test("a fill over one half of a two-cell grapheme blanks the other half", () => {
  assert.equal(createScreen().render([[span(0, "中文"), fill(1, 1, REVERSE)]], size(8, 1)), whole(`${CSI}1;1H ${CSI}0;7m ${CSI}0m文${CSI}K`));
  assert.equal(createScreen().render([[span(0, "中文"), fill(2, 1, REVERSE)]], size(8, 1)), whole(`${CSI}1;1H中${CSI}0;7m ${CSI}0m${CSI}K`));
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
  assert.equal(screen.render([[fill(0, 1, REVERSE)]], size(4, 1)), whole(`${CSI}1;1H${CSI}0;7m ${CSI}0m${CSI}K`));
});

test("a row that changes only in a fill is rewritten like any other: a bar that moves from one row to the next", () => {
  const screen = createScreen(), frame = (selected) => [0, 1, 2].map((r) => [...(r === selected ? [fill(0, 6, REVERSE)] : []), span(1, `row ${r}`, r === selected ? REVERSE : undefined)]);
  screen.render(frame(0), size(8, 3));
  assert.equal(screen.render(frame(0), size(8, 3)), "", "the same frame writes nothing");
  const moved = screen.render(frame(1), size(8, 3));
  assert.equal(moved, update(`${CSI}1;1H row 0${CSI}K${CSI}2;1H${CSI}0;7m row 1${CSI}0m${CSI}K`));
  const { foreign, sequences } = readTerminalOutput(inside(moved));
  assert.deepEqual(foreign, []);
  assert.deepEqual(sequences.filter((s) => s.kind === "position").map((s) => s.body), ["1;1H", "2;1H"], "the two rows that changed, and not the third");
});

test("a span drawn after the text before it follows that text as drawn: back over what a cut, or ? without UTF-8, left blank of its width; else at its column", () => {
  const after = (col, text) => ({ ...span(col, text, undefined, 1), after: true });
  // Wide characters cut at 4 cells: 中 and the mark take 3, so the ! moves back 1.
  assert.equal(createScreen().render([[span(0, "中文字", undefined, 4), after(5, "!")]], size(10, 1)), whole(`${CSI}1;1H中… !${CSI}K`));
  assert.equal(createScreen(glyphs({ LANG: "C" })).render([[{ col: 0, text: shown("中文"), width: 4 }, after(5, "!")]], size(10, 1)), whole(`${CSI}1;1H?? !${CSI}K`));
  assert.equal(createScreen().render([[span(0, "abc", undefined, 3), after(4, "!")]], size(10, 1)), whole(`${CSI}1;1Habc !${CSI}K`), "text that fills its width: at its column");
  assert.equal(createScreen().render([[span(0, "abc", undefined, 6), span(8, "x"), after(9, "!")]], size(12, 1)), whole(`${CSI}1;1Habc     x!${CSI}K`), "only the span just before counts, and one with no width leaves nothing blank");
  assert.equal(createScreen().render([[fill(0, 6, REVERSE), after(3, "!")]], size(8, 1)).includes("!"), true, "after a fill, at its column");
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
  assert.equal(screen.render(rows, size(6, 2)), whole(`${CSI}1;1Hoats${CSI}K${CSI}2;1H 中x${CSI}K`), "asking for the cells is not drawing them");
  // Cells of the same frame, of another frame and of another size, between two renders.
  screen.cells(rows, size(6, 2));
  screen.cells([[span(0, "other")], [fill(0, 6, REVERSE)]], size(6, 2));
  screen.cells([[span(0, "other")]], size(40, 10));
  assert.equal(screen.render(rows, size(6, 2)), "", "render, cells, render again of the same rows writes nothing");
  // And the next change is a difference from the frame that was rendered, not from what cells() was asked.
  screen.cells([[span(0, "oats")], [span(1, "中y")]], size(6, 2));
  assert.equal(screen.render([[span(0, "oats")], [span(1, "中y")]], size(6, 2)), update(`${CSI}2;1H 中y${CSI}K`));
  screen.cells([[span(0, "boats")]], size(6, 2));
  assert.equal(screen.render([[span(0, "oats")], [span(1, "中y")]], size(6, 2)), "");
});

// ── Synchronized output, the cursor, and the agent's own styles ──────────────────────────────────

test("every frame that writes anything is one synchronized update, set at its start and reset at its end, and a frame with nothing to change writes nothing at all", () => {
  const screen = createScreen(), rows = (word) => [[span(0, word)], [span(2, "x")]];
  const frames = [
    screen.render(rows("oats"), size(10, 2)),
    screen.render(rows("oats"), size(10, 2)),
    screen.render(rows("boats"), size(10, 2)),
    screen.render(rows("boats"), size(10, 2), { full: true }),
    screen.render(rows("boats"), size(12, 2)),
    screen.render(rows("boats"), size(12, 2), { cursor: { row: 0, col: 0 } }),
    screen.render(rows("boats"), size(12, 2), { cursor: { row: 0, col: 0 } }),
    screen.render(rows("boats"), size(12, 2)),
    screen.render([[], []], size(12, 2)),
  ];
  assert.deepEqual(frames.map((bytes) => bytes === ""), [false, true, false, false, false, false, true, false, false]);
  for (const bytes of frames.filter((b) => b !== "")) {
    inside(bytes);
    assert.equal(bytes.split(BEGIN).length - 1, 1, "one set");
    assert.equal(bytes.split(END).length - 1, 1, "one reset");
  }
});

test("a cursor is placed at its cell after every row and shown; moving it, or writing a row, places it again; a frame without one hides it once", () => {
  const screen = createScreen(), rows = (word) => [[span(0, word)], [], [span(0, "end")]];
  assert.equal(screen.render(rows("oats"), size(10, 3), { cursor: { row: 1, col: 4 } }), update(`${CSI}0m${CSI}2J${CSI}1;1Hoats${CSI}K${CSI}3;1Hend${CSI}K${CSI}2;5H${SHOW}`));
  assert.equal(screen.render(rows("oats"), size(10, 3), { cursor: { row: 1, col: 4 } }), "", "the same frame and the same cursor write nothing");
  assert.equal(screen.render(rows("oats"), size(10, 3), { cursor: { row: 2, col: 9 } }), update(`${CSI}3;10H`), "a cursor that only moved is a frame of its own: its position, and no show again");
  assert.equal(screen.render(rows("boats"), size(10, 3), { cursor: { row: 2, col: 9 } }), update(`${CSI}1;1Hboats${CSI}K${CSI}3;10H`), "a row write moved the terminal's cursor: it is placed again after the rows");
  assert.equal(screen.render(rows("boats"), size(10, 3)), update(HIDE), "no cursor after one: hidden");
  assert.equal(screen.render(rows("boats"), size(10, 3), { cursor: null }), "", "and hidden it stays, with nothing written");
  assert.equal(screen.render(rows("boats"), size(10, 3), { cursor: { row: 0, col: 0 } }), update(`${CSI}1;1H${SHOW}`));
  assert.equal(screen.render(rows("boats"), size(10, 3), { cursor: { row: 3, col: 0 } }), update(HIDE), "a cursor outside the size is hidden");
  assert.equal(screen.render(rows("boats"), size(10, 3), { cursor: { row: 0, col: 10 } }), "", "past the last column too");
});

test("a full frame, a first frame and a new size show a given cursor again; a frame hides the cursor only after this screen showed it, since ENTER, the guard's, hid it", () => {
  const screen = createScreen(), rows = [[span(0, "oats")]];
  assert.equal(screen.render(rows, size(10, 2)), whole(`${CSI}1;1Hoats${CSI}K`), "the first frame says nothing of a cursor it does not show");
  assert.equal(screen.render(rows, size(10, 2), { full: true }), whole(`${CSI}1;1Hoats${CSI}K`));
  assert.equal(screen.render(rows, size(10, 2), { full: true, cursor: { row: 0, col: 4 } }), update(`${CSI}0m${CSI}2J${CSI}1;1Hoats${CSI}K${CSI}1;5H${SHOW}`));
  assert.equal(screen.render(rows, size(10, 2), { full: true, cursor: { row: 0, col: 4 } }), update(`${CSI}0m${CSI}2J${CSI}1;1Hoats${CSI}K${CSI}1;5H${SHOW}`), "shown already, and shown again");
  assert.equal(screen.render(rows, size(11, 2), { cursor: { row: 1, col: 0 } }), update(`${CSI}0m${CSI}2J${CSI}1;1Hoats${CSI}K${CSI}2;1H${SHOW}`));
  assert.equal(screen.render(rows, size(11, 2), { full: true }), update(`${CSI}0m${CSI}2J${CSI}1;1Hoats${CSI}K${HIDE}`), "shown before: hidden now");
  assert.equal(screen.render(rows, size(11, 2), { full: true }), whole(`${CSI}1;1Hoats${CSI}K`), "and hidden it stays");
});

test("a cursor that is not null or { row, col } of whole cells is refused, and nothing of the refused frame is kept", () => {
  const screen = createScreen(), rows = [[span(0, "oats")]];
  for (const cursor of [{ row: 1 }, { row: 0.5, col: 0 }, { row: "0", col: 0 }, 3, "home", [0, 0]]) assert.throws(() => screen.render(rows, size(10, 2), { cursor }), TypeError, JSON.stringify(cursor));
  assert.equal(screen.render(rows, size(10, 2)), whole(`${CSI}1;1Hoats${CSI}K`), "the next frame is still the first one");
  assert.throws(() => screen.render(rows, size(10, 2), { cursor: { row: 0, col: NaN } }), TypeError);
  assert.equal(screen.render(rows, size(10, 2)), "", "and the frame before it is what is remembered");
});

const agentSpan = (col, text, look) => ({ col, text: cellText(text), style: look });

test("an agent's style is written as a reset and its own parameters, 256-colour and RGB ones whole, and without colour its colours, foreground and background, are dropped", () => {
  const look = agentStyle({ bold: true, italic: true, fg: { index: 208 }, bg: { rgb: [1, 2, 3] } });
  assert.equal(createScreen().render([[agentSpan(0, "hi", look)]], size(4, 1)), whole(`${CSI}1;1H${CSI}0;1;3;38;5;208;48;2;1;2;3mhi${CSI}0m${CSI}K`));
  assert.equal(createScreen({ color: false }).render([[agentSpan(0, "hi", look)]], size(4, 1)), whole(`${CSI}1;1H${CSI}0;1;3mhi${CSI}0m${CSI}K`));
  const sixteen = agentStyle({ fg: { ansi: 9 }, bg: { ansi: 4 }, underline: true, strikethrough: true });
  assert.equal(createScreen().render([[agentSpan(0, "a", sixteen), agentSpan(1, "b", agentStyle({ fg: { ansi: 1 } }))]], size(2, 1)), whole(`${CSI}1;1H${CSI}0;4;9;91;44ma${CSI}0;31mb${CSI}0m`));
  // And an agent's cells keep their spaces: a terminal's layout is its spaces.
  assert.equal(createScreen().render([[agentSpan(0, "a  b", PLAIN)]], size(6, 1)), whole(`${CSI}1;1Ha  b${CSI}K`));
});

test("a space shows in a style that paints a blank, a background, reverse video, an underline or a strikethrough; without colour a background alone does not", () => {
  const bg = agentStyle({ bg: { index: 17 } });
  assert.equal(createScreen().render([[agentSpan(1, "  ", bg)]], size(6, 1)), whole(`${CSI}1;1H ${CSI}0;48;5;17m  ${CSI}0m${CSI}K`));
  assert.equal(createScreen({ color: false }).render([[agentSpan(1, "  ", bg)]], size(6, 1)), whole(), "no colour: a background is not written, so its spaces are blanks");
  assert.equal(createScreen({ color: false }).render([[agentSpan(1, "  ", agentStyle({ bg: { ansi: 2 }, reverse: true }))]], size(6, 1)), whole(`${CSI}1;1H ${CSI}0;7m  ${CSI}0m${CSI}K`), "reverse still shows");
  for (const [name, look] of [["reverse", agentStyle({ reverse: true })], ["underline", agentStyle({ underline: true })], ["strikethrough", agentStyle({ strikethrough: true })]]) {
    assert.match(createScreen({ color: false }).render([[agentSpan(0, " ", look)]], size(3, 1)), /\x1b\[1;1H\x1b\[0;\dm \x1b\[0m/, name);
  }
  for (const look of [agentStyle({ bold: true }), agentStyle({ italic: true, fg: { rgb: [9, 9, 9] } }), agentStyle({ invisible: true }), agentStyle({ blink: true })]) {
    assert.equal(createScreen().render([[agentSpan(0, "   ", look)]], size(4, 1)), whole(), "a style that paints nothing on a blank: nothing to write");
  }
  // A fill in an agent's background colour is a bar like any other.
  assert.equal(createScreen().render([[{ col: 0, width: 2, style: bg }]], size(4, 1)), whole(`${CSI}1;1H${CSI}0;48;5;17m  ${CSI}0m${CSI}K`));
  // The cells say which style each is, and a frame drawn twice writes nothing the second time.
  const screen = createScreen(), rows = [[agentSpan(0, "ab", bg)]];
  screen.render(rows, size(4, 1));
  assert.equal(screen.render([[agentSpan(0, "ab", agentStyle({ bg: { index: 17 } }))]], size(4, 1)), "", "an equal agent style is the same value");
});
