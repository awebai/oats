/** The one line the Desktop shows for a text it did not write with certainty: a row's `runtimeError`, a
 * reason's sentence that may be that text, a kept failure's message (#982). Who made the text is said in
 * front of it, in the words the shared home gives (packages/client/instance-presentation.mjs `originLead`),
 * and the Desktop writes none of its own there.
 *
 *   speakerLine(origin, text) -> "<lead> <line>" | "<line>" | null
 *
 * `line` is the text as one display line (packages/client/display-text.mjs `displayLine`), always: the
 * guarantee does not rest on which caller had a speaker. Every text the shared home did not write goes
 * through it: a row's `runtimeError`, a kept failure's message, and a reason's sentence when the reason
 * carries an `origin` (`reasonLine`). The lead stands in front only when `origin` names
 * one of the three speakers and there is a line to introduce: a text the filter withholds reads
 * "[Detail withheld]" alone, and a text with nothing to show answers null, so the caller says what it said
 * before for a row without a text. A text with no origin is shown without a lead, as the Desktop's own
 * words always were, and never under "OATS says:".
 *
 * A kernel refusal's own texts, its message and its fix, are quoted the same way by the shared home's
 * `kernelLines` (packages/client/kernel-lines.mjs), which each caller gives `DESKTOP_TERMS`: they are the
 * kernel's by the place they are read from, so they need no mark.
 *
 * The marks come from the Desktop's own backend (`/api/panel`), which sets them in the shared home and
 * drops any that a kernel, a host or the liveness collector sent. Presentation only: the line is never
 * evidence of identity nor authority for an action. A page loads this module. */
import { displayLine, DETAIL_WITHHELD } from '../../client/display-text.mjs';
import { originLead, runtimeErrorSpeaker, unsupportedSession } from '../../client/instance-presentation.mjs';
import { rowReason } from '../../client/remote-address.mjs';
import { DESKTOP_TERMS } from './desktop-terms.mjs';

/** The two parts of the line, for a place that sets them in a sentence of its own: `line` the text as one
 * display line (null, or "[Detail withheld]"), `lead` the speaker's words, null when there is no speaker
 * or no line for them to introduce. */
export function speakerParts(origin, text) {
  const line = displayLine(text);
  return { lead: line === null || line === DETAIL_WITHHELD ? null : originLead(origin, DESKTOP_TERMS), line };
}

export function speakerLine(origin, text) {
  const { lead, line } = speakerParts(origin, text);
  return lead ? `${lead} ${line}` : line;
}

/** A kept failure's message (packages/client/deployment-facts.mjs `keptFailure`) with its speaker, or null
 * when the failure has no words to show. Whether a failure is kept is `keptFailure`'s to say, never this
 * line's: a failure with nothing to show is still one. */
export const keptFailureLine = (kept) => speakerLine(kept.origin, kept.message);

/** A reason's sentence (remote-address.mjs `rowReason`, instance-acts.mjs `instanceActs`), or null when it
 * has nothing to show. The reason's `origin` says which it is, and the shared home sets it in the same
 * expression that picks a row's text (the contract of `rowReason`):
 *
 *   with an `origin`   a text the shared home did not write: one display line, after the speaker's words
 *                      when the value names a speaker ("unattributed" names none: the line alone)
 *   with none          the shared home's own sentence, shown as written, as it always was
 *
 * Only an absent key reads as the shared home's own; any value, also one that is no speaker, is filtered. */
export const reasonLine = (reason) => (reason?.origin === undefined ? written(reason?.sentence) : speakerLine(reason.origin, reason.sentence));
const written = (sentence) => (typeof sentence === 'string' && sentence ? sentence : null);

/** A row reason as the row says it: its sentence with its speaker, or its own short label when the sentence
 * has nothing to show. Null for no reason. */
export const rowReasonLine = (reason) => (reason ? reasonLine(reason) ?? reason.label : null);

/** A row's own `runtimeError` with its speaker, or null for a row without one. */
export const runtimeErrorLine = (row) => speakerLine(runtimeErrorSpeaker(row), row?.runtimeError);

/** Why a row whose session backend OATS no longer has cannot start or open, with its speaker when the
 * kernel gave the reason, or null for any other row. The row reason of such a row is always this one. */
export const unsupportedLine = (row) => (unsupportedSession(row) ? rowReasonLine(rowReason(row)) : null);
