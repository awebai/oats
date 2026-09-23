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
    contextInstances: roster, currentWorkspace: () => "A", workspaceGeneration: () => 0, collapsedInstances: new Set(),
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
  assert.equal(u.rule(".ctx-tree-row").minHeight, "56px", "row minimum follows the 4px rhythm");
  assert.equal(u.rule(".ctx-tree-row").height, "auto", "row can grow with font metrics");
  assert.equal(u.rule(".ctx-tree-row").getPropertyValue("padding-block"), "4px",
    "8px between adjacent controls lives inside the rows, not between guides");
  assert.equal(u.rule(".ctx-inst").minHeight, "48px", "instance button has a roomy minimum");
  assert.equal(u.rule(".ctx-inst").height, "auto", "never squeeze two labels into a fixed 40px box");
  assert.equal(u.rule(".ctx-copy").gap, "4px", "name and repository have a full spacing unit");
  assert.equal(u.computed(u.doc.querySelector(".ctx-filter-field")).marginBottom, "8px", "filter/list separation");
  for (const row of u.rows) {
    const button = row.querySelector(".ctx-inst");
    for (const el of [row, button]) {
      const style = u.computed(el);
      assert.equal(style.height, "auto");
      assert.equal(style.maxHeight, "none", "no max-height clipping when labels grow");
      assert.equal(style.alignItems, "center");
      assert.match(style.marginTop, /^0(?:px)?$/, "no external row/control gap to break guide continuity");
      assert.match(style.marginBottom, /^0(?:px)?$/);
      assert.equal(style.overflowY, "visible", "do not clip the label stack or focus ring vertically");
    }
    assert.equal(u.computed(button).paddingLeft, "8px", "content is inset from the selected background without changing tree depth");
    assert.equal(u.computed(button).paddingTop, "4px");
    assert.equal(u.computed(button).paddingBottom, "4px");
  }
}

test("sidebar metadata uses reported branch/runtime without claiming membership or installation", t => {
  const u = fixture(t);
  u.render([{ ...roster[0], branch: "feature/<literal>", runtime: "pi" }]);
  const row = u.doc.querySelector(".ctx-inst");
  assert.equal(row.querySelector(".ctx-meta").textContent, "desktop-repo · feature/<literal>");
  assert.equal(row.querySelector(".ctx-meta").title, "Repository: desktop-repo\nBranch: feature/<literal>");
  assert.equal(row.querySelector(".ctx-runtime").textContent, "π");
  assert.equal(row.querySelector(".ctx-runtime").getAttribute("aria-label"), "Reported runtime: Pi");
  assert.equal(row.querySelector("literal"), null);
});

test("roster spacing (non-layout): auto-height rows, padded controls and filter/list separation", t => {
  const u = fixture(t);
  assertRoom(u);
  const filter = u.doc.querySelector(".ctx-filter");
  assert.equal(filter.parentElement.nextElementSibling.className, "ctx-list");
  assert.equal(filter.getAttribute("aria-label"), "Filter instances");
  assert.equal(u.computed(filter.parentElement.nextElementSibling).overflowY, "auto", "longer rosters still scroll");
});

test("roster typography (non-layout): valid control family and supplied sidebar label scale", t => {
  const u = fixture(t);
  for (const [selector, size] of [[".ctx-filter", "12px"], [".ctx-disclosure", "11px"]]) {
    assert.equal(u.rule(selector).getPropertyValue("font"), "", "no invalid 'size/line-height inherit' shorthand");
    assert.equal(u.rule(selector).fontFamily, "inherit");
    assert.equal(u.rule(selector).fontSize, size);
    assert.equal(u.rule(selector).lineHeight, "1");
    assert.equal(u.computed(u.doc.querySelector(selector)).fontSize, size);
  }
  assert.equal(u.rule(".ctx-inst").getPropertyValue("font"), "inherit");
  assert.equal(u.rule(".ctx-name").fontSize, "12.5px");
  assert.equal(u.rule(".ctx-repo-label").fontSize, "10.5px");
  assert.equal(u.rule(".ctx-repo-label").lineHeight, "1.45");
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

function assertGuideAnchors(u) {
  assert.equal(u.rule(".ctx-tree-row").position, "relative");
  assert.equal(u.rule(".ctx-guides").getPropertyValue("inset"), "0 auto 0 0", "span the entire padded row");
  assert.equal(u.rule(".ctx-guides").pointerEvents, "none");
  assert.equal(u.rule(".ctx-guide").position, "absolute");
  assert.equal(u.rule(".ctx-guide").top, "0px");
  assert.equal(u.rule(".ctx-guide").bottom, "0px", "branch/ancestor segments reach the adjacent row");
  assert.equal(u.rule(".ctx-guide.end").bottom, "50%", "final sibling line stops at row center");
  const elbows = u.rule(".ctx-guide.branch::after, .ctx-guide.end::after");
  assert.equal(elbows.position, "absolute");
  assert.equal(elbows.top, "50%", "continuing branch elbow tracks full-row midpoint, not 23px");
  assert.equal(u.rule(".ctx-guide.end::after").top, "100%",
    "end elbow uses the endpoint of its HALF-height guide, not the quarter-row midpoint");
  assert.equal(elbows.width, "4px", "compact elbow does not consume a full text column");
  assert.equal(elbows.height, "1px");
  assert.equal(elbows.background, "var(--border)");
}

test("tree guides (non-layout): full-span continuations and half-span end elbows remain row-centered", t => {
  const u = fixture(t);
  assertGuideAnchors(u);
  assert.equal(u.rule(".ctx-tree-row").getPropertyValue("--tree-step"), "8px");
  assert.equal(u.rule(".ctx-tree-row").paddingLeft, "calc(var(--depth) * var(--tree-step))");
  assert.equal(u.rule(".ctx-guide").left, "calc(8px + var(--guide-level) * var(--tree-step))", "guides use the same compact pitch as rows");
  assert.equal(u.rule(".ctx-list").padding, "0px 6px 8px");
  // Compared with the previous 8px list padding + 3px base + 14px depth:
  // reclaim 7px at the root, 13px at depth1, 19px at depth2, without shrinking
  // the 18px disclosure slot, 56px rows or 8px selected-content inset.
  assert.equal(u.rule(".ctx-disclosure").width, "18px");
  for (const depth of [0, 1, 2, 4]) {
    const oldGutter = 2 * 8 + 3 + depth * 14;
    const compactGutter = 2 * 6 + depth * Number.parseFloat(u.rule(".ctx-tree-row").getPropertyValue("--tree-step"));
    assert.equal(oldGutter - compactGutter, 7 + depth * 6);
  }
  assert.deepEqual(u.rows.map(row => row.style.getPropertyValue("--depth")), ["0", "1", "2", "1", "2", "0"]);
  assert.deepEqual(u.rows.map(row => [...row.querySelectorAll(".ctx-guide")].map(g => g.className)), [
    [], ["ctx-guide branch"], ["ctx-guide continue", "ctx-guide end"],
    ["ctx-guide end"], ["ctx-guide end"], [],
  ]);
  assert.deepEqual([...u.rows[2].querySelectorAll(".ctx-guide")].map(g => g.style.getPropertyValue("--guide-level")), ["0", "1"]);
  assert.equal(u.rows[4].querySelector(".ctx-guide").style.getPropertyValue("--guide-level"), "1", "exhausted ancestor draws no continuation");
});

test("roster DOM contract: identity, active/focus state and closed action menus survive roomier rows", t => {
  const u = fixture(t);
  for (const row of u.rows) {
    const button = row.querySelector(".ctx-inst"), name = row.querySelector(".ctx-name").textContent;
    assert.equal(button.dataset.treeInstance, `/synthetic/${name}`);
    const trigger = row.querySelector(".ctx-instance-actions"), menu = row.querySelector(".ctx-instance-menu");
    assert.equal(trigger.getAttribute("aria-haspopup"), "menu");
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.equal(menu.getAttribute("popover"), "auto", "actions remain in the native closed popover");
    assert.equal(menu.getAttribute("role"), "menu");
    assert.equal(menu.parentElement, trigger.parentElement);
    assert.deepEqual([...menu.querySelectorAll("[role=menuitem]")].map(item => item.dataset.action),
      button.disabled ? ['open-split', 'open-pr', "inspect", "stop", "retire"] : ['open-split', 'open-pr', "inspect", "restart", "stop", "retire"]);
  }
  const active = u.doc.querySelector(".ctx-inst.active");
  assert.equal(active.dataset.treeInstance, tree.instanceId(roster[1]));
  active.focus(); u.render(roster);
  assert.equal(u.doc.activeElement.dataset.treeInstance, tree.instanceId(roster[1]), "poll retains logical focus");
  assert.equal(u.doc.activeElement.classList.contains("active"), true);
  assert.equal(u.rule(".ctx-inst").color, "var(--fg)");
  assert.equal(u.rule(".ctx-inst.active").background, "var(--sel)");
  assert.equal(u.rule(".ctx-repo-label").color, "var(--muted)");
  assert.equal(u.rule(".ctx-repo-label").background, "", "reference metadata is a plain subline, not a repository pill");
});

// Mutants exist only as in-memory stylesheets: no shared-file rollback, reload
// or browser is needed to prove the contracts reject the reported regressions.
for (const [label, before, after, check, message] of [
  ["fixed button height", "min-height: 48px; height: auto", "min-height: 48px; height: 40px", assertRoom, /fixed 40px box/],
  ["cramped label gap", "align-items: flex-start; gap: 4px", "align-items: flex-start; gap: 3px", assertRoom, /full spacing unit/],
  ["old elbow offset", "left: 0; top: 50%; width: 4px", "left: 0; top: 23px; width: 4px", assertGuideAnchors, /not 23px/],
  ["quarter-row end elbow", ".ctx-guide.end::after { top: 100%; }", ".ctx-guide.end::after { top: 50%; }", assertGuideAnchors, /HALF-height guide/],
]) test(`roster CSS contract rejects ${label} (in-memory, non-layout)`, t => {
  assert.ok(css.includes(before), "mutate the shipped declaration");
  const u = fixture(t, css.replace(before, after));
  assert.throws(() => check(u), { code: "ERR_ASSERTION", message });
});
