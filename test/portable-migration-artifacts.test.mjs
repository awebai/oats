import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { capabilityArtifactIntegrity } from "../lib/artifact-tree.mjs";
import { capabilityIntegrity } from "../lib/core.mjs";
import { decodeLegacyLockBytes } from "../lib/legacy-lock-codec.mjs";
import { readPortableMigrationInventory } from "../lib/portable-migration-evidence.mjs";
import { MATERIALIZED_CAPABILITY_FORMAT, verifyHistoricalCapabilityCandidate, verifyHistoricalHomeCapabilityCandidate } from "../lib/portable-migration-artifacts.mjs";
import { commitHistoricalHomeCapabilityEvidence, readResolutionEvidence } from "../lib/portable-migration-store.mjs";

const hash = (letter) => `sha256-${letter.repeat(64)}`;
function write(path, value) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n"); }
function fixture(t) {
  const deployment = mkdtempSync(join(tmpdir(), "oats-migration-artifact-"));
  t.after(() => rmSync(deployment, { recursive: true, force: true }));
  const capability = "example.action", packageId = "example.pkg";
  const artifact = join(deployment, ".agents", "capabilities", "installed", capability);
  const packageRow = { source: "git:https://example.test/pkg.git@main", path: "oats-package", version: "1.0.0",
    commit: "a".repeat(40), integrity: hash("a"), dependencies: [] };
  const capabilityBase = { version: "1.0.0", package: packageId, path: "capabilities/action", trusted: true };
  write(join(artifact, "oats.json"), { capability, version: "1.0.0", description: "Historical candidate", commands: { show: "show.mjs" } });
  write(join(artifact, "show.mjs"), "console.log('historical');\n"); chmodSync(join(artifact, "show.mjs"), 0o644);
  write(join(artifact, ".oats-installation.json"), { schemaVersion: 1, capability, version: capabilityBase.version,
    package: packageId, packageVersion: packageRow.version, source: packageRow.source, commit: packageRow.commit,
    packagePath: packageRow.path, capabilityPath: capabilityBase.path });
  const capabilityRow = { ...capabilityBase, integrity: capabilityArtifactIntegrity(artifact) };
  write(join(deployment, "oats-lock.json"), { lockfileVersion: 2, packages: { [packageId]: packageRow }, capabilities: { [capability]: capabilityRow } });
  const homePath = "agents/dev/instances/dev-old", home = join(deployment, homePath);
  write(join(home, "instance.json"), { instance: "dev-old", capabilityRuntime: [{ id: capability,
    trust: { trusted: true, integrity: capabilityRow.integrity }, hooks: { retire: "/historical/retire.mjs" } }] });
  const legacyLockDecoder = (bytes, context) => decodeLegacyLockBytes(bytes, { file: context.path });
  const inventory = readPortableMigrationInventory(deployment, { lockFiles: ["oats-lock.json"], instanceHomes: [homePath] }, { legacyLockDecoder });
  return { deployment, artifact, capability, home, homePath, inventory, legacyLockDecoder };
}

test("explicit v2 artifact candidate verifies old bytes/provenance but observes modes only at migration", (t) => {
  const f = fixture(t), request = { lockPath: "oats-lock.json", capability: f.capability,
    artifactDir: `.agents/capabilities/installed/${f.capability}` };
  const first = verifyHistoricalCapabilityCandidate(f.deployment, f.inventory, request, { legacyLockDecoder: f.legacyLockDecoder });
  assert.equal(first.artifact.historicalIntegrity.format, MATERIALIZED_CAPABILITY_FORMAT);
  assert.equal(first.artifact.historicalIntegrity.value, first.capability.row.integrity);
  assert.notEqual(first.artifact.historicalIntegrity.value, f.inventory.locks[0].integrity.value, "lock file and artifact hashes are different domains");
  assert.equal(first.artifact.modeEvidence, "observed-at-migration");
  assert.equal(first.artifact.provenance.path, ".oats-installation.json");
  assert.match(first.artifact.provenance.integrity.value, /^sha256-[a-f0-9]{64}$/);
  assert.equal(first.selectionAuthority, "none"); assert.equal(first.approvalAuthority, "none");
  assert.equal(first.retentionStatus, "not-retained");
  assert.equal(existsSync(join(f.deployment, ".agents", "capabilities", "artifacts")), false, "verification does not retain or publish");

  chmodSync(join(f.artifact, "show.mjs"), 0o744);
  const second = verifyHistoricalCapabilityCandidate(f.deployment, f.inventory, request, { legacyLockDecoder: f.legacyLockDecoder });
  assert.equal(second.artifact.historicalIntegrity.value, first.artifact.historicalIntegrity.value, "old v2 digest did not cover owner execute");
  assert.notEqual(second.artifact.observedIntegrity.value, first.artifact.observedIntegrity.value, "new observation records owner execute today");
});

test("oversized unreadable provenance is bounded before the legacy artifact hasher reads it", { skip: process.getuid?.() === 0 ? "root can read mode-000 files" : false }, (t) => {
  const f = fixture(t), provenance = join(f.artifact, ".oats-installation.json");
  truncateSync(provenance, 8 * 1024 * 1024 + 1); chmodSync(provenance, 0o000);
  const request = { lockPath: "oats-lock.json", capability: f.capability,
    artifactDir: `.agents/capabilities/installed/${f.capability}` };
  assert.throws(() => verifyHistoricalCapabilityCandidate(f.deployment, f.inventory, request,
    { legacyLockDecoder: f.legacyLockDecoder }), { code: "resource-limit" });
});

test("external provenance symlink is refused even when the old artifact digest witnesses its link target", (t) => {
  const f = fixture(t), provenance = join(f.artifact, ".oats-installation.json"), external = join(f.deployment, "external-provenance.json");
  const bytes = readFileSync(provenance); writeFileSync(external, bytes); rmSync(provenance); symlinkSync(external, provenance);
  const lockPath = join(f.deployment, "oats-lock.json"), lock = JSON.parse(readFileSync(lockPath, "utf8"));
  lock.capabilities[f.capability].integrity = capabilityArtifactIntegrity(f.artifact); write(lockPath, lock);
  write(join(f.home, "instance.json"), { instance: "dev-old", capabilityRuntime: [{ id: f.capability,
    trust: { trusted: true, integrity: lock.capabilities[f.capability].integrity }, hooks: {} }] });
  const inventory = readPortableMigrationInventory(f.deployment, { lockFiles: ["oats-lock.json"], instanceHomes: [f.homePath] }, { legacyLockDecoder: f.legacyLockDecoder });
  const request = { lockPath: "oats-lock.json", capability: f.capability,
    artifactDir: `.agents/capabilities/installed/${f.capability}` };
  assert.throws(() => verifyHistoricalCapabilityCandidate(f.deployment, inventory, request,
    { legacyLockDecoder: f.legacyLockDecoder }), { code: "invalid-lock" });
  assert.deepEqual(readFileSync(external), bytes, "external bytes were neither changed nor accepted as artifact provenance");
});

test("one home runtime digest can associate one v2 artifact but remains partial and unapproved", (t) => {
  const f = fixture(t), request = { lockPath: "oats-lock.json", capability: f.capability,
    artifactDir: `.agents/capabilities/installed/${f.capability}`, homePath: f.homePath };
  const result = verifyHistoricalHomeCapabilityCandidate(f.deployment, f.inventory, request, { legacyLockDecoder: f.legacyLockDecoder });
  assert.equal(result.association, "capability-runtime-integrity-match"); assert.equal(result.completeness, "partial");
  assert.equal(result.legacyTrustedClaim, true); assert.equal(result.approvalAuthority, "none");
  assert.ok(result.unresolved.some((entry) => /source revision/.test(entry)));

  write(join(f.home, "instance.json"), { instance: "dev-old", capabilityRuntime: [{ id: f.capability,
    trust: { trusted: true, integrity: hash("f") }, hooks: {} }] });
  const changed = readPortableMigrationInventory(f.deployment, { lockFiles: ["oats-lock.json"], instanceHomes: [f.homePath] }, { legacyLockDecoder: f.legacyLockDecoder });
  assert.throws(() => verifyHistoricalHomeCapabilityCandidate(f.deployment, changed, request,
    { legacyLockDecoder: f.legacyLockDecoder }), { code: "migration-held" });
});

test("verified home association publishes only sanitized partial evidence outside resolutions", (t) => {
  const f = fixture(t), request = { lockPath: "oats-lock.json", capability: f.capability,
    artifactDir: `.agents/capabilities/installed/${f.capability}`, homePath: f.homePath };
  const reference = commitHistoricalHomeCapabilityEvidence(f.deployment, f.inventory, request, { legacyLockDecoder: f.legacyLockDecoder });
  const evidence = readResolutionEvidence(f.deployment, reference), proof = evidence.knownInputs.preserve;
  assert.equal(evidence.status, "partial"); assert.equal(evidence.resolution, null);
  assert.equal(proof.kind, "home-capability-v2"); assert.equal(proof.association, "capability-runtime-integrity-match");
  assert.equal(proof.approvalAuthority, "none"); assert.equal(proof.retentionStatus, "not-retained");
  assert.equal(Object.hasOwn(proof.capability, "source"), false, "unclassified legacy source text is not copied into new evidence");
  assert.equal(existsSync(join(f.deployment, ".agents", "resolutions")), false);
});

test("explicit v1 digest callback verifies legacy artifacts without reinterpreting trust or historical modes", (t) => {
  const deployment = mkdtempSync(join(tmpdir(), "oats-migration-v1-artifact-"));
  t.after(() => rmSync(deployment, { recursive: true, force: true }));
  const capability = "example.legacy", artifactPath = `.agents/capabilities/installed/${capability}`, artifact = join(deployment, artifactPath);
  write(join(artifact, "oats.json"), { capability, version: "1.0.0", description: "Legacy candidate", commands: { show: "show.mjs" } });
  write(join(artifact, "show.mjs"), "console.log('legacy');\n"); chmodSync(join(artifact, "show.mjs"), 0o644);
  const integrity = capabilityIntegrity(artifact), homePath = "agents/dev/instances/dev-v1";
  const secretPath = "SECRET_TOKEN=must-not-enter-evidence";
  write(join(deployment, "legacy.json"), { lockfileVersion: 1, capabilities: { [capability]: {
    source: "path:/historical/legacy", version: "1.0.0", integrity, trustedExecutables: true,
    path: secretPath, unknownSettings: { token: "also-not-projected" } } } });
  write(join(deployment, homePath, "instance.json"), { instance: "dev-v1", capabilityRuntime: [{ id: capability,
    trust: { trusted: true, integrity }, hooks: {} }] });
  const legacyLockDecoder = (bytes, context) => decodeLegacyLockBytes(bytes, { file: context.path });
  const inventory = readPortableMigrationInventory(deployment, { lockFiles: ["legacy.json"], instanceHomes: [homePath] }, { legacyLockDecoder });
  const request = { lockPath: "legacy.json", capability, artifactDir: artifactPath, homePath };
  assert.throws(() => verifyHistoricalCapabilityCandidate(deployment, inventory, request, { legacyLockDecoder }), { code: "migration-held" });
  const adapters = { legacyLockDecoder, legacyCapabilityDigest: capabilityIntegrity };
  const first = verifyHistoricalHomeCapabilityCandidate(deployment, inventory, request, adapters);
  assert.equal(first.artifact.artifact.historicalIntegrity.format, "oats.capability-legacy.v1");
  assert.equal(first.artifact.artifact.manifest.path, "oats.json"); assert.equal(first.approvalAuthority, "none");
  const reference = commitHistoricalHomeCapabilityEvidence(deployment, inventory, request, adapters);
  const evidence = readResolutionEvidence(deployment, reference);
  assert.equal(evidence.knownInputs.preserve.kind, "home-capability-v1");
  assert.equal(evidence.knownInputs.preserve.capability.package, null);
  assert.equal(evidence.knownInputs.preserve.capability.path, null, "unknown v1 row.path is not verified artifact provenance");
  assert.equal(Object.hasOwn(evidence.knownInputs.preserve.capability, "source"), false);
  assert.doesNotMatch(JSON.stringify(evidence), /SECRET_TOKEN|also-not-projected|historical\/legacy/, "raw v1 source/settings/unknown fields never enter persisted evidence");

  chmodSync(join(artifact, "show.mjs"), 0o744);
  const second = verifyHistoricalCapabilityCandidate(deployment, inventory, request, adapters);
  assert.equal(second.artifact.historicalIntegrity.value, first.artifact.artifact.historicalIntegrity.value, "literal v1 digest does not gain mode semantics");
  assert.notEqual(second.artifact.observedIntegrity.value, first.artifact.artifact.observedIntegrity.value);
});

test("candidate verifier refuses missing rows, drift and legacy-v1 without inventing restoration", (t) => {
  const f = fixture(t), base = { lockPath: "oats-lock.json", artifactDir: `.agents/capabilities/installed/${f.capability}` };
  assert.throws(() => verifyHistoricalCapabilityCandidate(f.deployment, f.inventory, { ...base, capability: "missing.action" }, { legacyLockDecoder: f.legacyLockDecoder }), { code: "migration-held" });
  writeFileSync(join(f.artifact, "show.mjs"), "console.log('changed');\n");
  assert.throws(() => verifyHistoricalCapabilityCandidate(f.deployment, f.inventory, { ...base, capability: f.capability }, { legacyLockDecoder: f.legacyLockDecoder }), { code: "integrity-drift" });

  write(join(f.deployment, "legacy.json"), { lockfileVersion: 1, capabilities: {} });
  const legacy = readPortableMigrationInventory(f.deployment, { lockFiles: ["legacy.json"] }, { legacyLockDecoder: f.legacyLockDecoder });
  assert.throws(() => verifyHistoricalCapabilityCandidate(f.deployment, legacy,
    { lockPath: "legacy.json", capability: f.capability, artifactDir: base.artifactDir }, { legacyLockDecoder: f.legacyLockDecoder }), { code: "migration-held" });
});
