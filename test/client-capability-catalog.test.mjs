// The capability catalog of the shared home (packages/client/capability-catalog.mjs): a client makes its own
// catalog, with its own terms, and its default kernel read runs through the exec it is given.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCapabilityCatalog, capabilityCatalogKey, CAPABILITY_CATALOG_RETRY_MS } from '../packages/client/capability-catalog.mjs';
import { clientTerms } from '../packages/client/client-terms.mjs';

const TERMS = { name: 'the test client', self: 'this test client', selfInitial: 'This test client', update: 'Update the test client.', thisMachine: 'This machine' };
const terms = clientTerms(TERMS);
const CLI = { ok: true, bin: '/usr/local/bin/oats', version: '0.60.0', workspaceApi: 2, features: ['workspace-v2', 'packages-no-approval'] };
const WS = { workspace: { key: 'oats', commit: 'c1' }, members: [], external: [], packages: [] };
const D = '/a/oats';
/** A kernel `oats capabilities --json` answer: the Desktop's fixture, its rows renamed to the names given. */
const FIXTURE = JSON.parse(readFileSync(new URL('../packages/desktop/test/fixtures/workspace-v2/desktop-facts/capabilities.json', import.meta.url), 'utf8'));
const capabilities = (...names) => { const doc = structuredClone(FIXTURE); doc.result.capabilities = names.map((name, i) => ({ ...doc.result.capabilities[i], name })); return doc; };

test('createCapabilityCatalog requires the client\'s terms, also with its own kernel read', () => {
  const message = 'createCapabilityCatalog: terms must be the object clientTerms() returned';
  for (const [what, options] of [['nothing', undefined], ['no terms', {}], ['an invoke and no terms', { invoke: async () => assert.fail('not read') }],
    ['the five values by hand', { terms: { ...TERMS } }], ['a spread of real terms', { terms: { ...terms } }], ['null', { terms: null }]]) {
    assert.throws(() => createCapabilityCatalog(options), { name: 'TypeError', message }, what);
  }
  assert.doesNotThrow(() => createCapabilityCatalog({ terms }));
  assert.equal(CAPABILITY_CATALOG_RETRY_MS, 60_000);
});

test('the default kernel read words its refusals with the catalog\'s terms, and runs through the exec it is given', async () => {
  // A CLI too old for the workspace line: the refusal is the terms', and nothing runs.
  const old = { ...CLI, features: [] };
  const refused = await createCapabilityCatalog({ terms, exec: () => assert.fail('a gated read runs nothing') }).read(D, old, WS);
  assert.equal(refused.reason.code, 'E_WORKSPACE_FEATURE');
  assert.equal(refused.reason.kernel, false);
  assert.match(refused.reason.message, /older than this test client/);
  assert.doesNotMatch(refused.reason.message, /Desktop/);
  // The exec is the one the read runs: `oats capabilities --json` in the deployment, its answer the catalog's.
  const runs = [];
  const exec = (bin, argv, options, done) => { runs.push({ bin, argv, cwd: options.cwd }); done(null, JSON.stringify(capabilities('one', 'two'))); };
  const entry = await createCapabilityCatalog({ terms, exec }).read(D, CLI, WS);
  assert.deepEqual(runs.map(run => [run.bin, run.argv.slice(0, 2), run.argv.includes('--json')]), [[CLI.bin, ['capabilities', '--dir'], true]]);
  assert.deepEqual(entry.capabilities.capabilities.map(row => row.name), ['one', 'two']);
  assert.equal(entry.reason, null);
  assert.equal(entry.key, capabilityCatalogKey(CLI, WS));
});

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
/** A catalog whose kernel read is counted, and answers when `gate` (if given) settles. */
function catalog({ gate = null, answer = capabilities('one') } = {}) {
  const calls = [];
  const made = createCapabilityCatalog({ terms, invoke: async (cli, request) => { calls.push(request); if (gate) await gate.promise; return { ok: true, document: structuredClone(answer) }; } });
  return { calls, catalog: made };
}
const names = entry => entry.capabilities.capabilities.map(row => row.name);

test('settle answers { entry, pending } at once: on a cold key, nothing held and the projected read it started', async () => {
  const gate = deferred(), { calls, catalog: made } = catalog({ gate });
  const cold = made.settle(D, CLI, WS, { maxAge: 30 });
  assert.deepEqual(Object.keys(cold), ['entry', 'pending']);
  assert.equal(cold.entry, null, 'nothing is held');
  assert.ok(cold.pending instanceof Promise, 'the read it started');
  assert.deepEqual(calls, [{ action: 'capabilities', context: D, maxAge: 30 }]);
  // A second settle for the same key, the read still in the air: it joins it, and reads nothing more.
  const joined = made.settle(D, CLI, WS);
  assert.equal(joined.entry, null);
  assert.ok(joined.pending);
  assert.equal(calls.length, 1);
  gate.resolve();
  const landed = await cold.pending;
  // The projection is the read path's: the same fields, `refreshing` included.
  assert.deepEqual(Object.keys(landed), ['key', 'capabilities', 'reason', 'at', 'observedAt', 'stale', 'refreshing']);
  assert.deepEqual([landed.key, landed.reason, landed.stale, landed.refreshing, names(landed)], [capabilityCatalogKey(CLI, WS), null, false, false, ['one']]);
  assert.deepEqual(await joined.pending, landed);
});

test('settle answers { entry, pending } at once: on a held key, the projected entry and nothing pending', async () => {
  const { calls, catalog: made } = catalog();
  await made.settle(D, CLI, WS).pending;
  const held = made.settle(D, CLI, WS);
  assert.equal(held.pending, null, 'nothing is read for a key it holds');
  assert.equal(calls.length, 1);
  assert.deepEqual([held.entry.key, held.entry.reason, held.entry.refreshing, names(held.entry)], [capabilityCatalogKey(CLI, WS), null, false, ['one']]);
  assert.deepEqual(held.entry, made.held(D), 'the same projection as what is held');
  // The state moved: the held entry (another key's) answers now, and the read for the new key is pending.
  const moved = { ...WS, workspace: { key: 'oats', commit: 'c2' } };
  const next = made.settle(D, CLI, moved);
  assert.equal(next.entry.key, capabilityCatalogKey(CLI, WS), 'what is held is the old state\'s');
  assert.equal(next.entry.refreshing, true, 'and a read is in the air');
  assert.equal((await next.pending).key, capabilityCatalogKey(CLI, moved));
  assert.equal(calls.length, 2);
});

test('two capability catalogs share nothing: no flight, no held entry', async () => {
  const gate = deferred(), one = catalog({ gate, answer: capabilities('one') }), other = catalog({ answer: capabilities('two') });
  // A flight of one is neither joined nor seen by the other.
  const flying = one.catalog.settle(D, CLI, WS);
  assert.ok(flying.pending);
  assert.equal(one.catalog.refreshing(D), true);
  assert.equal(other.catalog.refreshing(D), false, 'the other has nothing in the air');
  const own = other.catalog.settle(D, CLI, WS);
  assert.ok(own.pending, 'the other starts its own read');
  assert.equal(other.calls.length, 1);
  assert.deepEqual(names(await own.pending), ['two']);
  assert.equal(one.catalog.held(D), null, 'the first holds nothing yet');
  gate.resolve();
  assert.deepEqual(names(await flying.pending), ['one']);
  // Each serves its own held entry for the same key, without reading again.
  assert.deepEqual(names(one.catalog.settle(D, CLI, WS).entry), ['one']);
  assert.deepEqual(names(other.catalog.settle(D, CLI, WS).entry), ['two']);
  assert.deepEqual([one.calls.length, other.calls.length], [1, 1]);
  // Forgetting in one leaves the other's entry.
  one.catalog.forgetAll();
  assert.equal(one.catalog.held(D), null);
  assert.deepEqual(names(other.catalog.held(D)), ['two']);
});
