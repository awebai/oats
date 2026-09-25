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
import { catalogCSS, renderCapabilitySections, capabilitySections, renderFilters, renderSources, filterChoices, filterCapabilities, memberNames, deploymentNotes } from './workspace-catalog.mjs';
import { createWorkspaceSync, syncCSS, reasonText } from './workspace-sync-view.mjs';

export const workspaceTabs = ['souls', 'capabilities', 'sources'];
// What a person reads (the ids stay stable): Setup is what the workspace is built from (repos, packages, external souls).
const TAB_LABELS = { souls: 'Souls', capabilities: 'Capabilities', sources: 'Setup' };
export const discoveryCSS = `
${catalogCSS}
${syncCSS}
.workspace-header { min-height:48px; flex:none; display:flex; align-items:center; flex-wrap:nowrap; gap:2px 14px; padding:0 12px 0 16px; border-bottom:1px solid var(--border); background:var(--surface); box-sizing:border-box; }
.oats-view .workspace-header .field { min-height:28px; height:28px; padding:4px 8px; font-size:12px; }
.workspace-header h1 { margin:0; flex:none; font-size:14px; font-weight:700; }
.workspace-tabs { display:flex; flex-wrap:nowrap; overflow-x:auto; gap:2px; min-width:0; }
.workspace-tabs button { flex:none; min-height:28px; padding:0 10px; border:0; border-radius:6px; background:var(--surface); color:var(--muted); font:500 12px var(--sans,system-ui); cursor:pointer; }
.workspace-tabs button[aria-selected=true] { background:var(--sel); color:var(--fg); font-weight:650; }
.workspace-count { margin-left:5px; color:var(--muted); font:10px var(--mono,monospace); }
.workspace-discovery { padding:18px 20px; overflow:auto; min-width:0; flex:1; container-type:inline-size; }
.workspace-discovery[hidden], .souls-bar[hidden] { display:none; }
.discovery-status { margin:0 0 14px; color:var(--muted); font-size:12px; line-height:1.5; overflow-wrap:anywhere; }
.discovery-status:empty { display:none; }
.discovery-status.error { color:var(--danger); }
.discovery-retry { margin:0 0 14px; }
.discovery-retry[hidden] { display:none; }
`;

const list = value => Array.isArray(value) ? value : [];

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
  header.className = 'workspace-header';
  const title = node('h1', 'Workspace'); header.append(title);
  const tabs = node('div', undefined, 'workspace-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Workspace sections'); header.append(tabs);
  const controls = new Map(), counts = new Map();
  for (const name of workspaceTabs) {
    const control = node('button', TAB_LABELS[name]); control.type = 'button';
    control.id = `workspace-tab-${name}`; control.setAttribute('role', 'tab');
    const count = node('span', '', 'workspace-count'); control.append(count); counts.set(name, count);
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
  const syncHost = node('div'); header.append(syncHost);
  const sync = createWorkspaceSync(syncHost, { ctx, onSynced: () => { catalog = null; failure = ''; if (tab === 'capabilities') void load(); } });
  soulsPanel.id = 'workspace-souls'; soulsPanel.setAttribute('role', 'tabpanel'); soulsPanel.setAttribute('aria-labelledby', 'workspace-tab-souls');
  panel.className = 'workspace-discovery'; panel.setAttribute('role', 'tabpanel'); panel.tabIndex = 0;
  const status = node('p', '', 'discovery-status'); status.setAttribute('role', 'status');
  const retry = node('button', 'Retry', 'act discovery-retry'); retry.type = 'button'; retry.hidden = true;
  retry.addEventListener('click', () => { failure = ''; void load(); });
  const notes = node('div', undefined, 'catalog-notes');
  const filterHost = node('div'), body = node('div');
  panel.append(status, retry, notes, filterHost, body);

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
    counts.get('sources').textContent = s ? String(list(s.members).length + list(s.packages).length + list(s.external).length) : '';
  }
  function syncHeader() {
    const s = observed();
    sync.update({ status: s, canSync: !gate(workspace, deployment) && !!s });
  }
  function setTab(name) {
    if (!workspaceTabs.includes(name) || !alive) return false;
    const changed = name !== tab; tab = name;
    panel.id = `workspace-${name === 'souls' ? 'capabilities' : name}`;
    panel.setAttribute('aria-labelledby', `workspace-tab-${name}`);
    for (const [key, control] of controls) {
      control.setAttribute('aria-selected', String(key === tab)); control.tabIndex = key === tab ? 0 : -1;
      control.setAttribute('aria-controls', key === 'souls' ? soulsPanel.id : panel.id);
    }
    soulsPanel.hidden = tab !== 'souls'; panel.hidden = tab === 'souls';
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
    const key = JSON.stringify([tab, unavailable, loading, failure, filters, catalog, s, deployment?.withheld, deployment?.reachable, privateListed(), instances.map(i => [i.agent, i.agentsRoot, i.modules, i.running])]);
    if (key === rendered) return;
    rendered = key;
    notes.replaceChildren(); filterHost.replaceChildren(); body.replaceChildren(); filterHost.className = '';
    if (unavailable || tab === 'souls') return;
    for (const note of deploymentNotes(deployment)) notes.append(node('p', note.text, `catalog-note${note.warn ? ' warn' : ''}`));
    if (tab === 'sources') {
      // The kernel's workspace warnings (for example an unmapped team label), verbatim.
      for (const warning of list(s?.warnings)) if (typeof warning?.message === 'string' && warning.message) notes.append(node('p', warning.message, 'catalog-note warn'));
      renderSources(body, { status: s, instances, onOpenRepo: openRepo, onOpenPackages: openPackages }); return;
    }
    if (!catalog) return;
    for (const problem of list(catalog.problems)) notes.append(node('p', reasonText(problem), 'catalog-note warn'));
    const names = memberNames(s);
    const sections = capabilitySections(catalog.capabilities);
    const choices = filterChoices(sections.workspace, names);
    // A remembered choice the catalog no longer offers falls back to All.
    if (filters.team && !choices.teams.includes(filters.team)) filters = { ...filters, team: null };
    if (filters.repo && !choices.repos.some(option => option !== 'sep' && option.value === filters.repo)) filters = { ...filters, repo: null };
    renderFilters(filterHost, { ...choices, value: filters, refreshing: loading,
      onChange: next => {
        const focused = doc.activeElement?.dataset?.filterKey ? { key: doc.activeElement.dataset.filterKey, value: doc.activeElement.dataset.filterValue } : null;
        filters = next; render(); refocusPill(focused);
      },
      onRefresh: () => { catalog = null; failure = ''; void load(); } });
    renderCapabilitySections(body, { sections, shown: filterCapabilities(sections.workspace, filters, names), filterHost, privateListed: privateListed(),
      status: s, instances, root: workspace?.id, onOpen: onOpenCapability });
    reveal();
  }
  // Repo owned is shown only when the kernel lists private capabilities.
  const privateListed = () => list(cliStatus()?.features).includes('capabilities-private');
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
  // The pill row is rebuilt on a filter change; keep focus on the same pill.
  function refocusPill(focused) {
    if (!focused) return;
    const pill = [...filterHost.querySelectorAll('.catalog-pill')].find(el => el.dataset.filterKey === focused.key && el.dataset.filterValue === focused.value);
    pill?.focus({ preventScroll: true });
  }
  function updateRoster(agents, panelData) {
    const gen = workspaceGeneration();
    if (rosterGen !== gen) { catalog = null; failure = ''; filters = { team: null, repo: null }; serial++; loading = false; }
    rosterGen = gen; workspace = panelData.workspace || null; deployment = panelData.deployment || null;
    instances = list(panelData.instances);
    title.textContent = deployment?.status === 'observed' && deployment.workspace?.name ? deployment.workspace.name : 'Workspace';
    updateCounts(agents.length); render();
    if (tab === 'capabilities' && !catalog && !loading && !failure) void load();
  }
  function syncCli() {
    catalog = null; failure = ''; serial++; loading = false; updateCounts(); render();
    if (tab === 'capabilities') void load();
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
