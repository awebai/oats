/** Soul team rows, shared by the spawn-preview contract and the teams panel. No I/O.
 * 0.29: {label, team, mapped}. Team model v2 (0.30): {label, team, default, from}. */
const record = v => !!v && typeof v === 'object' && !Array.isArray(v);
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const text = (v, max = 256) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\x00-\x1f\x7f]/.test(v);
/** The kernel's team-id rule (provider-neutral, a safety rule): what every generic reader accepts.
 * Only the Desktop's aweb team form (the teams route's argv) keeps the stricter `<name>:<namespace>`. */
export const TEAM_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,255}$/;
const teamId = v => typeof v === 'string' && TEAM_ID.test(v);
/** One soul team row: 0.29 {label, team, mapped} or team model v2 (0.30) {label, team, default, from}.
 * A v2 row keeps `default`/`from` and gains `mapped` = (team !== null), the same fact the 0.29 row
 * states, so existing views read both. Idempotent: a projected v2 row re-validates. */
export function teamRow(t) {
  if (!record(t) || typeof t.label !== 'string' || !LABEL.test(t.label) || !(t.team === null || teamId(t.team))) return null;
  if (Object.hasOwn(t, 'default')) {
    // The known keys are validated; others (a payload, as 0.29 rows carry) are ignored, never passed on.
    if (typeof t.default !== 'boolean' || !text(t.from, 32) || (Object.hasOwn(t, 'mapped') && t.mapped !== (t.team !== null))) return null;
    return { label: t.label, team: t.team, mapped: t.team !== null, default: t.default, from: t.from };
  }
  if (typeof t.mapped !== 'boolean' || (t.mapped ? t.team === null : t.team !== null)) return null;
  return { label: t.label, team: t.team, mapped: t.mapped };
}

/** The kernel's DefaultTeam: `{label, team: <id>|null (unmapped), from}`, `from` being `soul` or
 * `deployment` (team model v2), or `workspace` too (team model 3: the workspace's defaultTeam). Null when
 * none is configured, or undefined when the value is not that shape. */
export function defaultTeamOf(v) {
  if (v === null) return null;
  if (!record(v) || typeof v.label !== 'string' || !LABEL.test(v.label) || !(v.team === null || teamId(v.team)) || !['deployment', 'soul', 'workspace'].includes(v.from)) return undefined;
  return { label: v.label, team: v.team, from: v.from };
}
/** A list of v2 TeamRows (the default first), or undefined when any row is not one. */
export function teamRowsOf(v, { v2 = true } = {}) {
  if (!Array.isArray(v) || v.length > 128) return undefined;
  const rows = v.map(teamRow);
  if (rows.some(r => !r || (v2 && !Object.hasOwn(r, 'default'))) || new Set(rows.map(r => r.label)).size !== rows.length) return undefined;
  return rows;
}
export const TEAM_LABEL_PATTERN = LABEL;
/** The team model a CLI's features report: 3 (feature team-model-3, OATS 0.38: a soul's teams are
 * committed in the workspace), 2 (team-model-2, OATS 0.30–0.37), or null (before: the 0.29 views). */
export function teamModelOf(features) {
  const list = Array.isArray(features) ? features : [];
  return list.includes('team-model-3') ? 3 : list.includes('team-model-2') ? 2 : null;
}
