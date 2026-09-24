import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import { apiUrl, classifyApiRoute } from '../api-url.mjs';
import { proxySpawnApply } from '../spawn-apply-proxy.mjs';
import { createSpawnApplyBoundary } from '../server/spawn-apply.mjs';
import { spawnApplyFailure, spawnApplyView } from '../renderer/spawn-apply-contract.mjs';
import { selector, target, deferred } from './helpers/spawn-preview-fixture.mjs';
import { applyContext, applyPreview, creation, envelope } from './helpers/spawn-apply-fixture.mjs';
const ref = 'a'.repeat(64);
const prepared = () => ({ spawnApplyViewApi: 1, status: 'prepared', target, spawnRef: ref, preview: applyPreview(target), wakeRequested: false, receipt: null, reason: null });
const draft = () => ({ action: 'prepare', selector, choices: {}, task: 'PRIVATE task' });
function http() {
  const source = readFileSync(new URL('../server/oats-web.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('const send = (res, code, body, type'), end = source.indexOf('\nserver.on("error",');
  const c = applyContext(), reads = [], calls = [], serverSpawns = []; let nonce = 0;
  const broker = createSpawnApplyBoundary({ mint: () => (++nonce).toString(16).padStart(64, '0'),
    read: request => { reads.push(request); return { status: 'available', data: applyPreview(target) }; },
    invoke: (_cli, args) => { calls.push(args); return { started: true, envelope: envelope(creation(applyPreview(args.target))) }; } });
  const deps = { createServer: fn => fn, spawnApplyFailure, spawnApplyRequest: broker,
    spawnAgent: async body => { serverSpawns.push(body); return { instance: 'dev-1', home: '/fixture/dev-1', agent: 'dev', launched: true }; },
    spawnErrorPayload: () => assert.fail('unexpected execution-server error'), workspaces: () => [c.workspace], cliState: c.cli,
    agentsData: () => ({ agents: c.agents }), snapshot: { byWs: new Map([['northwind', { instances: c.instances }]]) } };
  const handler = new Function(...Object.keys(deps), `${source.slice(start, end)}\nreturn server;`)(...Object.values(deps));
  return { c, reads, calls, serverSpawns, async request({ url = '/api/spawn?ws=northwind', method = 'POST', body = draft(), headers = { host: 'localhost:4820', origin: 'http://localhost:4820' } } = {}) {
    const req = new EventEmitter(); Object.assign(req, { url, method, headers }); let result;
    const res = { writeHead(status, headers) { result = { status, headers }; }, end(text) { result.body = JSON.parse(text); } };
    const done = handler(req, res); req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))); req.emit('end'); await done; return result;
  } };
}
test('shipped HTTP enforces host/origin, method, query and bounded strict JSON before effect', async () => {
  const h = http();
  for (const headers of [{}, { host: 'evil' }, { host: 'localhost', origin: 'https://evil' }, { host: 'localhost', origin: 'null' }]) assert.equal((await h.request({ headers })).status, 403);
  assert.equal((await h.request({ method: 'GET' })).status, 404);
  for (const url of ['/api/spawn', '/api/spawn?ws=', '/api/spawn?ws=northwind&ws=northwind', '/api/spawn?ws=northwind&other=1']) assert.equal((await h.request({ url })).status, 400);
  for (const body of ['{', 'null', '[]', ' '.repeat(65537)]) assert.equal((await h.request({ body })).status, 400);
  assert.equal(h.calls.length + h.reads.length + h.serverSpawns.length, 0);
  const p = await h.request(); assert.equal(p.body.status, 'prepared'); assert.equal(p.headers['cache-control'], 'no-store'); assert.equal(h.reads.length, 1); assert.equal(h.calls.length, 0);
});
test('HTTP prepare/ref-only apply/result is the real broker, not the execution-server spawn route', async () => {
  const h = http(), p = (await h.request()).body;
  assert.equal((await h.request({ body: { action: 'result', spawnRef: p.spawnRef } })).body.status, 'prepared'); assert.equal(h.calls.length, 0);
  assert.equal((await h.request({ body: { action: 'apply', spawnRef: p.spawnRef, task: 'replace' } })).body.reason.code, 'E_BAD_ARGS');
  const r = (await h.request({ body: { action: 'apply', spawnRef: p.spawnRef } })).body;
  assert.equal(r.status, 'complete'); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].task, 'PRIVATE task'); assert.doesNotMatch(JSON.stringify(r), /PRIVATE/);
  await h.request({ body: { action: 'apply', spawnRef: p.spawnRef } }); await h.request({ body: { action: 'result', spawnRef: p.spawnRef } });
  assert.equal(h.calls.length, 1); assert.equal(h.serverSpawns.length, 0);
});
test('every local raw request requires the plan, whatever the CLI; only a real execution-server id reaches the unguarded route', async () => {
  const h = http(), body = { agent: 'release-manager', agentsRoot: '/fixture/base/northwind-workspace/agents', task: 'ordinary' };
  for (const serverId of [undefined, '', null, [], {}, '--json', 1]) {
    const r = await h.request({ body: { ...body, serverId } }); assert.equal(r.status, 409); assert.equal(r.body.code, 'E_PLAN_REQUIRED');
  }
  delete h.c.cli.spawnApplyApi;
  assert.equal((await h.request({ body })).body.code, 'E_PLAN_REQUIRED', 'no unguarded local spawn for an older CLI either');
  assert.equal(h.serverSpawns.length, 0);
  assert.equal((await h.request({ body: { ...body, serverId: 'remote-host' } })).body.spawned, true); assert.equal(h.serverSpawns.length, 1);
  for (const extra of [{ branch: 'x' }, { base: 'HEAD' }, { work: 'worktree' }, { idempotencyKey: ref }, { spawnRef: ref }, { decision: {} }, { model: '@native-default' }])
    assert.equal((await h.request({ body: { ...body, serverId: 'remote-host', ...extra } })).body.code, 'E_UNSUPPORTED_OPTION');
  assert.equal(h.serverSpawns.length, 1); assert.equal((await h.request()).body.reason.code, 'E_APPLY_UNAVAILABLE');
});
function proxy(fetch) {
  const renderer = 'file:///fixture/index.html', frame = { url: renderer }, event = { senderFrame: frame, sender: { mainFrame: frame, isDestroyed: () => false } };
  const connection = { base: 'http://localhost:4820', wsId: 'northwind', allowedWs: new Set(['northwind']), epoch: 0, transition: false };
  return { event, connection, deps: { rendererURL: renderer, connection: () => connection, fetch }, opts: { method: 'POST', body: draft() } };
}
const aliases = ['/api/spawn', '/api/./spawn', '/api/x/../spawn', '/api/%2e/spawn', '/api' + String.fromCharCode(92) + 'spawn', '/a\tpi/spawn'];
test('main composition normalizes all spawn aliases to specialized guard, including the execution-server body', async () => {
  const source = readFileSync(new URL('../main.mjs', import.meta.url), 'utf8'), start = source.indexOf('ipcMain.handle("api",'), end = source.indexOf('// ---- IPC: workstation forge auth', start);
  let handler, calls = 0;
  const f = proxy(async () => { calls++; return { ok: true, status: 200, text: async () => JSON.stringify(prepared()) }; });
  const deps = { ipcMain: { handle: (_n, fn) => handler = fn }, classifyApiRoute, RENDERER_URL: f.deps.rendererURL,
    proxySpawnApply: (e, path, opts, d) => proxySpawnApply(e, path, opts, { ...d, fetch: f.deps.fetch }), base: () => f.connection.base,
    wsId: 'northwind', allowedWs: f.connection.allowedWs, serverEpoch: 0, serverHost: { inTransition: () => false },
    forgeFailure: () => ({}), lifecycleFailure: () => ({}), guard: () => assert.fail('spawn must use specialized guard') };
  runInNewContext(source.slice(start, end), deps);
  for (const pathname of aliases) {
    assert.equal(classifyApiRoute(pathname, f.connection.base), 'spawn-apply');
    for (const body of [draft(), { agent: 'dev', agentsRoot: '/team/agents' }]) assert.equal((await handler({ ...f.event, senderFrame: { url: f.deps.rendererURL } }, pathname, { method: 'POST', body })).body.reason.code, 'E_FORBIDDEN_FRAME');
  }
  assert.equal(calls, 0); assert.equal((await handler(f.event, '/api/./spawn', f.opts)).body.status, 'prepared'); assert.equal(calls, 1);
});
for (const action of ['prepare', 'apply', 'result', 'server']) for (const reject of [false, true]) for (const change of ['frame', 'navigation', 'epoch', 'base']) test(`${action} guards late ${reject ? 'rejection' : 'success'} after ${change}`, async () => {
  const d = deferred(), f = proxy(() => d.promise);
  const body = action === 'prepare' ? draft() : action === 'server' ? { agent: 'dev', agentsRoot: '/team/agents' } : { action, spawnRef: ref };
  const pending = proxySpawnApply(f.event, '/api/spawn', { method: 'POST', body }, f.deps);
  if (change === 'frame') f.event.sender.mainFrame = { url: f.deps.rendererURL };
  if (change === 'navigation') f.event.senderFrame.url = 'https://evil';
  if (change === 'epoch') f.connection.epoch++;
  if (change === 'base') f.connection.base = 'http://localhost:4830';
  if (reject) d.reject(Error('PRIVATE')); else d.resolve({ ok: true, status: 200, text: async () => JSON.stringify(prepared()) });
  const r = await pending, mutation = action === 'apply' || action === 'server';
  assert.equal(r.body.status, mutation ? 'unknown' : 'unavailable'); assert.equal(r.body.reason.code, mutation ? 'E_OUTCOME_UNKNOWN' : ['frame', 'navigation'].includes(change) ? 'E_FORBIDDEN_FRAME' : 'E_PLAN_CHANGED');
  assert.doesNotMatch(JSON.stringify(r), /PRIVATE/);
});
test('workspace duplicates survive pinning and are refused before fetch; output targets/refs are bound', async () => {
  assert.deepEqual(apiUrl('/api/spawn?ws=northwind&ws=other', 'http://localhost:4820', 'northwind').searchParams.getAll('ws'), ['northwind', 'other']);
  const f = proxy(assert.fail);
  for (const path of ['/api/spawn?ws=northwind&ws=other', '/api/spawn?ws=northwind&extra=1', '//evil/api/spawn']) assert.equal((await proxySpawnApply(f.event, path, f.opts, f.deps)).ok, false);
  for (const alter of [p => p.target.workspace = 'other', p => p.target.selector.soul = 'other', p => p.preview.decision.effective.model = 'other']) {
    const p = prepared(); p.target = structuredClone(target); alter(p); const f = proxy(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(p) }));
    assert.equal((await proxySpawnApply(f.event, '/api/spawn', f.opts, f.deps)).body.reason.code, 'E_CLI_PROTOCOL');
  }
  const p = prepared(); p.spawnRef = 'b'.repeat(64); const mismatch = proxy(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(p) }));
  assert.equal((await proxySpawnApply(mismatch.event, '/api/spawn', { method: 'POST', body: { action: 'apply', spawnRef: ref } }, mismatch.deps)).body.status, 'unknown');
});
test('an execution-server response survives, new typed output cannot leak recipes/private extras', async () => {
  const served = { spawned: true, instance: 'dev-1', home: '/fixture/dev-1', launched: true };
  const f = proxy(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(served) }));
  assert.deepEqual((await proxySpawnApply(f.event, '/api/spawn', { method: 'POST', body: { agent: 'dev', agentsRoot: '/team/agents' } }, f.deps)).body, served);
  const p = prepared(); p.task = 'PRIVATE'; p.preview.env = 'PRIVATE'; p.preview.decision.effective.recipe = 'PRIVATE';
  assert.doesNotMatch(JSON.stringify(spawnApplyView(p, { workspace: 'northwind', selector })), /PRIVATE/);
});
test('malformed/oversize outputs after possible apply are unknown; wrong method/oversize input is zero-fetch', async () => {
  const f = proxy(assert.fail);
  for (const opts of [{ method: 'GET' }, { method: 'POST', body: 'x'.repeat(65537) }, { method: 'POST', body: { action: 'apply', spawnRef: ref, key: ref } }]) assert.equal((await proxySpawnApply(f.event, '/api/spawn', opts, f.deps)).body.reason.code, 'E_BAD_ARGS');
  for (const raw of ['PRIVATE', 'x'.repeat(4194305), JSON.stringify({ spawnApplyViewApi: 1 })]) {
    const f = proxy(async () => ({ ok: true, status: 200, text: async () => raw }));
    assert.equal((await proxySpawnApply(f.event, '/api/spawn', { method: 'POST', body: { action: 'apply', spawnRef: ref } }, f.deps)).body.status, 'unknown');
  }
});
