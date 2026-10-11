/** Display text for an instance's workspace-model v2 facts, exactly as
 * `oats status --json` reported them, and for a deployment that is not observed.
 * Formatting only: no drift is computed, no identity is derived from names,
 * and absent facts stay absent.
 * A page loads this module: it imports no Node builtin, and must not (the
 * panel's own functions, which do, are in deployment-panel.mjs). */
import { requireTerms } from './client-terms.mjs';

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

/** The message for a deployment the kernel could not observe (workspace model v2): the sentence a
 * client shows in place of its rows. Still reading (no deployment yet, or `pending`) says so; an
 * observed deployment has none (''). A missing advertised feature is named, in the client's terms
 * (client-terms.mjs: the client that needs it); a kernel refusal keeps its code and message. */
export function deploymentUnavailableText(deployment, terms) {
  requireTerms(terms, 'deploymentUnavailableText');
  if (!deployment || deployment.status === 'pending') return 'Reading the deployment through the installed OATS CLI…';
  if (deployment.status === 'observed') return '';
  const reason = deployment.reason || {};
  if (reason.feature) return `The installed OATS CLI does not advertise ${reason.feature}, which the ${terms.name} needs to show this deployment. Update OATS and retry.`;
  const code = text(reason.code), message = text(reason.message);
  return code && message ? `${code}: ${message}` : message || 'The deployment could not be observed.';
}
