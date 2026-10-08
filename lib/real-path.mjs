// The real path of a location that may not exist yet, in the caller's spelling or the one on disk.
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/** realpath of `p`, or — when `p` does not exist yet — the realpath of its
 * nearest existing ancestor with the remaining segments re-appended. Any path
 * decision about WHERE something will be created has to go through this: a
 * lexical path says nothing about the destination once a symlink sits anywhere
 * along it. */
export function realPathOrNearest(p) {
  return nearestRealPath(p, realpathSync);
}
/** realPathOrNearest with the operating system's realpath: the one spelling of a path. On a
 * case-insensitive filesystem (APFS, the macOS default) JS realpathSync keeps the caller's
 * letter case, so `.../agents/x` and `.../Agents/x` (one directory) come back as two strings;
 * realpathSync.native returns each existing component as it is on disk. On a case-sensitive
 * filesystem the two agree: two spellings are two directories, and this changes nothing. (On
 * APFS it can also return a name's on-disk Unicode normalization.) */
export function canonicalHomePath(p) {
  return nearestRealPath(p, realpathSync.native);
}
function nearestRealPath(p, realpath) {
  try { return realpath(p); } catch { /* not created yet — resolve what exists */ }
  let d = resolve(p); const tail = [];
  while (!existsSync(d) && dirname(d) !== d) { tail.unshift(basename(d)); d = dirname(d); }
  try { return join(realpath(d), ...tail); } catch { return resolve(p); }
}
