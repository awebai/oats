/** K1 admission boundary for the hardened, installed CLI.
 * All authority comes from an exact server-owned workspace/roster record. */
import { admitInstance, instanceSelector, absolute } from './instance-admission.mjs';
import { cliInstanceGit, gitReadFailure } from '../cli-adapter.mjs';
import { parseSemver } from '../cli-locator.mjs';
import { forgeObservation } from './forge-observation.mjs';
import { INSTANCE_GIT_MINIMUM_VERSION, gitFileId, gitRevision, gitIndexRevision, gitState, gitDiff } from '../renderer/instance-git-contract.mjs';

const object = v => !!v && typeof v === 'object' && !Array.isArray(v);
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
  return instanceSelector(v.selector)
    && (v.action !== 'diff' || gitFileId(v.fileId) && gitRevision(v.revision) && gitIndexRevision(v.indexRevision));
}
function supported(cli) {
  const version = parseSemver(cli?.version), floor = parseSemver(INSTANCE_GIT_MINIMUM_VERSION).nums;
  return version && !version.prerelease && (version.nums[0] - floor[0] || version.nums[1] - floor[1] || version.nums[2] - floor[2]) >= 0;
}

/** Shared admission only: no process, fallback workspace or caller-owned cwd. */
export function admitInstanceGit(request, { workspace, instances = [], cli } = {}) {
    const denied = (target, code) => ({ failure: unavailable(target, code) });
    if (!validRequest(request)) return denied(null, 'E_BAD_ARGS');
    const admitted = admitInstance(request.selector, { workspace, instances, cli });
    if (admitted.code) return denied(admitted.target, admitted.code);
    const { target, context, bin } = admitted;
    if (!supported(cli)) return denied(target, 'cli-no-instance-git');
    const action = request.action;
    const selection = action === 'diff' ? { fileId: request.fileId, revision: request.revision, indexRevision: request.indexRevision } : {};
    return { target, action, context, bin, selection, options: { action, instance: target.instance, home: target.home, context, ...selection } };
}

/** Four flights total per boundary, even across invokers/CLIs/targets. Identical
 * requests coalesce before the cap; fulfilled and rejected flights both leave. */
export function createInstanceGitBoundary({ invoke: defaultInvoke = cliInstanceGit } = {}) {
  const byInvoker = new WeakMap(); let flights = 0;
  return async function instanceGitRequest(request, { workspace, instances = [], cli, invoke = defaultInvoke } = {}) {
    const admitted = admitInstanceGit(request, { workspace, instances, cli });
    if (admitted.failure) return admitted.failure;
    const { target, action, context, bin, selection, options } = admitted;
    if (typeof invoke !== 'function') return unavailable(target, 'E_CLI_FAILED');
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
      return { ...wrap(target, data), ...(action === 'git' ? { observationKey: forgeObservation(envelope.result, target, cli).observationKey } : {}) };
    }).catch(() => unavailable(target, 'E_CLI_FAILED')).finally(() => { pending.delete(key); flights--; });
    pending.set(key, read);
    return read;
  };
}

export const instanceGitRequest = createInstanceGitBoundary();
