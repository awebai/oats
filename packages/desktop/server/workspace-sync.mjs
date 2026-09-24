/** POST /api/workspace-sync — the Desktop's workspace-v2 sync surface.
 *   { action: "read" }  → `oats capabilities` (the catalog table)
 *   { action: "sync" }  → `oats sync` (resolve, fetch and write the lock)
 * Results RESOLVE with a stable shape; nothing here re-derives kernel logic.
 * There is no package approval: declaring a package in `packages:` is the
 * trust decision (packages-no-approval). */
import { cliWorkspace, workspaceGate, workspaceFailure } from '../workspace-cli.mjs';
import { syncData, capabilitiesData } from '../deployment-data.mjs';

export const WORKSPACE_SYNC_API = 1;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const MESSAGES = {
  E_WORKSPACE_UNKNOWN: 'Select a registered local deployment.',
  E_SYNC_BUSY: 'A sync is already running for this deployment. Wait for it to finish.',
  E_BAD_ARGS: 'The workspace request was not valid.',
};
export function syncFailure(code, status = 'unavailable', message) {
  return { workspaceSyncApi: WORKSPACE_SYNC_API, status, report: null, capabilities: null,
    reason: { code, message: message || MESSAGES[code] || workspaceFailure(code).reason.message } };
}
/** A kernel error envelope (its own E_* code), as opposed to a Desktop-side
 * transport/probe failure from workspace-cli.mjs. */
const LOCAL_CODES = new Set(['E_CLI_UNAVAILABLE', 'E_WORKSPACE_FEATURE', 'E_CLI_FAILED', 'E_CLI_PROTOCOL', 'E_CLI_TIMEOUT', 'E_CLI_OUTPUT_LIMIT']);
const kernelRefusal = result => typeof result?.reason?.code === 'string' && !LOCAL_CODES.has(result.reason.code)
  && typeof result.reason.message === 'string';
const cliStamp = cli => JSON.stringify([cli?.bin ?? null, cli?.version ?? null]);

export function createWorkspaceSyncBoundary({ invoke = cliWorkspace } = {}) {
  const running = new Set();              // deployments with a sync in flight
  const reads = new Map();                // stamp → pending catalog read (coalesced)

  function context(workspace, cli) {
    if (!workspace || workspace.remote || workspace.server || typeof workspace.scope !== 'string') return { failure: syncFailure('E_WORKSPACE_UNKNOWN') };
    const gate = workspaceGate(cli);
    if (gate) return { failure: syncFailure(gate.reason.code) };
    return { deployment: workspace.scope, cli: { ok: true, bin: cli.bin, version: cli.version, workspaceApi: cli.workspaceApi, features: [...cli.features] } };
  }
  function refusal(result) {
    return { workspaceSyncApi: WORKSPACE_SYNC_API, status: 'refused', report: null, capabilities: null, reason: result.reason };
  }
  async function read(ctx) {
    const key = JSON.stringify([ctx.deployment, cliStamp(ctx.cli)]);
    if (!reads.has(key)) {
      reads.set(key, Promise.resolve().then(() => invoke(ctx.cli, { action: 'capabilities', context: ctx.deployment }))
        .then(result => {
          if (!result?.ok) return kernelRefusal(result) ? refusal(result) : syncFailure(result?.reason?.code || 'E_CLI_FAILED');
          try { return { workspaceSyncApi: WORKSPACE_SYNC_API, status: 'ok', report: null, capabilities: capabilitiesData(result.document), reason: null }; }
          catch { return syncFailure('E_CLI_PROTOCOL'); }
        }, () => syncFailure('E_CLI_FAILED'))
        .finally(() => reads.delete(key)));
    }
    return structuredClone(await reads.get(key));
  }
  async function mutate(ctx, options) {
    if (running.has(ctx.deployment)) return syncFailure('E_SYNC_BUSY', 'busy');
    running.add(ctx.deployment);
    try {
      let result;
      try { result = await invoke(ctx.cli, options); } catch { result = workspaceFailure('E_CLI_FAILED'); }
      // The kernel refused (integrity, drift, discovery…): its code/message verbatim.
      if (!result?.ok) return kernelRefusal(result) ? refusal(result) : syncFailure(result?.reason?.code || 'E_CLI_FAILED');
      let report;
      try { report = syncData(result.document, ctx.deployment); } catch { return syncFailure('E_CLI_PROTOCOL'); }
      return { workspaceSyncApi: WORKSPACE_SYNC_API, status: 'ok', report, capabilities: null, reason: null };
    } finally { running.delete(ctx.deployment); }
  }
  return async function workspaceSyncRequest(request, { workspace, cli } = {}) {
    if (!record(request) || !['read', 'sync'].includes(request.action)) return syncFailure('E_BAD_ARGS');
    if (Object.keys(request).some(key => key !== 'action')) return syncFailure('E_BAD_ARGS');
    const ctx = context(workspace, cli);
    if (ctx.failure) return ctx.failure;
    if (request.action === 'read') return read(ctx);
    return mutate(ctx, { action: 'sync', context: ctx.deployment });
  };
}
