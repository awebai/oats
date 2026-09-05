import test from "node:test";
import assert from "node:assert/strict";
import { remoteWorkspace, remotePanel, remoteAgents, unavailableGroups, spawnedWorkspace } from "../server/remote-roster.mjs";

const group = {
  id: "host-abc", server: "host", label: "Build server", registrationPresent: true,
  target: { workspace: "/remote/project" }, probe: { ok: true }, agentsRoot: "/remote/project/agents",
  souls: [{ name: "dev", runtime: "codex" }],
  instances: [{ instance: "dev-one", agent: "dev", home: "/remote/home", running: true, savedRoute: true }],
};

test("remote roster projects server identity and souls without local path resolution", () => {
  assert.equal(remoteWorkspace(group).id, "remote:host-abc");
  const panel = remotePanel(group);
  assert.equal(panel.instances[0].server, "host");
  assert.equal(panel.instances[0].home, "/remote/home");
  assert.equal(panel.instances[0].agentsRoot, "/remote/project/agents");
  assert.equal(panel.running, 1);
  assert.equal(remoteAgents(group)[0].server, "host");
  assert.equal(remoteAgents(group)[0].runtime, "codex");
});

test("spawn handoff matches the actual remote target, preserving old route groups", () => {
  const old = { ...group, id: "old", registrationPresent: false, target: { sshHost: "old", workspace: "/old" } };
  const current = { ...group, id: "current", target: { sshHost: "new", workspace: "/new" } };
  assert.equal(spawnedWorkspace([old, current], { server: "host", target: current.target }), "remote:current");
  assert.equal(spawnedWorkspace([old, current], { server: "host", target: old.target }), undefined);
  assert.equal(spawnedWorkspace([old, current], { server: "host" }), undefined);
});

test("removed registration keeps saved instances while unreachable means unknown, not stopped", () => {
  const removed = { ...group, registrationPresent: false };
  assert.equal(remotePanel(removed).instances.length, 1);
  assert.deepEqual(remoteAgents(removed), []);
  const [unreachable] = unavailableGroups([removed], { code: "E_SSH", message: "Connection refused" });
  const panel = remotePanel(unreachable);
  assert.equal(panel.instances[0].running, null);
  assert.equal(panel.instances[0].savedRoute, true);
  assert.equal(panel.instances[0].runtimeError, "Connection refused");
  assert.equal(panel.error, "Connection refused");
});
