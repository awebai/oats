/** Workspace model v2 catalog views: the Capabilities table (design frame 04)
 * and the Sources list. Pure DOM from kernel JSON — `oats capabilities`,
 * `oats workspace status` and the roster's module rows. Nothing is resolved,
 * joined across the non-collapse boundary, or inferred: a member's
 * `publishes` stays informational, package capabilities stay package rows. */
import { createCapabilityMark, createSoulMark } from './identity-marks.mjs';
import { iconElement } from './shell-icons.mjs';

export const catalogCSS = `
.catalog-filters { display:flex; flex-wrap:wrap; align-items:center; gap:8px 18px; margin:0 0 14px; }
.catalog-filter { display:flex; flex-wrap:wrap; align-items:center; gap:4px; min-width:0; }
.catalog-filter-label { margin-right:4px; color:var(--muted); font-size:10.5px; font-weight:650; letter-spacing:.06em; text-transform:uppercase; }
.catalog-pill { min-height:26px; padding:0 10px; border:1px solid var(--border); border-radius:999px; background:var(--surface); color:var(--fg); font:500 12px var(--sans,system-ui); cursor:pointer; white-space:nowrap; }
.catalog-pill:hover { background:var(--surface-2); }
.catalog-pill[aria-pressed=true] { border-color:var(--accent); background:var(--sel); color:var(--fg); font-weight:650; }
.catalog-pill:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }
.catalog-pill-sep { width:1px; height:16px; margin:0 4px; background:var(--border); }
.oats-view .catalog-refresh { display:inline-grid; place-items:center; width:28px; height:28px; min-height:28px; margin-left:auto; padding:0; border-radius:7px; }
.catalog-table { border:1px solid var(--border); border-radius:10px; background:var(--surface); overflow:hidden; font-size:12px; }
.catalog-row { display:grid; grid-template-columns:minmax(0,1.6fr) minmax(0,1fr) minmax(0,1fr); align-items:center; gap:12px; min-height:56px; padding:8px 16px; box-sizing:border-box; border-top:1px solid var(--border); }
.catalog-row.head { min-height:36px; padding:0 16px; border-top:0; background:var(--surface-2); color:var(--muted); font-size:10.5px; font-weight:650; letter-spacing:.06em; text-transform:uppercase; }
.catalog-cap { display:flex; align-items:center; gap:10px; min-width:0; }
.catalog-cap .identity-mark { width:32px; height:32px; border-radius:8px; font-size:14px; flex:none; }
.catalog-copy { display:flex; flex-direction:column; gap:1px; min-width:0; }
.catalog-name { font-size:12.5px; font-weight:650; line-height:18px; overflow-wrap:anywhere; }
.catalog-sub { color:var(--muted); font-size:11px; line-height:16px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.catalog-chips { display:flex; flex-wrap:wrap; gap:3px; min-width:0; }
.catalog-chip { display:inline-flex; align-items:center; gap:3px; min-height:22px; padding:0 7px; border-radius:5px; background:var(--surface-2); color:var(--muted); font-size:10.5px; font-weight:650; line-height:1.45; white-space:nowrap; }
.catalog-chip.ok { color:var(--ok); }
.catalog-chip.warn { color:var(--warn); }
.catalog-chip .shell-icon { width:11px; height:11px; }
.catalog-chip.mono { font:500 10.5px var(--mono,monospace); }
.catalog-used { display:flex; align-items:center; gap:4px; min-width:0; color:var(--muted); font-size:11.5px; }
.catalog-used-marks { display:flex; }
.catalog-used-marks .identity-mark { width:20px; height:20px; margin-right:-4px; border-radius:50%; font-size:9.5px; box-shadow:0 0 0 1.5px var(--surface); }
.catalog-used-count { margin-left:8px; }
.catalog-empty { padding:24px 16px; color:var(--muted); line-height:1.5; }
.catalog-notes { display:grid; gap:4px; margin:0 0 14px; }
.catalog-note { margin:0; color:var(--muted); font-size:12px; line-height:1.5; overflow-wrap:anywhere; }
.catalog-note.warn { color:var(--warn); }
.sources-section + .sources-section { margin-top:20px; }
.sources-section h2 { margin:0 0 8px; color:var(--muted); font-size:10.5px; font-weight:650; letter-spacing:.06em; text-transform:uppercase; }
.sources-row { display:grid; grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) minmax(0,1.1fr); align-items:center; gap:12px; min-height:52px; padding:8px 16px; box-sizing:border-box; border-top:1px solid var(--border); }
.sources-row:first-child { border-top:0; }
.sources-key { color:var(--muted); font:11px/1.5 var(--mono,monospace); overflow-wrap:anywhere; }
.sources-detail { grid-column:1/-1; margin:0; color:var(--warn); font-size:11.5px; overflow-wrap:anywhere; }
@container(max-width:700px) {
 .catalog-row, .sources-row { grid-template-columns:minmax(0,1fr); gap:6px; }
 .catalog-row.head { display:none; }
}
`;

const list = value => Array.isArray(value) ? value : [];
const text = value => typeof value === 'string' && value ? value : null;
const short = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value) ? value.slice(0, 7) : value;
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
export function filterCapabilities(rows, { team = null, source = null } = {}, names = new Map()) {
  return list(rows).filter(row => (!team || row.team === team) && (!source || capabilitySource(row, names).key === source));
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

/** Pill filters: single choice per group, AND across groups. */
export function renderFilters(host, { teams, sources, value, onChange, onRefresh, refreshing = false }) {
  const doc = host.ownerDocument;
  host.replaceChildren(); host.className = 'catalog-filters';
  const group = (label, key, options) => {
    const el = node(doc, 'div', null, 'catalog-filter'); el.setAttribute('role', 'group'); el.setAttribute('aria-label', `Filter by ${label.toLowerCase()}`);
    el.append(node(doc, 'span', label, 'catalog-filter-label'));
    const pill = (option) => {
      if (option === 'sep') { const sep = node(doc, 'span', null, 'catalog-pill-sep'); sep.setAttribute('aria-hidden', 'true'); return sep; }
      const button = node(doc, 'button', option.label, 'catalog-pill'); button.type = 'button';
      button.setAttribute('aria-pressed', String((value[key] ?? null) === option.value));
      button.dataset.filterKey = key; button.dataset.filterValue = option.value ?? '';
      if (option.title) button.title = option.title;
      button.addEventListener('click', () => onChange({ ...value, [key]: option.value }));
      return button;
    };
    el.append(...options.map(pill));
    return el;
  };
  host.append(group('Team', 'team', [{ label: 'All', value: null }, ...teams.map(team => ({ label: team, value: team }))]));
  host.append(group('Source', 'source', [{ label: 'All', value: null }, ...sources]));
  if (onRefresh) {
    const refresh = node(doc, 'button', null, 'act catalog-refresh'); refresh.type = 'button'; refresh.disabled = refreshing;
    refresh.append(iconElement(doc, 'refresh', { size: 14 }));
    refresh.setAttribute('aria-label', refreshing ? 'Reading the workspace capabilities…' : 'Read the workspace capabilities again');
    refresh.title = 'Read the workspace capabilities again (oats capabilities)';
    refresh.addEventListener('click', onRefresh);
    host.append(refresh);
  }
}

/** Team and source choices from the catalog rows themselves (members first,
 * then packages), so a pill never names something the table cannot show. */
export function filterChoices(rows, names = new Map()) {
  const teams = [...new Set(list(rows).map(row => text(row.team)).filter(Boolean))].sort();
  const bySource = new Map();
  for (const row of list(rows)) { const source = capabilitySource(row, names); if (!bySource.has(source.key)) bySource.set(source.key, source); }
  const order = { member: 0, external: 1, package: 2 };
  const all = [...bySource.values()].sort((a, b) => order[a.kind] - order[b.kind] || a.label.localeCompare(b.label));
  const sources = [];
  all.forEach((source, index) => {
    if (index && source.kind !== all[index - 1].kind) sources.push('sep');
    sources.push({ label: source.label, value: source.key, title: `${source.kind === 'package' ? 'Package' : source.kind === 'member' ? 'Repository' : 'External'}: ${source.label}` });
  });
  return { teams, sources };
}

export function renderCapabilities(host, { rows, status, instances, root, total = list(rows).length }) {
  const doc = host.ownerDocument, names = memberNames(status);
  host.replaceChildren();
  const table = node(doc, 'div', null, 'catalog-table'); table.setAttribute('role', 'table'); table.setAttribute('aria-label', 'Workspace capabilities');
  const head = node(doc, 'div', null, 'catalog-row head'); head.setAttribute('role', 'row');
  for (const label of ['Capability', 'Status', 'Used by']) { const cell = node(doc, 'span', label); cell.setAttribute('role', 'columnheader'); head.append(cell); }
  table.append(head);
  for (const row of list(rows)) {
    const line = node(doc, 'div', null, 'catalog-row'); line.setAttribute('role', 'row');
    line.dataset.capability = row.name;
    const source = capabilitySource(row, names);
    const cap = node(doc, 'div', null, 'catalog-cap'); cap.setAttribute('role', 'cell');
    const copy = node(doc, 'span', null, 'catalog-copy');
    const sub = row.kind === 'package' ? `Package · ${row.package}${row.version ? ` v${row.version}` : ''}`
      : row.kind === 'member' ? `Member · ${source.label}${text(row.team) && row.team !== source.label ? ` · ${row.team}` : ''}`
        : `External · ${text(row.origin) || source.label}`;
    const subEl = node(doc, 'span', sub, 'catalog-sub'); subEl.title = text(row.origin) || sub;
    copy.append(node(doc, 'span', row.name, 'catalog-name'), subEl);
    cap.append(createCapabilityMark(doc, { id: row.name }, { root }), copy);
    const readiness = node(doc, 'div', null, 'catalog-chips'); readiness.setAttribute('role', 'cell');
    const use = capabilityUse(instances, row.name);
    if (row.kind === 'package') {
      readiness.append(chip(doc, 'locked', 'ok', 'check'));
      readiness.append(row.approved === true ? chip(doc, 'approved', 'ok', 'check') : chip(doc, 'approval needed', 'warn', 'warning'));
    } else if (row.kind === 'member') {
      readiness.append(chip(doc, 'member confirmed', 'ok', 'check'));
    } else readiness.append(chip(doc, 'external', ''));
    if (row.commit) { const c = chip(doc, `@${short(row.commit)}`, 'mono'); c.title = `Commit ${row.commit}`; readiness.append(c); }
    if (use.moved) readiness.append(chip(doc, `${use.moved} instance${use.moved === 1 ? '' : 's'} behind`, 'warn', 'warning'));
    const used = node(doc, 'div', null, 'catalog-used'); used.setAttribute('role', 'cell');
    if (use.souls.length) {
      const marks = node(doc, 'span', null, 'catalog-used-marks'); marks.setAttribute('aria-hidden', 'true');
      for (const soul of use.souls.slice(0, 4)) marks.append(createSoulMark(doc, soul));
      const count = node(doc, 'span', `${use.souls.length} soul${use.souls.length === 1 ? '' : 's'}`, 'catalog-used-count');
      count.title = use.souls.map(soul => soul.name).join(', ');
      used.append(marks, count);
    } else used.append(node(doc, 'span', 'No instance yet'));
    line.append(cap, readiness, used);
    table.append(line);
  }
  if (!list(rows).length) table.append(node(doc, 'p', total ? 'No capabilities match these filters.' : 'The workspace reports no capabilities yet: members publish capabilities and packages lock theirs on sync.', 'catalog-empty'));
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
/** Lock/approval lines in the kernel's own terms (workspace status). */
export function lockNotes(status) {
  const lines = [];
  if (list(status?.unsynced).length) lines.push({ text: `Declared but not locked: ${status.unsynced.join(', ')}. Sync to lock them.`, warn: true });
  if (list(status?.stale).length) lines.push({ text: `Locked but no longer declared: ${status.stale.join(', ')}. Sync to drop them.`, warn: true });
  for (const problem of list(status?.problems)) lines.push({ text: [problem.code, problem.message].filter(text).join(': '), warn: true });
  return lines;
}

export function renderSources(host, { status }) {
  const doc = host.ownerDocument;
  host.replaceChildren();
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
    who.append(node(doc, 'span', text(member.name) || member.key, 'catalog-name'), node(doc, 'span', [member.key, short(member.commit)].filter(text).join(' @ '), 'sources-key'));
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
    who.append(node(doc, 'span', `${pkg.id}${pkg.version ? ` v${pkg.version}` : ''}`, 'catalog-name'), node(doc, 'span', [pkg.source, short(pkg.commit)].filter(text).join(' @ '), 'sources-key'));
    const facts = node(doc, 'div', null, 'catalog-chips');
    facts.append(chip(doc, 'locked', 'ok', 'check'), pkg.approved ? chip(doc, 'approved', 'ok', 'check') : chip(doc, 'approval needed', 'warn', 'warning'));
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
