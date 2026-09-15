/** Bounded descriptor-backed reads shared by private portable metadata stores. */
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { oatsError } from "./errors.mjs";

export function readPortableBytes(path, { missingCode = "resource-not-found", invalidCode = "invalid-declaration", allowMissing = false } = {}) {
  let stat;
  try { stat = lstatSync(path); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    if (allowMissing) return null;
    throw oatsError(missingCode, "portable metadata is absent");
  }
  if (!stat.isFile()) throw oatsError(invalidCode, "portable metadata must be a regular file");
  if (stat.size > 8 * 1024 * 1024) throw oatsError("resource-limit", "portable metadata byte limit exceeded");
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.dev !== stat.dev || before.ino !== stat.ino || before.size !== stat.size) throw oatsError("integrity-drift", "portable metadata changed during opening");
    const buffer = Buffer.alloc(stat.size + 1);
    let count = 0, size;
    while (count < buffer.length && (size = readSync(fd, buffer, count, buffer.length - count, null)) > 0) count += size;
    const after = fstatSync(fd);
    if (count !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw oatsError("integrity-drift", "portable metadata changed during reading");
    return buffer.subarray(0, count);
  } finally { closeSync(fd); }
}
