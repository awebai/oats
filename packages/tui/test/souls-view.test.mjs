process.env.TZ = "UTC";
// The Souls view as the frame draws it (Spec 6-view, Done 2 and 3): the list of souls in the sidebar,
// the selected soul's detail in the main area, the bodies of the catalog's states, and the cheat
// sheet. The model is the frame's
// contract (lib/model.mjs, `m.souls`), made here by hand over a real model of the Instances view,
// so each case says exactly what the view is handed; one test draws the whole path, the store and
// the model, from the shared catalog's answers (helpers.mjs). What a test claims about the screen
// it reads from the screen's cells, never from a string's length.
import test from "node:test";
import assert from "node:assert/strict";
import { model } from "../lib/model.mjs";
import { createScreen } from "../lib/term/screen.mjs";
import { PLAIN, style } from "../lib/term/style.mjs";
import { textWidth } from "../lib/term/width.mjs";
import { WIDE, frame } from "../lib/views/frame.mjs";
import { DEFAULT_FG, MARKS } from "../lib/views/instances.mjs";
import { COUNT_SIGN, SOULS_TEXT, SOUL_COLOURS, SOUL_MARK } from "../lib/views/souls.mjs";
import { CLI, NOW, catalogEntry, catalogSoul, draw, instanceRow, observed, press, soulsTold, stateOf } from "./helpers.mjs";

const size = (cols, rows) => ({ cols, rows });
const S60 = size(60, 15), S60T = size(60, 24), S79 = size(79, 24), S80 = size(80, 24), S120 = size(120, 40);
const SIZES = [S60, S60T, S79, S80, S120];
const AT = new Date(NOW).toISOString();
/** The sidebar's width on a wide terminal (views/frame.mjs layout), and where the detail starts: a
 *  cell after the sidebar's rule from 80 columns, and at the margin, as a page over the whole
 *  screen, under them. */
const listWidth = (cols) => Math.min(Math.max(Math.floor(cols * 0.48), 36), 60);
const paneOf = (sz) => (sz.cols >= WIDE ? listWidth(sz.cols) : sz.cols);
const detailAt = (sz) => (sz.cols >= WIDE ? listWidth(sz.cols) + 2 : 1);
/** What no cell may hold: a control character (C0, DEL, C1) or a bidi control. */
const CONTROL = /[\p{Cc}\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;
/** The cheat sheet's first row: the leader (helpers.mjs TEST_LEADER, C-\\), spelt for people. */
const LEAD = " Ctrl+\\   commands";
const modes = [false, true];
/** The detail page's keys under 80 columns, at the right of its first row (views/frame.mjs
 *  withKeys): the cheat sheet's but for the leader, the palette, help and quit. */
const PAGE_KEYS = ["Tab back", "Enter instances", "n spawn"];
/** The detail page's first row at `cols`: the title, then `keys` dim at the right, ending a cell before the edge. */
const pageTop = (title, cols, keys = PAGE_KEYS) => { const said = keys.join("   "); return `${title.padEnd(cols - 1 - said.length)}${said}`; };

// ── The model the frame is handed ───────────────────────────────────────────────────────────────

/** The real model of a small Instances view: the title, the actions and the cheat sheet's keys. */
const ROWS = () => [instanceRow("dev", "dev-a"), instanceRow("dev", "dev-b", { running: false, runtimeState: "stopped" })];
const baseModel = (ascii) => model(stateOf(observed(ROWS()), { ascii }), { page: 19, now: NOW, at: AT, cols: 38 });
const LONG = "a-soul-whose-name-is-far-longer-than-any-list-pane-can-hold-at-any-width-at-all";
/** Four souls: the selected one in green with three instances here, one in magenta with none, an
 *  uncoloured one a spawn would refuse, and a long-named blue one refused with twelve. */
const LIST = () => [
  { name: "acme-ledger-developer", color: "green", count: 3, refused: false, selected: true },
  { name: "reviewer", color: "magenta", count: 0, refused: false, selected: false },
  { name: "ops", color: null, count: 0, refused: true, selected: false },
  { name: LONG, color: "blue", count: 12, refused: true, selected: false },
];
const INSTANCES = (n) => Array.from({ length: n }, (_, i) => ({ name: `dev-${i}`, mark: ["running", "stopped", "shell", "unknown", "held"][i % 5] }));
/** Every section of the detail. */
const DETAIL = () => ({
  name: "acme-ledger-developer", description: "Builds and maintains the ledger service: its API, its storage and its tests, end to end.",
  from: "oats-core · package acme 1.2.0", works: "works in its own worktree", refusal: "Can't spawn here · No launch configuration matches.",
  harness: {
    rows: [["Harness", "Claude Code"], ["Model", "claude-opus-5-5"], ["Launch configuration", "fast"], ["Chosen by", "the soul"]], notes: ["Set in soul.yaml"],
    problem: { lead: "A spawn of this soul with no launch chosen would be refused here.", lines: ["OATS says: no harness is installed", "Install one."], code: "E_NO_HARNESS" },
  },
  teams: [{ label: "core", default: true }, { label: "ops", default: false }], capabilities: ["oats.core", "oats.aweb", "acme.ledger-tools"],
  instances: { shown: INSTANCES(8), more: 3 },
});
/** A detail with nothing but its name and where the soul comes from. */
const BARE = () => ({ name: "bare", description: "", from: "oats-core", works: null, refusal: null, harness: { rows: [], notes: [], problem: null }, teams: null, capabilities: null, instances: { shown: [], more: 0 } });
const SOULS = () => ({ local: true, state: "rows", failure: null, heading: null, list: LIST(), above: 0, below: 0, focus: "list", filter: { editing: false, query: "" }, detail: DETAIL(), detailTop: 0 });
/** The model of the Souls view: the base's, its `souls` replaced in part. */
function soulsModel(over = {}, { ascii = false } = {}) {
  return { ...baseModel(ascii), view: "souls", under: "souls", souls: { ...SOULS(), ...over } };
}
const FAILURE = "Couldn't read this workspace's souls: oats souls exited 1 after reading the workspace's members for longer than it was given.";
/** A failed re-read's heading: no word of its own, the accordion's row above it names the view. */
const HEADING = { label: "", path: null, state: null, short: FAILURE, readAt: "09:59:30" };

/** Draw a model as the main loop draws it after the model step (helpers.mjs `draw`). */
function drawModel(m, sz) {
  const made = frame(m, sz);
  const cells = createScreen({ utf8: true, ascii: m.ascii }).cells(made.rows, sz);
  return { ...made, cells, lines: cells.map((line) => line.map((cell) => cell.text).join("").trimEnd()) };
}
const cellText = (d, r, from = 0, to = Infinity) => d.cells[r].slice(from, to).map((cell) => cell.text).join("").trimEnd();
/** Every row: the detail is as tall as the screen. */
const bodyRows = (sz) => Array.from({ length: sz.rows }, (_, i) => i);
/** The sidebar's rows, and which of them are its rules. */
const sideLines = (d, sz) => bodyRows(sz).map((r) => cellText(d, r, 0, paneOf(sz)));
const isRule = (line) => /^(─+|-+)$/.test(line);
/** The first row of the souls' list: the Souls view's heading stands under the first rule (the one
 *  after the Instances row), and its list under it. */
const listTop = (d, sz) => sideLines(d, sz).findIndex(isRule) + 2;
/** The rows of the souls' list in the sidebar: from listTop down to the rule after it. */
function listLines(d, sz) {
  const lines = sideLines(d, sz), top = listTop(d, sz);
  return lines.slice(top, top + lines.slice(top).findIndex(isRule));
}
const detailLines = (d, sz) => bodyRows(sz).map((r) => cellText(d, r, detailAt(sz)));
/** The cheat sheet: the sidebar's rows after its last rule, down to the empty rows under it. */
function sheet(d, sz) {
  const lines = sideLines(d, sz), after = lines.slice(lines.findLastIndex(isRule) + 1), end = after.indexOf("");
  return end < 0 ? after : after.slice(0, end);
}
/** Cheat-sheet rows from `[key, word]` pairs, the leader's first: each key from the margin, its word
 *  in a column after the widest key (the leader's here) and three cells. */
const hints = (...pairs) => [LEAD, ...pairs.map(([key, word]) => ` ${key.padEnd(9)}${word}`)];
/** The cell index at which `word` is first drawn in row `r`, or -1. */
function cellIndexOf(d, r, word, from = 0) {
  const cells = d.cells[r];
  for (let x = from; x + word.length <= cells.length; x++) if (cells.slice(x, x + word.length).map((cell) => cell.text).join("") === word) return x;
  return -1;
}
/** The body row whose text holds `word`. */
function rowWith(d, sz, word, from = 0) {
  const found = bodyRows(sz).filter((r) => cellText(d, r, from).includes(word));
  assert.equal(found.length >= 1, true, `a row holds ${word}`);
  return found[0];
}
/** Every row of a frame takes exactly the terminal's columns, and no wide grapheme is split. */
function fits(d, sz, at) {
  assert.equal(d.cells.length, sz.rows, at);
  d.cells.forEach((line, r) => {
    assert.equal(line.length, sz.cols, `${at}: row ${r} has the terminal's cells`);
    assert.equal(line.reduce((sum, cell) => sum + cell.width, 0), sz.cols, `${at}: row ${r}: its graphemes take exactly the terminal's columns`);
    assert.equal(textWidth(d.lines[r]) <= sz.cols, true, `${at}: row ${r} is no wider than the terminal`);
  });
}
const glyphs = (ascii) => (ascii ? { rule: "-", bar: "|", cut: "...", mark: "#", count: "x" } : { rule: "─", bar: "│", cut: "…", mark: "■", count: "·" });

// ── The whole screen ────────────────────────────────────────────────────────────────────────────

test("the Souls view at 80x24 in UTF-8, cell for cell: the sidebar with the souls under the open Souls row and the cheat sheet, the rule over the whole height, and beside it from the top row the selected soul's detail, scrolled with its cut note", () => {
  const d = drawModel(soulsModel(), S80);
  assert.deepEqual(d.lines, [
    "  acme-platform                       │   acme-ledger-developer",
    "                                      │   Builds and maintains the ledger",
    " Instances                          1 │   service: its API, its storage and its",
    "──────────────────────────────────────│   tests, end to end.",
    " Souls                              2 │   from     oats-core · package acme",
    "> ■ acme-ledger-developer ·3          │            1.2.0",
    "  ■ reviewer                          │   works    works in its own worktree",
    "  ■ ops !                             │   Can't spawn here · No launch",
    "  ■ a-soul-whose-name-is-far-l… ! ·12 │   configuration matches.",
    "──────────────────────────────────────│   harness",
    " Capabilities                       3 │     Harness",
    "──────────────────────────────────────│       Claude Code",
    " Ctrl+\\   commands                    │     Model",
    " Ctrl+K   palette                     │       claude-opus-5-5",
    " Enter    detail                      │     Launch configuration",
    " n        spawn                       │       fast",
    " ?        help                        │     Chosen by",
    " q        quit                        │       the soul",
    "                                      │     Set in soul.yaml",
    "                                      │     A spawn of this soul with no launch",
    "                                      │     chosen would be refused here.",
    "                                      │     OATS says: no harness is installed",
    "                                      │     Install one.",
    "                                      │   10 more below",
  ]);
  assert.deepEqual([d.page, d.room, d.extent], [16, 24, 33], "the list's rows in the sidebar, and the detail's rows shown and held");
  assert.equal(d.cells[4].slice(1, 6).every((cell) => cell.style.bold), true, "Souls is the open view: its row is bold");
  assert.equal(d.cells[2][1].style.bold, false, "the Instances row is not");
  assert.deepEqual([d.cells[4][36].text, d.cells[4][36].style.dim], ["2", true], "the view's key, dim at the sidebar's right edge");
});

test("the Souls view at 60x15 in ASCII, cell for cell: the sidebar alone, with the ASCII marks, count and rules, and the cheat sheet in the rows the list leaves", () => {
  const d = drawModel(soulsModel({}, { ascii: true }), S60);
  assert.deepEqual(d.lines, [
    "  acme-platform",
    "",
    " Instances                                                1",
    "-".repeat(60),
    " Souls                                                    2",
    "> # acme-ledger-developer x3",
    "  # reviewer",
    "  # ops !",
    "  # a-soul-whose-name-is-far-longer-than-any-list-... ! x12",
    "-".repeat(60),
    " Capabilities                                             3",
    "-".repeat(60),
    LEAD,
    " Ctrl+K   palette",
    " Enter    detail",
  ]);
});

// ── The list ────────────────────────────────────────────────────────────────────────────────────

test("a soul's row: its mark in its colour (uncoloured with none), its name, `!` and dim for a refused soul, a dim count of its instances here only when it has some, and the selection as `>` and reverse over the row", () => {
  for (const ascii of modes) for (const sz of SIZES) {
    const d = drawModel(soulsModel({}, { ascii }), sz), at = `${ascii ? "ascii" : "utf8"} ${sz.cols}x${sz.rows}`, g = glyphs(ascii), pane = paneOf(sz);
    fits(d, sz, at);
    const top = listTop(d, sz), [chosen, reviewer, ops, long] = [top, top + 1, top + 2, top + 3];
    for (const r of [chosen, reviewer, ops, long]) assert.equal(d.cells[r][2].text, g.mark, `${at}: the soul's mark at column 2`);
    // The colours: one of the sixteen, from the model; none, the mark is plain.
    assert.deepEqual([d.cells[reviewer][2].style.fg, d.cells[reviewer][2].style.dim], ["magenta", false], `${at}: reviewer's mark is magenta`);
    assert.equal(d.cells[ops][2].style.fg, null, `${at}: no colour, an uncoloured mark`);
    assert.deepEqual([d.cells[long][2].style.fg, d.cells[long][2].style.dim], ["blue", true], `${at}: a refused soul's mark keeps its colour, dim`);
    // The selected row: `>` in the first cell, the whole row of the pane in reverse.
    assert.equal(d.cells[chosen][0].text, ">", at);
    assert.equal(d.cells[chosen].slice(0, pane).every((cell) => cell.style.reverse), true, `${at}: the selected row is in reverse over the sidebar`);
    assert.equal(d.cells[reviewer].slice(0, pane).some((cell) => cell.style.reverse), false, `${at}: no other row is`);
    // The name at column 4; a count only where there are instances here.
    assert.equal(cellText(d, chosen, 4, pane), `acme-ledger-developer ${g.count}3`, at);
    assert.equal(cellText(d, reviewer, 4, pane), "reviewer", `${at}: no count for none`);
    assert.equal(cellText(d, reviewer, 0, pane).includes(g.count), false, at);
    // A refused soul: dim, with `!` after its name.
    assert.equal(cellText(d, ops, 4, pane), "ops !", at);
    for (const x of [4, 5, 6, 8]) assert.equal(d.cells[ops][x].style.dim, true, `${at}: the refused row is dim, its \`!\` too`);
    // The long name is cut, the `!` and the count whole at the sidebar's edge less one cell.
    const longText = cellText(d, long, 4, pane);
    assert.equal(longText.endsWith(`${g.cut} ! ${g.count}12`), true, `${at}: ${longText}`);
    assert.equal(textWidth(cellText(d, long, 0, pane)), pane - 1, `${at}: one cell is kept at the edge`);
    const count = cellIndexOf(d, long, `${g.count}12`);
    for (const cell of d.cells[long].slice(count, count + 3)) assert.equal(cell.style.dim, true, `${at}: the count is dim`);
  }
});

test("the colour table maps the soul palette's six names onto the terminal's sixteen (sand onto its own foreground), and the marks are ■ and #", () => {
  assert.deepEqual(SOUL_COLOURS, { sand: DEFAULT_FG, sage: "green", slate: "blue", mauve: "magenta", clay: "red", olive: "cyan" });
  assert.equal(Object.isFrozen(SOUL_COLOURS), true);
  assert.deepEqual([SOUL_MARK.utf8, SOUL_MARK.ascii, COUNT_SIGN.utf8, COUNT_SIGN.ascii], ["■", "#", "·", "x"]);
  // Every colour of the table draws as itself; sand's, the terminal's own foreground, with no colour at all.
  for (const colour of Object.values(SOUL_COLOURS)) {
    const d = drawModel(soulsModel({ list: [{ name: "one", color: colour, count: 1, refused: false, selected: false }] }), S80);
    assert.equal(d.cells[listTop(d, S80)][2].style.fg, colour === DEFAULT_FG ? null : colour, colour);
  }
});

test("the list is cut by the model's window: what is cut off is said on the list's last row, and the rows stand above it", () => {
  for (const sz of SIZES) {
    const d = drawModel(soulsModel({ list: LIST().slice(0, 2), above: 4, below: 7 }), sz), at = `${sz.cols}x${sz.rows}`;
    assert.equal(listLines(d, sz).at(-1), "   4 more above, 7 more below", at);
    assert.equal(cellText(d, listTop(d, sz), 4, paneOf(sz)).startsWith("acme-ledger-developer"), true, at);
  }
});

// ── The detail ──────────────────────────────────────────────────────────────────────────────────

test("the detail holds every section, top to bottom: the bold name, the description, from, works, the refusal in the warning style, the harness, teams, capabilities, the instances here with their marks and +n, and the key that shows them", () => {
  for (const ascii of modes) {
    const sz = S120, d = drawModel(soulsModel({}, { ascii }), sz), at = ascii ? "ascii" : "utf8", x = detailAt(sz), marks = ascii ? MARKS.ascii : MARKS.utf8;
    fits(d, sz, at);
    const lines = detailLines(d, sz);
    assert.deepEqual(lines.slice(0, 24), [
      "  acme-ledger-developer",
      "  Builds and maintains the ledger service: its API, its",
      "  storage and its tests, end to end.",
      "  from     oats-core · package acme 1.2.0",
      "  works    works in its own worktree",
      "  Can't spawn here · No launch configuration matches.",
      "  harness",
      "    Harness               Claude Code",
      "    Model                 claude-opus-5-5",
      "    Launch configuration  fast",
      "    Chosen by             the soul",
      "    Set in soul.yaml",
      "    A spawn of this soul with no launch chosen would be",
      "    refused here.",
      "    OATS says: no harness is installed",
      "    Install one.",
      "    code E_NO_HARNESS",
      "  teams    core (default), ops",
      "  capabilities",
      "    oats.core, oats.aweb, acme.ledger-tools",
      "  instances here",
      `    ${marks.running} dev-0  ${marks.stopped} dev-1  ${marks.shell} dev-2  ${marks.unknown} dev-3  ${marks.held} dev-4  ${marks.running} dev-5`,
      `    ${marks.stopped} dev-6  ${marks.shell} dev-7  +3`,
      "    i shows them in the Instances view.",
    ], at);
    const row = (word) => rowWith(d, sz, word, x);
    // The name is bold; the labels are dim; the refusal is bold red (yellow says needs input, and only that), and says what it is in words.
    assert.equal(d.cells[0][x + 2].style.bold, true, `${at}: the name is bold`);
    for (const label of ["from", "works", "harness", "teams", "capabilities", "instances here"]) {
      const r = row(`  ${label}`), col = cellIndexOf(d, r, label, x);
      assert.equal(d.cells[r].slice(col, col + label.length).every((cell) => cell.style.dim), true, `${at}: ${label} is dim`);
    }
    const refusal = row("Can't spawn here"), from = cellIndexOf(d, refusal, "Can't", x);
    assert.deepEqual([d.cells[refusal][from].style.bold, d.cells[refusal][from].style.fg], [true, "red"], `${at}: the warning style`);
    // The note and the code are dim, the problem's lead bold, its kernel lines plain.
    assert.equal(d.cells[row("Set in soul.yaml")][x + 4].style.dim, true, `${at}: a note is dim`);
    assert.equal(d.cells[row("A spawn of this soul")][x + 4].style.bold, true, `${at}: the problem's lead is bold`);
    assert.equal(d.cells[row("OATS says")][x + 4].style, PLAIN, `${at}: its lines are plain`);
    assert.equal(d.cells[row("code E_NO_HARNESS")][x + 9].style.dim, true, `${at}: its code is dim`);
    // `(default)` is the TUI's word beside the label from outside, dim.
    const teams = row("teams"), word = cellIndexOf(d, teams, "(default)", x);
    assert.equal(d.cells[teams][word].style.dim, true, `${at}: (default) is dim`);
    assert.equal(d.cells[teams][word - 2].style.dim, false, `${at}: the team's label is not`);
    // Each instance's mark is drawn as the list of instances draws it.
    const named = row("dev-0"), mark = cellIndexOf(d, named, `${marks.running} dev-0`, x);
    assert.equal(d.cells[named][mark].style.fg, "green", `${at}: a running mark is green`);
    assert.equal(d.cells[named][cellIndexOf(d, named, `${marks.stopped} dev-1`, x)].style.dim, true, `${at}: a stopped mark is dim`);
  }
});

test("a section with nothing to say is left out: no works, no refusal, no harness, no teams, no capabilities, no instances here", () => {
  for (const sz of SIZES) {
    for (const [what, over] of [["null", {}], ["empty", { teams: [], capabilities: [] }]]) {
      const m = soulsModel({ focus: sz.cols < WIDE ? "detail" : "list", detail: { ...BARE(), ...over } }), d = drawModel(m, sz), at = `${what} ${sz.cols}x${sz.rows}`;
      fits(d, sz, at);
      const lines = detailLines(d, sz).filter(Boolean).map((line) => line.trim().replace(/^> /, ""));
      assert.deepEqual(lines.slice(1), ["from     oats-core"], at);
      // The title alone; under 80 columns, a page, its first row carries its keys at the right.
      assert.equal(sz.cols < WIDE ? d.lines[0] : lines[0], sz.cols < WIDE ? pageTop(" > bare", sz.cols) : "bare", at);
    }
  }
  // Each section alone, the others left out.
  const only = (over) => detailLines(drawModel(soulsModel({ detail: { ...BARE(), ...over } }), S120), S120).filter(Boolean).map((line) => line.trim());
  assert.deepEqual(only({ works: "works in the repo checkout" }), ["bare", "from     oats-core", "works    works in the repo checkout"]);
  assert.deepEqual(only({ teams: [{ label: "core", default: false }] }), ["bare", "from     oats-core", "teams    core"], "no default, no (default)");
  assert.deepEqual(only({ capabilities: ["oats.core"] }), ["bare", "from     oats-core", "capabilities", "oats.core"]);
  assert.deepEqual(only({ harness: { rows: [], notes: ["No default harness: you choose one when you launch it."], problem: null } }), ["bare", "from     oats-core", "harness", "No default harness: you choose one when you launch it."]);
  assert.deepEqual(only({ instances: { shown: INSTANCES(1), more: 0 } }), ["bare", "from     oats-core", "instances here", `${MARKS.utf8.running} dev-0`, "i shows them in the Instances view."], "no +n with none more");
  assert.deepEqual(only({ harness: { rows: [], notes: [], problem: { lead: "A spawn would be refused.", lines: [], code: null } } }), ["bare", "from     oats-core", "harness", "A spawn would be refused."], "a problem with no code has no code line");
});

test("at most eight instances are named, then +n; the key that shows them is the user's", () => {
  const lines = (over, m = soulsModel({ detail: { ...BARE(), instances: over } })) => detailLines(drawModel(m, S120), S120).filter(Boolean).map((line) => line.trim());
  assert.equal(lines({ shown: INSTANCES(8), more: 41 }).some((line) => line.endsWith("dev-7  +41")), true);
  assert.equal(lines({ shown: INSTANCES(8), more: 0 }).some((line) => line.includes("+")), false);
  const rebound = soulsModel({ detail: { ...BARE(), instances: { shown: INSTANCES(2), more: 0 } } });
  rebound.actions = rebound.actions.map((a) => (a.id === "soul-instances" ? { ...a, keys: ["I"] } : a));
  assert.equal(lines(null, rebound).at(-1), "I shows them in the Instances view.");
  rebound.actions = rebound.actions.map((a) => (a.id === "soul-instances" ? { ...a, keys: [] } : a));
  assert.equal(lines(null, rebound).at(-1).includes("shows them"), false, "an unbound key is not named");
});

test("the harness facts stand beside their labels where the pane has the room, and under them where it has not: at 80 columns, beside the list, each value goes on the row under its label", () => {
  const harness = (sz, focus) => {
    const lines = detailLines(drawModel(soulsModel({ focus, detail: { ...BARE(), harness: DETAIL().harness } }), sz), sz).filter(Boolean);
    return lines.slice(lines.findIndex((line) => line.trim() === "harness") + 1, lines.findIndex((line) => line.includes("Set in")));
  };
  assert.deepEqual(harness(S80, "list").map((line) => line.trimEnd()), ["    Harness", "      Claude Code", "    Model", "      claude-opus-5-5", "    Launch configuration", "      fast", "    Chosen by", "      the soul"]);
  for (const [sz, lead] of [[S120, "    "], [S60T, "    "]]) {
    assert.deepEqual(harness(sz, "detail").map((line) => line.trimEnd().replace(/^ ?> /, "")), ["Harness               Claude Code", "Model                 claude-opus-5-5", "Launch configuration  fast", "Chosen by             the soul"].map((line) => `${lead}${line}`), `${sz.cols}`);
  }
});

test("the detail wraps by cells at every width, and nothing passes the right margin", () => {
  const wordy = { ...DETAIL(), description: "word ".repeat(60).trim(), from: "member ".repeat(20).trim(), teams: Array.from({ length: 14 }, (_, i) => ({ label: `team-${i}`, default: i === 3 })), capabilities: Array.from({ length: 20 }, (_, i) => `cap.number-${i}`) };
  for (const ascii of modes) for (const sz of [S60T, S80, S120]) {
    const d = drawModel(soulsModel({ focus: "detail", detail: wordy, detailTop: 0 }, { ascii }), { ...sz, rows: 80 }), at = `${ascii} ${sz.cols}`;
    fits(d, { ...sz, rows: 80 }, at);
    const lines = detailLines(d, { ...sz, rows: 80 }).filter(Boolean);
    for (const line of lines) assert.equal(detailAt(sz) + textWidth(line) <= sz.cols - 1, true, `${at}: the right margin is kept: ${line}`);
    assert.equal(lines.filter((line) => /^ *(> )?word/.test(line) || /^ +word/.test(line)).length >= 3, true, `${at}: the description takes rows of its own`);
    assert.equal(lines.some((line) => line.includes("team-3 (default),")), true, `${at}: the default team is marked where it stands`);
    assert.equal(lines.filter((line) => line.includes("cap.number-")).length >= 2, true, `${at}: the capabilities go on over rows`);
    // A team is never broken over two rows: each row holds whole names.
    for (const line of lines.filter((l) => l.includes("team-"))) for (const name of line.match(/team-[^\s,]*/g)) assert.match(name, /^team-\d+$/, `${at}: ${line}`);
  }
});

test("the detail with the focus says so with `>` beside its title, beside the sidebar at 80 columns and up, and as a page over the whole screen under 80, where the sidebar is not drawn", () => {
  for (const ascii of modes) {
    for (const sz of [S80, S120]) {
      const d = drawModel(soulsModel({ focus: "detail" }, { ascii }), sz), x = detailAt(sz), at = `${ascii} ${sz.cols}`;
      assert.deepEqual([d.cells[0][x].text, d.cells[0][x].style.bold], [">", true], at);
      assert.equal(cellText(d, listTop(d, sz), 0, paneOf(sz)).startsWith(">"), true, `${at}: the list stays beside it`);
      const listing = drawModel(soulsModel({ focus: "list" }, { ascii }), sz);
      assert.equal(listing.cells[0][x].text, " ", `${at}: no mark while the list has the focus`);
    }
    for (const sz of [S60, S60T, S79]) {
      const at = `${ascii} ${sz.cols}x${sz.rows}`;
      const paged = drawModel(soulsModel({ focus: "detail" }, { ascii }), sz);
      fits(paged, sz, at);
      // At 60 columns the long title leaves no room for the last key: it is given up.
      assert.equal(paged.lines[0], pageTop(" > acme-ledger-developer", sz.cols, sz.cols === 60 ? PAGE_KEYS.slice(0, -1) : PAGE_KEYS), `${at}: the detail from the top row, at the margin, its keys at the right`);
      assert.equal(paged.lines.some((line) => line.includes("reviewer")), false, `${at}: no row of the list`);
      assert.equal(paged.lines.some((line) => line.startsWith("  acme-platform") || /^ (Souls|Capabilities)\b/.test(line) || line.includes("commands")), false, `${at}: no list of workspaces, no view's row, no cheat sheet`);
      const listed = drawModel(soulsModel({ focus: "list" }, { ascii }), sz);
      assert.equal(listed.lines.some((line) => line.includes("from ")), false, `${at}: under 80 the list alone while it has the focus`);
    }
  }
});

test("the detail scrolls by detailTop, says what is cut off on its last row, and hands back how many rows it holds", () => {
  for (const sz of [S80, S120, S60T]) {
    const m = (top) => soulsModel({ focus: "detail", detailTop: top });
    const whole = drawModel(m(0), sz), at = `${sz.cols}x${sz.rows}`;
    const scrolled = drawModel(m(4), sz), lines = detailLines(scrolled, sz);
    assert.equal(scrolled.extent, whole.extent, at);
    if (whole.extent <= whole.room) continue;
    assert.match(lines.at(-1).trim(), /^4 more above(, \d+ more below)?$/, at);
    assert.equal(lines[0].trim().startsWith(">"), true, `${at}: the focus mark stays on the first row`);
    assert.equal(lines.some((line) => line.includes("acme-ledger-developer")), false, `${at}: the title is scrolled away`);
  }
});

// ── The bodies of the catalog's states ──────────────────────────────────────────────────────────

test("the catalog's states, at every width in UTF-8 and ASCII: reading, a failed first read with the key that reads again, an empty catalog naming `oats souls`, and no workspace of this machine each take the list's place in the sidebar, with nothing beside them", () => {
  const cases = [
    ["reading", { state: "reading", list: [], detail: null }, (ascii) => [ascii ? "Reading souls..." : "Reading souls…"]],
    ["none", { state: "none", list: [], detail: null }, () => ["This workspace offers no souls. `oats souls` says why."]],
    ["noWorkspace", { local: false, state: "none", list: [], detail: null }, () => ["Open a workspace of this machine to see its souls."]],
  ];
  for (const ascii of modes) for (const sz of SIZES) {
    const at = (what) => `${what} ${ascii ? "ascii" : "utf8"} ${sz.cols}x${sz.rows}`;
    for (const [what, over, said] of cases) {
      const d = drawModel(soulsModel(over, { ascii }), sz);
      fits(d, sz, at(what));
      if (sz.cols >= WIDE) assert.deepEqual(detailLines(d, sz).filter(Boolean), [], `${at(what)}: nothing beside the sidebar`);
      // The sentence is wrapped to the sidebar's width, each of its rows at the list's indent.
      const rows = listLines(d, sz);
      assert.equal(rows.every((line) => /^ {3}\S/.test(line)), true, `${at(what)}: ${rows.join(" | ")}`);
      assert.equal(rows.map((line) => line.trim()).join(" "), said(ascii).join(" "), at(what));
      assert.equal(d.cells[listTop(d, sz)][3].style.dim, true, `${at(what)}: the TUI's line is dim`);
    }
    const failed = drawModel(soulsModel({ state: "failed", failure: FAILURE, list: [], detail: null }, { ascii }), sz);
    fits(failed, sz, at("failed"));
    const said = listLines(failed, sz).filter(Boolean);
    assert.equal(said.at(-1), "   r reads them again.", at("failed"));
    assert.equal(said.slice(0, -1).map((line) => line.trim()).join(" "), FAILURE, `${at("failed")}: the whole sentence, wrapped`);
    assert.equal(failed.cells[listTop(failed, sz)][3].style, PLAIN, `${at("failed")}: the sentence is not the TUI's, and not dim`);
    if (sz.cols >= WIDE) assert.deepEqual(detailLines(failed, sz).filter(Boolean), [], `${at("failed")}: nothing beside the sidebar`);
  }
  assert.equal(SOULS_TEXT.reading, "Reading souls…");
});

test("no soul matching the filter, and a failed re-read: the list stands with the main area beside it; the re-read's heading says the failure and the age of the rows it kept, and the rows follow it", () => {
  for (const ascii of modes) for (const sz of SIZES) {
    const at = (what) => `${what} ${ascii ? "ascii" : "utf8"} ${sz.cols}x${sz.rows}`, g = glyphs(ascii);
    const nomatch = drawModel(soulsModel({ state: "nomatch", list: [], detail: null, filter: { editing: false, query: "zzz" } }, { ascii }), sz);
    fits(nomatch, sz, at("nomatch"));
    assert.deepEqual(listLines(nomatch, sz).filter(Boolean), ["   No soul matches the filter."], at("nomatch"));
    if (sz.cols >= WIDE) assert.equal(nomatch.cells.every((line) => line[listWidth(sz.cols)].text === g.bar), true, `${at("nomatch")}: the sidebar's rule over the whole height`);

    const kept = drawModel(soulsModel({ heading: HEADING, list: LIST().slice(0, 2) }, { ascii }), sz);
    fits(kept, sz, at("kept"));
    const top = listTop(kept, sz), heading = cellText(kept, top, 0, paneOf(sz));
    assert.equal(heading.startsWith(" Couldn't re"), true, `${at("kept")}: the sentence from the margin: ${heading}`);
    assert.equal(heading.endsWith("read 09:59:30"), true, `${at("kept")}: the age of the rows`);
    assert.deepEqual([kept.cells[top][1].text, kept.cells[top][1].style.bold], ["C", false], `${at("kept")}: no bold label before it`);
    // The accordion's row above it names the view; the heading does not say it again.
    assert.deepEqual([cellText(kept, top - 1, 0, paneOf(sz)).startsWith(" Souls "), /\bSouls\b/.test(heading)], [true, false], `${at("kept")}: the view's word once, on its own row`);
    assert.equal(cellText(kept, top + 1, 0, paneOf(sz)).startsWith(`> ${g.mark} acme-ledger-developer`), true, `${at("kept")}: the rows follow`);
    if (sz.cols >= WIDE) assert.equal(detailLines(kept, sz)[0].trim(), "acme-ledger-developer", `${at("kept")}: the detail beside them`);

    const empty = drawModel(soulsModel({ heading: HEADING, state: "none", list: [], detail: null }, { ascii }), sz);
    assert.deepEqual(listLines(empty, sz).filter(Boolean).slice(1).map((line) => line.trim()).join(" "), "This workspace offers no souls. `oats souls` says why.", at("kept none"));
    for (const line of listLines(empty, sz)) assert.equal((line.match(/`/g) ?? []).length % 2, 0, `${at("kept none")}: the command is whole on its row: ${line}`);
  }
});

// ── The cheat sheet ─────────────────────────────────────────────────────────────────────────────

test("the Souls view's cheat sheet is small: the leader, the palette, then Enter (detail from the list, instances from the detail, with Tab back before it), n spawn, then help and quit, a key a row; given up from its end where the list leaves it too few rows; i, the filter, r, Esc and the workspaces are not on it", () => {
  const all = (enter) => hints(["Ctrl+K", "palette"], ["Enter", enter], ["n", "spawn"], ["?", "help"], ["q", "quit"]);
  for (const sz of [S60T, S80, S120]) {
    const d = drawModel(soulsModel(), sz);
    assert.deepEqual(sheet(d, sz), all("detail"), `list at ${sz.cols}x${sz.rows}`);
    assert.equal(sheet(d, sz).some((line) => /^ (i|\/|r|Esc|w) /.test(line)), false, `${sz.cols}: no i, filter, refresh, close or workspaces`);
    const r = d.lines.findIndex((line) => line.startsWith(LEAD));
    assert.deepEqual([d.cells[r].slice(1, 7).every((cell) => cell.style.bold), d.cells[r][10].style.bold], [true, false], `${sz.cols}: the key is bold, its word plain`);
  }
  // 60x15: the list keeps its four rows, and the sheet has the three that are left.
  assert.deepEqual(sheet(drawModel(soulsModel(), S60), S60), all("detail").slice(0, 3), "list at 60x15");
  // The detail has the focus beside the sidebar from 80 columns: Tab back comes right after the palette; under them it is a page of its own, with no sheet.
  const detailed = hints(["Ctrl+K", "palette"], ["Tab", "back"], ["Enter", "instances"], ["n", "spawn"], ["?", "help"], ["q", "quit"]);
  for (const sz of [S80, S120]) assert.deepEqual(sheet(drawModel(soulsModel({ focus: "detail" }), sz), sz), detailed, `detail at ${sz.cols}`);
  assert.equal(drawModel(soulsModel({ focus: "detail" }), S60T).lines.some((line) => line.includes("commands")), false, "detail at 60x24");
  // With no soul selected there is no Enter; with no workspace of this machine, no spawn either: the leader, the palette, help and quit.
  const reading = hints(["Ctrl+K", "palette"], ["n", "spawn"], ["?", "help"], ["q", "quit"]);
  const away = hints(["Ctrl+K", "palette"], ["?", "help"], ["q", "quit"]);
  for (const sz of [S60, S80, S120]) {
    // The list's one row leaves the sheet its five rows even at 60x15.
    assert.deepEqual(sheet(drawModel(soulsModel({ state: "reading", list: [], detail: null }), sz), sz), reading, `reading at ${sz.cols}`);
    assert.deepEqual(sheet(drawModel(soulsModel({ local: false, state: "none", list: [], detail: null }), sz), sz), away, `no workspace at ${sz.cols}`);
  }
});

test("under 80 columns the detail page's first row carries its keys at the right, dim, Tab back first: at 70x20, `> acme-ledger-developer`, then, ending a cell before the edge, Tab back, Enter instances and n spawn", () => {
  const sz = size(70, 20), d = drawModel(soulsModel({ focus: "detail" }), sz);
  fits(d, sz, "70x20");
  assert.equal(d.lines[0], ` > acme-ledger-developer${" ".repeat(9)}Tab back   Enter instances   n spawn`);
  const from = cellIndexOf(d, 0, "Tab back");
  assert.equal(from, 33, "the keys end a cell before the edge");
  for (let x = from; x < from + 36; x++) if (d.cells[0][x].text !== " ") assert.equal(d.cells[0][x].style.dim, true, `the keys are dim at ${x}`);
  assert.deepEqual([d.cells[0][1].style.bold, d.cells[0][3].style.bold, d.cells[0][3].style.dim], [true, true, false], "the focus mark and the title stay bold");
});

test("a kept filter of the Souls view stands on its heading as the list's does, `Souls  /query`, bold, and the sheet is the list's; while it is typed the heading row is the filter field, and the sheet says Enter keeps it and Esc clears it", () => {
  for (const sz of [S60, S80, S120]) {
    const pane = paneOf(sz), kept = drawModel(soulsModel({ filter: { editing: false, query: "dev" } }), sz), at = `${sz.cols}`;
    const heading = listTop(kept, sz) - 1;
    assert.equal(cellText(kept, heading, 0, pane), `${" Souls  /dev".padEnd(pane - 2)}2`, at);
    for (const x of [8, 9, 10, 11]) assert.equal(kept.cells[heading][x].style.bold, true, `${at}: the kept filter is bold at ${x}`);
    assert.deepEqual(sheet(kept, sz), sheet(drawModel(soulsModel(), sz), sz), `${at}: the list's sheet`);
    const editing = drawModel(soulsModel({ filter: { editing: true, query: "de" } }), sz);
    assert.equal(cellText(editing, heading, 0, pane), `${" /de".padEnd(pane - 2)}2`, `${at}: the field`);
    assert.deepEqual([editing.cells[heading][1].style.bold, editing.cells[heading][2].style.bold], [true, false], `${at}: the field's / is bold, what is typed is not`);
    assert.deepEqual(sheet(editing, sz), hints(["Enter", "keep"], ["Esc", "clear"]), `${at}: the field's keys`);
  }
  // The souls' filter is the view's own: the Instances view's filter is not shown in the Souls view.
  const m = soulsModel();
  assert.equal(drawModel({ ...m, filter: { editing: false, query: "elsewhere" } }, S120).lines.some((line) => line.includes("elsewhere")), false);
});

// ── Text from outside ───────────────────────────────────────────────────────────────────────────

test("hostile text in a soul's name, description, origin, harness, teams, capabilities, instances and a failed read leaves no control or bidi character on the screen", () => {
  const evil = (word) => `${word}\x1b[31m\u202e\u2066red\x07\x9b2J\u200f${word}`;
  const detail = {
    ...DETAIL(), name: evil("name"), description: evil("description"), from: evil("from"), works: evil("works"), refusal: evil("Can't spawn here"),
    harness: { rows: [[evil("Harness"), evil("value")]], notes: [evil("note")], problem: { lead: evil("lead"), lines: [evil("line")], code: evil("code") } },
    teams: [{ label: evil("team"), default: true }], capabilities: [evil("cap")], instances: { shown: [{ name: evil("inst"), mark: "running" }], more: 0 },
  };
  const models = (ascii) => [
    soulsModel({ list: [{ ...LIST()[0], name: evil("soul") }], detail }, { ascii }),
    soulsModel({ focus: "detail", list: [{ ...LIST()[0], name: evil("soul") }], detail }, { ascii }),
    soulsModel({ state: "failed", failure: evil("Couldn't read"), list: [], detail: null }, { ascii }),
    soulsModel({ heading: { ...HEADING, short: evil("Couldn't read") }, filter: { editing: false, query: evil("q") } }, { ascii }),
    soulsModel({ filter: { editing: true, query: evil("q") } }, { ascii }),
  ];
  for (const ascii of modes) for (const sz of SIZES) models(ascii).forEach((m, i) => {
    const d = drawModel(m, sz), at = `${i} ${ascii} ${sz.cols}x${sz.rows}`;
    fits(d, sz, at);
    for (const line of d.cells) for (const cell of line) assert.doesNotMatch(cell.text, CONTROL, `${at}: ${JSON.stringify(cell.text)}`);
  });
});

// ── The whole path ──────────────────────────────────────────────────────────────────────────────

test("through the store and the model: 2 shows the view reading, the catalog's rows then stand with the selected soul's detail, and a failed re-read keeps them under its heading", () => {
  const cli = { ...CLI, features: [...CLI.features, "desktop-facts"] };
  const entry = observed(ROWS(), { cli });
  const souls = entry.deployment.souls.map((soul) => (soul.name === "dev" ? { ...soul, color: "Sage" } : soul));
  let state = press(stateOf({ ...entry, deployment: { ...entry.deployment, souls } }, { cli }), ["2"]).state;
  assert.equal(cellText(draw(state), 5, 0, 38), "   Reading souls…", "under the title, its empty row, Instances, the rule and the Souls row");
  state = soulsTold(state, catalogEntry([catalogSoul("dev"), catalogSoul("ops", { spawnable: false, problem: { message: "No launch configuration matches." } })]));
  const d = draw(state);
  fits(d, S80, "rows");
  assert.equal(cellText(d, 5, 0, 38), `> ${SOUL_MARK.utf8} dev ${COUNT_SIGN.utf8}2`);
  assert.equal(cellText(d, 6, 0, 38), `  ${SOUL_MARK.utf8} ops !`);
  assert.equal(detailLines(d, S80)[0].trim(), "dev");
  assert.equal(detailLines(d, S80).some((line) => line.includes(`${MARKS.utf8.running} dev-a  ${MARKS.utf8.stopped} dev-b`)), true, "this machine's instances of the soul");
  state = soulsTold(state, catalogEntry([catalogSoul("dev")], { reason: { code: "E_CLI_FAILED", message: "oats souls exited 1" } }));
  const kept = draw(state);
  assert.equal(cellText(kept, 5, 0, 38).startsWith(" Couldn't read"), true, "the sentence from the margin, under the Souls row");
  assert.equal(cellText(kept, 6, 0, 38).startsWith(`> ${SOUL_MARK.utf8} dev`), true);
  // The heading has room for the start of the sentence; the detail holds it whole, under the name.
  const detail = detailLines(kept, S80).map((line) => line.trim()).filter(Boolean);
  assert.equal(detail[0], "dev");
  assert.equal(detail.slice(1, 3).join(" "), "Couldn't read this workspace's souls: oats souls exited 1", detail.join("\n"));
  assert.equal(detailLines(draw(soulsTold(state, catalogEntry([catalogSoul("dev")]))), S80).some((line) => line.includes("Couldn't read")), false, "a read that works again takes it away");
});

test("i from the Souls view: the Instances view's heading names the kept soul filter as `soul <name>`, bold, where a text filter's `/` stands, and the cheat sheet is the text filter's, the list's small sheet, with no Esc on it; Esc clears it, and `/` replaces it with a text filter", () => {
  const cli = { ...CLI, features: [...CLI.features, "desktop-facts"] };
  let state = press(stateOf(observed(ROWS(), { cli }), { cli }), ["2"]).state;
  state = soulsTold(state, catalogEntry([catalogSoul("dev")]));
  state = press(state, ["i"]).state;
  assert.equal(state.view, "instances");
  // The Instances view's heading is the row under the title's empty row.
  const heading = (d, sz) => cellText(d, 2, 0, paneOf(sz));
  // As a text filter kept with `/dev` stands, hint for hint.
  const text = press(state, ["/", "d", "e", "v", "enter"]).state;
  for (const sz of [S80, S120]) {
    const d = draw(state, sz), pane = paneOf(sz);
    assert.equal(heading(d, sz), `${" Instances  soul dev".padEnd(pane - 2)}1`, `${sz.cols}`);
    assert.equal(heading(draw(text, sz), sz), `${" Instances  /dev".padEnd(pane - 2)}1`, `${sz.cols}: the text filter's`);
    for (const at of [12, 17]) assert.equal(d.cells[2][at].style.bold, true, `${sz.cols}: bold at ${at}`);
    assert.deepEqual(sheet(d, sz), sheet(draw(text, sz), sz), `${sz.cols}: the same keys`);
    assert.deepEqual(sheet(d, sz), hints(["Ctrl+K", "palette"], ["Enter", "open"], ["n", "spawn"], ["w", "workspaces"], ["?", "help"], ["q", "quit"]), `${sz.cols}: the list's sheet; Esc that clears the filter is the help's and the palette's`);
  }
  const cleared = press(state, ["escape"]).state;
  assert.equal(cleared.filter.soul, undefined);
  assert.equal(heading(draw(cleared), S80), `${" Instances".padEnd(36)}1`);
  assert.deepEqual(sheet(draw(cleared), S80), sheet(draw(state), S80), "the sheet is the same with nothing left to clear");
  const typed = press(state, ["/", "a"]).state;
  assert.deepEqual([typed.filter.soul, typed.filter.query], [undefined, "a"]);
  assert.equal(heading(draw(typed), S80), `${" /a".padEnd(36)}1`, "the text filter replaces it: the heading is its field");
});
