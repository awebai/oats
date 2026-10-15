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
 * A row is held from the moment an apply starts until its answer is in and the roster was read after it, and
 * while any other apply of a retire of it is held (a second Retire, offered while one runs, is one).
 * An answer that ran nothing (a refusal, `refused`; a plan that changed under it, `stale`) lets its apply go at
 * once: with no other apply held, the row reads again as the roster says. Any other answer (complete, partial, unknown, pending, unreadable)
 * holds it until a read: that read says what the retire left. instance-tree.mjs `heldHome` reads
 * `retireInFlight` as `retiring`. Nothing is kept beyond the client's run. */
import { instanceId } from './instance-tree.mjs';

const RAN_NOTHING = new Set(['refused', 'stale']);

export function createRetiresInFlight({ mark, onChange = () => {} } = {}) {
  if (typeof mark !== 'function') throw new TypeError('createRetiresInFlight: a mark of the client\'s roster reads');
  // instanceId -> { target, applies }: every apply of a retire of that row, each `{ settled, after }`. The row is
  // held while any one holds it, so an answer to a later apply (a refusal: one is still running) never lets go
  // of an earlier one that has not answered or was not read after.
  const held = new Map();
  const changed = () => { try { onChange(); } catch { /* a client's drawing changes nothing here */ } };
  const drop = (id, entry, apply) => { entry.applies.delete(apply); if (!entry.applies.size && held.get(id) === entry) held.delete(id); };
  return {
    begin(target) {
      const id = instanceId(target), entry = held.get(id) ?? { target, applies: new Set() }, apply = { settled: false, after: undefined };
      entry.applies.add(apply); held.set(id, entry); changed();
      return {
        settle(kind) {
          if (apply.settled || !entry.applies.has(apply)) return;
          apply.settled = true;
          if (RAN_NOTHING.has(kind)) { drop(id, entry, apply); changed(); } else apply.after = mark();
        },
      };
    },
    landed(at, covers = () => true) {
      const before = held.size;
      for (const [id, entry] of held) {
        if (!covers(entry.target)) continue;
        for (const apply of [...entry.applies]) if (apply.settled && at > apply.after) drop(id, entry, apply);
      }
      if (held.size !== before) changed();
    },
    ids: () => new Set(held.keys()),
    holds: row => !!row && held.has(instanceId(row)),
  };
}

export function retiringRows(rows, ids) {
  return ids?.size ? rows.map(row => ids.has(instanceId(row)) ? { ...row, retireInFlight: true } : row) : rows;
}
