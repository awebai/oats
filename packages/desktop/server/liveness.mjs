/** Terminal-target liveness for kernel-reported rows. This is unchanged,
 * v2-agnostic terminal observation: it consults tmux/Herdr for the exact
 * recorded target, never deployment files. It runs out of the serving process
 * (see oats-web.mjs) so a slow terminal server cannot stall key passthrough. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readHerdrTarget } from '../herdr-target.mjs';
import { createTmuxStatusReader } from './tmux-status.mjs';

export const DEFAULT_TMUX_SESSION = process.env.PI_AGENTS_TMUX_SESSION || 'pi-agents';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** rows: [{ instance, tmux?, sessionTarget? }] in, one liveness per row out. */
export function observeLiveness(rows, { tmuxReader = createTmuxStatusReader(), herdr = readHerdrTarget, session = DEFAULT_TMUX_SESSION } = {}) {
  if (!Array.isArray(rows) || rows.length > 10000) throw new Error('Invalid liveness request');
  return rows.map(row => {
    if (!record(row) || typeof row.instance !== 'string') return { running: null, runtimeState: 'unreachable', runtimeError: 'Invalid terminal target' };
    if (row.sessionTarget) {
      try { const state = herdr(row.sessionTarget); return { running: state.present, runtimeState: state.status, tmux: null }; }
      catch (error) { return { running: null, runtimeState: 'unreachable', runtimeError: String(error?.message || 'Herdr unavailable').slice(0, 300), tmux: null }; }
    }
    const tmux = record(row.tmux) ? row.tmux : undefined;
    const { tmux: observed, running, runtimeState, runtimeError } = tmuxReader({ instance: row.instance, tmux }, session);
    return { tmux: observed, running, runtimeState, ...(runtimeError ? { runtimeError: String(runtimeError).slice(0, 300) } : {}) };
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.stdout.write(JSON.stringify(observeLiveness(JSON.parse(readFileSync(0, 'utf8')))));
}
