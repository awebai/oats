/** Pure planning over literal historical evidence. No filesystem access, writes,
 * provider execution, source resolution, approval transfer or publication. */
import { canonicalJson, compareUtf8 } from "./portable-values.mjs";
import { jsonIntegrity } from "./portable-digest.mjs";
import { validatePortableMigrationInventory } from "./portable-migration-evidence.mjs";
import { oatsError } from "./errors.mjs";

export const MIGRATION_PLAN_VERSION = 1;
const originFor = (receipt, pointer = "") => receipt.state === "absent" ? [] : [{ kind: "migration-evidence",
  document: { kind: "deployment", path: receipt.path, integrity: receipt.integrity }, pointer }];
const unresolved = (code, reason, receipt, pointer = "") => ({ pointer, code, origins: originFor(receipt, pointer), reason });

function lockPlan(lock) {
  const target = { kind: "selection-lock", id: lock.path };
  if (lock.state === "absent") return { target, status: "unknown", action: "hold", evidence: [],
    unresolved: [unresolved("migration-held", "the historical lock file is absent", lock)] };
  const evidence = originFor(lock);
  if (lock.state === "invalid" || lock.format === "unknown") return { target, status: "unknown", action: "hold", evidence,
    unresolved: [unresolved("invalid-lock", "the literal historical lock is malformed or unsupported", lock)] };
  if (lock.format === "portable-v3") return { target, status: "partial", action: "verify", evidence,
    unresolved: [unresolved("migration-required", "the current lock still needs its authoritative lock-v3 reader; a lock is not historical dispatch authority", lock)] };
  const empty = lock.rowCounts.packages === 0 && lock.rowCounts.capabilities === 0;
  return { target, status: empty ? "unknown" : "partial", action: "hold", evidence,
    unresolved: [
      ...(lock.semanticVerification === "verified" ? [] : [unresolved("migration-required", "the strict legacy lock reader must verify every row without reinterpretation", lock)]),
      unresolved("migration-held", "a deployment lock does not prove which revision a particular home or job used", lock),
      unresolved("approval-required", "legacy trust is evidence only and cannot grant new-format exact-artifact approval", lock),
    ] };
}

function homePlan(home) {
  const target = { kind: "instance-home", id: home.path };
  const receipts = [home.document, home.cleanup.document].filter((entry) => entry.state !== "absent");
  const evidence = receipts.flatMap((entry) => originFor(entry));
  if (!receipts.length) return { target, status: "unknown", action: "hold", evidence: [],
    unresolved: [unresolved("migration-held", "the named home has no instance or quarantine metadata", home.document)] };
  if (home.executionBinding.state === "valid-shape") return { target, status: "partial", action: "verify", evidence,
    preserve: { executionBinding: home.executionBinding.value },
    unresolved: [
      unresolved("migration-required", "the referenced captured resolution and all retained inputs must be verified before adoption", home.document, "/executionBinding"),
      unresolved("approval-required", "current exact-artifact approval and action-specific readiness remain separate", home.document, "/executionBinding"),
    ] };
  const hasRuntime = home.capabilities.length || home.cleanup.capabilities.length;
  const invalid = home.document.state === "invalid" || home.cleanup.document.state === "invalid" || home.executionBinding.state === "invalid";
  return { target, status: hasRuntime && !invalid ? "partial" : "unknown", action: "hold", evidence,
    unresolved: [
      ...(invalid ? [unresolved("invalid-evidence", "historical home metadata is malformed or has an invalid captured binding", home.document)] : []),
      unresolved("migration-held", "the home does not carry a verified complete captured resolution", home.document),
      unresolved("migration-held", "historical source revision, full managed resources and helper closure are not established by home metadata", home.document),
      unresolved("approval-required", "recorded legacy trust cannot authorize a reconstructed owner-exec artifact", home.document),
      ...(home.cleanup.document.state !== "absent" ? [unresolved("migration-held", "cleanup obligations must remain retryable and cannot be discarded during migration", home.cleanup.document)] : []),
    ] };
}

function executionCandidates(job) {
  return [
    ["definition", job.execution],
    ["attempt", job.attempt],
    ["lastRun", job.lastRun],
  ].filter(([, value]) => value.state !== "absent");
}

function schedulePlan(schedule, job) {
  const target = { kind: "scheduled-job", id: `${schedule.path}:${job.id}` };
  const evidence = [schedule.definitions, schedule.state].filter((entry) => entry.state !== "absent").flatMap((entry) => originFor(entry));
  const executions = executionCandidates(job), valid = executions.filter(([, value]) => value.state === "valid-shape");
  const invalid = executions.some(([, value]) => value.state === "invalid") || !!job.problems?.length
    || schedule.definitions.state === "invalid" || schedule.state.state === "invalid";
  const unresolvedCustody = [job.attempt.state, job.lastRun.state].some((state) => state === "legacy" || state === "invalid");
  if (unresolvedCustody) return { target, status: "unknown", action: "hold", evidence,
    unresolved: [
      ...(invalid ? [unresolved("invalid-evidence", "the admitted or unknown attempt evidence is malformed", schedule.state)] : []),
      unresolved("migration-held", "an existing admitted or unknown historical attempt has no valid captured execution; preserve it exactly and require owner reconciliation", schedule.state),
    ] };
  if (valid.length) {
    const preserve = { executions: valid.map(([source, value]) => ({ source, ...value })) };
    return { target, status: "partial", action: "preserve", evidence, preserve,
      unresolved: [
        ...(invalid ? [unresolved("invalid-evidence", "one or more schedule records disagree with the valid captured authority and must remain held", schedule.state)] : []),
        unresolved("migration-required", "each referenced resolution and admitted execution must be verified without rebinding", schedule.state),
      ] };
  }
  const hasAttempt = job.attempt.state !== "absent" || job.lastRun.state !== "absent";
  return { target, status: "unknown", action: "hold", evidence,
    unresolved: [unresolved("migration-held", hasAttempt
      ? "the admitted or unknown historical attempt has no valid captured execution; preserve it exactly and require owner reconciliation"
      : "the legacy schedule has no captured software authority", schedule.state)] };
}

/** Produce a deterministic no-write plan. No target can become reconstructed at
 * this stage: reconstruction requires the dedicated historical verifier. */
export function planPortableMigration(inventory) {
  validatePortableMigrationInventory(inventory);
  const targets = [
    ...inventory.locks.map(lockPlan),
    ...inventory.homes.map(homePlan),
    ...inventory.schedules.flatMap((schedule) => schedule.jobs.map((job) => schedulePlan(schedule, job))),
  ].sort((a, b) => compareUtf8(`${a.target.kind}:${a.target.id}`, `${b.target.kind}:${b.target.id}`));
  if (targets.some((entry) => entry.status === "reconstructed")) throw oatsError("invalid-evidence", "unverified planner output cannot claim reconstruction");
  const plan = { schemaVersion: MIGRATION_PLAN_VERSION, inventory: jsonIntegrity(inventory), readyToApply: false,
    effects: { writes: false, providerExecution: false, sessionChanges: false, scheduleChanges: false, trustTransfer: false }, targets };
  canonicalJson(plan);
  return plan;
}
