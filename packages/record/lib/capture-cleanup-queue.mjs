// Allocation-bound housekeeping admission, independent of journal-unit retries.
// Bootstrap owns the root lock and has ended the preceding worker. Neither a
// scan endpoint nor successful deletion proves source/index/pass completion.
import { randomUUID } from "node:crypto";
import { captureCleanupPage, cleanupCaptureRecovery } from "./capture-cleanup-work.mjs";
import { readCaptureAdmission } from "./capture-admission.mjs";
import { FAILURE_REASONS, retryAfterAttempt } from "./capture-failures.mjs";
import { CaptureStop } from "./capture-budget.mjs";

const kind = "capture-cleanup", retries = "capture-cleanup-retry";
const text = value => typeof value === "string" && value.length > 0;
const validJob = job => text(job?.key) && text(job.stream) && /^[a-f0-9]{32}$/.test(job.allocation);
const validDate = value => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

export class CaptureCleanupQueue {
  constructor(store, state) { this.store = store; this.state = state; }

  active() {
    const row = this.state.get(kind, "active");
    if (row !== null && (!validJob(row?.job) || ![row.id, row.runId, row.workerNonce].every(text)))
      throw new Error("invalid capture cleanup admission");
    return row;
  }

  retry(job) {
    const row = this.state.get(retries, job.allocation);
    if (row !== null && (!row || row.key !== job.key || row.stream !== job.stream || row.allocation !== job.allocation ||
        !text(row.attemptedRun) || !Number.isSafeInteger(row.attempts) || row.attempts < 1 ||
        !validDate(row.nextRetryAt))) throw new Error("invalid capture cleanup retry");
    return row;
  }

  worker(start, now) {
    if (this.state.depth || !text(start.workerNonce) || !text(start.pass?.runId) ||
        typeof start.pass.finalize !== "boolean" || !Number.isSafeInteger(now) || now < 0)
      throw new Error("capture cleanup requires a supervised worker outside processing");
    if (readCaptureAdmission(this.state)) throw new Error("capture cleanup requires stream admission reconciliation");
  }

  // A failed allocation operation is not a failed journal frame. Keep its
  // backoff private and its failure pass-bound, without changing stream rows.
  reconcile(start, { reason = "interrupted", now = Date.now() } = {}) {
    this.worker(start, now);
    start.budget.check();
    if (!FAILURE_REASONS.includes(reason)) throw new Error("invalid cleanup interruption reason");
    const active = this.active();
    if (!active) return null;
    if (active.workerNonce === start.workerNonce) throw new Error("capture cleanup worker has not been replaced");
    const attempts = (this.retry(active.job)?.attempts ?? 0) + 1;
    const failure = { id: active.id, runId: active.runId, reason };
    this.state.transaction(() => {
      this.state.set(retries, active.job.allocation, { ...active.job, attempts,
        attemptedRun: active.runId, nextRetryAt: retryAfterAttempt(attempts, now) });
      this.state.set("capture-cleanup-failure", "last", failure);
      this.state.delete(kind, "active");
    });
    return failure;
  }

  advance(run, start, { retry = false, now = Date.now(), limit = 128, maxRecords = 2000 } = {}) {
    this.worker(start, now);
    if (run.state !== this.state || run.id !== start.pass.runId || typeof retry !== "boolean" ||
        !Number.isSafeInteger(maxRecords) || maxRecords < 2 || maxRecords > 2000)
      throw new Error("invalid cleanup dispatch allowance");
    if (this.active()) throw new Error("unreconciled cleanup admission");
    if (start.pass.finalize) return { selected: 0, finalize: true, complete: false };
    const stopped = () => start.budget.sample() !== null;
    if (stopped()) return { selected: 0, stopped: true, complete: false };
    const position = retry ? "retry-after" : "after", after = this.state.get(kind, position) ?? "";
    const page = captureCleanupPage(this.state, { after, limit });
    let job, prior;
    for (const candidate of page.jobs) {
      if (stopped()) return { selected: 0, stopped: true, complete: false };
      const row = this.retry(candidate);
      if (retry ? row && row.attemptedRun !== run.id && now >= Date.parse(row.nextRetryAt) : !row) {
        job = candidate; prior = row; break;
      }
    }
    if (!job) {
      const next = page.complete ? "" : page.after;
      if (next !== after) this.state.transaction(() => this.state.set(kind, position, next));
      return { selected: 0, scanned: page.scanned, complete: page.complete };
    }
    const admission = { id: randomUUID(), runId: run.id, workerNonce: start.workerNonce, job };
    this.state.transaction(() => {
      const claim = this.state.get("recovery-allocation", job.key);
      if (this.active() || claim?.id !== job.allocation || claim.stream !== job.stream || claim.phase !== "deleting")
        throw new Error("capture cleanup selection changed before admission");
      this.state.set(kind, "active", admission);
      this.state.set(kind, position, job.key);
      if (prior) this.state.set(retries, job.allocation, { ...prior, attemptedRun: run.id });
    });
    const retire = () => {
      if (this.active()?.id !== admission.id) throw new Error("capture cleanup admission changed before completion");
      this.state.delete(kind, "active");
    };
    let result;
    try {
      result = cleanupCaptureRecovery(this.store, this.state, start, job, { maxRecords, stopped,
        onCommit: (result, { progress }) => {
          retire();
          if (result.complete) this.state.delete(retries, job.allocation);
          run.record({}, { progress, peakRssBytes: start.budget.peakRssBytes });
        } });
    } catch (error) {
      // Lock acquisition can observe cooperative exhaustion after selection.
      // Rollback has preserved the claim; orphan/operational failures still
      // leave admission for the registered replacement to diagnose.
      if (!(error instanceof CaptureStop) || !["deadline", "rss"].includes(error.reason)) throw error;
      result = { complete: false, stopped: true };
    }
    // A cooperative stop is not an operational failure. The deleting claim
    // remains, even when removal happened before the metadata unit could start.
    if (result.stopped && start.budget.reason === "interrupted") throw new CaptureStop("interrupted");
    if (result.stopped) this.state.transaction(retire);
    return { selected: 1, job, ...result };
  }
}
