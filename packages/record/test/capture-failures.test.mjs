import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { DerivedState } from "../lib/derived-state.mjs";
import { captureHealth, resetSourceCursors, retrySetAside, writeCaptureStatus } from "../lib/capture-state.mjs";
import { readIssueBacklog } from "../lib/capture-issues.mjs";
import { failureAfterAttempt, failureReady } from "../lib/capture-failures.mjs";

const now = Date.parse("2026-01-01T00:00:00.000Z");
const unit = n => ({ stream: `fixture~cc.${String(n).padStart(4, "0")}`, offset: n * 100, reason: "interrupted" });
const failure = n => failureAfterAttempt(null, unit(n), now);
const aside = n => ({ source: "cc", path: `/fixture/${n}`, offset: 0, reason: "captured-prefix-changed", line: 1 });
const bin = resolve(import.meta.dirname, "../bin/capture.mjs");
function fixture(t) {
  const base = fs.mkdtempSync(join(tmpdir(), "capture-failures-")), root = join(base, "record");
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const command = (...args) => spawnSync(process.execPath, [bin, "--root", root, ...args], {
    encoding: "utf8", env: { HOME: base, TMPDIR: base, PATH: process.env.PATH }, timeout: 15000,
  });
  return { base, root, command };
}

test("failure backoff counts actual attempts, caps at sixteen intervals and never changes a skipped row", () => {
  let prior = null, stamp = now;
  for (const minutes of [30, 60, 120, 240, 240, 240]) {
    const next = failureAfterAttempt(prior, unit(0), stamp);
    assert.equal(next.attempts, (prior?.attempts ?? 0) + 1);
    assert.equal(Date.parse(next.nextRetryAt) - stamp, minutes * 60000);
    const before = JSON.stringify(next);
    assert.equal(failureReady(next, Date.parse(next.nextRetryAt) - 1), false);
    assert.equal(failureReady(next, Date.parse(next.nextRetryAt)), true);
    assert.equal(JSON.stringify(next), before);
    prior = next; stamp = Date.parse(next.nextRetryAt);
  }
  assert.throws(() => failureAfterAttempt(prior, unit(1), now), /previous/);
  assert.throws(() => failureAfterAttempt(null, { ...unit(0), reason: "corrupt" }, now), /invalid/);
  assert.throws(() => failureAfterAttempt(null, { ...unit(0), offset: -1 }, now), /invalid/);
});

test("both categories have independent coherent 100-entry samples and no private evidence leaks", t => {
  const f = fixture(t), state = new DerivedState(f.root);
  state.transaction(() => {
    for (let n = 150; n >= 0; n--) {
      state.set("set-aside", String(n), aside(n));
      state.set("capture-failed", unit(n).stream, { ...failure(n), generation: "PRIVATE-GENERATION", admission: "PRIVATE-UNIT" });
    }
  }); state.close();
  const snapshot = writeCaptureStatus(f.root), health = captureHealth(f.root, { home: f.base });
  assert.deepEqual(health.backlog, snapshot.backlog);
  assert.equal(health.backlog.setAsideCount, 151); assert.equal(health.backlog.failedCount, 151);
  assert.equal(health.backlog.setAside.length, 100); assert.equal(health.backlog.failed.length, 100);
  assert.equal(health.backlog.truncated, true); assert.equal(health.backlog.failedTruncated, true);
  assert.deepEqual(health.backlog.failed[0], failure(0)); assert.equal(health.backlog.pending, true);
  assert.equal(health.lastSuccess, null); assert.equal(health.status, "warning");
  assert.deepEqual(health.rows.map(row => row.code), ["capture-input-set-aside", "capture-pass-failed", "capture-success-stale"]);
  assert.doesNotMatch(JSON.stringify(health), /PRIVATE/);
  const text = f.command("--health"); assert.equal(text.status, 0, text.stderr);
  assert.equal(text.stdout.split("\n").filter(line => line.includes("unit starting at byte")).length, 100);
  assert.match(text.stdout, /unit starting at byte 0 \(failing frame unknown\)/);
  assert.match(text.stdout, /showing first 100 failed stream units/);
  assert.doesNotMatch(text.stdout, /PRIVATE/);
});

test("operational failures survive reopen, reset and source retry; missing DB cannot erase snapshot evidence", t => {
  const f = fixture(t), state = new DerivedState(f.root);
  state.set("capture-failed", unit(1).stream, failure(1)); state.close();
  writeCaptureStatus(f.root);
  resetSourceCursors(f.root, "fixture", "aw"); retrySetAside(f.root);
  const result = f.command("--health", "--json"); assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).backlog.failed, [failure(1)]);
  fs.unlinkSync(join(f.root, "index/capture.db"));
  assert.throws(() => captureHealth(f.root, { home: f.base }), /missing.*active capture issues/);
});

test("legacy snapshots omit all operational fields; incomplete new shapes do not pass validation", t => {
  const f = fixture(t), state = new DerivedState(f.root); state.close();
  const status = writeCaptureStatus(f.root), path = join(f.root, "capture-status.json");
  for (const key of ["failedCount", "failed", "failedTruncated"]) delete status.backlog[key];
  fs.writeFileSync(path, JSON.stringify(status));
  assert.deepEqual(captureHealth(f.root, { home: f.base }).rows.map(row => row.code), ["capture-success-stale"]);
  status.backlog.failedCount = 0; fs.writeFileSync(path, JSON.stringify(status));
  assert.equal(captureHealth(f.root, { home: f.base }).rows[0].code, "capture-status-invalid");
});

test("malformed active operational evidence fails health rather than returning an empty inventory", t => {
  const f = fixture(t), state = new DerivedState(f.root);
  state.set("capture-failed", unit(0).stream, { ...failure(0), attempts: 0 }); state.close();
  const result = f.command("--health", "--json"); assert.notEqual(result.status, 0);
  assert.match(JSON.parse(result.stdout).error, /malformed capture failure/);
  assert.equal(JSON.parse(result.stdout).backlog, undefined);
});

test("both category counts and samples see one snapshot when a writer updates between projections", t => {
  const f = fixture(t), writer = new DerivedState(f.root);
  writer.set("set-aside", "one", aside(0)); writer.set("capture-failed", unit(0).stream, failure(0));
  const reader = new DatabaseSync(join(f.root, "index/capture.db"), { readOnly: true });
  const prepare = DatabaseSync.prototype.prepare; let writing = false;
  DatabaseSync.prototype.prepare = function(sql, ...args) {
    const stmt = prepare.call(this, sql, ...args);
    if (this === reader && sql === "SELECT count(*) AS n FROM state WHERE kind = 'set-aside'") {
      const get = stmt.get.bind(stmt);
      stmt.get = (...params) => {
        const result = get(...params);
        writer.db.exec("BEGIN IMMEDIATE"); writing = true;
        writer.set("set-aside", "two", aside(1)); writer.set("capture-failed", unit(1).stream, failure(1));
        return result;
      };
    }
    return stmt;
  };
  try {
    const b = readIssueBacklog(reader, { validate: true });
    assert.equal(writing, true); assert.equal(b.setAsideCount, 1); assert.equal(b.failedCount, 1);
    assert.equal(b.setAside.length, 1); assert.deepEqual(b.failed, [failure(0)]);
  } finally {
    DatabaseSync.prototype.prepare = prepare;
    if (writing) writer.db.exec("COMMIT"); reader.close(); writer.close();
  }
  const b = captureHealth(f.root, { home: f.base }).backlog; assert.equal(b.setAsideCount, 2); assert.equal(b.failedCount, 2);
});
