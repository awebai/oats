// A disposable command snapshot, eligible by TOTAL fixed end, never suffix
// length. Reopening a later worker's source is not proof: it must finish a new
// chunked copy/hash and match the full digest+size before reusing comparison.
import { createHash } from "node:crypto";
import { closeSync, fstatSync, openSync, writeSync } from "node:fs";
import { join } from "node:path";
import { createCaptureScratch } from "./capture-scratch.mjs";
import { fileVersion, sameVersion, statVersion } from "./derived-state.mjs";
import { assertProtectedDescriptor, sourceChunks } from "./session-snapshot.mjs";
import { fileChunks } from "./file-lines.mjs";

export const SMALL_SNAPSHOT_BYTES = 8388608;

export function smallCommandSnapshot(root, fd, path, size, { capturedPi, stopped = () => false,
  maxRecordBytes = SMALL_SNAPSHOT_BYTES, work } = {}) {
  if (!Number.isSafeInteger(size) || size < 0 || size > SMALL_SNAPSHOT_BYTES ||
      !Number.isSafeInteger(maxRecordBytes) || maxRecordBytes < 1 || maxRecordBytes > SMALL_SNAPSHOT_BYTES) {
    throw new Error("small command snapshot exceeds its total fixed-end eligibility");
  }
  const observe = () => {
    assertProtectedDescriptor(fd, path, capturedPi);
    const stat = fstatSync(fd, { bigint: true });
    if (!stat.isFile()) throw new Error("small snapshot source is not a regular file");
    const version = statVersion(stat);
    if (!sameVersion(version, fileVersion(path))) throw new Error("small snapshot descriptor differs from its named source");
    return version;
  };
  const before = observe();
  let observed = before;
  if (before.size < size) throw new Error("small snapshot source shrank before staging");
  if (stopped()) return { complete: false };
  const scratch = createCaptureScratch(root, "snapshot");
  let stagedFd, keep = false;
  try {
    stagedFd = openSync(join(scratch.path, "snapshot"), "wx+", 0o600);
    const hash = createHash("sha256");
    let copied = 0, lineBytes = 0, lineStart = 0, lines = 0;
    const iterator = sourceChunks(fd, 0, size, path, capturedPi);
    try {
      while (copied < size) {
        if (stopped()) return { complete: false };
        const next = iterator.next();
        if (next.done) throw new Error("small snapshot short read");
        const bytes = next.value;
        if (work) work.sourceBytes = (work.sourceBytes ?? 0) + bytes.length;
        for (let from = 0; from < bytes.length;) {
          const newline = bytes.indexOf(10, from), end = newline < 0 ? bytes.length : newline + 1;
          if (lineBytes + end - from > maxRecordBytes) return { complete: false,
            issue: { offset: lineStart, line: lines + 1, reason: "record-too-large", limit: maxRecordBytes } };
          lineBytes += end - from;
          if (newline >= 0) { lineStart += lineBytes; lineBytes = 0; lines++; }
          from = end;
        }
        hash.update(bytes);
        for (let written = 0; written < bytes.length;) {
          const count = writeSync(stagedFd, bytes, written, bytes.length - written, copied + written);
          if (!count) throw new Error("small snapshot short write");
          written += count;
        }
        copied += bytes.length;
        if (work) work.stagedWriteBytes = (work.stagedWriteBytes ?? 0) + bytes.length;
      }
    } finally { iterator.return(); }
    const digest = hash.digest("hex"), payload = statVersion(fstatSync(stagedFd, { bigint: true }));
    const verify = () => {
      if (!sameVersion(payload, statVersion(fstatSync(stagedFd, { bigint: true })))) throw new Error("small snapshot payload changed");
      const after = observe();
      if (sameVersion(observed, after)) return;
      if (after.dev !== observed.dev || after.ino !== observed.ino || after.size <= observed.size) throw new Error("small snapshot source changed");
      // Growth while copying/verifying requires a complete fixed-end digest,
      // not the ordinary incremental cursor's bounded boundary witness.
      const check = createHash("sha256");
      for (const bytes of sourceChunks(fd, 0, size, path, capturedPi)) {
        if (work) work.sourceVerificationBytes = (work.sourceVerificationBytes ?? 0) + bytes.length;
        check.update(bytes);
      }
      if (check.digest("hex") !== digest || !sameVersion(after, observe())) throw new Error("small snapshot source changed during verification");
      observed = after;
    };
    verify(); keep = true; let closed = false;
    return { complete: true, small: true, snapshot: { id: `sha256:${digest}:${size}`, size,
      *chunks(from = 0, end = size) {
        if (!Number.isSafeInteger(from) || from < 0 || !Number.isSafeInteger(end) || end < from || end > size) throw new Error("invalid small snapshot range");
        verify(); let read = 0;
        for (const bytes of fileChunks(stagedFd, { start: from, end, size: 65536 })) { read += bytes.length; yield bytes; }
        if (read !== end - from) throw new Error("small snapshot payload short read");
        verify();
      } }, verify,
      close() { if (!closed) { closed = true; try { closeSync(stagedFd); } finally { scratch.close(); } } } };
  } finally {
    if (!keep) { try { if (stagedFd !== undefined) closeSync(stagedFd); } finally { scratch.close(); } }
  }
}
