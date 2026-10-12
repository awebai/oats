process.env.TZ = "UTC";
// The views of `oats tui`, drawn as the main loop draws them (helpers.mjs `draw`): the store's state
// through the real model, the frame and the screen's cell buffer. What a test claims about the
// screen (a width, a pane, a line of its own) it reads from the cells, never from a string's length.
// Every entry is made by the shared functions, and every sentence of the shared home is computed by
// calling it: the tests quote the TUI's own words only.
import test from "node:test";
import assert from "node:assert/strict";
import { ACTIONS } from "../lib/actions.mjs";
import {
  DETAIL_WITHHELD, TERMS, UNMATCHED_SECTION, deploymentState, displayLine, heldHome, instanceActs, observeIdentities, observedEntry, panelInstances, primaryDeployment,
  remoteRosterState, rosterRows, runtimeState, waitedText, waitingBelowText, waitingClock, waitingLabel, workspaceChoiceRows, workspaceChoices,
} from "../lib/client.mjs";
import { effectiveConfig } from "../lib/config.mjs";
import { MORE_FOLDERS, OFFERED_SECTION, ROSTER_FAILED, heldOf, model, panelOf } from "../lib/model.mjs";
import { reduce } from "../lib/store.mjs";
import { createScreen } from "../lib/term/screen.mjs";
import { isStyle, style } from "../lib/term/style.mjs";
import { isSafeText, shown, textOf } from "../lib/term/text.mjs";
import { textWidth } from "../lib/term/width.mjs";
import { MIN_SIZE, WIDE, frame } from "../lib/views/frame.mjs";
import { MACHINES, NOT_YET, VIEWS, keysLabel } from "../lib/views/help.mjs";
import { EMPTY_TEXT, MARKS, cutNote, marksOf } from "../lib/views/instances.mjs";
import { OPEN_MARK, SWITCHER_TEXT } from "../lib/views/switcher.mjs";
import { CLI, DEPLOYMENT, NOW, draw, failed, instanceRow, observed, press, readTerminalOutput, rosterOf, stateOf } from "./helpers.mjs";

const size = (cols, rows) => ({ cols, rows });
const S80 = size(80, 24), S120 = size(120, 40), S79 = size(79, 24), S60 = size(60, 15);
const SIZES = [S80, S120, S79, S60];
const AT = new Date(NOW).toISOString();
const DIM = style({ dim: true });
/** The spec's own arithmetic for the list pane of a wide terminal. */
const listWidth = (cols) => Math.min(Math.max(Math.floor(cols * 0.48), 36), 60);
/** The glyphs the spec gives the frame, by mode. */
const GLYPHS = { utf8: { rule: "─", down: "┬", up: "┴", bar: "│", cut: "…" }, ascii: { rule: "-", down: "+", up: "+", bar: "|", cut: "..." } };
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
/** The body of a frame: the rows between the two rules. */
const bodyRows = (sz) => Array.from({ length: sz.rows - 5 }, (_, i) => 3 + i);
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
  const found = bodyRows(sz).filter((r) => cellText(reference, r).includes(` ${name} `));
  assert.equal(found.length, 1, `one list row draws ${name}`);
  return found[0];
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
/** The list's footer where it has the room, which is from 79 columns up, and at 60 columns: `workspaces`
 *  is the hint given up first (the frame's own order), so the 60-column footer is 2b's. */
const FOOTER = " / filter   Tab detail   r refresh   w workspaces   ? help   q quit";
const FOOTER_60 = " / filter   Tab detail   r refresh   ? help   q quit";

// ── Golden frames ────────────────────────────────────────────────────────────────────────────────

test("the Instances view at 80x24 in UTF-8, cell for cell: the header, the view names and the read time, a rule with a joint at the list's width, the roster beside the selected instance's detail, a rule, the footer", () => {
  const blank = `${" ".repeat(38)}│`;
  assert.deepEqual(draw(golden(), S80).lines, [
    ` oats  acme-platform  ${COUNTS}`,
    " 1 Instances   2 Souls   3 Capabilities                           read 10:00:00",
    `${"─".repeat(38)}┬${"─".repeat(41)}`,
    " ▾ ● acme-console-e…  claude          │   acme-ledger-developer-note-target",
    "     ● acme-console…  claude         !│   soul     acme-ledger-developer",
    "     ● acme-console…  claude         !│   state    running",
    ` ▾ ● acme-ledger-ex…  claude          │   needs    ${NEEDS}`,
    ">  ▾ ● acme-ledger-…  claude         !│            the agent: \"Which base",
    "       ○ peer-revie…  stopped         │            should it use?\"",
    "                                      │   harness  claude, claude-opus-5-5 (so…",
    "   ● acme-maintaine…  claude          │   work     worktree, agents/acme-ledge…",
    "   ? acme-expert-tui  unreachable     │   team     eng",
    "                                      │   parent   acme-ledger-expert-retire",
    `                                      │   started  ${STARTED}`,
    "                                      │   home     …edger-developer-note-target",
    blank, blank, blank, blank, blank, blank, blank,
    `${"─".repeat(38)}┴${"─".repeat(41)}`,
    FOOTER,
  ]);
});

test("the Instances view at 80x24 in ASCII, cell for cell: the same screen with the rules, the joints, the marks and the cut mark in ASCII", () => {
  const blank = `${" ".repeat(38)}|`;
  assert.deepEqual(draw(golden({ ascii: true }), S80).lines, [
    ` oats  acme-platform  ${COUNTS}`,
    " 1 Instances   2 Souls   3 Capabilities                           read 10:00:00",
    `${"-".repeat(38)}+${"-".repeat(41)}`,
    " v * acme-console...  claude          |   acme-ledger-developer-note-target",
    "     * acme-conso...  claude         !|   soul     acme-ledger-developer",
    "     * acme-conso...  claude         !|   state    running",
    ` v * acme-ledger-...  claude          |   needs    ${NEEDS}`,
    ">  v * acme-ledge...  claude         !|            the agent: \"Which base",
    "       - peer-rev...  stopped         |            should it use?\"",
    "                                      |   harness  claude, claude-opus-5-5 (...",
    "   * acme-maintai...  claude          |   work     worktree, agents/acme-led...",
    "   ? acme-expert-tui  unreachable     |   team     eng",
    "                                      |   parent   acme-ledger-expert-retire",
    `                                      |   started  ${STARTED}`,
    "                                      |   home     ...ger-developer-note-target",
    blank, blank, blank, blank, blank, blank, blank,
    `${"-".repeat(38)}+${"-".repeat(41)}`,
    FOOTER,
  ]);
});

test("at every size and in both modes the frame has its shape: the header on the first row, the view names and the read time on the second, a rule under them and one above the footer, the footer last", () => {
  for (const ascii of [false, true]) for (const sz of SIZES) {
    const d = draw(golden({ ascii }), sz), g = glyphsOf(ascii), at = `${sz.cols}x${sz.rows}${ascii ? " ascii" : ""}`;
    const wide = sz.cols >= 80, list = listWidth(sz.cols);
    assert.equal(d.cells.length, sz.rows, at);
    for (const line of d.cells) assert.equal(line.length, sz.cols, at);
    assert.equal(cellText(d, 0, 0, 7), " oats", at);
    assert.equal(cellText(d, 0, 1, 5), "oats", at);
    assert.equal(cellText(d, 1, 0, 40), " 1 Instances   2 Souls   3 Capabilities", at);
    assert.equal(cellText(d, 1).endsWith(" read 10:00:00"), true, at);
    assert.equal(d.cells[1][sz.cols - 2].text, "0", `${at}: the read time ends one cell before the edge`);
    // The two rules reach edge to edge; in the wide layout each has a joint where the panes' rule meets it.
    for (const [r, joint] of [[2, g.down], [sz.rows - 2, g.up]]) {
      d.cells[r].forEach((cell, x) => assert.equal(cell.text, wide && x === list ? joint : g.rule, `${at}: row ${r}, column ${x}`));
    }
    // One rule column between the panes, on every row of the body, and nowhere else.
    for (const r of bodyRows(sz)) {
      if (wide) assert.equal(d.cells[r][list].text, g.bar, `${at}: row ${r} has the panes' rule at column ${list}`);
      if (!ascii) assert.equal(d.cells[r].filter((cell) => cell.text === g.bar).length, wide ? 1 : 0, `${at}: row ${r}`);
    }
    assert.equal(cellText(d, sz.rows - 1).endsWith("? help   q quit"), true, at);
    assert.equal(d.page, sz.rows - 5, `${at}: the list pane is the body`);
  }
});

test("from 80 columns up the list takes clamp(floor(cols x 0.48), 36, 60) cells, one column is the rule, and the detail has the rest", () => {
  for (const [cols, list] of [[80, 38], [81, 38], [84, 40], [100, 48], [120, 57], [125, 60], [126, 60], [200, 60]]) {
    assert.equal(listWidth(cols), list);
    const sz = size(cols, 24), d = draw(golden(), sz);
    assert.equal(d.cells[2][list].text, "┬", `${cols}: the joint is at the list's width`);
    assert.equal(d.cells[22][list].text, "┴", `${cols}`);
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

test("at 120x40 the names have room: the same roster with the longer names whole and the detail's lines uncut", () => {
  const d = draw(golden(), S120), row = (list, detail) => `${list.padEnd(57)}│${detail}`;
  assert.equal(d.lines[0], ` oats  acme-platform${" ".repeat(42)}${COUNTS}`);
  assert.equal(d.lines[1], ` 1 Instances   2 Souls   3 Capabilities${" ".repeat(67)}read 10:00:00`);
  assert.equal(d.lines[3], row(" ▾ ● acme-console-expert-tui-read        claude", "   acme-ledger-developer-note-target"));
  assert.equal(d.lines[4], row("     ● acme-console-developer-panel      claude         !", "   soul     acme-ledger-developer"));
  assert.equal(d.lines[5], row("     ● acme-console-developer-terms      claude         !", "   state    running"));
  assert.equal(d.lines[6], row(" ▾ ● acme-ledger-expert-retire           claude", `   needs    ${NEEDS}`));
  assert.equal(d.lines[7], row(">  ▾ ● acme-ledger-developer-note-targ…  claude         !", "            the agent: \"Which base should it use?\""));
  assert.equal(d.lines[8], row("       ○ peer-reviewer-note              stopped", "   harness  claude, claude-opus-5-5 (soul)"));
  assert.equal(d.lines[9], row("", "   work     worktree, agents/acme-ledger-developer-note-targ…"));
  assert.equal(d.lines[10], row("   ● acme-maintainer-ops                 claude", "   team     eng"));
  assert.equal(d.lines[11], row("   ? acme-expert-tui                     unreachable", `   parent   ${KERNEL_EXPERT}`));
  assert.equal(d.lines[12], row("", `   started  ${STARTED}`));
  assert.equal(d.lines[13], row("", "   home     …oper/instances/acme-ledger-developer-note-target"));
  for (let r = 14; r < 38; r++) assert.equal(d.lines[r], row("", ""), `row ${r}`);
  assert.equal(d.lines[39], FOOTER);
});

test("at 79x24 the list takes the whole width: no rule column, no detail beside it, and the waiting marks at the right edge", () => {
  const d = draw(golden(), S79);
  assert.equal(d.lines[0], ` oats  acme-platfo…  ${COUNTS}`);
  assert.equal(d.lines[2], "─".repeat(79));
  assert.deepEqual(d.lines.slice(3, 12), [
    " ▾ ● acme-console-expert-tui-read                              claude",
    "     ● acme-console-developer-panel                            claude         !",
    "     ● acme-console-developer-terms                            claude         !",
    " ▾ ● acme-ledger-expert-retire                                 claude",
    ">  ▾ ● acme-ledger-developer-note-target                       claude         !",
    "       ○ peer-reviewer-note                                    stopped",
    "",
    "   ● acme-maintainer-ops                                       claude",
    "   ? acme-expert-tui                                           unreachable",
  ]);
  assert.deepEqual(d.lines.slice(12, 22), Array.from({ length: 10 }, () => ""));
  assert.equal(d.lines[22], "─".repeat(79));
  assert.equal(d.lines[23], FOOTER);
  assert.deepEqual(d.cells[7].map((cell) => cell.style.reverse), Array.from({ length: 79 }, () => true), "the selected row's bar is the whole width");
  assert.deepEqual([d.cells[4][78].text, d.cells[7][78].text], ["!", "!"], "a waiting mark stands in the last column");
  for (const line of d.lines) assert.equal(line.includes("soul "), false, "no detail is drawn beside the list");
});

test("at 60x15, the smallest size drawn, the frame keeps its shape and the roster is still read", () => {
  const d = draw(golden(), S60);
  assert.equal(d.lines[0].startsWith(" oats  "), true);
  assert.equal(d.lines[0].endsWith("1 withheld"), true);
  assert.equal(d.lines[0].includes("3 need input"), true);
  assert.equal(d.lines[1], " 1 Instances   2 Souls   3 Capabilities       read 10:00:00");
  assert.equal(d.lines[2], "─".repeat(60));
  assert.deepEqual(d.lines.slice(3, 13), [
    " ▾ ● acme-console-expert-tui-read           claude",
    "     ● acme-console-developer-panel         claude         !",
    "     ● acme-console-developer-terms         claude         !",
    " ▾ ● acme-ledger-expert-retire              claude",
    ">  ▾ ● acme-ledger-developer-note-target    claude         !",
    "       ○ peer-reviewer-note                 stopped",
    "",
    "   ● acme-maintainer-ops                    claude",
    "   ? acme-expert-tui                        unreachable",
    "",
  ]);
  assert.equal(d.lines[13], "─".repeat(60));
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

test("on a terminal 3000 columns wide the rules still reach edge to edge, the list pane stays 60 cells and the counts stand at the right edge", () => {
  const sz = size(3000, 24), d = draw(golden(), sz);
  for (const r of [2, 22]) d.cells[r].forEach((cell, x) => assert.equal(cell.text, x === 60 ? (r === 2 ? "┬" : "┴") : "─", `row ${r}, column ${x}`));
  assert.equal(cellText(d, 0).length, 2999);
  assert.equal(cellText(d, 0).endsWith(COUNTS), true);
  assert.equal(cellText(d, 0, 0, 20), " oats  acme-platform");
  assert.equal(cellText(d, 23), FOOTER);
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

test("the two views that cannot be opened are named dim and `1 Instances` is not, in every state", () => {
  const states = [stateOf(), stateOf(observed([])), press(fresh(), ["/", "z", "z", "z"]).state, golden(), press(golden(), ["?"]).state, stateOf(failed(entry(), { code: "E_SOMETHING_NEW", message: "no" })), stateOf(failed(entry(), REFUSED("no")))];
  for (const state of states) for (const sz of SIZES) {
    const d = draw(state, sz), line = d.cells[1].map((cell) => cell.text).join("");
    for (const [name, dim] of [["1 Instances", false], ["2 Souls", true], ["3 Capabilities", true]]) {
      const at = line.indexOf(name);
      assert.equal(at > 0, true, `${name} is named`);
      for (const cell of d.cells[1].slice(at, at + name.length).filter((c) => c.text !== " ")) {
        if (dim) assert.equal(cell.style, DIM, `${name} is dim`);
        else assert.equal(cell.style.dim, false, `${name} is not dim`);
      }
    }
  }
});

// ── The header ───────────────────────────────────────────────────────────────────────────────────

test("the header holds oats, the workspace's name, and the counts right aligned, each a number and a word in the terminal's plain colour", () => {
  const d = draw(stateOf(observed(ROSTER(), { withheld: WITHHELD, workspace: "another-workspace" })), S120);
  assert.equal(d.lines[0], ` oats  another-workspace${" ".repeat(38)}${COUNTS}`);
  assert.equal(d.lines[0].length, 119, "one cell of margin at the right edge");
  for (const cell of d.cells[0].slice(119 - COUNTS.length, 119)) assert.equal(cell.style.fg, null, "a count has no colour of its own");
});

test("a count of zero is left out of the header", () => {
  const running = draw(stateOf(observed([instanceRow("soul", "one"), instanceRow("soul", "two")])), S80);
  assert.equal(running.lines[0], ` oats  acme-platform${" ".repeat(50)}2 running`);
  const stopped = draw(stateOf(observed([instanceRow("soul", "one", { running: false, runtimeState: "stopped" })])), S80);
  assert.equal(stopped.lines[0], ` oats  acme-platform${" ".repeat(50)}1 stopped`);
  const none = draw(stateOf(observed([])), S80);
  assert.equal(none.lines[0], " oats  acme-platform");
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
    assert.equal(draw(state, sz).lines[1], " 1 Instances   2 Souls   3 Capabilities", `${sz.cols}x${sz.rows}: no read time`);
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
    const below = d.lines.slice(reason.rows.at(-1) + 1, sz.rows - 2);
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
    assert.deepEqual(d.lines.slice(reason.rows.at(-1) + 1, sz.rows - 2).filter(Boolean), [], `${at}: the list holds the reason and no rows`);
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
    assert.deepEqual([...new Set(out.sequences.map((s) => s.kind))].filter((kind) => !["erase", "position", "sgr"].includes(kind)), [], at);
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
    assert.deepEqual([...new Set(written.sequences.map((s) => s.kind))].filter((kind) => !["erase", "position", "sgr"].includes(kind)), [], handed);
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
    assert.deepEqual([...new Set(out.sequences.map((s) => s.kind))].filter((kind) => !["erase", "position", "sgr"].includes(kind)), [], at);
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
    assert.deepEqual(d.lines.slice(reason.rows.at(-1) + 1, sz.rows - 2).filter(Boolean), [], `${at}: the list holds the reason and no rows`);
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

test("the unattributed lines keep 2b's two conditions, through the display filter and with no text of the TUI's on their rows: the stale reason whatever its message is (a line, one the filter withholds, spaces only), and a remote row's runtimeError under its state", () => {
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
  // with. In quotation marks on rows of its own under `state`, as 2b draws a local row's.
  const erring = (runtimeError) => heard(local(), answered(group({ instances: [farRow(FAR_A, { running: null, runtimeState: "unreachable", runtimeError })] })), T1);
  const cases = {
    "a reached machine's row with the error its host reported": erring(UNREACHABLE),
    "a reached machine's row with an error the display filter withholds": erring("wipe \x1b[2J the screen"),
    "a row kept from a machine whose read answered an error": lost(),
    "a row kept from a machine whose read threw": heard(reached(), { thrown: "spawn oats ENOENT" }, T2),
  };
  for (const [kind, made] of Object.entries(cases)) for (const sz of [S160, S80]) {
    const state = selecting(made, FAR_A, sz), error = panelRow(state, FAR_A).runtimeError, d = draw(state, sz), detail = factsOf(detailLines(d, sz)), at = `${kind}, at ${sz.cols}x${sz.rows}`;
    assert.equal(typeof error === "string" && error.trim() !== "", true, `${at}: the shared home gave the row an error`);
    const rows = fact(detail, "state").rows;
    assert.equal(rows.slice(1).join(" "), textOf(shown(`"${error.trim()}"`)), `${at}: through the display filter: the rows under the state are the error in quotation marks`);
    assert.equal(rows.length >= 2, true, `${at}: on rows of its own`);
    assert.equal(labels(detail)[labels(detail).indexOf("state") + 1], "harness", `${at}: and no label, speaker or held line stands with it`);
    for (const text of d.lines) assert.equal(text.includes("the kernel:") || text.includes("the host:"), false, at);
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

test("the disclosure mark stands only on a row with instances below it: open on an expanded row, closed on a collapsed one, and none on a leaf or a single instance", () => {
  for (const ascii of [false, true]) for (const sz of SIZES) {
    const marks = marksOf(ascii), state = fresh({ ascii }), d = draw(state, sz);
    /** The cell two before the state mark: where a row says whether it has instances below it. */
    const disclosure = (name, mark) => { const cells = d.cells[rowAt(state, sz, name)]; return cells[cells.findIndex((cell, x) => x > 0 && cell.text === mark) - 2].text; };
    assert.equal(disclosure(KERNEL_EXPERT, marks.running), marks.open);
    assert.equal(disclosure(KERNEL_DEV, marks.running), marks.open);
    assert.equal(disclosure(DESKTOP_EXPERT, marks.running), marks.open);
    for (const [name, mark] of [[REVIEWER, marks.stopped], [DESKTOP_A, marks.running], [DESKTOP_B, marks.running], [MAINTAINER, marks.running], [EXPERT_TUI, marks.unknown]]) assert.equal(disclosure(name, mark), " ", name);
    const shut = draw(folded({ ascii }), sz);
    assert.equal(shut.cells[3][shut.cells[3].findIndex((cell, x) => x > 1 && cell.text === marks.running) - 2].text, marks.closed, "a collapsed row");
  }
  const lines = listLines(draw(fresh(), S120), S120);
  assert.equal(lines.filter((line) => line.includes("▾")).length, 3);
  assert.equal(lines.filter((line) => line.includes("▸")).length, 0);
});

/** Six instances, one per state a row can be in, and what each row is to show. */
const STATES = () => [
  ["running", instanceRow("soul", "a-running")],
  ["stopped", instanceRow("soul", "b-stopped", { running: false, runtimeState: "stopped" })],
  ["shell", instanceRow("soul", "c-shell", { running: false, runtimeState: "shell" })],
  ["unknown", instanceRow("soul", "d-unreachable", { running: null, runtimeState: "unreachable", runtimeError: UNREACHABLE })],
  ["stopped", instanceRow("soul", "e-unsupported", { running: false, runtimeState: "unsupported", runtimeError: "E_HERDR_REMOVED: the session backend is gone" })],
  ["held", instanceRow("soul", "f-spawning", { running: false, runtimeState: "stopped", spawnInProgress: true })],
  ["held", instanceRow("soul", "g-half-spawned", { running: false, runtimeState: "stopped", rollbackIncomplete: true })],
  ["held", instanceRow("soul", "h-half-retired", { retirePending: true })],
];
/** The mark a row carries: the last thing drawn before its name. */
const markOf = (d, sz, name) => { const line = cellText(d, rowOf(d, sz, name)); return line.slice(0, line.indexOf(name)).trim().split(/\s+/).at(-1); };

test("each state has a mark of its own shape, in UTF-8 and in ASCII: running, stopped, a shell left behind, unknown, and a home the kernel holds", () => {
  assert.deepEqual({ ...MARKS.utf8 }, { running: "●", stopped: "○", shell: "◌", unknown: "?", held: "◆", open: "▾", closed: "▸", selected: ">", waiting: "!" });
  assert.deepEqual({ ...MARKS.ascii }, { running: "*", stopped: "-", shell: "~", unknown: "?", held: "#", open: "v", closed: ">", selected: ">", waiting: "!" });
  for (const ascii of [false, true]) {
    const sz = S120, d = draw(stateOf(observed(STATES().map(([, row]) => row)), { ascii }), sz);
    for (const [mark, row] of STATES()) assert.equal(markOf(d, sz, row.instance), marksOf(ascii)[mark], `${row.instance}${ascii ? " in ASCII" : ""}`);
  }
});

test("the word at a row's right edge is the harness of a running instance, the kernel's own name for the state otherwise, and the held home's state for a home the kernel holds", () => {
  const rows = STATES().map(([, row]) => row), state = stateOf(observed(rows)), sz = S120, d = draw(state, sz);
  const held = (name) => heldHome(panelRow(state, name)).state;
  const expected = { "a-running": "claude", "b-stopped": "stopped", "c-shell": "shell", "d-unreachable": "unreachable", "e-unsupported": "unsupported", "f-spawning": held("f-spawning"), "g-half-spawned": held("g-half-spawned"), "h-half-retired": held("h-half-retired") };
  const widest = Math.max(...Object.values(expected).map((word) => textWidth(word)));
  assert.equal(widest, 20, "a held home's state is the long one, and it is as wide as the column may be");
  const list = listWidth(sz.cols);
  const starts = Object.entries(expected).map(([name, word]) => { const line = cellText(d, rowOf(d, sz, name), 0, list); assert.equal(line.endsWith(word), true, `${name} shows ${word}`); return line.length - word.length; });
  assert.equal(new Set(starts).size, 1, "every word starts at the same column");
  assert.equal(starts[0] + widest <= list, true, "and the widest ends inside the pane");
  assert.equal(d.cells[rowOf(d, sz, "a-running")][starts[0] - 1].text, " ", "a gap stands before the column");
});

test("the word column is as wide as the widest word among all the rows, and never wider than 20 cells: a longer word is cut with the mark", () => {
  for (const [words, width] of [[["claude"], 6], [["claude", "pi"], 6], [["claude", "a-harness-of-16ch"], 17], [["claude", "h".repeat(30)], 20]]) {
    const rows = words.map((harness, i) => instanceRow("soul", `row-${i}`, { harness }));
    for (const sz of [S80, S120, S79]) {
      const d = draw(stateOf(observed(rows)), sz), list = sz.cols >= WIDE ? listWidth(sz.cols) : sz.cols;
      const first = cellText(d, rowOf(d, sz, "row-0"), 0, list), column = first.length - "claude".length;
      words.forEach((harness, i) => {
        const drawn = d.cells[rowOf(d, sz, `row-${i}`)].slice(column, list).map((cell) => cell.text).join("").trimEnd();
        assert.equal(drawn, harness.length > 20 ? `${harness.slice(0, 19)}…` : harness, `${harness} at ${sz.cols}`);
        assert.equal(d.cells[rowOf(d, sz, `row-${i}`)][column - 1].text, " ", "the name never runs into the word");
      });
      assert.equal(list - column >= width, true, `${sz.cols}: the column holds ${width} cells`);
      // The column is the same whichever row is the widest: one row narrower would start further right.
      const narrow = draw(stateOf(observed([instanceRow("soul", "row-0")])), sz), alone = cellText(narrow, rowOf(narrow, sz, "row-0"), 0, list);
      assert.equal(alone.length - "claude".length - column, width - 6, `${sz.cols}: ${width} cells against 6`);
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
      assert.deepEqual(d.cells.flatMap((line, r) => (r !== selected && line.some((cell) => cell.style.reverse) ? [r] : [])), [], `${at}: no other row is in reverse video`);
      assert.deepEqual(bodyRows(sz).filter((r) => r !== selected && d.cells[r][0].text === ">"), [], `${at}: no other row carries the selection mark`);
    }
  }
});

test("a waiting row carries `!` at the right edge of its pane, and an expanded row carries nothing for the rows that wait below it", () => {
  for (const ascii of [false, true]) for (const sz of SIZES) {
    const pane = sz.cols >= WIDE ? listWidth(sz.cols) : sz.cols, state = fresh({ ascii }), d = draw(state, sz);
    /** What stands after the word of a row, up to the pane's edge. */
    const after = (name, word) => { const line = cellText(d, rowAt(state, sz, name), 0, pane); return line.slice(line.lastIndexOf(word) + word.length).trim(); };
    for (const name of [KERNEL_DEV, DESKTOP_A, DESKTOP_B]) {
      assert.equal(after(name, "claude"), "!", `${name} at ${sz.cols}x${sz.rows}`);
      assert.equal(d.cells[rowAt(state, sz, name)][pane - 1].text, "!", `${name}: the mark is inside the pane, at its edge`);
    }
    for (const [name, word] of [[KERNEL_EXPERT, "claude"], [DESKTOP_EXPERT, "claude"], [MAINTAINER, "claude"], [REVIEWER, "stopped"], [EXPERT_TUI, "unreachable"]]) assert.equal(after(name, word), "", `${name} at ${sz.cols}x${sz.rows}`);
  }
});

test("a collapsed row carries `!N` for the N rows waiting below it, the closed disclosure mark, and the rows below it are not drawn: one cluster and no single instance, cell for cell", () => {
  const header = (cols) => ` oats  acme-platform${" ".repeat(cols - 44)}3 running  2 need input`;
  const d80 = draw(folded(), S80), a80 = draw(folded({ ascii: true }), S80), d60 = draw(folded(), S60), d120 = draw(folded(), S120);
  assert.equal(d80.lines[0], header(80));
  assert.equal(cellText(d80, 3, 0, 39), ">▸ ● acme-console-expert…  claude   !2│");
  assert.equal(cellText(a80, 3, 0, 39), ">> * acme-console-expe...  claude   !2|");
  assert.equal(d60.lines[3], ">▸ ● acme-console-expert-tui-read                claude   !2");
  assert.equal(cellText(d120, 3, 0, 58), `>▸ ● ${DESKTOP_EXPERT.padEnd(41)}claude   !2│`);
  for (const [d, sz] of [[d80, S80], [a80, S80], [d60, S60], [d120, S120]]) {
    assert.deepEqual(listLines(d, sz).slice(1).filter((line) => line.trim()), [], "the rows below a collapsed row are not drawn, and no other row is");
    const pane = sz.cols >= WIDE ? listWidth(sz.cols) : sz.cols;
    assert.deepEqual(d.cells[3].slice(pane - 2, pane).map((cell) => cell.text), ["!", "2"], "the mark is inside the pane, at its edge");
    d.cells[3].forEach((cell, x) => assert.equal(cell.style.reverse, x < pane));
  }
  // Expanded again, the three rows are back and the roll-up is gone.
  const open = press(folded(), ["l"]).state, lines = listLines(draw(open, S79), S79).filter((line) => line.trim());
  assert.deepEqual(lines, [
    `>▾ ● ${DESKTOP_EXPERT.padEnd(63)}claude`,
    `     ● ${DESKTOP_A.padEnd(61)}claude    !`,
    `     ● ${DESKTOP_B.padEnd(61)}claude    !`,
  ]);
});

test("collapsing a root in a roster of several clusters hides the rows below it, keeps the selection on it and gives it the roll-up and the closed mark, wherever the shared grouping then puts the row", () => {
  const before = selecting(fresh(), DESKTOP_EXPERT), state = press(before, ["h"]).state;
  assert.equal(state.selected, before.selected, "the selection is the same instance");
  for (const sz of [S79, S60]) {
    const lines = listLines(draw(state, sz), sz), drawn = (name) => lines.filter((line) => line.includes(` ${name} `) || line.trimEnd().endsWith(` ${name}`));
    assert.deepEqual([drawn(DESKTOP_A).length, drawn(DESKTOP_B).length], [0, 0], "the rows below it are not drawn");
    for (const name of [KERNEL_EXPERT, KERNEL_DEV, REVIEWER, MAINTAINER, EXPERT_TUI]) assert.equal(drawn(name).length, 1, `${name} is still drawn`);
    const root = drawn(DESKTOP_EXPERT);
    assert.equal(root.length, 1);
    assert.equal(root[0].startsWith(">▸ ● "), true, "selected, closed");
    assert.equal(root[0].endsWith("claude        !2"), true, "two rows wait below it");
    assert.equal(lines.filter((line) => line.startsWith(">")).length, 1);
  }
  // A filter draws every match whatever is collapsed, and leaves the collapse as it is.
  const filtered = press(state, ["/", "p", "a", "n", "e", "l", "enter"]).state, matched = listLines(draw(filtered, S79), S79).filter((line) => line.trim());
  assert.equal(matched.some((line) => line.includes(DESKTOP_A)), true, "a match under a collapsed row is drawn");
  assert.equal(matched.some((line) => line.includes(KERNEL_EXPERT) || line.includes(MAINTAINER) || line.includes(DESKTOP_B)), false, "and what does not match is not");
  const cleared = listLines(draw(press(filtered, ["escape"]).state, S79), S79);
  assert.equal(cleared.some((line) => line.includes(DESKTOP_A)), false, "with the filter cleared the row is collapsed as before");
  assert.equal(cleared.some((line) => line.includes(`▸ ● ${DESKTOP_EXPERT}`)), true);
});

test("a waiting claim on a stale deployment is not drawn: no mark on the row, no count in the header, no `needs` line", () => {
  for (const sz of [S120, S79]) {
    const stale = selecting(stateOf(failed(entry(), STALE("the mirror did not answer"))), KERNEL_DEV), d = draw(stale, sz);
    assert.equal(d.lines[0].includes("input"), false);
    assert.equal(d.lines.some((line) => line.includes("acme-ledger-developer-note")), true, "the row is drawn");
    for (const line of d.lines.slice(3, sz.rows - 2)) assert.equal(/claude\s+!\d*(\u2502|$)/.test(line), false, "no waiting mark");
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
  const rows = (second) => [instanceRow("soul", "aaa-anchor"), instanceRow("soul", second, { home: `${HOME}/zzz` })];
  for (const ascii of [false, true]) {
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
        const cells = subject.cells[r], word = cellIndexOf(cells.slice(0, list), "claude");
        assert.equal(word > 0, true, `${at}: the word is still drawn in its column`);
        assert.equal(word, cellIndexOf(control.cells[r].slice(0, list), "claude"), `${at}: and the column did not move`);
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
      assert.equal(d.lines[sz.rows - 2], "─".repeat(wide ? list : sz.cols) + (wide ? `┴${"─".repeat(sz.cols - list - 1)}` : ""), at);
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
      assert.equal(cellText(d, sz.rows - 3, 0, pane).trim(), cutNote(onScreen[0], 199 - onScreen.at(-1)), `${at}: the pane's last row says what is cut off`);
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
  const rows = [...Array.from({ length: 199 }, (_, i) => instanceRow("soul", `inst-${String(i).padStart(3, "0")}`)), instanceRow("soul", "inst-199", { running: false, runtimeState: "unsupported" })];
  const top = stateOf(observed(rows)), end = press(top, ["G"]).state;
  const column = (d, word) => cellText(d, bodyRows(S80).find((r) => cellText(d, r, 0, 38).endsWith(word)), 0, 38).length - word.length;
  assert.equal(draw(end).lines.some((line) => line.includes("inst-199")), true);
  assert.equal(column(draw(top), "claude"), column(draw(end), "unsupported"));
  assert.equal(column(draw(top), "claude"), column(draw(end), "claude"));
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

test("the detail's state line holds the kernel's own name for the state, and the kernel's runtimeError on the rows under it, as a quote", () => {
  const state = selecting(golden(), EXPERT_TUI);
  for (const sz of [S160, S120, S80]) {
    const detail = detailOf(state, sz), rows = fact(detail, "state").rows;
    assert.equal(rows[0], "unreachable", `${sz.cols}`);
    assert.equal(rows.slice(1).join(" "), `"${textOf(shown(UNREACHABLE))}"`, `${sz.cols}: the error, whole, in quotation marks, on rows of its own`);
    assert.equal(labels(detail)[labels(detail).indexOf("state") + 1], "harness", "and no line of its own label");
  }
  assert.equal(fact(detailOf(state, S80), "state").rows.length > 2, true, "at 80 columns it wraps");
  assert.deepEqual(fact(detailOf(selecting(golden(), REVIEWER)), "state").rows, ["stopped"]);
  const shell = stateOf(observed([instanceRow("soul", "sh", { running: false, runtimeState: "shell" })]));
  assert.deepEqual(fact(detailOf(shell), "state").rows, ["shell"]);
  const unsupported = stateOf(observed([instanceRow("soul", "old", { running: false, runtimeState: "unsupported", runtimeError: "E_HERDR_REMOVED: gone" })]));
  assert.deepEqual(fact(detailOf(unsupported), "state").rows, ["unsupported", '"E_HERDR_REMOVED: gone"']);
});

test("the detail's held line is the sentence the shared home gives for a home the kernel holds, wrapped under its label", () => {
  const rows = STATES().map(([, row]) => row), all = stateOf(observed(rows));
  for (const name of ["f-spawning", "g-half-spawned", "h-half-retired"]) {
    const state = selecting(all, name), acts = instanceActs(panelRow(state, name)), sentence = (acts.blocked ?? acts.limited).sentence;
    assert.equal(typeof sentence === "string" && sentence.includes(name), true);
    for (const sz of [S160, S80, S60]) {
      const d = draw(sz.cols < WIDE ? press(state, ["tab"], sz).state : state, sz), held = fact(factsOf(detailLines(d, sz)), "held");
      assert.equal(held.rows.join(" "), textOf(shown(sentence)), `${name} at ${sz.cols}`);
      if (sz.cols === 80) assert.equal(held.rows.length > 1, true, `${name}: a sentence longer than the pane wraps`);
    }
  }
  for (const name of ["a-running", "b-stopped", "c-shell", "d-unreachable", "e-unsupported"]) assert.equal(fact(detailOf(selecting(all, name)), "held"), null, `${name} is not held`);
});

test("the detail's state line of a home the kernel holds is the held home's state, the same word the list shows at the row's right edge", () => {
  const rows = STATES().map(([, row]) => row), all = stateOf(observed(rows));
  for (const name of ["f-spawning", "g-half-spawned", "h-half-retired"]) {
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
    ` oats  acme-platfo…  ${COUNTS}`,
    " 1 Instances   2 Souls   3 Capabilities                          read 10:00:00",
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
    "", "", "", "", "", "", "", "",
    "─".repeat(79),
    " Tab detail   Esc close   r refresh   ? help   q quit",
  ]);
  d.cells.forEach((line) => line.forEach((cell) => assert.equal(cell.style.reverse, false, "no list row is drawn under the page")));
  for (const key of ["tab", "escape"]) assert.deepEqual(draw(press(paged, [key], S79).state, S79).lines, draw(list, S79).lines, `${key} returns to the list`);
  // At 60x15 the page is taller than its room: it scrolls with the movement keys and says what is cut off.
  const small = draw(paged, S60);
  assert.equal(small.extent > small.room, true);
  assert.equal(small.lines[12].trim(), cutNote(0, small.extent - (small.room - 1)));
  const scrolled = press(paged, ["G"], S60).state, end = draw(scrolled, S60);
  assert.equal(end.lines[12].trim(), cutNote(end.extent - (end.room - 1), 0));
  assert.equal(end.lines.slice(3, 12).some((line) => line.trim().startsWith("home ")), true, "the last fact is on the screen");
  assert.equal(draw(press(scrolled, ["g"], S60).state, S60).lines[3], ` > ${KERNEL_DEV}`);
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
  assert.equal(draw(golden(), S80).lines[23], " / filter   Tab detail   r refresh   w workspaces   ? help   q quit");
  assert.equal(draw(golden(), S60).lines[14], " / filter   Tab detail   r refresh   ? help   q quit", "at 60 columns `workspaces` is the one given up");
  assert.equal(draw(press(golden(), ["tab"]).state, S80).lines[23], " Tab detail   Esc close   r refresh   ? help   q quit");
  assert.equal(draw(press(golden(), ["?"]).state, S80).lines[23], " Esc close   ? help   q quit");
  for (const sz of SIZES) for (const state of [golden(), press(golden(), ["tab"]).state, press(golden(), ["?"]).state, press(golden(), ["/", "t", "u", "i", "enter"]).state, stateOf(), stateOf(observed([]))]) {
    assert.equal(cellText(draw(state, sz), sz.rows - 1).endsWith("? help   q quit"), true, `${sz.cols}x${sz.rows}: help and quit last, always`);
  }
});

test("the footer is read from the effective table: a key the user's tui.json gave is the one shown, and an action it unbound is gone", () => {
  const config = effectiveConfig({ keys: { quit: ["x"], filter: [] } });
  assert.equal(config.ok, true);
  for (const sz of SIZES) {
    const footer = draw(golden({ actions: config.actions }), sz).lines[sz.rows - 1];
    assert.equal(footer, " Tab detail   r refresh   w workspaces   ? help   x quit", `${sz.cols}x${sz.rows}`);
    assert.equal(footer.includes("filter") || footer.includes("q quit") || footer.includes("/"), false);
  }
  const rebound = effectiveConfig({ keys: { help: ["f1"], detail: ["d", "tab"], refresh: ["f5", "r"], close: ["backspace"] } });
  assert.equal(draw(golden({ actions: rebound.actions }), S80).lines[23], " / filter   d detail   F5 refresh   w workspaces   F1 help   q quit");
  assert.equal(draw(press(golden({ actions: rebound.actions }), ["d"]).state, S80).lines[23], " d detail   Backspace close   F5 refresh   F1 help   q quit");
});

test("when the footer has no room for every action it shows as many as fit, and `help` and `quit` are still the last two", () => {
  const kept = press(fresh(), ["/", "t", "u", "i", "enter"]).state;
  const at60 = draw(kept, S60).lines[14], at120 = draw(kept, S120).lines[39];
  assert.equal(at120.endsWith("r refresh   w workspaces   ? help   q quit"), true, "with room, every action that applies");
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
    assert.equal(empty.startsWith(" /"), true);
    assert.equal(footer.startsWith(" /ledger dev  "), true, `${sz.cols}: ${footer}`);
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
    assert.equal(cellText(d, sz.rows - 1).startsWith(" /maint  "), true);
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
      assert.equal(line.startsWith(" /abcdefghij"), true);
      assert.equal(line.length <= sz.cols - 1, true, `${sz.cols}: the row ends inside the screen`);
    }
    assert.match(editing, /Enter keep {3}Esc clear$/, `${sz.cols}`);
    assert.equal(after.endsWith("? help   q quit"), true, `${sz.cols}`);
    const drawn = (line) => /^ \/([a-j]*)(\S*)/.exec(line);
    if (sz.cols < 250) {
      for (const line of [editing, after]) { assert.equal(drawn(line)[2], cut, `${sz.cols}: the query ends in the cut mark`); assert.equal(query.startsWith(drawn(line)[1]), true); }
    } else assert.equal(drawn(editing)[1], query, "with the room, the query whole");
    assert.equal(drawn(after)[1].length < 40, true, "a kept filter takes a few cells of the footer");
  }
});

// ── The help, at the smallest width ──────────────────────────────────────────────────────────────

test("at 60 columns, the smallest width the frame is drawn at, the help still names every command whole: what this version does not do is said with the oats command that does it", () => {
  for (const ascii of [false, true]) {
    const lines = helpLines(golden({ ascii }), size(60, 80)), cut = glyphsOf(ascii).cut;
    for (const command of [...NOT_YET.map((entry_) => entry_.command), ...VIEWS.flatMap((view) => view.commands)]) {
      assert.equal(lines.some((line) => line.includes(command)), true, `${command} is whole at 60 columns${ascii ? ", in ASCII" : ""}`);
    }
    for (const line of lines) assert.equal(line.endsWith(cut), false, `no row of the help is cut at 60 columns: ${line.trim()}`);
  }
});

// ── The help ─────────────────────────────────────────────────────────────────────────────────────

const HELP_SIZE = size(100, 70);
function helpLines(state, sz = HELP_SIZE) {
  const d = draw(press(state, ["?"], sz).state, sz);
  assert.equal(d.extent <= d.room, true, "the whole help is on this screen");
  return d.lines.slice(3, sz.rows - 2);
}
/** A table row of the help: `left`, a gap, `right`. */
const pair = (lines, left, right) => lines.some((line) => { const text = line.trim(); return text.startsWith(`${left} `) && text.endsWith(` ${right}`) && text.slice(left.length, text.length - right.length).trim() === ""; });

test("the help lists every action of the table it is given with its keys, and an unbound action as `(no key)`", () => {
  const lines = helpLines(golden());
  for (const action of ACTIONS) assert.equal(pair(lines, keysLabel(action), action.label), true, `${action.id}: ${keysLabel(action)}`);
  for (const [keys, label] of [["Up, k", "up"], ["Down, j", "down"], ["g, Home", "first"], ["G, End", "last"], ["PageUp", "page up"], ["PageDown", "page down"], ["Tab", "detail"], ["/", "filter"], ["r", "refresh"], ["1", "instances"], ["w", "workspaces"], ["Enter", "open"], ["?", "help"], ["Esc", "close"], ["q, Ctrl+C", "quit"], ["Ctrl+Z", "suspend"], ["Ctrl+L", "redraw"]]) {
    assert.equal(pair(lines, keys, label), true, `${keys} ${label}`);
  }
  const config = effectiveConfig({ keys: { quit: ["x"], filter: [], refresh: ["r", "f5"], suspend: [] } });
  const changed = helpLines(golden({ actions: config.actions }));
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
  const keys = lines.slice(lines.findIndex((line) => line.trim() === "Keys") + 1, lines.findIndex((line) => line.trim() === "Marks")).filter((line) => line.trim());
  assert.equal(keys.length, table.length, "one row per action");
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
    assert.equal(section.some((line) => line.startsWith(`${marks.open} ${marks.closed}`) || (line.split(" ")[0] === marks.open && section.some((other) => other.split(" ")[0] === marks.closed))), true, "the two disclosure marks");
    for (const [name, mark] of Object.entries(marks)) assert.equal(section.some((line) => line.split("  ")[0].split(" ").includes(mark) || line.startsWith(mark)), true, `${name}: ${mark}`);
  }
});

test("the help says, for the two views that cannot be opened yet, what to run instead", () => {
  const lines = helpLines(golden());
  const line = (name) => lines.find((text) => text.trim().startsWith(name));
  assert.equal(line("2 Souls").includes("oats souls") && line("2 Souls").includes("oats spawn <soul>"), true);
  assert.equal(line("3 Capabilities").includes("oats capabilities"), true);
  assert.equal(typeof line("1 Instances"), "string");
  for (const view of VIEWS) for (const command of view.commands) assert.equal(line(view.name).includes(command), true, `${view.name}: ${command}`);
  assert.deepEqual(VIEWS.map((view) => view.name), ["1 Instances", "2 Souls", "3 Capabilities"], "the views the frame names");
});

test("the help's last section, `Not in this version`, names every act this version does not have with the oats command that does it", () => {
  for (const ascii of [false, true]) for (const sz of [HELP_SIZE, size(60, 80), size(79, 70), size(200, 70)]) {
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
    for (const command of ["oats session attach --home <home>", "oats instance stop", "oats session start", "oats retire", "oats server connect", "oats server check", "oats server remove", "oats tui --dir <path>"]) {
      assert.equal(section.some((line) => line.includes(command)), true, `the spec's ${command}`);
    }
  }
});

test("the help scrolls: at 60x15 it does not fit, its last row says what is cut off, and the movement keys move it to its end and back", () => {
  const sz = S60, open = press(golden(), ["?"], sz).state, d = draw(open, sz);
  assert.equal(d.extent > d.room, true);
  const visible = d.room - 1;
  assert.equal(d.lines[3].trim(), "Keys");
  assert.equal(d.lines[sz.rows - 3].trim(), cutNote(0, d.extent - visible));
  const down = draw(press(open, ["j"], sz).state, sz);
  assert.equal(down.lines[sz.rows - 3].trim(), cutNote(1, d.extent - visible - 1));
  assert.equal(down.lines[3], d.lines[4], "one row down");
  const paged = draw(press(open, ["pagedown"], sz).state, sz);
  assert.notEqual(paged.lines[3], d.lines[3]);
  const ended = press(open, ["j", "G"], sz).state, end = draw(ended, sz);
  assert.equal(end.lines[sz.rows - 3].trim(), cutNote(d.extent - visible, 0));
  assert.equal(end.lines.slice(3, sz.rows - 3).some((line) => line.includes(NOT_YET.at(-1).command)), true, "the last section is on the screen");
  assert.deepEqual(draw(press(ended, ["G", "j", "pagedown"], sz).state, sz).lines, end.lines, "it stops at its end");
  assert.deepEqual(draw(press(ended, ["g"], sz).state, sz).lines, d.lines, "and goes back to its start");
  assert.deepEqual(draw(press(ended, ["k"], sz).state, sz).lines[sz.rows - 3].trim(), cutNote(d.extent - visible - 1, 1));
  // Every row of the help is reached by scrolling: nothing is lost behind the note.
  const whole = helpLines(golden(), size(60, 80)).map((line) => line.trim()).filter(Boolean), seen = new Set();
  let state = open;
  for (let i = 0; i < d.extent; i++) { for (const line of draw(state, sz).lines.slice(3, sz.rows - 3)) seen.add(line.trim()); state = press(state, ["j"], sz).state; }
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
    const big = size(100, 80), lines = draw(press(state, ["日"], big).state, big).lines.slice(3, big.rows - 2);
    for (const id of Object.keys(keys)) assert.ok(lines.some((line) => line.trim().startsWith(`${labelOf(id)}  `)), `the help lists ${id} under ${labelOf(id)}`);
    assert.ok(lines.some((line) => line.trim() === `${labelOf("close").split(", ")[0]} or 日 closes this help`), "the closing line names the two keys");
    // The meanings stand in one column, whatever cells the keys take.
    const d2 = draw(press(state, ["日"], big).state, big);
    const columns = new Set(["up", "help", "quit", "close"].map((id) => { const word = made.actions.find((action) => action.id === id).label.split(" ")[0]; const r = d2.cells.findIndex((line) => line.map((cell) => cell.text).join("").trim().startsWith(`${labelOf(id)}  `)); return cellIndexOf(d2.cells[r], word); }));
    assert.equal(columns.size, 1, `one column for the meanings: ${[...columns]}`);
  }
});

test("help and quit are last and always: a kept filter gives way to them, down to nothing, however long their keys are", () => {
  const long = effectiveConfig({ keys: { help: ["ctrl+alt+shift+f11"], quit: ["ctrl+alt+shift+f12"] } });
  assert.equal(long.ok, true);
  const kept = (query, actions, sz) => cellText(draw(press(golden({ actions }), ["/", ...query, "enter"], sz).state, sz), sz.rows - 1);
  assert.equal(kept("a", long.actions, S60), " /a       Ctrl+Alt+Shift+F11 help   Ctrl+Alt+Shift+F12 quit");
  assert.equal(kept("acme-ledger", long.actions, S60), " /acme…   Ctrl+Alt+Shift+F11 help   Ctrl+Alt+Shift+F12 quit", "the query is cut, the two hints are whole");
  // With room, the kept filter has its whole place and the other hints follow it.
  assert.equal(kept("a", long.actions, S80), " /a                      Ctrl+Alt+Shift+F11 help   Ctrl+Alt+Shift+F12 quit");
  assert.equal(kept("a", ACTIONS, S60), " /a                      / filter   ? help   q quit", "of the other hints, as many as fit");
  assert.equal(kept("a", ACTIONS, S80), " /a                      / filter   Tab detail   Esc close   ? help   q quit");
  // Keys so long that the two hints fill the row: no kept filter is drawn, and nothing passes the edge.
  const longest = effectiveConfig({ keys: { help: ["ctrl+alt+shift+pagedown"], quit: ["ctrl+alt+shift+pageup"] } });
  const row = kept("a", longest.actions, S60);
  assert.equal(row, " Ctrl+Alt+Shift+PageDown help   Ctrl+Alt+Shift+PageUp quit");
  assert.equal(textWidth(row) <= 60 - 1, true);
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
/** The body of a frame at 80 columns: the list's rows beside the detail's, the panes' rule between. */
const beside = (list, detail, bar = "│") => Array.from({ length: 19 }, (_, i) => `${(list[i] ?? "").padEnd(38)}${bar}${detail[i] ?? ""}`);
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
    " oats  acme-platform  +1 machine                           3 running  2 stopped",
    " 1 Instances   2 Souls   3 Capabilities                           read 10:00:00",
    `${"─".repeat(38)}┬${"─".repeat(41)}`,
    ...beside([
      " This machine",
      ">▾ ● acme-ledger-expert…  claude",
      "     ● acme-ledger-deve…  claude",
      "",
      "   ○ acme-maintainer-ops  stopped",
      " garnet                 read 10:00:10",
      "   ● acme-ledger-far-a    claude",
      "   ○ acme-ledger-far-b    stopped",
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
    `${"─".repeat(38)}┴${"─".repeat(41)}`,
    FOOTER,
  ]);
  // What the cells say beyond their text: a heading's label is bold and is no row of the selection,
  // the two times and the count of machines are dim.
  for (const [r, label] of [[3, "This machine"], [8, "garnet"]]) {
    for (const cell of d.cells[r].slice(1, 1 + label.length)) assert.equal(cell.style.bold && !cell.style.reverse, true, `${label} is bold`);
    assert.equal(d.cells[r][0].text, " ", "a heading carries no selection mark");
  }
  for (const cell of d.cells[8].slice(24, 37)) assert.equal(cell.style, DIM, "the time of the roster read is dim");
  for (const cell of d.cells[0].slice(22, 32)) assert.equal(cell.style, DIM, "the count of machines is dim");
  assert.equal(cellText(d, 0, 22, 32), "+1 machine");
});

test("this machine and a reached machine at 80x24 in ASCII, cell for cell: the same screen with the rules, the marks and the cut mark in ASCII", () => {
  assert.deepEqual(draw(reached({ ascii: true }), S80).lines, [
    " oats  acme-platform  +1 machine                           3 running  2 stopped",
    " 1 Instances   2 Souls   3 Capabilities                           read 10:00:00",
    `${"-".repeat(38)}+${"-".repeat(41)}`,
    ...beside([
      " This machine",
      ">v * acme-ledger-expe...  claude",
      "     * acme-ledger-de...  claude",
      "",
      "   - acme-maintainer-ops  stopped",
      " garnet                 read 10:00:10",
      "   * acme-ledger-far-a    claude",
      "   - acme-ledger-far-b    stopped",
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
    `${"-".repeat(38)}+${"-".repeat(41)}`,
    FOOTER,
  ]);
});

test("the same view with the machine not reached, at 80x24 in UTF-8 and in ASCII, cell for cell: its heading holds the shared state and short reason and no time, its rows carry the unknown mark and the shared word for unknown, and the detail of one says why under `machine`", () => {
  for (const ascii of [false, true]) {
    const state = press(lost({ ascii }), ["G"]).state, garnet = deploymentOf(state), said = deploymentState(garnet), g = glyphsOf(ascii), marks = marksOf(ascii);
    assert.equal(said.key, "remembered", "the machine answered earlier in the run, and is kept in its workspace");
    const cut = (text, cells) => `${text.slice(0, cells - g.cut.length)}${g.cut}`;
    assert.deepEqual(draw(state, S80).lines, [
      " oats  acme-platform  +1 machine                2 running  1 stopped  2 unknown",
      " 1 Instances   2 Souls   3 Capabilities                           read 10:00:00",
      `${g.rule.repeat(38)}${g.down}${g.rule.repeat(41)}`,
      ...beside([
        " This machine",
        ` ${marks.open} ${marks.running} ${cut(KERNEL_EXPERT, 19)}  claude`,
        `     ${marks.running} ${cut(KERNEL_DEV, 17)}  claude`,
        "",
        `   ${marks.stopped} acme-maintainer-ops  stopped`,
        ` garnet  ${said.text}  ${garnet.short}`,
        `   ${marks.unknown} acme-ledger-far-a    ${UNKNOWN}`,
        `>  ${marks.unknown} acme-ledger-far-b    ${UNKNOWN}`,
      ], [
        "   acme-ledger-far-b",
        "   soul     acme-ledger-developer",
        "   machine  garnet",
        ...wrap(textOf(shown(said.detail)), 28).map((row) => `            ${row}`),
        `   state    ${UNKNOWN}`,
        "            \"garnet did not answer\"",
        "   harness  claude",
        "   work     worktree",
        `   home     ${g.cut}${`instances/${FAR_B}`.slice(g.cut.length - 1)}`,
      ], g.bar),
      `${g.rule.repeat(38)}${g.up}${g.rule.repeat(41)}`,
      FOOTER,
    ]);
  }
  // Nothing of the machine reads as stopped, or as running, that is only not reached.
  const d = draw(lost(), S120);
  for (const name of [FAR_A, FAR_B]) {
    const line = cellText(d, rowOf(d, S120, name), 0, 57);
    assert.equal(line.endsWith(UNKNOWN) && line.trim().startsWith(MARKS.utf8.unknown), true, `${name}: ${line}`);
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
    // is as wide as the widest word, `stopped`; a time ends one cell before the edge.
    const word = pane - 5 - "stopped".length, time = pane - 1 - "read 10:00:10".length;
    assert.deepEqual(listLines(d, sz).slice(0, 9), [
      " This machine",
      placed([0, `>${marks.open} ${marks.running} ${KERNEL_EXPERT}`], [word, "claude"]),
      placed([5, `${marks.running} ${KERNEL_DEV}`], [word, "claude"]),
      "",
      placed([3, `${marks.stopped} ${MAINTAINER}`], [word, "stopped"]),
      placed([1, "garnet"], [time, "read 10:00:10"]),
      placed([3, `${marks.running} ${FAR_A}`], [word, "claude"]),
      placed([3, `${marks.stopped} ${FAR_B}`], [word, "stopped"]),
      "",
    ], at);
    assert.equal(cellText(d, 0).startsWith(" oats  acme-platform  +1 machine  "), true, `${at}: ${cellText(d, 0)}`);
    assert.equal(cellText(d, 0).endsWith("  3 running  2 stopped"), true, at);
    assert.equal(cellText(d, 1).endsWith(" read 10:00:00"), true, `${at}: the header's time is this machine's own read`);
    assert.deepEqual([d.cells[8][pane - 2].text, d.cells[8][pane - 1].text], ["0", " "], `${at}: the heading's time ends one cell before the pane's edge`);
    if (sz.cols >= WIDE) {
      for (const r of bodyRows(sz)) assert.equal(d.cells[r][pane].text, g.bar, `${at}: row ${r} has the panes' rule at column ${pane}`);
      assert.equal(cellText(d, 5, pane + 1).trim(), "machine  This machine", `${at}: the detail's machine line`);
    } else assert.equal(d.lines.some((line) => line.includes("soul ")), false, `${at}: no detail beside the list`);
    assert.deepEqual(d.cells[4].map((cell) => cell.style.reverse), Array.from({ length: sz.cols }, (_, x) => x < pane), `${at}: the selected row's bar is the pane`);
    assert.equal(cellText(d, sz.rows - 1), sz.cols >= 79 ? FOOTER : FOOTER_60, at);
  }
});

test("at 60 columns wider counts leave the count of machines no room and the workspace's name stays whole; two machines are counted once each, and a view of this machine alone says nothing of machines", () => {
  // Wider counts take the room at 60 columns: the name stays whole and `+1 machine` is gone.
  const d = draw(lost(), S60);
  assert.equal(d.lines[0], ` oats  acme-platform${" ".repeat(8)}2 running  1 stopped  2 unknown`);
  assert.equal(draw(lost(), S80).lines[0].includes("  +1 machine  "), true, "with the room it is there");
  // Two machines are counted once each, whatever number of deployments each holds.
  const two = heard(local(), answered(group(), quartz(), quartz({ id: "quartz:acme-8", target: { workspace: "/srv/acme-two", sshHost: "quartz.example" }, instances: [] })), T1);
  assert.equal(draw(two, S120).lines[0].startsWith(" oats  acme-platform  +2 machines  "), true, draw(two, S120).lines[0]);
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
  const line = textOf(shown(note));
  for (const [sz, room] of [[S80, 34], [S60, 56], [S120, 53]]) {
    const d = draw(state, sz), pane = paneOf(sz), word = pane - 5 - "stopped".length, time = pane - 14, at = `${sz.cols}x${sz.rows}`;
    const rows = wrap(line, room);
    assert.deepEqual(listLines(d, sz).slice(0, rows.length + 5), [
      placed([1, "garnet"], [time, "read 10:00:25"]),
      ...rows.map((row) => `   ${row}`),
      placed([0, `>  ● ${FAR_A}`], [word, "claude"]),
      placed([3, `○ ${FAR_B}`], [word, "stopped"]),
      placed([1, "quartz"], [time, "read 10:00:25"]),
      placed([3, `● ${FAR_Q}`], [word, "claude"]),
    ], at);
    if (sz === S80) assert.equal(rows.length, 2, "at 80 columns the note wraps");
    assert.equal(cellText(d, 0).startsWith(" oats  billing  2 machines  "), true, `${at}: ${cellText(d, 0)}`);
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
    assert.equal(cellText(d, 5, 0, pane).startsWith(`>  ${marksOf(ascii).running} ${FAR_A}`), true, `${at}: then the list, with no heading: ${d.lines[5]}`);
    assert.equal(d.cells.slice(5, sz.rows - 2).some((line) => line.slice(0, pane).some((cell) => cell.style.bold)), false, `${at}: and no heading anywhere in it`);
    assert.equal(d.page, sz.rows - 7, `${at}: the note and its rule take two rows of the body`);
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
    assert.equal(cellText(d, reason.rows.at(-1) + 3, 0, paneOf(sz)).trim().startsWith(`? ${FAR_A}`) || cellText(d, reason.rows.at(-1) + 3, 0, paneOf(sz)).startsWith(`>  ? ${FAR_A}`), true, `${at}: the kept rows follow, unknown`);
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

test("the reason of a row that cannot be addressed on a machine that was not reached is drawn once, as the quote under its state, with no `held` line; on a reached machine the `held` line holds the shared sentence", () => {
  const outcomes = { "an answer that is an error": TIMEOUT, "a read that threw": { thrown: "spawn oats ENOENT" } };
  for (const [kind, outcome] of Object.entries(outcomes)) for (const sz of [S160, S80]) {
    const state = selecting(heard(reached(), outcome, T2), FAR_B, sz), row = panelRow(state, FAR_B), acts = instanceActs(row), at = `${kind} at ${sz.cols}`;
    assert.equal(row.addressable === false && acts.blocked !== null && acts.blocked.sentence === row.runtimeError, true, `${at}: the shared home blocks the row with the very text it carries as its runtimeError`);
    const d = draw(state, sz), detail = factsOf(detailLines(d, sz)), quote = textOf(shown(`"${row.runtimeError}"`));
    assert.equal(fact(detail, "held"), null, `${at}: no held line`);
    assert.deepEqual([fact(detail, "state").rows[0], fact(detail, "state").rows.slice(1).join(" ")], [UNKNOWN, quote], `${at}: the reason stands under the state, in quotation marks`);
    const whole = detailLines(d, sz).map((line) => line.trim()).filter(Boolean).join(" ");
    assert.equal(whole.split(quote).length - 1, 1, `${at}: once`);
    assert.deepEqual(labels(detail), ["soul", "machine", "state", "harness", "work", "home"], at);
    // A row of the same machine that can be addressed has the quote and nothing held either.
    const other = factsOf(detailLines(draw(selecting(state, FAR_A, sz), sz), sz));
    assert.equal(fact(other, "held") === null && fact(other, "state").rows.slice(1).join(" ") === quote, true, `${at}: ${FAR_A}`);
  }
  // Reached: the kernel does not report the row addressable, and the shared sentence says so.
  for (const sz of [S160, S80]) {
    const state = selecting(reached(), FAR_B, sz), acts = instanceActs(panelRow(state, FAR_B)), detail = factsOf(detailLines(draw(state, sz), sz));
    assert.equal(acts.blocked !== null && typeof acts.blocked.sentence === "string", true);
    assert.equal(fact(detail, "held").rows.join(" "), textOf(shown(acts.blocked.sentence)), `${sz.cols}: the held line is the shared sentence`);
    assert.deepEqual(fact(detail, "state").rows, ["stopped"], `${sz.cols}: and the state is the row's own, with no quote`);
    assert.equal(fact(factsOf(detailLines(draw(selecting(reached(), FAR_A, sz), sz), sz)), "held"), null, `${sz.cols}: a row that can be addressed is not held`);
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
    " oats  workspaces",
    " 1 Instances   2 Souls   3 Capabilities",
    "─".repeat(80),
    placed([2, "*"], [4, "acme-platform"], [32, platform.place], [79 - platform.notLiveText.length, platform.notLiveText]),
    `  ${UNMATCHED_SECTION}`,
    placed([4, "quartz"], [32, never.place]),
    "  On this machine, not opened",
    placed([0, ">"], [4, "acme-billing"], [32, "~/Agents/acme-billing"]),
    placed([4, "acme-docs"], [32, "~/Agents/acme-docs"]),
    ...Array.from({ length: 13 }, () => ""),
    "─".repeat(80),
    " Enter open   / filter   r refresh   Esc close   ? help   q quit",
  ]);
  // The selection is a bar over the whole width with `>` in its first cell; no other row has either.
  assert.deepEqual(d.cells.flatMap((line, r) => (line.some((cell) => cell.style.reverse) ? [r] : [])), [7]);
  assert.equal(d.cells[7].every((cell) => cell.style.reverse), true, "over the whole width");
  assert.deepEqual(bodyRows(S80).filter((r) => d.cells[r][0].text === ">"), [7]);
  // The two headings and a place are dim; what is not live is not: it is what a person looks for.
  for (const [r, from, to] of [[4, 2, 2 + UNMATCHED_SECTION.length], [6, 2, 2 + OFFERED_SECTION.length], [3, 32, 32 + platform.place.length], [8, 32, 50]]) for (const cell of d.cells[r].slice(from, to)) assert.equal(cell.style, DIM, `row ${r}`);
  for (const cell of d.cells[3].slice(79 - platform.notLiveText.length, 79)) assert.equal(cell.style.dim, false);
  // While the switcher is shown the header names no workspace, counts nothing and has no time, and
  // none of the three views is the current one.
  for (const name of ["1 Instances", "2 Souls", "3 Capabilities"]) for (const cell of d.cells[1].slice(d.lines[1].indexOf(name), d.lines[1].indexOf(name) + name.length).filter((c) => c.text !== " ")) assert.equal(cell.style, DIM, `${name} is dim`);
  // Before any key the selection is on the first choice, which is also the open one.
  const first = draw(choosing(), S80);
  assert.equal(first.lines[3], placed([0, ">"], [2, "*"], [4, "acme-platform"], [32, platform.place], [79 - platform.notLiveText.length, platform.notLiveText]));
  assert.equal(first.cells[3].every((cell) => cell.style.reverse), true);
});

test("the switcher at 80x24 in ASCII, cell for cell: the rules in ASCII, and between a workspace's machines the shared home's own separator, as it gives it", () => {
  const state = press(choosing({ ascii: true }), ["j", "j"]).state, [platform, never] = choicesOf(state);
  const d = draw(state, S80);
  // The place is the shared home's line, drawn through shown(): the TUI chooses none of its characters.
  assert.deepEqual(d.lines, [
    " oats  workspaces",
    " 1 Instances   2 Souls   3 Capabilities",
    "-".repeat(80),
    placed([2, "*"], [4, "acme-platform"], [32, textOf(shown(platform.place))], [79 - platform.notLiveText.length, platform.notLiveText]),
    `  ${UNMATCHED_SECTION}`,
    placed([4, "quartz"], [32, never.place]),
    "  On this machine, not opened",
    placed([0, ">"], [4, "acme-billing"], [32, "~/Agents/acme-billing"]),
    placed([4, "acme-docs"], [32, "~/Agents/acme-docs"]),
    ...Array.from({ length: 13 }, () => ""),
    "-".repeat(80),
    " Enter open   / filter   r refresh   Esc close   ? help   q quit",
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
    assert.equal(d.lines[sz.rows - 2], g.rule.repeat(sz.cols), `${at}: one pane: no joint in the rules`);
    assert.equal(d.cells[7].every((cell) => cell.style.reverse), true, `${at}: the selection is the whole width`);
    assert.equal(d.lines[sz.rows - 1], sz === S60 ? " Enter open   / filter   r refresh   ? help   q quit" : " Enter open   / filter   r refresh   Esc close   ? help   q quit", at);
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
    const d = draw({ ...state, ascii }, sz), said = d.lines.slice(3, sz.rows - 2).filter(Boolean), at = `${sz.cols}x${sz.rows}${ascii ? " ascii" : ""}`;
    // The second sentence and its command on one row where they fit inside the margins (63 columns), else the command on a row of its own: never cut.
    assert.deepEqual(said, sz.cols >= 63 ? ["  No workspace to show.", "  Start it in a deployment, or name one: oats tui --dir <path>"] : ["  No workspace to show.", "  Start it in a deployment, or name one:", "  oats tui --dir <path>"], at);
    assert.equal(d.lines[3], "  No workspace to show.", `${at}: from the first row of the body`);
    for (const r of [3, 4]) for (const cell of d.cells[r].filter((c) => c.text !== " ")) assert.equal(cell.style, DIM, `${at}: dim, as the list's own empty line is`);
    assert.equal(d.cells.some((line) => line.some((cell) => cell.style.reverse)) || bodyRows(sz).some((r) => d.cells[r][0].text === ">"), false, `${at}: nothing is selected`);
    assert.equal(d.lines[0], " oats  workspaces", at);
    assert.equal(d.lines[sz.rows - 1], " Enter open   / filter   r refresh   ? help   q quit", `${at}: Esc is not offered: there is no view to go back to`);
    fits(d, sz, at);
  }
});

test("the switcher's filter: `/` opens its field in the footer, a row stays while its name or its place holds what was typed, and a filter that matches nothing says so", () => {
  for (const sz of SIZES) {
    const open = press(choosing(), ["/"], sz).state, typed = press(open, ["d", "o", "c", "s"], sz).state, d = draw(typed, sz), footer = cellText(d, sz.rows - 1), at = `${sz.cols}x${sz.rows}`;
    assert.equal(cellText(draw(open, sz), sz.rows - 1).startsWith(" /"), true, at);
    assert.equal(footer.startsWith(" /docs  "), true, `${at}: ${footer}`);
    assert.match(footer, /Enter keep {3}Esc clear$/, at);
    assert.equal(footer.includes("quit") || footer.includes("help") || footer.includes("open"), false, `${at}: the field takes the footer row`);
    assert.deepEqual(d.lines.slice(3, sz.rows - 2).filter(Boolean).map((line) => line.replace(/ {2,}/g, "  ")), ["  On this machine, not opened", ">  acme-docs  ~/Agents/acme-docs"], `${at}: the one folder that matches, under its heading, selected`);
    assert.equal(d.lines.some((line) => line.includes("acme-billing") || line.includes("quartz") || line.includes("acme-platform") || line.includes(UNMATCHED_SECTION)), false, `${at}: no other choice, and no heading without one`);
  }
  // Kept, the filter stands in the footer and the key that clears it is offered before `refresh`.
  const kept = (sz) => press(choosing(), ["/", "d", "o", "c", "s", "enter"], sz).state;
  assert.equal(draw(kept(S120), S120).lines[39], " /docs                   Enter open   / filter   Esc close   r refresh   ? help   q quit");
  assert.equal(draw(kept(S80), S80).lines[23], " /docs                   Enter open   / filter   Esc close   ? help   q quit");
  assert.equal(draw(kept(S60), S60).lines[14], " /docs                   Enter open   ? help   q quit");
  assert.equal(draw(press(kept(S80), ["escape"]).state, S80).lines[23], " Enter open   / filter   r refresh   Esc close   ? help   q quit", "Esc clears a kept filter first");
  assert.equal(draw(press(kept(S80), ["escape"]).state, S80).lines.filter((line) => line.includes("acme-")).length, 3, "and every choice is back");
  // The place is matched too, and upper case and spaces around what was typed do not matter.
  const by = (keys) => draw(press(choosing(), ["/", ...keys, "enter"]).state, S80).lines.slice(3, 22).filter(Boolean).map((line) => line.trim());
  assert.equal(by(["G", "A", "R", "N", "E", "T"]).length === 1 && by(["G", "A", "R", "N", "E", "T"])[0].includes("acme-platform"), true, "a machine's name finds its workspace");
  assert.deepEqual(by(["q", "u", "a", "r", "t", "z"]).map((line) => line.split(" ")[0]), ["Not", ">"], "an unmatched machine keeps the shared heading over it");
  // Nothing matches: the TUI's line, no choice, and nothing selected.
  for (const keys of [["/", "z", "z", "z"], ["/", "z", "z", "z", "enter"]]) for (const sz of SIZES) {
    const d = draw(press(choosing(), keys, sz).state, sz);
    assert.deepEqual(d.lines.slice(3, sz.rows - 2).filter(Boolean), ["  No workspace matches the filter."], `${keys.length} keys at ${sz.cols}x${sz.rows}`);
    assert.equal(d.cells.slice(3, sz.rows - 2).some((line) => line.some((cell) => cell.style.reverse)), false);
    for (const cell of d.cells[3].filter((c) => c.text !== " ")) assert.equal(cell.style, DIM);
  }
});

test("the switcher's footer offers Esc only when a workspace is open to go back to, and `help` and `quit` are last and always", () => {
  const none = reduce(stateOf(null, { deployment: null, cli: REMOTE_CLI }), { offered: OFFERED }).state;
  assert.equal(draw(choosing(), S80).lines[23], " Enter open   / filter   r refresh   Esc close   ? help   q quit");
  assert.equal(draw(choosing(), S60).lines[14], " Enter open   / filter   r refresh   ? help   q quit", "at 60 columns the last hint is given up");
  assert.equal(draw(none, S80).lines[23], " Enter open   / filter   r refresh   ? help   q quit", "nothing is open: no Esc");
  assert.equal(draw(none, S120).lines[39], " Enter open   / filter   r refresh   ? help   q quit");
  assert.equal(draw(none, S60).lines[14], " Enter open   / filter   r refresh   ? help   q quit");
  // Esc does what the footer says: back to the view with a workspace open, nothing without one.
  assert.deepEqual(draw(press(choosing(), ["escape"]).state, S80).lines, draw(heard(heard(local(), answered(group(), quartz({ probe: UNPROMPTED, workspace: null, instances: [] })), T1), answered(group({ probe: UNPROMPTED }), quartz({ probe: UNPROMPTED, workspace: null, instances: [] })), T2), S80).lines);
  assert.deepEqual(draw(press(none, ["escape"]).state, S80).lines, draw(none, S80).lines);
  // The keys are the effective table's.
  const rebound = effectiveConfig({ keys: { "open-workspace": ["o"], close: ["backspace"], workspaces: ["f2"] } });
  assert.equal(rebound.ok, true);
  assert.equal(draw(press(reached({ actions: rebound.actions }), ["f2"]).state, S80).lines[23], " o open   / filter   r refresh   Backspace close   ? help   q quit");
  assert.equal(draw(reached({ actions: rebound.actions }), S80).lines[23], " / filter   Tab detail   r refresh   F2 workspaces   ? help   q quit");
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
    assert.equal(d.lines[sz.rows - 1], " Enter open   / filter   r refresh   ? help   q quit", "nothing is open: no Esc");
  }
  // More choices than the pane has rows: the line keeps its row, the pane's last row says what is
  // cut off, and every choice comes on the screen as the selection walks down.
  const names = Array.from({ length: 30 }, (_, i) => `acme-${String(i).padStart(2, "0")}`), sz = size(80, 15);
  let state = reduce(gone, { offered: { offered: names.map(folder), limited: false } }).state;
  const seen = new Set();
  for (let i = 0; i < 31; i++) {
    const d = draw(state, sz), body = d.lines.slice(3, 13), at = `after ${i} down`;
    assert.equal(body[0], "  That workspace is no longer listed.", at);
    const selected = body.filter((line) => line.startsWith(">"));
    assert.equal(selected.length, 1, `${at}: the selected choice is on the screen`);
    assert.equal(selected[0].includes(i === 0 ? "acme-platform" : names[i - 1]), true, `${at}: ${selected[0]}`);
    const cut = /^ {2}(?:(\d+) more above)?(?:, )?(?:(\d+) more below)?$/.exec(body[9]);
    assert.notEqual(cut, null, `${at}: the last row says what is cut off: ${body[9]}`);
    const shown_ = body.slice(1, 9).filter(Boolean);
    assert.equal(shown_.length, 8, `${at}: the eight rows between hold choices and their heading`);
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

test("the help says every limit of this version: registering, checking and removing a machine and opening a deployment elsewhere with the oats command that does it, and what no command lifts in sentences of its own", () => {
  for (const ascii of [false, true]) for (const sz of [HELP_SIZE, size(60, 80), size(79, 70), size(200, 70)]) {
    const text = helpLines(reached({ ascii }), sz).map((line) => line.trim()), at = `${sz.cols}x${sz.rows}${ascii ? " ascii" : ""}`;
    const machines = text.indexOf("Machines"), last = text.indexOf("Not in this version");
    assert.equal(machines > text.indexOf("Views") && last > machines, true, `${at}: Machines stands between Views and what is not in this version`);
    // The sentences, each whole when its rows are joined, in order, and nothing else in the section.
    assert.equal(text.slice(machines + 1, last).filter(Boolean).join(" "), MACHINES.join(" "), at);
    const section = text.slice(last + 1);
    for (const [what, command] of [["register a machine", "oats server connect <id> --ssh <alias>"], ["check a machine", "oats server check <id>"], ["remove a machine", "oats server remove <id>"], ["open a deployment outside ~/Agents", "oats tui --dir <path>"]]) {
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
    assert.equal(d.lines[0], " oats  workspaces", `${at}: no workspace is named, nothing is counted`);
    assert.equal(d.lines[1], " 1 Instances   2 Souls   3 Capabilities", `${at}: and no time`);
    for (const cell of d.cells[1].filter((c) => c.text !== " ")) assert.equal(cell.style, DIM, `${at}: none of the three views is the current one`);
    assert.equal(d.lines[3].trim(), "Keys", at);
    assert.equal(d.lines[sz.rows - 1], " Esc close   ? help   q quit", at);
    for (const key of ["escape", "?"]) assert.deepEqual(draw(press(helping, [key], sz).state, sz).lines, draw(under, sz).lines, `${at}: ${key} returns to the switcher`);
    // Over the list the header is the workspace's, and the help is the same help.
    const over = draw(press(reached(), ["?"], sz).state, sz);
    assert.equal(over.lines[0].startsWith(" oats  acme-platform  "), true, at);
    assert.equal(over.lines[sz.rows - 1], " Esc close   ? help   q quit", at);
    assert.deepEqual(over.lines.slice(2, sz.rows - 1), d.lines.slice(2, sz.rows - 1), `${at}: the same rows under both headers`);
    assert.equal(over.cells[1][1].style.dim, false, `${at}: over the list, Instances is the current view`);
  }
  // With nothing open, the help still opens and closes over the switcher.
  const none = stateOf(null, { deployment: null }), helping = press(none, ["?"]).state;
  assert.equal(draw(helping, S80).lines[0], " oats  workspaces");
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
  assert.equal(draw(one, S80).lines[0], placed([1, "oats"], [7, "acme-platform"], [22, "+1 machine"], [59, "3 running  2 stopped"]));
  assert.equal(draw(two, S80).lines[0], placed([1, "oats"], [7, "acme-platform"], [22, "+2 machines"], [59, "4 running  2 stopped"]));
  assert.deepEqual(panelOf(one, AT).deployments.map((d) => d.local), [true, false], "this machine's deployment and the machine's, by the shared entries' own word");
  for (const cell of draw(two, S80).cells[0].slice(22, 33)) assert.equal(cell.style, DIM);
  assert.deepEqual(machinesOf(local()), { here: true, machines: 0, machine: null }, "this machine alone: nothing follows the name");
  assert.equal(draw(local(), S80).lines[0], placed([1, "oats"], [7, "acme-platform"], [59, "2 running  1 stopped"]));
});

test("a view that holds no deployment of this machine and one machine says `on <machine>` after the workspace's name: nothing else names the machine, since such a view has no heading", () => {
  const state = onGarnet();
  assert.equal(state.open, GARNET);
  assert.deepEqual(machinesOf(state), { here: false, machines: 1, machine: "garnet" });
  assert.deepEqual(panelOf(state, AT).deployments.map((d) => [d.local, d.machine]), [[false, "garnet"]], "one deployment, not this machine's, named by the shared entry");
  const d = draw(state, S80);
  assert.equal(d.lines[0], placed([1, "oats"], [7, "billing"], [16, "on garnet"], [59, "1 running  1 stopped"]));
  for (const cell of d.cells[0].slice(16, 25).filter((c) => c.text !== " ")) assert.equal(cell.style, DIM, "the TUI's `on` and the machine's name are dim");
  assert.equal(d.cells[0][7].style.dim, false, "the workspace's name is not");
  assert.equal(listLines(d, S80).some((line) => line.startsWith(" garnet")), false, "no heading names it");
  // The same for a run started outside every deployment that picked a machine's workspace.
  const outside = press(heard(stateOf(null, { deployment: null, cli: REMOTE_CLI }), answered(group()), T1), ["enter"]).state;
  assert.equal(outside.open, GARNET);
  assert.deepEqual(machinesOf(outside), { here: false, machines: 1, machine: "garnet" });
  assert.equal(draw(outside, S80).lines[0], placed([1, "oats"], [7, "platform"], [17, "on garnet"], [59, "1 running  1 stopped"]));
});

test("a view that holds no deployment of this machine and two or more machines says `N machines` after the workspace's name, without the plus", () => {
  const state = onBoth();
  assert.deepEqual(machinesOf(state), { here: false, machines: 2, machine: null });
  assert.deepEqual(panelOf(state, AT).deployments.map((d) => [d.local, d.machine]), [[false, "garnet"], [false, "quartz"]]);
  const d = draw(state, S80);
  assert.equal(d.lines[0], placed([1, "oats"], [7, "billing"], [16, "2 machines"], [59, "2 running  1 stopped"]));
  for (const cell of d.cells[0].slice(16, 26).filter((c) => c.text !== " ")) assert.equal(cell.style, DIM);
  // Two deployments of one machine are one machine: it is named.
  const twice = second(heard(local(), answered(group({ workspace: ELSEWHERE }), group({ id: "garnet:acme-2", target: { workspace: "/home/dev/Agents/acme-two", sshHost: "garnet.example" }, workspace: ELSEWHERE, instances: [] })), T1));
  assert.deepEqual(machinesOf(twice), { here: false, machines: 1, machine: "garnet" });
  assert.equal(draw(twice, S80).lines[0].startsWith(" oats  billing  on garnet  "), true, draw(twice, S80).lines[0]);
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
    assert.match(d.lines[0], name.startsWith("one") ? /^ oats {2}billing {2}on garnet/ : / \d machines {2}/, at);
    fits(d, sz, at);
  }
  // And with one of this machine's in the view it always does, where the count is drawn at all.
  for (const sz of [S80, S60]) assert.match(draw(reached(), sz).lines[0], /^ oats {2}acme-platform {2}\+1 machine {2}/);
});

test("at 60 columns the workspace's name is cut before the counts give way, and what follows the name is given up when it would leave the name fewer than eight cells, or fewer than its own width when it is shorter", () => {
  // A long name beside `+1 machine` and beside `2 machines`: cut with the mark, every count still there.
  const named = heard(stateOf(reporting(NEAR(), { workspace: "acme-platform-of-the-ledger-team-and-friends" }), { cli: REMOTE_CLI }), answered(group()), T1);
  assert.equal(draw(named, S60).lines[0], placed([1, "oats"], [7, "acme-platform-of-…"], [27, "+1 machine"], [39, "3 running  2 stopped"]));
  assert.equal(draw(onBoth(LONG_KEY), S60).lines[0], placed([1, "oats"], [7, `${LONG_WORKSPACE.slice(0, 17)}…`], [27, "2 machines"], [39, "2 running  1 stopped"]));
  assert.equal(draw(onGarnet({}, LONG_KEY), S60).lines[0], placed([1, "oats"], [7, `${LONG_WORKSPACE.slice(0, 18)}…`], [28, "on garnet"], [39, "1 running  1 stopped"]));
  // Wider counts leave the name and what follows it 17 cells: a name of three cells keeps its
  // `+1 machine`, a name of eight or more would be left five and stands alone.
  const crowd = () => ["running", "stopped", "unknown"].flatMap((word, k) => Array.from({ length: 10 }, (_, i) => instanceRow("soul", `${word}-${i}`, k === 0 ? {} : k === 1 ? { running: false, runtimeState: "stopped" } : { running: null, runtimeState: "unreachable" })));
  const crowded = (workspace) => draw(heard(stateOf(reporting(crowd(), { workspace }), { cli: REMOTE_CLI }), answered(group({ instances: [] })), T1), S60).lines[0];
  const COUNTED = "10 running  10 stopped  10 unknown";
  assert.equal(crowded("eng"), placed([1, "oats"], [7, "eng"], [12, "+1 machine"], [59 - COUNTED.length, COUNTED]), "a short name is whole, and the count of machines stays");
  for (const workspace of ["acmeplat", "acme-plat", "acme-platform"]) assert.equal(crowded(workspace), placed([1, "oats"], [7, workspace], [59 - COUNTED.length, COUNTED]), `${workspace}: the name stands alone, whole`);
  // The same for `on <machine>`: with 19 cells, a long name is cut to eight beside `on garnet`, and
  // beside a machine whose own name would be left fewer than eight cells (or than its own width)
  // nothing follows the workspace's name.
  const three = [farRow(FAR_A), farRow(FAR_B, { running: false, runtimeState: "stopped" }), farRow("acme-ledger-far-c", { running: null, runtimeState: "unreachable", runtimeError: UNREACHABLE })];
  const THREE = "1 running  1 stopped  1 unknown", header = (label, key) => draw(onGarnet({ label, instances: three }, key), S60).lines[0];
  assert.equal(header("garnet", ELSEWHERE.key), placed([1, "oats"], [7, "billing"], [16, "on garnet"], [59 - THREE.length, THREE]));
  assert.equal(header("garnet", LONG_KEY), placed([1, "oats"], [7, `${LONG_WORKSPACE.slice(0, 7)}…`], [17, "on garnet"], [59 - THREE.length, THREE]));
  assert.equal(header("garnet-", LONG_KEY), placed([1, "oats"], [7, `${LONG_WORKSPACE.slice(0, 18)}…`], [59 - THREE.length, THREE]), "seven cells of machine do not fit beside eight of the name: the name has the room");
  assert.equal(header(LONG_MACHINE, LONG_KEY), placed([1, "oats"], [7, `${LONG_WORKSPACE.slice(0, 18)}…`], [59 - THREE.length, THREE]));
  assert.equal(header(LONG_MACHINE, ELSEWHERE.key), placed([1, "oats"], [7, "billing"], [59 - THREE.length, THREE]));
  // The counts the TUI adds never give way to any of it.
  for (const line of [crowded("eng"), crowded("acme-platform"), header(LONG_MACHINE, LONG_KEY)]) assert.equal(textWidth(line), 59, line);
});

test("in `on <machine>` a long machine name is cut before the workspace's name is", () => {
  // A workspace's name of seven cells is whole beside a machine's name cut with the mark.
  assert.equal(draw(onGarnet({ label: LONG_MACHINE }), S60).lines[0], placed([1, "oats"], [7, "billing"], [16, `on ${LONG_MACHINE.slice(0, 17)}…`], [39, "1 running  1 stopped"]));
  assert.equal(draw(onGarnet({ label: LONG_MACHINE }), S80).lines[0], placed([1, "oats"], [7, "billing"], [16, `on ${LONG_MACHINE.slice(0, 37)}…`], [59, "1 running  1 stopped"]));
  // A workspace's name of twelve cells has the room to be whole too, at 60 columns and at 80: it is
  // the machine's name that gives its cells up.
  const KEY = "github.com/acme/acme-billing";
  assert.equal(draw(onGarnet({ label: LONG_MACHINE }, KEY), S60).lines[0], placed([1, "oats"], [7, "acme-billing"], [21, `on ${LONG_MACHINE.slice(0, 12)}…`], [39, "1 running  1 stopped"]));
  assert.equal(draw(onGarnet({ label: LONG_MACHINE }, KEY), S80).lines[0], placed([1, "oats"], [7, "acme-billing"], [21, `on ${LONG_MACHINE.slice(0, 32)}…`], [59, "1 running  1 stopped"]));
});

test("a view whose only deployment is a machine that is not live and has no row kept is drawn as an unavailable deployment is: its state, its reason on rows of its own, and no panes, no rule under them and no line about instances", () => {
  const state = heard(onGarnet({ instances: [] }), TIMEOUT, T2), said = deploymentState(deploymentOf(state));
  assert.equal(state.open, GARNET);
  assert.equal(said.key !== "live" && panelOf(state, AT).instances.length === 0, true);
  for (const ascii of [false, true]) for (const sz of SIZES) {
    const d = draw({ ...state, ascii }, sz), g = glyphsOf(ascii), at = `${sz.cols}x${sz.rows}${ascii ? " ascii" : ""}`;
    const reason = reasonRows(d, textOf(shown(said.detail)), g.cut);
    assert.equal(cellText(d, 0), " oats  billing  on garnet", `${at}: the header names the machine and counts nothing`);
    assert.equal(d.lines[1], " 1 Instances   2 Souls   3 Capabilities", `${at}: no time: nothing was read`);
    assert.equal(cellText(d, 3).trim(), said.text, `${at}: the state in the shared home's word`);
    assert.equal(reason.whole && reason.rows[0] === 4, true, `${at}: its reason, whole, on the rows under it`);
    assert.deepEqual(d.lines.slice(reason.rows.at(-1) + 1, sz.rows - 2).filter(Boolean), [], `${at}: and nothing else: no rule, no line that says no instance is listed`);
    for (const r of [2, sz.rows - 2]) assert.equal(d.lines[r], g.rule.repeat(sz.cols), `${at}: one pane: no joint in the rule of row ${r}`);
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
