// Starting and ending a process of a test that starts processes of its own, so that the test can
// remove what they work in.
//
// A test that kills such a process ends only that one: a child it had just started goes on by
// itself, and writes where it was told to after its parent has gone. It cannot be asked for, either:
// a child started as the kill arrives has not run a line yet, so it has announced itself nowhere.
// What does hold every one of them is the process group. `startGroup` starts the process as the
// leader of a group of its own, and whatever it starts stays in that group unless it leaves on
// purpose (a daemon does; a command run for its output does not). `closeGroup` waits for the group.
import { execFileSync, spawn } from "node:child_process";

/** The groups this process has started and not seen empty yet, each by its leader's process id. */
const groups = new Set();

// A group of its own is in no terminal's foreground, so an interrupt of this process does not reach
// it. This process passes it on: every group it started is killed, whole (the run is being
// abandoned), and then the signal does what it would have done, since the listener is gone by then
// and the signal is raised again. A process killed with SIGKILL passes nothing on.
const INTERRUPTS = ["SIGINT", "SIGTERM", "SIGHUP"];
function onInterrupt(signal) {
  for (const pgid of groups) { try { process.kill(-pgid, "SIGKILL"); } catch { /* the group has ended */ } }
  forget(...groups);
  process.kill(process.pid, signal);
}
/** Take groups that have ended off the record; with the last one, this process listens no more. */
function forget(...pgids) {
  for (const pgid of pgids) groups.delete(pgid);
  if (!groups.size) for (const signal of INTERRUPTS) process.removeListener(signal, onInterrupt);
}

/** Start `command` as `spawn` does, as the leader of a process group of its own. End it with
 *  `closeGroup`. */
export function startGroup(command, args, options = {}) {
  const proc = spawn(command, args, { ...options, detached: true });
  if (proc.pid === undefined) return proc; // it did not start: its "error" event says why
  if (!groups.size) for (const signal of INTERRUPTS) process.prependListener(signal, onInterrupt);
  groups.add(proc.pid);
  return proc;
}

/** Whether a process of the group `pgid` is left. Signal 0 asks and sends nothing. A process that has
 *  ended and is not collected yet is still one: Linux answers for it, macOS refuses (EPERM). */
function groupLeft(pgid) {
  try { process.kill(-pgid, 0); return true; } catch (e) { if (e.code === "ESRCH") return false; if (e.code === "EPERM") return true; throw e; }
}

/** The processes of the group `pgid`, one `pid pgid command` line each. */
function groupMembers(pgid) {
  return execFileSync("ps", ["-axww", "-o", "pid=,pgid=,command="], { encoding: "utf8" }).split("\n")
    .filter((line) => line.trim().split(/\s+/)[1] === String(pgid));
}

/** Kill `proc`, a process started with `startGroup`, and wait until its group has ended: `proc` itself
 *  and everything it started. Only `proc` is killed: the others are waited for. The close takes `wait`
 *  ms at most, from its start; a group that outlives it rejects with every process that is left, `proc`
 *  among them if it still runs, by name. */
export async function closeGroup(proc, { wait = 30000 } = {}) {
  if (proc.pid === undefined) return; // it never started
  const deadline = Date.now() + wait;
  proc.kill();
  // `proc` is of its group until it is collected, and collecting it sets its exit code or signal: the
  // group alone is waited for.
  while (groupLeft(proc.pid)) {
    if (Date.now() > deadline) {
      throw new Error(`the process ${proc.pid} was closed ${wait} ms ago and its group still runs:\n${groupMembers(proc.pid).join("\n")}`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  forget(proc.pid);
}
