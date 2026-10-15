/** A kernel refusal's two texts as the lines a client shows, under the kernel's name in the words the
 * shared home gives (instance-presentation.mjs `originLead`). Two clients quote a refusal the same way.
 * Presentation only: a line is never evidence of identity nor authority for an action. A page loads this
 * module, so it reaches no `node:` import. */
import { requireTerms } from './client-terms.mjs';
import { displayLine, DETAIL_WITHHELD } from "./display-text.mjs";
import { originLead } from "./instance-presentation.mjs";

/** The lines of a kernel refusal's two texts, its `message` and its `fix` (a launch problem of a soul, the
 * spawn dialog's Details for an unmatched launch preference). Each text goes through the filter alone and
 * is its own line, whole: nothing is joined, taken out or compared, so a remedy the kernel says in both is
 * read in both. The kernel's name stands before the first of them that has a line to show, so no text of
 * the kernel's stands without its speaker:
 *
 *   message a line, fix a line       ["OATS says: <message>", "<fix>"]
 *   message withheld, fix a line     ["[withheld]", "OATS says: <fix>"]
 *   message nothing, fix a line      ["OATS says: <fix>"]
 *   message a line, fix withheld     ["OATS says: <message>", "[withheld]"]
 *   message a line, fix nothing      ["OATS says: <message>"]
 *   neither has a line               what is there ("[withheld]" for a withheld text), no lead
 *
 * `terms` are the client's own (client-terms.mjs), required on every call under this function's name:
 * also where no line is led, so a caller that leaves them out fails at once and not only on the day a
 * text has something to show.
 */
export function kernelLines(message, fix, terms) {
  requireTerms(terms, "kernelLines");
  const lines = [displayLine(message), displayLine(fix)].filter(line => line !== null);
  const first = lines.findIndex(line => line !== DETAIL_WITHHELD);
  return lines.map((line, index) => (index === first ? `${originLead('kernel', terms)} ${line}` : line));
}
