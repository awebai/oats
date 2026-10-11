/** System tools: programs the kernel runs from the system's own directories, never from the
 *  caller's PATH. A job, a shell or an instance may have changed PATH; what a system tool does
 *  (read a process's start, start the OATS tmux server in its own scope) must not depend on it. */
import { accessSync, constants, statSync } from "node:fs";
import { join } from "node:path";

/** Where a system tool is looked for, in order. */
export const SYSTEM_TOOL_DIRS = Object.freeze(["/usr/bin", "/bin"]);

/** `name` in the system directories → { file } (the first regular executable file, an absolute
 *  path) or { reason } (none, and where it looked). Nothing is run. */
export function systemTool(name, { dirs = SYSTEM_TOOL_DIRS } = {}) {
  if (typeof name !== "string" || !/^[A-Za-z0-9._+-]+$/.test(name) || name === "." || name === "..") return { reason: `${JSON.stringify(name)} is not a tool name` };
  for (const dir of dirs) {
    const file = join(dir, name);
    try {
      if (!statSync(file).isFile()) continue;
      accessSync(file, constants.X_OK);
      return { file };
    } catch { /* not here */ }
  }
  return { reason: `no executable ${name} in ${dirs.join(", ")}` };
}
