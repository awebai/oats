/** Immutable retention of already materialized capabilities. Acquisition,
 * selection, approval and instance dispatch remain the caller's responsibility.
 * See docs/design/2026-09-14-artifact-retention-contract.md. */
import {
  lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync,
  realpathSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  CAPABILITIES_DIRNAME, capabilityArtifactIntegrity, copyTreeSafe,
  isMaterializedCapabilityId, oatsError, validateCapabilityLockEntry,
  validateLockEntry, verifyCapabilityInstallation,
} from "./core.mjs";

const INTEGRITY = /^sha256-[0-9a-f]{64}$/;
const STORE_PARTS = [...CAPABILITIES_DIRNAME.split(sep), "artifacts"];
const exists = (path) => {
  try { return lstatSync(path); }
  catch (e) { if (e.code === "ENOENT") return null; throw e; }
};
const outside = (root, path) => {
  const rel = relative(root, path);
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
};

/** The complete digest, not a short display prefix, identifies a revision. */
export function retainedCapabilityDir(scope, capability, integrity) {
  if (!isMaterializedCapabilityId(capability) || typeof integrity !== "string" || !INTEGRITY.test(integrity)) {
    throw oatsError("invalid-artifact-reference", "retained capability requires a valid capability ID and full sha256 integrity");
  }
  return join(resolve(scope), CAPABILITIES_DIRNAME, "artifacts", capability, integrity);
}

function lockRows(capability, lock) {
  if (!lock?.capabilities || !Object.hasOwn(lock.capabilities, capability) || !lock.packages) {
    throw oatsError("invalid-lock", `no captured capability/package lock for ${capability}`);
  }
  for (const [id, row] of Object.entries(lock.packages)) validateLockEntry(id, row, lock.packages);
  const row = lock.capabilities[capability];
  validateCapabilityLockEntry(capability, row, lock.packages);
  return { row, pkg: lock.packages[row.package] };
}

// A retained tree must remain usable after its source disappears. In particular,
// an absolute symlink pointing back into today's source is not a portable link.
function assertRetainableTree(root) {
  if (!lstatSync(root).isDirectory()) throw oatsError("invalid-artifact", `artifact root must be a directory: ${root}`);
  const boundary = realpathSync(root);
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, e.name);
      if (e.isDirectory()) walk(path);
      else if (e.isSymbolicLink()) {
        let target;
        try { target = realpathSync(path); }
        catch { throw oatsError("artifact-not-contained", `broken artifact symlink: ${path}`); }
        if (isAbsolute(readlinkSync(path)) || outside(boundary, target)) {
          throw oatsError("artifact-not-contained", `artifact symlink must stay relative and inside its retained tree: ${path}`);
        }
      } else if (!e.isFile()) {
        throw oatsError("invalid-artifact", `artifact contains an unsupported file type: ${path}`);
      }
    }
  };
  walk(root);
}

function verifyTree(dir, capability, row, pkg) {
  assertRetainableTree(dir);
  const actual = capabilityArtifactIntegrity(dir);
  if (actual !== row.integrity) {
    throw oatsError("integrity-drift", `retained capability ${capability}: expected ${row.integrity}, got ${actual} at ${dir}`);
  }
  verifyCapabilityInstallation(dir, capability, row, pkg);
}

// The scope itself may be a user's symlink. Managed descendants must be real
// directories, so a stale/broken store link cannot redirect publication.
function storePath(scope, capability, create) {
  let dir = realpathSync(scope);
  for (const [index, part] of [...STORE_PARTS, capability].entries()) {
    dir = join(dir, part);
    if (create) {
      try { mkdirSync(dir); }
      catch (e) { if (e.code !== "EEXIST") throw e; }
    }
    const st = exists(dir);
    if (!st || !st.isDirectory()) throw oatsError("invalid-artifact-store", `artifact store component must be a directory: ${dir}`);
    if (index === STORE_PARTS.length - 1 && create) {
      // Owned store metadata, outside every hashed artifact. Write before any
      // staging payload; no Git command or change to authored directories.
      const ignore = join(dir, ".gitignore");
      try { writeFileSync(ignore, "*\n", { flag: "wx" }); }
      catch (e) { if (e.code !== "EEXIST") throw e; }
      if (!exists(ignore)?.isFile() || readFileSync(ignore, "utf8") !== "*\n") {
        throw oatsError("invalid-artifact-store", `managed artifact ignore file must contain exactly '*': ${ignore}`);
      }
    }
  }
  return dir;
}

/** Verify an exact retained revision using captured provenance. No current lock,
 * source repository, trust approval or network lookup participates. */
export function verifyRetainedCapability(scope, capability, lock) {
  const { row, pkg } = lockRows(capability, lock);
  retainedCapabilityDir(scope, capability, row.integrity); // validate before path use
  const dir = join(storePath(scope, capability, false), row.integrity);
  verifyTree(dir, capability, row, pkg);
  return { capability, integrity: row.integrity, dir };
}

/** Publish once by same-filesystem rename. Never repairs or replaces a retained
 * revision; a damaged existing entry requires explicit operator intervention.
 * `lock` carries validated package/capability provenance from one resolution.
 * Its trust flags are not grants from this API, and are never written here. */
export function retainCapabilityArtifact(scope, sourceDir, capability, lock) {
  const { row, pkg } = lockRows(capability, lock);
  retainedCapabilityDir(scope, capability, row.integrity);
  verifyTree(sourceDir, capability, row, pkg);
  const root = storePath(scope, capability, true);
  const dir = join(root, row.integrity);
  const receipt = { capability, integrity: row.integrity, dir };
  if (exists(dir)) {
    verifyTree(dir, capability, row, pkg);
    return { ...receipt, status: "kept" };
  }
  // Refuse recursive copies if a caller supplied an ancestor of the store.
  if (!outside(realpathSync(sourceDir), root)) throw oatsError("invalid-artifact", "artifact source contains its destination store");
  const staging = mkdtempSync(join(root, ".staging-"));
  const tree = join(staging, "tree");
  try {
    copyTreeSafe(sourceDir, tree);
    verifyTree(tree, capability, row, pkg); // source may have changed during copy
    try { renameSync(tree, dir); }
    catch (e) {
      // Two preparers may publish the same bytes. Only accept the other result
      // after verifying it; unrelated filesystem errors retain their diagnosis.
      if (e.code !== "EEXIST" && e.code !== "ENOTEMPTY") throw e;
      verifyTree(dir, capability, row, pkg);
      return { ...receipt, status: "kept" };
    }
    return { ...receipt, status: "retained" };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
