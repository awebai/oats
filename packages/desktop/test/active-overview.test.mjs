import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import * as hierarchy from '../renderer/views/hierarchy.mjs';
import { projectActivePanel, canAddressInstance } from '../renderer/active-observation.mjs';
import { currentWorkspace, setWorkspace } from '../renderer/views/common.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const instance = (name = 'dev', fields = {}) => ({ instance: name, agent: 'soul', agentsRoot: '/team/agents', home: `/team/agents/soul/instances/${name}`, running: true, repoName: 'reported-repo', runtime: 'pi', branch: 'reported-branch', ...fields });
const panel = (instances = [instance()], id = currentWorkspace()) => ({ instances, workspace: { id }, workspaces: [{ id: '/team', name: 'Team' }, { id: '/other', name: 'Other' }], generatedAt: 'observation-time' });

async function setup(t, options = {}) {
  const mod = options.module || hierarchy, dom = new JSDOM('<body><main id="host"></main></body>', { url: 'http://localhost' });
  const doc = dom.window.document, host = doc.querySelector('main'), old = { window: globalThis.window, document: globalThis.document, setInterval: globalThis.setInterval, ws: currentWorkspace() };
  const polls = []; globalThis.window = dom.window; globalThis.document = doc; globalThis.setInterval = fn => { polls.push(fn); return 0; };
  setWorkspace('/team');
  let read = options.api || (() => panel(options.instances));
  const calls = [], opened = [], started = [], restarted = [], brains = [], views = [];
  const ctx = { hasWorkspaceSwitcher: true, api: (path, opts) => { calls.push({ path, opts }); return read(path, opts); },
    openTerminal: ref => { opened.push(ref); return options.openTerminal?.(ref); },
    startInstance: ref => started.push(ref), restartInstance: ref => restarted.push(ref),
    openBrain: ref => brains.push(ref), openView: name => views.push(name) };
  const dispose = mod.mount(host, ctx);
  t.after(() => { dispose(); setWorkspace(old.ws); globalThis.window = old.window; globalThis.document = old.document; globalThis.setInterval = old.setInterval; dom.window.close(); });
  await tick();
  const canvas = host.querySelector('.hier-canvas');
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1200, height: 800 });
  const mouse = (target, type, fields = {}) => target.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, button: 0, ...fields }));
  return { mod, dom, doc, host, canvas, calls, opened, started, restarted, brains, views, dispose, mouse,
    one: selector => host.querySelector(selector), all: selector => [...host.querySelectorAll(selector)],
    nodes: () => [...host.querySelectorAll('.hnode')],
    setRead: value => { read = value; }, poll: () => polls[0](), retry: () => host.querySelector('.hier-retry').click(),
    key: (key, fields = {}, target = canvas) => { const event = new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...fields }); target.dispatchEvent(event); return event; },
  };
}

test('frame07 counts relation groups separately from independents, named by their root instance (never a reported groupName) and truthful K7/K1 limits', async t => {
  const roster = [instance('root', { task: 'Asked about PR #412 — waiting on you', groupName: 'invented-group', git: { dirty: 42, pr: '#412' } }),
    instance('child', { parentInstance: 'root', agentsRoot: '/other/agents', home: '/other/child', repoName: 'other-repo', running: false }),
    instance('peer', { siblingInstance: 'root' }), instance('independent', { running: null, activity: 'blocked' })];
  const u = await setup(t, { instances: roster });
  assert.match(u.one('.hier-sum').textContent, /2 running.*1 stopped.*1 unknown.*1 group.*1 independent/);
  assert.equal(u.all('.hier-cluster').length, 1); assert.equal(u.all('.hier-solo .hnode').length, 1);
  // root and its sibling peer are both roots; the lexically-smallest root
  // names the group — the same deterministic label the sidebar group shows.
  assert.equal(u.one('.hier-chead .cnm').textContent, 'peer', 'the group is named like its sidebar group');
  assert.match(u.one('.hier-chead .cct').textContent, /^3 · (reported-repo · other-repo|other-repo · reported-repo)$/);
  assert.equal(u.one('.hier-context'), null, 'reported contexts live in the one header line');
  assert.ok(u.all('.hier-edges path:not(.sib)').every(path => !path.getAttribute('d').includes('C')));
  assert.match(u.one('.hier-edges path:not(.sib)').getAttribute('d'), /V .* H .* V .* H/);
  assert.equal(u.all('.hier-edges .sib').length, 1);
  u.mouse(u.nodes().find(n => n.dataset.name === 'root'), 'click');
  assert.equal(u.one('.pavailability').textContent, 'Activity: unknown · Waiting on you: unknown');
  assert.equal(u.one('.pgit').disabled, true); assert.match(u.one('.pgit').title, /K1\/P1/);
  assert.match(u.one('.pbranch').textContent, /Reported branch: reported-branch/);
  assert.doesNotMatch(u.host.textContent, /invented-group|#412|±42|Asked about|blocked/);
  assert.equal(u.one('.ptask'), null);
  assert.ok(u.calls.every(call => call.path.startsWith('/api/panel?ws=') && !call.opts));
});

test('no-op polls retain popup controls, focus, selection and pan/zoom despite ignored metadata/time changes', async t => {
  const u = await setup(t); u.mouse(u.nodes()[0], 'click');
  const node = u.nodes()[0], pop = u.one('.hier-pop'), button = u.one('.pterm'); button.focus();
  u.one('.zin').click(); const transform = u.one('.hier-stage').style.transform;
  u.setRead(() => ({ ...panel(), generatedAt: 'new time', instances: [instance('dev', { task: 'new prose', next: 'waiting', git: { dirty: 999 }, groupName: 'not-authority' })] }));
  for (let n = 0; n < 4; n++) { u.poll(); await tick(); }
  assert.equal(u.nodes()[0], node); assert.equal(u.one('.hier-pop'), pop); assert.equal(u.one('.pterm'), button);
  assert.equal(u.doc.activeElement, button); assert.equal(u.one('.hier-stage').style.transform, transform);
  assert.equal(node.getAttribute('aria-selected'), 'true');
  assert.equal(u.canvas.getAttribute('aria-activedescendant'), node.id);
});

test('same-named instances are visibly distinguished by reported root/home/host, not just internal keys', async t => {
  const u = await setup(t, { instances: [
    instance('twin', { agentsRoot: '/a/project/agents', home: '/a/project/agents/soul/i/twin' }),
    instance('twin', { agentsRoot: '/b/project/agents', home: '/b/project/agents/soul/i/twin' }),
    instance('intra', { home: '/team/agents/one/i/intra' }), instance('intra', { home: '/team/agents/two/i/intra' }),
    instance('remote', { server: 'host-a', savedRoute: true }), instance('remote', { server: 'host-b', savedRoute: true }),
  ] });
  for (const name of ['twin', 'intra', 'remote']) {
    const nodes = u.nodes().filter(node => node.dataset.name === name);
    assert.equal(new Set(nodes.map(node => node.querySelector('.hmeta').textContent)).size, 2);
    assert.equal(new Set(nodes.map(node => node.getAttribute('aria-label'))).size, 2);
    for (const node of nodes) { u.mouse(node, 'click'); assert.equal(u.one('.pidentity').hidden, false); assert.match(u.one('.pidentity').textContent, /Host:.*Root:.*Home:/); }
  }
  assert.match(u.nodes().find(node => node.dataset.name === 'twin').title, /Home: \/a\/project/);
});

test('meaningful updates keep the actual selected popup/focus, and its actions resolve current state', async t => {
  const u = await setup(t); u.mouse(u.nodes()[0], 'click');
  const pop = u.one('.hier-pop'), control = u.one('.pterm'); control.focus();
  u.setRead(() => panel([instance('dev', { running: false, branch: 'changed' })])); u.poll(); await tick();
  assert.equal(u.one('.hier-pop'), pop); assert.equal(u.one('.pterm'), control); assert.equal(u.doc.activeElement, control);
  assert.equal(control.textContent, 'Start…'); assert.match(u.one('.pbranch').textContent, /changed/);
  control.click(); assert.equal(u.started.length, 1); assert.equal(u.opened.length, 0);
  assert.equal(u.started[0].home, '/team/agents/soul/instances/dev');
});

for (const outcome of ['success', 'rejection']) test(`workspace switch synchronously revokes graph, popup and gestures; old ${outcome} cannot revive them`, async t => {
  const u = await setup(t); u.mouse(u.nodes()[0], 'click'); const oldNode = u.nodes()[0], oldButton = u.one('.pterm');
  const requests = []; u.setRead(() => { const d = deferred(); requests.push(d); return d.promise; });
  u.poll(); // old A poll
  u.mouse(oldNode, 'mousedown', { clientX: 10, clientY: 10 });
  u.mouse(u.dom.window, 'mousemove', { clientX: 50, clientY: 60 });
  setWorkspace('/other');
  assert.equal(u.nodes().length, 0); assert.equal(u.one('.hier-pop'), null);
  u.mouse(oldNode, 'dblclick'); oldButton.dispatchEvent(new u.dom.window.Event('click')); u.key('Enter');
  u.mouse(u.dom.window, 'mousemove', { clientX: 100, clientY: 120 }); u.mouse(u.dom.window, 'mouseup');
  assert.equal(u.opened.length + u.started.length, 0);
  requests[1].resolve(panel([instance('current')], '/other')); await tick();
  if (outcome === 'success') requests[0].resolve(panel([instance('stale')], '/team')); else requests[0].reject(new Error('stale error'));
  await tick(); assert.match(u.host.textContent, /current/); assert.doesNotMatch(u.host.textContent, /stale error|stale/);
});

async function sameWorkspaceRace(t, outcome, mod = hierarchy) {
  const u = await setup(t, { module: mod });
  u.setRead(() => Promise.reject(new Error('initial outage'))); u.poll(); await tick();
  const requests = []; u.setRead(() => { const d = deferred(); requests.push(d); return d.promise; });
  u.retry(); u.retry(); assert.equal(requests.length, 2);
  if (outcome === 'success') requests[1].reject(new Error('newest failure'));
  else requests[1].resolve(panel([instance('newest')]));
  await tick();
  if (outcome === 'success') requests[0].resolve(panel([instance('stale')])); else requests[0].reject(new Error('old failure'));
  await tick();
  return () => {
    if (outcome === 'success') { assert.match(u.one('.hier-notice').textContent, /newest failure/); assert.doesNotMatch(u.host.textContent, /stale/); }
    else { assert.equal(u.one('.hier-notice').hidden, true); assert.match(u.host.textContent, /newest/); }
  };
}
for (const outcome of ['success', 'rejection']) test(`same-workspace old ${outcome} cannot replace a newer observation/failure`, async t => {
  (await sameWorkspaceRace(t, outcome))();
});

test('unchanged observation recovers stale controls without rebuilding them; slow polling does not starve an in-flight read', async t => {
  const u = await setup(t); u.mouse(u.nodes()[0], 'click'); const pop = u.one('.hier-pop'), button = u.one('.pterm');
  const pending = deferred(); u.setRead(() => pending.promise); u.poll(); const count = u.calls.length;
  u.poll(); u.poll(); assert.equal(u.calls.length, count, 'timer joins/skips its in-flight read rather than superseding forever');
  pending.reject(new Error('offline')); await tick(); assert.equal(button.disabled, true);
  button.dispatchEvent(new u.dom.window.Event('click')); u.mouse(u.nodes()[0], 'dblclick'); assert.equal(u.opened.length, 0);
  u.setRead(() => panel()); u.retry(); await tick();
  assert.equal(u.one('.hier-pop'), pop); assert.equal(u.one('.pterm'), button); assert.equal(button.disabled, false); assert.equal(u.one('.hier-notice').hidden, true);
});

test('changed observations wait until node drag release, preserving offsets and following edges', async t => {
  const u = await setup(t, { instances: [instance('parent'), instance('child', { parentInstance: 'parent' })] });
  const old = u.nodes().find(n => n.dataset.name === 'child'), left = parseFloat(old.style.left);
  u.mouse(old, 'mousedown', { clientX: 10, clientY: 10 }); u.mouse(u.dom.window, 'mousemove', { clientX: 70, clientY: 40 });
  const path = u.one('.hier-edges path').getAttribute('d');
  u.setRead(() => panel([instance('parent'), instance('child', { parentInstance: 'parent', branch: 'new-observation' })])); u.poll(); await tick();
  assert.equal(u.nodes().find(n => n.dataset.name === 'child'), old, 'pending observation cannot replace a live drag reference');
  assert.match(u.one('.hier-notice').textContent, /apply on release/);
  u.mouse(u.dom.window, 'mousemove', { clientX: 110, clientY: 40 }); assert.notEqual(u.one('.hier-edges path').getAttribute('d'), path);
  u.mouse(u.dom.window, 'mouseup');
  const current = u.nodes().find(n => n.dataset.name === 'child'); assert.notEqual(current, old);
  assert.equal(parseFloat(current.style.left), left + 100); assert.match(current.textContent, /new-observation/);
  u.mouse(current, 'click'); assert.ok(u.one('.hier-pop'), 'old drag suppression cannot swallow a later replacement-node click');
});

test('drag suppression expires after its native click window instead of swallowing a later intentional click', async t => {
  const u = await setup(t), node = u.nodes()[0];
  u.mouse(node, 'mousedown', { clientX: 0, clientY: 0 }); u.mouse(u.dom.window, 'mousemove', { clientX: 40, clientY: 0 }); u.mouse(u.dom.window, 'mouseup');
  u.mouse(node, 'click'); assert.equal(u.one('.hier-pop'), null, 'same-gesture native click is consumed');
  await new Promise(resolve => u.dom.window.setTimeout(resolve, 5));
  u.mouse(node, 'click'); assert.ok(u.one('.hier-pop'));
  u.mouse(node, 'mousedown', { clientX: 0, clientY: 0 }); u.mouse(u.dom.window, 'mousemove', { clientX: 40, clientY: 0 }); u.mouse(u.dom.window, 'mouseup');
  await new Promise(resolve => u.dom.window.setTimeout(resolve, 5));
  u.mouse(node, 'click'); assert.ok(u.one('.hier-pop'), 'mouseup elsewhere cannot suppress a later click');
});

test('a newer failure discards a queued gesture observation rather than applying stale success on release', async t => {
  const u = await setup(t); u.mouse(u.nodes()[0], 'mousedown', { clientX: 0, clientY: 0 }); u.mouse(u.dom.window, 'mousemove', { clientX: 30, clientY: 10 });
  u.setRead(() => panel([instance('not-applied')])); u.poll(); await tick();
  u.setRead(() => Promise.reject(new Error('current failed'))); u.retry(); await tick();
  u.mouse(u.dom.window, 'mouseup'); assert.match(u.one('.hier-notice').textContent, /current failed/); assert.doesNotMatch(u.host.textContent, /not-applied/);
});

test('popup remains screen-sized and bounded through zoom/pan/resize; hidden views cannot act or reclaim focus', async t => {
  const u = await setup(t); u.mouse(u.nodes()[0], 'click'); const pop = u.one('.hier-pop'), control = u.one('.pterm'); control.focus();
  u.one('.zout').click();
  assert.equal(pop.parentElement, u.canvas, 'popup is outside the scaled graph stage');
  assert.equal(pop.style.transform, ''); assert.ok(parseFloat(pop.style.left) >= 8);
  u.canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 360, height: 300 });
  u.dom.window.dispatchEvent(new u.dom.window.Event('resize'));
  assert.ok(parseFloat(pop.style.left) + 224 <= 352); assert.ok(parseFloat(pop.style.top) >= 8);
  u.host.hidden = true;
  u.setRead(() => panel([instance('dev', { branch: 'new while hidden' })])); u.poll(); await tick();
  assert.notEqual(u.doc.activeElement, control, 'no focus restoration into a hidden stage');
  control.dispatchEvent(new u.dom.window.Event('click')); u.mouse(u.nodes()[0], 'dblclick');
  u.one('.spawnbtn').click(); assert.equal(u.opened.length, 0); assert.equal(u.views.length, 0);
  u.host.hidden = false;
});

test('window blur cancels a gesture and prevents hidden movement/action dispatch until focus returns', async t => {
  const u = await setup(t), node = u.nodes()[0];
  u.mouse(node, 'mousedown', { clientX: 0, clientY: 0 }); u.mouse(u.dom.window, 'mousemove', { clientX: 20, clientY: 20 });
  const left = node.style.left; u.dom.window.dispatchEvent(new u.dom.window.Event('blur'));
  u.mouse(u.dom.window, 'mousemove', { clientX: 200, clientY: 200 }); assert.equal(node.style.left, left);
  u.mouse(node, 'dblclick'); assert.equal(u.opened.length, 0);
  u.dom.window.dispatchEvent(new u.dom.window.Event('focus')); u.mouse(node, 'dblclick'); assert.equal(u.opened.length, 1);
});

test('background panning defers a changed observation, then preserves the user camera on release', async t => {
  const u = await setup(t);
  u.mouse(u.canvas, 'mousedown', { clientX: 10, clientY: 10 }); u.mouse(u.dom.window, 'mousemove', { clientX: 50, clientY: 70 });
  const stage = u.one('.hier-stage'), transform = stage.style.transform;
  u.setRead(() => panel([instance('new')])); u.poll(); await tick(); assert.equal(u.one('.hier-stage'), stage);
  u.mouse(u.dom.window, 'mouseup');
  assert.notEqual(u.one('.hier-stage'), stage); assert.equal(u.one('.hier-stage').style.transform, transform); assert.match(u.host.textContent, /new/);
});

function luminance(hex) {
  assert.match(hex, /^#[0-9a-f]{6}$/i);
  const c = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
}
for (const theme of ['light', 'solarized', 'dark']) test(`${theme}: actual Active graph/popup foregrounds meet computed-token AA`, async t => {
  const u = await setup(t, { instances: [instance('root'), instance('child', { parentInstance: 'root' }), instance('root', { agentsRoot: '/other/agents', home: '/other/root' })] });
  const style = u.doc.createElement('style'); style.textContent = readFileSync(new URL('../renderer/theme.css', import.meta.url), 'utf8'); u.doc.head.append(style); u.doc.documentElement.dataset.theme = theme;
  u.mouse(u.nodes()[0], 'click'); const root = u.dom.window.getComputedStyle(u.doc.documentElement);
  for (const [selector, background, fg, bg] of [
    ['.hier-sum', '.hier-bar', 'muted', 'surface'], ['.hier-chead .cct', '.hier-cluster', 'muted', 'surface-2'],
    ['.hier-chead .cnm', '.hier-cluster', 'muted', 'surface-2'], ['.hnode.sel .nm', '.hnode.sel', 'fg', 'surface'],
    ['.hnode.sel .hmeta', '.hnode.sel', 'muted', 'surface'], ['.pavailability', '.hier-pop', 'muted', 'surface'],
    ['.pname', '.hier-pop', 'fg', 'surface'], ['.pidentity', '.hier-pop', 'muted', 'surface'], ['.pgit', '.pgit', 'faint', 'surface-2'], ['.spawnbtn', '.spawnbtn', 'primary-fg', 'primary-bg'],
  ]) {
    const el = u.one(selector), painted = u.one(background); assert.ok(el && painted);
    assert.equal(u.dom.window.getComputedStyle(el).color, `var(--${fg})`, selector);
    assert.equal(u.dom.window.getComputedStyle(painted).background, `var(--${bg})`, background);
    const a = luminance(root.getPropertyValue(`--${fg}`).trim()), b = luminance(root.getPropertyValue(`--${bg}`).trim());
    assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, selector);
    for (let parent = el; parent; parent = parent.parentElement) assert.equal(u.dom.window.getComputedStyle(parent).opacity, '1');
  }
});

test('remote twins preserve server/home identity; unknown or unaddressed nodes cannot act, and Brain never guesses', async t => {
  const shared = { home: '/same/home', agentsRoot: '/same/agents', savedRoute: true };
  const u = await setup(t, { instances: [instance('twin', { ...shared, server: 'a' }), instance('twin', { ...shared, server: 'b' }),
    instance('unknown', { running: null }), instance('unrouted', { server: 'c', savedRoute: false }),
    instance('weak', { home: '', agentsRoot: '' })] });
  const twins = u.nodes().filter(n => n.dataset.name === 'twin'); for (const n of twins) u.mouse(n, 'dblclick');
  assert.deepEqual(u.opened.map(i => i.server), ['a', 'b']); assert.ok(u.opened.every(i => i.home === '/same/home'));
  for (const n of u.nodes().filter(n => n.dataset.name !== 'twin')) { u.mouse(n, 'dblclick'); u.mouse(n, 'click'); assert.equal(u.one('.pterm').disabled, true); }
  assert.equal(u.opened.length, 2); assert.equal(u.started.length, 0);
  u.mouse(twins[0], 'click'); u.key('B'); assert.equal(u.brains.length, 0); assert.equal(u.one('.pbrain').disabled, true);
  u.one('.pworkspace').click(); assert.deepEqual(u.views, ['spawn']);
});

test('popup native controls own Enter; detached popup buttons and late action failures cannot beat a new selection', async t => {
  const action = deferred(); const u = await setup(t, { instances: [instance('a'), instance('b')], openTerminal: () => action.promise });
  u.mouse(u.nodes()[0], 'click'); const button = u.one('.pterm');
  const e = u.key('Enter', {}, button); assert.equal(e.defaultPrevented, false); assert.equal(u.opened.length, 0);
  button.click(); assert.equal(u.opened.length, 1);
  u.mouse(u.nodes()[1], 'click'); button.dispatchEvent(new u.dom.window.Event('click')); assert.equal(u.opened.length, 1);
  action.reject(new Error('late terminal error')); await tick(); assert.equal(u.one('.pstatus').textContent, '');
});

for (const [label, data] of [
  ['invalid shape', {}], ['duplicate identity', panel([instance(), instance()], '/team')],
  ['foreign workspace', panel([instance()], '/foreign')], ['invalid instance address', panel([instance('dev', { server: {} })], '/team')],
]) test(`${label} is unavailable, not an empty healthy roster`, async t => {
  const u = await setup(t, { api: () => data }); assert.match(u.one('.hier-notice').textContent, /Roster unavailable/);
  assert.equal(u.one('.hier-sum').textContent, 'Roster unknown'); assert.equal(u.nodes().length, 0); assert.equal(u.one('.empty'), null);
});

test('failed empty remote observation is not healthy absence; reported error rows have unknown runtime state', async t => {
  const u = await setup(t, { api: () => ({ ...panel([], '/team'), error: 'probe unavailable' }) });
  assert.equal(u.one('.hier-sum').textContent, 'Roster unknown'); assert.equal(u.one('.empty'), null);
  u.setRead(() => ({ ...panel([instance('cached')]), error: 'probe unavailable' })); u.retry(); await tick();
  assert.match(u.one('.hier-sum').textContent, /0 running.*0 stopped.*1 unknown/);
  u.mouse(u.nodes()[0], 'click'); assert.equal(u.one('.pterm').disabled, true);
});

test('malicious metadata stays inert; unnegotiated activity/task/git fields never become observations', async t => {
  const hostile = `x'\"><img src=x onerror=bad()>[data-id=x]`;
  const u = await setup(t, { instances: [instance(hostile, { repoName: hostile, branch: hostile, task: 'secret-task-decoy', activity: 'waiting', git: { pr: 'secret-pr-decoy' } })] });
  u.mouse(u.nodes()[0], 'click');
  assert.equal(u.one('.pname').textContent, hostile); assert.ok(u.one('.pbranch').textContent.includes(hostile));
  assert.equal(u.one('img,script,iframe'), null); assert.doesNotMatch(u.host.textContent, /secret-task-decoy|secret-pr-decoy/);
  assert.equal(u.nodes()[0].id.includes(hostile), false, 'opaque identity never becomes a selector/id');
  assert.equal(projectActivePanel(panel([instance('unknown', { running: 'true' })], '/team')).instances[0].running, null);
  assert.equal(canAddressInstance(instance('missing-route', { server: 'host' })), false);
  assert.equal(canAddressInstance(instance('bad-home', { home: 'relative-home' })), false, 'malformed primary home must not fall back to another root/name target');
});

async function mutatedModule(before, after) {
  let source = readFileSync(new URL('../renderer/views/hierarchy.mjs', import.meta.url), 'utf8'); assert.ok(source.includes(before));
  source = source.replace(before, after).replace(/from "(\.[^"]+)"/g, (_all, path) => `from ${JSON.stringify(new URL(path, new URL('../renderer/views/hierarchy.mjs', import.meta.url)).href)}`);
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
for (const outcome of ['success', 'rejection']) test(`${outcome} race pin detects weakened per-request ownership`, async t => {
  const mod = await mutatedModule('s.alive && request === s.request && myGen === workspaceGeneration()', 's.alive && myGen === workspaceGeneration()');
  const assertCurrent = await sameWorkspaceRace(t, outcome, mod); assert.throws(assertCurrent);
});

for (const weakened of [false, true]) test(`global workspace generation protects refresh without a mounted local reset (weakened=${weakened})`, async t => {
  const mod = weakened ? await mutatedModule('s.alive && request === s.request && myGen === workspaceGeneration()', 's.alive && request === s.request') : hierarchy;
  const dom = new JSDOM('<body><main><div class="hier-canvas"></div><span class="hier-sum"></span><select class="wssel"></select><div class="hier-notice"></div></main></body>');
  const doc = dom.window.document, el = doc.querySelector('main'), pending = deferred(), previous = { ws: currentWorkspace(), document: globalThis.document };
  globalThis.document = doc; setWorkspace('/team');
  t.after(() => { setWorkspace(previous.ws); globalThis.document = previous.document; dom.window.close(); });
  const s = { el, alive: true, ctx: { api: () => pending.promise }, panel: { instances: [] },
    canvas: el.querySelector('.hier-canvas'), q: cls => el.querySelector(`.${cls}`), nodeEls: new Map(), nodeOffsets: new Map(), fitted: true, tx: 40, ty: 40, z: 1 };
  const reading = mod.refresh(s);
  setWorkspace('/other'); setWorkspace('/team'); // no mounted reset/ticket increment to mask a missing global guard
  pending.resolve(panel([instance('stale')], '/team')); await reading;
  const assertCurrent = () => assert.equal(s.panel.instances.length, 0);
  if (weakened) assert.throws(assertCurrent); else assertCurrent();
});

test('disposed view ignores pending observations and retained instance actions', async t => {
  const u = await setup(t); u.mouse(u.nodes()[0], 'click'); const button = u.one('.pterm'), old = u.nodes()[0];
  const request = deferred(); u.setRead(() => request.promise); u.poll(); u.dispose();
  request.resolve(panel([instance('late')])); await tick();
  button.dispatchEvent(new u.dom.window.Event('click')); u.mouse(old, 'dblclick');
  assert.equal(u.host.innerHTML, ''); assert.equal(u.opened.length, 0);
});
