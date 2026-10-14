// Command-only staged source copying. The fixed source end and committed chunk
// hashes survive workers; ownership is handled by retained-scratch, never by
// reopening an allocation by name alone. Explicit receipt snapshots do not use
// this append-only/bounded-witness path.
import { closeSync, constants, fstatSync, fsyncSync, ftruncateSync, openSync, readSync, writeSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { captureContext } from "./capture-context.mjs";
import { CAPTURE_POLICY } from "./capture-budget.mjs";
import { createRetainedCaptureScratch, openRetainedCaptureScratch } from "./capture-retained-scratch.mjs";
import { statVersion, fileVersion, sameVersion } from "./derived-state.mjs";
import { assertProtectedDescriptor, digest } from "./session-snapshot.mjs";
import { guardCapturedPath } from "./native-history.mjs";

const CHUNK = 65536;
function readExact(fd, position, size) {
  const bytes = Buffer.allocUnsafe(size); let read = 0;
  while (read < size) {
    const n = readSync(fd, bytes, read, size - read, position + read);
    if (!n) throw new Error("short read of recovery snapshot");
    read += n;
  }
  return bytes;
}

export function advanceRecoverySnapshot(store, stream, key, path, start, {
  capturedPi, generation = "", fixedEnd, maxBytes = 8 * 1024 * 1024, maxRecordBytes = CAPTURE_POLICY.maxRecordBytes,
  stopped = () => false, work,
} = {}) {
  const context = captureContext(store), state = context?.state;
  if (!state?.depth || !context.held.has(stream)) throw new Error("recovery snapshot requires its stream work group");
  if (typeof generation !== "string" || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 8 * 1024 * 1024 ||
      !Number.isSafeInteger(maxRecordBytes) || maxRecordBytes < 1 || maxRecordBytes > CAPTURE_POLICY.maxRecordBytes) throw new Error("invalid recovery snapshot budget");
  // The scheduling caller applies ignore before entering this helper. Custody
  // checks still precede every protected source open/read and final verification.
  guardCapturedPath(path, capturedPi);
  const sourceFd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK | (capturedPi ? constants.O_NOFOLLOW : 0));
  let allocation, retained = false;
  try {
    assertProtectedDescriptor(sourceFd, path, capturedPi);
    if (!fstatSync(sourceFd).isFile()) throw new Error("recovery source is not a regular file");
    const observe = () => {
      assertProtectedDescriptor(sourceFd, path, capturedPi);
      const version = statVersion(fstatSync(sourceFd, { bigint: true }));
      if (!sameVersion(version, fileVersion(path))) throw new Error("recovery source descriptor differs from its named file");
      return version;
    };
    const version = observe(), journalVersion = fileVersion(store.journalPath(stream)), db = state.db;
    if (fixedEnd !== undefined && (!Number.isSafeInteger(fixedEnd) || fixedEnd < 0 || fixedEnd > version.size)) throw new Error("invalid fixed recovery end");
    if (db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type='table' AND name='recovery_chunks'").get()?.found !== 1) {
      db.exec("CREATE TABLE recovery_chunks (allocation TEXT, offset INTEGER, length INTEGER NOT NULL, hash TEXT NOT NULL, PRIMARY KEY(allocation,offset))");
      state.set("recovery-meta", "epoch", randomUUID());
    }
    let epoch = state.get("recovery-meta", "epoch");
    if (epoch === null) { epoch = randomUUID(); state.set("recovery-meta", "epoch", epoch); }
    if (typeof epoch !== "string" || !epoch) throw new Error("invalid recovery chunk epoch");
    let stage = state.get("recovery-stage", key);
    const existing = state.get("recovery-allocation", key);
    allocation = existing ? openRetainedCaptureScratch(store, stream, key, start) : createRetainedCaptureScratch(store, stream, key, start);
    const invalidate = reason => {
      allocation.close();
      allocation = openRetainedCaptureScratch(store, stream, key, start, { cleanup: true });
      state.set("recovery-stage", key, { allocation: allocation.claim.id, phase: "invalid", reason });
      return { complete: false, invalidated: true, cleanup: true, reason };
    };
    if (allocation.claim.phase === "deleting") return { complete: false, cleanup: true };
    if (!existing) {
      if (typeof stage?.allocation === "string") state.set("recovery-garbage", stage.allocation, true);
      stage = { epoch, generation, journalVersion, allocation: allocation.claim.id, path, sourceVersion: version, observedVersion: version,
        size: fixedEnd ?? version.size, copied: 0, checked: 0, rawLineBytes: 0, lineStart: 0, lines: 0,
        witness: digest(Buffer.alloc(0)), payloadVersion: statVersion(fstatSync(allocation.fd, { bigint: true })), phase: "copy" };
    } else if (!stage || stage.epoch !== epoch || stage.allocation !== allocation.claim.id || stage.path !== path) {
      return invalidate("recovery-state-lost");
    }
    if (stage.generation !== generation) return invalidate("recovery-generation-changed");
    // A public/outgoing writer may have captured a later source suffix between
    // workers. Comparing that longer journal with this old fixed end would
    // manufacture a missing-prefix conflict. Rebuild the source snapshot first;
    // the append-only source witness never qualifies a changed journal version.
    if (!sameVersion(stage.journalVersion, journalVersion)) return invalidate("recovery-journal-changed");
    if (!["copy", "validate", "ready"].includes(stage.phase) ||
        !["size", "copied", "checked", "rawLineBytes", "lineStart", "lines"].every(k => Number.isSafeInteger(stage[k]) && stage[k] >= 0) ||
        stage.copied > stage.size || stage.checked > stage.copied || stage.lineStart + stage.rawLineBytes !== stage.copied) {
      return invalidate("recovery-state-invalid");
    }
    const witness = end => {
      assertProtectedDescriptor(sourceFd, path, capturedPi);
      const size = Math.min(4096, end), bytes = readExact(sourceFd, end - size, size);
      if (work) work.sourceProbeBytes = (work.sourceProbeBytes ?? 0) + size;
      return digest(bytes);
    };
    const sourceMatches = observed => sameVersion(stage.observedVersion, observed) ||
      observed.dev === stage.sourceVersion.dev && observed.ino === stage.sourceVersion.ino &&
      observed.size > stage.observedVersion.size && observed.size >= stage.size && witness(stage.copied) === stage.witness;
    if (!sourceMatches(version)) return invalidate("recovery-source-changed");
    stage.observedVersion = version;
    allocation.verify();
    let payloadVersion = statVersion(fstatSync(allocation.fd, { bigint: true }));
    if (!sameVersion(payloadVersion, stage.payloadVersion)) {
      if (payloadVersion.size < stage.copied) return invalidate("recovery-payload-shrank");
      // The extra suffix was never committed. Remove it only from this adopted
      // allocation, then verify every committed chunk before extending/using it.
      if (payloadVersion.size > stage.copied) { ftruncateSync(allocation.fd, stage.copied); fsyncSync(allocation.fd); }
      payloadVersion = statVersion(fstatSync(allocation.fd, { bigint: true }));
      stage.phase = "validate"; stage.checked = 0; stage.payloadVersion = payloadVersion;
    }
    let used = 0;
    const stop = () => used >= maxBytes || stopped();
    if (stage.phase === "validate") {
      const get = db.prepare("SELECT length,hash FROM recovery_chunks WHERE allocation=? AND offset=?");
      while (stage.checked < stage.copied && !stop()) {
        const row = get.get(stage.allocation, stage.checked);
        if (!row || !Number.isSafeInteger(row.length) || row.length < 1 || row.length > CHUNK || stage.checked + row.length > stage.copied) return invalidate("recovery-chunk-missing");
        const bytes = readExact(allocation.fd, stage.checked, row.length);
        if (digest(bytes) !== row.hash) return invalidate("recovery-payload-changed");
        stage.checked += row.length; used += row.length;
        if (work) work.stagedReadBytes = (work.stagedReadBytes ?? 0) + row.length;
      }
      if (!sameVersion(stage.payloadVersion, statVersion(fstatSync(allocation.fd, { bigint: true })))) return invalidate("recovery-payload-changed");
      if (stage.checked === stage.copied) stage.phase = stage.copied === stage.size ? "ready" : "copy";
    }
    if (stage.phase === "copy") {
      const put = db.prepare("INSERT INTO recovery_chunks VALUES (?,?,?,?)");
      while (stage.copied < stage.size && !stop()) {
        assertProtectedDescriptor(sourceFd, path, capturedPi); allocation.verify();
        const bytes = readExact(sourceFd, stage.copied, Math.min(CHUNK, maxBytes - used, stage.size - stage.copied));
        if (work) work.sourceBytes = (work.sourceBytes ?? 0) + bytes.length;
        for (let from = 0; from < bytes.length;) {
          const newline = bytes.indexOf(10, from), end = newline < 0 ? bytes.length : newline + 1;
          if (stage.rawLineBytes + end - from > maxRecordBytes) {
            const issue = { offset: stage.lineStart, line: stage.lines + 1, reason: "record-too-large", limit: maxRecordBytes };
            invalidate("record-too-large"); return { complete: false, cleanup: true, issue };
          }
          stage.rawLineBytes += end - from;
          if (newline >= 0) { stage.lineStart += stage.rawLineBytes; stage.rawLineBytes = 0; stage.lines++; }
          from = end;
        }
        for (let written = 0; written < bytes.length;) {
          const n = writeSync(allocation.fd, bytes, written, bytes.length - written, stage.copied + written);
          if (!n) throw new Error("short write of recovery snapshot"); written += n;
        }
        put.run(stage.allocation, stage.copied, bytes.length, digest(bytes));
        stage.copied += bytes.length; used += bytes.length;
        if (work) work.stagedWriteBytes = (work.stagedWriteBytes ?? 0) + bytes.length;
      }
      // File bytes precede the surrounding DB commit; a crash in between leaves
      // a suffix that the next worker truncates/revalidates, never progress.
      fsyncSync(allocation.fd);
      stage.payloadVersion = statVersion(fstatSync(allocation.fd, { bigint: true }));
      const probeBytes = Math.min(4096, stage.copied);
      stage.witness = digest(readExact(allocation.fd, stage.copied - probeBytes, probeBytes));
      if (work) work.stagedProbeBytes = (work.stagedProbeBytes ?? 0) + probeBytes;
      if (stage.copied === stage.size) stage.phase = "ready";
    }
    const after = observe();
    if (!sourceMatches(after)) return invalidate("recovery-source-changed");
    stage.observedVersion = after;
    allocation.verify();
    state.set("recovery-stage", key, stage);
    if (stage.phase !== "ready") return { complete: false, phase: stage.phase, copied: stage.copied, checked: stage.checked };
    const verify = () => {
      allocation.verify();
      if (!sameVersion(stage.payloadVersion, statVersion(fstatSync(allocation.fd, { bigint: true }))) || !sourceMatches(observe())) {
        throw new Error("recovery snapshot changed before use");
      }
    };
    verify(); retained = true; let closed = false;
    return { complete: true, snapshot: { id: stage.allocation, size: stage.size,
      *chunks(from = 0, end = stage.size) {
        if (!Number.isSafeInteger(from) || from < 0 || !Number.isSafeInteger(end) || end < from || end > stage.size) throw new Error("invalid recovery snapshot range");
        for (let position = from; position < end;) {
          verify(); const bytes = readExact(allocation.fd, position, Math.min(CHUNK, end - position));
          position += bytes.length; yield bytes;
        }
        verify();
      } }, verify, close() { if (!closed) { closed = true; try { allocation.close(); } finally { closeSync(sourceFd); } } } };
  } finally { if (!retained) { try { allocation?.close(); } finally { closeSync(sourceFd); } } }
}

// Retired hash rows are derived metadata, not cleanup authority for any path.
// The worker queues an allocation id after retiring its job and reclaims only a
// bounded number per unit; payload ownership remains the separate scratch rule.
export function discardRecoveryChunks(state, allocation, { maxRecords = 2000 } = {}) {
  if (!state.depth || typeof allocation !== "string" || !/^[a-f0-9]{32}$/.test(allocation) ||
      !Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 2000) throw new Error("invalid recovery chunk cleanup");
  const exists = state.db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type='table' AND name='recovery_chunks'").get()?.found === 1;
  const done = !exists || Number(state.db.prepare(`DELETE FROM recovery_chunks WHERE rowid IN
    (SELECT rowid FROM recovery_chunks WHERE allocation=? LIMIT ?)`).run(allocation, maxRecords).changes) < maxRecords;
  if (done) state.delete("recovery-garbage", allocation);
  return done;
}
