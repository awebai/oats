/** Private entry point for schedule-command.mjs; no CLI or provider contract.
 * stdin carries launch arguments, stdout carries the observed command result.
 * Command output has separate pipes so it cannot forge that result. */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { signalGroup } from "./process-group.mjs";

const { file, args, timeout, graceMs, maxBuffer } = JSON.parse(readFileSync(0, "utf8"));
const result = await new Promise((resolve) => {
  let child, status = null, signal = null, error;
  let exited = false, closed = false, stopping = false, hardEnd = false, settled = false, termSent = false;
  let deadline, escalation, probe, groupEmpty = false;
  const signalHandlers = new Map();
  const chunks = { stdout: [], stderr: [] }, sizes = { stdout: 0, stderr: 0 };
  const groupAlive = () => {
    if (groupEmpty || !child?.pid) return false;
    if (process.platform === "win32") return !exited;
    try { process.kill(-child.pid, 0); return true; }
    catch { groupEmpty = true; return false; }
  };
  const send = (sig) => {
    if (process.platform === "win32") { if (!exited) child.kill(sig); }
    else if (groupAlive()) signalGroup(child, sig);
  };
  const requestTerm = () => {
    if (termSent || !child?.pid) return;
    termSent = true;
    send("SIGTERM");
  };
  const finish = () => {
    if (settled || (!closed && !hardEnd) || (!exited && child?.pid)) return;
    // A leader can close while a pipe-free descendant ignores TERM. Keep the
    // supervisor alive until the grace ends or its group is observed empty.
    if (stopping && !hardEnd && groupAlive()) return;
    settled = true;
    clearTimeout(deadline); clearTimeout(escalation); clearInterval(probe);
    for (const [sig, handler] of signalHandlers) process.off(sig, handler);
    resolve({ status, signal, stdout: Buffer.concat(chunks.stdout).toString("utf8"), stderr: Buffer.concat(chunks.stderr).toString("utf8"), ...(error ? { error } : {}) });
  };
  const watchGroup = () => {
    probe ??= setInterval(() => { groupAlive(); finish(); }, Math.min(50, graceMs));
  };
  const stop = (cause) => {
    if (stopping || settled) return;
    stopping = true; error ??= cause;
    requestTerm();
    escalation = setTimeout(() => {
      send("SIGKILL"); hardEnd = true;
      // A detached descendant can escape the group yet retain inherited pipes.
      // Its pipes must not prevent returning after the direct child's exit.
      child?.stdout?.destroy(); child?.stderr?.destroy();
      finish();
    }, graceMs);
    watchGroup();
  };
  // Catchable supervisor shutdown owns the same cleanup as timeout/overflow.
  // Keep handlers throughout cleanup: repeated signals cannot bypass it.
  // SIGKILL/OOM cannot run this path; a missing receipt stays unconfirmed.
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    const handler = () => stop({ code: "EINTR", message: `schedule command supervisor interrupted by ${sig}` });
    signalHandlers.set(sig, handler);
    process.on(sig, handler);
  }
  try { child = spawn(file, args, { detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { error ??= { code: e.code, message: e.message }; closed = true; finish(); return; }
  for (const stream of ["stdout", "stderr"]) child[stream].on("data", (chunk) => {
    const room = maxBuffer - sizes[stream];
    if (room > 0) { const kept = chunk.subarray(0, room); chunks[stream].push(kept); sizes[stream] += kept.length; }
    if (chunk.length > room) stop({ code: "ENOBUFS", message: `schedule command ${stream} exceeded ${maxBuffer} bytes` });
  });
  child.once("error", (e) => { error ??= { code: e.code, message: e.message }; });
  child.once("exit", (code, sig) => {
    exited = true; status = code; signal = sig;
    // Do not wait for pipes or the deadline: an escaped session may hold pipes
    // after this group empties. Once observed empty it is never signalled again.
    if (groupAlive()) watchGroup();
    finish();
  });
  child.once("close", () => { closed = true; finish(); });
  if (stopping) requestTerm(); // Shutdown may have begun while spawn returned.
  deadline = setTimeout(() => stop({ code: "ETIMEDOUT", message: `schedule command exceeded ${timeout} ms` }), timeout);
});
process.stdout.write(JSON.stringify(result));
