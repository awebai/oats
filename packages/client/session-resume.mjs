/** The machine sweep's answer (`oats session resume --json`, feature `session-resume`), read into one of four
 * readings, and the trigger's settlement helpers (session-resume-trigger.mjs). session-resume-cli.mjs runs the
 * sweep; this module reads what came back. Shared by the Desktop and the TUI: pure, no IO, no DOM, never throws
 * on data.
 *
 * The answer: `{schemaVersion: 1, plan, deployments: [{deployment, state, swept, reason?, …}], rows:
 * [{deployment, instance, home, outcome, reason?, code?, message?, warnings?, …}], warnings?}`. Neither client
 * shows anything of it (docs/desktop-instance-start.md, "Nothing is shown"): the reader says only whether it
 * answered, and the trigger reads its rows' homes and outcomes to settle and release homes. Nothing is read from
 * the kernel's words: no sentence, warning or message is matched. The answer is closed: one that is not the
 * document (no schemaVersion 1, `plan` not a boolean, `deployments` or `rows` not an array, or either longer than
 * RESUME_ANSWER_ENTRIES) is a protocol failure, never read in part. */

/** The longest `rows` or `deployments` this reader reads: more is a protocol failure, not an answer. */
export const RESUME_ANSWER_ENTRIES = 100_000;
/** A row's `outcome`, by name: the one place a client spells them. */
export const RESUME_OUTCOMES = Object.freeze({ resumed: 'resumed', fresh: 'fresh', blocked: 'blocked', refused: 'refused',
  alreadyRunning: 'already-running', skipped: 'skipped' });
/** A `skipped` row's reasons, by name. */
export const SKIPPED_REASONS = Object.freeze({ notLost: 'not-lost', notSeenRecently: 'not-seen-recently', startBusy: 'start-busy',
  unknown: 'unknown' });
/** The skipped reasons that settle a home (sweepSettlement): it is not lost, or the kernel did not recently see it
 * running (its status still reads lost, and every sweep would skip it again). */
export const SETTLING_SKIPPED_REASONS = Object.freeze([SKIPPED_REASONS.notLost, SKIPPED_REASONS.notSeenRecently]);
/** The ok:false codes that mean nothing ran: no compatible CLI, or one without the feature. */
const UNSUPPORTED = new Set(['E_CLI_UNAVAILABLE', 'E_RESUME_FEATURE']);
const CODE = /^E_[A-Z0-9_]{1,64}$/;

const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const code = v => typeof v === 'string' && CODE.test(v) ? v : null;

/** Whether `result` is the sweep's document: the one check the reader and the trigger's helpers share. */
const sweepDocument = result => record(result) && result.schemaVersion === 1 && typeof result.plan === 'boolean'
  && Array.isArray(result.deployments) && Array.isArray(result.rows)
  && result.deployments.length <= RESUME_ANSWER_ENTRIES && result.rows.length <= RESUME_ANSWER_ENTRIES;

/**
 * @param {unknown} envelope  what runResumeSweep resolved: the kernel's envelope or a client read error
 * @returns {{kind: 'unsupported'} | {kind: 'busy'} | {kind: 'failed', code: string} | {kind: 'answered'}}
 *   `unsupported`: nothing ran (no compatible CLI, or no feature). `busy`: another sweep holds the machine's
 *   lock and nothing started. `failed`: any other refusal, with its code when it has the kernel's form, else
 *   E_CLI_PROTOCOL, as is an `ok: true` answer whose result is not the sweep's document (sweepDocument).
 *   `answered`: an `ok: true` answer whose result is the document, a plan too (a plan completes nothing:
 *   sweepCompleted). No reading carries anything of the answer's rows or words.
 */
export function readResumeSweep(envelope) {
  if (record(envelope) && envelope.ok === false) {
    const c = record(envelope.error) ? envelope.error.code : undefined;
    if (UNSUPPORTED.has(c)) return { kind: 'unsupported' };
    if (c === 'E_RESUME_BUSY') return { kind: 'busy' };
    return { kind: 'failed', code: code(c) ?? 'E_CLI_PROTOCOL' };
  }
  if (record(envelope) && envelope.ok === true && sweepDocument(envelope.result)) return { kind: 'answered' };
  return { kind: 'failed', code: 'E_CLI_PROTOCOL' };
}

/** The rows of an answer the trigger reads (session-resume-trigger.mjs): the rows of an `ok: true` envelope
 * whose result is the sweep's document (sweepDocument, as readResumeSweep reads it) and not a plan, else null:
 * an answer the reader fails, or a plan, settles nothing. */
function answerRows(envelope) {
  const result = record(envelope) && envelope.ok === true ? envelope.result : undefined;
  return sweepDocument(result) && result.plan === false ? result.rows : null;
}
/** A row's home as the trigger keys it: a non-empty string, else null. */
const homeOf = row => record(row) && typeof row.home === 'string' && row.home !== '' ? row.home : null;
const settles = row => row.outcome === RESUME_OUTCOMES.refused
  || row.outcome === RESUME_OUTCOMES.skipped && SETTLING_SKIPPED_REASONS.includes(row.reason);
const RELEASES = new Set([RESUME_OUTCOMES.resumed, RESUME_OUTCOMES.fresh, RESUME_OUTCOMES.blocked, RESUME_OUTCOMES.alreadyRunning]);

/**
 * The homes a sweep's answer settles and releases, for the trigger's settled homes. A row `refused` (any
 * reason) or `skipped` with a reason of SETTLING_SKIPPED_REASONS settles its home; `resumed`, `fresh`, `blocked` and
 * `already-running` release it; any other row (`start-busy`, `unknown`, an outcome not known) does neither.
 * When a home has several rows, its last decides. Rows that are not records, or have no string home, are
 * ignored. Both lists are empty for an envelope that is not `ok: true` with a rows array.
 * @param {unknown} envelope  what runResumeSweep resolved
 * @returns {{settle: string[], release: string[]}}
 */
export function sweepSettlement(envelope) {
  const last = new Map();
  for (const row of answerRows(envelope) ?? []) {
    const home = homeOf(row);
    if (home === null) continue;
    if (settles(row)) { last.delete(home); last.set(home, true); } else if (RELEASES.has(row.outcome)) { last.delete(home); last.set(home, false); }
  }
  const settle = [], release = [];
  for (const [home, settles] of last) (settles ? settle : release).push(home);
  return { settle, release };
}

/** Whether a sweep completed: its answer is the sweep's document and not a plan (answerRows: it ran), and its
 * reading is `answered`. Busy, failed, unsupported and a plan are not: nothing can be concluded about a home from
 * them. `envelope` is the run's answer, `reading` what was read of it. */
export const sweepCompleted = (envelope, reading) => answerRows(envelope) !== null
  && record(reading) && reading.kind === 'answered';
