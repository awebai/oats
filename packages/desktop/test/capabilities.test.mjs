import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { cliCapability } from '../cli-adapter.mjs';
import { capabilityRequest } from '../server/capabilities.mjs';
import { createSoulInspector } from '../renderer/soul-inspector.mjs';
import { setWorkspace } from '../renderer/views/common.mjs';
import { scheduleRequest } from '../server/schedules.mjs';

const cli = { ok: true, bin: '/installed/oats', operationsApi: 1, scheduleApi: 1, features: ['operations', 'schedule'], remote: ['operations', 'schedule'] };
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
  await assert.rejects(capabilityRequest({ action: 'set', selector: { soul: 'dev' } }, options), /one soul/);
  await assert.rejects(capabilityRequest({ action: 'use', selector: { soul: 'dev', agentsRoot: agents[1].agentsRoot }, binding: { action: 'none', layer: 'knowledge' } }, options), /whole configuration scope/);
  await assert.rejects(capabilityRequest({ action: 'inspect', selector: { home: '/foreign' } }, options), /existing home/);
  await assert.rejects(capabilityRequest({ action: 'use', selector: { home } }, options), /snapshot is read-only/);
  await assert.rejects(capabilityRequest({ action: 'inspect' }, { ...options, workspace: undefined }), /known workspace/);
  await assert.rejects(capabilityRequest({ action: 'inspect' }, { ...options, workspace: { ...workspace, remote: true } }), /registered server/);
  await assert.rejects(capabilityRequest({ action: 'inspect' }, { ...options, cli: { ...cli, operationsApi: undefined } }), /Update/);
  await capabilityRequest({ action: 'inspect', selector: { soul: 'dev', agentsRoot: agents[1].agentsRoot } }, { ...options, workspace: { ...workspace, remote: true, server: 'hetzner', registrationPresent: true } });
  assert.equal(calls.at(-1).server, 'hetzner'); assert.equal(calls.at(-1).context, '/team/two'); assert.equal(calls.at(-1).localCwd, '/local');
});

test('adapter preserves remote scope and literal instructions in a private file, cleaning after failure', async () => {
  let file, call;
  const text = '# Literal\n`code` $(not a command) <tag>\n';
  const result = await cliCapability(cli.bin, { action: 'set', context: '/remote/member', server: 'hetzner', soul: 'dev', agentsRoot: '/remote/member/agents', localCwd: '/local', fields: { model: '', description: '', instructions: text, yolo: true } }, {
    exec(bin, argv, opts, done) {
      call = { argv, opts }; file = argv[argv.indexOf('--instructions-file') + 1];
      assert.equal(readFileSync(file, 'utf8'), text); assert.equal(statSync(file).mode & 0o777, 0o600);
      done(new Error('failed'), JSON.stringify({ schemaVersion: 1, ok: false, error: { code: 'E_WRITE', message: 'write failed' } }));
    },
  });
  assert.equal(result.ok, false); assert.equal(existsSync(file), false); assert.equal(call.opts.cwd, '/local'); assert.equal(call.opts.shell, false);
  assert.ok(call.argv.includes('--no-description')); assert.ok(call.argv.includes('--no-model')); assert.ok(call.argv.includes('--yolo'));
  assert.equal(call.argv[call.argv.indexOf('--dir') + 1], '/remote/member');
  assert.equal(call.argv[call.argv.indexOf('--server') + 1], 'hetzner');
  await assert.rejects(cliCapability(cli.bin, { action: 'set', soul: 'dev', fields: { runtime: '--force' } }, { exec: assert.fail }), /Invalid runtime/);
});

test('scheduled actions require an available declaration on the selected home', async () => {
  const options = { workspace, cli, instances, invoke: async (_, args) => envelope(args.spec), inspect: async () => ({ capabilities: [{ layer: 'knowledge', activation: { enabled: true }, operations: [{ name: 'digest', kind: 'action', available: true }] }] }) };
  const spec = { kind: 'operation', home, operation: 'knowledge:digest', cron: '0 * * * *', tz: 'UTC', enabled: true };
  assert.deepEqual(await scheduleRequest({ operation: 'add', id: 'digest', spec }, options), spec);
  await assert.rejects(scheduleRequest({ operation: 'add', id: 'digest', spec: { ...spec, operation: 'knowledge:invented' } }, options), /available provider/);
});

const tick = () => new Promise(resolve => setImmediate(resolve));
function inspection(name = 'dev', source = 'config') {
  return { operationsApi: 1, scope: { context: '/team/two' }, selected: { source }, layers: { knowledge: { id: 'test.notes' } }, souls: [{ name, agentsRoot: agents[1].agentsRoot, runtime: 'claude', model: 'opus', backend: 'tmux', yolo: true, description: 'Review', editable: { fields: ['runtime', 'model', 'backend', 'yolo', 'description'], instructions: true }, instructions: { text: '# Instructions' } }],
    snapshot: source === 'snapshot' ? { instructions: { text: '# Composed' }, drift: [] } : null,
    capabilities: [{ id: 'test.notes', version: '1.0', layer: 'knowledge', source: 'fixture', health: { status: 'ok' }, activation: { enabled: true, target: source === 'snapshot' ? 'snapshot' : 'soul:dev' }, operations: [{ name: 'inspect', kind: 'view', available: source === 'snapshot', reason: 'Needs a home', description: 'Read memory' }] }],
  };
}
function ui(api) {
  setWorkspace('/team'); const dom = new JSDOM('<body><main><aside hidden></aside></main></body>'); const el = dom.window.document.querySelector('aside');
  const calls = [];
  const controller = createSoulInspector(el, { ctx: { api: async (url, opts) => { const body = JSON.parse(opts.body); calls.push({ url, ...body }); return api(body); } } });
  const click = text => { const b = [...el.querySelectorAll('button')].find(b => b.textContent === text); assert.ok(b, `button ${text}`); b.click(); };
  return { dom, el, controller, click, calls, close() { controller.dispose(); dom.window.close(); } };
}
const selection = { agent: { name: 'dev', agentsRoot: agents[1].agentsRoot }, selector: { soul: 'dev', agentsRoot: agents[1].agentsRoot } };

test('inspector ignores old responses and keeps an explicit edit scoped to its original soul', async () => {
  let resolveOld;
  const view = ui(body => body.selector.soul === 'old' ? new Promise(resolve => { resolveOld = resolve; }) : inspection());
  try {
    void view.controller.show({ agent: { name: 'old' }, selector: { soul: 'old' } });
    await view.controller.show(selection); resolveOld(inspection('old')); await tick();
    assert.equal(view.el.querySelector('h2').textContent, 'dev');
    assert.equal([...view.el.querySelectorAll('button')].some(b => b.textContent === 'Disable layer'), false);
    view.click('Edit defaults'); view.el.querySelector('[name="model"]').value = 'sonnet'; view.click('Save defaults'); await tick();
    const write = view.calls.find(c => c.action === 'set'); assert.deepEqual(write.fields, { model: 'sonnet' }); assert.deepEqual(write.selector, selection.selector);
    assert.match(view.el.textContent, /Future instances/);
  } finally { view.close(); }
});

test('instance knowledge comes from provider text, with no local path read or HTML interpretation', async () => {
  const view = ui(body => body.action === 'inspect' ? inspection('dev', 'snapshot') : { operation: 'knowledge:inspect', result: { documents: [{ label: 'Memory', kind: 'markdown', path: '/remote/MEMORY.md', text: '<img src=x onerror=evil()>\nProvider memory' }] } });
  try {
    await view.controller.show({ instance: instances[0], selector: { home } }); view.click('View'); await tick();
    assert.match(view.el.textContent, /Provider memory/); assert.equal(view.el.querySelector('img'), null);
    assert.equal([...view.el.querySelectorAll('button')].some(b => b.textContent === 'Edit defaults' || b.textContent === 'Inherit'), false);
    assert.deepEqual(view.calls[1].selector, { home }); assert.equal(view.calls[1].operation, 'knowledge:inspect');
  } finally { view.close(); }
});

test('late save from another workspace never refreshes or paints the current editor', async () => {
  let finish;
  const view = ui(body => body.action === 'set' ? new Promise(resolve => { finish = resolve; }) : inspection());
  try {
    await view.controller.show(selection); view.click('Edit defaults'); view.el.querySelector('[name="model"]').value = 'new'; view.click('Save defaults');
    setWorkspace('/different'); view.controller.close(); finish({ file: '/team/two/soul.yaml' }); await tick();
    assert.equal(view.calls.length, 2); assert.equal(view.el.hidden, true);
  } finally { view.close(); }
});

test('unreadable instructions are explained and never offered as an empty editable draft', async () => {
  const value = inspection(); value.souls[0].instructions = { text: null, error: 'EACCES: cannot read AGENTS.md' };
  const view = ui(() => value);
  try {
    await view.controller.show(selection);
    assert.match(view.el.textContent, /EACCES: cannot read AGENTS.md/);
    assert.equal([...view.el.querySelectorAll('button')].some(b => b.textContent === 'Edit instructions'), false);
  } finally { view.close(); }
});
