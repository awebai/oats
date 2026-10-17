import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { RecordStore } from "../lib/store.mjs";
import { captureSessions } from "../lib/capture-cc.mjs";
import { captureAwLogs } from "../lib/capture-aw.mjs";
import { writeCurrentHook } from "./fixtures/capture-hook-settings.mjs";
import { DerivedState } from "../lib/derived-state.mjs";
import { captureHealth, resetSourceCursors } from "../lib/capture-state.mjs";

const line = n => JSON.stringify({ timestamp: "2026-01-01T00:00:00Z", message: n }) + "\n";
const entry = n => JSON.stringify({ts:"2026-01-01T00:00:00Z",dir:"recv",ch:"mail",msg_id:String(n),from:"a",to:"b",body:String(n)}) + "\n";
function fixture(t) {
  const base = fs.mkdtempSync(join(tmpdir(), "capture-fault-")), root = join(base, "record"), path = join(base, "s.jsonl");
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const store = new RecordStore(root, { owner: "fixture" });
  const capture = () => captureSessions(store, { owner: "fixture", files: [path] });
  return { base, root, path, store, capture };
}

for (const when of ["before", "after"]) test(`legacy invalidation interruption ${when} unlink refuses before journal mutation`, t => {
  const f = fixture(t); fs.writeFileSync(f.path, line(1)); f.capture();
  const map = join(f.root, "index/capture-offsets.json"), journal = f.store.journalPath("fixture~cc.s");
  fs.writeFileSync(map, "{\"stale\":true}"); fs.appendFileSync(f.path, line(2));
  const before = fs.readFileSync(journal), unlink = fs.unlinkSync;
  fs.unlinkSync = path => { if (path === map) { if (when === "after") unlink(path); throw new Error("fixture invalidation interrupted"); } return unlink(path); }; syncBuiltinESMExports();
  try { assert.throws(f.capture, /invalidation interrupted/); }
  finally { fs.unlinkSync = unlink; syncBuiltinESMExports(); }
  assert.deepEqual(fs.readFileSync(journal), before);
  assert.equal(f.capture().appended, 1); assert.equal(fs.existsSync(map), false);
  assert.equal(f.store.readStream("fixture~cc.s").length, 2);
});

test("journal fsync before derived commit recovers IDs and source cursor without duplicate turns", t => {
  const f = fixture(t); fs.writeFileSync(f.path, line(1)); f.capture(); fs.appendFileSync(f.path, line(2));
  const set = DerivedState.prototype.set;
  DerivedState.prototype.set = function(kind, key, value) {
    if (kind === "journal" && value.count === 2) throw new Error("fixture after journal fsync");
    return set.call(this, kind, key, value);
  };
  try { assert.throws(f.capture, /after journal fsync/); }
  finally { DerivedState.prototype.set = set; }
  assert.equal(f.store.readStream("fixture~cc.s").length, 2);
  assert.equal(f.capture().appended, 0);
  fs.appendFileSync(f.path, line(3)); assert.equal(f.capture().appended, 1);
  const turns = f.store.readStream("fixture~cc.s"); assert.equal(new Set(turns.map(t => t.id)).size, 3);
});

test("lost ID lookup and invalid source cursors recover from journal truth", t => {
  const f = fixture(t); fs.writeFileSync(f.path, line(1)); f.capture();
  let state = new DerivedState(f.root); state.db.exec("DROP TABLE journal_ids"); state.close();
  const turn = f.store.readStream("fixture~cc.s")[0];
  assert.equal(f.store.appendUniqueBatch("fixture~cc.s", [turn]), 0);
  for (const bytes of [-1, 1e20, "wrong"]) {
    state = new DerivedState(f.root); const key = `fixture~cc.s:${f.path}`;
    state.set("cc", key, { ...state.get("cc", key), bytes }); state.close();
    assert.equal(f.capture().appended, 0);
  }
  fs.appendFileSync(f.path, line(2)); assert.equal(f.capture().appended, 1);
});

test("reset transaction failure cannot persist only some selected sources", t => {
  const f = fixture(t), set = DerivedState.prototype.set;
  DerivedState.prototype.set = function(kind, key, value) { if (kind === "reset" && key === "fixture:pi") throw new Error("fixture reset failure"); return set.call(this, kind, key, value); };
  try { assert.throws(() => resetSourceCursors(f.root, "fixture"), /reset failure/); }
  finally { DerivedState.prototype.set = set; }
  const state = new DerivedState(f.root); try { assert.equal([...state.entries("reset")].length, 0); } finally { state.close(); }
});

test("aweb observed replacements/shrinks/same-size edits and torn journals reprocess with persistent dedupe", t => {
  const f = fixture(t), logs = join(f.base, "logs"), path = join(logs, "account.jsonl"); fs.mkdirSync(logs);
  const capture = () => captureAwLogs(f.store, { owner: "fixture", commLogDir: logs });
  fs.writeFileSync(path, entry(1) + entry(2)); assert.equal(capture()[0].appended, 2);
  fs.writeFileSync(path, entry(3) + entry(2)); assert.equal(capture()[0].appended, 1);
  fs.writeFileSync(path, entry(4)); assert.equal(capture()[0].appended, 1);
  fs.renameSync(path, path + ".old"); fs.writeFileSync(path, entry(5)); assert.equal(capture()[0].appended, 1);
  fs.appendFileSync(f.store.journalPath("fixture~aw"), '{"torn":');
  fs.appendFileSync(path, entry(6)); assert.equal(capture()[0].appended, 1);
  const turns = f.store.readStream("fixture~aw"); assert.equal(turns.length, 6); assert.equal(new Set(turns.map(t => t.id)).size, 6);
});

test("health rejects malformed/oversized/special status files without blocking", t => {
  const f = fixture(t); fs.mkdirSync(f.root); const path = join(f.root, "capture-status.json");
  writeCurrentHook(f.base); // the status files are diagnosed on an installed host
  for (const data of ["bad", " ".repeat(1024 * 1024 + 1)]) {
    fs.writeFileSync(path, data); assert.equal(captureHealth(f.root, { home: f.base }).rows[0].code, "capture-status-invalid");
  }
  fs.rmSync(path); fs.mkdirSync(path); assert.equal(captureHealth(f.root, { home: f.base }).status, "warning"); fs.rmdirSync(path);
  if (process.platform !== "win32") {
    const made = spawnSync("mkfifo", [path], { env: { PATH: process.env.PATH, HOME: f.base } });
    assert.equal(made.status, 0);
    assert.equal(captureHealth(f.root, { home: f.base }).status, "warning");
  }
});

test("bounded metadata/index/receipt readers do not require Statement.iterate", async t => {
  const { DatabaseSync } = await import("node:sqlite");
  const { RecordIndex } = await import("../lib/index-db.mjs");
  const { withReceiptSummaries } = await import("../lib/receipt-summary.mjs");
  const f = fixture(t), db = new DatabaseSync(":memory:");
  const proto = Object.getPrototypeOf(db.prepare("SELECT 1")), descriptor = Object.getOwnPropertyDescriptor(proto, "iterate");
  Object.defineProperty(proto, "iterate", { ...descriptor, value: undefined });
  try {
    fs.writeFileSync(f.path, line(1)); f.capture();
    const state = new DerivedState(f.root);
    try {
      for (let n = 0; n < 300; n++) state.set("fixture", String(n).padStart(3, "0"), { n });
      assert.equal([...state.entries("fixture")].length, 300);
    } finally { state.close(); }
    const index = new RecordIndex(f.store);
    try { index.update(); index.update(); assert.equal(index.counts().turns, 1); }
    finally { index.close(); }
    f.store.listStreams = () => { throw new Error("whole stream inventory"); };
    withReceiptSummaries(f.store, summary => assert.equal(summary("fixture~cc.s").count, 1));
  } finally { Object.defineProperty(proto, "iterate", descriptor); db.close(); }
});

test("invalid durable journal cursor cannot qualify old content or skip ID recovery", t => {
  const f = fixture(t); fs.writeFileSync(f.path, line(1)); f.capture();
  const state = new DerivedState(f.root);
  try { state.set("journal", "fixture~cc.s", { ...state.get("journal", "fixture~cc.s"), bytes: -1 }); }
  finally { state.close(); }
  const turn = f.store.readStream("fixture~cc.s")[0];
  assert.equal(f.store.appendUniqueBatch("fixture~cc.s", [turn]), 0);
  assert.equal(f.store.readStream("fixture~cc.s").length, 1);
});

test("Node 22.5 null-valued missing rows do not suppress appends, prefix recovery or visible receipts", async t => {
  const { DatabaseSync } = await import("node:sqlite");
  const { withReceiptSummaries } = await import("../lib/receipt-summary.mjs");
  const f = fixture(t), db = new DatabaseSync(":memory:");
  const proto = Object.getPrototypeOf(db.prepare("SELECT 1")), original = proto.get;
  proto.get = function(...args) {
    return original.apply(this, args) ?? Object.fromEntries(this.columns().map(column => [column.name, null]));
  };
  try {
    fs.writeFileSync(f.path, line(1)); assert.equal(f.capture().appended, 1);
    assert.equal(f.capture().appended, 0);
    resetSourceCursors(f.root, "fixture", "cc"); assert.equal(f.capture().appended, 0);
    fs.appendFileSync(f.path, line(2)); assert.equal(f.capture().appended, 1);
    let state = new DerivedState(f.root); state.db.exec("DROP TABLE journal_ids"); state.close();
    assert.equal(f.capture().appended, 0);
    const turn = f.store.readStream("fixture~cc.s")[0];
    assert.equal(new RecordStore(f.root, { owner: "fixture" }).appendUniqueBatch("fixture~cc.s", [turn]), 0);
    assert.equal(f.store.readStream("fixture~cc.s").length, 2);
    withReceiptSummaries(f.store, summary => assert.equal(summary("fixture~cc.s").count, 2));
  } finally { proto.get = original; db.close(); }
});
