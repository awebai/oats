// The guard and helpers of the real-manager test files (#1108 D2). Those files
// run launchctl or systemctl --user for real, so they run only on a hosted
// runner of their own dispatched workflow: never in pull-request CI (whose
// workflow is "CI" and auto-discovers them), never on a person's machine. The
// guard reads only runner-supplied facts, never CI or GITHUB_ACTIONS.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const WORKFLOWS = { darwin: "macOS tests", linux: "Linux tests" };

/** null when this process may drive the real manager of `platform`, else the
 *  reason to skip, for node:test's `skip`. A skip is not evidence. */
export function realManagerSkip(platform, env = process.env, actual = process.platform) {
  const workflow = WORKFLOWS[platform];
  if (!workflow) throw new Error(`no real-manager workflow for ${platform}`);
  if (actual !== platform) return `real ${platform} manager cases need ${platform}; this is ${actual}`;
  if (env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_WORKFLOW !== workflow)
    return `real ${platform} manager cases run only in a dispatched "${workflow}" workflow (event ${env.GITHUB_EVENT_NAME ?? "unset"}, workflow ${env.GITHUB_WORKFLOW ?? "unset"})`;
  return null;
}

export const setupScript = fileURLToPath(new URL("../../bin/setup.mjs", import.meta.url));
export const captureScript = fileURLToPath(new URL("../../bin/capture.mjs", import.meta.url));

/** A scratch directory removed after the test, and a shell script in it. */
export function scratch(t, prefix) {
  const base = fs.mkdtempSync(join(tmpdir(), prefix));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return base;
}
export function script(path, body) {
  fs.writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return path;
}

/** A node wrapper recorded as the service's node: each start appends its pid
 *  to `starts`; while `hold` exists it waits, so a pass stays active for as
 *  long as a test needs, then it runs the real node with the same arguments. */
export function nodeWrapper(base, name = "node-wrapper") {
  const starts = join(base, `${name}.starts`), hold = join(base, `${name}.hold`);
  const path = script(join(base, name), `echo $$ >> '${starts}'\nwhile [ -e '${hold}' ]; do sleep 0.2; done\nexec '${process.execPath}' "$@"`);
  return { path, starts, hold, pids: () => fs.existsSync(starts) ? fs.readFileSync(starts, "utf8").trim().split("\n").filter(Boolean).map(Number) : [] };
}

/** Setup as a person runs it: the package CLI, with `env` over this process's. */
export function runSetup(args, env) {
  return spawnSync(process.execPath, [setupScript, ...args], { env: { ...process.env, ...env }, encoding: "utf8", timeout: 120_000 });
}

export function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
}

/** Poll `probe` until it returns a truthy value or `ms` pass. */
export async function until(probe, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out after ${ms}ms waiting for ${what}`);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}
