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
  deploymentState, heldHome, instanceActs, observedEntry, panelInstances, primaryDeployment, rosterRows,
  waitedText, waitingBelowText, waitingClock, waitingLabel,
} from "../lib/client.mjs";
import { effectiveConfig } from "../lib/config.mjs";
import { panelOf } from "../lib/model.mjs";
import { createScreen } from "../lib/term/screen.mjs";
import { isStyle, style } from "../lib/term/style.mjs";
import { isSafeText, shown, textOf } from "../lib/term/text.mjs";
import { textWidth } from "../lib/term/width.mjs";
import { MIN_SIZE, WIDE } from "../lib/views/frame.mjs";
import { NOT_YET, VIEWS, keysLabel } from "../lib/views/help.mjs";
import { EMPTY_TEXT, MARKS, cutNote, marksOf } from "../lib/views/instances.mjs";
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
function observedIn(rows, { team, workspace = "lfx-workspace" } = {}) {
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
const KERNEL_EXPERT = "oats-kernel-expert-retire", KERNEL_DEV = "oats-kernel-developer-note-target", REVIEWER = "code-reviewer-note";
const DESKTOP_EXPERT = "oats-desktop-expert-tui-read", DESKTOP_A = "oats-desktop-developer-panel", DESKTOP_B = "oats-desktop-developer-terms";
const MAINTAINER = "oats-maintainer-lfx", EXPERT_TUI = "oats-expert-tui";
const ROSTER = () => [
  instanceRow("oats-kernel-expert", KERNEL_EXPERT),
  instanceRow("oats-kernel-developer", KERNEL_DEV, { parentInstance: KERNEL_EXPERT, waitingOnYou: { ...QUESTION } }),
  instanceRow("code-reviewer", REVIEWER, { parentInstance: KERNEL_DEV, running: false, runtimeState: "stopped" }),
  instanceRow("oats-desktop-expert", DESKTOP_EXPERT),
  instanceRow("oats-desktop-developer", DESKTOP_A, { parentInstance: DESKTOP_EXPERT, waitingOnYou: { since: "2026-10-11T09:58:00.000Z", producer: "claude", reason: "permission" } }),
  instanceRow("oats-desktop-developer", DESKTOP_B, { parentInstance: DESKTOP_EXPERT, waitingOnYou: { since: "2026-10-11T08:30:00.000Z", producer: "claude", reason: "attention", message: "Ready for review." } }),
  instanceRow("oats-maintainer", MAINTAINER),
  instanceRow("oats-expert", EXPERT_TUI, { running: null, runtimeState: "unreachable", runtimeError: UNREACHABLE }),
];
const WITHHELD = [{ agent: "oats-kernel-developer", instance: "oats-kernel-developer-twin", reason: "duplicate-home" }];
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
const FOOTER = " / filter   Tab detail   r refresh   ? help   q quit";

// ── Golden frames ────────────────────────────────────────────────────────────────────────────────

test("the Instances view at 80x24 in UTF-8, cell for cell: the header, the view names and the read time, a rule with a joint at the list's width, the roster beside the selected instance's detail, a rule, the footer", () => {
  const blank = `${" ".repeat(38)}│`;
  assert.deepEqual(draw(golden(), S80).lines, [
    ` oats  lfx-workspace  ${COUNTS}`,
    " 1 Instances   2 Souls   3 Capabilities                           read 10:00:00",
    `${"─".repeat(38)}┬${"─".repeat(41)}`,
    " ▾ ● oats-desktop-e…  claude          │   oats-kernel-developer-note-target",
    "     ● oats-desktop…  claude         !│   soul     oats-kernel-developer",
    "     ● oats-desktop…  claude         !│   state    running",
    ` ▾ ● oats-kernel-ex…  claude          │   needs    ${NEEDS}`,
    ">  ▾ ● oats-kernel-…  claude         !│            the agent: \"Which base",
    "       ○ code-revie…  stopped         │            should it use?\"",
    "                                      │   harness  claude, claude-opus-5-5 (so…",
    "   ● oats-maintaine…  claude          │   work     worktree, agents/oats-kerne…",
    "   ? oats-expert-tui  unreachable     │   team     lfx",
    "                                      │   parent   oats-kernel-expert-retire",
    `                                      │   started  ${STARTED}`,
    "                                      │   home     …ernel-developer-note-target",
    blank, blank, blank, blank, blank, blank, blank,
    `${"─".repeat(38)}┴${"─".repeat(41)}`,
    FOOTER,
  ]);
});

test("the Instances view at 80x24 in ASCII, cell for cell: the same screen with the rules, the joints, the marks and the cut mark in ASCII", () => {
  const blank = `${" ".repeat(38)}|`;
  assert.deepEqual(draw(golden({ ascii: true }), S80).lines, [
    ` oats  lfx-workspace  ${COUNTS}`,
    " 1 Instances   2 Souls   3 Capabilities                           read 10:00:00",
    `${"-".repeat(38)}+${"-".repeat(41)}`,
    " v * oats-desktop...  claude          |   oats-kernel-developer-note-target",
    "     * oats-deskt...  claude         !|   soul     oats-kernel-developer",
    "     * oats-deskt...  claude         !|   state    running",
    ` v * oats-kernel-...  claude          |   needs    ${NEEDS}`,
    ">  v * oats-kerne...  claude         !|            the agent: \"Which base",
    "       - code-rev...  stopped         |            should it use?\"",
    "                                      |   harness  claude, claude-opus-5-5 (...",
    "   * oats-maintai...  claude          |   work     worktree, agents/oats-ker...",
    "   ? oats-expert-tui  unreachable     |   team     lfx",
    "                                      |   parent   oats-kernel-expert-retire",
    `                                      |   started  ${STARTED}`,
    "                                      |   home     ...nel-developer-note-target",
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
  assert.equal(d.lines[0], ` oats  lfx-workspace${" ".repeat(42)}${COUNTS}`);
  assert.equal(d.lines[1], ` 1 Instances   2 Souls   3 Capabilities${" ".repeat(67)}read 10:00:00`);
  assert.equal(d.lines[3], row(" ▾ ● oats-desktop-expert-tui-read        claude", "   oats-kernel-developer-note-target"));
  assert.equal(d.lines[4], row("     ● oats-desktop-developer-panel      claude         !", "   soul     oats-kernel-developer"));
  assert.equal(d.lines[5], row("     ● oats-desktop-developer-terms      claude         !", "   state    running"));
  assert.equal(d.lines[6], row(" ▾ ● oats-kernel-expert-retire           claude", `   needs    ${NEEDS}`));
  assert.equal(d.lines[7], row(">  ▾ ● oats-kernel-developer-note-targ…  claude         !", "            the agent: \"Which base should it use?\""));
  assert.equal(d.lines[8], row("       ○ code-reviewer-note              stopped", "   harness  claude, claude-opus-5-5 (soul)"));
  assert.equal(d.lines[9], row("", "   work     worktree, agents/oats-kernel-developer-note-targ…"));
  assert.equal(d.lines[10], row("   ● oats-maintainer-lfx                 claude", "   team     lfx"));
  assert.equal(d.lines[11], row("   ? oats-expert-tui                     unreachable", `   parent   ${KERNEL_EXPERT}`));
  assert.equal(d.lines[12], row("", `   started  ${STARTED}`));
  assert.equal(d.lines[13], row("", "   home     …oper/instances/oats-kernel-developer-note-target"));
  for (let r = 14; r < 38; r++) assert.equal(d.lines[r], row("", ""), `row ${r}`);
  assert.equal(d.lines[39], FOOTER);
});

test("at 79x24 the list takes the whole width: no rule column, no detail beside it, and the waiting marks at the right edge", () => {
  const d = draw(golden(), S79);
  assert.equal(d.lines[0], ` oats  lfx-workspa…  ${COUNTS}`);
  assert.equal(d.lines[2], "─".repeat(79));
  assert.deepEqual(d.lines.slice(3, 12), [
    " ▾ ● oats-desktop-expert-tui-read                              claude",
    "     ● oats-desktop-developer-panel                            claude         !",
    "     ● oats-desktop-developer-terms                            claude         !",
    " ▾ ● oats-kernel-expert-retire                                 claude",
    ">  ▾ ● oats-kernel-developer-note-target                       claude         !",
    "       ○ code-reviewer-note                                    stopped",
    "",
    "   ● oats-maintainer-lfx                                       claude",
    "   ? oats-expert-tui                                           unreachable",
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
    " ▾ ● oats-desktop-expert-tui-read           claude",
    "     ● oats-desktop-developer-panel         claude         !",
    "     ● oats-desktop-developer-terms         claude         !",
    " ▾ ● oats-kernel-expert-retire              claude",
    ">  ▾ ● oats-kernel-developer-note-target    claude         !",
    "       ○ code-reviewer-note                 stopped",
    "",
    "   ● oats-maintainer-lfx                    claude",
    "   ? oats-expert-tui                        unreachable",
    "",
  ]);
  assert.equal(d.lines[13], "─".repeat(60));
  assert.equal(d.lines[14], FOOTER);
});

test("a view answers exactly as many rows as the terminal has, and every span is safe text or a fill, at a cell index, in a style value: at every size, also 3000 columns wide and too small", () => {
  const tabbed = press(golden(), ["tab"]).state, helping = press(golden(), ["?"]).state;
  const filtered = press(fresh(), ["/", "z", "z", "z"]).state;
  const states = {
    list: golden(), "list, ascii": golden({ ascii: true }), collapsed: folded(), detail: tabbed, help: helping, "help, ascii": press(golden({ ascii: true }), ["?"]).state,
    reading: stateOf(), none: stateOf(observed([])), "no match": filtered,
    stale: stateOf(failed(entry(), { code: "E_REMOTE_UNREADABLE", message: "the mirror did not answer" })),
    unavailable: stateOf(failed(entry(), { code: "E_SOMETHING_NEW", message: "a refusal nobody has seen" })),
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
  assert.equal(cellText(d, 0, 0, 20), " oats  lfx-workspace");
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
    assert.equal(d.lines.some((line) => /\boats-\w+-/.test(line)), false, `${at}: no instance row`);
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
  const states = [stateOf(), stateOf(observed([])), press(fresh(), ["/", "z", "z", "z"]).state, golden(), press(golden(), ["?"]).state, stateOf(failed(entry(), { code: "E_SOMETHING_NEW", message: "no" }))];
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
  assert.equal(running.lines[0], ` oats  lfx-workspace${" ".repeat(50)}2 running`);
  const stopped = draw(stateOf(observed([instanceRow("soul", "one", { running: false, runtimeState: "stopped" })])), S80);
  assert.equal(stopped.lines[0], ` oats  lfx-workspace${" ".repeat(50)}1 stopped`);
  const none = draw(stateOf(observed([])), S80);
  assert.equal(none.lines[0], " oats  lfx-workspace");
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
  for (const line of d.lines) assert.equal(line.includes("oats-kernel-developer-twin"), false);
});

test("the second row holds the time of the read, `read HH:MM:SS`, only when the deployment is live: the cycle's own time, not the older time the kernel observed the remotes at", () => {
  const at = (iso, observedAt) => stateOf(observed(ROSTER(), { at: iso, observedAt }));
  assert.equal(draw(at("2026-10-11T14:03:27.000Z", "2026-10-11T14:02:27.000Z"), S80).lines[1].endsWith(" read 14:03:27"), true);
  assert.equal(draw(at("2026-10-11T00:00:09.000Z", "2026-10-10T23:59:09.000Z"), S60).lines[1].endsWith(" read 00:00:09"), true);
  // Kept over a failed read, the entry says since when by the same time: its last good read.
  const kept = stateOf(failed(observed(ROSTER(), { at: "2026-10-11T14:03:27.000Z", observedAt: "2026-10-11T14:02:27.000Z" }), { code: "E_REMOTE_UNREADABLE", message: "no" }, "2026-10-11T14:09:00.000Z"));
  assert.equal(sharedState(kept).key, "stale");
  for (const sz of SIZES) assert.equal(cellText(draw(kept, sz), 3).endsWith(" since 14:03:27"), true, `${sz.cols}x${sz.rows}: stale since the last good read`);
  const notLive = [stateOf(), stateOf(failed(entry(), { code: "E_REMOTE_UNREADABLE", message: "no" })), stateOf(failed(entry(), { code: "E_SOMETHING_NEW", message: "no" }))];
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
    assert.equal(below.some((text) => text.includes("oats-kernel-expert") || text.includes("oats-desktop-expert")), true, `${at}: the last observation is still drawn`);
  }
});

test("the not-observed reason of an unavailable deployment is the shared state's detail through shown(), on rows of its own under the state, and no instance row is drawn", () => {
  for (const ascii of [false, true]) for (const sz of SIZES) {
    const state = stateOf(failed(entry(), UNAVAILABLE(SHORT_REASON)), { ascii }), shared = sharedState(state), d = draw(state, sz), at = `${sz.cols}x${sz.rows}`;
    assert.equal(shared.key, "unobserved");
    assert.equal(shared.detail.includes(SHORT_REASON), true, "the detail carries the message the test chose");
    const line = textOf(shown(shared.detail)), reason = reasonRows(d, line, glyphsOf(ascii).cut);
    assert.equal(reason.whole, true, `${at}: the rows of the reason, joined with a space, are the detail's display line`);
    assert.equal(reason.rows[0], 4, at);
    assert.equal(cellText(d, 3).trim(), shared.text, `${at}: the row above holds the state in the shared home's words`);
    assert.equal(d.cells[4].find((cell) => cell.text !== " ").text, line[0], at);
    for (const text of d.lines) assert.equal(text.includes("the kernel:"), false, at);
    assert.deepEqual(d.lines.slice(reason.rows.at(-1) + 1, sz.rows - 2).filter(Boolean), [], `${at}: the list holds the reason and no rows`);
    for (const text of d.lines) assert.equal(/oats-(kernel|desktop|maintainer|expert)-/.test(text), false, `${at}: no instance`);
  }
});

test("a reason longer than its row is wrapped onto rows that hold nothing else, at most four, and the last one ends in the cut mark", () => {
  for (const make of [STALE, UNAVAILABLE]) for (const ascii of [false, true]) for (const sz of SIZES) {
    const state = stateOf(failed(entry(), make(LONG_REASON)), { ascii }), d = draw(state, sz), at = `${make(LONG_REASON).code} at ${sz.cols}x${sz.rows}`;
    const line = textOf(shown(sharedState(state).detail)), cut = glyphsOf(ascii).cut;
    const reason = reasonRows(d, line, cut);
    assert.equal(reason.cutShort, true, `${at}: every row is the next piece of the reason, and the last is cut`);
    assert.equal(reason.rows.length >= 2 && reason.rows.length <= 4, true, `${at}: wrapped, on ${reason.rows.length} rows`);
    assert.equal(cellText(d, reason.rows.at(-1)).endsWith(cut), true, at);
    for (const r of reason.rows) assert.equal(textWidth(cellText(d, r)) <= sz.cols, true, at);
  }
});

test("a reason that needs more than four rows takes four where the body has the room, at 80x24 and at 120x40", () => {
  for (const make of [STALE, UNAVAILABLE]) for (const sz of [S80, S120]) {
    const state = stateOf(failed(entry(), make(Array.from({ length: 300 }, (_, i) => `w${i}`).join(" ")))), d = draw(state, sz);
    assert.equal(reasonRows(d, textOf(shown(sharedState(state).detail)), "…").rows.length, 4, `${make("").code} at ${sz.cols}x${sz.rows}`);
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
    assert.equal(shared.detail.includes(message), true, `${at}: the shared detail carries the message as it came`);
    const out = readTerminalOutput(createScreen().render(d.rows, sz, { full: true }));
    assert.deepEqual(out.foreign, [], `${at}: every ESC written begins a sequence of the TUI's own`);
    assert.deepEqual([...new Set(out.sequences.map((s) => s.kind))].filter((kind) => !["erase", "position", "sgr"].includes(kind)), [], at);
    assert.doesNotMatch(out.text, CONTROL, at);
    d.cells.forEach((line, r) => line.forEach((cell, x) => assert.doesNotMatch(cell.text, CONTROL, `${at}: row ${r}, column ${x}`)));
    const reason = reasonRows(d, textOf(shown(shared.detail)), "…");
    assert.equal(reason.whole, true, `${at}: what is drawn is the detail through shown()`);
    assert.equal(d.lines.some((line) => line.includes("owned")) && name.startsWith("an OSC"), false, at);
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
  const header = (cols) => ` oats  lfx-workspace${" ".repeat(cols - 44)}3 running  2 need input`;
  const d80 = draw(folded(), S80), a80 = draw(folded({ ascii: true }), S80), d60 = draw(folded(), S60), d120 = draw(folded(), S120);
  assert.equal(d80.lines[0], header(80));
  assert.equal(cellText(d80, 3, 0, 39), ">▸ ● oats-desktop-expert…  claude   !2│");
  assert.equal(cellText(a80, 3, 0, 39), ">> * oats-desktop-expe...  claude   !2|");
  assert.equal(d60.lines[3], ">▸ ● oats-desktop-expert-tui-read                claude   !2");
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
    assert.equal(d.lines.some((line) => line.includes("oats-kernel-developer-note")), true, "the row is drawn");
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
  assert.deepEqual(fact(detail, "soul").rows, ["oats-kernel-developer"]);
  assert.deepEqual(fact(detail, "state").rows, ["running"]);
  assert.deepEqual(fact(detail, "needs").rows, [NEEDS, 'the agent: "Which base should it use?"'], "the reason in words and how long, then the message as an attributed quote");
  assert.deepEqual(fact(detail, "harness").rows, ["claude, claude-opus-5-5 (soul)"], "the harness as its id, the model, and where the model came from in brackets");
  assert.deepEqual(fact(detail, "work").rows, [`worktree, agents/${KERNEL_DEV}`]);
  assert.deepEqual(fact(detail, "team").rows, ["lfx"]);
  assert.deepEqual(fact(detail, "parent").rows, [KERNEL_EXPERT]);
  assert.deepEqual(fact(detail, "started").rows, [STARTED]);
  assert.deepEqual(fact(detail, "home").rows, [`${DEPLOYMENT}/agents/oats-kernel-developer/instances/${KERNEL_DEV}`]);
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
  const home = `${DEPLOYMENT}/agents/oats-kernel-developer/instances/${KERNEL_DEV}`;
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
    ` oats  lfx-workspa…  ${COUNTS}`,
    " 1 Instances   2 Souls   3 Capabilities                          read 10:00:00",
    "─".repeat(79),
    ` > ${KERNEL_DEV}`,
    "   soul     oats-kernel-developer",
    "   state    running",
    `   needs    ${NEEDS}`,
    "            the agent: \"Which base should it use?\"",
    "   harness  claude, claude-opus-5-5 (soul)",
    `   work     worktree, agents/${KERNEL_DEV}`,
    "   team     lfx",
    `   parent   ${KERNEL_EXPERT}`,
    `   started  ${STARTED}`,
    "   home     …oats-kernel-developer/instances/oats-kernel-developer-note-target",
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
  assert.equal(wide.lines.some((line) => line.includes("oats-maintainer-lfx")), true, "at 100 columns the list is beside the detail");
  assert.equal(narrow.lines[3], ` > ${KERNEL_DEV}`);
  assert.equal(narrow.lines.some((line) => line.includes("oats-maintainer-lfx")), false, "at 79 the detail is the page: no list row");
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
  assert.equal(draw(golden(), S80).lines[23], " / filter   Tab detail   r refresh   ? help   q quit");
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
    assert.equal(footer, " Tab detail   r refresh   ? help   x quit", `${sz.cols}x${sz.rows}`);
    assert.equal(footer.includes("filter") || footer.includes("q quit") || footer.includes("/"), false);
  }
  const rebound = effectiveConfig({ keys: { help: ["f1"], detail: ["d", "tab"], refresh: ["f5", "r"], close: ["backspace"] } });
  assert.equal(draw(golden({ actions: rebound.actions }), S80).lines[23], " / filter   d detail   F5 refresh   F1 help   q quit");
  assert.equal(draw(press(golden({ actions: rebound.actions }), ["d"]).state, S80).lines[23], " d detail   Backspace close   F5 refresh   F1 help   q quit");
});

test("when the footer has no room for every action it shows as many as fit, and `help` and `quit` are still the last two", () => {
  const kept = press(fresh(), ["/", "t", "u", "i", "enter"]).state;
  const at60 = draw(kept, S60).lines[14], at120 = draw(kept, S120).lines[39];
  assert.equal(at120.endsWith("r refresh   ? help   q quit"), true, "with room, every action that applies");
  assert.equal(at60.endsWith("? help   q quit"), true);
  assert.equal(at60.includes("r refresh"), false, "at 60 columns one is given up");
  assert.equal(textWidth(at60) <= 59, true);
  const long = effectiveConfig({ keys: { help: ["ctrl+shift+f12"], quit: ["ctrl+shift+f11"] } });
  for (const sz of [S60, S80]) {
    const footer = draw(golden({ actions: long.actions }), sz).lines[sz.rows - 1];
    assert.equal(footer.endsWith("Ctrl+Shift+F12 help   Ctrl+Shift+F11 quit"), true, `${sz.cols}: ${footer}`);
  }
});

test("while the filter field is open the footer row holds `/`, the query, and how to keep and clear it", () => {
  for (const sz of SIZES) {
    const open = press(fresh(), ["/"], sz).state, typed = press(open, ["k", "e", "r", "n", "e", "l", "space", "d", "e", "v"], sz).state;
    const empty = cellText(draw(open, sz), sz.rows - 1), footer = cellText(draw(typed, sz), sz.rows - 1);
    assert.equal(empty.startsWith(" /"), true);
    assert.equal(footer.startsWith(" /kernel dev  "), true, `${sz.cols}: ${footer}`);
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
    const lines = helpLines(golden({ ascii }), size(60, 70)), cut = glyphsOf(ascii).cut;
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
  for (const [keys, label] of [["Up, k", "up"], ["Down, j", "down"], ["g, Home", "first"], ["G, End", "last"], ["PageUp", "page up"], ["PageDown", "page down"], ["Tab", "detail"], ["/", "filter"], ["r", "refresh"], ["1", "instances"], ["?", "help"], ["Esc", "close"], ["q, Ctrl+C", "quit"], ["Ctrl+Z", "suspend"], ["Ctrl+L", "redraw"]]) {
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
    for (const command of ["oats session attach --home <home>", "oats instance stop", "oats session start", "oats retire", "oats server roster"]) {
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
  const whole = helpLines(golden(), size(60, 70)).map((line) => line.trim()).filter(Boolean), seen = new Set();
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
  assert.equal(kept("oats-kernel", long.actions, S60), " /oats…   Ctrl+Alt+Shift+F11 help   Ctrl+Alt+Shift+F12 quit", "the query is cut, the two hints are whole");
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
