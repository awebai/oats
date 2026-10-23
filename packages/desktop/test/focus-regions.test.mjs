// Spec F, Part 4: F6 / Shift+F6 cycle the window's regions — the sidebar's, top to bottom
// (workspaces → views, the nav under the list → instance roster), then main → instance panel (the sidebar
// layout, 2026-10-23) — skipping hidden ones and landing on each region's current item, never <body>. The
// sidebar's foot (the sidebar toggle, the settings cog) is not a region.
// And "back to where you were" after a flow that moved the main surface.
// The shipped index.html and shell.css (scripts are not run), so ids and hiding rules are real.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createFocusRegions, REGIONS } from "../renderer/focus-regions.mjs";
import { NAV } from "../renderer/shell-nav.mjs";
import { createSurfaceReturn } from "../renderer/surface-return.mjs";
import { captureFocusReturn } from "../renderer/focus-return.mjs";

const read = name => readFileSync(new URL(`../renderer/${name}`, import.meta.url), "utf8");

function shell(t, { tabs = false } = {}) {
  const dom = new JSDOM(read("index.html"));
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const style = doc.createElement("style"); style.textContent = read("shell.css"); doc.head.append(style);
  // What the shell paints: the workspace list (one roving stop, the current row), the nav's items under the list
  // from the shipped manifest (Workspace current), roster rows (one roving stop), a stage and a panel with tabs.
  doc.getElementById("ws-options").innerHTML = `<ul class="ws-group"><li class="ws-option-row"><button type="button" class="ws-option" aria-current="true" tabindex="0" data-workspace-id="/w/a">Team A</button></li><li class="ws-option-row"><button type="button" class="ws-option" tabindex="-1" data-workspace-id="/w/b">Team B</button></li></ul>`;
  doc.getElementById("nav").innerHTML = NAV.map(v => v.name === "spawn"
    ? `<button class="nav-item active" data-view="${v.name}" aria-current="page">${v.label}</button>`
    : `<button class="nav-item" data-view="${v.name}">${v.label}</button>`).join("");
  doc.querySelector("#instance-roster .ctx-list").innerHTML = `<div class="ctx-tree-row"><button class="ctx-inst" tabindex="-1" data-tree-instance="a">a</button></div><div class="ctx-tree-row active"><button class="ctx-inst active" tabindex="0" data-tree-instance="b">b</button><span class="ctx-row-tools"><button class="ctx-start">Start…</button></span></div>`;
  doc.getElementById("stagehost").innerHTML = `<div><div class="workspace-tabs"><button role="tab" aria-selected="true" tabindex="0">Souls</button></div><input class="filter"></div>`;
  const panel = doc.getElementById("context-panel"); panel.hidden = false;
  panel.innerHTML = `<div role="tablist"><button role="tab" aria-selected="false" tabindex="-1">Instance</button><button role="tab" aria-selected="true" tabindex="0">Soul</button></div>`;
  let layer = tabs, terminal = null;
  if (tabs) {
    doc.getElementById("stagehost").style.display = "none";
    doc.getElementById("tabhost").style.display = "";
    doc.getElementById("tabbar").innerHTML = `<div class="tab"><button role="tab" aria-selected="true" tabindex="0">dev</button></div>`;
    doc.getElementById("tabhost").innerHTML = `<div class="tab-pane active"><div class="xterm"><textarea class="xterm-helper-textarea"></textarea></div></div>`;
    terminal = doc.querySelector(".xterm-helper-textarea");
  }
  const regions = createFocusRegions({ doc, tabLayerVisible: () => layer, focusMainContent: () => { terminal?.focus(); return !!terminal; } });
  return { dom, doc, regions, terminal, setLayer: v => { layer = v; },
    // Icon buttons have no text here (the shell mounts their icons): they read as their #id.
    where: () => doc.activeElement === doc.body ? "body" : doc.activeElement.textContent || (doc.activeElement.id && `#${doc.activeElement.id}`) || doc.activeElement.className };
}

// The sidebar's order top to bottom, then the main area: the views (the nav) sit under the list of workspaces,
// above the roster. "nav" and "footer" are no region names any more.
test("F6 order: workspaces → views → roster → main → panel → workspaces, each on its current item", t => {
  const s = shell(t);
  assert.deepEqual(REGIONS, ["workspaces", "views", "roster", "main", "panel"]);
  for (const old of ["nav", "footer"]) {
    assert.equal(s.regions.visible(old), false, `the old region name ${old} is gone`);
    assert.equal(s.regions.focusRegion(old), false);
  }
  const visited = [];
  for (let i = 0; i < 6; i++) { assert.equal(s.regions.cycle(1), true); visited.push(s.where()); }
  assert.deepEqual(visited, ["Team A", "Workspace", "b", "Souls", "Soul", "Team A"],
    "the list's tab stop, the current view's nav item, the selected roster row, the stage's first control, the panel's selected tab");
  const back = [];
  for (let i = 0; i < 5; i++) { s.regions.cycle(-1); back.push(s.where()); }
  assert.deepEqual(back, ["Soul", "Souls", "b", "Workspace", "Team A"], "Shift+F6 walks it backwards");
});

// Where each sidebar region lands when its first choice is missing: never <body>, never a control of
// another region.
test("workspaces lands on the list's tab stop, else Add local workspace…; views on the current nav item, else the first, else nothing", t => {
  const s = shell(t);
  // The list's stop is the row last focused (the roving tabindex), not necessarily the current one.
  const [a, b] = s.doc.querySelectorAll("#ws-options .ws-option");
  a.tabIndex = -1; b.tabIndex = 0;
  assert.equal(s.regions.focusRegion("workspaces"), true); assert.equal(s.where(), "Team B");
  s.doc.getElementById("ws-options").innerHTML = ""; // no workspace listed yet
  assert.equal(s.regions.focusRegion("workspaces"), true); assert.equal(s.where(), "#ws-add-open");
  assert.equal(s.regions.regionOfFocus(), "workspaces");
  const nav = s.doc.getElementById("nav");
  assert.equal(s.regions.focusRegion("views"), true); assert.equal(s.where(), "Workspace", "the current view's nav item");
  nav.querySelector('[aria-current="page"]').removeAttribute("aria-current"); // a terminal in front: no current view
  assert.equal(s.regions.focusRegion("views"), true); assert.equal(s.where(), "Workspace", "else the first nav item (Workspace, first since 2026-10-23)");
  nav.innerHTML = "";
  const before = s.doc.activeElement;
  assert.equal(s.regions.focusRegion("views"), false, "no nav item: nothing to land on (never the foot's buttons)");
  assert.equal(s.doc.activeElement, before, "focus stays where it was, never <body>");
});

// A heading's control belongs to the section it heads: Add local workspace… to the workspaces, Spawn instance to
// the roster. The views are the nav. The foot (the sidebar toggle, the settings cog and its menu) is no region.
test("regionOfFocus: the head's + and the rows are workspaces; the nav items are views; Spawn instance is roster; the foot is none", t => {
  const s = shell(t);
  assert.equal(s.doc.getElementById("sidebar-tools"), null, "the tools row is gone");
  for (const el of [s.doc.getElementById("ws-add-open"), ...s.doc.querySelectorAll("#ws-options .ws-option")]) {
    el.focus(); assert.equal(s.regions.regionOfFocus(), "workspaces", s.where());
  }
  for (const el of s.doc.querySelectorAll("#nav button")) { el.focus(); assert.equal(s.regions.regionOfFocus(), "views", s.where()); }
  s.doc.getElementById("sidebar-spawn").focus(); assert.equal(s.regions.regionOfFocus(), "roster", "the Instances heading's +");
  // The cog's menu, as sidebar-settings.mjs mounts it: right after the cog, in the foot.
  const menu = s.doc.createElement("div"); menu.setAttribute("role", "menu");
  const item = s.doc.createElement("button"); item.setAttribute("role", "menuitem"); item.textContent = "Theme…"; menu.append(item);
  s.doc.getElementById("sidebar-settings").after(menu);
  const foot = [...s.doc.querySelectorAll("#nav-foot button")].map(b => b.id || b.textContent);
  assert.deepEqual(foot, ["sidebar-toggle", "sidebar-settings", "Theme…"], "the foot: the toggle, the cog and its menu");
  for (const el of s.doc.querySelectorAll("#nav-foot button")) { el.focus(); assert.equal(s.regions.regionOfFocus(), null, `${s.where()}: no region`); }
  assert.equal(REGIONS.some(name => s.regions.visible(name) && s.regions.currentItem(name)?.closest("#nav-foot")), false, "no region lands in the foot");
});

test("from a control inside a region (the workspace list, a row's tools, a heading's control) F6 moves on to the next region", t => {
  const s = shell(t);
  s.doc.querySelector('#ws-options .ws-option[aria-current="true"]').focus(); s.regions.cycle(1);
  assert.equal(s.where(), "Workspace", "the workspace list is the first region: next are the views under it");
  s.doc.getElementById("ws-add-open").focus(); s.regions.cycle(1);
  assert.equal(s.where(), "Workspace", "so is the heading's Add local workspace…");
  s.doc.getElementById("ws-add-open").focus(); s.regions.cycle(-1);
  assert.equal(s.where(), "Soul", "Shift+F6 from the heading's + goes back to the panel");
  s.doc.querySelector('#ws-options .ws-option[tabindex="-1"]').focus(); s.regions.cycle(-1);
  assert.equal(s.where(), "Soul", "Shift+F6 from the list goes back to the panel");
  s.doc.querySelector(".ctx-start").focus(); s.regions.cycle(1);
  assert.equal(s.where(), "Souls", "from a roster row's tools, main");
  s.doc.getElementById("sidebar-spawn").focus(); s.regions.cycle(1);
  assert.equal(s.where(), "Souls", "from the Instances heading's +, main");
  s.doc.getElementById("sidebar-spawn").focus(); s.regions.cycle(-1);
  assert.equal(s.where(), "Workspace", "Shift+F6 from the Instances heading's + goes back to the views");
  s.doc.querySelector("#nav button:last-child").focus(); s.regions.cycle(1);
  assert.equal(s.where(), "b", "from a nav item, the roster");
  s.doc.querySelector("#nav button:last-child").focus(); s.regions.cycle(-1);
  assert.equal(s.where(), "Team A", "Shift+F6 from a nav item, the workspaces");
  // The foot is below the roster and no region: F6 goes on to main, Shift+F6 back to the roster.
  for (const id of ["sidebar-toggle", "sidebar-settings"]) {
    s.doc.getElementById(id).focus(); s.regions.cycle(1);
    assert.equal(s.where(), "Souls", `from the foot's ${id}, main`);
    s.doc.getElementById(id).focus(); s.regions.cycle(-1);
    assert.equal(s.where(), "b", `Shift+F6 from the foot's ${id}, the roster`);
  }
});

test("hidden regions are skipped: a hidden sidebar, focus mode, an empty panel", t => {
  const s = shell(t);
  s.doc.getElementById("app").classList.add("sidebar-hidden");
  s.doc.body.focus(); s.regions.cycle(1); assert.equal(s.where(), "Souls");
  s.regions.cycle(1); assert.equal(s.where(), "Soul");
  s.regions.cycle(1); assert.equal(s.where(), "Souls", "the workspaces, views and roster are skipped");
  s.doc.getElementById("app").classList.replace("sidebar-hidden", "focus-mode");
  s.doc.getElementById("context-panel").hidden = true;
  assert.deepEqual(REGIONS.filter(s.regions.visible), ["main"]);
  s.regions.cycle(1); assert.equal(s.where(), "Souls");
});

test("never <body>: a region with nothing to focus is passed over", t => {
  const s = shell(t);
  s.doc.getElementById("stagehost").innerHTML = "<p>Loading…</p>";
  s.doc.querySelector(".ctx-inst.active").focus(); // in the roster
  s.regions.cycle(1);
  assert.equal(s.where(), "Soul", "main had no control: on to the panel");
  assert.notEqual(s.doc.activeElement, s.doc.body);
});

test("a closed panel is out of the cycle (Spec B), the hidden-region rule; main is the active terminal", t => {
  const s = shell(t, { tabs: true });
  s.doc.getElementById("context-panel").hidden = true; // closed: no rail stands in for it
  s.doc.getElementById("show-panel").hidden = false;
  assert.deepEqual(REGIONS.filter(s.regions.visible), ["workspaces", "views", "roster", "main"]);
  s.terminal.focus();
  s.regions.cycle(1); assert.equal(s.where(), "Team A", "from the terminal past the closed panel, back to the workspaces");
  s.regions.cycle(-1); assert.equal(s.doc.activeElement, s.terminal, "and Shift+F6 back to the terminal");
  s.regions.cycle(-1); assert.equal(s.where(), "b", "Shift+F6 from the terminal: the roster");
  s.regions.cycle(1);
  assert.equal(s.doc.activeElement, s.terminal, "main in the tab layer is the terminal's input");
  assert.equal(s.regions.regionOfFocus(), "main");
  s.doc.getElementById("show-panel").focus();
  assert.equal(s.regions.regionOfFocus(), "main", "Show instance panel belongs to the Main region");
  s.doc.getElementById("app").classList.add("sidebar-hidden"); s.doc.getElementById("show-sidebar").hidden = false;
  s.doc.getElementById("show-sidebar").focus();
  assert.equal(s.regions.regionOfFocus(), "main", "and so does Show sidebar");
});

// The roster's fallback after its tab stop: a control under the heading (a failed read's Retry), before the
// heading's Spawn instance +, which comes first in the DOM; the + when the roster shows nothing else.
test("the roster without a row stop lands on a control under its heading (a Retry), else its heading's Spawn instance, else it is passed over: it has no filter", t => {
  const s = shell(t);
  const roster = s.doc.getElementById("instance-roster"), list = s.doc.querySelector(".ctx-list");
  assert.equal(roster.querySelector(".ctx-filter, input"), null, "the shipped roster has no filter field");
  assert.deepEqual([...roster.children].map(el => el.className), ["ctx-head", "ctx-list"], "its head, then its list");
  assert.deepEqual([...roster.querySelector(".ctx-head").querySelectorAll("button")].map(b => b.id), ["sidebar-spawn"], "the heading's one control");
  // A failed first read: no rows, only the failed block's Retry.
  list.innerHTML = `<div class="loading-failed"><button type="button" class="act">Retry</button></div>`;
  assert.equal(s.regions.focusRegion("roster"), true);
  assert.equal(s.where(), "Retry", "the Retry, not the heading's + before it");
  // A stale notice's Retry sits between the heading and the list (instance-tree-view.mjs createRosterLoading).
  list.innerHTML = `<div class="ctx-empty">No instances.</div>`;
  const notice = s.doc.createElement("div"); notice.className = "ctx-status"; notice.innerHTML = '<button type="button" class="act">Retry</button>';
  list.before(notice);
  assert.equal(s.regions.focusRegion("roster"), true); assert.equal(s.doc.activeElement, notice.firstElementChild, "a stale notice's Retry");
  notice.remove();
  // An empty roster: its one action, Spawn instance.
  s.doc.querySelector("#nav button").focus();
  s.regions.cycle(1);
  assert.equal(s.where(), "#sidebar-spawn", "from the views, the empty roster's Spawn instance");
  // Nothing to focus at all: the region is skipped, never <body>.
  s.doc.getElementById("sidebar-spawn").hidden = true;
  s.doc.querySelector("#nav button").focus();
  assert.equal(s.regions.focusRegion("roster"), false);
  s.regions.cycle(1);
  assert.equal(s.where(), "Souls", "from the views past the empty roster, main");
});

// ── surface-return: back to where the operator was ─────────────────────

function surfaces(t, start) {
  const s = shell(t, { tabs: start.tab != null });
  const state = { workspace: "A", generation: 0, stage: start.stage, tab: start.tab ?? null, layer: start.tab != null, workspaceTab: start.workspaceTab ?? null };
  const calls = [];
  const pane = s.doc.querySelector(".tab-pane");
  const back = createSurfaceReturn({ doc: s.doc, currentWorkspace: () => state.workspace, workspaceGeneration: () => state.generation,
    surface: () => ({ stage: state.stage, tab: state.tab, tabLayerVisible: state.layer, workspaceTab: state.stage === "spawn" ? state.workspaceTab : null }),
    tabPane: id => (id === 1 ? pane : null),
    showStage: async name => { calls.push(["stage", name]); state.stage = name; state.layer = false; },
    selectTab: (id, opts) => { calls.push(["tab", id, opts.focusContent]); state.layer = true; state.tab = id; if (opts.focusContent) s.terminal.focus(); return true; },
    focusRegion: name => { calls.push(["region", name]); return s.regions.focusRegion(name); },
    // The Workspace page's tabs, as views/spawn.mjs answers them: the tab shown, its panel (re)mounted, its control.
    selectWorkspaceTab: name => { calls.push(["workspaceTab", name]); if (!hooks.selectable) return null; state.workspaceTab = name; hooks.remount?.(name); return s.doc.getElementById(`workspace-tab-${name}`); },
    host: "spawn" });
  const hooks = { selectable: true, remount: null };
  // Quick Open → the Workspace stage with the dialog, which opens on Souls (the flow under test moves the surface).
  const move = () => { state.stage = "spawn"; state.layer = false; state.workspaceTab = "souls"; s.doc.activeElement?.blur(); };
  return { ...s, state, calls, back, move, hooks };
}

test("return: from a terminal tab, re-activate it with its terminal focused (and the stage under it)", async t => {
  const u = surfaces(t, { stage: "hierarchy", tab: 1 });
  u.terminal.focus();
  const origin = u.back.capture(captureFocusReturn(u.doc));
  u.move();
  assert.equal(u.back.restore(origin), true);
  assert.deepEqual(u.calls, [["stage", "hierarchy"], ["tab", 1, true]]);
  assert.equal(u.doc.activeElement, u.terminal);
});

test("return: from a stage, the same stage and the control left, else that region's current item", async t => {
  const u = surfaces(t, { stage: "hierarchy" });
  const filter = u.doc.querySelector("#stagehost .filter"); filter.id = "kept"; filter.focus();
  const origin = u.back.capture(captureFocusReturn(u.doc));
  u.move();
  assert.equal(u.back.restore(origin), true);
  await new Promise(setImmediate);
  assert.deepEqual(u.calls, [["stage", "hierarchy"]]);
  assert.equal(u.doc.activeElement, filter);
  // The control is gone after the stage remounts: the stage's first control instead.
  const again = u.back.capture(captureFocusReturn(u.doc));
  u.move(); filter.remove();
  u.back.restore(again); await new Promise(setImmediate);
  assert.equal(u.where(), "Souls", "a control of the same stage, never <body>");
});

test("return: from a roster row while a terminal was visible, the tab comes back and focus goes to the row", async t => {
  const u = surfaces(t, { stage: "spawn", tab: 1 });
  const row = u.doc.querySelector(".ctx-inst.active"); row.focus();
  const origin = u.back.capture(captureFocusReturn(u.doc));
  u.move();
  assert.equal(u.back.restore(origin), true);
  assert.deepEqual(u.calls, [["tab", 1, false]], "same stage under it: no stage switch; the tab without taking focus");
  assert.equal(u.doc.activeElement, row);
});

// Workspace › Automations: the dialog opens on Souls, and leaving Automations disposes its panel (syncAutomations).
function onAutomations(t) {
  const u = surfaces(t, { stage: "spawn", workspaceTab: "automations" });
  const tabs = u.doc.querySelector("#stagehost .workspace-tabs");
  tabs.insertAdjacentHTML("beforeend", `<button role="tab" id="workspace-tab-automations" aria-selected="true" tabindex="0">Automations</button>`);
  tabs.insertAdjacentHTML("afterend", `<div id="workspace-automations" role="tabpanel"></div>`);
  const panel = u.doc.getElementById("workspace-automations");
  const mount = () => { panel.innerHTML = `<button id="automations-tab-trigger" role="tab">Triggers</button><button class="auto-new">New</button>`; };
  mount();
  // The dialog over Souls: Automations' panel is gone.
  const moveAndDispose = () => { u.move(); panel.replaceChildren(); };
  return { ...u, panel, mount, moveAndDispose };
}

test("return within Workspace: back on the tab left (Automations), its panel remounted, on the control left", async t => {
  const u = onAutomations(t);
  u.doc.getElementById("automations-tab-trigger").focus();
  const origin = u.back.capture(captureFocusReturn(u.doc));
  assert.equal(origin.workspaceTab, "automations", "the page's tab is part of where they were");
  u.moveAndDispose();
  u.hooks.remount = () => u.mount();
  assert.equal(u.back.restore(origin), true);
  assert.deepEqual(u.calls, [["workspaceTab", "automations"]], "no stage switch: the same stage, its tab");
  assert.equal(u.state.workspaceTab, "automations");
  assert.equal(u.doc.activeElement, u.doc.getElementById("automations-tab-trigger"), "the control left, by its identity, in the remounted panel");
});

test("return within Workspace: a panel still loading its controls lands on its tab, never a neighbour", async t => {
  const u = onAutomations(t);
  u.panel.querySelector(".auto-new").focus(); // no id: only its ancestors could find a replacement
  const origin = u.back.capture(captureFocusReturn(u.doc));
  u.moveAndDispose();
  assert.equal(u.back.restore(origin), true);
  assert.equal(u.doc.activeElement, u.doc.getElementById("workspace-tab-automations"), "the tab itself, not the Souls tab or the sidebar");
  // A tab the page can't show any more: refused, the dialog restores focus itself.
  const v = onAutomations(t);
  v.doc.getElementById("automations-tab-trigger").focus();
  const again = v.back.capture(captureFocusReturn(v.doc));
  v.moveAndDispose(); v.hooks.selectable = false;
  assert.equal(v.back.restore(again), false);
  // The same tab (Souls, where the dialog opens): no tab switch, the control left as before.
  const w = surfaces(t, { stage: "spawn", workspaceTab: "souls" });
  const filter = w.doc.querySelector("#stagehost .filter"); filter.focus();
  const same = w.back.capture(captureFocusReturn(w.doc));
  w.move();
  assert.equal(w.back.restore(same), true);
  assert.deepEqual(w.calls, []); assert.equal(w.doc.activeElement, filter);
});

test("return is refused when the operator moved on: another workspace, a tab over the dialog, another stage, a closed tab", async t => {
  for (const moveOn of [
    u => { u.state.workspace = "B"; u.state.generation++; },
    u => { u.state.generation++; },
    u => { u.state.layer = true; },
    u => { u.state.stage = "automations"; },
  ]) {
    const u = surfaces(t, { stage: "hierarchy" });
    u.doc.querySelector("#stagehost .filter").focus();
    const origin = u.back.capture(captureFocusReturn(u.doc));
    u.move(); moveOn(u);
    assert.equal(u.back.restore(origin), false);
    assert.deepEqual(u.calls, [], "nothing is forced");
  }
  const u = surfaces(t, { stage: "hierarchy", tab: 1 });
  const origin = u.back.capture(captureFocusReturn(u.doc));
  u.move(); origin.tab = 2; // a tab that no longer exists
  assert.equal(u.back.restore(origin), false);
});

test("a stage return that a newer action overtakes does not steal focus", async t => {
  const u = surfaces(t, { stage: "hierarchy" });
  u.doc.querySelector("#stagehost .filter").focus();
  const origin = u.back.capture(captureFocusReturn(u.doc));
  u.move();
  u.back.restore(origin);
  const row = u.doc.querySelector('#ws-options .ws-option[aria-current="true"]');
  row.focus(); // the operator is already elsewhere (the workspace list) when the stage mounts
  await new Promise(setImmediate);
  assert.equal(u.doc.activeElement, row);
});
