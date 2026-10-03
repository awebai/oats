import { spawnSync } from "node:child_process";
import { isAbsolute } from "node:path";
import { CloneError, fail } from "./errors.mjs";

// Every kernel call goes through the absolute OATS_CLI_BIN the kernel handed
// this command, run by this Node: never a bare `oats` from PATH.

/** The environment a kernel call runs with. The invoking instance's identity
 *  and context never travel: the kernel sets parent and relation from explicit
 *  flags, and a spawned instance's hooks must not inherit the caller's seat.
 *  Kept: OATS_HOME_DIR and OATS_PACKAGE_CATALOG (host configuration). */
export function kernelEnv(env = process.env) {
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    if (/^AWEB_/.test(key) || /^PI_AGENT/.test(key) || /^GIT_/.test(key)) continue;
    if (/^OATS_/.test(key) && key !== "OATS_HOME_DIR" && key !== "OATS_PACKAGE_CATALOG") continue;
    out[key] = value;
  }
  return out;
}

export function cliBin(env = process.env) {
  const bin = env.OATS_CLI_BIN;
  if (!bin || !isAbsolute(bin)) fail("E_CLONE_CONTEXT", "OATS_CLI_BIN must be the absolute path of the kernel CLI (run this through `oats cloning …`)");
  return bin;
}

/** Run `node <OATS_CLI_BIN> …args`. Returns { status, stdout, stderr }. */
export function runKernel(args, { cwd, env = process.env, timeout = 120000, input } = {}) {
  const r = spawnSync(process.execPath, [cliBin(env), ...args], {
    cwd, env: kernelEnv(env), encoding: "utf8", timeout, maxBuffer: 64 * 1024 * 1024,
    ...(input !== undefined ? { input } : { stdio: ["ignore", "pipe", "pipe"] }),
  });
  if (r.error) fail("E_CLONE_KERNEL", `oats ${args[0]} did not run: ${r.error.code || r.error.message}`, { command: commandLabel(args) });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

const commandLabel = (args) => `oats ${args.filter((a) => !a.startsWith("/")).slice(0, 3).join(" ")}`;

function parseJson(text, args) {
  try { return JSON.parse(text); }
  catch { fail("E_CLONE_KERNEL", `${commandLabel(args)} did not answer JSON`, { command: commandLabel(args) }); }
}

/** A kernel command that answers the envelope { schemaVersion: 1, ok, result | error }.
 *  A refusal keeps the kernel's own code; the kernel's error rides in details.kernel. */
export function kernelEnvelope(args, opts = {}) {
  const r = runKernel(args, opts);
  const out = parseJson(r.stdout.trim(), args);
  if (!out || out.schemaVersion !== 1 || typeof out.ok !== "boolean") fail("E_CLONE_KERNEL", `${commandLabel(args)} answered an unknown envelope`, { command: commandLabel(args) });
  if (!out.ok) throw kernelRefusal(args, out.error);
  return out.result;
}

export function kernelRefusal(args, error) {
  const code = typeof error?.code === "string" && /^E_[A-Z0-9_]+$/.test(error.code) ? error.code : "E_CLONE_KERNEL";
  const message = typeof error?.message === "string" ? error.message : "refused";
  return new CloneError(code, `${commandLabel(args)}: ${message}`, { kernel: { command: commandLabel(args), code, message, ...(error?.details !== undefined ? { details: error.details } : {}) } });
}

/** A kernel command that answers bare JSON (status, capture, recall). An
 *  envelope, if one comes back instead, is unwrapped. */
export function kernelJson(args, opts = {}) {
  const r = runKernel(args, opts);
  const text = r.stdout.trim();
  if (!text) fail("E_CLONE_KERNEL", `${commandLabel(args)} answered nothing (exit ${r.status})`, { command: commandLabel(args), stderr: r.stderr.trim().split("\n").slice(-3).join("\n") });
  const out = parseJson(text, args);
  if (out && out.schemaVersion === 1 && typeof out.ok === "boolean") {
    if (!out.ok) throw kernelRefusal(args, out.error);
    return { value: out.result, status: r.status };
  }
  return { value: out, status: r.status };
}
