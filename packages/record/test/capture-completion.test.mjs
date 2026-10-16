// Transaction/metadata fixtures. Supervised receipt/death coverage lives in
// capture-work-session.test.mjs; neither file qualifies real managers/storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RecordStore } from '../lib/store.mjs';
import { RecordIndex } from '../lib/index-db.mjs';
import { DerivedState } from '../lib/derived-state.mjs';
import { CaptureSourceQueue } from '../lib/capture-source-queue.mjs';
import { CaptureIndexInventory } from '../lib/capture-index-inventory.mjs';
import { CaptureIndexOutcomes } from '../lib/capture-index-outcomes.mjs';
import { CaptureRun } from '../lib/capture-run.mjs';
import { CaptureBudget } from '../lib/capture-budget.mjs';
import { auditCaptureCompletion } from '../lib/capture-completion.mjs';
import { finishTurn } from '../lib/canonical.mjs';

const turn = n => finishTurn({ v: 1, ts: '2026-01-01T00:00:00Z', from: 'fixture', kind: 'mail',
  body: { text: `message ${n}` }, provenance: { source: 'aw', fidelity: 'projected' } });
function fixture(t, count = 0) {
  const root = fs.mkdtempSync(join(tmpdir(), 'capture-completion-'));
  const store = new RecordStore(root, { owner: 'fixture' });
  for (let n = 0; n < count; n++) store.append(`fixture~s${String(n).padStart(4, '0')}`, turn(n));
  const state = new DerivedState(root), index = new RecordIndex(store);
  const queue = new CaptureSourceQueue(state, { owner: 'fixture', selection: 'fixture' });
  queue.add([], null, { complete: true });
  const inventory = new CaptureIndexInventory(state, { id: 'scope' }), outcomes = new CaptureIndexOutcomes(index, inventory);
  const run = new CaptureRun(root, state, { id: 'run' });
  const start = { workerNonce: 'fixture', pass: { runId: run.id, finalize: false }, budget: new CaptureBudget() };
  const session = { state, index, queue, inventory, outcomes, run, start };
  t.after(() => { inventory.close(); index.close(); state.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const process = () => {
    for (let n = 0; n < 50; n++) if (!outcomes.advance(run, start).selected) return;
    assert.fail('fixture indexing did not drain');
  };
  for (let n = 0; n < 50; n++) {
    if (inventory.discover(index).complete) break;
    assert.ok(n < 49, 'fixture inventory did not drain');
  }
  process();
  return { ...session, root, store, process, audit: options => auditCaptureCompletion(session, options) };
}

test('fresh audit covers every outcome page without manufacturing committed counts or progress', t => {
  const f = fixture(t, 260), work = {}, before = f.run.current();
  const sql = [], captureExec = f.state.db.exec.bind(f.state.db), indexExec = f.index.db.exec.bind(f.index.db);
  f.state.db.exec = statement => { sql.push(['capture', statement]); return captureExec(statement); };
  f.index.db.exec = statement => { sql.push(['index', statement]); return indexExec(statement); };
  const result = f.audit({ limit: 16, work });
  assert.deepEqual(sql, [['capture', 'BEGIN IMMEDIATE'], ['index', 'BEGIN IMMEDIATE'], ['index', 'ROLLBACK'], ['capture', 'COMMIT']]);
  f.state.db.exec = captureExec; f.index.db.exec = indexExec;
  assert.equal(result.complete, true); assert.equal(result.pending, false); assert.equal(result.sourceTerminal, true);
  assert.equal(work.outcomeRows, 260); assert.equal(work.indexNames, 260); assert.equal(work.directoryEntries, 260);
  assert.deepEqual(f.run.current(), before);
  assert.deepEqual(f.state.get('capture-sweep-retirement', 'fixture'), { runId: 'run', sourceScope: f.queue.current().id, indexScope: 'scope' });
  assert.equal(f.queue.current().finished, false, 'an audit intent cannot itself retire the source sweep');
  const reopened = new CaptureSourceQueue(f.state, { owner: 'fixture', selection: 'fixture' });
  assert.equal(reopened.current().id, f.queue.current().id, 'no published final receipt exists');
});

test('all admission, retry, cleanup and issue families prevent success without being erased', t => {
  const f = fixture(t);
  const blockers = [ ['capture-admission', 'active'], ['capture-cleanup', 'active'], ['capture-index-reset', 'current'],
    ['capture-discovery-attempt', 'fixture'], ['capture-retry', 'fixture~later'], ['capture-cleanup-retry', 'allocation'],
    ['recovery-allocation', 'input'], ['recovery-stage', 'input'], ['source-queue-garbage', 'old-source'],
    ['index-inventory-garbage', 'old-index'], ['set-aside', 'input'], ['capture-failed', 'fixture~later'] ];
  for (const [kind, key] of blockers) {
    const sentinel = { preserved: kind }; f.state.transaction(() => f.state.set(kind, key, sentinel));
    const result = f.audit();
    assert.equal(result.complete, false, kind); assert.equal(result.pending, true, kind);
    assert.deepEqual(f.state.get(kind, key), sentinel, kind);
    f.state.transaction(() => f.state.delete(kind, key));
  }
  assert.equal(f.audit().complete, true);
  assert.equal(f.run.current().run.counts.turnsAppended, 0); assert.equal(f.run.current().run.counts.turnsIndexed, 0);
});

test('source discovery and each non-success source outcome remain pending', t => {
  const f = fixture(t);
  const row = f.queue.current();
  f.state.transaction(() => f.state.set('source-sweep', 'fixture', { ...row, discovered: false }));
  assert.equal(f.audit().complete, false);
  f.queue.add([{ source: 'aw', path: join(f.root, 'source.jsonl'), stream: 'fixture~aw' }], null, { complete: true });
  for (const outcome of ['ready', 'pending', 'set-aside', 'failed', 'ignored', 'complete']) {
    f.state.transaction(() => f.queue.mark(1, outcome));
    const result = f.audit();
    assert.equal(result.complete, ['ignored', 'complete'].includes(outcome), outcome);
    assert.equal(result.sourceTerminal, outcome !== 'ready', outcome);
  }
});

test('late live and deleted-journal indexed names enter pending membership before completion', t => {
  const f = fixture(t, 1), counts = f.run.current().run.counts;
  f.store.append('fixture~a-late', turn(20));
  let result = f.audit({ limit: 1 });
  assert.equal(result.complete, false); assert.equal(result.needsWork, true);
  assert.equal(f.state.get('capture-sweep-retirement', 'fixture'), null);
  assert.equal(f.state.db.prepare("SELECT phase FROM capture_index_inventory WHERE scope='scope' AND stream='fixture~a-late'").get().phase, 'ready');
  assert.deepEqual(f.run.current().run.counts, counts);
  f.process(); assert.equal(f.audit().complete, true);
  // An indexed name without a live journal is still a union member, not empty.
  f.index.db.prepare('INSERT INTO index_state(stream,indexed_count) VALUES (?,?)').run('fixture~deleted', 1);
  result = f.audit(); assert.equal(result.needsWork, true); assert.equal(result.complete, false);
  assert.equal(f.state.db.prepare("SELECT phase FROM capture_index_inventory WHERE scope='scope' AND stream='fixture~deleted'").get().phase, 'ready');
});

test('growth and cursor loss revoke completion; a stopped audit supplies no reusable earlier-page proof', t => {
  const f = fixture(t, 3), audit = f.outcomes.audit.bind(f.outcomes), sample = f.start.budget.sample.bind(f.start.budget);
  let stop = false;
  f.outcomes.audit = options => { const result = audit(options); stop = true; return result; };
  f.start.budget.sample = () => stop ? 'deadline' : sample();
  const partial = f.audit({ limit: 1 });
  assert.equal(partial.stopped, true); assert.equal(partial.complete, false);
  assert.equal(f.state.get('capture-sweep-retirement', 'fixture'), null);
  f.outcomes.audit = audit; f.start.budget.sample = sample;
  f.store.append('fixture~s0000', turn(99));
  const work = {}; assert.equal(f.audit({ limit: 1, work }).complete, false); assert.equal(work.outcomeRows, 3);
  f.process(); assert.equal(f.audit().complete, true);
  f.index.db.prepare('DELETE FROM index_bytes WHERE stream=?').run('fixture~s0000');
  assert.equal(f.audit().complete, false);
  assert.equal(f.store.readStream('fixture~s0000').length, 2);
});

test('retirement publication rollback releases both databases and keeps the source scope unfinished', t => {
  const f = fixture(t, 1), before = f.run.current(), set = f.state.set.bind(f.state);
  f.state.set = (kind, key, value) => { set(kind, key, value); if (kind === 'capture-sweep-retirement') throw Error('injected retirement rollback'); };
  assert.throws(() => f.audit(), /injected retirement rollback/);
  assert.equal(f.state.depth, 0); assert.equal(f.state.get('capture-sweep-retirement', 'fixture'), null);
  assert.equal(f.queue.current().finished, false); assert.deepEqual(f.run.current(), before);
  f.state.set = set;
  f.store.append('fixture~s0000', turn(9)); f.process();
  assert.equal(f.audit().complete, true);
});
