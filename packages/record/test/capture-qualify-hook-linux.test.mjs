// Hook launcher latency qualification (#1108 checkpoint Q4; decision
// parent1c543637). Times `node packages/record/bin/capture.mjs --hook ...`
// from spawn to launcher exit over 50 runs (the first is this file's first
// launch, cold; the rest warm), plus one `oats capture --hook` through this
// head's CLI for comparison. Reported, never asserted as a number. Runs only in
// a dispatched "Linux tests" workflow (realManagerSkip("linux")); anywhere else
// it skips, which is not evidence.
// Structural checks: every launch exits 0 with nothing printed (--quiet); the
// detached supervisor outlives the launcher and publishes the hook receipt;
// and, in separate guarded launches, a preload in the launcher process only
// records and refuses any filesystem access under the record roots or HOME,
// so a clean exit 0 proves no lock, status or scan happened before exit.
// Each launch gets a fresh root, and its detached child is awaited (never
// signalled: this file did not start it) before the next launch.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { join } from "node:path";
import { captureLockPath, readCaptureLockOwner } from "../lib/capture-lock.mjs";
import { readCaptureStatus } from "../lib/capture-status.mjs";
import { alive, captureScript } from "./fixtures/real-manager.mjs";
import { OWNER, headCli, realManagerSkip, report, runnerFacts, scratch, syntheticHome, table } from "./fixtures/qualify.mjs";

const skip = realManagerSkip("linux") ?? false, RUNS = 50, GUARDED_RUNS = 5, SETTLE_MS = 120_000;

// Records, then refuses, every path-taking fs call under the guarded
// directories; a refusal a caller catches is still in the log.
function writeGuard(path, guarded, log) {
  fs.writeFileSync(path, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const guarded = ${JSON.stringify(guarded)}, log = ${JSON.stringify(log)}, append = fs.appendFileSync;
const under = value => { const p = value instanceof URL ? value.pathname : typeof value === 'string' || Buffer.isBuffer(value) ? String(value) : null;
  return p !== null && guarded.some(root => p === root || p.startsWith(root + '/')); };
// Only these take a second path; elsewhere a second argument is data or options.
const twoPaths = new Set(['renameSync', 'copyFileSync', 'symlinkSync', 'linkSync', 'rename']);
const wrap = (target, name) => { const operation = target[name]; if (typeof operation !== 'function') return;
  target[name] = Object.assign(function (...args) {
    const hit = [args[0], ...(twoPaths.has(name) ? [args[1]] : [])].find(under);
    if (hit !== undefined) { append(log, name + ' ' + String(hit) + '\\n'); throw new Error('launcher filesystem access'); }
    return operation.apply(this, args);
  }, operation); };
for (const name of ['statSync', 'lstatSync', 'readdirSync', 'opendirSync', 'openSync', 'readFileSync', 'writeFileSync', 'appendFileSync',
  'mkdirSync', 'mkdtempSync', 'rmSync', 'rmdirSync', 'unlinkSync', 'renameSync', 'existsSync', 'accessSync', 'realpathSync', 'copyFileSync',
  'symlinkSync', 'linkSync', 'chmodSync', 'utimesSync', 'watch', 'watchFile', 'createReadStream', 'createWriteStream',
  'stat', 'lstat', 'readdir', 'opendir', 'open', 'readFile', 'writeFile', 'appendFile', 'mkdir', 'rm', 'unlink', 'rename', 'access', 'realpath']) wrap(fs, name);
for (const name of ['stat', 'lstat', 'readdir', 'opendir', 'open', 'readFile', 'writeFile', 'appendFile', 'mkdir', 'rm', 'unlink', 'rename', 'access', 'realpath']) wrap(fs.promises, name);
syncBuiltinESMExports();
`);
}

/** One launch, spawn to exit (spawnSync returns once the launcher exits and
 *  its pipes close; the detached child holds neither). */
function launch(f, root, { guard = false, oats = false } = {}) {
  const hook = ["--hook", "--owner", OWNER, "--root", root, "--quiet"];
  const args = oats ? [headCli, "capture", ...hook] : [...(guard ? ["--import", f.guard] : []), captureScript, ...hook];
  const began = performance.now();
  const r = spawnSync(process.execPath, args, { cwd: f.base, env: f.env, encoding: "utf8", timeout: 30_000 });
  const ms = Math.round((performance.now() - began) * 10) / 10;
  return { ms, exit: r.status, signal: r.signal, error: r.error?.message ?? null, launcherPid: r.pid, stdout: r.stdout ?? "", stderr: r.stderr ?? "",
    atExit: { lock: fs.existsSync(captureLockPath(root)), status: fs.existsSync(join(root, "capture-status.json")) } };
}

// An orphan that has exited still answers kill(pid, 0) while a zombie (Z) and
// while its reaper releases it (X, or x on older kernels), so both count as
// exited. probe → { running, state }.
const EXITED = new Set(["Z", "X", "x"]);
function probe(pid) {
  if (!alive(pid)) return { running: false, state: null };
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8"), state = stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3);
    return { running: !EXITED.has(state), state };
  } catch { return { running: false, state: null }; }
}
const running = pid => probe(pid).running;

/** Waits for the detached supervisor's hook receipt and its exit. The lock
 *  owner seen after the launcher exited is the supervisor's survival evidence.
 *  Exit is the sample that ends the wait, never a second probe; times are
 *  from the launcher's exit. */
async function settle(root, launcherPid) {
  const began = performance.now(), since = () => Math.round(performance.now() - began);
  let supervisor = null, receipt = null, receiptMs = null;
  while (performance.now() - began < SETTLE_MS) {
    const owner = readCaptureLockOwner(root);
    if (owner?.pid && !supervisor) supervisor = { pid: owner.pid, alive: running(owner.pid), seenAfterExitMs: Math.round(performance.now() - began) };
    let status = null;
    try { status = readCaptureStatus(root); } catch { /* published atomically; a refusal is retried until the bound */ }
    const run = status?.lastRun;
    if (run?.trigger === "hook" && run.finishedAt && !fs.existsSync(captureLockPath(root))) {
      receipt = { outcome: run.outcome, reason: run.reason, pid: run.pid, turnsAppended: run.counts.turnsAppended };
      receiptMs = since();
      break;
    }
    await delay(20);
  }
  // The supervisor exits after releasing the lock; the next launch must not overlap it.
  let last = supervisor ? probe(supervisor.pid) : { running: false, state: null };
  while (last.running && performance.now() - began < SETTLE_MS) { await delay(20); last = probe(supervisor.pid); }
  const exitedMs = last.running ? null : since();
  return { supervisor, receipt, receiptMs, exitedMs, exitAfterReceiptMs: exitedMs === null || receiptMs === null ? null : exitedMs - receiptMs,
    lastState: last.state, settleMs: since(), supervisorExited: !last.running, launcherPid };
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b), at = q => sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];
  return { runs: sorted.length, medianMs: at(0.5), p95Ms: at(0.95), maxMs: sorted.at(-1), minMs: sorted[0] };
}

test(`hook launcher: ${RUNS} timed launches (cold, then warm), guarded launches, one oats capture --hook`, { skip, timeout: 19 * 60_000 }, async t => {
  const base = scratch(t, "qualify-hook-"), records = join(base, "records"), tmp = join(base, "tmp");
  fs.mkdirSync(records); fs.mkdirSync(tmp);
  runnerFacts(t, { root: records, scratch: base });
  const synthetic = syntheticHome(base, { streams: 20, large: 0, accounts: 1, awLines: 20 });
  // The harness-shaped environment: what a Claude hook would carry of HOME/PATH/TMPDIR.
  const f = { base, env: { HOME: synthetic.home, PATH: process.env.PATH, TMPDIR: tmp }, guard: join(base, "launcher-guard.mjs") };
  const violations = join(base, "launcher-violations.log");
  writeGuard(f.guard, [records, synthetic.home], violations);
  report(t, "hook-setup", { command: `node ${captureScript} --hook --owner ${OWNER} --root <records/run-N> --quiet`, home: synthetic.home, sessions: synthetic.sessions.length, bytes: synthetic.bytes });

  const runs = [];
  async function one(mode, n, options) {
    const root = join(records, `${mode}-${n}`);
    assert.equal(fs.existsSync(root), false, "each launch starts with no root, lock or status");
    const l = launch(f, root, options);
    const s = l.exit === 0 ? await settle(root, l.launcherPid) : null;
    const row = { mode, run: n, ms: l.ms, exit: l.exit, signal: l.signal, error: l.error, launcherPid: l.launcherPid, atExit: l.atExit, stdout: l.stdout, stderr: l.stderr, ...s };
    report(t, "hook-launch", row); runs.push(row);
    assert.equal(l.exit, 0, `${mode} ${n}: launcher exit ${l.exit} (${l.signal ?? l.error ?? ""}): ${l.stderr}`);
    // The oats CLI may add its own startup warnings; its output is reported, not pinned.
    if (!options?.oats) { assert.equal(l.stdout, ""); assert.equal(l.stderr, ""); }
    assert.ok(s.receipt, `${mode} ${n}: no finished hook receipt within ${SETTLE_MS} ms of the launcher's exit`);
    assert.notEqual(s.receipt.pid, l.launcherPid, "the receipt is the detached run's, not the launcher's");
    assert.ok(s.supervisorExited, `${mode} ${n}: the detached supervisor ${s.supervisor?.pid} is still alive ${SETTLE_MS} ms after the launcher's exit (state ${s.lastState})`);
    return row;
  }

  for (let n = 1; n <= RUNS; n++) await one(n === 1 ? "cold" : "warm", n);
  for (let n = 1; n <= GUARDED_RUNS; n++) {
    fs.rmSync(violations, { force: true });
    await one("guarded", n, { guard: true });
    const logged = fs.existsSync(violations) ? fs.readFileSync(violations, "utf8") : "";
    assert.equal(logged, "", `guarded ${n}: the launcher touched the record root or HOME before exit:\n${logged}`);
  }
  await one("oats", 1, { oats: true });

  const ms = mode => runs.filter(r => mode.includes(r.mode)).map(r => r.ms);
  const exits = runs.map(r => r.exitAfterReceiptMs).filter(Number.isFinite);
  const summary = { cold: stats(ms(["cold"])), warm: stats(ms(["warm"])), all: stats(ms(["cold", "warm"])), guarded: stats(ms(["guarded"])), oats: stats(ms(["oats"])) };
  const observed = runs.filter(r => r.supervisor && r.supervisor.alive && r.supervisor.pid !== r.launcherPid).length;
  report(t, "hook-latency", { ...summary, exitAfterReceipt: exits.length ? stats(exits) : null, supervisorObservedAliveAfterLauncherExit: observed, launches: runs.length,
    childPresentAtExit: runs.filter(r => r.atExit.lock || r.atExit.status).length });
  table(t, "capture --hook spawn -> launcher exit (ms)", Object.entries(summary).map(([mode, s]) => ({ mode, ...s })));
  table(t, "capture --hook launches", runs.map(r => ({ mode: r.mode, run: r.run, ms: r.ms, exit: r.exit, supervisor: r.supervisor?.pid ?? "unseen",
    supervisorAlive: r.supervisor?.alive ?? "", outcome: r.receipt?.outcome ?? "", settleMs: r.settleMs ?? "" })));
  // A supervisor holds the lock for a whole worker pass, so it is observable after the launcher's exit.
  assert.ok(observed > 0, "no launch showed its detached supervisor alive after the launcher exited");
});
