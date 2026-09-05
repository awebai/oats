import test from "node:test";
import assert from "node:assert/strict";
import { instanceId, terminalKey, findRosterInstance, resolveLinkId, clusterInstances } from "../renderer/instance-tree.mjs";
import { instanceApiPath } from "../renderer/views/common.mjs";

const local = { instance: "dev-one", home: "/work/agents/dev/instances/dev-one", agentsRoot: "/work/agents" };
const first = { ...local, server: "first" };
const second = { ...local, server: "second" };
const roster = [local, first, second];

test("identical paths on different servers retain distinct rows and terminals", () => {
  assert.equal(new Set(roster.map(instanceId)).size, 3);
  assert.equal(new Set(roster.map((i) => terminalKey("team", i))).size, 3);
  assert.equal(clusterInstances(roster).flatMap((c) => c.instances).length, 3);
  for (const ref of roster) assert.equal(findRosterInstance(roster, { ...ref }), ref);
  assert.equal(findRosterInstance(roster, local.instance), null);
  assert.equal(findRosterInstance([first], local), null, "local path must not resolve remotely");
  assert.equal(findRosterInstance(roster, { ...first, server: "missing" }), null);
});

test("relations never connect agents on different servers", () => {
  const from = { instance: "child", server: "first", agentsRoot: local.agentsRoot };
  assert.equal(resolveLinkId(from, local.instance, new Map([[local.instance, roster]])), instanceId(first));
  assert.equal(resolveLinkId(from, local.instance, new Map([[local.instance, [second]]])), null);
});

test("remote instance API references preserve the server and canonical home", () => {
  const url = new URL(instanceApiPath("harvest", first), "http://localhost");
  assert.equal(url.searchParams.get("server"), "first");
  assert.equal(url.searchParams.get("home"), first.home);
  assert.equal(new URL(instanceApiPath("harvest", local), url).searchParams.has("server"), false);
});
