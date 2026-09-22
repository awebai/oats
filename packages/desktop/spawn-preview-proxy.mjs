/** K6 read-only IPC. No fallback, task forwarding or mutation result handling. */
import { apiUrl, apiInit } from './api-url.mjs';
import { trustedForgeFrame } from './forge-proxy.mjs';
import { previewFailure, previewTarget, previewData } from './renderer/spawn-preview-contract.mjs';
export async function proxySpawnPreview(event, path, opts, { rendererURL, connection, fetch: fetcher = globalThis.fetch } = {}) {
  const reply = (code, status = 503) => ({ ok: false, status, body: previewFailure(code) });
  let frame; try { frame = event?.senderFrame; } catch { return reply('E_FORBIDDEN_FRAME', 403); }
  const owns = () => { try { return trustedForgeFrame(event, rendererURL) && event.sender.mainFrame === frame; } catch { return false; } };
  if (!owns()) return reply('E_FORBIDDEN_FRAME', 403);
  let start;
  const current = () => { try { const c = connection(); return !c.transition && c.epoch === start?.epoch; } catch { return false; } };
  try {
    if (opts?.method !== 'POST') return reply('E_BAD_ARGS', 400);
    start = { ...connection() }; if (start.transition) return reply('E_TARGET_CHANGED');
    const url = apiUrl(path, start.base, start.wsId, start.allowedWs);
    if (url.pathname !== '/api/workspace-spawn-preview') return reply('E_BAD_ARGS', 400);
    const init = apiInit({ method: 'POST', body: opts.body });
    if (typeof init.body !== 'string' || Buffer.byteLength(init.body) > 16384) return reply('E_BAD_ARGS', 400);
    const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(35000) }), raw = await response.text();
    if (!owns()) return reply('E_FORBIDDEN_FRAME', 403);
    if (!current()) return reply('E_TARGET_CHANGED');
    if (typeof raw !== 'string' || Buffer.byteLength(raw) > 4 * 1024 * 1024) return reply('E_CLI_OUTPUT_LIMIT');
    let value; try { value = JSON.parse(raw); } catch { return reply('E_CLI_PROTOCOL'); }
    if (value?.spawnPreviewViewApi !== 1) return reply('E_CLI_PROTOCOL');
    if (value.status === 'unavailable') return { ok: response.ok, status: response.status, body: previewFailure(value.reason?.code, value.target) };
    const target = previewTarget(value.target), data = previewData(value.data, target);
    if (!response.ok || value.status !== 'available' || !data || target.workspace !== url.searchParams.get('ws')) return reply('E_CLI_PROTOCOL');
    return { ok: true, status: response.status, body: { spawnPreviewViewApi: 1, status: 'available', target, data, reason: null } };
  } catch { return !owns() ? reply('E_FORBIDDEN_FRAME', 403) : reply(current() ? 'E_CLI_FAILED' : 'E_TARGET_CHANGED'); }
}
