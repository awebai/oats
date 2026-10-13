// Many small inputs expose whole-map costs independently of a large transcript.
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { RecordStore } from "../lib/store.mjs";
import { captureSessions } from "../lib/capture-cc.mjs";

const line = n => JSON.stringify({ timestamp: "2026-01-01T00:00:00Z", text: String(n).padEnd(200, "x") }) + "\n";

test("many-input no-op capture does not read/rewrite global offset JSON or collect a directory inventory", t => {
  const base = fs.mkdtempSync(join(tmpdir(), "capture-metadata-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const sources = join(base, "projects"), root = join(base, "record"); fs.mkdirSync(sources);
  for (let i = 0; i < 200; i++) fs.writeFileSync(join(sources, `s${i}.jsonl`), line(i));
  const store = new RecordStore(root, { owner: "fixture" });
  assert.equal(captureSessions(store, { owner: "fixture", roots: [sources] }).appended, 200);
  const read = fs.readFileSync, write = fs.writeFileSync, list = fs.readdirSync;
  let mapBytes = 0, inventoryEntries = 0;
  fs.readFileSync = (path, ...args) => { const result = read(path, ...args); if (String(path).endsWith("capture-offsets.json")) mapBytes += Buffer.byteLength(result); return result; };
  fs.writeFileSync = (path, data, ...args) => { if (String(path).endsWith("capture-offsets.json")) mapBytes += Buffer.byteLength(data); return write(path, data, ...args); };
  fs.readdirSync = (path, ...args) => { const entries = list(path, ...args); if (path === sources) inventoryEntries += entries.length; return entries; };
  syncBuiltinESMExports();
  try {
    assert.equal(captureSessions(store, { owner: "fixture", roots: [sources], collectIssues: false }).appended, 0);
  } finally { fs.readFileSync = read; fs.writeFileSync = write; fs.readdirSync = list; syncBuiltinESMExports(); }
  assert.ok(mapBytes <= 4096, `no-op loaded/rewrote ${mapBytes} global-map bytes for 200 inputs`);
  assert.equal(inventoryEntries, 0, "background discovery materialized the whole directory");
});

test("fresh-process unchanged and one-record transcript growth read only bounded source/journal probes", t => {
  const base = fs.mkdtempSync(join(tmpdir(), "capture-process-work-")), root = join(base, "record"), source = join(base, "s.jsonl");
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const storeModule = resolve(import.meta.dirname, "../lib/store.mjs"), captureModule = resolve(import.meta.dirname, "../lib/capture-cc.mjs"), indexModule = resolve(import.meta.dirname, "../lib/index-db.mjs");
  const run = () => {
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
      const open=fs.openSync, close=fs.closeSync, read=fs.readSync, whole=fs.readFileSync;
      const fds=new Set(); let bytes=0;
      fs.openSync=(p,...a)=>{ const fd=open(p,...a); if(String(p).endsWith('.jsonl')) fds.add(fd); return fd; };
      fs.closeSync=fd=>{fds.delete(fd);return close(fd)};
      fs.readSync=(fd,...a)=>{const n=read(fd,...a);if(fds.has(fd))bytes+=n;return n};
      fs.readFileSync=(p,...a)=>{const b=whole(p,...a);if(String(p).endsWith('.jsonl'))bytes+=Buffer.byteLength(b);return b};
      syncBuiltinESMExports();
      const {RecordStore}=await import(${JSON.stringify(storeModule)}), {captureSessions}=await import(${JSON.stringify(captureModule)}), {RecordIndex}=await import(${JSON.stringify(indexModule)});
      const store=new RecordStore(${JSON.stringify(root)},{owner:'fixture'});
      const result=captureSessions(store,{owner:'fixture',files:[${JSON.stringify(source)}]});
      const index=new RecordIndex(store);try{index.update()}finally{index.close()}
      console.log(JSON.stringify({bytes,appended:result.appended}));
    `], { encoding: "utf8", env: { HOME: base, TMPDIR: base, PATH: process.env.PATH } });
    assert.equal(child.status, 0, child.stderr); return JSON.parse(child.stdout);
  };
  for (const size of [1000, 5000]) {
    fs.writeFileSync(source, Array.from({ length: size }, (_, i) => line(i)).join(""));
    run();
    const unchanged = run(); assert.equal(unchanged.appended, 0); assert.ok(unchanged.bytes <= 8192, `no-op read ${unchanged.bytes}`);
    fs.appendFileSync(source, line(size));
    const growth = run(); assert.equal(growth.appended, 1); assert.ok(growth.bytes < 65536, `single growth read ${growth.bytes}`);
  }
});
