// Spec C: the command palette lists instances by last focus. Instances whose
// terminal was focused lead in a flat "Recent" group, most recent first; the
// rest follow in the sidebar's tree presentation, each instance once. The
// palette opens on the previous instance when the most recent is in front. The
// record is per-machine localStorage, scoped by workspace and exact identity.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { paletteRows, createPalette } from "../renderer/palette.mjs";
import { createInstanceRecency, recencyIdFromTerminalKey, RECENCY_STORAGE_KEY, RECENCY_CAP } from "../renderer/instance-recency.mjs";
import { terminalKey } from "../renderer/instance-tree-view.mjs";
import { instanceId, rosterGroups } from "../../client/instance-tree.mjs";
import { pickerCycleDirection } from "../renderer/keybindings.mjs";

const at = (instance, extra = {}) => ({ instance, agent: "dev", home: `/w/${instance}`, agentsRoot: "/w", running: true, ...extra });
// The palette-tree roster: two relation clusters and two unrelated instances, out of order.
const ROSTER = [
  at("solo-y", { running: false }),
  at("grandchild", { parentInstance: "child-a" }),
  at("lead"),
  at("child-b", { parentInstance: "lead", running: false }),
  at("alpha", { running: false }),
  at("solo-x"),
  at("child-a", { parentInstance: "lead" }),
  at("alpha-kid", { parentInstance: "alpha" }),
];
const TREE_ORDER = ["alpha", "alpha-kid", "lead", "child-a", "grandchild", "child-b", "solo-x", "solo-y"];
const byName = name => ROSTER.find(i => i.instance === name);
const WS = "ws-one";

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k), map };
}
/** A store fed through the shell's own key path: the terminal tab key of each focused instance. */
function focused(names, { workspace = WS, storage = memoryStorage() } = {}) {
  let clock = 1000;
  const store = createInstanceRecency({ storage, now: () => clock++ });
  for (const name of names) store.record(workspace, recencyIdFromTerminalKey(workspace, terminalKey(workspace, byName(name))));
  return { store, storage };
}
const instanceRows = rows => rows.filter(row => row.group);
const RECENT_LABEL = "Recent";

test("focusing A, then B, then C lists C, B, A in Recent, then the never-focused in tree order", () => {
  const { store } = focused(["solo-x", "child-a", "alpha"]);
  const rows = instanceRows(paletteRows({ instances: ROSTER, deployments: [], recent: store.snapshot(WS) }, [], "", { openTerminal() {} }));
  assert.deepEqual(rows.filter(r => r.group.label === RECENT_LABEL).map(r => r.label), ["alpha", "child-a", "solo-x"]);
  assert.deepEqual(rows.map(r => r.label), ["alpha", "child-a", "solo-x", ...TREE_ORDER.filter(n => !["alpha", "child-a", "solo-x"].includes(n))],
    "each instance once: the recent ones leave the tree");
  const recent = rows.slice(0, 3);
  assert.ok(recent.every(r => r.depth === 0 && r.recent && typeof r.run === "function"), "flat, and each opens");
  assert.deepEqual(recent.map(r => [r.under || null, !!r.showUnder]), [[null, false], ["under lead", true], [null, false]],
    "relation context as words, shown for a recent row with a parent");
  // The rest keep the sidebar's groups and depth (an orphaned child keeps its indentation).
  assert.deepEqual(rows.slice(3).map(r => [r.group.label, r.label, r.depth]), [
    ["alpha", "alpha-kid", 1], ["lead", "lead", 0], ["lead", "grandchild", 2], ["lead", "child-b", 1], ["independent", "solo-y", 0],
  ]);
});

test("the palette opens on the second recent entry when the most recent is the terminal in front", () => {
  const { store } = focused(["solo-x", "lead"]);
  const recent = store.snapshot(WS);
  const roster = activeId => ({ instances: ROSTER, deployments: [], recent, activeId });
  const front = paletteRows(roster(instanceId(byName("lead"))), [], "", { openTerminal() {} });
  assert.deepEqual(front.filter(r => r.initial).map(r => r.label), ["solo-x"], "⌘K then Enter returns to the previous agent");
  assert.deepEqual(paletteRows(roster(instanceId(byName("solo-x"))), [], "", {}).filter(r => r.initial), [], "the front terminal is not the most recent: first row");
  assert.deepEqual(paletteRows(roster(null), [], "", {}).filter(r => r.initial), [], "no terminal in front: first row");
  assert.deepEqual(paletteRows(roster(instanceId(byName("lead"))), [], "o", {}).filter(r => r.initial), [], "a query starts on its first match");
  const one = focused(["lead"]).store.snapshot(WS);
  assert.deepEqual(paletteRows({ instances: ROSTER, recent: one, activeId: instanceId(byName("lead")) }, [], "", {}).filter(r => r.initial), [],
    "only the front terminal is recent: first row, as today");
});

function palette(t, data) {
  const dom = new JSDOM('<!doctype html><body><button id="opener">Open</button></body>', { url: "http://localhost" });
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const opened = [];
  const picker = createPalette({ loadInstances: async () => data, openTerminal: ref => opened.push(ref.instance), commands: [],
    cycleKey: e => pickerCycleDirection(e, "app.palette", true), doc });
  t.after(() => picker.close());
  doc.getElementById("opener").focus();
  const key = (key, mods = {}) => doc.activeElement.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods }));
  const input = () => doc.querySelector(".palette-input");
  const active = () => doc.getElementById(input().getAttribute("aria-activedescendant"))?.querySelector(".plabel").textContent;
  const filter = value => { input().value = value; input().dispatchEvent(new dom.window.Event("input", { bubbles: true })); };
  return { doc, picker, opened, key, active, filter };
}

test("rendered: one named Recent group first, opened on the previous instance; ⌘K, Enter goes back; the chord still cycles", async t => {
  const { store } = focused(["solo-x", "child-a", "lead"]);
  const p = palette(t, { instances: ROSTER, deployments: [], recent: store.snapshot(WS), activeId: instanceId(byName("lead")) });
  await p.picker.open();
  const groups = [...p.doc.querySelectorAll('[role="listbox"] > [role="group"]')];
  assert.equal(groups[0].getAttribute("aria-label"), "Recent", "announced once on entry, like the relation groups");
  assert.deepEqual([...groups[0].children].map(o => o.querySelector(".plabel").textContent), ["lead", "child-a", "solo-x"]);
  assert.deepEqual(groups.slice(1).map(g => g.getAttribute("aria-label")), ["alpha", "lead", "independent"]);
  const childA = groups[0].children[1];
  assert.equal(childA.style.getPropertyValue("--depth"), "", "flat: no indentation");
  assert.equal(childA.querySelector(".sr-only").textContent, ", under lead", "the option still reads \"…, under <parent>\"");
  const shown = childA.querySelector(".punder");
  assert.equal(shown.textContent, "under lead");
  assert.equal(shown.getAttribute("aria-hidden"), "true", "shown quietly, read once");
  assert.equal(p.active(), "child-a", "opens on the second recent entry");
  p.key("k", { metaKey: true }); assert.equal(p.active(), "solo-x", "the cycle chord is unchanged");
  p.key("k", { metaKey: true, shiftKey: true }); p.key("Enter");
  assert.deepEqual(p.opened, ["child-a"]);
});

test("with a query: matching recent instances first, most recent first, then the remaining matches in tree order with context", async t => {
  const { store } = focused(["child-b", "lead", "solo-x"]);
  const roster = { instances: ROSTER, deployments: [], recent: store.snapshot(WS) };
  const rows = paletteRows(roster, [{ label: "Child command", run() {} }], "child", { openTerminal() {} });
  assert.deepEqual(rows.map(r => [r.group?.label ?? null, r.label, !!r.context]), [
    ["Recent", "child-b", false],
    // lead is recent but no match: a context row of the tree, never in Recent.
    ["lead", "lead", true], ["lead", "child-a", false], ["lead", "grandchild", false],
    [null, "Child command", false],
  ], "recent matches lead; commands follow");
  // A recent match that is the ancestor of a non-recent match is that match's context in the tree.
  const kid = paletteRows({ instances: ROSTER, recent: focused(["alpha"]).store.snapshot(WS) }, [], "alpha", { openTerminal() {} });
  assert.deepEqual(kid.map(r => [r.group.label, r.label, !!r.context, typeof r.run]), [
    ["Recent", "alpha", false, "function"], ["alpha", "alpha", true, "undefined"], ["alpha", "alpha-kid", false, "function"],
  ]);
  // Every match recent: the tree adds nothing.
  assert.deepEqual(instanceRows(paletteRows(roster, [], "solo-x", {})).map(r => [r.group.label, r.label]), [["Recent", "solo-x"]]);
  const p = palette(t, roster);
  await p.picker.open();
  p.filter("child");
  assert.equal(p.active(), "child-b", "the first match, recent first");
  p.filter(">");
  assert.equal(p.doc.querySelector('[role="group"]'), null, "'>' still restricts to commands");
});

test("a recent row's parent is the tree's: a retired or cross-deployment parent name is not shown", () => {
  // The sidebar and the palette's tree resolve a parent by identity (#482); a raw
  // parentInstance that resolves to nothing, or to another deployment, is no parent.
  const orphan = at("child", { parentInstance: "retired-parent" });
  const recent = new Map([[instanceId(orphan), 1]]);
  const [row] = instanceRows(paletteRows({ instances: [orphan], recent }, [], "", {}));
  assert.deepEqual([row.label, row.under ?? null, !!row.showUnder], ["child", null, false]);
  const D1 = { id: "/a", machine: "This Mac", path: "/a", label: "~/a", local: true, reachable: true, primary: true };
  const D2 = { id: "remote:altair:b", machine: "altair", path: "/b", label: "~/b", local: false, reachable: true, primary: false };
  const lead = { ...at("lead"), deployment: { id: D1.id } };
  const kid = { ...at("kid", { home: "/b/kid", agentsRoot: "/b", parentInstance: "lead" }), deployment: { id: D2.id } };
  const rows = instanceRows(paletteRows({ instances: [lead, kid], deployments: [D1, D2], recent: new Map([[instanceId(kid), 1]]) }, [], "", {}));
  assert.deepEqual(rows.filter(r => r.recent).map(r => [r.label, r.under ?? null]), [["kid", null]]);
});

test("an entry for an instance no longer in the roster is not listed", () => {
  const { store } = focused(["solo-x", "lead"]);
  const gone = ROSTER.filter(i => i.instance !== "lead");
  const rows = instanceRows(paletteRows({ instances: gone, recent: store.snapshot(WS), activeId: instanceId(byName("lead")) }, [], "", {}));
  assert.deepEqual(rows.filter(r => r.recent).map(r => r.label), ["solo-x"]);
  assert.equal(rows.filter(r => r.label === "lead").length, 0);
  assert.deepEqual(rows.filter(r => r.initial), [], "the gone front terminal does not shift the opening row");
});

test("workspace scoping: entries live under their workspace and the exact identity", () => {
  const storage = memoryStorage();
  let clock = 1;
  const store = createInstanceRecency({ storage, now: () => clock++ });
  const here = at("twin"), other = at("twin", { home: "/v/twin", agentsRoot: "/v" });
  store.record("ws-a", recencyIdFromTerminalKey("ws-a", terminalKey("ws-a", here)));
  store.record("ws-b", recencyIdFromTerminalKey("ws-b", terminalKey("ws-b", other)));
  assert.deepEqual([...store.snapshot("ws-a").keys()], [instanceId(here)]);
  assert.deepEqual([...store.snapshot("ws-b").keys()], [instanceId(other)]);
  assert.deepEqual([...store.snapshot("ws-c").keys()], []);
  const rows = instanceRows(paletteRows({ instances: [here, other], recent: store.snapshot("ws-a") }, [], "", {}));
  assert.deepEqual(rows.map(r => [r.label, !!r.recent, r.run && "x"]), [["twin", true, "x"], ["twin", false, "x"]],
    "a same-named instance of another agents root is a different entry");
  assert.equal(recencyIdFromTerminalKey("ws-a", terminalKey("ws-b", here)), null, "another workspace's tab key records nothing here");
  assert.equal(recencyIdFromTerminalKey("", terminalKey("", here)), instanceId(here), "the unbound workspace keys as \"\"");
});

test("persistence: a round trip through storage survives a new store (an app restart); one key, capped per workspace", () => {
  const { storage } = focused(["solo-x", "child-a", "alpha"]);
  assert.deepEqual([...storage.map.keys()], [RECENCY_STORAGE_KEY]);
  const restarted = createInstanceRecency({ storage });
  assert.deepEqual([...restarted.snapshot(WS).keys()], ["alpha", "child-a", "solo-x"].map(n => instanceId(byName(n))));
  let clock = 1;
  const store = createInstanceRecency({ storage, now: () => clock++ });
  for (let i = 0; i < RECENCY_CAP + 5; i++) store.record("big", `/w/i-${i}`);
  const kept = [...createInstanceRecency({ storage }).snapshot("big").keys()];
  assert.equal(kept.length, RECENCY_CAP);
  assert.equal(kept[0], `/w/i-${RECENCY_CAP + 4}`, "the most recent kept");
  assert.equal(kept.includes("/w/i-0"), false, "the oldest dropped");
  assert.equal(restarted.snapshot(WS).size, 3, "other workspaces untouched");
  // Same millisecond: still strictly ordered.
  const tied = createInstanceRecency({ storage: memoryStorage(), now: () => 5 });
  tied.record(WS, "a"); tied.record(WS, "b");
  assert.deepEqual([...tied.snapshot(WS).keys()], ["b", "a"]);
});

test("a corrupt or foreign stored value reads as empty, and recording repairs it", () => {
  for (const raw of ["{not json", "[1,2]", "null", "42", JSON.stringify({ [WS]: "x" }), JSON.stringify({ [WS]: { "/w/a": "soon", "/w/b": -1, "": 5 } })]) {
    const storage = memoryStorage({ [RECENCY_STORAGE_KEY]: raw });
    const store = createInstanceRecency({ storage, now: () => 10 });
    assert.equal(store.snapshot(WS).size, 0, raw);
    store.record(WS, "/w/c");
    assert.deepEqual([...store.snapshot(WS).keys()], ["/w/c"], raw);
  }
  const throwing = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
  const store = createInstanceRecency({ storage: throwing });
  assert.doesNotThrow(() => store.record(WS, "/w/a"));
  assert.equal(store.snapshot(WS).size, 0);
  const none = createInstanceRecency({ storage: null });
  none.record(WS, "/w/a");
  assert.equal(none.snapshot(WS).size, 0);
});

test("a re-homed workspace's entries follow it, the newer time winning", () => {
  const storage = memoryStorage();
  let clock = 1;
  const store = createInstanceRecency({ storage, now: () => clock++ });
  store.record("old", "/w/a"); store.record("new", "/w/a"); store.record("old", "/w/b");
  store.rehome(new Map([["old", "new"]]));
  assert.deepEqual([...store.snapshot("new")], [["/w/b", 3], ["/w/a", 2]]);
  assert.equal(store.snapshot("old").size, 0);
});

test("the sidebar roster keeps its stable order: recency reaches only the palette", () => {
  const before = rosterGroups(ROSTER, ROSTER).flatMap(g => g.clusters.flatMap(c => c.instances.map(i => i.instance)));
  const copy = ROSTER.slice();
  paletteRows({ instances: ROSTER, recent: focused(["solo-y", "lead"]).store.snapshot(WS) }, [], "", {});
  assert.deepEqual(ROSTER, copy, "the roster snapshot is not reordered");
  assert.deepEqual(rosterGroups(ROSTER, ROSTER).flatMap(g => g.clusters.flatMap(c => c.instances.map(i => i.instance))), before);
  const shell = readFileSync(new URL("../renderer/shell.mjs", import.meta.url), "utf8");
  assert.equal(shell.match(/instanceRecency\.snapshot\(/g)?.length, 1, "read once: by the palette's loader");
  assert.match(shell, /const recent = instanceRecency\.snapshot\(ws\);[\s\S]{0,400}return \{ instances: p\.instances \|\| \[\], deployments: panelDeployments\(p\), recent, activeId \}/);
  assert.match(shell, /function activateTab\([\s\S]*?instanceRecency\.record\(current\.workspace, recencyIdFromTerminalKey\(current\.workspace, current\.key\)\)[\s\S]*?\n\}/,
    "recorded at the one activation seam");
});
