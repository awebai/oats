/** resolveInstance: an instance name, and optionally the home claimed for it, resolved to exactly one
 *  home under an agents root. A leaf (awebai/oats#1630): `oats instance events` and `instance waiting`
 *  resolve their home without loading instance-lifecycle.mjs or core.mjs; instance-lifecycle.mjs
 *  re-exports it. */
import { findInstanceHomes } from "./soul-listing.mjs";
import { oatsError } from "./errors.mjs";

/** Resolve `<name>` under the deployment's agents root to exactly one home. */
export function resolveInstance(ctx, root, name, { home } = {}) {
  const roots = [root];
  const candidates = [];
  for (const rt of roots) for (const hit of findInstanceHomes(rt, name)) candidates.push({ root: rt, agent: hit.agent?.name ?? null, home: hit.home });
  if (home !== undefined) {
    const found = candidates.find((c) => c.home === home);
    if (!found) throw oatsError("E_HOME_MISMATCH", `--home ${home} is not a home of instance ${JSON.stringify(name)} under ${roots.join(", ")}`);
    return found;
  }
  if (!candidates.length) throw oatsError("E_SESSION_UNKNOWN", `no instance ${JSON.stringify(name)} under ${roots.join(", ")}`);
  if (candidates.length > 1) throw Object.assign(oatsError("E_AMBIGUOUS_INSTANCE", `instance ${JSON.stringify(name)} has ${candidates.length} homes; pass --home <abs>`), { candidates });
  return candidates[0];
}
