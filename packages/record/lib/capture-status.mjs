// Shared status format and atomic file I/O. This module neither creates a run
// nor infers success from counters. Only admitted command workers publish run
// facts; exact receipt commands may refresh backlog while retaining history.
import { randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, openSync, readSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CAPTURE_POLICY } from "./capture-budget.mjs";
import { validFailureBacklog } from "./capture-failures.mjs";

export const CAPTURE_COUNT_FIELDS = Object.freeze(["filesVisited", "bytesCommitted", "turnsAppended", "turnsIndexed",
  "inputsPending", "inputsSetAside", "inputsFailed", "inputsIgnored"]);
export const emptyCaptureCounts = () => Object.fromEntries(CAPTURE_COUNT_FIELDS.map(key => [key, 0]));
const triggers = new Set(["service", "hook", "setup", "manual", "watch"]);
const reasons = new Set(["deadline", "rss", "heap", "interrupted", "input", "io"]);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const exact = (value, required, optional = []) => object(value) && required.every(key => Object.hasOwn(value, key)) &&
  Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const stamp = (value, now) => typeof value === "string" && Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value && Date.parse(value) <= now;
const peak = value => value === null || integer(value);
const counts = value => exact(value, CAPTURE_COUNT_FIELDS) && CAPTURE_COUNT_FIELDS.every(key => integer(value[key]));
const identityKeys = ["id", "trigger", "pid", "startedAt"];
const summaryKeys = [...identityKeys, "finishedAt", "counts", "peakRssBytes"];
function identity(value, now) {
  return object(value) && typeof value.id === "string" && value.id.length > 0 && triggers.has(value.trigger) &&
    Number.isSafeInteger(value.pid) && value.pid > 0 && stamp(value.startedAt, now);
}
function summary(value, now, failure = false) {
  return exact(value, [...summaryKeys, ...(failure ? ["reason", "message"] : [])], failure ? ["path", "offset"] : []) &&
    identity(value, now) && stamp(value.finishedAt, now) && value.startedAt <= value.finishedAt && counts(value.counts) && peak(value.peakRssBytes) &&
    (!failure || reasons.has(value.reason) && typeof value.message === "string" && value.message.length > 0 && value.message.length <= 2048 &&
      (value.path === undefined || typeof value.path === "string") && (value.offset === undefined || integer(value.offset)));
}
function run(value, now) {
  if (!exact(value, [...summaryKeys, "outcome", "reason", "reclaimedLock"]) || !identity(value, now) ||
      !counts(value.counts) || !peak(value.peakRssBytes) ||
      !["running", "complete", "partial", "failed"].includes(value.outcome) || value.reason !== null && !reasons.has(value.reason)) return false;
  if (value.reclaimedLock !== null && !(exact(value.reclaimedLock, ["pid", "startedAt"]) &&
      Number.isSafeInteger(value.reclaimedLock.pid) && value.reclaimedLock.pid > 0 && stamp(value.reclaimedLock.startedAt, now))) return false;
  if (value.outcome === "running") return value.finishedAt === null && value.reason === null;
  return stamp(value.finishedAt, now) && value.startedAt <= value.finishedAt &&
    (value.outcome !== "complete" || value.reason === null) && (value.outcome !== "failed" || value.reason !== null);
}
function backlog(value) {
  return exact(value, ["pending", "setAsideCount", "setAside", "truncated"], ["failedCount", "failed", "failedTruncated"]) &&
    typeof value.pending === "boolean" && integer(value.setAsideCount) && Array.isArray(value.setAside) &&
    value.setAside.length === Math.min(value.setAsideCount, 100) && value.truncated === (value.setAsideCount > 100) &&
    validFailureBacklog(value, { legacy: true }) &&
    (value.failed === undefined || value.failed.every(row => exact(row, ["stream", "offset", "reason", "attempts", "nextRetryAt"]))) &&
    value.setAside.every(row =>
      exact(row, ["source", "path", "offset", "reason"], ["line"]) && ["aw", "cc", "pi", "codex"].includes(row.source) &&
      typeof row.path === "string" && typeof row.reason === "string" && integer(row.offset) &&
      (row.line === undefined || Number.isSafeInteger(row.line) && row.line > 0));
}

export function validCaptureStatus(status, { now = Date.now() } = {}) {
  if (!exact(status, ["schemaVersion", "policy", "lastRun", "lastSuccess", "lastFailure", "lastProgressAt", "backlog"]) ||
      status.schemaVersion !== 1 || !backlog(status.backlog)) return false;
  if (status.policy !== null && !(exact(status.policy, Object.keys(CAPTURE_POLICY)) &&
      Object.keys(CAPTURE_POLICY).every(key => status.policy[key] === CAPTURE_POLICY[key]))) return false;
  if (status.lastRun !== null && !run(status.lastRun, now) || status.lastSuccess !== null && !summary(status.lastSuccess, now) ||
      status.lastFailure !== null && !summary(status.lastFailure, now, true) ||
      status.lastProgressAt !== null && !stamp(status.lastProgressAt, now)) return false;
  // Algorithm-phase nulls are valid absence of evidence; service facts cannot
  // be published as an unqualified null-policy algorithm snapshot.
  return status.policy !== null || [status.lastRun, status.lastSuccess, status.lastFailure, status.lastProgressAt].every(value => value === null);
}

export function emptyCaptureStatus(backlog) {
  return { schemaVersion: 1, policy: null, lastRun: null, lastSuccess: null, lastFailure: null, lastProgressAt: null, backlog };
}

export function readCaptureStatus(root, options) {
  const path = join(root, "capture-status.json");
  let fd;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
  let text;
  try {
    const stat = fstatSync(fd), limit = 1024 * 1024;
    if (!stat.isFile() || stat.size > limit) throw new Error("capture status is not a regular file within 1 MiB");
    const bytes = Buffer.alloc(limit + 1); let size = 0;
    while (size < bytes.length) {
      const count = readSync(fd, bytes, size, bytes.length - size, size);
      if (!count) break; size += count;
    }
    if (size > limit) throw new Error("capture status exceeds 1 MiB");
    text = bytes.toString("utf8", 0, size);
  } finally { closeSync(fd); }
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error("malformed capture status JSON"); }
  if (!validCaptureStatus(parsed, options)) throw new Error("unsupported, malformed or future-dated capture status");
  return parsed;
}

export function persistCaptureStatus(root, status, options) {
  if (!validCaptureStatus(status, options)) throw new Error("refusing invalid capture status publication");
  const path = join(root, "capture-status.json"), temp = `${path}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = openSync(temp, "wx", 0o600);
    writeFileSync(fd, JSON.stringify(status) + "\n"); fsyncSync(fd); closeSync(fd); fd = undefined;
    renameSync(temp, path);
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temp); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return status;
}
