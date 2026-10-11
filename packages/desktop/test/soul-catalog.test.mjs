import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { soulsData } from '../../client/deployment-data.mjs';
import { createSoulCatalog, soulCatalogKey, SOUL_CATALOG_RETRY_MS } from '../server/soul-catalog.mjs';
import { HELD_TTL_MS } from '../server/keyed-catalog.mjs';

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
  await h.catalog.observe('/dep', CLI, structuredClone(WS)); h.tick(10 * HELD_TTL_MS);
  await h.catalog.observe('/dep', CLI, WS);
  assert.equal(h.calls(), 1, 'roster polls never re-read an unchanged workspace, however old the catalog: age is a request\'s concern');
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

// observe-max-age: a harness whose invoke is gated and records every request, so the tests can
// assert what argv the kernel would see and that settle() decides before any read completes.
function gated() {
  let clock = 1000, next = () => ({ ok: true, document: copy() });
  const requests = [], opens = [];
  const catalog = createSoulCatalog({ now: () => clock, invoke: (cli, request) => new Promise(resolve => {
    requests.push(request); opens.push(() => resolve(next()));
  }) });
  return { catalog, requests, opens, open: () => opens.shift()(), tick: ms => { clock += ms; }, answer: fn => { next = fn; } };
}
const settled = () => new Promise(r => setImmediate(r));

test('prefetch starts one unbound read; an observe in the same cycle adopts it instead of starting another', async () => {
  const h = gated();
  const first = h.catalog.prefetch('/dep', CLI);
  assert.ok(first instanceof Promise);
  assert.equal(h.catalog.refreshing('/dep'), true);
  const observed = h.catalog.observe('/dep', CLI, WS);
  assert.equal(h.requests.length, 1); assert.deepEqual(h.requests[0], { action: 'souls', context: '/dep' });
  h.open(); const [a, b] = await Promise.all([first, observed]);
  assert.deepEqual(a, b); assert.equal(a.key, soulCatalogKey(CLI, WS), 'observe adopted the unbound flight');
  assert.equal(h.catalog.refreshing('/dep'), false);
  assert.equal(h.catalog.prefetch('/dep', CLI), null, 'a held catalog needs no prefetch');
});

test('settle adopts the unbound flight under its key, never blocks, and its pending resolves to the held entry', async () => {
  const h = gated(); h.catalog.prefetch('/dep', CLI);
  const { entry, pending } = h.catalog.settle('/dep', CLI, WS);
  assert.equal(entry, null, 'nothing held yet on a cold cycle'); assert.ok(pending instanceof Promise);
  assert.equal(h.requests.length, 1, 'the read that already runs is the catalog of this cycle');
  let resolved = false; pending.then(() => { resolved = true; });
  await settled(); assert.equal(resolved, false, 'settle returned while the kernel is still answering');
  h.open(); const result = await pending;
  assert.equal(result.key, soulCatalogKey(CLI, WS)); assert.equal(result.reason, null);
  assert.deepEqual(h.catalog.held('/dep'), result);
  result.souls.pop(); assert.equal(h.catalog.held('/dep').souls.length, SOULS.result.souls.length, 'pending hands out a copy');
  const again = h.catalog.settle('/dep', CLI, structuredClone(WS));
  assert.equal(again.pending, null); assert.deepEqual(again.entry, h.catalog.held('/dep')); assert.equal(h.requests.length, 1);
});

test('a prefetch that lands before settle is held under no key, and the same cycle\'s settle binds it without a second read', async () => {
  const h = gated(); const flight = h.catalog.prefetch('/dep', CLI); h.open(); await flight;
  assert.equal(h.catalog.held('/dep').key, null, 'unbound until the cycle\'s workspace status is known');
  const { entry, pending } = h.catalog.settle('/dep', CLI, WS);
  assert.equal(pending, null); assert.equal(entry.key, soulCatalogKey(CLI, WS)); assert.equal(h.requests.length, 1);
});

test('a flight from an earlier cycle is never bound to a later cycle\'s key; the later cycle reads again', async () => {
  // In flight across cycles: cycle 1's roster reads failed, cycle 2 finds the souls read still running.
  const h = gated(); h.catalog.prefetch('/dep', CLI);
  assert.equal(h.catalog.prefetch('/dep', CLI), null, 'nothing to start while a read is in flight');
  const { entry, pending } = h.catalog.settle('/dep', CLI, WS);
  assert.equal(entry, null); assert.equal(h.requests.length, 2, 'cycle 2 reads under its own key');
  h.open(); h.open(); assert.equal((await pending).key, soulCatalogKey(CLI, WS));
  // Landed across cycles: the leftover under no key is HELD (no prefetch storm), shown but not bound; the
  // next successful cycle reads under its key at settle time.
  const g = gated(); const first = g.catalog.prefetch('/dep', CLI); g.open(); await first;
  assert.equal(g.catalog.held('/dep').key, null);
  assert.equal(g.catalog.prefetch('/dep', CLI), null, 'a landed value inside its window is held: no new read on prefetch');
  const again = g.catalog.settle('/dep', CLI, WS);
  assert.equal(again.entry.key, null, 'the leftover is shown but not bound'); assert.equal(g.requests.length, 2, 'settle reads under this cycle\'s key');
  g.open(); assert.equal((await again.pending).key, soulCatalogKey(CLI, WS));
});

test('a deployment whose roster reads keep failing costs one souls read per retry window, not one per cycle', async () => {
  for (const outcome of [() => ({ ok: true, document: copy() }), () => ({ ok: false, reason: { code: 'E_CLI_TIMEOUT', message: 'slow' } })]) {
    const h = gated(); h.answer(outcome);
    const first = h.catalog.prefetch('/dep', CLI); h.open(); await first; // cycle 1: souls landed unbound, the roster failed
    for (let cycle = 2; cycle <= 6; cycle++) { assert.equal(h.catalog.prefetch('/dep', CLI), null, `cycle ${cycle} starts nothing`); h.tick(SOUL_CATALOG_RETRY_MS / 10); }
    assert.equal(h.requests.length, 1);
    h.tick(SOUL_CATALOG_RETRY_MS);
    assert.equal(h.catalog.prefetch('/dep', CLI) instanceof Promise, !outcome().ok, 'past the window only a FAILED leftover is read again; a good one waits for settle, however old');
  }
});

test('settle on a moved workspace starts a keyed read once; concurrent settles share it', async () => {
  const h = gated(); const a = h.catalog.settle('/dep', CLI, WS), b = h.catalog.settle('/dep', CLI, WS);
  assert.equal(h.requests.length, 1); assert.equal(h.catalog.refreshing('/dep'), true);
  h.open(); assert.deepEqual(await a.pending, await b.pending);
  const moved = { ...WS, workspace: { key: 'k', commit: 'c2' } };
  const c = h.catalog.settle('/dep', CLI, moved);
  assert.equal(c.entry.key, soulCatalogKey(CLI, WS), 'the last catalog stays in place'); assert.equal(h.requests.length, 2);
  h.open(); assert.equal((await c.pending).key, soulCatalogKey(CLI, moved));
});

test('maxAge is forwarded as its own request field, only when given', async () => {
  const h = gated();
  h.catalog.prefetch('/dep', CLI, { maxAge: 30 }); h.open(); await h.catalog.settle('/dep', CLI, WS).pending;
  const moved = h.catalog.settle('/dep', CLI, { ...WS, workspace: { key: 'k', commit: 'c2' } }, { maxAge: 0 }); h.open(); await moved.pending;
  const observed = h.catalog.observe('/dep', CLI, { ...WS, workspace: { key: 'k', commit: 'c3' } }, { maxAge: 5 }); h.open(); await observed;
  const other = h.catalog.prefetch('/dep2', CLI); h.open(); await other;
  assert.deepEqual(h.requests.map(r => r.maxAge), [30, 0, 5, undefined]);
  assert.equal(Object.hasOwn(h.requests[3], 'maxAge'), false);
});

test('observedAt is the kernel observation stamp when present, else the completion time; a failure keeps the previous stamp', async () => {
  const h = gated();
  h.answer(() => { const d = copy(); d.result.observation = { observedAt: '2026-01-02T03:04:05.000Z', reused: true }; return { ok: true, document: d }; });
  const a = h.catalog.settle('/dep', CLI, WS); h.open();
  assert.equal((await a.pending).observedAt, '2026-01-02T03:04:05.000Z');
  h.answer(() => ({ ok: true, document: copy() })); h.tick(500);
  const b = h.catalog.settle('/dep', CLI, { ...WS, workspace: { key: 'k', commit: 'c2' } }); h.open();
  assert.equal((await b.pending).observedAt, new Date(1500).toISOString());
  h.answer(() => ({ ok: false, reason: { code: 'E_WORKSPACE', message: 'busy' } }));
  const c = h.catalog.settle('/dep', CLI, { ...WS, workspace: { key: 'k', commit: 'c3' } }); h.open();
  const failed = await c.pending;
  assert.deepEqual([failed.reason.code, failed.observedAt], ['E_WORKSPACE', new Date(1500).toISOString()]);
  assert.equal(h.catalog.refreshing('/dep'), false);
});

test('prefetch retries a held failure only after the retry window', async () => {
  const h = gated(); h.answer(() => ({ ok: false, reason: { code: 'E_WORKSPACE', message: 'busy' } }));
  await (h.catalog.prefetch('/dep', CLI), h.open(), h.catalog.settle('/dep', CLI, WS).pending);
  assert.equal(h.catalog.prefetch('/dep', CLI), null);
  h.tick(SOUL_CATALOG_RETRY_MS); assert.ok(h.catalog.prefetch('/dep', CLI) instanceof Promise); assert.equal(h.requests.length, 2);
});

test('the TTL is request-driven: past it, no cycle re-reads on its own; a request (revalidate) answers from the held catalog and starts exactly one re-read, shared by concurrent requests', async () => {
  const h = gated(), n = SOULS.result.souls.length;
  const a = h.catalog.settle('/dep', CLI, WS); h.open(); await a.pending;
  h.tick(HELD_TTL_MS - 1);
  assert.equal(h.catalog.revalidate('/dep', CLI, WS), null, 'inside the TTL a request has nothing to revalidate');
  h.tick(1);
  for (let cycle = 0; cycle < 5; cycle++) { assert.equal(h.catalog.settle('/dep', CLI, WS).pending, null, `cycle ${cycle}: a stale catalog is still the cycle's answer`); h.tick(1000); }
  assert.equal(h.requests.length, 1, 'past the TTL with no request: no kernel run');
  assert.deepEqual([h.catalog.held('/dep').stale, h.catalog.held('/dep').souls.length], [true, n]);
  const first = h.catalog.revalidate('/dep', CLI, WS), second = h.catalog.revalidate('/dep', CLI, WS); // two lookers while it flies
  assert.ok(first && second); assert.equal(h.requests.length, 2, 'exactly one re-read for both'); assert.equal(h.catalog.refreshing('/dep'), true);
  assert.equal(h.catalog.settle('/dep', CLI, WS).pending, null, 'the cycle still answers from the held catalog while the request\'s re-read flies');
  h.answer(() => { const d = copy(); d.result.souls = d.result.souls.slice(1); return { ok: true, document: d }; });
  h.open(); const [x, y] = await Promise.all([first, second]);
  assert.deepEqual([x.souls.length, y.souls.length, x.stale, h.catalog.held('/dep').souls.length, h.catalog.refreshing('/dep')], [n - 1, n - 1, false, n - 1, false]);
  assert.equal(h.catalog.revalidate('/dep', CLI, WS), null, 'fresh again');
  assert.equal(h.catalog.revalidate('/dep', CLI, { ...WS, workspace: { key: 'k', commit: 'other' } }), null, 'another state\'s key is the cycle\'s business, not a request\'s');
});

test('a flight under an old key that lands after the key moved does not overwrite the newer state\'s entry', async () => {
  const h = gated();
  const old = h.catalog.settle('/dep', CLI, WS);                                     // key K1, in flight (gated)
  const moved = { ...WS, workspace: { key: 'k', commit: 'c2' } };
  const next = h.catalog.settle('/dep', CLI, moved);                                 // key K2, in flight; K1's flight still running
  assert.equal(h.requests.length, 2);
  h.answer(() => { const d = copy(); d.result.souls = d.result.souls.slice(0, 1); return { ok: true, document: d }; });
  h.open(); h.open(); // K1 lands first (one soul), then K2 (one soul as well, but under the CURRENT key)
  await Promise.all([old.pending, next.pending]);
  const held = h.catalog.held('/dep');
  assert.equal(held.key, soulCatalogKey(CLI, moved), 'the entry is the newer state\'s');
  // And the late old-key landing alone: K2 lands first, then K1 → K1 is dropped, K2 stays.
  const g = gated();
  const first = g.catalog.settle('/dep', CLI, WS), second = g.catalog.settle('/dep', CLI, moved);
  g.opens.reverse();
  g.answer(() => ({ ok: true, document: copy() })); g.open(); await second.pending;                            // K2's read lands first, good…
  g.answer(() => ({ ok: false, reason: { code: 'E_STALE', message: 'old' } })); g.open(); await first.pending; // …then K1 lands, failed, late
  const kept = g.catalog.held('/dep');
  assert.equal(kept.key, soulCatalogKey(CLI, moved)); assert.equal(kept.reason, null, 'the late K1 failure did not overwrite K2\'s good entry');
});

test('revalidate starts nothing while another key\'s flight is in the air: the cycle\'s read answers, and no stale-key read displaces it', async () => {
  const h = gated();
  const a = h.catalog.settle('/dep', CLI, WS); h.open(); await a.pending;
  h.tick(HELD_TTL_MS);
  const moved = { ...WS, workspace: { key: 'k', commit: 'c2' } };
  const cycle = h.catalog.settle('/dep', CLI, moved); // the state moved on; its read flies; the published entry still says WS
  assert.ok(cycle.pending); assert.equal(h.requests.length, 2);
  assert.equal(h.catalog.revalidate('/dep', CLI, WS), null, 'a request under the published (stale, old) key starts nothing');
  assert.equal(h.requests.length, 2, 'one flight per deployment');
  h.open(); const landed = await cycle.pending;
  assert.equal(landed.key, soulCatalogKey(CLI, moved)); assert.equal(h.catalog.refreshing('/dep'), false);
  assert.equal(h.catalog.settle('/dep', CLI, moved).pending, null, 'the next cycle finds the new key held: no duplicate read');
});
