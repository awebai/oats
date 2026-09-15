import test from "node:test";
import assert from "node:assert/strict";
import { bytesIntegrity } from "../lib/portable-digest.mjs";
import { canonicalJson } from "../lib/portable-values.mjs";
import { parsePortableSoul } from "../lib/portable-soul.mjs";
import { parseWorkspaceDefinition } from "../lib/workspace-definition.mjs";
import { planSoftwareChoices } from "../lib/portable-composition.mjs";

const source = "git:https://github.com/example/souls.git", workspaceSource = "git:https://github.com/example/workspace.git";
const identity = { kind: "git-soul", repository: { kind: "canonical-remote", remote: source }, exportPath: "agents/expert" };
const tool = "git:github.com/example/tools@v1.0.0", otherTool = "git:github.com/example/other-tools@v1.0.0";
const provider = (capability, source = tool) => ({ capability, source });
function soul(fields = {}) {
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, name: "expert", ...fields }));
  return parsePortableSoul(bytes, { origin: { kind: "source", source, revision: "a".repeat(40), path: "agents/expert/soul.yaml", integrity: bytesIntegrity(bytes) } });
}
function workspace(fields = {}) {
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, name: "Workspace", ...fields }));
  return parseWorkspaceDefinition(bytes, { origin: { kind: "source", source: workspaceSource, revision: "b".repeat(40), path: "oats-workspace.yaml", integrity: bytesIntegrity(bytes) } });
}
const operator = (policy, extra = {}) => ({ policy, document: { kind: "operator", id: "prepare-input" }, ...extra });

test("hard source seeds override workspace fallbacks and repo relations keep their declaring snapshot", () => {
  const sourceSoul = soul({ requires: { capabilities: { "example.action": { source: "repo:packages/action", settings: { mode: "strict" } } } } });
  const defaults = workspace({ defaults: { capabilities: { "example.action": { source: "repo:packages/action", settings: { mode: "loose" } } } } });
  const input = { identity, soul: sourceSoul, workspace: defaults }, before = canonicalJson(input);
  const plan = planSoftwareChoices(input);
  assert.equal(plan.status, "resolved");
  assert.equal(plan.capabilities["example.action"].source.anchor.source, source);
  assert.equal(plan.choices["/settings/example.action/mode"].value, "strict");
  assert.equal(plan.choices["/capabilities/example.action"].considered[0].disposition, "overridden");
  assert.equal(canonicalJson(input), before);
  const wrongAnchor = planSoftwareChoices({ ...input, operator: operator({ capabilities: { "example.action": { source: "repo:packages/action" } } },
    { sourceContext: { source: workspaceSource, revision: "b".repeat(40) } }) });
  assert.equal(wrongAnchor.status, "conflict");
  assert.deepEqual(wrongAnchor.problems[0].origins.map((origin) => origin.kind), ["soul-requirement", "operator"]);
  assert.throws(() => planSoftwareChoices({ ...input, operator: operator({ capabilities: { "example.action": { source: "repo:packages/action" } } }) }), { code: "needs-configuration" });
});

test("one resolver applies soul and operator precedence while abstract requirements invent no provider", () => {
  const required = soul({ requires: { tasks: "any" } });
  assert.equal(planSoftwareChoices({ identity, soul: required }).status, "needs-configuration");
  const sourceSoul = soul({ requires: { tasks: "any" }, defaults: { tasks: provider("example.soul-tasks") },
    knowledge: { contract: "alternate.documents", version: 1, payload: { collection: "provider-defined" } } });
  const input = { identity, soul: sourceSoul, workspace: workspace({ defaults: { tasks: provider("example.workspace-tasks") } }) };
  const plan = planSoftwareChoices(input);
  assert.equal(plan.providers.tasks, "example.soul-tasks");
  assert.equal(plan.providerInputs.knowledge.payload.collection, "provider-defined");
  assert.equal(Object.hasOwn(plan, "dispatchable"), false);
  assert.equal(planSoftwareChoices({ ...input, operator: operator({ tasks: provider("example.operator-tasks") }) }).providers.tasks, "example.operator-tasks");
  assert.equal(planSoftwareChoices({ ...input, operator: operator({ tasks: "none" }) }).status, "conflict");
  assert.throws(() => planSoftwareChoices({ ...input, repositoryDefaults: {} }), { code: "invalid-declaration" });
});

test("adoption uses qualified identity rather than alias and contradictory aliases retain both origins", () => {
  const imported = (alias, tasks) => ({ source, soul: identity.exportPath, revision: "main", alias,
    adoption: { providers: { tasks }, teamAliases: { experts: "wider-experts" } } });
  const adopted = workspace({ imports: [imported("renamed-local-alias", provider("example.adopted-tasks"))] });
  const input = { identity, soul: soul({ requires: { tasks: "any" } }), workspace: adopted };
  const qualify = (parsed, qualifiedIdentity = identity) => parsed.imports.map((reference, index) => ({ identity: qualifiedIdentity,
    parsed: { reference, sources: parsed.sources }, origins: parsed.origins, pointer: `/imports/${index}` }));
  const plan = planSoftwareChoices({ ...input, adoptions: qualify(adopted) });
  assert.equal(plan.providers.tasks, "example.adopted-tasks");
  assert.equal(plan.choices["/layers/tasks"].selectedBy.kind, "import-adoption");
  assert.equal(Object.hasOwn(plan, "enrolled"), false);
  const foreign = { ...identity, repository: { kind: "canonical-remote", remote: workspaceSource } };
  assert.equal(planSoftwareChoices({ ...input, adoptions: qualify(adopted, foreign) }).status, "needs-configuration");
  const conflicting = workspace({ imports: [imported("first-alias", provider("example.one")), imported("second-alias", provider("example.two"))] });
  const result = planSoftwareChoices({ ...input, workspace: conflicting, adoptions: qualify(conflicting) });
  assert.equal(result.status, "conflict");
  assert.deepEqual(result.problems[0].origins.map((origin) => origin.pointer), ["/imports/0/adoption/providers/tasks", "/imports/1/adoption/providers/tasks"]);
});

test("rejected sources cannot contribute active settings, while compatible-source fallbacks still can", () => {
  const sourceSoul = soul({ requires: { capabilities: { "example.action": { source: tool } } } });
  const plan = (selectedSource) => planSoftwareChoices({ identity, soul: sourceSoul, workspace: workspace({ defaults: {
    capabilities: { "example.action": { source: selectedSource, settings: { destination: "workspace-destination" } } },
  } }) });
  const rejected = plan(otherTool), compatible = plan(tool);
  assert.equal(rejected.status, "resolved");
  assert.equal(Object.hasOwn(rejected.settings["example.action"], "destination"), false);
  assert.equal(rejected.excludedSettings[0].origin.document.source, workspaceSource);
  assert.equal(rejected.excludedSettings[0].reason, "owning-source-overridden");
  assert.equal(compatible.status, "resolved");
  const key = compatible.settings["example.action"].destination;
  assert.equal(compatible.choices[key].value, "workspace-destination");
});

test("one composition cannot select two sources for the same capability via different policy fields", () => {
  const plan = planSoftwareChoices({ identity, soul: soul({ requires: { capabilities: { "example.action": { source: tool } } },
    defaults: { tasks: provider("example.action", otherTool) } }) });
  assert.equal(plan.status, "conflict");
  assert.equal(plan.problems[0].origins.length, 2);
});
