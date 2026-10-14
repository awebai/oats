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

/** Whether a process of the group `pgid` is left. Signal 0 asks and sends nothing. */
function groupLeft(pgid) {
  try { process.kill(-pgid, 0); return true; } catch (e) { if (e.code === "ESRCH") return false; throw e; }
}

/** The processes of the group `pgid`, one `pid pgid command` line each. */
function groupMembers(pgid) {
  return execFileSync("ps", ["-axww", "-o", "pid=,pgid=,command="], { encoding: "utf8" }).split("\n")
    .filter((line) => line.trim().split(/\s+/)[1] === String(pgid));
}

/** Kill `proc`, a process started with `startGroup`, and wait until it and everything it started
 *  have ended. Only `proc` is killed: the others are waited for, at most `wait` ms. A group that
 *  outlives the wait rejects with the processes that are left, by name. */
export async function closeGroup(proc, { wait = 30000 } = {}) {
  proc.kill();
  if (proc.exitCode === null && proc.signalCode === null) await new Promise((r) => proc.once("exit", r));
  for (const deadline = Date.now() + wait; groupLeft(proc.pid);) {
    if (Date.now() > deadline) {
      throw new Error(`the process ${proc.pid} was closed ${wait} ms ago and what it started still runs:\n${groupMembers(proc.pid).join("\n")}`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  forget(proc.pid);
}
