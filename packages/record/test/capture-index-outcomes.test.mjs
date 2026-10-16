// Transaction/reopen integration only; these fixtures do not qualify actual
// supervised worker death, manager execution or final command completion.
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
import { CaptureSourceQueue } from '../lib/capture-source-queue.mjs';
import { captureSourceWork } from '../lib/capture-source-work.mjs';
import { CaptureRun } from '../lib/capture-run.mjs';
import { CaptureBudget } from '../lib/capture-budget.mjs';
import { reconcileCaptureInterruption } from '../lib/capture-retry.mjs';
import { finishTurn } from '../lib/canonical.mjs';

const now = Date.parse('2026-01-01T00:00:00.000Z'), due = now + 30 * 60 * 1000;
const turn = n => finishTurn({ v: 1, ts: '2026-01-01T00:00:00Z', from: 'fixture', kind: 'mail',
  body: { text: `message ${n}` }, provenance: { source: 'aw', fidelity: 'projected' } });
const aw = n => JSON.stringify({ ts: '2026-01-01T00:00:00Z', ch: 'mail', dir: 'recv', from: 'peer', body: `message ${n}` }) + '\n';
function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'capture-index-outcomes-'));
  const store = new RecordStore(root, { owner: 'fixture' });
  let state = new DerivedState(root), index = new RecordIndex(store), inventory, outcomes, tick = now;
  t.after(() => { inventory?.close(); index.close(); state.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const openScope = id => { inventory = new CaptureIndexInventory(state, { id }); outcomes = new CaptureIndexOutcomes(index, inventory); };
  return { root, store, get state() { return state; }, get index() { return index; },
    get inventory() { return inventory; }, get outcomes() { return outcomes; },
    scope(id = 'scope') { openScope(id); },
    discover() { for (let n = 0; n < 100; n++) if (inventory.discover(index).complete) return; assert.fail('discovery did not finish'); },
    reopen() { const id = inventory.id; inventory.close(); index.close(); state.close();
      state = new DerivedState(root); index = new RecordIndex(store); openScope(id); },
    run(id, options = {}) { return new CaptureRun(root, state, { id, clock: () => new Date(tick += 1000).toISOString(), ...options }); },
    advance(run, options = {}) { return outcomes.advance(run, { budget: new CaptureBudget() }, { now, ...options }); },
    source(run, queue, options = {}) { return captureSourceWork(store, state, queue, run, { budget: new CaptureBudget() },
      { now, indexInventory: inventory, ...options }); },
    count() { return index.db.prepare('SELECT count(*) AS n FROM turns').get().n; },
    row(stream) { return state.db.prepare('SELECT phase,proof FROM capture_index_inventory WHERE scope=? AND stream=?').get(inventory.id, stream); },
  };
}

test('partial outcomes rotate, survive reopen and skip only still-qualified completions', t => {
  const f = fixture(t), names = ['fixture~a', 'fixture~b', 'fixture~c'];
  names.forEach((stream, i) => f.store.appendBatch(stream, [turn(i * 10), turn(i * 10 + 1), turn(i * 10 + 2)]));
  f.scope(); f.discover(); let run = f.run('continued');
  assert.equal(f.outcomes.audit().discovered, true); assert.equal(f.outcomes.audit().pending, 3);
  for (let round = 0; round < 3; round++) {
    for (const stream of names) {
      const result = f.advance(run, { limit: 1, maxRecords: 1 });
      assert.deepEqual(result.streams, [{ stream, phase: round === 2 ? 'complete' : 'index' }]);
      assert.equal(f.row(stream).phase, round === 2 ? 'complete' : 'index');
    }
    run.publish({ pending: true }); f.reopen(); run = f.run('continued');
  }
  assert.equal(f.count(), 9);
  const first = f.outcomes.audit({ limit: 2 });
  assert.deepEqual({ checked: first.checked, pending: first.pending, complete: first.complete }, { checked: 2, pending: 0, complete: false });
  const last = f.outcomes.audit({ after: first.after, limit: 2 });
  assert.equal(last.checked, 1); assert.equal(last.pending, 0); assert.equal(last.complete, true);
  const progress = run.publish({ pending: true }).lastProgressAt;
  assert.equal(f.advance(run).selected, 0);
  const snapshot = run.publish({ pending: true });
  assert.equal(snapshot.lastProgressAt, progress); assert.equal(snapshot.lastRun.counts.turnsIndexed, 9);
  assert.equal(snapshot.lastRun.outcome, 'running'); assert.equal(snapshot.lastSuccess, null);
});

test('journal growth and an external atomic index reset revoke old completion evidence', t => {
  const f = fixture(t), names = ['fixture~a', 'fixture~b'];
  names.forEach((stream, i) => f.store.append(stream, turn(i)));
  f.scope(); f.discover(); const run = f.run('growth');
  f.advance(run); assert.equal(f.outcomes.audit().pending, 0);
  f.store.append(names[0], turn(10));
  assert.equal(f.row(names[0]).phase, 'complete', 'stored phase alone is not a current completion fact');
  assert.equal(f.outcomes.audit().pending, 1); assert.deepEqual([...f.outcomes.ready()], [names[0]]);
  assert.equal(f.advance(run).turnsIndexed, 1); assert.equal(f.outcomes.audit().pending, 0);
  f.index.reset();
  assert.equal(f.outcomes.audit().pending, 2);
  assert.equal(f.advance(run).turnsIndexed, 3); assert.equal(f.count(), 3);
  assert.equal(f.outcomes.audit().pending, 0);
});

test('reset-required outcome survives reopen and cannot be consumed as completion or reset permission', t => {
  const f = fixture(t), stream = 'fixture~a'; f.store.appendBatch(stream, [turn(1), turn(2)]);
  f.scope(); f.discover(); let run = f.run('reset'); f.advance(run);
  f.index.db.prepare('UPDATE index_state SET indexed_count=indexed_count+1 WHERE stream=?').run(stream);
  assert.equal(f.outcomes.audit().pending, 1);
  assert.equal(f.advance(run).resetRequired, true);
  assert.equal(f.row(stream).phase, 'reset'); assert.equal(f.row(stream).proof, null);
  const counts = run.publish({ pending: true }).lastRun.counts;
  f.reopen(); run = f.run('reset');
  const reset = f.index.reset.bind(f.index);
  f.index.reset = () => { assert.fail('outcome scheduling has no reset authority'); };
  assert.deepEqual(f.advance(run), { selected: 0, resetRequired: true });
  assert.equal(f.outcomes.audit().resetRequired, true); assert.equal(f.outcomes.audit().pending, 1);
  assert.equal(f.state.get('capture-admission', 'active'), null);
  assert.deepEqual(run.publish({ pending: true }).lastRun.counts, counts);
  // Stand-in for the future separately admitted reset and fresh sweep.
  reset(); f.scope('after-reset'); f.discover();
  assert.equal(f.outcomes.resetRequired(), false); assert.equal(f.outcomes.audit().pending, 1);
  f.advance(run); assert.equal(f.outcomes.audit().pending, 0); assert.equal(f.count(), 2);
});

test('outcome publication failure rolls marks and accounting back while committed index rows survive', t => {
  const f = fixture(t), stream = 'fixture~a'; f.store.appendBatch(stream, [turn(1), turn(2)]);
  f.scope(); f.discover(); let run = f.run('failed');
  const record = f.outcomes.record.bind(f.outcomes);
  f.outcomes.record = result => { record(result); throw Error('outcome commit fault'); };
  assert.throws(() => f.advance(run), /outcome commit fault/);
  assert.equal(f.count(), 2); assert.equal(f.row(stream).phase, 'ready'); assert.equal(f.row(stream).proof, null);
  assert.equal(f.state.get('capture-run', 'current').run.counts.turnsIndexed, 0);
  assert.equal(f.state.get('capture-admission', 'active').members[0].stream, stream);
  f.reopen(); reconcileCaptureInterruption(f.state, { reason: 'io', now }); run = f.run('later');
  assert.equal(f.outcomes.audit().pending, 1);
  const result = f.advance(run, { now: due });
  assert.equal(result.selected, 1); assert.equal(result.turnsIndexed, 0);
  assert.equal(f.row(stream).phase, 'complete'); assert.equal(f.state.get('capture-retry', stream), null);
  assert.equal(f.outcomes.audit().pending, 0); assert.equal(run.publish({ pending: true }).lastRun.counts.turnsIndexed, 0);
});

test('source commits register new streams after enumeration and invalidate stale outcomes on growth', t => {
  const f = fixture(t), path = join(f.root, 'comm.jsonl'), stream = 'fixture~aw';
  f.scope(); f.discover(); assert.equal(f.outcomes.audit().checked, 0);
  fs.writeFileSync(path, aw(1));
  let queue = new CaptureSourceQueue(f.state, { owner: 'fixture', selection: 'first' });
  queue.add([{ source: 'aw', path, stream }], null, { complete: true });
  const run = f.run('source');
  assert.equal(f.source(run, queue).results[0].appended, 1);
  assert.equal(f.inventory.current().phase, 'complete'); assert.equal(f.row(stream).phase, 'ready');
  assert.equal(f.outcomes.audit().pending, 1);
  f.advance(run); assert.equal(f.outcomes.audit().pending, 0);
  fs.appendFileSync(path, aw(2));
  queue = new CaptureSourceQueue(f.state, { owner: 'fixture', selection: 'growth' });
  queue.add([{ source: 'aw', path, stream }], null, { complete: true });
  assert.equal(f.source(run, queue).results[0].appended, 1);
  assert.equal(f.row(stream).phase, 'complete'); assert.equal(f.outcomes.audit().pending, 1);
  assert.equal(f.advance(run).turnsIndexed, 1); assert.equal(f.count(), 2);
  assert.equal(f.outcomes.audit().pending, 0); assert.equal(run.publish({ pending: true }).lastRun.counts.turnsAppended, 2);
});

test('a stream verified complete earlier in a pass is indexed again when a later unit of the pass writes it', t => {
  const f = fixture(t), first = join(f.root, 'a.jsonl'), second = join(f.root, 'b.jsonl'), stream = 'fixture~aw';
  f.scope(); f.discover();
  fs.writeFileSync(first, aw(1)); fs.writeFileSync(second, aw(2));
  // Two logs feed one stream, as every AW account does.
  const queue = new CaptureSourceQueue(f.state, { owner: 'fixture', selection: 'fixture' });
  queue.add([{ source: 'aw', path: first, stream }, { source: 'aw', path: second, stream }], null, { complete: true });
  const run = f.run('memo');
  assert.equal(f.source(run, queue, { limit: 1 }).results[0].appended, 1);
  assert.equal(f.advance(run, { memo: true }).turnsIndexed, 1);
  // Verifies the stream complete; a memo would now skip it.
  assert.equal(f.advance(run, { memo: true }).selected, 0);
  assert.equal(f.source(run, queue, { limit: 1 }).results[0].appended, 1);
  assert.equal(f.advance(run, { memo: true }).turnsIndexed, 1, 'the record from the second log is indexed in the same pass');
  assert.equal(f.count(), 2); assert.equal(f.outcomes.audit().pending, 0);
});

test('source registration rollback leaves admission and replay registers surviving journal content without duplicate append counts', t => {
  const f = fixture(t), path = join(f.root, 'comm.jsonl'), stream = 'fixture~aw';
  f.scope(); f.discover(); fs.writeFileSync(path, aw(1));
  let queue = new CaptureSourceQueue(f.state, { owner: 'fixture', selection: 'fixture' });
  queue.add([{ source: 'aw', path, stream }], null, { complete: true });
  let run = f.run('failed-source');
  const include = f.inventory.include.bind(f.inventory);
  f.inventory.include = streams => { include(streams); throw Error('source membership fault'); };
  assert.throws(() => f.source(run, queue), /source membership fault/);
  assert.equal(f.store.readStream(stream).length, 1);
  assert.equal(f.row(stream)?.phase ?? null, null);
  assert.equal(f.state.get('capture-run', 'current').run.counts.turnsAppended, 0);
  assert.equal(f.state.get('capture-admission', 'active').stage, 'capture');
  f.reopen(); reconcileCaptureInterruption(f.state, { reason: 'io', now }); run = f.run('source-retry');
  queue = new CaptureSourceQueue(f.state, { owner: 'fixture', selection: 'fixture' });
  assert.equal(f.source(run, queue, { now: due }).results[0].appended, 0);
  assert.equal(f.row(stream).phase, 'ready'); assert.equal(f.state.get('capture-retry', stream), null);
  f.advance(run, { now: due });
  assert.equal(f.count(), 1); assert.equal(f.store.readStream(stream).length, 1);
  const snapshot = run.publish({ pending: true });
  assert.equal(snapshot.lastRun.counts.turnsAppended, 0); assert.equal(snapshot.lastRun.counts.turnsIndexed, 1);
});

test('older membership-only inventory gains pending outcomes and bounded audit pages without discarding names', t => {
  const f = fixture(t);
  f.state.transaction(() => {
    f.state.db.exec('CREATE TABLE capture_index_inventory(scope TEXT NOT NULL,stream TEXT NOT NULL,PRIMARY KEY(scope,stream))');
    const insert = f.state.db.prepare('INSERT INTO capture_index_inventory VALUES (?,?)');
    for (let i = 0; i < 260; i++) insert.run('old', `fixture~s${String(i).padStart(4, '0')}`);
    f.state.set('index-inventory', 'current', { id: 'old', phase: 'complete', indexAfter: '', liveAfter: '', directory: null });
  });
  f.scope('old');
  let after = '';
  for (const expected of [128, 128, 4]) {
    const page = f.outcomes.audit({ after });
    assert.equal(page.checked, expected); assert.equal(page.pending, expected);
    assert.equal(page.complete, expected < 128); assert.equal(page.discovered, true); after = page.after;
  }
  assert.equal([...f.inventory.ordered()].length, 260);
  assert.throws(() => f.outcomes.record({ streams: [] }), /admitted processing transaction/);
  assert.throws(() => f.inventory.include(['fixture~late']), /bounded processing transaction/);
});
