/** A capability's page in the Workspace view (F7): the full available width,
 * "← Capabilities" (or "← <soul>") back to where it was opened. Presentation
 * only: the row is the catalog's (`oats capabilities`) or a soul's resolved
 * capability in the same shape (capabilityRow); usage is the roster's module
 * rows. Nothing here is inferred — unreported facts are not shown. */
import { createCapabilityMark, createSoulMark } from './identity-marks.mjs';
import { iconElement } from './shell-icons.mjs';
import { capabilitySource, capabilityUse, memberNames } from './workspace-catalog.mjs';

export const capabilityPageCSS = `
.capability-page { display:flex; flex-direction:column; gap:var(--section-gap); max-width:1180px; }
.capability-page .page-head { display:flex; align-items:center; gap:14px; min-width:0; }
.capability-page .page-head .identity-mark { width:44px; height:44px; border-radius:11px; font-size:18px; flex:none; }
.capability-page .page-title { display:flex; flex-direction:column; gap:2px; min-width:0; }
.capability-page .page-title h2 { margin:0; font-size:20px; line-height:1.25; overflow-wrap:anywhere; }
.capability-page .page-title .catalog-sub { font-size:12px; white-space:normal; }
.capability-page .page-head .catalog-chips { margin-left:auto; flex:none; }
.capability-page .page-cards { display:grid; grid-template-columns:repeat(auto-fill, minmax(min(100%, 340px), 1fr)); gap:16px; align-items:start; }
.capability-page .page-card.wide { grid-column:1 / -1; }
.capability-page .used-row { display:flex; align-items:center; gap:10px; min-height:48px; padding:6px 16px; box-sizing:border-box; border-top:1px solid var(--border); }
.capability-page .used-row:first-of-type { border-top:0; }
.capability-page .used-row .identity-mark { width:28px; height:28px; border-radius:7px; font-size:12px; flex:none; }
.capability-page .used-row .used-name { font-weight:650; font-size:12.5px; }
.capability-page .used-row .used-meta { margin-left:auto; color:var(--muted); font-size:11.5px; }
.oats-view .capability-page button.used-row { width:100%; border-left:0; border-right:0; border-bottom:0; border-radius:0; background:var(--surface); color:var(--fg); text-align:left; cursor:pointer; font:inherit; }
.oats-view .capability-page button.used-row:hover { background:var(--surface-2); }
.oats-view .capability-page button.used-row:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }
.capability-page pre { margin:0; padding:10px; border:1px solid var(--border); border-radius:7px; background:var(--surface-2); color:var(--fg); overflow:auto; font-size:11.5px; }
`;

/** The shared page chrome: "← back", and cards with the catalog table's header band. */
export const pageCardCSS = `
.page-crumb { display:flex; align-items:center; margin-bottom:calc(var(--title-gap) * -1); }
.oats-view button.page-back { display:inline-flex; align-items:center; gap:4px; min-height:28px; padding:0 8px 0 4px; border:0; border-radius:6px; background:transparent; color:var(--muted); font-weight:600; cursor:pointer; }
.oats-view button.page-back:hover { background:var(--surface-2); color:var(--fg); }
.oats-view button.page-back:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.page-card { background:var(--surface); border:1px solid var(--border); border-radius:10px; overflow:hidden; min-width:0; box-sizing:border-box; font-size:12px; }
.page-card-head { display:flex; align-items:center; gap:8px; min-height:36px; margin:0; padding:0 16px; box-sizing:border-box; background:var(--surface-2); border-bottom:1px solid var(--border); color:var(--muted); font-size:10.5px; font-weight:650; letter-spacing:.06em; text-transform:uppercase; }
.page-card-body { padding:12px 16px 14px; display:grid; gap:var(--title-gap); min-width:0; }
.page-card-body > * { margin:0; }
.page-facts { display:grid; grid-template-columns:max-content minmax(0,1fr); gap:8px 16px; margin:0; }
.page-facts dt { color:var(--muted); }
.page-facts dd { margin:0; overflow-wrap:anywhere; }
.page-facts dd.mono { font:11.5px var(--mono,monospace); }
.page-note { color:var(--muted); line-height:1.5; }
`;

const text = v => typeof v === 'string' && v ? v : null;
const list = v => Array.isArray(v) ? v : [];

/** One card: a header band like the catalog table's, then its body. */
export function pageCard(doc, title, { wide = false } = {}) {
  const card = doc.createElement('section'); card.className = `page-card${wide ? ' wide' : ''}`;
  const head = doc.createElement('h3'); head.className = 'page-card-head'; head.textContent = title;
  const body = doc.createElement('div'); body.className = 'page-card-body';
  card.append(head, body); card.dataset.card = title;
  return { card, head, body };
}
export function pageBack(doc, label, onBack) {
  const crumb = doc.createElement('div'); crumb.className = 'page-crumb';
  const back = doc.createElement('button'); back.type = 'button'; back.className = 'page-back';
  back.append(iconElement(doc, 'chevronLeft', { size: 14 }), Object.assign(doc.createElement('span'), { textContent: label }));
  back.setAttribute('aria-label', `Back to ${label}`);
  back.addEventListener('click', () => onBack());
  crumb.append(back);
  return { crumb, back };
}

/** @param row a catalog row (or capabilityRow(resolved)); from: { label } when opened from a soul page. */
export function renderCapabilityPage(host, { row, status, instances, root, backLabel = 'Capabilities', onBack, openSoul = null, from = null }) {
  const doc = host.ownerDocument;
  const node = (tag, value, cls) => { const el = doc.createElement(tag); if (value !== undefined && value !== null) el.textContent = value; if (cls) el.className = cls; return el; };
  const facts = (parent, entries) => {
    const dl = node('dl', undefined, 'page-facts');
    for (const [key, value, cls] of entries) if (text(value)) { dl.append(node('dt', key)); const dd = node('dd', value, cls); dl.append(dd); }
    parent.append(dl);
  };
  host.replaceChildren();
  const page = node('div', undefined, 'capability-page'); page.dataset.capability = row.name;
  const { crumb } = pageBack(doc, backLabel, onBack);
  const source = capabilitySource(row, memberNames(status));
  const head = node('div', undefined, 'page-head');
  const title = node('div', undefined, 'page-title');
  const sub = row.kind === 'package' ? `Package · ${row.package}${row.version ? ` v${row.version}` : ''}`
    : row.kind === 'member' ? `Member · ${source.label}${text(row.team) && row.team !== source.label ? ` · ${row.team}` : ''}` : `External · ${text(row.origin) || source.label}`;
  const heading = node('h2', row.name); heading.title = row.name;
  title.append(heading, node('span', sub, 'catalog-sub'));
  const chips = node('div', undefined, 'catalog-chips');
  const chip = (label, cls = '') => node('span', label, `catalog-chip${cls ? ` ${cls}` : ''}`);
  chips.append(row.kind === 'package' ? chip('locked', 'ok') : row.kind === 'member' ? chip('member confirmed', 'ok') : chip('external'));
  if (text(row.layer)) chips.append(chip(`${row.layer} provider`));
  if (text(row.commit)) { const c = chip(`@${row.commit.slice(0, 7)}`, 'mono'); c.title = `Commit ${row.commit}`; chips.append(c); }
  head.append(createCapabilityMark(doc, { id: row.name }, { root }), title, chips);
  const cards = node('div', undefined, 'page-cards');
  // Source: only what the catalog reports.
  const src = pageCard(doc, 'Source');
  facts(src.body, [['Kind', row.kind === 'package' ? 'Package' : row.kind === 'member' ? 'Workspace member' : 'External'],
    ['Package', row.package], ['Version', row.version], ['Repository', row.kind !== 'package' ? source.label : null], ['Key', row.repoKey, 'mono'],
    ['Path', row.path, 'mono'], ['Team', row.team], ['Layer', row.layer ? `${row.layer} provider` : null], ['Commit', row.commit, 'mono'], ['Origin', row.origin]]);
  cards.append(src.card);
  // Used by: the souls whose instances carry it (roster module rows).
  const use = capabilityUse(instances, row.name);
  const used = pageCard(doc, `Used by · ${use.souls.length} soul${use.souls.length === 1 ? '' : 's'}`);
  used.body.className = 'page-card-body used-list'; used.body.style.padding = '0';
  if (!use.souls.length) used.body.append(node('p', 'No instance carries it yet.', 'page-note used-row'));
  for (const soul of use.souls) {
    const carrying = list(instances).filter(i => i.agent === soul.name && i.agentsRoot === soul.agentsRoot && moduleRow(i, row.name));
    const behind = carrying.filter(i => moduleRow(i, row.name)?.status === 'moved').length;
    const el = typeof openSoul === 'function' ? node('button', undefined, 'used-row') : node('div', undefined, 'used-row');
    if (el.tagName === 'BUTTON') { el.type = 'button'; el.addEventListener('click', () => openSoul(soul)); el.title = `Open ${soul.name}`; }
    el.append(createSoulMark(doc, soul), node('span', soul.name, 'used-name'),
      node('span', `${carrying.length} instance${carrying.length === 1 ? '' : 's'}${behind ? ` · ${behind} behind` : ''}`, 'used-meta'));
    used.body.append(el);
  }
  cards.append(used.card);
  // As the soul it was opened from resolves it (inspect): settings, requirements, operations.
  const resolved = row.resolved;
  if (from && resolved) {
    const r = pageCard(doc, `As ${from.label} resolves it`, { wide: true });
    const missing = list(resolved.missingRequires);
    facts(r.body, [['Version', resolved.version], ['Missing requirements', missing.length ? missing.join(', ') : 'None'],
      ['Declared settings', list(resolved.declares).length ? resolved.declares.join(', ') : null],
      ['Operations', list(resolved.operations).length ? resolved.operations.map(o => `${o.layer || resolved.layer || ''}${o.layer || resolved.layer ? ':' : ''}${o.name}`).join(', ') : null]]);
    if (resolved.settings && typeof resolved.settings === 'object' && Object.keys(resolved.settings).length) {
      const d = node('details'); d.append(node('summary', 'Settings'), node('pre', JSON.stringify(resolved.settings, null, 2))); r.body.append(d);
    }
    cards.append(r.card);
  }
  page.append(crumb, head, cards);
  host.append(page);
  return page;
}

function moduleRow(instance, name) {
  const rows = Array.isArray(instance.modules) ? instance.modules : Object.entries(instance.modules || {}).map(([key, row]) => ({ name: key, ...row }));
  return rows.find(m => m?.name === name) || null;
}
