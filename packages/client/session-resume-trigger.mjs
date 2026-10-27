/** When a client runs the machine sweep (`oats session resume --json`, session-resume-cli.mjs): once at its launch,
 * then whenever a roster read shows a lost session on this machine. Shared by the Desktop (main) and the TUI;
 * no DOM, no clock or IO of its own: the caller gives the probe, the run, the read and the time.
 *
 * The rule. `launch()` arms the trigger and runs the launch sweep, with no floor. After it, `observed(rows)`
 * (each accepted roster read's instance rows) starts a sweep when all hold: armed and not disposed; no sweep in
 * flight (single flight); at least RESUME_MIN_INTERVAL_MS since the last sweep that ran STARTED (the floor counts
 * from the moment its slot was taken, the launch sweep's and a busy one's too); and lostLocalHomes(rows) names a
 * home that is not settled. Otherwise nothing: no queue, no timer; the next read asks again. Each would-be start
 * takes the slot, then asks `cli()`: only a probe with the feature (session-resume-cli.mjs resumeSupported) runs.
 * Without one nothing runs, nothing is read, the floor does not move and the slot is let go.
 *
 * Settled homes keep a home that cannot be resumed from starting a sweep on every read. Each answer settles and
 * releases homes by its rows (session-resume.mjs sweepSettlement: a refusal, or a home skipped as not lost or
 * not seen running recently, settles it; a session started or running releases it; anything else changes
 * nothing). A later read also releases a local home it shows that lostLocalHomes does not name: no longer lost,
 * or running.
 *
 * News, not repeats. The kernel reports a refusal again in every sweep: before `read`, the refusals an earlier
 * sweep of this trigger reported are left out of a copy of the envelope (session-resume.mjs withoutReported; the
 * run's own is never changed). Every other row is this sweep's event and kept. A home released (above) forgets
 * the refusals reported for it, so a refusal after it recovered is news again. This module reads nothing of the
 * answer itself: its shape is session-resume.mjs's alone.
 *
 * `onReading` gets the reading of every finished sweep, whatever its kind (the caller ignores what it does not
 * show). A run that rejects reads as failed, E_CLI_FAILED; a `read` that throws, as failed, E_CLI_PROTOCOL.
 *
 * `dispose()` stops the trigger and never cancels a sweep: a sweep in flight runs on (a kernel change outlives
 * its client), and its reading is dropped. Nothing here throws out of `launch` or `observed`. */
import { resumeSupported, runResumeSweep } from './session-resume-cli.mjs';
import { readResumeSweep, sweepSettlement, withoutReported } from './session-resume.mjs';
import { SESSION_ENDS } from './deployment-data.mjs';

export const RESUME_MIN_INTERVAL_MS = 30_000;

const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const absolute = v => typeof v === 'string' && v.startsWith('/') && !v.includes('\0');
/** A row of this machine with a home to name: a record with an absolute `home`, no `server` key, `remote` not true. */
const localRow = row => record(row) && absolute(row.home) && !Object.hasOwn(row, 'server') && row.remote !== true;
const done = Promise.resolve();

/** The homes of `rows` (instance rows as a roster read serves them; anything else: none) whose session was lost
 * on this machine: a local row (above) whose `sessionEnd` is SESSION_ENDS.lost and `running` not true. Each once,
 * in the rows' order. The one place a client reads `sessionEnd`. */
export function lostLocalHomes(rows) {
  if (!Array.isArray(rows)) return [];
  const homes = new Set();
  for (const row of rows) if (localRow(row) && row.sessionEnd === SESSION_ENDS.lost && row.running !== true) homes.add(row.home);
  return [...homes];
}

/**
 * @param {{cli: () => unknown, run?: (cli: unknown) => Promise<unknown>, read?: (envelope: unknown) => unknown,
 *   now?: () => number, onReading?: (reading: unknown) => void}} options
 *   `cli()`: the accepted probe, or null, or a promise of either, asked at each would-be start. `run(cli)`: the
 *   sweep's envelope (runResumeSweep). `read(envelope)`: its reading (readResumeSweep). `now()`: milliseconds.
 * @returns {{launch: () => Promise<void>, observed: (rows: unknown) => Promise<void>, dispose: () => void}}
 *   `launch()` arms and runs the launch sweep; a second call answers the first's promise. It settles once that
 *   sweep's onReading ran, or at once when nothing ran. `observed(rows)` releases, then applies the rule; it
 *   settles when the sweep it started was read, or at once. Neither rejects. `dispose()`: later calls do nothing.
 */
export function createResumeTrigger({ cli, run = runResumeSweep, read = readResumeSweep, now = Date.now, onReading }) {
  let launched = null, disposed = false, flying = false, lastStart = null;
  const settled = new Set(), reported = new Set(), reportedFor = new Map(); // reportedFor: home → its reported keys

  /** A home no longer settled, and the refusals reported for it forgotten. */
  function release(home) {
    settled.delete(home);
    for (const key of reportedFor.get(home) ?? []) reported.delete(key);
    reportedFor.delete(home);
  }

  /** Settle and release from this answer (sweepSettlement); the envelope `read` is given, without the refusals
   * an earlier answer reported (withoutReported), whose keys are then added. */
  function digest(envelope) {
    const { settle, release: released } = sweepSettlement(envelope);
    for (const home of settle) settled.add(home);
    for (const home of released) release(home);
    const news = withoutReported(envelope, reported);
    for (const { home, key } of news.keys) {
      reported.add(key);
      if (!reportedFor.has(home)) reportedFor.set(home, new Set());
      reportedFor.get(home).add(key);
    }
    return news.envelope;
  }

  async function sweep() {
    flying = true;
    const startedAt = now();
    try {
      // A sync answer is used at once (the run starts in this call); a promise is awaited, the slot held meanwhile.
      let probe;
      try { probe = cli(); if (typeof probe?.then === 'function') probe = await probe; } catch { probe = null; }
      if (!resumeSupported(probe)) return;
      lastStart = startedAt;
      let reading;
      try {
        const envelope = await run(probe);
        try { reading = read(digest(envelope)); } catch { reading = { kind: 'failed', code: 'E_CLI_PROTOCOL' }; }
      } catch { reading = { kind: 'failed', code: 'E_CLI_FAILED' }; }
      if (!disposed && typeof onReading === 'function') { try { onReading(reading); } catch { /* the caller's */ } }
    } catch { /* never out of launch or observed */ } finally { flying = false; }
  }

  return {
    launch() {
      if (launched) return launched;
      if (disposed) return done;
      launched = sweep();
      return launched;
    },
    observed(rows) {
      if (!launched || disposed) return done;
      // A local home this read shows and lostLocalHomes does not name is no longer lost, or runs: released.
      const lostNow = new Set(lostLocalHomes(rows));
      if (Array.isArray(rows)) for (const row of rows) if (localRow(row) && !lostNow.has(row.home)) release(row.home);
      if (flying || lastStart !== null && now() - lastStart < RESUME_MIN_INTERVAL_MS) return done;
      if (![...lostNow].some(home => !settled.has(home))) return done;
      return sweep();
    },
    dispose() { disposed = true; },
  };
}
