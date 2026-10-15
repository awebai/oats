// Union reset has its own admission: a reset failure does not prove that any
// journal stream/frame failed. Caller owns the root lock, worker reconciliation
// and final receipts. This helper never deletes a stream's failure/retry row.
import { randomUUID } from "node:crypto";
import { readCaptureAdmission } from "./capture-admission.mjs";
import { FAILURE_REASONS, retryAfterAttempt } from "./capture-failures.mjs";
import { resetIndexTables } from "./index-reset.mjs";

const kind = "capture-index-reset", receiptKey = "capture-index-reset";
const validText = value => typeof value === "string" && value.length > 0 && value.length <= 128;
const validDate = value => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

export class CaptureIndexReset {
  constructor(index, inventory) { this.index = index; this.inventory = inventory; this.state = inventory.state; }

  current() {
    this.inventory.current();
    const row = this.state.get(kind, "current");
    if (row !== null && (!row || row.scope !== this.inventory.id ||
        ![row.id, row.nextScope, row.requestedBy].every(validText) || row.nextScope === row.scope ||
        !Number.isSafeInteger(row.attempts) || row.attempts < 0 ||
        row.attemptedRun !== null && !validText(row.attemptedRun) ||
        row.nextRetryAt !== null && !validDate(row.nextRetryAt) ||
        row.attempt !== null && (!validText(row.attempt?.workerNonce) || !validText(row.attempt?.runId) ||
          row.attempt.runId !== row.attemptedRun))) throw new Error("invalid capture index reset request");
    return row;
  }

  worker(start) {
    if (this.state.depth || !validText(start.workerNonce) || !validText(start.pass?.runId))
      throw new Error("capture index reset requires a supervised worker outside processing");
    start.budget.check();
    if (readCaptureAdmission(this.state)) throw new Error("capture index reset requires stream admission reconciliation");
  }

  request(start) {
    this.worker(start);
    const prior = this.current();
    if (prior) return prior;
    if (!this.state.db.prepare("SELECT 1 AS found FROM capture_index_inventory WHERE scope=? AND phase='reset' LIMIT 1")
      .get(this.inventory.id)?.found) return null;
    const row = { id: randomUUID(), scope: this.inventory.id, nextScope: randomUUID(), requestedBy: start.workerNonce,
      attempts: 0, attemptedRun: null, nextRetryAt: null, attempt: null };
    this.state.transaction(() => this.state.set(kind, "current", row));
    return row;
  }

  committed(row) {
    return this.index.db.prepare("SELECT value FROM meta WHERE key=?").get(receiptKey)?.value === row.id;
  }

  // Only after the predecessor has ended, like stream admission reconciliation.
  // The registered replacement's nonce must differ. Return pass-bound failure
  // for the run writer; never invent a failed member or exact inner-frame offset.
  reconcile(start, { reason = "interrupted", now = Date.now() } = {}) {
    this.worker(start);
    if (!FAILURE_REASONS.includes(reason)) throw new Error("invalid capture reset interruption reason");
    const row = this.current();
    if (!row?.attempt) return null;
    if (row.attempt.workerNonce === start.workerNonce) throw new Error("capture reset worker has not been replaced");
    const failure = { id: row.id, runId: row.attempt.runId, reason }, attempts = row.attempts + 1;
    const nextRetryAt = retryAfterAttempt(attempts, now);
    this.state.transaction(() => {
      this.state.set(kind, "current", { ...row, attempt: null, attempts, nextRetryAt });
      this.state.set("capture-index-reset-failure", "last", failure);
    });
    return { ...failure, committed: this.committed(row) };
  }

  advance(run, start, { now = Date.now() } = {}) {
    this.worker(start);
    if (!Number.isSafeInteger(now) || now < 0 || run.state !== this.state || run.id !== start.pass.runId)
      throw new Error("invalid capture reset run admission");
    const row = this.current();
    if (!row) return { reset: false };
    if (row.attempt) throw new Error("unreconciled capture index reset admission");
    const recovered = this.committed(row);
    if (!recovered) {
      if (row.attemptedRun === run.id || row.nextRetryAt !== null && now < Date.parse(row.nextRetryAt))
        return { reset: false, deferred: true };
      if (start.pass.reset !== true || start.pass.finalize !== false || row.requestedBy === start.workerNonce)
        return { reset: false, needsFreshWorker: true };
      this.state.transaction(() => {
        run.current();
        this.state.set(kind, "current", { ...row, attemptedRun: run.id,
          attempt: { workerNonce: start.workerNonce, runId: run.id } });
      });
      start.budget.check();
      // No capture.db transaction spans this atomic index operation. The token
      // commits with the reset, so recovery cannot erase index work performed
      // after that commit just because sweep publication subsequently failed.
      this.index.db.exec("BEGIN");
      try {
        resetIndexTables(this.index.db);
        this.index.db.prepare("INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
          .run(receiptKey, row.id);
        this.index.db.exec("COMMIT");
      } catch (error) { this.index.db.exec("ROLLBACK"); throw error; }
    }
    start.budget.check();
    this.state.transaction(() => {
      if (this.current()?.id !== row.id || !this.committed(row)) throw new Error("capture index reset evidence changed");
      this.inventory.restart(row.nextScope);
      run.record({}, { progress: true, peakRssBytes: start.budget.peakRssBytes });
      this.state.delete(kind, "current");
    });
    return { reset: true, recovered, scope: row.nextScope };
  }
}
