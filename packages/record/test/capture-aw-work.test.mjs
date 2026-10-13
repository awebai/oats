import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { RecordStore } from "../lib/store.mjs";
import { captureAwLogs, captureCommLog } from "../lib/capture-aw.mjs";

const entry = (n) => JSON.stringify({ ts: "2026-01-01T00:00:00Z", dir: "recv", ch: "mail", msg_id: String(n), from: "alice", to: "bob", body: `${n} ${"x".repeat(300)}` }) + "\n";
function fixture(t) {
  const base = fs.mkdtempSync(join(tmpdir(), "record-aw-work-")), logs = join(base, "logs"), root = join(base, "record");
  fs.mkdirSync(logs);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return { root, logs, path: join(logs, "account.jsonl"), store: () => new RecordStore(root, { owner: "fixture" }) };
}
function contentReads(fn) {
  const open = fs.openSync, close = fs.closeSync, read = fs.readSync, whole = fs.readFileSync;
  const tracked = new Set(); let bytes = 0;
  fs.openSync = (path, ...args) => { const fd = open(path, ...args); if (String(path).endsWith(".jsonl")) tracked.add(fd); return fd; };
  fs.closeSync = (fd) => { tracked.delete(fd); return close(fd); };
  fs.readSync = (fd, ...args) => { const n = read(fd, ...args); if (tracked.has(fd)) bytes += n; return n; };
  fs.readFileSync = (path, ...args) => { assert.ok(!String(path).endsWith("journal.jsonl"), "no whole-journal ID allocation"); return whole(path, ...args); };
  syncBuiltinESMExports();
  try { fn(); return bytes; }
  finally { fs.openSync = open; fs.closeSync = close; fs.readSync = read; fs.readFileSync = whole; syncBuiltinESMExports(); }
}

test("background aweb growth and appendCore dedupe do not reread historical content", (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.path, Array.from({ length: 3000 }, (_, i) => entry(i)).join(""));
  captureAwLogs(f.store(), { owner: "fixture", commLogDir: f.logs });
  assert.equal(contentReads(() => captureAwLogs(f.store(), { owner: "fixture", commLogDir: f.logs })), 0);
  fs.appendFileSync(f.path, entry(3000));
  const bytes = contentReads(() => {
    const out = captureAwLogs(f.store(), { owner: "fixture", commLogDir: f.logs });
    assert.equal(out[0].appended, 1);
  });
  assert.ok(bytes < 65536, `one-record growth read ${bytes} bytes`);
  const store = f.store();
  const core = { v: 1, from: "fixture", ts: "2026-01-01T00:00:00Z", kind: "note", body: { text: "deduped" } };
  assert.ok(contentReads(() => assert.equal(store.appendCore("fixture~aw", core).appended, true)) < 65536);
  assert.ok(contentReads(() => assert.equal(f.store().appendCore("fixture~aw", core).appended, false)) < 65536);
});

test("explicit log capture reprojects edits and never asks for a whole-log candidate set", (t) => {
  const f = fixture(t); fs.writeFileSync(f.path, entry(0) + entry(1));
  const store = f.store();
  store.idsAmong = () => { throw new Error("whole changed-log candidate IDs were collected"); };
  assert.equal(captureCommLog(store, { owner: "fixture", path: f.path }).appended, 2);
  fs.writeFileSync(f.path, entry(9) + entry(1));
  assert.equal(captureCommLog(store, { owner: "fixture", path: f.path }).appended, 1);
  assert.equal(captureCommLog(store, { owner: "fixture", path: f.path }).appended, 0);
});

test("unknown journal changes validate corruption before append; cache removal rebuilds IDs", (t) => {
  const f = fixture(t); fs.writeFileSync(f.path, entry(0) + entry(1));
  captureAwLogs(f.store(), { owner: "fixture", commLogDir: f.logs });
  const path = f.store().journalPath("fixture~aw"), before = fs.readFileSync(path);
  fs.rmSync(join(f.root, "index", "capture.db"));
  assert.equal(captureCommLog(f.store(), { owner: "fixture", path: f.path }).appended, 0);
  assert.deepEqual(fs.readFileSync(path), before);
  fs.writeFileSync(path, "corrupt\n" + before.toString());
  assert.throws(() => captureCommLog(f.store(), { owner: "fixture", path: f.path }), /corrupt interior/);
  assert.deepEqual(fs.readFileSync(path), Buffer.concat([Buffer.from("corrupt\n"), before]));
});
