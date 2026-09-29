/** Terminal-target liveness for kernel-reported rows. This is unchanged,
 * v2-agnostic terminal observation: it consults tmux for the exact recorded
 * target, never deployment files. It runs out of the serving process
 * (see oats-web.mjs) so a slow terminal server cannot stall key passthrough. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createTmuxStatusReader, DEFAULT_TMUX_SESSION } from './tmux-status.mjs';
import { unsupportedSession } from '../renderer/instance-presentation.mjs';

export { DEFAULT_TMUX_SESSION };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** rows: [{ instance, tmux?, sessionTarget?, runtimeState?, runtimeError? }] in, one liveness per
 * row out. A Herdr-recorded row is never probed: it is unsupported, with the kernel's reason. */
export function observeLiveness(rows, { tmuxReader = createTmuxStatusReader(), session = DEFAULT_TMUX_SESSION } = {}) {
  if (!Array.isArray(rows) || rows.length > 10000) throw new Error('Invalid liveness request');
  return rows.map(row => {
    if (!record(row) || typeof row.instance !== 'string') return { running: null, runtimeState: 'unreachable', runtimeError: 'Invalid terminal target' };
    const unsupported = unsupportedSession(row);
    if (unsupported) return { running: null, runtimeState: 'unsupported', runtimeError: unsupported.slice(0, 300), tmux: null };
    const tmux = record(row.tmux) ? row.tmux : undefined;
    const { tmux: observed, running, runtimeState, runtimeError } = tmuxReader({ instance: row.instance, tmux }, session);
    return { tmux: observed, running, runtimeState, ...(runtimeError ? { runtimeError: String(runtimeError).slice(0, 300) } : {}) };
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.stdout.write(JSON.stringify(observeLiveness(JSON.parse(readFileSync(0, 'utf8')))));
}
