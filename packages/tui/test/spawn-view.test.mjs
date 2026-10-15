process.env.TZ = "UTC";
// The spawn prompt as the frame draws it (Spec 6-spawn, Done 2, 3 and 6; Settled 1, 2 and 9): the
// soul picker, the preview, their footers and the help's section. The prompt's model is the frame's
// contract (lib/model.mjs, `m.spawn`), made here by hand over a real model of the Instances view,
// so each case says exactly what the view is handed. The preview's facts are the shared home's
// (previewFacts), computed by calling it. What a test claims about the screen it reads from the
// screen's cells, never from a string's length.
import test from "node:test";
import assert from "node:assert/strict";
import { ACTIONS } from "../lib/actions.mjs";
import { previewFacts } from "../lib/client.mjs";
import { model } from "../lib/model.mjs";
import { reduce } from "../lib/store.mjs";
import { createScreen } from "../lib/term/screen.mjs";
import { textWidth } from "../lib/term/width.mjs";
import { frame, terminalArea } from "../lib/views/frame.mjs";
import { SPAWN_KEYS, SPAWN_RULES, helpRows, keysLabel } from "../lib/views/help.mjs";
import { cutNote } from "../lib/views/instances.mjs";
import { SPAWN_TEXT, previewRows } from "../lib/views/spawn.mjs";
import { NOW, instanceRow, observed, readTerminalOutput, rowStrings, stateOf } from "./helpers.mjs";

const size = (cols, rows) => ({ cols, rows });
const S60 = size(60, 15), S80 = size(80, 24), S120 = size(120, 40);
const AT = new Date(NOW).toISOString();
const LEAD = "C-\\ commands   ";
/** The body's first row: under the header's two rows and the rule. */
const TOP = 3;
/** What no cell may hold: a control character (C0, DEL, C1) or a bidi control. */
const CONTROL = /[\p{Cc}\u061c\u200e\u200f\u2028\u2029\u202a-\u202E\u2066-\u2069]/u;
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

// ── The model the frame is handed ───────────────────────────────────────────────────────────────

/** The real model of a small Instances view: the header, the actions and the footer's keys. */
const baseModel = (ascii = false) => model(stateOf(observed([instanceRow("dev", "dev-a"), instanceRow("dev", "dev-b")]), { ascii }), { page: 19, now: NOW, at: AT, cols: 38 });
function drawModel(m, sz) {
  const made = frame(m, sz);
  const cells = createScreen({ utf8: true, ascii: m.ascii }).cells(made.rows, sz);
  return { ...made, cells, lines: cells.map((line) => line.map((cell) => cell.text).join("").trimEnd()) };
}
const drawSpawn = (spawn, sz, { ascii = false } = {}) => drawModel({ ...baseModel(ascii), spawn }, sz);
const footer = (d, sz) => d.lines[sz.rows - 1];
const bodyLines = (d, sz) => d.lines.slice(TOP, sz.rows - 1);
/** The cell index at which `word` is first drawn in row `r`, or -1. */
function cellIndexOf(d, r, word, from = 0) {
  const cells = d.cells[r];
  for (let x = from; x + word.length <= cells.length; x++) if (cells.slice(x, x + word.length).map((cell) => cell.text).join("") === word) return x;
  return -1;
}
/** The screen row whose text starts (after its blanks) with `start`. */
const rowStarting = (d, start) => d.lines.findIndex((line, r) => r >= TOP && line.trimStart().startsWith(start));

/** The picker: `dev` selected, `ops` refused with the shared refusal line. */
const REFUSAL = "Can't spawn here · No launch configuration matches.";
const pickerOf = (extra = {}) => ({
  step: "picker", query: "o", state: "rows", failure: null, above: 0, below: 0,
  rows: [{ name: "dev", refused: false, refusal: null, selected: true }, { name: "ops", refused: true, refusal: REFUSAL, selected: false }, { name: "docs", refused: false, refusal: null, selected: false }],
  ...extra,
});

/** A preview projection as the shared preview reads it (spawn-preview-contract.mjs previewData). */
const DATA = Object.freeze({
  home: "/srv/deploy/agents/dev/instances/dev-3", subject: { dir: "/srv/deploy" }, work: "worktree", branch: "agents/dev-3", base: { ref: "main" },
  harness: "claude", model: "claude-opus-5-5", modelSource: "soul", defaultTeam: { label: "eng" }, teams: [{ label: "eng" }, { label: "ops" }],
  relation: "child", decision: { effective: { relation: { anchor: { instance: "dev-a" } } } },
  launchPromptAnswers: { awebDevelopmentChannel: false }, warnings: ["The capability gh has no token.\nIt reads none at start."],
  modules: [{ name: "aweb", layer: "messaging", from: { kind: "package", package: "aweb", version: "1.0.0" }, composedFrom: "workspace" }, { name: "gh", layer: "tool", from: { kind: "member", repoKey: "acme/oats" }, composedFrom: "soul" }],
});
const factsOf = (data = DATA, name = null) => previewFacts(data, { name, runsOn: "this machine", cli: null });
const FOLDS = Object.freeze([["prompts", "Launch prompts", "none answered"], ["warnings", "Warnings", "1 warning"], ["modules", "Capabilities", "2"]]);
/** The preview with the focus at `focus` and the folds of `open` open; `extra` replaces the rest. */
function previewOf({ focus = "spawn", open = [], name = "", child = true, ...extra } = {}) {
  return {
    step: "preview", soul: "dev", status: "shown", facts: factsOf(), problem: null,
    fields: { name: { text: name, focused: focus === "name" }, child: { offered: true, on: child, label: "dev-a", focused: focus === "child" } },
    focus, folds: FOLDS.map(([key, label, summary]) => ({ key, label, summary, open: open.includes(key), focused: focus === `fold:${key}` })),
    enter: { spawn: "spawn", name: "keep the name", child: child ? "no parent" : "child of" }[focus] ?? (open.includes(focus.slice(5)) ? "close" : "open"), ready: true, top: 0,
    ...extra,
  };
}
/** The rows the facts are drawn on, from the shared home's own words: a label in its column (16
 *  cells from the left edge, the label from the third), the value's parts one cell apart, and each
 *  `sub` part on a row of its own under the value. */
function factLines(facts) {
  const value = (parts) => parts.filter((part) => !part.sub).map((part) => part.text.trim()).join(" ");
  return [
    ...facts.identity.map((item) => `  ${item.label.padEnd(14)}${item.text}`),
    ...facts.facts.flatMap((fact) => [`  ${fact.label.padEnd(14)}${value(fact.parts)}`, ...fact.parts.filter((part) => part.sub).map((part) => `${" ".repeat(16)}${part.text}`)]),
  ];
}

// ── The picker ──────────────────────────────────────────────────────────────────────────────────

test("the picker at 80x24 and 120x40: over the whole body under a rule with no joint, its title, the query after its prompt with the cursor at its end, then the souls; the selected one in reverse with `>`, a refused one dim with `!` and its refusal after its name; the footer says how to work it", () => {
  for (const sz of [S80, S120]) {
    const at = `${sz.cols}x${sz.rows}`, d = drawSpawn(pickerOf(), sz);
    assert.equal(d.lines[2], "─".repeat(sz.cols), `${at}: the rule under the header has no joint`);
    assert.deepEqual(bodyLines(d, sz).slice(0, 6), ["Spawn: pick a soul", "> o", ">   dev", `  ! ops  ${REFUSAL}`, "    docs", ""], at);
    assert.equal(bodyLines(d, sz).slice(5).every((line) => line === ""), true, `${at}: nothing under the souls`);
    assert.deepEqual(d.cursor, { row: TOP + 1, col: 3 }, `${at}: the cursor stands after the query`);
    assert.equal(d.cells[TOP][0].style.bold, true, `${at}: the title is bold`);
    // The selected row: reverse over the whole width, `>` in its first cell.
    for (let x = 0; x < sz.cols; x++) assert.equal(d.cells[TOP + 2][x].style.reverse, true, `${at}: column ${x} of the selected row`);
    // The refused row: `!` says it, as well as the dim; its refusal in words after the name.
    const refused = TOP + 3, name = cellIndexOf(d, refused, "ops"), refusal = cellIndexOf(d, refused, "Can't spawn here");
    assert.equal(d.cells[refused][2].text, "!");
    for (const x of [2, name, refusal]) assert.equal(d.cells[refused][x].style.dim && !d.cells[refused][x].style.reverse, true, `${at}: column ${x} of the refused row is dim`);
    assert.equal(d.cells[TOP + 4][4].style.dim, false, `${at}: a soul that can be picked is not dim`);
    assert.equal(footer(d, sz), `${LEAD}Enter pick   Up/Down move   Esc close`, at);
    assert.deepEqual([d.extent, d.room], [0, 1], `${at}: the picker gives the store no scroll: the model windows its souls`);
  }
  // Selected and refused: reverse, `!` and the refusal still say it.
  const both = drawSpawn(pickerOf({ rows: [{ name: "ops", refused: true, refusal: REFUSAL, selected: true }] }), S80);
  assert.equal(bodyLines(both, S80)[2], `> ! ops  ${REFUSAL}`);
  assert.equal(both.cells[TOP + 2][2].style.reverse, true);
});

test("the picker's window: the souls start under the title and the query, and the body's last row says what the model's window cuts off above and below", () => {
  for (const sz of [S80, S120]) {
    const rows = Array.from({ length: sz.rows - 4 - 3 }, (_, i) => ({ name: `soul-${i}`, refused: false, refusal: null, selected: i === 0 }));
    const d = drawSpawn(pickerOf({ rows, above: 4, below: 7 }), sz), body = bodyLines(d, sz);
    assert.deepEqual(body.slice(2, 4), [">   soul-0", "    soul-1"]);
    assert.equal(body.at(-2), `    soul-${rows.length - 1}`, "the last soul of the window stands above the note");
    assert.equal(body.at(-1), `    ${cutNote(4, 7)}`);
    assert.equal(d.cells[sz.rows - 2][4].style.dim, true, "the note is dim");
  }
});

test("the picker's states each say one sentence where the souls stand: reading, none, no match, and a failed read in the catalog's own words", () => {
  const failure = "The souls could not be read: oats souls exited with status 1.";
  for (const sz of [S80, S120]) for (const ascii of [false, true]) {
    const said = (state, extra = {}) => bodyLines(drawSpawn(pickerOf({ state, rows: [], ...extra }), sz, { ascii }), sz).slice(2).filter(Boolean);
    assert.deepEqual(said("reading"), [ascii ? "    Reading souls..." : "    Reading souls…"]);
    assert.deepEqual(said("none"), ["    No souls in this workspace."]);
    assert.deepEqual(said("nomatch"), ["    No soul matches."]);
    assert.deepEqual(said("failed", { failure }), [`    ${failure}`]);
  }
  // A failure longer than the row is wrapped, never cut at the edge.
  const long = `${"The catalog read failed because ".repeat(6)}end.`;
  const wrapped = bodyLines(drawSpawn(pickerOf({ state: "failed", rows: [], failure: long }), S80), S80).slice(2).filter(Boolean);
  assert.equal(wrapped.length > 1 && wrapped.every((line) => line.startsWith("    ") && line.length < 80), true);
  assert.equal(wrapped.map((line) => line.trim()).join(" "), long);
});

// ── The preview ─────────────────────────────────────────────────────────────────────────────────

test("the preview at 80x24 and 120x40: the title, the identity and the facts in the shared home's words, each fold on one row, the two fields and the Spawn button with the focus", () => {
  for (const sz of [S80, S120]) {
    const at = `${sz.cols}x${sz.rows}`, d = drawSpawn(previewOf(), sz), body = bodyLines(d, sz);
    assert.deepEqual(body, [
      "  Spawn dev",
      "",
      ...factLines(factsOf()),
      "",
      "  Launch prompts: none answered",
      "  Warnings: 1 warning",
      "  Capabilities: 2",
      // The fields and the button keep the body's bottom: what scrolls ends above them.
      ...Array.from({ length: sz.rows - 4 - 20 }, () => ""),
      "",
      "  name",
      "  child of      dev-a",
      "",
      "  > Spawn <",
    ], at);
    assert.equal(body.includes("  Name          numbered by the kernel"), true, `${at}: an empty name is the kernel's to number, said by the identity's Name row`);
    assert.equal(d.cells[TOP][2].style.bold && d.cells[TOP][8].style.bold, true, `${at}: the title is bold, the soul's name too`);
    const name = rowStarting(d, "Name");
    assert.equal(d.cells[name][2].style.dim && d.cells[name][16].style.dim, true, `${at}: a label is dim, and a muted value`);
    assert.equal(d.cells[rowStarting(d, "Home")][16].style.dim, false, `${at}: a plain value is not`);
    const harness = rowStarting(d, "Harness");
    assert.equal(d.cells[harness + 1][16].style.dim, true, `${at}: a sub part is dim, on its own row`);
    // The button with the focus: between `>` and `<`, bold and in reverse.
    const button = rowStarting(d, "> Spawn <");
    for (let x = 2; x < 11; x++) assert.equal(d.cells[button][x].style.reverse && d.cells[button][x].style.bold, true, `${at}: column ${x} of the button`);
    assert.equal(d.cursor, null, `${at}: no cursor while the name field has no focus`);
    assert.deepEqual([d.extent, d.room], [15, sz.rows - 4 - 5], `${at}: the rows that scroll, and the body over the five pinned rows`);
    assert.equal(footer(d, sz), `${LEAD}Enter spawn   Tab next   Shift+Tab back   Esc back`, at);
  }
});

test("the preview's focus on each kind: the name field and the child-of field carry `>` and their label in reverse, a fold the same, the button `> Spawn <`; the one with the focus alone; the cursor in the name field while it has it", () => {
  const sz = S120;
  const marked = (d) => d.lines.flatMap((line, r) => (r >= TOP && r < sz.rows - 1 && line.startsWith(">") ? [line] : []));
  const nameField = drawSpawn(previewOf({ focus: "name", name: "api" }), sz);
  assert.deepEqual(marked(nameField), ["> name          api"]);
  const nameRow = rowStarting(nameField, "> name");
  for (let x = 0; x < 6; x++) assert.equal(nameField.cells[nameRow][x].style.reverse, true, `the name field's label, column ${x}`);
  assert.equal(nameField.cells[nameRow][16].style.reverse, false, "the text typed is not in reverse: the cursor stands in it");
  assert.deepEqual(nameField.cursor, { row: nameRow, col: 16 + 3 }, "the cursor after the name typed");
  assert.equal(rowStarting(nameField, "[ Spawn ]") > 0, true, "the button without the focus");
  assert.equal(footer(nameField, sz), `${LEAD}Enter keep the name   Tab next   Shift+Tab back   Esc back`);
  // An empty name: the cursor at the value's column, and nothing typed there.
  const empty = drawSpawn(previewOf({ focus: "name" }), sz);
  assert.deepEqual(empty.cursor, { row: rowStarting(empty, "> name"), col: 16 });
  assert.equal(empty.lines[rowStarting(empty, "> name")], "> name");

  const child = drawSpawn(previewOf({ focus: "child" }), sz);
  assert.deepEqual(marked(child), ["> child of      dev-a"]);
  assert.equal(child.cells[rowStarting(child, "> child of")][2].style.reverse, true);
  assert.equal(footer(child, sz), `${LEAD}Enter no parent   Tab next   Shift+Tab back   Esc back`);
  // Not a child: `none`, dim, the TUI's word.
  const none = drawSpawn(previewOf({ focus: "child", child: false }), sz), noneRow = rowStarting(none, "> child of");
  assert.equal(none.lines[noneRow], "> child of      none");
  assert.equal(none.cells[noneRow][16].style.dim, true);
  // Not offered (no instance was selected when the prompt opened): no row at all.
  const offered = previewOf();
  assert.equal(drawSpawn({ ...offered, fields: { ...offered.fields, child: { offered: false, on: false, label: null, focused: false } } }, sz).lines.some((line) => line.trimStart().startsWith("child of")), false, "no child-of field: the Relationship fact alone says it");

  for (const [key, label] of [["prompts", "Launch prompts"], ["warnings", "Warnings"], ["modules", "Capabilities"]]) {
    const d = drawSpawn(previewOf({ focus: `fold:${key}` }), sz), row = rowStarting(d, `> ${label}:`);
    assert.deepEqual(marked(d), [d.lines[row]], key);
    assert.equal(d.cells[row][2].style.reverse, true, key);
    assert.equal(footer(d, sz), `${LEAD}Enter open   Tab next   Shift+Tab back   Esc back`, key);
  }
});

test("an open fold is followed by its content, set in: the launch-prompt note, each warning's lines, the core slots and then the capabilities with why and where from; a closed one stays one row", () => {
  const sz = S120, facts = factsOf();
  const prompts = drawSpawn(previewOf({ open: ["prompts"], focus: "fold:prompts" }), sz), at = rowStarting(prompts, "> Launch prompts:");
  assert.equal(prompts.lines[at + 1], `    ${facts.prompts[0].label}`);
  assert.equal(prompts.lines[at + 2], `      ${facts.prompts[0].text}`);
  assert.equal(prompts.lines[at + 3], "  Warnings: 1 warning", "the next fold follows the content");
  assert.equal(footer(prompts, sz), `${LEAD}Enter close   Tab next   Shift+Tab back   Esc back`);

  const warnings = drawSpawn(previewOf({ open: ["warnings"] }), sz), w = rowStarting(warnings, "Warnings:");
  assert.deepEqual(warnings.lines.slice(w + 1, w + 3), facts.warnings[0].map((line) => `    ${line}`));

  const modules = drawSpawn(previewOf({ open: ["modules"] }), sz), mo = rowStarting(modules, "Capabilities:");
  assert.deepEqual(modules.lines.slice(mo + 1, mo + 5), [
    `    Knowledge   ${SPAWN_TEXT.noParent}`,
    "    Messaging   aweb  Workspace default  package aweb 1.0.0",
    `    Tasks       ${SPAWN_TEXT.noParent}`,
    "    gh  Soul  oats · latest",
  ]);
  assert.equal(modules.cells[mo + 2][22].style.dim, true, "why a module is there is dim beside its name");
  assert.equal(modules.cells[mo + 2][16].style.dim, false);
  // All three open, one under the other.
  const all = drawSpawn(previewOf({ open: ["prompts", "warnings", "modules"] }), size(120, 60));
  assert.equal(rowStarting(all, "Launch prompts:") < rowStarting(all, "Warnings:") && rowStarting(all, "Warnings:") < rowStarting(all, "Capabilities:"), true);
});

test("the preview's status: being read again it says so above the last read's facts, drawn dim; a failed read shows its problem and no facts, the Spawn button dim; with the souls still read, it says so", () => {
  const sz = S120;
  const reading = drawSpawn(previewOf({ status: "reading", ready: false }), sz);
  assert.equal(bodyLines(reading, sz)[2], `  ${SPAWN_TEXT.readingPreview}`);
  const home = rowStarting(reading, "Home");
  assert.equal(reading.cells[home][16].style.dim && reading.cells[rowStarting(reading, "Warnings:")][2].style.dim, true, "the stale facts and folds are dim");
  const button = rowStarting(reading, "> Spawn <");
  assert.equal(reading.cells[button][4].style.dim, true, "not ready: the button is dim");
  // Being read with no facts yet: the words alone.
  const first = drawSpawn(previewOf({ status: "reading", facts: null, ready: false }), sz);
  assert.equal(first.lines.some((line) => line.includes("Works in")), false);
  assert.equal(first.lines.includes(`  ${SPAWN_TEXT.readingPreview}`), true);

  const problem = { said: [{ own: "The preview could not be read: " }, { shown: "E_PREVIEW_FAILED" }], under: ["OATS says: no harness is installed", "Install one."] };
  const failed = drawSpawn(previewOf({ status: "failed", ready: false, problem }), sz), body = bodyLines(failed, sz);
  assert.equal(body.some((line) => line.includes("Works in") || line.includes("Warnings:")), false, "a failed read shows no facts");
  const said = rowStarting(failed, "The preview could not be read:");
  assert.deepEqual(failed.lines.slice(said, said + 3), ["  The preview could not be read: E_PREVIEW_FAILED", "  OATS says: no harness is installed", "  Install one."]);
  assert.equal(failed.cells[said][2].style.bold && failed.cells[said][35].style.bold, true, "the problem's sentence is bold, its name too");
  assert.equal(failed.cells[said + 1][2].style.bold, false, "the lines under it are plain");
  assert.equal(failed.cells[rowStarting(failed, "> Spawn <")][4].style.dim, true, "and the button dim");
  assert.equal(rowStarting(failed, "> Spawn <") < said, true, "the problem stands under the button");

  // A spawn's outcome that brought the prompt back: the facts and the problem both.
  const back = drawSpawn(previewOf({ problem }), sz);
  assert.equal(rowStarting(back, "Works in") > 0 && rowStarting(back, "The preview could not be read:") > rowStarting(back, "Works in"), true);

  const souls = drawSpawn(previewOf({ soul: null, status: "souls", facts: null, folds: [], ready: false }), sz);
  assert.deepEqual(bodyLines(souls, sz).slice(0, 3), ["  Spawn", "", `  ${SPAWN_TEXT.readingSouls}`]);
  assert.deepEqual(bodyLines(drawSpawn(previewOf({ soul: null, status: "souls", facts: null, folds: [], ready: false }), sz, { ascii: true }), sz)[2], "  Reading souls...");
});

test("the preview's footer: Enter and what it does now, then Tab, Shift+Tab and Esc; no Enter while it does nothing; given up whole at 60 columns, Shift+Tab first, then Tab, Enter kept longest", () => {
  assert.equal(footer(drawSpawn(previewOf({ enter: null }), S120), S120), `${LEAD}Tab next   Shift+Tab back   Esc back`, "Enter does nothing now: no hint of it");
  assert.equal(footer(drawSpawn(previewOf(), S60), S60), `${LEAD}Enter spawn   Tab next   Esc back`);
  assert.equal(footer(drawSpawn(previewOf({ focus: "name" }), S60), S60), `${LEAD}Enter keep the name   Tab next   Esc back`);
  assert.equal(footer(drawSpawn(previewOf({ enter: "a very long thing for Enter to do now" }), S60), S60), `${LEAD}Enter a very long thing for Enter to do now`);
  assert.equal(footer(drawSpawn(pickerOf(), S60), S60), `${LEAD}Enter pick   Up/Down move   Esc close`);
});

/** The cells of `rows` as strings, one per row, `cols` wide. */
const linesOf = (rows, cols) => createScreen({ utf8: true }).cells(rows, { cols, rows: rows.length }).map((line) => line.map((cell) => cell.text).join("").trimEnd());

test("a preview taller than the body scrolls by the model's top above what is pinned: the fields, the Spawn button and a problem keep the body's bottom; the window from `top`, its last row saying what is cut off; `extent` and `room` the scrolling part's; the cursor in the name field at every top", () => {
  const sz = S60, body = sz.rows - 4;
  const problem = { said: [{ own: "The spawn was refused: " }, { shown: "E_REFUSED" }], under: ["Change the choices with Tab."] };
  for (const spawn of [previewOf({ focus: "name", name: "api", open: ["prompts", "warnings", "modules"] }), previewOf({ focus: "name", name: "api", open: ["prompts", "warnings", "modules"], problem })]) {
    const parts = previewRows(spawn, sz.cols, false), all = linesOf(parts.scroll, sz.cols), pinned = linesOf(parts.pinned, sz.cols);
    const room = body - pinned.length;
    assert.equal(all.length > room && room >= 3, true, "the fixture's scrolling part is taller than its room");
    assert.deepEqual(pinned.slice(0, 5), ["", "> name          api", "  child of      dev-a", "", "  [ Spawn ]"]);
    for (const top of [0, 3, all.length - (room - 1)]) {
      const at = `${spawn.problem ? "with a problem, " : ""}top ${top}`, d = drawSpawn({ ...spawn, top }, sz), lines = bodyLines(d, sz);
      assert.deepEqual([d.extent, d.room], [all.length, room], at);
      assert.deepEqual(lines.slice(0, room - 1), all.slice(top, top + room - 1), `${at}: the window`);
      assert.equal(lines[room - 1], `  ${cutNote(top, all.length - top - (room - 1))}`, `${at}: the note`);
      assert.deepEqual(lines.slice(room), pinned, `${at}: the fields, the button and the problem stay on the screen`);
      assert.deepEqual(d.cursor, { row: TOP + room + 1, col: 16 + 3 }, `${at}: the cursor`);
    }
    // A top past the end is drawn at the end, as the store corrects it.
    assert.deepEqual(drawSpawn({ ...spawn, top: 999 }, sz).lines, drawSpawn({ ...spawn, top: all.length - (room - 1) }, sz).lines);
  }
  // One that fits has no note and no scroll.
  const fits = drawSpawn(previewOf(), S120);
  assert.equal(bodyLines(fits, S120).some((line) => /more (above|below)/.test(line)), false);
});

test("a fold with the focus is drawn whatever `top` says: Tab onto a fold below the window or above it brings the window to it, as the list keeps its selection", () => {
  const sz = S60, open = ["prompts", "warnings", "modules"];
  for (const [key, label, top] of [["modules", "Capabilities", 0], ["prompts", "Launch prompts", 999]]) {
    const spawn = previewOf({ focus: `fold:${key}`, open, top });
    const away = drawSpawn({ ...spawn, folds: spawn.folds.map((fold) => ({ ...fold, focused: false })) }, sz);
    assert.equal(away.lines.some((line) => line.includes(`${label}:`)), false, `${key}: out of the window at top ${top} without the focus`);
    const d = drawSpawn(spawn, sz), row = rowStarting(d, `> ${label}:`);
    assert.equal(row >= TOP && row < sz.rows - 1, true, `${key}: drawn with the focus on it`);
    assert.equal(d.cells[row][2].style.reverse, true, key);
    assert.equal(d.lines.some((line) => /more (above|below)/.test(line)), true, `${key}: the note says what the window cuts off`);
    assert.equal(rowStarting(d, "[ Spawn ]") > row, true, `${key}: the button still under it`);
  }
});

test("a problem taller than its room is cut to it, its last row the cut mark: the scrolling part keeps three rows and the fields and the button stay whole", () => {
  for (const ascii of [false, true]) {
    const sz = S60, problem = { said: [{ own: "The spawn was refused: " }, { shown: "E_REFUSED" }], under: Array.from({ length: 12 }, (_, i) => `Line ${i} of what the kernel said.`) };
    const d = drawSpawn(previewOf({ problem }), sz, { ascii }), lines = bodyLines(d, sz);
    assert.equal(d.room, 3, "the scrolling part keeps three rows");
    assert.deepEqual(lines.slice(3, 9), ["", "  name", "  child of      dev-a", "", "  > Spawn <", ""]);
    assert.equal(lines[9], "  The spawn was refused: E_REFUSED");
    assert.equal(lines.at(-1), ascii ? "  ..." : "  \u2026", "the last row is the cut mark");
  }
});

// ── The frame around it ─────────────────────────────────────────────────────────────────────────

test("the prompt is drawn over the whole body as the palette is, the palette winning if both are set; with no prompt the frame is the one it was; no terminal is drawn under it and the footer is the prompt's", () => {
  const base = baseModel();
  for (const sz of [S80, S120]) {
    assert.deepEqual(drawModel({ ...base, spawn: null }, sz).lines, drawModel(base, sz).lines, "no prompt: the frame as it was");
    const d = drawSpawn(pickerOf(), sz);
    assert.deepEqual(d.lines.slice(0, 2), drawModel(base, sz).lines.slice(0, 2), "the header stays");
  }
  const palette = { query: "", rows: [], above: 0, below: 0, empty: true };
  const both = drawModel({ ...base, palette, spawn: pickerOf() }, S80);
  assert.equal(both.lines.some((line) => line.includes("Spawn: pick a soul")), false);
  assert.equal(footer(both, S80), `${LEAD}Enter run   Up/Down move   Esc close`);
  // An open terminal with the focus: the prompt reads the keys, and the terminal is not drawn.
  const terminal = { name: "dev-a", focus: "terminal", zoom: false, machine: null, routed: false };
  const open = { ...base, terminal, spawn: previewOf() };
  assert.equal(terminalArea(open, S120), null);
  assert.notEqual(terminalArea({ ...open, spawn: null }, S120), null, "without the prompt the terminal stands");
  assert.equal(footer(drawModel(open, S120), S120), `${LEAD}Enter spawn   Tab next   Shift+Tab back   Esc back`);
});

// ── Hostile text ────────────────────────────────────────────────────────────────────────────────

const ESC = "\x1b", BEL = "\x07", ST = `${ESC}\\`;
const HOSTILE = Object.freeze({
  "CSI colour and moves": `${ESC}[31mred${ESC}[10;10H${ESC}[2Jgone`,
  "OSC 52, the clipboard": `${ESC}]52;c;cm0gLXJmIH4=${BEL}`,
  "OSC 8, a link": `${ESC}]8;;https://evil.example/${ST}click${ESC}]8;;${ST}`,
  "the 8-bit CSI": "\u009B31mred\u009B2J",
  "CRLF": "one\r\ntwo",
  "bidi overrides": "safe\u202Etxt.exe\u202D",
  "a lone ESC": `dev${ESC}`,
  "wide graphemes": "名前の長い魂".repeat(12),
  "a grapheme with combining marks": `Z${"\u0301".repeat(200)}algo`,
  "10 000 characters": "n".repeat(10000),
  "10 000 wide characters": "名".repeat(10000),
});
/** Every field of the prompt that holds text from outside, made hostile one at a time. */
const HOSTILE_FIELDS = {
  "the picker's query": (v) => pickerOf({ query: v }),
  "a soul's name in the picker": (v) => pickerOf({ rows: [{ name: v, refused: false, refusal: null, selected: true }, { name: v, refused: true, refusal: REFUSAL, selected: false }] }),
  "a refusal": (v) => pickerOf({ rows: [{ name: "ops", refused: true, refusal: v, selected: true }] }),
  "the catalog's failure": (v) => pickerOf({ state: "failed", rows: [], failure: v }),
  "the preview's soul": (v) => previewOf({ soul: v }),
  "a fact's part": (v) => previewOf({ facts: factsOf({ ...DATA, branch: v, model: v }) }),
  "a sub part and a label": (v) => { const facts = factsOf(); return previewOf({ facts: { ...facts, facts: [{ label: v, parts: [{ text: v }, { text: v, sub: true }] }] } }); },
  "an open fold's content": (v) => previewOf({ open: ["prompts", "warnings", "modules"], facts: { ...factsOf(), prompts: [{ label: v, text: v }], warnings: [[v, v]], modules: { core: [{ layer: "knowledge", label: v, module: { name: v, why: v, source: v } }], caps: [{ name: v, why: v, source: v }] } } }),
  "the name typed": (v) => previewOf({ focus: "name", name: v }),
  "the child-of label": (v) => { const p = previewOf(); return { ...p, fields: { ...p.fields, child: { ...p.fields.child, label: v } } }; },
  "a problem's said and under": (v) => previewOf({ problem: { said: [{ own: "The spawn was refused: " }, { shown: v }], under: [v, v] } }),
};

test("hostile text in every field the prompt shows (a soul's name, the query, a refusal, a fact, a fold, the name, a problem) never escapes its row or the body: no cell holds a control character, every row has exactly the terminal's cells, the header and the footer stay, and the bytes hold only the TUI's own sequences", () => {
  for (const [field, make] of Object.entries(HOSTILE_FIELDS)) for (const [name, value] of Object.entries(HOSTILE)) for (const sz of [S80, S120]) {
    const at = `${field}, ${name}, ${sz.cols}x${sz.rows}`;
    const spawn = make(value), d = drawSpawn(spawn, sz);
    const plain = drawSpawn(make("plain"), sz);
    assert.deepEqual(d.lines.slice(0, TOP), plain.lines.slice(0, TOP), `${at}: the header and the rule stay`);
    assert.equal(footer(d, sz), footer(plain, sz), `${at}: the footer stays`);
    assert.equal(d.cells.length, sz.rows, `${at}: as many rows as the terminal has`);
    d.cells.forEach((line, r) => {
      assert.equal(line.reduce((sum, cell) => sum + cell.width, 0), sz.cols, `${at}: row ${r} takes exactly the terminal's columns`);
      assert.equal(textWidth(d.lines[r]) <= sz.cols, true, `${at}: row ${r} is no wider than the terminal`);
      for (const cell of line) assert.doesNotMatch(cell.text, CONTROL, `${at}: row ${r}: no control character in a cell`);
    });
    if (d.cursor) assert.equal(d.cursor.row >= TOP && d.cursor.row < sz.rows - 1 && d.cursor.col < sz.cols, true, `${at}: the cursor stays in the body`);
    const output = createScreen({ utf8: true, color: true }).render(d.rows, sz, { full: true });
    const { foreign } = readTerminalOutput(output);
    assert.deepEqual(foreign, [], `${at}: every ESC begins a sequence of the TUI's own list`);
    assert.doesNotMatch(readTerminalOutput(output).text, /evil\.example|cm0gLXJmIH4/, `${at}: nothing of a withheld text is shown`);
  }
});

// ── ASCII ───────────────────────────────────────────────────────────────────────────────────────

test("in ASCII mode every cell of the prompt is printable ASCII, given text from outside that is: the marks, the ellipses of the TUI's own words, the notes and the rule", () => {
  // previewFacts writes `·` between a harness and its model: the shared home's words, shown as they
  // come. Facts in ASCII alone for this test.
  const facts = { identity: [{ label: "Name", text: "numbered by the kernel", muted: true }], facts: [{ label: "Works in", parts: [{ text: "own worktree" }, { text: "from main", sub: true }] }],
    prompts: [{ label: "Launch prompts", text: "None." }], warnings: [["one", "two"]], modules: { core: [{ layer: "knowledge", label: "Knowledge", module: null }], caps: [{ name: "gh", why: "Soul", source: "acme" }] } };
  const cases = [
    pickerOf({ rows: [{ name: "ops", refused: true, refusal: "Can't spawn here - no launch.", selected: true }], above: 1, below: 2 }),
    ...["reading", "none", "nomatch"].map((state) => pickerOf({ state, rows: [] })),
    previewOf({ facts, status: "reading", ready: false, open: ["prompts", "warnings", "modules"], focus: "fold:modules", enter: "close" }),
    previewOf({ facts, soul: null, status: "souls", folds: [], ready: false, enter: null }),
    previewOf({ facts, focus: "name", name: "api", top: 2, open: ["prompts", "warnings", "modules"] }),
    previewOf({ facts, status: "failed", ready: false, problem: { said: [{ own: "Spawning api… failed: " }, { shown: "E_X" }], under: ["Try again."] } }),
  ];
  for (const spawn of cases) for (const sz of [S60, S80]) {
    const d = drawSpawn(spawn, sz, { ascii: true });
    d.lines.forEach((line, r) => assert.match(line, PRINTABLE_ASCII, `${spawn.step} ${spawn.state ?? spawn.status}, ${sz.cols}x${sz.rows}, row ${r}: ${line}`));
  }
});

// ── The help ────────────────────────────────────────────────────────────────────────────────────

test("the help names the spawn keys from the action table (n, N and C, each in its views), the leader's n and N, and a section of the spawn prompt's own keys; it no longer says spawning is not in this version", () => {
  const lines = rowStrings(helpRows(ACTIONS, false, 140, "C-\\"), 140).map((line) => line.trim());
  const pair = (left, right) => lines.some((line) => line.startsWith(`${left} `) && line.endsWith(` ${right}`) && line.slice(left.length, line.length - right.length).trim() === "");
  for (const id of ["spawn", "spawn-another", "spawn-check"]) {
    const action = ACTIONS.find((each) => each.id === id);
    for (const [, said] of action.views) assert.equal(pair(keysLabel(action), said), true, `${id}: ${said}`);
  }
  assert.equal(pair("n", "spawn") && pair("N", "spawn another"), true, "the leader's n and N");
  const from = lines.indexOf("The spawn prompt"), to = lines.indexOf("Marks");
  assert.equal(from > lines.indexOf("The leader") && to > from, true, "its section stands after the leader's");
  const section = lines.slice(from + 1, to).filter(Boolean);
  // Each key with what it does, the meaning on as many rows as it needs.
  const text = section.join(" ").replace(/ +/g, " ");
  for (const [keys, said] of SPAWN_KEYS) assert.equal(section.some((line) => line.startsWith(`${keys} `)) && text.includes(`${keys} ${said}`), true, `${keys} ${said}`);
  for (const sentence of SPAWN_RULES) assert.equal(section.join(" ").includes(sentence), true);
  assert.equal(lines.some((line) => /spawning is not|not offered/.test(line)), false);
  // At 60 columns nothing of the section is cut.
  for (const line of rowStrings(helpRows(ACTIONS, false, 60, "C-\\"), 60)) assert.equal(line.endsWith("…"), false, line);
});

test("the frame says it drew a ready Spawn button (`armed`), which the loop tells the store once the frame is written: never for the picker, a preview not ready, or a screen too small for the button", () => {
  assert.equal(drawSpawn(previewOf({ ready: true }), S80).armed, true);
  assert.equal(drawSpawn(previewOf({ ready: false }), S80).armed, undefined, "not ready: dim, not armed");
  assert.equal(drawSpawn(pickerOf(), S80).armed, undefined, "the picker");
  const palette = model(reduce(stateOf(observed([instanceRow("dev", "dev-a")])), { key: "ctrl+k", read: 1 }).state, { page: 19, now: NOW, at: AT, cols: 38 }).palette;
  assert.equal(drawModel({ ...baseModel(), spawn: previewOf({ ready: true }), palette }, S80).armed, undefined, "under the palette");
  assert.equal(drawSpawn(previewOf({ ready: true }), size(80, 3)).armed, undefined, "too small to draw the prompt");
});
