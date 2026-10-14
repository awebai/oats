// Shared capture status and operator recovery. Null policy/run fields retain
// their algorithm-phase meaning: no such evidence has been supplied.
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DerivedState, invalidateLegacyMaps } from "./derived-state.mjs";
import { readCurrentIssueBacklog, readIssueBacklog } from "./capture-issues.mjs";
import { emptyFailureBacklog } from "./capture-failures.mjs";
import { emptyCaptureStatus, readCaptureStatus, persistCaptureStatus } from "./capture-status.mjs";

export const CAPTURE_SOURCES = ["aw", "cc", "pi", "codex"];
export const SET_ASIDE_REMEDY = "Restore the captured prefix and run capture --retry-set-aside; or add the source to <root>/ignore (later turns from that session will not be captured). Retry revalidates; it never authorizes a changed prefix.";

// Caller owns the root capture lock. One transaction persists every selected
// generation; a missing source cursor cannot erase this rescan request.
export function resetSourceCursors(root, owner, source) {
  if (source !== undefined && !CAPTURE_SOURCES.includes(source)) throw new Error(`unknown capture source: ${source}`);
  invalidateLegacyMaps(root);
  const state = new DerivedState(root);
  try {
    state.transaction(() => {
      for (const name of source ? [source] : CAPTURE_SOURCES) state.set("reset", `${owner}:${name}`, randomUUID());
    });
  } finally { state.close(); }
}

export function retrySetAside(root) {
  const state = new DerivedState(root);
  try {
    state.transaction(() => {
      for (const { key, value } of state.entries("set-aside")) {
        // A command's explicit retry invalidates an older staged proof once.
        // Keep this private generation after the issue resolves, so subsequent
        // workers do not restart merely because the active row was removed.
        state.set("source-retry", key, randomUUID());
        state.set("set-aside", key, { ...value, retry: true });
      }
    });
  } finally { state.close(); }
}

export function writeCaptureStatus(root, { pending = false } = {}) {
  const state = new DerivedState(root);
  let backlog;
  try {
    backlog = readIssueBacklog(state.db, { pending });
  } finally { state.close(); }
  // Exact receipt callers update issue evidence, never erase prior worker run
  // facts or turn their unbounded operation into a bounded-service success.
  const prior = readCaptureStatus(root) ?? emptyCaptureStatus(backlog);
  return persistCaptureStatus(root, { ...prior, backlog });
}

// Read-only, including a never-installed/absent root: no writable DB construction,
// directory creation, manager query, index rebuild or capture.
export function captureHealth(root) {
  const path = join(root, "capture-status.json");
  let status = { lastRun: null, lastSuccess: null, lastFailure: null,
    backlog: { pending: false, setAsideCount: 0, setAside: [], truncated: false, ...emptyFailureBacklog() } };
  const rows = [];
  try {
    status = readCaptureStatus(root) ?? status;
  } catch (err) {
    rows.push({ code: "capture-status-invalid", message: `Cannot read capture status at ${path}: ${err.message}` });
  }
  let backlog;
  try {
    backlog = readCurrentIssueBacklog(root);
    if (!backlog && (status.backlog.setAsideCount || status.backlog.failedCount)) throw new Error("capture.db is missing but the last command reported active capture issues");
  } catch (err) { throw new Error(`Cannot read current capture issues at ${join(root, "index", "capture.db")}: ${err.message}`, { cause: err }); }
  backlog ??= { pending: false, setAsideCount: 0, setAside: [], truncated: false, ...emptyFailureBacklog() };
  if (backlog.setAsideCount) rows.push({ code: "capture-input-set-aside", message:
    `${backlog.setAsideCount} capture inputs set aside. ${SET_ASIDE_REMEDY.replace("<root>", root)}` });
  if (backlog.failedCount) rows.push({ code: "capture-pass-failed", message:
    `${backlog.failedCount} capture stream units failed. Deferred retries remain unresolved; offsets name unit starts, not exact failing frames.` });
  return { schemaVersion: 1, status: rows.length ? "warning" : "ok", rows,
    lastRun: status.lastRun, lastSuccess: status.lastSuccess, lastFailure: status.lastFailure, backlog };
}
