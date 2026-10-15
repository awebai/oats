/** A status row's `retire` (feature status-retire-state): whether a retire of the home runs, could
 *  not be told, failed or was interrupted. The kernel's row reads it from the facts beside the home
 *  (lib/core.mjs retireStateOf); a remote row relays the host's (lib/servers.mjs). Both go through
 *  readRetireState, so a value either shows as this module reads it or not at all. */
import { retireRefusedReason } from "./instance-events.mjs";

export const RETIRE_STATES = ["running", "unknown", "failed", "interrupted"];
/** The code a `failed` state may carry: a kernel code's shape. Any other is left out. */
export const RETIRE_STATE_CODE_RE = /^E_[A-Z0-9_]+$/;
const ISO_INSTANT = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;
/** Whether `at` is an instant exactly as `toISOString()` gives it, and one that exists. */
export const isInstant = (at) => typeof at === "string" && ISO_INSTANT.test(at) && !Number.isNaN(Date.parse(at)) && new Date(at).toISOString() === at;

/** `value` as a row's `retire` → `{ state, since, self, code?, message? }`, or undefined when it is
 *  none: an object whose `state` is one of RETIRE_STATES, whose `since` is an instant as
 *  `toISOString()` gives it, and whose `self` is a boolean. `since` is required: the Desktop drops
 *  a value without one, and a failed retire would then read as one still running. `code` and
 *  `message` belong to `failed` only, and are strings or absent, never null: `code` when it has a
 *  kernel code's shape; `message` on one line and at most the length of a retire's one-line reason
 *  (retireRefusedReason), and left out when it is empty. */
export function readRetireState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const { state, since, self, code, message } = value;
  if (!RETIRE_STATES.includes(state) || !isInstant(since) || typeof self !== "boolean") return undefined;
  const line = state === "failed" && typeof message === "string" ? retireRefusedReason(message) : "";
  return {
    state,
    since,
    self,
    ...(state === "failed" && typeof code === "string" && RETIRE_STATE_CODE_RE.test(code) ? { code } : {}),
    ...(line ? { message: line } : {}),
  };
}
