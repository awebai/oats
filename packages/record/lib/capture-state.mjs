// Shared capture status and operator recovery. Null policy/run fields retain
// their algorithm-phase meaning: no such evidence has been supplied.
import { randomUUID } from "node:crypto";
import { DerivedState, invalidateLegacyMaps } from "./derived-state.mjs";
import { readIssueBacklog } from "./capture-issues.mjs";
import { emptyCaptureStatus, readCaptureStatus, persistCaptureStatus } from "./capture-status.mjs";

export const CAPTURE_SOURCES = ["aw", "cc", "pi", "codex"];
export { captureHealth, SET_ASIDE_REMEDY } from "./capture-health.mjs";

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

