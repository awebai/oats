/** What a blocked launch's screen differed in from the confirmation OATS answers (OATS 0.52.0), shown the
 * same way wherever it is shown: the Spawn dialog's result, the Start dialog and the Activity row. One
 * labelled group: the Desktop's lead-in, then the two texts, each in the quote treatment (source-quote.mjs)
 * under a lead-in that names whose text it is. What the terminal showed is untrusted text: it is an
 * attributed quote under the host's own sentence, never inside it, and nothing is made or decided from it.
 * The words and the data are packages/client/launch-prompt-outcome.mjs `differedLines`.
 *
 * A host's CSS holds sourceQuoteCSS and launchDifferedCSS. */
import { differedLines } from '../../client/launch-prompt-outcome.mjs';
import { sourceQuote } from './source-quote.mjs';

export const launchDifferedCSS = `
.launch-differed { display:flex; flex-direction:column; gap:6px; min-width:0; margin:0; }
.launch-differed[hidden] { display:none; }
.launch-differed-lead { margin:0; color:var(--muted); font:12px/1.5 var(--sans,system-ui); overflow-wrap:anywhere; }
`;

const serials = new WeakMap();
const nextId = doc => { const n = (serials.get(doc) || 0) + 1; serials.set(doc, n); return `launch-differed-${n}`; };

/** The group for a `differed` (the kernel's, or the outcome reader's own answer), or null when it does
 * not decode. A side with nothing to show says so in a plain note. */
export function launchDiffered(doc, differed) {
  const said = differedLines(differed);
  if (!said) return null;
  const group = doc.createElement('div'), lead = doc.createElement('p');
  group.className = 'launch-differed'; lead.className = 'launch-differed-lead'; lead.textContent = said.leadIn;
  lead.id = nextId(doc); group.setAttribute('role', 'group'); group.setAttribute('aria-labelledby', lead.id);
  group.append(lead);
  for (const line of said.lines) group.append(sourceQuote(doc, { leadIn: line.leadIn, lines: [line.text === null ? { note: line.note } : line.text] }));
  return group;
}
