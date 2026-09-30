/** Workspace model v2 catalog views: the Capabilities sections (design board
 * v4.1/Capabilities: one row card per capability) and the Setup tab (graph + lists). Pure DOM from kernel JSON — `oats capabilities`,
 * `oats workspace status` and the roster's module rows. Nothing is resolved,
 * joined across the non-collapse boundary, or inferred: a member's
 * `publishes` stays informational, package capabilities stay package rows. */
import { createCapabilityMark, createSoulMark } from './identity-marks.mjs';
import { iconElement } from './shell-icons.mjs';
import { ROSTER_STALE_TITLE } from './loading.mjs';

export const catalogCSS = `
/* Workspace v4.1: a segmented section jump, section titles with a lead, dropdown filters
   inside Workspace owned, and a Capability | Source | Used by list of row cards. */
/* The jump is one segmented group (shared control rule 1): one frame, 2px inner padding,
   6px segments, no dividers; the current section is the brand tint, never ink-on-white.
   Scoped to .capability-nav.ws-segmented so it holds whichever order the sheets load in. */
.capability-nav.ws-segmented { display:inline-flex; align-items:center; flex:none; height:30px; padding:2px; gap:2px; margin:0 0 22px; border:1px solid var(--border); border-radius:8px; background:var(--surface); overflow:visible; }
.oats-view .capability-nav.ws-segmented button { display:inline-flex; align-items:center; gap:6px; height:100%; min-height:0; padding:0 12px; border:0; border-radius:6px; background:transparent; color:var(--muted); font:500 12px var(--sans,system-ui); white-space:nowrap; cursor:pointer; }
.oats-view .capability-nav.ws-segmented button:hover { color:var(--fg); }
.oats-view .capability-nav.ws-segmented button[aria-current] { background:var(--sel); color:var(--accent); font-weight:650; }
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
/* Rule 3: the wrapper's border is the field's one frame; the select inside never draws its own. */
.oats-view .catalog-select select, .oats-view .catalog-select select:focus-visible { outline:none; }
.catalog-select .shell-icon { position:absolute; right:8px; color:var(--muted); pointer-events:none; }
.catalog-select:focus-within { border-color:var(--accent); }
.catalog-shown { margin-left:4px; color:var(--muted); font-size:12px; white-space:nowrap; }
.oats-view button.catalog-clear { min-height:0; height:auto; padding:0; border:0; background:none; color:var(--accent); font:600 12px var(--sans,system-ui); cursor:pointer; }
.oats-view button.catalog-clear:hover { text-decoration:underline; }
/* The list: a column header, then one card per capability (58px, 6px apart). The
   header and the cards share one grid so the columns line up. */
.catalog-table { display:flex; flex-direction:column; gap:6px; font-size:12px; }
.catalog-head, .catalog-row { display:grid; grid-template-columns:44px minmax(0,1fr) 190px 120px 24px; column-gap:14px; align-items:center; padding:0 16px; box-sizing:border-box; }
.catalog-head { margin:0 0 4px; color:var(--muted); font-size:10.5px; font-weight:650; letter-spacing:.065em; text-transform:uppercase; }
/* The whole card is one button (rule: no nested interactive elements); reset the UA button. */
.oats-view button.catalog-row, button.catalog-row { appearance:none; -webkit-appearance:none; width:100%; height:58px; min-height:0; margin:0; border:1px solid var(--border); border-radius:10px; background:var(--surface); color:var(--fg); font:inherit; text-align:left; cursor:pointer; }
.oats-view button.catalog-row:hover, button.catalog-row:hover { background:var(--surface-2); border-color:var(--tree-line); }
/* Focus is the shell's rule 2 (keyboard only: the tint with a 1px accent edge). */
/* Listed without a page to open (no onOpen): a plain card, not a dimmed control. */
.oats-view button.catalog-row:disabled, button.catalog-row:disabled { color:var(--fg); background:var(--surface); border-color:var(--border); cursor:default; }
/* Icon tile and kind chip: one tint per kind (7b), a layer always wins so both agree.
   Neutral = a package without a layer. */
.catalog-tile { display:grid; place-items:center; flex:none; width:32px; height:32px; border-radius:8px; background:var(--chip-bg); color:var(--chip-fg); }
.catalog-core { display:inline-flex; align-items:center; flex:none; height:18px; padding:0 6px; border-radius:4px; background:var(--chip-bg); color:var(--chip-fg); font:650 10.5px var(--sans,system-ui); white-space:nowrap; }
.catalog-tile[data-tint=slate], .catalog-core[data-tint=slate] { background:var(--soul-slate-bg); color:var(--soul-slate-fg); }
.catalog-tile[data-tint=sage], .catalog-core[data-tint=sage] { background:var(--soul-sage-bg); color:var(--soul-sage-fg); }
.catalog-tile[data-tint=mauve], .catalog-core[data-tint=mauve] { background:var(--soul-mauve-bg); color:var(--soul-mauve-fg); }
.catalog-tile[data-tint=clay], .catalog-core[data-tint=clay] { background:var(--soul-clay-bg); color:var(--soul-clay-fg); }
.catalog-cap { display:flex; flex-direction:column; justify-content:center; min-width:0; }
.catalog-cap-line { display:flex; align-items:center; gap:7px; min-width:0; }
.catalog-name { color:var(--fg); font:650 13px var(--mono,monospace); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
/* One line, always: the card keeps its height and the page holds the full text. */
.catalog-desc { display:block; min-width:0; color:var(--muted); font-size:12px; line-height:1.4; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.catalog-source { display:flex; min-width:0; }
.catalog-chevron { color:var(--muted); }
.catalog-group { display:flex; align-items:center; gap:7px; min-height:28px; margin:8px 0 0; padding:0 16px; color:var(--muted); font:600 11.5px var(--mono,monospace); }
.catalog-group:first-child { margin-top:0; }
.source-chip { display:inline-flex; align-items:center; gap:7px; min-width:0; color:var(--muted); font:12px var(--mono,monospace); }
.source-chip .shell-icon { flex:none; }
.source-chip-name { color:var(--fg); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
.source-chip-version { white-space:nowrap; }
.source-chip.boxed { height:24px; padding:0 8px; border:1px solid var(--border); border-radius:6px; background:var(--surface); font-size:11.5px; box-sizing:border-box; }
.source-note { color:var(--warn); font:600 11px var(--sans,system-ui); white-space:nowrap; }
.catalog-used { display:flex; align-items:center; gap:6px; min-width:0; }
.catalog-used-marks { display:flex; flex:none; padding-left:5px; }
.catalog-used-marks:empty { display:none; }
.catalog-used-marks .identity-mark { width:20px; height:20px; margin-left:-5px; border-radius:6px; border:1.5px solid var(--surface); font-size:9.5px; font-weight:700; box-sizing:border-box; }
.catalog-used-count { color:var(--fg); font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.catalog-used-count.none { color:var(--muted); }
.catalog-empty { margin:0; padding:24px 16px; color:var(--muted); line-height:1.5; }
.catalog-notes { display:grid; gap:4px; margin:0 0 14px; }
.catalog-notes:empty { display:none; }
.catalog-note { margin:0; color:var(--muted); font-size:12px; line-height:1.5; overflow-wrap:anywhere; }
.catalog-note.warn { color:var(--warn); }
.capability-section { display:flex; flex-direction:column; gap:10px; }
.capability-section + .capability-section { margin-top:22px; }
.capability-section-head { display:flex; align-items:center; flex-wrap:wrap; gap:8px 16px; min-width:0; }
.capability-section-head .catalog-filters { margin-left:auto; }
.capability-section-title { display:flex; align-items:baseline; gap:10px; margin:0; padding:0 2px; color:var(--fg); font-size:15px; font-weight:650; }
.capability-section-lead { color:var(--muted); font-size:12px; font-weight:400; }
.capability-none { margin:0; }
/* Narrow: the card grows; source and used-by drop under the name, the tile and chevron stay on the first line. */
@container(max-width:700px) {
 .catalog-head { display:none; }
 .oats-view button.catalog-row, button.catalog-row { grid-template-columns:44px minmax(0,1fr) 24px; height:auto; min-height:58px; padding:10px 16px; row-gap:6px; }
 .catalog-row .catalog-tile, .catalog-row .catalog-chevron { grid-row:1; }
 .catalog-row .catalog-source, .catalog-row .catalog-used { grid-column:2; }
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
/** The tile/chip tint of a row (7b): a layer always wins, so the tile and the kind chip
 * agree; any other member/external capability is clay; a plain package stays neutral. */
const TINTS = { knowledge: 'slate', messaging: 'sage', tasks: 'mauve' };
const tint = row => TINTS[row.layer] || (row.kind === 'package' ? 'neutral' : 'clay');
const TILE_ICONS = { knowledge: 'knowledge', messaging: 'mail', tasks: 'tasks' };
const tileIcon = row => TILE_ICONS[row.layer] || (row.kind === 'package' ? 'package' : 'soul');

/** The source chip's words: the package with its pinned version, or the repository at latest. */
function sourceText(row, names = new Map()) {
  const source = capabilitySource(row, names);
  const name = row.kind === 'package' ? text(row.package) || source.label : source.label;
  const version = row.kind === 'package' ? text(row.version) : row.kind === 'member' ? 'latest' : null;
  return { source, name, version, label: [name, version].filter(Boolean).join(' ') };
}

/** Where a capability comes from, as one chip: a package with its pinned
 * version, a member repository at its latest, or (repo owned) this soul's own
 * repository at its latest. `boxed` draws it as a bordered chip. */
export function sourceChip(doc, row, names = new Map(), { boxed = false } = {}) {
  const { source, name, version, label } = sourceText(row, names);
  const el = node(doc, 'span', null, `source-chip${boxed ? ' boxed' : ''}`); el.dataset.source = source.kind;
  const icon = row.kind === 'package' ? 'package' : row.private === true ? 'home' : 'repo';
  el.append(iconElement(doc, icon, { size: 13 }), node(doc, 'span', name, 'source-chip-name'));
  if (version) el.append(node(doc, 'span', version, 'source-chip-version'));
  el.title = text(row.origin) || label;
  return el;
}

/** A workspace default ("Every soul"): the row is one of status.defaults.capabilities
 * not turned off, or fills its layer's default slot. Without reported defaults
 * nothing is claimed. */
function isWorkspaceDefault(status, row) {
  const defaults = status?.defaults;
  if (!defaults || typeof defaults !== 'object') return false;
  if (list(defaults.capabilities).some(cap => cap?.name === row.name && cap.off !== true)) return true;
  const slot = text(row.layer) ? defaults.slots?.[row.layer] : null;
  return !!(slot && typeof slot === 'object' && slot.name === row.name);
}

// Row ids for aria-describedby: unique in the document across every table rendered.
let rowIds = 0;
/** A section jump is navigation: the current one carries aria-current, the others none. */
const markCurrent = (button, current) => { if (current) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current'); };

/** The capability list: a column header, then one row card per capability —
 * icon tile | name + kind chip over a one-line description | source chip |
 * used by (the souls whose instances carry it, from the roster's module rows;
 * "Every soul" for a workspace default) | chevron.
 * groups: [{ label, rows }] adds a repository heading before each group (Repo owned).
 * onOpen(row): the card is one button opening the capability's page (click; Enter and Space are the
 * native button's). Its name is short ("<cap>, <kind>, from <source>"); its description and used-by
 * are its accessible description (aria-describedby), since the column header is for the eye only. */
/** `rosterState` (desktop/loading-states): the roster the "Used by" cells derive from — 'ready' / 'empty' for a
 * settled good read; while pending, failed or stale the cell makes no claim (a muted "—" with the reason). */
export function renderCapabilities(host, { rows, groups = null, status, instances, root, total = list(rows).length, onOpen = null, label = 'Workspace capabilities', empty = null, rosterState = 'ready' }) {
  const doc = host.ownerDocument, names = memberNames(status);
  host.replaceChildren();
  const table = node(doc, 'div', null, 'catalog-table'); table.setAttribute('role', 'group'); table.setAttribute('aria-label', label);
  const any = list(rows).length || (groups && groups.some(group => group.rows.length));
  if (any) {
    // Each card names and describes its own columns to assistive tech; the header is for the eye.
    const head = node(doc, 'div', null, 'catalog-head'); head.setAttribute('aria-hidden', 'true');
    for (const label of ['', 'Capability', 'Source', 'Used by', '']) head.append(node(doc, 'span', label));
    table.append(head);
  }
  const line = row => {
    const el = node(doc, 'button', null, 'catalog-row'); el.type = 'button';
    el.dataset.capability = row.name;
    const words = sourceText(row, names);
    el.setAttribute('aria-label', `${row.name}, ${text(row.layer) ? layerLabel(row.layer) : 'capability'}, from ${words.label}`);
    const id = `catalog-row-${++rowIds}`, described = [];
    if (typeof onOpen === 'function') {
      el.classList.add('openable');
      el.addEventListener('click', () => onOpen(row)); // the native button turns Enter and Space into this click
    } else el.disabled = true;
    const shade = tint(row);
    const tile = node(doc, 'span', null, 'catalog-tile'); tile.dataset.tint = shade; tile.setAttribute('aria-hidden', 'true');
    tile.append(iconElement(doc, tileIcon(row), { size: 16 }));
    const cap = node(doc, 'span', null, 'catalog-cap');
    const first = node(doc, 'span', null, 'catalog-cap-line');
    const name = node(doc, 'span', row.name, 'catalog-name'); name.title = row.name;
    first.append(name);
    if (text(row.layer)) { const core = node(doc, 'span', layerLabel(row.layer), 'catalog-core'); core.dataset.tint = shade; first.append(core); }
    cap.append(first);
    // Kernel #217: the manifest's description, one line; the page carries the whole text.
    if (text(row.description)) {
      const desc = node(doc, 'span', row.description, 'catalog-desc'); desc.title = row.description; desc.id = `${id}-desc`;
      described.push(desc.id); cap.append(desc);
    }
    const source = node(doc, 'span', null, 'catalog-source');
    source.append(sourceChip(doc, row, names, { boxed: true }));
    const use = capabilityUse(instances, row.name);
    const used = node(doc, 'span', null, 'catalog-used');
    const marks = node(doc, 'span', null, 'catalog-used-marks'); marks.setAttribute('aria-hidden', 'true');
    const count = node(doc, 'span', null, 'catalog-used-count');
    const who = use.souls.map(soul => soul.name).join(', ');
    if (isWorkspaceDefault(status, row)) {
      count.textContent = 'Every soul'; count.classList.add('every');
      count.title = `A workspace default: every soul starts with it${who ? ` (recorded by ${who})` : ''}`;
    } else if (use.souls.length) {
      for (const soul of use.souls.slice(0, 3)) marks.append(createSoulMark(doc, soul));
      count.textContent = `${use.souls.length} ${use.souls.length === 1 ? 'soul' : 'souls'}`; count.title = `Used by ${who}`;
    } else if (rosterState !== 'ready' && rosterState !== 'empty') {
      // The roster is not settled-good: "Not used" would be a claim the roster cannot back.
      count.textContent = '—'; count.classList.add('none', 'unknown'); count.title = ROSTER_STALE_TITLE; count.setAttribute('aria-description', ROSTER_STALE_TITLE); count.dataset.rosterState = rosterState;
    } else { count.textContent = 'Not used'; count.classList.add('none'); count.title = 'No instance carries it yet'; }
    // The marks are aria-hidden; assistive tech has no column header, so a count is read as "Used by …"
    // ("Not used" says it already).
    if (!count.classList.contains('none')) {
      const label = node(doc, 'span', 'Used by', 'workspace-sr-only'); label.id = `${id}-used-by`;
      described.push(label.id); used.append(label);
    }
    count.id = `${id}-used`; described.push(count.id);
    used.append(marks, count);
    el.setAttribute('aria-describedby', described.join(' '));
    el.append(tile, cap, source, used, iconElement(doc, 'chevronRight', { size: 16, className: 'shell-icon catalog-chevron' }));
    return el;
  };
  if (groups) for (const group of groups) {
    const title = node(doc, 'div', null, 'catalog-group'); title.setAttribute('role', 'heading'); title.setAttribute('aria-level', '3'); title.dataset.repo = group.key;
    title.append(iconElement(doc, 'repo', { size: 13 }), node(doc, 'span', group.label));
    table.append(title, ...group.rows.map(line));
  } else for (const row of list(rows)) table.append(line(row));
  if (!any) table.append(node(doc, 'p', total ? 'No capabilities match these filters.' : empty || 'The workspace reports no capabilities yet: members publish capabilities and packages lock theirs on sync.', 'catalog-empty'));
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

/** The Capabilities tab: the section jump, then Workspace owned (with its team/repo
 * filters), Packages and, when the kernel lists them (feature
 * capabilities-private), Repo owned grouped by repository. `filterHost` is the
 * discovery's persistent filter row; `query` narrows every section by name.
 * `navHost`, when given, takes the section jump (the view's toolbar row). */
export function renderCapabilitySections(host, { sections, shown, filterHost, navHost = null, privateListed, status, instances, root, onOpen = null, query = '', rosterState = 'ready' }) {
  const doc = host.ownerDocument, names = memberNames(status);
  host.replaceChildren();
  const needle = String(query || '').trim().toLowerCase();
  const match = rows => needle ? rows.filter(row => String(row.name).toLowerCase().includes(needle)) : rows;
  const table = (parent, rows, opts) => { const box = node(doc, 'div'); parent.append(box); renderCapabilities(box, { rows, status, instances, root, onOpen, rosterState, ...opts }); };
  // Nothing at all: one factual line, not three empty sections.
  if (!sections.workspace.length && !sections.packages.length && !sections.repo.length) { table(host, [], {}); return; }
  const defs = [
    { id: 'workspace', title: 'Workspace owned', lead: 'latest from member repos', count: sections.workspace.length },
    { id: 'packages', title: 'Packages', lead: 'pinned versions, same everywhere', count: sections.packages.length },
    ...(privateListed ? [{ id: 'repo', title: 'Repo owned', lead: 'only for souls of the same repo', count: sections.repo.length }] : []),
  ];
  // One segmented group (rule 1 look): the base class is the shell's; the segments are navigation, so
  // aria-current (not aria-pressed) marks the section in view.
  const nav = node(doc, 'nav', null, 'capability-nav ws-segmented'); nav.setAttribute('aria-label', 'Capability sections');
  for (const def of defs) {
    const jump = node(doc, 'button', null); jump.type = 'button'; jump.dataset.jump = def.id;
    jump.append(node(doc, 'span', def.title), node(doc, 'span', String(def.count), 'capability-nav-count'));
    markCurrent(jump, def.id === defs[0].id);
    jump.addEventListener('click', () => {
      const head = host.querySelector(`#capability-section-${def.id}`);
      for (const other of nav.querySelectorAll('button')) markCurrent(other, other === jump);
      head?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }); head?.focus({ preventScroll: true });
    });
    nav.append(jump);
  }
  (navHost || host).append(nav);
  const section = def => {
    const el = node(doc, 'section', null, 'capability-section'); el.dataset.section = def.id;
    const head = node(doc, 'h2', null, 'capability-section-title'); head.id = `capability-section-${def.id}`; head.tabIndex = -1;
    head.append(node(doc, 'span', def.title), node(doc, 'span', def.lead, 'capability-section-lead'));
    // The title row (board 4): the title and its lead, then (Workspace owned) the filters at its right.
    const row = node(doc, 'div', null, 'capability-section-head'); row.append(head);
    el.setAttribute('aria-labelledby', head.id); el.append(row); host.append(el); return el;
  };
  const owned = section(defs[0]);
  if (filterHost) owned.querySelector('.capability-section-head').append(filterHost);
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

/** The jump segment for the section at the top of the scroller (called on scroll). The top is the
 * pinned toolbar's bottom edge when the nav sits in one (spec G), so a section under it is not "in view". */
export function syncCapabilityNav(host, scroller, navHost = host) {
  const nav = navHost.querySelector('.capability-nav'); if (!nav || !scroller?.getBoundingClientRect) return;
  const pinned = navHost.closest?.('.ws-sticky');
  const top = (pinned ? pinned.getBoundingClientRect().bottom : scroller.getBoundingClientRect().top) + 24;
  let current = null;
  for (const el of host.querySelectorAll('.capability-section')) if (el.getBoundingClientRect().top <= top) current = el.dataset.section;
  current ||= host.querySelector('.capability-section')?.dataset.section;
  for (const jump of nav.querySelectorAll('button')) markCurrent(jump, jump.dataset.jump === current);
}


