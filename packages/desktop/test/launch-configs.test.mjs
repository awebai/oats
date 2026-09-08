import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { cliLaunchConfig, cliStart } from '../cli-adapter.mjs';
import { launchConfigRequest } from '../server/launch-configs.mjs';
import { launchConfigFields } from '../renderer/launch-config-fields.mjs';
import { setWorkspace } from '../renderer/views/common.mjs';

const envelope = result => ({ schemaVersion: 1, ok: true, result });
const tick = () => new Promise(resolve => setImmediate(resolve));
const cli = { ok: true, bin: '/installed/oats', features: ['launch-config'], remote: ['launch-config'] };
const workspace = { id: '/team', scope: '/team' };
const agents = [{ name: 'dev', agentsRoot: '/team/a/agents' }, { name: 'dev', agentsRoot: '/team/b/agents' }];
const home = '/team/b/agents/dev/instances/dev-one';
const instances = [{ home, agentsRoot: agents[1].agentsRoot, savedRoute: true }];

test('launch configuration requests admit exact workspace targets and refuse unsupported remote routes', async () => {
  const calls = [];
  const opts = { workspace, cli, agents, instances, localCwd: '/local', invoke: async (_, args) => { calls.push(args); return envelope({}); } };
  await launchConfigRequest({ action: 'preview', selector: { home }, choices: { launchConfig: 'personal' } }, opts);
  assert.equal(calls[0].home, home); assert.equal(calls[0].context, undefined);
  await launchConfigRequest({ action: 'list', selector: { soul: 'dev', agentsRoot: agents[1].agentsRoot } }, opts);
  assert.equal(calls[1].context, '/team/b');
  for (const selector of [{ home: '/foreign' }, { soul: 'dev' }, { home, context: '/team' }, { context: '/other' }]) await assert.rejects(launchConfigRequest({ action: 'preview', selector }, opts));
  await assert.rejects(launchConfigRequest({ action: 'set', selector: { home }, name: 'x' }, opts), /configuration scope/);
  await assert.rejects(launchConfigRequest({ action: 'set', selector: { soul: 'dev', agentsRoot: agents[1].agentsRoot }, name: 'x' }, opts), /configuration scope/);
  await assert.rejects(launchConfigRequest({ action: 'list' }, { ...opts, cli: { ...cli, features: [] } }), /Update OATS/);
  await assert.rejects(launchConfigRequest({ action: 'list' }, { ...opts, workspace: { ...workspace, remote: true } }), /registered server/);
  await launchConfigRequest({ action: 'preview', selector: { home } }, { ...opts, workspace: { ...workspace, remote: true, server: 'host', registrationPresent: true } });
  assert.equal(calls.at(-1).server, 'host'); assert.equal(calls.at(-1).localCwd, '/local');
});

test('configuration writes use a private literal JSON file and remove it on failure', async () => {
  const definition = { runtime: 'codex', args: ['-c', 'value="literal $(touch /not-executed)"'] };
  let file;
  const r = await cliLaunchConfig(cli.bin, { action: 'set', name: 'personal', definition, keepEnv: true, context: '/remote/team', server: 'host', localCwd: '/local' }, {
    exec: (_, argv, opts, done) => {
      file = argv[argv.indexOf('--file') + 1];
      assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), definition); assert.equal(statSync(file).mode & 0o777, 0o600);
      assert.ok(argv.includes('--keep-env')); assert.equal(argv[argv.indexOf('--dir') + 1], '/remote/team');
      assert.equal(opts.shell, false); assert.equal(opts.cwd, '/local');
      done(null, JSON.stringify({ schemaVersion: 1, ok: false, error: { code: 'E_WRITE', message: 'not saved' } }));
    },
  });
  assert.equal(r.error.code, 'E_WRITE'); assert.equal(existsSync(file), false);
});

test('restart uses one kernel call with the exact home and launch choices', async () => {
  let call;
  await cliStart(cli.bin, { home, workspaceDir: '/local', server: 'host', restart: true, launchConfig: 'personal', runtime: 'codex', model: 'model-id', yolo: false }, {
    exec: (_, argv, opts, done) => { call = { argv, opts }; done(null, JSON.stringify(envelope({}))); },
  });
  assert.deepEqual(call.argv, ['session', 'restart', '--home', home, '--server', 'host', '--launch-config', 'personal', '--runtime', 'codex', '--model', 'model-id', '--no-yolo', '--json']);
  assert.equal(call.opts.shell, false);
  for (const choices of [{ launchConfig: '--force' }, { runtime: 'unknown' }, { yolo: 'false' }, { model: '--launch-config' }]) {
    const r = await cliStart(cli.bin, { home, ...choices }, { exec: assert.fail }); assert.equal(r.error.code, 'E_BAD_ARGS');
  }
});

function ui(respond) {
  setWorkspace('/team');
  const dom = new JSDOM('<body><section></section></body>'), el = dom.window.document.querySelector('section');
  const calls = [];
  const controller = launchConfigFields(el, { selector: () => ({ home }), choices: () => ({ runtime: 'codex' }), ctx: { api: async (path, opts) => {
    const body = JSON.parse(opts.body); calls.push({ path, ...body }); return respond(body);
  } } });
  return { dom, el, calls, controller, close() { controller.dispose(); dom.window.close(); } };
}
const config = { name: 'personal', runtime: 'codex', source: '/team', args: ['--profile', 'personal'], env: { CONFIG_DIR: { redacted: true }, API_KEY: { fromEnv: 'PERSONAL_KEY' } } };

test('editing a redacted environment preserves it explicitly instead of storing placeholders', async () => {
  const u = ui(body => body.action === 'list' ? { context: '/team', configurations: [config] } : {});
  try {
    await u.controller.load('personal'); assert.equal(u.el.querySelector('.lc-keep-env').checked, true);
    u.el.querySelector('.lc-model').value = 'new-model'; u.el.querySelector('.lc-save').click(); await tick();
    const save = u.calls.find(c => c.action === 'set');
    assert.equal(save.keepEnv, true); assert.equal(save.definition.env, undefined); assert.equal(save.definition.model, 'new-model');
    assert.deepEqual(save.selector, { context: '/team' }); assert.equal(JSON.stringify(save).includes('redacted'), false);
    u.el.querySelector('.lc-keep-env').click(); u.el.querySelector('.lc-env').value = '{"API_KEY":{"fromEnv":"OTHER_KEY"}}';
    u.el.querySelector('.lc-save').click(); await tick();
    assert.deepEqual(u.calls.filter(c => c.action === 'set').at(-1).definition.env, { API_KEY: { fromEnv: 'OTHER_KEY' } });
  } finally { u.close(); }
});

test('preview is text only and late replies cannot paint another selection or workspace', async () => {
  let finish;
  const u = ui(body => body.action === 'list' ? { context: '/team', configurations: [config] } : new Promise(resolve => { finish = resolve; }));
  try {
    await u.controller.load('personal'); u.el.querySelector('.launch-preview').click();
    u.controller.invalidate(); finish({ command: 'stale' }); await tick(); assert.equal(u.el.querySelector('.launch-preview-output').hidden, true);
    u.el.querySelector('.launch-preview').click(); finish({ command: '<img src=x onerror=bad()> --profile personal' }); await tick();
    assert.equal(u.el.querySelector('img'), null); assert.match(u.el.querySelector('pre').textContent, /<img/);
    u.el.querySelector('.launch-preview').click(); setWorkspace('/elsewhere'); finish({ command: 'foreign' }); await tick();
    assert.doesNotMatch(u.el.querySelector('pre').textContent, /foreign/);
  } finally { u.close(); }
});

test('editing launch choices does not cancel loading configurations, but disabling a launch cancels and reloads safely', async () => {
  const replies = [];
  const u = ui(() => new Promise(resolve => replies.push(resolve)));
  try {
    const loading = u.controller.load();
    u.controller.invalidate(); // Model input invalidates a preview, not the configuration list.
    replies.shift()({ context: '/team', configurations: [config] }); await loading;
    assert.equal(u.el.querySelectorAll('.launch-config-select option').length, 2);
    const pending = u.controller.load('personal'); u.controller.disabled(true);
    replies.shift()({ context: '/team', configurations: [] }); await pending;
    assert.equal(u.el.querySelectorAll('.launch-config-select option').length, 2);
    assert.equal(u.el.querySelector('.launch-config-select').disabled, true);
    u.controller.disabled(false);
    replies.shift()({ context: '/team', configurations: [config] }); await tick();
    assert.equal(u.el.querySelector('.launch-config-select').disabled, false);
  } finally { u.close(); }
});

test('remove is tied to the selected saved name and save locks configuration edits until complete', async () => {
  let finish;
  const u = ui(body => body.action === 'list' ? { context: '/team', configurations: [config] } : new Promise(resolve => { finish = resolve; }));
  try {
    await u.controller.load('personal');
    const name = u.el.querySelector('.lc-name'), remove = u.el.querySelector('.lc-remove');
    name.value = 'different'; name.dispatchEvent(new u.dom.window.Event('input'));
    assert.equal(remove.disabled, true); remove.click(); assert.equal(u.calls.some(c => c.action === 'remove'), false);
    name.value = 'personal'; name.dispatchEvent(new u.dom.window.Event('input'));
    assert.equal(remove.disabled, false);
    u.el.querySelector('.lc-save').click();
    assert.equal(u.controller.busy(), true); assert.equal(name.disabled, true);
    assert.equal(u.el.querySelector('.launch-config-select').disabled, true);
    finish({}); await tick();
    assert.equal(u.controller.busy(), false); assert.equal(name.disabled, false);
  } finally { u.close(); }
});
