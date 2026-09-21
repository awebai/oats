import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createSpawnLaunch } from '../renderer/spawn-launch.mjs';
import { currentWorkspace, setWorkspace } from '../renderer/views/common.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const selected = { soul: 'dev', agentsRoot: '/team/agents' };
const CLI = { ok: true, bin: '/fixture/oats', version: '0.24.6', runtimes: ['pi', 'codex'], runtimesSource: 'reported', features: ['operations', 'launch-config'], operationsApi: 1 };
const configs = name => ({ selected, configurations: [{ name, runtime: 'codex' }] });
const preview = model => ({ selected, model, modelSource: model ? 'explicit' : 'native default', preflight: [], ok: true });
const inspection = value => ({ operationsApi: 1, selected: { ...selected, source: 'config' }, problems: [], capabilities: [{ id: 'cap', health: { installed: value, trusted: value } }] });
function setup(t, { create = createSpawnLaunch } = {}) {
  const dom = new JSDOM('<body><section><select class="fruntime"><option value=""></option></select><input class="fmodel"><select class="fyolo"><option value=""></option></select><select class="fserver"><option value=""></option><option value="remote">Remote</option></select></section></body>');
  const doc = dom.window.document, modal = doc.querySelector('section'), before = currentWorkspace(); setWorkspace('/team');
  const make = tag => { const node = doc.createElement(tag); modal.append(node); return node; };
  const layout = { config: make('select'), refreshConfigs: make('button'), preview: make('button'), configStatus: make('p'), launchStatus: make('p'), defaultNote: make('p'), previewDetails: make('details'), syncRuntime() {}, closePopups() {} };
  const option = doc.createElement('option'); option.value = ''; layout.config.append(option); layout.previewDetails.append(doc.createElement('pre'));
  for (const key of ['installed', 'trusted', 'configured', 'enrolled']) { const node = make('span'); node.className = `spawn-${key}`; }
  let cli = CLI;
  const calls = [];
  const controller = create(modal, { layout, soul: { name: 'dev', agentsRoot: '/team/agents' }, workspace: () => ({ id: '/team' }), cli: () => cli, owns: () => true,
    ctx: { api: (path, opts) => { const pending = deferred(); calls.push({ path, body: JSON.parse(opts.body), ...pending }); return pending.promise; } } });
  t.after(() => { controller.dispose(); setWorkspace(before); dom.window.close(); });
  return { controller, layout, calls, modal, dom,
    sync: () => controller.sync(), changeCLI: () => { cli = { ...CLI, bin: '/fixture/other' }; controller.sync(); },
    changeModel: value => { const field = modal.querySelector('.fmodel'); field.value = value; field.dispatchEvent(new dom.window.Event('input')); field.dispatchEvent(new dom.window.Event('change')); },
  };
}

for (const outcome of ['success', 'rejection']) test(`late configuration-list ${outcome} cannot replace the newer CLI's list/error`, async t => {
  const u = setup(t); u.sync(); const old = u.calls.find(c => c.body.action === 'list');
  u.changeCLI(); const latest = u.calls.filter(c => c.body.action === 'list').at(-1);
  latest.reject(new Error('current list failure')); await tick();
  const before = u.modal.innerHTML;
  if (outcome === 'success') old.resolve(configs('stale')); else old.reject(new Error('old list failure'));
  await tick(); assert.equal(u.modal.innerHTML, before); assert.match(u.layout.configStatus.textContent, /current list failure/);
});

for (const outcome of ['success', 'rejection']) test(`capability observation ${outcome} checks owner epoch independently of caller reset`, async t => {
  const u = setup(t); u.sync(); const old = u.calls.find(c => c.body.action === 'inspect');
  u.changeCLI(); const latest = u.calls.filter(c => c.body.action === 'inspect').at(-1);
  latest.resolve(inspection(false)); await tick();
  if (outcome === 'success') old.resolve(inspection(true)); else old.reject(new Error('old inspect failure'));
  await tick(); assert.equal(u.modal.querySelector('.spawn-installed').textContent, 'installed: 0/1 inspected');
  assert.equal(u.modal.querySelector('.spawn-trusted').textContent, 'trusted: 0/1 inspected');
});

for (const action of ['list', 'preview', 'inspect']) for (const outcome of ['success', 'rejection']) test(`${action} ${outcome} cannot cross global workspace A→B→A without a local sync`, async t => {
  const u = setup(t); u.sync();
  if (action === 'preview') u.layout.preview.click();
  const pending = u.calls.find(c => c.body.action === action), before = u.modal.innerHTML;
  setWorkspace('/other'); setWorkspace('/team');
  if (outcome === 'success') pending.resolve(action === 'list' ? configs('stale') : action === 'preview' ? preview('stale') : inspection(true));
  else pending.reject(new Error('stale failure'));
  await tick(); assert.equal(u.modal.innerHTML, before);
});

test('an old list completion cannot overwrite/retry a newer explicit preview; list and preview feedback are separate', async t => {
  const u = setup(t); u.sync(); const list = u.calls.find(c => c.body.action === 'list');
  u.changeModel('custom'); const current = u.calls.find(c => c.body.action === 'preview');
  current.reject(new Error('current preview failure')); await tick();
  list.resolve(configs('personal')); await tick();
  assert.match(u.layout.launchStatus.textContent, /current preview failure/);
  assert.equal(u.calls.filter(c => c.body.action === 'preview').length, 1, 'no implicit replay from late list');
  assert.equal(u.layout.configStatus.textContent, ''); assert.equal(u.layout.preview.disabled, false);
  u.layout.refreshConfigs.click(); u.calls.filter(c => c.body.action === 'list').at(-1).reject(new Error('config unavailable')); await tick();
  assert.match(u.layout.configStatus.textContent, /config unavailable/);
  assert.match(u.layout.launchStatus.textContent, /current preview failure/);
});

test('typing invalidates a pending preview without CLI fan-out or a permanently disabled Retry', async t => {
  const u = setup(t); u.sync(); u.layout.preview.click();
  const old = u.calls.find(c => c.body.action === 'preview'); assert.equal(u.layout.preview.disabled, true);
  const field = u.modal.querySelector('.fmodel'); field.value = 'draft'; field.dispatchEvent(new u.dom.window.Event('input'));
  assert.equal(u.layout.preview.disabled, false); assert.equal(u.layout.launchStatus.textContent, '');
  old.resolve(preview('old')); await tick();
  assert.doesNotMatch(u.layout.defaultNote.textContent, /Resolved model: old/);
  assert.equal(u.calls.filter(c => c.body.action === 'preview').length, 1);
});

test('native default is shown only from preview provenance and never becomes a model override', async t => {
  const u = setup(t); u.sync(); u.layout.preview.click();
  const call = u.calls.find(c => c.body.action === 'preview'); assert.deepEqual(call.body.choices, {});
  call.resolve(preview(null)); await tick(); assert.match(u.layout.defaultNote.textContent, /native default/);
  assert.equal(u.modal.querySelector('.fmodel').value, '');
});

async function mutatedCreate(oldText, replacement) {
  let source = readFileSync(new URL('../renderer/spawn-launch.mjs', import.meta.url), 'utf8'); assert.ok(source.includes(oldText));
  source = source.replaceAll(oldText, replacement).replace('"./views/common.mjs"', JSON.stringify(new URL('../renderer/views/common.mjs', import.meta.url).href))
    .replace("'./views/common.mjs'", JSON.stringify(new URL('../renderer/views/common.mjs', import.meta.url).href));
  return (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).createSpawnLaunch;
}
for (const outcome of ['success', 'rejection']) test(`list ${outcome} race assertion detects weakened generation guards`, async t => {
  const create = await mutatedCreate('!current(owner, gen) || ticket !== listTicket', '!alive || workspaceGeneration() !== gen || !owns()');
  const u = setup(t, { create }); u.sync(); const old = u.calls.find(c => c.body.action === 'list');
  u.changeCLI(); u.calls.filter(c => c.body.action === 'list').at(-1).reject(new Error('current list failure')); await tick();
  if (outcome === 'success') old.resolve(configs('stale')); else old.reject(new Error('old list failure'));
  await tick(); assert.throws(() => assert.match(u.layout.configStatus.textContent, /current list failure/));
});

test('workspace race assertion detects loss of the global generation check without local reset', async t => {
  const create = await mutatedCreate('workspaceGeneration() === gen && ', '');
  const u = setup(t, { create }); u.sync(); const old = u.calls.find(c => c.body.action === 'inspect');
  setWorkspace('/other'); setWorkspace('/team'); old.resolve(inspection(true)); await tick();
  assert.throws(() => assert.equal(u.modal.querySelector('.spawn-installed').textContent, 'installed: unknown'));
});

for (const outcome of ['success', 'rejection']) test(`preview ${outcome} race assertion detects weakened request ticket`, async t => {
  const create = await mutatedCreate('ticket !== previewTicket', 'false');
  const u = setup(t, { create }); u.sync(); u.layout.preview.click(); const old = u.calls.find(c => c.body.action === 'preview');
  u.changeModel('new'); u.calls.filter(c => c.body.action === 'preview').at(-1).reject(new Error('current failure')); await tick();
  if (outcome === 'success') old.resolve(preview('old')); else old.reject(new Error('old failure'));
  await tick(); assert.throws(() => assert.match(u.layout.launchStatus.textContent, /current failure/));
});
for (const outcome of ['success', 'rejection']) test(`observation ${outcome} race assertion detects weakened epoch`, async t => {
  const create = await mutatedCreate('epoch === owner && ', '');
  const u = setup(t, { create }); u.sync(); const old = u.calls.find(c => c.body.action === 'inspect');
  u.changeCLI(); u.calls.filter(c => c.body.action === 'inspect').at(-1).resolve(inspection(false)); await tick();
  if (outcome === 'success') old.resolve(inspection(true)); else old.reject(new Error('old failure'));
  await tick(); assert.throws(() => assert.equal(u.modal.querySelector('.spawn-installed').textContent, 'installed: 0/1 inspected'));
});
