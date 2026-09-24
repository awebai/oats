// The v2 Workspace view (F2, no package approval): the Capabilities table from
// `oats capabilities`, team/source filter pills, Sources from `oats workspace
// status`, and Sync. Fixtures captured from main's kernel (packages-no-approval);
// the shipped Workspace stage is mounted in jsdom with a
// fixture ctx.api. No CLI, server, GUI or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import * as spawn from '../renderer/views/spawn.mjs';
import { currentWorkspace, setWorkspace } from '../renderer/views/common.mjs';
import { refreshCli } from '../renderer/views/cli-status.mjs';
import { workspaceStatusData, deploymentStatusData, syncData } from '../deployment-data.mjs';
import { filterChoices, capabilityUse, memberNames } from '../renderer/workspace-catalog.mjs';
import { syncStateText } from '../renderer/workspace-sync-view.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 4; i++) await tick(); };
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const f2 = name => JSON.parse(readFileSync(new URL(`./fixtures/workspace-v2/f2/${name}.json`, import.meta.url), 'utf8'));
const dir = '/fixture/base/northwind-workspace';
const CLI = { ...f2('version'), ok: true, bin: '/fixture/bin/oats', operationsApi: 1, relations: true };
const APPROVAL_TEXT = /approv/i;
const statusOf = name => workspaceStatusData(f2(name), dir);
const roster = deploymentStatusData(f2('status'), dir);
const instances = roster.agents.flatMap(agent => agent.instances.map(i => ({ ...i, agent: i.agent || agent.name, agentsRoot: roster.root })));
const catalog = name => ({ workspaceSyncApi: 1, status: 'ok', report: null, capabilities: { capabilitiesApi: 1, ...f2(name).result }, reason: null });
const report = (name, status) => ({ workspaceSyncApi: 1, status, report: syncData(f2(name), dir), capabilities: null, reason: null });

async function setup(t, { status = 'workspace-status', cli = CLI, sync, workspace = {}, deployment } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', { url: 'http://localhost' });
  const previous = { document: globalThis.document, window: globalThis.window, setInterval: globalThis.setInterval, ws: currentWorkspace() };
  globalThis.document = dom.window.document; globalThis.window = dom.window; globalThis.setInterval = () => 0;
  const calls = [];
  let observedStatus = statusOf(status);
  const panel = () => ({ workspace: { id: currentWorkspace(), scope: currentWorkspace(), ...workspace }, workspaces: [], instances,
    deployment: deployment ?? { status: 'observed', root: roster.root, workspace: observedStatus.workspace, workspaceStatus: observedStatus, reachable: { reachable: true }, withheld: [] } });
  const ctx = { hasWorkspaceSwitcher: true, api: async (path, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : undefined; calls.push({ path, body });
    if (path === '/api/cli') return cli;
    if (path.startsWith('/api/agents')) return { agents: roster.agents.map(({ instances: _i, ...soul }) => ({ ...soul, agentsRoot: roster.root })) };
    if (path.startsWith('/api/panel')) return panel();
    if (path.startsWith('/api/workspace-sync')) return sync ? sync(body, calls) : catalog('capabilities');
    if (path === '/api/servers') return { servers: [] };
    throw new Error(`Unexpected fixture API request: ${path}`);
  } };
  t.after(() => { spawn.unmount(); setWorkspace(previous.ws); globalThis.document = previous.document; globalThis.window = previous.window; globalThis.setInterval = previous.setInterval; dom.window.close(); });
  setWorkspace('/team');
  await refreshCli({ api: async () => cli });
  spawn.mount(dom.window.document.querySelector('#host'), ctx); await settle();
  const doc = dom.window.document;
  return { doc, dom, calls,
    tab: async name => { doc.getElementById(`workspace-tab-${name}`).click(); await settle(); },
    rows: () => [...doc.querySelectorAll('.catalog-table .catalog-row:not(.head)')],
    pill: (group, label) => [...doc.querySelectorAll(`.catalog-filter[aria-label="Filter by ${group}"] .catalog-pill`)].find(el => el.textContent === label),
    button: text => [...doc.querySelectorAll('button')].find(el => el.textContent.trim() === text),
    syncCalls: () => calls.filter(call => call.path.startsWith('/api/workspace-sync')).map(call => call.body),
    setStatus: name => { observedStatus = statusOf(name); },
  };
}

test('Capabilities is the kernel catalog: counts, three design columns and readiness in v2 terms', async t => {
  const u = await setup(t);
  assert.equal(u.doc.querySelector('#workspace-tab-capabilities .workspace-count').textContent, '', 'no catalog read until the tab is opened');
  assert.deepEqual(u.syncCalls(), []);
  await u.tab('capabilities');
  assert.deepEqual(u.syncCalls(), [{ action: 'read' }], 'exactly one read; never a sync');
  assert.equal(u.doc.querySelector('#workspace-tab-capabilities .workspace-count').textContent, '10');
  assert.deepEqual([...u.doc.querySelectorAll('.catalog-row.head [role=columnheader]')].map(el => el.textContent), ['Capability', 'Status', 'Used by']);
  assert.equal(u.rows().length, 10);
  const row = name => u.rows().find(el => el.dataset.capability === name);
  assert.match(row('oats.okf').querySelector('.catalog-sub').textContent, /^Package · oats\.okf v2\.1\.3$/);
  assert.equal(row('oats.okf').querySelector('.catalog-chip').textContent, 'locked');
  assert.match(row('oats.okf').querySelectorAll('.catalog-chip')[1].textContent, /^@[0-9a-f]{7}$/, 'locked, then the commit — no approval state');
  assert.doesNotMatch(u.doc.querySelector('.workspace-discovery').textContent, APPROVAL_TEXT);
  assert.match(row('nw-brand-voice').querySelector('.catalog-sub').textContent, /^Member · marketing$/, 'the team is not repeated when it names the repository');
  assert.match(row('nw-release-tooling').querySelector('.catalog-sub').textContent, /^Member · agents · engineering$/);
  assert.equal(row('nw-brand-voice').querySelector('.catalog-chip').textContent, 'member confirmed');
  assert.match(row('nw-brand-voice').querySelector('.catalog-chip.mono').textContent, /^@[0-9a-f]{7}$/);
  // Used by = souls whose instances record the module (roster module rows).
  const used = capabilityUse(instances, 'nw-release-tooling');
  assert.deepEqual(used.souls.map(s => s.name), ['release-manager']);
  assert.equal(row('nw-release-tooling').querySelector('.catalog-used-count').textContent, '1 soul');
  assert.equal(row('nw-brand-voice').querySelector('.catalog-used').textContent, 'No instance yet');
  assert.equal(u.doc.querySelector('.workspace-discovery').textContent.includes('Members'), false, 'no Members list in Capabilities');
});

test('team and source pills filter the table (AND), name only what the catalog holds, and reset to All', async t => {
  const u = await setup(t);
  await u.tab('capabilities');
  const choices = filterChoices(f2('capabilities').result.capabilities, memberNames(statusOf('workspace-status')));
  assert.deepEqual(choices.teams, ['engineering', 'global', 'marketing', 'unassigned']);
  assert.deepEqual(choices.sources.map(s => s === 'sep' ? '|' : s.label), ['agents', 'data', 'marketing', 'nw-tools', '|', 'nw.tools', 'oats.framework', 'oats.okf']);
  assert.equal(u.pill('team', 'All').getAttribute('aria-pressed'), 'true');
  u.pill('team', 'marketing').focus(); u.pill('team', 'marketing').click(); await settle();
  assert.deepEqual(u.rows().map(el => el.dataset.capability), ['nw-brand-voice', 'nw-campaign-metrics']);
  assert.equal(u.pill('team', 'marketing').getAttribute('aria-pressed'), 'true');
  assert.equal(u.doc.activeElement, u.pill('team', 'marketing'), 'focus stays on the chosen pill across the re-render');
  u.pill('source', 'nw.tools').click(); await settle();
  assert.equal(u.rows().length, 0); assert.match(u.doc.querySelector('.catalog-empty').textContent, /No capabilities match/);
  u.pill('team', 'All').click(); await settle();
  assert.deepEqual(u.rows().map(el => el.dataset.capability), ['nw-deploy', 'nw-lint']);
  u.pill('source', 'All').click(); await settle();
  assert.equal(u.rows().length, 10);
  assert.deepEqual(u.syncCalls(), [{ action: 'read' }], 'filtering is local');
});

test('Sources: repositories with team and confirmation, packages with their lock, kernel detail verbatim', async t => {
  const moved = syncData(f2('sync-moved'), dir);
  const u = await setup(t);
  await u.tab('sources');
  assert.equal(u.doc.querySelector('#workspace-tab-sources .workspace-count').textContent, '9', '5 repositories + 3 packages + 1 external soul');
  const sections = [...u.doc.querySelectorAll('.sources-section h2')].map(el => el.textContent);
  assert.deepEqual(sections, ['Repositories', 'Packages', 'External souls']);
  const repos = [...u.doc.querySelectorAll('[data-member]')];
  assert.equal(repos.length, 5);
  assert.ok(repos.every(row => row.querySelector('.catalog-chip').textContent === 'confirmed'));
  assert.equal([...u.doc.querySelectorAll('[data-package]')].length, 3);
  assert.ok([...u.doc.querySelectorAll('[data-package]')].every(row => row.querySelector('.catalog-chips').textContent === 'locked'));
  assert.doesNotMatch(u.doc.querySelector('.workspace-discovery').textContent, APPROVAL_TEXT);
  assert.deepEqual(u.syncCalls(), [], 'Sources render the observation only');
  // An unconfirmed member (kernel row from a later sync) keeps its status and detail.
  const status = { ...statusOf('workspace-status'), members: moved.members };
  const { renderSources } = await import('../renderer/workspace-catalog.mjs');
  const host = u.doc.createElement('div'); renderSources(host, { status });
  const marketing = host.querySelector('[data-member$="marketing.git"]');
  assert.equal(marketing.querySelector('.catalog-chip').textContent, 'no-backlink');
  assert.match(marketing.querySelector('.sources-detail').textContent, /has no oats-membership\.yaml/);
});

test('header state: lock out of date or current — from workspace status; there is no approval state', async () => {
  assert.deepEqual(syncStateText({ ...statusOf('workspace-status'), unsynced: ['x'] }), { text: 'Lock out of date', warn: true });
  assert.deepEqual(syncStateText({ ...statusOf('workspace-status'), stale: ['x'] }), { text: 'Lock out of date', warn: true });
  assert.deepEqual(syncStateText(statusOf('workspace-status')), { text: 'Lock current', warn: false });
  assert.equal(syncStateText(null).text, '');
});

test('Sync runs oats sync and nothing else: no approval control, no sheet for a clean sync, the catalog re-read', async t => {
  const u = await setup(t, { sync: body => body.action === 'sync' ? report('sync-current', 'ok') : catalog('capabilities') });
  assert.equal(u.doc.querySelector('.ws-sync-state').textContent, 'Lock current');
  assert.equal(u.button('Review approvals'), undefined); assert.equal(u.doc.querySelector('.ws-approval'), null);
  await u.tab('capabilities');
  u.doc.querySelector('.ws-sync button.primary').click(); await settle();
  assert.deepEqual(u.syncCalls(), [{ action: 'read' }, { action: 'sync' }, { action: 'read' }], 'sync, then the catalog is read again');
  assert.equal(u.doc.querySelector('.ws-sync-sheet').hidden, true, 'a clean sync needs nothing from the operator');
  assert.equal(u.doc.querySelector('.ws-sync-state').textContent, 'Lock current');
});

test('a sync that reports problems says so in a sheet, in the kernel\'s words', async t => {
  const withProblems = report('sync-current', 'ok');
  withProblems.report.problems = [{ code: 'E_MEMBER_UNREADABLE', message: 'member marketing could not be read', path: null, repoKey: null }];
  const u = await setup(t, { sync: body => body.action === 'sync' ? withProblems : catalog('capabilities') });
  u.doc.querySelector('.ws-sync button.primary').click(); await settle();
  const sheet = u.doc.querySelector('.ws-sync-sheet');
  assert.equal(sheet.hidden, false); assert.equal(sheet.querySelector('h2').textContent, 'Synced, with problems');
  assert.match(sheet.textContent, /member marketing could not be read/);
  u.button('Close').click(); assert.equal(sheet.hidden, true);
});

test('a refused sync reads plainly; the kernel code and message stay verbatim behind Details', async t => {
  const integrity = f2('sync-integrity').error;
  const u = await setup(t, { sync: body => body.action === 'sync'
    ? { workspaceSyncApi: 1, status: 'refused', report: null, reason: { code: integrity.code, message: integrity.message } } : catalog('capabilities') });
  u.doc.querySelector('.ws-sync button.primary').click(); await settle();
  const sheet = u.doc.querySelector('.ws-sync-sheet');
  assert.equal(sheet.hidden, false); assert.equal(sheet.querySelector('h2').textContent, 'Sync didn’t finish');
  const lead = sheet.querySelector('.ws-sync-lead');
  assert.ok(lead.classList.contains('error')); assert.doesNotMatch(lead.textContent, /E_[A-Z]|\//);
  assert.match(lead.textContent, /no longer matches what the lock recorded/);
  const detail = sheet.querySelector('.ws-sync-detail');
  assert.equal(detail.hidden, true); sheet.querySelector('.ws-sync-details').click();
  assert.equal(detail.hidden, false); assert.equal(detail.textContent, `${integrity.code} · ${integrity.message}`);
});

test('a sync that settles after a workspace switch is inert', async t => {
  const gate = deferred();
  const u = await setup(t, { sync: body => body.action === 'sync' ? gate.promise : catalog('capabilities') });
  u.button('Sync').click(); await tick();
  setWorkspace('/other'); await settle();
  gate.resolve({ workspaceSyncApi: 1, status: 'refused', report: null, reason: { code: 'E_PACKAGE_INTEGRITY', message: 'old' } }); await settle();
  assert.equal(u.doc.querySelector('.ws-sync-sheet').hidden, true, 'the old workspace\'s report never opens a sheet');
});

test('no workspace-v2 CLI or a remote workspace: nothing is read or synced, and the reason is named', async t => {
  const legacy = await setup(t, { cli: { ...CLI, workspaceApi: null, features: CLI.features.filter(f => f !== 'workspace-v2') } });
  await legacy.tab('capabilities');
  assert.match(legacy.doc.querySelector('.discovery-status').textContent, /does not advertise workspace-v2/);
  assert.equal(legacy.button('Sync').disabled, true);
  assert.deepEqual(legacy.syncCalls(), []);
});

test('hostile catalog text renders literally', async t => {
  const hostile = f2('capabilities');
  hostile.result.capabilities[0] = { ...hostile.result.capabilities[0], name: '<img src=x onerror=alert(1)>', origin: '"><script>bad()</script>' };
  const u = await setup(t, { sync: () => ({ workspaceSyncApi: 1, status: 'ok', capabilities: { capabilitiesApi: 1, ...hostile.result } }) });
  await u.tab('capabilities');
  assert.equal(u.doc.querySelector('.catalog-table img, .catalog-table script'), null);
  assert.ok(u.rows().some(el => el.querySelector('.catalog-name').textContent === '<img src=x onerror=alert(1)>'));
});

/* ── latest-intent ownership, mutation-verified (success AND rejection) ── */
async function loadMutant(path, from, to) {
  const url = new URL(`../renderer/${path}`, import.meta.url);
  let source = readFileSync(url, 'utf8');
  assert.equal(source.split(from).length, 2, `mutate exactly one guard in ${path}`);
  source = source.replace(from, to).replace(/from '(\.[^']+)'/g, (_all, spec) => `from '${new URL(spec, url).href}'`);
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
async function syncOwnership(t, create, outcome) {
  const dom = new JSDOM('<!doctype html><body><main class="oats-view"><header></header></main></body>');
  const previous = currentWorkspace(); setWorkspace('/team');
  const gate = deferred();
  const ctx = { api: () => gate.promise };
  const view = create(dom.window.document.querySelector('header'), { ctx });
  t.after(() => { view.dispose(); setWorkspace(previous); dom.window.close(); });
  view.update({ status: statusOf('workspace-status'), canSync: true });
  dom.window.document.querySelector('.ws-sync button.primary').click(); await tick();
  setWorkspace('/other'); // a newer workspace intent
  if (outcome === 'success') gate.resolve({ workspaceSyncApi: 1, status: 'refused', report: null, reason: { code: 'E_PACKAGE_INTEGRITY', message: 'OLD refusal' } });
  else gate.resolve(Promise.reject(new Error('OLD sync failure')));
  await settle();
  return dom.window.document.querySelector('.ws-sync-sheet').hidden;
}
for (const outcome of ['success', 'rejection']) test(`sync ${outcome} after a workspace switch never opens a sheet (mutation-verified)`, async t => {
  const { createWorkspaceSync } = await import('../renderer/workspace-sync-view.mjs');
  assert.equal(await syncOwnership(t, createWorkspaceSync, outcome), true, 'the shipped guard keeps the sheet closed');
  const mutant = await loadMutant('workspace-sync-view.mjs', 'alive && id === serial && gen === workspaceGeneration()', 'alive && id === serial');
  assert.equal(await syncOwnership(t, mutant.createWorkspaceSync, outcome), false, 'without the workspace generation the stale result would paint');
});

async function catalogOwnership(t, create, outcome) {
  const dom = new JSDOM('<!doctype html><body><main class="oats-view"><header></header><section id="panel"></section><section id="souls"></section></main></body>');
  const previous = currentWorkspace(); setWorkspace('/team');
  await refreshCli({ api: async () => CLI });
  const gate = deferred(); let reads = 0;
  // The first read belongs to /team; the newer workspace's own read stays pending.
  const ctx = { api: async (path) => path === '/api/cli' ? CLI : reads++ === 0 ? gate.promise : deferred().promise };
  const doc = dom.window.document, host = doc.querySelector('#panel');
  const view = create(doc.querySelector('header'), host, { ctx, soulsPanel: doc.querySelector('#souls') });
  t.after(() => { view.dispose(); setWorkspace(previous); dom.window.close(); });
  const observed = statusOf('workspace-status');
  const panel = () => ({ workspace: { id: currentWorkspace(), scope: currentWorkspace() }, instances: [], deployment: { status: 'observed', workspace: observed.workspace, workspaceStatus: observed } });
  view.updateRoster([], panel()); view.setTab('capabilities'); await tick();
  setWorkspace('/other'); view.updateRoster([], panel());
  if (outcome === 'success') gate.resolve(catalog('capabilities')); else gate.resolve(Promise.reject(new Error('OLD catalog failure')));
  await settle();
  return { rows: host.querySelectorAll('.catalog-row:not(.head)').length, text: host.textContent };
}
for (const outcome of ['success', 'rejection']) test(`catalog ${outcome} for a previous workspace never renders (mutation-verified)`, async t => {
  const { createWorkspaceDiscovery } = await import('../renderer/workspace-discovery.mjs');
  const shipped = await catalogOwnership(t, createWorkspaceDiscovery, outcome);
  assert.equal(shipped.rows, 0); assert.doesNotMatch(shipped.text, /OLD catalog failure/);
  const mutant = await loadMutant('workspace-discovery.mjs', 'alive && serial === id && workspaceGeneration() === gen', 'alive');
  const stale = await catalogOwnership(t, mutant.createWorkspaceDiscovery, outcome);
  assert.ok(stale.rows > 0 || /OLD catalog failure/.test(stale.text), 'without ownership the old workspace\'s result would paint');
});

test('a failed catalog read names the failure and offers an explicit retry', async t => {
  let fail = true;
  const u = await setup(t, { sync: () => fail ? { workspaceSyncApi: 1, status: 'unavailable', reason: { code: 'E_CLI_TIMEOUT', message: 'The workspace command exceeded its time limit.' } } : catalog('capabilities') });
  await u.tab('capabilities');
  assert.equal(u.doc.querySelector('.discovery-status').textContent, 'E_CLI_TIMEOUT: The workspace command exceeded its time limit.');
  const retry = u.doc.querySelector('.discovery-retry');
  assert.equal(retry.hidden, false);
  fail = false; retry.click(); await settle();
  assert.equal(u.rows().length, 10); assert.equal(retry.hidden, true);
  assert.deepEqual(u.syncCalls(), [{ action: 'read' }, { action: 'read' }]);
});
