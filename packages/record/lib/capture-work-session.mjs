// Private owning worker session. Bootstrap has already registered this worker
// under the root lock and reaped its predecessor. Root selection and ordinary
// command routing remain separate; completion requires a fresh all-stage audit.
import { randomUUID } from "node:crypto";
import { RecordStore } from "./store.mjs";
import { RecordIndex } from "./index-db.mjs";
import { DerivedState } from "./derived-state.mjs";
import { CaptureSourceQueue } from "./capture-source-queue.mjs";
import { captureSourceWork } from "./capture-source-work.mjs";
import { CaptureIndexInventory } from "./capture-index-inventory.mjs";
import { CaptureIndexOutcomes } from "./capture-index-outcomes.mjs";
import { CaptureIndexReset } from "./capture-index-reset.mjs";
import { CaptureRun } from "./capture-run.mjs";
import { readCaptureStatus } from "./capture-status.mjs";
import { reconcileCaptureInterruption, selectCaptureWork } from "./capture-retry.mjs";
import { readCaptureAdmission } from "./capture-admission.mjs";
import { FAILURE_REASONS } from "./capture-failures.mjs";
import { CaptureCleanupQueue } from "./capture-cleanup-queue.mjs";
import { CaptureSourceDiscovery } from "./capture-source-discovery.mjs";
import { auditCaptureCompletion } from "./capture-completion.mjs";

export class CaptureWorkSession {
  constructor(start, { owner, selection, trigger = "manual", now = Date.now, unit = {}, roots = null } = {}) {
    if (typeof start?.root !== "string" || typeof start.workerNonce !== "string" || !start.workerNonce ||
        typeof start.pass?.runId !== "string" || !start.pass.runId ||
        typeof start.pass.finalize !== "boolean" || typeof start.pass.reset !== "boolean" || typeof now !== "function")
      throw new Error("capture work session requires a supervised pass");
    this.start = start; this.now = now; this.unit = unit;
    try {
      start.budget.check();
      this.store = new RecordStore(start.root, { owner });
      this.state = new DerivedState(start.root);
      this.index = new RecordIndex(this.store);
      const prior = readCaptureStatus(start.root);
      if (prior?.lastRun?.id === start.pass.runId && prior.lastRun.outcome !== "running")
        throw new Error("capture run identity already finished");
      const previous = start.pass.previous?.outcome === "failed" ? start.pass.previous.reason : null;
      // An observed child failure belongs to this pass. It cannot diagnose an
      // older abandoned admission merely because this child reconciles it.
      const reasonFor = id => id === start.pass.runId && FAILURE_REASONS.includes(previous) ? previous : "interrupted";
      reconcileCaptureInterruption(this.state, { reason: reasonFor(readCaptureAdmission(this.state)?.runId), now: now() });
      this.cleanup = new CaptureCleanupQueue(this.store, this.state);
      this.cleanup.reconcile(start, { reason: reasonFor(this.cleanup.active()?.runId), now: now() });
      this.queue = new CaptureSourceQueue(this.state, { owner, selection });
      const retirement = this.state.get("capture-sweep-retirement", owner);
      if (!start.pass.finalize && retirement?.sourceScope === this.queue.current().id &&
          retirement.runId === prior?.lastRun?.id && prior.lastRun.outcome !== "running") {
        this.state.transaction(() => {
          this.queue.finish();
          this.state.delete("capture-sweep-retirement", owner);
        });
        this.queue = new CaptureSourceQueue(this.state, { owner, selection });
      }
      if (roots !== null) {
        this.sourceDiscovery = new CaptureSourceDiscovery(this.queue, roots);
        this.sourceDiscovery.reconcile(start, { reason: reasonFor(this.sourceDiscovery.active()?.runId), now: now() });
      }
      // Retain a reset's scope even if derived inventory tables were lost.
      // Recreating membership may restart enumeration; it cannot erase reset
      // admission or the index token needed to recover a committed operation.
      const previousSource = this.state.get("capture-index-source", owner);
      const scope = this.state.get("capture-index-reset", "current")?.scope ??
        (previousSource && previousSource.sourceScope !== this.queue.current().id ? randomUUID() :
          this.state.get("index-inventory", "current")?.id ?? randomUUID());
      this.openIndexScope(scope);
      this.reset.reconcile(start, { reason: reasonFor(this.reset.current()?.attempt?.runId), now: now() });
      const failures = [this.state.get("capture-run-failure", "last"),
        this.state.get("capture-index-reset-failure", "last"), this.state.get("capture-cleanup-failure", "last"),
        this.state.get("capture-discovery-failure", "last")].filter(Boolean);
      const currentReason = start.pass.failure ?? failures.find(row => row.runId === start.pass.runId)?.reason ?? null;
      const previousReason = failures.find(row => row.runId === prior?.lastRun?.id)?.reason ??
        (prior?.lastRun?.id === start.pass.runId ? previous : null);
      this.run = new CaptureRun(start.root, this.state, { id: start.pass.runId, trigger,
        reclaimedLock: start.reclaimedLock ?? null, previousFailure: previousReason,
        currentFailure: currentReason ? { id: start.pass.runId, reason: currentReason } : null });
    } catch (error) { this.close(); throw error; }
  }

  openIndexScope(id) {
    this.inventory?.close();
    this.inventory = new CaptureIndexInventory(this.state, { id });
    this.outcomes = new CaptureIndexOutcomes(this.index, this.inventory);
    this.reset = new CaptureIndexReset(this.index, this.inventory);
    const binding = { sourceScope: this.queue.current().id, indexScope: id };
    if (JSON.stringify(this.state.get("capture-index-source", this.queue.owner)) !== JSON.stringify(binding))
      this.state.transaction(() => this.state.set("capture-index-source", this.queue.owner, binding));
  }

  sourceReady(input) {
    if (!input) return false;
    if (input.source === "aw") return true;
    // Native recovery keys bind the exact input, not every source sharing a
    // stream. A deleting allocation is a dependency, even if its directory is
    // already gone: admitting cleanup-only capture would starve its due retry.
    const claim = this.state.get("recovery-allocation", `${input.stream}:${input.path}`);
    if (claim?.phase !== "deleting") return true;
    if (claim.stream !== input.stream || !/^[a-f0-9]{32}$/.test(claim.id))
      throw new Error("invalid native cleanup dependency");
    return false;
  }

  process(stage, allowRetry) {
    const options = { ...this.unit, now: this.now(), allowRetry,
      inputReady: input => this.sourceReady(input),
      retryFilter: retry => retry.stage === stage && (stage !== "capture" || this.sourceReady(this.queue.forStream(retry.stream))) };
    const result = stage === "capture"
      ? captureSourceWork(this.store, this.state, this.queue, this.run, this.start, { ...options, indexInventory: this.inventory })
      : this.outcomes.advance(this.run, this.start, options);
    if (result.resetRequired) this.reset.request(this.start);
    // One independent bounded cleanup turn cannot change stream-stage rotation.
    // A throw retains the already-committed source/index counts and its own
    // admission, so a replacement can back off deletion and keep healthy work.
    const cleanupWork = result.selected ? this.clean(false) : null;
    return { stage, ...result, cleanupWork };
  }

  clean(retry) {
    return this.cleanup.advance(this.run, this.start, { now: this.now(), retry,
      maxRecords: Math.max(2, this.unit.maxRecords ?? 2000) });
  }

  collect() {
    if (this.state.db.prepare("SELECT 1 AS found FROM state WHERE kind IN ('source-queue-garbage','index-inventory-garbage') LIMIT 1").get()?.found !== 1)
      return null;
    return this.state.transaction(() => {
      const sources = this.queue.cleanup(), streams = this.inventory.cleanup();
      // Retiring obsolete enumeration is bookkeeping, not new capture/index
      // progress. In particular it must not refresh every no-op pass's history.
      return { stage: "inventory-cleanup", sources, streams };
    });
  }

  step() {
    const stopped = () => this.start.budget.sample() !== null;
    if (stopped()) return { stopped: true };
    if (this.reset.current()) {
      const result = this.reset.advance(this.run, this.start, { now: this.now() });
      if (result.reset) { this.openIndexScope(result.scope); return { stage: "reset", ...result }; }
      if (!this.start.pass.finalize && result.needsFreshWorker) return { resetRequired: true };
    }
    // A committed reset token may finish bounded publication above. Neither
    // source/index work nor new atomic reset may use finalization allowance.
    if (this.start.pass.finalize) return { finalize: true };

    const sourceDiscovery = this.sourceDiscovery && !this.queue.current().discovered
      ? this.sourceDiscovery.advance({ stopped, limit: this.unit.discoveryLimit ?? 128,
        runId: this.run.id, workerNonce: this.start.workerNonce, now: this.now() }) : null;
    let discovery = null;
    if (this.inventory.current().phase !== "complete") discovery = this.inventory.discover(this.index, { stopped });
    if (stopped()) return { stopped: true, discovery, sourceDiscovery };
    const blockedIndex = this.reset.current() !== null;
    // Reuse the last durable admission's stage. Failed groups rotate too, and
    // routing adds no separate per-record or per-unit scheduling transaction.
    const last = this.state.get("capture-schedule", "position")?.stage;
    for (const stage of last === "capture" ? ["index", "capture"] : ["capture", "index"]) {
      if (stage === "index" && blockedIndex) continue;
      const result = this.process(stage, false);
      if (result.selected || result.resetRequired || result.stopped) return { ...result, discovery, sourceDiscovery };
    }
    if (stopped()) return { stopped: true, discovery, sourceDiscovery };
    const cleanup = this.clean(false);
    if (cleanup.selected || !cleanup.complete) return { stage: "cleanup", ...cleanup, discovery, sourceDiscovery };
    if (stopped()) return { stopped: true, discovery, sourceDiscovery };
    const collected = this.collect();
    if (collected) return { ...collected, discovery, sourceDiscovery };
    // Unknown eligible discovery can still contain healthy work. A refused
    // root remains pending but cannot withhold unrelated due work indefinitely.
    if ((this.sourceDiscovery ? this.sourceDiscovery.healthyPending() : !this.queue.current().discovered) ||
        this.inventory.current().phase !== "complete")
      return { waitingForDiscovery: true, discovery, sourceDiscovery };
    const selection = selectCaptureWork(this.store, this.state, [], { runId: this.run.id, now: this.now(), stopped,
      retryFilter: retry => retry.stage === "index" ? !blockedIndex :
        retry.stage === "capture" && this.sourceReady(this.queue.forStream(retry.stream)) });
    if (selection) return { ...this.process(selection.stage, true), discovery, sourceDiscovery };
    const cleanupRetry = this.clean(true);
    if (cleanupRetry.selected || !cleanupRetry.complete) return { stage: "cleanup", ...cleanupRetry, discovery, sourceDiscovery };
    if (this.sourceDiscovery && !this.queue.current().discovered) {
      if (sourceDiscovery?.source) return { waitingForDiscovery: true, discovery, sourceDiscovery };
      const retried = this.sourceDiscovery.advance({ stopped, limit: this.unit.discoveryLimit ?? 128,
        runId: this.run.id, workerNonce: this.start.workerNonce, now: this.now(), retry: true });
      if (retried.source) return { waitingForDiscovery: true, discovery, sourceDiscovery: retried };
    }
    return { idle: true, discovery, sourceDiscovery };
  }

  // Yield/stop never infer completion. The owning worker calls complete() only
  // when it wants a final all-stage decision; idle is merely a scheduling hint.
  yieldWorker({ resetRequired = false } = {}) {
    if (this.start.pass.finalize) return this.finish({ reason: "deadline" });
    if (this.start.budget.reason === "interrupted") return this.finish({ reason: "interrupted" });
    this.run.publish({ pending: true, peakRssBytes: this.start.budget.peakRssBytes });
    return { outcome: "partial", reason: this.start.budget.reason ?? "deadline", continuation: true,
      ...(resetRequired ? { resetRequired: true } : {}) };
  }

  finish({ reason = "input" } = {}) {
    const snapshot = this.run.finish({ outcome: reason === "interrupted" ? "failed" : "partial", reason,
      pending: true, peakRssBytes: this.start.budget.peakRssBytes });
    return { outcome: snapshot.lastRun.outcome, reason: snapshot.lastRun.reason, continuation: false };
  }

  complete(options) {
    if (this.start.pass.finalize || this.start.budget.sample() !== null)
      return this.finish({ reason: this.start.budget.reason ?? "deadline" });
    const audit = auditCaptureCompletion(this, options);
    if (audit.stopped || audit.needsWork) return this.yieldWorker();
    // Normally these facts entered the run during replacement construction.
    // Also retain a caught failure if an owning caller continues in this worker.
    const failure = ["capture-run-failure", "capture-index-reset-failure", "capture-cleanup-failure", "capture-discovery-failure"]
      .map(kind => this.state.get(kind, "last")).find(row => row?.runId === this.run.id);
    const snapshot = this.run.finish({ outcome: failure ? "failed" : audit.complete ? "complete" : "partial",
      reason: failure?.reason ?? (audit.complete ? null : "input"),
      pending: audit.pending, peakRssBytes: this.start.budget.peakRssBytes });
    return { outcome: snapshot.lastRun.outcome, reason: snapshot.lastRun.reason, continuation: false };
  }

  close() {
    this.sourceDiscovery?.close();
    this.inventory?.close();
    try { this.index?.close(); } finally { this.state?.close(); }
    this.index = null; this.state = null;
  }
}
