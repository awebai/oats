import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import { classifyApiRoute } from '../api-url.mjs';
import { discover } from '../cli-locator.mjs';
import { createScheduleReadBoundary } from '../server/schedule-read.mjs';
import { scheduleReadAlias, scheduleReadFailure } from '../renderer/schedule-read-contract.mjs';
import { scheduleReadData } from '../renderer/schedule-read-data.mjs';
import { proxyScheduleRead, isScheduleReadAlias, SCHEDULE_PROXY_TIMEOUT } from '../schedule-read-proxy.mjs';
import { cli, context, scope, request, data, entry, envelope, deferred, tick } from './helpers/schedule-read-fixture.mjs';
const view = (input = request()) => ({ scheduleReadViewApi: 1, status: 'available', workspace: 'ws', scope,
  data: scheduleReadData(input.action === 'show' ? { schedule: entry() } : data(), scope, input), reason: null });
function http(invoke) {
  const source = readFileSync(new URL('../server/oats-web.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('const send = (res, code, body, type'), end = source.indexOf('\nserver.on("error",');
  const c = context(), calls = [], writes = [];
  const deps = { createServer: fn => fn, scheduleReadAlias, scheduleReadFailure,
    scheduleReadRequestBoundary: createScheduleReadBoundary({ invoke: invoke ?? (async (_cli, opts) => { calls.push(opts); return envelope(opts.action === 'show' ? { schedule: entry() } : data()); }) }),
    workspaces: () => [c.workspace], cliState: c.cli, cliProbeGeneration: 1, ctxs: [scope],
    agentsData: () => ({ agents: [] }), panelData: () => ({ instances: [] }),
    scheduleRequest: async (input, ctx) => { writes.push({ input, workspace: ctx.workspace }); return { written: true }; } };
  const handler = new Function(...Object.keys(deps), `${source.slice(start, end)}\nreturn server;`)(...Object.values(deps));
  return { c, calls, writes, async request({ url = '/api/workspace-schedules?ws=ws', method = 'POST', body = JSON.stringify(request()), headers = { host: 'localhost:4820', origin: 'http://localhost:4820' } } = {}) {
    const req = new EventEmitter(); Object.assign(req, { url, method, headers }); let result;
    const res = { writeHead(status, headers) { result = { status, headers }; }, end(text) { result.body = JSON.parse(text); } };
    const done = handler(req, res); req.emit('data', Buffer.from(body)); req.emit('end'); await done; return result;
  } };
}
test('actual HTTP GET/other methods never command, even no Origin/no workspace; Host/Origin guard remains', async () => {
  const h = http();
  for (const path of ['/api/schedules', '/api/workspace-schedules']) {
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const out = await h.request({ url: path, method, headers: { host: 'localhost:4820' } }); assert.equal(out.status, 405); assert.equal(out.body.reason.code, 'E_METHOD_NOT_ALLOWED');
    }
    for (const headers of [{}, { host: 'evil' }, { host: 'localhost', origin: 'https://evil' }, { host: 'localhost', origin: 'null' }]) assert.equal((await h.request({ url: path, headers })).status, 403);
  }
  assert.equal(h.calls.length, 0); assert.equal(h.writes.length, 0);
});
test('new and legacy read routes enforce explicit unique ws, exact body,16KiB including whitespace and same fence', async () => {
  const h = http();
  for (const path of ['/api/workspace-schedules', '/api/schedules']) {
    const input = path === '/api/schedules' ? { operation: 'list' } : request();
    for (const query of ['', '?ws=', '?ws=ws&ws=ws', '?ws=ws&limit=500']) assert.equal((await h.request({ url: path + query, body: JSON.stringify(input) })).status, 400);
    for (const body of ['{', 'null', '[]', JSON.stringify(input) + ' '.repeat(16384), ' '.repeat(65537)]) assert.equal((await h.request({ url: path + '?ws=ws', body })).status, 400);
    assert.equal((await h.request({ url: path + '?ws=unknown', body: JSON.stringify(input) })).body.reason.code, 'E_WORKSPACE_UNKNOWN');
    assert.equal((await h.request({ url: path + '?ws=ws', body: JSON.stringify({ ...input, file: '/PRIVATE' }) })).body.reason.code, 'E_BAD_ARGS');
    h.c.cli.scheduleHistoryApi = 2; assert.equal((await h.request({ url: path + '?ws=ws', body: JSON.stringify(input) })).body.reason.code, 'E_SCHEDULE_READ_UNAVAILABLE'); h.c.cli.scheduleHistoryApi = 3;
  }
  assert.equal(h.calls.length, 0); assert.equal(h.writes.length, 0);
  assert.equal((await h.request()).body.status, 'available');
  assert.equal((await h.request({ url: '/api/schedules?ws=ws', body: JSON.stringify({ operation: 'show', id: 'nightly' }) })).body.status, 'available');
  assert.equal(h.calls.length, 2); assert.equal(h.writes.length, 0);
});
test('legacy reads/new reads coalesce together and reserve slots before exec; mutations stay separate at existing64KiB', async () => {
  const gate = deferred(); let calls = 0;
  const h = http(() => { calls++; return gate.promise; });
  const a = h.request(), b = h.request({ url: '/api/schedules?ws=ws', body: JSON.stringify({ operation: 'list' }) });
  await tick(); assert.equal(calls, 1); gate.resolve(envelope());
  assert.equal((await a).body.status, 'available'); assert.equal((await b).body.status, 'available');
  const body = JSON.stringify({ operation: 'update', id: 'nightly', spec: { task: 'x'.repeat(20000) } });
  assert.equal((await h.request({ url: '/api/schedules?ws=ws', body })).body.written, true); assert.equal(calls, 1); assert.equal(h.writes.length, 1);
});
function proxy(fetch = async () => new Response(JSON.stringify(view()))) {
  const renderer = 'file:///fixture/index.html', frame = { url: renderer }, event = { senderFrame: frame, sender: { mainFrame: frame, isDestroyed: () => false } };
  const connection = { base: 'http://localhost:4820', wsId: 'ws', allowedWs: new Set(['ws']), epoch: 0, transition: false };
  return { event, connection, deps: { rendererURL: renderer, connection: () => connection, fetch }, opts: { method: 'POST', body: request() } };
}
test('actual main normalized classification protects both new path and legacy READ aliases, not raw-prefix routing', async () => {
  const source = readFileSync(new URL('../main.mjs', import.meta.url), 'utf8'), start = source.indexOf('ipcMain.handle("api",'), end = source.indexOf('// ---- IPC: workstation forge auth', start);
  let handler, calls = 0;
  const f = proxy(async () => { calls++; return new Response(JSON.stringify(view())); });
  const deps = { ipcMain: { handle: (_name, fn) => handler = fn }, classifyApiRoute, RENDERER_URL: f.deps.rendererURL, isScheduleReadAlias,
    proxyScheduleRead: (event, path, opts, deps) => proxyScheduleRead(event, path, opts, { ...deps, fetch: f.deps.fetch }),
    base: () => f.connection.base, wsId: 'ws', allowedWs: f.connection.allowedWs, serverEpoch: 0, serverHost: { inTransition: () => false }, guard: () => assert.fail('read must not use generic proxy') };
  runInNewContext(source.slice(start, end), deps);
  for (const route of ['workspace-schedules', 'schedules']) for (const alias of [`/api/${route}`, `/api/./${route}`, `/api/x/../${route}`, `/api/%2e/${route}`, '/api' + String.fromCharCode(92) + route, `/a\tpi/${route}`]) {
    const opts = { method: 'POST', body: route === 'schedules' ? { operation: 'list' } : request() };
    assert.equal((await handler({ ...f.event, senderFrame: { url: f.deps.rendererURL } }, alias + '?ws=ws', opts)).body.reason.code, 'E_FORBIDDEN_FRAME'); assert.equal(calls, 0);
  }
  assert.equal((await handler(f.event, '/api/x/../schedules?ws=ws', { method: 'POST', body: { operation: 'list' } })).body.status, 'available'); assert.equal(calls, 1);
  assert.equal(isScheduleReadAlias({ method: 'POST', body: { operation: 'run', id: 'nightly' } }), false);
});
for (const reject of [false, true]) for (const change of ['frame', 'navigation', 'epoch', 'base', 'workspace', 'transition']) test(`proxy revokes late ${reject ? 'rejection' : 'success'} on ${change}`, async () => {
  const gate = deferred(), f = proxy(() => gate.promise);
  const pending = proxyScheduleRead(f.event, '/api/workspace-schedules?ws=ws', f.opts, f.deps);
  if (change === 'frame') f.event.sender.mainFrame = { url: f.deps.rendererURL };
  if (change === 'navigation') f.event.senderFrame.url = 'https://evil';
  if (change === 'epoch') f.connection.epoch++;
  if (change === 'base') f.connection.base = 'http://localhost:4999';
  if (change === 'workspace') f.connection.wsId = 'other';
  if (change === 'transition') f.connection.transition = true;
  if (reject) gate.reject(Error('PRIVATE')); else gate.resolve(new Response(JSON.stringify(view())));
  const out = await pending; assert.equal(out.body.reason?.code, ['frame', 'navigation'].includes(change) ? 'E_FORBIDDEN_FRAME' : 'E_TARGET_CHANGED'); assert.doesNotMatch(JSON.stringify(out), /PRIVATE/);
});
test('ownership checked after stream consumption, not only response headers', async () => {
  let controller; const f = proxy(async () => new Response(new ReadableStream({ start(c) { controller = c; } })));
  const pending = proxyScheduleRead(f.event, '/api/workspace-schedules?ws=ws', f.opts, f.deps);
  await tick(); f.connection.epoch++; controller.enqueue(new TextEncoder().encode(JSON.stringify(view()))); controller.close();
  assert.equal((await pending).body.reason.code, 'E_TARGET_CHANGED');
});
test('proxy has no missing/unadvertised workspace substitution; path/method/query/body precede fetch', async () => {
  let calls = 0; const f = proxy(async () => { calls++; return new Response(JSON.stringify(view())); });
  for (const path of ['//evil/api/workspace-schedules?ws=ws', '/api/other?ws=ws', '/api/workspace-schedules', '/api/workspace-schedules?ws=ws&ws=ws', '/api/workspace-schedules?ws=ws&x=y']) assert.equal((await proxyScheduleRead(f.event, path, f.opts, f.deps)).body.reason.code, 'E_BAD_ARGS');
  assert.equal((await proxyScheduleRead(f.event, '/api/workspace-schedules?ws=unknown', f.opts, f.deps)).body.reason.code, 'E_WORKSPACE_UNKNOWN');
  for (const body of ['x'.repeat(16385), JSON.stringify(request()) + ' '.repeat(16384), '{', 'null', JSON.stringify({ action: 'list', spec: {} })]) assert.equal((await proxyScheduleRead(f.event, '/api/workspace-schedules?ws=ws', { method: 'POST', body }, f.deps)).body.reason?.code, 'E_BAD_ARGS');
  assert.equal((await proxyScheduleRead(f.event, '/api/schedules?ws=ws', { method: 'GET' }, f.deps)).status, 405); assert.equal(calls, 0); assert.equal(SCHEDULE_PROXY_TIMEOUT, 35000);
});
test('streaming limit cancels before copying oversized chunk; never whole response.text()', async () => {
  let cancelled = false;
  const f = proxy(async () => ({ ok: true, status: 200, text: assert.fail, body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(4194305)); c.enqueue(new Uint8Array([123])); c.close(); }, cancel() { cancelled = true; } }) }));
  assert.equal((await proxyScheduleRead(f.event, '/api/workspace-schedules?ws=ws', f.opts, f.deps)).body.reason.code, 'E_CLI_OUTPUT_LIMIT'); assert.equal(cancelled, true);
});
test('public reprojection prevents foreign workspace/scope/draft, errors are static and source facts allowlisted', async () => {
  for (const raw of ['PRIVATE', JSON.stringify({ ...view(), scheduleReadViewApi: 2 }), JSON.stringify({ ...view(), workspace: 'other' }), JSON.stringify({ ...view(), scope: '/other' }), JSON.stringify({ ...view(), data: { ...view().data, draft: entry() } })]) {
    const f = proxy(async () => new Response(raw)); const out = await proxyScheduleRead(f.event, '/api/workspace-schedules?ws=ws', f.opts, f.deps); assert.equal(out.body.reason?.code, 'E_CLI_PROTOCOL'); assert.doesNotMatch(JSON.stringify(out), /PRIVATE/);
  }
  const f = proxy(async () => new Response(JSON.stringify({ ...scheduleReadFailure('E_SCHEDULE_INVALID'), workspace: null, reason: { code: 'E_SCHEDULE_INVALID', message: 'PRIVATE', details: { source: { path: 'state', status: 'refused', bytes: 9 }, raw: 'PRIVATE' } } }), { status: 400 }));
  const out = await proxyScheduleRead(f.event, '/api/workspace-schedules?ws=ws', f.opts, f.deps); assert.equal(out.status, 400); assert.equal(out.body.reason.details.source.status, 'refused'); assert.doesNotMatch(JSON.stringify(out), /PRIVATE/);
});
test('locator/public CLI status retain only exact integer History3', async () => {
  const source = readFileSync(new URL('../server/oats-web.mjs', import.meta.url), 'utf8').match(/function cliStatus\(\) \{[^]*?\n\}/)[0];
  for (const scheduleHistoryApi of [undefined, 1, 2, '3', true, 4, 3]) {
    const found = await discover({ persisted: () => cli.bin, env: {}, isExecutableFile: () => true }, async () => ({ stdout: JSON.stringify({ schemaVersion: 1, name: '@awebai/oats', version: '0.25.8', desktopApi: 1, features: ['schedule-read-2'], scheduleHistoryApi }) }));
    assert.equal(found.scheduleHistoryApi, scheduleHistoryApi === 3 ? 3 : undefined);
    const status = new Function('cliState', 'locator', 'MANIFEST', `return (${source})();`)({ scheduleHistoryApi }, { supportsRelations: () => false, RELATIONS_MIN: [] }, { version: 'fixture' }); assert.equal(status.scheduleHistoryApi, scheduleHistoryApi === 3 ? 3 : null);
  }
});
