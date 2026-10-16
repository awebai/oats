// Private command caller. Root discovery runs only in the admitted worker;
// callers cannot choose its executable, entry path, heap or pass allowances.
import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { captureDefaultRootPlan } from "./capture-default-roots.mjs";
import { superviseCapturePass } from "./capture-pass.mjs";
import { acquireCaptureLock } from "./capture-lock.mjs";
import { validStreamId } from "./store.mjs";

const triggers = new Set(["manual", "watch", "hook", "setup", "service"]);
export function captureCommandOptions(value) {
  if (!value || Object.keys(value).some(key => !["owner", "plan", "indexEnabled", "trigger", "retrySetAside"].includes(key)) ||
      typeof value.owner !== "string" || !value.owner || !validStreamId(`${value.owner}~aw`) ||
      typeof value.indexEnabled !== "boolean" || !triggers.has(value.trigger) || typeof value.retrySetAside !== "boolean" ||
      value.plan?.kind !== "default-roots" ||
      Object.keys(value.plan).some(key => !["kind", "home", "cwd", "env", "sources"].includes(key)))
    throw new Error("invalid private capture command selection");
  const plan = captureDefaultRootPlan(value.plan);
  if (value.retrySetAside && plan.sources.length !== 4) throw new Error("explicit retry requires all capture sources");
  return { owner: value.owner, plan, indexEnabled: value.indexEnabled, trigger: value.trigger, retrySetAside: value.retrySetAside };
}

export function captureCommandSelection(options) {
  return createHash("sha256").update(JSON.stringify(options.plan)).digest("hex");
}

export async function runCaptureCommand(root, options) {
  if (typeof root !== "string" || !root || root.includes("\0")) throw new Error("invalid capture command root");
  const selected = captureCommandOptions(options);
  // Resolve relative root spelling against the caller, never a child's cwd.
  const absolute = isAbsolute(root) ? root : resolve(selected.plan.cwd, root);
  let reclaimedLock = null;
  let result;
  try { result = await superviseCapturePass(absolute, selected, {
    workerPath: fileURLToPath(new URL("./capture-command-worker.mjs", import.meta.url)),
    acquire: path => {
      const lock = acquireCaptureLock(path);
      if (lock.reclaimed) reclaimedLock = { path: lock.path, ...lock.reclaimed };
      return lock;
    },
  }); } catch (error) {
    if (reclaimedLock) error.reclaimedLock = reclaimedLock;
    throw error;
  }
  // This is observed lock recovery, not worker accounting or completion.
  return { ...result, reclaimedLock };
}
