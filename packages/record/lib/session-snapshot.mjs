// File witnesses cross the discovery -> capture-lock boundary. Paths alone
// are not attribution: a renamed/replaced source must never donate bytes to
// the previous source's stream. Reads and validation use the SAME descriptor.
import { createHash } from "node:crypto";
import { fstatSync, lstatSync, readSync, statSync } from "node:fs";
import { guardCapturedPath } from "./native-history.mjs";

export function identity(stat) {
  if (!stat.isFile()) throw new Error("session source is not a regular file");
  return { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
}

export function sameFile(a, b) { return a.dev === b.dev && a.ino === b.ino; }
export function sameVersion(a, b) {
  return sameFile(a, b) && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}
export function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

// O_NOFOLLOW protects the leaf only. An ancestor may have redirected open()
// and been restored before it returns: bind that FD to the physically contained
// named file under the original root proof BEFORE reading even one byte.
export function assertProtectedDescriptor(fd, path, capturedPi) {
  guardCapturedPath(path, capturedPi);
  if (capturedPi === undefined) return;
  const opened = fstatSync(fd), named = lstatSync(path);
  if (!opened.isFile() || !named.isFile() || !sameFile(opened, named)) throw new Error(`protected session descriptor differs from its contained source: ${path}`);
  guardCapturedPath(path, capturedPi);
}

export function readRange(fd, start, size, path, capturedPi) {
  assertProtectedDescriptor(fd, path, capturedPi);
  const buf = Buffer.alloc(size - start);
  let done = 0;
  while (done < buf.length) {
    if (capturedPi) assertProtectedDescriptor(fd, path, capturedPi);
    const n = readSync(fd, buf, done, buf.length - done, start + done);
    if (n === 0) throw new Error(`short read of session source: ${path}`);
    done += n;
  }
  if (capturedPi) assertProtectedDescriptor(fd, path, capturedPi);
  return buf;
}

export function hashPrefix(fd, size, path, capturedPi) {
  assertProtectedDescriptor(fd, path, capturedPi);
  const hash = createHash("sha256"), buf = Buffer.alloc(64 * 1024);
  for (let pos = 0; pos < size;) {
    if (capturedPi) assertProtectedDescriptor(fd, path, capturedPi);
    const n = readSync(fd, buf, 0, Math.min(buf.length, size - pos), pos);
    if (n === 0) throw new Error(`short read of session source: ${path}`);
    hash.update(buf.subarray(0, n)); pos += n;
  }
  if (capturedPi) assertProtectedDescriptor(fd, path, capturedPi);
  return hash.digest("hex");
}

export function assertIdentity(stat, expected, path) {
  if (!stat.isFile() || !sameFile(stat, expected) || stat.size < expected.size) {
    throw new Error(`session source identity changed or shrank since attribution: ${path}`);
  }
}

// Append growth is allowed, but only with an identical witnessed prefix.
// A changed same-size file is not append growth. Verification happens before
// journal writes; afterwards the buffer to append is independent of the path.
export function verifySnapshot(fd, path, snapshot) {
  assertProtectedDescriptor(fd, path, snapshot.capturedPi);
  const after = fstatSync(fd), named = statSync(path);
  assertIdentity(after, snapshot, path);
  assertIdentity(named, snapshot, path);
  if (!sameVersion(after, named)) throw new Error(`session source changed during capture: ${path}`);
  if (sameVersion(after, snapshot)) { guardCapturedPath(path, snapshot.capturedPi); return; }
  if (after.size <= snapshot.size || hashPrefix(fd, snapshot.size, path, snapshot.capturedPi) !== snapshot.hash) {
    throw new Error(`session source changed during capture: ${path}`);
  }
  // A second change while validating is uncertain, not absence of evidence.
  if (!sameVersion(after, fstatSync(fd)) || !sameVersion(after, statSync(path))) {
    throw new Error(`session source changed during verification: ${path}`);
  }
  guardCapturedPath(path, snapshot.capturedPi);
}
