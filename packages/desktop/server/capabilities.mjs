/** Provider inspection and mutations use the kernel's resolver, never a GUI copy. An inspect is the shared
 * home's inspect boundary (packages/client/inspect-boundary.mjs); a provider operation (`run`) is the
 * Desktop's, admitted by the same function as an inspect. */
import { cliCapability } from '../../client/cli-adapter.mjs';
import { capabilityAdmission, capabilityCall, capabilityFailure, createInspectBoundary } from '../../client/inspect-boundary.mjs';

/** ctx.cache (an inspect cache), ctx.catalogKey (the workspace's soul-catalog key) and
    ctx.maxAge (seconds the kernel may reuse remote observations on a cache miss) are
    optional: without a cache every inspect reaches the CLI, as schedules.mjs expects.
    The boundary is made per call: it holds nothing, and the cache it reads is the backend's. */
export async function capabilityRequest(request, ctx) {
  try { return await capabilityAnswer(request, ctx); } catch (error) {
    // The Desktop reads a refusal's team labels for E_TEAM_CONFLICT only (the teams contract's conflict, sent by
    // kernels before 0.30): the boundary carries them from any refusal's details, and the Desktop keeps them for that one.
    if (error?.code !== 'E_TEAM_CONFLICT') delete error?.labels;
    throw error;
  }
}
async function capabilityAnswer(request, { workspace, cli, agents = [], instances = [], localCwd, invoke = cliCapability, cache, catalogKey = null, maxAge }) {
  const context = { workspace, cli, agents, instances, localCwd, catalogKey };
  if (request?.action === 'inspect') return createInspectBoundary({ invoke, cache: cache ?? null, maxAge }).inspect(request, context);
  const admitted = capabilityAdmission(request, context);
  let envelope;
  // A provider operation can change what inspect --home reports: the deployment's entries go, success or not.
  try { envelope = await invoke(cli.bin, capabilityCall(request, admitted, { workspace, cli, localCwd, maxAge })); } finally { cache?.invalidate(workspace.scope); }
  if (!envelope.ok) throw capabilityFailure(envelope, admitted);
  return envelope.result;
}
