/** Explicit independent-dispatch selectors, with the captured command's own
 * environment as a propagation channel. Never infer a record from cwd/locks. */
import { isAbsolute } from "node:path";
import { validateResolutionRef } from "./resolution-shape.mjs";
import { oatsError } from "./errors.mjs";

export function capturedSelector(argv, env = process.env) {
  const values = new Map(), args = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") { args.push(...argv.slice(i)); break; }
    const match = /^(--deployment|--resolution|--artifact-set)(?:=(.*))?$/.exec(arg);
    if (!match) { args.push(arg); continue; }
    const name = match[1].slice(2), value = match[2] ?? argv[++i];
    if (values.has(name) || !value || value.startsWith("--")) throw oatsError("E_BAD_ARGS", `--${name} needs one unambiguous value`);
    values.set(name, value);
  }
  const explicit = values.size > 0;
  const deployment = explicit ? values.get("deployment") : env.OATS_DEPLOYMENT;
  if (values.has("resolution") && values.has("artifact-set")) throw oatsError("E_BAD_ARGS", "choose a resolution or an artifact set, never both");
  const artifactSet = values.get("artifact-set");
  const id = explicit ? artifactSet ?? values.get("resolution") : env.OATS_RESOLUTION;
  if (!explicit && deployment === undefined && id === undefined) return null;
  if (typeof deployment !== "string" || !isAbsolute(deployment) || typeof id !== "string") throw oatsError("E_BAD_ARGS", "portable selectors need --deployment <absolute path> and one --resolution or --artifact-set <sha256-id>");
  const resolution = { schemaVersion: 1, id };
  validateResolutionRef(resolution);
  return { deployment, ...(artifactSet === undefined ? { resolution } : { artifactSet }), args, explicit };
}
