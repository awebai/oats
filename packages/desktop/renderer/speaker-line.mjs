/** The one line the Desktop shows for a text it did not write with certainty: a row's `runtimeError` and a
 * reason's sentence that may be that text (#982). Who made the text is said in
 * front of it, in the words the shared home gives (packages/client/instance-presentation.mjs `originLead`),
 * and the Desktop writes none of its own there.
 *
 *   speakerLine(origin, text) -> "<lead> <line>" | "<line>" | null
 *
 * `line` is the text as one display line (packages/client/display-text.mjs `displayLine`), always: the
 * guarantee does not rest on which caller had a speaker. The lead stands in front only when `origin` names
 * one of the three speakers and there is a line to introduce: a text the filter withholds reads
 * "[Detail withheld]" alone, and a text with nothing to show answers null, so the caller says what it said
 * before for a row without a text. A text with no origin is shown without a lead, as the Desktop's own
 * words always were, and never under "OATS says:".
 *
 * The marks come from the Desktop's own backend (`/api/panel`), which sets them in the shared home and
 * drops any that a kernel, a host or the liveness collector sent. Presentation only: the line is never
 * evidence of identity nor authority for an action. A page loads this module. */
import { displayLine, DETAIL_WITHHELD } from '../../client/display-text.mjs';
import { originLead, runtimeErrorSpeaker, unsupportedSession } from '../../client/instance-presentation.mjs';
import { rowReason } from '../../client/remote-address.mjs';
import { DESKTOP_TERMS } from './desktop-terms.mjs';

export function speakerLine(origin, text) {
  const line = displayLine(text);
  if (line === null || line === DETAIL_WITHHELD) return line;
  const lead = originLead(origin, DESKTOP_TERMS);
  return lead ? `${lead} ${line}` : line;
}

/** A reason's sentence (remote-address.mjs `rowReason`, instance-acts.mjs `instanceActs`) with its speaker, or null. */
export const reasonLine = (reason) => speakerLine(reason?.origin, reason?.sentence);

/** A row reason as the row says it: its sentence with its speaker, or its own short label when the sentence
 * has nothing to show. Null for no reason. */
export const rowReasonLine = (reason) => (reason ? reasonLine(reason) ?? reason.label : null);

/** A row's own `runtimeError` with its speaker, or null for a row without one. */
export const runtimeErrorLine = (row) => speakerLine(runtimeErrorSpeaker(row, row?.runtimeError), row?.runtimeError);

/** Why a row whose session backend OATS no longer has cannot start or open, with its speaker when the
 * kernel gave the reason, or null for any other row. The row reason of such a row is always this one. */
export const unsupportedLine = (row) => (unsupportedSession(row) ? rowReasonLine(rowReason(row)) : null);
