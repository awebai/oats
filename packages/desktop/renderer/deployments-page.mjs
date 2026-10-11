/** The Deployments page's own pieces (UI spec, #482; the page is views/hierarchy.mjs): its tab bar and a
 * deployment's heading.
 *
 * Tabs: the Workspace page's tab component (workspace-discovery.mjs `.workspace-tabs`): a tablist of
 * plain-text tabs, the selected one in --fg at 650 over a 2px --live underline, roving tabindex, and
 * ArrowLeft / ArrowRight / Home / End selecting and focusing (automatic activation). Its rules come from
 * the same builder (workspace-discovery.mjs tabBarCSS), since that sheet is mounted only inside the Workspace view. `All`
 * first, then one tab per deployment in served order (deployment-tabs.mjs). A deployment that is not
 * live carries the shared status mark (view-deployments.mjs deploymentMark), its state in words.
 *
 * Heading: the overview's group label (`.cnm` / `.cct`, the "INDEPENDENT 2" label) naming the
 * deployment and its counts; a deployment that is not live adds its state as a chip, the short reason,
 * and an inline "How to fix" disclosure (the spawn dialog's Developer settings summary: a chevron, 12px
 * at 650) holding the full sentence, the fix steps and the note. Never an id: the full path is the
 * label's tooltip only. */
import { deploymentState, deploymentMark } from './view-deployments.mjs';
import { deploymentLabel, deploymentLabelParts } from '../../client/deployment-label.mjs';
import { runtimeCounts } from '../../client/instance-presentation.mjs';
import { tabBarCSS } from './workspace-discovery.mjs';

export const deploymentsPageCSS = `
${tabBarCSS('.hier-tabs')}
.hier-tabs { align-self:stretch; flex:0 1 auto; margin-right:12px; padding:0 6px; margin-left:-6px; } /* room for the 6px focus tint at both ends; shrinks, then scrolls */
.hier-tabs[hidden] { display:none; }
.hier-dhead { position:absolute; left:0; display:flex; flex-direction:column; align-items:flex-start; gap:4px; width:max-content; }
.hier-dline { display:flex; align-items:baseline; gap:8px; white-space:nowrap; }
.hier-dname { display:inline-flex; align-items:baseline; gap:6px; min-width:0; flex:0 1 auto; overflow:hidden; }
.hier-dhead .hier-dpath { text-transform:none; letter-spacing:normal; }
.hier-dfix > summary { display:flex; align-items:center; gap:8px; width:max-content; cursor:pointer; list-style:none; font-size:12px; font-weight:650; color:var(--fg); }
.hier-dfix > summary::-webkit-details-marker { display:none; }
.hier-dfix > summary::before { content:''; flex:none; width:6px; height:6px; margin:0 2px; border-right:1.5px solid var(--muted); border-bottom:1.5px solid var(--muted); transform:rotate(-45deg); transition:transform .15s; }
.hier-dfix[open] > summary::before { transform:rotate(45deg); }
.hier-dfix-body { width:max-content; max-width:640px; padding:6px 0 0 18px; color:var(--fg); font-size:12px; line-height:1.5; white-space:normal; overflow-wrap:anywhere; }
.hier-dfix-body p, .hier-dfix-body ol { margin:0 0 6px; }
.hier-dfix-body ol { padding-left:18px; }
.hier-dfix-note { color:var(--muted); }
.hier-dfix-code { font:inherit; font-family:var(--mono, ui-monospace, Menlo, monospace); color:var(--fg); }
.hier-dreason .hier-dhead { position:static; }
.hier-empty-wrap:has(> .hier-dreason) { flex-direction:column; gap:16px; } /* a live deployment's note above its empty state */
`;

/** Text whose `backticked` spans are commands, set as code (the server's reasons quote them so). */
function withCode(doc, host, text) {
  String(text).split('`').forEach((part, i) => { if (part) host.append(i % 2 ? el(doc, 'code', part, 'hier-dfix-code') : doc.createTextNode(part)); });
  return host;
}

const el = (doc, tag, text, cls) => {
  const node = doc.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
};

/** A section's counts in words: "3 running", "1 running · 2 stopped", "no instances". */
export function deploymentCounts(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return 'no instances';
  const { running, stopped, unknown } = runtimeCounts(list);
  return [`${running} running`, stopped ? `${stopped} stopped` : '', unknown ? `${unknown} unknown` : ''].filter(Boolean).join(' · ');
}

/** The tab bar. `paint(tabs, selected, panelId)` keeps one button per tab across paints (a focused tab
 * stays focused through a refresh); `onSelect(id)` hears a click or an arrow key. */
export function createDeploymentTabBar(doc, { idPrefix, onSelect }) {
  const element = el(doc, 'div', undefined, 'hier-tabs');
  element.setAttribute('role', 'tablist'); element.setAttribute('aria-label', 'Deployments'); element.hidden = true;
  const buttons = new Map(); // tab id -> button
  let order = [], shown = null;
  const choose = (id, focus) => {
    onSelect?.(id);
    if (focus) buttons.get(id)?.focus(); // revealed by its focus listener
  };
  // When the tabs overflow, the strip scrolls horizontally (no scrollbar) and the selected or focused tab
  // is revealed, as in the terminal tab strip; only the strip scrolls, never the page around it.
  // True once the strip could be measured (a hidden stage has no width: nothing is revealed yet).
  function reveal(control) {
    if (!control || !element.clientWidth) return false;
    const left = element.getBoundingClientRect().left + element.clientLeft, right = left + element.clientWidth;
    const box = control.getBoundingClientRect();
    if (box.left < left || box.width > element.clientWidth) element.scrollLeft += box.left - left;
    else if (box.right > right) element.scrollLeft += box.right - right;
    return true;
  }
  // A selection painted while the stage was hidden (a terminal in front of it) is revealed once the strip
  // has a width again; a repaint of a revealed selection never fights the operator's own scrolling.
  let selection = null;
  const revealPending = () => { if (selection !== shown && reveal(buttons.get(selection))) shown = selection; };
  const Observer = doc.defaultView?.ResizeObserver;
  const resizes = Observer ? new Observer(revealPending) : null;
  resizes?.observe(element);
  function button(id) {
    const b = el(doc, 'button'); b.type = 'button'; b.setAttribute('role', 'tab');
    b.addEventListener('focus', () => reveal(b));
    b.addEventListener('click', () => choose(id, false));
    b.addEventListener('keydown', event => {
      const at = order.indexOf(id), n = order.length;
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? n - 1 : event.key === 'ArrowRight' ? (at + 1) % n
        : event.key === 'ArrowLeft' ? (at + n - 1) % n : -1;
      if (index < 0 || at < 0) return;
      event.preventDefault(); choose(order[index], true);
    });
    return b;
  }
  function fill(b, tab) {
    const d = tab.deployment, quiet = !d || !deploymentNeedsWords(d);
    const words = quiet ? '' : deploymentState(d).key === 'live' ? 'not matched' : deploymentState(d).text;
    const key = JSON.stringify([tab.label, words, d?.path || '']);
    if (b.dataset.key === key) return;
    b.dataset.key = key;
    const parts = [doc.createTextNode(tab.label)];
    // Not live: the shared status mark (a shape, never colour alone), its words in the tab's name.
    if (!quiet) parts.push(deploymentMark(doc, words));
    b.replaceChildren(...parts);
    const title = [d?.path || '', words].filter(Boolean).join(' — ');
    if (title) b.title = title; else b.removeAttribute('title');
  }
  function paint(tabs, selected, panelId) {
    const list = Array.isArray(tabs) ? tabs : [];
    const keep = new Set(list.map(t => t.id));
    for (const [id, b] of buttons) if (!keep.has(id)) { b.remove(); buttons.delete(id); }
    order = list.map(t => t.id);
    list.forEach((tab, i) => {
      let b = buttons.get(tab.id);
      if (!b) { b = button(tab.id); buttons.set(tab.id, b); }
      b.id = `${idPrefix}-tab-${i}`;
      fill(b, tab);
      b.setAttribute('aria-selected', String(tab.id === selected)); b.tabIndex = tab.id === selected ? 0 : -1;
      if (panelId) b.setAttribute('aria-controls', panelId);
      if (element.children[i] !== b) element.insertBefore(b, element.children[i] || null);
    });
    element.hidden = !list.length;
    // A newly selected tab (a remembered one, a request from the switcher) is brought into view once.
    selection = selected; revealPending();
  }
  return { element, paint, reveal, selected: () => element.querySelector('[aria-selected="true"]'), dispose: () => resizes?.disconnect() };
}

/** Whether a deployment's heading must say something: it is not live, or it is live but carries a
 * reason (reached, yet not matched to a workspace: an old host, an invalid reference…). A deployment
 * the switcher lists under "Not matched" opens here, so its why is said here too. */
export const deploymentNeedsWords = (deployment) => deploymentState(deployment).key !== 'live' || !!deployment?.short;

/** Whether a deployment's heading has anything to say: words for a failure, or an informational note
 * (a remote that now reports another workspace, a standalone host's local teams). A note is never a
 * failure: it gets no chip and no mark, only its line under "Details". */
export const deploymentHasWords = (deployment) => deploymentNeedsWords(deployment) || !!deployment?.note;

/** A deployment's heading: `{ element, label }`, `label` being the accessible name for the group that
 * holds it (the visible line is aria-hidden; the disclosure stays reachable). `open` and `onToggle`
 * carry the disclosure's state across repaints. */
export function deploymentHead(doc, { deployment, rows, open = false, onToggle }) {
  const label = deploymentLabel(deployment), state = deploymentState(deployment), counts = deploymentCounts(rows);
  // `live` here means "nothing to explain": a reached deployment that is not matched explains itself
  // under a "not matched" chip.
  const live = !deploymentNeedsWords(deployment);
  const chip = state.key === 'live' ? 'not matched' : state.text;
  const head = el(doc, 'div', undefined, 'hier-dhead');
  const line = el(doc, 'div', undefined, 'hier-dline'); line.setAttribute('aria-hidden', 'true');
  // The machine in the group-label type (uppercase); the path beside it in normal case, never
  // transformed: a path is case-sensitive.
  const parts = deploymentLabelParts(deployment);
  const name = el(doc, 'span', undefined, 'hier-dname');
  name.append(el(doc, 'span', parts.machine, 'cnm hier-dmachine'));
  if (parts.path) name.append(doc.createTextNode(' '), el(doc, 'span', `· ${parts.path}`, 'cct hier-dpath'));
  if (deployment.path) name.title = deployment.path;
  line.append(name, el(doc, 'span', counts, 'cct hier-dcount'));
  if (!live) {
    line.append(el(doc, 'span', chip, 'chip hier-dstate'));
    if (deployment.short) line.append(el(doc, 'span', deployment.short, 'cct hier-dshort'));
  }
  head.append(line);
  // With steps to follow, the steps are the explanation (the short reason above already names the
  // cause; the full sentence would repeat step 1): only a remembered deployment's "Last report" lead
  // stays. Without steps, the full sentence says what happens.
  const remembered = !live && deployment.identityFrom === 'remembered' ? 'Last report, not live now.' : '';
  const sentence = live ? '' : (deployment.fix?.length ? remembered : state.detail || deployment.reason || '');
  const steps = live ? [] : deployment.fix || [];
  // A note is information, live or not: always said.
  const note = deployment.note || '';
  if (sentence || steps.length || note) {
    // "How to fix" when there are steps to follow; with only an explanation, it is details.
    const fix = el(doc, 'details', undefined, 'hier-dfix');
    const body = el(doc, 'div', undefined, 'hier-dfix-body');
    if (sentence) body.append(withCode(doc, el(doc, 'p', undefined, 'hier-dfix-reason'), sentence));
    if (steps.length) { const list = el(doc, 'ol', undefined, 'hier-dfix-steps'); for (const step of steps) list.append(withCode(doc, el(doc, 'li'), step)); body.append(list); }
    if (note) body.append(el(doc, 'p', note, 'hier-dfix-note'));
    fix.append(el(doc, 'summary', steps.length ? 'How to fix' : 'Details'), body);
    fix.open = !!open;
    fix.addEventListener('toggle', () => onToggle?.(fix.open));
    head.append(fix);
  }
  return { element: head, label: [label, counts, live ? '' : chip, live ? '' : deployment.short || ''].filter(Boolean).join(', ') };
}

/** The tab's empty state for a deployment that is not live and has no rows: the same heading, in flow. */
export function deploymentReasonBlock(doc, options) {
  const { element, label } = deploymentHead(doc, options);
  const block = el(doc, 'div', undefined, 'hier-dreason');
  block.setAttribute('role', 'group'); block.setAttribute('aria-label', label);
  block.dataset.deployment = options.deployment.id;
  block.append(element);
  return block;
}
