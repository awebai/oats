// Real shipped shell close/select/open/restore and terminal lifecycle; only
// xterm, IPC and panel responses are synthetic. No processes or live sessions.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { JSDOM } from "jsdom";
import { createSelectionOwnership, wirePaneSelection } from "../renderer/selection-ownership.mjs";
import { createIntentGate } from "../renderer/open-intent.mjs";
import { createTerminalTab, terminalOptions } from "../renderer/terminal-tab.mjs";
import { createTabChrome, tabKeyAction, focusAfterLastTab } from "../renderer/tab-a11y.mjs";
import { reserveKey, whenKeyFree } from "../renderer/tab-keys.mjs";
import { resolveTerminalOpen } from "../renderer/instance-tree.mjs";
import { createWorkspaceTabMemory } from "../renderer/workspace-tab-memory.mjs";
import { projectSplitDom } from "../renderer/split-dom.mjs";
import { DEFAULT_KEYMAP } from "../renderer/keybindings.mjs";
import { splitControlsState } from "../renderer/split-controls.mjs";
import * as layout from "../renderer/split-layout.mjs";
import * as workspaceTabs from "../renderer/workspace-tabs.mjs";

const source = readFileSync(new URL("../renderer/shell.mjs", import.meta.url), "utf8");
const tick = () => new Promise(setImmediate);
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const instance = name => ({ instance: name, running: true, home: `/synthetic/${name}`, agentsRoot: "/synthetic/agents",
  tmux: { session: "synthetic-only", window: name } });

function shell(t) {
  const dom = new JSDOM(`<div id="stagehost"></div><div id="tabstrip"><div id="tabbar-row"><div id="tabbar"></div>
    <div id="tab-actions"><button id="split-right"></button><button id="split-down"></button><button id="split-close"></button></div>
    </div></div><div id="tabhost"></div><aside id="roster"><input class="ctx-filter"></aside>
    <nav id="nav"><button class="nav-item active">Overview</button></nav><button id="workspace">Workspace</button>`);
  t.after(() => dom.window.close());
  const document = dom.window.document, requests = [], attachments = [], terms = [], detached = [], projections = [], actions = new Map();
  const c = {
    document, console, navigator: { platform: "MacIntel" },
    workspace: "A", generation: 0, tabWorkspace: "A", contextWorkspace: "A",
    tabs: new Map(), nextTabId: 1, activeTab: null, split: null, sidebarMode: "instances", tabLayerVisible: false,
    contextRosterGen: 0, contextInstances: [], wsActiveTerminal: new Map(), pendingTerms: new Set(),
    tabbar: document.getElementById("tabbar"), tabhost: document.getElementById("tabhost"),
    tabActionsEl: document.getElementById("tab-actions"), contextRosterEl: document.getElementById("roster"),
    stageHost: document.getElementById("stagehost"), stage: { name: "hierarchy" }, navEl: document.getElementById("nav"),
    NAV: [{ name: "hierarchy" }], stageSidebarMode: () => "overview",
    brainIntents: createIntentGate(), workspaceTabMemory: createWorkspaceTabMemory(), workspaceLabel: { reset() {} },
    currentWorkspace: () => c.workspace, workspaceGeneration: () => c.generation,
    updateActiveContexts: on => { c.tabLayerVisible = on; },
    refreshContextRoster() {}, renderContextRoster() {}, setNavActive() {},
    focusRoster() { c.tabOpenIntents.invalidate(); c.contextRosterEl.querySelector("input").focus(); },
    api(path) { const gate = { ...deferred(), path }; requests.push(gate); return gate.promise; },
    resolveTerminalOpen, reserveKey, whenKeyFree, wirePaneSelection, createTabChrome, tabKeyAction, focusAfterLastTab,
    splitControlsState, ...layout, ...workspaceTabs,
    projectSplitDom(els, ...args) { projections.push(els); return projectSplitDom(els, ...args); },
    terminalOptions, terminalTypography: () => ({ fontSize: 13, fontFamily: "mono" }), xtermTheme: () => ({}),
    onThemeChange: () => () => {}, onTerminalTypographyChange: () => () => {}, requestAnimationFrame: fn => fn(),
    FitAddon: { FitAddon: class { fit() {} } },
    createTerminalTab: options => createTerminalTab({ ...options, observe: () => () => {} }),
    Terminal: class {
      constructor() { this.cols = 80; this.rows = 24; this.focuses = 0; this.disposed = 0; terms.push(this); }
      loadAddon() {} onData() {} onResize() {} attachCustomKeyEventHandler() {} write() {}
      open(wrap) { this.input = document.createElement("textarea"); wrap.append(this.input); }
      focus() { this.focuses++; this.input.focus(); }
      dispose() { this.disposed++; }
    },
    desk: {
      termOpen(spec) { const gate = { ...deferred(), spec }; attachments.push(gate); return gate.promise; },
      termClose(id) { detached.push(id); }, termResize() {}, termWrite() { assert.fail("selection must not write terminal bytes"); },
      onTermData: () => () => {}, onTermExit: () => () => {},
    },
    registerAction: action => actions.set(action.id, action.run),
  };
  c.tabOpenIntents = createSelectionOwnership(c);
  const names = ["setSidebarMode", "updateContextTabs", "showTabLayer", "showStage", "renderSplit", "selectEmptyGroup", "splitPane", "closeSplit", "restoreTerminalGroups",
    "updateSplitControls", "onTabKeydown", "addTab", "selectTab", "activateTab", "closeTab", "showTerminalContext",
    "openTerminalTabFlow", "openTerminalTabInner", "restoreWorkspaceTabs", "focusActiveTerminal"];
  const functions = names.map(name => {
    const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`));
    assert.ok(match, `execute shipped ${name}`); return match[0];
  });
  const registry = source.split("\n").filter(line => /^registerAction\(/.test(line) && /id: "(?:split\.|tabs\.close|terminal\.focusActive)/.test(line));
  const s = runInNewContext(`${functions.join("\n")}\n${registry.join("\n")}\n({ ${names.join(", ")} });`, c);
  const event = (el, type, options = {}) => el.dispatchEvent(type === "keydown"
    ? new dom.window.KeyboardEvent(type, { bubbles: true, cancelable: true, ...options })
    : new dom.window.Event(type, { bubbles: true }));
  return {
    ...s, c, document, requests, attachments, terms, detached, projections, actions, event,
    cells: () => [...c.tabhost.querySelectorAll(":scope > .group-cell")],
    empty: id => [...c.tabhost.querySelectorAll(".group-cell")].find(cell => cell.dataset.group === String(id))?.querySelector(".split-empty"),
    async open(name, ready = true) {
      const count = attachments.length;
      const done = s.openTerminalTabFlow(name, message => assert.fail(message));
      requests.at(-1).resolve({ instances: [instance(name)] }); await tick();
      if (ready && attachments.length > count) attachments.at(-1).resolve({ id: attachments.length });
      if (ready) await done;
      return { done, id: c.activeTab, term: terms.at(-1), gate: attachments.at(-1) };
    },
    switchTo(workspace) { c.workspace = workspace; c.generation++; s.restoreWorkspaceTabs(); },
  };
}

for (const count of [1, 3]) test(`${count} initial tab(s): shipped close → select empty → reopen retains the chosen destination`, async t => {
  const s = shell(t), opened = [];
  for (let i = 0; i < count; i++) opened.push(await s.open(`instance-${i}`));
  const original = opened.at(-1);
  s.splitPane("row");
  assert.equal(s.c.activeTab, null, "split's new empty destination has no active terminal");
  assert.deepEqual([...s.c.split.groups[0].tabs], opened.map(o => o.id), "first split seeds every original tab together");
  const cells = s.cells(), empty = s.empty(2);
  s.c.tabs.get(original.id).closeEl.click(); await tick();
  assert.deepEqual(s.cells(), cells, "closing a tab must not remove either group cell");
  assert.equal(s.empty(2), empty, "the destination owns a stable placeholder");
  s.event(empty, "pointerdown"); empty.focus();
  assert.equal(s.c.split.focusedGroup, 2); assert.equal(s.c.activeTab, null);
  s.actions.get("tabs.close")(); s.actions.get("terminal.focusActive")();
  assert.equal(s.c.tabs.size, count - 1, "commands cannot target the previous terminal");
  assert.equal(s.document.activeElement, empty);
  const reopened = await s.open(`instance-${count - 1}`);
  assert.equal(layout.groupOfTab(s.c.split, reopened.id).id, 2, "reopen lands in the chosen empty panel, not the first panel");
  assert.equal(s.c.tabs.size, count); assert.equal(s.attachments.length, count + 1);
  assert.deepEqual(s.detached, [count], "close detaches only that tab; no surviving terminal is reacquired");
  assert.deepEqual(s.attachments.at(-1).spec, s.attachments[count - 1].spec, "exact resolved terminal identity is unchanged");
  assert.equal(reopened.term.focuses, 1); assert.equal(s.document.activeElement, reopened.term.input);
  assert.deepEqual(s.cells(), cells);
});

for (const count of [1, 3]) test(`${count} initial tab(s): open → split → select current terminal MOVES the same retained tab`, async t => {
  const s = shell(t), opened = [];
  for (let i = 0; i < count; i++) opened.push(await s.open(`retained-${i}`));
  const original = opened.at(-1), pane = s.c.tabs.get(original.id).paneEl;
  s.splitPane("row");
  // Force the difficult projection path: a retained input is focused while its
  // pane moves. Native focus restoration must not supersede the open ticket.
  s.c.tabOpenIntents.applyFocus(() => original.term.input.focus());
  const again = await s.open(`retained-${count - 1}`);
  assert.equal(again.id, original.id); assert.equal(s.c.tabs.get(again.id).paneEl, pane);
  assert.equal(layout.groupOfTab(s.c.split, again.id).id, 2);
  assert.equal(s.attachments.length, count); assert.deepEqual(s.detached, []);
  assert.equal(s.c.tabOpenIntents.ownsFocus(again.id), true);
  assert.equal(s.document.activeElement, original.term.input);
  if (count === 1) assert.ok(s.empty(1), "moving the only tab leaves a selectable source, not a collapsed group");
});

test("multiple empty cells are independently focusable, resizable and controllable with activeTab=null", async t => {
  const s = shell(t);
  const first = await s.open("first"); s.splitPane("row");
  const second = await s.open("second"); s.splitPane("row");
  const cells = s.cells();
  s.closeTab(first.id); s.closeTab(second.id); await tick();
  assert.equal(s.cells().length, 3); assert.equal(s.c.tabs.size, 0);
  const empties = cells.map(cell => cell.querySelector(".split-empty"));
  assert.equal(new Set(empties).size, 3);
  for (let i = 0; i < empties.length; i++) {
    assert.equal(empties[i].tabIndex, 0);
    assert.ok(empties[i].getAttribute("aria-label").includes(String(s.c.split.groups[i].id)));
    empties[i].focus(); // native keyboard focus traversal emits focusin
    assert.equal(s.c.split.focusedGroup, s.c.split.groups[i].id); assert.equal(s.c.activeTab, null);
    assert.equal(cells[i].classList.contains("focused-group"), true);
    assert.equal(cells[i].querySelector("#tab-actions"), s.c.tabActionsEl);
  }
  cells[0].getBoundingClientRect = cells[1].getBoundingClientRect = () => ({ width: 400, height: 200 });
  s.event(cells[0].querySelector(".split-resizer"), "keydown", { key: "ArrowRight" });
  assert.equal(s.c.split.groups[0].weight, 1.1);
  assert.equal(s.c.tabActionsEl.hidden, false);
  assert.equal(s.document.getElementById("split-right").disabled, true, "fill existing groups before adding more");
  assert.equal(s.document.getElementById("split-down").disabled, false);
  assert.equal(s.document.getElementById("split-close").disabled, false);
  s.actions.get("split.horizontal")();
  assert.equal(s.c.split.orientation, "col"); assert.equal(s.c.split.groups[0].weight, 1.1);
  assert.deepEqual(s.cells(), cells); assert.deepEqual(cells.map(cell => cell.querySelector(".split-empty")), empties);
  s.actions.get("split.close")();
  assert.equal(s.c.split, null); assert.equal(s.c.tabLayerVisible, false);
  assert.equal(s.c.tabActionsEl.parentElement.id, "tabbar-row"); assert.equal(s.c.tabActionsEl.hidden, true);
  assert.equal(s.cells().length, 0); assert.equal(s.document.querySelector(".split-empty"), null);
  assert.equal(s.document.querySelector(".split-resizer"), null);
});

test("closing a focused group's last tab keeps that empty group, not a neighboring terminal", async t => {
  const s = shell(t), a = await s.open("left"); s.splitPane("row"); const b = await s.open("right");
  s.c.tabs.get(b.id).closeEl.click(); await tick();
  assert.equal(s.c.activeTab, null); assert.equal(s.c.split.focusedGroup, 2);
  assert.equal(s.document.activeElement, s.empty(2)); assert.equal(s.c.tabs.get(a.id).paneEl.hidden, false);
  assert.equal(s.c.tabOpenIntents.ownsFocus(a.id), false);
  s.actions.get("split.close")();
  assert.equal(s.c.split, null); assert.equal(s.c.activeTab, a.id, "Close split explicitly joins surviving tabs into the flat strip");
  assert.equal(s.c.tabs.get(a.id).paneEl.parentNode, s.c.tabhost); assert.equal(s.cells().length, 0);
  assert.equal(s.attachments.length, 2); assert.deepEqual(s.detached, [2]);
});

test("empty layout survives stage and workspace round-trip; old-cell callbacks cannot select or resize the new visit", async t => {
  assert.match(source, /label: "Split: return to terminal groups"[^\n]*run: \(\) => restoreTerminalGroups\(\)/,
    "return command must be reachable from the shipped palette");
  assert.equal(DEFAULT_KEYMAP["split.restore"], undefined, "recovery adds no keyboard default");
  const s = shell(t), a = await s.open("workspace-a"); s.splitPane("row"); s.closeTab(a.id); await tick();
  s.empty(1).focus();
  const [left, right] = s.cells();
  left.getBoundingClientRect = right.getBoundingClientRect = () => ({ width: 400, height: 200 });
  s.event(left.querySelector(".split-resizer"), "keydown", { key: "ArrowRight" });
  const saved = structuredClone(s.c.split), oldCell = right, oldEmpty = s.empty(2), oldCallbacks = s.projections.at(-1);
  await s.showStage("hierarchy");
  const stageIntent = s.c.tabOpenIntents.begin(); s.event(oldEmpty, "pointerdown");
  assert.equal(stageIntent(), true); assert.equal(s.c.tabLayerVisible, false);
  s.actions.get("split.restore")();
  assert.equal(s.document.activeElement, s.empty(1), "explicit return command makes the empty destination reachable");
  assert.deepEqual(structuredClone(s.c.split), saved); assert.equal(s.c.activeTab, null); assert.equal(s.c.tabLayerVisible, true);
  s.document.getElementById("workspace").focus();
  s.switchTo("B"); await s.open("workspace-b"); s.splitPane("col");
  s.document.getElementById("workspace").focus(); s.switchTo("A");
  assert.deepEqual(structuredClone(s.c.split), saved); assert.equal(s.c.activeTab, null); assert.equal(s.c.tabLayerVisible, true);
  assert.equal(s.cells()[0].style.flexGrow, "1.1");
  assert.equal(s.document.activeElement.id, "workspace", "restoration must be focus-neutral");
  const live = s.c.tabOpenIntents.begin();
  s.event(oldEmpty, "pointerdown"); oldCallbacks.onSelectEmpty(2, oldCell);
  // Even a current cell cannot make an old visit's captured callback current.
  oldCallbacks.onSelectEmpty(2, s.cells()[1]);
  oldCallbacks.onResize([{ id: 1, weight: 5 }]);
  assert.equal(live(), true); assert.deepEqual(structuredClone(s.c.split), saved);
  assert.equal(s.attachments.length, 2); assert.deepEqual(s.detached, [1]);
});

test("Close split/recreate and filled-cell stale callbacks fail live membership without canceling the latest intent", async t => {
  const s = shell(t); await s.open("kept"); s.splitPane("row");
  const old = s.projections.at(-1), cell = s.cells()[1], empty = s.empty(2);
  s.closeSplit(); s.splitPane("row");
  const current = s.projections.at(-1), currentCell = s.cells()[1];
  await s.open("destination");
  const live = s.c.tabOpenIntents.begin(), snapshot = structuredClone(s.c.split);
  s.event(empty, "pointerdown"); old.onSelectEmpty(2, cell); old.onResize([{ id: 1, weight: 7 }]);
  current.onSelectEmpty(2, currentCell); // group now filled, not an empty selection
  assert.equal(live(), true); assert.deepEqual(structuredClone(s.c.split), snapshot);
});

for (const outcome of ["resolve", "reject"]) test(`empty selection supersedes a pending terminal ${outcome}`, async t => {
  const s = shell(t); await s.open("kept"); s.splitPane("row");
  const pending = s.openTerminalTabFlow("late", () => assert.fail("stale refusal"));
  const request = s.requests.at(-1); s.empty(2).focus();
  const snapshot = structuredClone(s.c.split), focused = s.document.activeElement;
  if (outcome === "resolve") request.resolve({ instances: [instance("late")] });
  else request.reject(new Error("old panel failure"));
  await pending;
  assert.deepEqual(structuredClone(s.c.split), snapshot); assert.equal(s.c.activeTab, null);
  assert.equal(s.document.activeElement, focused); assert.equal(s.attachments.length, 1);
});

for (const outcome of ["resolve", "reject"]) for (const supersede of [false, true]) {
  test(`close/reopen while attachment cleanup ${outcome}: ${supersede ? "new empty choice cancels reopen" : "latest reopen uses chosen empty group"}`, async t => {
    const s = shell(t), old = await s.open("slow", false);
    s.splitPane("row"); s.c.tabs.get(old.id).closeEl.click();
    s.empty(2).focus();
    const reopened = s.openTerminalTabFlow("slow", () => assert.fail("refusal"));
    s.requests.at(-1).resolve({ instances: [instance("slow")] }); await tick();
    assert.equal(s.attachments.length, 1, "reopen waits for old detach, including late materialization");
    if (supersede) s.empty(1).focus();
    const focused = s.document.activeElement;
    if (outcome === "resolve") old.gate.resolve({ id: 99 }); else old.gate.reject(new Error("old attach failure"));
    await old.done; await tick();
    assert.equal(old.term.focuses, 0); assert.equal(old.term.disposed, 1);
    assert.deepEqual(s.detached, outcome === "resolve" ? [99] : []);
    if (!supersede) {
      assert.equal(s.attachments.length, 2);
      assert.equal(layout.groupOfTab(s.c.split, s.c.activeTab).id, 2);
      s.attachments.at(-1).resolve({ id: 100 });
    }
    await reopened;
    if (supersede) {
      assert.equal(s.attachments.length, 1); assert.equal(s.c.tabs.size, 0);
      assert.equal(s.c.activeTab, null); assert.equal(s.c.split.focusedGroup, 1);
      assert.equal(s.document.activeElement, focused);
    } else assert.equal(s.terms.at(-1).focuses, 1);
    assert.equal(s.cells().length, 2);
  });
}

for (const outcome of ["resolve", "reject"]) test(`empty selection revokes retained attachment focus on late ${outcome}`, async t => {
  const s = shell(t), pending = await s.open("retained-pending", false);
  s.splitPane("row"); s.empty(2).focus();
  const empty = s.document.activeElement;
  if (outcome === "resolve") pending.gate.resolve({ id: 88 }); else pending.gate.reject(new Error("late attachment error"));
  await pending.done;
  assert.equal(s.c.activeTab, null); assert.equal(s.c.split.focusedGroup, 2);
  assert.equal(s.document.activeElement, empty); assert.equal(pending.term.focuses, 0);
  assert.equal(pending.term.disposed, 0); assert.equal(s.c.tabs.size, 1);
  assert.equal(s.attachments.length, 1); assert.deepEqual(s.detached, []);
});

test("files/brains only cover empty terminal destinations; split controls/actions remain terminal-only", async t => {
  const s = shell(t), terminal = await s.open("covered"); s.splitPane("row");
  for (const kind of ["file", "brain"]) {
    const file = s.addTab({ title: kind, kind });
    const snapshot = structuredClone(s.c.split);
    assert.equal(s.c.tabActionsEl.hidden, true); assert.equal(s.cells().length, 0);
    s.actions.get("split.horizontal")();
    assert.deepEqual(structuredClone(s.c.split), snapshot); assert.equal(s.c.activeTab, file.id);
    s.actions.get("split.restore")();
    assert.equal(s.c.activeTab, null); assert.equal(s.document.activeElement, s.empty(2));
    assert.deepEqual(structuredClone(s.c.split), snapshot);
  }
  assert.equal(layout.groupOfTab(s.c.split, terminal.id).id, 1);
  assert.equal(s.attachments.length, 1); assert.deepEqual(s.detached, []);
});
