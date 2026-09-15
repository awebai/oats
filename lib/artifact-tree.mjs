/** Tree mechanics only. No acquisition, selection, trust, lock or lifecycle
 * policy. Callers supply the verifier used during publication. */
import {
  chmodSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, readlinkSync, renameSync, rmSync, symlinkSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { createHash } from "node:crypto";
import { oatsError } from "./errors.mjs";

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
 * - deterministic traversal (sorted entries), so two copies of one tree hash
 *   identically;
 * - symlinks are recreated VERBATIM — never followed, never rewritten — because
 *   the bytes about to be hashed must be the bytes the author wrote;
 * - FIFOs, sockets and device nodes are rejected fail-closed: they are not
 *   distributable content, and copying them has no defined meaning here;
 * - directory modes are applied AFTER their children, so a read-only source
 *   directory cannot block writing its own contents. */
export function copyTreeSafe(src, dest) {
  const st = lstatSync(src);
  if (st.isSymbolicLink()) { symlinkSync(readlinkSync(src), dest); return; }
  if (st.isFile()) { copyFileSync(src, dest); chmodSync(dest, st.mode & 0o7777); return; }
  if (!st.isDirectory()) {
    throw oatsError("invalid-source", `${src} is not a regular file, directory or symlink (${st.isFIFO() ? "FIFO" : st.isSocket() ? "socket" : st.isBlockDevice() || st.isCharacterDevice() ? "device node" : "unsupported file type"}) — package and capability trees carry distributable content only`);
  }
  mkdirSync(dest, { recursive: true });
  for (const e of readdirSync(src, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    copyTreeSafe(join(src, e.name), join(dest, e.name));
  }
  chmodSync(dest, st.mode & 0o7777);
}

/** Stable integrity of a MATERIALIZED capability artifact: every byte under
 * `.agents/capabilities/installed/<id>/`, with NO exclusions — capability source,
 * the materialized runtime closure (node_modules), and the generated
 * `.oats-installation.json` provenance file all count. This is the only digest
 * executable trust binds to, which is why a separate dependency digest does not
 * exist at capability level: the closure is inside the artifact, so tampering
 * with a dependency is ordinary artifact drift. */
export function capabilityArtifactIntegrity(dir) {
  const hash = createHash("sha256");
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) { hash.update(relative(dir, p)); hash.update("\0file\0"); hash.update(readFileSync(p)); hash.update("\0"); }
      else if (e.isSymbolicLink()) { hash.update(relative(dir, p)); hash.update("\0symlink\0"); hash.update(readlinkSync(p)); hash.update("\0"); }
    }
  };
  walk(dir);
  return `sha256-${hash.digest("hex")}`;
}

/** Copy into same-filesystem staging, verify, then publish by rename.
 * The caller preflights the source/destination and owns existing-entry policy.
 * `verify` is synchronous and must throw on invalid copied or competing bytes;
 * this mechanical helper knows nothing about the kind of artifact or its lock.
 * A competing nonempty tree is reused only after verification. Normal errors
 * remove staging; crash recovery and power-loss durability are not promised. */
export function publishArtifactTree(sourceDir, dir, verify) {
  const staging = mkdtempSync(join(dirname(dir), ".staging-"));
  const tree = join(staging, "tree");
  try {
    copyTreeSafe(sourceDir, tree);
    verify(tree); // source may have changed during copy
    try { renameSync(tree, dir); }
    catch (e) {
      // Two preparers may publish the same bytes. Only accept the other result
      // after verifying it; unrelated filesystem errors retain their diagnosis.
      if (e.code !== "EEXIST" && e.code !== "ENOTEMPTY") throw e;
      verify(dir);
      return "kept";
    }
    return "retained";
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
