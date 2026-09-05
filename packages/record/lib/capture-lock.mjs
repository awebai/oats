// One capture pass per record root at a time. Hook-triggered passes (one per
// agent event, across every live agent) used to overlap, each opening the
// multi-gigabyte search index; a second pass finding the lock exits at once
// and the next pass catches up, since reconciliation is idempotent.
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";

export const CAPTURE_LOCK_STALE_MS = 15 * 60 * 1000;
export function captureLockPath(root) { return join(root, ".capture.lock"); }

/** true = alive, false = dead, "unknown" = exists but not signalable (EPERM). */
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM" ? "unknown" : false; }
}

/** Try to take the root's capture lock. Returns { release } when taken, or
 *  { held: { pid, startedAt } } while a LIVE process holds it, however long
 *  it has run: a long index pass is exactly what must not be doubled. Only a
 *  lock whose holder is dead (or unreadable) is reclaimed; staleMs applies
 *  solely when the holder's liveness cannot be established. */
export function acquireCaptureLock(root, { staleMs = CAPTURE_LOCK_STALE_MS, now = Date.now, pid = process.pid, alive = pidAlive } = {}) {
  const path = captureLockPath(root);
  mkdirSync(root, { recursive: true }); // the store creates the root lazily; the lock may come first
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, "wx");
      writeSync(fd, JSON.stringify({ pid, startedAt: new Date(now()).toISOString() }));
      closeSync(fd);
      return { path, release: () => { try { const cur = JSON.parse(readFileSync(path, "utf8")); if (cur.pid === pid) unlinkSync(path); } catch { /* already gone */ } } };
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      let cur;
      try { cur = JSON.parse(readFileSync(path, "utf8")); } catch { cur = null; }
      const liveness = cur && Number.isInteger(cur.pid) && cur.pid !== pid ? alive(cur.pid) : false;
      const started = cur && Date.parse(cur.startedAt);
      const fresh = Number.isFinite(started) && now() - started < staleMs;
      if (liveness === true) return { path, held: { pid: cur.pid, startedAt: cur.startedAt } };
      if (liveness === "unknown" && fresh) return { path, held: { pid: cur.pid, startedAt: cur.startedAt } };
      // Dead holder, unreadable file, an unknowable holder past staleMs, or our own pid: reclaim.
      try { unlinkSync(path); } catch { /* raced with the holder's release */ }
    }
  }
  return { path, held: { pid: undefined, startedAt: undefined } };
}
