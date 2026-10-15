// Private process transport, separate from reconciliation and status writing.
// The caller supplies the package worker entry; no shell, inherited execArgv,
// or caller-controlled NODE_OPTIONS can override its fixed heap policy.
import { spawn } from "node:child_process";
import { CAPTURE_POLICY } from "./capture-budget.mjs";
import { acquireCaptureLock } from "./capture-lock.mjs";

// hrtime uses the same monotonic origin in both local processes. Startup and
// lock publication consume this budget; the child never starts a new 300s clock.
export const captureMonotonicMs = () => Number(process.hrtime.bigint() / 1000000n);
export function captureWorkerEnvironment(env = process.env) {
  const out = {};
  for (const key of ["HOME", "PATH", "TMPDIR", "TMP", "TEMP", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "LANG", "LC_ALL", "TZ", "USERPROFILE", "SYSTEMROOT"])
    if (env[key] !== undefined) out[key] = env[key];
  return out;
}

const outcomes = new Set(["complete", "partial", "failed"]);
const reasons = new Set([null, "deadline", "rss", "heap", "interrupted", "input", "io"]);
export function validWorkerResult(value) {
  return value && outcomes.has(value.outcome) && reasons.has(value.reason) &&
    (value.outcome !== "complete" || value.reason === null) &&
    (value.outcome !== "failed" || value.reason !== null) &&
    (value.continuation === undefined || typeof value.continuation === "boolean") &&
    (value.resetRequired === undefined || value.resetRequired === true && value.outcome === "partial" && value.continuation === true) &&
    !(value.outcome === "complete" && value.continuation);
}

/** Internal seams are for isolated tests, not public tuning. Only the worker
 * writes run/status facts. The supervisor owns admission, process lifetime and
 * its command result; a forced death leaves an unfinished worker receipt. */
export async function superviseCapture(root, options, {
  workerPath, policy = CAPTURE_POLICY, drainSeconds = 5,
  executable = process.execPath, env = process.env, clock = captureMonotonicMs,
  acquire = acquireCaptureLock, spawnChild = spawn,
  window, pass,
} = {}) {
  if (typeof workerPath !== "string" || !workerPath) throw new Error("capture worker entry is required");
  if (window && (![window.drainAt, window.finalizeAt, window.hardAt].every(Number.isFinite) ||
      window.drainAt > window.finalizeAt || window.finalizeAt > window.hardAt)) throw new Error("invalid capture child time window");
  const started = clock(), deadline = Math.min(started + policy.deadlineSeconds * 1000, window?.hardAt ?? Infinity);
  const drainAt = Math.min(deadline, window?.drainAt ?? Math.max(started, deadline - drainSeconds * 1000));
  const finalizeAt = Math.min(deadline, window?.finalizeAt ?? deadline);
  const lock = acquire(root);
  if (!lock.release) return { outcome: "overlap", reason: null, exitCode: 0, held: lock.held };
  let child, timer, finish, forced, result, ready = false, diagnostics = "", outputBytes = 0;
  const stop = reason => {
    forced ??= reason;
    // ChildProcess owns this exact child until exit/reaping. Never derive a
    // process group, or signal a PID recovered from a persisted lock record.
    if (child?.pid > 0 && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  };
  const interrupted = () => stop("interrupted");
  try {
    process.on("SIGTERM", interrupted); process.on("SIGINT", interrupted);
    child = spawnChild(executable, [`--max-old-space-size=${policy.heapMiB}`, "--no-warnings",
      // Node 22.5–22.12 need this flag. It does not import SQLite or alter the
      // heap, and unlike execArgv it cannot forward arbitrary preload code.
      ...(Number(process.versions.node.split(".")[0]) === 22 && Number(process.versions.node.split(".")[1]) < 13 ? ["--experimental-sqlite"] : []),
      workerPath], { env: captureWorkerEnvironment(env), stdio: ["ignore", "ignore", "pipe", "ipc"], serialization: "json" });
    finish = new Promise(resolve => {
      let spawnError;
      child.once("error", () => { spawnError = true; stop("io"); });
      child.once("close", (code, signal) => resolve({ code, signal, spawnError }));
    });
    child.stderr?.on("data", chunk => {
      outputBytes += chunk.length;
      if (outputBytes > 64 * 1024) { stop("io"); return; }
      diagnostics += chunk.toString("utf8");
    });
    child.on("message", message => {
      if (forced) return;
      if (!ready && message?.type === "ready" && message.pid === child.pid &&
          typeof message.nonce === "string" && /^[a-f0-9]{32}$/.test(message.nonce) &&
          typeof message.startedAt === "string" && Number.isFinite(Date.parse(message.startedAt))) {
        ready = true;
        try {
          lock.registerWorker(message);
          if (clock() >= deadline) { stop("deadline"); return; }
          child.send({ type: "start", root, options, policy, parent: { pid: process.pid, nonce: lock.nonce },
            workerNonce: message.nonce, drainAt, finalizeAt, hardAt: deadline, pass,
            reclaimedLock: lock.reclaimed ?? null }, error => { if (error) stop("io"); });
        } catch { stop("io"); }
      } else if (ready && !result && message?.type === "result" && validWorkerResult(message.result)) {
        result = message.result;
      } else stop("io");
    });
    timer = setTimeout(() => stop("deadline"), Math.max(0, deadline - clock()));
    const ended = await finish;
    if (forced || ended.spawnError || ended.signal || !result || ended.code !== (result.outcome === "failed" ? 1 : 0)) {
      const heap = /heap out of memory|allocation failed.*heap/i.test(diagnostics);
      return { outcome: "failed", reason: heap ? "heap" : forced ?? (ended.signal ? "interrupted" : "io"), exitCode: 1 };
    }
    return { ...result, exitCode: result.outcome === "failed" ? 1 : 0 };
  } catch {
    stop("io");
    if (finish) await finish;
    return { outcome: "failed", reason: "io", exitCode: 1 };
  } finally {
    clearTimeout(timer);
    process.off("SIGTERM", interrupted); process.off("SIGINT", interrupted);
    const released = lock.release();
    // Cleanup failure is an operational error even after a successful worker.
    if (!released.released) throw Object.assign(new Error("capture supervisor could not release its lock"), { release: released });
  }
}
