// One capture pass per record root at a time. Hook-triggered passes (one per
// agent event, across every live agent) used to overlap, each opening the
// multi-gigabyte search index; a second pass finding the lock exits at once
// and the next pass catches up, since reconciliation is idempotent.
//
// The lock is a DIRECTORY: mkdir is atomic and a directory is never
// observable half-created. The owner record (pid, start time) is written
// inside it after the mkdir. Nothing here ever steals a lock: any existing
// lock, live, dead, unknowable or still initializing, refuses the pass and
// names the holder and the operator recovery. A stale lock after a killed
// pass is removed by the operator once the pid is verified gone; the
// message says exactly that. (A reclaim protocol was reviewed and rejected:
// rename is not compare-and-swap, and stealing from a stalled live
// initializer under memory pressure is the failure we are preventing.)
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

export function captureLockPath(root) { return join(root, ".capture.lock"); }

/** "alive" | "dead" | "unknown" for an owner pid ("unknown" = exists but not signalable). */
export function holderLiveness(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return "unknown";
  try { process.kill(pid, 0); return "alive"; } catch (e) { return e.code === "EPERM" ? "unknown" : "dead"; }
}

function readOwner(dir) {
  try { return JSON.parse(readFileSync(join(dir, "owner.json"), "utf8")); } catch { return undefined; }
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

/** Try to take the root's capture lock. Returns { path, release } when
 *  taken, or { path, held: { pid, startedAt, liveness, recovery } } when any
 *  lock exists. Never removes a lock it did not create.
 *
 *  Two failure points are reported rather than left behind. If the owner
 *  record cannot be written after THIS call created the directory (a full
 *  disk, say), the directory is this call's own initialization and nothing
 *  else can own it, so it is removed and the original error rethrown with
 *  `lockCleanup: { path, removed, error?, recovery? }` saying whether that
 *  removal happened. And `release()` never throws: it answers
 *  `{ released: true }` only when the lock is verifiably gone, otherwise
 *  `{ released: false, reason: "not-owner" | "remove-failed", ... }`.
 *
 *  The owner record carries a per-acquisition nonce, so a release kept from
 *  an earlier acquisition cannot erase a later one by the same pid (an
 *  operator recovery followed by a new pass in the same long-lived process).
 *  That is ownership checking; no lock is ever reclaimed.
 *
 *  `io` exists for fault injection in tests only. */
export function acquireCaptureLock(root, { now = Date.now, pid = process.pid, liveness = holderLiveness, io = {} } = {}) {
  const fs = { writeFileSync, rmSync, ...io };
  const dir = captureLockPath(root);
  mkdirSync(root, { recursive: true }); // the store creates the root lazily; the lock may come first
  try {
    mkdirSync(dir);
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    const owner = readOwner(dir);
    const live = owner ? (owner.pid === pid ? "alive" : liveness(owner.pid)) : "unknown";
    return { path: dir, held: { pid: owner?.pid, startedAt: owner?.startedAt, liveness: live, recovery: recoveryInstruction(dir, owner, live) } };
  }
  const nonce = randomBytes(8).toString("hex");
  try {
    fs.writeFileSync(join(dir, "owner.json"), JSON.stringify({ pid, nonce, startedAt: new Date(now()).toISOString() }));
  } catch (err) {
    let cleanupError;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e2) { cleanupError = e2; }
    const removed = !existsSync(dir);
    err.lockCleanup = {
      path: dir,
      removed,
      ...(cleanupError ? { error: cleanupError.message } : {}),
      ...(removed ? {} : { recovery: recoveryInstruction(dir, undefined, "unknown") }),
    };
    throw err;
  }
  return {
    path: dir,
    release: () => {
      const cur = readOwner(dir);
      if (!cur || cur.pid !== pid || cur.nonce !== nonce) {
        return { released: false, reason: "not-owner", owner: cur };
      }
      let error;
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { error = e; }
      if (!existsSync(dir)) return { released: true };
      return { released: false, reason: "remove-failed", ...(error ? { error: error.message } : {}), recovery: recoveryInstruction(dir, cur, "dead") };
    },
  };
}
