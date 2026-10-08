/** Tree mechanics only: the kernel's catchable recursive copy (spawn, retire and
 * work recovery). No acquisition, selection, trust, lock or lifecycle policy. */
import {
  chmodSync, copyFileSync, lstatSync, mkdirSync, readdirSync, readlinkSync, symlinkSync,
} from "node:fs";
import { sep } from "node:path";
import { oatsError } from "./errors.mjs";

const SEPARATOR = Buffer.from(sep);
/** A path as bytes: a Buffer as it is, a string as its UTF-8. */
export const pathBytes = (path) => (Buffer.isBuffer(path) ? path : Buffer.from(path));
/** `dir` and `name` joined with the separator byte, as bytes: what a name read
 *  as bytes needs to be opened by its own name. */
export const joinBytes = (dir, name) => Buffer.concat([pathBytes(dir), SEPARATOR, pathBytes(name)]);
/** The entries of a directory, their names as bytes, in the order of those
 *  bytes (Buffer.compare): `readdirSync`'s Dirents, `withFileTypes`. */
export const entriesAsBytes = (dir) => readdirSync(pathBytes(dir), { encoding: "buffer", withFileTypes: true }).sort((a, b) => Buffer.compare(a.name, b.name));

/** Recursively copy a tree the way `cpSync(..., { recursive: true })` would —
 * except catchably.
 *
 * Node 22's recursive `cpSync` performs its recursion in native code, and on
 * macOS an unreadable directory inside the tree surfaces as an uncaught libc++
 * `filesystem_error` that TERMINATES THE PROCESS. No JS `catch` or `finally`
 * runs, so a transaction using it can never clean up staging or roll back the
 * store, the lock and the ignore file. Every package-, capability- and
 * user-shaped tree in the engine therefore goes through this hand-walk instead,
 * where an EACCES is an ordinary throwable error.
 *
 * Semantics chosen to be safe rather than maximally faithful:
 * - names are read, joined and written as bytes, never as decoded text, so a
 *   name that is not valid UTF-8 is copied as it is. `src` and `dest` may be
 *   strings or Buffers;
 * - deterministic traversal (entries in the order of their bytes), so two
 *   copies of one tree hash identically;
 * - symlinks are recreated VERBATIM — never followed, never rewritten — because
 *   the bytes about to be hashed must be the bytes the author wrote. The target
 *   is read and written as bytes: read as text, a target that is not valid
 *   UTF-8 would be recreated as another one;
 * - FIFOs, sockets and device nodes are rejected fail-closed: they are not
 *   distributable content, and copying them has no defined meaning here;
 * - directory modes are applied AFTER their children, so a read-only source
 *   directory cannot block writing its own contents. */
export function copyTreeSafe(src, dest) {
  const st = lstatSync(src);
  if (st.isSymbolicLink()) { symlinkSync(readlinkSync(src, "buffer"), dest); return; }
  if (st.isFile()) { copyFileSync(src, dest); chmodSync(dest, st.mode & 0o7777); return; }
  if (!st.isDirectory()) {
    throw oatsError("invalid-source", `${src.toString()} is not a regular file, directory or symlink (${st.isFIFO() ? "FIFO" : st.isSocket() ? "socket" : st.isBlockDevice() || st.isCharacterDevice() ? "device node" : "unsupported file type"}) — package and capability trees carry distributable content only`);
  }
  mkdirSync(dest, { recursive: true });
  for (const e of entriesAsBytes(src)) copyTreeSafe(joinBytes(src, e.name), joinBytes(dest, e.name));
  chmodSync(dest, st.mode & 0o7777);
}



