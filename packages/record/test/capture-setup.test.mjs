// Setup first-pass fixtures never install hooks or invoke service managers.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCaptureStatus } from "../lib/capture-status.mjs";
import { captureCommandPass } from "../lib/capture-command-output.mjs";
import { acquireCaptureLock, captureLockPath } from "../lib/capture-lock.mjs";
import { RecordStore } from "../lib/store.mjs";

const setup = new URL("../bin/setup.mjs", import.meta.url).pathname;
const cli = new URL("../bin/capture.mjs", import.meta.url).pathname;
const worker = new URL("../lib/capture-command-worker.mjs", import.meta.url).pathname;
const line = text => JSON.stringify({ timestamp: "2026-01-01T00:00:00Z", text }) + "\n";
function fixture(t) {
  const base = fs.mkdtempSync(join(tmpdir(), "capture-setup-")), home = join(base, "home"), root = join(base, "record");
  const cc = join(base, "selected-claude/projects/project/session.jsonl"), aw = join(home, ".config/aw/logs/account.jsonl");
  for (const path of [join(base, "selected-claude/projects/project"), join(home, ".config/aw/logs"), join(base, "cache")]) fs.mkdirSync(path, { recursive: true });
  fs.writeFileSync(cc, line("native setup"));
  fs.writeFileSync(aw, JSON.stringify({ ts: "2026-01-01T00:00:00Z", ch: "mail", dir: "recv", from: "peer", body: "AW setup" }) + "\n");
  const launch = join(base, "launch.json"), guard = join(base, "guard.mjs");
  fs.writeFileSync(guard, `import cp from 'node:child_process'; import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
cp.spawnSync = cp.execFileSync = () => { throw new Error('setup used a synchronous capture or manager child'); };
const spawn = cp.spawn;
cp.spawn = (exe, args, options) => {
  if (exe !== process.execPath || args.at(-1) !== ${JSON.stringify(worker)}) throw new Error('unexpected setup child');
  fs.writeFileSync(${JSON.stringify(launch)}, JSON.stringify({ exe, args, env: options.env }));
  return spawn(exe, args, options);
};
syncBuiltinESMExports();`);
  const env = { HOME: home, PATH: process.env.PATH, TMPDIR: base, XDG_CACHE_HOME: join(base, "cache"),
    TURN_RECORD_ROOT: "record", TURN_RECORD_OWNER: "ignored-env-owner", CLAUDE_CONFIG_DIR: "selected-claude",
    OATS_NODE_BIN: join(base, "recorded-but-not-executed-node") };
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return { base, home, root, cc, aw, launch,
    run({ ordinary = false, args = [], extra = {} } = {}) {
      return spawnSync(process.execPath, ["--no-warnings", "--import", guard, ordinary ? cli : setup,
        "--owner", "fixture", ...(ordinary ? [] : ["--no-hooks", "--no-service"]), ...args],
      { cwd: base, env: { ...env, ...extra }, encoding: "utf8", timeout: 30000 });
    } };
}
function passed(result) { assert.equal(result.status, 0, result.stderr + result.stdout); }

test("setup first pass uses explicit selection/current Node/fixed worker and setup attribution; ordinary caller remains manual", t => {
  const f = fixture(t), result = f.run(); passed(result);
  assert.match(result.stdout, /running first capture pass/); assert.match(result.stdout, /capture: 2 new turns; complete/);
  assert.match(result.stdout, /index: updated/);
  const status = readCaptureStatus(f.root);
  assert.equal(status.lastRun.trigger, "setup"); assert.equal(status.lastRun.outcome, "complete");
  assert.notEqual(status.lastRun.pid, result.pid); assert.equal(status.lastSuccess.id, status.lastRun.id);
  assert.equal(status.lastRun.counts.turnsAppended, 2); assert.equal(status.lastRun.counts.turnsIndexed, 2);
  assert.equal(status.backlog.pending, false); assert.equal(fs.existsSync(captureLockPath(f.root)), false);
  const launched = JSON.parse(fs.readFileSync(f.launch));
  assert.equal(launched.exe, process.execPath); assert.ok(launched.args.includes("--max-old-space-size=256"));
  assert.equal(launched.args.at(-1), worker); assert.equal(launched.env.NODE_OPTIONS, undefined);
  const store = new RecordStore(f.root, { owner: "fixture" });
  assert.equal(store.readStream("fixture~cc.session").length, 1); assert.equal(store.readStream("fixture~aw").length, 1);
  assert.equal(fs.existsSync(join(f.home, ".claude/settings.json")), false);
  assert.equal(fs.existsSync(join(f.home, ".config/systemd")), false);
  assert.equal(fs.existsSync(join(f.home, "Library")), false);
  const manual = f.run({ ordinary: true }); passed(manual);
  assert.match(manual.stdout, /capture: 0 new turns; complete/);
  assert.equal(readCaptureStatus(f.root).lastRun.trigger, "manual");
});

test("setup partial is pending exit zero; ordinary and setup overlap preserve the existing receipt", t => {
  const f = fixture(t); fs.appendFileSync(f.cc, '{"text":"private incomplete');
  const partial = f.run(); passed(partial);
  assert.match(partial.stdout, /capture: 2 new turns; partial \(input\)/); assert.match(partial.stdout, /index: pending/);
  assert.doesNotMatch(partial.stdout, /index: updated|private incomplete/);
  const status = readCaptureStatus(f.root);
  assert.equal(status.lastRun.trigger, "setup"); assert.equal(status.lastRun.outcome, "partial");
  assert.equal(status.lastRun.reason, "input"); assert.equal(status.lastRun.counts.inputsPending, 1);
  assert.equal(status.backlog.pending, true); assert.equal(status.lastSuccess, null);
  const retry = f.run({ ordinary: true, args: ["--retry-set-aside", "--json"] }); passed(retry);
  assert.deepEqual(JSON.parse(retry.stdout), { appended: 0, pending: true });
  assert.equal(readCaptureStatus(f.root).lastRun.trigger, "manual");
  const before = fs.readFileSync(join(f.root, "capture-status.json")), lock = acquireCaptureLock(f.root);
  try {
    for (const ordinary of [false, true]) {
      const overlap = f.run({ ordinary }); passed(overlap);
      assert.match(overlap.stdout, /another pass holds .*skipping this pass/);
      assert.doesNotMatch(overlap.stdout, /new turns|index: updated/);
      assert.deepEqual(fs.readFileSync(join(f.root, "capture-status.json")), before);
    }
  } finally { lock.release(); }
});

test("setup dry-run creates no pass/store/status and no-service still runs its first pass", t => {
  const f = fixture(t); passed(f.run({ args: ["--dry-run"] }));
  assert.equal(fs.existsSync(f.root), false); assert.equal(fs.existsSync(f.launch), false);
  passed(f.run()); assert.equal(readCaptureStatus(f.root).lastRun.trigger, "setup");
});

test("setup and ordinary privacy refusal remain actionable before lock/worker creation", t => {
  const f = fixture(t); fs.mkdirSync(join(f.root, "ignore"), { recursive: true });
  for (const ordinary of [false, true]) {
    const result = f.run({ ordinary }); assert.equal(result.status, 1);
    assert.match(result.stderr, /cannot read capture ignore file .*make it a readable text file/);
    assert.doesNotMatch(result.stdout, /new turns|index: updated/);
    assert.equal(fs.existsSync(captureLockPath(f.root)), false);
    assert.equal(fs.existsSync(join(f.root, "capture-status.json")), false); assert.equal(fs.existsSync(f.launch), false);
  }
});

test("setup operational discovery failure retains truthful worker failure with healthy independent work", t => {
  const f = fixture(t), refused = join(f.base, "not-a-directory"); fs.writeFileSync(refused, "not a source root");
  const result = f.run({ extra: { CLAUDE_CONFIG_DIR: refused } }); assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /capture pass failed: capture worker failed/);
  assert.doesNotMatch(result.stdout, /new turns|index: updated/);
  const status = readCaptureStatus(f.root);
  assert.equal(status.lastRun.trigger, "setup"); assert.equal(status.lastRun.outcome, "failed");
  assert.equal(status.lastRun.reason, "io"); assert.equal(status.lastFailure.id, status.lastRun.id);
  assert.equal(status.lastRun.counts.turnsAppended, 1); assert.equal(status.lastRun.counts.turnsIndexed, 1);
  assert.equal(status.lastSuccess, null); assert.equal(status.backlog.pending, true);
  assert.equal(fs.existsSync(captureLockPath(f.root)), false);
});

test("shared foreground presentation refuses missing projections and retains lock diagnostics for setup/manual/service", async () => {
  for (const trigger of ["setup", "manual", "service"]) {
    const logs = [], errors = [], options = { trigger, indexEnabled: true };
    const call = run => captureCommandPass("/fixture/record", options, { run, log: line => logs.push(line), error: line => errors.push(line) });
    await assert.rejects(call(async () => ({ outcome: "complete", reason: null, exitCode: 0 })), /matching worker receipt unavailable; appended count is unknown/);
    await assert.rejects(call(async () => ({ outcome: "failed", reason: "heap", exitCode: 1 })), /failed \(heap\).*appended count is unknown/);
    assert.deepEqual(logs, []);
    const failure = Object.assign(new Error("fixture lock failure"), {
      lockCleanup: { path: "/fixture/record/capture.lock", removed: false, reason: "unknown", recovery: "inspect initializing lock" },
      reclaimedLock: { path: "/fixture/record/capture.lock", pid: 123, startedAt: "earlier" },
      release: { reason: "unknown-owner", recovery: "inspect replacement owner" },
    });
    await assert.rejects(call(async () => { throw failure; }), error => error === failure);
    assert.match(errors[0], /could NOT be removed; inspect initializing lock/);
    assert.match(errors[1], /reclaimed .*pid 123/); assert.match(errors[2], /owner record is missing or unreadable.*inspect replacement owner/);
    assert.deepEqual(await call(async () => ({ outcome: "overlap", exitCode: 0, held: { liveness: "unknown", recovery: "inspect held owner" } })), { skipped: true });
    assert.match(errors.at(-1), /inspect held owner; skipping this pass/); assert.deepEqual(logs, []);
  }
});
