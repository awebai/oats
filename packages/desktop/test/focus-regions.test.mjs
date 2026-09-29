// Spec F, Part 4: F6 / Shift+F6 cycle the window's regions — sidebar nav → instance roster →
// main → instance panel — skipping hidden ones and landing on each region's current item,
// never <body>. And "back to where you were" after a flow that moved the main surface.
// The shipped index.html and shell.css (scripts are not run), so ids and hiding rules are real.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createFocusRegions, REGIONS } from "../renderer/focus-regions.mjs";
import { createSurfaceReturn } from "../renderer/surface-return.mjs";
import { captureFocusReturn } from "../renderer/focus-return.mjs";

const read = name => readFileSync(new URL(`../renderer/${name}`, import.meta.url), "utf8");

function shell(t, { tabs = false } = {}) {
  const dom = new JSDOM(read("index.html"));
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const style = doc.createElement("style"); style.textContent = read("shell.css"); doc.head.append(style);
  // What the shell paints: nav items, roster rows (one roving stop), a stage and a panel with tabs.
  doc.getElementById("nav").innerHTML = `<button class="nav-item" data-view="hierarchy">Active overview</button><button class="nav-item active" data-view="spawn" aria-current="page">Workspace</button><button class="nav-item" data-view="automations">Automations</button>`;
  doc.querySelector("#instance-roster .ctx-list").innerHTML = `<div class="ctx-tree-row"><button class="ctx-inst" tabindex="-1" data-tree-instance="a">a</button></div><div class="ctx-tree-row active"><button class="ctx-inst active" tabindex="0" data-tree-instance="b">b</button><span class="ctx-row-tools"><button class="ctx-start">Start…</button></span></div>`;
  doc.getElementById("stagehost").innerHTML = `<div><div class="workspace-tabs"><button role="tab" aria-selected="true" tabindex="0">Souls</button></div><input class="filter"></div>`;
  const panel = doc.getElementById("context-panel"); panel.hidden = false;
  panel.innerHTML = `<div role="tablist"><button role="tab" aria-selected="false" tabindex="-1">Instance</button><button role="tab" aria-selected="true" tabindex="0">Soul</button></div><div class="context-panel-rail" hidden><button class="context-panel-rail-tab" aria-pressed="true">Soul</button></div>`;
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
    where: () => doc.activeElement === doc.body ? "body" : doc.activeElement.textContent || doc.activeElement.className };
}

test("F6 order: nav → roster → main → panel → nav, each on its current item", t => {
  const s = shell(t);
  assert.deepEqual(REGIONS, ["nav", "roster", "main", "panel"]);
  const visited = [];
  for (let i = 0; i < 5; i++) { assert.equal(s.regions.cycle(1), true); visited.push(s.where()); }
  assert.deepEqual(visited, ["Workspace", "b", "Souls", "Soul", "Workspace"],
    "the current view's nav item, the selected roster row, the stage's first control, the panel's selected tab");
  const back = [];
  for (let i = 0; i < 4; i++) { s.regions.cycle(-1); back.push(s.where()); }
  assert.deepEqual(back, ["Soul", "Souls", "b", "Workspace"], "Shift+F6 walks it backwards");
});

test("from a control inside a region (the switcher, a row's tools) F6 moves on to the next region", t => {
  const s = shell(t);
  s.doc.getElementById("ws-trigger").focus(); s.regions.cycle(1);
  assert.equal(s.where(), "b", "the switcher counts as the sidebar nav: next is the roster");
  s.doc.querySelector(".ctx-start").focus(); s.regions.cycle(1);
  assert.equal(s.where(), "Souls");
});

test("hidden regions are skipped: a hidden sidebar, focus mode, an empty panel", t => {
  const s = shell(t);
  s.doc.getElementById("app").classList.add("sidebar-hidden");
  s.doc.body.focus(); s.regions.cycle(1); assert.equal(s.where(), "Souls");
  s.regions.cycle(1); assert.equal(s.where(), "Soul");
  s.regions.cycle(1); assert.equal(s.where(), "Souls", "nav and roster are skipped");
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

test("a collapsed panel keeps its rail in the cycle (a terminal eats Tab); main is the active terminal", t => {
  const s = shell(t, { tabs: true });
  const panel = s.doc.getElementById("context-panel");
  panel.querySelector('[role="tablist"]').hidden = true; panel.querySelector(".context-panel-rail").hidden = false;
  s.terminal.focus();
  s.regions.cycle(1); assert.equal(s.where(), "Soul"); assert.ok(s.doc.activeElement.classList.contains("context-panel-rail-tab"));
  s.regions.cycle(1); s.regions.cycle(1); s.regions.cycle(1);
  assert.equal(s.doc.activeElement, s.terminal, "main in the tab layer is the terminal's input");
  assert.equal(s.regions.regionOfFocus(), "main");
});

test("the roster without a selected row lands on its first row's stop, else its filter", t => {
  const s = shell(t);
  s.doc.querySelector(".ctx-list").innerHTML = "";
  s.regions.focusRegion("roster");
  assert.ok(s.doc.activeElement.classList.contains("ctx-filter"));
});

// ── surface-return: back to where the operator was ─────────────────────

function surfaces(t, start) {
  const s = shell(t, { tabs: start.tab != null });
  const state = { workspace: "A", generation: 0, stage: start.stage, tab: start.tab ?? null, layer: start.tab != null };
  const calls = [];
  const pane = s.doc.querySelector(".tab-pane");
  const back = createSurfaceReturn({ doc: s.doc, currentWorkspace: () => state.workspace, workspaceGeneration: () => state.generation,
    surface: () => ({ stage: state.stage, tab: state.tab, tabLayerVisible: state.layer }),
    tabPane: id => (id === 1 ? pane : null),
    showStage: async name => { calls.push(["stage", name]); state.stage = name; state.layer = false; },
    selectTab: (id, opts) => { calls.push(["tab", id, opts.focusContent]); state.layer = true; state.tab = id; if (opts.focusContent) s.terminal.focus(); return true; },
    focusRegion: name => { calls.push(["region", name]); return s.regions.focusRegion(name); }, host: "spawn" });
  // Quick Open → the Workspace stage with the dialog (the flow under test moves the surface).
  const move = () => { state.stage = "spawn"; state.layer = false; s.doc.activeElement?.blur(); };
  return { ...s, state, calls, back, move };
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
  u.doc.getElementById("ws-trigger").focus(); // the operator is already elsewhere when the stage mounts
  await new Promise(setImmediate);
  assert.equal(u.doc.activeElement, u.doc.getElementById("ws-trigger"));
});
