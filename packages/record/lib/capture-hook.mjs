// Explicit hook launch, not capture completion. No inherited harness pipe,
// shell, preload or caller-selected worker survives into the detached owner.
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { captureCommandOptions } from "./capture-command.mjs";
import { captureWorkerEnvironment } from "./capture-supervisor.mjs";

export async function launchCaptureHook(root, options, { spawnChild = spawn, env = process.env } = {}) {
  if (typeof root !== "string" || !root || root.includes("\0")) throw new Error("invalid capture hook root");
  const selected = captureCommandOptions(options);
  if (selected.trigger !== "hook" || selected.retrySetAside) throw new Error("invalid capture hook intent");
  const request = { root: resolve(selected.plan.cwd, root), options: selected };
  const child = spawnChild(process.execPath, ["--no-warnings",
    ...(Number(process.versions.node.split(".")[0]) === 22 && Number(process.versions.node.split(".")[1]) < 13 ? ["--experimental-sqlite"] : []),
    fileURLToPath(new URL("./capture-hook-runner.mjs", import.meta.url)), JSON.stringify(request)],
  { cwd: selected.plan.cwd, env: captureWorkerEnvironment(env), detached: true, stdio: "ignore", shell: false });
  await new Promise((done, fail) => {
    child.once("error", fail);
    child.once("spawn", done);
  });
  child.unref();
  // The OS launched this fixed supervisor. Its module startup, lock admission,
  // worker completion and later failure are deliberately NOT acknowledged here.
  return { launched: true };
}
