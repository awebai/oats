/** Cooperative serialization for new portable-state writers, not legacy cutover
 * or hostile-host locking. A crashed guard is held for explicit recovery. */
import { lstatSync, mkdirSync, realpathSync, rmdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { ensureStoreIgnore } from "./capability-artifacts.mjs";
import { oatsError } from "./errors.mjs";

export function portableScope(scope) {
  if (typeof scope !== "string" || !isAbsolute(scope)) throw oatsError("invalid-artifact-store", "portable deployment must be explicit and absolute");
  const actual = realpathSync(scope);
  if (!lstatSync(actual).isDirectory()) throw oatsError("invalid-artifact-store", "portable deployment must be a directory");
  return actual;
}
export function portableStateDirectory(scope, create = false) {
  let root = portableScope(scope);
  for (const name of [".agents", "portable"]) {
    root = join(root, name);
    if (create) { try { mkdirSync(root, { mode: 0o700 }); } catch (error) { if (error.code !== "EEXIST") throw error; } }
    let stat;
    try { stat = lstatSync(root); } catch (error) { if (!create && error.code === "ENOENT") return null; throw error; }
    if (!stat.isDirectory()) throw oatsError("invalid-artifact-store", "managed portable-state component is not a real directory");
  }
  if (create) ensureStoreIgnore(root);
  return root;
}
export function withPortableStateWrite(scope, write) {
  const deployment = portableScope(scope), root = portableStateDirectory(deployment, true), guard = join(root, ".write-guard");
  try { mkdirSync(guard, { mode: 0o700 }); }
  catch (error) {
    if (error.code === "EEXIST") throw oatsError("selection-changed", "portable state has another writer or a held recovery guard");
    throw error;
  }
  const owned = lstatSync(guard);
  let failed = false, primary;
  try { return write({ deployment, root }); }
  catch (error) { failed = true; primary = error; throw error; }
  finally {
    try {
      const current = lstatSync(guard);
      if (!current.isDirectory() || current.dev !== owned.dev || current.ino !== owned.ino) throw oatsError("selection-changed", "portable write guard ownership changed");
      // Empty owned guard only; never force-remove a foreign/stale guard tree.
      rmdirSync(guard);
    } catch (cleanup) {
      const error = failed ? new AggregateError([primary, cleanup], "portable state write and guard cleanup failed", { cause: primary })
        : new Error("portable write guard cleanup failed", { cause: cleanup });
      error.code = failed ? primary.code : cleanup.code;
      error.guardPath = guard;
      throw error;
    }
  }
}
