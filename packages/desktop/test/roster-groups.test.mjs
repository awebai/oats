// A row keeps its roster group under a filter and a collapse (#971). rosterGroups decides a
// cluster's group on the FULL roster: more than one member there is a group under the cluster's
// name, exactly one goes under "independent". What is visible decides which rows are listed, and
// whether a group is listed at all; it never moves a row to another group, nor changes a group's key.
import test from "node:test";
import assert from "node:assert/strict";
import { rosterGroups, filterInstanceTree, instanceVisibleInTree, collapseKey, instanceId } from "../../client/instance-tree.mjs";
import { rosterSections } from "../../client/roster-sections.mjs";
import { DESKTOP_TERMS } from "../renderer/desktop-terms.mjs";

const WS = "ws";
const at = (instance, extra = {}) => ({ instance, agent: "dev", home: `/w/${instance}`, agentsRoot: "/w", running: true, ...extra });
// A cluster of two (duo), a cluster of five (lead) and two unrelated instances, out of order.
const ROSTER = [
  at("zed"),
  at("tip-two", { parentInstance: "mid" }),
  at("duo-kid", { parentInstance: "duo" }),
  at("lead"),
  at("side", { parentInstance: "lead" }),
  at("solo"),
  at("mid", { parentInstance: "lead" }),
  at("duo"),
  at("tip-one", { parentInstance: "mid" }),
];
const row = (roster, name) => roster.find(i => i.instance === name);
/** The rows a filter leaves: the matches with their ancestor paths, as the sidebar computes them. */
const filtered = (roster, query) => filterInstanceTree(roster, query);
/** The rows left when the named rows are collapsed, as the sidebar computes them (`section`: the
 * deployment a row is painted in, where the view has several). */
const collapsed = (roster, names, { section } = {}) => {
  const keys = new Set(names.map(name => collapseKey(WS, instanceId(row(roster, name)))));
  return roster.filter(i => instanceVisibleInTree(i, roster, keys, WS, false, { section }));
};
/** [group key, group label, each cluster's row names]. */
const shape = groups => groups.map(g => [g.key, g.label, g.clusters.map(c => c.instances.map(i => i.instance))]);
const LEAD = ["lead", "mid", "tip-one", "tip-two", "side"];

test("nothing hidden: the groups, their keys, the order and the rows are the ones the roster always drew", () => {
  const groups = rosterGroups(ROSTER, ROSTER);
  // Written out from the rule before #971, for this roster: with every row visible nothing differs.
  assert.deepEqual(groups.map(g => [g.key, g.label, g.clusters.map(c => [c.key, c.instances.map(i => [i.instance, i.depth])])]), [
    ["cluster:0:duo", "duo", [["duo", [["duo", 0], ["duo-kid", 1]]]]],
    ["cluster:1:lead", "lead", [["lead", [["lead", 0], ["mid", 1], ["tip-one", 2], ["tip-two", 2], ["side", 1]]]]],
    ["independent", "independent", [["solo", [["solo", 0]]], ["zed", [["zed", 0]]]]],
  ]);
  for (const group of groups) {
    assert.deepEqual(Object.keys(group), ["key", "label", "clusters"], "a group's shape");
    for (const cluster of group.clusters) {
      assert.deepEqual(Object.keys(cluster), ["key", "instances"], "a cluster's shape");
      for (const i of cluster.instances) assert.deepEqual(i, { ...row(ROSTER, i.instance), depth: i.depth }, "a row, with its depth");
    }
  }
  assert.deepEqual(rosterGroups([], []), []);
});

test("a cluster of two with its root collapsed: the root stays under the cluster's name, alone", () => {
  const groups = rosterGroups(ROSTER, collapsed(ROSTER, ["duo"]));
  assert.deepEqual(shape(groups), [
    ["cluster:0:duo", "duo", [["duo"]]],
    ["cluster:1:lead", "lead", [LEAD]],
    ["independent", "independent", [["solo"], ["zed"]]],
  ]);
  assert.equal(groups[0].clusters[0].instances.length, 1, "the header counts the one row shown");
});

test("a cluster of five, the filter matches one leaf: the leaf and its ancestors stay under the cluster's name", () => {
  assert.deepEqual(shape(rosterGroups(ROSTER, filtered(ROSTER, "tip-two"))), [["cluster:1:lead", "lead", [["lead", "mid", "tip-two"]]]]);
});

test("a cluster of five, the filter matches only its root: one row, under the cluster's name", () => {
  assert.deepEqual(shape(rosterGroups(ROSTER, filtered(ROSTER, "lead"))), [["cluster:1:lead", "lead", [["lead"]]]]);
});

test("a group with no visible row is not in the answer; a filter that matches nothing leaves no group", () => {
  const groups = rosterGroups(ROSTER, filtered(ROSTER, "duo"));
  assert.deepEqual(shape(groups), [["cluster:0:duo", "duo", [["duo", "duo-kid"]]]], "the lead group is absent, and so is independent");
  assert.ok(groups.every(g => g.clusters.every(c => c.instances.length > 0)), "no empty cluster is carried either");
  assert.deepEqual(filtered(ROSTER, "no-such-row"), []);
  assert.deepEqual(rosterGroups(ROSTER, filtered(ROSTER, "no-such-row")), []);
});

test("the independent group holds only one-member clusters, and is there only when one is visible", () => {
  // Next to a collapsed cluster of five: its root is not independent.
  assert.deepEqual(shape(rosterGroups(ROSTER, collapsed(ROSTER, ["lead", "duo"]))), [
    ["cluster:0:duo", "duo", [["duo"]]],
    ["cluster:1:lead", "lead", [["lead"]]],
    ["independent", "independent", [["solo"], ["zed"]]],
  ]);
  assert.deepEqual(shape(rosterGroups(ROSTER, filtered(ROSTER, "solo"))), [["independent", "independent", [["solo"]]]]);
  // Every one-member cluster filtered out: no independent group.
  const none = rosterGroups(ROSTER, filtered(ROSTER, "tip-one"));
  assert.deepEqual(shape(none), [["cluster:1:lead", "lead", [["lead", "mid", "tip-one"]]]]);
  assert.equal(none.some(g => g.key === "independent"), false);
});

test("a group's key does not depend on what is visible: hiding an earlier group shifts no key", () => {
  const before = rosterGroups(ROSTER, ROSTER), after = rosterGroups(ROSTER, filtered(ROSTER, "side"));
  assert.deepEqual(before.map(g => g.key), ["cluster:0:duo", "cluster:1:lead", "independent"]);
  assert.deepEqual(after.map(g => g.key), ["cluster:1:lead"], "the lead group keeps the key it has with nothing hidden");
  const keyOf = groups => new Map(groups.flatMap(g => g.clusters.flatMap(c => c.instances.map(i => [instanceId(i), g.key]))));
  for (const [id, key] of keyOf(after)) assert.equal(key, keyOf(before).get(id), "every row left is under the key it had");
  // An earlier group hidden by a collapse changes nothing either (a collapsed root is still shown).
  assert.deepEqual(rosterGroups(ROSTER, collapsed(ROSTER, ["duo"])).map(g => g.key), before.map(g => g.key));
});

test("two roots of one name (two agents roots): each group keeps its own key when a filter hides the first one's rows", () => {
  const run = (instance, root, extra = {}) => ({ instance, agent: "dev", home: `${root}/${instance}`, agentsRoot: root, running: true, ...extra });
  const roster = [
    run("lead", "/a"), run("child-a", "/a", { parentInstance: "lead" }),
    run("lead", "/b"), run("child-b", "/b", { parentInstance: "lead" }),
  ];
  assert.deepEqual(shape(rosterGroups(roster, roster)), [["cluster:0:lead", "lead", [["lead", "child-a"]]], ["cluster:1:lead", "lead", [["lead", "child-b"]]]]);
  const second = rosterGroups(roster, filtered(roster, "child-b"));
  assert.deepEqual(shape(second), [["cluster:1:lead", "lead", [["lead", "child-b"]]]]);
  assert.ok(second[0].clusters[0].instances.every(i => i.agentsRoot === "/b"), "the second root's own rows");
  assert.deepEqual(shape(rosterGroups(roster, filtered(roster, "child-a"))), [["cluster:0:lead", "lead", [["lead", "child-a"]]]]);
});

test("a pending spawn row that joins a cluster by its parent counts as a member", () => {
  const boss = at("boss"), pending = { instance: "boss-new", agent: "dev", agentsRoot: "/w", home: "/w/boss-new", parentInstance: "boss", pendingSpawn: { id: "job-1", pending: "spawning" } };
  assert.deepEqual(shape(rosterGroups([boss], [boss])), [["independent", "independent", [["boss"]]]], "alone, it is independent");
  const roster = [boss, pending];
  assert.deepEqual(shape(rosterGroups(roster, roster)), [["cluster:0:boss", "boss", [["boss", "boss-new"]]]]);
  assert.deepEqual(shape(rosterGroups(roster, collapsed(roster, ["boss"]))), [["cluster:0:boss", "boss", [["boss"]]]], "collapsed over its pending child, it keeps its group");
});

test("several deployments: a cluster's size is counted inside its section, and a collapse in one section moves nothing in another", () => {
  const D1 = { id: "/a", machine: "This Mac", path: "/a", label: "~/a", local: true, reachable: true, primary: true };
  const D2 = { id: "remote:altair:b", machine: "altair", path: "/b", label: "~/b", local: false, reachable: true, primary: false };
  const inD = (d, instance, extra = {}) => ({ instance, agent: "dev", home: `${d.path}/agents/dev/instances/${instance}`, agentsRoot: `${d.path}/agents`,
    running: true, deployment: { id: d.id }, ...extra });
  const roster = [
    inD(D1, "lead"), inD(D1, "kid", { parentInstance: "lead" }), inD(D1, "solo"),
    inD(D2, "chief"), inD(D2, "aide", { parentInstance: "chief" }), inD(D2, "lone"), inD(D2, "stray", { parentInstance: "lead" }),
  ];
  const sections = visible => rosterSections(roster, visible, [D1, D2], DESKTOP_TERMS).map(s => [s.deployment.id, shape(s.groups)]);
  const open = sections(roster);
  assert.deepEqual(open, [
    [D1.id, [["cluster:0:lead", "lead", [["lead", "kid"]]], ["independent", "independent", [["solo"]]]]],
    [D2.id, [["cluster:0:chief", "chief", [["chief", "aide"]]], ["independent", "independent", [["lone"], ["stray"]]]]],
  ], "a parent name in another deployment joins nothing: stray is a cluster of one in its own section");
  // stray's parent name resolves to D1's lead (a unique name), which is painted in another section.
  const shut = sections(collapsed(roster, ["lead"], { section: i => i.deployment.id }));
  assert.deepEqual(shut[0], [D1.id, [["cluster:0:lead", "lead", [["lead"]]], ["independent", "independent", [["solo"]]]]]);
  assert.deepEqual(shut[1], open[1], "the other section is untouched");
});

test("the arguments are not changed, and `links` still decides the relations", () => {
  const freeze = rows => Object.freeze(rows.map(i => Object.freeze({ ...i })));
  const all = freeze(ROSTER), visible = Object.freeze(filtered(all, "tip-two")), before = JSON.stringify([all, visible]);
  const options = Object.freeze({ links: Object.freeze(i => (i.parentInstance ? [i.parentInstance] : [])) });
  assert.deepEqual(shape(rosterGroups(all, visible, options)), [["cluster:1:lead", "lead", [["lead", "mid", "tip-two"]]]]);
  assert.deepEqual(shape(rosterGroups(all, all)), shape(rosterGroups(ROSTER, ROSTER)));
  assert.equal(JSON.stringify([all, visible]), before);
  // No relation at all: every row is a cluster of one, whatever is visible.
  assert.deepEqual(rosterGroups(all, visible, { links: () => [] }).map(g => g.key), ["independent"]);
});
