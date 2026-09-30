import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { cliLaunchConfig, cliStart } from '../cli-adapter.mjs';
import { launchConfigRequest } from '../server/launch-configs.mjs';
import { launchConfigFields } from '../renderer/launch-config-fields.mjs';
import { createInstanceStarter } from '../renderer/start-instance.mjs';
import { currentWorkspace, setWorkspace } from '../renderer/views/common.mjs';

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
  await cliStart(cli.bin, { home, workspaceDir: '/local', server: 'host', restart: true, launchConfig: 'personal', harness: 'codex', harnessFlag: '--harness', model: 'model-id', yolo: false }, {
    exec: (_, argv, opts, done) => { call = { argv, opts }; done(null, JSON.stringify(envelope({}))); },
  });
  assert.deepEqual(call.argv, ['session', 'restart', '--home', home, '--server', 'host', '--launch-config', 'personal', '--harness', 'codex', '--model', 'model-id', '--no-yolo', '--json']);
  assert.equal(call.opts.shell, false);
  for (const choices of [{ launchConfig: '--force' }, { harness: 'unknown', harnessFlag: '--harness' }, { harness: 'codex' }, { yolo: 'false' }, { model: '--launch-config' }]) {
    const r = await cliStart(cli.bin, { home, ...choices }, { exec: assert.fail }); assert.equal(r.error.code, 'E_BAD_ARGS');
  }
});

function ui(respond, { supportsDefault } = {}) {
  setWorkspace('/team');
  const dom = new JSDOM('<body><section></section></body>'), el = dom.window.document.querySelector('section');
  const calls = [];
  const controller = launchConfigFields(el, { selector: () => ({ home }), choices: () => ({ harness: 'codex' }), ...(supportsDefault ? { supportsDefault } : {}), ctx: { api: async (path, opts) => {
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

test('preview shows failed kernel preflight checks even when the request succeeds', async () => {
  const u = ui(body => body.action === 'list' ? { context: '/team', configurations: [config] } : {
    command: 'codex --profile personal', ok: false,
    preflight: [{ check: 'environment', ok: false, detail: 'not set on this host: PERSONAL_KEY' }],
  });
  try {
    await u.controller.load('personal'); u.el.querySelector('.launch-preview').click(); await tick();
    assert.match(u.el.querySelector('pre').textContent, /Needs attention: environment — not set on this host: PERSONAL_KEY/);
    assert.match(u.el.querySelector('.launch-config-status').textContent, /not ready/);
    assert.deepEqual(u.calls.map(c => c.action), ['list', 'preview']);
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

// Spawn no longer owns these controls. Exercise their actual surviving host,
// not just the shared fields helper, so removal cannot silently reach Start.
for (const restart of [false, true]) test(`${restart ? 'Restart' : 'Start'} retains configuration management, selection and invocation preview`, async () => {
  const previousWs = currentWorkspace(); setWorkspace('/team');
  const dom = new JSDOM('<body><button>Open</button></body>');
  const calls = [], opened = [];
  const instance = { instance: 'dev-one', home, agentsRoot: agents[1].agentsRoot, runtime: 'pi', running: restart };
  let saved = [config];
  const ctx = { api: async (path, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ path, body });
    if (path === '/api/cli') return { ...cli, features: ['session-start', 'session-restart', 'launch-config'] };
    if (path.startsWith('/api/panel')) return { instances: [instance] };
    if (path === '/api/models') return { models: [] };
    if (path.startsWith('/api/launch-configs')) {
      if (body.action === 'list') return { context: '/team', configurations: saved };
      if (body.action === 'preview') return { command: 'codex --profile personal', ok: true };
      if (body.action === 'set') saved = [{ name: body.name, source: '/team', ...body.definition }];
      if (body.action === 'remove') saved = [];
      return {};
    }
    if (path.startsWith(`/api/${restart ? 'restart' : 'start'}/`)) return { instance: instance.instance, home };
    throw new Error(`Unexpected request: ${path}`);
  }, openTerminal: ref => opened.push(ref) };
  try {
    const modal = createInstanceStarter(dom.window.document, ctx, { waitForReady: async () => true })(instance, { restart });
    await tick();
    const fields = modal.querySelector('.start-configurations');
    assert.equal(fields.hidden, false);
    assert.equal(fields.querySelector('.launch-config-editor').hidden, false);
    const select = fields.querySelector('.launch-config-select');
    select.value = 'personal'; select.dispatchEvent(new dom.window.Event('change'));
    fields.querySelector('.launch-preview').click(); await tick();
    assert.match(fields.querySelector('.launch-preview-output').textContent, /codex --profile personal/);
    assert.deepEqual(calls.find(c => c.body?.action === 'preview').body, {
      action: 'preview', selector: { home }, choices: { launchConfig: 'personal' },
    });
    fields.querySelector('.lc-remove').click(); await tick();
    fields.querySelector('.lc-name').value = 'replacement';
    fields.querySelector('.lc-runtime').value = 'codex';
    fields.querySelector('.lc-save').click(); await tick();
    assert.equal(select.value, 'replacement');
    assert.equal(modal.querySelector('.start-runtime').disabled, true);
    modal.querySelector('.start-yolo').value = 'false';
    modal.querySelector('form').dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await tick();
    const call = calls.find(c => c.path.startsWith(`/api/${restart ? 'restart' : 'start'}/`));
    assert.ok(call);
    assert.equal(new URL(call.path, 'http://localhost').searchParams.get('home'), home);
    assert.equal(new URL(call.path, 'http://localhost').searchParams.get('ws'), '/team');
    assert.deepEqual(call.body, { launchConfig: 'replacement', yolo: false });
    assert.deepEqual(calls.filter(c => c.path.startsWith('/api/launch-configs')).map(c => c.body.action), ['list', 'preview', 'remove', 'list', 'set', 'list']);
    assert.equal(calls.some(c => c.path === '/api/spawn'), false);
    assert.deepEqual(opened, [instance]);
    assert.equal(modal.isConnected, false);
  } finally { setWorkspace(previousWs); dom.window.close(); }
});

test('a remote home is admitted when the kernel reports it addressable, never on savedRoute alone', async () => {
  const calls = [], remoteWs = { ...workspace, name: 'Build box', remote: true, server: 'host', registrationPresent: true };
  const row = { instance: 'dev-one', home, agentsRoot: agents[1].agentsRoot, server: 'host', savedRoute: false, addressable: true };
  const opts = { workspace: remoteWs, cli, agents, localCwd: '/local', invoke: async (_, args) => { calls.push(args); return envelope({}); } };
  await launchConfigRequest({ action: 'preview', selector: { home } }, { ...opts, instances: [row] });
  assert.equal(calls.at(-1).server, 'host'); assert.equal(calls.at(-1).home, home);
  for (const [unaddressable, reason] of [[{ addressable: false, missingRemotely: true }, 'dev-one is no longer on Build box. Remove it from this computer with: oats server forget host --instance dev-one'],
    [{ addressable: false, savedRoute: true }, 'Build box did not report this instance as reachable.']]) {
    await assert.rejects(launchConfigRequest({ action: 'preview', selector: { home } }, { ...opts, instances: [{ ...row, ...unaddressable }] }),
      { code: 'E_SNAPSHOT_UNKNOWN', message: reason });
  }
  assert.equal(calls.length, 1);
});

const defaultConfig = { name: 'personal', harness: 'codex', source: '/team', args: [], env: {}, executable: null, model: null, yolo: null, shadows: [], default: true };
const lastSet = u => u.calls.filter(c => c.action === 'set').at(-1);

test('a default configuration keeps default: true when it is edited and saved (launch-config-default)', async () => {
  const u = ui(body => body.action === 'list' ? { context: '/team', configurations: [defaultConfig] } : {}, { supportsDefault: () => true });
  try {
    await u.controller.load('personal');
    const box = u.el.querySelector('.lc-default');
    assert.equal(box.checked, true);
    assert.equal(u.el.querySelector('.lc-default-label').hidden, false);
    assert.match(u.el.querySelector('.lc-default-label').textContent, /Default for Codex on this machine/);
    assert.match(u.el.querySelector('.launch-config-select').selectedOptions[0].textContent, /default/);
    u.el.querySelector('.lc-model').value = 'new-model'; u.el.querySelector('.lc-save').click(); await tick();
    assert.equal(lastSet(u).definition.default, true);
    assert.equal(lastSet(u).definition.model, 'new-model');
    for (const key of ['name', 'source', 'shadows']) assert.equal(Object.hasOwn(lastSet(u).definition, key), false, `${key} is row metadata, never sent back`);
  } finally { u.close(); }
});

test('unchecking the default sends no default key, which clears it; checking it on another configuration sends default: true', async () => {
  const other = { ...defaultConfig, name: 'other', default: false };
  const u = ui(body => body.action === 'list' ? { context: '/team', configurations: [defaultConfig, other] } : {}, { supportsDefault: () => true });
  try {
    await u.controller.load('personal');
    u.el.querySelector('.lc-default').click(); u.el.querySelector('.lc-save').click(); await tick();
    assert.equal(Object.hasOwn(lastSet(u).definition, 'default'), false);
    await u.controller.load('other');
    assert.equal(u.el.querySelector('.lc-default').checked, false);
    u.el.querySelector('.lc-default').click(); u.el.querySelector('.lc-save').click(); await tick();
    assert.equal(lastSet(u).definition.default, true);
  } finally { u.close(); }
});

test('the default checkbox names the harness chosen in the editor, and a new configuration starts unchecked', async () => {
  const u = ui(body => body.action === 'list' ? { context: '/team', configurations: [defaultConfig] } : {}, { supportsDefault: () => true });
  try {
    await u.controller.load('personal');
    const harness = u.el.querySelector('.lc-runtime'); harness.value = 'claude'; harness.dispatchEvent(new u.dom.window.Event('change'));
    assert.match(u.el.querySelector('.lc-default-label').textContent, /Default for Claude Code on this machine/);
    u.el.querySelector('.lc-new').click();
    assert.equal(u.el.querySelector('.lc-default').checked, false);
  } finally { u.close(); }
});

test('without launch-config-default the checkbox is hidden and default is never sent', async () => {
  const u = ui(body => body.action === 'list' ? { context: '/team', configurations: [config] } : {});
  try {
    await u.controller.load('personal');
    assert.equal(u.el.querySelector('.lc-default-label').hidden, true);
    u.el.querySelector('.lc-model').value = 'm'; u.el.querySelector('.lc-save').click(); await tick();
    assert.equal(Object.hasOwn(lastSet(u).definition, 'default'), false);
  } finally { u.close(); }
});

test("a second default is refused in the kernel's own words", async () => {
  const message = 'launch configurations "personal" and "other" in /team/oats-local.yaml are both default: true for codex; keep one default per harness';
  const u = ui(body => body.action === 'list' ? { context: '/team', configurations: [{ ...defaultConfig, name: 'other', default: false }] }
    : Promise.reject(Object.assign(new Error(message), { code: 'E_LAUNCH_CONFIG_INVALID' })), { supportsDefault: () => true });
  try {
    await u.controller.load('other');
    u.el.querySelector('.lc-default').click(); u.el.querySelector('.lc-save').click(); await tick();
    assert.equal(u.el.querySelector('.launch-config-status').textContent, message);
  } finally { u.close(); }
});

test("an existing home's empty choice keeps its recorded launch, and says so", async () => {
  const u = ui(body => body.action === 'list' ? { context: '/team', configurations: [defaultConfig] } : {}, { supportsDefault: () => true });
  try {
    assert.equal(u.el.querySelector('.launch-config-select').options[0].textContent, 'Keep the recorded launch');
    await u.controller.load('');
    assert.equal(u.el.querySelector('.launch-config-select').options[0].textContent, 'Keep the recorded launch');
    assert.equal(u.el.querySelector('.launch-config-source').textContent, "Use this home's recorded launch.");
  } finally { u.close(); }
});

test('where the default cannot be offered (a remote home), an existing default is still kept on save, and never copied to a new name', async () => {
  const u = ui(body => body.action === 'list' ? { context: '/team', configurations: [defaultConfig] } : {}, { supportsDefault: () => false });
  try {
    await u.controller.load('personal');
    assert.equal(u.el.querySelector('.lc-default-label').hidden, true);
    u.el.querySelector('.lc-model').value = 'm'; u.el.querySelector('.lc-save').click(); await tick();
    assert.equal(lastSet(u).definition.default, true, 'the host reported it, so it is sent back');
    u.el.querySelector('.lc-name').value = 'copy'; u.el.querySelector('.lc-name').dispatchEvent(new u.dom.window.Event('input'));
    u.el.querySelector('.lc-save').click(); await tick();
    assert.equal(lastSet(u).name, 'copy');
    assert.equal(Object.hasOwn(lastSet(u).definition, 'default'), false, 'a new name never becomes a second default');
  } finally { u.close(); }
});
