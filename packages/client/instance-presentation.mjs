import { HERDR_REMOVED } from "./terminal-contract.mjs";
import { requireTerms } from './client-terms.mjs';

export function runtimeState(instance) {
  return instance.running === true ? "running" : instance.running === false ? "stopped" : "unknown";
}

/** The row carries the kernel's own reason for a removed session backend, which `unsupportedSession` answers as it is. */
const kernelsOwnReason = (instance) => instance?.runtimeState === "unsupported" && typeof instance.runtimeError === "string" && !!instance.runtimeError;

/** Why a kernel-reported row has no usable session, or null. A Herdr-recorded
 * instance cannot open, start or restart; it can still retire. A 0.31 kernel
 * reports it as runtimeState "unsupported" with its E_HERDR_REMOVED text; an
 * older kernel only records a sessionTarget (local) or a herdr backend
 * (remote), and its runtimeError is a Herdr probe's, so the stem stands in. */
export function unsupportedSession(instance) {
  const stem = `E_HERDR_REMOVED: ${HERDR_REMOVED}`;
  if (instance?.runtimeState === "unsupported") return kernelsOwnReason(instance) ? instance.runtimeError : stem;
  return (instance?.sessionTarget !== undefined && instance?.sessionTarget !== null) || instance?.backend === "herdr" ? stem : null;
}

/** Who wrote what `unsupportedSession` answers for a row as the kernel or a host reported it: "kernel"
 * for the row's own text, null for the stand-in written here (and for a row it answers null for). Asked
 * where the text is chosen (liveness.mjs, remote-roster.mjs), of the reported row: a panel's row already
 * holds the chosen text as its `runtimeError`, stand-in included, and its speaker in `runtimeErrorOrigin`.
 * Not on the stable surface. */
export const unsupportedSessionOrigin = (instance) => (kernelsOwnReason(instance) ? "kernel" : null);

/** The speakers a text of a row can have, as `runtimeErrorOrigin` and a reason's `origin` name them, each
 * with the words a client puts in front of the text (`originLead`):
 *
 *   kernel          read from a kernel answer: this machine's OATS, or another host's OATS relayed by it.
 *                   A client names both the same; a row's `serverUnreached` says which read the text is about.
 *   terminal-probe  made by the client's terminal check (liveness.mjs, tmux-status.mjs): a sentence of
 *                   its own, or the message of a failed `tmux` or `ps` run
 *   roster-read     made by the client while it read the roster of other machines (remote-roster.mjs)
 *
 * A text with no speaker (the stand-in above) has no key. The marks are written here, in the shared home,
 * at the place that chooses the text, and never taken from an answer: a key a kernel, a host or the
 * liveness collector sent is dropped on every path. */
const LEADS = Object.freeze({
  kernel: () => "OATS says:",
  "terminal-probe": (terms) => `${terms.name}'s terminal check says:`,
  "roster-read": (terms) => `${terms.name}'s read of other machines says:`,
});
/** Whether a value is one of the three speakers. Not on the stable surface. */
export const knownOrigin = (value) => typeof value === "string" && Object.hasOwn(LEADS, value);

/** The words a client puts in front of a text to name who made it, or null when `origin` is not one of
 * the three speakers (absent, or any other value). It takes a row's `runtimeErrorOrigin`, a reason's
 * `origin` (remote-address.mjs `rowReason`, instance-acts.mjs) or a kept failure's `errorOrigin`: all hold
 * the same values. A client writes nothing of its own there, so two clients name a speaker the same way.
 *
 *   kernel          "OATS says:"                                  no term: the word the other sentences use
 *   terminal-probe  "<name>'s terminal check says:"               `terms.name` (client-terms.mjs)
 *   roster-read     "<name>'s read of other machines says:"
 *
 * The two checks name the client: the kernel's own text can be about a terminal server too, so "the
 * terminal check" alone would not say whose check it was. A text with no lead is shown as the client's
 * own words always were: never under "OATS says:". `terms` is required, also where no term is used. */
export function originLead(origin, terms) {
  requireTerms(terms, "originLead");
  return knownOrigin(origin) ? LEADS[origin](terms) : null;
}
/** Whether a row has a `runtimeError`: a string that is not empty. Only such a row carries `runtimeErrorOrigin`. */
export const hasRuntimeError = (row) => typeof row?.runtimeError === "string" && !!row.runtimeError;
/** The speaker of a sentence a reason carries, or null: the row's `runtimeErrorOrigin` when the sentence
 * is the row's own `runtimeError` and the key names one of the three. A sentence written for the row (it
 * was not reached, its state is unknown) and the Herdr stand-in have none. The key is a panel row's, set
 * by the shared home (deployment-panel.mjs, remote-roster.mjs). Not on the stable surface. */
export const runtimeErrorSpeaker = (row, sentence) =>
  (hasRuntimeError(row) && sentence === row.runtimeError && knownOrigin(row.runtimeErrorOrigin) ? row.runtimeErrorOrigin : null);

export function runtimeCounts(instances) {
  const counts = { running: 0, stopped: 0, unknown: 0 };
  for (const instance of instances) counts[runtimeState(instance)]++;
  return counts;
}
