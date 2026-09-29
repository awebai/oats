import test from 'node:test';
import assert from 'node:assert/strict';
import { createInspectCache, inspectKey, INSPECT_CACHE_LIMIT } from '../server/inspect-cache.mjs';
import { capabilityRequest } from '../server/capabilities.mjs';

const ok = (result = {}) => ({ schemaVersion: 1, ok: true, result });
const deferred = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const clock = (start = 1_700_000_000_000) => { let t = start; return { now: () => t, advance: ms => { t += ms; } }; };

test('inspectKey: every coordinate travels, absent ones as null, and the kind is checked', () => {
  const soul = inspectKey({ deployment: '/team', kind: 'soul', soul: 'dev', agentsRoot: '/team/agents', catalogKey: 'k1' });
  assert.deepEqual(JSON.parse(soul), ['/team', null, 'soul', 'dev', '/team/agents', 'k1', null, null, null]);
  assert.notEqual(soul, inspectKey({ deployment: '/team', kind: 'soul', soul: 'dev', agentsRoot: '/team/agents', catalogKey: 'k2' }));
  assert.notEqual(soul, inspectKey({ deployment: '/team', server: 'hetzner', kind: 'soul', soul: 'dev', agentsRoot: '/team/agents', catalogKey: 'k1' }));
  assert.notEqual(soul, inspectKey({ deployment: '/other', kind: 'soul', soul: 'dev', agentsRoot: '/team/agents', catalogKey: 'k1' }));
  const home = inspectKey({ deployment: '/team', kind: 'home', home: '/h', instance: 'dev-1', identity: ['c', undefined, 'dev', [{ id: 'm' }]] });
  assert.deepEqual(JSON.parse(home), ['/team', null, 'home', null, null, null, '/h', 'dev-1', ['c', null, 'dev', [{ id: 'm' }]]]);
  assert.notEqual(home, inspectKey({ deployment: '/team', kind: 'home', home: '/h', instance: 'dev-1', identity: ['c', 's', 'dev', [{ id: 'm' }]] }));
  assert.throws(() => inspectKey({ deployment: '/team', kind: 'run' }), { code: 'E_BAD_ARGS' });
  assert.equal(INSPECT_CACHE_LIMIT, 256);
});

test('LRU bound: the least recently used entry goes, and a hit refreshes recency', async () => {
  const cache = createInspectCache({ limit: 3, now: clock().now });
  let produced = 0;
  const read = (key, refresh = false) => cache.read(key, { deployment: '/d', refresh, produce: async () => { produced++; return ok({ key }); } });
  for (const key of ['a', 'b', 'c']) await read(key);
  assert.equal(cache.size(), 3);
  assert.equal((await read('a')).hit, true, 'a touched: b is now the oldest');
  await read('d');
  assert.equal(cache.size(), 3);
  assert.equal((await read('b')).hit, false, 'b was evicted');
  assert.equal((await read('a')).hit, true, 'a survived the eviction');
  assert.equal(produced, 5);
});

test('coalescing: two concurrent identical reads share one produce; refresh bypasses a settled entry but joins an in-flight one', async () => {
  const cache = createInspectCache({ now: clock().now });
  let produced = 0; let gate = deferred();
  const produce = async () => { produced++; await gate.promise; return ok({ n: produced }); };
  const first = cache.read('k', { deployment: '/d', produce }), second = cache.read('k', { deployment: '/d', produce });
  const third = cache.read('k', { deployment: '/d', refresh: true, produce });
  await tick(); assert.equal(produced, 1, 'one kernel process for three concurrent requests');
  gate.resolve();
  const results = await Promise.all([first, second, third]);
  assert.deepEqual(results.map(r => [r.hit, r.refreshing, r.envelope.result.n]), [[false, false, 1], [false, false, 1], [false, false, 1]]);
  // settled: a plain read hits; a refresh bypasses it and, while in flight, plain reads report refreshing
  gate = deferred();
  assert.equal((await cache.read('k', { deployment: '/d', produce })).hit, true);
  const refresh = cache.read('k', { deployment: '/d', refresh: true, produce });
  await tick(); assert.equal(produced, 2);
  const during = await cache.read('k', { deployment: '/d', produce });
  assert.deepEqual([during.hit, during.refreshing, during.envelope.result.n], [true, true, 1], 'the settled value is served while the refresh flies');
  const joined = cache.read('k', { deployment: '/d', refresh: true, produce });
  await tick(); assert.equal(produced, 2, 'a second refresh joins the flight');
  gate.resolve();
  assert.equal((await refresh).envelope.result.n, 2); assert.equal((await joined).envelope.result.n, 2);
  const after = await cache.read('k', { deployment: '/d', produce });
  assert.deepEqual([after.hit, after.refreshing, after.envelope.result.n], [true, false, 2]);
});

test('a failed produce stores nothing and the next read produces again; a thrown produce propagates and clears the flight', async () => {
  const cache = createInspectCache({ now: clock().now });
  let produced = 0;
  const failing = async () => { produced++; return { ok: false, error: { code: 'E_X', message: 'nope' } }; };
  const r = await cache.read('k', { deployment: '/d', produce: failing });
  assert.equal(r.envelope.ok, false); assert.equal(r.hit, false); assert.equal(cache.size(), 0);
  await cache.read('k', { deployment: '/d', produce: failing });
  assert.equal(produced, 2);
  await assert.rejects(cache.read('t', { deployment: '/d', produce: async () => { throw new Error('boom'); } }), /boom/);
  assert.equal((await cache.read('t', { deployment: '/d', produce: async () => ok({}) })).hit, false, 'the failed flight is not joined');
  assert.equal(cache.size(), 1);
});

test('invalidate(deployment) drops only that deployment, and a flight of an invalidated deployment does not store', async () => {
  const cache = createInspectCache({ now: clock().now });
  const produce = async () => ok({});
  await cache.read('a1', { deployment: '/a', produce }); await cache.read('a2', { deployment: '/a', produce }); await cache.read('b1', { deployment: '/b', produce });
  const gate = deferred();
  const flight = cache.read('a3', { deployment: '/a', produce: async () => { await gate.promise; return ok({ stale: true }); } });
  await tick();
  cache.invalidate('/a');
  assert.equal(cache.size(), 1); assert.equal((await cache.read('b1', { deployment: '/b', produce })).hit, true);
  gate.resolve(); const settled = await flight;
  assert.equal(settled.envelope.result.stale, true, 'the caller still gets its result');
  assert.equal((await cache.read('a3', { deployment: '/a', produce })).hit, false, 'the in-flight result was not stored');
  // clear() bumps every deployment, including one that is only in flight
  const gate2 = deferred();
  const flight2 = cache.read('c1', { deployment: '/c', produce: async () => { await gate2.promise; return ok({}); } });
  await tick(); cache.clear(); gate2.resolve(); await flight2;
  assert.equal(cache.size(), 0);
});

test('observedAt comes from the kernel observation when reported, else the completion clock; envelopes are independent clones', async () => {
  const c = clock();
  const cache = createInspectCache({ now: c.now });
  const reported = await cache.read('r', { deployment: '/d', produce: async () => ok({ observation: { observedAt: '2026-01-02T03:04:05.000Z', reused: true } }) });
  assert.equal(reported.observedAt, '2026-01-02T03:04:05.000Z');
  const gate = deferred();
  const flight = cache.read('n', { deployment: '/d', produce: async () => { await gate.promise; return ok({ observation: { observedAt: 42 } }); } });
  c.advance(1000); gate.resolve();
  assert.equal((await flight).observedAt, new Date(c.now()).toISOString(), 'a non-string observedAt falls back to the completion time');
  assert.equal((await cache.read('n', { deployment: '/d', produce: async () => ok({}) })).observedAt, new Date(c.now()).toISOString());
  const one = await cache.read('r', { deployment: '/d', produce: async () => ok({}) });
  one.envelope.result.observation.reused = 'mutated'; one.envelope.result.extra = 1;
  const two = await cache.read('r', { deployment: '/d', produce: async () => ok({}) });
  assert.equal(two.envelope.result.observation.reused, true); assert.equal('extra' in two.envelope.result, false);
});

// Through the capability boundary with a fake invoke.
const cli = { ok: true, bin: '/installed/oats', operationsApi: 2, features: ['operations', 'observe-max-age'] };
const workspace = { id: '/team', scope: '/team' };
const agentsRoot = '/team/agents';
const agents = [{ name: 'dev', agentsRoot, workspace: '/team' }];
const home = '/team/agents/dev/instances/dev-seat';
const instance = { instance: 'dev-seat', home, agentsRoot, savedRoute: true, createdAt: '2026-01-01T00:00:00Z', startedAt: '2026-01-01T01:00:00Z', soul: { source: 'config' }, modules: [] };
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function boundary({ cache = createInspectCache(), catalogKey = 'cat-1', maxAge = 30, instances = [instance] } = {}) {
  if (cache === null) cache = undefined; // an explicit null means "no cache in ctx"
  const calls = []; let gate = null;
  const invoke = async (bin, options) => {
    calls.push(options);
    if (gate) await gate.promise;
    return ok(options.action === 'inspect' ? { subject: { kind: options.home ? 'instance' : 'soul' }, capabilities: [], observation: { observedAt: '2026-02-02T00:00:00.000Z', reused: false } } : { operation: options.operation });
  };
  const ctx = { workspace, cli, agents, instances, localCwd: '/team', invoke, cache, catalogKey, maxAge };
  return { calls, ctx, cache, hold() { gate = deferred(); return gate; }, release() { gate?.resolve(); gate = null; },
    inspect: (selector, extra = {}, override = {}) => capabilityRequest({ action: 'inspect', selector, ...extra }, { ...ctx, ...override }) };
}
const soulSelector = { soul: 'dev', agentsRoot };

test('capabilityRequest: identical concurrent inspects share one invoke and every result carries observedAt and refreshing', async () => {
  const b = boundary(); b.hold();
  const pair = [b.inspect(soulSelector), b.inspect(soulSelector)];
  await tick(); assert.equal(b.calls.length, 1);
  b.release();
  for (const result of await Promise.all(pair)) {
    assert.equal(result.observedAt, '2026-02-02T00:00:00.000Z'); assert.equal(result.refreshing, false);
    assert.equal(result.subject.kind, 'soul'); assert.deepEqual(result.capabilities, []);
  }
  assert.deepEqual(b.calls[0], { action: 'inspect', context: '/team', server: undefined, soul: 'dev', agentsRoot, home: undefined, operation: undefined, localCwd: '/team', maxAge: 30, features: cli.features });
  const results = await Promise.all(pair);
  results[0].capabilities.push('x'); assert.deepEqual(results[1].capabilities, [], 'callers never share a mutable result');
});

test('capabilityRequest: a settled soul entry is served without invoke; another catalog key, an identity change or refresh reach the kernel', async () => {
  const b = boundary();
  await b.inspect(soulSelector); await b.inspect(soulSelector);
  assert.equal(b.calls.length, 1, 'same soul and catalog: no second process');
  await b.inspect(soulSelector, {}, { catalogKey: 'cat-2' });
  assert.equal(b.calls.length, 2, 'a changed catalog is another subject');
  await b.inspect({ home }); await b.inspect({ home });
  assert.equal(b.calls.length, 3); assert.equal(b.calls[2].home, home); assert.equal(b.calls[2].context, undefined);
  await b.inspect({ home }, {}, { instances: [{ ...instance, startedAt: '2026-01-01T02:00:00Z' }] });
  assert.equal(b.calls.length, 4, 'a restarted seat is another subject');
  const refreshed = await b.inspect(soulSelector, { refresh: true });
  assert.equal(b.calls.length, 5); assert.equal(b.calls[4].maxAge, 0, 'refresh asks the kernel for a live observation');
  assert.equal(refreshed.refreshing, false); assert.match(refreshed.observedAt, ISO);
  assert.equal(b.calls[0].maxAge, 30, 'a miss carries the configured max-age');
  await b.inspect(soulSelector, {}, { maxAge: undefined, catalogKey: 'cat-3' });
  assert.equal(Object.hasOwn(b.calls[5], 'maxAge'), false, 'no configured max-age: the key is absent, not undefined');
  await assert.rejects(b.inspect(soulSelector, { refresh: 'yes' }), { code: 'E_BAD_ARGS' });
});

test('capabilityRequest: a run never touches the cache, invalidates its deployment (success or failure) and refuses refresh', async () => {
  const b = boundary();
  await b.inspect({ home }); await b.inspect(soulSelector);
  assert.equal(b.cache.size(), 2);
  const run = await capabilityRequest({ action: 'run', selector: { home }, operation: 'knowledge:reindex' }, b.ctx);
  assert.deepEqual(run, { operation: 'knowledge:reindex' }, 'a run result is the kernel result, no observation fields');
  assert.equal(b.calls.at(-1).action, 'run'); assert.equal(Object.hasOwn(b.calls.at(-1), 'maxAge'), false, 'mutating verbs never take --max-age');
  assert.equal(b.cache.size(), 0, 'the deployment was invalidated');
  await b.inspect({ home }); assert.equal(b.calls.length, 4, 'after a run the home is inspected again');
  const failing = { ...b.ctx, invoke: async () => ({ ok: false, error: { code: 'E_OPERATION_FAILED', message: 'no' } }) };
  await assert.rejects(capabilityRequest({ action: 'run', selector: { home }, operation: 'knowledge:reindex' }, failing), { code: 'E_OPERATION_FAILED' });
  assert.equal(b.cache.size(), 0, 'a failed run invalidates too');
  await assert.rejects(capabilityRequest({ action: 'run', selector: { home }, operation: 'knowledge:reindex', refresh: true }, b.ctx), { code: 'E_BAD_ARGS' });
  await assert.rejects(capabilityRequest({ action: 'run', selector: { home }, operation: 'knowledge:reindex', refresh: false }, b.ctx), { code: 'E_BAD_ARGS' });
});

test('capabilityRequest without a cache: every inspect reaches the kernel and still reports observedAt and refreshing', async () => {
  const b = boundary({ cache: null });
  const one = await b.inspect(soulSelector), two = await b.inspect(soulSelector);
  assert.equal(b.calls.length, 2);
  assert.equal(one.observedAt, '2026-02-02T00:00:00.000Z'); assert.equal(two.refreshing, false);
  const plain = { ...b.ctx, invoke: async () => ok({ capabilities: [] }) };
  const result = await capabilityRequest({ action: 'inspect', selector: soulSelector }, plain);
  assert.match(result.observedAt, ISO, 'no kernel observation: the completion time');
  // failures keep their shaping through the cache path too
  const conflict = { ...b.ctx, invoke: async () => ({ ok: false, error: { code: 'E_TEAM_CONFLICT', message: 'two labels', details: { labels: ['engineering', 'global'] } } }) };
  await assert.rejects(capabilityRequest({ action: 'inspect', selector: soulSelector }, { ...conflict, catalogKey: 'fresh' }), e => e.code === 'E_TEAM_CONFLICT' && e.labels.join() === 'engineering,global');
});
