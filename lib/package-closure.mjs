/** One bounded staged dependency walker. Adapters own source syntax/fetch,
 * manifest compatibility and digest versions; this engine owns graph identity,
 * cycle checks and ordering, never installation, selection or executable trust. */
import { oatsError } from "./errors.mjs";

export function resolvePackageClosure({ requests, readPackage, validatePackage, finalizePackage, discardPackage,
  context = "package preparation", maxPackages = 256, maxDepth = 64, maxRequests = 1024 }) {
  if (!Array.isArray(requests) || !requests.length) throw oatsError("invalid-source", "package closure requires explicit root requests");
  for (const callback of [readPackage, validatePackage, finalizePackage, discardPackage]) {
    if (typeof callback !== "function") throw new TypeError("package closure requires complete source/validation/ownership adapters");
  }
  for (const limit of [maxPackages, maxDepth, maxRequests]) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw oatsError("resource-limit", "invalid package graph budget");
  }
  if (maxDepth > 256) throw oatsError("resource-limit", "package graph depth budget exceeds supported traversal");
  const resolved = new Map();
  let reads = 0;
  const visit = (request, parent, chain) => {
    if (++reads > maxRequests || chain.length > maxDepth) {
      throw oatsError("resource-limit", "package dependency graph budget exceeded");
    }
    const record = readPackage(request, parent, chain);
    if (!record || typeof record.package !== "string" || !record.package || typeof record.sourceKey !== "string" || !record.sourceKey
        || !Array.isArray(record.dependencyRequests)) throw oatsError("invalid-package-manifest", "package source adapter returned incomplete graph data");
    const id = record.package;
    if (chain.includes(id)) throw oatsError("dependency-cycle", `package dependency cycle: ${[...chain, id].join(" → ")}`, [...chain, id]);
    if (resolved.has(id)) {
      const previous = resolved.get(id);
      if (previous.sourceKey !== record.sourceKey) {
        throw oatsError("duplicate-package-identity", `two sources claim package "${id}" at ${context}: ${previous.sourceKey} and ${record.sourceKey}`,
          [...(previous.origins ?? [previous.sourceKey]), ...(record.origins ?? [record.sourceKey])]);
      }
      // A source adapter may reuse an already staged root. Never discard the
      // authoritative copy merely because another edge reached it again.
      if (record.dir !== previous.dir) discardPackage(record, previous);
      return id;
    }
    if (resolved.size + chain.length >= maxPackages) throw oatsError("resource-limit", "package identity budget exceeded");
    validatePackage(record);
    const deps = record.dependencyRequests.map((dependency) => visit(dependency, record, [...chain, id]));
    const complete = finalizePackage(record, deps);
    if (!complete || complete.package !== id || complete.sourceKey !== record.sourceKey) throw oatsError("invalid-package-manifest", "package finalizer changed graph identity");
    resolved.set(id, complete);
    return id;
  };
  const roots = requests.map((request) => visit(request, null, []));
  return { roots, packages: resolved };
}
