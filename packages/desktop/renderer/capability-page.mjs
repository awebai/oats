/** Workspace v4 pages (W4 soul page, W5b capability page): a page bar in place
 * of the Workspace tabs ("‹ Back", the breadcrumb, the page's actions), then a
 * main column and a 300px side column of cards. Presentation only: the row is
 * the catalog's (`oats capabilities`) or a soul's resolved capability in the
 * same shape (capabilityRow); usage is the roster's module rows; provenance is
 * workspace status. Nothing here is inferred — unreported facts are not shown. */
import { createSoulMark } from './identity-marks.mjs';
import { iconElement } from './shell-icons.mjs';
import { capabilitySource, capabilityUse, capabilityRow, memberNames, layerLabel, sourceChip } from './workspace-catalog.mjs';

/** The shared page chrome: bar, columns, section titles and side cards. */
export const pageCardCSS = `
.workspace-page { padding:0 !important; }
.page-bar { position:sticky; top:0; z-index:2; display:flex; align-items:center; gap:8px; height:var(--bar-h); min-height:48px; padding:0 16px; box-sizing:border-box; border-bottom:1px solid var(--border); background:var(--surface); font-size:12.5px; }
.oats-view .page-bar button.page-back { display:inline-flex; align-items:center; gap:6px; height:30px; min-height:30px; margin-right:6px; padding:0 10px 0 8px; border:1px solid var(--border); border-radius:7px; background:var(--surface); color:var(--fg); font:600 12.5px var(--sans,system-ui); cursor:pointer; flex:none; }
.oats-view .page-bar button.page-back:hover { background:var(--surface-2); }
.oats-view .page-bar button.page-back:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.page-crumbs { display:flex; align-items:center; gap:8px; min-width:0; color:var(--muted); white-space:nowrap; overflow:hidden; }
.page-crumbs .page-crumb-current { color:var(--fg); font-weight:650; overflow:hidden; text-overflow:ellipsis; }
.page-bar-actions { margin-left:auto; display:flex; align-items:center; gap:8px; flex:none; }
.oats-view .page-bar-actions button.act { height:30px; min-height:30px; padding:0 12px; border-radius:7px; font-size:12.5px; font-weight:600; }
.oats-view .page-bar-actions button.act.primary:not(:disabled) { background:var(--primary-bg); color:var(--primary-fg); border-color:var(--primary-bg); font-weight:650; }
.page-body { display:grid; grid-template-columns:minmax(0,1fr) 300px; gap:24px; padding:22px 28px 28px; align-items:start; }
.page-main, .page-side { display:flex; flex-direction:column; min-width:0; }
.page-main { gap:22px; }
.page-side { gap:14px; }
@container (max-width: 860px) { .page-body { grid-template-columns:minmax(0,1fr); } }
.page-identity { display:flex; align-items:center; gap:14px; min-width:0; }
.page-identity .identity-mark, .page-glyph { width:48px; height:48px; border-radius:11px; font-size:20px; font-weight:700; flex:none; }
.page-glyph { display:grid; place-items:center; background:var(--chip-bg); color:var(--fg); }
.page-identity-copy { display:flex; flex-direction:column; gap:3px; min-width:0; }
.page-title { display:flex; align-items:center; gap:10px; min-width:0; margin:0; font-size:20px; font-weight:700; letter-spacing:-.01em; overflow-wrap:anywhere; }
.page-title.mono { font:700 20px var(--mono,monospace); }
.page-tag { display:inline-flex; align-items:center; height:22px; padding:0 7px; border-radius:5px; background:var(--chip-bg); color:var(--fg); font:650 11.5px var(--sans,system-ui); letter-spacing:0; white-space:nowrap; }
.page-lede { margin:0; color:var(--muted); font-size:13px; }
.page-facts-row { display:flex; flex-wrap:wrap; align-items:center; gap:6px 20px; margin-top:8px; font-size:12.5px; }
.page-fact { display:inline-flex; align-items:center; gap:7px; white-space:nowrap; min-width:0; }
.page-fact .shell-icon { color:var(--muted); }
.page-fact .mono { font-family:var(--mono,monospace); font-weight:600; }
.page-fact .muted { color:var(--muted); }
.page-fact .strong { font-weight:600; }
.page-fact .runtime-badge { width:22px; height:22px; border-radius:6px; font-size:11px; }
.page-section { display:flex; flex-direction:column; gap:10px; min-width:0; }
.page-section-title { display:flex; align-items:baseline; flex-wrap:wrap; gap:10px; margin:0; font-size:13.5px; font-weight:650; }
.page-section-lead { color:var(--muted); font-size:12px; font-weight:400; }
.page-cards3 { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }
@container (max-width: 700px) { .page-cards3 { grid-template-columns:minmax(0,1fr); } }
.page-card { display:flex; flex-direction:column; gap:6px; min-width:0; padding:12px 14px; box-sizing:border-box; background:var(--surface); border:1px solid var(--border); border-radius:10px; font-size:12px; }
.page-card-title { display:flex; align-items:baseline; gap:8px; margin:0 0 4px; color:var(--muted); font-size:11px; font-weight:650; letter-spacing:.05em; text-transform:uppercase; }
.page-card-title .shell-icon { align-self:center; }
.page-card-lead { color:var(--muted); font-size:11.5px; font-weight:400; letter-spacing:0; text-transform:none; }
.page-card-count { color:var(--muted); font:11px var(--mono,monospace); letter-spacing:0; text-transform:none; }
.page-note { margin:0; color:var(--muted); font-size:12px; line-height:1.5; }
.page-list-item { display:flex; align-items:center; gap:8px; min-height:26px; font:12px var(--mono,monospace); min-width:0; }
.page-list-item > :first-child { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
.page-kv { display:grid; grid-template-columns:84px minmax(0,1fr); gap:10px; align-items:center; min-height:32px; border-bottom:1px solid var(--tag-bg); }
.page-kv:last-child { border-bottom:0; }
.page-kv dt { color:var(--muted); font-size:12px; }
.page-kv dd { margin:0; font:12px var(--mono,monospace); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.page-kv-list { margin:0; }
.page-table { background:var(--surface); border:1px solid var(--border); border-radius:10px; overflow:hidden; }
.page-table-row { display:grid; gap:12px; align-items:center; min-height:42px; padding:0 16px; box-sizing:border-box; border-top:1px solid var(--tag-bg); }
.page-table-row.head { min-height:34px; border-top:0; border-bottom:1px solid var(--border); color:var(--muted); font-size:11px; font-weight:650; letter-spacing:.05em; text-transform:uppercase; }
.page-table-row.head + .page-table-row { border-top:0; }
.oats-view .page-table button.page-table-row { width:100%; border-left:0; border-right:0; border-bottom:0; border-radius:0; background:var(--surface); color:var(--fg); text-align:left; font:inherit; cursor:pointer; }
.oats-view .page-table button.page-table-row:hover { background:var(--surface-2); }
.oats-view .page-table button.page-table-row:focus-visible, .page-table .page-table-row.openable:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }
.page-table .page-table-row.openable { cursor:pointer; }
.page-table .page-table-row.openable:hover { background:var(--surface-2); }
.why-tag { display:inline-flex; align-items:center; justify-self:start; flex:none; height:20px; padding:0 6px; border-radius:4px; background:var(--tag-bg); color:var(--fg); font-size:11px; font-weight:600; white-space:nowrap; }
.why-tag.soul { background:var(--primary-bg); color:var(--primary-fg); }
.why-note { color:var(--muted); font-size:12px; white-space:nowrap; }
`;

export const capabilityPageCSS = `
.capability-page .used-row { grid-template-columns:minmax(0,1.3fr) minmax(0,1fr); }
.capability-page .used-soul { display:flex; align-items:center; gap:9px; min-width:0; }
.capability-page .used-soul .identity-mark { width:24px; height:24px; border-radius:7px; font-size:11px; font-weight:700; }
.capability-page .used-name { font-size:12.5px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.capability-page .used-meta { color:var(--muted); font-size:12px; white-space:nowrap; }
.capability-page .used-meta.warn { color:var(--warn); }
.capability-page pre { margin:0; padding:10px; border:1px solid var(--border); border-radius:7px; background:var(--surface-2); color:var(--fg); overflow:auto; font-size:11.5px; }
`;

/** A soul's composition (W4): Capability | Source | Why it's here. */
export const soulCapabilitiesCSS = `
.soul-caps .soul-cap-row { grid-template-columns:minmax(0,1fr) minmax(0,1.3fr) minmax(0,1fr); min-height:44px; }
.soul-caps .soul-cap-row.head { min-height:34px; }
.soul-cap-name { display:flex; flex-direction:column; min-width:0; }
.soul-cap-id { color:var(--fg); font:600 12.5px var(--mono,monospace); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.soul-cap-note { color:var(--muted); font-size:11px; }
.soul-cap-row.off .soul-cap-id { color:var(--muted); text-decoration:line-through; }
.soul-cap-why { display:flex; align-items:center; gap:6px; min-width:0; font-size:12px; }
.soul-caps .page-note { padding:12px 16px; }
`;

const text = v => typeof v === 'string' && v ? v : null;
const list = v => Array.isArray(v) ? v : [];
const short = v => typeof v === 'string' && /^[0-9a-f]{40}$/i.test(v) ? v.slice(0, 7) : v;

function el(doc, tag, value, cls) {
  const node = doc.createElement(tag);
  if (value !== undefined && value !== null) node.textContent = value;
  if (cls) node.className = cls;
  return node;
}

/** The page bar: "‹ back", the breadcrumb (Workspace / section / this page) and actions. */
export function pageBar(doc, { backLabel, crumbs = [], current, onBack }) {
  const bar = el(doc, 'div', null, 'page-bar');
  const back = el(doc, 'button', null, 'page-back'); back.type = 'button';
  back.append(iconElement(doc, 'chevronLeft', { size: 15 }), el(doc, 'span', backLabel));
  back.setAttribute('aria-label', `Back to ${backLabel}`); back.title = `Back to ${backLabel} (Esc)`;
  back.addEventListener('click', () => onBack());
  const trail = el(doc, 'nav', null, 'page-crumbs'); trail.setAttribute('aria-label', 'Breadcrumb');
  for (const crumb of crumbs) trail.append(el(doc, 'span', crumb), el(doc, 'span', '/', 'page-crumb-sep'));
  const here = el(doc, 'span', current, 'page-crumb-current'); here.setAttribute('aria-current', 'page'); trail.append(here);
  const actions = el(doc, 'div', null, 'page-bar-actions');
  bar.append(back, trail, actions);
  return { bar, back, actions };
}
/** Kept for callers of the F7 page chrome: a bare back control. */
export function pageBack(doc, label, onBack) {
  const { bar, back } = pageBar(doc, { backLabel: label, current: '', onBack });
  return { crumb: bar, back };
}
export function pageSection(doc, title, lead = '') {
  const section = el(doc, 'section', null, 'page-section');
  const head = el(doc, 'h3', null, 'page-section-title'); head.append(el(doc, 'span', title));
  if (lead) head.append(el(doc, 'span', lead, 'page-section-lead'));
  section.append(head); section.dataset.section = title;
  return section;
}
/** A side card with an uppercase title (and an optional lead or count). */
export function pageCard(doc, title, { lead = '', count = null, icon = null } = {}) {
  const card = el(doc, 'section', null, 'page-card'); card.dataset.card = title;
  const head = el(doc, 'h3', null, 'page-card-title');
  if (icon) head.append(iconElement(doc, icon, { size: 13 }));
  head.append(el(doc, 'span', title));
  if (count !== null) head.append(el(doc, 'span', String(count), 'page-card-count'));
  if (lead) head.append(el(doc, 'span', lead, 'page-card-lead'));
  card.append(head);
  return { card, head, body: card };
}
/** key → value rows (the "Comes from" card); only reported values. */
export function pageFacts(doc, entries) {
  const dl = el(doc, 'dl', null, 'page-kv-list');
  for (const [key, value, title] of entries) if (text(value)) {
    const row = el(doc, 'div', null, 'page-kv'); const dd = el(doc, 'dd', value); dd.title = title || value;
    row.append(el(doc, 'dt', key), dd); dl.append(row);
  }
  return dl;
}

const LAYER_ICONS = { knowledge: 'knowledge', messaging: 'mail', tasks: 'tasks' };
/** A core capability's icon (book, mail, checklist), else package or repository. */
export const capabilityIcon = row => LAYER_ICONS[row?.layer] || (row?.kind === 'package' ? 'package' : 'repo');

/** Where a package comes from, in workspace status terms: the official catalog or a git source. */
export function packageOrigin(source) {
  if (!text(source)) return null;
  if (source.startsWith('catalog:')) return 'official catalog';
  const git = /^git:(?:[a-z]+:\/\/)?(?:[^@/]+@)?([^/:@]+)/i.exec(source);
  return git ? `git · ${git[1]}` : source;
}

/** @param row a catalog row (or capabilityRow(resolved)); from: { label } when opened from a soul page. */
export function renderCapabilityPage(host, { row, status, instances, root, backLabel = 'Capabilities', onBack, openSoul = null, from = null }) {
  const doc = host.ownerDocument;
  const node = (tag, value, cls) => el(doc, tag, value, cls);
  host.replaceChildren();
  const page = node('div', undefined, 'capability-page'); page.dataset.capability = row.name;
  const { bar } = pageBar(doc, { backLabel, crumbs: from ? ['Workspace', 'Souls', from.label] : ['Workspace', 'Capabilities'], current: row.name, onBack });
  const body = node('div', undefined, 'page-body'), main = node('div', undefined, 'page-main'), side = node('div', undefined, 'page-side');
  // Identity: its icon, name and core tag.
  const identity = node('div', undefined, 'page-identity');
  const glyph = node('span', undefined, 'page-glyph'); glyph.setAttribute('aria-hidden', 'true'); glyph.append(iconElement(doc, capabilityIcon(row), { size: 22 }));
  const copy = node('div', undefined, 'page-identity-copy');
  const title = node('h2', undefined, 'page-title mono'); title.append(node('span', row.name));
  if (text(row.layer)) title.append(node('span', `Core · ${layerLabel(row.layer)}`, 'page-tag'));
  copy.append(title);
  identity.append(glyph, copy); main.append(identity);
  // Provides: the commands the resolved capability declares (inspect operations), when opened from a soul.
  const resolved = row.resolved;
  if (from && resolved) {
    const provides = pageSection(doc, 'Provides');
    const cards = node('div', undefined, 'page-cards3');
    const commands = list(resolved.operations).map(op => list(op.argv).filter(part => typeof part === 'string' && part).join(' ') || op.name).filter(Boolean);
    if (commands.length) { const c = pageCard(doc, 'Commands', { count: commands.length }); for (const cmd of commands) c.card.append(node('span', cmd, 'page-list-item')); cards.append(c.card); }
    const declared = list(resolved.declares);
    if (declared.length) { const c = pageCard(doc, 'Settings', { count: declared.length }); for (const key of declared) c.card.append(node('span', key, 'page-list-item')); cards.append(c.card); }
    if (cards.childElementCount) { provides.append(cards); main.append(provides); }
  }
  // Used by: the souls whose instances carry it (roster module rows).
  const use = capabilityUse(instances, row.name);
  const used = pageSection(doc, 'Used by', `${use.souls.length} soul${use.souls.length === 1 ? '' : 's'}`);
  const table = node('div', undefined, 'page-table'); table.setAttribute('role', 'table'); table.setAttribute('aria-label', `Souls using ${row.name}`);
  const head = node('div', undefined, 'page-table-row head used-row'); head.setAttribute('role', 'row');
  for (const label of ['Soul', 'Instances']) { const cell = node('span', label); cell.setAttribute('role', 'columnheader'); head.append(cell); }
  table.append(head);
  if (!use.souls.length) table.append(node('p', 'No instance carries it yet.', 'page-note page-table-row'));
  for (const soul of use.souls) {
    const carrying = list(instances).filter(i => i.agent === soul.name && i.agentsRoot === soul.agentsRoot && moduleRow(i, row.name));
    const behind = carrying.filter(i => moduleRow(i, row.name)?.status === 'moved').length;
    const line = typeof openSoul === 'function' ? node('button', undefined, 'page-table-row used-row') : node('div', undefined, 'page-table-row used-row');
    line.setAttribute('role', 'row');
    if (line.tagName === 'BUTTON') { line.type = 'button'; line.addEventListener('click', () => openSoul(soul)); line.title = `Open ${soul.name}`; }
    const who = node('span', undefined, 'used-soul'); who.setAttribute('role', 'cell'); who.append(createSoulMark(doc, soul), node('span', soul.name, 'used-name'));
    const meta = node('span', `${carrying.length}${behind ? ` · ${behind} on an older version` : ''}`, `used-meta${behind ? ' warn' : ''}`); meta.setAttribute('role', 'cell');
    line.append(who, meta); table.append(line);
  }
  used.append(table); main.append(used);
  // Comes from: what workspace status and the catalog report about its source.
  const names = memberNames(status), source = capabilitySource(row, names);
  const pkg = row.kind === 'package' ? list(status?.packages).find(p => p.id === row.package) : null;
  const origin = pageCard(doc, 'Comes from', { icon: row.kind === 'package' ? 'package' : 'repo' });
  origin.card.append(pageFacts(doc, row.kind === 'package' ? [
    ['Package', row.package], ['Pinned', [row.version, packageOrigin(pkg?.source)].filter(Boolean).join(' · ')],
    ['Commit', short(row.commit), row.commit], ['Fingerprint', fingerprint(pkg?.integrity || row.resolved?.from?.integrity), pkg?.integrity || row.resolved?.from?.integrity],
  ] : [
    ['Repository', source.label, row.repoKey], ['Latest', short(row.commit), row.commit], ['Path', row.path],
    ...(row.private === true ? [['Owned', 'this repo\'s souls only']] : []),
  ]));
  side.append(origin.card);
  // As the soul it was opened from resolves it (inspect): version, requirements, settings.
  if (from && resolved) {
    const missing = list(resolved.missingRequires);
    const as = pageCard(doc, `As ${from.label} resolves it`);
    as.card.append(pageFacts(doc, [['Version', text(resolved.version)], ['Missing', missing.length ? missing.join(', ') : 'None']]));
    if (resolved.settings && typeof resolved.settings === 'object' && Object.keys(resolved.settings).length) {
      const d = node('details'); d.append(node('summary', 'Settings'), node('pre', JSON.stringify(resolved.settings, null, 2))); as.card.append(d);
    }
    side.append(as.card);
  }
  body.append(main, side); page.append(bar, body);
  host.append(page);
  return page;
}
/** sha256-<64 hex> → sha256:9f2c…a71e (the full value stays in the title). */
export function fingerprint(integrity) {
  const m = /^sha256-([0-9a-f]{64})$/i.exec(integrity || '');
  return m ? `sha256:${m[1].slice(0, 4)}…${m[1].slice(-4)}` : text(integrity);
}

function moduleRow(instance, name) {
  const rows = Array.isArray(instance.modules) ? instance.modules : Object.entries(instance.modules || {}).map(([key, row]) => ({ name: key, ...row }));
  return rows.find(m => m?.name === name) || null;
}

const WHY = { default: ['default', 'Not declared by this soul: a workspace or team default (the kernel does not say which)'],
  soul: ['soul', 'Declared by this soul'] };
/** A soul's composition: entries { cap, why: default|soul, repoOwned } or { name, why: 'off' }. */
export function renderSoulCapabilities(host, { entries, status, onOpen = null }) {
  const doc = host.ownerDocument, names = memberNames(status);
  const node = (tag, value, cls) => el(doc, tag, value, cls);
  host.replaceChildren();
  const table = node('div', undefined, 'page-table soul-caps'); table.setAttribute('role', 'table'); table.setAttribute('aria-label', 'Capabilities');
  const head = node('div', undefined, 'page-table-row head soul-cap-row'); head.setAttribute('role', 'row');
  for (const label of ['Capability', 'Source', "Why it's here"]) { const cell = node('span', label); cell.setAttribute('role', 'columnheader'); head.append(cell); }
  table.append(head);
  if (!list(entries).length) table.append(node('p', 'No other capabilities: only the core ones.', 'page-note'));
  for (const entry of list(entries)) {
    const off = entry.why === 'off', row = off ? null : { ...capabilityRow(entry.cap), ...(entry.repoOwned ? { private: true } : {}) };
    const name = off ? entry.name : row.name;
    const line = node('div', undefined, `page-table-row soul-cap-row${off ? ' off' : ''}`); line.setAttribute('role', 'row'); line.dataset.capability = name;
    const cap = node('span', undefined, 'soul-cap-name'); cap.setAttribute('role', 'cell');
    const id = node('span', name, 'soul-cap-id'); id.title = name; cap.append(id);
    if (entry.repoOwned) cap.append(node('span', "repo-owned · this soul's repo", 'soul-cap-note'));
    const source = node('span', undefined, 'soul-cap-source'); source.setAttribute('role', 'cell'); source.style.minWidth = '0';
    if (row) source.append(sourceChip(doc, row, names, { boxed: true }));
    const why = node('span', undefined, 'soul-cap-why'); why.setAttribute('role', 'cell');
    if (off) why.append(node('span', 'turned off by soul', 'why-note'));
    else { const [label, title] = WHY[entry.why]; const tag = node('span', label, `why-tag${entry.why === 'soul' ? ' soul' : ''}`); tag.title = title; why.append(tag); }
    line.append(cap, source, why);
    if (!off && typeof onOpen === 'function') {
      line.classList.add('openable'); line.tabIndex = 0; line.setAttribute('aria-label', `${name}: open its page`);
      line.addEventListener('click', () => onOpen(row));
      line.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(row); } });
    }
    table.append(line);
  }
  host.append(table);
}
