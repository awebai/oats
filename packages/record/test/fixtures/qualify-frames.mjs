// Helpers of the large-frame qualification files (#1108 checkpoint Q, Q2a and
// Q2b): exactly sized native and aw log lines with heavy JSON escaping,
// historical journals written by the public synchronous capture (which keeps
// no record limit, like the releases that wrote the operator's large frames),
// a /proc sampler of the supervised workers, settled pass sequences, and
// read-only views of journals and the derived databases. Linux runner only.
import fs from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CAPTURE_POLICY } from "../../lib/capture-budget.mjs";
import { readCaptureLockOwner } from "../../lib/capture-lock.mjs";
import { captureSessions } from "../../lib/capture-cc.mjs";
import { SESSION_FORMATS } from "../../lib/formats.mjs";
import { RecordStore } from "../../lib/store.mjs";
import { measuredPass, nativeLine, OWNER, passRow, report, sessionPath } from "./qualify.mjs";

// Tool output that JSON escapes heavily: quotes, backslashes, newlines, tabs,
// control characters, and two-, three- and four-byte UTF-8 (literal in JSON).
export const HEAVY = 'say "hi" \\ C:\\path\\to\n\tline \u0001\u001f é ü ✓ 😀 {"k":"v\\n"}\r\n';
// Code-like tool output, the common content of large captured Codex lines.
export const CODE = 'const value = "text";\n\tif (ready) { return run(value, \'x\'); }\n';

const stamp = n => new Date(Date.UTC(2026, 1, 1) + n * 1000).toISOString();
/** A Codex tool-output line (no newline) carrying `text`. */
export const codexLine = (n, text) => JSON.stringify({ timestamp: stamp(n), type: "response_item",
  payload: { type: "function_call_output", call_id: `call_${n}`, output: text } });
/** An aw comm log entry (no newline) whose body is `text`. */
export const awEntry = (n, text) => JSON.stringify({ ts: stamp(n), dir: "recv", ch: "mail", msg_id: `large-${n}`,
  from: "peer", to: OWNER, subject: `entry ${n}`, body: text });
/** A small native line of `format` without its newline. */
export const smallLine = (format, n) => nativeLine(format, n, 300).slice(0, -1);

// Bytes of `text` inside a JSON string. Escaping is per character, so the
// sizes of repeated units add exactly.
const escaped = text => Buffer.byteLength(JSON.stringify(text)) - 2;

/** `build(text)` exactly `bytes` long (no newline): `unit` repeated, then ASCII fill. */
export function exactLine(build, unit, bytes) {
  const base = Buffer.byteLength(build("")), per = escaped(unit), k = Math.floor((bytes - base) / per);
  if (k < 0) throw new Error(`a line of ${bytes} bytes is shorter than its envelope`);
  const line = build(unit.repeat(k) + "x".repeat(bytes - base - k * per));
  if (Buffer.byteLength(line) !== bytes) throw new Error(`line sizing missed: ${Buffer.byteLength(line)} for ${bytes}`);
  return line;
}
/** `build(text)` whose JSON string encoding, the journal record's body.line,
 *  is at least `bytes`: the journal frame then exceeds `bytes` by its turn
 *  envelope. The unit is escaped twice, once natively and once in the frame. */
export function lineForFrame(build, unit, bytes) {
  const base = escaped(build("")), per = escaped(JSON.stringify(unit).slice(1, -1));
  return build(unit.repeat(Math.max(0, Math.ceil((bytes - base) / per))));
}

/** Writes `lines` (an iterable of strings without newlines) to `path`. → bytes written */
export function writeSession(path, lines, { append = false } = {}) {
  fs.mkdirSync(dirname(path), { recursive: true });
  const fd = fs.openSync(path, append ? "a" : "w");
  let bytes = 0;
  try {
    for (const line of lines) {
      const buffer = Buffer.from(line + "\n");
      for (let at = 0; at < buffer.length;) at += fs.writeSync(fd, buffer, at);
      bytes += buffer.length;
    }
  } finally { fs.closeSync(fd); }
  return bytes;
}
export const streamOf = (format, path) => `${OWNER}~${SESSION_FORMATS[format].source}.${SESSION_FORMATS[format].sessionId(path)}`;
export const awStream = `${OWNER}~aw`;

const FORMATS = ["cc", "codex", "pi"];
/** `count` small sessions numbered from `from` (cc/codex/pi in turn) of `lines`
 *  lines each. → [{ format, path, stream, lines }] */
export function smallSessions(home, from, count, lines = 6) {
  return Array.from({ length: count }, (_, i) => {
    const n = from + i, format = FORMATS[n % 3], path = sessionPath(home, format, n);
    writeSession(path, Array.from({ length: lines }, (_, j) => smallLine(format, n * 100_000 + j)));
    return { format, path, stream: streamOf(format, path), lines };
  });
}
/** Captures `sessions` with the public synchronous capture: no record limit,
 *  the journal format every release writes. → turns appended */
export function captureHistorical(root, sessions) {
  const store = new RecordStore(root, { owner: OWNER });
  let appended = 0;
  for (const format of FORMATS) {
    const files = sessions.filter(s => s.format === format).map(s => s.path);
    if (files.length) appended += captureSessions(store, { owner: OWNER, files, format }).appended;
  }
  return appended;
}

const journalPath = (root, stream) => new RecordStore(root, { owner: OWNER }).journalPath(stream);
/** A stream journal's record count, bytes and largest frame (record line with
 *  its newline), read in chunks without parsing. */
export function journalShape(root, stream) {
  const path = journalPath(root, stream);
  if (!fs.existsSync(path)) return { lines: 0, bytes: 0, largestFrameBytes: 0 };
  const fd = fs.openSync(path, "r"), chunk = Buffer.allocUnsafe(1 << 20);
  let lines = 0, bytes = 0, current = 0, largest = 0;
  try {
    for (let n; (n = fs.readSync(fd, chunk, 0, chunk.length, bytes)) > 0; bytes += n) {
      const view = chunk.subarray(0, n);
      let from = 0;
      for (let nl = view.indexOf(10, from); nl >= 0; nl = view.indexOf(10, from)) {
        current += nl - from + 1; lines++; largest = Math.max(largest, current); current = 0; from = nl + 1;
      }
      current += n - from;
    }
  } finally { fs.closeSync(fd); }
  return { lines, bytes, largestFrameBytes: largest };
}
/** The last `count` records of a stream journal, parsed; they must be small. */
export function lastRecords(root, stream, count) {
  const path = journalPath(root, stream), size = fs.statSync(path).size, length = Math.min(size, 65536);
  const bytes = Buffer.alloc(length), fd = fs.openSync(path, "r");
  try { fs.readSync(fd, bytes, 0, length, size - length); } finally { fs.closeSync(fd); }
  const lines = bytes.toString("utf8").split("\n").slice(0, -1);
  // A window that starts inside the file starts inside a record, which is not one of them.
  if (length < size && lines.length <= count) throw new Error(`the last ${count} records exceed the tail window`);
  return lines.slice(-count).map(line => JSON.parse(line));
}

// The derived databases are read only after a pass has released the root.
function readDerived(root, name, read, absent) {
  const path = join(root, "index", name);
  if (!fs.existsSync(path)) return absent;
  const db = new DatabaseSync(path, { readOnly: true });
  try { return read(db); } finally { db.close(); }
}
/** Retained-copy chunk rows left in capture.db, per allocation. → { allocation: rows } */
export const recoveryChunks = root => readDerived(root, "capture.db", db =>
  db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type='table' AND name='recovery_chunks'").get()?.found === 1
    ? Object.fromEntries(db.prepare("SELECT allocation, count(*) AS n FROM recovery_chunks GROUP BY allocation").all().map(row => [row.allocation, Number(row.n)])) : {}, {});
/** capture.db state rows of one kind. → [{ key, value }] */
export const stateRows = (root, kind) => readDerived(root, "capture.db", db =>
  db.prepare("SELECT key, value FROM state WHERE kind = ? ORDER BY key").all(kind).map(row => ({ key: row.key, value: JSON.parse(row.value) })), []);
export const stateValue = (root, kind, key) => stateRows(root, kind).find(row => row.key === key)?.value ?? null;
/** Index rows per stream in turns.db. → Map stream → count */
export const indexedCounts = root => readDerived(root, "turns.db", db =>
  new Map(db.prepare("SELECT stream, count(*) AS n FROM turns GROUP BY stream").all().map(row => [row.stream, Number(row.n)])), new Map());
/** Each session's journal records and index rows; done when both equal its lines. */
export function sessionProgress(root, sessions) {
  const indexed = indexedCounts(root);
  return sessions.map(s => {
    const journal = journalShape(root, s.stream).lines, rows = indexed.get(s.stream) ?? 0;
    return { ...s, journal, indexed: rows, done: journal === s.lines && rows === s.lines };
  });
}

const procText = path => { try { return fs.readFileSync(path, "utf8"); } catch { return null; } };
const kB = (text, field) => { const m = new RegExp(`^${field}:\\s+(\\d+) kB$`, "m").exec(text ?? ""); return m ? Number(m[1]) * 1024 : null; };
/** Samples the worker this process supervises over `root`, as the root's lock
 *  owner names it, every `ms`: each worker's lifetime and peak VmHWM/VmRSS.
 *  It also covers a worker that dies without writing its own exit report, as
 *  on a heap abort, and never a worker of another root, such as a pass an
 *  earlier test left running. */
export function watchWorkers(root, ms = 50) {
  const began = performance.now(), workers = new Map();
  const tick = () => {
    const at = Math.round(performance.now() - began), owner = readCaptureLockOwner(root);
    const pid = owner?.pid === process.pid ? owner.worker?.pid : undefined;
    if (pid) {
      const status = procText(`/proc/${pid}/status`);
      if (!status) return;
      const worker = workers.get(pid) ?? { pid, firstMs: at, lastMs: at, vmHwmBytes: 0, vmRssBytes: 0 };
      worker.lastMs = at;
      worker.vmHwmBytes = Math.max(worker.vmHwmBytes, kB(status, "VmHWM") ?? 0);
      worker.vmRssBytes = Math.max(worker.vmRssBytes, kB(status, "VmRSS") ?? 0);
      workers.set(pid, worker);
    }
  };
  const timer = setInterval(tick, ms);
  return { stop() { clearInterval(timer); tick(); return [...workers.values()]; } };
}
// A pass's workers: the sampled lifetime and peaks joined with each worker's
// own exit report, which is absent when it died without one.
function workerRows(reports, sampled) {
  const own = new Map(reports.map(value => [value.pid, value]));
  return [...new Set([...sampled.map(w => w.pid), ...own.keys()])].map(pid => {
    const seen = sampled.find(w => w.pid === pid), exit = own.get(pid);
    return { pid, startMs: seen?.firstMs ?? null, endMs: seen?.lastMs ?? null, exitReport: !!exit,
      sampledHwmBytes: seen?.vmHwmBytes ?? null, sampledRssBytes: seen?.vmRssBytes ?? null, reportedHwmBytes: exit?.vmHwmBytes ?? null,
      heapUsedAtExitBytes: exit?.heapUsedBytes ?? null, readBytes: exit?.io?.read_bytes ?? null, rchar: exit?.io?.rchar ?? null };
  });
}
const max = values => values.reduce((a, v) => v === null || v === undefined ? a : Math.max(a ?? 0, v), null);

/** Ordinary supervised passes through the measurement worker (production
 *  policy unless given) until one completes, fails, or ends pending input; at
 *  most `maxPasses`, none started after `budgetMs`. A deadline-partial pass
 *  continues, as untilComplete does. Each pass is reported as it ends, so a
 *  later timeout keeps its numbers. */
export async function settle(t, label, root, home, { policy = CAPTURE_POLICY, maxPasses = 6, budgetMs = 10 * 60_000 } = {}) {
  const passes = [], began = performance.now();
  let stopReason = null;
  while (!stopReason) {
    if (passes.length >= maxPasses) { stopReason = "max-passes"; break; }
    if (performance.now() - began >= budgetMs) { stopReason = "budget"; break; }
    const watch = watchWorkers(root);
    let pass, sampled;
    try { pass = await measuredPass(root, home, { policy }); } finally { sampled = watch.stop(); }
    pass.workers = workerRows(pass.reports, sampled);
    passes.push(pass);
    report(t, "frame-pass", { label, pass: passes.length, ...passRow(label, pass),
      lastProgressAt: pass.status?.lastProgressAt ?? null, workers: pass.workers });
    const { outcome, reason } = pass.result;
    if (outcome === "complete" || outcome === "failed") stopReason = outcome;
    else if (outcome === "partial" && reason === "input") stopReason = "partial-input";
  }
  const workers = passes.flatMap(pass => pass.workers);
  return { passes, complete: passes.at(-1)?.result.outcome === "complete", failed: passes.some(pass => pass.result.outcome === "failed"),
    wallMs: Math.round(performance.now() - began), stopReason, outcome: passes.at(-1)?.result.outcome ?? null, reason: passes.at(-1)?.result.reason ?? null,
    peakRssBytes: max(passes.map(pass => pass.status?.lastRun?.peakRssBytes)),
    vmHwmBytes: max(workers.flatMap(w => [w.sampledHwmBytes, w.reportedHwmBytes])),
    heapUsedAtExitBytes: max(workers.map(w => w.heapUsedAtExitBytes)), workers: workers.length,
    withoutExitReport: workers.filter(w => !w.exitReport).length };
}
