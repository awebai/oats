/** Whether an instance runs in the background (feature instance-background, awebai/oats#1579), through the kernel
 * verb `oats instance background <instance> on|off`: the only writer of the home's background flag. The flag only
 * places the row (the sidebar's Background section, packages/client instance-tree.mjs backgroundPlacement); it is
 * the instance's own, kept by OATS through restarts and never inherited. The row's context menu offers Move to
 * background / Move out of background (renderer/instance-background-menu.mjs).
 *
 * The boundary is instance-record.mjs's, shared with `oats instance color`: this module is the verb's descriptor.
 * A remote row's flag is set on its host, with `--server`, as `oats instance stop` is routed.
 *
 * Request (POST /api/instance-background?ws=<id>, a bounded JSON object):
 *   { instance, home, background }     background: true (on) or false (off)
 *   { instance, home, check: true }    nothing runs: whether the flag can be set here (the menu asks before it offers)
 * Answer (instance-record.mjs):
 *   { status: 'ok', instance, background, changed }     the kernel's answer for exactly that instance and home
 *   { status: 'ok', instance, check: true }
 *   { status: 'refused', reason: { code, message } }    the kernel's refusal (E_SESSION_UNKNOWN, E_INSTANCE_RETIRING,
 *                                                       E_REMOTE_INCOMPATIBLE from a host without the feature, …)
 *   { status: 'unknown', reason: { code } }
 *   { status: 'not-run', reason: { code, message, details? } }   E_BAD_ARGS, E_WORKSPACE_UNKNOWN, E_SNAPSHOT_UNKNOWN,
 *                                                       E_BUSY, E_INSTANCE_BACKGROUND_UNAVAILABLE (details.where
 *                                                       `local` or `server`, as for the colour)
 *
 * The kernel's answer is `{ instanceBackgroundApi: 1, instance, home, background, changed }`: one for another
 * instance or another home is an unknown outcome, never a success. */
import { cliInstanceBackground } from '../../client/cli-adapter.mjs';
import { BACKGROUND_FEATURE } from '../../client/instance-tree.mjs';
import { createInstanceRecordBoundary, recordNotRun, recordOutcome } from './instance-record.mjs';

export const INSTANCE_BACKGROUND_FEATURE = BACKGROUND_FEATURE;
/** Nothing ran: this boundary's own reasons, each its fixed sentence. */
export const instanceBackgroundNotRun = recordNotRun({
  E_BAD_ARGS: 'This background request was not valid.',
  E_WORKSPACE_UNKNOWN: 'This window\'s workspace is not one this computer serves.',
  E_SNAPSHOT_UNKNOWN: 'This computer\'s roster no longer lists this instance.',
  E_INSTANCE_BACKGROUND_UNAVAILABLE: 'This OATS can\'t move an instance to the background.',
  E_BUSY: 'Another window is moving this instance. Try again.',
});

/** The kernel's success for exactly the asked instance and home; else null (an unknown outcome). */
const backgroundAnswer = (r, asked) => r.instanceBackgroundApi === 1 && r.instance === asked.instance && r.home === asked.home
  && typeof r.background === 'boolean' && typeof r.changed === 'boolean'
  ? { status: 'ok', instance: r.instance, background: r.background, changed: r.changed } : null;

/** What the command answered, as the renderer reads it (instance-record.mjs recordOutcome). */
export const instanceBackgroundOutcome = (envelope, asked) => recordOutcome(envelope, result => backgroundAnswer(result, asked));

const BACKGROUND_VERB = Object.freeze({ field: 'background', valid: v => typeof v === 'boolean', feature: INSTANCE_BACKGROUND_FEATURE,
  unavailable: 'E_INSTANCE_BACKGROUND_UNAVAILABLE', notRun: instanceBackgroundNotRun, invoke: cliInstanceBackground, answer: backgroundAnswer });

/** `getContext()` → { workspace, cli, instances, localCwd }, as the colour's. */
export const createInstanceBackgroundBoundary = ({ invoke = cliInstanceBackground } = {}) => createInstanceRecordBoundary(BACKGROUND_VERB, { invoke });
export const instanceBackgroundRequest = createInstanceBackgroundBoundary();
