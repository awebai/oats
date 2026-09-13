import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import * as spawn from '../renderer/views/spawn.mjs';
import { currentWorkspace, setWorkspace } from '../renderer/views/common.mjs';
import { refreshCli } from '../renderer/views/cli-status.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const CLI = { ok: true, bin: '/synthetic/oats', version: '0.22.19', relations: true,
  features: ['launch-config', 'session-start', 'session-restart'], remote: ['launch-config', 'roster'] };
const agent = { name: 'dev', agentsRoot: '/team/agents', work: 'worktree',
  // These roster fields are NOT an invocation resolved by the installed CLI.
  runtime: 'pi', model: 'raw-roster-model', yolo: true, launchConfig: 'inherited-wrapper' };

async function setup(t, { soul = agent, cli = CLI, models = () => ({ models: [] }), servers, result } = {}) {
  const dom = new JSDOM('<body><div id="host"></div></body>', { url: 'http://localhost' });
  const previous = { document: globalThis.document, window: globalThis.window, setInterval: globalThis.setInterval, ws: currentWorkspace() };
  globalThis.document = dom.window.document; globalThis.window = dom.window;
  const polls = [];
  globalThis.setInterval = fn => { polls.push(fn); return { fake: true }; };
  const calls = [], opens = [], views = [], notices = [];
  const ctx = { api: async (path, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ path, method: opts.method || 'GET', body });
    if (path === '/api/cli') return cli;
    if (path.startsWith('/api/agents')) return { agents: [soul] };
    if (path.startsWith('/api/panel')) return { workspace: { id: currentWorkspace() }, workspaces: [], instances: [
      { instance: 'anchor', agentsRoot: soul.agentsRoot, running: true },
      { instance: 'dev-new', agentsRoot: soul.agentsRoot, running: true, tmux: { session: 'synthetic-only' } },
    ] };
    if (path === '/api/servers') return servers ? servers() : { servers: [{ id: 'host', label: 'Remote', sshHost: 'synthetic.invalid' }] };
    if (path === '/api/models') return models(body);
    if (path === '/api/spawn') return result ? result(body) : { instance: 'dev-new', launched: true };
    // Deliberately answer config requests: thrown errors could be swallowed by
    // advisory loaders. The request ledger below proves ALL actions absent.
    if (path.startsWith('/api/launch-configs')) return { context: '/team', configurations: [{ name: 'inherited-wrapper', runtime: 'codex' }] };
    throw new Error(`Unexpected synthetic request: ${path}`);
  }, openTerminal: (...args) => opens.push(args), openView: view => views.push(view), notify: text => notices.push(text) };
  t.after(() => {
    spawn.unmount(); setWorkspace(previous.ws);
    globalThis.document = previous.document; globalThis.window = previous.window; globalThis.setInterval = previous.setInterval;
    dom.window.close();
  });
  setWorkspace(soul.server ? 'remote:host' : '/team');
  await refreshCli({ api: async () => cli });
  spawn.mount(dom.window.document.querySelector('#host'), ctx);
  await tick();
  const doc = dom.window.document;
  const open = () => { doc.querySelector('.spawn-act').click(); return doc.querySelector('.spawn-dialog'); };
  const change = (modal, selector, value) => {
    const field = modal.querySelector(selector); field.value = value;
    field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    field.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    return field;
  };
  const posts = () => calls.filter(c => c.path === '/api/spawn').map(c => c.body);
  return { dom, doc, calls, opens, views, notices, ctx, polls, open, change, posts };
}

function noConfigurationUI(modal) {
  assert.equal(modal.querySelector('.spawn-launch-configurations, .launch-config-fields, .launch-config-select, .launch-config-editor, .launch-preview, .launch-preview-output, .lc-save, .lc-remove'), null);
  assert.doesNotMatch(modal.textContent, /Manage launch configurations|Save configuration|Remove from this scope|Preview invocation|Configuration harness/);
}
function noConfigurationCalls(u) {
  assert.deepEqual(u.calls.filter(c => c.path.startsWith('/api/launch-configs')), [], 'Spawn never lists, sets, removes or previews launch configurations');
}
function noOverrides(body) {
  for (const key of ['launchConfig', 'runtime', 'model', 'yolo']) assert.equal(Object.hasOwn(body, key), false, `${key} is absent on the wire, not a synthesized default`);
}

for (const configured of [true, false]) test(`Spawn removes configuration UI and requests, preserving empty task and inherited defaults (configured=${configured})`, async t => {
  const u = await setup(t, { soul: configured ? agent : { ...agent, launchConfig: undefined, runtime: undefined, model: undefined } });
  let modal = u.open(); await tick();
  noConfigurationUI(modal);
  assert.match(modal.querySelector('.fruntime').labels[0].textContent, /soul defaults/);
  assert.equal(modal.querySelector('.fruntime').selectedOptions[0].textContent, 'Use soul defaults');
  assert.equal(modal.querySelector('.fmodel').placeholder, 'Use soul defaults');
  assert.match(modal.querySelector('.fmodel').labels[0].textContent, /soul defaults/);
  assert.doesNotMatch(modal.textContent, /raw-roster-model|inherited-wrapper|agent default \(pi\)/);
  assert.equal(u.calls.some(c => c.path === '/api/models'), false, 'raw roster defaults never imply a resolved model catalog');
  await u.polls[0](); await tick();
  assert.equal(u.doc.querySelector('.spawn-dialog'), modal, 'poll leaves the form intact');
  modal.querySelector('.fcancel').click(); modal = u.open(); await tick();
  noConfigurationUI(modal);
  modal.querySelector('.fspawn').click(); await tick();
  assert.deepEqual(u.posts(), [{ agent: 'dev', agentsRoot: '/team/agents', task: '' }]);
  noOverrides(u.posts()[0]);
  assert.equal(u.doc.querySelector('.spawn-dialog'), null);
  assert.deepEqual(u.opens, [[{ instance: 'dev-new', agentsRoot: '/team/agents' }, { quiet: true }]]);
  spawn.unmount(); await tick();
  noConfigurationCalls(u);
});

for (const yolo of [false, true]) test(`Spawn existing explicit fields, relation identity and wake schedule still pass through (yolo=${yolo})`, async t => {
  const u = await setup(t);
  const modal = u.open(); await tick();
  u.change(modal, '.fpurpose', 'review');
  u.change(modal, '.ftask', 'Review this change\nKeep the existing defaults.');
  u.change(modal, '.fruntime', 'claude');
  u.change(modal, '.fmodel', 'custom-model,another-model');
  u.change(modal, '.fyolo', String(yolo));
  u.change(modal, '.fbackend', 'herdr');
  u.change(modal, '.frelation', 'sibling');
  u.change(modal, '.frelto', 'anchor');
  modal.querySelector('.fwake-enabled').click();
  u.change(modal, '.fwake-cron', '0 * * * *');
  u.change(modal, '.fwake-tz', 'UTC');
  u.change(modal, '.fwake-message', 'Check pending work\nReport blockers.');
  await refreshCli({ api: async () => ({ ...CLI, features: [] }) });
  assert.equal(modal.querySelector('.fruntime').disabled, false, 'configuration capability changes cannot disable runtime choices');
  noConfigurationUI(modal);
  modal.querySelector('.fspawn').click(); await tick();
  assert.deepEqual(u.posts(), [{ agent: 'dev', agentsRoot: '/team/agents', purpose: 'review',
    task: 'Review this change\nKeep the existing defaults.', runtime: 'claude', model: 'custom-model,another-model', yolo, backend: 'herdr',
    relation: 'sibling', relativeTo: 'anchor', relativeRoot: '/team/agents',
    wake: { cron: '0 * * * *', tz: 'UTC', message: 'Check pending work\nReport blockers.', enabled: true },
  }]);
  noConfigurationCalls(u);
});

test('Spawn model-only override does not synthesize a runtime, permission choice or launchConfig:none', async t => {
  const u = await setup(t);
  const modal = u.open(); await tick();
  u.change(modal, '.fmodel', 'provider/custom,unlisted/fallback');
  modal.querySelector('.fspawn').click(); await tick();
  assert.deepEqual(u.posts(), [{ agent: 'dev', agentsRoot: '/team/agents', task: '', model: 'provider/custom,unlisted/fallback' }]);
  noConfigurationCalls(u);
});

test('Spawn clearing explicit fields restores omitted overrides without clearing inherited configuration', async t => {
  const u = await setup(t);
  const modal = u.open(); await tick();
  for (const [field, value] of [['.fruntime', 'codex'], ['.fmodel', 'custom'], ['.fyolo', 'false']]) {
    u.change(modal, field, value); u.change(modal, field, '');
  }
  await tick();
  assert.equal(modal.querySelector('datalist').children.length, 0);
  modal.querySelector('.fspawn').click(); await tick();
  noOverrides(u.posts()[0]);
  assert.equal(u.posts()[0].task, '');
  noConfigurationCalls(u);
});

for (const outcome of ['success', 'rejection']) test(`Spawn runtime catalog remains advisory and latest-intent safe on stale ${outcome}`, async t => {
  const requests = [];
  const u = await setup(t, { models: body => { const d = deferred(); requests.push({ ...d, body }); return d.promise; } });
  const modal = u.open(); await tick();
  u.change(modal, '.fruntime', 'pi');
  u.change(modal, '.fruntime', 'claude');
  assert.deepEqual(requests.map(r => r.body), [{ runtime: 'pi' }, { runtime: 'claude' }]);
  requests[1].resolve({ models: [{ id: 'sonnet' }] }); await tick();
  if (outcome === 'success') requests[0].resolve({ models: [{ id: 'stale' }] });
  else requests[0].reject(new Error('stale catalog failure'));
  await tick();
  assert.deepEqual([...modal.querySelectorAll('datalist option')].map(o => o.value), ['sonnet']);
  assert.equal(modal.querySelector('.fstatus').textContent, '');
  u.change(modal, '.fruntime', 'codex');
  requests[2].reject(new Error('catalog unavailable')); await tick();
  u.change(modal, '.fmodel', 'still-valid-free-text');
  modal.querySelector('.fspawn').click(); await tick();
  assert.deepEqual(u.posts(), [{ agent: 'dev', agentsRoot: '/team/agents', task: '', runtime: 'codex', model: 'still-valid-free-text' }]);
  noConfigurationCalls(u);
});

for (const boundary of ['defaults', 'server', 'reopen', 'workspace']) {
  for (const outcome of ['success', 'rejection']) test(`Spawn pending model ${outcome} cannot cross ${boundary}`, async t => {
    const pending = deferred();
    const u = await setup(t, { models: () => pending.promise });
    const modal = u.open(); await tick();
    u.change(modal, '.fruntime', 'pi');
    if (boundary === 'defaults') u.change(modal, '.fruntime', '');
    if (boundary === 'server') u.change(modal, '.fserver', 'host');
    if (boundary === 'reopen') { modal.querySelector('.fcancel').click(); u.open(); }
    if (boundary === 'workspace') { setWorkspace('/elsewhere'); await tick(); u.open(); }
    if (outcome === 'success') pending.resolve({ models: [{ id: 'stale' }] });
    else pending.reject(new Error('stale failure'));
    await tick();
    const active = u.doc.querySelector('.spawn-dialog');
    assert.equal(active.querySelector('datalist').children.length, 0);
    assert.equal(modal.querySelector('datalist').children.length, 0, 'even detached forms stay untouched');
    assert.equal(active.querySelector('.fstatus').textContent, '');
    noConfigurationCalls(u);
  });
}

test('Spawn server selection retains cross-scope relation guard and clears the local model catalog without launch-config support', async t => {
  const u = await setup(t, { cli: { ...CLI, features: [] }, models: () => ({ models: [{ id: 'local-only' }] }),
    result: () => ({ instance: 'remote-new', server: 'host' }) });
  const modal = u.open(); await tick();
  u.change(modal, '.fruntime', 'pi'); await tick();
  assert.equal(modal.querySelector('datalist').children.length, 1);
  u.change(modal, '.fserver', 'host');
  assert.equal(modal.querySelector('datalist').children.length, 0);
  u.change(modal, '.frelation', 'child'); u.change(modal, '.frelto', 'anchor');
  modal.querySelector('.fspawn').click(); await tick();
  assert.deepEqual(u.posts(), []);
  assert.match(modal.querySelector('.fstatus').textContent, /Select the server workspace/);
  u.change(modal, '.frelation', 'unrelated'); u.change(modal, '.fruntime', '');
  modal.querySelector('.fspawn').click(); await tick();
  assert.deepEqual(u.posts(), [{ agent: 'dev', agentsRoot: '/team/agents', task: '', serverId: 'host' }]);
  assert.match(modal.querySelector('.fstatus').textContent, /Attach with:/, 'older remote CLI fallback remains');
  assert.deepEqual(u.opens, []);
  noConfigurationCalls(u);
});

test('Spawn remote soul stays pinned to its host with exact remote relation root and no local probes', async t => {
  const remote = { ...agent, agentsRoot: '/remote/team/agents', remote: true, server: 'host' };
  const u = await setup(t, { soul: remote, servers: () => { throw new Error('listing unavailable'); },
    result: () => ({ instance: 'remote-new', server: 'host' }) });
  const modal = u.open(); await tick();
  assert.equal(modal.querySelector('.fserver').disabled, true);
  assert.equal(modal.querySelector('.fserver').value, 'host');
  u.change(modal, '.frelation', 'parent'); u.change(modal, '.frelto', 'anchor');
  modal.querySelector('.fspawn').click(); await tick();
  assert.deepEqual(u.posts(), [{ agent: 'dev', agentsRoot: '/remote/team/agents', task: '', serverId: 'host',
    relation: 'parent', relativeTo: 'anchor', relativeRoot: '/remote/team/agents' }]);
  assert.equal(u.calls.some(c => c.path === '/api/models' || c.path === '/api/servers'), false);
  noConfigurationUI(modal); noConfigurationCalls(u);
});

test('Spawn capability downgrade closes the dialog and a retained submit cannot mutate; souls remain observable', async t => {
  const u = await setup(t);
  const modal = u.open(); await tick();
  const submit = modal.querySelector('.fspawn');
  await refreshCli({ api: async () => ({ ok: false, code: 'cli-unavailable' }) });
  submit.click(); await tick();
  assert.equal(u.doc.querySelector('.spawn-dialog'), null);
  assert.equal(u.doc.querySelector('.spawn-act').disabled, true);
  assert.ok(u.doc.querySelector('.soul-card'));
  assert.deepEqual(u.posts(), []);
  noConfigurationCalls(u);
});

for (const outcome of ['success', 'rejection']) test(`Spawn late server-list ${outcome} cannot mutate a closed/replaced dialog`, async t => {
  const pending = deferred(); let requests = 0;
  const u = await setup(t, { servers: () => ++requests === 1 ? pending.promise : { servers: [{ id: 'current', label: 'Current', sshHost: 'synthetic.invalid' }] } });
  const old = u.open();
  old.querySelector('.fcancel').click();
  const modal = u.open(); await tick();
  if (outcome === 'success') pending.resolve({ servers: [{ id: 'stale', label: 'Stale', sshHost: 'synthetic.invalid' }] });
  else pending.reject(new Error('stale server-list failure'));
  await tick();
  assert.deepEqual([...modal.querySelector('.fserver').options].map(o => o.value), ['', 'current']);
  assert.deepEqual([...old.querySelector('.fserver').options].map(o => o.value), ['']);
  assert.equal(modal.querySelector('.fstatus').textContent, '');
  noConfigurationCalls(u);
});

test('Spawn partial wake failure restores defaults and cancels a pending explicit-runtime catalog without permitting a duplicate spawn', async t => {
  const pending = deferred();
  const u = await setup(t, { models: () => pending.promise,
    result: () => ({ instance: 'dev-new', wakeScheduleError: { message: 'Synthetic write failure' } }) });
  const modal = u.open(); await tick();
  u.change(modal, '.fruntime', 'pi');
  modal.querySelector('.fwake-enabled').click();
  u.change(modal, '.fwake-message', 'Check pending work');
  modal.querySelector('.fspawn').click(); await tick();
  assert.match(modal.querySelector('.fstatus').textContent, /Created dev-new.*wake schedule was not saved/);
  assert.equal(modal.querySelector('.fruntime').value, '');
  pending.resolve({ models: [{ id: 'old-explicit-runtime' }] }); await tick();
  assert.equal(modal.querySelector('datalist').children.length, 0);
  modal.querySelector('.fspawn').click(); await tick();
  assert.equal(u.posts().length, 1);
  assert.equal(modal.querySelector('.fspawn').disabled, true);
  const manage = [...modal.querySelectorAll('button')].find(b => b.textContent === 'View schedules');
  manage.click();
  assert.deepEqual(u.views, ['schedules']);
  noConfigurationCalls(u);
});
