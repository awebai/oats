import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createDeploymentInventory, inventoryCSS } from '../renderer/deployment-inventory.mjs';
import { currentWorkspace, setWorkspace } from '../renderer/views/common.mjs';
import { createInventoryBoundary } from '../server/capabilities.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const CLI = { ok: true, bin: '/fixture/oats', version: '0.24.6' }; // list needs no operationsApi
const data = (context = '/team') => ({ inventoryApi: 1, scope: { kind: 'classic', context },
  packages: [{ package: 'fixture.pkg', level: context, version: '1.2.3', locked: true, source: 'git:https://example.invalid/fixture.git#pinned-ref', path: 'payload', commit: 'reported-commit', integrity: 'reported-package-integrity', dependencies: [], capabilities: ['fixture.cap'] }],
  capabilities: [{ capability: 'fixture.cap', package: 'fixture.pkg', level: context, version: '2.0.0', installed: true, trusted: false, status: 'untrusted',
    path: 'capability', dir: '/artifact/fixture.cap', integrity: 'recorded', installedIntegrity: 'observed', layer: 'knowledge', code: 'untrusted-surface', detail: 'Explicit executable approval required',
    executableSurface: { commands: ['inspect'], hooks: ['before-start'], environment: ['FIXTURE_NAME'] } }],
  legacy: [],
});
function setup(t, { api = () => data(), create = createDeploymentInventory } = {}) {
  const dom = new JSDOM('<body><main><p id="inspection">Inspection is independent.</p></main></body>');
  const doc = dom.window.document, host = doc.querySelector('main'), previous = currentWorkspace(), calls = [];
  setWorkspace('/team');
  const view = create(host, { ctx: { api: (path, options) => { calls.push({ path, method: options.method, body: JSON.parse(options.body) }); return api(path, options); } } });
  t.after(() => { view.dispose(); setWorkspace(previous); dom.window.close(); });
  return { view, doc, host, calls, dom,
    update: (fields = {}) => view.update({ active: true, identity: 'A', cli: CLI, workspace: { id: '/team', scope: '/team' }, context: '/team', selector: {}, ...fields }),
    one: selector => host.querySelector(selector), all: selector => [...host.querySelectorAll(selector)], text: () => host.textContent,
    status: () => host.querySelector('.inventory-status').textContent,
  };
}
function assertReadOnly(u) {
  assert.ok(u.calls.every(c => c.path.startsWith('/api/capabilities?ws=') && c.method === 'POST' && c.body.action === 'list'));
  assert.equal(u.one('#inspection').textContent, 'Inspection is independent.');
  assert.equal(u.one('a, img, script, iframe, input, textarea, form'), null);
}

test('scoped list facts remain separate from activation, readiness, signature and catalog identity', async t => {
  const u = setup(t); assert.equal(u.calls.length, 0); await u.update();
  assert.deepEqual(u.calls, [{ path: '/api/capabilities?ws=%2Fteam', method: 'POST', body: { action: 'list', selector: {} } }]);
  assert.equal(u.status(), ''); assert.match(u.text(), /Classic read context: \/team/);
  assert.match(u.text(), /Installation: Installed/); assert.match(u.text(), /Executable approval: Not approved/);
  assert.match(u.text(), /Health: untrusted/); assert.match(u.text(), /Readiness: Unknown/);
  assert.match(u.text(), /Recorded integrityrecorded/); assert.match(u.text(), /Installed integrityobserved/);
  assert.match(u.text(), /Verified signatureUnknown/); assert.match(u.text(), /Enforced policyUnknown/);
  assert.match(u.text(), /Provider configurationUnknown/); assert.match(u.text(), /EnrolmentUnknown/);
  assert.match(u.text(), /Reported capability exports: fixture.cap/);
  assert.match(u.text(), /Declared commandsinspect/); assert.match(u.text(), /Declared hooksbefore-start/);
  assert.match(u.text(), /Declared environment namesFIXTURE_NAME/);
  assert.doesNotMatch(u.text(), /Ready|Signed by|Activation: Enabled|Installed: pass/);
  assertReadOnly(u);
});

test('same-named exports at different acquisition scopes are separate, never joined to inner activation', async t => {
  const value = data(); value.capabilities.push({ ...value.capabilities[0], level: '/team/member', trusted: true, installed: false, status: 'missing' });
  value.packages.push({ ...value.packages[0], level: '/team/member', version: 'other', trusted: true });
  const u = setup(t, { api: () => value }); await u.update();
  const rows = u.all('.inventory-capabilities tbody tr'); assert.equal(rows.length, 2);
  assert.match(rows[0].textContent, /Scope: \/teamVersion|Scope: \/team/);
  assert.match(rows[0].textContent, /Not approved/);
  assert.match(rows[1].textContent, /Scope: \/team\/member/);
  assert.match(rows[1].textContent, /Installation: Not installed/); assert.match(rows[1].textContent, /Executable approval: Approved/);
  assert.match(rows[1].textContent, /Health: missing/);
  assert.equal(u.all('.inventory-packages tbody tr').length, 2);
  assert.doesNotMatch(u.one('.inventory-packages').textContent, /Approved|Trusted/);
});

test('absent and malformed optional facts never become false, pass, no dependencies or no exports', async t => {
  const value = { ...data(), packages: [{ package: 'unknown', capabilities: null, dependencies: {}, locked: 'true' }], capabilities: [{ capability: 'unknown', installed: 'true', trusted: null, executableSurface: { environment: { SECRET: 'not-display-data' } }, settings: { secret: 'not-display-data' } }] };
  const u = setup(t, { api: () => value }); await u.update();
  assert.match(u.text(), /Installation: Not reported/); assert.match(u.text(), /Executable approval: Not reported/);
  assert.match(u.text(), /Locked: Not reported/); assert.match(u.text(), /Reported capability exports: Not reported/);
  assert.match(u.text(), /DependenciesNot reported/); assert.match(u.text(), /Declared environment namesNot reported/);
  assert.doesNotMatch(u.text(), /not-display-data|Installation: Not installed|None reported/);
});

test('hostile strings are inert, and legacy lock rows never become installation or migration actions', async t => {
  const hostile = `x\"><img src=x onerror=evil()>[data-x='bad']`;
  const value = data(); Object.assign(value.capabilities[0], { capability: hostile, level: hostile, detail: hostile });
  Object.assign(value.packages[0], { package: hostile, source: 'javascript:evil()', commit: hostile });
  value.legacy.push({ file: hostile, level: '/legacy', lockfileVersion: 1, capabilities: ['legacy.cap'] });
  const u = setup(t, { api: () => value }); await u.update();
  assert.ok(u.all('strong').every(el => el.textContent === hostile)); assert.match(u.text(), /javascript:evil/);
  assert.match(u.text(), /Legacy lock reports/); assert.match(u.text(), /nothing is migrated here/);
  u.view.setQuery(hostile); assert.equal(u.all('.inventory-capabilities tbody tr strong').length, 1);
  assertReadOnly(u);
});

test('local filter and no-op polls do not refetch, close disclosures or displace focus', async t => {
  const u = setup(t); await u.update();
  const details = u.one('.inventory-table details'), summary = details.querySelector('summary'); details.open = true; summary.focus();
  for (let n = 0; n < 8; n++) await u.update();
  assert.equal(u.calls.length, 1); assert.equal(u.one('.inventory-table details'), details); assert.equal(details.open, true); assert.equal(u.doc.activeElement, summary);
  u.view.setQuery('no such item'); assert.match(u.one('.inventory-capabilities').textContent, /Nothing matches/);
  u.view.setQuery(''); assert.equal(u.calls.length, 1);
  await u.update({ active: false }); await u.view.refresh(); assert.equal(u.calls.length, 1);
  await u.update(); assert.equal(u.calls.length, 1);
});

for (const [name, fields, expected] of [
  ['remote', { workspace: { remote: true, scope: '/team', server: 'host' } }, /remote workspaces; no local substitution/],
  ['server-only', { workspace: { scope: '/team', server: 'host' } }, /remote workspaces/],
  ['home', { selector: { home: '/home' } }, /not a soul, home or captured resolution/],
  ['resolution', { selector: { resolution: '/R' } }, /not a soul, home or captured resolution/],
  ['soul', { selector: { soul: 'name', agentsRoot: '/agents' } }, /not a soul, home or captured resolution/],
  ['no CLI', { cli: { ok: false } }, /compatible installed OATS CLI/],
  ['unknown scope', { context: undefined }, /Waiting for/],
]) test(`${name} is unavailable without dispatch or local fallback`, async t => {
  const u = setup(t, { api: assert.fail }); await u.update(fields); await u.view.refresh();
  assert.equal(u.calls.length, 0); assert.match(u.status(), expected); assert.equal(u.one('.inventory-refresh').disabled, true);
});

for (const [name, api, expected] of [
  ['lock-v3 refusal', () => { throw Object.assign(new Error('CLI refused lock'), { code: 'invalid-lock' }); }, /invalid-lock/],
  ['transport failure', () => Promise.reject(new Error('offline')), /offline/],
  ['bad envelope', () => ({}), /Invalid or mismatched/],
  ['captured result', () => ({ ...data(), scope: { kind: 'captured', context: '/team' } }), /Invalid or mismatched/],
  ['foreign context', () => data('/foreign'), /Invalid or mismatched/],
  ['null capabilities', () => ({ ...data(), capabilities: [null] }), /Invalid or mismatched/],
]) test(`${name} is not successful empty inventory; retry can recover`, async t => {
  let read = api; const u = setup(t, { api: () => read() }); await u.update();
  assert.match(u.status(), expected); assert.equal(u.one('table'), null); assert.equal(u.one('.inventory-refresh').disabled, false);
  await u.update(); assert.equal(u.calls.length, 1, 'polls do not automatically retry errors');
  read = () => data(); await u.view.refresh(); assert.equal(u.status(), ''); assert.ok(u.one('table')); assertReadOnly(u);
});

for (const outcome of ['success', 'rejection']) for (const boundary of ['scope', 'A-B-A', 'global-workspace', 'dispose']) test(`old ${outcome} cannot paint after ${boundary}`, async t => {
  const requests = []; const u = setup(t, { api: () => { const d = deferred(); requests.push(d); return d.promise; } });
  void u.update();
  if (boundary === 'dispose') u.view.dispose();
  else if (boundary === 'global-workspace') { setWorkspace('/other'); setWorkspace('/team'); }
  else {
    void u.update({ identity: 'B', context: '/team/b', selector: { context: '/team/b' } });
    if (boundary === 'A-B-A') void u.update({ identity: 'A-again' });
    requests.at(-1).reject(new Error('newest failure')); await tick();
  }
  const before = u.host.innerHTML;
  for (const d of requests.slice(0, boundary === 'scope' || boundary === 'A-B-A' ? -1 : undefined)) {
    if (outcome === 'success') d.resolve(data()); else d.reject(new Error('stale failure'));
  }
  await tick(); assert.equal(u.host.innerHTML, before);
});

test('real list boundary coalesces old reads; late shared success cannot clear newer failure', async t => {
  const first = deferred(), delivery = deferred(); let commands = 0, requests = 0;
  const read = createInventoryBoundary({ invoke: async () => { commands++; return commands === 1 ? first.promise : { schemaVersion: 1, ok: false, error: { code: 'invalid-lock' } }; } });
  const u = setup(t, { api: async (_path, opts) => {
    const n = ++requests;
    const result = await read(JSON.parse(opts.body), { workspace: { scope: '/team' }, cli: CLI });
    if (n <= 2) await delivery.promise;
    return result;
  } });
  const old = [u.update(), u.view.refresh()]; await tick(); assert.equal(commands, 1);
  const { packages, capabilities, legacy } = data(); first.resolve({ schemaVersion: 1, ok: true, result: { packages, capabilities, legacy } }); await tick();
  await u.view.refresh(); assert.equal(commands, 2); assert.match(u.status(), /invalid-lock/);
  const before = u.host.innerHTML; delivery.resolve(); await Promise.all(old);
  assert.equal(u.host.innerHTML, before); assert.equal(u.one('table'), null); assertReadOnly(u);
});

async function mutatedCreate(oldText, newText) {
  let source = readFileSync(new URL('../renderer/deployment-inventory.mjs', import.meta.url), 'utf8'); assert.ok(source.includes(oldText));
  source = source.replace(oldText, newText)
    .replace("'./views/common.mjs'", JSON.stringify(new URL('../renderer/views/common.mjs', import.meta.url).href))
    .replace("'./identity-marks.mjs'", JSON.stringify(new URL('../renderer/identity-marks.mjs', import.meta.url).href));
  return (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).createDeploymentInventory;
}
for (const outcome of ['success', 'rejection']) test(`${outcome} race pin detects removal of inventory generation ownership`, async t => {
  const create = await mutatedCreate('alive && serial === ticket && workspaceGeneration() === gen', 'alive');
  const requests = [], u = setup(t, { create, api: () => { const d = deferred(); requests.push(d); return d.promise; } });
  void u.update(); void u.update({ identity: 'B' }); requests[1].reject(new Error('newest failure')); await tick();
  if (outcome === 'success') requests[0].resolve(data()); else requests[0].reject(new Error('old failure'));
  await tick(); assert.throws(() => assert.match(u.status(), /newest failure/));
});

test('inventory CSS uses semantic colors, accessible controls and 56px minimum rows', async t => {
  assert.doesNotMatch(inventoryCSS, /#[0-9a-f]{3,8}\b|rgba?\(|opacity\s*:|url\(/iu);
  assert.match(inventoryCSS, /height:56px/);
  const u = setup(t); await u.update();
  assert.equal(u.one('section').getAttribute('aria-label'), 'Classic deployment inventory');
  assert.equal(u.one('.inventory-status').getAttribute('role'), 'status');
  assert.ok(u.all('th').every(th => th.scope === 'col')); assert.ok(u.all('table').every(table => table.caption));
});
