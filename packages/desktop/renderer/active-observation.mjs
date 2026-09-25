/** Presentation of the existing /api/panel roster, not an activity/Git resolver. */
import { instanceId, distinguishingRootTags } from './instance-tree.mjs';
import { eventsTimestamp } from './instance-events-contract.mjs';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
const identityFields = ['home', 'agentsRoot', 'server'];
const displayed = ['agent', 'repoName', 'harness', 'branch', 'model', 'backend']; // model/backend preserve existing Start/Restart handoffs

export function projectActivePanel(panel) {
  if (!object(panel) || !Array.isArray(panel.instances)) throw new Error('The server did not report a roster.');
  if (panel.workspace != null && (!object(panel.workspace) || typeof panel.workspace.id !== 'string')) throw new Error('The roster did not report a valid workspace identity.');
  if (panel.error != null && typeof panel.error !== 'string') throw new Error('The server reported an unreadable roster error.');
  const seen = new Set();
  const instances = panel.instances.map(raw => {
    if (!object(raw) || typeof raw.instance !== 'string' || !raw.instance) throw new Error('The roster contains an invalid instance identity.');
    for (const key of identityFields) if (raw[key] != null && (typeof raw[key] !== 'string' || raw[key].includes('\0'))) throw new Error('The roster contains an invalid instance address.');
    const instance = { instance: raw.instance, running: panel.error ? null : raw.running === true ? true : raw.running === false ? false : null,
      savedRoute: raw.savedRoute === true, remote: raw.remote === true || panel.workspace?.remote === true,
      createdAt: eventsTimestamp(raw.createdAt) ? raw.createdAt : null };
    for (const key of [...identityFields, ...displayed]) instance[key] = text(raw[key]);
    for (const key of ['parentInstance', 'siblingInstance']) instance[key] = typeof raw[key] === 'string' ? raw[key] : '';
    const id = instanceId(instance);
    if (seen.has(id)) throw new Error('The roster contains duplicate instance identities; actions are unavailable.');
    seen.add(id);
    // TASK/STATE/transcript text, PR guesses, aggregate git stats, and any
    // unnegotiated activity/group-name fields are intentionally not consumed.
    return instance;
  });
  instances.sort((a, b) => instanceId(a).localeCompare(instanceId(b)));
  return { instances, workspace: object(panel.workspace) ? panel.workspace : null,
    workspaces: Array.isArray(panel.workspaces) ? panel.workspaces.filter(w => object(w) && typeof w.id === 'string') : [],
    generatedAt: text(panel.generatedAt), error: text(panel.error) };
}

export function activeSignature(panel) {
  // Time and unrelated metadata must not destroy a focused popup on each poll.
  return JSON.stringify([panel.workspace?.id, panel.workspace?.server, panel.workspace?.remote, panel.instances]);
}

export function canAddressInstance(instance) {
  if (!instance) return false;
  const absolute = value => typeof value === 'string' && value.startsWith('/') && !value.includes('\0');
  if (instance.home && !absolute(instance.home)) return false; // never fall back from a malformed primary address
  if (instance.agentsRoot && !absolute(instance.agentsRoot)) return false;
  return !!(absolute(instance.home) || absolute(instance.agentsRoot))
    && (!(instance.remote || instance.server) || (typeof instance.server === 'string' && !!instance.server && instance.savedRoute === true));
}

/** Display-only disambiguation, never a grouping key or a filesystem target. */
export function activeTargetLabel(instance, roster) {
  const twins = roster.filter(row => row.instance === instance.instance);
  const host = instance.server || (instance.remote ? 'host unknown' : 'local');
  if (twins.length < 2) return instance.server || instance.remote ? `@${host}` : '';
  const onHost = twins.filter(row => (row.server || '') === (instance.server || ''));
  const sameRoot = onHost.filter(row => row.agentsRoot === instance.agentsRoot);
  const scopes = sameRoot.length > 1 ? sameRoot.map(row => row.home) : onHost.map(row => row.agentsRoot || row.home);
  const scope = sameRoot.length > 1 ? instance.home : instance.agentsRoot || instance.home;
  const tag = distinguishingRootTags(scopes).get(scope) || scope || 'address unknown';
  return `${host} · ${tag}`;
}

export const BRAIN_UNAVAILABLE = 'Choose the exact soul in Workspace. The overview roster cannot qualify the name-only Brain reader against all soul definitions.';
