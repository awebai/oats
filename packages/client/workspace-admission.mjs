/** Whether a directory is an OATS deployment, and which deployments a directory holds: the rule a
 * client applies before it serves or offers a directory. Existence only: the deployment's content is
 * the kernel's to read (`oats workspace status`), and nothing here parses it. The filesystem is the
 * caller's: every function takes its `io`. */
import { join } from "node:path";

/** The most directory entries one look inside a folder reads. */
export const PICK_SCAN_LIMIT = 200;

/** `io.isDeployment` as a predicate that never throws: a path it cannot answer for is not a deployment. */
export const deploymentCheck = (io) => (p) => { try { return io.isDeployment(p) === true; } catch { return false; } };

/** The deployments directly inside `dir`, sorted by name: at most PICK_SCAN_LIMIT entries read, a
 * link never followed, nothing parsed. An unreadable or missing `dir` holds none. Used for a picked
 * parent folder, and for ~/Agents, whose deployments the switcher offers unasked (#518).
 * @param {string} dir
 * @param {object} io
 * @param {(dir: string, limit: number) => { entries: Array<{ name: string, isDirectory: boolean }>, limited: boolean }} io.list
 *        at most `limit` entries, `isDirectory` from the entry itself (a link is not a directory)
 * @param {(p: string) => boolean} io.isDeployment  a regular oats-local.yaml (lstat)
 * @returns {{ paths: string[], limited: boolean }} */
export function deploymentsInside(dir, io) {
  let listed = { entries: [], limited: false };
  try { listed = io.list(dir, PICK_SCAN_LIMIT) || listed; } catch { /* unreadable: no children offered */ }
  const paths = listed.entries.filter((e) => e?.isDirectory && typeof e.name === "string" && !e.name.includes("/"))
    .map((e) => e.name).sort((a, b) => a.localeCompare(b)).map((name) => join(dir, name)).filter(deploymentCheck(io));
  return { paths, limited: !!listed.limited };
}

/**
 * Validate a directory as a workspace-model v2 deployment and derive its
 * identity: the canonical deployment directory itself.
 * @param {string} path       canonicalized absolute path
 * @param {object} io
 * @param {(p: string) => boolean} io.isDeployment  the directory holds its
 *        deployment file (a regular, non-symlink oats-local.yaml); existence
 *        only — the kernel reads and validates it
 * @returns {{ id: string, name: string, team: null, path: string } | null}
 */
export function validateWorkspace(path, io) {
  if (typeof path !== "string" || !path.startsWith("/")) return null;
  let deployment = false;
  try { deployment = io.isDeployment(path) === true; } catch { return null; }
  return deployment ? { id: path, name: path.split("/").pop() || path, team: null, path } : null;
}
