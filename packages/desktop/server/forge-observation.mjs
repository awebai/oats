/** Private K1 routing projection. The URL may contain credentials: it is ONLY
 * fed into a keyed fingerprint, never returned, persisted, or logged. */
import { createHmac, randomBytes } from 'node:crypto';
import { gitTargetKey } from '../renderer/instance-git-contract.mjs';
import { object, hostName, repoPath, branchName } from '../renderer/forge-contract.mjs';
const key = randomBytes(32);
const bounded = (v, size) => typeof v === 'string' && v.length <= size && !/[\x00-\x1f\x7f]/.test(v);
export function forgeObservation(raw, target, cli) {
  const o = raw.observation, present = Object.hasOwn(raw, 'remote'), r = raw.remote;
  let route = null, code = null, selection = ['absent'];
  if (!present) code = 'E_REMOTE_NOT_REPORTED';
  else if (r === null) { code = 'E_NO_REMOTE'; selection = [null]; }
  else if (!object(r) || !bounded(r.name, 256) || !r.name || !bounded(r.url, 8192) || !r.url
    || ![null, 'string'].includes(r.host === null ? null : typeof r.host)
    || ![null, 'string'].includes(r.path === null ? null : typeof r.path)
    || !['branch-upstream', 'origin'].includes(r.source)) { code = 'E_GH_PROTOCOL'; selection = ['invalid']; }
  else {
    selection = [r.name, r.url, r.host, r.path, r.source];
    if (r.host === null) code = 'E_UNSUPPORTED_FORGE';
    else if (!hostName(r.host) || !repoPath(r.path)) code = 'E_UNSUPPORTED_FORGE';
    else route = { host: r.host, path: r.path };
  }
  if (!code && !branchName(o.branch)) code = 'E_NO_BRANCH';
  const observationKey = createHmac('sha256', key).update(JSON.stringify([cli.bin, cli.version,
    gitTargetKey(target), o.worktree, o.revision, o.branch, selection])).digest('hex');
  return { observationKey, revision: o.revision, branch: o.branch, route, code };
}
