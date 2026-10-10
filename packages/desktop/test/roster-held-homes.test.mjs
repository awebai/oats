// #802: homes the kernel holds. A spawn running its worktree hooks (`spawnInProgress: true`) reads
// "Setting up worktree…" in the pending row's treatment; a home a spawn or a retire left half cleaned
// (`rollbackIncomplete`, `retirePending`) reads so and offers Retire only. Projections (deployment-data,
// /api/panel), the shipped roster render (shell.mjs renderContextRoster + pendingSpawnRow) against a stub
// store, the hover card and the actions menu; no shell startup, HTTP, Electron, CLI or session.
import test from "node:test";
import { viewContext } from "./helpers/view-context.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { runInNewContext } from "node:vm";
import { JSDOM } from "jsdom";
import * as tree from "../renderer/instance-tree.mjs";
import { instanceActions, captureInstanceActionMenu } from "../renderer/instance-actions.mjs";
import { instanceActionTarget, sameInstanceActionTarget } from "../renderer/instance-action-target.mjs";
import { instanceSplitPlan } from "../renderer/instance-split.mjs";
import { runtimeState, unsupportedSession } from "../../client/instance-presentation.mjs";
import { canAddressRemote, rowReason } from "../../client/remote-address.mjs";
import { createRuntimeBadge } from "../renderer/identity-marks.mjs";
import { rosterTipFacts } from "../renderer/roster-tip.mjs";
import { waitingClock } from "../../client/waiting-on-you.mjs";
import { projectActivePanel } from "../renderer/active-observation.mjs";
import { deploymentStatusData } from "../../client/deployment-data.mjs";

const read = name => readFileSync(new URL(`../renderer/${name}`, import.meta.url), "utf8");
const css = read("shell.css"), html = read("index.html"), shell = read("shell.mjs");
const fn = name => shell.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0];
const source = ["renderContextRoster", "pendingSpawnRow", "announceSpawn"].map(name => { const s = fn(name); assert.ok(s, name); return s; }).join("\n");
const instance = (name, parentInstance, extra = {}) => ({ instance: name, parentInstance, agent: "dev",
  home: `/synthetic/${name}`, agentsRoot: "/synthetic/agents", repoName: "desktop-repo", running: true, ...extra });
const roster = [instance("root"), instance("solo")];
const job = (extra = {}) => ({ id: "spawn-1", instance: "dev-new", home: "/synthetic/dev-new", agent: "dev", agentsRoot: "/synthetic/agents",
  parentInstance: "root", pending: "spawning", ...extra });
// A fixed local start, so the "since" line is the shared clock's words for it.
const STARTED = new Date(2026, 9, 8, 14, 3).getTime();

function fixture(t, rows, extra = {}) {
  const dom = new JSDOM(html, { pretendToBeVisual: true });
  t.after(() => dom.window.close());
  // jsdom has no top-layer API: model only the popover's open/close events (as instance-actions.test.mjs does).
  for (const [method, newState] of [["showPopover", "open"], ["hidePopover", "closed"]]) {
    dom.window.HTMLElement.prototype[method] = function () {
      const event = new dom.window.Event("beforetoggle");
      Object.defineProperty(event, "newState", { value: newState });
      this.dispatchEvent(event);
    };
  }
  const doc = dom.window.document;
  const announced = new Set(), lifecycle = [], opened = [], tips = new Map();
  let painted = [];
  const context = {
    ...tree, document: doc, instanceActions, captureInstanceActionMenu, runtimeState, unsupportedSession, canAddressRemote, rowReason, createRuntimeBadge,
    instanceActionTarget, instanceSplitPlan, connectionGeneration: 0, menuState() {}, runAction: assert.fail,
    applyChordTitles() {}, updateActiveContexts() {}, getBinding: () => null, formatChord: c => c, isMac: true,
    contextRosterEl: doc.querySelector("#instance-roster"), contextFilter: "", contextWorkspace: "A",
    rosterState: { hasData: true, state: "ready" }, rosterStale: false, contextDeploymentNote: null, ...viewContext(),
    currentWorkspace: () => "A", workspaceGeneration: () => 0, collapsedInstances: new Set(),
    rosterTip: { bind(row, facts) { tips.set(row.dataset.treeInstance, facts); }, hide() {}, sync() {} }, rosterTipFacts,
    rosterPrs: { get: () => null, refresh() {} },
    spawnJobs: { rows: ws => ws === "A" ? rows() : [], announce: id => !announced.has(id) && !!announced.add(id), check() {} },
    tabs: new Map(), activeTab: null, tabOpenIntents: { applyFocus: f => f() },
    // A held row opens and starts nothing (recorded: a throw inside a jsdom listener would not fail the test).
    // Retire goes to the plan dialog.
    openTerminalTab: row => opened.push(["terminal", row.instance]), openInstanceStart: row => opened.push(["start", row.instance]),
    openLifecycleDialog: (...args) => lifecycle.push(args), onRosterRowKey() {},
    api: assert.fail, showStage: assert.fail, refreshContextRoster: assert.fail,
    ...(extra.context || {}),
  };
  context.splitOpenState = () => ({ split: null, activeId: null, tabs: context.tabs, workspace: "A", visible: false });
  context.ownsInstanceTarget = target => painted.filter(row => sameInstanceActionTarget(target, row, "A")).length === 1;
  const paint = runInNewContext(`${source}\nrenderContextRoster`, context);
  const render = instances => { painted = instances; paint(instances); };
  const list = doc.querySelector(".ctx-list");
  const row = name => [...list.querySelectorAll(".ctx-inst")].find(b => b.querySelector(".ctx-name")?.textContent === name);
  const wrap = name => row(name).closest(".ctx-tree-row");
  const status = name => tips.get(row(name).dataset.treeInstance)?.().rows.find(([key]) => key === "Status")?.[1];
  const menu = name => [...wrap(name).querySelectorAll("[role=menuitem]")].map(item => item.dataset.action);
  return { doc, render, list, row, wrap, status, menu, lifecycle, opened, live: () => doc.querySelector("#instance-roster > .ctx-spawn-live") };
}

// No Start…, no PR link, no actions menu, no Check result: nothing to act on.
const noTools = (u, name) => assert.equal(u.wrap(name).querySelector(".ctx-row-tools"), null, `${name}: no tools`);

test("projection: spawnInProgress is kept as boolean true only; anything else is dropped without failing the roster", () => {
  const doc = value => ({ root: "/d/agents", agents: [{ name: "dev", dir: "/d/agents/dev",
    instances: [{ instance: "dev-a", home: "/d/agents/dev/instances/dev-a", ...(value === undefined ? {} : { spawnInProgress: value }) }] }] });
  const row = value => deploymentStatusData(doc(value), "/d").agents[0].instances[0];
  assert.equal(row(true).spawnInProgress, true);
  for (const value of [false, "yes", 1, {}, null, [true], undefined]) assert.equal(Object.hasOwn(row(value), "spawnInProgress"), false, JSON.stringify(value));
});

test("projection: /api/panel forwards spawnInProgress (true only), beside the quarantine flags", () => {
  const src = readFileSync(new URL("../server/oats-web.mjs", import.meta.url), "utf8");
  const m = src.match(/\/\* OATSWEB_PANELPROJ_BEGIN[^*]*\*\/([\s\S]*?)\/\* OATSWEB_PANELPROJ_END \*\//);
  const project = new Function("dirname", m[1] + "\nreturn projectPanelInstance;")(dirname);
  const base = { instance: "dev-a", agentsRoot: "/d/agents", home: "/d/agents/dev/instances/dev-a" };
  assert.equal(project({ ...base, spawnInProgress: true }).spawnInProgress, true);
  for (const value of [undefined, false, "yes", 1]) assert.equal(Object.hasOwn(project({ ...base, spawnInProgress: value }), "spawnInProgress"), false, String(value));
  assert.deepEqual([project({ ...base, rollbackIncomplete: true }).rollbackIncomplete, project({ ...base, retirePending: true }).retirePending], [true, true]);
  // The canvas's own projection keeps them too (true only), so its actions are gated on them.
  const active = projectActivePanel({ instances: [{ ...base, spawnInProgress: true, rollbackIncomplete: "yes" }] }).instances[0];
  assert.deepEqual([active.spawnInProgress, Object.hasOwn(active, "rollbackIncomplete")], [true, false]);
});

test("heldHome: rollbackIncomplete wins over spawnInProgress, a live spawn over retirePending; spawnInProgress counts only as true", () => {
  const kind = row => tree.heldHome(row)?.kind ?? null;
  assert.equal(kind({ spawnInProgress: true }), "spawning");
  assert.equal(kind({ spawnInProgress: "true" }), null);
  assert.equal(kind({ rollbackIncomplete: true }), "spawn-incomplete");
  assert.equal(kind({ retirePending: true }), "retire-incomplete");
  assert.equal(kind({ spawnInProgress: true, rollbackIncomplete: true }), "spawn-incomplete");
  assert.equal(kind({ spawnInProgress: true, retirePending: true }), "spawning");
  assert.equal(kind({ rollbackIncomplete: false, retirePending: false }), null, "a remote row's false flags hold nothing");
  assert.equal(kind(null), null);
});

test("a row the roster reports setting up its worktree (a spawn made anywhere): the pending treatment, no actions, opens nothing", async t => {
  const u = fixture(t, () => []);
  u.render([...roster, instance("dev-new", "root", { running: false, spawnInProgress: true })]);
  const button = u.row("dev-new");
  assert.equal(button.querySelector(".ctx-spawn-state").textContent, "Setting up worktree…");
  assert.equal(button.querySelector(".ctx-spawn-spinner").getAttribute("aria-hidden"), "true", "the text carries the state; the spinner is decoration");
  assert.equal(button.classList.contains("pending"), true);
  assert.equal(button.getAttribute("aria-disabled"), "true"); assert.match(button.getAttribute("aria-description"), /is setting up its worktree/);
  assert.equal(button.dataset.treeInstance, "/synthetic/dev-new", "the instance's identity");
  assert.equal(button.tagName, "BUTTON", "focusable: in the roving tab order");
  assert.equal(button.querySelector(".ctx-spawn-since"), null, "no job here knows its start");
  noTools(u, "dev-new");
  button.click(); assert.deepEqual(u.opened, [], "activation opens and starts nothing");
  assert.equal(u.status("dev-new"), "Spawning (setting up worktree)", "its hover card");
  assert.equal(u.live(), null, "no job of this window: nothing is announced");
  // Alone in the roster it is the row the keyboard enters.
  const v = fixture(t, () => []);
  v.render([instance("dev-new", undefined, { running: false, spawnInProgress: true })]);
  assert.equal(v.row("dev-new").tabIndex, 0);
});

test("“since <local time>” only when a job of this window for the same home knows its start", async t => {
  const reported = [...roster, instance("dev-new", "root", { running: false, spawnInProgress: true })];
  const since = u => u.row("dev-new").querySelector(".ctx-spawn-since")?.textContent ?? null;
  for (const pending of ["spawning", "unknown"]) {
    const u = fixture(t, () => [job({ pending, startedAt: STARTED })]);
    u.render(reported);
    assert.equal(since(u), `since ${waitingClock(STARTED)}`, pending);
    assert.ok(u.row("dev-new").querySelector(".ctx-spawn-since").classList.contains("ctx-held-hint"), "muted");
  }
  for (const [label, rows] of [["no startedAt", [job()]], ["a non-finite one", [job({ startedAt: NaN })]],
    ["another home's job", [job({ home: "/synthetic/other", instance: "other", startedAt: STARTED })]],
    ["another agents root", [job({ pending: "unknown", agentsRoot: "/elsewhere/agents", startedAt: STARTED })]]]) {
    const u = fixture(t, () => rows);
    u.render(reported);
    assert.equal(since(u), null, label);
  }
});

test("the pending row turns into “Setting up worktree…” in place, never flashing to a stopped row with actions", async t => {
  let rows = [job({ startedAt: STARTED })];
  const u = fixture(t, () => rows);
  const step = (instances, state) => {
    u.render(instances);
    assert.equal(u.list.querySelectorAll(".ctx-inst").length, 3, "never both");
    const button = u.row("dev-new");
    assert.equal(button.dataset.treeInstance, "/synthetic/dev-new", "the same identity");
    assert.equal(button.querySelector(".ctx-spawn-state").textContent, state);
    assert.equal(button.getAttribute("aria-disabled"), "true");
    assert.equal(u.list.querySelector(".ctx-start"), null, "no Start…"); noTools(u, "dev-new");
    assert.equal(u.doc.activeElement, button, "focus kept");
    button.click(); assert.deepEqual(u.opened, [], "activation opens and starts nothing");
    return button;
  };
  u.render(roster);
  u.row("dev-new").focus();
  step(roster, "Spawning…");
  const settingUp = step([...roster, instance("dev-new", "root", { running: false, spawnInProgress: true })], "Setting up worktree…");
  assert.ok(settingUp.querySelector(".ctx-spawn-spinner"));
  assert.equal(settingUp.querySelector(".ctx-spawn-since").textContent, `since ${waitingClock(STARTED)}`);
  assert.equal(u.status("dev-new"), "Spawning (setting up worktree)");
  // The roster reports it without the flag while the job is still spawning: still the pending row, never "stopped".
  step([...roster, instance("dev-new", "root", { running: false })], "Spawning…");
  assert.equal(u.status("dev-new"), "Spawning", "the card says spawning, whatever liveness the row reports meanwhile");
  // Checking a result is in flight too.
  rows = [job({ pending: "checking", startedAt: STARTED })];
  step([...roster, instance("dev-new", "root", { running: false, spawnInProgress: true })], "Setting up worktree…");
  // The job is done: the real row.
  rows = [];
  u.render([...roster, instance("dev-new", "root")]);
  assert.equal(u.row("dev-new").classList.contains("pending"), false);
  assert.equal(u.doc.activeElement, u.row("dev-new"), "focus kept across the replacement");
});

for (const [flag, state, hint] of [["rollbackIncomplete", "Spawn didn't finish", "Retire it to clean up"],
  ["retirePending", "Retire didn't finish", "Retire it again to complete"]]) {
  test(`${flag}: “${state}”, muted “${hint}”, Retire instance… only, through the plan dialog`, async t => {
    const u = fixture(t, () => []);
    const row = instance("dev-q", "root", { running: false, [flag]: true });
    u.render([...roster, row]);
    const button = u.row("dev-q");
    assert.equal(button.querySelector(".ctx-spawn-state").textContent, state, "text, not colour alone");
    assert.equal(button.querySelector(".ctx-held-hint").textContent, hint);
    assert.equal(button.getAttribute("aria-disabled"), "true"); assert.match(button.getAttribute("aria-description"), new RegExp(hint));
    button.click(); assert.deepEqual(u.opened, [], "activation starts nothing");
    assert.equal(u.wrap("dev-q").querySelector(".ctx-start"), null, "no Start…");
    assert.deepEqual(u.menu("dev-q"), ["retire"], "no Inspect, Start, Stop or split");
    assert.equal(u.wrap("dev-q").querySelector("[data-action=retire]").textContent, "Retire instance…");
    assert.equal(u.status("dev-q"), state);
    u.wrap("dev-q").querySelector(".ctx-instance-actions").click();
    u.wrap("dev-q").querySelector("[data-action=retire]").click();
    await new Promise(r => setImmediate(r));
    assert.equal(u.lifecycle.length, 1, "the ordinary plan → apply dialog");
    assert.equal(u.lifecycle[0][0], "retire"); assert.equal(u.lifecycle[0][1].home, "/synthetic/dev-q"); assert.equal(u.lifecycle[0][1][flag], true);
    // A running quarantined home offers no Stop or split either.
    const v = fixture(t, () => []);
    v.render([...roster, instance("dev-q", "root", { running: true, [flag]: true })]);
    assert.deepEqual(v.menu("dev-q"), ["retire"]);
  });
}

test("both spawnInProgress and rollbackIncomplete: rollbackIncomplete wins, even over a job still in flight here", async t => {
  const both = instance("dev-new", "root", { running: false, spawnInProgress: true, rollbackIncomplete: true });
  for (const rows of [[], [job({ startedAt: STARTED })]]) {
    const u = fixture(t, () => rows);
    u.render([...roster, both]);
    assert.equal(u.list.querySelectorAll(".ctx-inst").length, 3, "never both");
    assert.equal(u.row("dev-new").querySelector(".ctx-spawn-state").textContent, "Spawn didn't finish");
    assert.equal(u.row("dev-new").querySelector(".ctx-spawn-spinner"), null);
    assert.equal(u.row("dev-new").querySelector(".ctx-spawn-since"), null);
    assert.deepEqual(u.menu("dev-new"), ["retire"]);
    assert.equal(u.status("dev-new"), "Spawn didn't finish");
  }
});

test("the hover card's Status names a held home; an ordinary row keeps its liveness", () => {
  const status = row => rosterTipFacts(row).rows.find(([key]) => key === "Status")[1];
  assert.equal(status(instance("a", undefined, { running: false, spawnInProgress: true })), "Spawning (setting up worktree)");
  assert.equal(status(instance("a", undefined, { running: false, rollbackIncomplete: true })), "Spawn didn't finish");
  assert.equal(status(instance("a", undefined, { running: true, retirePending: true })), "Retire didn't finish");
  assert.equal(status(instance("a", undefined, { running: false, pendingSpawn: job() })), "Spawning");
  assert.equal(status(instance("a", undefined, { running: false, spawnInProgress: true, pendingSpawn: job() })), "Spawning (setting up worktree)");
  assert.equal(status(instance("a", undefined, { running: false, retirePending: true, pendingSpawn: job() })), "Spawning", "as its pending row reads");
  assert.equal(status(instance("a", undefined, { running: false })), "stopped");
});

test("instanceActions: a spawning home has no actions (the trigger says why); a quarantined one Retire only, extras included", t => {
  const dom = new JSDOM("<body></body>");
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const extra = [{ action: "open-split", label: "Open in split", reason: "" }, { action: "open-pr", label: "Open pull request…", reason: "" }];
  const spawning = instanceActions(doc, instance("s", undefined, { running: false, spawnInProgress: true }), { extra });
  assert.equal(spawning.querySelectorAll("[role=menuitem]").length, 0);
  const trigger = spawning.querySelector(".ctx-instance-actions");
  assert.equal(trigger.disabled, true); assert.match(trigger.title, /s is setting up its worktree/);
  for (const flag of ["rollbackIncomplete", "retirePending"]) {
    const held = instanceActions(doc, instance("q", undefined, { running: true, [flag]: true }), { extra });
    assert.deepEqual([...held.querySelectorAll("[role=menuitem]")].map(item => item.dataset.action), ["retire"], flag);
    assert.equal(held.querySelector(".ctx-instance-actions").disabled, false);
  }
});

for (const theme of ["light", "solarized", "dark"]) test(`${theme}: the held line is --muted text, no opacity`, async t => {
  const dom = new JSDOM(`<!doctype html><html data-theme="${theme}"><head></head><body><span class="ctx-meta ctx-held-hint">Retire it to clean up</span></body></html>`);
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  for (const sheet of [read("theme.css"), css]) { const style = doc.createElement("style"); style.textContent = sheet; doc.head.append(style); }
  const line = dom.window.getComputedStyle(doc.querySelector(".ctx-held-hint"));
  assert.equal(line.color, "var(--muted)"); assert.equal(line.opacity, "1");
});
