/** When a client runs the machine sweep (`oats session resume --json`, session-resume-cli.mjs): once at its launch,
 * then whenever a roster read shows a lost session of a local deployment. Shared by the Desktop (main) and the TUI;
 * no DOM, no clock or IO of its own: the caller gives the probe, the run, the read and the time.
 *
 * Locality is the roster's, by deployment id: a row is this machine's only when its `deployment.id` is one of the
 * read's local deployments (`localDeploymentIds`, from the panel's `deployments[].local`). A row of a remote
 * deployment, or with no deployment tag, is never local: a client never acts on another host's loss.
 *
 * The rule. `launch()` arms the trigger and runs the launch sweep, with no floor. After it, `observed(rows,
 * {localDeploymentIds})` (each accepted roster read's instance rows) starts a sweep when all hold: armed and not
 * disposed; no sweep in flight (single flight); at least RESUME_MIN_INTERVAL_MS since the last sweep that ran
 * STARTED (the floor counts from the moment its slot was taken, the launch sweep's and a busy one's too); and
 * lostLocalHomes names a home that is not settled. Otherwise nothing: no queue, no timer; the next read asks again.
 * Each would-be start takes the slot, then asks `cli()`: only a probe with the feature (session-resume-cli.mjs
 * resumeSupported) runs. Without one nothing runs, nothing is read, the floor does not move and the slot is let go.
 *
 * Settled homes keep a home that cannot be resumed from starting a sweep on every read. A sweep `observed()` started
 * keeps the lost homes it was started for (its snapshot); when it completes as a sweep (its reading is quiet or a
 * notice of an answer that ran: session-resume.mjs sweepCompleted), every one of them is settled, whatever the answer said of it (left out
 * because its deployment is not ready, or named busy or unknown), so a home that cannot be resumed costs at most
 * one observed sweep. Then the answer's rows settle and release homes (session-resume.mjs sweepSettlement: a
 * refusal, or a home skipped as not lost or not seen running recently, settles it; a session started or running
 * releases it; anything else changes nothing; the launch sweep has no snapshot, so a busy or unknown home there
 * stays news for one observed sweep). A later read also releases a local home it shows that lostLocalHomes does not
 * name: no longer lost, or running.
 *
 * News, not repeats. The kernel reports a refusal again in every sweep: before `read`, the refusals an earlier
 * sweep of this trigger reported are left out of a copy of the envelope (session-resume.mjs withoutReported; the
 * run's own is never changed). Every other row is this sweep's event and kept. A home released (above) forgets the
 * refusals reported for it, so a refusal after it recovered is news again. A host warning (the result's own
 * `warnings`, about this computer) is left out the same way once a notice of this trigger showed it: once per run,
 * never forgotten (it is no home's); one a quiet sweep carried was never shown, so it stays news. This module reads
 * nothing of the answer itself: its shape is session-resume.mjs's alone.
 *
 * `onReading` gets the reading of every finished sweep, whatever its kind (the caller ignores what it does not
 * show). A run that rejects reads as failed, E_CLI_FAILED; a `read` that throws, as failed, E_CLI_PROTOCOL.
 *
 * `dispose()` stops the trigger and never cancels a sweep: a sweep in flight runs on (a kernel change outlives
 * its client), and its reading is dropped. Nothing here throws out of `launch` or `observed`. */
import { resumeSupported, runResumeSweep } from './session-resume-cli.mjs';
import { readResumeSweep, shownHostKeys, sweepCompleted, sweepSettlement, withoutReported } from './session-resume.mjs';
import { SESSION_ENDS } from './deployment-data.mjs';

export const RESUME_MIN_INTERVAL_MS = 30_000;

const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const absolute = v => typeof v === 'string' && v.startsWith('/') && !v.includes('\0');
/** The local deployment ids as a set of strings: an iterable's string entries; anything else, none. */
const idSet = ids => new Set(typeof ids !== 'string' && typeof ids?.[Symbol.iterator] === 'function'
  ? [...ids].filter(id => typeof id === 'string') : []);
/** A row of a local deployment with a home to name: a record with an absolute `home`, its `deployment.id` in `local`. */
const localRow = (row, local) => record(row) && absolute(row.home) && record(row.deployment) && local.has(row.deployment.id);
const done = Promise.resolve();

/** The ids of a panel reply's local deployments (`/api/panel`: `deployments[]` entries with `local: true`,
 * panel-views.mjs deploymentEntry), in order; anything else, none. What `observed` and lostLocalHomes take. */
export function localDeploymentIds(panel) {
  const entries = record(panel) && Array.isArray(panel.deployments) ? panel.deployments : [];
  return entries.filter(d => record(d) && d.local === true && typeof d.id === 'string').map(d => d.id);
}

/** The homes of `rows` (instance rows as a roster read serves them; anything else: none) whose session was lost
 * in a local deployment: a row whose `deployment.id` is in `localDeploymentIds` (an iterable of ids; missing or
 * empty: no row is local), with an absolute `home`, `sessionEnd` SESSION_ENDS.lost and `running` not true. Each
 * once, in the rows' order. The one place a client reads `sessionEnd`. */
export function lostLocalHomes(rows, localDeploymentIds) {
  if (!Array.isArray(rows)) return [];
  const local = idSet(localDeploymentIds), homes = new Set();
  for (const row of rows) if (localRow(row, local) && row.sessionEnd === SESSION_ENDS.lost && row.running !== true) homes.add(row.home);
  return [...homes];
}

/**
 * @param {{cli: () => unknown, run?: (cli: unknown) => Promise<unknown>, read?: (envelope: unknown) => unknown,
 *   now?: () => number, onReading?: (reading: unknown) => void}} options
 *   `cli()`: the accepted probe, or null, or a promise of either, asked at each would-be start. `run(cli)`: the
 *   sweep's envelope (runResumeSweep). `read(envelope)`: its reading (readResumeSweep). `now()`: milliseconds.
 * @returns {{launch: () => Promise<void>,
 *   observed: (rows: unknown, options?: {localDeploymentIds?: Iterable<string>}) => Promise<void>, dispose: () => void}}
 *   `launch()` arms and runs the launch sweep; a second call answers the first's promise. It settles once that
 *   sweep's onReading ran, or at once when nothing ran. `observed(rows, {localDeploymentIds})` releases, then
 *   applies the rule; it settles when the sweep it started was read, or at once. Neither rejects. `dispose()`:
 *   later calls do nothing.
 */
export function createResumeTrigger({ cli, run = runResumeSweep, read = readResumeSweep, now = Date.now, onReading }) {
  let launched = null, disposed = false, flying = false, lastStart = null;
  const settled = new Set(), reported = new Set(), reportedFor = new Map(); // reportedFor: home → its reported keys
  const reportedHost = new Set(); // host warnings a notice showed
  let releasedDuring = null; // homes a read released while the sweep in flight ran: newer than its answer

  /** A home no longer settled, and the refusals reported for it forgotten. */
  function release(home) {
    releasedDuring?.add(home);
    settled.delete(home);
    for (const key of reportedFor.get(home) ?? []) reported.delete(key);
    reportedFor.delete(home);
  }

  /** The envelope `read` is given, without the refusals an earlier answer reported and the host warnings a
   * notice showed (withoutReported), with this answer's host keys and settlement (sweepSettlement) for after
   * the read. Its refusal keys are added at once. */
  function digest(envelope) {
    const news = { ...withoutReported(envelope, reported, reportedHost), settlement: sweepSettlement(envelope) };
    for (const { home, key } of news.keys) {
      reported.add(key);
      if (!reportedFor.has(home)) reportedFor.set(home, new Set());
      reportedFor.get(home).add(key);
    }
    return news;
  }

  /** After the read: a completed sweep settles every home of its snapshot; then the answer's own rows settle and
   * release (a home it resumed, started, left waiting or found running is released again). A home a read released
   * while the sweep ran is settled by neither: that read is newer than the sweep's answer. */
  function settle(envelope, reading, snapshot, { settlement: { settle: settles, release: released } }, newer) {
    const settleIfNotNewer = home => { if (!newer.has(home)) settled.add(home); };
    if (sweepCompleted(envelope, reading)) for (const home of snapshot) settleIfNotNewer(home);
    for (const home of settles) settleIfNotNewer(home);
    for (const home of released) release(home);
  }

  /** `snapshot`: the lost homes not yet settled that started this sweep (none for the launch sweep). */
  async function sweep(snapshot = []) {
    flying = true;
    const newer = releasedDuring = new Set();
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
        try {
          const news = digest(envelope);
          reading = read(news.envelope);
          releasedDuring = null;
          settle(envelope, reading, snapshot, news, newer);
          for (const key of shownHostKeys(reading, news.hostKeys)) reportedHost.add(key);
        } catch { reading = { kind: 'failed', code: 'E_CLI_PROTOCOL' }; }
      } catch { reading = { kind: 'failed', code: 'E_CLI_FAILED' }; }
      if (!disposed && typeof onReading === 'function') { try { onReading(reading); } catch { /* the caller's */ } }
    } catch { /* never out of launch or observed */ } finally { flying = false; releasedDuring = null; }
  }

  return {
    launch() {
      if (launched) return launched;
      if (disposed) return done;
      launched = sweep();
      return launched;
    },
    observed(rows, options) {
      if (!launched || disposed) return done;
      // A local home this read shows and lostLocalHomes does not name is no longer lost, or runs: released.
      const local = idSet(record(options) ? options.localDeploymentIds : undefined), lostNow = new Set(lostLocalHomes(rows, local));
      if (Array.isArray(rows)) for (const row of rows) if (localRow(row, local) && !lostNow.has(row.home)) release(row.home);
      if (flying || lastStart !== null && now() - lastStart < RESUME_MIN_INTERVAL_MS) return done;
      const snapshot = [...lostNow].filter(home => !settled.has(home));
      if (!snapshot.length) return done;
      return sweep(snapshot);
    },
    dispose() { disposed = true; },
  };
}
