// One admitted source group in the command worker. This joins queue progress
// and run counters to durable capture checkpoints; discovery/index completion
// and final receipts remain the owning scheduler's responsibility.
import { captureAwUnit } from "./capture-aw-unit.mjs";
import { captureNativeUnit } from "./capture-native-unit.mjs";
import { withCaptureGroup, captureContext } from "./capture-context.mjs";
import { selectCaptureWork, resolveCaptureRetry } from "./capture-retry.mjs";
import { readCaptureRetry } from "./capture-admission.mjs";
import { fileVersion } from "./derived-state.mjs";
import { loadIgnore } from "./ignore.mjs";

export function captureSourceWork(store, state, queue, run, start, {
  limit = 128, maxRecords = 2000, maxBytes = 8388608, ignore = loadIgnore(store.root),
  now = Date.now(), work, indexInventory = null,
} = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 128 ||
      !Number.isSafeInteger(maxRecords) || maxRecords < limit || maxRecords > 2000 ||
      !Number.isSafeInteger(maxBytes) || maxBytes < limit || maxBytes > 8388608)
    throw new Error("invalid capture source work allowance");
  if (indexInventory !== null && (indexInventory.state !== state || typeof indexInventory.include !== "function"))
    throw new Error("capture source index inventory must belong to the current state");
  const budget = start.budget, stopped = () => budget.sample() !== null;
  if (stopped()) return { stopped: true, selected: 0, cleanup: [] };
  const inputs = new Map();
  function* candidates() {
    for (const input of queue.ready({ stopped, work })) {
      if (readCaptureRetry(state, input.stream) || inputs.has(input.stream)) continue;
      // At most one file from a shared stream belongs to an admission. The
      // durable queue position rotates AW accounts between such admissions.
      inputs.set(input.stream, input);
      const generation = fileVersion(store.journalPath(input.stream));
      yield { stream: input.stream, stage: "capture", offset: generation?.size ?? 0, generation, next: input.next };
    }
  }
  const selection = selectCaptureWork(store, state, candidates(), { runId: run.id, now, limit });
  if (!selection) return { selected: 0, cleanup: [] };
  // Retry selection spans stages. Return other-stage work to the scheduler;
  // never execute it as capture or clear its failure through the wrong path.
  if (selection.stage !== "capture") return { selected: 0, deferred: selection, cleanup: [] };
  if (selection.retry) {
    const input = queue.forStream(selection.members[0].stream);
    if (!input) return { selected: 0, deferred: selection, cleanup: [] };
    inputs.set(input.stream, input);
    selection.next = input.next;
  }
  const recordsEach = Math.floor(maxRecords / selection.members.length);
  const bytesEach = Math.floor(maxBytes / selection.members.length);
  return withCaptureGroup(store, selection.members.map(member => member.stream), () => {
    const results = [], cleanup = [];
    for (const member of selection.members) {
      if (stopped()) break;
      const input = inputs.get(member.stream), before = state.db.prepare("SELECT total_changes() AS n").get().n;
      const options = { owner: queue.owner, path: input.path, ignore, maxRecords: recordsEach,
        maxBytes: bytesEach, maxRecordBytes: budget.policy.maxRecordBytes, stopped, work: work?.content };
      const result = input.source === "aw"
        ? captureAwUnit(store, { ...options, kind: input.details.kind,
          selfName: input.details.selfName, workspace: input.details.workspace })
        : captureNativeUnit(store, { ...options, format: input.source, capturedPi: input.details.capturedPi, start });
      // Inspect mutation before visits/counters: repeatedly visiting an
      // unchanged or deferred input is not processing progress.
      const progressed = state.db.prepare("SELECT total_changes() AS n").get().n !== before;
      const outcome = result.ignored ? "ignored" : result.setAside ? "set-aside" :
        result.pending ? "pending" : result.complete ? (result.failed ? "failed" : "complete") : "ready";
      queue.mark(input.position, outcome);
      const delta = queue.visit(input.position, run.id, { inputsIgnored: !!result.ignored,
        inputsSetAside: !!result.setAside, inputsPending: !!result.pending, inputsFailed: !!result.failed });
      run.record({ ...delta, bytesCommitted: result.bytesCommitted, turnsAppended: result.appended },
        { progress: progressed, peakRssBytes: budget.peakRssBytes });
      if (selection.retry && result.complete) {
        // Completing the fixed input validates that this source admission no
        // longer needs work. A partial prefix proof cannot clear the failure.
        resolveCaptureRetry(state, { id: captureContext(store).admission.id, stream: member.stream, reconciled: true });
      }
      if (result.cleanup) cleanup.push({ stream: member.stream, key: result.key });
      results.push({ position: input.position, ...result });
    }
    // Include every committed input, including replay with no new append.
    // Journal bytes may survive an earlier rolled-back source transaction.
    if (indexInventory) indexInventory.include(results.map(result => result.stream));
    return { selected: selection.members.length, results, cleanup };
  }, { state, admission: selection, admissionNow: now, batchBytes: maxBytes, check: () => budget.check() });
}
