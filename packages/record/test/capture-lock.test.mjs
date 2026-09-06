import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { acquireCaptureLock, captureLockPath } from "../lib/capture-lock.mjs";

const CAPTURE = resolve(new URL("../bin/capture.mjs", import.meta.url).pathname);
const LOCK_LIB = resolve(new URL("../lib/capture-lock.mjs", import.meta.url).pathname);

test("capture lock: mutual exclusion; a live holder is never stolen however old; same-pid and unknowable holders count as live; only a dead holder is reclaimed", () => {
  const root = mkdtempSync(join(tmpdir(), "capture-lock-"));
  try {
    const a = acquireCaptureLock(root);
    assert.ok(a.release, "first acquire takes the lock");
    assert.equal(JSON.parse(readFileSync(join(captureLockPath(root), "owner.json"), "utf8")).pid, process.pid);
    // Same pid re-acquiring is held, never reclaimed.
    assert.equal(acquireCaptureLock(root).held?.pid, process.pid);
    a.release(); assert.equal(existsSync(captureLockPath(root)), false);
    // A live holder (a sleeping child) blocks; an old start time does not change that.
    const child = spawn("sleep", ["30"]);
    try {
      mkdirSync(captureLockPath(root));
      writeFileSync(join(captureLockPath(root), "owner.json"), JSON.stringify({ pid: child.pid, startedAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString() }));
      assert.equal(acquireCaptureLock(root).held?.pid, child.pid, "a live holder three hours old is still held");
      // An unknowable holder (EPERM) is treated as live.
      assert.equal(acquireCaptureLock(root, { alive: () => "unknown" }).held?.pid, child.pid);
    } finally { child.kill(); }
    // A dead holder is reclaimed atomically.
    rmSync(captureLockPath(root), { recursive: true, force: true });
    mkdirSync(captureLockPath(root)); writeFileSync(join(captureLockPath(root), "owner.json"), JSON.stringify({ pid: 999999999, startedAt: new Date().toISOString() }));
    const d = acquireCaptureLock(root); assert.ok(d.release, "a dead holder's lock is reclaimed");
    // release removes only a lock this pid owns.
    writeFileSync(join(captureLockPath(root), "owner.json"), JSON.stringify({ pid: 424242, startedAt: new Date().toISOString() }));
    d.release(); assert.equal(existsSync(captureLockPath(root)), true, "another holder's lock is left alone");
    rmSync(captureLockPath(root), { recursive: true, force: true });
    // A lock directory with no owner record is held during the initialization grace, reclaimed after it.
    mkdirSync(captureLockPath(root));
    assert.equal(acquireCaptureLock(root).release, undefined, "a record-less fresh lock is held (owner initializing)");
    const old = new Date(Date.now() - 2 * 60 * 1000); utimesSync(captureLockPath(root), old, old);
    const e = acquireCaptureLock(root); assert.ok(e.release, "a record-less lock older than the grace is reclaimed"); e.release();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("capture lock: concurrent child processes never hold the lock at the same time", () => {
  const root = mkdtempSync(join(tmpdir(), "capture-lock-conc-"));
  try {
    // Each child spins until it gets the lock, records its hold interval, holds briefly, releases.
    const script = `
      import { acquireCaptureLock } from ${JSON.stringify(LOCK_LIB)};
      import { appendFileSync } from "node:fs";
      const root = process.argv[2], log = process.argv[3];
      let got;
      for (let i = 0; i < 4000 && !got; i++) { const l = acquireCaptureLock(root); if (l.release) got = l; else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2); }
      if (!got) { console.error("never acquired"); process.exit(2); }
      const start = Date.now(); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25); const end = Date.now();
      appendFileSync(log, JSON.stringify({ pid: process.pid, start, end }) + "\\n");
      got.release();
    `;
    const scriptPath = join(root, "contender.mjs"); writeFileSync(scriptPath, script);
    const log = join(root, "holds.log");
    const kids = Array.from({ length: 6 }, () => spawn(process.execPath, [scriptPath, root, log], { stdio: ["ignore", "ignore", "pipe"] }));
    const results = kids.map((k) => new Promise((res) => k.on("exit", (code) => res(code))));
    return Promise.all(results).then((codes) => {
      assert.deepEqual(codes, [0, 0, 0, 0, 0, 0], "every contender eventually acquired and exited cleanly");
      const holds = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)).sort((x, y) => x.start - y.start);
      assert.equal(holds.length, 6);
      for (let i = 1; i < holds.length; i++) assert.ok(holds[i].start >= holds[i - 1].end, `hold ${i} (${holds[i].pid}) overlapped hold ${i - 1} (${holds[i - 1].pid})`);
      assert.equal(existsSync(captureLockPath(root)), false, "the lock is released at the end");
    }).finally(() => rmSync(root, { recursive: true, force: true }));
  } catch (e) { rmSync(root, { recursive: true, force: true }); throw e; }
});

test("capture CLI: a pass that finds the root locked by a live holder exits 0 without appending or touching the index", () => {
  const root = mkdtempSync(join(tmpdir(), "capture-lock-cli-"));
  const child = spawn("sleep", ["30"]);
  try {
    mkdirSync(captureLockPath(root)); writeFileSync(join(captureLockPath(root), "owner.json"), JSON.stringify({ pid: child.pid, startedAt: new Date().toISOString() }));
    const r = spawnSync(process.execPath, [CAPTURE, "--sessions-only"], { encoding: "utf8", env: { ...process.env, TURN_RECORD_ROOT: root, TURN_RECORD_OWNER: "tester" } });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /another pass holds .*skipping, the next pass catches up/);
    assert.equal(existsSync(join(root, "index")), false, "no index was created by the skipped pass");
    assert.equal(JSON.parse(readFileSync(join(captureLockPath(root), "owner.json"), "utf8")).pid, child.pid, "the holder's lock is untouched");
  } finally { child.kill(); rmSync(root, { recursive: true, force: true }); }
});

test("capture --install-hint recommends append-only hook passes", () => {
  const r = spawnSync(process.execPath, [CAPTURE, "--install-hint"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /--sessions-only --no-index --quiet/);
  assert.match(r.stdout, /One pass runs per record root at a time/);
});
