// What the leader's keys, and the sidebar's plain keys, mean in the Desktop (docs/desktop-keyboard.md,
// "The leader", "Sidebar keys"): the rows that apply now and their words (renderer/leader-keys.mjs),
// and what each `does` runs (leader-dispatch.mjs): the target, previous/next over the roster as
// drawn, the acts as the row's menu offers them, N, Esc. Pure: no DOM.
import test from "node:test";
import assert from "node:assert/strict";
import {
  leaderApplies, leaderRowsNow, leaderLabel, keyIdCaps, rowKeysText, supportedLeaderRows, LEADER_ACTIONS,
} from "../renderer/leader-keys.mjs";
import { createLeaderDispatch, rosterStep, actAvailability, NO_TARGET } from "../renderer/leader-dispatch.mjs";
import { LEADER_TABLE } from "../../client/keymap.mjs";
import { createLeader } from "../renderer/leader.mjs";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const shellSource = readFileSync(new URL("../renderer/shell.mjs", import.meta.url), "utf8");
/** A shipped shell.mjs function, to run here with its free names handed in. */
function shellFunction(name, context) {
  const source = shellSource.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))?.[0];
  assert.ok(source, `execute the shipped ${name}`);
  return runInNewContext(`${source}; ${name};`, context);
}

const STATE = { terminalOpen: true, tabs: 2, canSplitRow: true, canSplitCol: true, split: true };
test("the hint's rows: terminal rows with a terminal, tab keys with two tabs, split keys as the layer allows, never m", () => {
  const does = (state) => leaderRowsNow(state).map(row => row.does);
  assert.deepEqual(does(STATE), LEADER_TABLE.map(row => row.does).filter(d => d !== "tab-move"));
  const none = does({});
  assert.deepEqual(none, ["palette", "instances", "souls", "capabilities", "previous", "next", "stop", "restart", "start", "retire", "spawn", "spawn-another", "filter", "workspaces", "help", "list"]);
  assert.ok(!does({ ...STATE, tabs: 1 }).includes("tab-previous") && !does({ ...STATE, tabs: 1 }).includes("tab-next"));
  assert.ok(!does({ ...STATE, canSplitRow: false }).includes("split-right") && does({ ...STATE, canSplitRow: false }).includes("split-down"));
  assert.ok(!does({ ...STATE, split: false }).includes("group-next") && !does({ ...STATE, split: false }).includes("group-close"));
  assert.ok(does({ ...STATE, split: false }).includes("zoom") && does({ ...STATE, split: false }).includes("close-terminal"));
  assert.equal(leaderApplies({ does: "tab-move", terminal: true }, STATE), false);
  assert.deepEqual(supportedLeaderRows().map(row => row.does).includes("tab-move"), false);
});

test("labels: a key that runs one action shows that action's label; the rest the Desktop's words", () => {
  const labels = { "app.palette": "Open the command palette", "split.close": "Close the split (single pane)" };
  assert.equal(leaderLabel("palette", id => labels[id]), "Open the command palette");
  assert.equal(leaderLabel("group-close", id => labels[id]), "Close the split (single pane)");
  assert.equal(leaderLabel("list"), "Instance roster");
  assert.equal(leaderLabel("capabilities"), "Workspace › Capabilities");
  for (const row of supportedLeaderRows()) assert.ok(leaderLabel(row.does) && leaderLabel(row.does) !== row.does || LEADER_ACTIONS[row.does], `${row.does} has words`);
});

test("keys as caps: n and N are told apart, Space and the arrows are named", () => {
  assert.deepEqual(keyIdCaps("n", false), ["N"]);
  assert.deepEqual(keyIdCaps("N", false), ["Shift", "N"]);
  assert.deepEqual(keyIdCaps("N", true), ["⇧", "N"]);
  assert.deepEqual(keyIdCaps("space", false), ["Space"]);
  assert.deepEqual(keyIdCaps("up", false), ["↑"]);
  assert.deepEqual(keyIdCaps("escape", false), ["Esc"]);
  assert.deepEqual(keyIdCaps("|", false), ["|"]);
  assert.equal(rowKeysText(LEADER_TABLE[0], false), "K or Space");
});

// ---------------------------------------------------------------- what each key does

const inst = (name, extra = {}) => ({ instance: name, home: `/h/${name}`, agent: `${name}-soul`, agentsRoot: "/agents", running: true, ...extra });
test("previous/next: the roster as drawn, unopenable rows passed over, no wrap", () => {
  const rows = [{ id: "a", openable: true }, { id: "b", openable: false }, { id: "c", openable: true }, { id: "d", openable: false }];
  assert.equal(rosterStep(rows, "a", 1).id, "c", "b is passed over");
  assert.equal(rosterStep(rows, "c", -1).id, "a");
  assert.equal(rosterStep(rows, "c", 1), null, "no wrap past the end");
  assert.equal(rosterStep(rows, "a", -1), null, "no wrap past the start");
  assert.equal(rosterStep(rows, null, 1).id, "a", "no target: Down opens the first openable row");
  assert.equal(rosterStep(rows, null, -1).id, "c", "no target: Up the last");
  assert.equal(rosterStep(rows, "gone", 1).id, "a", "a target not drawn counts as none");
});

test("acts: offered exactly as the row's menu offers them, else one line why", () => {
  assert.deepEqual(actAvailability(inst("a"), "stop"), { ok: true });
  assert.deepEqual(actAvailability(inst("a"), "restart"), { ok: true });
  assert.match(actAvailability(inst("a"), "start").reason, /already running/);
  assert.deepEqual(actAvailability(inst("a", { running: false }), "start"), { ok: true });
  assert.match(actAvailability(inst("a", { running: false }), "restart").reason, /stopped/);
  assert.match(actAvailability(inst("a", { running: null }), "start").reason, /not known/);
  assert.deepEqual(actAvailability(inst("a", { running: null }), "retire"), { ok: true });
  assert.ok(actAvailability(inst("a", { server: "box", addressable: false }), "stop").reason, "an unaddressable row offers nothing");
  assert.deepEqual(actAvailability(inst("a"), "stop", "Waiting for a fresh roster."), { reason: "Waiting for a fresh roster." }, "the menu's own block");
});

function dispatchRig(overrides = {}) {
  const calls = [];
  const rows = overrides.rows ?? [];
  const byId = new Map((overrides.instances ?? []).map(i => [i.instance, i]));
  const op = name => (...args) => calls.push([name, ...args]);
  const d = createLeaderDispatch({
    say: op("say"), targetId: o => o.targetId ?? null, target: o => byId.get(o.targetId) ?? null,
    rosterRows: () => rows.map(row => ({ ...row, open: () => calls.push(["open", row.id]) })),
    menuReason: i => (typeof overrides.menuReason === "function" ? overrides.menuReason(i) : overrides.menuReason ?? null),
    openAct: (verb, i) => calls.push(["act", verb, i.instance]), spawnSoul: i => calls.push(["spawn-soul", i.agent]),
    ...Object.fromEntries(["palette", "instances", "souls", "capabilities", "zoom", "closeTab", "tabPrevious", "tabNext", "splitRight",
      "splitDown", "nextGroup", "closeSplit", "quickOpen", "filter", "workspaces", "help", "list", "refresh"].map(n => [n, op(n)])),
  });
  return { d, calls };
}

test("dispatch: Up/Down open the neighbour's terminal; acts open the menu's dialog or say why; N spawns the target's soul; Esc the roster", () => {
  const instances = [inst("a"), inst("b", { running: false }), inst("c")];
  const { d, calls } = dispatchRig({ instances, rows: [{ id: "a", openable: true }, { id: "b", openable: false }, { id: "c", openable: true }] });
  d.run("next", { targetId: "a" });
  d.run("previous", { targetId: "a" });
  d.run("stop", { targetId: "a" });
  d.run("start", { targetId: "b" });
  d.run("restart", { targetId: "b" });
  d.run("retire", {});
  d.run("spawn-another", { targetId: "c" });
  d.run("spawn-another", {});
  d.run("list", {});
  d.run("palette", {});
  d.run("capabilities", {});
  assert.deepEqual(calls, [
    ["open", "c"],
    ["say", "No instance above this one has a terminal to open."],
    ["act", "stop", "a"],
    ["act", "start", "b"],
    ["say", "b is stopped: Start it instead."],
    ["say", NO_TARGET],
    ["spawn-soul", "c-soul"],
    ["say", NO_TARGET],
    ["list"], ["palette"], ["capabilities"],
  ]);
  assert.equal(d.supports("tab-move"), false, "m is not the Desktop's");
  for (const row of supportedLeaderRows()) assert.ok(d.supports(row.does), row.does);
  assert.ok(d.supports("refresh"), "the sidebar's r");
});

test("dispatch: an act the menu would not offer runs nothing and says why", () => {
  const { d, calls } = dispatchRig({ instances: [inst("a")], menuReason: "This roster is out of date." });
  d.run("stop", { targetId: "a" });
  assert.deepEqual(calls, [["say", "This roster is out of date."]]);
});


// The row menu's own block is read from the roster's state (a stale roster, a stale deployment's row),
// not from a drawn trigger: a target the filter or a collapse leaves undrawn is held the same.
test("the shell's menu block holds a stale target's acts whether or not its row is drawn", () => {
  assert.match(shellSource, /\n  menuReason: rosterActsHeld,\n/, "the dispatch reads it");
  const stale = { rosterStale: false, deploymentStale: false };
  const context = { ROSTER_STALE_TITLE: "Waiting for a fresh roster.", contextDeployments: [],
    rowStale: () => stale.deploymentStale, contextWorkspace: "ws", currentWorkspace: () => "ws",
    pendingActionReason: () => stale.pending ?? null /* the menu's own act in flight: instance-actions.test.mjs */ };
  Object.defineProperty(context, "rosterStale", { get: () => stale.rosterStale });
  const held = shellFunction("rosterActsHeld", context);
  const { d, calls } = dispatchRig({ instances: [inst("a")], menuReason: held, rows: [] /* a's row is not drawn */ });
  d.run("stop", { targetId: "a" });
  stale.rosterStale = true;
  d.run("stop", { targetId: "a" });
  d.run("retire", { targetId: "a" });
  stale.rosterStale = false; stale.deploymentStale = true;
  d.run("restart", { targetId: "a" });
  stale.deploymentStale = false; stale.pending = "Waiting for Open pull request to finish";
  d.run("stop", { targetId: "a" });
  assert.deepEqual(calls, [["act", "stop", "a"], ["say", "Waiting for a fresh roster."], ["say", "Waiting for a fresh roster."], ["say", "Waiting for a fresh roster."],
    ["say", "Waiting for Open pull request to finish"]]);
});

// A key from the table that cannot act now settles and says why (never silently); m, which the
// Desktop has no operation for, and a key outside the table cancel.
test("a leader key whose row does not apply now says why; only an unsupported key cancels silently", () => {
  assert.match(shellSource, /\n  supports: does => leaderDispatch\.supports\(does\),\n/);
  assert.match(shellSource, /onSettle: \(does, origin\) => \{ const why = notApplicable\(does\); if \(why\) sayInHint\(why\); else leaderDispatch\.run\(does, origin\); \},/);
  let state = {};
  const why = shellFunction("notApplicable", { LEADER_TABLE, leaderApplies, leaderState: () => state });
  assert.equal(why("zoom"), "No terminal tab is open.");
  assert.equal(why("split-right"), "No terminal tab is open.");
  state = { ...STATE, canSplitRow: false };
  assert.equal(why("split-right"), "The active tab can't be split that way now.");
  assert.equal(why("split-down"), null);
  state = { ...STATE, tabs: 1 };
  assert.equal(why("tab-next"), "There is no other tab.");
  state = { ...STATE, split: false };
  assert.equal(why("group-close"), "The tabs are not split.");
  assert.equal(why("palette"), null);
  assert.equal(why("refresh"), null, "a sidebar-only key has no row");
});

// The leader's ↑ / ↓ / z on chords of their own (packages/client/keymap.mjs CHORDS previous, next,
// zoom): roster.openPrevious, roster.openNext and terminal.zoom run the shipped runAsLeaderKey, as the
// sidebar keys do. Driven here beside the leader's own settle (onSettle, as shipped and pinned above,
// with the origin leader.start gets: the target where the key was pressed), over one roster.
test("roster.openPrevious, roster.openNext and terminal.zoom run what the leader's ↑, ↓ and z run", () => {
  assert.match(shellSource, /for \(const \[id, does\] of \[\["roster\.openPrevious", "previous"\], \["roster\.openNext", "next"\], \["terminal\.zoom", "zoom"\]\]\) \{\n  registerAction\(\{ id, label: leaderLabel\(does, actionLabel\), context: "global", when: \(\) => !modalOpen\(\), run: \(e\) => runAsLeaderKey\(does, e\) \}\);/);
  assert.match(shellSource, /const at = e\?\.target \?\? document\.activeElement; leader\.start\(\{ targetId: leaderTargetId\(at\) \}\)/);
  assert.deepEqual(["previous", "next", "zoom"].map(does => leaderLabel(does)),
    ["Open the previous instance's terminal", "Open the next instance's terminal", "Focus mode on or off, in the active terminal"]);
  const calls = [];
  const rows = ["a", "b", "c"].map(id => ({ id, openable: id !== "b", open: () => calls.push(["open", id]) }));
  const d = createLeaderDispatch({ say: line => calls.push(["say", line]), targetId: origin => origin.targetId ?? null,
    target: () => null, rosterRows: () => rows, zoom: () => calls.push(["zoom"]) });
  let state = STATE;
  const notApplicable = shellFunction("notApplicable", { LEADER_TABLE, leaderApplies, leaderState: () => state });
  const leaderTargetId = el => el?.instance ?? null;
  const sayInHint = line => calls.push(["say", line]);
  const runAsLeaderKey = shellFunction("runAsLeaderKey", { notApplicable, sayInHint, leaderDispatch: d, leaderTargetId, document: { activeElement: null } });
  const viaLeader = (does, at) => { const why = notApplicable(does); if (why) sayInHint(why); else d.run(does, { targetId: leaderTargetId(at) }); };
  const both = (does, at) => {
    calls.length = 0; viaLeader(does, at); const leader = [...calls];
    calls.length = 0; runAsLeaderKey(does, { target: at });
    assert.deepEqual(calls, leader, `${does} from ${at?.instance ?? "no target"}`);
    return leader;
  };
  assert.deepEqual(both("next", { instance: "a" }), [["open", "c"]], "b is passed over");
  assert.deepEqual(both("previous", { instance: "c" }), [["open", "a"]]);
  assert.deepEqual(both("previous", null), [["open", "c"]], "no target: the last");
  assert.deepEqual(both("next", { instance: "c" }), [["say", "No instance below this one has a terminal to open."]]);
  assert.deepEqual(both("zoom", { instance: "a" }), [["zoom"]]);
  state = {};
  assert.deepEqual(both("zoom", null), [["say", "No terminal tab is open."]]);
});

// The consumed follow-up is consumed whole, each phase, until its own keyup, whatever else goes down
// meanwhile (rollover, a modifier). Node's EventTarget stands in for the window: no DOM needed.
function leaderRig() {
  const win = new EventTarget();
  win.document = { activeElement: null, body: {}, documentElement: {} };
  const settled = [];
  const leader = createLeader({ win, isMac: false, onSettle: does => settled.push(does) });
  const fire = (type, init) => { const e = new Event(type, { cancelable: true }); Object.assign(e, init); win.dispatchEvent(e); return e; };
  return { win, leader, settled, fire };
}
const DOWN = { key: "ArrowDown", code: "ArrowDown" }, SHIFT = { key: "Shift", code: "ShiftLeft" };
const K = { key: "k", code: "KeyK" }, J = { key: "j", code: "KeyJ" };

test("rollover: another key going down while the follow-up is held releases none of it", t => {
  const r = leaderRig();
  t.after(() => r.leader.dispose());
  r.leader.start({});
  assert.equal(r.fire("keydown", DOWN).defaultPrevented, true);
  assert.deepEqual(r.settled, ["next"]);
  assert.equal(r.fire("keydown", SHIFT).defaultPrevented, false, "the modifier is the focused control's");
  assert.equal(r.fire("keydown", { ...DOWN, repeat: true }).defaultPrevented, true, "Down's repeats stay consumed");
  assert.equal(r.fire("keyup", SHIFT).defaultPrevented, false);
  assert.equal(r.fire("keyup", DOWN).defaultPrevented, true, "and its keyup");
  assert.equal(r.fire("keydown", DOWN).defaultPrevented, false, "released: the next Down is the control's");
  r.fire("keyup", DOWN);
  // A character follow-up, then another character while it is held: that one types; k stays consumed.
  r.leader.start({});
  assert.equal(r.fire("keydown", K).defaultPrevented, true);
  assert.equal(r.fire("keypress", K).defaultPrevented, true, "its keypress");
  assert.equal(r.fire("keydown", J).defaultPrevented, false);
  assert.equal(r.fire("keypress", J).defaultPrevented, false, "j's keypress is j's");
  assert.equal(r.fire("keydown", { ...K, repeat: true }).defaultPrevented, true);
  assert.equal(r.fire("keyup", J).defaultPrevented, false);
  assert.equal(r.fire("keyup", K).defaultPrevented, true);
  assert.deepEqual(r.settled, ["next", "palette"]);
});

test("a window blur, which loses keyups, releases the consumed keys", t => {
  const r = leaderRig();
  t.after(() => r.leader.dispose());
  r.leader.start({});
  assert.equal(r.fire("keydown", K).defaultPrevented, true);
  r.win.dispatchEvent(new Event("blur"));
  assert.equal(r.fire("keydown", { ...K, repeat: true }).defaultPrevented, false);
  assert.equal(r.fire("keyup", K).defaultPrevented, false);
});
