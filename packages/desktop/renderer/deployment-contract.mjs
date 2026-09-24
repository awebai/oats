/** Native workspace-v2 read contract. No filesystem discovery or generation adapters. */
export const DEPLOYMENT_FEATURES = Object.freeze(['workspace-v2', 'instance-modules', 'served-identity', 'packages-no-approval']);
export const deploymentRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function deploymentFailure(code, feature = null) {
  const messages = {
    E_CLI_UNAVAILABLE: 'Choose a compatible installed OATS CLI to observe this deployment.',
    E_DEPLOYMENT_FEATURE: `The installed OATS CLI does not advertise the required feature: ${feature || 'workspace-v2'}.`,
    E_BAD_ARGS: 'Select one registered deployment for this read.',
    E_CLI_FAILED: 'The installed OATS CLI could not read this deployment.',
    E_CLI_PROTOCOL: 'The installed OATS CLI returned an invalid deployment observation.',
    E_CLI_TIMEOUT: 'The deployment observation exceeded its time limit.',
    E_CLI_OUTPUT_LIMIT: 'The deployment observation exceeded its size limit.',
    E_DEPLOYMENT_SCOPE: 'The kernel observation does not match the selected deployment.',
    E_DEPLOYMENT_STALE: 'The deployment or CLI changed while the observation was being read.',
    E_DEPLOYMENT_BUSY: 'A deployment observation is already in progress. Try again.',
  };
  const known = Object.hasOwn(messages, code) ? code : 'E_CLI_FAILED';
  return { ok: false, reason: { code: known, message: messages[known], ...(feature ? { feature } : {}) } };
}
/** Probe facts come from version --json, never from the status document.
 * The advertised API integer and feature must both be present. */
export function deploymentReadGate(cli, action) {
  if (cli?.ok !== true) return deploymentFailure('E_CLI_UNAVAILABLE');
  if (!['status', 'workspace-status'].includes(action)) return deploymentFailure('E_BAD_ARGS');
  if (cli.workspaceApi !== 2) return deploymentFailure('E_DEPLOYMENT_FEATURE', 'workspace-v2');
  const features = Array.isArray(cli.features) ? cli.features : [];
  const required = action === 'status' ? DEPLOYMENT_FEATURES : ['workspace-v2', 'packages-no-approval'];
  for (const name of required) if (!features.includes(name)) return deploymentFailure('E_DEPLOYMENT_FEATURE', name);
  return null;
}
