/** Read-only historical migration evidence inventory.
 *
 * Inputs are an explicit bounded target list supplied by the deployment owner.
 * This module does not discover topology, resolve current config/source, verify
 * legacy lock semantics, execute providers, or write migration state. */
import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { readPortableBytes } from "./portable-files.mjs";
import { bytesIntegrity, validateIntegrity, BYTES_FORMAT } from "./portable-digest.mjs";
import { canonicalJson, compareUtf8, parseStrictJson } from "./portable-values.mjs";
import { portableScope } from "./portable-state.mjs";
import { validateExecutionBinding, validateExecutionCapsule, validateExecutionTemplate } from "./schedule-capsule.mjs";
import { oatsError } from "./errors.mjs";

export const MIGRATION_INVENTORY_VERSION = 1;
const MAX_TARGETS = 10_000;
const SHA256 = /^sha256-[a-f0-9]{64}$/;

const plain = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const problem = (code, message, pointer = "") => ({ code, message, pointer });
const errorProblem = (error, pointer = "") => problem(error?.code || "invalid-evidence", String(error?.message || error), pointer);

function canonicalTarget(deployment, input, kind, { allowRoot = false } = {}) {
  if (typeof input !== "string" || !input || input.includes("\0")) throw oatsError("invalid-declaration", `${kind} target must be a non-empty path without NUL`);
  const lexical = resolve(deployment, input);
  const part = relative(deployment, lexical);
  if ((!allowRoot && !part) || part === ".." || part.startsWith(`..${sep}`) || isAbsolute(part)) {
    throw oatsError("path-escape", `${kind} target is outside the explicit migration deployment`);
  }
  let parent;
  try { parent = realpathSync(dirname(lexical)); }
  catch (error) {
    if (error.code === "ENOENT") return { absolute: lexical, path: part || ".", parentMissing: true };
    throw error;
  }
  if (parent !== dirname(lexical)) throw oatsError("path-escape", `${kind} target has a symlinked or aliased parent`);
  return { absolute: lexical, path: part || ".", parentMissing: false };
}

function targetDirectory(deployment, input, kind, { allowRoot = false } = {}) {
  const target = canonicalTarget(deployment, input, kind, { allowRoot });
  if (target.parentMissing) return target;
  let stat;
  try { stat = lstatSync(target.absolute); }
  catch (error) { if (error.code === "ENOENT") return { ...target, missing: true }; throw error; }
  if (!stat.isDirectory() || realpathSync(target.absolute) !== target.absolute) {
    throw oatsError("path-escape", `${kind} target must be a real, non-symlinked directory`);
  }
  return target;
}

function uniqueTargets(deployment, values, kind, options) {
  if (!Array.isArray(values) || values.length > MAX_TARGETS || values.some((value) => typeof value !== "string")) {
    throw oatsError("resource-limit", `${kind} target list must be an array of at most ${MAX_TARGETS} paths`);
  }
  const targets = values.map((value) => options?.directory
    ? targetDirectory(deployment, value, kind, options)
    : canonicalTarget(deployment, value, kind, options));
  targets.sort((a, b) => compareUtf8(a.path, b.path));
  for (let i = 1; i < targets.length; i++) if (targets[i - 1].path === targets[i].path) {
    throw oatsError("invalid-declaration", `duplicate ${kind} migration target ${targets[i].path}`);
  }
  return targets;
}

function readDocument(target) {
  if (target.parentMissing) return { receipt: { path: target.path, state: "absent" }, value: null };
  const bytes = readPortableBytes(target.absolute, { allowMissing: true, invalidCode: "invalid-evidence" });
  if (bytes === null) return { receipt: { path: target.path, state: "absent" }, value: null };
  const integrity = bytesIntegrity(bytes);
  try {
    return { receipt: { path: target.path, state: "present", integrity }, value: parseStrictJson(bytes) };
  } catch (error) {
    return { receipt: { path: target.path, state: "invalid", integrity, problems: [errorProblem(error)] }, value: null };
  }
}

function mapIds(value, key, pointer, problems) {
  const map = value?.[key];
  if (map === undefined) return [];
  if (!plain(map)) { problems.push(problem("invalid-evidence", `${key} must be an object map`, pointer)); return []; }
  return Object.keys(map).sort(compareUtf8);
}

function summarizeLock(target) {
  const { receipt, value } = readDocument(target);
  if (receipt.state !== "present") return { ...receipt, format: "unknown", rowCounts: { packages: 0, capabilities: 0 }, rowIds: { packages: [], capabilities: [] }, legacyTrustClaims: 0, semanticVerification: "required" };
  const problems = [];
  if (!plain(value)) problems.push(problem("invalid-evidence", "historical lock root is not an object", ""));
  const rawVersion = plain(value) ? value.lockfileVersion : undefined;
  const version = rawVersion === undefined ? 1 : rawVersion;
  const format = version === 1 ? "legacy-v1" : version === 2 ? "materialized-v2" : version === 3 ? "portable-v3" : "unknown";
  if (!Number.isSafeInteger(version)) problems.push(problem("invalid-evidence", "lockfileVersion is not an integer", "/lockfileVersion"));
  else if (![1, 2, 3].includes(version)) problems.push(problem("unsupported-wire-version", `unsupported historical lockfileVersion ${version}`, "/lockfileVersion"));
  const rowIds = {
    packages: plain(value) ? mapIds(value, "packages", "/packages", problems) : [],
    capabilities: plain(value) ? mapIds(value, "capabilities", "/capabilities", problems) : [],
  };
  const capabilityRows = plain(value?.capabilities) ? Object.values(value.capabilities) : [];
  const legacyTrustClaims = capabilityRows.filter((row) => plain(row) && (row.trusted === true || row.trustedExecutables === true)).length;
  const rowCounts = { packages: rowIds.packages.length, capabilities: rowIds.capabilities.length };
  return { ...receipt, ...(problems.length ? { state: "invalid", problems } : {}), format, rowCounts, rowIds, legacyTrustClaims,
    semanticVerification: version === 3 ? "current-reader-required" : "legacy-reader-required" };
}

function bindingSummary(value, problems) {
  if (!Object.hasOwn(value, "executionBinding")) return { state: "absent" };
  try {
    validateExecutionBinding(value.executionBinding);
    return { state: "valid-shape", value: JSON.parse(canonicalJson(value.executionBinding)) };
  } catch (error) {
    problems.push(errorProblem(error, "/executionBinding"));
    return { state: "invalid" };
  }
}

function capabilitySummaries(value, pointer, problems) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) { problems.push(problem("invalid-evidence", "capabilityRuntime must be an array", pointer)); return []; }
  const out = [];
  for (let index = 0; index < value.length; index++) {
    const row = value[index], at = `${pointer}/${index}`;
    if (!plain(row) || typeof row.id !== "string" || !row.id) { problems.push(problem("invalid-evidence", "capability runtime row lacks an identity", at)); continue; }
    const integrity = typeof row.trust?.integrity === "string" && SHA256.test(row.trust.integrity) ? row.trust.integrity : null;
    const hookNames = plain(row.hooks) ? Object.keys(row.hooks).sort(compareUtf8) : [];
    out.push({ id: row.id, integrity, trustedClaim: row.trust?.trusted === true, hookNames });
  }
  return out.sort((a, b) => compareUtf8(a.id, b.id));
}

function summarizeCleanup(target) {
  const document = canonicalTarget(target.deployment, join(target.absolute, ".oats-rollback-incomplete.json"), "cleanup evidence");
  const { receipt, value } = readDocument(document);
  const problems = [];
  if (receipt.state !== "present") return { document: receipt, capabilities: [], outstanding: { hooks: 0, git: 0, directory: false } };
  if (!plain(value)) problems.push(problem("invalid-evidence", "cleanup descriptor root is not an object", ""));
  const cleanup = plain(value?.cleanup) ? value.cleanup : null;
  if (!cleanup) problems.push(problem("invalid-evidence", "cleanup descriptor has no cleanup object", "/cleanup"));
  const outstanding = plain(cleanup?.outstanding) ? cleanup.outstanding : {};
  const capabilities = capabilitySummaries(cleanup?.capabilityRuntime, "/cleanup/capabilityRuntime", problems);
  return {
    document: { ...receipt, ...(problems.length ? { state: "invalid", problems } : {}) },
    capabilities,
    outstanding: { hooks: Array.isArray(outstanding.hooks) ? outstanding.hooks.length : 0,
      git: Array.isArray(outstanding.git) ? outstanding.git.length : 0, directory: outstanding.directory === true },
    ...(problems.length ? { problems } : {}),
  };
}

function summarizeHome(deployment, target) {
  const document = canonicalTarget(deployment, join(target.absolute, "instance.json"), "instance evidence");
  const { receipt, value } = readDocument(document), problems = [];
  let instance = basename(target.absolute), executionBinding = { state: "absent" }, capabilities = [];
  if (receipt.state === "present") {
    if (!plain(value)) problems.push(problem("invalid-evidence", "instance metadata root is not an object", ""));
    else {
      if (typeof value.instance === "string" && value.instance) instance = value.instance;
      else problems.push(problem("invalid-evidence", "instance metadata has no stable instance name", "/instance"));
      executionBinding = bindingSummary(value, problems);
      capabilities = capabilitySummaries(value.capabilityRuntime, "/capabilityRuntime", problems);
    }
  }
  const cleanup = summarizeCleanup({ ...target, deployment });
  return { path: target.path, instance, document: { ...receipt, ...(problems.length ? { state: "invalid", problems } : {}) },
    executionBinding, capabilities, cleanup };
}

function executionSummary(value, kind, pointer, problems) {
  if (value === undefined) return { state: "absent" };
  try {
    if (kind === "capsule") validateExecutionCapsule(value); else validateExecutionTemplate(value);
    return { state: "valid-shape", schemaVersion: value.schemaVersion,
      ...(Object.hasOwn(value, "executionId") ? { executionId: value.executionId } : {}),
      deployment: value.deployment, resolution: JSON.parse(canonicalJson(value.resolution)),
      action: JSON.parse(canonicalJson(value.action)) };
  } catch (error) {
    problems.push(errorProblem(error, pointer));
    return { state: "invalid" };
  }
}

function summarizeScheduleJob(id, definition, state) {
  const problems = [];
  if (definition !== undefined && !plain(definition)) problems.push(problem("invalid-evidence", "schedule definition is not an object", `/definitions/jobs/${id}`));
  if (state !== undefined && !plain(state)) problems.push(problem("invalid-evidence", "schedule state is not an object", `/state/jobs/${id}`));
  const attempt = plain(state?.attempt) ? executionSummary(state.attempt.execution, "capsule", `/state/jobs/${id}/attempt/execution`, problems)
    : state?.attempt === undefined ? { state: "absent" } : (problems.push(problem("invalid-evidence", "schedule attempt is not an object", `/state/jobs/${id}/attempt`)), { state: "invalid" });
  const lastRun = plain(state?.lastRun) ? executionSummary(state.lastRun.execution, "capsule", `/state/jobs/${id}/lastRun/execution`, problems)
    : state?.lastRun === undefined ? { state: "absent" } : (problems.push(problem("invalid-evidence", "schedule lastRun is not an object", `/state/jobs/${id}/lastRun`)), { state: "invalid" });
  const template = plain(definition) ? executionSummary(definition.execution, "template", `/definitions/jobs/${id}/execution`, problems) : { state: "absent" };
  return { id, kind: typeof definition?.kind === "string" ? definition.kind : null,
    definitionVersion: Number.isSafeInteger(definition?.definitionVersion) ? definition.definitionVersion : null,
    recurrencePolicy: typeof definition?.recurrencePolicy === "string" ? definition.recurrencePolicy : null,
    execution: template, attempt, lastRun, ...(problems.length ? { problems } : {}) };
}

function summarizeSchedules(deployment, target) {
  const definitionsTarget = canonicalTarget(deployment, join(target.absolute, "oats-schedules.json"), "schedule definitions evidence");
  const stateTarget = canonicalTarget(deployment, join(target.absolute, ".agents", "schedules", "state.json"), "schedule state evidence");
  const definitions = readDocument(definitionsTarget), state = readDocument(stateTarget), problems = [];
  const definitionsJobs = plain(definitions.value?.jobs) ? definitions.value.jobs : Object.create(null);
  const stateJobs = plain(state.value?.jobs) ? state.value.jobs : Object.create(null);
  if (definitions.receipt.state === "present" && !plain(definitions.value?.jobs)) problems.push(problem("invalid-evidence", "schedule definitions have no jobs map", "/definitions/jobs"));
  if (state.receipt.state === "present" && !plain(state.value?.jobs)) problems.push(problem("invalid-evidence", "schedule state has no jobs map", "/state/jobs"));
  const ids = [...new Set([...Object.keys(definitionsJobs), ...Object.keys(stateJobs)])].sort(compareUtf8);
  return { path: target.path, definitions: definitions.receipt, state: state.receipt,
    jobs: ids.map((id) => summarizeScheduleJob(id, definitionsJobs[id], stateJobs[id])), ...(problems.length ? { problems } : {}) };
}

/** Inventory only explicitly supplied targets. No recursive discovery occurs. */
export function readPortableMigrationInventory(scope, { lockFiles = [], instanceHomes = [], scheduleScopes = [] } = {}) {
  const deployment = portableScope(scope);
  const locks = uniqueTargets(deployment, lockFiles, "lock evidence").map(summarizeLock);
  const homes = uniqueTargets(deployment, instanceHomes, "instance home", { directory: true }).map((target) => summarizeHome(deployment, target));
  const schedules = uniqueTargets(deployment, scheduleScopes, "schedule scope", { directory: true, allowRoot: true }).map((target) => summarizeSchedules(deployment, target));
  const inventory = { schemaVersion: MIGRATION_INVENTORY_VERSION, deployment, locks, homes, schedules };
  canonicalJson(inventory);
  return inventory;
}

function assertReceipt(receipt) {
  if (!plain(receipt) || typeof receipt.path !== "string" || !["present", "absent", "invalid"].includes(receipt.state)) {
    throw oatsError("invalid-evidence", "migration inventory contains an invalid document receipt");
  }
  if (receipt.state !== "absent") validateIntegrity(receipt.integrity, [BYTES_FORMAT]);
}

/** Minimal persisted-inventory validation; evidence authority still comes from
 * re-reading and comparing all literal document witnesses below. */
export function validatePortableMigrationInventory(inventory) {
  canonicalJson(inventory);
  if (!plain(inventory) || inventory.schemaVersion !== MIGRATION_INVENTORY_VERSION || typeof inventory.deployment !== "string"
      || !Array.isArray(inventory.locks) || !Array.isArray(inventory.homes) || !Array.isArray(inventory.schedules)) {
    throw oatsError("invalid-evidence", "invalid migration inventory envelope");
  }
  for (const lock of inventory.locks) assertReceipt(lock);
  for (const home of inventory.homes) { assertReceipt(home.document); assertReceipt(home.cleanup.document); }
  for (const schedule of inventory.schedules) { assertReceipt(schedule.definitions); assertReceipt(schedule.state); }
  return inventory;
}

/** Re-read every explicit witness and require the complete inventory projection
 * to be unchanged. This is still read-only and performs no migration apply. */
export function verifyPortableMigrationInventory(scope, inventory) {
  validatePortableMigrationInventory(inventory);
  const deployment = portableScope(scope);
  if (deployment !== inventory.deployment) throw oatsError("selection-changed", "migration deployment identity changed");
  const current = readPortableMigrationInventory(deployment, {
    lockFiles: inventory.locks.map((entry) => entry.path),
    instanceHomes: inventory.homes.map((entry) => entry.path),
    scheduleScopes: inventory.schedules.map((entry) => entry.path),
  });
  if (canonicalJson(current) !== canonicalJson(inventory)) throw oatsError("selection-changed", "historical migration evidence changed after inventory");
  return current;
}
