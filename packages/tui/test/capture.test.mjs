import test from "node:test";
import assert from "node:assert/strict";
import { captureRows } from "../lib/term/capture.mjs";
import { PLAIN, agentStyle, isStyle } from "../lib/term/style.mjs";
import { cellText, isSafeText, textOf } from "../lib/term/text.mjs";
import { REPLACEMENT } from "../lib/term/width.mjs";

const ESC = "\x1b", CSI = `${ESC}[`, ST = `${ESC}\\`, BEL = "\x07";
/** A row's spans as `[col, text, width, style]`, to compare whole. */
const view = (row) => row.map((span) => [span.col, textOf(span.text), span.width, span.style]);
/** The one row of a one-row capture, `cols` wide. */
const one = (text, cols = 20) => view(captureRows(text, { cols, rows: 1 })[0]);
/** The style an SGR leaves for the character after it. */
const after = (params) => one(`${CSI}${params}mx`)[0][3];
const A = agentStyle;

test("a capture is exactly `rows` rows, the capture's first ones: fewer give empty rows after them, more are dropped, and the newline that ends the last row is no row of its own", () => {
  assert.deepEqual(captureRows("a\nb\n", { cols: 4, rows: 4 }).map(view), [[[0, "a", 1, PLAIN]], [[0, "b", 1, PLAIN]], [], []]);
  assert.deepEqual(captureRows("a\nb\nc\nd\n", { cols: 4, rows: 2 }).map(view), [[[0, "a", 1, PLAIN]], [[0, "b", 1, PLAIN]]]);
  assert.deepEqual(captureRows("a\n\nc", { cols: 4, rows: 3 }).map(view), [[[0, "a", 1, PLAIN]], [], [[0, "c", 1, PLAIN]]], "an empty row inside is a row; a last row with no newline is one");
  assert.deepEqual(captureRows("", { cols: 4, rows: 2 }).map(view), [[], []]);
  assert.deepEqual(captureRows("\n\n", { cols: 4, rows: 3 }).map(view), [[], [], []]);
  assert.deepEqual(captureRows("abc", { cols: 0, rows: 1 }).map(view), [[]], "a panel of no columns holds no cell");
  assert.deepEqual(captureRows("abc", { cols: 3, rows: 0 }), []);
  const rows = captureRows("a\nb", { cols: 2, rows: 2 });
  assert.equal(Object.isFrozen(rows) && rows.every(Object.isFrozen) && rows.flat().every(Object.isFrozen), true);
});

test("the size is a number of cells and the capture a string: anything else is refused", () => {
  for (const size of [{ cols: -1, rows: 1 }, { cols: 1.5, rows: 1 }, { cols: 1, rows: "2" }, { cols: 1 }, { rows: 1 }]) assert.throws(() => captureRows("a", size), RangeError, JSON.stringify(size));
  for (const text of [null, undefined, 1, Buffer.from("a"), ["a"]]) assert.throws(() => captureRows(text, { cols: 1, rows: 1 }), TypeError);
});

test("a row is spans of `{ col, text, style, width }`: one per run of one style, at the column it takes, safe text of the agent's cells with its spaces kept", () => {
  const [row] = captureRows(`ab  cd${CSI}1m ef${CSI}0m  gh`, { cols: 20, rows: 1 });
  assert.deepEqual(view(row), [[0, "ab  cd", 6, PLAIN], [7, "ef", 2, A({ bold: true })], [11, "gh", 2, PLAIN]], "a bold space shows nothing, and is the screen's blank");
  for (const span of row) {
    assert.deepEqual(Object.keys(span), ["col", "text", "style", "width"]);
    assert.equal(isSafeText(span.text), true);
    assert.equal(isStyle(span.style), true);
  }
  assert.deepEqual(one("   x   "), [[3, "x", 1, PLAIN]], "blanks at the ends of a style that paints nothing need no span");
  assert.deepEqual(one("      "), [], "nor does a row of them");
  assert.deepEqual(one(`a${CSI}1m${CSI}0mb`), [[0, "ab", 2, PLAIN]], "an SGR that changes nothing does not cut a span");
});

test("a run of blanks that shows is kept: a background, reverse video, an underline, a strikethrough", () => {
  assert.deepEqual(one(`${CSI}44m   ${CSI}49m x`), [[0, "   ", 3, A({ bg: { ansi: 4 } })], [4, "x", 1, PLAIN]]);
  assert.deepEqual(one(`a${CSI}48;5;208m  ${CSI}0m`), [[0, "a", 1, PLAIN], [1, "  ", 2, A({ bg: { index: 208 } })]]);
  for (const [params, state] of [["7", { reverse: true }], ["4", { underline: true }], ["9", { strikethrough: true }], ["48;2;1;2;3", { bg: { rgb: [1, 2, 3] } }]]) {
    assert.deepEqual(one(`${CSI}${params}m  `), [[0, "  ", 2, A(state)]], params);
  }
  for (const params of ["1", "2", "3", "5", "8", "31", "38;5;9"]) assert.deepEqual(one(`${CSI}${params}m  `), [], params);
});

test("each SGR parameter of the allowlist makes its state: the eight attributes, their resets, the sixteen colours both ways, 256 and RGB in both forms, and the defaults", () => {
  const cases = [
    ["1", { bold: true }], ["2", { dim: true }], ["3", { italic: true }], ["4", { underline: true }], ["5", { blink: true }], ["6", { blink: true }],
    ["7", { reverse: true }], ["8", { invisible: true }], ["9", { strikethrough: true }],
    ["4:1", { underline: true }], ["4:2", { underline: true }], ["4:3", { underline: true }], ["4:4", { underline: true }], ["4:5", { underline: true }], ["4;4:0", {}],
    ["1;2;3;21", { dim: true, italic: true }], ["1;2;22", {}], ["3;23", {}], ["4;24", {}], ["4:3;24", {}], ["5;25", {}], ["7;27", {}], ["8;28", {}], ["9;29", {}],
    ["31", { fg: { ansi: 1 } }], ["37", { fg: { ansi: 7 } }], ["90", { fg: { ansi: 8 } }], ["97", { fg: { ansi: 15 } }],
    ["40", { bg: { ansi: 0 } }], ["47", { bg: { ansi: 7 } }], ["100", { bg: { ansi: 8 } }], ["107", { bg: { ansi: 15 } }],
    ["31;39", {}], ["41;49", {}], ["31;41;39", { bg: { ansi: 1 } }],
    ["38;5;208", { fg: { index: 208 } }], ["48;5;0", { bg: { index: 0 } }], ["38;5;255", { fg: { index: 255 } }],
    ["38;2;1;2;3", { fg: { rgb: [1, 2, 3] } }], ["48;2;255;0;255", { bg: { rgb: [255, 0, 255] } }],
    ["38:5:208", { fg: { index: 208 } }], ["48:5:17", { bg: { index: 17 } }],
    ["38:2::1:2:3", { fg: { rgb: [1, 2, 3] } }], ["38:2:1:2:3", { fg: { rgb: [1, 2, 3] } }], ["48:2:0:9:8:7", { bg: { rgb: [9, 8, 7] } }],
    ["1;3;38;5;208;48;2;1;2;3", { bold: true, italic: true, fg: { index: 208 }, bg: { rgb: [1, 2, 3] } }],
    ["001;031", { bold: true, fg: { ansi: 1 } }],
    ["1;0", {}], ["1;", {}], [";1", { bold: true }], ["", {}],
  ];
  for (const [params, state] of cases) assert.equal(after(params), A(state), params);
  assert.equal(one(`${CSI}1;31mx${CSI}my`)[1][3], PLAIN, "CSI m is a reset");
  // Cumulative: each SGR adds to the state the last one left.
  assert.deepEqual(one(`${CSI}1ma${CSI}31mb${CSI}44mc${CSI}22md`).map((s) => s[3]), [A({ bold: true }), A({ bold: true, fg: { ansi: 1 } }), A({ bold: true, fg: { ansi: 1 }, bg: { ansi: 4 } }), A({ fg: { ansi: 1 }, bg: { ansi: 4 } })]);
});

test("any other SGR parameter is dropped and the rest of the list still applies: underline colour, fonts, frames, overline, unknown numbers, numbers too long", () => {
  for (const params of ["58;5;3", "58;2;1;2;3", "58;5;256", "58:5:3", "58:2::1:2:3", "59", "10", "11", "20", "26", "51", "52", "53", "54", "55", "60", "65", "73", "74", "75", "108", "1000", "0001", "256", "4:6", "4:1:2", "5:3", "38:5", "38:5:256", "38:2:1:2", "38:2:1:2:256", "38:9:1", "1:1"]) {
    assert.equal(after(`${params};3`), A({ italic: true }), params);
  }
  assert.equal(after("3;58;5;3;1"), A({ italic: true, bold: true }), "58;5;n is dropped whole, as tmux writes the underline's colour: its 5 is no blink");
  assert.equal(after("1;58;7;4;3"), A({ bold: true }), "and a 58 of no known form drops the rest, as a 38 does");
});

test("a malformed extended colour consumes what its selector claims, so its values are never read as attributes; a selector of no known form drops the rest of the list", () => {
  assert.equal(after("38;5;256;1"), A({ bold: true }), "5 claims one value: 256 is out of range, dropped, and the 1 after it is bold");
  assert.equal(after("48;5;;3"), A({ bg: { index: 0 }, italic: true }), "an empty value is 0, as an empty parameter is");
  assert.equal(after("38;5;1000;3"), A({ italic: true }));
  assert.equal(after("38;2;1;2;300;3"), A({ italic: true }), "2 claims three values: one out of range drops the colour, and the 3 after them is italic");
  assert.equal(after("38;2;1;2;3;4"), A({ fg: { rgb: [1, 2, 3] }, underline: true }));
  assert.equal(after("38;2;1;2"), PLAIN, "fewer values than claimed: nothing is set");
  assert.equal(after("38;5"), PLAIN);
  assert.equal(after("1;38"), A({ bold: true }), "a 38 that ends the list sets nothing, and what came before stays");
  for (const selector of ["3", "4", "1", "0", "", "6", "99", "1000"]) assert.equal(after(`1;38;${selector};4;3`), A({ bold: true }), `38;${selector}: the rest is unreadable, and dropped`);
  assert.equal(after("1;48;7;4;3"), A({ bold: true }));
  assert.equal(one(`${CSI}38;3;1;1mx${CSI}4my`)[1][3], A({ underline: true }), "and only the rest of that one sequence: the next SGR is read");
});

test("an SGR's look-alikes are not SGRs: a private marker, an intermediate byte, and the 8-bit CSI are dropped whole, their style with them", () => {
  for (const sequence of [`${CSI}>4;1m`, `${CSI}?1m`, `${CSI}=1m`, `${CSI}<1m`, `${CSI}1 m`, `${CSI}1$m`, "\u009b1m", "\u009b31;1m"]) assert.deepEqual(one(`a${sequence}b`), [[0, "ab", 2, PLAIN]], JSON.stringify(sequence));
});

test("every other sequence is dropped whole: CSI, OSC to BEL and to ST, DCS, SOS, PM, APC, an ESC and one byte, an ESC with intermediates, and the 8-bit forms", () => {
  const dropped = [
    `${CSI}2J`, `${CSI}10;20H`, `${CSI}K`, `${CSI}?1049h`, `${CSI}?25l`, `${CSI}6n`, `${CSI}0c`, `${CSI}>0q`, `${CSI}2 q`, `${CSI}1;2;3;4;5;6;7;8;9;10t`, `${CSI}31@`,
    `${ESC}]0;a title${BEL}`, `${ESC}]2;title${ST}`, `${ESC}]8;;https://example.com${ST}`, `${ESC}]8;;${ST}`, `${ESC}]52;c;b3duZWQ=${BEL}`, `${ESC}]0;t\u009c`,
    `${ESC}P1$r0m${ST}`, `${ESC}Pq#0;2;0;0;0${ST}`, `${ESC}Xsos${ST}`, `${ESC}^pm${ST}`, `${ESC}_apc${ST}`, `${ESC}_Gf=24;AAAA${ST}`,
    `${ESC}c`, `${ESC}7`, `${ESC}8`, `${ESC}=`, `${ESC}>`, `${ESC}M`, `${ESC}D`, `${ESC}E`, `${ESC}H`, `${ESC}N`, `${ESC}O`, `${ESC}\\`,
    `${ESC}(B`, `${ESC})0`, `${ESC}(0`, `${ESC}#8`, `${ESC} F`, `${ESC}%G`,
    "\u009b2J", "\u009b?1049h", "\u009d0;title\x07", "\u009d0;title\u009c", "\u0090q\u009c", "\u0098s\u009c", "\u009ep\u009c", "\u009fa\u009c",
  ];
  for (const sequence of dropped) assert.deepEqual(one(`ab${sequence}cd`), [[0, "abcd", 4, PLAIN]], JSON.stringify(sequence));
  // The text a link names is the agent's, and is kept; the link is not.
  assert.deepEqual(one(`${ESC}]8;;http://x.y${ST}link${ESC}]8;;${ST} after`), [[0, "link after", 10, PLAIN]]);
});

test("a control string ends where its terminator is, or at an ESC that starts something else, and a byte that cannot be in a CSI ends the CSI before it", () => {
  assert.deepEqual(one(`a${ESC}]0;x${CSI}1mb`), [[0, "a", 1, PLAIN], [1, "b", 1, A({ bold: true })]], "the OSC ends at the ESC; the SGR after it is read");
  assert.deepEqual(one(`a${ESC}Pdata${ESC}7b`), [[0, "ab", 2, PLAIN]]);
  assert.deepEqual(one(`a${ESC}]0;x${BEL}${BEL}b`), [[0, "ab", 2, PLAIN]]);
  assert.deepEqual(one(`a${ESC}Px${BEL}y${ST}b`), [[0, "ab", 2, PLAIN]], "BEL ends only an OSC");
  assert.deepEqual(one(`a${CSI}1\x01mb`), [[0, "amb", 3, PLAIN]], "a control in a CSI ends it, and is dropped itself");
  assert.deepEqual(one(`a${CSI}1éb`), [[0, "aéb", 3, PLAIN]], "a character in a CSI ends it, and is the agent's text");
  assert.deepEqual(one(`a${ESC}\x01b`), [[0, "ab", 2, PLAIN]], "an ESC before a control is dropped alone");
  assert.deepEqual(one(`a${ESC}éb`), [[0, "aéb", 3, PLAIN]]);
  assert.deepEqual(one(`a${ESC}${ESC}[1mb`), [[0, "a", 1, PLAIN], [1, "b", 1, A({ bold: true })]], "an ESC after an ESC starts again");
});

test("every control character is dropped, C0, DEL and C1, and so is every bidi control: a row cannot reorder what is drawn in it", () => {
  const starts = new Set([0x09, 0x0a, 0x1b, 0x90, 0x98, 0x9b, 0x9d, 0x9e, 0x9f]);
  const controls = [...Array.from({ length: 0x20 }, (_, n) => n), 0x7f, ...Array.from({ length: 0x20 }, (_, n) => 0x80 + n)].filter((n) => !starts.has(n));
  assert.equal(controls.length, 32 + 1 + 32 - starts.size);
  for (const n of controls) assert.deepEqual(one(`ab${String.fromCodePoint(n)}cd`), [[0, "abcd", 4, PLAIN]], `U+${n.toString(16)}`);
  for (const n of [0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]) {
    assert.deepEqual(one(`safe${String.fromCodePoint(n)}txt.exe`), [[0, "safetxt.exe", 11, PLAIN]], `U+${n.toString(16)}`);
  }
  assert.deepEqual(one("a\rb\bc\x00d\x07e"), [[0, "abcde", 5, PLAIN]]);
});

test("a tab moves to the next stop of eight and paints nothing, never past the last column", () => {
  assert.deepEqual(one("abcde\tX\tY"), [[0, "abcde", 5, PLAIN], [8, "X", 1, PLAIN], [16, "Y", 1, PLAIN]], "as tmux 3.7c answered for printf 'abcde\\tX\\tY'");
  assert.deepEqual(one("\ttab"), [[8, "tab", 3, PLAIN]]);
  assert.deepEqual(one(`${CSI}44mab\tc`), [[0, "ab", 2, A({ bg: { ansi: 4 } })], [8, "c", 1, A({ bg: { ansi: 4 } })]], "the cells a tab passes are blank");
  assert.deepEqual(one("a\t\tb", 10), [[0, "a", 1, PLAIN]], "the second stop is past the edge: the row is full");
  assert.deepEqual(one("abcdefgh\tx", 12), [[0, "abcdefgh", 8, PLAIN]]);
  assert.deepEqual(one("abcdefg\tx", 9), [[0, "abcdefg", 7, PLAIN], [8, "x", 1, PLAIN]]);
});

test("widths are width.mjs's, by grapheme: a wide character takes two cells, marks ride on their base, an emoji sequence is one grapheme, and the next one is set after it", () => {
  assert.deepEqual(one("漢字x"), [[0, "漢字x", 5, PLAIN]]);
  assert.deepEqual(one(`${CSI}31m漢${CSI}32m字x${CSI}39m`), [[0, "漢", 2, A({ fg: { ansi: 1 } })], [2, "字x", 3, A({ fg: { ansi: 2 } })]], "as tmux 3.7c writes a wide character: once, the next two cells on");
  assert.deepEqual(one("e\u0301a\u0308!"), [[0, "e\u0301a\u0308!", 3, PLAIN]]);
  assert.deepEqual(one("\u{1F468}\u200D\u{1F469}\u200D\u{1F467}x"), [[0, "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}x", 3, PLAIN]]);
  assert.deepEqual(one("\u{1F44D}\u{1F3FD}\u{1F1EF}\u{1F1F5}"), [[0, "\u{1F44D}\u{1F3FD}\u{1F1EF}\u{1F1F5}", 4, PLAIN]]);
  assert.deepEqual(one("a\u200Bb"), [[0, "ab", 2, PLAIN]], "a zero-width character standing alone takes no cell and is not written, as width.mjs has it");
  assert.deepEqual(one("a\x01\u0301"), [[0, "a\u0301", 1, PLAIN]], "with the control dropped, the mark is on its base");
});

test("a grapheme width.mjs replaces is its REPLACEMENT, one cell", () => {
  assert.deepEqual(one("a\uD800b"), [[0, `a${REPLACEMENT}b`, 3, PLAIN]], "a lone surrogate");
  assert.deepEqual(one("a\u2028b\u2029c"), [[0, `a${REPLACEMENT}b${REPLACEMENT}c`, 5, PLAIN]], "the line and paragraph separators");
  assert.deepEqual(one(`a${"\u0301".repeat(40)}b`), [[0, `${REPLACEMENT}b`, 2, PLAIN]], "a stack of marks too long to write");
});

test("a row holds at most `cols` cells: what is past the edge is dropped, never wrapped, and a wide character that would cross it is dropped with everything after it", () => {
  assert.deepEqual(one("abcdefghij", 4), [[0, "abcd", 4, PLAIN]]);
  assert.deepEqual(one("abc漢x", 4), [[0, "abc", 3, PLAIN]], "the wide one would take cells 3 and 4");
  assert.deepEqual(one("ab漢x", 4), [[0, "ab漢", 4, PLAIN]]);
  assert.deepEqual(one(`abc${CSI}44m  `, 4), [[0, "abc", 3, PLAIN], [3, " ", 1, A({ bg: { ansi: 4 } })]]);
  assert.deepEqual(captureRows("abcdefgh\nij", { cols: 4, rows: 2 }).map(view), [[[0, "abcd", 4, PLAIN]], [[0, "ij", 2, PLAIN]]], "the next row starts at its own column 0");
  const cells = (row) => row.reduce((sum, span) => sum + span.width, 0);
  for (const cols of [1, 2, 3, 5, 8]) for (const text of ["漢字漢字漢字", "a漢b字c漢", "\u{1F600}x\u{1F600}", `\t${CSI}7m  x  `]) {
    const [row] = captureRows(text, { cols, rows: 1 });
    assert.equal(row.every((span) => span.col + span.width <= cols), true, `${JSON.stringify(text)} in ${cols}`);
    assert.equal(cells(row) <= cols, true);
  }
});

test("a row cut in the middle of a sequence drops what was cut and keeps what came before it", () => {
  for (const cut of [ESC, `${CSI}`, `${CSI}1;3`, `${CSI}38;5;20`, `${CSI}?10`, `${CSI}1 `, `${ESC}]0;tit`, `${ESC}]8;;http://x`, `${ESC}]0;t${ESC}`, `${ESC}Pq#0`, `${ESC}_G`, `${ESC}(`, `${ESC} `, "\u009b1", "\u009d0;t"]) {
    assert.deepEqual(captureRows(`ab${cut}\nc`, { cols: 8, rows: 2 }).map(view), [[[0, "ab", 2, PLAIN]], [[0, "c", 1, PLAIN]]], JSON.stringify(cut));
  }
  assert.deepEqual(captureRows(`${CSI}1mab${CSI}0\nc`, { cols: 8, rows: 2 }).map(view), [[[0, "ab", 2, A({ bold: true })]], [[0, "c", 1, A({ bold: true })]]], "a cut reset resets nothing: the next row goes on bold");
});

test("the SGR state goes on from row to row, as tmux writes it, from plain at the first row", () => {
  // Measured on tmux 3.7c: printf '\033[1;44mabcdefghij\033[1;44mklm\033[0m' in a pane 10 wide.
  const bold = A({ bold: true, bg: { ansi: 4 } });
  assert.deepEqual(captureRows(`${CSI}1m${CSI}44mabcdefghij\nklm${CSI}0m       \n`, { cols: 10, rows: 2 }).map(view), [[[0, "abcdefghij", 10, bold]], [[0, "klm", 3, bold]]]);
  assert.deepEqual(captureRows(`${CSI}48;2;5;6;7m    \n${CSI}49m q`, { cols: 4, rows: 2 }).map(view), [[[0, "    ", 4, A({ bg: { rgb: [5, 6, 7] } })]], [[1, "q", 1, PLAIN]]]);
  assert.deepEqual(captureRows(`a${CSI}1m\nb`, { cols: 4, rows: 2 }).map(view), [[[0, "a", 1, PLAIN]], [[0, "b", 1, A({ bold: true })]]]);
  // Past the edge no character is kept, but the SGRs are still read for the rows after.
  assert.deepEqual(captureRows(`abcdefgh${CSI}3mxyz${CSI}31m\nq`, { cols: 4, rows: 2 }).map(view), [[[0, "abcd", 4, PLAIN]], [[0, "q", 1, A({ italic: true, fg: { ansi: 1 } })]]]);
  assert.deepEqual(captureRows(`漢字${CSI}4m\nq`, { cols: 3, rows: 2 }).map(view), [[[0, "漢", 2, PLAIN]], [[0, "q", 1, A({ underline: true })]]]);
  // And each capture starts plain: nothing is carried from one capture to the next.
  assert.deepEqual(captureRows("q", { cols: 4, rows: 1 }).map(view), [[[0, "q", 1, PLAIN]]]);
});

test("a capture as tmux 3.7c answered it is the agent's cells and styles, the sequences gone", () => {
  // printf '\033[1;31mred\033[0m \033[48;5;208m bg \033[0m漢字\n\033[1;3;38;2;10;20;30mcarry\nover\033[0m\n\033[4:3mcurly\033[0m \033[58;5;3m\033[4mulc\033[0m\n\033[44m          \033[0m x\033[7m  \033[0m'
  // in a pane 40 by 6, read with capture-pane -p -e -N.
  const capture = [
    `${CSI}1m${CSI}31mred${CSI}0m ${CSI}48;5;208m bg ${CSI}49m漢字         `,
    `${CSI}1;3m${CSI}38;2;10;20;30mcarry${CSI}0m               `,
    `${CSI}1;3m${CSI}38;2;10;20;30mover${CSI}0m                `,
    `${CSI}4:3mcurly${CSI}0m ${CSI}4m${CSI}58;5;3mulc${CSI}0m  `,
    `${CSI}44m          ${CSI}49m x${CSI}7m  ${CSI}0m      `,
    "",
  ].join("\n") + "\n";
  const rgb = A({ bold: true, italic: true, fg: { rgb: [10, 20, 30] } });
  assert.deepEqual(captureRows(capture, { cols: 40, rows: 6 }).map(view), [
    [[0, "red", 3, A({ bold: true, fg: { ansi: 1 } })], [4, " bg ", 4, A({ bg: { index: 208 } })], [8, "漢字", 4, PLAIN]],
    [[0, "carry", 5, rgb]],
    [[0, "over", 4, rgb]],
    [[0, "curly", 5, A({ underline: true })], [6, "ulc", 3, A({ underline: true })]],
    [[0, "          ", 10, A({ bg: { ansi: 4 } })], [11, "x", 1, PLAIN], [12, "  ", 2, A({ reverse: true })]],
    [],
  ]);
});

test("the text of every span passes cellText, so nothing capture.mjs lets through is a character it should have dropped", () => {
  const hostile = `${ESC}]0;\x07${CSI}31m\u202Eabc\u2066\x00\x7f\u0085\u009c${ESC}${CSI}?2026h\tdef\u061C${ESC}P${ST}${CSI}0m`;
  for (const span of captureRows(`${hostile}\n${hostile}`, { cols: 30, rows: 2 }).flat()) assert.equal(textOf(cellText(textOf(span.text))), textOf(span.text));
  assert.deepEqual(one(hostile, 30), [[0, "abc", 3, A({ fg: { ansi: 1 } })], [8, "def", 3, A({ fg: { ansi: 1 } })]]);
});

test("a hostile row of 10 000 characters is read in linear time, and holds at most `cols` cells", () => {
  const rows = {
    "SGRs": `${CSI}1;31;48;5;208mx${CSI}0m`.repeat(500),
    "SGRs that change the style each time": Array.from({ length: 800 }, (_, n) => `${CSI}38;2;${n & 255};${(n >> 8) & 255};9mx`).join(""),
    "a long SGR": `${CSI}${"1;".repeat(5000)}mx`,
    "wide characters": "漢".repeat(10000),
    "ESCs": `${ESC}a`.repeat(5000),
    "lone ESCs before text": `${ESC}é`.repeat(5000),
    "an unterminated CSI": `${CSI}${"1".repeat(10000)}`,
    "an unterminated OSC": `${ESC}]0;${"x".repeat(10000)}`,
    "OSCs ended by ESCs": `${ESC}]0;x`.repeat(2500),
    "tabs": "\t".repeat(10000),
    "marks on one base": `a${"\u0301".repeat(10000)}`,
    "zero-width characters": "\u200B".repeat(10000),
    "controls": "\x01\x7f\u0085\u202E".repeat(2500),
    "emoji": "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}".repeat(1250),
  };
  for (const [name, row] of Object.entries(rows)) {
    assert.equal(row.length >= 10000, true, name);
    for (const cols of [80, 300]) {
      const start = process.hrtime.bigint();
      const [spans] = captureRows(`${row}\n${row}`, { cols, rows: 2 });
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      assert.equal(ms < 200, true, `${name}: ${ms.toFixed(1)} ms`);
      assert.equal(spans.reduce((sum, span) => sum + span.width, 0) <= cols, true, name);
      assert.equal(spans.every((span) => span.col + span.width <= cols), true, name);
    }
  }
});
