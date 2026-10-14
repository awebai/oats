// Private retry queue for the root-lock-owning worker. A predecessor must have
// exited before reconciliation: a durable group start proves no member failed.
// There is no diagnostic execution mode; due members use normal single-stream
// admissions after healthy work. Public synchronous writers do not enter here.
import { readCaptureAdmission, readCaptureRetry } from "./capture-admission.mjs";
import { failureAfterAttempt, retryAfterAttempt, FAILURE_REASONS } from "./capture-failures.mjs";
import { fileVersion, sameVersion } from "./derived-state.mjs";
import { keysetRows } from "./sqlite-rows.mjs";

export function reconcileCaptureInterruption(state, { reason = "interrupted", now = Date.now() } = {}) {
  if (state.depth) throw new Error("interruption reconciliation must precede processing");
  if (!FAILURE_REASONS.includes(reason)) throw new Error("invalid capture interruption reason");
  const active = readCaptureAdmission(state);
  if (!active) return null;
  return state.transaction(() => {
    if (readCaptureAdmission(state)?.id !== active.id) throw new Error("capture admission changed before reconciliation");
    const single = active.members.length === 1;
    const failure = { id: active.id, runId: active.runId, reason: single ? reason : "interrupted",
      memberCount: active.members.length };
    for (const member of active.members) {
      let nextRetryAt = retryAfterAttempt(1, now);
      if (single) {
        const row = failureAfterAttempt(state.get("capture-failed", member.stream), {
          stream: member.stream, offset: member.offset, reason,
        }, now);
        nextRetryAt = row.nextRetryAt;
        state.set("capture-failed", member.stream, { ...row, unitId: active.id,
          stage: active.stage, generation: member.generation });
      }
      state.set("capture-retry", member.stream, { ...member, stage: active.stage,
        unitId: active.id, attemptedRun: active.runId, nextRetryAt });
    }
    // This fact is consumed by the run/status writer. Unknown group membership
    // is pending work, never a collection of invented public failed rows.
    state.set("capture-run-failure", "last", failure);
    state.delete("capture-admission", "active");
    return failure;
  });
}

// candidates is the scheduler's finite, fairly ordered sweep, not a history
// inventory retained here. Scanning it entails metadata work; journal content
// is never read. The caller supplies the next sweep position with each item.
export function selectCaptureWork(store, state, candidates, { runId, now = Date.now(), limit = 128 } = {}) {
  if (typeof runId !== "string" || !runId || !Number.isSafeInteger(now) || now < 0 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 128) throw new Error("invalid capture queue selection");
  const members = [], seen = new Set(); let stage, next;
  for (const item of candidates) {
    if (readCaptureRetry(state, item.stream) || seen.has(item.stream)) continue;
    if (stage !== undefined && stage !== item.stage) break;
    stage = item.stage; next = item.next; seen.add(item.stream);
    members.push({ stream: item.stream, offset: item.offset, generation: item.generation });
    if (members.length === limit) break;
  }
  if (members.length) return { runId, stage, next, members };

  // Keyset iteration retains only a bounded page. Dates are not used to erase
  // rows, and an incomplete member cannot be admitted repeatedly in one pass.
  const after = state.get("capture-schedule", "retry-after") ?? "";
  if (typeof after !== "string") throw new Error("invalid capture retry position");
  function* deferred() {
    for (const comparison of [">", "<="]) {
      yield* keysetRows(state.db, `SELECT key FROM state WHERE kind = 'capture-retry' AND key ${comparison} ?`, "key", [after]);
    }
  }
  for (const { key } of deferred()) {
    const retry = readCaptureRetry(state, key);
    if (retry.attemptedRun === runId || now < Date.parse(retry.nextRetryAt)) continue;
    const generation = fileVersion(store.journalPath(retry.stream));
    return { runId, stage: retry.stage, retry: true,
      next: { stage: retry.stage, after: retry.stream },
      members: [{ stream: retry.stream, generation,
        offset: sameVersion(generation, retry.generation) ? retry.offset : 0 }] };
  }
  return null;
}

// Call inside the processing transaction only AFTER committing the stage's
// work through the failed snapshot, or validating that it no longer needs work.
// A checkpoint inside that snapshot cannot erase a multi-frame unit's failure.
// Index commits precede this capture-state transaction's commit; a crash between
// them conservatively leaves the retry visible for reconciliation.
export function resolveCaptureRetry(state, { id, stream, through, reconciled = false }) {
  const active = readCaptureAdmission(state), retry = readCaptureRetry(state, stream);
  if (!state.depth || active?.id !== id || !active.retry || active.members.length !== 1 ||
      active.members[0].stream !== stream || !retry || retry.attemptedRun !== active.runId) {
    throw new Error("capture retry resolution requires its active processing transaction");
  }
  if (!reconciled && (!sameVersion(active.members[0].generation, retry.generation) ||
      !Number.isSafeInteger(through) || through < (retry.generation?.size ?? 1))) return false;
  const failed = state.get("capture-failed", stream);
  if (failed && failed.unitId !== retry.unitId) throw new Error("capture failure changed before resolution");
  state.delete("capture-retry", stream);
  if (failed) state.delete("capture-failed", stream);
  return true;
}
