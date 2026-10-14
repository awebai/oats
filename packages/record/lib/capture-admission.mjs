// Private durable admission, separate from processing checkpoints. The command
// scheduler owns the root lock and chooses bounded work; this module neither
// schedules retries nor diagnoses a group interruption as member failures.
import { randomUUID } from "node:crypto";

const stages = new Set(["capture", "validation", "index", "prefix", "reset"]);
const validVersion = value => value === null || value &&
  ["dev", "ino", "mtime", "ctime"].every(key => typeof value[key] === "string" && value[key].length > 0) &&
  Number.isSafeInteger(value.size) && value.size >= 0;

export function readCaptureRetry(state, stream) {
  const row = state.get("capture-retry", stream);
  if (row !== null && (!row || row.stream !== stream || !stages.has(row.stage) ||
      !validVersion(row.generation) || !Number.isSafeInteger(row.offset) || row.offset < 0 ||
      row.offset > (row.generation?.size ?? 0) ||
      !["unitId", "attemptedRun"].every(key => typeof row[key] === "string" && row[key]) ||
      typeof row.nextRetryAt !== "string" || !Number.isFinite(Date.parse(row.nextRetryAt)) ||
      new Date(row.nextRetryAt).toISOString() !== row.nextRetryAt)) {
    throw new Error("invalid deferred capture work");
  }
  return row;
}

function validSelection(selection) {
  return selection && typeof selection.runId === "string" && selection.runId.length > 0 &&
    (selection.retry === undefined || typeof selection.retry === "boolean") &&
    stages.has(selection.stage) && selection.next && stages.has(selection.next.stage) &&
    typeof selection.next.after === "string" && Array.isArray(selection.members) &&
    selection.members.length > 0 && selection.members.length <= 128 &&
    new Set(selection.members.map(member => member?.stream)).size === selection.members.length &&
    selection.members.every(member => typeof member?.stream === "string" && member.stream.length > 0 &&
      Number.isSafeInteger(member.offset) && member.offset >= 0 && validVersion(member.generation) &&
      member.offset <= (member.generation?.size ?? 0));
}

export function readCaptureAdmission(state) {
  const row = state.get("capture-admission", "active");
  if (row !== null && (!validSelection(row) || typeof row.id !== "string" || !row.id)) {
    throw new Error("invalid durable capture admission");
  }
  return row;
}

// Called only after ALL member locks are held, before the processing DB
// transaction. Committing inside the latter would leave only volatile intent.
export function commitCaptureAdmission(state, selection, held, { now = Date.now() } = {}) {
  if (state.depth) throw new Error("capture admission must precede the processing transaction");
  if (!validSelection(selection) || selection.members.length !== held.size ||
      selection.members.some(member => !held.has(member.stream))) throw new Error("invalid capture admission selection");
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("invalid capture admission time");
  const row = { id: randomUUID(), runId: selection.runId, stage: selection.stage, retry: selection.retry === true,
    next: { stage: selection.next.stage, after: selection.next.after },
    members: selection.members.map(({ stream, offset, generation }) => ({ stream, offset, generation })) };
  state.transaction(() => {
    // The next worker must reconcile this evidence before admitting new work.
    // Overwriting it would lose both crash attribution and queue progress.
    if (readCaptureAdmission(state)) throw new Error("unreconciled capture admission");
    for (const member of row.members) {
      const retry = readCaptureRetry(state, member.stream);
      if (retry) {
        if (!row.retry || row.members.length !== 1 || retry.stage !== row.stage || retry.attemptedRun === row.runId ||
            !Number.isFinite(Date.parse(retry.nextRetryAt)) || now < Date.parse(retry.nextRetryAt)) {
          throw new Error("deferred capture work requires a due single-stream admission");
        }
        state.set("capture-retry", member.stream, { ...retry, attemptedRun: row.runId });
      } else if (row.retry) throw new Error("capture retry no longer exists");
    }
    state.set("capture-admission", "active", row);
    state.set("capture-schedule", "position", row.next);
    if (row.retry) state.set("capture-schedule", "retry-after", row.members[0].stream);
  });
  return row;
}

// Clear the admitted work in the SAME commit as its completed checkpoints.
// On a throw or process death, rollback keeps admission and its fairness
// position, while journal bytes that were already fsynced remain authoritative.
export function finishCaptureAdmission(state, id) {
  if (!state.depth || readCaptureAdmission(state)?.id !== id) throw new Error("capture admission changed before completion");
  state.delete("capture-admission", "active");
}
