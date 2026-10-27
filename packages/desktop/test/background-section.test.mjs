// The Background section (#1579), the shared answer both clients draw: which rows it holds (a row whose own
// `background` is true, or one under such an ancestor; placement only), the main tree and the section each a
// tree of its own, the heading's count and wait, and a collapse that hides and rolls up only inside its own
// section. Without the kernel's feature nothing moves, whatever a row carries.
import test from "node:test";
import assert from "node:assert/strict";
import { backgroundPlacement, instanceVisibleInTree, waitingRollup, collapseKey, instanceId, filterInstanceTree } from "../../client/instance-tree.mjs";
import { sidebarSections, rosterSectionKey, rosterSections } from "../../client/roster-sections.mjs";
import { DESKTOP_TERMS } from "../renderer/desktop-terms.mjs";
import { deploymentStatusData } from "../../client/deployment-data.mjs";
import { panelInstance } from "../../client/deployment-panel.mjs";
import { projectActivePanel, activeSignature } from "../renderer/active-observation.mjs";

const WS = "ws";
const at = (instance, extra = {}) => ({ instance, agent: "dev", home: `/w/${instance}`, agentsRoot: "/w", running: true, ...extra });
const WAITS = { waitingOnYou: { since: "2026-10-27T10:00:00.000Z", producer: "oats.core", reason: "question" } };
const row = (roster, name) => roster.find(i => i.instance === name);
const names = (roster, set) => roster.filter(i => set.has(instanceId(i))).map(i => i.instance).sort();
/** Each section's rows in drawn order, with their depths. */
const drawn = sections => sections.flatMap(s => s.groups.flatMap(g => g.clusters.flatMap(c => c.instances.map(i => `${i.instance}@${i.depth}`))));

// lead (main) → maint (background) → expert (main, its own flag off) → helper; harvester (background) under lead;
// solo (main); and a background root with no parent.
const ROSTER = [
  at("lead"),
  at("maint", { parentInstance: "lead", background: true }),
  at("expert", { parentInstance: "maint" }),
  at("helper", { parentInstance: "expert" }),
  at("solo"),
  at("cron", { background: true }),
];

test("placement: a row's own flag or any ancestor's; a parent in the main tree is not pulled in", () => {
  const placed = backgroundPlacement(ROSTER, true);
  assert.deepEqual(names(ROSTER, placed), ["cron", "expert", "helper", "maint"]);
  // A chain main → background → main: the last is in Background, its own flag unchanged (no inheritance).
  assert.equal(row(ROSTER, "expert").background, undefined);
});

test("placement: without the feature nothing moves, a stray field is ignored", () => {
  assert.equal(backgroundPlacement(ROSTER, false).size, 0);
  const s = sidebarSections(ROSTER, ROSTER, [], DESKTOP_TERMS, { placement: backgroundPlacement(ROSTER, false), open: true });
  assert.equal(s.background, null);
  assert.deepEqual(drawn(s.main), drawn(rosterSections(ROSTER, ROSTER, [], DESKTOP_TERMS)));
});

test("placement: only `true` counts, a cycle and an unresolved parent end the walk", () => {
  const roster = [
    at("a", { parentInstance: "b" }), at("b", { parentInstance: "a" }), // a cycle, no flag
    at("c", { parentInstance: "gone" }), at("d", { background: "yes" }), at("e", { background: 1 }),
    at("f", { parentInstance: "g" }), at("g", { parentInstance: "f", background: true }), // a cycle through a flag
  ];
  assert.deepEqual(names(roster, backgroundPlacement(roster, true)), ["f", "g"]);
});

test("placement: an ambiguous parent name places nothing through it", () => {
  // Two "boss" rows in other agents roots: the child's parent resolves to neither.
  const roster = [at("boss", { home: "/x/boss", agentsRoot: "/x", background: true }), at("boss", { home: "/y/boss", agentsRoot: "/y" }), at("kid", { parentInstance: "boss" })];
  assert.deepEqual(names(roster, backgroundPlacement(roster, true)), ["boss"]);
});

test("partition: each section is its own tree; a background root's parent stays in the main tree", () => {
  const placement = backgroundPlacement(ROSTER, true);
  const s = sidebarSections(ROSTER, ROSTER, [], DESKTOP_TERMS, { placement, open: true });
  assert.deepEqual(drawn(s.main), ["lead@0", "solo@0"]);
  // maint is a root of the section though its parent is lead; expert and helper nest under it.
  assert.deepEqual(drawn(s.background.sections), ["cron@0", "maint@0", "expert@1", "helper@2"]);
  assert.equal(s.background.count, 4);
  assert.equal(s.background.open, true);
});

test("partition: a part never turns an ambiguous name into a unique one", () => {
  // Two "boss" rows in other agents roots, one in each part: in the section alone the name would be unique.
  const roster = [
    at("boss", { home: "/x/boss", agentsRoot: "/x", background: true }),
    at("boss", { home: "/y/boss", agentsRoot: "/y" }),
    at("kid", { agentsRoot: "/z", home: "/z/kid", parentInstance: "boss", background: true }),
  ];
  const s = sidebarSections(roster, roster, [], DESKTOP_TERMS, { placement: backgroundPlacement(roster, true), open: true });
  assert.deepEqual(drawn(s.background.sections), ["boss@0", "kid@0"]);
});

test("closed by default: the heading only, with the count and the wait of the whole section", () => {
  const roster = ROSTER.map(r => (r.instance === "helper" ? { ...r, ...WAITS } : r));
  const s = sidebarSections(roster, roster, [], DESKTOP_TERMS, { placement: backgroundPlacement(roster, true) });
  assert.deepEqual(s.background, { count: 4, open: false, waiting: true, sections: [] });
  // A held-stale row waits for nobody.
  const stale = sidebarSections(roster, roster, [], DESKTOP_TERMS, { placement: backgroundPlacement(roster, true), stale: () => true });
  assert.equal(stale.background.waiting, false);
  // A waiting main-tree row is not the section's.
  const main = ROSTER.map(r => (r.instance === "solo" ? { ...r, ...WAITS } : r));
  assert.equal(sidebarSections(main, main, [], DESKTOP_TERMS, { placement: backgroundPlacement(main, true) }).background.waiting, false);
});

test("no section when no row is background; every row background leaves the main tree empty", () => {
  const plain = [at("a"), at("b")];
  assert.equal(sidebarSections(plain, plain, [], DESKTOP_TERMS, { placement: backgroundPlacement(plain, true) }).background, null);
  const all = [at("a", { background: true }), at("b", { parentInstance: "a" })];
  const s = sidebarSections(all, all, [], DESKTOP_TERMS, { placement: backgroundPlacement(all, true), open: true });
  assert.deepEqual(drawn(s.main), []);
  assert.deepEqual(drawn(s.background.sections), ["a@0", "b@1"]);
});

test("a filter: the heading counts the listed rows; no listed row, no section", () => {
  const placement = backgroundPlacement(ROSTER, true);
  const listed = filterInstanceTree(ROSTER, "help"); // helper and its path: lead, maint, expert
  const s = sidebarSections(ROSTER, listed, [], DESKTOP_TERMS, { placement, open: true, listed });
  assert.equal(s.background.count, 3);
  assert.deepEqual(drawn(s.background.sections), ["maint@0", "expert@1", "helper@2"]);
  const none = filterInstanceTree(ROSTER, "solo");
  assert.equal(sidebarSections(ROSTER, none, [], DESKTOP_TERMS, { placement, listed: none }).background, null);
});

test("a collapse hides and rolls up only inside its own section", () => {
  const roster = ROSTER.map(r => (r.instance === "maint" ? { ...r, ...WAITS } : r.instance === "helper" ? { ...r, ...WAITS } : r));
  const placement = backgroundPlacement(roster, true);
  const section = rosterSectionKey([], placement);
  // lead collapsed: maint is in another section, so it stays visible and nothing rolls up to lead.
  const leadShut = new Set([collapseKey(WS, instanceId(row(roster, "lead")))]);
  assert.equal(instanceVisibleInTree(row(roster, "maint"), roster, leadShut, WS, false, { section }), true);
  assert.equal(waitingRollup(roster, leadShut, WS, { section }).size, 0);
  // maint collapsed: expert and helper hide; helper's wait rolls up to maint, inside the section.
  const maintShut = new Set([collapseKey(WS, instanceId(row(roster, "maint")))]);
  assert.equal(instanceVisibleInTree(row(roster, "helper"), roster, maintShut, WS, false, { section }), false);
  const below = waitingRollup(roster, maintShut, WS, { section });
  assert.deepEqual([...below.keys()], [instanceId(row(roster, "maint"))]);
  assert.deepEqual(below.get(instanceId(row(roster, "maint"))).map(r => r.instance), ["helper"]);
});

test("rosterSectionKey: one key per deployment and part", () => {
  const deployments = [{ id: "here", machine: "this computer", primary: true }, { id: "far", machine: "far", local: false }];
  const roster = [at("a", { deployment: { id: "here" } }), at("b", { deployment: { id: "far" }, background: true }), at("c"), at("d", { deployment: { id: "far" } })];
  const key = rosterSectionKey(deployments, backgroundPlacement(roster, true));
  const [a, b, c, d] = roster.map(key);
  assert.equal(a, c); // an untagged row joins the primary's
  assert.notEqual(b, d); // one deployment, two parts
  assert.notEqual(a, d);
  // One deployment: the part alone decides.
  const one = rosterSectionKey([], backgroundPlacement(roster, true));
  assert.equal(one(roster[0]), one(roster[3]));
  assert.notEqual(one(roster[0]), one(roster[1]));
});

test("two deployments: the section keeps the machine sub-headings", () => {
  const deployments = [{ id: "here", machine: "this computer", local: true, primary: true }, { id: "far", machine: "far", local: false }];
  const roster = [at("a", { deployment: { id: "here" }, background: true }), at("b", { deployment: { id: "far" }, background: true }), at("c", { deployment: { id: "far" } })];
  const s = sidebarSections(roster, roster, deployments, DESKTOP_TERMS, { placement: backgroundPlacement(roster, true), open: true });
  assert.deepEqual(s.main.map(p => p.deployment.id), ["far"]);
  assert.deepEqual(s.background.sections.map(p => [p.deployment.id, drawn([p])]), [["here", ["a@0"]], ["far", ["b@0"]]]);
});

test("the field passes the client allow-lists as exactly true, anything else is absent", () => {
  const status = (value) => deploymentStatusData({ root: "/d/agents", agents: [{ name: "dev", dir: "/d/agents/dev",
    instances: [{ instance: "dev-1", home: "/d/agents/dev/instances/dev-1", ...(value === undefined ? {} : { background: value }) }] }] }, "/d");
  assert.equal(status(true).agents[0].instances[0].background, true);
  for (const bad of [false, "true", 1, null, undefined]) assert.equal(Object.hasOwn(status(bad).agents[0].instances[0], "background"), false, String(bad));
  const base = { instance: "dev-1", home: "/d/agents/dev/instances/dev-1", agentsRoot: "/d/agents", running: true };
  assert.equal(panelInstance({ ...base, background: true }).background, true);
  assert.equal(Object.hasOwn(panelInstance({ ...base, background: "yes" }), "background"), false);
  const panel = (value) => ({ workspace: { id: "team" }, instances: [{ ...base, ...(value === undefined ? {} : { background: value }) }] });
  assert.equal(projectActivePanel(panel(true)).instances[0].background, true);
  assert.equal(Object.hasOwn(projectActivePanel(panel(1)).instances[0], "background"), false);
  assert.notEqual(activeSignature(projectActivePanel(panel(true))), activeSignature(projectActivePanel(panel(undefined))), "a move redraws");
});
