/** The message for a deployment the kernel could not observe (workspace
 * model v2). A missing advertised feature is named; a kernel refusal keeps
 * its code and message. The observed facts themselves render in the
 * Workspace view's Sources tab (workspace-catalog.mjs). */
const text = value => typeof value === 'string' && value ? value : null;
export function deploymentUnavailableText(deployment) {
  if (!deployment || deployment.status === 'pending') return 'Reading the deployment through the installed OATS CLI…';
  if (deployment.status === 'observed') return '';
  const reason = deployment.reason || {};
  if (reason.feature) return `The installed OATS CLI does not advertise ${reason.feature}, which the Desktop needs to show this deployment. Update OATS and retry.`;
  const code = text(reason.code), message = text(reason.message);
  return code && message ? `${code}: ${message}` : message || 'The deployment could not be observed.';
}
