/** Inert runtime binaries for fixtures that spawn.
 *
 * `oats spawn --no-launch` still resolves the runtime's launch executable
 * (lib/core.mjs resolveLaunchExecutable) and refuses a spawn when it is not on
 * PATH. A fixture that spawns must therefore bring its own `pi`, `claude` and
 * `codex`, or it passes only on a machine that has them installed.
 *
 * Put the stub directory AFTER a fixture's own bin, so its purpose-built fakes
 * (tripwires, catalogue answers) win, and BEFORE the host PATH. */
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const RUNTIME_STUBS = ["pi", "claude", "codex"];

/** Create `<parent>/runtime-stub/{pi,claude,codex}`, each `exit 0`; return the directory. */
export function inertRuntimeDir(parent) {
  const dir = join(parent, "runtime-stub");
  mkdirSync(dir, { recursive: true });
  for (const name of RUNTIME_STUBS) {
    writeFileSync(join(dir, name), "#!/bin/sh\nexit 0\n");
    chmodSync(join(dir, name), 0o755);
  }
  return dir;
}

/** `rest` (the host PATH by default) with an inert runtime directory in front of it. */
export function inertRuntimePath(parent, rest = process.env.PATH) {
  return `${inertRuntimeDir(parent)}:${rest}`;
}
