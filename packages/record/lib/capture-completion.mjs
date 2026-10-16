// Private final metadata verification, never a reusable completion certificate.
// Capture-state reservation precedes index reservation, as in group processing.
// There are no stream-lock acquisitions or content reads while they are held.
import { readdirSync, statSync } from "node:fs";
import { fileVersion, statVersion, sameVersion } from "./derived-state.mjs";
import { validStreamId } from "./store.mjs";

const terminal = new Set(["complete", "pending", "set-aside", "ignored", "failed"]);
const blockedKinds = ["capture-retry", "capture-cleanup-retry", "capture-discovery-attempt",
  "recovery-allocation", "recovery-stage", "source-queue-garbage", "index-inventory-garbage",
  "set-aside", "capture-failed"];
function directoryVersion(path) {
  try {
    const stat = statSync(path, { bigint: true });
    if (!stat.isDirectory()) throw new Error("capture completion streams root is not a directory");
    return statVersion(stat);
  } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

export function auditCaptureCompletion(session, { limit = 128, work } = {}) {
  const { state, index, queue, inventory, outcomes, sourceDiscovery, start, run } = session;
  if (state.depth || start.pass.finalize || !Number.isSafeInteger(limit) || limit < 1 || limit > 128)
    throw new Error("capture completion requires a normal worker outside processing");
  const result = { complete: false, pending: false, needsWork: false, stopped: false, sourceTerminal: false };
  const stopped = () => {
    if (start.budget.sample() === null) return false;
    result.stopped = true; result.pending = true; return true;
  };
  if (stopped()) return result;
  return state.transaction(() => {
    index.db.exec("BEGIN IMMEDIATE");
    try {
      // No cached audit position survives this call. Supported writers cannot
      // change either database during verification. Raw filesystem edits have
      // only the existing per-journal metadata qualification, not a root-wide
      // historical integrity or instantaneous filesystem snapshot guarantee.
      const sweep = queue.current(), union = inventory.current();
      const admission = state.get("capture-admission", "active") !== null ||
        state.get("capture-cleanup", "active") !== null ||
        state.get("capture-index-reset", "current") !== null ||
        state.db.prepare("SELECT 1 AS found FROM state WHERE kind='capture-discovery-attempt' LIMIT 1").get()?.found === 1;
      result.pending = admission || !sweep.discovered || union.phase !== "complete";
      if (sourceDiscovery?.current().groups.some(group => !group.complete || group.failure)) result.pending = true;
      const hasKind = state.db.prepare("SELECT 1 AS found FROM state WHERE kind=? LIMIT 1");
      for (const kind of blockedKinds) if (hasKind.get(kind)?.found === 1) result.pending = true;

      let position = 0, sourcesDone = sweep.discovered && !admission;
      while (true) {
        if (stopped()) return result;
        const rows = state.db.prepare(`SELECT position,outcome FROM capture_sources
          WHERE scope=? AND position>? ORDER BY position LIMIT ?`).all(sweep.id, position, limit);
        if (work) work.sourceRows = (work.sourceRows ?? 0) + rows.length;
        for (const row of rows) {
          if (stopped()) return result;
          if (row.outcome !== "ready" && !terminal.has(row.outcome)) throw new Error("invalid capture source outcome");
          if (row.outcome === "ready") sourcesDone = false;
          if (row.outcome !== "complete" && row.outcome !== "ignored") result.pending = true;
          position = row.position;
        }
        if (rows.length < limit) break;
      }
      result.sourceTerminal = sourcesDone;

      // Reconcile names that arrived after discovery (including before its
      // saved cursor). Membership never promotes them to processed outcomes.
      const member = state.db.prepare("SELECT 1 AS found FROM capture_index_inventory WHERE scope=? AND stream=?");
      const include = names => {
        const missing = names.filter(name => member.get(inventory.id, name)?.found !== 1);
        if (missing.length) { inventory.include(missing); result.needsWork = true; result.pending = true; }
        return missing.length !== 0;
      };
      let after = "";
      while (true) {
        if (stopped()) return result;
        const rows = index.db.prepare("SELECT stream FROM index_state WHERE stream>? ORDER BY stream LIMIT ?").all(after, limit);
        if (work) work.indexNames = (work.indexNames ?? 0) + rows.length;
        if (rows.some(row => !validStreamId(row.stream))) throw new Error("invalid indexed stream during capture completion");
        if (include(rows.map(row => row.stream))) return result;
        after = rows.at(-1)?.stream ?? after;
        if (rows.length < limit) break;
      }
      const path = index.store.streamsDir(), before = directoryVersion(path);
      if (union.directory && (!before || union.directory.dev !== before.dev || union.directory.ino !== before.ino))
        throw new Error("capture completion streams directory changed");
      const names = before === null ? [] : readdirSync(path).sort();
      if (work) work.directoryEntries = (work.directoryEntries ?? 0) + names.length;
      for (let offset = 0; offset < names.length; offset += limit) {
        const live = [];
        for (const name of names.slice(offset, offset + limit)) {
          if (stopped()) return result;
          if (validStreamId(name) && fileVersion(index.store.journalPath(name))) live.push(name);
        }
        if (include(live)) return result;
      }
      if (!sameVersion(before, directoryVersion(path))) { result.pending = true; result.needsWork = true; return result; }
      after = "";
      while (true) {
        if (stopped()) return result;
        const page = outcomes.audit({ after, limit, stopped });
        if (work) work.outcomeRows = (work.outcomeRows ?? 0) + page.checked;
        if (page.stopped || stopped()) return result;
        if (page.pending) result.pending = true;
        if (page.complete) break;
        after = page.after;
      }
      if (!sameVersion(before, directoryVersion(path))) { result.pending = true; result.needsWork = true; return result; }
      if (stopped()) return result;
      // Retirement is conditional on a subsequently published final receipt.
      // Death before that receipt must resume this scope, not recount inputs
      // in a new scope of the same unfinished run. Terminal pending inputs can
      // be rediscovered on the next pass without ever qualifying as success.
      if (sourcesDone && union.phase === "complete") state.set("capture-sweep-retirement", queue.owner,
        { runId: run.id, sourceScope: sweep.id, indexScope: inventory.id });
      result.complete = !result.pending;
      return result;
    } finally { index.db.exec("ROLLBACK"); }
  });
}
