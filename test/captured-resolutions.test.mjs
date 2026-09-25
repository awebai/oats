import test from "node:test";
import assert from "node:assert/strict";
import { validateWire } from "./helpers/portable-schema-check.mjs";
import { canonicalJson } from "../lib/portable-values.mjs";
import { captureManifestSettings } from "../lib/manifest-settings.mjs";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { approveCapturedCapability, artifactApprovalKey, inspectCapturedApprovals, readApprovalLedger, validateApprovalLedger } from "../lib/artifact-approvals.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bytesIntegrity, jsonIntegrity, PACKAGE_FORMAT, treeIntegrity } from "../lib/portable-digest.mjs";
import { loadCapturedDispatch } from "../lib/core.mjs";
// The captured path's store writer (deleted with the captured path in (e)).
import { acquirePackage, installedCapabilityDir, updatePackage } from "../lib/captured-store-writer.mjs";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parsePortableSoul } from "../lib/portable-soul.mjs";
import { resolveChoices } from "../lib/portable-choices.mjs";
import { settingChoiceKey, soulConstraints } from "../lib/soul-constraints.mjs";
import { artifactSetKey3, writeLock3 } from "../lib/portable-lock.mjs";
import { retainPortableArtifact } from "../lib/portable-artifacts.mjs";
import { commitCapturedResolution, readCapturedResolution, verifyResolutionInputs } from "../lib/captured-resolutions.mjs";
import { captureHelperInjectionChoices } from "../lib/helper-injection-policy.mjs";

const origin = { kind: "operator", document: { kind: "operator", id: "fixture-input" }, pointer: "/source" };
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oats-captured-resolution-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const scope = join(root, "deployment"), source = join(root, "soul"), cap = join(root, "capability");
  for (const path of [scope, source, cap]) mkdirSync(path);
  writeFileSync(join(source, "soul.yaml"), `schemaVersion: 1\nname: example-expert\nrequires:\n  capabilities:\n    example.action:\n      source: path:${cap}\n      settings:\n        mode: strict\n`);
  writeFileSync(join(source, "AGENTS.md"), "Expert instructions\n");
  symlinkSync("AGENTS.md", join(source, "CLAUDE.md"));
  const identity = { kind: "local-soul", source: `path:${source}`, exportPath: "." };
  const soulArtifact = { kind: "soul", identity, integrity: treeIntegrity(source) };
  retainPortableArtifact(scope, source, soulArtifact);
  const definitionBytes = readFileSync(join(source, "soul.yaml"));
  const sourceDocument = { kind: "source", source: `path:${source}`, revision: "local", path: "soul.yaml", integrity: bytesIntegrity(definitionBytes) };
  const parsed = parsePortableSoul(definitionBytes, { origin: sourceDocument, localBase: source, allowLocalPaths: true });
  const choices = resolveChoices({ requirements: soulConstraints(parsed) }).choices;
  const build = (marker) => {
    writeFileSync(join(cap, "oats.json"), JSON.stringify({ capability: "example.action", version: "1.0.0", description: "Fixture action", command: "example-action", commands: { show: "marker.mjs" } }));
    writeFileSync(join(cap, "marker.mjs"), `console.log(${JSON.stringify(marker)});\n`);
    const artifact = { kind: "capability", capability: "example.action", integrity: treeIntegrity(cap) };
    retainPortableArtifact(scope, cap, artifact);
    return {
      schemaVersion: 1, capture: "prepared",
      subject: { kind: "persistent", soul: { identity, alias: "expert", sourceArtifact: soulArtifact,
        revision: { kind: "local", source: `path:${source}`, integrity: soulArtifact.integrity, provenance: [origin] },
        definition: "soul.yaml", projection: { roots: ["."] } } },
      context: { kind: "standalone", key: null },
      artifacts: { schemaVersion: 1, packages: {}, capabilities: { "example.action": {
        version: "1.0.0", artifact, origin: { kind: "local-capability", source: `path:${cap}`, authoredAs: "path", witness: origin },
      } } },
      choices: structuredClone(choices), bindings: {}, messagingChoice: { schemaVersion: 1, enabled: false },
      resources: { manifest: { owner: artifact, path: "oats.json", kind: "manifest" }, command: { owner: artifact, path: "marker.mjs", kind: "file" } },
      resourceBundles: [], helpers: {}, evidence: [],
      dispatch: { schemaVersion: 1, providerManifests: { "example.action": "manifest" }, settingsChoices: { "example.action": { mode: settingChoiceKey("example.action", "mode") } }, launch: null, runtimePackages: [], hostRequirements: [], workTargetInputs: {} },
    };
  };
  return { root, scope, source, cap, build };
}

test("captured A/B records retain exact source and resources after original sources and ambient selection state disappear", (t) => {
  const f = fixture(t), a = f.build("A"), aRef = commitCapturedResolution(f.scope, a);
  validateWire("CapturedResolution", readCapturedResolution(f.scope, aRef));
  assert.deepEqual(commitCapturedResolution(f.scope, a), aRef);
  const b = f.build("B"), bRef = commitCapturedResolution(f.scope, b);
  assert.notEqual(aRef.id, bRef.id);
  rmSync(f.source, { recursive: true }); rmSync(f.cap, { recursive: true });
  writeFileSync(join(f.scope, "oats-lock.json"), "poisoned current lock");
  writeFileSync(join(f.scope, "oats-config.yaml"), "poisoned current config");
  for (const [ref, marker] of [[aRef, "A"], [bRef, "B"]]) {
    const verified = verifyResolutionInputs(f.scope, ref);
    assert.equal(readFileSync(verified.resources.get("command"), "utf8"), `console.log("${marker}");\n`);
    assert.equal(readCapturedResolution(f.scope, ref).subject.soul.alias, "expert");
    assert.equal(Object.hasOwn(verified, "approved"), false, "input verification grants no execution authority");
  }
});

test("exact command loading uses retained A/B and current approvals, never poisoned ambient selection", (t) => {
  const f = fixture(t), a = commitCapturedResolution(f.scope, f.build("A")), b = commitCapturedResolution(f.scope, f.build("B"));
  rmSync(f.source, { recursive: true }); rmSync(f.cap, { recursive: true });
  writeFileSync(join(f.scope, "oats-lock.json"), "poisoned current lock");
  writeFileSync(join(f.scope, "oats-config.yaml"), "poisoned current config");
  const load = (resolution) => loadCapturedDispatch({ deployment: f.scope, resolution, action: { kind: "command", namespace: "example-action", name: "show" } });
  assert.throws(() => load(a), { code: "approval-required" });
  approveCapturedCapability(f.scope, a, "example.action", origin);
  const selectedA = load(a);
  assert.equal(execFileSync(process.execPath, [selectedA.executable.file, ...selectedA.executable.args], { encoding: "utf8" }).trim(), "A");
  assert.throws(() => load(b), { code: "approval-required" });
  approveCapturedCapability(f.scope, b, "example.action", origin);
  const selectedB = load(b);
  assert.equal(execFileSync(process.execPath, [selectedB.executable.file, ...selectedB.executable.args], { encoding: "utf8" }).trim(), "B");
  assert.equal(load(a).executable.file, selectedA.executable.file);
  assert.throws(() => loadCapturedDispatch({ deployment: f.scope, resolution: a, action: { kind: "launch" } }), { code: "unsupported-action" });
});

test("prospective exact-artifact approval precedes provider compilation without fabricating a resolution", (t) => {
  const f = fixture(t), record = f.build("A"), key = artifactSetKey3(record.artifacts);
  writeLock3(f.scope, null, { lockfileVersion: 3, artifactSets: { [key]: record.artifacts }, selections: {} });
  rmSync(f.source, { recursive: true }); rmSync(f.cap, { recursive: true });
  const cli = fileURLToPath(new URL("../bin/oats.mjs", import.meta.url));
  const args = [cli, "trust", "example.action", "--deployment", f.scope, "--artifact-set", key, "--json"];
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).result.status, "approved");
  assert.equal(existsSync(join(f.scope, ".agents/resolutions")), false, "approval never publishes a partial resolution");
  const resolution = commitCapturedResolution(f.scope, record);
  assert.equal(loadCapturedDispatch({ deployment: f.scope, resolution, action: { kind: "command", capability: "example.action", name: "show" } }).capability.id, "example.action");
  const wrong = spawnSync(process.execPath, [...args.slice(0, 2), "example.other", ...args.slice(3)], { encoding: "utf8" });
  assert.equal(wrong.status, 1); assert.equal(JSON.parse(wrong.stdout).error.code, "invalid-approval");
});

test("public captured selectors inspect, approve and execute without ambient identity or source state", (t) => {
  const f = fixture(t), record = f.build("A"), cli = fileURLToPath(new URL("../bin/oats.mjs", import.meta.url));
  writeFileSync(join(f.cap, "marker.mjs"), 'console.log(JSON.stringify({marker:"A", resolution:process.env.OATS_RESOLUTION, home:process.env.OATS_INSTANCE_HOME ?? null, args:process.argv.slice(2)}));\n');
  const artifact = { kind: "capability", capability: "example.action", integrity: treeIntegrity(f.cap) };
  retainPortableArtifact(f.scope, f.cap, artifact); record.artifacts.capabilities["example.action"].artifact = artifact;
  for (const resource of Object.values(record.resources)) resource.owner = artifact;
  const ref = commitCapturedResolution(f.scope, record);
  rmSync(f.source, { recursive: true }); rmSync(f.cap, { recursive: true });
  writeFileSync(join(f.scope, "oats-config.yaml"), "poisoned current config");
  const selectors = ["--deployment", f.scope, "--resolution", ref.id];
  const env = { ...process.env, OATS_INSTANCE_HOME: "/unrelated-parent", PI_AGENT_HOME: "/unrelated-parent", OATS_DEPLOYMENT: "/poisoned", OATS_RESOLUTION: "poisoned" };
  const call = (...args) => spawnSync(process.execPath, [cli, ...selectors, ...args], { env, encoding: "utf8" });
  const inspect = call("inspect", "--json"); assert.equal(inspect.status, 0, inspect.stderr);
  assert.equal(JSON.parse(inspect.stdout).result.capabilities[0].approval, "approval-required");
  const denied = call("example-action", "show", "--json"); assert.equal(denied.status, 1);
  assert.equal(JSON.parse(denied.stdout).error.code, "approval-required");
  const approval = call("trust", "example.action", "--json"); assert.equal(approval.status, 0, approval.stderr);
  const result = call("example-action", "show", "--", "--custom", "alpha"); assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { marker: "A", resolution: ref.id, home: null, args: ["--custom", "alpha"] });
  const refused = call("spawn", "anything", "--json"); assert.equal(refused.status, 1);
  assert.equal(JSON.parse(refused.stdout).error.code, "E_BAD_ARGS");
  const inherited = spawnSync(process.execPath, [cli, "example-action", "show"], { encoding: "utf8", env: { ...env, OATS_DEPLOYMENT: f.scope, OATS_RESOLUTION: ref.id } });
  assert.equal(inherited.status, 0, inherited.stderr); assert.equal(JSON.parse(inherited.stdout).marker, "A");
});

test("captured instructions preserve explicit order and resources after source deletion", (t) => {
  const f = fixture(t), record = f.build("A"), input = join(f.root, "instructions");
  mkdirSync(join(input, "procedure"), { recursive: true });
  writeFileSync(join(input, "first.md"), "First block\n");
  writeFileSync(join(input, "second.md"), "Second block\n");
  writeFileSync(join(input, "procedure/SKILL.md"), "# Procedure\n");
  const bundle = { kind: "resource", integrity: treeIntegrity(input) };
  retainPortableArtifact(f.scope, input, bundle); record.resourceBundles = [bundle];
  Object.assign(record.resources, {
    body: { owner: record.subject.soul.sourceArtifact, path: "AGENTS.md", kind: "file" },
    first: { owner: bundle, path: "first.md", kind: "file" }, second: { owner: bundle, path: "second.md", kind: "file" },
    procedure: { owner: bundle, path: "procedure", kind: "skill" },
  });
  record.dispatch.composition = { schemaVersion: 1, mode: "checkout", body: "body",
    blocks: [{ source: "config:first", resource: "first" }, { source: "config:second", resource: "second" }],
    skills: [{ name: "procedure", resource: "procedure" }], omissions: [] };
  const resolution = commitCapturedResolution(f.scope, record);
  validateWire("CapturedResolution", readCapturedResolution(f.scope, resolution));
  rmSync(input, { recursive: true }); rmSync(f.source, { recursive: true }); rmSync(f.cap, { recursive: true });
  const { composition } = loadCapturedDispatch({ deployment: f.scope, resolution, action: { kind: "compose" } });
  assert.ok(composition.text.startsWith("Expert instructions\n"));
  assert.ok(composition.text.indexOf("First block") < composition.text.indexOf("Second block"));
  assert.equal(readFileSync(join(composition.skills[0].path, "SKILL.md"), "utf8"), "# Procedure\n");
  const wrong = structuredClone(record); wrong.dispatch.composition.body = "first";
  assert.throws(() => commitCapturedResolution(f.scope, wrong), { code: "invalid-declaration" });
  record.dispatch.launch = { version: 1, runtime: "pi", executable: process.execPath, args: [], env: { OATS_INSTANCE: "forged" }, hooks: {} };
  const unsafe = commitCapturedResolution(f.scope, record);
  assert.throws(() => loadCapturedDispatch({ deployment: f.scope, resolution: unsafe, action: { kind: "inspect" } }), { code: "E_LAUNCH_CONFIG_INVALID" });
});

test("a captured helper is a separate exported helper record and survives removal of its original source", (t) => {
  const f = fixture(t), parent = f.build("A");
  const directory = join(f.cap, "agents/worker");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "soul.yaml"), "name: worker\nwork: directory\n");
  writeFileSync(join(directory, "AGENTS.md"), "Worker instructions\n");
  symlinkSync("AGENTS.md", join(directory, "CLAUDE.md"));
  const manifest = JSON.parse(readFileSync(join(f.cap, "oats.json"), "utf8"));
  manifest.agents = ["agents/worker"]; writeFileSync(join(f.cap, "oats.json"), JSON.stringify(manifest));
  const artifact = { kind: "capability", capability: "example.action", integrity: treeIntegrity(f.cap) };
  retainPortableArtifact(f.scope, f.cap, artifact);
  parent.artifacts.capabilities["example.action"].artifact = artifact;
  for (const resource of Object.values(parent.resources)) resource.owner = artifact;
  const helper = structuredClone(parent);
  helper.subject = { kind: "helper", provider: artifact, name: "worker", definition: { owner: artifact, path: "agents/worker/soul.yaml", kind: "file" } };
  const helperRef = commitCapturedResolution(f.scope, helper);
  parent.helpers.worker = helperRef;
  const parentRef = commitCapturedResolution(f.scope, parent);
  rmSync(f.source, { recursive: true }); rmSync(f.cap, { recursive: true });
  assert.equal(verifyResolutionInputs(f.scope, parentRef).records.get(helperRef.id).record.subject.kind, "helper");
  const wrong = structuredClone(helper); wrong.subject.definition.path = "marker.mjs";
  assert.throws(() => commitCapturedResolution(f.scope, wrong), { code: "resolution-incomplete" });
  const wrongKind = structuredClone(parent); wrongKind.helpers.worker = parentRef;
  assert.throws(() => commitCapturedResolution(f.scope, wrongKind), { code: "invalid-resolution" });
});

test("storage refuses new legacy helper omissions while literal old records remain readable and reusable", (t) => {
  const f = fixture(t), draft = f.build("legacy-evidence"), id = "example.action";
  const directory = join(f.cap, "agents/worker"); mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "soul.yaml"), "name: worker\nwork: directory\n");
  writeFileSync(join(directory, "AGENTS.md"), "Canonical worker body\n"); symlinkSync("AGENTS.md", join(directory, "CLAUDE.md"));
  writeFileSync(join(f.cap, "inject.md"), "Legacy contribution\n");
  const manifest = JSON.parse(readFileSync(join(f.cap, "oats.json"))); manifest.inject = "inject.md"; manifest.agents = ["agents/worker"];
  writeFileSync(join(f.cap, "oats.json"), JSON.stringify(manifest));
  const artifact = { kind: "capability", capability: id, integrity: treeIntegrity(f.cap) }; retainPortableArtifact(f.scope, f.cap, artifact);
  draft.artifacts.capabilities[id].artifact = artifact;
  for (const resource of Object.values(draft.resources)) resource.owner = artifact;
  draft.subject = { kind: "helper", provider: artifact, name: "worker", definition: { owner: artifact, path: "agents/worker/soul.yaml", kind: "file" } };
  draft.resources.body = { owner: artifact, path: "agents/worker/AGENTS.md", kind: "file" };
  draft.dispatch.composition = { schemaVersion: 1, mode: "directory", body: "body", blocks: [], skills: [], omissions: [{ source: `capability:${id}`, reason: "helper-knowledge" }] };
  const reference = { schemaVersion: 1, id: jsonIntegrity(draft).value }, root = join(f.scope, ".agents/resolutions"), path = join(root, `${reference.id}.json`);
  // Direct storage caller bypasses the compiler: publication still refuses.
  assert.throws(() => commitCapturedResolution(f.scope, draft), { code: "needs-configuration" });
  assert.equal(existsSync(root), false, "refused legacy mint creates no store/staging");
  // Literal historical fixture bytes only, not an old-kernel runtime claim.
  mkdirSync(root); const bytes = canonicalJson(draft); writeFileSync(path, bytes, { mode: 0o600 });
  rmSync(f.source, { recursive: true }); rmSync(f.cap, { recursive: true });
  assert.equal(readCapturedResolution(f.scope, reference).dispatch.composition.omissions[0].reason, "helper-knowledge");
  assert.equal(verifyResolutionInputs(f.scope, reference).record.subject.kind, "helper");
  assert.deepEqual(commitCapturedResolution(f.scope, draft), reference); assert.equal(readFileSync(path, "utf8"), bytes);
  const fresh = structuredClone(draft); fresh.context.key = "distinct-publication";
  assert.throws(() => commitCapturedResolution(f.scope, fresh), { code: "needs-configuration" });
  assert.equal(existsSync(join(root, `${jsonIntegrity(fresh).value}.json`)), false);
  // Removing the omission cannot bypass the missing explicit-policy guard.
  fresh.dispatch.composition.omissions = [];
  assert.throws(() => commitCapturedResolution(f.scope, fresh), { code: "needs-configuration" });
});

test("storage rejects undeclared helper contributions at publication without changing historical reuse or primary behavior", (t) => {
  const f = fixture(t), draft = f.build("publication-guard"), persistent = structuredClone(draft.subject);
  const id = "example.action", otherId = "example.b", other = join(f.root, "other-capability");
  const directory = join(f.cap, "agents/worker"); mkdirSync(directory, { recursive: true }); mkdirSync(other);
  writeFileSync(join(directory, "soul.yaml"), "name: worker\nwork: directory\n");
  writeFileSync(join(directory, "AGENTS.md"), "Canonical worker body\n"); symlinkSync("AGENTS.md", join(directory, "CLAUDE.md"));
  writeFileSync(join(f.cap, "inject.md"), "Declared A contribution\n");
  const manifest = JSON.parse(readFileSync(join(f.cap, "oats.json")));
  Object.assign(manifest, { agents: ["agents/worker"], inject: "inject.md", helperInjection: { version: 1, mode: "inherit" } });
  const bytes = Buffer.from(JSON.stringify(manifest)); writeFileSync(join(f.cap, "oats.json"), bytes);
  const artifact = { kind: "capability", capability: id, integrity: treeIntegrity(f.cap) }; retainPortableArtifact(f.scope, f.cap, artifact);
  draft.artifacts.capabilities[id].artifact = artifact;
  for (const resource of Object.values(draft.resources)) resource.owner = artifact;
  // B has a contained ordinary file, but declares NEITHER inject nor helperInjection.
  const otherBytes = Buffer.from(JSON.stringify({ capability: otherId, version: "1.0.0", description: "No instruction contribution" }));
  writeFileSync(join(other, "oats.json"), otherBytes); writeFileSync(join(other, "ordinary.md"), "Undeclared B text\n");
  const otherArtifact = { kind: "capability", capability: otherId, integrity: treeIntegrity(other) }; retainPortableArtifact(f.scope, other, otherArtifact);
  draft.artifacts.capabilities[otherId] = { version: "1.0.0", artifact: otherArtifact,
    origin: { kind: "local-capability", source: `path:${other}`, authoredAs: "path", witness: origin } };
  draft.dispatch.providerManifests[otherId] = "other-manifest";
  Object.assign(draft.resources, {
    body: { owner: artifact, path: "agents/worker/AGENTS.md", kind: "file" },
    "other-manifest": { owner: otherArtifact, path: "oats.json", kind: "manifest" },
    "undeclared:example.b": { owner: otherArtifact, path: "ordinary.md", kind: "file" },
  });
  draft.subject = { kind: "helper", provider: artifact, name: "worker", definition: { owner: artifact, path: "agents/worker/soul.yaml", kind: "file" } };
  const captured = captureHelperInjectionChoices({ requirements: [], candidates: [] }, [{ artifact, bytes }, { artifact: otherArtifact, bytes: otherBytes }]);
  Object.assign(draft.choices, captured.choices);
  const policy = captured.policies.get(id); draft.resources[policy.resourceKey] = policy.resource;
  draft.dispatch.composition = { schemaVersion: 1, mode: "directory", body: "body", skills: [], omissions: [],
    blocks: [{ source: policy.source, resource: policy.resourceKey, choice: policy.fact.key }] };
  const referenceOf = record => ({ schemaVersion: 1, id: jsonIntegrity(record).value });
  const root = join(f.scope, ".agents/resolutions"), bad = structuredClone(draft);
  bad.dispatch.composition.blocks.push({ source: `capability:${otherId}`, resource: "undeclared:example.b" });
  const overridden = structuredClone(bad), overrideKey = "/instructions/explicit-b";
  Object.assign(overridden.choices, resolveChoices({ candidates: [{ key: overrideKey, kind: "operator", value: "undeclared:example.b", origin }] }).choices);
  overridden.dispatch.composition.blocks.at(-1).choice = overrideKey;
  const disabled = structuredClone(draft), disabledKey = "/instructions/disabled-b";
  Object.assign(disabled.choices, resolveChoices({ candidates: [{ key: disabledKey, kind: "operator", value: null, origin }] }).choices);
  disabled.dispatch.composition.omissions.push({ source: `capability:${otherId}`, reason: "disabled", choice: disabledKey });
  const unselected = structuredClone(bad); unselected.dispatch.composition.blocks.at(-1).source = "capability:example.unselected";
  rmSync(f.source, { recursive: true }); rmSync(f.cap, { recursive: true }); rmSync(other, { recursive: true });
  for (const candidate of [bad, overridden, disabled, unselected]) {
    // Real retained-input verification must succeed first: refusal must be the
    // publication boundary, not a malformed record or missing source/resource.
    validateWire("CapturedResolution", candidate);
    verifyResolutionInputs(f.scope, referenceOf(candidate), { draft: candidate });
    assert.throws(() => commitCapturedResolution(f.scope, candidate), { code: "invalid-resolution" });
    assert.equal(existsSync(root), false, "refused publication creates no resolution store/staging");
  }
  // An applicable A policy + a silent B is legal; no invented B policy needed.
  const cleanRef = commitCapturedResolution(f.scope, draft);
  assert.equal(readCapturedResolution(f.scope, cleanRef).dispatch.composition.blocks.length, 1);
  // Literal historical bytes are fixtures, not records minted by the new API.
  for (const candidate of [bad, overridden, disabled, unselected]) {
    const reference = referenceOf(candidate), path = join(root, `${reference.id}.json`), bytes = canonicalJson(candidate);
    writeFileSync(path, bytes, { mode: 0o600 });
    assert.equal(canonicalJson(readCapturedResolution(f.scope, reference)), bytes);
    verifyResolutionInputs(f.scope, reference);
    assert.deepEqual(commitCapturedResolution(f.scope, candidate), reference);
    assert.equal(readFileSync(path, "utf8"), bytes, "literal old bytes never rewritten");
    const fresh = structuredClone(candidate); fresh.context.key = "distinct-new-publication";
    const files = readdirSync(root).sort();
    assert.throws(() => commitCapturedResolution(f.scope, fresh), { code: "invalid-resolution" });
    assert.deepEqual(readdirSync(root).sort(), files, "no new record or staging in existing store");
  }
  // Existing primary composition semantics are outside this helper-only guard.
  const primary = structuredClone(bad); primary.subject = persistent;
  primary.resources.body = { owner: persistent.soul.sourceArtifact, path: "AGENTS.md", kind: "file" };
  delete primary.choices[policy.fact.key]; delete primary.dispatch.composition.blocks[0].choice;
  const primaryRef = commitCapturedResolution(f.scope, primary);
  assert.equal(readCapturedResolution(f.scope, primaryRef).subject.kind, "persistent");
});

test("repo package provenance is bound to the retained source snapshot, not only the old local pathname", (t) => {
  const f = fixture(t), record = f.build("unused"), pkg = join(f.source, "packages/action"), install = join(f.root, "installation");
  mkdirSync(join(pkg, "action"), { recursive: true }); mkdirSync(install);
  writeFileSync(join(pkg, "oats-package.json"), JSON.stringify({ package: "example.package", version: "1.0.0", description: "Fixture package", compatibility: { oats: ">=0.1.0" }, capabilities: ["action"] }));
  writeFileSync(join(pkg, "action/oats.json"), readFileSync(join(f.cap, "oats.json")));
  writeFileSync(join(pkg, "action/marker.mjs"), "console.log('A');\n");
  writeFileSync(join(f.source, "soul.yaml"), readFileSync(join(f.source, "soul.yaml"), "utf8").replace(`path:${f.cap}`, "repo:packages/action"));
  const bytes = readFileSync(join(f.source, "soul.yaml"));
  const sourceArtifact = { ...record.subject.soul.sourceArtifact, integrity: treeIntegrity(f.source) };
  retainPortableArtifact(f.scope, f.source, sourceArtifact);
  record.subject.soul.sourceArtifact = sourceArtifact; record.subject.soul.revision.integrity = sourceArtifact.integrity;
  const document = { kind: "source", source: `path:${f.source}`, revision: "local", path: "soul.yaml", integrity: bytesIntegrity(bytes) };
  record.choices = resolveChoices({ requirements: soulConstraints(parsePortableSoul(bytes, { origin: document })) }).choices;
  acquirePackage(install, `path:${pkg}`);
  const selectInstalled = () => {
    const installed = installedCapabilityDir(install, "example.action");
    const artifact = { kind: "capability", capability: "example.action", integrity: treeIntegrity(installed) };
    retainPortableArtifact(f.scope, installed, artifact);
    record.artifacts.packages["example.package"] = { source: `path:${pkg}`, path: ".", version: "1.0.0", commit: "local", integrity: treeIntegrity(pkg, { format: PACKAGE_FORMAT }), dependencies: [] };
    record.artifacts.capabilities["example.action"] = { version: "1.0.0", artifact, origin: { kind: "package", package: "example.package", path: "action", projectionVersion: 1 } };
    for (const resource of Object.values(record.resources)) resource.owner = artifact;
  };
  selectInstalled(); commitCapturedResolution(f.scope, record);
  writeFileSync(join(pkg, "action/marker.mjs"), "console.log('B');\n");
  updatePackage(install, "example.package"); selectInstalled();
  assert.throws(() => commitCapturedResolution(f.scope, record), { code: "resolution-incomplete" });
});

test("an equal effective setting cannot discard the source hard constraint or source provenance", (t) => {
  const f = fixture(t), record = f.build("A");
  commitCapturedResolution(f.scope, record);
  const key = settingChoiceKey("example.action", "mode");
  record.choices[key] = resolveChoices({ candidates: [{ key, kind: "operator", value: "strict", origin }] }).choices[key];
  assert.throws(() => commitCapturedResolution(f.scope, record), { code: "resolution-incomplete" });
});

test("manifest defaults and canonical setting references must be captured, never invented while loading", (t) => {
  const f = fixture(t), record = f.build("A"), id = "example.action";
  const manifest = JSON.parse(readFileSync(join(f.cap, "oats.json"), "utf8"));
  manifest.settings = { mode: { default: "soft" }, target: { default: "base" } };
  const bytes = Buffer.from(JSON.stringify(manifest)); writeFileSync(join(f.cap, "oats.json"), bytes);
  const artifact = { kind: "capability", capability: id, integrity: treeIntegrity(f.cap) };
  retainPortableArtifact(f.scope, f.cap, artifact);
  record.artifacts.capabilities[id].artifact = artifact;
  for (const resource of Object.values(record.resources)) resource.owner = artifact;
  assert.throws(() => commitCapturedResolution(f.scope, record), { code: "resolution-incomplete" });
  const requirements = Object.entries(record.choices).flatMap(([key, choice]) => choice.constraints.map((entry) => ({ key, ...entry })));
  const candidates = Object.entries(record.choices).flatMap(([key, choice]) => choice.considered.map(({ disposition: _, ...entry }) => ({ key, ...entry })));
  const captured = captureManifestSettings({ status: "resolved", requirements, candidates, capabilities: record.artifacts.capabilities, settings: record.dispatch.settingsChoices }, [{ artifact, bytes }]);
  record.choices = captured.choices; record.dispatch.settingsChoices = captured.settings;
  const ref = commitCapturedResolution(f.scope, record);
  validateWire("CapturedResolution", readCapturedResolution(f.scope, ref));
  assert.equal(record.choices[settingChoiceKey(id, "mode")].value, "strict");
  const changed = structuredClone(record), key = settingChoiceKey(id, "target");
  changed.choices[key] = resolveChoices({ candidates: [{ key, kind: "operator", value: "base", origin }] }).choices[key];
  assert.throws(() => commitCapturedResolution(f.scope, changed), { code: "resolution-incomplete" });
  changed.dispatch.settingsChoices[id].target = settingChoiceKey(id, "mode");
  assert.throws(() => commitCapturedResolution(f.scope, changed), { code: "invalid-declaration" });
});

test("invented manifest defaults refuse even when overridden or absent from dispatch settings", (t) => {
  const f = fixture(t), base = f.build("A"), id = "example.action", key = settingChoiceKey(id, "target");
  const witness = { kind: "manifest-default", document: { kind: "artifact", owner: base.artifacts.capabilities[id].artifact,
    path: "oats.json", integrity: bytesIntegrity(readFileSync(join(f.cap, "oats.json"))) }, pointer: "/settings/target/default" };
  for (const referenced of [true, false]) {
    const record = structuredClone(base);
    record.choices[key] = resolveChoices({ candidates: [
      { key, kind: "manifest-default", value: "invented-fallback", origin: witness },
      { key, kind: "operator", value: "explicit", origin },
    ] }).choices[key];
    if (referenced) record.dispatch.settingsChoices[id].target = key;
    const reference = { schemaVersion: 1, id: jsonIntegrity(record).value };
    assert.throws(() => verifyResolutionInputs(f.scope, reference, { draft: record }), { code: "resolution-incomplete" });
    assert.throws(() => commitCapturedResolution(f.scope, record), { code: "resolution-incomplete" });
  }
});

test("record corruption refuses without repair, and partial/unknown evidence cannot be published as a resolution", (t) => {
  const f = fixture(t), record = f.build("A"), ref = commitCapturedResolution(f.scope, record);
  const file = join(f.scope, ".agents/resolutions", `${ref.id}.json`);
  const bytes = readFileSync(file); writeFileSync(file, Buffer.concat([bytes, Buffer.from(" ")]));
  assert.throws(() => readCapturedResolution(f.scope, ref), { code: "integrity-drift" });
  assert.throws(() => commitCapturedResolution(f.scope, record), { code: "integrity-drift" });
  assert.equal(readFileSync(file).length, bytes.length + 1);
  for (const capture of ["partial", "unknown"]) assert.throws(() => commitCapturedResolution(f.scope, { ...record, capture }), { code: "resolution-incomplete" });
  assert.throws(() => commitCapturedResolution(f.scope, { ...record, capture: "reconstructed", evidence: [origin] }), { code: "migration-required" });
});

test("missing hard source requirements or helper inputs refuse before publishing a selectable record", (t) => {
  const f = fixture(t), record = f.build("A");
  const incomplete = structuredClone(record);
  incomplete.artifacts.capabilities = {}; incomplete.resources = {}; incomplete.dispatch.providerManifests = {}; incomplete.dispatch.settingsChoices = {};
  assert.throws(() => commitCapturedResolution(f.scope, incomplete), { code: "resolution-incomplete" });
  assert.equal(existsSync(join(f.scope, ".agents/resolutions")), false);
  const missingHelper = structuredClone(record);
  missingHelper.helpers.worker = { schemaVersion: 1, id: `sha256-${"b".repeat(64)}` };
  assert.throws(() => commitCapturedResolution(f.scope, missingHelper), { code: "resolution-not-found" });
  assert.equal(existsSync(join(f.scope, ".agents/resolutions")), false);
});

test("exact A/B approvals coexist independently of removed sources and poisoned current trust", (t) => {
  const f = fixture(t), a = f.build("A"), A = commitCapturedResolution(f.scope, a);
  const b = f.build("B"), B = commitCapturedResolution(f.scope, b), id = "example.action";
  const status = (ref) => inspectCapturedApprovals(f.scope, ref).capabilities[0].status;
  assert.equal(status(A), "approval-required");
  assert.equal(approveCapturedCapability(f.scope, A, id, origin).status, "approved");
  assert.equal(status(A), "approved"); assert.equal(status(B), "approval-required");
  rmSync(f.source, { recursive: true }); rmSync(f.cap, { recursive: true });
  writeFileSync(join(f.scope, "oats-lock.json"), '{"trusted":true}');
  assert.equal(status(B), "approval-required");
  approveCapturedCapability(f.scope, B, id, origin);
  assert.equal(status(A), "approved"); assert.equal(status(B), "approved");
  validateWire("ApprovalLedger", readApprovalLedger(f.scope).ledger);
  assert.equal(Object.keys(readApprovalLedger(f.scope).ledger.capabilities[id]).length, 2);
  assert.equal(approveCapturedCapability(f.scope, A, id, origin).status, "already-approved");
  const bad = readApprovalLedger(f.scope).ledger;
  const key = artifactApprovalKey(a.artifacts.capabilities[id].artifact);
  bad.capabilities[id][key].artifact.integrity.value = b.artifacts.capabilities[id].artifact.integrity.value;
  assert.throws(() => validateApprovalLedger(bad), { code: "invalid-approval" });
  const legacy = readApprovalLedger(f.scope).ledger;
  legacy.capabilities[id][key].artifact.integrity.format = "oats.capability-artifact.v1";
  assert.throws(() => validateApprovalLedger(legacy), { code: "invalid-artifact-reference" });
});

test("environment-only authority and owner-execute changes need exact approval; declarative-only changes do not", (t) => {
  const f = fixture(t), record = f.build("A"), id = "example.action";
  const manifest = JSON.parse(readFileSync(join(f.cap, "oats.json"), "utf8"));
  delete manifest.commands; manifest.environment = ["EXAMPLE_MODE"];
  const capture = () => {
    writeFileSync(join(f.cap, "oats.json"), JSON.stringify(manifest));
    const artifact = { kind: "capability", capability: id, integrity: treeIntegrity(f.cap) };
    retainPortableArtifact(f.scope, f.cap, artifact);
    record.artifacts.capabilities[id].artifact = artifact;
    for (const resource of Object.values(record.resources)) resource.owner = artifact;
    return commitCapturedResolution(f.scope, record);
  };
  const A = capture();
  assert.equal(inspectCapturedApprovals(f.scope, A).capabilities[0].status, "approval-required");
  approveCapturedCapability(f.scope, A, id, origin);
  chmodSync(join(f.cap, "marker.mjs"), 0o755);
  const B = capture();
  assert.equal(inspectCapturedApprovals(f.scope, B).capabilities[0].status, "approval-required");
  assert.equal(inspectCapturedApprovals(f.scope, A).capabilities[0].status, "approved");
  delete manifest.environment;
  const C = capture();
  assert.equal(inspectCapturedApprovals(f.scope, C).capabilities[0].status, "not-required");
  assert.equal(approveCapturedCapability(f.scope, C, id, origin).status, "not-required");
  assert.equal(Object.keys(readApprovalLedger(f.scope).ledger.capabilities[id]).length, 1);
});
