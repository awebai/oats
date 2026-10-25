process.env.TZ = "UTC";
// The waiting row (docs/tui.md, "Tabs"; awebai/oats#1502): under a group's tab bar while the
// group's shown agent has a live claim, `Needs input`, the claim's age and its message, so a
// question is read where the agent's terminal is. Every entry is made by the shared functions
// (helpers.mjs); no test needs a terminal or tmux.
import test from "node:test";
import assert from "node:assert/strict";
import { instanceId } from "../lib/client.mjs";
import { roster } from "../lib/model.mjs";
import { reduce } from "../lib/store.mjs";
import { createScreen } from "../lib/term/screen.mjs";
import { draw, instanceRow, NOW, observed, stateOf } from "./helpers.mjs";

const AT = Object.freeze({ page: 19, extent: 0, room: 19, cols: 38, panel: Object.freeze({ cols: 89, rows: 40 }) });
const S80 = { cols: 80, rows: 24 }, S120 = { cols: 120, rows: 40 };
const MIN = 60000;
/** A claim that started `ago` ms before the tests' paint time. */
const claim = (reason, message = null, ago = 2 * MIN) => ({ since: new Date(NOW - ago).toISOString(), producer: "agent", reason, message });
const QUESTION = "Bump Claude Code to 2.1.309 and Codex?";
/** 200 code points, the most a claim's message holds. */
const LONG = "Survey done: yes or no on bumping Claude Code 2.1.309 and Codex 0.164.0, and on removing their old mise installs, which frees two gigabytes; undo reinstalls the old versions from mise in a minute. Ok?";

let reads = 0;
const key = (state, id) => reduce(state, { key: id, ...(id.length === 1 ? { text: id } : {}), read: ++reads, ...AT });
function leaderThen(state, id) {
  const lead = state.terminal?.focus === "terminal" && state.view === "instances" && state.palette === null
    ? reduce(state, { back: true, read: ++reads, ...AT })
    : reduce(state, { key: state.leaderKey, read: ++reads, ...AT });
  return key(lead.state, id);
}
const idOf = (state, name) => instanceId(roster(state).instances.find((row) => row.instance === name));
function enter(state, name) {
  const step = key(Object.freeze({ ...state, selected: idOf(state, name) }), "enter");
  return step.state.terminal?.status === "starting" ? reduce(step.state, { shown: { id: idOf(state, name) }, ...AT }).state : step.state;
}
/** dev-a and dev-b, each with the claim given (or none), as one roster read. */
const team = (a = null, b = null) => stateOf(observed([
  instanceRow("dev", "dev-a", a ? { waitingOnYou: a } : {}), instanceRow("dev", "dev-b", b ? { waitingOnYou: b } : {}),
]));
/** The same open tabs, split, focus and group over a roster read with other claims. */
const reread = (state, a = null, b = null) => reduce(state, { id: "/srv/deploy", entry: observed([
  instanceRow("dev", "dev-a", a ? { waitingOnYou: a } : {}), instanceRow("dev", "dev-b", b ? { waitingOnYou: b } : {}),
]), number: ++reads }).state;
const shape = (d) => d.regions.map(({ group, cols, rows }) => ({ group, cols, rows }));

test("an open agent with a claim: a row under its tab bar says Needs input, the age (dim) and the message; the agent's screen starts under it, a row shorter", () => {
  const plain = draw(enter(team(), "dev-a"), S120);
  assert.deepEqual(shape(plain), [{ group: 0, cols: 89, rows: 39 }]);
  const s = enter(team(claim("attention", QUESTION)), "dev-a"), d = draw(s, S120);
  assert.deepEqual(shape(d), [{ group: 0, cols: 89, rows: 38 }], "the pane gives the row up");
  assert.deepEqual([d.terminal.top, d.terminal.rows], [2, 38], "the agent's screen starts under the row");
  const row = d.lines[1].slice(31);
  assert.equal(row, ` Needs input  · 2 min ${QUESTION}`);
  const at = (word) => 31 + row.indexOf(word);
  assert.deepEqual([d.cells[1][at("Needs")].style.reverse, d.cells[1][at("Needs")].style.fg], [true, "yellow"], "the needs-input look: reverse video in the waiting colour");
  assert.equal(d.cells[1][at("2 min")].style.dim, true, "the age is dim");
  assert.equal(d.cells[1][at("Bump")].style.dim, false);
  // ASCII: the same words, the dot as `-`.
  assert.equal(draw({ ...s, ascii: true }, S120).lines[1].slice(31), ` Needs input  - 2 min ${QUESTION}`);
});

test("the claim cleared: the row goes and the agent's screen has it back", () => {
  const s = enter(team(claim("question", QUESTION)), "dev-a");
  assert.equal(draw(s, S120).regions[0].rows, 38);
  const cleared = draw(reread(s), S120);
  assert.equal(cleared.regions[0].rows, 39);
  assert.doesNotMatch(cleared.lines[1] ?? "", /Needs input/);
});

test("the fixtures: the question fits the first row beside the widest age at 89 cells; the long message is a claim's longest", () => {
  assert.ok(QUESTION.length <= 89 - 31 - 2);
  assert.equal([...LONG].length, 200);
});

test("a long message wraps to at most 3 rows and ends in … when more is left; a short region gives it no more than a quarter of its height", () => {
  const s = enter(team(claim("attention", LONG)), "dev-a");
  // Beside the sidebar at 80x24 the region is 49 cells wide and 23 rows tall: 3 rows of text.
  const d = draw(s, S80);
  assert.equal(d.regions[0].rows, 20, "three rows given up");
  const rows = [1, 2, 3].map((r) => d.lines[r].slice(31));
  assert.match(rows[0], /^ Needs input  · 2 min Survey done:/);
  assert.ok(rows[2].endsWith("…"), `the last row is cut: ${JSON.stringify(rows[2])}`);
  for (const r of rows) assert.ok(r.length <= 49, `inside the region: ${JSON.stringify(r)}`);
  // One above the other at 80x24 the groups are 11 and 10 rows: a quarter is 2.
  const down = draw(enter(leaderThen(s, "-").state, "dev-b"), S80);
  const waiting = down.regions.find((r) => r.group === 0);
  assert.equal(waiting.rows, 9, "two rows of 11");
  assert.ok(down.lines[2].slice(31).endsWith("…"));
  assert.equal(down.regions.find((r) => r.group === 1).rows, 10, "the other group is untouched");
});

test("a claim with no message says what it waits on in the TUI's words, from its reason", () => {
  const words = { permission: "waiting on a permission prompt", question: "asked you a question", attention: "asked for your attention", null: "waiting for your input" };
  for (const [reason, said] of Object.entries(words)) {
    const d = draw(enter(team(claim(reason === "null" ? null : reason)), "dev-a"), S120);
    assert.equal(d.lines[1].slice(31), ` Needs input  · 2 min ${said}`, reason);
    assert.equal(d.regions[0].rows, 38);
  }
  // A message the display filter leaves nothing of, and a reason that is a name on every object,
  // still give the row and the generic words.
  for (const [reason, message] of [["question", "   "], ["__proto__", null], ["constructor", null]]) {
    const d = draw(enter(team(claim(reason, message)), "dev-a"), S120);
    assert.equal(d.lines[1].slice(31), ` Needs input  · 2 min ${reason === "question" ? "asked you a question" : "waiting for your input"}`, `${reason} ${JSON.stringify(message)}`);
    assert.equal(d.regions[0].rows, 38);
  }
});

test("a split with one waiting group: that group's shown agent has the row, the other group's region keeps its height; a hidden tab's claim adds no row", () => {
  // dev-a in group 0, dev-b in group 1; dev-a waits.
  const split = enter(leaderThen(enter(team(claim("question", QUESTION)), "dev-a"), "|").state, "dev-b");
  const d = draw(split, S120);
  assert.deepEqual(shape(d), [{ group: 0, cols: 44, rows: 37 }, { group: 1, cols: 44, rows: 39 }], "44 cells: the question takes two rows beside the widest age");
  assert.match(d.lines[1].slice(31, 75), /^ Needs input  · 2 min Bump/);
  assert.doesNotMatch(d.lines[1].slice(76), /Needs input/);
  // dev-b waits instead, hidden behind dev-a in one group: no row.
  const one = enter(enter(team(null, claim("question", QUESTION)), "dev-b"), "dev-a");
  assert.equal(draw(one, S120).regions[0].rows, 39, "the shown agent does not wait");
});

test("the pane's height changes only when the claim does: not as its age grows, but when it starts, clears or its text changes", () => {
  const at = (s, ago) => draw(s, S120, { now: NOW + ago }).regions[0].rows;
  // A message that fits the row's first line with a short age and would not with the longest one.
  const tight = "x".repeat(89 - 22);
  const s = enter(team(claim("attention", tight, 0)), "dev-a");
  const heights = [0, MIN, 59 * MIN, 3 * 60 * MIN, 30 * 24 * 60 * MIN].map((ago) => at(s, ago));
  assert.deepEqual(new Set(heights).size, 1, `one height whatever the age: ${heights}`);
  const short = enter(team(claim("attention", "ok?")), "dev-a");
  assert.equal(draw(short, S120).regions[0].rows, 38);
  assert.equal(draw(reread(short, claim("attention", LONG)), S120).regions[0].rows, 36, "a longer text takes more rows");
  assert.equal(draw(reread(short), S120).regions[0].rows, 39, "cleared");
});

test("under NO_COLOR the row still says it in words: `Needs input` is text in reverse video, and only attributes are written", () => {
  const d = draw(enter(team(claim("question", QUESTION)), "dev-a"), S120);
  const bytes = createScreen({ utf8: true, color: false }).render(d.rows, S120, { full: true });
  assert.ok(bytes.includes("Needs input"));
  assert.match(bytes, /\u001b\[0;1;7m Needs input /, "bold and reverse, no colour");
  for (const [, params] of bytes.matchAll(/\u001b\[([0-9;]*)m/g)) for (const p of params.split(";").filter(Boolean)) assert.equal(["0", "1", "2", "3", "4", "7", "9"].includes(p), true, `SGR ${params}`);
});
