process.env.TZ = "UTC"; // a clock time on the screen is local: every time here is computed in one zone
// The store: the state of `oats tui` and reduce(state, event). Every entry here is made by the
// shared functions (helpers.mjs), every key is pressed with the geometry of the frame drawn before
// it (press), and no test needs a terminal, a timer or a process.
import test from "node:test";
import assert from "node:assert/strict";
import { ACTIONS } from "../lib/actions.mjs";
import {
  TERMS, collapseKey, instanceId, rosterRows, panelInstances, observedEntry, pendingEntry, remoteRosterState, observeIdentities, identityMemory,
  viewModel, workspaceChoices, workspaceChoiceRows,
} from "../lib/client.mjs";
import { effectiveConfig } from "../lib/config.mjs";
import { MORE_FOLDERS, OFFERED_SECTION, ROSTER_FAILED, model, roster, switcher } from "../lib/model.mjs";
import { QUERY_LIMIT, initialState, reduce } from "../lib/store.mjs";
import { marksOf } from "../lib/views/instances.mjs";
import { windowOf } from "../lib/views/scroll.mjs";
import { SWITCHER_TEXT } from "../lib/views/switcher.mjs";
import { CLI, DEPLOYMENT, NOW, draw, failed, instanceRow, observed, pending, press, rosterOf, stateOf } from "./helpers.mjs";

const SIZE = { cols: 80, rows: 24 }, SHORT = { cols: 80, rows: 15 };
const STOPPED = { running: false, runtimeState: "stopped" };
const FAMILY = "\u{1f469}\u200D\u{1f469}\u200D\u{1f467}\u200D\u{1f466}"; // one grapheme of seven code points
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

/** The drawn order as names, null for the empty row. Only the instances and the empty rows
 *  between them: what else the list may hold (a heading, a sentence, the line that says why no
 *  instance is listed) is read by the tests that are about it. */
const drawn = (state) => roster(state).items.filter((item) => item === null || item.id !== undefined).map((item) => item && item.row.instance);
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
/** The entry the store holds for the fixture's deployment, and the number of the cycle that gave it. */
const entryOf = (state, id = DEPLOYMENT) => state.entries.get(id);
const numberOf = (state, id = DEPLOYMENT) => state.numbers.get(id) ?? 0;
/** A newer answer of the reader for the fixture's deployment. */
const take = (state, entry, number = numberOf(state) + 1) => reduce(state, { id: DEPLOYMENT, entry, number }).state;
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
    { view: state.view, number: numberOf(state), selected: state.selected, focus: state.focus, top: state.top, loose: state.loose, detailTop: state.detailTop, filter: state.filter, ascii: state.ascii },
    { view: "instances", number: 0, selected: null, focus: "list", top: 0, loose: false, detailTop: 0, filter: { editing: false, query: "" }, ascii: false },
  );
  assert.equal(state.numbers.size, 0, "no answer was taken for any deployment");
  assert.equal(state.collapsed instanceof Set, true);
  assert.equal(state.collapsed.size, 0);
  assert.equal(entryOf(state), entry, "the entry is the one it was given, as it is");
  assert.deepEqual([...state.entries.keys()], [DEPLOYMENT]);
  assert.deepEqual(state.ctxs, [DEPLOYMENT], "the deployment it was started in is the one it serves");
  assert.equal(state.open, DEPLOYMENT, "and the one its view is opened on");
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
  // A letter no action holds does nothing, nor does a key no table names. (Enter opens here: its tests are with the open's.)
  // z (zoom) and c (close terminal) do nothing with no terminal open: model.test.mjs has them with one.
  for (const key of ["y", "Z", "f5", "insert", "ctrl+x", "shift+tab", "4", "9", "z", "c"]) {
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
  const took = reduce(state, { id: DEPLOYMENT, entry, number: 7 });
  assert.equal(took.effect, null);
  assert.equal(entryOf(took.state), entry, "the store adds nothing to an entry and removes nothing: it is the same object");
  assert.equal(numberOf(took.state), 7);
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
  assert.equal(numberOf(state), 5);
  for (const number of [5, 4, 1, 0]) for (const entry of [observed(solos("z")), failed(first, TIMEOUT), failed(first, UNREADABLE), pending()]) {
    const result = reduce(state, { id: DEPLOYMENT, entry, number });
    assert.equal(result.state, state, `number ${number}, ${entry.deployment.status}`);
    assert.equal(result.effect, null);
  }
});

test("a newer answer is taken whatever came before it: a success after a failure, and a failure after a success", () => {
  const first = observed(solos("a", "b")), lost = failed(first, TIMEOUT), second = observed(solos("a", "b", "c"));
  let state = take(stateOf(), first, 1);
  state = take(state, lost, 2);
  assert.equal(entryOf(state), lost);
  assert.equal(entryOf(state).deployment.status, "unavailable");
  assert.equal(numberOf(state), 2);
  state = take(state, second, 3);
  assert.equal(entryOf(state), second);
  assert.deepEqual(drawn(state), ["a", "b", "c"]);
  // The answer of cycle 2, arriving late, does not undo cycle 3: neither as a failure nor as a success.
  assert.equal(reduce(state, { id: DEPLOYMENT, entry: lost, number: 2 }).state, state);
  assert.equal(reduce(state, { id: DEPLOYMENT, entry: first, number: 1 }).state, state);
  state = take(state, failed(second, TIMEOUT), 9);
  assert.equal(entryOf(state).deployment.status, "unavailable");
  assert.equal(numberOf(state), 9);
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
  // It stopped: it keeps its place, since the roster is in name order (#1262), and it is still the selection.
  state = take(state, observed([...solos("a", "b", "d"), instanceRow("dev", "c", STOPPED)]));
  assert.deepEqual(drawn(state), ["a", "b", "c", "d"]);
  assert.equal(state.selected, idOf("c"));
  // It joined a cluster: the same.
  state = take(state, observed([...solos("a", "b", "d"), instanceRow("dev", "c", { parentInstance: "d" })]));
  assert.deepEqual(drawn(state), ["a", "b", null, "d", "c"]);
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
    assert.equal(entryOf(after), lost);
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
  assert.equal(entryOf(after), stale);
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
  assert.equal(take(state, failed(entryOf(state), TIMEOUT)).collapsed, held);
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
  assert.equal(page, 20, "the list pane of 80x24: the body's rows, the header, its rule and the footer taken");
  // A pane of 20 rows shows 19 instances when rows are cut off, its last row saying so: a page is
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
  for (const none of [stateOf(), stateOf(observed([])), take(state, failed(entryOf(state), TIMEOUT))]) {
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
  assert.equal(press(open, ["a", "e\u0301", "backspace"]).state.filter.query, "a", "a letter and its combining mark");
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
  for (const end of ["\n", "\r\n", "\r", "\u2028"]) {
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
    "a control character": "o\x07lo", "an escape sequence": "o\x1b[31mlo", "a tab": "o\tlo", "a bidi override": "o\u202Elo",
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
  assert.equal(entryOf(after), entry);
  assert.deepEqual(drawn(after), ["solo-a", "solo-x", "solo-y"]);
  assert.equal(press(after, ["-", "y"]).state.filter.query, "solo-y", "and typing goes on");
  for (const lost of [failed(entry, TIMEOUT), failed(entry, UNREADABLE)]) assert.deepEqual(take(after, lost).filter, { editing: true, query: "solo" });
  // A kept filter is kept across a read as well.
  assert.deepEqual(take(press(typing, ["enter"]).state, entry).filter, { editing: false, query: "solo" });
});

test("a pane that scrolls on its own moves from where it is drawn: at its end, after the terminal grew, one Up moves it one row", () => {
  const small = { cols: 60, rows: 15 }, tall = { cols: 60, rows: 24 };
  const above = (state, size) => Number(/(\d+) more above/.exec(draw(state, size).lines.join("\n"))?.[1] ?? 0);
  // The help, scrolled to its end on a small terminal: the state's top is past the end of a taller one.
  const help = press(stateOf(observed(TREE)), ["?", "G"], small).state;
  const drawnTop = above(help, tall);
  assert.equal(drawnTop > 0 && drawnTop < help.helpTop, true, `the taller pane draws from ${drawnTop}, the state holds ${help.helpTop}`);
  assert.equal(above(press(help, ["k"], tall).state, tall), drawnTop - 1, "Up moves one row from what is drawn");
  assert.equal(above(press(help, ["j"], tall).state, tall), drawnTop, "Down stays at the end");
  // The detail, the same helper: a long reason makes it scroll.
  const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
  const row = instanceRow("dev", "long", { running: null, runtimeState: "unreachable", runtimeError: long });
  const detail = press(stateOf(observed([row])), ["tab", "G"], { cols: 80, rows: 15 }).state;
  const size = { cols: 80, rows: 20 }, top = above(detail, size);
  if (top > 0) assert.equal(above(press(detail, ["k"], size).state, size), top - 1);
  assert.equal(top <= detail.detailTop, true);
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
    assert.equal(entryOf(next), entry, key);
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

// --- Other machines and the switcher: fixtures in the kernel's forms --------------------

const AT = new Date(NOW).toISOString();
/** A workspace identity as a deployment reports it (the kernel's `workspace` object), and the
 *  same for another workspace. */
const IDENTITY = Object.freeze({ key: "github.com/acme/platform", ref: "main", keyFrom: "workspace", standalone: false, defaultTeam: Object.freeze({ label: "eng", team: "team-1" }), teams: Object.freeze({ eng: "team-1" }), teamsFrom: "observed" });
const LEDGER = Object.freeze({ ...IDENTITY, key: "github.com/acme/ledger" });
/** A kernel record that reads other machines (the shared `cliReadsRemotes`). */
const READS = Object.freeze({ ...CLI, remote: Object.freeze(["roster"]) });
/** A second deployment of this machine, and a folder of `~/Agents` that is offered. */
const SECOND = "/srv/deploy-b", FOLDER = "/home/u/Agents/sandbox";
/** A row of helpers.mjs `instanceRow`, homed in another deployment of this machine. */
const homedIn = (dir, row) => ({ ...row, home: `${dir}/agents/${row.agent}/instances/${row.instance}`, repo: `${dir}/oats` });
/** An observed entry of the deployment at `dir` that reports `identity`, through the real
 *  `rosterRows`, `panelInstances` and `observedEntry`: helpers.mjs `observed`, with the identity
 *  the kernel puts in the roster's `workspace` and the deployment's own agents root. */
function reporting(rows, { identity = IDENTITY, dir = DEPLOYMENT } = {}) {
  const document = { ...rosterOf(rows), root: `${dir}/agents`, workspace: { reachable: true, ...identity } };
  const listed = rosterRows(document, READS);
  const answers = listed.map((row) => ({ running: row.running, runtimeState: row.runtimeState, tmux: row.tmux }));
  return observedEntry({ roster: document, workspaceStatus: { workspace: { name: "acme-platform" } }, observedAt: "2026-10-11T09:59:00.000Z" }, panelInstances(listed, answers), "2026-10-11T10:00:00.000Z");
}
/** A row of a roster group as the kernel reports it: `addressable` is always said, true or false. */
const remoteRow = (root, name, extra = {}) => ({ instance: name, agent: "dev", home: `${root}/agents/dev/instances/${name}`, agentsRoot: `${root}/agents`, work: "worktree", harness: "claude", running: true, runtimeState: "running", addressable: true, ...extra });
/** A roster group in the kernel's form: its id is `<server>:<targetKey>`, the server's name in
 *  lower case and no path in it (a group in another form is never remembered). Reached, reporting
 *  IDENTITY, with a running row that can be addressed and a stopped one that cannot. */
function machine(server, extra = {}) {
  const root = `/home/dev/Agents/${server}`;
  return {
    id: `${server}:acme-1`, server, label: server, registrationPresent: true, target: { workspace: root, sshHost: `${server}.example` }, probe: { ok: true },
    workspace: IDENTITY, agentsRoot: `${root}/agents`, souls: [],
    instances: [remoteRow(root, `${server}-a`), remoteRow(root, `${server}-b`, { addressable: false, ...STOPPED })], ...extra,
  };
}
const GARNET = "remote:garnet:acme-1", QUARTZ = "remote:quartz:acme-1";
/** The roster read's outcome for an answer that lists these groups. */
const answer = (...groups) => ({ envelope: { ok: true, result: { groups } } });
/** The time of the n-th roster outcome of a test. */
const tick = (n) => new Date(Date.parse("2026-10-11T10:01:01.000Z") + n * 15000).toISOString();
/** What the reader hands the store for one outcome of the roster read, as lib/read.mjs makes it:
 *  the shared rule, then the memory of identities for what the answer reported. */
function rosterEvent(state, outcome, at) {
  const made = remoteRosterState(state.remote, outcome, at);
  const identities = made.reported === null ? { memory: state.memory, notes: state.notes } : observeIdentities({ memory: state.memory, notes: state.notes }, made.reported, at);
  return { roster: { remote: { remoteGroups: made.remoteGroups, rosterAnswered: made.rosterAnswered, rosterFailure: made.rosterFailure }, memory: identities.memory, notes: identities.notes, at } };
}
/** One outcome of the roster read into a state: `{ state, effect }`, and the state alone. */
const hearing = (state, outcome, at) => reduce(state, rosterEvent(state, outcome, at));
const heard = (state, outcome, at) => hearing(state, outcome, at).state;
/** `held`, as the spec's "The store" gives it: what the shared home reads of this client. */
const heldOf = (state) => ({
  ctxs: state.ctxs, snapshot: { byWs: state.entries }, remoteGroups: state.remote.remoteGroups,
  remembered: identityMemory({ memory: state.memory, notes: state.notes }), rosterAnswered: state.remote.rosterAnswered, rosterFailure: state.remote.rosterFailure, cli: state.cli,
  observing: new Set(), remoteCollecting: state.collecting, home: state.home, at: state.rosterAt ?? AT,
});
/** The switcher's rows as the shared home gives them, and the views they stand for. */
const choiceRows = (state) => workspaceChoiceRows(workspaceChoices(heldOf(state), TERMS));
const viewsOf = (state) => viewModel(heldOf(state), TERMS).views;
/** The labels of the choices the switcher lists for a state, and the one its selection stands on. */
const choices = (state) => switcher(state, AT).items.filter((item) => item.key !== undefined).map((item) => item.label);
const chosen = (state) => { const s = switcher(state, AT); return s.items.find((item) => item.key !== undefined && item.key === s.selected)?.label ?? null; };
/** A key without a frame drawn for it, in a list pane of 19 rows. */
const hit = (state, key, geometry = {}) => reduce(state, { key, ...([...new Intl.Segmenter().segment(key)].length === 1 ? { text: key } : {}), page: 19, extent: 0, room: 19, ...geometry });

/** This machine's rows in the tests of a machine: a cluster of two and a stopped single instance. */
const NEAR = [instanceRow("dev", "lead"), instanceRow("dev", "kid", { parentInstance: "lead" }), instanceRow("dev", "solo", STOPPED)];
/** A run with two views: this workspace here and on garnet, and another workspace on quartz. */
const twoViews = (rows = NEAR) => heard(stateOf(reporting(rows), { cli: READS }), answer(machine("garnet"), machine("quartz", { workspace: LEDGER })), tick(0));

// --- A run started outside a deployment -------------------------------------------------

test("a run started outside every deployment serves none and opens nothing: its first state shows the switcher, and holds no entry", () => {
  const state = initialState({ deployment: null, cli: CLI, home: "/home/u" });
  assert.deepEqual({ view: state.view, back: state.back, ctxs: state.ctxs, open: state.open, selected: state.selected }, { view: "switcher", back: "switcher", ctxs: [], open: null, selected: null });
  assert.deepEqual([state.entries.size, state.numbers.size], [0, 0]);
  assert.deepEqual(state.switcher, { editing: false, query: "", selected: null, top: 0, loose: false, line: null, refused: null });
  assert.deepEqual(state.offered, { offered: [], limited: false });
  assert.equal(Object.isFrozen(state) && Object.isFrozen(state.switcher) && Object.isFrozen(state.offered) && Object.isFrozen(state.ctxs), true);
  assert.deepEqual(roster(state).rows, []);
});

// --- Answers by deployment --------------------------------------------------------------

test("an entry for a deployment that is not served is dropped, and answers are numbered per deployment: one not newer than the last for its own deployment is dropped while the same number for another served deployment is taken", () => {
  const state = take(stateOf(observed(solos("a", "b"))), observed(solos("a", "b", "c")), 5);
  for (const id of ["/srv/elsewhere", SECOND, GARNET, undefined]) {
    const stray = reduce(state, { id, entry: observed(solos("z")), number: 9 });
    assert.equal(stray.state, state, String(id));
    assert.equal(stray.effect, null);
  }
  // A second deployment is served: its answers are counted on their own.
  const two = reduce(state, { admitted: SECOND, at: AT }).state;
  assert.deepEqual(two.ctxs, [DEPLOYMENT, SECOND]);
  assert.deepEqual([numberOf(two), numberOf(two, SECOND)], [5, 0]);
  const entry = reporting(solos("x").map((row) => homedIn(SECOND, row)), { dir: SECOND });
  const taken = reduce(two, { id: SECOND, entry, number: 5 });
  assert.equal(entryOf(taken.state, SECOND), entry, "the number the other deployment is at is new for this one");
  assert.deepEqual([numberOf(taken.state), numberOf(taken.state, SECOND)], [5, 5]);
  assert.equal(entryOf(taken.state), entryOf(state), "the other deployment's entry is as it was");
  for (const id of [DEPLOYMENT, SECOND]) for (const number of [5, 4, 1, 0]) {
    const late = reduce(taken.state, { id, entry: observed(solos("z")), number });
    assert.equal(late.state, taken.state, `${id}, number ${number}`);
    assert.equal(late.effect, null);
  }
  // A number lower than the other deployment's is still newer for its own, and a newer one moves only its own.
  assert.equal(entryOf(reduce(two, { id: SECOND, entry, number: 1 }).state, SECOND), entry);
  const next = reduce(taken.state, { id: DEPLOYMENT, entry: observed(solos("a")), number: 6 }).state;
  assert.deepEqual([numberOf(next), numberOf(next, SECOND)], [6, 5]);
  assert.equal(entryOf(next, SECOND), entry);
});

// --- The roster of other machines -------------------------------------------------------

test("a roster event sets the roster as the shared rule made it, the memory, the notes and the time of the outcome, and ends the collecting; a collecting event says a read is in flight", () => {
  const first = stateOf(reporting(NEAR), { cli: READS });
  assert.deepEqual(first.remote, { remoteGroups: [], rosterAnswered: false, rosterFailure: null });
  assert.deepEqual([first.rosterAt, first.memory.size, first.notes.size, first.collecting], [null, 0, 0, false]);
  const started = reduce(first, { collecting: true });
  assert.deepEqual([started.state.collecting, started.effect], [true, null]);
  assert.equal(reduce(started.state, { collecting: true }).state, started.state, "said twice, it changes nothing");
  assert.equal(reduce(first, { collecting: false }).state, first);
  const event = rosterEvent(started.state, answer(machine("garnet")), tick(0));
  const taken = reduce(started.state, event);
  assert.equal(taken.effect, null);
  assert.equal(taken.state.remote, event.roster.remote, "the store adds nothing to it and removes nothing");
  assert.equal(taken.state.memory, event.roster.memory);
  assert.equal(taken.state.notes, event.roster.notes);
  assert.deepEqual([taken.state.rosterAt, taken.state.collecting], [tick(0), false]);
  assert.deepEqual([taken.state.remote.rosterAnswered, taken.state.remote.remoteGroups.length, [...taken.state.memory.keys()]], [true, 1, ["garnet:acme-1"]]);
  assert.equal(Object.isFrozen(taken.state), true);
  // An outcome that is no answer is taken the same way: its time is the time of the last outcome.
  const lost = reduce(reduce(taken.state, { collecting: true }).state, rosterEvent(taken.state, { thrown: "the pipe closed" }, tick(1)));
  assert.deepEqual([lost.state.rosterAt, lost.state.collecting, lost.state.remote.remoteGroups[0].probe.ok], [tick(1), false, false]);
  assert.equal(lost.state.memory, taken.state.memory, "nothing was reported: the memory is the one held");
  // A machine that moves leaves its note in the store.
  const moved = heard(taken.state, answer(machine("garnet", { workspace: LEDGER })), tick(2));
  assert.deepEqual([...moved.notes.keys()], ["garnet:acme-1"]);
  // The end of a read that gave nothing (the loop voided it) is said by a collecting event.
  assert.equal(reduce(started.state, { collecting: false }).state.collecting, false);
});

// --- The switcher -----------------------------------------------------------------------

test("the workspaces key shows the switcher and asks for the folders; the close key returns to the view it came from, as it was; and with nothing open the close key does nothing", () => {
  const state = press(goTo(stateOf(observed(MANY)), "inst-30"), ["tab"]).state;
  const shown = hit(state, "w");
  assert.deepEqual(shown.effect, { offer: true });
  assert.deepEqual({ view: shown.state.view, back: shown.state.back }, { view: "switcher", back: "switcher" });
  assert.deepEqual({ open: shown.state.open, selected: shown.state.selected, top: shown.state.top, focus: shown.state.focus }, { open: state.open, selected: state.selected, top: state.top, focus: "detail" }, "nothing of the view under it is touched");
  const again = hit(shown.state, "w");
  assert.equal(again.state, shown.state, "in the switcher the key does nothing");
  assert.equal(again.effect, null);
  for (const key of ["escape", "1"]) {
    const back = press(shown.state, [key]);
    assert.deepEqual(back.effects, [], key);
    assert.deepEqual({ view: back.state.view, back: back.state.back, open: back.state.open, selected: back.state.selected, top: back.state.top, focus: back.state.focus }, { view: "instances", back: "instances", open: state.open, selected: state.selected, top: state.top, focus: "detail" }, key);
  }
  // Nothing is open: there is no view to go back to.
  const nothing = initialState({ deployment: null, cli: CLI, home: "/home/u" });
  for (const key of ["escape", "1", "w", "enter", "j", "G"]) {
    const result = hit(nothing, key);
    assert.equal(result.state, nothing, key);
    assert.equal(result.effect, null, key);
  }
  assert.deepEqual(press(nothing, ["r", "q"]).effects, [{ refresh: { live: true }, offer: true }, "quit"]);
});

test("in the switcher the refresh key asks for a live read and for the folders again, and what the loop then lists is held as it was given", () => {
  const shown = press(stateOf(observed(TREE)), ["w"]).state;
  const asked = hit(shown, "r");
  assert.deepEqual(asked.effect, { refresh: { live: true }, offer: true });
  assert.equal(asked.state, shown);
  assert.deepEqual(hit(stateOf(observed(TREE)), "r").effect, { refresh: { live: true } }, "in the Instances view it asks for the read alone");
  const listed = [{ path: FOLDER, name: "sandbox" }];
  const told = reduce(shown, { offered: { offered: listed, limited: true } });
  assert.equal(told.effect, null);
  assert.deepEqual(told.state.offered, { offered: listed, limited: true });
  assert.equal(Object.isFrozen(told.state.offered) && Object.isFrozen(told.state.offered.offered), true);
  assert.deepEqual(choices(told.state), [choiceRows(told.state)[0].label, "sandbox"]);
  assert.deepEqual(reduce(told.state, { offered: { offered: [], limited: false } }).state.offered, { offered: [], limited: false });
});

test("in the switcher the movement keys move among the choices and pass over the headings, stopping at both ends", () => {
  const basalt = machine("basalt", { probe: { ok: false, error: { code: "E_SSH", message: "no route to the host" } }, workspace: null, instances: [] });
  const read = heard(stateOf(reporting(NEAR), { cli: READS }), answer(basalt, machine("quartz", { workspace: LEDGER })), tick(0));
  let state = press(reduce(read, { offered: { offered: [{ path: FOLDER, name: "sandbox" }], limited: false } }).state, ["w"]).state;
  const s = switcher(state, AT);
  assert.deepEqual(s.items.map((item) => (item.key === undefined ? null : item.label)), ["acme-platform", "ledger", null, "basalt", null, "sandbox"], "two headings stand among the choices");
  assert.equal(chosen(state), "acme-platform", "the first choice is selected before any key");
  for (const [key, expected] of [["k", "acme-platform"], ["j", "ledger"], ["down", "basalt"], ["j", "sandbox"], ["j", "sandbox"], ["up", "basalt"], ["k", "ledger"], ["G", "sandbox"], ["g", "acme-platform"], ["end", "sandbox"], ["home", "acme-platform"], ["pagedown", "sandbox"], ["pageup", "acme-platform"]]) {
    const step = press(state, [key]);
    assert.deepEqual(step.effects, [], key);
    state = step.state;
    assert.equal(chosen(state), expected, key);
    assert.deepEqual({ view: state.view, open: state.open, selected: state.selected }, { view: "switcher", open: read.open, selected: read.selected }, `${key} moves no selection of the Instances view`);
  }
});

test("Enter on a view's row opens that view's primary deployment, as the shared home names it, shows the Instances view and asks for a live read", () => {
  const state = twoViews(), views = viewsOf(state), rows = choiceRows(state);
  assert.deepEqual(rows.map((row) => row.label), ["acme-platform", "ledger"]);
  const primary = (row) => views.find((v) => v.id === row.id).primary;
  assert.deepEqual(rows.map(primary), [DEPLOYMENT, QUARTZ]);
  const picked = press(state, ["w", "j", "enter"]);
  assert.deepEqual(picked.effects, [{ offer: true }, { refresh: { live: true } }]);
  assert.deepEqual({ open: picked.state.open, view: picked.state.view, back: picked.state.back, focus: picked.state.focus }, { open: primary(rows[1]), view: "instances", back: "instances", focus: "list" });
  assert.deepEqual(drawn(picked.state), ["quartz-a", "quartz-b"]);
  assert.equal(selectedName(picked.state), "quartz-a", "a view opened for the first time selects its first row");
  // A view of two deployments opens on its primary, this machine's, whichever row of it one thinks of.
  const first = press(picked.state, ["w", "g", "enter"]);
  assert.deepEqual(first.effects, [{ offer: true }, { refresh: { live: true } }]);
  assert.equal(first.state.open, primary(rows[0]));
  assert.deepEqual(drawn(first.state), ["lead", "kid", null, "solo", "garnet-a", "garnet-b"]);
  // The row of the view that is open: the switcher closes on it, and the read is still asked for.
  const same = press(goTo(state, "solo"), ["w", "enter"]);
  assert.deepEqual(same.effects, [{ offer: true }, { refresh: { live: true } }]);
  assert.deepEqual({ open: same.state.open, view: same.state.view, selected: selectedName(same.state) }, { open: DEPLOYMENT, view: "instances", selected: "solo" });
  // Started outside a deployment: a machine's view is opened on the machine's own deployment.
  const outside = heard(initialState({ deployment: null, cli: READS, home: "/home/u" }), answer(machine("garnet")), tick(0));
  assert.deepEqual([outside.view, outside.open], ["switcher", null], "an answer of the roster opens nothing by itself");
  const opened = press(outside, ["enter"]);
  assert.deepEqual(opened.effects, [{ refresh: { live: true } }]);
  assert.deepEqual([opened.state.open, opened.state.view], [viewsOf(outside)[0].primary, "instances"]);
  assert.equal(opened.state.open, GARNET);
  assert.deepEqual(drawn(opened.state), ["garnet-a", "garnet-b"]);
});

test("Enter on an offered folder asks the loop to admit it and changes nothing; admitted, it is served with the shared pending entry, opened and read; refused, its row says so and nothing else changes", () => {
  const offered = reduce(stateOf(observed(TREE)), { offered: { offered: [{ path: FOLDER, name: "sandbox" }], limited: false } }).state;
  const shown = press(goTo(offered, "child-a"), ["w", "G"]).state;
  assert.equal(chosen(shown), "sandbox");
  const asked = press(shown, ["enter"]);
  assert.deepEqual(asked.effects, [{ admit: FOLDER }]);
  assert.deepEqual(asked.state, shown, "nothing is served, opened or closed until the loop answers");
  // Admitted.
  const at = "2026-10-11T10:00:40.000Z";
  const joined = reduce(asked.state, { admitted: FOLDER, at });
  assert.deepEqual(joined.effect, { refresh: { live: true } });
  assert.deepEqual(joined.state.ctxs, [DEPLOYMENT, FOLDER]);
  assert.equal(Object.isFrozen(joined.state.ctxs), true);
  assert.deepEqual(entryOf(joined.state, FOLDER), pendingEntry(null, at));
  assert.equal(entryOf(joined.state), entryOf(shown), "the deployment already served keeps its entry");
  assert.deepEqual([numberOf(joined.state, FOLDER), numberOf(joined.state)], [0, 1]);
  assert.deepEqual({ open: joined.state.open, view: joined.state.view, back: joined.state.back, selected: joined.state.selected, focus: joined.state.focus }, { open: FOLDER, view: "instances", back: "instances", selected: null, focus: "list" });
  assert.equal(model(joined.state, { page: 19, now: NOW, at: AT, cols: 80 }).empty, "reading");
  const read = reduce(joined.state, { id: FOLDER, entry: observed(solos("x", "y")), number: 1 }).state;
  assert.deepEqual([drawn(read), selectedName(read)], [["x", "y"], "x"], "its first answer is taken, and selects its first row");
  // The view it left is found where it was.
  assert.equal(selectedName(press(read, ["w", "g", "enter"]).state), "child-a");
  // Admitted again while it is served: it is opened, and served once.
  const twice = reduce(press(read, ["w", "g", "enter"]).state, { admitted: FOLDER, at: "2026-10-11T10:00:50.000Z" });
  assert.deepEqual([twice.state.ctxs, twice.state.open, twice.effect], [[DEPLOYMENT, FOLDER], FOLDER, { refresh: { live: true } }]);
  assert.equal(entryOf(twice.state, FOLDER), entryOf(read, FOLDER), "its entry is not made pending again");
  // Refused.
  const refused = reduce(asked.state, { refused: FOLDER });
  assert.equal(refused.effect, null);
  assert.equal(refused.state.switcher.refused, FOLDER);
  assert.deepEqual({ ...refused.state, switcher: null }, { ...asked.state, switcher: null }, "nothing but the switcher's own state changed");
  assert.deepEqual({ ...refused.state.switcher, refused: null }, asked.state.switcher);
  assert.deepEqual(switcher(refused.state, AT).items.filter((item) => item.path !== undefined).map((item) => [item.path, item.refused]), [[FOLDER, true]]);
  assert.deepEqual(switcher(asked.state, AT).items.filter((item) => item.path !== undefined).map((item) => item.refused), [false]);
  // Picked again, the mark is gone and the loop is asked again.
  const retry = press(refused.state, ["enter"]);
  assert.deepEqual([retry.effects, retry.state.switcher.refused], [[{ admit: FOLDER }], null]);
});

test("selection, the list's scroll and the detail's are kept per open view: away and back returns to the same row at the same place, each view's collapse stays its own, and a filter is not kept", () => {
  const far = Array.from({ length: 5 }, (_, i) => remoteRow("/home/dev/Agents/quartz", `quartz-${i}`));
  const read = heard(stateOf(reporting([...TREE, ...MANY]), { cli: READS }), answer(machine("quartz", { workspace: LEDGER, instances: far })), tick(0));
  let state = goTo(press(goTo(read, "child-a"), ["h"]).state, "inst-30");
  state = hit(hit(state, "tab", { extent: 30, room: 10 }).state, "G", { extent: 30, room: 10 }).state;
  const left = { selected: state.selected, top: state.top, detailTop: state.detailTop };
  assert.deepEqual([left.selected, left.detailTop, left.top > 0], [idOf("inst-30"), 21, true], "a row far down, its list and its detail scrolled");
  const away = press(state, ["w", "j", "enter"]).state;
  assert.equal(away.open, QUARTZ);
  assert.deepEqual({ selected: selectedName(away), top: away.top, detailTop: away.detailTop, focus: away.focus }, { selected: "quartz-0", top: 0, detailTop: 0, focus: "list" });
  assert.deepEqual(away.places.get(DEPLOYMENT), left, "the place left behind is kept under what was open");
  const there = press(away, ["j", "j"]).state;
  assert.equal(selectedName(there), "quartz-2");
  const back = press(there, ["w", "g", "enter"]).state;
  assert.equal(back.open, DEPLOYMENT);
  assert.deepEqual({ selected: back.selected, top: back.top, detailTop: back.detailTop }, left);
  assert.equal(selectedName(back), "inst-30");
  assert.deepEqual([...back.collapsed], [keyOf("child-a")], "what was collapsed in this view is still collapsed");
  assert.equal(drawn(back).includes("grandchild"), false);
  assert.equal(model(back, { page: draw(back).page, now: NOW, at: AT, cols: draw(back).cols }).list.some((row) => row?.selected && row.name === "inst-30"), true);
  const again = press(back, ["w", "j", "enter"]).state;
  assert.deepEqual([again.open, selectedName(again)], [QUARTZ, "quartz-2"]);
  // A collapse there carries its own view in its key: this view's set is not touched by it.
  assert.equal(press(again, ["h"]).state.collapsed.has(keyOf("child-a")), true);
  // A read while away moves nothing of the view left behind: its row is found again.
  const meanwhile = take(again, reporting([...TREE, ...MANY, instanceRow("dev", "aaa-new")]));
  assert.equal(selectedName(press(meanwhile, ["w", "g", "enter"]).state), "inst-30");
  // A filter belongs to the view it was typed in: another view starts without one, and so does the way back.
  const filtered = press(back, ["/", "i", "n", "s", "t", "enter"]).state;
  assert.equal(filtered.filter.query, "inst");
  const other = press(filtered, ["w", "j", "enter"]).state;
  assert.deepEqual(other.filter, { editing: false, query: "" });
  assert.deepEqual(press(other, ["w", "g", "enter"]).state.filter, { editing: false, query: "" });
  // The same view picked again keeps it: nothing was left.
  assert.equal(press(filtered, ["w", "g", "enter"]).state.filter.query, "inst");
});

test("when the open view loses its last deployment the switcher is shown and says so: nothing is open, its place is forgotten, the folders are asked for, and the close key has nowhere to return to", () => {
  const read = heard(stateOf(reporting(NEAR), { cli: READS }), answer(machine("quartz", { workspace: LEDGER })), tick(0));
  const there = press(goTo(read, "solo"), ["w", "j", "enter", "j", "tab"]).state;
  assert.deepEqual([there.open, selectedName(there), there.focus], [QUARTZ, "quartz-b", "detail"]);
  // A read that fails keeps the machine: its view is still there.
  const kept = hearing(there, { thrown: "the pipe closed" }, tick(1));
  assert.deepEqual([kept.effect, kept.state.view, kept.state.open, selectedName(kept.state)], [null, "instances", QUARTZ, "quartz-b"]);
  // An answer that no longer lists it: no view holds what was open.
  const lost = hearing(there, answer(), tick(1));
  assert.deepEqual(lost.effect, { offer: true });
  assert.deepEqual(
    { view: lost.state.view, back: lost.state.back, open: lost.state.open, selected: lost.state.selected, top: lost.state.top, detailTop: lost.state.detailTop, focus: lost.state.focus, line: lost.state.switcher.line },
    { view: "switcher", back: "switcher", open: null, selected: null, top: 0, detailTop: 0, focus: "list", line: "gone" },
  );
  assert.equal(lost.state.places.has(QUARTZ), false);
  assert.equal(model(lost.state, { page: 19, now: NOW, at: AT, cols: 80 }).switcher.said, "gone");
  assert.deepEqual(choices(lost.state), ["acme-platform"]);
  const closing = hit(lost.state, "escape");
  assert.equal(closing.state, lost.state);
  assert.equal(closing.effect, null);
  // The view left earlier is opened where it was, and the line is gone.
  const back = press(lost.state, ["enter"]);
  assert.deepEqual(back.effects, [{ refresh: { live: true } }]);
  assert.deepEqual([back.state.open, back.state.view, selectedName(back.state), back.state.switcher.line], [DEPLOYMENT, "instances", "solo", null]);
  // Under the help it is the same, and the help closes onto the switcher.
  const under = hearing(press(there, ["?"]).state, answer(), tick(1));
  assert.deepEqual([under.state.view, under.state.open, under.state.switcher.line, under.effect], ["switcher", null, "gone", { offer: true }]);
  // A view that is not the open one may leave without a word.
  const elsewhere = hearing(read, answer(), tick(1));
  assert.deepEqual([elsewhere.effect, elsewhere.state.view, elsewhere.state.open, elsewhere.state.switcher.line], [null, "instances", DEPLOYMENT, null]);
});

test("a machine that changes workspace while its view is open needs nothing moved: what is open is still its deployment, and the view is the one that holds it now", () => {
  const read = heard(stateOf(reporting(NEAR), { cli: READS }), answer(machine("quartz", { workspace: LEDGER })), tick(0));
  const there = press(read, ["w", "j", "enter", "j"]).state;
  const joined = hearing(there, answer(machine("quartz")), tick(1));
  assert.deepEqual([joined.effect, joined.state.view, joined.state.open], [null, "instances", QUARTZ]);
  assert.deepEqual(drawn(joined.state), ["lead", "kid", null, "solo", "quartz-a", "quartz-b"]);
  assert.equal(selectedName(joined.state), "quartz-b", "the selection is still on its instance");
  assert.deepEqual(choices(joined.state), ["acme-platform"]);
  assert.deepEqual(switcher(joined.state, AT).items.map((item) => item.open), [true]);
});

test("when the selected row's deployment leaves the view the selection moves as for a row that is gone: to the row now at the same place, else to the last row", () => {
  const both = heard(stateOf(reporting(solos("a", "b")), { cli: READS }), answer(machine("garnet"), machine("quartz")), tick(0));
  assert.deepEqual(drawn(both), ["a", "b", "garnet-a", "garnet-b", "quartz-a", "quartz-b"]);
  const at = goTo(both, "garnet-a");
  const left = hearing(at, answer(machine("quartz")), tick(1));
  assert.deepEqual([left.effect, left.state.view, left.state.open], [null, "instances", DEPLOYMENT]);
  assert.deepEqual(drawn(left.state), ["a", "b", "quartz-a", "quartz-b"]);
  assert.equal(selectedName(left.state), "quartz-a", "the row now third");
  assert.equal(selectedName(heard(goTo(both, "quartz-b"), answer(machine("garnet")), tick(1))), "garnet-b", "the last row");
  assert.equal(selectedName(heard(goTo(both, "quartz-a"), answer(), tick(1))), "b", "past the end: the last row");
  // It left for another workspace: the same.
  const moved = heard(at, answer(machine("garnet", { workspace: LEDGER }), machine("quartz")), tick(1));
  assert.deepEqual(drawn(moved), ["a", "b", "quartz-a", "quartz-b"]);
  assert.equal(selectedName(moved), "quartz-a");
  // Not reached, its rows are kept, and so is the selection.
  const lost = heard(at, { thrown: "the pipe closed" }, tick(1));
  assert.deepEqual(drawn(lost), drawn(both));
  assert.equal(selectedName(lost), "garnet-a");
  // A row of another deployment that is selected stays selected while a machine leaves.
  assert.equal(selectedName(heard(goTo(both, "b"), answer(), tick(1))), "b");
});

// --- Movement in a list with headings ---------------------------------------------------

/** A view with every kind of row: this machine's cluster and single instance, a machine under a
 *  heading and its note, and after the sections a machine that is not reached and has no rows. */
function sectioned() {
  const near = stateOf(reporting(NEAR), { cli: READS });
  const first = heard(near, answer(machine("garnet", { workspace: LEDGER }), machine("quartz", { instances: [] })), tick(0));
  return heard(first, answer(machine("garnet"), machine("quartz", { probe: { ok: false, error: { code: "E_SSH", message: "no route to the host" } }, workspace: null, instances: [] })), tick(1));
}
/** The items of a state's list by kind, an instance by its name. */
const kinds = (state) => roster(state).items.map((item) => (item === null ? "gap" : item.id !== undefined ? item.row.instance : item.heading !== undefined ? "heading" : item.line !== undefined ? "line" : "other"));

test("movement passes over headings, sentences and the empty row in both directions, and stops at the first and at the last instance", () => {
  const state = sectioned(), order = ["lead", "kid", "solo", "garnet-a", "garnet-b"];
  assert.deepEqual(kinds(state).slice(0, 10), ["heading", "lead", "kid", "gap", "solo", "heading", "line", "garnet-a", "garnet-b", "heading"]);
  assert.equal(kinds(state).length > 10 && kinds(state).slice(10).every((kind) => kind === "line"), true, "the list ends in the sentences of a machine without rows");
  assert.equal(selectedName(state), "lead");
  let at = state;
  const down = [selectedName(at)];
  for (let i = 0; i < order.length + 1; i++) { at = press(at, [i % 2 ? "down" : "j"]).state; down.push(selectedName(at)); }
  assert.deepEqual(down, [...order, "garnet-b", "garnet-b"], "down, and twice more at the last instance");
  const up = [selectedName(at)];
  for (let i = 0; i < order.length + 1; i++) { at = press(at, [i % 2 ? "up" : "k"]).state; up.push(selectedName(at)); }
  assert.deepEqual(up, [...[...order].reverse(), "lead", "lead"], "up, and twice more at the first instance");
  for (const from of order) {
    for (const key of ["g", "home"]) assert.equal(selectedName(press(goTo(state, from), [key]).state), "lead", `${key} from ${from}: the first item is a heading`);
    for (const key of ["G", "end"]) assert.equal(selectedName(press(goTo(state, from), [key]).state), "garnet-b", `${key} from ${from}: the last items are a heading and its sentences`);
    for (const key of MOVES) {
      const after = press(goTo(state, from), [key]).state;
      assert.equal(roster(after).index.has(after.selected), true, `${key} from ${from} selects an instance`);
      assert.equal(shows(after), true, `${key} from ${from}: the selected row is in the pane`);
    }
  }
  // A page that would end on a heading or a sentence goes on to the next instance in the direction of travel.
  const paged = (from, key, page) => selectedName(reduce(goTo(state, from), { key, page, extent: 0, room: page }).state);
  assert.equal(paged("lead", "pagedown", 5), "garnet-a", "four rows down from the first instance is a heading, and a sentence after it");
  assert.equal(paged("solo", "pagedown", 3), "garnet-a", "two rows down is a sentence");
  assert.equal(paged("garnet-b", "pageup", 4), "solo", "three rows up is a heading");
  assert.equal(paged("garnet-a", "pageup", 2), "solo", "one row up is a sentence, and a heading before it");
  assert.equal(paged("garnet-a", "pagedown", 19), "garnet-b", "past the end: the last instance, not the sentences after it");
  assert.equal(paged("kid", "pageup", 19), "lead", "past the start: the first instance, not the heading before it");
  const none = Object.freeze({ ...state, selected: null });
  for (const key of MOVES) assert.equal(selectedName(press(none, [key]).state), "lead", `${key} with nothing selected`);
});

test("collapse-to-parent and expand-to-child stay within the run of rows the instance stands in: neither crosses a heading or the empty row, so a relative in another section is not gone to", () => {
  // `mid` has one child, in the other deployment of the view: its name resolves across the two agents roots.
  const joined = reduce(stateOf(reporting([instanceRow("dev", "lead"), instanceRow("dev", "mid", { parentInstance: "lead" }), instanceRow("dev", "alone")]), { cli: READS }), { admitted: SECOND, at: AT }).state;
  const second = [instanceRow("dev", "b-root"), instanceRow("dev", "b-kid", { parentInstance: "b-root" }), instanceRow("dev", "far-kid", { parentInstance: "mid" })];
  const state = reduce(joined, { id: SECOND, entry: reporting(second.map((row) => homedIn(SECOND, row)), { dir: SECOND }), number: 1 }).state;
  assert.deepEqual(kinds(state), ["heading", "alone", "gap", "lead", "mid", "heading", "b-root", "b-kid", "gap", "far-kid"]);
  const on = (name) => goTo(state, name);
  const stays = (name, key) => {
    const from = on(name), result = press(from, [key]);
    assert.deepEqual([selectedName(result.state), result.state.collapsed.size, result.effects], [name, 0, []], `${key} on ${name}`);
  };
  // Expand: the next row is not a child of this one when an empty row or a heading stands between.
  stays("mid", "l");
  stays("alone", "right");
  stays("b-kid", "l");
  stays("far-kid", "l");
  // Collapse: the parent is looked for above, up to the empty row or the heading.
  stays("far-kid", "h");
  stays("alone", "left");
  // Within a run both still go where they went.
  assert.equal(selectedName(press(on("lead"), ["l"]).state), "mid");
  assert.equal(selectedName(press(on("b-root"), ["l"]).state), "b-kid");
  assert.equal(selectedName(press(on("b-kid"), ["h"]).state), "b-root");
  // `mid` can be collapsed (it has a child), which hides nothing here: the child is in another section.
  const closed = press(on("mid"), ["h"]).state;
  assert.deepEqual([...closed.collapsed], [collapseKey(state.open, roster(state).rows.find((item) => item.row.instance === "mid").id)]);
  assert.deepEqual(kinds(closed), kinds(state));
  assert.equal(selectedName(press(closed, ["h"]).state), "lead", "collapsed already: to its parent, in its own run");
  assert.equal(press(closed, ["l"]).state.collapsed.size, 0);
});

// --- The switcher's filter field --------------------------------------------------------

test("the switcher has a filter field of its own: a text key is text there, q and r included, Backspace removes a grapheme, Enter keeps the filter, the close key clears it, a paste gives its first line, and the Instances filter is untouched by all of it", () => {
  const filtered = press(twoViews(), ["/", "s", "o", "l", "o", "enter"]).state;
  const kept = filtered.filter;
  assert.deepEqual([kept.query, drawn(filtered)], ["solo", ["solo"]]);
  const untouched = (state, what) => assert.equal(state.filter, kept, `${what}: the Instances filter is the same object`);
  const open = press(filtered, ["w", "/"]);
  assert.deepEqual(open.effects, [{ offer: true }]);
  assert.deepEqual([open.state.switcher.editing, open.state.switcher.query], [true, ""]);
  untouched(open.state, "opened");
  const typing = press(open.state, ["q", "u", "a", "r", "t", "z"]);
  assert.deepEqual([typing.state.switcher.query, typing.effects, typing.state.view], ["quartz", [], "switcher"], "q did not quit and r did not refresh");
  assert.deepEqual(choices(typing.state), ["ledger"], "the list follows the field as it is typed");
  untouched(typing.state, "typed");
  assert.equal(press(typing.state, ["backspace"]).state.switcher.query, "quart");
  assert.equal(press(typing.state, [FAMILY, "backspace"]).state.switcher.query, "quartz", "one grapheme, however many code points");
  assert.equal(press(typing.state, ["w", "/", "?", "1", "j"]).state.switcher.query, "quartzw/?1j", "the keys of the switcher are text in its field");
  assert.equal(press(open.state, ["space", "a", "space", "space", "b"]).state.switcher.query, "a b", "a space stands between words only");
  // Enter keeps it and leaves the field; it opens nothing.
  const entered = press(press(typing.state, ["space"]).state, ["enter"]);
  assert.deepEqual([entered.state.switcher.editing, entered.state.switcher.query, entered.effects], [false, "quartz", []]);
  assert.deepEqual([entered.state.view, entered.state.open], ["switcher", DEPLOYMENT]);
  assert.deepEqual(choices(entered.state), ["ledger"]);
  assert.equal(press(entered.state, ["/", "-"]).state.switcher.query, "quartz-", "a kept filter is edited from where it was");
  // The close key in the field clears it and leaves the field; the switcher stays.
  const cleared = press(typing.state, ["escape"]);
  assert.deepEqual([cleared.state.switcher.editing, cleared.state.switcher.query, cleared.state.view, cleared.effects], [false, "", "switcher", []]);
  assert.deepEqual(choices(cleared.state), ["acme-platform", "ledger"]);
  // Out of the field the close key closes one thing at a time: the kept filter, then the switcher.
  const once = press(entered.state, ["escape"]).state;
  assert.deepEqual([once.switcher.query, once.view], ["", "switcher"]);
  const twice = press(once, ["escape"]).state;
  assert.equal(twice.view, "instances");
  untouched(twice, "closed");
  assert.deepEqual(drawn(twice), ["solo"], "the Instances view is filtered as it was");
  // A paste: its first line into the open field, and nothing anywhere else in the switcher.
  for (const end of ["\n", "\r\n", "\r"]) assert.equal(reduce(open.state, { paste: `led${end}q\nrm -rf` }).state.switcher.query, "led", JSON.stringify(end));
  assert.equal(reduce(typing.state, { paste: "-b" }).state.switcher.query, "quartz-b");
  assert.equal(reduce(open.state, { paste: "o\x07lo" }).state, open.state, "a line the display filter would change adds nothing");
  for (const state of [entered.state, press(filtered, ["w"]).state]) {
    const pasted = reduce(state, { paste: "ledger\nq" });
    assert.equal(pasted.state, state, "the field is not open: the paste is dropped whole");
    assert.equal(pasted.effect, null);
  }
  untouched(reduce(open.state, { paste: "led" }).state, "pasted");
  // The limit is the field's, as in the Instances view.
  const full = [..."a".repeat(QUERY_LIMIT)].reduce((s, ch) => hit(s, ch).state, open.state);
  assert.equal(full.switcher.query.length, QUERY_LIMIT);
  assert.equal(hit(full, "b").state.switcher.query.length, QUERY_LIMIT);
  // The three keys that are not about the view keep their effects in the field; the others do nothing.
  for (const [key, effect] of [["ctrl+c", "quit"], ["ctrl+z", "suspend"], ["ctrl+l", "redraw"]]) {
    const result = hit(typing.state, key);
    assert.deepEqual([result.effect, result.state === typing.state], [effect, true], key);
  }
  for (const key of ["up", "down", "tab", "pagedown", "home"]) assert.equal(hit(typing.state, key).state, typing.state, key);
  // Opening a workspace ends the switcher's filter: the next time it lists everything.
  const picked = press(entered.state, ["enter"]);
  assert.deepEqual([picked.state.open, picked.state.switcher.query, picked.effects], [QUARTZ, "", [{ refresh: { live: true } }]]);
  // And the Instances field does not reach the switcher's.
  assert.equal(press(filtered, ["/", "x"]).state.switcher.query, "");
});

// --- The help over the switcher ---------------------------------------------------------

test("the help over the switcher returns to the switcher, by the help key and by the close key, and the refresh key there asks for the folders as in the switcher", () => {
  const shown = press(stateOf(observed(TREE)), ["w"]).state;
  const help = press(shown, ["?"]);
  assert.deepEqual([help.state.view, help.state.back, help.effects], ["help", "switcher", []]);
  for (const key of ["?", "escape"]) {
    const back = press(help.state, [key]);
    assert.deepEqual([back.state.view, back.state.back, back.effects], ["switcher", "switcher", []], key);
  }
  assert.deepEqual(press(help.state, ["r"]).effects, [{ refresh: { live: true }, offer: true }]);
  assert.deepEqual(press(stateOf(observed(TREE)), ["?", "r"]).effects, [{ refresh: { live: true } }], "over the Instances view it asks for the read alone");
  // The instances key leaves both for the view that is open.
  assert.deepEqual([press(help.state, ["1"]).state.view, press(help.state, ["1"]).state.back], ["instances", "instances"]);
  // From the help over the Instances view the workspaces key shows the switcher, and the help then opens over it.
  const through = press(stateOf(observed(TREE)), ["?", "w"]);
  assert.deepEqual([through.state.view, through.effects], ["switcher", [{ offer: true }]]);
  assert.equal(press(through.state, ["?", "?"]).state.view, "switcher");
  // With nothing open the help has only the switcher to return to.
  const nothing = initialState({ deployment: null, cli: CLI, home: "/home/u" });
  const lost = press(nothing, ["?"]).state;
  assert.deepEqual([lost.view, lost.back], ["help", "switcher"]);
  const stuck = hit(lost, "1");
  assert.equal(stuck.state, lost, "there is no Instances view to go to");
  assert.equal(stuck.effect, null);
  assert.equal(press(lost, ["escape"]).state.view, "switcher");
  // The help scrolls on its own over the switcher too, and moves no choice.
  const scrolled = hit(help.state, "j", { extent: 40, room: 19 }).state;
  assert.deepEqual([scrolled.helpTop, scrolled.switcher], [1, help.state.switcher]);
});

// --- What stands beyond the instances can always be read --------------------------------

const SMALL = { cols: 60, rows: 15 };
/** The frame of a state as the loop draws it, with what the model gave the views for it. */
function framed(state, size = SIZE) {
  const made = draw(state, size);
  return { ...made, m: model(state, { page: made.page, now: NOW, at: AT, cols: made.cols }) };
}
/** The row of a frame that carries the selection mark, and its place; null and -1 when none does. */
const markedAt = (lines) => lines.findIndex((line) => line.startsWith(">"));
const marked = (lines) => lines[markedAt(lines)] ?? null;
/** Twenty-five single instances of this machine: more than the list pane of 80x24 holds. */
const CROWD = Array.from({ length: 25 }, (_, i) => instanceRow("dev", `inst-${String(i).padStart(2, "0")}`));
/** Eight machines of this workspace that hold no instance. Reached, nothing is said of them; when
 *  the next read does not reach them each is listed after the sections with its reason, which
 *  takes more rows than the list pane has. */
const BUILDERS = Array.from({ length: 8 }, (_, i) => machine(`acme-ledger-builder-${i}`, { instances: [] }));
/** A view of `rows` on this machine with the eight machines after them, none reached; and another
 *  workspace on quartz, to have a second view. */
const trailed = (rows) => heard(heard(stateOf(reporting(rows), { cli: READS }), answer(...BUILDERS, machine("quartz", { workspace: LEDGER })), tick(0)), { thrown: "the pipe closed" }, tick(1));
/** Press `keys` in turn, again and again, until the frame cuts nothing below; every state on the way. */
function toTheEnd(state, keys, size = SIZE) {
  const seen = [];
  for (let i = 0; i < 60 && framed(state, size).m.below > 0; i++) { state = press(state, [keys[i % keys.length]], size).state; seen.push(state); }
  return seen;
}

test("selecting the last instance brings what stands under it into the pane: after a first roster read that throws, the frame shows the TUI's line and the failure's text under the last instance, which is still selected and drawn", () => {
  const read = heard(stateOf(reporting(CROWD), { cli: READS }), { thrown: "ENOENT" }, tick(0));
  const failure = read.remote.rosterFailure;
  assert.equal(failure.endsWith("ENOENT"), true);
  assert.equal(draw(read).page, 20, "the list pane of 80x24: the 25 instances and the three rows after them do not fit");
  // On the instance before the last the window is the least that shows it: the rows after the list are cut off.
  const near = goTo(read, "inst-23");
  assert.equal(framed(near).lines.some((line) => line.includes(ROSTER_FAILED)), false);
  assert.equal(framed(near).m.below > 0, true);
  for (const [what, state] of [["G", press(read, ["G"]).state], ["End", press(read, ["end"]).state], ["Down from the row above", press(near, ["j"]).state], ["PageDown", press(near, ["pagedown"]).state]]) {
    const { lines, m } = framed(state), at = markedAt(lines);
    assert.equal(selectedName(state), "inst-24", what);
    assert.equal(at >= 0 && lines[at].includes("inst-24"), true, `${what}: the last instance is drawn selected`);
    assert.equal(lines.findIndex((line) => line.includes(ROSTER_FAILED)) > at, true, `${what}: the TUI's line under it`);
    assert.equal(lines.findIndex((line) => line.includes(failure)), lines.findIndex((line) => line.includes(ROSTER_FAILED)) + 1, `${what}: and the failure's own text on the next row`);
    assert.deepEqual([m.below, state.loose], [0, false], what);
    assert.equal(lines.some((line) => line.includes("more below")), false, what);
    // Nothing is left to scroll to: the key that has nowhere to go changes nothing.
    for (const key of ["j", "pagedown", "G"]) assert.equal(press(state, [key]).state, state, `${key} after ${what}`);
  }
});

test("on the last instance the down keys scroll the rows after it, as many as there are, to the very last one: the selection stays, the list is loose, and the up key then selects the instance above and the window holds the selection again", () => {
  const read = trailed(CROWD), last = idOf("inst-24");
  let state = press(read, ["G"]).state;
  const first = framed(state);
  assert.equal(state.selected, last);
  assert.equal(marked(first.lines).includes("inst-24"), true, "the last instance is drawn, with what fits under it");
  assert.equal(first.lines[markedAt(first.lines) + 1].includes("acme-ledger-builder-0"), true);
  const items = roster(state, AT, first.cols).items, after = items.length - 1 - items.findIndex((item) => item?.id === last);
  assert.equal(after > first.page, true, `the ${after} rows after the last instance are more than the pane's ${first.page}`);
  assert.equal(first.m.below, after - (first.m.list.length - 1), "what does not fit beside the last instance is cut off");
  assert.deepEqual([state.loose, first.lines.some((line) => line.includes("more below"))], [false, true]);
  const way = toTheEnd(state, ["j", "pagedown", "down"]);
  assert.equal(way.length >= 2, true, "more than one key was needed");
  let top = state.top;
  for (const [i, each] of way.entries()) {
    assert.deepEqual([each.selected, each.loose, each.focus, each.view], [last, true, "list", "instances"], `key ${i + 1}`);
    assert.equal(each.top > top, true, `key ${i + 1} scrolled down`);
    assert.equal(framed(each).m.detail.title, "inst-24", "the detail is still the selected instance's");
    top = each.top;
  }
  state = way.at(-1);
  const end = framed(state);
  assert.equal(end.m.below, 0);
  assert.equal(end.lines.some((line) => line.includes("more below")), false, "the cut note no longer says anything is below");
  assert.equal(end.lines.some((line) => line.includes("acme-ledger-builder-7")), true, "the last machine is in the pane");
  assert.equal(end.m.list.at(-1).line !== undefined, true, "and the last row of the list is the last row of its reason");
  assert.equal(end.m.above + end.m.list.length, roster(state, AT, end.cols).items.length);
  assert.equal(markedAt(end.lines), -1, "the selected instance has left the pane");
  assert.equal(end.m.list.some((row) => row?.selected), false);
  for (const key of ["j", "down", "pagedown", "G", "end"]) assert.equal(press(state, [key]).state, state, `${key} at the end changes nothing more`);
  // Up: there is an instance to go to, so the selection moves and the window holds it.
  const up = press(state, ["k"]).state, back = framed(up);
  assert.deepEqual([selectedName(up), up.loose], ["inst-23", false]);
  assert.equal(marked(back.lines).includes("inst-23"), true);
  assert.equal(back.m.list.some((row) => row?.selected && row.name === "inst-23"), true);
  // The last-row key from there shows the last instance again, with what fits under it.
  const again = press(up, ["G"]).state;
  assert.deepEqual([again.selected, again.loose, marked(framed(again).lines).includes("inst-24")], [last, false, true]);
  // A page up from the scrolled list moves the selection too.
  assert.deepEqual([press(state, ["pageup"]).state.loose, press(state, ["pageup"]).state.selected === last], [false, false]);
});

test("a list that holds no instance and more rows than the pane is scrolled by the movement keys, down to its end and back to its start, and nothing is ever selected", () => {
  const none = trailed([]);
  assert.deepEqual(roster(none).rows, []);
  for (const size of [SIZE, SMALL]) {
    const start = framed(none, size), count = roster(none, AT, start.cols).items.length;
    assert.deepEqual([start.m.above, start.m.below > 0, none.selected, none.loose], [0, true, null, false], `${size.cols}x${size.rows}: ${count} rows in a pane of ${start.page}`);
    const way = toTheEnd(none, ["j", "pagedown"], size);
    assert.equal(way.length >= 2, true);
    let top = 0;
    for (const each of way) {
      assert.deepEqual([each.selected, each.loose], [null, true]);
      assert.equal(each.top > top, true);
      assert.equal(markedAt(framed(each, size).lines), -1);
      top = each.top;
    }
    const last = way.at(-1), end = framed(last, size);
    assert.deepEqual([end.m.below, end.m.above > 0, end.m.above + end.m.list.length], [0, true, count]);
    assert.equal(end.lines.some((line) => line.includes("acme-ledger-builder-7")), true);
    assert.equal(end.lines.some((line) => line.includes("more below")), false);
    for (const key of ["j", "pagedown", "G"]) assert.equal(press(last, [key], size).state, last, `${key} at the end`);
    // Back: a row, a page, and the start.
    const one = press(last, ["k"], size).state;
    assert.deepEqual([one.top, one.selected], [last.top - 1, null]);
    const page = press(last, ["pageup"], size).state;
    assert.equal(page.top < one.top && page.selected === null, true);
    for (const key of ["g", "home"]) {
      const home = press(last, [key], size).state, drawn = framed(home, size);
      assert.deepEqual([home.top, home.selected, drawn.m.above], [0, null, 0], key);
      assert.deepEqual(drawn.lines, start.lines, `${key}: the frame is the first one again`);
      for (const up of ["k", "pageup", "g"]) assert.equal(press(home, [up], size).state, home, `${up} at the start`);
    }
    // The last-row key goes to the end at once.
    assert.equal(framed(press(none, ["G"], size).state, size).m.below, 0);
  }
  // A list without instances that fits its pane has nothing to scroll.
  const short = heard(stateOf(reporting([]), { cli: READS }), { thrown: "ENOENT" }, tick(0));
  for (const key of MOVES) assert.equal(press(short, [key]).state, short, key);
});

test("selecting the first instance brings what stands above it into the pane: the first row of the pane is its deployment's heading, not the instance", () => {
  const read = heard(stateOf(reporting(MANY), { cli: READS }), answer(machine("garnet")), tick(0));
  const down = press(read, ["G"]).state;
  assert.equal(selectedName(down), "garnet-b");
  assert.equal(framed(down).m.above > 0, true, "the list is scrolled down");
  // One row above the second instance of the list the window starts at that instance: the heading is cut off.
  let second = down;
  while (selectedName(second) !== "inst-01") second = press(second, ["k"]).state;
  assert.deepEqual([framed(second).m.list[0].name, framed(second).m.above], ["inst-01", 2]);
  for (const [what, state] of [["g", press(down, ["g"]).state], ["Home", press(down, ["home"]).state], ["Up from the second instance", press(second, ["k"]).state], ["PageUp", press(second, ["pageup"]).state]]) {
    const { lines, m } = framed(state), at = markedAt(lines);
    assert.deepEqual([selectedName(state), state.top, state.loose, m.above], ["inst-00", 0, false, 0], what);
    assert.equal(m.list[0].heading?.label, TERMS.thisMachine, `${what}: the first row of the pane is the heading`);
    assert.equal(lines[at].includes("inst-00"), true, what);
    assert.equal(lines[at - 1].startsWith(` ${TERMS.thisMachine}`), true, `${what}: drawn right above the first instance`);
    for (const key of ["k", "pageup", "g"]) assert.equal(press(state, [key]).state, state, `${key} after ${what}: nothing is left above`);
  }
});

// --- The same in the switcher -----------------------------------------------------------

/** Two hundred folders of `~/Agents`: more than any pane holds. */
const FOLDERS = Array.from({ length: 200 }, (_, i) => ({ path: `/home/u/Agents/folder-${String(i).padStart(3, "0")}`, name: `folder-${String(i).padStart(3, "0")}` }));

test("in the switcher the last choice brings the line under it into the pane: with two hundred folders and more than are listed, the last-row key selects the last folder and the line that says so is drawn under it, in a tall pane and in a short one, and the down key then changes nothing", () => {
  const shown = press(reduce(stateOf(observed(TREE)), { offered: { offered: FOLDERS, limited: true } }).state, ["w"]).state;
  for (const size of [SIZE, SMALL]) {
    const before = press(shown, ["G", "k"], size).state;
    assert.equal(chosen(before), "folder-198");
    for (const [what, state] of [["G", press(shown, ["G"], size).state], ["End", press(shown, ["end"], size).state], ["Down from the choice above", press(before, ["j"], size).state]]) {
      const { lines, m } = framed(state, size), at = markedAt(lines), where = `${what} at ${size.cols}x${size.rows}`;
      assert.equal(chosen(state), "folder-199", where);
      assert.equal(lines[at].includes("folder-199"), true, where);
      assert.equal(lines[at + 1].includes(MORE_FOLDERS), true, `${where}: the line stands under the last folder`);
      assert.deepEqual([m.switcher.below, m.switcher.rows.at(-1), state.switcher.loose], [0, { own: MORE_FOLDERS }, false], where);
      assert.equal(state.switcher.top, m.switcher.above, `${where}: the store's top is the one drawn`);
      for (const key of ["j", "down", "pagedown", "G"]) {
        const more = press(state, [key], size);
        assert.equal(more.state, state, `${key} after ${where}`);
        assert.deepEqual(more.effects, []);
      }
    }
  }
  // The first choice brings the heading above it into the pane.
  const outside = reduce(initialState({ deployment: null, cli: CLI, home: "/home/u" }), { offered: { offered: FOLDERS, limited: false } }).state;
  const home = press(press(outside, ["G"]).state, ["g"]).state, top = framed(home);
  assert.deepEqual([chosen(home), home.switcher.top, home.switcher.loose], ["folder-000", 0, false]);
  assert.equal(top.lines[markedAt(top.lines) - 1].includes(OFFERED_SECTION), true);
  assert.equal(press(home, ["k"]).state, home);
});

test("while the switcher says that the open workspace is gone, its movement counts with the pane less that row: the last-row key reaches the last choice, the store's top is the one the model draws, and the model's rows are the ones on the frame", () => {
  const read = heard(stateOf(reporting(NEAR), { cli: READS }), answer(machine("quartz", { workspace: LEDGER })), tick(0));
  const lost = heard(press(read, ["w", "j", "enter"]).state, answer(), tick(1));
  const gone = reduce(lost, { offered: { offered: FOLDERS, limited: false } }).state;
  assert.deepEqual([gone.view, gone.open, gone.switcher.line], ["switcher", null, "gone"]);
  const folders = (lines) => lines.flatMap((line) => /folder-\d{3}/.exec(line)?.[0] ?? []);
  const agree = (state, what) => {
    const { lines, m, page } = framed(state);
    assert.equal(lines.some((line) => line.includes(SWITCHER_TEXT.gone)), true, `${what}: the line is said`);
    assert.equal(state.switcher.top, m.switcher.above, `${what}: the store's top is the one drawn`);
    assert.equal(m.switcher.rows.length, windowOf({ top: 0, count: 202, height: page - 1 }).size, `${what}: a window of the pane less one row`);
    assert.deepEqual(m.switcher.rows.flatMap((row) => (row.path !== undefined ? [row.label] : [])), folders(lines), `${what}: the folders of the model are the folders on the frame`);
    assert.equal(marked(lines).includes(chosen(state)), true, `${what}: the selected choice is drawn`);
    return m;
  };
  assert.equal(switcher(gone, AT).items.length, 202, "one view, the heading and two hundred folders");
  agree(gone, "at first");
  const end = press(gone, ["G"]).state;
  assert.equal(chosen(end), "folder-199");
  assert.equal(agree(end, "G").switcher.below, 0);
  assert.equal(press(end, ["j"]).state, end, "nothing stands under the last folder");
  // Every key after it starts from what is drawn: the selection moves and the window only as it must.
  let state = end;
  for (const key of ["k", "k", "pageup", "j", "pagedown", "pageup", "pageup", "G", "g", "pagedown"]) {
    state = press(state, [key]).state;
    agree(state, key);
    assert.equal(state.switcher.loose, false, key);
  }
  const up = press(end, ["k"]).state;
  assert.deepEqual([chosen(up), up.switcher.top], ["folder-198", end.switcher.top], "one choice up inside the window moves no row");
});

// --- A read that failed leaves the user where they were, whoever answers meanwhile -------

/** The interleaving a reviewer gave: a cluster, collapsed, and the last instance selected. */
const KIN = [instanceRow("dev", "alpha"), instanceRow("dev", "alpha-child", { parentInstance: "alpha" }), instanceRow("dev", "z-last")];
const LOCKED = { code: "E_LOCK_HELD", message: "another oats command holds the lock", origin: "kernel" };
/** What a user has of a view: where the selection is and what is collapsed. */
const place = (state) => ({ selected: state.selected, collapsed: [...state.collapsed].sort() });

test("while this machine's deployment is not read, an answer of the roster forgets no collapse and moves no selection: a failed local read, then a roster answer, then a good local read find the user where they were", () => {
  const entry = reporting(KIN);
  const start = goTo(press(goTo(stateOf(entry, { cli: READS }), "alpha"), ["h"]).state, "z-last");
  const kept = { selected: idOf("z-last"), collapsed: [keyOf("alpha")] };
  assert.deepEqual(place(start), kept);
  assert.deepEqual(drawn(start), ["alpha", null, "z-last"]);
  const lostEntry = failed(entry, LOCKED, tick(0));
  assert.equal(lostEntry.deployment.status, "unavailable", "the shared rule decides it: nothing of the observation is kept");
  assert.deepEqual(lostEntry.instances, []);
  for (const [what, unread] of [["a read that failed", lostEntry], ["a deployment not read yet", pending()]]) {
    const lost = take(start, unread);
    assert.deepEqual(place(lost), kept, what);
    assert.deepEqual(roster(lost).rows, [], `${what}: no row is drawn`);
    const outcomes = { "an answer without groups": answer(), "an answer that lists a machine of this workspace": answer(machine("garnet")), "a read that throws": { thrown: "the pipe closed" }, "a gated outcome": { gated: true } };
    for (const [which, outcome] of Object.entries(outcomes)) {
      const after = hearing(lost, outcome, tick(1));
      assert.equal(after.effect, null, `${what}, ${which}`);
      assert.deepEqual(place(after.state), kept, `${what}, ${which}: the selection and the collapse are as they were`);
      assert.deepEqual([after.state.view, after.state.open, after.state.rosterAt], ["instances", DEPLOYMENT, tick(1)], `${what}, ${which}: the outcome was taken`);
      // A second outcome, and a second failed read, change it no more than the first.
      const twice = take(heard(after.state, answer(), tick(2)), failed(entry, TIMEOUT, tick(3)));
      assert.deepEqual(place(twice), kept, `${what}, ${which}, and again`);
      // The next good read of this machine: the user is where they were, and it is drawn so.
      const back = take(twice, reporting(KIN));
      assert.deepEqual(place(back), kept, `${what}, ${which}: after the next good read`);
      assert.deepEqual(drawn(back).slice(0, 3), ["alpha", null, "z-last"], `${what}, ${which}: alpha is still collapsed`);
      const { lines } = framed(back);
      assert.equal(marked(lines).includes("z-last"), true, `${what}, ${which}: z-last is drawn selected`);
      assert.equal(lines.some((line) => line.includes(`${marksOf(false).running} alpha +1 `)), true, `${what}, ${which}: alpha is drawn collapsed, its one child folded away`);
      assert.equal(lines.some((line) => line.includes("alpha-child")), false);
    }
    // The answer that listed a machine: while the local read is unavailable the deployment reports
    // no workspace, so the machine is in a view of its own; with the good read it is in this one.
    const withMachine = take(heard(lost, answer(machine("garnet")), tick(1)), reporting(KIN));
    assert.deepEqual(roster(heard(lost, answer(machine("garnet")), tick(1))).deployments.map((d) => d.id), [DEPLOYMENT]);
    assert.deepEqual(drawn(withMachine), ["alpha", null, "z-last", "garnet-a", "garnet-b"], what);
    assert.deepEqual(place(withMachine), kept, what);
  }
});

test("with every deployment of this machine read, a machine that is no longer listed is still gone: the collapse key of one of its rows is forgotten and the selection moves off its row, while a machine that is only not reached keeps both", () => {
  const root = "/home/dev/Agents/garnet";
  const far = machine("garnet", { instances: [remoteRow(root, "garnet-lead"), remoteRow(root, "garnet-kid", { parentInstance: "garnet-lead" }), remoteRow(root, "garnet-z")] });
  const read = heard(stateOf(reporting(KIN), { cli: READS }), answer(far), tick(0));
  assert.deepEqual(drawn(read), ["alpha", "alpha-child", null, "z-last", "garnet-lead", "garnet-kid", null, "garnet-z"]);
  const farLead = collapseKey(DEPLOYMENT, roster(read).rows.find((item) => item.row.instance === "garnet-lead").id);
  let state = press(goTo(read, "alpha"), ["h"]).state;
  state = goTo(press(goTo(state, "garnet-lead"), ["h"]).state, "garnet-z");
  assert.deepEqual(place(state).collapsed, [keyOf("alpha"), farLead].sort());
  assert.deepEqual(drawn(state), ["alpha", null, "z-last", "garnet-lead", null, "garnet-z"]);
  // Not reached: the shared rule keeps its rows, so nothing of it is gone.
  const lost = heard(state, { thrown: "the pipe closed" }, tick(1));
  assert.deepEqual(place(lost), place(state));
  assert.equal(selectedName(lost), "garnet-z");
  // No longer listed: its rows are gone, and this machine's rows are all known.
  const gone = hearing(state, answer(), tick(1));
  assert.equal(gone.effect, null);
  assert.deepEqual([...gone.state.collapsed], [keyOf("alpha")], "the key of the machine's row is forgotten, and this machine's is kept");
  assert.deepEqual(drawn(gone.state), ["alpha", null, "z-last"]);
  assert.equal(selectedName(gone.state), "z-last", "the selection moved off the row that is gone, to the last row");
  assert.equal(marked(framed(gone.state).lines).includes("z-last"), true);
  // The same after it was not reached first.
  assert.deepEqual([...heard(lost, answer(), tick(2)).collapsed], [keyOf("alpha")]);
  // And an instance of this machine that is retired is forgotten as before, with a machine in the view.
  const retired = take(state, reporting(KIN.filter((row) => row.instance !== "alpha")));
  assert.deepEqual([...retired.collapsed], [farLead]);
  assert.equal(selectedName(retired), "garnet-z");
});

/** Two deployments of this machine in one view, the second with a collapsed cluster and its
 *  last instance selected; `open` says which of the two the view was opened on. */
function twoHere(open) {
  const first = [instanceRow("dev", "a-lead"), instanceRow("dev", "a-kid", { parentInstance: "a-lead" })];
  const second = [instanceRow("dev", "b-lead"), instanceRow("dev", "b-kid", { parentInstance: "b-lead" }), instanceRow("dev", "b-tail")].map((row) => homedIn(SECOND, row));
  const joined = reduce(stateOf(reporting(first), { cli: READS }), { admitted: SECOND, at: AT }).state;
  const both = reduce(joined, { id: SECOND, entry: reporting(second, { dir: SECOND }), number: 1 }).state;
  const state = open === SECOND ? both : press(both, ["w", "enter"]).state;
  assert.equal(state.open, open);
  assert.deepEqual(drawn(state), ["a-lead", "a-kid", "b-lead", "b-kid", null, "b-tail"]);
  return { first, second, state: goTo(press(goTo(state, "b-lead"), ["h"]).state, "b-tail") };
}
/** The steps of the test of two deployments, for a view opened on `open`: the second deployment's
 *  read fails with nothing kept, the first is read again, and the second is read again. */
function oneUnavailable(open) {
  const { first, second, state } = twoHere(open);
  const kept = place(state);
  assert.equal(kept.collapsed.length, 1);
  assert.equal(selectedName(state), "b-tail");
  const lostEntry = failed(state.entries.get(SECOND), LOCKED, tick(0));
  assert.equal(lostEntry.deployment.status, "unavailable");
  const lost = reduce(state, { id: SECOND, entry: lostEntry, number: 2 }).state;
  assert.deepEqual(place(lost), kept, "the failed read itself moves nothing");
  const other = reduce(lost, { id: DEPLOYMENT, entry: reporting(first), number: 2 });
  assert.equal(other.effect, null);
  assert.deepEqual(place(other.state), kept, "an observed entry of the other deployment forgets no collapse of the unavailable one, and moves no selection off its row");
  const roster2 = hearing(lost, answer(), tick(1));
  assert.deepEqual(place(roster2.state), kept, "nor does an answer of the roster");
  const back = reduce(other.state, { id: SECOND, entry: reporting(second, { dir: SECOND }), number: 3 }).state;
  assert.deepEqual(place(back), kept);
  assert.deepEqual(drawn(back), ["a-lead", "a-kid", "b-lead", null, "b-tail"], "the cluster is still collapsed");
  assert.equal(selectedName(back), "b-tail");
  assert.equal(marked(framed(back).lines).includes("b-tail"), true);
}

test("two deployments of this machine in one view, the open one unavailable: an observed entry of the other does not forget a collapse key of a row of the unavailable one", () => {
  oneUnavailable(SECOND);
});

test("two deployments of this machine in one view, opened on the first, the second unavailable: an observed entry of the first does not forget a collapse key of a row of the second", () => {
  oneUnavailable(DEPLOYMENT);
});

// --- When a list stops being loose ------------------------------------------------------

test("a list scrolled away from its selection holds it again after the fold of the selected row changes, after the filter's text changes, and after another view was opened and this one opened again", () => {
  // Two clusters and nothing else: with the second one collapsed its root is the last instance.
  const rows = [instanceRow("dev", "aa-lead"), instanceRow("dev", "aa-kid", { parentInstance: "aa-lead" }), instanceRow("dev", "zz-lead"), instanceRow("dev", "zz-kid", { parentInstance: "zz-lead" })];
  const read = trailed(rows);
  assert.deepEqual(drawn(read), ["aa-lead", "aa-kid", "zz-lead", "zz-kid"]);
  const closed = press(goTo(read, "zz-lead"), ["h"]).state;
  const loose = press(closed, ["G", "j"]).state;
  assert.deepEqual([selectedName(loose), loose.loose, markedAt(framed(loose).lines)], ["zz-lead", true, -1], "scrolled away: the selected row is not in the pane");
  const held = (state, name, what) => {
    assert.equal(state.loose, false, what);
    assert.equal(selectedName(state), name, what);
    assert.equal(marked(framed(state).lines)?.includes(name), true, `${what}: the selected row is drawn`);
  };
  // Expand.
  const expanded = press(loose, ["l"]).state;
  assert.equal(expanded.collapsed.size, 0);
  held(expanded, "zz-lead", "expand");
  // Collapse. No key reaches a loose list on a row that can be collapsed (the last instance never
  // has rows drawn under it, and the first one stands at the top), so the state is put together here.
  const open = Object.freeze({ ...expanded, top: loose.top, loose: true });
  assert.equal(markedAt(framed(open).lines), -1);
  const folded = press(open, ["h"]).state;
  assert.equal(folded.collapsed.size, 1);
  held(folded, "zz-lead", "collapse");
  // The filter's text.
  const opened = press(loose, ["/"]).state;
  const typed = press(opened, ["z"]).state;
  assert.deepEqual([typed.filter.query, typed.top], ["z", 0]);
  held(typed, "zz-lead", "a typed character");
  const keptFilter = press(typed, ["z", "enter"]).state;
  // (A filter shows every match whatever is collapsed: the last instance is the child now.)
  const looseAgain = press(keptFilter, ["G", "j"]).state;
  assert.deepEqual([looseAgain.loose, looseAgain.filter.query, selectedName(looseAgain), markedAt(framed(looseAgain).lines)], [true, "zz", "zz-kid", -1], "a filtered list scrolls past its last instance too");
  held(press(press(looseAgain, ["/"]).state, ["backspace"]).state, "zz-kid", "Backspace in the field");
  // Cleared, the collapse hides the child again: the selection moves by the rule for a row that is gone.
  held(press(looseAgain, ["escape"]).state, "aa-kid", "the kept filter cleared");
  // Another view, and back.
  const away = press(loose, ["w", "j", "enter"]).state;
  assert.deepEqual([away.open, away.loose], [QUARTZ, false]);
  const back = press(away, ["w", "g", "enter"]).state;
  assert.deepEqual([back.open, selectedName(back)], [DEPLOYMENT, "zz-lead"]);
  held(back, "zz-lead", "opened again");
  // A selection that moves.
  held(press(loose, ["k"]).state, "aa-kid", "the up key");
  held(press(loose, ["g"]).state, "aa-lead", "the first-row key");
});

test("the switcher's rows scrolled away from the selected choice hold it again when the switcher is shown again, when the selection moves and when its filter's text changes", () => {
  const shown = press(reduce(stateOf(observed(TREE)), { offered: { offered: FOLDERS, limited: true } }).state, ["w"]).state;
  // The last folder selected in a tall terminal, which then becomes a short one: the model's
  // window holds the choice, and the line under it is cut off.
  const tall = press(shown, ["G"], SIZE).state;
  const cut = framed(tall, SMALL);
  assert.equal(marked(cut.lines).includes("folder-199"), true);
  assert.deepEqual([cut.m.switcher.below, cut.lines.some((line) => line.includes(MORE_FOLDERS))], [1, false]);
  // The down key has no choice to go to: it scrolls the line into the pane.
  const scrolled = press(tall, ["j"], SMALL);
  assert.deepEqual(scrolled.effects, []);
  const loose = scrolled.state, drawnLoose = framed(loose, SMALL);
  assert.deepEqual([chosen(loose), loose.switcher.loose, drawnLoose.m.switcher.below], ["folder-199", true, 0]);
  assert.equal(drawnLoose.lines.some((line) => line.includes(MORE_FOLDERS)), true);
  assert.equal(loose.loose, false, "the list of instances under it is not touched");
  assert.equal(press(loose, ["j"], SMALL).state, loose, "nothing more to scroll");
  // Scrolled further away by hand, to see it come back.
  const away = Object.freeze({ ...loose, switcher: Object.freeze({ ...loose.switcher, top: 0 }) });
  assert.equal(markedAt(framed(away, SMALL).lines), -1, "the selected choice is not in the pane");
  const held = (state, label, what) => {
    assert.equal(state.switcher.loose, false, what);
    assert.equal(marked(framed(state, SMALL).lines)?.includes(label), true, `${what}: the selected choice is drawn`);
  };
  held(press(away, ["escape", "w"], SMALL).state, "folder-199", "shown again");
  held(press(away, ["k"], SMALL).state, "folder-198", "the up key");
  held(press(away, ["g"], SMALL).state, choices(away)[0], "the first-row key");
  held(press(away, ["/", "1", "9", "9"], SMALL).state, "folder-199", "a typed filter");
  const filtered = press(away, ["/", "f", "o", "l", "d", "enter"], SMALL).state;
  const again = Object.freeze({ ...filtered, switcher: Object.freeze({ ...filtered.switcher, top: 0, loose: true }) });
  held(press(again, ["escape"], SMALL).state, "folder-199", "the kept filter cleared");
});
