/** Soul team rows, shared by the spawn-preview contract and the teams panel. No I/O.
 * 0.29: {label, team, mapped}. Team model v2 (0.30): {label, team, default, from}. */
const record = v => !!v && typeof v === 'object' && !Array.isArray(v);
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const text = (v, max = 256) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\x00-\x1f\x7f]/.test(v);
/** One soul team row: 0.29 {label, team, mapped} or team model v2 (0.30) {label, team, default, from}.
 * A v2 row keeps `default`/`from` and gains `mapped` = (team !== null), the same fact the 0.29 row
 * states, so existing views read both. Idempotent: a projected v2 row re-validates. */
export function teamRow(t) {
  if (!record(t) || typeof t.label !== 'string' || !LABEL.test(t.label) || !(t.team === null || text(t.team))) return null;
  if (Object.hasOwn(t, 'default')) {
    // The known keys are validated; others (a payload, as 0.29 rows carry) are ignored, never passed on.
    if (typeof t.default !== 'boolean' || !text(t.from, 32) || (Object.hasOwn(t, 'mapped') && t.mapped !== (t.team !== null))) return null;
    return { label: t.label, team: t.team, mapped: t.team !== null, default: t.default, from: t.from };
  }
  if (typeof t.mapped !== 'boolean' || (t.mapped ? t.team === null : t.team !== null)) return null;
  return { label: t.label, team: t.team, mapped: t.mapped };
}
