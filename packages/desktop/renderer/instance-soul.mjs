/** The Soul tab of the terminal-side context panel (Workspace v4 W6): the soul
 * as THIS instance was spawned from it — its core capabilities with why each
 * is the soul's, then every other capability with its source and why it is
 * there. The context panel stays IO-free: this section is injected like the
 * Teams section and owns one read, `oats inspect --home` (the as-spawned
 * resolution). Every await carries the selection identity, the workspace
 * generation and a serial, checked on success and rejection. */
import { inspectData, inspectSupported } from './inspect-contract.mjs';
import { cliStatus } from './views/cli-status.mjs';
import { createSoulMark } from './identity-marks.mjs';
import { iconElement } from './shell-icons.mjs';
import { soulTeams } from './teams-panel.mjs';
import { memberLabel } from './deployment-facts.mjs';
import { compositionEntries, coreWhy, whyTag, desktopFacts } from './capability-page.mjs';
import { layerLabel } from './workspace-catalog.mjs';

export const instanceSoulCSS = `
#context-panel .soul-tab { display:flex; flex-direction:column; gap:20px; min-width:0; }
#context-panel .soul-tab-head { display:flex; align-items:center; gap:10px; min-width:0; }
#context-panel .soul-tab-head .identity-mark { width:36px; height:36px; border-radius:9px; font-size:15px; font-weight:700; }
#context-panel .soul-tab-id { display:flex; flex-direction:column; min-width:0; }
#context-panel .soul-tab-name { color:var(--fg); font-size:13.5px; font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
#context-panel .soul-tab-meta { color:var(--muted); font:11.5px ui-monospace, Menlo, monospace; overflow-wrap:anywhere; }
#context-panel .soul-tab-section { display:flex; flex-direction:column; gap:8px; min-width:0; }
#context-panel .soul-tab-core { border:1px solid var(--border); border-radius:8px; overflow:hidden; }
#context-panel .soul-tab-core-row { display:grid; grid-template-columns:88px minmax(0,1fr); gap:10px; align-items:center; min-height:48px; padding:8px 12px; box-sizing:border-box; }
#context-panel .soul-tab-core-row + .soul-tab-core-row { border-top:1px solid var(--tag-bg); }
#context-panel .soul-tab-slot { color:var(--fg); font-size:12.5px; font-weight:650; }
#context-panel .soul-tab-provider { display:flex; flex-direction:column; gap:2px; min-width:0; }
#context-panel .soul-tab-source { display:flex; align-items:center; gap:6px; min-width:0; color:var(--fg); font:12px ui-monospace, Menlo, monospace; }
#context-panel .soul-tab-source .shell-icon { flex:none; color:var(--muted); }
#context-panel .soul-tab-source > span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
#context-panel .soul-tab-version { flex:none; color:var(--muted); }
#context-panel .soul-tab-why { color:var(--muted); font-size:11.5px; }
#context-panel .soul-tab-none { color:var(--muted); font-size:12px; }
#context-panel .soul-tab-caps { display:flex; flex-direction:column; min-width:0; }
#context-panel .soul-tab-cap { display:flex; flex-direction:column; gap:3px; padding:9px 0; border-top:1px solid var(--tag-bg); min-width:0; }
#context-panel .soul-tab-cap:first-child { border-top:0; padding-top:2px; }
#context-panel .soul-tab-cap-head { display:flex; align-items:center; gap:8px; min-width:0; }
#context-panel .soul-tab-cap-name { min-width:0; color:var(--fg); font:650 12.5px ui-monospace, Menlo, monospace; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
#context-panel .soul-tab-cap .soul-tab-source { color:var(--muted); font-size:11.5px; }
#context-panel .soul-tab-cap .soul-tab-source .soul-tab-version { color:var(--muted); }
#context-panel .soul-tab-cap.off .soul-tab-cap-name { color:var(--muted); text-decoration:line-through; }
#context-panel .soul-tab-tag { flex:none; margin-left:auto; height:18px; display:inline-flex; align-items:center; padding:0 6px; border-radius:4px; background:var(--tag-bg); color:var(--fg); font-size:10.5px; font-weight:600; white-space:nowrap; }
#context-panel .soul-tab-tag.soul { background:var(--primary-bg); color:var(--primary-fg); }
#context-panel .soul-tab-tag.off { background:transparent; color:var(--muted); font-weight:500; }
`;

const list = v => Array.isArray(v) ? v : [];
const text = v => typeof v === 'string' && v ? v : null;
// Core capabilities name their origin only when the CLI advertises layers-from.
const layersFrom = cli => list(cli?.features).includes('layers-from');

export function createInstanceSoulSection(host, { request, generation = () => 0, onPresence = () => {}, cli = cliStatus } = {}) {
  const doc = host.ownerDocument;
  let identity = null, serial = 0, disposed = false, attempted = null, view = null;
  const node = (tag, value, cls) => { const el = doc.createElement(tag); if (value !== undefined && value !== null) el.textContent = value; if (cls) el.className = cls; return el; };
  const clear = () => { view?.remove(); view = null; onPresence(false); };
  async function load(workspace, instance, id) {
    const ticket = ++serial, gen = generation();
    const owns = () => !disposed && ticket === serial && identity === id && generation() === gen;
    const selector = { home: instance.home };
    let inspected = null;
    try { inspected = inspectData(await request(workspace, { action: 'inspect', selector }), { instance, selector }); } catch { inspected = null; }
    if (!owns()) return;
    const soul = inspected?.souls?.[0];
    // An inspection this Desktop cannot read, or one without the soul: the panel's own header stands.
    if (!soul) return;
    view = render(inspected, soul, instance);
    host.prepend(view); onPresence(true);
  }
  function source(cap, { repoOwned = false } = {}) {
    const from = cap?.from && typeof cap.from === 'object' ? cap.from : {};
    const line = node('span', undefined, 'soul-tab-source');
    const icon = from.kind === 'package' ? 'package' : repoOwned ? 'home' : 'repo';
    const name = from.kind === 'package' ? text(from.package) : text(from.repoKey) ? memberLabel(from.repoKey) : null;
    const version = from.kind === 'package' ? text(from.version) || text(cap.version) : from.kind === 'member' ? 'latest' : null;
    line.append(iconElement(doc, icon, { size: 13 }), node('span', name || cap.id));
    if (version) line.append(node('span', version, 'soul-tab-version'));
    line.title = [name, version].filter(Boolean).join(' ');
    return line;
  }
  function render(inspected, soul, instance) {
    const root = node('div', undefined, 'soul-tab');
    // Header: the soul, its repository and the teams it has access to.
    const head = node('div', undefined, 'soul-tab-head'), id = node('div', undefined, 'soul-tab-id');
    head.append(createSoulMark(doc, { name: soul.name, agentsRoot: instance.agentsRoot }));
    id.append(node('span', soul.name, 'soul-tab-name'));
    const teams = (soulTeams(inspected.teams) || []).filter(t => t.mapped).map(t => t.label);
    const meta = [text(soul.repoKey) ? memberLabel(soul.repoKey) : null, teams.join(', ') || null].filter(Boolean).join(' · ');
    if (meta) id.append(node('span', meta, 'soul-tab-meta'));
    head.append(id); root.append(head);
    // Core capabilities: one row per slot, its provider and why.
    const core = node('section', undefined, 'soul-tab-section');
    core.append(node('div', 'Core capabilities', 'context-panel-label'));
    const table = node('div', undefined, 'soul-tab-core');
    for (const slot of ['knowledge', 'messaging', 'tasks']) {
      const layer = inspected.layers?.[slot], cap = layer?.id ? inspected.capabilities.find(c => c.id === layer.id) : null;
      const row = node('div', undefined, 'soul-tab-core-row'); row.dataset.layer = slot;
      const provider = node('div', undefined, 'soul-tab-provider');
      if (layer?.id) {
        provider.append(cap ? source(cap) : node('span', layer.id, 'soul-tab-source'));
        const why = layersFrom(cli()) ? coreWhy(layer.from) : null;
        if (why) provider.append(node('span', why, 'soul-tab-why'));
      } else provider.append(node('span', layer ? 'None' : 'Not reported', 'soul-tab-none'));
      row.append(node('span', layerLabel(slot), 'soul-tab-slot'), provider);
      table.append(row);
    }
    core.append(table); root.append(core);
    // Every other capability: source and why it is here.
    const entries = compositionEntries(inspected, soul, { facts: desktopFacts(cli()) });
    const caps = node('section', undefined, 'soul-tab-section');
    caps.append(node('div', 'Capabilities', 'context-panel-label'));
    const rows = node('div', undefined, 'soul-tab-caps');
    for (const entry of entries) {
      const off = entry.why === 'off', name = off ? entry.name : entry.cap.id;
      const row = node('div', undefined, `soul-tab-cap${off ? ' off' : ''}`); row.dataset.capability = name;
      const top = node('div', undefined, 'soul-tab-cap-head');
      const label = node('span', name, 'soul-tab-cap-name'); label.title = name; top.append(label);
      const [tag, title] = whyTag(entry), el = node('span', tag, `soul-tab-tag${off ? ' off' : entry.why === 'soul' ? ' soul' : ''}`); el.title = title; top.append(el);
      row.append(top);
      if (!off) row.append(source(entry.cap, { repoOwned: entry.repoOwned }));
      rows.append(row);
    }
    if (!entries.length) rows.append(node('p', 'No other capabilities: only the core ones.', 'context-panel-note'));
    caps.append(rows); root.append(caps);
    return root;
  }
  return {
    /** active: the Soul tab is the visible page. One read per selection; a new selection resets. */
    update({ active, workspace, instance } = {}) {
      if (disposed) return;
      const id = instance?.home && !instance.server ? JSON.stringify([workspace, instance.home]) : null;
      if (id !== identity) { identity = id; attempted = null; serial++; clear(); }
      if (!active || !id || attempted === id || !inspectSupported(cli())) return;
      attempted = id;
      void load(workspace, instance, id);
    },
    dispose() { disposed = true; serial++; clear(); },
  };
}
