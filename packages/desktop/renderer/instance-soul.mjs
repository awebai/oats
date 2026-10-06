/** The Soul tab of the terminal-side context panel (Workspace v4 W6): the soul
 * as THIS instance was spawned from it — its core capabilities with why each
 * is the soul's, then every other capability with its source and why it is
 * there. The context panel stays IO-free: this section is injected like the
 * Teams section and owns one read, `oats inspect --home` (the as-spawned
 * resolution). Every await carries the selection identity, the workspace
 * generation and a serial, checked on success and rejection.
 *
 * An instance on a registered server is read through the same route, by its
 * deployment, server and home (`oats inspect --server <id> --home <abs>`): a
 * row the kernel does not report addressable, or this computer's OATS without
 * remote operations, sends nothing and says why; a host's refusal is shown as
 * relayed (remote-address.mjs). */
import { inspectData, inspectSupported } from './inspect-contract.mjs';
import { cliStatus } from './views/cli-status.mjs';
import { iconElement } from './shell-icons.mjs';
import { soulTeams } from './teams-panel.mjs';
import { memberLabel } from './deployment-facts.mjs';
import { compositionEntries, coreEntries, coreNote, whyTag, desktopFacts } from './capability-page.mjs';
import { layerLabel } from './workspace-catalog.mjs';
import { createDataState, statusLine, captureFocusState } from './loading.mjs';
import { instanceStatusIdentity } from './instance-status-identity.mjs';
import { readingFrom, relayedFailure, remoteInspectBlock, serverLabel } from './remote-address.mjs';

export const instanceSoulCSS = `
#context-panel .soul-tab { display:flex; flex-direction:column; gap:20px; min-width:0; }
/* The section body sits under the roster-derived header (context-panel.mjs), which stays put: the
   soul's repository and teams are one muted line, then the sections (desktop/loading-states item 8). */
#context-panel .context-panel-soul-body { display:flex; flex-direction:column; gap:20px; min-width:0; }
#context-panel .context-panel-soul-body:empty { display:none; }
#context-panel .soul-tab-notice:empty { display:none; }
#context-panel .soul-tab-notice .loading-notice { margin:0; }
#context-panel .soul-tab-meta { color:var(--muted); font:11.5px ui-monospace, Menlo, monospace; overflow-wrap:anywhere; }
/* Pending: the sections' shapes, wearing the real row classes (their heights are the rules above). */
#context-panel .soul-tab-skeleton .context-panel-label.skeleton { height:10px; width:38%; }
#context-panel .soul-tab-skeleton .soul-tab-slot.skeleton { height:12px; width:70%; }
#context-panel .soul-tab-skeleton .soul-tab-source.skeleton { height:12px; width:60%; }
#context-panel .soul-tab-skeleton .soul-tab-cap-name.skeleton { height:14px; width:55%; }
#context-panel .soul-tab-skeleton .soul-tab-cap > .skeleton-line { height:14px; width:40%; } /* a 12px source line box */
#context-panel .soul-tab-skeleton .skeleton-tag { flex:none; width:3.2em; height:18px; margin-left:auto; border-radius:4px; }
#context-panel .soul-tab-section { display:flex; flex-direction:column; gap:8px; min-width:0; }
#context-panel .soul-tab-core { border:1px solid var(--border); border-radius:9px; overflow:hidden; }
#context-panel .soul-tab-core-row { display:grid; grid-template-columns:88px minmax(0,1fr); gap:10px; align-items:center; min-height:48px; padding:8px 12px; box-sizing:border-box; }
#context-panel .soul-tab-core-row + .soul-tab-core-row { border-top:1px solid var(--border); }
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

/** `host` is the section's own body under the roster-derived header (context-panel.mjs keeps the header;
 * nothing is prepended above it). The loading controller paints the skeleton, the stale line and the
 * failed block in it; `onPresence(true)` says the body shows something (content, or a visible failure). */
export function createInstanceSoulSection(host, { request, generation = () => 0, onPresence = () => {}, cli = cliStatus } = {}) {
  const doc = host.ownerDocument, win = doc.defaultView;
  let identity = null, statusId = null, serial = 0, disposed = false, attempted = null, painted = null, current = null;
  const node = (tag, value, cls) => { const el = doc.createElement(tag); if (value !== undefined && value !== null) el.textContent = value; if (cls) el.className = cls; return el; };
  const status = statusLine(doc, { visuallyHidden: true, className: 'soul-tab-status' });
  const notice = node('div', undefined, 'soul-tab-notice'), content = node('div', undefined, 'soul-tab-content');
  host.append(status, notice, content);
  host.tabIndex = -1; // the focus fallback below: a focused Retry whose line or block leaves on success lands here, never on <body>
  const loading = createDataState({ doc, noun: 'soul', region: host, skeletonHost: host, failedHost: host, skeleton: () => skeletonBody(), status,
    indicatorHost: notice, noticeHost: notice, onRetry: () => { if (current && identity) void load(current.workspace, current.instance, identity, { user: true }); },
    focusFallback: host,
    setTimeout: (fn, ms) => win.setTimeout(fn, ms), clearTimeout: id => win.clearTimeout(id) });
  const clear = () => { content.replaceChildren(); painted = null; loading.reset(); onPresence(false); };
  async function load(workspace, instance, id, { user = false } = {}) {
    const ticket = ++serial, gen = generation();
    const owns = () => !disposed && ticket === serial && identity === id && generation() === gen;
    const selector = { home: instance.home };
    // A remote row that can't be routed from here: nothing is sent (Retry included), the reason is the body.
    const blocked = remoteInspectBlock(instance, cli());
    if (blocked) { loading.fail(blocked); onPresence(true); return; }
    loading.begin({ user, ...(instance.server ? { message: readingFrom(serverLabel(instance)) } : {}) }); onPresence(true);
    let result;
    try { result = await request(workspace, { action: 'inspect', selector, ...(user ? { refresh: true } : {}) }); }
    catch (error) {
      // Visible: stale with content (the line and Retry), the failed block without — never silence.
      // A host's refusal shows as relayed (its headline; the code and its message under Details).
      if (owns()) loading.fail(instance.server ? relayedFailure(error, serverLabel(instance), 'soul') : error);
      return;
    }
    if (!owns()) return;
    const inspected = inspectData(result, { instance, selector });
    if (!inspected) {
      loading.fail(new Error(result?.operationsApi === 1 ? 'This workspace still uses the classic layout, which answers an older inspection.'
        : 'The installed OATS CLI returned an inspection this Desktop cannot read. Update OATS and retry.'));
      return;
    }
    const soul = inspected.souls?.[0];
    loading.succeed({ observedAt: typeof result?.observedAt === 'string' ? result.observedAt : null, empty: !soul });
    // An inspection without the soul: the roster-derived header above says what is known; nothing here.
    if (!soul) { content.replaceChildren(); painted = null; onPresence(false); return; }
    // An unchanged inspection is not repainted (focus stays); the read's own metadata is not content.
    const signature = JSON.stringify({ ...result, observedAt: undefined, refreshing: undefined });
    if (signature !== painted) {
      const restore = captureFocusState(host);
      content.replaceChildren(render(inspected, soul)); painted = signature; restore();
    }
    onPresence(true);
  }
  /** Pending: the body's shapes — a meta line, then the two sections with rows wearing the real classes. */
  function skeletonBody() {
    const bone = cls => { const el = node('span', undefined, `skeleton ${cls}`); el.setAttribute('aria-hidden', 'true'); return el; };
    const root = node('div', undefined, 'soul-tab soul-tab-skeleton'); root.setAttribute('aria-hidden', 'true'); root.dataset.skeleton = 'soul-tab';
    root.append(bone('skeleton-line soul-tab-meta'));
    const core = node('section', undefined, 'soul-tab-section'); core.append(bone('context-panel-label'));
    const table = node('div', undefined, 'soul-tab-core');
    for (let i = 0; i < 3; i++) { const row = node('div', undefined, 'soul-tab-core-row'); const provider = node('div', undefined, 'soul-tab-provider'); provider.append(bone('soul-tab-source')); row.append(bone('soul-tab-slot'), provider); table.append(row); }
    core.append(table); root.append(core);
    const caps = node('section', undefined, 'soul-tab-section'); caps.append(bone('context-panel-label'));
    const rows = node('div', undefined, 'soul-tab-caps');
    for (let i = 0; i < 3; i++) { const row = node('div', undefined, 'soul-tab-cap'); const top = node('div', undefined, 'soul-tab-cap-head'); top.append(bone('soul-tab-cap-name'), bone('skeleton-tag')); row.append(top, bone('skeleton-line')); rows.append(row); }
    caps.append(rows); root.append(caps);
    return root;
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
  function render(inspected, soul) {
    const root = node('div', undefined, 'soul-tab');
    // The soul's repository and the teams it has access to: one line under the roster-derived header
    // (which stays put: no header of its own, nothing prepended above).
    const teams = (soulTeams(inspected.teams) || []).filter(t => t.mapped).map(t => t.label);
    const meta = [text(soul.repoKey) ? memberLabel(soul.repoKey) : null, teams.join(', ') || null].filter(Boolean).join(' · ');
    if (meta) root.append(node('span', meta, 'soul-tab-meta'));
    // Core capabilities: one row per slot, its provider and why.
    const core = node('section', undefined, 'soul-tab-section');
    core.append(node('div', 'Core capabilities', 'context-panel-label'));
    const table = node('div', undefined, 'soul-tab-core');
    // Why, in the soul page's words (an instance's: "Resolved … at spawn"); a home reports no emptied slot.
    for (const entry of coreEntries(inspected, { layersFrom: layersFrom(cli()), facts: desktopFacts(cli()) })) {
      const row = node('div', undefined, 'soul-tab-core-row'); row.dataset.layer = entry.slot;
      const provider = node('div', undefined, 'soul-tab-provider');
      if (entry.id) {
        provider.append(entry.cap ? source(entry.cap) : node('span', entry.id, 'soul-tab-source'));
        const note = coreNote(entry, { spawned: true }); if (note) provider.append(node('span', note, 'soul-tab-why'));
      } else provider.append(node('span', entry.reported ? 'None' : 'Not reported', 'soul-tab-none'));
      row.append(node('span', layerLabel(entry.slot), 'soul-tab-slot'), provider);
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
    /** active: the Soul tab is the visible page. One read per selection, and one more whenever the
     * instance's status identity changes (a restart, drift, another soul source): a refresh that keeps
     * the content. A new selection resets. */
    update({ active, workspace, instance } = {}) {
      if (disposed) return;
      // A remote row's identity includes its server (the same home on two servers is two subjects).
      const id = !instance?.home ? null : instance.server ? JSON.stringify([workspace, instance.server, instance.home])
        : JSON.stringify([workspace, instance.home]);
      if (id !== identity) { identity = id; attempted = null; statusId = null; serial++; clear(); }
      current = id ? { workspace, instance } : null;
      if (!active || !id || !inspectSupported(cli())) return;
      const sid = instanceStatusIdentity(instance);
      if (attempted === id && sid === statusId) return;
      attempted = id; statusId = sid;
      void load(workspace, instance, id);
    },
    dispose() { disposed = true; serial++; clear(); loading.dispose(); },
  };
}
