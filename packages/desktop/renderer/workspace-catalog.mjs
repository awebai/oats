/** Workspace model v2 catalog views: the Capabilities sections (design frame 04
 * table) and the Setup tab (graph + lists). Pure DOM from kernel JSON — `oats capabilities`,
 * `oats workspace status` and the roster's module rows. Nothing is resolved,
 * joined across the non-collapse boundary, or inferred: a member's
 * `publishes` stays informational, package capabilities stay package rows. */
import { createCapabilityMark, createSoulMark } from './identity-marks.mjs';
import { iconElement } from './shell-icons.mjs';

export const catalogCSS = `
/* Workspace v4 (W5): jump pills, section titles with a lead, dropdown filters inside
   Workspace owned, and a Capability | Source | Used by table. */
.capability-nav { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin:0 0 22px; }
.oats-view .capability-nav button { display:inline-flex; align-items:center; gap:7px; height:28px; min-height:28px; padding:0 12px; border:0; border-radius:999px; background:var(--surface); color:var(--fg); font:600 12px var(--sans,system-ui); white-space:nowrap; cursor:pointer; }
.oats-view .capability-nav button:hover { background:var(--surface-2); }
.oats-view .capability-nav button[aria-current=true] { background:var(--primary-bg); color:var(--primary-fg); }
.capability-nav-count { font:10.5px var(--mono,monospace); }
.catalog-filters { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin:0; padding:0 2px; }
.catalog-filters-label { margin-right:2px; color:var(--muted); font-size:12px; }
.catalog-select { position:relative; display:inline-flex; align-items:center; gap:6px; flex:none; height:28px; padding:0 0 0 10px; border:1px solid var(--border); border-radius:7px; background:var(--surface); font-size:12px; white-space:nowrap; box-sizing:border-box; }
.catalog-select.active { border-color:var(--sel-border); background:var(--sel); }
.catalog-select-key { color:var(--muted); }
.catalog-select.active .catalog-select-key, .catalog-select.active .shell-icon { color:var(--accent); }
/* The native select is the visible value (no platform chrome); the chevron sits over its right padding. */
.oats-view .catalog-select select { appearance:none; -webkit-appearance:none; height:26px; min-height:0; margin:0; padding:0 26px 0 0; border:0; background:transparent; color:var(--fg); font:600 12px var(--sans,system-ui); cursor:pointer; }
.oats-view .catalog-select.active select { font:650 12px var(--mono,monospace); }
.oats-view .catalog-select select:focus { outline:none; }
.catalog-select .shell-icon { position:absolute; right:8px; color:var(--muted); pointer-events:none; }
.catalog-select:focus-within { outline:2px solid var(--accent); outline-offset:1px; }
.catalog-shown { margin-left:4px; color:var(--muted); font-size:12px; white-space:nowrap; }
.oats-view button.catalog-clear { min-height:0; height:auto; padding:0; border:0; background:none; color:var(--accent); font:600 12px var(--sans,system-ui); cursor:pointer; }
.oats-view button.catalog-clear:hover { text-decoration:underline; }
.catalog-table { border:1px solid var(--border); border-radius:10px; background:var(--surface); overflow:hidden; font-size:12px; }
.catalog-row { display:grid; grid-template-columns:minmax(0,1.7fr) minmax(0,1fr) 150px; align-items:center; gap:16px; min-height:48px; padding:0 16px; box-sizing:border-box; border-top:1px solid var(--tag-bg); }
.catalog-row.head { min-height:32px; border-top:0; border-bottom:1px solid var(--border); color:var(--muted); font-size:11.5px; font-weight:550; }
.catalog-row.head + .catalog-row, .catalog-group + .catalog-row { border-top:0; }
.catalog-row.head > :last-child, .catalog-used { justify-self:end; }
.catalog-row.head > :last-child { width:94px; }
.catalog-cap { display:flex; align-items:center; gap:10px; min-width:0; }
.catalog-name { color:var(--fg); font:600 13px var(--mono,monospace); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
.catalog-core { display:inline-flex; align-items:center; flex:none; height:18px; padding:0 6px; border-radius:4px; background:var(--chip-bg); color:var(--fg); font-size:10.5px; font-weight:650; white-space:nowrap; }
.catalog-group { display:flex; align-items:center; gap:7px; min-height:32px; padding:0 16px; border-top:1px solid var(--tag-bg); color:var(--muted); font:600 11.5px var(--mono,monospace); }
.catalog-group:first-of-type { border-top:0; }
.source-chip { display:inline-flex; align-items:center; gap:7px; min-width:0; color:var(--muted); font:12px var(--mono,monospace); }
.source-chip .shell-icon { flex:none; }
.source-chip-name { color:var(--fg); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
.source-chip-version { white-space:nowrap; }
.source-chip.boxed { height:24px; padding:0 8px; border:1px solid var(--border); border-radius:6px; background:var(--surface); font-size:11.5px; box-sizing:border-box; }
.source-note { color:var(--warn); font:600 11px var(--sans,system-ui); white-space:nowrap; }
.catalog-used { display:flex; align-items:center; gap:8px; }
.catalog-used-marks { display:flex; padding-left:5px; }
.catalog-used-marks .identity-mark { width:20px; height:20px; margin-left:-5px; border-radius:6px; border:1.5px solid var(--surface); font-size:9.5px; font-weight:700; box-sizing:border-box; }
.catalog-used-count { width:48px; color:var(--muted); font-size:12px; white-space:nowrap; }
.catalog-row.openable { cursor:pointer; }
.catalog-row.openable:hover { background:var(--surface-2); }
.catalog-row.openable:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }
.catalog-empty { margin:0; padding:24px 16px; color:var(--muted); line-height:1.5; }
.catalog-notes { display:grid; gap:4px; margin:0 0 14px; }
.catalog-notes:empty { display:none; }
.catalog-note { margin:0; color:var(--muted); font-size:12px; line-height:1.5; overflow-wrap:anywhere; }
.catalog-note.warn { color:var(--warn); }
.catalog-chips { display:flex; flex-wrap:wrap; gap:3px; min-width:0; }
.catalog-chip { display:inline-flex; align-items:center; gap:3px; min-height:22px; padding:0 7px; border-radius:5px; background:var(--surface-2); color:var(--muted); font-size:10.5px; font-weight:650; line-height:1.45; white-space:nowrap; }
.catalog-chip.ok { color:var(--ok); }
.catalog-chip.warn { color:var(--warn); }
.catalog-chip .shell-icon { width:11px; height:11px; }
.catalog-chip.mono { font:500 10.5px var(--mono,monospace); }
.capability-section { display:flex; flex-direction:column; gap:10px; }
.capability-section + .capability-section { margin-top:22px; }
.capability-section-title { display:flex; align-items:baseline; gap:10px; margin:0; padding:0 2px; color:var(--fg); font-size:14px; font-weight:700; }
.capability-section-title:focus { outline:none; }
.capability-section-lead { color:var(--muted); font-size:12px; font-weight:400; }
.capability-none { margin:0; }
.sources-section + .sources-section { margin-top:var(--section-gap); }
.setup-graph { display:grid; grid-template-columns:minmax(180px,230px) 32px minmax(200px,260px) 32px minmax(260px,1fr); align-items:center; margin:0 0 var(--section-gap); }
.setup-card { display:flex; flex-direction:column; gap:6px; min-width:0; padding:12px 14px; border:1px solid var(--border); border-radius:10px; background:var(--surface); box-sizing:border-box; }
.setup-caption { color:var(--muted); font-size:10.5px; font-weight:650; letter-spacing:.06em; text-transform:uppercase; }
.setup-title { display:flex; align-items:center; gap:8px; min-width:0; }
.setup-title .shell-icon, .setup-node-icon { flex:none; color:var(--muted); }
.setup-name { color:var(--fg); font-size:13px; font-weight:650; overflow-wrap:anywhere; }
.setup-meta { color:var(--muted); font-size:11.5px; line-height:1.5; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.setup-meta.mono { font:11px/1.5 var(--mono,monospace); }
.setup-link { position:relative; height:0; border-top:1px solid var(--muted); }
.setup-link::after { content:''; position:absolute; right:0; top:-4px; width:6px; height:6px; border-top:1px solid var(--muted); border-right:1px solid var(--muted); transform:rotate(45deg); }
.setup-branch { display:flex; flex-direction:column; min-width:0; margin:0; padding:0; list-style:none; }
.setup-leaf { --above:6px; position:relative; margin-top:var(--above); padding-left:22px; }
.setup-leaf.group-start { --above:16px; }
.setup-leaf:first-child { margin-top:0; }
.setup-leaf::before { content:''; position:absolute; left:0; top:50%; width:22px; border-top:1px solid var(--muted); }
.setup-leaf::after { content:''; position:absolute; left:0; top:calc(-1 * var(--above)); bottom:0; border-left:1px solid var(--muted); }
.setup-leaf:first-child::after { top:50%; }
.setup-leaf:last-child::after { bottom:50%; }
.setup-leaf:only-child::after, .setup-none::before { display:none; }
.setup-none { color:var(--muted); font-size:12px; }
.setup-node { display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:center; gap:2px 10px; width:100%; min-height:48px; padding:7px 12px; border:1px solid var(--border); border-radius:8px; background:var(--surface); box-sizing:border-box; color:var(--fg); font:inherit; text-align:left; }
.setup-node .setup-node-icon { grid-row:span 2; }
button.setup-node { cursor:pointer; }
button.setup-node:hover { background:var(--surface-2); }
button.setup-node:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }
.setup-node-name { color:var(--fg); font-size:12.5px; font-weight:650; overflow-wrap:anywhere; }
.setup-node-sub, .setup-node-detail { grid-column:2 / -1; font-size:11px; line-height:1.45; }
.setup-node-sub { color:var(--muted); }
.setup-node-detail { color:var(--warn); overflow-wrap:anywhere; }
.sources-section h2 { margin:0 0 var(--title-gap); color:var(--muted); font-size:10.5px; font-weight:650; letter-spacing:.06em; text-transform:uppercase; }
.sources-row { display:grid; grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) minmax(0,1.1fr); align-items:center; gap:12px; min-height:52px; padding:8px 16px; box-sizing:border-box; border-top:1px solid var(--border); }
.sources-row:first-child { border-top:0; }
.sources-key { color:var(--muted); font:11px/1.5 var(--mono,monospace); overflow-wrap:anywhere; }
.sources-detail { grid-column:1/-1; margin:0; color:var(--warn); font-size:11.5px; overflow-wrap:anywhere; }
@container(max-width:900px) {
 .setup-graph { grid-template-columns:minmax(0,1fr); align-items:stretch; }
 .setup-link { justify-self:start; width:0; height:18px; margin-left:22px; border-top:0; border-left:1px solid var(--muted); }
 .setup-link::after { top:auto; right:auto; bottom:0; left:-4px; transform:rotate(135deg); }
 .setup-branch { margin-left:22px; }
 .setup-leaf:first-child::after { top:0; }
}
@container(max-width:700px) {
 .catalog-row, .sources-row { grid-template-columns:minmax(0,1fr); gap:6px; }
 .catalog-row.head { display:none; }
}
`;

const list = value => Array.isArray(value) ? value : [];
const text = value => typeof value === 'string' && value ? value : null;
const short = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value) ? value.slice(0, 7) : value;
/** A member's handshake state in plain words (docs/workspaces.md): the chip
 * label, and why its souls are not available while it is not confirmed.
 * An unknown kernel status is shown verbatim, never guessed. */
const MEMBER_STATES = {
  confirmed: { label: 'confirmed', ok: true },
  'not-listed': { label: 'not listed', why: "isn't listed by the workspace" },
  'no-backlink': { label: 'no backlink', why: "hasn't joined the workspace" },
  'backlink-elsewhere': { label: 'points elsewhere', why: 'says it belongs to a different workspace' },
  'cannot-read': { label: "can't read", why: "can't be read with your access" },
};
export function memberState(member) {
  const status = text(member?.status) || 'unconfirmed';
  return { status, ok: false, why: 'is not confirmed', label: status, ...MEMBER_STATES[status] };
}
/** A member's display name from workspace status; the key's tail otherwise. */
export function memberNames(status) {
  const names = new Map();
  for (const member of list(status?.members)) if (text(member.key)) names.set(member.key, text(member.name) || member.key.split('/').pop());
  return names;
}
/** The source a capability row came from, in the kernel's own kind. */
export function capabilitySource(row, names = new Map()) {
  if (row.kind === 'package') return { kind: 'package', key: `package:${row.package}`, label: text(row.package) || row.name };
  if (row.kind === 'member') return { kind: 'member', key: `member:${row.repoKey}`, label: names.get(row.repoKey) || String(row.repoKey || '').split('/').pop() || 'member' };
  return { kind: 'external', key: `external:${row.repoKey || row.origin}`, label: String(row.repoKey || row.origin || 'external').split('/').pop() };
}
/** Souls whose instances carry this capability as a recorded module, from
 * the roster's own module rows; moved = the kernel reported drift. */
export function capabilityUse(instances, name) {
  const souls = new Map(); let moved = 0;
  for (const instance of list(instances)) {
    const rows = Array.isArray(instance.modules) ? instance.modules : Object.entries(instance.modules || {}).map(([key, row]) => ({ name: key, ...row }));
    const row = rows.find(module => module?.name === name);
    if (!row) continue;
    if (row.status === 'moved') moved++;
    const soul = text(instance.agent);
    if (soul && !souls.has(soul)) souls.set(soul, { name: soul, agentsRoot: instance.agentsRoot });
  }
  return { souls: [...souls.values()], moved };
}
export function filterCapabilities(rows, { team = null, repo = null } = {}, names = new Map()) {
  return list(rows).filter(row => (!team || row.team === team) && (!repo || capabilitySource(row, names).key === repo));
}

function node(doc, tag, value, cls) {
  const el = doc.createElement(tag);
  if (value !== undefined && value !== null) el.textContent = value;
  if (cls) el.className = cls;
  return el;
}
function chip(doc, label, tone = '', icon = null) {
  const el = node(doc, 'span', null, `catalog-chip${tone ? ` ${tone}` : ''}`);
  if (icon) el.append(iconElement(doc, icon, { size: 11 }));
  el.append(doc.createTextNode(label));
  return el;
}

/** Workspace owned filters: a Team and a Repo dropdown (single choice each, AND
 * across them), how many rows are shown, and Clear filters when one is set. */
export function renderFilters(host, { teams, repos, value, onChange, shown = null, total = null }) {
  const doc = host.ownerDocument;
  host.replaceChildren(); host.className = 'catalog-filters'; host.setAttribute('role', 'group'); host.setAttribute('aria-label', 'Filter workspace owned capabilities');
  host.append(node(doc, 'span', 'Filter by', 'catalog-filters-label'));
  const select = (label, key, options) => {
    const current = value[key] ?? null;
    const chosen = options.find(option => option !== 'sep' && option.value === current);
    const box = node(doc, 'label', null, `catalog-select${current ? ' active' : ''}`); box.dataset.filterKey = key;
    box.append(node(doc, 'span', label, 'catalog-select-key'));
    const el = node(doc, 'select'); el.setAttribute('aria-label', `${label} filter`); el.title = chosen?.title || '';
    let parent = el;
    for (const option of [{ label: 'All', value: null }, ...options]) {
      if (option === 'sep') { parent = node(doc, 'optgroup'); parent.label = 'External'; el.append(parent); continue; }
      const opt = node(doc, 'option', option.label); opt.value = option.value ?? ''; opt.selected = (option.value ?? null) === current;
      if (option.title) opt.title = option.title;
      parent.append(opt);
    }
    el.addEventListener('change', () => onChange({ ...value, [key]: el.value || null }));
    box.append(el, iconElement(doc, 'chevronDown', { size: 13 }));
    return box;
  };
  host.append(select('Team', 'team', teams.map(team => ({ label: team, value: team }))), select('Repo', 'repo', repos));
  if (value.team || value.repo) {
    if (shown !== null && total !== null) host.append(node(doc, 'span', `${shown} of ${total} shown`, 'catalog-shown'));
    const clear = node(doc, 'button', 'Clear filters', 'catalog-clear'); clear.type = 'button';
    clear.addEventListener('click', () => onChange({ team: null, repo: null }));
    host.append(clear);
  }
}

/** Team and source choices from the catalog rows themselves (members first,
 * then packages), so a pill never names something the table cannot show. */
/** Filter choices for the Workspace owned section: its rows' teams and the
 * repositories they come from (members, then external sources). */
export function filterChoices(rows, names = new Map()) {
  const owned = list(rows).filter(row => row.kind !== 'package');
  const teams = [...new Set(owned.map(row => text(row.team)).filter(Boolean))].sort();
  const byRepo = new Map();
  for (const row of owned) { const source = capabilitySource(row, names); if (!byRepo.has(source.key)) byRepo.set(source.key, source); }
  const all = [...byRepo.values()].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'member' ? -1 : 1) || a.label.localeCompare(b.label));
  const repos = [];
  all.forEach((source, index) => {
    if (index && source.kind !== all[index - 1].kind) repos.push('sep');
    repos.push({ label: source.label, value: source.key, title: `${source.kind === 'member' ? 'Repository' : 'External'}: ${source.label}` });
  });
  return { teams, repos };
}

/** The Capabilities view's three sections, from the catalog rows' own facts:
 * workspace owned (listed to every soul), packages, and repo owned (the
 * kernel's private: true, usable only by that repository's souls). */
export function capabilitySections(rows) {
  const all = list(rows);
  return {
    workspace: all.filter(row => row.kind !== 'package' && row.private !== true),
    packages: all.filter(row => row.kind === 'package'),
    repo: all.filter(row => row.kind !== 'package' && row.private === true),
  };
}

/** A capability as a soul/instance resolves it (`oats inspect` capabilities[])
 * in the catalog's row shape, so the one table renders both. Only reported
 * facts: no team (inspect does not report one), the origin from `from`. */
export function capabilityRow(cap) {
  const from = cap?.from && typeof cap.from === 'object' ? cap.from : {};
  const kind = ['package', 'member', 'external'].includes(from.kind) ? from.kind : 'external';
  return { name: cap.id, kind, ...(text(from.package) ? { package: from.package } : {}), ...(text(cap.version) ? { version: cap.version } : {}),
    ...(text(from.commit) ? { commit: from.commit } : {}), ...(text(from.repoKey) ? { repoKey: from.repoKey } : {}),
    origin: kind === 'package' ? `package ${from.package} v${from.version || cap.version || ''}`.trim() : `${kind} ${from.repoKey || ''}`.trim(),
    ...(cap.layer ? { layer: cap.layer } : {}), resolved: cap };
}
const LAYERS = { knowledge: 'Knowledge', messaging: 'Messaging', tasks: 'Tasks' };
/** A core capability's name in the UI (Knowledge, Messaging, Tasks), else the layer verbatim. */
export const layerLabel = layer => LAYERS[layer] || layer;

/** Where a capability comes from, as one chip: a package with its pinned
 * version, a member repository at its latest, or (repo owned) this soul's own
 * repository at its latest. `boxed` draws it as a bordered chip. */
export function sourceChip(doc, row, names = new Map(), { boxed = false } = {}) {
  const source = capabilitySource(row, names);
  const el = node(doc, 'span', null, `source-chip${boxed ? ' boxed' : ''}`); el.dataset.source = source.kind;
  const icon = row.kind === 'package' ? 'package' : row.private === true ? 'home' : 'repo';
  const name = row.kind === 'package' ? text(row.package) || source.label : source.label;
  const version = row.kind === 'package' ? text(row.version) : row.kind === 'member' ? 'latest' : null;
  el.append(iconElement(doc, icon, { size: 13 }), node(doc, 'span', name, 'source-chip-name'));
  if (version) el.append(node(doc, 'span', version, 'source-chip-version'));
  el.title = text(row.origin) || [name, version].filter(Boolean).join(' ');
  return el;
}

/** The capability table: Capability (name, core tag) | Source | Used by (the
 * souls whose instances carry it, from the roster's module rows).
 * groups: [{ label, rows }] adds a repository sub-heading per group (Repo owned).
 * onOpen(row): rows open the capability's page (click, Enter or Space). */
export function renderCapabilities(host, { rows, groups = null, status, instances, root, total = list(rows).length, onOpen = null, label = 'Workspace capabilities', empty = null }) {
  const doc = host.ownerDocument, names = memberNames(status);
  host.replaceChildren();
  const table = node(doc, 'div', null, 'catalog-table'); table.setAttribute('role', 'table'); table.setAttribute('aria-label', label);
  const head = node(doc, 'div', null, 'catalog-row head'); head.setAttribute('role', 'row');
  for (const label of ['Capability', 'Source', 'Used by']) { const cell = node(doc, 'span', label); cell.setAttribute('role', 'columnheader'); head.append(cell); }
  table.append(head);
  const line = row => {
    const el = node(doc, 'div', null, 'catalog-row'); el.setAttribute('role', 'row');
    el.dataset.capability = row.name;
    if (typeof onOpen === 'function') {
      el.classList.add('openable'); el.tabIndex = 0; el.setAttribute('aria-label', `${row.name}: open its page`);
      el.addEventListener('click', () => onOpen(row));
      el.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(row); } });
    }
    const cap = node(doc, 'span', null, 'catalog-cap'); cap.setAttribute('role', 'cell');
    const name = node(doc, 'span', row.name, 'catalog-name'); name.title = row.name;
    cap.append(name);
    if (text(row.layer)) cap.append(node(doc, 'span', layerLabel(row.layer), 'catalog-core'));
    const source = node(doc, 'span', null, 'catalog-source'); source.setAttribute('role', 'cell');
    source.style.minWidth = '0'; source.append(sourceChip(doc, row, names));
    const use = capabilityUse(instances, row.name);
    const used = node(doc, 'span', null, 'catalog-used'); used.setAttribute('role', 'cell');
    const marks = node(doc, 'span', null, 'catalog-used-marks'); marks.setAttribute('aria-hidden', 'true');
    for (const soul of use.souls.slice(0, 4)) marks.append(createSoulMark(doc, soul));
    const count = node(doc, 'span', use.souls.length ? String(use.souls.length) : '—', 'catalog-used-count');
    count.title = use.souls.length ? `Used by ${use.souls.map(soul => soul.name).join(', ')}` : 'No instance carries it yet';
    used.append(marks, count);
    el.append(cap, source, used);
    return el;
  };
  if (groups) for (const group of groups) {
    const title = node(doc, 'div', null, 'catalog-group'); title.setAttribute('role', 'row'); title.dataset.repo = group.key;
    const cell = node(doc, 'span', null); cell.setAttribute('role', 'rowheader'); cell.style.display = 'contents';
    cell.append(iconElement(doc, 'repo', { size: 13 }), node(doc, 'span', group.label));
    title.append(cell); table.append(title, ...group.rows.map(line));
  } else for (const row of list(rows)) table.append(line(row));
  if (!list(rows).length && !(groups && groups.length)) table.append(node(doc, 'p', total ? 'No capabilities match these filters.' : empty || 'The workspace reports no capabilities yet: members publish capabilities and packages lock theirs on sync.', 'catalog-empty'));
  host.append(table);
}

/** Observation notes in the kernel's own terms: an unreachable workspace
 * (module drift not current), withheld roster rows (F1 guard), lock state and
 * workspace problems. */
export function deploymentNotes(deployment) {
  const lines = [];
  const reach = deployment?.reachable;
  if (reach && reach.reachable === false) lines.push({ text: `Workspace unreachable — module drift is not current. ${[reach.code, reach.message].filter(text).join(': ')}`, warn: true });
  const withheld = list(deployment?.withheld);
  if (withheld.length) lines.push({ text: `${withheld.length} instance ${withheld.length === 1 ? 'row was' : 'rows were'} withheld: the kernel reported a home outside the soul's instances directory or a duplicate home (${withheld.map(w => w.instance).join(', ')}).`, warn: true });
  return [...lines, ...lockNotes(deployment?.workspaceStatus)];
}
/** Lock lines in the kernel's own terms (workspace status). */
export function lockNotes(status) {
  const lines = [];
  if (list(status?.unsynced).length) lines.push({ text: `Declared but not locked: ${status.unsynced.join(', ')}. Sync to lock them.`, warn: true });
  if (list(status?.stale).length) lines.push({ text: `Locked but no longer declared: ${status.stale.join(', ')}. Sync to drop them.`, warn: true });
  for (const problem of list(status?.problems)) lines.push({ text: [problem.code, problem.message].filter(text).join(': '), warn: true });
  return lines;
}

/** The Capabilities tab: jump pills, then Workspace owned (with its team/repo
 * filters), Packages and, when the kernel lists them (feature
 * capabilities-private), Repo owned grouped by repository. `filterHost` is the
 * discovery's persistent filter row; `query` narrows every section by name. */
export function renderCapabilitySections(host, { sections, shown, filterHost, privateListed, status, instances, root, onOpen = null, query = '' }) {
  const doc = host.ownerDocument, names = memberNames(status);
  host.replaceChildren();
  const needle = String(query || '').trim().toLowerCase();
  const match = rows => needle ? rows.filter(row => String(row.name).toLowerCase().includes(needle)) : rows;
  const table = (parent, rows, opts) => { const box = node(doc, 'div'); parent.append(box); renderCapabilities(box, { rows, status, instances, root, onOpen, ...opts }); };
  // Nothing at all: one factual line, not three empty sections.
  if (!sections.workspace.length && !sections.packages.length && !sections.repo.length) { table(host, [], {}); return; }
  const defs = [
    { id: 'workspace', title: 'Workspace owned', lead: 'latest from member repos', count: sections.workspace.length },
    { id: 'packages', title: 'Packages', lead: 'pinned versions, same everywhere', count: sections.packages.length },
    ...(privateListed ? [{ id: 'repo', title: 'Repo owned', lead: 'only for souls of the same repo', count: sections.repo.length }] : []),
  ];
  const nav = node(doc, 'nav', null, 'capability-nav'); nav.setAttribute('aria-label', 'Capability sections');
  for (const def of defs) {
    const jump = node(doc, 'button', null); jump.type = 'button'; jump.dataset.jump = def.id;
    jump.append(node(doc, 'span', def.title), node(doc, 'span', String(def.count), 'capability-nav-count'));
    jump.setAttribute('aria-current', String(def.id === defs[0].id));
    jump.addEventListener('click', () => {
      const head = host.querySelector(`#capability-section-${def.id}`);
      for (const other of nav.querySelectorAll('button')) other.setAttribute('aria-current', String(other === jump));
      head?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }); head?.focus({ preventScroll: true });
    });
    nav.append(jump);
  }
  host.append(nav);
  const section = def => {
    const el = node(doc, 'section', null, 'capability-section'); el.dataset.section = def.id;
    const head = node(doc, 'h2', null, 'capability-section-title'); head.id = `capability-section-${def.id}`; head.tabIndex = -1;
    head.append(node(doc, 'span', def.title), node(doc, 'span', def.lead, 'capability-section-lead'));
    el.setAttribute('aria-labelledby', head.id); el.append(head); host.append(el); return el;
  };
  const owned = section(defs[0]);
  if (filterHost) owned.append(filterHost);
  table(owned, match(shown), { total: sections.workspace.length, label: 'Workspace owned capabilities', empty: 'No workspace repository offers a capability yet.' });
  table(section(defs[1]), match(sections.packages), { label: 'Package capabilities', empty: 'No package capability is locked yet. Sync to lock the declared packages.' });
  if (!privateListed) return;
  const repo = section(defs[2]);
  if (!sections.repo.length) { repo.append(node(doc, 'p', 'No repository keeps a private capability.', 'catalog-empty capability-none')); return; }
  const byRepo = new Map();
  for (const row of match(sections.repo)) { const source = capabilitySource(row, names); if (!byRepo.has(source.key)) byRepo.set(source.key, { key: source.key, label: source.label, rows: [] }); byRepo.get(source.key).rows.push(row); }
  const groups = [...byRepo.values()].sort((a, b) => a.label.localeCompare(b.label));
  table(repo, groups.flatMap(g => g.rows), { groups, label: 'Repo owned capabilities', total: sections.repo.length });
}

/** The jump pill for the section at the top of the scroller (called on scroll). */
export function syncCapabilityNav(host, scroller) {
  const nav = host.querySelector('.capability-nav'); if (!nav || !scroller?.getBoundingClientRect) return;
  const top = scroller.getBoundingClientRect().top + 24;
  let current = null;
  for (const el of host.querySelectorAll('.capability-section')) if (el.getBoundingClientRect().top <= top) current = el.dataset.section;
  current ||= host.querySelector('.capability-section')?.dataset.section;
  for (const jump of nav.querySelectorAll('button')) jump.setAttribute('aria-current', String(jump.dataset.jump === current));
}

const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const tail = value => String(value || '').replace(/\/+$/, '').split('/').pop().replace(/\.git$/, '');
/** The Setup overview: this computer → the workspace → what it is built from
 * (repositories, packages, external souls). Kernel facts only, no commits;
 * anything that lives in a git repository carries the repository icon. */
export function renderSetupGraph(host, { status, instances = [], onOpenRepo = null, onOpenPackages = null }) {
  const doc = host.ownerDocument;
  const ws = status?.workspace || {};
  const graph = node(doc, 'figure', null, 'setup-graph'); graph.setAttribute('aria-label', 'How this deployment is set up');
  const card = (caption, icon, name, cls) => {
    const el = node(doc, 'div', null, `setup-card ${cls}`);
    const title = node(doc, 'div', null, 'setup-title'); title.append(iconElement(doc, icon, { size: 16 }), node(doc, 'span', name, 'setup-name'));
    el.append(node(doc, 'span', caption, 'setup-caption'), title); return el;
  };
  const link = () => { const el = node(doc, 'div', null, 'setup-link'); el.setAttribute('aria-hidden', 'true'); return el; };
  // This computer: the deployment folder (where oats-local.yaml lives) and its instances.
  const deployment = text(ws.local) ? ws.local.replace(/\/oats-local\.yaml$/, '') : null;
  const computer = card('This computer', 'computer', deployment ? tail(deployment) : 'This deployment', 'setup-computer');
  if (deployment) { const path = node(doc, 'span', deployment, 'setup-meta mono'); path.title = deployment; computer.append(path); }
  const all = list(instances), running = all.filter(i => i?.running === true).length;
  computer.append(node(doc, 'span', all.length ? `${count(all.length, 'instance')} · ${running} running` : 'No instances yet', 'setup-meta'));
  // The workspace: its host repository and its teams.
  const names = memberNames(status);
  const workspace = card('Workspace', 'repo', text(ws.name) || 'Workspace', 'setup-workspace');
  if (text(ws.key)) { const host = node(doc, 'span', `Defined in ${names.get(ws.key) || tail(ws.url || ws.key)}`, 'setup-meta'); host.title = ws.key; workspace.append(host); }
  if (list(ws.teams).length) { const teams = node(doc, 'div', null, 'catalog-chips'); for (const team of ws.teams) teams.append(chip(doc, team)); workspace.append(teams); }
  // What it is built from.
  const branch = node(doc, 'ul', null, 'setup-branch'); branch.setAttribute('aria-label', 'What the workspace is built from');
  const leaf = (el, groupStart) => { const li = node(doc, 'li', null, `setup-leaf${groupStart ? ' group-start' : ''}`); li.append(el); branch.append(li); };
  const item = (icon, name, sub, state, open) => {
    const el = node(doc, open ? 'button' : 'div', null, 'setup-node');
    if (open) { el.type = 'button'; el.addEventListener('click', open.run); el.setAttribute('aria-label', `${name}: ${open.label}`); }
    const mark = iconElement(doc, icon, { size: 16 }); mark.classList.add('setup-node-icon');
    el.append(mark, node(doc, 'span', name, 'setup-node-name'));
    const states = node(doc, 'span', null, 'catalog-chips setup-node-state'); if (state) states.append(state); el.append(states);
    el.append(node(doc, 'span', sub, 'setup-node-sub'));
    return el;
  };
  list(status?.members).forEach((member, index) => {
    const caps = list(member.capabilities).length;
    const state = member.status === 'confirmed' ? chip(doc, 'confirmed', 'ok', 'check') : chip(doc, text(member.status) || 'unconfirmed', 'warn', 'warning');
    const sub = ['Repository', text(member.team), count(list(member.souls).length, 'soul'), count(caps, 'capability', 'capabilities')].filter(Boolean).join(' · ');
    const el = item('repo', text(member.name) || tail(member.key), sub, state,
      caps && onOpenRepo ? { label: 'show its capabilities', run: () => onOpenRepo(member.key) } : null);
    el.dataset.member = member.key;
    if (text(member.detail)) el.append(node(doc, 'span', member.detail, 'setup-node-detail'));
    leaf(el, index === 0);
  });
  const packages = [...list(status?.packages).map(pkg => ({ pkg })), ...list(status?.unsynced).map(id => ({ unsynced: id }))];
  packages.forEach(({ pkg, unsynced }, index) => {
    const el = pkg
      ? item('package', `${pkg.id}${pkg.version ? ` v${pkg.version}` : ''}`, ['Package', count(list(pkg.capabilities).length, 'capability', 'capabilities')].join(' · '), chip(doc, 'locked', 'ok', 'check'),
        onOpenPackages ? { label: 'show package capabilities', run: () => onOpenPackages() } : null)
      : item('package', unsynced, 'Package · declared', chip(doc, 'not locked', 'warn', 'warning'), null);
    el.dataset.package = pkg ? pkg.id : unsynced;
    leaf(el, index === 0);
  });
  list(status?.external).forEach((row, index) => {
    const repo = tail(String(row.source || '').replace(/@[^@/]*$/, ''));
    leaf(item('repo', text(row.soul) || 'soul', ['External soul', repo, text(row.team)].filter(Boolean).join(' · '), null, null), index === 0);
  });
  if (!branch.children.length) branch.append(node(doc, 'li', 'No repositories or packages reported yet.', 'setup-leaf setup-none'));
  graph.append(computer, link(), workspace, link(), branch);
  host.append(graph);
}

export function renderSources(host, { status, instances = [], onOpenRepo = null, onOpenPackages = null }) {
  const doc = host.ownerDocument;
  host.replaceChildren();
  renderSetupGraph(host, { status, instances, onOpenRepo, onOpenPackages });
  const section = (title, rows, empty) => {
    const el = node(doc, 'section', null, 'sources-section');
    el.append(node(doc, 'h2', title));
    const table = node(doc, 'div', null, 'catalog-table');
    if (rows.length) table.append(...rows); else table.append(node(doc, 'p', empty, 'catalog-empty'));
    el.append(table); return el;
  };
  const repos = list(status?.members).map(member => {
    const row = node(doc, 'div', null, 'sources-row'); row.dataset.member = member.key;
    const who = node(doc, 'div', null, 'catalog-copy');
    who.append(node(doc, 'span', text(member.name) || member.key, 'catalog-name'), node(doc, 'span', member.key, 'sources-key'));
    const facts = node(doc, 'div', null, 'catalog-chips');
    facts.append(member.status === 'confirmed' ? chip(doc, 'confirmed', 'ok', 'check') : chip(doc, text(member.status) || 'unconfirmed', 'warn', 'warning'));
    if (text(member.team)) facts.append(chip(doc, member.team));
    const offers = node(doc, 'div', null, 'catalog-chips');
    offers.append(chip(doc, `${list(member.souls).length} soul${list(member.souls).length === 1 ? '' : 's'}`), chip(doc, `${list(member.capabilities).length} capabilit${list(member.capabilities).length === 1 ? 'y' : 'ies'}`));
    if (member.publishes?.package) offers.append(chip(doc, `publishes ${member.publishes.package}${member.publishes.version ? ` v${member.publishes.version}` : ''}`));
    row.append(who, facts, offers);
    if (text(member.detail)) row.append(node(doc, 'p', member.detail, 'sources-detail'));
    return row;
  });
  const packages = list(status?.packages).map(pkg => {
    const row = node(doc, 'div', null, 'sources-row'); row.dataset.package = pkg.id;
    const who = node(doc, 'div', null, 'catalog-copy');
    who.append(node(doc, 'span', `${pkg.id}${pkg.version ? ` v${pkg.version}` : ''}`, 'catalog-name'), node(doc, 'span', pkg.source, 'sources-key'));
    const facts = node(doc, 'div', null, 'catalog-chips');
    facts.append(chip(doc, 'locked', 'ok', 'check'));
    const offers = node(doc, 'div', null, 'catalog-chips');
    for (const cap of list(pkg.capabilities)) offers.append(chip(doc, cap));
    row.append(who, facts, offers);
    return row;
  });
  const external = list(status?.external).map(item => {
    const row = node(doc, 'div', null, 'sources-row');
    const who = node(doc, 'div', null, 'catalog-copy');
    who.append(node(doc, 'span', text(item.soul) || 'soul', 'catalog-name'), node(doc, 'span', text(item.source) || '', 'sources-key'));
    const facts = node(doc, 'div', null, 'catalog-chips'); facts.append(chip(doc, 'external soul'));
    if (text(item.team)) facts.append(chip(doc, item.team));
    row.append(who, facts, node(doc, 'div'));
    return row;
  });
  host.append(section('Repositories', repos, 'No member repositories reported.'),
    section('Packages', packages, list(status?.unsynced).length ? 'No package is locked yet. Sync to lock the declared packages.' : 'No packages declared.'));
  if (external.length) host.append(section('External souls', external, ''));
}
