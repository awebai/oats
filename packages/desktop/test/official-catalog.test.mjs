import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createOfficialCatalog, officialCatalogCSS } from '../renderer/official-catalog.mjs';
import { createCatalogBoundary } from '../server/catalog.mjs';
import { cliCatalog } from '../cli-adapter.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const pkg = (id = 'oats.dev', fields = {}) => ({ package: id, url: 'https://example.invalid/oats.git', ref: 'release-branch', path: 'packages/dev', acquire: { argv: ['oats', 'install', id] }, ...fields });
const alias = (capability = 'oats.review', fields = {}) => ({ capability, package: 'oats.dev', capabilityInPackage: capability, via: 'alias', available: true, ...fields });
const available = (fields = {}) => ({ catalogApi: 1, scope: 'local-cli', status: 'available', minimumVersion: '0.24.6', reason: null,
  description: { schemaVersion: 1, catalog: { origin: 'bundled', file: '/local/cli/package-catalog.json', kernelVersion: '0.24.6' }, packages: [pkg()], capabilityAliases: [alias()], notes: ['Reported trust note.', 'Reported snapshot note.'], ...fields } });
const unavailable = (code = 'catalog-unsupported', message = 'The installed CLI is older than 0.24.6.') => ({ catalogApi: 1, scope: 'local-cli', status: 'unavailable', minimumVersion: '0.24.6', description: null, reason: { code, message } });

function setup(t, { api = () => available(), copyText, create = createOfficialCatalog } = {}) {
  const dom = new JSDOM('<!doctype html><body><main><p id="deployment">Deployment facts remain visible.</p></main></body>', { url: 'http://localhost' });
  const doc = dom.window.document, host = doc.querySelector('main'), calls = [];
  const ctx = { api: (path, options) => { calls.push({ path, ...options }); return api(path, options); } };
  const view = create(host, { ctx, copyText });
  t.after(() => { view.dispose(); dom.window.close(); });
  const one = selector => host.querySelector(selector), all = selector => [...host.querySelectorAll(selector)];
  const rows = () => all('.official-catalog-table:first-of-type tbody tr');
  return { dom, doc, host, calls, view, one, all, rows,
    text: () => one('.official-catalog').textContent,
    activate: (identity = 'cli/workspace-A') => view.update({ active: true, identity }),
    commands: () => all('.official-catalog-command'),
    copyButtons: () => all('button').filter(b => b.textContent === 'Copy command'),
    status: () => one('.official-catalog-status').textContent,
    feedback: () => all('.official-catalog-copy-status').map(n => n.textContent).join('|'),
  };
}

function assertReadOnly(u) {
  assert.ok(u.calls.every(call => call.path === '/api/catalog' && call.method === 'POST' && call.body === '{}'));
  assert.ok(u.calls.every(call => call.headers['content-type'] === 'application/json'));
  assert.equal(u.one('#deployment').textContent, 'Deployment facts remain visible.');
  assert.equal(u.one('a, img, script, iframe, object, embed, form, link'), null);
  assert.equal(u.one('.discovery-table'), null, 'does not collide with deployment table selectors');
}

test('inert mount, active first read once, cached polling, inactive identity changes and local filtering', async t => {
  const u = setup(t);
  assert.equal(u.calls.length, 0); assert.equal(u.one('.official-catalog').hidden, true);
  u.view.update({ active: false, identity: 'A' }); await u.view.refresh();
  assert.equal(u.calls.length, 0);
  await u.activate('A');
  assert.equal(u.one('h2').textContent, 'Official catalog');
  assert.equal(u.calls.length, 1);
  const input = u.one('.official-catalog-filter'); input.focus(); input.value = 'release'; input.setSelectionRange(2, 5);
  input.dispatchEvent(new u.dom.window.Event('input', { bubbles: true }));
  const domBefore = u.one('.official-catalog').innerHTML;
  for (let n = 0; n < 10; n++) await u.activate('A');
  assert.equal(u.calls.length, 1); assert.equal(u.doc.activeElement, input);
  assert.equal(u.one('.official-catalog').innerHTML, domBefore);
  assert.equal(input.selectionStart, 2); assert.equal(input.selectionEnd, 5);
  u.view.update({ active: false, identity: 'A' }); await u.view.refresh();
  assert.equal(u.calls.length, 1); assert.equal(u.one('.official-catalog').hidden, true);
  await u.activate('A'); assert.equal(u.calls.length, 1);
  u.view.update({ active: false, identity: 'B' });
  assert.equal(u.calls.length, 1); assert.equal(u.commands().length, 0);
  await u.activate('B'); assert.equal(u.calls.length, 2);
  u.view.setQuery('no match'); assert.ok(u.rows().every(row => row.hidden));
  u.view.setQuery(''); assert.ok(u.rows().every(row => !row.hidden));
  assert.equal(u.calls.length, 2);
  assertReadOnly(u);
});

test('reports exact bundled provenance, ref is not a version, mappings are not exports or deployment facts', async t => {
  const u = setup(t, { api: () => available({ packages: [pkg('oats.dev', { ref: 'v9.9.9', installed: true, version: 'invented', exports: ['invented-export'], signature: 'verified' })],
    capabilityAliases: [alias(), alias('old.missing', { package: 'absent.pkg', capabilityInPackage: 'new.missing', available: false, via: 'identity' })] }) });
  await u.activate();
  assert.deepEqual(u.all('.official-catalog-facts dd').map(el => el.textContent), ['bundled', '/local/cli/package-catalog.json', '0.24.6']);
  assert.equal(u.one('.official-catalog-warning').hidden, true);
  assert.match(u.text(), /Source URL: https:\/\/example.invalid\/oats.git/);
  assert.match(u.text(), /Ref: v9.9.9/); assert.match(u.text(), /Payload path: packages\/dev/);
  assert.match(u.text(), /Package version: Not reported/); assert.match(u.text(), /Export inventory: Not reported/);
  assert.match(u.text(), /Catalog mappings — NOT export inventory/);
  assert.match(u.text(), /Mapped capability: new.missing/); assert.match(u.text(), /Package: absent.pkg/);
  assert.match(u.text(), /Resolvable in this catalog: No/);
  assert.match(u.text(), /no executable trust/); assert.match(u.text(), /snapshot.*may lag/);
  assert.match(u.text(), /Reported trust note/); assert.match(u.text(), /Reported snapshot note/);
  assert.doesNotMatch(u.text(), /invented|Installed|Ready|Signature:|Used by:/);
  assertReadOnly(u);
});

test('override is conspicuous local CLI data, not a verified official list', async t => {
  let data = available({ catalog: { origin: 'override', file: '/tmp/operator-catalog.json', kernelVersion: '0.24.7-preview' } });
  const u = setup(t, { api: () => data }); await u.activate();
  assert.equal(u.one('h2').textContent, 'Local CLI catalog');
  assert.equal(u.one('.official-catalog-warning').hidden, false);
  assert.match(u.one('.official-catalog-warning').textContent, /override — not verified as the reviewed official list/);
  assert.deepEqual(u.all('dd').map(el => el.textContent), ['override', '/tmp/operator-catalog.json', '0.24.7-preview']);
  data = available(); await u.view.refresh();
  assert.equal(u.one('h2').textContent, 'Official catalog'); assert.equal(u.one('.official-catalog-warning').hidden, true);
  assertReadOnly(u);
});

test('hostile metadata is literal text/provenance, never markup, selectors, resources or links', async t => {
  const hostile = `x'\"><img src=x onerror=evil()><script>evil()</script>[data-x='y']`;
  const u = setup(t, { api: () => available({ catalog: { origin: 'override', file: hostile, kernelVersion: hostile },
    packages: [pkg(hostile, { url: 'javascript:evil()', ref: hostile, path: hostile })],
    capabilityAliases: [alias(hostile, { package: hostile, capabilityInPackage: hostile, via: hostile })], notes: [hostile] }) });
  await u.activate();
  assert.equal(u.one('strong').textContent, hostile);
  assert.deepEqual(u.all('dd').map(el => el.textContent), ['override', hostile, hostile]);
  assert.match(u.text(), /Source URL: javascript:evil\(\)/);
  assert.ok(u.all('p').some(el => el.textContent === `Ref: ${hostile}`));
  assert.ok(u.all('p').some(el => el.textContent === `Payload path: ${hostile}`));
  assert.equal(u.one('li').textContent, hostile);
  assert.equal(u.all('*').some(el => [...el.attributes].some(a => /^on/i.test(a.name))), false);
  u.view.setQuery("[data-x='y']"); assert.equal(u.rows()[0].hidden, false);
  assertReadOnly(u);
});

for (const [name, api, expected] of [
  ['old CLI', () => unavailable(), /older than 0.24.6/],
  ['absent CLI', () => unavailable('cli-unavailable', 'No local CLI found.'), /No local CLI found/],
  ['404 response', () => new Response('not found', { status: 404 }), /HTTP 404/],
  ['HTTP domain error', () => new Response(JSON.stringify({ error: 'Catalog reader failed' }), { status: 503 }), /Catalog reader failed/],
  ['transport rejection', () => Promise.reject(new Error('offline <img src=x>')), /offline <img src=x>/],
  ['synchronous rejection', () => { throw new Error('sync failure'); }, /sync failure/],
  ['malformed JSON', () => new Response('{bad', { status: 200 }), /Malformed/],
]) test(`${name} degrades only this section and retries explicitly, not on polling`, async t => {
  let read = api;
  const u = setup(t, { api: (...args) => read(...args) });
  await u.activate(); assert.match(u.status(), /Catalog unavailable/); assert.match(u.status(), expected);
  assert.match(u.status(), /0.24.6/); assert.equal(u.one('.official-catalog-refresh').textContent, 'Retry catalog');
  assert.equal(u.one('.official-catalog-refresh').disabled, false); assert.equal(u.commands().length, 0);
  await u.activate(); await u.activate(); assert.equal(u.calls.length, 1);
  assertReadOnly(u);
  read = () => available(); u.one('.official-catalog-refresh').click(); await tick();
  assert.equal(u.status(), ''); assert.equal(u.commands().length, 1); assert.equal(u.calls.length, 2);
});

for (const [name, change] of [
  ['API version', d => { d.catalogApi = 2; }],
  ['remote scope', d => { d.scope = 'remote-cli'; }],
  ['minimum version', d => { d.minimumVersion = null; }],
  ['description schema', d => { d.description.schemaVersion = 2; }],
  ['origin', d => { d.description.catalog.origin = 'official'; }],
  ['catalog file object', d => { d.description.catalog.file = {}; }],
  ['notes object', d => { d.description.notes = [{}]; }],
  ['packages missing', d => { delete d.description.packages; }],
  ['package scalar', d => { d.description.packages = [null]; }],
  ['duplicate package identity', d => { d.description.packages.push(pkg()); }],
  ['source object', d => { d.description.packages[0].url = { href: 'https://example.invalid' }; }],
  ['alias available string', d => { d.description.capabilityAliases[0].available = 'true'; }],
  ['alias duplicate', d => { d.description.capabilityAliases.push(alias()); }],
  ['unavailable mixed description', d => { d.status = 'unavailable'; d.reason = { code: 'old', message: 'old' }; }],
  ['unavailable malformed reason', d => { Object.assign(d, unavailable()); d.reason.message = {}; }],
]) test(`malformed ${name} fails closed without harming deployment facts`, async t => {
  const data = available(); change(data);
  const u = setup(t, { api: () => data }); await u.activate();
  assert.match(u.status(), /Catalog unavailable.*Malformed/); assert.equal(u.commands().length, 0); assertReadOnly(u);
});

test('null sources stay Not reported; empty inventories never imply no exports or no deployments', async t => {
  let data = available({ packages: [pkg('nullable', { url: null, ref: null, path: null })], capabilityAliases: [], notes: [] });
  const u = setup(t, { api: () => data }); await u.activate();
  assert.match(u.text(), /Source URL: Not reported/); assert.match(u.text(), /Ref: Not reported/); assert.match(u.text(), /Payload path: Not reported/);
  assert.match(u.text(), /No catalog mappings reported/);
  data = available({ packages: [], capabilityAliases: [], notes: [] }); await u.view.refresh();
  assert.equal(u.commands().length, 0); assert.match(u.text(), /No packages reported/); assertReadOnly(u);
});

test('nullable catalog metadata and mapping facts stay unknown across boundary and view', async t => {
  const data = available({ catalog: { origin: 'bundled', file: null, kernelVersion: null },
    capabilityAliases: [alias('unknown.mapping', { package: null, capabilityInPackage: null, via: null, available: null })] });
  const read = createCatalogBoundary({ invoke: async () => ({ schemaVersion: 1, ok: true, result: data.description }) });
  const u = setup(t, { api: () => read({}, { cli: { ok: true, bin: '/fixture/oats', version: '0.24.6' }, localCwd: '/fixture' }) });
  await u.activate();
  assert.equal(u.status(), '');
  assert.deepEqual(u.all('dd').map(el => el.textContent), ['bundled', 'Not reported', 'Not reported']);
  assert.match(u.text(), /Package: Not reported/); assert.match(u.text(), /Mapped capability: Not reported/);
  assert.match(u.text(), /Via: Not reported/); assert.match(u.text(), /Resolvable in this catalog: Not reported/);
  assert.doesNotMatch(u.text(), /Resolvable in this catalog: No\b/);
  assert.equal(u.one('.official-catalog-scope').hidden, false);
  assert.equal(u.one('.official-catalog-scope').textContent, 'Local CLI catalog');
  assertReadOnly(u);
});

test('exact install tuple only, unsafe options/controls rejected, shell metacharacters POSIX-quoted', async t => {
  const ids = ['plain.package', 'with space', "a'b", 'semi;$(touch nope)&*', 'quote"`pipe|>out', 'unicode.é'];
  const bad = [
    pkg('--trust'), pkg(' -option'), pkg('tab\there'), pkg('line\nnext'), pkg('nul\0id'), pkg('del\x7fid'), pkg('bidi\u202Eid'), pkg('line\u2028id'),
    pkg('extra', { acquire: { argv: ['oats', 'install', 'extra', '--trust'] } }),
    pkg('other-package', { acquire: { argv: ['oats', 'install', 'mismatch'] } }),
    pkg('other-verb', { acquire: { argv: ['oats', 'trust', 'other-verb'] } }),
    pkg('other-binary', { acquire: { argv: ['/bin/oats', 'install', 'other-binary'] } }),
    pkg('argv-string', { acquire: { argv: 'oats install argv-string' } }), pkg('missing-acquire', { acquire: null }),
    pkg('bad-argument', { acquire: { argv: ['oats', 'install', {}] } }),
  ];
  const u = setup(t, { api: () => available({ packages: [...ids.map(id => pkg(id)), ...bad] }) }); await u.activate();
  const expected = new Map([
    ['plain.package', 'oats install plain.package'], ['with space', "oats install 'with space'"], ["a'b", "oats install 'a'\\''b'"],
    ['semi;$(touch nope)&*', "oats install 'semi;$(touch nope)&*'"], ['quote"`pipe|>out', 'oats install \'quote"`pipe|>out\''], ['unicode.é', "oats install 'unicode.é'"],
  ]);
  assert.equal(u.commands().length, ids.length);
  for (const row of u.rows()) {
    const id = row.querySelector('strong').textContent, command = row.querySelector('input');
    if (expected.has(id)) { assert.equal(command.value, expected.get(id)); assert.equal(command.readOnly, true); }
    else { assert.equal(command, null); assert.match(row.textContent, /Install command unavailable/); assert.equal(row.querySelector('button'), null); }
  }
  assertReadOnly(u);
});

test('reordering results and aliases preserves controls by identity; filter and no-op polling retain focus and selection', async t => {
  let data = available({ packages: [pkg('z'), pkg('a')], capabilityAliases: [alias('z'), alias('a')] });
  const u = setup(t, { api: () => data }); await u.activate();
  const originalRows = u.rows(), commands = u.commands(), buttons = u.copyButtons();
  commands[1].focus(); commands[1].setSelectionRange(1, 8);
  data = available({ packages: [pkg('a'), pkg('z')], capabilityAliases: [alias('a'), alias('z')] });
  await u.view.refresh();
  assert.deepEqual(u.rows(), originalRows); assert.deepEqual(u.commands(), commands); assert.deepEqual(u.copyButtons(), buttons);
  assert.equal(u.doc.activeElement, commands[1]); assert.equal(commands[1].selectionStart, 1); assert.equal(commands[1].selectionEnd, 8);
  u.view.setQuery('"package":"z"'); assert.equal(originalRows[0].hidden, true); assert.equal(originalRows[1].hidden, false);
  u.view.setQuery(''); assert.deepEqual(u.rows(), originalRows);
  for (let n = 0; n < 8; n++) await u.activate();
  assert.equal(u.calls.length, 2); assert.equal(u.doc.activeElement, commands[1]); assert.equal(commands[1].selectionEnd, 8);
  assertReadOnly(u);
});

for (const outcome of ['success', 'rejection']) for (const supersede of ['identity', 'refresh', 'A-B-A']) test(`late read ${outcome} cannot overwrite newer ${supersede} intent`, async t => {
  const requests = [];
  const u = setup(t, { api: () => { const d = deferred(); requests.push(d); return d.promise; } });
  void u.activate('A');
  if (supersede === 'refresh') void u.view.refresh();
  else { void u.activate('B'); if (supersede === 'A-B-A') void u.activate('A'); }
  const newest = requests.at(-1); newest.resolve(available({ packages: [pkg('current-package')] })); await tick();
  for (const d of requests.slice(0, -1)) {
    if (outcome === 'success') d.resolve(available({ packages: [pkg('stale-package')] })); else d.reject(new Error('stale failure'));
  }
  await tick(); u.view.setQuery('');
  assert.match(u.text(), /current-package/); assert.doesNotMatch(u.text(), /stale-package|stale failure/);
  assert.equal(u.status(), ''); assert.equal(u.one('.official-catalog-refresh').disabled, false); assertReadOnly(u);
});

for (const outcome of ['success', 'rejection']) test(`old ${outcome} during newer loading cannot clear the newer read's lock`, async t => {
  const requests = [];
  const u = setup(t, { api: () => { const d = deferred(); requests.push(d); return d.promise; } });
  void u.activate('A'); void u.activate('B');
  if (outcome === 'success') requests[0].resolve(available()); else requests[0].reject(new Error('old failure'));
  await tick();
  assert.equal(u.status(), 'Loading local CLI catalog…'); assert.equal(u.one('.official-catalog-refresh').disabled, true);
  assert.equal(u.commands().length, 0);
  requests[1].resolve(available()); await tick(); assert.equal(u.status(), '');
});

for (const outcome of ['success', 'rejection']) test(`dispose ignores read ${outcome}; inactive same identity may finish its one cached read`, async t => {
  const d = deferred(), u = setup(t, { api: () => d.promise });
  void u.activate(); u.view.update({ active: false, identity: 'cli/workspace-A' });
  d.resolve(available()); await tick(); assert.equal(u.one('.official-catalog').hidden, true);
  await u.activate(); assert.equal(u.calls.length, 1); assert.equal(u.commands().length, 1);
  const late = deferred(), disposed = setup(t, { api: () => late.promise });
  void disposed.activate(); const section = disposed.one('.official-catalog');
  disposed.view.dispose(); const before = section.innerHTML;
  if (outcome === 'success') late.resolve(available()); else late.reject(new Error('late unmount'));
  await tick(); assert.equal(section.innerHTML, before); assert.equal(disposed.one('.official-catalog'), null);
  await disposed.activate('new'); await disposed.view.refresh(); disposed.view.setQuery('x');
  assert.equal(disposed.calls.length, 1); assert.equal(disposed.one('#deployment').isConnected, true);
});

test('identity is opaque: object ownership never string-coerced, or sent in request', async t => {
  const key = { toString() { throw new Error('opaque'); } }, other = { toString() { throw new Error('opaque'); } };
  const u = setup(t); await u.activate(key); await u.activate(key); assert.equal(u.calls.length, 1);
  await u.activate(other); assert.equal(u.calls.length, 2); assertReadOnly(u);
});

test('copy is user initiated, exact command only, no execution, no completion-driven focus stealing', async t => {
  const copied = [], d = deferred();
  const u = setup(t, { copyText: command => { copied.push(command); return d.promise; } });
  await u.activate(); assert.deepEqual(copied, []);
  const button = u.copyButtons()[0]; button.click();
  assert.deepEqual(copied, ['oats install oats.dev']); assert.equal(button.disabled, true); assert.equal(u.feedback(), 'Copying…');
  const input = u.one('.official-catalog-filter'); input.focus();
  await u.activate(); assert.equal(u.feedback(), 'Copying…');
  d.resolve(); await tick();
  assert.equal(u.feedback(), 'Copied command. Nothing was executed.'); assert.equal(button.disabled, false); assert.equal(u.doc.activeElement, input);
  assert.equal(u.calls.length, 1); assertReadOnly(u);
});

test('clipboard copies only the schema argv, never URL/ref, legacy command text or altered display text', async t => {
  const copied = [], id = "literal package's name";
  const url = 'https://example.invalid/untrusted;$(touch never).git', ref = 'v99 --trust';
  const data = available({ packages: [pkg(id, { url, ref, command: `oats install ${url}#${ref}`,
    acquire: { argv: ['oats', 'install', id], command: 'oats trust everything' } }),
    pkg('url-in-argv', { url, ref, acquire: { argv: ['oats', 'install', url] } }),
    pkg('ref-in-argv', { url, ref, acquire: { argv: ['oats', 'install', 'ref-in-argv', ref] } })] });
  const u = setup(t, { api: () => data, copyText: text => { copied.push(text); } }); await u.activate();
  assert.equal(u.commands().length, 1); assert.equal(u.copyButtons().length, 1);
  u.commands()[0].value = `oats install ${url}#${ref}`; // presentation is not command authority
  u.copyButtons()[0].click(); await tick();
  assert.deepEqual(copied, ["oats install 'literal package'\\''s name'"]);
  assert.ok(copied.every(text => !text.includes(url) && !text.includes(ref) && !text.includes('trust')));
  assert.equal(u.calls.length, 1); assertReadOnly(u);
});

for (const mode of ['missing', 'reject', 'throw', 'false']) test(`clipboard ${mode} has honest selectable fallback, not false success`, async t => {
  const copyText = mode === 'missing' ? undefined : mode === 'throw' ? () => { throw new Error('blocked'); }
    : mode === 'false' ? () => false : () => Promise.reject(new Error('denied'));
  const u = setup(t, { copyText }); await u.activate(); u.copyButtons()[0].click(); await tick();
  assert.equal(u.feedback(), 'Copy unavailable. Select the command and copy it manually.');
  assert.equal(u.copyButtons()[0].disabled, false);
  const command = u.commands()[0]; command.focus(); command.select();
  assert.equal(command.selectionStart, 0); assert.equal(command.selectionEnd, command.value.length); assert.equal(command.readOnly, true);
  assertReadOnly(u);
});

test('browser clipboard is used with its receiver only after an explicit click', async t => {
  const u = setup(t), copied = [];
  const clipboard = { writeText(value) { assert.equal(this, clipboard); copied.push(value); return Promise.resolve(); } };
  Object.defineProperty(u.dom.window.navigator, 'clipboard', { value: clipboard });
  await u.activate(); assert.deepEqual(copied, []); u.copyButtons()[0].click(); await tick();
  assert.deepEqual(copied, ['oats install oats.dev']); assert.match(u.feedback(), /^Copied command/); assertReadOnly(u);
});

for (const mode of ['injected', 'browser']) for (const outcome of ['success', 'rejection']) for (const boundary of ['identity', 'A-B-A', 'refresh', 'hide', 'dispose', 'detach']) test(`${mode} clipboard ${outcome} cannot write after ${boundary}`, async t => {
  const d = deferred(), copyText = () => d.promise;
  const u = setup(t, { copyText: mode === 'injected' ? copyText : undefined });
  if (mode === 'browser') Object.defineProperty(u.dom.window.navigator, 'clipboard', { value: { writeText: copyText } });
  await u.activate('A'); const button = u.copyButtons()[0], feedback = u.one('.official-catalog-copy-status'); button.click();
  if (boundary === 'identity' || boundary === 'A-B-A') { await u.activate('B'); if (boundary === 'A-B-A') await u.activate('A'); }
  else if (boundary === 'refresh') await u.view.refresh();
  else if (boundary === 'hide') u.view.update({ active: false, identity: 'A' });
  else if (boundary === 'dispose') u.view.dispose();
  else u.host.remove();
  const beforeFeedback = feedback.textContent, beforeDisabled = button.disabled;
  const beforeHost = u.host.innerHTML, beforeFocus = u.doc.activeElement;
  if (outcome === 'success') d.resolve(); else d.reject(new Error('stale clipboard error'));
  await tick();
  assert.equal(feedback.textContent, beforeFeedback); assert.equal(button.disabled, beforeDisabled);
  assert.equal(u.host.innerHTML, beforeHost); assert.equal(u.doc.activeElement, beforeFocus);
  if (['identity', 'A-B-A', 'hide'].includes(boundary)) {
    button.click(); // detached or inactive controls must not copy for a newer intent
    assert.doesNotMatch(u.feedback(), /Copied command|Copy unavailable/);
  }
});

for (const outcome of ['success', 'rejection']) test(`newer row's clipboard feedback owns late ${outcome} from the previous row`, async t => {
  const copies = [];
  const u = setup(t, { api: () => available({ packages: [pkg('a'), pkg('b')] }), copyText: () => { const d = deferred(); copies.push(d); return d.promise; } });
  await u.activate(); u.copyButtons()[0].click(); u.copyButtons()[1].click();
  copies[1].resolve(); await tick(); const before = u.host.innerHTML;
  if (outcome === 'success') copies[0].resolve(); else copies[0].reject(new Error('old copy'));
  await tick(); assert.equal(u.host.innerHTML, before);
  assert.deepEqual(u.all('.official-catalog-copy-status').map(el => el.textContent), ['', 'Copied command. Nothing was executed.']);
});

test('scoped CSS uses semantic colors, no opacity or resources, with table/card geometry and accessible controls', async t => {
  assert.doesNotMatch(officialCatalogCSS, /#[0-9a-f]{3,8}\b|rgba?\(|opacity\s*:|url\(|\.discovery-table/iu);
  assert.match(officialCatalogCSS, /height:56px/); assert.match(officialCatalogCSS, /height:36px/); assert.match(officialCatalogCSS, /@container/);
  const u = setup(t); await u.activate();
  const style = u.doc.createElement('style'); style.textContent = officialCatalogCSS; u.doc.head.append(style);
  assert.equal(u.one('.official-catalog').tagName, 'SECTION'); assert.equal(u.one('.official-catalog').getAttribute('aria-label'), 'Official catalog — Local CLI catalog');
  assert.equal(u.one('.official-catalog-filter').labels[0].textContent, 'Filter local CLI catalog');
  assert.ok(u.commands().every(input => input.getAttribute('aria-label')));
  assert.ok(u.all('button').every(button => button.type === 'button'));
  assert.ok(u.all('th').every(th => th.scope === 'col'));
  assert.ok(u.all('table').every(table => table.caption));
  assert.equal(u.one('.official-catalog-status').getAttribute('role'), 'status');
});

// Mutation checks exercise the actual builder with only its completion guard
// weakened in memory. No repository edits, subprocesses, or live API/CLI calls.
async function mutatedCreate(oldText, newText) {
  const url = new URL('../renderer/official-catalog.mjs', import.meta.url);
  let source = readFileSync(url, 'utf8'); assert.ok(source.includes(oldText));
  source = source.replace(oldText, newText).replace("'./views/common.mjs'", JSON.stringify(new URL('../renderer/views/common.mjs', import.meta.url).href));
  return (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).createOfficialCatalog;
}
// Two renderer requests share one real boundary/adapter flight. Its successful
// DTOs are delayed in transit; a subsequent flight fails before they arrive.
// Keeping the same UI identity pins readSerial, not merely workspace disposal.
async function staleCoalescedSuccess(t, { create = createOfficialCatalog, transportFailure = false } = {}) {
  let executions = 0, requests = 0, firstExit;
  const deliveries = deferred();
  const read = createCatalogBoundary({ invoke: (bin, args) => cliCatalog(bin, args, {
    exec(_bin, argv, opts, done) {
      assert.deepEqual(argv, ['catalog', '--json']); assert.equal(opts.shell, false);
      executions++;
      if (executions === 1) firstExit = done;
      else done(new Error('exit 1'), JSON.stringify({ schemaVersion: 1, ok: false, error: { code: 'E_USAGE' } }));
    },
  }) });
  const u = setup(t, { create, api: async () => {
    const ordinal = ++requests;
    const data = await read({}, { cli: { ok: true, bin: '/fixture/oats', version: '0.24.6' }, localCwd: '/fixture' });
    if (ordinal <= 2) await deliveries.promise;
    else if (transportFailure) throw new Error('newer transport failure');
    return data;
  } });
  const older = [u.activate('same-owner'), u.view.refresh()];
  await tick(); assert.equal(executions, 1, 'two requests coalesce into one CLI invocation');
  firstExit(null, JSON.stringify({ schemaVersion: 1, ok: true, result: available().description }));
  await tick(); // boundary flight released, old renderer deliveries still held
  await u.view.refresh(); assert.equal(executions, 2); assert.equal(requests, 3);
  assert.match(u.status(), transportFailure ? /newer transport failure/ : /Catalog unavailable/);
  const failure = u.status();
  deliveries.resolve(); await Promise.all(older);
  return () => {
    assert.equal(u.status(), failure, 'stale shared success must not clear the newer failure');
    assert.equal(u.commands().length, 0, 'no command is exposed by a stale success');
    assert.equal(u.copyButtons().length, 0);
    assert.equal(u.one('.official-catalog-refresh').disabled, false);
    assert.equal(u.one('.official-catalog-refresh').textContent, 'Retry catalog');
    assertReadOnly(u);
  };
}
for (const transportFailure of [false, true]) {
  test(`stale coalesced success cannot overwrite newer ${transportFailure ? 'transport' : 'CLI'} failure`, async t => {
    const assertCurrent = await staleCoalescedSuccess(t, { transportFailure }); assertCurrent();
  });
  test(`coalesced success/newer failure regression detects removed read ownership (${transportFailure ? 'transport' : 'CLI'})`, async t => {
    const create = await mutatedCreate('return alive && epoch === owner && readSerial === ticket && workspaceGeneration() === gen;', 'return alive;');
    const assertCurrent = await staleCoalescedSuccess(t, { create, transportFailure }); assert.throws(assertCurrent, /stale shared success/);
  });
}

for (const outcome of ['success', 'rejection']) test(`read ${outcome} race assertion detects weakened generation ownership`, async t => {
  const create = await mutatedCreate('return alive && epoch === owner && readSerial === ticket && workspaceGeneration() === gen;', 'return alive;');
  const requests = [], u = setup(t, { create, api: () => { const d = deferred(); requests.push(d); return d.promise; } });
  void u.activate('A'); void u.activate('B'); requests[1].resolve(available({ packages: [pkg('new')] })); await tick();
  if (outcome === 'success') requests[0].resolve(available({ packages: [pkg('old')] })); else requests[0].reject(new Error('old failure'));
  await tick(); assert.throws(() => { assert.match(u.text(), /Package version: Not reported/); assert.equal(u.one('strong')?.textContent, 'new'); });
});
for (const outcome of ['success', 'rejection']) test(`clipboard ${outcome} race assertion detects weakened generation ownership`, async t => {
  const create = await mutatedCreate('const owns = () => alive && active && epoch === owner && readSerial === read && copySerial === ticket', 'const owns = () => alive && active');
  const d = deferred(), u = setup(t, { create, copyText: () => d.promise });
  await u.activate(); u.copyButtons()[0].click(); await u.view.refresh(); // same row retained, newer read owner
  if (outcome === 'success') d.resolve(); else d.reject(new Error('old copy'));
  await tick(); assert.throws(() => assert.equal(u.feedback(), ''));
});
