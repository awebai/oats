import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import * as spawn from '../renderer/views/spawn.mjs';
import { currentWorkspace, setWorkspace } from '../renderer/views/common.mjs';
import { refreshCli } from '../renderer/views/cli-status.mjs';
import { setBinding, resetBinding } from '../renderer/keybindings.mjs';
import { runtimeOptions } from '../renderer/spawn-launch.mjs';
import { launchSoul } from './helpers/workspace-actions.mjs';
import { view as spawnPreviewView } from './helpers/spawn-preview-fixture.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const CLI = { ok: true, bin: '/fixture/oats', version: '0.24.6', runtimes: ['pi', 'claude', 'codex'], runtimesSource: 'reported', operationsApi: 1,
  features: ['launch-config', 'operations'], remote: ['launch-config', 'operations'], relations: true };
const soul = (root = '/team/a/agents', name = 'dev', fields = {}) => ({ name, agentsRoot: root, description: 'Build carefully', work: 'worktree', repoName: 'Reported context', ...fields });
const list = selector => ({ context: '/team/a', selected: selector, configurations: [{ name: 'personal', runtime: 'codex', source: '/team/a' }] });
const preview = selector => ({ selected: selector, ok: true, runtime: 'codex', model: 'resolved-model', modelSource: 'launch-config personal', command: 'redacted preview', preflight: [{ check: 'executable', ok: true }] });
const observation = selector => ({ operationsApi: 1, selected: { ...selector, source: 'config' }, problems: [], capabilities: [
  { id: 'one', health: { installed: true, trusted: true } }, { id: 'two', health: { installed: false, trusted: false } },
] });
async function setup(t, opts = {}) {
  const dom = new JSDOM('<body><main id="host"></main></body>', { url: 'http://localhost' });
  Object.defineProperty(dom.window.navigator, 'platform', { value: opts.platform || 'MacIntel' });
  const previous = { document: globalThis.document, window: globalThis.window, setInterval: globalThis.setInterval, ws: currentWorkspace() };
  globalThis.document = dom.window.document; globalThis.window = dom.window;
  const polls = []; globalThis.setInterval = fn => { polls.push(fn); return 0; };
  let agents = opts.agents || [soul()], cli = opts.cli || CLI;
  const calls = [], opens = [], doc = dom.window.document;
  const ctx = { hasWorkspaceSwitcher: true, api: async (path, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null; calls.push({ path, body });
    if (path === '/api/cli') return cli;
    if (path.startsWith('/api/agents')) return { agents };
    if (path.startsWith('/api/panel')) return { workspace: { id: currentWorkspace(), name: 'Actual workspace', scope: currentWorkspace(), ...opts.workspace }, instances: [
      { instance: 'created', agentsRoot: '/team/a/agents', running: true, tmux: { session: 'fixture' } },
    ], workspaces: [] };
    if (path === '/api/servers') return { servers: [{ id: 'remote', label: 'Remote', sshHost: 'fixture.invalid' }] };
    if (path === '/api/models') return opts.models ? opts.models(body) : { models: [{ id: 'advisory-model' }] };
    if (path.startsWith('/api/launch-configs')) return opts.launch ? opts.launch(body) : body.action === 'list' ? list(body.selector) : preview(body.selector);
    if (path.startsWith('/api/capabilities')) return opts.inspect ? opts.inspect(body) : observation(body.selector);
    if (path.startsWith('/api/workspace-spawn-preview')) return opts.spawnPreview ? opts.spawnPreview(body) : spawnPreviewView({ workspace: currentWorkspace(), context: '/team/a', selector: body.selector });
    if (path === '/api/spawn') return opts.spawn ? opts.spawn(body) : { instance: 'created', launched: true };
    throw Error(`Unexpected fixture API ${path}`);
  }, openTerminal: (...args) => opens.push(args) };
  setWorkspace('/team'); await refreshCli({ api: async () => cli }); spawn.mount(doc.querySelector('#host'), ctx); await tick();
  t.after(() => { spawn.unmount(); resetBinding('spawn.submit'); setWorkspace(previous.ws); Object.assign(globalThis, { document: previous.document, window: previous.window, setInterval: previous.setInterval }); dom.window.close(); });
  const change = (selector, value) => { const el = doc.querySelector(selector); el.value = value; el.dispatchEvent(new dom.window.Event('input', { bubbles: true })); el.dispatchEvent(new dom.window.Event('change', { bubbles: true })); return el; };
  return { dom, doc, ctx, calls, opens, polls, change,
    open: async () => { launchSoul(doc); await tick(); return doc.querySelector('.spawn-dialog'); },
    key: (target, fields) => { const event = new dom.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...fields }); target.dispatchEvent(event); return event; },
    spawns: () => calls.filter(call => call.path === '/api/spawn'),
    setAgents: value => { agents = value; }, setCli: async value => { cli = value; await refreshCli({ api: async () => cli }); },
  };
}

test('frame02 composition preserves actual controls, explicit unknown future fields and expanded More options', async t => {
  const u = await setup(t), dialog = await u.open(), css = el => u.dom.window.getComputedStyle(el);
  const dialogRule = [...u.doc.styleSheets].flatMap(sheet => [...sheet.cssRules]).find(rule => rule.selectorText === '.spawn-modal .spawn-dialog');
  assert.equal(dialogRule.style.width, '860px', 'actual shipped CSSOM constraint, not a claimed jsdom layout measurement');
  assert.equal(dialogRule.style.maxWidth, '100%');
  assert.equal(css(dialog.querySelector('.spawn-columns')).gridTemplateColumns, '320px minmax(0,1fr)');
  assert.equal(css(dialog.querySelector('.spawn-dialog-head')).minHeight, '52px');
  assert.equal(css(dialog.querySelector('.soul-form')).minHeight, '520px');
  assert.equal(dialog.querySelector('h2').textContent, 'Spawn instance');
  assert.match(dialog.querySelector('.spawn-context').textContent, /Actual workspace/);
  assert.equal(dialog.querySelector('.spawn-more').open, true);
  for (const cls of ['fpurpose', 'frelation', 'frelto', 'fserver', 'fbackend', 'fyolo', 'fwake-enabled']) assert.ok(dialog.querySelector(`.spawn-more .${cls}`), cls);
  for (const input of dialog.querySelectorAll('.spawn-future, .spawn-future-toggles input, .spawn-native')) assert.equal(input.disabled, true);
  assert.match(dialog.textContent, /Available after K6/); assert.match(dialog.textContent, /node count unknown/);
  assert.equal(dialog.querySelector('.launch-config-editor'), null);
  assert.equal(dialog.querySelector('.fspawn').dataset.shortcut, '⌘↵');
  assert.equal(u.spawns().length, 0);
});

test('API2 shipped modal reads only on explicit preview, guards Mod+Enter, and never submits new choices', async t => {
  const u = await setup(t, { cli: { ...CLI, spawnPreviewApi: 2, features: [...CLI.features, 'spawn-preview-2'] } }), dialog = await u.open();
  assert.equal(u.calls.filter(c => c.path.startsWith('/api/workspace-spawn-preview')).length, 0);
  assert.equal(u.calls.filter(c => c.path.startsWith('/api/launch-configs') && c.body.action === 'preview').length, 0, 'no overlapping automatic legacy preview');
  assert.ok(dialog.querySelector('.spawn-k6-panel .fpurpose'), 'same real purpose control in work-area row');
  u.change('.ftask', 'PRIVATE instruction'); u.change('.preview-branch', 'feat/preview'); u.change('.preview-base', 'release');
  dialog.querySelector('.spawn-native').click(); dialog.querySelector('.spawn-k6-preview').click(); await tick();
  const reads = u.calls.filter(c => c.path.startsWith('/api/workspace-spawn-preview')); assert.equal(reads.length, 1);
  assert.equal(reads[0].body.choices.branch, 'feat/preview'); assert.deepEqual(reads[0].body.choices.model, { kind: 'native-default' }); assert.doesNotMatch(JSON.stringify(reads), /PRIVATE|task/);
  u.key(dialog.querySelector('.ftask'), { key: 'Enter', metaKey: true }); await tick(); assert.equal(u.spawns().length, 0); assert.equal(dialog.querySelector('.fspawn').disabled, true);
  dialog.querySelector('.spawn-k6-reset').click(); assert.equal(dialog.querySelector('.ftask').value, 'PRIVATE instruction');
  dialog.querySelector('.fspawn').click(); await tick(); assert.equal(u.spawns().length, 1);
  assert.equal(u.spawns()[0].body.task, 'PRIVATE instruction');
  for (const key of ['branch', 'base', 'allowChildSpawns', 'expectDecision', 'choices']) assert.equal(Object.hasOwn(u.spawns()[0].body, key), false);
  assert.notEqual(u.spawns()[0].body.model, '@native-default');
});

for (const reject of [false, true]) test(`API2 modal replaced while preview is pending ignores old ${reject ? 'rejection' : 'success'}`, async t => {
  const gate = deferred(); const u = await setup(t, { cli: { ...CLI, spawnPreviewApi: 2, features: [...CLI.features, 'spawn-preview-2'] }, spawnPreview: () => gate.promise });
  const old = await u.open(); old.querySelector('.spawn-k6-preview').click(); old.querySelector('.fcancel').click();
  const current = await u.open(), before = current.outerHTML, focus = u.doc.activeElement;
  if (reject) gate.reject(Error('PRIVATE')); else gate.resolve(spawnPreviewView({ workspace: '/team', context: '/team/a', selector: { soul: 'dev', agentsRoot: '/team/a/agents' } }));
  await tick(); assert.equal(current.outerHTML, before); assert.equal(u.doc.activeElement, focus); assert.equal(u.spawns().length, 0);
});

test('restored configuration forwards only existing launchConfig; default model display is not an override', async t => {
  const u = await setup(t), dialog = await u.open();
  assert.match(dialog.querySelector('.spawn-default-note').textContent, /resolved-model.*launch-config personal/);
  assert.equal(dialog.querySelector('.fmodel').value, '');
  u.change('.launch-config-select', 'personal'); u.change('.ftask', 'First line\nSecond line'); await tick();
  dialog.querySelector('.fspawn').click(); await tick();
  assert.deepEqual(u.spawns().map(c => c.body), [{ agent: 'dev', agentsRoot: '/team/a/agents', task: 'First line\nSecond line', launchConfig: 'personal' }]);
  assert.ok(u.calls.filter(c => c.path.startsWith('/api/launch-configs')).every(c => ['list', 'preview'].includes(c.body.action)));
  assert.ok(u.calls.filter(c => c.path.startsWith('/api/launch-configs')).every(c => !c.body.choices || Object.keys(c.body.choices).every(key => ['launchConfig', 'runtime', 'model', 'yolo'].includes(key))));
});

test('server status projects actual versus assumed runtime provenance without changing support defaults', () => {
  const source = readFileSync(new URL('../server/oats-web.mjs', import.meta.url), 'utf8').match(/function cliStatus\(\) \{[^]*?\n\}/)[0];
  const project = state => new Function('cliState', 'locator', 'MANIFEST', `return (${source})();`)(state,
    { DESKTOP_API: 1, ACCEPT_RANGE_TEXT: 'fixture', supportsRelations: () => true, RELATIONS_MIN: [0, 18, 6] }, { version: '0.24.6' });
  assert.deepEqual(project({ ok: true, runtimes: ['codex'] }).runtimes, ['codex']); assert.equal(project({ runtimes: ['codex'] }).runtimesSource, 'reported');
  assert.deepEqual(project({ ok: true }).runtimes, ['pi', 'claude']); assert.equal(project({ ok: true }).runtimesSource, 'assumed');
  assert.match(runtimeOptions(project({ ok: true }))[0].label, /assumed \(CLI did not report\)/);
});

test('provider popup lists only the supplied runtimes, is keyboard consumable and never advertises installation', async t => {
  const u = await setup(t, { cli: { ...CLI, runtimes: ['codex'] } }), dialog = await u.open();
  assert.deepEqual([...dialog.querySelector('.fruntime').options].map(option => option.value), ['', 'codex']);
  const trigger = dialog.querySelector('.spawn-provider-row .spawn-choice-trigger'); trigger.click();
  const menu = dialog.querySelector('.spawn-choice-menu'); assert.equal(menu.hidden, false);
  assert.match(menu.textContent, /Codex.*reported by CLI/); assert.doesNotMatch(menu.textContent, /Claude|Gemini|Installed|trusted|v[0-9]/);
  u.key(u.doc.activeElement, { key: 'ArrowDown' });
  const enter = u.key(u.doc.activeElement, { key: 'Enter', metaKey: true }); await tick();
  assert.equal(enter.defaultPrevented, true); assert.equal(menu.hidden, true); assert.equal(u.spawns().length, 0, 'dropdown consumes launch-looking Enter before modal');
  assert.equal(dialog.querySelector('.fruntime').value, 'codex');
  trigger.click(); u.key(u.doc.activeElement, { key: 'Escape' });
  assert.equal(u.doc.querySelector('.spawn-dialog'), dialog, 'first Escape closes only dropdown');
});

test('controlled model popup consumes its selection before the launch chord and preserves custom input', async t => {
  const u = await setup(t), dialog = await u.open(); u.change('.fruntime', 'codex'); await tick();
  assert.equal(dialog.querySelector('.fmodel').hasAttribute('list'), false, 'no uncontrolled native datalist competes for Enter');
  dialog.querySelector('.spawn-model-controls button').click();
  const search = dialog.querySelector('.spawn-popup-search input'); assert.equal(u.doc.activeElement, search);
  search.value = 'advisory'; search.dispatchEvent(new u.dom.window.Event('input', { bubbles: true }));
  u.key(u.doc.activeElement, { key: 'ArrowDown' });
  u.key(u.doc.activeElement, { key: 'Enter', metaKey: true }); await tick();
  assert.equal(dialog.querySelector('.fmodel').value, 'advisory-model'); assert.equal(u.spawns().length, 0);
  u.change('.fmodel', 'custom,unlisted/fallback'); assert.equal(dialog.querySelector('.fmodel').value, 'custom,unlisted/fallback');
});

test('late advisory suggestions refresh an open filter without losing query, input node, custom value or focus', async t => {
  const pending = deferred(), u = await setup(t, { models: () => pending.promise }), dialog = await u.open();
  u.change('.fruntime', 'pi'); u.change('.fmodel', 'unlisted/model,fallback');
  dialog.querySelector('.spawn-model-controls button').click();
  const input = dialog.querySelector('.spawn-popup-search input'); input.value = 'new-model'; input.dispatchEvent(new u.dom.window.Event('input'));
  assert.match(dialog.querySelector('#spawn-model-choices .spawn-popup-status').textContent, /No model suggestions reported/);
  pending.resolve({ models: [{ id: 'provider/new-model', label: 'New model' }] }); await tick();
  assert.equal(dialog.querySelector('.spawn-popup-search input'), input); assert.equal(u.doc.activeElement, input); assert.equal(input.value, 'new-model');
  assert.match(dialog.querySelector('#spawn-model-choices').textContent, /New modelprovider\/new-model/);
  assert.equal(dialog.querySelector('.fmodel').value, 'unlisted/model,fallback'); assert.equal(u.spawns().length, 0);
  assert.equal(u.calls.filter(call => call.path === '/api/models').length, 1, 'filtering does not probe the catalog');
});

for (const outcome of ['success', 'rejection']) test(`old model catalog ${outcome} cannot repaint a newer runtime popup`, async t => {
  const requests = [], u = await setup(t, { models: () => { const d = deferred(); requests.push(d); return d.promise; } }), dialog = await u.open();
  u.change('.fruntime', 'pi'); dialog.querySelector('.spawn-model-controls button').click();
  u.change('.fruntime', 'codex'); assert.equal(dialog.querySelector('#spawn-model-choices').hidden, true);
  dialog.querySelector('.spawn-model-controls button').click();
  const input = dialog.querySelector('.spawn-popup-search input'); input.value = 'current'; input.dispatchEvent(new u.dom.window.Event('input'));
  requests[1].resolve({ models: [{ id: 'current-model' }] }); await tick();
  if (outcome === 'success') requests[0].resolve({ models: [{ id: 'old-model' }] }); else requests[0].reject(new Error('old rejection'));
  await tick();
  assert.equal(u.doc.activeElement, input); assert.equal(input.value, 'current');
  assert.match(dialog.querySelector('#spawn-model-choices').textContent, /current-model/);
  assert.doesNotMatch(dialog.querySelector('#spawn-model-choices').textContent, /old-model|old rejection/);
});

test('soul chooser no-match is explicit and preserves grouping/selection without a launch', async t => {
  const u = await setup(t), dialog = await u.open(), search = dialog.querySelector('.spawn-soul-search');
  search.focus(); search.value = 'missing'; search.dispatchEvent(new u.dom.window.Event('input'));
  const message = dialog.querySelector('.spawn-chooser-empty');
  assert.equal(message.hidden, false); assert.equal(message.textContent, 'No souls match this filter.');
  assert.equal(u.doc.activeElement, search); assert.equal(dialog.querySelector('.spawn-search-count').textContent, '0 of 1');
  search.value = ''; search.dispatchEvent(new u.dom.window.Event('input'));
  assert.equal(message.hidden, true); assert.equal(dialog.querySelector('.spawn-choice[aria-pressed=true]').dataset.agent, 'dev'); assert.equal(u.spawns().length, 0);
});

test('plain/Shift-only rebound launch keys never intercept editable text or ordinary Enter', async t => {
  const u = await setup(t), dialog = await u.open(), task = dialog.querySelector('.ftask');
  for (const [binding, fields] of [['B', { key: 'b' }], ['Shift+B', { key: 'B', shiftKey: true }], ['Enter', { key: 'Enter' }]]) {
    setBinding('spawn.submit', binding);
    assert.equal(u.key(task, fields).defaultPrevented, false);
    assert.equal(u.spawns().length, 0);
  }
  const enter = u.key(dialog.querySelector('.fspawn'), { key: 'Enter' }); assert.equal(enter.defaultPrevented, true); assert.equal(u.spawns().length, 0);
});

for (const fields of [{}, { repeat: true }, { isComposing: true }, { keyCode: 229 }, { prevented: true }]) test(`Enter launch suppression ${JSON.stringify(fields)}`, async t => {
  const u = await setup(t), dialog = await u.open(), task = dialog.querySelector('.ftask'); task.value = 'Draft';
  const init = fields.prevented ? { key: 'Enter', metaKey: true } : { key: 'Enter', metaKey: Object.keys(fields).length > 0, ...fields };
  const e = new u.dom.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  if (fields.prevented) e.preventDefault(); task.dispatchEvent(e); await tick();
  assert.equal(u.spawns().length, 0); assert.equal(task.value, 'Draft');
});

test('suppressed Enter on the Spawn button prevents its native click; composition Escape cannot clear selection', async t => {
  const u = await setup(t), dialog = await u.open(), button = dialog.querySelector('.fspawn'), task = dialog.querySelector('.ftask');
  for (const fields of [{}, { repeat: true }, { isComposing: true }, { keyCode: 229 }]) {
    assert.equal(u.key(button, { key: 'Enter', ...fields }).defaultPrevented, true);
  }
  task.dispatchEvent(new u.dom.window.CompositionEvent('compositionstart', { bubbles: true }));
  u.key(task, { key: 'Escape' }); assert.equal(u.doc.querySelector('.spawn-dialog'), dialog);
  task.dispatchEvent(new u.dom.window.CompositionEvent('compositionend', { bubbles: true }));
  assert.equal(u.spawns().length, 0); button.click(); await tick(); assert.equal(u.spawns().length, 1);
});

test('composition state and an in-flight lock guard the engine-owned launch chord; rebind/unbind remain real', async t => {
  const pending = deferred(), u = await setup(t, { spawn: () => pending.promise }), dialog = await u.open(), task = dialog.querySelector('.ftask');
  task.dispatchEvent(new u.dom.window.CompositionEvent('compositionstart', { bubbles: true }));
  u.key(task, { key: 'Enter', metaKey: true }); assert.equal(u.spawns().length, 0);
  task.dispatchEvent(new u.dom.window.CompositionEvent('compositionend', { bubbles: true }));
  setBinding('spawn.submit', null); u.key(task, { key: 'Enter', metaKey: true }); assert.equal(u.spawns().length, 0);
  setBinding('spawn.submit', 'Mod+Shift+Enter');
  u.key(task, { key: 'Enter', metaKey: true }); assert.equal(u.spawns().length, 0);
  u.key(task, { key: 'Enter', metaKey: true, shiftKey: true });
  dialog.querySelector('.fspawn').disabled = false; // logical lock survives an accidental control repaint
  u.key(task, { key: 'Enter', metaKey: true, shiftKey: true }); dialog.querySelector('.fspawn').click();
  assert.equal(u.spawns().length, 1);
  pending.resolve({ instance: 'created', launched: true }); await tick();
});

test('non-Mac uses Ctrl+Enter only inside the modal, never adds a terminal interception', async t => {
  const u = await setup(t, { platform: 'Linux' }), dialog = await u.open();
  const outside = u.doc.createElement('textarea'); u.doc.body.append(outside);
  u.key(outside, { key: 'Enter', ctrlKey: true }); assert.equal(u.spawns().length, 0);
  assert.equal(dialog.querySelector('.fspawn').dataset.shortcut, 'Ctrl+Enter');
  u.key(dialog.querySelector('.ftask'), { key: 'Enter', ctrlKey: true }); await tick(); assert.equal(u.spawns().length, 1);
});

test('chooser keeps root/name/host identity, search is literal and switching retains only instruction/purpose draft', async t => {
  const hostile = 'twin\"><img src=x onerror=bad()>', agents = [soul('/team/a/agents', hostile), soul('/team/b/agents', hostile)];
  const u = await setup(t, { agents }), old = await u.open();
  u.change('.ftask', 'Keep instruction'); u.change('.fpurpose', 'review'); u.change('.launch-config-select', 'personal');
  const search = u.change('.spawn-soul-search', hostile);
  assert.equal(old.querySelectorAll('.spawn-choice:not([hidden])').length, 2); assert.equal(old.querySelector('img'), null);
  const choices = [...old.querySelectorAll('.spawn-choice')]; choices.find(row => row.dataset.root === '/team/b/agents').click(); await tick();
  const current = u.doc.querySelector('.spawn-dialog'); assert.notEqual(current, old);
  assert.equal(current.querySelector('.ftask').value, 'Keep instruction'); assert.equal(current.querySelector('.fpurpose').value, 'review');
  assert.equal(current.querySelector('.launch-config-select').value, '', 'named config does not cross soul scopes');
  assert.equal(current.querySelector('.spawn-soul-search').value, search.value);
  assert.equal(current.querySelector('[aria-pressed=true]').dataset.root, '/team/b/agents');
  old.querySelector('.fspawn').click(); assert.equal(u.spawns().length, 0);
});

for (const outcome of ['success', 'rejection']) test(`newer preview failure survives older ${outcome}`, async t => {
  const requests = [], u = await setup(t, { launch: body => {
    if (body.action === 'list') return list(body.selector);
    const d = deferred(); requests.push({ ...d, selector: body.selector }); return d.promise;
  } }), dialog = await u.open();
  assert.equal(requests.length, 1);
  u.change('.fmodel', 'new-model'); assert.equal(requests.length, 2);
  requests[1].reject(new Error('newest failure')); await tick();
  if (outcome === 'success') requests[0].resolve({ ...preview(requests[0].selector), model: 'stale-model' }); else requests[0].reject(new Error('stale error'));
  await tick(); assert.match(dialog.querySelector('.spawn-launch-status').textContent, /newest failure/);
  assert.doesNotMatch(dialog.querySelector('.spawn-default-note').textContent, /stale-model/);
});

for (const mode of ['empty', 'foreign', 'problems', 'missing', 'valid']) test(`readiness uses qualified inspected capability observations (${mode})`, async t => {
  const u = await setup(t, { inspect: body => {
    const d = observation(body.selector);
    if (mode === 'empty') d.capabilities = [];
    if (mode === 'foreign') d.selected.agentsRoot = '/foreign/agents';
    if (mode === 'problems') d.problems = [{ code: 'incomplete' }];
    if (mode === 'missing') delete d.problems;
    return d;
  } }), dialog = await u.open();
  assert.equal(dialog.querySelector('.spawn-installed').textContent, mode === 'valid' ? 'installed: 1/2 inspected' : 'installed: unknown');
  assert.equal(dialog.querySelector('.spawn-trusted').textContent, mode === 'valid' ? 'trusted: 1/2 inspected' : 'trusted: unknown');
  assert.equal(dialog.querySelector('.spawn-configured').textContent, 'configured: unknown');
  assert.equal(dialog.querySelector('.spawn-enrolled').textContent, 'enrolled: unknown');
  assert.doesNotMatch(dialog.querySelector('.spawn-readiness').textContent, /Ready|pass/);
});

test('cross-host choice clears local preview/config and never uses local model or capability observations', async t => {
  const u = await setup(t), dialog = await u.open();
  u.change('.launch-config-select', 'personal'); u.change('.fruntime', 'pi'); await tick();
  const before = u.calls.length; u.change('.fserver', 'remote'); await tick();
  assert.equal(dialog.querySelector('.launch-config-select').value, '');
  assert.equal(dialog.querySelector('.spawn-installed').textContent, 'installed: unknown');
  assert.equal(dialog.querySelector('.spawn-preview-details').hidden, true);
  assert.match(dialog.querySelector('.spawn-launch-status').textContent, /local facts are not substituted/);
  assert.equal(u.calls.slice(before).filter(call => ['/api/models', '/api/capabilities', '/api/launch-configs'].some(path => call.path.startsWith(path))).length, 0);
});

function luminance(hex) {
  assert.match(hex, /^#[0-9a-f]{6}$/i);
  const channels = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}
for (const theme of ['light', 'solarized', 'dark']) test(`${theme}: actual Spawn controls, popup and disabled notes meet computed-token AA`, async t => {
  const u = await setup(t), style = u.doc.createElement('style');
  style.textContent = readFileSync(new URL('../renderer/theme.css', import.meta.url), 'utf8'); u.doc.head.append(style); u.doc.documentElement.dataset.theme = theme;
  const dialog = await u.open(); dialog.querySelector('.spawn-provider-row .spawn-choice-trigger').click();
  const root = u.dom.window.getComputedStyle(u.doc.documentElement);
  for (const [selector, surfaceSelector, fg, bg] of [
    ['.spawn-choice[aria-pressed=true] strong', '.spawn-choice[aria-pressed=true]', 'fg', 'sel'],
    ['.spawn-choice[aria-pressed=true] small', '.spawn-choice[aria-pressed=true]', 'muted', 'sel'],
    ['.spawn-default-note', '.spawn-dialog', 'muted', 'surface'],
    ['.spawn-readiness', '.spawn-dialog', 'muted', 'surface'],
    ['.spawn-choice-trigger', '.spawn-choice-trigger', 'fg', 'surface'],
    ['.spawn-choice-menu [aria-selected=true]', '.spawn-choice-menu [aria-selected=true]', 'fg', 'sel'],
    ['.spawn-future', '.spawn-future', 'faint', 'surface-2'],
    ['.spawn-native', '.spawn-native', 'faint', 'surface-2'],
    ['.ftask', '.ftask', 'fg', 'surface'], ['.fspawn', '.fspawn', 'primary-fg', 'primary-bg'],
  ]) {
    const element = dialog.querySelector(selector), surface = u.doc.querySelector(surfaceSelector);
    assert.ok(element && surface, selector);
    assert.equal(u.dom.window.getComputedStyle(element).color, `var(--${fg})`, selector);
    assert.equal(u.dom.window.getComputedStyle(surface).background, `var(--${bg})`, surfaceSelector);
    const f = luminance(root.getPropertyValue(`--${fg}`).trim()), b = luminance(root.getPropertyValue(`--${bg}`).trim());
    assert.ok((Math.max(f, b) + .05) / (Math.min(f, b) + .05) >= 4.5, selector);
    for (let parent = element; parent; parent = parent.parentElement) assert.equal(u.dom.window.getComputedStyle(parent).opacity, '1');
  }
});

for (const theme of ['light', 'solarized', 'dark']) test(`${theme}: actual API2 read-only preview controls and decision meet computed AA`, async t => {
  const u = await setup(t, { cli: { ...CLI, spawnPreviewApi: 2, features: [...CLI.features, 'spawn-preview-2'] } });
  const style = u.doc.createElement('style'); style.textContent = readFileSync(new URL('../renderer/theme.css', import.meta.url), 'utf8'); u.doc.head.append(style); u.doc.documentElement.dataset.theme = theme;
  const dialog = await u.open(); dialog.querySelector('.spawn-k6-preview').click(); await tick();
  const root = u.dom.window.getComputedStyle(u.doc.documentElement);
  for (const [selector, background, fg, bg] of [
    ['.preview-branch', '.preview-branch', 'fg', 'surface'], ['.preview-base', '.preview-base', 'fg', 'surface'],
    ['.preview-children', '.preview-children', 'fg', 'surface'], ['.spawn-k6-status', '.spawn-dialog', 'muted', 'surface'],
    ['.spawn-k6-details pre', '.spawn-k6-details pre', 'fg', 'surface-2'], ['.spawn-k6-preview', '.spawn-k6-preview', 'accent', 'surface'], // clicked/hover state
    ['.spawn-native', '.spawn-native', 'fg', 'surface'],
  ]) {
    const el = dialog.querySelector(selector), surface = dialog.querySelector(background) || u.doc.querySelector(background); assert.ok(el && surface, selector);
    assert.equal(u.dom.window.getComputedStyle(el).color, `var(--${fg})`, selector); assert.equal(u.dom.window.getComputedStyle(surface).background, `var(--${bg})`, background);
    const f = luminance(root.getPropertyValue(`--${fg}`).trim()), b = luminance(root.getPropertyValue(`--${bg}`).trim()); assert.ok((Math.max(f, b) + .05) / (Math.min(f, b) + .05) >= 4.5, selector);
    for (let p = el; p; p = p.parentElement) assert.equal(u.dom.window.getComputedStyle(p).opacity, '1');
  }
});

for (const outcome of ['success', 'rejection']) test(`soul disappearance/reappearance revokes old ${outcome} observations without replacing the draft`, async t => {
  const requests = [], u = await setup(t, { inspect: body => { const d = deferred(); requests.push({ ...d, selector: body.selector }); return d.promise; } });
  const dialog = await u.open(), old = requests.at(-1); u.change('.ftask', 'Keep draft');
  u.setAgents([]); u.polls[0](); await tick();
  assert.equal(dialog.querySelector('.spawn-installed').textContent, 'installed: unknown');
  u.setAgents([soul()]); u.polls[0](); await tick(); const newest = requests.at(-1); assert.notEqual(newest, old);
  const current = observation(newest.selector); current.capabilities.forEach(cap => { cap.health.installed = false; cap.health.trusted = false; });
  newest.resolve(current); await tick();
  if (outcome === 'success') old.resolve(observation(old.selector)); else old.reject(new Error('stale inspection'));
  await tick(); assert.equal(dialog.querySelector('.spawn-installed').textContent, 'installed: 0/2 inspected');
  assert.equal(u.doc.querySelector('.spawn-dialog'), dialog); assert.equal(dialog.querySelector('.ftask').value, 'Keep draft');
});

test('roster refresh preserves form/disclosure/focus, but removed exact soul cannot be submitted', async t => {
  const u = await setup(t), dialog = await u.open(), task = u.change('.ftask', 'Unsaved'); task.focus();
  const before = u.calls.filter(c => c.path.startsWith('/api/launch-configs')).length;
  u.polls[0](); await tick();
  assert.equal(u.doc.querySelector('.spawn-dialog'), dialog); assert.equal(u.doc.activeElement, task); assert.equal(task.value, 'Unsaved');
  assert.equal(u.calls.filter(c => c.path.startsWith('/api/launch-configs')).length, before);
  u.setAgents([soul('/team/b/agents')]); u.polls[0](); await tick(); dialog.querySelector('.fspawn').click(); await tick();
  assert.equal(u.spawns().length, 0); assert.match(dialog.querySelector('.fstatus').textContent, /no longer available/);
});
