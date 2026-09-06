// One capture pass per record root at a time. Hook-triggered passes (one per
// agent event, across every live agent) used to overlap, each opening the
// multi-gigabyte search index; a second pass finding the lock exits at once
// and the next pass catches up, since reconciliation is idempotent.
//
// The lock is a DIRECTORY: mkdir is atomic on every filesystem this runs on
// and a directory is never observable half-created, unlike a file whose
// contents arrive after the open. The owner record (pid, start time) is
// written inside it after the mkdir; a contender that sees the directory
// but no record yet treats the lock as held (the owner is initializing).
// Reclaiming a dead holder's lock is an atomic rename of the directory to a
// unique name, so two reclaimers cannot both "win": the one whose rename
// fails simply retries the mkdir. A holder is never stolen while its pid
// is alive, whatever its age; a same-pid or unknowable (EPERM) holder is
// treated as live.
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CAPTURE_LOCK_INIT_GRACE_MS = 60 * 1000;
export function captureLockPath(root) { return join(root, ".capture.lock"); }

/** true = alive, false = dead, "unknown" = exists but not signalable (EPERM). */
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM" ? "unknown" : false; }
}

function readOwner(dir) {
  try { return JSON.parse(readFileSync(join(dir, "owner.json"), "utf8")); } catch { return undefined; }
}

/** Try to take the root's capture lock. Returns { release } when taken, or
 *  { held: { pid, startedAt } } while a live process holds it. Only a holder
 *  whose pid is known to be dead (or a lock left without an owner record for
 *  longer than the initialization grace) is reclaimed. */
export function acquireCaptureLock(root, { now = Date.now, pid = process.pid, alive = pidAlive, initGraceMs = CAPTURE_LOCK_INIT_GRACE_MS } = {}) {
  const dir = captureLockPath(root);
  mkdirSync(root, { recursive: true }); // the store creates the root lazily; the lock may come first
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      mkdirSync(dir);
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      const owner = readOwner(dir);
      if (!owner) {
        // No record yet: the owner is initializing, or died between mkdir and
        // write. Only a record-less lock older than the grace is reclaimed.
        let age = 0;
        try { age = now() - statSync(dir).mtimeMs; } catch { continue; } // vanished: retry
        if (age < initGraceMs) return { path: dir, held: { pid: undefined, startedAt: undefined } };
      } else {
        const liveness = Number.isInteger(owner.pid) && owner.pid !== pid ? alive(owner.pid) : (owner.pid === pid ? true : false);
        if (liveness === true || liveness === "unknown") return { path: dir, held: { pid: owner.pid, startedAt: owner.startedAt } };
      }
      // Dead holder: reclaim atomically. A failed rename means another
      // contender reclaimed it first; retry the mkdir.
      const grave = `${dir}.dead-${process.pid}-${now()}-${attempt}`;
      try { renameSync(dir, grave); } catch { continue; }
      try { rmSync(grave, { recursive: true, force: true }); } catch { /* best effort */ }
      continue;
    }
    writeFileSync(join(dir, "owner.json"), JSON.stringify({ pid, startedAt: new Date(now()).toISOString() }));
    return {
      path: dir,
      release: () => {
        // Remove only a lock this pid owns; a reclaimed-and-replaced lock is left alone.
        const cur = readOwner(dir);
        if (cur && cur.pid === pid) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* already gone */ } }
      },
    };
  }
  return { path: dir, held: { pid: undefined, startedAt: undefined } };
}
