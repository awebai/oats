// A take-over, the holder's side: another window took this window's workspace over (main's
// window:release-workspace). The shipped releaseTakenWorkspace answers main first, then leaves the workspace
// (views/common.mjs leaveTakenWorkspace, faked here: it is pinned by window-workspace.test.mjs), then closes
// every tab of it through the shipped background close (a terminal's through its own teardown, its viewer
// detached) and forgets its layout. Tabs of other workspaces stay. Real shipped shell close/select/open and
// terminal lifecycle (the harness of retired-tabs-shell.test.mjs); only xterm, IPC and panel answers are synthetic.
import test from "node:test";
import { createInstanceRecency, recencyIdFromTerminalKey } from "../renderer/instance-recency.mjs";
import { viewContext } from "./helpers/view-context.mjs";
import assert from "node:assert/strict";
import { opened, confirmed, ready as terminalReady } from './helpers/terminal-wire.mjs';
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { withShellWindowGlobals } from './helpers/shell-window-globals.mjs';
import { JSDOM } from "jsdom";
import { createSelectionOwnership, wirePaneSelection } from "../renderer/selection-ownership.mjs";
import { createIntentGate } from "../renderer/open-intent.mjs";
import { createTerminalTab, terminalOptions, fitTerminal, createGlyphRenderer } from "../renderer/terminal-tab.mjs";
import { createTabChrome, tabKeyAction, focusAfterLastTab, tabNameTailStart } from "../renderer/tab-a11y.mjs";
import { reserveKey, whenKeyFree } from "../renderer/tab-keys.mjs";
import { resolveTerminalOpen, terminalKey } from "../renderer/instance-tree-view.mjs";
import { createWorkspaceTabMemory } from "../renderer/workspace-tab-memory.mjs";
import { projectSplitDom } from "../renderer/split-dom.mjs";
import { getBinding, formatChord } from "../renderer/keybindings.mjs";
import { splitControlsState } from "../renderer/split-controls.mjs";
import { instanceSplitPlan, instanceSplitIdentity } from '../renderer/instance-split.mjs';
import { sameInstanceActionTarget } from '../renderer/instance-action-target.mjs';
import * as layout from "../renderer/split-layout.mjs";
import * as workspaceTabs from "../renderer/workspace-tabs.mjs";
import { canAddressRemote, rowReason } from "../../client/remote-address.mjs";
import { revealInStrip } from "../renderer/reveal-in-scrollport.mjs";

const source = readFileSync(new URL("../renderer/shell.mjs", import.meta.url), "utf8");
const tick = () => new Promise(setImmediate);
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const instance = name => ({ instance: name, running: true, home: `/synthetic/${name}`, agentsRoot: "/synthetic/agents",
  tmux: { session: "synthetic-only", window: name } });
const SERVED = [{ id: "A", name: "a" }, { id: "B", name: "b" }];

function shell(t) {
  const dom = new JSDOM(`<div id="app"><span id="ws-context"></span><div id="stagehost"></div><div id="tabstrip"><div id="tabbar-row"><div id="tabbar"></div>
    <div id="tab-actions"><button id="split-right"></button><button id="split-down"></button></div>
    </div></div><div id="tabhost"></div><aside id="roster"><input class="ctx-filter"></aside>
    <nav id="nav"><button class="nav-item active">Overview</button></nav></div>`);
  t.after(() => dom.window.close());
  const document = dom.window.document, requests = [], attachments = [], terms = [], detached = [], log = [];
  const c = {
    document, window: dom.window, canAddressRemote, rowReason, console, navigator: { platform: "MacIntel" },
    getBinding, formatChord, stableFocusTarget: () => null,
    connectionGeneration: 0, subscribeConnections: () => () => {},
    workspace: "A", generation: 0, tabWorkspace: "A", contextWorkspace: "A",
    tabs: new Map(), nextTabId: 1, activeTab: null, split: null, sidebarMode: "instances", tabLayerVisible: false,
    contextRosterGen: 0, contextInstances: [],
    // The palette's last-focus record (Spec C), inert here: the shell code under test writes to it.
    instanceRecency: createInstanceRecency({ storage: null }), recencyIdFromTerminalKey,
    wsActiveTerminal: new Map(), pendingTerms: new Set(),
    rosterState: null, rosterStale: false, contextDeploymentNote: null, ...viewContext(), rosterSignaturePainted: null,
    tabbar: document.getElementById("tabbar"), tabhost: document.getElementById("tabhost"),
    tabActionsEl: document.getElementById("tab-actions"), contextRosterEl: document.getElementById("roster"),
    stageHost: document.getElementById("stagehost"), stage: { name: "hierarchy" }, navEl: document.getElementById("nav"),
    NAV: [{ name: "hierarchy" }], stageSidebarMode: () => "overview",
    brainIntents: createIntentGate(), workspaceTabMemory: createWorkspaceTabMemory(), workspaceLabel: { reset() {} },
    currentWorkspace: () => c.workspace, workspaceGeneration: () => c.generation,
    updateActiveContexts: on => { c.tabLayerVisible = on; },
    refreshContextRoster() {}, renderContextRoster() {}, setNavActive() {},
    // The instance panel is exercised by retired-tabs-shell.test.mjs; it is inert here.
    syncContextPanel() {}, refreshPanelInstance() {}, contextPanel: { setFocusMode() {} },
    focusRoster() { c.tabOpenIntents.invalidate(); c.contextRosterEl.querySelector("input").focus(); },
    api(path) { const gate = { ...deferred(), path }; requests.push(gate); return gate.promise; },
    updateSidebarControls() {},
    resolveTerminalOpen, terminalKey, reserveKey, whenKeyFree, wirePaneSelection, createTabChrome, tabKeyAction, focusAfterLastTab, tabNameTailStart,
    splitControlsState, instanceSplitPlan, instanceSplitIdentity, sameInstanceActionTarget, ...layout, ...workspaceTabs, projectSplitDom,
    terminalOptions, wireTerminalSelection: () => () => {}, fitTerminal, createGlyphRenderer, terminalTypography: () => ({ fontSize: 13, fontFamily: "mono" }), xtermTheme: () => ({}), terminalFontWeight: () => 400,
    onThemeChange: () => () => {}, onTerminalTypographyChange: () => () => {}, requestAnimationFrame: fn => fn(),
    FitAddon: { FitAddon: class { fit() {} } },
    createTerminalTab: options => createTerminalTab({ ...options, observe: () => () => {} }),
    Terminal: class {
      parser = { registerOscHandler: () => ({ dispose() {} }) };
      constructor() { this.cols = 80; this.rows = 24; this.focuses = 0; this.disposed = 0; terms.push(this); }
      loadAddon() {} onData() {} onResize() {} attachCustomKeyEventHandler() {} write() {}
      open(wrap) { this.input = document.createElement("textarea"); wrap.append(this.input); }
      focus() { this.focuses++; this.input.focus(); }
      dispose() { this.disposed++; }
    },
    desk: {
      termOpen(spec) { const gate = { ...deferred(), spec }; attachments.push(gate); return gate.promise.then(({ id }) => opened(id)); },
      termReady: terminalReady,
      termClose(h) { detached.push(h.id); log.push(["detach", h.id]); return confirmed(h); }, termResize() {}, termWrite() {},
      onTermData: () => () => {}, onTermExit: () => () => {},
    },
    registerAction() {}, modalOpen: () => false,
    // main's side of the take-over: the answer (refused once main has stopped waiting), and the leave.
    answerResult: { ok: true },
    desktopBridge: { async windowReleaseAnswer(request, payload) { log.push(["answer", request, payload]); return c.answerResult; } },
    async leaveTakenWorkspace(workspace, workspaces) {
      log.push(["leave", workspace, workspaces, [...c.tabs.values()].filter(tab => tab.workspace === workspace).length]);
      await tick();
      if (c.workspace === workspace) { c.workspace = c.leaveTo; c.generation++; s.restoreWorkspaceTabs(); }
    },
    leaveTo: "B",
  };
  c.tabOpenIntents = createSelectionOwnership(c);
  c.revealInStrip = revealInStrip; c.tabStripResize = null;
  c.splitOpenState = () => ({ split: c.split, activeId: c.activeTab, tabs: c.tabs, workspace: c.workspace, visible: c.tabLayerVisible });
  const names = ["setSidebarMode", "updateContextTabs", "showTabLayer", "closeStage", "showStage", "renderSplit", "selectEmptyGroup", "splitPane", "closeSplit", "restoreTerminalGroups",
    "updateSplitControls", "onTabKeydown", "walkedTabs", "visibleTabEntries", "addTab", "selectTab", "activateTab", "revealActiveRosterRow", "closeTab", "tabStrips", "revealActiveTabs", "observeTabStrips", "showTerminalContext",
    "openTerminalTabFlow", "openTerminalTabInner", "restoreWorkspaceTabs", "focusActiveTerminal", "syncTabNeedsInput", "focusNextGroup",
    "releaseTakenWorkspace", "closeWorkspaceTabs"];
  const functions = names.map(name => {
    const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`));
    assert.ok(match, `execute shipped ${name}`); return match[0];
  });
  const s = runInNewContext(`${functions.join("\n")}\n({ ${names.join(", ")} });`, withShellWindowGlobals(c));
  return {
    ...s, c, document, requests, attachments, terms, detached, log,
    async open(name) {
      const done = s.openTerminalTabFlow(name, message => assert.fail(message));
      requests.at(-1).resolve({ instances: [instance(name)] }); await tick();
      attachments.at(-1).resolve({ id: attachments.length });
      await done;
      return { id: c.activeTab, term: terms.at(-1), handle: attachments.length };
    },
    file(name) {
      const made = s.addTab({ title: name, key: JSON.stringify([c.workspace, `file:/${name}`]), kind: "file", onClose: () => log.push(["file-closed", name]) });
      return made.id;
    },
    switchTo(workspace) { c.workspace = workspace; c.generation++; s.restoreWorkspaceTabs(); },
  };
}

/** Workspace A, shown: terminals a1 and a2 side by side and a file tab; workspace B behind it: terminal b1. */
async function holder(t) {
  const s = shell(t);
  s.switchTo("B");
  const b1 = await s.open("b1");
  s.switchTo("A");
  const a1 = await s.open("a1");
  s.splitPane("row");
  const a2 = await s.open("a2");
  const file = s.file("notes.md");
  s.c.wsActiveTerminal.set("A", s.c.tabs.get(a2.id).key);
  assert.ok(s.c.split, "A has a split layout");
  return { s, a1, a2, b1, file };
}
const tabsOf = (s, workspace) => [...s.c.tabs.values()].filter(tab => tab.workspace === workspace);

test("a take-over answers main first, then leaves the workspace, then closes every tab of it and forgets its layout", async t => {
  const { s, a1, a2, b1 } = await holder(t);
  s.log.length = 0;
  await s.releaseTakenWorkspace({ request: 7, workspace: "A", workspaces: SERVED });
  await settle();
  assert.deepEqual(s.log.slice(0, 2), [["answer", 7, null], ["leave", "A", SERVED, 3]],
    "the answer, then the leave, while every tab of A is still open");
  assert.deepEqual(s.log.slice(2).map(([kind]) => kind).sort(), ["detach", "detach", "file-closed"], "then the closes");
  assert.deepEqual(tabsOf(s, "A"), [], "no tab of A is left");
  assert.equal(a1.term.disposed, 1); assert.equal(a2.term.disposed, 1, "each terminal's own teardown ran");
  assert.deepEqual(s.detached.sort(), [a1.handle, a2.handle].sort(), "both viewers detached, no other: nothing of A stays attached");
  assert.equal(s.c.wsActiveTerminal.has("A"), false);
  assert.deepEqual(s.c.workspaceTabMemory.recall("A", s.c.tabs), { split: null, activeTab: null, sidebarMode: "overview", tabLayerVisible: false },
    "A's layout is forgotten");
  assert.deepEqual(tabsOf(s, "B").map(tab => tab.title), ["b1"], "B's tab stays");
  assert.equal(b1.term.disposed, 0);
  assert.equal(s.c.workspace, "B");
});

test("the background close moves no focus and reopens no layer of the workspace left", async t => {
  const { s } = await holder(t);
  const filter = s.c.contextRosterEl.querySelector("input");
  s.c.leaveTo = "B";
  await s.releaseTakenWorkspace({ request: 1, workspace: "A", workspaces: SERVED });
  filter.focus();
  await settle();
  assert.equal(s.document.activeElement, filter, "where the operator is, focus stays");
  assert.ok(![...s.c.tabs.values()].some(tab => tab.workspace === "A"));
});

test("a late release (main stopped waiting and refuses the answer) ends the same way", async t => {
  for (const late of [{ ok: false, code: "unknown-request" }, null]) {
    const { s, a1, a2 } = await holder(t);
    if (late) s.c.answerResult = late;
    else s.c.desktopBridge.windowReleaseAnswer = async () => { throw new Error("main is gone"); };
    await s.releaseTakenWorkspace({ request: 3, workspace: "A", workspaces: SERVED });
    await settle();
    assert.deepEqual(tabsOf(s, "A"), [], late ? late.code : "a rejected answer");
    assert.deepEqual(s.detached.sort(), [a1.handle, a2.handle].sort(), "nothing attached");
    assert.equal(s.c.workspace, "B");
    assert.equal(s.c.workspaceTabMemory.recall("A", s.c.tabs).split, null);
  }
});

test("the tabs close even when the window could not leave (the leave failed), and a window already elsewhere closes them too", async t => {
  const { s } = await holder(t);
  s.c.leaveTakenWorkspace = async () => { s.log.push(["leave"]); throw new Error("main refused"); };
  await assert.rejects(s.releaseTakenWorkspace({ request: 4, workspace: "A", workspaces: SERVED }));
  await settle();
  assert.deepEqual(tabsOf(s, "A"), [], "closed in finally");
  const other = await holder(t);
  other.s.switchTo("B");
  await other.s.releaseTakenWorkspace({ request: 5, workspace: "A", workspaces: SERVED });
  await settle();
  assert.deepEqual(tabsOf(other.s, "A"), [], "a workspace it no longer shows: its tabs close all the same");
  assert.deepEqual(tabsOf(other.s, "B").map(tab => tab.title), ["b1"]);
});

test("a release naming no workspace does nothing: no answer, no leave, no close", async t => {
  const { s } = await holder(t);
  s.log.length = 0;
  for (const message of [null, {}, { request: 1, workspace: "" }, { request: 1, workspace: 7 }]) await s.releaseTakenWorkspace(message);
  await settle();
  assert.deepEqual(s.log, []);
  assert.equal(tabsOf(s, "A").length, 3);
});
