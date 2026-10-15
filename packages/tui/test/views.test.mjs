process.env.TZ = "UTC";
// The views of `oats tui`, drawn as the main loop draws them (helpers.mjs `draw`): the store's state
// through the real model, the frame and the screen's cell buffer. What a test claims about the
// screen (a width, a pane, a line of its own) it reads from the cells, never from a string's length.
// Every entry is made by the shared functions, and every sentence of the shared home is computed by
// calling it: the tests quote the TUI's own words only. One exception: the words that say who gave a
// row's text (`OATS says:` and the two that name the client) are the shared home's and are written
// out where a test expects them on the screen, because a test is the place that pins them.
import test from "node:test";
import assert from "node:assert/strict";
import { ACTIONS, LEADER } from "../lib/actions.mjs";
import {
  DETAIL_WITHHELD, TERMS, UNMATCHED_SECTION, cliRemoteRoster, deploymentState, displayLine, heldHome, instanceActs, livenessAnswers, livenessInput, observeIdentities, observedEntry,
  originLead, panelInstances, primaryDeployment, remoteRosterState, rosterRows, rowReason, runtimeState, waitedText, waitingBelowText, waitingClock, waitingLabel, workspaceChoiceRows, workspaceChoices,
} from "../lib/client.mjs";
import { effectiveConfig } from "../lib/config.mjs";
import { MORE_FOLDERS, NOT_BUILT, OFFERED_SECTION, ROSTER_FAILED, heldOf, model, paletteItems, panelOf, roster } from "../lib/model.mjs";
import { reduce } from "../lib/store.mjs";
import { captureRows } from "../lib/term/capture.mjs";
import { createScreen } from "../lib/term/screen.mjs";
import { PLAIN, isStyle, style } from "../lib/term/style.mjs";
import { isSafeText, shown, textOf } from "../lib/term/text.mjs";
import { textWidth } from "../lib/term/width.mjs";
import { LIST_BESIDE, MIN_SIZE, PANEL_MIN, WIDE, frame } from "../lib/views/frame.mjs";
import { ACT_RULES, MACHINES, NOT_YET, VIEWS, keysLabel } from "../lib/views/help.mjs";
import { EMPTY_TEXT, MARKS, cutNote, marksOf } from "../lib/views/instances.mjs";
import { OPEN_MARK, SWITCHER_TEXT } from "../lib/views/switcher.mjs";
import { CLI, DEPLOYMENT, NOW, draw, failed, instanceRow, leaderThen, leaderTwice, observed, press, readTerminalOutput, rosterOf, stateOf } from "./helpers.mjs";

const size = (cols, rows) => ({ cols, rows });
const S80 = size(80, 24), S120 = size(120, 40), S79 = size(79, 24), S60 = size(60, 15);
const SIZES = [S80, S120, S79, S60];
const AT = new Date(NOW).toISOString();
const DIM = style({ dim: true });
/** The spec's own arithmetic for the list pane of a wide terminal. */
const listWidth = (cols) => Math.min(Math.max(Math.floor(cols * 0.48), 36), 60);
/** The glyphs the spec gives the frame, by mode. */
const GLYPHS = { utf8: { rule: "─", down: "┬", bar: "│", cut: "…" }, ascii: { rule: "-", down: "+", bar: "|", cut: "..." } };
const glyphsOf = (ascii) => (ascii ? GLYPHS.ascii : GLYPHS.utf8);
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;
/** What no cell may hold: a control character (C0, DEL, C1) or a bidi control. */
const CONTROL = /[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069]/u;

/** The text of the cells of row `r` from column `from` up to `to`, trailing blanks cut. */
const cellText = (d, r, from = 0, to = Infinity) => d.cells[r].slice(from, to).map((cell) => cell.text).join("").trimEnd();
/** The cell index at which `word` is last drawn in a row of cells (a string index is not one: the
 *  second cell of a wide grapheme holds no character), or -1. */
function cellIndexOf(cells, word) {
  for (let x = cells.length - word.length; x >= 0; x--) if (cells.slice(x, x + word.length).map((cell) => cell.text).join("") === word && cells.slice(x, x + word.length).every((cell) => cell.width === 1)) return x;
  return -1;
}
/** Whether a cell is drawn in reverse video: the second cell of a wide grapheme is drawn by its first. */
const reversed = (line, x) => (line[x].width === 0 ? line[x - 1] : line[x]).style.reverse;
/** The body of a frame: the rows between the rule under the header and the footer. */
const bodyRows = (sz) => Array.from({ length: sz.rows - 4 }, (_, i) => 3 + i);
/** The list pane's rows as strings, and the detail's (the cells right of the panes' rule). */
const listLines = (d, sz) => bodyRows(sz).map((r) => cellText(d, r, 0, sz.cols >= WIDE ? listWidth(sz.cols) : sz.cols));
const detailLines = (d, sz) => bodyRows(sz).map((r) => cellText(d, r, sz.cols >= WIDE ? listWidth(sz.cols) + 1 : 0));
/** The screen row that draws the instance whose name begins with `name`, in the list pane. */
function rowOf(d, sz, name) {
  const found = bodyRows(sz).filter((r) => cellText(d, r, 0, sz.cols >= WIDE ? listWidth(sz.cols) : sz.cols).includes(name));
  assert.equal(found.length, 1, `one list row draws ${name}`);
  return found[0];
}
/** The body row that draws the fixture's instance `name`, read where its name is whole: at 79
 *  columns the list has the whole width, and the rows are in the same order at every width. */
function rowAt(state, sz, name) {
  const reference = draw(state, size(79, sz.rows));
  const found = bodyRows(sz).filter((r) => `${cellText(reference, r)} `.includes(` ${name} `));
  assert.equal(found.length, 1, `one list row draws ${name}`);
  return found[0];
}
/** The state with the instance `name` on the screen at size `sz`: as it is, or, where the list is
 *  cut off at that size (60x15 holds ten rows of the eleven), with the selection moved to it. */
function onScreen(state, sz, name) {
  const reference = draw(state, size(79, sz.rows));
  return bodyRows(sz).some((r) => cellText(reference, r).includes(` ${name} `)) ? state : selecting(state, name, sz);
}
/** Move the selection to the instance called `name`, with the keys a person has. */
function selecting(state, name, sz = S80) {
  let next = press(state, ["g"], sz).state;
  for (let i = 0; i < 400 && !String(next.selected).endsWith(`/${name}`); i++) next = press(next, ["j"], sz).state;
  assert.equal(String(next.selected).endsWith(`/${name}`), true, `${name} can be selected`);
  return next;
}
/** The detail as facts: `{ title, focused, facts: [{ label, col, rows: [value row, …] }] }`, read
 *  from its lines by where a label and a value stand. */
function factsOf(lines) {
  const title = lines[0].trim(), focused = title.startsWith("> ");
  const labelCol = lines[0].indexOf(focused ? title.slice(2) : title);
  const facts = [];
  for (const line of lines.slice(1)) {
    if (line.trim() === "") continue;
    const at = line.search(/\S/);
    if (at === labelCol) {
      const label = line.trim().split(" ")[0], rest = line.slice(labelCol + label.length);
      facts.push({ label, col: labelCol + label.length + rest.search(/\S/), rows: [rest.trim()] });
    } else facts.at(-1).rows.push(line.trim()), assert.equal(at, facts.at(-1).col, "a wrapped row stands under its fact's value");
  }
  return { title: focused ? title.slice(2) : title, focused, facts };
}
const fact = (detail, label) => detail.facts.find((f) => f.label === label) ?? null;
const labels = (detail) => detail.facts.map((f) => f.label);
/** An observed entry whose souls are in `team`, through the same shared calls helpers.mjs makes. */
function observedIn(rows, { team, workspace = "acme-platform" } = {}) {
  const document = rosterOf(rows, { team }), listed = rosterRows(document, CLI);
  const answers = listed.map((row) => ({ running: row.running, runtimeState: row.runtimeState, ...(row.runtimeError ? { runtimeError: row.runtimeError } : {}), tmux: row.tmux }));
  return observedEntry({ roster: document, workspaceStatus: { workspace: { name: workspace } }, observedAt: "2026-10-11T10:00:00.000Z" }, panelInstances(listed, answers), "2026-10-11T10:00:01.000Z");
}
/** What the liveness collector prints for a row: the answers the shared home documents for it
 *  (liveness.mjs `observeLiveness`, a program a test of the TUI does not load), in its order. A row
 *  of a session backend OATS no longer has, which a kernel reports with its own reason, is not
 *  probed and reads unsupported with that reason; a row the kernel answered `running: null` is not
 *  probed either and keeps the kernel's state and text; any other row is probed, and the probe
 *  agrees with the kernel unless `found(row)` says what it found instead. */
const collector = (found = () => ({})) => (row) => (row.runtimeState === "unsupported" && row.runtimeError ? { running: null, runtimeState: "unsupported", runtimeError: row.runtimeError, tmux: null }
  : row.running === null ? { running: null, runtimeState: row.runtimeState ?? "unreachable", ...(row.runtimeError ? { runtimeError: row.runtimeError } : {}) }
    : { tmux: row.tmux, running: row.running, runtimeState: row.runtimeState, ...found(row) });
/** An observed entry made by one read cycle as lib/read.mjs runs it, every step a shared function:
 *  the kernel's rows, the collector's input as the JSON it is given, what it printed, the answers,
 *  the panel's rows. Who gave a row's text is decided on this path (`livenessAnswers`, then
 *  `panelInstances`) and on no other: helpers.mjs `observed` hands `panelInstances` answers it
 *  made itself, so a text in one of its rows carries no speaker where a read would name one. A
 *  test about who gave a text makes its rows here. */
function readCycle(kernelRows, { collect = collector(), withheld } = {}) {
  const document = rosterOf(kernelRows, { withheld }), rows = rosterRows(document, CLI);
  const answers = livenessAnswers(rows, JSON.stringify(JSON.parse(JSON.stringify(livenessInput(rows))).map(collect)));
  return observedEntry({ roster: document, workspaceStatus: { workspace: { name: "acme-platform" } }, observedAt: "2026-10-11T09:59:00.000Z" }, panelInstances(rows, answers), "2026-10-11T10:00:00.000Z");
}
/** The state of a deployment as the shared home words it, for a state of the store. */
const sharedState = (state) => deploymentState(primaryDeployment(panelOf(state, AT).deployments));
const panelRow = (state, name) => panelOf(state, AT).instances.find((row) => row.instance === name);

// ── The fixture: one small roster, fixed. A cluster of three levels with a stopped leaf, a second
// cluster with two waiting rows, two single instances (one the kernel answered `running: null`),
// and one row the reader withheld. Kernel text here is ASCII.
//
// No test here says which GROUP a row is in, or where it stands among the groups, while a part of
// its cluster is hidden by a collapse or by the filter: the shared grouping decides that, and it is
// about to decide it differently (awebai/oats#971). The golden frames therefore draw the roster
// with nothing hidden, and a collapse is drawn cell for cell only over a roster of ONE cluster and
// no single instance, where there is no other group for the root to stand among.
const QUESTION = Object.freeze({ since: "2026-10-11T09:56:00.000Z", producer: "claude", reason: "question", message: "Which base should it use?" });
const UNREACHABLE = "E_TMUX_UNREACHABLE: no server running on /tmp/tmux-1000/default";
const KERNEL_EXPERT = "acme-ledger-expert-retire", KERNEL_DEV = "acme-ledger-developer-note-target", REVIEWER = "peer-reviewer-note";
const DESKTOP_EXPERT = "acme-console-expert-tui-read", DESKTOP_A = "acme-console-developer-panel", DESKTOP_B = "acme-console-developer-terms";
const MAINTAINER = "acme-maintainer-ops", EXPERT_TUI = "acme-expert-tui";
const ROSTER = () => [
  instanceRow("acme-ledger-expert", KERNEL_EXPERT),
  instanceRow("acme-ledger-developer", KERNEL_DEV, { parentInstance: KERNEL_EXPERT, waitingOnYou: { ...QUESTION } }),
  instanceRow("peer-reviewer", REVIEWER, { parentInstance: KERNEL_DEV, running: false, runtimeState: "stopped" }),
  instanceRow("acme-console-expert", DESKTOP_EXPERT),
  instanceRow("acme-console-developer", DESKTOP_A, { parentInstance: DESKTOP_EXPERT, waitingOnYou: { since: "2026-10-11T09:58:00.000Z", producer: "claude", reason: "permission" } }),
  instanceRow("acme-console-developer", DESKTOP_B, { parentInstance: DESKTOP_EXPERT, waitingOnYou: { since: "2026-10-11T08:30:00.000Z", producer: "claude", reason: "attention", message: "Ready for review." } }),
  instanceRow("acme-maintainer", MAINTAINER),
  instanceRow("acme-expert", EXPERT_TUI, { running: null, runtimeState: "unreachable", runtimeError: UNREACHABLE }),
];
const WITHHELD = [{ agent: "acme-ledger-developer", instance: "acme-ledger-developer-twin", reason: "duplicate-home" }];
const entry = () => observed(ROSTER(), { withheld: WITHHELD });
/** The roster as it arrives: everything expanded, the first row selected. */
const fresh = (options) => stateOf(entry(), options);
/** The golden state: nothing hidden, the waiting developer selected. */
const golden = (options) => selecting(fresh(options), KERNEL_DEV);
/** One cluster and no single instance, its root collapsed over the two rows that wait below it. */
const CLUSTER = () => ROSTER().slice(3, 6);
const folded = (options) => press(selecting(stateOf(observed(CLUSTER()), options), DESKTOP_EXPERT), ["h"]).state;
/** The shared home's words for the selected row's claim, as the detail's `needs` line holds them. */
const NEEDS = `${waitingLabel(QUESTION)}, ${waitedText(QUESTION.since, NOW)}`;
const STARTED = waitingClock("2026-10-11T09:00:00.000Z", NOW);
const COUNTS = "6 running  3 need input  1 stopped  1 unknown  1 withheld";
/** What the footer names first in every focus, from column 0: the leader (tui.json's
 *  open.detachKey), from which every action is reached. */
const LEAD = "C-\\ commands   ";
/** The list's footer at 80 columns, at 79, at 120, on a terminal of any width, and at 60 columns.
 *  The selected row of the fixture runs, so Enter opens it and `open` stands first after the
 *  leader. Its acts are stop and retire (restart needs a kernel with session-restart), after
 *  `open`; when the hints do not all fit, the acts are given up first, `retire` before `stop`, then
 *  `workspaces` and `refresh` (the frame's own order). No hint names the views: the header does. */
const FOOTER = `${LEAD}Enter open   / filter   Tab detail   r refresh   ? help   q quit`;
const FOOTER_79 = `${LEAD}Enter open   / filter   Tab detail   ? help   q quit`;
const FOOTER_120 = `${LEAD}Enter open   X stop   D retire   / filter   Tab detail   r refresh   w workspaces   ? help   q quit`;
const FOOTER_WIDE = FOOTER_120;
const FOOTER_60 = `${LEAD}Enter open   / filter   ? help   q quit`;

// ── Golden frames ────────────────────────────────────────────────────────────────────────────────

test("the Instances view at 80x24 in UTF-8, cell for cell: the header, the view names and the read time, a rule with a joint at the list's width, the roster beside the selected instance's detail down to the footer, the footer", () => {
  const blank = `${" ".repeat(38)}│`;
  assert.deepEqual(draw(golden(), S80).lines, [
    ` acme-platform        ${COUNTS}`,
    "  Instances   Souls   Capabilities                                read 10:00:00",
    `${"─".repeat(38)}┬${"─".repeat(41)}`,
    "  ● acme-console-expert-tui-read      │   acme-ledger-developer-note-target",
    "    ● acme-console-developer-pan…    !│   soul     acme-ledger-developer",
    "    ● acme-console-developer-ter…    !│   state    running",
    `                                      │   needs    ${NEEDS}`,
    "  ? acme-expert-t…  state unknown     │            the agent: \"Which base",
    "                                      │            should it use?\"",
    "  ● acme-ledger-expert-retire         │   harness  claude, claude-opus-5-5 (so…",
    ">   ● acme-ledger-developer-note…    !│   work     worktree, agents/acme-ledge…",
    "      ○ peer-reviewer-note            │   team     eng",
    "                                      │   parent   acme-ledger-expert-retire",
    `  ● acme-maintainer-ops               │   started  ${STARTED}`,
    "                                      │   home     …edger-developer-note-target",
    blank, blank, blank, blank, blank, blank, blank, blank,
    FOOTER,
  ]);
});

test("the Instances view at 80x24 in ASCII, cell for cell: the same screen with the rule, its joint, the marks and the cut mark in ASCII", () => {
  const blank = `${" ".repeat(38)}|`;
  assert.deepEqual(draw(golden({ ascii: true }), S80).lines, [
    ` acme-platform        ${COUNTS}`,
    "  Instances   Souls   Capabilities                                read 10:00:00",
    `${"-".repeat(38)}+${"-".repeat(41)}`,
    "  * acme-console-expert-tui-read      |   acme-ledger-developer-note-target",
    "    * acme-console-developer-p...    !|   soul     acme-ledger-developer",
    "    * acme-console-developer-t...    !|   state    running",
    `                                      |   needs    ${NEEDS}`,
    "  ? acme-expert...  state unknown     |            the agent: \"Which base",
    "                                      |            should it use?\"",
    "  * acme-ledger-expert-retire         |   harness  claude, claude-opus-5-5 (...",
    ">   * acme-ledger-developer-no...    !|   work     worktree, agents/acme-led...",
    "      - peer-reviewer-note            |   team     eng",
    "                                      |   parent   acme-ledger-expert-retire",
    `  * acme-maintainer-ops               |   started  ${STARTED}`,
    "                                      |   home     ...ger-developer-note-target",
    blank, blank, blank, blank, blank, blank, blank, blank,
    FOOTER,
  ]);
});

test("at every size and in both modes the frame has its shape: the header on the first row from the workspace's name, the view names and the read time on the second, a rule under them, the body down to the footer with no rule above it, the footer last from column 0", () => {
  for (const ascii of [false, true]) for (const sz of SIZES) {
    const d = draw(golden({ ascii }), sz), g = glyphsOf(ascii), at = `${sz.cols}x${sz.rows}${ascii ? " ascii" : ""}`;
    const wide = sz.cols >= 80, list = listWidth(sz.cols);
    assert.equal(d.cells.length, sz.rows, at);
    for (const line of d.cells) assert.equal(line.length, sz.cols, at);
    // No title: after the margin the header starts with the workspace's name, whole where it has the room.
    assert.equal(cellText(d, 0, 0, 4), " acm", at);
    if (sz.cols >= 79) assert.equal(cellText(d, 0, 0, 16), " acme-platform", at);
    assert.equal(cellText(d, 1, 0, 40), "  Instances   Souls   Capabilities", at);
    assert.equal(cellText(d, 1).endsWith(" read 10:00:00"), true, at);
    assert.equal(d.cells[1][sz.cols - 2].text, "0", `${at}: the read time ends one cell before the edge`);
    // The rule under the header reaches edge to edge; in the wide layout it has a joint where the panes' rule meets it.
    d.cells[2].forEach((cell, x) => assert.equal(cell.text, wide && x === list ? g.down : g.rule, `${at}: row 2, column ${x}`));
    // No rule above the footer: the row above it is the body's last, with the panes' rule on it and
    // no rule of its own (at 60x15 the roster reaches it).
    assert.equal(cellText(d, sz.rows - 2).includes(g.rule.repeat(2)), false, `${at}: row ${sz.rows - 2} is no rule`);
    if (wide) assert.equal(d.cells[sz.rows - 2][list].text, g.bar, `${at}: row ${sz.rows - 2} has the panes' rule`);
    // One rule column between the panes, on every row of the body, and nowhere else.
    for (const r of bodyRows(sz)) {
      if (wide) assert.equal(d.cells[r][list].text, g.bar, `${at}: row ${r} has the panes' rule at column ${list}`);
      if (!ascii) assert.equal(d.cells[r].filter((cell) => cell.text === g.bar).length, wide ? 1 : 0, `${at}: row ${r}`);
    }
    assert.equal(cellText(d, sz.rows - 1).startsWith("C-\\ commands   "), true, `${at}: the leader first, from column 0`);
    assert.equal(cellText(d, sz.rows - 1).endsWith("? help   q quit"), true, at);
    assert.equal(d.page, sz.rows - 4, `${at}: the list pane is the body`);
  }
});

test("from 80 columns up the list takes clamp(floor(cols x 0.48), 36, 60) cells, one column is the rule, and the detail has the rest", () => {
  for (const [cols, list] of [[80, 38], [81, 38], [84, 40], [100, 48], [120, 57], [125, 60], [126, 60], [200, 60]]) {
    assert.equal(listWidth(cols), list);
    const sz = size(cols, 24), d = draw(golden(), sz);
    assert.equal(d.cells[2][list].text, "┬", `${cols}: the joint is at the list's width`);
    assert.equal(d.cells[22][list].text, "│", `${cols}: the panes' rule runs down to the row above the footer, no joint there`);
    const selected = rowAt(golden(), sz, KERNEL_DEV);
    // The selected row's bar is the list pane: every cell of it, and none past it.
    assert.deepEqual(d.cells[selected].map((cell) => cell.style.reverse), Array.from({ length: cols }, (_, x) => x < list), `${cols}`);
    for (const r of bodyRows(sz)) assert.equal(d.cells[r][list].text, "│", `${cols}: row ${r}`);
    // The detail starts after the rule and ends inside the screen.
    const title = d.cells[3].slice(list + 1).map((cell) => cell.text).join("");
    assert.equal(title.trim(), KERNEL_DEV, `${cols}`);
    assert.equal(d.cells[3].slice(0, list).some((cell) => cell.text === "t" && cell.style.bold), false, `${cols}: nothing of the detail is in the list pane`);
  }
});

test("at 120x40 the names have room: the same roster with the names whole and the detail's lines uncut", () => {
  const d = draw(golden(), S120), row = (list, detail) => `${list.padEnd(57)}│${detail}`;
  assert.equal(d.lines[0], ` acme-platform${" ".repeat(48)}${COUNTS}`);
  assert.equal(d.lines[1], `  Instances   Souls   Capabilities     ${" ".repeat(67)}read 10:00:00`);
  assert.equal(d.lines[3], row("  ● acme-console-expert-tui-read", "   acme-ledger-developer-note-target"));
  assert.equal(d.lines[4], row("    ● acme-console-developer-panel                      !", "   soul     acme-ledger-developer"));
  assert.equal(d.lines[5], row("    ● acme-console-developer-terms                      !", "   state    running"));
  assert.equal(d.lines[6], row("", `   needs    ${NEEDS}`));
  assert.equal(d.lines[7], row("  ? acme-expert-tui                    state unknown", "            the agent: \"Which base should it use?\""));
  assert.equal(d.lines[8], row("", "   harness  claude, claude-opus-5-5 (soul)"));
  assert.equal(d.lines[9], row("  ● acme-ledger-expert-retire", "   work     worktree, agents/acme-ledger-developer-note-targ…"));
  assert.equal(d.lines[10], row(">   ● acme-ledger-developer-note-target                 !", "   team     eng"));
  assert.equal(d.lines[11], row("      ○ peer-reviewer-note", `   parent   ${KERNEL_EXPERT}`));
  assert.equal(d.lines[12], row("", `   started  ${STARTED}`));
  assert.equal(d.lines[13], row("  ● acme-maintainer-ops", "   home     …oper/instances/acme-ledger-developer-note-target"));
  for (let r = 14; r < 39; r++) assert.equal(d.lines[r], row("", ""), `row ${r}`);
  assert.equal(d.lines[39], FOOTER_120);
});

test("at 79x24 the list takes the whole width: no rule column, no detail beside it, and the waiting marks at the right edge", () => {
  const d = draw(golden(), S79);
  assert.equal(d.lines[0], ` acme-platform       ${COUNTS}`);
  assert.equal(d.lines[2], "─".repeat(79));
  assert.deepEqual(d.lines.slice(3, 14), [
    "  ● acme-console-expert-tui-read",
    "    ● acme-console-developer-panel                                            !",
    "    ● acme-console-developer-terms                                            !",
    "",
    "  ? acme-expert-tui                                          state unknown",
    "",
    "  ● acme-ledger-expert-retire",
    ">   ● acme-ledger-developer-note-target                                       !",
    "      ○ peer-reviewer-note",
    "",
    "  ● acme-maintainer-ops",
  ]);
  assert.deepEqual(d.lines.slice(14, 23), Array.from({ length: 9 }, () => ""));
  assert.equal(d.lines[23], FOOTER_79);
  assert.deepEqual(d.cells[10].map((cell) => cell.style.reverse), Array.from({ length: 79 }, () => true), "the selected row's bar is the whole width");
  assert.deepEqual([d.cells[4][78].text, d.cells[10][78].text], ["!", "!"], "a waiting mark stands in the last column");
  for (const line of d.lines) assert.equal(line.includes("soul "), false, "no detail is drawn beside the list");
});

test("at 60x15, the smallest size drawn, the frame keeps its shape and the roster is still read", () => {
  const d = draw(golden(), S60);
  assert.equal(d.lines[0].startsWith(" acm"), true, `the header starts with the workspace's name: ${d.lines[0]}`);
  assert.equal(d.lines[0].endsWith("1 withheld"), true);
  assert.equal(d.lines[0].includes("3 need input"), true);
  assert.equal(d.lines[1], "  Instances   Souls   Capabilities            read 10:00:00");
  assert.equal(d.lines[2], "─".repeat(60));
  assert.deepEqual(d.lines.slice(3, 14), [
    "  ● acme-console-expert-tui-read",
    "    ● acme-console-developer-panel                         !",
    "    ● acme-console-developer-terms                         !",
    "",
    "  ? acme-expert-tui                       state unknown",
    "",
    "  ● acme-ledger-expert-retire",
    ">   ● acme-ledger-developer-note-target                    !",
    "      ○ peer-reviewer-note",
    "",
    "  ● acme-maintainer-ops",
  ]);
  assert.equal(d.lines[14], FOOTER_60);
});

test("a view answers exactly as many rows as the terminal has, and every span is safe text or a fill, at a cell index, in a style value: at every size, also 3000 columns wide and too small", () => {
  const tabbed = press(golden(), ["tab"]).state, helping = press(golden(), ["?"]).state;
  const filtered = press(fresh(), ["/", "z", "z", "z"]).state;
  const states = {
    list: golden(), "list, ascii": golden({ ascii: true }), collapsed: folded(), detail: tabbed, help: helping, "help, ascii": press(golden({ ascii: true }), ["?"]).state,
    reading: stateOf(), none: stateOf(observed([])), "no match": filtered,
    stale: stateOf(failed(entry(), { code: "E_REMOTE_UNREADABLE", message: "the mirror did not answer" })),
    unavailable: stateOf(failed(entry(), { code: "E_SOMETHING_NEW", message: "a refusal nobody has seen" })),
    "unavailable, the kernel's own refusal": stateOf(failed(entry(), REFUSED("a refusal nobody has seen"))),
    "this machine and another": reached(), "a machine not reached": lost(), "a machine with no row": rowless(),
    "the switcher": choosing(), "the switcher, nothing to list": stateOf(null, { deployment: null }), "the help over the switcher": press(choosing(), ["?"]).state,
  };
  for (const [name, state] of Object.entries(states)) for (const sz of [...SIZES, size(3000, 24), size(200, 60), size(59, 15), size(60, 14), size(20, 3)]) {
    const d = draw(state, sz), at = `${name} at ${sz.cols}x${sz.rows}`;
    assert.equal(d.rows.length, sz.rows, at);
    for (const spans of d.rows) for (const span of spans) {
      assert.equal(Number.isInteger(span.col) && span.col >= 0, true, `${at}: a column is a cell index`);
      if (Object.hasOwn(span, "text")) assert.equal(isSafeText(span.text), true, `${at}: text is lit() or shown()`);
      else assert.equal(Number.isInteger(span.width) && span.width >= 0, true, `${at}: a span without text is a fill of a width`);
      if (span.width !== undefined) assert.equal(Number.isInteger(span.width) && span.width >= 0, true, `${at}: a width is a number of cells`);
      if (span.style !== undefined) assert.equal(isStyle(span.style), true, `${at}: a style is a style value`);
    }
    assert.equal(Number.isInteger(d.page) && d.page >= 1 && Number.isInteger(d.extent) && Number.isInteger(d.room) && d.room >= 1, true, at);
  }
});

test("on a terminal 3000 columns wide the rule still reaches edge to edge, the list pane stays 60 cells, its rule runs down to the footer and the counts stand at the right edge", () => {
  const sz = size(3000, 24), d = draw(golden(), sz);
  d.cells[2].forEach((cell, x) => assert.equal(cell.text, x === 60 ? "┬" : "─", `row 2, column ${x}`));
  assert.equal(cellText(d, 22), `${" ".repeat(60)}│`, "row 22: the body's last row, no rule");
  assert.equal(cellText(d, 0).length, 2999);
  assert.equal(cellText(d, 0).endsWith(COUNTS), true);
  assert.equal(cellText(d, 0, 0, 20), " acme-platform");
  assert.equal(cellText(d, 23), FOOTER_WIDE);
});

test("in ASCII nothing on the screen is outside printable ASCII: the list, the detail, the help and each empty state, at every size", () => {
  const options = { ascii: true };
  const states = {
    list: golden(options), collapsed: folded(options), "collapsed, detail": press(folded(options), ["tab"]).state, detail: press(golden(options), ["tab"]).state, help: press(golden(options), ["?"]).state,
    "help, at its end": press(golden(options), ["?", "G"], S60).state,
    reading: stateOf(null, options), none: stateOf(observed([]), options), "no match": press(fresh(options), ["/", "z", "z", "z"]).state,
    "a kept filter": press(fresh(options), ["/", "t", "u", "i", "enter"]).state,
    stale: stateOf(failed(entry(), { code: "E_REMOTE_UNREADABLE", message: "the mirror did not answer" }), options),
    unavailable: stateOf(failed(entry(), { code: "E_SOMETHING_NEW", message: "a refusal nobody has seen" }), options),
    "unavailable, the kernel's own refusal": stateOf(failed(entry(), REFUSED("a refusal nobody has seen")), options),
    // Other machines, and the switcher of a workspace on this machine alone: a workspace on two
    // machines is listed with the shared home's own separator between them, which is not ASCII
    // and is not the TUI's (the switcher's ASCII golden frame says what is drawn there).
    "this machine and another": reached(options), "a machine not reached": lost(options), "a machine with no row": rowless(options),
    "the switcher": reduce(press(local(options), ["w"]).state, { offered: OFFERED }).state, "the switcher, nothing to list": stateOf(null, { deployment: null, ...options }),
  };
  for (const [name, state] of Object.entries(states)) for (const sz of [...SIZES, size(200, 60), size(59, 15)]) {
    const d = draw(state, sz);
    d.cells.forEach((line, r) => line.forEach((cell, x) => assert.match(cell.text, /^[\x20-\x7e]$/, `${name} at ${sz.cols}x${sz.rows}: row ${r}, column ${x}`)));
    for (const line of d.lines) assert.match(line, PRINTABLE_ASCII);
  }
});

test("in ASCII a held row's own words end in three full stops, never an ellipsis: the list's word, the detail's state, the help and a start's line (#1247)", () => {
  const rows = [instanceRow("dev", "dev-retiring", { retirePending: true }), instanceRow("dev", "dev-spawning", { spawnInProgress: true, running: false, runtimeState: "stopped" })];
  const sz = size(200, 80); // tall enough for the help's marks, under the leader's table
  for (const ascii of [true, false]) {
    const at = `ascii ${ascii}`, list = stateOf(observed(rows), { ascii });
    const screens = { list, detail: press(list, ["tab"]).state, help: press(list, ["?"]).state };
    for (const [name, state] of Object.entries(screens)) {
      const text = draw(state, sz).lines.join("\n");
      assert.equal(text.includes(ascii ? "Retiring..." : "Retiring\u2026"), true, `${at}, ${name}: ${text}`);
      if (ascii) for (const line of draw(state, sz).lines) assert.match(line, PRINTABLE_ASCII, `${at}, ${name}`);
    }
    const lines = draw(list, sz).lines;
    // The spawning row's word: whole in UTF-8; in ASCII two cells wider than the column's WORD_MAX, so cut, with the ASCII cut mark.
    assert.equal(lines.some((line) => line.includes(ascii ? "Setting up worktr..." : "Setting up worktree\u2026")), true, `${at}: the spawning row's word`);
    const detail = draw(screens.detail, sz).lines.find((line) => /\bstate\b/.test(line) && line.includes("Retiring"));
    assert.ok(detail, `${at}: the detail's state is the list row's word`);
  }
});

test("without colour the screen is the same and still says everything: the bytes carry attributes only, and each state keeps a mark of its own shape", () => {
  const d = draw(golden(), S80);
  const coloured = readTerminalOutput(createScreen().render(d.rows, S80, { full: true }));
  const plain = readTerminalOutput(createScreen({ color: false }).render(d.rows, S80, { full: true }));
  assert.deepEqual(plain.foreign, []);
  assert.equal(plain.text, coloured.text, "the same cells");
  for (const { kind, body } of plain.sequences) if (kind === "sgr") assert.match(body, /^(?:[01247])(?:;[01247])*m$/, "an attribute, never a colour");
  for (const marks of [MARKS.utf8, MARKS.ascii]) assert.equal(new Set([marks.running, marks.stopped, marks.shell, marks.unknown, marks.held]).size, 5, "five states, five shapes");
});

// ── The empty states ─────────────────────────────────────────────────────────────────────────────

test("each empty state says so in one line of the list, in the TUI's words: before the first answer, with no instance, and with a filter that matches none", () => {
  assert.deepEqual({ ...EMPTY_TEXT }, { reading: "Reading the deployment.", none: "No instances in this deployment.", nomatch: "No instance matches the filter." });
  const cases = [
    [() => stateOf(), "Reading the deployment."],
    [() => stateOf(observed([])), "No instances in this deployment."],
    [() => press(fresh(), ["/", "z", "z", "z"]).state, "No instance matches the filter."],
    [() => press(fresh(), ["/", "z", "z", "z", "enter"]).state, "No instance matches the filter."],
  ];
  for (const [make, sentence] of cases) for (const sz of SIZES) {
    const d = draw(make(), sz), at = `${sentence} at ${sz.cols}x${sz.rows}`;
    const said = listLines(d, sz).map((line) => line.trim()).filter(Boolean);
    assert.deepEqual(said, [sentence], `${at}: the list holds that line and nothing else`);
    assert.deepEqual(detailLines(d, sz).filter((line) => sz.cols >= WIDE && line.trim() !== ""), [], `${at}: and no detail`);
    assert.equal(d.lines.some((line) => /\bacme-\w+-/.test(line)), false, `${at}: no instance row`);
  }
});

test("before the first answer the list holds the TUI's own line and not the shared sentence for that moment, which names an installed CLI the TUI does not use", () => {
  const state = stateOf(), detail = sharedState(state).detail;
  assert.equal(typeof detail === "string" && detail.length > 0, true, "the shared home has a sentence for a pending deployment");
  for (const sz of SIZES) {
    // The words of the shared sentence that the TUI's own line does not use: none is on the screen.
    const d = draw(state, sz), own = EMPTY_TEXT.reading.toLowerCase(), words = textOf(shown(detail)).split(" ").filter((word) => word.length > 2 && !own.includes(word.toLowerCase()));
    assert.equal(words.length >= 3, true, "the shared sentence says more than the TUI's line");
    for (const line of d.lines) for (const word of words) assert.equal(line.includes(word), false, `${sz.cols}x${sz.rows}: ${word}`);
  }
});

test("the header's second row is navigation, in every state: Instances, Souls and Capabilities with no digit and no count, the open view in reverse with a cell of it on each side, and none of them dim: each is a view that opens (QA note 1)", () => {
  const states = [stateOf(), stateOf(observed([])), press(fresh(), ["/", "z", "z", "z"]).state, golden(), press(golden(), ["?"]).state, stateOf(failed(entry(), { code: "E_SOMETHING_NEW", message: "no" })), stateOf(failed(entry(), REFUSED("no")))];
  for (const state of states) for (const sz of SIZES) {
    const d = draw(state, sz), at = `${sz.cols}x${sz.rows} ${state.view}`;
    assert.equal(cellText(d, 1, 0, 40), "  Instances   Souls   Capabilities", at);
    // The digits are the help's and the leader's hint's: none stands on the row of the views.
    assert.doesNotMatch(d.lines[1].replace(/read \d\d:\d\d:\d\d$/, ""), /\d/, `${at}: no digit`);
    for (const cell of d.cells[1].slice(1, 12)) assert.deepEqual([cell.style.reverse, cell.style.dim], [true, false], `${at}: Instances is the open view`);
    for (const [name, from] of [["Souls", 14], ["Capabilities", 22]]) {
      for (const cell of d.cells[1].slice(from, from + name.length)) assert.equal(cell.style, PLAIN, `${at}: ${name} is plain, not dim`);
      for (const cell of d.cells[1].slice(from - 1, from + name.length + 1)) assert.equal(cell.style.reverse, false, `${at}: ${name} is not the open view`);
    }
  }
});

// ── The header ───────────────────────────────────────────────────────────────────────────────────

test("the header has no title: it starts with the workspace's name after one cell of margin, and the counts stand right aligned, each a number and a word in the terminal's plain colour", () => {
  const d = draw(stateOf(observed(ROSTER(), { withheld: WITHHELD, workspace: "another-workspace" })), S120);
  assert.equal(d.lines[0], ` another-workspace${" ".repeat(44)}${COUNTS}`);
  assert.equal(d.lines[0].length, 119, "one cell of margin at the right edge");
  for (const cell of d.cells[0].slice(119 - COUNTS.length, 119)) assert.equal(cell.style.fg, null, "a count has no colour of its own");
});

test("a count of zero is left out of the header", () => {
  const running = draw(stateOf(observed([instanceRow("soul", "one"), instanceRow("soul", "two")])), S80);
  assert.equal(running.lines[0], ` acme-platform${" ".repeat(56)}2 running`);
  const stopped = draw(stateOf(observed([instanceRow("soul", "one", { running: false, runtimeState: "stopped" })])), S80);
  assert.equal(stopped.lines[0], ` acme-platform${" ".repeat(56)}1 stopped`);
  const none = draw(stateOf(observed([])), S80);
  assert.equal(none.lines[0], " acme-platform");
  for (const line of [running.lines[0], stopped.lines[0], none.lines[0]]) assert.doesNotMatch(line, /\b0 |need|unknown|withheld/);
});

test("the header says `1 needs input` for one waiting instance and `2 need input` for two", () => {
  const waiting = (n) => Array.from({ length: 3 }, (_, i) => instanceRow("soul", `dev-${i}`, i < n ? { waitingOnYou: { ...QUESTION } } : {}));
  assert.equal(draw(stateOf(observed(waiting(1))), S80).lines[0].endsWith("3 running  1 needs input"), true);
  assert.equal(draw(stateOf(observed(waiting(2))), S80).lines[0].endsWith("3 running  2 need input"), true);
  assert.equal(draw(stateOf(observed(waiting(0))), S80).lines[0].endsWith("  3 running"), true);
});

test("a withheld row is counted in the header and never drawn as a row", () => {
  const d = draw(fresh(), S120);
  assert.equal(d.lines[0].endsWith("1 withheld"), true);
  for (const line of d.lines) assert.equal(line.includes("acme-ledger-developer-twin"), false);
});

test("the second row holds the time of the read, `read HH:MM:SS`, only when the deployment is live: the cycle's own time, not the older time the kernel observed the remotes at", () => {
  const at = (iso, observedAt) => stateOf(observed(ROSTER(), { at: iso, observedAt }));
  assert.equal(draw(at("2026-10-11T14:03:27.000Z", "2026-10-11T14:02:27.000Z"), S80).lines[1].endsWith(" read 14:03:27"), true);
  assert.equal(draw(at("2026-10-11T00:00:09.000Z", "2026-10-10T23:59:09.000Z"), S60).lines[1].endsWith(" read 00:00:09"), true);
  // Kept over a failed read, the entry says since when by the same time: its last good read.
  const kept = stateOf(failed(observed(ROSTER(), { at: "2026-10-11T14:03:27.000Z", observedAt: "2026-10-11T14:02:27.000Z" }), { code: "E_REMOTE_UNREADABLE", message: "no" }, "2026-10-11T14:09:00.000Z"));
  assert.equal(sharedState(kept).key, "stale");
  for (const sz of SIZES) assert.equal(cellText(draw(kept, sz), 3).endsWith(" since 14:03:27"), true, `${sz.cols}x${sz.rows}: stale since the last good read`);
  const notLive = [stateOf(), stateOf(failed(entry(), { code: "E_REMOTE_UNREADABLE", message: "no" })), stateOf(failed(entry(), { code: "E_SOMETHING_NEW", message: "no" })), stateOf(failed(entry(), REFUSED("no")))];
  for (const state of notLive) for (const sz of SIZES) {
    assert.notEqual(sharedState(state).key, "live");
    assert.equal(draw(state, sz).lines[1], "  Instances   Souls   Capabilities", `${sz.cols}x${sz.rows}: no read time`);
  }
});

// ── The not-observed reason ──────────────────────────────────────────────────────────────────────

/** The rows that hold the reason: the rows under the state's row whose every cell, read from the
 *  cell buffer, is the next piece of `line` (the reason's display line). Nothing but the reason
 *  can be on such a row: a rule glyph, a time, a name or a word of the TUI's is not a piece of it. */
function reasonRows(d, line, cut) {
  const rows = [];
  let rest = line, whole = false, cutShort = false;
  for (let r = 4; r < d.cells.length - 2 && rows.length < 4; r++) {
    const text = d.cells[r].map((cell) => cell.text).join("").trim();
    if (text === "") break;
    if (rest === text) { rows.push(r); whole = true; break; }
    if (rest.startsWith(`${text} `)) { rows.push(r); rest = rest.slice(text.length + 1); continue; }
    if (text.endsWith(cut) && text.length > cut.length && rest.startsWith(text.slice(0, -cut.length).trimEnd())) { rows.push(r); cutShort = true; }
    break;
  }
  return { rows, whole, cutShort };
}
const STALE = (message) => ({ code: "E_REMOTE_UNREADABLE", message });
const UNAVAILABLE = (message) => ({ code: "E_SOMETHING_NEW", message });
/** The same failure as the kernel's own refusal: the shared reader marks the error the CLI printed
 *  (deployment-read-cli.mjs), and the shared sentence then says who speaks. A reason without the
 *  mark, as the two above, is one the reader made itself. */
const REFUSED = (message) => ({ ...UNAVAILABLE(message), origin: "kernel" });
const marked = (make) => (make("").origin ? ", marked as the kernel's" : "");
const SHORT_REASON = "the mirror at build-7 did not answer in time";
const LONG_REASON = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");

test("the not-observed reason of a stale deployment is the shared state's detail through shown(), on rows of its own under the state and its time, with the last observation still drawn below", () => {
  for (const ascii of [false, true]) for (const sz of SIZES) {
    const state = stateOf(failed(entry(), STALE(SHORT_REASON)), { ascii }), shared = sharedState(state), d = draw(state, sz), at = `${sz.cols}x${sz.rows}`;
    assert.equal(shared.key, "stale");
    assert.equal(shared.detail.includes(SHORT_REASON), true, "the detail carries the message the test chose");
    const line = textOf(shown(shared.detail)), reason = reasonRows(d, line, glyphsOf(ascii).cut);
    assert.equal(reason.whole, true, `${at}: the rows of the reason, joined with a space, are the detail's display line`);
    assert.equal(reason.rows[0], 4, `${at}: the reason starts on the row under the state`);
    // The row above: the state in the shared home's word and the time of the last good read.
    const above = cellText(d, 3);
    assert.equal(above.startsWith(` ${shared.text}`), true, at);
    assert.equal(above.endsWith("since 10:00:00"), true, at);
    assert.equal(above.replace(shared.text, "").replace("since 10:00:00", "").trim(), "", `${at}: and nothing else`);
    // Nothing of the TUI's leads the reason, and no line attributes it.
    assert.equal(d.cells[4].find((cell) => cell.text !== " ").text, line[0], at);
    for (const text of d.lines) assert.equal(text.includes("the kernel:"), false, at);
    // Below it, the rows of the last observation.
    const below = d.lines.slice(reason.rows.at(-1) + 1, sz.rows - 1);
    assert.equal(below.some((text) => text.includes("acme-ledger-expert") || text.includes("acme-console-expert")), true, `${at}: the last observation is still drawn`);
  }
});

test("the not-observed reason of an unavailable deployment is the shared state's detail through shown(), on rows of its own under the state, and no instance row is drawn", () => {
  for (const make of [UNAVAILABLE, REFUSED]) for (const ascii of [false, true]) for (const sz of SIZES) {
    const state = stateOf(failed(entry(), make(SHORT_REASON)), { ascii }), shared = sharedState(state), d = draw(state, sz), at = `${sz.cols}x${sz.rows}${marked(make)}`;
    assert.equal(shared.key, "unobserved");
    assert.equal(shared.detail.includes(SHORT_REASON), true, "the detail carries the message the test chose");
    const line = textOf(shown(shared.detail)), reason = reasonRows(d, line, glyphsOf(ascii).cut);
    assert.equal(reason.whole, true, `${at}: the rows of the reason, joined with a space, are the detail's display line`);
    assert.equal(reason.rows[0], 4, at);
    assert.equal(cellText(d, 3).trim(), shared.text, `${at}: the row above holds the state in the shared home's words`);
    assert.equal(d.cells[4].find((cell) => cell.text !== " ").text, line[0], at);
    for (const text of d.lines) assert.equal(text.includes("the kernel:"), false, at);
    assert.deepEqual(d.lines.slice(reason.rows.at(-1) + 1, sz.rows - 1).filter(Boolean), [], `${at}: the list holds the reason and no rows`);
    for (const text of d.lines) assert.equal(/acme-(ledger|console|maintainer|expert)-/.test(text), false, `${at}: no instance`);
  }
});

test("a reason longer than its row is wrapped onto rows that hold nothing else, at most four, and the last one ends in the cut mark", () => {
  for (const make of [STALE, UNAVAILABLE, REFUSED]) for (const ascii of [false, true]) for (const sz of SIZES) {
    const state = stateOf(failed(entry(), make(LONG_REASON)), { ascii }), d = draw(state, sz), at = `${make(LONG_REASON).code}${marked(make)} at ${sz.cols}x${sz.rows}`;
    const line = textOf(shown(sharedState(state).detail)), cut = glyphsOf(ascii).cut;
    const reason = reasonRows(d, line, cut);
    assert.equal(reason.cutShort, true, `${at}: every row is the next piece of the reason, and the last is cut`);
    assert.equal(reason.rows.length >= 2 && reason.rows.length <= 4, true, `${at}: wrapped, on ${reason.rows.length} rows`);
    assert.equal(cellText(d, reason.rows.at(-1)).endsWith(cut), true, at);
    for (const r of reason.rows) assert.equal(textWidth(cellText(d, r)) <= sz.cols, true, at);
  }
});

test("a reason that needs more than four rows takes four where the body has the room, at 80x24 and at 120x40", () => {
  for (const make of [STALE, UNAVAILABLE, REFUSED]) for (const sz of [S80, S120]) {
    const state = stateOf(failed(entry(), make(Array.from({ length: 300 }, (_, i) => `w${i}`).join(" ")))), d = draw(state, sz);
    assert.equal(reasonRows(d, textOf(shown(sharedState(state).detail)), "…").rows.length, 4, `${make("").code}${marked(make)} at ${sz.cols}x${sz.rows}`);
  }
});

test("a hostile message in the reason leaves no escape byte of its own on the screen: an ESC sequence, a bidi override, a C1 control and an OSC, stale and unavailable", () => {
  const hostile = {
    "an erase sequence": "wipe \x1b[2J the screen",
    "a bidi override": "safe\u202Etxt.exe was read",
    "a C1 control, the 8-bit CSI": "red \u009B31m alert \u009B2J",
    "an OSC that sets the title": "\x1b]0;owned\x07 and a tail",
  };
  for (const [name, message] of Object.entries(hostile)) for (const make of [STALE, UNAVAILABLE]) for (const sz of [S80, S120, S60]) {
    const state = stateOf(failed(entry(), make(message))), shared = sharedState(state), d = draw(state, sz), at = `${name}, ${make("").code}, ${sz.cols}x${sz.rows}`;
    assert.doesNotMatch(textOf(shown(message)), CONTROL, `${at}: the TUI's own filter leaves no control character of the message as it came`);
    const out = readTerminalOutput(createScreen().render(d.rows, sz, { full: true }));
    assert.deepEqual(out.foreign, [], `${at}: every ESC written begins a sequence of the TUI's own`);
    assert.deepEqual([...new Set(out.sequences.map((s) => s.kind))].filter((kind) => !["erase", "position", "sgr", "sync"].includes(kind)), [], at);
    assert.doesNotMatch(out.text, CONTROL, at);
    d.cells.forEach((line, r) => line.forEach((cell, x) => assert.doesNotMatch(cell.text, CONTROL, `${at}: row ${r}, column ${x}`)));
    const reason = reasonRows(d, textOf(shown(shared.detail)), "…");
    assert.equal(reason.whole, true, `${at}: what is drawn is the detail through shown()`);
    assert.equal(d.lines.some((line) => line.includes("owned")) && name.startsWith("an OSC"), false, at);
    // The half the shared home's filter cannot prove for us: the message handed RAW to the TUI's own
    // draw, as the notice's reason, in the model of that same state. Whatever the shared sentence did
    // or did not filter above, the frame's own shown() stands between this text and the terminal.
    const m = model(state, { page: d.page, now: NOW, at: AT, cols: d.cols });
    assert.equal(m.notice !== null && typeof m.notice.reason === "string", true, `${at}: the model of a deployment that is not live holds a notice with a reason`);
    const raw = frame({ ...m, notice: { ...m.notice, reason: message } }, sz), handed = `${at}, the message handed raw`;
    const written = readTerminalOutput(createScreen().render(raw.rows, sz, { full: true }));
    assert.deepEqual(written.foreign, [], `${handed}: every ESC written begins a sequence of the TUI's own`);
    assert.deepEqual([...new Set(written.sequences.map((s) => s.kind))].filter((kind) => !["erase", "position", "sgr", "sync"].includes(kind)), [], handed);
    assert.doesNotMatch(written.text, CONTROL, handed);
    createScreen().cells(raw.rows, sz).forEach((line, r) => line.forEach((cell, x) => assert.doesNotMatch(cell.text, CONTROL, `${handed}: row ${r}, column ${x}`)));
  }
});

test("the same hostile messages in the kernel's own refusal, a reason marked `origin: \"kernel\"`, leave no escape byte of their own on the screen either", () => {
  const hostile = {
    "an erase sequence": "wipe \x1b[2J the screen",
    "a bidi override": "safe\u202Etxt.exe was read",
    "a C1 control, the 8-bit CSI": "red \u009B31m alert \u009B2J",
    "an OSC that sets the title": "\x1b]0;owned\x07 and a tail",
  };
  for (const [name, message] of Object.entries(hostile)) for (const sz of [S80, S120, S60]) {
    const state = stateOf(failed(entry(), REFUSED(message))), shared = sharedState(state), d = draw(state, sz), at = `${name}, ${sz.cols}x${sz.rows}`;
    assert.equal(shared.key, "unobserved", at);
    assert.doesNotMatch(textOf(shown(message)), CONTROL, `${at}: the TUI's own filter leaves no control character of the message as it came`);
    const out = readTerminalOutput(createScreen().render(d.rows, sz, { full: true }));
    assert.deepEqual(out.foreign, [], `${at}: every ESC written begins a sequence of the TUI's own`);
    assert.deepEqual([...new Set(out.sequences.map((s) => s.kind))].filter((kind) => !["erase", "position", "sgr", "sync"].includes(kind)), [], at);
    assert.doesNotMatch(out.text, CONTROL, at);
    d.cells.forEach((line, r) => line.forEach((cell, x) => assert.doesNotMatch(cell.text, CONTROL, `${at}: row ${r}, column ${x}`)));
    assert.equal(reasonRows(d, textOf(shown(shared.detail)), "…").whole, true, `${at}: what is drawn is the detail through shown()`);
    assert.equal(d.lines.some((line) => line.includes("owned")), false, at);
  }
});

test("the kernel's own refusal is drawn in each of its three forms as the shared sentence gives it: with a message, with a message the display filter withholds, and with an empty one", () => {
  const SECRET = "token: ghp_abcdefghijklmnopqrstuvwxyz0123456789";
  const forms = { "a message": SHORT_REASON, "a message the display filter withholds": SECRET, "an empty message": "" };
  const details = {};
  for (const [form, message] of Object.entries(forms)) for (const ascii of [false, true]) for (const sz of SIZES) {
    const state = stateOf(failed(entry(), REFUSED(message)), { ascii }), shared = sharedState(state), d = draw(state, sz), at = `${form} at ${sz.cols}x${sz.rows}${ascii ? " ascii" : ""}`;
    assert.equal(shared.key, "unobserved", at);
    details[form] = shared.detail;
    const line = textOf(shown(shared.detail)), reason = reasonRows(d, line, glyphsOf(ascii).cut);
    assert.equal(reason.whole, true, `${at}: the rows of the reason, joined with a space, are the shared sentence's display line`);
    assert.equal(reason.rows[0], 4, `${at}: under the state`);
    assert.equal(cellText(d, 3).trim(), shared.text, `${at}: the row above holds the state in the shared home's words`);
    assert.deepEqual(d.lines.slice(reason.rows.at(-1) + 1, sz.rows - 1).filter(Boolean), [], `${at}: the list holds the reason and no rows`);
    for (const text of d.lines) assert.equal(text.includes("ghp_"), false, `${at}: nothing of a withheld message is drawn`);
  }
  // Three sentences of the shared home, told apart by what it gives and by nothing written here.
  const [said, withheld, bare] = [details["a message"], details["a message the display filter withholds"], details["an empty message"]];
  const own = sharedState(stateOf(failed(entry(), UNAVAILABLE(SHORT_REASON)))).detail;
  assert.notEqual(said, own, "the mark changes the sentence: the reader's own `<code>: <message>` is not what a kernel's refusal reads");
  assert.equal(said.startsWith(bare) && said.endsWith(displayLine(SHORT_REASON)), true, "with a message: the first sentence, then the message");
  const lead = said.slice(bare.length, said.length - displayLine(SHORT_REASON).length).trim();
  assert.equal(lead.length > 0, true, "and between them the lead that says whose words follow");
  assert.equal(withheld.startsWith(bare) && withheld.endsWith(DETAIL_WITHHELD) && !withheld.includes(lead) && !withheld.includes("ghp_"), true, "a withheld message is not introduced: the first sentence and the shared word for what was withheld");
  assert.equal(bare.length > 0 && !bare.includes(lead), true, "an empty message leaves the first sentence alone");
});

test("the stale reason, which no line attributes, keeps 2b's two conditions, through the display filter and with no text of the TUI's on its rows, whatever its message is (a line, one the filter withholds, spaces only); a remote row's runtimeError stands under its state after its speaker's words, which are what the shared originLead answers for that row, and a text the filter withholds stands alone, with no speaker", () => {
  // The stale reason holds the kept message with no speaker. Whether the shared sentence filters the
  // message itself is the shared home's: what is pinned is that the rows are its sentence through
  // shown(), and that they hold nothing else.
  const messages = { "a line": SHORT_REASON, "a message the display filter withholds": "token: ghp_abcdefghijklmnopqrstuvwxyz0123456789", "spaces only": "   " };
  for (const [kind, message] of Object.entries(messages)) for (const ascii of [false, true]) for (const sz of SIZES) {
    const state = stateOf(failed(entry(), STALE(message)), { ascii }), shared = sharedState(state), d = draw(state, sz), g = glyphsOf(ascii), at = `the stale reason, ${kind}, at ${sz.cols}x${sz.rows}${ascii ? " ascii" : ""}`;
    assert.equal(shared.key, "stale", at);
    const line = textOf(shown(shared.detail)), reason = reasonRows(d, line, g.cut);
    assert.equal(reason.whole, true, `${at}: through the display filter: the rows, joined with a space, are the shared detail's display line`);
    assert.equal(reason.rows[0], 4, `${at}: on rows of its own, from the row under the state`);
    // Around those rows: the state with its time above, the rule that opens the panes below. No row
    // of the reason holds a label, a speaker or a mark: reasonRows takes a row only when every cell
    // of it is the next piece of the line.
    assert.equal(cellText(d, 3).replace(shared.text, "").replace("since 10:00:00", "").trim(), "", at);
    assert.equal(d.cells[reason.rows.at(-1) + 1][0].text, g.rule, `${at}: the rule follows the reason`);
    for (const text of d.lines) assert.equal(text.includes("the kernel:") || text.includes("ghp_"), false, at);
    d.cells.forEach((cells, r) => cells.forEach((cell, x) => assert.doesNotMatch(cell.text, CONTROL, `${at}: row ${r}, column ${x}`)));
  }
  // A remote row's runtimeError: what its host reported, or what the read of its machine failed
  // with. On rows of its own under `state`, after the words that say who gave it. Those words are
  // on its rows and are not the TUI's: they are what the shared originLead answers for the mark
  // the shared home put on the row. A host's text is its kernel's, relayed; both failed reads are
  // the read's own (an envelope the shared read writes for a child it ended is not one the
  // installed CLI printed). A text the filter withholds is not introduced: the withheld word alone.
  const erring = (runtimeError) => heard(local(), answered(group({ instances: [farRow(FAR_A, { running: null, runtimeState: "unreachable", runtimeError })] })), T1);
  const cases = {
    "a reached machine's row with the error its host reported": [erring(UNREACHABLE), "OATS says:"],
    "a reached machine's row with an error the display filter withholds": [erring("wipe \x1b[2J the screen"), "OATS says:"],
    "a row kept from a machine whose read answered an error": [lost(), "oats tui's read of other machines says:"],
    "a row kept from a machine whose read threw": [heard(reached(), { thrown: "spawn oats ENOENT" }, T2), "oats tui's read of other machines says:"],
  };
  for (const [kind, [made, lead]] of Object.entries(cases)) for (const sz of [S160, S80]) {
    const state = selecting(made, FAR_A, sz), row = panelRow(state, FAR_A), error = row.runtimeError, d = draw(state, sz), detail = factsOf(detailLines(d, sz)), at = `${kind}, at ${sz.cols}x${sz.rows}`;
    assert.equal(typeof error === "string" && error.trim() !== "", true, `${at}: the shared home gave the row an error`);
    assert.equal(originLead(row.runtimeErrorOrigin, TERMS), lead, `${at}: and said who gave it: the words are the shared originLead's for the row`);
    const rows = fact(detail, "state").rows, withheld = displayLine(error) === DETAIL_WITHHELD;
    assert.equal(withheld, kind.includes("withholds"), at);
    if (withheld) {
      assert.deepEqual(rows.slice(1), ["[withheld]"], `${at}: a withheld text is the TUI's withheld word alone`);
      // Every lead ends in `says:`, one word, which no wrap breaks: none of it is on the screen.
      for (const text of d.lines) assert.equal(text.includes("says:") || text.includes("\""), false, `${at}: no speaker introduces it, and no quotation mark stands around it`);
    } else {
      assert.equal(rows.slice(1).join(" "), `${lead} ${textOf(shown(error))}`, `${at}: through the display filter: the rows under the state are the speaker's words and the error's display line`);
      assert.equal(rows.length >= 2, true, `${at}: on rows of its own`);
    }
    assert.equal(labels(detail)[labels(detail).indexOf("state") + 1], "harness", `${at}: and no label or held line stands with it`);
    for (const text of d.lines) assert.equal(text.includes("the kernel:") || text.includes("the host:"), false, `${at}: no word of the TUI's names a speaker`);
    d.cells.forEach((cells, r) => cells.forEach((cell, x) => assert.doesNotMatch(cell.text, CONTROL, `${at}: row ${r}, column ${x}`)));
  }
});

// ── A list row ───────────────────────────────────────────────────────────────────────────────────

test("a list row is indented two cells per level, and a row deeper than the sixth level sits at the sixth", () => {
  const chain = Array.from({ length: 8 }, (_, i) => instanceRow("soul", `level-${i}`, i ? { parentInstance: `level-${i - 1}` } : {}));
  for (const sz of [S80, S120, S79, size(60, 20)]) {
    const d = draw(stateOf(observed(chain)), sz);
    const marks = chain.map((_, i) => d.cells[rowOf(d, sz, `level-${i}`)].findIndex((cell) => cell.text === "●"));
    const names = chain.map((_, i) => d.cells[rowOf(d, sz, `level-${i}`)].map((cell) => cell.text).join("").indexOf(`level-${i}`));
    for (let i = 1; i < 8; i++) {
      assert.equal(marks[i] - marks[i - 1], i <= 5 ? 2 : 0, `${sz.cols}: level ${i} against level ${i - 1}`);
      assert.equal(names[i] - names[i - 1], i <= 5 ? 2 : 0, `${sz.cols}: the name moves with its mark`);
    }
    assert.equal(marks[5] - marks[0], 10, "the sixth level is five steps in");
    assert.deepEqual([marks[6], marks[7]], [marks[5], marks[5]], "the seventh and eighth sit at the sixth");
  }
});

test("no row carries a disclosure mark: a child stands under its parent by indentation alone, two cells a level, and only a folded row says so, with `+n` after its name for the n instances it folds away", () => {
  for (const ascii of [false, true]) for (const sz of SIZES) {
    const marks = marksOf(ascii), state = fresh({ ascii }), d = draw(state, sz);
    for (const [name, mark, depth] of [[KERNEL_EXPERT, marks.running, 0], [KERNEL_DEV, marks.running, 1], [REVIEWER, marks.stopped, 2], [DESKTOP_EXPERT, marks.running, 0], [DESKTOP_A, marks.running, 1], [DESKTOP_B, marks.running, 1], [MAINTAINER, marks.running, 0], [EXPERT_TUI, marks.unknown, 0]]) {
      const cells = d.cells[rowAt(state, sz, name)], at = `${name} at ${sz.cols}x${sz.rows}${ascii ? " ascii" : ""}`;
      assert.equal(cells[2 + 2 * depth].text, mark, `${at}: the state mark stands at its level`);
      // Before the mark: the selection mark on the selected row, and nothing else.
      assert.deepEqual(cells.slice(1, 2 + 2 * depth).map((cell) => cell.text).join("").trim(), "", at);
      assert.equal(cells[3 + 2 * depth].text, " ", at);
      assert.equal(cellText(d, rowAt(state, sz, name)).includes("+"), false, `${at}: an open row says nothing of its children`);
    }
    // Folded: the root of the one cluster folds its two children away.
    const shut = draw(folded({ ascii }), sz), row = cellText(shut, 3);
    assert.equal(row.slice(0, 4), `> ${marks.running} `, "the folded row's own cells are its marks, as any row's");
    assert.match(row, /^> . \S+ \+2 /, `${sz.cols}: \`+2\` after the name`);
  }
  for (const line of listLines(draw(fresh(), S120), S120)) assert.equal(/[▾▸]/.test(line), false, line);
});

/** One instance per state a row can be in, and what each row is to show. A retire the kernel reports
 *  interrupted didn't finish; an older kernel's pending one (no `retire`) is in progress (#1247). */
const STATES = () => [
  ["running", instanceRow("soul", "a-running")],
  ["stopped", instanceRow("soul", "b-stopped", { running: false, runtimeState: "stopped" })],
  ["shell", instanceRow("soul", "c-shell", { running: false, runtimeState: "shell" })],
  ["unknown", instanceRow("soul", "d-unreachable", { running: null, runtimeState: "unreachable", runtimeError: UNREACHABLE })],
  ["stopped", instanceRow("soul", "e-unsupported", { running: false, runtimeState: "unsupported", runtimeError: "E_HERDR_REMOVED: the session backend is gone" })],
  ["held", instanceRow("soul", "f-spawning", { running: false, runtimeState: "stopped", spawnInProgress: true })],
  ["held", instanceRow("soul", "g-half-spawned", { running: false, runtimeState: "stopped", rollbackIncomplete: true })],
  ["held", instanceRow("soul", "h-half-retired", { retirePending: true, retire: { state: "interrupted", since: "2026-10-15T00:00:00Z", self: true } })],
  ["held", instanceRow("soul", "i-retiring", { retirePending: true })],
];
/** The mark a row carries: the last thing drawn before its name. */
const markOf = (d, sz, name) => { const line = cellText(d, rowOf(d, sz, name)); return line.slice(0, line.indexOf(name)).trim().split(/\s+/).at(-1); };

test("each state has a mark of its own shape, in UTF-8 and in ASCII: running, stopped, a shell left behind, unknown, and a home the kernel holds", () => {
  assert.deepEqual({ ...MARKS.utf8 }, { running: "●", stopped: "○", shell: "◌", unknown: "?", held: "◆", selected: ">", waiting: "!" });
  assert.deepEqual({ ...MARKS.ascii }, { running: "*", stopped: "-", shell: "~", unknown: "?", held: "#", selected: ">", waiting: "!" });
  for (const ascii of [false, true]) {
    const sz = S120, d = draw(stateOf(observed(STATES().map(([, row]) => row)), { ascii }), sz);
    for (const [mark, row] of STATES()) assert.equal(markOf(d, sz, row.instance), marksOf(ascii)[mark], `${row.instance}${ascii ? " in ASCII" : ""}`);
  }
});

test("a row has a word only where its mark can't say it: none for running, stopped or a shell left, the held home's state for a home the kernel holds, and the shared label of the row's reason, dim, in one column", () => {
  const rows = STATES().map(([, row]) => row), state = stateOf(observed(rows)), sz = S120, d = draw(state, sz);
  const held = (name) => heldHome(panelRow(state, name)).state;
  const reason = (name) => rowReason(panelRow(state, name)).label;
  const expected = { "d-unreachable": reason("d-unreachable"), "e-unsupported": `${reason("e-unsupported").slice(0, 19)}…`, "f-spawning": held("f-spawning"), "g-half-spawned": held("g-half-spawned"), "h-half-retired": held("h-half-retired"), "i-retiring": held("i-retiring") };
  assert.equal(textWidth(reason("e-unsupported")) > 20, true, "the shared label of a removed session backend is wider than the column");
  const list = listWidth(sz.cols);
  for (const name of ["a-running", "b-stopped", "c-shell"]) assert.equal(cellText(d, rowOf(d, sz, name), 0, list).endsWith(name), true, `${name}: its name and nothing after it`);
  const starts = Object.entries(expected).map(([name, word]) => { const line = cellText(d, rowOf(d, sz, name), 0, list); assert.equal(line.endsWith(word), true, `${name} shows ${word}`); return line.length - word.length; });
  assert.equal(new Set(starts).size, 1, "every word starts at the same column");
  assert.equal(starts[0] + 20 <= list, true, "and the widest ends inside the pane");
  for (const name of Object.keys(expected)) {
    const cells = d.cells[rowOf(d, sz, name)];
    assert.equal(cells[starts[0] - 1].text, " ", "a gap stands before the column");
    assert.equal(cells.slice(starts[0], starts[0] + 3).every((cell) => cell.style.dim), true, `${name}: the word is dim`);
  }
});

test("the word column is as wide as the widest word among all the rows, and never wider than 20 cells: a longer word is cut with the mark; a row without a word gives its name the column's cells, and a list with no word has no column", () => {
  const LONG = "n".repeat(130);
  const HELD = { running: false, runtimeState: "stopped", spawnInProgress: true };
  const HERDR = { running: false, runtimeState: "unsupported", runtimeError: "E_HERDR_REMOVED: the session backend is gone" };
  for (const sz of [S80, S120, S79]) {
    const list = sz.cols >= WIDE ? listWidth(sz.cols) : sz.cols;
    // No word anywhere: a long name runs to the cells kept for the waiting mark and a gap, and is
    // cut there; from its mark on, the row is the same in a list that has a word column.
    const cut = `● ${"n".repeat(list - 10)}…`;
    const quiet = draw(stateOf(observed([instanceRow("soul", LONG)])), sz);
    assert.equal(cellText(quiet, 3, 2, list), cut, `${sz.cols}: the name has every cell but the waiting mark's and a gap`);
    for (const extra of [HELD, HERDR]) {
      const state = stateOf(observed([instanceRow("soul", "row-0"), instanceRow("soul", LONG), instanceRow("soul", "worded", extra)]));
      const d = draw(state, sz), row = panelRow(state, "worded");
      const full = heldHome(row)?.state ?? rowReason(row).label;
      const shown = textWidth(full) > 20 ? `${full.slice(0, 19)}…` : full;
      const worded = cellText(d, rowOf(d, sz, "worded"), 0, list), column = worded.length - shown.length;
      assert.equal(worded.endsWith(shown), true, `${full} at ${sz.cols}`);
      assert.equal(list - 5 - column, Math.min(20, textWidth(full)), `${sz.cols}: the column is as wide as its widest word, at most 20`);
      assert.equal(d.cells[rowOf(d, sz, "worded")][column - 1].text, " ", "the name never runs into the word");
      // The long name of a row without a word is not cut by the column.
      assert.equal(cellText(d, rowOf(d, sz, LONG.slice(0, 20)), 2, list), cut, `${sz.cols}: a row without a word keeps the column's cells`);
    }
  }
});

test("the selected row is drawn in reverse video over the whole width of its pane and carries `>` in its first cell: the selection never rests on an attribute alone", () => {
  for (const ascii of [false, true]) for (const name of [KERNEL_EXPERT, KERNEL_DEV, REVIEWER, DESKTOP_EXPERT, DESKTOP_A, DESKTOP_B, MAINTAINER, EXPERT_TUI]) {
    const state = selecting(fresh({ ascii }), name);
    for (const sz of [...SIZES, size(200, 30)]) {
      const d = draw(state, sz), at = `${name} at ${sz.cols}x${sz.rows}`;
      const pane = sz.cols >= WIDE ? listWidth(sz.cols) : sz.cols, selected = rowAt(state, sz, name);
      assert.equal(d.cells[selected][0].text, ">", at);
      assert.deepEqual(d.cells[selected].map((cell) => cell.style.reverse), Array.from({ length: sz.cols }, (_, x) => x < pane), `${at}: every cell of the pane, and none past it`);
      // The header's row of views draws the open one in reverse: it is the only other.
      assert.deepEqual(d.cells.flatMap((line, r) => (r !== selected && line.some((cell) => cell.style.reverse) ? [r] : [])), [1], `${at}: no other row is in reverse video but the open view's name`);
      assert.deepEqual(bodyRows(sz).filter((r) => r !== selected && d.cells[r][0].text === ">"), [], `${at}: no other row carries the selection mark`);
    }
  }
});

test("a waiting row carries `!` at the right edge of its pane, and an expanded row carries nothing for the rows that wait below it", () => {
  for (const ascii of [false, true]) for (const sz of SIZES) {
    const pane = sz.cols >= WIDE ? listWidth(sz.cols) : sz.cols, state = fresh({ ascii }), d = draw(state, sz);
    /** The cells of a row from its last name or word to the pane's edge, and its last cell. */
    const edge = (name) => { const cells = d.cells[rowAt(state, sz, name)].slice(0, pane); return [cells.slice(pane - 2).map((cell) => cell.text).join(""), cells.filter((cell) => cell.text === "!").length]; };
    for (const name of [KERNEL_DEV, DESKTOP_A, DESKTOP_B]) {
      assert.deepEqual(edge(name), [" !", 1], `${name} at ${sz.cols}x${sz.rows}: the mark is inside the pane, at its edge, after a gap`);
    }
    for (const name of [KERNEL_EXPERT, DESKTOP_EXPERT, MAINTAINER, REVIEWER, EXPERT_TUI]) assert.deepEqual(edge(name), ["  ", 0], `${name} at ${sz.cols}x${sz.rows}`);
  }
});

test("a collapsed row carries `+n` after its name for the n instances it folds away and `!N` for the N rows waiting below it, and the rows below it are not drawn: one cluster and no single instance, cell for cell", () => {
  const header = (cols) => ` acme-platform${" ".repeat(cols - 38)}3 running  2 need input`;
  const shut = model(folded(), { page: 19, now: NOW, at: AT }).list.find((row) => row?.selected);
  assert.deepEqual([shut.name, shut.folded, shut.below], [DESKTOP_EXPERT, 2, 2], "two folded away, both waiting");
  const d80 = draw(folded(), S80), a80 = draw(folded({ ascii: true }), S80), d60 = draw(folded(), S60), d120 = draw(folded(), S120);
  assert.equal(d80.lines[0], header(80));
  // The name is cut before the count is: `+2` stays whole after what is left of it.
  assert.equal(cellText(d80, 3, 0, 39), "> ● acme-console-expert-tui-r… +2   !2│");
  assert.equal(cellText(a80, 3, 0, 39), "> * acme-console-expert-tui... +2   !2|");
  assert.equal(d60.lines[3], `${`> ● ${DESKTOP_EXPERT} +2`.padEnd(58)}!2`);
  assert.equal(cellText(d120, 3, 0, 58), `${`> ● ${DESKTOP_EXPERT} +2`.padEnd(55)}!2│`);
  assert.deepEqual(d80.cells[3].slice(31, 33).map((cell) => [cell.text, cell.style.reverse]), [["+", true], ["2", true]], "the count stands in the selection's bar");
  for (const [d, sz] of [[d80, S80], [a80, S80], [d60, S60], [d120, S120]]) {
    assert.deepEqual(listLines(d, sz).slice(1).filter((line) => line.trim()), [], "the rows below a collapsed row are not drawn, and no other row is");
    const pane = sz.cols >= WIDE ? listWidth(sz.cols) : sz.cols;
    assert.deepEqual(d.cells[3].slice(pane - 2, pane).map((cell) => cell.text), ["!", "2"], "the mark is inside the pane, at its edge");
    d.cells[3].forEach((cell, x) => assert.equal(cell.style.reverse, x < pane));
  }
  // Expanded again, the three rows are back and the roll-up is gone.
  const open = press(folded(), ["l"]).state, lines = listLines(draw(open, S79), S79).filter((line) => line.trim());
  assert.deepEqual(lines, [
    `> ● ${DESKTOP_EXPERT}`,
    `${`    ● ${DESKTOP_A}`.padEnd(78)}!`,
    `${`    ● ${DESKTOP_B}`.padEnd(78)}!`,
  ]);
});

test("collapsing a root in a roster of several clusters hides the rows below it, keeps the selection on it and gives it the roll-up and the count of what it folds away, wherever the shared grouping then puts the row", () => {
  const before = selecting(fresh(), DESKTOP_EXPERT), state = press(before, ["h"]).state;
  assert.equal(state.selected, before.selected, "the selection is the same instance");
  for (const sz of [S79, S60]) {
    const lines = listLines(draw(state, sz), sz), drawn = (name) => lines.filter((line) => line.includes(` ${name} `) || line.trimEnd().endsWith(` ${name}`));
    assert.deepEqual([drawn(DESKTOP_A).length, drawn(DESKTOP_B).length], [0, 0], "the rows below it are not drawn");
    for (const name of [KERNEL_EXPERT, KERNEL_DEV, REVIEWER, MAINTAINER, EXPERT_TUI]) assert.equal(drawn(name).length, 1, `${name} is still drawn`);
    const root = drawn(DESKTOP_EXPERT);
    assert.equal(root.length, 1);
    assert.equal(root[0].startsWith(`> ● ${DESKTOP_EXPERT} +2 `), true, "selected, two instances folded away");
    assert.equal(root[0].endsWith("  !2"), true, "two rows wait below it");
    assert.equal(lines.filter((line) => line.startsWith(">")).length, 1);
  }
  // A filter draws every match whatever is collapsed, and leaves the collapse as it is.
  const filtered = press(state, ["/", "p", "a", "n", "e", "l", "enter"]).state, matched = listLines(draw(filtered, S79), S79).filter((line) => line.trim());
  assert.equal(matched.some((line) => line.includes(DESKTOP_A)), true, "a match under a collapsed row is drawn");
  assert.equal(matched.some((line) => line.includes(KERNEL_EXPERT) || line.includes(MAINTAINER) || line.includes(DESKTOP_B)), false, "and what does not match is not");
  const cleared = listLines(draw(press(filtered, ["escape"]).state, S79), S79);
  assert.equal(cleared.some((line) => line.includes(DESKTOP_A)), false, "with the filter cleared the row is collapsed as before");
  assert.equal(cleared.some((line) => line.includes(`● ${DESKTOP_EXPERT} +2`)), true);
  assert.equal(matched.some((line) => line.includes("+2")), false, "a filter folds nothing away");
});

test("a waiting claim on a stale deployment is not drawn: no mark on the row, no count in the header, no `needs` line", () => {
  for (const sz of [S120, S79]) {
    const stale = selecting(stateOf(failed(entry(), STALE("the mirror did not answer"))), KERNEL_DEV), d = draw(stale, sz);
    assert.equal(d.lines[0].includes("input"), false);
    assert.equal(d.lines.some((line) => line.includes("acme-ledger-developer-note")), true, "the row is drawn");
    for (const line of d.lines.slice(3, sz.rows - 1)) assert.equal(/claude\s+!\d*(\u2502|$)/.test(line), false, "no waiting mark");
    for (const line of d.lines) assert.equal(/\bneeds\b/.test(line), false, "no needs line");
    const page = draw(press(stale, ["tab"], S79).state, S79);
    assert.equal(page.lines.some((line) => line.trim().startsWith("soul ")), true, "the detail is drawn");
    for (const line of page.lines) assert.equal(/\bneeds\b/.test(line), false);
  }
});

// ── Cells ────────────────────────────────────────────────────────────────────────────────────────

const FAMILY = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}", FLAG = "\u{1F1EA}\u{1F1F8}", THUMB = "\u{1F44D}\u{1F3FD}";
const NAMES = {
  "wide graphemes": "名前".repeat(40),
  "wide graphemes after one narrow cell": `x${"名前".repeat(40)}`,
  "family emoji joined by ZWJ": FAMILY.repeat(30),
  "flags": FLAG.repeat(40),
  "emoji with a skin tone": THUMB.repeat(40),
  "emoji of every kind and text": `${FAMILY} dev ${FLAG} ${THUMB} `.repeat(12).trim(),
  "combining marks": "e\u0301a\u0308o\u0302".repeat(40),
  "10 000 characters": "n".repeat(10000),
  "10 000 wide characters": "字".repeat(10000),
};
const HOME = `${DEPLOYMENT}/agents/soul/instances`;
/** The shared display filter reads a run of 10 000 letters slowly (a third of a second of CPU a
 *  call: its credentialed-URL pattern backtracks), and every paint filters again: that name is
 *  drawn at one size, the others at four. 10 000 wide characters cost nothing. */
const SLOW = "10 000 characters";
const sizesFor = (kind, sizes) => (kind === SLOW ? sizes.slice(0, 1) : sizes);

test("a row whose name is wide graphemes, emoji sequences, combining marks or 10 000 characters never passes its pane: the panes' rule and the detail's cells are untouched", () => {
  // The row holds a word (a held home's state), so its name is cut before the word column.
  const rows = (second) => [instanceRow("soul", "aaa-anchor"), instanceRow("soul", second, { home: `${HOME}/zzz`, retirePending: true })];
  const HELD_WORD = heldHome({ retirePending: true }).state;
  for (const ascii of [false, true]) {
    // The TUI's own ellipsis is three full stops in ASCII (term/text.mjs ownEllipsis).
    const WORD = ascii ? HELD_WORD.replaceAll("\u2026", "...") : HELD_WORD;
    /** The anchor selected: its detail is what stands beside the list in both frames. */
    const anchored = (state) => (String(state.selected).endsWith("/aaa-anchor") ? state : selecting(state, "aaa-anchor"));
    const beside = anchored(stateOf(observed(rows("zzz")), { ascii })), g = glyphsOf(ascii);
    for (const [kind, name] of Object.entries(NAMES)) {
      if (kind === SLOW && ascii) continue;
      const state = anchored(stateOf(observed(rows(name)), { ascii }));
      for (const sz of sizesFor(kind, [S80, S120, size(81, 24), size(83, 24)])) {
        const subject = draw(state, sz), control = draw(beside, sz), list = listWidth(sz.cols), at = `${kind} at ${sz.cols}x${sz.rows}${ascii ? " ascii" : ""}`;
        assert.deepEqual(bodyRows(sz).filter((r) => subject.cells[r][list].text !== g.bar), [], `${at}: every row still has the rule at column ${list}`);
        for (const r of bodyRows(sz)) assert.deepEqual(subject.cells[r].slice(list), control.cells[r].slice(list), `${at}: row ${r} of the detail is as it is beside a short name`);
        for (const r of [0, 1, 2, sz.rows - 2, sz.rows - 1]) assert.deepEqual(subject.cells[r], control.cells[r], `${at}: row ${r} of the frame is untouched`);
        // The row is drawn, cut, and ends in the cut mark before its word.
        const r = bodyRows(sz).find((row) => subject.lines[row] !== control.lines[row]);
        assert.notEqual(r, undefined, `${at}: the row is drawn`);
        const cells = subject.cells[r], word = cellIndexOf(cells.slice(0, list), WORD);
        assert.equal(word > 0, true, `${at}: the word is still drawn in its column`);
        const c = bodyRows(sz).find((row) => control.lines[row].includes("zzz"));
        assert.equal(word, cellIndexOf(control.cells[c].slice(0, list), WORD), `${at}: and the column did not move`);
        assert.equal(cells[word - 1].text, " ", `${at}: the name stops before the word`);
        const drawn = cells.slice(0, word).filter((cell) => cell.text !== " " && cell.text !== "");
        assert.equal(drawn.slice(-g.cut.length).map((cell) => cell.text).join(""), g.cut, `${at}: the cut name ends in the cut mark`);
        assert.equal(drawn.length > g.cut.length + 2, true, `${at}: and some of the name is drawn before it`);
        // A wide grapheme is whole or absent: its two cells are both inside the pane.
        const split = cells.map((cell, x) => (cell.width === 2 && !(x + 1 < list && cells[x + 1].width === 0)) || (cell.width === 0 && cells[x - 1]?.width !== 2) ? x : null).filter((x) => x !== null);
        assert.deepEqual(split, [], `${at}: no wide grapheme is split, and none crosses the pane's edge`);
        assert.equal(cells.reduce((sum, cell) => sum + cell.width, 0), sz.cols, `${at}: the row's graphemes take exactly the terminal's columns`);
        if (!ascii && kind !== "combining marks" && !kind.startsWith("10 000 char")) assert.equal(cells.slice(0, word).some((cell) => cell.width === 2), true, `${at}: the name is drawn in two-cell graphemes`);
      }
    }
  }
});

test("the same holds for the selected row and in the detail beside it: a name of wide and joined graphemes is cut inside the list pane and inside the detail", () => {
  for (const [kind, name] of Object.entries(NAMES)) {
    const state = stateOf(observed([instanceRow("soul", name, { home: `${HOME}/zzz`, branch: kind === SLOW ? "agents/zzz" : name })]));
    assert.equal(state.selected, `${HOME}/zzz`);
    for (const sz of sizesFor(kind, [S80, S79, S120, S60])) {
      const d = draw(state, sz), at = `${kind} at ${sz.cols}x${sz.rows}`;
      const wide = sz.cols >= WIDE, list = wide ? listWidth(sz.cols) : sz.cols;
      assert.deepEqual(d.cells[3].map((_, x) => reversed(d.cells[3], x)), Array.from({ length: sz.cols }, (_, x) => x < list), `${at}: the bar is the pane`);
      assert.equal(d.cells[3][0].text, ">", at);
      if (wide) assert.deepEqual(bodyRows(sz).filter((r) => d.cells[r][list].text !== "│"), [], `${at}: the panes' rule is whole`);
      d.cells.forEach((line, r) => {
        const split = line.map((cell, x) => (cell.width === 2 && !(x + 1 < sz.cols && line[x + 1].width === 0 && (!wide || x < list === x + 1 < list))) || (cell.width === 0 && line[x - 1]?.width !== 2) ? x : null).filter((x) => x !== null);
        assert.deepEqual(split, [], `${at}: row ${r}: no wide grapheme is split, in a pane or across the two`);
        assert.equal(line.reduce((sum, cell) => sum + cell.width, 0), sz.cols, `${at}: row ${r}: the graphemes of a row take exactly the terminal's columns`);
      });
      // No rule above the footer: the body's last row holds the panes' rule and nothing else.
      assert.equal(d.lines[sz.rows - 2], wide ? `${" ".repeat(list)}│` : "", at);
      // The detail's title and its work line hold the name too, cut inside the detail.
      if (wide) assert.equal(d.cells[3].slice(list + 1).some((cell) => cell.text === "…"), true, `${at}: the title is cut with the mark`);
    }
  }
});

// ── Scrolling ────────────────────────────────────────────────────────────────────────────────────

test("a roster of 200 scrolled with the keys: the selected row is always on the screen, at most a page of instances is drawn, and the pane's last row says what is cut off, in the TUI's words", () => {
  assert.equal(cutNote(0, 12), "12 more below");
  assert.equal(cutNote(0, 0), "");
  const names = Array.from({ length: 200 }, (_, i) => `inst-${String(i).padStart(3, "0")}`);
  const many = observed(names.map((name) => instanceRow("soul", name)));
  for (const sz of [S80, S60]) {
    let state = stateOf(many);
    const pane = sz.cols >= WIDE ? listWidth(sz.cols) : sz.cols;
    const check = (keys) => {
      const d = draw(state, sz), at = `${sz.cols}x${sz.rows} after ${keys}`;
      const drawn = bodyRows(sz).map((r) => /inst-(\d{3})/.exec(cellText(d, r, 0, pane))).map((match) => (match ? Number(match[1]) : null));
      const onScreen = drawn.filter((n) => n !== null);
      assert.equal(onScreen.length <= d.page, true, `${at}: at most a page of instances`);
      assert.equal(onScreen.length >= d.page - 1, true, `${at}: and the pane is full`);
      assert.deepEqual(onScreen, onScreen.map((_, i) => onScreen[0] + i), `${at}: in order, none left out`);
      const selected = names.indexOf(String(state.selected).split("/").at(-1));
      assert.equal(onScreen.includes(selected), true, `${at}: inst-${selected} is selected and on the screen`);
      assert.equal(d.cells[3 + drawn.indexOf(selected)][0].text, ">", at);
      assert.equal(cellText(d, sz.rows - 2, 0, pane).trim(), cutNote(onScreen[0], 199 - onScreen.at(-1)), `${at}: the pane's last row, the one above the footer, says what is cut off`);
      return { first: onScreen[0], last: onScreen.at(-1), selected };
    };
    let seen = check("nothing");
    assert.deepEqual([seen.first, seen.selected], [0, 0]);
    for (let i = 1; i <= 6; i++) { state = press(state, ["pagedown"], sz).state; const next = check(`${i} page-down`); assert.equal(next.selected > seen.selected, true); seen = next; }
    state = press(state, ["pageup"], sz).state; assert.equal(check("page-up").selected < seen.selected, true);
    state = press(state, ["G"], sz).state; seen = check("G");
    assert.deepEqual([seen.last, seen.selected], [199, 199]);
    state = press(state, ["g"], sz).state; seen = check("g");
    assert.deepEqual([seen.first, seen.selected], [0, 0]);
    // The window moves the least that keeps the selection inside it.
    for (let i = 0; i < 24; i++) {
      state = press(state, ["j"], sz).state;
      const next = check(`${i + 1} down`);
      assert.equal(next.first - seen.first, next.selected > seen.last ? 1 : 0, `${sz.cols}x${sz.rows}: down ${i + 1} moves the window only when it must, by one row`);
      seen = next;
    }
    for (let i = 0; i < 24; i++) {
      state = press(state, ["k"], sz).state;
      const next = check(`${i + 1} up`);
      assert.equal(seen.first - next.first, next.selected < seen.first ? 1 : 0, `${sz.cols}x${sz.rows}: up ${i + 1}`);
      seen = next;
    }
  }
});

test("the word column does not move while the list scrolls: it is as wide as the widest word of the whole roster, not of the rows on the screen", () => {
  // The widest word, a held home's state (a retire that didn't finish), is on the first row; the
  // last row's word is narrower.
  const rows = [instanceRow("soul", "inst-000", { retirePending: true, retire: { state: "interrupted", since: "2026-10-15T00:00:00Z", self: true } }), ...Array.from({ length: 198 }, (_, i) => instanceRow("soul", `inst-${String(i + 1).padStart(3, "0")}`)), instanceRow("soul", "inst-199", { running: null, runtimeState: "unreachable" })];
  const top = stateOf(observed(rows)), end = press(top, ["G"]).state;
  const held = heldHome(rows[0]).state, unknown = rowReason(panelRow(top, "inst-199")).label;
  assert.equal(textWidth(held) > textWidth(unknown), true);
  const column = (d, word) => cellText(d, bodyRows(S80).find((r) => cellText(d, r, 0, 38).endsWith(word)), 0, 38).length - word.length;
  assert.equal(draw(end).lines.some((line) => line.includes("inst-199")), true);
  assert.equal(draw(end).lines.some((line) => line.includes("inst-000")), false, "the widest word is not on the screen");
  assert.equal(column(draw(top), held), column(draw(end), unknown));
});

// ── The detail ───────────────────────────────────────────────────────────────────────────────────

const S160 = size(160, 40);
const detailOf = (state, sz = S160) => factsOf(detailLines(draw(state, sz), sz));

test("the detail is a label and a value per line, the labels the TUI's own and in the spec's order, under the instance's name", () => {
  const state = golden(), detail = detailOf(state);
  assert.equal(detail.title, KERNEL_DEV);
  assert.deepEqual(labels(detail), ["soul", "state", "needs", "harness", "work", "team", "parent", "started", "home"]);
  assert.equal(new Set(detail.facts.map((f) => f.col)).size, 1, "every value starts at the same column");
  assert.deepEqual(fact(detail, "soul").rows, ["acme-ledger-developer"]);
  assert.deepEqual(fact(detail, "state").rows, ["running"]);
  assert.deepEqual(fact(detail, "needs").rows, [NEEDS, 'the agent: "Which base should it use?"'], "the reason in words and how long, then the message as an attributed quote");
  assert.deepEqual(fact(detail, "harness").rows, ["claude, claude-opus-5-5 (soul)"], "the harness as its id, the model, and where the model came from in brackets");
  assert.deepEqual(fact(detail, "work").rows, [`worktree, agents/${KERNEL_DEV}`]);
  assert.deepEqual(fact(detail, "team").rows, ["eng"]);
  assert.deepEqual(fact(detail, "parent").rows, [KERNEL_EXPERT]);
  assert.deepEqual(fact(detail, "started").rows, [STARTED]);
  assert.deepEqual(fact(detail, "home").rows, [`${DEPLOYMENT}/agents/acme-ledger-developer/instances/${KERNEL_DEV}`]);
});

test("the waited time is the time of the paint: the same state drawn later says so, and nothing else on the screen counts up", () => {
  const state = golden(), later = NOW + 3 * 3600 * 1000;
  const early = draw(state, S160), late = draw(state, S160, { now: later });
  assert.deepEqual(fact(factsOf(detailLines(late, S160)), "needs").rows[0], `${waitingLabel(QUESTION)}, ${waitedText(QUESTION.since, later)}`);
  assert.notEqual(waitedText(QUESTION.since, later), waitedText(QUESTION.since, NOW));
  const changed = early.lines.map((line, r) => (line === late.lines[r] ? null : r)).filter((r) => r !== null);
  assert.equal(changed.length, 1, "one row differs between the two paints: the waited time's");
});

test("a line whose value is absent is left out of the detail", () => {
  const bare = instanceRow("soul", "bare", { harness: null, model: null, modelFrom: undefined, work: undefined, branch: null, startedAt: undefined });
  assert.deepEqual(labels(detailOf(stateOf(observedIn([bare], { team: "" })))), ["soul", "state", "home"]);
  const some = instanceRow("soul", "some", { model: null, modelFrom: undefined, branch: null });
  const detail = detailOf(stateOf(observed([some])));
  assert.deepEqual(labels(detail), ["soul", "state", "harness", "work", "team", "started", "home"]);
  assert.deepEqual(fact(detail, "harness").rows, ["claude"], "no model, no brackets");
  assert.deepEqual(fact(detail, "work").rows, ["worktree"], "no branch");
  const unsaid = detailOf(stateOf(observed([instanceRow("soul", "unsaid", { modelFrom: undefined })])));
  assert.deepEqual(fact(unsaid, "harness").rows, ["claude, claude-opus-5-5"], "where the model came from only when the row says");
});

test("the detail's parent line holds the parent, and `sibling of <name>` for an instance spawned as a sibling", () => {
  const rows = [instanceRow("soul", "root-a"), instanceRow("soul", "child", { parentInstance: "root-a" }), instanceRow("soul", "twin", { siblingInstance: "root-a" }), instanceRow("soul", "both", { parentInstance: "root-a", siblingInstance: "child" })];
  const state = stateOf(observed(rows));
  assert.equal(fact(detailOf(selecting(state, "root-a")), "parent"), null);
  assert.deepEqual(fact(detailOf(selecting(state, "child")), "parent").rows, ["root-a"]);
  assert.deepEqual(fact(detailOf(selecting(state, "twin")), "parent").rows, ["sibling of root-a"]);
  const both = fact(detailOf(selecting(state, "both")), "parent").rows.join(" ");
  assert.equal(both.startsWith("root-a") && both.endsWith("sibling of child"), true);
});

test("the detail's state line holds the kernel's own name for the state, or the shared label of the row's reason when the shared home gives one, and the kernel's runtimeError on the rows under it, after `OATS says:`", () => {
  // The roster as a read cycle makes it: the kernel answered `running: null` for this row, with
  // its text, so the collector did not probe it and the text is the kernel's.
  const state = selecting(stateOf(readCycle(ROSTER(), { withheld: WITHHELD })), EXPERT_TUI);
  for (const sz of [S160, S120, S80]) {
    const detail = detailOf(state, sz), rows = fact(detail, "state").rows;
    assert.equal(rows[0], "unreachable", `${sz.cols}`);
    assert.equal(rows.slice(1).join(" "), `OATS says: ${textOf(shown(UNREACHABLE))}`, `${sz.cols}: who gave it and the error, whole, with no quotation mark, on rows of its own`);
    assert.equal(labels(detail)[labels(detail).indexOf("state") + 1], "harness", "and no line of its own label");
  }
  assert.equal(fact(detailOf(state, S80), "state").rows.length > 2, true, "at 80 columns it wraps");
  assert.deepEqual(fact(detailOf(selecting(golden(), REVIEWER)), "state").rows, ["stopped"]);
  const shell = stateOf(observed([instanceRow("soul", "sh", { running: false, runtimeState: "shell" })]));
  assert.deepEqual(fact(detailOf(shell), "state").rows, ["shell"]);
  // A session backend OATS no longer has, reported by a kernel that gives its own reason.
  const unsupported = stateOf(readCycle([instanceRow("soul", "old", { running: false, runtimeState: "unsupported", runtimeError: "E_HERDR_REMOVED: gone" })]));
  assert.deepEqual(fact(detailOf(unsupported), "state").rows, [rowReason(panelRow(unsupported, "old")).label, "OATS says: E_HERDR_REMOVED: gone"]);
});

test("the detail's held line is the sentence the shared home gives for a home the kernel holds, wrapped under its label", () => {
  const rows = STATES().map(([, row]) => row), all = stateOf(observed(rows));
  for (const name of ["f-spawning", "g-half-spawned", "h-half-retired", "i-retiring"]) {
    const state = selecting(all, name), acts = instanceActs(panelRow(state, name)), sentence = (acts.blocked ?? acts.limited).sentence;
    assert.equal(typeof sentence === "string" && sentence.includes(name), true);
    for (const sz of [S160, S80, S60]) {
      const d = draw(sz.cols < WIDE ? press(state, ["tab"], sz).state : state, sz), held = fact(factsOf(detailLines(d, sz)), "held");
      assert.equal(held.rows.join(" "), textOf(shown(sentence)), `${name} at ${sz.cols}`);
      // A retire in progress says the least: its sentence may fit the pane.
      if (sz.cols === 80 && name !== "i-retiring") assert.equal(held.rows.length > 1, true, `${name}: a sentence longer than the pane wraps`);
    }
  }
  for (const name of ["a-running", "b-stopped", "c-shell", "d-unreachable", "e-unsupported"]) assert.equal(fact(detailOf(selecting(all, name)), "held"), null, `${name} is not held`);
});

test("the detail's state line of a home the kernel holds is the held home's state, the same word the list shows at the row's right edge", () => {
  const rows = STATES().map(([, row]) => row), all = stateOf(observed(rows));
  for (const name of ["f-spawning", "g-half-spawned", "h-half-retired", "i-retiring"]) {
    const state = selecting(all, name), word = heldHome(panelRow(state, name)).state, d = draw(state, S160);
    assert.equal(cellText(d, rowOf(d, S160, name), 0, 60).endsWith(word), true, `${name}: the list shows the held home's state`);
    assert.deepEqual(fact(factsOf(detailLines(d, S160)), "state").rows, [textOf(shown(word))], `${name}: and so does the detail's state line`);
  }
});

test("the detail of a collapsed row with rows waiting below it says who, in the shared home's words", () => {
  const state = folded(), panel = panelOf(state, AT);
  const below = panel.instances.filter((row) => row.parentInstance === DESKTOP_EXPERT);
  assert.equal(below.length, 2);
  const detail = detailOf(state);
  assert.deepEqual(fact(detail, "below").rows, [waitingBelowText(below)]);
  assert.deepEqual(labels(detail), ["soul", "state", "below", "harness", "work", "team", "started", "home"]);
  assert.equal(fact(detail, "needs"), null, "the row itself waits for nothing");
  assert.equal(fact(detailOf(press(state, ["l"]).state), "below"), null, "an expanded row has no such line: the rows are on the screen");
  assert.equal(fact(detailOf(selecting(fresh(), DESKTOP_EXPERT)), "below"), null);
  assert.equal(fact(detailOf(selecting(fresh(), KERNEL_EXPERT)), "below"), null);
});

test("a waiting message the shared read withholds is not drawn: the reason in words alone, and no quote line", () => {
  for (const message of ["wipe \x1b[2J now", "safe\u202Etxt.exe", "a\u009B31mb", "token: ghp_abcdefghijklmnopqrstuvwxyz0123456789", "x".repeat(300)]) {
    const claim = { since: QUESTION.since, producer: "claude", reason: "permission", message };
    const state = stateOf(observed([instanceRow("soul", "asks", { waitingOnYou: claim })])), d = draw(state, S160);
    assert.deepEqual(fact(factsOf(detailLines(d, S160)), "needs").rows, [`${waitingLabel(claim)}, ${waitedText(claim.since, NOW)}`], JSON.stringify(message.slice(0, 20)));
    for (const line of d.lines) assert.equal(line.includes("the agent:"), false);
    d.cells.forEach((line) => line.forEach((cell) => assert.doesNotMatch(cell.text, CONTROL)));
  }
});

test("the home path is cut from the left, so its end is read: the cut mark first, then the end of the path up to the pane's last cells", () => {
  const home = `${DEPLOYMENT}/agents/acme-ledger-developer/instances/${KERNEL_DEV}`;
  for (const ascii of [false, true]) for (const sz of [S80, S120, size(100, 24)]) {
    const d = draw(golden({ ascii }), sz), list = listWidth(sz.cols), cut = glyphsOf(ascii).cut;
    const r = bodyRows(sz).find((row) => cellText(d, row, list + 1).trim().startsWith("home "));
    const cells = d.cells[r].slice(list + 1), line = cells.map((cell) => cell.text).join("");
    const from = line.indexOf("home") + 4 + line.slice(line.indexOf("home") + 4).search(/\S/), value = line.slice(from).trimEnd();
    assert.equal(value.startsWith(cut), true, `${sz.cols}: the first cells of the value are the cut mark`);
    assert.equal(home.endsWith(value.slice(cut.length)), true, `${sz.cols}: the rest is the end of the path`);
    assert.equal(value.at(-1), home.at(-1));
    assert.equal(value.slice(cut.length).length >= 20, true, `${sz.cols}: as much of the path as the pane has cells`);
    assert.equal(list + 1 + from + value.length, sz.cols - 1, `${sz.cols}: the value ends one cell before the screen's edge`);
  }
  assert.deepEqual(fact(detailOf(golden()), "home").rows, [home], "a path that fits is whole, with no mark");
});

test("in the wide layout tab moves the focus to the detail, which says so with `>` beside its title, and tab or Esc moves it back", () => {
  for (const sz of [S80, S120, size(100, 24)]) {
    const list = golden(), focused = press(list, ["tab"], sz).state, before = draw(list, sz), after = draw(focused, sz), width = listWidth(sz.cols);
    assert.equal(cellText(before, 3, width + 1).trim(), KERNEL_DEV);
    assert.equal(cellText(after, 3, width + 1).trim(), `> ${KERNEL_DEV}`);
    assert.equal(factsOf(detailLines(after, sz)).focused, true);
    // The list is still drawn beside it, with its selection.
    assert.deepEqual(listLines(after, sz), listLines(before, sz));
    assert.deepEqual(after.lines.slice(4, sz.rows - 1), before.lines.slice(4, sz.rows - 1), "and nothing else of the body changes");
    for (const key of ["tab", "escape"]) assert.deepEqual(draw(press(focused, [key], sz).state, sz).lines, before.lines, `${key} returns to the list`);
  }
});

test("at 79 columns tab replaces the list by the detail, a page of its own, and tab or Esc returns to the list", () => {
  const list = golden(), paged = press(list, ["tab"], S79).state, d = draw(paged, S79);
  assert.deepEqual(d.lines, [
    ` acme-platform       ${COUNTS}`,
    "  Instances   Souls   Capabilities                               read 10:00:00",
    "─".repeat(79),
    ` > ${KERNEL_DEV}`,
    "   soul     acme-ledger-developer",
    "   state    running",
    `   needs    ${NEEDS}`,
    "            the agent: \"Which base should it use?\"",
    "   harness  claude, claude-opus-5-5 (soul)",
    `   work     worktree, agents/${KERNEL_DEV}`,
    "   team     eng",
    `   parent   ${KERNEL_EXPERT}`,
    `   started  ${STARTED}`,
    "   home     …acme-ledger-developer/instances/acme-ledger-developer-note-target",
    "", "", "", "", "", "", "", "", "",
    `${LEAD}Enter open   Tab detail   Esc close   ? help   q quit`,
  ]);
  // Only the open view's name in the header is in reverse: no list row is drawn under the page.
  d.cells.forEach((line, r) => line.forEach((cell, x) => assert.equal(cell.style.reverse, r === 1 && x >= 1 && x < 12, `no list row is drawn under the page (${r}, ${x})`)));
  for (const key of ["tab", "escape"]) assert.deepEqual(draw(press(paged, [key], S79).state, S79).lines, draw(list, S79).lines, `${key} returns to the list`);
  // At 60x15 the body runs down to the footer: this page has as many rows as the body, and is whole.
  const whole = draw(paged, S60);
  assert.deepEqual([whole.extent, whole.room], [11, 11]);
  assert.equal(whole.lines[13].trim().startsWith("home "), true, "its last fact on the row above the footer");
  // A page taller than its room (a row whose kernel gave a long text) scrolls with the movement keys
  // and says what is cut off.
  const long = press(selecting(stateOf(observed(ROSTER().map((row) => (row.instance === EXPERT_TUI ? { ...row, runtimeError: `${UNREACHABLE}; ${TOLD}` } : row)), { withheld: WITHHELD })), EXPERT_TUI, S60), ["tab"], S60).state;
  const small = draw(long, S60);
  assert.equal(small.extent > small.room, true);
  assert.equal(small.lines[13].trim(), cutNote(0, small.extent - (small.room - 1)), "on the page's last row, the one above the footer");
  const scrolled = press(long, ["G"], S60).state, end = draw(scrolled, S60);
  assert.equal(end.lines[13].trim(), cutNote(end.extent - (end.room - 1), 0));
  assert.equal(end.lines.slice(3, 13).some((line) => line.trim().startsWith("home ")), true, "the last fact is on the screen");
  assert.equal(draw(press(scrolled, ["g"], S60).state, S60).lines[3], ` > ${EXPERT_TUI}`);
});

test("a resize from 100 to 79 columns with the detail focused shows the detail as the page, and back at 100 the two panes", () => {
  const focused = press(golden(), ["tab"], size(100, 24)).state;
  const wide = draw(focused, size(100, 24)), narrow = draw(focused, S79);
  assert.equal(wide.cells[3][48].text, "│");
  assert.equal(wide.lines.some((line) => line.includes("acme-maintainer-ops")), true, "at 100 columns the list is beside the detail");
  assert.equal(narrow.lines[3], ` > ${KERNEL_DEV}`);
  assert.equal(narrow.lines.some((line) => line.includes("acme-maintainer-ops")), false, "at 79 the detail is the page: no list row");
  assert.deepEqual(labels(factsOf(detailLines(narrow, S79))), ["soul", "state", "needs", "harness", "work", "team", "parent", "started", "home"]);
  assert.deepEqual(draw(focused, size(100, 24)).lines, wide.lines);
});

test("under 60x15 the screen is one line saying the terminal is too small, with the size found and the size needed, and back at 80x24 the same state is drawn as before", () => {
  assert.deepEqual({ ...MIN_SIZE }, { cols: 60, rows: 15 });
  for (const state of [golden(), press(golden(), ["tab"]).state, press(golden(), ["?"]).state, press(fresh(), ["/", "t", "u", "i"]).state, stateOf()]) {
    const before = draw(state, S80);
    for (const sz of [size(59, 15), size(60, 14), size(40, 10), size(79, 14), size(59, 40)]) {
      const d = draw(state, sz), said = d.lines.filter(Boolean);
      assert.equal(said.length, 1, `${sz.cols}x${sz.rows}: one line`);
      assert.equal(d.lines[0], said[0], "on the first row");
      assert.match(said[0], /too small/);
      assert.equal(said[0].includes(`${sz.cols}x${sz.rows}`) || sz.cols < 30, true, "it names the size found");
      assert.equal(said[0].includes("60x15") || sz.cols < 49, true, "and the size needed");
      d.cells.forEach((line) => line.forEach((cell) => assert.equal(cell.style.reverse, false)));
      // A key pressed on the small screen that changes nothing of the view leaves the state as it was.
      assert.deepEqual(draw(press(state, ["ctrl+l"], sz).state, S80).lines, before.lines);
    }
    assert.deepEqual(draw(state, S80).lines, before.lines, "back at 80x24 the state is drawn as before");
  }
});

// ── The footer ───────────────────────────────────────────────────────────────────────────────────

test("the footer shows the actions that apply in the current state, each with its first key, `help` and `quit` last", () => {
  assert.equal(draw(golden(), S80).lines[23], FOOTER, "the acts of the selected row after `open`, the first given up: `retire` went before `stop`");
  assert.equal(draw(golden(), S60).lines[14], FOOTER_60, "at 60 columns the acts, `workspaces`, `refresh` and `detail` are given up");
  assert.equal(draw(press(golden(), ["tab"]).state, S80).lines[23], `${LEAD}Enter open   Tab detail   Esc close   ? help   q quit`, "in the detail the acts are given up first, then `refresh`");
  assert.equal(draw(press(golden(), ["?"]).state, S80).lines[23], `${LEAD}Esc close   ? help   q quit`);
  for (const sz of SIZES) for (const state of [golden(), press(golden(), ["tab"]).state, press(golden(), ["?"]).state, press(golden(), ["/", "t", "u", "i", "enter"]).state, stateOf(), stateOf(observed([]))]) {
    assert.equal(cellText(draw(state, sz), sz.rows - 1).startsWith(LEAD), true, `${sz.cols}x${sz.rows}: the leader first, always`);
    assert.equal(cellText(draw(state, sz), sz.rows - 1).endsWith("? help   q quit"), true, `${sz.cols}x${sz.rows}: help and quit last, always`);
  }
});

test("the footer is read from the effective table: a key the user's tui.json gave is the one shown, and an action it unbound is gone", () => {
  const config = effectiveConfig({ keys: { quit: ["x"], filter: [] } });
  assert.equal(config.ok, true);
  for (const sz of SIZES) {
    const footer = draw(golden({ actions: config.actions }), sz).lines[sz.rows - 1];
    // With the room for it, `workspaces` stands after the list's own hints; no hint names the views.
    assert.equal(footer.endsWith(` Tab detail   r refresh${sz.cols >= 84 ? "   w workspaces" : ""}   ? help   x quit`) || sz.cols < 79, true, `${sz.cols}x${sz.rows}: ${footer}`);
    assert.equal(footer.includes("filter") || footer.includes("q quit") || footer.includes("/"), false);
  }
  const rebound = effectiveConfig({ keys: { help: ["f1"], detail: ["d", "tab"], refresh: ["f5", "r"], close: ["backspace"] } });
  assert.equal(draw(golden({ actions: rebound.actions }), S80).lines[23], `${LEAD}Enter open   / filter   d detail   F5 refresh   F1 help   q quit`);
  assert.equal(draw(press(golden({ actions: rebound.actions }), ["d"]).state, S80).lines[23], `${LEAD}Enter open   d detail   Backspace close   F1 help   q quit`);
});

test("when the footer has no room for every action it shows as many as fit, and `help` and `quit` are still the last two", () => {
  const kept = press(fresh(), ["/", "t", "u", "i", "enter"]).state;
  // With room (the leader takes its cells first: 140 columns), every action that applies.
  const at60 = draw(kept, S60).lines[14], at140 = draw(kept, size(140, 40)).lines[39];
  assert.equal(at140.endsWith("r refresh   w workspaces   ? help   q quit"), true, "with room, every action that applies");
  assert.equal(at60.endsWith("? help   q quit"), true);
  assert.equal(at60.includes("r refresh"), false, "at 60 columns one is given up");
  assert.equal(at60.includes("w workspaces"), false, "and so is the one after it");
  assert.equal(textWidth(at60) <= 59, true);
  const long = effectiveConfig({ keys: { help: ["ctrl+shift+f12"], quit: ["ctrl+shift+f11"] } });
  for (const sz of [S60, S80]) {
    const footer = draw(golden({ actions: long.actions }), sz).lines[sz.rows - 1];
    assert.equal(footer.endsWith("Ctrl+Shift+F12 help   Ctrl+Shift+F11 quit"), true, `${sz.cols}: ${footer}`);
  }
});

test("while the filter field is open the footer row holds `/`, the query, and how to keep and clear it", () => {
  for (const sz of SIZES) {
    const open = press(fresh(), ["/"], sz).state, typed = press(open, ["l", "e", "d", "g", "e", "r", "space", "d", "e", "v"], sz).state;
    const empty = cellText(draw(open, sz), sz.rows - 1), footer = cellText(draw(typed, sz), sz.rows - 1);
    assert.equal(empty.startsWith(`${LEAD}/`), true);
    assert.equal(footer.startsWith(`${LEAD}/ledger dev  `), true, `${sz.cols}: ${footer}`);
    for (const line of [empty, footer]) {
      assert.match(line, /Enter keep/);
      assert.match(line, /Esc clear/);
      assert.equal(line.includes("quit") || line.includes("help") || line.includes("refresh"), false, "the field takes the footer row");
    }
  }
  const rebound = effectiveConfig({ keys: { close: ["f2"] } });
  assert.match(draw(press(fresh({ actions: rebound.actions }), ["/"]).state, S80).lines[23], /F2 clear$/);
});

test("a kept filter is shown in the footer as `/query`, and the list holds the rows it matches", () => {
  const kept = press(fresh(), ["/", "m", "a", "i", "n", "t", "enter"]).state;
  for (const sz of [S80, S120, S79]) {
    const d = draw(kept, sz);
    assert.equal(cellText(d, sz.rows - 1).startsWith(`${LEAD}/maint  `), true);
    assert.equal(cellText(d, sz.rows - 1).endsWith("? help   q quit"), true);
    const drawn = listLines(d, sz).filter((line) => line.trim());
    assert.equal(drawn.length === 1 && drawn[0].includes(MAINTAINER), true, "the one instance that matches, and no other");
  }
  const cleared = press(kept, ["escape"]).state;
  assert.equal(draw(cleared, S80).lines[23], FOOTER, "Esc clears a kept filter");
});

test("a query of 200 characters is cut inside its cells, open and kept: the rest of the footer keeps its place", () => {
  const query = "abcdefghij".repeat(20), keys = ["/", ...query];
  const open = press(fresh(), keys).state, kept = press(open, ["enter"]).state;
  assert.equal(open.filter.query, query);
  for (const ascii of [false, true]) for (const sz of [...SIZES, size(300, 24)]) {
    const cut = glyphsOf(ascii).cut;
    const editing = cellText(draw({ ...open, ascii }, sz), sz.rows - 1), after = cellText(draw({ ...kept, ascii }, sz), sz.rows - 1);
    for (const line of [editing, after]) {
      assert.equal(line.startsWith(`${LEAD}/abcdefghij`), true);
      assert.equal(line.length <= sz.cols - 1, true, `${sz.cols}: the row ends inside the screen`);
    }
    assert.match(editing, /Enter keep {3}Esc clear$/, `${sz.cols}`);
    assert.equal(after.endsWith("? help   q quit"), true, `${sz.cols}`);
    const drawn = (line) => /^C-\\ commands {3}\/([a-j]*)(\S*)/.exec(line);
    if (sz.cols < 250) {
      for (const line of [editing, after]) { assert.equal(drawn(line)[2], cut, `${sz.cols}: the query ends in the cut mark`); assert.equal(query.startsWith(drawn(line)[1]), true); }
    } else assert.equal(drawn(editing)[1], query, "with the room, the query whole");
    assert.equal(drawn(after)[1].length < 40, true, "a kept filter takes a few cells of the footer");
  }
});

// ── The help, at the smallest width ──────────────────────────────────────────────────────────────

test("at 60 columns, the smallest width the frame is drawn at, the help still names every command whole: what this version does not do is said with the oats command that does it", () => {
  for (const ascii of [false, true]) {
    const lines = helpLines(golden({ ascii }), size(60, 160)), cut = glyphsOf(ascii).cut;
    for (const command of [...NOT_YET.map((entry_) => entry_.command), ...VIEWS.flatMap((view) => view.commands)]) {
      assert.equal(lines.some((line) => line.includes(command)), true, `${command} is whole at 60 columns${ascii ? ", in ASCII" : ""}`);
    }
    for (const line of lines) assert.equal(line.endsWith(cut), false, `no row of the help is cut at 60 columns: ${line.trim()}`);
  }
});

// ── The help ─────────────────────────────────────────────────────────────────────────────────────

const HELP_SIZE = size(140, 130);
function helpLines(state, sz = HELP_SIZE) {
  const d = draw(press(state, ["?"], sz).state, sz);
  assert.equal(d.extent <= d.room, true, "the whole help is on this screen");
  return d.lines.slice(3, sz.rows - 1);
}
/** A table row of the help: `left`, a gap, `right`. */
const pair = (lines, left, right) => lines.some((line) => { const text = line.trim(); return text.startsWith(`${left} `) && text.endsWith(` ${right}`) && text.slice(left.length, text.length - right.length).trim() === ""; });

test("the help lists every action of the table it is given with its keys, and an unbound action as `(no key)`", () => {
  const lines = helpLines(golden());
  // An action that does one thing in each view has a line per view, its keys on each.
  for (const action of ACTIONS) for (const said of action.views ? action.views.map(([, words]) => words) : [action.label]) assert.equal(pair(lines, keysLabel(action), said), true, `${action.id}: ${keysLabel(action)} ${said}`);
  for (const [keys, label] of [["Up, k", "up"], ["Down, j", "down"], ["g, Home", "first"], ["G, End", "last"], ["PageUp", "page up"], ["PageDown", "page down"], ["Tab", "detail"], ["/", "filter"], ["r", "refresh"], ["1", "instances"], ["2", "souls"], ["3", "capabilities"], ["w", "workspaces"], ["Enter", "open the selected agent's terminal beside the list, or go to it when it is the open one, in the list of instances"], ["z", "go to the open terminal with the whole screen; the leader twice brings the list back"], ["c", "close the open terminal; the agent keeps running"], ["Enter", "open the selected workspace, in the switcher"], ["?", "help"], ["Esc", "close"], ["q, Ctrl+C", "quit"], ["Ctrl+Z", "suspend"], ["Ctrl+L", "redraw"]]) {
    assert.equal(pair(lines, keys, label), true, `${keys} ${label}`);
  }
  const config = effectiveConfig({ keys: { quit: ["x"], filter: [], refresh: ["r", "f5"], suspend: [] } });
  // The keys of the action table, before the leader's section: that one is fixed, and has a `/` of its own.
  const all = helpLines(golden({ actions: config.actions })), changed = all.slice(0, all.findIndex((line) => line.trim() === "The leader"));
  assert.equal(changed.length > 0 && pair(all.slice(changed.length), "/", "filter"), true, "the leader's `/` is its own");
  assert.equal(pair(changed, "x", "quit"), true);
  assert.equal(pair(changed, "(no key)", "filter"), true);
  assert.equal(pair(changed, "(no key)", "suspend"), true);
  assert.equal(pair(changed, "r, F5", "refresh"), true);
  assert.equal(pair(changed, "q, Ctrl+C", "quit") || pair(changed, "/", "filter"), false);
});

test("the help is generated from the table: another key and another action appear as given", () => {
  const table = Object.freeze([...ACTIONS.filter((action) => action.id !== "redraw"), Object.freeze({ id: "zap", keys: Object.freeze(["f9", "ctrl+x"]), label: "zap the thing" })]);
  const lines = helpLines(golden({ actions: table }));
  assert.equal(pair(lines, "F9, Ctrl+X", "zap the thing"), true);
  assert.equal(lines.some((line) => line.includes("redraw") || line.includes("Ctrl+L")), false, "an action that is not in the table is not in the help");
  const keys = lines.slice(lines.findIndex((line) => line.trim() === "Keys") + 1, lines.findIndex((line) => line.trim() === "The leader")).filter((line) => line.trim());
  // One row per action and view; under the line of opening an agent, four rows of its own (the leader twice, what the terminal takes, its
  // limits, the pointer); under the line of the last act, the rows of ACT_RULES. Then the leader's section: the leader, and a row per
  // key of its table, whatever the action table.
  const leader = lines.slice(lines.findIndex((line) => line.trim() === "The leader") + 1, lines.findIndex((line) => line.trim() === "Marks")).filter((line) => line.trim());
  assert.equal(leader.length, 1 + LEADER.length, "the leader, and one row per key of its table");
  const rules = keys.filter((line) => ACT_RULES.some((sentence) => sentence.includes(line.trim())));
  assert.equal(rules.length >= ACT_RULES.length, true, "the rules of the acts stand under them");
  assert.equal(keys.length, table.reduce((n, action) => n + (action.views?.length ?? 1), 0) + 4 + rules.length, "one row per action, and one more per view of an action that has two");
});

test("the help lists the marks with their words, in UTF-8 and in ASCII: each mark the list draws is there", () => {
  for (const ascii of [false, true]) {
    const lines = helpLines(golden({ ascii })), marks = marksOf(ascii);
    const from = lines.findIndex((line) => line.trim() === "Marks"), to = lines.findIndex((line) => line.trim() === "Views");
    assert.equal(from > 0 && to > from, true);
    const section = lines.slice(from + 1, to).map((line) => line.trim()).filter(Boolean);
    const said = (mark, word) => section.some((line) => line.split(" ")[0] === mark && line.slice(mark.length).includes(word));
    assert.equal(said(marks.running, "running"), true);
    assert.equal(said(marks.stopped, "stopped"), true);
    assert.equal(said(marks.shell, "shell"), true);
    assert.equal(said(marks.unknown, "state unknown"), true);
    assert.equal(said(marks.held, "held"), true);
    assert.equal(said(marks.waiting, "needs input"), true);
    assert.equal(said(marks.selected, "selected"), true);
    assert.equal(section.some((line) => line.startsWith(`${marks.waiting}N`)), true, "and the roll-up of a collapsed row");
    assert.equal(said("+N", "folded away"), true, "a folded row's count: no fold mark");
    for (const [name, mark] of Object.entries(marks)) assert.equal(section.some((line) => line.split("  ")[0].split(" ").includes(mark) || line.startsWith(mark)), true, `${name}: ${mark}`);
  }
});

test("the help says what each view holds, and what to run for what it does not do yet: spawning from Souls, and the Capabilities view", () => {
  const lines = helpLines(golden());
  const line = (name) => lines.find((text) => text.trim().startsWith(name));
  assert.equal(line("2 Souls").includes("the souls of the open workspace") && line("2 Souls").includes("oats spawn <soul>"), true);
  assert.equal(line("3 Capabilities").includes("oats capabilities"), true);
  assert.equal(typeof line("1 Instances"), "string");
  for (const view of VIEWS) for (const command of view.commands) assert.equal(line(view.name).includes(command), true, `${view.name}: ${command}`);
  assert.deepEqual(VIEWS.map((view) => view.name), ["1 Instances", "2 Souls", "3 Capabilities"], "the views the frame names");
});

test("the help's last section, `Not in this version`, names every act this version does not have with the oats command that does it", () => {
  for (const ascii of [false, true]) for (const sz of [HELP_SIZE, size(60, 160), size(79, 150), size(200, 130)]) {
    const lines = helpLines(golden({ ascii }), sz), text = lines.map((line) => line.trim());
    const at = text.indexOf("Not in this version");
    assert.equal(at > 0, true);
    for (const heading of ["Keys", "Marks", "Views"]) assert.equal(text.indexOf(heading) >= 0 && text.indexOf(heading) < at, true, `${heading} comes before it`);
    const section = text.slice(at + 1);
    // Each act with its command: beside it, or on the row under it where the width has no room for both.
    for (const { what, command } of NOT_YET) {
      const row = section.findIndex((line) => line === what || line.startsWith(`${what} `));
      assert.equal(row >= 0, true, what);
      assert.equal(pair([section[row]], what, command) || section[row + 1] === command, true, `${what}: ${command}`);
    }
    // Stop, start, restart and retire are acts of this version: only another launch is left to the kernel's command.
    for (const command of ["oats session attach --home <home>", "oats session start --home <home>", "oats server connect", "oats server check", "oats server remove", "oats tui --dir <path>"]) {
      assert.equal(section.some((line) => line.includes(command)), true, `the spec's ${command}`);
    }
    for (const command of ["oats instance stop", "oats retire"]) {
      assert.equal(section.some((line) => line.includes(command)), false, `${command}: an act of this version, not named as missing`);
    }
  }
});

test("the help scrolls: at 60x15 it does not fit, its last row says what is cut off, and the movement keys move it to its end and back", () => {
  const sz = S60, open = press(golden(), ["?"], sz).state, d = draw(open, sz);
  assert.equal(d.extent > d.room, true);
  const visible = d.room - 1;
  assert.equal(d.lines[3].trim(), "Keys");
  assert.equal(d.lines[sz.rows - 2].trim(), cutNote(0, d.extent - visible));
  const down = draw(press(open, ["j"], sz).state, sz);
  assert.equal(down.lines[sz.rows - 2].trim(), cutNote(1, d.extent - visible - 1));
  assert.equal(down.lines[3], d.lines[4], "one row down");
  const paged = draw(press(open, ["pagedown"], sz).state, sz);
  assert.notEqual(paged.lines[3], d.lines[3]);
  const ended = press(open, ["j", "G"], sz).state, end = draw(ended, sz);
  assert.equal(end.lines[sz.rows - 2].trim(), cutNote(d.extent - visible, 0));
  assert.equal(end.lines.slice(3, sz.rows - 2).some((line) => line.includes(NOT_YET.at(-1).command)), true, "the last section is on the screen");
  assert.deepEqual(draw(press(ended, ["G", "j", "pagedown"], sz).state, sz).lines, end.lines, "it stops at its end");
  assert.deepEqual(draw(press(ended, ["g"], sz).state, sz).lines, d.lines, "and goes back to its start");
  assert.deepEqual(draw(press(ended, ["k"], sz).state, sz).lines[sz.rows - 2].trim(), cutNote(d.extent - visible - 1, 1));
  // Every row of the help is reached by scrolling: nothing is lost behind the note.
  const whole = helpLines(golden(), size(60, 160)).map((line) => line.trim()).filter(Boolean), seen = new Set();
  let state = open;
  for (let i = 0; i < d.extent; i++) { for (const line of draw(state, sz).lines.slice(3, sz.rows - 2)) seen.add(line.trim()); state = press(state, ["j"], sz).state; }
  for (const line of whole) assert.equal(seen.has(line), true, line);
  assert.deepEqual(draw(press(ended, ["escape"], sz).state, sz).lines, draw(golden(), sz).lines, "Esc closes it");
});

// ── Keys from tui.json on the screen ─────────────────────────────────────────────────────────────

test("every key a tui.json may give an action is drawn: the footer and the help name it through shown(), placed by cells, at every size, and nothing throws", () => {
  const keys = { help: ["日"], quit: ["é", "alt+é"], close: ["\u{1f44d}\u{1f3fd}"], filter: ["ctrl+alt+shift+f12"], detail: ["shift+tab", "+"], refresh: ["alt++", "f5"], up: ["名", "k"] };
  const made = effectiveConfig({ keys });
  assert.equal(made.ok, true);
  const labelOf = (id) => keysLabel(made.actions.find((action) => action.id === id));
  for (const sz of SIZES) for (const ascii of [false, true]) {
    const state = golden({ actions: made.actions, ascii });
    for (const [what, s] of [["the list", state], ["the detail's focus", press(state, ["shift+tab"], sz).state], ["the open filter field", press(state, ["ctrl+alt+shift+f12", "x"], sz).state], ["a kept filter", press(state, ["ctrl+alt+shift+f12", "o", "enter"], sz).state], ["the help", press(state, ["日"], sz).state]]) {
      const d = draw(s, sz);
      for (const line of d.cells) assert.equal(line.length, sz.cols, `${what} at ${sz.cols}x${sz.rows}: a row of the screen's width`);
      const footer = cellText(d, sz.rows - 1);
      // The open field takes the footer row; everywhere else help and quit are last, by their keys.
      const end = what === "the open filter field" ? `Enter keep   ${labelOf("close")} clear` : "日 help   é quit";
      assert.ok(footer.endsWith(end), `${what} at ${sz.cols}x${sz.rows}${ascii ? ", ASCII marks" : ""}: the footer ends in ${end}: ${footer}`);
    }
    // The wide key takes two cells: the word after it stands one cell past them.
    const d = draw(state, sz), last = d.cells[sz.rows - 1], at = last.findIndex((cell) => cell.text === "日");
    assert.equal(last.slice(at + 2, at + 7).map((cell) => cell.text).join(""), " help");
    const big = size(100, 115), lines = draw(press(state, ["日"], big).state, big).lines.slice(3, big.rows - 1);
    for (const id of Object.keys(keys)) assert.ok(lines.some((line) => line.trim().startsWith(`${labelOf(id)}  `)), `the help lists ${id} under ${labelOf(id)}`);
    assert.ok(lines.some((line) => line.trim() === `${labelOf("close").split(", ")[0]} or 日 closes this help`), "the closing line names the two keys");
    // The meanings stand in one column, whatever cells the keys take.
    const d2 = draw(press(state, ["日"], big).state, big);
    const columns = new Set(["up", "help", "quit", "close"].map((id) => { const word = made.actions.find((action) => action.id === id).label.split(" ")[0]; const r = d2.cells.findIndex((line) => line.map((cell) => cell.text).join("").trim().startsWith(`${labelOf(id)}  `)); return cellIndexOf(d2.cells[r], word); }));
    assert.equal(columns.size, 1, `one column for the meanings: ${[...columns]}`);
  }
});

test("help and quit are last and always: a kept filter gives way to them, down to nothing; keys so long that the two do not fit whole after the leader give up help, then quit, and no hint is ever cut", () => {
  const long = effectiveConfig({ keys: { help: ["ctrl+alt+shift+f11"], quit: ["ctrl+alt+shift+f12"] } });
  assert.equal(long.ok, true);
  const kept = (query, actions, sz) => cellText(draw(press(golden({ actions }), ["/", ...query, "enter"], sz).state, sz), sz.rows - 1);
  // At 60 columns the leader and the two long hints do not fit whole (12 + 3 + 23 + 3 + 23 cells
  // in 59): help is given up, quit stands last and whole, and nothing passes the edge.
  for (const query of ["a", "acme-ledger"]) {
    const row = kept(query, long.actions, S60);
    assert.equal(row.startsWith(LEAD) && row.endsWith("   Ctrl+Alt+Shift+F12 quit") && !row.includes("help") && textWidth(row) <= 60 - 1, true, `quit whole and last, help given up: ${row}`);
  }
  // The hint that stands first (Enter would open the selected agent) comes before the filter's
  // place, when it fits beside help and quit: at 80 columns it does, and the filter gives way to
  // nothing beside them.
  assert.equal(kept("a", long.actions, S80), `${LEAD}Enter open   Ctrl+Alt+Shift+F11 help   Ctrl+Alt+Shift+F12 quit`);
  // With room, the kept filter has its whole place and the other hints follow it; at 60 columns its
  // place is what the leader, the first hint, help and quit leave it.
  assert.equal(kept("a", ACTIONS, S60), `${LEAD}/a              Enter open   ? help   q quit`, "of the other hints, as many as fit");
  assert.equal(kept("a", ACTIONS, S80), `${LEAD}/a                      Enter open   / filter   ? help   q quit`);
  // Longer keys still: help is given up, and quit stands whole and last.
  const longest = effectiveConfig({ keys: { help: ["ctrl+alt+shift+pagedown"], quit: ["ctrl+alt+shift+pageup"] } });
  const row = kept("a", longest.actions, S60);
  assert.equal(row.startsWith(LEAD) && row.endsWith("   Ctrl+Alt+Shift+PageUp quit") && !row.includes("help") && textWidth(row) <= 60 - 1, true, `help given up, quit whole: ${row}`);
  // Help is the leader's too: given up from the footer, it is still a key away (the leader, then ?).
  assert.equal(LEADER.some((entry) => entry.does === "help"), true);
});

test("a key label is text from outside for the views too: a table that reached them with a key the config refuses is still drawn, through shown(), and puts no control or bidi character on the screen", () => {
  // effectiveConfig refuses these (config.test.mjs); the views do not rest on that.
  const hostile = ["\u202E", " \u0301", "\u200B"];
  const actions = ACTIONS.map((action) => (action.id === "quit" ? { ...action, keys: [hostile[0], "q"] } : action.id === "help" ? { ...action, keys: [hostile[1]] } : action.id === "close" ? { ...action, keys: [hostile[2]] } : action));
  for (const sz of SIZES) {
    const state = golden({ actions });
    for (const s of [state, { ...state, view: "help" }, press(state, ["/", "x"], sz).state, press(state, ["/", "x", "enter"], sz).state]) {
      const d = draw(s, sz);
      for (const line of d.lines) assert.equal(CONTROL.test(line), false, `no control or bidi character at ${sz.cols}x${sz.rows}: ${JSON.stringify(line)}`);
      assert.equal(d.cells.every((line) => line.length === sz.cols), true);
    }
  }
});

// ── Other machines ───────────────────────────────────────────────────────────────────────────────
// A view of more than one deployment: this machine's, whose roster reports a workspace identity, and
// the machines a roster read answered for. Every outcome of that read reaches the store as the loop
// hands it on (lib/read.mjs): through the shared remoteRosterState and observeIdentities, never as a
// state made here. A group has the kernel's form: its id is `<server>:<targetKey>`, the server name
// in lower case, and each of its rows says whether it can be addressed.
const IDENTITY = Object.freeze({ key: "github.com/acme/platform", ref: "main", keyFrom: "workspace", standalone: false, defaultTeam: Object.freeze({ label: "eng", team: "team-1" }), teams: Object.freeze({ eng: "team-1" }), teamsFrom: "observed" });
/** Another workspace, for a machine that moves to it. */
const ELSEWHERE = Object.freeze({ ...IDENTITY, key: "github.com/acme/billing" });
/** A deployment whose teams are its own: the shared home leaves a note for it. */
const STANDALONE = Object.freeze({ ...IDENTITY, standalone: true, defaultTeam: null, teams: Object.freeze({}), teamsFrom: "local" });
/** A kernel that reads other machines: without `roster` the shared home makes no roster read. */
const REMOTE_CLI = Object.freeze({ ...CLI, remote: Object.freeze(["roster"]) });
/** An observed entry of this machine's deployment whose roster reports `identity`, through the same
 *  shared calls helpers.mjs `observed` makes (its roster reports none). */
function reporting(rows, { identity = IDENTITY, workspace = "acme-platform" } = {}) {
  const document = { ...rosterOf(rows), workspace: { reachable: true, ...identity } }, listed = rosterRows(document, REMOTE_CLI);
  const answers = listed.map((row) => ({ running: row.running, runtimeState: row.runtimeState, ...(row.runtimeError ? { runtimeError: row.runtimeError } : {}), tmux: row.tmux }));
  return observedEntry({ roster: document, workspaceStatus: { workspace: { name: workspace } }, observedAt: "2026-10-11T09:59:00.000Z" }, panelInstances(listed, answers), "2026-10-11T10:00:00.000Z");
}
/** This machine's rows: a cluster of two and a stopped single instance. */
const NEAR = () => [
  instanceRow("acme-ledger-expert", KERNEL_EXPERT),
  instanceRow("acme-ledger-developer", KERNEL_DEV, { parentInstance: KERNEL_EXPERT }),
  instanceRow("acme-maintainer", MAINTAINER, { running: false, runtimeState: "stopped" }),
];
const FAR = "/home/dev/Agents/acme", FAR_A = "acme-ledger-far-a", FAR_B = "acme-ledger-far-b", FAR_Q = "acme-ledger-far-q";
/** One row of a machine's roster, as its kernel reports it. */
const farRow = (name, extra = {}, root = FAR) => ({
  instance: name, agent: "acme-ledger-developer", home: `${root}/agents/acme-ledger-developer/instances/${name}`, agentsRoot: `${root}/agents`,
  work: "worktree", harness: "claude", running: true, runtimeState: "running", addressable: true, ...extra,
});
/** The machine `garnet`: reached, reporting this workspace, with a running row and a stopped one its
 *  kernel does not report addressable. */
const group = (extra = {}) => ({
  id: "garnet:acme-1", server: "garnet", label: "garnet", registrationPresent: true, target: { workspace: FAR, sshHost: "garnet.example" }, probe: { ok: true },
  workspace: IDENTITY, agentsRoot: `${FAR}/agents`, souls: [], instances: [farRow(FAR_A), farRow(FAR_B, { addressable: false, running: false, runtimeState: "stopped" })], ...extra,
});
/** A second machine, `quartz`, with one row. */
const quartz = (extra = {}) => group({ id: "quartz:acme-7", server: "quartz", label: "quartz", target: { workspace: "/srv/acme", sshHost: "quartz.example" }, agentsRoot: "/srv/acme/agents", instances: [farRow(FAR_Q, {}, "/srv/acme")], ...extra });
const GARNET = "remote:garnet:acme-1";
/** The times of three roster reads, fifteen seconds apart, after this machine's own read at 10:00:00. */
const T1 = "2026-10-11T10:00:10.000Z", T2 = "2026-10-11T10:00:25.000Z", T3 = "2026-10-11T10:00:40.000Z";
/** The store after one outcome of the roster read, made as the loop makes it. */
function heard(state, outcome, at) {
  const next = remoteRosterState(state.remote, outcome, at);
  const kept = next.reported === null ? { memory: state.memory, notes: state.notes } : observeIdentities({ memory: state.memory, notes: state.notes }, next.reported, at);
  return reduce(state, { roster: { remote: { remoteGroups: next.remoteGroups, rosterAnswered: next.rosterAnswered, rosterFailure: next.rosterFailure }, memory: kept.memory, notes: kept.notes, at } }).state;
}
const answered = (...groups) => ({ envelope: { ok: true, result: { groups } } });
/** A read that came back as an error, and a probe of one machine that ssh could not make. */
const TIMEOUT = Object.freeze({ envelope: { ok: false, error: { code: "E_CLI_TIMEOUT", message: "garnet did not answer" } } });
const UNPROMPTED = Object.freeze({ ok: false, error: { code: "E_SSH", message: "Permission denied (publickey)." } });
/** This machine alone; with garnet reached; with garnet reached and then not; with garnet, which has
 *  no row, reached and then not. */
const local = (options) => stateOf(reporting(NEAR()), { cli: REMOTE_CLI, ...options });
const reached = (options) => heard(local(options), answered(group()), T1);
const lost = (options) => heard(reached(options), TIMEOUT, T2);
const rowless = (options, label = "garnet") => heard(heard(local(options), answered(group({ label, instances: [] })), T1), TIMEOUT, T2);
/** The deployments `~/Agents` holds that the run does not serve, as lib/read.mjs lists them. */
const folder = (name) => ({ path: `/home/u/Agents/${name}`, name });
const OFFERED = Object.freeze({ offered: Object.freeze([folder("acme-billing"), folder("acme-docs")]), limited: false });
/** The switcher over a workspace on two machines, one of them not reached now, beside a machine that
 *  was never reached in this run and two folders that are not opened. */
function choosing(options) {
  const never = quartz({ probe: UNPROMPTED, workspace: null, instances: [] });
  const state = heard(heard(local(options), answered(group(), never), T1), answered(group({ probe: UNPROMPTED }), never), T2);
  return reduce(press(state, ["w"]).state, { offered: OFFERED }).state;
}
/** A deployment of the open view, as the shared home lists it, and the shared words for it. */
const deploymentOf = (state, id = GARNET) => panelOf(state, AT).deployments.find((d) => d.id === id);
const UNKNOWN = runtimeState({ running: null });
/** The shared label of the reached machine's row that can't be addressed, and of a row of a
 *  machine that was not reached: the word each of those rows has in the list. */
const AWAY = () => rowReason(panelRow(reached(), FAR_B)).label;
const NOT_REACHED = () => rowReason(panelRow(lost(), FAR_A)).label;
/** `text` cut to `cells` with the cut mark, as the screen cuts a span. */
const cutTo = (text, cells, ascii = false) => (text.length <= cells ? text : `${text.slice(0, cells - glyphsOf(ascii).cut.length)}${glyphsOf(ascii).cut}`);
/** The switcher's rows as the shared home words them. */
const choicesOf = (state) => workspaceChoiceRows(workspaceChoices(heldOf(state, AT), TERMS));
/** A row of the screen with each text at its column: a frame pins the columns, and takes a word of
 *  the shared home from the shared home. */
function placed(...parts) {
  const line = [];
  for (const [col, text] of parts) [...text].forEach((ch, i) => { line[col + i] = ch; });
  return Array.from(line, (ch) => ch ?? " ").join("").trimEnd();
}
/** A sentence on rows of at most `width` cells, broken at its spaces: what its wrapped rows are to
 *  hold. Every word of the sentences wrapped here is shorter than a row. */
function wrap(sentence, width) {
  return sentence.split(" ").reduce((rows, word) => {
    if (rows.length && rows.at(-1).length + 1 + word.length <= width) rows[rows.length - 1] = `${rows.at(-1)} ${word}`;
    else rows.push(word);
    return rows;
  }, []);
}
/** The body of a frame at 80x24, down to the footer: the list's rows beside the detail's, the panes' rule between. */
const beside = (list, detail, bar = "│") => Array.from({ length: 20 }, (_, i) => `${(list[i] ?? "").padEnd(38)}${bar}${detail[i] ?? ""}`);
/** Every row of a frame takes exactly the terminal's columns, and no wide grapheme is split. */
function fits(d, sz, at) {
  assert.equal(d.cells.length, sz.rows, at);
  d.cells.forEach((line, r) => {
    assert.equal(line.length, sz.cols, `${at}: row ${r} has the terminal's cells`);
    assert.equal(line.reduce((sum, cell) => sum + cell.width, 0), sz.cols, `${at}: row ${r}: its graphemes take exactly the terminal's columns`);
    assert.equal(textWidth(d.lines[r]) <= sz.cols, true, `${at}: row ${r} is no wider than the terminal`);
  });
}
const paneOf = (sz) => (sz.cols >= WIDE ? listWidth(sz.cols) : sz.cols);

test("this machine and a reached machine in one view at 80x24 in UTF-8, cell for cell: `+1 machine` in the header, a heading per deployment, the machine's with the time of the roster read, and a `machine` line in the detail", () => {
  const d = draw(reached(), S80);
  assert.deepEqual(d.lines, [
    " acme-platform  +1 machine                                 3 running  2 stopped",
    "  Instances   Souls   Capabilities                                read 10:00:00",
    `${"─".repeat(38)}┬${"─".repeat(41)}`,
    ...beside([
      " This machine",
      "> ● acme-ledger-expert-retire",
      "    ● acme-ledger-developer-note…",
      "",
      "  ○ acme-maintainer-ops",
      " garnet                 read 10:00:10",
      "  ● acme-ledger-far-a",
      `  ○ acme-l…  ${cutTo(AWAY(), 20)}`,
    ], [
      "   acme-ledger-expert-retire",
      "   soul     acme-ledger-expert",
      "   machine  This machine",
      "   state    running",
      "   harness  claude, claude-opus-5-5 (so…",
      "   work     worktree, agents/acme-ledge…",
      "   team     eng",
      `   started  ${STARTED}`,
      "   home     …s/acme-ledger-expert-retire",
    ]),
    FOOTER,
  ]);
  // What the cells say beyond their text: a heading's label is bold and is no row of the selection,
  // the two times and the count of machines are dim.
  for (const [r, label] of [[3, "This machine"], [8, "garnet"]]) {
    for (const cell of d.cells[r].slice(1, 1 + label.length)) assert.equal(cell.style.bold && !cell.style.reverse, true, `${label} is bold`);
    assert.equal(d.cells[r][0].text, " ", "a heading carries no selection mark");
  }
  for (const cell of d.cells[8].slice(24, 37)) assert.equal(cell.style, DIM, "the time of the roster read is dim");
  for (const cell of d.cells[0].slice(16, 26)) assert.equal(cell.style, DIM, "the count of machines is dim");
  assert.equal(cellText(d, 0, 16, 26), "+1 machine");
});

test("this machine and a reached machine at 80x24 in ASCII, cell for cell: the same screen with the rule, the marks and the cut mark in ASCII", () => {
  assert.deepEqual(draw(reached({ ascii: true }), S80).lines, [
    " acme-platform  +1 machine                                 3 running  2 stopped",
    "  Instances   Souls   Capabilities                                read 10:00:00",
    `${"-".repeat(38)}+${"-".repeat(41)}`,
    ...beside([
      " This machine",
      "> * acme-ledger-expert-retire",
      "    * acme-ledger-developer-no...",
      "",
      "  - acme-maintainer-ops",
      " garnet                 read 10:00:10",
      "  * acme-ledger-far-a",
      `  - acme...  ${cutTo(AWAY(), 20, true)}`,
    ], [
      "   acme-ledger-expert-retire",
      "   soul     acme-ledger-expert",
      "   machine  This machine",
      "   state    running",
      "   harness  claude, claude-opus-5-5 (...",
      "   work     worktree, agents/acme-led...",
      "   team     eng",
      `   started  ${STARTED}`,
      "   home     ...acme-ledger-expert-retire",
    ], "|"),
    FOOTER,
  ]);
});

test("the same view with the machine not reached, at 80x24 in UTF-8 and in ASCII, cell for cell: its heading holds the shared state and short reason and no time, its rows carry the unknown mark and the shared label `<machine> not reached`, and the detail of one says why under `machine`", () => {
  for (const ascii of [false, true]) {
    const state = press(lost({ ascii }), ["G"]).state, garnet = deploymentOf(state), said = deploymentState(garnet), g = glyphsOf(ascii), marks = marksOf(ascii);
    assert.equal(said.key, "remembered", "the machine answered earlier in the run, and is kept in its workspace");
    const cut = (text, cells) => `${text.slice(0, cells - g.cut.length)}${g.cut}`;
    assert.deepEqual(draw(state, S80).lines, [
      " acme-platform  +1 machine                      2 running  1 stopped  2 unknown",
      "  Instances   Souls   Capabilities                                read 10:00:00",
      `${g.rule.repeat(38)}${g.down}${g.rule.repeat(41)}`,
      ...beside([
        " This machine",
        `  ${marks.running} ${KERNEL_EXPERT}`,
        `    ${marks.running} ${cut(KERNEL_DEV, 27)}`,
        "",
        `  ${marks.stopped} acme-maintainer-ops`,
        ` garnet  ${said.text}  ${garnet.short}`,
        `  ${marks.unknown} ${cut(FAR_A, 9)}  ${NOT_REACHED()}`,
        `> ${marks.unknown} ${cut(FAR_B, 9)}  ${NOT_REACHED()}`,
      ], [
        "   acme-ledger-far-b",
        "   soul     acme-ledger-developer",
        "   machine  garnet",
        ...wrap(textOf(shown(said.detail)), 28).map((row) => `            ${row}`),
        `   state    ${NOT_REACHED()}`,
        "            oats tui's read of other",
        "            machines says: garnet did",
        "            not answer",
        "   harness  claude",
        "   work     worktree",
        `   home     ${g.cut}${`instances/${FAR_B}`.slice(g.cut.length - 1)}`,
      ], g.bar),
      // The selected row's machine was not reached and the kernel does not report it addressable: no
      // act, and no Enter; at 80 columns `workspaces` is given up.
      `${LEAD}/ filter   Tab detail   r refresh   ? help   q quit`,
    ]);
  }
  // Nothing of the machine reads as stopped, or as running, that is only not reached.
  const d = draw(lost(), S120);
  assert.equal(NOT_REACHED().includes("garnet"), true, "the label names the machine");
  for (const name of [FAR_A, FAR_B]) {
    const line = cellText(d, rowOf(d, S120, name), 0, 57);
    assert.equal(line.endsWith(NOT_REACHED()) && line.trim().startsWith(MARKS.utf8.unknown), true, `${name}: ${line}`);
  }
  assert.equal(listLines(d, S120).some((line) => line.includes("read 10:00")), false, "a heading that is not live carries no time");
  // The state is plain and the short reason dim: neither is told by the attribute alone.
  const heading = d.cells[8], said = deploymentState(deploymentOf(lost())), at = 1 + "garnet".length + 2;
  assert.equal(cellText(d, 8, at, at + said.text.length), said.text);
  for (const cell of heading.slice(at, at + said.text.length)) assert.equal(cell.style.dim || cell.style.bold, false, "the state is plain");
  for (const cell of heading.slice(at + said.text.length + 2, at + said.text.length + 2 + deploymentOf(lost()).short.length)) assert.equal(cell.style, DIM, "the short reason is dim");
});

test("the view of two deployments at 120x40, 79x24 and 60x15: the same headings and rows, no row wider than the terminal, each time at the right edge of its pane and nothing of the list past its pane", () => {
  for (const ascii of [false, true]) for (const sz of [S120, S79, S60]) {
    const d = draw(reached({ ascii }), sz), pane = paneOf(sz), marks = marksOf(ascii), g = glyphsOf(ascii), at = `${sz.cols}x${sz.rows}${ascii ? " ascii" : ""}`;
    fits(d, sz, at);
    // The word column ends five cells before the pane's edge (four for a waiting mark, one gap) and
    // is as wide as the widest word, the one row's that can't be addressed, cut to 20 cells; a time
    // ends one cell before the edge. The rows the marks say all of have no word.
    const word = pane - 5 - Math.min(20, AWAY().length), time = pane - 1 - "read 10:00:10".length;
    assert.deepEqual(listLines(d, sz).slice(0, 9), [
      " This machine",
      placed([0, `> ${marks.running} ${KERNEL_EXPERT}`]),
      placed([4, `${marks.running} ${KERNEL_DEV}`]),
      "",
      placed([2, `${marks.stopped} ${MAINTAINER}`]),
      placed([1, "garnet"], [time, "read 10:00:10"]),
      placed([2, `${marks.running} ${FAR_A}`]),
      placed([2, `${marks.stopped} ${FAR_B}`], [word, cutTo(AWAY(), 20, ascii)]),
      "",
    ], at);
    assert.equal(cellText(d, 0).startsWith(" acme-platform  +1 machine  "), true, `${at}: ${cellText(d, 0)}`);
    assert.equal(cellText(d, 0).endsWith("  3 running  2 stopped"), true, at);
    assert.equal(cellText(d, 1).endsWith(" read 10:00:00"), true, `${at}: the header's time is this machine's own read`);
    assert.deepEqual([d.cells[8][pane - 2].text, d.cells[8][pane - 1].text], ["0", " "], `${at}: the heading's time ends one cell before the pane's edge`);
    if (sz.cols >= WIDE) {
      for (const r of bodyRows(sz)) assert.equal(d.cells[r][pane].text, g.bar, `${at}: row ${r} has the panes' rule at column ${pane}`);
      assert.equal(cellText(d, 5, pane + 1).trim(), "machine  This machine", `${at}: the detail's machine line`);
    } else assert.equal(d.lines.some((line) => line.includes("soul ")), false, `${at}: no detail beside the list`);
    assert.deepEqual(d.cells[4].map((cell) => cell.style.reverse), Array.from({ length: sz.cols }, (_, x) => x < pane), `${at}: the selected row's bar is the pane`);
    assert.equal(cellText(d, sz.rows - 1), sz.cols >= 110 ? FOOTER_120 : sz.cols >= 80 ? FOOTER : sz.cols >= 79 ? FOOTER_79 : FOOTER_60, at);
  }
});

test("at 60 columns, with no title before it, the workspace's name and `+1 machine` stand whole beside wider counts; two machines are counted once each, and a view of this machine alone says nothing of machines", () => {
  // The cells the title took are the name's: at 60 columns the name, `+1 machine` and the wider counts
  // all fit (when they do not, what follows the name gives way first: see the 60-column test below).
  const d = draw(lost(), S60);
  assert.equal(d.lines[0], " acme-platform  +1 machine  2 running  1 stopped  2 unknown");
  assert.equal(draw(lost(), S80).lines[0].includes("  +1 machine  "), true, "with the room it is there");
  // Two machines are counted once each, whatever number of deployments each holds.
  const two = heard(local(), answered(group(), quartz(), quartz({ id: "quartz:acme-8", target: { workspace: "/srv/acme-two", sshHost: "quartz.example" }, instances: [] })), T1);
  assert.equal(draw(two, S120).lines[0].startsWith(" acme-platform  +2 machines  "), true, draw(two, S120).lines[0]);
  assert.equal(draw(local(), S80).lines[0].includes("machine"), false, "this machine alone: nothing about machines");
  assert.equal(draw(heard(local(), answered(), T1), S80).lines[0].includes("machine"), false, "no registered machine: nothing about machines");
});

test("a heading too narrow for all it holds gives up its path first, then its short reason, then cuts its label, and always keeps its state; a live machine's heading cuts its label and keeps its time", () => {
  const NAME = "garnet-machine-of-the-ledger-team-in-the-far-rack-number-0007";
  const live = (label, options) => heard(local(options), answered(group({ label })), T1);
  /** The one row of the list pane that starts with the machine's label at the margin. */
  const headingOf = (state, sz) => {
    const found = listLines(draw(state, sz), sz).filter((line) => line.startsWith(" garnet"));
    assert.equal(found.length, 1, "one heading names the machine");
    return found[0];
  };
  const garnet = deploymentOf(rowless()), said = deploymentState(garnet), path = garnet.label;
  assert.deepEqual([said.text.length, garnet.short.length, path.length], [10, 9, 13], "the widths the rows below were worked out for");
  // A machine with no row that is not reached: its label, its path, its state, its short reason.
  assert.equal(headingOf(rowless(), S60), ` garnet  ${path}  ${said.text}  ${garnet.short}`, "60 cells hold all four");
  assert.equal(headingOf(rowless(), S80), ` garnet  ${said.text}  ${garnet.short}`, "38 cells: the path is given up");
  assert.equal(headingOf(rowless({}, NAME.slice(0, 20)), S120), ` ${NAME.slice(0, 20)}  …${path.slice(-9)}  ${said.text}  ${garnet.short}`, "57 cells and a longer label: the path is cut first, and keeps its end");
  assert.equal(headingOf(rowless({}, NAME.slice(0, 20)), S80), ` ${NAME.slice(0, 20)}  ${said.text}`, "38 cells and a longer label: the short reason is given up too");
  assert.equal(headingOf(rowless({}, NAME.slice(0, 30)), S80), ` ${NAME.slice(0, 23)}…  ${said.text}`, "a label longer than the row is cut, and the state stands whole");
  assert.equal(headingOf(rowless({}, NAME), S60), ` ${NAME.slice(0, 45)}…  ${said.text}`);
  // A reached machine: its label and the time of the read.
  assert.equal(headingOf(live("garnet"), S80), placed([1, "garnet"], [24, "read 10:00:10"]));
  assert.equal(headingOf(live(NAME.slice(0, 30)), S80), ` ${NAME.slice(0, 20)}…  read 10:00:10`, "the label is cut two cells before the time");
  assert.equal(headingOf(live(NAME), S60), ` ${NAME.slice(0, 42)}…  read 10:00:10`);
  // The order holds at every width and for every label: what is given up later is whole while
  // anything given up earlier is still drawn.
  const shapes = new Set();
  for (const ascii of [false, true]) for (const length of [6, 12, 20, 30, 61]) for (const sz of [S60, S79, S80, S120]) {
    const label = NAME.slice(0, length), pane = paneOf(sz), at = `a label of ${length} at ${sz.cols}x${sz.rows}${ascii ? " ascii" : ""}`;
    const parts = headingOf(rowless({ ascii }, label), sz).trim().split("  "), state = parts.indexOf(said.text);
    assert.equal(state === 1 || state === 2, true, `${at}: the state stands whole after the label, or after the label and the path: ${parts.join(" | ")}`);
    const whole = parts[0] === label, why = parts.length > state + 1, where = state === 2;
    assert.equal(parts.length, state + (why ? 2 : 1), at);
    if (where) assert.equal(why && parts[state + 1] === garnet.short && whole, true, `${at}: a path is drawn only beside the whole short reason and the whole label`);
    if (why) assert.equal(whole, true, `${at}: a short reason is drawn only beside the whole label`);
    if (!whole) assert.equal(parts[0].endsWith(glyphsOf(ascii).cut) && label.startsWith(parts[0].slice(0, -glyphsOf(ascii).cut.length)), true, `${at}: a cut label ends in the cut mark`);
    shapes.add(`${whole ? "label" : "cut label"}${where ? ", path" : ""}, state${why ? ", short reason" : ""}`);
    assert.equal(textWidth(headingOf(rowless({ ascii }, label), sz)) <= pane - 1, true, `${at}: the heading ends inside its pane`);
    const reached_ = headingOf(live(label, { ascii }), sz);
    assert.equal(reached_.endsWith("  read 10:00:10") && textWidth(reached_) <= pane - 1, true, `${at}: the time stands whole, inside the pane: ${reached_}`);
  }
  assert.deepEqual([...shapes].sort(), ["cut label, state", "label, path, state, short reason", "label, state", "label, state, short reason"], "every step of the order was drawn");
});

test("a deployment's note stands under its heading in a view of several deployments, on wrapped rows that hold nothing else", () => {
  // garnet reported this workspace, and now reports the one quartz is in: the shared home leaves a note.
  const both = heard(local(), answered(group(), quartz({ workspace: ELSEWHERE })), T1);
  const moved = heard(both, answered(group({ workspace: ELSEWHERE }), quartz({ workspace: ELSEWHERE })), T2);
  const state = press(moved, ["w", "j", "enter"]).state;
  assert.equal(state.open, GARNET, "the view of the other workspace is open, on its first machine");
  const note = deploymentOf(state).note;
  assert.equal(typeof note === "string" && note.length > 0, true, "the shared home gives the moved machine a note");
  const line = textOf(shown(note)), away = rowReason(panelRow(state, FAR_B)).label;
  for (const [sz, room] of [[S80, 34], [S60, 56], [S120, 53]]) {
    const d = draw(state, sz), pane = paneOf(sz), word = pane - 5 - Math.min(20, away.length), at = `${sz.cols}x${sz.rows}`;
    const rows = wrap(line, room);
    // Both machines were read at the time the header shows: each heading is its name alone.
    assert.deepEqual(listLines(d, sz).slice(0, rows.length + 5), [
      " garnet",
      ...rows.map((row) => `   ${row}`),
      placed([0, `> ● ${FAR_A}`]),
      // The row with a word has its name cut before the word's column.
      placed([2, `○ ${cutTo(FAR_B, word - 2 - 4)}`], [word, cutTo(away, 20)]),
      " quartz",
      placed([2, `● ${FAR_Q}`]),
    ], at);
    if (sz === S80) assert.equal(rows.length, 2, "at 80 columns the note wraps");
    assert.equal(cellText(d, 0).startsWith(" billing  2 machines  "), true, `${at}: ${cellText(d, 0)}`);
    assert.equal(cellText(d, 1).endsWith(" read 10:00:25"), true, `${at}: in a view with no deployment of this machine the header's time is the roster read's`);
    for (let r = 4; r < 4 + rows.length; r++) assert.equal(d.cells[r].slice(0, pane).some((cell) => cell.style.reverse || cell.style.bold), false, `${at}: a note is no heading and no row of the selection`);
  }
  // The movement keys pass over a heading and a note: the selection stands on instances only.
  const walked = [state, ...["j", "j", "j", "k", "k", "k", "g", "G"].map((_, i, keys) => press(state, keys.slice(0, i + 1)).state)].map((s) => String(s.selected).split("/").at(-1));
  assert.deepEqual(walked, [FAR_A, FAR_B, FAR_Q, FAR_Q, FAR_B, FAR_A, FAR_A, FAR_A, FAR_Q]);
});

test("a deployment's note stands above the list in a view of one deployment, after the notice when there is one, on at most two rows, and a rule closes it", () => {
  // garnet moves to a workspace nothing else is in: a view of its own, with no heading.
  const alone = press(heard(reached(), answered(group({ workspace: ELSEWHERE })), T2), ["w", "j", "enter"]).state;
  assert.equal(alone.open, GARNET);
  const note = textOf(shown(deploymentOf(alone).note));
  for (const ascii of [false, true]) for (const sz of SIZES) {
    const d = draw({ ...alone, ascii }, sz), g = glyphsOf(ascii), pane = paneOf(sz), wide = sz.cols >= WIDE, at = `${sz.cols}x${sz.rows}${ascii ? " ascii" : ""}`;
    assert.equal(d.lines[2], g.rule.repeat(sz.cols), `${at}: the rule under the header has no joint: the panes open under the note`);
    assert.equal(d.lines[3], ` ${note}`, `${at}: the note, alone on its row, from the margin`);
    assert.equal(d.lines[4], wide ? `${g.rule.repeat(pane)}${g.down}${g.rule.repeat(sz.cols - pane - 1)}` : g.rule.repeat(sz.cols), `${at}: a rule closes it`);
    assert.equal(cellText(d, 5, 0, pane).startsWith(`> ${marksOf(ascii).running} ${FAR_A}`), true, `${at}: then the list, with no heading: ${d.lines[5]}`);
    assert.equal(d.cells.slice(5, sz.rows - 1).some((line) => line.slice(0, pane).some((cell) => cell.style.bold)), false, `${at}: and no heading anywhere in it`);
    assert.equal(d.page, sz.rows - 6, `${at}: the note and its rule take two rows of the body`);
    fits(d, sz, at);
  }
  // Not reached in its new view: the state, its reason, then the note, then the rule.
  const failing = heard(alone, { thrown: "spawn oats ENOENT" }, T3), said = deploymentState(deploymentOf(failing));
  assert.equal(said.key, "remembered");
  for (const sz of SIZES) {
    const d = draw(failing, sz), reason = reasonRows(d, textOf(shown(said.detail)), "…"), at = `not reached, ${sz.cols}x${sz.rows}`;
    assert.equal(cellText(d, 3).trim(), said.text, `${at}: the state`);
    assert.equal(reason.whole && reason.rows[0] === 4, true, `${at}: its reason on the rows under it`);
    assert.equal(d.lines[reason.rows.at(-1) + 1], ` ${note}`, `${at}: the note after the notice`);
    assert.equal(d.cells[reason.rows.at(-1) + 2][0].text, "─", `${at}: and the rule after the note`);
    const kept = cellText(d, reason.rows.at(-1) + 3, 0, paneOf(sz));
    assert.match(kept, /^[> ] \? /, `${at}: the kept rows follow, unknown`);
    assert.equal(kept.slice(4).startsWith(FAR_A.slice(0, 6)) && kept.endsWith(rowReason(panelRow(failing, FAR_A)).label), true, `${at}: with the shared label of a machine not reached: ${kept}`);
  }
  // This machine's own deployment has one too: a standalone deployment's teams are its own.
  const standalone = stateOf(reporting(NEAR(), { identity: STANDALONE }), { cli: REMOTE_CLI }), own = primaryDeployment(panelOf(standalone, AT).deployments).note;
  assert.equal(typeof own === "string" && own.length > 0, true, "the shared home gives a standalone deployment a note");
  for (const sz of SIZES) {
    const d = draw(standalone, sz);
    assert.equal(d.lines[3], ` ${textOf(shown(own))}`, `${sz.cols}x${sz.rows}`);
    assert.equal(d.cells[4][0].text, "─", `${sz.cols}x${sz.rows}`);
    assert.equal(cellText(d, 5, 0, paneOf(sz)).includes(KERNEL_EXPERT.slice(0, 12)), true, `${sz.cols}x${sz.rows}: the list follows`);
  }
  // A note longer than two rows is cut at the second, with the mark.
  const wordy = "garnet in the far rack of the ledger team behind the second door on the third floor of the old building by the river";
  const long = press(heard(heard(local(), answered(group({ label: wordy })), T1), answered(group({ label: wordy, workspace: ELSEWHERE })), T2), ["w", "j", "enter"]).state;
  const whole = textOf(shown(deploymentOf(long).note)), d = draw(long, S60), first = wrap(whole, 58)[0];
  assert.equal(wrap(whole, 58).length > 2, true, "the note needs more than two rows of 58 cells");
  assert.equal(d.lines[3], ` ${first}`);
  assert.equal(d.lines[4].endsWith("…") && whole.slice(first.length + 1).startsWith(d.lines[4].trim().slice(0, -1).trimEnd()), true, `the second row is the next piece, cut: ${d.lines[4]}`);
  assert.equal(d.lines[5], "─".repeat(60), "and the rule is the row after it");
});

test("a deployment that is not live and has no row is listed after the sections: a heading with its path, its state and its short reason, and its reason on rows of its own", () => {
  const garnet = deploymentOf(rowless()), said = deploymentState(garnet);
  assert.equal(said.key !== "live" && said.detail.length > 0, true);
  assert.equal(panelOf(rowless(), AT).instances.some((row) => row.deployment.id === GARNET), false, "the machine has no row");
  for (const ascii of [false, true]) for (const [sz, room] of [[S80, 34], [S60, 56], [S79, 75], [S120, 53]]) {
    const state = rowless({ ascii }), d = draw(state, sz), pane = paneOf(sz), marks = marksOf(ascii), at = `${sz.cols}x${sz.rows}${ascii ? " ascii" : ""}`;
    const lines = listLines(d, sz), heading = lines.findIndex((line) => line.startsWith(" garnet"));
    const last = lines.findLastIndex((line) => line.includes(MAINTAINER));
    assert.equal(heading, last + 1, `${at}: after every row of the sections`);
    assert.equal(lines[heading].includes(`  ${said.text}`), true, `${at}: the heading holds the state: ${lines[heading]}`);
    const rows = wrap(textOf(shown(said.detail)), room);
    assert.deepEqual(lines.slice(heading + 1, heading + 1 + rows.length), rows.map((row) => `   ${row}`), `${at}: the reason, whole, on the rows under it, and nothing of the TUI's with it`);
    assert.deepEqual(lines.slice(heading + 1 + rows.length).filter((line) => line.trim()), [], `${at}: and nothing after`);
    assert.equal(lines[0], " This machine", `${at}: this machine keeps its heading`);
    // It is no row: the selection never stands on it.
    const end = press(press(state, ["G"], sz).state, ["j", "pagedown"], sz).state;
    assert.equal(String(end.selected).endsWith(`/${MAINTAINER}`), true, `${at}: the last row is this machine's`);
    const after = draw(end, sz);
    assert.deepEqual(bodyRows(sz).filter((r) => after.cells[r][0].text === ">").map((r) => cellText(after, r, 0, pane).includes(MAINTAINER)), [true], at);
    assert.equal(cellText(after, 3 + heading, 0, pane).includes(marks.unknown), false, at);
    fits(d, sz, at);
  }
  // The path is dim, the state plain, the short reason dim, the label bold.
  const d = draw(rowless(), S60), r = 3 + listLines(d, S60).findIndex((line) => line.startsWith(" garnet"));
  const look = (word) => { const x = cellIndexOf(d.cells[r], word); assert.equal(x > 0, true, word); return d.cells[r][x].style; };
  assert.deepEqual([look("garnet").bold, look(garnet.label), look(said.text).dim, look(garnet.short)], [true, DIM, false, DIM]);
  // A machine that answers with no row is live: it has no section and is not listed.
  const empty = heard(local(), answered(group({ instances: [] })), T1);
  assert.equal(listLines(draw(empty, S80), S80).some((line) => line.includes("garnet")), false);
  assert.equal(draw(empty, S80).lines[0].includes("+1 machine"), true, "the header still counts it");
});

test("the roster read's own failure, while no answer has arrived, stands after the list: the TUI's line, and the failure on the rows after it", () => {
  assert.equal(ROSTER_FAILED, "Other machines were not read.");
  const outcomes = {
    "a read that threw": { thrown: "spawn oats ENOENT" },
    "an answer that is an error": { envelope: { ok: false, error: { code: "E_REGISTRY", message: "the registry of machines could not be read" } } },
  };
  for (const [kind, outcome] of Object.entries(outcomes)) for (const ascii of [false, true]) for (const [sz, room] of [[S80, 34], [S60, 56], [S79, 75], [S120, 53]]) {
    const state = heard(local({ ascii }), outcome, T1), failure = state.remote.rosterFailure, d = draw(state, sz), pane = paneOf(sz), at = `${kind}, ${sz.cols}x${sz.rows}${ascii ? " ascii" : ""}`;
    assert.equal(typeof failure === "string" && failure.length > 0, true, `${at}: the shared rule keeps the failure's sentence`);
    const lines = listLines(d, sz), own = lines.indexOf(`   ${ROSTER_FAILED}`), rows = wrap(textOf(shown(failure)), room);
    assert.equal(own > 0 && lines[own - 1] === "" && lines[own - 2].includes(MAINTAINER), true, `${at}: after the list, an empty row apart`);
    assert.deepEqual(lines.slice(own + 1, own + 1 + rows.length), rows.map((row) => `   ${row}`), `${at}: the failure through shown(), on rows of its own`);
    assert.deepEqual(lines.slice(own + 1 + rows.length).filter((line) => line.trim()), [], at);
    for (const cell of d.cells[3 + own].slice(3, 3 + ROSTER_FAILED.length)) assert.equal(cell.style, DIM, `${at}: the TUI's own line is dim`);
    assert.equal(d.cells[3 + own + 1].slice(0, pane).some((cell) => cell.style.dim), false, `${at}: the failure is not`);
    assert.equal(lines.some((line) => line.startsWith(" This machine")) || d.lines[0].includes("machine"), false, `${at}: no heading and no count: there is no machine to show`);
    fits(d, sz, at);
  }
  // It is no row either: the last row is the last instance.
  const state = heard(local(), { thrown: "spawn oats ENOENT" }, T1);
  assert.equal(String(press(state, ["G", "j"]).state.selected).endsWith(`/${MAINTAINER}`), true);
  // With no instance to list, or none read yet, the two rows follow the line that says so, an empty row apart.
  for (const [entry_, why] of [[reporting([]), EMPTY_TEXT.none], [null, EMPTY_TEXT.reading]]) {
    const none = heard(stateOf(entry_, { cli: REMOTE_CLI }), { thrown: "spawn oats ENOENT" }, T1);
    assert.deepEqual(listLines(draw(none, S60), S60).slice(0, 5), [`   ${why}`, "", `   ${ROSTER_FAILED}`, `   ${textOf(shown(none.remote.rosterFailure))}`, ""], why);
  }
  // Once an answer has arrived a failed read is the machines' to say: the line is gone.
  for (const later of [heard(reached(), { thrown: "spawn oats ENOENT" }, T2), lost(), heard(heard(local(), { thrown: "spawn oats ENOENT" }, T1), answered(group()), T2)]) {
    assert.equal(later.remote.rosterFailure, null);
    assert.equal(draw(later, S120).lines.some((line) => line.includes(ROSTER_FAILED)), false);
  }
});

// ── The detail of a machine's row ────────────────────────────────────────────────────────────────

test("in a view of several deployments the detail says which machine the instance is on, under its soul, and a view of one deployment has no such line", () => {
  const state = reached();
  assert.deepEqual(labels(detailOf(selecting(state, FAR_A))), ["soul", "machine", "state", "harness", "work", "home"]);
  assert.deepEqual(fact(detailOf(selecting(state, FAR_A)), "machine").rows, ["garnet"]);
  assert.deepEqual(fact(detailOf(selecting(state, KERNEL_DEV)), "machine").rows, ["This machine"]);
  assert.deepEqual(labels(detailOf(selecting(state, KERNEL_DEV))), ["soul", "machine", "state", "harness", "work", "team", "parent", "started", "home"]);
  assert.equal(fact(detailOf(local()), "machine"), null, "this machine alone");
  const alone = press(heard(reached(), answered(group({ workspace: ELSEWHERE })), T2), ["w", "j", "enter"]).state;
  assert.equal(draw(selecting(alone, FAR_A), S160).lines.some((line) => line.includes("   machine  ")), false, "a machine alone in its view: the header names it");
  // At 79 columns the detail is a page: the line is there too.
  const page = draw(press(selecting(state, FAR_A, S79), ["tab"], S79).state, S79);
  assert.equal(page.lines[5], "   machine  garnet");
});

test("the detail of a row whose deployment is not live says why under `machine`, in the shared sentence wrapped on rows of its own: the heading has room for the short reason only", () => {
  const outcomes = { "an answer that is an error": TIMEOUT, "a read that threw": { thrown: "spawn oats ENOENT" } };
  for (const [kind, outcome] of Object.entries(outcomes)) {
    const state = heard(reached(), outcome, T2), said = deploymentState(deploymentOf(state));
    assert.equal(said.key !== "live" && said.detail.length > 0, true, kind);
    for (const name of [FAR_A, FAR_B]) for (const sz of [S160, S120, S80]) {
      const rows = fact(detailOf(selecting(state, name, sz), sz), "machine").rows;
      assert.equal(rows[0], "garnet", `${kind}, ${name}`);
      assert.equal(rows.slice(1).join(" "), textOf(shown(said.detail)), `${kind}, ${name} at ${sz.cols}: the shared sentence, whole, through shown()`);
      if (sz === S80) assert.equal(rows.length > 2, true, "at 80 columns it wraps");
    }
    // This machine's rows, in the same view, say nothing of it: their deployment is live.
    assert.deepEqual(fact(detailOf(selecting(state, KERNEL_DEV)), "machine").rows, ["This machine"], kind);
  }
  // The same sentence at 79 columns, where the detail is a page.
  const state = lost(), page = draw(press(selecting(state, FAR_A, S79), ["tab"], S79).state, S79), said = deploymentState(deploymentOf(state));
  assert.deepEqual(page.lines.slice(5, 7), ["   machine  garnet", ...wrap(textOf(shown(said.detail)), 66).map((row) => `            ${row}`)].slice(0, 2));
});

test("the reason of a row that cannot be addressed on a machine that was not reached is drawn once, under its state after the words that say who gave it, with no `held` line; on a reached machine the `held` line holds the shared sentence", () => {
  // Both failures are the read's own, so both texts are given by the read of other machines: the
  // envelope of a read that did not answer in time is written by the shared read, never printed
  // by the installed CLI, and what a read threw is the client's by its nature.
  const outcomes = { "an answer that is an error": TIMEOUT, "a read that threw": { thrown: "spawn oats ENOENT" } };
  for (const [kind, outcome] of Object.entries(outcomes)) for (const sz of [S160, S80]) {
    const state = selecting(heard(reached(), outcome, T2), FAR_B, sz), row = panelRow(state, FAR_B), acts = instanceActs(row), at = `${kind} at ${sz.cols}`;
    assert.equal(row.addressable === false && acts.blocked !== null && acts.blocked.sentence === row.runtimeError, true, `${at}: the shared home blocks the row with the very text it carries as its runtimeError`);
    const d = draw(state, sz), detail = factsOf(detailLines(d, sz)), said = `oats tui's read of other machines says: ${textOf(shown(row.runtimeError))}`;
    assert.equal(originLead(row.runtimeErrorOrigin, TERMS), "oats tui's read of other machines says:", `${at}: the words are the shared home's for the row`);
    assert.equal(fact(detail, "held"), null, `${at}: no held line`);
    assert.deepEqual([fact(detail, "state").rows[0], fact(detail, "state").rows.slice(1).join(" ")], [rowReason(row).label, said], `${at}: the state is the shared label of its reason, and the reason stands under it, after who gave it, with no quotation mark`);
    const whole = detailLines(d, sz).map((line) => line.trim()).filter(Boolean).join(" ");
    assert.equal(whole.split(said).length - 1, 1, `${at}: once`);
    assert.deepEqual(labels(detail), ["soul", "machine", "state", "harness", "work", "home"], at);
    // A row of the same machine that can be addressed has the same line and nothing held either.
    const other = factsOf(detailLines(draw(selecting(state, FAR_A, sz), sz), sz));
    assert.equal(fact(other, "held") === null && fact(other, "state").rows.slice(1).join(" ") === said, true, `${at}: ${FAR_A}`);
  }
  // Reached: the kernel does not report the row addressable, and the shared sentence says so.
  for (const sz of [S160, S80]) {
    const state = selecting(reached(), FAR_B, sz), acts = instanceActs(panelRow(state, FAR_B)), detail = factsOf(detailLines(draw(state, sz), sz));
    assert.equal(acts.blocked !== null && typeof acts.blocked.sentence === "string", true);
    assert.equal(fact(detail, "held").rows.join(" "), textOf(shown(acts.blocked.sentence)), `${sz.cols}: the held line is the shared sentence`);
    assert.deepEqual(fact(detail, "state").rows, [AWAY()], `${sz.cols}: and the state is the shared label of its reason, with no text under it`);
    assert.equal(fact(factsOf(detailLines(draw(selecting(reached(), FAR_A, sz), sz), sz)), "held"), null, `${sz.cols}: a row that can be addressed is not held`);
  }
});

// ── Who gave a row's text ────────────────────────────────────────────────────────────────────────
// A row's own text stands under `state` after the words that say who gave it. Each row here is made
// on the path that decides its speaker, as lib/read.mjs runs it: this machine's by a read cycle
// (`readCycle`), a machine's by the shared roster read over a fake `exec`. No test sets a row's mark:
// where a row has none it was made by hand, and the test's title says so.

/** One roster read as lib/read.mjs makes it: the shared cliRemoteRoster over an `exec`, and its
 *  outcome as the loop hands it to the shared rule: what the read answered, or the message of what
 *  it threw. */
const rosterRead = (exec) => cliRemoteRoster(CLI.bin, { exec }).then((envelope) => ({ envelope }), (error) => ({ thrown: String(error?.message ?? error) }));
/** An installed CLI that prints a roster of `groups`, and a read that fails with `message` before a
 *  child answers. */
const printing = (...groups) => (bin, argv, options, callback) => { callback(null, JSON.stringify({ schemaVersion: 1, ok: true, result: { groups } }), ""); };
const failing = (message) => () => { throw new Error(message); };
/** A row whose text is `text`, by who gives it. `lead`: the speaker's words as the shared home writes
 *  them, written out because this is where they are pinned; `name`: the row; `make`: a state that
 *  holds the row, selected.
 *    the kernel                  it answered `running: null` with the text, and such a row is not probed
 *    the terminal check          the kernel said running, and the collector's probe failed with the text
 *    the read of other machines  a machine reached once, then a roster read that failed with the text:
 *                                the shared rule keeps the machine's rows, and their text is its
 *                                sentence for a failed read, which ends in what was thrown
 *    nobody                      a row made by hand: helpers.mjs `observed` hands the panel an answer
 *                                that holds the text and no speaker, which no read does */
const SPEAKERS = {
  "the kernel": { lead: "OATS says:", name: KERNEL_DEV, make: (text, options) => stateOf(readCycle([instanceRow("acme-ledger-developer", KERNEL_DEV, { running: null, runtimeState: "unreachable", runtimeError: text })]), options) },
  "the terminal check": { lead: "oats tui's terminal check says:", name: KERNEL_DEV, make: (text, options) => stateOf(readCycle([instanceRow("acme-ledger-developer", KERNEL_DEV)], { collect: collector(() => ({ running: null, runtimeState: "unreachable", runtimeError: text })) }), options) },
  "the read of other machines": { lead: "oats tui's read of other machines says:", name: FAR_A, make: async (text, options) => selecting(heard(heard(local(options), await rosterRead(printing(group())), T1), await rosterRead(failing(text)), T2), FAR_A) },
  "nobody, on a row made by hand": { lead: null, name: KERNEL_DEV, make: (text, options) => stateOf(observed([instanceRow("acme-ledger-developer", KERNEL_DEV, { running: null, runtimeState: "unreachable", runtimeError: text })]), options) },
};
/** The four messages of the reason tests above, by what each tries. The display filter withholds
 *  the two that hold an ESC whole, and shows the two others with the character replaced. */
const HOSTILE_TEXTS = {
  "an erase sequence": "wipe \x1b[2J the screen",
  "a bidi override": "safe\u202Etxt.exe was read",
  "a C1 control, the 8-bit CSI": "red \u009B31m alert \u009B2J",
  "an OSC that sets the title": "\x1b]0;owned\x07 and a tail",
};
const WITHHELD_WHOLE = new Set(["an erase sequence", "an OSC that sets the title"]);

test("the four hostile messages as a row's runtimeError, given by each of the three speakers and by nobody (a row made by hand), in the detail at 80x24 and at 60x15, in UTF-8 and in ASCII: a message the filter shows stands after its speaker's words, one it withholds is the withheld word once with no speaker and no quotation mark, and none leaves a control character in a text or a cell, a sequence that is not the TUI's own or a row wider than the terminal", async () => {
  for (const [speaker, { lead, name, make }] of Object.entries(SPEAKERS)) for (const [tries, text] of Object.entries(HOSTILE_TEXTS)) for (const ascii of [false, true]) for (const sz of [S80, S60]) {
    const made = await make(text, { ascii }), state = sz.cols < WIDE ? press(made, ["tab"], sz).state : made, row = panelRow(state, name);
    const at = `${speaker}, ${tries}, at ${sz.cols}x${sz.rows}${ascii ? ", not UTF-8" : ""}`;
    // The row is the shared home's: its text ends in the message, and its mark, which no line here
    // wrote, names the speaker.
    assert.equal(row.runtimeError.endsWith(text), true, `${at}: the row's text holds the message`);
    assert.equal(originLead(row.runtimeErrorOrigin, TERMS), lead, `${at}: the shared home says who gave it`);
    const d = draw(state, sz, { utf8: !ascii }), detail = factsOf(detailLines(d, sz)), under = fact(detail, "state").rows.slice(1), line = displayLine(row.runtimeError);
    assert.equal(line === DETAIL_WITHHELD, WITHHELD_WHOLE.has(tries), `${at}: what the display filter makes of the text`);
    if (line === DETAIL_WITHHELD) {
      assert.deepEqual(under, ["[withheld]"], `${at}: under the state, the TUI's withheld word alone`);
      assert.equal(d.lines.join("\n").split("[withheld]").length - 1, 1, `${at}: once on the screen`);
      // Every lead ends in `says:`, one word, which no wrap breaks: no part of one is on the screen.
      for (const drawn of d.lines) assert.equal(drawn.includes("says:") || drawn.includes("\""), false, `${at}: no speaker introduces a withheld text and no quotation mark stands around it: ${drawn}`);
    } else {
      // With a speaker: its words, then the display line. With none, and no reason of the row
      // that vouches for the text: the display line in quotation marks, which names nobody.
      const said = lead === null ? `"${line}"` : `${lead} ${line}`;
      assert.equal(under.join(" "), ascii ? said.replace(/[^\x20-\x7e]/g, "?") : said, `${at}: under the state`);
      if (lead === null) for (const drawn of d.lines) assert.equal(drawn.includes("says:"), false, `${at}: nobody is named: ${drawn}`);
    }
    assert.equal(labels(detail)[labels(detail).indexOf("state") + 1], "harness", `${at}: and no held line repeats it`);
    // Whatever was shown: the bytes the real screen writes, every text of the frame, every cell.
    const out = readTerminalOutput(createScreen({ utf8: !ascii, ascii }).render(d.rows, sz, { full: true }));
    assert.deepEqual(out.foreign, [], `${at}: every ESC written begins a sequence of the TUI's own`);
    assert.deepEqual([...new Set(out.sequences.map((s) => s.kind))].filter((kind) => !["erase", "position", "sgr", "sync"].includes(kind)), [], `${at}: a frame writes positions, erases and styles in one synchronized update, and nothing else`);
    assert.doesNotMatch(out.text, CONTROL, `${at}: no control character is written`);
    if (ascii) assert.match(out.text, PRINTABLE_ASCII, `${at}: with a locale that is not UTF-8, nothing outside printable ASCII`);
    for (const spans of d.rows) for (const span of spans) if (Object.hasOwn(span, "text")) assert.doesNotMatch(textOf(span.text), CONTROL, `${at}: no text of the frame holds a control character`);
    d.cells.forEach((cells, r) => cells.forEach((cell, x) => assert.doesNotMatch(cell.text, CONTROL, `${at}: row ${r}, column ${x}`)));
    assert.equal(d.lines.some((drawn) => drawn.includes("owned")), false, `${at}: nothing of a withheld text is shown`);
    fits(d, sz, at);
  }
});

/** A text a kernel could give, long enough to take the six rows a wrapped value may. */
const TOLD = "tmux did not answer on /tmp/tmux-1000/default within 5 seconds; the session may still be live, so its state is left unknown";

test("the detail at 80x24 of a row whose kernel gave a text that wraps, in UTF-8 and in ASCII, cell for cell: `OATS says:` starts the fact under `state`, the rows after it stand under the value like any wrapped fact, no quotation mark stands around it, and the six rows are the same in both", () => {
  assert.equal(TOLD.length >= 120 && TOLD.length <= 200, true);
  const told = (options) => selecting(stateOf(readCycle(ROSTER().map((row) => (row.instance === EXPERT_TUI ? { ...row, runtimeError: TOLD } : row)), { withheld: WITHHELD }), options), EXPERT_TUI);
  const said = [
    "            OATS says: tmux did not",
    "            answer on",
    "            /tmp/tmux-1000/default",
    "            within 5 seconds; the",
    "            session may still be live,",
    "            so its state is left unknown",
  ];
  const blank = Array.from({ length: 5 }, () => "");
  assert.deepEqual(draw(told(), S80).lines, [
    ` acme-platform        ${COUNTS}`,
    "  Instances   Souls   Capabilities                                read 10:00:00",
    `${"─".repeat(38)}┬${"─".repeat(41)}`,
    ...beside([
      "  ● acme-console-expert-tui-read",
      "    ● acme-console-developer-pan…    !",
      "    ● acme-console-developer-ter…    !",
      "",
      "> ? acme-expert-t…  state unknown",
      "",
      "  ● acme-ledger-expert-retire",
      "    ● acme-ledger-developer-note…    !",
      "      ○ peer-reviewer-note",
      "",
      "  ● acme-maintainer-ops",
    ], [
      "   acme-expert-tui",
      "   soul     acme-expert",
      "   state    unreachable",
      ...said,
      "   harness  claude, claude-opus-5-5 (so…",
      "   work     worktree, agents/acme-exper…",
      "   team     eng",
      `   started  ${STARTED}`,
      "   home     …t/instances/acme-expert-tui",
      ...blank,
    ]),
    `${LEAD}/ filter   Tab detail   r refresh   ? help   q quit`, // its state is not known: Enter does not open it; at 80 columns its act and `workspaces` are given up
  ]);
  assert.deepEqual(draw(told({ ascii: true }), S80).lines, [
    ` acme-platform        ${COUNTS}`,
    "  Instances   Souls   Capabilities                                read 10:00:00",
    `${"-".repeat(38)}+${"-".repeat(41)}`,
    ...beside([
      "  * acme-console-expert-tui-read",
      "    * acme-console-developer-p...    !",
      "    * acme-console-developer-t...    !",
      "",
      "> ? acme-expert...  state unknown",
      "",
      "  * acme-ledger-expert-retire",
      "    * acme-ledger-developer-no...    !",
      "      - peer-reviewer-note",
      "",
      "  * acme-maintainer-ops",
    ], [
      "   acme-expert-tui",
      "   soul     acme-expert",
      "   state    unreachable",
      ...said,
      "   harness  claude, claude-opus-5-5 (...",
      "   work     worktree, agents/acme-exp...",
      "   team     eng",
      `   started  ${STARTED}`,
      "   home     ...instances/acme-expert-tui",
      ...blank,
    ], "|"),
    `${LEAD}/ filter   Tab detail   r refresh   ? help   q quit`, // its state is not known: Enter does not open it; at 80 columns its act and `workspaces` are given up
  ]);
});

test("with `--ascii` and a locale that is not UTF-8 the words that say who gave a text are drawn as without: each of the three is ASCII whole, so the same cells hold the same characters and the screen writes the same bytes", async () => {
  for (const [speaker, { lead, name, make }] of Object.entries(SPEAKERS)) {
    if (lead === null) continue;
    assert.match(lead, PRINTABLE_ASCII, `${speaker}: every character of the words is ASCII, the apostrophe too`);
    const drawn = [];
    for (const ascii of [false, true]) {
      const state = await make("tmux: no server", { ascii }), d = draw(state, S160, { utf8: !ascii }), at = `${speaker}${ascii ? ", not UTF-8" : ""}`;
      const said = `${lead} ${textOf(shown(panelRow(state, name).runtimeError))}`;
      assert.deepEqual(fact(factsOf(detailLines(d, S160)), "state").rows.slice(1), [said], `${at}: the words and the text, on one row at this width`);
      assert.equal(readTerminalOutput(createScreen({ utf8: !ascii, ascii }).render(d.rows, S160, { full: true })).text.includes(said), true, `${at}: and so they are written`);
      const r = bodyRows(S160).find((i) => cellText(d, i, listWidth(S160.cols) + 1).trim() === said);
      drawn.push(d.cells[r].slice(listWidth(S160.cols) + 1).map((cell) => cell.text));
    }
    assert.deepEqual(drawn[1], drawn[0], `${speaker}: cell for cell the same row`);
  }
});

// ── The switcher ─────────────────────────────────────────────────────────────────────────────────

test("the switcher at 80x24 in UTF-8, cell for cell: a workspace on two machines with one deployment not live, the open mark, the shared heading over a machine matched to no workspace, the TUI's own over the folders not opened, and the selection", () => {
  assert.equal(OPEN_MARK, "*");
  assert.equal(OFFERED_SECTION, "On this machine, not opened");
  const state = press(choosing(), ["j", "j"]).state, [platform, never] = choicesOf(state);
  assert.deepEqual(choicesOf(state).map((row) => [row.label, row.unattached]), [["acme-platform", false], ["quartz", true]]);
  assert.equal(platform.notLiveText.length > 0 && platform.place.includes("garnet") && never.place.length > 0, true, "the shared home words the machines, what is not live, and why a machine is not matched");
  const d = draw(state, S80);
  assert.deepEqual(d.lines, [
    " workspaces",
    "  Instances   Souls   Capabilities",
    "─".repeat(80),
    placed([2, "*"], [4, "acme-platform"], [32, platform.place], [79 - platform.notLiveText.length, platform.notLiveText]),
    `  ${UNMATCHED_SECTION}`,
    placed([4, "quartz"], [32, never.place]),
    "  On this machine, not opened",
    placed([0, ">"], [4, "acme-billing"], [32, "~/Agents/acme-billing"]),
    placed([4, "acme-docs"], [32, "~/Agents/acme-docs"]),
    ...Array.from({ length: 14 }, () => ""),
    `${LEAD}Enter open   / filter   r refresh   Esc close   ? help   q quit`,
  ]);
  // The selection is a bar over the whole width with `>` in its first cell; no other row has either.
  assert.deepEqual(d.cells.flatMap((line, r) => (line.some((cell) => cell.style.reverse) ? [r] : [])), [7]);
  assert.equal(d.cells[7].every((cell) => cell.style.reverse), true, "over the whole width");
  assert.deepEqual(bodyRows(S80).filter((r) => d.cells[r][0].text === ">"), [7]);
  // The two headings and a place are dim; what is not live is not: it is what a person looks for.
  for (const [r, from, to] of [[4, 2, 2 + UNMATCHED_SECTION.length], [6, 2, 2 + OFFERED_SECTION.length], [3, 32, 32 + platform.place.length], [8, 32, 50]]) for (const cell of d.cells[r].slice(from, to)) assert.equal(cell.style, DIM, `row ${r}`);
  for (const cell of d.cells[3].slice(79 - platform.notLiveText.length, 79)) assert.equal(cell.style.dim, false);
  // While the switcher is shown the header names no workspace, counts nothing and has no time, and
  // none of the three views is the open one: nothing of the row is in reverse, and each name is
  // plain (each is a view that opens: `1`, `2` and `3`, or the leader then the digit).
  assert.equal(d.cells[1].some((cell) => cell.style.reverse), false, "no view is the open one");
  for (const cell of d.cells[1].slice(2, 11)) assert.equal(cell.style, PLAIN, "Instances is plain");
  for (const [name, from] of [["Souls", 14], ["Capabilities", 22]]) for (const cell of d.cells[1].slice(from, from + name.length)) assert.equal(cell.style, PLAIN, `${name} is plain, not dim`);
  // Before any key the selection is on the first choice, which is also the open one.
  const first = draw(choosing(), S80);
  assert.equal(first.lines[3], placed([0, ">"], [2, "*"], [4, "acme-platform"], [32, platform.place], [79 - platform.notLiveText.length, platform.notLiveText]));
  assert.equal(first.cells[3].every((cell) => cell.style.reverse), true);
});

test("the switcher at 80x24 in ASCII, cell for cell: the rule in ASCII, and between a workspace's machines the shared home's own separator, as it gives it", () => {
  const state = press(choosing({ ascii: true }), ["j", "j"]).state, [platform, never] = choicesOf(state);
  const d = draw(state, S80);
  // The place is the shared home's line, drawn through shown(): the TUI chooses none of its characters.
  assert.deepEqual(d.lines, [
    " workspaces",
    "  Instances   Souls   Capabilities",
    "-".repeat(80),
    placed([2, "*"], [4, "acme-platform"], [32, textOf(shown(platform.place))], [79 - platform.notLiveText.length, platform.notLiveText]),
    `  ${UNMATCHED_SECTION}`,
    placed([4, "quartz"], [32, never.place]),
    "  On this machine, not opened",
    placed([0, ">"], [4, "acme-billing"], [32, "~/Agents/acme-billing"]),
    placed([4, "acme-docs"], [32, "~/Agents/acme-docs"]),
    ...Array.from({ length: 14 }, () => ""),
    `${LEAD}Enter open   / filter   r refresh   Esc close   ? help   q quit`,
  ]);
  // What is on the screen outside printable ASCII is that line's own, and nothing of the TUI's: with
  // `--ascii` on a terminal that reads UTF-8 it is drawn as given, and with a locale that is not
  // UTF-8 the screen replaces each such character, as it does in any text from outside.
  const foreign = (cells) => cells.flatMap((line, r) => line.flatMap((cell, x) => (PRINTABLE_ASCII.test(cell.text) ? [] : [[r, x, cell.text]])));
  const theirs = [...platform.place].flatMap((ch, i) => (PRINTABLE_ASCII.test(ch) ? [] : [[3, 32 + i, ch]]));
  assert.deepEqual(foreign(d.cells), theirs);
  assert.deepEqual(foreign(draw(state, S80, { utf8: false }).cells), []);
});

test("the switcher at 120x40, 79x24 and 60x15: no row wider than the terminal, what is not live whole at the right edge, and at 60 columns the place is cut before the label is", () => {
  for (const ascii of [false, true]) for (const [sz, place] of [[S120, 46], [S79, 32], [S60, 26]]) {
    const state = press(choosing({ ascii }), ["j", "j"], sz).state, [platform, never] = choicesOf(state), d = draw(state, sz), g = glyphsOf(ascii), at = `${sz.cols}x${sz.rows}${ascii ? " ascii" : ""}`;
    fits(d, sz, at);
    const live = sz.cols - 1 - platform.notLiveText.length;
    // At 60 columns the machines have ten cells before what is not live: cut, with the mark.
    const machines = sz === S60 ? `${platform.place.slice(0, 10 - g.cut.length)}${g.cut}` : platform.place;
    assert.deepEqual(d.lines.slice(2, 9), [
      g.rule.repeat(sz.cols),
      placed([2, "*"], [4, "acme-platform"], [place, machines], [live, platform.notLiveText]),
      `  ${UNMATCHED_SECTION}`,
      placed([4, "quartz"], [place, never.place]),
      "  On this machine, not opened",
      placed([0, ">"], [4, "acme-billing"], [place, "~/Agents/acme-billing"]),
      placed([4, "acme-docs"], [place, "~/Agents/acme-docs"]),
    ], at);
    assert.deepEqual([d.cells[3][sz.cols - 2].text, d.cells[3][sz.cols - 1].text], [platform.notLiveText.at(-1), " "], `${at}: it ends one cell before the edge`);
    assert.equal(d.lines[sz.rows - 2], "", `${at}: one pane, and no rule above the footer`);
    assert.equal(d.cells[7].every((cell) => cell.style.reverse), true, `${at}: the selection is the whole width`);
    assert.equal(d.lines[sz.rows - 1], sz === S60 ? `${LEAD}Enter open   / filter   ? help   q quit` : `${LEAD}Enter open   / filter   r refresh   Esc close   ? help   q quit`, at);
  }
  // A name longer than the labels' column is cut inside it; what is not live still stands whole.
  const NAME = "acme-platform-of-the-ledger-team-and-its-friends";
  const named = (sz) => { const state = heard(heard(stateOf(reporting(NEAR(), { workspace: NAME }), { cli: REMOTE_CLI }), answered(group()), T1), TIMEOUT, T2); return draw(press(state, ["w"], sz).state, sz); };
  const said = choicesOf(lost())[0];
  assert.equal(named(S60).lines[3], placed([0, ">"], [2, "*"], [4, `${NAME.slice(0, 19)}…`], [26, `${said.place.slice(0, 9)}…`], [59 - said.notLiveText.length, said.notLiveText]));
  assert.equal(named(S80).lines[3], placed([0, ">"], [2, "*"], [4, `${NAME.slice(0, 25)}…`], [32, said.place], [79 - said.notLiveText.length, said.notLiveText]));
  assert.equal(named(S120).lines[3], placed([0, ">"], [2, "*"], [4, `${NAME.slice(0, 39)}…`], [46, said.place], [119 - said.notLiveText.length, said.notLiveText]));
});

test("the switcher with nothing to list says so in the TUI's words, and names the command that opens a deployment whole on one row", () => {
  assert.deepEqual({ ...SWITCHER_TEXT, none: [...SWITCHER_TEXT.none] }, {
    none: ["No workspace to show.", "Start it in a deployment, or name one:", "oats tui --dir <path>"],
    nomatch: "No workspace matches the filter.", gone: "That workspace is no longer listed.", refused: "Not an OATS deployment any more.",
  });
  const state = stateOf(null, { deployment: null, cli: REMOTE_CLI });
  assert.deepEqual([state.view, state.open], ["switcher", null], "a run started outside every deployment shows the switcher");
  for (const ascii of [false, true]) for (const sz of [...SIZES, size(62, 15), size(63, 15)]) {
    const d = draw({ ...state, ascii }, sz), said = d.lines.slice(3, sz.rows - 1).filter(Boolean), at = `${sz.cols}x${sz.rows}${ascii ? " ascii" : ""}`;
    // The second sentence and its command on one row where they fit inside the margins (63 columns), else the command on a row of its own: never cut.
    assert.deepEqual(said, sz.cols >= 63 ? ["  No workspace to show.", "  Start it in a deployment, or name one: oats tui --dir <path>"] : ["  No workspace to show.", "  Start it in a deployment, or name one:", "  oats tui --dir <path>"], at);
    assert.equal(d.lines[3], "  No workspace to show.", `${at}: from the first row of the body`);
    for (const r of [3, 4]) for (const cell of d.cells[r].filter((c) => c.text !== " ")) assert.equal(cell.style, DIM, `${at}: dim, as the list's own empty line is`);
    assert.equal(d.cells.some((line) => line.some((cell) => cell.style.reverse)) || bodyRows(sz).some((r) => d.cells[r][0].text === ">"), false, `${at}: nothing is selected`);
    assert.equal(d.lines[0], " workspaces", at);
    // From 67 columns `refresh` has the room beside the leader; under that it is given up.
    assert.equal(d.lines[sz.rows - 1], sz.cols >= 67 ? `${LEAD}Enter open   / filter   r refresh   ? help   q quit` : `${LEAD}Enter open   / filter   ? help   q quit`, `${at}: Esc is not offered: there is no view to go back to`);
    fits(d, sz, at);
  }
});

test("the switcher's filter: `/` opens its field in the footer, a row stays while its name or its place holds what was typed, and a filter that matches nothing says so", () => {
  for (const sz of SIZES) {
    const open = press(choosing(), ["/"], sz).state, typed = press(open, ["d", "o", "c", "s"], sz).state, d = draw(typed, sz), footer = cellText(d, sz.rows - 1), at = `${sz.cols}x${sz.rows}`;
    assert.equal(cellText(draw(open, sz), sz.rows - 1).startsWith(`${LEAD}/`), true, at);
    assert.equal(footer.startsWith(`${LEAD}/docs  `), true, `${at}: ${footer}`);
    assert.match(footer, /Enter keep {3}Esc clear$/, at);
    assert.equal(footer.includes("quit") || footer.includes("help") || footer.includes("open"), false, `${at}: the field takes the footer row`);
    assert.deepEqual(d.lines.slice(3, sz.rows - 1).filter(Boolean).map((line) => line.replace(/ {2,}/g, "  ")), ["  On this machine, not opened", ">  acme-docs  ~/Agents/acme-docs"], `${at}: the one folder that matches, under its heading, selected`);
    assert.equal(d.lines.some((line) => line.includes("acme-billing") || line.includes("quartz") || line.includes("acme-platform") || line.includes(UNMATCHED_SECTION)), false, `${at}: no other choice, and no heading without one`);
  }
  // Kept, the filter stands in the footer and the key that clears it is offered before `refresh`.
  const kept = (sz) => press(choosing(), ["/", "d", "o", "c", "s", "enter"], sz).state;
  assert.equal(draw(kept(S120), S120).lines[39], `${LEAD}/docs                   Enter open   / filter   Esc close   r refresh   ? help   q quit`);
  assert.equal(draw(kept(S80), S80).lines[23], `${LEAD}/docs                   Enter open   / filter   ? help   q quit`);
  assert.equal(draw(kept(S60), S60).lines[14], `${LEAD}/docs                   ? help   q quit`);
  assert.equal(draw(press(kept(S80), ["escape"]).state, S80).lines[23], `${LEAD}Enter open   / filter   r refresh   Esc close   ? help   q quit`, "Esc clears a kept filter first");
  assert.equal(draw(press(kept(S80), ["escape"]).state, S80).lines.filter((line) => line.includes("acme-")).length, 3, "and every choice is back");
  // The place is matched too, and upper case and spaces around what was typed do not matter.
  const by = (keys) => draw(press(choosing(), ["/", ...keys, "enter"]).state, S80).lines.slice(3, 23).filter(Boolean).map((line) => line.trim());
  assert.equal(by(["G", "A", "R", "N", "E", "T"]).length === 1 && by(["G", "A", "R", "N", "E", "T"])[0].includes("acme-platform"), true, "a machine's name finds its workspace");
  assert.deepEqual(by(["q", "u", "a", "r", "t", "z"]).map((line) => line.split(" ")[0]), ["Not", ">"], "an unmatched machine keeps the shared heading over it");
  // Nothing matches: the TUI's line, no choice, and nothing selected.
  for (const keys of [["/", "z", "z", "z"], ["/", "z", "z", "z", "enter"]]) for (const sz of SIZES) {
    const d = draw(press(choosing(), keys, sz).state, sz);
    assert.deepEqual(d.lines.slice(3, sz.rows - 1).filter(Boolean), ["  No workspace matches the filter."], `${keys.length} keys at ${sz.cols}x${sz.rows}`);
    assert.equal(d.cells.slice(3, sz.rows - 1).some((line) => line.some((cell) => cell.style.reverse)), false);
    for (const cell of d.cells[3].filter((c) => c.text !== " ")) assert.equal(cell.style, DIM);
  }
});

test("the switcher's footer offers Esc only when a workspace is open to go back to, and `help` and `quit` are last and always", () => {
  const none = reduce(stateOf(null, { deployment: null, cli: REMOTE_CLI }), { offered: OFFERED }).state;
  assert.equal(draw(choosing(), S80).lines[23], `${LEAD}Enter open   / filter   r refresh   Esc close   ? help   q quit`);
  assert.equal(draw(choosing(), S60).lines[14], `${LEAD}Enter open   / filter   ? help   q quit`, "at 60 columns the last two hints are given up");
  assert.equal(draw(none, S80).lines[23], `${LEAD}Enter open   / filter   r refresh   ? help   q quit`, "nothing is open: no Esc");
  assert.equal(draw(none, S120).lines[39], `${LEAD}Enter open   / filter   r refresh   ? help   q quit`);
  assert.equal(draw(none, S60).lines[14], `${LEAD}Enter open   / filter   ? help   q quit`, "at 60 columns the last hint is given up");
  // Esc does what the footer says: back to the view with a workspace open, nothing without one.
  assert.deepEqual(draw(press(choosing(), ["escape"]).state, S80).lines, draw(heard(heard(local(), answered(group(), quartz({ probe: UNPROMPTED, workspace: null, instances: [] })), T1), answered(group({ probe: UNPROMPTED }), quartz({ probe: UNPROMPTED, workspace: null, instances: [] })), T2), S80).lines);
  assert.deepEqual(draw(press(none, ["escape"]).state, S80).lines, draw(none, S80).lines);
  // The keys are the effective table's.
  const rebound = effectiveConfig({ keys: { open: ["o"], close: ["backspace"], workspaces: ["f2"] } });
  assert.equal(rebound.ok, true);
  assert.equal(draw(press(reached({ actions: rebound.actions }), ["f2"]).state, S120).lines[39], `${LEAD}o open   / filter   r refresh   Backspace close   ? help   q quit`, "with the room, the close key as tui.json gave it");
  assert.equal(draw(press(reached({ actions: rebound.actions }), ["f2"]).state, S80).lines[23], `${LEAD}o open   / filter   r refresh   ? help   q quit`, "at 80 columns the last hint is given up");
  assert.equal(draw(reached({ actions: rebound.actions }), S120).lines[39], `${LEAD}o open   X stop   D retire   / filter   Tab detail   r refresh   F2 workspaces   ? help   q quit`, "with the room, the workspaces key as tui.json gave it");
  assert.equal(draw(reached({ actions: rebound.actions }), S80).lines[23], `${LEAD}o open   / filter   Tab detail   r refresh   ? help   q quit`, "at 80 columns `workspaces` is given up");
});

test("the switcher says in a line of its own that the open workspace is no longer listed, and that line hides no choice: 30 folders at 80x15", () => {
  // garnet's own view is open, and the next answer lists no machine: no view holds what was open.
  const alone = press(heard(reached(), answered(group({ workspace: ELSEWHERE })), T2), ["w", "j", "enter"]).state;
  const gone = heard(alone, answered(), T3);
  assert.deepEqual([gone.view, gone.open], ["switcher", null]);
  for (const sz of SIZES) {
    const d = draw(gone, sz);
    assert.equal(d.lines[3], "  That workspace is no longer listed.", `${sz.cols}x${sz.rows}`);
    assert.equal(d.cells[3].some((cell) => cell.style.dim), false, "something that happened: not dim");
    assert.equal(d.lines[4].startsWith(">   acme-platform"), true, `${sz.cols}x${sz.rows}: the choices follow, the first selected, none marked open: ${d.lines[4]}`);
    assert.equal(d.lines[sz.rows - 1], sz.cols >= 67 ? `${LEAD}Enter open   / filter   r refresh   ? help   q quit` : `${LEAD}Enter open   / filter   ? help   q quit`, "nothing is open: no Esc");
  }
  // More choices than the pane has rows: the line keeps its row, the pane's last row says what is
  // cut off, and every choice comes on the screen as the selection walks down.
  const names = Array.from({ length: 30 }, (_, i) => `acme-${String(i).padStart(2, "0")}`), sz = size(80, 15);
  let state = reduce(gone, { offered: { offered: names.map(folder), limited: false } }).state;
  const seen = new Set();
  for (let i = 0; i < 31; i++) {
    const d = draw(state, sz), body = d.lines.slice(3, 14), at = `after ${i} down`;
    assert.equal(body[0], "  That workspace is no longer listed.", at);
    const selected = body.filter((line) => line.startsWith(">"));
    assert.equal(selected.length, 1, `${at}: the selected choice is on the screen`);
    assert.equal(selected[0].includes(i === 0 ? "acme-platform" : names[i - 1]), true, `${at}: ${selected[0]}`);
    const cut = /^ {2}(?:(\d+) more above)?(?:, )?(?:(\d+) more below)?$/.exec(body[10]);
    assert.notEqual(cut, null, `${at}: the last row, the one above the footer, says what is cut off: ${body[10]}`);
    const shown_ = body.slice(1, 10).filter(Boolean);
    assert.equal(shown_.length, 9, `${at}: the nine rows between hold choices and their heading`);
    assert.equal(Number(cut[1] ?? 0) + Number(cut[2] ?? 0) + shown_.length, 32, `${at}: 31 choices and one heading, none lost`);
    for (const line of shown_) seen.add(line.trim().replace(/^> +/, "").split(" ")[0]);
    state = press(state, ["j"], sz).state;
  }
  for (const name of ["acme-platform", ...names]) assert.equal(seen.has(name), true, `${name} was on the screen`);
  // Picking a choice, or leaving the line behind with a key that opens something, clears it.
  assert.equal(draw(press(gone, ["enter", "w"]).state, S80).lines.some((line) => line.includes("no longer listed")), false);
});

test("a folder that turned out not to be a deployment says so in its row, where its path stood, and `~/Agents` holding more than was read says so under the folders", () => {
  assert.equal(MORE_FOLDERS, "More folders than are listed here.");
  const state = reduce(press(reached(), ["w"]).state, { offered: { ...OFFERED, limited: true } }).state;
  const refused = reduce(press(state, ["j"]).state, { refused: "/home/u/Agents/acme-billing" }).state;
  for (const ascii of [false, true]) for (const [sz, place] of [[S80, 32], [S120, 46], [S79, 32], [S60, 26]]) {
    const d = draw({ ...refused, ascii }, sz), at = `${sz.cols}x${sz.rows}${ascii ? " ascii" : ""}`;
    assert.deepEqual(d.lines.slice(4, 8), [
      "  On this machine, not opened",
      placed([0, ">"], [4, "acme-billing"], [place, "Not an OATS deployment any more."]),
      placed([4, "acme-docs"], [place, "~/Agents/acme-docs"]),
      "    More folders than are listed here.",
    ], at);
    assert.equal(d.cells[6][place].style, DIM, `${at}: a path is dim`);
    for (const cell of d.cells[7].filter((c) => c.text !== " ")) assert.equal(cell.style, DIM, `${at}: so is the line about more folders`);
    fits(d, sz, at);
  }
  // Not dim where it is not selected either: it is what happened to the pick.
  const moved = draw(press(refused, ["j"]).state, S80);
  assert.equal(moved.lines[5], placed([4, "acme-billing"], [32, "Not an OATS deployment any more."]));
  assert.equal(moved.cells[5][32].style.dim || moved.cells[5][32].style.reverse, false);
  // Before the pick, and without the limit, neither line is there.
  const plain = draw(reduce(press(reached(), ["w"]).state, { offered: OFFERED }).state, S80);
  assert.equal(plain.lines.some((line) => line.includes("Not an OATS deployment") || line.includes("More folders")), false);
});

// ── The help, with machines and the switcher ─────────────────────────────────────────────────────

test("the help says every limit of this version: adding, checking and removing a machine and opening a deployment elsewhere with the oats command that does it, and what no command lifts in sentences of its own", () => {
  for (const ascii of [false, true]) for (const sz of [HELP_SIZE, size(60, 160), size(79, 150), size(200, 130)]) {
    const text = helpLines(reached({ ascii }), sz).map((line) => line.trim()), at = `${sz.cols}x${sz.rows}${ascii ? " ascii" : ""}`;
    const machines = text.indexOf("Machines"), last = text.indexOf("Not in this version");
    assert.equal(machines > text.indexOf("Views") && last > machines, true, `${at}: Machines stands between Views and what is not in this version`);
    // The sentences, each whole when its rows are joined, in order, and nothing else in the section.
    assert.equal(text.slice(machines + 1, last).filter(Boolean).join(" "), MACHINES.join(" "), at);
    const section = text.slice(last + 1);
    for (const [what, command] of [["add a machine to this workspace", "oats server connect <id> --ssh <alias>"], ["check a machine", "oats server check <id>"], ["remove a machine", "oats server remove <id>"], ["open a deployment outside ~/Agents", "oats tui --dir <path>"]]) {
      const row = section.findIndex((line) => line === what || line.startsWith(`${what} `));
      assert.equal(row >= 0 && (pair([section[row]], what, command) || section[row + 1] === command), true, `${at}: ${what}: ${command}`);
    }
    // It no longer says the TUI cannot read another machine.
    assert.equal(text.some((line) => line.includes("oats server roster") || /^other machines\b/.test(line)), false, at);
    assert.equal(text.find((line) => line.startsWith("1 Instances")).includes("on this machine"), false, `${at}: the Instances view is the open workspace's, not this machine's alone`);
  }
  // The three limits no command lifts, as the spec lists them: whose time a machine's rows carry,
  // that nothing is kept on disk, and whose Souls and Capabilities will be shown.
  assert.equal(MACHINES.length, 3);
  assert.match(MACHINES[0], /machine's rows are what it reported at the time on its heading/);
  assert.match(MACHINES[0], /in a view of one machine, in the header/);
  assert.match(MACHINES[1], /Nothing is kept on disk: a machine not reached in this run is listed by its own name/);
  assert.match(MACHINES[2], /Souls and Capabilities, when they come, are this machine's/);
  assert.equal(NOT_YET.some((entry_) => entry_.command === "oats server roster" || entry_.what === "other machines"), false);
  // The mark of the open workspace is listed with the others.
  for (const ascii of [false, true]) assert.equal(helpLines(reached({ ascii })).some((line) => line.trim().startsWith(`${OPEN_MARK}  `) && line.includes("workspaces")), true);
});

test("the help over the switcher keeps the switcher's header and has the help's own footer, and closing it returns to the switcher", () => {
  for (const sz of SIZES) {
    const under = choosing(), helping = press(under, ["?"], sz).state, d = draw(helping, sz), at = `${sz.cols}x${sz.rows}`;
    assert.equal(d.lines[0], " workspaces", `${at}: no workspace is named, nothing is counted`);
    assert.equal(d.lines[1], "  Instances   Souls   Capabilities", `${at}: and no time`);
    assert.equal(d.cells[1].some((cell) => cell.style.reverse), false, `${at}: none of the three views is the open one`);
    for (const cell of d.cells[1].slice(14).filter((c) => c.text !== " ")) assert.equal(cell.style, PLAIN, `${at}: Souls and Capabilities are plain, not dim`);
    assert.equal(d.lines[3].trim(), "Keys", at);
    assert.equal(d.lines[sz.rows - 1], `${LEAD}Esc close   ? help   q quit`, at);
    for (const key of ["escape", "?"]) assert.deepEqual(draw(press(helping, [key], sz).state, sz).lines, draw(under, sz).lines, `${at}: ${key} returns to the switcher`);
    // Over the list the header is the workspace's, and the help is the same help.
    const over = draw(press(reached(), ["?"], sz).state, sz);
    assert.equal(over.lines[0].startsWith(" acme-platform  "), true, at);
    assert.equal(over.lines[sz.rows - 1], `${LEAD}Esc close   ? help   q quit`, at);
    assert.deepEqual(over.lines.slice(2, sz.rows - 1), d.lines.slice(2, sz.rows - 1), `${at}: the same rows under both headers`);
    assert.deepEqual([over.cells[1][1].style.reverse, over.cells[1][1].style.dim], [true, false], `${at}: over the list, Instances is the open view`);
  }
  // With nothing open, the help still opens and closes over the switcher.
  const none = stateOf(null, { deployment: null }), helping = press(none, ["?"]).state;
  assert.equal(draw(helping, S80).lines[0], " workspaces");
  assert.deepEqual(draw(press(helping, ["escape"]).state, S80).lines, draw(none, S80).lines);
});

// ── The header's words for other machines ────────────────────────────────────────────────────────
// What follows the workspace's name says where the view's deployments are: `+N machine(s)` beside
// a deployment of this machine, `on <machine>` for the one machine of a view that holds none of
// this machine's, `N machines` for two or more of them. Whether a deployment is this machine's is
// the shared entries' `local`; each state here is a roster outcome taken by the store, and a view
// of machines alone is opened from the switcher.
/** The second choice of the switcher, opened with the keys a person has. */
const second = (state) => press(state, ["w", "j", "enter"]).state;
/** garnet alone in another workspace's view, and garnet and quartz together in it. */
const onGarnet = (extra = {}, key = ELSEWHERE.key, options) => second(heard(local(options), answered(group({ workspace: { ...IDENTITY, key }, ...extra })), T1));
const onBoth = (key = ELSEWHERE.key) => second(heard(local(), answered(group({ workspace: { ...IDENTITY, key } }), quartz({ workspace: { ...IDENTITY, key } })), T1));
/** What the model says of a view's machines, as the frame is given it. */
const machinesOf = (state) => { const d = draw(state, S80), m = model(state, { page: d.page, now: NOW, at: AT, cols: d.cols }); return { here: m.here, machines: m.machines, machine: m.machine }; };
const LONG_MACHINE = "garnet-machine-of-the-ledger-team-in-the-far-rack-number-0007", LONG_KEY = "github.com/acme/billing-of-the-ledger-team-and-friends", LONG_WORKSPACE = LONG_KEY.split("/").at(-1);

test("a view that holds a deployment of this machine and other machines says `+N machine(s)` after the workspace's name", () => {
  const one = reached(), two = heard(local(), answered(group(), quartz()), T1);
  assert.deepEqual(machinesOf(one), { here: true, machines: 1, machine: null });
  assert.deepEqual(machinesOf(two), { here: true, machines: 2, machine: null });
  assert.equal(draw(one, S80).lines[0], placed([1, "acme-platform"], [16, "+1 machine"], [59, "3 running  2 stopped"]));
  assert.equal(draw(two, S80).lines[0], placed([1, "acme-platform"], [16, "+2 machines"], [59, "4 running  2 stopped"]));
  assert.deepEqual(panelOf(one, AT).deployments.map((d) => d.local), [true, false], "this machine's deployment and the machine's, by the shared entries' own word");
  for (const cell of draw(two, S80).cells[0].slice(16, 27)) assert.equal(cell.style, DIM);
  assert.deepEqual(machinesOf(local()), { here: true, machines: 0, machine: null }, "this machine alone: nothing follows the name");
  assert.equal(draw(local(), S80).lines[0], placed([1, "acme-platform"], [59, "2 running  1 stopped"]));
});

test("a view that holds no deployment of this machine and one machine says `on <machine>` after the workspace's name: nothing else names the machine, since such a view has no heading", () => {
  const state = onGarnet();
  assert.equal(state.open, GARNET);
  assert.deepEqual(machinesOf(state), { here: false, machines: 1, machine: "garnet" });
  assert.deepEqual(panelOf(state, AT).deployments.map((d) => [d.local, d.machine]), [[false, "garnet"]], "one deployment, not this machine's, named by the shared entry");
  const d = draw(state, S80);
  assert.equal(d.lines[0], placed([1, "billing"], [10, "on garnet"], [59, "1 running  1 stopped"]));
  for (const cell of d.cells[0].slice(10, 19).filter((c) => c.text !== " ")) assert.equal(cell.style, DIM, "the TUI's `on` and the machine's name are dim");
  assert.equal(d.cells[0][1].style.dim, false, "the workspace's name is not");
  assert.equal(listLines(d, S80).some((line) => line.startsWith(" garnet")), false, "no heading names it");
  // The same for a run started outside every deployment that picked a machine's workspace.
  const outside = press(heard(stateOf(null, { deployment: null, cli: REMOTE_CLI }), answered(group()), T1), ["enter"]).state;
  assert.equal(outside.open, GARNET);
  assert.deepEqual(machinesOf(outside), { here: false, machines: 1, machine: "garnet" });
  assert.equal(draw(outside, S80).lines[0], placed([1, "platform"], [11, "on garnet"], [59, "1 running  1 stopped"]));
});

test("a view that holds no deployment of this machine and two or more machines says `N machines` after the workspace's name, without the plus", () => {
  const state = onBoth();
  assert.deepEqual(machinesOf(state), { here: false, machines: 2, machine: null });
  assert.deepEqual(panelOf(state, AT).deployments.map((d) => [d.local, d.machine]), [[false, "garnet"], [false, "quartz"]]);
  const d = draw(state, S80);
  assert.equal(d.lines[0], placed([1, "billing"], [10, "2 machines"], [59, "2 running  1 stopped"]));
  for (const cell of d.cells[0].slice(10, 20).filter((c) => c.text !== " ")) assert.equal(cell.style, DIM);
  // Two deployments of one machine are one machine: it is named.
  const twice = second(heard(local(), answered(group({ workspace: ELSEWHERE }), group({ id: "garnet:acme-2", target: { workspace: "/home/dev/Agents/acme-two", sshHost: "garnet.example" }, workspace: ELSEWHERE, instances: [] })), T1));
  assert.deepEqual(machinesOf(twice), { here: false, machines: 1, machine: "garnet" });
  assert.equal(draw(twice, S80).lines[0].startsWith(" billing  on garnet  "), true, draw(twice, S80).lines[0]);
});

test("the header never says `+N` when no deployment of the view is this machine's, at 80 and at 60 columns", () => {
  const states = {
    "one machine": onGarnet(), "one machine, not reached": heard(onGarnet(), TIMEOUT, T2), "one machine with a long name": onGarnet({ label: LONG_MACHINE }),
    "two machines": onBoth(), "two machines, not reached": heard(onBoth(), { thrown: "spawn oats ENOENT" }, T2), "two machines in a workspace with a long name": onBoth(LONG_KEY),
  };
  for (const [name, state] of Object.entries(states)) for (const ascii of [false, true]) for (const sz of [S80, S60]) {
    const d = draw({ ...state, ascii }, sz), at = `${name} at ${sz.cols}x${sz.rows}${ascii ? " ascii" : ""}`;
    assert.equal(machinesOf(state).here, false, at);
    assert.equal(d.lines[0].includes("+"), false, `${at}: ${d.lines[0]}`);
    assert.match(d.lines[0], name.startsWith("one") ? /^ billing {2}on garnet/ : / \d machines {2}/, at);
    fits(d, sz, at);
  }
  // And with one of this machine's in the view it always does, where the count is drawn at all.
  for (const sz of [S80, S60]) assert.match(draw(reached(), sz).lines[0], /^ acme-platform {2}\+1 machine {2}/);
});

test("at 60 columns the workspace's name is cut before the counts give way, and what follows the name is given up when it would leave the name fewer than eight cells, or fewer than its own width when it is shorter", () => {
  // A long name beside `+1 machine` and beside `2 machines`: cut with the mark, every count still there.
  const named = heard(stateOf(reporting(NEAR(), { workspace: "acme-platform-of-the-ledger-team-and-friends" }), { cli: REMOTE_CLI }), answered(group()), T1);
  assert.equal(draw(named, S60).lines[0], placed([1, "acme-platform-of-the-le…"], [27, "+1 machine"], [39, "3 running  2 stopped"]));
  assert.equal(draw(onBoth(LONG_KEY), S60).lines[0], placed([1, `${LONG_WORKSPACE.slice(0, 23)}…`], [27, "2 machines"], [39, "2 running  1 stopped"]));
  assert.equal(draw(onGarnet({}, LONG_KEY), S60).lines[0], placed([1, `${LONG_WORKSPACE.slice(0, 24)}…`], [28, "on garnet"], [39, "1 running  1 stopped"]));
  // Wider counts leave the name and what follows it 19 cells: a name of three cells keeps its
  // `+1 machine`, a name of eight or more would be left seven and stands alone. (The header has no
  // title: counts of a hundred of each state take the cells the title took, so the name has as
  // few as it had beside ten of each.)
  const crowd = () => ["running", "stopped", "unknown"].flatMap((word, k) => Array.from({ length: 100 }, (_, i) => instanceRow("soul", `${word}-${i}`, k === 0 ? {} : k === 1 ? { running: false, runtimeState: "stopped" } : { running: null, runtimeState: "unreachable" })));
  const crowded = (workspace) => draw(heard(stateOf(reporting(crowd(), { workspace }), { cli: REMOTE_CLI }), answered(group({ instances: [] })), T1), S60).lines[0];
  const COUNTED = "100 running  100 stopped  100 unknown";
  assert.equal(crowded("eng"), placed([1, "eng"], [6, "+1 machine"], [59 - COUNTED.length, COUNTED]), "a short name is whole, and the count of machines stays");
  for (const workspace of ["acmeplat", "acme-plat", "acme-platform"]) assert.equal(crowded(workspace), placed([1, workspace], [59 - COUNTED.length, COUNTED]), `${workspace}: the name stands alone, whole`);
  // The same for `on <machine>`: with 19 cells, a long name is cut to eight beside `on garnet`, and
  // beside a machine whose own name would be left fewer than eight cells (or than its own width)
  // nothing follows the workspace's name. A hundred rows of each state, for the same reason.
  const three = [[FAR_A, {}], [FAR_B, { running: false, runtimeState: "stopped" }], ["acme-ledger-far-c", { running: null, runtimeState: "unreachable", runtimeError: UNREACHABLE }]].flatMap(([name, extra]) => Array.from({ length: 100 }, (_, i) => farRow(`${name}-${i}`, extra)));
  const THREE = "100 running  100 stopped  100 unknown", header = (label, key) => draw(onGarnet({ label, instances: three }, key), S60).lines[0];
  assert.equal(header("garnet", ELSEWHERE.key), placed([1, "billing"], [10, "on garnet"], [59 - THREE.length, THREE]));
  assert.equal(header("garnet", LONG_KEY), placed([1, `${LONG_WORKSPACE.slice(0, 7)}…`], [11, "on garnet"], [59 - THREE.length, THREE]));
  assert.equal(header("garnet-", LONG_KEY), placed([1, `${LONG_WORKSPACE.slice(0, 18)}…`], [59 - THREE.length, THREE]), "seven cells of machine do not fit beside eight of the name: the name has the room");
  assert.equal(header(LONG_MACHINE, LONG_KEY), placed([1, `${LONG_WORKSPACE.slice(0, 18)}…`], [59 - THREE.length, THREE]));
  assert.equal(header(LONG_MACHINE, ELSEWHERE.key), placed([1, "billing"], [59 - THREE.length, THREE]));
  // The counts the TUI adds never give way to any of it.
  for (const line of [crowded("eng"), crowded("acme-platform"), header(LONG_MACHINE, LONG_KEY)]) assert.equal(textWidth(line), 59, line);
});

test("in `on <machine>` a long machine name is cut before the workspace's name is", () => {
  // A workspace's name of seven cells is whole beside a machine's name cut with the mark.
  assert.equal(draw(onGarnet({ label: LONG_MACHINE }), S60).lines[0], placed([1, "billing"], [10, `on ${LONG_MACHINE.slice(0, 23)}…`], [39, "1 running  1 stopped"]));
  assert.equal(draw(onGarnet({ label: LONG_MACHINE }), S80).lines[0], placed([1, "billing"], [10, `on ${LONG_MACHINE.slice(0, 43)}…`], [59, "1 running  1 stopped"]));
  // A workspace's name of twelve cells has the room to be whole too, at 60 columns and at 80: it is
  // the machine's name that gives its cells up.
  const KEY = "github.com/acme/acme-billing";
  assert.equal(draw(onGarnet({ label: LONG_MACHINE }, KEY), S60).lines[0], placed([1, "acme-billing"], [15, `on ${LONG_MACHINE.slice(0, 18)}…`], [39, "1 running  1 stopped"]));
  assert.equal(draw(onGarnet({ label: LONG_MACHINE }, KEY), S80).lines[0], placed([1, "acme-billing"], [15, `on ${LONG_MACHINE.slice(0, 38)}…`], [59, "1 running  1 stopped"]));
});

test("a view whose only deployment is a machine that is not live and has no row kept is drawn as an unavailable deployment is: its state, its reason on rows of its own, and no panes, no rule under them and no line about instances", () => {
  const state = heard(onGarnet({ instances: [] }), TIMEOUT, T2), said = deploymentState(deploymentOf(state));
  assert.equal(state.open, GARNET);
  assert.equal(said.key !== "live" && panelOf(state, AT).instances.length === 0, true);
  for (const ascii of [false, true]) for (const sz of SIZES) {
    const d = draw({ ...state, ascii }, sz), g = glyphsOf(ascii), at = `${sz.cols}x${sz.rows}${ascii ? " ascii" : ""}`;
    const reason = reasonRows(d, textOf(shown(said.detail)), g.cut);
    assert.equal(cellText(d, 0), " billing  on garnet", `${at}: the header names the machine and counts nothing`);
    assert.equal(d.lines[1], "  Instances   Souls   Capabilities", `${at}: no time: nothing was read`);
    assert.equal(cellText(d, 3).trim(), said.text, `${at}: the state in the shared home's word`);
    assert.equal(reason.whole && reason.rows[0] === 4, true, `${at}: its reason, whole, on the rows under it`);
    assert.deepEqual(d.lines.slice(reason.rows.at(-1) + 1, sz.rows - 1).filter(Boolean), [], `${at}: and nothing else down to the footer: no rule, no line that says no instance is listed`);
    assert.equal(d.lines[2], g.rule.repeat(sz.cols), `${at}: one pane: no joint in the rule under the header`);
    assert.equal(d.lines.some((line) => line.includes(EMPTY_TEXT.none) || line.includes(g.bar)), false, at);
    fits(d, sz, at);
  }
  // Reached with no row it is a deployment that was read: the list says it holds no instance.
  const live = draw(onGarnet({ instances: [] }), S80);
  assert.deepEqual(listLines(live, S80).filter(Boolean), [`   ${EMPTY_TEXT.none}`]);
  assert.equal(live.lines[1].endsWith(" read 10:00:10"), true);
  // And with rows kept, the notice stands over the last rows it reported.
  const kept = draw(heard(onGarnet(), TIMEOUT, T2), S80);
  assert.equal(kept.lines.some((line) => line.includes(FAR_A)), true);
});

// ── The footer while Enter would open an agent's terminal ───────────────────────────────────────────

const openable = (options) => stateOf(observed([instanceRow("dev", "dev-alpha"), instanceRow("dev", "dev-beta", { running: false, runtimeState: "stopped" })]), options);

test("the footer names Enter open whenever Enter would open, whatever the kernel: after the leader, hints are given up retire, stop, workspaces, refresh, Esc, detail, open, filter; help and quit never (the width table)", () => {
  const state = openable(), stopped = press(state, ["j"]).state, detailed = press(state, ["tab"]).state, kept = press(state, ["/", "d", "enter"]).state;
  // The fixture's kernel has no session-start: the acts its rows offer are stop and retire. They
  // stand after `open` and are given up first, `retire` before `stop`, then `workspaces`. The
  // leader stands first at every width, and no hint names the views. A kept filter shows its own
  // `/`: there the open hint outlives `/ filter`, and the filter's place gives way to it.
  const TABLE = [
    // cols  an openable row selected   the detail focused   a row Enter does not open   a kept filter
    [60, "Enter open   / filter", "Enter open   Tab detail", "/ filter   Tab detail", "/d              Enter open"],
    [65, "Enter open   / filter", "Enter open   Tab detail", "/ filter   Tab detail", "/d                   Enter open"],
    [67, "Enter open   / filter", "Enter open   Tab detail", "/ filter   Tab detail   r refresh", "/d                     Enter open"],
    [68, "Enter open   / filter   Tab detail", "Enter open   Tab detail", "/ filter   Tab detail   r refresh", "/d                      Enter open"],
    [69, "Enter open   / filter   Tab detail", "Enter open   Tab detail   Esc close", "/ filter   Tab detail   r refresh", "/d                      Enter open"],
    [79, "Enter open   / filter   Tab detail", "Enter open   Tab detail   Esc close", "/ filter   Tab detail   r refresh", "/d                      Enter open   / filter"],
    [80, "Enter open   / filter   Tab detail   r refresh", "Enter open   Tab detail   Esc close", "/ filter   Tab detail   r refresh", "/d                      Enter open   / filter"],
    [81, "Enter open   / filter   Tab detail   r refresh", "Enter open   Tab detail   Esc close   r refresh", "/ filter   Tab detail   r refresh", "/d                      Enter open   / filter"],
    [82, "Enter open   / filter   Tab detail   r refresh", "Enter open   Tab detail   Esc close   r refresh", "/ filter   Tab detail   r refresh   w workspaces", "/d                      Enter open   / filter"],
    [90, "Enter open   / filter   Tab detail   r refresh", "Enter open   X stop   Tab detail   Esc close   r refresh", "/ filter   Tab detail   r refresh   w workspaces", "/d                      Enter open   / filter"],
    [91, "Enter open   / filter   Tab detail   r refresh", "Enter open   X stop   Tab detail   Esc close   r refresh", "X stop   / filter   Tab detail   r refresh   w workspaces", "/d                      Enter open   / filter"],
    [92, "Enter open   / filter   Tab detail   r refresh", "Enter open   X stop   Tab detail   Esc close   r refresh", "X stop   / filter   Tab detail   r refresh   w workspaces", "/d                      Enter open   / filter   Tab detail"],
    [95, "Enter open   / filter   Tab detail   r refresh   w workspaces", "Enter open   X stop   Tab detail   Esc close   r refresh", "X stop   / filter   Tab detail   r refresh   w workspaces", "/d                      Enter open   / filter   Tab detail"],
    [101, "Enter open   / filter   Tab detail   r refresh   w workspaces", "Enter open   X stop   D retire   Tab detail   Esc close   r refresh", "X stop   / filter   Tab detail   r refresh   w workspaces", "/d                      Enter open   / filter   Tab detail"],
    [102, "Enter open   / filter   Tab detail   r refresh   w workspaces", "Enter open   X stop   D retire   Tab detail   Esc close   r refresh", "X stop   D retire   / filter   Tab detail   r refresh   w workspaces", "/d                      Enter open   / filter   Tab detail"],
    [104, "Enter open   X stop   / filter   Tab detail   r refresh   w workspaces", "Enter open   X stop   D retire   Tab detail   Esc close   r refresh", "X stop   D retire   / filter   Tab detail   r refresh   w workspaces", "/d                      Enter open   / filter   Tab detail   Esc close"],
    [115, "Enter open   X stop   D retire   / filter   Tab detail   r refresh   w workspaces", "Enter open   X stop   D retire   Tab detail   Esc close   r refresh", "X stop   D retire   / filter   Tab detail   r refresh   w workspaces", "/d                      Enter open   / filter   Tab detail   Esc close"],
    [116, "Enter open   X stop   D retire   / filter   Tab detail   r refresh   w workspaces", "Enter open   X stop   D retire   Tab detail   Esc close   r refresh", "X stop   D retire   / filter   Tab detail   r refresh   w workspaces", "/d                      Enter open   / filter   Tab detail   Esc close   r refresh"],
    [130, "Enter open   X stop   D retire   / filter   Tab detail   r refresh   w workspaces", "Enter open   X stop   D retire   Tab detail   Esc close   r refresh", "X stop   D retire   / filter   Tab detail   r refresh   w workspaces", "/d                      Enter open   / filter   Tab detail   Esc close   r refresh"],
    [131, "Enter open   X stop   D retire   / filter   Tab detail   r refresh   w workspaces", "Enter open   X stop   D retire   Tab detail   Esc close   r refresh", "X stop   D retire   / filter   Tab detail   r refresh   w workspaces", "/d                      Enter open   / filter   Tab detail   Esc close   r refresh   w workspaces"],
    [139, "Enter open   X stop   D retire   / filter   Tab detail   r refresh   w workspaces", "Enter open   X stop   D retire   Tab detail   Esc close   r refresh", "X stop   D retire   / filter   Tab detail   r refresh   w workspaces", "/d                      Enter open   / filter   Tab detail   Esc close   r refresh   w workspaces"],
    [140, "Enter open   X stop   D retire   / filter   Tab detail   r refresh   w workspaces", "Enter open   X stop   D retire   Tab detail   Esc close   r refresh", "X stop   D retire   / filter   Tab detail   r refresh   w workspaces", "/d                      Enter open   X stop   / filter   Tab detail   Esc close   r refresh   w workspaces"],
    [150, "Enter open   X stop   D retire   / filter   Tab detail   r refresh   w workspaces", "Enter open   X stop   D retire   Tab detail   Esc close   r refresh", "X stop   D retire   / filter   Tab detail   r refresh   w workspaces", "/d                      Enter open   X stop   / filter   Tab detail   Esc close   r refresh   w workspaces"],
    [151, "Enter open   X stop   D retire   / filter   Tab detail   r refresh   w workspaces", "Enter open   X stop   D retire   Tab detail   Esc close   r refresh", "X stop   D retire   / filter   Tab detail   r refresh   w workspaces", "/d                      Enter open   X stop   D retire   / filter   Tab detail   Esc close   r refresh   w workspaces"],
  ];
  for (const [cols, list, detail, other, filtered] of TABLE) {
    const sz = size(cols, 24), foot = (s) => draw(s, sz).lines[23];
    assert.equal(foot(state), `${LEAD}${list}   ? help   q quit`, `${cols}: the list`);
    assert.equal(foot(detailed), `${LEAD}${detail}   ? help   q quit`, `${cols}: the detail`);
    assert.equal(foot(stopped), `${LEAD}${other}   ? help   q quit`, `${cols}: a row Enter does not open`);
    assert.equal(foot(kept), `${LEAD}${filtered}   ? help   q quit`, `${cols}: a kept filter`);
  }
  // The hint's key is the effective table's; the leader is tui.json's open.detachKey and stands
  // first, by its own key (here F12), not beside open.
  const config = effectiveConfig({ keys: { open: ["o"] }, open: { detachKey: "F12" } });
  assert.equal(draw(openable({ actions: config.actions, detachKey: config.detachKey }), S80).lines[23], "F12 commands   o open   / filter   Tab detail   r refresh   ? help   q quit");
  assert.equal(draw(openable({ actions: effectiveConfig({ keys: { open: [] } }).actions }), S80).lines[23], `${LEAD}/ filter   Tab detail   r refresh   ? help   q quit`, "an open with no key has no hint (and at 80 columns the acts and `workspaces` are given up)");
});

test("no footer hint names the views, whatever keys tui.json gives them: the header names them, and the footer is the same with the views rebound, unbound or not; the acts are given up before `workspaces`", () => {
  const drawn = (keys, sz = S120) => draw(openable({ actions: effectiveConfig({ keys }).actions }), sz);
  const foot = (keys, sz = S120) => drawn(keys, sz).lines[sz.rows - 1];
  for (const keys of [{}, { capabilities: ["f3"] }, { instances: [] }, { instances: [], souls: [], capabilities: [] }]) {
    assert.equal(foot(keys), FOOTER_120, JSON.stringify(keys));
    assert.doesNotMatch(foot(keys), /views|Instances|Souls|Capabilities|\b[123]\b|F3/, JSON.stringify(keys));
    assert.equal(cellText(drawn(keys), 1, 0, 40), "  Instances   Souls   Capabilities", `${JSON.stringify(keys)}: the header names the views`);
  }
  // A row whose acts are stop and retire, at 80 columns: the acts are given up first, then `workspaces`.
  assert.equal(draw(press(openable(), ["j"]).state, S80).lines[23], `${LEAD}/ filter   Tab detail   r refresh   ? help   q quit`);
});

test("while another machine is asked first the footer says Esc gives the open up, where the open hint stood and given up when it would be, and Esc is not listed twice", () => {
  const preflight = Object.freeze({ ...openable(), opening: Object.freeze({ id: "x", phase: "preflight", name: "dev-alpha", machine: "garnet", routed: true }) });
  assert.equal(draw(preflight, S80).lines[23], `${LEAD}Esc stop opening   / filter   Tab detail   ? help   q quit`);
  assert.equal(draw(preflight, S120).lines[39], `${LEAD}Esc stop opening   / filter   Tab detail   r refresh   w workspaces   ? help   q quit`);
  // At 60 columns the leader leaves its 16 cells no room beside `/ filter`, help and quit: it is
  // given up as `open` is, before `/ filter`.
  assert.equal(draw(preflight, S60).lines[14], `${LEAD}/ filter   ? help   q quit`);
  assert.equal(draw(Object.freeze({ ...preflight, filter: Object.freeze({ editing: false, query: "d" }) }), S120).lines[39].includes("Esc close"), false);
});

test("the help lists Enter once per view with what it does there, the keys of the open terminal and the digits of the views, under the agent's line the leader twice, what the terminal takes and where the keys are listed, and the leader's own section with every key of its table", () => {
  const lines = helpLines(openable()).map((line) => line.trim());
  const text = lines.join(" ").replace(/ +/g, " ");
  assert.equal(text.includes("Enter open the selected agent's terminal beside the list, or go to it when it is the open one, in the list of instances C-\\ C-\\ takes the focus from the terminal back to the list; the agent keeps running. While the terminal has the focus every other key goes to the agent, Ctrl+C and Ctrl+Z too. One terminal is open at a time. It has no scrollback but the viewer's own, and no mouse. docs/tui.md has the keys that can be the leader."), true, text);
  assert.equal(text.includes("z go to the open terminal with the whole screen; the leader twice brings the list back"), true);
  assert.equal(text.includes("c close the open terminal; the agent keeps running"), true);
  assert.equal(pair(lines, "Enter", "open the selected workspace, in the switcher"), true);
  assert.equal(pair(lines, "Enter", "show the selected soul's detail, and from the detail its instances, in the Souls view"), true);
  assert.equal(lines.filter((line) => line.startsWith("Enter ")).length, 3, "Enter three times, once per view");
  for (const [key, label] of [["1", "instances"], ["2", "souls"], ["3", "capabilities"]]) assert.equal(pair(lines, key, label), true, key);
  assert.equal(lines.some((line) => line.includes("open an agent in its own tmux window") && line.includes("oats session attach --home <home>")), true);
  // The leader's section, after the keys and before the marks: the leader, then each key of its
  // table (actions.mjs LEADER) and what it does, from every focus.
  const leader = lines.slice(lines.indexOf("The leader") + 1, lines.indexOf("Marks")).filter(Boolean);
  assert.equal(lines.indexOf("The leader") > lines.indexOf("Keys") && lines.indexOf("The leader") < lines.indexOf("Marks"), true, "between the keys and the marks");
  assert.deepEqual(leader.map((line) => line.replace(/ {2,}/g, "  ")), [
    "C-\\ then one of these keys, from every focus; a terminal too:",
    "k, Space  palette", "1  instances", "2  souls", "3  capabilities", "Up  previous instance", "Down  next instance",
    "z  zoom, while a terminal is open", "w  close terminal, while a terminal is open",
    "X  stop", "R  restart", "S  start", "D  retire", "/  filter", "o  workspaces", "?  help",
    "Esc  the list; the leader again does the same",
  ]);
  // The leader is tui.json's, text from outside: the help names it, and twice under the agent's line.
  const rebound = helpLines(openable({ detachKey: "F12" })).map((line) => line.trim());
  assert.equal(rebound.join(" ").replace(/ +/g, " ").includes("F12 F12 takes the focus from the terminal back to the list"), true);
  assert.equal(rebound.includes("F12 then one of these keys, from every focus; a terminal too:"), true);
});

test("a tui.json that unbinds open, or close, is drawn with a kept filter: the hint that has no key is not there, and nothing else moves (round 1 of the review)", () => {
  const noOpen = effectiveConfig({ keys: { open: [] } }).actions, noClose = effectiveConfig({ keys: { close: [] } }).actions;
  for (const sz of [S60, S80, S120]) {
    const kept = press(openable({ actions: noOpen }), ["/", "d", "enter"], sz).state;
    assert.equal(kept.filter.query, "d");
    const foot = draw(kept, sz).lines[sz.rows - 1];
    assert.match(foot, /^C-\\ commands {3}\/d +\S/, `${sz.cols}: the kept filter, after the leader`);
    assert.equal(/\bopen\b/.test(foot), false, `${sz.cols}: no open hint without a key`);
    assert.match(foot, /\? help   q quit$/, `${sz.cols}`);
    // While another machine is asked first, Esc's hint stands first; with no key for close there is none.
    const preflight = Object.freeze({ ...openable({ actions: noClose }), filter: Object.freeze({ editing: false, query: "d" }), opening: Object.freeze({ id: "x", phase: "preflight", name: "dev-alpha", machine: "garnet", routed: true }) });
    const asked = draw(preflight, sz).lines[sz.rows - 1];
    assert.equal(asked.includes("stop opening"), false, `${sz.cols}: no Esc hint without a key`);
    assert.match(asked, /\? help   q quit$/, `${sz.cols}`);
  }
});

// ── The terminal panel (T1) ───────────────────────────────────────────────────────────────────────

/** Two running agents, dev-a selected, and a key pressed as the loop hands it on. */
const PANEL_STATE = () => { const s = stateOf(observed([instanceRow("dev", "dev-a"), instanceRow("dev", "dev-b")])); return Object.freeze({ ...s, selected: roster(s).rows.find(({ row }) => row.instance === "dev-a").id }); };
const keyed = (state, id) => reduce(state, { key: id, ...(id.length === 1 ? { text: id } : {}), page: 19, extent: 0, room: 19, cols: 38 }).state;
/** dev-a's terminal, open: "focus" (it has the focus), "list" (the leader was typed twice), "zoom" (z
 *  from the list), "detail" (Tab from the list); with `detachKey` as tui.json's. */
function panelIn(how, { detachKey, status = "open" } = {}) {
  let s = keyed(PANEL_STATE(), "enter");
  if (status === "open") s = reduce(s, { shown: { id: s.terminal.id } }).state;
  if (detachKey !== undefined) s = Object.freeze({ ...s, detachKey });
  if (how === "focus") return s;
  s = leaderTwice(s).state;
  return how === "zoom" ? keyed(s, "z") : how === "detail" ? keyed(s, "tab") : s;
}
/** The agent's screen as the panel hands it on: its first row a prompt, its second red text and a
 *  run longer than any panel; the cursor after the prompt. */
const AGENT = (cols, rows, visible = true) => ({ lines: captureRows(`$ hello\n\u001b[31mred\u001b[0m and ${"x".repeat(300)}`, { cols, rows }), cursor: { x: 2, y: 0, visible } });
/** Draw with the agent's screen at the size the frame gives the terminal (as the loop resizes it). */
function drawPanel(state, sz) {
  const t = draw(state, sz).terminal;
  return draw(state, sz, { screen: t ? AGENT(t.cols, t.rows) : null });
}
const footer = (d, sz) => d.lines[sz.rows - 1];
const PANEL_WIDE = [size(80, 24), size(100, 30), S120, size(200, 50)];

test("Enter: the terminal stands beside the list, where the detail was, edge to edge to the right; its top row names the agent, and its screen is placed from the row under it, the agent's colours kept and clipped to the panel", () => {
  for (const sz of PANEL_WIDE) {
    const d = drawPanel(panelIn("focus"), sz), t = d.terminal, at = `${sz.cols}x${sz.rows}`;
    assert.equal(t.col, d.cols + 1, `${at}: after the list and its bar`);
    assert.equal(t.cols, sz.cols - d.cols - 1, `${at}: to the right edge`);
    assert.deepEqual([t.title, t.top, t.whole], [3, 4, false], at);
    assert.equal(t.rows, sz.rows - 5, `${at}: every row of the body but the title, down to the footer`);
    // The list stays on screen, both rows of it.
    for (const name of ["dev-a", "dev-b"]) assert.equal(d.lines.slice(3, sz.rows - 1).some((line) => line.slice(0, d.cols).includes(name)), true, `${at}: ${name} in the list`);
    assert.equal(d.lines[3].slice(t.col).trim(), "dev-a", `${at}: the title names the agent`);
    assert.equal(d.cells[3][t.col + 1].style.bold && d.cells[3][t.col + 1].style.reverse, true, `${at}: the title of a focused terminal is drawn focused`);
    assert.equal(d.lines[4].slice(t.col), "$ hello", at);
    assert.equal(d.lines[5].slice(t.col, t.col + 7), "red and", at);
    assert.notEqual(d.cells[5][t.col].style.fg, null, `${at}: the agent's red`);
    assert.equal(d.cells[5][t.col + 4].style.fg, null, `${at}: the agent's reset`);
    assert.equal(d.lines[5].length, sz.cols, `${at}: the long run is clipped at the right edge`);
    assert.equal(d.lines[5].slice(t.col + 8), "x".repeat(t.cols - 8), at);
  }
});

test("while the terminal has the focus the footer names the leader, and the leader twice back to the list, and nothing else, in every frame: each size, starting or open, zoomed or not, the default key and a rebound one (QA note 2)", () => {
  for (const sz of [S60, S79, S80, S120, size(200, 50)]) {
    for (const detachKey of [undefined, "F12", "M-x", "C-]"]) {
      for (const [how, status] of [["focus", "starting"], ["focus", "open"], ["zoom", "open"]]) {
        const d = drawPanel(panelIn(how, { detachKey, status }), sz);
        const key = detachKey ?? "C-\\";
        assert.equal(footer(d, sz), `${key} commands   ${key} ${key} back to the list`, `${sz.cols}x${sz.rows} ${how} ${status} ${detachKey}`);
      }
    }
  }
});

test("with the list focused and a terminal open, the footer leads, after the leader, with the keys to go to it, zoom it and close it, as many as fit, and Enter's own hint says so on its row", () => {
  assert.equal(footer(drawPanel(panelIn("list"), S120), S120), `${LEAD}Enter focus terminal   z zoom   c close terminal   / filter   Tab detail   r refresh   ? help   q quit`);
  assert.equal(footer(drawPanel(panelIn("list"), S80), S80), `${LEAD}Enter focus terminal   z zoom   / filter   ? help   q quit`, "at 80 columns `close terminal` is given up first, then `zoom`");
  // On another row, Enter opens that one (and closes this).
  const other = Object.freeze({ ...panelIn("list"), selected: roster(PANEL_STATE()).rows.find(({ row }) => row.instance === "dev-b").id });
  assert.match(footer(drawPanel(other, S120), S120), /^C-\\ commands {3}Enter open {3}z zoom {3}c close terminal {3}/);
  // The terminal goes on being drawn beside the list, its title no longer focused.
  const d = drawPanel(panelIn("list"), S120), t = d.terminal;
  assert.equal(d.lines[4].slice(t.col), "$ hello");
  assert.equal(d.cells[3][t.col + 1].style.reverse, false);
  assert.equal(d.cells[3][t.col + 1].style.bold, true);
});

test("zoom gives the terminal the whole body: the header and the footer stay, the list is hidden; the leader twice brings the list back with the panel", () => {
  for (const sz of PANEL_WIDE) {
    const d = drawPanel(panelIn("zoom"), sz), t = d.terminal, at = `${sz.cols}x${sz.rows}`;
    assert.deepEqual([t.col, t.cols, t.top, t.whole], [0, sz.cols, 4, true], at);
    assert.equal(d.lines.some((line) => line.includes("dev-b")), false, `${at}: no list`);
    assert.equal(d.lines[1].trim().startsWith("Instances"), true, `${at}: the header stays`);
    assert.equal(d.lines[2], GLYPHS.utf8.rule.repeat(sz.cols), `${at}: one rule, with no pane bar`);
    const back = drawPanel(leaderTwice(panelIn("zoom")).state, sz);
    assert.equal(back.terminal.whole, false, at);
    assert.equal(back.terminal.col, back.cols + 1, at);
  }
});

test("under 80 columns the terminal is shown zoomed whenever it has the focus, and with the list focused the list is shown alone: the terminal lives on unseen, and the footer names Enter to see it again where the leader leaves it the room", () => {
  for (const sz of [S60, S79, size(70, 30)]) {
    const at = `${sz.cols}x${sz.rows}`;
    for (const how of ["focus", "zoom"]) {
      const t = drawPanel(panelIn(how), sz).terminal;
      assert.deepEqual([t.col, t.cols, t.whole], [0, sz.cols, true], `${at} ${how}`);
    }
    const listed = drawPanel(panelIn("list"), sz);
    assert.equal(listed.terminal, null, at);
    assert.equal(listed.cursor, null, at);
    // At 60 columns `/ filter` outlives it (the list's order), and only the leader's keys reach the terminal.
    assert.equal(footer(listed, sz), `${LEAD}${sz === S60 ? "" : sz === S79 ? "Enter focus terminal   z zoom   " : "Enter focus terminal   "}/ filter   ? help   q quit`, at);
    assert.equal(listed.lines.some((line) => line.includes("$ hello")), false, at);
  }
});

test("beside the list the panel is never narrower than PANEL_MIN (40): at 80 columns and wider the list leaves it at least 41, and narrower terminals show it zoomed", () => {
  assert.equal(PANEL_MIN, 40);
  for (let cols = WIDE; cols <= 240; cols++) {
    const t = drawPanel(panelIn("focus"), size(cols, 24)).terminal;
    assert.equal(t.whole, false, `${cols}`);
    assert.equal(t.cols >= PANEL_MIN + 1, true, `${cols}: ${t.cols}`);
  }
  assert.equal(drawPanel(panelIn("focus"), size(WIDE - 1, 24)).terminal.whole, true);
});

test("with a terminal open the list keeps 30 columns at most, beside the terminal or the detail in its place, and a name longer than its row is cut there with the cut mark; closed, the list has its width again", () => {
  assert.equal(LIST_BESIDE, 30);
  for (const sz of PANEL_WIDE) for (const how of ["focus", "list", "detail"]) {
    const d = drawPanel(panelIn(how), sz), at = `${sz.cols}x${sz.rows} ${how}`;
    assert.equal(d.cols, LIST_BESIDE, at);
    for (const r of bodyRows(sz)) assert.equal(d.cells[r][LIST_BESIDE].text, "│", `${at}: row ${r} has the panes' rule at column 30`);
    if (how === "detail") assert.equal(d.terminal, null, at);
    else assert.deepEqual([d.terminal.col, d.terminal.cols], [LIST_BESIDE + 1, sz.cols - LIST_BESIDE - 1], `${at}: the agent's screen has the rest`);
  }
  const LONG = "dev-z-with-a-name-far-longer-than-the-list-beside-a-terminal";
  for (const ascii of [false, true]) {
    const two = stateOf(observed([instanceRow("dev", "dev-a"), instanceRow("dev", LONG)]), { ascii });
    let s = keyed(Object.freeze({ ...two, selected: roster(two).rows.find(({ row }) => row.instance === "dev-a").id }), "enter");
    s = leaderTwice(reduce(s, { shown: { id: s.terminal.id } }).state).state;
    for (const sz of PANEL_WIDE) {
      const d = drawPanel(s, sz), r = bodyRows(sz).find((row) => cellText(d, row, 0, LIST_BESIDE).includes(LONG.slice(0, 12)));
      const cut = glyphsOf(ascii).cut, room = LIST_BESIDE - 4 - 5;
      assert.equal(cellText(d, r, 0, LIST_BESIDE), `  ${marksOf(ascii).running} ${LONG.slice(0, room - cut.length)}${cut}`, `${sz.cols}${ascii ? " ascii" : ""}: cut inside the 30 columns`);
      // Closed, the list has its own width again, and the name more of its cells.
      const closed = draw(keyed(s, "c"), sz);
      assert.deepEqual([closed.terminal ?? null, closed.cols], [null, listWidth(sz.cols)], `${sz.cols}: closed`);
    }
  }
});

test("Tab from the list with a terminal open shows the detail in the panel's place, until Tab or Esc again", () => {
  for (const sz of [S80, S120]) {
    const d = drawPanel(panelIn("detail"), sz);
    assert.equal(d.terminal, null);
    assert.equal(d.lines.some((line) => line.includes("$ hello")), false);
    assert.equal(d.lines.some((line) => line.includes("worktree")), true, "the detail's rows");
    for (const k of ["tab", "escape"]) assert.notEqual(drawPanel(keyed(panelIn("detail"), k), sz).terminal, null, k);
  }
});

test("close gives the right side back to the detail: the frame is the one with no terminal", () => {
  for (const sz of [S80, S120]) {
    const closed = keyed(panelIn("list"), "c");
    assert.equal(closed.terminal, null);
    assert.deepEqual(drawPanel(closed, sz).lines, draw(PANEL_STATE(), sz).lines);
  }
});

test("the cursor is shown where the agent's is, only while the terminal has the focus and the agent shows one", () => {
  const sz = S120;
  const focused = drawPanel(panelIn("focus"), sz), t = focused.terminal;
  assert.deepEqual(focused.cursor, { row: t.top, col: t.col + 2 });
  assert.equal(drawPanel(panelIn("list"), sz).cursor, null, "the list's focus: no cursor");
  const hidden = draw(panelIn("focus"), sz, { screen: AGENT(t.cols, t.rows, false) });
  assert.equal(hidden.cursor, null, "the agent hides its cursor");
  assert.equal(draw(panelIn("focus"), sz).cursor, null, "no capture yet: no cursor");
  const zoomed = drawPanel(panelIn("zoom"), sz);
  assert.deepEqual(zoomed.cursor, { row: zoomed.terminal.top, col: 2 });
});

test("the leader twice from a terminal opened from the detail's focus draws the list with the panel beside it, or the list alone under 80 columns (round 1 of the review)", () => {
  const state = keyed(keyed(PANEL_STATE(), "tab"), "enter");
  const back = leaderTwice(state).state;
  for (const sz of [S80, S120]) {
    const d = drawPanel(back, sz);
    assert.notEqual(d.terminal, null, `${sz.cols}`);
    assert.equal(d.terminal.whole, false, `${sz.cols}`);
    assert.match(footer(d, sz), sz === S80 ? /^C-\\ commands {3}Enter focus terminal {3}z zoom {3}\/ filter/ : /^C-\\ commands {3}Enter focus terminal {3}z zoom {3}c close terminal/, `${sz.cols}`);
  }
  const narrow = drawPanel(back, S79);
  assert.equal(narrow.terminal, null);
  assert.match(footer(narrow, S79), /^C-\\ commands {3}Enter focus terminal {3}z zoom/);
});

// ── The leader's hint (T1b) ──────────────────────────────────────────────────────────────────────

/** The state while the leader waits for its key: the leader alone, from the focus the state has. */
const waiting = (state) => leaderThen(state, "escape").leader.state;
/** What the hint names after the leader's key, in the leader's table's order (actions.mjs LEADER);
 *  the terminal's keys only while one is open ("Settled" 4). `Esc the list` stands last, always. */
const HINTS = Object.freeze(["k palette", "1-3 views", "Up/Down instance", "X/R/S/D acts", "/ filter", "o workspaces", "? help"]);
const TERMINAL_HINTS = Object.freeze(["k palette", "1-3 views", "Up/Down instance", "z zoom", "w close terminal", "X/R/S/D acts", "/ filter", "o workspaces", "? help"]);
const LAST_HINT = "Esc the list";
/** The hint on a row `cols` wide: the leader's key, then the hints, given up from the end until the
 *  rest and `Esc the list` stand before the last column, three cells between two. */
function hintAt(cols, hints = HINTS, key = "C-\\") {
  let kept = hints;
  while (kept.length && [key, ...kept, LAST_HINT].join("   ").length > cols - 1) kept = kept.slice(0, -1);
  return [key, ...kept, LAST_HINT].join("   ");
}

test("while the leader waits, the footer row is its hint and nothing else on the screen changes: at 80x24, cell for cell, the leader's key in bold, then what the keys after it do, the ones that do not fit given up from the end and `Esc the list` last", () => {
  const HINT_80 = "C-\\   k palette   1-3 views   Up/Down instance   X/R/S/D acts   Esc the list";
  assert.equal(hintAt(80), HINT_80);
  const d = draw(waiting(golden()), S80);
  assert.deepEqual(d.lines, [...draw(golden(), S80).lines.slice(0, 23), HINT_80]);
  d.cells[23].forEach((cell, x) => assert.deepEqual(cell.style, x < 3 ? style({ bold: true }) : PLAIN, `cell ${x}`));
  // The same in ASCII: the hint is printable ASCII as it is.
  assert.equal(footer(draw(waiting(golden({ ascii: true })), S80), S80), HINT_80);
});

test("the leader's hint at every width from 60 to 200 columns: as many hints as fit, given up from the end, `Esc the list` never; the terminal's `z zoom` and `w close terminal` named only while a terminal is open, from its focus or the list's (Settled 4)", () => {
  assert.equal(hintAt(60), "C-\\   k palette   1-3 views   Esc the list");
  assert.equal(hintAt(120), `C-\\   ${HINTS.join("   ")}   Esc the list`, "at 120 columns every key is named");
  assert.equal(hintAt(120, TERMINAL_HINTS), "C-\\   k palette   1-3 views   Up/Down instance   z zoom   w close terminal   X/R/S/D acts   / filter   Esc the list");
  for (let cols = MIN_SIZE.cols; cols <= 200; cols++) {
    const sz = size(cols, 24);
    const listed = footer(draw(waiting(golden()), sz), sz);
    assert.equal(listed, hintAt(cols), `${cols}: no terminal`);
    assert.doesNotMatch(listed, /zoom|close terminal/, `${cols}: no terminal, so no key of one`);
    for (const how of ["focus", "list"]) assert.equal(footer(drawPanel(waiting(panelIn(how)), sz), sz), hintAt(cols, TERMINAL_HINTS), `${cols}: a terminal open, the ${how}'s focus`);
  }
});

test("a rebound leader is named in its hint, by the key tui.json gave it, and fits at 60 columns", () => {
  for (const detachKey of ["F12", "C-a", "C-F5", "M-x"]) {
    for (const sz of [S60, S80, S120]) {
      assert.equal(footer(draw(waiting(openable({ detachKey })), sz), sz), hintAt(sz.cols, HINTS, detachKey), `${detachKey} at ${sz.cols}`);
    }
    // Once its next key came, the footer names it first again.
    assert.equal(footer(draw(leaderThen(openable({ detachKey }), "escape").state, S80), S80).startsWith(`${detachKey} commands   Enter open   `), true, detachKey);
  }
});

test("once the leader's next key comes the footer is back: Esc, the leader again, or a key not in its table in the list; from a terminal, Esc gives the list's footer, and a key not in the table leaves the terminal's", () => {
  for (const key of ["escape", golden().leaderKey, "x", "q"]) assert.equal(footer(draw(leaderThen(golden(), key).state, S80), S80), FOOTER, key);
  assert.equal(footer(drawPanel(leaderThen(panelIn("focus"), "escape").state, S80), S80), `${LEAD}Enter focus terminal   z zoom   / filter   ? help   q quit`);
  assert.equal(footer(drawPanel(leaderThen(panelIn("focus"), "x").state, S80), S80), `${LEAD}C-\\ C-\\ back to the list`);
});

// ── The palette (T1b) ────────────────────────────────────────────────────────────────────────────

/** The palette, opened as from anywhere: the leader, then `k`. */
const paletteOpen = (state) => leaderThen(state, "k").state;
/** A palette row as the spec draws it in `cols` cells: `>` on the selected one, an instance's state
 *  mark, its text from the fourth cell, and the kind word at the right edge. */
function paletteRow(item, selected, cols, ascii = false) {
  const text = item.kind === "instance" ? `${item.name}${item.machine ? ` on ${item.machine}` : ""}` : item.kind === "act" ? `${item.label} ${item.name}` : item.label;
  return `${selected ? ">" : " "} ${item.kind === "instance" ? marksOf(ascii)[item.mark] : " "} ${text}`.padEnd(cols - item.kind.length) + item.kind;
}
/** A row of `cols` cells: `left`, then `kind` at the right edge. */
const edged = (left, kind, cols = 80) => `${left.padEnd(cols - kind.length)}${kind}`;

test("the palette at 80x24 in UTF-8 and in ASCII, cell for cell: over the whole body under a rule with no joint, the query's row, then the instances that can be opened in the list's order, the views, the selected instance's acts and the commands, each with its kind at the right edge; the first selected, in reverse with `>`; the footer says how to work it", () => {
  for (const ascii of [false, true]) {
    const run = ascii ? "*" : "●", d = draw(paletteOpen(golden({ ascii })), S80);
    assert.deepEqual(d.lines, [
      ` acme-platform        ${COUNTS}`,
      "  Instances   Souls   Capabilities                                read 10:00:00",
      glyphsOf(ascii).rule.repeat(80),
      ">",
      edged(`> ${run} ${DESKTOP_EXPERT}`, "instance"),
      edged(`  ${run} ${DESKTOP_A}`, "instance"),
      edged(`  ${run} ${DESKTOP_B}`, "instance"),
      edged(`  ${run} ${KERNEL_EXPERT}`, "instance"),
      edged(`  ${run} ${KERNEL_DEV}`, "instance"),
      edged(`  ${run} ${MAINTAINER}`, "instance"),
      edged("    Instances", "view"),
      edged("    Souls", "view"),
      edged("    Capabilities", "view"),
      edged(`    Stop ${KERNEL_DEV}`, "act"),
      edged(`    Retire ${KERNEL_DEV}`, "act"),
      edged("    Workspaces", "command"),
      edged("    Refresh", "command"),
      edged("    Help", "command"),
      "", "", "", "", "",
      `${LEAD}Enter run   Up/Down move   Esc close`,
    ], ascii ? "ASCII" : "UTF-8");
    assert.deepEqual(d.cursor, { row: 3, col: 2 }, "the cursor after the empty query");
    assert.deepEqual(d.cells[3][0].style, style({ bold: true }), "the prompt");
    d.cells[4].forEach((cell, x) => assert.equal(cell.style.reverse, true, `the selected row, cell ${x}`));
    for (let r = 5; r <= 17; r++) assert.equal(d.cells[r].some((cell) => cell.style.reverse), false, `row ${r} is not selected`);
    // A row's kind is dim; an instance's name is plain, and an act's instance dim after its label.
    for (const cell of d.cells[5].slice(72)) assert.deepEqual(cell.style, DIM);
    for (const cell of d.cells[5].slice(4, 4 + DESKTOP_A.length)) assert.deepEqual(cell.style, PLAIN);
    for (const cell of d.cells[13].slice(4, 8)) assert.deepEqual(cell.style, PLAIN);
    for (const cell of d.cells[13].slice(9, 9 + KERNEL_DEV.length)) assert.deepEqual(cell.style, DIM);
  }
  // Ctrl+K from the list's focus opens the same palette.
  assert.deepEqual(draw(reduce(golden(), { key: "ctrl+k", read: 1 }).state, S80).lines, draw(paletteOpen(golden()), S80).lines);
});

test("the palette's rows are paletteItems' rows in its order, at 120x40, 80x24 and 60x15: an instance with its state mark and name, and `on <machine>` dim for another machine's; the selection moves with Down", () => {
  const states = [paletteOpen(golden()), paletteOpen(reached()), press(paletteOpen(golden()), ["down", "down"]).state];
  for (const state of states) for (const sz of [S120, S80, S60]) {
    const d = draw(state, sz), list = paletteItems(state, AT), at = `${sz.cols}x${sz.rows}`;
    const shown_ = d.lines.slice(4, sz.rows - 2).filter(Boolean).length;
    assert.equal(shown_ > 0, true, at);
    for (let i = 0; i < shown_; i++) assert.equal(d.lines[4 + i], paletteRow(list.items[i], list.items[i].key === list.selected, sz.cols), `${at}: row ${i}`);
    fits(d, sz, at);
  }
  // Down moved the selection to the third row.
  assert.equal(draw(states[2], S80).lines[6].startsWith(`> ● ${DESKTOP_B}`), true);
  assert.equal(draw(states[2], S80).lines[4].startsWith(`  ● ${DESKTOP_EXPERT}`), true);
  // garnet's running instance, which can be opened, is listed with its machine, dim.
  const d = draw(states[1], S80), r = d.lines.findIndex((line) => line.includes(FAR_A));
  assert.equal(d.lines[r], edged(`  ● ${FAR_A} on garnet`, "instance"));
  for (const cell of d.cells[r].slice(4, 4 + FAR_A.length)) assert.deepEqual(cell.style, PLAIN);
  for (const x of [0, 1, 3, 4, 5, 6, 7, 8]) assert.deepEqual(d.cells[r][5 + FAR_A.length + x].style, DIM, `the cell ${x} of "on garnet"`);
  // Its row that cannot be addressed is not listed.
  assert.equal(d.lines.some((line) => line.includes(FAR_B)), false);
});

test("the palette's query row starts with `> `, the cursor stands after the query, and `Nothing matches.` stands under a query that matches nothing; a query longer than its row is cut inside it and the cursor stays on the screen", () => {
  const typed = press(paletteOpen(golden()), ["d", "e", "v"]).state;
  const d = draw(typed, S80);
  assert.equal(d.lines[3], "> dev");
  assert.deepEqual(d.cursor, { row: 3, col: 5 });
  const none = draw(press(typed, ["z", "z", "z"]).state, S80);
  assert.deepEqual(none.lines.slice(3, 23), ["> devzzz", "    Nothing matches.", ...Array(18).fill("")]);
  assert.deepEqual(none.cursor, { row: 3, col: 8 });
  for (const cell of none.cells[4].slice(4, 4 + "Nothing matches.".length)) assert.deepEqual(cell.style, DIM);
  // A wide query: the cursor stands after its cells.
  assert.deepEqual(draw(press(paletteOpen(golden()), ["名", "前"]).state, S80).cursor, { row: 3, col: 6 });
  const long = Object.freeze({ ...typed, palette: Object.freeze({ ...typed.palette, query: "x".repeat(200) }) });
  for (const sz of [S80, S60]) {
    const drawn = draw(long, sz);
    assert.equal(drawn.lines[3], `> ${"x".repeat(sz.cols - 4)}…`, `${sz.cols}`);
    assert.deepEqual(drawn.cursor, { row: 3, col: sz.cols - 1 }, `${sz.cols}`);
  }
});

test("when the palette's rows do not fit, the body's last row says what is cut off, in the TUI's words: below, then above once the selection went down to the last row", () => {
  for (const state of [paletteOpen(golden()), paletteOpen(reached())]) {
    const list = paletteItems(state, AT), d = draw(state, S60);
    const drawn = d.lines.slice(4, 13).filter(Boolean).length;
    assert.equal(drawn < list.items.length, true, "at 60x15 the rows do not fit");
    assert.equal(drawn, 9, "every row between the query and the note holds a row of the palette: none is left empty");
    assert.equal(d.lines[13], `    ${list.items.length - drawn} more below`);
    for (const cell of d.cells[13].slice(4, d.lines[13].length)) assert.deepEqual(cell.style, DIM);
    let last = state;
    for (let i = 1; i < list.items.length; i++) last = press(last, ["down"], S60).state;
    const end = draw(last, S60), rows = end.lines.slice(4, 13).filter(Boolean);
    assert.equal(rows.length, 9, "scrolled to the end, too, no row is left empty");
    assert.equal(rows.at(-1), paletteRow(list.items.at(-1), true, 60), "the last row, selected, is on the screen");
    assert.equal(end.lines[13], `    ${list.items.length - rows.length} more above`);
  }
});

test("while the palette is open no terminal is drawn, even with one open, and the footer is the palette's; closed with Esc, the terminal it came from is drawn again with the focus in it", () => {
  const opened = paletteOpen(panelIn("focus"));
  for (const sz of [S80, S120, S60]) {
    const d = draw(opened, sz, { screen: AGENT(sz.cols, sz.rows) });
    assert.equal(d.terminal ?? null, null, `${sz.cols}`);
    assert.equal(d.cursor.row, 3, `${sz.cols}: the cursor is the query's`);
    assert.equal(d.lines.some((line) => line.includes("$ hello") || line.includes("│")), false, `${sz.cols}: nothing of the agent's screen, and no panes`);
    assert.equal(footer(d, sz), `${LEAD}Enter run   Up/Down move   Esc close`, `${sz.cols}`);
  }
  assert.deepEqual(draw(opened, S80).lines.slice(2, 14), [
    "─".repeat(80), ">",
    edged("> ● dev-a", "instance"), edged("  ● dev-b", "instance"),
    edged("    Instances", "view"), edged("    Souls", "view"), edged("    Capabilities", "view"),
    edged("    Stop dev-a", "act"), edged("    Retire dev-a", "act"),
    edged("    Workspaces", "command"), edged("    Refresh", "command"), edged("    Help", "command"),
  ]);
  const closed = drawPanel(press(opened, ["escape"]).state, S80);
  assert.equal(closed.terminal.whole, false);
  assert.equal(footer(closed, S80), `${LEAD}C-\\ C-\\ back to the list`);
});

test("hostile text in an instance's name or in the query goes through shown(): no control or bidi character in any cell of the palette, and every row inside the terminal, at 80x24 and 60x15, in UTF-8 and in ASCII", () => {
  const HOSTILE = ["dev\x1b[31mred\x1b[0m", "safe‮txt.exe‭", "\u009B31mred\u009B2J", "ti\x1b]0;owned\x07tle", "名".repeat(60), `Z${"́".repeat(60)}algo`];
  for (const ascii of [false, true]) {
    const base = stateOf(observed(HOSTILE.map((name, i) => instanceRow("dev", `${name}-${i}`))), { ascii });
    for (const query of ["", ...HOSTILE]) {
      const open_ = paletteOpen(base), state = Object.freeze({ ...open_, palette: Object.freeze({ ...open_.palette, query }) });
      for (const sz of [S80, S60]) {
        const d = draw(state, sz), at = `${sz.cols}x${sz.rows}${ascii ? " ascii" : ""} ${JSON.stringify(query)}`;
        for (const line of d.cells) for (const cell of line) assert.doesNotMatch(cell.text, CONTROL, at);
        assert.equal(d.lines[3].startsWith(query ? "> " : ">"), true, at);
        fits(d, sz, at);
      }
    }
  }
});

// ── The Souls and Capabilities views (T1b) ───────────────────────────────────────────────────────

/** The text of the header's second row drawn in reverse: the open view, a cell on each side. */
const openView = (d) => d.cells[1].filter((cell) => cell.style.reverse).map((cell) => cell.text).join("");
/** The body's text, its rows joined. */
const bodyText = (d, sz) => d.lines.slice(3, sz.rows - 1).map((line) => line.trim()).filter(Boolean).join(" ");

// The Souls view has its content now: test/souls-view.test.mjs draws it. Capabilities still says
// what it will hold.
test("the Capabilities view says what it will hold and what to run, as NOT_BUILT says, at every size; the header shows it open in reverse, reached with 3 in the list or after the leader, and the leader then 1 comes back", () => {
  for (const [key, view, name] of [["3", "capabilities", " Capabilities "]]) {
    for (const state of [press(golden(), [key]).state, leaderThen(golden(), key).state, leaderThen(panelIn("focus"), key).state]) {
      assert.equal(state.view, view);
      for (const sz of SIZES) {
        const d = draw(state, sz), at = `${view} ${sz.cols}x${sz.rows}`;
        assert.equal(openView(d), name, at);
        assert.equal(bodyText(d, sz), NOT_BUILT[view].said.map((part) => part.own).join(""), at);
        assert.equal(d.lines[2], "─".repeat(sz.cols), `${at}: no joint, no panes`);
        assert.equal(d.terminal ?? null, null, `${at}: no terminal`);
        fits(d, sz, at);
      }
    }
    assert.equal(openView(draw(leaderThen(press(golden(), [key]).state, "1").state, S80)), " Instances ", `${view}: the leader then 1`);
  }
  const caps = draw(press(golden(), ["3"]).state, S80);
  assert.deepEqual(caps.lines.slice(3, 7), ["", " This view will list the capabilities this machine has. It is not in this", " version: `oats capabilities` lists them.", ""]);
});

test("the Capabilities view's footer offers what applies there: Esc back to the list and the workspaces, then help and quit; Enter and the acts, which do nothing there, are not offered", () => {
  for (const [key, view] of [["3", "capabilities"]]) {
    for (const base of [golden(), openable()]) {
      const state = press(base, [key]).state;
      for (const k of ["enter", "X", "D"]) {
        const step = press(state, [k]);
        assert.deepEqual([step.state.view, step.state.terminal, step.state.act ?? null, step.effects], [view, null, null, []], `${view}: ${k} does nothing`);
      }
      for (const sz of [S60, S80, S120]) assert.equal(footer(draw(state, sz), sz), `${LEAD}Esc close   w workspaces   ? help   q quit`, `${view} at ${sz.cols}`);
    }
  }
});

test("the Capabilities view names each command whole on one row at every width from 60 to 200 columns: a command cut in two cannot be typed", () => {
  for (const [key, view] of [["3", VIEWS[2]]]) {
    const state = press(golden(), [key]).state;
    for (let cols = MIN_SIZE.cols; cols <= 200; cols++) {
      const sz = size(cols, 24), lines = draw(state, sz).lines.slice(3, 23);
      for (const command of view.commands) assert.equal(lines.some((line) => line.includes(`\`${command}\``)), true, `${command} at ${cols}: ${JSON.stringify(lines.filter(Boolean))}`);
    }
  }
});

// ── The help's leader section (T1b) ──────────────────────────────────────────────────────────────

test("at 60 columns the help's `The leader` section has every row whole: the sentence after the leader's key wrapped under its first row, the table's rows uncut, none past the edge", () => {
  for (const [detachKey, lead] of [[undefined, ["  C-\\ then one of these keys, from every focus; a terminal", "      too:"]], ["C-F5", ["  C-F5 then one of these keys, from every focus; a", "       terminal too:"]]]) {
    const lines = helpLines(golden(detachKey ? { detachKey } : {}), size(60, 160));
    const from = lines.indexOf("  The leader"), to = lines.indexOf("  Marks");
    assert.equal(from > 0 && to > from, true);
    assert.deepEqual(lines.slice(from, to - 1), [
      "  The leader",
      "",
      ...lead,
      "  k, Space   palette",
      "  1          instances",
      "  2          souls",
      "  3          capabilities",
      "  Up         previous instance",
      "  Down       next instance",
      "  z          zoom, while a terminal is open",
      "  w          close terminal, while a terminal is open",
      "  X          stop",
      "  R          restart",
      "  S          start",
      "  D          retire",
      "  /          filter",
      "  o          workspaces",
      "  ?          help",
      "  Esc        the list; the leader again does the same",
    ], detachKey ?? "C-\\");
    for (const line of lines.slice(from, to)) assert.equal(textWidth(line) <= 60 - 2, true, `the right margin is kept: ${line}`);
  }
});
