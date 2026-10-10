// Main's shipped `api` IPC handler (main.mjs), run in a vm over fake I/O, for one sending window.
//   window      the workspace the window is bound to (its #ws=), or null for a window with none
//   chooser     the window is one main knows has no workspace to read (a New Window, a window left choosing)
//   advertised  what main last learned the server advertises; `reread` is what a re-read finds
//   served      main's served list (the switcher's choices)
//   reply(url)  the backend's answer to a fetch: { status, body }
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { withWindowGlobals } from './main-window-globals.mjs';
import { apiUrl, apiInit, classifyApiRoute, servedSelectors } from '../../api-url.mjs';
import { workspaceHash } from '../../renderer/window-binding.mjs';
import { forgeProxyOptions, trustedForgeFrame, FORGE_EPOCH_HEADER } from '../../forge-proxy.mjs';
import { forgeFailure } from '../../renderer/forge-contract.mjs';
import { lifecycleFailure } from '../../../client/lifecycle-contract.mjs';

export const RENDERER = 'file:///fixture/renderer/index.html';

export function shippedMainApi({ window: bound, chooser = false, base = 'http://127.0.0.1:4999', wsId = '/d/first', advertised, reread = null,
  served = [], reply = () => ({ status: 200, body: { workspaces: [] } }) }) {
  const source = readFileSync(new URL('../../main.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('ipcMain.handle("api",'), end = source.indexOf('// ---- IPC: workstation forge auth', start);
  let handler; const fetched = [], calls = { rereads: 0 };
  const fetch = async (url) => {
    const u = new URL(url); fetched.push(u);
    const r = reply(u);
    return { ok: r.status < 400, status: r.status, text: async () => JSON.stringify(r.body) };
  };
  const proxy = (path) => { fetched.push(new URL(path, base)); return { ok: true, status: 200, body: {} }; };
  const sendingWindow = {};
  const context = withWindowGlobals({
    ipcMain: { handle: (_name, fn) => { handler = fn; } }, apiUrl, apiInit, classifyApiRoute, servedSelectors, forgeProxyOptions, trustedForgeFrame,
    FORGE_EPOCH_HEADER, forgeFailure, lifecycleFailure, RENDERER_URL: RENDERER, serverEpoch: 0, unservedRefusal: () => null,
    serverHost: { inTransition: () => false }, currentForgeEpoch: () => 'fixture:0', base: () => base, wsId, allowedWs: advertised, servedList: served,
    // The re-read of the advertised set (main's panelWorkspaces): `reread` is what the server advertises now.
    panelWorkspaces: async () => { calls.rereads++; if (reread) context.allowedWs = reread; return context.servedList; },
    BrowserWindow: { fromWebContents: () => sendingWindow }, choosers: new Set(chooser ? [sendingWindow] : []),
    proxyReadiness: proxy, proxySpawnPreview: proxy, proxyInstanceEvents: proxy, proxySpawnApply: proxy,
    fetch, AbortSignal: { timeout: () => null }, Set, URL, JSON,
    guard: () => {},
  });
  runInNewContext(source.slice(start, end), context);
  const frame = { url: bound ? `${RENDERER}${workspaceHash(bound)}` : RENDERER };
  const event = { senderFrame: frame, sender: { mainFrame: frame, isDestroyed: () => false } };
  return { fetched, calls, context, call: (path, opts = { method: 'POST', body: '{}' }) => handler(event, path, opts) };
}
