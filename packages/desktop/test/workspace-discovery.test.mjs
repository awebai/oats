import { launchSoul } from './helpers/workspace-actions.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import * as spawn from '../renderer/views/spawn.mjs';
import { currentWorkspace, setWorkspace } from '../renderer/views/common.mjs';
import { refreshCli, resetCliStateForTests } from '../renderer/views/cli-status.mjs';
import { capabilityFacts, installedSources, createWorkspaceDiscovery } from '../renderer/workspace-discovery.mjs';
import { remotePanel } from '../server/remote-roster.mjs';
import { workspaceStatusData } from '../deployment-data.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const CLI = { ok: true, bin: '/fixture/oats', version: '0.24.6', operationsApi: 1, features: ['operations'], remote: ['operations'], relations: true };
// The kernel's workspace header, captured from a real Northwind run and
// projected exactly as the server does; the panel carries it with the roster.
const northwind = JSON.parse(readFileSync(new URL('./fixtures/workspace-v2/workspace-status.json', import.meta.url), 'utf8'));
const northwindDir = northwind.result.workspace.local.replace(/\/oats-local\.yaml$/, '');
const observed = () => ({ status: 'observed', root: `${northwindDir}/agents`, workspace: workspaceStatusData(northwind, northwindDir).workspace,
  workspaceStatus: workspaceStatusData(northwind, northwindDir), reachable: { reachable: true } });
const soul = (root = '/team/one/agents', name = 'dev') => ({ name, agentsRoot: root, description: 'Build and review', runtime: 'pi', work: 'worktree', repoName: 'project' });
const inspectData = (id = 'fixture.notes', selector = {}) => ({ operationsApi: 1, scope: { context: selector.context || '/team' }, selected: { source: 'config' },
  souls: [{ ...soul(selector.agentsRoot), editable: { fields: ['model'], instructions: true }, model: 'default-model', instructions: { text: '# Literal AGENTS.md\n<img src=x onerror=evil()>' } }],
  // bin/oats.mjs inspect: package-engine health is separate from activation.
  capabilities: [{ id, package: 'fixture.package', version: '1.2.3', source: 'path:/fixture/source', origin: 'installed', level: '/team',
    health: { status: 'ok', code: null, detail: null, installed: true, locked: true, trusted: true, integrity: `sha256-${'a'.repeat(64)}`, installedIntegrity: `sha256-${'a'.repeat(64)}` },
    activation: { enabled: true, source: 'config', target: 'global', level: '/team', provenance: ['global @ /team'], settings: {}, declaredAt: [] }, operations: [] }], layers: {} });
async function setup(t, options = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', { url: 'http://localhost' });
  const previous = { document: globalThis.document, window: globalThis.window, setInterval: globalThis.setInterval, ws: currentWorkspace() };
  globalThis.document = dom.window.document; globalThis.window = dom.window;
  const polls = []; globalThis.setInterval = fn => { polls.push(fn); return 0; };
  let cli = options.cli === undefined ? CLI : options.cli;
  let agents = options.agents || [soul()];
  let getAgents = options.getAgents, getPanel = options.getPanel;
  const calls = [], files = [], opens = [];
  const panel = () => ({ workspace: { id: currentWorkspace(), scope: currentWorkspace(), ...(options.workspace || {}) }, workspaces: options.workspaces || [], instances: options.instances || [],
    ...(options.deployment !== null ? { deployment: options.deployment ? options.deployment() : observed() } : {}) });
  const ctx = { hasWorkspaceSwitcher: options.shell ?? true,
    api: async (path, opts = {}) => {
      const body = opts.body ? JSON.parse(opts.body) : undefined; calls.push({ path, body, method: opts.method || 'GET' });
      if (path === '/api/cli') return cli;
      if (path.startsWith('/api/agents')) return getAgents ? getAgents() : { agents };
      if (path.startsWith('/api/panel')) return getPanel ? getPanel() : panel();
      if (path.startsWith('/api/capabilities') && body.action === 'list') return options.inventory ? options.inventory(body) : {
        inventoryApi: 1, scope: { kind: 'classic', context: body.selector.context || currentWorkspace() }, packages: [], capabilities: [], legacy: [],
      };
      if (path.startsWith('/api/capabilities')) return options.inspect ? options.inspect(body) : inspectData('fixture.notes', body.selector);
      if (path === '/api/servers') return { servers: [] };
      if (path === '/api/spawn' && options.spawn) return options.spawn(body);
      throw new Error(`Unexpected fixture API request: ${path}`);
    }, openBrain: name => files.push(name), openTerminal: ref => opens.push(ref) };
  t.after(() => { spawn.unmount(); setWorkspace(previous.ws); globalThis.document = previous.document; globalThis.window = previous.window; globalThis.setInterval = previous.setInterval; dom.window.close(); });
  setWorkspace('/team');
  if (options.pendingCli) resetCliStateForTests(); else await refreshCli({ api: async () => cli });
  options.beforeMount?.();
  spawn.mount(dom.window.document.querySelector('#host'), ctx); await tick();
  const doc = dom.window.document;
  return { doc, dom, calls, files, opens, ctx, polls, panel,
    tab: name => doc.getElementById(`workspace-tab-${name}`).click(),
    click: text => { const control = [...doc.querySelectorAll('button')].find(el => el.textContent === text); assert.ok(control, text); control.click(); },
    change: (selector, value) => { const el = doc.querySelector(selector); el.value = value; el.dispatchEvent(new dom.window.Event('change', { bubbles: true })); return el; },
    inspections: () => calls.filter(call => call.path.startsWith('/api/capabilities') && call.body.action === 'inspect'),
    inventories: () => calls.filter(call => call.path.startsWith('/api/capabilities') && call.body.action === 'list'),
    setAgents: value => { agents = value; },
    setLoaders: (a, p) => { getAgents = a; getPanel = p; },
    setCli: async value => { cli = value; await refreshCli({ api: async () => cli }); },
  };
}

test('Workspace has semantic tabs, current counts, explicit inspection and no incidental mutation', async t => {
  const u = await setup(t);
  assert.equal(u.doc.querySelector('h1').textContent, 'northwind');
  assert.deepEqual([...u.doc.querySelectorAll('[role=tab]')].map(el => el.id), ['workspace-tab-souls', 'workspace-tab-capabilities', 'workspace-tab-sources']);
  assert.equal(u.doc.querySelector('#workspace-tab-souls .workspace-count').textContent, '1');
  assert.equal(u.doc.querySelector('#workspace-tab-capabilities .workspace-count').textContent, '');
  assert.equal(u.inspections().length, 0, 'Souls mount does not run inspection or a mutation');
  u.tab('capabilities'); await tick();
  assert.deepEqual(u.inspections().map(call => call.body), [{ action: 'inspect', selector: {} }]);
  assert.match(u.inspections()[0].path, /ws=%2Fteam/);
  assert.match(u.doc.querySelector('.workspace-discovery').textContent, /fixture.notes/);
  assert.match(u.doc.querySelector('.workspace-discovery').textContent, /Installation: Installed.*Health: ok.*Trust: Trusted.*Activation: Enabled/s);
  assert.equal(u.doc.querySelector('.souls-grid').hidden, true);
  assert.equal(u.doc.querySelector('#workspace-tab-capabilities .workspace-count').textContent, '1');
  const caps = u.doc.getElementById('workspace-tab-capabilities');
  caps.dispatchEvent(new u.dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  assert.equal(u.doc.activeElement.id, 'workspace-tab-sources');
  assert.equal(u.doc.querySelector('#workspace-tab-sources').getAttribute('aria-selected'), 'true');
  assert.match(u.doc.querySelector('.workspace-discovery').textContent, /Read-only origins/);
  assert.equal(u.inspections().length, 1, 'tab projection reuses only the same scope inspection');
  assert.equal(u.doc.querySelector('#workspace-tab-sources .workspace-count').textContent, '1 reported');
  for (const control of u.doc.querySelectorAll('[role=tab]')) assert.ok(u.doc.getElementById(control.getAttribute('aria-controls')));
  spawn.preselectWorkspaceTab('souls');
  assert.equal(u.doc.querySelector('.souls-grid').hidden, false);
  assert.equal(u.doc.querySelector('.workspace-discovery').hidden, true);
  assert.equal(u.doc.querySelector('.spawn-modal'), null);
  assert.deepEqual(u.calls.filter(c => c.method === 'POST').map(c => c.body.action), ['list', 'inspect'], 'the header is roster data: no separate catalog or header read');
});

test('the kernel workspace header renders exactly the reported name, key, members, packages and approval IDs', async t => {
  const u = await setup(t);
  assert.equal(u.doc.querySelector('h1').textContent, 'northwind', 'title is the kernel-reported workspace name');
  u.tab('capabilities'); await tick();
  const header = u.doc.querySelector('.deployment-header');
  assert.equal(header.hidden, false);
  assert.equal(header.querySelector('h2').textContent, 'northwind');
  assert.equal(header.querySelector('.deployment-header-key').textContent, `${northwind.result.workspace.key} @ ${northwind.result.workspace.commit.slice(0, 7)}`);
  const rows = [...header.querySelectorAll('li')].map(li => li.textContent);
  for (const member of northwind.result.members) assert.ok(rows.some(row => row.startsWith(member.name) && row.includes('Confirmed') && row.includes(`Team: ${member.team}`)), member.name);
  for (const pkg of northwind.result.packages) assert.ok(rows.some(row => row.startsWith(pkg.id) && row.includes('Approved')), pkg.id);
  assert.match(header.textContent, /Every locked package is approved/);
  assert.doesNotMatch(header.textContent, /approvalNeeded|install|catalog/i, 'no sync-row, acquisition or catalog vocabulary');
  // Identical polls neither rebuild the header under focus nor re-read.
  const before = header.firstChild; header.tabIndex = -1; header.focus();
  u.polls[0](); await tick();
  assert.equal(header.firstChild, before); assert.equal(u.doc.activeElement, header);
  u.tab('souls'); assert.equal(header.hidden, true);
});

test('approval needed and unsynced/stale lock state are the header ID arrays, never sync rows', async t => {
  const status = structuredClone(northwind);
  status.result.approval = { approved: ['oats.framework'], needed: ['nw.tools', 'oats.okf'] };
  status.result.packages = status.result.packages.map(pkg => pkg.id === 'oats.framework' ? pkg : { ...pkg, approved: null });
  status.result.unsynced = ['new.package']; status.result.stale = ['old.package'];
  const u = await setup(t, { deployment: () => ({ ...observed(), workspaceStatus: workspaceStatusData(status, northwindDir) }) });
  u.tab('capabilities'); await tick();
  const header = u.doc.querySelector('.deployment-header');
  assert.match(header.textContent, /Approval needed: nw\.tools, oats\.okf/);
  assert.match(header.textContent, /Declared but not locked \(run oats sync\): new\.package/);
  assert.match(header.textContent, /Locked but no longer declared \(run oats sync\): old\.package/);
  const approval = [...header.querySelectorAll('li')].filter(li => li.textContent.includes('Approval needed')).map(li => li.querySelector('strong').textContent);
  assert.deepEqual(approval, ['nw.tools', 'oats.okf']);
});

test('an unreachable workspace says module drift is not current, with the kernel reason', async t => {
  const u = await setup(t, { deployment: () => ({ ...observed(), reachable: { reachable: false, code: 'E_REMOTE_UNREADABLE', message: 'network' } }) });
  u.tab('capabilities'); await tick();
  assert.match(u.doc.querySelector('.deployment-header').textContent, /Workspace unreachable — module drift is not current\. E_REMOTE_UNREADABLE: network/);
});

for (const [name, deployment, expected] of [
  ['missing feature', { status: 'unavailable', reason: { code: 'E_DEPLOYMENT_FEATURE', message: 'x', feature: 'instance-modules' } }, /does not advertise instance-modules/],
  ['kernel refusal', { status: 'unavailable', reason: { code: 'E_LOCAL_MISSING', message: 'no oats-local.yaml at this directory' } }, /E_LOCAL_MISSING: no oats-local\.yaml at this directory/],
  ['pending', { status: 'pending' }, /Reading the deployment/],
]) test(`unobserved deployment (${name}) is explained in the header and the soul roster, never shown as empty`, async t => {
  const u = await setup(t, { agents: [], deployment: () => deployment });
  assert.equal(u.doc.querySelector('h1').textContent, 'Workspace');
  assert.match(u.doc.querySelector('.souls-grid').textContent, expected);
  u.tab('capabilities'); await tick();
  const status = u.doc.querySelector('.deployment-header-status');
  assert.match(status.textContent, expected); assert.equal(status.getAttribute('role'), 'status');
});

const inventoryData = (context = '/team', capability = 'acquired.export') => ({ inventoryApi: 1, scope: { kind: 'classic', context },
  packages: [{ package: 'acquired.package', level: context, version: '1.0', capabilities: [capability], locked: true }],
  capabilities: [{ capability, package: 'acquired.package', level: context, installed: false, trusted: true, status: 'missing' }], legacy: [] });

test('classic inventory failure stays independent of the header and activation; explicit retry preserves scope', async t => {
  let failed = true;
  const u = await setup(t, { inventory: body => {
    if (failed) throw Object.assign(new Error('scope lock cannot be listed'), { code: 'invalid-lock' });
    return inventoryData(body.selector.context || '/team');
  } });
  u.tab('capabilities'); await tick();
  assert.match(u.doc.querySelector('.inventory-status').textContent, /invalid-lock/);
  assert.equal(u.doc.querySelector('.inventory-table'), null);
  assert.match(u.doc.querySelector('.discovery-table').textContent, /fixture.notes/);
  assert.equal(u.doc.querySelector('.deployment-header h2').textContent, 'northwind');
  failed = false; u.doc.querySelector('.inventory-refresh').click(); await tick();
  const rows = u.doc.querySelector('.inventory-capabilities');
  assert.match(rows.textContent, /acquired.export/); assert.match(rows.textContent, /Installation: Not installed/);
  assert.match(rows.textContent, /Executable approval: Approved/); assert.match(rows.textContent, /Readiness: Unknown/);
  assert.equal(u.inspections().length, 1); assert.equal(u.inventories().length, 2);
  const details = rows.querySelector('details'); details.open = true; details.querySelector('summary').focus();
  u.polls[0](); await tick();
  assert.equal(u.doc.querySelector('.inventory-capabilities details'), details); assert.equal(details.open, true);
  assert.equal(u.doc.activeElement, details.querySelector('summary')); assert.equal(u.inventories().length, 2);
  u.change('.discovery-scope', '/team/one'); await tick();
  assert.deepEqual(u.inventories().at(-1).body, { action: 'list', selector: { context: '/team/one' } });
  assert.match(u.doc.querySelector('.inventory-note').textContent, /\/team\/one/);
});

test('accepted CLI without operations still reports list inventory; inspection failure cannot hide it', async t => {
  const u = await setup(t, { cli: { ...CLI, operationsApi: undefined, features: [] }, inventory: () => inventoryData() });
  u.tab('capabilities'); await tick();
  assert.equal(u.inspections().length, 0); assert.equal(u.inventories().length, 1);
  assert.match(u.doc.querySelector('.inventory-capabilities').textContent, /acquired.export/);
  assert.match(u.doc.querySelector('.discovery-status').textContent, /does not support capability inspection/);
});

for (const change of ['scope', 'CLI']) for (const outcome of ['success', 'rejection']) test(`inventory ${outcome} cannot beat newer ${change} failure in Workspace`, async t => {
  const requests = [];
  const u = await setup(t, { inventory: body => { const d = deferred(); requests.push({ ...d, body }); return d.promise; } });
  u.tab('capabilities'); assert.equal(requests.length, 1);
  if (change === 'scope') u.change('.discovery-scope', '/team/one');
  else await u.setCli({ ...CLI, bin: '/fixture/other-oats' });
  assert.equal(requests.length, 2);
  requests[1].reject(new Error('current inventory failed')); await tick();
  if (outcome === 'success') requests[0].resolve(inventoryData('/team', 'stale.export')); else requests[0].reject(new Error('stale inventory failed'));
  await tick();
  assert.match(u.doc.querySelector('.inventory-status').textContent, /current inventory failed/);
  assert.equal(u.doc.querySelector('.inventory-table'), null);
  assert.doesNotMatch(u.doc.querySelector('.deployment-inventory').textContent, /stale.export|stale inventory failed/);
  assert.ok(u.doc.querySelector('.deployment-header h2')); assert.ok(u.doc.querySelector('.discovery-table'));
});

for (const outcome of ['success', 'rejection']) test(`CLI A→B→A supersedes old inspection ${outcome}, not just the new list section`, async t => {
  const requests = [];
  const u = await setup(t, { inspect: () => { const d = deferred(); requests.push(d); return d.promise; } });
  u.tab('capabilities');
  await u.setCli({ ...CLI, bin: '/fixture/other-oats' }); await u.setCli(CLI);
  assert.equal(requests.length, 3);
  requests[2].reject(new Error('latest inspection failed')); await tick();
  requests[1].resolve(inspectData('other-cli'));
  if (outcome === 'success') requests[0].resolve(inspectData('old-cli')); else requests[0].reject(new Error('old-cli failure'));
  await tick();
  assert.match(u.doc.querySelector('.discovery-status').textContent, /latest inspection failed/);
  assert.equal(u.doc.querySelector('.discovery-table'), null);
  assert.ok(u.doc.querySelector('.inventory-table')); assert.ok(u.doc.querySelector('.deployment-header h2'));
});

test('shell feature-detect removes duplicate selector; standalone selection uses literal safe ids', async t => {
  const evil = 'w"><img src=x onerror=evil()>';
  const u = await setup(t, { shell: false, workspaces: [{ id: '/team', name: 'Team' }, { id: evil, name: '<script>literal</script>' }] });
  assert.equal(u.doc.querySelector('.wssel').style.display, '');
  assert.equal(u.doc.querySelector('img,script'), null);
  u.change('.wssel', evil); await tick();
  assert.equal(currentWorkspace(), evil);
  assert.equal(u.doc.querySelector('.wssel').options[1].value, evil);
  u.ctx.hasWorkspaceSwitcher = true; u.polls[0](); await tick();
  assert.equal(u.doc.querySelector('.wssel').style.display, 'none');
});

for (const order of ['old-first', 'new-first']) for (const outcome of ['success', 'rejection']) test(`scope races discard old ${outcome} (${order}) on both capabilities and sources`, async t => {
  const requests = [];
  const u = await setup(t, { agents: [soul('/team/one/agents'), soul('/team/two/agents')], inspect: body => { const d = deferred(); requests.push({ ...d, body }); return d.promise; } });
  u.tab('capabilities');
  u.change('.discovery-scope', '/team/two');
  assert.deepEqual(requests.map(r => r.body.selector), [{}, { context: '/team/two' }]);
  u.tab('sources');
  const settleOld = async () => {
    if (outcome === 'success') requests[0].resolve(inspectData('old-scope')); else requests[0].reject(new Error('old failure'));
    await tick();
    // Force a projection too: a stale assignment hidden by a later guard is
    // still corruption when the user next filters the current result.
    u.doc.querySelector('.discovery-filter').dispatchEvent(new u.dom.window.Event('input'));
  };
  if (order === 'old-first') {
    await settleOld();
    assert.equal(u.doc.querySelector('.discovery-status').textContent, 'Loading inspection…');
    assert.equal(u.doc.querySelector('.discovery-table'), null);
  }
  requests[1].resolve(inspectData('new-scope')); await tick();
  if (order === 'new-first') await settleOld();
  const text = u.doc.querySelector('.workspace-discovery').textContent;
  assert.match(text, /new-scope/); assert.doesNotMatch(text, /old-scope|old failure/);
  assert.equal(u.doc.querySelector('.discovery-scope').value, '/team/two');
  assert.equal(u.inspections().every(c => c.body.action === 'inspect'), true);
});

for (const outcome of ['success', 'rejection']) test(`A → B → A workspace generation rejects prior inspection ${outcome}`, async t => {
  const requests = [];
  const u = await setup(t, { inspect: () => { const d = deferred(); requests.push(d); return d.promise; } });
  u.tab('capabilities');
  setWorkspace('/other'); await tick();
  setWorkspace('/team'); await tick();
  assert.equal(requests.length, 3);
  requests[2].resolve(inspectData('current-generation')); await tick();
  requests[1].resolve(inspectData('other-workspace'));
  if (outcome === 'success') requests[0].resolve(inspectData('old-generation')); else requests[0].reject(new Error('old-generation failure'));
  await tick();
  assert.match(u.doc.querySelector('.workspace-discovery').textContent, /current-generation/);
  assert.doesNotMatch(u.doc.querySelector('.workspace-discovery').textContent, /other-workspace|old-generation/);
});

for (const outcome of ['success', 'rejection']) test(`roster per-path tickets reject same-workspace stale ${outcome}`, async t => {
  const u = await setup(t);
  const requests = [];
  u.setLoaders(() => { const d = deferred(); requests.push(d); return d.promise; });
  u.polls[0](); u.polls[0]();
  requests[1].resolve({ agents: [soul('/team/current/agents', 'new-roster')] }); await tick();
  if (outcome === 'success') requests[0].resolve({ agents: [soul('/team/stale/agents', 'old-roster')] }); else requests[0].reject(new Error('old-roster failure'));
  await tick();
  assert.match(u.doc.querySelector('.souls-grid').textContent, /new-roster/);
  assert.doesNotMatch(u.doc.querySelector('.souls').textContent, /old-roster/);
});

for (const cli of [null, { ok: false }, { ok: true, operationsApi: 1, features: [] }]) test(`CLI ${JSON.stringify(cli)} cannot fabricate inspection and can recover`, async t => {
  const u = await setup(t, { cli, pendingCli: cli === null });
  u.tab('capabilities'); await tick();
  assert.equal(u.inspections().length, 0);
  assert.equal(u.doc.querySelector('#workspace-tab-capabilities .workspace-count').textContent, '');
  assert.match(u.doc.querySelector('.discovery-status').textContent, /CLI|OATS/);
  await u.setCli(CLI); await tick();
  assert.equal(u.inspections().length, 1);
  assert.match(u.doc.querySelector('.workspace-discovery').textContent, /fixture.notes/);
});

test('actual registered remote panel projection permits negotiated read-only inspection', async t => {
  const panel = remotePanel({ id: 'host', server: 'host', registrationPresent: true,
    target: { workspace: '/remote/project' }, probe: { ok: true }, instances: [] });
  const u = await setup(t, { getPanel: () => panel });
  u.tab('capabilities'); await tick();
  assert.equal(u.inspections().length, 1);
  assert.equal(u.inspections()[0].body.action, 'inspect');
  await u.setCli({ ...CLI, remote: [] });
  u.tab('sources'); await tick();
  assert.equal(u.inspections().length, 1, 'losing remote negotiation does not send another request');
  assert.match(u.doc.querySelector('.discovery-status').textContent, /registered server/);
});

test('remote observation-only scope never inspects without registered remote operations', async t => {
  const u = await setup(t, { workspace: { remote: true, server: 'remote', registrationPresent: false } });
  u.tab('sources'); await tick();
  assert.equal(u.inspections().length, 0);
  assert.match(u.doc.querySelector('.discovery-status').textContent, /registered server/);
});

test('unknown fields, hostile provenance and empty results stay truthful, literal and recoverable', async t => {
  let data = { operationsApi: 1, capabilities: [{ id: '<img src=x onerror=evil()>', source: { url: 'javascript:evil()' } }] };
  const u = await setup(t, { inspect: () => data });
  u.tab('capabilities'); await tick();
  assert.equal(u.doc.querySelector('img,script'), null);
  assert.match(u.doc.querySelector('.discovery-table').textContent, /Installation: Not reported.*Health: Not reported.*Trust: Not reported.*Activation: Not reported/s);
  assert.doesNotMatch(u.doc.querySelector('.discovery-table').textContent, /ready|enrolled|configured/i);
  u.tab('sources'); assert.match(u.doc.querySelector('.discovery-table').textContent, /javascript:evil\(\)/);
  assert.equal(u.doc.querySelector('.workspace-discovery a'), null);
  data = { operationsApi: 1, capabilities: [] }; u.click('Refresh inspection'); await tick(); await tick();
  assert.match(u.doc.querySelector('.workspace-discovery').textContent, /No capabilities reported/);
  assert.ok(u.doc.querySelector('.discovery-table thead'), 'empty table keeps its header');
  data = { operationsApi: 0 }; u.click('Refresh inspection'); await tick(); await tick();
  assert.match(u.doc.querySelector('.discovery-status').textContent, /does not support/);
  assert.equal(u.doc.querySelector('#workspace-tab-capabilities .workspace-count').textContent, '');
  data = inspectData(); u.click('Refresh inspection'); await tick(); await tick();
  assert.match(u.doc.querySelector('.discovery-table').textContent, /fixture.notes/);
});

test('subtab preselection is consumed on mount/current view, drops stale generations and never spawns', async t => {
  const u = await setup(t, { beforeMount: () => spawn.preselectWorkspaceTab('sources') });
  await tick(); assert.equal(u.doc.getElementById('workspace-tab-sources').getAttribute('aria-selected'), 'true');
  assert.equal(spawn.preselectWorkspaceTab('knowledge'), false);
  spawn.preselectWorkspaceTab('souls'); assert.equal(u.doc.querySelector('.souls-grid').hidden, false);
  spawn.unmount(); spawn.preselectWorkspaceTab('sources'); setWorkspace('/other');
  spawn.mount(u.doc.querySelector('#host'), u.ctx); await tick();
  assert.equal(u.doc.getElementById('workspace-tab-souls').getAttribute('aria-selected'), 'true');
  assert.equal(u.doc.querySelector('.spawn-dialog'), null);
  assert.ok(u.calls.filter(c => c.method === 'POST').every(c => c.body.action === 'inspect'));
});

test('root/name/host focus survives polling, inspector close and modal close without selecting a twin', async t => {
  const evil = 'dev"<unsafe>';
  const agents = [soul('/team/one/agents', evil), soul('/team/two/agents', evil)];
  const u = await setup(t, { agents });
  let card = [...u.doc.querySelectorAll('.soul-card')].find(c => c.dataset.root === '/team/two/agents');
  card.focus(); u.polls[0](); await tick();
  assert.equal(u.doc.activeElement.dataset.root, '/team/two/agents');
  card = u.doc.activeElement;
  card.click(); await tick();
  assert.equal(u.doc.querySelector('.soul-inspector').hidden, false);
  assert.equal(u.doc.querySelector('.souls-grid').hidden, false, 'inspector does not replace the grid');
  assert.equal(u.inspections().at(-1).body.selector.agentsRoot, '/team/two/agents');
  assert.equal(u.doc.querySelector('img'), null);
  u.doc.querySelector('[aria-label="Close inspector"]').click();
  assert.equal(u.doc.activeElement.dataset.root, '/team/two/agents');
  launchSoul(u.doc, u.doc.activeElement); await tick();
  u.doc.querySelector('.fcancel').click();
  assert.equal(u.doc.querySelector('.soul-card.open').dataset.root, '/team/two/agents');
  assert.equal(u.doc.activeElement.closest('.soul-inspector'), u.doc.querySelector('.soul-inspector'));
  assert.equal(u.doc.activeElement.classList.contains('spawn-act'), true);
  assert.ok([...u.doc.querySelectorAll('.brain-act')].every(b => b.disabled), 'legacy name-only Files boundary fails closed for twins');
  assert.deepEqual(u.files, []); assert.deepEqual(u.opens, []);
});

test('future-default and instruction drafts are stable under roster polling and do not become instance snapshots', async t => {
  const u = await setup(t);
  u.doc.querySelector('.soul-card').click(); await tick();
  assert.match(u.doc.querySelector('.soul-inspector').textContent, /future instances/);
  assert.match(u.doc.querySelector('.soul-inspector').textContent, /AGENTS.md \/ instructions/);
  u.click('Edit defaults'); const model = u.doc.querySelector('[name=model]'); model.value = 'unsaved';
  u.polls[0](); await tick();
  assert.equal(u.doc.querySelector('[name=model]'), model); assert.equal(model.value, 'unsaved');
  u.click('Cancel'); u.click('Edit instructions'); const text = u.doc.querySelector('.inspector-form textarea'); text.value = 'unsaved instructions';
  u.polls[0](); await tick();
  assert.equal(u.doc.querySelector('.inspector-form textarea'), text); assert.equal(text.value, 'unsaved instructions');
  assert.equal(u.inspections().length, 1, 'polling never refreshes the inspector or writes a draft');
  assert.ok(u.inspections().every(c => c.body.action === 'inspect'));
});

test('attached launch/schedule and capability downgrade remain disabled in the inspector', async t => {
  const agent = { ...soul(), work: 'attached' };
  const u = await setup(t, { agents: [agent], inspect: () => ({ ...inspectData(), souls: [{ ...inspectData().souls[0], work: 'attached' }] }) });
  u.doc.querySelector('.soul-card').click(); await tick();
  assert.ok([...u.doc.querySelectorAll('.soul-inspector [data-launch]')].every(el => el.disabled));
  assert.equal(u.doc.querySelector('.spawn-act').disabled, true);
  await u.setCli({ ok: false });
  assert.ok([...u.doc.querySelectorAll('.soul-inspector [data-launch]')].every(el => el.disabled));
});

test('discovery facts never manufacture the mock readiness quartet or source memberships', () => {
  assert.deepEqual(capabilityFacts({}), [['Installation', 'Not reported'], ['Health', 'Not reported'], ['Trust', 'Not reported'], ['Activation', 'Not reported']]);
  assert.deepEqual(installedSources({ capabilities: [{ id: 'one' }] }), [{ id: 'one', version: 'Not reported', source: 'Not reported', origin: 'Not reported' }]);
  const inspector = readFileSync(new URL('../renderer/soul-inspector.mjs', import.meta.url), 'utf8');
  const view = readFileSync(new URL('../renderer/views/spawn.mjs', import.meta.url), 'utf8');
  assert.match(inspector, /grid-template-columns:minmax\(0,1fr\) 340px/);
  assert.doesNotMatch(inspector, /310px|\.souls-grid \{ display:none/);
  assert.match(view, /minmax\(min\(230px, 100%\), 1fr\)/);
  assert.match(view, /var\(--primary-bg\).*var\(--primary-fg\)/);
  assert.doesNotMatch(view, /SOUL\.md/);
});

for (const outcome of ['success', 'rejection']) test(`cancelled Spawn ${outcome} cannot clear, unlock or navigate from a newer modal`, async t => {
  const pending = deferred();
  const u = await setup(t, { spawn: () => pending.promise });
  launchSoul(u.doc); await tick();
  const old = u.doc.querySelector('.spawn-dialog'); old.querySelector('.fspawn').click();
  old.querySelector('.fcancel').click();
  launchSoul(u.doc);
  const current = u.doc.querySelector('.spawn-dialog'); current.querySelector('.ftask').value = 'current task';
  if (outcome === 'success') pending.resolve({ instance: 'old-result' }); else pending.reject(new Error('old failure'));
  await tick();
  assert.equal(u.doc.querySelector('.spawn-dialog'), current);
  assert.equal(current.querySelector('.ftask').value, 'current task');
  assert.equal(current.querySelector('.fstatus').textContent, '');
  assert.equal(current.querySelector('.fspawn').disabled, false);
  assert.deepEqual(u.opens, []);
  const before = u.calls.length;
  old.querySelector('.fspawn').dispatchEvent(new u.dom.window.Event('click'));
  await tick(); assert.equal(u.calls.length, before, 'old submit cannot apply its draft to the current selection');
});

for (const outcome of ['success', 'rejection']) test(`selected inspector ignores late ${outcome} after another soul is selected`, async t => {
  const old = deferred();
  const agents = [soul('/team/one/agents', 'old-soul'), soul('/team/two/agents', 'new-soul')];
  const u = await setup(t, { agents, inspect: body => body.selector.soul === 'old-soul' ? old.promise : inspectData('new-capability', body.selector) });
  [...u.doc.querySelectorAll('.soul-card')].find(c => c.dataset.agent === 'old-soul').click();
  [...u.doc.querySelectorAll('.soul-card')].find(c => c.dataset.agent === 'new-soul').click(); await tick();
  if (outcome === 'success') old.resolve(inspectData('old-capability')); else old.reject(new Error('old-inspection-failure'));
  await tick();
  assert.equal(u.doc.querySelector('.inspector-head h2').textContent, 'new-soul');
  assert.match(u.doc.querySelector('.soul-inspector').textContent, /new-capability/);
  assert.doesNotMatch(u.doc.querySelector('.soul-inspector').textContent, /old-capability|old-inspection-failure/);
  assert.equal(u.doc.querySelector('.spawn-dialog'), null);
});

test('instance rows reflect exact root/host identity and open only read-only snapshots', async t => {
  const instance = { agent: 'dev', instance: 'dev-seat', agentsRoot: '/team/one/agents', home: '/team/one/agents/dev/instances/dev-seat', running: true };
  const u = await setup(t, { instances: [instance, { ...instance, agentsRoot: '/team/two/agents' }, { ...instance, server: 'another-host' }],
    inspect: body => body.selector.home ? { ...inspectData(), selected: { source: 'snapshot' }, snapshot: { instructions: { text: 'Captured instructions' } } } : inspectData() });
  assert.equal(u.doc.querySelector('.sactivity').textContent, '1 running · 1 instance');
  u.doc.querySelector('.soul-card').click(); await tick();
  const buttons = u.doc.querySelectorAll('.inspector-instance'); assert.equal(buttons.length, 1);
  buttons[0].click(); await tick();
  assert.deepEqual(u.inspections().at(-1).body.selector, { home: instance.home });
  assert.match(u.doc.querySelector('.soul-inspector').textContent, /Instance snapshot/);
  assert.match(u.doc.querySelector('.soul-inspector').textContent, /Captured instructions/);
  assert.equal(u.doc.querySelector('.soul-inspector [data-launch]'), null);
  assert.equal([...u.doc.querySelectorAll('.soul-inspector button')].some(el => el.textContent.startsWith('Edit')), false);
  assert.deepEqual(u.opens, []);
});

test('capability scope removal never resets a different soul draft while polling Souls', async t => {
  const u = await setup(t, { agents: [soul('/team/one/agents'), soul('/team/two/agents', 'other')] });
  u.tab('capabilities'); await tick(); u.change('.discovery-scope', '/team/two'); await tick();
  u.tab('souls'); u.doc.querySelector('.soul-card').click(); await tick(); u.click('Edit defaults');
  const draft = u.doc.querySelector('[name=model]'); draft.value = 'retain-me';
  u.setAgents([soul('/team/one/agents')]); u.polls[0](); await tick();
  assert.equal(u.doc.querySelector('[name=model]'), draft); assert.equal(draft.value, 'retain-me');
});

test('CLI health booleans are independent, tri-state facts, not illustrative trust or readiness', () => {
  for (const [installed, installation] of [[true, 'Installed'], [false, 'Not installed'], [undefined, 'Not reported']]) {
    for (const [trusted, trust] of [[true, 'Trusted'], [false, 'Not trusted'], [undefined, 'Not reported']]) {
      const cap = inspectData().capabilities[0];
      cap.health.installed = installed; cap.health.trusted = trusted;
      if (installed === undefined) delete cap.health.installed;
      if (trusted === undefined) delete cap.health.trusted;
      // Decoys are deliberately NOT the CLI contract and cannot override it,
      // including when the real field is absent.
      cap.trust = { executable: !trusted }; cap.health.trust = !trusted; cap.installed = !installed;
      assert.deepEqual(capabilityFacts(cap), [
        ['Installation', installation], ['Health', 'ok'], ['Trust', trust],
        ['Activation', 'Enabled'], ['Target', 'global'], ['Binding', '["global @ /team"]'],
      ]);
    }
  }
});

test('missing, untrusted and unknown artifacts retain reported row order and provenance without installed labels', async t => {
  const missing = inspectData('fixture.missing').capabilities[0];
  missing.health = { ...missing.health, status: 'missing', code: 'missing-capability-artifact',
    detail: 'capability fixture.missing is locked but not materialized', installed: false, installedIntegrity: null };
  const untrusted = inspectData('fixture.untrusted').capabilities[0];
  untrusted.health = { ...untrusted.health, status: 'untrusted', code: 'untrusted-surface', trusted: false };
  untrusted.activation = { ...untrusted.activation, enabled: false, target: 'none', provenance: [] };
  const data = { operationsApi: 1, capabilities: [missing, untrusted, { id: 'fixture.unknown' }] };
  const before = structuredClone(data);
  const u = await setup(t, { inspect: () => data });
  u.tab('capabilities'); await tick();
  const rows = [...u.doc.querySelectorAll('.discovery-table tbody tr')];
  assert.deepEqual(rows.map(row => row.querySelector('strong').textContent), data.capabilities.map(cap => cap.id));
  assert.match(rows[0].cells[1].textContent, /Installation: Not installed.*Health: missing.*Trust: Trusted.*Activation: Enabled/s);
  assert.match(rows[1].cells[1].textContent, /Installation: Installed.*Health: untrusted.*Trust: Not trusted.*Activation: Disabled/s);
  assert.match(rows[2].cells[1].textContent, /Installation: Not reported.*Health: Not reported.*Trust: Not reported.*Activation: Not reported/s);
  assert.match(rows[0].cells[1].textContent, /locked but not materialized/);
  assert.equal(u.doc.querySelector('#workspace-tab-capabilities .workspace-count').textContent, '3');
  assert.equal(u.doc.querySelector('#workspace-tab-sources .workspace-count').textContent, '2 reported', 'shared source is two reports, not two repositories');
  assert.doesNotMatch(u.doc.querySelector('.discovery-table').textContent, /installed capabilit|configured|enrolled|ready/i);
  assert.match(u.doc.querySelector('.deployment-inventory').textContent, /Readiness: Unknown/);
  u.tab('sources');
  assert.equal(u.doc.querySelector('.discovery-table caption').textContent, 'Reported source provenance');
  assert.equal(u.doc.querySelector('.discovery-table th').textContent, 'Capability');
  assert.deepEqual([...u.doc.querySelectorAll('.discovery-table tbody tr')].map(row => [...row.cells].slice(1).map(cell => cell.textContent)), [
    ['path:/fixture/source', 'installed'], ['path:/fixture/source', 'installed'], ['Not reported', 'Not reported'],
  ], 'origin=installed is literal CLI provenance even for a missing artifact, not a membership or installation claim');
  assert.doesNotMatch(u.doc.querySelector('.workspace-discovery').textContent, /installed capabilit/i);
  assert.deepEqual(data, before, 'projection does not modify the CLI response');
  assert.deepEqual(u.inspections().map(call => call.body.action), ['inspect']);
});

for (const invalidation of ['workspace', 'dispose']) for (const outcome of ['success', 'rejection']) test(`discovery ${invalidation} ownership blocks late ${outcome} independently of scope reset`, async t => {
  // Exercise this module directly: Spawn's reset also increments its local
  // ticket, which otherwise masks a missing workspace-generation guard here.
  const dom = new JSDOM('<header></header><section></section><main></main>');
  const doc = dom.window.document, previous = currentWorkspace(), pending = deferred();
  setWorkspace('/team'); await refreshCli({ api: async () => CLI });
  const calls = [];
  const discovery = createWorkspaceDiscovery(doc.querySelector('header'), doc.querySelector('section'), {
    soulsPanel: doc.querySelector('main'), ctx: { api: (path, opts) => {
      calls.push({ path, body: JSON.parse(opts.body) }); return pending.promise;
    } },
  });
  t.after(() => { discovery.dispose(); setWorkspace(previous); dom.window.close(); });
  discovery.updateRoster([soul()], { workspace: { id: '/team' } }); discovery.setTab('capabilities');
  assert.equal(calls.length, 1); assert.deepEqual(calls[0].body, { action: 'inspect', selector: {} });
  assert.match(calls[0].path, /ws=%2Fteam/);
  if (invalidation === 'workspace') { setWorkspace('/other'); setWorkspace('/team'); } else discovery.dispose();
  const before = doc.body.innerHTML; // dispose may synchronously remove child surfaces
  if (outcome === 'success') pending.resolve(inspectData('stale-result')); else pending.reject(new Error('stale failure'));
  await tick();
  assert.equal(doc.body.innerHTML, before, 'completion cannot repaint, update counts or release another owner’s loading state');
  doc.querySelector('.discovery-filter').dispatchEvent(new dom.window.Event('input'));
  assert.equal(doc.body.innerHTML, before, 'no stale result or failure can leak into a later projection either');
});

// Geometry stubs model the measured 1100px case: Sources is 73px wide but
// only its first 41px are in the tab-strip viewport. No browser layout claimed.
function tabGeometry(u) {
  const strip = u.doc.querySelector('.workspace-tabs');
  Object.defineProperties(strip, { clientWidth: { value: 225, configurable: true }, clientLeft: { value: 0 } });
  strip.getBoundingClientRect = () => ({ left: 100, right: 325, width: 225 });
  const widths = [80, 100, 73], starts = [0, 82, 184];
  const controls = [...strip.querySelectorAll('button')];
  controls.forEach((control, i) => { control.getBoundingClientRect = () => ({ left: 100 + starts[i] - strip.scrollLeft, right: 100 + starts[i] + widths[i] - strip.scrollLeft, width: widths[i] }); });
  // Any scrollIntoView could move the outer page. Only strip.scrollLeft is allowed.
  u.dom.window.HTMLElement.prototype.scrollIntoView = () => assert.fail('must not scroll ancestors');
  u.dom.window.scrollTo = () => assert.fail('must not scroll the window');
  const outer = u.doc.querySelector('.workspace-main'); outer.scrollTop = 87; strip.scrollTop = 5;
  const visible = control => Math.min(325, control.getBoundingClientRect().right) - Math.max(100, control.getBoundingClientRect().left);
  return { strip, controls, widths, visible, assertOuter() { assert.equal(outer.scrollTop, 87); assert.equal(strip.scrollTop, 5); } };
}

test('1100px Sources focus reveals all 73px in-strip without selecting, inspecting or moving outer scroll', async t => {
  const u = await setup(t), g = tabGeometry(u), source = g.controls[2];
  assert.equal(g.visible(source), 41);
  source.focus({ preventScroll: true });
  assert.equal(u.doc.activeElement, source); assert.equal(g.visible(source), 73); assert.equal(g.strip.scrollLeft, 32);
  assert.equal(source.getAttribute('aria-selected'), 'false', 'plain focus does not activate a section');
  assert.equal(u.inspections().length, 0); g.assertOuter();
  source.dispatchEvent(new u.dom.window.FocusEvent('focus'));
  assert.equal(g.strip.scrollLeft, 32, 'fully revealed tabs do not jitter');
});

test('Sources activation, repeated current-tab activation and keyboard movement reveal only the strip', async t => {
  const u = await setup(t), g = tabGeometry(u), [souls, caps, source] = g.controls;
  const input = u.doc.querySelector('.filter'); input.focus({ preventScroll: true });
  u.tab('sources'); await tick();
  assert.equal(u.doc.activeElement, input, 'programmatic current-tab activation must not steal focus');
  assert.equal(g.visible(source), 73);
  g.strip.scrollLeft = 0; spawn.preselectWorkspaceTab('sources');
  assert.equal(g.visible(source), 73, 'already-current tab activation also reveals after resize/strip scroll');
  assert.equal(u.doc.activeElement, input);
  const focusOptions = [];
  for (const control of g.controls) {
    const focus = control.focus.bind(control);
    control.focus = options => { focusOptions.push(options); focus(options); };
  }
  const key = (control, value) => control.dispatchEvent(new u.dom.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
  key(source, 'Home'); assert.equal(u.doc.activeElement, souls); assert.equal(g.strip.scrollLeft, 0);
  key(souls, 'End'); assert.equal(u.doc.activeElement, source); assert.equal(g.visible(source), 73);
  key(source, 'ArrowLeft'); assert.equal(u.doc.activeElement, caps);
  g.strip.scrollLeft = 0; key(caps, 'ArrowRight'); assert.equal(u.doc.activeElement, source); assert.equal(g.visible(source), 73);
  key(source, 'ArrowRight'); assert.equal(u.doc.activeElement, souls); assert.equal(g.strip.scrollLeft, 0);
  assert.ok(focusOptions.length >= 5 && focusOptions.every(options => options?.preventScroll === true));
  assert.equal(u.inspections().length, 1, 'same scope projection does not rerequest or mutate'); g.assertOuter();
});

test('settled Sources count growth keeps the current tab revealed without moving focus', async t => {
  const pending = deferred(), u = await setup(t, { inspect: () => pending.promise }), g = tabGeometry(u);
  u.tab('sources'); assert.equal(g.strip.scrollLeft, 32);
  const before = u.doc.activeElement;
  g.widths[2] = 147; pending.resolve(inspectData()); await tick();
  assert.equal(g.visible(g.controls[2]), 147); assert.equal(g.strip.scrollLeft, 106);
  assert.equal(u.doc.activeElement, before); g.assertOuter();
});

test('soul identity marks stay qualified and stable across reordered polling and selected inspection', async t => {
  const name = 'dev<img src=x>', agents = [
    { ...soul('/team/one/shared/agents', name), color: 'sage', runtime: 'claude' },
    { ...soul('/team/two/shared/agents', name), color: 'url(javascript:evil())', runtime: 'pi' },
    { ...soul('/team/two/shared/agents', name), server: 'remote-one', color: 'clay', runtime: 'codex' },
    { ...soul('/team/two/shared/agents', name), server: 'remote-two', runtime: '<svg onload=evil()>' },
  ];
  const u = await setup(t, { agents });
  const identity = card => JSON.stringify([card.dataset.root, card.dataset.agent, card.dataset.server]);
  const colors = () => Object.fromEntries([...u.doc.querySelectorAll('.soul-card')].map(card => [identity(card), card.querySelector('[data-avatar-color]').dataset.avatarColor]));
  const before = colors();
  u.setAgents([...agents].reverse()); u.polls[0](); await tick(); assert.deepEqual(colors(), before);
  for (const card of u.doc.querySelectorAll('.soul-card')) {
    card.click(); await tick();
    const avatar = card.querySelector('.soul-avatar'), selected = u.doc.querySelector('.inspector-head .soul-avatar');
    assert.equal(selected.dataset.avatarColor, avatar.dataset.avatarColor); assert.equal(selected.textContent, avatar.textContent);
    assert.equal(selected.getAttribute('aria-hidden'), 'true');
    assert.equal(u.doc.querySelector('.inspector-head h2').textContent, name);
    assert.equal(u.doc.querySelector('[name=color]'), null, 'no invented writable CLI field');
  }
  assert.equal(u.doc.querySelector('img,svg:not(.shell-icon),script,[data-runtime="<svg onload=evil()>"]'), null, 'only the vetted Lucide chrome renders SVG');
  assert.ok(u.calls.filter(call => call.method === 'POST').every(call => call.body.action === 'inspect'));
  assert.deepEqual(u.files, []); assert.deepEqual(u.opens, []);
});

test('capability marks use reported identity across sections, not display fallbacks or invented used-by souls', async t => {
  const capabilities = [{ id: 'fixture.notes', version: '1.2', source: '/source', usedBy: ['not-a-reported-membership'] }, {}];
  const u = await setup(t, { inspect: () => ({ operationsApi: 1, scope: { context: '/team' }, capabilities }) });
  u.tab('capabilities'); await tick();
  const marks = () => [...u.doc.querySelectorAll('.discovery-table .identity-mark')].map(el => [el.textContent, el.dataset.avatarColor]);
  const before = marks(); assert.equal(before.length, 2); assert.equal(before[1][0], '?');
  for (const row of u.doc.querySelectorAll('.discovery-table tbody tr')) {
    const identity = row.querySelector('.discovery-capability-name');
    assert.equal(identity.children.length, 2);
    assert.ok(identity.querySelector('.discovery-capability-copy > strong'));
    assert.ok(identity.querySelector('.discovery-capability-copy > small'), 'version shares the existing text stack, not a new row below the avatar');
    assert.equal(row.querySelector('.soul-avatar'), null);
  }
  u.tab('sources'); assert.deepEqual(marks(), before, 'display fallback Not reported is not a capability id');
  assert.doesNotMatch(u.doc.querySelector('.discovery-table').textContent, /not-a-reported-membership/);
  assert.equal(u.doc.querySelectorAll('.discovery-table .identity-mark').length, capabilities.length);
});
