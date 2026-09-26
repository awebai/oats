import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { soulsData } from '../deployment-data.mjs';
import { createSoulCatalog, soulCatalogKey, SOUL_CATALOG_RETRY_MS } from '../server/soul-catalog.mjs';

// Kernel-produced `oats souls --json` (see fixtures/workspace-v2/f3/provenance.json).
const SOULS = JSON.parse(readFileSync(new URL('./fixtures/workspace-v2/f3/souls.json', import.meta.url), 'utf8'));
const copy = () => structuredClone(SOULS);
const refused = fn => assert.throws(fn, error => error.code === 'E_CLI_PROTOCOL');

test('soulsData projects the kernel catalog exactly: names, kind, work, provenance', () => {
  const data = soulsData(copy());
  assert.equal(data.soulsApi, 1);
  assert.deepEqual(data.workspace, SOULS.result.workspace);
  assert.deepEqual(data.souls.map(s => s.name), SOULS.result.souls.map(s => s.name));
  const kernel = SOULS.result.souls[0], row = data.souls[0];
  for (const key of ['name', 'origin', 'kind', 'repoKey', 'commit', 'team', 'path', 'work', 'description', 'private']) assert.deepEqual(row[key], kernel[key], key);
  assert.deepEqual(data.ambiguous, []);
});

test('soulsData keeps a duplicated soul name out of the catalog and reports it as ambiguous', () => {
  const doc = copy(); doc.result.souls.push({ ...doc.result.souls[0], origin: 'external elsewhere', kind: 'external' });
  const data = soulsData(doc);
  assert.equal(data.souls.some(s => s.name === doc.result.souls[0].name), false, 'never guess which one spawns');
  assert.deepEqual(data.ambiguous, [doc.result.souls[0].name]);
});

test('soulsData refuses anything that is not the soulsApi 1 contract', () => {
  for (const mutate of [
    d => { d.schemaVersion = 2; }, d => { d.ok = false; }, d => { d.result.soulsApi = 2; },
    d => { d.result.souls[0].name = 'Bad Name'; }, d => { d.result.souls[0].kind = 'roster'; },
    d => { d.result.souls[0].work = 'shared'; }, d => { d.result.souls = {}; },
  ]) { const doc = copy(); mutate(doc); refused(() => soulsData(doc)); }
});

function harness() {
  let clock = 1000, calls = 0, next = () => ({ ok: true, document: copy() });
  const gates = [];
  const catalog = createSoulCatalog({ now: () => clock, invoke: async (cli, request) => {
    calls++; assert.deepEqual(request, { action: 'souls', context: '/dep' });
    if (gates.length) await gates.shift();
    return next();
  } });
  return { catalog, calls: () => calls, tick: ms => { clock += ms; }, answer: fn => { next = fn; }, gate: promise => gates.push(promise) };
}
const CLI = { bin: '/oats', version: '0.25.7' };
const WS = { workspace: { key: 'k', commit: 'c1' }, members: [{ key: 'm', commit: 'a', status: 'ready' }], external: [] };

test('the catalog is read once per workspace state; concurrent observers share one read', async () => {
  const h = harness(); let open; h.gate(new Promise(r => { open = r; }));
  const pending = [h.catalog.observe('/dep', CLI, WS), h.catalog.observe('/dep', CLI, WS)];
  open(); const [a, b] = await Promise.all(pending);
  assert.equal(h.calls(), 1); assert.deepEqual(a, b); assert.equal(a.reason, null);
  await h.catalog.observe('/dep', CLI, structuredClone(WS)); h.tick(10 * SOUL_CATALOG_RETRY_MS);
  await h.catalog.observe('/dep', CLI, WS);
  assert.equal(h.calls(), 1, 'roster polls never re-read an unchanged workspace');
  a.souls.pop(); assert.equal(h.catalog.held('/dep').souls.length, SOULS.result.souls.length, 'callers get copies');
});

test('a moved member, workspace commit or CLI re-reads the catalog', async () => {
  const h = harness(); await h.catalog.observe('/dep', CLI, WS);
  await h.catalog.observe('/dep', CLI, { ...WS, members: [{ key: 'm', commit: 'b', status: 'ready' }] });
  await h.catalog.observe('/dep', CLI, { ...WS, workspace: { key: 'k', commit: 'c2' } });
  await h.catalog.observe('/dep', { ...CLI, version: '0.25.9' }, WS);
  assert.equal(h.calls(), 4);
  assert.notEqual(soulCatalogKey(CLI, WS), soulCatalogKey(CLI, { ...WS, external: [{ source: 's', soul: 'x' }] }));
});

test('a failed read keeps the last good catalog, reports the reason, and retries only after the retry window', async () => {
  const h = harness(); const good = await h.catalog.observe('/dep', CLI, WS);
  const moved = { ...WS, workspace: { key: 'k', commit: 'c2' } };
  h.answer(() => ({ ok: false, reason: { code: 'E_WORKSPACE', message: 'members not ready' } }));
  const failed = await h.catalog.observe('/dep', CLI, moved);
  assert.deepEqual(failed.souls, good.souls); assert.deepEqual(failed.reason, { code: 'E_WORKSPACE', message: 'members not ready' });
  await h.catalog.observe('/dep', CLI, moved); assert.equal(h.calls(), 2, 'no retry storm');
  h.tick(SOUL_CATALOG_RETRY_MS); h.answer(() => ({ ok: true, document: copy() }));
  assert.equal((await h.catalog.observe('/dep', CLI, moved)).reason, null); assert.equal(h.calls(), 3);
});

test('a first read that fails leaves no catalog (never a roster fallback); protocol and transport failures stay distinct', async () => {
  const h = harness(); h.answer(() => ({ ok: true, document: { ...copy(), result: { soulsApi: 9 } } }));
  assert.deepEqual((await h.catalog.observe('/dep', CLI, WS)).reason, { code: 'E_CLI_PROTOCOL', message: '' });
  assert.equal(h.catalog.held('/dep').souls, null);
  const t = createSoulCatalog({ invoke: async () => { throw new Error('spawn ENOENT'); } });
  assert.deepEqual((await t.observe('/dep', CLI, WS)).reason, { code: 'E_CLI_FAILED', message: '' });
  t.forget('/dep'); assert.equal(t.held('/dep'), null);
});

test('soulsData keeps a soul\'s team labels only when they are a bounded list of distinct valid labels', () => {
  const doc = JSON.parse(readFileSync(new URL('./fixtures/workspace-v2/f7/souls.json', import.meta.url), 'utf8'));
  assert.deepEqual(soulsData(doc).souls.find(s => s.name === 'release-manager').labels, ['engineering', 'global']);
  for (const bad of ['engineering', [7], ['Bad Label'], ['a', 'a'], Array.from({ length: 65 }, (_, i) => `t${i}`)]) {
    const d = structuredClone(doc); d.result.souls.find(s => s.name === 'release-manager').labels = bad;
    assert.throws(() => soulsData(d), undefined, JSON.stringify(bad).slice(0, 40));
  }
});

test('kernel #217 (desktop-facts): spawnable, problem and file pass through; the harness default does not', () => {
  const doc = copy(), [first, second] = doc.result.souls;
  Object.assign(first, { spawnable: true, problem: null, file: { path: 'agents/x/soul.yaml', url: 'https://github.com/acme/agents/blob/abc/agents/x/soul.yaml' }, harness: 'pi', model: null, harnessFrom: 'kernel-default' });
  Object.assign(second, { spawnable: false, problem: { code: 'E_SOUL_DISABLED', message: 'disabled on this computer' }, file: null });
  const [a, b] = soulsData(doc).souls;
  assert.deepEqual([a.spawnable, a.problem, a.file], [true, null, first.file]);
  assert.deepEqual([b.spawnable, b.problem, b.file], [false, { code: 'E_SOUL_DISABLED', message: 'disabled on this computer' }, null]);
  assert.equal(Object.hasOwn(a, 'harnessFrom'), false, "the kernel default is not the soul's choice (#217 note 4)");
  second.spawnable = 'no'; refused(() => soulsData(doc));
});
