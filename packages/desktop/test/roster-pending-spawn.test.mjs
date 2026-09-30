// Spec C: a background spawn's pending row in the sidebar roster. Executes the shipped roster
// render (shell.mjs renderContextRoster + pendingSpawnRow + announceSpawn) against a stub store;
// no shell startup, HTTP, Electron, CLI or session.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { JSDOM } from "jsdom";
import * as tree from "../renderer/instance-tree.mjs";
import { instanceActions, captureInstanceActionMenu } from "../renderer/instance-actions.mjs";
import { instanceActionTarget, sameInstanceActionTarget } from "../renderer/instance-action-target.mjs";
import { instanceSplitPlan } from "../renderer/instance-split.mjs";
import { runtimeState, unsupportedSession } from "../renderer/instance-presentation.mjs";
import { canAddressRemote, rowReason } from "../renderer/remote-address.mjs";
import { createRuntimeBadge } from "../renderer/identity-marks.mjs";

const read = name => readFileSync(new URL(`../renderer/${name}`, import.meta.url), "utf8");
const css = read("shell.css"), html = read("index.html"), shell = read("shell.mjs");
const fn = name => shell.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0];
const source = ["renderContextRoster", "pendingSpawnRow", "announceSpawn"].map(name => { const s = fn(name); assert.ok(s, name); return s; }).join("\n");
const instance = (name, parentInstance, extra = {}) => ({ instance: name, parentInstance, agent: "dev",
  home: `/synthetic/${name}`, agentsRoot: "/synthetic/agents", repoName: "desktop-repo", running: true, ...extra });
const roster = [instance("root"), instance("child-a", "root"), instance("solo")];
const pending = (extra = {}) => ({ id: "spawn-1", instance: "dev-new", home: "/synthetic/dev-new", agent: "dev", agentsRoot: "/synthetic/agents",
  parentInstance: "root", pending: "spawning", ...extra });

function fixture(t, rows) {
  const dom = new JSDOM(html, { pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const announced = new Set(), checked = [];
  const context = {
    ...tree, document: doc, instanceActions, captureInstanceActionMenu, runtimeState, unsupportedSession, canAddressRemote, rowReason, createRuntimeBadge,
    instanceActionTarget, instanceSplitPlan, connectionGeneration: 0, menuState() {}, runAction: assert.fail,
    applyChordTitles() {}, updateActiveContexts() {}, getBinding: () => null, formatChord: c => c, isMac: true,
    contextRosterEl: doc.querySelector("#instance-roster"), contextFilter: "", contextWorkspace: "A",
    rosterState: { hasData: true, state: "ready" }, rosterStale: false, contextDeploymentNote: null,
    currentWorkspace: () => "A", workspaceGeneration: () => 0, collapsedInstances: new Set(),
    rosterTip: { bind() {}, hide() {}, sync() {} }, rosterTipFacts: () => ({}), rosterPrs: { get: () => null, refresh() {} },
    spawnJobs: { rows: ws => ws === "A" ? rows() : [], announce: id => !announced.has(id) && !!announced.add(id), check: id => checked.push(id) },
    tabs: new Map(), activeTab: null, tabOpenIntents: { applyFocus: f => f() },
    // A pending row opens nothing: any navigation is a test failure.
    openTerminalTab: assert.fail, openInstanceStart: assert.fail, openLifecycleDialog: assert.fail, onRosterRowKey() {},
    api: assert.fail, showStage: assert.fail, refreshContextRoster: assert.fail,
  };
  context.splitOpenState = () => ({ split: null, activeId: null, tabs: context.tabs, workspace: "A", visible: false });
  context.ownsInstanceTarget = target => roster.filter(row => sameInstanceActionTarget(target, row, "A")).length === 1;
  const render = runInNewContext(`${source}\nrenderContextRoster`, context);
  const list = doc.querySelector(".ctx-list");
  const row = name => [...list.querySelectorAll(".ctx-inst")].find(b => b.querySelector(".ctx-name")?.textContent === name);
  return { doc, render, list, row, checked, live: () => doc.querySelector("#instance-roster > .ctx-spawn-live") };
}

test("a pending spawn shows under its parent: “Spawning…” text and a spinner, opens nothing, no actions; the count stays the kernel’s", async t => {
  const u = fixture(t, () => [pending()]);
  u.render(roster);
  const button = u.row("dev-new");
  assert.ok(button, "the pending row is painted");
  const names = [...u.list.querySelectorAll(".ctx-name")].map(n => n.textContent);
  assert.ok(names.indexOf("dev-new") > names.indexOf("root") && names.indexOf("dev-new") < names.indexOf("solo"), "in its parent's group");
  assert.equal(button.closest(".ctx-tree-row").style.getPropertyValue("--depth"), "1", "one level under root");
  assert.equal(button.querySelector(".ctx-spawn-state").textContent, "Spawning…");
  assert.equal(button.querySelector(".ctx-spawn-spinner").getAttribute("aria-hidden"), "true", "the text carries the state; the spinner is decoration");
  assert.equal(button.getAttribute("aria-disabled"), "true"); assert.match(button.getAttribute("aria-description"), /being spawned/);
  assert.equal(button.dataset.treeInstance, "/synthetic/dev-new", "the real row's identity");
  button.click(); // openTerminalTab / openInstanceStart would fail the test
  assert.equal(button.closest(".ctx-tree-row").querySelector(".ctx-instance-actions"), null, "no live-instance actions");
  assert.match(u.doc.querySelector(".ctx-count").textContent, /^3 running$/, "the pending row is not counted");
});

test("announced once through a polite live region", async t => {
  const u = fixture(t, () => [pending()]);
  u.render(roster);
  assert.equal(u.live().getAttribute("aria-live"), "polite"); assert.equal(u.live().textContent, "Spawning dev-new…");
  u.live().textContent = "";
  u.render(roster); u.render(roster);
  assert.equal(u.live().textContent, "", "a repaint never announces it again");
});

test("the real row replaces the pending one in place and keeps its focus", async t => {
  let rows = [pending()];
  const u = fixture(t, () => rows);
  u.render(roster);
  u.row("dev-new").focus();
  const real = [...roster, instance("dev-new", "root")];
  u.render(real); // the store still lists it until observe(); a reported row wins
  assert.equal(u.list.querySelectorAll(".ctx-inst").length, 4, "never both");
  const replaced = u.row("dev-new");
  assert.equal(replaced.classList.contains("pending"), false);
  assert.equal(u.doc.activeElement, replaced, "focus kept across the replacement");
  rows = [];
  u.render(real);
  assert.equal(u.doc.activeElement, u.row("dev-new"));
});

test("an unknown outcome reads “Outcome unknown” with a visible Check result named for the instance", async t => {
  let rows = [pending({ pending: "unknown" })];
  const u = fixture(t, () => rows);
  u.render(roster);
  const button = u.row("dev-new");
  assert.equal(button.querySelector(".ctx-spawn-state").textContent, "Outcome unknown");
  assert.equal(button.querySelector(".ctx-spawn-spinner"), null, "no spinner: nothing is known to be moving");
  const check = button.closest(".ctx-tree-row").querySelector(".ctx-spawn-check");
  assert.equal(check.getAttribute("aria-label"), "Check result for dev-new"); assert.equal(check.textContent, "Check result");
  assert.ok(check.closest(".ctx-spawn-tools"), "its tools are always visible");
  check.focus(); check.click(); assert.deepEqual(u.checked, ["spawn-1"]);
  rows = [pending({ pending: "checking" })];
  u.render(roster);
  const again = u.list.querySelector(".ctx-spawn-check");
  assert.equal(again.getAttribute("aria-disabled"), "true"); assert.equal(u.doc.activeElement, again, "focus stays on it while checking");
  again.click(); assert.deepEqual(u.checked, ["spawn-1"], "one check at a time");
  assert.equal(u.row("dev-new").querySelector(".ctx-spawn-state").textContent, "Checking result…");
});

test("another workspace's pending rows are not painted", async t => {
  const u = fixture(t, () => [pending()]);
  u.render(roster);
  assert.ok(u.row("dev-new"));
  const other = fixture(t, () => []);
  other.render(roster);
  assert.equal(other.row("dev-new"), undefined);
});

test("CSS: the spinner turns only without reduced motion, and the Check result tools stay visible", () => {
  assert.match(css, /\.ctx-spawn-spinner \{[^}]*animation: oats-spin/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.ctx-spawn-spinner \{ animation: none; \} \}/);
  assert.match(css, /\.ctx-tree-row > \.ctx-spawn-tools \{ visibility: visible; \}/);
});
