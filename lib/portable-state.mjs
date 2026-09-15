/** Cooperative serialization for new portable-state writers, not legacy cutover
 * or hostile-host locking. A crashed guard is held for explicit recovery. */
import { linkSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { canonicalJson } from "./portable-values.mjs";
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
const activeWrites = new WeakSet();

/** Only an active synchronous write can publish a mutable metadata document. */
export function writeGuardedPortableDocument(context, target, value, { absent = false } = {}) {
  if (!activeWrites.has(context)) throw oatsError("selection-changed", "portable write context is not active");
  const { root, deployment } = context;
  if (dirname(target) !== root && target !== join(deployment, "oats-lock.json")) throw oatsError("invalid-artifact-store", "portable write target is outside its owned metadata namespace");
  const bytes = canonicalJson(value), staging = mkdtempSync(join(root, ".document-")), candidate = join(staging, "document.json");
  let failed = false, primary;
  try {
    writeFileSync(candidate, bytes, { flag: "wx", mode: 0o600 });
    if (absent) {
      try { linkSync(candidate, target); }
      catch (error) { if (error.code === "EEXIST") throw oatsError("selection-changed", "portable metadata appeared during first publication"); throw error; }
    } else renameSync(candidate, target);
  } catch (error) { failed = true; primary = error; throw error; }
  finally {
    try { rmSync(staging, { recursive: true, force: true }); }
    catch (cleanup) {
      const error = failed ? new AggregateError([primary, cleanup], "portable metadata write and staging cleanup failed", { cause: primary })
        : new Error("portable metadata staging cleanup failed", { cause: cleanup });
      error.code = failed ? primary.code : cleanup.code; error.stagingPath = staging; throw error;
    }
  }
}

export function withPortableStateWrite(scope, write) {
  const deployment = portableScope(scope), root = portableStateDirectory(deployment, true), guard = join(root, ".write-guard");
  try { mkdirSync(guard, { mode: 0o700 }); }
  catch (error) {
    if (error.code === "EEXIST") throw oatsError("selection-changed", "portable state has another writer or a held recovery guard");
    throw error;
  }
  const owned = lstatSync(guard), context = Object.freeze({ deployment, root });
  activeWrites.add(context);
  let failed = false, primary;
  try { return write(context); }
  catch (error) { failed = true; primary = error; throw error; }
  finally {
    activeWrites.delete(context);
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
