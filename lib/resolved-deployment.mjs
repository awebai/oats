/** lib/resolved-deployment.mjs — the deployment a command resolved, for this computer's deployments
 *  list (awebai/oats#1390; lib/deployments.mjs listResolved).
 *
 *  The resolvers report the deployment directory they found: `loadLocal` (lib/workspace.mjs) the
 *  directory of the oats-local.yaml its walk up found, as spelled; `ensureRoot` (lib/core.mjs) the
 *  directory of the canonical agents root, `canonical`. The observer is called once, when the
 *  process exits, with the root the command settled on: the first canonical one reported, else the
 *  first one. So a command that resolves its canonical root is compared with that root, never with
 *  an earlier spelling of the same deployment. Nothing happens until the CLI sets an observer for
 *  this process (the commands in its one table): library callers and tests are unaffected unless
 *  they opt in. The observer never throws into the command, nor changes its exit status.
 *  Dependency-free.
 */
let observer = null;
const reported = { canonical: null, spelled: null };

/** Observe the deployment this process resolves; called once, at exit. */
export function observeResolvedDeployment(fn) {
  if (!observer) process.once("exit", settleResolvedDeployment);
  observer = fn;
}

/** A resolver found the deployment directory `dir` (`canonical`: its canonical spelling). */
export function resolvedDeployment(dir, { canonical = false } = {}) {
  if (!observer) return;
  if (canonical) reported.canonical ??= dir;
  else reported.spelled ??= dir;
}

/** Call the observer with the settled root, once (the exit handler; exported for tests). */
export function settleResolvedDeployment() {
  const fn = observer, dir = reported.canonical ?? reported.spelled;
  observer = null;
  if (!fn || !dir) return;
  try { fn(dir); } catch { /* the observer's failure is never the command's */ }
}
