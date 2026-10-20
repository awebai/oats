process.env.TZ = "UTC";
// The tabs of the panel in the store and on the screen (docs/tui.md, "Tabs"; spec T2 and its
// settled list): opening, showing, switching and closing tabs, a viewer's own end, the activity
// mark, the cap, a workspace switch, and the strip on the panel's top row. Every entry is made by
// the shared functions (helpers.mjs); no test needs a terminal or tmux.
import test from "node:test";
import assert from "node:assert/strict";
import { collapseKey, instanceId } from "../lib/client.mjs";
import { paletteItems, roster } from "../lib/model.mjs";
import { MAX_TERMINALS } from "../lib/panel.mjs";
import { TAB_LIMIT, reduce } from "../lib/store.mjs";
import { createScreen } from "../lib/term/screen.mjs";
import { textWidth } from "../lib/term/width.mjs";
import { draw, instanceRow, observed, stateOf } from "./helpers.mjs";

/** The geometry of the frame before each key: the store reads it for a move, never keeps it. */
const AT = Object.freeze({ page: 19, extent: 0, room: 19, cols: 38 });
const FULL = "4 terminals are open; close one with Ctrl+\\ w.";

/** Drawn dev-a … dev-f, every one running here: each can be opened. */
const SIX = () => stateOf(observed(["dev-a", "dev-b", "dev-c", "dev-d", "dev-e", "dev-f"].map((name) => instanceRow("dev", name))));

let reads = 0;
/** A key in a read of its own; a one-character id types itself. */
const key = (state, id) => reduce(state, { key: id, ...(id.length === 1 ? { text: id } : {}), read: ++reads, ...AT });
/** The leader alone, then `id`, each in a read of its own: `{ back }` from the terminal's focus,
 *  else the leader's key. */
function leaderThen(state, id) {
  const lead = state.terminal?.focus === "terminal" && state.view === "instances" && state.palette === null
    ? reduce(state, { back: true, read: ++reads, ...AT })
    : reduce(state, { key: state.leaderKey, read: ++reads, ...AT });
  return key(lead.state, id);
}
const idOf = (state, name) => instanceId(roster(state).instances.find((row) => row.instance === name));
const on = (state, name) => Object.freeze({ ...state, selected: idOf(state, name) });
/** `name` opened with Enter from the list, its window shown by the panel. -> the step of Enter */
function enter(state, name) {
  const step = key(on(state, name), "enter");
  return step.state.terminal?.status === "starting" ? { ...step, state: reduce(step.state, { shown: { id: idOf(state, name) }, ...AT }).state } : step;
}
/** Each name opened in turn: the last is the shown tab, with the focus in it. */
const opened = (state, ...names) => names.reduce((s, name) => enter(s, name).state, state);
/** The strip's order as names, and the shown one's name. */
const strip = (state) => state.tabs.map((tab) => tab.name);
const shownName = (state) => state.terminal?.name ?? null;
/** The focus back to the list, as the leader then Esc leaves it. */
const toList = (state) => leaderThen(state, "escape").state;

test("TAB_LIMIT, the store's cap, is the panel's MAX_TERMINALS", () => {
  assert.equal(TAB_LIMIT, MAX_TERMINALS);
  assert.equal(TAB_LIMIT, 4);
});

// ── Opening ──────────────────────────────────────────────────────────────────────────────────────

test("Enter opens each instance as a tab after the shown one, shown with the focus in it, and nothing is closed", () => {
  let s = SIX();
  for (const [i, name] of ["dev-a", "dev-b", "dev-c"].entries()) {
    const step = key(on(s, name), "enter");
    assert.equal(step.effect.open.id, idOf(s, name), `${name}: opened`);
    assert.equal(step.effect.close, undefined, `${name}: nothing closed`);
    assert.deepEqual([step.state.terminal.name, step.state.terminal.focus, step.state.terminal.status], [name, "terminal", "starting"]);
    s = reduce(step.state, { shown: { id: idOf(s, name) }, ...AT }).state;
    assert.equal(s.tabs.length, i + 1);
  }
  assert.deepEqual(strip(s), ["dev-a", "dev-b", "dev-c"]);
  // A new tab goes after the shown one, not at the end.
  s = key(toList(s), "[").state;
  assert.equal(shownName(s), "dev-b");
  s = opened(s, "dev-d");
  assert.deepEqual([strip(s), shownName(s)], [["dev-a", "dev-b", "dev-d", "dev-c"], "dev-d"]);
});

test("Enter on an instance that is already a tab shows that tab with the focus in it, unzoomed; on the shown one it only gives the focus", () => {
  const s = toList(opened(SIX(), "dev-a", "dev-b"));
  const step = key(on(s, "dev-a"), "enter");
  assert.deepEqual(step.effect, { show: idOf(s, "dev-a") });
  assert.deepEqual([strip(step.state), shownName(step.state), step.state.terminal.focus, step.state.terminal.zoom], [["dev-a", "dev-b"], "dev-a", "terminal", false]);
  const again = key(on(s, "dev-b"), "enter");
  assert.deepEqual([again.effect, shownName(again.state), again.state.terminal.focus, strip(again.state)], [null, "dev-b", "terminal", ["dev-a", "dev-b"]]);
});

test("at the cap nothing closes on its own and nothing opens: the line says that 4 terminals are open, and to close one with the leader then w", () => {
  const s = toList(opened(SIX(), "dev-a", "dev-b", "dev-c", "dev-d"));
  assert.equal(s.tabs.length, 4);
  const step = key(on(s, "dev-e"), "enter");
  assert.equal(step.effect, null);
  assert.deepEqual([strip(step.state), shownName(step.state)], [strip(s), "dev-d"]);
  assert.equal(step.state.outcome.said.map((part) => part.own).join(""), FULL);
  // A tab that is open is still shown at the cap.
  assert.deepEqual(key(on(s, "dev-a"), "enter").effect, { show: idOf(s, "dev-a") });
  // The leader's Up and Down open with the same rule (Settled 8): the cap's line, nothing opened.
  const led = leaderThen(opened(SIX(), "dev-a", "dev-b", "dev-c", "dev-d"), "down");
  assert.deepEqual([led.state.tabs.length, led.state.outcome.said.map((part) => part.own).join("")], [4, FULL]);
});

test("one open at a time: while a tab is starting, Enter on another row, [ and ] do nothing (Settled 3)", () => {
  const s = opened(SIX(), "dev-a");
  const starting = key(on(toList(s), "dev-b"), "enter").state;
  assert.equal(starting.terminal.status, "starting");
  const other = key(on(toList(starting), "dev-c"), "enter");
  assert.deepEqual([other.effect, strip(other.state)], [null, ["dev-a", "dev-b"]]);
  const showing = key(on(toList(starting), "dev-a"), "enter");
  assert.deepEqual([showing.effect, shownName(showing.state)], [null, "dev-b"], "an open tab is not shown while another starts");
  for (const k of ["[", "]"]) assert.deepEqual([key(toList(starting), k).effect, shownName(key(toList(starting), k).state)], [null, "dev-b"], k);
});

// ── Switching ────────────────────────────────────────────────────────────────────────────────────

test("[ and ] show the tab before or after the shown one, without wrapping, from the list and from the detail; the focus stays and the row is selected", () => {
  const s = toList(opened(SIX(), "dev-a", "dev-b", "dev-c"));
  for (const focus of ["list", "detail"]) {
    let t = focus === "detail" ? key(s, "tab").state : s;
    assert.equal(t.focus, focus);
    t = key(t, "[").state;
    assert.deepEqual([shownName(t), t.focus, t.terminal.focus, t.selected], ["dev-b", focus, "list", idOf(s, "dev-b")], focus);
    const step = key(t, "[");
    assert.deepEqual(step.effect, { show: idOf(s, "dev-a") });
    t = step.state;
    assert.deepEqual([key(t, "[").effect, shownName(key(t, "[").state)], [null, "dev-a"], `${focus}: no wrap at the first`);
    t = key(key(key(t, "]").state, "]").state, "]").state;
    assert.equal(shownName(t), "dev-c", `${focus}: no wrap at the last`);
  }
});

test("the leader then Left or Right switches tabs from the terminal's focus, keeping the focus there and the zoom", () => {
  let s = opened(SIX(), "dev-a", "dev-b", "dev-c");
  s = leaderThen(s, "z").state;
  assert.deepEqual([s.terminal.focus, s.terminal.zoom], ["terminal", true]);
  const left = leaderThen(s, "left");
  assert.deepEqual(left.effect, { show: idOf(s, "dev-b") });
  assert.deepEqual([shownName(left.state), left.state.terminal.focus, left.state.terminal.zoom], ["dev-b", "terminal", true], "zoom keeps the tabs");
  const right = leaderThen(left.state, "right");
  assert.deepEqual([shownName(right.state), right.state.terminal.focus, right.state.terminal.zoom], ["dev-c", "terminal", true]);
  assert.equal(leaderThen(right.state, "right").effect, null, "no wrap");
});

test("the leader then Left or Right at either end, or while a tab starts, does nothing at all: the terminal keeps the focus and the zoom (round 1 of the review)", () => {
  let s = leaderThen(opened(SIX(), "dev-a", "dev-b"), "z").state;
  assert.deepEqual([shownName(s), s.terminal.focus, s.terminal.zoom], ["dev-b", "terminal", true]);
  const right = leaderThen(s, "right");
  assert.deepEqual([right.effect, shownName(right.state), right.state.terminal.focus, right.state.terminal.zoom], [null, "dev-b", "terminal", true], "the last tab");
  s = leaderThen(s, "left").state;
  const left = leaderThen(s, "left");
  assert.deepEqual([left.effect, shownName(left.state), left.state.terminal.focus, left.state.terminal.zoom], [null, "dev-a", "terminal", true], "the first tab");
  // A tab starting: neither key moves, nor takes the focus.
  const starting = key(on(toList(opened(SIX(), "dev-a")), "dev-b"), "enter").state;
  for (const k of ["left", "right"]) {
    const step = leaderThen(starting, k);
    assert.deepEqual([step.effect, shownName(step.state), step.state.terminal.focus], [null, "dev-b", "terminal"], k);
  }
});

test("the leader then Left or Right from another view goes to the Instances view and switches there, the focus in the list", () => {
  const s = toList(opened(SIX(), "dev-a", "dev-b"));
  for (const view of ["2", "3", "?"]) {
    const away = key(s, view).state;
    assert.notEqual(away.view, "instances", view);
    const step = leaderThen(away, "left");
    assert.deepEqual([step.state.view, shownName(step.state), step.state.terminal.focus], ["instances", "dev-a", "list"], view);
  }
});

test("showing a tab reveals its row: a filter that hides it is cleared, and a collapsed parent is opened; the focus does not move (Settled 5)", () => {
  const rows = [instanceRow("dev", "lead"), instanceRow("dev", "kid", { parentInstance: "lead" }), instanceRow("dev", "other")];
  let s = toList(opened(stateOf(observed(rows)), "kid", "other"));
  // A filter that hides kid.
  s = Object.freeze({ ...s, filter: Object.freeze({ editing: false, query: "other" }) });
  assert.equal(roster(s).index.has(idOf(stateOf(observed(rows)), "kid")), false);
  let t = key(s, "[").state;
  assert.deepEqual([shownName(t), t.filter.query, t.selected, t.focus], ["kid", "", idOf(t, "kid"), "list"]);
  // A collapsed parent that hides kid.
  s = Object.freeze({ ...key(t, "]").state, collapsed: new Set([collapseKey(t.open, idOf(t, "lead"))]) });
  assert.equal(roster(s).index.has(idOf(t, "kid")), false, "kid is hidden under lead");
  t = key(s, "[").state;
  assert.deepEqual([shownName(t), roster(t).index.has(idOf(t, "kid")), t.selected], ["kid", true, idOf(t, "kid")]);
});

test("the palette as it opens selects the second instance when the first recent entry is the shown tab; with a query, or no second instance, the first row", () => {
  const s = opened(SIX(), "dev-a", "dev-b");
  const palette = leaderThen(s, "k").state;
  const items = paletteItems(palette);
  assert.deepEqual(items.items.slice(0, 3).map((item) => item.label), ["independent", "dev-b", "dev-a"], "under their group's label row, the most recent first");
  assert.equal(items.selected, items.items[2].key, "dev-a, the terminal before");
  const ran = key(palette, "enter");
  assert.deepEqual([ran.effect, shownName(ran.state), ran.state.terminal.focus], [{ show: idOf(s, "dev-a") }, "dev-a", "terminal"], "Enter goes back to it");
  // Typed, the first row that can be selected: the first instance, under its group's label row.
  const typed = key(palette, "d").state;
  assert.deepEqual([paletteItems(typed).items[0].kind, paletteItems(typed).selected], ["group", paletteItems(typed).items[1].key]);
  // One instance only: the row after it is a view, so the instance stays selected.
  const alone = leaderThen(opened(stateOf(observed([instanceRow("dev", "solo")])), "solo"), "k").state;
  const list = paletteItems(alone);
  assert.deepEqual([list.items[0].kind, list.items[2].kind, list.selected], ["group", "view", list.items[1].key]);
});

test("a tab shown counts for the palette's recency: after [ the palette goes back to the tab shown before", () => {
  const s = key(toList(opened(SIX(), "dev-a", "dev-b", "dev-c")), "[").state;
  assert.equal(shownName(s), "dev-b");
  const items = paletteItems(key(s, "ctrl+k").state);
  assert.deepEqual(items.items.slice(0, 4).map((item) => item.label), ["independent", "dev-b", "dev-c", "dev-a"]);
  assert.equal(items.selected, items.items[2].key, "dev-c, the one shown before");
});

// ── Closing ──────────────────────────────────────────────────────────────────────────────────────

test("c from the list closes the shown tab and shows the one to its right, else the one to its left; the focus stays in the list; the last one's close closes the panel", () => {
  let s = key(key(toList(opened(SIX(), "dev-a", "dev-b", "dev-c")), "[").state, "[").state;
  s = key(s, "]").state;
  assert.equal(shownName(s), "dev-b");
  let step = key(s, "c");
  assert.deepEqual(step.effect, { close: [idOf(s, "dev-b")], show: idOf(s, "dev-c") });
  assert.deepEqual([strip(step.state), shownName(step.state), step.state.terminal.focus, step.state.selected], [["dev-a", "dev-c"], "dev-c", "list", idOf(s, "dev-c")], "the right one");
  step = key(step.state, "c");
  assert.deepEqual(step.effect, { close: [idOf(s, "dev-c")], show: idOf(s, "dev-a") });
  assert.deepEqual([strip(step.state), shownName(step.state)], [["dev-a"], "dev-a"], "the left one, at the end");
  step = key(step.state, "c");
  assert.deepEqual([step.effect, step.state.tabs.length, step.state.terminal, step.state.focus], [{ close: [idOf(s, "dev-a")] }, 0, null, "list"]);
  // From the detail too, the last one's close gives the list the focus (Done 5).
  const detail = key(toList(opened(SIX(), "dev-a")), "tab").state;
  assert.equal(detail.focus, "detail");
  assert.deepEqual([key(detail, "c").state.terminal, key(detail, "c").state.focus], [null, "list"]);
  // A close that leaves a neighbour leaves the focus where it was.
  const two = key(toList(opened(SIX(), "dev-a", "dev-b")), "tab").state;
  assert.deepEqual([shownName(key(two, "c").state), key(two, "c").state.focus], ["dev-a", "detail"]);
});

test("the leader then w from the terminal's focus closes the shown tab and gives the focus to the neighbour shown next; from the list the focus stays in the list", () => {
  const s = opened(SIX(), "dev-a", "dev-b");
  const step = leaderThen(s, "w");
  assert.deepEqual(step.effect, { close: [idOf(s, "dev-b")], show: idOf(s, "dev-a") });
  assert.deepEqual([shownName(step.state), step.state.terminal.focus], ["dev-a", "terminal"]);
  // Zoomed, the neighbour is shown zoomed too: the zoom is the panel's (round 1 of the review).
  const zoomed = leaderThen(leaderThen(s, "z").state, "w");
  assert.deepEqual([shownName(zoomed.state), zoomed.state.terminal.focus, zoomed.state.terminal.zoom], ["dev-a", "terminal", true]);
  const fromList = leaderThen(toList(s), "w");
  assert.deepEqual([shownName(fromList.state), fromList.state.terminal.focus], ["dev-a", "list"]);
  const last = leaderThen(step.state, "w");
  assert.deepEqual([last.effect, last.state.terminal], [{ close: [idOf(s, "dev-a")] }, null]);
});

test("the shown viewer's own end from the detail's focus gives the list the focus, so its neighbour is drawn (round 1 of the review)", () => {
  const s = key(toList(opened(SIX(), "dev-a", "dev-b")), "tab").state;
  assert.equal(s.focus, "detail");
  const step = reduce(s, { returned: { id: idOf(s, "dev-b"), status: 1, stderr: "lost\n" }, ...AT });
  assert.deepEqual([shownName(step.state), step.state.terminal.focus, step.state.focus], ["dev-a", "list", "list"]);
  assert.notEqual(draw(step.state, { cols: 120, rows: 40 }).terminal, null, "the neighbour's terminal is drawn, not the detail");
  // A hidden tab's end leaves the detail as it is.
  const hidden = reduce(s, { returned: { id: idOf(s, "dev-a"), status: 1, stderr: "lost\n" }, ...AT });
  assert.deepEqual([shownName(hidden.state), hidden.state.focus], ["dev-b", "detail"]);
});

test("the shown viewer's own end closes its tab, shows its neighbour and gives the list the focus; the line names its instance", () => {
  const s = opened(SIX(), "dev-a", "dev-b", "dev-c");
  const middle = key(key(toList(s), "[").state, "enter").state;
  assert.deepEqual([shownName(middle), middle.terminal.focus], ["dev-b", "terminal"]);
  const step = reduce(middle, { returned: { id: idOf(s, "dev-b"), status: 1, stderr: "lost\n" }, ...AT });
  assert.deepEqual(step.effect, { refresh: { live: true }, show: idOf(s, "dev-c") });
  assert.deepEqual([strip(step.state), shownName(step.state), step.state.terminal.focus], [["dev-a", "dev-c"], "dev-c", "list"]);
  assert.equal(JSON.stringify(step.state.outcome).includes("dev-b"), true, "the line names dev-b");
  const end = reduce(reduce(step.state, { returned: { id: idOf(s, "dev-c"), status: 0, stderr: "" }, ...AT }).state, { returned: { id: idOf(s, "dev-a"), status: 0, stderr: "" }, ...AT });
  assert.deepEqual([end.state.tabs.length, end.state.terminal], [0, null], "the last one's end closes the panel");
});

test("a hidden viewer's own end closes its tab and changes neither the shown tab nor the focus; the line says what happened when it has something to say", () => {
  const s = opened(SIX(), "dev-a", "dev-b", "dev-c");
  const failedEnd = reduce(s, { returned: { id: idOf(s, "dev-a"), status: 1, stderr: "lost\n" }, ...AT });
  assert.deepEqual(failedEnd.effect, { refresh: { live: true } });
  assert.deepEqual([strip(failedEnd.state), shownName(failedEnd.state), failedEnd.state.terminal.focus], [["dev-b", "dev-c"], "dev-c", "terminal"]);
  assert.equal(JSON.stringify(failedEnd.state.outcome).includes("dev-a"), true, "the line names dev-a");
  const clean = reduce(s, { returned: { id: idOf(s, "dev-a"), status: 0, stderr: "" }, ...AT });
  assert.deepEqual([strip(clean.state), clean.state.outcome], [["dev-b", "dev-c"], s.outcome]);
  // The end of a tab the person closed is no tab any more: nothing changes.
  assert.equal(reduce(failedEnd.state, { returned: { id: idOf(s, "dev-a"), status: 0, stderr: "", asked: true }, ...AT }).state, failedEnd.state);
});

// ── Activity ─────────────────────────────────────────────────────────────────────────────────────

test("a hidden tab's output marks it; the shown tab's does not; showing it clears the mark", () => {
  const s = opened(SIX(), "dev-a", "dev-b");
  const marked = reduce(s, { activity: { id: idOf(s, "dev-a") }, ...AT }).state;
  assert.deepEqual(marked.tabs.map((tab) => tab.activity), [true, false]);
  assert.equal(reduce(s, { activity: { id: idOf(s, "dev-b") }, ...AT }).state.tabs[1].activity, false, "the shown tab");
  assert.equal(reduce(marked, { activity: { id: "nobody" }, ...AT }).state.tabs.some((tab) => tab.id === "nobody"), false);
  const shown = leaderThen(marked, "left").state;
  assert.deepEqual([shownName(shown), shown.tabs.map((tab) => tab.activity)], ["dev-a", [false, false]]);
});

// ── Workspaces and spawns ────────────────────────────────────────────────────────────────────────

test("opening another workspace closes every tab: one close for each, and no terminal", () => {
  const s = opened(SIX(), "dev-a", "dev-b", "dev-c");
  const step = reduce(s, { admitted: "/srv/other", at: "2026-10-11T10:01:00.000Z", ...AT });
  assert.notEqual(step.state.open, s.open);
  assert.deepEqual([step.state.tabs.length, step.state.terminal], [0, null]);
  assert.deepEqual(step.effect.close, ["dev-a", "dev-b", "dev-c"].map((name) => idOf(s, name)));
  // Opening the same workspace again leaves them.
  const same = reduce(s, { admitted: s.open, at: "2026-10-11T10:01:00.000Z", ...AT });
  assert.equal(same.state.tabs.length, 3);
});

// ── The tab bar ──────────────────────────────────────────────────────────────────────────────────

/** dev-alpha (hidden, with output), dev-beta-with-a-long-name (hidden, on garnet), dev-gamma
 *  (shown, the focus in it). */
function three({ ascii = false } = {}) {
  let s = opened(stateOf(observed(["dev-alpha", "dev-beta-with-a-long-name", "dev-gamma"].map((name) => instanceRow("dev", name))), { ascii }), "dev-alpha", "dev-beta-with-a-long-name", "dev-gamma");
  s = reduce(s, { activity: { id: idOf(s, "dev-alpha") }, ...AT }).state;
  return Object.freeze({ ...s, tabs: Object.freeze(s.tabs.map((tab) => (tab.name === "dev-beta-with-a-long-name" ? Object.freeze({ ...tab, routed: true, machine: "garnet" }) : tab))) });
}
/** The strip as drawn at `cols`: its text from the terminal's first column, and its cells. */
function stripAt(state, cols) {
  const d = draw(state, { cols, rows: 24 }), t = d.terminal;
  return { text: d.lines[t.title].slice(t.col), cells: d.cells[t.title].slice(t.col, t.col + t.cols), cols: t.cols };
}
const cellsOf = (s, word) => { const at = s.text.indexOf(word); assert.notEqual(at, -1, word); return s.cells.slice(at, at + word.length); };

/** Each cell of `word` in the strip is dim, a blank one passed over. */
const dimCells = (s, word) => cellsOf(s, word).filter((each) => each.text !== " ").every((cell) => cell.style.dim === true);

test("the tab bar at 120 columns: every tab in opening order, a dim │ between two; the shown one in brackets, bold and in reverse while its terminal has the focus, its sides included; a hidden one dim, with output marked; another machine's · <machine> dim inside its tab", () => {
  const s = stripAt(three(), 120);
  assert.equal(s.text, " dev-alpha• │ dev-beta-with-a-long-name · garnet │[dev-gamma]");
  for (const cell of cellsOf(s, "[dev-gamma]")) assert.deepEqual([cell.style.reverse, cell.style.bold], [true, true], "the front tab, sides and all");
  for (const cell of cellsOf(s, "dev-alpha")) assert.deepEqual([cell.style.reverse, cell.style.bold, cell.style.dim], [false, false, true], "a hidden tab is dim");
  assert.equal(cellsOf(s, "•")[0].style.dim, false, "the activity mark is not dim");
  assert.equal(dimCells(s, "· garnet"), true, "the machine is dim");
  for (const cell of s.cells.filter((each) => each.text === "│")) assert.equal(cell.style.dim, true, "a divider is dim");
  assert.equal(s.cells.filter((each) => each.text === "│").length, 2, "one divider between two tabs, none at the ends");
  assert.equal(textWidth(s.text) <= s.cols, true);
  // From the list the shown one is bold, not reverse; it keeps its brackets, the mark no style is needed for.
  const list = stripAt(toList(three()), 120);
  assert.equal(list.text, s.text);
  for (const cell of cellsOf(list, "[dev-gamma]")) assert.deepEqual([cell.style.reverse, cell.style.bold], [false, true]);
});

test("the tab bar of another machine's agent while it is the shown tab: its machine dim inside the brackets, in the tab's reverse video", () => {
  let s = opened(SIX(), "dev-a");
  s = Object.freeze({ ...s, tabs: Object.freeze(s.tabs.map((tab) => Object.freeze({ ...tab, routed: true, machine: "garnet" }))), terminal: Object.freeze({ ...s.terminal, routed: true, machine: "garnet" }) });
  const bar = stripAt(s, 120);
  assert.equal(bar.text, "[dev-a · garnet]");
  for (const cell of cellsOf(bar, "· garnet").filter((each) => each.text !== " ")) assert.deepEqual([cell.style.dim, cell.style.reverse], [true, true]);
  for (const cell of cellsOf(bar, "dev-a")) assert.deepEqual([cell.style.bold, cell.style.reverse, cell.style.dim], [true, true, false]);
  const list = stripAt(toList(s), 120);
  assert.equal(list.text, "[dev-a · garnet]");
  for (const cell of cellsOf(list, "garnet")) assert.deepEqual([cell.style.dim, cell.style.reverse], [true, false]);
});

test("the tab bar at 80 columns: another machine is cut first, then hidden names with …; the shown tab stays whole", () => {
  const s = stripAt(three(), 80);
  assert.equal(s.cols < 62, true, "too narrow for the whole bar");
  assert.equal(s.text.includes("garnet"), false, "the machine went first");
  assert.match(s.text, /^ dev-alpha• │ dev-beta-with\S*… │\[dev-gamma\]$/);
  assert.equal(textWidth(s.text) <= s.cols, true);
});

test("the tab bar at 60 columns (the terminal zoomed to the whole width) cuts the hidden machine only; in ASCII the mark is *, the divider |, the machine's dot - and the cut ...", () => {
  const s = stripAt(three(), 60);
  assert.equal(s.cols, 60);
  assert.equal(s.text, " dev-alpha• │ dev-beta-with-a-long-name │[dev-gamma]");
  const wide = stripAt(three({ ascii: true }), 120);
  assert.equal(wide.text, " dev-alpha* | dev-beta-with-a-long-name - garnet |[dev-gamma]");
  const ascii = stripAt(three({ ascii: true }), 80);
  assert.match(ascii.text, /^ dev-alpha\* \| dev-beta-with\S*\.\.\. \|\[dev-gamma\]$/);
  assert.equal(textWidth(ascii.text) <= ascii.cols, true);
  assert.equal([...ascii.text].every((ch) => ch.charCodeAt(0) < 128), true, "printable ASCII");
});

test("with a single tab the top row is still a tab bar: the one tab, in brackets, and no divider; back to one tab after a close, the same", () => {
  const one = opened(SIX(), "dev-a");
  const s = stripAt(one, 120);
  assert.equal(s.text, "[dev-a]");
  for (const cell of cellsOf(s, "[dev-a]")) assert.deepEqual([cell.style.bold, cell.style.reverse], [true, true]);
  const after = stripAt(leaderThen(opened(SIX(), "dev-a", "dev-b"), "w").state, 120);
  assert.equal(after.text, "[dev-a]", "back to one tab");
});

test("under NO_COLOR the shown tab still reads as the front one: its brackets are text, and only attributes are written", () => {
  const sz = { cols: 120, rows: 24 }, d = draw(three(), sz);
  const bytes = createScreen({ utf8: true, color: false }).render(d.rows, sz, { full: true });
  assert.equal(bytes.includes("[dev-gamma]"), true);
  // Every SGR written is a reset and attributes (1 bold, 2 dim, 7 reverse): no colour parameter.
  for (const [, params] of bytes.matchAll(/\u001b\[([0-9;]*)m/g)) for (const p of params.split(";").filter(Boolean)) assert.equal(["0", "1", "2", "3", "4", "7", "9"].includes(p), true, `SGR ${params}`);
});

test("a shown name that fits the panel stays whole however many tabs are hidden: the hidden ones farthest from it are left out first, each with its divider (round 1 of the review)", () => {
  const LONG = "backend-maintainer-deployment-review-rel";
  const base = () => stateOf(observed(["a", "b", "c", LONG].map((name) => instanceRow("dev", name))));
  const last = opened(base(), "a", "b", "c", LONG);
  const s = stripAt(last, 80);
  assert.equal(s.cols, 49);
  assert.equal(s.text, ` c │[${LONG}]`, "the nearest hidden tab is kept, the others left out");
  assert.equal(textWidth(s.text) <= s.cols, true);
  // Shown first: the bar starts with it, whole.
  const first = key(key(key(toList(opened(base(), LONG, "a", "b", "c")), "[").state, "[").state, "[").state;
  assert.equal(shownName(first), LONG);
  assert.equal(stripAt(first, 80).text, `[${LONG}]│ a`);
  // Wider, every tab is there.
  assert.equal(stripAt(last, 120).text, ` a │ b │ c │[${LONG}]`);
  // A shown name wider than the panel is cut, its brackets kept, and no hidden tab is drawn.
  const huge = "x".repeat(60);
  const lone = stripAt(opened(stateOf(observed(["a", huge].map((name) => instanceRow("dev", name)))), "a", huge), 80);
  assert.equal(lone.text, `[${"x".repeat(46)}…]`);
});

/** The cheat sheet as drawn at `size`: the sidebar's rows from the leader's on, to the first empty one. */
function sheet(state, size) {
  const d = draw(state, size), rows = d.lines.map((line) => line.slice(0, d.cols).trimEnd());
  const from = rows.findIndex((row) => row.startsWith(" Ctrl+\\ "));
  const to = rows.indexOf("", from);
  return rows.slice(from, to < 0 ? rows.length : to);
}

test("with tabs open the list's cheat sheet is small, from the list and from the detail: no zoom, close terminal or [/] tab, which the leader's hint names, its tabs' keys while two tabs or more are open; on short rows the sheet gives up its rows from the end", () => {
  const one = toList(opened(SIX(), "dev-a")), two = toList(opened(SIX(), "dev-a", "dev-b"));
  const tall = { cols: 120, rows: 30 };
  const all = [" Ctrl+\\   commands", " Ctrl+K   palette", " Enter    focus terminal", " n        spawn", " w        workspaces", " ?        help", " q        quit"];
  assert.deepEqual(sheet(one, tall), all, "one tab");
  assert.deepEqual(sheet(two, tall), all, "two tabs: the same sheet");
  assert.deepEqual(sheet(key(two, "tab").state, tall), [...all.slice(0, 2), " Tab      back", ...all.slice(2)], "from the detail: Tab back after the palette");
  // The leader's hint keeps the open terminal's keys, and the tabs' only with two or more.
  const hint = (s) => sheet(reduce(s, { key: s.leaderKey, read: ++reads, ...AT }).state, tall);
  assert.deepEqual(hint(two).slice(4, 7), [" z            zoom", " w            close terminal", " Left/Right   tab"]);
  assert.equal(hint(one).some((row) => row.endsWith(" tab")), false, "one tab: nothing to switch to");
  assert.deepEqual(sheet(two, { cols: 100, rows: 24 }), all, "the rows hold it whole");
  assert.deepEqual(sheet(two, { cols: 100, rows: 17 }), all.slice(0, 4), "given up from its end: quit, help and workspaces");
  assert.deepEqual(sheet(two, { cols: 100, rows: 15 }), all.slice(0, 2), "the list keeps its rows");
});
