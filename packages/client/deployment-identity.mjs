/** A deployment's workspace identity, read before a client serves it (#482): the `workspace` object of
 * `oats status --dir <path> --json`, the read an observed deployment gets, so a deployment of this
 * computer's list can be matched to its workspace (panel-views.mjs `listedViews`) before it is opened;
 * and whether any of its instances needs input (`waiting`), for the dot of the sidebar's list of
 * workspaces. One read, bounded as every deployment read is (deployment-read-cli.mjs: its time and size
 * limits), and projected by the observer's own projections (deployment-data.mjs `deploymentStatusData`,
 * then deployment-panel.mjs `rosterRows`, the rows an observed deployment's panel is made of): nothing of
 * the answer is kept but its `workspace` object and that one boolean. No retry and no cache: what the
 * answers become is the caller's (`held.learned`, panel-views.mjs; listed-waiting.mjs, which re-reads
 * `waiting` on its own slow schedule). */
import { cliDeploymentRead } from './deployment-read-cli.mjs';
import { deploymentStatusData } from './deployment-data.mjs';
import { deploymentFailure } from './deployment-contract.mjs';
import { rosterRows } from './deployment-panel.mjs';
import { waitingClaim } from './waiting-on-you.mjs';

/** Whether a kernel record (cli-locator.mjs) reports workspace identities at all: without the feature
 * no read can match anything, and a client makes none. */
export const identityReadable = (cli) => cli?.ok === true && Array.isArray(cli.features) && cli.features.includes('workspace-identity');

/** Whether a kernel record reports needs-input claims (feature waiting-on-you): without it, an identity
 * read's `waiting` is null, unknown, never "nobody waits". */
export const waitingReadable = (cli) => Array.isArray(cli?.features) && cli.features.includes('waiting-on-you');

/** The answer for a read its caller's total budget ended, or one that never began before it ended: timed
 * out, as a read past its own time limit answers. */
export const identityTimedOut = () => deploymentFailure('E_CLI_TIMEOUT');

/**
 * Read the identity of deployment `path` (absolute, canonical: a row of this computer's list).
 * `options.maxAge` rides on the read as it does on an observation's; `io` is cliDeploymentRead's
 * (`exec`, `env`).
 * @returns {Promise<{ ok: true, workspace: object | null, waiting: boolean | null } | { ok: false, reason: { code, message, origin? } }>}
 *   `workspace` is the projected `workspace` object (deployment-data.mjs: its reachability and, with
 *   feature workspace-identity, the identity fields, or `identityInvalid`), null when the kernel reported
 *   none. `waiting`: true when some instance row has a claim a row may show (waiting-on-you.mjs
 *   `waitingClaim`, over the kernel's own `running` and `runtimeState`: a shell, a stopped or an
 *   unreachable session never counts), false when none has, null when the CLI lacks feature
 *   waiting-on-you. A failure is the reader's reason as it came, or the projection's code; a caller reads
 *   its `waiting` as null. Never rejected.
 */
export async function cliDeploymentIdentity(cli, path, options = {}, io = {}) {
  let answer;
  try {
    answer = await cliDeploymentRead(cli, { action: 'status', context: path, ...(options.maxAge !== undefined ? { maxAge: options.maxAge } : {}) }, io);
  } catch { return deploymentFailure('E_CLI_FAILED'); }
  if (!answer?.ok) return answer?.reason ? { ok: false, reason: answer.reason } : deploymentFailure('E_CLI_PROTOCOL');
  try {
    const roster = deploymentStatusData(answer.document, path);
    const waiting = waitingReadable(cli) ? rosterRows(roster, cli).some((row) => waitingClaim(row) !== null) : null;
    return { ok: true, workspace: roster.workspace ?? null, waiting };
  } catch (error) {
    return deploymentFailure(error?.code === 'E_DEPLOYMENT_SCOPE' ? 'E_DEPLOYMENT_SCOPE' : 'E_CLI_PROTOCOL');
  }
}
