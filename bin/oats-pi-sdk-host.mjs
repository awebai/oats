#!/usr/bin/env node
/** Explicit kernel-owned print adapter; not an alternate interpretation of Pi CLI. */
import { recordCapturedPiExit, runCapturedPiSdkHost } from "../lib/captured-pi-host.mjs";

try {
  const argv = process.argv.slice(2);
  process.exitCode = argv[0] === "--oats-pi-record-exit" ? recordCapturedPiExit(argv) : await runCapturedPiSdkHost(argv);
} catch (error) {
  // Never echo arbitrary SDK/helper/provider error objects: those can contain
  // native auth material. Native print mode owns its ordinary safe diagnostics.
  const known = new Set(["E_PI_HOST_ARGS", "E_PI_HOST_SELECTION", "E_PI_HOST_MODEL", "E_PI_HOST_TASK", "E_PI_HOST_SDK", "E_PI_HOST_CURRICULUM", "E_PI_HOST_HISTORY", "E_PI_HOST_CUSTODY", "E_PI_HOST_RECORD_UNAVAILABLE", "E_PI_HOST_OUTCOME"]);
  const code = known.has(error?.code) ? error.code : "E_PI_HOST_FAILED";
  console.error(process.argv[2] === "--oats-pi-record-exit"
    ? `${code}: captured Pi process observation refused or failed; completion evidence remains held`
    : `${code}: captured Pi host refused or failed; use the selected harness's native setup for model/auth prerequisites`);
  process.exitCode = 1;
}
