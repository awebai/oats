/** lib/deprecation.mjs — the one deprecated-name warning a command answers with.
 *
 * runtime → harness (0.27.0, lead decision call 6): persisted inputs and CLI flags
 * written before 0.27.0 keep working — read either, write new — and every read of
 * the old spelling is noted here. A command answers with ONE warning naming what
 * it read (the JSON envelope's `warnings[]`, or stderr in text mode), never more.
 */
const sources = new Set();

/** Note one read of `runtime` where `harness` is meant; `where` names the key's home. */
export function noteRuntimeName(where) { sources.add(where); }

/** The command's one `deprecated-runtime-name` warning, or null when nothing old was read. */
export function runtimeNameWarning() {
  if (!sources.size) return null;
  const list = [...sources];
  return {
    code: "deprecated-runtime-name", key: "runtime", replacement: "harness", sources: list,
    message: `\`runtime\` was renamed to \`harness\` in 0.27.0; the old name is still read here (${list.join("; ")}) and a later release drops it`,
  };
}

/** For tests: forget what was noted. */
export function resetRuntimeNames() { sources.clear(); }
