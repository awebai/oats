/** Diagnostic projection only: neither a retained target nor an audit receipt
 * grants terminal authority. Bad additive data must never erase a retained home. */
import { record, absolute } from './spawn-preview-contract.mjs';
import { eventsUnsafe } from './instance-events-contract.mjs';
import { displayLine, cleanLine, MAX_DISPLAY_LINE } from './display-text.mjs';
const safe = (v, max = 1024) => typeof v === 'string' && v.length <= max && !/[\x00-\x1f\x7f]/.test(v) && !eventsUnsafe.test(v);
/** The kernel's reasons, matched whole and shown as it wrote them: no prefix or suffix is matched, so the
 * blocked reasons the kernel suffixes when its private evidence was not kept are entries of their own.
 *
 * Six no longer occur from OATS 0.52.0, which pins no pane geometry and reads no consent list: `blocked:
 * launch geometry not pinned`, `blocked: prompt consent absent`, `launch prompt audit failed before geometry
 * pin`, `launch prompt audit failed after geometry pin`, `launch prompt geometry pin failed` and `launch
 * prompt geometry restoration incomplete`. They stay: kernels 0.44 to 0.51 are accepted, a routed host can
 * run one, and a home keeps the outcome an older kernel recorded. */
const reasons = new Set([
  'blocked: unexpected prompt', 'blocked: observation timeout', 'blocked: launch observation failed',
  'blocked: invalid target', 'blocked: respawn ownership not proven', 'blocked: respawn geometry changed before fresh screen',
  'blocked: launch geometry not pinned', 'blocked: repeated or unsupported prompt', 'blocked: prompt consent absent',
  'blocked: prompt changed before input', 'blocked: launch authority already used',
  'launch prompt audit failed', 'launch prompt audit failed after possible input',
  'launch prompt audit failed before geometry pin', 'launch prompt audit failed after geometry pin',
  'launch prompt geometry pin failed', 'launch prompt geometry restoration incomplete',
  'launch prompt input failed', 'launch prompt input uncertain',
  'launch prompt dispatch or recording incomplete', 'launch prompt metadata recording incomplete',
  'launch prompt pending receipt incomplete', 'launch home identity changed; metadata retained at original home',
  // The kernel's own evidence of the screen was not kept: alone when the launch had otherwise ended well,
  // and as the suffix of each blocked reason whose screen the kernel keeps.
  'private launch evidence retention failed',
  'blocked: unexpected prompt; private launch evidence retention failed',
  'blocked: repeated or unsupported prompt; private launch evidence retention failed',
  'blocked: observation timeout; private launch evidence retention failed',
]);
export const LAUNCH_INSPECTION = 'Launch requires inspection';
export const LAUNCH_DIAGNOSTIC_BYTES = 32768;
/** The kernel's bound on each side of a difference, in UTF-16 units. */
const DIFFERED_UNITS = 40;
/** What a blocked launch's screen differed in from the confirmation the kernel answers (0.52.0), as
 * `{nearest, index, expected, found}`, or undefined. The kernel sends `{nearest, firstDifference: {index,
 * expected, found}}`: `nearest` the id of the nearest tolerance entry, `index` the first differing position
 * of the two normalized texts, `expected` and `found` at most 40 UTF-16 units of each from there (either
 * can be empty: that text ended). `found` is what a terminal showed and `expected` the kernel's own text:
 * each is kept as one display line, null when there is nothing to show. For display only: never compared,
 * parsed or acted on.
 *
 * Tolerant, unlike the outcome around it: anything else, in any part, is undefined, so a malformed value
 * drops this one fact and never the outcome, the retained home or the read. Idempotent: this module's own
 * answer decodes to itself (the renderer reads again what the server projected). */
export function launchPromptDiffered(v) {
  if (!record(v) || !safe(v.nearest, 256) || !v.nearest) return undefined;
  const own = !Object.hasOwn(v, 'firstDifference'), d = own ? v : v.firstDifference;
  if (!record(d) || !Number.isSafeInteger(d.index) || d.index < 0) return undefined;
  const sides = [d.expected, d.found];
  // Only this module's answer holds null for a side with nothing to show.
  if (!sides.every(s => typeof s === 'string' ? s.length <= DIFFERED_UNITS : own && s === null)) return undefined;
  return { nearest: v.nearest, index: d.index, expected: displayLine(d.expected), found: displayLine(d.found) };
}
/** What differed, as data for a view: the Desktop's lead-in, then the two texts, each under a lead-in of
 * its own that names whose text it is. `found` is what a terminal showed, so it is shown as an attributed
 * quote and never inside one of the Desktop's sentences; `expected` is the kernel's own text and gets the
 * same line, so the two read as a pair. A side with nothing to show has a `note` instead of a `text`.
 * `detail` (the nearest entry and the position) is for Details, never part of a sentence. Null when there is
 * nothing decodable to say. Nothing is interpreted: no client decides from the two texts what the prompt
 * was, whether a key is safe, or what to press. */
export const DIFFERED_LEAD_IN = 'Where the screen first differed from the confirmation OATS answers:';
export const DIFFERED_NO_TEXT = '(no visible text)';
/** The background notice cannot hold an attributed quote: it says where one is. True whenever it shows:
 * the kernel writes `differed` to the `launch-prompt` event in the step that puts it on the result. */
export const DIFFERED_IN_ACTIVITY = 'Its Activity shows what OATS expected and what the terminal showed.';
export function differedLines(v) {
  const d = launchPromptDiffered(v);
  if (!d) return null;
  const line = (leadIn, text) => ({ leadIn, text, note: text === null ? DIFFERED_NO_TEXT : null });
  return { leadIn: DIFFERED_LEAD_IN, lines: [line('OATS expected:', d.expected), line('The terminal showed:', d.found)],
    detail: `Nearest entry ${displayLine(d.nearest)}, first difference at ${d.index}` };
}
const unknown = () => ({ status: 'unknown', answers: [], reason: LAUNCH_INSPECTION, receipt: [] });
const within = v => new TextEncoder().encode(JSON.stringify(v)).length <= LAUNCH_DIAGNOSTIC_BYTES;
export function launchPromptOutcome(v) {
  // A failed audit can follow a possible key even with answers: []. Never
  // translate missing diagnostics into “no input” or a recoverable spawn retry.
  try {
    if (!record(v) || !within(v) || !['blocked', 'incomplete', 'unknown'].includes(v.status)) return unknown();
    const answers = Array.isArray(v.answers) && v.answers.length <= 8 ? v.answers.flatMap(a =>
      record(a) && a.class === 'awebDevelopmentChannel' && a.status === 'submitted' && safe(a.signatureId, 256)
        ? [{ class: a.class, signatureId: a.signatureId, status: a.status }] : []) : [];
    const receipt = Array.isArray(v.receipt) && v.receipt.length <= 16 ? v.receipt.flatMap(r => {
      if (!record(r) || typeof r.ok !== 'boolean' || !Array.isArray(r.results) || r.results.length > 2) return [];
      const results = r.results.flatMap(w => record(w) && typeof w.ok === 'boolean' && safe(w.path) && absolute(w.path)
        ? [{ path: w.path, ok: w.ok }] : []);
      // Keep write outcomes and actual paths; raw event/OS diagnostic text is
      // deliberately excluded. The Activity reader owns event-row projection.
      return [{ ok: r.ok, results }];
    }) : [];
    // Only a blocked result says what differed (0.52.0), and not every one (an invalid target has no screen).
    const differed = v.status === 'blocked' ? launchPromptDiffered(v.differed) : undefined;
    const out = { status: v.status, answers, reason: reasons.has(v.reason) ? v.reason : LAUNCH_INSPECTION, receipt };
    // The answer is held to the bound it was read under, so reading it again (the renderer does) gives it
    // back. It can be longer than what was read: a withheld side, the generic reason. What differed is the
    // one fact that goes first; an answer still over the bound is unknown here, as the next read would say.
    if (differed && within({ ...out, differed })) return { ...out, differed };
    return within(out) ? out : unknown();
  } catch { return unknown(); }
}
export function retainedSpawnDetails(d) {
  if (!record(d) || typeof d.instance !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(d.instance)
    || !absolute(d.home) || ![false, 'unknown'].includes(d.launched)) return null;
  const out = { instance: d.instance, home: d.home, launched: d.launched };
  if (Object.hasOwn(d, 'launchPrompts')) {
    out.launchPrompts = launchPromptOutcome(d.launchPrompts);
    if (typeof d.parentLineageCommitted === 'boolean') out.parentLineageCommitted = d.parentLineageCommitted;
    if (record(d.target)) {
      out.target = {};
      for (const key of ['socket', 'session', 'window', 'windowId', 'paneId']) if (safe(d.target[key])) out.target[key] = d.target[key];
      if (d.target.backend === 'tmux') out.target.backend = 'tmux';
      if (Number.isSafeInteger(d.target.pid) && d.target.pid > 0 || safe(d.target.pid, 32) && /^\d+$/.test(d.target.pid)) out.target.pid = d.target.pid;
    }
  }
  return out;
}
/** Whether input reached the pane, as far as the outcome says: a submitted answer, or an incomplete result
 * (a failed audit can follow a possible key). One rule for a spawn and for a start. */
const inputNote = p => p.answers.length ? ' A launch-prompt answer was submitted; this does not confirm readiness.'
  : p.status === 'incomplete' ? ' Input may already have been sent.' : '';
export function retainedSpawnMessage(d) {
  if (!d.launchPrompts) return `${d.instance} was created but didn’t finish starting. Open it from the instance list instead of spawning again.`;
  const p = launchPromptOutcome(d.launchPrompts);
  return `${d.instance} was retained: ${p.reason}.${inputNote(p)} Inspect its existing pane, then use oats session start --home for this home. Do not spawn again.`;
}
/** A Start or Restart of an existing home that stopped at a launch prompt, in the Desktop's words: the
 * kernel answers E_SPAWN_INCOMPLETE with the same retained details as a spawn. `instance` is the name the
 * dialog started; `d` the decoded details. It claims the weaker thing for both statuses: a blocked start and
 * one whose completion was not seen are both "not confirmed", never "failed" and never "started". */
export function retainedStartMessage(instance, d) {
  const p = launchPromptOutcome(d?.launchPrompts);
  return `OATS could not confirm that ${instance} finished starting: ${p.reason}.${inputNote(p)} Its session was kept. Refresh status, then open its terminal to read what it shows. Do not start it again before that.`;
}
/** How much of an answer's warnings the notice below shows: at most this many display lines, and at most
 * this many UTF-16 units of them in total. Each cut is by position: never by a warning's words. */
export const FLAG_IGNORED_WARNINGS = 16;
export const FLAG_IGNORED_UNITS = 4096;
/** A launch that worked while Claude Code ignored the channel option (0.52.0). The kernel's successful
 * answer then carries `launchPrompts: {status: "flag-ignored", reason, signatureId, startId, at}` and its own
 * words as one string among `warnings`, never as a field. This reader takes those two fields of an answer
 * and knows nothing of the act that was answered. Its one caller is the start dialog, for a start's and a
 * restart's answer; a spawn's answer carries `launchPrompts` too (0.52.0) and is not read yet. It stands
 * beside the kept-session reader above, which reads a refusal's details and knows no such status.
 * Tolerant: an answer that does not decode, or any other status, is null, and the launch reads as any
 * launch that worked.
 *
 * The fact is `{reason, warnings, omitted}`. `reason` is the one value the notice has a clause for, else
 * null. `warnings` is the answer's warnings in the order given, each as one display line: the withheld
 * marker for one the filter withholds, and no line for an entry with nothing to show. None is picked,
 * matched or dropped by its words: no client looks for the kernel's sentence among them. Lines are kept in
 * order while both bounds hold: FLAG_IGNORED_WARNINGS lines, FLAG_IGNORED_UNITS units in total. The first
 * line that does not fit and every line after it are left out, and no line is cut inside; the first line
 * always fits (a display line is at most MAX_DISPLAY_LINE units). `omitted` counts the lines left out, 0
 * when none. An entry with nothing to show was never a line and is not counted. */
export function launchFlagIgnored(answer) {
  if (!record(answer) || !record(answer.launchPrompts) || answer.launchPrompts.status !== 'flag-ignored') return null;
  const lines = Array.isArray(answer.warnings) ? answer.warnings.map(w => displayLine(w)).filter(line => line !== null) : [];
  const warnings = [];
  let units = 0;
  for (const line of lines) {
    if (warnings.length === FLAG_IGNORED_WARNINGS || units + line.length > FLAG_IGNORED_UNITS) break;
    warnings.push(line); units += line.length;
  }
  return { reason: answer.launchPrompts.reason === 'channels-unavailable' ? 'channels-unavailable' : null, warnings, omitted: lines.length - warnings.length };
}
/** The fact above as it crossed a boundary: the same fact, or undefined. Exactly the three keys; `reason`
 * the one known value or null; `warnings` display lines within both bounds; `omitted` a non-negative safe
 * integer, above 0 only where a cut can have happened: beside a full list, or beside lines that leave no
 * room for another of MAX_DISPLAY_LINE units. Anything else is undefined, so a malformed value drops this
 * one fact and never what carried it. Idempotent: the reader's own answer decodes to itself. */
export function flagIgnoredFact(v) {
  if (!record(v) || Object.keys(v).length !== 3 || !['reason', 'warnings', 'omitted'].every(k => Object.hasOwn(v, k))
    || v.reason !== null && v.reason !== 'channels-unavailable'
    || !Array.isArray(v.warnings) || v.warnings.length > FLAG_IGNORED_WARNINGS || !v.warnings.every(cleanLine)
    || !Number.isSafeInteger(v.omitted) || v.omitted < 0) return undefined;
  const units = v.warnings.reduce((sum, line) => sum + line.length, 0);
  if (units > FLAG_IGNORED_UNITS
    || v.omitted > 0 && v.warnings.length < FLAG_IGNORED_WARNINGS && units <= FLAG_IGNORED_UNITS - MAX_DISPLAY_LINE) return undefined;
  return { reason: v.reason, warnings: [...v.warnings], omitted: v.omitted };
}
/** The notice for the fact, `{headline, detail?}`, or null when `fact` is not one. `instance` is the name
 * the caller launched. The launch worked: the headline never says "failed" or "could not confirm". The
 * detail is the warnings under the Desktop's lead-in, one per line, and after them, in the Desktop's words,
 * how many more the cut left out; there is none without a warning. */
export function flagIgnoredNotice(instance, fact) {
  const d = flagIgnoredFact(fact);
  if (!d) return null;
  const headline = d.reason === 'channels-unavailable'
    ? `${instance} started. Claude Code reported that channels are not available and ignored the channel option, so mail and chat will not wake this instance.`
    : `${instance} started. Claude Code ignored the channel option, so mail and chat will not wake this instance.`;
  if (!d.warnings.length) return { headline };
  return { headline, detail: ['OATS says:', ...d.warnings, ...(d.omitted > 0 ? [`${d.omitted} more not shown.`] : [])].join('\n') };
}
