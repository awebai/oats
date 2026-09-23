/** Renderer intent identity, never a filesystem/command authority. */
import { absolute, record } from './readiness-contract.mjs';
import { eventsTimestamp } from './instance-events-contract.mjs';
const name = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(v);
const workspaceId = v => typeof v === 'string' && v.length > 0 && v.length <= 4096 && !/[\x00-\x1f\x7f]/.test(v);
const fields = ['workspace', 'instance', 'agent', 'agentsRoot', 'home', 'server', 'incarnation'];
export function instanceActionTarget(workspace, row, { requireBirth = false } = {}) {
  if (!workspaceId(workspace) || !record(row) || !name(row.instance) || !name(row.agent) || !absolute(row.home) || !absolute(row.agentsRoot)
    || row.remote && !row.server
    || !(row.server == null || row.server === '' || typeof row.server === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(row.server))
    || !(row.createdAt == null && !requireBirth || eventsTimestamp(row.createdAt))) return null;
  return { workspace, instance: row.instance, agent: row.agent, agentsRoot: row.agentsRoot, home: row.home,
    server: row.server || null, incarnation: row.createdAt ?? null };
}
export function sameInstanceActionTarget(target, row, workspace) {
  const current = instanceActionTarget(workspace, row);
  return !!current && !!target && fields.every(k => target[k] === current[k]);
}
export function spawnOpenDescriptor(v) {
  if (!record(v) || Object.keys(v).some(k => !['kind', 'target', 'connectionEpoch'].includes(k)) || v.kind !== 'open-instance'
    || !Number.isSafeInteger(v.connectionEpoch) || v.connectionEpoch < 0 || !record(v.target) || Object.keys(v.target).some(k => !fields.includes(k))) return null;
  const target = instanceActionTarget(v.target.workspace, { ...v.target, createdAt: v.target.incarnation }, { requireBirth: true });
  return target ? { kind: 'open-instance', target, connectionEpoch: v.connectionEpoch } : null;
}
