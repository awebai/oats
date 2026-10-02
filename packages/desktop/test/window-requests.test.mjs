// No cross-workspace fallback (#481, item 9): a request from a window bound to a workspace carries
// that window's workspace. An implicit ?ws= is pinned to the window's workspace, never main's single
// verified workspace; an advertised explicit ?ws= passes unchanged; an unadvertised one is refused with
// 404 E_WORKSPACE_NOT_SERVED on every workspace-scoped route; with no advertised set known, the
// request passes unrewritten. An unbound window keeps the rewrite to the verified workspace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiUrl, workspaceScoped, windowRefusal } from '../api-url.mjs';

const BASE = 'http://127.0.0.1:4999';
const VERIFIED = '/d/first';
const WINDOW = 'ws:0123456789abcdef0123';
const ADVERTISED = new Set([VERIFIED, WINDOW, '/d/second', 'remote:altair:/srv/agents']);
const SCOPED = ['/api/panel', '/api/agents', '/api/spawn', '/api/automations', '/api/forge-roster', '/api/team-members',
  '/api/instance-lifecycle', '/api/instance-git', '/api/instance-events', '/api/workspace-readiness', '/api/workspace-spawn-preview',
  '/api/workspace-sync', '/api/brain/notes', '/api/session/x', '/api/keys/x', '/api/interrupt/x', '/api/chat/x'];
const UNSCOPED = ['/api/cli', '/api/version', '/api/forge-connections', '/api/capabilities', '/api/window-state'];

test('workspaceScoped names exactly the routes main pins a workspace onto', () => {
  for (const path of SCOPED) assert.equal(workspaceScoped(path), true, path);
  for (const path of UNSCOPED) assert.equal(workspaceScoped(path), false, path);
});

test('bound window: an implicit ?ws= is the window\'s workspace, never the verified one', () => {
  for (const path of SCOPED) {
    assert.equal(windowRefusal(path, BASE, WINDOW, ADVERTISED), null, path);
    assert.equal(apiUrl(path, BASE, WINDOW, ADVERTISED, { bound: true }).searchParams.get('ws'), WINDOW, path);
  }
});

test('bound window: an advertised explicit ?ws= (a deployment its rows address) passes unchanged', () => {
  for (const path of SCOPED) {
    const asked = `${path}?ws=${encodeURIComponent('/d/second')}`;
    assert.equal(windowRefusal(asked, BASE, WINDOW, ADVERTISED), null, path);
    assert.equal(apiUrl(asked, BASE, WINDOW, ADVERTISED, { bound: true }).searchParams.get('ws'), '/d/second', path);
  }
});

test('bound window: an unadvertised workspace is refused on every workspace-scoped route', () => {
  for (const path of SCOPED) {
    // The window's own workspace, implicit, when the server stopped serving it.
    assert.equal(windowRefusal(path, BASE, '/d/gone', ADVERTISED), '/d/gone', path);
    // An explicit selector the server does not advertise: a path, a view id, a remote, any id.
    for (const id of ['/d/gone', 'ws:ffffffffffffffffffff', 'remote:rigel:/x', 'anything']) {
      assert.equal(windowRefusal(`${path}?ws=${encodeURIComponent(id)}`, BASE, WINDOW, ADVERTISED), id, `${path} ${id}`);
    }
    // A duplicate selector naming one unadvertised id is refused too.
    assert.equal(windowRefusal(`${path}?ws=${encodeURIComponent(VERIFIED)}&ws=%2Fd%2Fgone`, BASE, WINDOW, ADVERTISED), '/d/gone', path);
  }
});

test('bound window: routes outside the workspace scope are never refused by workspace', () => {
  for (const path of UNSCOPED) assert.equal(windowRefusal(`${path}?ws=%2Fd%2Fgone`, BASE, '/d/gone', ADVERTISED), null, path);
});

test('bound window: with no advertised set known, the request passes unrewritten', () => {
  for (const advertised of [new Set(), undefined, null]) {
    assert.equal(windowRefusal('/api/panel?ws=%2Fd%2Fgone', BASE, WINDOW, advertised), null);
    assert.equal(apiUrl('/api/panel?ws=%2Fd%2Fgone', BASE, WINDOW, advertised, { bound: true }).searchParams.get('ws'), '/d/gone');
    assert.equal(apiUrl('/api/panel', BASE, WINDOW, advertised, { bound: true }).searchParams.get('ws'), WINDOW);
  }
});

test('unbound window: today\'s rewrite to the verified workspace is kept', () => {
  assert.equal(windowRefusal('/api/panel?ws=%2Fd%2Fgone', BASE, null, ADVERTISED), null, 'an unbound window is not refused here');
  assert.equal(apiUrl('/api/panel?ws=%2Fd%2Fgone', BASE, VERIFIED, ADVERTISED).searchParams.get('ws'), VERIFIED);
  assert.equal(apiUrl('/api/panel', BASE, VERIFIED, ADVERTISED).searchParams.get('ws'), VERIFIED);
});

test('bound window: off-origin and malformed paths are still refused by apiUrl', () => {
  assert.throws(() => apiUrl('//attacker/x', BASE, WINDOW, ADVERTISED, { bound: true }), /off-origin/);
  assert.throws(() => apiUrl('api/panel', BASE, WINDOW, ADVERTISED, { bound: true }), /must start with/);
  assert.equal(windowRefusal('//attacker/api/panel', BASE, '/d/gone', ADVERTISED), null, 'left to apiUrl, which throws');
});

test('every specialized proxy pins a bound window\'s workspace and never rewrites its explicit selector', async () => {
  const { proxyReadiness } = await import('../readiness-proxy.mjs');
  const { proxySpawnPreview } = await import('../spawn-preview-proxy.mjs');
  const { proxyInstanceEvents } = await import('../instance-events-proxy.mjs');
  const { proxySpawnApply } = await import('../spawn-apply-proxy.mjs');
  const { request: eventsRequestBody } = await import('./helpers/instance-events-fixture.mjs');
  const { workspaceHash } = await import('../renderer/window-binding.mjs');
  const renderer = 'file:///app/renderer/index.html';
  const frame = { url: `${renderer}${workspaceHash(WINDOW)}` };
  const event = { senderFrame: frame, sender: { mainFrame: frame, isDestroyed: () => false } };
  const routes = [
    [proxyReadiness, '/api/workspace-readiness', { method: 'POST', body: '{}' }],
    [proxySpawnPreview, '/api/workspace-spawn-preview', { method: 'POST', body: '{}' }],
    [proxyInstanceEvents, '/api/instance-events', { method: 'POST', body: JSON.stringify(eventsRequestBody()) }],
    [proxySpawnApply, '/api/spawn', { method: 'POST', body: JSON.stringify({ name: 'x' }) }],
  ];
  for (const [proxy, path, opts] of routes) {
    // The last case tells bound from unbound: with nothing advertised yet, an unbound window's selector
    // would be rewritten to the verified workspace; a bound window's passes unrewritten.
    for (const [asked, expected, allowedWs] of [['', WINDOW, ADVERTISED], [`?ws=${encodeURIComponent('/d/second')}`, '/d/second', ADVERTISED],
      [`?ws=${encodeURIComponent('/d/later')}`, '/d/later', new Set()]]) {
      const fetched = [];
      await proxy(event, `${path}${asked}`, opts, { rendererURL: renderer,
        connection: () => ({ base: BASE, wsId: WINDOW, allowedWs, bound: true, epoch: 1, transition: false }),
        fetch: async (url) => { fetched.push(new URL(url).searchParams.getAll('ws')); return { ok: false, status: 500, text: async () => '{}' }; } });
      assert.deepEqual(fetched, [[expected]], `${path}${asked}`);
    }
  }
});

/* ── the shipped api handler ───────────────────────────────────────────────── */
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { withWindowGlobals } from './helpers/main-window-globals.mjs';
import { apiInit, classifyApiRoute, servedSelectors } from '../api-url.mjs';
import { workspaceHash } from '../renderer/window-binding.mjs';
import { forgeProxyOptions, trustedForgeFrame, FORGE_EPOCH_HEADER } from '../forge-proxy.mjs';
import { forgeFailure } from '../renderer/forge-contract.mjs';
import { lifecycleFailure } from '../renderer/lifecycle-contract.mjs';
import { NOT_SERVED_CODE } from '../renderer/deployment-header.mjs';

const RENDERER = 'file:///fixture/renderer/index.html';
function shippedApi({ window: bound }) {
  const source = readFileSync(new URL('../main.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('ipcMain.handle("api",'), end = source.indexOf('// ---- IPC: workstation forge auth', start);
  let handler; const fetched = [];
  const fetch = async (url) => { fetched.push(new URL(url)); return { ok: true, status: 200, text: async () => JSON.stringify({ workspaces: [] }) }; };
  const proxy = (path) => { fetched.push(new URL(path, BASE)); return { ok: true, status: 200, body: {} }; };
  runInNewContext(source.slice(start, end), withWindowGlobals({
    ipcMain: { handle: (_name, fn) => { handler = fn; } }, apiUrl, apiInit, classifyApiRoute, servedSelectors, forgeProxyOptions, trustedForgeFrame,
    FORGE_EPOCH_HEADER, forgeFailure, lifecycleFailure, RENDERER_URL: RENDERER, serverEpoch: 0, unservedRefusal: () => null,
    serverHost: { inTransition: () => false }, currentForgeEpoch: () => 'fixture:0', base: () => BASE, wsId: VERIFIED, allowedWs: ADVERTISED,
    proxyReadiness: proxy, proxySpawnPreview: proxy, proxyInstanceEvents: proxy, proxySpawnApply: proxy,
    fetch, AbortSignal: { timeout: () => null }, Set, URL, JSON,
    guard: () => {},
  }));
  const frame = { url: bound ? `${RENDERER}${workspaceHash(bound)}` : RENDERER };
  const event = { senderFrame: frame, sender: { mainFrame: frame, isDestroyed: () => false } };
  return { fetched, call: (path) => handler(event, path, { method: 'POST', body: '{}' }) };
}

test('shipped api: a bound window\'s read for an unserved workspace is 404 E_WORKSPACE_NOT_SERVED on every route, never fetched', async () => {
  for (const path of SCOPED) {
    const api = shippedApi({ window: '/d/gone' });
    const reply = await api.call(path);
    assert.equal(reply.status, 404, path); assert.equal(reply.body.code, NOT_SERVED_CODE, path); assert.equal(reply.body.workspace, '/d/gone');
    assert.deepEqual(api.fetched, [], `${path}: no other workspace's data`);
    const explicit = await shippedApi({ window: WINDOW }).call(`${path}?ws=${encodeURIComponent('/d/gone')}`);
    assert.equal(explicit.status, 404, `${path} explicit`);
  }
});

test('shipped api: a bound window\'s implicit read is its own workspace; an unbound window\'s is the verified one', async () => {
  // The four specialized proxies pin through their connection (tested above); here, every other route.
  const proxied = ['readiness', 'spawn-preview', 'instance-events', 'spawn-apply'];
  for (const path of SCOPED.filter((p) => !proxied.includes(classifyApiRoute(p, BASE)))) {
    const bound = shippedApi({ window: WINDOW });
    await bound.call(path);
    assert.deepEqual(bound.fetched.map((u) => u.searchParams.get('ws')), [WINDOW], path);
    const unbound = shippedApi({ window: null });
    await unbound.call(path);
    assert.equal(unbound.fetched.length, 1, path);
  }
  const unbound = shippedApi({ window: null });
  await unbound.call('/api/panel');
  assert.equal(unbound.fetched[0].searchParams.get('ws'), VERIFIED);
});
