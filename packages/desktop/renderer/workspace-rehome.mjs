/** Re-homing per-workspace renderer state onto workspace views (#482). Nothing saved is dropped.
 *
 * Before views, a selection, the per-workspace tab memory, the active-terminal memory, open tabs
 * (terminal keys `term:<ws>:<instance id>`, view/file keys `JSON.stringify([ws, key])`) and stored
 * spawn jobs were keyed by a DEPLOYMENT id: a local path, or `remote:<server>:<targetKey>`. A view
 * that matches a workspace identity has its own id (`ws:…`), so state under one of its deployment ids
 * moves to that view id. Deployments can also change view while the app runs: an unattached
 * deployment (whose view id IS its deployment id) gets matched; a remote reports another workspace.
 * The same rule covers all of them: state goes to the view that now holds its deployment.
 *
 * A deployment that never reports keeps its own view, whose id is its deployment id: nothing moves.
 * A served view id never moves. Pure: the shell applies the result (shell.mjs `rehomeWorkspaceState`).
 */

const text = v => typeof v === 'string' && v.length > 0;

/** Remembers which deployments each view held, so a view id that is no longer served can still be
 * followed to the view that holds its deployments now (session memory only). */
export function createViewMembership() {
  const held = new Map(); // view id -> Set(deployment id)
  const names = new Map(); // view id -> its last served name
  return {
    note(workspaces) {
      for (const w of Array.isArray(workspaces) ? workspaces : []) {
        if (!text(w?.id) || !Array.isArray(w.deployments)) continue;
        held.set(w.id, new Set(w.deployments.filter(text)));
        if (text(w.name)) names.set(w.id, w.name);
      }
    },
    get: id => held.get(id) || null,
    name: id => names.get(id) || null,
    entries: () => [...held.entries()],
  };
}

/**
 * `Map<old id, view id>` for the served views (`panel.workspaces`):
 * - every deployment id a served view holds, when it is not that view's own id;
 * - a view id the server no longer serves whose remembered deployments (`membership`) are now all
 *   held by ONE served view (split across views, it maps nowhere: its rows' tabs follow their own
 *   deployments, see `tabTarget`).
 * Served view ids are never keys.
 */
export function rehomeMap(workspaces, membership = null) {
  const served = (Array.isArray(workspaces) ? workspaces : []).filter(w => text(w?.id));
  const ids = new Set(served.map(w => w.id));
  const holder = new Map(); // deployment id -> view id
  for (const w of served) for (const d of Array.isArray(w.deployments) ? w.deployments : []) if (text(d) && !holder.has(d)) holder.set(d, w.id);
  const map = new Map();
  for (const [d, view] of holder) if (d !== view && !ids.has(d)) map.set(d, view);
  for (const [old, deployments] of membership?.entries() || []) {
    if (ids.has(old) || map.has(old)) continue;
    const now = new Set([...deployments].map(d => holder.get(d)).filter(Boolean));
    if (now.size === 1) map.set(old, [...now][0]);
  }
  return map;
}

/** The view that holds a deployment id now, or null. */
export function holderOf(workspaces, deploymentId) {
  for (const w of Array.isArray(workspaces) ? workspaces : []) {
    if (text(w?.id) && Array.isArray(w.deployments) && w.deployments.includes(deploymentId)) return w.id;
  }
  return null;
}

/** Where one open tab belongs now, or null when it stays: its workspace's mapped view, else (a
 * terminal) the view holding its instance's deployment when that is another served view. */
export function tabTarget(tab, map, workspaces) {
  if (!tab || !text(tab.workspace)) return null;
  const mapped = map.get(tab.workspace);
  if (mapped) return mapped;
  const deployment = tab.kind === 'terminal' ? tab.instanceRef?.deployment?.id : null;
  if (!text(deployment)) return null;
  const holder = holderOf(workspaces, deployment);
  return holder && holder !== tab.workspace ? holder : null;
}

/** A tab key under another workspace: `term:<from>:<id>` and `JSON.stringify([from, key])` move to
 * `to`; any other key is kept as it is. */
export function rehomeKey(key, from, to) {
  if (!text(key)) return key;
  const term = `term:${from}:`;
  if (key.startsWith(term)) return `term:${to}:${key.slice(term.length)}`;
  if (key.startsWith('[')) {
    try {
      const parsed = JSON.parse(key);
      if (Array.isArray(parsed) && parsed.length === 2 && parsed[0] === from) return JSON.stringify([to, parsed[1]]);
    } catch { /* not a view key */ }
  }
  return key;
}

/** Move open tabs (the shell's `Map<id, tab>`, mutated in place): `workspace` and `key` together.
 * Returns the moves `[{ id, from, to, fromKey, key }]`. */
export function rehomeTabs(tabs, map, workspaces) {
  const moves = [];
  for (const [id, tab] of tabs) {
    const to = tabTarget(tab, map, workspaces);
    if (!to || to === tab.workspace) continue;
    const from = tab.workspace, fromKey = tab.key;
    tab.workspace = to;
    tab.key = rehomeKey(tab.key, from, to);
    moves.push({ id, from, to, fromKey, key: tab.key });
  }
  return moves;
}

/** The active-terminal memory (`Map<ws, terminal key>`), mutated in place: an entry under a mapped
 * id moves with its key re-homed, and an entry naming a moved tab follows that tab; an entry the
 * view already has is kept (the newer memory). */
export function rehomeActiveTerminals(memory, map, moves = []) {
  for (const [from, key] of [...memory]) {
    const moved = moves.find(m => m.from === from && m.fromKey === key);
    const to = map.get(from) || moved?.to;
    if (!to) continue;
    memory.delete(from);
    if (!memory.has(to)) memory.set(to, moved ? moved.key : rehomeKey(key, from, to));
  }
  return memory;
}

/** Collapse keys `${ws}\0${instance}` (instance-tree.mjs collapseKey), a Set mutated in place. */
export function rehomeCollapsed(set, map) {
  for (const key of [...set]) {
    const at = key.indexOf('\u0000');
    if (at < 0) continue;
    const to = map.get(key.slice(0, at));
    if (!to) continue;
    set.delete(key); set.add(`${to}${key.slice(at)}`);
  }
  return set;
}
