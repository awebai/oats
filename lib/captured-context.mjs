/** lib/captured-context.mjs — the refusal of an inherited captured context (the captured/portable path was
 *  removed in 0.26): an environment that carries OATS_RESOLUTION or OATS_DEPLOYMENT runs no kernel command
 *  but `version`, never against the current context in its place. The CLI's dispatch asks it for every
 *  command; a process answering reads asks it for each request. Kernel-private, not exported from
 *  `./core`. Dependency-free. */

/** → null, or the refusal `{ code: "E_UNSUPPORTED_MODE", message, details: { inherited } }` of `env`. */
export function inheritedContextRefusal(env) {
  const inherited = ["OATS_RESOLUTION", "OATS_DEPLOYMENT"].filter((k) => env[k]);
  if (!inherited.length) return null;
  return { code: "E_UNSUPPORTED_MODE", message: `this environment carries a captured context (${inherited.join(", ")}): the captured/portable path was removed in 0.26, and nothing is run against the current context in its place — retire the captured home and re-spawn it from the deployment`, details: { inherited } };
}
