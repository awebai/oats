/** Synchronous scheduler child execution with an asynchronous timeout supervisor.
 * The tick and its lock callbacks stay synchronous; only the supervisor owns
 * the child, observes its exit and runs the TERM/KILL timers. Its stdout is a
 * private result channel, never the command's stdout. */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { TERM_GRACE_MS } from "./process-group.mjs";

const SUPERVISOR = fileURLToPath(new URL("./schedule-command-child.mjs", import.meta.url));
export function runScheduleCommand(file, args, { cwd, env, timeout = 300_000, graceMs = TERM_GRACE_MS, maxBuffer = 16 * 1024 * 1024 } = {}) {
  for (const [name, value] of Object.entries({ timeout, graceMs, maxBuffer })) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 2 ** 31 - 1) throw new TypeError(`${name} must be a positive 32-bit integer`);
  }
  const r = spawnSync(process.execPath, [SUPERVISOR], {
    cwd, env, encoding: "utf8", input: JSON.stringify({ file, args, timeout, graceMs, maxBuffer }),
    // Each output stream is byte-bounded. JSON can expand a byte to six bytes.
    maxBuffer: maxBuffer * 12 + 65536,
  });
  if (!r.error && r.status === 0) {
    try { return JSON.parse(r.stdout); } catch { /* no trusted supervisor receipt */ }
  }
  // A failed supervisor is not evidence that its command exited. The scheduler
  // conservatively retains the attempt and slot when there is no receipt.
  return { status: null, signal: null, stdout: "", stderr: String(r.stderr || ""),
    error: { code: r.error?.code || "E_SCHEDULE_RUNNER", message: r.error?.message || "schedule child supervisor returned no result" } };
}
