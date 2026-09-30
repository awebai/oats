// The dialog's settled-answer cache in front of the spawn preview (Spec B, seamless spawn form):
// keyed by the admission identity, 60 s, answers and name refusals only, re-admitted against the
// current context, dropped per workspace on invalidation, never refilled by a flight that was in
// the air across one; prepare reads through the uncached boundary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSpawnPreviewBoundary, createSpawnPreviewCache, PREVIEW_CACHE_TTL_MS } from '../server/spawn-preview.mjs';
import { createSpawnApplyBoundary } from '../server/spawn-apply.mjs';
import { selector, context, request, data, envelope, deferred, tick } from './helpers/spawn-preview-fixture.mjs';

function fixture({ reply = () => envelope(data()), ttlMs, limit } = {}) {
  let time = 0; const calls = [];
  const invoke = async (cli, opts) => { calls.push(opts); return reply(opts); };
  const cache = createSpawnPreviewCache({ now: () => time, ...(ttlMs ? { ttlMs } : {}), ...(limit ? { limit } : {}) });
  const c = context();
  return { c, calls, cache, invoke, read: createSpawnPreviewBoundary({ invoke, cache }), send(choices, ctx = c) { return this.read(request(choices), () => ctx); }, advance: ms => { time += ms; } };
}
const refusal = code => () => ({ schemaVersion: 1, ok: false, error: { code, message: `refused: ${code}` } });

test('a hit within the TTL runs no second kernel process and answers an equal, independent copy', async () => {
  const f = fixture();
  const first = await f.send(); assert.equal(first.status, 'available');
  f.advance(PREVIEW_CACHE_TTL_MS - 1);
  const second = await f.send(); assert.deepEqual(second, first); assert.equal(f.calls.length, 1);
  second.data.instance = 'changed-by-caller';
  assert.notEqual((await f.send()).data.instance, 'changed-by-caller', 'the held answer is not the caller\'s object');
  assert.equal(f.cache.size(), 1);
});
test('at the TTL the answer is a miss and the kernel is asked again', async () => {
  const f = fixture();
  await f.send(); f.advance(PREVIEW_CACHE_TTL_MS); await f.send(); assert.equal(f.calls.length, 2);
  await f.send(); assert.equal(f.calls.length, 2, 'the re-read is held again');
});
test('a name refusal is held; other refusals are not', async () => {
  for (const code of ['E_INSTANCE_NAME_TAKEN', 'E_INSTANCE_NAME_INVALID']) {
    const f = fixture({ reply: refusal(code) });
    const a = await f.send({ name: 'taken' }), b = await f.send({ name: 'taken' });
    assert.equal(a.reason.code, code); assert.deepEqual(b, a); assert.equal(f.calls.length, 1, code);
  }
  for (const code of ['E_CHILD_SPAWNS_DISABLED', 'E_CLONE_MISSING']) {
    const f = fixture({ reply: refusal(code) });
    await f.send(); await f.send(); assert.equal(f.calls.length, 2, code);
  }
  const failing = fixture({ reply: () => { throw Error('PRIVATE'); } });
  assert.equal((await failing.send()).reason.code, 'E_CLI_FAILED'); await failing.send(); assert.equal(failing.calls.length, 2, 'E_CLI_FAILED is not held');
  const malformed = fixture({ reply: () => envelope({}) });
  assert.equal((await malformed.send()).reason.code, 'E_CLI_PROTOCOL'); await malformed.send(); assert.equal(malformed.calls.length, 2, 'E_CLI_PROTOCOL is not held');
});
test('E_BUSY and E_TARGET_CHANGED are never held', async () => {
  const gates = [], f = fixture({ reply: () => { const d = deferred(); gates.push(d); return d.promise; } });
  const a = f.send({ purpose: 'one' }), b = f.send({ purpose: 'two' }); await tick(); assert.equal(gates.length, 2);
  assert.equal((await f.send({ purpose: 'three' })).reason.code, 'E_BUSY');
  gates[0].resolve(envelope(data())); gates[1].resolve(envelope(data())); await a; await b;
  const third = f.send({ purpose: 'three' }); await tick(); assert.equal(gates.length, 3, 'the busy refusal was not held'); gates[2].resolve(envelope(data())); await third;
  const late = f.send({ purpose: 'four' }); await tick(); f.c.cli.version = '9.9.9'; gates[3].resolve(envelope(data()));
  assert.equal((await late).reason.code, 'E_TARGET_CHANGED'); f.c.cli.version = context().cli.version;
  const again = f.send({ purpose: 'four' }); await tick(); assert.equal(gates.length, 5, 'a changed target is not held'); gates[4].resolve(envelope(data())); await again;
});
test('invalidate(ws) drops that workspace\'s answers; another workspace\'s invalidation does not', async () => {
  const f = fixture();
  await f.send(); f.cache.invalidate('elsewhere'); await f.send(); assert.equal(f.calls.length, 1);
  f.cache.invalidate('northwind'); assert.equal(f.cache.size(), 0); await f.send(); assert.equal(f.calls.length, 2);
  await f.send(); assert.equal(f.calls.length, 2, 'held again after the fresh read');
});
test('invalidate() with no workspace drops every answer', async () => {
  const f = fixture();
  await f.send({ purpose: 'a' }); await f.send({ purpose: 'b' }); assert.equal(f.cache.size(), 2);
  f.cache.invalidate(); assert.equal(f.cache.size(), 0);
  await f.send({ purpose: 'a' }); assert.equal(f.calls.length, 3);
});
for (const scope of ['northwind', undefined]) test(`a flight in the air across an invalidation (${scope ?? 'all'}) answers its caller but is never held`, async () => {
  const gate = deferred(), f = fixture({ reply: () => gate.promise });
  const pending = f.send(); await tick(); f.cache.invalidate(scope); gate.resolve(envelope(data()));
  assert.equal((await pending).status, 'available'); assert.equal(f.cache.size(), 0);
});
test('a request that joins a flight started before the invalidation does not fill the cache either', async () => {
  const gate = deferred(), f = fixture({ reply: () => gate.promise });
  const early = f.send(); await tick(); f.cache.invalidate('northwind');
  const joined = f.send(); await tick(); assert.equal(f.calls.length, 1, 'coalesced onto the one flight');
  gate.resolve(envelope(data())); await early; await joined;
  assert.equal(f.cache.size(), 0);
});
test('the uncached boundary (prepare\'s read) always reaches the kernel, even with the answer held', async () => {
  const f = fixture(), fresh = createSpawnPreviewBoundary({ invoke: f.invoke });
  await f.send(); await f.send(); assert.equal(f.calls.length, 1);
  await fresh(request(), () => f.c); await fresh(request(), () => f.c); assert.equal(f.calls.length, 3);
  // Prepare through the apply broker with that uncached read: a fresh kernel preview every time.
  const broker = createSpawnApplyBoundary({ read: fresh, invoke: assert.fail });
  const prepared = await broker({ action: 'prepare', selector, choices: {} }, () => f.c);
  assert.equal(prepared.status, 'prepared'); assert.equal(f.calls.length, 4);
});
test('the shipped wiring: the dialog route reads through the cache, prepare through the uncached reader', () => {
  const web = readFileSync(new URL('../server/oats-web.mjs', import.meta.url), 'utf8');
  const route = web.slice(web.indexOf("if (path === '/api/workspace-spawn-preview'"), web.indexOf("if (path === '/api/workspace-readiness'"));
  assert.match(route, /await spawnPreviewCachedRequest\(request, getContext\)/); assert.doesNotMatch(route, /spawnPreviewRequest\(/);
  const apply = readFileSync(new URL('../server/spawn-apply.mjs', import.meta.url), 'utf8');
  assert.match(apply, /read = spawnPreviewRequest\b/); assert.doesNotMatch(apply, /Cached|spawnPreviewCache/);
  const preview = readFileSync(new URL('../server/spawn-preview.mjs', import.meta.url), 'utf8');
  assert.match(preview, /export const spawnPreviewRequest = createSpawnPreviewBoundary\(\);/);
});
test('the shipped invalidation hooks: every mutation Desktop observes drops the workspace\'s held previews', () => {
  const web = readFileSync(new URL('../server/oats-web.mjs', import.meta.url), 'utf8');
  const block = (from, to) => { const start = web.indexOf(from); assert.ok(start > 0, from); return web.slice(start, web.indexOf(to, start)); };
  // observeMutation: spawn apply, local lifecycle apply, workspace sync, start/restart all call it.
  assert.match(block('function observeMutation(', '\n}\n'), /spawnPreviewCache\.invalidate\(wsId\)/);
  assert.match(block("path === '/api/workspace-teams'", "path === '/api/instance-lifecycle'"), /spawnPreviewCache\.invalidate\(id\)/);
  assert.match(block('path === "/api/launch-configs"', 'path === "/api/forge-connections"'), /\['set', 'remove'\]\.includes\(request\?\.action\)\) spawnPreviewCache\.invalidate\(workspace\.id\)/);
  assert.match(block('path === "/api/capabilities"', "path === '/api/automations'"), /request\?\.action === "run"\) spawnPreviewCache\.invalidate\(workspace\.id\)/);
  assert.match(block('operation: "knowledge:harvest"', 'return send(res, 200, result)'), /spawnPreviewCache\.invalidate\(workspace\.id\)/);
  assert.match(block('async function reprobeCli(', '\n}\n'), /inspectCache\.clear\(\);.*spawnPreviewCache\.invalidate\(\)/);
  for (const [from, to] of [['if (body.action === \'apply\')', '\n'], ["request.action === 'apply' && ['complete'", 'return send'], ['request?.action === "sync" && result.status === "ok"', '}']])
    assert.match(block(from, to), /observeMutation\(/, from);
});
test('a changed context misses: another CLI version is another identity', async () => {
  const f = fixture();
  await f.send(); const newer = context(); newer.cli.version = '9.9.9';
  await f.send(undefined, newer); assert.equal(f.calls.length, 2);
});
test('a held answer is re-admitted first: a context that no longer admits refuses instead of hitting', async () => {
  const f = fixture();
  await f.send(); f.c.agents = [];
  const refused = await f.send(); assert.equal(refused.status, 'unavailable'); assert.equal(refused.reason.code, 'E_SOUL_UNKNOWN'); assert.equal(f.calls.length, 1);
});
test('the cache is bounded: past the limit the oldest answer goes', async () => {
  const f = fixture({ limit: 2 });
  await f.send({ purpose: 'a' }); await f.send({ purpose: 'b' }); await f.send({ purpose: 'c' }); assert.equal(f.cache.size(), 2);
  await f.send({ purpose: 'c' }); await f.send({ purpose: 'b' }); assert.equal(f.calls.length, 3, 'b and c held');
  await f.send({ purpose: 'a' }); assert.equal(f.calls.length, 4, 'a was evicted');
});
