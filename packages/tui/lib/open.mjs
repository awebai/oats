// Opening an agent's terminal: the one child of the TUI that is not a read. It is the kernel's own
// viewer (`oats session attach … --detach-key <key>`), whose arguments the shared home builds
// (client.mjs sessionAttachArgv, prepareRemoteTerm): nothing here names an argument, a tmux
// server or an exit status. The TUI builds no viewer and runs no tmux command.
//
// UNLIKE EVERY READ (lib/read.mjs), THE VIEWER IS NOT STARTED IN A SESSION OF ITS OWN. It needs
// the terminal as its controlling terminal and must be in the foreground process group, so the
// terminal's signals reach it as they reach the TUI. It is the loop's child, never the reader's:
// the reader ends only the reads it started, and nothing of its clean-up can reach a viewer.
import { spawn as nodeSpawn } from "node:child_process";

/** The most of the viewer's stderr that is kept, in bytes: the last ones. */
export const STDERR_KEPT = 4096;

/** Start the viewer: `node <bin> <args…>` with stdin and stdout on the terminal (inherited) and
 *  stderr on a pipe; no shell, the TUI's own environment (the instance variables were removed at
 *  the start; the kernel's viewer drops TMUX for its own child). Answers `{ closed, end, release }`:
 *  `closed` resolves once the child has closed, never rejects, with `{ status, stderr }`: `status`
 *  the exit status as Node reports it (null when a signal ended it, or when it did not start),
 *  `stderr` the last STDERR_KEPT bytes it printed, as text. `end()` asks it to end (SIGTERM to the
 *  child alone: the kernel closes its viewer on it); after it has closed, end() does nothing.
 *  `release()` lets go of a viewer that did not end when asked: its stderr pipe is destroyed and
 *  its handle no longer holds the process, which can then exit while the viewer lives on. */
export function startViewer(bin, args, { env = process.env, spawn = nodeSpawn } = {}) {
  let child, over = false;
  const closed = new Promise((resolve) => {
    let kept = Buffer.alloc(0);
    const done = (status) => { if (!over) { over = true; resolve({ status, stderr: kept.toString("utf8") }); } };
    try {
      child = spawn(process.execPath, [bin, ...args], { stdio: ["inherit", "inherit", "pipe"], env, shell: false });
    } catch { return done(null); }
    child.stderr?.on("error", () => {});
    child.stderr?.on("data", (chunk) => {
      kept = Buffer.concat([kept, chunk]);
      if (kept.length > STDERR_KEPT) kept = kept.subarray(kept.length - STDERR_KEPT);
    });
    child.on("error", () => { if (!child.pid) done(null); });
    child.once("close", (code) => done(Number.isInteger(code) ? code : null));
  });
  return {
    closed,
    end() { if (!over && child) { try { child.kill("SIGTERM"); } catch { /* gone */ } } },
    release() { if (!over && child) { child.stderr?.destroy(); child.unref(); } },
  };
}
