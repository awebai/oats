/** Retires this client started, read as Retiring… before the roster says so (#1247). One per client: the
 * Desktop's window and the TUI's run each keep one, and their lifecycle confirmations tell it
 * (lifecycle-confirmation.mjs `retires`).
 *
 *   createRetiresInFlight({ mark, onChange }) -> { begin, landed, ids, holds }
 *     mark()               the client's read mark now: a value that grows with every roster read the client
 *                          begins (a counter, a clock); compared with `>` only
 *     onChange()           the set changed: the client draws its rows again
 *     begin(target)        an apply of a retire of `target` (a row's identity: server and home) starts. The row
 *                          is held from now. Answers `{ settle(kind) }`, for the apply's answer: an outcome kind
 *                          of lifecycle-confirmation.mjs `outcomeView`
 *     landed(at, covers?)  an owned roster read the client began at mark `at` was read. A held row whose
 *                          retire has answered, and whose answer came before that read began, is let go, when
 *                          `covers(target)` says this read covers its row (default: every row)
 *     ids()                the held rows' instanceIds
 *     holds(row)           whether `row` is held
 *
 *   retiringRows(rows, ids) -> rows, each held one copied with `retireInFlight: true`
 *
 * A row is held from the moment the apply starts until its answer is in and the roster was read after it.
 * An answer that ran nothing (a refusal, `refused`; a plan that changed under it, `stale`) lets the row go at
 * once: it reads again as the roster says. Any other answer (complete, partial, unknown, pending, unreadable)
 * holds it until a read: that read says what the retire left. instance-tree.mjs `heldHome` reads
 * `retireInFlight` as `retiring`. Nothing is kept beyond the client's run. */
import { instanceId } from './instance-tree.mjs';

const RAN_NOTHING = new Set(['refused', 'stale']);

export function createRetiresInFlight({ mark, onChange = () => {} } = {}) {
  if (typeof mark !== 'function') throw new TypeError('createRetiresInFlight: a mark of the client\'s roster reads');
  const held = new Map(); // instanceId -> { target, settled, after }
  const changed = () => { try { onChange(); } catch { /* a client's drawing changes nothing here */ } };
  return {
    begin(target) {
      const id = instanceId(target), entry = { target, settled: false, after: undefined };
      held.set(id, entry); changed();
      return {
        settle(kind) {
          if (entry.settled || held.get(id) !== entry) return;
          entry.settled = true;
          if (RAN_NOTHING.has(kind)) { held.delete(id); changed(); } else entry.after = mark();
        },
      };
    },
    landed(at, covers = () => true) {
      let any = false;
      for (const [id, entry] of held) if (entry.settled && at > entry.after && covers(entry.target)) { held.delete(id); any = true; }
      if (any) changed();
    },
    ids: () => new Set(held.keys()),
    holds: row => !!row && held.has(instanceId(row)),
  };
}

export function retiringRows(rows, ids) {
  return ids?.size ? rows.map(row => ids.has(instanceId(row)) ? { ...row, retireInFlight: true } : row) : rows;
}
