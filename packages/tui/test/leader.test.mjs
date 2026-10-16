process.env.TZ = "UTC";
// The leader and the palette in the store (docs/tui.md, "The leader" and "The palette"; spec T1b,
// Done 0 to 2): every event carries the number of the read of input it came in, as the loop hands
// it on, because what the leader and the palette take depends on which read a key arrived in.
// Every entry is made by the shared functions (helpers.mjs); no test needs a terminal.
import test from "node:test";
import assert from "node:assert/strict";
import { instanceId } from "../lib/client.mjs";
import { paletteItems, roster } from "../lib/model.mjs";
import { initialState, reduce } from "../lib/store.mjs";
import { CLI, instanceRow, leaderThen, leaderTwice, observed, stateOf } from "./helpers.mjs";

/** A kernel that starts and restarts sessions and plans stops and retires: every act is offered. */
const ACTS_CLI = Object.freeze({ ...CLI, lifecycleApi: 1, features: Object.freeze([...CLI.features, "session-start", "session-restart", "lifecycle-plans", "retire-retention", "retire-home"]) });
const STOPPED = { running: false, runtimeState: "stopped" };
/** The geometry of the frame before each key: the store reads it for a move, never keeps it. */
const AT = Object.freeze({ page: 19, extent: 0, room: 19, cols: 38 });

/** Drawn dev-a, dev-c, dev-b: the stopped one last, and it cannot be opened. */
const THREE = () => stateOf(observed([instanceRow("dev", "dev-a"), instanceRow("dev", "dev-b", STOPPED), instanceRow("dev", "dev-c")], { cli: ACTS_CLI }), { cli: ACTS_CLI });
/** Drawn alpha, alpha-kid, lead, child-a, grandchild, child-b, the empty row, solo-x, solo-y;
 *  alpha, child-b and solo-y are stopped. */
const TREE = () => stateOf(observed([
  instanceRow("dev", "solo-y", STOPPED),
  instanceRow("dev", "grandchild", { parentInstance: "child-a" }),
  instanceRow("dev", "lead"),
  instanceRow("dev", "child-b", { parentInstance: "lead", ...STOPPED }),
  instanceRow("dev", "alpha", STOPPED),
  instanceRow("dev", "solo-x"),
  instanceRow("dev", "child-a", { parentInstance: "lead" }),
  instanceRow("dev", "alpha-kid", { parentInstance: "alpha" }),
]));

let reads = 0;
/** A key in a read of its own (or in `read`); a one-character id types itself. */
const key = (state, id, read = ++reads) => reduce(state, { key: id, ...(id === "space" ? { text: " " } : id.length === 1 ? { text: id } : {}), read, ...AT });
/** Keys, each in a read of its own. -> the last step */
function keys(state, ...ids) {
  let step = { state, effect: null };
  for (const id of ids) step = key(step.state, id);
  return step;
}
/** The leader alone, in a read of its own (or in `read`): `{ back }` from the terminal's focus, else
 *  the leader's key. */
const leader = (state, read = ++reads, rest = false) => (state.terminal?.focus === "terminal" && state.view === "instances" && state.palette === null
  ? reduce(state, { back: true, read, rest, ...AT })
  : reduce(state, { key: state.leaderKey, read, ...AT }));
/** The leader twice, each in a read of its own, from any focus (helpers.mjs leaderTwice is the
 *  terminal's: from the list its `{ back }` is no key). */
const twice = (state) => key(leader(state).state, state.leaderKey);
/** The instance's id and its row, by name. */
const idOf = (state, name) => instanceId(rowOf(state, name));
const rowOf = (state, name) => roster(state).instances.find((row) => row.instance === name);
/** The state with `name` selected, as the list's moves leave it. */
const on = (state, name) => Object.freeze({ ...state, selected: idOf(state, name) });
/** `name`'s terminal opened from the list and shown by the panel: the focus is in it. */
function opened(state, name) {
  const open = key(on(state, name), "enter").state;
  return reduce(open, { shown: { id: idOf(state, name) }, ...AT }).state;
}
/** What openDecision gives for a row of this machine, as the `open` effect carries it. */
const decision = (state, name) => ({ open: true, id: idOf(state, name), name, machine: null, target: { home: rowOf(state, name).home }, routed: false });
/** The state but its leader: what the leader's step leaves when it changed nothing else. */
const butLeader = (state) => ({ ...state, leader: null });
/** The palette's rows as `kind label`. */
const rows = (state) => paletteItems(state).items.map((item) => `${item.kind} ${item.label}`);

// ── The leader in the list ───────────────────────────────────────────────────────────────────────

test("in the list, the leader then a key of its table in a later read does what that action does: ? the help, 2 Souls, 3 Capabilities, o the workspaces, / the filter field, 1 back to the instances", () => {
  const state = THREE();
  for (const [k, plain] of [["?", "?"], ["2", "2"], ["3", "3"], ["o", "w"], ["/", "/"]]) {
    const led = leaderThen(state, k, AT), pressed = key(state, plain);
    assert.deepEqual([led.leader.state.leader.waiting, led.leader.effect], [true, null], `${k}: the leader waits`);
    assert.equal(led.state.leader.waiting, false, `${k}: the leader is spent`);
    assert.deepEqual([butLeader(led.state), led.effect], [butLeader(pressed.state), pressed.effect], `${k} after the leader is ${plain} in the list`);
  }
  assert.deepEqual([leaderThen(state, "?", AT).state.view, leaderThen(state, "?", AT).state.back], ["help", "instances"]);
  assert.deepEqual([leaderThen(state, "o", AT).state.view, leaderThen(state, "o", AT).effect], ["switcher", { offer: true }]);
  assert.deepEqual(leaderThen(state, "/", AT).state.filter, { editing: true, query: "" });
  const souls = leaderThen(state, "2", AT).state;
  assert.equal(souls.view, "souls");
  const back = leaderThen(souls, "1", AT);
  assert.deepEqual([back.state.view, back.state.back, back.state.selected, back.effect], ["instances", "instances", state.selected, null]);
});

test("a key in the leader's own read cancels it and does nothing: a paste cannot run a command, and the key after it in a later read is a plain key again", () => {
  const state = THREE();
  const read = ++reads, waiting = leader(state, read).state;
  assert.deepEqual(waiting.leader, { read, waiting: true });
  for (const k of ["?", "2", "o", "X", "k", "escape"]) {
    const same = key(waiting, k, read);
    assert.deepEqual([same.state.leader, same.effect], [{ read, waiting: false }, null], k);
    assert.deepEqual(butLeader(same.state), butLeader(state), `${k}: nothing else changed`);
  }
  // The leader no longer waits: `o` is the leader's workspaces only after it, and bound to nothing in the list.
  const after = key(key(waiting, "?", read).state, "o");
  assert.deepEqual([after.state.view, after.state.leader, after.effect], ["instances", null, null]);
});

test("a key not in the leader's table cancels it and is dropped: no action runs, and nothing is typed into an open filter field, nor pasted", () => {
  const state = THREE();
  for (const k of ["q", "j", "enter", "x", "c", "tab", "ctrl+c"]) {
    const led = leaderThen(state, k, AT);
    assert.deepEqual([led.state.leader.waiting, led.effect], [false, null], k);
    assert.deepEqual(butLeader(led.state), butLeader(state), `${k}: dropped`);
  }
  const typing = keys(state, "/", "d", "e").state;
  assert.deepEqual(typing.filter, { editing: true, query: "de" });
  for (const k of ["x", "q", "backspace", "enter"]) {
    const led = leaderThen(typing, k, AT);
    assert.deepEqual([led.state.filter, led.state.leader.waiting, led.effect], [{ editing: true, query: "de" }, false, null], k);
  }
  const pasted = reduce(leader(typing).state, { paste: "v-a", read: ++reads, ...AT });
  assert.deepEqual([pasted.state.filter, pasted.state.leader.waiting, pasted.effect], [{ editing: true, query: "de" }, false, null], "a paste after the leader is dropped");
  // The leader spent, the field takes text again.
  assert.deepEqual(key(leaderThen(typing, "x", AT).state, "v").state.filter, { editing: true, query: "dev" });
});

// ── The leader from a terminal ───────────────────────────────────────────────────────────────────

test("from the terminal's focus the leader waits and the terminal keeps the focus; then k or Space in a later read opens the palette from the terminal, with the list's focus, and Esc gives the focus back to the terminal", () => {
  const state = opened(THREE(), "dev-a"), a = idOf(state, "dev-a");
  assert.deepEqual([state.terminal.id, state.terminal.focus, state.terminal.status], [a, "terminal", "open"]);
  const read = ++reads, waiting = leader(state, read);
  assert.deepEqual([waiting.state.leader, waiting.state.terminal, waiting.effect], [{ read, waiting: true }, state.terminal, null]);
  for (const k of ["k", "space"]) {
    const later = ++reads, open = key(waiting.state, k, later);
    assert.deepEqual([open.state.palette, open.effect], [{ query: "", selected: null, top: 0, read: later, from: "terminal" }, null], k);
    assert.deepEqual([open.state.terminal.focus, open.state.terminal.zoom, open.state.leader], ["list", false, { read: later, waiting: false }], k);
    for (const close of ["escape", "ctrl+k"]) {
      const shut = key(open.state, close);
      assert.deepEqual([shut.state.palette, shut.state.terminal.focus, shut.state.view, shut.effect], [null, "terminal", "instances", null], `${k}, then ${close}`);
    }
  }
});

test("the leader typed in the terminal with more bytes after it in the same read does not wait: what followed it cancelled it", () => {
  const state = opened(THREE(), "dev-a");
  const read = ++reads, step = leader(state, read, true);
  assert.deepEqual([step.state.leader, step.state.terminal, step.effect], [{ read, waiting: false }, state.terminal, null]);
  // The next leader, alone in its read, waits again.
  assert.deepEqual(leader(step.state).state.leader.waiting, true);
});

test("the leader twice, or the leader then Esc, from the terminal gives the list the focus, unzoomed, and the terminal stays open", () => {
  const state = opened(THREE(), "dev-a");
  const zoomed = key(leaderTwice(state).state, "z").state;
  assert.deepEqual([zoomed.terminal.focus, zoomed.terminal.zoom], ["terminal", true]);
  for (const from of [state, zoomed]) {
    for (const step of [leaderTwice(from), leaderThen(from, "escape", AT)]) {
      assert.deepEqual([step.state.terminal, step.state.focus, step.state.view, step.state.leader.waiting, step.effect],
        [{ ...state.terminal, focus: "list", zoom: false }, "list", "instances", false, null]);
    }
  }
});

test("the leader twice, or the leader then Esc, from the list's focus only closes the hint: nothing else changes, also with a terminal open (Settled 5)", () => {
  const plain = THREE(), withTerminal = leaderTwice(opened(THREE(), "dev-a")).state;
  for (const state of [plain, withTerminal]) {
    for (const step of [twice(state), leaderThen(state, "escape", AT)]) {
      assert.deepEqual([step.state.leader.waiting, step.effect], [false, null]);
      assert.deepEqual(butLeader(step.state), butLeader(state));
    }
  }
  // From the detail, the help and an open filter field, they give the list its focus.
  const detail = key(plain, "tab").state;
  assert.equal(detail.focus, "detail");
  assert.deepEqual(butLeader(leaderThen(detail, "escape", AT).state), butLeader(plain));
  assert.deepEqual(butLeader(twice(key(plain, "?").state).state), butLeader(plain));
  const field = leaderThen(keys(plain, "/", "d").state, "escape", AT).state;
  assert.deepEqual([field.filter, field.view], [{ editing: false, query: "d" }, "instances"]);
});

test("the leader then z zooms the terminal that has the focus, in and out; then w closes it, the agent left running; with no terminal open w and z do nothing", () => {
  const state = opened(THREE(), "dev-a"), a = idOf(state, "dev-a");
  const zoomed = leaderThen(state, "z", AT);
  assert.deepEqual([zoomed.state.terminal, zoomed.effect], [{ ...state.terminal, zoom: true }, null]);
  const unzoomed = leaderThen(zoomed.state, "z", AT);
  assert.deepEqual([unzoomed.state.terminal, unzoomed.effect], [state.terminal, null]);
  // From the list's focus, z goes to the terminal zoomed, as the list's z does.
  const fromList = leaderThen(leaderTwice(state).state, "z", AT);
  assert.deepEqual([fromList.state.terminal.focus, fromList.state.terminal.zoom, fromList.effect], ["terminal", true, null]);
  for (const from of [state, zoomed.state, leaderTwice(state).state]) {
    const closed = leaderThen(from, "w", AT);
    assert.deepEqual([closed.state.terminal, closed.state.view, closed.effect], [null, "instances", { close: [a] }]);
  }
  const none = THREE();
  for (const k of ["w", "z"]) {
    const step = leaderThen(none, k, AT);
    assert.deepEqual([butLeader(step.state), step.effect], [butLeader(none), null], k);
  }
});

test("the leader then X, D or R from the terminal acts on the terminal's instance, not the selection: its confirmation opens, and closing it gives the focus back to the terminal", () => {
  const base = opened(THREE(), "dev-a"), a = idOf(base, "dev-a");
  // The selection moved to dev-c, then z went back to the terminal, zoomed.
  const state = key(on(leaderTwice(base).state, "dev-c"), "z").state;
  assert.deepEqual([state.selected, state.terminal.id, state.terminal.focus], [idOf(base, "dev-c"), a, "terminal"]);
  for (const [k, verb, kind] of [["X", "stop", "lifecycle"], ["D", "retire", "lifecycle"], ["R", "restart", "start"]]) {
    const step = leaderThen(state, k, AT);
    assert.deepEqual([step.state.view, step.state.back, step.state.act.verb, step.state.act.kind, step.state.act.id, step.state.act.after], ["act", "instances", verb, kind, a, "terminal"], k);
    assert.deepEqual(step.effect, kind === "start" ? null : { act: { n: 1, verb, id: a, row: rowOf(state, "dev-a"), label: null } }, k);
    assert.deepEqual([step.state.terminal.id, step.state.terminal.focus, step.state.terminal.zoom], [a, "list", false], `${k}: the confirmation has the keys`);
    const shut = key(step.state, "escape");
    assert.deepEqual([shut.state.view, shut.state.act, shut.state.terminal.focus, shut.state.terminal.zoom, shut.effect], ["instances", null, "terminal", false, { dismiss: 1 }], `${k}, then Esc`);
  }
  // From the list's focus they act on the selection, and closing leaves the focus in the list.
  const listed = leaderThen(on(leaderTwice(base).state, "dev-c"), "X", AT);
  assert.deepEqual([listed.state.act.id, listed.state.act.after], [idOf(base, "dev-c"), null]);
  assert.equal(key(listed.state, "escape").state.terminal.focus, "list");
});

test("the leader then S on the terminal's running instance opens nothing: the line says it can't be started, and the focus is the list's", () => {
  const state = opened(THREE(), "dev-a");
  const step = leaderThen(state, "S", AT);
  assert.deepEqual([step.state.view, step.state.act, step.effect], ["instances", null, null]);
  assert.deepEqual(step.state.outcome, { said: [{ shown: "dev-a" }, { own: " can't be started here." }], under: [] });
  assert.deepEqual([step.state.terminal.focus, step.state.terminal.zoom], ["list", false]);
});

test("the leader then Down or Up opens the next or previous instance that can be opened, selected and with the focus, passing over the stopped rows and the empty row, and stops at both ends without wrapping", () => {
  const state = TREE();
  assert.equal(state.selected, idOf(state, "alpha"));
  // From the selection, no terminal open: alpha (stopped) to alpha-kid.
  const first = leaderThen(state, "down", AT);
  assert.deepEqual(first.effect, { open: decision(state, "alpha-kid") });
  assert.deepEqual([first.state.selected, first.state.terminal.id, first.state.terminal.focus, first.state.recent], [idOf(state, "alpha-kid"), idOf(state, "alpha-kid"), "terminal", [idOf(state, "alpha-kid")]]);
  // From the open terminal: each next instance opens as a tab of its own after the shown one, and
  // nothing is closed (T2, Done 3), up to the cap.
  let at = reduce(first.state, { shown: { id: idOf(state, "alpha-kid") }, ...AT }).state;
  for (const [from, to] of [["alpha-kid", "lead"], ["lead", "child-a"], ["child-a", "grandchild"]]) {
    const step = leaderThen(at, "down", AT);
    assert.deepEqual(step.effect, { open: decision(state, to) }, `${from} down`);
    assert.deepEqual([step.state.selected, step.state.terminal.id, step.state.terminal.focus], [idOf(state, to), idOf(state, to), "terminal"], `${from} down`);
    at = reduce(step.state, { shown: { id: idOf(state, to) }, ...AT }).state;
  }
  assert.deepEqual(at.tabs.map((tab) => tab.id), ["alpha-kid", "lead", "child-a", "grandchild"].map((name) => idOf(state, name)));
  // The fifth: every tab is taken, nothing opens and nothing closes, and the line says so.
  const full = leaderThen(at, "down", AT);
  assert.deepEqual([full.effect, full.state.tabs.length, full.state.terminal.id], [null, 4, idOf(state, "grandchild")]);
  assert.equal(full.state.outcome.said.map((part) => part.own ?? part.shown).join(""), "4 terminals are open; close one with C-\\ w.");
  // Up from the shown tab: the instance above is a tab, and is shown.
  const shownUp = leaderThen(at, "up", AT);
  assert.deepEqual([shownUp.effect, shownUp.state.terminal.id, shownUp.state.terminal.focus], [{ show: idOf(state, "child-a") }, idOf(state, "child-a"), "terminal"]);
  // solo-y under solo-x is stopped: the end. alpha above alpha-kid is stopped: the end.
  const bottom = reduce(opened(TREE(), "solo-x"), { shown: { id: idOf(state, "solo-x") }, ...AT }).state;
  const last = leaderThen(bottom, "down", AT);
  assert.deepEqual([butLeader(last.state), last.effect], [butLeader(bottom), null], "no wrap at the bottom");
  const top = opened(TREE(), "alpha-kid"), firstUp = leaderThen(top, "up", AT);
  assert.deepEqual([butLeader(firstUp.state), firstUp.effect], [butLeader(top), null], "no wrap at the top");
  const back = leaderThen(bottom, "up", AT);
  assert.deepEqual(back.effect, { open: decision(state, "grandchild") }, "solo-x up passes over the empty row and child-b");
  // From the selection when none is open: child-b (stopped) up to grandchild.
  const fromStopped = leaderThen(on(state, "child-b"), "up", AT);
  assert.deepEqual(fromStopped.effect, { open: decision(state, "grandchild") });
});

test("the leader then Up or Down moves from the open terminal's instance, not from the selection, also from the list's focus", () => {
  const state = leaderTwice(opened(TREE(), "child-a")).state, child = idOf(state, "child-a");
  const moved = on(state, "solo-x");
  for (const [k, to] of [["down", "grandchild"], ["up", "lead"]]) {
    const step = leaderThen(moved, k, AT);
    assert.deepEqual(step.effect, { open: decision(state, to) }, k);
    assert.deepEqual(step.state.tabs.map((tab) => tab.id), [child, idOf(state, to)], `${k}: a tab of its own beside child-a's`);
    assert.deepEqual([step.state.selected, step.state.terminal.id, step.state.terminal.focus], [idOf(state, to), idOf(state, to), "terminal"], k);
  }
});

// ── The palette ──────────────────────────────────────────────────────────────────────────────────

test("the palette lists the instances that can be opened, the views, the acts the selected instance offers, then Spawn an agent, Workspaces, Refresh and Help; an instance's row carries its mark, name and machine", () => {
  const state = key(THREE(), "ctrl+k").state;
  assert.deepEqual(rows(state), [
    "instance dev-a", "instance dev-c",
    "view Instances", "view Souls", "view Capabilities",
    "act Stop", "act Retire", "act Restart",
    "command Spawn an agent", "command Workspaces", "command Refresh", "command Help",
  ]);
  const a = idOf(state, "dev-a");
  assert.deepEqual(paletteItems(state).items[0], { key: `instance\u0000${a}`, kind: "instance", label: "dev-a", id: a, name: "dev-a", machine: null, mark: "running", text: "dev-a " });
  assert.deepEqual(paletteItems(state).items[5], { key: "act\u0000stop", kind: "act", label: "Stop", does: "stop", id: a, name: "dev-a", text: "Stop dev-a" });
  assert.equal(paletteItems(state).selected, `instance\u0000${a}`, "the first row is selected");
  // The acts are the selected instance's: dev-b is stopped, so it is started, not restarted.
  assert.deepEqual(rows(key(on(THREE(), "dev-b"), "ctrl+k").state).filter((row) => row.startsWith("act ")), ["act Stop", "act Retire", "act Start"]);
});

test("the palette lists the instances most recently opened in this run first, then in the list's order", () => {
  const state = THREE(), a = idOf(state, "dev-a"), c = idOf(state, "dev-c");
  const openedC = opened(state, "dev-c");
  assert.deepEqual(openedC.recent, [c]);
  assert.deepEqual(rows(key(leaderTwice(openedC).state, "ctrl+k").state).slice(0, 2), ["instance dev-c", "instance dev-a"]);
  const thenA = key(on(leaderTwice(openedC).state, "dev-a"), "enter").state;
  assert.deepEqual(thenA.recent, [a, c]);
  assert.deepEqual(rows(key(leaderTwice(thenA).state, "ctrl+k").state).slice(0, 2), ["instance dev-a", "instance dev-c"]);
});

test("typing filters each group by the subsequence score, a prefix first and a tie in the group's order; a query that matches nothing leaves no row; Backspace takes a character off", () => {
  const open = key(THREE(), "ctrl+k").state;
  const c = key(open, "c").state;
  assert.deepEqual([c.palette.query, rows(c)], ["c", ["instance dev-c", "view Capabilities", "view Instances", "command Workspaces"]]);
  const re = keys(open, "r", "e").state;
  assert.deepEqual([re.palette.query, rows(re)], ["re", ["act Retire", "act Restart", "command Refresh", "command Workspaces"]]);
  const none = keys(open, "z", "z", "z").state;
  assert.deepEqual([rows(none), paletteItems(none).selected], [[], null]);
  // Enter with no row runs nothing.
  assert.deepEqual([key(none, "enter").state, key(none, "enter").effect], [none, null]);
  const back = key(re, "backspace").state;
  assert.deepEqual([back.palette.query, back.palette.selected], ["r", null]);
  assert.deepEqual(key(open, "backspace").state.palette, open.palette, "Backspace on an empty query");
});

test("Up and Down move the palette's selection among its rows and stop at both ends", () => {
  const open = key(THREE(), "ctrl+k").state, all = paletteItems(open).items.map((item) => item.key);
  assert.equal(key(open, "up").state.palette.selected, all[0]);
  assert.equal(key(open, "down").state.palette.selected, all[1]);
  assert.equal(keys(open, "down", "down", "up").state.palette.selected, all[1]);
  assert.equal(keys(open, ...all.map(() => "down"), "down").state.palette.selected, all.at(-1));
  // j and k are the query's.
  assert.deepEqual([key(open, "j").state.palette.query, key(open, "k").state.palette.query], ["j", "k"]);
});

test("Enter in the read that opened the palette runs nothing, and in a later read runs the selected row: an instance opens its terminal, with the focus", () => {
  const state = THREE(), read = ++reads, open = key(state, "ctrl+k", read).state;
  assert.equal(open.palette.read, read);
  const same = key(open, "enter", read);
  assert.deepEqual([same.state, same.effect], [open, null]);
  // From the leader, the read is the k's.
  const led = leaderThen(state, "k", AT).state;
  assert.deepEqual([key(led, "enter", led.palette.read).state, key(led, "enter", led.palette.read).effect], [led, null]);
  const ran = key(key(open, "down").state, "enter");
  assert.deepEqual(ran.effect, { open: decision(state, "dev-c") });
  assert.deepEqual([ran.state.palette, ran.state.selected, ran.state.terminal.id, ran.state.terminal.focus], [null, idOf(state, "dev-c"), idOf(state, "dev-c"), "terminal"]);
});

test("an instance run from the palette opened from a terminal opens it as a tab of its own beside the open one (T2: nothing is closed)", () => {
  const state = opened(THREE(), "dev-a"), a = idOf(state, "dev-a"), c = idOf(state, "dev-c");
  const open = leaderThen(state, "k", AT).state;
  assert.deepEqual(rows(open).slice(0, 2), ["instance dev-a", "instance dev-c"]);
  const ran = keys(open, "d", "e", "v", "-", "c", "enter");
  assert.deepEqual(ran.effect, { open: decision(state, "dev-c") });
  assert.deepEqual(ran.state.tabs.map((tab) => tab.id), [a, c]);
  assert.deepEqual([ran.state.palette, ran.state.selected, ran.state.terminal.id, ran.state.terminal.focus, ran.state.recent], [null, c, c, "terminal", [c, a]]);
  // The first row is the shown tab's instance (the most recent): the second is selected (T2, Done
  // 4), so Enter goes to the terminal before it.
  assert.equal(paletteItems(open).selected, `instance\u0000${c}`);
  // The open terminal's own row, chosen, gives it the focus back, and opens nothing.
  const own = keys(leaderThen(state, "k", AT).state, "d", "e", "v", "-", "a", "enter");
  assert.deepEqual([own.state.palette, own.state.terminal, own.effect], [null, state.terminal, null]);
});

test("a view run from the palette switches to it, and from a terminal gives the list the focus; Souls asks the loop to settle its catalog, and Capabilities its table and the souls catalog its Used by reads", () => {
  const ran = keys(key(THREE(), "ctrl+k").state, "s", "o", "u", "l", "s", "enter");
  assert.deepEqual([ran.state.palette, ran.state.view, ran.state.back, ran.effect], [null, "souls", "souls", { souls: "settle" }]);
  const fromTerminal = keys(leaderThen(opened(THREE(), "dev-a"), "k", AT).state, "c", "a", "p", "enter");
  assert.deepEqual([fromTerminal.state.palette, fromTerminal.state.view, fromTerminal.state.terminal.focus, fromTerminal.effect], [null, "capabilities", "list", { souls: "settle", capabilities: "settle" }]);
  const instances = keys(key(key(THREE(), "2").state, "ctrl+k").state, "i", "n", "s", "enter");
  assert.deepEqual([instances.state.view, instances.state.palette], ["instances", null]);
});

test("an act run from the palette opens its confirmation on the palette's instance: the terminal's when opened from it, whose focus closing it gives back", () => {
  const state = THREE(), a = idOf(state, "dev-a");
  const ran = keys(key(state, "ctrl+k").state, "s", "t", "o", "p", "enter");
  assert.deepEqual([ran.state.palette, ran.state.view, ran.state.act.verb, ran.state.act.id, ran.state.act.after], [null, "act", "stop", a, null]);
  assert.deepEqual(ran.effect, { act: { n: 1, verb: "stop", id: a, row: rowOf(state, "dev-a"), label: null } });
  // From the terminal on dev-a, with dev-c selected.
  const base = opened(state, "dev-a"), moved = key(on(leaderTwice(base).state, "dev-c"), "z").state;
  const open = leaderThen(moved, "k", AT).state;
  assert.deepEqual(paletteItems(open).items.filter((item) => item.kind === "act").map((item) => [item.does, item.id]), [["stop", a], ["retire", a], ["restart", a]]);
  const restart = keys(open, "r", "e", "s", "t", "enter");
  assert.deepEqual([restart.state.view, restart.state.act.verb, restart.state.act.kind, restart.state.act.id, restart.state.act.after, restart.effect], ["act", "restart", "start", a, "terminal", null]);
  const shut = key(restart.state, "escape");
  assert.deepEqual([shut.state.view, shut.state.terminal.focus, shut.effect], ["instances", "terminal", { dismiss: restart.state.act.n }]);
});

test("Workspaces, Refresh and Help run from the palette do what their actions do", () => {
  const state = THREE(), open = key(state, "ctrl+k").state;
  const run = (query) => keys(open, ...query, "enter");
  for (const [query, plain] of [["works", "w"], ["refr", "r"], ["help", "?"]]) {
    const ran = run([...query]), pressed = key(state, plain);
    assert.deepEqual([butLeader(ran.state), ran.effect], [butLeader(pressed.state), pressed.effect], query);
  }
  assert.deepEqual([run([..."works"]).state.view, run([..."works"]).effect], ["switcher", { offer: true }]);
  assert.deepEqual([run([..."refr"]).state.palette, run([..."refr"]).effect], [null, { refresh: { live: true } }]);
  assert.deepEqual([run([..."help"]).state.view, run([..."help"]).state.back], ["help", "instances"]);
});

test("a paste into the palette is its query's, its first line only, and runs nothing", () => {
  const open = key(THREE(), "ctrl+k").state;
  const pasted = reduce(open, { paste: "dev-c\nenter", read: ++reads, ...AT });
  assert.deepEqual([pasted.state.palette.query, pasted.effect, rows(pasted.state)], ["dev-c", null, ["instance dev-c"]]);
  // A paste in the read that opened it is the query's too, and an Enter with it runs nothing.
  const read = ++reads, same = reduce(key(THREE(), "ctrl+k", read).state, { paste: "dev", read, ...AT }).state;
  assert.equal(same.palette.query, "dev");
  assert.deepEqual([key(same, "enter", read).state, key(same, "enter", read).effect], [same, null]);
});

test("Ctrl+K opens the palette from the list and Ctrl+K again closes it; Esc closes it; Ctrl+C still quits while it is open, and q is the query's", () => {
  const state = THREE(), read = ++reads;
  const open = key(state, "ctrl+k", read);
  assert.deepEqual([open.state.palette, open.effect], [{ query: "", selected: null, top: 0, read, from: "list" }, null]);
  for (const close of ["ctrl+k", "escape"]) assert.deepEqual([butLeader(key(open.state, close).state), key(open.state, close).effect], [butLeader(state), null], close);
  assert.deepEqual([key(open.state, "ctrl+c").state, key(open.state, "ctrl+c").effect], [open.state, "quit"]);
  assert.deepEqual([key(open.state, "q").state.palette.query, key(open.state, "q").effect], ["q", null]);
});

// ── The views of this machine ────────────────────────────────────────────────────────────────────

/** What showing a view asks of the loop: Souls, that its catalog be settled (docs/tui.md, "The
 *  Souls view"); Capabilities, that its table be settled and the souls catalog its Used by reads
 *  (docs/tui.md, "The Capabilities view"). */
const SHOWN_ASKS = Object.freeze({ souls: { souls: "settle" }, capabilities: { souls: "settle", capabilities: "settle" } });

test("2 and 3, plain or after the leader, show Souls and Capabilities from the list; Esc, 1 and the leader then 1 go back to the instances, the selection as it was", () => {
  const state = on(THREE(), "dev-c");
  for (const [k, view] of [["2", "souls"], ["3", "capabilities"]]) {
    for (const shown of [key(state, k), leaderThen(state, k, AT)]) {
      assert.deepEqual([shown.state.view, shown.state.back, shown.effect], [view, view, SHOWN_ASKS[view]], k);
      for (const back of [key(shown.state, "escape"), key(shown.state, "1"), leaderThen(shown.state, "1", AT), leaderThen(shown.state, "escape", AT)]) {
        assert.deepEqual([back.state.view, back.state.back, back.state.selected, back.effect], ["instances", "instances", state.selected, null], `${k}, then back`);
      }
    }
  }
});

test("with no workspace open, 2 and 3, plain or after the leader, show Souls and Capabilities from the switcher; Esc, 1 and the leader then 1 go back to the switcher", () => {
  const none = initialState({ deployment: null, cli: CLI, home: "/home/u" });
  assert.equal(none.view, "switcher");
  for (const [k, view] of [["2", "souls"], ["3", "capabilities"]]) {
    for (const shown of [key(none, k), leaderThen(none, k, AT)]) {
      assert.deepEqual([shown.state.view, shown.effect], [view, SHOWN_ASKS[view]], k);
      for (const back of [key(shown.state, "escape"), key(shown.state, "1"), leaderThen(shown.state, "1", AT), leaderThen(shown.state, "escape", AT)]) {
        assert.deepEqual([back.state.view, back.state.back, back.state.open, back.effect], ["switcher", "switcher", null, null], `${k}, then back`);
      }
    }
  }
  // The leader then 2 and 3 are not typed into the switcher's filter field.
  const typing = keys(none, "/", "a").state;
  assert.deepEqual([leaderThen(typing, "2", AT).state.view, leaderThen(typing, "2", AT).state.switcher.query, leaderThen(typing, "2", AT).state.switcher.editing], ["souls", "a", false]);
});

// ── From every view: the terminal's commands go to the Instances view ─────────────────────────────

/** What can be shown under a command, each reached from the list of THREE with dev-a selected and
 *  no terminal open: the views of this machine, the help, the switcher, a confirmation, a filter
 *  field being typed in. */
const SHOWN = Object.freeze([
  ["Souls", (s) => key(s, "2").state],
  ["Capabilities", (s) => key(s, "3").state],
  ["the help", (s) => key(s, "?").state],
  ["the switcher", (s) => key(s, "w").state],
  ["a restart confirmation", (s) => key(s, "R").state],
  ["the filter field", (s) => keys(s, "/", "d").state],
]);
/** The palette opened by the leader, `query` typed, its first row checked to be `label`'s, then
 *  Enter in a later read. -> the step */
function runFromPalette(state, query, label) {
  let s = key(leader(state).state, "k").state;
  for (const ch of query) s = key(s, ch).state;
  assert.equal(paletteItems(s).items[0]?.label ?? paletteItems(s).items[0]?.name, label, `${query}: the first row`);
  return key(s, "enter");
}
/** What a confirmation that was open under a command is told: closed (the loop's `dismiss`). */
const dismissed = (before, effect) => (before.act ? assert.equal(effect?.dismiss, before.act.n, "the confirmation is closed, the loop told") : undefined);

test("an instance run from the palette opens in the Instances view with the focus in its terminal, from any view: Souls, Capabilities, the help, the switcher, a confirmation (closed, the loop told) and a filter field (kept, as Enter keeps it)", () => {
  for (const [what, reach] of SHOWN) {
    const before = reach(on(THREE(), "dev-a"));
    const step = runFromPalette(before, "dev-c", "dev-c");
    assert.equal(step.effect?.open?.id, idOf(before, "dev-c"), what);
    assert.deepEqual([step.state.view, step.state.palette, step.state.act, step.state.terminal?.focus, step.state.filter.editing], ["instances", null, null, "terminal", false], what);
    assert.equal(step.state.selected, idOf(before, "dev-c"), `${what}: its row selected`);
    dismissed(before, step.effect);
  }
});

test("an act run from the palette opens its confirmation from any view, a confirmation that was open closed first and the loop told; Esc then gives the Instances view", () => {
  for (const [what, reach] of SHOWN) {
    const before = reach(on(THREE(), "dev-a"));
    const step = runFromPalette(before, "stop", "Stop");
    assert.deepEqual([step.state.view, step.state.act?.verb, step.state.act?.id, step.state.palette, step.state.filter.editing], ["act", "stop", idOf(before, "dev-a"), null, false], what);
    assert.deepEqual(step.effect?.act?.verb, "stop", what);
    dismissed(before, step.effect);
    assert.equal(key(step.state, "escape").state.view, "instances", `${what}: Esc`);
  }
});

test("a view run from the palette over a confirmation closes it (the loop told), and over a filter field keeps the filter and ends the typing, so no field's keys stand in the view's footer", () => {
  const confirming = key(on(THREE(), "dev-a"), "R").state;
  const fromAct = runFromPalette(confirming, "souls", "Souls");
  assert.deepEqual([fromAct.state.view, fromAct.state.act, fromAct.effect], ["souls", null, { dismiss: confirming.act.n, souls: "settle" }]);
  const typing = keys(on(THREE(), "dev-a"), "/", "d", "e", "v").state;
  const fromField = runFromPalette(typing, "souls", "Souls");
  assert.deepEqual([fromField.state.view, fromField.state.filter.editing, fromField.state.filter.query], ["souls", false, "dev"]);
});

test("the leader then Down or Up opens the next or previous instance in the Instances view from any view, a palette over it too; at the end of the list nothing moves and the view stays", () => {
  for (const [what, reach] of SHOWN) {
    const before = reach(on(THREE(), "dev-a"));
    for (const [how, from] of [["", before], [" under the palette", key(leader(before).state, "k").state]]) {
      const step = key(leader(from).state, "down");
      assert.equal(step.effect?.open?.id, idOf(before, "dev-c"), `${what}${how}`);
      assert.deepEqual([step.state.view, step.state.palette, step.state.act, step.state.terminal?.focus, step.state.filter.editing], ["instances", null, null, "terminal", false], `${what}${how}`);
      dismissed(before, step.effect);
    }
    const atEnd = reach(on(THREE(), "dev-c"));
    const still = key(leader(atEnd).state, "down");
    assert.deepEqual([still.effect, still.state.view], [null, atEnd.view], `${what}: dev-b, the last row, cannot be opened, so nothing moves`);
  }
  const top = key(leader(key(on(THREE(), "dev-a"), "2").state).state, "up");
  assert.deepEqual([top.effect, top.state.view], [null, "souls"], "Up from the first row: nothing moves");
});

test("with a terminal open, the leader then z zooms it and the leader then w closes it from any view: the Instances view comes back, a confirmation closed and the loop told", () => {
  for (const [what, reach] of SHOWN) {
    const listed = twice(opened(THREE(), "dev-a")).state;
    assert.equal(listed.terminal.focus, "list");
    const before = reach(listed);
    const zoomed = key(leader(before).state, "z");
    assert.deepEqual([zoomed.state.view, zoomed.state.terminal?.focus, zoomed.state.terminal?.zoom, zoomed.state.act], ["instances", "terminal", true, null], `${what}: z`);
    dismissed(before, zoomed.effect);
    const closed = key(leader(before).state, "w");
    assert.deepEqual([closed.state.view, closed.state.terminal, closed.effect?.close], ["instances", null, [idOf(before, "dev-a")]], `${what}: w`);
    dismissed(before, closed.effect);
  }
});

test("with no workspace open the leader's terminal commands do nothing from the switcher: Down, Up, z and w", () => {
  const none = stateOf(null, { deployment: null, cli: ACTS_CLI });
  assert.equal(none.view, "switcher");
  for (const k of ["down", "up", "z", "w"]) {
    const step = key(leader(none).state, k);
    assert.deepEqual([step.state.view, step.effect], ["switcher", null], k);
  }
});
