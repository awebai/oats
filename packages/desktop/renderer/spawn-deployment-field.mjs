/** The spawn dialog's Deployment field (#482, decision Q2): which of the view's deployments the new
 * instance is spawned in. Shown only when the view has two or more deployments; with one, there is
 * no field and nothing changes (the dialog addresses that deployment).
 *
 * - Each option is the deployment's label (deploymentLabel: "This Mac · ~/Agents/oats",
 *   "altair · ~/Agents/tsm": remote ones are named by their machine).
 * - Availability is the CHOSEN deployment's own spawn catalog (`/api/agents?ws=<deployment id>`;
 *   a remote deployment's catalog is its roster group's, answered by the server). A deployment
 *   without the soul stays selectable, marked "no <soul> here" ("not reached" when it is not
 *   reachable); choosing it blocks Spawn with "<soul> isn't available on <machine>".
 * - The default: the deployment last used in this view, if it has the soul; else the first that
 *   has it, local before remote; else the last used (blocked, saying why); with nothing used yet,
 *   the first local deployment, else the first. Until the catalogs answer the field shows that
 *   provisional choice and the dialog does not read a preview (`pending()`); an untouched field then
 *   moves to the rule's choice.
 * - "Last used" is kept per view in localStorage (`SPAWN_DEPLOYMENT_KEY`): only deployment ids, at
 *   most `SPAWN_DEPLOYMENT_VIEWS_MAX` views, the most recent kept. It is recorded on a successful
 *   spawn only (`rememberSpawnDeployment`).
 *
 * The catalog reads carry a latest-intent token: a reply after dispose() or a newer read is dropped. */
import { apiJson } from './views/common.mjs';
import { deploymentLabel, THIS_MACHINE } from './deployment-label.mjs';

export const SPAWN_DEPLOYMENT_KEY = 'oats.desktop.spawnDeployment';
export const SPAWN_DEPLOYMENT_VIEWS_MAX = 32;
const ID_MAX = 4096;
const validId = v => typeof v === 'string' && v.length > 0 && v.length <= ID_MAX && !/[\x00-\x1f\x7f]/.test(v);
const text = v => typeof v === 'string' && v ? v : null;
const defaultStorage = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };

function readMap(storage) {
  try {
    const value = JSON.parse(storage?.getItem(SPAWN_DEPLOYMENT_KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}
/** The deployment last used for a spawn in this view, or null. */
export function lastSpawnDeployment(viewId, storage = defaultStorage()) {
  if (!validId(viewId)) return null;
  const value = readMap(storage)[viewId];
  return validId(value) ? value : null;
}
/** Record a successful spawn's deployment for its view (bounded: the most recent views only). */
export function rememberSpawnDeployment(viewId, deploymentId, storage = defaultStorage()) {
  if (!storage || !validId(viewId) || !validId(deploymentId)) return;
  const map = readMap(storage);
  delete map[viewId]; map[viewId] = deploymentId; // insertion order: the most recent last
  const kept = Object.entries(map).filter(([k, v]) => validId(k) && validId(v)).slice(-SPAWN_DEPLOYMENT_VIEWS_MAX);
  try { storage.setItem(SPAWN_DEPLOYMENT_KEY, JSON.stringify(Object.fromEntries(kept))); } catch { /* storage is a convenience */ }
}

/** The panel's deployments, kept as far as they validate (labels enter the DOM as text only). */
export function spawnDeployments(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).filter(d => d && typeof d === 'object' && validId(d.id) && !seen.has(d.id) && seen.add(d.id));
}

/** The soul's row in another deployment's catalog: the same name and root, else the one row of that
 * name, else the one of that name from the same repository and kind. Null when absent or ambiguous. */
export function catalogSoul(agents, soul) {
  const named = (Array.isArray(agents) ? agents : []).filter(a => a && a.name === soul?.name && typeof a.agentsRoot === 'string' && a.agentsRoot);
  const exact = named.filter(a => a.agentsRoot === soul.agentsRoot);
  if (exact.length === 1) return exact[0];
  if (named.length === 1) return named[0];
  const same = named.filter(a => (a.repoName || '') === (soul.repoName || '') && (a.soulKind || '') === (soul.soulKind || ''));
  return same.length === 1 ? same[0] : null;
}

/** The default deployment (decision Q2). `has(id)`: true, false, or null while unknown. */
export function defaultSpawnDeployment(deployments, { has = () => null, lastUsed = null } = {}) {
  const ids = deployments.map(d => d.id);
  const last = ids.includes(lastUsed) ? lastUsed : null;
  if (last && has(last) === true) return last;
  const local = deployments.filter(d => d.local === true), remote = deployments.filter(d => d.local !== true);
  const holder = [...local, ...remote].find(d => has(d.id) === true);
  if (holder) return holder.id;
  return last ?? (local[0] ?? deployments[0])?.id ?? null;
}

/** A remote deployment's server: its catalog row's, else the id's (`remote:<server>:<targetKey>`). */
const serverOf = (deployment, row) => {
  if (deployment.local === true) return '';
  if (text(row?.server)) return row.server;
  const m = /^remote:([a-z0-9][a-z0-9-]{0,63}):/.exec(deployment.id);
  return m ? m[1] : '';
};

/**
 * @param doc  the dialog's document
 * @param opts ctx (apiJson), soul (the dialog's soul), viewId, deployments (the panel's list),
 *             preferred (a deployment id to choose first, e.g. Reopen spawn's), storage (localStorage),
 *             onChange({ moved, programmatic }) — the choice or its availability changed,
 *             read(id) — optional: the catalog's agents (default: GET /api/agents?ws=<id>).
 * @returns null with fewer than two deployments; else the field.
 */
export function createSpawnDeploymentField(doc, { ctx, soul, viewId, deployments, preferred = null, storage = defaultStorage(), onChange = () => {}, read = null }) {
  const list = spawnDeployments(deployments);
  if (list.length < 2) return null;
  const el = (tag, value, cls) => { const node = doc.createElement(tag); if (value !== undefined) node.textContent = value; if (cls) node.className = cls; return node; };
  const readCatalog = read || (id => apiJson(ctx, `/api/agents?ws=${encodeURIComponent(id)}`).then(d => d?.agents));
  // Per deployment: { state: 'pending' | 'ok' | 'failed', row } (the soul's catalog row, or null).
  const catalogs = new Map(list.map(d => [d.id, { state: 'pending', row: null }]));
  const lastUsed = validId(preferred) && catalogs.has(preferred) ? preferred : lastSpawnDeployment(viewId, storage);
  let alive = true, serial = 0, touched = validId(preferred) && catalogs.has(preferred);
  const field = el('div', undefined, 'spawn-field spawn-deployment');
  const row = el('div', undefined, 'spawn-row'), label = el('label');
  label.append(el('span', 'Deployment', 'spawn-label-text'));
  const select = el('select', undefined, 'field fdeployment');
  const hint = el('p', '', 'spawn-hint spawn-deployment-hint'); hint.id = 'spawn-deployment-hint';
  // A native select (its own keyboard), named like Where to run; the hint says why Spawn is blocked.
  select.setAttribute('aria-label', 'Deployment'); select.setAttribute('aria-describedby', hint.id);
  for (const d of list) { const option = el('option', deploymentLabel(d)); option.value = d.id; select.append(option); }
  label.append(select); row.append(label); field.append(row, hint);

  const deployment = () => list.find(d => d.id === select.value) || list[0];
  const machine = d => text(d.machine) ?? THIS_MACHINE;
  /** Whether a deployment offers the soul: true, false, or null while unknown (its catalog is still read, or failed). */
  const has = id => {
    const c = catalogs.get(id), d = list.find(x => x.id === id);
    if (c?.state === 'ok') return !!c.row;
    // A deployment that is not reached has no catalog to offer (the server answers none): not available.
    return d?.reachable === false ? false : null;
  };
  function paint() {
    for (const option of select.options) {
      const d = list.find(x => x.id === option.value), available = has(d.id);
      const mark = available !== false ? '' : d.reachable === false ? ' (not reached)' : ` (no ${soul.name} here)`;
      const next = `${deploymentLabel(d)}${mark}`;
      if (option.textContent !== next) option.textContent = next;
    }
    const blockedNow = api.blocked();
    hint.classList.toggle('err', blockedNow);
    const said = blockedNow ? `${api.blockText()}.` : '';
    if (hint.textContent !== said) hint.textContent = said;
  }
  function choose(id, programmatic) {
    const before = select.value;
    if (id && id !== before) select.value = id;
    paint();
    return select.value !== before || !programmatic;
  }
  select.value = defaultSpawnDeployment(list, { has, lastUsed }) ?? list[0].id;
  select.addEventListener('change', () => { if (!alive) return; touched = true; paint(); onChange({ moved: true, programmatic: false }); });

  const api = {
    element: field, select, hint,
    /** The chosen deployment's id: every spawn request of the dialog addresses it. */
    value: () => deployment().id,
    deployment,
    /** The chosen deployment's server ('' for a local one): a remote deployment spawns through it. */
    server: () => serverOf(deployment(), catalogs.get(deployment().id)?.row),
    /** The selector for the chosen deployment: its catalog's row for the soul (the root differs per deployment). */
    selector: () => { const r = catalogs.get(deployment().id)?.row; return { soul: soul.name, agentsRoot: r?.agentsRoot ?? soul.agentsRoot }; },
    /** Some catalog is still being read and the operator has not chosen: the default may still move. */
    pending: () => !touched && [...catalogs.values()].some(c => c.state === 'pending'),
    /** The chosen deployment does not offer the soul: Spawn is blocked. */
    blocked: () => has(deployment().id) === false,
    blockText: () => `${soul.name} isn't available on ${machine(deployment())}`,
    /** Read every deployment's catalog (latest intent: a reply after dispose or a newer start is dropped). */
    start() {
      const ticket = ++serial;
      for (const d of list) {
        catalogs.set(d.id, { state: 'pending', row: null });
        Promise.resolve().then(() => readCatalog(d.id)).then(agents => ({ state: Array.isArray(agents) ? 'ok' : 'failed', row: Array.isArray(agents) ? catalogSoul(agents, soul) : null }),
          () => ({ state: 'failed', row: null })).then(result => {
          if (!alive || ticket !== serial) return;
          catalogs.set(d.id, result);
          const settledAll = ![...catalogs.values()].some(c => c.state === 'pending');
          // An untouched field moves to the rule's choice once every catalog answered.
          const moved = settledAll && !touched ? choose(defaultSpawnDeployment(list, { has, lastUsed }), true) : (paint(), false);
          if (settledAll || moved) onChange({ moved, programmatic: true });
        });
      }
      paint();
    },
    /** A successful spawn: this view's last-used deployment is now the chosen one. */
    remember: () => rememberSpawnDeployment(viewId, deployment().id, storage),
    dispose() { alive = false; serial++; },
  };
  paint();
  return api;
}
