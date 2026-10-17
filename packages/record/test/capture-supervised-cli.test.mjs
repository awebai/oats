// Actual frontdoor fixtures. Every child receives only fixture roots/environment;
// no setup, hook installation or service manager is invoked.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { RecordStore } from "../lib/store.mjs";
import { readCaptureStatus } from "../lib/capture-status.mjs";
import { acquireCaptureLock, captureLockPath } from "../lib/capture-lock.mjs";
import { captureSessions } from "../lib/capture-cc.mjs";
import { captureWatchQueue } from "../lib/capture-watch.mjs";

const bin = new URL("../bin/capture.mjs", import.meta.url).pathname;
const native = n => JSON.stringify({ timestamp: "2026-01-01T00:00:00Z", text: `native ${n}` }) + "\n";
const aw = n => JSON.stringify({ ts: "2026-01-01T00:00:00Z", ch: "mail", dir: "recv", from: "peer", body: `healthy ${n}` }) + "\n";
function fixture(t) {
  const base = fs.mkdtempSync(join(tmpdir(), "capture-supervised-cli-")), home = join(base, "home"), root = join(base, "record");
  const cc = join(home, ".claude/projects/project/session.jsonl"), logs = join(home, ".config/aw/logs/account.jsonl");
  for (const path of [join(home, ".claude/projects/project"), join(home, ".config/aw/logs"), join(base, "cache")]) fs.mkdirSync(path, { recursive: true });
  fs.writeFileSync(cc, native(1)); fs.writeFileSync(logs, aw(1));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const env = { HOME: home, PATH: process.env.PATH, TMPDIR: base, XDG_CACHE_HOME: join(base, "cache"), TURN_RECORD_OWNER: "fixture", TURN_RECORD_ROOT: root };
  const store = new RecordStore(root, { owner: "fixture" });
  return { base, home, root, cc, logs, env, store,
    cli(args = [], extra = {}) { return spawnSync(process.execPath, [bin, ...args], { cwd: base, encoding: "utf8", env: { ...env, ...extra }, timeout: 30000 }); },
  };
}
function passed(result) { assert.equal(result.status, 0, result.stderr + result.stdout); }

test("ordinary CLI routes selected sources through workers, preserves append-only/index catch-up and manual quiet attribution", t => {
  const f = fixture(t);
  passed(f.cli(["--sessions-only", "--no-index", "--quiet"]));
  let status = readCaptureStatus(f.root);
  assert.equal(status.lastRun.trigger, "manual"); assert.equal(status.lastRun.outcome, "partial");
  assert.equal(status.lastRun.counts.turnsAppended, 1); assert.equal(status.lastSuccess, null);
  assert.equal(status.policy.heapMiB, 256); assert.equal(status.policy.deadlineSeconds, 300);
  assert.deepEqual(status.policy, { intervalSeconds: 900, heapMiB: 256, rssBytes: 2147483648, deadlineSeconds: 300, maxRecordBytes: 8388608 });
  assert.equal(f.store.readStream("fixture~cc.session").length, 1); assert.equal(f.store.readStream("fixture~aw").length, 0);
  assert.equal(fs.existsSync(join(f.root, "index/turns.db")), false);
  const selected = f.cli(["--aw-only", "--no-index"]); passed(selected);
  assert.match(selected.stdout, /1 new turns; partial/);
  assert.equal(f.store.readStream("fixture~aw").length, 1);
  assert.equal(fs.existsSync(join(f.root, "index/turns.db")), false);
  const enabled = f.cli(); passed(enabled);
  assert.match(enabled.stdout, /0 new turns; complete/); assert.match(enabled.stdout, /index: updated/);
  status = readCaptureStatus(f.root);
  assert.equal(status.lastRun.counts.turnsIndexed, 2); assert.equal(status.lastSuccess.id, status.lastRun.id);
  const index = fs.readFileSync(join(f.root, "index/turns.db"));
  fs.appendFileSync(f.cc, native(2)); passed(f.cli(["--sessions-only", "--no-index"]));
  assert.deepEqual(fs.readFileSync(join(f.root, "index/turns.db")), index);
  assert.equal(f.store.readStream("fixture~cc.session").length, 2);
  assert.equal(readCaptureStatus(f.root).lastSuccess.id, status.lastSuccess.id);
});

test("CLI ordinary JSON rejection is non-writing; reset remains reset-only and overlap differs from refused recovery", t => {
  const f = fixture(t);
  const invalid = f.cli(["--json"]);
  assert.equal(invalid.status, 2); assert.equal(JSON.parse(invalid.stdout).code, "E_USAGE"); assert.equal(fs.existsSync(f.root), false);
  const reset = f.cli(["--reset-cursors", "--source", "cc", "--json"]); passed(reset);
  assert.deepEqual(JSON.parse(reset.stdout), { reset: true, sources: ["cc"] });
  assert.equal(f.store.readStream("fixture~cc.session").length, 0); assert.equal(fs.existsSync(join(f.root, "index/turns.db")), false);
  const status = fs.readFileSync(join(f.root, "capture-status.json")), lock = acquireCaptureLock(f.root);
  try {
    const ordinary = f.cli(["--no-index"]); passed(ordinary); assert.match(ordinary.stdout, /another pass holds/);
    const quiet = f.cli(["--quiet"]); passed(quiet); assert.equal(quiet.stdout, "");
    const recovery = f.cli(["--retry-set-aside", "--json"]);
    assert.equal(recovery.status, 1); assert.match(JSON.parse(recovery.stdout).error, /capture lock held/);
    assert.equal(Object.hasOwn(JSON.parse(recovery.stdout), "appended"), false);
    assert.deepEqual(fs.readFileSync(join(f.root, "capture-status.json")), status);
  } finally { lock.release(); }
});

test("CLI copies configured relative native locations while excluded formats do not resolve", t => {
  const f = fixture(t), relocated = join(f.base, "relocated/projects/project");
  fs.mkdirSync(relocated, { recursive: true }); fs.writeFileSync(join(relocated, "other.jsonl"), native(3));
  passed(f.cli(["--sessions-only", "--no-index"], { CLAUDE_CONFIG_DIR: "relocated" }));
  assert.equal(f.store.readStream("fixture~cc.other").length, 1);
  assert.equal(f.store.readStream("fixture~cc.session").length, 0, "configured roots retain precedence over defaults");
  passed(f.cli(["--aw-only", "--no-index"], { CLAUDE_CONFIG_DIR: "missing", CODEX_HOME: "missing" }));
  assert.equal(f.store.readStream("fixture~aw").length, 1);
  assert.equal(readCaptureStatus(f.root).lastRun.outcome, "partial");
  assert.equal(fs.existsSync(join(f.root, "index/turns.db")), false);
});

test("CLI retry JSON uses the worker projection and never waives conflicting captured history", t => {
  const f = fixture(t);
  captureSessions(f.store, { owner: "fixture", files: [f.cc] });
  fs.writeFileSync(f.cc, native("changed"));
  assert.equal(captureSessions(f.store, { owner: "fixture", files: [f.cc] }).complete, false);
  let result = f.cli(["--retry-set-aside", "--no-index", "--json"]); passed(result);
  // AW is independent healthy work. Conflicting native bytes remain excluded.
  assert.deepEqual(JSON.parse(result.stdout), { appended: 1, pending: true });
  assert.equal(f.store.readStream("fixture~cc.session").length, 1);
  fs.writeFileSync(f.cc, native(1) + native(2));
  result = f.cli(["--retry-set-aside", "--no-index", "--json"]); passed(result);
  assert.deepEqual(JSON.parse(result.stdout), { appended: 1, pending: true });
  assert.equal(readCaptureStatus(f.root).lastRun.counts.turnsAppended, 1);
  assert.equal(f.store.readStream("fixture~cc.session").length, 2);
  assert.equal(fs.existsSync(join(f.root, "index/turns.db")), false);
});

test("CLI operational failure reports unavailable projection without fabricated zero counts", t => {
  const f = fixture(t), bad = join(f.base, "not-a-directory"); fs.writeFileSync(bad, "file");
  const result = f.cli(["--retry-set-aside", "--no-index", "--json"], { CODEX_HOME: bad });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const answer = JSON.parse(result.stdout);
  assert.equal(answer.status, "failed"); assert.equal(answer.complete, false);
  assert.match(answer.error, /matching worker receipt unavailable/); assert.equal(Object.hasOwn(answer, "appended"), false);
  const status = readCaptureStatus(f.root);
  assert.equal(status.lastRun.outcome, "failed"); assert.equal(status.lastRun.trigger, "manual");
  assert.equal(status.lastRun.counts.turnsAppended, 2, "healthy native and AW work still commit");
  assert.equal(status.lastFailure.id, status.lastRun.id); assert.equal(status.lastSuccess, null);
  assert.equal(fs.existsSync(captureLockPath(f.root)), false);
});

test("CLI reclaim of a dead lock publishes its evidence only for a valid past start", t => {
  const f = fixture(t), dead = 999999999, past = "2026-01-01T00:00:00.000Z";
  for (const [recorded, expected] of [[{ startedAt: new Date(Date.now() + 86400000).toISOString() }, null],
    [{}, null], [{ startedAt: "yesterday" }, null], [{ startedAt: past }, { pid: dead, startedAt: past }]]) {
    fs.mkdirSync(captureLockPath(f.root), { recursive: true });
    fs.writeFileSync(join(captureLockPath(f.root), "owner.json"), JSON.stringify({ pid: dead, nonce: "n", host: hostname(), ...recorded }));
    const result = f.cli(["--sessions-only", "--no-index"]); passed(result);
    assert.match(result.stderr, new RegExp(`reclaimed .* from pid ${dead}, which died`), "the operator line is kept");
    assert.deepEqual(readCaptureStatus(f.root).lastRun.reclaimedLock, expected, JSON.stringify(recorded));
    assert.equal(readCaptureStatus(f.root).lastFailure, null, "a death before any run receipt invents no old run");
    assert.equal(fs.existsSync(captureLockPath(f.root)), false);
  }
});

// TERM/INT handshakes inside the real production worker. A parent-only preload
// adds a test hook to the fixed worker's node flags; the hook runs at the
// worker's own budget samples (process.memoryUsage), so the signal lands after
// a committed unit, never by timing. Only fixture-owned processes are signalled.
function signalFixture(t, f, mode, signal = "SIGTERM") {
  const lib = new URL("../lib/", import.meta.url).href, dir = join(f.base, "hook");
  fs.mkdirSync(dir);
  const hook = join(dir, "worker-hook.mjs"), preload = join(dir, "cli-preload.mjs");
  fs.writeFileSync(hook, `import fs from "node:fs"; import { join } from "node:path";
    import { RecordStore } from ${JSON.stringify(lib + "store.mjs")};
    const dir = ${JSON.stringify(dir)}, root = ${JSON.stringify(f.root)}, mode = ${JSON.stringify(mode)}, signal = ${JSON.stringify(signal)};
    const lockOwner = join(root, ".capture.lock/owner.json"), parent = process.ppid;
    const nap = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    fs.appendFileSync(join(dir, "starts"), process.pid + "\\n");
    const memoryUsage = process.memoryUsage; let fired = false;
    process.memoryUsage = function () {
      if (!fired && new RecordStore(root, { owner: "fixture" }).readStream("fixture~cc.session").length >= 2) {
        fired = true;
        fs.copyFileSync(lockOwner, join(dir, "owner-seen.json"));
        fs.writeFileSync(join(dir, "witness"), String(process.pid));
        if (mode === "die") {
          process.kill(parent, "SIGKILL");
          while (process.ppid === parent) nap(10);
          process.kill(process.pid, "SIGKILL");
        }
        // "group": the CLI leads its own test-owned process group; the signal
        // reaches this worker too, as a terminal, timeout(1) or a cgroup would.
        process.kill(mode === "group" ? -parent : parent, signal);
        if (mode === "stall") for (;;) nap(50);
        const until = Date.now() + 20000;
        while (Date.now() < until) {
          try { if (JSON.parse(fs.readFileSync(lockOwner, "utf8")).stop === true) break; } catch {}
          nap(10);
        }
        fs.writeFileSync(join(dir, "stop-seen"), "");
      }
      return memoryUsage.call(process);
    };`);
  fs.writeFileSync(preload, `import cp from "node:child_process"; import { syncBuiltinESMExports } from "node:module";
    const spawn = cp.spawn;
    cp.spawn = (command, args, options) => spawn(command, String(args.at(-1)).endsWith("capture-command-worker.mjs")
      ? [...args.slice(0, -1), "--import", ${JSON.stringify(pathToFileURL(hook).href)}, args.at(-1)] : args, options);
    syncBuiltinESMExports();`);
  return {
    dir,
    cli(args = []) { return spawnSync(process.execPath, ["--import", pathToFileURL(preload).href, bin, ...args], { cwd: f.base, encoding: "utf8", env: f.env, timeout: 60000 }); },
    // The CLI in a new process group of its own, signalled only through that group.
    async groupCli(args = []) {
      const child = spawn(process.execPath, ["--import", pathToFileURL(preload).href, bin, ...args],
        { cwd: f.base, env: f.env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
      t.after(() => { try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; } });
      let stdout = "", stderr = "";
      child.stdout.on("data", bytes => { stdout += bytes; }); child.stderr.on("data", bytes => { stderr += bytes; });
      const timeout = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} }, 60000);
      const [status, signal] = await once(child, "close"); clearTimeout(timeout);
      return { status, signal, stdout, stderr, pid: child.pid };
    },
    starts() { return fs.readFileSync(join(dir, "starts"), "utf8").trim().split("\n").map(Number); },
  };
}

test("CLI TERM during a production work unit stops cooperatively: interrupted receipt, durable counts and prior success kept, one worker reaped, lock released", t => {
  const f = fixture(t); passed(f.cli());
  const before = readCaptureStatus(f.root); assert.equal(before.lastRun.outcome, "complete");
  fs.appendFileSync(f.cc, native(2)); fs.appendFileSync(f.logs, aw(2));
  const s = signalFixture(t, f, "cooperate"), result = s.cli();
  assert.equal(result.status, 1, result.stdout + result.stderr); assert.equal(result.signal, null);
  assert.match(result.stderr, /capture pass failed: capture worker failed \(interrupted\)/);
  assert.ok(fs.existsSync(join(s.dir, "stop-seen")), "the worker observed the nonce-bound stop request");
  const status = readCaptureStatus(f.root);
  assert.equal(status.lastRun.outcome, "failed"); assert.equal(status.lastRun.reason, "interrupted");
  assert.ok(status.lastRun.finishedAt, "the worker finalized its own receipt");
  assert.equal(status.lastRun.counts.turnsAppended >= 1, true, "the committed unit is counted");
  assert.equal(status.lastFailure.id, status.lastRun.id); assert.equal(status.lastFailure.reason, "interrupted");
  assert.match(status.lastFailure.message, /^Capture execution was interrupted\. Counters report only durably confirmed unit accounting/);
  assert.deepEqual(status.lastSuccess, before.lastSuccess);
  assert.equal(f.store.readStream("fixture~cc.session").length, 2);
  assert.deepEqual(s.starts(), [Number(fs.readFileSync(join(s.dir, "witness"), "utf8"))], "no continuation or new worker after the stop");
  assert.throws(() => process.kill(s.starts()[0], 0), { code: "ESRCH" }, "the worker was reaped");
  assert.equal(fs.existsSync(captureLockPath(f.root)), false);
  const owner = JSON.parse(fs.readFileSync(join(s.dir, "owner-seen.json"), "utf8"));
  assert.equal(owner.command, "pass"); assert.deepEqual(owner.caller, { entry: "turn-record", trigger: "manual" });
  assert.equal(owner.ppid, process.pid); assert.equal(owner.worker.pid, s.starts()[0]); assert.equal(Object.hasOwn(owner, "stop"), false);
  passed(f.cli());
  assert.equal(readCaptureStatus(f.root).lastRun.outcome, "complete"); assert.equal(f.store.readStream("fixture~aw").length, 2);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  test(`CLI ${signal} delivered to the caller's whole process group still stops the worker cooperatively`, async t => {
    const f = fixture(t); passed(f.cli());
    const before = readCaptureStatus(f.root);
    fs.appendFileSync(f.cc, native(2));
    const s = signalFixture(t, f, "group", signal), result = await s.groupCli();
    assert.equal(result.status, 1, result.stdout + result.stderr); assert.equal(result.signal, null);
    assert.ok(fs.existsSync(join(s.dir, "stop-seen")), "the worker survived the group signal and saw the stop request");
    const status = readCaptureStatus(f.root);
    assert.equal(status.lastRun.outcome, "failed", "a worker killed by the default action would leave its receipt running");
    assert.equal(status.lastRun.reason, "interrupted"); assert.ok(status.lastRun.finishedAt);
    assert.equal(status.lastRun.counts.turnsAppended >= 1, true);
    assert.match(status.lastFailure.message, /^Capture execution was interrupted\. /);
    assert.deepEqual(status.lastSuccess, before.lastSuccess);
    assert.equal(s.starts().length, 1);
    assert.throws(() => process.kill(-result.pid, 0), { code: "ESRCH" }, "every process of the test-owned group was reaped");
    assert.equal(fs.existsSync(captureLockPath(f.root)), false);
  });
}

test("CLI TERM to a worker that cannot cooperate kills and reaps it after the grace; no finished receipt is invented and the next pass records the interruption", t => {
  const f = fixture(t); passed(f.cli());
  const before = readCaptureStatus(f.root);
  fs.appendFileSync(f.cc, native(2));
  const s = signalFixture(t, f, "stall"), result = s.cli();
  assert.equal(result.status, 1, result.stdout + result.stderr); assert.match(result.stderr, /interrupted/);
  const stalled = readCaptureStatus(f.root);
  assert.equal(stalled.lastRun.outcome, "running", "a killed worker leaves its unfinished receipt");
  assert.deepEqual(stalled.lastSuccess, before.lastSuccess);
  assert.equal(s.starts().length, 1); assert.throws(() => process.kill(s.starts()[0], 0), { code: "ESRCH" });
  assert.equal(fs.existsSync(captureLockPath(f.root)), false);
  passed(f.cli());
  const next = readCaptureStatus(f.root);
  assert.equal(next.lastFailure.id, stalled.lastRun.id); assert.equal(next.lastFailure.reason, "interrupted");
  assert.notEqual(next.lastRun.id, stalled.lastRun.id); assert.equal(next.lastRun.outcome, "complete");
  assert.equal(f.store.readStream("fixture~cc.session").length, 2);
});

test("a supervisor killed with its worker leaves a lock the next ordinary pass reclaims, recording the interruption against the old run only", t => {
  const f = fixture(t); passed(f.cli());
  const before = readCaptureStatus(f.root);
  fs.appendFileSync(f.cc, native(2));
  const s = signalFixture(t, f, "die"), result = s.cli();
  assert.equal(result.signal, "SIGKILL", result.stdout + result.stderr);
  const killed = readCaptureStatus(f.root), owner = JSON.parse(fs.readFileSync(join(captureLockPath(f.root), "owner.json"), "utf8"));
  assert.equal(killed.lastRun.outcome, "running"); assert.deepEqual(killed.lastSuccess, before.lastSuccess);
  assert.equal(owner.command, "pass"); assert.equal(owner.worker.pid, s.starts()[0]);
  const next = f.cli(); passed(next);
  assert.match(next.stderr, new RegExp(`reclaimed .* from pid ${owner.pid}, which died`));
  const status = readCaptureStatus(f.root);
  assert.equal(status.lastFailure.id, killed.lastRun.id); assert.equal(status.lastFailure.reason, "interrupted");
  assert.equal(status.lastFailure.counts.turnsAppended, killed.lastRun.counts.turnsAppended, "the old run keeps its confirmed counts");
  assert.match(status.lastFailure.message, /^Capture execution was interrupted\. /);
  assert.notEqual(status.lastRun.id, killed.lastRun.id); assert.equal(status.lastRun.outcome, "complete", "the new pass is not blamed");
  assert.deepEqual(status.lastRun.reclaimedLock, { pid: owner.pid, startedAt: owner.startedAt });
  assert.equal(f.store.readStream("fixture~cc.session").length, 2, "committed checkpoints are kept, nothing is duplicated");
  assert.equal(fs.existsSync(captureLockPath(f.root)), false);
});

// A worker's own status failure, which this directory used to provoke, is
// pinned in capture-command.test.mjs: the supervisor now moves it aside first.
test("CLI moves a non-regular capture status aside, names it and writes a new status", t => {
  const f = fixture(t); fs.mkdirSync(join(f.root, "capture-status.json"), { recursive: true });
  const result = f.cli(["--sessions-only", "--no-index"]); passed(result);
  const moved = fs.readdirSync(f.root).filter(name => name.startsWith("capture-status.json.invalid-"));
  assert.equal(moved.length, 1, JSON.stringify(moved));
  assert.equal(fs.statSync(join(f.root, moved[0])).isDirectory(), true);
  assert.match(result.stderr, new RegExp(`capture status is not a regular file within 1 MiB\\); moved it aside to .*${moved[0]} and started a new status`));
  assert.ok(readCaptureStatus(f.root)?.lastRun, "a new status was published");
  assert.equal(fs.existsSync(captureLockPath(f.root)), false);
});

test("an earlier release's hook command, run against this release, is one quiet foreground pass", t => {
  // The persisted hook before setup converts it: `<node> capture.mjs --owner X
  // --quiet`, no --hook, which the harness ran asynchronously with 120 s. It is
  // an ordinary supervised pass under the root lock (up to its 300 s deadline),
  // attributed manual, printing nothing; health asks for setup meanwhile.
  const f = fixture(t), result = f.cli(["--owner", "fixture", "--quiet"]); passed(result);
  assert.equal(result.stdout, ""); assert.equal(result.stderr, "");
  const run = readCaptureStatus(f.root).lastRun;
  assert.equal(run.trigger, "manual"); assert.ok(["complete", "partial"].includes(run.outcome), run.outcome);
  assert.ok(f.store.readStream("fixture~aw").length >= 1, "it captured");
  assert.equal(fs.existsSync(captureLockPath(f.root)), false);
});

function timers() {
  let id = 0; const pending = new Map();
  return { setTimer(fn) { pending.set(++id, fn); return id; }, clearTimer(key) { pending.delete(key); },
    fire() { const callbacks = [...pending.values()]; pending.clear(); for (const fn of callbacks) fn(); },
    size() { return pending.size; } };
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
test("watch coalesces notifications and serializes passes; stop keeps the admitted pass but discards pending work", async () => {
  const clock = timers(), first = deferred(), second = deferred(), started = deferred(); let calls = 0, active = 0, peak = 0;
  const queue = captureWatchQueue(async () => {
    calls++; active++; peak = Math.max(peak, active);
    if (calls === 1) await first.promise;
    else { started.resolve(); await second.promise; }
    active--;
  }, clock);
  queue.schedule(); queue.schedule(); assert.equal(clock.size(), 1); clock.fire(); assert.equal(calls, 1);
  for (let i = 0; i < 5; i++) { queue.schedule(); clock.fire(); }
  assert.equal(calls, 1); first.resolve(); await started.promise; assert.equal(calls, 2); assert.equal(peak, 1);
  queue.schedule(); clock.fire(); queue.schedule(); queue.close(); clock.fire(); queue.schedule();
  assert.equal(active, 1); second.resolve(); await queue.settled();
  assert.equal(active, 0); assert.equal(calls, 2); assert.equal(clock.size(), 0);
});
test("watch error and broken diagnostic callback do not strand later work or cause rejected timer promises", async () => {
  const clock = timers(); let calls = 0, errors = 0;
  const queue = captureWatchQueue(async () => { if (++calls === 1) throw new Error("failure"); },
    { ...clock, onError() { errors++; throw new Error("diagnostic unavailable"); } });
  queue.schedule(); clock.fire(); await queue.settled();
  queue.schedule(); clock.fire(); await queue.settled(); queue.close();
  assert.equal(calls, 2); assert.equal(errors, 1);
});

test("foreground CLI watch uses explicit watch trigger and stops after periodic fallback when watcher installation fails", async t => {
  const f = fixture(t), preload = join(f.base, "watch-hints.mjs");
  // Parent-only fixture seams: one periodic tick, failed watcher installation,
  // and shortened debounce. The fixed worker strips inherited preload flags.
  fs.writeFileSync(preload, `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
    fs.watch=()=>{throw new Error('fixture watcher unavailable')}; syncBuiltinESMExports();
    const interval=globalThis.setInterval, timer=globalThis.setTimeout;
    globalThis.setInterval=(fn,ms,...args)=>{if(ms!==900000)return interval(fn,ms,...args);
      let fired=false; return interval(()=>{if(!fired){fired=true;fn(...args)}},50)};
    globalThis.setTimeout=(fn,ms,...args)=>timer(fn,ms===2000?5:ms,...args);`);
  const child = spawn(process.execPath, ["--import", pathToFileURL(preload).href, bin, "--watch", "--no-index"],
    { cwd: f.base, env: f.env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "", signalled = false;
  child.stdout.on("data", bytes => {
    stdout += bytes;
    if (!signalled && (stdout.match(/capture: .*new turns/g) ?? []).length >= 2) { signalled = true; child.kill("SIGTERM"); }
  });
  child.stderr.on("data", bytes => { stderr += bytes; });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 20000);
  const ended = once(child, "close");
  t.after(() => { clearTimeout(timeout); if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
  const [code, signal] = await ended; clearTimeout(timeout);
  assert.equal(signal, null, stdout + stderr); assert.equal(code, 0, stdout + stderr);
  assert.equal((stdout.match(/capture: .*new turns/g) ?? []).length, 2);
  assert.match(stderr, /fixture watcher unavailable/);
  const status = readCaptureStatus(f.root);
  assert.equal(status.lastRun.trigger, "watch"); assert.equal(status.lastRun.counts.turnsAppended, 0);
  assert.equal(f.store.readStream("fixture~cc.session").length, 1); assert.equal(f.store.readStream("fixture~aw").length, 1);
  assert.equal(fs.existsSync(captureLockPath(f.root)), false);
  assert.equal(fs.existsSync(join(f.root, "index/turns.db")), false);
});
