/** Bounded descriptor-backed reads of kernel-owned files (manifests, instance records). */
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { oatsError } from "./errors.mjs";

export function readPortableBytes(path, { missingCode = "resource-not-found", invalidCode = "invalid-declaration", allowMissing = false } = {}) {
  let stat;
  try { stat = lstatSync(path); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    if (allowMissing) return null;
    throw oatsError(missingCode, "metadata file is absent");
  }
  if (!stat.isFile()) throw oatsError(invalidCode, "metadata file must be a regular file");
  if (stat.size > 8 * 1024 * 1024) throw oatsError("resource-limit", "metadata file byte limit exceeded");
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.dev !== stat.dev || before.ino !== stat.ino || before.size !== stat.size) throw oatsError("integrity-drift", "metadata file changed during opening");
    const buffer = Buffer.alloc(stat.size + 1);
    let count = 0, size;
    while (count < buffer.length && (size = readSync(fd, buffer, count, buffer.length - count, null)) > 0) count += size;
    const after = fstatSync(fd);
    if (count !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw oatsError("integrity-drift", "metadata file changed during reading");
    return buffer.subarray(0, count);
  } finally { closeSync(fd); }
}

/** At most `max` bytes from the start of a regular file, and its size, through one descriptor: lstat must find a
 *  regular file, the open refuses a symlink (O_NOFOLLOW) and never blocks on a FIFO swapped in meanwhile
 *  (O_NONBLOCK), and the opened file must be the one lstat found. → { bytes, size } */
export function readFileHead(path, max) {
  const stat = lstatSync(path);
  if (!stat.isFile()) throw oatsError("invalid-declaration", "not a regular file");
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino) throw oatsError("integrity-drift", "the file changed during opening");
    const want = Math.min(opened.size, max);
    const buffer = Buffer.alloc(want);
    let count = 0, size;
    while (count < want && (size = readSync(fd, buffer, count, want - count, count)) > 0) count += size;
    return { bytes: buffer.subarray(0, count), size: opened.size };
  } finally { closeSync(fd); }
}
