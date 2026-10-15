// Transaction/reopen fixtures model worker identities. Actual supervised death
// and full command/manager qualification remain separate execution gates.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RecordStore } from '../lib/store.mjs';
import { RecordIndex } from '../lib/index-db.mjs';
import { DerivedState } from '../lib/derived-state.mjs';
import { CaptureIndexInventory } from '../lib/capture-index-inventory.mjs';
import { CaptureIndexOutcomes } from '../lib/capture-index-outcomes.mjs';
import { CaptureIndexReset } from '../lib/capture-index-reset.mjs';
import { CaptureRun } from '../lib/capture-run.mjs';
import { CaptureBudget } from '../lib/capture-budget.mjs';
import { commitCaptureAdmission } from '../lib/capture-admission.mjs';
import { finishTurn } from '../lib/canonical.mjs';

const now = Date.parse('2026-01-01T00:00:00.000Z'), due = now + 30 * 60 * 1000;
const turn = n => finishTurn({ v: 1, ts: '2026-01-01T00:00:00Z', from: 'fixture', kind: 'mail',
  body: { text: `message ${n}` }, provenance: { source: 'aw', fidelity: 'projected' } });
const start = (workerNonce, runId = 'pass', extra = {}) => ({ workerNonce,
  pass: { runId, reset: false, finalize: false, ...extra }, budget: new CaptureBudget() });
const schema = db => db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY name').all();
const indexed = db => db.prepare('SELECT * FROM turns ORDER BY id').all();

function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'capture-index-reset-'));
  const store = new RecordStore(root, { owner: 'fixture' });
  let state = new DerivedState(root), index = new RecordIndex(store), inventory, outcomes, reset;
  const openScope = id => {
    inventory = new CaptureIndexInventory(state, { id });
    outcomes = new CaptureIndexOutcomes(index, inventory); reset = new CaptureIndexReset(index, inventory);
  };
  t.after(() => { inventory.close(); index.close(); state.close(); fs.rmSync(root, { recursive: true, force: true }); });
  openScope('original');
  store.append('fixture~a', turn(1)); store.append('fixture~b', turn(2));
  for (let n = 0; n < 5; n++) if (inventory.discover(index).complete) break;
  assert.equal(inventory.current().phase, 'complete');
  const run = new CaptureRun(root, state, { id: 'pass' });
  assert.equal(outcomes.advance(run, start('detect')).turnsIndexed, 2);
  index.db.exec("UPDATE index_state SET indexed_count=99 WHERE stream='fixture~a'");
  assert.equal(outcomes.advance(run, start('detect')).resetRequired, true);
  run.publish({ pending: true });
  return { store, root, run, get state() { return state; }, get index() { return index; },
    get inventory() { return inventory; }, get outcomes() { return outcomes; }, get reset() { return reset; },
    reopen() { const id = state.get('index-inventory', 'current').id;
      inventory.close(); index.close(); state.close(); state = new DerivedState(root); index = new RecordIndex(store); openScope(id); },
    nextRun(id = 'pass', options = {}) { return new CaptureRun(root, state, { id, ...options }); },
  };
}

test('reset request requires a distinct fresh reset worker and publishes only a pending union sweep', t => {
  const f = fixture(t), definitions = schema(f.index.db), bytes = fs.readFileSync(f.store.journalPath('fixture~a'));
  const request = f.reset.request(start('detect')), before = indexed(f.index.db);
  assert.deepEqual(f.reset.request(start('later')), request, 'request identity cannot be renewed on reopen');
  for (const candidate of [start('detect', 'pass', { reset: true }), start('normal'),
    start('finalizer', 'pass', { reset: true, finalize: true })]) {
    assert.deepEqual(f.reset.advance(f.run, candidate, { now }), { reset: false, needsFreshWorker: true });
    assert.deepEqual(indexed(f.index.db), before);
  }
  const sentinel = { stream: 'fixture~b', stage: 'index', unitId: 'old', attemptedRun: 'old-run',
    generation: null, offset: 0, nextRetryAt: new Date(due).toISOString() };
  f.state.transaction(() => { f.state.set('capture-retry', 'fixture~b', sentinel); f.state.set('source', 'sentinel', { position: 42 }); });
  const result = f.reset.advance(f.run, start('reset', 'pass', { reset: true }), { now });
  assert.deepEqual(result, { reset: true, recovered: false, scope: request.nextScope });
  assert.deepEqual(indexed(f.index.db), []); assert.deepEqual(schema(f.index.db), definitions);
  assert.equal(f.index.recordOwner(), 'fixture');
  assert.equal(f.index.db.prepare('PRAGMA user_version').get().user_version, 1);
  assert.deepEqual(fs.readFileSync(f.store.journalPath('fixture~a')), bytes);
  assert.deepEqual(f.state.get('capture-retry', 'fixture~b'), sentinel);
  assert.deepEqual(f.state.get('source', 'sentinel'), { position: 42 });
  assert.equal(f.state.get('index-inventory-garbage', 'original'), true);
  assert.equal(f.state.get('capture-index-reset', 'current'), null);
  assert.throws(() => f.outcomes.audit(), /inventory changed/);
  const status = f.run.publish({ pending: true });
  assert.equal(status.lastRun.outcome, 'running'); assert.equal(status.lastSuccess, null);
  assert.equal(status.lastRun.counts.turnsIndexed, 2, 'reset cannot invent indexed counts');
  f.reopen(); assert.equal(f.inventory.current().phase, 'index');
  assert.equal(f.outcomes.audit().discovered, false);
  assert.equal(f.outcomes.audit().checked, 0, 'empty new inventory is not completed discovery');
  assert.deepEqual(f.reset.advance(f.nextRun(), start('idle'), { now }), { reset: false });
});

test('failed reset rolls back its index token, backs off without guessed member failures and never retries in the same pass', t => {
  const f = fixture(t), before = indexed(f.index.db), definitions = schema(f.index.db);
  const request = f.reset.request(start('detect')), exec = f.index.db.exec.bind(f.index.db);
  f.index.db.exec = sql => { if (sql === 'COMMIT') throw Error('injected reset commit'); return exec(sql); };
  assert.throws(() => f.reset.advance(f.run, start('reset', 'pass', { reset: true }), { now }), /injected reset commit/);
  f.index.db.exec = exec;
  assert.deepEqual(indexed(f.index.db), before); assert.deepEqual(schema(f.index.db), definitions);
  assert.equal(f.reset.committed(request), false);
  assert.equal(f.reset.current().attempt.workerNonce, 'reset');
  assert.throws(() => f.reset.reconcile(start('reset'), { now }), /has not been replaced/);
  f.reopen();
  const failure = f.reset.reconcile(start('replacement'), { reason: 'io', now });
  assert.deepEqual(failure, { id: request.id, runId: 'pass', reason: 'io', committed: false });
  assert.equal(f.reset.current().nextRetryAt, new Date(due).toISOString());
  assert.equal(f.reset.current().attempts, 1);
  assert.equal(f.state.db.prepare("SELECT count(*) AS n FROM state WHERE kind IN ('capture-failed','capture-retry')").get().n, 0);
  assert.equal(f.reset.reconcile(start('replacement'), { now }), null, 'no repeated failure accounting');
  const continued = f.nextRun('pass', { currentFailure: { id: 'pass', reason: 'io' } });
  assert.deepEqual(f.reset.advance(continued, start('fresh', 'pass', { reset: true }), { now: due }), { reset: false, deferred: true });
  assert.equal(continued.finish({ outcome: 'partial', pending: true }).lastRun.outcome, 'failed');
  const later = f.nextRun('next');
  assert.deepEqual(f.reset.advance(later, start('later', 'next', { reset: true }), { now: due - 1 }), { reset: false, deferred: true });
  assert.equal(f.reset.advance(later, start('later', 'next', { reset: true }), { now: due }).reset, true);
  assert.deepEqual(indexed(f.index.db), []);
  assert.equal(later.publish({ pending: true }).lastFailure.id, 'pass', 'historical pass failure survives reset');
});

test('committed reset survives sweep-publication rollback; replacement publishes without erasing later index writes', t => {
  const f = fixture(t), request = f.reset.request(start('detect'));
  const restart = f.inventory.restart.bind(f.inventory);
  f.inventory.restart = id => { restart(id); throw Error('injected sweep publication'); };
  assert.throws(() => f.reset.advance(f.run, start('reset', 'pass', { reset: true }), { now }), /injected sweep publication/);
  assert.equal(f.reset.committed(request), true);
  assert.deepEqual(indexed(f.index.db), []);
  assert.equal(f.inventory.current().id, 'original');
  assert.equal(f.state.get('index-inventory-garbage', 'original'), null);
  assert.equal(f.reset.current().attempt.workerNonce, 'reset');
  f.store.append('fixture~a', turn(3)); f.index.update();
  const laterRows = indexed(f.index.db); assert.equal(laterRows.length, 3);
  f.reopen();
  assert.equal(f.reset.reconcile(start('replacement'), { reason: 'io', now }).committed, true);
  const run = f.nextRun('pass', { currentFailure: { id: 'pass', reason: 'io' } });
  // Only bounded metadata recovery is permitted in finalization; the atomic
  // index operation cannot run there. Reject any attempted second reset.
  const exec = f.index.db.exec.bind(f.index.db);
  f.index.db.exec = () => { throw Error('unexpected repeated index mutation'); };
  assert.deepEqual(f.reset.advance(run, start('replacement', 'pass', { finalize: true }), { now }),
    { reset: true, recovered: true, scope: request.nextScope });
  f.index.db.exec = exec;
  assert.deepEqual(indexed(f.index.db), laterRows);
  assert.equal(f.state.get('capture-index-reset', 'current'), null);
  const status = run.finish({ outcome: 'partial', pending: true });
  assert.equal(status.lastRun.outcome, 'failed'); assert.equal(status.lastSuccess, null);
  assert.equal(status.lastRun.counts.turnsIndexed, 2, 'recovery does not reconstruct later index writes');
});

test('reset refuses outstanding stream admissions and cooperatively stopped workers without changing the index', t => {
  const f = fixture(t), before = indexed(f.index.db);
  f.reset.request(start('detect'));
  commitCaptureAdmission(f.state, { runId: 'unfinished', stage: 'index', next: { stage: 'index', after: 'fixture~missing' },
    members: [{ stream: 'fixture~missing', generation: null, offset: 0 }] }, new Set(['fixture~missing']), { now });
  assert.throws(() => f.reset.advance(f.run, start('reset', 'pass', { reset: true }), { now }), /stream admission reconciliation/);
  assert.deepEqual(indexed(f.index.db), before); assert.equal(f.reset.current().attempt, null);
  const stopped = start('reset', 'pass', { reset: true }); stopped.budget = new CaptureBudget({ clock: () => 10, drainAt: 10 });
  assert.throws(() => f.reset.advance(f.run, stopped, { now }), /stopped: deadline/);
  assert.deepEqual(indexed(f.index.db), before); assert.equal(f.reset.current().attempt, null);
});
