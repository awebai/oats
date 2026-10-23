/** A deployment's workspace identity, read before a client serves it (#482): the `workspace` object of
 * `oats status --dir <path> --json`, the read an observed deployment gets, so a deployment of this
 * computer's list can be matched to its workspace (panel-views.mjs `listedViews`) before it is opened.
 * One read, bounded as every deployment read is (deployment-read-cli.mjs: its time and size limits), and
 * projected by the observer's own projection (deployment-data.mjs `deploymentStatusData`): nothing of the
 * answer but its `workspace` object is kept. No retry and no cache: what the answers become is the
 * caller's (`held.learned`, panel-views.mjs). */
import { cliDeploymentRead } from './deployment-read-cli.mjs';
import { deploymentStatusData } from './deployment-data.mjs';
import { deploymentFailure } from './deployment-contract.mjs';

/** Whether a kernel record (cli-locator.mjs) reports workspace identities at all: without the feature
 * no read can match anything, and a client makes none. */
export const identityReadable = (cli) => cli?.ok === true && Array.isArray(cli.features) && cli.features.includes('workspace-identity');

/** The answer for a read its caller's total budget ended, or one that never began before it ended: timed
 * out, as a read past its own time limit answers. */
export const identityTimedOut = () => deploymentFailure('E_CLI_TIMEOUT');

/**
 * Read the identity of deployment `path` (absolute, canonical: a row of this computer's list).
 * `options.maxAge` rides on the read as it does on an observation's; `io` is cliDeploymentRead's
 * (`exec`, `env`).
 * @returns {Promise<{ ok: true, workspace: object | null } | { ok: false, reason: { code, message, origin? } }>}
 *   `workspace` is the projected `workspace` object (deployment-data.mjs: its reachability and, with
 *   feature workspace-identity, the identity fields, or `identityInvalid`), null when the kernel reported
 *   none; a failure is the reader's reason as it came, or the projection's code. Never rejected.
 */
export async function cliDeploymentIdentity(cli, path, options = {}, io = {}) {
  let answer;
  try {
    answer = await cliDeploymentRead(cli, { action: 'status', context: path, ...(options.maxAge !== undefined ? { maxAge: options.maxAge } : {}) }, io);
  } catch { return deploymentFailure('E_CLI_FAILED'); }
  if (!answer?.ok) return answer?.reason ? { ok: false, reason: answer.reason } : deploymentFailure('E_CLI_PROTOCOL');
  try {
    return { ok: true, workspace: deploymentStatusData(answer.document, path).workspace ?? null };
  } catch (error) {
    return deploymentFailure(error?.code === 'E_DEPLOYMENT_SCOPE' ? 'E_DEPLOYMENT_SCOPE' : 'E_CLI_PROTOCOL');
  }
}
