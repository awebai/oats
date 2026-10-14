import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { DerivedState } from '../lib/derived-state.mjs';
import { CaptureRun } from '../lib/capture-run.mjs';
import { readCaptureStatus } from '../lib/capture-status.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'capture-run-'));
  let state = new DerivedState(root), tick = Date.parse('2026-01-01T00:00:00.000Z');
  t.after(() => { state.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, get state() { return state; },
    reopen() { state.close(); state = new DerivedState(root); },
    run(id, options = {}) { return new CaptureRun(root, state, { id, clock: () => new Date(tick += 1000).toISOString(), ...options }); } };
}

test('counters and progress join committed work; a rolled-back unit cannot publish either', t => {
  const f = fixture(t), run = f.run('first');
  assert.throws(() => run.record({ turnsAppended: 1 }), /invalid committed/);
  assert.throws(() => f.state.transaction(() => {
    run.record({ turnsAppended: 7, bytesCommitted: 700 }, { progress: true });
    assert.throws(() => run.publish(), /uncommitted/);
    throw Error('injected checkpoint failure');
  }), /checkpoint failure/);
  let snapshot = run.publish();
  assert.equal(snapshot.lastRun.counts.turnsAppended, 0);
  assert.equal(snapshot.lastProgressAt, null);
  f.state.transaction(() => run.record({ turnsAppended: 2, bytesCommitted: 200 }, { progress: true }));
  snapshot = run.publish();
  assert.equal(snapshot.lastRun.counts.turnsAppended, 2);
  assert.equal(snapshot.lastRun.counts.bytesCommitted, 200);
  assert.ok(snapshot.lastProgressAt);
  const progress = snapshot.lastProgressAt;
  snapshot = run.publish({ peakRssBytes: 3000 });
  assert.equal(snapshot.lastProgressAt, progress, 'a memory sample is not durable capture progress');
});

test('continuation retains published peak and committed counts without adding sampling transactions', t => {
  const f = fixture(t), first = f.run('continued');
  f.state.transaction(() => first.record({ turnsIndexed: 3 }, { progress: true, peakRssBytes: 1000 }));
  first.publish({ peakRssBytes: 9000 });
  // Peak sampling only writes the status file; the next worker must merge
  // that evidence with the newer committed counters, not overwrite it.
  assert.equal(f.state.get('capture-run', 'current').run.peakRssBytes, 1000);
  f.reopen();
  const next = f.run('continued');
  f.state.transaction(() => next.record({ turnsIndexed: 2 }, { peakRssBytes: 2000 }));
  const snapshot = next.finish({ outcome: 'complete' });
  assert.equal(snapshot.lastRun.peakRssBytes, 9000);
  assert.equal(snapshot.lastRun.counts.turnsIndexed, 5);
  assert.equal(snapshot.lastSuccess.id, 'continued');
  assert.throws(() => next.publish(), /finalized/);
  assert.throws(() => f.run('continued'), /already finished/);
});

test('failed child remains a failed pass despite later committed independent work', t => {
  const f = fixture(t);
  f.run('healthy').finish({ outcome: 'complete' });
  f.run('interrupted');
  f.reopen();
  const next = f.run('interrupted', { previousFailure: 'interrupted' });
  f.state.transaction(() => next.record({ turnsAppended: 1 }, { progress: true }));
  const snapshot = next.finish({ outcome: 'complete' });
  assert.equal(snapshot.lastRun.outcome, 'failed');
  assert.equal(snapshot.lastRun.reason, 'interrupted');
  assert.equal(snapshot.lastFailure.counts.turnsAppended, 1);
  assert.match(snapshot.lastFailure.message, /only durably confirmed unit accounting/);
  assert.match(snapshot.lastFailure.message, /zero turnsAppended does not prove that no append reached disk/);
  assert.equal(snapshot.lastSuccess.id, 'healthy');
  assert.ok(snapshot.lastProgressAt);
});

test('cache loss and unfinished predecessor retain failure evidence without poisoning a new successful pass', t => {
  const f = fixture(t);
  f.run('lost-cache');
  f.state.transaction(() => f.state.delete('capture-run', 'current'));
  f.reopen();
  const resumed = f.run('lost-cache');
  assert.equal(resumed.finish({ outcome: 'complete' }).lastRun.outcome, 'failed');
  const abandoned = f.run('abandoned');
  f.state.transaction(() => abandoned.record({ turnsAppended: 4 }, { progress: true }));
  // These counters were committed but not published before worker death.
  f.reopen();
  const next = f.run('new-pass', { previousFailure: 'interrupted' });
  const snapshot = next.finish({ outcome: 'complete' });
  assert.equal(snapshot.lastRun.outcome, 'complete');
  assert.equal(snapshot.lastRun.counts.turnsAppended, 0);
  assert.equal(snapshot.lastFailure.id, 'abandoned');
  assert.equal(snapshot.lastFailure.counts.turnsAppended, 4);
  assert.equal(snapshot.lastSuccess.id, 'new-pass');
  assert.ok(snapshot.lastProgressAt, 'committed predecessor progress remains visible');
  f.reopen();
  const fresh = f.run('next-pass').publish();
  assert.equal(fresh.lastSuccess.id, 'new-pass', 'finished file wins over its stale running counter row');
  assert.equal(fresh.lastFailure.id, 'abandoned');
});

test('pending or active set-aside work cannot publish success; partial preserves prior history', t => {
  const f = fixture(t);
  f.run('healthy').finish({ outcome: 'complete' });
  const partial = f.run('partial').finish({ outcome: 'partial', reason: 'deadline', pending: true });
  assert.equal(partial.lastSuccess.id, 'healthy');
  assert.equal(partial.lastFailure, null);
  const pending = f.run('pending');
  f.state.transaction(() => pending.record({ inputsPending: 1 }));
  assert.equal(pending.finish({ outcome: 'complete' }).lastRun.outcome, 'partial');
  f.state.transaction(() => f.state.set('set-aside', 'fixture', {
    source: 'cc', path: '/fixture/source', offset: 0, reason: 'captured prefix conflict', line: 1,
  }));
  const snapshot = f.run('set-aside').finish({ outcome: 'complete' });
  assert.equal(snapshot.lastRun.outcome, 'partial');
  assert.equal(snapshot.backlog.setAsideCount, 1);
  assert.equal(snapshot.lastSuccess.id, 'healthy');
});

test('failed final publication leaves running evidence and permits one successful retry', t => {
  const f = fixture(t), run = f.run('write-failure');
  const original = fs.renameSync;
  fs.renameSync = () => { throw Error('injected status publication failure'); };
  syncBuiltinESMExports();
  try { assert.throws(() => run.finish({ outcome: 'complete' }), /publication failure/); }
  finally { fs.renameSync = original; syncBuiltinESMExports(); }
  assert.equal(readCaptureStatus(f.root).lastRun.outcome, 'running');
  assert.equal(readCaptureStatus(f.root).lastSuccess, null);
  let renames = 0;
  fs.renameSync = (...args) => { renames++; return original(...args); };
  syncBuiltinESMExports();
  try { assert.equal(run.finish({ outcome: 'complete' }).lastRun.outcome, 'complete'); }
  finally { fs.renameSync = original; syncBuiltinESMExports(); }
  assert.equal(renames, 1, 'finalization publishes once without an extra running snapshot');
});
