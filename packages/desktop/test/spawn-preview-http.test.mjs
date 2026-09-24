import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import { classifyApiRoute } from '../api-url.mjs';
import { createSpawnPreviewBoundary } from '../server/spawn-preview.mjs';
import { proxySpawnPreview } from '../spawn-preview-proxy.mjs';
import { previewFailure } from '../renderer/spawn-preview-contract.mjs';
import { spawnApplyFailure } from '../renderer/spawn-apply-contract.mjs';
import { context, request, target, data, envelope, view, deferred } from './helpers/spawn-preview-fixture.mjs';
function http() {
  const source = readFileSync(new URL('../server/oats-web.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('const send = (res, code, body, type'), end = source.indexOf('\nserver.on("error",');
  const c = context(), calls = [];
  const deps = { createServer: fn => fn, previewFailure, spawnAgent: assert.fail,
    spawnApplyFailure, spawnApplyRequest: assert.fail,
    spawnPreviewRequest: createSpawnPreviewBoundary({ invoke: async (cli, opts) => { calls.push(opts); return envelope(data(opts.target)); } }),
    workspaces: () => [c.workspace], cliState: c.cli, agentsData: () => ({ agents: c.agents }), snapshot: { byWs: new Map([['northwind', { instances: c.instances }]]) } };
  const handler = new Function(...Object.keys(deps), `${source.slice(start, end)}\nreturn server;`)(...Object.values(deps));
  return { c, calls, async request({ url = '/api/workspace-spawn-preview?ws=northwind', method = 'POST', body = JSON.stringify(request()), headers = { host: 'localhost:4820', origin: 'http://localhost:4820' } } = {}) {
    const req = new EventEmitter(); Object.assign(req, { url, method, headers }); let result;
    const res = { writeHead(status, headers) { result = { status, headers }; }, end(text) { result.body = JSON.parse(text); } };
    const done = handler(req, res); req.emit('data', Buffer.from(body)); req.emit('end'); await done; return result;
  } };
}
test('shipped HTTP: Host/Origin, method, query and 16KiB body refuse before dispatch', async () => {
  const h = http();
  for (const headers of [{}, { host: 'evil' }, { host: 'localhost', origin: 'https://evil' }, { host: 'localhost', origin: 'null' }]) assert.equal((await h.request({ headers })).status, 403);
  assert.equal((await h.request({ method: 'GET' })).status, 404);
  for (const url of ['/api/workspace-spawn-preview', '/api/workspace-spawn-preview?ws=', '/api/workspace-spawn-preview?ws=northwind&ws=northwind', '/api/workspace-spawn-preview?ws=northwind&apply=true']) assert.equal((await h.request({ url })).status, 400);
  for (const body of ['{', 'null', '[]', ' '.repeat(16385)]) assert.equal((await h.request({ body })).status, 400);
  assert.equal(h.calls.length, 0);
  const result = await h.request(); assert.equal(result.body.status, 'available'); assert.equal(result.headers['cache-control'], 'no-store'); assert.equal(h.calls.length, 1);
});
test('shipped HTTP never dispatches API1, remote, task/file flags or an apply action', async () => {
  const h = http(); h.c.cli.spawnPreviewApi = 1;
  assert.equal((await h.request()).body.reason.code, 'E_PREVIEW_UNAVAILABLE'); h.c.cli.spawnPreviewApi = 2;
  h.c.workspace.remote = true; assert.equal((await h.request()).body.reason.code, 'unsupported-remote-operation'); h.c.workspace.remote = false;
  for (const bad of [{ ...request(), action: 'apply' }, { ...request(), task: 'SECRET' }, request({ taskFile: '/etc/passwd' }), request({ expectDecision: 'r' })]) {
    assert.equal((await h.request({ body: JSON.stringify(bad) })).body.reason.code, 'E_BAD_ARGS');
  }
  assert.equal(h.calls.length, 0);
});
test('the unguarded spawn route is execution-server only: a local body needs the prepare/apply plan; decision-bound keys are refused', async () => {
  const h = http();
  assert.equal((await h.request({ url: '/api/spawn', body: JSON.stringify({ agent: 'release-manager', agentsRoot: '/fixture/base/northwind-workspace/agents' }) })).body.code, 'E_PLAN_REQUIRED');
  for (const extra of [{ base: 'HEAD' }, { branch: 'branch' }, { work: 'worktree' }, { modelMode: 'native-default' }, { model: { kind: 'native-default' } }, { model: '@native-default' }, { expectDecision: 'revision' }, { choices: {} }]) {
    const result = await h.request({ url: '/api/spawn', body: JSON.stringify({ agent: 'release-manager', agentsRoot: '/fixture/base/northwind-workspace/agents', serverId: 'remote-host', ...extra }) });
    assert.equal(result.status, 409); assert.equal(result.body.code, 'E_UNSUPPORTED_OPTION');
  }
  assert.equal(h.calls.length, 0);
});
function proxy(fetch) {
  const renderer = 'file:///fixture/index.html', frame = { url: renderer }, event = { senderFrame: frame, sender: { mainFrame: frame, isDestroyed: () => false } };
  const connection = { base: 'http://localhost:4820', wsId: 'northwind', allowedWs: new Set(['northwind']), epoch: 0, transition: false };
  return { event, connection, deps: { rendererURL: renderer, connection: () => connection, fetch }, opts: { method: 'POST', body: request() } };
}
test('main normalizes every preview alias into the real specialized guard; same-URL subframes execute zero fetches', async () => {
  const source = readFileSync(new URL('../main.mjs', import.meta.url), 'utf8'), start = source.indexOf('ipcMain.handle("api",'), end = source.indexOf('// ---- IPC: workstation forge auth', start);
  let handler, calls = 0; const f = proxy(async () => { calls++; return { ok: true, status: 200, text: async () => JSON.stringify(view()) }; });
  const deps = { ipcMain: { handle: (_n, fn) => handler = fn }, classifyApiRoute, RENDERER_URL: f.deps.rendererURL,
    proxySpawnPreview: (e, path, opts, d) => proxySpawnPreview(e, path, opts, { ...d, fetch: f.deps.fetch }), base: () => f.connection.base,
    wsId: 'northwind', allowedWs: f.connection.allowedWs, serverEpoch: 0, serverHost: { inTransition: () => false },
    forgeFailure: () => ({}), lifecycleFailure: () => ({}), guard: () => assert.fail('preview must use specialized frame guard') };
  runInNewContext(source.slice(start, end), deps);
  for (const path of ['/api/workspace-spawn-preview', '/api/./workspace-spawn-preview', '/api/x/../workspace-spawn-preview', '/api/%2e/workspace-spawn-preview', '/api' + String.fromCharCode(92) + 'workspace-spawn-preview', '/a\tpi/workspace-spawn-preview']) {
    assert.equal((await handler({ ...f.event, senderFrame: { url: f.deps.rendererURL } }, path, f.opts)).body.reason.code, 'E_FORBIDDEN_FRAME');
    assert.equal(calls, 0);
  }
  assert.equal((await handler(f.event, '/api/./workspace-spawn-preview', f.opts)).body.status, 'available'); assert.equal(calls, 1);
});
for (const rejection of [false, true]) for (const change of ['frame', 'epoch']) test(`proxy guards late ${rejection ? 'rejection' : 'success'} after ${change}`, async () => {
  const d = deferred(), f = proxy(() => d.promise);
  const pending = proxySpawnPreview(f.event, '/api/workspace-spawn-preview', f.opts, f.deps);
  if (change === 'frame') f.event.sender.mainFrame = { url: f.deps.rendererURL }; else f.connection.epoch++;
  if (rejection) d.reject(Error('PRIVATE')); else d.resolve({ ok: true, status: 200, text: async () => JSON.stringify(view()) });
  const result = await pending; assert.equal(result.body.reason?.code, change === 'frame' ? 'E_FORBIDDEN_FRAME' : 'E_TARGET_CHANGED'); assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
});
test('proxy refuses oversize inputs, off-origin paths and oversized/malformed/foreign output', async () => {
  const f = proxy(assert.fail);
  assert.equal((await proxySpawnPreview(f.event, '/api/workspace-spawn-preview', { method: 'POST', body: 'x'.repeat(16385) }, f.deps)).body.reason.code, 'E_BAD_ARGS');
  assert.equal((await proxySpawnPreview(f.event, '//evil/api/workspace-spawn-preview', f.opts, f.deps)).body.status, 'unavailable');
  for (const output of ['PRIVATE', 'x'.repeat(4194305), JSON.stringify(view({ ...target, workspace: 'other' }))]) {
    const f = proxy(async () => ({ ok: true, status: 200, text: async () => output }));
    assert.equal((await proxySpawnPreview(f.event, '/api/workspace-spawn-preview', f.opts, f.deps)).body.status, 'unavailable');
  }
});
test('public status forwards only integer API2, never API1/string/future', () => {
  const s = readFileSync(new URL('../server/oats-web.mjs', import.meta.url), 'utf8').match(/function cliStatus\(\) \{[^]*?\n\}/)[0];
  for (const value of [undefined, 1, '2', 3, 2]) {
    const r = new Function('cliState', 'locator', 'MANIFEST', `return (${s})();`)({ spawnPreviewApi: value }, { supportsRelations: () => false, RELATIONS_MIN: [] }, { version: 'fixture' });
    assert.equal(r.spawnPreviewApi, value === 2 ? 2 : null);
  }
});
