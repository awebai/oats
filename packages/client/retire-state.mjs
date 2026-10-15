/** A retire of a home, as the kernel's roster row reports it (#1247, feature `status-retire-state`): the
 * row's `retire`, absent while no retire runs, is scheduled or is owed.
 *
 *   retire: { state, since, self, code?, message? }
 *     state    'running'      a retire holds the home's claim with a live holder, or a self-retire's
 *                             completion is alive (its 8 s wait counts)
 *              'unknown'      that holder's liveness cannot be read
 *              'failed'       a self-retire's completion recorded an error (`code`, `message`)
 *              'interrupted'  a scheduled completion is gone and left no outcome
 *     since    a string (the kernel's ISO time)
 *     self     a boolean: a self-retire
 *     code     an `E_…` code; message: a string: what a failed completion recorded
 *
 * `retireData` is the one reading of it every place that carries row facts uses (deployment-data.mjs,
 * deployment-panel.mjs, remote-roster.mjs, the Desktop's active-observation.mjs): the value when it is the
 * contract's, else null, and a client then holds the row as if it had none. Never guessed, never repaired: one
 * field out of the contract drops the whole value (an optional field is absent or a string, never null).
 * `retirePending` is a fact of its own and stays as the kernel reports it. Text in `message` and `code` is the kernel's: a client
 * shows it only through display-text.mjs `displayLine`, as instance-acts.mjs says for a reason with an `origin`. */
export const RETIRE_STATES = Object.freeze(['running', 'unknown', 'failed', 'interrupted']);
const CODE = /^E_[A-Z0-9_]+$/;

export function retireData(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!RETIRE_STATES.includes(value.state) || typeof value.since !== 'string' || typeof value.self !== 'boolean') return null;
  const { code, message } = value;
  if (code !== undefined && !(typeof code === 'string' && CODE.test(code))) return null;
  if (message !== undefined && typeof message !== 'string') return null;
  return { state: value.state, since: value.since, self: value.self, ...(code !== undefined ? { code } : {}), ...(message !== undefined ? { message } : {}) };
}
