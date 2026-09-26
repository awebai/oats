/** Workspace view header and its Capabilities / Setup (id: sources) tabs, natively on
 * workspace model v2. Facts come from the installed kernel only:
 *   - `oats workspace status` + `oats status` (the roster observation) for
 *     sources, lock state and which instances carry a module;
 *   - `oats capabilities` (POST /api/workspace-sync {action:"read"}) for the
 *     capability table.
 * Sync is the kernel's `oats sync` (workspace-sync-view.mjs); there is no
 * package approval. Souls stay the host view's own grid. */
import { postJson, wsQuery, workspaceGeneration } from './views/common.mjs';
import { cliStatus, cliKnownUnavailable } from './views/cli-status.mjs';
import { deploymentUnavailableText } from './deployment-header.mjs';
import { setupCSS, renderSetup } from './workspace-setup.mjs';
import { catalogCSS, renderCapabilitySections, capabilitySections, renderFilters, filterChoices, filterCapabilities, memberNames, deploymentNotes, syncCapabilityNav } from './workspace-catalog.mjs';
import { createWorkspaceSync, syncCSS, reasonText } from './workspace-sync-view.mjs';
import { iconElement } from './shell-icons.mjs';

export const workspaceTabs = ['souls', 'capabilities', 'sources'];
// What a person reads (the ids stay stable): Setup is what the workspace is built from (repos, packages, external souls).
const TAB_LABELS = { souls: 'Souls', capabilities: 'Capabilities', sources: 'Setup' };
export const discoveryCSS = `
${catalogCSS}
${setupCSS}
${syncCSS}
.workspace-header { height:var(--bar-h); min-height:48px; flex:none; display:flex; align-items:stretch; flex-wrap:nowrap; gap:22px; padding:0 16px; border-bottom:1px solid var(--border); background:var(--surface); box-sizing:border-box; }
.workspace-header[hidden] { display:none; }
.oats-view .workspace-header .field { min-height:28px; height:28px; padding:4px 8px; font-size:12px; }
.workspace-header h1 { display:flex; align-items:center; margin:0; flex:none; font-size:14px; font-weight:700; }
.workspace-tabs { display:flex; flex-wrap:nowrap; overflow-x:auto; gap:22px; min-width:0; scrollbar-width:none; }
.workspace-tabs button { flex:none; display:inline-flex; align-items:center; gap:6px; padding:0; border:0; border-radius:0; background:none; color:var(--muted); font:500 12.5px var(--sans,system-ui); cursor:pointer; }
.workspace-tabs button:hover { color:var(--fg); }
.workspace-tabs button[aria-selected=true] { color:var(--fg); font-weight:650; box-shadow:inset 0 -2px 0 var(--live); }
.workspace-tabs button:focus-visible { outline:2px solid var(--accent); outline-offset:-4px; border-radius:6px; }
.workspace-count { color:var(--muted); font:10.5px var(--mono,monospace); }
.workspace-count:empty { display:none; }
.workspace-sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
.workspace-attn { width:6px; height:6px; border-radius:50%; background:var(--attn-dot); }
.workspace-attn[hidden] { display:none; }
.workspace-tools { display:flex; align-items:center; gap:10px; margin-left:auto; min-width:0; flex:none; }
.workspace-tools[hidden] { display:none; }
.ws-segmented { display:inline-flex; height:28px; border:1px solid var(--border); border-radius:7px; overflow:hidden; flex:none; }
.oats-view .ws-segmented button { min-height:0; height:100%; padding:0 10px; border:0; border-radius:0; background:var(--surface); color:var(--muted); font:500 12px var(--sans,system-ui); cursor:pointer; }
.oats-view .ws-segmented button + button { border-left:1px solid var(--border); }
.oats-view .ws-segmented button[aria-pressed=true] { background:var(--chip-bg); color:var(--fg); font-weight:650; }
.oats-view .ws-segmented button:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }
/* A view's own toolbar (human, 2026-09-26): its search and controls sit in the view, not in the header. */
/* A view's toolbar row (human, 2026-09-26): the view's own top row on the left
   (section pills, first group heading), the search and view controls on the right. */
.ws-toolbar { display:flex; align-items:center; flex-wrap:wrap; justify-content:flex-end; gap:8px 10px; min-width:0; min-height:28px; margin:0 0 16px; }
.ws-toolbar[hidden] { display:none; }
.ws-toolbar-lead { flex:1 1 auto; min-width:0; display:flex; align-items:center; }
.ws-toolbar-lead .capability-nav { margin:0; }
.ws-toolbar-label { color:var(--muted); font-size:12px; }
.ws-search { position:relative; display:flex; align-items:center; min-width:0; flex:0 1 220px; }
.ws-search .shell-icon { position:absolute; left:10px; color:var(--muted); pointer-events:none; }
.oats-view .ws-search input.field { width:100%; min-width:0; height:28px; min-height:28px; padding:0 10px 0 30px; border:1px solid var(--border); border-radius:7px; background:var(--surface); font-size:12px; box-sizing:border-box; }
.workspace-discovery { padding:18px 20px; overflow:auto; min-width:0; flex:1; container-type:inline-size; }
/* Capabilities (W5) reads as one centred column. */
.workspace-discovery[data-tab=capabilities] { padding:16px 28px 20px; }
.workspace-discovery[data-tab=capabilities] > * { max-width:1000px; margin-inline:auto; }
.workspace-discovery[data-tab=sources] { padding:20px 24px; }
.workspace-discovery[hidden], .souls-bar[hidden] { display:none; }
.discovery-status { margin:0 0 14px; color:var(--muted); font-size:12px; line-height:1.5; overflow-wrap:anywhere; }
.discovery-status:empty { display:none; }
.discovery-status.error { color:var(--danger); }
.discovery-retry { margin:0 0 14px; }
.discovery-retry[hidden] { display:none; }
`;

const list = value => Array.isArray(value) ? value : [];
/** What on Setup needs attention, from workspace status only: members whose
 * handshake is not confirmed, a lock out of date, problems and warnings. */
export function setupAttention(status) {
  if (!status) return 0;
  return list(status.members).filter(member => member?.status !== 'confirmed').length
    + list(status.unsynced).length + list(status.stale).length + list(status.problems).length + list(status.warnings).length;
}

/** Why the catalog cannot be read right now (probe facts only). */
function gate(workspace, deployment) {
  const cli = cliStatus();
  if (!cli) return cliKnownUnavailable() ? 'The installed OATS CLI is unavailable. Check it and retry.' : 'Checking for a compatible OATS CLI…';
  if (!cli.ok) return 'The installed OATS CLI is unavailable. Check it and retry.';
  if (cli.workspaceApi !== 2 || !list(cli.features).includes('workspace-v2')) return 'The installed OATS CLI does not advertise workspace-v2. Update OATS and retry.';
  if (!workspace) return 'Waiting for the current workspace…';
  if (workspace.remote || workspace.server) return 'Remote workspaces are observed through their server; open the deployment on that machine to sync it.';
  if (deployment?.status !== 'observed') return deploymentUnavailableText(deployment);
  return '';
}

export function createWorkspaceDiscovery(header, panel, { ctx, soulsPanel, onTab, onIntent, onOpenCapability = null }) {
  const doc = header.ownerDocument;
  const node = (tag, text, cls) => { const el = doc.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
  let alive = true, serial = 0, rosterGen = null, workspace = null, deployment = null, instances = [], tab = 'souls';
  let catalog = null, loading = false, failure = '', filters = { team: null, repo: null }, rendered = null;
  let setupView = 'list', query = '', setupMember = null, souls = [];
  header.className = 'workspace-header';
  const title = node('h1', 'Workspace'); header.append(title);
  const tabs = node('div', undefined, 'workspace-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Workspace sections'); header.append(tabs);
  const controls = new Map(), counts = new Map();
  let attn = null, attnText = null;
  for (const name of workspaceTabs) {
    const control = node('button', TAB_LABELS[name]); control.type = 'button';
    control.id = `workspace-tab-${name}`; control.setAttribute('role', 'tab');
    const count = node('span', '', 'workspace-count'); control.append(count); counts.set(name, count);
    if (name === 'sources') {
      // Setup needs attention: a dot, and the same words for assistive tech.
      attn = node('span', undefined, 'workspace-attn'); attn.hidden = true; attn.setAttribute('aria-hidden', 'true');
      attnText = node('span', '', 'workspace-sr-only'); control.append(attn, attnText);
    }
    control.addEventListener('click', () => setTab(name));
    control.addEventListener('focus', () => revealTab(control));
    control.addEventListener('keydown', event => {
      const at = workspaceTabs.indexOf(name);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : event.key === 'ArrowRight' ? (at + 1) % 3 : event.key === 'ArrowLeft' ? (at + 2) % 3 : -1;
      if (index < 0) return;
      event.preventDefault(); setTab(workspaceTabs[index]); controls.get(workspaceTabs[index]).focus({ preventScroll: true });
    });
    controls.set(name, control); tabs.append(control);
  }
  // Attach first: the sync sheet mounts inside the view (.oats-view) so it
  // inherits the view's control styles and is removed with it.
  // Each tab's own controls sit at the right of the bar (Souls brings its own).
  const setupTools = node('div', undefined, 'workspace-tools'); setupTools.dataset.tools = 'sources';
  const views = node('div', undefined, 'ws-segmented'); views.setAttribute('role', 'group'); views.setAttribute('aria-label', 'Setup view');
  const viewButtons = new Map();
  for (const [id, label] of [['list', 'List'], ['graph', 'Graph']]) {
    const button = node('button', label); button.type = 'button'; button.dataset.setupView = id;
    button.addEventListener('click', () => { if (setupView === id) return; setupView = id; syncTools(); render(); });
    viewButtons.set(id, button); views.append(button);
  }
  const syncHost = node('div'); setupTools.append(views, syncHost);
  // The Capabilities search lives in the view itself (human, 2026-09-26): a toolbar row above the sections.
  const capTools = node('div', undefined, 'ws-toolbar'); capTools.dataset.tools = 'capabilities';
  const capLead = node('div', undefined, 'ws-toolbar-lead'); capTools.append(capLead);
  const search = node('label', undefined, 'ws-search');
  const searchInput = node('input', undefined, 'field'); searchInput.type = 'search'; searchInput.placeholder = 'Search capabilities'; searchInput.autocomplete = 'off';
  searchInput.setAttribute('aria-label', 'Search capabilities');
  searchInput.addEventListener('input', () => { query = searchInput.value; render(); });
  search.append(iconElement(doc, 'search', { size: 14 }), searchInput); capTools.append(search);
  header.append(setupTools);
  const sync = createWorkspaceSync(syncHost, { ctx, onSynced: () => { catalog = null; failure = ''; void load(); } });
  function syncTools() {
    setupTools.hidden = tab !== 'sources'; capTools.hidden = tab !== 'capabilities';
    for (const [id, button] of viewButtons) button.setAttribute('aria-pressed', String(id === setupView));
  }
  soulsPanel.id = 'workspace-souls'; soulsPanel.setAttribute('role', 'tabpanel'); soulsPanel.setAttribute('aria-labelledby', 'workspace-tab-souls');
  panel.className = 'workspace-discovery'; panel.setAttribute('role', 'tabpanel'); panel.tabIndex = 0;
  const status = node('p', '', 'discovery-status'); status.setAttribute('role', 'status');
  const retry = node('button', 'Retry', 'act discovery-retry'); retry.type = 'button'; retry.hidden = true;
  retry.addEventListener('click', () => { failure = ''; void load(); });
  const notes = node('div', undefined, 'catalog-notes');
  const filterHost = node('div'), body = node('div');
  panel.append(capTools, status, retry, notes, filterHost, body);

  const valid = (id, gen) => alive && serial === id && workspaceGeneration() === gen;
  function revealTab(control) {
    if (!alive || !control || !tabs.clientWidth) return;
    const left = tabs.getBoundingClientRect().left + tabs.clientLeft;
    const right = left + tabs.clientWidth, box = control.getBoundingClientRect();
    if (box.left < left || box.width > tabs.clientWidth) tabs.scrollLeft += box.left - left;
    else if (box.right > right) tabs.scrollLeft += box.right - right;
  }
  const observed = () => deployment?.status === 'observed' ? deployment.workspaceStatus || null : null;
  function updateCounts(souls) {
    if (souls !== undefined) counts.get('souls').textContent = souls === null ? '' : String(souls);
    counts.get('capabilities').textContent = catalog ? String(catalog.capabilities.length) : '';
    const s = observed();
    // Setup carries no count: a dot says when something there needs attention.
    const needs = s ? setupAttention(s) : 0;
    if (attn) { attn.hidden = !needs; attnText.textContent = needs ? ` — ${needs} ${needs === 1 ? 'item needs' : 'items need'} attention` : ''; }
  }
  function syncHeader() {
    const s = observed();
    sync.update({ status: s, canSync: !gate(workspace, deployment) && !!s });
  }
  function setTab(name) {
    if (!workspaceTabs.includes(name) || !alive) return false;
    const changed = name !== tab; tab = name;
    panel.id = `workspace-${name === 'souls' ? 'capabilities' : name}`; panel.dataset.tab = name;
    panel.setAttribute('aria-labelledby', `workspace-tab-${name}`);
    for (const [key, control] of controls) {
      control.setAttribute('aria-selected', String(key === tab)); control.tabIndex = key === tab ? 0 : -1;
      control.setAttribute('aria-controls', key === 'souls' ? soulsPanel.id : panel.id);
    }
    soulsPanel.hidden = tab !== 'souls'; panel.hidden = tab === 'souls'; syncTools();
    if (changed) { onIntent?.(); onTab?.(tab); }
    render(); if (tab === 'capabilities' && !catalog && !loading && !failure) void load();
    revealTab(controls.get(tab));
    return true;
  }
  async function load() {
    if (!alive || loading) return;
    const id = ++serial, gen = workspaceGeneration();
    if (rosterGen !== gen || gate(workspace, deployment)) { render(); return; }
    loading = true; failure = ''; render();
    let result;
    try { result = await postJson(ctx, `/api/workspace-sync${wsQuery()}`, { action: 'read' }); }
    catch (error) { result = { status: 'unavailable', reason: { code: 'E_CLI_FAILED', message: error?.message || 'Reading the workspace capabilities failed.' } }; }
    if (!valid(id, gen)) return;
    loading = false;
    if (result?.status === 'ok' && result.capabilities) catalog = result.capabilities;
    else failure = reasonText(result?.reason) || 'The workspace capabilities could not be read.';
    updateCounts(); render();
  }
  function render() {
    syncHeader();
    const unavailable = gate(workspace, deployment);
    const s = observed();
    status.textContent = unavailable || (tab === 'capabilities' && loading && !catalog ? 'Reading the workspace capabilities (oats capabilities)…' : failure);
    status.classList.toggle('error', !unavailable && !!failure);
    retry.hidden = !!unavailable || !failure || tab !== 'capabilities';
    // Identical polls never rebuild a settled projection under focus/selection.
    const key = JSON.stringify([tab, setupView, setupMember, souls.map(a => a?.team ?? null), query, unavailable, loading, failure, filters, catalog, s, deployment?.withheld, deployment?.reachable, privateListed(), instances.map(i => [i.agent, i.agentsRoot, i.modules, i.running])]);
    if (key === rendered) return;
    rendered = key;
    notes.replaceChildren(); filterHost.replaceChildren(); body.replaceChildren(); capLead.replaceChildren(); filterHost.className = '';
    if (unavailable || tab === 'souls') return;
    for (const note of deploymentNotes(deployment)) notes.append(node('p', note.text, `catalog-note${note.warn ? ' warn' : ''}`));
    if (tab === 'sources') {
      // The kernel's workspace warnings, verbatim; an unmapped team label is said on its team's row.
      for (const warning of list(s?.warnings)) if (typeof warning?.message === 'string' && warning.message && !(warning.code === 'unmapped-team-label' && list(s?.workspace?.teams).includes(warning.label))) notes.append(node('p', warning.message, 'catalog-note warn'));
      renderSetup(body, { status: s, instances, souls, cli: cliStatus(), view: setupView, selected: setupMember,
        onSelect: key => selectMember(key), onOpenRepo: openRepo, onOpenPackages: openPackages }); return;
    }
    if (!catalog) return;
    for (const problem of list(catalog.problems)) notes.append(node('p', reasonText(problem), 'catalog-note warn'));
    const names = memberNames(s);
    const sections = capabilitySections(catalog.capabilities);
    const choices = filterChoices(sections.workspace, names);
    // A remembered choice the catalog no longer offers falls back to All.
    if (filters.team && !choices.teams.includes(filters.team)) filters = { ...filters, team: null };
    if (filters.repo && !choices.repos.some(option => option !== 'sep' && option.value === filters.repo)) filters = { ...filters, repo: null };
    const shown = filterCapabilities(sections.workspace, filters, names);
    renderFilters(filterHost, { ...choices, value: filters, shown: shown.length, total: sections.workspace.length,
      onChange: next => {
        const focused = doc.activeElement?.closest?.('.catalog-select')?.dataset.filterKey || (doc.activeElement?.classList?.contains('catalog-clear') ? 'team' : null);
        filters = next; render(); refocusFilter(focused);
      } });
    renderCapabilitySections(body, { sections, shown, filterHost, navHost: capLead, privateListed: privateListed(), query,
      status: s, instances, root: workspace?.id, onOpen: onOpenCapability });
    reveal();
  }
  // Repo owned is shown only when the kernel lists private capabilities.
  const privateListed = () => list(cliStatus()?.features).includes('capabilities-private');
  // Setup: a member's membership opens in the graph's Member panel; focus follows it.
  function selectMember(key) {
    setupMember = key || null;
    if (setupMember && setupView !== 'graph') { setupView = 'graph'; syncTools(); }
    render();
    const target = setupMember ? body.querySelector('.setup-panel .icon-act') : body.querySelector('.setup-node[aria-pressed]');
    target?.focus({ preventScroll: false });
  }
  // Setup → Capabilities: a repository's capabilities (filtered), or the Packages section.
  let pendingReveal = null;
  function openRepo(key) {
    pendingReveal = { repo: `member:${key}` }; filters = { team: null, repo: `member:${key}` };
    if (!setTab('capabilities')) pendingReveal = null;
  }
  function openPackages() {
    pendingReveal = { section: 'packages' };
    if (!setTab('capabilities')) pendingReveal = null;
  }
  function reveal() {
    if (!pendingReveal) return;
    const want = pendingReveal; pendingReveal = null;
    let target = null;
    if (want.section) target = body.querySelector(`#capability-section-${want.section}`);
    else if (filters.repo === want.repo) target = body.querySelector('#capability-section-workspace');
    else target = [...body.querySelectorAll('.capability-repo')].find(el => el.dataset.repo === want.repo)?.querySelector('.capability-repo-title') || body.querySelector('#capability-section-workspace');
    if (!target) return;
    target.tabIndex = -1; target.scrollIntoView?.({ block: 'start' }); target.focus({ preventScroll: true });
  }
  // The filter row is rebuilt on a change; keep focus on the same dropdown.
  function refocusFilter(key) {
    if (!key) return;
    filterHost.querySelector(`.catalog-select[data-filter-key="${key}"] select`)?.focus({ preventScroll: true });
  }
  panel.addEventListener('scroll', () => { if (tab === 'capabilities') syncCapabilityNav(body, panel, capLead); }, { passive: true });
  function updateRoster(agents, panelData) {
    const gen = workspaceGeneration();
    if (rosterGen !== gen) { catalog = null; failure = ''; filters = { team: null, repo: null }; setupMember = null; serial++; loading = false; }
    rosterGen = gen; workspace = panelData.workspace || null; deployment = panelData.deployment || null; souls = list(agents);
    instances = list(panelData.instances);
    updateCounts(agents.length); render();
    // Read once per roster generation on any tab: the tab bar counts it.
    if (!catalog && !loading && !failure) void load();
  }
  function syncCli() {
    catalog = null; failure = ''; serial++; loading = false; updateCounts(); render();
    void load();
  }
  setTab('souls');
  return {
    setTab, updateRoster, syncCli, get tab() { return tab; },
    /** What the capability table renders with (observed facts only), for pages that reuse it. */
    context: () => ({ status: observed(), instances, root: workspace?.id }),
    reset() {
      serial++; rosterGen = null; workspace = null; deployment = null; instances = []; catalog = null; loading = false; failure = '';
      filters = { team: null, repo: null }; title.textContent = 'Workspace'; sync.reset(); updateCounts(null); render();
    },
    dispose() { alive = false; serial++; sync.dispose(); },
  };
}
