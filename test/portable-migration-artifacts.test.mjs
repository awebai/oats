import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { capabilityArtifactIntegrity } from "../lib/artifact-tree.mjs";
import { decodeLegacyLockBytes } from "../lib/legacy-lock-codec.mjs";
import { readPortableMigrationInventory } from "../lib/portable-migration-evidence.mjs";
import { MATERIALIZED_CAPABILITY_FORMAT, verifyHistoricalCapabilityCandidate } from "../lib/portable-migration-artifacts.mjs";

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
  const legacyLockDecoder = (bytes, context) => decodeLegacyLockBytes(bytes, { file: context.path });
  const inventory = readPortableMigrationInventory(deployment, { lockFiles: ["oats-lock.json"] }, { legacyLockDecoder });
  return { deployment, artifact, capability, inventory, legacyLockDecoder };
}

test("explicit v2 artifact candidate verifies old bytes/provenance but observes modes only at migration", (t) => {
  const f = fixture(t), request = { lockPath: "oats-lock.json", capability: f.capability,
    artifactDir: `.agents/capabilities/installed/${f.capability}` };
  const first = verifyHistoricalCapabilityCandidate(f.deployment, f.inventory, request, { legacyLockDecoder: f.legacyLockDecoder });
  assert.equal(first.artifact.historicalIntegrity.format, MATERIALIZED_CAPABILITY_FORMAT);
  assert.equal(first.artifact.historicalIntegrity.value, first.capability.row.integrity);
  assert.notEqual(first.artifact.historicalIntegrity.value, f.inventory.locks[0].integrity.value, "lock file and artifact hashes are different domains");
  assert.equal(first.artifact.modeEvidence, "observed-at-migration");
  assert.equal(first.selectionAuthority, "none"); assert.equal(first.approvalAuthority, "none");
  assert.equal(first.retentionStatus, "not-retained");
  assert.equal(existsSync(join(f.deployment, ".agents", "capabilities", "artifacts")), false, "verification does not retain or publish");

  chmodSync(join(f.artifact, "show.mjs"), 0o744);
  const second = verifyHistoricalCapabilityCandidate(f.deployment, f.inventory, request, { legacyLockDecoder: f.legacyLockDecoder });
  assert.equal(second.artifact.historicalIntegrity.value, first.artifact.historicalIntegrity.value, "old v2 digest did not cover owner execute");
  assert.notEqual(second.artifact.observedIntegrity.value, first.artifact.observedIntegrity.value, "new observation records owner execute today");
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
