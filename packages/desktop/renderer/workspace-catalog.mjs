/** Workspace model v2 catalog views: the Capabilities sections (design frame 04
 * table) and the Setup tab (graph + lists). Pure DOM from kernel JSON — `oats capabilities`,
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
.catalog-row.openable { cursor:pointer; }
.catalog-row.openable:hover { background:var(--surface-2); }
.catalog-row.openable:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }
.catalog-empty { padding:24px 16px; color:var(--muted); line-height:1.5; }
.catalog-notes { display:grid; gap:4px; margin:0 0 14px; }
.catalog-note { margin:0; color:var(--muted); font-size:12px; line-height:1.5; overflow-wrap:anywhere; }
.catalog-note.warn { color:var(--warn); }
.sources-section + .sources-section { margin-top:var(--section-gap); }
.capability-section + .capability-section { margin-top:var(--section-gap); }
.capability-section-title { display:flex; align-items:baseline; gap:8px; margin:0; color:var(--muted); font-size:10.5px; font-weight:650; letter-spacing:.06em; text-transform:uppercase; }
.capability-section-title:focus { outline:none; }
.capability-section-count { color:var(--muted); font-weight:500; letter-spacing:0; }
.capability-section-lead { margin:2px 0 var(--title-gap); color:var(--muted); font-size:12px; line-height:1.5; }
.capability-repo + .capability-repo { margin-top:14px; }
.capability-repo-title { display:flex; align-items:center; gap:6px; margin:0 0 8px; color:var(--fg); font-size:12.5px; font-weight:650; }
.capability-repo-title .shell-icon { color:var(--muted); }
.capability-none { margin:0; padding:0; }
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

/** Pill filters: single choice per group, AND across groups. */
export function renderFilters(host, { teams, repos, value, onChange, onRefresh, refreshing = false }) {
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
  host.append(group('Repo', 'repo', [{ label: 'All', value: null }, ...repos]));
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
/** onOpen(row): rows open the capability's page (click, Enter or Space). */
export function renderCapabilities(host, { rows, status, instances, root, total = list(rows).length, onOpen = null, label = 'Workspace capabilities', empty = null }) {
  const doc = host.ownerDocument, names = memberNames(status);
  host.replaceChildren();
  const table = node(doc, 'div', null, 'catalog-table'); table.setAttribute('role', 'table'); table.setAttribute('aria-label', label);
  const head = node(doc, 'div', null, 'catalog-row head'); head.setAttribute('role', 'row');
  for (const label of ['Capability', 'Status', 'Used by']) { const cell = node(doc, 'span', label); cell.setAttribute('role', 'columnheader'); head.append(cell); }
  table.append(head);
  for (const row of list(rows)) {
    const line = node(doc, 'div', null, 'catalog-row'); line.setAttribute('role', 'row');
    line.dataset.capability = row.name;
    if (typeof onOpen === 'function') {
      line.classList.add('openable'); line.tabIndex = 0; line.setAttribute('aria-label', `${row.name}: open its page`);
      line.addEventListener('click', () => onOpen(row));
      line.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(row); } });
    }
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
  if (!list(rows).length) table.append(node(doc, 'p', total ? 'No capabilities match these filters.' : empty || 'The workspace reports no capabilities yet: members publish capabilities and packages lock theirs on sync.', 'catalog-empty'));
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

/** The Capabilities tab: Workspace owned (with its team/repo filters), Packages
 * and, when the kernel lists them (feature capabilities-private), Repo owned
 * grouped by repository. `filterHost` is the discovery's persistent pill row. */
export function renderCapabilitySections(host, { sections, shown, filterHost, privateListed, status, instances, root, onOpen = null }) {
  const doc = host.ownerDocument, names = memberNames(status);
  host.replaceChildren();
  const section = (id, title, count, lead) => {
    const el = node(doc, 'section', null, 'capability-section'); el.dataset.section = id;
    const head = node(doc, 'h2', null, 'capability-section-title'); head.id = `capability-section-${id}`; head.tabIndex = -1;
    head.append(node(doc, 'span', title), node(doc, 'span', count, 'capability-section-count'));
    el.setAttribute('aria-labelledby', head.id);
    el.append(head, node(doc, 'p', lead, 'capability-section-lead'));
    host.append(el); return el;
  };
  const table = (parent, rows, opts) => { const box = node(doc, 'div'); parent.append(box); renderCapabilities(box, { rows, status, instances, root, onOpen, ...opts }); };
  // Nothing at all: one factual line (and the refresh), not three empty sections.
  if (!sections.workspace.length && !sections.packages.length && !sections.repo.length) {
    if (filterHost) host.append(filterHost);
    table(host, [], {}); return;
  }
  const owned = section('workspace', 'Workspace owned', shown.length === sections.workspace.length ? String(shown.length) : `${shown.length} of ${sections.workspace.length}`,
    'Listed to every soul in the workspace.');
  if (filterHost) owned.append(filterHost);
  table(owned, shown, { total: sections.workspace.length, label: 'Workspace owned capabilities', empty: 'No workspace repository offers a capability yet.' });
  const packages = section('packages', 'Packages', String(sections.packages.length), 'From the packages this workspace installs.');
  table(packages, sections.packages, { label: 'Package capabilities', empty: 'No package capability is locked yet. Sync to lock the declared packages.' });
  if (!privateListed) return;
  const repo = section('repo', 'Repo owned', String(sections.repo.length), "Private to their repository: only that repository's souls can use them.");
  if (!sections.repo.length) { repo.append(node(doc, 'p', 'No repository keeps a private capability.', 'catalog-empty capability-none')); return; }
  const byRepo = new Map();
  for (const row of sections.repo) { const source = capabilitySource(row, names); if (!byRepo.has(source.key)) byRepo.set(source.key, { source, rows: [] }); byRepo.get(source.key).rows.push(row); }
  for (const { source, rows } of [...byRepo.values()].sort((a, b) => a.source.label.localeCompare(b.source.label))) {
    const group = node(doc, 'div', null, 'capability-repo'); group.dataset.repo = source.key;
    const title = node(doc, 'h3', null, 'capability-repo-title');
    title.append(iconElement(doc, 'repo', { size: 14 }), node(doc, 'span', source.label));
    group.append(title); repo.append(group);
    table(group, rows, { label: `${source.label} repo-owned capabilities` });
  }
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
