// RecordIndex.update work tracks candidate streams and new bytes: a stream
// whose validation checkpoint and search cursor prove it current takes no
// lock, no validation and no capture.db connection of its own, while every
// route that can make the union stale still resets or refuses.

import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { RecordStore } from "../lib/store.mjs";
import { RecordIndex } from "../lib/index-db.mjs";
import { DerivedState } from "../lib/derived-state.mjs";
import { captureContext, withCaptureGroup } from "../lib/capture-context.mjs";
import { finishTurn } from "../lib/canonical.mjs";

const require = createRequire(import.meta.url);
const sqlite = require("node:sqlite");
const OWNER = "fixture", STREAMS = 12;
const stream = (n) => `${OWNER}~aw-${String(n).padStart(2, "0")}`;
const turn = (word, n) => finishTurn({ v: 1, ts: "2026-01-01T00:00:00Z", from: OWNER, kind: "mail", body: { text: `${word} ${n} ${"x".repeat(200)}` }, provenance: { source: "test", fidelity: "projected" } });

/** A warm record: STREAMS streams of three turns each, validated and indexed. */
function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), "record-index-update-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new RecordStore(root, { owner: OWNER });
  for (let s = 0; s < STREAMS; s++) store.appendBatch(stream(s), [0, 1, 2].map(i => turn(`base${s}`, i)));
  const index = new RecordIndex(store);
  try { index.update(); } finally { index.close(); }
  return root;
}

/** A fresh store and index over the root, as a new command process opens them. */
function open(t, root) {
  const store = new RecordStore(root, { owner: OWNER }), index = new RecordIndex(store);
  t.after(() => index.close());
  return { store, index };
}

function journalReads(fn) {
  const openSync = fs.openSync, closeSync = fs.closeSync, readSync = fs.readSync;
  const journals = new Set();
  let bytes = 0;
  fs.openSync = (path, ...args) => { const fd = openSync(path, ...args); if (String(path).endsWith("journal.jsonl")) journals.add(fd); return fd; };
  fs.closeSync = (fd) => { journals.delete(fd); return closeSync(fd); };
  fs.readSync = (fd, ...args) => { const n = readSync(fd, ...args); if (journals.has(fd)) bytes += n; return n; };
  syncBuiltinESMExports();
  try { fn(); return bytes; }
  finally { fs.openSync = openSync; fs.closeSync = closeSync; fs.readSync = readSync; syncBuiltinESMExports(); }
}

/** The work one operation does: capture.db connections and their prepared
 *  statements, stream locks, journal validations and journal bytes read. */
function measure(store, fn) {
  const Database = sqlite.DatabaseSync, work = { opens: 0, prepares: 0, locks: 0, validations: 0, bytes: 0 };
  sqlite.DatabaseSync = class extends Database {
    constructor(path, ...rest) { super(path, ...rest); this.counted = String(path).endsWith("capture.db"); if (this.counted) work.opens++; }
    prepare(sql) { if (this.counted) work.prepares++; return super.prepare(sql); }
  };
  const lock = store.withStreamLock, validate = store.validateJournal;
  store.withStreamLock = function (...args) { work.locks++; return lock.apply(this, args); };
  store.validateJournal = function (...args) { work.validations++; return validate.apply(this, args); };
  try { work.bytes = journalReads(fn); }
  finally { sqlite.DatabaseSync = Database; delete store.withStreamLock; delete store.validateJournal; }
  return work;
}

/** Appends `turns` to each of `streams`. → the journal bytes they added. */
function grow(store, streams, turns) {
  const size = (s) => fs.statSync(store.journalPath(s)).size;
  let grown = 0;
  for (const s of streams) { const before = size(s); store.appendBatch(s, turns(s)); grown += size(s) - before; }
  return grown;
}

/** The incremental union equals a rebuild from the journals. */
function agreesWithRebuild(index) {
  const incremental = index.counts();
  index.rebuild();
  assert.deepEqual(index.counts(), incremental);
}

test("a warm unchanged pass takes one capture.db connection and no lock, validation or journal read", (t) => {
  const root = fixture(t), { store, index } = open(t, root);
  const work = measure(store, () => index.update());
  assert.equal(work.opens, 1);
  assert.equal(work.locks, 0);
  assert.equal(work.validations, 0);
  assert.equal(work.bytes, 0);
  assert.ok(work.prepares < STREAMS, `capture.db statements are prepared per pass, not per stream (${work.prepares})`);
  assert.equal(index.counts().turns, 3 * STREAMS);
  assert.equal(index.search("base7").length, 3);
  agreesWithRebuild(index);
});

test("one appended turn locks and validates only its stream and reads only the new bytes", (t) => {
  const root = fixture(t), { store, index } = open(t, root);
  const grown = grow(store, [stream(4)], () => [turn("appended", 0)]);
  const work = measure(store, () => index.update());
  assert.equal(work.opens, 1);
  assert.ok(work.locks <= 2 && work.validations <= 2, `candidate work only: ${JSON.stringify(work)}`);
  // The new bytes, plus the reset check's one byte at the old cursor.
  assert.ok(work.bytes <= grown + 1, `no historical journal reads: ${work.bytes} of ${grown} new`);
  assert.equal(index.counts().turns, 3 * STREAMS + 1);
  assert.equal(index.search("appended").length, 1);
  agreesWithRebuild(index);
});

test("turns appended by earlier passes without the index are indexed as backlog", (t) => {
  const root = fixture(t), { store, index } = open(t, root);
  const grown = grow(store, [1, 5, 9].map(stream), (s) => [turn("backlog", s)]);
  const work = measure(store, () => index.update());
  assert.equal(work.opens, 1);
  assert.ok(work.locks <= 6 && work.validations <= 6, `candidate work only: ${JSON.stringify(work)}`);
  assert.ok(work.bytes <= grown + 3, `no historical journal reads: ${work.bytes} of ${grown} new`);
  assert.equal(index.search("backlog").length, 3);
  agreesWithRebuild(index);
});

test("a deleted indexed stream resets the union and every live stream is indexed again", (t) => {
  const root = fixture(t), { store, index } = open(t, root);
  fs.rmSync(join(root, "streams", stream(3)), { recursive: true });
  index.update();
  assert.equal(index.counts().turns, 3 * (STREAMS - 1));
  assert.equal(index.search("base3").length, 0);
  assert.equal(index.search("base8").length, 3);
  agreesWithRebuild(index);
});

test("a missing validation checkpoint is not trusted because index rows exist", (t) => {
  const root = fixture(t);
  const state = new DerivedState(root);
  try { state.delete("journal", stream(6)); } finally { state.close(); }
  const { store, index } = open(t, root);
  const work = measure(store, () => index.update());
  assert.ok(work.validations > STREAMS, `revalidation starts a new epoch, so the union rebuilds: ${JSON.stringify(work)}`);
  assert.equal(index.counts().turns, 3 * STREAMS);
  const after = new DerivedState(root);
  try {
    for (const row of index.db.prepare("SELECT stream, epoch FROM index_bytes").all())
      assert.equal(row.epoch, after.get("journal", row.stream).epoch);
  } finally { after.close(); }
  agreesWithRebuild(index);
});

test("a journal replaced between the reset check and catch-up refuses instead of publishing a partial union", (t) => {
  const root = fixture(t), { store, index } = open(t, root);
  store.append(stream(2), turn("growth", 0));
  const lock = store.withStreamLock;
  let calls = 0;
  store.withStreamLock = function (id, ...args) {
    // The second lock of the candidate is catch-up: replace its history first.
    if (id === stream(2) && ++calls === 2) fs.writeFileSync(store.journalPath(id), JSON.stringify(turn("replaced", 0)) + "\n");
    return lock.call(this, id, ...args);
  };
  assert.throws(() => index.update(), /journal changed during index update/);
  delete store.withStreamLock;
  index.update();
  assert.equal(index.search("replaced").length, 1);
  assert.equal(index.search("base2").length, 0);
  agreesWithRebuild(index);
});

test("a cursor reset by another index connection during the pass is caught up, not skipped", (t) => {
  const root = fixture(t), { store, index } = open(t, root);
  const iterate = store.iterateStreams;
  store.iterateStreams = function* () {
    const peer = new RecordIndex(new RecordStore(root, { owner: OWNER }));
    try { peer.reset(); } finally { peer.close(); }
    yield* iterate.call(this);
  };
  index.update();
  delete store.iterateStreams;
  assert.equal(index.counts().turns, 3 * STREAMS);
  agreesWithRebuild(index);
});

test("a capture.db replaced during the pass refuses, on the skip path and around candidate work", (t) => {
  const root = fixture(t), path = join(root, "index", "capture.db");
  const replace = () => { fs.copyFileSync(path, `${path}.copy`); fs.renameSync(`${path}.copy`, path); };
  const skip = open(t, root), iterate = skip.store.iterateStreams;
  skip.store.iterateStreams = function* () { replace(); yield* iterate.call(this); };
  assert.throws(() => skip.index.update(), /capture\.db changed during the pass/);

  const candidate = open(t, root), lock = candidate.store.withStreamLock;
  candidate.store.append(stream(0), turn("candidate", 0));
  candidate.store.withStreamLock = function (...args) { replace(); return lock.apply(this, args); };
  assert.throws(() => candidate.index.update(), /capture\.db changed during the pass/);
  // Refused under the candidate's lock, before catch-up committed its turn.
  assert.equal(candidate.index.search("candidate").length, 0);
});

test("tombstones and cross-stream duplicates appended after a warm pass agree with a rebuild", (t) => {
  const root = fixture(t), { store, index } = open(t, root);
  const target = store.readStream(stream(1))[0];
  store.appendBatch(stream(11), [{ ...target }]);
  store.appendBatch(stream(0), [finishTurn({ v: 1, ts: "2026-01-02T00:00:00Z", from: OWNER, kind: "tombstone",
    links: [{ rel: "tombstones", ref: target.id }], body: {}, provenance: { source: "test", fidelity: "projected" } })]);
  index.update();
  assert.equal(index.db.prepare("SELECT stream FROM turns WHERE id = ?").get(target.id).stream, stream(1));
  assert.equal(index.db.prepare("SELECT hidden FROM turns WHERE id = ?").get(target.id).hidden, 1);
  agreesWithRebuild(index);
});

test("inside a capture work group a warm stream outside the group still refuses", (t) => {
  const root = fixture(t), { store, index } = open(t, root);
  const evidence = () => ({ counts: index.counts(), cursors: index.db.prepare(`SELECT s.stream, s.indexed_count, b.bytes,
    b.indexed_count AS byte_count, b.epoch FROM index_state s LEFT JOIN index_bytes b ON s.stream = b.stream ORDER BY s.stream`).all() });
  const before = evidence();
  const checkpoint = withCaptureGroup(store, [stream(0)], () => {
    assert.throws(() => index.update(), /stream outside capture work group/);
    // Read through the borrowed connection before the group ends: update never closes it.
    return captureContext(store).state.get("journal", stream(0));
  });
  assert.equal(checkpoint.complete, true);
  assert.deepEqual(evidence(), before);
});
