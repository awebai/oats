// The dialog's settled-answer cache in front of the spawn preview (Spec B, seamless spawn form):
// keyed by the admission identity, 60 s, answers and name refusals only, re-admitted against the
// current context, dropped per workspace on invalidation, never refilled by a flight that was in
// the air across one; prepare reads through the same cache (Spec C: apply's --expect-decision guards drift).
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
test('Spec C: prepare takes a fresh held answer for exactly these choices without a CLI call; after invalidation, the TTL or for other choices it reads fresh', async () => {
  const f = fixture();
  const broker = createSpawnApplyBoundary({ read: f.read, invoke: assert.fail });
  const prepare = choices => broker({ action: 'prepare', selector, choices: choices ?? {} }, () => f.c);
  await f.send(); assert.equal(f.calls.length, 1, 'the dialog read');
  assert.equal((await prepare()).status, 'prepared'); assert.equal(f.calls.length, 1, 'a cache hit: no second kernel process');
  assert.equal((await prepare({ purpose: 'other' })).status, 'prepared'); assert.equal(f.calls.length, 2, 'another identity reads fresh');
  f.cache.invalidate(f.c.workspace.id);
  assert.equal((await prepare()).status, 'prepared'); assert.equal(f.calls.length, 3, 'after an invalidation it reads fresh');
  f.advance(PREVIEW_CACHE_TTL_MS);
  assert.equal((await prepare()).status, 'prepared'); assert.equal(f.calls.length, 4, 'past the TTL it reads fresh');
  // An uncached boundary (no cache) is what every read was before: always the kernel.
  const fresh = createSpawnPreviewBoundary({ invoke: f.invoke });
  await fresh(request(), () => f.c); assert.equal(f.calls.length, 5);
});
test('the shipped wiring: the dialog route and prepare both read through the one cache; only the dialog reuses member heads (--max-age 60)', () => {
  const web = readFileSync(new URL('../server/oats-web.mjs', import.meta.url), 'utf8');
  const route = web.slice(web.indexOf("if (path === '/api/workspace-spawn-preview'"), web.indexOf("if (path === '/api/workspace-readiness'"));
  assert.match(route, /await spawnPreviewCachedRequest\(request, getContext\)/);
  const apply = readFileSync(new URL('../server/spawn-apply.mjs', import.meta.url), 'utf8');
  assert.match(apply, /read = spawnPreviewPrepareRequest\b/);
  const preview = readFileSync(new URL('../server/spawn-preview.mjs', import.meta.url), 'utf8');
  assert.match(preview, /export const spawnPreviewCachedRequest = createSpawnPreviewBoundary\(\{ cache: spawnPreviewCache, maxAge: PREVIEW_MAX_AGE_S \}\);/);
  assert.match(preview, /export const spawnPreviewPrepareRequest = createSpawnPreviewBoundary\(\{ cache: spawnPreviewCache \}\);/);
  assert.match(preview, /export const PREVIEW_MAX_AGE_S = 60;/);
});
test('the shipped invalidation hooks: every mutation Desktop observes drops the workspace\'s held previews', () => {
  const web = readFileSync(new URL('../server/oats-web.mjs', import.meta.url), 'utf8');
  const block = (from, to) => { const start = web.indexOf(from); assert.ok(start > 0, from); return web.slice(start, web.indexOf(to, start)); };
  // observeMutation: spawn apply, local lifecycle apply, workspace sync, start/restart all call it.
  assert.match(block('function observeMutation(', '\n}\n'), /spawnPreviewCache\.invalidate\(wsId\)/);
  assert.match(block("path === '/api/workspace-teams'", "path === '/api/instance-lifecycle'"), /spawnPreviewCache\.invalidate\(id\)/);
  assert.match(block('path === "/api/launch-configs"', 'path === "/api/forge-connections"'), /\['set', 'remove'\]\.includes\(request\?\.action\)\) spawnPreviewCache\.invalidate\(workspace\.id\)/);
  assert.match(block('path === "/api/capabilities"', "path === '/api/automations'"), /request\?\.action === "run"\) spawnPreviewCache\.invalidate\(workspace\.id\)/);
  assert.match(block('async function reprobeCli(', '\n}\n'), /inspectCache\.clear\(\);.*spawnPreviewCache\.invalidate\(\)/);
  // /api/spawn apply: held previews go when it starts (before the broker runs) and again when it ends.
  const spawn = block('if (req.method === "POST" && path === "/api/spawn")', 'const remoteRequest');
  assert.ok(spawn.indexOf("spawnPreviewCache.invalidate(url.searchParams.get('ws'))") > 0 && spawn.indexOf("spawnPreviewCache.invalidate(url.searchParams.get('ws'))") < spawn.indexOf('await spawnApplyRequest(body'), 'invalidated before the apply runs');
  assert.match(spawn.slice(spawn.indexOf('await spawnApplyRequest(body')), /body\.action === 'apply'\) \{ try \{ observeMutation\(/);
  for (const [from, to] of [["request.action === 'apply' && ['complete'", 'return send'], ['request?.action === "sync" && result.status === "ok"', '}']])
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

test('--max-age (feature spawn-preview-max-age): the dialog\'s reads pass it only when the CLI advertises it; prepare\'s reads never; the two never coalesce', async () => {
  const seen = [], gate = deferred();
  const invoke = async (cli, opts) => { seen.push(opts); if (opts.maxAge) await gate.promise; return envelope(data()); };
  const cache = createSpawnPreviewCache();
  const dialog = createSpawnPreviewBoundary({ invoke, cache, maxAge: 60 }), prepare = createSpawnPreviewBoundary({ invoke, cache });
  const plain = context(), featured = context(); featured.cli.features = [...featured.cli.features, 'spawn-preview-max-age'];
  await dialog(request(), () => plain).catch(() => {}); // no feature: no flag (not gated on the gate either)
  assert.equal(Object.hasOwn(seen[0], 'maxAge'), false, 'an older kernel refuses the flag: never sent without the feature');
  const reusing = dialog(request({ purpose: 'a' }), () => featured); await tick();
  assert.equal(seen[1].maxAge, 60);
  const live = prepare(request({ purpose: 'a' }), () => featured); await tick();
  assert.equal(seen.length, 3, 'prepare does not ride on the reusing read in the air'); assert.equal(Object.hasOwn(seen[2], 'maxAge'), false);
  gate.resolve(); await reusing; await live;
});
test('the adapter: --max-age <s> in the argv only with the feature; a bad value refuses before any process', async () => {
  const { cliSpawnPreview } = await import('../spawn-preview-cli.mjs');
  const c = context(), argvs = [];
  const io = { env: {}, exec: (_bin, argv, _o, cb) => { argvs.push(argv); cb(null, JSON.stringify(envelope(data()))); } };
  const target = { workspace: c.workspace.id, context: c.workspace.scope, selector };
  await cliSpawnPreview(c.cli, { target, choices: {}, maxAge: 60 }, io);
  assert.equal(argvs[0].includes('--max-age'), false, 'no feature, no flag');
  const featured = { ...c.cli, features: [...c.cli.features, 'spawn-preview-max-age'] };
  await cliSpawnPreview(featured, { target, choices: {}, maxAge: 60 }, io);
  assert.deepEqual(argvs[1].slice(argvs[1].indexOf('--max-age'), argvs[1].indexOf('--max-age') + 2), ['--max-age', '60']); assert.equal(argvs[1].at(-1), '--json');
  await cliSpawnPreview(featured, { target, choices: {} }, io);
  assert.equal(argvs[2].includes('--max-age'), false, 'a read without maxAge (prepare) never passes it');
  for (const bad of [0, -1, 1.5, '60', 3601]) assert.equal((await cliSpawnPreview(featured, { target, choices: {}, maxAge: bad }, io)).error.code, 'E_BAD_ARGS');
  assert.equal(argvs.length, 3);
});
test('the projection tolerates the reuse observation block (drops it, never refuses)', async () => {
  const { previewData, previewTarget } = await import('../renderer/spawn-preview-contract.mjs');
  const c = context(), t = previewTarget({ workspace: c.workspace.id, context: c.workspace.scope, selector });
  const v = { ...data(), observation: { observedAt: '2026-09-30T10:00:00.000Z', reused: true, localRevision: 'abc' } };
  const projected = previewData(v, t); assert.ok(projected); assert.equal(Object.hasOwn(projected, 'observation'), false);
});
