import test from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { admitExecutionTemplate, buildCommandExecutionTemplate, capturedDispatchAction, executionContentIntegrity, validateExecutionCapsule, validateExecutionTemplate } from "../lib/schedule-capsule.mjs";
import { acquireJobLock, addSchedule, describe, findHomesInScope, jobLockInfo, readDefinitions, readState, reconcile, releaseJobLock, removeSchedule, runNow, saveWakeForHome, scheduleExecutionStatus, tickWorkspace, writeDefinitions, writeState } from "../lib/schedule.mjs";
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
  return ["oats", "example-action", "show", "--deployment", deployment, "--resolution", resolution, "--", "--fixture", "--json"];
}
function spec(ws, id, resolution = RID_A) {
  return { id, definitionVersion: 2, recurrencePolicy: "capture", kind: "command", cwd: ws,
    argv: argv(ws, resolution), cron: "* * * * *", tz: "UTC", responsibleHuman: null };
}
function executionSchema() {
  const ajv = new Ajv({ strict: true, ownProperties: true });
  ajv.addSchema(JSON.parse(readFileSync(new URL("../docs/portable.schema.json", import.meta.url), "utf8")));
  return ajv.compile(JSON.parse(readFileSync(new URL("../docs/execution-capsule.schema.json", import.meta.url), "utf8")));
}

test("ExecutionCapsule1 separates reusable content identity from fresh admission identity", () => {
  const capture = buildCommandExecutionTemplate({ cwd: "/deployment", argv: argv("/deployment", RID_A),
    inputRefs: { source: "sha256-input" }, responsibleHuman: null });
  assert.equal(validateExecutionTemplate(capture), capture);
  assert.deepEqual(capture.resolution, { schemaVersion: 1, id: RID_A });
  assert.deepEqual(capture.action, { kind: "command", name: "example-action:show" });
  assert.deepEqual(capturedDispatchAction(capture), { kind: "command", namespace: "example-action", name: "show" });
  const first = admitExecutionTemplate(capture), second = admitExecutionTemplate(capture);
  assert.notEqual(first.executionId, second.executionId, "identical content still represents two independent intents");
  assert.deepEqual(executionContentIntegrity(first), executionContentIntegrity(second));
  assert.equal(validateExecutionCapsule(first), first);
  for (const changed of [
    { ...structuredClone(first), deployment: "/other" },
    { ...structuredClone(first), target: { ...first.target, argv: argv("/deployment", RID_B) } },
    { ...structuredClone(first), resolution: { schemaVersion: 1, id: RID_B } },
    { ...structuredClone(first), executionId: "bad id" },
  ]) assert.throws(() => validateExecutionCapsule(changed), { code: "invalid-declaration" });
  assert.throws(() => buildCommandExecutionTemplate({ cwd: "/deployment", argv: ["oats", "example-action", "show"] }), { code: "invalid-declaration" });
  assert.throws(() => buildCommandExecutionTemplate({ cwd: "/deployment", argv: ["oats", "example-action", "show", "--deployment", "/deployment", "--resolution", RID_A] }), (error) => error.code === "invalid-declaration" && /save --json/.test(error.message));
  assert.throws(() => buildCommandExecutionTemplate({ cwd: "/deployment", argv: ["oats", "example-action", "show", "--deployment", "/deployment", "--artifact-set", RID_A, "--json"] }), { code: "invalid-declaration" });

  const validate = executionSchema();
  assert.equal(validate(first), true, JSON.stringify(validate.errors));
  const extra = { ...first, unrecorded: true };
  assert.equal(validate(extra), false, "the public structural schema stays closed");
});

test("capture policy admits exact retained authority before a slot and mints a fresh intent before each command", (t) => {
  const ws = workspace(t), admitted = [], calls = [], executionIds = [];
  assert.throws(() => addSchedule(ws, { ...spec(ws, "missing-human"), responsibleHuman: undefined }), (error) => error.code === "E_SCHEDULE_INVALID" && /responsibleHuman/.test(error.message));
  const saved = addSchedule(ws, spec(ws, "captured"));
  assert.equal(saved.definitionVersion, 2); assert.equal(saved.recurrencePolicy, "capture");
  assert.equal(readDefinitions(ws).version, 2, "a captured definition upgrades the outer file so old readers fail closed");
  assert.throws(() => addSchedule(ws, { id: "new-legacy", kind: "command", cwd: ws, argv: ["oats", "status"], cron: "* * * * *", tz: "UTC" }), { code: "migration-required" });
  assert.deepEqual(saved.executionStatus, { kind: "captured", capture: "recorded", migrationRequired: false, schemaVersion: 1, contentIntegrity: executionContentIntegrity(saved.execution), resolution: saved.execution.resolution });
  assert.deepEqual(scheduleExecutionStatus({ kind: "command" }), { kind: "legacy", capture: "unknown", migrationRequired: true });
  assert.deepEqual(scheduleExecutionStatus(saved, { scheduledFor: "past" }).intent, { kind: "legacy", capture: "unknown", migrationRequired: true });
  const sample = admitExecutionTemplate(saved.execution, { executionId: "attempt-sample" });
  assert.equal(scheduleExecutionStatus(saved, { schemaVersion: 1, execution: sample }).intent.executionId, "attempt-sample");
  assert.equal(scheduleExecutionStatus(saved, { schemaVersion: 1, execution: sample }, { executionId: "another-intent" }).intent.kind, "invalid");
  assert.equal(scheduleExecutionStatus(saved, { schemaVersion: 2, execution: sample }).intent.kind, "invalid");
  assert.equal(readDefinitions(ws).jobs.captured.execution.executionId, undefined, "a recurring definition has content identity, not admission identity");
  const io = {
    admit: (request) => { admitted.push(request); return { ok: true }; },
    command: (request) => {
      calls.push(request);
      const state = readState(ws), execution = state.jobs.captured.attempt.execution;
      assert.equal(state.jobs.captured.attempt.schemaVersion, 1, "captured attempts carry their own wire version");
      assert.deepEqual(executionContentIntegrity(execution), executionContentIntegrity(saved.execution), "attempt binds the saved immutable content");
      assert.equal(jobLockInfo(ws, "captured").executionId, execution.executionId, "slot names this admitted intent");
      executionIds.push(execution.executionId);
      return { schemaVersion: 1, ok: true, result: {} };
    },
  };
  let considered = tickWorkspace(ws, { now: at("2026-09-16T10:00:00Z"), io, reg: { maxConcurrent: 1 } });
  assert.equal(considered[0].action, "launched");
  considered = tickWorkspace(ws, { now: at("2026-09-16T10:01:00Z"), io, reg: { maxConcurrent: 1 } });
  assert.equal(considered[0].action, "launched");
  assert.equal(new Set(executionIds).size, 2, "identical recurring payloads produce distinct admitted intents");
  assert.equal(admitted.length, 2); assert.deepEqual(admitted[0], { deployment: ws, resolution: { schemaVersion: 1, id: RID_A }, action: { kind: "command", namespace: "example-action", name: "show" } });
  assert.deepEqual(calls, [{ cwd: ws, argv: argv(ws, RID_A).slice(1) }, { cwd: ws, argv: argv(ws, RID_A).slice(1) }], "admission executes the capsule argv without appending mutable arguments");
  const state = readState(ws).jobs.captured;
  assert.equal(state.attempt, undefined); assert.equal(state.lastRun.execution.executionId, executionIds[1]);
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
    argv: ["oats", "example-action", "show", "--", "--json"], cron: "* * * * *", tz: "UTC",
    preparation: { deployment: ws, source: { source: "git:https://example.test/repo.git", soul: "agents/expert", revision: "main", alias: "expert" } } });
  const wakeHome = join(ws, "agents/dev/instances/wake"); write(join(wakeHome, "instance.json"), "{}");
  assert.throws(() => addSchedule(ws, { id: "unsafe-wake", definitionVersion: 2, recurrencePolicy: "prepare-on-tick", kind: "wake", home: wakeHome,
    message: "wake", cron: "* * * * *", tz: "UTC" }), (error) => error.code === "E_SCHEDULE_INVALID" && error.field === "recurrencePolicy");
  result = tickWorkspace(ws, { now: at("2026-09-16T10:02:00Z"), io: { command: () => { commands++; } }, reg: { maxConcurrent: 1 } });
  const future = result.find((entry) => entry.id === "future");
  assert.equal(future.action, "blocked"); assert.equal(future.errorCode, "migration-required");
  assert.equal(readState(ws).jobs.future.lastRun.outcome, "blocked");
  assert.equal(commands, 0); assert.equal(jobLockInfo(ws, "future"), null);
});

test("prepare-on-tick uses the injected generic adapter and admits a new immutable capsule per tick", (t) => {
  const ws = workspace(t), prepared = [], dispatched = [], ids = [];
  const preparation = { deployment: ws, source: { source: "git:https://example.test/repo.git", soul: "agents/expert", revision: "main", alias: "expert" }, mode: { work: "directory" } };
  addSchedule(ws, { id: "prepared", definitionVersion: 2, recurrencePolicy: "prepare-on-tick", kind: "command", cwd: ws,
    argv: ["oats", "example-action", "show", "--", "--json"], preparation, cron: "* * * * *", tz: "UTC" });
  let prepareCalls = 0;
  const refs = [RID_A, RID_B];
  const io = {
    prepare: (input) => { prepared.push(input); return { executionBinding: { schemaVersion: 1, deployment: ws, resolution: { schemaVersion: 1, id: refs[prepareCalls++] } }, responsibleHuman: null, inputRefs: { source: `input-${prepareCalls}` } }; },
    admit: (request) => { dispatched.push(request); },
    command: ({ argv: actual }) => {
      const execution = readState(ws).jobs.prepared.attempt.execution; ids.push(execution.executionId);
      assert.equal(actual.includes("--deployment"), true); assert.equal(actual.includes("--resolution"), true);
      assert.equal(actual.indexOf("--resolution") < actual.indexOf("--"), true, "selectors are saved before protected child arguments");
      return { schemaVersion: 1, ok: true, result: {} };
    },
  };
  const dry = tickWorkspace(ws, { now: at("2026-09-16T10:06:00Z"), reg: { maxConcurrent: 1 }, io, dryRun: true });
  assert.equal(dry[0].action, "due"); assert.equal(prepareCalls, 0, "dry-run never prepares or mints an attempt");
  tickWorkspace(ws, { now: at("2026-09-16T10:06:00Z"), reg: { maxConcurrent: 1 }, io });
  tickWorkspace(ws, { now: at("2026-09-16T10:07:00Z"), reg: { maxConcurrent: 1 }, io });
  assert.deepEqual(prepared, [preparation, preparation]);
  assert.deepEqual(dispatched.map((entry) => entry.resolution.id), [RID_A, RID_B]);
  assert.equal(new Set(ids).size, 2); assert.equal(readState(ws).jobs.prepared.lastRun.execution.resolution.id, RID_B);

  const before = ids.length;
  const blocked = tickWorkspace(ws, { now: at("2026-09-16T10:08:00Z"), reg: { maxConcurrent: 1 }, io: { ...io, prepare: () => ({ problems: [{ code: "needs-configuration" }] }) } });
  assert.equal(blocked[0].action, "blocked"); assert.equal(blocked[0].errorCode, "needs-configuration"); assert.equal(ids.length, before);
});

test("captured wake templates bind instance executionBinding and remain gated before lifecycle side effects", (t) => {
  const ws = workspace(t), bound = join(ws, "agents/dev/instances/bound"), legacy = join(ws, "agents/dev/instances/legacy");
  const binding = { schemaVersion: 1, deployment: ws, resolution: { schemaVersion: 1, id: RID_A } };
  write(join(bound, "instance.json"), JSON.stringify({ instance: "dev-bound", executionBinding: binding }));
  write(join(legacy, "instance.json"), JSON.stringify({ instance: "dev-legacy" }));
  assert.throws(() => addSchedule(ws, { id: "legacy-wake-v2", definitionVersion: 2, recurrencePolicy: "capture", kind: "wake", home: legacy,
    message: "wake", responsibleHuman: null, cron: "* * * * *", tz: "UTC" }), { code: "migration-required" });
  const saved = addSchedule(ws, { id: "bound-wake", definitionVersion: 2, recurrencePolicy: "capture", kind: "wake", home: bound,
    message: "wake", responsibleHuman: null, cron: "* * * * *", tz: "UTC" });
  assert.deepEqual(saved.execution.resolution, binding.resolution); assert.equal(saved.execution.deployment, ws);
  assert.deepEqual(saved.execution.action, { kind: "wake", name: "session" });
  const wakeCapsule = admitExecutionTemplate(saved.execution, { executionId: "wake-intent" }), validate = executionSchema();
  assert.equal(validate(wakeCapsule), true, JSON.stringify(validate.errors));
  let starts = 0, inputs = 0;
  let result = tickWorkspace(ws, { now: at("2026-09-16T10:04:00Z"), reg: { maxConcurrent: 1 }, io: {
    admit: () => ({ ok: true }), inspect: () => ({ present: false, state: "shell" }),
    start: () => { starts++; }, input: () => { inputs++; },
  } });
  assert.equal(result.find((entry) => entry.id === "bound-wake").action, "blocked");
  assert.equal(result.find((entry) => entry.id === "bound-wake").errorCode, "migration-required");
  assert.equal(starts, 0); assert.equal(inputs, 0); assert.equal(jobLockInfo(ws, "bound-wake"), null);

  write(join(bound, "instance.json"), JSON.stringify({ instance: "dev-bound", executionBinding: { ...binding, resolution: { schemaVersion: 1, id: RID_B } } }));
  result = tickWorkspace(ws, { now: at("2026-09-16T10:05:00Z"), reg: { maxConcurrent: 1 }, io: { admit: () => ({ ok: true }) } });
  assert.equal(result.find((entry) => entry.id === "bound-wake").action, "blocked");
  assert.equal(result.find((entry) => entry.id === "bound-wake").errorCode, "E_SCHEDULE_INVALID");
  assert.equal(starts, 0); assert.equal(inputs, 0);

  const auto = join(ws, "agents/dev/instances/auto"), autoBinding = { ...binding, resolution: { schemaVersion: 1, id: RID_B } };
  write(join(auto, "instance.json"), JSON.stringify({ instance: "dev-auto", executionBinding: autoBinding }));
  const autoWake = saveWakeForHome(ws, { instance: "dev-auto", home: auto, wake: { cron: "*/5 * * * *", tz: "UTC", message: "auto" }, executionBinding: autoBinding, responsibleHuman: null });
  assert.equal(autoWake.definitionVersion, 2); assert.equal(autoWake.execution.resolution.id, RID_B);
  assert.throws(() => saveWakeForHome(ws, { instance: "missing-owner", home: auto, wake: { cron: "*/5 * * * *", tz: "UTC", message: "auto" }, executionBinding: autoBinding }), { code: "needs-configuration" });
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
    argv: ["oats", "example-action", "show", "--deployment", deployment, "--resolution", resolution.id, "--", marker, "--json"],
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

  const admitted = admitExecutionTemplate(original.execution, { executionId: "attempt-a" });
  const state = readState(ws);
  state.jobs.recover = {
    attempt: { schemaVersion: 1, scheduledFor: "2026-09-16T10:03:00.000Z", startedAt: "2026-09-16T10:03:01.000Z", execution: admitted },
    lastRun: { scheduledFor: "2026-09-16T10:03:00.000Z", startedAt: "2026-09-16T10:03:01.000Z", outcome: "unknown", instance, home, execution: admitted },
  };
  writeState(ws, state);
  const defs = readDefinitions(ws), replacement = { ...defs.jobs.recover, argv: argv(ws, RID_B), responsibleHuman: null };
  delete replacement.execution;
  defs.jobs.recover = { ...replacement, ...updateLike(ws, replacement) };
  writeDefinitions(ws, defs);

  const result = reconcile(ws, "recover", { io: { inspect: () => ({ present: true, state: "unknown" }) } });
  assert.equal(result.reconciled, "adopted");
  assert.equal(result.schedule.lastRun.execution.resolution.id, RID_A, "reconciliation keeps admitted A despite future definition B");
  assert.equal(jobLockInfo(ws, "recover").executionId, "attempt-a", "reconciled slot remains bound to the admitted intent");
  assert.equal(result.schedule.executionStatus.intent.executionId, "attempt-a", "a confirmed active run still reports its intent after the unresolved attempt is cleared");
  assert.equal(readDefinitions(ws).jobs.recover.execution.resolution.id, RID_B);
});

test("automatic captured wakes apply the first-write document version and new-entry policy gates", (t) => {
  const ws = workspace(t), home = join(ws, "agents/dev/instances/first-auto");
  const executionBinding = { schemaVersion: 1, deployment: ws, resolution: { schemaVersion: 1, id: RID_A } };
  write(join(home, "instance.json"), JSON.stringify({ instance: "first-auto", home, executionBinding }));
  const wake = { cron: "*/5 * * * *", tz: "UTC", message: "wake" };
  saveWakeForHome(ws, { instance: "first-auto", home, wake, executionBinding, responsibleHuman: null });
  assert.equal(readDefinitions(ws).version, 2, "old readers must reject the first automatic captured wake");
  assert.throws(() => saveWakeForHome(ws, { instance: "legacy-auto", home, wake }), { code: "migration-required" });
  assert.equal(readDefinitions(ws).jobs["wake-legacy-auto"], undefined);
});

test("observation preserves mismatched captured lock custody before tick or run-now admission", (t) => {
  const ws = workspace(t), home = join(ws, "agents/dev/instances/worker");
  write(join(home, "instance.json"), JSON.stringify({ instance: "worker", home }));
  addSchedule(ws, spec(ws, "held")); let commands = 0;
  const io = { admit() {}, command() { commands++; return { schemaVersion: 1, ok: true, result: { instance: "worker", home } }; } };
  tickWorkspace(ws, { now: at("2026-09-16T12:00:00Z"), reg: { maxConcurrent: 1 }, io });
  releaseJobLock(ws, "held"); acquireJobLock(ws, "held", { executionId: "other-intent", home });
  rmSync(home, { recursive: true });
  const before = readState(ws);
  assert.equal(describe(ws, "held").executionStatus.intent.kind, "invalid");
  assert.throws(() => tickWorkspace(ws, { now: at("2026-09-16T12:01:00Z"), reg: { maxConcurrent: 1 }, io }), { code: "E_SCHEDULE_INVALID" });
  assert.throws(() => tickWorkspace(ws, { now: at("2026-09-16T12:01:00Z"), reg: { maxConcurrent: 1 }, io, observeOnly: true }), { code: "E_SCHEDULE_INVALID" });
  assert.throws(() => runNow(ws, "held", { io }), { code: "E_SCHEDULE_INVALID" });
  assert.deepEqual(readState(ws), before); assert.equal(commands, 1);
  assert.equal(jobLockInfo(ws, "held").executionId, "other-intent");
});

test("reconcile cannot attribute an earlier worker receipt to a new admitted execution", (t) => {
  const ws = workspace(t), saved = addSchedule(ws, spec(ws, "receipt"));
  const home = join(ws, "agents/dev/instances/old-worker");
  write(join(home, "instance.json"), JSON.stringify({ instance: "old-worker", home }));
  const old = admitExecutionTemplate(saved.execution, { executionId: "old-intent" });
  const current = admitExecutionTemplate(saved.execution, { executionId: "new-intent" });
  const state = readState(ws); state.jobs.receipt = {
    attempt: { schemaVersion: 1, execution: current, scheduledFor: "2026-09-16T12:02:00Z" },
    lastRun: { execution: old, kind: "command", outcome: "launch-failed", instance: "old-worker", home },
  }; writeState(ws, state); acquireJobLock(ws, "receipt", { executionId: current.executionId });
  let observations = 0;
  const result = reconcile(ws, "receipt", { io: { inspect() { observations++; return { present: true, state: "unknown" }; } } });
  assert.equal(result.reconciled, "unknown"); assert.equal(observations, 0);
  assert.deepEqual(readState(ws), state); assert.equal(jobLockInfo(ws, "receipt").executionId, current.executionId);
});

test("ordinary removal preserves the admitted-attempt-before-lock crash state", (t) => {
  const ws = workspace(t), saved = addSchedule(ws, spec(ws, "pre-lock"));
  const state = readState(ws); state.jobs["pre-lock"] = { attempt: { schemaVersion: 1,
    execution: admitExecutionTemplate(saved.execution), scheduledFor: "2026-09-16T12:03:00Z" } };
  writeState(ws, state); assert.equal(jobLockInfo(ws, "pre-lock"), null);
  assert.throws(() => removeSchedule(ws, "pre-lock"), { code: "E_SCHEDULE_RUNNING" });
  assert.deepEqual(readState(ws), state); assert.ok(readDefinitions(ws).jobs["pre-lock"]);
  assert.equal(removeSchedule(ws, "pre-lock", { force: true }).removed, "pre-lock");
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
