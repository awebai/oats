/** Display text for an instance's workspace-model v2 facts, exactly as
 * `oats status --json` reported them. Formatting only: no drift is computed,
 * no identity is derived from names, and absent facts stay absent. */
const text = value => typeof value === 'string' && value ? value : null;
const short = value => typeof value === 'string' && /^[0-9a-f]{7,}$/.test(value) ? value.slice(0, 7) : value;
/** A member's display label from its repo key (the kernel's `memberLabel`). */
export const memberLabel = key => String(key || '').split('/').filter(Boolean).pop()?.replace(/\.git$/, '') || String(key || '');

/** `acts as <address> via grant, expires <t>` / `alias <alias> on <team>`. */
export function servedIdentityText(identity) {
  if (!identity || typeof identity !== 'object') return null;
  if (identity.mode === 'global' && identity.grant) {
    return `acts as ${text(identity.address) || text(identity.alias) || text(identity.resident) || '?'} via grant${text(identity.grant.expiresAt) ? `, expires ${identity.grant.expiresAt}` : ''}`;
  }
  return `alias ${text(identity.alias) || '?'} on ${text(identity.team) || '?'}`;
}

/** `repo: <member> @ <c7>`, with the kernel's drift status when not current. */
export function soulSourceText(soul) {
  if (!soul || typeof soul !== 'object' || !text(soul.repoKey)) return null;
  const base = `repo: ${memberLabel(soul.repoKey)} @ ${short(soul.commit) || '?'}`;
  if (soul.status === 'moved') return `${base} — member moved since (now @ ${short(soul.current) || '?'})`;
  if (soul.status && soul.status !== 'current') return `${base} — ${soul.status}`;
  return base;
}

/** Drift rows → a summary; a recorded map (workspace unreachable) says so. */
export function moduleDriftText(modules) {
  if (Array.isArray(modules)) {
    if (!modules.length) return 'None';
    const notCurrent = modules.filter(row => row?.status !== 'current');
    if (!notCurrent.length) return `${modules.length} current`;
    return notCurrent.map(row => {
      const from = row.from?.kind === 'package' ? `package ${row.from.package || '?'}` : `member ${memberLabel(row.from?.repoKey)}`;
      const why = row.status === 'missing' && text(row.reason) ? ` (${row.reason})` : '';
      // A moved row names its versions when the kernel reports them (current.version, kernel #217):
      // the recorded one from its origin, the current one beside the current commit.
      const now = row.status === 'moved' ? text(row.current?.version) : null, was = now ? text(row.from?.version) : null;
      const status = row.status === 'moved' ? (now ? `moved ${was ? `${was} → ${now}` : `to ${now}`}` : 'moved since') : row.status || 'unknown';
      return `${row.name}: ${status}${why} — ${from} @ ${short(row.commit) || '?'}`;
    }).join('; ') + `; ${modules.length - notCurrent.length} current`;
  }
  if (modules && typeof modules === 'object') return `${Object.keys(modules).length} recorded — drift not observed (workspace unreachable)`;
  return null;
}
