import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readSync, renameSync, rmSync, writeFileSync, chmodSync, realpathSync } from "node:fs";
import { dirname, join, relative, sep, isAbsolute } from "node:path";
import { randomBytes } from "node:crypto";
import { fail } from "./errors.mjs";

// Private files: everything this capability writes is 0600 in 0700
// directories, and never written through a symlink.

export function ensurePrivateDir(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const st = lstatSync(path);
  if (!st.isDirectory()) fail("E_CLONE_CONTEXT", `${path} is not a directory`);
  chmodSync(path, 0o700);
  return path;
}

/** Write atomically: a fresh 0600 temp file in the same directory, renamed over. */
export function writePrivate(path, data) {
  ensurePrivateDir(dirname(path));
  const tmp = join(dirname(path), `.${randomBytes(6).toString("hex")}.tmp`);
  writeFileSync(tmp, data, { mode: 0o600, flag: "wx" });
  try { renameSync(tmp, path); } catch (e) { rmSync(tmp, { force: true }); throw e; }
  return path;
}

export const writeJson = (path, value) => writePrivate(path, JSON.stringify(value, null, 2) + "\n");

/** Is `path` inside `root` (both real paths)? */
export const inside = (root, path) => path === root || path.startsWith(root + sep);

/** Open a regular file without following a symlink, read at most `max` bytes.
 *  Returns { bytes, size } or { skipped } naming why it was not read. */
export function readRegularFile(path, max) {
  let st;
  try { st = lstatSync(path); } catch { return { skipped: "absent" }; }
  if (st.isSymbolicLink()) return { skipped: "symlink" };
  if (!st.isFile()) return { skipped: "not-regular" };
  if (st.size > max) return { skipped: "over-file-budget", size: st.size };
  let fd;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_NONBLOCK ?? 0)); }
  catch { return { skipped: "unreadable" }; }
  try {
    const fst = fstatSync(fd);
    if (!fst.isFile() || fst.ino !== st.ino || fst.dev !== st.dev) return { skipped: "changed" };
    if (fst.size > max) return { skipped: "over-file-budget", size: fst.size };
    const buf = Buffer.alloc(fst.size);
    let off = 0;
    while (off < buf.length) {
      const n = readSync(fd, buf, off, buf.length - off, off);
      if (n === 0) break;
      off += n;
    }
    return { bytes: buf.subarray(0, off), size: off };
  } finally { closeSync(fd); }
}

/** An absolute path inside `root` (after realpath), or null. */
export function containedPath(root, candidate) {
  if (typeof candidate !== "string" || !isAbsolute(candidate)) return null;
  let real;
  try { real = realpathSync(candidate); } catch { return null; }
  return inside(root, real) ? real : null;
}

export const relPath = (root, path) => relative(root, path).split(sep).join("/");
