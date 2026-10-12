/** Display text for an instance's workspace-model v2 facts, exactly as
 * `oats status --json` reported them, and for a deployment that is not observed.
 * Formatting only: no drift is computed, no identity is derived from names,
 * and absent facts stay absent.
 * A page loads this module: it imports no Node builtin, and must not (the
 * panel's own functions, which do, are in deployment-panel.mjs). */
import { requireTerms } from './client-terms.mjs';
import { displayLine, DETAIL_WITHHELD } from './display-text.mjs';
import { deploymentErrorCode } from './deployment-contract.mjs';

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

/**
 * The parts of what a client shows for a deployment the kernel could not observe (workspace model v2), in the
 * order they are shown: `{ headline, lead, sentence }`, each one line or null. A fresh object at every call.
 *
 *   still reading (no deployment yet, or `pending`)   headline: that it is being read
 *   observed                                          every part null
 *   a missing advertised feature (`reason.feature`)   headline: the feature, in the client's terms
 *                                                     (client-terms.mjs: the client that needs it)
 *   the kernel refused (`reason.origin === 'kernel'`  headline: "OATS answered with an error (<code>)."
 *     and a code the reader admits)                   lead: "It says:"; sentence: the kernel's message
 *   any other reason                                  headline: `<code>: <message>`, or the message, or that
 *                                                     the deployment could not be observed
 *
 * `sentence` is the only part that can carry words the client did not write: the kernel's message through
 * the display filter (display-text.mjs `displayLine`), one line, whole or DETAIL_WITHHELD, never cut by its
 * words, parsed or matched. A message the filter withholds, or one with nothing to show, is not introduced:
 * no lead (the rule of lifecycle-contract.mjs `busyRefusal`). The reason is attributed to the kernel only by
 * its mark, which the reader gives to the error the installed CLI printed (deployment-read-cli.mjs); any other
 * value of `origin`, or the mark with a code the reader would not have admitted, reads as none. A reason
 * without the mark is one the client made itself (deployment-contract.mjs `deploymentFailure`): its message is
 * the client's own sentence, shown as it is.
 *
 * A client that sets the kernel's words apart from its own (a quote, another style) calls this; one that
 * shows one line calls `deploymentUnavailableText`.
 */
export function deploymentUnavailableParts(deployment, terms) {
  requireTerms(terms, 'deploymentUnavailableParts');
  const own = headline => ({ headline, lead: null, sentence: null });
  if (!deployment || deployment.status === 'pending') return own('Reading the deployment through the installed OATS CLI…');
  if (deployment.status === 'observed') return own(null);
  const reason = deployment.reason || {};
  if (reason.feature) return own(`The installed OATS CLI does not advertise ${reason.feature}, which the ${terms.name} needs to show this deployment. Update OATS and retry.`);
  if (reason.origin === 'kernel' && deploymentErrorCode(reason.code)) {
    const sentence = displayLine(reason.message);
    return { headline: `OATS answered with an error (${reason.code}).`, lead: sentence !== null && sentence !== DETAIL_WITHHELD ? 'It says:' : null, sentence };
  }
  const code = text(reason.code), message = text(reason.message);
  return own(code && message ? `${code}: ${message}` : message || 'The deployment could not be observed.');
}

/** Whether what a client holds for a deployment is a kept failure: its last read failed and what was
 * observed before is still shown (deployment-panel.mjs `failedEntry`). `held` is a deployment's entry or
 * a panel made from one (panel-views.mjs `deploymentPanel`, `panelData`); the answer is null, or
 *
 *   { message, origin }     message: the failure's text, a string, possibly empty
 *                           origin: "kernel" when the installed CLI printed it, else null
 *
 * **The fact does not depend on the text.** `error` is a string exactly when a failure is kept, and an
 * empty, blank or withheld message is as much a kept failure as any other: a kernel that fails with no
 * words has still failed. This is the one place that decides it. A client asks here whether a deployment
 * is stale and never tests `error` for truth, so the shared reason and each of a client's notices agree.
 *
 * `origin` is `errorOrigin` read strictly: the one value `failedEntry` writes, anything else null. A
 * panel of another machine (remote-roster.mjs `remotePanel`) never carries the key; its `error` is a
 * string while that machine was not reached, and reads here as a failure with no speaker.
 * Not on the stable surface. */
export function keptFailure(held) {
  if (held === null || typeof held !== 'object' || typeof held.error !== 'string') return null;
  return { message: held.error, origin: held.errorOrigin === 'kernel' ? 'kernel' : null };
}

/** The sentence a client shows in place of a deployment's rows when the kernel could not observe it: the parts
 * that are there (`deploymentUnavailableParts`), joined by one space. '' for an observed deployment. */
export function deploymentUnavailableText(deployment, terms) {
  requireTerms(terms, 'deploymentUnavailableText');
  const { headline, lead, sentence } = deploymentUnavailableParts(deployment, terms);
  return [headline, lead, sentence].filter(part => part !== null).join(' ');
}
