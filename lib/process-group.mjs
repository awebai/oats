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
