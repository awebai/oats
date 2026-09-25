import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createReadinessView } from '../renderer/readiness-view.mjs';
import { createSoulInspector } from '../renderer/soul-inspector.mjs';
import { currentWorkspace, setWorkspace } from '../renderer/views/common.mjs';
import { refreshCli, resetCliStateForTests } from '../renderer/views/cli-status.mjs';
import { readinessFailure } from '../renderer/readiness-contract.mjs';
import { cli, workspace, selector, target, instanceTarget, data, view, deferred, tick } from './helpers/readiness-fixture.mjs';
function setup(t, api = () => view()) {
  const dom = new JSDOM('<!doctype html><body><button id="other">Other</button><main></main>', { pretendToBeVisual: true }), doc = dom.window.document, host = doc.querySelector('main');
  const previous = currentWorkspace(); setWorkspace('team'); const calls = [];
  const component = createReadinessView(host, { ctx: { api: (path, opts) => { const body = JSON.parse(opts.body); calls.push({ path, method: opts.method, body }); return api(path, opts); } } });
  t.after(() => { component.dispose(); setWorkspace(previous); dom.window.close(); });
  return { dom, doc, host, component, calls, update: fields => component.update({ active: true, workspace, selector, cli, ...fields }),
    one: s => host.querySelector(s), text: () => host.textContent };
}
test('the four kernel checks and policy use real facts; no signature or enrolment control exists', async t => {
  const u = setup(t); await u.update();
  assert.equal(u.calls.length, 1); assert.deepEqual(u.calls[0], { path: '/api/workspace-readiness?ws=team', method: 'POST', body: { action: 'read', selector } });
  assert.match(u.text(), /1 failing · 0 unknown · 7 required checks/); assert.match(u.text(), /not-applicable/); assert.match(u.text(), /advisory, not enforced/); assert.match(u.text(), /not an OS sandbox/);
  for (const check of ['Installed', 'Configured', 'Member', 'Providers']) assert.ok([...u.host.querySelectorAll('.readiness-check h3')].some(h => h.textContent === check), check);
  // The captured provider answer (oats.okf without state-dir), verbatim; its reason is said once.
  const provider = [...u.host.querySelectorAll('.readiness-check')].find(c => c.querySelector('h3').textContent === 'Providers');
  assert.equal(provider.querySelector('.readiness-item summary').textContent, 'oats.okf · fail · required');
  assert.match(provider.textContent, /The provider says: needs configuration\./);
  assert.equal(provider.textContent.split('setting state-dir is required (absolute host path)').length, 2, 'the reason is said once');
  assert.match(provider.textContent, /Problem code\s*needs-configuration/);
  assert.equal(u.one('.readiness-verify'), null); assert.equal(u.one('.readiness-enrol'), null);
  assert.doesNotMatch(u.text(), /signature|Trusted|Enrol/i);
  const policy = u.one('.readiness-policy'); policy.open = true; policy.querySelector('summary').focus();
  for (let n = 0; n < 5; n++) await u.update();
  assert.equal(u.one('.readiness-policy'), policy); assert.equal(policy.open, true); assert.equal(u.doc.activeElement, policy.querySelector('summary')); assert.equal(u.calls.length, 1);
  assert.equal(u.one('.readiness-skip'), null, 'the Workspace readiness frame (and its Skip) is gone');
});
for (const [name, fields] of [['remote', { workspace: { ...workspace, remote: true } }], ['missing CLI', { cli: null }], ['API 1 (0.25)', { cli: { ...cli, readinessApi: 1 } }], ['wrong API', { cli: { ...cli, readinessApi: '2' } }]]) test(`${name} has reachable read-only explanation but no request`, async t => {
  const u = setup(t, assert.fail); await u.update(fields); assert.equal(u.calls.length, 0); assert.equal(u.one('.readiness-refresh').disabled, true); assert.equal(u.one('.readiness-view').hidden, false);
});
for (const rejection of [false, true]) for (const change of ['selection', 'A-B-A', 'global-generation', 'CLI', 'dispose', 'hide']) test(`newest intent owns stale ${rejection ? 'rejection' : 'success'} after ${change}`, async t => {
  const pending = []; const u = setup(t, () => { const d = deferred(); pending.push(d); return d.promise; });
  void u.update();
  if (change === 'dispose') u.component.dispose();
  else if (change === 'hide') await u.update({ active: false });
  else if (change === 'global-generation') { setWorkspace('other'); setWorkspace('team'); }
  else {
    void u.update(change === 'CLI' ? { cli: { ...cli, bin: '/new/oats' } } : { selector: { kind: 'soul', soul: 'other', agentsRoot: '/team/agents' } });
    if (change === 'A-B-A') void u.update();
    pending.at(-1).resolve(readinessFailure('E_CLI_FAILED')); await tick();
  }
  const before = u.host.innerHTML, focus = u.doc.activeElement;
  for (const d of pending.slice(0, ['selection', 'A-B-A', 'CLI'].includes(change) ? -1 : undefined)) {
    if (rejection) d.reject(Error('PRIVATE stale')); else d.resolve(view());
  }
  await tick(); assert.equal(u.host.innerHTML, before); assert.equal(u.doc.activeElement, focus);
});
test('overlapping Refresh within one mounted owner guards both result and busy cleanup', async t => {
  const older = deferred(), newer = deferred(); let n = 0; const u = setup(t, () => ++n === 1 ? older.promise : newer.promise);
  void u.update(); void u.component.refresh(); newer.resolve(readinessFailure('E_CLI_TIMEOUT')); await tick();
  const before = u.host.innerHTML; older.resolve(view()); await tick(); assert.equal(u.host.innerHTML, before); assert.match(u.text(), /timed out/); assert.equal(u.one('.readiness-refresh').disabled, false);
});
test('malformed or wrong qualified target never paints Ready; explicit retry recovers', async t => {
  let result = view(); result.data.summary.ready = true; const u = setup(t, () => result); await u.update();
  assert.match(u.text(), /invalid or contradictory/); assert.doesNotMatch(u.one('.readiness-status').textContent, /^Ready/);
  result = view({ ...target, selector: { kind: 'soul', soul: 'other', agentsRoot: '/team/agents' } }); await u.component.refresh(); assert.match(u.text(), /invalid or contradictory/);
  result = view(); await u.component.refresh(); assert.match(u.text(), /1 failing/); assert.equal(u.calls.length, 3);
});
test('hostile evidence, remedies and provider problems are inert text', async t => {
  const d = data(); const hostile = '<img src=x onerror=evil()>[x]';
  d.checks.installed.items[0].subject = hostile; d.checks.installed.items[0].remedy = hostile;
  d.checks.providers.items[0].problems = [{ code: 'provider-unavailable', message: hostile }];
  const u = setup(t, () => view(target, d)); await u.update();
  assert.equal(u.one('img,script,a,input,textarea,form'), null); assert.ok(u.text().includes(hostile));
});
test('hidden pending view re-entry reads again; detached disposed controls cannot retry', async t => {
  const gate = deferred(); let n = 0; const u = setup(t, () => ++n === 1 ? gate.promise : view()); void u.update();
  await u.update({ active: false }); await u.update(); gate.resolve(view()); await tick(); assert.equal(n, 2);
  const refresh = u.one('.readiness-refresh'); u.component.dispose(); refresh.click(); await tick();
  assert.equal(n, 2);
});
test('hidden host controls cannot refresh or steal focus', async t => {
  const u = setup(t); await u.update();
  u.host.hidden = true; u.doc.querySelector('#other').focus();
  u.one('.readiness-refresh').click(); await tick();
  assert.equal(u.calls.length, 1); assert.equal(u.doc.activeElement.id, 'other');
});

test('inspector: a soul shows no readiness (F7); a home reads its exact instance selector, and a replaced home cannot repaint', async t => {
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
  assert.equal(calls.length, 0, 'no readiness read for a soul'); assert.equal(doc.querySelector('.readiness-view'), null);
  const home = { instance: 'dev-1', agent: 'dev', agentsRoot: '/team/agents', home: '/team/agents/dev/instances/dev-1' };
  await inspector.show({ instance: home, selector: { home: home.home } });
  assert.deepEqual(calls[0], { action: 'read', selector: { kind: 'instance', instance: 'dev-1', agent: 'dev', agentsRoot: '/team/agents', server: null } });
  const other = { ...home, instance: 'dev-2', home: '/team/agents/dev/instances/dev-2' };
  await inspector.show({ instance: other, selector: { home: other.home } });
  assert.deepEqual(calls[1].selector, { kind: 'instance', instance: 'dev-2', agent: 'dev', agentsRoot: '/team/agents', server: null });
  const before = doc.body.innerHTML; gates[0].resolve(view()); await tick(); assert.equal(doc.body.innerHTML, before, 'the replaced home cannot repaint');
  inspector.dispose(); gates[1].reject(Error('PRIVATE')); await tick(); assert.equal(doc.querySelector('.readiness-view'), null);
});

test('the Workspace panel shape ({id, name}, no scope) is enough to read: the server admits the workspace', async t => {
  const u = setup(t); await u.update({ workspace: { id: 'team', name: 'team', team: null } });
  assert.equal(u.calls.length, 1); assert.deepEqual(u.calls[0].body, { action: 'read', selector });
  assert.doesNotMatch(u.text(), /Waiting for a qualified workspace selection/);
});

test('a passing provider item shows its warnings as reported, counted on its line, never in the summary', async t => {
  const raw = data(), provider = raw.checks.providers.items[0];
  const warning = { code: 'e2ee-disabled', message: '<img src=x onerror=alert(1)> end-to-end encryption is disabled' };
  Object.assign(provider, { status: 'pass', reason: null, result: { status: 'ready', problems: [], warnings: [warning] }, problems: [] }); raw.checks.providers.status = 'pass';
  raw.summary = { ...raw.summary, ready: true, pass: raw.summary.required, fail: 0, unknown: 0 };
  const u = setup(t, () => view(target, raw)); await u.update();
  const item = [...u.host.querySelectorAll('.readiness-check')].find(c => c.querySelector('h3').textContent === 'Providers').querySelector('details');
  assert.equal(item.querySelector('summary').textContent, 'oats.okf · pass · required · 1 warning');
  assert.equal(item.querySelector('.readiness-warning').textContent, `Warning: ${warning.message} (e2ee-disabled)`);
  assert.equal(u.host.querySelector('img'), null, 'inert text');
  assert.match(u.text(), /Ready — every required check passes/, 'a warning does not unready the subject');
  assert.doesNotMatch(u.one('.readiness-status').textContent, /warning/i, 'warnings do not count in the summary');
});

// One provider item per answer, with the item status the kernel maps it to.
function providers(...answers) {
  const raw = data(), [base] = raw.checks.providers.items, counts = { pass: 0, fail: 0, unknown: 0 };
  raw.checks.providers.items = answers.map(([subject, status]) => {
    const itemStatus = { ready: 'pass', 'needs-configuration': 'fail', 'authorization-required': 'fail', unavailable: 'unknown' }[status]; counts[itemStatus]++;
    return { ...structuredClone(base), subject, status: itemStatus, reason: null, problems: [], result: { status, problems: [], warnings: [] } };
  });
  raw.checks.providers.status = counts.fail ? 'fail' : counts.unknown ? 'unknown' : 'pass';
  const others = Object.entries(raw.checks).filter(([k]) => k !== 'providers').flatMap(([, c]) => c.items.filter(i => i.required));
  raw.summary = { ready: false, required: others.length + answers.length, pass: others.filter(i => i.status === 'pass').length + counts.pass,
    fail: others.filter(i => i.status === 'fail').length + counts.fail, unknown: others.filter(i => i.status === 'unknown').length + counts.unknown };
  raw.summary.ready = raw.summary.fail === 0 && raw.summary.unknown === 0;
  return raw;
}
const providerCheck = u => [...u.host.querySelectorAll('.readiness-check')].find(c => c.querySelector('h3').textContent === 'Providers');
test('authorization-required is its own state — "sign in needed" — not a broken provider', async t => {
  const u = setup(t, () => view(target, providers(['oats.okf', 'ready'], ['oats.aweb', 'authorization-required']))); await u.update();
  const check = providerCheck(u), badge = check.querySelector('.readiness-badge');
  assert.equal(badge.dataset.state, 'sign-in'); assert.equal(check.querySelector('.readiness-check-head > span:last-child').textContent, 'sign in needed');
  const aweb = [...check.querySelectorAll('.readiness-item')].find(i => i.querySelector('summary').textContent.startsWith('oats.aweb'));
  assert.equal(aweb.querySelector('summary').textContent, 'oats.aweb · sign in needed · required');
  assert.match(aweb.textContent, /Sign in needed: the provider is set up but is not signed in\./);
  assert.doesNotMatch(check.textContent, /needs configuration|· fail ·/);
});
test('a check with a real failure stays failing even when another provider only needs a sign-in; unavailable is unknown', async t => {
  const u = setup(t, () => view(target, providers(['oats.okf', 'needs-configuration'], ['oats.aweb', 'authorization-required'], ['nw.tasks', 'unavailable']))); await u.update();
  const check = providerCheck(u);
  assert.equal(check.querySelector('.readiness-badge').dataset.state, 'fail'); assert.equal(check.querySelector('.readiness-check-head > span:last-child').textContent, 'fail');
  const lines = [...check.querySelectorAll('.readiness-item summary')].map(s => s.textContent);
  assert.deepEqual(lines, ['oats.okf · fail · required', 'oats.aweb · sign in needed · required', 'nw.tasks · unknown · required']);
  assert.match(check.textContent, /The provider says: needs configuration\./); assert.match(check.textContent, /The provider says: unavailable right now\./);
});

test('captured: a home spawned with the provider configured is Ready, and the provider says ready', async t => {
  const u = setup(t, () => view(instanceTarget, data(instanceTarget, 'readiness-instance-provider-pass'))); await u.update({ selector: instanceTarget.selector });
  assert.deepEqual(u.calls[0].body, { action: 'read', selector: instanceTarget.selector });
  assert.match(u.text(), /Ready — every required check passes/);
  const check = providerCheck(u); assert.equal(check.querySelector('.readiness-badge').dataset.state, 'pass');
  assert.equal(check.querySelector('.readiness-item summary').textContent, 'oats.okf · pass · required'); assert.match(check.textContent, /The provider says: ready\./);
  assert.equal(check.querySelector('.readiness-warning'), null, 'warnings: [] shows nothing');
});
test('an unrecognised provider answer is shown as sent, under the item status the kernel reported', async t => {
  const raw = providers(['oats.okf', 'ready']), provider = raw.checks.providers.items[0];
  Object.assign(provider, { status: 'unknown', result: { status: 'rate-limited', problems: [], warnings: [] } }); raw.checks.providers.status = 'unknown';
  raw.summary = { ...raw.summary, ready: false, pass: raw.summary.pass - 1, unknown: raw.summary.unknown + 1 };
  const u = setup(t, () => view(target, raw)); await u.update();
  const check = providerCheck(u);
  assert.equal(check.querySelector('.readiness-item summary').textContent, 'oats.okf · unknown · required'); assert.match(check.textContent, /The provider answered: rate-limited\./);
});
