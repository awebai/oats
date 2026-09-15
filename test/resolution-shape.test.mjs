import test from "node:test";
import assert from "node:assert/strict";
import { TREE_FORMAT, PACKAGE_FORMAT } from "../lib/portable-digest.mjs";
import { resolveChoices } from "../lib/portable-choices.mjs";
import { validateArtifactSet, validateResolutionShape } from "../lib/resolution-shape.mjs";

// Syntactic fixture identities only; these tests do not certify retained files.
const digest = (format, letter = "a") => ({ format, value: `sha256-${letter.repeat(64)}` });
const origin = { kind: "operator", document: { kind: "operator", id: "fixture-input" }, pointer: "/source" };
function record() {
  const repository = { kind: "provider-repository", provider: "github", host: "github.com", id: "123" };
  const identity = { kind: "git-soul", repository, exportPath: "agents/expert" };
  return {
    schemaVersion: 1, capture: "prepared",
    subject: { kind: "persistent", soul: { identity,
      revision: { identity: repository, remote: "git:https://github.com/example/experts.git", selector: "main", commit: "a".repeat(40), provenance: [origin] },
      alias: "expert", sourceArtifact: { kind: "soul", identity, integrity: digest(TREE_FORMAT) },
      definition: "agents/expert/soul.yaml", projection: { roots: ["agents/expert"] },
    } },
    context: { kind: "standalone", key: null },
    artifacts: { schemaVersion: 1, packages: {}, capabilities: {} },
    choices: {}, bindings: {}, messagingChoice: { schemaVersion: 1, enabled: false },
    resources: {}, resourceBundles: [], helpers: {}, evidence: [],
    dispatch: { schemaVersion: 1, providerManifests: {}, settingsChoices: {}, launch: null, runtimePackages: [], hostRequirements: [], workTargetInputs: {} },
  };
}

test("complete record shape keeps source identity/revision/alias distinct without claiming input verification", () => {
  const value = record();
  assert.equal(validateResolutionShape(value), value);
  assert.equal(Object.hasOwn(value, "dispatchable"), false);
  for (const capture of ["partial", "unknown"]) assert.throws(() => validateResolutionShape({ ...value, capture }), { code: "resolution-incomplete" });
  assert.throws(() => validateResolutionShape({ ...value, capture: "reconstructed" }), { code: "resolution-incomplete" });
  value.subject.soul.sourceArtifact = structuredClone(value.subject.soul.sourceArtifact);
  value.subject.soul.sourceArtifact.identity.repository.id = "other";
  assert.throws(() => validateResolutionShape(value), { code: "invalid-declaration" });
});

test("a canonical source identity must match its observed remote", () => {
  const value = record(), source = value.subject.soul;
  const repository = { kind: "canonical-remote", remote: "git:https://github.com/example/source-a.git" };
  source.identity.repository = repository;
  source.sourceArtifact.identity = structuredClone(source.identity);
  source.revision.identity = structuredClone(repository);
  source.revision.remote = repository.remote;
  assert.equal(validateResolutionShape(value), value);
  source.revision.remote = "git:https://github.com/example/source-b.git";
  assert.throws(() => validateResolutionShape(value), { code: "invalid-declaration" });
});

test("captured choices replay through the same resolver and cannot claim a different selected value", () => {
  const value = record();
  value.choices = resolveChoices({ candidates: [{ key: "/settings/example/target", kind: "operator", value: "one", origin }] }).choices;
  validateResolutionShape(value);
  value.choices["/settings/example/target"].value = "other";
  assert.throws(() => validateResolutionShape(value), { code: "resolution-incomplete" });
  const foreign = { kind: "resource", integrity: digest(TREE_FORMAT, "b") };
  assert.throws(() => validateResolutionShape({ ...record(), resources: { unexpected: { owner: foreign, path: ".", kind: "directory" } } }), { code: "invalid-declaration" });
});

test("artifact sets validate embedded package edges and reject cycles or missing package origins", () => {
  const packageRow = (dependencies) => ({ source: "git:https://github.com/example/pkg.git@main", path: "oats-package", version: "1.0.0", commit: "b".repeat(40), integrity: digest(PACKAGE_FORMAT), dependencies });
  const set = { schemaVersion: 1, packages: { "example.a": packageRow(["example.b"]), "example.b": packageRow([]) }, capabilities: {} };
  validateArtifactSet(set);
  set.packages["example.b"].dependencies = ["example.a"];
  assert.throws(() => validateArtifactSet(set), { code: "invalid-declaration" });
  set.packages["example.b"].dependencies = ["missing"];
  assert.throws(() => validateArtifactSet(set), { code: "invalid-declaration" });
});

test("provider-neutral bindings reference selected software and credential lookups, not inline credentials or enrollment", () => {
  const value = record(), artifact = { kind: "capability", capability: "example.tasks", integrity: digest(TREE_FORMAT, "c") };
  value.artifacts.capabilities["example.tasks"] = { version: "1.0.0", artifact,
    origin: { kind: "local-capability", source: "path:/operator/tasks", authoredAs: "path", witness: origin } };
  value.resources.manifest = { owner: artifact, path: "oats.json", kind: "manifest" };
  value.dispatch.providerManifests["example.tasks"] = "manifest";
  value.choices = resolveChoices({ candidates: [{ key: "/layers/tasks", kind: "operator", value: { capability: "example.tasks" }, origin }] }).choices;
  value.bindings.tasks = { schemaVersion: 1, capability: "example.tasks", payloadContract: "alternate.tasks", payloadVersion: 1,
    payload: { collection: "opaque" }, credentialRefs: { api: { kind: "env", name: "TASK_TOKEN" } }, provenance: [origin] };
  validateResolutionShape(value);
  value.bindings.tasks.credentialRefs.api.value = "must not be a literal credential field";
  assert.throws(() => validateResolutionShape(value), { code: "invalid-declaration" });
  const messaging = record(); messaging.messagingChoice = { schemaVersion: 1, enabled: false, privateKey: {} };
  assert.throws(() => validateResolutionShape(messaging), { code: "invalid-declaration" });
});
