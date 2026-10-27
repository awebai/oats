/** The machine sweep's answer (`oats session resume --json`, feature `session-resume`), read into a summary of
 * facts and put into the clients' words. session-resume-cli.mjs runs it; this module reads what came back.
 * Shared by the Desktop and the TUI: pure, no IO, no DOM, never throws on data (only resumeNotice throws, on
 * a caller's missing `label`). No sentence names a client's control, so no client terms are needed.
 *
 * The answer: `{schemaVersion: 1, plan, deployments: [{deployment, state, swept, reason?, …}], rows:
 * [{deployment, instance, outcome, reason?, code?, message?, warnings?, …}]}`. The summary:
 *   { resumed: [{instance, deployment, warnings, omitted}],
 *     fresh:   [{instance, deployment, reason, warnings, omitted}],   reason: FRESH_REASONS or null
 *     waiting: [{instance, deployment, reason}],                      a `blocked` row; reason: WAITING_REASONS or null
 *     refused: [{instance, deployment, reason, code, message}],       reason: REFUSED_REASONS or null
 *     optedOut: [deployment],                                         deployments[].reason `opted-out`
 *     unswept:  [{deployment, reason}],                               not swept otherwise; reason: UNSWEPT_REASONS or null
 *     omitted, totals: {resumed, fresh, waiting, refused} }
 * `refused` carries `reason` beside the four fields the spec lists: the words say when a refusal was this
 * boot's. Nothing is read from the kernel's words: no sentence, warning or message is matched. Names, paths,
 * warnings and messages are display lines (display-text.mjs): labels and quotes, never used to address
 * anything. A refused `message` is kernel prose, shown only after `OATS says:`, never alone with its `code`.
 *
 * Tolerant per entry: a row or deployment that does not decode (not a record, a name or path that is not a
 * string, empty or withheld, an unknown outcome) is dropped alone; an unknown reason under a known outcome is
 * null and worded generically; a code not of the kernel's form is null. `already-running` and `skipped` rows
 * are counted nowhere and shown nowhere. The answer around them is closed: one that is not the document (no
 * schemaVersion 1, `plan` not a boolean, `deployments` or `rows` not an array, or either longer than
 * RESUME_ANSWER_ENTRIES) is a protocol failure, never read in part. */
import { displayLine, cleanLine, DETAIL_WITHHELD } from './display-text.mjs';
import { boundedWarnings, boundedWarningsValid } from './launch-prompt-outcome.mjs';

/** At most this many rows (over resumed, fresh, waiting and refused, in the answer's order) and, apart, this
 * many deployment lines (over opted out and unswept, in the answer's order) are kept. What is left out is
 * counted in `omitted`; `totals` keeps the real counts of the rows, which the headline uses. */
export const RESUME_SUMMARY_ROWS = 100;
export const RESUME_SUMMARY_DEPLOYMENTS = 100;
/** The longest `rows` or `deployments` this reader reads: more is a protocol failure, not a summary. */
export const RESUME_ANSWER_ENTRIES = 100_000;
export const FRESH_REASONS = Object.freeze(['no-conversation', 'no-receipts', 'resume-unproven']);
export const WAITING_REASONS = Object.freeze(['resume-confirmation', 'launch-prompt']);
export const REFUSED_REASONS = Object.freeze(['start-refused', 'refused-this-boot']);
export const UNSWEPT_REASONS = Object.freeze(['not-ok', 'unreadable']);
/** The ok:false codes that mean nothing ran: no compatible CLI, or one without the feature. */
const UNSUPPORTED = new Set(['E_CLI_UNAVAILABLE', 'E_RESUME_FEATURE']);
const CODE = /^E_[A-Z0-9_]{1,64}$/;
const KINDS = ['resumed', 'fresh', 'waiting', 'refused'];
const SUMMARY_KEYS = [...KINDS, 'optedOut', 'unswept', 'omitted', 'totals'];

const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const exactKeys = (v, keys) => record(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const known = (list, v) => list.includes(v) ? v : null;
const code = v => typeof v === 'string' && CODE.test(v) ? v : null;
/** A name or a path as a label: one display line, null when it is withheld or there is nothing to show. */
const label = v => { const line = displayLine(v); return line === DETAIL_WITHHELD ? null : line; };
const named = v => cleanLine(v) && v !== DETAIL_WITHHELD;
const count = v => Number.isSafeInteger(v) && v >= 0;
const sum = totals => KINDS.reduce((n, k) => n + totals[k], 0);

/** One counted row as its kind and fact, or null (dropped, or counted nowhere). */
function decodeRow(row) {
  if (!record(row)) return null;
  const instance = label(row.instance), deployment = label(row.deployment);
  if (instance === null || deployment === null) return null;
  switch (row.outcome) {
    case 'resumed': return ['resumed', { instance, deployment, ...boundedWarnings(row.warnings) }];
    case 'fresh': return ['fresh', { instance, deployment, reason: known(FRESH_REASONS, row.reason), ...boundedWarnings(row.warnings) }];
    case 'blocked': return ['waiting', { instance, deployment, reason: known(WAITING_REASONS, row.reason) }];
    case 'refused': return ['refused', { instance, deployment, reason: known(REFUSED_REASONS, row.reason), code: code(row.code), message: displayLine(row.message) }];
    default: return null;
  }
}

/** One deployment line as `['optedOut', path]` or `['unswept', {deployment, reason}]`, or null (swept, or dropped).
 * `opted-out` is the operator's choice whatever `swept` says; any other deployment not swept is unswept. */
function decodeDeployment(d) {
  if (!record(d)) return null;
  const deployment = label(d.deployment);
  if (deployment === null) return null;
  if (d.reason === 'opted-out') return ['optedOut', deployment];
  return d.swept === true ? null : ['unswept', { deployment, reason: known(UNSWEPT_REASONS, d.reason) }];
}

const empty = () => ({ resumed: [], fresh: [], waiting: [], refused: [], optedOut: [], unswept: [], omitted: 0,
  totals: { resumed: 0, fresh: 0, waiting: 0, refused: 0 } });

/** The sweep's `result` as a summary, or null when it is not the document. A plan (`plan: true`) started
 * nothing, so it is the empty summary: none of its rows or deployments is read. */
function summarize(result) {
  if (!record(result) || result.schemaVersion !== 1 || typeof result.plan !== 'boolean'
    || !Array.isArray(result.deployments) || !Array.isArray(result.rows)
    || result.deployments.length > RESUME_ANSWER_ENTRIES || result.rows.length > RESUME_ANSWER_ENTRIES) return null;
  const s = empty();
  if (result.plan) return s;
  let rows = 0, lines = 0;
  for (const row of result.rows) {
    const decoded = decodeRow(row);
    if (!decoded) continue;
    const [kind, fact] = decoded;
    s.totals[kind] += 1;
    if (rows < RESUME_SUMMARY_ROWS) { s[kind].push(fact); rows += 1; } else s.omitted += 1;
  }
  for (const d of result.deployments) {
    const decoded = decodeDeployment(d);
    if (!decoded) continue;
    if (lines < RESUME_SUMMARY_DEPLOYMENTS) { s[decoded[0]].push(decoded[1]); lines += 1; } else s.omitted += 1;
  }
  return s;
}

/**
 * @param {unknown} envelope  what runResumeSweep resolved: the kernel's envelope or a client read error
 * @returns {{kind: 'unsupported'} | {kind: 'busy'} | {kind: 'failed', code: string}
 *   | {kind: 'quiet', summary} | {kind: 'notice', summary}}
 *   `unsupported`: nothing ran (no compatible CLI, or no feature). `busy`: another sweep holds the machine's
 *   lock and nothing started. `failed`: any other refusal, with its code when it has the kernel's form, else
 *   E_CLI_PROTOCOL, as is an answer that does not decode. `notice` when a row was resumed, fresh, blocked
 *   or refused; `quiet` otherwise, also when only opted-out or unswept deployments are left to say.
 */
export function readResumeSweep(envelope) {
  if (record(envelope) && envelope.ok === false) {
    const c = record(envelope.error) ? envelope.error.code : undefined;
    if (UNSUPPORTED.has(c)) return { kind: 'unsupported' };
    if (c === 'E_RESUME_BUSY') return { kind: 'busy' };
    return { kind: 'failed', code: code(c) ?? 'E_CLI_PROTOCOL' };
  }
  const summary = record(envelope) && envelope.ok === true ? summarize(envelope.result) : null;
  if (!summary) return { kind: 'failed', code: 'E_CLI_PROTOCOL' };
  return { kind: sum(summary.totals) > 0 ? 'notice' : 'quiet', summary };
}

/** Whether each kept fact has its kind's exact shape. */
const rowShape = {
  resumed: r => exactKeys(r, ['instance', 'deployment', 'warnings', 'omitted']) && boundedWarningsValid(r.warnings, r.omitted),
  fresh: r => exactKeys(r, ['instance', 'deployment', 'reason', 'warnings', 'omitted']) && (r.reason === null || FRESH_REASONS.includes(r.reason))
    && boundedWarningsValid(r.warnings, r.omitted),
  waiting: r => exactKeys(r, ['instance', 'deployment', 'reason']) && (r.reason === null || WAITING_REASONS.includes(r.reason)),
  refused: r => exactKeys(r, ['instance', 'deployment', 'reason', 'code', 'message']) && (r.reason === null || REFUSED_REASONS.includes(r.reason))
    && (r.code === null || code(r.code) !== null) && (r.message === null || cleanLine(r.message)),
};
const copyRow = r => Object.hasOwn(r, 'warnings') ? { ...r, warnings: [...r.warnings] } : { ...r };

/** The summary as it crossed a boundary (main to a renderer over IPC): the same summary, a fresh copy, or
 * undefined. Exactly the keys above, everywhere; names and paths display lines, never withheld or empty;
 * reasons one of their kind's or null; codes of the kernel's form or null; each row's warnings within both
 * bounds with `omitted` consistent (boundedWarningsValid); at most RESUME_SUMMARY_ROWS rows and
 * RESUME_SUMMARY_DEPLOYMENTS deployment lines; `totals` non-negative safe integers, each at least its kind's
 * kept rows. `omitted` is the rows over the bound (the totals' sum less the kept rows: above 0 only beside
 * a full set of rows) plus the deployment lines over theirs (above 0 only beside a full set of lines).
 * Idempotent: readResumeSweep's summary decodes to itself, and so does this function's answer. */
export function resumeSummaryFact(v) {
  if (!exactKeys(v, SUMMARY_KEYS) || !exactKeys(v.totals, KINDS) || !KINDS.every(k => count(v.totals[k]))
    || !count(v.omitted) || !Array.isArray(v.optedOut) || !Array.isArray(v.unswept)) return undefined;
  let kept = 0;
  for (const k of KINDS) {
    const rows = v[k];
    if (!Array.isArray(rows) || rows.length > v.totals[k]
      || !rows.every(r => rowShape[k](r) && named(r.instance) && named(r.deployment))) return undefined;
    kept += rows.length;
  }
  const lines = v.optedOut.length + v.unswept.length, total = sum(v.totals);
  if (kept > RESUME_SUMMARY_ROWS || lines > RESUME_SUMMARY_DEPLOYMENTS || !Number.isSafeInteger(total)
    || !v.optedOut.every(named)
    || !v.unswept.every(u => exactKeys(u, ['deployment', 'reason']) && named(u.deployment) && (u.reason === null || UNSWEPT_REASONS.includes(u.reason)))) return undefined;
  const overRows = total - kept, overLines = v.omitted - overRows;
  if (overRows > 0 && kept < RESUME_SUMMARY_ROWS || overLines < 0 || overLines > 0 && lines < RESUME_SUMMARY_DEPLOYMENTS) return undefined;
  const out = {};
  for (const k of KINDS) out[k] = v[k].map(copyRow);
  return { ...out, optedOut: [...v.optedOut], unswept: v.unswept.map(u => ({ ...u })), omitted: v.omitted, totals: { ...v.totals } };
}

const FRESH_WHY = {
  'no-conversation': 'no saved conversation was found.',
  'no-receipts': 'OATS has no record of where its conversations are kept.',
  'resume-unproven': "resuming this harness's conversations isn't supported yet.",
};
const UNSWEPT_WHY = { 'not-ok': "its deployment isn't ready.", unreadable: 'it could not be read.' };
const THIS_BOOT = ' It was refused earlier since this computer started, so OATS did not try again.';

/** The headline's sentences, each only when its count is above 0. A blocked row's session runs, so it counts
 * among the resumed: N = resumed + fresh + waiting. "1 of them" takes "its"; "It" when the one is all of N. */
function headline({ resumed, fresh: f, waiting: w, refused: r }) {
  const n = resumed + f + w, out = [];
  if (n > 0) out.push(n === 1 ? 'OATS resumed 1 instance whose session was lost.' : `OATS resumed ${n} instances whose sessions were lost.`);
  if (f > 0) out.push(f === n && n === 1 ? 'It started fresh from its briefing.'
    : f === 1 ? '1 of them started fresh from its briefing.' : `${f} of them started fresh from their briefing.`);
  if (w > 0) out.push(w === n && n === 1 ? 'It is waiting for you: open its terminal.'
    : w === 1 ? '1 of them is waiting for you: open its terminal.' : `${w} of them are waiting for you: open their terminal.`);
  if (r > 0) out.push(n > 0 ? `${r} could not be resumed.` : r === 1 ? 'OATS could not resume 1 lost session.' : `OATS could not resume ${r} lost sessions.`);
  return out.join(' ');
}

/** A row's warnings under `OATS says:`, in order, then how many more the cut left out; nothing without one. */
const said = r => r.warnings.length ? ['OATS says:', ...r.warnings, ...(r.omitted > 0 ? [`${r.omitted} more not shown.`] : [])] : [];

/**
 * The notice for a summary in the clients' words: `{headline, detail}`, or null when `summary` does not
 * decode (resumeSummaryFact) or has no row to tell of. Kernel text appears only after `OATS says:`.
 * @param {unknown} summary
 * @param {{label: (deployment: string) => string}} options  `label` is the caller's display label for a
 *   deployment path (required: a TypeError without it); a non-string or empty label shows the path itself.
 * Detail: a line per kept row, waiting, refused, fresh, resumed; then the opted-out deployments, then the
 * unswept ones; then `M more not shown.` when anything was left out. A row line names its deployment
 * (` in {d}`) only when the kept rows name more than one; a deployment line always does. `detail` is the
 * lines joined with '\n', absent when there are none.
 */
export function resumeNotice(summary, options) {
  const labelOf = options?.label;
  if (typeof labelOf !== 'function') throw new TypeError('resumeNotice needs a label function');
  const s = resumeSummaryFact(summary);
  if (!s || sum(s.totals) === 0) return null;
  const shown = d => { const l = labelOf(d); return typeof l === 'string' && l ? l : d; };
  const several = new Set(KINDS.flatMap(k => s[k].map(r => r.deployment))).size > 1;
  const who = r => several ? `${r.instance} in ${shown(r.deployment)}` : r.instance;
  const lines = [
    ...s.waiting.map(r => r.reason === 'resume-confirmation'
      ? `${who(r)}: waiting for you to choose how to resume it. Open its terminal.`
      : `${who(r)}: waiting at a launch prompt. Open its terminal.`),
    ...s.refused.flatMap(r => [`${who(r)}: could not be resumed.${r.reason === 'refused-this-boot' ? THIS_BOOT : ''}`,
      ...(r.message !== null ? [`OATS says: ${r.message}`] : [])]),
    ...s.fresh.flatMap(r => [`${who(r)}: started fresh from its briefing, ${FRESH_WHY[r.reason] ?? 'its conversation could not be resumed.'}`, ...said(r)]),
    ...s.resumed.flatMap(r => [`${who(r)}: resumed in its own conversation.`, ...said(r)]),
    ...s.optedOut.map(d => `Not checked in ${shown(d)}: resuming is turned off for this deployment (session.resume: off).`),
    ...s.unswept.map(u => `Not checked in ${shown(u.deployment)}: ${UNSWEPT_WHY[u.reason] ?? 'it could not be checked.'}`),
    ...(s.omitted > 0 ? [`${s.omitted} more not shown.`] : []),
  ];
  return lines.length ? { headline: headline(s.totals), detail: lines.join('\n') } : { headline: headline(s.totals) };
}
