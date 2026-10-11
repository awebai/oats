process.env.TZ = "UTC"; // a clock time on the screen is local: every time here is computed in one zone
// The store: the state of `oats tui` and reduce(state, event). Every entry here is made by the
// shared functions (helpers.mjs), every key is pressed with the geometry of the frame drawn before
// it (press), and no test needs a terminal, a timer or a process.
import test from "node:test";
import assert from "node:assert/strict";
import { ACTIONS } from "../lib/actions.mjs";
import { collapseKey, instanceId } from "../lib/client.mjs";
import { effectiveConfig } from "../lib/config.mjs";
import { model, roster } from "../lib/model.mjs";
import { QUERY_LIMIT, initialState, reduce } from "../lib/store.mjs";
import { windowOf } from "../lib/views/scroll.mjs";
import { CLI, DEPLOYMENT, NOW, draw, failed, instanceRow, observed, pending, press, stateOf } from "./helpers.mjs";

const SIZE = { cols: 80, rows: 24 }, SHORT = { cols: 80, rows: 15 };
const STOPPED = { running: false, runtimeState: "stopped" };
const FAMILY = "\u{1f469}‍\u{1f469}‍\u{1f467}‍\u{1f466}"; // one grapheme of seven code points
const TIMEOUT = { code: "E_CLI_TIMEOUT", message: "the read did not answer in time" };
const UNREADABLE = { code: "E_REMOTE_UNREADABLE", message: "the remote cache could not be read" };
const MOVES = ["k", "up", "j", "down", "g", "home", "G", "end", "pageup", "pagedown"];

/** Two clusters and two single instances, out of order. Drawn: alpha, alpha-kid, lead, child-a,
 *  grandchild, child-b, the empty row, solo-x, solo-y. */
const TREE = [
  instanceRow("dev", "solo-y", STOPPED),
  instanceRow("dev", "grandchild", { parentInstance: "child-a" }),
  instanceRow("dev", "lead"),
  instanceRow("dev", "child-b", { parentInstance: "lead", ...STOPPED }),
  instanceRow("dev", "alpha", STOPPED),
  instanceRow("dev", "solo-x"),
  instanceRow("dev", "child-a", { parentInstance: "lead" }),
  instanceRow("dev", "alpha-kid", { parentInstance: "alpha" }),
];
const TREE_DRAWN = ["alpha", "alpha-kid", "lead", "child-a", "grandchild", "child-b", null, "solo-x", "solo-y"];
const solos = (...names) => names.map((name) => instanceRow("dev", name));
/** Forty single instances: more than a pane of 80x24 holds. */
const MANY = Array.from({ length: 40 }, (_, i) => instanceRow("dev", `inst-${String(i).padStart(2, "0")}`));

/** The drawn order as names, null for the empty row. */
const drawn = (state) => roster(state).items.map((item) => item && item.row.instance);
/** The instances drawn, without the empty row. While a collapse or a filter hides part of a
 *  cluster the tests read this, or membership alone: which group such a cluster is drawn in, and
 *  where the empty row stands beside it, is the shared grouping's to decide (awebai/oats#971). */
const listed = (state) => drawn(state).filter(Boolean);
/** The name of the selected instance, or null. */
const selectedName = (state) => roster(state).rows.find((item) => item.id === state.selected)?.row.instance ?? null;
/** The place of the selection among the drawn items, or -1. */
const selectedAt = (state) => roster(state).index.get(state.selected) ?? -1;
const idOf = (name, soul = "dev") => instanceId(instanceRow(soul, name));
const keyOf = (name, soul = "dev") => collapseKey(DEPLOYMENT, idOf(name, soul));
/** A newer answer of the reader. */
const take = (state, entry, number = state.number + 1) => reduce(state, { entry, number }).state;
/** Move the selection to a named row with the keys a user has: the first row, then down. */
const goTo = (state, name, size = SIZE) => press(state, ["g", ...Array(roster(state).rows.findIndex((item) => item.row.instance === name)).fill("j")], size).state;
/** Type text into the open filter field, a grapheme a key, without drawing a frame for each. */
const typed = (state, text) => [...new Intl.Segmenter().segment(text)].reduce((s, g) => reduce(s, { key: g.segment === " " ? "space" : g.segment, text: g.segment, page: 19, extent: 0, room: 19 }).state, state);
/** Whether the store's own `top` shows the selected row in the list pane of a terminal this size. */
function shows(state, size = SIZE) {
  const { page } = draw(state, size), count = roster(state).items.length, at = selectedAt(state);
  const win = windowOf({ top: state.top, count, height: page });
  return at >= win.top && at < win.top + win.size;
}
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const inner of Object.values(value)) deepFreeze(inner); }
  return value;
}

// --- The first state -------------------------------------------------------------------

test("the first state shows the instances view, has taken no answer, selects nothing, collapses nothing, focuses the list, edits no filter, and is frozen", () => {
  const entry = pending();
  const state = initialState({ deployment: DEPLOYMENT, cli: CLI, home: "/home/u", entry });
  assert.deepEqual(
    { view: state.view, number: state.number, selected: state.selected, focus: state.focus, top: state.top, detailTop: state.detailTop, filter: state.filter, ascii: state.ascii },
    { view: "instances", number: 0, selected: null, focus: "list", top: 0, detailTop: 0, filter: { editing: false, query: "" }, ascii: false },
  );
  assert.equal(state.collapsed instanceof Set, true);
  assert.equal(state.collapsed.size, 0);
  assert.equal(state.entry, entry, "the entry is the one it was given, as it is");
  assert.equal(state.deployment, DEPLOYMENT);
  assert.equal(state.cli, CLI);
  assert.equal(state.actions, ACTIONS, "without a tui.json the table is the default one");
  assert.equal(Object.isFrozen(state), true);
  assert.equal(Object.isFrozen(state.filter), true);
  assert.equal(initialState({ deployment: DEPLOYMENT, cli: CLI, home: "/home/u", entry, ascii: true }).ascii, true);
});

// --- Every kind of event ---------------------------------------------------------------

test("a key with an action answers a new state or an effect; a key bound to nothing answers the same state object and no effect", () => {
  const state = stateOf(observed(TREE));
  const moved = reduce(state, { key: "j", text: "j", page: 19, extent: 9, room: 19 });
  assert.notEqual(moved.state, state);
  assert.equal(moved.effect, null);
  assert.equal(selectedName(moved.state), "alpha-kid");
  assert.deepEqual(reduce(state, { key: "r", text: "r", page: 19, extent: 9, room: 19 }).effect, { refresh: { live: true } });
  // Enter is bound to nothing in this version; neither is a letter no action holds, nor a key no table names.
  for (const key of ["enter", "z", "Z", "f5", "insert", "ctrl+x", "shift+tab", "2", "3"]) {
    const result = reduce(state, { key, ...(key.length === 1 ? { text: key } : {}), page: 19, extent: 9, room: 19 });
    assert.equal(result.state, state, key);
    assert.equal(result.effect, null, key);
  }
});

test("a paste outside the filter field is dropped whole, and an entry is taken as it is with its number", () => {
  const state = stateOf(observed(TREE));
  const pasted = reduce(state, { paste: "solo\nq" });
  assert.equal(pasted.state, state);
  assert.equal(pasted.effect, null);
  const entry = observed(solos("a", "b"));
  const took = reduce(state, { entry, number: 7 });
  assert.equal(took.effect, null);
  assert.equal(took.state.entry, entry, "the store adds nothing to an entry and removes nothing: it is the same object");
  assert.equal(took.state.number, 7);
  assert.deepEqual(drawn(took.state), ["a", "b"]);
});

test("the store keeps no size: a key's page, extent and room leave no trace of a terminal in the state", () => {
  const state = press(stateOf(observed(MANY)), ["j", "pagedown", "tab", "j", "?", "j"], SHORT).state;
  for (const key of Object.keys(state)) assert.doesNotMatch(key, /^(cols|rows|size|width|height|page|extent|room)$/, key);
});

// --- Answers by number -----------------------------------------------------------------

test("an answer whose number is not higher than the last one taken is dropped, equal or lower, a success or a failure", () => {
  const first = observed(solos("a", "b"));
  const state = take(stateOf(), first, 5);
  assert.equal(state.number, 5);
  for (const number of [5, 4, 1, 0]) for (const entry of [observed(solos("z")), failed(first, TIMEOUT), failed(first, UNREADABLE), pending()]) {
    const result = reduce(state, { entry, number });
    assert.equal(result.state, state, `number ${number}, ${entry.deployment.status}`);
    assert.equal(result.effect, null);
  }
});

test("a newer answer is taken whatever came before it: a success after a failure, and a failure after a success", () => {
  const first = observed(solos("a", "b")), lost = failed(first, TIMEOUT), second = observed(solos("a", "b", "c"));
  let state = take(stateOf(), first, 1);
  state = take(state, lost, 2);
  assert.equal(state.entry, lost);
  assert.equal(state.entry.deployment.status, "unavailable");
  assert.equal(state.number, 2);
  state = take(state, second, 3);
  assert.equal(state.entry, second);
  assert.deepEqual(drawn(state), ["a", "b", "c"]);
  // The answer of cycle 2, arriving late, does not undo cycle 3: neither as a failure nor as a success.
  assert.equal(reduce(state, { entry: lost, number: 2 }).state, state);
  assert.equal(reduce(state, { entry: first, number: 1 }).state, state);
  state = take(state, failed(second, TIMEOUT), 9);
  assert.equal(state.entry.deployment.status, "unavailable");
  assert.equal(state.number, 9);
});

// --- Selection is an identity ----------------------------------------------------------

test("before the first answer nothing is selected, and the first observed entry selects the first drawn row", () => {
  assert.equal(stateOf().selected, null);
  const state = stateOf(observed(TREE));
  assert.deepEqual(drawn(state), TREE_DRAWN);
  assert.equal(state.selected, idOf("alpha"));
  assert.equal(stateOf(observed([])).selected, null, "with no instance there is nothing to select");
});

test("across a new observation the selection stays on its instance, wherever that instance now stands", () => {
  let state = goTo(stateOf(observed(solos("b", "c", "d"))), "c");
  assert.equal(selectedAt(state), 1);
  state = take(state, observed(solos("a", "b", "c", "d")));
  assert.deepEqual(drawn(state), ["a", "b", "c", "d"]);
  assert.equal(state.selected, idOf("c"));
  assert.equal(selectedAt(state), 2, "one row further down, and still selected");
  // It stopped: it is drawn after the running ones, and it is still the selection.
  state = take(state, observed([...solos("a", "b", "d"), instanceRow("dev", "c", STOPPED)]));
  assert.deepEqual(drawn(state), ["a", "b", "d", "c"]);
  assert.equal(state.selected, idOf("c"));
  // It joined a cluster: the same.
  state = take(state, observed([...solos("a", "b", "d"), instanceRow("dev", "c", { parentInstance: "d" })]));
  assert.deepEqual(drawn(state), ["d", "c", null, "a", "b"]);
  assert.equal(state.selected, idOf("c"));
});

test("when the selected instance is gone the selection moves to the row now at the same place, to the last row when that place is past the end, and to none when no row is left", () => {
  const all = stateOf(observed(solos("a", "b", "c", "d")));
  let state = take(goTo(all, "b"), observed(solos("a", "c", "d")));
  assert.equal(selectedName(state), "c", "the row now second");
  state = take(goTo(all, "d"), observed(solos("a", "b")));
  assert.equal(selectedName(state), "b", "the last row");
  state = take(goTo(all, "a"), observed(solos("b", "c", "d")));
  assert.equal(selectedName(state), "b", "the row now first");
  state = take(goTo(all, "c"), observed([]));
  assert.equal(state.selected, null);
  state = take(state, observed(solos("x", "y")));
  assert.equal(selectedName(state), "x", "with none selected, an observed entry selects the first row");
});

test("a selection that moves never lands on the empty row between clusters and single instances", () => {
  // child-b is the sixth row; without it the sixth place of the drawn order is the empty row.
  const state = take(goTo(stateOf(observed(TREE)), "child-b"), observed(TREE.filter((row) => row.instance !== "child-b")));
  assert.deepEqual(drawn(state), ["alpha", "alpha-kid", "lead", "child-a", "grandchild", null, "solo-x", "solo-y"]);
  assert.equal(selectedName(state), "solo-x");
});

test("two instances with one name in two souls are two rows, selected apart", () => {
  const twins = [instanceRow("soul-a", "twin"), instanceRow("soul-b", "twin")];
  let state = stateOf(observed(twins));
  assert.deepEqual(drawn(state), ["twin", "twin"]);
  assert.notEqual(idOf("twin", "soul-a"), idOf("twin", "soul-b"));
  assert.equal(state.selected, idOf("twin", "soul-a"));
  state = press(state, ["j"]).state;
  assert.equal(state.selected, idOf("twin", "soul-b"));
  state = take(state, observed([...twins, instanceRow("soul-a", "aaa")]));
  assert.equal(state.selected, idOf("twin", "soul-b"), "the one selected stays selected, not its namesake");
  state = take(state, observed([twins[0]]));
  assert.equal(state.selected, idOf("twin", "soul-a"), "and when it is retired the selection moves to another row");
});

// --- A failed read ---------------------------------------------------------------------

test("a failed read keeps what the user had: an unavailable entry moves neither the selection, the scroll nor the collapse set, and the next observed entry finds the selection where it was", () => {
  const rows = [...TREE, ...MANY], entry = observed(rows);
  let state = press(goTo(stateOf(entry), "child-a"), ["h"]).state;
  state = goTo(state, "inst-30");
  const before = { selected: state.selected, top: state.top, collapsed: state.collapsed, focus: state.focus };
  assert.equal(before.selected, idOf("inst-30"));
  assert.equal(before.top > 0, true, "the list is scrolled");
  assert.deepEqual([...before.collapsed], [keyOf("child-a")]);
  for (const lost of [failed(entry, TIMEOUT), failed(entry, { code: "E_WORKSPACE_INVALID", message: "oats-local.yaml cannot be read" }), failed(entry, { feature: "workspace-v2" }), pending()]) {
    const after = take(state, lost);
    assert.equal(after.entry, lost);
    assert.equal(roster(after).rows.length, 0, "an entry that is not observed has no rows");
    assert.deepEqual({ selected: after.selected, top: after.top, collapsed: after.collapsed, focus: after.focus }, before, lost.deployment.status);
    assert.equal(after.collapsed, before.collapsed, "the same set, untouched");
    const back = take(after, observed(rows));
    assert.equal(back.selected, before.selected);
    assert.equal(back.top, before.top);
    assert.deepEqual([...back.collapsed], [keyOf("child-a")]);
    assert.equal(drawn(back).includes("grandchild"), false, "what was collapsed is still collapsed");
    assert.equal(model(back, { page: draw(back).page, now: NOW, at: new Date(NOW).toISOString() }).list.some((row) => row?.selected), true);
  }
});

test("a stale entry keeps the rows and the selection: an observed entry whose re-read could not reach the remote", () => {
  const entry = observed(TREE);
  const state = goTo(stateOf(entry), "grandchild");
  const stale = failed(entry, UNREADABLE);
  assert.equal(stale.deployment.status, "observed", "the shared rule keeps the observation");
  const after = take(state, stale);
  assert.equal(after.entry, stale);
  assert.deepEqual(drawn(after), TREE_DRAWN);
  assert.equal(after.selected, idOf("grandchild"));
  assert.equal(after.top, state.top);
  assert.equal(after.collapsed, state.collapsed);
});

test("a collapsed parent that is retired leaves the collapse set on the next observed entry, and the keys of instances still there stay", () => {
  let state = press(goTo(stateOf(observed(TREE)), "child-a"), ["h"]).state;
  state = press(goTo(state, "alpha"), ["h"]).state;
  assert.deepEqual(new Set(state.collapsed), new Set([keyOf("child-a"), keyOf("alpha")]));
  const held = state.collapsed;
  // Not on a failed read: nothing says the parent is gone.
  assert.equal(take(state, failed(state.entry, TIMEOUT)).collapsed, held);
  const after = take(state, observed(TREE.filter((row) => row.instance !== "child-a")));
  assert.deepEqual([...after.collapsed], [keyOf("alpha")]);
  assert.deepEqual(new Set(held), new Set([keyOf("child-a"), keyOf("alpha")]), "the set the earlier state holds is not changed");
  // With every collapsed instance still there, nothing is forgotten.
  assert.deepEqual(new Set(take(state, observed([...TREE, instanceRow("dev", "new")])).collapsed), new Set(held));
});

// --- Movement --------------------------------------------------------------------------

test("down and up move the selection one row, by each of their keys, and stop at both ends", () => {
  let state = stateOf(observed(TREE));
  for (const [key, expected] of [["j", "alpha-kid"], ["down", "lead"], ["k", "alpha-kid"], ["up", "alpha"], ["k", "alpha"], ["up", "alpha"]]) {
    state = press(state, [key]).state;
    assert.equal(selectedName(state), expected, key);
  }
  state = goTo(state, "solo-y");
  for (const key of ["j", "down"]) { state = press(state, [key]).state; assert.equal(selectedName(state), "solo-y", `${key} at the last row`); }
});

test("the first and the last row are one key away, by each of their keys", () => {
  const start = goTo(stateOf(observed(TREE)), "child-a");
  for (const key of ["g", "home"]) assert.equal(selectedName(press(start, [key]).state), "alpha", key);
  for (const key of ["G", "end"]) assert.equal(selectedName(press(start, [key]).state), "solo-y", key);
  for (const key of ["g", "home"]) assert.equal(selectedName(press(press(start, ["G"]).state, [key]).state), "alpha", `${key} from the last row`);
});

test("the empty row between clusters and single instances is never selected: down and up step over it", () => {
  let state = stateOf(observed(TREE));
  const down = [selectedName(state)];
  for (let i = 0; i < TREE_DRAWN.length; i++) { state = press(state, ["j"]).state; down.push(selectedName(state)); }
  assert.deepEqual(down, [...TREE_DRAWN.filter(Boolean), "solo-y", "solo-y"]);
  const up = [selectedName(state)];
  for (let i = 0; i < TREE_DRAWN.length; i++) { state = press(state, ["k"]).state; up.push(selectedName(state)); }
  assert.deepEqual(up, [...TREE_DRAWN.filter(Boolean).reverse(), "alpha", "alpha"]);
});

test("a page key moves by a pane and stops at both ends", () => {
  let state = stateOf(observed(MANY));
  const { page } = draw(state);
  assert.equal(page, 19, "the list pane of 80x24");
  // A pane of 19 rows shows 18 instances when rows are cut off, its last row saying so: a page is
  // read here as either, the pane's rows or the rows it shows. Short of an end it is never less.
  const seen = [];
  for (const key of ["pagedown", "pagedown", "pagedown", "pagedown", "pageup", "pageup", "pageup", "pageup"]) {
    const from = selectedAt(state), end = key === "pagedown" ? MANY.length - 1 : 0;
    state = press(state, [key]).state;
    const to = selectedAt(state), by = Math.abs(to - from);
    assert.equal(to === end || by === page || by === page - 1, true, `${key} from row ${from} went to row ${to}`);
    assert.equal(key === "pagedown" ? to >= from : to <= from, true, key);
    seen.push(to);
  }
  assert.deepEqual([seen[2], seen[3], seen[6], seen[7]], [39, 39, 0, 0], "three pages reach each end of 40 rows, and a fourth stays there");
  assert.equal(seen[0] > 1 && seen[1] > seen[0] && seen[4] < 39 && seen[5] < seen[4], true, "a page is more than a row");
});

test("a page that would end on the empty row goes on to the next instance in the direction of travel", () => {
  const state = stateOf(observed(TREE));
  const key = (from, key, page) => selectedName(reduce(goTo(state, from), { key, page, extent: 0, room: page }).state);
  assert.equal(key("alpha", "pagedown", 7), "solo-x", "six rows down from the first is the empty row");
  assert.equal(key("solo-y", "pageup", 3), "child-b", "two rows up from the last is the empty row");
});

test("with nothing selected, any movement key selects the first row", () => {
  const none = Object.freeze({ ...stateOf(observed(TREE)), selected: null });
  for (const key of MOVES) assert.equal(selectedName(press(none, [key]).state), "alpha", key);
});

test("a movement key on a deployment with no rows changes nothing that is drawn", () => {
  for (const state of [stateOf(), stateOf(observed([])), take(stateOf(observed(TREE)), failed(observed(TREE), TIMEOUT))]) {
    for (const key of MOVES) {
      const after = press(state, [key]).state;
      assert.deepEqual({ selected: after.selected, top: after.top }, { selected: state.selected, top: state.top }, key);
    }
  }
});

// --- Scrolling -------------------------------------------------------------------------

test("with more rows than the pane, the selected row is always inside the window and the top moves the least that keeps it so", () => {
  let state = stateOf(observed(MANY));
  const shownRows = draw(state).page - 1; // the pane's last row says what is cut off
  for (let i = 1; i < shownRows; i++) { state = press(state, ["j"]).state; assert.equal(state.top, 0, `row ${i} is in the first window`); }
  assert.equal(selectedAt(state), shownRows - 1);
  state = press(state, ["j"]).state;
  assert.equal(state.top, 1, "one row past the pane scrolls one row");
  state = press(state, ["k"]).state;
  assert.equal(selectedAt(state), shownRows - 1);
  assert.equal(state.top, 1, "and going back up one row does not jump");
  for (let i = shownRows - 2; i >= 1; i--) { state = press(state, ["k"]).state; assert.equal(state.top, 1, `row ${i} is still in the window`); }
  state = press(state, ["k"]).state;
  assert.deepEqual([selectedAt(state), state.top], [0, 0], "above the window: one row up");
  // Every way of moving, from everywhere: the row is inside.
  for (const key of ["G", "pageup", "k", "k", "pageup", "pagedown", "j", "pagedown", "pagedown", "g", "pagedown", "G", "k", "home", "end"]) {
    state = press(state, [key]).state;
    assert.equal(shows(state), true, `after ${key}: row ${selectedAt(state)}, top ${state.top}`);
  }
});

test("after a resize the selected row is still inside: the model corrects the top for the new pane, and the next key leaves it inside", () => {
  const at = new Date(NOW).toISOString();
  const inWindow = (state, size) => model(state, { page: draw(state, size).page, now: NOW, at }).list.some((row) => row?.selected);
  let state = goTo(stateOf(observed(MANY)), "inst-30");
  assert.equal(shows(state, SIZE), true);
  // The terminal is now 15 rows tall. No event told the store: its top is the old one.
  assert.equal(shows(state, SHORT), false, "the old top does not show the row in the shorter pane");
  assert.equal(inWindow(state, SHORT), true, "what is drawn does");
  assert.equal(draw(state, SHORT).lines.some((line) => line.startsWith(">") && line.includes("inst-30")), true);
  for (const key of ["k", "j", "j", "pagedown", "pageup", "G", "g"]) {
    state = press(state, [key], SHORT).state;
    assert.equal(shows(state, SHORT), true, `${key} at 80x15: row ${selectedAt(state)}, top ${state.top}`);
    assert.equal(inWindow(state, SHORT), true);
  }
  state = goTo(state, "inst-30", SHORT);
  // And back: taller again.
  assert.equal(inWindow(state, SIZE), true);
  state = press(state, ["j"], SIZE).state;
  assert.equal(shows(state, SIZE), true);
  // A key that moves nothing keeps the selection where it is, whatever the size.
  assert.equal(press(state, ["ctrl+l"], SHORT).state.selected, state.selected);
});

// --- Collapse and expand ---------------------------------------------------------------

test("collapse on a parent with children collapses it: its children leave the drawn rows and the selection stays on it", () => {
  for (const key of ["h", "left"]) {
    const state = goTo(stateOf(observed(TREE)), "child-a");
    const after = press(state, [key]).state;
    assert.deepEqual([...after.collapsed], [keyOf("child-a")], key);
    assert.equal(listed(after).includes("grandchild"), false, "its child is gone from the list");
    assert.deepEqual(listed(after).sort(), TREE_DRAWN.filter((name) => name && name !== "grandchild").sort(), "and every other instance is still drawn");
    assert.equal(selectedName(after), "child-a");
  }
  // A root over its whole cluster: every row below it leaves, and it is still the selection.
  const root = press(goTo(stateOf(observed(TREE)), "lead"), ["h"]).state;
  assert.deepEqual([...root.collapsed], [keyOf("lead")]);
  for (const below of ["child-a", "grandchild", "child-b"]) assert.equal(listed(root).includes(below), false, below);
  assert.deepEqual(listed(root).sort(), ["alpha", "alpha-kid", "lead", "solo-x", "solo-y"]);
  assert.equal(selectedName(root), "lead");
});

test("collapse on a collapsed row, or on a row without children, selects its parent: a child goes to its parent and a root stays", () => {
  const open = stateOf(observed(TREE));
  let state = press(goTo(open, "child-a"), ["h"]).state;
  const set = state.collapsed;
  state = press(state, ["h"]).state;
  assert.equal(selectedName(state), "lead", "a collapsed child goes to its parent");
  assert.equal(state.collapsed, set, "and nothing more is collapsed");
  for (const [from, to] of [["grandchild", "child-a"], ["child-b", "lead"], ["alpha-kid", "alpha"]]) {
    const after = press(goTo(open, from), ["left"]).state;
    assert.equal(selectedName(after), to, `${from} has no children`);
    assert.equal(after.collapsed.size, 0);
  }
  for (const root of ["solo-x", "solo-y"]) {
    const at = goTo(open, root), after = press(at, ["h"]).state;
    assert.equal(after.selected, at.selected, `${root} is a root: it stays`);
    assert.equal(after.collapsed.size, 0);
  }
  const closed = press(goTo(open, "lead"), ["h"]).state, again = press(closed, ["h"]).state;
  assert.equal(selectedName(again), "lead", "a collapsed root stays");
  assert.deepEqual([...again.collapsed], [keyOf("lead")]);
});

test("expand on a collapsed row expands it, on an expanded row selects its first child, and on a row without children does nothing", () => {
  const open = stateOf(observed(TREE));
  for (const key of ["l", "right"]) {
    const closed = press(goTo(open, "child-a"), ["h"]).state;
    const expanded = press(closed, [key]).state;
    assert.equal(expanded.collapsed.size, 0, key);
    assert.deepEqual(drawn(expanded), TREE_DRAWN);
    assert.equal(selectedName(expanded), "child-a", "expanding moves no selection");
    assert.equal(selectedName(press(expanded, [key]).state), "grandchild", "expanded: its first child");
    assert.equal(selectedName(press(goTo(open, "lead"), [key]).state), "child-a");
    assert.equal(selectedName(press(goTo(open, "alpha"), [key]).state), "alpha-kid");
    for (const leaf of ["grandchild", "child-b", "alpha-kid", "solo-x", "solo-y"]) {
      const at = goTo(open, leaf), after = press(at, [key]).state;
      assert.equal(after.selected, at.selected, `${leaf} has no children`);
      assert.equal(after.collapsed.size, 0);
    }
  }
});

test("with a filter active, collapse and expand never change the collapse set", () => {
  // One row collapsed before the filter, and a filter that shows a row below it.
  let state = press(goTo(stateOf(observed(TREE)), "child-a"), ["h"]).state;
  state = press(state, ["/", "g", "r", "a", "n", "d", "enter"]).state;
  assert.deepEqual(listed(state), ["lead", "child-a", "grandchild"]);
  const set = state.collapsed;
  assert.deepEqual([...set], [keyOf("child-a")]);
  for (const name of ["lead", "child-a", "grandchild"]) for (const keys of [["h"], ["l"], ["left", "right"], ["l", "h", "h"], ["h", "l", "l"]]) {
    const after = press(goTo(state, name), keys).state;
    assert.equal(after.collapsed, set, `${keys.join(" ")} on ${name}`);
    assert.deepEqual([...after.collapsed], [keyOf("child-a")]);
    assert.deepEqual(listed(after), ["lead", "child-a", "grandchild"], "and the filter still shows every match");
  }
  // The same while the field is still open: the keys are text there.
  const editing = press(press(goTo(stateOf(observed(TREE)), "child-a"), ["h"]).state, ["/", "h", "l"]).state;
  assert.deepEqual([...editing.collapsed], [keyOf("child-a")]);
  assert.equal(editing.filter.query, "hl");
});

// --- The detail's focus ----------------------------------------------------------------

test("tab moves the focus to the detail and back, and with nothing selected it does nothing", () => {
  const state = stateOf(observed(TREE));
  const there = press(state, ["tab"]).state;
  assert.equal(there.focus, "detail");
  assert.equal(there.selected, state.selected);
  assert.equal(press(there, ["tab"]).state.focus, "list");
  for (const none of [stateOf(), stateOf(observed([])), take(state, failed(state.entry, TIMEOUT))]) {
    const result = reduce(none, { key: "tab", page: 19, extent: 0, room: 19 });
    assert.equal(result.state, none);
    assert.equal(result.effect, null);
  }
});

test("with the focus on the detail the movement keys scroll the detail, within what its rows and its pane allow, and never move the selection", () => {
  const focused = press(goTo(stateOf(observed(MANY)), "inst-20"), ["tab"]).state;
  // A detail of 30 rows in a pane of 10: the pane's last row says what is cut off, so 9 show and
  // the last top is 30 - 9.
  const key = (state, id) => reduce(state, { key: id, ...(id.length === 1 ? { text: id } : {}), page: 19, extent: 30, room: 10 }).state;
  let state = focused;
  for (const [id, expected] of [["k", 0], ["j", 1], ["down", 2], ["up", 1], ["k", 0], ["G", 21], ["j", 21], ["end", 21], ["pagedown", 21], ["g", 0], ["pageup", 0], ["end", 21], ["home", 0]]) {
    state = key(state, id);
    assert.equal(state.detailTop, expected, id);
    assert.deepEqual({ selected: state.selected, top: state.top, focus: state.focus }, { selected: focused.selected, top: focused.top, focus: "detail" }, id);
  }
  // A page key scrolls by the pane (its 10 rows, or the 9 it shows) and stops at both ends.
  const tops = [];
  for (const id of ["pagedown", "pagedown", "pagedown", "pagedown", "pageup", "pageup", "pageup", "pageup"]) {
    const from = state.detailTop;
    state = key(state, id);
    const by = Math.abs(state.detailTop - from);
    assert.equal(state.detailTop === (id === "pagedown" ? 21 : 0) || by === 10 || by === 9, true, `${id} from ${from} went to ${state.detailTop}`);
    assert.equal(state.selected, focused.selected, id);
    tops.push(state.detailTop);
  }
  assert.deepEqual([tops[2], tops[3], tops[6], tops[7]], [21, 21, 0, 0]);
  // A detail that fits its pane does not scroll.
  state = focused;
  for (const id of MOVES) { state = press(state, [id]).state; assert.equal(state.detailTop, 0, id); assert.equal(state.selected, focused.selected, id); }
});

test("a new selection starts its detail at the top; a read that keeps the selection keeps the detail where it was", () => {
  const scroll = (state) => reduce(reduce(state, { key: "tab", page: 19, extent: 30, room: 10 }).state, { key: "G", text: "G", page: 19, extent: 30, room: 10 }).state;
  const scrolled = scroll(goTo(stateOf(observed(MANY)), "inst-20"));
  assert.equal(scrolled.detailTop, 21);
  const kept = take(scrolled, observed(MANY));
  assert.deepEqual([kept.selected, kept.detailTop, kept.focus], [idOf("inst-20"), 21, "detail"], "selection and scroll survive a refresh");
  const gone = take(scrolled, observed(MANY.filter((row) => row.instance !== "inst-20")));
  assert.deepEqual([selectedName(gone), gone.detailTop], ["inst-21", 0], "another instance: its detail from the top");
  const list = press(scrolled, ["tab"]).state;
  assert.equal(list.focus, "list");
  const next = press(list, ["j"]).state;
  assert.deepEqual([selectedName(next), next.detailTop], ["inst-21", 0]);
  // A movement key that cannot move (the last row) is no new selection.
  const last = scroll(goTo(stateOf(observed(MANY)), "inst-39"));
  assert.equal(press(press(last, ["tab"]).state, ["j"]).state.detailTop, 21);
});

// --- Close -----------------------------------------------------------------------------

test("close closes one thing at a time, in this order: the help, then a kept filter, then the detail's focus, then nothing", () => {
  let state = press(stateOf(observed(TREE)), ["/", "s", "o", "l", "o", "enter", "tab", "?"]).state;
  assert.deepEqual({ view: state.view, filter: state.filter, focus: state.focus }, { view: "help", filter: { editing: false, query: "solo" }, focus: "detail" });
  state = press(state, ["escape"]).state;
  assert.deepEqual({ view: state.view, filter: state.filter, focus: state.focus }, { view: "instances", filter: { editing: false, query: "solo" }, focus: "detail" }, "first the help");
  assert.deepEqual(drawn(state), ["solo-x", "solo-y"]);
  state = press(state, ["escape"]).state;
  assert.deepEqual({ view: state.view, filter: state.filter, focus: state.focus }, { view: "instances", filter: { editing: false, query: "" }, focus: "detail" }, "then the kept filter");
  assert.deepEqual(drawn(state), TREE_DRAWN);
  state = press(state, ["escape"]).state;
  assert.deepEqual({ view: state.view, filter: state.filter, focus: state.focus }, { view: "instances", filter: { editing: false, query: "" }, focus: "list" }, "then the detail");
  const result = reduce(state, { key: "escape", page: 19, extent: 9, room: 19 });
  assert.equal(result.state, state, "then nothing");
  assert.equal(result.effect, null);
});

// --- The filter field ------------------------------------------------------------------

test("the filter key opens the field, and while it is open a text key is text whatever the action table says, with no effect", () => {
  const opened = press(stateOf(observed(TREE)), ["/"]);
  assert.deepEqual(opened.state.filter, { editing: true, query: "" });
  assert.deepEqual(opened.effects, []);
  // Each of these is bound: quit, down, help, filter, instances. A space stands between words.
  const { state, effects } = press(opened.state, ["q", "j", "?", "/", "1", "space", "r", "G", "h", "l", "k", "g"]);
  assert.equal(state.filter.query, "qj?/1 rGhlkg");
  assert.deepEqual(effects, [], "q did not quit and r did not refresh");
  assert.deepEqual({ view: state.view, editing: state.filter.editing, focus: state.focus, collapsed: state.collapsed.size }, { view: "instances", editing: true, focus: "list", collapsed: 0 });
});

test("a leading space is not added to the filter", () => {
  const state = press(stateOf(observed(TREE)), ["/", "space", "space", "s", "space", "x"]).state;
  assert.equal(state.filter.query, "s x");
});

test("the space key is taken between words only: never after another space, so the filter never holds a run of them", () => {
  const state = press(stateOf(observed(TREE)), ["/", "s", "space", "space", "space", "x", "space", "space"]).state;
  assert.equal(state.filter.query, "s x ");
});

test("a filter that matches nothing moves no selection: while the field holds it nothing is selected in the list, a read changes that not, and with the filter cleared the selection is on its instance", () => {
  const at = goTo(stateOf(observed(TREE)), "child-a");
  const none = press(at, ["/", "z", "z", "z"]).state;
  assert.deepEqual(drawn(none), []);
  assert.equal(none.selected, idOf("child-a"), "the store still holds the instance");
  assert.equal(selectedName(none), null, "and no row is drawn selected");
  const read = take(none, observed([...TREE, instanceRow("dev", "newcomer")]));
  assert.equal(read.selected, idOf("child-a"), "a read while nothing matches keeps it");
  assert.equal(selectedName(press(read, ["escape"]).state), "child-a", "cleared: the selection is where it was");
  // The instance retired meanwhile: there is nothing to keep, and the cleared filter selects the first row.
  const gone = take(none, observed(TREE.filter((row) => row.instance !== "child-a")));
  assert.equal(gone.selected, null);
  assert.equal(selectedName(press(gone, ["escape"]).state), "alpha");
  // A filter that matches other rows moves the selection to one of them, as before.
  const some = press(none, ["backspace", "backspace", "backspace", "s", "o", "l", "o"]).state;
  assert.deepEqual(drawn(some), ["solo-x", "solo-y"]);
  assert.ok(["solo-x", "solo-y"].includes(selectedName(some)), "a drawn row is selected");
});

test("Backspace removes one grapheme, however many code points it has", () => {
  const open = press(stateOf(observed(TREE)), ["/"]).state;
  assert.equal(press(open, ["a", FAMILY]).state.filter.query, `a${FAMILY}`);
  assert.equal(press(open, ["a", FAMILY, "backspace"]).state.filter.query, "a", "seven code points, one key");
  assert.equal(press(open, ["a", "é", "backspace"]).state.filter.query, "a", "a letter and its combining mark");
  assert.equal(press(open, ["a", "b", "backspace", "backspace"]).state.filter.query, "");
  const empty = press(open, ["backspace"]).state;
  assert.deepEqual(empty.filter, { editing: true, query: "" }, "on an empty field it removes nothing and the field stays open");
});

test("Enter keeps the filter and leaves the field; the close key clears it and leaves the field", () => {
  const typing = press(stateOf(observed(TREE)), ["/", "s", "o", "l", "o"]).state;
  assert.deepEqual(drawn(typing), ["solo-x", "solo-y"], "the list follows the field as it is typed");
  const kept = press(typing, ["enter"]);
  assert.deepEqual(kept.state.filter, { editing: false, query: "solo" });
  assert.deepEqual(drawn(kept.state), ["solo-x", "solo-y"]);
  assert.deepEqual(kept.effects, []);
  const cleared = press(typing, ["escape"]);
  assert.deepEqual(cleared.state.filter, { editing: false, query: "" });
  assert.deepEqual(drawn(cleared.state), TREE_DRAWN);
  assert.deepEqual(cleared.effects, []);
  // The kept filter is edited again from where it was.
  assert.deepEqual(press(kept.state, ["/", "-", "x"]).state.filter, { editing: true, query: "solo-x" });
});

test("while the filter field is open, ctrl+c, ctrl+z and ctrl+l keep their effects and every other named key does nothing", () => {
  const open = press(stateOf(observed(TREE)), ["/", "s", "o"]).state;
  for (const [key, effect] of [["ctrl+c", "quit"], ["ctrl+z", "suspend"], ["ctrl+l", "redraw"]]) {
    const result = reduce(open, { key, page: 19, extent: 9, room: 19 });
    assert.equal(result.effect, effect, key);
    assert.equal(result.state, open, `${key} leaves the field as it is`);
  }
  for (const key of ["tab", "up", "down", "left", "right", "home", "end", "pageup", "pagedown", "f5", "insert", "delete", "shift+tab", "ctrl+x"]) {
    const result = reduce(open, { key, page: 19, extent: 9, room: 19 });
    assert.equal(result.state, open, key);
    assert.equal(result.effect, null, key);
  }
});

test("the filter never grows past its limit: a key that would pass it adds nothing", () => {
  assert.equal(QUERY_LIMIT, 200);
  const open = press(stateOf(observed(solos("a", "b"))), ["/"]).state;
  const full = typed(open, "a".repeat(QUERY_LIMIT));
  assert.equal(full.filter.query.length, QUERY_LIMIT);
  assert.equal(typed(full, "b").filter.query, "a".repeat(QUERY_LIMIT));
  assert.equal(typed(full, FAMILY).filter.query, "a".repeat(QUERY_LIMIT), "nor does a grapheme of several code points");
  assert.equal(typed(full, " ").filter.query, "a".repeat(QUERY_LIMIT), "nor a space");
  const near = typed(open, "a".repeat(QUERY_LIMIT - 5));
  assert.equal(typed(typed(near, "bbbbb"), "c").filter.query, `${"a".repeat(QUERY_LIMIT - 5)}bbbbb`, "up to the limit every key is added");
  // Backspace still works on a full field.
  assert.equal(press(full, ["backspace"]).state.filter.query.length, QUERY_LIMIT - 1);
});

// --- Paste -----------------------------------------------------------------------------

test("a paste anywhere but the open filter field is dropped whole: the list, the detail, the help, and a filter that is kept", () => {
  const list = stateOf(observed(TREE));
  const states = [list, press(list, ["tab"]).state, press(list, ["?"]).state, press(list, ["/", "s", "enter"]).state, stateOf()];
  for (const state of states) for (const paste of ["solo", "q", "solo\nq", "\x1b[201~"]) {
    const result = reduce(state, { paste });
    assert.equal(result.state, state);
    assert.equal(result.effect, null);
  }
});

test("a paste into the open filter field adds the text up to its first line end, whatever the line end", () => {
  const open = press(stateOf(observed(TREE)), ["/", "s"]).state;
  for (const end of ["\n", "\r\n", "\r", " "]) {
    const result = reduce(open, { paste: `olo${end}q\nrm -rf` });
    assert.equal(result.state.filter.query, "solo", JSON.stringify(end));
    assert.equal(result.state.filter.editing, true);
    assert.equal(result.effect, null);
  }
  assert.equal(reduce(open, { paste: "olo-x" }).state.filter.query, "solo-x", "one line is added whole");
  assert.equal(reduce(open, { paste: "\nolo" }).state, open, "an empty first line adds nothing");
  assert.equal(reduce(open, { paste: "" }).state, open);
});

test("a pasted first line the display filter would change adds nothing at all", () => {
  const open = press(stateOf(observed(TREE)), ["/", "s"]).state;
  const hostile = {
    "a control character": "o\x07lo", "an escape sequence": "o\x1b[31mlo", "a tab": "o\tlo", "a bidi override": "o‮lo",
    "two spaces together": "o  lo", "a secret shape": "token=abcdef", "a leading space": " olo", "a trailing space": "olo ",
  };
  for (const [what, paste] of Object.entries(hostile)) {
    for (const text of [paste, `${paste}\nmore`]) {
      const result = reduce(open, { paste: text });
      assert.equal(result.state, open, what);
      assert.equal(result.effect, null);
    }
  }
});

test("a paste of nothing but spaces is changed by the display filter too, and adds nothing", () => {
  const open = press(stateOf(observed(TREE)), ["/", "s"]).state;
  for (const paste of ["  ", "   ", "  \nmore"]) assert.equal(reduce(open, { paste }).state.filter.query, "s", JSON.stringify(paste));
});

test("a paste that would pass the filter's limit adds nothing, not the part that fits", () => {
  const open = press(stateOf(observed(solos("a", "b"))), ["/"]).state;
  const near = typed(open, "a".repeat(QUERY_LIMIT - 5));
  assert.equal(reduce(near, { paste: "bbbbbb" }).state, near, "six more with room for five");
  assert.equal(reduce(near, { paste: "bbbbb" }).state.filter.query.length, QUERY_LIMIT, "five fit");
  assert.equal(reduce(near, { paste: "b".repeat(5000) }).state, near);
});

// --- Effects ---------------------------------------------------------------------------

test("the keys that only the loop can serve answer an effect and leave the state as it is", () => {
  const state = stateOf(observed(TREE));
  for (const [key, effect] of [["r", { refresh: { live: true } }], ["q", "quit"], ["ctrl+c", "quit"], ["ctrl+z", "suspend"], ["ctrl+l", "redraw"]]) {
    const result = reduce(state, { key, ...(key.length === 1 ? { text: key } : {}), page: 19, extent: 9, room: 19 });
    assert.deepEqual(result.effect, effect, key);
    assert.equal(result.state, state, key);
  }
  // In the help, in the detail and before the first answer they do the same.
  for (const other of [press(state, ["?"]).state, press(state, ["tab"]).state, stateOf()]) assert.deepEqual(press(other, ["r", "ctrl+l", "ctrl+z", "q"]).effects, [{ refresh: { live: true } }, "redraw", "suspend", "quit"]);
});

test("the help key opens and closes the help, the instances key returns to the instances view, and in the help the movement keys scroll the help only", () => {
  const state = goTo(stateOf(observed(MANY)), "inst-25");
  const help = press(state, ["?"]);
  assert.equal(help.state.view, "help");
  assert.deepEqual(help.effects, []);
  assert.equal(press(help.state, ["?"]).state.view, "instances");
  assert.equal(press(help.state, ["1"]).state.view, "instances");
  assert.equal(press(state, ["1"]).state.view, "instances", "already there: still there");
  // A help of 40 rows in a body of 19: 18 show, so the last top is 40 - 18.
  const key = (from, id) => reduce(from, { key: id, ...(id.length === 1 ? { text: id } : {}), page: 19, extent: 40, room: 19 }).state;
  let at = help.state;
  for (const [id, expected] of [["k", 0], ["j", 1], ["down", 2], ["up", 1], ["G", 22], ["j", 22], ["pagedown", 22], ["g", 0], ["pageup", 0], ["end", 22], ["home", 0]]) {
    at = key(at, id);
    assert.equal(at.helpTop, expected, id);
    assert.deepEqual({ view: at.view, selected: at.selected, top: at.top, detailTop: at.detailTop, focus: at.focus }, { view: "help", selected: state.selected, top: state.top, detailTop: state.detailTop, focus: state.focus }, id);
  }
  const paged = key(at, "pagedown").helpTop;
  assert.equal(paged === 19 || paged === 18, true, `a page of the help is its pane: ${paged}`);
  assert.equal(key(key(at, "pagedown"), "pageup").helpTop, 0);
  // Opened again, the help starts at its top.
  assert.equal(press(press(key(help.state, "G"), ["?"]).state, ["?"]).state.helpTop, 0);
});

// --- A changed table -------------------------------------------------------------------

test("the reducer acts on the table it is given: with quit on x and down on n, x quits, q does nothing, n moves down and j does not", () => {
  const config = effectiveConfig({ keys: { quit: ["x"], down: ["n"] } });
  assert.equal(config.ok, true);
  const state = stateOf(observed(TREE), { actions: config.actions });
  assert.equal(state.actions, config.actions);
  assert.deepEqual(press(state, ["x"]).effects, ["quit"]);
  for (const key of ["q", "ctrl+c", "j", "down"]) {
    const result = press(state, [key]);
    assert.equal(result.state, state, `${key} is bound to nothing now`);
    assert.deepEqual(result.effects, []);
  }
  assert.equal(selectedName(press(state, ["n"]).state), "alpha-kid");
  assert.equal(selectedName(press(state, ["n", "n", "k"]).state), "alpha-kid", "the keys the file left alone keep their actions");
  // In the filter field the freed letters are text like any other, and so are the new ones.
  assert.equal(press(state, ["/", "x", "n", "q", "j"]).state.filter.query, "xnqj");
  // The default table is untouched by it.
  assert.deepEqual(press(stateOf(observed(TREE)), ["q"]).effects, ["quit"]);
});

// --- An observation while the filter is open -------------------------------------------

test("an observation that arrives while the filter field is open keeps the text and the field, and the new rows are filtered by it", () => {
  const typing = press(stateOf(observed(TREE)), ["/", "s", "o", "l", "o"]).state;
  const entry = observed([...TREE, instanceRow("dev", "solo-a"), instanceRow("dev", "other")]);
  const after = take(typing, entry);
  assert.deepEqual(after.filter, { editing: true, query: "solo" });
  assert.equal(after.entry, entry);
  assert.deepEqual(drawn(after), ["solo-a", "solo-x", "solo-y"]);
  assert.equal(press(after, ["-", "y"]).state.filter.query, "solo-y", "and typing goes on");
  for (const lost of [failed(entry, TIMEOUT), failed(entry, UNREADABLE)]) assert.deepEqual(take(after, lost).filter, { editing: true, query: "solo" });
  // A kept filter is kept across a read as well.
  assert.deepEqual(take(press(typing, ["enter"]).state, entry).filter, { editing: false, query: "solo" });
});

// --- reduce never mutates --------------------------------------------------------------

test("reduce changes nothing it was given: the earlier state, its collapse set and its filter are as they were, and every state it answers is frozen", () => {
  const entry = deepFreeze(observed(TREE));
  const first = stateOf(entry);
  const before = goTo(first, "child-a");
  const collapsed = before.collapsed, filter = before.filter;
  const folded = press(before, ["h"]).state;
  assert.notEqual(folded.collapsed, collapsed);
  assert.equal(before.collapsed, collapsed);
  assert.equal(collapsed.size, 0, "the earlier state's set did not gain the key");
  const unfolded = press(folded, ["l"]).state;
  assert.deepEqual([...folded.collapsed], [keyOf("child-a")], "nor did the collapsed state's set lose it");
  assert.equal(unfolded.collapsed.size, 0);
  const typing = press(before, ["/", "s", "o"]).state;
  assert.notEqual(typing.filter, filter);
  assert.deepEqual(before.filter, { editing: false, query: "" });
  assert.equal(before.filter, filter);
  assert.equal(Object.isFrozen(typing.filter), true);
  // A long run over a deeply frozen entry: a write into it would throw.
  let state = first;
  const keys = ["j", "j", "h", "h", "l", "l", "G", "g", "pagedown", "pageup", "tab", "j", "tab", "/", "s", "o", "backspace", "enter", "escape", "?", "j", "?", "1", "r", "ctrl+l"];
  for (const key of keys) {
    const { state: next } = press(state, [key]);
    assert.equal(Object.isFrozen(next), true, key);
    assert.equal(Object.isFrozen(next.filter), true, key);
    assert.equal(next.entry, entry, key);
    state = next;
  }
  state = take(state, deepFreeze(failed(entry, UNREADABLE)));
  state = take(state, deepFreeze(failed(entry, TIMEOUT)));
  state = take(state, deepFreeze(observed(TREE.slice(2))));
  assert.equal(Object.isFrozen(state), true);
  assert.deepEqual(first.filter, { editing: false, query: "" });
  assert.equal(first.selected, idOf("alpha"));
  assert.equal(first.collapsed.size, 0);
});
