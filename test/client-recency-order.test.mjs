// The command palette's order (#1383): packages/client recencyOrder, and rosterGroups / rosterSections given a
// last-focus record. A node sits where the most recently focused instance of its subtree puts it, at every level
// (clusters, a cluster's roots, a parent's children); never-focused nodes keep the roster's order after the rest;
// a child stays under its parent at its depth. The order is decided on the full roster: what is visible only
// decides which rows are listed. Without a record, the builders answer exactly as the sidebar's always did.
//
// It imports packages/client only, so it runs on a root-only checkout with nothing installed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { clusterInstances, recencyOrder, rosterGroups, filterInstanceTree, instanceId } from "../packages/client/instance-tree.mjs";
import { rosterSections } from "../packages/client/roster-sections.mjs";
import { clientTerms } from "../packages/client/client-terms.mjs";

const TERMS = clientTerms({ name: "the test client", self: "this test client", selfInitial: "This test client", update: "Update the test client.", thisMachine: "This machine" });
const at = (instance, extra = {}) => ({ instance, agent: "dev", home: `/w/${instance}`, agentsRoot: "/w", running: true, ...extra });
const row = (roster, name) => roster.find((i) => i.instance === name);
/** A record from names, newest first: the first name gets the latest time. */
const focus = (roster, ...names) => new Map(names.map((name, n) => [instanceId(row(roster, name)), 1000 - n]));
/** Each cluster's rows as [name, depth]. */
const order = (clusters) => clusters.map((c) => c.instances.map((i) => [i.instance, i.depth]));
/** [group key, label, each cluster's row names]. */
const shape = (groups) => groups.map((g) => [g.key, g.label, g.clusters.map((c) => c.instances.map((i) => i.instance))]);

// The issue's example: `a`, `b` and `z` unrelated; `p` a parent of `c0` and `c1`; `q` a root joined to `p` by
// an explicit sibling link.
const EXAMPLE = [
  at("z"), at("c1", { parentInstance: "p" }), at("q", { siblingInstance: "p" }), at("a"),
  at("c0", { parentInstance: "p" }), at("p"), at("b"),
];

test("the issue's example: a fresh child lifts its parent's cluster and its parent; never-focused rows follow", () => {
  const record = focus(EXAMPLE, "c1", "b", "a");
  assert.deepEqual(order(clusterInstances(EXAMPLE)), [[["a", 0]], [["b", 0]], [["p", 0], ["c0", 1], ["c1", 1], ["q", 0]], [["z", 0]]],
    "the sidebar's order, by name");
  assert.deepEqual(order(recencyOrder(clusterInstances(EXAMPLE), record)), [[["p", 0], ["c1", 1], ["c0", 1], ["q", 0]], [["b", 0]], [["a", 0]], [["z", 0]]]);
  assert.deepEqual(shape(rosterGroups(EXAMPLE, EXAMPLE, { lastFocus: record })), [
    ["cluster:0:p", "p", [["p", "c1", "c0", "q"]]],
    [`independent:${instanceId(row(EXAMPLE, "b"))}`, "independent", [["b"], ["a"], ["z"]]],
  ]);
});

test("an empty record returns the input order, and the builders answer exactly as without one", () => {
  const clusters = clusterInstances(EXAMPLE);
  assert.deepEqual(recencyOrder(clusters, new Map()), clusters);
  assert.deepEqual(rosterGroups(EXAMPLE, EXAMPLE, { lastFocus: new Map() }), rosterGroups(EXAMPLE, EXAMPLE));
  // A record that names no listed instance is no record.
  assert.deepEqual(rosterGroups(EXAMPLE, EXAMPLE, { lastFocus: new Map([["/w/gone", 5]]) }), rosterGroups(EXAMPLE, EXAMPLE));
  // A value that is not a Map is no record either.
  assert.deepEqual(rosterGroups(EXAMPLE, EXAMPLE, { lastFocus: { [instanceId(row(EXAMPLE, "z"))]: 5 } }), rosterGroups(EXAMPLE, EXAMPLE));
});

test("clusters are ordered by their most recently focused member, wherever it sits", () => {
  const roster = [at("lead"), at("mid", { parentInstance: "lead" }), at("tip", { parentInstance: "mid" }), at("duo"), at("duo-kid", { parentInstance: "duo" }), at("solo")];
  assert.deepEqual(order(recencyOrder(clusterInstances(roster), focus(roster, "tip", "solo", "duo"))).map((c) => c[0][0]), ["lead", "solo", "duo"]);
  assert.deepEqual(order(recencyOrder(clusterInstances(roster), focus(roster, "duo-kid", "lead"))).map((c) => c[0][0]), ["duo", "lead", "solo"]);
});

test("a child newer than its parent lifts the parent above that parent's sibling roots", () => {
  // Roots alpha and beta, joined by a sibling link; beta's child focused last, alpha itself before it.
  const roster = [at("alpha"), at("beta", { siblingInstance: "alpha" }), at("beta-kid", { parentInstance: "beta" }), at("alpha-kid", { parentInstance: "alpha" })];
  assert.deepEqual(order(clusterInstances(roster)), [[["alpha", 0], ["alpha-kid", 1], ["beta", 0], ["beta-kid", 1]]]);
  assert.deepEqual(order(recencyOrder(clusterInstances(roster), focus(roster, "beta-kid", "alpha"))),
    [[["beta", 0], ["beta-kid", 1], ["alpha", 0], ["alpha-kid", 1]]], "ranking by the node's own focus would keep alpha first");
});

test("children are reordered under their own parent, each subtree whole and every depth kept", () => {
  const roster = [
    at("lead"), at("k1", { parentInstance: "lead" }), at("k2", { parentInstance: "lead" }), at("k3", { parentInstance: "lead" }),
    at("k1-x", { parentInstance: "k1" }), at("k3-x", { parentInstance: "k3" }), at("k3-y", { parentInstance: "k3" }),
  ];
  assert.deepEqual(order(recencyOrder(clusterInstances(roster), focus(roster, "k3-y", "k2", "lead"))), [[
    ["lead", 0], ["k3", 1], ["k3-y", 2], ["k3-x", 2], ["k2", 1], ["k1", 1], ["k1-x", 2],
  ]]);
});

test("never-focused nodes keep their input order after every focused one, at every level", () => {
  const roster = [at("a"), at("b"), at("c"), at("d"), at("p"), at("p1", { parentInstance: "p" }), at("p2", { parentInstance: "p" }), at("p3", { parentInstance: "p" })];
  assert.deepEqual(order(recencyOrder(clusterInstances(roster), focus(roster, "c", "p3"))), [
    [["c", 0]], [["p", 0], ["p3", 1], ["p1", 1], ["p2", 1]], [["a", 0]], [["b", 0]], [["d", 0]],
  ]);
});

test("independent runs are formed again after ordering: a focused single leaves a stale run behind", () => {
  const roster = [at("a"), at("b"), at("lead"), at("lead-kid", { parentInstance: "lead" }), at("x"), at("y")];
  const key = (name) => `independent:${instanceId(row(roster, name))}`;
  assert.deepEqual(shape(rosterGroups(roster, roster)), [
    [key("a"), "independent", [["a"], ["b"]]], ["cluster:0:lead", "lead", [["lead", "lead-kid"]]], [key("x"), "independent", [["x"], ["y"]]],
  ]);
  assert.deepEqual(shape(rosterGroups(roster, roster, { lastFocus: focus(roster, "y", "lead-kid") })), [
    [key("y"), "independent", [["y"]]], ["cluster:0:lead", "lead", [["lead", "lead-kid"]]], [key("a"), "independent", [["a"], ["b"], ["x"]]],
  ]);
  // Every key stays unique.
  const groups = rosterGroups(roster, roster, { lastFocus: focus(roster, "b", "lead", "x") });
  assert.equal(new Set(groups.map((g) => g.key)).size, groups.length);
});

test("visibility is projected after ordering: a query never changes the order", () => {
  const record = focus(EXAMPLE, "c1", "b", "a");
  const listed = (visible) => shape(rosterGroups(EXAMPLE, visible, { lastFocus: record }));
  const all = listed(EXAMPLE).flatMap(([, , clusters]) => clusters.flat());
  for (const query of ["c", "a", "q", "z", "b"]) {
    const shown = listed(filterInstanceTree(EXAMPLE, query)).flatMap(([, , clusters]) => clusters.flat());
    assert.ok(shown.length, query);
    assert.deepEqual(shown, all.filter((name) => shown.includes(name)), `"${query}" lists a subsequence of the full order`);
  }
  // A hidden row's focus still places its cluster: c1 hidden, p's cluster still leads.
  const visible = EXAMPLE.filter((i) => i.instance !== "c1");
  assert.deepEqual(listed(visible).map(([key]) => key), ["cluster:0:p", `independent:${instanceId(row(EXAMPLE, "b"))}`]);
  assert.deepEqual(listed(visible)[0][2], [["p", "c0", "q"]]);
});

test("duplicate names across agents roots stay distinct: the record is keyed by identity", () => {
  const one = (instance, root, extra = {}) => ({ instance, agent: "dev", home: `${root}/${instance}`, agentsRoot: root, running: true, ...extra });
  const roster = [one("dev", "/r1"), one("dev", "/r2"), one("kid", "/r2", { parentInstance: "dev" }), one("other", "/r1")];
  const record = new Map([[instanceId(roster[2]), 9], [instanceId(roster[3]), 5]]);
  const clusters = recencyOrder(clusterInstances(roster), record);
  assert.deepEqual(clusters.map((c) => c.instances.map((i) => i.home)), [["/r2/dev", "/r2/kid"], ["/r1/other"], ["/r1/dev"]]);
});

test("the input is never mutated", () => {
  const clusters = clusterInstances(EXAMPLE);
  const before = structuredClone(clusters);
  const out = recencyOrder(clusters, focus(EXAMPLE, "c1", "b", "a"));
  assert.deepEqual(clusters, before);
  assert.notEqual(out[0], clusters.find((c) => c.key === "p"), "a new cluster object");
  assert.deepEqual(Object.keys(out[0]), Object.keys(clusters[0]), "the same cluster shape");
});

test("sections are ordered by the latest focus over each one's full roster, then the panel's order", () => {
  const D1 = { id: "d1", machine: "one", path: "/one", label: "one", local: true, reachable: true, primary: true };
  const D2 = { id: "d2", machine: "two", path: "/two", label: "two", reachable: true };
  const D3 = { id: "d3", machine: "three", path: "/three", label: "three", reachable: true };
  const on = (instance, d, extra = {}) => ({ ...at(instance, extra), home: `/${d}/${instance}`, deployment: { id: d } });
  const roster = [on("a", "d1"), on("b", "d2"), on("b-kid", "d2", { parentInstance: "b" }), on("c", "d3"), on("e", "d1")];
  const ids = (sections) => sections.map((s) => s.deployment.id);
  const deployments = [D1, D2, D3];
  assert.deepEqual(ids(rosterSections(roster, roster, deployments, TERMS)), ["d1", "d2", "d3"]);
  assert.deepEqual(ids(rosterSections(roster, roster, deployments, TERMS, { lastFocus: focus(roster, "b-kid", "c") })), ["d2", "d3", "d1"]);
  assert.deepEqual(ids(rosterSections(roster, roster, deployments, TERMS, { lastFocus: focus(roster, "c") })), ["d3", "d1", "d2"]);
  assert.deepEqual(rosterSections(roster, roster, deployments, TERMS, { lastFocus: new Map() }), rosterSections(roster, roster, deployments, TERMS));
  // Inside a section, its groups follow the record too.
  const d1 = rosterSections(roster, roster, deployments, TERMS, { lastFocus: focus(roster, "e") }).find((s) => s.deployment.id === "d1");
  assert.deepEqual(shape(d1.groups)[0][2], [["e"], ["a"]]);
  // A section's place is decided on its full roster: b-kid hidden by a query, d2 still leads.
  const visible = roster.filter((i) => i.instance !== "b-kid");
  assert.deepEqual(ids(rosterSections(roster, visible, deployments, TERMS, { lastFocus: focus(roster, "b-kid", "c") })), ["d2", "d3", "d1"]);
  // One deployment: one section, its groups in recency order.
  const single = rosterSections(roster, roster, [D1], TERMS, { lastFocus: focus(roster, "c") });
  assert.equal(single.length, 1);
  assert.equal(shape(single[0].groups)[0][2][0][0], "c");
});
