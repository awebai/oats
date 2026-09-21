// File/focus handoffs at the shipped shell composition, not a replica of its
// selection policy. Only browser chooser, dynamic import, HTTP and xterm/IPC
// boundaries are synthetic. No native dialog, server, Electron or operator state.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { JSDOM } from "jsdom";
import { createFileOpener } from "../renderer/open-file.mjs";
import { createPalette } from "../renderer/palette.mjs";
import { createQuickOpen } from "../renderer/quick-open.mjs";
import { createSelectionOwnership, wirePaneSelection } from "../renderer/selection-ownership.mjs";
import { createIntentGate, prepareOwnedOpen } from "../renderer/open-intent.mjs";
import { createViewLifecycle } from "../renderer/view-lifecycle.mjs";
import { createTerminalTab, terminalOptions } from "../renderer/terminal-tab.mjs";
import { createTabChrome, tabKeyAction, focusAfterLastTab } from "../renderer/tab-a11y.mjs";
import { reserveKey, whenKeyFree } from "../renderer/tab-keys.mjs";
import { createWorkspaceTabMemory } from "../renderer/workspace-tab-memory.mjs";
import { splitControlsState } from "../renderer/split-controls.mjs";
import { projectSplitDom } from "../renderer/split-dom.mjs";
import { instanceActions, captureInstanceActionMenu } from "../renderer/instance-actions.mjs";
import { runtimeState } from "../renderer/instance-presentation.mjs";
import { createRuntimeBadge } from "../renderer/identity-marks.mjs";
import { THEMES } from "../renderer/theme.mjs";
import { rosterKeyAction, moveTarget } from "../renderer/roster-keys.mjs";
import * as tree from "../renderer/instance-tree.mjs";
import * as layout from "../renderer/split-layout.mjs";
import * as workspaceTabs from "../renderer/workspace-tabs.mjs";
import * as markdown from "../renderer/views/markdown.mjs";

const source = readFileSync(new URL("../renderer/shell.mjs", import.meta.url), "utf8");
const keySource = readFileSync(new URL("../renderer/keybindings.mjs", import.meta.url), "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function block(src, start, end) {
  const a = src.indexOf(start), b = src.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `shipped composition still exposes ${start}`);
  return src.slice(a, b);
}
function fn(src, name) {
  const match = src.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`));
  assert.ok(match, `execute shipped ${name}`);
  return match[0];
}
function picked(name = "notes.md") {
  const read = deferred(), file = new File(["# Supporting artifact"], name);
  let reads = 0;
  Object.defineProperty(file, "text", { value: () => { reads++; return read.promise; } });
  for (const key of ["path", "webkitRelativePath"]) Object.defineProperty(file, key, {
    get: () => assert.fail(`picked file must not discover ${key}`),
  });
  return { file, read, reads: () => reads };
}

function shell(t, shellSource = source, platform = "MacIntel") {
  const dom = new JSDOM(`<!doctype html><body><span id="ws-context"></span>
    <div id="stagehost"></div>
    <div id="tabstrip"><div id="tabbar-row"><div id="tabbar"></div><div id="tab-actions"></div></div></div>
    <div id="tabhost"></div>
    <aside id="sidebar"><div id="instance-roster"><input class="ctx-filter" id="filter"><span class="ctx-count"></span><div class="ctx-list"></div></div>
    <nav id="nav"><button class="nav-item active">Souls</button></nav></aside>
    <button id="destination">Newer destination</button>
  </body>`, { url: "http://127.0.0.1/" });
  const document = dom.window.document, navigator = { platform };
  // A fresh copy of the actual engine gets only this JSDOM's localStorage.
  const keys = runInNewContext(`${keySource.replace(/^export /gm, "")}\n({ registerAction, runAction, getBinding, setBinding, resetBinding, listActions, matchEvent, handleKeydown, formatChord });`,
    { navigator, localStorage: dom.window.localStorage });
  const requests = [], loads = [], chooserInputs = [], tickets = [], opens = [], attachments = [], terms = [], detached = [], notices = [], listeners = [];
  dom.window.HTMLInputElement.prototype.click = function () {
    assert.equal(this.type, "file"); chooserInputs.push(this); // never launch a native chooser
  };
  const c = {
    document, window: dom.window, navigator, console, ...keys, THEMES,
    workspace: "A", generation: 0, tabWorkspace: "A", contextWorkspace: "A",
    tabs: new Map(), nextTabId: 1, activeTab: null, split: null, sidebarMode: "instances", tabLayerVisible: false,
    contextRosterGen: 0, contextInstances: [], contextFilter: "", collapsedInstances: new Set(), contextRosterEl: null,
    wsActiveTerminal: new Map(), pendingTerms: new Set(), brainIntents: createIntentGate(), workspaceTabMemory: createWorkspaceTabMemory(),
    tabbar: document.getElementById("tabbar"), tabhost: document.getElementById("tabhost"),
    tabActionsEl: document.getElementById("tab-actions"),
    stageHost: document.getElementById("stagehost"), stage: { name: "spawn" }, navEl: document.getElementById("nav"),
    currentWorkspace: () => c.workspace, workspaceGeneration: () => c.generation,
    updateActiveContexts: on => { c.tabLayerVisible = on; },
    // Inert presenter: this fixture owns file/chooser focus, not panel layout.
    syncContextPanel() {}, contextPanel: { setFocusMode() {} },
    updateSplitControls() {}, refreshContextRoster() {}, setNavActive() {}, setSidebarHidden() {}, stageSidebarMode: () => "souls",
    workspaceLabel: { reset() {} }, NAV: [], ctx: {},
    alert: message => notices.push(message), onWorkspaceChange: listener => listeners.push(listener),
    api(path) { const request = { ...deferred(), path }; requests.push(request); return request.promise; },
    loadView(name) { const gate = { ...deferred(), name }; loads.push(gate); return gate.promise; },
    createFileOpener(options) {
      return createFileOpener({ ...options,
        beginIntent: () => { const ticket = options.beginIntent(); tickets.push(ticket); return ticket; },
        openFile: (file, owns) => {
          const done = options.openFile(file, owns); opens.push({ file, owns, done }); return done;
        },
      });
    },
    createPalette(options) {
      // createPalette intentionally defaults to the renderer's document.
      const previous = globalThis.document;
      try { globalThis.document = document; return createPalette(options); }
      finally { globalThis.document = previous; }
    },
    createQuickOpen: options => createQuickOpen({ ...options, doc: document }),
    createSelectionOwnership, wirePaneSelection, prepareOwnedOpen, createViewLifecycle,
    createTabChrome, tabKeyAction, focusAfterLastTab, reserveKey, whenKeyFree, projectSplitDom, splitControlsState,
    ...tree, ...layout, ...workspaceTabs, instanceActions, captureInstanceActionMenu, runtimeState, createRuntimeBadge, rosterKeyAction, moveTarget,
    terminalOptions, terminalTypography: () => ({ fontSize: 13, fontFamily: "mono" }), xtermTheme: () => ({}),
    onThemeChange: () => () => {}, onTerminalTypographyChange: () => () => {}, requestAnimationFrame: cb => cb(),
    FitAddon: { FitAddon: class { fit() {} } },
    createTerminalTab: options => createTerminalTab({ ...options, observe: () => () => {} }),
    Terminal: class {
      constructor() { this.cols = 80; this.rows = 24; this.focuses = 0; this.disposed = 0; terms.push(this); }
      loadAddon() {} onData() {} onResize() {} write() {}
      open(wrap) { wrap.classList.add("xterm"); this.input = document.createElement("textarea"); wrap.append(this.input); }
      attachCustomKeyEventHandler(handler) { this.keyHandler = handler; }
      focus() { this.focuses++; this.input.focus(); }
      dispose() { this.disposed++; }
    },
    desk: {
      termOpen(spec) { const gate = { ...deferred(), spec }; attachments.push(gate); return gate.promise; },
      termClose: id => detached.push(id), termWrite: () => assert.fail("file commands must not write terminal bytes"), termResize() {},
      onTermData: () => () => {}, onTermExit: () => () => {},
    },
  };
  const names = ["setSidebarMode", "updateContextTabs", "showTabLayer", "renderSplit", "selectEmptyGroup", "splitPane", "closeSplit", "restoreTerminalGroups", "onTabKeydown",
    "addTab", "selectTab", "activateTab", "closeTab", "openViewTab", "renderWorkspaceContext", "restoreWorkspaceTabs", "showTerminalContext",
    "initContextRoster", "renderContextRoster", "onRosterRowKey", "setRovingRow", "focusRoster", "openTerminalTabFlow", "openTerminalTabInner"];
  const functions = names.map(name => fn(shellSource, name)).join("\n")
    .replace('import(`./views/${name}.mjs`)', "loadView(name)");
  assert.ok(functions.includes("load: () => loadView(name)"), "only dynamic import is replaced, not open/ownership logic");
  const setup = shellSource.match(/const tabOpenIntents = [^\n]+/)[0];
  const fileComposition = block(shellSource, "let nextPickedFileId =", "// ── editor groups");
  const pickers = block(shellSource, 'const isMac = navigator.platform.includes("Mac");', "// ── shortcuts editor");
  const registration = shellSource.match(/const unregisterOpenFile = registerAction[^\n]+/)[0]
    + "\nconst unregisterQuickOpen = " + shellSource.match(/registerAction\(\{ id: "app\.quickOpenSouls"[^\n]+/)[0];
  const listener = shellSource.match(/window.addEventListener\("keydown", [^\n]+/)[0];
  const s = runInNewContext(`${setup}\n${functions}\n${fileComposition}\n${pickers}\n${registration}\n${listener}\n({ ${names.join(", ")}, tabOpenIntents, fileOpener, palette, quickOpen, unregisterOpenFile, unregisterQuickOpen });`, c);
  s.initContextRoster();
  t.after(() => { s.palette.close(); s.quickOpen.close(); s.fileOpener.dispose(); s.unregisterOpenFile(); s.unregisterQuickOpen(); markdown.unmount(); dom.window.close(); });
  const key = (value, modifiers = {}, target = document.activeElement) => {
    const event = new dom.window.KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...modifiers });
    target.dispatchEvent(event); return event;
  };
  const change = (input, files) => {
    Object.defineProperty(input, "files", { configurable: true, value: files });
    input.dispatchEvent(new dom.window.Event("change"));
  };
  return {
    ...s, c, keys, document, window: dom.window, requests, loads, chooserInputs, tickets, opens, attachments, terms, detached, notices, key, change,
    cancel: input => input.dispatchEvent(new dom.window.Event("cancel")),
    roster(instances) { c.contextInstances = instances; s.renderContextRoster(instances); },
    control(instance, control = "terminal") {
      return [...document.querySelectorAll("[data-tree-instance][data-tree-control]")]
        .find(el => el.dataset.treeInstance === tree.instanceId(instance) && el.dataset.treeControl === control);
    },
    seed(title = "Existing terminal") { return s.addTab({ title, key: `term:${c.workspace}:${title}`, kind: "terminal" }).id; },
    switchTo(workspace) { c.workspace = workspace; c.generation++; listeners.forEach(listener => listener()); s.restoreWorkspaceTabs(); },
    async picker(which = "palette") {
      const done = s[which].open(); requests.at(-1).resolve(which === "palette" ? { instances: [] } : { agents: [{ name: "reviewer" }] }); await done;
    },
    command(query) {
      const input = document.querySelector(".palette-input");
      input.value = `>${query}`; input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      const rows = document.querySelectorAll('[role="option"]'); assert.equal(rows.length, 1, `one command for ${query}`);
      return rows[0];
    },
    choose(file) { keys.runAction("app.openFile"); change(chooserInputs.at(-1), [file]); return opens.at(-1); },
    async pendingTerminal() {
      const inst = { instance: "pending", home: "/synthetic/pending", running: true, tmux: { session: "synthetic", window: "pending" } };
      const done = s.openTerminalTabFlow(inst, message => assert.fail(message));
      requests.at(-1).resolve({ instances: [inst] }); await tick();
      assert.equal(attachments.length, 1);
      return { done, gate: attachments[0], term: terms[0], id: c.activeTab };
    },
  };
}

// Duplicate names AND duplicate paths on different servers must stay distinct.
// Quotes/brackets exercise identity comparison without unsafe CSS interpolation.
const parent = { instance: "worker", agentsRoot: '/team/"[agents]', home: '/team/"[home]', running: true };
const child = { instance: "child", agentsRoot: parent.agentsRoot, home: "/team/child", parentInstance: "worker", running: true };
const twin = { ...parent, server: "remote", savedRoute: true };
const remoteChild = { ...child, server: "remote", savedRoute: true };
const roster = [parent, child, twin, remoteChild];

async function rosterAttachment(t, action, outcome, shellSource = source) {
  const s = shell(t, shellSource); s.roster(roster);
  if (action === "expand") { s.c.collapsedInstances.add(tree.collapseKey("A", tree.instanceId(parent))); s.roster(roster); }
  s.control(parent).focus();
  const pending = await s.pendingTerminal();
  assert.equal(s.tabOpenIntents.ownsFocus(pending.id), true);
  const original = s.control(parent);
  if (action !== "poll-only") assert.equal(s.key(action === "collapse" ? "ArrowLeft" : "ArrowRight").defaultPrevented, true);
  s.roster(roster); // a later poll restores the very same logical control
  const replacement = s.control(parent);
  assert.notEqual(original, replacement); assert.equal(original.isConnected, false);
  assert.equal(s.document.activeElement, replacement);
  assert.equal(replacement.dataset.rosterCollapsed, action === "collapse" ? "1" : "0");
  if (outcome === "resolve") pending.gate.resolve({ id: 41 });
  else pending.gate.reject(new Error("synthetic attach failure"));
  await pending.done;
  const shouldFocus = action === "poll-only" && outcome === "resolve";
  assert.equal(pending.term.focuses, shouldFocus ? 1 : 0, "keyboard collapse/expand must revoke pending attachment focus even after polling restores the row");
  assert.equal(s.document.activeElement, shouldFocus ? pending.term.input : replacement);
  assert.equal(s.c.activeTab, pending.id); assert.equal(pending.term.disposed, 0); assert.deepEqual(s.detached, []);
}
for (const action of ["collapse", "expand", "poll-only"]) for (const outcome of ["resolve", "reject"]) {
  test(`roster ${action} followed by logical row replacement: attachment ${outcome}`, t => rosterAttachment(t, action, outcome));
}

for (const picker of ["palette", "quickOpen", "palette→quickOpen"]) for (const control of ["terminal", "disclosure"]) {
  test(`${picker} cancellation restores replaced composite-identity ${control}, not its remote same-name twin`, async t => {
    const s = shell(t); s.roster(roster);
    const original = s.control(twin, control); original.focus();
    await s.picker(picker === "palette→quickOpen" ? "palette" : picker);
    if (picker === "palette→quickOpen") { s.command("souls: quick").click(); s.requests.at(-1).resolve({ agents: [{ name: "reviewer" }] }); await tick(); }
    s.roster([...roster].reverse());
    assert.equal(original.isConnected, false);
    const replacement = s.control(twin, control);
    assert.equal(s.key("Escape").defaultPrevented, true);
    assert.equal(s.document.activeElement, replacement);
    assert.notEqual(s.document.activeElement, s.control(parent, control));
    assert.equal(s.document.querySelector(".palette-overlay"), null);
    assert.equal(s.key("Tab").defaultPrevented, false, "no stale picker trap");
  });
}

for (const picker of ["palette", "quickOpen"]) for (const unavailable of ["gone", "disabled", "hidden"]) {
  test(`${picker} cancel uses a connected safe fallback when original roster control is ${unavailable}`, async t => {
    const s = shell(t); s.roster(roster); s.control(twin).focus(); await s.picker(picker);
    s.roster(unavailable === "gone" ? [parent, child] : roster);
    const replacement = s.control(twin);
    if (unavailable === "disabled") replacement.disabled = true;
    if (unavailable === "hidden") replacement.closest(".ctx-tree-row").style.display = "none";
    s.key("Escape");
    assert.equal(s.document.activeElement, s.document.getElementById("filter"), "return to the connected roster entry, never BODY/detached/disabled/hidden nodes");
  });
}

for (const route of ["command-click", "command-Enter", "shortcut"]) for (const event of ["cancel", "empty-change"]) {
  test(`palette → native file chooser via ${route}: ${event} returns to the replaced original opener`, async t => {
    const s = shell(t); s.roster(roster); const original = s.control(twin); original.focus();
    let returns = 0; original.addEventListener("focus", () => returns++);
    await s.picker();
    if (route === "shortcut") assert.equal(s.key("o", { metaKey: true }).defaultPrevented, true);
    else { const row = s.command("file: open"); if (route === "command-click") row.click(); else s.key("Enter"); }
    assert.equal(s.chooserInputs.length, 1, "input.click happens inside the initiating command/chord");
    const input = s.chooserInputs[0];
    assert.equal(s.document.querySelector(".palette-overlay"), null); assert.equal(returns, 0, "handoff never briefly focuses the opener");
    assert.equal(s.key("Tab").defaultPrevented, false);
    s.roster(roster);
    if (event === "cancel") s.cancel(input); else s.change(input, []);
    assert.equal(s.document.activeElement, s.control(twin));
    assert.equal(input.isConnected, false); assert.deepEqual(s.opens, []); assert.deepEqual(s.notices, []);
  });
}

for (const newer of ["selection", "sidebar-focus", "chooser", "workspace", "A→B→A"]) test(`stale native cancel after ${newer} never steals focus`, async t => {
  const s = shell(t); s.roster(roster); s.control(parent).focus(); await s.picker(); s.command("file: open").click();
  const old = s.chooserInputs[0], destination = s.document.getElementById("destination");
  if (newer === "selection") s.selectTab(s.seed());
  if (newer === "sidebar-focus") s.control(twin).focus();
  if (newer === "chooser") s.keys.runAction("app.openFile");
  if (newer === "workspace" || newer === "A→B→A") { s.switchTo("B"); if (newer === "A→B→A") s.switchTo("A"); }
  if (newer !== "sidebar-focus") destination.focus();
  const focused = s.document.activeElement; s.cancel(old);
  assert.equal(s.document.activeElement, focused); assert.deepEqual(s.opens, []); assert.deepEqual(s.notices, []);
  if (newer === "chooser") assert.equal(s.chooserInputs[1].isConnected, true, "old cancel cannot clean up a newer chooser");
});

test("successful palette file handoff does not return focus; late cancel cannot steal newer focus or revoke the picked file", async t => {
  const s = shell(t); s.roster(roster); const opener = s.control(parent); opener.focus(); let returns = 0;
  opener.addEventListener("focus", () => returns++);
  await s.picker(); s.command("file: open").click(); const input = s.chooserInputs[0], pick = picked();
  s.change(input, [pick.file]); await tick();
  const open = s.opens[0]; s.loads[0].resolve(markdown); await tick();
  const destination = s.document.getElementById("destination"); destination.focus();
  s.cancel(input); assert.equal(open.owns(), true, "settled native cancel must not revoke the successful pick");
  pick.read.resolve("# Completed"); await open.done;
  assert.equal(returns, 0); assert.equal(s.document.activeElement, destination);
  assert.ok(s.c.tabs.get(s.c.activeTab).paneEl.querySelector("h1"));
});

async function originalChooserTicket(t, shellSource = source) {
  const s = shell(t, shellSource), pick = picked();
  s.keys.runAction("app.openFile");
  const ticket = s.tickets[0]; assert.equal(ticket(), true);
  s.change(s.chooserInputs[0], [pick.file]); await tick();
  const ownsBeforeLoad = ticket();
  s.loads[0].resolve(markdown); await tick();
  const ownsAfterCreation = ticket();
  pick.read.resolve("# Original chooser ticket"); await s.opens[0].done;
  assert.equal(ownsBeforeLoad, true, "file arrival must retain the chooser's original ticket, not begin a replacement selection");
  assert.equal(ownsAfterCreation, true, "tab creation must retain the chooser's original ticket");
  assert.equal(s.tickets.length, 1);
  assert.ok(s.c.tabs.get(s.c.activeTab).paneEl.querySelector("h1"));
}
test("file arrival, module loading and tab creation keep the original chooser selection ticket", t => originalChooserTicket(t));

for (const outcome of ["resolve", "reject"]) for (const newer of ["selection", "chooser", "workspace", "A→B→A"]) {
  test(`chooser's original selection ticket rejects module ${outcome} after ${newer}`, async t => {
    const s = shell(t), id = s.seed(), pick = picked();
    const open = s.choose(pick.file); await tick();
    assert.equal(s.tickets[0](), true, "file arrival must not mint a new selection ticket");
    assert.equal(s.loads.length, 1); assert.equal(pick.reads(), 0, "read starts only after owned module loading/tab creation");
    if (newer === "selection") s.selectTab(id);
    if (newer === "chooser") s.keys.runAction("app.openFile");
    if (newer === "workspace" || newer === "A→B→A") { s.switchTo("B"); if (newer === "A→B→A") s.switchTo("A"); }
    const selected = s.c.activeTab, focused = s.document.activeElement;
    if (outcome === "resolve") s.loads[0].resolve(markdown); else s.loads[0].reject(new Error("old module failure"));
    await open.done;
    assert.equal(s.c.tabs.size, 1, "stale module success/error cannot create a file tab");
    assert.equal(pick.reads(), 0); assert.equal(s.c.activeTab, selected); assert.equal(s.document.activeElement, focused); assert.deepEqual(s.notices, []);
  });
}

for (const newer of ["selection", "workspace", "A→B→A"]) test(`native file selection arriving after ${newer} never enters module loading`, async t => {
  const s = shell(t), id = s.seed(), pick = picked(); s.keys.runAction("app.openFile"); const input = s.chooserInputs[0];
  if (newer === "selection") s.selectTab(id);
  else { s.switchTo("B"); if (newer === "A→B→A") s.switchTo("A"); }
  const focused = s.document.activeElement;
  s.change(input, [pick.file]); await tick();
  assert.deepEqual(s.opens, []); assert.deepEqual(s.loads, []); assert.equal(pick.reads(), 0);
  assert.equal(s.c.tabs.size, 1); assert.equal(s.document.activeElement, focused);
});

async function immutableRead(t, scenario, outcome, shellSource = source) {
  const s = shell(t, shellSource), terminalId = s.seed(), pick = picked();
  const open = s.choose(pick.file); await tick(); s.loads[0].resolve(markdown); await tick();
  const fileId = s.c.activeTab, tab = s.c.tabs.get(fileId), root = tab.paneEl.querySelector(".mdv"), before = root.innerHTML;
  assert.equal(pick.reads(), 1); assert.ok(root.querySelector(".mdv-loading"));
  if (scenario === "hidden") s.selectTab(terminalId);
  if (scenario === "workspace-B" || scenario === "A→B→A") { s.switchTo("B"); if (scenario === "A→B→A") s.switchTo("A"); }
  if (scenario === "new-chooser") s.keys.runAction("app.openFile");
  if (scenario === "closed") s.closeTab(fileId);
  const selected = s.c.activeTab, focused = s.document.activeElement;
  if (outcome === "resolve") pick.read.resolve("# Immutable completed artifact"); else pick.read.reject(new Error("private read failure"));
  await open.done; await tick();
  assert.equal(s.c.activeTab, selected, "read completion cannot activate a retained or closed tab");
  assert.equal(s.document.activeElement, focused, "read completion cannot steal newer focus");
  assert.equal(s.attachments.length, 0, "reading never attaches/reopens a terminal");
  if (scenario === "closed") {
    assert.equal(root.innerHTML, before, "closed tab must block even detached success/error paint");
    assert.equal(tab.paneEl.isConnected, false); assert.equal(s.c.tabs.has(fileId), false);
  } else {
    assert.equal(root.querySelector(".mdv-loading"), null, "retained immutable read must not remain permanently Loading after selection changes");
    if (outcome === "resolve") assert.match(root.querySelector("h1").textContent, /Immutable completed artifact/);
    else { assert.match(root.querySelector(".mdv-error").textContent, /could not be read/); assert.ok(!root.textContent.includes("private read failure")); }
    if (scenario === "workspace-B") s.switchTo("A");
    assert.equal(s.selectTab(fileId), true); assert.equal(tab.paneEl.hidden, false);
    assert.equal(root.querySelector(".mdv-loading"), null, "returning to the same retained tab shows its settled result");
    assert.equal(pick.reads(), 1, "no retry/reopen workaround for a lost completion");
  }
}
for (const scenario of ["current", "hidden", "workspace-B", "A→B→A", "new-chooser", "closed"]) for (const outcome of ["resolve", "reject"]) {
  test(`actual shell file read ${outcome} belongs to tab lifetime while ${scenario}`, t => immutableRead(t, scenario, outcome));
}

test("same-basename picks stay distinct normal workspace tabs beside retained terminals, not new destinations", async t => {
  const s = shell(t), terminal = s.seed(), files = [];
  for (const heading of ["First directory", "Second directory"]) {
    const pick = picked("same.md"), open = s.choose(pick.file); await tick(); s.loads.at(-1).resolve(markdown); await tick();
    const id = s.c.activeTab; pick.read.resolve(`# ${heading}`); await open.done; files.push([id, s.c.tabs.get(id)]);
  }
  assert.equal(s.c.tabs.size, 3); assert.equal(new Set(files.map(([, tab]) => tab.key)).size, 2, "basename is never a dedup key");
  assert.equal(s.c.sidebarMode, "instances", "a file is supporting content, not a new sidebar context");
  for (const [id, tab] of [[terminal, s.c.tabs.get(terminal)], ...files]) {
    assert.equal(tab.workspace, "A"); assert.equal(tab.tabEl.hidden, false);
    assert.equal(tab.tabEl.parentElement, s.c.tabbar); assert.equal(tab.triggerEl.getAttribute("role"), "tab");
    assert.equal(tab.paneEl.getAttribute("role"), "tabpanel"); assert.ok(tab.closeEl);
    assert.equal(s.selectTab(id), true);
  }
  assert.match(files[0][1].paneEl.textContent, /First directory/); assert.match(files[1][1].paneEl.textContent, /Second directory/);
  s.switchTo("B"); const otherTerminal = s.seed("B terminal"), b = picked("same.md"), openingB = s.choose(b.file);
  await tick(); s.loads.at(-1).resolve(markdown); await tick(); const bId = s.c.activeTab;
  b.read.resolve("# Workspace B"); await openingB.done;
  assert.equal(s.c.tabs.size, 5); assert.equal(s.c.tabs.get(bId).workspace, "B");
  for (const [id, tab] of files) { assert.equal(tab.tabEl.hidden, true); assert.equal(tab.paneEl.hidden, true); assert.equal(s.selectTab(id), false); }
  assert.equal(s.c.activeTab, bId); assert.equal(s.c.tabs.get(otherTerminal).tabEl.hidden, false);
  s.switchTo("A"); assert.equal(s.c.activeTab, files[1][0]); assert.equal(s.c.tabs.get(bId).tabEl.hidden, true);
  s.setSidebarMode("souls"); s.updateContextTabs();
  for (const [, tab] of files) assert.equal(tab.tabEl.hidden, false, "supporting files also remain visible beside souls");
  assert.equal(s.attachments.length, 0);
});

for (const platform of ["MacIntel", "Linux x86_64", "Win32"]) test(`app.openFile registration, rebind/unbind and terminal passthrough on ${platform}`, async t => {
  const s = shell(t, source, platform);
  const mac = platform === "MacIntel", mod = mac ? { metaKey: true } : { ctrlKey: true };
  assert.equal(s.keys.getBinding("app.openFile"), "Mod+O");
  assert.equal(s.keys.listActions().find(a => a.id === "app.openFile").context, "global");
  s.document.getElementById("destination").focus();
  assert.equal(s.key("o", mod).defaultPrevented, true); assert.equal(s.chooserInputs.length, 1); s.cancel(s.chooserInputs.at(-1));
  s.keys.setBinding("app.openFile", "Mod+Shift+Y");
  assert.equal(s.key("o", mod).defaultPrevented, false); assert.equal(s.chooserInputs.length, 1);
  assert.equal(s.key("y", { ...mod, shiftKey: true }).defaultPrevented, true); assert.equal(s.chooserInputs.length, 2); s.cancel(s.chooserInputs.at(-1));
  await s.picker(); const row = s.command("file: open");
  assert.equal(row.querySelector(".pdetail").textContent, s.keys.formatChord("Mod+Shift+Y", mac), "palette advertises effective binding");
  row.click(); assert.equal(s.chooserInputs.length, 3, "palette dispatches the same registered action after rebinding"); s.cancel(s.chooserInputs.at(-1));
  s.keys.setBinding("app.openFile", null);
  assert.equal(s.key("y", { ...mod, shiftKey: true }).defaultPrevented, false); assert.equal(s.chooserInputs.length, 3);
  assert.equal(s.keys.runAction("app.openFile"), true, "unbinding the chord keeps the shared action callable"); s.cancel(s.chooserInputs.at(-1));
  s.keys.resetBinding("app.openFile");
  const pending = await s.pendingTerminal(); pending.gate.resolve({ id: 42 }); await pending.done;
  let before = s.chooserInputs.length;
  for (const type of ["keydown", "keypress", "keyup"]) {
    const event = new s.window.KeyboardEvent(type, { key: "o", ...mod, cancelable: true });
    assert.equal(pending.term.keyHandler(event), !mac, "the actual shell → xterm interception follows terminal passthrough policy");
  }
  assert.equal(s.chooserInputs.length, before + (mac ? 1 : 0), "one chooser on macOS keydown only; no Linux/Windows Ctrl+O interception");
  if (mac) s.cancel(s.chooserInputs.at(-1));
  s.keys.setBinding("app.openFile", "Mod+Shift+Y"); before = s.chooserInputs.length;
  for (const type of ["keydown", "keypress", "keyup"]) {
    assert.equal(pending.term.keyHandler(new s.window.KeyboardEvent(type, { key: "y", ...mod, shiftKey: true })), !mac,
      "terminal policy follows the action across a custom Mod rebind");
  }
  assert.equal(s.chooserInputs.length, before + (mac ? 1 : 0));
  if (mac) s.cancel(s.chooserInputs.at(-1));
  s.keys.setBinding("app.openFile", "Ctrl+Y"); before = s.chooserInputs.length;
  assert.equal(pending.term.keyHandler(new s.window.KeyboardEvent("keydown", { key: "y", ctrlKey: true })), true, "custom Ctrl binding still belongs to the attached program");
  assert.equal(s.chooserInputs.length, before);
});

// Mutate only source strings in memory. Each assertion below has a passing
// unmodified counterpart above; no production file or scratch worktree edits.
test("mutation: file arrival must not mint a replacement selection ticket", async t => {
  const from = "const latest = selectionOwns ?? tabOpenIntents.begin();"; assert.ok(source.includes(from));
  await assert.rejects(originalChooserTicket(t, source.replace(from, "const latest = tabOpenIntents.begin();")), /file arrival must retain the chooser's original ticket/);
});
for (const action of ["collapse", "expand"]) test(`mutation: roster ${action} needs explicit selection invalidation`, async t => {
  const from = "  tabOpenIntents.invalidate(); // keyboard tree navigation is explicit, not a polling restoration";
  assert.ok(source.includes(from));
  await assert.rejects(rosterAttachment(t, action, "resolve", source.replace(from, "  // mutation: lost keyboard intent")), /keyboard collapse\/expand must revoke/);
});
for (const outcome of ["resolve", "reject"]) test(`mutation: immutable ${outcome} cannot keep selection ownership after tab creation`, async t => {
  const from = "owns: () => tabs.has(made.id),"; assert.ok(source.includes(from));
  await assert.rejects(immutableRead(t, "hidden", outcome, source.replace(from, "owns,")), /must not remain permanently Loading/);
});
for (const outcome of ["resolve", "reject"]) test(`mutation: closed file ${outcome} must check tab membership`, async t => {
  const from = "owns: () => tabs.has(made.id),"; assert.ok(source.includes(from));
  await assert.rejects(immutableRead(t, "closed", outcome, source.replace(from, "owns: () => true,")), /closed tab must block even detached/);
});
