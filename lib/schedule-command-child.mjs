/** Private entry point for schedule-command.mjs; no CLI or provider contract.
 * stdin carries launch arguments, stdout carries the observed command result.
 * Command output has separate pipes so it cannot forge that result. */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { signalGroup } from "./process-group.mjs";

const { file, args, timeout, graceMs, maxBuffer } = JSON.parse(readFileSync(0, "utf8"));
const result = await new Promise((resolve) => {
  let child, status = null, signal = null, error;
  let exited = false, closed = false, stopping = false, hardEnd = false, settled = false;
  let deadline, escalation, probe, groupEmpty = false;
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
  const finish = () => {
    if (settled || (!closed && !hardEnd) || (!exited && child?.pid)) return;
    // A leader can close while a pipe-free descendant ignores TERM. Keep the
    // supervisor alive until the grace ends or its group is observed empty.
    if (stopping && !hardEnd && groupAlive()) return;
    settled = true;
    clearTimeout(deadline); clearTimeout(escalation); clearInterval(probe);
    resolve({ status, signal, stdout: Buffer.concat(chunks.stdout).toString("utf8"), stderr: Buffer.concat(chunks.stderr).toString("utf8"), ...(error ? { error } : {}) });
  };
  const stop = (cause) => {
    if (stopping || settled) return;
    stopping = true; error = cause;
    send("SIGTERM");
    escalation = setTimeout(() => {
      send("SIGKILL"); hardEnd = true;
      // A detached descendant can escape the group yet retain inherited pipes.
      // Its pipes must not prevent returning after the direct child's exit.
      child.stdout.destroy(); child.stderr.destroy();
      finish();
    }, graceMs);
    probe = setInterval(() => { if (closed) finish(); }, Math.min(50, graceMs));
  };
  try { child = spawn(file, args, { detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { error = { code: e.code, message: e.message }; closed = true; finish(); return; }
  for (const stream of ["stdout", "stderr"]) child[stream].on("data", (chunk) => {
    const room = maxBuffer - sizes[stream];
    if (room > 0) { const kept = chunk.subarray(0, room); chunks[stream].push(kept); sizes[stream] += kept.length; }
    if (chunk.length > room) stop({ code: "ENOBUFS", message: `schedule command ${stream} exceeded ${maxBuffer} bytes` });
  });
  child.once("error", (e) => { error ??= { code: e.code, message: e.message }; });
  child.once("exit", (code, sig) => { exited = true; status = code; signal = sig; finish(); });
  child.once("close", () => { closed = true; finish(); });
  deadline = setTimeout(() => stop({ code: "ETIMEDOUT", message: `schedule command exceeded ${timeout} ms` }), timeout);
});
process.stdout.write(JSON.stringify(result));
