import { launchSoul } from './helpers/workspace-actions.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createSelectionOwnership } from '../renderer/selection-ownership.mjs';
import * as spawn from '../renderer/views/spawn.mjs';
import { currentWorkspace, setWorkspace, workspaceGeneration } from '../renderer/views/common.mjs';
import { refreshCli } from '../renderer/views/cli-status.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const CLI = { ok: true, operationsApi: 1, features: ['operations'], relations: true };
const soul = (agentsRoot = '/a/agents') => ({ name: 'dev', agentsRoot, runtime: 'pi', work: 'worktree', description: 'Current roster soul' });
const home = { agent: 'dev', instance: 'dev-seat', agentsRoot: '/b/agents', home: '/b/agents/dev/instances/dev-seat' };
// The CURRENT CLI inspect contract: selected.source and souls/snapshot,
// not the illustrative Portable Souls identity/knowledge/tasks schema.
const inspection = selector => ({
  operationsApi: 1, scope: { context: '/team' }, selected: { source: selector.home ? 'snapshot' : 'config' },
  souls: selector.soul ? [{ ...soul(selector.agentsRoot), name: selector.soul, editable: { fields: [], instructions: false }, instructions: { text: '# Saved instructions' } }] : [],
  snapshot: selector.home ? { instructions: { text: '# Captured instructions' }, drift: [] } : null,
  capabilities: [], layers: {},
});

async function setup(t, { hold = false, beforeMount } = {}) {
  const dom = new JSDOM('<!doctype html><body><div id="host"></div>', { url: 'http://localhost' });
  const saved = { document: globalThis.document, window: globalThis.window, setInterval: globalThis.setInterval, ws: currentWorkspace() };
  globalThis.document = dom.window.document; globalThis.window = dom.window;
  const polls = []; globalThis.setInterval = fn => { polls.push(fn); return 0; };
  const rosters = [], calls = [], files = [], terminals = [];
  let agents = [soul(), soul('/b/agents')];
  const ctx = {
    hasWorkspaceSwitcher: true,
    api: async (path, opts = {}) => {
      const body = opts.body ? JSON.parse(opts.body) : undefined; calls.push({ path, body });
      if (path === '/api/cli') return CLI;
      if (path.startsWith('/api/agents')) {
        if (!hold) return { agents };
        const request = deferred(); rosters.push(request); return request.promise;
      }
      if (path.startsWith('/api/panel')) return { workspace: { id: currentWorkspace(), scope: currentWorkspace() }, workspaces: [], instances: [home] };
      if (path.startsWith('/api/capabilities') && body.action === 'inspect') return inspection(body.selector);
      if (path.startsWith('/api/capabilities') && body.action === 'list') return { inventoryApi: 1,
        scope: { kind: 'classic', context: body.selector.context || currentWorkspace() }, packages: [], capabilities: [], legacy: [] };
      if (path === '/api/servers') return { servers: [] };
      throw new Error(`Unexpected fixture API: ${path}`);
    },
    openBrain: name => files.push(name), openTerminal: ref => terminals.push(ref),
  };
  const doc = dom.window.document;
  t.after(() => {
    spawn.unmount(); setWorkspace(saved.ws);
    globalThis.document = saved.document; globalThis.window = saved.window; globalThis.setInterval = saved.setInterval;
    dom.window.close();
  });
  setWorkspace('/team'); await refreshCli({ api: async () => CLI });
  beforeMount?.(); spawn.mount(doc.querySelector('#host'), ctx); await tick();
  const selectedTab = () => doc.querySelector('[role=tab][aria-selected=true]');
  return {
    doc, ctx, rosters, calls, files, terminals, selectedTab,
    poll: () => polls.at(-1)(),
    setAgents: next => { agents = next; },
    resolve: (index, next = agents) => rosters[index].resolve({ agents: next }),
    tab: name => { const control = doc.getElementById(`workspace-tab-${name}`); control.focus(); control.click(); },
    key: key => { const control = selectedTab(); control.focus(); control.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); },
    inspections: () => calls.filter(call => call.path.startsWith('/api/capabilities') && call.body.action === 'inspect'),
  };
}
for (const outcome of ['success', 'rejection']) for (const choice of ['sources', 'current souls']) {
  test(`mounted Workspace ${choice} supersedes a shell footer import ${outcome}`, async t => {
    const u = await setup(t);
    const source = readFileSync(new URL('../renderer/shell.mjs', import.meta.url), 'utf8');
    const gate = createSelectionOwnership({ currentWorkspace, workspaceGeneration });
    const hook = source.match(/onSelectionIntent:\s*(\(\) => tabOpenIntents\.invalidate\(\))/)?.[1];
    assert.ok(hook, 'production ctx shares Workspace selection with shell foreground ownership');
    u.ctx.onSelectionIntent = runInNewContext(hook, { tabOpenIntents: gate });
    const deferredImport = deferred(), notices = [], stages = [];
    const chooser = source.match(/async function openWorkspaceSouls\([^]*?\n\}/)[0]
      .replace('import("./views/spawn.mjs")', 'loadSpawn()');
    const choose = runInNewContext(`(${chooser})`, {
      document: u.doc, tabOpenIntents: gate,
      loadSpawn: () => deferredImport.promise,
      ctx: { notify: message => notices.push(message) },
      showStage: name => stages.push(name),
    });
    const pending = choose();
    u.tab(choice === 'sources' ? 'sources' : 'souls');
    const focused = u.doc.activeElement;
    if (outcome === 'success') deferredImport.resolve(spawn);
    else deferredImport.reject(new Error('superseded chooser'));
    await pending; await tick();
    assert.deepEqual(stages, [], 'old footer import cannot navigate after a newer Workspace choice');
    assert.deepEqual(notices, [], 'old footer rejection cannot notify after a newer Workspace choice');
    assert.equal(u.selectedTab().id, `workspace-tab-${choice === 'sources' ? 'sources' : 'souls'}`);
    assert.equal(u.doc.activeElement, focused);
  });
}

const inspectorFiles = u => [...u.doc.querySelectorAll('.soul-inspector button')].find(control => control.textContent === 'Files');
const handoff = kind => kind === 'soul' ? spawn.preselectSoul(soul('/b/agents')) : spawn.preselectHome(home);
function assertNoHandoff(u, tab) {
  assert.equal(u.selectedTab().id, `workspace-tab-${tab}`);
  assert.equal(u.doc.querySelector('.soul-inspector').hidden, true);
  assert.equal(u.doc.querySelector('.spawn-dialog'), null);
  assert.ok(u.inspections().every(call => !call.body.selector.soul && !call.body.selector.home), 'no superseded soul/home inspection was dispatched');
  assert.deepEqual(u.files, []); assert.deepEqual(u.terminals, []);
}

for (const [label, replacement] of [
  ['root replacement', soul('/b/agents')],
  ['host replacement', { ...soul(), server: 'other-host' }],
  ['remote replacement', { ...soul(), remote: true }],
]) test(`captured Files refuses ${label}, not just ambiguous names`, async t => {
  const u = await setup(t);
  u.setAgents([soul()]); u.poll(); await tick();
  u.doc.querySelector('.soul-card').click(); await tick();
  const captured = inspectorFiles(u); assert.ok(captured); assert.equal(captured.disabled, false);
  u.setAgents([replacement]); u.poll(); await tick();
  assert.equal(inspectorFiles(u), captured, 'polling preserves the inspector rather than disguising a retarget');
  captured.click();
  assert.deepEqual(u.files, [], 'old /a/agents/dev must never route to the same-named replacement');
  const refresh = [...u.doc.querySelectorAll('.soul-inspector button')].find(control => control.textContent === 'Refresh');
  refresh.click(); await tick();
  assert.equal(inspectorFiles(u).disabled, true, 'a rerender disables the stale Files selector too');
  if (label === 'root replacement') {
    const currentCard = u.doc.querySelector('.soul-card'); currentCard.focus();
    currentCard.dispatchEvent(new u.doc.defaultView.KeyboardEvent('keydown', { key: 'b', bubbles: true }));
    assert.deepEqual(u.files, ['dev'], 'the actual current unique local B path remains compatible');
    u.doc.querySelector('.soul-card').click(); await tick();
    assert.equal(inspectorFiles(u).disabled, false);
    inspectorFiles(u).click(); assert.deepEqual(u.files, ['dev', 'dev']);
  }
});

test('captured Files accepts a new roster object with the SAME composite identity', async t => {
  const u = await setup(t);
  u.setAgents([soul()]); u.poll(); await tick();
  u.doc.querySelector('.soul-card').click(); await tick();
  const captured = inspectorFiles(u);
  u.setAgents([{ ...soul(), server: '', description: 'New metadata, same local identity' }]); u.poll(); await tick();
  captured.click(); assert.deepEqual(u.files, ['dev']);
  spawn.unmount(); captured.click();
  assert.deepEqual(u.files, ['dev'], 'a disposed owner cannot use even a matching captured Files control');
});

const choices = [
  ['click Capabilities', u => u.tab('capabilities'), 'capabilities'],
  ['keyboard Sources', u => u.key('End'), 'sources'],
  ['footer Sources', () => spawn.preselectWorkspaceTab('sources'), 'sources'],
  ['click current Souls', u => u.tab('souls'), 'souls'],
  ['keyboard current Souls', u => u.key('Home'), 'souls'],
  ['footer current Souls', () => spawn.preselectWorkspaceTab('souls'), 'souls'],
  ['Souls → Sources → Souls', u => { u.tab('sources'); u.tab('souls'); }, 'souls'],
];
for (const kind of ['soul', 'home']) for (const [label, choose, tab] of choices) for (const outcome of ['success', 'rejection']) {
  test(`pending ${kind} loses to ${label} after roster ${outcome}`, async t => {
    const u = await setup(t, { hold: true });
    handoff(kind); choose(u);
    const focused = u.doc.activeElement;
    const summary = u.doc.querySelector('.souls-sum').textContent;
    if (outcome === 'success') u.resolve(0); else u.rosters[0].reject(new Error('superseded roster failure'));
    await tick();
    assertNoHandoff(u, tab);
    assert.equal(u.doc.activeElement, focused, 'late completion cannot restore focus to an older soul card');
    if (outcome === 'rejection') assert.equal(u.doc.querySelector('.souls-sum').textContent, summary, 'older rejection does not paint over the newer selection');
    else assert.equal(u.doc.querySelectorAll('.soul-card').length, 2, 'selection changes do NOT cancel roster population');
    // A later successful retry must not resurrect the obsolete pending handoff.
    u.poll(); u.resolve(1); await tick();
    assertNoHandoff(u, tab);
    assert.equal(u.doc.querySelector('#workspace-tab-souls .workspace-count').textContent, '2');
    for (const { path, body } of u.calls.filter(call => call.body)) {
      assert.equal(path.split('?')[0], '/api/capabilities');
      if (body.action === 'list') assert.deepEqual(body, { action: 'list', selector: {} });
      else assert.equal(body.action, 'inspect', 'no implicit launch/mutation');
    }
  });
}

for (const latest of ['soul', 'home']) for (const outcome of ['success', 'rejection']) {
  test(`latest ${latest} handoff survives a newer roster ticket and ignores older ${outcome}`, async t => {
    const u = await setup(t, { hold: true, beforeMount: () => handoff(latest === 'soul' ? 'home' : 'soul') });
    handoff(latest); u.poll();
    u.resolve(1); await tick();
    const expected = latest === 'soul' ? { soul: 'dev', agentsRoot: '/b/agents' } : { home: home.home };
    assert.deepEqual(u.inspections().map(call => call.body.selector), [expected], 'only the latest handoff consumes the current roster');
    assert.equal(u.doc.querySelector('.inspector-head h2').textContent, latest === 'soul' ? 'dev' : 'dev-seat');
    if (outcome === 'success') u.resolve(0, [{ ...soul(), name: 'stale-roster' }]); else u.rosters[0].reject(new Error('stale-roster failure'));
    await tick();
    assert.doesNotMatch(u.doc.querySelector('.souls').textContent, /stale-roster/);
    assert.deepEqual(u.inspections().map(call => call.body.selector), [expected]);
    assert.equal(u.doc.querySelector('.spawn-dialog'), null, 'Quick Open inspects, never launches');
    if (latest === 'soul') {
      assert.equal(u.doc.activeElement.dataset.root, '/b/agents', 'preselection focuses the composite card, not its same-name twin');
      u.doc.querySelector('[aria-label="Close inspector"]').click();
      assert.equal(u.doc.activeElement.dataset.root, '/b/agents');
      launchSoul(u.doc, u.doc.activeElement);
      assert.ok(u.doc.querySelector('.spawn-dialog'), 'Launch remains an explicit separate action');
      u.doc.querySelector('.fcancel').click();
      assert.equal(u.doc.querySelector('.soul-card.open').dataset.root, '/b/agents', 'same composite soul remains selected');
      assert.equal(u.doc.activeElement, u.doc.querySelector('.soul-inspector .spawn-act'), 'Launch cancellation returns to its inspector action');
    } else assert.match(u.doc.querySelector('.soul-inspector').textContent, /Instance snapshot.*Captured instructions/s);
  });
}

for (const kind of ['soul', 'home']) for (const boundary of ['workspace A → B → A', 'unmount/remount']) for (const outcome of ['success', 'rejection']) {
  test(`pending ${kind} dies across ${boundary}, including old roster ${outcome}`, async t => {
    const u = await setup(t, { hold: true });
    handoff(kind);
    if (boundary === 'unmount/remount') { spawn.unmount(); spawn.mount(u.doc.querySelector('#host'), u.ctx); }
    else { setWorkspace('/other'); setWorkspace('/team'); }
    u.resolve(u.rosters.length - 1); await tick();
    assertNoHandoff(u, 'souls');
    if (outcome === 'success') u.resolve(0, [{ ...soul(), name: 'stale-boundary' }]); else u.rosters[0].reject(new Error('stale-boundary failure'));
    if (boundary !== 'unmount/remount') u.resolve(1, [{ ...soul(), name: 'stale-boundary' }]);
    await tick();
    assertNoHandoff(u, 'souls');
    assert.doesNotMatch(u.doc.querySelector('.souls').textContent, /stale-boundary/);
  });
}

test('current roster rejection still reports failure and a current pending home can recover', async t => {
  const u = await setup(t, { hold: true, beforeMount: () => handoff('home') });
  u.rosters[0].reject(new Error('current roster unavailable')); await tick();
  assert.match(u.doc.querySelector('.souls-sum').textContent, /current roster unavailable/);
  u.poll(); u.resolve(1); await tick();
  assert.deepEqual(u.inspections().map(call => call.body.selector), [{ home: home.home }]);
  assert.equal(u.doc.querySelector('.inspector-head h2').textContent, 'dev-seat');
});
