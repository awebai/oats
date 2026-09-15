import test from "node:test";
import assert from "node:assert/strict";
import { validateWire } from "./helpers/portable-schema-check.mjs";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { approveCapturedCapability, artifactApprovalKey, inspectCapturedApprovals, readApprovalLedger, validateApprovalLedger } from "../lib/artifact-approvals.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bytesIntegrity, PACKAGE_FORMAT, treeIntegrity } from "../lib/portable-digest.mjs";
import { acquirePackage, installedCapabilityDir, updatePackage } from "../lib/core.mjs";
import { parsePortableSoul } from "../lib/portable-soul.mjs";
import { resolveChoices } from "../lib/portable-choices.mjs";
import { settingChoiceKey, soulConstraints } from "../lib/soul-constraints.mjs";
import { retainPortableArtifact } from "../lib/portable-artifacts.mjs";
import { commitCapturedResolution, readCapturedResolution, verifyResolutionInputs } from "../lib/captured-resolutions.mjs";

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
