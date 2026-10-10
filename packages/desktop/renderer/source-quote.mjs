/** The quote treatment (#669 condition 1): text that is neither the kernel's nor the Desktop's is shown as
 * data, never as a sentence of the Desktop's. One group: a lead-in in the Desktop's words that names whose
 * text it is, then each text as one line (displayLine) in a quote style (mono, a rule at its side). The
 * group is labelled by its lead-in for assistive technology, and the difference is carried by the typeface,
 * the rule and the lead-in, not by colour.
 *
 * Every text is set with textContent: no markup, no link, no button, no tooltip is ever made from it.
 * Presentation only: what is shown here is never evidence of identity nor authority for an action. */
import { displayLine, MAX_DISPLAY_LINE } from '../../client/display-text.mjs';

/** The three provenances and their lead-ins. */
export const LEAD_INS = Object.freeze({
  /** A trigger source's own words: a skipped item's why, a refused event's text, its refusal's code and message. */
  source: (capability, name) => `${[capability, name].filter(Boolean).join(' · ') || 'The source'} says:`,
  /** A workspace or local trigger file's values (its parameters). */
  triggerFile: 'From the trigger file:',
  /** A capability manifest's own declarations (a trigger source's name, events and description). */
  manifest: "From the capability's manifest:",
});

export const sourceQuoteCSS = `
.source-quote { display:flex; flex-direction:column; gap:4px; min-width:0; margin:0; }
.source-quote-lead { margin:0; color:var(--muted); font:11.5px var(--sans,system-ui); }
.source-quote-lines { display:flex; flex-direction:column; gap:4px; margin:0; padding:0; list-style:none; min-width:0; }
.source-quote-line { display:flex; flex-direction:column; gap:2px; min-width:0; }
.source-quote-text { margin:0; padding:1px 0 1px 8px; border-left:2px solid var(--border); color:var(--fg); font:12px/1.5 var(--mono,monospace); white-space:normal; overflow-wrap:anywhere; }
.source-quote-label { color:var(--fg); font:600 12px/1.45 var(--mono,monospace); overflow-wrap:anywhere; }
.source-quote-note { color:var(--muted); font:11.5px/1.45 var(--sans,system-ui); overflow-wrap:anywhere; }
`;

const serials = new WeakMap();
const nextId = doc => { const n = (serials.get(doc) || 0) + 1; serials.set(doc, n); return `source-quote-${n}`; };

/** One quoted line from raw text: { text, cut } or null when there is nothing to show. `cut` says the
 * text was longer than a display line holds, so the end is not shown. */
export function quotedLine(raw) {
  const text = displayLine(raw);
  return text === null ? null : { text, cut: typeof raw === 'string' && raw.length > MAX_DISPLAY_LINE };
}

/** The group, or null when no line has anything to show.
 * @param {Document} doc
 * @param {{ leadIn: string, lines: Array<string | { label?: string | null, text?: string | string[], note?: string | string[] | null }>, className?: string }} o
 *   `leadIn`: the Desktop's words (LEAD_INS). A line's `text` is the untrusted text, filtered here (several
 *   texts of one item, a name and its description, are each their own quoted line). `label` is what the
 *   item is about, a kernel-validated identifier (an event's subject), set above the quote as data; `note`
 *   is the Desktop's or the kernel's own remark about that item, set under it in plain style. Neither is
 *   ever the quoted party's text. A text cut to fit says so in a note. */
export function sourceQuote(doc, { leadIn, lines, className = '' }) {
  const node = (tag, cls, text) => { const el = doc.createElement(tag); if (cls) el.className = cls; if (text !== undefined && text !== null) el.textContent = text; return el; };
  const many = v => Array.isArray(v) ? v : [v];
  const shown = [];
  for (const line of Array.isArray(lines) ? lines : []) {
    const quoted = many(typeof line === 'string' ? line : line?.text).map(quotedLine).filter(Boolean);
    const notes = typeof line === 'string' ? [] : many(line?.note).map(displayLine).filter(Boolean);
    if (quoted.some(q => q.cut)) notes.push(`Cut at ${MAX_DISPLAY_LINE} characters: the end is not shown.`);
    const label = typeof line === 'string' ? null : displayLine(line?.label);
    if (quoted.length || notes.length || label) shown.push({ label, texts: quoted.map(q => q.text), notes });
  }
  if (!shown.length) return null;
  const group = node('div', `source-quote${className ? ` ${className}` : ''}`), lead = node('p', 'source-quote-lead', leadIn);
  lead.id = nextId(doc); group.setAttribute('role', 'group'); group.setAttribute('aria-labelledby', lead.id);
  const item = (tag, line) => {
    const el = node(tag, 'source-quote-line');
    if (line.label) el.append(node('span', 'source-quote-label', line.label));
    for (const text of line.texts) el.append(node('blockquote', 'source-quote-text', text));
    for (const note of line.notes) el.append(node('span', 'source-quote-note', note));
    return el;
  };
  if (shown.length === 1) group.append(lead, item('div', shown[0]));
  else { const list = node('ul', 'source-quote-lines'); for (const line of shown) list.append(item('li', line)); group.append(lead, list); }
  return group;
}
