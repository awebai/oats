import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildCommandExecutionTemplate, admitExecutionTemplate } from "../lib/schedule-capsule.mjs";
import { readPortableMigrationInventory, verifyPortableMigrationInventory } from "../lib/portable-migration-evidence.mjs";
import { planPortableMigration } from "../lib/portable-migration.mjs";
import { commitPlannedResolutionEvidence, readResolutionEvidence, validateResolutionEvidence } from "../lib/portable-migration-store.mjs";

const RID = `sha256-${"a".repeat(64)}`;
function write(path, value) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n"); }
function fixture(t) {
  const deployment = mkdtempSync(join(tmpdir(), "oats-portable-migration-"));
  t.after(() => rmSync(deployment, { recursive: true, force: true }));
  const legacyHome = join(deployment, "agents", "dev", "instances", "dev-old");
  const capturedHome = join(deployment, "agents", "dev", "instances", "dev-captured");
  const lock = { lockfileVersion: 1, capabilities: { "example.action": {
    source: "path:/historical/source", version: "1.0.0", integrity: `sha256-${"b".repeat(64)}`, trustedExecutables: true,
  } } };
  write(join(deployment, "oats-lock.json"), lock);
  write(join(legacyHome, "instance.json"), { instance: "dev-old", capabilityRuntime: [{ id: "example.action",
    trust: { trusted: true, integrity: `sha256-${"b".repeat(64)}` }, hooks: { retire: "/overwritten/retire.mjs" } }] });
  write(join(legacyHome, ".oats-rollback-incomplete.json"), { cleanup: { capabilityRuntime: [{ id: "example.action" }], outstanding: { hooks: ["example.action"], git: [] } } });
  write(join(capturedHome, "instance.json"), { instance: "dev-captured", executionBinding: {
    schemaVersion: 1, deployment, resolution: { schemaVersion: 1, id: RID },
  } });
  const template = buildCommandExecutionTemplate({ cwd: deployment,
    argv: ["oats", "example-action", "show", "--deployment", deployment, "--resolution", RID, "--json"],
    responsibleHuman: null });
  const attempt = admitExecutionTemplate(template, { executionId: "attempt-a" });
  write(join(deployment, "oats-schedules.json"), { version: 2, jobs: {
    legacy: { id: "legacy", kind: "command", cwd: deployment, argv: ["oats", "status"], cron: "* * * * *", tz: "UTC" },
    captured: { id: "captured", definitionVersion: 2, recurrencePolicy: "capture", kind: "command", execution: template },
  } });
  write(join(deployment, ".agents", "schedules", "state.json"), { jobs: {
    legacy: { attempt: { scheduledFor: "2026-09-16T00:00:00.000Z" }, lastRun: { outcome: "unknown" } },
    captured: { attempt: { schemaVersion: 1, execution: attempt } },
  } });
  return { deployment, legacyHome, capturedHome };
}

function byTarget(plan, kind, id) { return plan.targets.find((entry) => entry.target.kind === kind && entry.target.id === id); }

test("bounded migration inventory witnesses literal locks, homes and jobs without writes or trust promotion", (t) => {
  const f = fixture(t), before = readFileSync(join(f.deployment, "oats-lock.json"));
  const inventory = readPortableMigrationInventory(f.deployment, {
    lockFiles: ["oats-lock.json"], instanceHomes: ["agents/dev/instances/dev-captured", "agents/dev/instances/dev-old"], scheduleScopes: ["."],
  });
  assert.equal(existsSync(join(f.deployment, ".agents", "portable")), false);
  assert.equal(existsSync(join(f.deployment, ".agents", "resolutions")), false);
  assert.deepEqual(readFileSync(join(f.deployment, "oats-lock.json")), before);
  assert.equal(inventory.locks[0].format, "legacy-v1");
  assert.equal(inventory.locks[0].semanticVerification, "legacy-reader-required");
  assert.match(inventory.locks[0].integrity.value, /^sha256-[a-f0-9]{64}$/);
  assert.equal(inventory.homes[0].path.endsWith("dev-captured"), true, "targets are canonical byte-sorted paths");
  assert.equal(inventory.homes[0].executionBinding.state, "valid-shape");
  assert.equal(inventory.homes[1].capabilities[0].trustedClaim, true, "legacy trust is inventoried only as a claim");
  assert.equal(inventory.schedules[0].jobs.find((job) => job.id === "captured").attempt.executionId, "attempt-a");

  const plan = planPortableMigration(inventory);
  assert.equal(plan.readyToApply, false);
  assert.deepEqual(plan.effects, { writes: false, providerExecution: false, sessionChanges: false, scheduleChanges: false, trustTransfer: false });
  assert.equal(plan.targets.some((entry) => entry.status === "reconstructed"), false);
  const lock = byTarget(plan, "selection-lock", "oats-lock.json");
  assert.equal(lock.status, "partial"); assert.equal(lock.action, "hold");
  assert.ok(lock.unresolved.some((entry) => entry.code === "approval-required"));
  const old = byTarget(plan, "instance-home", "agents/dev/instances/dev-old");
  assert.equal(old.status, "partial"); assert.equal(old.action, "hold");
  assert.ok(old.unresolved.some((entry) => /source revision/.test(entry.reason)));
  const captured = byTarget(plan, "instance-home", "agents/dev/instances/dev-captured");
  assert.equal(captured.status, "partial"); assert.equal(captured.action, "verify");
  assert.deepEqual(captured.preserve.executionBinding.resolution, { schemaVersion: 1, id: RID });
  const legacyJob = byTarget(plan, "scheduled-job", ".:legacy");
  assert.equal(legacyJob.status, "unknown"); assert.equal(legacyJob.action, "hold");
  const capturedJob = byTarget(plan, "scheduled-job", ".:captured");
  assert.equal(capturedJob.status, "partial"); assert.equal(capturedJob.action, "preserve");
  assert.equal(capturedJob.preserve.executions.find((entry) => entry.source === "attempt").executionId, "attempt-a");
  verifyPortableMigrationInventory(f.deployment, inventory);
});

test("unselectable evidence publication rechecks witnesses and never creates a captured resolution", (t) => {
  const f = fixture(t), inventory = readPortableMigrationInventory(f.deployment, {
    lockFiles: ["oats-lock.json"], instanceHomes: ["agents/dev/instances/dev-old"], scheduleScopes: ["."],
  });
  const target = { kind: "instance-home", id: "agents/dev/instances/dev-old" };
  const reference = commitPlannedResolutionEvidence(f.deployment, inventory, target);
  const evidence = readResolutionEvidence(f.deployment, reference);
  assert.equal(evidence.status, "partial"); assert.equal(evidence.resolution, null);
  assert.equal(evidence.target.kind, target.kind); assert.equal(evidence.target.id, target.id); assert.equal(evidence.knownInputs.action, "hold");
  assert.equal(existsSync(join(f.deployment, ".agents", "resolutions")), false);
  assert.deepEqual(commitPlannedResolutionEvidence(f.deployment, inventory, target), reference, "identical evidence is immutable and reusable");
  assert.throws(() => validateResolutionEvidence({ ...evidence, resolution: { schemaVersion: 1, id: RID } }), { code: "resolution-incomplete" });

  const path = join(f.deployment, ".agents", "resolution-evidence", `${reference.id}.json`);
  writeFileSync(path, readFileSync(path, "utf8").replace('"status":"partial"', '"status":"unknown"'));
  assert.throws(() => readResolutionEvidence(f.deployment, reference), { code: "integrity-drift" });
  assert.throws(() => commitPlannedResolutionEvidence(f.deployment, inventory, target), { code: "integrity-drift" });
});

test("inventory recheck detects exact-byte drift before evidence publication", (t) => {
  const f = fixture(t);
  write(join(f.deployment, "broken-lock.json"), "{not json\n");
  const inventory = readPortableMigrationInventory(f.deployment, { lockFiles: ["broken-lock.json", "oats-lock.json"] });
  const broken = inventory.locks.find((entry) => entry.path === "broken-lock.json");
  assert.equal(broken.state, "invalid"); assert.equal(broken.format, "unknown");
  const held = byTarget(planPortableMigration(inventory), "selection-lock", "broken-lock.json");
  assert.equal(held.status, "unknown"); assert.equal(held.action, "hold");

  writeFileSync(join(f.deployment, "oats-lock.json"), readFileSync(join(f.deployment, "oats-lock.json"), "utf8") + "\n");
  assert.throws(() => verifyPortableMigrationInventory(f.deployment, inventory), { code: "selection-changed" });
  assert.throws(() => commitPlannedResolutionEvidence(f.deployment, inventory, held.target), { code: "selection-changed" });
  assert.equal(existsSync(join(f.deployment, ".agents", "resolution-evidence")), false, "drift refuses before opening the immutable evidence store");
});

test("inventory refuses out-of-deployment and symlinked evidence paths", (t) => {
  const f = fixture(t), outside = mkdtempSync(join(tmpdir(), "oats-portable-migration-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  write(join(outside, "oats-lock.json"), { lockfileVersion: 1, capabilities: {} });
  assert.throws(() => readPortableMigrationInventory(f.deployment, { lockFiles: [join(outside, "oats-lock.json")] }), { code: "path-escape" });
  symlinkSync(join(outside, "oats-lock.json"), join(f.deployment, "linked-lock.json"));
  assert.throws(() => readPortableMigrationInventory(f.deployment, { lockFiles: ["linked-lock.json"] }), { code: "invalid-evidence" });
});
