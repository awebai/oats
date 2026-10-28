/** writeFileAtomic: a file written through a temporary sibling and renamed over it. A leaf
 *  (awebai/oats#1630): deployments.mjs writes this computer's list with it without loading packages.mjs
 *  and the remote reader, and packages.mjs re-exports it. Node built-ins only. */
import { mkdirSync, writeFileSync, rmSync, openSync, fchmodSync, closeSync, renameSync } from "node:fs";
import { dirname, join, basename } from "node:path";

/** Sibling temp + rename: replaces the directory entry itself, never writing
 * THROUGH a pre-planted symlink at `file`. The new file's permission bits are the process's default
 * (its umask) unless `mode` gives them: then they are exactly `mode`, and in force before a byte of
 * `contents` is written, so a file kept private is never readable by others on the way. */
export function writeFileAtomic(file, contents, { mode } = {}) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = join(dirname(file), `.${basename(file)}.oats-tmp-${process.pid}`);
  try {
    if (mode === undefined) writeFileSync(tmp, contents);
    else {
      // A new file (one left by a killed process of this pid goes first; "wx" opens nothing that is
      // there), created with no more than `mode` (the umask only takes bits away), then set to it exactly.
      rmSync(tmp, { force: true });
      const fd = openSync(tmp, "wx", mode);
      try { fchmodSync(fd, mode); writeFileSync(fd, contents); } finally { closeSync(fd); }
    }
    renameSync(tmp, file);
  } finally {
    // A failed removal is not answered: when the write or the rename failed, that error is (#1076).
    try { rmSync(tmp, { force: true }); } catch { /* the first error is the one answered */ }
  }
}
