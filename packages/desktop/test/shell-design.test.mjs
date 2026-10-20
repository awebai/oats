// Supplied shell structure exercised with the shipped composition and inert
// DOM/API/module-loader fixtures. No Electron, browser, server or live mutations.
import test from "node:test";
import { viewContext } from "./helpers/view-context.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { withShellWindowGlobals } from './helpers/shell-window-globals.mjs';
import { JSDOM } from "jsdom";
import { createContextPanel, contextPanelCSS } from "../renderer/context-panel.mjs";
import { createInstanceGitPanel } from "../renderer/instance-git.mjs";
import { createInstanceTeamsSection } from '../renderer/instance-teams.mjs';
import { createInstanceSoulSection } from '../renderer/instance-soul.mjs';
import { THEMES } from "../renderer/theme.mjs";
import { NAV } from "../renderer/shell-nav.mjs";
import { shellIcon, mountShellIcons } from "../renderer/shell-icons.mjs";
import { createSelectionOwnership } from "../renderer/selection-ownership.mjs";
import { createWorkspaceSwitcher } from "../renderer/workspace-switcher.mjs";
import { rosterResponseOwns, rosterSignature } from "../renderer/instance-tree-view.mjs";
import { staleWorkspaceSelection } from "../renderer/views/common.mjs";
import { createPendingWatch, NOT_SERVED_CODE, NO_ANSWER_CODE } from "../renderer/deployment-header.mjs";
import { DEFAULT_KEYMAP, TERMINAL_ALLOWLIST, registerAction, runAction, listActions, getBinding, formatChord, setActiveContexts, matchEvent, handleKeydown, setBinding, resetBinding, onKeymapChange, paletteGroupDirection, paletteGroupHint } from "../renderer/keybindings.mjs";

const source = readFileSync(new URL("../renderer/shell.mjs", import.meta.url), "utf8");
const html = readFileSync(new URL("../renderer/index.html", import.meta.url), "utf8");
const tick = () => new Promise(setImmediate);
const fn = (name, src = source) => {
  const found = src.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`));
  assert.ok(found, `exercise shipped ${name}`);
  const firstLine = found[0].split("\n")[0];
  return firstLine.endsWith("}") ? firstLine : found[0];
};
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function domFixture(t) {
  // JSDOM defaults: scripts and resource loading disabled.
  const dom = new JSDOM(html, { url: "https://fixture.invalid" });
  t.after(() => dom.window.close());
  mountShellIcons(dom.window.document);
  const style = dom.window.document.createElement("style");
  style.textContent = readFileSync(new URL("../renderer/shell.css", import.meta.url), "utf8") + contextPanelCSS;
  dom.window.document.head.append(style);
  return dom;
}
function shell(t, shellSource = source, { storage = {}, gitPanel } = {}) {
  const dom = domFixture(t), document = dom.window.document;
  // A machine's earlier preferences (the shell reads them while it builds).
  for (const [key, value] of Object.entries(storage)) dom.window.localStorage.setItem(key, value);
  const loads = [], events = [], notices = [], offs = [];
  const c = {
    document, window: dom.window, localStorage: dom.window.localStorage,
    NAV, shellIcon, createContextPanel, createInstanceGitPanel: gitPanel ?? createInstanceGitPanel, createInstanceTeamsSection, createInstanceSoulSection, workspace: "A", generation: 0, events, notices,
    connectionGeneration: 0, subscribeConnections: () => () => {},
    connections: { close() {}, open: () => events.push(['connections']) }, lifecycleDialog: { close() {} },
    currentWorkspace: () => c.workspace, workspaceGeneration: () => c.generation,
    loadSpawn() { const gate = deferred(); loads.push(gate); return gate.promise; },
    ctx: { notify: text => notices.push(text) },
    showStage(name) { c.tabOpenIntents.invalidate(); events.push(["stage", name]); },
    showStageFocused: name => c.showStage(name), // the stage switch; its focus keeping is shell glue over focusRegion("main")
    registerAction(action) { const off = registerAction(action); offs.push(off); return off; }, runAction,
    // The palette action notes the leader's target as it opens (the instance entries act on it).
    palette: { toggle: () => events.push(["palette"]), isOpen: () => false }, leaderTargetId: () => null,
    quickOpen: { toggle: () => events.push(["quickOpen"]) },
    shortcutsEditor: { close() {}, open: () => events.push(["shortcuts"]) },
    THEMES, setTheme: id => events.push(["theme", id]),
    toggleTheme: () => events.push(["theme"]), themePicker: { toggle: () => events.push(["themePicker"]) },
    splitPane: orientation => events.push(["split", orientation]), closeSplit: () => events.push(["split", "close"]),
    fileOpener: { choose() {}, dispose() {} },
    getBinding, formatChord, paletteGroupDirection, paletteGroupHint, isMac: false, contextRosterEl: document.getElementById("instance-roster"),
    activeTrigger: null, activeTabTrigger: () => c.activeTrigger,
  };
  c.tabOpenIntents = createSelectionOwnership(c);
  const start = shellSource.indexOf('const navEl = document.getElementById("nav");');
  const end = shellSource.indexOf("// ── command palette", start);
  const navigation = shellSource.slice(start, end).replace('import("./views/spawn.mjs")', "loadSpawn()");
  const actionsStart = shellSource.indexOf('// ── action registry');
  const actionsEnd = shellSource.indexOf('// THE one window keydown listener', actionsStart);
  const registry = shellSource.slice(actionsStart, actionsEnd);
  const titleCode = shellSource.slice(shellSource.indexOf("const baseTitles ="), shellSource.indexOf("onKeymapChange(() => applyChordTitles"));
  const functions = ["setNavActive", "sidebarHidden", "setSidebarHidden", "updateSidebarControls", "toggleSidebar", "focusRoster", "openShortcutsEditor", "openConnections", "stableFocusTarget"].map(name => fn(name, shellSource));
  const panelSetup = shellSource.slice(shellSource.indexOf("const contextPanel = createContextPanel"), shellSource.indexOf("/** Projection only:"));
  const s = runInNewContext(`${panelSetup}\n${navigation}\nconst SIDEBAR_HIDDEN_KEY = "oats-desktop-sidebar-hidden";\n${functions.join("\n")}\n${registry}\n${titleCode}\napplyChordTitles();\n({ openWorkspaceSouls, setNavActive, setSidebarHidden, applyChordTitles, contextPanel });`, withShellWindowGlobals(c));
  offs.push(onKeymapChange(s.applyChordTitles));
  t.after(() => s.contextPanel.dispose());
  // Execute the production Show sidebar / Show instance panel bindings too.
  const reopen = shellSource.match(/^document\.getElementById\("show-(?:sidebar|panel)"\)\.addEventListener[^\n]+/gm);
  assert.equal(reopen?.length, 2, "both reopen controls are wired");
  for (const line of reopen) runInNewContext(line, c);
  t.after(() => { offs.forEach(off => off()); setActiveContexts(new Set()); });
  return { ...s, c, document, loads, events, notices,
    switchTo(workspace) { c.workspace = workspace; c.generation++; },
    async settle(gate, outcome) {
      if (outcome === "resolve") gate.resolve({
        preselectWorkspaceTab: tab => events.push(["tab", tab]),
        preselectSoul() { assert.fail("chooser must not inspect or automatically pick a soul"); },
      });
      else gate.reject(new Error("fixture import failed"));
      await tick();
    },
  };
}

test("provided workspace header structure and brand artwork are decorative; chooser semantics and ids survive", t => {
  const { document } = shell(t);
  const trigger = document.querySelector(".side-head > #ws-trigger");
  assert.deepEqual([...trigger.children].map(el => el.className), ["ws-brand-mark", "ws-heading-copy", "ws-chevron"]);
  assert.equal(trigger.getAttribute("aria-haspopup"), "listbox");
  assert.equal(trigger.getAttribute("aria-controls"), "ws-menu");
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.ok(trigger.querySelector(".ws-heading-copy > #ws-name"));
  assert.equal(trigger.querySelector("#ws-context"), null, "the trigger holds the name only");
  // #482 UI spec: nothing between the switcher and the navigation (no deployments block).
  assert.equal(document.getElementById("ws-deployments"), null);
  assert.deepEqual([...document.getElementById("sidebar").children].slice(0, 3).map(el => el.id || el.className), ["side-head", "ws-menu", "nav"]);
  const mark = trigger.querySelector(".ws-brand-mark");
  assert.equal(mark.getAttribute("aria-hidden"), "true");
  const image = mark.querySelector("img.ws-brand-image");
  assert.equal(image.getAttribute("src"), "../assets/brand/generated/sidebar-48.png", "the generated 2x sidebar icon");
  assert.equal(image.getAttribute("alt"), ""); assert.equal(image.getAttribute("width"), "24"); assert.equal(image.getAttribute("height"), "24");
  assert.equal(trigger.querySelector(".ws-brand-icon, [data-shell-icon=\"oats\"]"), null, "the placeholder leaf is gone");
  assert.match(source, /hasWorkspaceSwitcher: true/);
  const switcher = createWorkspaceSwitcher({ document, selectWorkspace() {}, discoverSuggestions: async () => [], addWorkspace: async () => ({}), pickWorkspace: async () => ({}) });
  switcher.begin()({ id: "/fixture/A", name: "A" }, []);
  trigger.dispatchEvent(new document.defaultView.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.equal(document.activeElement.id, "ws-menu-search");
  document.getElementById("ws-menu").dispatchEvent(new document.defaultView.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(document.activeElement, trigger);
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
});

test("only current destinations render, dispatch unchanged stage ids, and project aria-current", t => {
  const s = shell(t), buttons = [...s.document.querySelectorAll("#nav button")];
  assert.deepEqual(buttons.map(b => b.textContent), ["Deployments", "Workspace", "Automations"]);
  assert.deepEqual(buttons.map(b => b.dataset.action), ["stage.hierarchy", "stage.spawn", "stage.automations"]);
  for (const button of buttons) {
    assert.equal(button.type, "button"); assert.ok(button.title); assert.ok(button.querySelector("svg"));
    button.click(); assert.deepEqual(s.events.at(-1), ["stage", button.dataset.view]);
    s.setNavActive(button.dataset.view);
    assert.deepEqual(buttons.filter(b => b.hasAttribute("aria-current")), [button]);
    assert.equal(button.getAttribute("aria-current"), "page");
  }
  s.setNavActive(null);
  assert.equal(s.document.querySelector("#nav [aria-current]"), null);
  assert.equal(getBinding("stage.spawn"), "Mod+2", "Workspace is a label change, not a chord change");
});

test("static SVG inventory stays 16px, hidden to AT and rejects arbitrary markup or inherited keys", t => {
  const dom = domFixture(t), document = dom.window.document;
  for (const icon of document.querySelectorAll("svg")) {
    assert.equal(icon.getAttribute("aria-hidden"), "true");
    assert.equal(icon.getAttribute("focusable"), "false");
    assert.equal(icon.getAttribute("height"), "16");
    if (icon.classList.contains("shell-icon")) assert.equal(icon.getAttribute("width"), "16");
    assert.equal(icon.querySelector("script, image, use, foreignObject, a"), null);
  }
  for (const name of ["<script>alert(1)</script>", "__proto__", "constructor", "https://example.test/icon.svg"]) {
    assert.throws(() => shellIcon(name), /Unknown shell icon/);
  }
});

test("footer has one honest chooser and five permanently named tools, all dispatching the real registry", async t => {
  const s = shell(t), q = id => s.document.getElementById(id);
  const foot = q("nav-foot"), tools = [...q("sidebar-tools").children];
  // No leader button: the shortcuts editor (a tool here, Mod+, and the palette) lists the leader's commands.
  assert.deepEqual([...foot.children].map(el => el.id), ["sidebar-spawn", "sidebar-tools"]);
  assert.deepEqual(tools.map(b => b.dataset.action), ["sidebar.toggle", "app.themePicker", "app.shortcuts", "app.connections", "app.palette"]);
  for (const button of foot.querySelectorAll("button")) {
    assert.equal(button.type, "button"); assert.equal(button.hidden, false); assert.equal(button.disabled, false);
    assert.ok(button.tabIndex >= 0); assert.ok(button.getAttribute("aria-label")); assert.ok(button.title);
    assert.ok(button.querySelector('svg[aria-hidden="true"]'));
  }
  q("sidebar-theme").click(); q("sidebar-shortcuts").click(); q("sidebar-settings").click(); q("sidebar-palette").click();
  assert.deepEqual(s.events, [["themePicker"], ["shortcuts"], ["connections"], ["palette"]]);
  assert.equal(getBinding('app.connections'), null, 'Connections does not invent a new global chord');
  assert.match(q("sidebar-spawn").title, /Choose a soul/);
  assert.equal(getBinding("app.chooseSoul", true), "Mod+N", "redesign shortcut chooses a soul, never launches one");
  assert.equal(getBinding("app.chooseSoul", false), "Ctrl+Shift+N", "Linux/Windows: Ctrl+Shift+N (spec F), Ctrl+N stays the program's");
  const before = s.c.tabOpenIntents.begin(); q("sidebar-spawn").click();
  assert.equal(before(), false); assert.equal(s.loads.length, 1);
  await s.settle(s.loads[0], "resolve");
  assert.deepEqual(s.events.slice(4), [["tab", "souls"], ["stage", "spawn"]]);
  assert.match(source, /label: "Spawn instance: choose a soul in Workspace…", detail: chordDetail\("app.chooseSoul"\), run: \(\) => runAction\("app.chooseSoul"\)/);
});

test("hide/show returns focus to visible controls and aria-expanded follows sidebar state", t => {
  const s = shell(t), q = id => s.document.getElementById(id);
  assert.equal(q("show-sidebar").hidden, true, "Show sidebar appears only while the sidebar is away");
  q("sidebar-toggle").focus(); q("sidebar-toggle").click();
  assert.equal(q("app").classList.contains("sidebar-hidden"), true);
  assert.equal(s.document.activeElement, q("show-sidebar"), "hiding with focus inside moves focus to Show sidebar");
  assert.equal(q("show-sidebar").hidden, false);
  assert.equal(q("sidebar-toggle").getAttribute("aria-expanded"), "false");
  assert.equal(q("show-sidebar").getAttribute("aria-expanded"), "false");
  assert.equal(q("show-sidebar").getAttribute("aria-controls"), "sidebar");
  q("show-sidebar").click();
  assert.equal(q("app").classList.contains("sidebar-hidden"), false);
  assert.equal(q("show-sidebar").hidden, true);
  assert.equal(s.document.activeElement, q("sidebar-toggle"), "never <body>: the sidebar's own toggle");
  assert.equal(q("sidebar-toggle").getAttribute("aria-expanded"), "true");
});

test("SVG split controls retain their names and context-gated registry wiring", t => {
  const s = shell(t);
  const start = source.indexOf('const tabActionsEl = document.getElementById("tab-actions");');
  const end = source.indexOf("function updateSplitControls()", start);
  runInNewContext(source.slice(start, end), s.c);
  const buttons = ["split-right", "split-down"].map(id => s.document.getElementById(id));
  setActiveContexts(new Set(["stage:spawn"]));
  buttons.forEach(b => b.click()); assert.deepEqual(s.events, [], "icons cannot bypass context gating");
  setActiveContexts(new Set(["tabs"]));
  buttons.forEach(b => {
    assert.ok(b.getAttribute("aria-label")); assert.ok(b.title); assert.ok(b.querySelector("svg.shell-icon")); b.click();
  });
  assert.deepEqual(s.events, [["split", "row"], ["split", "col"]]);
});

test("sidebar shortcuts keep Ctrl+B/F/N/P with the pty and dispatch Cmd+F/N on macOS", t => {
  shell(t);
  for (const key of ["b", "f", "n", "p"]) for (const isMac of [false, true]) {
    assert.equal(matchEvent({ key, ctrlKey: true }, { isMac, insideTerminal: true, editableTarget: false }), null);
  }
  for (const [key, action] of [["f", "sidebar.focusFilter"], ["n", "app.chooseSoul"]]) {
    assert.equal(matchEvent({ key, metaKey: true }, { isMac: true, insideTerminal: true }), action);
  }
  // Linux/Windows: the filter is Ctrl+Alt+F and "Spawn instance" Ctrl+Shift+N, both inside the
  // terminal and out, while plain Ctrl+F and Ctrl+N stay the program's.
  for (const key of ["f", "n"]) assert.equal(matchEvent({ key, ctrlKey: true }, { isMac: false, insideTerminal: false }), null);
  for (const insideTerminal of [false, true]) {
    assert.equal(matchEvent({ key: "f", ctrlKey: true, altKey: true }, { isMac: false, insideTerminal }), "sidebar.focusFilter");
    assert.equal(matchEvent({ key: "N", ctrlKey: true, shiftKey: true }, { isMac: false, insideTerminal }), "app.chooseSoul");
  }
});

test("visible shortcut hints and tooltips follow rebind, unbind and platform without changing labels", t => {
  const s = shell(t); s.c.isMac = true; s.applyChordTitles();
  t.after(() => { resetBinding("sidebar.focusFilter"); resetBinding("app.chooseSoul"); });
  for (const [action, initial, selector] of [
    ["sidebar.focusFilter", "⌘F", ".ctx-filter"], ["app.chooseSoul", "⌘N", "#sidebar-spawn"],
  ]) {
    const hint = [...s.document.querySelectorAll('[data-shortcut]')].find(el => el.dataset.shortcut === action);
    const control = s.document.querySelector(selector), label = control.getAttribute("aria-label");
    assert.equal(hint.textContent, initial); assert.equal(hint.hidden, false);
    assert.equal(hint.getAttribute("aria-hidden"), "true");
    setBinding(action, "Mod+Shift+J");
    assert.equal(hint.textContent, "⇧⌘J"); assert.match(control.title, /⇧⌘J/);
    s.c.isMac = false; s.applyChordTitles();
    assert.equal(hint.textContent, "Ctrl+Shift+J");
    setBinding(action, null);
    assert.equal(hint.hidden, true); assert.equal(hint.textContent, "");
    assert.doesNotMatch(control.title, /Ctrl|⌘/); assert.equal(control.getAttribute("aria-label"), label);
    resetBinding(action); s.c.isMac = true; s.applyChordTitles();
    assert.equal(hint.textContent, initial); assert.equal(hint.hidden, false);
  }
});

for (const outcome of ["resolve", "reject"]) test(`filter command reveals hidden sidebar and supersedes pending chooser ${outcome}`, async t => {
  const s = shell(t); s.document.getElementById("sidebar-spawn").click();
  s.setSidebarHidden(true);
  assert.equal(s.document.getElementById("app").classList.contains("sidebar-hidden"), true);
  const intent = s.c.tabOpenIntents.begin();
  runAction("sidebar.focusFilter");
  assert.equal(intent(), false);
  assert.equal(s.document.getElementById("app").classList.contains("sidebar-hidden"), false);
  assert.equal(s.document.activeElement, s.document.querySelector(".ctx-filter"));
  assert.equal(s.document.getElementById("sidebar-toggle").getAttribute("aria-expanded"), "true");
  await s.settle(s.loads[0], outcome);
  assert.deepEqual(s.events, []); assert.deepEqual(s.notices, []);
  assert.equal(s.document.activeElement, s.document.querySelector(".ctx-filter"));
});

async function staleChooser(t, outcome, superseder, shellSource = source) {
  const s = shell(t, shellSource);
  s.document.getElementById("sidebar-spawn").click(); const older = s.loads[0];
  if (superseder === "visit") { s.switchTo("B"); s.switchTo("A"); }
  if (superseder === "selection") s.c.tabOpenIntents.begin();
  if (superseder === "stage") s.document.querySelector('#nav [data-view="automations"]').click();
  if (superseder === "palette") { runAction("app.palette"); runAction("app.palette"); }
  if (superseder === "shortcuts") runAction("app.shortcuts");
  if (superseder === "modal") s.document.getElementById("ws-modal").hidden = false;
  if (superseder === "pagehide") s.document.defaultView.dispatchEvent(new s.document.defaultView.Event("pagehide"));
  if (superseder === "newer") {
    s.document.getElementById("sidebar-spawn").click(); await s.settle(s.loads[1], "resolve");
  }
  const before = [...s.events]; await s.settle(older, outcome);
  assert.deepEqual(s.events, before, "stale chooser cannot preselect or navigate");
  assert.deepEqual(s.notices, [], "stale chooser cannot notify");
}
for (const outcome of ["resolve", "reject"]) {
  for (const superseder of ["visit", "selection", "stage", "palette", "shortcuts", "modal", "pagehide", "newer"]) {
    test(`chooser ${outcome} cannot reclaim ${superseder} ownership`, t => staleChooser(t, outcome, superseder));
  }
  test(`mutation: chooser must guard ${outcome}`, async t => {
    const block = fn("openWorkspaceSouls"), guard = outcome === "resolve"
      ? '  if (!owns()) return;\n  mod.preselectWorkspaceTab' : '    if (!owns()) return;\n    ctx.notify';
    assert.ok(block.includes(guard));
    const mutant = source.replace(block, block.replace(guard, guard.replace("if (!owns()) return;", "/* guard removed */")));
    await assert.rejects(staleChooser(t, outcome, "selection", mutant), /stale chooser/);
  });
}
test("current chooser import failure is reported, never navigates or launches", async t => {
  const s = shell(t); s.document.getElementById("sidebar-spawn").click();
  await s.settle(s.loads[0], "reject");
  assert.deepEqual(s.notices, ["Could not open Workspace Souls: fixture import failed"]);
  assert.deepEqual(s.events, []);
});

for (const outcome of ["resolve", "reject"]) test(`reported workspace/root/host label survives stale ${outcome} across A→B→A`, async t => {
  const dom = domFixture(t), document = dom.window.document, requests = [];
  const c = {
    document, workspace: "A", contextRosterGen: 0,
    rosterState: null, rosterStale: false, contextDeploymentNote: null, ...viewContext(), rosterSignaturePainted: null, rosterSignature, rosterPendingWatch: createPendingWatch(), NOT_SERVED_CODE, NO_ANSWER_CODE, failRosterUnserved: assert.fail, contextInstances: [], tabs: new Map(), activeTab: null, connectionGeneration: 0,
    currentWorkspace: () => c.workspace, rosterResponseOwns, staleWorkspaceSelection,
    contextRosterEl: document.getElementById("instance-roster"),
    api(path) { const gate = { ...deferred(), path }; requests.push(gate); return gate.promise; },
    renderContextRoster() {}, refreshPanelInstance() {}, rosterPrs: { get: () => null, refresh() {} }, spawnJobs: { rows: () => [], announce: () => false, observe() {}, settling: () => false, check() {} }, // label-only polling fixture
    workspaceLabel: createWorkspaceSwitcher({ document, selectWorkspace() {}, discoverSuggestions: async () => [], addWorkspace: async () => ({}), pickWorkspace: async () => ({}) }),
  };
  const s = runInNewContext(`${fn("refreshContextRoster")}\n({ refreshContextRoster });`, withShellWindowGlobals(c));
  const old = s.refreshContextRoster();
  assert.equal(requests[0].path, "/api/panel?ws=A");
  c.workspace = "B"; c.contextRosterGen++; c.workspaceLabel.reset();
  c.workspace = "A"; c.contextRosterGen++;
  const fresh = s.refreshContextRoster();
  const workspace = { id: "A", name: 'same <b>name</b>', remote: true, server: 'host<&"' };
  const deployment = { id: 'remote:host:t', machine: 'host<&"', path: "/srv/agents", label: "~/agents", local: false, reachable: true, identityFrom: "reported", primary: true };
  requests[1].resolve({ workspace, workspaces: [workspace], deployments: [deployment], instances: [] }); await fresh;
  const name = document.getElementById("ws-name");
  const machines = () => c.contextDeployments.map(d => d.machine);
  assert.equal(name.textContent, 'same <b>name</b>', "the reported name as text, never markup"); assert.equal(name.children.length, 0);
  assert.deepEqual(machines(), ['host<&"'], "the reported deployments group the roster");
  if (outcome === "resolve") requests[0].resolve({ workspace: { ...workspace, name: "old name" }, workspaces: [{ ...workspace, name: "old name" }], deployments: [{ ...deployment, machine: "old-host" }], instances: [] });
  else requests[0].reject(new Error("stale failure"));
  await old;
  assert.equal(name.textContent, 'same <b>name</b>'); assert.deepEqual(machines(), ['host<&"']);
  assert.equal(document.querySelector(".ctx-list").textContent, "");
  assert.equal(document.getElementById("ws-trigger").title, "Active workspace: same <b>name</b>", "a remote id is never the tooltip");
});

test('White, Solarized, Dark and This computer have explicit registry/palette choices without new default chords; the cycle keeps its label', t => {
  const s = shell(t);
  t.after(() => resetBinding('app.themePicker'));
  const button = s.document.getElementById('sidebar-theme');
  const cycleLabel = 'Cycle White / Solarized / Dark / This computer theme';
  assert.equal(listActions().find(action => action.id === 'app.themeToggle')?.label, cycleLabel, 'the cycle action stays as it is');
  // The theme button opens the picker (app.themePicker); its name and tooltip carry the effective chord, never a hard-coded one.
  assert.equal(button.dataset.action, 'app.themePicker');
  assert.equal(button.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(button.getAttribute('aria-label'), 'Choose a theme');
  assert.equal(button.title, 'Choose a theme (Ctrl+Shift+Space)', 'the title is the label, then the bound chord');
  assert.match(html, /id="sidebar-theme"[^>]*data-action="app\.themePicker" aria-haspopup="dialog"\s+title="Choose a theme" aria-label="Choose a theme"/, 'the markup says the same before scripts run');
  assert.equal(listActions().find(action => action.id === 'app.themePicker')?.label, 'Choose a theme…');
  setBinding('app.themePicker', 'Ctrl+Alt+T');
  assert.equal(button.title, 'Choose a theme (Ctrl+Alt+T)', 'a rebind follows');
  assert.equal(button.getAttribute('aria-label'), 'Choose a theme');
  const start = source.indexOf('// ── command palette');
  const end = source.indexOf('// ── Quick Open', start);
  const commands = runInNewContext(`${source.slice(start, end)}\npalette.commands`, {
    ...s.c, navigator: { platform: 'Linux' }, createPalette: options => options,
  });
  assert.deepEqual(THEMES.map(({ id, label }) => [id, label]), [['light', 'White'], ['solarized', 'Solarized'], ['dark', 'Dark'], ['host', 'This computer']]);
  for (const { id, label } of THEMES) {
    assert.equal(getBinding(`app.theme.${id}`), null, `${label} has no new default keyboard chord`);
    assert.equal(listActions().find(action => action.id === `app.theme.${id}`)?.label, `Theme: ${label}`);
    const command = commands.find(item => item.label === `Theme: ${label}`); assert.ok(command);
    assert.equal(command.detail(), ''); command.run(); assert.deepEqual(s.events.at(-1), ['theme', id]);
  }
  assert.equal(commands.filter(item => /^Theme: /.test(item.label)).at(-1).label, 'Theme: This computer', 'listed last');
  const cycle = commands.find(item => item.label === 'Theme: cycle White / Solarized / Dark / This computer'); assert.ok(cycle);
  cycle.run(); assert.deepEqual(s.events.at(-1), ['theme']);
  const choose = commands.filter(item => item.label === 'Theme: choose…');
  assert.equal(choose.length, 1, 'one palette entry opens the picker');
  assert.equal(choose[0].detail(), 'Ctrl+Alt+T', 'its hint is the effective chord');
  resetBinding('app.themePicker');
  assert.equal(choose[0].detail(), 'Ctrl+Shift+Space'); assert.equal(button.title, 'Choose a theme (Ctrl+Shift+Space)');
  choose[0].run(); assert.deepEqual(s.events.at(-1), ['themePicker']);
  assert.ok(commands.indexOf(choose[0]) < commands.indexOf(cycle), 'listed before the cycle');
  // The chord toggles the picker once; a held chord (key repeat) does nothing.
  const before = s.events.length;
  const chord = (repeat) => ({ key: ' ', code: 'Space', ctrlKey: true, shiftKey: true, metaKey: false, altKey: false, repeat, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });
  assert.equal(handleKeydown(chord(false), { isMac: false, insideTerminal: false }), true);
  assert.equal(handleKeydown(chord(true), { isMac: false, insideTerminal: false }), true, 'a repeat is still claimed');
  assert.deepEqual(s.events.slice(before), [['themePicker']]);
  assert.equal(commands.some(item => /light\/dark/i.test(item.label)), false);
});

test('shell icons are the pinned Lucide set: 24-unit geometry, stroke 2, decorative, brand excluded', t => {
  const dom = domFixture(t), document = dom.window.document;
  for (const name of ['splitRight', 'splitDown', 'overview', 'workspace', 'schedules', 'close', 'branch']) {
    const span = document.createElement('span'); span.innerHTML = shellIcon(name); const svg = span.firstElementChild;
    assert.equal(svg.getAttribute('viewBox'), '0 0 24 24', name);
    assert.equal(svg.getAttribute('stroke-width'), '2', name);
    assert.equal(svg.getAttribute('aria-hidden'), 'true'); assert.equal(svg.getAttribute('focusable'), 'false');
    assert.ok(svg.children.length > 0, `${name} carries Lucide geometry`);
    assert.equal(svg.querySelector('script,foreignObject,[onload]'), null);
  }
  assert.throws(() => shellIcon('oats'), TypeError, 'the brand is artwork, not a shell icon');
});

test('the bottom summary bar is gone; the tab bar keeps only the two split buttons and panel.toggle stays on the registry', t => {
  const s = shell(t), q = id => s.document.getElementById(id), panel = s.contextPanel;
  assert.equal(q('context-panel').parentElement.id, 'workbench');
  // v4.1: no status bar under the editor groups (no Details, no Focus mode, no facts strip).
  for (const id of ['context-tools', 'context-status', 'focus-mode-toggle']) assert.equal(q(id), null, id);
  assert.equal(s.document.querySelector('#main > footer'), null);
  // Spec B: Show sidebar first and Show instance panel last, the Main region's tab order.
  assert.deepEqual([...q('main').children].map(el => el.id), ['show-sidebar', 'tabstrip', 'stagehost', 'tabhost', 'show-panel']);
  // Spec F: after the tabs, only split right and split down. Closing the split lives on its chord and the
  // palette; the instance panel on its chord, the palette, Show instance panel and its own close button.
  assert.deepEqual([...q('tab-actions').children].map(el => el.id || el.className), ['split-right', 'split-down']);
  for (const id of ['panel-toggle', 'split-close']) assert.equal(q(id), null, id);
  assert.equal(s.document.querySelector('.tab-actions-sep'), null);
  assert.doesNotMatch(source, /panel-toggle|split-close/, 'no wiring is left for the removed buttons');
  panel.setContext({ workspace: 'A', instance: { instance: 'selected', home: '/A/selected' }, key: 'exact:A:selected' });
  assert.equal(q('context-panel').hidden, true, 'selecting an instance never opens the panel');
  const before = s.c.tabOpenIntents.begin(); runAction('panel.toggle');
  assert.equal(before(), false, 'panel.toggle supersedes pending opens');
  assert.equal(q('context-panel').hidden, false);
  runAction('panel.toggle');
  assert.equal(q('context-panel').hidden, true);
  runAction('panel.toggle');
  // Focus mode: registry action (and palette, below) only. Focus leaving the hidden sidebar lands on the active tab.
  const trigger = s.document.createElement('button'); q('tabbar').append(trigger); s.c.activeTrigger = trigger;
  q('sidebar-toggle').focus();
  const pending = s.c.tabOpenIntents.begin(); runAction('app.focusMode');
  assert.equal(pending(), false); assert.equal(panel.isFocusMode(), true);
  assert.equal(q('context-panel').hidden, true);
  assert.equal(s.document.activeElement, trigger, 'hidden sidebar focus lands on the active tab');
  assert.equal(s.document.defaultView.getComputedStyle(q('sidebar')).display, 'none');
  assert.equal(q('sidebar-toggle').getAttribute('aria-expanded'), 'false');
  runAction('app.focusMode');
  assert.equal(panel.isFocusMode(), false); assert.equal(q('context-panel').hidden, false);
});

test('Show sidebar is focus mode\'s visible exit; panel.toggle leaves it and shows the panel', t => {
  const s = shell(t), q = id => s.document.getElementById(id), panel = s.contextPanel;
  const shown = el => { for (let node = el; node; node = node.parentElement) {
    if (node.hidden || node.inert || s.document.defaultView.getComputedStyle(node).display === 'none') return false; } return true; };
  panel.setContext({ workspace: 'A', instance: { instance: 'selected', home: '/A/selected' }, key: 'exact:A:selected' });
  panel.setCollapsed(true);
  // A shown tab group whose active trigger is gone: the tab bar's actions are up, no trigger to land on.
  q('tabbar').append(s.document.createElement('span')); q('tab-actions').hidden = false;
  q('sidebar-toggle').focus(); runAction('app.focusMode'); assert.equal(panel.isFocusMode(), true);
  // No active trigger: focus leaving the hidden sidebar lands on a stable visible control, never <body>.
  assert.equal(s.document.activeElement, q('show-sidebar'), 'no active trigger: Show sidebar takes focus');
  assert.ok(shown(q('show-sidebar')), 'Show sidebar and its ancestors stay visible by shipped CSS');
  assert.equal(q('show-sidebar').getAttribute('aria-expanded'), 'false');
  assert.ok(shown(q('show-panel')), 'with something to show, Show instance panel is there in focus mode too');
  // panel.toggle (its chord, the palette, Show instance panel) leaves focus mode AND shows the panel, whatever its preference was.
  const pending = s.c.tabOpenIntents.begin(); runAction('panel.toggle');
  assert.equal(pending(), false); assert.equal(panel.isFocusMode(), false);
  assert.equal(q('context-panel').hidden, false); assert.equal(shown(q('show-panel')), false);
  assert.equal(q('app').classList.contains('focus-mode'), false);
  assert.equal(q('sidebar-toggle').getAttribute('aria-expanded'), 'true', 'the sidebar is back too');
  // On a stage (no terminal tab, no panel content) Show sidebar is the exit; Show instance panel is not shown.
  panel.setContext({ workspace: 'A' }); q('tab-actions').hidden = true;
  q('sidebar-toggle').focus(); runAction('app.focusMode'); assert.equal(panel.isFocusMode(), true);
  assert.equal(s.document.activeElement, q('show-sidebar'), 'on a stage focus lands on Show sidebar');
  assert.ok(shown(q('show-sidebar'))); assert.equal(shown(q('sidebar')), false); assert.equal(shown(q('show-panel')), false);
  q('show-sidebar').click();
  assert.equal(panel.isFocusMode(), false); assert.ok(shown(q('sidebar'))); assert.equal(shown(q('show-sidebar')), false);
  assert.equal(s.document.activeElement, q('sidebar-toggle'));
});

test('focus fallback prefers a shown active tab, then the sidebar toggle, Show sidebar or Show instance panel; never <body>', t => {
  const s = shell(t), q = id => s.document.getElementById(id);
  const target = runInNewContext(`${fn('stableFocusTarget')}\nstableFocusTarget`, s.c);
  const trigger = s.document.createElement('button'); q('tabbar').append(trigger);
  s.c.activeTrigger = trigger; assert.equal(target(), trigger);
  trigger.hidden = true; assert.equal(target(), q('sidebar-toggle'), 'hidden tab: the sidebar toggle');
  s.contextPanel.setContext({ workspace: 'A', instance: { instance: 'selected', home: '/A/selected' }, key: 'exact:A:selected' });
  q('tab-actions').hidden = false; assert.equal(target(), q('sidebar-toggle'), 'the split buttons are never a fallback');
  s.c.activeTrigger = null; s.contextPanel.setContext({ workspace: 'A' }); s.setSidebarHidden(true);
  assert.equal(target(), q('show-sidebar'), 'sidebar hidden: Show sidebar');
});

test('a focus-mode change made after focus was lost (the palette removed its input) lands on a visible control, never <body>', t => {
  const s = shell(t), q = id => s.document.getElementById(id);
  const trigger = s.document.createElement('button'); q('tabbar').append(trigger); s.c.activeTrigger = trigger;
  const input = s.document.createElement('input'); s.document.body.append(input); input.focus(); input.remove();
  assert.equal(s.document.activeElement, s.document.body, 'the picker is gone: focus is on <body>');
  runAction('app.focusMode'); assert.equal(s.contextPanel.isFocusMode(), true);
  assert.equal(s.document.activeElement, trigger, 'entering: the active tab');
  s.document.activeElement.blur(); assert.equal(s.document.activeElement, s.document.body);
  s.c.activeTrigger = null; runAction('app.focusMode'); assert.equal(s.contextPanel.isFocusMode(), false);
  assert.equal(s.document.activeElement, q('sidebar-toggle'), 'leaving with no active tab: the sidebar toggle');
  s.document.activeElement.blur(); s.contextPanel.setContext({ workspace: 'A', key: 'terminal' });
  assert.equal(s.document.activeElement, s.document.body, 'a background projection never moves focus');
});

test('the palette keeps focus mode reachable without the bar and names the instance panel toggle with its chord', t => {
  const s = shell(t);
  const start = source.indexOf('// ── command palette');
  const end = source.indexOf('// ── Quick Open', start);
  const commands = runInNewContext(`${source.slice(start, end)}\npalette.commands`, {
    ...s.c, navigator: { platform: 'Linux' }, createPalette: options => options,
  });
  assert.equal(commands.some(item => /context panel/i.test(item.label)), false, 'the panel is the instance panel now');
  const panelCommand = commands.find(item => item.label === 'Instance panel: show / hide'); assert.ok(panelCommand);
  assert.equal(panelCommand.detail(), 'Ctrl+Shift+I');
  s.contextPanel.setContext({ workspace: 'A', instance: { instance: 'selected', home: '/A/selected' }, key: 'exact:A:selected' });
  assert.equal(s.document.getElementById('context-panel').hidden, true, 'closed until the user opens it');
  panelCommand.run(); assert.equal(s.document.getElementById('context-panel').hidden, false);
  const focusCommand = commands.find(item => item.label === 'Focus mode: toggle'); assert.ok(focusCommand);
  assert.equal(focusCommand.detail(), '', 'no default chord');
  focusCommand.run(); assert.equal(s.contextPanel.isFocusMode(), true);
  focusCommand.run(); assert.equal(s.contextPanel.isFocusMode(), false);
});

for (const hidden of [false, true]) test(`focus mode overrides but restores raw sidebar preference hidden=${hidden}`, t => {
  const s = shell(t), q = id => s.document.getElementById(id), key = 'oats-desktop-sidebar-hidden';
  s.setSidebarHidden(hidden); s.contextPanel.setContext({ workspace: 'A', key: 'terminal' });
  s.contextPanel.setCollapsed(true);
  const stored = s.c.localStorage.getItem(key);
  runAction('app.focusMode');
  assert.equal(q('app').classList.contains('sidebar-hidden'), hidden, 'temporary override never rewrites raw CSS preference');
  assert.equal(s.c.localStorage.getItem(key), stored);
  assert.equal(q('show-sidebar').getAttribute('aria-expanded'), 'false');
  assert.equal(q('show-sidebar').hidden, false, 'Show sidebar is focus mode\'s visible exit');
  runAction('app.focusMode');
  assert.equal(q('app').classList.contains('sidebar-hidden'), hidden);
  assert.equal(s.c.localStorage.getItem(key), hidden ? '1' : null);
  assert.equal(q('sidebar-toggle').getAttribute('aria-expanded'), String(!hidden));
  assert.equal(s.document.defaultView.getComputedStyle(q('sidebar')).display, hidden ? 'none' : 'flex');
  assert.equal(q('show-sidebar').hidden, !hidden);
  assert.equal(q('context-panel').hidden, true, 'focus override also preserves the closed panel');
  assert.equal(s.c.localStorage.getItem('oats-desktop-instance-panel-open'), null);
});

// ── Spec B: closed sidebars, one per-machine instance-panel preference, two Show controls.
const PANEL_OPEN_KEY = 'oats-desktop-instance-panel-open';
const terminalOf = (home, extra = {}) => ({ workspace: 'A', instance: { instance: home.split('/').pop(), agent: 'dev', agentsRoot: '/A/agents', home, ...extra }, key: home });

test('Spec B: selecting instances never opens the panel; open/closed is one per-machine preference that survives a new window', t => {
  const s = shell(t), q = id => s.document.getElementById(id), store = () => s.c.localStorage.getItem(PANEL_OPEN_KEY);
  s.contextPanel.setContext(terminalOf('/A/one'));
  assert.equal(q('context-panel').hidden, true, 'preference unset: an instance terminal opens closed');
  s.contextPanel.setContext(terminalOf('/A/two')); assert.equal(q('context-panel').hidden, true, 'another instance: still closed');
  assert.equal(store(), null);
  runAction('panel.toggle'); assert.equal(q('context-panel').hidden, false); assert.equal(store(), '1');
  s.contextPanel.setContext(terminalOf('/A/one')); assert.equal(q('context-panel').hidden, false, 'open follows every instance');
  q('context-panel').querySelector('.context-panel-collapse').click();
  assert.equal(q('context-panel').hidden, true, "the panel's close button"); assert.equal(store(), null, 'closed is the absent default');
  q('show-panel').click(); assert.equal(q('context-panel').hidden, false, 'Show instance panel'); assert.equal(store(), '1');
  // A new window on this machine reads the preference; an unset machine opens closed.
  const again = shell(t, source, { storage: { [PANEL_OPEN_KEY]: '1' } });
  again.contextPanel.setContext(terminalOf('/A/one'));
  assert.equal(again.document.getElementById('context-panel').hidden, false, 'open survives a re-created panel');
  const fresh = shell(t);
  fresh.contextPanel.setContext(terminalOf('/A/one'));
  assert.equal(fresh.document.getElementById('context-panel').hidden, true);
});

test('Spec B: a closed panel and a hidden sidebar take no width and leave no rail or edge, side by side and stacked', t => {
  const s = shell(t), q = id => s.document.getElementById(id), css = readFileSync(new URL('../renderer/shell.css', import.meta.url), 'utf8');
  const style = el => s.document.defaultView.getComputedStyle(el);
  s.contextPanel.setContext(terminalOf('/A/one')); s.setSidebarHidden(true);
  assert.equal(style(q('sidebar')).display, 'none'); assert.equal(style(q('context-panel')).display, 'none');
  assert.equal(s.document.querySelector('#sidebar-restore, .context-panel-rail, [data-context-rail], .context-panel-expand'), null, 'no strip, rail or edge');
  for (const id of ['show-sidebar', 'show-panel']) {
    assert.equal(q(id).parentElement.id, 'main', `${id} sits in the main area`); assert.equal(style(q(id)).position, 'absolute', `${id} overlays the top bar`);
  }
  // Stacked (the narrow layout): nothing there gives the panel back a rail or overrides its hidden rule.
  const narrow = css.slice(css.indexOf('@media (max-width: 1000px)'), css.indexOf('}\n}', css.indexOf('@media (max-width: 1000px)')));
  assert.doesNotMatch(narrow, /rail|is-collapsed|sidebar-restore/);
  assert.match(contextPanelCSS, /#context-panel\.context-panel\[hidden\][^{]*\{ display:none !important; \}/, 'hidden wins in every layout');
});

test('Spec B: Show instance panel appears only while the panel is closed with something to show, and opens it into its selected tab', t => {
  const s = shell(t), q = id => s.document.getElementById(id), show = q('show-panel');
  assert.equal(show.hidden, true, 'nothing to show: no control');
  assert.equal(show.dataset.action, 'panel.toggle'); assert.equal(show.getAttribute('aria-controls'), 'context-panel');
  assert.equal(show.getAttribute('aria-expanded'), 'false');
  s.contextPanel.setContext(terminalOf('/A/one'));
  assert.equal(show.hidden, false, 'closed with an instance terminal: shown');
  assert.equal(show.getAttribute('aria-label'), 'Show instance panel'); assert.match(show.title, /^Show instance panel/);
  show.focus(); show.click();
  assert.equal(q('context-panel').hidden, false); assert.equal(show.hidden, true, 'open: the control goes away');
  const selected = q('context-panel').querySelector('[data-context-tab][aria-selected="true"]');
  assert.ok(selected); assert.equal(s.document.activeElement, selected, "opening by its control focuses the panel's selected tab");
  // Closing with focus inside: focus goes to Show instance panel, back in its place.
  q('context-panel').querySelector('.context-panel-collapse').focus(); runAction('panel.toggle');
  assert.equal(q('context-panel').hidden, true); assert.equal(show.hidden, false);
  assert.equal(s.document.activeElement, show, 'closing with focus inside lands on Show instance panel');
  // Its chord pressed while it has focus: the control hides, focus follows into the panel, never <body>.
  runAction('panel.toggle');
  assert.equal(show.hidden, true); assert.equal(s.document.activeElement, q('context-panel').querySelector('[data-context-tab][aria-selected="true"]'));
  // Back on a stage with no panel content: no control.
  runAction('panel.toggle'); s.contextPanel.setContext({ workspace: 'A' }); assert.equal(show.hidden, true);
});

test('Spec B: a chord pressed elsewhere opens or closes the panel without taking focus', t => {
  const s = shell(t), q = id => s.document.getElementById(id);
  const terminal = s.document.createElement('textarea'); q('tabhost').append(terminal);
  s.contextPanel.setContext(terminalOf('/A/one')); terminal.focus();
  runAction('panel.toggle'); assert.equal(q('context-panel').hidden, false); assert.equal(s.document.activeElement, terminal);
  runAction('panel.toggle'); assert.equal(q('context-panel').hidden, true); assert.equal(s.document.activeElement, terminal);
  runAction('sidebar.toggle'); assert.equal(q('app').classList.contains('sidebar-hidden'), true); assert.equal(s.document.activeElement, terminal);
  runAction('sidebar.toggle'); assert.equal(s.document.activeElement, terminal);
});

test('Spec B: Show instance panel carries the Developer change dot and says so in its name', t => {
  let hooks = null;
  const s = shell(t, source, { gitPanel: (_parent, focus) => { hooks = focus; return { update() {}, dispose() {} }; } });
  const show = s.document.getElementById('show-panel'), dot = show.querySelector('.main-edge-dot');
  const selected = terminalOf('/A/one'); s.contextPanel.setContext(selected);
  const identity = JSON.stringify(['A', selected.key, selected.instance.home, 'dev', '/A/agents', null, null]);
  assert.equal(dot.hidden, true); assert.equal(dot.getAttribute('aria-hidden'), 'true');
  hooks.onObservation({ identity, connection: 0, changed: true });
  assert.equal(dot.hidden, false); assert.equal(s.contextPanel.state().changes, true);
  assert.equal(show.getAttribute('aria-label'), 'Show instance panel, Developer has changes');
  assert.match(show.title, /^Show instance panel, Developer has changes/, 'the tooltip says it too, with the live chord');
  hooks.onObservation({ identity, connection: 0, changed: false });
  assert.equal(dot.hidden, true); assert.equal(show.getAttribute('aria-label'), 'Show instance panel');
  hooks.onObservation({ identity: JSON.stringify(['A', '/A/two']), connection: 0, changed: true });
  assert.equal(dot.hidden, true, "another instance's read marks nothing");
});

// Lead's ruling: a deliberate exception to point 5 ("hiding the sidebar with focus in it moves focus
// to Show sidebar"). Entering focus mode says "work in the content", so focus goes to the active tab.
test('Spec B exception to point 5: entering focus mode from the sidebar focuses the active tab, not Show sidebar; sidebar.toggle still does', t => {
  const s = shell(t), q = id => s.document.getElementById(id);
  const trigger = s.document.createElement('button'); q('tabbar').append(trigger); s.c.activeTrigger = trigger;
  q('sidebar-toggle').focus(); runAction('app.focusMode');
  assert.equal(s.contextPanel.isFocusMode(), true); assert.equal(q('show-sidebar').hidden, false);
  assert.equal(s.document.activeElement, trigger, 'focus mode: the active tab, the content it is for');
  runAction('app.focusMode'); q('sidebar-toggle').focus(); runAction('sidebar.toggle');
  assert.equal(s.document.activeElement, q('show-sidebar'), 'plain sidebar.toggle: Show sidebar');
});

test('Spec B: the soul inspector keeps opening on soul selection, whatever the instance preference', t => {
  const s = shell(t), q = id => s.document.getElementById(id), owner = {};
  const inspector = s.document.createElement('section'); inspector.append(s.document.createElement('header'));
  s.contextPanel.setContext({ workspace: 'A' }); // the Workspace stage of workspace A, before a soul is selected
  const lease = s.contextPanel.attach(owner, inspector);
  s.contextPanel.setContext({ workspace: 'A', owner }); lease.setPresent(true);
  assert.equal(q('context-panel').hidden, false, 'a selected soul shows its inspector'); assert.equal(lease.isVisible(), true);
  assert.equal(q('show-panel').hidden, true);
  assert.equal(s.c.localStorage.getItem(PANEL_OPEN_KEY), null, 'the instance preference is untouched');
  s.contextPanel.setContext(terminalOf('/A/one')); assert.equal(q('context-panel').hidden, true, 'an instance terminal still opens closed');
});

test('focusRoster exits focus mode, reveals the sidebar and focuses its filter through the registered command', t => {
  const s = shell(t), q = id => s.document.getElementById(id);
  s.setSidebarHidden(true); runAction('app.focusMode');
  assert.equal(s.contextPanel.isFocusMode(), true);
  const pending = s.c.tabOpenIntents.begin(); runAction('sidebar.focusFilter');
  assert.equal(pending(), false); assert.equal(s.contextPanel.isFocusMode(), false);
  assert.equal(q('app').classList.contains('sidebar-hidden'), false);
  assert.equal(s.c.localStorage.getItem('oats-desktop-sidebar-hidden'), null);
  assert.equal(q('sidebar-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(s.document.activeElement, s.document.querySelector('.ctx-filter'));
});

test('panel.toggle defaults to ⌘I / Ctrl+Shift+I (no conflict) and fires in a terminal; focus mode has no default and does not', t => {
  shell(t);
  assert.deepEqual(DEFAULT_KEYMAP['panel.toggle'], { mac: 'Mod+I', other: 'Ctrl+Shift+I' });
  assert.equal(getBinding('panel.toggle', true), 'Mod+I'); assert.equal(getBinding('panel.toggle', false), 'Ctrl+Shift+I');
  for (const isMac of [true, false]) {
    const chord = getBinding('panel.toggle', isMac);
    assert.deepEqual(listActions().filter(a => a.id !== 'panel.toggle' && getBinding(a.id, isMac) === chord).map(a => a.id), [], `mac=${isMac}: ${chord} is the panel's alone`);
  }
  assert.equal(TERMINAL_ALLOWLIST.includes('panel.toggle'), true);
  // Linux/Windows: Ctrl+Shift+I (e.key "I") inside the terminal and out; plain Ctrl+I (Tab) is the program's everywhere.
  for (const insideTerminal of [false, true]) {
    assert.equal(matchEvent({ key: 'I', ctrlKey: true, shiftKey: true }, { isMac: false, insideTerminal }), 'panel.toggle');
    assert.equal(matchEvent({ key: 'i', ctrlKey: true }, { isMac: false, insideTerminal }), null, 'Ctrl+I (Tab) stays with the program');
  }
  assert.equal(matchEvent({ key: 'i', metaKey: true }, { isMac: true, insideTerminal: true }), 'panel.toggle');
  assert.equal(matchEvent({ key: 'i', metaKey: true, altKey: true }, { isMac: true, insideTerminal: false }), null, '⌥⌘I (the dev tools) is not this action');
  assert.equal(DEFAULT_KEYMAP['app.focusMode'], undefined); assert.equal(getBinding('app.focusMode'), null);
  // A rebind keeps each action's terminal policy (by id): the panel's fires in a Linux terminal, focus mode's does not.
  for (const [id, key, inLinuxTerminal] of [['panel.toggle', 'j', 'panel.toggle'], ['app.focusMode', 'u', null]]) {
    assert.equal(TERMINAL_ALLOWLIST.includes(id), inLinuxTerminal !== null);
    t.after(() => resetBinding(id)); setBinding(id, `Mod+${key.toUpperCase()}`);
    assert.equal(matchEvent({ key, ctrlKey: true }, { isMac: false, insideTerminal: true }), inLinuxTerminal);
    assert.equal(matchEvent({ key, ctrlKey: true }, { isMac: false, insideTerminal: false }), id);
    assert.equal(matchEvent({ key, metaKey: true }, { isMac: true, insideTerminal: true }), id);
  }
});

test('the shell sends no workspace-scoped request while its window chooses (Quick Open, a view refreshing on its way out)', async () => {
  const { readFileSync } = await import('node:fs');
  const { runInNewContext } = await import('node:vm');
  const { scopedRequest } = await import('../renderer/workspace-routes.mjs');
  const { httpError } = await import('../renderer/views/common.mjs');
  const shellSource = readFileSync(new URL('../renderer/shell.mjs', import.meta.url), 'utf8');
  const fnSource = shellSource.match(/async function api\(pathname, opts\)[^]*?\n\}/)[0];
  for (const state of ['choosing', 'bound']) {
    const sent = [];
    const api = runInNewContext(`(${fnSource})`, { windowState: () => state, scopedRequest, httpError, Object, Error,
      desk: { api: async (path) => { sent.push(path); return { ok: true, status: 200, body: {} }; } } });
    for (const path of ['/api/agents', '/api/panel?ws=x', '/api/instance-git']) {
      if (state === 'choosing') await assert.rejects(api(path), (e) => e.code === 'E_NO_WORKSPACE', path);
      else await api(path);
    }
    await api('/api/cli');
    assert.deepEqual(sent, state === 'choosing' ? ['/api/cli'] : ['/api/agents', '/api/panel?ws=x', '/api/instance-git', '/api/cli'], state);
  }
});
