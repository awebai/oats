/** An instance's colour (feature instance-color, awebai/oats#1421 §2), through the kernel verb `oats instance
 * color`: the only writer of the home's colour record. This boundary validates the request against the row the
 * backend holds, gates it, runs the verb (argv only; cli-adapter.mjs `cliInstanceColor`) and decodes its answer.
 * It is the teams boundary's pattern (teams.mjs), but it also routes: a remote row's colour is set on its host,
 * with `--server`, as `oats instance stop` is routed. The answer's statuses are Forget's (server-forget.mjs).
 *
 * Request (POST /api/instance-color?ws=<id>, a bounded JSON object):
 *   { instance, home, color }          color: a palette name (soul-colors.mjs SOUL_COLORS), or null to clear
 *   { instance, home, check: true }    nothing runs: whether the colour can be set here (the dialog asks on open)
 * Answer:
 *   { status: 'ok', instance, color, changed }          the kernel's answer for exactly that instance
 *   { status: 'ok', instance, check: true }             a check: the colour can be set
 *   { status: 'refused', reason: { code, message } }    an error the installed CLI printed (kernel-made.mjs)
 *   { status: 'unknown', reason: { code } }             no kernel answer (a timeout, no envelope, a crash) or
 *                                                       one that is not the contract's: the record may have changed
 *   { status: 'not-run', reason: { code, message, details? } }   nothing ran: this boundary's own reason
 *
 * The gate is the feature, never a refusal: locally, this computer's CLI lists `instance-color`; for a remote row,
 * this CLI routes and relays the hosts' features (`server-probe-features`) and the held roster row's own
 * `probe.features` names `instance-color` (composed-gate.mjs hostAdvertises). Without it: not-run
 * E_INSTANCE_COLOR_UNAVAILABLE, with `details.where` `local` or `server` (the dialog's sentence says which).
 * One write per home at a time (E_BUSY): the dialog never sends two, so a second is another window's. */
import { isAbsolute } from 'node:path';
import { cliInstanceColor } from '../../client/cli-adapter.mjs';
import { SOUL_COLORS } from '../../client/soul-colors.mjs';
import { hostAdvertises, PROBE_FEATURES_FEATURE } from '../../client/composed-gate.mjs';
import { canAddressRemote } from '../../client/remote-address.mjs';
import { madeByKernel } from '../../client/kernel-made.mjs';

export const INSTANCE_COLOR_FEATURE = 'instance-color';
/** Nothing ran: this boundary's own reasons, each its fixed sentence. */
const NOT_RUN = Object.freeze({
  E_BAD_ARGS: 'This colour request was not valid.',
  E_WORKSPACE_UNKNOWN: 'This window\'s workspace is not one this computer serves.',
  E_SNAPSHOT_UNKNOWN: 'This computer\'s roster no longer lists this instance.',
  E_INSTANCE_COLOR_UNAVAILABLE: 'This OATS can\'t set an instance\'s colour.',
  E_BUSY: 'Another window is changing this instance\'s colour. Try again.',
});
const CODE = /^E_[A-Z0-9_]{1,62}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\x00-\x1f\x7f]/.test(v);
const advertises = (cli, feature) => !!cli?.ok && Array.isArray(cli.features) && cli.features.includes(feature);

/** Nothing ran, for one of this boundary's reasons. */
export const instanceColorNotRun = (code, details) => ({ status: 'not-run',
  reason: { code, message: NOT_RUN[code], ...(details ? { details } : {}) } });

/** What the command answered, as the renderer reads it. Only an error the installed CLI printed is a refusal
 * (kernel-made.mjs); one the adapter wrote (a timeout, no envelope, a nonzero exit) is an unknown outcome, as is a
 * success that is not the contract's answer for exactly the asked instance. */
export function instanceColorOutcome(envelope, asked) {
  if (envelope?.ok === true) {
    const r = envelope.result;
    return record(r) && r.instanceColorApi === 1 && r.instance === asked.instance && typeof r.changed === 'boolean'
      && (r.color === null || SOUL_COLORS.includes(r.color))
      ? { status: 'ok', instance: r.instance, color: r.color, changed: r.changed }
      : { status: 'unknown', reason: { code: 'E_OUTCOME_UNKNOWN' } };
  }
  const error = envelope?.ok === false ? envelope.error : null;
  if (madeByKernel(error) && typeof error.code === 'string' && CODE.test(error.code)) {
    return { status: 'refused', reason: { code: error.code, message: text(error.message, 512) ? error.message : '' } };
  }
  return { status: 'unknown', reason: { code: typeof error?.code === 'string' && /^E_CLI_[A-Z_]+$/.test(error.code) ? error.code : 'E_OUTCOME_UNKNOWN' } };
}

/** { instance, home, color } or { instance, home, check: true }, exactly; else null. */
function requestOf(r) {
  if (!record(r) || typeof r.instance !== 'string' || !NAME.test(r.instance) || typeof r.home !== 'string' || !isAbsolute(r.home) || r.home.includes('\0')) return null;
  const keys = Object.keys(r).sort().join(',');
  if (keys === 'check,home,instance') return r.check === true ? { instance: r.instance, home: r.home, check: true } : null;
  if (keys === 'color,home,instance') return r.color === null || SOUL_COLORS.includes(r.color) ? { instance: r.instance, home: r.home, color: r.color } : null;
  return null;
}

/** `getContext()` → { workspace, cli, instances, localCwd }: the held workspace, this computer's CLI probe, the
 * rows the backend holds for it and the backend's own cwd (the routed command's). */
export function createInstanceColorBoundary({ invoke = cliInstanceColor } = {}) {
  const writing = new Set(); // workspace id + home: one write per home at a time
  return async function instanceColorRequest(request, getContext) {
    try {
      const asked = requestOf(request);
      if (!asked) return instanceColorNotRun('E_BAD_ARGS');
      const { workspace, cli, instances = [], localCwd } = getContext() || {};
      if (!workspace || typeof workspace.id !== 'string' || typeof workspace.scope !== 'string' || !isAbsolute(workspace.scope)) return instanceColorNotRun('E_WORKSPACE_UNKNOWN');
      // Only a row this computer holds: its name and its home, the pair the kernel resolves.
      const row = instances.find(i => i?.home === asked.home && i?.instance === asked.instance);
      if (!row) return instanceColorNotRun('E_SNAPSHOT_UNKNOWN');
      const remote = !!(workspace.remote || workspace.server);
      if (remote && (!canAddressRemote(row) || typeof workspace.server !== 'string')) return instanceColorNotRun('E_SNAPSHOT_UNKNOWN');
      const supported = remote
        ? advertises(cli, INSTANCE_COLOR_FEATURE) && advertises(cli, PROBE_FEATURES_FEATURE) && hostAdvertises(workspace.group, INSTANCE_COLOR_FEATURE)
        : advertises(cli, INSTANCE_COLOR_FEATURE);
      if (!supported || typeof cli?.bin !== 'string') return instanceColorNotRun('E_INSTANCE_COLOR_UNAVAILABLE', { where: remote ? 'server' : 'local' });
      if (asked.check) return { status: 'ok', instance: asked.instance, check: true };
      const key = `${workspace.id}\0${asked.home}`;
      if (writing.has(key)) return instanceColorNotRun('E_BUSY');
      writing.add(key);
      try {
        const envelope = await invoke(cli.bin, { instance: asked.instance, home: asked.home, color: asked.color,
          ...(remote ? { server: workspace.server } : { context: workspace.scope }) }, remote ? { cwd: localCwd } : {});
        return instanceColorOutcome(envelope, asked);
      } catch { return { status: 'unknown', reason: { code: 'E_OUTCOME_UNKNOWN' } }; }
      finally { writing.delete(key); }
    } catch { return instanceColorNotRun('E_BAD_ARGS'); }
  };
}
export const instanceColorRequest = createInstanceColorBoundary();
