// Supplied shell structure exercised with the shipped composition and inert
// DOM/API/module-loader fixtures. No Electron, browser, server or live mutations.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
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
import { rosterResponseOwns } from "../renderer/instance-tree.mjs";
import { DEFAULT_KEYMAP, TERMINAL_ALLOWLIST, registerAction, runAction, getBinding, formatChord, setActiveContexts, matchEvent, setBinding, resetBinding, onKeymapChange } from "../renderer/keybindings.mjs";

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
function shell(t, shellSource = source) {
  const dom = domFixture(t), document = dom.window.document;
  const loads = [], events = [], notices = [], offs = [];
  const c = {
    document, window: dom.window, localStorage: dom.window.localStorage,
    NAV, shellIcon, createContextPanel, createInstanceGitPanel, createInstanceTeamsSection, createInstanceSoulSection, workspace: "A", generation: 0, events, notices,
    connectionGeneration: 0, subscribeConnections: () => () => {},
    connections: { close() {}, open: () => events.push(['connections']) }, lifecycleDialog: { close() {} },
    currentWorkspace: () => c.workspace, workspaceGeneration: () => c.generation,
    loadSpawn() { const gate = deferred(); loads.push(gate); return gate.promise; },
    ctx: { notify: text => notices.push(text) },
    showStage(name) { c.tabOpenIntents.invalidate(); events.push(["stage", name]); },
    registerAction(action) { const off = registerAction(action); offs.push(off); return off; }, runAction,
    palette: { toggle: () => events.push(["palette"]) },
    quickOpen: { toggle: () => events.push(["quickOpen"]) },
    shortcutsEditor: { close() {}, open: () => events.push(["shortcuts"]) },
    THEMES, setTheme: id => events.push(["theme", id]),
    toggleTheme: () => events.push(["theme"]),
    splitPane: orientation => events.push(["split", orientation]), closeSplit: () => events.push(["split", "close"]),
    fileOpener: { choose() {}, dispose() {} },
    getBinding, formatChord, isMac: false, contextRosterEl: document.getElementById("instance-roster"),
  };
  c.tabOpenIntents = createSelectionOwnership(c);
  const start = shellSource.indexOf('const navEl = document.getElementById("nav");');
  const end = shellSource.indexOf("// ── command palette", start);
  const navigation = shellSource.slice(start, end).replace('import("./views/spawn.mjs")', "loadSpawn()");
  const actionsStart = shellSource.indexOf('// ── action registry');
  const actionsEnd = shellSource.indexOf('// THE one window keydown listener', actionsStart);
  const registry = shellSource.slice(actionsStart, actionsEnd);
  const titleCode = shellSource.slice(shellSource.indexOf("const baseTitles ="), shellSource.indexOf("onKeymapChange(() => applyChordTitles"));
  const functions = ["setNavActive", "sidebarHidden", "setSidebarHidden", "updateSidebarControls", "toggleSidebar", "focusRoster", "openShortcutsEditor", "openConnections"].map(name => fn(name, shellSource));
  const panelSetup = shellSource.slice(shellSource.indexOf("const contextPanel = createContextPanel"), shellSource.indexOf("/** Projection only:"));
  const s = runInNewContext(`${panelSetup}\n${navigation}\nconst SIDEBAR_HIDDEN_KEY = "oats-desktop-sidebar-hidden";\n${functions.join("\n")}\n${registry}\n${titleCode}\napplyChordTitles();\n({ openWorkspaceSouls, setNavActive, setSidebarHidden, applyChordTitles, contextPanel });`, c);
  offs.push(onKeymapChange(s.applyChordTitles));
  t.after(() => s.contextPanel.dispose());
  // Execute the production restore-button binding too.
  runInNewContext(shellSource.match(/document\.getElementById\("sidebar-restore"\)\.addEventListener[^\n]+/)[0], c);
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
  assert.equal(trigger.querySelector("#ws-context").textContent, "", "unknown context starts empty");
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
  assert.deepEqual(buttons.map(b => b.textContent), ["Active overview", "Workspace", "Schedules"]);
  assert.deepEqual(buttons.map(b => b.dataset.action), ["stage.hierarchy", "stage.spawn", "stage.schedules"]);
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
  assert.deepEqual([...foot.children].map(el => el.id), ["sidebar-spawn", "sidebar-tools"]);
  assert.deepEqual(tools.map(b => b.dataset.action), ["sidebar.toggle", "app.themeToggle", "app.shortcuts", "app.connections", "app.palette"]);
  for (const button of foot.querySelectorAll("button")) {
    assert.equal(button.type, "button"); assert.equal(button.hidden, false); assert.equal(button.disabled, false);
    assert.ok(button.tabIndex >= 0); assert.ok(button.getAttribute("aria-label")); assert.ok(button.title);
    assert.ok(button.querySelector('svg[aria-hidden="true"]'));
  }
  q("sidebar-theme").click(); q("sidebar-shortcuts").click(); q("sidebar-settings").click(); q("sidebar-palette").click();
  assert.deepEqual(s.events, [["theme"], ["shortcuts"], ["connections"], ["palette"]]);
  assert.equal(getBinding('app.connections'), null, 'Connections does not invent a new global chord');
  assert.match(q("sidebar-spawn").title, /Choose a soul/);
  assert.equal(getBinding("app.chooseSoul"), "Mod+N", "redesign shortcut chooses a soul, never launches one");
  const before = s.c.tabOpenIntents.begin(); q("sidebar-spawn").click();
  assert.equal(before(), false); assert.equal(s.loads.length, 1);
  await s.settle(s.loads[0], "resolve");
  assert.deepEqual(s.events.slice(4), [["tab", "souls"], ["stage", "spawn"]]);
  assert.match(source, /label: "Spawn instance: choose a soul in Workspace…", detail: chordDetail\("app.chooseSoul"\), run: \(\) => runAction\("app.chooseSoul"\)/);
});

test("hide/restore returns focus to visible controls and aria-expanded follows sidebar state", t => {
  const s = shell(t), q = id => s.document.getElementById(id);
  q("sidebar-toggle").focus(); q("sidebar-toggle").click();
  assert.equal(q("app").classList.contains("sidebar-hidden"), true);
  assert.equal(s.document.activeElement, q("sidebar-restore"));
  assert.equal(q("sidebar-toggle").getAttribute("aria-expanded"), "false");
  assert.equal(q("sidebar-restore").getAttribute("aria-expanded"), "false");
  q("sidebar-restore").click();
  assert.equal(q("app").classList.contains("sidebar-hidden"), false);
  assert.equal(s.document.activeElement, q("sidebar-toggle"));
  assert.equal(q("sidebar-toggle").getAttribute("aria-expanded"), "true");
});

test("SVG split controls retain their names and context-gated registry wiring", t => {
  const s = shell(t);
  const start = source.indexOf('const tabActionsEl = document.getElementById("tab-actions");');
  const end = source.indexOf("function updateSplitControls()", start);
  runInNewContext(source.slice(start, end), s.c);
  const buttons = ["split-right", "split-down", "split-close"].map(id => s.document.getElementById(id));
  setActiveContexts(new Set(["stage:spawn"]));
  buttons.forEach(b => b.click()); assert.deepEqual(s.events, [], "icons cannot bypass context gating");
  setActiveContexts(new Set(["tabs"]));
  buttons.forEach(b => {
    assert.ok(b.getAttribute("aria-label")); assert.ok(b.title); assert.ok(b.querySelector("svg.shell-icon")); b.click();
  });
  assert.deepEqual(s.events, [["split", "row"], ["split", "col"], ["split", "close"]]);
});

test("sidebar shortcuts keep Ctrl+B/F/N/P with the pty and dispatch Cmd+F/N on macOS", t => {
  shell(t);
  for (const key of ["b", "f", "n", "p"]) for (const isMac of [false, true]) {
    assert.equal(matchEvent({ key, ctrlKey: true }, { isMac, insideTerminal: true, editableTarget: false }), null);
  }
  for (const [key, action] of [["f", "sidebar.focusFilter"], ["n", "app.chooseSoul"]]) {
    assert.equal(matchEvent({ key, metaKey: true }, { isMac: true, insideTerminal: true }), action);
    assert.equal(matchEvent({ key, ctrlKey: true }, { isMac: false, insideTerminal: false }), action);
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
  if (superseder === "stage") s.document.querySelector('#nav [data-view="schedules"]').click();
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
    currentWorkspace: () => c.workspace, rosterResponseOwns,
    contextRosterEl: document.getElementById("instance-roster"),
    api(path) { const gate = { ...deferred(), path }; requests.push(gate); return gate.promise; },
    renderContextRoster() {}, refreshPanelInstance() {}, // label-only polling fixture
    workspaceLabel: createWorkspaceSwitcher({ document, selectWorkspace() {}, discoverSuggestions: async () => [], addWorkspace: async () => ({}), pickWorkspace: async () => ({}) }),
  };
  const s = runInNewContext(`${fn("refreshContextRoster")}\n${fn("renderWorkspaceContext")}\n({ refreshContextRoster, renderWorkspaceContext });`, c);
  const old = s.refreshContextRoster();
  assert.equal(requests[0].path, "/api/panel?ws=A");
  c.workspace = "B"; c.contextRosterGen++; c.workspaceLabel.reset(); s.renderWorkspaceContext(null);
  c.workspace = "A"; c.contextRosterGen++;
  const fresh = s.refreshContextRoster();
  const workspace = { id: "A", name: "same name", remote: true, server: 'host<&"' };
  requests[1].resolve({ workspace, workspaces: [workspace], instances: [] }); await fresh;
  const label = document.getElementById("ws-context");
  assert.equal(label.textContent, 'Remote deployment · host<&"'); assert.equal(label.children.length, 0);
  if (outcome === "resolve") requests[0].resolve({ workspace: { ...workspace, server: "old-host" }, instances: [] });
  else requests[0].reject(new Error("stale failure"));
  await old;
  assert.equal(label.textContent, 'Remote deployment · host<&"');
  assert.equal(document.querySelector(".ctx-list").textContent, "");
  s.renderWorkspaceContext({ id: "/reported/root", team: { name: "not a membership label" } });
  assert.equal(label.textContent, "/reported/root");
  s.renderWorkspaceContext(null); assert.equal(label.textContent, "");
});

test('White, Solarized and Dark have explicit registry/palette choices without new default chords; cycle stays named', t => {
  const s = shell(t);
  const button = s.document.getElementById('sidebar-theme');
  assert.equal(button.getAttribute('aria-label'), 'Cycle White / Solarized / Dark theme');
  assert.match(button.title, /White \/ Solarized \/ Dark/);
  const start = source.indexOf('// ── command palette');
  const end = source.indexOf('// ── Quick Open', start);
  const commands = runInNewContext(`${source.slice(start, end)}\npalette.commands`, {
    ...s.c, navigator: { platform: 'Linux' }, createPalette: options => options,
  });
  assert.deepEqual(THEMES.map(({ id, label }) => [id, label]), [['light', 'White'], ['solarized', 'Solarized'], ['dark', 'Dark']]);
  for (const { id, label } of THEMES) {
    assert.equal(getBinding(`app.theme.${id}`), null, `${label} has no new default keyboard chord`);
    const command = commands.find(item => item.label === `Theme: ${label}`); assert.ok(command);
    assert.equal(command.detail(), ''); command.run(); assert.deepEqual(s.events.at(-1), ['theme', id]);
  }
  const cycle = commands.find(item => item.label === 'Theme: cycle White / Solarized / Dark'); assert.ok(cycle);
  cycle.run(); assert.deepEqual(s.events.at(-1), ['theme']);
  assert.equal(commands.some(item => /light\/dark/i.test(item.label)), false);
});

test('shell icons are the pinned Lucide set: 24-unit geometry, stroke 2, decorative, brand excluded', t => {
  const dom = domFixture(t), document = dom.window.document;
  for (const name of ['splitRight', 'splitDown', 'splitClose', 'overview', 'workspace', 'schedules', 'close', 'branch']) {
    const span = document.createElement('span'); span.innerHTML = shellIcon(name); const svg = span.firstElementChild;
    assert.equal(svg.getAttribute('viewBox'), '0 0 24 24', name);
    assert.equal(svg.getAttribute('stroke-width'), '2', name);
    assert.equal(svg.getAttribute('aria-hidden'), 'true'); assert.equal(svg.getAttribute('focusable'), 'false');
    assert.ok(svg.children.length > 0, `${name} carries Lucide geometry`);
    assert.equal(svg.querySelector('script,foreignObject,[onload]'), null);
  }
  assert.throws(() => shellIcon('oats'), TypeError, 'the brand is artwork, not a shell icon');
});

test('shipped panel/footer buttons dispatch registry actions and preserve a visible exit from focus mode', t => {
  const s = shell(t), q = id => s.document.getElementById(id), panel = s.contextPanel;
  assert.equal(q('context-panel').parentElement.id, 'workbench');
  assert.equal(q('context-tools').parentElement.id, 'main');
  assert.equal(q('context-tools').closest('#tabhost, #stagehost, #sidebar, #context-panel'), null);
  assert.deepEqual([...q('context-tools').querySelectorAll('button')].map(b => b.dataset.action), ['panel.toggle', 'app.focusMode']);
  assert.equal(q('panel-toggle').disabled, true);
  panel.setContext({ workspace: 'A', instance: { instance: 'selected', home: '/A/selected' }, key: 'exact:A:selected' });
  const before = s.c.tabOpenIntents.begin(); q('panel-toggle').click();
  assert.equal(before(), false, 'footer panel action supersedes pending opens');
  assert.equal(q('context-panel').classList.contains('is-collapsed'), true);
  assert.equal(q('panel-toggle').getAttribute('aria-expanded'), 'false');
  q('panel-toggle').click();
  assert.equal(q('context-panel').classList.contains('is-collapsed'), false);
  q('sidebar-toggle').focus();
  const pending = s.c.tabOpenIntents.begin(); q('focus-mode-toggle').click();
  assert.equal(pending(), false); assert.equal(panel.isFocusMode(), true);
  assert.equal(q('context-panel').hidden, true); assert.equal(q('panel-toggle').disabled, true);
  assert.equal(q('focus-mode-toggle').textContent, 'Exit focus mode');
  assert.equal(q('focus-mode-toggle').getAttribute('aria-pressed'), 'true');
  assert.equal(q('focus-mode-toggle').getAttribute('aria-label'), 'Exit focus mode');
  assert.equal(s.document.activeElement, q('focus-mode-toggle'), 'hidden sidebar focus is restored to the visible exit');
  for (let node = q('focus-mode-toggle'); node; node = node.parentElement) {
    assert.equal(node.hidden, false); assert.equal(!!node.inert, false);
    assert.notEqual(s.document.defaultView.getComputedStyle(node).display, 'none', 'exit and its ancestors remain visible by shipped CSS');
  }
  assert.equal(s.document.defaultView.getComputedStyle(q('sidebar')).display, 'none');
  assert.equal(q('sidebar-toggle').getAttribute('aria-expanded'), 'false');
  q('focus-mode-toggle').click();
  assert.equal(panel.isFocusMode(), false); assert.equal(q('context-panel').hidden, false);
  assert.equal(q('focus-mode-toggle').textContent, 'Focus mode');
  assert.equal(q('panel-toggle').getAttribute('aria-expanded'), 'true');
});

for (const hidden of [false, true]) test(`focus mode overrides but restores raw sidebar preference hidden=${hidden}`, t => {
  const s = shell(t), q = id => s.document.getElementById(id), key = 'oats-desktop-sidebar-hidden';
  s.setSidebarHidden(hidden); s.contextPanel.setContext({ workspace: 'A', key: 'terminal' });
  s.contextPanel.setCollapsed(true);
  const stored = s.c.localStorage.getItem(key);
  q('focus-mode-toggle').click();
  assert.equal(q('app').classList.contains('sidebar-hidden'), hidden, 'temporary override never rewrites raw CSS preference');
  assert.equal(s.c.localStorage.getItem(key), stored);
  assert.equal(q('sidebar-restore').getAttribute('aria-expanded'), 'false');
  assert.equal(s.document.defaultView.getComputedStyle(q('sidebar-restore')).display, 'none');
  q('focus-mode-toggle').click();
  assert.equal(q('app').classList.contains('sidebar-hidden'), hidden);
  assert.equal(s.c.localStorage.getItem(key), hidden ? '1' : null);
  assert.equal(q('sidebar-toggle').getAttribute('aria-expanded'), String(!hidden));
  assert.equal(s.document.defaultView.getComputedStyle(q('sidebar')).display, hidden ? 'none' : 'flex');
  assert.equal(s.document.defaultView.getComputedStyle(q('sidebar-restore')).display, hidden ? 'flex' : 'none');
  assert.equal(q('context-panel').classList.contains('is-collapsed'), true, 'focus override also preserves panel collapse preference');
});

test('focusRoster exits focus mode, reveals the sidebar and focuses its filter through the registered command', t => {
  const s = shell(t), q = id => s.document.getElementById(id);
  s.setSidebarHidden(true); q('focus-mode-toggle').click();
  assert.equal(s.contextPanel.isFocusMode(), true);
  const pending = s.c.tabOpenIntents.begin(); runAction('sidebar.focusFilter');
  assert.equal(pending(), false); assert.equal(s.contextPanel.isFocusMode(), false);
  assert.equal(q('app').classList.contains('sidebar-hidden'), false);
  assert.equal(s.c.localStorage.getItem('oats-desktop-sidebar-hidden'), null);
  assert.equal(q('sidebar-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(s.document.activeElement, s.document.querySelector('.ctx-filter'));
});

test('panel/focus actions have no defaults and cannot capture Linux terminal bytes after rebinding', t => {
  shell(t);
  for (const [id, key] of [['panel.toggle', 'j'], ['app.focusMode', 'u']]) {
    assert.equal(DEFAULT_KEYMAP[id], undefined); assert.equal(getBinding(id), null);
    assert.equal(TERMINAL_ALLOWLIST.includes(id), false);
    t.after(() => resetBinding(id)); setBinding(id, `Mod+${key.toUpperCase()}`);
    assert.equal(matchEvent({ key, ctrlKey: true }, { isMac: false, insideTerminal: true }), null);
    assert.equal(matchEvent({ key, ctrlKey: true }, { isMac: false, insideTerminal: false }), id);
    assert.equal(matchEvent({ key, metaKey: true }, { isMac: true, insideTerminal: true }), id);
  }
});
