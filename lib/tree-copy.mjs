/** Tree mechanics only: the kernel's catchable recursive copy (spawn, retire and
 * work recovery), and a bounded comparison of a copy with its source. No
 * acquisition, selection, trust, lock or lifecycle policy. */
import fs, {
  chmodSync, closeSync, constants, copyFileSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, readlinkSync, symlinkSync,
} from "node:fs";
import { sep } from "node:path";
import { performance } from "node:perf_hooks";
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
 *   UTF-8 would be recreated as another one. A link keeps its own mode, which
 *   the exact digest holds: where the new link's mode is not the source's
 *   (macOS gives a link the umask's mode; Linux every link 0777), it is set
 *   with lchmod, on the link and never on its target. A platform with no
 *   lchmod cannot, and the copy is refused (linkModeUnsupported) rather than
 *   left with another mode;
 * - FIFOs, sockets and device nodes are rejected fail-closed: they are not
 *   distributable content, and copying them has no defined meaning here;
 * - directory modes are applied AFTER their children, so a read-only source
 *   directory cannot block writing its own contents. */
export function copyTreeSafe(src, dest, { lchmod = fs.lchmodSync } = {}) {
  const st = lstatSync(src);
  if (st.isSymbolicLink()) { symlinkSync(readlinkSync(src, "buffer"), dest); copyLinkMode(dest, st.mode & 0o7777, lchmod); return; }
  if (st.isFile()) { copyFileSync(src, dest); chmodSync(dest, st.mode & 0o7777); return; }
  if (!st.isDirectory()) {
    throw oatsError("invalid-source", `${src.toString()} is not a regular file, directory or symlink (${st.isFIFO() ? "FIFO" : st.isSocket() ? "socket" : st.isBlockDevice() || st.isCharacterDevice() ? "device node" : "unsupported file type"}) — package and capability trees carry distributable content only`);
  }
  mkdirSync(dest, { recursive: true });
  for (const e of entriesAsBytes(src)) copyTreeSafe(joinBytes(src, e.name), joinBytes(dest, e.name), { lchmod });
  chmodSync(dest, st.mode & 0o7777);
}
/** Give the link `dest`, just made, the permission bits `mode` of its source: nothing to do when it
 *  has them already, else lchmod (`lchmod`: fs.lchmodSync, which only a platform that can set a
 *  link's mode has), read back. A mode that cannot be set is refused, never dropped. */
function copyLinkMode(dest, mode, lchmod) {
  if ((lstatSync(dest).mode & 0o7777) === mode) return;
  if (typeof lchmod !== "function") throw linkModeUnsupported(dest, mode, "this platform cannot set a link's mode (no lchmod)");
  lchmod(dest, mode);
  const now = lstatSync(dest).mode & 0o7777;
  if (now !== mode) throw linkModeUnsupported(dest, mode, `lchmod left it ${now.toString(8).padStart(4, "0")}`);
}
const linkModeUnsupported = (dest, mode, why) =>
  new Error(`cannot copy the link ${pathBytes(dest).toString()} with its mode ${mode.toString(8).padStart(4, "0")}: ${why}; the copy would differ from its source`);

/** How far treeDisagreement goes before it stops: entries listed, entries
 *  looked at (on both sides, together), file bytes read (on both sides,
 *  together) and milliseconds. */
export const TREE_DISAGREEMENT_LIMITS = Object.freeze({ discrepancies: 20, entries: 200_000, bytes: 64 * 1024 * 1024, ms: 5000 });
const COMPARE_CHUNK = 64 * 1024;
// A file is opened as the regular file lstat saw: a name that became a link is not followed
// (O_NOFOLLOW), and one that became a FIFO does not block the open (O_NONBLOCK).
const COMPARE_OPEN = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

/** A relative path, as bytes, in text that reads back one way only: each
 *  printable ASCII byte as itself (space included), `\` as `\\`, and every
 *  other byte (a control character, a byte of a UTF-8 sequence or of no valid
 *  one) as `\xHH`. */
export function escapedPath(bytes) {
  let out = "";
  for (const b of pathBytes(bytes)) out += b === 0x5c ? "\\\\" : b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : `\\x${b.toString(16).padStart(2, "0")}`;
  return out;
}

/** Where a copy differs from its source, for a diagnosis only: never a verdict.
 *  It is read when an exact comparison of the two has already refused, and
 *  what it reads is the two trees as they are NOW, so a source that changed
 *  since its bytes were recorded can show differences that are not the ones
 *  the recorded comparison saw, or none.
 *
 *  Both trees are walked together, names as bytes in the order of those bytes,
 *  with lstat: no link is followed. `excludePaths` (relative paths, as bytes)
 *  are passed over on both sides, exactly. The roots' own modes are not
 *  compared. Each difference is `{ path, kind }`: `path` relative to the roots,
 *  escaped (escapedPath), and `kind` one of `missing` (in the source, not the
 *  copy), `extra` (in the copy, not the source), `type`, `mode` (permission
 *  bits), `link-target` and `file-content`. Below a `missing`, `extra` or
 *  `type` entry nothing is listed. One entry can have several kinds, in that
 *  order. Nothing else is said: no content, no link target, no absolute path.
 *
 *  The work is bounded (`limits`, TREE_DISAGREEMENT_LIMITS): files are compared
 *  in chunks, sizes first, and never read whole; a file is read only as the
 *  regular file lstat saw (same device, inode and size, no link followed, no
 *  FIFO waited on), else the search stops as `unreadable`. `entries` counts the
 *  entries compared; each directory's listing is read whole first, as the
 *  digest's own walk reads it. → `{ entries, complete }`,
 *  with `stoppedBy` when it stopped early: `discrepancies` (more than it
 *  lists), `entries`, `bytes`, `time`, or `unreadable` when a tree could not
 *  be read (it may have changed while it was read). It never throws. An
 *  answer with `complete: true` and no entries found nothing that differs now. */
export function treeDisagreement(source, copy, { excludePaths = [], limits = TREE_DISAGREEMENT_LIMITS, clock = () => performance.now() } = {}) {
  const excluded = new Set(excludePaths.map((path) => pathBytes(path).toString("hex")));
  const entries = [];
  const started = clock();
  let looked = 0, read = 0;
  const STOP = Symbol("stop");
  const stop = (reason) => { throw { [STOP]: reason }; };
  const inTime = () => { if (clock() - started > limits.ms) stop("time"); };
  const note = (rel, kind) => {
    if (entries.length === limits.discrepancies) stop("discrepancies");
    entries.push({ path: escapedPath(rel), kind });
  };
  const kindOf = (st) => (st.isSymbolicLink() ? "link" : st.isFile() ? "file" : st.isDirectory() ? "dir" : "other");
  /** `path` opened as the regular file `st` (its lstat) describes, else the search stops: the tree
   *  changed while it was read. */
  const openAsSeen = (path, st) => {
    const fd = openSync(path, COMPARE_OPEN);
    const now = fstatSync(fd);
    if (!now.isFile() || now.ino !== st.ino || now.dev !== st.dev || now.size !== st.size) { closeSync(fd); stop("unreadable"); }
    return fd;
  };
  const sameBytes = (a, sa, b, sb) => {
    const size = sa.size;
    const fa = openAsSeen(a, sa);
    try {
      const fb = openAsSeen(b, sb);
      try {
        const ba = Buffer.allocUnsafe(COMPARE_CHUNK), bb = Buffer.allocUnsafe(COMPARE_CHUNK);
        for (let at = 0; at < size;) {
          const want = Math.min(COMPARE_CHUNK, size - at);
          if (read + 2 * want > limits.bytes) stop("bytes");
          inTime();
          const na = readSync(fa, ba, 0, want, at), nb = readSync(fb, bb, 0, want, at);
          read += na + nb;
          if (na !== nb || na === 0 || !ba.subarray(0, na).equals(bb.subarray(0, nb))) return false;
          at += na;
        }
        return true;
      } finally { closeSync(fb); }
    } finally { closeSync(fa); }
  };
  const walk = (a, b, rel) => {
    const names = new Map();
    for (const e of entriesAsBytes(a)) names.set(e.name.toString("hex"), { name: e.name, a: true, b: false });
    for (const e of entriesAsBytes(b)) { const k = e.name.toString("hex"); const n = names.get(k); if (n) n.b = true; else names.set(k, { name: e.name, a: false, b: true }); }
    for (const { name, a: inA, b: inB } of [...names.values()].sort((x, y) => Buffer.compare(x.name, y.name))) {
      const childRel = rel.length ? Buffer.concat([rel, SEPARATOR, name]) : name;
      if (excluded.has(childRel.toString("hex"))) continue;
      looked += (inA ? 1 : 0) + (inB ? 1 : 0);
      if (looked > limits.entries) stop("entries");
      inTime();
      if (!inB) { note(childRel, "missing"); continue; }
      if (!inA) { note(childRel, "extra"); continue; }
      const pa = joinBytes(a, name), pb = joinBytes(b, name);
      const sa = lstatSync(pa), sb = lstatSync(pb);
      const kind = kindOf(sa);
      if (kind !== kindOf(sb)) { note(childRel, "type"); continue; }
      if ((sa.mode & 0o7777) !== (sb.mode & 0o7777)) note(childRel, "mode");
      if (kind === "link" && !readlinkSync(pa, "buffer").equals(readlinkSync(pb, "buffer"))) note(childRel, "link-target");
      else if (kind === "file" && (sa.size !== sb.size || !sameBytes(pa, sa, pb, sb))) note(childRel, "file-content");
      else if (kind === "dir") walk(pa, pb, childRel);
    }
  };
  try {
    walk(pathBytes(source), pathBytes(copy), Buffer.alloc(0));
    return { entries, complete: true };
  } catch (e) {
    return { entries, complete: false, stoppedBy: e && typeof e === "object" && STOP in e ? e[STOP] : "unreadable" };
  }
}

