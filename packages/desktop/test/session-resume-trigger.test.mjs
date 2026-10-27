// The shared resume trigger (packages/client/session-resume-trigger.mjs): when a client runs the machine sweep.
// A fake clock (`now`), a fake run whose answers are deferred promises the test settles, and a fake `cli`, sync or
// async. Answers and rows come from the shared builder (helpers/resume-sweep.mjs); what an answer settles and which
// refusals it repeats are session-resume.mjs's (its own tests read every row). The reading is the real reader's,
// so a reading's summary shows what reached it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createResumeTrigger, lostLocalHomes, RESUME_MIN_INTERVAL_MS } from '../../client/session-resume-trigger.mjs';
import { readResumeSweep, REFUSED_REASONS, SKIPPED_REASONS, SETTLING_SKIPPED_REASONS } from '../../client/session-resume.mjs';
import { SESSION_RESUME_FEATURE } from '../../client/session-resume-cli.mjs';
import { SESSION_ENDS } from '../../client/deployment-data.mjs';
import { RESUME_PROBE as PROBE, sweepHome as H, sweepAnswer as answer, sweepRefusal, sweepRow, lostInstance as lost,
  resumedRow, freshRow, blockedRow, refusedRow, runningRow, skippedRow } from './helpers/resume-sweep.mjs';

const BUSY = sweepRefusal('E_RESUME_BUSY', 'another sweep runs');
const [START_REFUSED, , KEEPS_GETTING_LOST] = REFUSED_REASONS;
const RELEASING = { resumed: resumedRow, fresh: freshRow, blocked: blockedRow, alreadyRunning: runningRow };
const deferred = () => { let resolve, reject; const promise = new Promise((y, n) => { resolve = y; reject = n; }); return { promise, resolve, reject }; };

/** A trigger over fakes. `h.runs` holds each run started (its probe and its deferred answer); `h.readings` each
 * reading given to onReading; `h.t` is the clock. `h.cli` is what cli() answers (a value or a function of none). */
function harness(over = {}) {
  const h = { t: 0, runs: [], readings: [], cli: PROBE, cliCalls: 0 };
  h.trigger = createResumeTrigger({
    cli: () => { h.cliCalls += 1; return typeof h.cli === 'function' ? h.cli() : h.cli; },
    run: (probe, ...rest) => { const d = deferred(); h.runs.push({ probe, rest, ...d }); return d.promise; },
    now: () => h.t,
    onReading: reading => h.readings.push(reading),
    ...over,
  });
  /** Settle the latest run with `envelope` and wait for the sweep's promise. */
  h.answer = async (pending, envelope) => { h.runs.at(-1).resolve(envelope); await pending; };
  return h;
}
/** Launch and answer the launch sweep with `rows` (or an envelope). */
async function launched(h, rows = []) {
  const p = h.trigger.launch();
  await h.answer(p, Array.isArray(rows) ? answer(rows) : rows);
}
/** Whether a read showing `rows` at time `t` starts a sweep; one started is answered with `reply` rows. */
async function starts(h, t, rows, reply = []) {
  h.t = t;
  const before = h.runs.length, p = h.trigger.observed(rows);
  await new Promise(setImmediate);
  if (h.runs.length === before) { await p; return false; }
  await h.answer(p, answer(reply));
  return true;
}

test('lostLocalHomes: a local, lost, not running row with an absolute home; each once, in order', () => {
  assert.deepEqual(lostLocalHomes([lost('a'), lost('b', { running: null }), lost('c', { running: undefined }), lost('a')]), [H('a'), H('b'), H('c')]);
  assert.deepEqual(lostLocalHomes([
    lost('remote', { server: 'altair' }), lost('remote-undefined', { server: undefined }), lost('flagged', { remote: true }),
    lost('running', { running: true }),
    lost('stopped', { sessionEnd: SESSION_ENDS.stopped }), lost('exited', { sessionEnd: SESSION_ENDS.exited }), lost('LOST', { sessionEnd: 'LOST' }),
    lost('none', { sessionEnd: undefined }), lost('null', { sessionEnd: null }),
    lost('relative', { home: 'agents/dev/instances/x' }), lost('empty', { home: '' }), lost('number', { home: 7 }),
    lost('nul', { home: '/home/a\0b' }), lost('missing', { home: undefined }),
    null, 'row', [lost('array')], 7,
  ]), []);
  assert.deepEqual(lostLocalHomes([lost('kept', { remote: false })]), [H('kept')], 'remote false is local');
  for (const notRows of [undefined, null, {}, 'rows', lost('a')]) assert.deepEqual(lostLocalHomes(notRows), []);
});

test('observed does nothing before launch; launch runs at once, with no floor, and a second launch is the same promise', async () => {
  const h = harness();
  const early = h.trigger.observed([lost('a')]);
  assert.equal(h.cliCalls, 0, 'not armed: the probe is not even asked');
  await early;
  assert.equal(h.runs.length, 0);
  const first = h.trigger.launch();
  assert.equal(h.trigger.launch(), first);
  assert.equal(h.runs.length, 1, 'one launch sweep, at time 0, with no lost row to see');
  assert.equal(h.runs[0].probe, PROBE);
  assert.deepEqual(h.runs[0].rest, [], 'nothing beside the probe: no signal, nothing to cancel it with');
  let settled = false; first.then(() => { settled = true; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(settled, false, 'launch settles only once its sweep is read');
  await h.answer(first, answer([resumedRow('a')]));
  assert.equal(h.readings.length, 1);
  assert.equal(h.readings[0].kind, 'notice');
  assert.equal(h.trigger.launch(), first);
  assert.equal(h.runs.length, 1);
});

test('single flight: a read while a sweep runs starts nothing; after it, the next read past the floor does', async () => {
  const h = harness();
  const p = h.trigger.launch();
  h.t = RESUME_MIN_INTERVAL_MS * 3;
  await h.trigger.observed([lost('a')]);
  assert.equal(h.runs.length, 1, 'the launch sweep is in flight');
  await h.answer(p, answer([]));
  assert.equal(await starts(h, h.t, [lost('a')]), true);
});

test('the floor counts from the start of the last sweep, not its end', async () => {
  const h = harness();
  const p = h.trigger.launch();
  h.t = 25_000;
  await h.answer(p, answer([]));
  assert.equal(await starts(h, RESUME_MIN_INTERVAL_MS - 1, [lost('a')]), false);
  assert.equal(await starts(h, RESUME_MIN_INTERVAL_MS, [lost('a')]), true, 'from the start at 0, not the end at 25 s');
  assert.equal(await starts(h, RESUME_MIN_INTERVAL_MS + 1, [lost('a')]), false, 'that sweep started at 30 s');
  assert.equal(await starts(h, 2 * RESUME_MIN_INTERVAL_MS, [lost('a')]), true);
});

test('no lost local home, or only settled ones: nothing starts, whatever the time', async () => {
  const h = harness();
  await launched(h);
  for (const rows of [[], undefined, null, 'rows', [lost('a', { running: true })], [lost('r', { remote: true })], [lost('s', { sessionEnd: SESSION_ENDS.stopped })]]) {
    assert.equal(await starts(h, 10 * RESUME_MIN_INTERVAL_MS, rows), false, JSON.stringify(rows));
  }
});

test('settled: refused and skipped not-lost settle; start-busy and unknown do not; the other outcomes release', async () => {
  const h = harness();
  let t = 0;
  const later = () => (t += RESUME_MIN_INTERVAL_MS);
  await launched(h, [
    refusedRow('x', { reason: START_REFUSED, code: 'E_START_REFUSED' }), skippedRow('n', { reason: SKIPPED_REASONS.notLost }),
    skippedRow('b', { reason: SKIPPED_REASONS.startBusy }), skippedRow('u', { reason: SKIPPED_REASONS.unknown }), skippedRow('o'),
  ]);
  assert.equal(await starts(h, later(), [lost('x'), lost('n')]), false, 'refused and not-lost are settled');
  for (const name of ['b', 'u', 'o']) assert.equal(await starts(h, later(), [lost('x'), lost(name)]), true, name);
  // Each releasing outcome, in a later answer, lets its home start a sweep again.
  for (const [outcome, rowOf] of Object.entries(RELEASING)) {
    const name = `s-${outcome}`;
    assert.equal(await starts(h, later(), [lost('b')], [refusedRow(name, { code: 'E_X' })]), true);
    assert.equal(await starts(h, later(), [lost(name)]), false, `${name} settled`);
    assert.equal(await starts(h, later(), [lost('b')], [rowOf(name)]), true);
    assert.equal(await starts(h, later(), [lost(name)]), true, `${outcome} released it`);
  }
  // A settled home with an unknown outcome or a start-busy row stays settled.
  assert.equal(await starts(h, later(), [lost('b')], [skippedRow('x', { reason: SKIPPED_REASONS.startBusy }), sweepRow('x', 'vanished')]), true);
  assert.equal(await starts(h, later(), [lost('x')]), false);
  // A row that does not decode settles nothing and breaks nothing.
  assert.equal(await starts(h, later(), [lost('b')], [null, 'row', refusedRow('y', { home: 7 }), refusedRow('y', { home: undefined })]), true);
  assert.equal(await starts(h, later(), [lost('x')]), false);
});

test('settled: a home skipped as not seen recently stays settled while its row reads lost; running releases it', async () => {
  const h = harness();
  const unseen = skippedRow('u', { reason: SKIPPED_REASONS.notSeenRecently });
  await launched(h, [unseen]);
  assert.ok(SETTLING_SKIPPED_REASONS.includes(SKIPPED_REASONS.notSeenRecently));
  assert.equal(await starts(h, RESUME_MIN_INTERVAL_MS - 1, [lost('u')]), false, 'within the floor');
  assert.equal(await starts(h, RESUME_MIN_INTERVAL_MS, [lost('u')]), false, 'after the floor: settled');
  assert.equal(await starts(h, 5 * RESUME_MIN_INTERVAL_MS, [lost('u')]), false, 'and later still');
  assert.equal(h.runs.length, 1);
  // The human starts it: the read shows it running, which releases it; the next lost read after the floor sweeps.
  assert.equal(await starts(h, 6 * RESUME_MIN_INTERVAL_MS, [lost('u', { running: true })]), false);
  assert.equal(await starts(h, 6 * RESUME_MIN_INTERVAL_MS, [lost('u')], [unseen]), true);
  assert.equal(await starts(h, 8 * RESUME_MIN_INTERVAL_MS, [lost('u')]), false, 'skipped again: settled again');
});

test('settled: a later read releases a local home that is no longer lost, or runs', async () => {
  const h = harness();
  let t = 0;
  const later = () => (t += RESUME_MIN_INTERVAL_MS);
  await launched(h, [refusedRow('a', { code: 'E_X' }), refusedRow('b', { code: 'E_X' }), skippedRow('c', { reason: SKIPPED_REASONS.notLost })]);
  assert.equal(await starts(h, later(), [lost('a'), lost('b'), lost('c')]), false);
  // The human started a: running. Its row is not lost now, so it starts nothing, but it is released.
  assert.equal(await starts(h, later(), [lost('a', { running: true })]), false);
  assert.equal(await starts(h, later(), [lost('a')], [refusedRow('a', { code: 'E_X' })]), true, 'a lost again: a sweep');
  // b's session ended another way, then was lost again.
  for (const end of [SESSION_ENDS.stopped, SESSION_ENDS.exited, undefined, null]) {
    assert.equal(await starts(h, later(), [lost('b', { sessionEnd: end })]), false);
    assert.equal(await starts(h, later(), [lost('b')], [refusedRow('b', { code: 'E_X' })]), true, String(end));
  }
  // A remote row, or one without an absolute home, releases nothing: it cannot speak for this machine's home.
  const stopped = { sessionEnd: SESSION_ENDS.stopped };
  assert.equal(await starts(h, later(), [lost('c', { ...stopped, server: 'altair' }), lost('c', { ...stopped, remote: true }),
    lost('c', { ...stopped, home: 'relative' }), lost('c', { ...stopped, home: 7 })]), false);
  assert.equal(await starts(h, later(), [lost('c')]), false, 'still settled');
  // A release seen while a sweep runs still counts.
  const p = h.trigger.observed([lost('zz')]);
  h.trigger.observed([lost('c', { sessionEnd: SESSION_ENDS.stopped })]);
  await h.answer(p, answer([]));
  assert.equal(await starts(h, later(), [lost('c')]), true, 'released during the sweep');
});

test('news, not repeats: a refused row already reported is dropped; a changed reason or code is news again', async () => {
  const h = harness();
  let t = 0;
  const later = () => (t += RESUME_MIN_INTERVAL_MS);
  const x = (more = {}) => refusedRow('x', { reason: START_REFUSED, code: 'E_START_REFUSED', ...more });
  await launched(h, [x(), x(), resumedRow('r')]);
  assert.deepEqual(h.readings[0].summary.refused.map(r => r.instance), ['x', 'x'], 'two in one sweep are both this sweep\'s');
  // The same refusal again: dropped. A resumed row again: an event of this sweep, kept.
  assert.equal(await starts(h, later(), [lost('other')], [x(), resumedRow('r')]), true);
  assert.equal(h.readings.at(-1).kind, 'notice');
  assert.deepEqual(h.readings.at(-1).summary.refused, []);
  assert.deepEqual(h.readings.at(-1).summary.resumed.map(r => r.instance), ['r']);
  // Only the repeat: quiet.
  assert.equal(await starts(h, later(), [lost('other')], [x()]), true);
  assert.equal(h.readings.at(-1).kind, 'quiet');
  // Its reason changes: news. Then its code: news. Then the first again: already reported.
  assert.equal(await starts(h, later(), [lost('other')], [x({ reason: KEEPS_GETTING_LOST })]), true);
  assert.deepEqual(h.readings.at(-1).summary.refused.map(r => r.reason), [KEEPS_GETTING_LOST]);
  assert.equal(await starts(h, later(), [lost('other')], [x({ reason: KEEPS_GETTING_LOST, code: 'E_RESUME_REFUSED' })]), true);
  assert.deepEqual(h.readings.at(-1).summary.refused.map(r => r.code), ['E_RESUME_REFUSED']);
  assert.equal(await starts(h, later(), [lost('other')], [x(), x({ reason: KEEPS_GETTING_LOST })]), true);
  assert.equal(h.readings.at(-1).kind, 'quiet');
  // Another home with the same reason and code is news; so is a reason or code that was absent and now is not.
  assert.equal(await starts(h, later(), [lost('other')], [refusedRow('y', { reason: START_REFUSED, code: 'E_START_REFUSED' })]), true);
  assert.deepEqual(h.readings.at(-1).summary.refused.map(r => r.instance), ['y']);
  assert.equal(await starts(h, later(), [lost('other')], [refusedRow('z')]), true);
  assert.equal(await starts(h, later(), [lost('other')], [refusedRow('z')]), true);
  assert.equal(h.readings.at(-1).kind, 'quiet');
  assert.equal(await starts(h, later(), [lost('other')], [refusedRow('z', { code: 'E_X' })]), true);
  assert.equal(h.readings.at(-1).kind, 'notice');
});

test('news, not repeats: a released home forgets its reported refusals, so a refusal after it recovered is news', async () => {
  const h = harness();
  let t = 0;
  const later = () => (t += RESUME_MIN_INTERVAL_MS);
  const x = () => refusedRow('x', { reason: START_REFUSED, code: 'E_START_REFUSED' });
  const y = () => refusedRow('y', { reason: START_REFUSED, code: 'E_START_REFUSED' });
  await launched(h, [x(), y()]);
  assert.deepEqual(h.readings[0].summary.refused.map(r => r.instance), ['x', 'y']);
  // x and y are settled by their refusals, so another lost home starts each sweep.
  // A sweep resumes x: released, its refusal forgotten. y is untouched.
  assert.equal(await starts(h, later(), [lost('other')], [resumedRow('x'), y()]), true);
  assert.deepEqual(h.readings.at(-1).summary.refused, [], 'y is still a repeat');
  assert.equal(await starts(h, later(), [lost('other')], [x(), y()]), true);
  assert.deepEqual(h.readings.at(-1).summary.refused.map(r => r.instance), ['x'], 'x refused again after it recovered: news');
  // A read shows y running: released too, and its next refusal is news.
  await h.trigger.observed([lost('y', { running: true })]);
  assert.equal(await starts(h, later(), [lost('other')], [x(), y()]), true);
  assert.deepEqual(h.readings.at(-1).summary.refused.map(r => r.instance), ['y'], 'x a repeat again; y news');
  // A read that does not show a home releases nothing: x stays reported.
  assert.equal(await starts(h, later(), [lost('other')], [x()]), true);
  assert.equal(h.readings.at(-1).kind, 'quiet');
});

test('an answer the reader fails or reads as nothing (not the document, or a plan) settles nothing and reports nothing', async () => {
  const x = () => refusedRow('x', { reason: START_REFUSED, code: 'E_START_REFUSED' });
  for (const bad of [answer([x()], [], { schemaVersion: 2 }), answer([x()], null), answer([x()], [], { plan: true })]) {
    const h = harness();
    await launched(h, bad);
    assert.notEqual(h.readings[0].kind, 'notice');
    // x was not settled: its lost read at the floor sweeps.
    assert.equal(await starts(h, RESUME_MIN_INTERVAL_MS, [lost('x')], [x()]), true);
    // And its refusal was never reported: the valid one is news.
    assert.deepEqual(h.readings.at(-1).summary.refused.map(r => r.instance), ['x']);
  }
});

test('news, not repeats: read gets a copy; the run\'s envelope is never changed; other answers pass unchanged', async () => {
  const seen = [];
  const h = harness({ read: envelope => { seen.push(envelope); return readResumeSweep(envelope); } });
  const first = answer([refusedRow('x', { code: 'E_X' })]);
  await launched(h, first);
  assert.equal(seen[0] === first, false);
  const second = answer([refusedRow('x', { code: 'E_X' }), resumedRow('r')]);
  const before = structuredClone(second), rows = second.result.rows;
  assert.equal(await starts(h, RESUME_MIN_INTERVAL_MS, [lost('a')], []), true);
  const p = (h.t = 2 * RESUME_MIN_INTERVAL_MS, h.trigger.observed([lost('a')]));
  await h.answer(p, second);
  assert.deepEqual(second, before, 'the run\'s object is not mutated');
  assert.equal(second.result.rows, rows);
  assert.deepEqual(seen.at(-1), { ...before, result: { ...before.result, rows: [before.result.rows[1]] } });
  // An answer that is not ok:true, or has no rows array, reaches read as it came, and settles nothing.
  for (const envelope of [BUSY, { schemaVersion: 1, ok: true, result: { rows: 'x' } }, { ok: true }, null, 'text']) {
    h.t += RESUME_MIN_INTERVAL_MS;
    const q = h.trigger.observed([lost('a')]);
    await h.answer(q, envelope);
    assert.equal(seen.at(-1), envelope);
  }
});

test('busy: read and handed on, it changes nothing, and the floor counts from its start', async () => {
  const h = harness();
  await launched(h, [refusedRow('x', { code: 'E_X' })]);
  const p = (h.t = RESUME_MIN_INTERVAL_MS, h.trigger.observed([lost('a')]));
  await h.answer(p, BUSY);
  assert.deepEqual(h.readings.at(-1), { kind: 'busy' });
  assert.equal(await starts(h, 2 * RESUME_MIN_INTERVAL_MS - 1, [lost('a')]), false);
  assert.equal(await starts(h, 2 * RESUME_MIN_INTERVAL_MS, [lost('x')]), false, 'x is still settled');
  assert.equal(await starts(h, 2 * RESUME_MIN_INTERVAL_MS, [lost('a')]), true);
});

test('every finished sweep is read: failed with its code, and a run that rejects reads as failed E_CLI_FAILED', async () => {
  const h = harness();
  const p = h.trigger.launch();
  h.runs[0].reject(new Error('boom'));
  await p;
  assert.deepEqual(h.readings, [{ kind: 'failed', code: 'E_CLI_FAILED' }]);
  assert.equal(await starts(h, RESUME_MIN_INTERVAL_MS - 1, [lost('a')]), false, 'it ran: the floor moved');
  const q = (h.t = RESUME_MIN_INTERVAL_MS, h.trigger.observed([lost('a')]));
  await h.answer(q, { schemaVersion: 1, ok: false, error: { code: 'E_CLI_OUTPUT_LIMIT' } });
  assert.deepEqual(h.readings.at(-1), { kind: 'failed', code: 'E_CLI_OUTPUT_LIMIT' });
  const r = (h.t = 2 * RESUME_MIN_INTERVAL_MS, h.trigger.observed([lost('a')]));
  await h.answer(r, { schemaVersion: 1, ok: false, error: { code: 'E_RESUME_FEATURE' } });
  assert.deepEqual(h.readings.at(-1), { kind: 'unsupported' });
});

test('dispose stops the trigger without cancelling: the sweep in flight runs on, and its reading is dropped', async () => {
  const h = harness();
  const p = h.trigger.launch();
  h.trigger.dispose();
  h.trigger.dispose();
  let settled = false; p.then(() => { settled = true; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(settled, false, 'the sweep still runs');
  await h.answer(p, answer([resumedRow('a')]));
  assert.deepEqual(h.readings, [], 'never onReading after dispose');
  h.t = 10 * RESUME_MIN_INTERVAL_MS;
  await h.trigger.observed([lost('b')]);
  assert.equal(h.trigger.launch(), p);
  assert.equal(h.runs.length, 1);
  // Disposed before launch: launch does nothing.
  const d = harness();
  d.trigger.dispose();
  await d.trigger.launch();
  await d.trigger.observed([lost('a')]);
  assert.deepEqual([d.runs.length, d.cliCalls, d.readings.length], [0, 0, 0]);
  // Disposed while the probe is asked: nothing is read.
  const c = harness(), gate = deferred();
  c.cli = () => gate.promise;
  const q = c.trigger.launch();
  c.trigger.dispose();
  gate.resolve(PROBE);
  await Promise.resolve(); await Promise.resolve();
  await c.answer(q, answer([resumedRow('a')]));
  assert.deepEqual(c.readings, []);
});

test('no CLI, or one without the feature: nothing runs, nothing is read, the floor stays and the slot is let go', async () => {
  for (const cli of [null, undefined, { ok: false, bin: '/oats', features: [SESSION_RESUME_FEATURE] }, { ok: true, bin: 'oats', features: [SESSION_RESUME_FEATURE] },
    { ok: true, bin: '/oats', features: [] }, { ok: true, bin: '/oats' }]) {
    const h = harness();
    h.cli = cli;
    await h.trigger.launch();
    assert.deepEqual([h.runs.length, h.readings.length, h.cliCalls], [0, 0, 1], JSON.stringify(cli));
    await h.trigger.observed([lost('a')]);
    assert.equal(h.cliCalls, 2, 'armed: the next read asks again, at once (no floor, the slot free)');
    // The CLI changes: followed at the next would-be start.
    h.cli = PROBE;
    assert.equal(await starts(h, 1, [lost('a')]), true);
  }
  // After a sweep that ran at 0, an unsupported answer at 30 s does not move the floor.
  const h = harness();
  await launched(h);
  h.cli = null;
  assert.equal(await starts(h, RESUME_MIN_INTERVAL_MS, [lost('a')]), false);
  h.cli = async () => PROBE;
  assert.equal(await starts(h, RESUME_MIN_INTERVAL_MS + 1, [lost('a')]), true, 'the floor still counts from 0');
});

test('cli() sync or async; the slot is held while it is asked', async () => {
  const sync = harness();
  sync.trigger.launch();
  assert.equal(sync.runs.length, 1);
  const gate = deferred(), h = harness();
  h.cli = () => gate.promise;
  const p = h.trigger.launch();
  h.t = 10 * RESUME_MIN_INTERVAL_MS;
  const other = h.trigger.observed([lost('a')]);
  await other;
  assert.equal(h.cliCalls, 1, 'a second read starts nothing while the probe is pending');
  gate.resolve(PROBE);
  await new Promise(setImmediate);
  assert.equal(h.runs.length, 1);
  assert.equal(h.runs[0].probe, PROBE);
  await h.answer(p, answer([]));
  assert.deepEqual(h.readings, [{ kind: 'quiet', summary: readResumeSweep(answer([])).summary }]);
  // The floor counts from when the slot was taken (0), not from when the probe answered.
  assert.equal(await starts(h, RESUME_MIN_INTERVAL_MS, [lost('a')]), true);
});

test('never rejects: a cli() that throws or rejects reads as no CLI; a throwing onReading or read stays inside', async () => {
  const h = harness();
  h.cli = () => { throw new Error('probe'); };
  await h.trigger.launch();
  h.cli = () => Promise.reject(new Error('probe'));
  await h.trigger.observed([lost('a')]);
  assert.deepEqual([h.runs.length, h.readings.length], [0, 0]);
  const loud = harness({ onReading: () => { throw new Error('caller'); } });
  const p = loud.trigger.launch();
  await loud.answer(p, answer([]));
  const odd = harness({ read: () => { throw new Error('reader'); } });
  const q = odd.trigger.launch();
  await odd.answer(q, answer([]));
  assert.deepEqual(odd.readings, [{ kind: 'failed', code: 'E_CLI_PROTOCOL' }]);
  // No onReading at all is allowed.
  const quiet = harness({ onReading: undefined });
  const r = quiet.trigger.launch();
  await quiet.answer(r, answer([]));
});
