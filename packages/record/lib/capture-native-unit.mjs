// Private bounded native command work. Public captureSessions and exact
// receipts retain their synchronous complete-pass contracts. The scheduler
// supplies a stream lock/transaction and advances to another input after this
// unit; a partial result is never a completed sweep.
import { closeSync, constants, fstatSync, openSync } from "node:fs";
import { basename } from "node:path";
import { randomUUID } from "node:crypto";
import { captureContext } from "./capture-context.mjs";
import { CAPTURE_POLICY } from "./capture-budget.mjs";
import { completeNativeLineDigests, completeNativeLines, eventTurnCore } from "./capture-cc.mjs";
import { finishTurn } from "./canonical.mjs";
import { SESSION_FORMATS } from "./formats.mjs";
import { loadIgnore } from "./ignore.mjs";
import { fileVersion, sameVersion, statVersion } from "./derived-state.mjs";
import { assertProtectedDescriptor, digest, sourceChunks } from "./session-snapshot.mjs";
import { guardCapturedPath } from "./native-history.mjs";
import { RecordSizeError } from "./file-lines.mjs";
import { advanceRecoverySnapshot } from "./capture-recovery-snapshot.mjs";
import { advanceTranscriptPrefix } from "./transcript-prefix.mjs";
import { prepareRetainedCaptureCleanup } from "./capture-retained-scratch.mjs";
import { smallCommandSnapshot, SMALL_SNAPSHOT_BYTES } from "./capture-small-snapshot.mjs";

const nonnegative = n => Number.isSafeInteger(n) && n >= 0;
const validCursor = (value, size) => value && nonnegative(value.bytes) && value.bytes <= size &&
  nonnegative(value.line) && typeof value.lastTs === "string";

export function captureNativeUnit(store, { owner, path, format = "cc", capturedPi, ignore,
  start, maxRecords = 2000, maxBytes = 8388608, maxRecordBytes = CAPTURE_POLICY.maxRecordBytes,
  stopped = () => false, work } = {}) {
  const fmt = SESSION_FORMATS[format];
  if (!fmt) throw new Error("unknown native command format");
  const sessionId = fmt.sessionId(path), stream = `${owner}~${fmt.source}.${sessionId}`, key = `${stream}:${path}`;
  const context = captureContext(store), state = context?.state;
  if (!state?.depth || !context.held.has(stream)) throw new Error("native command unit requires its stream work group");
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 2000 ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > context.batchBytes ||
      !Number.isSafeInteger(maxRecordBytes) || maxRecordBytes < 1 || maxRecordBytes > CAPTURE_POLICY.maxRecordBytes) {
    throw new Error("invalid native command unit budget");
  }
  const result = { stream, key, appended: 0, bytesCommitted: 0, complete: false, pending: false };
  if ((ignore ?? loadIgnore(store.root)).ignores(path, [basename(path), sessionId, ...(fmt.ignoreKeys?.(path) ?? [])])) {
    state.delete("set-aside", key);
    // Ignore is evaluated before custody/source access. An extant retained
    // allocation is housekeeping, not authority to reopen an excluded source.
    return { ...result, complete: true, ignored: true };
  }
  const blocked = state.get("set-aside", key);
  if (blocked && !blocked.retry) return { ...result, setAside: blocked };
  if (capturedPi && fmt.source !== "pi") throw new Error("protected capture proof requires pi format");
  guardCapturedPath(path, capturedPi);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK | (capturedPi ? constants.O_NOFOLLOW : 0));
  let staged;
  const stagedChunks = function* (from, end) {
    for (const bytes of staged.snapshot.chunks(from, end)) {
      if (work) work.stagedReadBytes = (work.stagedReadBytes ?? 0) + bytes.length;
      yield bytes;
    }
  };
  const stagedWitness = offset => {
    if (work) work.stagedProbeBytes = (work.stagedProbeBytes ?? 0) + Math.min(4096, offset);
    return digest(Buffer.concat([...staged.snapshot.chunks(Math.max(0, offset - 4096), offset)]));
  };
  try {
    const observe = () => {
      assertProtectedDescriptor(fd, path, capturedPi);
      if (!fstatSync(fd).isFile()) throw new Error("native source is not a regular file");
      const value = statVersion(fstatSync(fd, { bigint: true }));
      if (!sameVersion(value, fileVersion(path))) throw new Error("native source descriptor differs from its named file");
      return value;
    };
    const version = observe();
    const chunks = function* (from, end) {
      for (const bytes of sourceChunks(fd, from, end, path, capturedPi)) {
        // Sampling between reads does not turn an incomplete line into a
        // checkpoint. The outer unit stops at a complete-record boundary.
        stopped();
        if (work) work.sourceBytes = (work.sourceBytes ?? 0) + bytes.length;
        yield bytes;
      }
    };
    const witness = (from, read = chunks) => digest(Buffer.concat([...read(Math.max(0, from - 4096), from)]));
    const probe = offset => {
      const read = function* (from, end) {
        for (const bytes of sourceChunks(fd, from, end, path, capturedPi)) {
          if (work) work.sourceProbeBytes = (work.sourceProbeBytes ?? 0) + bytes.length;
          yield bytes;
        }
      };
      return witness(offset, read);
    };
    const generation = JSON.stringify([state.get("reset", `${owner}:${fmt.source}`) ?? "", state.get("source-retry", key) ?? ""]);
    // Ordinary public cursors use the reset value directly. Command cursors
    // retain it too; the private job additionally binds an explicit retry.
    const reset = state.get("reset", `${owner}:${fmt.source}`) ?? "";
    const journalVersion = fileVersion(store.journalPath(stream));
    let cursor = state.get(fmt.source, key);
    const matchesSource = value => value?.version && (sameVersion(value.version, version) ||
      value.version.dev === version.dev && value.version.ino === version.ino && version.size > value.version.size &&
      value.bytes <= version.size && probe(value.bytes) === value.witness);
    let job = state.get("native-unit", key);
    const jobValid = job && job.generation === generation && sameVersion(job.journalVersion, journalVersion) &&
      validCursor(job, version.size) && nonnegative(job.end) && job.bytes <= job.end && job.end <= version.size &&
      matchesSource(job);
    if (!jobValid) { state.delete("native-unit", key); job = null; }
    const cursorValid = validCursor(cursor, version.size) && cursor.generation === reset &&
      sameVersion(cursor.journalVersion, journalVersion) && matchesSource(cursor) && !blocked;
    const recover = !job && !cursorValid && (journalVersion?.size ?? 0) > 0;
    const allocation = state.get("recovery-allocation", key);
    if (allocation?.phase === "deleting") {
      prepareRetainedCaptureCleanup(store, stream, key, start);
      return { ...result, cleanup: true, phase: "cleanup" };
    }
    if (job?.waiting && job.end === version.size && sameVersion(job.version, version)) {
      return { ...result, pending: true, phase: job.scan ? "timestamp" : "capture", reason: job.waiting };
    }
    if (!job && !allocation && cursorValid && cursor.bytes === version.size) {
      return { ...result, complete: true, unchanged: true, phase: "captured" };
    }
    // Journal validation can itself need several units. Never let appendBatch
    // fall back to an unbounded validation inside the first source append.
    const validated = store.validateJournal(stream, state, { maxRecords, maxBytes, stopped, work: work?.journal });
    if (!validated.complete) return { ...result, phase: "journal" };
    const unitWitness = probe(version.size);
    let read = chunks, verify = () => {
      const after = observe();
      if (!sameVersion(version, after) && !(version.dev === after.dev && version.ino === after.ino &&
          after.size > version.size && probe(version.size) === unitWitness)) throw new Error("native source changed during unit");
    };
    if (recover || allocation || job?.snapshot) {
      let small = state.get("small-stage", key);
      if (!small || small.generation !== generation || !sameVersion(small.journalVersion, journalVersion) ||
          !nonnegative(small.size) || small.size > SMALL_SNAPSHOT_BYTES || small.size > version.size ||
          typeof small.id !== "string" || !matchesSource({ ...small, bytes: small.size })) small = null;
      const end = job?.end ?? small?.size ?? version.size;
      // A killed unit has durable admission/retry evidence but cannot have
      // published an in-memory small-copy outcome. Its next due single-stream
      // retry uses retained copying rather than repeating that overhead forever.
      const retain = allocation || state.get("native-retain", key) || context.admission?.retry || end > SMALL_SNAPSHOT_BYTES;
      if (retain) {
        staged = advanceRecoverySnapshot(store, stream, key, path, start, { capturedPi, generation, fixedEnd: end, maxBytes, stopped, work });
      } else {
        // This observation fixes the sweep end even if copying cannot finish.
        // It is NOT a digest/proof checkpoint: reuse below always requires a
        // complete fresh copy/hash before advanceTranscriptPrefix sees its id.
        small ??= { id: randomUUID(), size: end };
        small = { ...small, generation, journalVersion, version, witness: probe(end) };
        state.set("small-stage", key, small);
        staged = smallCommandSnapshot(store.root, fd, path, end, { capturedPi, stopped, work });
        if (staged.complete) {
          // The nonce binds source observation/reset history; digest+size bind
          // bytes. Equal content under a changed identity still restarts proof.
          staged.snapshot.id = `${small.id}:${staged.snapshot.id}`;
        }
        if (!staged.complete || stopped()) {
          state.set("native-retain", key, true);
          state.delete("native-unit", key);
          return { ...result, phase: "snapshot", retainedFallback: true };
        }
      }
      if (!staged.complete) {
        if (staged.cleanup) state.delete("native-unit", key);
        return { ...result, ...staged, phase: staged.phase ?? "snapshot" };
      }
      if (!job || job.snapshot !== staged.snapshot.id) {
        const priorProof = state.get("prefix-proof", key);
        // The captured prefix is proved by streamed per-line digests, so a
        // record captured before the raw-record limit existed is compared, not
        // refused. The limit applies to capture beyond the proven prefix.
        const proof = advanceTranscriptPrefix(store, stream, { key, snapshot: staged.snapshot, maxRecords, maxBytes, stopped,
          work: work?.prefix, lines: from => completeNativeLineDigests(stagedChunks(from), {}) });
        staged.verify();
        if (proof.conflict) {
          // Journals preserve session/line, not the path that first supplied
          // those bytes. A mismatch can also be a rewrite of this same file;
          // neither a cursor nor today's discovery proves a second source.
          const reason = `${proof.conflict.reason}: refused input ${JSON.stringify(path)} conflicts with stream ${JSON.stringify(stream)} at native line ${proof.conflict.line}, source byte ${proof.conflict.offset}; establishing source path unavailable`;
          const row = { owner, source: fmt.source, path, ...proof.conflict, reason, retry: false };
          state.set("set-aside", key, row);
          const cleanup = !staged.small;
          staged.close(); staged = null;
          state.delete("native-unit", key); state.delete("small-stage", key);
          if (cleanup) prepareRetainedCaptureCleanup(store, stream, key, start);
          return { ...result, setAside: row, cleanup };
        }
        if (!proof.complete) {
          // A full restage that leaves no allowance for proof progress must not
          // recur indefinitely. One committed switch selects resumable copying.
          if (staged.small && stopped() && priorProof &&
              ["phase", "journalBytes", "bytes", "line"].every(k => proof[k] === priorProof[k])) {
            state.set("native-retain", key, true);
          }
          return { ...result, phase: "prefix" };
        }
        job = { bytes: proof.bytes, line: proof.line, lastTs: proof.lastTs, end: staged.snapshot.size,
          snapshot: staged.snapshot.id, small: Boolean(staged.small), generation, journalVersion, version, witness: stagedWitness(proof.bytes) };
        state.delete("set-aside", key);
      }
    } else if (!job) {
      cursor = cursorValid ? cursor : { bytes: 0, line: 0, lastTs: "" };
      job = { bytes: cursor.bytes, line: cursor.line, lastTs: cursor.lastTs, end: version.size,
        generation, journalVersion, version, witness: probe(cursor.bytes) };
    }
    if (staged) { read = stagedChunks; verify = staged.verify; }
    // A raw record over the limit is set aside at its exact start, after the
    // complete records before it were committed. Later records wait for an
    // edited source or an ignore of the whole input. A staged job's copy and
    // fixed end retire with it; a retry reproves and returns here.
    const setAsideOversized = offset => {
      state.delete("native-unit", key); state.delete("native-retain", key); state.delete("small-stage", key);
      if (job.snapshot && !job.small) {
        staged.close(); staged = null;
        prepareRetainedCaptureCleanup(store, stream, key, start);
        result.cleanup = true;
      }
      const row = { owner, source: fmt.source, path, offset, reason: "record-too-large", retry: false };
      state.set("set-aside", key, row);
      return { ...result, setAside: row };
    };
    if (job.waiting) {
      if (job.end === version.size) return { ...result, pending: true, phase: job.scan ? "timestamp" : "capture", reason: job.waiting };
      if (job.snapshot) {
        staged.close(); staged = null;
        if (!job.small) prepareRetainedCaptureCleanup(store, stream, key, start);
        state.delete("native-unit", key); state.delete("small-stage", key);
        return { ...result, cleanup: !job.small, phase: "cleanup" };
      }
      // An exhausted fixed end was pending, so the next source growth is a
      // new bounded sweep. Keep its timestamp frontier, not its old EOF.
      job.end = version.size; delete job.waiting;
    }
    const checkpoint = () => {
      verify();
      job.version = staged && !staged.small ? state.get("recovery-stage", key).observedVersion : version;
      job.witness = staged ? stagedWitness(job.bytes) : probe(job.bytes);
      job.journalVersion = fileVersion(store.journalPath(stream));
      state.set("native-unit", key, job);
      state.set(fmt.source, key, { bytes: job.bytes, line: job.line, lastTs: job.lastTs,
        version: job.version, witness: job.witness, generation: reset, journalVersion: job.journalVersion });
      if (job.small) {
        state.set("small-stage", key, { ...state.get("small-stage", key), journalVersion: job.journalVersion });
      } else if (job.snapshot) {
        // Only our successful fsynced append under this stream lock can carry
        // the proven fixed snapshot into the next exact journal generation.
        const stage = state.get("recovery-stage", key);
        if (stage?.allocation !== job.snapshot) throw new Error("native unit lost its staged proof");
        state.set("recovery-stage", key, { ...stage, journalVersion: job.journalVersion });
      }
    };
    let used = 0, records = 0;
    const stop = () => records >= maxRecords || used >= maxBytes || stopped();
    const walk = {};
    const lines = from => completeNativeLines(read(from, job.end), walk, { maxBytes: maxRecordBytes });
    let scanStart = job.bytes;
    try {
      if (!job.lastTs && job.bytes < job.end) {
        const scan = job.scan ?? { bytes: job.bytes, line: job.line };
        if (!validCursor({ ...scan, lastTs: "" }, job.end) || scan.bytes < job.bytes) throw new Error("invalid native timestamp scan");
        scanStart = scan.bytes;
        const iterator = lines(scan.bytes);
        try {
          while (!stop()) {
            const next = iterator.next(); if (next.done) break;
            const line = next.value; scan.bytes += line.bytes; scan.line++; used += line.bytes; records++;
            if (line.ts) { job.lastTs = line.ts; delete job.scan; break; }
          }
        } finally { iterator.return(); }
        if (!job.lastTs) {
          job.scan = scan;
          if (scan.bytes === job.end || walk.reason) job.waiting = walk.reason ?? "unstamped";
          checkpoint();
          // No stamp yet is pending, not a successful empty capture. Preserve
          // the scan frontier so later growth does not rescan this prefix.
          return { ...result, phase: "timestamp", pending: scan.bytes === job.end || !!walk.reason, reason: walk.reason ?? "unstamped" };
        }
      }
      // Timestamp search is work too; it cannot be followed by another full
      // batch after exhausting this unit's allowance.
      const turns = [], from = job.bytes, iterator = lines(from);
      scanStart = from;
      let oversized = null;
      try {
        while (!stop()) {
          const next = iterator.next(); if (next.done) break;
          const line = next.value;
          if (turns.length && used + line.bytes > maxBytes) break;
          if (line.ts) job.lastTs = line.ts;
          job.bytes += line.bytes; job.line++; used += line.bytes; records++;
          turns.push(finishTurn(eventTurnCore({ owner, source: fmt.source, sessionId, line: line.text, lineNo: job.line, ts: job.lastTs })));
        }
      } catch (error) {
        if (!(error instanceof RecordSizeError)) throw error;
        // The raw record was rejected before allocation/projection. Every
        // complete stamped line before it is still processable: append and
        // checkpoint them through the ordinary commit below, then set aside.
        oversized = from + error.offset;
        if (oversized !== job.bytes) throw new Error("native oversized record does not follow the consumed lines");
      } finally { iterator.return(); }
      verify();
      if (turns.length) result.appended = store.appendUniqueBatch(stream, turns);
      result.bytesCommitted = job.bytes - from;
      if (walk.reason) job.waiting = walk.reason;
      checkpoint();
      if (oversized !== null) return setAsideOversized(oversized);
      if (job.small && job.bytes < job.end && !records && stopped()) state.set("native-retain", key, true);
      if (job.bytes === job.end) {
        state.delete("native-unit", key); state.delete("native-retain", key); state.delete("small-stage", key);
        if (job.snapshot && !job.small) {
          staged.close(); staged = null;
          prepareRetainedCaptureCleanup(store, stream, key, start);
          result.cleanup = true;
        }
        return { ...result, complete: true, phase: "captured" };
      }
      return { ...result, phase: "capture", pending: !!walk.reason, reason: walk.reason ?? null };
    } catch (error) {
      if (!(error instanceof RecordSizeError)) throw error;
      // The offending raw record was rejected before allocation/projection
      // while searching for the first timestamp: no turn precedes it here.
      return setAsideOversized(scanStart + error.offset);
    }
  } finally { try { staged?.close?.(); } finally { closeSync(fd); } }
}
