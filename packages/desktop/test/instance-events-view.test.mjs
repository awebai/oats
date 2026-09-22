import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createInstanceEventsView, instanceEventsCSS } from '../renderer/instance-events-view.mjs';
import { eventsData } from '../renderer/instance-events-data.mjs';
import { eventsFailure } from '../renderer/instance-events-contract.mjs';
import { cli, target, birth, data, event, deferred, tick } from './helpers/instance-events-fixture.mjs';
const view = (value = data(), t = target) => ({ instanceEventsViewApi: 1, status: 'available', target: structuredClone(t), data: eventsData(value, t), reason: null });
function setup(t, invoke = async () => view()) {
  const dom = new JSDOM('<body><main class="oats-view"><div class="pop"><p class="summary"></p></div></main></body>');
  const doc = dom.window.document, host = doc.querySelector('.pop'), summary = doc.querySelector('.summary');
  const state = { target: structuredClone(target), cli: structuredClone(cli), generation: 0, connection: 0, owned: true }, calls = [], listeners = new Set(), connections = new Set();
  let read = invoke;
  const controller = createInstanceEventsView(host, { summary, ctx: { api: (path, opts) => { calls.push({ path, opts }); return read(path, opts); } },
    selection: () => state.target, cli: () => state.cli, owner: () => state.owned, generation: () => state.generation,
    subscribeCli: fn => { listeners.add(fn); return () => listeners.delete(fn); }, connectionGeneration: () => state.connection,
    subscribeConnections: fn => { connections.add(fn); return () => connections.delete(fn); } });
  t.after(() => { controller.dispose(); dom.window.close(); });
  return { dom, doc, host, summary, state, calls, controller, one: selector => host.querySelector(selector),
    setRead: next => read = next, cliChange: () => { for (const fn of listeners) fn(); },
    connectionChange: () => { state.connection++; for (const fn of connections) fn(); }, listeners, connections };
}
test('selected view issues zero mount/sync reads; explicit native button sends only qualified K7 POST', async t => {
  const u = setup(t); for (let n = 0; n < 5; n++) u.controller.sync(); assert.equal(u.calls.length, 0);
  const button = u.one('.events-load'); assert.equal(button.disabled, false); assert.equal(button.textContent, 'Load activity');
  button.focus(); button.click(); await tick();
  assert.equal(u.calls.length, 1); assert.equal(u.calls[0].path, '/api/instance-events?ws=ws');
  assert.equal(u.calls[0].opts.method, 'POST');
  assert.deepEqual(JSON.parse(u.calls[0].opts.body), { action: 'read', selector: target.selector, limit: 100 });
  assert.equal(u.doc.activeElement, button); assert.equal(button.textContent, 'Refresh activity');
  assert.match(u.summary.textContent, /Spawned.*Current recorded incarnation.*Waiting on you: unknown/);
  assert.equal(u.one('.events-status').getAttribute('aria-live'), 'polite');
});
for (const reject of [false, true]) test(`latest explicit read owns late ${reject ? 'rejection' : 'success'} and cleanup`, async t => {
  const gates = [], u = setup(t, () => { const gate = deferred(); gates.push(gate); return gate.promise; });
  const first = u.controller.read(), second = u.controller.read(); assert.equal(gates.length, 2);
  gates[1].resolve(view(data([event({ kind: 'recomposed', data: { blocks: 2, reason: 'newest observation' } })]))); await second;
  const content = u.host.textContent;
  if (reject) gates[0].reject(Error('PRIVATE stale error')); else gates[0].resolve(view());
  await first; assert.equal(u.host.textContent, content); assert.match(content, /newest observation/);
  assert.equal(u.one('.events-view').getAttribute('aria-busy'), 'false'); assert.equal(u.one('.events-load').disabled, false);
});
for (const reject of [false, true]) for (const kind of ['target', 'birth', 'workspace ABA', 'CLI', 'connection', 'owner']) test(`${kind} revokes unsignaled late ${reject ? 'rejection' : 'success'}`, async t => {
  const gate = deferred(), u = setup(t, () => gate.promise); const pending = u.controller.read();
  const before = u.host.innerHTML;
  if (kind === 'target') u.state.target = { ...target, home: '/other/dev-a', selector: { ...target.selector, agentsRoot: '/other' } };
  if (kind === 'birth') u.state.target.incarnation = '2026-09-23T00:00:00.000Z';
  if (kind === 'workspace ABA') { u.state.generation++; u.state.generation++; }
  if (kind === 'CLI') u.state.cli.eventsApi = 1;
  if (kind === 'connection') u.state.connection++;
  if (kind === 'owner') u.state.owned = false;
  if (reject) gate.reject(Error('PRIVATE')); else gate.resolve(view()); await pending;
  assert.equal(u.one('.events-details').hidden, true); assert.doesNotMatch(u.host.textContent, /observation loaded|PRIVATE/);
  assert.equal(u.host.innerHTML, before, 'a revoked completion cannot paint or release another lifetime’s controls');
});
for (const reject of [false, true]) test(`same-address new birth clears prior evidence and rejects old ${reject ? 'rejection' : 'success'}`, async t => {
  const u = setup(t); await u.controller.read(); assert.equal(u.one('.events-details').hidden, false);
  const gate = deferred(); u.setRead(() => gate.promise); const pending = u.controller.read();
  u.state.target.incarnation = '2026-09-23T00:00:00.000Z'; u.controller.sync();
  assert.equal(u.one('.events-details').hidden, true); assert.equal(u.summary.textContent, 'Activity: unknown · Waiting on you: unknown');
  if (reject) gate.reject(Error('PRIVATE')); else gate.resolve(view()); await pending;
  assert.equal(u.one('.events-details').hidden, true); assert.doesNotMatch(u.host.textContent, /PRIVATE/);
});
for (const attribute of ['hidden', 'style', 'inert']) test(`${attribute} hide→show ABA revokes a pending read before its completion`, async t => {
  const gate = deferred(), u = setup(t, () => gate.promise), parent = u.doc.querySelector('main');
  const pending = u.controller.read();
  if (attribute === 'style') { parent.style.display = 'none'; parent.style.display = ''; }
  else { parent.setAttribute(attribute, ''); parent.removeAttribute(attribute); }
  await tick(); gate.resolve(view()); await pending;
  assert.equal(u.one('.events-details').hidden, true); assert.match(u.one('.events-status').textContent, /cancelled while hidden/);
});
test('hidden owner never dispatches even when read is called directly before observer delivery', async t => {
  const u = setup(t); u.doc.querySelector('main').hidden = true;
  await u.controller.read(); assert.equal(u.calls.length, 0);
});
for (const reject of [false, true]) test(`dispose revokes late ${reject ? 'rejection' : 'success'} and unsubscribes`, async t => {
  const gate = deferred(), u = setup(t, () => gate.promise), pending = u.controller.read();
  u.controller.dispose(); assert.equal(u.listeners.size, 0); assert.equal(u.connections.size, 0);
  const before = u.summary.textContent;
  if (reject) gate.reject(Error('PRIVATE')); else gate.resolve(view()); await pending;
  assert.equal(u.one('.events-view'), null); assert.equal(u.summary.textContent, before);
});
test('failed refresh retains actual old rows/focus/scroll with explicit stale labeling', async t => {
  const u = setup(t); await u.controller.read(); u.one('.events-details').open = true;
  const row = u.one('.events-rows li'), rows = u.one('.events-rows'), button = u.one('.events-load');
  rows.scrollTop = 45; button.focus(); u.setRead(async () => { throw Object.assign(Error('PRIVATE'), { code: 'E_CLI_TIMEOUT' }); });
  await u.controller.read();
  assert.equal(u.one('.events-rows li'), row); assert.equal(rows.scrollTop, 45); assert.equal(u.doc.activeElement, button);
  assert.match(u.summary.textContent, /^Last observation/); assert.match(u.one('.events-status').textContent, /timed out.*Last observation retained/);
  assert.doesNotMatch(u.host.textContent, /PRIVATE/); assert.equal(u.one('.events-details').open, true);
});
test('CLI downgrade invalidates and disables without auto-read; upgrade only enables explicit retry', async t => {
  const u = setup(t); await u.controller.read();
  const gate = deferred(); u.setRead(() => gate.promise); const pending = u.controller.read();
  u.state.cli.eventsApi = 1; u.cliChange(); gate.resolve(view()); await pending;
  assert.equal(u.one('.events-load').disabled, true); assert.match(u.summary.textContent, /^Last observation/);
  const count = u.calls.length; await u.controller.read(); assert.equal(u.calls.length, count);
  u.state.cli.eventsApi = 2; u.cliChange(); assert.equal(u.one('.events-load').disabled, false); assert.equal(u.calls.length, count);
});
test('connection replacement clears retained evidence and never auto-loads against the new server', async t => {
  const u = setup(t); await u.controller.read(); assert.equal(u.one('.events-details').hidden, false);
  const gate = deferred(); u.setRead(() => gate.promise); const pending = u.controller.read();
  u.connectionChange(); gate.resolve(view()); await pending;
  assert.equal(u.one('.events-details').hidden, true); assert.equal(u.summary.textContent, 'Activity: unknown · Waiting on you: unknown');
  assert.equal(u.calls.length, 2); assert.match(u.one('.events-status').textContent, /Connection changed/);
});
test('incomplete empty evidence remains incomplete, not healthy empty/not-waiting', async t => {
  const empty = data([]); empty.integrity.sources[0] = { path: 'home', status: 'refused', bytes: 0 };
  empty.integrity.sources[1] = { path: 'workspace', status: 'absent', bytes: 0 };
  const u = setup(t, async () => view(empty)); await u.controller.read();
  assert.match(u.one('.events-integrity').textContent, /Incomplete evidence.*source refused/);
  assert.match(u.host.textContent, /No recorded lifecycle events in this observed window/);
  assert.match(u.summary.textContent, /Waiting on you: unknown/);
});
test('history/claims are plain attributed facts; old-incarnation retirement never changes current runtime', async t => {
  const history = data([event({ incarnation: '2025-01-01T00:00:00.000Z', kind: 'retired', data: { workRecovery: '/not-a-file-authority' } }), event({ incarnation: null, data: { reason: '<img src=x onerror=PRIVATE>' } }), event()]);
  history.waitingClaims = [{ producer: 'provider.a', waiting: false, since: birth, reason: null }, { producer: 'provider.b', waiting: true, since: birth, reason: 'Review requested' }];
  history.waitingOnYou = { producer: 'provider.b', since: birth, reason: 'Review requested' };
  const u = setup(t, async () => view(history)); await u.controller.read();
  assert.match(u.host.textContent, /Earlier instance at this address/); assert.match(u.host.textContent, /Incarnation not reported/);
  assert.match(u.host.textContent, /provider.a: claim cleared/); assert.match(u.summary.textContent, /Reported waiting: provider.b/);
  assert.match(u.host.textContent, /<img src=x onerror=PRIVATE>/); assert.equal(u.one('img'), null); assert.equal(u.one('a'), null);
});
test('remote and unqualified selections remain observation-only; no CLI read or local fallback', async t => {
  const u = setup(t); u.state.target.selector.server = 'remote'; u.controller.sync(); await u.controller.read(); assert.equal(u.calls.length, 0);
  u.state.target = { ...target, home: '', selector: target.selector }; u.controller.sync(); await u.controller.read(); assert.equal(u.calls.length, 0);
});
test('foreign workspace/root/home/birth replies cannot render or become provenance links', async t => {
  for (const mutate of [v => v.target.workspace = 'other', v => v.target.selector.agentsRoot = '/other', v => v.target.home = '/other/dev-a', v => v.target.incarnation = null]) {
    const bad = view(); mutate(bad); const u = setup(t, async () => bad); await u.controller.read();
    assert.equal(u.one('.events-details').hidden, true); assert.match(u.one('.events-status').textContent, /invalid or mismatched/);
  }
});
function luminance(hex) {
  assert.match(hex, /^#[0-9a-f]{6}$/i);
  return hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((s, v, n) => s + v * [.2126, .7152, .0722][n], 0);
}
for (const theme of ['light', 'solarized', 'dark']) test(`${theme}: actual event text and controls use computed AA without text opacity`, async t => {
  const value = data(); value.integrity.unreadableRows = 1;
  const u = setup(t, async () => view(value));
  u.doc.documentElement.dataset.theme = theme;
  const style = u.doc.createElement('style'); style.textContent = readFileSync(new URL('../renderer/theme.css', import.meta.url), 'utf8') + '\n.pop { background:var(--surface); }\n' + instanceEventsCSS; u.doc.head.append(style);
  await u.controller.read(); u.one('.events-details').open = true;
  const palette = u.dom.window.getComputedStyle(u.doc.documentElement);
  for (const [selector, foreground, surface] of [['.events-view h3', 'fg', 'surface'], ['.events-status', 'muted', 'surface'], ['.events-source', 'muted', 'surface'],
    ['.events-integrity', 'warn', 'surface'], ['.events-rows time', 'muted', 'surface'], ['.events-facts dt', 'muted', 'surface'], ['.events-load', 'fg', 'surface']]) {
    const el = u.one(selector); assert.ok(el, selector);
    assert.equal(u.dom.window.getComputedStyle(el).color, `var(--${foreground})`, selector);
    const a = luminance(palette.getPropertyValue(`--${foreground}`).trim()), b = luminance(palette.getPropertyValue(`--${surface}`).trim());
    assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, selector);
    for (let p = el; p; p = p.parentElement) assert.equal(u.dom.window.getComputedStyle(p).opacity, '1');
  }
  u.state.cli.eventsApi = 1; u.cliChange();
  assert.equal(u.dom.window.getComputedStyle(u.one('.events-load')).color, 'var(--faint)');
  assert.equal(u.dom.window.getComputedStyle(u.one('.events-load')).background, 'var(--surface-2)');
  const a = luminance(palette.getPropertyValue('--faint').trim()), b = luminance(palette.getPropertyValue('--surface-2').trim());
  assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5);
});
