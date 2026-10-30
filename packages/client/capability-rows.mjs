/** A capability row as both clients read it: the pure rules over `oats capabilities` rows, workspace
 * status and the roster's module rows that the Desktop's Capabilities view and capability page draw
 * from. Which source a row comes from and the group it sits in, the view's sections and search, who
 * uses it ("Used by"), and a core capability's name. Nothing here makes DOM; nothing is resolved,
 * joined across the non-collapse boundary, or inferred. */
import { sameRepo } from './repo-moves.mjs';

const list = value => Array.isArray(value) ? value : [];
const text = value => typeof value === 'string' && value ? value : null;
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
 * the roster's own module rows; moved = the kernel reported drift. "Used by" before the kernel
 * reported each soul's composition (souls-capabilities); soulsUsing is the rule with it. */
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
/** The CLI feature under which every `oats souls` row reports its composed capabilities
 * (deployment-data.mjs soulCapabilitiesOf): "Used by" is then the souls whose composition includes
 * the capability, not only the souls whose live instances recorded it. */
export const SOULS_CAPABILITIES_FEATURE = 'souls-capabilities';
export const soulsComposition = cli => list(cli?.features).includes(SOULS_CAPABILITIES_FEATURE);
/** A soul's agent name in the roster (an instance's `agent`): a package soul's is the kernel's
 * `<package>--<soul>`, the package id with every character outside [a-z0-9-] as '-'
 * (lib/workspace.mjs packageSoulAgentName); every other soul's is its name. */
export function rosterAgentName(soul) {
  if (soul?.soulKind === 'package' && text(soul.package)) return `${soul.package.replace(/[^a-z0-9-]/g, '-')}--${soul.name}`;
  return soul?.name;
}
/** Whether a soul's composition entry is this catalog row: the same name, kind and origin (the repository
 * for a member capability, the package for a package one). A repo-owned row matches the same way; an
 * external row never does (the kernel reports no external entry). */
export function composes(entry, row) {
  if (!entry || entry.name !== row?.name || entry.kind !== row.kind) return false;
  return row.kind === 'package' ? !!text(row.package) && entry.package === row.package : !!text(row.repoKey) && sameRepo(entry.repoKey, row.repoKey);
}
/** The souls (the `oats souls` rows the Souls tab shows) whose composition includes this row; a soul that
 * did not resolve (`capabilities: null`) is never counted. */
export function soulsUsing(souls, row) {
  return list(souls).filter(soul => Array.isArray(soul?.capabilities) && soul.capabilities.some(entry => composes(entry, row)));
}
/** The repository group a member or external capability sits in, as the Souls tab groups souls:
 * the workspace host's repository first, then the other members by name, then one "external"
 * group for every source outside the member repos (a package, never listed here, keeps its own).
 * `hostKey`: workspace status's workspace.key. */
export function capabilityGroup(row, names = new Map(), hostKey = null) {
  const source = capabilitySource(row, names);
  // A package group (the Packages section) names its pinned version: "package · v1.2.0".
  if (source.kind === 'package') return { key: source.key, rank: 3, icon: 'package', name: source.label, note: ['package', text(row.version) ? `v${row.version}` : null].filter(Boolean).join(' · '), mono: true };
  if (source.kind !== 'member') return { key: 'external', rank: 2, icon: 'external', name: 'external', note: 'not in a member repo', mono: false };
  const host = !!hostKey && sameRepo(row.repoKey, hostKey);
  return { key: source.key, rank: host ? 0 : 1, icon: 'repo', name: source.label, note: host ? 'member repo · host' : 'member repo', mono: true };
}
/** Rows in their repository groups, in the Souls tab's order: [{ key, rank, icon, name, note, mono, rows }]. */
export function groupCapabilities(rows, names = new Map(), hostKey = null) {
  const groups = new Map();
  for (const row of list(rows)) {
    const group = capabilityGroup(row, names, hostKey);
    if (!groups.has(group.key)) groups.set(group.key, { ...group, rows: [] });
    groups.get(group.key).rows.push(row);
  }
  return [...groups.values()].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
}
/** The workspace host's repository key, from workspace status (null when not reported). */
export const hostKeyOf = status => text(status?.workspace?.key);
/** The view search: capability names containing the query, case-insensitive. */
export function matchCapabilities(rows, query = '') {
  const needle = String(query || '').trim().toLowerCase();
  return needle ? list(rows).filter(row => String(row.name).toLowerCase().includes(needle)) : list(rows);
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
const LAYERS = { knowledge: 'Knowledge', messaging: 'Messaging', tasks: 'Tasks' };
/** A core capability's name in the UI (Knowledge, Messaging, Tasks), else the layer verbatim. */
export const layerLabel = layer => LAYERS[layer] || layer;

/** An instance's recorded module row for a capability (its `modules`, a list or a map by name), or null. */
function moduleRow(instance, name) {
  const rows = Array.isArray(instance.modules) ? instance.modules : Object.entries(instance.modules || {}).map(([key, row]) => ({ name: key, ...row }));
  return rows.find(m => m?.name === name) || null;
}
/** "Used by" (the capability page's table): with `composition` (souls-capabilities) the souls whose composition
 * includes the row (soulsUsing), before it the souls whose instances carry it (capabilityUse). Each with
 * `carrying`, its instances that carry the module (the roster's agent name, a package soul's being
 * `<package>--<soul>`, within the soul's agents root), and `behind`, how many of those report it moved. */
export function capabilityUsers(row, { souls, instances, composition } = {}) {
  const users = composition ? soulsUsing(souls, row) : capabilityUse(instances, row.name).souls;
  return users.map(soul => {
    const agent = composition ? rosterAgentName(soul) : soul.name;
    const carrying = list(instances).filter(i => i.agent === agent && i.agentsRoot === soul.agentsRoot && moduleRow(i, row.name));
    const behind = carrying.filter(i => moduleRow(i, row.name)?.status === 'moved').length;
    return { soul, carrying, behind };
  });
}
