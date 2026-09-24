import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { cliCapability } from '../cli-adapter.mjs';
import { capabilityRequest } from '../server/capabilities.mjs';
import { createSoulInspector } from '../renderer/soul-inspector.mjs';
import { setWorkspace } from '../renderer/views/common.mjs';
import { scheduleRequest } from '../server/schedules.mjs';
import { soulInspection, homeInspection, capturedRun } from './helpers/inspect-fixture.mjs';

const cli = { ok: true, bin: '/installed/oats', operationsApi: 2, scheduleApi: 1, features: ['operations', 'schedule'], remote: ['operations', 'schedule'] };
const workspace = { id: '/team', scope: '/team' };
const agents = ['one', 'two'].map(name => ({ name: 'dev', agentsRoot: `/team/${name}/agents`, workspace: `/team/${name}` }));
const home = '/team/two/agents/dev/instances/dev-seat';
const instances = [{ instance: 'dev-seat', home, agentsRoot: agents[1].agentsRoot, savedRoute: true }];
const envelope = result => ({ schemaVersion: 1, ok: true, result });

test('scope boundary keeps same-named souls distinct, rejects foreign homes and never falls back from an unregistered remote', async () => {
  const calls = [];
  const options = { workspace, cli, agents, instances, localCwd: '/local', invoke: async (bin, args) => { calls.push(args); return envelope({}); } };
  await capabilityRequest({ action: 'inspect', selector: { soul: 'dev', agentsRoot: agents[1].agentsRoot } }, options);
  assert.equal(calls[0].context, '/team/two'); assert.equal(calls[0].agentsRoot, agents[1].agentsRoot);
  await capabilityRequest({ action: 'inspect', selector: { home } }, options);
  assert.equal(calls.at(-1).context, undefined, 'exact home owns its context; agents root is not necessarily the work repo');
  assert.equal(calls.at(-1).localCwd, '/team');
  // Read-only boundary: no soul editing (edited in its repository) and no `oats use` (removed by v2).
  for (const action of ['set', 'use']) {
    await assert.rejects(capabilityRequest({ action, selector: { soul: 'dev', agentsRoot: agents[1].agentsRoot } }, options), { code: 'E_BAD_ARGS', message: 'Unknown capability action' });
  }
  await assert.rejects(capabilityRequest({ action: 'inspect', selector: { home: '/foreign' } }, options), /existing home/);
  // Inspection has no scope subject (operationsApi 2): a context selector is refused before any CLI call.
  await assert.rejects(capabilityRequest({ action: 'inspect', selector: { context: '/team' } }, options), /no scope subject/);
  await assert.rejects(capabilityRequest({ action: 'inspect' }, options), /no scope subject/);
  await assert.rejects(capabilityRequest({ action: 'inspect' }, { ...options, workspace: undefined }), /known workspace/);
  await assert.rejects(capabilityRequest({ action: 'inspect' }, { ...options, workspace: { ...workspace, remote: true } }), /registered server/);
  await assert.rejects(capabilityRequest({ action: 'inspect' }, { ...options, cli: { ...cli, operationsApi: undefined } }), /Update/);
  await capabilityRequest({ action: 'inspect', selector: { soul: 'dev', agentsRoot: agents[1].agentsRoot } }, { ...options, workspace: { ...workspace, remote: true, server: 'hetzner', registrationPresent: true } });
  assert.equal(calls.at(-1).server, 'hetzner'); assert.equal(calls.at(-1).context, '/team/two'); assert.equal(calls.at(-1).localCwd, '/local');
  assert.ok(calls.every(call => ['inspect', 'run'].includes(call.action)), 'only read and provider-operation calls reach the CLI');
});

test('adapter: inspect and provider operations only — soul set and use are refused before any CLI call', async () => {
  for (const action of ['set', 'use']) {
    await assert.rejects(cliCapability(cli.bin, { action, soul: 'dev', agentsRoot: '/team/two/agents' }, { exec: assert.fail }), { code: 'E_BAD_ARGS', message: 'Unknown capability action' });
  }
  let argv;
  await cliCapability(cli.bin, { action: 'inspect', context: '/remote/member', server: 'hetzner', soul: 'dev', agentsRoot: '/remote/member/agents', localCwd: '/local' },
    { exec(bin, args, opts, done) { argv = args; assert.equal(opts.cwd, '/local'); done(null, JSON.stringify({ schemaVersion: 1, ok: true, result: {} })); } });
  assert.deepEqual(argv, ['inspect', '--dir', '/remote/member', '--server', 'hetzner', '--soul', 'dev', '--agents-root', '/remote/member/agents', '--json']);
});

test('scheduled actions require an available declaration on the selected home', async () => {
  const options = { workspace, cli, instances, invoke: async (_, args) => envelope(args.spec), inspect: async () => ({ capabilities: [{ layer: 'knowledge', activation: { enabled: true }, operations: [{ name: 'digest', kind: 'action', available: true }] }] }) };
  const spec = { kind: 'operation', home, operation: 'knowledge:digest', cron: '0 * * * *', tz: 'UTC', enabled: true };
  assert.deepEqual(await scheduleRequest({ operation: 'add', id: 'digest', spec }, options), spec);
  await assert.rejects(scheduleRequest({ operation: 'add', id: 'digest', spec: { ...spec, operation: 'knowledge:invented' } }, options), /available provider/);
});

const tick = () => new Promise(resolve => setImmediate(resolve));
// operationsApi 2 inspections from the kernel capture (soul subject, or the seat's home):
// oats.okf's status/reindex are unavailable on a soul and available on a home.
function inspection(name = 'dev', source = 'config') {
  return source === 'snapshot' ? homeInspection(home, { instance: 'dev-seat', soul: 'dev' }) : soulInspection(name);
}
function ui(api) {
  setWorkspace('/team'); const dom = new JSDOM('<body><main><aside hidden></aside></main></body>'); const el = dom.window.document.querySelector('aside');
  const calls = [];
  const controller = createSoulInspector(el, { ctx: { api: async (url, opts) => { const body = JSON.parse(opts.body); calls.push({ url, ...body }); return api(body); } } });
  const click = text => { const b = [...el.querySelectorAll('button')].find(b => b.textContent === text); assert.ok(b, `button ${text}`); b.click(); };
  return { dom, el, controller, click, calls, close() { controller.dispose(); dom.window.close(); } };
}
const selection = { agent: { name: 'dev', agentsRoot: agents[1].agentsRoot }, selector: { soul: 'dev', agentsRoot: agents[1].agentsRoot } };

test('inspector ignores old responses and offers no in-place editing', async () => {
  let resolveOld;
  const view = ui(body => body.selector.soul === 'old' ? new Promise(resolve => { resolveOld = resolve; }) : inspection());
  try {
    void view.controller.show({ agent: { name: 'old' }, selector: { soul: 'old' } });
    await view.controller.show(selection); resolveOld(inspection('old')); await tick();
    assert.equal(view.el.querySelector('h2').textContent, 'dev');
    for (const label of ['Edit defaults', 'Edit instructions', 'Disable layer', 'Inherit', 'Disable here']) {
      assert.equal([...view.el.querySelectorAll('button')].some(b => b.textContent === label), false, label);
    }
    assert.equal(view.el.querySelector('form, textarea, input'), null, 'no editor');
    assert.ok(view.calls.every(c => c.action === 'inspect'));
  } finally { view.close(); }
});

test('instance knowledge comes from provider text, with no local path read or HTML interpretation', async () => {
  const view = ui(body => body.action === 'inspect' ? inspection('dev', 'snapshot') : capturedRun({ result: { summary: 'fixture knowledge status', documents: [{ label: 'Memory', kind: 'markdown', path: '/remote/MEMORY.md', text: '<img src=x onerror=evil()>\nProvider memory' }] } }));
  try {
    await view.controller.show({ instance: instances[0], selector: { home } }); view.click('View'); await tick();
    assert.match(view.el.textContent, /Provider memory/); assert.equal(view.el.querySelector('img'), null);
    assert.equal([...view.el.querySelectorAll('button')].some(b => b.textContent === 'Edit defaults' || b.textContent === 'Inherit'), false);
    assert.deepEqual(view.calls[1].selector, { home }); assert.equal(view.calls[1].operation, 'knowledge:status');
  } finally { view.close(); }
});

test('inspector preserves current provider, availability, kind and required-argument operation contracts', async () => {
  const value = inspection('dev', 'snapshot');
  const provider = value.capabilities.find(cap => cap.layer === 'knowledge');
  provider.operations.push(
    { name: 'search', kind: 'view', available: true, args: [{ name: 'query', flag: '--query', required: true }] },
    { name: 'unavailable', kind: 'action', available: false, reason: 'Provider is unavailable' },
  );
  value.capabilities.push(
    // A module that fills no layer is not a provider: its operations are not offered.
    { id: 'unbound.notes', version: '1.0.0', layer: null, from: null, settings: {}, missingRequires: [], operations: [{ name: 'unbound', kind: 'view', available: true }] },
  );
  const view = ui(body => body.action === 'inspect' ? value : capturedRun({ operation: 'knowledge:reindex', result: { digested: true } }));
  try {
    await view.controller.show({ instance: instances[0], selector: { home } });
    assert.deepEqual([...view.el.querySelectorAll('[data-operation]')].map(b => [b.dataset.operation, b.textContent]), [['knowledge:status', 'View'], ['knowledge:reindex', 'Run']]);
    assert.match(view.el.textContent, /requires arguments/);
    assert.match(view.el.textContent, /Provider is unavailable/);
    view.controller.syncAvailability();
    assert.equal(view.calls.length, 1, 'projecting operation controls never runs them');
    view.click('Run'); await tick();
    assert.deepEqual(view.calls[1], { url: '/api/capabilities?ws=%2Fteam', action: 'run', selector: { home }, operation: 'knowledge:reindex' });
    assert.deepEqual(JSON.parse(view.el.querySelector('.operation-output pre').textContent), { digested: true });
    assert.equal(view.calls.length, 2, 'optional args are not synthesized and completion does not rerun');
  } finally { view.close(); }
});
