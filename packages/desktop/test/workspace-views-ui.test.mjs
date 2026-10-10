// Workspace views (#482), renderer side: nothing above the sidebar navigation, the roster grouped by
// deployment ONLY with two or more deployments (one deployment looks exactly as before), the
// switcher's one-line entries and its "Not matched to a workspace" section, and the "On <deployment>"
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
import { runtimeState, unsupportedSession } from "../../client/instance-presentation.mjs";
import { canAddressRemote, rowReason } from "../../client/remote-address.mjs";
import { createRuntimeBadge } from "../renderer/identity-marks.mjs";
import * as vd from "../renderer/view-deployments.mjs";
import * as hierarchy from "../renderer/views/hierarchy.mjs";
import { createWorkspaceSwitcher, workspaceChoiceLabels, workspaceChoicePlace, UNMATCHED_SECTION } from "../renderer/workspace-switcher.mjs";
import { onDeploymentTabRequest } from "../renderer/deployment-tabs.mjs";
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
const LOCAL2 = { id: "/Users/op/awebai/oats-v2", machine: "This Mac", path: "/Users/op/awebai/oats-v2", label: "~/awebai/oats-v2", local: true,
  reachable: true, identityFrom: "reported", primary: false };
const tag = (d) => ({ id: d.id, machine: d.machine, path: d.path });
const row = (name, d, fields = {}) => ({ instance: name, agent: "soul", agentsRoot: `${d.path}/agents`, home: `${d.path}/agents/soul/instances/${name}`,
  repoName: "repo", running: true, deployment: tag(d), ...(d.local ? {} : { server: d.machine, addressable: true }), ...fields });

/* ── deployment states, and nothing above the navigation ── */
test("deploymentState says live, remembered, not reached and not observed in words", () => {
  assert.deepEqual(vd.deploymentState(LOCAL), { key: "live", text: "live", detail: "" });
  assert.deepEqual(vd.deploymentState(ALTAIR), { key: "remembered", text: "remembered", detail: `Last report, not live now. ${ALTAIR.reason}` });
  assert.deepEqual(vd.deploymentState({ ...ALTAIR, identityFrom: null }), { key: "unreached", text: "not reached", detail: ALTAIR.reason });
  assert.deepEqual(vd.deploymentState({ ...LOCAL, reachable: false, reason: "Reading the deployment…" }), { key: "unobserved", text: "not observed", detail: "Reading the deployment…" });
});

test("UI spec: no deployments block above the sidebar navigation; the switcher sits right on the nav", (t) => {
  const dom = new JSDOM(html); t.after(() => dom.window.close());
  const doc = dom.window.document;
  assert.equal(doc.getElementById("ws-deployments"), null);
  assert.deepEqual([...doc.getElementById("sidebar").children].slice(0, 3).map((el) => el.id || el.className), ["side-head", "ws-menu", "nav"]);
  assert.equal(vd.renderDeploymentList, undefined, "the list renderer is gone");
  assert.doesNotMatch(`${css}\n${shellSource}`, /ws-deployment|renderDeploymentList|ctx-deployment-tag|ws-option-reason/);
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

test("roster, two deployments: a heading per deployment, by machine, in order, its own agent groups under it; host kept on remote rows", (t) => {
  const rows = [row("lead", LOCAL), row("dev", LOCAL, { parentInstance: "lead" }), row("far", ALTAIR), row("near", LOCAL)];
  const list = roster(t, rows, [LOCAL, ALTAIR]);
  const heads = [...list.querySelectorAll(".ctx-deployment")];
  assert.deepEqual(heads.map((h) => h.querySelector(".ctx-deployment-label").textContent), ["This Mac", "altair"], "the machine, no path");
  assert.deepEqual(heads.map((h) => h.querySelector(".ctx-deployment-label").title), [LOCAL.path, ALTAIR.path], "the full path only as the tooltip");
  assert.equal(heads[0].getAttribute("role"), "heading"); assert.equal(heads[0].getAttribute("aria-level"), "3");
  assert.equal(heads[0].querySelector(".deployment-mark"), null, "a live deployment carries no mark");
  const mark = heads[1].querySelector(".deployment-mark");
  assert.equal(mark.getAttribute("role"), "img"); assert.equal(mark.getAttribute("aria-label"), "remembered"); assert.equal(mark.title, "remembered");
  assert.ok(mark.querySelector("svg[aria-hidden=true]"), "the warning shape, decorative under its words");
  assert.equal(heads[0].getAttribute("aria-label"), "This Mac, 3 instances");
  assert.equal(heads[1].getAttribute("aria-label"), "altair, remembered, 1 instance");
  assert.doesNotMatch(list.textContent, /primary/, "no primary tag");
  assert.equal(heads[1].textContent, "altair", "one short line: no reason or note in the sidebar");
  // Order: heading, its groups and rows, then the next heading.
  const sequence = [...list.children].map((el) => el.classList.contains("ctx-deployment") ? `#${el.dataset.deployment}`
    : el.classList.contains("ctx-group") ? `group:${el.dataset.group}` : el.querySelector(".ctx-name")?.textContent);
  assert.deepEqual(sequence, [`#${LOCAL.id}`, "group:lead", "lead", "dev", "group:independent", "near", `#${ALTAIR.id}`, "group:independent", "far"]);
  assert.equal(list.textContent.includes("oats ·"), false, "rows never repeat the workspace name");
  const far = [...list.querySelectorAll(".ctx-tree-row")].find((r) => r.querySelector(".ctx-name").textContent === "far");
  assert.match(far.querySelector(".ctx-meta").textContent, /^repo/, "the identity line is unchanged");
});

test("roster headings: one machine holding two deployments adds the path tail; not reached is marked in words", (t) => {
  const unreached = { ...ALTAIR, identityFrom: null };
  const list = roster(t, [row("a", LOCAL), row("b", LOCAL2), row("c", unreached)], [LOCAL, LOCAL2, unreached]);
  const heads = [...list.querySelectorAll(".ctx-deployment")];
  assert.deepEqual(heads.map((h) => h.querySelector(".ctx-deployment-label").textContent), ["This Mac · oats", "This Mac · oats-v2", "altair"]);
  assert.deepEqual(heads.map((h) => h.querySelector(".deployment-mark")?.getAttribute("aria-label") ?? null), [null, null, "not reached"]);
  assert.equal(heads[2].getAttribute("aria-label"), "altair, not reached, 1 instance");
  // The machine is uppercased with the group label; a path tail is case-sensitive and keeps its case.
  const doc = list.ownerDocument, style = doc.createElement("style"); style.textContent = css; doc.head.append(style);
  const win = doc.defaultView;
  assert.deepEqual(heads.map((h) => h.querySelector(".ctx-deployment-path")?.textContent ?? null), ["oats", "oats-v2", null]);
  assert.equal(win.getComputedStyle(heads[1]).textTransform, "uppercase");
  assert.equal(win.getComputedStyle(heads[1].querySelector(".ctx-deployment-path")).textTransform, "none");
  assert.equal(win.getComputedStyle(heads[1].querySelector(".ctx-deployment-path")).letterSpacing, "normal");
});

test("roster: a stale deployment (its last re-read failed) is marked in words, and its held rows' Start and actions wait as on a stale roster", (t) => {
  const stale = { ...LOCAL2, stale: true, short: "Last read failed", reason: "This deployment's last read failed: the cache is locked. It shows what was last observed." };
  assert.deepEqual(vd.deploymentState(stale), { key: "stale", text: "stale", detail: stale.reason });
  const list = roster(t, [row("a", LOCAL, { running: false }), row("b", stale, { running: false })], [LOCAL, stale]);
  const heads = [...list.querySelectorAll(".ctx-deployment")];
  assert.deepEqual(heads.map((h) => h.querySelector(".deployment-mark")?.getAttribute("aria-label") ?? null), [null, "stale"]);
  const start = (name) => [...list.querySelectorAll(".ctx-tree-row")].find((r) => r.querySelector(".ctx-name")?.textContent === name).querySelector(".ctx-start");
  assert.equal(start("b").getAttribute("aria-disabled"), "true", "the held row waits");
  assert.equal(start("a").hasAttribute("aria-disabled"), false, "the live deployment's row acts as before");
});

test("roster headings: a deployment with no instances has no heading", (t) => {
  const list = roster(t, [row("a", LOCAL), row("b", LOCAL)], [LOCAL, ALTAIR]);
  assert.deepEqual([...list.querySelectorAll(".ctx-deployment")].map((h) => h.dataset.deployment), [LOCAL.id]);
});

test("rosterSections: a pending spawn without a deployment joins the primary; empty deployments are left out", () => {
  const rows = [row("a", LOCAL), { instance: "spawning", agent: "soul", home: "/x/spawning", pendingSpawn: {} }];
  const sections = vd.rosterSections(rows, rows, [LOCAL, ALTAIR]);
  assert.deepEqual(sections.map((s) => s.deployment.id), [LOCAL.id]);
  assert.deepEqual(sections[0].groups.flatMap((g) => g.clusters.flatMap((c) => c.instances.map((i) => i.instance))), ["a", "spawning"]);
  assert.equal(vd.rosterSections(rows, rows, [LOCAL]).length, 1); assert.equal(vd.rosterSections(rows, rows, [LOCAL])[0].deployment, null);
});

/* ── the switcher ── */
function switcher(t) {
  const dom = new JSDOM(html, { url: "https://fixture.invalid" }); t.after(() => dom.window.close());
  const document = dom.window.document; mountShellIcons(document);
  const selected = [], tabRequests = [];
  t.after(onDeploymentTabRequest((request) => tabRequests.push(request)));
  const sw = createWorkspaceSwitcher({ document, selectWorkspace: (id) => selected.push(id), discoverSuggestions: async () => [], addWorkspace: async () => ({}), pickWorkspace: async () => ({}) });
  const key = (key, target = document.activeElement) => target.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  return { dom, document, sw, selected, tabRequests, key, options: () => [...document.querySelectorAll(".ws-option")] };
}
const SHORT = "OATS too old to report its workspace";
const views = [
  { id: "ws:aaaaaaaaaaaaaaaaaaaa", name: "oats", team: null, key: "github.com/org/oats", deployments: [LOCAL.id, ALTAIR.id],
    deploymentLabels: ["This Mac · ~/Agents/oats", "altair · ~/Agents/tsm"], machines: ["This Mac", "altair"], notLive: 1 },
  { id: "/Users/op/Agents/loose", name: "loose", team: null, deployments: ["/Users/op/Agents/loose"], unattached: true, ref: "github.com/org/loose@main",
    reason: "This deployment's workspace reference names a member whose workspace isn't known yet; run oats sync there.", short: SHORT,
    deploymentLabels: ["This Mac · ~/Agents/loose"], machines: ["This Mac"], notLive: 0 },
  { id: "ws:bbbbbbbbbbbbbbbbbbbb", name: "tsm", team: null, key: "github.com/org/tsm", deployments: ["remote:vega:t1"], server: "vega", remote: true,
    deploymentLabels: ["vega · /srv/tsm"], machines: ["vega"], notLive: 0 },
];
const RAW = /ws:|remote:|\/Users\/|~\/|\/srv|Server:|Reports |run oats sync|github\.com\/org\/loose/;

test("switcher entries: the name, ONE muted line of machines, a status mark when a deployment is not live; never a path, id or reason", (t) => {
  const s = switcher(t);
  s.sw.begin()(views[0], views);
  assert.equal(s.document.getElementById("ws-trigger").title, "Active workspace: oats", "the trigger never names a ws: id");
  s.sw.openMenu();
  const listbox = s.document.getElementById("ws-options");
  assert.deepEqual(s.options().map((o) => o.dataset.workspaceId), [views[0].id, views[2].id, views[1].id]);
  const [oats, tsm] = s.options();
  assert.equal(oats.querySelector(".ws-option-name").textContent, "oats");
  assert.equal(oats.querySelector(".ws-option-meta").textContent, "This Mac · altair");
  assert.equal(tsm.querySelector(".ws-option-meta").textContent, "vega");
  const mark = oats.querySelector(".ws-option-line > .deployment-mark");
  assert.equal(mark.getAttribute("role"), "img"); assert.equal(mark.getAttribute("aria-label"), "1 deployment not live"); assert.equal(mark.title, "1 deployment not live");
  assert.equal(tsm.querySelector(".deployment-mark"), null, "every deployment live: no mark");
  for (const option of s.options()) {
    assert.equal(option.querySelector(".ws-option-copy").children.length, 2, "a name line and one secondary line");
    assert.doesNotMatch(option.textContent, RAW, option.dataset.workspaceId);
    assert.doesNotMatch(option.title, /ws:|remote:/, "a tooltip may name paths, never an id");
  }
  assert.equal(oats.title, "This Mac · ~/Agents/oats, altair · ~/Agents/tsm", "the paths only as the tooltip");
  assert.equal(listbox.querySelector(".ws-option-reason, .ws-option-path"), null);
  views[0].notLive = 2; s.sw.begin()(views[0], views); views[0].notLive = 1;
  assert.equal(s.options()[0].querySelector(".deployment-mark").getAttribute("aria-label"), "2 deployments not live");
});

test("switcher entries from an older server (no machines): nothing in place of the machines, never a path or id", (t) => {
  const s = switcher(t);
  const old = [{ id: "ws:cccccccccccccccccccc", name: "old", team: null, deployments: ["remote:vega:t1", "/Users/op/x"] },
    { id: "remote:vega:t2", name: "far", team: null, deployments: ["remote:vega:t2"] }];
  s.sw.begin()(old[0], old); s.sw.openMenu();
  for (const option of s.options()) {
    const meta = option.querySelector(".ws-option-meta");
    assert.equal(meta.textContent, ""); assert.equal(meta.hidden, true);
    assert.doesNotMatch(`${option.textContent} ${option.title}`, /ws:|remote:|\/Users/);
  }
  s.sw.begin()(old[1], old);
  assert.equal(s.document.getElementById("ws-trigger").title, "Active workspace: far", "a remote id is never the tooltip");
});

test("Not matched: the machine and ONE short reason; selecting one opens the Deployments page on its deployment's tab", (t) => {
  const s = switcher(t);
  s.sw.begin()(views[0], views); s.sw.openMenu();
  const listbox = s.document.getElementById("ws-options");
  const group = listbox.querySelector('[role="group"]');
  assert.equal(group.parentElement, listbox); assert.equal(s.document.getElementById(group.getAttribute("aria-labelledby")).textContent, UNMATCHED_SECTION);
  assert.equal(group.querySelectorAll(".ws-option").length, 1, "only the unattached view is in the section");
  const loose = group.querySelector(".ws-option");
  assert.equal(loose.querySelector(".ws-option-meta").textContent, `This Mac · ${SHORT}`);
  assert.equal(loose.querySelector(".ws-option-copy").children.length, 2, "no reason paragraph");
  assert.doesNotMatch(loose.textContent, RAW);
  assert.equal(loose.title, "This Mac · ~/Agents/loose");
  s.options()[0].click();
  assert.deepEqual(s.tabRequests, [], "a matched view only switches");
  s.sw.openMenu(); s.document.querySelector('[role="group"] .ws-option').click();
  assert.deepEqual(s.selected, [views[1].id], "selected as before");
  assert.deepEqual(s.tabRequests, [{ view: views[1].id, tab: views[1].deployments[0] }], "then its deployment's tab is requested");
  // A remote group is named by its server: its line does not repeat the name (live check, #482).
  const rigel = { id: "remote:rigel:cccccccccccc", name: "rigel", team: null, deployments: ["remote:rigel:cccccccccccc"], machines: ["rigel"], notLive: 0,
    unattached: true, short: "OATS too old to report its workspace", server: "rigel", remote: true };
  const r = switcher(t);
  r.sw.begin()(views[0], [views[0], rigel]); r.sw.openMenu();
  assert.equal(r.document.querySelector('[role="group"] .ws-option .ws-option-meta').textContent, "OATS too old to report its workspace");
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
  search.value = "too old"; search.dispatchEvent(new s.dom.window.Event("input"));
  assert.deepEqual(s.options().map((o) => o.dataset.workspaceId), [views[1].id], "the short reason is searchable");
  search.value = "run oats sync"; search.dispatchEvent(new s.dom.window.Event("input"));
  assert.deepEqual(s.options().map((o) => o.dataset.workspaceId), [], "what is not shown is not matched");
  search.value = "altair"; search.dispatchEvent(new s.dom.window.Event("input"));
  assert.deepEqual(s.options().map((o) => o.dataset.workspaceId), [views[0].id], "a machine finds its view");
  assert.equal(s.document.querySelector(".ws-option-group"), null, "no empty section heading");
  s.options()[0].click(); assert.deepEqual(s.selected, [], "the active view is not re-selected");
});

test("switcher labels: two choices of one name are told apart by keys, folder tails or machines, never by ids or full paths", () => {
  const twins = [{ id: "ws:1", name: "tsm", key: "github.com/a/tsm", deployments: [] }, { id: "ws:2", name: "tsm", key: "github.com/b/tsm", deployments: [] }];
  assert.deepEqual(workspaceChoiceLabels(twins), ["tsm — github.com/a/tsm", "tsm — github.com/b/tsm"]);
  assert.deepEqual(workspaceChoiceLabels([{ id: "/a/x/oats", name: "oats" }, { id: "remote:vega:oats", name: "oats", machines: ["vega"] }, { id: "remote:vega:o2", name: "oats" }]),
    ["oats — x/oats", "oats — vega", "oats"]);
  assert.deepEqual(workspaceChoiceLabels([{ id: "remote:vega:t1" }]), ["Workspace"], "a remote id is never a name");
  assert.equal(workspaceChoicePlace({ id: "/a/b", deployments: ["/a/b"] }), "", "no machines: nothing, never the id");
  assert.equal(workspaceChoicePlace({ id: "ws:1", machines: ["This Mac", "altair", "", 7] }), "This Mac · altair");
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

for (const name of ["light", "solarized", "dark"]) test(`${name}: roster headings and marks, switcher entries and section, and the scope line meet computed AA`, async (t) => {
  const dom = new JSDOM(html, { url: "https://fixture.invalid" }); t.after(() => dom.window.close());
  const doc = dom.window.document, win = dom.window; doc.documentElement.dataset.theme = name; mountShellIcons(doc);
  for (const source of [theme, css, deploymentScopeCSS, automationsCSS]) { const style = doc.createElement("style"); style.textContent = source; doc.head.append(style); }
  const list = doc.querySelector("#instance-roster .ctx-list");
  list.append(vd.deploymentHeading(doc, { deployment: LOCAL, label: "This Mac", count: 1 }), vd.deploymentHeading(doc, { deployment: ALTAIR, label: "altair", count: 1 }));
  const sw = createWorkspaceSwitcher({ document: doc, selectWorkspace() {}, discoverSuggestions: async () => [], addWorkspace: async () => ({}), pickWorkspace: async () => ({}) });
  // The active entry (painted --sel) and an inactive one (on the menu's --surface) both carry a mark.
  const marked = [views[0], views[1], { ...views[2], notLive: 1 }];
  sw.begin()(marked[0], marked); sw.openMenu();
  const section = doc.createElement("section"); section.className = "oats-view automations"; doc.body.append(section);
  vd.notePanel({ workspace: { id: "ws:contrast" }, deployments: [LOCAL, ALTAIR] });
  const line = createDeploymentScopeLine(doc, { workspace: "ws:contrast", className: "auto-scope" }); section.append(line.element);
  const root = win.getComputedStyle(doc.documentElement);
  const active = '.ws-option[aria-selected="true"]', inactive = `.ws-option[data-workspace-id="${marked[2].id}"]`;
  const checks = [
    [".ctx-deployment-label", "muted", "surface"], [".ctx-deployment .deployment-mark", "warn", "surface"],
    [`${active} .ws-option-name`, "fg", "sel"], [`${active} .ws-option-meta`, "muted", "sel"], [`${active} .deployment-mark`, "warn", "sel"],
    [`${inactive} .ws-option-name`, "fg", "surface"], [`${inactive} .ws-option-meta`, "muted", "surface"], [`${inactive} .deployment-mark`, "warn", "surface"],
    [".ws-option-group .ws-option-meta", "muted", "surface"], [".ws-option-section", "muted", "surface"], [".auto-scope", "muted", "surface"],
  ];
  for (const [selector, fg, surface] of checks) {
    const el = doc.querySelector(selector); assert.ok(el, selector);
    const color = win.getComputedStyle(el).color;
    assert.equal(color, `var(--${fg})`, selector);
    const bg = painted(win, el); assert.equal(bg, surface, `${selector} sits on --${surface}`);
    const r = ratio(root.getPropertyValue(`--${fg}`).trim(), root.getPropertyValue(`--${bg}`).trim());
    assert.ok(r >= 4.5, `${selector}: ${fg} on ${bg} is ${r.toFixed(2)}:1`);
    for (let p = el; p; p = p.parentElement) assert.equal(win.getComputedStyle(p).opacity, "1", `${selector}: no opacity over text`);
  }
  // Hover paints --surface-2 under an entry: its line and mark hold there too.
  for (const fg of ["muted", "warn", "fg"]) assert.ok(ratio(root.getPropertyValue(`--${fg}`).trim(), root.getPropertyValue("--surface-2").trim()) >= 4.5, `${fg} on surface-2`);
  line.dispose();
});
