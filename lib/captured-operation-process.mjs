/** Bounded runner for one already-verified captured provider operation. The
 * caller owns receipt interpretation and invocation-snapshot cleanup. */
import { spawnSync } from "node:child_process";
import { oatsError } from "./errors.mjs";

export const CAPTURED_OPERATION_TIMEOUT_MS = 4 * 60 * 1000;

export function runCapturedOperationProcess({ file, args = [], cwd, env, timeoutMs = CAPTURED_OPERATION_TIMEOUT_MS }) {
  if (typeof file !== "string" || !file || !Array.isArray(args) || args.some((arg) => typeof arg !== "string")) throw oatsError("invalid-declaration", "captured operation executable and arguments must be text");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > CAPTURED_OPERATION_TIMEOUT_MS) throw oatsError("invalid-declaration", `captured operation timeout must be 1-${CAPTURED_OPERATION_TIMEOUT_MS}ms`);
  return spawnSync(process.execPath, [file, ...args], {
    cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024, timeout: timeoutMs, killSignal: "SIGKILL",
  });
}
