/** POST /api/workspace-sync — the Desktop's workspace-v2 sync surface.
 *   { action: "read" }                 → `oats capabilities` (the catalog table)
 *   { action: "sync" }                 → `oats sync` (lock written; approvals listed)
 *   { action: "approve", approvals }   → `oats sync --approve <id>@<version>…`
 * Results RESOLVE with a stable shape; nothing here re-derives kernel logic.
 *
 * Approval binding: an approval is admitted only when every requested row
 * EXACTLY matches (id, version, executables digest) a row of the latest sync
 * report this server received for the same deployment and CLI. The operator
 * approves what the kernel showed them; a moved package, another CLI or a
 * newer sync makes the review stale instead of approving something unseen. */
import { cliWorkspace, workspaceGate, workspaceFailure, PACKAGE_ID, PACKAGE_VERSION } from '../workspace-cli.mjs';
import { syncData, capabilitiesData } from '../deployment-data.mjs';

export const WORKSPACE_SYNC_API = 1;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const DIGEST = /^sha256-[0-9a-f]{64}$/;
const MESSAGES = {
  E_WORKSPACE_UNKNOWN: 'Select a registered local deployment.',
  E_SYNC_BUSY: 'A sync is already running for this deployment. Wait for it to finish.',
  E_APPROVAL_STALE: 'The approval you reviewed no longer matches the latest sync. Sync again and review the current packages.',
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
  const running = new Set();              // deployments with a mutation in flight
  const reports = new Map();              // deployment → { stamp, approvalNeeded }
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
      if (!result?.ok) {
        // The kernel refused: its code/message verbatim. Any held review is
        // no longer trustworthy after a refused mutation.
        reports.delete(ctx.deployment);
        return kernelRefusal(result) ? refusal(result) : syncFailure(result?.reason?.code || 'E_CLI_FAILED');
      }
      let report;
      try { report = syncData(result.document, ctx.deployment); } catch {
        reports.delete(ctx.deployment); return syncFailure('E_CLI_PROTOCOL');
      }
      // exit 2 ⇔ approvals pending; the report must agree with the exit.
      if (result.pending !== report.approvalNeeded.length > 0) { reports.delete(ctx.deployment); return syncFailure('E_CLI_PROTOCOL'); }
      reports.set(ctx.deployment, { stamp: cliStamp(ctx.cli), approvalNeeded: report.approvalNeeded });
      return { workspaceSyncApi: WORKSPACE_SYNC_API, status: result.pending ? 'pending' : 'ok', report, capabilities: null, reason: null };
    } finally { running.delete(ctx.deployment); }
  }
  function admitApprovals(ctx, approvals) {
    if (!Array.isArray(approvals) || !approvals.length || approvals.length > 100) return null;
    const held = reports.get(ctx.deployment);
    if (!held || held.stamp !== cliStamp(ctx.cli)) return false;
    const seen = new Set(), rows = [];
    for (const row of approvals) {
      if (!record(row) || Object.keys(row).some(k => !['id', 'version', 'executables'].includes(k))) return null;
      if (!PACKAGE_ID.test(row.id ?? '') || !PACKAGE_VERSION.test(row.version ?? '') || !DIGEST.test(row.executables ?? '') || seen.has(row.id)) return null;
      seen.add(row.id);
      const shown = held.approvalNeeded.find(item => item.id === row.id);
      if (!shown || shown.version !== row.version || shown.executables !== row.executables) return false;
      rows.push({ id: row.id, version: row.version });
    }
    return rows;
  }

  return async function workspaceSyncRequest(request, { workspace, cli } = {}) {
    if (!record(request) || !['read', 'sync', 'approve'].includes(request.action)) return syncFailure('E_BAD_ARGS');
    const allowed = request.action === 'approve' ? ['action', 'approvals'] : ['action'];
    if (Object.keys(request).some(key => !allowed.includes(key))) return syncFailure('E_BAD_ARGS');
    const ctx = context(workspace, cli);
    if (ctx.failure) return ctx.failure;
    if (request.action === 'read') return read(ctx);
    if (request.action === 'sync') return mutate(ctx, { action: 'sync', context: ctx.deployment });
    const rows = admitApprovals(ctx, request.approvals);
    if (rows === null) return syncFailure('E_BAD_ARGS');
    if (rows === false) return syncFailure('E_APPROVAL_STALE', 'refused');
    return mutate(ctx, { action: 'approve', context: ctx.deployment, approvals: rows });
  };
}
