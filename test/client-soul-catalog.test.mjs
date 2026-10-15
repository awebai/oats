// The soul catalog of the shared home (packages/client/soul-catalog.mjs) and the holding rules under it
// (packages/client/keyed-catalog.mjs): a client makes its own catalog, with its own terms, and two catalogs
// share nothing. What one holds (a flight, a held entry, a cycle, the key it settled) is unknown to the other.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSoulCatalog, soulCatalogKey, SOUL_CATALOG_RETRY_MS } from '../packages/client/soul-catalog.mjs';
import { createKeyedCatalog } from '../packages/client/keyed-catalog.mjs';
import { clientTerms } from '../packages/client/client-terms.mjs';

const TERMS = { name: 'the test client', self: 'this test client', selfInitial: 'This test client', update: 'Update the test client.', thisMachine: 'This machine' };
const terms = clientTerms(TERMS);
const CLI = { ok: true, bin: '/usr/local/bin/oats', version: '0.60.0', workspaceApi: 2, features: ['workspace-v2', 'packages-no-approval'] };
const WS = { workspace: { key: 'oats', commit: 'c1' }, members: [], external: [] };
const D = '/a/oats';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
/** A kernel `oats souls --json` answer holding the souls named. */
const souls = (...names) => ({ schemaVersion: 1, ok: true, result: { soulsApi: 1, workspace: { name: 'oats', key: 'oats', commit: 'c1' },
  souls: names.map(name => ({ name, origin: `oats:souls/${name}`, kind: 'member', repoKey: 'oats', commit: 'c1', team: null, path: `souls/${name}`, work: 'worktree', description: '' })),
  ambiguous: [], problems: [] } });
/** A catalog whose kernel read is counted, and answers when `gate` (if given) settles. */
function catalog({ gate = null, answer = souls('dev') } = {}) {
  const calls = [];
  const made = createSoulCatalog({ terms, invoke: async (cli, request) => { calls.push(request); if (gate) await gate.promise; return { ok: true, document: structuredClone(answer) }; } });
  return { calls, catalog: made };
}

test('createSoulCatalog requires the client\'s terms, also with its own kernel read', () => {
  const message = 'createSoulCatalog: terms must be the object clientTerms() returned';
  for (const [what, options] of [['nothing', undefined], ['no terms', {}], ['an invoke and no terms', { invoke: async () => assert.fail('not read') }],
    ['the five values by hand', { terms: { ...TERMS } }], ['a spread of real terms', { terms: { ...terms } }], ['null', { terms: null }]]) {
    assert.throws(() => createSoulCatalog(options), { name: 'TypeError', message }, what);
  }
  assert.doesNotThrow(() => createSoulCatalog({ terms }));
  assert.equal(SOUL_CATALOG_RETRY_MS, 60_000);
});

test('the default kernel read words its refusals with the catalog\'s terms, and runs through the exec it is given', async () => {
  // A CLI too old for the workspace line: the refusal is the terms', and nothing runs.
  const old = { ...CLI, features: [] };
  const refused = await createSoulCatalog({ terms, exec: () => assert.fail('a gated read runs nothing') }).observe(D, old, WS);
  assert.equal(refused.reason.code, 'E_WORKSPACE_FEATURE');
  assert.match(refused.reason.message, /older than this test client/);
  assert.doesNotMatch(refused.reason.message, /Desktop/);
  // The exec is the one the read runs: `oats souls --json` in the deployment, its answer the catalog's.
  const runs = [];
  const exec = (bin, argv, options, done) => { runs.push({ bin, argv, cwd: options.cwd }); done(null, JSON.stringify(souls('dev', 'ops'))); };
  const entry = await createSoulCatalog({ terms, exec }).observe(D, CLI, WS);
  assert.deepEqual(runs.map(run => [run.bin, run.argv.slice(0, 2), run.argv.includes('--json')]), [[CLI.bin, ['souls', '--dir'], true]]);
  assert.deepEqual(entry.souls.map(soul => soul.name), ['dev', 'ops']);
  assert.equal(entry.reason, null);
});

test('two soul catalogs share nothing: a held catalog of one is not served by the other', async () => {
  const one = catalog({ answer: souls('dev') }), other = catalog({ answer: souls('ops') });
  const held = await one.catalog.observe(D, CLI, WS);
  assert.deepEqual(held.souls.map(soul => soul.name), ['dev']);
  assert.equal(other.catalog.held(D), null, 'the other holds nothing for the deployment');
  assert.deepEqual((await other.catalog.observe(D, CLI, WS)).souls.map(soul => soul.name), ['ops'], 'the other reads its own');
  assert.equal(other.calls.length, 1);
  // Each serves its own held entry for the same key, without reading again.
  assert.deepEqual((await one.catalog.observe(D, CLI, WS)).souls.map(soul => soul.name), ['dev']);
  assert.equal(one.calls.length, 1);
  // Forgetting in one leaves the other's entry.
  one.catalog.forget(D);
  assert.equal(one.catalog.held(D), null);
  assert.deepEqual(other.catalog.held(D).souls.map(soul => soul.name), ['ops']);
});

test('two soul catalogs share nothing: a flight of one is neither joined nor adopted by the other', async () => {
  const gate = deferred(), one = catalog({ gate }), other = catalog();
  // A prefetch in one: an unbound flight, in the air.
  const flying = one.catalog.prefetch(D, CLI);
  assert.ok(flying, 'premise: the prefetch started a read');
  assert.equal(one.catalog.refreshing(D), true);
  assert.equal(other.catalog.refreshing(D), false, 'the other has nothing in the air');
  // The other's prefetch starts its own read: nothing usable is held there and nothing is in flight there.
  assert.ok(other.catalog.prefetch(D, CLI));
  assert.equal(other.calls.length, 1);
  // Settling the other binds its own flight; the first one's is still unbound and still flying.
  const settled = other.catalog.settle(D, CLI, WS);
  assert.ok(settled.pending);
  assert.equal((await settled.pending).key, soulCatalogKey(CLI, WS));
  assert.equal(one.catalog.held(D), null, 'the first holds nothing yet');
  gate.resolve(); await flying;
  assert.equal(one.catalog.held(D).key, null, 'the first landed unbound: no settle of its own bound it');
  assert.equal(one.calls.length, 1);
});

test('two keyed catalogs share nothing: cycles, unbound flights, held entries and the settled key are each one\'s own', async () => {
  const make = () => {
    const reads = [];
    const made = createKeyedCatalog({ retryMs: 1000, now: () => 0, read: async (deployment, cli, options) => { reads.push(options); return { value: { n: reads.length }, observedAt: null }; } });
    return { reads, made };
  };
  const one = make(), other = make();
  // An unbound flight of one is not the other's to adopt: the other's settle starts a keyed read.
  const unbound = one.made.prefetch(D, CLI);
  const settled = other.made.settle(D, CLI, 'k1');
  assert.equal(other.reads.length, 1);
  assert.equal((await settled.pending).key, 'k1');
  await unbound;
  assert.equal(one.made.held(D).key, null, 'one\'s read landed unbound, under its own cycle');
  // The settle of one binds one's own landed entry; the other's entry is untouched.
  assert.equal(one.made.settle(D, CLI, 'k2').entry.key, 'k2');
  assert.equal(other.made.held(D).key, 'k1');
  // A demand in one under another key: its own read; the other neither reads nor sees it.
  await one.made.demand(D, CLI, 'k3');
  assert.equal(one.reads.length, 2);
  assert.equal(other.reads.length, 1);
  assert.equal(other.made.held(D).key, 'k1');
  // forgetAll in one leaves the other's held entry and its refreshing state.
  one.made.forgetAll();
  assert.equal(one.made.held(D), null);
  assert.equal(other.made.held(D).key, 'k1');
  await tick();
});
