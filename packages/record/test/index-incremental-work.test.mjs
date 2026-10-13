import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { RecordStore } from "../lib/store.mjs";
import { RecordIndex } from "../lib/index-db.mjs";
import { finishTurn } from "../lib/canonical.mjs";

const turn = (n) => finishTurn({ v: 1, ts: "2026-01-01T00:00:00Z", from: "fixture", kind: "mail", body: { text: `${n} ${"x".repeat(300)}` }, provenance: { source: "test", fidelity: "projected" } });
function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), "record-index-work-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function journalReads(fn) {
  const open = fs.openSync, close = fs.closeSync, read = fs.readSync;
  const journals = new Set();
  let bytes = 0;
  fs.openSync = (path, ...args) => { const fd = open(path, ...args); if (String(path).endsWith("journal.jsonl")) journals.add(fd); return fd; };
  fs.closeSync = (fd) => { journals.delete(fd); return close(fd); };
  fs.readSync = (fd, ...args) => { const n = read(fd, ...args); if (journals.has(fd)) bytes += n; return n; };
  syncBuiltinESMExports();
  try { fn(); return bytes; }
  finally { fs.openSync = open; fs.closeSync = close; fs.readSync = read; syncBuiltinESMExports(); }
}

test("fresh index/store instances seek past consumed journal content on no-op and one-record growth", (t) => {
  const root = fixture(t), stream = "fixture~aw";
  const first = new RecordStore(root, { owner: "fixture" });
  first.appendBatch(stream, Array.from({ length: 1000 }, (_, i) => turn(i)));
  const index = new RecordIndex(first); index.update(); index.close();
  const run = (grow) => journalReads(() => {
    const store = new RecordStore(root, { owner: "fixture" });
    if (grow) store.append(stream, turn(1000));
    const next = new RecordIndex(store);
    try {
      next.update();
      assert.equal(next.db.prepare("SELECT count(*) AS n FROM turns").get().n, grow ? 1001 : 1000);
    } finally { next.close(); }
  });
  assert.equal(run(false), 0, "an unchanged pass must not read old journal bytes");
  assert.ok(run(true) < 65536, "one new turn must not parse the historical prefix, including append validation");
});

test("index rows and byte/count cursors commit in bounded batches and resume after failure", (t) => {
  const root = fixture(t), store = new RecordStore(root, { owner: "fixture" });
  store.appendBatch("fixture~aw", Array.from({ length: 4500 }, (_, i) => turn(i)));
  const index = new RecordIndex(store), add = index.addTurn.bind(index);
  let calls = 0;
  index.addTurn = (...args) => { if (++calls === 2300) throw new Error("injected index failure"); return add(...args); };
  assert.throws(() => index.update(), /injected index failure/);
  assert.equal(index.db.prepare("SELECT count(*) AS n FROM turns").get().n, 2000);
  assert.equal(index.db.prepare("SELECT indexed_count FROM index_state").get().indexed_count, 2000);
  index.close();
  const resumed = new RecordIndex(new RecordStore(root, { owner: "fixture" }));
  try {
    resumed.update();
    assert.equal(resumed.db.prepare("SELECT count(*) AS n FROM turns").get().n, 4500);
    assert.equal(resumed.db.prepare("SELECT indexed_count FROM index_state").get().indexed_count, 4500);
  } finally { resumed.close(); }
});

test("replacement, shrink, invalid byte cursor and old count-only writes rebuild derived rows", (t) => {
  const root = fixture(t), stream = "fixture~aw", store = new RecordStore(root, { owner: "fixture" });
  store.appendBatch(stream, [turn(0), turn(1)]);
  const index = new RecordIndex(store);
  t.after(() => index.close());
  index.update();
  const path = store.journalPath(stream);
  fs.writeFileSync(path, JSON.stringify(turn(2)) + "\n");
  index.update();
  assert.deepEqual(index.db.prepare("SELECT id FROM turns").all().map(r => r.id), [turn(2).id]);
  index.db.prepare("UPDATE index_bytes SET bytes = bytes - 1").run();
  index.update();
  assert.equal(index.db.prepare("SELECT bytes FROM index_bytes").get().bytes, fs.statSync(path).size);
  // v0.53.0 changes only the named count column. The new cursor must not
  // survive its independent work as though both were committed together.
  fs.appendFileSync(path, JSON.stringify(turn(3)) + "\n");
  index.db.prepare("UPDATE index_state SET indexed_count = indexed_count + 1").run();
  index.update();
  assert.deepEqual(index.db.prepare("SELECT id FROM turns ORDER BY id").all().map(r => r.id), [turn(2).id, turn(3).id].sort());
});
