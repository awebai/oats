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
