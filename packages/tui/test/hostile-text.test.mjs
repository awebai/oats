// What the TUI's permission to exist rests on (awebai/oats#855, section 2, term 7): nothing a
// kernel, a repository, an agent or a remote host says can write a control sequence to the
// terminal. Every test here goes through the real path and reads the bytes: shown(), a view's
// rows, the screen, and the guard's writer into a captured stream. The first holds the rule for
// one row of text; the ones after it put the same fixture in every field the Instances view
// shows.
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

// ── The Instances view ───────────────────────────────────────────────────────────────────────────
// The same fixture in every field the view shows: each value is put where a kernel, a repository
// or an agent could put it, the state is drawn as the main loop draws it, and the frame is turned
// into bytes by the real screen. The rows are made by the shared functions, which validate nothing
// here: the model takes a row as given, so the view is what stands between the text and the terminal.
import { observedEntry, panelInstances, rosterRows } from "../lib/client.mjs";
import { model } from "../lib/model.mjs";
import { frame } from "../lib/views/frame.mjs";
import { CLI, DEPLOYMENT, NOW, draw, failed, instanceRow, observed, rosterOf, stateOf } from "./helpers.mjs";

const HOME = `${DEPLOYMENT}/agents/soul/instances/row-1`;
const CLAIM = Object.freeze({ since: "2026-10-11T09:56:00.000Z", producer: "claude", reason: "question", message: "Which base should it use?" });
/** One instance, selected as the only row: the list draws it and the detail shows its facts. */
const one = (extra = {}, soul = "soul", name = "row-1") => instanceRow(soul, name, { home: HOME, branch: "agents/row-1", ...extra });
const shownAs = (extra, options) => stateOf(observed([one(extra)]), options);
/** The same entry with its souls in `team`, through the shared calls helpers.mjs `observed` makes. */
function inTeam(rows, team) {
  const document = rosterOf(rows, { team }), listed = rosterRows(document, CLI);
  const answers = listed.map((row) => ({ running: row.running, runtimeState: row.runtimeState, tmux: row.tmux }));
  return observedEntry({ roster: document, workspaceStatus: { workspace: { name: "lfx-workspace" } }, observedAt: "2026-10-11T10:00:00.000Z" }, panelInstances(listed, answers), "2026-10-11T10:00:01.000Z");
}
/** Every field of the view that holds text the TUI did not write, and a state that shows `value` there. */
const FIELDS = {
  "the instance name": (value, options) => stateOf(observed([one({}, "soul", value)]), options),
  "the soul": (value, options) => stateOf(observed([one({}, value)]), options),
  "the harness": (value, options) => shownAs({ harness: value }, options),
  "the model": (value, options) => shownAs({ model: value }, options),
  "where the model came from": (value, options) => shownAs({ modelFrom: value }, options),
  "the work mode": (value, options) => shownAs({ work: value }, options),
  "the branch": (value, options) => shownAs({ branch: value }, options),
  "the team": (value, options) => stateOf(inTeam([one()], value), options),
  "the parent": (value, options) => shownAs({ parentInstance: value }, options),
  "the sibling": (value, options) => shownAs({ siblingInstance: value }, options),
  "the runtime state of a stopped instance": (value, options) => shownAs({ running: false, runtimeState: value }, options),
  "the runtime state of an instance the kernel could not answer for": (value, options) => shownAs({ running: null, runtimeState: value }, options),
  "the runtime error": (value, options) => shownAs({ running: null, runtimeState: "unreachable", runtimeError: value }, options),
  "the home path": (value, options) => stateOf(observed([instanceRow("soul", "row-1", { home: value })]), options),
  "the workspace's name": (value, options) => stateOf(observed([one()], { workspace: value }), options),
  "the failure message of an unavailable deployment": (value, options) => stateOf(failed(observed([one()]), { code: "E_SOMETHING_NEW", message: value }), options),
  "the failure message of a stale deployment": (value, options) => stateOf(failed(observed([one()]), { code: "E_REMOTE_UNREADABLE", message: value }), options),
  "a waiting claim's message, through the shared read": (value, options) => shownAs({ waitingOnYou: { ...CLAIM, message: value } }, options),
};
const UTF8 = glyphs({ LANG: "en_US.UTF-8" }), NOT_UTF8 = glyphs({ LANG: "C" });
const S80 = { cols: 80, rows: 24 }, S120 = { cols: 120, rows: 40 };
/** Where each value is drawn: both sizes in UTF-8, and in the fields a kernel fills most freely (the
 *  name, a failure's message) also with a locale that is not: what differs there is the screen's
 *  work, the same for every field. One value is the exception. The shared display filter reads a run of 10 000 letters slowly (a
 *  third of a second of CPU a call: its credentialed-URL pattern backtracks) and every paint
 *  filters again, so that value is drawn once, and only where a text that long is cut (the name)
 *  or wrapped (the runtime error, a failure's message); 10 000 wide characters, which cost
 *  nothing, are drawn in every field like the rest. */
const SLOW = "a 10 000-character name";
const LONG_FIELDS = new Set(["the instance name", "the runtime error", "the failure message of an unavailable deployment", "the failure message of a stale deployment"]);
const BOTH_LOCALES = new Set(["the instance name", "the failure message of an unavailable deployment", "the quote line"]);
const drawnAt = (name, field) => (name !== SLOW ? [[S80, UTF8], [S120, UTF8], ...(BOTH_LOCALES.has(field) ? [[S80, NOT_UTF8]] : [])] : LONG_FIELDS.has(field) ? [[S80, UTF8]] : []);

/** The bytes a frame's rows become on a real screen, held to the census: `text`, what is left of
 *  them without the TUI's own sequences. */
function census(rows, size, look, at, cells = null) {
  const screen = createScreen({ ...look, color: true });
  const bytes = Buffer.from(screen.render(rows, size, { full: true }), "utf8"), output = bytes.toString("utf8");
  assert.equal(output.isWellFormed(), true, `${at}: well-formed, no lone surrogate`);
  const { sequences, text, foreign } = readTerminalOutput(output);
  assert.deepEqual(foreign, [], `${at}: every ESC begins a sequence of the TUI's own list`);
  assert.deepEqual([...new Set(sequences.map((s) => s.kind))].filter((kind) => !["erase", "position", "sgr"].includes(kind)), [], `${at}: a frame writes positions, erases and styles, and nothing else`);
  assert.equal(bytes.filter((b) => b === 0x1b).length, sequences.length, `${at}: one ESC per sequence, and no other`);
  assert.equal(bytes.some((b) => (b < 0x20 && b !== 0x1b) || b === 0x7f), false, `${at}: no C0 byte but the ESC of those sequences, and no DEL`);
  assert.doesNotMatch(text, /[\u0080-\u009F]/, `${at}: no C1 control`);
  assert.doesNotMatch(text, REFUSED, `${at}: none of the refused format characters`);
  if (!look.utf8) assert.equal(bytes.some((b) => b > 0x7f), false, `${at}: with a locale that is not UTF-8, no byte outside ASCII`);
  // And the cell buffer itself: no cell holds a control character, a C1 control or a bidi control.
  const held = (cells ?? screen.cells(rows, size)).flatMap((line, r) => line.flatMap((cell, x) => (REFUSED.test(cell.text) || /[\u0080-\u009F]/.test(cell.text) ? [`row ${r}, column ${x}`] : [])));
  assert.deepEqual(held, [], `${at}: no cell holds a character the terminal acts on`);
  assert.doesNotMatch(text, /owned|EVIL|hunter2|ghp_|evil\.example/, `${at}: nothing of a withheld text is shown`);
  assert.equal(text.includes("oats") && text.includes("1 Instances"), true, `${at}: the frame is drawn`);
  return text;
}

for (const [field, make] of Object.entries(FIELDS)) {
  test(`the hostile fixture as ${field}, drawn by the Instances view at 80x24 and at 120x40, leaves only the TUI's own sequences in the output, and no cell holds a control character`, () => {
    for (const [name, value] of Object.entries(FIXTURE)) for (const [size, look] of drawnAt(name, field)) {
      const state = make(value, { ascii: look.ascii }), at = `${name}, ${size.cols}x${size.rows}${look.utf8 ? "" : ", not UTF-8"}`;
      const drawn = draw(state, size, { utf8: look.utf8 }), text = census(drawn.rows, size, look, at, drawn.cells);
      // The field is on the screen: plain text put there is read there.
      if (name === "plain text, for comparison" && size === S120) assert.equal(text.includes("dev-1 café 中文"), true, `${at}: ${field} is drawn`);
      if (name === "bidi overrides (U+202D, U+202E)" && size === S120 && !field.startsWith("a waiting claim")) assert.equal(text.includes("safe\uFFFDtxt.exe"), true, `${at}: a bidi override is replaced, never dropped and never written`);
    }
  });
}

test("a waiting claim's message handed to the view directly, whatever the shared read lets through, is drawn through shown(): the hostile fixture on the quote line leaves only the TUI's own sequences", () => {
  const state = (look) => shownAs({ waitingOnYou: { ...CLAIM } }, { ascii: look.ascii });
  for (const [name, value] of Object.entries(FIXTURE)) for (const [size, look] of drawnAt(name, name === SLOW ? null : "the quote line")) {
    const at = `${name}, ${size.cols}x${size.rows}${look.utf8 ? "" : ", not UTF-8"}`;
    const m = model(state(look), { page: draw(state(look), size).page, now: NOW, at: new Date(NOW).toISOString() });
    // The quote line: the fact under `needs`, which holds the claim's message.
    const needs = m.detail.facts.findIndex((fact) => fact.label === "needs"), quote = m.detail.facts[needs + 1];
    assert.equal(needs >= 0 && quote.label === "" && quote.value.includes(CLAIM.message), true, "the model holds the message on the line under `needs`");
    const facts = m.detail.facts.map((fact) => (fact === quote ? { ...fact, value: fact.value.replace(CLAIM.message, () => value) } : fact));
    const text = census(frame({ ...m, detail: { ...m.detail, facts } }, size).rows, size, look, at);
    if (name === "plain text, for comparison" && size === S120) assert.equal(text.includes("the agent: \"dev-1 café 中文\""), true, `${at}: the message is drawn as an attributed quote`);
    if (name === "CSI erase") assert.equal(text.includes("[withheld]") && !text.includes("gone"), true, `${at}: a message with a control character is withheld whole`);
    if (name === "bidi overrides (U+202D, U+202E)" && size === S120) assert.equal(text.includes("safe\uFFFDtxt.exe"), true, `${at}: a bidi override is replaced`);
  }
});

test("through the shared read a hostile waiting message does not arrive: the detail holds the reason in words and no quote line", () => {
  for (const name of ["CSI erase", "OSC 52, the clipboard", "bidi overrides (U+202D, U+202E)", "the 8-bit CSI (U+009B)", "a secret-shaped string"]) {
    const d = draw(shownAs({ waitingOnYou: { ...CLAIM, message: FIXTURE[name] } }), S120);
    assert.equal(d.lines.some((line) => line.includes(" needs ")), true, `${name}: the claim is still drawn`);
    assert.equal(d.lines.some((line) => line.includes("the agent:")), false, `${name}: without its message`);
  }
});
