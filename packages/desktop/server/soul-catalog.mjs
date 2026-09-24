/** The deployment's spawn catalog: `oats souls --json`, read only when the
 * workspace it describes moved (member/external commits, the workspace
 * commit) or the accepted CLI changed — never on every roster poll. One read
 * per deployment at a time; a failed read is retried after RETRY_MS, and the
 * last good catalog stays in place with the failure reported next to it. */
import { cliWorkspace } from '../workspace-cli.mjs';
import { soulsData } from '../deployment-data.mjs';

export const SOUL_CATALOG_RETRY_MS = 60_000;

export function soulCatalogKey(cli, workspaceStatus) {
  const ws = workspaceStatus || {};
  return JSON.stringify([cli?.bin ?? null, cli?.version ?? null, ws.workspace?.key ?? null, ws.workspace?.commit ?? null,
    (ws.members || []).map(m => [m.key ?? null, m.commit ?? null, m.status ?? null]),
    (ws.external || []).map(e => [e.source ?? null, e.soul ?? null])]);
}

export function createSoulCatalog({ invoke = cliWorkspace, now = () => Date.now() } = {}) {
  const held = new Map(), flights = new Map();
  async function read(deployment, cli, key) {
    let souls = null, reason = null;
    try {
      const result = await invoke(cli, { action: 'souls', context: deployment });
      if (result?.ok === true) souls = soulsData(result.document);
      else reason = result?.reason?.code ? { code: result.reason.code, message: String(result.reason.message || '') } : { code: 'E_CLI_FAILED', message: '' };
    } catch (error) { reason = { code: error?.code === 'E_CLI_PROTOCOL' ? 'E_CLI_PROTOCOL' : 'E_CLI_FAILED', message: '' }; }
    const last = held.get(deployment);
    const entry = souls
      ? { key, souls: souls.souls, ambiguous: souls.ambiguous, workspace: souls.workspace, problems: souls.problems, reason: null, at: now() }
      : { key, souls: last?.souls ?? null, ambiguous: last?.ambiguous ?? [], workspace: last?.workspace ?? null, problems: last?.problems ?? [], reason, at: now() };
    held.set(deployment, entry);
    return entry;
  }
  return {
    /** The catalog for this workspace state, reading it only when needed. */
    async observe(deployment, cli, workspaceStatus) {
      const key = soulCatalogKey(cli, workspaceStatus), last = held.get(deployment);
      if (last?.key === key && (!last.reason || now() - last.at < SOUL_CATALOG_RETRY_MS)) return structuredClone(last);
      let flight = flights.get(deployment);
      if (!flight || flight.key !== key) {
        flight = { key, promise: read(deployment, cli, key).finally(() => { if (flights.get(deployment) === flight) flights.delete(deployment); }) };
        flights.set(deployment, flight);
      }
      return structuredClone(await flight.promise);
    },
    /** The last catalog held for a deployment (admission reads this). */
    held(deployment) { const entry = held.get(deployment); return entry ? structuredClone(entry) : null; },
    forget(deployment) { held.delete(deployment); flights.delete(deployment); },
  };
}
