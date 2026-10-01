/** Kill a detached child's whole process group (e.g. git + its remote helper /
 *  ssh, or a harness probe + what it forked). ONLY for a child that was actually
 *  spawned: a failed spawn (ENOENT) reports `pid: 0`, and `process.kill(-0)` /
 *  `process.kill(0)` address the CALLER's own process group — the operator's
 *  shell, tmux session or Desktop backend. Returns whether anything was signalled. */
export function killGroup(child, signal = "SIGKILL") {
  const pid = child?.pid;
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(-pid, signal); } catch { /* already gone */ }
  try { process.kill(pid, signal); } catch { /* already gone */ }
  return true;
}

/** How long a group asked to end with SIGTERM gets before SIGKILL. */
export const TERM_GRACE_MS = 2_000;

/** End a detached child's whole process group gracefully: SIGTERM now, SIGKILL to the group after `graceMs`. git removes its own lock files (`shallow.lock`, `config.lock`, a ref's `.lock`) on
 *  SIGTERM, never on SIGKILL: a git killed outright leaves a lock that blocks every later write. The SIGKILL
 *  timer is unref'd, so it never keeps the process alive; a process that exits sooner leaves the group with
 *  its SIGTERM only. Returns whether anything was signalled. */
export function terminateGroup(child, graceMs = TERM_GRACE_MS) {
  if (!signalGroup(child, "SIGTERM")) return false;
  // The GROUP is killed after the grace whether or not its leader is gone: a descendant (ssh, a remote helper)
  // may survive SIGTERM after git exits. Only the group id is targeted, never the leader's own pid, which may
  // be reused once the leader is reaped; a group id is not reused while any member lives.
  const timer = setTimeout(() => signalGroup(child, "SIGKILL"), graceMs);
  timer.unref?.();
  return true;
}

/** Signal a detached child's process group only (see killGroup for the pid-0 guard). → whether it was a real child. */
export function signalGroup(child, signal) {
  const pid = child?.pid;
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(-pid, signal); } catch { /* the group is gone */ }
  return true;
}
