/** Which roster rows can be addressed, why a row can't, and the copy for a remote read or plan
 * that the host (or this machine's router) refused. Shared by the renderer and the server. */
import { unsupportedSession } from './instance-presentation.mjs';
import { displayLine, cleanLine, DETAIL_WITHHELD } from './display-text.mjs';

/** A local row, or a remote row the kernel reports addressable (routed by `--server <id> --home <abs>`).
 * A local OATS before 0.31 reports no `addressable` at all: a row it spawned keeps its saved route. */
export const canAddressRemote = row => !!row && (!row.server || row.addressable === true
  || (row.addressable === undefined && row.savedRoute === true));

/** The server's registration label as the roster reports it, else its id. */
export const serverLabel = row => row?.repoName || row?.server || '';

/** The server's label as a sentence shows it: one display line (display-text.mjs), so the sentence is one
 * too. A label with nothing to show, or a withheld one, reads "the server", the words the fixed sentences
 * already use. For the sentence only: routing, comparison and requests keep the label and the server id
 * as they are. `first`: the label opens the sentence. */
export const shownLabel = (label, first = false) => {
  const line = displayLine(label);
  return line === null || line === DETAIL_WITHHELD ? first ? 'The server' : 'the server' : line;
};

/** Why a remote row is refused when the kernel does not report it addressable. */
export function unaddressableSentence(row) {
  const label = serverLabel(row);
  if (row.missingRemotely === true) return `${row.instance} is no longer on ${shownLabel(label)}. Remove it from this computer with: oats server forget ${row.server} --instance ${row.instance}`;
  return row.addressable === undefined ? `This computer's OATS does not report whether ${shownLabel(label)} can reach this instance. Update OATS here.`
    : `${shownLabel(label, true)} did not report this instance as reachable.`;
}

/** Why a row can't be opened, as `{key, label, sentence}`, or null when nothing stands in the way.
 * `label` is the roster meta line's state segment; `sentence` is the row's title, accessible
 * description and actions-menu reason. */
export function rowReason(row) {
  const label = serverLabel(row);
  const herdr = unsupportedSession(row);
  if (herdr) return { key: 'herdr', label: 'Herdr no longer supported', sentence: herdr };
  if (row.server && row.serverUnreached) return { key: 'unreached', label: `${label} not reached`,
    sentence: row.runtimeError || `${label} was not reached.` };
  if (row.server && row.missingRemotely === true) return { key: 'missing', label: `gone from ${label}`, sentence: unaddressableSentence(row) };
  if (!canAddressRemote(row)) return { key: 'unaddressable', label: `not reachable on ${label}`, sentence: unaddressableSentence(row) };
  if (row.running == null) return { key: 'unknown', label: 'state unknown', sentence: row.runtimeError || `${row.instance}: status unknown` };
  return null;
}

const HEADLINES = {
  E_REMOTE_INCOMPATIBLE: label => `${shownLabel(label, true)} runs an OATS that can't do this yet.`,
  E_SNAPSHOT_UNKNOWN: label => `${shownLabel(label, true)} doesn't list this instance any more.`,
  E_HOME_MISMATCH: label => `${shownLabel(label, true)} answered for a different instance. Nothing was changed.`,
  E_AMBIGUOUS: label => `${shownLabel(label, true)} answered for a different instance. Nothing was changed.`,
  // Transport: ssh itself failed, or this machine's own deadline on the remote read passed.
  E_SSH: label => `Couldn't reach ${shownLabel(label)}.`,
  E_CLI_TIMEOUT: label => `Couldn't reach ${shownLabel(label)}.`,
};
/** The headline for a remote failure: the table's, else the view's own sentence for the code. The
 * server's label is shown as one display line, so a headline is always one. */
export const remoteHeadline = (code, label, fallback) => Object.hasOwn(HEADLINES, code) ? HEADLINES[code](label) : fallback;

export const readingFrom = label => `Reading from ${label}…`;

/** A host's E_REMOTE_INCOMPATIBLE for a panel read (the context panel's Soul tab and teams): the server,
 * what it can't show and what to upgrade. `what`: "soul", "teams". */
export const incompatibleSentence = (label, what) =>
  `${shownLabel(label, true)} runs an OATS that can't show this instance's ${what} here (it needs the operations feature). Update OATS on ${shownLabel(label)}.`;

/** Why an instance inspection for a remote row is not sent (an Error for a failed block: the sentence, and
 * the code when there is one), or null. A row the kernel does not report addressable says why; this
 * computer's OATS without remote operations can't route it. A local row is never blocked. */
export function remoteInspectBlock(row, cli) {
  if (!row?.server) return null;
  if (!canAddressRemote(row)) return new Error(unaddressableSentence(row));
  if (!Array.isArray(cli?.remote) || !cli.remote.includes('operations')) {
    const { message, code, detail } = unroutableReason(serverLabel(row));
    return Object.assign(new Error(message), { code, detail });
  }
  return null;
}

/** The error a view's loading state shows for a failed read: the relayed remote reason when the request's
 * error carries one (re-validated where it was received), as an Error with its code and detail; else the
 * error as it came. `what` ("soul", "teams") words a host's E_REMOTE_INCOMPATIBLE for the panel read
 * (incompatibleSentence); without it the relayed headline stands. */
export function relayedFailure(error, label, what = null) {
  const reason = error?.reason;
  if (!reason || typeof reason.message !== 'string') return error;
  const message = what && reason.code === 'E_REMOTE_INCOMPATIBLE' ? incompatibleSentence(label, what) : reason.message;
  return Object.assign(new Error(message), { code: reason.code, detail: reason.detail ?? null });
}

const CODE = /^E_[A-Z0-9_]{1,64}$/;
const MAX_MESSAGE = 512;
/** A code in the kernel's code shape. */
export const kernelCode = v => typeof v === 'string' && CODE.test(v);

/** A failure's Details line as nodes: its code, and the kernel's own message when a host sent one. The
 * code and the colon are text. The message is alone inside a <bdi>, as a text node: its bidirectional
 * layout is isolated from the text around it. Only a message that is already a display line is shown. */
export function codeLineNodes(doc, reason) {
  const code = typeof reason?.code === 'string' && reason.code ? reason.code : null;
  if (!code) return [];
  if (!cleanLine(reason.detail)) return [doc.createTextNode(code)];
  const field = doc.createElement('bdi'); field.append(doc.createTextNode(reason.detail));
  return [doc.createTextNode(`${code}: `), field];
}

/** A host's (or the remote transport's) refusal: the kernel's code verbatim, a headline, and the
 * kernel's message as the detail, through the display filter (one line, or withheld). Null for anything
 * not shaped like a kernel error. */
export function hostReason(error, label, fallback) {
  if (!kernelCode(error?.code)) return null;
  return { code: error.code, message: remoteHeadline(error.code, label, fallback), detail: displayLine(error.message), remote: true };
}

/** This machine's OATS has no `remote` entry for the operation: nothing was sent. */
export const unroutableReason = label => ({ code: 'unsupported-remote-operation',
  message: `This computer's OATS can't route this to ${shownLabel(label)}. Update OATS here.`, detail: null, remote: true });

/** Re-validate a relayed remote reason (server → main → renderer), or null. Its message and its detail
 * are each already a display line (what the filter would return for them), within their limits. */
export function remoteReason(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !['code', 'message', 'detail', 'remote'].includes(k))
    || v.remote !== true || !(kernelCode(v.code) || v.code === 'unsupported-remote-operation')
    || !cleanLine(v.message) || v.message.length > MAX_MESSAGE
    || !(v.detail === null || cleanLine(v.detail))) return null;
  return { code: v.code, message: v.message, detail: v.detail, remote: true };
}
