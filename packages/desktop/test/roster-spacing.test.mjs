// Non-layout CSS/DOM contracts: jsdom does not measure font boxes, paint tree
// guides or capture screenshots. Execute only the shipped roster render function;
// no shell startup, HTTP, Electron, IPC, CLI or real terminal/session operations.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { JSDOM } from "jsdom";
import * as tree from "../renderer/instance-tree.mjs";
import { instanceActions, captureInstanceActionMenu } from "../renderer/instance-actions.mjs";
import { instanceActionTarget, sameInstanceActionTarget } from '../renderer/instance-action-target.mjs';
import { instanceSplitPlan } from '../renderer/instance-split.mjs';
import { runtimeState } from "../renderer/instance-presentation.mjs";
import { createRuntimeBadge } from "../renderer/identity-marks.mjs";

const read = name => readFileSync(new URL(`../renderer/${name}`, import.meta.url), "utf8");
const css = read("shell.css"), html = read("index.html");
const renderSource = read("shell.mjs").match(/function renderContextRoster\(instances\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(renderSource, "exercise the shipped roster composition, not a hand-copied row");
const instance = (name, parentInstance) => ({ instance: name, parentInstance,
  home: `/synthetic/${name}`, agentsRoot: "/synthetic/agents", repoName: "desktop-repo", running: true });
const roster = [instance("root"), instance("child-a", "root"), instance("grand-a", "child-a"),
  instance("child-b", "root"), instance("grand-b", "child-b"),
  { ...instance("unknown"), running: null }];

function fixture(t, stylesheet = css) {
  // Default jsdom disables scripts and external resource loading in shipped HTML.
  const dom = new JSDOM(html);
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const style = doc.createElement("style"); style.textContent = stylesheet; doc.head.append(style);
  const rules = [...style.sheet.cssRules];
  const rule = selector => {
    const matches = rules.filter(r => r.selectorText === selector);
    assert.equal(matches.length, 1, `one shipped rule for ${selector}`);
    return matches[0].style;
  };
  const context = {
    ...tree, document: doc, instanceActions, captureInstanceActionMenu, runtimeState, createRuntimeBadge,
    instanceActionTarget, instanceSplitPlan, connectionGeneration: 0, menuState() {}, runAction: assert.fail,
    applyChordTitles() {}, updateActiveContexts() {}, getBinding: () => null, formatChord: c => c, isMac: true,
    contextRosterEl: doc.querySelector("#instance-roster"), contextFilter: "", contextWorkspace: "A",
    contextInstances: roster, currentWorkspace: () => "A", workspaceGeneration: () => 0, collapsedInstances: new Set(), collapsedGroups: new Set(),
    tabs: new Map([[1, { key: tree.terminalKey("A", roster[1]) }]]), activeTab: 1,
    tabOpenIntents: { applyFocus: fn => fn() },
    // Display-only fixture: any attempted navigation/action is a test failure.
    openTerminalTab: assert.fail, openInstanceStart: assert.fail, openLifecycleDialog: assert.fail, onRosterRowKey: assert.fail,
    api: assert.fail, showStage: assert.fail, refreshContextRoster: assert.fail,
  };
  context.splitOpenState = () => ({ split: null, activeId: context.activeTab, tabs: context.tabs, workspace: 'A', visible: false });
  context.ownsInstanceTarget = target => context.contextInstances.filter(row => sameInstanceActionTarget(target, row, 'A')).length === 1;
  const render = runInNewContext(`${renderSource}\nrenderContextRoster`, context);
  render(roster);
  return { doc, rule, render, rows: [...doc.querySelectorAll(".ctx-tree-row")],
    computed: node => dom.window.getComputedStyle(node) };
}

function assertRoom(u) {
  assert.equal(u.rule(".ctx-tree-row").minHeight, "50px", "rows are the roomier 50px the human chose over the design's 44px");
  assert.equal(u.rule(".ctx-inst").minHeight, "50px", "the whole row height is one click target");
  assert.equal(u.rule(".ctx-inst").height, "auto", "never squeeze two labels into a fixed box");
  assert.equal(u.rule(".ctx-copy").gap, "3px", "name/meta gap follows the supplied 3px stack");
  assert.equal(u.computed(u.doc.querySelector(".ctx-filter-field")).marginBottom, "6px", "filter/list separation");
  assert.equal(u.computed(u.doc.querySelector(".ctx-filter-field")).height, "30px");
  for (const row of u.rows) {
    const button = row.querySelector(".ctx-inst");
    for (const el of [row, button]) {
      const style = u.computed(el);
      assert.equal(style.maxHeight, "none", "no max-height clipping when labels grow");
      assert.equal(style.alignItems, "center");
      assert.match(style.marginTop, /^0(?:px)?$/, "no external row/control gap to break connector continuity");
      assert.match(style.marginBottom, /^0(?:px)?$/);
      assert.equal(style.overflowY, "visible", "do not clip the label stack or focus ring vertically");
    }
    assert.equal(u.computed(button).paddingLeft, "10px", "the dot sits on the connector column");
  }
}

test("roster spacing (non-layout): 50px rows, padded controls and filter/list separation", t => {
  const u = fixture(t);
  assertRoom(u);
  const filter = u.doc.querySelector(".ctx-filter");
  assert.equal(filter.parentElement.nextElementSibling.className, "ctx-list");
  assert.equal(filter.getAttribute("aria-label"), "Filter instances");
  assert.equal(filter.getAttribute("placeholder"), "Filter instances");
  assert.equal(u.computed(filter.parentElement.nextElementSibling).overflowY, "auto", "longer rosters still scroll");
});

test("roster typography (non-layout): valid control family and supplied sidebar label scale", t => {
  const u = fixture(t);
  assert.equal(u.rule(".ctx-filter").getPropertyValue("font"), "", "no invalid 'size/line-height inherit' shorthand");
  assert.equal(u.rule(".ctx-filter").fontFamily, "inherit");
  assert.equal(u.rule(".ctx-filter").fontSize, "12px");
  assert.equal(u.rule(".ctx-group").fontSize, "10.5px");
  assert.equal(u.rule(".ctx-group").fontWeight, "600");
  assert.equal(u.rule(".ctx-inst").getPropertyValue("font"), "inherit");
  assert.equal(u.rule(".ctx-name").fontSize, "12.5px");
  assert.equal(u.rule(".ctx-name").fontWeight, "600");
  assert.equal(u.rule(".ctx-repo-label").fontSize, "10.5px");
  assert.match(u.rule(".ctx-repo-label").fontFamily, /monospace/, "reference metadata is mono, like the design");
  for (const row of u.rows) {
    const name = row.querySelector(".ctx-name"), repo = row.querySelector(".ctx-repo-label");
    assert.equal(name.nextElementSibling, repo, "both labels remain in the same vertical stack");
    assert.equal(repo.textContent, row.querySelector(".ctx-inst").disabled ? "desktop-repo · state unknown" : "desktop-repo");
    assert.equal(repo.title, "Repository: desktop-repo");
    for (const label of [name, repo]) {
      assert.equal(u.computed(label).textOverflow, "ellipsis");
      assert.equal(u.computed(label).whiteSpace, "nowrap");
      assert.equal(u.computed(label).visibility, "visible");
    }
  }
});

function assertConnectors(u) {
  assert.equal(u.rule(".ctx-tree-row").position, "relative");
  assert.equal(u.rule(".ctx-guides").getPropertyValue("inset"), "0 auto 0 0", "span the entire row");
  assert.equal(u.rule(".ctx-guides").pointerEvents, "none");
  assert.equal(u.rule(".ctx-guide").position, "absolute");
  assert.equal(u.rule(".ctx-guide").left, "calc(13.25px + var(--guide-level) * var(--tree-step))",
    "every connector sits on a dot centre column (10px inset + 4px radius - half the stroke)");
  assert.equal(u.rule(".ctx-guide").borderLeft, "1.5px solid var(--tree-line)", "a visible, tokenized stroke");
  assert.equal(u.rule(".ctx-guide.line").top, "0px"); assert.equal(u.rule(".ctx-guide.line").bottom, "0px");
  assert.equal(u.rule(".ctx-guide.elbow").height, "calc(50% + 2px)", "the elbow lands on the child dot's centre");
  assert.equal(u.rule(".ctx-guide.elbow").borderBottomLeftRadius, "5px", "rounded elbows");
  assert.equal(u.rule(".ctx-guide.down").top, "50%", "a parent's line leaves from its own dot");
  assert.equal(u.rule(".ctx-guide.link-in, .ctx-guide.link-out, .ctx-guide.link-through").borderLeft,
    "1.5px dotted var(--tree-link)", "sibling links are dotted");
  assert.equal(u.rule(".ctx-dot").boxShadow, "0 0 0 2px var(--surface)", "the dot's ring hides the line under it");
}

test("tree connectors (non-layout): lines leave the dots, no disclosure arrows", t => {
  const u = fixture(t);
  assertConnectors(u);
  assert.equal(u.rule(".ctx-tree-row").getPropertyValue("--tree-step"), "18px");
  assert.equal(u.rule(".ctx-tree-row").paddingLeft, "calc(var(--depth) * var(--tree-step))");
  assert.equal(u.doc.querySelector(".ctx-disclosure"), null, "no disclosure arrows on rows");
  assert.deepEqual(u.rows.map(row => row.style.getPropertyValue("--depth")), ["0", "1", "2", "1", "2", "0"]);
  assert.deepEqual(u.rows.map(row => [...row.querySelectorAll(".ctx-guide")].map(g => `${g.className.replace("ctx-guide ", "")}@${g.style.getPropertyValue("--guide-level")}`)), [
    ["down@0"], ["elbow@0", "down@0", "down@1"], ["line@0", "elbow@1"], ["elbow@0", "down@1"], ["elbow@1"], [],
  ]);
});

test("roster DOM contract: named groups, identity, active state, hidden-but-reachable tools and closed menus", t => {
  const u = fixture(t);
  assert.deepEqual([...u.doc.querySelectorAll(".ctx-group")].map(g => [g.querySelector(".ctx-group-name").textContent, g.querySelector(".ctx-group-count").textContent]),
    [["root", "5"], ["independent", "1"]]);
  assert.equal(u.doc.querySelector(".ctx-count").textContent, "5 running · 0 stopped · 1 unknown");
  for (const row of u.rows) {
    const button = row.querySelector(".ctx-inst"), name = row.querySelector(".ctx-name").textContent;
    assert.equal(button.dataset.treeInstance, `/synthetic/${name}`);
    assert.equal(button.hasAttribute("aria-expanded"), button.dataset.rosterChildren === "1", "only parents announce expansion");
    const trigger = row.querySelector(".ctx-instance-actions"), menu = row.querySelector(".ctx-instance-menu");
    assert.equal(trigger.closest(".ctx-row-tools")?.parentElement, row, "tools overlay the row");
    assert.equal(trigger.getAttribute("aria-haspopup"), "menu");
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.equal(menu.getAttribute("popover"), "auto", "actions remain in the native closed popover");
    assert.equal(menu.getAttribute("role"), "menu");
    assert.equal(menu.parentElement, trigger.parentElement);
    assert.deepEqual([...menu.querySelectorAll("[role=menuitem]")].map(item => item.dataset.action),
      button.disabled ? ['open-split', 'open-pr', "inspect", "stop", "retire"] : ['open-split', 'open-pr', "inspect", "restart", "stop", "retire"]);
  }
  assertTools(u);
  const active = u.doc.querySelector(".ctx-inst.active");
  assert.equal(active.dataset.treeInstance, tree.instanceId(roster[1]));
  assert.equal(active.closest(".ctx-tree-row").classList.contains("active"), true, "the row paints the selection across the indent");
  active.focus(); u.render(roster);
  assert.equal(u.doc.activeElement.dataset.treeInstance, tree.instanceId(roster[1]), "poll retains logical focus");
  assert.equal(u.doc.activeElement.classList.contains("active"), true);
  assert.equal(u.rule(".ctx-inst").color, "var(--fg)");
  assert.equal(u.rule(".ctx-tree-row.active").background, "var(--sel)");
  assert.equal(u.rule(".ctx-repo-label").color, "var(--muted)");
  assert.equal(u.rule(".ctx-repo-label").background, "", "reference metadata is a plain subline, not a repository pill");
});

function assertTools(u) {
  // Hidden tools must never be semi-transparent text (WCAG: no opacity compositing).
  assert.equal(u.rule(".ctx-row-tools").visibility, "hidden", "tools hide by visibility, never opacity");
  assert.equal(u.rule(".ctx-row-tools").opacity, "");
  assert.equal(u.rule(".ctx-tree-row:is(:hover, :focus-within) > .ctx-row-tools").visibility, "visible",
    "hover or keyboard focus reveals the row tools");
}

test("sidebar metadata uses reported branch/runtime without claiming membership or installation", t => {
  const u = fixture(t);
  u.render([{ ...roster[0], branch: "feature/<literal>", runtime: "pi" }]);
  const row = u.doc.querySelector(".ctx-inst");
  assert.equal(row.querySelector(".ctx-meta").textContent, "desktop-repo · feature/<literal>");
  assert.equal(row.querySelector(".ctx-meta").title, "Repository: desktop-repo\nBranch: feature/<literal>");
  assert.equal(row.querySelector(".ctx-runtime").textContent, "π");
  assert.equal(row.querySelector(".ctx-runtime").getAttribute("aria-label"), "Harness: Pi");
  assert.equal(row.querySelector("literal"), null);
});

// Mutants exist only as in-memory stylesheets: no shared-file rollback, reload
// or browser is needed to prove the contracts reject the reported regressions.
for (const [label, before, after, check, message] of [
  ["fixed button height", "min-height: 50px; height: auto; display: flex", "min-height: 50px; height: 40px; display: flex", assertRoom, /fixed box/],
  ["cramped label gap", "align-items: flex-start; gap: 3px", "align-items: flex-start; gap: 0", assertRoom, /3px stack/],
  ["connectors off the dot column", "left: calc(13.25px + var(--guide-level)", "left: calc(8px + var(--guide-level)", assertConnectors, /dot centre column/],
  ["square elbows", "border-bottom-left-radius: 5px", "border-bottom-left-radius: 0", assertConnectors, /rounded elbows/],
  ["opacity-hidden tools", "background: var(--row-solid); visibility: hidden; }", "background: var(--row-solid); opacity: 0; }", assertTools, /never opacity/],
]) test(`roster CSS contract rejects ${label} (in-memory, non-layout)`, t => {
  assert.ok(css.includes(before), "mutate the shipped declaration");
  const u = fixture(t, css.replace(before, after));
  assert.throws(() => check(u), { code: "ERR_ASSERTION", message });
});
