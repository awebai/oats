// Exercise shipped shell ordering, including real nav classes, layer/context
// projection, split DOM reparenting and native focusin. Only view loading and
// roster I/O are synthetic; no browser/server, Electron, IPC or terminal writes.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { JSDOM } from "jsdom";
import { NAV, stageSidebarMode } from "../renderer/shell-nav.mjs";
import { createSelectionOwnership, wirePaneSelection } from "../renderer/selection-ownership.mjs";
import { createIntentGate, prepareOwnedOpen } from "../renderer/open-intent.mjs";
import { createViewLifecycle } from "../renderer/view-lifecycle.mjs";
import { createWorkspaceTabMemory } from "../renderer/workspace-tab-memory.mjs";
import { createTabChrome, tabKeyAction, focusAfterLastTab } from "../renderer/tab-a11y.mjs";
import { reserveKey, whenKeyFree } from "../renderer/tab-keys.mjs";
import { projectSplitDom } from "../renderer/split-dom.mjs";
import * as layout from "../renderer/split-layout.mjs";
import * as workspaceTabs from "../renderer/workspace-tabs.mjs";

// Live evidence 13/14 used the hover token #f0e9d2, not selected #dce7e8.
// The driver's last click (123.5, 112.03125) remains over Souls after the
// workspace menu closes. JSDOM cannot prove browser hit-testing/hover; these
// tests assert real .active classes instead of inferring selection from pixels.
const source = readFileSync(new URL("../renderer/shell.mjs", import.meta.url), "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function shell(t, shellSource = source) {
  const dom = new JSDOM(`<body><span id="ws-context"></span><aside><button id="ws-trigger">Workspace</button><nav id="nav"></nav></aside>
    <div id="stagehost"></div><div id="tabstrip"><div id="tabbar-row"><div id="tabbar"></div><div id="tab-actions"></div></div></div><div id="tabhost"></div>`);
  t.after(() => dom.window.close());
  const document = dom.window.document, loads = [], contexts = [], focusCalls = [], navWrites = [];
  const navEl = document.getElementById("nav");
  for (const view of NAV) {
    const b = document.createElement("button"); b.className = "nav-item";
    b.dataset.view = view.name; b.textContent = view.label; navEl.append(b);
  }
  const c = {
    document, console, navigator: { platform: "MacIntel" }, NAV, stageSidebarMode,
    workspace: "A", generation: 0, tabWorkspace: "A", contextWorkspace: "A",
    stage: null, stageOp: 0, stageHost: document.getElementById("stagehost"), navEl,
    tabs: new Map(), nextTabId: 1, activeTab: null, split: null, sidebarMode: "overview", tabLayerVisible: false,
    contextRosterGen: 0, contextInstances: [], contextRosterEl: null,
    tabbar: document.getElementById("tabbar"), tabhost: document.getElementById("tabhost"),
    tabActionsEl: document.getElementById("tab-actions"),
    wsActiveTerminal: new Map(), workspaceTabMemory: createWorkspaceTabMemory(), brainIntents: createIntentGate(),
    currentWorkspace: () => c.workspace, workspaceGeneration: () => c.generation,
    setActiveContexts: value => contexts.splice(0, contexts.length, ...value),
    workspaceLabel: { reset() {} }, refreshContextRoster() {}, renderContextRoster() {}, updateSplitControls() {},
    createSelectionOwnership, wirePaneSelection, createViewLifecycle, createTabChrome, tabKeyAction, focusAfterLastTab,
    reserveKey, whenKeyFree, prepareOwnedOpen, projectSplitDom, ...layout, ...workspaceTabs,
    loadStageView(name) { const gate = { ...deferred(), name }; loads.push(gate); return gate.promise; },
    ctx: {},
  };
  const names = ["showStage", "setNavActive", "showTabLayer", "updateActiveContexts", "setSidebarMode", "updateContextTabs",
    "addTab", "selectTab", "activateTab", "closeTab", "onTabKeydown", "renderSplit", "selectEmptyGroup", "renderWorkspaceContext", "restoreWorkspaceTabs", "showTerminalContext", "openViewTab"];
  const functions = names.map(name => {
    const match = shellSource.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`));
    assert.ok(match, `execute shipped ${name}`); return match[0];
  }).join("\n").replace('import(`./views/${name}.mjs`)', "loadStageView(name)");
  const setup = shellSource.match(/const tabOpenIntents = [^\n]+/)[0];
  const s = runInNewContext(`${setup}\n${functions}\n({ ${names.join(", ")}, tabOpenIntents });`, c);
  // Trace actual class writes, not a fake setNavActive implementation. Useful
  // when a synchronous focus restoration re-enters the shell during projection.
  for (const b of navEl.children) {
    const toggle = b.classList.toggle.bind(b.classList);
    b.classList.toggle = (name, on) => { if (name === "active" && on) navWrites.push(b.dataset.view); return toggle(name, on); };
    b.addEventListener("click", () => s.showStage(b.dataset.view));
  }
  return {
    ...s, c, document, loads, contexts, focusCalls, navWrites,
    nav: () => [...navEl.querySelectorAll(".active")].map(b => b.dataset.view),
    seed(kind = "terminal", title = `${c.workspace}-${kind}`) {
      const made = s.addTab({ title, key: `${c.workspace}:${c.nextTabId}`, kind,
        focusContent: () => focusCalls.push(made.id) });
      const input = document.createElement("textarea"); made.paneEl.append(input);
      return { ...made, input };
    },
    async stage(name) {
      const done = s.showStage(name); await tick();
      if (!c.stage || c.stage.name !== name) {
        assert.equal(loads.at(-1).name, name);
        loads.at(-1).resolve({ mount(el) { el.textContent = name; return () => {}; } });
      }
      await done;
    },
    switchTo(workspace) { c.workspace = workspace; c.generation++; s.restoreWorkspaceTabs(); },
    snapshot() { return structuredClone({ split: c.split, activeTab: c.activeTab, sidebarMode: c.sidebarMode,
      tabLayerVisible: c.tabLayerVisible, nav: this.nav(), contexts,
      panes: [...c.tabs].filter(([, tab]) => !tab.paneEl.hidden).map(([id]) => id) }); },
  };
}
function filled(orientation, ids, weights) {
  const model = layout.openTabInFocusedGroup(layout.requestSplit(null, orientation, ids.slice(0, -1), ids[0]).split, ids.at(-1)).split;
  return layout.resizeSplitGroups(model, model.groups.map((g, i) => ({ id: g.id, weight: weights[i] })));
}
function terminalForeground(s) {
  assert.equal(s.c.tabs.get(s.c.activeTab).kind, "terminal");
  assert.equal(s.c.tabLayerVisible, true);
  assert.equal(s.c.stageHost.style.display, "none");
  assert.deepEqual(s.nav(), [], "terminal foreground must have no active stage nav");
  assert.deepEqual(s.contexts, ["tabs"]);
}

test("live-driver order: covered Souls stage → independent A/B splits → A has no active stage nav", async t => {
  const s = shell(t); await s.stage("spawn");
  const a1 = s.seed(), a2 = s.seed(); s.seed("file", "notes.md"); s.seed("file", "viewer.js"); const a3 = s.seed();
  s.c.split = filled("row", [a1.id, a2.id, a3.id], [1.3, .7]); s.selectTab(a3.id);
  terminalForeground(s); const a = s.snapshot();
  const trigger = s.document.getElementById("ws-trigger"); trigger.focus(); s.switchTo("B");
  const b1 = s.seed(), b2 = s.seed();
  s.c.split = filled("col", [b1.id, b2.id], [1.2, .8]); s.selectTab(b2.id);
  terminalForeground(s); const b = s.snapshot();
  for (const [ws, expected] of [["A", a], ["B", b], ["A", a]]) {
    s.navWrites.length = 0;
    s.switchTo(ws); terminalForeground(s); assert.deepEqual(s.snapshot(), expected);
    assert.deepEqual(s.navWrites, [], "restoration must not transiently select a covered stage either");
    assert.equal(s.document.activeElement, trigger, "workspace restoration never focuses terminal content");
  }
  assert.deepEqual(s.focusCalls, []);
  for (const tab of s.c.tabs.values()) assert.ok(tab.paneEl.isConnected && tab.tabEl.isConnected);
});

async function restoredFile(t, context, shellSource = source) {
  const s = shell(t, shellSource), expected = context === "souls" ? ["spawn"] : [];
  await s.stage(context === "souls" ? "spawn" : "hierarchy");
  if (context === "instances") s.seed();
  const file = s.seed("file");
  assert.deepEqual(s.nav(), expected);
  s.document.getElementById("ws-trigger").focus();
  s.switchTo("B"); await s.stage(context === "souls" ? "hierarchy" : "spawn");
  s.switchTo("A");
  assert.equal(s.c.activeTab, file.id); assert.equal(s.c.sidebarMode, context);
  assert.deepEqual(s.nav(), expected, "file restoration must project remembered context instead of inheriting the other workspace's nav");
  assert.deepEqual(s.contexts, ["tabs"]);
  assert.equal(s.document.activeElement.id, "ws-trigger");
}
for (const context of ["instances", "souls"]) {
  test(`restored file projects its remembered ${context} context, not B's stage highlight`, t => restoredFile(t, context));
  test(`mutation: file nav projection cannot depend on changing sidebar mode (${context})`, async t => {
    const from = `  } else if (current?.kind === "file") {\n    if (sidebarMode !== "instances" && sidebarMode !== "souls") setSidebarMode("instances");`;
    const to = `  } else if (current?.kind === "file" && sidebarMode !== "instances" && sidebarMode !== "souls") {\n    setSidebarMode("instances");`;
    assert.ok(source.includes(from));
    await assert.rejects(restoredFile(t, context, source.replace(from, to)), /file restoration must project remembered context/);
  });
}

test("brain restoration keeps Souls navigation; returning to a stage reflects the visible stage", async t => {
  const s = shell(t); await s.stage("spawn"); const brain = s.seed("brain");
  s.switchTo("B"); await s.stage("hierarchy"); s.switchTo("A");
  assert.equal(s.c.activeTab, brain.id); assert.deepEqual(s.nav(), ["spawn"]);
  await s.stage("hierarchy");
  assert.equal(s.c.tabLayerVisible, false); assert.deepEqual(s.nav(), ["hierarchy"]);
  assert.deepEqual(s.contexts, ["stage:hierarchy"]);
});

for (const boundary of ["load", "mount"]) for (const outcome of ["resolve", "reject"]) {
  test(`late stage ${boundary} ${outcome} cannot change restored terminal foreground/nav/focus`, async t => {
    const s = shell(t); await s.stage("spawn"); const a = s.seed();
    const pending = s.showStage("hierarchy"); await tick();
    const gate = boundary === "load" ? s.loads.at(-1) : deferred();
    if (boundary === "mount") { s.loads.at(-1).resolve({ mount: () => gate.promise }); await tick(); }
    s.selectTab(a.id); const trigger = s.document.getElementById("ws-trigger"); trigger.focus();
    s.switchTo("B"); s.seed(); s.switchTo("A"); const before = s.snapshot();
    if (outcome === "resolve") gate.resolve(boundary === "load" ? { mount() {} } : undefined);
    else gate.reject(new Error("late stage failure"));
    await pending;
    terminalForeground(s); assert.deepEqual(s.snapshot(), before);
    assert.equal(s.document.activeElement, trigger); assert.deepEqual(s.focusCalls, []);
  });
}

for (const boundary of ["load", "mount"]) for (const outcome of ["resolve", "reject"]) {
  test(`late stage ${boundary} ${outcome} preserves a newer real stage selection (not a blanket nav reset)`, async t => {
    const s = shell(t); await s.stage("spawn");
    const old = s.showStage("hierarchy"); await tick();
    const gate = boundary === "load" ? s.loads.at(-1) : deferred();
    if (boundary === "mount") { s.loads.at(-1).resolve({ mount: () => gate.promise }); await tick(); }
    const newer = s.showStage("schedules");
    if (outcome === "resolve") gate.resolve(boundary === "load" ? { mount() {} } : undefined);
    else gate.reject(new Error("superseded stage failure"));
    await old; await tick();
    assert.equal(s.loads.at(-1).name, "schedules");
    s.loads.at(-1).resolve({ mount() {} }); await newer;
    assert.deepEqual(s.nav(), ["schedules"]); assert.deepEqual(s.contexts, ["stage:schedules"]);
    assert.equal(s.c.tabLayerVisible, false);
  });
}

for (const outcome of ["resolve", "reject"]) test(`older artifact module ${outcome} cannot replace restored terminal navigation`, async t => {
  const s = shell(t); await s.stage("spawn"); s.seed();
  const pending = s.openViewTab("markdown", "old file"); await tick(); const gate = s.loads.at(-1);
  s.document.getElementById("ws-trigger").focus(); s.switchTo("B"); s.seed(); s.switchTo("A");
  const before = s.snapshot();
  if (outcome === "resolve") gate.resolve({ mount() { assert.fail("stale artifact must not mount"); } });
  else gate.reject(new Error("old file module failure"));
  await pending;
  terminalForeground(s); assert.deepEqual(s.snapshot(), before); assert.equal(s.c.tabs.size, 2);
  assert.equal(s.document.activeElement.id, "ws-trigger");
});

async function reentrantFocus(t, shellSource = source) {
  const s = shell(t, shellSource); await s.stage("spawn"); const first = s.seed(), second = s.seed();
  s.selectTab(first.id); first.input.focus();
  const intent = s.tabOpenIntents.begin();
  s.c.split = filled("row", [first.id, second.id], [1.3, .7]);
  s.selectTab(second.id, { intent }); // projectSplitDom reparents the focused first input
  terminalForeground(s);
  assert.equal(s.c.activeTab, second.id, "restoring first input focus must not re-enter selectTab(first)");
  assert.equal(intent(), true); assert.equal(s.document.activeElement, first.input);
  assert.equal(s.c.split.focusedGroup, s.c.split.groups[1].id);
  assert.deepEqual(s.focusCalls, []);
}
test("retained split focus restoration is not a second explicit selection", t => reentrantFocus(t));
test("mutation: restored focusin must not re-enter tab selection", async t => {
  const guard = "isApplyingFocus: () => tabOpenIntents.isApplyingFocus(),";
  assert.ok(source.includes(guard));
  await assert.rejects(reentrantFocus(t, source.replace(guard, "isApplyingFocus: () => false,")), /restoring first input focus must not re-enter/);
});
