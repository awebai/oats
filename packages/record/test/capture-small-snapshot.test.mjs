import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { smallCommandSnapshot, SMALL_SNAPSHOT_BYTES } from "../lib/capture-small-snapshot.mjs";

function fixture(t, size) {
  const base = fs.mkdtempSync(join(tmpdir(), "small-snapshot-")), root = join(base, "record"), path = join(base, "source");
  const chunk = Buffer.alloc(65536, 97); chunk[chunk.length - 1] = 10;
  const output = fs.openSync(path, "wx");
  try { for (let offset = 0; offset < size; offset += chunk.length) fs.writeSync(output, chunk, 0, Math.min(chunk.length, size - offset)); }
  finally { fs.closeSync(output); }
  const fd = fs.openSync(path, "r");
  t.after(() => { fs.closeSync(fd); fs.rmSync(base, { recursive: true, force: true }); });
  return { root, path, fd, empty() { assert.deepEqual(fs.readdirSync(join(root, ".capture-tmp")), []); } };
}

function instrument(t) {
  const read = fs.readSync, sync = fs.fsyncSync;
  const counts = { largestRead: 0, fsync: 0 };
  fs.readSync = (fd, buffer, offset, length, position) => {
    counts.largestRead = Math.max(counts.largestRead, length);
    assert.ok(length <= 65536, "snapshot may not request a whole-source read");
    return read(fd, buffer, offset, length, position);
  };
  fs.fsyncSync = (...args) => { counts.fsync++; return sync(...args); };
  syncBuiltinESMExports();
  t.after(() => { fs.readSync = read; fs.fsyncSync = sync; syncBuiltinESMExports(); });
  return counts;
}

test("total fixed end includes exactly 8MiB, streams copy/hash, and rejects one byte over before allocation", t => {
  const f = fixture(t, SMALL_SNAPSHOT_BYTES + 1), counts = instrument(t), work = {};
  assert.throws(() => smallCommandSnapshot(f.root, f.fd, f.path, SMALL_SNAPSHOT_BYTES + 1), /eligibility/);
  assert.equal(fs.existsSync(f.root), false);
  const staged = smallCommandSnapshot(f.root, f.fd, f.path, SMALL_SNAPSHOT_BYTES, { work });
  assert.equal(staged.complete, true);
  const hash = createHash("sha256"); let bytes = 0;
  for (const chunk of staged.snapshot.chunks()) { hash.update(chunk); bytes += chunk.length; }
  assert.equal(staged.snapshot.id, `sha256:${hash.digest("hex")}:${SMALL_SNAPSHOT_BYTES}`);
  assert.equal(bytes, SMALL_SNAPSHOT_BYTES);
  assert.equal(work.sourceBytes, SMALL_SNAPSHOT_BYTES); assert.equal(work.stagedWriteBytes, SMALL_SNAPSHOT_BYTES);
  assert.equal(counts.largestRead, 65536); assert.equal(counts.fsync, 0, "disposable payload and owner need no durable ownership handoff");
  staged.close(); staged.close(); f.empty();
});

test("interrupted copy publishes no snapshot; failure removes only owned scratch; a long line stages whole", t => {
  const f = fixture(t, 131072); let ticks = 0; const work = {};
  const partial = smallCommandSnapshot(f.root, f.fd, f.path, 131072, { stopped: () => ++ticks > 2, work });
  assert.equal(partial.complete, false); assert.equal(partial.snapshot, undefined); assert.equal(work.sourceBytes, 65536); f.empty();
  const whole = smallCommandSnapshot(f.root, f.fd, f.path, 131072);
  assert.equal(whole.complete, true); assert.equal(whole.issue, undefined); assert.equal(whole.snapshot.size, 131072);
  whole.close(); f.empty();
  const write = fs.writeSync, open = fs.openSync; let stagedFd;
  fs.openSync = (path, ...args) => { const fd = open(path, ...args); if (String(path).endsWith("/snapshot")) stagedFd = fd; return fd; };
  fs.writeSync = (fd, ...args) => { if (fd === stagedFd) throw Error("injected staged write"); return write(fd, ...args); }; syncBuiltinESMExports();
  try { assert.throws(() => smallCommandSnapshot(f.root, f.fd, f.path, 131072), /injected staged write/); }
  finally { fs.writeSync = write; fs.openSync = open; syncBuiltinESMExports(); }
  f.empty();
});

test("growth after a full copy is verified once per changed observation and consumed from the private bytes", t => {
  const f = fixture(t, 131072), work = {}, staged = smallCommandSnapshot(f.root, f.fd, f.path, 131072, { work });
  fs.appendFileSync(f.path, "later\n");
  staged.verify(); staged.verify();
  assert.equal(work.sourceVerificationBytes, 131072);
  assert.equal([...staged.snapshot.chunks()].reduce((n, b) => n + b.length, 0), 131072);
  assert.equal(work.sourceVerificationBytes, 131072, "same source observation does not cause repeated full verification");
  staged.close(); f.empty();
});

test("mutation outside boundary witness plus growth cannot qualify the private digest", t => {
  const f = fixture(t, 131072), staged = smallCommandSnapshot(f.root, f.fd, f.path, 131072);
  const write = fs.openSync(f.path, "r+"); fs.writeSync(write, Buffer.from("b"), 0, 1, 0); fs.closeSync(write);
  fs.appendFileSync(f.path, "growth\n");
  assert.throws(() => staged.verify(), /changed during verification/);
  staged.close(); f.empty();
});

test("named source replacement never qualifies the still-open descriptor", t => {
  const f = fixture(t, 65536), staged = smallCommandSnapshot(f.root, f.fd, f.path, 65536);
  fs.renameSync(f.path, f.path + ".old"); fs.copyFileSync(f.path + ".old", f.path);
  assert.throws(() => staged.verify(), /differs from its named source/);
  staged.close(); f.empty();
});
