import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildCommandExecutionCapsule, capturedDispatchAction, validateExecutionCapsule } from "../lib/schedule-capsule.mjs";
import { addSchedule, findHomesInScope, jobLockInfo, readDefinitions, readState, reconcile, scheduleExecutionStatus, tickWorkspace, writeDefinitions, writeState } from "../lib/schedule.mjs";
import { approveCapturedCapability } from "../lib/artifact-approvals.mjs";
import { commitCapturedResolution, verifyResolutionInputs } from "../lib/captured-resolutions.mjs";
import { bytesIntegrity, treeIntegrity } from "../lib/portable-digest.mjs";
import { retainPortableArtifact } from "../lib/portable-artifacts.mjs";
import { parsePortableSoul } from "../lib/portable-soul.mjs";
import { resolveChoices } from "../lib/portable-choices.mjs";
import { settingChoiceKey, soulConstraints } from "../lib/soul-constraints.mjs";

const RID_A = `sha256-${"a".repeat(64)}`;
const RID_B = `sha256-${"b".repeat(64)}`;
const at = (iso) => new Date(iso);
function write(path, text) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); }
function workspace(t) {
  const ws = mkdtempSync(join(tmpdir(), "oats-schedule-capsule-"));
  t.after(() => rmSync(ws, { recursive: true, force: true }));
  write(join(ws, "agents/dev/soul/soul.yaml"), "name: dev\n");
  write(join(ws, "agents/dev/soul/AGENTS.md"), "# Dev\n");
  return ws;
}
function argv(deployment, resolution) {
  return ["oats", "example-action", "show", "--deployment", deployment, "--resolution", resolution, "--", "--fixture"];
}
function spec(ws, id, resolution = RID_A) {
  return { id, definitionVersion: 2, recurrencePolicy: "capture", kind: "command", cwd: ws,
    argv: argv(ws, resolution), cron: "* * * * *", tz: "UTC", responsibleHuman: null };
}

test("ExecutionCapsule1 binds its ID to the saved explicit captured command", () => {
  const capsule = buildCommandExecutionCapsule({ cwd: "/deployment", argv: argv("/deployment", RID_A),
    inputRefs: { source: "sha256-input" }, responsibleHuman: null });
  assert.equal(validateExecutionCapsule(capsule), capsule);
  assert.deepEqual(capsule.resolution, { schemaVersion: 1, id: RID_A });
  assert.deepEqual(capsule.action, { kind: "command", name: "example-action:show" });
  assert.deepEqual(capturedDispatchAction(capsule), { kind: "command", namespace: "example-action", name: "show" });
  for (const changed of [
    { ...structuredClone(capsule), deployment: "/other" },
    { ...structuredClone(capsule), target: { ...capsule.target, argv: argv("/deployment", RID_B) } },
    { ...structuredClone(capsule), executionId: RID_B },
  ]) assert.throws(() => validateExecutionCapsule(changed), { code: "invalid-declaration" });
  assert.throws(() => buildCommandExecutionCapsule({ cwd: "/deployment", argv: ["oats", "example-action", "show"] }), { code: "invalid-declaration" });
  assert.throws(() => buildCommandExecutionCapsule({ cwd: "/deployment", argv: ["oats", "example-action", "show", "--deployment", "/deployment", "--artifact-set", RID_A] }), { code: "invalid-declaration" });
});

test("capture policy admits exact retained authority before a slot and persists the capsule before command side effects", (t) => {
  const ws = workspace(t), admitted = [], calls = [];
  const saved = addSchedule(ws, spec(ws, "captured"));
  assert.equal(saved.definitionVersion, 2); assert.equal(saved.recurrencePolicy, "capture");
  assert.deepEqual(saved.executionStatus, { kind: "captured", capture: "recorded", migrationRequired: false, schemaVersion: 1, executionId: saved.execution.executionId, resolution: saved.execution.resolution });
  assert.deepEqual(scheduleExecutionStatus({ kind: "command" }), { kind: "legacy", capture: "unknown", migrationRequired: true });
  assert.equal(readDefinitions(ws).jobs.captured.execution.executionId, saved.execution.executionId);
  const io = {
    admit: (request) => { admitted.push(request); return { ok: true }; },
    command: (request) => {
      calls.push(request);
      const state = readState(ws);
      assert.equal(state.jobs.captured.attempt.schemaVersion, 1, "captured attempts carry their own wire version");
      assert.equal(state.jobs.captured.attempt.execution.executionId, saved.execution.executionId, "capsule is durable before child invocation");
      assert.equal(jobLockInfo(ws, "captured").executionId, saved.execution.executionId, "slot names the admitted capsule");
      return { schemaVersion: 1, ok: true, result: {} };
    },
  };
  const considered = tickWorkspace(ws, { now: at("2026-09-16T10:00:00Z"), io, reg: { maxConcurrent: 1 } });
  assert.equal(considered[0].action, "launched");
  assert.deepEqual(admitted, [{ deployment: ws, resolution: { schemaVersion: 1, id: RID_A }, action: { kind: "command", namespace: "example-action", name: "show" } }]);
  assert.deepEqual(calls, [{ cwd: ws, argv: argv(ws, RID_A).slice(1).concat("--json") }]);
  const state = readState(ws).jobs.captured;
  assert.equal(state.attempt, undefined); assert.equal(state.lastRun.execution.executionId, saved.execution.executionId);
  assert.equal(jobLockInfo(ws, "captured"), null);
});

test("failed admission and unavailable prepare-on-tick are blocked before command side effects", (t) => {
  const ws = workspace(t); let commands = 0;
  addSchedule(ws, spec(ws, "denied"));
  const io = { admit: () => { throw Object.assign(new Error("exact artifact is not approved"), { code: "approval-required" }); }, command: () => { commands++; assert.fail("command ran after failed admission"); } };
  let result = tickWorkspace(ws, { now: at("2026-09-16T10:01:00Z"), io, reg: { maxConcurrent: 1 } });
  assert.equal(result[0].action, "blocked"); assert.equal(result[0].errorCode, "approval-required");
  assert.equal(commands, 0); assert.equal(jobLockInfo(ws, "denied"), null); assert.equal(readState(ws).jobs.denied.attempt, undefined);

  addSchedule(ws, { id: "future", definitionVersion: 2, recurrencePolicy: "prepare-on-tick", kind: "command", cwd: ws,
    argv: ["oats", "status"], cron: "* * * * *", tz: "UTC" });
  const wakeHome = join(ws, "agents/dev/instances/wake"); write(join(wakeHome, "instance.json"), "{}");
  assert.throws(() => addSchedule(ws, { id: "unsafe-wake", definitionVersion: 2, recurrencePolicy: "prepare-on-tick", kind: "wake", home: wakeHome,
    message: "wake", cron: "* * * * *", tz: "UTC" }), (error) => error.code === "E_SCHEDULE_INVALID" && error.field === "recurrencePolicy");
  result = tickWorkspace(ws, { now: at("2026-09-16T10:02:00Z"), io: { command: () => { commands++; } }, reg: { maxConcurrent: 1 } });
  const future = result.find((entry) => entry.id === "future");
  assert.equal(future.action, "blocked"); assert.equal(future.errorCode, "migration-required");
  assert.equal(readState(ws).jobs.future.lastRun.outcome, "blocked");
  assert.equal(commands, 0); assert.equal(jobLockInfo(ws, "future"), null);
});

test("captured schedule dispatch executes retained code after source deletion and blocks before a child when retention is missing", (t) => {
  const root = mkdtempSync(join(tmpdir(), "oats-schedule-retained-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const deployment = join(root, "deployment"), source = join(root, "source"), capability = join(root, "capability"), marker = join(root, "marker.txt");
  for (const path of [deployment, source, capability]) mkdirSync(path);
  write(join(source, "soul.yaml"), `schemaVersion: 1\nname: schedule-expert\nrequires:\n  capabilities:\n    example.action:\n      source: path:${capability}\n      settings:\n        mode: strict\n`);
  write(join(source, "AGENTS.md"), "Captured scheduler fixture\n"); symlinkSync("AGENTS.md", join(source, "CLAUDE.md"));
  write(join(capability, "oats.json"), JSON.stringify({ capability: "example.action", version: "1.0.0", description: "Schedule fixture", command: "example-action", commands: { show: "marker.mjs" } }));
  write(join(capability, "marker.mjs"), `import { writeFileSync } from "node:fs"; writeFileSync(process.argv[2], "A"); console.log(JSON.stringify({schemaVersion:1,ok:true,result:{marker:"A"}}));\n`);
  const origin = { kind: "operator", document: { kind: "operator", id: "schedule-fixture" }, pointer: "/source" };
  const identity = { kind: "local-soul", source: `path:${source}`, exportPath: "." };
  const soulArtifact = { kind: "soul", identity, integrity: treeIntegrity(source) };
  const artifact = { kind: "capability", capability: "example.action", integrity: treeIntegrity(capability) };
  retainPortableArtifact(deployment, source, soulArtifact); retainPortableArtifact(deployment, capability, artifact);
  const definition = readFileSync(join(source, "soul.yaml"));
  const parsed = parsePortableSoul(definition, { origin: { kind: "source", source: `path:${source}`, revision: "local", path: "soul.yaml", integrity: bytesIntegrity(definition) }, localBase: source, allowLocalPaths: true });
  const record = {
    schemaVersion: 1, capture: "prepared",
    subject: { kind: "persistent", soul: { identity, alias: "schedule-expert", sourceArtifact: soulArtifact,
      revision: { kind: "local", source: `path:${source}`, integrity: soulArtifact.integrity, provenance: [origin] }, definition: "soul.yaml", projection: { roots: ["."] } } },
    context: { kind: "standalone", key: null },
    artifacts: { schemaVersion: 1, packages: {}, capabilities: { "example.action": { version: "1.0.0", artifact,
      origin: { kind: "local-capability", source: `path:${capability}`, authoredAs: "path", witness: origin } } } },
    choices: resolveChoices({ requirements: soulConstraints(parsed) }).choices,
    bindings: {}, messagingChoice: { schemaVersion: 1, enabled: false }, resourceBundles: [], helpers: {}, evidence: [],
    resources: { manifest: { owner: artifact, path: "oats.json", kind: "manifest" }, command: { owner: artifact, path: "marker.mjs", kind: "file" } },
    dispatch: { schemaVersion: 1, providerManifests: { "example.action": "manifest" }, settingsChoices: { "example.action": { mode: settingChoiceKey("example.action", "mode") } }, launch: null, runtimePackages: [], hostRequirements: [], workTargetInputs: {} },
  };
  const resolution = commitCapturedResolution(deployment, record);
  approveCapturedCapability(deployment, resolution, "example.action", origin);
  const retainedRoot = dirname(verifyResolutionInputs(deployment, resolution).resources.get("command"));
  rmSync(source, { recursive: true }); rmSync(capability, { recursive: true });
  write(join(deployment, "oats-config.yaml"), "poisoned current config"); write(join(deployment, "oats-lock.json"), "poisoned current lock");
  addSchedule(deployment, { id: "exact", definitionVersion: 2, recurrencePolicy: "capture", kind: "command", cwd: deployment,
    argv: ["oats", "example-action", "show", "--deployment", deployment, "--resolution", resolution.id, "--", marker],
    responsibleHuman: null, cron: "* * * * *", tz: "UTC" });
  let result = tickWorkspace(deployment, { now: at("2026-09-16T11:00:00Z"), reg: { maxConcurrent: 1 } });
  assert.equal(result[0].action, "launched", JSON.stringify(result)); assert.equal(readFileSync(marker, "utf8"), "A");
  rmSync(marker); rmSync(retainedRoot, { recursive: true, force: true });
  result = tickWorkspace(deployment, { now: at("2026-09-16T11:01:00Z"), reg: { maxConcurrent: 1 } });
  assert.equal(result[0].action, "blocked"); assert.equal(existsSync(marker), false, "missing retained input refuses before child execution");
  assert.equal(jobLockInfo(deployment, "exact"), null); assert.equal(readState(deployment).jobs.exact.attempt, undefined);
});

test("an admitted capsule survives definition edits and reconciliation after source deletion", (t) => {
  const ws = workspace(t), original = addSchedule(ws, spec(ws, "recover", RID_A));
  const instance = "worker-from-a", home = join(ws, "agents/dev/instances", instance);
  write(join(home, "instance.json"), JSON.stringify({ instance, home }));
  rmSync(join(ws, "agents/dev/soul"), { recursive: true, force: true });
  assert.deepEqual(findHomesInScope(ws, instance), [home], "home discovery does not depend on the deleted soul definition");

  const state = readState(ws);
  state.jobs.recover = {
    attempt: { schemaVersion: 1, scheduledFor: "2026-09-16T10:03:00.000Z", startedAt: "2026-09-16T10:03:01.000Z", execution: original.execution },
    lastRun: { scheduledFor: "2026-09-16T10:03:00.000Z", startedAt: "2026-09-16T10:03:01.000Z", outcome: "unknown", instance, execution: original.execution },
  };
  writeState(ws, state);
  const defs = readDefinitions(ws), replacement = { ...defs.jobs.recover, argv: argv(ws, RID_B) };
  delete replacement.execution;
  defs.jobs.recover = { ...replacement, ...updateLike(ws, replacement) };
  writeDefinitions(ws, defs);

  const result = reconcile(ws, "recover", { io: { inspect: () => ({ present: true, state: "unknown" }) } });
  assert.equal(result.reconciled, "adopted");
  assert.equal(result.schedule.lastRun.execution.resolution.id, RID_A, "reconciliation keeps admitted A despite future definition B");
  assert.equal(readDefinitions(ws).jobs.recover.execution.resolution.id, RID_B);
});

// Normalize a replacement without taking updateSchedule's host lock while the
// fixture intentionally has an unresolved attempt.
function updateLike(ws, replacement) {
  const scratchId = "replacement-normalizer";
  const normalized = addSchedule(ws, { ...replacement, id: scratchId });
  const defs = readDefinitions(ws); delete defs.jobs[scratchId]; writeDefinitions(ws, defs);
  const { id, createdAt, updatedAt, nextRun, lastRun, running, ...body } = normalized;
  return { ...body, id: replacement.id, createdAt: replacement.createdAt, updatedAt: replacement.updatedAt };
}
