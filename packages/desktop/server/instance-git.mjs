/** K1 admission boundary for the hardened, installed CLI.
 * All authority comes from an exact server-owned workspace/roster record. */
import { isAbsolute, basename } from 'node:path';
import { cliInstanceGit, gitReadFailure } from '../cli-adapter.mjs';
import { parseSemver } from '../cli-locator.mjs';
import { INSTANCE_GIT_MINIMUM_VERSION, gitFileId, gitRevision, gitIndexRevision, gitState, gitDiff, gitTarget } from '../renderer/instance-git-contract.mjs';

const object = v => !!v && typeof v === 'object' && !Array.isArray(v);
const absolute = v => typeof v === 'string' && isAbsolute(v) && !v.includes('\0');
const name = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v);
const host = v => v === null || v === undefined || typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(v);
const localMessages = {
  E_BAD_ARGS: 'Git inspection accepts only a qualified instance selector and opaque diff selection',
  E_WORKSPACE_UNKNOWN: 'Select a workspace advertised by this server',
  'cli-unavailable': 'Select a compatible installed OATS CLI to inspect Git',
  'cli-no-instance-git': `Git inspection requires OATS ${INSTANCE_GIT_MINIMUM_VERSION} or newer`,
  'unsupported-remote-operation': 'Remote Git inspection is unavailable; no local fallback was used',
  E_GIT_BUSY: 'Git inspection is busy; retry after a pending read completes',
};
const wrap = (target, data = null, reason = null) => ({
  instanceGitApi: 1, minimumVersion: INSTANCE_GIT_MINIMUM_VERSION,
  status: reason ? reason.code === 'E_STALE_OBSERVATION' ? 'stale' : 'unavailable' : 'available', target, data, reason,
});
function unavailable(target, code, details) {
  if (Object.hasOwn(localMessages, code)) return wrap(target, null, { code, message: localMessages[code] });
  const safe = gitReadFailure(code, details).error;
  return wrap(target, null, { code: safe.code, message: safe.message,
    ...(safe.details?.observation ? { observation: safe.details.observation } : {}) });
}
function validRequest(v) {
  if (!object(v) || !['git', 'diff'].includes(v.action) || !object(v.selector)) return false;
  const allowed = v.action === 'diff' ? ['action', 'selector', 'fileId', 'revision', 'indexRevision'] : ['action', 'selector'];
  if (Object.keys(v).some(k => !allowed.includes(k)) || Object.keys(v.selector).some(k => !['instance', 'agent', 'agentsRoot', 'server'].includes(k))) return false;
  const s = v.selector;
  return name(s.instance) && name(s.agent) && absolute(s.agentsRoot) && host(s.server)
    && (v.action !== 'diff' || gitFileId(v.fileId) && gitRevision(v.revision) && gitIndexRevision(v.indexRevision));
}
function supported(cli) {
  const version = parseSemver(cli?.version), floor = parseSemver(INSTANCE_GIT_MINIMUM_VERSION).nums;
  return version && !version.prerelease && (version.nums[0] - floor[0] || version.nums[1] - floor[1] || version.nums[2] - floor[2]) >= 0;
}

/** Four flights total per boundary, even across invokers/CLIs/targets. Identical
 * requests coalesce before the cap; fulfilled and rejected flights both leave. */
export function createInstanceGitBoundary({ invoke: defaultInvoke = cliInstanceGit } = {}) {
  const byInvoker = new WeakMap(); let flights = 0;
  return async function instanceGitRequest(request, { workspace, instances = [], cli, invoke = defaultInvoke } = {}) {
    if (!validRequest(request)) return unavailable(null, 'E_BAD_ARGS');
    if (!workspace || typeof workspace.id !== 'string' || !workspace.id || !absolute(workspace.scope)) return unavailable(null, 'E_WORKSPACE_UNKNOWN');
    const selector = request.selector, wantedHost = selector.server ?? null;
    const matches = (Array.isArray(instances) ? instances : []).filter(i => object(i) && host(i.server)
      && i.instance === selector.instance && i.agent === selector.agent && i.agentsRoot === selector.agentsRoot && (i.server ?? null) === wantedHost);
    if (matches.length !== 1) return unavailable(null, matches.length ? 'E_AMBIGUOUS_INSTANCE' : 'E_SESSION_UNKNOWN');
    const instance = matches[0];
    if (!absolute(instance.home) || basename(instance.home) !== instance.instance) return unavailable(null, 'E_HOME_MISMATCH');
    const target = gitTarget({ workspace: workspace.id, instance: instance.instance, agent: instance.agent, agentsRoot: instance.agentsRoot, home: instance.home, server: instance.server ?? null });
    if (!target) return unavailable(null, 'E_HOME_MISMATCH');
    if (workspace.remote || workspace.server || instance.remote || target.server) return unavailable(target, 'unsupported-remote-operation');
    if (cli?.ok !== true || !absolute(cli.bin)) return unavailable(target, 'cli-unavailable');
    if (!supported(cli)) return unavailable(target, 'cli-no-instance-git');
    if (typeof invoke !== 'function') return unavailable(target, 'E_CLI_FAILED');
    const action = request.action, context = workspace.scope, bin = cli.bin;
    const selection = action === 'diff' ? { fileId: request.fileId, revision: request.revision, indexRevision: request.indexRevision } : {};
    const options = { action, instance: target.instance, home: target.home, context, ...selection };
    const key = JSON.stringify([bin, cli.version, workspace.id, context, target.home, target.instance, target.agent, target.agentsRoot, target.server, action, selection]);
    let pending = byInvoker.get(invoke);
    if (!pending) { pending = new Map(); byInvoker.set(invoke, pending); }
    if (pending.has(key)) return pending.get(key);
    if (flights >= 4) return unavailable(target, 'E_GIT_BUSY');
    flights++;
    const read = Promise.resolve().then(() => invoke(bin, options)).then(envelope => {
      if (envelope?.schemaVersion !== 1 || typeof envelope.ok !== 'boolean') return unavailable(target, 'E_CLI_PROTOCOL');
      if (!envelope.ok) return unavailable(target, envelope.error?.code, envelope.error?.details);
      const data = action === 'git' ? gitState(envelope.result, target) : gitDiff(envelope.result, selection);
      if (!data || !absolute(data.observation.worktree)) return unavailable(target, 'E_CLI_PROTOCOL');
      return wrap(target, data);
    }).catch(() => unavailable(target, 'E_CLI_FAILED')).finally(() => { pending.delete(key); flights--; });
    pending.set(key, read);
    return read;
  };
}

export const instanceGitRequest = createInstanceGitBoundary();
