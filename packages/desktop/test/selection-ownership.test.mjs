// Shipped-shell boundary: real DOM chrome, split projection, selection/open/
// close/workspace functions and terminal lifecycle. Only IPC, xterm and module
// loading are synthetic. No Electron, processes, sockets or operator sessions.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { JSDOM } from "jsdom";
import { createSelectionOwnership, wirePaneSelection } from "../renderer/selection-ownership.mjs";
import { createIntentGate, prepareOwnedOpen } from "../renderer/open-intent.mjs";
import { createTerminalTab, terminalOptions, terminalKeyDecision } from "../renderer/terminal-tab.mjs";
import { createTermLifecycle } from "../renderer/term-lifecycle.mjs";
import { createViewLifecycle } from "../renderer/view-lifecycle.mjs";
import { reserveKey, whenKeyFree } from "../renderer/tab-keys.mjs";
import { createTabChrome, tabKeyAction, focusAfterLastTab } from "../renderer/tab-a11y.mjs";
import { createWorkspaceTabMemory } from "../renderer/workspace-tab-memory.mjs";
import * as workspaceTabs from "../renderer/workspace-tabs.mjs";
import * as layout from "../renderer/split-layout.mjs";
import { projectSplitDom } from "../renderer/split-dom.mjs";
import * as instanceTree from "../renderer/instance-tree.mjs";
import { instanceActions, captureInstanceActionMenu } from "../renderer/instance-actions.mjs";
import { runtimeState } from "../renderer/instance-presentation.mjs";
import { rosterKeyAction, moveTarget } from "../renderer/roster-keys.mjs";

const source = readFileSync(new URL("../renderer/shell.mjs", import.meta.url), "utf8");
const names = [
  "setSidebarMode", "updateContextTabs", "showTabLayer", "renderSplit", "showStage",
  "splitPane", "closeSplit", "onTabKeydown", "addTab", "selectTab", "activateTab", "closeTab",
  "openViewTab", "openTerminalTabFlow", "openTerminalTabInner", "focusActiveTerminal",
  "visibleTabEntries", "cycleTab", "restoreWorkspaceTabs", "showTerminalContext",
  "initContextRoster", "renderContextRoster", "focusRoster", "onRosterRowKey", "setRovingRow",
];
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const flush = () => new Promise(setImmediate);

function shell(t, { shellSource = source, ownership = createSelectionOwnership, terminal = createTerminalTab } = {}) {
  const dom = new JSDOM(`<div id="stagehost"></div><div id="tabstrip"><div id="tabbar-row"><div id="tabbar"></div><div id="tab-actions"></div></div></div><div id="tabhost"></div><aside id="sidebar"><div id="instance-roster"><input id="entry" class="ctx-filter"><span class="ctx-count"></span><div class="ctx-list"></div></div><nav id="nav"><button class="nav-item active">Hierarchy</button></nav></aside>`);
  t.after(() => dom.window.close());
  const document = dom.window.document;
  const requests = [], loads = [], attachments = [], terms = [], detached = [], actions = new Map();
  const c = {
    document, console, navigator: { platform: "MacIntel" },
    workspace: "A", generation: 0, tabWorkspace: "A", contextWorkspace: "A",
    tabs: new Map(), nextTabId: 1, activeTab: null, split: null, sidebarMode: "instances", tabLayerVisible: false,
    contextRosterGen: 0, contextInstances: [], contextFilter: "", collapsedInstances: new Set(),
    wsActiveTerminal: new Map(), pendingTerms: new Set(),
    tabbar: document.getElementById("tabbar"), tabhost: document.getElementById("tabhost"),
    tabActionsEl: document.getElementById("tab-actions"), splitEmptyEl: document.createElement("div"),
    stageHost: document.getElementById("stagehost"), stage: { name: "hierarchy" },
    navEl: document.getElementById("nav"), contextRosterEl: null,
    brainIntents: createIntentGate(), workspaceTabMemory: createWorkspaceTabMemory(),
    workspaceLabel: { reset() {} }, stageSidebarMode: () => "overview", NAV: [{ name: "hierarchy" }],
    currentWorkspace: () => c.workspace, workspaceGeneration: () => c.generation,
    updateActiveContexts: on => { c.tabLayerVisible = on; },
    updateSplitControls() {}, refreshContextRoster() {}, setNavActive() {},
    ...instanceTree, instanceActions, captureInstanceActionMenu, runtimeState, rosterKeyAction, moveTarget,
    api: () => { const gate = deferred(); requests.push(gate); return gate.promise; },
    prepareOwnedOpen: opts => prepareOwnedOpen({ ...opts, load() {
      const gate = deferred(); loads.push(gate); return gate.promise;
    } }),
    // Keep identity resolution out of this test; keys/targets remain distinct.
    resolveTerminalOpen: (instances, ref, ws) => ({ inst: { instance: ref, running: true, tmux: { session: "synthetic", window: ref } }, key: `${ws}:${ref}` }),
    ctx: {}, reserveKey, whenKeyFree, createViewLifecycle, createTabChrome, tabKeyAction, focusAfterLastTab,
    createSelectionOwnership: ownership, wirePaneSelection, terminalOptions,
    ...workspaceTabs, ...layout, projectSplitDom,
    registerAction: action => actions.set(action.id, action.run),
    terminalTypography: () => ({ fontSize: 13, fontFamily: "mono" }), xtermTheme: () => ({}),
    onThemeChange: () => () => {}, onTerminalTypographyChange: () => () => {},
    requestAnimationFrame: fn => fn(),
    FitAddon: { FitAddon: class { fit() {} } },
    createTerminalTab: opts => terminal({ ...opts, observe: () => () => {} }),
    Terminal: class {
      constructor() { this.cols = 80; this.rows = 24; this.focuses = 0; this.disposed = 0; terms.push(this); }
      loadAddon() {}
      open(wrap) { this.input = document.createElement("textarea"); wrap.append(this.input); }
      onData() {} onResize() {} attachCustomKeyEventHandler() {} write() {}
      focus() { this.focuses++; this.input.focus(); }
      dispose() { this.disposed++; }
    },
    desk: {
      termOpen(spec) { const gate = { ...deferred(), spec }; attachments.push(gate); return gate.promise; },
      termClose: id => detached.push(id), termWrite() {}, termResize() {},
      onTermData: () => () => {}, onTermExit: () => () => {},
    },
  };
  const functions = names.map(name => {
    const match = shellSource.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`));
    assert.ok(match, `exercise shipped ${name}`); return match[0];
  });
  const setup = shellSource.match(/const tabOpenIntents = [^\n]+/)[0];
  const registry = shellSource.split("\n").filter(line => /^registerAction\(/.test(line)
    && /id: "(?:tabs\.|split\.close|terminal\.focusActive)/.test(line));
  const s = runInNewContext(`${setup}\n${functions.join("\n")}\n${registry.join("\n")}\n({ ${names.join(", ")}, tabOpenIntents });`, c);
  s.initContextRoster();
  const dispatch = (el, type, options = {}) => el.dispatchEvent(type === "keydown"
    ? new dom.window.KeyboardEvent(type, { bubbles: true, cancelable: true, ...options })
    : new dom.window.Event(type, { bubbles: true }));
  return {
    ...s, c, document, requests, loads, attachments, terms, detached, actions, dispatch,
    seed(name) { return s.addTab({ title: name, key: `${c.workspace}:${name}`, kind: "terminal" }).id; },
    async pending(ref) {
      const result = s.openTerminalTabFlow(ref, message => assert.fail(message));
      requests.at(-1).resolve({ instances: [] }); await flush();
      assert.equal(attachments.length, terms.length);
      return { result, gate: attachments.at(-1), term: terms.at(-1), id: c.activeTab };
    },
    switchTo(workspace, restore = true) {
      c.workspace = workspace; c.generation++;
      if (restore) s.restoreWorkspaceTabs();
    },
  };
}

const actions = {
  cycle: s => s.actions.get("tabs.next")(),
  pointer: s => s.dispatch(s.c.tabs.get(1).paneEl, "pointerdown"),
  focus: s => s.dispatch(s.c.tabs.get(1).paneEl, "focusin"),
  "active-pointer": s => s.dispatch(s.c.tabs.get(2).paneEl, "pointerdown"),
  "active-focus": s => s.dispatch(s.c.tabs.get(2).paneEl, "focusin"),
  "strip-click": s => s.c.tabs.get(1).triggerEl.click(),
  "strip-arrow": s => s.dispatch(s.c.tabs.get(2).triggerEl, "keydown", { key: "ArrowLeft" }),
  "close-button": s => s.c.tabs.get(2).closeEl.click(),
  "inactive-close-button": s => s.c.tabs.get(1).closeEl.click(),
  "close-delete": s => s.dispatch(s.c.tabs.get(2).triggerEl, "keydown", { key: "Delete" }),
  "close-chord": s => s.dispatch(s.c.tabs.get(2).triggerEl, "keydown", { key: "w", metaKey: true }),
  "close-command": s => s.actions.get("tabs.close")(),
  "close-direct": s => s.closeTab(2),
  "close-split": s => s.actions.get("split.close")(),
};

async function olderOpen(t, kind, outcome, action, options) {
  const s = shell(t, options);
  s.seed("one"); s.splitPane("row"); s.seed("two");
  const old = kind === "terminal" ? s.openTerminalTabFlow("one", () => assert.fail("stale refusal"))
    : s.openViewTab("markdown", "old artifact", {}, "file:old");
  await flush();
  const request = (kind === "terminal" ? s.requests : s.loads).at(-1);
  assert.ok(request, "open is pending at its shipped async boundary");
  actions[action](s);
  const selected = s.c.activeTab, ids = [...s.c.tabs.keys()], focused = s.document.activeElement;
  if (outcome === "resolve") request.resolve(kind === "terminal" ? { instances: [] } : { mount() {} });
  else request.reject(new Error("older selection failed"));
  await old;
  assert.equal(s.c.activeTab, selected, "older open must not replace explicit selection");
  assert.deepEqual([...s.c.tabs.keys()], ids, "stale artifact success/error must not create a tab");
  assert.equal(s.document.activeElement, focused, "no late focus steal");
  assert.equal(s.attachments.length, 0, "selection never reacquires a retained terminal");
}

for (const kind of ["terminal", "artifact"]) for (const outcome of ["resolve", "reject"]) {
  for (const action of Object.keys(actions)) {
    test(`${action} supersedes older ${kind} ${outcome}`, t => olderOpen(t, kind, outcome, action));
  }
}

for (const action of ["cycle", "pointer", "focus", "active-pointer", "active-focus", "close-split", "close-button", "inactive-close-button"]) {
  test(`delayed attachment after ${action}: retain lifetime, never steal focus`, async t => {
    const s = shell(t);
    s.seed("one"); s.splitPane("row");
    const pending = await s.pending("two");
    assert.equal(pending.id, 2);
    actions[action](s);
    const focus = s.document.activeElement;
    pending.gate.resolve({ id: 71 }); await pending.result;
    assert.equal(pending.term.focuses, 0, "visibility (including a split) is insufficient focus authority");
    assert.equal(s.document.activeElement, focus);
    assert.equal(s.attachments.length, 1);
    const closed = action === "close-button";
    assert.equal(pending.term.disposed, closed ? 1 : 0);
    assert.deepEqual(s.detached, closed ? [71] : [], "only explicit close detaches");
  });
}

for (const outcome of ["resolve", "reject"]) for (const visits of [["B"], ["B", "A"]]) {
  test(`pending attachment ${outcome} across ${["A", ...visits].join("→")} cannot focus, detach or reacquire`, async t => {
    const s = shell(t), pending = await s.pending("one");
    const entry = s.document.getElementById("entry"); entry.focus();
    for (const workspace of visits) s.switchTo(workspace);
    if (outcome === "resolve") pending.gate.resolve({ id: 72 });
    else pending.gate.reject(new Error("attachment unavailable"));
    await pending.result;
    assert.equal(pending.term.focuses, 0);
    assert.equal(s.document.activeElement, entry);
    assert.equal(s.attachments.length, 1); assert.deepEqual(s.detached, []);
    assert.equal(pending.term.disposed, 0, "retained error/success still belongs to its tab");
    assert.equal(s.c.tabs.get(pending.id).paneEl.hidden, visits.at(-1) !== "A");
  });
}

test("fresh open and later direct focus work; pending focus uses the NEW explicit owner", async t => {
  const s = shell(t), first = await s.pending("one");
  assert.equal(first.term.focuses, 0, "no input focus before attachment readiness");
  first.gate.resolve({ id: 73 }); await first.result;
  assert.equal(first.term.focuses, 1, "normal direct open focuses exactly once (including native focusin)");
  s.document.getElementById("entry").focus();
  s.actions.get("terminal.focusActive")();
  assert.equal(first.term.focuses, 2);
  const second = await s.pending("two");
  s.switchTo("B"); s.switchTo("A");
  // Later explicit jump to an already-open pending terminal must not be tied
  // to its original open ticket, and must not start another acquisition.
  const reopened = s.openTerminalTabFlow("two", () => assert.fail("refusal"));
  s.requests.at(-1).resolve({ instances: [] }); await reopened;
  assert.equal(second.term.focuses, 0);
  second.gate.resolve({ id: 74 }); await second.result;
  assert.equal(second.term.focuses, 1);
  assert.equal(s.document.activeElement, second.term.input);
  assert.equal(s.attachments.length, 2); assert.deepEqual(s.detached, []);
});

test("focusActive on a pending tab schedules readiness focus without an extra attach", async t => {
  const s = shell(t), pending = await s.pending("one");
  s.c.tabs.get(pending.id).triggerEl.click(); // selection but no input focus
  s.actions.get("terminal.focusActive")();
  pending.gate.resolve({ id: 75 }); await pending.result;
  assert.equal(pending.term.focuses, 1); assert.equal(s.attachments.length, 1);
});

test("strip focus, side-effect projection and workspace restoration do not focus retained ready inputs", async t => {
  const s = shell(t), pending = await s.pending("one");
  pending.gate.resolve({ id: 76 }); await pending.result;
  const entry = s.document.getElementById("entry"); entry.focus();
  s.activateTab(pending.id); s.switchTo("B"); s.switchTo("A");
  s.c.tabs.get(pending.id).triggerEl.click();
  assert.equal(pending.term.focuses, 1); assert.equal(s.document.activeElement, entry);
  assert.equal(s.attachments.length, 1); assert.deepEqual(s.detached, []);
});

for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) for (const mod of ["ctrlKey", "altKey", "metaKey", "shiftKey"]) {
  test(`shipped strip leaves ${mod}+${key} unconsumed and does not supersede a pending open`, async t => {
    const s = shell(t); s.seed("one"); s.seed("two");
    const old = s.openTerminalTabFlow("one", () => assert.fail("refusal"));
    assert.equal(s.dispatch(s.c.tabs.get(2).triggerEl, "keydown", { key, [mod]: true }), true);
    s.requests.at(-1).resolve({ instances: [] }); await old;
    assert.equal(s.c.activeTab, 1, "modifier chord did not issue a local selection");
  });
}

// Mutation checks run only in memory. Never modify shared worktree source.
function mutatedFactory(fn, from, to, deps = {}) {
  assert.ok(fn.toString().includes(from), "mutation still targets the essential guard");
  return runInNewContext(`(${fn.toString().replace(from, to)})`, deps);
}

for (const outcome of ["resolve", "reject"]) {
  test(`mutation: selection serial guard is essential on older ${outcome}`, async t => {
    const ownership = mutatedFactory(createSelectionOwnership, "token === serial &&", "");
    await assert.rejects(olderOpen(t, "artifact", outcome, "cycle", { ownership }), /older open must not replace explicit selection/);
  });
  test(`mutation: cycle must use explicit selection on older ${outcome}`, async t => {
    const shellSource = source.replace("  selectTab(nextId);", "  activateTab(nextId);");
    assert.notEqual(shellSource, source);
    await assert.rejects(olderOpen(t, "artifact", outcome, "cycle", { shellSource }), /older open must not replace explicit selection/);
  });
}

async function generationRace(t, outcome, ownership = createSelectionOwnership) {
  const s = shell(t, { ownership }); s.seed("one"); s.seed("two");
  const old = s.openTerminalTabFlow("one", () => assert.fail("refusal"));
  // Bypass the shell listener to isolate global generation from its separate
  // invalidation. This matches a completion racing workspace notification.
  s.switchTo("B", false); s.switchTo("A", false);
  if (outcome === "resolve") s.requests.at(-1).resolve({ instances: [] });
  else s.requests.at(-1).reject(new Error("old workspace failure"));
  await old;
  assert.equal(s.c.activeTab, 2, "global workspace generation must reject the old visit");
}
for (const outcome of ["resolve", "reject"]) {
  test(`workspace generation alone rejects older ${outcome}`, t => generationRace(t, outcome));
  test(`mutation: workspace generation is essential for older ${outcome}`, async t => {
    const ownership = mutatedFactory(createSelectionOwnership, "&& generation === workspaceGeneration()", "");
    await assert.rejects(generationRace(t, outcome, ownership), /global workspace generation|old workspace failure/);
  });
}

test("mutation: readiness must consult current focus ownership, not pane visibility", async t => {
  async function run(terminal = createTerminalTab) {
    const s = shell(t, { terminal }); s.seed("one"); s.splitPane("row");
    const pending = await s.pending("two");
    s.c.tabs.get(2).triggerEl.click(); // still active and visible, but strip owns focus
    pending.gate.resolve({ id: 77 }); await pending.result;
    assert.equal(pending.term.focuses, 0, "readiness must not steal focus");
  }
  await run();
  const terminal = mutatedFactory(createTerminalTab, "!ownsFocus()", "!isActive()", { createTermLifecycle, terminalKeyDecision });
  await assert.rejects(run(terminal), /readiness must not steal focus/);
});

test("closing a newer tab restores a pending retained terminal without reviving its focus intent", async t => {
  const s = shell(t), pending = await s.pending("one");
  s.seed("two"); s.closeTab(2, true);
  assert.equal(s.c.activeTab, 1);
  const focused = s.document.activeElement;
  pending.gate.resolve({ id: 78 }); await pending.result;
  assert.equal(pending.term.focuses, 0); assert.equal(s.document.activeElement, focused);
  assert.equal(s.attachments.length, 1); assert.deepEqual(s.detached, []);
});

test("direct jump that rehomes a focused retained pane keeps its selection ticket", async t => {
  const s = shell(t), pending = await s.pending("one");
  pending.gate.resolve({ id: 79 }); await pending.result;
  s.splitPane("row");
  const open = s.openTerminalTabFlow("one", () => assert.fail("refusal"));
  s.requests.at(-1).resolve({ instances: [] }); await open;
  assert.equal(s.c.activeTab, 1);
  assert.equal(s.tabOpenIntents.ownsFocus(1), true, "projection's focus restoration is not a new intent");
  assert.equal(s.document.activeElement, pending.term.input);
  assert.equal(pending.term.focuses, 2);
  assert.equal(s.attachments.length, 1); assert.deepEqual(s.detached, []);
});

test("mutation: the shell must bind readiness to its current tab focus ticket", async t => {
  async function run(shellSource = source) {
    const s = shell(t, { shellSource }), pending = await s.pending("one");
    s.switchTo("B"); s.switchTo("A");
    pending.gate.resolve({ id: 80 }); await pending.result;
    assert.equal(pending.term.focuses, 0, "restoring active tab must not revive old focus");
  }
  await run();
  const shellSource = source.replace("&& tabOpenIntents.ownsFocus(made.id)", "");
  assert.notEqual(shellSource, source);
  await assert.rejects(run(shellSource), /restoring active tab must not revive old focus/);
});

for (const outcome of ["resolve", "reject"]) {
  for (const [action, from, to] of [
    ["pointer", "select: () => selectTab(id)", "select: () => activateTab(id)"],
    ["close-direct", "if (explicit) tabOpenIntents.invalidate();", "/* mutation: close does not supersede */"],
  ]) test(`mutation: ${action} ownership boundary is essential on older ${outcome}`, async t => {
    const shellSource = source.replace(from, to); assert.notEqual(shellSource, source);
    await assert.rejects(olderOpen(t, "artifact", outcome, action, { shellSource }), /older open must not replace explicit selection/);
  });

  for (const action of ["pointerdown", "focusin", "close-last"]) {
    test(`flat ${action} supersedes an older artifact ${outcome}`, async t => {
      const s = shell(t); s.seed("one");
      const old = s.openViewTab("markdown", "old artifact", {}, "file:old"); await flush();
      if (action === "close-last") s.c.tabs.get(1).closeEl.click();
      else s.dispatch(s.c.tabs.get(1).paneEl, action);
      const focused = s.document.activeElement;
      if (outcome === "resolve") s.loads.at(-1).resolve({ mount() {} });
      else s.loads.at(-1).reject(new Error("older artifact failure"));
      await old;
      assert.equal(s.c.tabs.size, action === "close-last" ? 0 : 1);
      assert.equal(s.document.activeElement, focused);
      if (action === "close-last") {
        assert.equal(s.c.tabLayerVisible, false);
        assert.equal(focused, s.document.getElementById("entry"));
      }
    });
  }
}

const roster = ["one", "two"].map(instance => ({ instance, running: true, agentsRoot: "/team/agents", home: `/team/${instance}` }));
function sidebarIntent(s, kind) {
  const filter = s.document.getElementById("entry");
  if (kind === "pointer-filter") {
    // A pointerdown is still an intent when the filter was already focused
    // before the open began and the browser emits no new focusin.
    s.dispatch(filter, "pointerdown"); filter.focus();
  } else if (kind === "keyboard-filter") {
    // JSDOM does not implement Tab's default focus traversal. Use native DOM
    // focus (which emits focusin), not a synthetic focusin or focusRoster().
    filter.focus();
  } else if (kind === "keyboard-roster") {
    s.dispatch(s.document.activeElement, "keydown", { key: "ArrowDown" });
  } else if (kind === "pointer-sidebar") {
    s.dispatch(s.c.navEl.querySelector("button"), "pointerdown");
    s.c.navEl.querySelector("button").focus();
  } else s.focusRoster();
}
function prepareSidebar(s, kind) {
  s.c.contextInstances = roster; s.renderContextRoster(roster);
  if (kind === "keyboard-roster") s.c.contextRosterEl.querySelector(".ctx-inst").focus();
  else if (["pointer-filter", "command-filter"].includes(kind)) s.focusRoster();
}

async function sidebarAttachment(t, kind, outcome, shellSource = source) {
  const s = shell(t, { shellSource }); prepareSidebar(s, kind);
  const pending = await s.pending("pending");
  sidebarIntent(s, kind);
  const focused = s.document.activeElement;
  assert.ok(s.document.getElementById("sidebar").contains(focused));
  if (kind === "keyboard-roster") assert.equal(focused.dataset.treeInstance, roster[1].home);
  if (outcome === "resolve") pending.gate.resolve({ id: 81 });
  else pending.gate.reject(new Error("late attachment failure"));
  await pending.result;
  assert.equal(pending.term.focuses, 0, "sidebar owns input, not the attaching terminal");
  assert.equal(s.document.activeElement, focused);
  assert.equal(s.c.activeTab, pending.id, "focus cancellation does not dispose or hide the selected pane");
  assert.equal(pending.term.disposed, 0); assert.deepEqual(s.detached, []);
  assert.equal(s.attachments.length, 1);
}

for (const kind of ["pointer-filter", "keyboard-filter", "keyboard-roster", "pointer-sidebar", "command-filter"]) {
  for (const outcome of ["resolve", "reject"]) test(`sidebar ${kind} revokes delayed attachment focus on ${outcome} without closing it`, async t => {
    await sidebarAttachment(t, kind, outcome);
  });

  for (const outcome of ["resolve", "reject"]) test(`sidebar ${kind} supersedes an older pre-attachment open ${outcome}`, async t => {
    const s = shell(t); prepareSidebar(s, kind); s.seed("one");
    const pending = s.openTerminalTabFlow("two", () => assert.fail("stale refusal"));
    sidebarIntent(s, kind);
    const focused = s.document.activeElement;
    if (outcome === "resolve") s.requests.at(-1).resolve({ instances: [] });
    else s.requests.at(-1).reject(new Error("older request failure"));
    await pending;
    assert.equal(s.c.activeTab, 1); assert.equal(s.c.tabs.size, 1);
    assert.equal(s.attachments.length, 0); assert.equal(s.document.activeElement, focused);
  });
}

test("roster polling restores logical focus without superseding a terminal selection or readiness", async t => {
  const s = shell(t); prepareSidebar(s, "keyboard-roster");
  const pending = await s.pending("pending");
  const owner = s.tabOpenIntents.ownsFocus(pending.id);
  assert.equal(owner, true);
  s.renderContextRoster(roster); // real DOM replacement + focus restoration
  assert.equal(s.document.activeElement.dataset.treeInstance, roster[0].home);
  assert.equal(s.tabOpenIntents.ownsFocus(pending.id), true, "restored row focus is not new user intent");
  pending.gate.resolve({ id: 82 }); await pending.result;
  assert.equal(pending.term.focuses, 1);
  assert.equal(s.document.activeElement, pending.term.input);
  assert.equal(s.attachments.length, 1); assert.deepEqual(s.detached, []);
});

function ambiguousClusterGuides(t, ambiguity, shellSource = source) {
  const s = shell(t, { shellSource });
  const full = [
    { instance: "parent", home: "/a/parent", agentsRoot: "/a/agents", siblingInstance: "worker", running: true },
    { instance: "parent", home: "/b/parent", agentsRoot: ambiguity === "same-root" ? "/a/agents" : "/b/agents", running: true },
    { instance: "worker", home: "/c/worker", agentsRoot: ambiguity === "same-root" ? "/a/agents" : "/c/agents", parentInstance: "parent", running: true },
    { instance: "child", home: "/c/child", agentsRoot: "/c/agents", parentInstance: "worker", running: true },
  ];
  assert.equal(instanceTree.visibleClusters(full, full).length, 2, "duplicate parent is outside the worker's cluster");
  s.renderContextRoster(full);
  const rows = [...s.document.querySelectorAll(".ctx-tree-row")];
  assert.equal(rows.length, full.length, "ambiguity must not hide a row");
  const row = name => rows.find(r => r.querySelector(".ctx-name").textContent === name);
  assert.equal(row("worker").querySelectorAll(".ctx-guide").length, 0, "shipped caller must not forge an ambiguous parent guide");
  assert.equal(row("child").querySelectorAll(".ctx-guide.end").length, 1, "unambiguous parent still draws its elbow");
}
for (const ambiguity of ["same-root", "cross-root"]) {
  test(`shipped roster guides use the full roster for ${ambiguity} ambiguity across clusters`, t => ambiguousClusterGuides(t, ambiguity));
  test(`mutation: omitting the full roster for ${ambiguity} guides is caught at the shipped caller`, t => {
    const mutant = source.replace("treeGuideSegments(items, i, instances)", "treeGuideSegments(items, i)");
    assert.notEqual(mutant, source);
    assert.throws(() => ambiguousClusterGuides(t, ambiguity, mutant), /shipped caller must not forge/);
  });
}

for (const [kind, from] of [
  ["pointer-filter", 'sidebar.addEventListener("pointerdown", () => tabOpenIntents.invalidate());'],
  ["keyboard-filter", 'if (!tabOpenIntents.isApplyingFocus()) tabOpenIntents.invalidate();'],
  ["command-filter", 'tabOpenIntents.invalidate(); // also when the filter already has DOM focus'],
]) test(`mutation: sidebar ${kind} must revoke pending content-focus authority`, async t => {
  const mutant = source.replace(from, "/* mutation: sidebar did not cancel */");
  assert.notEqual(mutant, source);
  await assert.rejects(sidebarAttachment(t, kind, "resolve", mutant), /sidebar owns input/);
});
