/** Native deployment observations with bounded admission and both-outcome
 * ownership. No cache, queued work, reader fallback or generation conversion. */
import { isAbsolute, resolve } from 'node:path';
import { cliDeploymentRead } from '../deployment-read-cli.mjs';
import { deploymentStatusData, workspaceStatusData } from '../deployment-data.mjs';
import { deploymentReadGate, deploymentFailure } from '../renderer/deployment-contract.mjs';
export const MAX_DEPLOYMENT_OBSERVATIONS = 2; // each owns at most two CLI reads
const absolute = value => typeof value === 'string' && !value.includes('\0') && isAbsolute(value) && resolve(value) === value;

/** getContext(id) is the owner's registry lookup, not renderer data. revision
 * must change on CLI/registry invalidation. Pending revoked reads retain their
 * slots until settlement; a new epoch cannot bypass the resource bound. */
export function createDeploymentObserver({ getContext, read = cliDeploymentRead }) {
  const pending = new Map(); let active = 0, alive = true;
  function admit(id) {
    if (!alive) return deploymentFailure('E_DEPLOYMENT_STALE');
    let value;
    try { value = getContext(id); } catch { return deploymentFailure('E_BAD_ARGS'); }
    if (!value || value.deployment !== id || !absolute(id) || !Number.isSafeInteger(value.revision) || value.revision < 0) return deploymentFailure('E_BAD_ARGS');
    const gate = deploymentReadGate(value.cli, 'status');
    if (gate) return gate;
    const cli = { ok: value.cli.ok, bin: value.cli.bin, version: value.cli.version,
      workspaceApi: value.cli.workspaceApi, features: [...value.cli.features] };
    const stamp = JSON.stringify([id, value.revision, cli]);
    return { ok: true, deployment: id, cli, stamp };
  }
  const current = captured => { const next = admit(captured.deployment); return next.ok && next.stamp === captured.stamp; };
  function observe(id) {
    const captured = admit(id);
    if (!captured.ok) return Promise.resolve(captured);
    let work = pending.get(captured.stamp);
    if (!work) {
      if (active >= MAX_DEPLOYMENT_OBSERVATIONS) return Promise.resolve(deploymentFailure('E_DEPLOYMENT_BUSY'));
      active++; // reserve synchronously, before any dispatch/await
      work = Promise.resolve().then(async () => {
        if (!current(captured)) return deploymentFailure('E_DEPLOYMENT_STALE');
        try {
          const settled = await Promise.allSettled(['status', 'workspace-status'].map(action => Promise.resolve().then(() => {
            if (!current(captured)) return deploymentFailure('E_DEPLOYMENT_STALE');
            return read(captured.cli, { action, context: captured.deployment });
          })));
          // Even a rejecting invoker keeps this reservation until its sibling
          // read settles. Promise.all would release resources prematurely.
          if (!current(captured)) return deploymentFailure('E_DEPLOYMENT_STALE');
          if (settled.some(result => result.status === 'rejected')) return deploymentFailure('E_CLI_PROTOCOL');
          const [status, header] = settled.map(result => result.value);
          if (!status?.ok) return status || deploymentFailure('E_CLI_PROTOCOL');
          if (!header?.ok) return header || deploymentFailure('E_CLI_PROTOCOL');
          const workspaceStatus = workspaceStatusData(header.document, captured.deployment);
          const roster = deploymentStatusData(status.document, captured.deployment);
          return { ok: true, deployment: captured.deployment, workspaceStatus, roster };
        } catch (error) {
          if (!current(captured)) return deploymentFailure('E_DEPLOYMENT_STALE');
          return deploymentFailure(error?.code === 'E_DEPLOYMENT_SCOPE' ? 'E_DEPLOYMENT_SCOPE' : 'E_CLI_PROTOCOL');
        }
      }).finally(() => { pending.delete(captured.stamp); active--; });
      pending.set(captured.stamp, work);
    }
    // Each waiter owns its copy; a renderer/request cannot mutate another's
    // observation or the retained private producer bytes.
    return work.then(result => current(captured) ? structuredClone(result) : deploymentFailure('E_DEPLOYMENT_STALE'));
  }
  return { observe, dispose() { alive = false; } };
}
