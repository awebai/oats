// The one test the TUI's permission to exist rests on (awebai/oats#855, section 2, term 7):
// nothing a kernel, a repository, an agent or a remote host says can write a control sequence
// to the terminal. Keep it one test, through the real path: shown(), a view's rows, the
// screen, and the guard's writer into a captured stream.
import test from "node:test";
import assert from "node:assert/strict";
import { createScreen, glyphs } from "../lib/term/screen.mjs";
import { style } from "../lib/term/style.mjs";
import { lit, shown } from "../lib/term/text.mjs";
import { createGuard } from "../lib/term/tty.mjs";
import { fakeProcess, fakeStdin, fakeStdout, readTerminalOutput } from "./helpers.mjs";

const ESC = "\x1b", BEL = "\x07", ST = `${ESC}\\`;
/** Text as a hostile source might send it, by what it tries. Every row is drawn as a name would be. */
const FIXTURE = {
  "a lone ESC": `dev${ESC}`,
  "CSI colour": `${ESC}[31mred${ESC}[0m`,
  "CSI cursor moves": `${ESC}[H${ESC}[10;10H${ESC}[5A${ESC}[2Dmoved`,
  "CSI erase": `${ESC}[2J${ESC}[3J${ESC}[K${ESC}[1Kgone`,
  "CSI private modes": `${ESC}[?1049l${ESC}[?25h${ESC}[?1000h${ESC}[?2004l${ESC}[>1u`,
  "OSC 0, the title": `${ESC}]0;owned${BEL}`,
  "OSC 2, the title": `${ESC}]2;owned${ST}`,
  "OSC 8, a link": `${ESC}]8;;https://evil.example/${ST}click${ESC}]8;;${ST}`,
  "OSC 52, the clipboard": `${ESC}]52;c;cm0gLXJmIH4=${BEL}`,
  "DCS": `${ESC}P+q544e${ST}`,
  "a device query": `${ESC}[c${ESC}[6n${ESC}[>0q`,
  "the 8-bit CSI (U+009B)": "\u009B31mred\u009B2J",
  "the 8-bit OSC and ST (U+009D, U+009C)": "\u009D0;eightbit\u009C",
  "BEL": `ding${BEL}`,
  "BS": "ab\b\b\bxyz",
  "CR": "safe\rEVIL",
  "CRLF": "one\r\ntwo",
  "LF": "one\ntwo",
  "TAB": "one\ttwo",
  "DEL": "ab\x7f\x7f",
  "NUL": "ab\x00cd",
  "bidi embeddings (U+202A, U+202B, U+202C)": "a\u202Ab\u202Bc\u202Cd",
  "bidi overrides (U+202D, U+202E)": "safe\u202Etxt.exe\u202D",
  "bidi isolates (U+2066 to U+2069)": "a\u2066b\u2067c\u2068d\u2069e",
  "the zero-width space (U+200B)": "ad\u200Bmin",
  "the word joiner (U+2060)": "ad\u2060min",
  "the BOM (U+FEFF)": "\uFEFFadmin",
  "the line and paragraph separators (U+2028, U+2029)": "one\u2028two\u2029three",
  "tag characters": `ok${[..."run this"].map((c) => String.fromCodePoint(0xE0000 + c.codePointAt(0))).join("")}`,
  "a lone high surrogate": "ab\uD83Dcd",
  "a lone low surrogate": "ab\uDE00cd",
  "a grapheme with 500 combining marks": `Z${"\u0301".repeat(500)}algo`,
  "a 10 000-character name": "n".repeat(10000),
  "a 10 000-character name of wide characters": "名".repeat(10000),
  "a secret-shaped string": "token: ghp_abcdefghijklmnopqrstuvwxyz0123456789",
  "a credentialed URL": "https://user:hunter2@example.com/repo.git",
  "plain text, for comparison": "dev-1 café 中文",
};
/** What the kernel refuses, plus the rest of what a terminal acts on: none of it may be written. */
const REFUSED = /[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069\u200B\u2060\uFEFF\u{E0000}-\u{E007F}]/u;

/** A view as the later views will be: a label of the TUI's own and a value it did not write, on a
 *  row each, with a clipped column and a styled one. */
function view(entries, size) {
  const rows = Array.from({ length: size.rows }, () => []);
  entries.slice(0, size.rows).forEach(([, value], r) => {
    rows[r] = [{ col: 0, text: lit(`row ${r + 1}`), style: style({ dim: true }) }, { col: 8, text: shown(value), width: 30 }, { col: 40, text: shown(value), style: style({ bold: true, fg: "cyan" }) }];
  });
  return rows;
}

test("no text from outside can write a control sequence: a hostile fixture drawn through shown(), a view, the screen and the real writer leaves only the TUI's own sequences in the output", () => {
  const entries = Object.entries(FIXTURE);
  assert.equal(entries.length >= 35, true);
  for (const look of [glyphs({ LANG: "en_US.UTF-8" }), glyphs({ LANG: "C" })]) {
    const size = { cols: 100, rows: 10 };
    const stdin = fakeStdin(), stdout = fakeStdout({ columns: size.cols, rows: size.rows }), proc = fakeProcess();
    const screen = createScreen({ ...look, color: true });
    let page = [];
    const guard = createGuard({ stdin, stdout, proc, frame: () => screen.render(view(page, size), size), onInput() {}, onResize() {}, onRedraw() {} });
    guard.start();
    // Every row of the fixture, a screen at a time, each frame a diff over the last one.
    for (let from = 0; from < entries.length; from += size.rows) { page = entries.slice(from, from + size.rows); guard.draw(); }
    // And each row alone on a screen that held another: a row is also safe as the only change.
    for (const entry of entries) { page = [entry]; guard.draw(); }
    guard.finish(0);

    // What the terminal received: the bytes of the captured stream.
    const bytes = Buffer.from(stdout.written.join(""), "utf8");
    const output = bytes.toString("utf8");
    assert.equal(Buffer.from(output, "utf8").equals(bytes) && output.isWellFormed(), true, "well-formed UTF-8, no lone surrogate");

    const { sequences, text, foreign } = readTerminalOutput(output);
    assert.deepEqual(foreign, [], "every ESC begins a sequence of the TUI's own list: a position, an erase, an SGR of its parameters, one of its four modes");
    assert.deepEqual([...new Set(sequences.map((s) => s.kind))].sort(), ["erase", "mode", "position", "sgr"]);
    assert.deepEqual(sequences.filter((s) => s.kind === "mode").map((s) => s.body), ["?1049h", "?25l", "?7l", "?2004h", "?2004l", "?7h", "?25h", "?1049l"], "the modes are the guard's own, once each way");
    assert.deepEqual([...new Set(sequences.filter((s) => s.kind === "sgr").map((s) => s.body))].sort(), ["0;1;36m", "0;2m", "0m"], "the styles are the view's own");
    const control = [...bytes].filter((b) => b < 0x20 && b !== 0x1b);
    assert.deepEqual(control, [], "no C0 byte but the ESC of those sequences: no BEL, BS, CR, LF or TAB");
    assert.equal(bytes.includes(0x7f), false, "no DEL");
    assert.doesNotMatch(text, /[\u0080-\u009F]/, "no C1 control, so no 8-bit CSI");
    assert.doesNotMatch(text, REFUSED, "none of the refused format characters: bidi controls, zero-width hiders, tags, separators");
    assert.equal(bytes.filter((b) => b === 0x1b).length, sequences.length, "one ESC per sequence, and no other");

    // It did draw them: the test is not passing on an empty screen.
    assert.match(text, /row 1.*row 10/s);
    assert.equal(text.includes("[withheld]"), true, "text with a control character or a secret shape is withheld whole");
    assert.equal(text.includes("one two"), true, "a line feed and a tab fold to a space");
    assert.equal(text.includes(look.utf8 ? "safe\uFFFDtxt.exe" : "safe?txt.exe"), true, "a bidi override is replaced, never dropped and never written");
    assert.equal(text.includes(look.utf8 ? "dev-1 café 中文" : "dev-1 caf? ??"), true);
    assert.equal(text.includes(look.utf8 ? "\uFFFDalgo" : "?algo"), true, "an over-long grapheme is one replacement cell");
    assert.equal(text.includes(look.utf8 ? "\uFFFD0;eightbit\uFFFD" : "?0;eightbit?"), true, "a C1 control is replaced: what is left is text, and it starts nothing");
    assert.doesNotMatch(text, /owned|EVIL|hunter2|ghp_|evil\.example/, "nothing of a withheld text is shown");
    assert.doesNotMatch(text, /n{61}/, "a long name is clipped to its row");
    assert.equal(text.includes(look.ascii ? "nnn..." : "nnn…"), true);
    if (!look.utf8) assert.doesNotMatch(output, /[^\x00-\x7f]/, "and with a locale that is not UTF-8, no byte outside ASCII at all");
  }
});
