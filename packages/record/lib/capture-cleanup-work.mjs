// Private retained-recovery housekeeping. A completed source can still own a
// deleting claim: enumerate those claims independently of the source queue.
// The caller owns scheduling/fairness, backoff and the final pass receipt.
import { withCaptureGroup } from "./capture-context.mjs";
import { prepareRetainedCaptureCleanup, removeRetainedCaptureScratch } from "./capture-retained-scratch.mjs";
import { discardRecoveryChunks } from "./capture-recovery-snapshot.mjs";
import { discardTranscriptPrefix } from "./transcript-prefix.mjs";

// One keyset page, not a scan-until-match: a large inventory of live recovery
// jobs must not consume a worker's entire allowance hiding a later cleanup.
// The scheduler checkpoints `after` and resumes it in subsequent work units.
// `complete` means this enumeration reached its end, not a successful pass.
export function captureCleanupPage(state, { after = "", limit = 128 } = {}) {
  if (typeof after !== "string" || !Number.isSafeInteger(limit) || limit < 1 || limit > 128)
    throw new Error("invalid capture cleanup page");
  const rows = state.db.prepare("SELECT key,value FROM state WHERE kind='recovery-allocation' AND key>? ORDER BY key LIMIT ?")
    .all(after, limit);
  const jobs = [];
  for (const row of rows) {
    const claim = JSON.parse(row.value);
    if (!claim || !["active", "deleting"].includes(claim.phase) ||
        typeof claim.stream !== "string" || !claim.stream || !/^[a-f0-9]{32}$/.test(claim.id))
      throw new Error("invalid retained capture cleanup inventory");
    if (claim.phase === "deleting") jobs.push({ key: row.key, stream: claim.stream, allocation: claim.id });
  }
  return { jobs, scanned: rows.length, after: rows.at(-1)?.key ?? after, complete: rows.length < limit };
}

// No pathname from a queue item is authority. The allocation nonce binds this
// item to the current durable reference; retained-scratch then verifies every
// directory, owner and payload identity and the registered root-lock worker.
export function cleanupCaptureRecovery(store, state, start, job, {
  maxRecords = 2000, stopped = () => start.budget.sample() !== null,
} = {}) {
  if (state.depth || typeof job?.key !== "string" || !job.key ||
      typeof job.stream !== "string" || !job.stream || !/^[a-f0-9]{32}$/.test(job.allocation) ||
      !Number.isSafeInteger(maxRecords) || maxRecords < 2 || maxRecords > 2000 || typeof stopped !== "function")
    throw new Error("invalid capture recovery cleanup unit");
  const current = () => {
    const claim = state.get("recovery-allocation", job.key);
    if (claim?.id !== job.allocation || claim.stream !== job.stream || claim.phase !== "deleting")
      throw new Error("capture recovery cleanup reference changed");
    return claim;
  };
  current();
  if (stopped()) return { complete: false, stopped: true };
  withCaptureGroup(store, [job.stream], () => {
    current();
    // Adoption must commit before removal. An already-absent directory is
    // accepted only for this deleting claim under its unchanged scratch base.
    prepareRetainedCaptureCleanup(store, job.stream, job.key, start);
  }, { state, check: () => start.budget.check() });
  if (stopped()) return { complete: false, stopped: true };
  current();
  removeRetainedCaptureScratch(store.root, state, job.key, start);
  if (stopped()) return { complete: false, stopped: true };
  return withCaptureGroup(store, [job.stream], () => {
    current();
    // Divide one allowance between the two tables, including on restarts.
    // Neither table's full cleanup is a prerequisite to checkpointing the other.
    const chunks = discardRecoveryChunks(state, job.allocation, { maxRecords: Math.floor(maxRecords / 2) });
    const prefix = discardTranscriptPrefix(store, job.stream, job.key, { maxRecords: Math.ceil(maxRecords / 2) });
    if (chunks && prefix) {
      state.delete("recovery-allocation", job.key);
      state.delete("recovery-stage", job.key);
    }
    // Keep the deleting reference across partial cleanup and transaction loss.
    // Source/journal cursors and run counts are never reconstructed here.
    return { complete: chunks && prefix, stopped: false };
  }, { state, check: () => start.budget.check() });
}
