import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { hostname, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { createCaptureScratch, cleanupCaptureScratch } from "../lib/capture-scratch.mjs";
import { acquireCaptureLock } from "../lib/capture-lock.mjs";
import { stageSnapshot } from "../lib/session-snapshot.mjs";
import { withReceiptSummaries } from "../lib/receipt-summary.mjs";
import { RecordStore } from "../lib/store.mjs";
import { captureSessions } from "../lib/capture-cc.mjs";

function fixture(t) {
  const base = fs.mkdtempSync(join(tmpdir(), "record-scratch-")), root = join(base, "record");
  t.after(() => fs.rmSync(base, { recursive: true, force: true })); return { base, root };
}
function scratch(root, kind = "snapshot") { return createCaptureScratch(root, kind); }
function rewriteOwner(path, change) {
  const marker = join(path, "owner.json"), value = JSON.parse(fs.readFileSync(marker, "utf8"));
  fs.writeFileSync(marker, JSON.stringify({ ...value, ...change }));
}
function withLock(root, fn) { const lock = acquireCaptureLock(root); assert.equal(lock.held, undefined); try { return fn(lock); } finally { assert.equal(lock.release().released, true); } }

test("snapshots and receipt claims stay private on the record volume with unavailable system TMPDIR", t => {
  const { base, root } = fixture(t), source = join(base, "source"); fs.writeFileSync(source, "record\n");
  const old = process.env.TMPDIR; process.env.TMPDIR = join(base, "does-not-exist");
  const fd = fs.openSync(source, "r");
  try {
    const stage = stageSnapshot(fd, fs.fstatSync(fd), source, undefined, root);
    const dir = join(root, ".capture-tmp", fs.readdirSync(join(root, ".capture-tmp"))[0]);
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700); assert.equal(fs.statSync(join(dir, "snapshot")).mode & 0o777, 0o600);
    assert.equal(fs.statSync(dir).dev, fs.statSync(root).dev); assert.equal(Buffer.concat([...stage.chunks()]).toString(), "record\n");
    // A lock-owning pass must preserve this caller, which owns no root lock.
    withLock(root, lock => assert.equal(cleanupCaptureScratch(root, lock), 0));
    assert.equal(Buffer.concat([...stage.chunks()]).toString(), "record\n"); stage.close();
    const store = new RecordStore(root, { owner: "fixture" });
    withReceiptSummaries(store, summary => {
      const entries = fs.readdirSync(join(root, ".capture-tmp")); assert.equal(entries.length, 1); assert.match(entries[0], /^receipt-/);
      const claims = join(root, ".capture-tmp", entries[0], "claims.db"); assert.ok(fs.existsSync(claims)); assert.equal(fs.statSync(claims).mode & 0o777, 0o600); assert.equal(fs.statSync(claims).dev, fs.statSync(root).dev);
      withLock(root, lock => assert.equal(cleanupCaptureScratch(root, lock), 0));
      assert.equal(summary("fixture~cc.none").count, 0);
    });
    assert.deepEqual(fs.readdirSync(join(root, ".capture-tmp")), []);
    const transcript = join(base, "session.jsonl");
    fs.writeFileSync(transcript, JSON.stringify({ timestamp: "2026-01-01T00:00:00Z", text: "recover staged content" }) + "\n");
    assert.equal(captureSessions(store, { owner: "fixture", files: [transcript] }).appended, 1);
    fs.unlinkSync(join(root, "index", "capture.db"));
    assert.equal(captureSessions(store, { owner: "fixture", files: [transcript] }).appended, 0, "cache-loss recovery stages inside the root despite missing TMPDIR");
    assert.throws(() => withReceiptSummaries(store, () => { throw new Error("receipt callback failure"); }), /receipt callback failure/);
    assert.deepEqual(fs.readdirSync(join(root, ".capture-tmp")), []);
    assert.throws(() => stageSnapshot(fd, { size: 99 }, source, undefined, root), /short read/);
    assert.deepEqual(fs.readdirSync(join(root, ".capture-tmp")), []);
  } finally { fs.closeSync(fd); if (old === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = old; }
});

test("lock-held cleanup removes killed-process scratch for both purposes", t => {
  const { base, root } = fixture(t), lib = resolve(import.meta.dirname, "../lib");
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import fs from 'node:fs';import {join} from 'node:path';
    import {stageSnapshot} from ${JSON.stringify(join(lib, "session-snapshot.mjs"))};
    import {withReceiptSummaries} from ${JSON.stringify(join(lib, "receipt-summary.mjs"))};
    import {RecordStore} from ${JSON.stringify(join(lib, "store.mjs"))};
    const source=join(${JSON.stringify(base)},'source');fs.writeFileSync(source,'snapshot bytes');const fd=fs.openSync(source,'r');
    const staged=stageSnapshot(fd,fs.fstatSync(fd),source,undefined,${JSON.stringify(root)});
    withReceiptSummaries(new RecordStore(${JSON.stringify(root)},{owner:'fixture'}),()=>process.kill(process.pid,'SIGKILL'));
  `], { env: { HOME: base, TMPDIR: base, PATH: process.env.PATH }, encoding: "utf8" });
  assert.equal(child.signal, "SIGKILL"); assert.equal(fs.readdirSync(join(root, ".capture-tmp")).length, 2);
  // The actual command, under its capture lock, performs reclamation.
  const cli = resolve(import.meta.dirname, "../bin/capture.mjs");
  const run = spawnSync(process.execPath, [cli, "--root", root, "--owner", "fixture", "--reset-cursors", "--source", "aw"], { env: { HOME: base, TMPDIR: join(base, "absent"), PATH: process.env.PATH }, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr); assert.deepEqual(fs.readdirSync(join(root, ".capture-tmp")), []);
});

test("scratch scavenging preserves live, reused, unknown, foreign, incomplete and special-file ownership", t => {
  const { base, root } = fixture(t), allocations = [];
  const make = () => { const value = scratch(root); allocations.push(value.path); return value.path; };
  const live = make(); rewriteOwner(live, { pid: process.pid });
  const reused = make(); rewriteOwner(reused, { pid: 12341 });
  const denied = make(); rewriteOwner(denied, { pid: 12342 });
  const foreign = make(); rewriteOwner(foreign, { host: hostname() + "-other", pid: 12343 });
  const missing = make(); fs.unlinkSync(join(missing, "owner.json"));
  const partial = make(); fs.writeFileSync(join(partial, "owner.json"), "{");
  const invalid = make(); rewriteOwner(invalid, { pid: -1 });
  const unknown = join(root, ".capture-tmp", "unknown-directory"); fs.mkdirSync(unknown); allocations.push(unknown);
  const link = make(); fs.unlinkSync(join(link, "owner.json")); fs.symlinkSync(join(live, "owner.json"), join(link, "owner.json"));
  const fifo = make(); fs.unlinkSync(join(fifo, "owner.json"));
  const mkfifo = spawnSync('/usr/bin/mkfifo', [join(fifo, "owner.json")], { env: { HOME: base, PATH: process.env.PATH }, encoding: "utf8" }); assert.equal(mkfifo.status, 0, mkfifo.stderr);
  const linkedDir = join(root, ".capture-tmp", "snapshot-ABC123"); fs.symlinkSync(live, linkedDir); allocations.push(linkedDir);
  withLock(root, lock => {
    const open = fs.openSync;
    fs.openSync = (path, ...a) => { assert.notEqual(path, join(link, "owner.json")); assert.notEqual(path, join(fifo, "owner.json")); return open(path, ...a); }; syncBuiltinESMExports();
    try { assert.equal(cleanupCaptureScratch(root, lock, { liveness(pid) {
      if (pid === 12342) { const e = new Error("permission denied"); e.code = "EPERM"; throw e; }
      if (pid === 12343) throw new Error("foreign owner must not be probed");
      return "alive";
    } }), 0); } finally { fs.openSync = open; syncBuiltinESMExports(); }
  });
  for (const path of allocations) assert.ok(fs.lstatSync(path));
});

test("owner/directory replacement during liveness checks is preserved; cleanup requires the capture lock", t => {
  const { root } = fixture(t), first = scratch(root), second = scratch(root, "receipt");
  rewriteOwner(first.path, { pid: 12340 }); rewriteOwner(second.path, { pid: 12341 });
  assert.throws(() => cleanupCaptureScratch(root, {}));
  withLock(root, lock => assert.equal(cleanupCaptureScratch(root, lock, { liveness(pid) {
    if (pid === 12340) rewriteOwner(first.path, { nonce: "f".repeat(32) });
    if (pid === 12341) { fs.renameSync(second.path, second.path + "-saved"); fs.mkdirSync(second.path); }
    return "dead";
  } }), 0));
  assert.ok(fs.existsSync(first.path)); assert.ok(fs.existsSync(second.path)); assert.ok(fs.existsSync(second.path + "-saved"));
  first.close(); second.close(); // neither handle may delete a replaced owner/directory
  assert.ok(fs.existsSync(first.path)); assert.ok(fs.existsSync(second.path));
});

test("a symlinked or public scratch base is refused without touching its target", t => {
  const { base, root } = fixture(t), outside = join(base, "outside"); fs.mkdirSync(outside); fs.mkdirSync(root);
  fs.symlinkSync(outside, join(root, ".capture-tmp")); assert.throws(() => scratch(root), /real directory/); assert.deepEqual(fs.readdirSync(outside), []);
  fs.unlinkSync(join(root, ".capture-tmp")); fs.mkdirSync(join(root, ".capture-tmp"), { mode: 0o755 });
  assert.throws(() => scratch(root), /private/);
});
