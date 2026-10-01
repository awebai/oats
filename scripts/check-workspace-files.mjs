// The repository's own workspace declaration, read as the kernel reads it, and no unresolved merge-conflict
// markers in any tracked text file (a conflicted oats-workspace.yaml once passed check, validate, pack and
// smoke). Used by validate-project.mjs; `root` is a git work tree.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readDeclaration } from "../lib/workspace.mjs";
import { parsePackageCatalog } from "../lib/core.mjs";

/** Tracked files that deliberately hold conflict markers (fixtures), relative to the root. */
export const CONFLICT_MARKER_ALLOW_LIST = Object.freeze([]);
const MARKER = /^(<{7} |={7}$|>{7} )/;

/** → the failures (strings naming the file, and the line where it has one); [] when all is well. */
export function checkWorkspaceFiles(root, { markerAllowList = CONFLICT_MARKER_ALLOW_LIST } = {}) {
  const failures = [];
  const workspaceFile = join(root, "oats-workspace.yaml");
  if (existsSync(workspaceFile)) {
    const read = readDeclaration("workspace", readFileSync(workspaceFile), { path: "oats-workspace.yaml" });
    if (read.problems) {
      const decode = read.value === undefined;
      failures.push(`oats-workspace.yaml: the kernel ${decode ? "cannot read it" : "refuses it"}: ${read.problems.map((p) => `${p.path ? `${p.path}: ` : ""}${p.message}`).join("; ")}`);
    }
  }
  const catalogFile = join(root, "package-catalog.json");
  if (existsSync(catalogFile)) {
    try { parsePackageCatalog(readFileSync(catalogFile, "utf8"), "package-catalog.json"); }
    catch (e) { failures.push(`package-catalog.json: the kernel cannot read it: ${e.message}`); }
  }
  const tracked = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean);
  for (const rel of tracked) {
    if (markerAllowList.includes(rel)) continue;
    let bytes;
    try { bytes = readFileSync(join(root, rel)); } catch { continue; } // deleted in the work tree, or not a file
    if (bytes.subarray(0, 8192).includes(0)) continue; // binary
    bytes.toString("utf8").split("\n").forEach((line, i) => {
      if (MARKER.test(line.replace(/\r$/, ""))) failures.push(`${rel}:${i + 1}: unresolved merge-conflict marker`);
    });
  }
  return failures;
}
