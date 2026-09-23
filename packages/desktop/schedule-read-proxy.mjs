/** K8 read IPC: exact explicit workspace, trusted frame/navigation, copied
 * server epoch, bounded streaming reply, and public DTO reprojection. */
import { apiUrl, apiInit } from './api-url.mjs';
import { trustedForgeFrame } from './forge-proxy.mjs';
import { absolute } from './renderer/readiness-contract.mjs';
import { scheduleReadRequest, scheduleReadAlias, scheduleReadFailure } from './renderer/schedule-read-contract.mjs';
import { scheduleReadData } from './renderer/schedule-read-data.mjs';
export const SCHEDULE_PROXY_TIMEOUT = 35_000;
const MAX_BODY = 4 * 1024 * 1024;
/** Main's normalized legacy route classifier. Never let a malformed read
 * alias fall through a weaker generic transport. Mutation verbs stay separate. */
export function isScheduleReadAlias(opts) {
  if (opts?.method !== 'POST' || typeof opts.body === 'string' && Buffer.byteLength(opts.body) > 65536) return true;
  try { const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body; return ['list', 'show'].includes(body?.operation); }
  catch { return true; }
}
async function boundedText(response) {
  if (!response.body) return '';
  const reader = response.body.getReader(), chunks = []; let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw Object.assign(Error(), { code: 'E_CLI_PROTOCOL' });
      bytes += value.byteLength;
      if (bytes > MAX_BODY) { await reader.cancel(); throw Object.assign(Error(), { code: 'E_CLI_OUTPUT_LIMIT' }); }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, bytes).toString('utf8');
  } finally { reader.releaseLock(); }
}
export async function proxyScheduleRead(event, path, opts, { rendererURL, connection, fetch: fetcher = globalThis.fetch } = {}) {
  const reply = (code, status = 503) => ({ ok: false, status, body: { ...scheduleReadFailure(code), workspace: null } });
  let frame; try { frame = event?.senderFrame; } catch { return reply('E_FORBIDDEN_FRAME', 403); }
  const owns = () => { try { return trustedForgeFrame(event, rendererURL) && event.sender.mainFrame === frame; } catch { return false; } };
  if (!owns()) return reply('E_FORBIDDEN_FRAME', 403);
  let start;
  const current = () => { try { const c = connection(); return !c.transition && c.epoch === start?.epoch && c.base === start?.base && c.wsId === start?.wsId; } catch { return false; } };
  try {
    if (opts?.method !== 'POST') return reply('E_METHOD_NOT_ALLOWED', 405);
    start = { ...connection() }; if (start.transition) return reply('E_TARGET_CHANGED');
    let url, input, init, workspace;
    try {
      // Do not turn a missing/unknown schedule selector into a different workspace.
      url = apiUrl(path, start.base);
      if (!['/api/workspace-schedules', '/api/schedules'].includes(url.pathname) || url.searchParams.getAll('ws').length !== 1
        || !url.searchParams.get('ws') || [...url.searchParams.keys()].some(k => k !== 'ws')) return reply('E_BAD_ARGS', 400);
      workspace = url.searchParams.get('ws');
      if (workspace !== start.wsId && !(start.allowedWs instanceof Set && start.allowedWs.has(workspace))) return reply('E_WORKSPACE_UNKNOWN', 400);
      init = apiInit({ method: 'POST', body: opts.body });
      if (typeof init.body !== 'string' || Buffer.byteLength(init.body) > 16384) return reply('E_BAD_ARGS', 400);
      const body = JSON.parse(init.body);
      input = url.pathname === '/api/schedules' ? scheduleReadAlias(body) : scheduleReadRequest(body);
      if (!input) return reply('E_BAD_ARGS', 400);
    } catch { return reply('E_BAD_ARGS', 400); }
    const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(SCHEDULE_PROXY_TIMEOUT) });
    const raw = await boundedText(response);
    if (!owns()) return reply('E_FORBIDDEN_FRAME', 403);
    if (!current()) return reply('E_TARGET_CHANGED');
    let value; try { value = JSON.parse(raw); } catch { return reply('E_CLI_PROTOCOL'); }
    if (value?.scheduleReadViewApi !== 1 || value.workspace !== null && value.workspace !== workspace
      || value.scope !== null && !absolute(value.scope)) return reply('E_CLI_PROTOCOL');
    if (value.status === 'unavailable') return { ok: response.ok, status: response.status,
      body: { ...scheduleReadFailure(value.reason?.code, value.scope, value.reason?.details), workspace: value.workspace } };
    const data = value.workspace === workspace && scheduleReadData(value.data, value.scope, input, { publicView: true });
    if (!response.ok || value.status !== 'available' || !data) return reply('E_CLI_PROTOCOL');
    return { ok: true, status: response.status, body: { scheduleReadViewApi: 1, status: 'available', workspace, scope: value.scope, data, reason: null } };
  } catch (error) {
    if (!owns()) return reply('E_FORBIDDEN_FRAME', 403);
    if (!current()) return reply('E_TARGET_CHANGED');
    return reply(['E_CLI_OUTPUT_LIMIT', 'E_CLI_PROTOCOL'].includes(error?.code) ? error.code : error?.name === 'TimeoutError' ? 'E_CLI_TIMEOUT' : 'E_CLI_FAILED');
  }
}
