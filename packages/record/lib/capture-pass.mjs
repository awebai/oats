// Private continuation transport. Reconciliation, durable fairness, failure
// attribution and status remain worker responsibilities. The parent never
// promotes a transient result into journal/checkpoint evidence; it only moves
// an unreadable status aside, under the lock and before any worker.
import { randomUUID } from "node:crypto";
import { CAPTURE_POLICY } from "./capture-budget.mjs";
import { acquireCaptureLock } from "./capture-lock.mjs";
import { cleanupCaptureScratch } from "./capture-scratch.mjs";
import { setAsideInvalidCaptureStatus } from "./capture-status.mjs";
import { captureMonotonicMs, captureSignalPoll, superviseCapture } from "./capture-supervisor.mjs";

// Internal scheduling choices, not public tuning or portable timing promises.
const ALLOWANCES = Object.freeze({ workMs: 60_000, finalizeMs: 70_000, hardMs: 75_000,
  finalReserveMs: 15_000, finalDrainMs: 10_000, maxStarts: 8 });

export async function superviseCapturePass(root, options, {
  policy = CAPTURE_POLICY, clock = captureMonotonicMs, acquire = acquireCaptureLock,
  allowances = ALLOWANCES, drainSeconds = 5, ...transport
} = {}) {
  const { workMs, finalizeMs, hardMs, finalReserveMs, finalDrainMs, maxStarts } = allowances;
  if (![workMs, finalizeMs, hardMs, finalReserveMs, finalDrainMs].every(n => Number.isFinite(n) && n > 0) ||
      workMs > finalizeMs || finalizeMs > hardMs || finalDrainMs > finalReserveMs ||
      !Number.isSafeInteger(maxStarts) || maxStarts < 2 || maxStarts > 8) throw new Error("invalid internal capture scheduling allowances");
  const started = clock(), deadline = started + policy.deadlineSeconds * 1000;
  const drainAt = Math.max(started, deadline - drainSeconds * 1000), runId = randomUUID();
  // TERM/INT is observed from before acquisition until after release: it ends
  // admission of further workers; the current one is stopped by its supervisor.
  let interrupted = false;
  const onSignal = () => { interrupted = true; };
  process.on("SIGINT", onSignal); process.on("SIGTERM", onSignal);
  try {
    return await superviseAcquiredPass(root, options, { policy, clock, acquire, allowances, transport,
      started, deadline, drainAt, runId, interrupted: () => interrupted });
  } finally { process.off("SIGINT", onSignal); process.off("SIGTERM", onSignal); }
}

async function superviseAcquiredPass(root, options, { policy, clock, acquire, allowances, transport,
  started, deadline, drainAt, runId, interrupted: signalled }) {
  const { workMs, finalizeMs, hardMs, finalReserveMs, finalDrainMs, maxStarts } = allowances;
  const lock = acquire(root);
  if (!lock.release) return { outcome: "overlap", reason: null, exitCode: 0, starts: 0, held: lock.held };
  let starts = 0, registered, publicationFailed = false, interrupted = false, firstFailure = null, failureMessage;
  let previous = null, result = { outcome: "partial", reason: "deadline", exitCode: 0 };
  // A signal pending from synchronous preparation dispatches only at a poll.
  const polled = async () => { await captureSignalPoll(); interrupted ||= signalled(); return interrupted; };
  const attempt = async finalize => {
    const launch = clock();
    starts++;
    const window = finalize
      ? { drainAt: Math.min(drainAt, launch + finalDrainMs), finalizeAt: Math.min(deadline, launch + finalDrainMs), hardAt: Math.min(deadline, launch + finalReserveMs) }
      : { drainAt: Math.min(drainAt, launch + workMs), finalizeAt: Math.min(deadline, launch + finalizeMs), hardAt: Math.min(deadline, launch + hardMs) };
    const response = await superviseCapture(root, options, { ...transport, policy, clock, window,
      pass: { runId, attempt: starts, finalize, reset: !finalize && previous?.resetRequired === true, started, deadline, drainAt,
        failure: firstFailure,
        // Only observed process outcome, never an asserted failed member/frame.
        previous: previous && { outcome: previous.outcome, reason: previous.reason } },
      acquire: () => ({ ...lock,
        registerWorker: worker => {
          try { lock.registerWorker(worker, { previous: registered }); registered = worker; }
          catch (error) { publicationFailed = true; throw error; }
        },
        release: () => ({ released: true }), // outer owner releases once, after all children are reaped
      }),
    });
    previous = response;
    if (response.outcome === "failed" && firstFailure === null) { firstFailure = response.reason; failureMessage = response.message; }
    return response;
  };
  // A worker's private diagnostic accompanies only the first failure it explains.
  // A status moved aside by this pass is reported with whatever it returns.
  let invalidStatus = null;
  const failed = () => ({ outcome: "failed", reason: firstFailure, exitCode: 1, starts,
    ...(failureMessage ? { message: failureMessage } : {}), ...(invalidStatus ? { invalidStatus } : {}) });
  const ended = value => invalidStatus ? { ...value, invalidStatus } : value;
  try {
    // Under the root lock and before this pass starts any child: reclaim
    // per-call scratch whose allocating process is proven dead (killed workers).
    cleanupCaptureScratch(root, lock);
    invalidStatus = setAsideInvalidCaptureStatus(root);
    // Keep one start and time for a worker to reconcile/write final facts.
    // A normal child is admitted only with its full allowance; in particular,
    // atomic reset must not be admitted as a shortened last-minute operation.
    while (!await polled() && starts < maxStarts - 1 && clock() + hardMs + finalReserveMs <= deadline) {
      result = await attempt(false);
      if (publicationFailed || await polled()) break;
      // A worker may finish an honestly failed pass after committing healthy
      // independent work and exhausting ready work. That explicit terminal
      // result needs no idle retries; an unexplained crash still continues.
      if (result.outcome === "complete" || result.outcome === "partial" && !result.continuation ||
          result.outcome === "failed" && result.continuation === false) {
        return firstFailure ? (result.rootCoverageOnly === true ? ended({ ...result, starts }) : failed()) : ended({ ...result, starts });
      }
      // On a crash the next child reconciles durable admission, then selects
      // independent ready work. There is NO same-pass retry/diagnostic class.
    }
    if (!await polled() && !publicationFailed && starts < maxStarts && clock() < deadline) {
      result = await attempt(true);
      // Finalization cannot certify a sweep that this continuation transport
      // stopped early. The worker likewise must not manufacture lastSuccess.
      if (result.outcome === "complete") {
        result = { outcome: "failed", reason: "io", exitCode: 1 }; firstFailure ??= "io";
      }
    }
    // An earlier observed failure cause of this pass is kept, not replaced.
    if (await polled() && !firstFailure) return ended({ outcome: "failed", reason: "interrupted", exitCode: 1, starts });
    if (firstFailure) return failed();
    return ended({ ...result, starts });
  } catch (error) {
    if (invalidStatus) error.invalidStatus ??= invalidStatus;
    throw error;
  } finally {
    const released = lock.release();
    if (!released.released) throw Object.assign(new Error("capture pass could not release its lock"), { release: released,
      ...(invalidStatus ? { invalidStatus } : {}) });
  }
}
