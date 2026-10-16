// Shared operational-failure projection and fixed retry schedule. This module
// opens no database and creates no failure evidence: callers may persist a row
// only for an actually failed, durably admitted SINGLE-stream unit. Its offset
// is the unit start, never an assertion about the exact failing inner frame.
export const FAILURE_REASONS = ["heap", "rss", "deadline", "interrupted", "io"];
const INTERVAL_MS = 900_000;

export function retryAfterAttempt(attempts, now = Date.now()) {
  if (!Number.isSafeInteger(attempts) || attempts < 1 || !Number.isSafeInteger(now) || now < 0) {
    throw new Error("invalid capture retry time");
  }
  return new Date(now + INTERVAL_MS * 2 ** Math.min(attempts, 4)).toISOString();
}

export function validFailure(row) {
  return row !== null && typeof row === "object" && typeof row.stream === "string" && row.stream.length > 0 &&
    Number.isSafeInteger(row.offset) && row.offset >= 0 && FAILURE_REASONS.includes(row.reason) &&
    Number.isSafeInteger(row.attempts) && row.attempts > 0 && typeof row.nextRetryAt === "string" &&
    Number.isFinite(Date.parse(row.nextRetryAt)) && new Date(row.nextRetryAt).toISOString() === row.nextRetryAt;
}

// Skipping a deferred unit must not call this function: only an actual failed
// attempt increments the count or moves its retry date. Journal generation and
// durable admission identity remain private state alongside the public row.
export function failureAfterAttempt(previous, { stream, offset, reason }, now = Date.now()) {
  if (previous !== null && previous !== undefined && (!validFailure(previous) || previous.stream !== stream)) {
    throw new Error("invalid previous capture failure");
  }
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("invalid capture failure time");
  const attempts = (previous?.attempts ?? 0) + 1;
  const next = { stream, offset, reason, attempts,
    nextRetryAt: retryAfterAttempt(attempts, now) };
  if (!validFailure(next)) throw new Error("invalid capture failure");
  return next;
}

export function validFailureBacklog(backlog, { legacy = false } = {}) {
  if (!backlog || typeof backlog !== "object") return false;
  if (legacy && !["failedCount", "failed", "failedTruncated"].some(key => Object.hasOwn(backlog, key))) return true;
  return Number.isSafeInteger(backlog.failedCount) && backlog.failedCount >= 0 && Array.isArray(backlog.failed) &&
    backlog.failed.length === Math.min(backlog.failedCount, 100) && backlog.failed.every(validFailure) &&
    backlog.failedTruncated === (backlog.failedCount > 100);
}

export const emptyFailureBacklog = () => ({ failedCount: 0, failed: [], failedTruncated: false });
