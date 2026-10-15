process.env.TZ = "UTC";
// The Souls view as the frame draws it (Spec 6-view, Done 2 and 3): the list of souls, the selected
// soul's detail, the bodies of the catalog's states, and the footer. The model is the frame's
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
import { MARKS } from "../lib/views/instances.mjs";
import { COUNT_SIGN, SOULS_TEXT, SOUL_COLOURS, SOUL_MARK } from "../lib/views/souls.mjs";
import { CLI, NOW, catalogEntry, catalogSoul, draw, instanceRow, observed, press, soulsTold, stateOf } from "./helpers.mjs";

const size = (cols, rows) => ({ cols, rows });
const S60 = size(60, 15), S60T = size(60, 24), S79 = size(79, 24), S80 = size(80, 24), S120 = size(120, 40);
const SIZES = [S60, S60T, S79, S80, S120];
const AT = new Date(NOW).toISOString();
/** The list pane's width on a wide terminal (views/frame.mjs layout), and where the detail starts. */
const listWidth = (cols) => Math.min(Math.max(Math.floor(cols * 0.48), 36), 60);
const paneOf = (sz) => (sz.cols >= WIDE ? listWidth(sz.cols) : sz.cols);
const detailAt = (sz) => (sz.cols >= WIDE ? listWidth(sz.cols) + 1 : 0);
/** What no cell may hold: a control character (C0, DEL, C1) or a bidi control. */
const CONTROL = /[\p{Cc}\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;
const LEAD = "C-\\ commands   ";
const modes = [false, true];

// ── The model the frame is handed ───────────────────────────────────────────────────────────────

/** The real model of a small Instances view: the header, the actions and the footer's keys. */
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
const HEADING = { label: "Souls", path: null, state: null, short: FAILURE, readAt: "09:59:30" };

/** Draw a model as the main loop draws it after the model step (helpers.mjs `draw`). */
function drawModel(m, sz) {
  const made = frame(m, sz);
  const cells = createScreen({ utf8: true, ascii: m.ascii }).cells(made.rows, sz);
  return { ...made, cells, lines: cells.map((line) => line.map((cell) => cell.text).join("").trimEnd()) };
}
const cellText = (d, r, from = 0, to = Infinity) => d.cells[r].slice(from, to).map((cell) => cell.text).join("").trimEnd();
const bodyRows = (sz) => Array.from({ length: sz.rows - 4 }, (_, i) => 3 + i);
const listLines = (d, sz) => bodyRows(sz).map((r) => cellText(d, r, 0, paneOf(sz)));
const detailLines = (d, sz) => bodyRows(sz).map((r) => cellText(d, r, detailAt(sz)));
const footer = (d, sz) => d.lines[sz.rows - 1];
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
const glyphs = (ascii) => (ascii ? { rule: "-", joint: "+", bar: "|", cut: "...", mark: "#", count: "x" } : { rule: "─", joint: "┬", bar: "│", cut: "…", mark: "■", count: "·" });

// ── The whole screen ────────────────────────────────────────────────────────────────────────────

test("the Souls view at 80x24 in UTF-8, cell for cell: the souls in the list's place, the panes' rule with its joint, and the selected soul's detail beside them, scrolled with its cut note", () => {
  const d = drawModel(soulsModel(), S80);
  assert.deepEqual(d.lines, [
    " acme-platform                                             1 running  1 stopped",
    "  Instances   Souls   Capabilities                                read 10:00:00",
    "──────────────────────────────────────┬─────────────────────────────────────────",
    "> ■ acme-ledger-developer ·3          │   acme-ledger-developer",
    "  ■ reviewer                          │   Builds and maintains the ledger",
    "  ■ ops !                             │   service: its API, its storage and its",
    "  ■ a-soul-whose-name-is-far-l… ! ·12 │   tests, end to end.",
    "                                      │   from     oats-core · package acme",
    "                                      │            1.2.0",
    "                                      │   works    works in its own worktree",
    "                                      │   Can't spawn here · No launch",
    "                                      │   configuration matches.",
    "                                      │   harness",
    "                                      │     Harness",
    "                                      │       Claude Code",
    "                                      │     Model",
    "                                      │       claude-opus-5-5",
    "                                      │     Launch configuration",
    "                                      │       fast",
    "                                      │     Chosen by",
    "                                      │       the soul",
    "                                      │     Set in soul.yaml",
    "                                      │   14 more below",
    `${LEAD}Enter detail   i instances   Esc close   ? help   q quit`,
  ]);
  assert.deepEqual([d.page, d.room, d.extent], [20, 20, 33], "the list pane's rows, and the detail's rows shown and held");
  assert.equal(d.cells[1].slice(13, 20).every((cell) => cell.style.reverse), true, "Souls is the open view");
});

test("the Souls view at 60x15 in ASCII, cell for cell: the list alone, with the ASCII marks and count", () => {
  const d = drawModel(soulsModel({}, { ascii: true }), S60);
  assert.deepEqual(d.lines, [
    " acme-platform                         1 running  1 stopped",
    "  Instances   Souls   Capabilities            read 10:00:00",
    "-".repeat(60),
    "> # acme-ledger-developer x3",
    "  # reviewer",
    "  # ops !",
    "  # a-soul-whose-name-is-far-longer-than-any-list-... ! x12",
    "", "", "", "", "", "", "",
    `${LEAD}Enter detail   i instances   ? help   q quit`,
  ]);
});

// ── The list ────────────────────────────────────────────────────────────────────────────────────

test("a soul's row: its mark in its colour (uncoloured with none), its name, `!` and dim for a refused soul, a dim count of its instances here only when it has some, and the selection as `>` and reverse over the row", () => {
  for (const ascii of modes) for (const sz of SIZES) {
    const d = drawModel(soulsModel({}, { ascii }), sz), at = `${ascii ? "ascii" : "utf8"} ${sz.cols}x${sz.rows}`, g = glyphs(ascii), pane = paneOf(sz);
    fits(d, sz, at);
    const [chosen, reviewer, ops, long] = [3, 4, 5, 6];
    for (const r of [chosen, reviewer, ops, long]) assert.equal(d.cells[r][2].text, g.mark, `${at}: the soul's mark at column 2`);
    // The colours: one of the sixteen, from the model; none, the mark is plain.
    assert.deepEqual([d.cells[reviewer][2].style.fg, d.cells[reviewer][2].style.dim], ["magenta", false], `${at}: reviewer's mark is magenta`);
    assert.equal(d.cells[ops][2].style.fg, null, `${at}: no colour, an uncoloured mark`);
    assert.deepEqual([d.cells[long][2].style.fg, d.cells[long][2].style.dim], ["blue", true], `${at}: a refused soul's mark keeps its colour, dim`);
    // The selected row: `>` in the first cell, the whole row of the pane in reverse.
    assert.equal(d.cells[chosen][0].text, ">", at);
    assert.equal(d.cells[chosen].slice(0, pane).every((cell) => cell.style.reverse), true, `${at}: the selected row is in reverse over the pane`);
    assert.equal(d.cells[reviewer].slice(0, pane).some((cell) => cell.style.reverse), false, `${at}: no other row is`);
    // The name at column 4; a count only where there are instances here.
    assert.equal(cellText(d, chosen, 4, pane), `acme-ledger-developer ${g.count}3`, at);
    assert.equal(cellText(d, reviewer, 4, pane), "reviewer", `${at}: no count for none`);
    assert.equal(cellText(d, reviewer, 0, pane).includes(g.count), false, at);
    // A refused soul: dim, with `!` after its name.
    assert.equal(cellText(d, ops, 4, pane), "ops !", at);
    for (const x of [4, 5, 6, 8]) assert.equal(d.cells[ops][x].style.dim, true, `${at}: the refused row is dim, its \`!\` too`);
    // The long name is cut, the `!` and the count whole at the pane's edge less one cell.
    const longText = cellText(d, long, 4, pane);
    assert.equal(longText.endsWith(`${g.cut} ! ${g.count}12`), true, `${at}: ${longText}`);
    assert.equal(textWidth(cellText(d, long, 0, pane)), pane - 1, `${at}: one cell is kept at the edge`);
    const count = cellIndexOf(d, long, `${g.count}12`);
    for (const cell of d.cells[long].slice(count, count + 3)) assert.equal(cell.style.dim, true, `${at}: the count is dim`);
  }
});

test("the colour table maps the soul palette's six names onto the terminal's sixteen, and the marks are ■ and #", () => {
  assert.deepEqual(SOUL_COLOURS, { sand: "yellow", sage: "green", slate: "blue", mauve: "magenta", clay: "red", olive: "cyan" });
  assert.equal(Object.isFrozen(SOUL_COLOURS), true);
  assert.deepEqual([SOUL_MARK.utf8, SOUL_MARK.ascii, COUNT_SIGN.utf8, COUNT_SIGN.ascii], ["■", "#", "·", "x"]);
  // Every colour of the table draws as itself.
  for (const colour of Object.values(SOUL_COLOURS)) {
    const d = drawModel(soulsModel({ list: [{ name: "one", color: colour, count: 1, refused: false, selected: false }] }), S80);
    assert.equal(d.cells[3][2].style.fg, colour, colour);
  }
});

test("the list is cut by the model's window: what is cut off is said on the pane's last row, and the rows stand above it", () => {
  for (const sz of SIZES) {
    const d = drawModel(soulsModel({ list: LIST().slice(0, 2), above: 4, below: 7 }), sz), at = `${sz.cols}x${sz.rows}`;
    assert.equal(listLines(d, sz).at(-1), "   4 more above, 7 more below", at);
    assert.equal(cellText(d, 3, 4, paneOf(sz)).startsWith("acme-ledger-developer"), true, at);
  }
});

// ── The detail ──────────────────────────────────────────────────────────────────────────────────

test("the detail holds every section, top to bottom: the bold name, the description, from, works, the refusal in the warning style, the harness, teams, capabilities, the instances here with their marks and +n, and the key that shows them", () => {
  for (const ascii of modes) {
    const sz = S120, d = drawModel(soulsModel({}, { ascii }), sz), at = ascii ? "ascii" : "utf8", x = detailAt(sz), marks = ascii ? MARKS.ascii : MARKS.utf8;
    fits(d, sz, at);
    const lines = detailLines(d, sz);
    assert.deepEqual(lines.slice(0, 24), [
      "   acme-ledger-developer",
      "   Builds and maintains the ledger service: its API, its",
      "   storage and its tests, end to end.",
      "   from     oats-core · package acme 1.2.0",
      "   works    works in its own worktree",
      "   Can't spawn here · No launch configuration matches.",
      "   harness",
      "     Harness               Claude Code",
      "     Model                 claude-opus-5-5",
      "     Launch configuration  fast",
      "     Chosen by             the soul",
      "     Set in soul.yaml",
      "     A spawn of this soul with no launch chosen would be",
      "     refused here.",
      "     OATS says: no harness is installed",
      "     Install one.",
      "     code E_NO_HARNESS",
      "   teams    core (default), ops",
      "   capabilities",
      "     oats.core, oats.aweb, acme.ledger-tools",
      "   instances here",
      `     ${marks.running} dev-0  ${marks.stopped} dev-1  ${marks.shell} dev-2  ${marks.unknown} dev-3  ${marks.held} dev-4  ${marks.running} dev-5`,
      `     ${marks.stopped} dev-6  ${marks.shell} dev-7  +3`,
      "     i shows them in the Instances view.",
    ], at);
    const row = (word) => rowWith(d, sz, word, x);
    // The name is bold; the labels are dim; the refusal is bold yellow, and says what it is in words.
    assert.equal(d.cells[3][x + 3].style.bold, true, `${at}: the name is bold`);
    for (const label of ["from", "works", "harness", "teams", "capabilities", "instances here"]) {
      const r = row(`  ${label}`), col = cellIndexOf(d, r, label, x);
      assert.equal(d.cells[r].slice(col, col + label.length).every((cell) => cell.style.dim), true, `${at}: ${label} is dim`);
    }
    const refusal = row("Can't spawn here"), from = cellIndexOf(d, refusal, "Can't", x);
    assert.deepEqual([d.cells[refusal][from].style.bold, d.cells[refusal][from].style.fg], [true, "yellow"], `${at}: the warning style`);
    // The note and the code are dim, the problem's lead bold, its kernel lines plain.
    assert.equal(d.cells[row("Set in soul.yaml")][x + 5].style.dim, true, `${at}: a note is dim`);
    assert.equal(d.cells[row("A spawn of this soul")][x + 5].style.bold, true, `${at}: the problem's lead is bold`);
    assert.equal(d.cells[row("OATS says")][x + 5].style, PLAIN, `${at}: its lines are plain`);
    assert.equal(d.cells[row("code E_NO_HARNESS")][x + 10].style.dim, true, `${at}: its code is dim`);
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
      assert.deepEqual(detailLines(d, sz).filter(Boolean).map((line) => line.trim().replace(/^> /, "")), ["bare", "from     oats-core"], at);
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
  assert.deepEqual(harness(S80, "list").map((line) => line.trimEnd()), ["     Harness", "       Claude Code", "     Model", "       claude-opus-5-5", "     Launch configuration", "       fast", "     Chosen by", "       the soul"]);
  for (const [sz, lead] of [[S120, "     "], [S60T, "     "]]) {
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

test("the detail with the focus says so with `>` beside its title, beside the list at 80 columns and up, and in the list's place under 80, where the list is not drawn", () => {
  for (const ascii of modes) {
    for (const sz of [S80, S120]) {
      const d = drawModel(soulsModel({ focus: "detail" }, { ascii }), sz), x = detailAt(sz), at = `${ascii} ${sz.cols}`;
      assert.deepEqual([d.cells[3][x + 1].text, d.cells[3][x + 1].style.bold], [">", true], at);
      assert.equal(cellText(d, 3, 0, paneOf(sz)).startsWith(">"), true, `${at}: the list stays beside it`);
      const listing = drawModel(soulsModel({ focus: "list" }, { ascii }), sz);
      assert.equal(listing.cells[3][x + 1].text, " ", `${at}: no mark while the list has the focus`);
    }
    for (const sz of [S60, S60T, S79]) {
      const at = `${ascii} ${sz.cols}x${sz.rows}`;
      const paged = drawModel(soulsModel({ focus: "detail" }, { ascii }), sz);
      fits(paged, sz, at);
      assert.equal(paged.lines[3], " > acme-ledger-developer", `${at}: the detail in the list's place, at the margin`);
      assert.equal(paged.lines.some((line) => line.includes("reviewer")), false, `${at}: no row of the list`);
      assert.equal(paged.lines[2], (ascii ? "-" : "─").repeat(sz.cols), `${at}: one pane, no joint`);
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

test("the catalog's states, at every width in UTF-8 and ASCII: reading, a failed first read with the key that reads again, an empty catalog naming `oats souls`, and no workspace of this machine each take the whole width, with no pane beside them", () => {
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
      assert.equal(d.lines[2], (ascii ? "-" : "─").repeat(sz.cols), `${at(what)}: no joint`);
      assert.deepEqual(d.lines.slice(3, sz.rows - 1).filter(Boolean), said(ascii).map((line) => `   ${line}`), at(what));
      assert.equal(d.cells[3][3].style.dim, true, `${at(what)}: the TUI's line is dim`);
    }
    const failed = drawModel(soulsModel({ state: "failed", failure: FAILURE, list: [], detail: null }, { ascii }), sz);
    fits(failed, sz, at("failed"));
    const said = failed.lines.slice(3, sz.rows - 1).filter(Boolean);
    assert.equal(said.at(-1), "   r reads them again.", at("failed"));
    assert.equal(said.slice(0, -1).map((line) => line.trim()).join(" "), FAILURE, `${at("failed")}: the whole sentence, wrapped`);
    assert.equal(failed.cells[3][3].style, PLAIN, `${at("failed")}: the sentence is not the TUI's, and not dim`);
    assert.equal(failed.lines[2], (ascii ? "-" : "─").repeat(sz.cols), `${at("failed")}: no joint`);
  }
  assert.equal(SOULS_TEXT.reading, "Reading souls…");
});

test("no soul matching the filter, and a failed re-read: the list stands with its pane beside it; the re-read's heading says the failure and the age of the rows it kept, and the rows follow it", () => {
  for (const ascii of modes) for (const sz of SIZES) {
    const at = (what) => `${what} ${ascii ? "ascii" : "utf8"} ${sz.cols}x${sz.rows}`, g = glyphs(ascii);
    const nomatch = drawModel(soulsModel({ state: "nomatch", list: [], detail: null, filter: { editing: false, query: "zzz" } }, { ascii }), sz);
    fits(nomatch, sz, at("nomatch"));
    assert.deepEqual(listLines(nomatch, sz).filter(Boolean), ["   No soul matches the filter."], at("nomatch"));
    if (sz.cols >= WIDE) assert.equal(nomatch.cells[2][listWidth(sz.cols)].text, g.joint, `${at("nomatch")}: the panes' joint`);

    const kept = drawModel(soulsModel({ heading: HEADING, list: LIST().slice(0, 2) }, { ascii }), sz);
    fits(kept, sz, at("kept"));
    const heading = cellText(kept, 3, 0, paneOf(sz));
    assert.equal(heading.startsWith(" Souls  Couldn't re"), true, `${at("kept")}: ${heading}`);
    assert.equal(heading.endsWith("read 09:59:30"), true, `${at("kept")}: the age of the rows`);
    assert.equal(kept.cells[3][1].style.bold, true, `${at("kept")}: the heading's label is bold`);
    assert.equal(cellText(kept, 4, 0, paneOf(sz)).startsWith(`> ${g.mark} acme-ledger-developer`), true, `${at("kept")}: the rows follow`);
    if (sz.cols >= WIDE) assert.equal(detailLines(kept, sz)[0].trim(), "acme-ledger-developer", `${at("kept")}: the detail beside them`);

    const empty = drawModel(soulsModel({ heading: HEADING, state: "none", list: [], detail: null }, { ascii }), sz);
    assert.deepEqual(listLines(empty, sz).filter(Boolean).slice(1).map((line) => line.trim()).join(" "), "This workspace offers no souls. `oats souls` says why.", at("kept none"));
    for (const line of listLines(empty, sz)) assert.equal((line.match(/`/g) ?? []).length % 2, 0, `${at("kept none")}: the command is whole on its row: ${line}`);
  }
});

// ── The footer ──────────────────────────────────────────────────────────────────────────────────

test("the Souls view's footer: the leader, then Enter (detail from the list, instances from the detail), i, the filter, r, Esc and the workspaces, given up from the workspaces to Esc, then help and quit; no spawn key", () => {
  const all = (enter) => `${LEAD}Enter ${enter}   i instances   / filter   r refresh   Esc close   w workspaces   ? help   q quit`;
  const expected = {
    list: { 120: all("detail"), 80: `${LEAD}Enter detail   i instances   Esc close   ? help   q quit`, 60: `${LEAD}Enter detail   i instances   ? help   q quit` },
    detail: { 120: all("instances"), 80: `${LEAD}Enter instances   i instances   Esc close   ? help   q quit`, 60: `${LEAD}Enter instances   ? help   q quit` },
  };
  for (const focus of ["list", "detail"]) for (const sz of [S60, S80, S120]) {
    const d = drawModel(soulsModel({ focus }), sz);
    assert.equal(footer(d, sz), expected[focus][sz.cols], `${focus} at ${sz.cols}`);
    assert.equal(/\bn spawn|\bN\b/.test(footer(d, sz)), false, "no spawn key");
  }
  // With no soul selected there is no Enter and no i; with no workspace of this machine, Esc and the workspaces alone.
  for (const sz of [S60, S80, S120]) {
    const reading = { 120: `${LEAD}/ filter   r refresh   Esc close   w workspaces   ? help   q quit`, 80: `${LEAD}/ filter   r refresh   Esc close   ? help   q quit`, 60: `${LEAD}/ filter   Esc close   ? help   q quit` };
    assert.equal(footer(drawModel(soulsModel({ state: "reading", list: [], detail: null }), sz), sz), reading[sz.cols], `reading at ${sz.cols}`);
    assert.equal(footer(drawModel(soulsModel({ local: false, state: "none", list: [], detail: null }), sz), sz), `${LEAD}Esc close   w workspaces   ? help   q quit`, `no workspace at ${sz.cols}`);
  }
});

test("a kept filter of the Souls view stands in the footer as the list's does, `/query`, with Enter kept beside it; while it is typed the footer is the filter field", () => {
  const kept = (sz) => drawModel(soulsModel({ filter: { editing: false, query: "dev" } }), sz);
  assert.equal(footer(kept(S120), S120), `${`${LEAD}/dev`.padEnd(39)}Enter detail   i instances   / filter   r refresh   Esc close   ? help   q quit`);
  assert.equal(footer(kept(S80), S80), `${`${LEAD}/dev`.padEnd(39)}Enter detail   ? help   q quit`);
  assert.equal(footer(kept(S60), S60), `${`${LEAD}/dev`.padEnd(29)}Enter detail   ? help   q quit`);
  for (const sz of [S60, S80, S120]) {
    const d = kept(sz);
    assert.equal(d.cells[sz.rows - 1][LEAD.length].style.bold, true, `${sz.cols}: the kept filter's / is bold`);
    const editing = drawModel(soulsModel({ filter: { editing: true, query: "de" } }), sz);
    assert.equal(footer(editing, sz), `${`${LEAD}/de`.padEnd(sz.cols - 1 - "Enter keep   Esc clear".length)}Enter keep   Esc clear`, `${sz.cols}: the field`);
  }
  // The souls' filter is the view's own: the Instances view's filter is not shown in the Souls view.
  const m = soulsModel();
  assert.equal(footer(drawModel({ ...m, filter: { editing: false, query: "elsewhere" } }, S120), S120).includes("elsewhere"), false);
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
  assert.equal(draw(state).lines[3], "   Reading souls…");
  state = soulsTold(state, catalogEntry([catalogSoul("dev"), catalogSoul("ops", { spawnable: false, problem: { message: "No launch configuration matches." } })]));
  const d = draw(state);
  fits(d, S80, "rows");
  assert.equal(cellText(d, 3, 0, 38), `> ${SOUL_MARK.utf8} dev ${COUNT_SIGN.utf8}2`);
  assert.equal(cellText(d, 4, 0, 38), `  ${SOUL_MARK.utf8} ops !`);
  assert.equal(detailLines(d, S80)[0].trim(), "dev");
  assert.equal(detailLines(d, S80).some((line) => line.includes(`${MARKS.utf8.running} dev-a  ${MARKS.utf8.stopped} dev-b`)), true, "this machine's instances of the soul");
  state = soulsTold(state, catalogEntry([catalogSoul("dev")], { reason: { code: "E_CLI_FAILED", message: "oats souls exited 1" } }));
  const kept = draw(state);
  assert.equal(cellText(kept, 3, 0, 38).startsWith(" Souls  Couldn't read"), true);
  assert.equal(cellText(kept, 4, 0, 38).startsWith(`> ${SOUL_MARK.utf8} dev`), true);
});
