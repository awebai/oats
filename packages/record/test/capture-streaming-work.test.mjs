// Small allocation/read-work regressions: never crash a huge baseline process.
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { RecordStore } from "../lib/store.mjs";
import { captureSessions } from "../lib/capture-cc.mjs";
import { sessionAttribution } from "../lib/sessions-for-home.mjs";
import mutableFs from "node:fs";

for (const mode of ["ordinary", "final", "attributed"]) {
  test(`${mode} capture frames source reads at 64 KiB while reconstructing UTF-8 exactly`, (t) => {
    const base = fs.mkdtempSync(join(tmpdir(), "capture-stream-work-"));
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    const path = join(base, "session.jsonl");
    // An unstamped prefix crosses many read boundaries; its first later
    // timestamp must still be carried backward. One record crosses chunks too.
    const prefix = Array.from({ length: 3000 }, (_, i) => JSON.stringify({ i, text: "é界🙂".repeat(7) }) + "\n").join("");
    const stamped = JSON.stringify({ cwd: base, timestamp: "2026-01-01T00:00:00Z", text: "界".repeat(25000) }) + "\n";
    const bytes = Buffer.from(prefix + stamped);
    fs.writeFileSync(path, bytes);
    const snapshot = mode === "attributed" ? sessionAttribution("cc", path, { bound: bytes.length }).snapshot : undefined;
    const store = new RecordStore(join(base, "record"), { owner: "fixture" });
    const originalOpen = mutableFs.openSync, originalRead = mutableFs.readSync, originalClose = mutableFs.closeSync;
    const sources = new Set();
    let readBytes = 0, maxRead = 0;
    mutableFs.openSync = (file, ...args) => { const fd = originalOpen(file, ...args); if (file === path) sources.add(fd); return fd; };
    mutableFs.closeSync = (fd) => { sources.delete(fd); return originalClose(fd); };
    mutableFs.readSync = (fd, buffer, offset, length, position) => {
      if (sources.has(fd)) {
        maxRead = Math.max(maxRead, length);
        assert.ok(length <= 65536, `whole source/tail read requested ${length} bytes`);
      }
      const count = originalRead(fd, buffer, offset, length, position);
      if (sources.has(fd)) readBytes += count;
      return count;
    };
    syncBuiltinESMExports();
    let result;
    try {
      result = captureSessions(store, { owner: "fixture", files: [{ path, ...(snapshot ? { snapshot } : {}) }], final: mode !== "ordinary" });
    } finally {
      mutableFs.openSync = originalOpen; mutableFs.readSync = originalRead; mutableFs.closeSync = originalClose;
      syncBuiltinESMExports();
    }
    assert.equal(result.complete, true);
    assert.equal(result.appended, 3001);
    assert.ok(maxRead > 0);
    assert.ok(readBytes >= bytes.length);
    const turns = store.readStream("fixture~cc.session");
    assert.deepEqual(Buffer.from(turns.map(t => t.body.line).join("\n") + "\n"), bytes);
    assert.ok(turns.every(t => t.ts === "2026-01-01T00:00:00Z"));
  });
}

test("receipt summaries preserve tombstone authority and physical visible boundaries without whole-journal reads", async (t) => {
  const { withReceiptSummaries } = await import("../lib/receipt-summary.mjs");
  const { finishTurn } = await import("../lib/canonical.mjs");
  const base = fs.mkdtempSync(join(tmpdir(), "capture-receipt-work-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const store = new RecordStore(base, { owner: "fixture" });
  const event = (n) => finishTurn({ v: 1, ts: "2026-01-01T00:00:00Z", from: "writer", kind: "session", body: { line: String(n) } });
  const turns = [event(1), event(2), event(3)];
  store.appendBatch("fixture~cc.session", turns);
  const tombstone = (ref, from) => finishTurn({ v: 1, ts: "2026-01-01T00:00:00Z", from, kind: "tombstone", links: [{ rel: "tombstones", ref }] });
  store.appendBatch("fixture~aw", [tombstone(turns[0].id, "writer"), tombstone(turns[1].id, "stranger"), tombstone(turns[2].id, "fixture")]);
  const claims = store.tombstoneClaims();
  const expected = turns.filter(turn => !store.claimHides(claims, turn));
  store.readStream = () => { throw new Error("receipt tried whole-journal allocation"); };
  withReceiptSummaries(store, summary => {
    assert.deepEqual(summary("fixture~cc.session"), { count: expected.length, first: expected[0], last: expected.at(-1) });
    assert.deepEqual(summary("fixture~cc.absent"), { count: 0, first: null, last: null });
  });
});

test("staging releases its private directory on success and a read failure", async (t) => {
  const { stageSnapshot } = await import("../lib/session-snapshot.mjs");
  const base = fs.mkdtempSync(join(tmpdir(), "capture-stage-work-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const path = join(base, "source"), originalTmp = process.env.TMPDIR;
  fs.writeFileSync(path, "record\n");
  process.env.TMPDIR = base;
  const fd = fs.openSync(path, "r");
  try {
    const staged = stageSnapshot(fd, fs.fstatSync(fd), path);
    assert.deepEqual(Buffer.concat([...staged.chunks()]), Buffer.from("record\n"));
    assert.equal(fs.readdirSync(base).length, 2);
    staged.close();
    assert.deepEqual(fs.readdirSync(base), ["source"]);
    assert.throws(() => stageSnapshot(fd, { size: 99 }, path), /short read/);
    assert.deepEqual(fs.readdirSync(base), ["source"]);
  } finally {
    fs.closeSync(fd);
    if (originalTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = originalTmp;
  }
});
