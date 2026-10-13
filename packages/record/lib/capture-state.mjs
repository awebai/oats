// Shared capture status and operator recovery. Service supervision later fills
// policy/run evidence; null means no such evidence has been supplied.
import { randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, openSync, readSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DerivedState, invalidateLegacyMaps } from "./derived-state.mjs";
import { readCurrentIssueBacklog, readIssueBacklog } from "./capture-issues.mjs";

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
      for (const { key, value } of state.entries("set-aside")) state.set("set-aside", key, { ...value, retry: true });
    });
  } finally { state.close(); }
}

export function writeCaptureStatus(root, { pending = false } = {}) {
  const state = new DerivedState(root);
  let backlog;
  try {
    backlog = readIssueBacklog(state.db, { pending });
  } finally { state.close(); }
  const status = { schemaVersion: 1, policy: null, lastRun: null, lastSuccess: null, lastFailure: null, lastProgressAt: null, backlog };
  const path = join(root, "capture-status.json"), temp = `${path}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = openSync(temp, "wx", 0o600);
    writeFileSync(fd, JSON.stringify(status) + "\n"); fsyncSync(fd); closeSync(fd); fd = undefined;
    renameSync(temp, path);
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temp); } catch (err) { if (err.code !== "ENOENT") throw err; }
  }
  return status;
}

function validStatus(status) {
  const b = status?.backlog;
  return status?.schemaVersion === 1 && status.policy === null && status.lastRun === null && status.lastSuccess === null &&
    status.lastFailure === null && status.lastProgressAt === null && typeof b?.pending === "boolean" &&
    Number.isSafeInteger(b.setAsideCount) && b.setAsideCount >= 0 && Array.isArray(b.setAside) && b.setAside.length <= 100 &&
    b.setAside.length === Math.min(b.setAsideCount, 100) && b.truncated === (b.setAsideCount > 100) &&
    b.setAside.every(e => CAPTURE_SOURCES.includes(e.source) && typeof e.path === "string" && typeof e.reason === "string" &&
      Number.isSafeInteger(e.offset) && e.offset >= 0 && (e.line === undefined || Number.isSafeInteger(e.line) && e.line > 0));
}

// Read-only, including a never-installed/absent root: no writable DB construction,
// directory creation, manager query, index rebuild or capture.
export function captureHealth(root) {
  const path = join(root, "capture-status.json");
  let status = { lastRun: null, lastSuccess: null, lastFailure: null,
    backlog: { pending: false, setAsideCount: 0, setAside: [], truncated: false } };
  const rows = [];
  try {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
    let text;
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile()) throw new Error("status is not a regular file");
      const limit = 1024 * 1024;
      if (stat.size > limit) throw new Error("status exceeds 1 MiB");
      const bytes = Buffer.alloc(limit + 1);
      let size = 0;
      while (size < bytes.length) {
        const count = readSync(fd, bytes, size, bytes.length - size, size);
        if (!count) break;
        size += count;
      }
      if (size > limit) throw new Error("status exceeds 1 MiB");
      text = bytes.toString("utf8", 0, size);
    } finally { closeSync(fd); }
    const parsed = JSON.parse(text);
    if (!validStatus(parsed)) throw new Error("unsupported or malformed status");
    status = parsed;
  } catch (err) {
    if (err.code !== "ENOENT") rows.push({ code: "capture-status-invalid", message: `Cannot read capture status at ${path}: ${err.message}` });
  }
  let backlog;
  try {
    backlog = readCurrentIssueBacklog(root);
    if (!backlog && status.backlog.setAsideCount) throw new Error("capture.db is missing but the last command reported active set-aside inputs");
  } catch (err) { throw new Error(`Cannot read current capture issues at ${join(root, "index", "capture.db")}: ${err.message}`, { cause: err }); }
  backlog ??= { pending: false, setAsideCount: 0, setAside: [], truncated: false };
  if (backlog.setAsideCount) rows.push({ code: "capture-input-set-aside", message:
    `${backlog.setAsideCount} capture inputs set aside. ${SET_ASIDE_REMEDY.replace("<root>", root)}` });
  return { schemaVersion: 1, status: rows.length ? "warning" : "ok", rows,
    lastRun: status.lastRun, lastSuccess: status.lastSuccess, lastFailure: status.lastFailure, backlog };
}
