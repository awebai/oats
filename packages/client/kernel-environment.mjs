/** The variables an OATS instance session carries. A client started from inside one (a terminal in
 * an agent's pane) inherits them, and a kernel command that runs with them answers for that instance
 * instead of the directory it was asked about. The reads that name their own deployment remove them. */
export const INSTANCE_VARIABLES = Object.freeze(['PI_AGENTS_ROOT', 'PI_AGENT_HOME', 'PI_AGENT_INSTANCE', 'OATS_HOME', 'OATS_INSTANCE_HOME', 'OATS_INSTANCE', 'OATS_DEPLOYMENT', 'OATS_RESOLUTION']);

/** A copy of `env` without the instance variables. `env` is never changed. */
export function withoutInstanceVariables(env) {
  const out = { ...env };
  for (const name of INSTANCE_VARIABLES) delete out[name];
  return out;
}
