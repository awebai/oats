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
    menuReason: () => overrides.menuReason ?? null,
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

