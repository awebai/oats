// Workspace views (#482), renderer side: the view's deployments under the switcher, the roster and
// the Active overview grouped by deployment ONLY with two or more deployments (one deployment looks
// exactly as before), the switcher's "Not matched to a workspace" section, and the "On <deployment>"
// line of deployment-level surfaces. DOM and computed-token checks in jsdom; no Electron, HTTP or CLI.
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
import * as vd from "../renderer/view-deployments.mjs";
import * as hierarchy from "../renderer/views/hierarchy.mjs";
import { createWorkspaceSwitcher, workspaceChoiceLabels, workspaceChoicePlace, UNMATCHED_SECTION } from "../renderer/workspace-switcher.mjs";
import { mountShellIcons } from "../renderer/shell-icons.mjs";
import { deploymentScopeLabel, createDeploymentScopeLine, deploymentScopeCSS } from "../renderer/deployment-scope-line.mjs";
import { createAutomationsView, automationsCSS } from "../renderer/views/automations.mjs";
import { currentWorkspace, setWorkspace } from "../renderer/views/common.mjs";
import { viewContext } from "./helpers/view-context.mjs";

const read = (name) => readFileSync(new URL(`../renderer/${name}`, import.meta.url), "utf8");
const css = read("shell.css"), theme = read("theme.css"), html = read("index.html"), shellSource = read("shell.mjs");
const tick = () => new Promise((resolve) => setImmediate(resolve));

const LOCAL = { id: "/Users/op/Agents/oats", machine: "This Mac", path: "/Users/op/Agents/oats", label: "~/Agents/oats", local: true,
  reachable: true, identityFrom: "reported", primary: true };
const ALTAIR = { id: "remote:altair:tsm", machine: "altair", path: "/home/op/Agents/tsm", label: "~/Agents/tsm", local: false,
  reachable: false, identityFrom: "remembered", primary: false, reason: "altair timed out; it is tried again on the next read.",
  note: "altair now reports workspace tsm." };
const tag = (d) => ({ id: d.id, machine: d.machine, path: d.path });
const row = (name, d, fields = {}) => ({ instance: name, agent: "soul", agentsRoot: `${d.path}/agents`, home: `${d.path}/agents/soul/instances/${name}`,
  repoName: "repo", running: true, deployment: tag(d), ...(d.local ? {} : { server: d.machine, addressable: true }), ...fields });

/* ── the deployments under the switcher ── */
test("deploymentState says live, remembered, not reached and not observed in words", () => {
  assert.deepEqual(vd.deploymentState(LOCAL), { key: "live", text: "live", detail: "" });
  assert.deepEqual(vd.deploymentState(ALTAIR), { key: "remembered", text: "remembered", detail: `Last report, not live now. ${ALTAIR.reason}` });
  assert.deepEqual(vd.deploymentState({ ...ALTAIR, identityFrom: null }), { key: "unreached", text: "not reached", detail: ALTAIR.reason });
  assert.deepEqual(vd.deploymentState({ ...LOCAL, reachable: false, reason: "Reading the deployment…" }), { key: "unobserved", text: "not observed", detail: "Reading the deployment…" });
});

function listFixture(t) {
  const dom = new JSDOM(html); t.after(() => dom.window.close());
  const doc = dom.window.document;
  for (const source of [theme, css]) { const style = doc.createElement("style"); style.textContent = source; doc.head.append(style); }
  return { dom, doc, list: doc.getElementById("ws-deployments") };
}

test("every view lists its deployments under the switcher; one deployment: no primary mark", (t) => {
  const { doc, list } = listFixture(t);
  assert.equal(list.previousElementSibling, doc.querySelector(".side-head"), "directly under the switcher, outside its button");
  vd.renderDeploymentList(list, [LOCAL], { workspaceName: "oats" });
  assert.equal(list.hidden, false); assert.equal(list.getAttribute("role"), "list"); assert.equal(list.getAttribute("aria-label"), "Deployments of oats");
  const items = [...list.querySelectorAll("li.ws-deployment")];
  assert.equal(items.length, 1);
  assert.equal(items[0].querySelector(".ws-deployment-label").textContent, "This Mac · ~/Agents/oats", "never the workspace name");
  assert.equal(items[0].querySelector(".ws-deployment-state").textContent, "live", "the state in words, not colour only");
  assert.equal(items[0].querySelector(".ws-deployment-tag"), null, "no primary mark with one deployment");
  vd.renderDeploymentList(list, []); assert.equal(list.hidden, true, "nothing named, nothing listed");
});

test("two deployments: primary marked, remembered and not-reached states with their reason and note, as text", (t) => {
  const { list } = listFixture(t);
  const hostile = { ...ALTAIR, machine: '<img src=x onerror="boom">', note: "<b>note</b>" };
  vd.renderDeploymentList(list, [LOCAL, hostile]);
  const [first, second] = list.querySelectorAll("li");
  assert.equal(first.querySelector(".ws-deployment-tag").textContent, "primary");
  assert.equal(second.querySelector(".ws-deployment-tag"), null);
  assert.equal(second.dataset.state, "remembered");
  assert.equal(second.querySelector(".ws-deployment-state").textContent, "remembered");
  assert.deepEqual([...second.querySelectorAll(".ws-deployment-detail")].map((n) => n.textContent),
    [`Last report, not live now. ${ALTAIR.reason}`, "<b>note</b>"]);
  assert.equal(second.querySelector(".ws-deployment-label").textContent, '<img src=x onerror="boom"> · ~/Agents/tsm');
  assert.equal(list.querySelector("img, b"), null, "reported text is never markup");
  vd.renderDeploymentList(list, [LOCAL, { ...ALTAIR, identityFrom: null }]);
  assert.equal(list.querySelectorAll("li")[1].querySelector(".ws-deployment-state").textContent, "not reached");
});

/* ── the sidebar roster ── */
const renderSource = shellSource.match(/function renderContextRoster\(instances\) \{[\s\S]*?\n\}/)?.[0];
function roster(t, instances, deployments) {
  const dom = new JSDOM(html); t.after(() => dom.window.close());
  const doc = dom.window.document;
  const context = {
    ...tree, ...viewContext(), contextDeployments: deployments, document: doc, instanceActions, captureInstanceActionMenu, runtimeState, unsupportedSession,
    canAddressRemote, rowReason, createRuntimeBadge, instanceActionTarget, instanceSplitPlan, connectionGeneration: 0, menuState() {}, runAction: assert.fail,
    applyChordTitles() {}, updateActiveContexts() {}, getBinding: () => null, formatChord: (c) => c, isMac: true,
    contextRosterEl: doc.querySelector("#instance-roster"), contextFilter: "", contextWorkspace: "ws:view",
    rosterState: { hasData: true, state: "ready" }, rosterStale: false, contextDeploymentNote: null,
    contextInstances: instances, currentWorkspace: () => "ws:view", workspaceGeneration: () => 0, collapsedInstances: new Set(),
    rosterTip: { bind() {}, hide() {}, sync() {} }, rosterTipFacts: () => ({}), rosterPrs: { get: () => null, refresh() {} },
    spawnJobs: { rows: () => [], announce: () => false, observe() {}, settling: () => false, check() {} },
    tabs: new Map(), activeTab: null, tabOpenIntents: { applyFocus: (fn) => fn() },
    openTerminalTab: assert.fail, openInstanceStart: assert.fail, openLifecycleDialog: assert.fail, onRosterRowKey: assert.fail,
    api: assert.fail, showStage: assert.fail, refreshContextRoster: assert.fail,
  };
  context.splitOpenState = () => ({ split: null, activeId: null, tabs: context.tabs, workspace: "ws:view", visible: false });
  context.ownsInstanceTarget = (target) => context.contextInstances.filter((r) => sameInstanceActionTarget(target, r, "ws:view")).length === 1;
  runInNewContext(`${renderSource}\nrenderContextRoster`, context)(instances);
  return doc.querySelector(".ctx-list");
}

test("source pin: the shell's roster groups through rosterSections with the shown view's deployments", () => {
  assert.ok(renderSource);
  assert.match(renderSource, /rosterSections\(instances, visible, contextDeployments\)/);
  assert.match(shellSource, /contextDeployments = panelDeployments\(panel\);/);
});

test("roster, one deployment: no deployment heading, and exactly the list a window drew before views", (t) => {
  const rows = [row("lead", LOCAL), row("dev", LOCAL, { parentInstance: "lead" }), row("solo", LOCAL)];
  const before = roster(t, rows, []), one = roster(t, rows, [LOCAL]);
  assert.equal(one.querySelector(".ctx-deployment"), null, "no heading for a single deployment");
  assert.equal(one.innerHTML, before.innerHTML, "the same DOM as a panel naming no deployments");
  assert.deepEqual([...one.querySelectorAll(".ctx-group")].map((g) => g.dataset.group), ["lead", "independent"]);
});

test("roster, two deployments: a heading per deployment, in order, its own agent groups under it; host kept on remote rows", (t) => {
  const rows = [row("lead", LOCAL), row("dev", LOCAL, { parentInstance: "lead" }), row("far", ALTAIR), row("near", LOCAL)];
  const list = roster(t, rows, [LOCAL, ALTAIR]);
  const heads = [...list.querySelectorAll(".ctx-deployment")];
  assert.deepEqual(heads.map((h) => h.querySelector(".ctx-deployment-label").textContent), ["This Mac · ~/Agents/oats", "altair · ~/Agents/tsm"]);
  assert.equal(heads[0].getAttribute("role"), "heading"); assert.equal(heads[0].getAttribute("aria-level"), "3");
  assert.equal(heads[0].querySelector(".ctx-deployment-tag").textContent, "primary");
  assert.equal(heads[1].querySelector(".ctx-deployment-state").textContent, "remembered", "a state that is not live, in words");
  assert.equal(heads[0].getAttribute("aria-label"), "This Mac · ~/Agents/oats, primary, 3 instances");
  assert.equal(heads[1].getAttribute("aria-label"), "altair · ~/Agents/tsm, remembered, 1 instance");
  // Order: heading, its groups and rows, then the next heading.
  const sequence = [...list.children].map((el) => el.classList.contains("ctx-deployment") ? `#${el.dataset.deployment}`
    : el.classList.contains("ctx-group") ? `group:${el.dataset.group}` : el.querySelector(".ctx-name")?.textContent);
  assert.deepEqual(sequence, [`#${LOCAL.id}`, "group:lead", "lead", "dev", "group:independent", "near", `#${ALTAIR.id}`, "group:independent", "far"]);
  assert.equal(list.textContent.includes("oats ·"), false, "rows never repeat the workspace name");
  const far = [...list.querySelectorAll(".ctx-tree-row")].find((r) => r.querySelector(".ctx-name").textContent === "far");
  assert.match(far.querySelector(".ctx-meta").textContent, /^repo/, "the identity line is unchanged");
});

test("rosterSections: a pending spawn without a deployment joins the primary; empty deployments are left out", () => {
  const rows = [row("a", LOCAL), { instance: "spawning", agent: "soul", home: "/x/spawning", pendingSpawn: {} }];
  const sections = vd.rosterSections(rows, rows, [LOCAL, ALTAIR]);
  assert.deepEqual(sections.map((s) => s.deployment.id), [LOCAL.id]);
  assert.deepEqual(sections[0].groups.flatMap((g) => g.clusters.flatMap((c) => c.instances.map((i) => i.instance))), ["a", "spawning"]);
  assert.equal(vd.rosterSections(rows, rows, [LOCAL]).length, 1); assert.equal(vd.rosterSections(rows, rows, [LOCAL])[0].deployment, null);
});

/* ── the Active overview ── */
async function overview(t, data) {
  const dom = new JSDOM('<body><main id="host"></main></body>', { url: "http://localhost" });
  const doc = dom.window.document, host = doc.querySelector("main");
  const old = { window: globalThis.window, document: globalThis.document, setInterval: globalThis.setInterval, ws: currentWorkspace() };
  globalThis.window = dom.window; globalThis.document = doc; globalThis.setInterval = () => 0;
  setWorkspace("ws:view");
  const style = doc.createElement("style"); style.textContent = theme; doc.head.append(style);
  const dispose = hierarchy.mount(host, { hasWorkspaceSwitcher: true, api: async () => ({ ok: true, status: 200, json: async () => data }), openTerminal() {} });
  t.after(() => { dispose(); setWorkspace(old.ws); globalThis.window = old.window; globalThis.document = old.document; globalThis.setInterval = old.setInterval; dom.window.close(); });
  await tick(); await tick();
  return { dom, doc, host, all: (s) => [...host.querySelectorAll(s)] };
}
const view = { id: "ws:view", name: "oats" };

test("Active overview, one deployment: no deployment section, the same layout as before", async (t) => {
  const rows = [row("lead", LOCAL), row("dev", LOCAL, { parentInstance: "lead" }), row("solo", LOCAL)];
  const u = await overview(t, { instances: rows, workspace: view, workspaces: [{ ...view, deployments: [LOCAL.id] }], deployments: [LOCAL] });
  assert.equal(u.all(".hier-deployment").length, 0); assert.equal(u.all(".hier-dhead").length, 0);
  assert.equal(u.all(".hier-cluster").length, 1); assert.equal(u.all(".hier-solo .hnode").length, 1);
  assert.equal(hierarchy.layoutByDeployment(rows, [LOCAL]), null);
  assert.ok(u.host.querySelector(".hier-stage > .hier-cluster"), "groups sit on the stage as always");
});

test("Active overview, two deployments: one labelled section per deployment, stacked, each with its own groups", async (t) => {
  const rows = [row("lead", LOCAL), row("dev", LOCAL, { parentInstance: "lead" }), row("far", ALTAIR), row("near", LOCAL)];
  const u = await overview(t, { instances: rows, workspace: view, workspaces: [{ ...view, deployments: [LOCAL.id, ALTAIR.id] }], deployments: [LOCAL, ALTAIR] });
  const sections = u.all(".hier-deployment");
  assert.deepEqual(sections.map((s) => s.getAttribute("aria-label")), ["This Mac · ~/Agents/oats, primary", "altair · ~/Agents/tsm, remembered"]);
  assert.deepEqual(sections.map((s) => s.getAttribute("role")), ["group", "group"]);
  const heads = u.all(".hier-dhead");
  assert.deepEqual(heads.map((h) => h.querySelector(".hier-dname").textContent), ["This Mac · ~/Agents/oats", "altair · ~/Agents/tsm"]);
  assert.equal(heads[0].querySelector(".hier-dtag").textContent, "primary"); assert.equal(heads[1].querySelector(".hier-dstate").textContent, "remembered");
  assert.ok(parseFloat(heads[1].style.top) > parseFloat(heads[0].style.top), "stacked in the panel's order");
  assert.deepEqual([...sections[0].querySelectorAll(".hnode")].map((n) => n.dataset.name).sort(), ["dev", "lead", "near"]);
  assert.deepEqual([...sections[1].querySelectorAll(".hnode")].map((n) => n.dataset.name), ["far"]);
  // Each deployment's Independent strip is its own keyboard group.
  assert.deepEqual(u.all(".hier-solo").map((g) => g.dataset.ws), [`Independent:${LOCAL.id}`, `Independent:${ALTAIR.id}`]);
  const layout = hierarchy.layoutByDeployment(rows, [LOCAL, ALTAIR]);
  const [a, b] = layout.sections;
  assert.ok(b.y >= a.y + a.height, "the second section starts below the first");
  assert.ok(a.placed.every((p) => p.y >= a.y), "blocks are in stage coordinates under their heading");
});

/* ── the switcher ── */
function switcher(t) {
  const dom = new JSDOM(html, { url: "https://fixture.invalid" }); t.after(() => dom.window.close());
  const document = dom.window.document; mountShellIcons(document);
  const selected = [];
  const sw = createWorkspaceSwitcher({ document, selectWorkspace: (id) => selected.push(id), discoverSuggestions: async () => [], addWorkspace: async () => ({}), pickWorkspace: async () => ({}) });
  const key = (key, target = document.activeElement) => target.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  return { dom, document, sw, selected, key, options: () => [...document.querySelectorAll(".ws-option")] };
}
const views = [
  { id: "ws:aaaaaaaaaaaaaaaaaaaa", name: "oats", team: null, key: "github.com/org/oats", deployments: [LOCAL.id, ALTAIR.id] },
  { id: "/Users/op/Agents/loose", name: "loose", team: null, deployments: ["/Users/op/Agents/loose"], unattached: true, ref: "github.com/org/loose@main",
    reason: "This deployment's workspace reference names a member whose workspace isn't known yet; run oats sync there." },
  { id: "ws:bbbbbbbbbbbbbbbbbbbb", name: "tsm", team: null, key: "github.com/org/tsm", deployments: ["remote:vega:t1"] },
];

test("switcher: matched views first, then 'Not matched to a workspace' with the reported ref and the reason; never a ws: id", (t) => {
  const s = switcher(t);
  vd.notePanel({ workspace: { id: views[0].id }, deployments: [LOCAL, ALTAIR] });
  s.sw.begin()(views[0], views);
  assert.equal(s.document.getElementById("ws-trigger").title, "Active workspace: oats", "the trigger never names a ws: id");
  s.sw.openMenu();
  const listbox = s.document.getElementById("ws-options");
  assert.deepEqual(s.options().map((o) => o.dataset.workspaceId), [views[0].id, views[2].id, views[1].id]);
  const group = listbox.querySelector('[role="group"]');
  assert.equal(group.parentElement, listbox); assert.equal(s.document.getElementById(group.getAttribute("aria-labelledby")).textContent, UNMATCHED_SECTION);
  assert.equal(group.querySelectorAll(".ws-option").length, 1, "only the unattached view is in the section");
  const loose = group.querySelector(".ws-option");
  assert.equal(loose.querySelector(".ws-option-reason").textContent, `Reports github.com/org/loose@main. ${views[1].reason}`);
  assert.equal(loose.querySelector(".ws-option-path").textContent, views[1].id, "an unattached view keeps its deployment id");
  const [oats, tsm] = s.options();
  assert.equal(oats.querySelector(".ws-option-path").textContent, "This Mac · ~/Agents/oats, altair · ~/Agents/tsm");
  assert.equal(tsm.querySelector(".ws-option-path").textContent, "vega", "a remote never seen in a panel: its server, from the id");
  for (const option of s.options()) assert.doesNotMatch(`${option.textContent} ${option.title}`, /ws:/);
});

test("switcher: filtering and Arrow/Home/End work across the section; a filtered-out section disappears", (t) => {
  const s = switcher(t);
  s.sw.begin()(views[0], views); s.sw.openMenu();
  const search = s.document.getElementById("ws-menu-search");
  s.key("ArrowDown", search); assert.equal(s.document.activeElement.dataset.workspaceId, views[0].id);
  s.key("End"); assert.equal(s.document.activeElement.dataset.workspaceId, views[1].id, "End reaches the unattached section");
  s.key("ArrowUp"); assert.equal(s.document.activeElement.dataset.workspaceId, views[2].id);
  s.key("ArrowDown"); assert.equal(s.document.activeElement.dataset.workspaceId, views[1].id, "down crosses into the section");
  s.key("Home"); assert.equal(s.document.activeElement.dataset.workspaceId, views[0].id);
  search.value = "run oats sync"; search.dispatchEvent(new s.dom.window.Event("input"));
  assert.deepEqual(s.options().map((o) => o.dataset.workspaceId), [views[1].id], "the reason is searchable");
  search.value = "altair"; search.dispatchEvent(new s.dom.window.Event("input"));
  assert.deepEqual(s.options().map((o) => o.dataset.workspaceId), [views[0].id], "a deployment label finds its view");
  assert.equal(s.document.querySelector(".ws-option-group"), null, "no empty section heading");
  s.options()[0].click(); assert.deepEqual(s.selected, [], "the active view is not re-selected");
});

test("switcher labels: two views of one name are told apart by their keys, never by ws: ids", () => {
  const twins = [{ id: "ws:1", name: "tsm", key: "github.com/a/tsm", deployments: [] }, { id: "ws:2", name: "tsm", key: "github.com/b/tsm", deployments: [] }];
  assert.deepEqual(workspaceChoiceLabels(twins), ["tsm — github.com/a/tsm", "tsm — github.com/b/tsm"]);
  assert.equal(workspaceChoicePlace({ id: "/a/b", deployments: ["/a/b"] }), "/a/b", "a non-view id is shown as before");
});

/* ── the "On <deployment>" line ── */
test("deploymentScopeLabel: the primary's label with two or more deployments, null with one", () => {
  assert.equal(deploymentScopeLabel({ deployments: [LOCAL] }), null);
  assert.equal(deploymentScopeLabel({ deployments: [ALTAIR, { ...LOCAL, primary: true }] }), "This Mac · ~/Agents/oats");
  assert.equal(deploymentScopeLabel([{ ...ALTAIR, primary: true }, { ...LOCAL, primary: false }]), "altair · ~/Agents/tsm");
  assert.equal(deploymentScopeLabel({}), null);
});

test("a deployment-level surface shows 'On <primary>' only in a view of two or more deployments, and follows the panels", (t) => {
  const dom = new JSDOM("<body></body>"); t.after(() => dom.window.close());
  const doc = dom.window.document;
  vd.notePanel({ workspace: { id: "ws:one" }, deployments: [LOCAL] });
  vd.notePanel({ workspace: { id: "ws:two" }, deployments: [LOCAL, ALTAIR] });
  const one = createDeploymentScopeLine(doc, { workspace: "ws:one" }), two = createDeploymentScopeLine(doc, { workspace: "ws:two" });
  doc.body.append(one.element, two.element);
  assert.equal(one.element.hidden, true); assert.equal(one.element.textContent, "");
  assert.equal(two.element.hidden, false); assert.equal(two.element.textContent, "On This Mac · ~/Agents/oats");
  assert.ok(doc.head.querySelector("style[data-deployment-scope]"), "its style is in the document once");
  vd.notePanel({ workspace: { id: "ws:one" }, deployments: [LOCAL, ALTAIR] });
  assert.equal(one.element.textContent, "On This Mac · ~/Agents/oats", "a view that gains a deployment gains the line");
  vd.notePanel({ workspace: { id: "ws:two" }, deployments: [LOCAL] });
  assert.equal(two.element.hidden, true);
  const byDeployment = createDeploymentScopeLine(doc, { workspace: ALTAIR.id });
  assert.equal(byDeployment.element.textContent, "On This Mac · ~/Agents/oats", "a deployment id reads the view that holds it");
  one.dispose(); two.dispose(); byDeployment.dispose();
});

test("Automations (and Schedules, the same view) carry the line under their header", async (t) => {
  const dom = new JSDOM("<body><div id=host></div></body>"); t.after(() => dom.window.close());
  const doc = dom.window.document;
  const was = currentWorkspace(); t.after(() => setWorkspace(was));
  setWorkspace("ws:auto");
  vd.notePanel({ workspace: { id: "ws:auto" }, deployments: [LOCAL, ALTAIR] });
  const v = createAutomationsView(doc.getElementById("host"), { kind: "schedule", read: async () => ({ rows: [] }) });
  t.after(() => v.dispose());
  const header = doc.querySelector(".auto-header"), line = header.nextElementSibling;
  assert.ok(line.classList.contains("deployment-scope")); assert.equal(line.textContent, "On This Mac · ~/Agents/oats"); assert.equal(line.hidden, false);
  vd.notePanel({ workspace: { id: "ws:auto" }, deployments: [LOCAL] });
  assert.equal(line.hidden, true, "one deployment: no line");
});

/* ── contrast: every new text on its computed surface, in every theme ── */
function channels(hex) { assert.match(hex, /^#[0-9a-f]{6}$/i, hex); return hex.slice(1).match(/../g).map((v) => parseInt(v, 16) / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); }
const luminance = (hex) => { const c = channels(hex); return c[0] * .2126 + c[1] * .7152 + c[2] * .0722; };
const ratio = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
const painted = (win, el) => { for (let p = el; p; p = p.parentElement) { const bg = win.getComputedStyle(p).background; if (/^var\(--/.test(bg)) return bg.slice(6, -1); } return null; };

for (const name of ["light", "solarized", "dark"]) test(`${name}: the deployment list, roster headings, switcher section and scope line meet computed AA`, async (t) => {
  const dom = new JSDOM(html, { url: "https://fixture.invalid" }); t.after(() => dom.window.close());
  const doc = dom.window.document, win = dom.window; doc.documentElement.dataset.theme = name; mountShellIcons(doc);
  for (const source of [theme, css, deploymentScopeCSS, automationsCSS]) { const style = doc.createElement("style"); style.textContent = source; doc.head.append(style); }
  vd.renderDeploymentList(doc.getElementById("ws-deployments"), [LOCAL, ALTAIR]);
  const list = doc.querySelector("#instance-roster .ctx-list");
  list.append(vd.deploymentHeading(doc, { deployment: LOCAL, label: "This Mac · ~/Agents/oats", count: 1 }), vd.deploymentHeading(doc, { deployment: ALTAIR, label: "altair · ~/Agents/tsm", count: 1 }));
  const sw = createWorkspaceSwitcher({ document: doc, selectWorkspace() {}, discoverSuggestions: async () => [], addWorkspace: async () => ({}), pickWorkspace: async () => ({}) });
  sw.begin()(views[0], views); sw.openMenu();
  const section = doc.createElement("section"); section.className = "oats-view automations"; doc.body.append(section);
  vd.notePanel({ workspace: { id: "ws:contrast" }, deployments: [LOCAL, ALTAIR] });
  const line = createDeploymentScopeLine(doc, { workspace: "ws:contrast", className: "auto-scope" }); section.append(line.element);
  const root = win.getComputedStyle(doc.documentElement);
  const checks = [
    [".ws-deployment-label", "fg"], [".ws-deployment-state", "muted"], [".ws-deployment-detail", "muted"], [".ws-deployment-tag", "fg"],
    [".ctx-deployment-label", "muted"], [".ctx-deployment-tag", "fg"], [".ctx-deployment-state", "muted"],
    [".ws-option-section", "muted"], [".ws-option-reason", "muted"], [".auto-scope", "muted"],
  ];
  for (const [selector, fg] of checks) {
    const el = doc.querySelector(selector); assert.ok(el, selector);
    const color = win.getComputedStyle(el).color;
    assert.equal(color, `var(--${fg})`, selector);
    const bg = painted(win, el); assert.ok(bg, `${selector} sits on a painted token surface`);
    const r = ratio(root.getPropertyValue(`--${fg}`).trim(), root.getPropertyValue(`--${bg}`).trim());
    assert.ok(r >= 4.5, `${selector}: ${fg} on ${bg} is ${r.toFixed(2)}:1`);
    for (let p = el; p; p = p.parentElement) assert.equal(win.getComputedStyle(p).opacity, "1", `${selector}: no opacity over text`);
  }
  line.dispose();
});
