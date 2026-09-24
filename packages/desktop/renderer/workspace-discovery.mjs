/** Workspace discovery projects the installed CLI's inspection, never a resolver.
 * Sources are reported provenance, not discovery, installation or membership. */
import { postJson, wsQuery, workspaceGeneration } from './views/common.mjs';
import { cliStatus, cliKnownUnavailable, refreshCli } from './views/cli-status.mjs';
import { createCapabilityMark } from './identity-marks.mjs';
import { createDeploymentHeader, deploymentHeaderCSS } from './deployment-header.mjs';
import { createDeploymentInventory, inventoryCSS } from './deployment-inventory.mjs';
import { portableSources, renderPortableSources, sourcesCSS } from './soul-declarations.mjs';
import { createReadinessView, readinessCSS } from './readiness-view.mjs';
const readinessDismissed = new Set(); // session/workspace scoped, never a membership fact

export const workspaceTabs = ['souls', 'capabilities', 'sources'];
export const discoveryCSS = `
${deploymentHeaderCSS}
${inventoryCSS}
${sourcesCSS}
${readinessCSS}
.workspace-header { min-height:48px; flex:none; display:flex; align-items:center; flex-wrap:nowrap; gap:2px 14px; padding:0 16px; border-bottom:1px solid var(--border); background:var(--surface); box-sizing:border-box; }
.oats-view .workspace-header .field { min-height:28px; height:28px; padding:4px 8px; font-size:12px; }
.workspace-header h1 { margin:0; flex:none; font-size:14px; font-weight:700; }
.workspace-header:has(.discovery-tools[open]) { flex-wrap:wrap; }
.workspace-tabs { display:flex; flex-wrap:nowrap; overflow-x:auto; gap:2px; min-width:0; }
.workspace-tabs button { flex:none; min-height:28px; padding:4px 10px; border:0; border-radius:6px; background:var(--surface); color:var(--muted); font:600 12px var(--sans,system-ui); cursor:pointer; }
.workspace-tabs button[aria-selected=true] { background:var(--sel); color:var(--fg); }
.workspace-count { margin-left:5px; color:var(--muted); font:10px var(--mono,monospace); }
.workspace-discovery { padding:18px 20px; overflow:auto; min-width:0; flex:1; }
.workspace-discovery[hidden], .discovery-tools[hidden], .souls-bar[hidden] { display:none; }
.discovery-tools { margin-left:auto; min-width:0; font-size:12px; }
.discovery-tools > summary { cursor:pointer; padding:6px 0; color:var(--muted); }
.discovery-tools[open] { flex:1 0 100%; }
.discovery-toolbar { display:flex; flex-wrap:wrap; align-items:end; gap:8px; padding-bottom:8px; }
.discovery-toolbar label { display:grid; gap:5px; min-width:0; flex:1 1 180px; font-size:12px; color:var(--muted); }
.discovery-toolbar .field { min-width:0; width:100%; box-sizing:border-box; }
.discovery-note, .discovery-status { color:var(--muted); font-size:12px; line-height:1.5; overflow-wrap:anywhere; }
.discovery-status:empty { display:none; }
.discovery-status.error { color:var(--danger); }
.discovery-table { width:100%; table-layout:fixed; border-spacing:0; border:1px solid var(--border); border-radius:10px; background:var(--surface); overflow:hidden; font-size:12px; }
.discovery-table caption { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
.discovery-table thead tr { height:36px; }
.discovery-table th { text-align:left; vertical-align:middle; padding:0 16px; background:var(--surface-2); color:var(--muted); font-size:10.5px; font-weight:650; letter-spacing:.06em; text-transform:uppercase; }
.discovery-table td { padding:8px 16px; vertical-align:middle; border-top:1px solid var(--border); line-height:1.5; overflow-wrap:anywhere; }
.discovery-table tbody tr { height:56px; }
.discovery-table strong { font-size:12.5px; font-weight:650; }
.discovery-capability-name { display:flex; align-items:center; gap:8px; min-width:0; }
.discovery-capability-copy { min-width:0; }
.discovery-capability-name .identity-mark { width:28px; height:28px; border-radius:7px; font-size:12px; }
.discovery-table small { display:block; font:11px/1.5 var(--mono,monospace); color:var(--muted); }
.discovery-table p { margin:0; }
.discovery-table .capability-state { display:flex; flex-wrap:wrap; align-items:center; gap:4px 6px; }
.capability-fact { min-width:0; max-width:100%; padding:1px 5px; border-radius:4px; background:var(--surface-2); color:var(--muted); font-size:10.5px; line-height:14px; overflow-wrap:anywhere; }
.discovery-table .capability-identity { width:24%; }
.discovery-table .capability-health { width:50%; }
.discovery-empty { padding:24px 16px; border:1px solid var(--border); border-radius:10px; background:var(--surface); color:var(--muted); line-height:1.5; }
@container(max-width:600px) {
 .workspace-discovery { padding:14px; }
 .discovery-table, .discovery-table tbody, .discovery-table tr, .discovery-table td { display:block; width:auto; }
 .discovery-table thead { display:none; }
 .discovery-table tbody tr { height:auto; border-top:1px solid var(--border); padding:8px 0; }
 .discovery-table td { border:0; padding:4px 14px; }
 .discovery-table td::before { content:attr(data-label); display:block; color:var(--muted); font-size:10.5px; font-weight:650; }
}
`;

const hasReportedValue = value => value !== undefined && value !== null && value !== '' && (typeof value !== 'object' || Object.keys(value).length > 0);
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
export function reportedText(value, fallback = 'Not reported') {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
export function capabilityFacts(cap) {
  cap = record(cap);
  const health = record(cap.health), activation = record(cap.activation);
  return [
    ['Installation', health.installed === true ? 'Installed' : health.installed === false ? 'Not installed' : 'Not reported'],
    ['Health', reportedText(health.status)],
    ['Trust', health.trusted === true ? 'Trusted' : health.trusted === false ? 'Not trusted' : 'Not reported'],
    ['Activation', activation.enabled === true ? 'Enabled' : activation.enabled === false ? 'Disabled' : 'Not reported'],
    ...(activation.target ? [['Target', reportedText(activation.target)]] : []),
    ...(activation.provenance ? [['Binding', reportedText(activation.provenance)]] : []),
  ];
}
export function installedSources(data) {
  // One row per reported capability, including missing artifacts: provenance
  // is not installation. Do not invent a repository count from these origins.
  return (Array.isArray(data?.capabilities) ? data.capabilities : []).map(record).map(cap => ({
    id: reportedText(cap.id), version: reportedText(cap.version),
    source: reportedText(cap.source), origin: reportedText(cap.origin),
  }));
}
function gate(workspace) {
  const cli = cliStatus();
  if (!cli) return cliKnownUnavailable() ? 'CLI inspection is unavailable. Check the installed OATS CLI and retry.' : 'Checking for a compatible OATS CLI…';
  if (!cli.ok) return 'CLI inspection is unavailable. Check the installed OATS CLI and retry.';
  if (cli.operationsApi !== 1 || !cli.features?.includes('operations')) return 'This CLI does not support capability inspection. Update OATS and retry.';
  if (!workspace) return 'Waiting for the current workspace scope…';
  if (workspace.remote && (!workspace.server || !workspace.registrationPresent || !cli.remote?.includes('operations'))) return 'Inspection needs a registered server with remote operations support. Check the workspace connection and retry.';
  return '';
}

export function createWorkspaceDiscovery(header, panel, { ctx, soulsPanel, onTab, onIntent, inspect }) {
  const doc = header.ownerDocument;
  const node = (tag, text, cls) => { const el = doc.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
  const button = (text, run) => { const el = node('button', text, 'act'); el.type = 'button'; el.addEventListener('click', run); return el; };
  let alive = true, serial = 0, rosterGen = null, workspace = null, tab = 'souls', selector = {}, result = null, loading = false, failure = '', query = '';
  let contexts = [], renderedBody = null, reviewing = false, empty = false;
  const inspectionCliIdentity = () => {
    const cli = cliStatus();
    return JSON.stringify([cli?.ok, cli?.bin, cli?.version, cli?.operationsApi, cli?.features, cli?.remote]);
  };
  let inspectedCli = inspectionCliIdentity();
  header.className = 'workspace-header';
  const title = node('h1', 'Workspace'); header.append(title);
  const tabs = node('div', undefined, 'workspace-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Workspace sections'); header.append(tabs);
  const controls = new Map(), counts = new Map();
  const readinessEntry = button('Readiness…', () => setReview(true)); readinessEntry.classList.add('workspace-readiness-entry'); readinessEntry.disabled = true;
  for (const name of workspaceTabs) {
    const control = button(name[0].toUpperCase() + name.slice(1), () => setTab(name));
    control.className = ""; // tabs are not generic action buttons
    control.id = `workspace-tab-${name}`; control.setAttribute('role', 'tab');
    const count = node('span', '', 'workspace-count'); control.append(count); counts.set(name, count);
    control.addEventListener('focus', () => revealTab(control));
    control.addEventListener('keydown', event => {
      const at = workspaceTabs.indexOf(name);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : event.key === 'ArrowRight' ? (at + 1) % 3 : event.key === 'ArrowLeft' ? (at + 2) % 3 : -1;
      if (index < 0) return;
      event.preventDefault(); setTab(workspaceTabs[index]); controls.get(workspaceTabs[index]).focus({ preventScroll: true });
    });
    controls.set(name, control); tabs.append(control);
  }
  soulsPanel.id = 'workspace-souls'; soulsPanel.setAttribute('role', 'tabpanel'); soulsPanel.setAttribute('aria-labelledby', 'workspace-tab-souls');
  panel.className = 'workspace-discovery'; panel.setAttribute('role', 'tabpanel'); panel.tabIndex = 0;
  const tools = node('details', undefined, 'discovery-tools');
  tools.append(node('summary', 'Filter & scope')); header.append(tools);
  const toolbar = node('div', undefined, 'discovery-toolbar'); tools.append(toolbar);
  const scopeLabel = node('label', 'Configuration scope');
  const scope = node('select', undefined, 'field discovery-scope'); scopeLabel.append(scope);
  scope.addEventListener('change', () => {
    selector = scope.value ? { context: scope.value } : {}; invalidate(); inspect?.(null); void load();
  });
  const searchLabel = node('label', 'Filter reported capabilities / sources');
  const search = node('input', undefined, 'field discovery-filter'); search.type = 'search'; search.autocomplete = 'off'; searchLabel.append(search);
  search.addEventListener('input', () => { query = search.value; render(); });
  const retry = button('Refresh inspection', async () => {
    const id = ++serial, gen = workspaceGeneration();
    await refreshCli(ctx);
    if (!valid(id, gen)) return;
    void load(true);
  });
  const details = button('Scope details…', () => inspect?.({ selector: { ...selector }, contexts }));
  toolbar.append(scopeLabel, searchLabel, retry, details);
  const note = node('p', '', 'discovery-note'), status = node('p', '', 'discovery-status'); status.setAttribute('role', 'status');
  // The kernel's workspace header (`oats workspace status --json`), from the
  // current roster observation. No separate read; nothing to coalesce.
  const deploymentHost = node('section', undefined, 'workspace-deployment');
  const deploymentHeader = createDeploymentHeader(deploymentHost);
  let deployment = null;
  const inventoryHost = node('div', undefined, 'workspace-inventory');
  const inventory = createDeploymentInventory(inventoryHost, { ctx });
  const effectiveHost = node('div'), effective = createReadinessView(effectiveHost, { ctx });
  const frameHost = node('section', undefined, 'workspace-readiness-frame'); frameHost.hidden = true;
  const readinessFrame = createReadinessView(frameHost, { ctx, onSkip: () => {
    const key = dismissalKey(); readinessDismissed.add(key);
    if (readinessDismissed.size > 64) readinessDismissed.delete(readinessDismissed.values().next().value);
    setReview(false); readinessEntry.focus({ preventScroll: true });
  } });
  const invitation = node('div', 'Review the independent readiness checks for this workspace.', 'readiness-invitation'); invitation.hidden = true;
  invitation.append(button('Review readiness', () => setReview(true)));
  header.append(readinessEntry);
  const frameParent = panel.parentElement || panel; frameParent.append(invitation, frameHost);
  const body = node('div'); panel.append(deploymentHost, inventoryHost, effectiveHost, status, body, note);
  const dismissalKey = () => JSON.stringify([workspace?.id, workspace?.scope, workspace?.server]);
  function setReview(show) {
    if (!alive || rosterGen !== workspaceGeneration() || !workspace) return;
    onIntent?.(); reviewing = show; onTab?.(show ? 'readiness' : tab); syncPresentation(); render();
  }
  function syncPresentation() {
    soulsPanel.hidden = reviewing || tab !== 'souls'; panel.hidden = reviewing || tab === 'souls';
    tools.hidden = reviewing || tab === 'souls'; frameHost.hidden = !reviewing;
    invitation.hidden = reviewing || tab !== 'souls' || !empty || !workspace || readinessDismissed.has(dismissalKey());
  }
  function syncReadSurfaces() {
    const cli = cliStatus();
    deploymentHeader.update(deployment, { active: tab === 'capabilities' && !reviewing });
    const context = selector.context || workspace?.scope;
    inventory.update({ active: tab === 'capabilities' && !reviewing, workspace, context, selector, cli,
      identity: JSON.stringify([workspaceGeneration(), workspace?.id, workspace?.scope, workspace?.remote, workspace?.server,
        context, cli?.ok ?? null, cli?.bin ?? null, cli?.version ?? null]) });
    inventory.setQuery(query);
    const readinessState = { workspace, selector: { kind: 'scope', context }, cli };
    effective.update({ ...readinessState, active: tab === 'capabilities' && !reviewing });
    effective.setQuery(query);
    readinessFrame.update({ ...readinessState, active: reviewing });
  }
  // Reveal only in the horizontal strip. scrollIntoView would also move the
  // outer workspace/page (and focus() without preventScroll does likewise).
  // Rects are relative to the visible client area, not the overflowing content.
  function revealTab(control) {
    if (!alive || !control || !tabs.clientWidth) return;
    const left = tabs.getBoundingClientRect().left + tabs.clientLeft;
    const right = left + tabs.clientWidth, box = control.getBoundingClientRect();
    if (box.left < left || box.width > tabs.clientWidth) tabs.scrollLeft += box.left - left;
    else if (box.right > right) tabs.scrollLeft += box.right - right;
  }
  function valid(id, gen) { return alive && serial === id && workspaceGeneration() === gen; }
  function invalidate() { serial++; loading = false; result = null; failure = ''; updateCounts(); render(); }
  function updateCounts(souls) {
    if (souls !== undefined) counts.get('souls').textContent = souls === null ? '' : String(souls);
    counts.get('capabilities').textContent = Array.isArray(result?.capabilities) ? String(result.capabilities.length) : '';
    // No claim to know unique repositories: only count entries whose origin
    // or source was actually reported, and label that unit explicitly.
    const origins = Array.isArray(result?.capabilities) ? result.capabilities.filter(cap => hasReportedValue(cap?.source) || hasReportedValue(cap?.origin)).length : undefined;
    const sources = portableSources(result);
    counts.get('sources').textContent = sources
      ? sources.kind === 'unavailable' ? '' : `${sources.items.length} recorded`
      : origins === undefined ? '' : `${origins} reported`;
    // A settled count can enlarge the focused/current tab after activation.
    revealTab(tabs.contains(doc.activeElement) ? doc.activeElement : controls.get(tab));
  }
  function setTab(name) {
    if (!workspaceTabs.includes(name) || !alive) return false;
    const changed = name !== tab || reviewing; tab = name; reviewing = false;
    panel.id = `workspace-${name === 'souls' ? 'capabilities' : name}`;
    panel.setAttribute('aria-labelledby', `workspace-tab-${name}`);
    for (const [key, control] of controls) {
      control.setAttribute('aria-selected', String(key === tab)); control.tabIndex = key === tab ? 0 : -1;
      // The capability/source projection shares one panel, controlled by
      // the active tab. Inactive tabs point at it too (always an extant id).
      control.setAttribute('aria-controls', key === 'souls' ? soulsPanel.id : panel.id);
    }
    syncPresentation();
    if (changed) tools.open = false;
    if (changed) onTab?.(tab);
    render(); if (tab !== 'souls' && !result && !loading) void load();
    revealTab(controls.get(tab)); // reactivating the current tab must reveal too
    return true;
  }
  async function load(force = false) {
    if (!alive || (loading && !force)) return;
    const id = ++serial, gen = workspaceGeneration();
    if (rosterGen !== gen || gate(workspace)) { result = null; updateCounts(); render(); return; }
    loading = true; failure = ''; result = null; updateCounts(); render();
    try {
      const data = await postJson(ctx, `/api/capabilities${wsQuery()}`, { action: 'inspect', selector: { ...selector } });
      if (!valid(id, gen)) return;
      if (data?.operationsApi !== 1) failure = 'This CLI does not support capability inspection. Update OATS and retry.';
      else result = data;
    } catch (error) { if (!valid(id, gen)) return; failure = error.message || 'Inspection failed. Retry when the workspace is available.'; }
    if (!valid(id, gen)) return;
    loading = false; updateCounts(); render();
  }
  function render() {
    syncReadSurfaces();
    const unavailable = gate(workspace);
    details.disabled = !!unavailable || !result;
    const sources = portableSources(result);
    note.textContent = tab === 'sources'
      ? !result ? 'Source provenance requires a current scope inspection. An unavailable inspection does not establish that sources are absent.'
        : sources ? `Portable source context reported by the installed CLI (soulsApi 1). Scope: ${reportedText(result.scope?.context)}. This is not a source repository catalog or an adoption action.`
          : 'Read-only origins and provenance reported at this scope. Rows describe capabilities, not installation, unique repositories, team memberships or remote discovery results. Portable soul sources are not reported by this inspection API.'
      : 'Capabilities reported at this scope. Runtimes are not capabilities; only reported installation, health, trust and activation are shown.';
    status.textContent = unavailable || (loading ? 'Loading inspection…' : failure);
    status.classList.toggle('error', !!failure);
    // Roster/CLI polls must not rebuild a settled read-only projection under
    // focus or a text selection. A new inspection, filter or tab owns a repaint.
    const nextBody = [result, unavailable, loading, failure, query, tab];
    if (renderedBody?.every((value, index) => value === nextBody[index])) return;
    renderedBody = nextBody;
    body.replaceChildren();
    if (!result || unavailable) return;
    for (const problem of result.problems || []) body.append(node('p', `${reportedText(problem.code)}: ${reportedText(problem.message)}`, 'discovery-note'));
    if (tab === 'sources' && sources) { renderPortableSources(body, sources, query); return; }
    const caps = Array.isArray(result.capabilities) ? result.capabilities.map(record) : null;
    if (!caps) { body.append(node('p', 'Capabilities were not reported by this CLI.', 'discovery-empty')); return; }
    const rows = tab === 'sources' ? installedSources(result) : caps;
    const filtered = rows.map((item, index) => ({ item, capability: caps[index] }))
      .filter(({ item }) => JSON.stringify(item).toLowerCase().includes(query.toLowerCase()));
    const table = node('table', undefined, 'discovery-table');
    table.append(node('caption', tab === 'sources' ? 'Reported source provenance' : 'Reported capabilities'));
    const headings = tab === 'sources' ? ['Capability', 'Source', 'Origin'] : ['Capability', 'Reported state', 'Provenance'];
    if (tab !== 'sources') {
      const cols = node('colgroup');
      for (const cls of ['capability-identity', 'capability-health', 'capability-provenance']) cols.append(node('col', undefined, cls));
      table.append(cols);
    }
    const head = node('thead'), hrow = node('tr');
    for (const label of headings) { const th = node('th', label); th.scope = 'col'; hrow.append(th); } head.append(hrow); table.append(head);
    const tbody = node('tbody'); table.append(tbody); body.append(table);
    for (const { item, capability } of filtered) {
      const row = node('tr'); const cells = headings.map(label => { const td = node('td'); td.dataset.label = label; row.append(td); return td; });
      const name = node('div', undefined, 'discovery-capability-name'), copy = node('div', undefined, 'discovery-capability-copy');
      copy.append(node('strong', reportedText(item.id)), node('small', `Version: ${reportedText(item.version)}`));
      name.append(createCapabilityMark(doc, capability, { root: result.scope?.context, host: workspace?.server }), copy);
      cells[0].append(name);
      if (tab === 'sources') { cells[1].textContent = item.source; cells[2].textContent = item.origin; }
      else {
        const state = node('div', undefined, 'capability-state');
        for (const [key, value] of capabilityFacts(item)) state.append(node('span', `${key}: ${value}`, 'capability-fact'));
        cells[1].append(state);
        if (item.health?.detail) cells[1].append(node('p', reportedText(item.health.detail)));
        if (item.health?.problems?.length) cells[1].append(node('p', reportedText(item.health.problems)));
        cells[2].append(node('p', `Source: ${reportedText(item.source)}`), node('p', `Origin: ${reportedText(item.origin)}`));
      }
      tbody.append(row);
    }
    if (!filtered.length) {
      const row = node('tr'), cell = node('td', rows.length ? 'Nothing matches the filter.' : 'No capabilities reported at this scope.'); cell.colSpan = 3; row.append(cell); tbody.append(row);
    }
  }
  function updateRoster(agents, panelData) {
    rosterGen = workspaceGeneration(); workspace = panelData.workspace || null; deployment = panelData.deployment || null;
    title.textContent = deployment?.status === 'observed' && deployment.workspace?.name ? deployment.workspace.name : 'Workspace';
    empty = agents.length === 0; readinessEntry.disabled = !workspace;
    syncPresentation();
    contexts = [{ context: '', label: 'Workspace defaults' }];
    for (const agent of agents) {
      // These are the existing admitted agents-root parent scopes, not a
      // filesystem/config search. The server independently validates them.
      const context = agent.agentsRoot?.replace(/\/[^/]+\/?$/, '');
      if (context && !contexts.some(item => item.context === context)) contexts.push({ context, label: context });
    }
    scope.replaceChildren(); for (const item of contexts) { const option = node('option', item.label); option.value = item.context; scope.append(option); }
    if (selector.context && !contexts.some(item => item.context === selector.context)) { selector = {}; invalidate(); if (tab !== 'souls') inspect?.(null); }
    scope.value = selector.context || '';
    updateCounts(agents.length); render();
    if (tab !== 'souls' && !result && !loading && !failure) void load();
  }
  function syncCli() {
    const next = inspectionCliIdentity();
    if (next !== inspectedCli) { inspectedCli = next; invalidate(); }
    if (gate(workspace)) { invalidate(); return; }
    render(); if (tab !== 'souls' && !result && !loading) void load();
  }
  setTab('souls');
  return {
    setTab, updateRoster, syncCli, get tab() { return tab; },
    reset() { rosterGen = null; workspace = null; deployment = null; title.textContent = 'Workspace'; selector = {}; contexts = []; query = ''; reviewing = false; empty = false; readinessEntry.disabled = true;
      search.value = ''; scope.replaceChildren(); syncPresentation(); onTab?.(tab); invalidate(); updateCounts(null); },
    dispose() { alive = false; serial++; deploymentHeader.dispose(); inventory.dispose(); effective.dispose(); readinessFrame.dispose(); frameHost.remove(); invitation.remove(); },
    reviewReadiness() { setReview(true); },
  };
}
