// Spec B (PR 5): a selected tab reveals its roster row. When the active terminal tab changes (a tab
// click or arrow, Ctrl+Tab, go to tab, a close's successor, another split group's tab), the roster
// scrolls just enough to show that instance's row and marks it selected, never taking focus. A click
// on the already-active tab reveals too; a re-projection of the same tab never does. Not while the
// sidebar is hidden or in focus mode; a row the filter hides means no scroll; under a collapsed parent
// the nearest shown ancestor's row is revealed. The shipped addTab, selectTab, activateTab and
// revealActiveRosterRow over a modelled list layout (jsdom has none).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { JSDOM } from "jsdom";
import { revealInScrollport } from "../renderer/reveal-in-scrollport.mjs";
import { createSelectionOwnership, wirePaneSelection } from "../renderer/selection-ownership.mjs";
import { createTabChrome } from "../renderer/tab-a11y.mjs";
import { canActivateTab } from "../renderer/workspace-tabs.mjs";
import { terminalKey } from "../renderer/instance-tree-view.mjs";
import { tabShowsRow, otherIncarnation } from "../renderer/retired-tabs.mjs";
import { instanceId, rosterParentId } from "../../client/instance-tree.mjs";
import { createInstanceRecency, recencyIdFromTerminalKey } from "../renderer/instance-recency.mjs";
import * as layout from "../renderer/split-layout.mjs";

const source = readFileSync(new URL("../renderer/shell.mjs", import.meta.url), "utf8");
const fn = name => {
  const found = source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`));
  assert.ok(found, `${name} is exercised from the shipped shell`);
  return found[0];
};

const ROW = 48, TOP = 60, HEIGHT = 120; // a 120px scrollport: two and a half rows
const inst = (name, extra = {}) => ({ instance: name, agent: "dev", agentsRoot: "/synthetic/agents", home: `/synthetic/agents/dev/instances/${name}`,
  running: true, tmux: { session: "synthetic", window: name }, ...extra });
const roster = [...["a0", "a1", "a2", "a3", "a4", "a5"].map(name => inst(name)), inst("lead"), inst("kid", { parentInstance: "lead" })];

function fixture(t) {
  const dom = new JSDOM(`<!doctype html><body><div id="app"><aside id="sidebar"><section id="instance-roster"><input class="ctx-filter"><div class="ctx-list"></div></section></aside>
    <main id="main"><div id="tabbar"></div><div id="tabhost"></div><input id="elsewhere"></main></div></body>`);
  t.after(() => dom.window.close());
  const doc = dom.window.document, list = doc.querySelector(".ctx-list");
  dom.window.HTMLElement.prototype.scrollIntoView = () => assert.fail("must not scroll ancestors");
  Object.defineProperties(list, { clientHeight: { value: HEIGHT, configurable: true }, clientTop: { value: 0, configurable: true } });
  list.getBoundingClientRect = () => ({ top: TOP, bottom: TOP + HEIGHT, height: HEIGHT });
  /** Paint the rows a roster render would show (those `shown` names, in order), each a ROW px box. */
  const paint = shown => {
    list.innerHTML = shown.map(name => `<div class="ctx-tree-row"><button class="ctx-inst" type="button" tabindex="-1" data-tree-instance="${instanceId(roster.find(i => i.instance === name))}">${name}</button></div>`).join("");
    list.querySelector(".ctx-inst").tabIndex = 0;
    [...list.querySelectorAll(".ctx-tree-row")].forEach((box, i) => {
      box.getBoundingClientRect = () => { const top = TOP + i * ROW - list.scrollTop; return { top, bottom: top + ROW, height: ROW }; };
    });
  };
  const c = {
    document: doc, navigator: { platform: "Linux x86_64" }, tabs: new Map(), nextTabId: 1, activeTab: null, split: null,
    tabbar: doc.getElementById("tabbar"), tabhost: doc.getElementById("tabhost"), tabLayerVisible: true, sidebarMode: "instances",
    currentWorkspace: () => "A", workspaceGeneration: () => 0, wsActiveTerminal: new Map(),
    // The palette's last-focus record (Spec C), inert here: the shell code under test writes to it.
    instanceRecency: createInstanceRecency({ storage: null }), recencyIdFromTerminalKey,
    createTabChrome, wirePaneSelection, canActivateTab, ...layout, onTabKeydown() {}, closeTab() {},
    setSidebarMode() {}, setNavActive() {}, refreshContextRoster() {}, showTabLayer() {}, renderSplit() {}, updateSplitControls() {}, revealActiveTabs() {},
    contextRosterEl: doc.getElementById("instance-roster"), contextWorkspace: "A", contextInstances: roster, contextFilter: "",
    terminalKey, instanceId, rosterParentId, revealInScrollport, tabShowsRow, otherIncarnation,
  };
  c.tabOpenIntents = createSelectionOwnership(c);
  const s = runInNewContext(`${["addTab", "selectTab", "activateTab", "revealActiveRosterRow"].map(fn).join("\n")}\n({ addTab, selectTab, activateTab });`, c);
  const ids = new Map();
  for (const i of roster) ids.set(i.instance, s.addTab({ title: i.instance, key: terminalKey("A", i), kind: "terminal", workspace: "A", instanceRef: i }).id);
  paint(["a0", "a1", "a2", "a3", "a4", "a5", "lead"]); // kid sits under lead, collapsed
  list.scrollTop = 0;
  const elsewhere = doc.getElementById("elsewhere"); elsewhere.focus();
  const rowOf = name => [...list.querySelectorAll(".ctx-inst")].find(r => r.textContent === name);
  const selected = () => [...list.querySelectorAll(".ctx-inst.active")].map(r => r.textContent);
  return { dom, doc, list, c, s, ids, paint, rowOf, selected, elsewhere, select: name => s.selectTab(ids.get(name)) };
}

test("activating a tab whose row is scrolled out reveals it by the smallest scroll, selected, and leaves focus where it was", t => {
  const u = fixture(t);
  assert.equal(u.select("a0"), true);
  assert.equal(u.list.scrollTop, 0, "row a0 is fully shown: no scroll");
  assert.equal(u.select("a5"), true);
  assert.equal(u.list.scrollTop, 6 * ROW - HEIGHT, "just enough to show a5's whole row at the bottom edge");
  assert.equal(u.doc.activeElement, u.elsewhere, "focus never moves to the roster");
  assert.deepEqual(u.selected(), ["a5"], "the row reads as selected at once");
  assert.ok(u.rowOf("a5").closest(".ctx-tree-row").classList.contains("active"));
  assert.equal(u.rowOf("a5").tabIndex, 0, "the roving stop follows the selection, without focus");
  assert.equal([...u.list.querySelectorAll('.ctx-inst[tabindex="0"]')].length, 1);
  assert.equal(u.select("a2"), true);
  assert.equal(u.list.scrollTop, 2 * ROW, "a2, above the scrollport, is brought to its top edge");
  assert.deepEqual(u.selected(), ["a2"]);
});

test("a fully visible row causes no scroll, and a re-projection of the same tab never moves the roster", t => {
  const u = fixture(t);
  u.select("a1");
  assert.equal(u.list.scrollTop, 0);
  u.list.scrollTop = 200; // the user scrolled the roster away
  u.s.activateTab(u.ids.get("a1"));
  u.s.activateTab(u.ids.get("a1"), { keepGroupFocus: true });
  assert.equal(u.list.scrollTop, 200, "a poll, resize or re-projection of the active tab leaves the roster where it is");
  u.c.tabs.get(u.ids.get("a1")).triggerEl.click();
  assert.equal(u.list.scrollTop, ROW, "a click on the already-active tab is a selection: it reveals");
});

test("focus inside the roster stays on its row; the roving stop does not move under it", t => {
  const u = fixture(t);
  u.rowOf("a0").focus();
  u.select("a4");
  assert.equal(u.doc.activeElement, u.rowOf("a0"));
  assert.equal(u.rowOf("a0").tabIndex, 0, "the focused row keeps the tab stop");
  assert.deepEqual(u.selected(), ["a4"]);
});

test("a row the filter hides stays hidden: no scroll and nothing selected", t => {
  const u = fixture(t);
  u.c.contextFilter = "a";
  u.paint(["a0", "a1", "a2", "a3", "a4"]); // a5 matches nothing the user typed (modelled)
  u.list.scrollTop = 30;
  u.select("a5");
  assert.equal(u.list.scrollTop, 30, "the filter is the user's: it is not cleared and nothing scrolls");
  assert.deepEqual(u.selected(), []);
  assert.equal(u.doc.activeElement, u.elsewhere);
});

test("a row under a collapsed parent reveals the nearest shown ancestor's row, without expanding it", t => {
  const u = fixture(t);
  u.select("a0"); u.select("kid");
  assert.equal(u.list.scrollTop, 7 * ROW - HEIGHT, "lead's row, the last one, is brought into view");
  assert.equal(u.rowOf("kid"), undefined, "the parent stays collapsed");
  assert.deepEqual(u.selected(), [], "the hidden row is the selected one; its parent does not pretend to be");
});

for (const mode of ["sidebar-hidden", "focus-mode"]) test(`nothing scrolls while ${mode === "focus-mode" ? "focus mode is on" : "the sidebar is hidden"}`, t => {
  const u = fixture(t);
  u.doc.getElementById("app").classList.add(mode);
  u.select("a5");
  assert.equal(u.list.scrollTop, 0);
  assert.deepEqual(u.selected(), ["a5"], "the selection is still current when the sidebar comes back");
});

test("every activation path goes through activateTab's change check", () => {
  const body = fn("activateTab");
  assert.match(body, /const before = activeTab;[^\n]*\n  activeTab = id;/);
  assert.match(body, /revealActiveTabs\(\);\n[^]*if \(before !== id\) revealActiveRosterRow\(current\);/);
});
