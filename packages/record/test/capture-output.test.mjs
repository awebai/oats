// Actual CLI pipes, including a controlled write gate. No live sources/managers.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DerivedState } from "../lib/derived-state.mjs";
import { captureHealth, writeCaptureStatus } from "../lib/capture-state.mjs";
import { failureAfterAttempt } from "../lib/capture-failures.mjs";
import { captureLockPath } from "../lib/capture-lock.mjs";

const bin = resolve(import.meta.dirname, "../bin/capture.mjs");
function fixture(t, { watchPrivacy = false } = {}) {
  const home = fs.mkdtempSync(join(tmpdir(), "capture-output-")), root = join(home, "record");
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const driver = join(home, "gated.mjs");
  fs.writeFileSync(driver, `
${watchPrivacy ? `import fs from 'node:fs';
const interval = globalThis.setInterval;
globalThis.setInterval = (callback, delay, ...args) => {
  const handle = interval(callback, delay, ...args);
  if (delay === 15 * 60 * 1000) setImmediate(() => {
    fs.mkdirSync(${JSON.stringify(join(root, "ignore"))}); callback(...args);
  });
  return handle;
};` : ""}
const queues = {}, released = new Set();
for (const name of ['stdout', 'stderr']) {
  const stream = process[name], write = stream.write.bind(stream);
  queues[name] = { write, entries: [] };
  stream.write = (...args) => {
    if (released.has(name)) return write(...args);
    queues[name].entries.push(args); return false;
  };
}
process.on('message', async name => {
  const queue = queues[name]; if (!queue || released.has(name)) throw new Error('bad release');
  released.add(name);
  let backpressured = 0;
  await Promise.all(queue.entries.map(args => new Promise((resolve, reject) => {
    const callback = typeof args.at(-1) === 'function' ? args.pop() : null;
    if (!queue.write(...args, error => { callback?.(error); error ? reject(error) : resolve(); })) backpressured++;
  })));
  process.send({ type: name + '-drained', writes: queue.entries.length, backpressured });
  if (released.size === 2) process.disconnect();
});
process.argv.splice(1, 1);
await import(${JSON.stringify(pathToFileURL(bin).href)});
process.send({ type: 'ready', stdout: queues.stdout.entries.length, stderr: queues.stderr.entries.length });
`);
  return { home, root, driver, env: { HOME: home, TMPDIR: home, XDG_CACHE_HOME: home, NODE_NO_WARNINGS: "1" } };
}

async function command(f, args, gated = false) {
  const child = spawn(process.execPath, [
    ...process.execArgv.filter(arg => arg === "--experimental-sqlite"),
    ...(gated ? [f.driver] : []), bin, "--root", f.root, ...args,
  ], { env: f.env, cwd: f.home, detached: true, stdio: ["ignore", "pipe", "pipe", ...(gated ? ["ipc"] : [])] });
  let stdout = "", stderr = "", wake;
  const messages = [];
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", text => { stdout += text; }); child.stderr.on("data", text => { stderr += text; });
  child.on("message", message => { messages.push(message); wake?.(); });
  const closed = new Promise((resolve, reject) => {
    child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal }));
  });
  // Failure deadline only. Success depends on messages, write callbacks and
  // child close, never a sleep or merely exceeding a byte threshold.
  const stopOwnedGroup = () => {
    if (!child.pid) return;
    try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  };
  const deadline = setTimeout(stopOwnedGroup, 30000);
  const message = async type => {
    while (!messages.some(item => item.type === type)) {
      await Promise.race([new Promise(resolve => { wake = resolve; }), closed.then(() => {
        throw new Error(`CLI closed before ${type}: ${stderr}`);
      })]);
    }
    return messages.find(item => item.type === type);
  };
  try {
    if (gated) {
      await message("ready"); assert.equal(stdout, ""); assert.equal(stderr, "");
      child.send("stdout"); await message("stdout-drained");
      assert.equal(stderr, "", "stdout completion cannot release stderr");
      child.send("stderr"); await message("stderr-drained");
    }
    const exit = await closed;
    assert.equal(exit.signal, null, "fixture must finish and be reaped without its deadline");
    return { ...exit, stdout, stderr, messages };
  } finally {
    clearTimeout(deadline);
    if (child.exitCode === null && child.signalCode === null) stopOwnedGroup();
    await closed.catch(() => {});
  }
}

function tree(root) {
  if (!fs.existsSync(root)) return null;
  return Object.fromEntries(fs.readdirSync(root).sort().map(name => {
    const path = join(root, name), st = fs.lstatSync(path);
    return [name, st.isDirectory() ? tree(path) : { bytes: fs.readFileSync(path).toString("base64"), mtime: st.mtimeMs }];
  }));
}

test("large piped health output delivers both complete samples, banners and JSON without mutation", async t => {
  const f = fixture(t), state = new DerivedState(f.root);
  state.transaction(() => {
    for (let n = 150; n >= 0; n--) {
      // Long synthetic labels make each rendered category larger than a pipe
      // buffer. They are DB metadata, never real paths opened by the fixture.
      const label = `${String(n).padStart(3, "0")}-${"x".repeat(4096)}`;
      state.set("set-aside", String(n), { source: "cc", path: `/fixture/${label}`, offset: n, line: 1, reason: "captured-prefix-changed" });
      const failed = failureAfterAttempt(null, { stream: `fixture~cc.${label}`, offset: n, reason: "interrupted" }, 0);
      state.set("capture-failed", failed.stream, { ...failed, generation: "PRIVATE-GENERATION", admission: "PRIVATE-UNIT" });
    }
  }); state.close();
  const snapshot = writeCaptureStatus(f.root), health = captureHealth(f.root, { home: f.home });
  assert.deepEqual(health.backlog, snapshot.backlog);
  assert.equal(health.backlog.setAsideCount, 151); assert.equal(health.backlog.failedCount, 151);
  assert.equal(health.backlog.setAside.length, 100); assert.equal(health.backlog.failed.length, 100);
  assert.equal(health.backlog.truncated, true); assert.equal(health.backlog.failedTruncated, true);
  const before = tree(f.root);
  const expected = [`capture: ${health.status}`, ...health.rows.map(row => `${row.code}: ${row.message}`),
    ...health.backlog.setAside.map(row => `${row.source}: ${row.path}:${row.line} offset ${row.offset}: ${row.reason}`),
    "showing first 100 set-aside inputs",
    ...health.backlog.failed.map(row => `${row.stream}: unit starting at byte ${row.offset} (failing frame unknown): ${row.reason}; attempts ${row.attempts}; next retry ${row.nextRetryAt}`),
    "showing first 100 failed stream units", ""].join("\n");
  assert.ok(Buffer.byteLength(expected) > 512 * 1024, "stress prerequisite, not the delivery oracle");
  for (const gated of [false, true]) {
    const text = await command(f, ["--health"], gated);
    assert.equal(text.code, 0); assert.equal(text.stdout, expected); assert.equal(text.stderr, "");
    assert.equal(text.stdout.split("\n").filter(line => line.includes("unit starting at byte")).length, 100);
    assert.match(text.stdout, /unit starting at byte 0 \(failing frame unknown\)/);
    assert.match(text.stdout, /showing first 100 set-aside inputs/); assert.match(text.stdout, /showing first 100 failed stream units\n$/);
    assert.doesNotMatch(text.stdout, /PRIVATE/);
    if (gated) assert.ok(text.messages.find(row => row.type === "stdout-drained").backpressured > 0);
    const json = await command(f, ["--health", "--json"], gated);
    assert.equal(json.code, 0); assert.equal(json.stderr, "");
    assert.equal(json.stdout, JSON.stringify(health, null, 2) + "\n");
    assert.deepEqual(JSON.parse(json.stdout), health); assert.doesNotMatch(json.stdout, /PRIVATE/);
    assert.deepEqual(tree(f.root), before, "health must not capture, create a store, or publish status");
  }
});

test("delayed health success and reader errors finish both pipes with no fallthrough/root creation", async t => {
  const f = fixture(t);
  const healthy = await command(f, ["--health"], true);
  assert.equal(healthy.code, 0); assert.equal(healthy.stdout, "capture: ok\n"); assert.equal(healthy.stderr, "");
  assert.equal(tree(f.root), null);
  fs.mkdirSync(join(f.home, ".claude")); fs.writeFileSync(join(f.home, ".claude", "settings.json"), "{");
  let error;
  try { captureHealth(f.root, { home: f.home }); } catch (caught) { error = caught.message; }
  assert.equal(typeof error, "string");
  const before = tree(f.home);
  const text = await command(f, ["--health"], true);
  assert.equal(text.code, 1); assert.equal(text.stdout, ""); assert.equal(text.stderr, `capture: ${error}\n`);
  const json = await command(f, ["--health", "--json"], true);
  assert.equal(json.code, 1); assert.equal(json.stderr, "");
  assert.equal(json.stdout, JSON.stringify({ status: "failed", error }) + "\n");
  assert.equal(tree(f.root), null); assert.deepEqual(tree(f.home), before);
});

test("other terminal CLI branches preserve delayed output and usage/privacy exit contracts", async t => {
  const f = fixture(t);
  for (const [args, code] of [[ ["--help"], 0 ], [ ["--not-an-option"], 2 ],
    [ ["--not-an-option", "--json"], 2 ], [ ["--hook", "--not-an-option"], 1 ],
    [ ["--install-hint"], 0 ], [ ["--status"], 0 ], [ ["--json"], 2 ],
    [ ["--reset-cursors", "--json"], 0 ]]) {
    const plain = await command(f, args), delayed = await command(f, args, true);
    assert.equal(plain.code, code); assert.equal(delayed.code, code);
    assert.equal(delayed.stdout, plain.stdout); assert.equal(delayed.stderr, plain.stderr);
    assert.ok(plain.stdout.length + plain.stderr.length > 0);
  }
  fs.mkdirSync(join(f.root, "ignore"));
  for (const args of [[], ["--retry-set-aside", "--json"], ["--status"]]) {
    const result = await command(f, args, true);
    assert.equal(result.code, 1); assert.equal(result.stderr.trim().split("\n").length, 1);
    assert.match(result.stderr, /ignore/); assert.doesNotMatch(result.stderr, /capture pass failed|PrintedCaptureFailure/);
    assert.equal(fs.existsSync(captureLockPath(f.root)), false);
  }
});

test("privacy refusal on a later foreground watch pass closes scheduling after one diagnostic", async t => {
  const f = fixture(t, { watchPrivacy: true });
  const result = await command(f, ["--watch", "--owner", "fixture", "--no-index"], true);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /capture: 0 new turns; partial \(input\)/);
  assert.equal(result.stderr.trim().split("\n").length, 1);
  assert.match(result.stderr, /ignore/); assert.doesNotMatch(result.stderr, /capture pass failed|PrintedCaptureFailure/);
  assert.equal(fs.existsSync(captureLockPath(f.root)), false);
  const saved = JSON.parse(fs.readFileSync(join(f.root, "capture-status.json"), "utf8"));
  assert.equal(saved.lastRun.trigger, "watch"); assert.equal(saved.lastRun.outcome, "partial");
  assert.equal(saved.lastRun.counts.turnsAppended, 0);
});
