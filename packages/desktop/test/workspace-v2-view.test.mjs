// The v2 Workspace view (F2, no package approval; F7 sections/Setup): the
// Capabilities sections from `oats capabilities` (Workspace owned with team/repo
// dropdowns, Packages, Repo owned behind capabilities-private), Setup (graph + lists)
// from `oats workspace status`, and Sync. Fixtures captured from main's kernel (packages-no-approval);
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
import { filterChoices, capabilityUse, memberNames, capabilitySections } from '../renderer/workspace-catalog.mjs';
import { iconElement } from '../renderer/shell-icons.mjs';
import { syncStateText } from '../renderer/workspace-sync-view.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 4; i++) await tick(); };
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const f2 = name => JSON.parse(readFileSync(new URL(`./fixtures/workspace-v2/f2/${name}.json`, import.meta.url), 'utf8'));
const dir = '/fixture/base/northwind-workspace';
const CLI = { ...f2('version'), ok: true, bin: '/fixture/bin/oats', operationsApi: 1, relations: true };
const APPROVAL_TEXT = /approv/i;
const fx = name => name.includes('/') ? JSON.parse(readFileSync(new URL(`./fixtures/workspace-v2/${name}.json`, import.meta.url), 'utf8')) : f2(name);
const statusOf = name => workspaceStatusData(fx(name), dir);
const roster = deploymentStatusData(f2('status'), dir);
const instances = roster.agents.flatMap(agent => agent.instances.map(i => ({ ...i, agent: i.agent || agent.name, agentsRoot: roster.root })));
const catalog = name => ({ workspaceSyncApi: 1, status: 'ok', report: null, capabilities: { capabilitiesApi: 1, ...fx(name).result }, reason: null });
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
    owned: () => [...doc.querySelectorAll('[data-section=workspace] .catalog-row:not(.head)')].map(el => el.dataset.capability),
    button: text => [...doc.querySelectorAll('button')].find(el => el.textContent.trim() === text),
    syncCalls: () => calls.filter(call => call.path.startsWith('/api/workspace-sync')).map(call => call.body),
    setStatus: name => { observedStatus = statusOf(name); },
  };
}

test('Capabilities is the kernel catalog: counts, jump pills, and Capability | Source | Used by in v2 terms', async t => {
  const u = await setup(t);
  // Workspace v4: the tab bar counts capabilities, so the catalog is read once on mount (any tab).
  assert.deepEqual(u.syncCalls(), [{ action: 'read' }], 'exactly one read; never a sync');
  await u.tab('capabilities');
  assert.deepEqual(u.syncCalls(), [{ action: 'read' }], 'opening the tab does not read again');
  assert.equal(u.doc.querySelector('#workspace-tab-capabilities .workspace-count').textContent, '10');
  assert.deepEqual([...u.doc.querySelectorAll('.capability-nav button')].map(el => [el.dataset.jump, el.textContent, el.getAttribute('aria-current')]),
    [['workspace', 'Workspace owned6', 'true'], ['packages', 'Packages4', 'false']]);
  assert.deepEqual([...u.doc.querySelectorAll('[data-section=workspace] .catalog-row.head [role=columnheader]')].map(el => el.textContent), ['Capability', 'Source', 'Used by']);
  assert.equal(u.rows().length, 10);
  const row = name => u.rows().find(el => el.dataset.capability === name);
  // Source: the package and its pinned version, or the member repository at its latest.
  assert.equal(row('oats.okf').querySelector('.source-chip').dataset.source, 'package');
  assert.equal(row('oats.okf').querySelector('.source-chip').textContent, 'oats.okf2.1.3');
  assert.equal(row('nw-brand-voice').querySelector('.source-chip').dataset.source, 'member');
  assert.equal(row('nw-brand-voice').querySelector('.source-chip').textContent, 'marketinglatest');
  assert.doesNotMatch(u.doc.querySelector('.workspace-discovery').textContent, APPROVAL_TEXT);
  // Used by = souls whose instances record the module (roster module rows).
  const used = capabilityUse(instances, 'nw-release-tooling');
  assert.deepEqual(used.souls.map(s => s.name), ['release-manager']);
  assert.equal(row('nw-release-tooling').querySelector('.catalog-used-count').textContent, '1');
  assert.equal(row('nw-release-tooling').querySelector('.catalog-used-count').title, 'Used by release-manager');
  assert.equal(row('nw-brand-voice').querySelector('.catalog-used-count').textContent, '—');
  assert.equal(u.doc.querySelector('.workspace-discovery').textContent.includes('Members'), false, 'no Members list in Capabilities');
});

test('team and repo dropdowns filter Workspace owned only (AND), name only what it holds, and Clear filters resets', async t => {
  const u = await setup(t);
  await u.tab('capabilities');
  const choices = filterChoices(capabilitySections(f2('capabilities').result.capabilities).workspace, memberNames(statusOf('workspace-status')));
  assert.deepEqual(choices.teams, ['engineering', 'global', 'marketing']);
  assert.deepEqual(choices.repos.map(s => s === 'sep' ? '|' : s.label), ['agents', 'data', 'marketing', 'nw-tools'], 'repositories, never packages');
  assert.ok(u.doc.querySelector('[data-section=workspace] .catalog-filters'), 'the filters sit in the Workspace owned section');
  const select = key => u.doc.querySelector(`.catalog-select[data-filter-key=${key}] select`);
  const choose = async (key, value) => { const el = select(key); el.focus(); el.value = value; el.dispatchEvent(new u.dom.window.Event('change', { bubbles: true })); await settle(); };
  assert.deepEqual([...select('team').options].map(o => o.textContent), ['All', 'engineering', 'global', 'marketing']);
  assert.equal(u.doc.querySelector('.catalog-clear'), null, 'nothing to clear yet');
  await choose('team', 'marketing');
  assert.deepEqual(u.owned(), ['nw-brand-voice', 'nw-campaign-metrics']);
  assert.equal(u.doc.querySelector('.catalog-shown').textContent, '2 of 6 shown');
  assert.ok(u.doc.querySelector('.catalog-select[data-filter-key=team]').classList.contains('active'));
  assert.equal(u.doc.querySelectorAll('[data-section=packages] .catalog-row:not(.head)').length, 4, 'Packages are not filtered');
  assert.equal(u.doc.activeElement, select('team'), 'focus stays on the chosen dropdown across the re-render');
  await choose('repo', 'member:local//fixture/base/fx/remotes/agents.git');
  assert.deepEqual(u.owned(), []); assert.match(u.doc.querySelector('[data-section=workspace] .catalog-empty').textContent, /No capabilities match/);
  await choose('team', '');
  assert.deepEqual(u.owned(), ['nw-house-style', 'nw-release-tooling']);
  u.doc.querySelector('.catalog-clear').click(); await settle();
  assert.equal(u.owned().length, 6);
  assert.equal(u.doc.querySelector('.catalog-shown'), null);
  assert.deepEqual(u.syncCalls(), [{ action: 'read' }], 'filtering is local');
});

// Workspace v4 (human decision 2026-09-26; replaces the header search): the search is
// the Capabilities view's own toolbar, above the sections.
test('the view search narrows every section by capability name', async t => {
  const u = await setup(t);
  await u.tab('capabilities');
  const search = u.doc.querySelector('.ws-toolbar[data-tools=capabilities] input');
  assert.equal(search.closest('.workspace-header'), null, 'not in the header');
  assert.equal(search.closest('.ws-toolbar').hidden, false);
  assert.ok(search.closest('.ws-toolbar').querySelector('.ws-toolbar-lead .capability-nav'), 'the section pills share the search row');
  search.focus();
  search.value = 'OKF'; search.dispatchEvent(new u.dom.window.Event('input', { bubbles: true })); await settle();
  assert.deepEqual(u.rows().map(el => el.dataset.capability), ['oats.okf']);
  assert.equal(u.doc.activeElement, search, 'narrowing rebuilds the pills, never the search under the caret');
  await u.tab('souls');
  assert.equal(search.closest('.ws-toolbar').hidden, true, 'the search belongs to Capabilities');
});

test('three sections: Workspace owned, Packages, and Repo owned (grouped by repo) only when the CLI advertises capabilities-private', async t => {
  const sections = capabilitySections(fx('f7/capabilities').result.capabilities);
  assert.deepEqual(sections.repo.map(r => r.name), ['nw-platform-runbook'], 'the kernel\'s private: true row (#185)');
  const withFeature = { ...CLI, features: [...CLI.features, 'capabilities-private'] };
  const u = await setup(t, { cli: withFeature, sync: () => catalog('f7/capabilities') });
  await u.tab('capabilities');
  assert.deepEqual([...u.doc.querySelectorAll('.capability-section-title > span:first-child')].map(el => el.textContent), ['Workspace owned', 'Packages', 'Repo owned']);
  assert.deepEqual([...u.doc.querySelectorAll('.capability-section-lead')].map(el => el.textContent), ['latest from member repos', 'pinned versions, same everywhere', 'only for souls of the same repo']);
  assert.deepEqual([...u.doc.querySelectorAll('.capability-nav button')].map(el => el.dataset.jump), ['workspace', 'packages', 'repo']);
  assert.ok(!u.owned().includes('nw-platform-runbook'), 'a repo-owned capability is never listed as workspace owned');
  const group = u.doc.querySelector('[data-section=repo] .catalog-group');
  assert.equal(group.textContent, 'platform');
  assert.equal(group.querySelector('svg').innerHTML, iconElement(u.doc, 'repo').innerHTML, 'the repository icon');
  const runbook = u.doc.querySelector('[data-section=repo] .catalog-row[data-capability=nw-platform-runbook]');
  assert.equal(group.nextElementSibling, runbook);
  assert.equal(runbook.querySelector('.source-chip svg').innerHTML, iconElement(u.doc, 'home').innerHTML, 'repo owned: this soul\'s own repository');
  // Without the feature the section is hidden, never guessed.
  spawn.unmount();
  const v = await setup(t, { sync: () => catalog('f7/capabilities') });
  await v.tab('capabilities');
  assert.deepEqual([...v.doc.querySelectorAll('.capability-section')].map(el => el.dataset.section), ['workspace', 'packages']);
});

// Workspace v4 (W1/W2) — replaces the Setup tests that pinned the old
// Repositories/Packages/External souls lists and the always-on graph.
test('W1 Setup list: members with handshake and contribution, packages with origin and lock, teams, this computer; kernel detail verbatim', async t => {
  const moved = syncData(f2('sync-moved'), dir);
  const u = await setup(t);
  await u.tab('sources');
  // Workspace v4: Setup carries no count; its dot says when something needs attention (here nothing does).
  assert.equal(u.doc.querySelector('#workspace-tab-sources .workspace-count').textContent, '');
  assert.equal(u.doc.querySelector('#workspace-tab-sources .workspace-attn').hidden, true);
  const ws = statusOf('workspace-status').workspace;
  assert.equal(u.doc.querySelector('.setup-lede h2').textContent, ws.name);
  assert.match(u.doc.querySelector('.setup-lede-where').textContent, new RegExp(`'s workspace file @ ${ws.commit.slice(0, 7)}$`), 'the declaration and its commit');
  assert.doesNotMatch(u.doc.querySelector('.setup').textContent, /oats-workspace\.yaml|oats-membership\.yaml|oats-lock\.json/, 'a kernel without desktop facts reports no file names, so none is shown (desktop-facts-setup.test.mjs covers the reported ones)');
  assert.deepEqual([...u.doc.querySelectorAll('.setup-box, .setup-local')].map(el => el.dataset.box), ['Members', 'Packages', 'Teams', 'This computer']);
  const repos = [...u.doc.querySelectorAll('[data-box=Members] [data-member]')];
  assert.equal(repos.length, 5);
  assert.ok(repos.every(row => row.querySelector('.setup-state').textContent === 'confirmed' && row.querySelector('.setup-state svg')));
  assert.equal(u.doc.querySelectorAll('[data-box=Packages] [data-package]').length, 3);
  const local = Object.fromEntries([...u.doc.querySelectorAll('.setup-kv')].map(r => [r.querySelector('dt').textContent, r.querySelector('dd').textContent]));
  assert.equal(local.Folder, dir); assert.equal(local.Settings, 'oats-local.yaml'); assert.equal(local.Lock, 'current');
  assert.doesNotMatch(u.doc.querySelector('.setup-cols').textContent, /\b[0-9a-f]{7,40}\b/, 'no commits in the lists');
  assert.doesNotMatch(u.doc.querySelector('.workspace-discovery').textContent, APPROVAL_TEXT);
  assert.deepEqual(u.syncCalls(), [{ action: 'read' }], 'Setup renders the observation only (the one read is the tab bar\'s catalog count)');
  // An unconfirmed member (kernel row from a later sync) keeps its status; "Why?" opens its membership in the graph.
  const status = { ...statusOf('workspace-status'), members: moved.members };
  const { renderSetup } = await import('../renderer/workspace-setup.mjs');
  const host = u.doc.createElement('div'); let picked = null;
  renderSetup(host, { status, onSelect: key => { picked = key; } });
  const marketing = host.querySelector('[data-box=Members] [data-member$="marketing.git"]');
  assert.equal(marketing.querySelector('.setup-state').textContent, '○no backlink');
  assert.ok(marketing.querySelector('.setup-state').classList.contains('warn'));
  marketing.querySelector('button.setup-link-act').click();
  assert.match(picked, /marketing\.git$/);
  renderSetup(host, { status, view: 'graph', selected: picked, onSelect() {} });
  const panel = host.querySelector('.setup-panel');
  assert.equal(panel.querySelector('.setup-panel-name').textContent, 'marketing');
  assert.deepEqual([...panel.querySelectorAll('.setup-hand-mark')].map(m => m.dataset.side), ['yes', 'no'], 'listed, but no backlink');
  assert.match(panel.querySelector('.setup-detail').textContent, /has no oats-membership\.yaml/, 'the kernel detail, verbatim');
});

test('W2 Setup graph: this computer → the lock → the workspace → members and packages; a member opens its Member panel, which opens its capabilities', async t => {
  const u = await setup(t, { status: 'f7/workspace-status' });
  await u.tab('sources');
  u.doc.querySelector('.ws-segmented [data-setup-view=graph]').click(); await settle();
  const graph = u.doc.querySelector('.setup-graph');
  const computer = graph.querySelector('.setup-computer'), ws = graph.querySelector('.setup-ws');
  assert.equal(computer.querySelector('.setup-card-meta.mono').textContent, dir);
  assert.equal([...computer.querySelectorAll('.setup-card-meta')].at(-1).textContent, `oats-local.yaml · ${instances.length} instance${instances.length === 1 ? '' : 's'}`);
  assert.equal(graph.querySelector('.setup-lock').getAttribute('aria-label'), 'Lock current');
  assert.equal(ws.querySelector('.setup-card-title').textContent, 'Workspace northwind');
  assert.equal(ws.querySelector('.setup-card-meta.mono').textContent, 'agents');
  const nodes = [...graph.querySelectorAll('.setup-node')];
  assert.deepEqual(nodes.map(el => el.querySelector('.setup-node-name').textContent),
    ['agents', 'platform', 'data', 'marketing', 'nw-tools', 'nw.chat 0.1.0', 'nw.teams 0.1.0', 'nw.tools 0.4.0', 'oats.framework 1.1.3', 'oats.okf 2.1.3', 'security-reviewer']);
  assert.equal(nodes[0].querySelector('.setup-node-meta').textContent, 'host · 2 souls');
  assert.deepEqual(nodes.filter(n => n.dataset.package).map(n => n.querySelector('.setup-node-meta').textContent), ['git tag', 'git tag', 'git tag', 'official', 'official']);
  const repoIcon = iconElement(u.doc, 'repo').innerHTML, packageIcon = iconElement(u.doc, 'package').innerHTML;
  assert.ok(nodes.every(el => el.querySelector('svg').innerHTML === (el.dataset.package ? packageIcon : repoIcon)), 'git repositories carry the repository icon, packages the package icon');
  // The kernel's workspace warnings, verbatim (#185 warnings[]); a kernel before #185 sends none.
  assert.deepEqual(statusOf('workspace-status').warnings, []);
  assert.equal(statusOf('f7/workspace-status').warnings[0].code, 'unmapped-team-label');
  // An unmapped team label is said on its team's row in the list, in the kernel's words (not repeated as a note).
  u.doc.querySelector('.ws-segmented [data-setup-view=list]').click(); await settle();
  assert.match(u.doc.querySelector('.setup-team[data-team=global] .setup-team-warn').textContent, /team "global" has no messaging\.byTeam entry/);
  assert.equal(u.doc.querySelector('.setup-team[data-team=engineering] .setup-team-warn'), null);
  assert.equal([...u.doc.querySelectorAll('.catalog-note.warn')].some(el => /messaging\.byTeam/.test(el.textContent)), false);
  u.doc.querySelector('.ws-segmented [data-setup-view=graph]').click(); await settle();
  // A member opens its Member panel; the panel opens its capabilities, filtered.
  u.doc.querySelector('button.setup-node[data-member$="agents.git"]').click(); await settle();
  const panel = u.doc.querySelector('.setup-panel');
  assert.equal(u.doc.activeElement, panel.querySelector('.icon-act'), 'focus moves into the panel');
  assert.equal(u.doc.querySelector('button.setup-node[data-member$="agents.git"]').getAttribute('aria-pressed'), 'true');
  assert.deepEqual([...panel.querySelectorAll('.setup-hand-mark')].map(m => m.dataset.side), ['yes', 'yes']);
  [...panel.querySelectorAll('button')].find(b => b.textContent === 'Show its capabilities').click(); await settle();
  assert.equal(u.doc.getElementById('workspace-tab-capabilities').getAttribute('aria-selected'), 'true');
  assert.match(u.doc.querySelector('.catalog-select[data-filter-key=repo] select').value, /agents\.git$/, 'the Repo filter is that repository');
  assert.ok(u.doc.querySelector('.catalog-select[data-filter-key=repo]').classList.contains('active'));
  assert.deepEqual(u.owned(), ['nw-house-style', 'nw-release-tooling']);
  assert.equal(u.doc.activeElement, u.doc.getElementById('capability-section-workspace'));
});

test('header state: lock out of date or current — from workspace status; there is no approval state', async () => {
  assert.deepEqual(syncStateText({ ...statusOf('workspace-status'), unsynced: ['x'] }), { text: 'Lock out of date', warn: true });
  assert.deepEqual(syncStateText({ ...statusOf('workspace-status'), stale: ['x'] }), { text: 'Lock out of date', warn: true });
  assert.deepEqual(syncStateText(statusOf('workspace-status')), { text: 'Lock current', warn: false });
  assert.equal(syncStateText(null).text, '');
});

test('Sync runs oats sync and nothing else: no approval control, no sheet for a clean sync, the catalog re-read', async t => {
  const u = await setup(t, { sync: body => body.action === 'sync' ? report('sync-current', 'ok') : catalog('capabilities') });
  assert.equal(u.doc.querySelector('.ws-sync-state').textContent, '', 'a current lock is shown on Setup (This computer), not beside Sync');
  assert.equal(u.button('Review approvals'), undefined); assert.equal(u.doc.querySelector('.ws-approval'), null);
  await u.tab('capabilities');
  u.doc.querySelector('.ws-sync button.ws-sync-run').click(); await settle();
  assert.deepEqual(u.syncCalls(), [{ action: 'read' }, { action: 'sync' }, { action: 'read' }], 'sync, then the catalog is read again');
  assert.equal(u.doc.querySelector('.ws-sync-sheet').hidden, true, 'a clean sync needs nothing from the operator');
  assert.equal(u.doc.querySelector('.ws-sync-state').textContent, '', 'a current lock is shown on Setup (This computer), not beside Sync');
});

test('a sync that reports problems says so in a sheet, in the kernel\'s words', async t => {
  const withProblems = report('sync-current', 'ok');
  withProblems.report.problems = [{ code: 'E_MEMBER_UNREADABLE', message: 'member marketing could not be read', path: null, repoKey: null }];
  const u = await setup(t, { sync: body => body.action === 'sync' ? withProblems : catalog('capabilities') });
  u.doc.querySelector('.ws-sync button.ws-sync-run').click(); await settle();
  const sheet = u.doc.querySelector('.ws-sync-sheet');
  assert.equal(sheet.hidden, false); assert.equal(sheet.querySelector('h2').textContent, 'Synced, with problems');
  assert.match(sheet.textContent, /member marketing could not be read/);
  u.button('Close').click(); assert.equal(sheet.hidden, true);
});

test('a refused sync reads plainly; the kernel code and message stay verbatim behind Details', async t => {
  const integrity = f2('sync-integrity').error;
  const u = await setup(t, { sync: body => body.action === 'sync'
    ? { workspaceSyncApi: 1, status: 'refused', report: null, reason: { code: integrity.code, message: integrity.message } } : catalog('capabilities') });
  u.doc.querySelector('.ws-sync button.ws-sync-run').click(); await settle();
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
  dom.window.document.querySelector('.ws-sync button.ws-sync-run').click(); await tick();
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
