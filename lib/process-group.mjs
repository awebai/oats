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

/** Children whose 'close' has fired (watchGroup): the leader exited and every descendant holding its stdio
 *  pipes (git's ssh, a remote helper) is gone, so their group id may already belong to someone else. */
const closedGroups = new WeakSet();

/** Record when a detached child's group is provably gone: call it right after spawning a child that
 *  terminateGroup may end. → the child. */
export function watchGroup(child) {
  child.once("close", () => closedGroups.add(child));
  return child;
}

/** End a detached child's whole process group gracefully: SIGTERM now, SIGKILL to the group after `graceMs`.
 *  git removes its own lock files (`shallow.lock`, `config.lock`, a ref's `.lock`) on SIGTERM, never on SIGKILL:
 *  a git killed outright leaves a lock that blocks every later write. The SIGKILL timer is unref'd, so it never
 *  keeps the process alive. A child already closed (watchGroup) gets no signal at all; one that closes within the
 *  grace gets no SIGKILL. Returns whether anything was signalled. */
export function terminateGroup(child, graceMs = TERM_GRACE_MS) {
  // Once every member has exited, the group id is free for an unrelated process to lead: never signal it then.
  if (closedGroups.has(child)) return false;
  if (!signalGroup(child, "SIGTERM")) return false;
  // Until 'close', the GROUP is killed after the grace even when its leader is gone: a descendant (ssh, a remote
  // helper) that survives SIGTERM still holds git's pipes, so it keeps 'close' from firing and the group id from
  // being reused. Only the group id is targeted, never the leader's own pid, which may be reused once reaped.
  const timer = setTimeout(() => signalGroup(child, "SIGKILL"), graceMs);
  timer.unref?.();
  child.once?.("close", () => clearTimeout(timer));
  return true;
}

/** Signal a detached child's process group only (see killGroup for the pid-0 guard). → whether it was a real child. */
export function signalGroup(child, signal) {
  const pid = child?.pid;
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(-pid, signal); } catch { /* the group is gone */ }
  return true;
}
