/** Provider inspection and mutations use the kernel's resolver, never a GUI copy. */
import { dirname } from 'node:path';
import { cliCapability } from '../cli-adapter.mjs';

const fail = (message, code = 'E_BAD_ARGS') => { throw Object.assign(new Error(message), { code }); };

export async function capabilityRequest(request, { workspace, cli, agents = [], instances = [], localCwd, invoke = cliCapability }) {
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
    if (selector.soul !== undefined || selector.agentsRoot !== undefined) fail('Select a soul or an instance home');
    const matches = instances.filter(i => i.home === selector.home);
    if (matches.length !== 1) fail('Select one existing home in this workspace');
    const instance = matches[0];
    if (server && !instance.savedRoute) fail('No saved route for this instance', 'E_SNAPSHOT_UNKNOWN');
    home = instance.home;
    context = instance.agentsRoot ? dirname(instance.agentsRoot) : workspace.scope;
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
  if (action === 'set' && !soul) fail('Select a soul to edit');
  if (action === 'run' && !home && !soul) fail('Select a soul or home for this operation');
  const envelope = await invoke(cli.bin, {
    action, context, server, soul, agentsRoot, home,
    binding: request.binding, fields: request.fields, operation: request.operation,
    localCwd: server ? localCwd : context,
  });
  if (!envelope.ok) fail(envelope.error?.message || 'Capability operation failed', envelope.error?.code || 'E_OPERATION_FAILED');
  return envelope.result;
}
