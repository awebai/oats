// Private index-stage integration, without a command scheduler or manager.
// Reopening these fixture databases models commit boundaries, not process death.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RecordStore } from '../lib/store.mjs';
import { RecordIndex } from '../lib/index-db.mjs';
import { DerivedState, fileVersion } from '../lib/derived-state.mjs';
import { CaptureRun } from '../lib/capture-run.mjs';
import { CaptureBudget } from '../lib/capture-budget.mjs';
import { captureIndexWork } from '../lib/capture-index-work.mjs';
import { reconcileCaptureInterruption } from '../lib/capture-retry.mjs';
import { withCaptureGroup } from '../lib/capture-context.mjs';
import { finishTurn } from '../lib/canonical.mjs';

const now = Date.parse('2026-01-01T00:00:00.000Z'), due = now + 30 * 60 * 1000;
const turn = n => finishTurn({ v: 1, ts: '2026-01-01T00:00:00Z', from: 'fixture', kind: 'mail',
  body: { text: `message ${n}` }, provenance: { source: 'aw', fidelity: 'projected' } });
function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'capture-index-work-'));
  const store = new RecordStore(root, { owner: 'fixture' });
  let state = new DerivedState(root), index = new RecordIndex(store), tick = now;
  t.after(() => { index.close(); state.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, store, get state() { return state; }, get index() { return index; },
    reopen() { index.close(); state.close(); state = new DerivedState(root); index = new RecordIndex(store); },
    run(id, options = {}) { return new CaptureRun(root, state, { id, clock: () => new Date(tick += 1000).toISOString(), ...options }); },
    unit(run, streams, options = {}, budget = new CaptureBudget()) {
      return captureIndexWork(index, state, streams, run, { budget }, { now, ...options });
    },
    count() { return index.db.prepare('SELECT count(*) AS n FROM turns').get().n; },
  };
}

test('bounded index groups retain confirmed counters across reopen; no-op leaves progress unchanged', t => {
  const f = fixture(t), streams = ['fixture~a', 'fixture~b'];
  for (const [i, stream] of streams.entries()) f.store.appendBatch(stream, [turn(i * 10), turn(i * 10 + 1), turn(i * 10 + 2)]);
  let run = f.run('continued');
  for (let unit = 0; unit < 3; unit++) {
    const result = f.unit(run, streams, { limit: 2, maxRecords: 2 });
    assert.equal(result.selected, 2); assert.equal(result.turnsIndexed, 2);
    assert.deepEqual(result.streams.map(row => row.phase), Array(2).fill(unit === 2 ? 'complete' : 'index'));
    const snapshot = run.publish({ pending: true });
    assert.equal(snapshot.lastRun.counts.turnsIndexed, (unit + 1) * 2);
    assert.equal(snapshot.lastRun.counts.turnsAppended, 0);
    assert.equal(f.state.get('capture-admission', 'active'), null);
    assert.equal(f.state.get('capture-schedule', 'position:index').after, streams[1]);
    f.reopen(); run = f.run('continued');
  }
  const progress = run.publish({ pending: true }).lastProgressAt;
  const result = f.unit(run, streams, { limit: 2, maxRecords: 2 });
  assert.equal(result.turnsIndexed, 0); assert.equal(result.bytesIndexed, 0);
  assert.equal(run.publish({ pending: true }).lastProgressAt, progress);
  assert.equal(f.count(), 6);
  // A stage helper never certifies the other stages or final run completion.
  assert.equal(run.publish({ pending: true }).lastRun.outcome, 'running');
});

test('failed index group preserves unknown attribution, healthy work and next-due single admissions', t => {
  const f = fixture(t), streams = ['fixture~a', 'fixture~b', 'fixture~healthy'];
  streams.forEach((stream, i) => f.store.appendBatch(stream, [turn(i * 10), turn(i * 10 + 1)]));
  let run = f.run('failed');
  const add = f.index.addTurn.bind(f.index); let added = 0;
  f.index.addTurn = (...args) => { if (++added === 2) throw Error('injected index write'); return add(...args); };
  assert.throws(() => f.unit(run, streams, { limit: 2 }), /injected index write/);
  assert.equal(f.count(), 0, 'index transaction rolls back');
  assert.equal(f.state.get('capture-admission', 'active').members.length, 2);
  f.reopen();
  const failure = reconcileCaptureInterruption(f.state, { reason: 'io', now });
  assert.equal(failure.memberCount, 2); assert.equal(failure.reason, 'interrupted');
  assert.equal([...f.state.entries('capture-failed')].length, 0);
  run = f.run('failed', { previousFailure: failure.reason });
  const healthy = f.unit(run, streams, { limit: 2 });
  assert.deepEqual(healthy.streams.map(row => row.stream), ['fixture~healthy']);
  assert.equal(healthy.turnsIndexed, 2);
  assert.equal(f.unit(run, [], { now: due }).selected, 0, 'no retry in the failed pass even when due');
  const receipt = run.finish({ outcome: 'complete', pending: true });
  assert.equal(receipt.lastRun.outcome, 'failed'); assert.equal(receipt.lastSuccess, null);
  assert.equal(receipt.lastFailure.counts.turnsIndexed, 2);
  const history = structuredClone(receipt.lastFailure);
  f.reopen(); run = f.run('due');
  for (const stream of streams.slice(0, 2)) {
    const result = f.unit(run, [], { now: due });
    assert.equal(result.selected, 1); assert.deepEqual(result.streams, [{ stream, phase: 'complete' }]);
    assert.equal(f.state.get('capture-retry', stream), null);
  }
  assert.equal(f.unit(run, [], { now: due }).selected, 0);
  assert.equal(f.count(), 6);
  const finished = run.finish({ outcome: 'complete', pending: false });
  assert.equal(finished.lastRun.counts.turnsIndexed, 4);
  assert.equal(finished.lastSuccess.id, 'due'); assert.deepEqual(finished.lastFailure, history);
});

test('partial due index retry retains its unit-start failure until complete on a later pass', t => {
  const f = fixture(t), stream = 'fixture~a';
  f.store.appendBatch(stream, [turn(1), turn(2), turn(3), turn(4)]);
  let run = f.run('first');
  f.unit(run, [stream], { limit: 1, maxRecords: 1 });
  const offset = f.index.db.prepare('SELECT bytes FROM index_bytes WHERE stream=?').get(stream).bytes;
  f.index.addTurn = () => { throw Error('single index failure'); };
  assert.throws(() => f.unit(run, [stream], { limit: 1, maxRecords: 1 }), /single index failure/);
  f.reopen(); reconcileCaptureInterruption(f.state, { reason: 'io', now });
  const failure = f.state.get('capture-failed', stream);
  assert.equal(failure.offset, offset); assert.equal(failure.stage, 'index'); assert.equal(failure.attempts, 1);
  run = f.run('partial-due');
  assert.equal(f.unit(run, [], { limit: 1, maxRecords: 1, now: due }).streams[0].phase, 'index');
  assert.deepEqual(f.state.get('capture-failed', stream), failure);
  assert.equal(f.unit(run, [], { limit: 1, maxRecords: 1, now: due }).selected, 0);
  run.finish({ outcome: 'partial', reason: 'input', pending: true });
  f.reopen(); run = f.run('complete-due');
  assert.equal(f.unit(run, [], { now: due }).streams[0].phase, 'complete');
  assert.equal(f.state.get('capture-failed', stream), null);
  assert.equal(f.state.get('capture-retry', stream), null); assert.equal(f.count(), 4);
});

test('corruption after resumed validation is attributed to that validation unit start', t => {
  const f = fixture(t), stream = 'fixture~corrupt';
  f.store.append(stream, turn(1));
  const prefixBytes = fs.statSync(f.store.journalPath(stream)).size;
  fs.appendFileSync(f.store.journalPath(stream), 'invalid-json\n');
  const run = f.run('validation');
  // The first unit clears the obsolete ID; the second validates the good
  // prefix. Neither has an index cursor or permission to index partial proof.
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = f.unit(run, [stream], { limit: 1, maxRecords: 1 });
    assert.equal(result.streams[0].phase, 'validation'); assert.equal(result.turnsIndexed, 0);
  }
  assert.equal(f.state.get('journal', stream).bytes, prefixBytes);
  assert.throws(() => f.unit(run, [stream], { limit: 1, maxRecords: 1 }), /corrupt interior journal line/);
  assert.equal(f.state.get('capture-admission', 'active').members[0].offset, prefixBytes);
  f.reopen(); reconcileCaptureInterruption(f.state, { reason: 'io', now });
  assert.equal(f.state.get('capture-failed', stream).offset, prefixBytes);
  assert.equal(f.state.get('journal', stream).bytes, prefixBytes);
  assert.equal(f.count(), 0, 'incomplete validation cannot publish an indexed prefix');
});

test('index commit survives accounting rollback without reconstructing lost run counts', t => {
  const f = fixture(t), stream = 'fixture~a';
  f.store.appendBatch(stream, [turn(1), turn(2)]);
  let run = f.run('lost-accounting'); const record = run.record.bind(run);
  run.record = (...args) => { record(...args); throw Error('accounting commit fault'); };
  assert.throws(() => f.unit(run, [stream]), /accounting commit fault/);
  assert.equal(f.count(), 2); assert.equal(f.state.get('capture-run', 'current').run.counts.turnsIndexed, 0);
  assert.equal(f.state.get('capture-admission', 'active').members[0].stream, stream);
  f.reopen(); reconcileCaptureInterruption(f.state, { reason: 'io', now });
  run = f.run('later');
  const result = f.unit(run, [], { now: due });
  assert.equal(result.streams[0].phase, 'complete'); assert.equal(result.turnsIndexed, 0);
  assert.equal(f.state.get('capture-retry', stream), null); assert.equal(f.count(), 2);
  const receipt = run.finish({ outcome: 'complete' });
  assert.equal(receipt.lastRun.counts.turnsIndexed, 0);
  assert.equal(receipt.lastFailure.id, 'lost-accounting'); assert.equal(receipt.lastFailure.counts.turnsIndexed, 0);
});

test('reset detection never resets the union or resolves a deferred index failure', t => {
  const f = fixture(t), stream = 'fixture~a';
  f.store.appendBatch(stream, [turn(1), turn(2)]);
  let run = f.run('first'); f.unit(run, [stream]);
  const record = run.record.bind(run);
  run.record = (...args) => { record(...args); throw Error('before capture commit'); };
  assert.throws(() => f.unit(run, [stream]), /before capture commit/);
  f.reopen(); reconcileCaptureInterruption(f.state, { reason: 'io', now });
  f.index.db.exec('DELETE FROM index_bytes');
  const before = f.index.db.prepare('SELECT * FROM turns ORDER BY id').all();
  f.index.reset = () => { assert.fail('detecting group must not execute reset'); };
  run = f.run('reset-due');
  const result = f.unit(run, [], { now: due });
  assert.equal(result.resetRequired, true); assert.equal(result.reset, false);
  assert.deepEqual(result.streams, [{ stream, phase: 'reset' }]);
  assert.equal(result.turnsIndexed, 0);
  assert.deepEqual(f.index.db.prepare('SELECT * FROM turns ORDER BY id').all(), before);
  assert.ok(f.state.get('capture-retry', stream)); assert.ok(f.state.get('capture-failed', stream));
  assert.equal(f.state.get('capture-admission', 'active'), null);
  assert.equal(run.publish({ pending: true }).lastRun.counts.turnsIndexed, 0);
});

test('other-stage retries and cooperative stops do not admit index work or erase failure evidence', t => {
  const f = fixture(t), stream = 'fixture~source'; f.store.append(stream, turn(1));
  const generation = fileVersion(f.store.journalPath(stream));
  assert.throws(() => withCaptureGroup(f.store, [stream], () => { throw Error('source interruption'); }, {
    state: f.state, admissionNow: now, admission: { runId: 'source', stage: 'capture',
      next: { stage: 'capture', after: stream }, members: [{ stream, offset: 0, generation }] },
  }), /source interruption/);
  reconcileCaptureInterruption(f.state, { reason: 'io', now });
  const failure = f.state.get('capture-failed', stream), retry = f.state.get('capture-retry', stream);
  const run = f.run('index');
  const deferred = f.unit(run, [], { now: due });
  assert.equal(deferred.selected, 0); assert.equal(deferred.deferred.stage, 'capture');
  const stopped = new CaptureBudget({ clock: () => 1, drainAt: 0 });
  assert.deepEqual(f.unit(run, [stream], { now: due }, stopped), { stopped: true, selected: 0 });
  assert.deepEqual(f.state.get('capture-failed', stream), failure);
  assert.deepEqual(f.state.get('capture-retry', stream), retry);
  assert.equal(f.state.get('capture-admission', 'active'), null); assert.equal(f.count(), 0);
});
