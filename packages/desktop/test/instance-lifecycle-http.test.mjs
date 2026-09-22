// Shipped HTTP callback with inert K3 executors: no listener or live lifecycle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { apiUrl, apiInit, classifyApiRoute } from '../api-url.mjs';
import { forgeProxyOptions, trustedForgeFrame, FORGE_EPOCH_HEADER } from '../forge-proxy.mjs';
import { forgeFailure } from '../renderer/forge-contract.mjs';
import { lifecycleFailure } from '../renderer/lifecycle-contract.mjs';
import { createLifecycleBoundary } from '../server/instance-lifecycle.mjs';
import { context, request, stopPlan, retirePlan, stopReceipt, retireReceipt, envelope } from './helpers/lifecycle-fixture.mjs';
function http({ remote = false, missing = false } = {}) {
  const source = readFileSync(new URL('../server/oats-web.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('const send = (res, code, body, type'), end = source.indexOf('\nserver.on("error",');
  const ctx = context(); ctx.workspace.remote = remote; if (missing) delete ctx.cli.lifecycleApi;
  const calls = [], service = createLifecycleBoundary({ invoke: async (bin, args) => {
    calls.push({ bin, args }); return envelope(args.phase === 'plan' ? args.operation === 'stop' ? stopPlan() : retirePlan()
      : args.operation === 'stop' ? stopReceipt(args) : retireReceipt(args));
  } });
  const deps = { createServer: fn => fn, lifecycleRequest: service, cliState: ctx.cli, workspaces: () => [ctx.workspace],
    snapshot: { byWs: new Map([['team', { instances: ctx.instances }]]) }, refreshSnapshot() {},
    resolveInstanceOr: assert.fail, panelData: assert.fail, snapshotPanel: assert.fail, collectNow: assert.fail };
  const handler = new Function(...Object.keys(deps), `${source.slice(start, end)}\nreturn server;`)(...Object.values(deps));
  return { calls, async request({ url = '/api/instance-lifecycle?ws=team', method = 'POST', body = JSON.stringify(request()),
    headers = { host: '127.0.0.1:4820', origin: 'http://localhost:4820' } } = {}) {
    const req = new EventEmitter(); Object.assign(req, { url, method, headers }); let result;
    const res = { writeHead(status, headers) { result = { status, headers }; }, end(text) { result.body = JSON.parse(text); } };
    const done = handler(req, res); req.emit('data', Buffer.from(body)); req.emit('end'); await done; return result;
  } };
}
test('shipped IPC bounds plan/apply separately and classifies lost mutation transport as unknown, never no effect', async () => {
  const source = readFileSync(new URL('../main.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('ipcMain.handle("api",'), end = source.indexOf('// ---- IPC: workstation forge auth', start);
  for (const phase of ['plan', 'apply']) for (const fail of [false, true]) {
    let handler, seen;
    const renderer = 'file:///fixture/index.html', frame = { url: renderer }, owner = { mainFrame: frame, isDestroyed: () => false };
    const c = { ipcMain: { handle: (_name, fn) => { handler = fn; } }, apiUrl, apiInit, classifyApiRoute, forgeProxyOptions,
      trustedForgeFrame, FORGE_EPOCH_HEADER, forgeFailure, lifecycleFailure, RENDERER_URL: renderer, serverEpoch: 0,
      currentForgeEpoch: () => 'main:0', serverHost: { inTransition: () => false }, base: () => 'http://127.0.0.1:4820',
      wsId: 'team', allowedWs: new Set(['team']), guard: () => {}, AbortSignal: { timeout: ms => ({ ms }) },
      fetch: async (url, opts) => { seen = { url, opts }; if (fail) throw new Error('PRIVATE transport'); return { ok: true, status: 200, text: async () => '{"lifecycleApi":1}' }; } };
    runInNewContext(source.slice(start, end), c);
    const response = await handler({ sender: owner, senderFrame: frame }, '/api/instance-lifecycle?ws=team', { method: 'POST', body: JSON.stringify({ action: phase }) });
    assert.equal(seen.opts.signal.ms, phase === 'apply' ? 610000 : 35000);
    if (fail) { assert.equal(response.body.status, phase === 'apply' ? 'unknown' : 'unavailable'); assert.doesNotMatch(JSON.stringify(response), /PRIVATE/); }
    seen = null;
    const denied = await handler({ sender: owner, senderFrame: { url: renderer } }, '/api/instance-lifecycle?ws=team', { method: 'POST', body: '{}' });
    assert.equal(denied.body.reason.code, 'E_FORBIDDEN_FRAME'); assert.equal(seen, null);
  }
});

test('Host/Origin guards precede lifecycle body parsing, lookup and every process', async () => {
  const h = http();
  for (const headers of [{}, { host: 'evil' }, { host: 'localhost', origin: 'https://evil' }, { host: 'localhost', origin: 'null' }, { host: 'localhost', origin: 'bad' }]) assert.equal((await h.request({ headers, body: '{' })).status, 403);
  assert.equal(h.calls.length, 0);
});
test('GET, malformed JSON, byte overflow and duplicate/missing/extra ws cannot invoke K3', async () => {
  const h = http(); assert.equal((await h.request({ method: 'GET' })).status, 404);
  for (const url of ['/api/instance-lifecycle', '/api/instance-lifecycle?ws=', '/api/instance-lifecycle?ws=team&ws=team', '/api/instance-lifecycle?ws=team&home=/x']) assert.equal((await h.request({ url })).status, 400);
  for (const body of ['{', 'null', '[]', ' '.repeat(65537)]) assert.equal((await h.request({ body })).status, 400);
  assert.equal(h.calls.length, 0);
});
test('old retirement route refuses E_PLAN_REQUIRED before identity lookup, local and remote alike', async () => {
  const h = http();
  for (const url of ['/api/retire/dev-1', '/api/retire/dev-1?ws=team', '/api/retire/dev-1?server=host&home=/remote/dev-1']) {
    const result = await h.request({ url }); assert.equal(result.status, 409); assert.equal(result.body.code, 'E_PLAN_REQUIRED');
  }
  assert.equal(h.calls.length, 0);
});
test('remote and missing feature/API refusal executes nothing; real callback separates plan from confirmed apply', async () => {
  for (const opts of [{ remote: true }, { missing: true }]) {
    const h = http(opts); assert.equal((await h.request()).body.status, 'unavailable'); assert.equal(h.calls.length, 0);
  }
  const h = http(); const plan = await h.request(); assert.equal(plan.body.status, 'plan'); assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].args.phase, 'plan'); assert.equal(h.calls[0].args.key, undefined);
  const body = JSON.stringify({ action: 'apply', planRef: plan.body.planRef });
  const result = await h.request({ body }); assert.equal(result.body.status, 'complete'); assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].args.phase, 'apply'); assert.match(h.calls[1].args.key, /^[a-f0-9]{64}$/);
  const again = await h.request({ body }); assert.equal(again.body.repeated, true); assert.equal(h.calls.length, 2);
  assert.equal(result.headers['cache-control'], 'no-store');
});
