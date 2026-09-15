/** Tree mechanics only. No acquisition, selection, trust, lock or lifecycle
 * policy. Callers supply the verifier used during publication. */
import {
  chmodSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, readlinkSync, renameSync, rmdirSync, rmSync, symlinkSync,
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

// ONLY for this preparer's unpublished staging, never source/destination trees.
// copyTreeSafe preserves read-only directories after copying their children; rm's
// force option does not make those directories removable. Restore owner access
// top-down, using lstat at every entry so even directory symlinks stay untouched.
// Files need no chmod to unlink them. Successful publication transfers the whole
// staging root to the destination; the caller must not clean that root afterwards.
export function removeOwnedStaging(staging) {
  const makeRemovable = (path) => {
    let st;
    try { st = lstatSync(path); }
    catch (error) { if (error.code === "ENOENT") return; throw error; }
    if (!st.isDirectory()) return;
    if ((st.mode & 0o700) !== 0o700) chmodSync(path, (st.mode & 0o7777) | 0o700);
    for (const name of readdirSync(path)) makeRemovable(join(path, name));
  };
  makeRemovable(staging);
  rmSync(staging, { recursive: true, force: true });
}

/** Copy into same-parent staging, verify, then publish by rename.
 * The staged root is a sibling of the destination: Darwin can refuse moving a
 * read-only directory between parents even when both parents are writable. A
 * sibling rename preserves the copied root's mode without rewriting its `..`.
 * The caller preflights the source/destination and owns existing-entry policy.
 * `verify` is synchronous and must throw on invalid copied or competing bytes;
 * this mechanical helper knows nothing about the kind of artifact or its lock.
 * A competing nonempty tree is reused only after verification. Rename is NOT a
 * general no-replace primitive: an empty destination appearing after caller
 * preflight can be replaced. Normal errors remove owned staging; cleanup failure
 * throws with its stagingPath, preserving the primary code/provenance and cause
 * in an AggregateError when both fail. No success receipt hides failed cleanup.
 * Hostile concurrent mutation, crash recovery and power-loss durability are not
 * promised. */
export function publishArtifactTree(sourceDir, dir, verify) {
  const staging = mkdtempSync(join(dirname(dir), ".staging-"));
  const tree = staging;
  let failed = false, published = false, primary;
  try {
    // Preserve mechanical copy semantics for file/link roots too; retention's
    // verifier owns the directory/containment policy. Only remove our empty slot.
    if (!lstatSync(sourceDir).isDirectory()) rmdirSync(tree);
    copyTreeSafe(sourceDir, tree);
    verify(tree); // source may have changed during copy
    try { renameSync(tree, dir); }
    catch (e) {
      // Darwin may report EACCES rather than ENOTEMPTY for a read-only winner.
      // Permission denial alone proves nothing: require an observed destination,
      // then let the caller verify its exact bytes, shape and provenance. If it
      // is absent, preserve the original denial; damage is never repaired.
      if (e.code === "EACCES") {
        try { lstatSync(dir); }
        catch (lookup) { if (lookup.code === "ENOENT") throw e; throw lookup; }
      } else if (e.code !== "EEXIST" && e.code !== "ENOTEMPTY") throw e;
      verify(dir);
      return "kept";
    }
    published = true;
    return "retained";
  } catch (error) {
    failed = true;
    primary = error;
    throw error;
  } finally {
    try { if (!published) removeOwnedStaging(staging); }
    catch (cleanup) {
      const diagnostic = `artifact staging cleanup failed at ${staging}: ${cleanup?.message ?? cleanup}`;
      const error = failed
        ? new AggregateError([primary, cleanup], `${primary?.message ?? primary}; ${diagnostic}`, { cause: primary })
        : new Error(diagnostic, { cause: cleanup });
      error.code = failed ? primary?.code : cleanup?.code;
      if (failed && primary?.provenance !== undefined) error.provenance = primary.provenance;
      error.stagingPath = staging;
      throw error;
    }
  }
}
