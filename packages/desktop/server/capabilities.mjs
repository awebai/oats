/** Provider inspection and mutations use the kernel's resolver, never a GUI copy. */
import { dirname, isAbsolute } from 'node:path';
import { cliCapability, cliList } from '../cli-adapter.mjs';

const fail = (message, code = 'E_BAD_ARGS') => { throw Object.assign(new Error(message), { code }); };

const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const absolute = value => typeof value === 'string' && isAbsolute(value) && !value.includes('\0');
const listFailureCodes = new Set(['E_CLI_PROTOCOL', 'E_CLI_TIMEOUT', 'E_CLI_OUTPUT_LIMIT', 'E_USAGE', 'invalid-lock', 'migration-required', 'unsupported-wire-version']);

/** Classic inventory only. Captured D/R facts remain the inspect contract, not
 * an inferred/empty list. There is deliberately no remote-to-local fallback. */
export function createInventoryBoundary({ invoke: defaultInvoke = cliList } = {}) {
  const byInvoker = new WeakMap();
  return async function inventoryRequest(request, { workspace, cli, agents = [], invoke = defaultInvoke } = {}) {
    if (!object(request) || request.action !== 'list' || Object.keys(request).some(k => !['action', 'selector'].includes(k))) fail('List accepts only an action and classic context selector');
    const selector = request.selector === undefined ? {} : request.selector;
    if (!object(selector) || Object.keys(selector).some(k => k !== 'context')) fail('List accepts only a classic context selector; use inspect for a soul or captured home');
    if (!workspace) fail('Select a known workspace', 'E_WORKSPACE_UNKNOWN');
    if (workspace.remote || workspace.server) fail('Classic inventory is not available for remote workspaces', 'unsupported-remote-operation');
    const contexts = [workspace.scope, ...agents.filter(a => !a.remote && !a.server && absolute(a.agentsRoot)).map(a => dirname(a.agentsRoot))];
    // Resolve from admitted server values, never normalize an arbitrary path
    // supplied by a client into an accepted scope.
    const requested = Object.hasOwn(selector, 'context') ? selector.context : workspace.scope;
    const context = contexts.find(c => absolute(c) && c === requested);
    if (!context) fail('Select a classic configuration scope in this workspace');
    if (cli?.ok !== true || !absolute(cli.bin)) fail('Select a compatible installed OATS CLI to read inventory', 'cli-unavailable');
    if (typeof invoke !== 'function') fail('The installed OATS CLI inventory read failed', 'E_CLI_FAILED');
    let pending = byInvoker.get(invoke);
    if (!pending) { pending = new Map(); byInvoker.set(invoke, pending); }
    const bin = cli.bin;
    const key = JSON.stringify([bin, cli.version, context]); // context is both --dir and cwd
    if (!pending.has(key)) {
      const read = Promise.resolve().then(() => invoke(bin, { context, localCwd: context }))
        .catch(() => ({ schemaVersion: 1, ok: false, error: { code: 'E_CLI_FAILED' } }))
        .then(envelope => {
          if (envelope?.schemaVersion !== 1 || envelope.ok !== true) {
            const code = listFailureCodes.has(envelope?.error?.code) ? envelope.error.code : 'E_CLI_FAILED';
            fail('The installed OATS CLI refused this classic inventory read; inspect the scope with the CLI or retry', code);
          }
          const result = envelope.result;
          if (!object(result) || !['packages', 'capabilities', 'legacy'].every(k => Array.isArray(result[k]) && result[k].every(object))
            || result.packages.some(p => typeof p.package !== 'string' || !p.package)
            || result.capabilities.some(c => typeof c.capability !== 'string' || !c.capability)
            || result.legacy.some(l => typeof l.file !== 'string' || !l.file)) fail('The installed OATS CLI returned an invalid inventory', 'E_CLI_PROTOCOL');
          return { inventoryApi: 1, scope: { kind: 'classic', context }, packages: result.packages, capabilities: result.capabilities, legacy: result.legacy };
        }).finally(() => pending.delete(key));
      pending.set(key, read);
    }
    return pending.get(key);
  };
}
const inventoryRequest = createInventoryBoundary();

export async function capabilityRequest(request, { workspace, cli, agents = [], instances = [], localCwd, invoke = cliCapability, invokeList = cliList }) {
  // Listing uses the classic list contract; operationsApi is NOT its gate.
  if (request?.action === 'list') return inventoryRequest(request, { workspace, cli, agents, invoke: invokeList });
  if (!workspace) fail('Select a known workspace', 'E_WORKSPACE_UNKNOWN');
  if (!cli?.ok || cli.operationsApi !== 1 || !cli.features?.includes('operations')) {
    fail('Update the installed OATS CLI to manage capabilities', 'cli-no-operations');
  }
  const server = workspace.server || undefined;
  if (workspace.remote && (!server || !workspace.registrationPresent || !cli.remote?.includes('operations'))) {
    fail('This workspace needs a registered server and remote operations support', 'cli-no-operations');
  }
  const { action, selector = {} } = request;
  if (!['inspect', 'use', 'set', 'run'].includes(action)) fail('Unknown capability action');
  let soul, agentsRoot, home;
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
    if (!['inspect', 'run'].includes(action)) fail('An instance snapshot is read-only; edit its soul defaults for future instances');
  } else if (selector.soul !== undefined) {
    const matches = agents.filter(a => a.name === selector.soul && a.agentsRoot === selector.agentsRoot);
    if (matches.length !== 1) fail('Select one soul and its agents root in this workspace');
    const agent = matches[0];
    soul = agent.name; agentsRoot = agent.agentsRoot;
    context = dirname(agentsRoot);
  } else if (selector.context !== undefined) {
    const contexts = new Set([workspace.scope, ...agents.filter(a => a.agentsRoot).map(a => dirname(a.agentsRoot))]);
    if (!contexts.has(selector.context)) fail('Select a configuration scope in this workspace');
    context = selector.context;
  }
  if (action === 'use' && soul && (request.binding?.action === 'none' || request.binding?.capability === 'none')) fail('Layer-wide defaults apply to the whole configuration scope; open workspace Capabilities to change them');
  if (action === 'set' && !soul) fail('Select a soul to edit');
  if (action === 'run' && !home && !soul) fail('Select a soul or home for this operation');
  const envelope = await invoke(cli.bin, {
    action, context, server, soul, agentsRoot, home,
    binding: request.binding, fields: request.fields, operation: request.operation,
    localCwd: server ? localCwd : context || workspace.scope,
  });
  if (!envelope.ok) fail(envelope.error?.message || 'Capability operation failed', envelope.error?.code || 'E_OPERATION_FAILED');
  return envelope.result;
}
