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

/** Children whose 'close' has fired (watchGroup): the leader exited and was reaped, its stdio pipes shut. */
const closedGroups = new WeakSet();

/** Record a detached child's 'close': call it right after spawning a child that terminateGroup may end. → the child. */
export function watchGroup(child) {
  child.once("close", () => closedGroups.add(child));
  return child;
}

/** How often terminateGroup checks, after the leader's 'close', whether its group is empty yet. */
export const GROUP_PROBE_MS = 50;

/** Whether a detached child's process group still has a member we may signal (ESRCH: empty; EPERM: not ours). */
function groupAlive(child) {
  try { process.kill(-child.pid, 0); return true; } catch { return false; }
}

/** End a detached child's whole process group gracefully: SIGTERM now, SIGKILL to the group after `graceMs`.
 *  git removes its own lock files (`shallow.lock`, `config.lock`, a ref's `.lock`) on SIGTERM, never on SIGKILL:
 *  a git killed outright leaves a lock that blocks every later write. The timers are unref'd, so they never keep
 *  the process alive. A group seen empty is never signalled again: its id may then lead an unrelated group.
 *  Returns whether anything was signalled. */
export function terminateGroup(child, graceMs = TERM_GRACE_MS) {
  // A child already closed may have left an empty group, whose id is free: send nothing.
  if (closedGroups.has(child)) return false;
  if (!signalGroup(child, "SIGTERM")) return false;
  // Until 'close', the group holds a pipe-holding member (git, or its ssh or remote helper), so its id is ours and
  // the SIGKILL may come. After 'close' the leader is gone but a member that ignores SIGTERM and holds no pipe may
  // remain: no pid is allocated while it is a live group's id, so a group seen non-empty is still ours. It is probed
  // until the grace ends: empty → no SIGKILL, ever; still there → SIGKILL. What remains is a group that empties and is
  // reused within one GROUP_PROBE_MS.
  let probe = null;
  const done = () => { clearTimeout(timer); clearInterval(probe); };
  const timer = setTimeout(() => { clearInterval(probe); signalGroup(child, "SIGKILL"); }, graceMs);
  timer.unref?.();
  child.once?.("close", () => {
    if (!groupAlive(child)) { done(); return; }
    probe = setInterval(() => { if (!groupAlive(child)) done(); }, GROUP_PROBE_MS);
    probe.unref?.();
  });
  return true;
}

/** SIGKILL a detached child's process group if, and only if, it still has a member: its leader may have exited
 *  (its 'close' fired) and left a descendant behind. A group seen empty is never signalled: its id may lead an
 *  unrelated group. → whether anything was signalled. */
export function killGroupIfPopulated(child, signal = "SIGKILL") {
  const pid = child?.pid;
  if (!Number.isSafeInteger(pid) || pid <= 0 || !groupAlive(child)) return false;
  return signalGroup(child, signal);
}

/** Signal a detached child's process group only (see killGroup for the pid-0 guard). → whether it was a real child. */
export function signalGroup(child, signal) {
  const pid = child?.pid;
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(-pid, signal); } catch { /* the group is gone */ }
  return true;
}
