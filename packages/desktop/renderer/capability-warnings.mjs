/** The one presentation of capability warnings (capability-warnings-contract.mjs), shared by the capability
 * page, the soul page and sidebar inspector, readiness, the instance Soul tab, the spawn preview and
 * Workspace › Sources. A warning is calm: the word "Warning" and an icon mark it (never colour alone), the
 * kernel's message follows as text, and its code and path wait behind Details, as a problem's code does in
 * the soul inspector. No banner, no modal, no effect on a ready state or an attention count.
 *
 * The host owns the heading (each surface titles its sections its own way) and the repaint barrier: build
 * the list again only when the warnings changed. Every control carries `data-focus-key`, so a host's
 * captureFocusState (loading.mjs) finds it again after a repaint. All text is set as text, never markup. */
import { warningsShown } from '../../client/capability-warnings-contract.mjs';
import { iconElement } from './shell-icons.mjs';

export const WARNINGS_COPY = Object.freeze({
  title: 'Warnings',
  label: 'Warning',
  details: 'Details',
  code: 'Code',
  path: 'Path',
  open: 'Open capability',
  more: n => `and ${n} more`,
});

/* Text tokens only, drawn on whatever surface the host gives (bg, surface or surface-2): warn and muted and fg
   on those are in the contrast inventory. The rule at the left is a graphic beside the word, not the marker. */
export const capabilityWarningsCSS = `
.cap-warnings { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:10px; min-width:0; }
.cap-warning { display:flex; flex-direction:column; gap:3px; min-width:0; padding-left:10px; border-left:2px solid var(--warn); }
.cap-warning-head { display:flex; align-items:center; gap:6px; min-width:0; color:var(--warn); font-size:12px; font-weight:650; line-height:1.4; }
.cap-warning-head .shell-icon { flex:none; }
.cap-warning-capability { min-width:0; color:var(--muted); font:500 11.5px var(--mono, ui-monospace, Menlo, monospace); overflow-wrap:anywhere; }
.cap-warning-message { margin:0; color:var(--fg); font-size:12.5px; line-height:1.5; overflow-wrap:anywhere; }
.cap-warning-note { margin:0; color:var(--muted); font-size:12px; line-height:1.5; overflow-wrap:anywhere; }
.cap-warning-foot { display:flex; flex-wrap:wrap; align-items:flex-start; gap:4px 10px; min-width:0; }
.cap-warning-details { min-width:0; color:var(--muted); font-size:11.5px; }
.cap-warning-details > summary { width:fit-content; cursor:pointer; color:var(--muted); } /* the focus ring hugs the word */
.cap-warning-details dl { display:grid; grid-template-columns:auto minmax(0,1fr); gap:2px 8px; margin:4px 0 0; }
.cap-warning-details dt { color:var(--muted); }
.cap-warning-details dd { margin:0; min-width:0; color:var(--fg); font-family:var(--mono, ui-monospace, Menlo, monospace); overflow-wrap:anywhere; }
.cap-warnings-more { margin:8px 0 0; color:var(--muted); font-size:12px; }
.cap-warnings.compact { gap:8px; }
.cap-warnings.compact .cap-warning-message { font-size:12px; }
`;

/**
 * The list, or null when there is nothing to show (the host then shows no section).
 * @param {Document} doc
 * @param {Array} warnings  projected warnings (warningsOf), or with `lines`, preview strings (previewWarningsOf)
 * @param {object} [o]
 * @param {boolean} [o.lines]  the spawn preview's strings: each line as text, no Details, no Open capability
 * @param {boolean} [o.compact]  the narrower surfaces (the instance Soul tab, the sidebar)
 * @param {boolean} [o.showCapability]  name each warning's capability (a surface that shows several)
 * @param {(name: string, warning: object) => boolean} [o.canOpen]  whether Open capability resolves here, for that name and
 *   that warning (two warnings may name two capabilities of one name, told apart by their paths)
 * @param {(name: string, warning: object) => void} [o.open]  opens it (the surface's own route)
 * @param {string} [o.focusKey]  the prefix of the controls' focus keys, unique on the surface
 * @param {(warning: object) => string|null} [o.after]  a muted line under a warning's message (a Sources remedy)
 */
export function createWarningsList(doc, warnings, { lines = false, compact = false, showCapability = false, canOpen = () => false, open = null, focusKey = 'warning', after = null } = {}) {
  const { shown, more } = warningsShown(warnings);
  if (!shown.length) return null;
  const node = (tag, cls, text) => { const el = doc.createElement(tag); if (cls) el.className = cls; if (text !== undefined && text !== null) el.textContent = text; return el; };
  const wrap = node('div', 'cap-warnings-block');
  const list = node('ul', `cap-warnings${compact ? ' compact' : ''}`); list.setAttribute('aria-label', WARNINGS_COPY.title);
  shown.forEach((w, i) => {
    const item = node('li', 'cap-warning'), head = node('div', 'cap-warning-head');
    head.append(iconElement(doc, 'warning', { size: 13 }), node('span', 'cap-warning-label', WARNINGS_COPY.label));
    item.append(head);
    if (lines) { for (const line of String(w).split('\n')) item.append(node('p', 'cap-warning-message', line)); list.append(item); return; }
    if (showCapability && w.capability) head.append(node('span', 'cap-warning-capability', w.capability));
    item.append(node('p', 'cap-warning-message', w.message));
    const extra = typeof after === 'function' ? after(w) : null;
    if (extra) item.append(node('p', 'cap-warning-note', extra));
    const foot = node('div', 'cap-warning-foot');
    if (w.code || w.path) {
      const details = node('details', 'cap-warning-details'), summary = node('summary', null, WARNINGS_COPY.details);
      summary.dataset.focusKey = `${focusKey}:${i}:details`;
      const facts = node('dl');
      if (w.code) facts.append(node('dt', null, WARNINGS_COPY.code), node('dd', null, w.code));
      if (w.path) facts.append(node('dt', null, WARNINGS_COPY.path), node('dd', null, w.path));
      details.append(summary, facts); foot.append(details);
    }
    if (w.capability && typeof open === 'function' && canOpen(w.capability, w)) {
      const button = node('button', 'act cap-warning-open', WARNINGS_COPY.open); button.type = 'button';
      // Several warnings may each have one: the accessible name says which capability (the visible text leads it).
      button.setAttribute('aria-label', `${WARNINGS_COPY.open} ${w.capability}`);
      button.dataset.focusKey = `${focusKey}:${i}:open`;
      const name = w.capability; button.addEventListener('click', () => open(name, w));
      foot.append(button);
    }
    if (foot.childElementCount) item.append(foot);
    list.append(item);
  });
  wrap.append(list);
  if (more) wrap.append(node('p', 'cap-warnings-more', WARNINGS_COPY.more(more)));
  return wrap;
}
