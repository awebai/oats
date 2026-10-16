// Actual frontdoor fixtures. Every child receives only fixture roots/environment;
// no setup, hook installation or service manager is invoked.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
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
