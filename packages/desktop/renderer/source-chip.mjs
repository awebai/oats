/** Where a capability comes from, as one chip (its CSS is workspace-catalog.mjs catalogCSS `.source-chip`).
 * Shared by the catalog rows, the capability page and the Workspace defaults section; workspace-catalog.mjs
 * re-exports both functions. */
import { iconElement } from './shell-icons.mjs';
import { capabilitySource } from '../../client/capability-rows.mjs';

const text = value => typeof value === 'string' && value ? value : null;

/** The source chip's words: the package with its pinned version, or the repository at latest. */
export function sourceText(row, names = new Map()) {
  const source = capabilitySource(row, names);
  const name = row.kind === 'package' ? text(row.package) || source.label : source.label;
  const version = row.kind === 'package' ? text(row.version) : row.kind === 'member' ? 'latest' : null;
  return { source, name, version, label: [name, version].filter(Boolean).join(' ') };
}

/** Where a capability comes from, as one chip: a package with its pinned
 * version, a member repository at its latest, or (repo owned) this soul's own
 * repository at its latest. `boxed` draws it as a bordered chip; `version: false`
 * names the source alone (a row the catalog does not list: no version is claimed). */
export function sourceChip(doc, row, names = new Map(), { boxed = false, version: withVersion = true } = {}) {
  const words = sourceText(row, names);
  const version = withVersion ? words.version : null;
  const el = doc.createElement('span'); el.className = `source-chip${boxed ? ' boxed' : ''}`; el.dataset.source = words.source.kind;
  const icon = row.kind === 'package' ? 'package' : row.private === true ? 'home' : 'repo';
  const name = doc.createElement('span'); name.className = 'source-chip-name'; name.textContent = words.name;
  el.append(iconElement(doc, icon, { size: 13 }), name);
  if (version) { const v = doc.createElement('span'); v.className = 'source-chip-version'; v.textContent = version; el.append(v); }
  el.title = withVersion ? text(row.origin) || words.label : words.name;
  return el;
}
