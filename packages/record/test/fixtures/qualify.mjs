// Helpers of the qualification harness (#1108 checkpoint Q): runner facts,
// deterministic synthetic homes, supervised passes through the measurement
// worker, outgoing releases from npm, and reporting. The harness files run
// only on the dispatched "Linux tests" runner (realManagerSkip("linux")); a
// skip is not evidence. Measurements are reported; assertions stay structural.
import fs from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CAPTURE_POLICY } from "../../lib/capture-budget.mjs";
import { captureCommandOptions } from "../../lib/capture-command.mjs";
import { captureDefaultRootPlan } from "../../lib/capture-default-roots.mjs";
import { superviseCapturePass } from "../../lib/capture-pass.mjs";
import { readCaptureStatus } from "../../lib/capture-status.mjs";

export { realManagerSkip, scratch, until } from "./real-manager.mjs";
export const measurementWorker = fileURLToPath(new URL("./qualify-worker.mjs", import.meta.url));
export const headCli = fileURLToPath(new URL("../../../../bin/oats.mjs", import.meta.url));
export const OWNER = "qualify";

/** The runner's per-file bound on Linux: scripts/named-test-run.mjs SIGKILLs the
 *  file's process group when it ends, and a killed file prints no diagnostics. */
export const FILE_BOUND_MS = 20 * 60_000;
/** node:test's timeout for a file's longest test: it fires before the group
 *  kill, so a timed-out test still reports what it collected. */
export const TEST_TIMEOUT_MS = FILE_BOUND_MS - 60_000;
/** Kept free before a test's timeout for its own reporting. */
export const REPORT_MARGIN_MS = 30_000;
/** What one supervised pass may take once started: its deadline, plus start
 *  and settle overhead. No pass starts without it left. */
export const passReserveMs = (policy = CAPTURE_POLICY) => policy.deadlineSeconds * 1000 + 30_000;

// The operator's measured population (#1108): first-upgrade volume is stated
// against it with an explicit scale factor, never as a full-volume claim.
export const OPERATOR = Object.freeze({ streams: 1315, journalBytes: 8.4e9, oversizedLines: 42, oversizedSessions: 5, largestLineBytes: 22_280_296 });

/** One JSON line per measurement in the log, through node:test's diagnostics. */
export function report(t, measurement, data) {
  t.diagnostic(JSON.stringify({ qualify: measurement, ...data }));
}
/** A human table of rows (objects with the same keys). */
export function table(t, title, rows) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]), width = keys.map(k => Math.max(k.length, ...rows.map(r => String(r[k]).length)));
  const line = values => values.map((v, i) => String(v).padEnd(width[i])).join("  ");
  t.diagnostic([title, line(keys), ...rows.map(r => line(keys.map(k => r[k])))].join("\n"));
}

function fsType(path) {
  const r = spawnSync("stat", ["-f", "-c", "%T", path], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : `unknown (${r.stderr.trim() || r.error?.message})`;
}
/** Kernel, filesystem types of the paths given (root, scratch), CPUs, memory, node. */
export function runnerFacts(t, paths) {
  const facts = { kernel: `${os.type()} ${os.release()}`, cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model ?? null,
    memoryBytes: os.totalmem(), node: process.version,
    counting: "sqliteCommits counts explicit COMMIT statements, a lower bound that excludes autocommit statements; SQLite's own fsyncs are not visible to the counting",
    filesystems: Object.fromEntries(Object.entries(paths).map(([name, path]) => [name, { path, type: fsType(path) }])) };
  report(t, "runner", facts);
  return facts;
}

// Deterministic: mulberry32.
function random(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let x = a; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}
const stamp = n => new Date(Date.UTC(2026, 0, 1) + n * 1000).toISOString();
const uuid = (n, prefix = "0193a000") => `${prefix}-${String(n).padStart(4, "0").slice(-4)}-7000-8000-${String(n).padStart(12, "0")}`;
/** A native line of about `bytes` bytes for a format; content is text the
 *  capture keeps verbatim, with the timestamp every format carries. */
export function nativeLine(format, n, bytes = 300) {
  const pad = "x".repeat(Math.max(0, bytes - 120));
  const value = format === "cc" ? { timestamp: stamp(n), type: "user", message: { role: "user", content: `turn ${n} ${pad}` } }
    : format === "codex" ? { timestamp: stamp(n), type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: `turn ${n} ${pad}` }] } }
    : { type: "message", timestamp: stamp(n), message: { role: "user", content: [{ type: "text", text: `turn ${n} ${pad}` }] } };
  return JSON.stringify(value) + "\n";
}
export function sessionPath(home, format, n) {
  if (format === "cc") return join(home, ".claude", "projects", `-project-${n % 40}`, `${uuid(n, "0193c000")}.jsonl`);
  if (format === "codex") return join(home, ".codex", "sessions", "2026", "01", String(1 + n % 28).padStart(2, "0"), `rollout-2026-01-01T00-00-00-${uuid(n)}.jsonl`);
  return join(home, ".pi", "agent", "sessions", `--project-${n % 20}--`, `2026-01-01T00-00-00-000Z_${uuid(n, "0193e000")}.jsonl`);
}

/** A synthetic home with `streams` native sessions (about 70% cc, 20% codex,
 *  10% pi), each 5-40 lines of about 200-600 bytes, plus `large` sessions of
 *  `largeBytes` in lines of `largeLineBytes`, plus `accounts` aw comm logs of
 *  `awLines` entries. → { home, sessions: [{ format, path, lines }], logs (aw log count), bytes } */
export function syntheticHome(base, { streams, large = 5, largeBytes = 4 * 1024 * 1024, largeLineBytes = 4096,
  accounts = 3, awLines = 200, seed = 1108 } = {}) {
  const home = join(base, `home-${streams}`), next = random(seed), sessions = [];
  let bytes = 0;
  const write = (path, text) => { fs.mkdirSync(join(path, ".."), { recursive: true }); fs.appendFileSync(path, text); bytes += Buffer.byteLength(text); };
  for (let n = 0; n < streams; n++) {
    const pick = next(), format = pick < 0.7 ? "cc" : pick < 0.9 ? "codex" : "pi", path = sessionPath(home, format, n);
    const big = n < large, count = big ? Math.ceil(largeBytes / largeLineBytes) : 5 + Math.floor(next() * 36);
    const chunks = [];
    for (let i = 0; i < count; i++) chunks.push(nativeLine(format, n * 100_000 + i, big ? largeLineBytes : 200 + Math.floor(next() * 400)));
    write(path, chunks.join(""));
    sessions.push({ format, path, lines: count });
  }
  for (let a = 0; a < accounts; a++) {
    const lines = [];
    for (let i = 0; i < awLines; i++) lines.push(JSON.stringify({ ts: stamp(i), dir: i % 2 ? "recv" : "send", ch: "mail", msg_id: `${a}-${i}`, from: i % 2 ? "peer" : OWNER, to: i % 2 ? OWNER : "peer", body: `message ${i}` }) + "\n");
    write(join(home, ".config", "aw", "logs", `account-${a}.jsonl`), lines.join(""));
  }
  return { home, sessions, logs: accounts, bytes };
}
/** Append `lines` small lines to the first `k` sessions. → bytes appended */
export function appendSessions(synthetic, k, lines = 3) {
  let bytes = 0;
  for (const [n, session] of synthetic.sessions.slice(0, k).entries()) {
    const text = Array.from({ length: lines }, (_, i) => nativeLine(session.format, 9_000_000 + n * 100 + i, 300)).join("");
    fs.appendFileSync(session.path, text); bytes += Buffer.byteLength(text); session.lines += lines;
  }
  return bytes;
}

const countsDirectory = root => `${root}.qualify-counts`;
const countFiles = root => { try { return new Set(fs.readdirSync(countsDirectory(root))); } catch { return new Set(); } };
/** The exit reports of the workers whose files are not in `before`. */
function workerReports(root, before) {
  return [...countFiles(root)].filter(name => !before.has(name)).map(name => JSON.parse(fs.readFileSync(join(countsDirectory(root), name), "utf8")));
}
function sumCounts(reports) {
  const total = { workers: 0, sqlite: { opens: 0, begins: 0, commits: 0 }, fsync: {}, rename: {}, mkdir: 0, opened: {}, readBytes: {}, io: {}, vmHwmBytes: 0 };
  for (const value of reports) {
    total.workers++;
    for (const key of ["opens", "begins", "commits"]) total.sqlite[key] += value.counts.sqlite[key];
    for (const group of ["fsync", "rename", "opened", "readBytes"]) for (const [k, n] of Object.entries(value.counts[group])) total[group][k] = (total[group][k] ?? 0) + n;
    total.mkdir += value.counts.mkdir;
    for (const [k, n] of Object.entries(value.io ?? {})) total.io[k] = (total.io[k] ?? 0) + n;
    total.vmHwmBytes = Math.max(total.vmHwmBytes, value.vmHwmBytes ?? 0);
  }
  return total;
}

/** One ordinary supervised pass over `home` into `root` through the measurement
 *  worker, at `policy` (production unless a caps-off case passes another).
 *  A worker killed at its hard deadline or by a heap abort writes no exit
 *  report; result.starts minus counts.workers shows how many.
 *  → { result, wallMs, counts (this pass's workers), reports (theirs, each), status } */
export async function measuredPass(root, home, { policy = CAPTURE_POLICY, indexEnabled = true } = {}) {
  const before = countFiles(root);
  const options = captureCommandOptions({ owner: OWNER, plan: captureDefaultRootPlan({ home, cwd: home, env: {} }), indexEnabled, trigger: "manual", retrySetAside: false });
  const began = performance.now();
  const result = await superviseCapturePass(root, options, { policy, workerPath: measurementWorker });
  const wallMs = Math.round(performance.now() - began);
  const reports = workerReports(root, before);
  return { result, wallMs, counts: sumCounts(reports), reports, status: readCaptureStatus(root) };
}
/** Ordinary passes until one completes, all ending within `budgetMs`: a pass
 *  starts only while a whole pass's reserve is left. Never shortens the
 *  production deadline: on running out it returns the passes so far (none
 *  when the budget held no pass). Two consecutive partial passes that commit
 *  nothing are a stall, reported as such (`stalled`) rather than spending the
 *  rest of the budget. */
export async function untilComplete(root, home, { policy = CAPTURE_POLICY, budgetMs = 18 * 60_000, indexEnabled = true } = {}) {
  const passes = [], began = performance.now();
  const idle = pass => { const c = pass.status?.lastRun?.counts ?? {}; return !c.bytesCommitted && !c.turnsAppended && !c.turnsIndexed; };
  let stalled = false;
  while (budgetMs - (performance.now() - began) >= passReserveMs(policy)) {
    const pass = await measuredPass(root, home, { policy, indexEnabled });
    passes.push(pass);
    if (pass.result.outcome === "complete" || pass.result.outcome === "failed") break;
    if (passes.length >= 2 && idle(pass) && idle(passes.at(-2))) { stalled = true; break; }
  }
  return { passes, complete: passes.at(-1)?.result.outcome === "complete", stalled, wallMs: Math.round(performance.now() - began) };
}
/** A pass's row for the human table and its JSON line. */
export function passRow(label, pass) {
  const counts = pass.status?.lastRun?.counts ?? {};
  const starts = pass.result.starts ?? null;
  return { label, outcome: pass.result.outcome, reason: pass.result.reason ?? "", wallMs: pass.wallMs, starts, workers: pass.counts.workers,
    uncounted: starts === null ? null : starts - pass.counts.workers,
    turnsAppended: counts.turnsAppended ?? null, turnsIndexed: counts.turnsIndexed ?? null, bytesCommitted: counts.bytesCommitted ?? null,
    filesVisited: counts.filesVisited ?? null, sqliteCommits: pass.counts.sqlite.commits, journalFsyncs: pass.counts.fsync.journal ?? 0,
    stagingFsyncs: pass.counts.fsync.staging ?? 0, renames: Object.values(pass.counts.rename).reduce((a, b) => a + b, 0),
    sourceRead: pass.counts.readBytes.source ?? 0, journalRead: pass.counts.readBytes.journal ?? 0,
    readBytes: pass.counts.io.read_bytes ?? null, rchar: pass.counts.io.rchar ?? null, peakRssBytes: pass.status?.lastRun?.peakRssBytes ?? null,
    vmHwmBytes: pass.counts.vmHwmBytes };
}

/** The published @awebai/oats at exactly `version`, installed with npm's
 *  integrity verification and no install scripts into `<base>/v<version>`.
 *  → { cli, version, integrity }; throws on any mismatch. */
export function installRelease(base, version) {
  const prefix = join(base, `v${version}`);
  const r = spawnSync("npm", ["install", "--prefix", prefix, "--no-audit", "--no-fund", "--ignore-scripts", `@awebai/oats@${version}`],
    { encoding: "utf8", timeout: 300_000 });
  if (r.status !== 0) throw new Error(`npm install @awebai/oats@${version} failed: ${r.stderr || r.error?.message}`);
  const installed = JSON.parse(fs.readFileSync(join(prefix, "node_modules", "@awebai", "oats", "package.json"), "utf8")).version;
  const lock = JSON.parse(fs.readFileSync(join(prefix, "package-lock.json"), "utf8"));
  const integrity = lock.packages?.["node_modules/@awebai/oats"]?.integrity;
  if (installed !== version || typeof integrity !== "string" || !integrity.startsWith("sha512-"))
    throw new Error(`@awebai/oats@${version} install mismatch: version ${installed}, integrity ${integrity}`);
  return { cli: join(prefix, "node_modules", "@awebai", "oats", "bin", "oats.mjs"), version, integrity };
}
/** `oats capture` of a CLI over `home` into `root`, timed, killed with
 *  `killSignal` at `timeoutMs`. */
export function cliCapture(cli, root, home, args = [], { timeoutMs = 10 * 60_000, killSignal = "SIGTERM" } = {}) {
  const began = performance.now();
  const r = spawnSync(process.execPath, [cli, "capture", "--owner", OWNER, "--root", root, ...args],
    // A timeout of 0 would mean none.
    { encoding: "utf8", timeout: Math.max(1, Math.round(timeoutMs)), killSignal, maxBuffer: 256 * 1024 * 1024, env: { ...process.env, HOME: home, TURN_RECORD_ROOT: root } });
  return { status: r.status, signal: r.signal, timedOut: r.error?.code === "ETIMEDOUT", stdout: r.stdout, stderr: r.stderr, wallMs: Math.round(performance.now() - began) };
}
/** Remove the derived capture cache and index, keeping journals: a first upgrade. */
export function dropDerived(root) {
  fs.rmSync(join(root, "index"), { recursive: true, force: true });
  for (const name of fs.readdirSync(root)) if (name.startsWith("capture-status")) fs.rmSync(join(root, name), { force: true });
}
/** Total journal bytes under the root. */
export function journalBytes(root) {
  const streams = join(root, "streams"); let total = 0, count = 0;
  if (!fs.existsSync(streams)) return { bytes: 0, streams: 0 };
  for (const name of fs.readdirSync(streams)) {
    const path = join(streams, name, "journal.jsonl");
    if (fs.existsSync(path)) { total += fs.statSync(path).size; count++; }
  }
  return { bytes: total, streams: count };
}
