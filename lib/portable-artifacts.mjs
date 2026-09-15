/** New-format immutable tree storage. Selection, source identity observation,
 * provenance/requirements, approval and dispatch remain separate upper layers.
 * No ambient lock/config/network lookup and no migration of legacy evidence. */
import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { assertRetainableTree, ensureStoreIgnore } from "./capability-artifacts.mjs";
import { isMaterializedCapabilityId } from "./capability-provenance.mjs";
import { publishArtifactTree } from "./artifact-tree.mjs";
import { canonicalJson } from "./portable-values.mjs";
import { TREE_FORMAT, jsonIntegrity, treeIntegrity, validateIntegrity } from "./portable-digest.mjs";
import { oatsError } from "./errors.mjs";

const exists = (path) => {
  try { return lstatSync(path); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
};
const outside = (root, target) => {
  const path = relative(root, target);
  return path === ".." || path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(path);
};

function referenceParts(reference) {
  canonicalJson(reference, { maxBytes: 64 * 1024, maxDepth: 16, maxEntries: 1024 });
  if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
    throw oatsError("invalid-artifact-reference", "expected a portable artifact reference");
  }
  validateIntegrity(reference.integrity, [TREE_FORMAT]);
  const keys = Object.keys(reference).sort().join(",");
  let root, extra = [];
  if (reference.kind === "capability" && keys === "capability,integrity,kind" && isMaterializedCapabilityId(reference.capability)) {
    root = [".agents", "capabilities", "artifacts"]; extra = [reference.capability];
  } else if (reference.kind === "soul" && keys === "identity,integrity,kind"
      && reference.identity && typeof reference.identity === "object" && !Array.isArray(reference.identity)
      && Object.keys(reference.identity).length > 0) {
    // The source/record codec qualifies the identity and witness. Storage only
    // derives an opaque safe key from that exact identity; aliases are not keys.
    root = [".agents", "soul-artifacts"]; extra = [jsonIntegrity(reference.identity).value];
  } else if (reference.kind === "resource" && keys === "integrity,kind") {
    root = [".agents", "resource-artifacts"];
  } else throw oatsError("invalid-artifact-reference", "invalid portable artifact reference kind/fields");
  return { root, tail: [...extra, "tree-exec-v1", reference.integrity.value] };
}
function explicitScope(scope) {
  if (typeof scope !== "string" || !isAbsolute(scope)) {
    throw oatsError("invalid-artifact-store", "artifact deployment scope must be explicit and absolute");
  }
  try {
    const actual = realpathSync(scope);
    if (!lstatSync(actual).isDirectory()) throw oatsError("invalid-artifact-store", "artifact scope is not a directory");
    return actual;
  } catch (error) {
    if (error.code === "ENOENT") throw oatsError("artifact-not-found", "artifact deployment scope is absent");
    throw error;
  }
}

/** Lexical path only. This does not verify the store, bytes, provenance or trust. */
export function portableArtifactDir(scope, reference) {
  if (typeof scope !== "string" || !isAbsolute(scope)) {
    throw oatsError("invalid-artifact-store", "artifact deployment scope must be explicit and absolute");
  }
  const { root, tail } = referenceParts(reference);
  return join(resolve(scope), ...root, ...tail);
}
function storeDirectory(scope, reference, create) {
  const parts = referenceParts(reference), prefix = [...parts.root, ...parts.tail.slice(0, -1)];
  let path = explicitScope(scope);
  for (let index = 0; index < prefix.length; index++) {
    path = join(path, prefix[index]);
    if (create) {
      try { mkdirSync(path, { mode: 0o700 }); }
      catch (error) { if (error.code !== "EEXIST") throw error; }
    }
    const stat = exists(path);
    if (!stat) throw oatsError("artifact-not-found", "portable artifact store is absent");
    if (!stat.isDirectory()) throw oatsError("invalid-artifact-store", "managed artifact store component is not a real directory");
    if (create && index === parts.root.length - 1) ensureStoreIgnore(path);
  }
  return path;
}
function verifyTree(path, reference) {
  const stat = exists(path);
  if (!stat) throw oatsError("artifact-not-found", "portable artifact tree is absent");
  if (!stat.isDirectory()) throw oatsError("invalid-artifact", "portable artifact root must be a real directory");
  // Digest traversal is bounded and does not follow links. Then qualify link
  // containment; neither check uses the original source or an ambient package row.
  const actual = treeIntegrity(path);
  if (actual.value !== reference.integrity.value) throw oatsError("integrity-drift", "portable artifact digest does not match its reference");
  assertRetainableTree(path);
  return path;
}

/** Byte/containment verification only, not a complete captured-resolution proof. */
export function verifyPortableArtifact(scope, reference) {
  const root = storeDirectory(scope, reference, false);
  const dir = join(root, reference.integrity.value);
  verifyTree(dir, reference);
  return { reference, dir };
}
export function retainPortableArtifact(scope, sourceDir, reference) {
  referenceParts(reference);
  const deployment = explicitScope(scope);
  if (typeof sourceDir !== "string" || !isAbsolute(sourceDir)) {
    throw oatsError("invalid-artifact", "artifact input must be an explicit materialized directory");
  }
  verifyTree(sourceDir, reference);
  const candidate = portableArtifactDir(deployment, reference), source = realpathSync(sourceDir);
  if (!outside(source, candidate) && source !== candidate) {
    throw oatsError("invalid-artifact", "artifact source contains its destination store");
  }
  const parent = storeDirectory(deployment, reference, true), dir = join(parent, reference.integrity.value);
  if (exists(dir)) { verifyTree(dir, reference); return { reference, dir, status: "kept" }; }
  const status = publishArtifactTree(sourceDir, dir, (tree) => verifyTree(tree, reference));
  return { reference, dir, status };
}
