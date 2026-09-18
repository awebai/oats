#!/usr/bin/env node
/** Explicit kernel-owned print adapter; not an alternate interpretation of Pi CLI. */
import { runCapturedPiSdkHost } from "../lib/captured-pi-host.mjs";

try {
  process.exitCode = await runCapturedPiSdkHost(process.argv.slice(2));
} catch (error) {
  // Never echo arbitrary SDK/helper/provider error objects: those can contain
  // native auth material. Native print mode owns its ordinary safe diagnostics.
  const known = new Set(["E_PI_HOST_ARGS", "E_PI_HOST_SELECTION", "E_PI_HOST_MODEL", "E_PI_HOST_TASK", "E_PI_HOST_SDK", "E_PI_HOST_CURRICULUM", "E_PI_HOST_HISTORY", "E_PI_HOST_CUSTODY", "E_PI_HOST_RECORD_UNAVAILABLE"]);
  const code = known.has(error?.code) ? error.code : "E_PI_HOST_FAILED";
  console.error(`${code}: captured Pi host refused or failed; use the selected harness's native setup for model/auth prerequisites`);
  process.exitCode = 1;
}
