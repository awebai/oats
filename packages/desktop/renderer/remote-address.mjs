/** Which roster rows can be addressed, why a row can't, and the copy for a remote read or plan
 * that the host (or this machine's router) refused. Shared by the renderer and the server. */
import { unsupportedSession } from './instance-presentation.mjs';

/** A local row, or a remote row the kernel reports addressable (routed by `--server <id> --home <abs>`).
 * A local OATS before 0.31 reports no `addressable` at all: a row it spawned keeps its saved route. */
export const canAddressRemote = row => !!row && (!row.server || row.addressable === true
  || (row.addressable === undefined && row.savedRoute === true));

/** The server's registration label as the roster reports it, else its id. */
export const serverLabel = row => row?.repoName || row?.server || '';

/** Why a remote row is refused when the kernel does not report it addressable. */
export function unaddressableSentence(row) {
  const label = serverLabel(row);
  if (row.missingRemotely === true) return `${row.instance} is no longer on ${label}. Remove it from this computer with: oats server forget ${row.server} --instance ${row.instance}`;
  return row.addressable === undefined ? `This computer's OATS does not report whether ${label} can reach this instance. Update OATS here.`
    : `${label} did not report this instance as reachable.`;
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
  E_REMOTE_INCOMPATIBLE: label => `${label} runs an OATS that can't do this yet.`,
  E_SNAPSHOT_UNKNOWN: label => `${label} doesn't list this instance any more.`,
  E_HOME_MISMATCH: label => `${label} answered for a different instance. Nothing was changed.`,
  E_AMBIGUOUS: label => `${label} answered for a different instance. Nothing was changed.`,
  // Transport: ssh itself failed, or this machine's own deadline on the remote read passed.
  E_SSH: label => `Couldn't reach ${label}.`,
  E_CLI_TIMEOUT: label => `Couldn't reach ${label}.`,
};
/** The headline for a remote failure: the table's, else the view's own sentence for the code. */
export const remoteHeadline = (code, label, fallback) => Object.hasOwn(HEADLINES, code) ? HEADLINES[code](label) : fallback;

export const readingFrom = label => `Reading from ${label}…`;

/** A failure's Details line: its code, and the kernel's own message when a remote host sent one. */
export const codeLine = reason => {
  const code = typeof reason?.code === 'string' && reason.code ? reason.code : null;
  const detail = typeof reason?.detail === 'string' && reason.detail ? reason.detail : null;
  return code && detail ? `${code}: ${detail}` : code;
};

const CODE = /^E_[A-Z0-9_]{1,64}$/;
const UNSAFE = /[\x00-\x08\x0b-\x1f\x7f]|[a-z][a-z0-9+.-]*:\/\/[^\s/]*@|(?:token|authorization|password|secret|api[_ -]?key)\s*[:=]\s*\S+|(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{16,}/i;
const MAX_MESSAGE = 512, MAX_DETAIL = 2048;
const detailOf = v => typeof v !== 'string' || !v ? null : UNSAFE.test(v) ? '[Detail withheld]' : v.slice(0, MAX_DETAIL);

/** A host's (or the remote transport's) refusal: the kernel's code verbatim, a headline, and the
 * kernel's message as the detail. Null for anything not shaped like a kernel error. */
export function hostReason(error, label, fallback) {
  if (!error || typeof error.code !== 'string' || !CODE.test(error.code)) return null;
  return { code: error.code, message: remoteHeadline(error.code, label, fallback), detail: detailOf(error.message), remote: true };
}

/** This machine's OATS has no `remote` entry for the operation: nothing was sent. */
export const unroutableReason = label => ({ code: 'unsupported-remote-operation',
  message: `This computer's OATS can't route this to ${label}. Update OATS here.`, detail: null, remote: true });

/** Re-validate a relayed remote reason (server → main → renderer), or null. */
export function remoteReason(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !['code', 'message', 'detail', 'remote'].includes(k))
    || v.remote !== true || typeof v.code !== 'string' || !(CODE.test(v.code) || v.code === 'unsupported-remote-operation')
    || typeof v.message !== 'string' || !v.message || v.message.length > MAX_MESSAGE || UNSAFE.test(v.message)
    || !(v.detail === null || typeof v.detail === 'string' && v.detail.length <= MAX_DETAIL && !UNSAFE.test(v.detail))) return null;
  return { code: v.code, message: v.message, detail: v.detail, remote: true };
}
