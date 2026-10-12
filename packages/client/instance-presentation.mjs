import { HERDR_REMOVED } from "./terminal-contract.mjs";

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

/** The speakers a text of a row can have, as `runtimeErrorOrigin` and a reason's `origin` name them:
 *
 *   kernel          read from a kernel answer: this machine's OATS, or another host's OATS relayed by it
 *   terminal-probe  made by the client's terminal check (liveness.mjs, tmux-status.mjs)
 *   roster-read     made by the client while it read the roster of other machines (remote-roster.mjs)
 *
 * A text with no speaker (the stand-in above) has no key. The marks are written here, in the shared home,
 * at the place that chooses the text, and never taken from an answer: a key a kernel, a host or the
 * liveness collector sent is dropped on every path. */
const ORIGINS = Object.freeze(["kernel", "terminal-probe", "roster-read"]);
/** Whether a value is one of the three speakers. Not on the stable surface. */
export const knownOrigin = (value) => ORIGINS.includes(value);
/** Whether a row has a `runtimeError`: a string that is not empty. Only such a row carries `runtimeErrorOrigin`. */
export const hasRuntimeError = (row) => typeof row?.runtimeError === "string" && !!row.runtimeError;

export function runtimeCounts(instances) {
  const counts = { running: 0, stopped: 0, unknown: 0 };
  for (const instance of instances) counts[runtimeState(instance)]++;
  return counts;
}
