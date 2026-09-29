/** Provider inspection and mutations use the kernel's resolver, never a GUI copy. */
import { dirname, isAbsolute } from 'node:path';
import { cliCapability, operationArgs } from '../cli-adapter.mjs';
import { inspectKey } from './inspect-cache.mjs';
import { observationData } from '../deployment-data.mjs';
import { OBSERVE_MAX_AGE_FEATURE } from '../renderer/deployment-contract.mjs';

const fail = (message, code = 'E_BAD_ARGS') => { throw Object.assign(new Error(message), { code }); };

const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const TEAM_LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const absolute = value => typeof value === 'string' && isAbsolute(value) && !value.includes('\0');
/** ctx.cache (an inspect cache), ctx.catalogKey (the workspace's soul-catalog key) and
    ctx.maxAge (seconds the kernel may reuse remote observations on a cache miss) are
    optional: without a cache every inspect reaches the CLI, as schedules.mjs expects. */
export async function capabilityRequest(request, { workspace, cli, agents = [], instances = [], localCwd, invoke = cliCapability, cache, catalogKey = null, maxAge }) {
  if (!workspace) fail('Select a known workspace', 'E_WORKSPACE_UNKNOWN');
  // The probe integer is the gate (operationsApi 2: inspect on the workspace model).
  if (!cli?.ok || cli.operationsApi !== 2) {
    fail('Update the installed OATS CLI (inspection needs operations API 2)', 'cli-no-operations');
  }
  const server = workspace.server || undefined;
  if (workspace.remote && (!server || !workspace.registrationPresent || !cli.remote?.includes('operations'))) {
    fail('This workspace needs a registered server and remote operations support', 'cli-no-operations');
  }
  const { action, selector = {} } = request;
  // Read-only plus provider operations: a v2 soul is edited in its repository,
  // and workspace model v2 removed `oats use` (capabilities are declared).
  if (!['inspect', 'run'].includes(action)) fail('Unknown capability action');
  // Declared operation arguments only travel with a run (the kernel refuses undeclared ones).
  if (request.args !== undefined && (action !== 'run' || !operationArgs(request.args))) fail('Invalid operation arguments');
  // refresh (bypass the cached observation) is an inspect concern only.
  if (request.refresh !== undefined && (action !== 'inspect' || typeof request.refresh !== 'boolean')) fail('Invalid refresh flag');
  const refresh = request.refresh === true;
  let soul, agentsRoot, home, key;
  let context = workspace.scope;
  if (selector.home !== undefined) {
    if (selector.soul !== undefined || selector.agentsRoot !== undefined || selector.context !== undefined) fail('Select a soul or an instance home');
    const matches = instances.filter(i => i.home === selector.home);
    if (matches.length !== 1) fail('Select one existing home in this workspace');
    const instance = matches[0];
    if (server && !instance.savedRoute) fail('No saved route for this instance', 'E_SNAPSHOT_UNKNOWN');
    home = instance.home;
    // The owning agents root and the recorded work repository may differ.
    // --home is authoritative; the CLI derives its captured context.
    context = undefined;
    // Identity coordinates: a restarted or re-spawned seat under the same home is another subject.
    key = inspectKey({ deployment: workspace.scope, server, kind: 'home', home, instance: instance.instance,
      identity: [instance.createdAt, instance.startedAt, instance.soul, instance.modules] });
  } else if (selector.soul !== undefined) {
    const matches = agents.filter(a => a.name === selector.soul && a.agentsRoot === selector.agentsRoot);
    if (matches.length !== 1) fail('Select one soul and its agents root in this workspace');
    const agent = matches[0];
    soul = agent.name; agentsRoot = agent.agentsRoot;
    context = dirname(agentsRoot);
    key = inspectKey({ deployment: workspace.scope, server, kind: 'soul', soul, agentsRoot, catalogKey });
  } else fail('Select a soul or an instance home (inspection has no scope subject)');
  const call = () => invoke(cli.bin, {
    action, context, server, soul, agentsRoot, home,
    operation: request.operation, ...(request.args !== undefined ? { args: request.args } : {}),
    localCwd: server ? localCwd : context || workspace.scope,
    // --max-age travels only on a LOCAL inspect (reuse is local only: the kernel refuses it with --server)
    // and only when the probe declared observe-max-age (the adapter's call).
    ...(action === 'inspect' && !server && (refresh || maxAge !== undefined) ? { maxAge: refresh ? 0 : maxAge } : {}),
    features: cli.features,
  });
  let envelope, observedAt, refreshing = false;
  if (action === 'run') {
    // A provider operation can change what inspect --home reports: the deployment's entries go, success or not.
    try { envelope = await call(); } finally { cache?.invalidate(workspace.scope); }
  } else if (cache) {
    // A remote workspace has no state key and no invalidation signal here: its inspections are shared
    // between concurrent requests but never served from an earlier visit (store: false).
    // Live (observes the remotes afresh): a refresh, a routed inspect (reuse is local only, so it never carries
    // --max-age), or any read on a kernel without the feature. A refresh joins only a live flight.
    const live = refresh || !!server || !(Array.isArray(cli.features) && cli.features.includes(OBSERVE_MAX_AGE_FEATURE));
    ({ envelope, observedAt, refreshing } = await cache.read(key, { deployment: workspace.scope, refresh, produce: call, store: !server, live }));
  } else {
    envelope = await call();
    if (envelope.ok) observedAt = observationData(envelope).observedAt ?? new Date().toISOString();
  }
  if (!envelope.ok) {
    const code = envelope.error?.code || 'E_OPERATION_FAILED';
    const error = Object.assign(new Error(envelope.error?.message || 'Capability operation failed'), { code });
    // E_TEAM_CONFLICT (teams contract): the two disagreeing labels travel with the refusal, bounded.
    const labels = envelope.error?.details?.labels;
    if (code === 'E_TEAM_CONFLICT' && Array.isArray(labels) && labels.length >= 2 && labels.length <= 16
      && labels.every(l => typeof l === 'string' && TEAM_LABEL.test(l))) error.labels = [...labels];
    throw error;
  }
  return action === 'inspect' ? { ...envelope.result, observedAt, refreshing } : envelope.result;
}
