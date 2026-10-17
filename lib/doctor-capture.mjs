import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validCaptureHealthEnvelope } from "../packages/record/lib/capture-status.mjs";

const entry = fileURLToPath(new URL("../packages/record/lib/capture-health-doctor.mjs", import.meta.url));
const timeout = 20000, maxBuffer = 1024 * 1024;
const unavailable = detail => [{ code: "capture-health-unavailable", message:
  `Capture health is unavailable (${detail}). Run oats capture --health --json to inspect the package reader failure; no capture or repair was attempted.` }];

// One fixed package command. No status/DB reads or diagnosis rules live here.
// Injection is an internal transport fixture seam, never a CLI/env override.
export function doctorCaptureWarnings({ env = process.env, cwd = process.cwd(), run = spawnSync } = {}) {
  const childEnv = Object.fromEntries(["HOME", "USERPROFILE", "TMPDIR", "XDG_CACHE_HOME", "TURN_RECORD_ROOT"]
    .filter(key => env[key] !== undefined).map(key => [key, env[key]]));
  let result;
  try {
    result = run(process.execPath, [
      ...process.execArgv.filter(arg => arg === "--experimental-sqlite"), entry,
    ], { cwd, env: childEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      timeout, maxBuffer, killSignal: "SIGKILL", windowsHide: true });
  } catch { return unavailable("command transport failed"); }
  if (!result || result.error || result.signal || result.status !== 0) {
    // Do not promote unvalidated stderr or failed stdout into diagnosis rows.
    return unavailable(result?.error?.code === "ETIMEDOUT" ? "command timed out" :
      result?.error?.code === "ENOBUFS" ? "command output exceeded its bound" : "command or reader failed");
  }
  if (typeof result.stdout !== "string" || typeof result.stderr !== "string" ||
      Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) > maxBuffer)
    return unavailable("command output exceeded its bound");
  let health;
  try { health = JSON.parse(result.stdout); }
  catch { return unavailable("invalid package response"); }
  if (!validCaptureHealthEnvelope(health)) return unavailable("invalid package health envelope");
  return health.rows.map(({ code, message }) => ({ code, message }));
}
