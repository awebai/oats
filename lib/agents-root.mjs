/** The agents root a command works in: found by walking up from a directory (findRoot), or checked
 *  where one is named (ensureRoot), and its canonical spelling. A leaf (awebai/oats#1630): the hot reads
 *  resolve their scope without loading core.mjs, which re-exports these. */
import { existsSync, lstatSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { resolvedDeployment } from "./resolved-deployment.mjs";
import { oatsError } from "./errors.mjs";
import { canonicalDeploymentPath } from "./deployment-path.mjs";

// ---------- root discovery ----------
/** Closest agents/ walking up from `cwd`. A deployment whose agents/ was never
 * created has no root here; ensureRoot names the remedy. */
export function findRoot(cwd = process.cwd()) {
  if (process.env.PI_AGENTS_ROOT) return resolve(process.env.PI_AGENTS_ROOT);
  let d = resolve(cwd);
  while (true) {
    if (basename(d) === "agents" && lstatSync(d).isDirectory()) return d;
    const candidate = join(d, "agents");
    if (existsSync(candidate) && lstatSync(candidate).isDirectory()) return candidate;
    const parent = dirname(d);
    if (parent === d) return undefined;
    d = parent;
  }
}

/** The canonical deployment root — where instance homes belong. */
export function canonicalAgentsRoot(root) { return canonicalDeploymentPath(root); }
export function ensureRoot(cwd) {
  const root = findRoot(cwd);
  if (!root) {
    const from = resolve(cwd ?? process.cwd());
    // Workspace model: an oats-local.yaml above `from` IS a deployment whose instance
    // root (<deployment>/agents/) was never created — name that remedy, not a v1 verb.
    let localDeployment = null;
    for (let d = from; ; d = dirname(d)) { if (existsSync(join(d, "oats-local.yaml"))) { localDeployment = d; break; } if (dirname(d) === d) break; }
    if (localDeployment) {
      throw oatsError("E_NO_DEPLOYMENT",
        `no instance root walking up from ${from}: ${join(localDeployment, "oats-local.yaml")} names this deployment but ${join(localDeployment, "agents")} does not exist — mkdir ${join(localDeployment, "agents")} (or run \`oats sync --dir ${localDeployment}\`, which creates it)`,
        { from, looked: ["agents/"], deployment: localDeployment, local: join(localDeployment, "oats-local.yaml"), remedy: `mkdir ${join(localDeployment, "agents")} (or run oats sync)` });
    }
    throw oatsError("E_NO_DEPLOYMENT",
      `no deployment found walking up from ${from}: no agents/ directory — run from the deployment (where oats-local.yaml lives; \`oats onboard\` creates one), or set PI_AGENTS_ROOT`,
      { from, looked: ["agents/"] });
  }
  // Deployment root ≠ invocation CWD: homes always land in the primary checkout.
  const canonical = canonicalAgentsRoot(root);
  resolvedDeployment(dirname(canonical), { canonical: true });
  return canonical;
}
