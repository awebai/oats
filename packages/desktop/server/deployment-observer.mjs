/** Native deployment observations with bounded admission and both-outcome
 * ownership. No cache, queued work, reader fallback or generation conversion. */
import { isAbsolute, resolve } from 'node:path';
import { cliDeploymentRead } from '../deployment-read-cli.mjs';
import { deploymentStatusData, workspaceStatusData, observationData } from '../deployment-data.mjs';
import { deploymentReadGate, deploymentFailure, validMaxAge } from '../renderer/deployment-contract.mjs';
export const MAX_DEPLOYMENT_OBSERVATIONS = 2; // each owns at most two CLI reads

/** Run `fn` over `items` with at most `limit` calls in flight, first come first served; results keep
 * the input order. The observation cycle reads every registered deployment through this, bounded by
 * the observer's own admission: starting them all in one tick left the third and later deployments
 * E_DEPLOYMENT_BUSY on every cycle, never read and shown as "pending" forever (#461). A slow
 * deployment holds one slot while the others go through the rest. */
export async function mapBounded(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const index = next++; results[index] = await fn(items[index], index); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}
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
  /** `maxAge` (feature observe-max-age) rides on both reads; the adapter drops it for a kernel
   * that does not declare the feature. Waiters coalesce on the stamp alone: a live (0) request
   * that joins a background flight accepts that flight's observation rather than doubling it. */
  function observe(id, { maxAge } = {}) {
    const captured = admit(id);
    if (!captured.ok) return Promise.resolve(captured);
    if (!validMaxAge(maxAge)) return Promise.resolve(deploymentFailure('E_BAD_ARGS'));
    let work = pending.get(captured.stamp);
    if (!work) {
      if (active >= MAX_DEPLOYMENT_OBSERVATIONS) return Promise.resolve(deploymentFailure('E_DEPLOYMENT_BUSY'));
      active++; // reserve synchronously, before any dispatch/await
      work = Promise.resolve().then(async () => {
        if (!current(captured)) return deploymentFailure('E_DEPLOYMENT_STALE');
        try {
          const settled = await Promise.allSettled(['status', 'workspace-status'].map(action => Promise.resolve().then(() => {
            if (!current(captured)) return deploymentFailure('E_DEPLOYMENT_STALE');
            return read(captured.cli, { action, context: captured.deployment, ...(maxAge !== undefined ? { maxAge } : {}) });
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
          // The observation's age is its OLDEST remote-head observation across both reads; a
          // kernel that reports none observed live, so the completion time is the truth.
          const stamps = [status, header].map(r => observationData(r.document).observedAt).filter(s => typeof s === 'string');
          const observedAt = stamps.length ? stamps.sort()[0] : new Date().toISOString();
          return { ok: true, deployment: captured.deployment, workspaceStatus, roster, observedAt };
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
