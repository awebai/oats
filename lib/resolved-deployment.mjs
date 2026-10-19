/** lib/resolved-deployment.mjs — the first local deployment a command resolved, for this computer's
 *  deployments list (awebai/oats#1390; lib/deployments.mjs listResolved).
 *
 *  The resolvers report the deployment directory they found: `loadLocal` (lib/workspace.mjs) the
 *  directory of the oats-local.yaml its walk up found, `ensureRoot` (lib/core.mjs) the directory of
 *  the canonical agents root. Nothing happens until the CLI sets an observer for this process (the
 *  commands in its one table), so library callers and tests are unaffected unless they opt in. The
 *  observer is called once per process, with the first deployment reported, and never throws into
 *  the resolver: the command's own resolution is all it costs. Dependency-free.
 */
let observer = null;
let called = false;

/** Observe the first deployment this process resolves (idempotent: the last observer set wins). */
export function observeResolvedDeployment(fn) { observer = fn; }

/** A resolver found the deployment directory `dir`. */
export function resolvedDeployment(dir) {
  if (!observer || called) return;
  called = true;
  try { observer(dir); } catch { /* the observer's failure is never the command's */ }
}
