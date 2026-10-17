// One admitted index group, with confirmed run accounting. The caller owns a
// finite fair union of live/indexed streams, its sweep checkpoints, atomic reset
// admission and final completion. Returning no selection is not root completion.
import { withCaptureGroup, captureContext } from "./capture-context.mjs";
import { indexCaptureGroup } from "./index-capture.mjs";
import { selectCaptureWork, resolveCaptureRetry } from "./capture-retry.mjs";
import { readCaptureRetry } from "./capture-admission.mjs";
import { fileVersion, sameVersion } from "./derived-state.mjs";

function unitStart(index, state, stream, generation) {
  const checkpoint = state.get("journal", stream);
  // Journal recovery precedes indexing. An invalidated generation starts at
  // zero; an interrupted validation starts at its saved byte boundary, even
  // when an older index cursor points farther ahead.
  if (!checkpoint || !sameVersion(checkpoint.version, generation) ||
      !Number.isSafeInteger(checkpoint.bytes) || checkpoint.bytes < 0 || checkpoint.bytes > (generation?.size ?? 0) ||
      !Number.isSafeInteger(checkpoint.count) || checkpoint.count < 0 || checkpoint.count > checkpoint.bytes ||
      typeof checkpoint.epoch !== "string" || typeof checkpoint.complete !== "boolean" ||
      checkpoint.resetting !== undefined && typeof checkpoint.resetting !== "boolean" || checkpoint.resetting) return 0;
  if (!checkpoint.complete) return checkpoint.bytes;
  const row = index.db.prepare(`SELECT b.bytes,b.epoch,b.indexed_count,s.indexed_count AS count
    FROM index_bytes b JOIN index_state s ON s.stream=b.stream WHERE b.stream=?`).get(stream);
  return row?.epoch === checkpoint.epoch && Number.isSafeInteger(row.bytes) && row.bytes >= 0 &&
    row.bytes <= checkpoint.bytes && Number.isSafeInteger(row.count) && row.count >= 0 &&
    row.count === row.indexed_count && row.count <= checkpoint.count ? row.bytes : 0;
}

export function captureIndexWork(index, state, streams, run, start, {
  limit = 128, maxRecords = 2000, maxBytes = 8388608, now = Date.now(), outcomes = null, allowRetry = true, retryFilter,
} = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 128 ||
      !Number.isSafeInteger(maxRecords) || maxRecords < limit || maxRecords > 2000 ||
      !Number.isSafeInteger(maxBytes) || maxBytes < limit || maxBytes > 8388608)
    throw new Error("invalid capture index work allowance");
  const store = index.store, budget = start.budget, stopped = () => budget.sample() !== null;
  if (outcomes !== null && (outcomes.index !== index || outcomes.state !== state || typeof outcomes.record !== "function"))
    throw new Error("capture index outcomes must belong to the current index and state");
  if (stopped()) return { stopped: true, selected: 0 };
  function* candidates() {
    for (const stream of streams) {
      if (stopped()) return;
      if (readCaptureRetry(state, stream)) continue;
      const generation = fileVersion(store.journalPath(stream));
      // This is an attribution boundary, not permission to consume an index
      // cursor. The group validates count/epoch/boundary before using that row.
      const offset = unitStart(index, state, stream, generation);
      yield { stream, stage: "index", offset, generation, next: { stage: "index", after: stream } };
    }
  }
  const selection = selectCaptureWork(store, state, candidates(), { runId: run.id, now, limit, allowRetry, retryFilter, stopped });
  if (!selection) return { selected: 0 };
  // The common retry queue can return a different stage when this healthy
  // sweep is exhausted. Never erase that failure through index processing.
  if (selection.stage !== "index") return { selected: 0, deferred: selection };
  return withCaptureGroup(store, selection.members.map(member => member.stream), () => {
    const before = state.db.prepare("SELECT total_changes() AS n").get().n;
    const result = indexCaptureGroup(index, selection.members.map(member => member.stream), {
      maxRecords, maxBytes, stopped,
      // A detecting unit, including a due retry, cannot reserve the fresh full
      // worker allowance required for an atomic union reset.
      allowReset: false,
    });
    const progressed = result.bytesIndexed > 0 || state.db.prepare("SELECT total_changes() AS n").get().n !== before;
    if (selection.retry && result.streams[0].phase === "complete") {
      // Complete means the current validated journal is fully indexed. A
      // partial validation/index cursor or reset request cannot resolve retry.
      resolveCaptureRetry(state, { id: captureContext(store).admission.id,
        stream: selection.members[0].stream, reconciled: true });
    }
    // turns.db has committed before these facts enter capture.db's commit.
    // Failure between commits leaves admission for reconciliation; a later
    // no-op must not reconstruct the missing count from existing index rows.
    run.record({ turnsIndexed: result.turnsIndexed }, { progress: progressed, peakRssBytes: budget.peakRssBytes });
    if (outcomes) outcomes.record(result);
    return { selected: selection.members.length, ...result };
  }, { state, admission: selection, admissionNow: now, batchBytes: maxBytes, check: () => budget.check() });
}
