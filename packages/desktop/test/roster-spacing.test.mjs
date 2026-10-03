// Non-layout CSS/DOM contracts: jsdom does not measure font boxes, paint tree
// guides or capture screenshots. Execute only the shipped roster render function;
// no shell startup, HTTP, Electron, IPC, CLI or real terminal/session operations.
import test from "node:test";
import { viewContext } from "./helpers/view-context.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { JSDOM } from "jsdom";
import * as tree from "../renderer/instance-tree.mjs";
import { instanceActions, captureInstanceActionMenu } from "../renderer/instance-actions.mjs";
import { instanceActionTarget, sameInstanceActionTarget } from '../renderer/instance-action-target.mjs';
import { instanceSplitPlan } from '../renderer/instance-split.mjs';
import { runtimeState, unsupportedSession } from "../renderer/instance-presentation.mjs";
import { canAddressRemote, rowReason } from "../renderer/remote-address.mjs";
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
    ...tree, document: doc, instanceActions, captureInstanceActionMenu, runtimeState, unsupportedSession, canAddressRemote, rowReason, createRuntimeBadge,
    instanceActionTarget, instanceSplitPlan, connectionGeneration: 0, menuState() {}, runAction: assert.fail,
    applyChordTitles() {}, updateActiveContexts() {}, getBinding: () => null, formatChord: c => c, isMac: true,
    contextRosterEl: doc.querySelector("#instance-roster"), contextFilter: "", contextWorkspace: "A",
    rosterState: { hasData: true, state: "ready" }, rosterStale: false, contextDeploymentNote: null, ...viewContext(), // loading state: a read succeeded
    contextInstances: roster, currentWorkspace: () => "A", workspaceGeneration: () => 0, collapsedInstances: new Set(), rosterTip: { bind() {}, hide() {}, sync() {} }, rosterTipFacts: () => ({}), rosterPrs: { get: () => null, refresh() {} }, spawnJobs: { rows: () => [], announce: () => false, observe() {}, settling: () => false, check() {} },
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
  // Human, 2026-09-29: a 48px row box whose background fills 44px inside 2px transparent borders,
  // so neighbouring backgrounds keep a 4px gap and never touch.
  assert.equal(u.rule(".ctx-tree-row").minHeight, "48px", "a 48px row box");
  assert.equal(u.rule(".ctx-tree-row").borderTop, "var(--row-gap) solid transparent");
  assert.equal(u.rule(".ctx-tree-row").borderBottom, "var(--row-gap) solid transparent");
  assert.equal(u.rule(".ctx-tree-row").getPropertyValue("--row-gap"), "2px");
  assert.equal(u.rule(".ctx-tree-row").backgroundClip, "padding-box", "the background stops short of the gap");
  assert.equal(u.rule(".ctx-inst").minHeight, "44px", "the whole painted row is one click target");
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

test("roster spacing (non-layout): 48px rows with a 4px gap, padded controls and filter/list separation", t => {
  const u = fixture(t);
  assertRoom(u);
  const filter = u.doc.querySelector(".ctx-filter");
  assert.equal(filter.parentElement.nextElementSibling.className, "ctx-list");
  assert.equal(filter.getAttribute("aria-label"), "Filter instances");
  assert.equal(filter.getAttribute("placeholder"), "Filter instances");
  assert.equal(u.computed(filter.parentElement.nextElementSibling).overflowY, "auto", "longer rosters still scroll");
});

test("roster spacing (non-layout): a selected or hovered row keeps its 4px gap (human, 2026-10-03)", t => {
  // The background shorthand resets background-clip to border-box, painting the transparent borders,
  // so a selected row and a hovered neighbour touched. State rules may set only the colour.
  const u = fixture(t);
  const active = u.rows.filter(row => row.classList.contains("active"));
  assert.equal(active.length, 1, "the fixture renders one selected row");
  assert.equal(u.computed(active[0]).backgroundClip, "padding-box", "the selected fill stops short of the gap");
  for (const selector of [".ctx-tree-row:hover", ".ctx-tree-row.active", ".ctx-tree-row.ctx-spawn-revealed"]) {
    assert.ok(u.rule(selector).backgroundColor, `${selector} paints a fill`);
    assert.equal(u.rule(selector).background, "", `${selector} sets no background shorthand`);
    assert.equal(u.rule(selector).backgroundClip, "", `${selector} leaves the row's padding-box clip alone`);
  }
});

test("roster typography (non-layout): valid control family and supplied sidebar label scale", t => {
  const u = fixture(t);
  assert.equal(u.rule(".ctx-filter").getPropertyValue("font"), "", "no invalid 'size/line-height inherit' shorthand");
  assert.equal(u.rule(".ctx-filter").fontFamily, "inherit");
  assert.equal(u.rule(".ctx-filter").fontSize, "12px");
  assert.equal(u.rule(".ctx-group").height, "14px", "Workspace v4: groups read from a 14px gap, no title");
  assert.equal(u.rule(".ctx-group:first-child").height, "7px", "the first row sits closer to the filter (human, 2026-09-29)");
  assert.equal(u.rule(".ctx-inst").getPropertyValue("font"), "inherit");
  assert.equal(u.rule(".ctx-name").fontSize, "12.5px");
  assert.equal(u.rule(".ctx-name").fontWeight, "600");
  assert.equal(u.rule(".ctx-repo-label").fontSize, "11.5px", "Inconsolata is narrow: a step up from 10.5 (the operator, 2026-10-02)");
  assert.equal(u.rule(".ctx-repo-label").fontFamily, "var(--mono)", "reference metadata is mono, like the design (the shared token: Inconsolata first)");
  for (const row of u.rows) {
    const name = row.querySelector(".ctx-name"), repo = row.querySelector(".ctx-repo-label");
    assert.equal(name.nextElementSibling, repo, "both labels remain in the same vertical stack");
    assert.equal(repo.textContent, row.querySelector(".ctx-inst").getAttribute("aria-disabled") === "true" ? "desktop-repo · state unknown" : "desktop-repo");
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
  assert.equal(u.rule(".ctx-guides").getPropertyValue("inset"), "calc(-1 * var(--row-gap)) auto calc(-1 * var(--row-gap)) 0",
    "span the entire row, including the transparent gap borders, so lines stay continuous");
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
  assert.equal(u.rule(".ctx-dot").boxShadow, "0 0 0 2px var(--row-solid, var(--surface))",
    "the dot's ring hides the line under it, in the row's own solid colour");
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

test("roster DOM contract: named group separators, identity, active state, hidden-but-reachable tools and closed menus", t => {
  const u = fixture(t);
  assert.deepEqual([...u.doc.querySelectorAll(".ctx-group")].map(g => [g.getAttribute("role"), g.getAttribute("aria-label"), g.textContent]),
    [["separator", "root, 5 instances", ""], ["separator", "independent, 1 instance", ""]]);
  // The head shows only the running count (human, 2026-09-26); the full breakdown is its title.
  assert.equal(u.doc.querySelector(".ctx-count").textContent, "5 running");
  assert.equal(u.doc.querySelector(".ctx-count").title, "5 running · 0 stopped · 1 unknown");
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
      button.getAttribute('aria-disabled') === 'true' ? ['open-split', 'open-pr', "inspect", "stop", "retire"] : ['open-split', 'open-pr', "inspect", "restart", "stop", "retire"]);
  }
  assertTools(u);
  const active = u.doc.querySelector(".ctx-inst.active");
  assert.equal(active.dataset.treeInstance, tree.instanceId(roster[1]));
  assert.equal(active.closest(".ctx-tree-row").classList.contains("active"), true, "the row paints the selection across the indent");
  active.focus(); u.render(roster);
  assert.equal(u.doc.activeElement.dataset.treeInstance, tree.instanceId(roster[1]), "poll retains logical focus");
  assert.equal(u.doc.activeElement.classList.contains("active"), true);
  assert.equal(u.rule(".ctx-inst").color, "var(--fg)");
  assert.equal(u.rule(".ctx-tree-row.active").backgroundColor, "var(--sel)");
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

test("sidebar metadata uses reported branch/harness without claiming membership or installation", t => {
  const u = fixture(t);
  u.render([{ ...roster[0], branch: "feature/<literal>", harness: "pi" }]);
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
  ["fixed button height", "min-height: 44px; height: auto; display: flex", "min-height: 44px; height: 40px; display: flex", assertRoom, /fixed box/],
  ["cramped label gap", "align-items: flex-start; gap: 3px", "align-items: flex-start; gap: 0", assertRoom, /3px stack/],
  ["connectors off the dot column", "left: calc(13.25px + var(--guide-level)", "left: calc(8px + var(--guide-level)", assertConnectors, /dot centre column/],
  ["square elbows", "border-bottom-left-radius: 5px", "border-bottom-left-radius: 0", assertConnectors, /rounded elbows/],
  ["opacity-hidden tools", "background: var(--row-solid); visibility: hidden; }", "background: var(--row-solid); opacity: 0; }", assertTools, /never opacity/],
]) test(`roster CSS contract rejects ${label} (in-memory, non-layout)`, t => {
  assert.ok(css.includes(before), "mutate the shipped declaration");
  const u = fixture(t, css.replace(before, after));
  assert.throws(() => check(u), { code: "ERR_ASSERTION", message });
});

// Human, 2026-09-29: a running dot stays solid on a selected or hovered row. Its knockout ring takes the
// row's own solid colour, so on the tint it never reads as a hollow dot inside a white halo.
test("running dot stays solid --accent on selected and hovered rows; its ring is the row's colour", t => {
  const u = fixture(t);
  const active = u.doc.querySelector(".ctx-tree-row.active");
  assert.ok(active, "the fixture has a selected row");
  const dot = active.querySelector(".ctx-dot");
  assert.equal(dot.className, "ctx-dot on", "the selected fixture row is running");
  const style = u.computed(dot);
  assert.equal(style.background, "var(--accent)", "solid fill");
  assert.equal(u.rule(".ctx-dot.on").borderColor, "var(--accent)", "jsdom keeps var() only in the shorthand, so the border is read from the rule");
  assert.equal(style.boxShadow, "0 0 0 2px var(--row-solid, var(--surface))", "the ring follows the row's solid colour");
  assert.equal(u.rule(".ctx-tree-row.active").getPropertyValue("--row-solid"), "var(--sel)", "the ring on a selected row is the tint");
  assert.equal(u.rule(".ctx-tree-row:hover").getPropertyValue("--row-solid"), "var(--surface-2)", "and on hover the hover surface");
  assert.equal(u.computed(active).getPropertyValue("--row-solid").trim(), "var(--sel)", "the selected row resolves its own solid colour");
  assert.equal(u.rule(".ctx-dot").background, "var(--surface)", "only a stopped dot is hollow");
  assert.equal(u.rule(".ctx-dot.on").background, "var(--accent)");
});

// Spec F audit: an instance whose state is unknown can't open, but its row takes focus
// (aria-disabled, never disabled) so its tools — the actions menu — stay keyboard-reachable,
// and the roster's one tab stop is the selected row (its terminal is the active tab).
test("keyboard: an unavailable row stays focusable with its tools; the tab stop is the selected row", t => {
  const u = fixture(t);
  const row = u.rows.at(-1), button = row.querySelector(".ctx-inst");
  assert.equal(button.disabled, false, "never disabled: a disabled button can't take focus");
  assert.equal(button.getAttribute("aria-disabled"), "true");
  assert.equal(button.getAttribute("aria-description"), "unknown: status unknown");
  button.focus(); assert.equal(u.doc.activeElement, button);
  button.click(); // the fixture fails on any open/start: an unavailable row's activation does nothing
  const trigger = row.querySelector(".ctx-instance-actions");
  assert.equal(trigger.disabled, false, "its actions menu is a Tab stop after the row");
  const stops = [...u.doc.querySelectorAll(".ctx-inst")].filter(b => b.tabIndex === 0);
  assert.deepEqual(stops.map(b => b.dataset.treeInstance), [tree.instanceId(roster[1])], "one tab stop: the selected row");
});

test('a row that cannot open says why on its meta line (text, not colour), with the full sentence as its title and aria-description', t => {
  const u = fixture(t);
  const remote = (name, extra) => ({ ...instance(name), home: `/srv/agents/dev/instances/${name}`, agentsRoot: '/srv/agents', server: 'build',
    repoName: 'Build box', addressable: true, missingRemotely: false, ...extra });
  const rows = [
    [{ ...instance('herdr'), running: null, runtimeState: 'unsupported', runtimeError: 'E_HERDR_REMOVED: Herdr is no longer supported.' },
      'Herdr no longer supported', 'E_HERDR_REMOVED: Herdr is no longer supported.'],
    [remote('gone', { addressable: false, missingRemotely: true, running: null }), 'gone from Build box',
      'gone is no longer on Build box. Remove it from this computer with: oats server forget build --instance gone'],
    [remote('hidden', { addressable: false }), 'not reachable on Build box', 'Build box did not report this instance as reachable.'],
    [remote('far', { running: null, serverUnreached: true, runtimeError: 'ssh failed: Connection refused' }), 'Build box not reached', 'ssh failed: Connection refused'],
    [{ ...instance('unsure'), running: null }, 'state unknown', 'unsure: status unknown'],
  ];
  u.render(rows.map(([row]) => row));
  for (const [row, label, sentence] of rows) {
    const button = [...u.doc.querySelectorAll('.ctx-inst')].find(b => b.querySelector('.ctx-name').textContent === row.instance);
    assert.ok(button, row.instance);
    const meta = button.querySelector('.ctx-meta').textContent;
    assert.ok(meta.endsWith(` · ${label}`), `${row.instance}: meta "${meta}" shows "${label}"`);
    assert.equal(button.getAttribute('aria-disabled'), 'true');
    assert.equal(button.title, sentence); assert.equal(button.getAttribute('aria-description'), sentence);
  }
  // An addressable foreign row (no saved route here) opens like any other: no reason, no disabled state.
  u.render([remote('foreign', { savedRoute: false })]);
  const foreign = u.doc.querySelector('.ctx-inst');
  assert.equal(foreign.getAttribute('aria-disabled'), null);
  assert.equal(foreign.querySelector('.ctx-meta').textContent, 'Build box');
});

test('a row\'s tools stay visible while its actions menu is open: the menu (a top-layer popover inside them) stays clickable once the pointer leaves the row', t => {
  // In the top layer the row is neither :hover nor :focus-within while the pointer is in the menu. Without this rule the
  // tools (and the menu, which inherits their visibility) go hidden: the item is not hit and its action refuses to run.
  const u = fixture(t);
  assert.equal(u.rule('.ctx-tree-row > .ctx-row-tools:has(.ctx-instance-menu:popover-open)').visibility, 'visible');
});
