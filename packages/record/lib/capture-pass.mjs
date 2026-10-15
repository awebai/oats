// Private continuation transport. Reconciliation, durable fairness, failure
// attribution and status remain worker responsibilities. The parent never
// promotes a transient result into journal/checkpoint evidence.
import { randomUUID } from "node:crypto";
import { CAPTURE_POLICY } from "./capture-budget.mjs";
import { acquireCaptureLock } from "./capture-lock.mjs";
import { captureMonotonicMs, superviseCapture } from "./capture-supervisor.mjs";

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
  const lock = acquire(root);
  if (!lock.release) return { outcome: "overlap", reason: null, exitCode: 0, starts: 0, held: lock.held };
  let starts = 0, registered, publicationFailed = false, interrupted = false, firstFailure = null;
  let previous = null, result = { outcome: "partial", reason: "deadline", exitCode: 0 };
  const onSignal = () => { interrupted = true; };
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
    if (response.outcome === "failed") firstFailure ??= response.reason;
    return response;
  };
  try {
    process.on("SIGINT", onSignal); process.on("SIGTERM", onSignal);
    // Keep one start and time for a worker to reconcile/write final facts.
    // A normal child is admitted only with its full allowance; in particular,
    // atomic reset must not be admitted as a shortened last-minute operation.
    while (!interrupted && starts < maxStarts - 1 && clock() + hardMs + finalReserveMs <= deadline) {
      result = await attempt(false);
      if (publicationFailed || interrupted) break;
      // A worker may finish an honestly failed pass after committing healthy
      // independent work and exhausting ready work. That explicit terminal
      // result needs no idle retries; an unexplained crash still continues.
      if (result.outcome === "complete" || result.outcome === "partial" && !result.continuation ||
          result.outcome === "failed" && result.continuation === false) {
        return firstFailure ? { outcome: "failed", reason: firstFailure, exitCode: 1, starts } : { ...result, starts };
      }
      // On a crash the next child reconciles durable admission, then selects
      // independent ready work. There is NO same-pass retry/diagnostic class.
    }
    if (!interrupted && !publicationFailed && starts < maxStarts && clock() < deadline) {
      result = await attempt(true);
      // Finalization cannot certify a sweep that this continuation transport
      // stopped early. The worker likewise must not manufacture lastSuccess.
      if (result.outcome === "complete") {
        result = { outcome: "failed", reason: "io", exitCode: 1 }; firstFailure ??= "io";
      }
    }
    if (interrupted) return { outcome: "failed", reason: "interrupted", exitCode: 1, starts };
    if (firstFailure) return { outcome: "failed", reason: firstFailure, exitCode: 1, starts };
    return { ...result, starts };
  } finally {
    process.off("SIGINT", onSignal); process.off("SIGTERM", onSignal);
    const released = lock.release();
    if (!released.released) throw Object.assign(new Error("capture pass could not release its lock"), { release: released });
  }
}
