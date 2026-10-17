// Isolated hook launch fixtures only; no installed hook or manager is invoked.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchCaptureHook } from "../lib/capture-hook.mjs";
import { captureDefaultRootPlan } from "../lib/capture-default-roots.mjs";
import { readCaptureStatus } from "../lib/capture-status.mjs";
import { RecordStore } from "../lib/store.mjs";
import { acquireCaptureLock, captureLockPath } from "../lib/capture-lock.mjs";

const cli = fileURLToPath(new URL("../bin/capture.mjs", import.meta.url));
const runner = fileURLToPath(new URL("../lib/capture-hook-runner.mjs", import.meta.url));
function fixture(t) {
  const base = fs.mkdtempSync(join(tmpdir(), "capture-hook-")), home = join(base, "home"), root = join(base, "record");
  fs.mkdirSync(home); fs.mkdirSync(join(base, "cache"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const env = { HOME: home, PATH: process.env.PATH, TMPDIR: base, XDG_CACHE_HOME: join(base, "cache"),
    TURN_RECORD_ROOT: root, TURN_RECORD_OWNER: "fixture" };
  const options = { owner: "fixture", plan: captureDefaultRootPlan({ home, cwd: base, sources: ["aw"] }),
    indexEnabled: false, trigger: "hook", retrySetAside: false };
  return { base, home, root, env, options,
    cli(args, preload) { return spawnSync(process.execPath, ["--no-warnings", ...(preload ? ["--import", preload] : []), cli, ...args],
      { cwd: base, env, encoding: "utf8", timeout: 15000 }); } };
}
async function until(predicate) {
  const end = Date.now() + 15000;
  while (!predicate()) { if (Date.now() > end) throw new Error("fixture handshake did not finish"); await delay(10); }
}

test("hook launch copies selection into a fixed detached owner without filesystem work or inherited policy", async t => {
  const f = fixture(t); let unreferenced = false, called = false;
  const result = await launchCaptureHook("record", f.options, {
    env: { ...f.env, NODE_OPTIONS: "--import unsafe", TMUX: "live", CLAUDE_CONFIG_DIR: "unselected" },
    spawnChild(executable, args, options) {
      called = true;
      assert.equal(executable, process.execPath); assert.equal(args.at(-2), runner);
      assert.deepEqual(JSON.parse(args.at(-1)), { root: f.root, options: f.options });
      assert.equal(options.detached, true); assert.equal(options.stdio, "ignore"); assert.equal(options.shell, false);
      assert.equal(options.cwd, f.base); assert.equal(options.env.HOME, f.home);
      for (const key of ["NODE_OPTIONS", "TMUX", "CLAUDE_CONFIG_DIR", "TURN_RECORD_ROOT"]) assert.equal(options.env[key], undefined);
      assert.equal(fs.existsSync(f.root), false);
      const child = new EventEmitter(); child.unref = () => { unreferenced = true; };
      queueMicrotask(() => child.emit("spawn")); return child;
    },
  });
  assert.deepEqual(result, { launched: true }); assert.equal(called, true); assert.equal(unreferenced, true);
  assert.equal(fs.existsSync(f.root), false, "launch acknowledgement creates no lock/status/store");
  for (const extra of [{ workerPath: "elsewhere" }, { nodePath: "elsewhere" }, { trigger: "manual" }, { retrySetAside: true }]) {
    await assert.rejects(launchCaptureHook(f.root, { ...f.options, ...extra }, { spawnChild() { assert.fail("invalid intent spawned"); } }));
  }
});

test("hook usage and OS spawn errors exit one with one stderr line, never two; ordinary usage stays two", t => {
  const f = fixture(t);
  for (const args of [["--hook", "--unknown"], ["--hook", "--owner"], ["--owner", "--hook"], ["--hook=false"],
    ["--hook", "--owner", "bad/owner"], ["--hook", "--root", ""], ["--hook", "--unknown\nprivate"],
    ...["--help", "--json", "--health", "--watch", "--status", "--install-hint", "--reset-cursors", "--retry-set-aside", "--current-roots"].map(flag => ["--hook", flag]),
    ["--hook", "--home", f.home], ["--hook", "--file", "session.jsonl", "--format", "cc"]]) {
    const result = f.cli(args);
    assert.equal(result.status, 1, result.stderr); assert.equal(result.stdout, "");
    assert.match(result.stderr, /^capture hook launch failed: [^\n]+\n$/);
    assert.equal(fs.existsSync(f.root), false);
  }
  assert.equal(f.cli(["--unknown"]).status, 2);
  for (const mode of ["throw", "event"]) {
    const preload = join(f.base, `${mode}.mjs`);
    fs.writeFileSync(preload, `import cp from 'node:child_process'; import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
cp.spawn = () => { const error = new Error('fixture spawn failure\\nsecond line');
  if (${JSON.stringify(mode)} === 'throw') throw error;
  const child = new EventEmitter(); child.unref = () => { throw new Error('failed child unref'); };
  queueMicrotask(() => child.emit('error', error)); return child; };
syncBuiltinESMExports();`);
    const result = f.cli(["--hook", "--aw-only", "--no-index"], preload);
    assert.equal(result.status, 1); assert.equal(result.stdout, "");
    assert.equal(result.stderr, "capture hook launch failed: fixture spawn failure second line\n");
    assert.equal(fs.existsSync(f.root), false);
  }
});

test("fixed detached supervisor owns hook accounting and overlap; launcher never writes a receipt", async t => {
  const f = fixture(t), logs = join(f.home, ".config/aw/logs"); fs.mkdirSync(logs, { recursive: true });
  fs.writeFileSync(join(logs, "account.jsonl"), JSON.stringify({ ts: "2026-01-01T00:00:00Z", ch: "mail", dir: "recv", from: "peer", body: "fixture hook" }) + "\n");
  async function launch() {
    let child, closed;
    const result = await launchCaptureHook(f.root, f.options, { env: f.env, spawnChild(...args) {
      child = spawn(...args);
      closed = new Promise((resolve, reject) => { child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal })); });
      return child;
    } });
    assert.deepEqual(result, { launched: true });
    // The fixture owns this real child handle and waits for its supervisor to
    // reap registered workers and release the root before deleting any files.
    const timer = setTimeout(() => child.kill("SIGTERM"), 20000);
    try { assert.deepEqual(await closed, { code: 0, signal: null }); } finally { clearTimeout(timer); }
  }
  await launch();
  const status = readCaptureStatus(f.root);
  assert.equal(status.lastRun.trigger, "hook"); assert.equal(status.lastRun.outcome, "partial");
  assert.equal(status.lastRun.counts.turnsAppended, 1); assert.equal(status.lastRun.counts.turnsIndexed, 0);
  assert.equal(status.lastSuccess, null); assert.equal(status.backlog.pending, true);
  assert.equal(fs.existsSync(join(f.root, "index/turns.db")), false); assert.equal(fs.existsSync(captureLockPath(f.root)), false);
  assert.equal(new RecordStore(f.root, { owner: "fixture" }).readStream("fixture~aw").length, 1);
  const before = fs.readFileSync(join(f.root, "capture-status.json")), lock = acquireCaptureLock(f.root);
  try { await launch(); assert.deepEqual(fs.readFileSync(join(f.root, "capture-status.json")), before); }
  finally { lock.release(); }
});

for (const killLauncher of [false, true]) test(`detached transport closes harness pipes and survives launcher kill:${killLauncher}`, async t => {
  const f = fixture(t), ready = join(f.base, "ready"), release = join(f.base, "release"), done = join(f.base, "done");
  const ping = join(f.base, "ping"), pong = join(f.base, "pong");
  const childScript = join(f.base, "controlled-child.mjs"), preload = join(f.base, "transport.mjs");
  // Controlled transport child: no capture, worker, manager or descendants.
  // The fixture requests its shutdown and awaits its exit marker even on failure;
  // after launcher death the OS reaps the detached orphan. No PID-based cleanup.
  fs.writeFileSync(childScript, `import fs from 'node:fs';
const ready=${JSON.stringify(ready)}, release=${JSON.stringify(release)}, done=${JSON.stringify(done)};
const ping=${JSON.stringify(ping)}, pong=${JSON.stringify(pong)};
process.on('exit', code => fs.writeFileSync(done, String(code)));
fs.writeFileSync(ready, 'running');
const deadline = Date.now() + 20000;
setInterval(() => { if (fs.existsSync(ping)) fs.writeFileSync(pong, 'alive after launcher exit');
  if (fs.existsSync(release)) process.exit(0); if (Date.now() > deadline) process.exit(1); }, 10);`);
  fs.writeFileSync(preload, `import cp from 'node:child_process'; import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const original = cp.spawn;
for (const name of ['statSync', 'lstatSync', 'readdirSync', 'openSync', 'readFileSync', 'writeFileSync', 'mkdirSync']) {
  const operation = fs[name]; fs[name] = (path, ...rest) => {
    if ([${JSON.stringify(f.root)}, ${JSON.stringify(f.home)}].some(root => String(path) === root || String(path).startsWith(root + '/'))) throw new Error('launcher filesystem access');
    return operation(path, ...rest);
  };
}
cp.spawn = (exe, args, options) => {
  if (exe !== process.execPath || args.at(-2) !== ${JSON.stringify(runner)} || !options.detached || options.stdio !== 'ignore') throw new Error('wrong launch transport');
  const request=JSON.parse(args.at(-1));
  if (request.options.trigger !== 'hook' || request.options.indexEnabled || request.options.plan.sources.join(',') !== 'cc,pi,codex') throw new Error('wrong copied selection');
  const child = original(exe, [${JSON.stringify(childScript)}], options);
  if (${killLauncher}) { const once = child.once; child.once = function(event, listener) {
    return once.call(this, event, event === 'spawn' ? () => {} : listener); }; }
  return child;
};
syncBuiltinESMExports();`);
  const launcher = spawn(process.execPath, ["--no-warnings", "--import", preload, cli, "--hook", "--sessions-only", "--no-index"],
    { cwd: f.base, env: f.env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "", closed = false;
  launcher.stdout.on("data", bytes => { stdout += bytes; }); launcher.stderr.on("data", bytes => { stderr += bytes; });
  const exit = new Promise((resolve, reject) => { launcher.once("error", reject); launcher.once("close", (code, signal) => { closed = true; resolve({ code, signal }); }); });
  try {
    await until(() => fs.existsSync(ready));
    if (killLauncher) launcher.kill("SIGKILL");
    await until(() => closed);
    assert.deepEqual(await exit, killLauncher ? { code: null, signal: "SIGKILL" } : { code: 0, signal: null });
    assert.equal(stderr, "");
    assert.equal(stdout, killLauncher ? "" : "capture launched; launch is not completion (see capture --health)\n");
    fs.writeFileSync(ping, "prove independent progress");
    await until(() => fs.existsSync(pong));
    assert.equal(fs.readFileSync(pong, "utf8"), "alive after launcher exit");
    assert.equal(fs.existsSync(done), false, "child still awaits its own shutdown after launcher/pipe closure");
    assert.equal(fs.existsSync(f.root), false, "launch is not initialization or a capture receipt");
  } finally {
    fs.writeFileSync(release, "stop");
    if (!closed) launcher.kill("SIGKILL");
    await exit;
    await until(() => fs.existsSync(done));
    assert.equal(fs.readFileSync(done, "utf8"), "0", "fixture child acknowledges owned shutdown, not its watchdog");
  }
});
