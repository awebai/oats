import test from "node:test";
import assert from "node:assert/strict";
import { bytesIntegrity } from "../lib/portable-digest.mjs";
import { createWorkspaceDiscovery } from "../lib/workspace-discovery.mjs";
import { planSoftwareChoices } from "../lib/portable-composition.mjs";
import { oatsError } from "../lib/errors.mjs";

const W = "git:https://example.invalid/workspace.git", M = "git:https://example.invalid/member.git", F = "git:https://example.invalid/fork.git", P = "git:https://example.invalid/publisher-context.git";
const origin = { kind: "operator", document: { kind: "operator", id: "discovery-input" }, pointer: "/import" };
function fixture() {
  const identity = (id) => ({ kind: "provider-repository", provider: "fixture", host: "example.invalid", id });
  const member = { schemaVersion: 1, workspace: { source: W, revision: "workspace-channel" }, exports: { souls: [{ path: "agents/expert", definition: "agents/expert/soul/soul.yaml" }] } };
  const repos = new Map([
    [W, { identity: identity("workspace"), branch: "workspace-channel", commit: "a".repeat(40), files: { "oats-workspace.yaml": {
      schemaVersion: 1, name: "Workspace", members: [{ source: M, revision: "member-channel" }],
    } } }],
    [M, { identity: identity("member"), branch: "member-channel", commit: "b".repeat(40), files: { "oats.yaml": member,
      "agents/expert/soul/soul.yaml": { schemaVersion: 1, name: "expert", requires: { capabilities: { "example.tools": { source: "repo:packages/tools" } } }, resources: ["references", "agents/expert/soul/nested"] },
    } }],
    [F, { identity: identity("fork"), branch: "member-channel", commit: "b".repeat(40), files: { "oats.yaml": structuredClone(member) } }],
  ]);
  const calls = [], handles = new WeakMap();
  const get = (source) => { if (!repos.has(source)) throw oatsError("source-unavailable", "fixture repository unavailable"); return repos.get(source); };
  // Hosting facts are supplied by the adapter fixture, never read from repository
  // YAML. Native Git behavior has its own three integration tests.
  const transaction = {
    identify(source) { calls.push({ kind: "identify", source }); return { source, identity: get(source).identity, accessContextKey: "fixture-access" }; },
    observe(source, options) {
      const repo = get(source), selector = options.revision ?? repo.branch;
      calls.push({ kind: "observe", source, selector });
      const value = { schemaVersion: 1, source: { identity: repo.identity, remote: source, selector,
        commit: selector === "old-workspace" ? "e".repeat(40) : repo.commit, provenance: [options.origin] }, accessContextKey: "fixture-access" };
      handles.set(value, repo); return value;
    },
    readFile(observation, path, { optional = false } = {}) {
      const repo = handles.get(observation);
      if (!repo) throw oatsError("invalid-source", "unissued observation");
      calls.push({ kind: "read", source: observation.source.remote, path });
      if (!Object.hasOwn(repo.files, path)) { if (optional) return null; throw oatsError("export-not-found", "fixture descriptor absent"); }
      const bytes = Buffer.from(JSON.stringify(repo.files[path]));
      return { bytes, origin: { kind: "source", source: observation.source.remote, revision: observation.source.commit, path, integrity: bytesIntegrity(bytes) } };
    },
  };
  const discovery = createWorkspaceDiscovery(transaction);
  return { discovery, repos, calls, workspace: () => discovery.readWorkspace({ source: W, origin }) };
}

test("membership requires an observed allowlist and reciprocal backlink at their declared revisions", () => {
  const f = fixture(), workspace = f.workspace();
  const member = f.discovery.checkMember(workspace, { source: M, origin });
  assert.equal(member.status, "eligible");
  assert.equal(member.workspace.revision, "a".repeat(40)); assert.equal(member.member.revision, "b".repeat(40));
  assert.deepEqual(member.evidence.map((entry) => entry.kind), ["workspace-admission", "member-backlink"]);
  assert.ok(f.calls.some((call) => call.kind === "observe" && call.source === M && call.selector === "member-channel"));
  assert.equal(f.discovery.checkMember(workspace, { source: F, origin }).status, "not-member", "copied backlink and even matching commit do not turn a fork into an admitted identity");
  assert.throws(() => workspace.parsed.declaration.members.push({ source: F }), TypeError);
  assert.throws(() => f.discovery.checkMember(structuredClone(workspace), { source: M, origin }), { code: "invalid-source" });
  assert.throws(() => f.discovery.checkMember(workspace, { source: M, revision: "arbitrary", origin }), { code: "invalid-declaration" });
});

test("missing, mismatched and stale backlinks remain explicit rather than silently admitting a member", () => {
  const missing = fixture(); delete missing.repos.get(M).files["oats.yaml"].workspace;
  assert.equal(missing.discovery.checkMember(missing.workspace(), { source: M, origin }).status, "not-member");
  const wrong = fixture(); wrong.repos.get(M).files["oats.yaml"].workspace = { source: F };
  assert.equal(wrong.discovery.checkMember(wrong.workspace(), { source: M, origin }).status, "not-member");
  const stale = fixture(); stale.repos.get(M).files["oats.yaml"].workspace.revision = "old-workspace";
  assert.equal(stale.discovery.checkMember(stale.workspace(), { source: M, origin }).status, "stale");
});

test("public soul imports keep qualified source, exported definition and adoption without publisher membership", () => {
  const f = fixture(); f.repos.get(M).files["oats.yaml"].workspace = { source: P };
  const reference = { source: M, soul: "agents/expert", revision: "member-channel", alias: "adopter-name",
    adoption: { providers: { tasks: { capability: "example.tasks", source: "git:github.com/example/tasks@v1" } } } };
  const imported = f.discovery.importSoul(reference, { origin });
  assert.equal(imported.identity.repository.id, "member"); assert.equal(imported.identity.exportPath, "agents/expert");
  assert.equal(imported.reference.alias, "adopter-name"); assert.equal(imported.definition, "agents/expert/soul/soul.yaml");
  assert.deepEqual(imported.roots, ["agents/expert", "packages/tools", "references"]);
  assert.equal(f.calls.some((call) => call.source === W || call.source === P), false, "publisher workspace is not fetched or adopted");
  const plan = planSoftwareChoices({ identity: imported.identity, soul: imported.soul, adoptions: [imported.adoption] });
  assert.equal(plan.providers.tasks, "example.tasks");
  assert.equal(Object.hasOwn(imported, "enrolled"), false);
  const renamed = f.discovery.importSoul({ ...reference, alias: "different-name" }, { origin });
  assert.deepEqual(renamed.identity, imported.identity);
});
