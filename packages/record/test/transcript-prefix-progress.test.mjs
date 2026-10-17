import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { RecordStore } from "../lib/store.mjs";
import { DerivedState, fileVersion } from "../lib/derived-state.mjs";
import { withCaptureGroup } from "../lib/capture-context.mjs";
import { captureSessions } from "../lib/capture-cc.mjs";
import { advanceTranscriptPrefix, discardTranscriptPrefix } from "../lib/transcript-prefix.mjs";
import { bufferLines, fileChunks } from "../lib/file-lines.mjs";
import { eventTurnCore } from "../lib/capture-cc.mjs";
import { finishTurn } from "../lib/canonical.mjs";

const stream = "fixture~cc.session", key = "fixture-prefix";
const native = n => JSON.stringify({ timestamp: "2026-01-01T00:00:00Z", text: `${n}:${"x".repeat(80)}` });
function fixture(t, count = 41) {
  const root = fs.mkdtempSync(join(tmpdir(), "prefix-progress-")), path = join(root, "session.jsonl");
  fs.writeFileSync(path, Array.from({ length: count }, (_, n) => native(n)).join("\n") + "\n");
  const store = new RecordStore(join(root, "record"), { owner: "fixture" });
  assert.equal(captureSessions(store, { owner: "fixture", files: [path] }).appended, count);
  const f = { root, path, store, count, state: new DerivedState(store.root) };
  t.after(() => { f.state.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return f;
}
function input(f) {
  const fd = fs.openSync(f.path, "r"), version = fileVersion(f.path);
  return { snapshot: { id: JSON.stringify(version), size: version.size }, close: () => fs.closeSync(fd),
    *lines(start) {
      for (const line of bufferLines(fileChunks(fd, { start, end: version.size, size: 65536 }))) {
        if (line.at(-1) !== 10) return;
        yield { text: line.subarray(0, -1).toString("utf8"), bytes: line.length };
      }
    } };
}
function step(f, options = {}, fn = () => {}) {
  const source = input(f);
  try {
    return withCaptureGroup(f.store, [stream], () => {
      const result = advanceTranscriptPrefix(f.store, stream, { key, ...source, maxRecords: 3, maxBytes: 4096, ...options });
      fn(result); return result;
    }, { state: f.state });
  } finally { source.close(); }
}
function reopen(f) { f.state.close(); f.state = new DerivedState(f.store.root); }
function finish(f, options = {}, fn) {
  for (let n = 0; n < 100; n++) {
    const result = step(f, options, fn);
    if (result.complete || result.conflict) return result;
    reopen(f);
  }
  assert.fail("finite proof must finish over short passes");
}

test("short passes and reopened state finish full journal/source proof without historical rescans or early append", t => {
  const f = fixture(t), work = {}; let calls = 0;
  const result = finish(f, { work }, proof => {
    calls++;
    assert.equal(f.store.readStream(stream).length, f.count, "no append during incomplete proof");
    if (proof.complete) {
      f.store.append(stream, finishTurn(eventTurnCore({ owner: "fixture", source: "cc", sessionId: "session",
        line: native(41), lineNo: 42, ts: proof.lastTs })));
    }
  });
  assert.equal(result.complete, true); assert.ok(calls > 20);
  assert.equal(result.line, 41); assert.equal(result.bytes, fs.statSync(f.path).size);
  assert.equal(work.journalRecords, 41); assert.equal(work.sourceRecords, 41);
  const turns = f.store.readStream(stream); assert.equal(turns.length, 42);
  assert.equal(new Set(turns.map(t => t.id)).size, 42);
  assert.deepEqual(turns.slice(0, 41).map(t => t.body.line), Array.from({ length: 41 }, (_, n) => native(n)));
});

test("late prefix conflict across many commits refuses every append and preserves exact conflict position", t => {
  const f = fixture(t), lines = fs.readFileSync(f.path, "utf8").trimEnd().split("\n");
  lines[39] = native("changed"); fs.writeFileSync(f.path, lines.join("\n") + "\n" + native("new") + "\n");
  const result = finish(f, {}, proof => assert.equal(proof.complete, false));
  assert.deepEqual(result.conflict, { line: 40, offset: Buffer.byteLength(lines.slice(0, 39).join("\n") + "\n"), reason: "captured-prefix-changed" });
  assert.equal(f.store.readStream(stream).length, 41);
});

test("deadline stop persists completed comparison records and failure rolls back only its current unit", t => {
  const f = fixture(t, 9);
  let checks = 0;
  const first = step(f, { maxRecords: 2000, stopped: () => ++checks > 7 });
  assert.equal(first.complete, false); assert.ok(first.journalBytes > 0);
  const saved = f.state.get("prefix-proof", key);
  assert.throws(() => step(f, {}, () => { throw Error("crash before commit"); }), /crash before commit/);
  assert.deepEqual(f.state.get("prefix-proof", key), saved);
  reopen(f); assert.equal(finish(f).complete, true);
});

test("changed staged snapshot or exact journal generation revokes earlier proof and resets boundedly", t => {
  const f = fixture(t, 9); let partial;
  do { partial = step(f); } while (partial.phase !== "source");
  fs.writeFileSync(f.path, native("changed-first") + "\n" + Array.from({ length: 8 }, (_, n) => native(n + 1)).join("\n") + "\n");
  const changed = step(f);
  assert.equal(changed.phase, "clear"); assert.equal(changed.bytes, 0); assert.equal(changed.line, 0);
  assert.equal(finish(f).conflict.line, 1);
  // Restore under a new file identity: equality is content-based, not inode-based.
  fs.unlinkSync(f.path); fs.writeFileSync(f.path, Array.from({ length: 9 }, (_, n) => native(n)).join("\n") + "\n");
  assert.equal(finish(f).complete, true);
  f.store.append(stream, finishTurn(eventTurnCore({ owner: "fixture", source: "cc", sessionId: "session",
    line: native(9), lineNo: 10, ts: "2026-01-01T00:00:00Z" })));
  assert.equal(step(f).complete, false);
  assert.deepEqual(finish(f).conflict, { line: 10, offset: fs.statSync(f.path).size, reason: "captured-prefix-missing" });
});

test("lost hash table/epoch rebuild truthfully and cleanup is bounded without leaving a qualifying proof", t => {
  const f = fixture(t, 9); assert.equal(finish(f).complete, true);
  f.state.db.exec("DROP TABLE transcript_prefix"); reopen(f);
  assert.equal(step(f).complete, false); assert.equal(finish(f).complete, true);
  f.state.delete("prefix-meta", "epoch");
  assert.equal(step(f).complete, false); assert.equal(finish(f).complete, true);
  let done = false, passes = 0;
  while (!done) {
    done = withCaptureGroup(f.store, [stream], () => discardTranscriptPrefix(f.store, stream, key, { maxRecords: 2 }), { state: f.state });
    assert.equal(f.state.get("prefix-proof", key), null); passes++;
  }
  assert.equal(passes, 5);
  assert.equal(f.state.db.prepare("SELECT count(*) AS n FROM transcript_prefix").get().n, 0);
});

test("unheld or nontransactional proof work refuses before reading the source", t => {
  const f = fixture(t, 1);
  const args = { key, snapshot: { id: "test", size: 1 }, lines: () => assert.fail("must not read") };
  assert.throws(() => advanceTranscriptPrefix(f.store, stream, args), /stream work group/);
  withCaptureGroup(f.store, ["fixture~other"], () => {
    assert.throws(() => advanceTranscriptPrefix(f.store, stream, args), /stream work group/);
  }, { state: f.state });
});

test("new worker processes resume the committed proof rather than restarting its prefix", t => {
  const f = fixture(t, 7), lib = name => new URL(`../lib/${name}.mjs`, import.meta.url).href;
  const code = `
    import fs from 'node:fs';
    import {RecordStore} from ${JSON.stringify(lib("store"))};
    import {DerivedState,fileVersion} from ${JSON.stringify(lib("derived-state"))};
    import {withCaptureGroup} from ${JSON.stringify(lib("capture-context"))};
    import {advanceTranscriptPrefix} from ${JSON.stringify(lib("transcript-prefix"))};
    import {fileChunks,bufferLines} from ${JSON.stringify(lib("file-lines"))};
    const path=${JSON.stringify(f.path)}, version=fileVersion(path), fd=fs.openSync(path,'r');
    const store=new RecordStore(${JSON.stringify(f.store.root)},{owner:'fixture'}),state=new DerivedState(store.root),work={};
    try {
      const proof=withCaptureGroup(store,[${JSON.stringify(stream)}],()=>advanceTranscriptPrefix(store,${JSON.stringify(stream)},{
        key:${JSON.stringify(key)},snapshot:{id:JSON.stringify(version),size:version.size},maxRecords:2,work,
        *lines(start){for(const line of bufferLines(fileChunks(fd,{start,end:version.size,size:65536}))){
          if(line.at(-1)!==10)return;yield {text:line.subarray(0,-1).toString('utf8'),bytes:line.length};
        }}
      }),{state});
      process.stdout.write(JSON.stringify({proof,work}));
    } finally {fs.closeSync(fd);state.close();}
  `;
  let journal = 0, source = 0, done = false, runs = 0;
  for (; runs < 20 && !done; runs++) {
    const child = spawnSync(process.execPath, ["--max-old-space-size=256", "--input-type=module", "-e", code], {
      encoding: "utf8", env: { HOME: f.root, TMPDIR: f.root, PATH: process.env.PATH }, timeout: 5000,
    });
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout); done = result.proof.complete;
    journal += result.work.journalRecords ?? 0; source += result.work.sourceRecords ?? 0;
  }
  assert.equal(done, true); assert.ok(runs > 5);
  assert.equal(journal, 7); assert.equal(source, 7); assert.equal(f.store.readStream(stream).length, 7);
});
