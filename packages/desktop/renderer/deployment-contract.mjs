/** Native workspace-v2 read contract. No filesystem discovery or generation adapters. */
export const DEPLOYMENT_FEATURES = Object.freeze(['workspace-v2', 'instance-modules', 'served-identity', 'packages-no-approval']);
export const deploymentRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/* Spec D: why a remote read failed (kernel E_REMOTE_UNREADABLE `details.reason`, e.g. "cache", "network",
 * "timeout"), bounded. Only the reason and the host of `details.url` cross; never paths, pids, locks or the
 * cache dir (the kernel's `message` already names those, and is shown as given). */
const CAUSE_REASON = /^[a-z][a-z-]{0,31}$/;
const CAUSE_HOST = /^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?|\[[0-9A-Fa-f:.]{2,45}\])$/;
function causeHost(url) {
  if (typeof url !== 'string' || !url || url.length > 2048) return null;
  let host = null;
  try { host = new URL(url).hostname; } catch { host = /^[^@\s/]+@([^:\s/]+):/.exec(url)?.[1] ?? null; } // scp-like git@host:path
  return host && CAUSE_HOST.test(host) ? host.toLowerCase() : null;
}
/** The kernel's failure details → { reason, host? } | null. */
export function remoteFailureCause(details) {
  if (!deploymentRecord(details) || typeof details.reason !== 'string' || !CAUSE_REASON.test(details.reason)) return null;
  const host = causeHost(details.url);
  return host ? { reason: details.reason, host } : { reason: details.reason };
}
/** `/api/panel` errorCause, re-validated by the renderer with its keys exact: { code, reason, host? } | null. */
export function panelErrorCause(value) {
  if (!deploymentRecord(value) || Object.keys(value).some(k => !['code', 'reason', 'host'].includes(k))) return null;
  if (typeof value.code !== 'string' || !/^E_[A-Z0-9_]{1,64}$/.test(value.code) || typeof value.reason !== 'string' || !CAUSE_REASON.test(value.reason)) return null;
  if (value.host !== undefined && (typeof value.host !== 'string' || !CAUSE_HOST.test(value.host))) return null;
  return value.host === undefined ? { code: value.code, reason: value.reason } : { code: value.code, reason: value.reason, host: value.host };
}
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
/** Bounded observation reuse (kernel feature observe-max-age): the read-only verbs status,
 * workspace status, souls, capabilities and inspect accept `--max-age <seconds>` (0 = live,
 * N = the kernel may reuse remote-head observations up to N seconds old). The flag exists
 * only when the probe declares the feature: an older kernel would refuse it as unknown, so
 * the argv is byte-identical to the flagless one whenever the feature is absent. Mutating
 * verbs never take it; that refusal is each adapter's. Bounded to one day: a larger value
 * has no product meaning and a non-integer would not be one clean argv token. */
export const OBSERVE_MAX_AGE_FEATURE = 'observe-max-age';
export const validMaxAge = v => v === undefined || (Number.isSafeInteger(v) && v >= 0 && v <= 86400);
export function maxAgeArgv(features, maxAge) {
  if (maxAge === undefined || !Array.isArray(features) || !features.includes(OBSERVE_MAX_AGE_FEATURE)) return [];
  return ['--max-age', String(maxAge)];
}
