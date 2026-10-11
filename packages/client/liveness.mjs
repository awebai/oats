/** Terminal-target liveness for kernel-reported rows. This is unchanged,
 * v2-agnostic terminal observation: it consults tmux for the exact recorded
 * target, never deployment files. A library only: the program that runs it out
 * of the serving process is liveness-main.mjs (see packages/desktop/server/oats-web.mjs), so a slow
 * terminal server cannot stall request handling. */
import { createTmuxStatusReader, DEFAULT_TMUX_SESSION } from './tmux-status.mjs';
import { unsupportedSession } from './instance-presentation.mjs';

export { DEFAULT_TMUX_SESSION };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** rows: [{ instance, running?, tmux?, sessionTarget?, runtimeState?, runtimeError? }] in, one liveness
 * per row out. A Herdr-recorded row is never probed: it is unsupported, with the kernel's reason.
 *
 * The probe refines a row only when the kernel answered `running` true or false. A row it answered
 * `running: null` is not probed: its `running`, `runtimeState` and `runtimeError` stay the kernel's,
 * and the answer carries no `tmux`, so the merged row keeps the kernel's own. The kernel answers
 * unknown for a server it could not read, for a missing socket file while a process works in the
 * home, and for a record that cannot be read. Only its `runtimeError` text tells them apart, which
 * no client reads; for the last two a probe would say "stopped" and be wrong. The cost: a kernel
 * read that failed once shows the row as unknown until the next roster read. A row without a
 * `running` key (no kernel sends one) is probed. */
export function observeLiveness(rows, { tmuxReader = createTmuxStatusReader(), session = DEFAULT_TMUX_SESSION } = {}) {
  if (!Array.isArray(rows) || rows.length > 10000) throw new Error('Invalid liveness request');
  return rows.map(row => {
    if (!record(row) || typeof row.instance !== 'string') return { running: null, runtimeState: 'unreachable', runtimeError: 'Invalid terminal target' };
    const unsupported = unsupportedSession(row);
    if (unsupported) return { running: null, runtimeState: 'unsupported', runtimeError: unsupported.slice(0, 300), tmux: null };
    // After the unsupported check: an older kernel's Herdr row is `unreachable` with a sessionTarget, and reads unsupported.
    if (row.running === null) return { running: null, runtimeState: row.runtimeState ?? 'unreachable', ...(row.runtimeError ? { runtimeError: String(row.runtimeError).slice(0, 300) } : {}) };
    const tmux = record(row.tmux) ? row.tmux : undefined;
    const { tmux: observed, running, runtimeState, runtimeError } = tmuxReader({ instance: row.instance, tmux }, session);
    return { tmux: observed, running, runtimeState, ...(runtimeError ? { runtimeError: String(runtimeError).slice(0, 300) } : {}) };
  });
}
