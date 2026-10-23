/** Workspace › Capabilities: the Workspace defaults section.
 *
 * The section is what the workspace itself gives every soul, read from `oats workspace status --json`
 * `defaults` (deployment-data.mjs defaultsFacts) and matched to the `oats capabilities` rows already held:
 * one panel with a scope line, a strip of the three core slots (always Knowledge, Messaging, Tasks: a slot
 * holds one capability, so the strip is the slot model itself) and, when the workspace defaults others, an
 * "Also for every soul" line. Without a reported `defaults` nothing is shown: nothing is inferred from the
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
/* One column per core slot, 1px --tag-bg rules between them; stacked (rules between rows) below 700px. */
.ws-defaults-slots { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); margin:0; padding:0; list-style:none; }
.ws-defaults-slots > li { display:flex; min-width:0; border-left:1px solid var(--tag-bg); }
.ws-defaults-slots > li:first-child { border-left:0; }
.oats-view .ws-default-slot, .ws-default-slot { appearance:none; -webkit-appearance:none; display:flex; flex-direction:column; align-items:flex-start; gap:6px; flex:1; width:100%; min-width:0; height:auto; min-height:0; margin:0; padding:14px 18px 16px; border:0; border-radius:0; background:var(--surface); color:var(--fg); font:inherit; text-align:left; box-sizing:border-box; }
.oats-view button.ws-default-slot { cursor:pointer; }
.oats-view button.ws-default-slot:hover { background:var(--surface-2); }
/* Keyboard focus: the shell's tint (rule 2) under the global accent edge; the background rule above would out-rank the global one. */
.oats-view button.ws-default-slot:focus-visible, .oats-view button.ws-default-cap:focus-visible { background:var(--sel); }
.ws-default-slot-head { display:flex; align-items:center; gap:8px; color:var(--muted); font:600 12px var(--sans,system-ui); }
.ws-default-slot-icon { display:grid; place-items:center; flex:none; width:24px; height:24px; border-radius:6px; }
.ws-default-slot-icon[data-tint=slate] { background:var(--soul-slate-bg); color:var(--soul-slate-fg); }
.ws-default-slot-icon[data-tint=sage] { background:var(--soul-sage-bg); color:var(--soul-sage-fg); }
.ws-default-slot-icon[data-tint=mauve] { background:var(--soul-mauve-bg); color:var(--soul-mauve-fg); }
.ws-default-slot-icon.is-empty { background:var(--chip-bg); color:var(--muted); }
.ws-default-name { min-width:0; max-width:100%; color:var(--fg); font:650 14px var(--mono,monospace); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ws-default-slot .source-chip { max-width:100%; }
.ws-default-none { color:var(--muted); font:500 14px var(--sans,system-ui); }
.ws-default-note { color:var(--muted); font-size:12px; line-height:1.4; }
/* Every other default: one wrapping line under the strip, one 30px chip each. */
.ws-defaults-more { display:flex; align-items:center; flex-wrap:wrap; gap:8px 10px; padding:12px 18px; border-top:1px solid var(--border); }
.ws-defaults-more-label { margin-right:4px; color:var(--muted); font:600 12px var(--sans,system-ui); }
.oats-view .ws-default-cap, .ws-default-cap { appearance:none; -webkit-appearance:none; display:inline-flex; align-items:center; gap:10px; min-width:0; max-width:100%; height:30px; min-height:0; margin:0; padding:0 10px; border:1px solid var(--border); border-radius:7px; background:var(--surface); color:var(--fg); font:inherit; box-sizing:border-box; }
.oats-view button.ws-default-cap { cursor:pointer; }
.oats-view button.ws-default-cap:hover { background:var(--surface-2); }
.ws-default-cap .ws-default-name { font-size:12.5px; }
.ws-default-cap .source-chip { font-size:11.5px; }
/* Turned off by the workspace: named, never offered (dashed, the id struck through in --muted). */
.ws-default-cap.off { border-style:dashed; cursor:default; }
.ws-default-cap.off .ws-default-name { color:var(--muted); text-decoration:line-through; }
.ws-default-cap.off .ws-default-note { white-space:nowrap; }
@container (max-width:700px) {
 .ws-defaults-slots { grid-template-columns:minmax(0,1fr); }
 .ws-defaults-slots > li { border-left:0; border-top:1px solid var(--tag-bg); }
 .ws-defaults-slots > li:first-child { border-top:0; }
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
  nav: 'Defaults',
  thisWorkspace: 'this workspace',
  every: ['Every soul in ', ' starts with these,'],
  unless: 'unless it chooses its own or turns one off.',
  none: ' sets no defaults.',
  noneSub: 'Each soul chooses all of its own capabilities.',
  emptySlot: 'None',
  emptyNote: 'No workspace default. Each soul chooses its own.',
  more: 'Also for every soul',
  off: 'turned off by the workspace',
  strip: 'Core capability defaults',
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
  return { row: from === 'package' ? { name, kind: 'package', package: name } : { name, kind: 'member', repoKey }, listed: false };
}

function node(doc, tag, value, cls) {
  const el = doc.createElement(tag);
  if (value !== undefined && value !== null) el.textContent = value;
  if (cls) el.className = cls;
  return el;
}

/** The source chip for a matched default; an unlisted one names its source and nothing more (no version). */
const chipFor = (doc, match, names) => sourceChip(doc, match.row, names, { version: match.listed });
const sourceWords = (match, names) => { const words = sourceText(match.row, names); return match.listed ? words.label : words.name; };

let moreIds = 0; // ids for the "Also for every soul" label, unique in the document
/** Paint the defaults panel into `section` (a .capability-section the caller made). `rows`: the catalog's
 * rows; `onOpen(row)`: the catalog rows' own opener (a page), or null for a panel with nothing to open.
 * Names are text nodes only. Focusable controls carry `data-focus-key`s (`defaults:<slot>`,
 * `defaults:cap:<name>`) so a repaint can put focus back on the same one. */
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
  const strip = node(doc, 'ul', null, 'ws-defaults-slots'); strip.setAttribute('aria-label', DEFAULTS_COPY.strip);
  for (const { slot, label, icon, tint, value } of defaults.slots) {
    const match = value ? defaultRow(rows, value, hostKey) : null;
    const button = !!match && opens;
    const cell = node(doc, button ? 'button' : 'div', null, 'ws-default-slot'); cell.dataset.slot = slot;
    const head = node(doc, 'span', null, 'ws-default-slot-head');
    const tile = node(doc, 'span', null, `ws-default-slot-icon${value ? '' : ' is-empty'}`); tile.dataset.tint = tint; tile.setAttribute('aria-hidden', 'true');
    tile.append(iconElement(doc, icon, { size: 14 }));
    head.append(tile, node(doc, 'span', label));
    cell.append(head);
    if (value) {
      const name = node(doc, 'span', value.name, 'ws-default-name'); name.title = value.name;
      cell.append(name);
      if (match) cell.append(chipFor(doc, match, names));
    } else cell.append(node(doc, 'span', DEFAULTS_COPY.emptySlot, 'ws-default-none'), node(doc, 'span', DEFAULTS_COPY.emptyNote, 'ws-default-note'));
    if (button) {
      cell.type = 'button'; cell.dataset.focusKey = `defaults:${slot}`;
      cell.setAttribute('aria-label', `${label}: ${value.name}, the workspace default — open its page`);
      cell.addEventListener('click', () => onOpen(match.row)); // the native button turns Enter and Space into this click
    }
    const item = node(doc, 'li'); item.append(cell); strip.append(item);
  }
  panel.append(strip);
  if (defaults.capabilities.length) {
    const more = node(doc, 'div', null, 'ws-defaults-more'); more.setAttribute('role', 'group');
    const heading = node(doc, 'span', DEFAULTS_COPY.more, 'ws-defaults-more-label'); heading.id = `ws-defaults-more-${++moreIds}`;
    more.setAttribute('aria-labelledby', heading.id); more.append(heading);
    for (const cap of defaults.capabilities) {
      const off = cap.off === true;
      const match = off ? null : defaultRow(rows, cap, hostKey);
      const button = !!match && opens;
      const chip = node(doc, button ? 'button' : 'span', null, `ws-default-cap${off ? ' off' : ''}`); chip.dataset.defaultCapability = cap.name; // not data-capability: a catalog row's Back finds its own row by that
      const name = node(doc, 'span', cap.name, 'ws-default-name'); name.title = cap.name;
      chip.append(name);
      if (off) chip.append(' ', node(doc, 'span', DEFAULTS_COPY.off, 'ws-default-note')); // the space keeps the words apart for assistive tech
      else if (match) chip.append(chipFor(doc, match, names));
      if (button) {
        chip.type = 'button'; chip.dataset.focusKey = `defaults:cap:${cap.name}`;
        chip.setAttribute('aria-label', `${cap.name}, from ${sourceWords(match, names)}, a workspace default — open its page`);
        chip.addEventListener('click', () => onOpen(match.row));
      }
      more.append(chip);
    }
    panel.append(more);
  }
  return true;
}
