/** Workspace › Capabilities: the Workspace defaults section.
 *
 * The section is what the workspace itself gives every soul, read from `oats workspace status --json`
 * `defaults` (deployment-data.mjs defaultsFacts) and matched to the `oats capabilities` rows already held:
 * one panel with a scope line, then two groups drawn with one cell: Core capabilities (always Knowledge, Messaging,
 * Tasks: a soul has at most one of each) and Additional capabilities (any number per soul; design 2026-10-23,
 * round 4). Without a reported `defaults` nothing is shown: nothing is inferred from the
 * souls or the roster. Search and the repository pills never narrow it (it is not a list of the catalog).
 * Teams add no capabilities since 0.30, so there are no team defaults to show. The "About capabilities"
 * dialog the toolbar's "i" opens is about-dialog.mjs. */
import { iconElement } from './shell-icons.mjs';
import { sourceChip, sourceText } from './source-chip.mjs';
import { memberNames, hostKeyOf } from '../../client/capability-rows.mjs';

export const defaultsCSS = `
/* Workspace defaults (design 2026-10-23, round 3): one panel, no lead and no identity mark. */
.ws-defaults-panel { background:var(--surface); border:1px solid var(--border); border-radius:10px; overflow:hidden; }
/* The scope line says whose defaults these are, so no one reads them as one soul's setup. */
.ws-defaults-scope { margin:0; padding:14px 18px; color:var(--fg); font-size:13px; line-height:1.45; }
.ws-defaults-scope:not(:last-child) { border-bottom:1px solid var(--border); }
.ws-defaults-ws { font-weight:650; }
.ws-defaults-sub { display:block; color:var(--muted); font-size:12px; }
/* Two groups, Core then Additional, each a heading (with its lead) over the same 3-column grid of cells, 1px
   --tag-bg rules between columns; stacked (rules between rows) below 700px. */
.ws-defaults-group + .ws-defaults-group { border-top:1px solid var(--border); }
.ws-defaults-group-head { display:flex; align-items:baseline; flex-wrap:wrap; gap:4px 10px; margin:0; padding:12px 18px 0; color:var(--fg); font-size:12.5px; font-weight:650; }
.ws-defaults-group-lead { color:var(--muted); font-size:12px; font-weight:400; }
.ws-defaults-cells { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); margin:0; padding:6px 0 4px; list-style:none; }
.ws-defaults-cells > li { display:flex; min-width:0; border-left:1px solid var(--tag-bg); }
.ws-defaults-cells > li:nth-child(3n+1) { border-left:0; }
.ws-defaults-none { margin:0; padding:8px 18px 14px; color:var(--muted); font-size:12px; }
/* One cell for both groups: the 24px tile beside a text stack (core: the slot's name, then the id or None and its
   note; then the source chip, or "turned off by the workspace"). The whole cell is the button when it opens a page. */
.oats-view .ws-default-cell, .ws-default-cell { appearance:none; -webkit-appearance:none; display:grid; grid-template-columns:24px minmax(0,1fr); column-gap:12px; align-items:start; flex:1; width:100%; min-width:0; height:auto; min-height:0; margin:0; padding:10px 18px 12px; border:0; border-radius:0; background:var(--surface); color:var(--fg); font:inherit; text-align:left; box-sizing:border-box; }
.oats-view button.ws-default-cell { cursor:pointer; }
.oats-view button.ws-default-cell:hover { background:var(--surface-2); }
/* Keyboard focus: the shell's tint (rule 2) under the global accent edge; the background rule above would out-rank the global one. */
.oats-view button.ws-default-cell:focus-visible { background:var(--sel); }
.ws-default-tile { display:grid; place-items:center; width:24px; height:24px; border-radius:6px; background:var(--chip-bg); color:var(--chip-fg); }
.ws-default-tile[data-tint=slate] { background:var(--soul-slate-bg); color:var(--soul-slate-fg); }
.ws-default-tile[data-tint=sage] { background:var(--soul-sage-bg); color:var(--soul-sage-fg); }
.ws-default-tile[data-tint=mauve] { background:var(--soul-mauve-bg); color:var(--soul-mauve-fg); }
.ws-default-tile[data-tint=clay] { background:var(--soul-clay-bg); color:var(--soul-clay-fg); }
.ws-default-stack { display:flex; flex-direction:column; align-items:flex-start; gap:3px; min-width:0; }
.ws-default-label { height:24px; color:var(--muted); font:600 12px var(--sans,system-ui); line-height:24px; }
.ws-default-name { min-width:0; max-width:100%; color:var(--fg); font:650 14px var(--mono,monospace); line-height:24px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ws-default-none { color:var(--muted); font:500 14px var(--sans,system-ui); line-height:24px; }
.ws-default-note { color:var(--muted); font-size:12px; line-height:1.4; }
.ws-default-cell .source-chip { max-width:100%; }
/* A core cell with two declared ids (the workspace's own conflict): each id and its chip is its own button. */
.oats-view .ws-default-entry, .ws-default-entry { appearance:none; -webkit-appearance:none; display:flex; flex-direction:column; align-items:flex-start; gap:3px; min-width:0; max-width:100%; height:auto; min-height:0; margin:0; padding:0; border:0; border-radius:4px; background:var(--surface); color:var(--fg); font:inherit; text-align:left; }
.oats-view button.ws-default-entry { cursor:pointer; }
.oats-view button.ws-default-entry:hover .ws-default-name { text-decoration:underline; }
.oats-view button.ws-default-entry:focus-visible { background:var(--sel); }
/* Turned off by the workspace: named, never offered (the id struck through in --muted). */
.ws-default-cell.off .ws-default-name { color:var(--muted); text-decoration:line-through; }
@container (max-width:700px) {
 .ws-defaults-cells { grid-template-columns:minmax(0,1fr); }
 .ws-defaults-cells > li, .ws-defaults-cells > li:nth-child(3n+1) { border-left:0; border-top:1px solid var(--tag-bg); }
 .ws-defaults-cells > li:first-child { border-top:0; }
}
`;

/** The core slots, in the one order the strip shows them: [slot, name, icon, tint]. */
export const DEFAULT_SLOTS = Object.freeze([
  Object.freeze(['knowledge', 'Knowledge', 'knowledge', 'slate']),
  Object.freeze(['messaging', 'Messaging', 'mail', 'sage']),
  Object.freeze(['tasks', 'Tasks', 'tasks', 'mauve']),
]);

export const DEFAULTS_COPY = Object.freeze({
  title: 'Workspace defaults',
  thisWorkspace: 'this workspace',
  every: ['Every soul in ', ' starts with these,'],
  unless: 'unless it turns one off.',
  none: ' sets no defaults.',
  noneSub: 'Each soul chooses all of its own capabilities.',
  core: 'Core capabilities',
  coreLead: 'at most one of each per soul',
  additional: 'Additional capabilities',
  additionalLead: 'any number per soul',
  additionalNone: 'None. Each soul adds its own.',
  emptySlot: 'None',
  emptyNote: 'No workspace default. Each soul chooses its own.',
  off: 'turned off by the workspace',
  // An unlisted package default: which package holds it is unknown here, so the chip names the kind alone.
  unlistedPackage: 'package',
  unlistedPackageTitle: 'A locked package; not in the workspace’s capability list',
  unlistedPackageWords: 'a package',
});

const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value ? value : null;
const list = value => Array.isArray(value) ? value : [];

/** The reported defaults as the section shows them, or null when the kernel reports none (no claim).
 * `slots`: one per core slot, in strip order; `value` is `{name, from}` or null (missing, `"none"`, `null`
 * or any other string all read as empty). `capabilities`: the named entries. `count`: the jump's number,
 * filled slots plus the capabilities not turned off. `empty`: nothing set at all. */
export function workspaceDefaults(status) {
  const defaults = status?.defaults;
  if (!record(defaults)) return null;
  const slots = DEFAULT_SLOTS.map(([slot, label, icon, tint]) => {
    const value = record(defaults.slots) ? defaults.slots[slot] : null;
    return { slot, label, icon, tint, value: record(value) && text(value.name) ? value : null };
  });
  const capabilities = list(defaults.capabilities).filter(cap => record(cap) && text(cap.name));
  const count = slots.filter(s => s.value).length + capabilities.filter(cap => cap.off !== true).length;
  return { slots, capabilities, count, empty: !slots.some(s => s.value) && !capabilities.length };
}

/** The catalog row a default names: `from: "package"` the package row of that name; a member key that
 * member's row; `"here"` the host's (`hostKey`, hostKeyOf). With no such row, a minimal one that still names
 * the source, never a version (`listed: false`); null when `from` names no source at all. */
export function defaultRow(rows, { name, from }, hostKey) {
  if (!text(from) || (from === 'here' && !text(hostKey))) return null;
  const repoKey = from === 'here' ? hostKey : from;
  const found = list(rows).find(row => row?.name === name && (from === 'package' ? row.kind === 'package' : row.kind === 'member' && row.repoKey === repoKey));
  if (found) return { row: found, listed: true };
  // An unlisted package row names no package: the capability's id is not its package's (oats.core is oats.framework's).
  return { row: from === 'package' ? { name, kind: 'package' } : { name, kind: 'member', repoKey }, listed: false };
}

function node(doc, tag, value, cls) {
  const el = doc.createElement(tag);
  if (value !== undefined && value !== null) el.textContent = value;
  if (cls) el.className = cls;
  return el;
}

const unlistedPackage = match => !match.listed && match.row.kind === 'package';
/** The source chip for a matched default; an unlisted one names its source and nothing more (no version), and an
 * unlisted package only its kind (the package is not known). */
function chipFor(doc, match, names) {
  if (!unlistedPackage(match)) return sourceChip(doc, match.row, names, { version: match.listed });
  const chip = node(doc, 'span', null, 'source-chip'); chip.dataset.source = 'package'; chip.title = DEFAULTS_COPY.unlistedPackageTitle;
  chip.append(iconElement(doc, 'package', { size: 13 }), node(doc, 'span', DEFAULTS_COPY.unlistedPackage, 'source-chip-name'));
  return chip;
}
const sourceWords = (match, names) => unlistedPackage(match) ? DEFAULTS_COPY.unlistedPackageWords
  : match.listed ? sourceText(match.row, names).label : sourceText(match.row, names).name;

let groupIds = 0; // ids for the group headings, unique in the document
/** An additional default's tile, by what its source says: a package (neutral), a member repository (clay, the catalog's
 * tint rule), or nothing known (a default turned off reports no source): neutral, with no source's icon. */
const additionalTile = (cap, match) => cap.off !== true && match ? (match.row.kind === 'member' ? { icon: 'repo', tint: 'clay' } : { icon: 'package', tint: null }) : { icon: 'layers', tint: null };

/** Paint the defaults panel into `section` (a .capability-section the caller made). `rows`: the catalog's
 * rows; `onOpen(row)`: the catalog rows' own opener (a page), or null for a panel with nothing to open.
 * Names are text nodes only. Every focusable control carries its declaration's `data-focus-key` (`defaults:<slot>` for
 * a slot default, `defaults:cap:<name>` for a named one, whichever group or cell draws it), so a repaint and a page's
 * Back put focus back on the same declaration. */
export function renderWorkspaceDefaults(section, { status, rows, onOpen = null }) {
  const doc = section.ownerDocument, defaults = workspaceDefaults(status);
  if (!defaults) return false;
  const names = memberNames(status), hostKey = hostKeyOf(status);
  const wsName = text(status?.workspace?.name) || DEFAULTS_COPY.thisWorkspace;
  const panel = node(doc, 'div', null, 'ws-defaults-panel');
  const scope = node(doc, 'p', null, 'ws-defaults-scope');
  const ws = () => node(doc, 'span', wsName, 'ws-defaults-ws');
  if (defaults.empty) scope.append(ws(), DEFAULTS_COPY.none, ' ', node(doc, 'span', DEFAULTS_COPY.noneSub, 'ws-defaults-sub'));
  else scope.append(DEFAULTS_COPY.every[0], ws(), DEFAULTS_COPY.every[1], ' ', node(doc, 'span', DEFAULTS_COPY.unless, 'ws-defaults-sub'));
  panel.append(scope);
  section.append(panel);
  if (defaults.empty) return true;
  const opens = typeof onOpen === 'function';
  /** A group: its heading (the title, then its lead), then its cells' list, labelled by the heading. */
  const group = (key, title, lead) => {
    const el = node(doc, 'div', null, 'ws-defaults-group'); el.dataset.group = key;
    const head = node(doc, 'h3', null, 'ws-defaults-group-head'); head.id = `ws-defaults-${key}-${++groupIds}`;
    head.append(node(doc, 'span', title), ' ', node(doc, 'span', lead, 'ws-defaults-group-lead'));
    el.append(head); panel.append(el);
    const list = node(doc, 'ul', null, 'ws-defaults-cells'); list.setAttribute('aria-labelledby', head.id);
    return { el, list };
  };
  /** One cell: a button opening `match.row` when it can (`label`: its accessible name, `focusKey`), else a plain div. */
  const cell = ({ tile, tint, empty = false, stack, match, label, focusKey, off = false }) => {
    const button = !!match && opens && !off;
    const el = node(doc, button ? 'button' : 'div', null, `ws-default-cell${off ? ' off' : ''}`);
    const square = node(doc, 'span', null, 'ws-default-tile'); square.setAttribute('aria-hidden', 'true');
    if (tint && !empty) square.dataset.tint = tint;
    square.append(iconElement(doc, tile, { size: 14 }));
    const words = node(doc, 'span', null, 'ws-default-stack'); words.append(...stack);
    el.append(square, words);
    if (button) {
      el.type = 'button'; el.dataset.focusKey = focusKey; el.setAttribute('aria-label', label);
      el.addEventListener('click', () => onOpen(match.row)); // the native button turns Enter and Space into this click
    }
    const item = node(doc, 'li'); item.append(el); return { item, el };
  };
  const name = value => { const el = node(doc, 'span', value, 'ws-default-name'); el.title = value; return el; };
  // Which group a named default (defaults.capabilities) belongs to, from the catalog row's layer only: a listed,
  // not-turned-off capability of a core layer fills that core cell (the kernel fills slots by manifest layer, whether
  // the workspace named it under defaults.<slot> or defaults.capabilities, also when the slot itself says none).
  // A layer the catalog does not report (unlisted, no source, turned off) is not guessed: those stay Additional.
  const coreNamed = new Map(DEFAULT_SLOTS.map(([slot]) => [slot, []])), additionalCaps = [];
  for (const cap of defaults.capabilities) {
    const match = cap.off === true ? null : defaultRow(rows, cap, hostKey);
    if (match?.listed && coreNamed.has(match.row.layer)) coreNamed.get(match.row.layer).push({ name: cap.name, match, key: `defaults:cap:${cap.name}` });
    else additionalCaps.push(cap);
  }
  const core = group('core', DEFAULTS_COPY.core, DEFAULTS_COPY.coreLead);
  for (const { slot, label, icon, tint, value } of defaults.slots) {
    // The slot declaration first, then a same-layer named default. Both at once is the workspace's own conflict
    // (the kernel refuses every soul): both are shown as declared, each opening its own page.
    // Each entry keeps its declaration's focus key wherever it is drawn (a slot's `defaults:<slot>`, a named default's
    // `defaults:cap:<name>`, unique by the map it is named in): a refresh that moves a named default between the
    // groups, or turns one cell into two, puts focus back on the same declaration.
    const entries = [...(value ? [{ name: value.name, match: defaultRow(rows, value, hostKey), key: `defaults:${slot}` }] : []), ...coreNamed.get(slot)];
    const stack = [node(doc, 'span', label, 'ws-default-label')];
    const opener = entry => `${label}: ${entry.name}, the workspace default — open its page`;
    if (!entries.length) stack.push(node(doc, 'span', DEFAULTS_COPY.emptySlot, 'ws-default-none'), node(doc, 'span', DEFAULTS_COPY.emptyNote, 'ws-default-note'));
    else if (entries.length === 1) stack.push(name(entries[0].name), ...(entries[0].match ? [chipFor(doc, entries[0].match, names)] : []));
    else for (const entry of entries) {
      const button = !!entry.match && opens;
      const line = node(doc, button ? 'button' : 'span', null, 'ws-default-entry');
      line.append(name(entry.name), ...(entry.match ? [chipFor(doc, entry.match, names)] : []));
      if (button) {
        line.type = 'button'; line.dataset.focusKey = entry.key; line.setAttribute('aria-label', opener(entry));
        line.addEventListener('click', () => onOpen(entry.match.row));
      }
      stack.push(line);
    }
    const one = entries.length === 1 ? entries[0] : null;
    const { item, el } = cell({ tile: icon, tint, empty: !entries.length, stack, match: one?.match ?? null, focusKey: one?.key, label: one ? opener(one) : '' });
    el.dataset.slot = slot;
    core.list.append(item);
  }
  core.el.append(core.list);
  const additional = group('additional', DEFAULTS_COPY.additional, DEFAULTS_COPY.additionalLead);
  if (!additionalCaps.length) additional.el.append(node(doc, 'p', DEFAULTS_COPY.additionalNone, 'ws-defaults-none'));
  else {
    for (const cap of additionalCaps) {
      const off = cap.off === true;
      const match = off ? null : defaultRow(rows, cap, hostKey);
      // The space keeps an off cell's id and note apart for assistive tech.
      const stack = [name(cap.name), ...(off ? [' ', node(doc, 'span', DEFAULTS_COPY.off, 'ws-default-note')] : match ? [chipFor(doc, match, names)] : [])];
      const { icon, tint } = additionalTile(cap, match);
      const { item, el } = cell({ tile: icon, tint, stack, match, off, focusKey: `defaults:cap:${cap.name}`,
        label: match ? `${cap.name}, from ${sourceWords(match, names)}, a workspace default — open its page` : '' });
      el.dataset.defaultCapability = cap.name; // not data-capability: a catalog row's Back finds its own row by that
      additional.list.append(item);
    }
    additional.el.append(additional.list);
  }
  return true;
}
