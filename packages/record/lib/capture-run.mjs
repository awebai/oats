// Worker-only run accounting. The status FILE is published history; this small
// derived row holds counters joined to committed work while a pass is running.
// A stale cache row cannot replace a finished file receipt or a different run.
import { CAPTURE_POLICY } from "./capture-budget.mjs";
import { readIssueBacklog } from "./capture-issues.mjs";
import { CAPTURE_COUNT_FIELDS, emptyCaptureCounts, emptyCaptureStatus, readCaptureStatus, persistCaptureStatus } from "./capture-status.mjs";

const reasons = new Set(["deadline", "rss", "heap", "interrupted", "input", "io"]);
const messages = Object.freeze({ deadline: "Capture worker exceeded its admitted time allowance.",
  rss: "Capture worker exceeded its sampled memory allowance.", heap: "Capture worker aborted at its heap limit.",
  interrupted: "Capture execution ended before its run receipt was finalized.",
  input: "Capture inputs remain pending, set aside or failed.", io: "Capture could not complete an operational step." });
const summarize = run => Object.fromEntries(["id", "trigger", "pid", "startedAt", "finishedAt", "counts", "peakRssBytes"].map(key => [key, structuredClone(run[key])]));
const failureSummary = (run, reason, at) => ({ ...summarize({ ...run, finishedAt: at }), reason,
  message: messages[reason] + " Counters report only durably confirmed unit accounting, not all physical journal writes; zero turnsAppended does not prove that no append reached disk." });
const maximumPeak = (a, b) => a === null && b === null ? null : Math.max(a ?? 0, b ?? 0);

export class CaptureRun {
  constructor(root, state, { id, trigger = "manual", pid = process.pid, reclaimedLock = null,
    previousFailure = null, currentFailure = null, clock = () => new Date().toISOString() } = {}) {
    if (state.depth) throw new Error("capture run starts outside processing transactions");
    if (previousFailure !== null && !reasons.has(previousFailure)) throw new Error("invalid prior capture failure");
    if (currentFailure !== null && (currentFailure?.id !== id || !reasons.has(currentFailure.reason)))
      throw new Error("invalid current capture failure");
    this.root = root; this.state = state; this.clock = clock;
    const at = clock(), backlog = readIssueBacklog(state.db, { pending: true });
    const prior = readCaptureStatus(root) ?? emptyCaptureStatus(backlog), cached = state.get("capture-run", "current");
    if (prior.lastRun?.id === id && prior.lastRun.outcome !== "running") throw new Error("capture run identity already finished");
    this.history = { policy: { ...CAPTURE_POLICY }, lastSuccess: prior.lastSuccess,
      lastFailure: prior.lastFailure, lastProgressAt: prior.lastProgressAt };
    let run;
    if (prior.lastRun?.id === id && prior.lastRun.outcome === "running") {
      // Only the same unfinished, published run may reuse derived counters.
      // Losing its cache cannot promote that run to complete: remember the
      // interruption, then allow independent/rebuild work to progress.
      run = cached?.run?.id === id ? cached.run : prior.lastRun;
      run = { ...run, peakRssBytes: maximumPeak(run.peakRssBytes, prior.lastRun.peakRssBytes) };
      this.history.lastProgressAt = cached?.run?.id === id ? cached.progressAt : prior.lastProgressAt;
      if (!cached || cached.run?.id !== id) previousFailure ??= "interrupted";
      if (previousFailure) this.history.lastFailure = failureSummary(run, previousFailure, at);
      run = { ...run, pid };
    } else {
      if (prior.lastRun?.outcome === "running") {
        const abandoned = cached?.run?.id === prior.lastRun.id ? cached.run : prior.lastRun;
        abandoned.peakRssBytes = maximumPeak(abandoned.peakRssBytes, prior.lastRun.peakRssBytes);
        this.history.lastFailure = failureSummary(abandoned, previousFailure ?? "interrupted", at);
        if (cached?.run?.id === prior.lastRun.id) this.history.lastProgressAt = cached.progressAt;
      }
      run = { id, trigger, pid, startedAt: at, finishedAt: null, outcome: "running", reason: null,
        counts: emptyCaptureCounts(), peakRssBytes: null, reclaimedLock };
    }
    // Supervisor evidence is explicitly bound to this pass, even if its first
    // child died before publishing a receipt. It must not be attributed to an
    // older abandoned receipt (whose failure alone cannot poison a new pass).
    if (currentFailure) this.history.lastFailure = failureSummary(run, currentFailure.reason, at);
    this.id = id; this.peakRssBytes = run.peakRssBytes; this.finished = false;
    // Publish initial identity BEFORE any processing or new counter-cache
    // initialization. A death here leaves an honest unfinished receipt; a
    // cache leftover from an older pass is never mistaken for this new run.
    persistCaptureStatus(root, { schemaVersion: 1, ...this.history, lastRun: run, backlog });
    state.transaction(() => state.set("capture-run", "current", { run, progressAt: this.history.lastProgressAt }));
  }

  current() {
    if (this.finished) throw new Error("capture run already finalized");
    const row = this.state.get("capture-run", "current");
    if (row?.run?.id !== this.id || row.run.outcome !== "running") throw new Error("capture run accounting changed");
    return row;
  }

  // Invoke in the processing commit, AFTER journal fsync / index commit. These
  // are confirmed committed-unit counts, not reconstructed guesses about an
  // append whose worker died before its derived checkpoint/count commit.
  record(delta = {}, { progress = false, peakRssBytes = null } = {}) {
    if (!this.state.depth || typeof progress !== "boolean" || !delta || typeof delta !== "object" || Array.isArray(delta) ||
        Object.keys(delta).some(key => !CAPTURE_COUNT_FIELDS.includes(key) || !Number.isSafeInteger(delta[key]) || delta[key] < 0) ||
        peakRssBytes !== null && (!Number.isSafeInteger(peakRssBytes) || peakRssBytes < 0)) throw new Error("invalid committed capture accounting");
    const row = this.current();
    for (const [key, value] of Object.entries(delta)) {
      if (!Number.isSafeInteger(row.run.counts[key] + value)) throw new Error("capture count overflow");
      row.run.counts[key] += value;
    }
    if (peakRssBytes !== null) row.run.peakRssBytes = Math.max(row.run.peakRssBytes ?? 0, peakRssBytes);
    if (progress) row.progressAt = this.clock();
    this.state.set("capture-run", "current", row);
  }

  snapshot({ pending = true, peakRssBytes = null } = {}) {
    if (this.state.depth) throw new Error("capture status cannot publish uncommitted progress");
    const row = this.current();
    if (peakRssBytes !== null) {
      if (!Number.isSafeInteger(peakRssBytes) || peakRssBytes < 0) throw new Error("invalid capture RSS sample");
      this.peakRssBytes = maximumPeak(this.peakRssBytes, peakRssBytes);
    }
    this.peakRssBytes = maximumPeak(this.peakRssBytes, row.run.peakRssBytes);
    row.run.peakRssBytes = this.peakRssBytes;
    this.history.lastProgressAt = row.progressAt;
    return { schemaVersion: 1, ...this.history, lastRun: row.run, backlog: readIssueBacklog(this.state.db, { pending }) };
  }

  publish(options) {
    return persistCaptureStatus(this.root, this.snapshot(options));
  }

  finish({ outcome, reason = null, pending = false, peakRssBytes = null } = {}) {
    if (!["complete", "partial", "failed"].includes(outcome) || reason !== null && !reasons.has(reason) ||
        outcome === "complete" && reason !== null || outcome === "failed" && reason === null) throw new Error("invalid capture run outcome");
    const snapshot = this.snapshot({ pending, peakRssBytes }), at = this.clock();
    // A failure earlier in THIS pass survives later healthy work. Older
    // historical failures are retained but do not forbid a new full success.
    if (snapshot.lastFailure?.id === this.id) { outcome = "failed"; reason = snapshot.lastFailure.reason; }
    if (outcome === "complete" && (snapshot.backlog.pending || snapshot.lastRun.counts.inputsPending ||
        snapshot.lastRun.counts.inputsSetAside || snapshot.lastRun.counts.inputsFailed)) {
      outcome = "partial"; reason = "input";
    }
    snapshot.lastRun = { ...snapshot.lastRun, finishedAt: at, outcome, reason };
    if (outcome === "complete") snapshot.lastSuccess = summarize(snapshot.lastRun);
    if (outcome === "failed") snapshot.lastFailure = failureSummary(snapshot.lastRun, reason, at);
    // No second DB commit is needed for completion. The atomic file is the
    // published receipt; the next run ignores this run's stale counter cache.
    const result = persistCaptureStatus(this.root, snapshot);
    this.finished = true;
    return result;
  }
}
