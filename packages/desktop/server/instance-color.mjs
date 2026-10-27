/** An instance's colour (feature instance-color, awebai/oats#1421 §2), through the kernel verb `oats instance
 * color`: the only writer of the home's colour record. This boundary validates the request against the row the
 * backend holds, gates it, runs the verb (argv only; cli-adapter.mjs `cliInstanceColor`) and decodes its answer.
 * The boundary is instance-record.mjs's, shared with `oats instance background`: this module is the verb's
 * descriptor (its field, values, feature, CLI call, answer and sentences). A remote row's colour is set on its
 * host, with `--server`, as `oats instance stop` is routed. The answer's statuses are Forget's (server-forget.mjs).
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
 * E_INSTANCE_COLOR_UNAVAILABLE, with `details.where` `local` when this computer's CLI lacks what it needs (also
 * `server-probe-features`, for a remote row), else `server` (the dialog's sentence says which).
 * One write per home at a time (E_BUSY): the dialog never sends two, so a second is another window's. */
import { cliInstanceColor } from '../../client/cli-adapter.mjs';
import { SOUL_COLORS } from '../../client/soul-colors.mjs';
import { createInstanceRecordBoundary, recordNotRun, recordOutcome } from './instance-record.mjs';

export const INSTANCE_COLOR_FEATURE = 'instance-color';
/** Nothing ran: this boundary's own reasons, each its fixed sentence. */
export const instanceColorNotRun = recordNotRun({
  E_BAD_ARGS: 'This colour request was not valid.',
  E_WORKSPACE_UNKNOWN: 'This window\'s workspace is not one this computer serves.',
  E_SNAPSHOT_UNKNOWN: 'This computer\'s roster no longer lists this instance.',
  E_INSTANCE_COLOR_UNAVAILABLE: 'This OATS can\'t set an instance\'s colour.',
  E_BUSY: 'Another window is changing this instance\'s colour. Try again.',
});

/** The kernel's success for exactly the asked instance, a palette name or null; else null (an unknown outcome). */
const colorAnswer = (r, asked) => r.instanceColorApi === 1 && r.instance === asked.instance && typeof r.changed === 'boolean'
  && (r.color === null || SOUL_COLORS.includes(r.color)) ? { status: 'ok', instance: r.instance, color: r.color, changed: r.changed } : null;

/** What the command answered, as the renderer reads it (instance-record.mjs recordOutcome). */
export const instanceColorOutcome = (envelope, asked) => recordOutcome(envelope, result => colorAnswer(result, asked));

/** The verb's descriptor (instance-record.mjs createInstanceRecordBoundary). */
const COLOR_VERB = Object.freeze({ field: 'color', valid: v => v === null || SOUL_COLORS.includes(v), feature: INSTANCE_COLOR_FEATURE,
  unavailable: 'E_INSTANCE_COLOR_UNAVAILABLE', notRun: instanceColorNotRun, invoke: cliInstanceColor, answer: colorAnswer });

/** `getContext()` → { workspace, cli, instances, localCwd }: the held workspace, this computer's CLI probe, the
 * rows the backend holds for it and the backend's own cwd (the routed command's). */
export const createInstanceColorBoundary = ({ invoke = cliInstanceColor } = {}) => createInstanceRecordBoundary(COLOR_VERB, { invoke });
export const instanceColorRequest = createInstanceColorBoundary();
