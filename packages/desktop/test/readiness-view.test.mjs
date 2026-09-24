import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createReadinessView } from '../renderer/readiness-view.mjs';
import { createSoulInspector } from '../renderer/soul-inspector.mjs';
import { currentWorkspace, setWorkspace } from '../renderer/views/common.mjs';
import { refreshCli, resetCliStateForTests } from '../renderer/views/cli-status.mjs';
import { VERIFY_UNAVAILABLE, ENROL_UNAVAILABLE, readinessFailure } from '../renderer/readiness-contract.mjs';
import { cli, workspace, selector, target, data, view, deferred, tick } from './helpers/readiness-fixture.mjs';
function setup(t, api = () => view()) {
  const dom = new JSDOM('<!doctype html><body><button id="other">Other</button><main></main>', { pretendToBeVisual: true }), doc = dom.window.document, host = doc.querySelector('main');
  const previous = currentWorkspace(); setWorkspace('team'); const calls = [];
  const component = createReadinessView(host, { ctx: { api: (path, opts) => { const body = JSON.parse(opts.body); calls.push({ path, method: opts.method, body }); return api(path, opts); } } });
  t.after(() => { component.dispose(); setWorkspace(previous); dom.window.close(); });
  return { dom, doc, host, component, calls, update: fields => component.update({ active: true, workspace, selector, cli, ...fields }),
    one: s => host.querySelector(s), text: () => host.textContent };
}
test('quartet/policy use real facts; unavailable network and enrollment never dispatch', async t => {
  const u = setup(t); await u.update();
  assert.equal(u.calls.length, 1); assert.deepEqual(u.calls[0], { path: '/api/workspace-readiness?ws=team', method: 'POST', body: { action: 'read', selector } });
  assert.match(u.text(), /1 unknown/); assert.match(u.text(), /not-applicable/); assert.match(u.text(), /advisory, not enforced/); assert.match(u.text(), /not an OS sandbox/);
  assert.ok(u.text().includes(VERIFY_UNAVAILABLE)); assert.ok(u.text().includes(ENROL_UNAVAILABLE));
  assert.equal(u.one('.readiness-verify').disabled, true); assert.equal(u.one('.readiness-enrol').disabled, true);
  u.one('.readiness-verify').click(); u.one('.readiness-enrol').dispatchEvent(new u.dom.window.Event('click'));
  const policy = u.one('.readiness-policy'); policy.open = true; policy.querySelector('summary').focus();
  for (let n = 0; n < 5; n++) await u.update();
  assert.equal(u.one('.readiness-policy'), policy); assert.equal(policy.open, true); assert.equal(u.doc.activeElement, policy.querySelector('summary')); assert.equal(u.calls.length, 1);
  assert.equal(u.one('.readiness-skip'), null, 'the Workspace readiness frame (and its Skip) is gone');
});
for (const [name, fields] of [['remote', { workspace: { ...workspace, remote: true } }], ['missing CLI', { cli: null }], ['missing feature', { cli: { ...cli, features: [] } }], ['wrong API', { cli: { ...cli, readinessApi: '1' } }]]) test(`${name} has reachable read-only explanation but no request`, async t => {
  const u = setup(t, assert.fail); await u.update(fields); assert.equal(u.calls.length, 0); assert.equal(u.one('.readiness-refresh').disabled, true); assert.equal(u.one('.readiness-view').hidden, false);
});
for (const rejection of [false, true]) for (const change of ['scope', 'A-B-A', 'global-generation', 'CLI', 'dispose', 'hide']) test(`newest intent owns stale ${rejection ? 'rejection' : 'success'} after ${change}`, async t => {
  const pending = []; const u = setup(t, () => { const d = deferred(); pending.push(d); return d.promise; });
  void u.update();
  if (change === 'dispose') u.component.dispose();
  else if (change === 'hide') await u.update({ active: false });
  else if (change === 'global-generation') { setWorkspace('other'); setWorkspace('team'); }
  else {
    void u.update(change === 'CLI' ? { cli: { ...cli, bin: '/new/oats' } } : { selector: { kind: 'scope', context: '/team/b' } });
    if (change === 'A-B-A') void u.update();
    pending.at(-1).resolve(readinessFailure('E_CONFIG_BROKEN')); await tick();
  }
  const before = u.host.innerHTML, focus = u.doc.activeElement;
  for (const d of pending.slice(0, ['scope', 'A-B-A', 'CLI'].includes(change) ? -1 : undefined)) {
    if (rejection) d.reject(Error('PRIVATE stale')); else d.resolve(view());
  }
  await tick(); assert.equal(u.host.innerHTML, before); assert.equal(u.doc.activeElement, focus);
});
test('overlapping Refresh within one mounted owner guards both result and busy cleanup', async t => {
  const older = deferred(), newer = deferred(); let n = 0; const u = setup(t, () => ++n === 1 ? older.promise : newer.promise);
  void u.update(); void u.component.refresh(); newer.resolve(readinessFailure('invalid-lock')); await tick();
  const before = u.host.innerHTML; older.resolve(view()); await tick(); assert.equal(u.host.innerHTML, before); assert.match(u.text(), /invalid lock/); assert.equal(u.one('.readiness-refresh').disabled, false);
});
test('malformed or wrong qualified target never paints Ready; explicit retry recovers', async t => {
  let result = view(); result.data.summary.ready = true; const u = setup(t, () => result); await u.update();
  assert.match(u.text(), /invalid or contradictory/); assert.doesNotMatch(u.one('.readiness-status').textContent, /^Ready/);
  result = view({ ...target, selector: { kind: 'scope', context: '/other' } }); await u.component.refresh(); assert.match(u.text(), /invalid or contradictory/);
  result = view(); await u.component.refresh(); assert.match(u.text(), /1 unknown/); assert.equal(u.calls.length, 3);
});
test('named verified signatures only; hostile evidence/remedies are inert and raw reasons stay withheld', async t => {
  const d = data(); const hostile = '<img src=x onerror=evil()>[x]';
  d.checks.installed.items[0].subject = hostile; d.checks.installed.items[0].remedy = hostile;
  d.checks.trusted.items[0].signature = { status: 'verified', signer: { id: 'key', label: 'Named signer' }, reason: 'PRIVATE raw stderr', trust: 'untrusted-key' };
  const u = setup(t, () => view(target, d)); await u.update(); assert.match(u.text(), /Signed by Named signer/); assert.match(u.text(), /key is not trusted/);
  assert.equal(u.one('img,script,a,input,textarea,form'), null); assert.ok(u.text().includes(hostile)); assert.doesNotMatch(u.text(), /PRIVATE/);
  d.checks.trusted.items[0].signature.status = 'unknown'; await u.component.refresh(); assert.doesNotMatch(u.text(), /Signed by/);
});
test('hidden pending view re-entry reads again; detached disposed controls cannot retry', async t => {
  const gate = deferred(); let n = 0; const u = setup(t, () => ++n === 1 ? gate.promise : view()); void u.update();
  await u.update({ active: false }); await u.update(); gate.resolve(view()); await tick(); assert.equal(n, 2);
  const refresh = u.one('.readiness-refresh'); u.component.dispose(); refresh.click(); await tick();
  assert.equal(n, 2);
});
test('hidden host controls cannot refresh or steal focus; future verification feature does not enable this slice', async t => {
  const u = setup(t); await u.update({ cli: { ...cli, features: ['readiness', 'readiness-verify'] } });
  assert.equal(u.one('.readiness-verify').disabled, true);
  u.host.hidden = true; u.doc.querySelector('#other').focus();
  u.one('.readiness-refresh').click(); await tick();
  assert.equal(u.calls.length, 1); assert.equal(u.doc.activeElement.id, 'other');
});

test('inspector owns exact soul and home selectors, independent of operations inspection and disposal', async t => {
  const dom = new JSDOM('<!doctype html><body><aside></aside>'), doc = dom.window.document, previous = currentWorkspace(); setWorkspace('team'); resetCliStateForTests();
  const calls = [], gates = []; const ctx = { api: async (path, opts) => {
    if (path === '/api/cli') return cli;
    const body = JSON.parse(opts.body); calls.push(body); const gate = deferred(); gates.push(gate); return gate.promise;
  } };
  await refreshCli(ctx);
  const inspector = createSoulInspector(doc.querySelector('aside'), { ctx, workspace: () => workspace, available: () => false });
  t.after(() => { inspector.dispose(); resetCliStateForTests(); setWorkspace(previous); dom.window.close(); });
  const agent = { name: 'dev', agentsRoot: '/team/agents' };
  await inspector.show({ agent, selector: { soul: 'dev', agentsRoot: agent.agentsRoot } });
  assert.deepEqual(calls[0], { action: 'read', selector: { kind: 'soul', soul: 'dev', agentsRoot: '/team/agents' } });
  const home = { instance: 'dev-1', agent: 'dev', agentsRoot: '/team/agents', home: '/team/agents/dev/instances/dev-1' };
  await inspector.show({ instance: home, selector: { home: home.home } });
  assert.deepEqual(calls[1].selector, { kind: 'instance', instance: 'dev-1', agent: 'dev', agentsRoot: '/team/agents', server: null });
  const before = doc.body.innerHTML; gates[0].resolve(view()); await tick(); assert.equal(doc.body.innerHTML, before);
  inspector.dispose(); gates[1].reject(Error('PRIVATE')); await tick(); assert.equal(doc.querySelector('.readiness-view'), null);
});
