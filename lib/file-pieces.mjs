/** A regular file's bytes, read in pieces of at most FILE_PIECE bytes, so
 *  that what a digest holds of a file is bounded whatever its size: Node
 *  refuses to read a file over 2 GiB whole (ERR_FS_FILE_TOO_LARGE), and a
 *  retire digests every file of an instance's work (awebai/oats#617). */
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { oatsError } from "./errors.mjs";

export const FILE_PIECE = 1024 * 1024;

/** Read the file at `path` (text or bytes; a link is followed, as
 *  readFileSync follows it) → its size. `sized(size)` is called first, with
 *  the size the open file has, then `piece(bytes)` for each piece in order:
 *  exactly that many bytes, as readFileSync reads a regular file, so a file
 *  that grows meanwhile is read for the size it had. One that ends before
 *  that size changed while it was read: E_WORK_INSPECTION_FAILED. A piece's
 *  buffer is reused once `piece` returns. `io` is for tests. */
export function readFilePieces(path, sized, piece, io = { readSync }) {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    sized(size);
    const buffer = Buffer.allocUnsafe(Math.min(size, FILE_PIECE));
    for (let read = 0; read < size;) {
      const n = io.readSync(fd, buffer, 0, Math.min(buffer.length, size - read), read);
      if (n === 0) throw oatsError("E_WORK_INSPECTION_FAILED", `${String(path)} changed while it was read: it ended after ${read} of the ${size} bytes it held when it was opened. Retry once nothing writes to it`);
      piece(buffer.subarray(0, n));
      read += n;
    }
    return size;
  } finally {
    closeSync(fd);
  }
}

/** `hash` updated with the bytes of the file at `path` (readFilePieces) → `hash`. */
export function hashFile(hash, path) {
  readFilePieces(path, () => {}, (bytes) => hash.update(bytes));
  return hash;
}
