// One capture pass per record root at a time. Hook-triggered passes (one per
// agent event, across every live agent) used to overlap, each opening the
// multi-gigabyte search index; a second pass finding the lock exits at once
// and the next pass catches up, since reconciliation is idempotent.
//
// The lock is a DIRECTORY: mkdir is atomic and a directory is never
// observable half-created. The owner record (pid, nonce, start time, host)
// is written inside it after the mkdir. A live, unknowable or still
// initializing (owner-less) lock refuses the pass and names the holder and
// the operator recovery; it is never stolen.
//
// A lock whose recorded owner is DEAD on this host is reclaimed (a capture
// killed mid-pass by a hook or caller timeout runs no finally). Reclaimers
// are serialized by a guard, `<lock>.reclaim` (exclusive create): under it
// the owner record is read again and the lock removed only while it is still
// that dead owner's, so a reclaimer cannot remove a lock a live pass took
// meanwhile. A guard whose holder died is never removed (that would race
// exactly as removing the lock does); it is named with its recovery.
// Acquire never waits: it reclaims once or skips, and the next pass catches up.
// There is no signal handler: a pass is synchronous, so a JS handler would
// only run after the whole pass (turning a caller's timeout kill into a full
// pass), and SIGKILL cannot be handled; the reclaim is the recovery.
import { closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { join } from "node:path";

/** Whether an owner record that names no host is reclaimed when its pid is dead here. Such records come
 *  from kernels that did not record the host; until the operator's decision, they are left to the operator. */
export const RECLAIM_HOSTLESS_RECORDS = false;

export function captureLockPath(root) { return join(root, ".capture.lock"); }

/** "alive" | "dead" | "unknown" for an owner pid ("unknown" = exists but not signalable). */
export function holderLiveness(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return "unknown";
  try { process.kill(pid, 0); return "alive"; } catch (e) { return e.code === "EPERM" ? "unknown" : "dead"; }
}

const readJson = (path) => { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return undefined; } };
const readOwner = (dir) => readJson(join(dir, "owner.json"));

/** Whether `owner` is a record of this host whose process is dead: the only lock this module reclaims. */
function deadHere(owner, { host, liveness, reclaimHostless }) {
  if (!owner || !Number.isInteger(owner.pid)) return false;
  const here = owner.host === undefined ? reclaimHostless : owner.host === host;
  return here && liveness(owner.pid) === "dead";
}

/** Remove the lock `dir` held by the dead `owner`, serialized by the guard `<dir>.reclaim`. → { removed }
 *  (true only when THIS call removed it; otherwise it is left for the next pass), or { abandoned: { guard,
 *  pid } } when a reclaimer died holding the guard. */
function reclaimDeadLock(dir, owner, me, opts) {
  const guard = `${dir}.reclaim`;
  try { writeFileSync(guard, JSON.stringify(me), { flag: "wx", mode: 0o600 }); }
  catch (e) {
    if (e.code !== "EEXIST") return { removed: false };
    const g = readJson(guard);
    return g && deadHere(g, opts) ? { abandoned: { guard, pid: g.pid } } : { removed: false };
  }
  let removed = false;
  try {
    const now = readOwner(dir);
    if (now && now.pid === owner.pid && now.nonce === owner.nonce && now.startedAt === owner.startedAt && deadHere(now, opts)) {
      rmSync(dir, { recursive: true, force: true });
      removed = !existsSync(dir) || readOwner(dir)?.nonce !== owner.nonce;
    }
  } catch { /* the next pass */ }
  finally { if (readJson(guard)?.nonce === me.nonce) { try { unlinkSync(guard); } catch { /* gone */ } } }
  return { removed };
}

/** Single-quote shell escaping: safe to paste whatever the path contains. */
export function shellQuote(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }

/** The operator's recovery line for a lock that is not ours. */
export function recoveryInstruction(dir, owner, liveness) {
  const remove = `rm -r -- ${shellQuote(dir)}`;
  if (!owner?.pid) return `${dir} is held by a pass that has not written its owner record yet (initializing, or killed before it could); stop capture triggers (hooks, launchd), verify no capture process is running (pgrep -f capture.mjs), then remove the lock with: ${remove}  and rerun`;
  const who = `pid ${owner.pid} (started ${owner.startedAt || "?"}, now ${liveness})`;
  if (liveness === "alive") return `${dir} is held by ${who}; let it finish, the next pass catches up`;
  return `${dir} is held by ${who}; if that process is gone (ps -p ${owner.pid}), remove the lock with: ${remove}  and rerun`;
}

/** Try to take the root's capture lock. Returns { path, release, reclaimed? }
 *  when taken, or { path, held: { pid, startedAt, liveness, recovery, guard? },
 *  reclaimed? } when a lock is held. A lock it did not create is removed only
 *  when its recorded owner is dead on this host, under the reclaim guard (the
 *  header); `reclaimed: { pid, startedAt }` says THIS call removed it (whether
 *  or not it then won the lock), and `held.guard` names a guard a dead
 *  reclaimer left. Every other lock is left alone.
 *
 *  Two failure points are reported rather than left behind. If the owner
 *  record cannot be written after THIS call created the directory (a full
 *  disk, say), the directory is removed only while it is still the very
 *  directory this call created (same inode) and carries no other owner's
 *  record; a replacement that appeared meanwhile (operator recovery, then a
 *  newer pass) is left alone. The original error is rethrown with
 *  `lockCleanup: { path, removed, reason?, owner?, error?, recovery? }`
 *  saying what happened. And `release()` never throws: it answers
 *  `{ released: true }` only when the lock is verifiably gone, otherwise
 *  `{ released: false, reason: "gone" | "unknown-owner" | "not-owner" |
 *  "remove-failed", ... }` with the actual observation, never a guess.
 *
 *  The owner record carries a per-acquisition nonce, so a release kept from
 *  an earlier acquisition cannot erase a later one by the same pid (an
 *  operator recovery followed by a new pass in the same long-lived process).
 *
 *  `io` exists for fault injection in tests only. */
export function acquireCaptureLock(root, { now = Date.now, pid = process.pid, liveness = holderLiveness, host = hostname(), reclaimHostless = RECLAIM_HOSTLESS_RECORDS, io = {} } = {}) {
  const fs = { writeFileSync, rmSync, openSync, closeSync, lstatSync, ...io };
  const dir = captureLockPath(root);
  const nonce = randomBytes(8).toString("hex");
  mkdirSync(root, { recursive: true }); // the store creates the root lazily; the lock may come first
  let reclaimed;
  for (let attempt = 0; ; attempt++) {
    try { mkdirSync(dir); break; }
    catch (e) {
      if (e.code !== "EEXIST") throw e;
      const owner = readOwner(dir);
      const opts = { host, liveness, reclaimHostless };
      if (attempt === 0 && owner?.pid !== pid && deadHere(owner, opts)) {
        const r = reclaimDeadLock(dir, owner, { pid, nonce, host }, opts);
        if (r.abandoned) {
          const { guard, pid: reclaimer } = r.abandoned;
          return { path: dir, held: { pid: owner.pid, startedAt: owner.startedAt, liveness: "dead", guard,
            recovery: `${guard} was left by pid ${reclaimer}, which died while reclaiming ${dir}; once no capture process is running (pgrep -f capture.mjs), remove both with: rm -- ${shellQuote(guard)}; rm -r -- ${shellQuote(dir)}  and rerun` } };
        }
        if (r.removed) { reclaimed = { pid: owner.pid, startedAt: owner.startedAt }; continue; }
      }
      const now = readOwner(dir);
      const live = now ? (now.pid === pid ? "alive" : liveness(now.pid)) : "unknown";
      return { path: dir, ...(reclaimed ? { reclaimed } : {}), held: { pid: now?.pid, startedAt: now?.startedAt, liveness: live, recovery: recoveryInstruction(dir, now, live) } };
    }
  }
  let directoryFd, identity;
  try {
    // Keep the directory alive until initialization or its cleanup finishes.
    // Otherwise Linux can reuse its inode immediately after an unlink, making
    // a record-less replacement look like the directory we created.
    directoryFd = fs.openSync(dir, "r");
    identity = fstatSync(directoryFd);
    fs.writeFileSync(join(dir, "owner.json"), JSON.stringify({ pid, nonce, startedAt: new Date(now()).toISOString(), host }));
  } catch (err) {
    // Ownership was proven by the mkdir, not by the moment of cleanup: the
    // directory is removed only if it is still ours (same inode) and holds
    // no other pass's record. Anything else is reported, not deleted.
    let cleanupError, reason;
    const cur = readOwner(dir);
    const same = (() => { try { const current = lstatSync(dir); return identity && current.dev === identity.dev && current.ino === identity.ino; } catch { return false; } })();
    if (!existsSync(dir)) reason = "gone";
    else if (!identity) reason = "unverified";
    else if (!same || (cur && (cur.pid !== pid || cur.nonce !== nonce))) reason = "replaced";
    else { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e2) { cleanupError = e2; } }
    const removed = reason === undefined && !existsSync(dir);
    err.lockCleanup = {
      path: dir,
      removed,
      ...(reason ? { reason } : {}),
      ...(reason === "replaced" && cur ? { owner: cur } : {}),
      ...(cleanupError ? { error: cleanupError.message } : {}),
      ...(removed || reason === "gone" || reason === "replaced" ? {} : { recovery: recoveryInstruction(dir, undefined, "unknown") }),
    };
    throw err;
  } finally {
    if (directoryFd !== undefined) fs.closeSync(directoryFd);
  }
  return {
    path: dir,
    ...(reclaimed ? { reclaimed } : {}),
    release: () => {
      if (!existsSync(dir)) return { released: false, reason: "gone" };
      const cur = readOwner(dir);
      if (!cur) return { released: false, reason: "unknown-owner", recovery: recoveryInstruction(dir, undefined, "unknown") };
      if (cur.pid !== pid || cur.nonce !== nonce) return { released: false, reason: "not-owner", owner: cur };
      let error;
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { error = e; }
      let remains;
      try { fs.lstatSync(dir); remains = true; }
      catch (err) {
        if (err.code === "ENOENT") remains = false;
        else return { released: false, reason: "remove-failed", error: err.message,
          recovery: "could not verify capture lock removal; inspect the filesystem error and rerun capture" };
      }
      if (!remains) {
        // A removal may throw after changing the filesystem. Absence does
        // not erase that failure from a final-capture receipt.
        if (error) return { released: false, reason: "remove-failed", error: error.message,
          recovery: "the lock is now absent, but removal reported an error; inspect the failure and rerun capture" };
        return { released: true };
      }
      // Our own lock could not be removed. We are the holder and, as far as
      // this process can tell, alive; the operator gets a conditional line.
      const live = pid === process.pid ? "alive" : liveness(pid);
      const recovery = `${dir} is still held by pid ${pid} (this pass, ${live} when it reported this); its removal failed${error ? ` (${error.message})` : ""}; once that process has exited (ps -p ${pid}), remove the lock with: rm -r -- ${shellQuote(dir)}  and rerun`;
      return { released: false, reason: "remove-failed", liveness: live, ...(error ? { error: error.message } : {}), recovery };
    },
  };
}
