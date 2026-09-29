/** The soul page's "Teams here" (team model v2, OATS 0.30): the teams this soul may join
 * on this computer and its default, inherited (the workspace's default here) or its own,
 * with add/remove and set/clear the default. The document is the kernel's
 * `oats soul teams <soul> --json` (K1's shapes, docs/desktop-cli-api.md "Team model v2"),
 * read and changed through `request(body)`: {action: 'show', soul} |
 * {action: 'add'|'remove', soul, labels} | {action: 'default', soul, label} |
 * {action: 'clear-default', soul}, each answering the document after the write.
 * `listTeams()` answers `oats teams --json` for the labels Add can offer. Refusals are
 * shown verbatim with their code. Membership is local: nothing here is shared.
 *
 * Loading (desktop/loading-states): the first `show` is owned by the shared data-state
 * controller (loading.mjs) — line skeletons sized like the rows after 150ms, "Loading teams…"
 * on a visually hidden status line, the failed block (cause, Details, Retry → show again) when
 * it fails with no document. A `show` with a document present keeps the rows in place (their
 * buttons disabled meanwhile, as before) and restores focus after the repaint; a failure then
 * keeps the document with the problem box, as before. */
import { pageCard } from './capability-page.mjs';
import { createDataState, skeletonBlock, statusLine, captureFocusState } from './loading.mjs';

export const soulTeamsHereCSS = `
.soul-teams-here .sth-default { margin:0; color:var(--fg); font-size:12px; line-height:1.45; overflow-wrap:anywhere; }
.soul-teams-here .sth-default .sth-why { color:var(--muted); }
.soul-teams-here .sth-blocking { display:flex; flex-direction:column; gap:2px; padding-left:8px; border-left:2px solid var(--danger); color:var(--muted); font-size:11.5px; line-height:1.45; overflow-wrap:anywhere; }
.soul-teams-here .sth-blocking strong { color:var(--fg); font-size:12px; font-weight:650; }
.soul-teams-here .sth-row { display:grid; grid-template-columns:minmax(0,1fr) auto; column-gap:10px; row-gap:4px; align-items:start; padding:8px 0; border-top:1px solid var(--tag-bg); }
.soul-teams-here .sth-main { display:flex; flex-direction:column; gap:2px; min-width:0; }
.soul-teams-here .sth-head { display:flex; align-items:center; flex-wrap:wrap; gap:4px 8px; min-width:0; }
.soul-teams-here .sth-label { color:var(--fg); font:650 12.5px var(--mono,monospace); overflow-wrap:anywhere; }
.soul-teams-here .sth-meta { color:var(--muted); font-size:11.5px; line-height:1.45; overflow-wrap:anywhere; }
.soul-teams-here .sth-meta.warn { color:var(--warn); }
.soul-teams-here .sth-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:6px; }
.oats-view .soul-teams-here button.sth-act { height:26px; min-height:26px; padding:0 10px; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--fg); font:600 11.5px var(--sans,system-ui); white-space:nowrap; cursor:pointer; }
.oats-view .soul-teams-here button.sth-act:hover:not(:disabled) { background:var(--surface-2); }
.oats-view .soul-teams-here button.sth-act:disabled { color:var(--muted); cursor:default; }
.oats-view .soul-teams-here button.sth-act.primary:not(:disabled) { background:var(--primary-bg); border-color:var(--primary-bg); color:var(--primary-fg); }
.oats-view .soul-teams-here button.sth-act:not(.primary):focus-visible { background:var(--sel); }
.soul-teams-here .sth-add { display:flex; flex-wrap:wrap; align-items:center; gap:6px; padding-top:8px; border-top:1px solid var(--tag-bg); }
.soul-teams-here .sth-add select { height:26px; min-width:0; max-width:100%; padding:0 6px; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--fg); font:12px var(--mono,monospace); }
.soul-teams-here .sth-error { grid-column:1 / -1; border-left:2px solid var(--danger); padding-left:8px; color:var(--fg); font-size:12px; line-height:1.45; }
.soul-teams-here .sth-error p { margin:0; overflow-wrap:anywhere; }
.soul-teams-here .sth-error summary { color:var(--muted); font-size:11.5px; cursor:pointer; }
.soul-teams-here .sth-error pre { margin:4px 0 0; color:var(--fg); font:11px var(--mono,monospace); white-space:pre-wrap; overflow-wrap:anywhere; }
/* Loading placement: the skeleton reads as the default line and two rows (loading.css styles the bones). */
.soul-teams-here .skeleton-lines { gap:14px; padding:4px 0 6px; }
.soul-teams-here .skeleton-lines .skeleton-line { height:12px; width:85%; }
.soul-teams-here .skeleton-lines .skeleton-line:nth-child(2) { width:55%; }
.soul-teams-here .skeleton-lines .skeleton-line:nth-child(3) { width:65%; }
.soul-teams-here .loading-failed { padding:6px 0 0; }
.soul-teams-here .page-card-title .loading-refreshing { margin-left:auto; }
`;

const text = v => typeof v === 'string' && v ? v : null;
const list = v => Array.isArray(v) ? v : [];
function el(doc, tag, value, cls) {
  const node = doc.createElement(tag);
  if (value !== undefined && value !== null) node.textContent = value;
  if (cls) node.className = cls;
  return node;
}

/** Why the soul has a team (the kernel's `via`), in words. */
export function viaText(via, defaultFrom) {
  const words = list(via).map(v => v === 'default' ? (defaultFrom === 'soul' ? "its own default" : "the workspace's default here")
    : v === '*' ? 'every soul may join it' : v === 'soul' ? 'added for this soul' : v);
  return words.join(' · ');
}
const fromText = from => from === 'shared' ? 'shared' : from === 'local' ? 'local' : from;

export function createSoulTeamsHere(doc, { soul, request, listTeams = null, clock = {} }) {
  const { card, head } = pageCard(doc, 'Teams here', { lead: 'on this computer' });
  card.classList.add('soul-teams-here'); head.tabIndex = -1; // the focus fallback when a focused row is gone
  const body = el(doc, 'div', null, 'sth-body'); card.append(body);
  // The card has no visible status line: the announcements ("Loading teams…", a failure) are spoken only.
  const status = statusLine(doc, { visuallyHidden: true }); card.append(status);
  const loading = createDataState({ doc, noun: 'teams', region: body, status, indicatorHost: head, noticeHost: null,
    skeleton: () => skeletonBlock(doc, 'line', { count: 3 }), onRetry: () => { void run({ action: 'show' }, { user: true }); },
    now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  let current = null, pending = false, serial = 0, disposed = false, rowError = null, cardError = null, choices = null, focusAdd = false;

  async function run(action, { label = null, user = false } = {}) {
    const ticket = ++serial; pending = true; rowError = null; cardError = null;
    const read = action.action === 'show';
    if (read) loading.begin({ user });
    // A read over a document keeps the rows (and what holds focus in them): only the actions lock, in place.
    // Focus is captured right before each repaint below, not here: it may move while the read runs.
    const keep = read && !!current;
    if (keep) lockActions(); else render();
    // Repaint with focus restored by key (remove:<label>, default:<label>, add…): a row that moved is found
    // again, a row that is gone hands focus to the card's title, never to the neighbouring control.
    const repaint = () => { const restore = keep ? captureFocusState(body, { fallback: head }) : null; render(); restore?.(); };
    try {
      // No `refresh: true` hint here: /api/workspace-soul-teams admits {action, soul, labels, label} only (server/teams.mjs).
      const next = await request({ soul, ...action });
      if (disposed || ticket !== serial) return;
      pending = false;
      if (!next || !Array.isArray(next.teams)) {
        cardError = { message: `The teams of ${soul} on this computer could not be read.` };
        if (read) loading.fail(cardError);
        repaint(); return;
      }
      current = next; if (read) loading.succeed({ observedAt: text(next.observedAt) });
      repaint();
    } catch (error) {
      if (disposed || ticket !== serial) return;
      pending = false;
      const shown = { code: text(error?.code), message: text(error?.message) || 'The change was refused.' };
      if (label) rowError = { label, ...shown }; else cardError = shown;
      if (read) loading.fail(shown);
      repaint();
    }
  }
  function lockActions() {
    for (const control of body.querySelectorAll('button.sth-act, select')) control.disabled = true;
    for (const box of body.querySelectorAll('.sth-error')) box.remove();
  }
  async function loadChoices() {
    if (typeof listTeams !== 'function') return;
    try { const all = await listTeams(); if (!disposed) { choices = list(all?.teams).filter(t => text(t?.label)); focusAdd = true; render(); } }
    catch { if (!disposed) { choices = []; render(); } }
  }
  function button(label, cls, onClick, { disabled = false, title = '', aria = '', key = '' } = {}) {
    const b = el(doc, 'button', label, `sth-act${cls ? ` ${cls}` : ''}`); b.type = 'button';
    if (key) b.dataset.focusKey = key;
    b.disabled = disabled || pending; if (title) b.title = title; if (aria) b.setAttribute('aria-label', aria);
    b.addEventListener('click', () => { if (!b.disabled) onClick(); });
    return b;
  }
  function problemBox(error) {
    const wrap = el(doc, 'div', null, 'sth-error'); wrap.setAttribute('role', 'alert');
    wrap.append(el(doc, 'p', error.message));
    if (error.code) { const more = el(doc, 'details'); more.append(el(doc, 'summary', 'Details'), el(doc, 'pre', error.code)); wrap.append(more); }
    return wrap;
  }

  function render() {
    if (disposed) return;
    // The skeleton and the failed block are the controller's (loading.mjs); the rows are ours.
    for (const child of [...body.children]) if (!child.dataset.loadingSkeleton && !child.classList.contains('loading-failed')) child.remove();
    // No document yet: pending shows the skeleton, a failure the failed block — both the controller's. Nothing else to say.
    if (!current) return;
    const home = current.defaultTeam;
    const line = el(doc, 'p', null, 'sth-default');
    if (home) {
      line.append('Default: ', el(doc, 'strong', home.label), ' ');
      line.append(el(doc, 'span', home.from === 'soul' ? "(this soul's own)" : "(the workspace's default on this computer)", 'sth-why'));
    } else line.append('No default team on this computer: run oats aweb setup.');
    body.append(line);
    // An unmapped default blocks every spawn of this soul here: said, with what to do.
    if (home && !home.team) {
      const block = el(doc, 'div', null, 'sth-blocking'); block.setAttribute('role', 'alert');
      block.append(el(doc, 'strong', `The default team ${home.label} has no provider id yet, so ${soul} can't be spawned here.`),
        el(doc, 'span', "Its owner runs oats aweb setup, then commits the id; or make another team this soul's default."));
      body.append(block);
    }
    for (const team of list(current.teams)) {
      const row = el(doc, 'div', null, 'sth-row'); row.dataset.team = team.label;
      const main = el(doc, 'div', null, 'sth-main'), head = el(doc, 'div', null, 'sth-head');
      head.append(el(doc, 'span', team.label, 'sth-label'));
      if (team.default) head.append(el(doc, 'span', 'default', 'page-tag'));
      main.append(head);
      main.append(el(doc, 'span', `${team.team ?? 'no provider id yet'} · ${fromText(team.from)}`, `sth-meta${team.team ? '' : ' warn'}`));
      main.append(el(doc, 'span', viaText(team.via, home?.from), 'sth-meta'));
      const actions = el(doc, 'div', null, 'sth-actions');
      if (!team.default && team.team) actions.append(button('Make default', '', () => run({ action: 'default', label: team.label }, { label: team.label }), { aria: `Make ${team.label} the default team of ${soul}`, key: `default:${team.label}` }));
      if (team.default && home?.from === 'soul') actions.append(button('Use workspace default', '', () => run({ action: 'clear-default' }, { label: team.label }), { aria: `Use the workspace's default team for ${soul}`, key: 'clear-default' }));
      if (list(team.via).includes('soul')) actions.append(button('Remove', '', () => run({ action: 'remove', labels: [team.label] }, { label: team.label }), { aria: `Remove ${team.label} from ${soul}`, key: `remove:${team.label}` }));
      row.append(main, actions);
      if (rowError?.label === team.label) row.append(problemBox(rowError));
      body.append(row);
    }
    // Add: a team on this computer the soul is not in yet.
    const have = new Set(list(current.teams).map(t => t.label));
    const offer = (choices || []).filter(t => !have.has(t.label));
    const add = el(doc, 'div', null, 'sth-add');
    if (choices === null) add.append(button('Add a team', '', () => { void loadChoices(); }, { key: 'add-team' }));
    else if (!offer.length) add.append(el(doc, 'span', `${soul} is in every team on this computer.`, 'sth-meta'));
    else {
      const select = el(doc, 'select'); select.setAttribute('aria-label', `Team to add to ${soul}`); select.dataset.focusKey = 'add-select';
      for (const t of offer) { const o = el(doc, 'option', t.team ? t.label : `${t.label} (no provider id yet)`); o.value = t.label; select.append(o); }
      add.append(select, button('Add', 'primary', () => run({ action: 'add', labels: [select.value] }), { key: 'add' }));
      if (focusAdd) { focusAdd = false; queueMicrotask(() => { if (select.isConnected) select.focus(); }); }
    }
    if (cardError) add.append(problemBox(cardError));
    body.append(add);
  }

  void run({ action: 'show' });
  return { element: card, refresh: ({ user = false } = {}) => run({ action: 'show' }, { user }), dispose() { disposed = true; serial++; loading.dispose(); } };
}
