// Private foreground command presentation shared by manual/watch, setup and service.
// Only the still-held-lock worker projection supplies counts, never a later
// status read or a guessed zero when transport failed before publication.
import { runCaptureCommand } from "./capture-command.mjs";

export function reportLockInitializationFailure(err, error = console.error) {
  if (!err.lockCleanup) return;
  const c = err.lockCleanup;
  const outcome = c.removed ? "the initializing lock was removed"
    : c.reason === "gone" ? "the initializing lock was already gone (removed by another party)"
    : c.reason === "replaced" ? (c.owner
      ? `the lock now belongs to pid ${c.owner.pid} (started ${c.owner.startedAt || "?"}) and was left alone`
      : "the lock directory changed or its identity could not be verified, no owner record was readable, and it was left alone")
    : `the initializing lock could NOT be removed${c.error ? ` (${c.error})` : ""}; ${c.recovery}`;
  error(`capture: could not write the owner record of ${c.path}: ${err.message}; ${outcome}`);
}

export function reportReclaimedLock(r, error = console.error) {
  if (r) error(`capture: reclaimed ${r.path} from pid ${r.pid}, which died (started ${r.startedAt || "?"})`);
}

// A status this pass moved aside, said by the pass that moved it. A pass that
// then failed has not written the new status.
function reportInvalidStatus(moved, error = console.error, { failed = false } = {}) {
  if (moved) error(`capture: the capture status was unreadable (${moved.reason}); moved it aside to ${moved.path}${failed ? "" : " and started a new status"}` +
    (moved.stale ? `; older moved-aside copies could not be removed: ${moved.stale.join(", ")}` : ""));
}

export function releaseDetail(r) {
  return r.reason === "gone" ? "it was already removed by another party (an operator recovery?); nothing to release"
    : r.reason === "not-owner" ? `it now belongs to pid ${r.owner.pid} (started ${r.owner.startedAt || "?"}); left alone`
    : r.reason === "unknown-owner" ? `its owner record is missing or unreadable, so it may be an operator removal in progress or a newer pass initializing; left alone; ${r.recovery}`
    : `${r.error ? `${r.error}; ` : ""}${r.recovery}`;
}

export async function captureCommandPass(root, options, { log = console.log, error = console.error, run = runCaptureCommand, entry } = {}) {
  let result;
  // Every foreground command attributes its lock, naming its entry when known.
  try { result = await run(root, options, { entry, attribute: true }); }
  catch (failure) {
    reportLockInitializationFailure(failure, error);
    reportReclaimedLock(failure.reclaimedLock, error);
    reportInvalidStatus(failure.invalidStatus, error, { failed: true });
    if (failure.release) error(`capture: did not release lock at ${root} (${failure.release.reason}): ${releaseDetail(failure.release)}`);
    throw failure;
  }
  reportReclaimedLock(result.reclaimedLock, error);
  reportInvalidStatus(result.invalidStatus, error, { failed: result.exitCode !== 0 || result.outcome === "failed" });
  if (result.outcome === "overlap") {
    const line = `capture: another pass holds ${root}: ${result.held.recovery}; skipping this pass`;
    if (result.held.liveness === "alive") log(line); else error(line);
    return { skipped: true };
  }
  if (result.rootCoverageOnly === true && result.outcome === 'failed') {
    throw Object.assign(new Error('Registered root coverage is incomplete; inspect capture health and root warnings. Healthy independent work was processed.'),
      { code: 'E_CAPTURE_ROOTS_COVERAGE', receipt: result.receipt });
  }
  if (result.exitCode !== 0 || result.outcome === "failed")
    throw new Error(`capture worker failed (${result.reason ?? "io"})${result.message ? `: ${result.message}` : ""}; ${result.receipt ? "see capture health for confirmed progress" : "matching worker receipt unavailable; appended count is unknown"}`);
  const receipt = result.receipt;
  if (!receipt || !Number.isSafeInteger(receipt.appended) || receipt.appended < 0 || typeof receipt.pending !== "boolean")
    throw new Error("matching worker receipt unavailable; appended count is unknown");
  log(`capture: ${receipt.appended} new turns; ${result.outcome}${result.reason ? ` (${result.reason})` : ""}`);
  if (options.indexEnabled) log(result.outcome === "complete" ? "index: updated" : "index: pending; see capture health");
  return { appended: receipt.appended, pending: receipt.pending };
}
