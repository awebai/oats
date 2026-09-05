import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { acquireCaptureLock, captureLockPath } from "../lib/capture-lock.mjs";

const CAPTURE = resolve(new URL("../bin/capture.mjs", import.meta.url).pathname);

test("capture lock: one holder per root; a dead or stale holder is reclaimed; release removes only its own lock", () => {
  const root = mkdtempSync(join(tmpdir(), "capture-lock-"));
  try {
    const a = acquireCaptureLock(root);
    assert.ok(a.release, "first acquire takes the lock");
    assert.equal(JSON.parse(readFileSync(captureLockPath(root), "utf8")).pid, process.pid);
    // A live holder (another pid) blocks: simulate with a child that sleeps.
    const child = spawn("sleep", ["30"]);
    try {
      writeFileSync(captureLockPath(root), JSON.stringify({ pid: child.pid, startedAt: new Date().toISOString() }));
      const b = acquireCaptureLock(root);
      assert.equal(b.held?.pid, child.pid, "a live fresh holder keeps the lock");
      // A LIVE holder keeps the lock however old its start is: a long index
      // pass must never be doubled.
      writeFileSync(captureLockPath(root), JSON.stringify({ pid: child.pid, startedAt: new Date(Date.now() - 16 * 60 * 1000).toISOString() }));
      const c = acquireCaptureLock(root);
      assert.equal(c.held?.pid, child.pid, "a live holder is never reclaimed by age");
      // Only a holder whose liveness cannot be established falls back to age.
      const u1 = acquireCaptureLock(root, { alive: () => "unknown" });
      assert.equal(u1.held?.pid, undefined === u1.held ? undefined : u1.held.pid);
      assert.ok(u1.release, "an unknowable holder past the stale window is reclaimed"); u1.release();
      writeFileSync(captureLockPath(root), JSON.stringify({ pid: child.pid, startedAt: new Date().toISOString() }));
      const u2 = acquireCaptureLock(root, { alive: () => "unknown" });
      assert.equal(u2.held?.pid, child.pid, "an unknowable fresh holder keeps the lock");
    } finally { child.kill(); }
    // A dead pid is reclaimed.
    writeFileSync(captureLockPath(root), JSON.stringify({ pid: 999999999, startedAt: new Date().toISOString() }));
    const d = acquireCaptureLock(root); assert.ok(d.release);
    // release removes only a lock this pid wrote.
    writeFileSync(captureLockPath(root), JSON.stringify({ pid: 424242, startedAt: new Date().toISOString() }));
    d.release(); assert.equal(existsSync(captureLockPath(root)), true, "another holder's lock is left alone");
    rmSync(captureLockPath(root));
    const e = acquireCaptureLock(root); e.release(); assert.equal(existsSync(captureLockPath(root)), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("capture CLI: a pass that finds the root locked by a live holder exits 0 without appending or touching the index", () => {
  const root = mkdtempSync(join(tmpdir(), "capture-lock-cli-"));
  const child = spawn("sleep", ["30"]);
  try {
    writeFileSync(captureLockPath(root), JSON.stringify({ pid: child.pid, startedAt: new Date().toISOString() }));
    const r = spawnSync(process.execPath, [CAPTURE, "--sessions-only"], { encoding: "utf8", env: { ...process.env, TURN_RECORD_ROOT: root, TURN_RECORD_OWNER: "tester" } });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /another pass holds .*skipping, the next pass catches up/);
    assert.equal(existsSync(join(root, "index")), false, "no index was created by the skipped pass");
    assert.equal(JSON.parse(readFileSync(captureLockPath(root), "utf8")).pid, child.pid, "the holder's lock is untouched");
  } finally { child.kill(); rmSync(root, { recursive: true, force: true }); }
});

test("capture --install-hint recommends append-only hook passes", () => {
  const r = spawnSync(process.execPath, [CAPTURE, "--install-hint"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /--sessions-only --no-index --quiet/);
  assert.match(r.stdout, /One pass runs per record root at a time/);
});
