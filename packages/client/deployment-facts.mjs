/** Display text for an instance's workspace-model v2 facts, exactly as
 * `oats status --json` reported them. Formatting only: no drift is computed,
 * no identity is derived from names, and absent facts stay absent. */
const text = value => typeof value === 'string' && value ? value : null;
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
