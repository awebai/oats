import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { RecordStore } from "../lib/store.mjs";
import { captureAwLogs, captureCommLog, listCommLogs } from "../lib/capture-aw.mjs";

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


test("collected and background AW capture preserve code-unit account and journal order", t => {
  const f = fixture(t), names = ["z", "a", "B", "é"];
  for (const name of names) fs.writeFileSync(join(f.logs, name + ".jsonl"), entry(name));
  const expected = [...names].sort();
  assert.deepEqual(listCommLogs(f.logs).map(path => path.slice(f.logs.length + 1, -6)), expected);
  const open = fs.opendirSync;
  fs.opendirSync = (...args) => {
    const dir = open(...args), entries = [];
    for (let value; (value = dir.readSync()) !== null;) entries.push(value);
    entries.sort((a, b) => a.name < b.name ? 1 : a.name > b.name ? -1 : 0);
    let i = 0; dir.readSync = () => entries[i++] ?? null; return dir;
  };
  syncBuiltinESMExports();
  try {
    for (const collect of [true, false]) {
      const store = new RecordStore(join(f.root, String(collect)), { owner: "fixture" });
      const results = [...captureAwLogs(store, { owner: "fixture", commLogDir: f.logs, collect })];
      assert.deepEqual(results.map(result => result.account), expected);
      assert.deepEqual(store.readStream("fixture~aw").map(turn => turn.provenance.origin["~"].account), expected);
    }
  } finally { fs.opendirSync = open; syncBuiltinESMExports(); }
});


test("refused AW entries advance durable cursors across fresh no-op, growth and reset retry", t => {
  const f = fixture(t), pkg = resolve(import.meta.dirname, "..");
  const lines = Array.from({ length: 3000 }, (_, i) => i === 10 ? JSON.stringify({ note: "no timestamp", n: i }) + "\n" : entry(i));
  fs.writeFileSync(f.path, lines.join(""));
  const env = { HOME: f.root, TMPDIR: f.logs, PATH: process.env.PATH };
  const run = () => {
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
      const open=fs.openSync,close=fs.closeSync,read=fs.readSync;const tracked=new Set();let bytes=0;
      fs.openSync=(p,...a)=>{const fd=open(p,...a);if(p===${JSON.stringify(f.path)})tracked.add(fd);return fd};
      fs.closeSync=fd=>{tracked.delete(fd);return close(fd)};
      fs.readSync=(fd,...a)=>{const n=read(fd,...a);if(tracked.has(fd))bytes+=n;return n};syncBuiltinESMExports();
      const {RecordStore}=await import(${JSON.stringify(join(pkg, "lib/store.mjs"))});
      const {captureAwLogs}=await import(${JSON.stringify(join(pkg, "lib/capture-aw.mjs"))});
      const result=captureAwLogs(new RecordStore(${JSON.stringify(f.root)},{owner:'fixture'}),{owner:'fixture',commLogDir:${JSON.stringify(f.logs)}});
      console.log(JSON.stringify({bytes,result}));
    `], { env, encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr); return JSON.parse(child.stdout);
  };
  const first = run(); assert.equal(first.result[0].failed, 1); assert.equal(first.result[0].appended, 2999);
  for (let i = 0; i < 2; i++) { const noOp = run(); assert.equal(noOp.bytes, 0); assert.deepEqual(noOp.result, []); }
  fs.appendFileSync(f.path, entry(3000));
  const growth = run(); assert.equal(growth.result[0].failed, 0); assert.equal(growth.result[0].appended, 1);
  assert.ok(growth.bytes < 65536, `growth read ${growth.bytes} historical bytes`);
  const reset = spawnSync(process.execPath, [join(pkg, "bin/capture.mjs"), "--root", f.root, "--owner", "fixture", "--reset-cursors", "--source", "aw"], { env, encoding: "utf8" });
  assert.equal(reset.status, 0, reset.stderr);
  const replay = run(); assert.equal(replay.result[0].failed, 1); assert.equal(replay.result[0].appended, 0);
  assert.ok(replay.bytes >= fs.statSync(f.path).size, "reset really retries the refused entry");
  assert.equal(run().bytes, 0);
  const turns = f.store().readStream("fixture~aw"); assert.equal(turns.length, 3000);
  assert.equal(new Set(turns.map(turn => turn.id)).size, turns.length);
});

test("AW append failures and incomplete final lines do not advance past undurable data", t => {
  const f = fixture(t), refused = JSON.stringify({ note: "no timestamp" }) + "\n";
  fs.writeFileSync(f.path, refused + entry(1));
  const store = f.store(); store.appendUniqueBatch = () => { throw new Error("injected append failure"); };
  assert.throws(() => captureAwLogs(store, { owner: "fixture", commLogDir: f.logs }), /injected append failure/);
  const retry = captureAwLogs(f.store(), { owner: "fixture", commLogDir: f.logs });
  assert.equal(retry[0].failed, 1); assert.equal(retry[0].appended, 1);
  const next = entry(2), split = next.length - 8;
  fs.appendFileSync(f.path, next.slice(0, split));
  assert.equal(captureAwLogs(f.store(), { owner: "fixture", commLogDir: f.logs })[0].appended, 0);
  fs.appendFileSync(f.path, next.slice(split));
  assert.equal(captureAwLogs(f.store(), { owner: "fixture", commLogDir: f.logs })[0].appended, 1);
  assert.equal(f.store().readStream("fixture~aw").length, 2);
  fs.appendFileSync(f.path, ("malformed " + "x".repeat(200) + "\n").repeat(1000));
  assert.equal(captureAwLogs(f.store(), { owner: "fixture", commLogDir: f.logs })[0].skipped, 1000);
  fs.appendFileSync(f.path, entry(3));
  const bytes = contentReads(() => assert.equal(captureAwLogs(f.store(), { owner: "fixture", commLogDir: f.logs })[0].appended, 1));
  assert.ok(bytes < 65536, `growth replayed ${bytes} bytes of consumed malformed lines`);
});
