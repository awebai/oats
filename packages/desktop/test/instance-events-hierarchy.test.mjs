import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import * as hierarchy from '../renderer/views/hierarchy.mjs';
import { cliStatus, refreshCli, resetCliStateForTests } from '../renderer/views/cli-status.mjs';
import { currentWorkspace, setWorkspace } from '../renderer/views/common.mjs';
import { eventsData } from '../renderer/instance-events-data.mjs';
import { cli, target, birth, event, data, deferred, tick } from './helpers/instance-events-fixture.mjs';
const instance = (name = 'dev-a', fields = {}) => ({ ...target.selector, instance: name, home: `/inert/ws/agents/dev/instances/${name}`,
  createdAt: birth, running: true, runtime: 'pi', repoName: 'repo', ...fields });
function response(row, workspace = currentWorkspace()) {
  const t = { ...target, workspace, home: row.home, incarnation: row.createdAt ?? null, selector: { instance: row.instance, agent: row.agent, agentsRoot: row.agentsRoot, server: row.server ?? null } };
  const raw = data([event({ instance: row.instance, home: row.home, incarnation: t.incarnation })]);
  raw.instance = row.instance; raw.home = row.home; raw.incarnation = t.incarnation;
  return { instanceEventsViewApi: 1, status: 'available', target: t, data: eventsData(raw, t), reason: null };
}
async function setup(t) {
  const dom = new JSDOM('<body><main></main></body>'), doc = dom.window.document, host = doc.querySelector('main');
  const old = { window: globalThis.window, document: globalThis.document, setInterval: globalThis.setInterval, workspace: currentWorkspace() };
  globalThis.window = dom.window; globalThis.document = doc;
  const polls = []; globalThis.setInterval = fn => { polls.push(fn); return 0; };
  setWorkspace('ws'); resetCliStateForTests(); await refreshCli({ api: async () => structuredClone(cli) });
  let rows = [instance(), instance('other')], events = async (_path, body) => response(rows.find(i => i.instance === body.selector.instance));
  let panelError = false;
  const calls = [], terminals = [], starts = [], views = [];
  const dispose = hierarchy.mount(host, { hasWorkspaceSwitcher: true, api: (path, opts) => {
    calls.push({ path, opts });
    if (path.startsWith('/api/panel')) {
      if (panelError) throw Error('fixture roster outage');
      return { workspace: { id: currentWorkspace() }, workspaces: [{ id: 'ws' }, { id: 'other' }], instances: rows };
    }
    assert.equal(path.split('?')[0], '/api/instance-events'); assert.equal(opts.method, 'POST');
    return events(path, JSON.parse(opts.body));
  }, openTerminal: value => terminals.push(value), startInstance: value => starts.push(value), openView: value => views.push(value) });
  t.after(() => { dispose(); resetCliStateForTests(); setWorkspace(old.workspace); globalThis.window = old.window; globalThis.document = old.document; globalThis.setInterval = old.setInterval; dom.window.close(); });
  await tick(); host.querySelector('.hier-canvas').getBoundingClientRect = () => ({ left: 0, top: 0, width: 1200, height: 800 });
  return { dom, doc, host, calls, terminals, starts, views, dispose,
    one: selector => host.querySelector(selector), poll: async () => { polls[0](); await tick(); },
    select(name = 'dev-a') { host.querySelector(`.hnode[data-name="${name}"]`).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); },
    events(next) { events = next; }, rows(next) { rows = next; }, outage(value) { panelError = value; },
    count: () => calls.filter(c => c.path.startsWith('/api/instance-events')).length,
  };
}
test('actual hierarchy loads only after explicit selected click; popup controls do not dispatch tree terminal keys', async t => {
  const u = await setup(t); await u.poll(); u.select(); await tick(); assert.equal(u.count(), 0);
  const button = u.one('.events-load'); assert.equal(button.disabled, false); button.focus();
  const enter = new u.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }); button.dispatchEvent(enter);
  assert.equal(enter.defaultPrevented, false); assert.equal(u.terminals.length, 0);
  button.click(); await tick(); assert.equal(u.count(), 1);
  assert.match(u.one('.pavailability').textContent, /Spawned.*Current recorded incarnation/);
  assert.doesNotMatch(u.host.textContent, /Activity\/waiting: available after K7/);
  assert.equal(u.one('.pgit').disabled, true); assert.equal(u.one('.pbrain').disabled, true);
  assert.equal(u.terminals.length + u.starts.length, 0);
  const disclosure = u.one('.events-details summary');
  for (const key of ['Enter', ' ', 'ArrowDown', 'T']) {
    const event = new u.dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }); disclosure.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false, 'native disclosure/reading keys do not activate graph commands');
  }
  const camera = u.one('.hier-stage').style.transform;
  const wheel = new u.dom.window.WheelEvent('wheel', { deltaY: 50, bubbles: true, cancelable: true }); u.one('.events-rows').dispatchEvent(wheel);
  assert.equal(wheel.defaultPrevented, false, 'popup wheel scroll does not pan camera');
  assert.equal(u.one('.hier-stage').style.transform, camera); assert.equal(u.terminals.length, 0);
});
test('expanding activity repositions the bounded popup without moving the camera or focusing a control', async t => {
  const u = await setup(t); u.select(); u.one('.events-load').click(); await tick();
  const pop = u.one('.hier-pop'), details = u.one('.events-details'), button = u.one('.events-load');
  Object.defineProperty(pop, 'offsetHeight', { configurable: true, get: () => details.open ? 600 : 200 });
  button.focus(); const camera = u.one('.hier-stage').style.transform;
  pop.style.top = '500px'; // valid for the prior200px body, not its expanded600px body
  details.open = true; details.dispatchEvent(new u.dom.window.Event('toggle'));
  assert.ok(parseFloat(pop.style.top) + 600 <= 792); assert.equal(u.one('.hier-stage').style.transform, camera);
  assert.equal(u.doc.activeElement, button); assert.equal(pop.style.maxHeight, '784px');
});
test('meaningful unrelated roster updates do not cancel an in-flight activity read or replace its controls', async t => {
  const u = await setup(t), gate = deferred(); u.events(() => gate.promise); u.select();
  const pop = u.one('.hier-pop'), button = u.one('.events-load'); button.focus(); button.click();
  u.rows([instance(), instance('other', { running: false, branch: 'changed' })]); await u.poll();
  assert.equal(u.one('.hier-pop'), pop); assert.equal(u.one('.events-load'), button); assert.equal(u.doc.activeElement, button); assert.equal(u.count(), 1);
  gate.resolve(response(instance())); await tick();
  assert.match(u.one('.events-status').textContent, /observation loaded/); assert.equal(u.count(), 1);
});
test('roster repaint keeps event text selection, popup/list scroll, disclosure, focused button and camera', async t => {
  const u = await setup(t); u.select(); u.one('.events-load').click(); await tick();
  const pop = u.one('.hier-pop'), button = u.one('.events-load'), rows = u.one('.events-rows'), row = rows.firstElementChild;
  u.one('.events-details').open = true; rows.scrollTop = 31; pop.scrollTop = 47; u.one('.zin').click();
  const camera = u.one('.hier-stage').style.transform; button.focus();
  const range = u.doc.createRange(); range.selectNodeContents(row.querySelector('strong')); u.dom.window.getSelection().removeAllRanges(); u.dom.window.getSelection().addRange(range);
  const text = u.dom.window.getSelection().toString(); assert.equal(text, 'Spawned');
  for (let n = 0; n < 3; n++) { u.rows([instance(), instance('other', { branch: `branch-${n}` })]); await u.poll(); }
  assert.equal(u.one('.hier-pop'), pop); assert.equal(u.one('.events-rows'), rows); assert.equal(rows.firstElementChild, row);
  assert.equal(u.dom.window.getSelection().toString(), text); assert.equal(u.doc.activeElement, button);
  assert.equal(rows.scrollTop, 31); assert.equal(pop.scrollTop, 47); assert.equal(u.one('.events-details').open, true);
  assert.equal(u.one('.hier-stage').style.transform, camera); assert.equal(u.count(), 1);
});
for (const reject of [false, true]) test(`same-address recreation revokes activity ${reject ? 'rejection' : 'success'} independently of runtime`, async t => {
  const u = await setup(t), gate = deferred(); u.select(); u.events(() => gate.promise); u.one('.events-load').click();
  u.rows([instance('dev-a', { createdAt: '2026-09-23T00:00:00.000Z' })]); await u.poll();
  if (reject) gate.reject(Error('PRIVATE')); else gate.resolve(response(instance())); await tick();
  assert.equal(u.one('.events-details').hidden, true); assert.equal(u.one('.pavailability').textContent, 'Activity: unknown · Waiting on you: unknown');
  assert.doesNotMatch(u.host.textContent, /PRIVATE/); assert.match(u.one('.pstate').textContent, /running/);
});
for (const reject of [false, true]) test(`workspace A→B→A cannot revive old activity ${reject ? 'rejection' : 'success'}`, async t => {
  const u = await setup(t), gate = deferred(); u.select(); u.events(() => gate.promise); u.one('.events-load').click();
  setWorkspace('other'); await tick(); setWorkspace('ws'); await tick(); u.select();
  if (reject) gate.reject(Error('PRIVATE')); else gate.resolve(response(instance())); await tick();
  assert.equal(u.one('.events-details').hidden, true); assert.equal(u.count(), 1); assert.doesNotMatch(u.host.textContent, /PRIVATE/);
});
test('window blur→focus revokes pending activity even with unchanged DOM/selection', async t => {
  const u = await setup(t), gate = deferred(); u.select(); u.events(() => gate.promise); u.one('.events-load').click();
  u.dom.window.dispatchEvent(new u.dom.window.Event('blur')); u.dom.window.dispatchEvent(new u.dom.window.Event('focus'));
  gate.resolve(response(instance())); await tick(); assert.equal(u.one('.events-details').hidden, true);
});
test('roster failure and recovery cannot revive a revoked activity request', async t => {
  const u = await setup(t), gate = deferred(); u.select(); u.events(() => gate.promise); u.one('.events-load').click();
  u.outage(true); await u.poll(); assert.equal(u.one('.events-load').disabled, true);
  u.outage(false); await u.poll(); assert.equal(u.one('.events-load').disabled, false);
  gate.resolve(response(instance())); await tick(); assert.equal(u.one('.events-details').hidden, true);
});
for (const reject of [false, true]) test(`close/select/dispose revokes old activity ${reject ? 'rejection' : 'success'}`, async t => {
  const u = await setup(t), gate = deferred(); u.select(); u.events(() => gate.promise); const oldButton = u.one('.events-load'); oldButton.click();
  u.select('other'); assert.equal(oldButton.isConnected, false); oldButton.click(); assert.equal(u.count(), 1);
  if (reject) gate.reject(Error('PRIVATE')); else gate.resolve(response(instance())); await tick();
  assert.equal(u.one('.events-details').hidden, true); assert.doesNotMatch(u.host.textContent, /PRIVATE/);
  u.dispose(); assert.equal(u.host.childElementCount, 0);
});
test('removing the selected instance removes its retained popup while other nodes remain', async t => {
  const u = await setup(t), gate = deferred(); u.select(); u.events(() => gate.promise);
  const pop = u.one('.hier-pop'), button = u.one('.events-load'); button.click();
  u.rows([instance('other')]); await u.poll(); assert.equal(pop.isConnected, false); assert.equal(u.one('.hier-pop'), null);
  gate.resolve(response(instance())); await tick(); assert.equal(u.one('.hier-pop'), null); assert.equal(u.count(), 1);
});
test('actual shell exposes existing backend invalidation generation/subscription without new IPC', () => {
  const source = readFileSync(new URL('../renderer/shell.mjs', import.meta.url), 'utf8');
  const signal = source.slice(source.indexOf('let connectionGeneration = 0;'), source.indexOf('const notifications = createNotificationCenter'));
  const definition = source.slice(source.indexOf('const ctx = {'), source.indexOf('const openInstanceStart ='));
  let changed;
  const ctx = new Function('desk', 'window', 'api', 'notifications', `${signal}\n${definition}\nreturn ctx;`)(
    { onForgeChanged: fn => { changed = fn; return () => {}; } }, { addEventListener() {} }, async () => ({}), { notify() {} });
  let calls = 0; const off = ctx.subscribeConnections(() => calls++);
  assert.equal(ctx.connectionGeneration(), 0); changed(); changed();
  assert.equal(ctx.connectionGeneration(), 2); assert.equal(calls, 2); off(); changed(); assert.equal(calls, 2);
});
test('shared CLI downgrade disables current popup without command fan-out', async t => {
  const u = await setup(t); u.select(); u.one('.events-load').click(); await tick();
  await refreshCli({ api: async () => ({ ...cliStatus(), eventsApi: 1 }) });
  assert.equal(u.one('.events-load').disabled, true); assert.match(u.one('.pavailability').textContent, /^Last observation/);
  await u.poll(); assert.equal(u.count(), 1);
});
