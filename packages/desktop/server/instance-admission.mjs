/** Shared qualified roster authority. No filesystem, kernel import or process.
 * Individual operations negotiate their own CLI feature/API after admission. */
import { isAbsolute, basename } from 'node:path';
import { gitTarget } from '../renderer/instance-git-contract.mjs';
export const record = v => !!v && typeof v === 'object' && !Array.isArray(v);
export const absolute = v => typeof v === 'string' && isAbsolute(v) && !v.includes('\0');
const name = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v);
const host = v => v === null || v === undefined || typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(v);
export function instanceSelector(v) {
  return record(v) && Object.keys(v).every(k => ['instance', 'agent', 'agentsRoot', 'server'].includes(k))
    && name(v.instance) && name(v.agent) && absolute(v.agentsRoot) && host(v.server);
}
export function admitInstance(selector, { workspace, instances = [], cli } = {}) {
  const denied = (code, target = null) => ({ code, target });
  if (!instanceSelector(selector)) return denied('E_BAD_ARGS');
  if (!workspace || typeof workspace.id !== 'string' || !workspace.id || !absolute(workspace.scope)) return denied('E_WORKSPACE_UNKNOWN');
  const matches = (Array.isArray(instances) ? instances : []).filter(i => record(i) && host(i.server)
    && i.instance === selector.instance && i.agent === selector.agent && i.agentsRoot === selector.agentsRoot && (i.server ?? null) === (selector.server ?? null));
  if (matches.length !== 1) return denied(matches.length ? 'E_AMBIGUOUS_INSTANCE' : 'E_SESSION_UNKNOWN');
  const instance = matches[0];
  if (!absolute(instance.home) || basename(instance.home) !== instance.instance) return denied('E_HOME_MISMATCH');
  const target = gitTarget({ workspace: workspace.id, instance: instance.instance, agent: instance.agent,
    agentsRoot: instance.agentsRoot, home: instance.home, server: instance.server ?? null });
  if (!target) return denied('E_HOME_MISMATCH');
  if (workspace.remote || workspace.server || instance.remote || target.server) return denied('unsupported-remote-operation', target);
  if (cli?.ok !== true || !absolute(cli.bin)) return denied('cli-unavailable', target);
  return { target, context: workspace.scope, bin: cli.bin };
}
