// The shipped HTTP callback and real boundary, with inert injected executors.
// No listener, native CLI, OAuth, tmux, Electron or browser is started.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { createForgeBoundary } from '../server/forge.mjs';
import { forgeObservation } from '../server/forge-observation.mjs';
import { FORGE_EPOCH_HEADER, validForgeEpoch } from '../forge-proxy.mjs';
import { cli, oats, context, target, selector, state, envelope, output, status, pr, deferred, tick } from './helpers/forge-fixture.mjs';
function http({ remote = false, run, discover, raw = state(), transform = source => source } = {}) {
  const source = transform(readFileSync(new URL('../server/oats-web.mjs', import.meta.url), 'utf8'));
  const start = source.indexOf('const send = (res, code, body, type'), end = source.indexOf('\nserver.on("error",');
  assert.ok(start > 0 && end > start);
  let executions = 0;
  const service = createForgeBoundary({
    discover: discover || (async () => { executions++; return cli; }),
    invokeGit: async () => { executions++; return envelope(raw); },
    run: async (bin, args, opts) => { executions++; return run ? run(bin, args, opts)
      : args[0] === 'auth' ? output(status(), 0, `ghp_${'X'.repeat(36)}`) : args[0] === 'api' ? output('operator') : output(pr()); },
  });
  const deps = { createServer: handler => handler, forgeBoundary: service, FORGE_EPOCH_HEADER, validForgeEpoch,
    cliState: oats, workspaces: () => [{ ...context.workspace, remote }], snapshot: { byWs: new Map([['team', { instances: context.instances }]]) },
    panelData: assert.fail, snapshotPanel: assert.fail, collectNow: assert.fail };
  const handler = new Function(...Object.keys(deps), `${source.slice(start, end)}\nreturn server;`)(...Object.values(deps));
  const requestBody = { selector, observationKey: forgeObservation(raw, target, oats).observationKey };
  return { count: () => executions, async request({ url = '/api/instance-forge?ws=team', method = 'POST', body = JSON.stringify(requestBody),
    headers = { host: '127.0.0.1:4820', origin: 'http://localhost:4820', [FORGE_EPOCH_HEADER]: 'client:0' } } = {}) {
    const req = new EventEmitter(); Object.assign(req, { url, method, headers }); let result;
    const res = { writeHead(code, responseHeaders) { result = { code, headers: responseHeaders }; }, end(text) { result.body = JSON.parse(text); } };
    const waiting = handler(req, res); req.emit('data', Buffer.from(body)); req.emit('end'); await waiting;
    return result;
  } };
}
test('both forge POSTs are behind Host/Origin guards, including malformed body attacks', async () => {
  const h = http();
  for (const url of ['/api/instance-forge?ws=team', '/api/forge-connections']) for (const headers of [
    {}, { host: 'evil' }, { host: '127.0.0.1', origin: 'https://evil' }, { host: 'localhost', origin: 'null' }, { host: 'localhost', origin: 'invalid' },
  ]) assert.equal((await h.request({ url, headers, body: '{' })).code, 403);
  assert.equal(h.count(), 0);
});
test('GET/auth-mutation routes, duplicate/extra/missing ws, unknown machine query and malformed bodies never run a process', async () => {
  const h = http();
  for (const url of ['/api/instance-forge?ws=team', '/api/forge-connections']) assert.equal((await h.request({ url, method: 'GET' })).code, 404);
  for (const url of ['/api/forge-login', '/api/forge-logout']) assert.equal((await h.request({ url })).code, 404);
  for (const url of ['/api/instance-forge', '/api/instance-forge?ws=', '/api/instance-forge?ws=team&ws=team', '/api/instance-forge?ws=team&cwd=/x', '/api/forge-connections?ws=team']) assert.equal((await h.request({ url })).code, 400);
  for (const body of ['{', 'null', '[]', '0', ' '.repeat(65537)]) for (const url of ['/api/instance-forge?ws=team', '/api/forge-connections']) assert.equal((await h.request({ url, body })).code, 400);
  assert.equal((await h.request({ headers: { host: 'localhost', [FORGE_EPOCH_HEADER]: 'bad/epoch' } })).code, 400);
  assert.equal(h.count(), 0);
});
test('remote workspace refusal precedes oats and gh; machine Connections is separate and works without workspace query', async () => {
  const h = http({ remote: true });
  const refused = await h.request(); assert.equal(refused.body.reason.code, 'unsupported-remote-operation'); assert.equal(h.count(), 0);
  const result = await h.request({ url: '/api/forge-connections', body: '{}' });
  assert.equal(result.body.status, 'connected'); assert.equal(result.body.login, 'operator'); assert.ok(h.count() > 0);
});
test('real callback qualifies its exact roster and returns bounded projections without stderr or raw URL', async () => {
  const h = http(); const result = await h.request();
  assert.equal(result.code, 200); assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal(result.body.status, 'available'); assert.equal(result.body.data.number, 42);
  assert.doesNotMatch(JSON.stringify(result), /ghp_|userinfo|PRIVATE/);
  const before = h.count();
  assert.equal((await h.request({ url: '/api/instance-forge?ws=foreign' })).body.reason.code, 'E_WORKSPACE_UNKNOWN');
  assert.equal(h.count(), before);
});
test('HTTP burst coalesces in one epoch, auth generation starts a new flight, errors remain closed', async () => {
  const gate = deferred(); let discoveries = 0;
  const h = http({ discover: async () => { discoveries++; return gate.promise; } });
  const values = Array.from({ length: 5 }, () => h.request({ url: '/api/forge-connections', body: '{}' }));
  const next = h.request({ url: '/api/forge-connections', body: '{}', headers: { host: 'localhost', [FORGE_EPOCH_HEADER]: 'client:1' } });
  await tick(); assert.equal(discoveries, 2); gate.resolve({ ok: false, code: 'E_GH_TIMEOUT', message: 'PRIVATE' });
  const results = await Promise.all([...values, next]);
  assert.ok(results.every(r => r.body.reason.code === 'E_GH_TIMEOUT')); assert.doesNotMatch(JSON.stringify(results), /PRIVATE/);
});
