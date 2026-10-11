/* oats desktop — the gate-relevant identity of a CLI probe (server + renderer).

   Every capability gate in the app (spawn, schedules, automations, inspect,
   the capabilities catalog…) is keyed on the probe payload, and every
   subscriber treats "the probe changed" as "the CLI changed": caches are
   wiped, catalogs re-fetched, cards repainted. A window-focus reprobe of the
   SAME binary returns a payload that is identical in every gate-relevant
   field yet never byte-identical — `probedAt` is minted per probe and the
   `tried`/`source` diagnostics describe how the locator got there, not what
   it found. Comparing payloads by this signature instead of by identity is
   what makes a no-change reprobe a no-op end to end.

   Pure data; no node: imports so the renderer can share it with the server. */

/** Top-level fields that legitimately differ between two probes of the same
 * CLI and therefore never participate in the signature. */
export const PROBE_DIAGNOSTIC_FIELDS = Object.freeze(['probedAt', 'tried', 'source']);
const DIAGNOSTIC = new Set(PROBE_DIAGNOSTIC_FIELDS);

/* Object keys are sorted at every depth so the serialization order a
 * producer happens to use can never fake a change; array order IS meaning
 * (features/harnesses are ordered lists) and is kept. `undefined` members
 * vanish exactly as JSON.stringify would drop them. */
function canonical(value, top) {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(v => canonical(v, false));
  const out = {};
  for (const key of Object.keys(value).sort()) {
    if (top && DIAGNOSTIC.has(key)) continue;
    if (value[key] !== undefined) out[key] = canonical(value[key], false);
  }
  return out;
}

/** JSON string over the gate-relevant fields of a probe/status payload.
 * null/undefined (probe not settled) → 'null', distinct from any payload,
 * including `{}`. */
export function probeSignature(state) {
  return state == null ? 'null' : JSON.stringify(canonical(state, true));
}

/** True when `after` describes a different CLI/capability set than `before`
 * in any gate-relevant field. */
export function probeChanged(before, after) {
  return probeSignature(before) !== probeSignature(after);
}
