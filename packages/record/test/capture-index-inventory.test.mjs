import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RecordStore } from '../lib/store.mjs';
import { RecordIndex } from '../lib/index-db.mjs';
import { DerivedState } from '../lib/derived-state.mjs';
import { CaptureIndexInventory } from '../lib/capture-index-inventory.mjs';
import { captureIndexWork } from '../lib/capture-index-work.mjs';
import { CaptureRun } from '../lib/capture-run.mjs';
import { CaptureBudget } from '../lib/capture-budget.mjs';
import { finishTurn } from '../lib/canonical.mjs';

const turn = n => finishTurn({ v: 1, ts: '2026-01-01T00:00:00Z', from: 'fixture', kind: 'mail',
  body: { text: `message ${n}` }, provenance: { source: 'aw', fidelity: 'projected' } });
function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'capture-index-inventory-'));
  const store = new RecordStore(root, { owner: 'fixture' });
  let state = new DerivedState(root), index = new RecordIndex(store);
  t.after(() => { index.close(); state.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, store, get state() { return state; }, get index() { return index; },
    reopen() { index.close(); state.close(); state = new DerivedState(root); index = new RecordIndex(store); },
    inventory(id) { return new CaptureIndexInventory(state, { id }); },
    discover(inventory, options) {
      for (let n = 0; n < 100; n++) if (inventory.discover(index, options).complete) return;
      assert.fail('fixture discovery did not finish');
    },
    count(id) { return state.db.prepare('SELECT count(*) AS n FROM capture_index_inventory WHERE scope=?').get(id).n; },
    seedIndexed(n) {
      index.db.exec('BEGIN');
      try {
        const insert = index.db.prepare('INSERT INTO index_state VALUES (?,0)');
        for (let i = 0; i < n; i++) insert.run(`fixture~s${String(i).padStart(4, '0')}`);
        index.db.exec('COMMIT');
      } catch (error) { index.db.exec('ROLLBACK'); throw error; }
    },
  };
}

test('union retains disappeared indexed journals and routes their invalidation to reset deferral', t => {
  const f = fixture(t), target = turn(1), streams = ['fixture~a', 'fixture~b'];
  f.store.append(streams[0], target);
  f.store.append(streams[1], finishTurn({ v: 1, ts: '2026-01-02T00:00:00Z', from: 'fixture', kind: 'tombstone',
    links: [{ rel: 'tombstones', ref: target.id }], body: { text: 'hide' } }));
  let run = new CaptureRun(f.root, f.state, { id: 'indexed' });
  captureIndexWork(f.index, f.state, streams, run, { budget: new CaptureBudget() });
  run.finish({ outcome: 'complete' });
  fs.unlinkSync(f.store.journalPath(streams[1]));
  const inventory = f.inventory('union'); f.discover(inventory, { limit: 1 });
  assert.deepEqual([...inventory.ordered()], streams);
  assert.equal(f.count('union'), 2, 'live/index overlap deduplicates without discarding the deleted member');
  run = new CaptureRun(f.root, f.state, { id: 'deleted-journal' });
  const result = captureIndexWork(f.index, f.state, inventory.ordered(), run, { budget: new CaptureBudget() });
  assert.equal(result.resetRequired, true); assert.equal(result.reset, false);
  assert.equal(f.index.db.prepare('SELECT hidden FROM turns WHERE id=?').get(target.id).hidden, 1,
    'inventory and reset detection cannot mutate the old union');
  assert.equal(run.publish({ pending: true }).lastRun.outcome, 'running');
  // Direct reset is fixture setup for the caller's future separately admitted
  // operation; the inventory itself has no reset method or reset permission.
  f.index.reset();
  const restarted = f.inventory('after-reset'); f.discover(restarted, { limit: 1 });
  assert.deepEqual([...restarted.ordered()], [streams[0]]);
  assert.throws(() => [...inventory.ordered()], /inventory changed/);
});

test('indexed discovery pages commit with their position and resume after connection reopen', t => {
  const f = fixture(t); f.seedIndexed(260);
  let inventory = f.inventory('paged');
  const set = f.state.set.bind(f.state);
  f.state.set = (kind, ...args) => {
    if (kind === 'index-inventory') throw Error('checkpoint fault');
    return set(kind, ...args);
  };
  assert.throws(() => inventory.discover(f.index), /checkpoint fault/);
  assert.equal(f.count('paged'), 0); assert.equal(inventory.current().indexAfter, '');
  f.reopen(); inventory = f.inventory('paged');
  for (const [page, expected] of [128, 128, 4].entries()) {
    const result = inventory.discover(f.index);
    assert.equal(result.scanned, expected); assert.equal(result.complete, false);
    assert.equal(f.count('paged'), page === 2 ? 260 : (page + 1) * 128);
    inventory.close(); f.reopen(); inventory = f.inventory('paged');
  }
  assert.equal(inventory.current().phase, 'live');
  assert.equal(inventory.discover(f.index).complete, true, 'missing fresh streams directory is empty');
  const work = {}, iterator = inventory.ordered({ work });
  assert.equal(iterator.next().value, 'fixture~s0000'); iterator.return();
  assert.equal(work.inventoryRows, 128, 'ordered reader fetches one bounded page before yielding');
  assert.equal([...inventory.ordered()].length, 260);
});

test('live discovery counts irrelevant names, resumes beyond a removed anchor and leaves earlier arrivals to another sweep', t => {
  const f = fixture(t);
  for (const [i, stream] of ['fixture~a', 'fixture~b', 'fixture~d'].entries()) f.store.append(stream, turn(i));
  fs.mkdirSync(join(f.store.streamsDir(), '!irrelevant'));
  let inventory = f.inventory('live'), work = {};
  assert.equal(inventory.discover(f.index, { limit: 1 }).scanned, 0);
  assert.deepEqual(inventory.discover(f.index, { limit: 1, work }), { scanned: 1, complete: false });
  assert.equal(f.count('live'), 0);
  inventory.discover(f.index, { limit: 1, work });
  assert.deepEqual([...inventory.ordered()], ['fixture~a']);
  assert.equal(work.directoriesRead, 1, 'same worker retains its sorted metadata array');
  assert.equal(work.entriesVisited, 2);
  fs.rmSync(join(f.store.streamsDir(), 'fixture~a'), { recursive: true });
  f.store.append('fixture~0', turn(10)); f.store.append('fixture~c', turn(11));
  inventory.close(); f.reopen(); inventory = f.inventory('live');
  f.discover(inventory, { limit: 1 });
  assert.deepEqual([...inventory.ordered()], ['fixture~a', 'fixture~b', 'fixture~c', 'fixture~d']);
  const next = f.inventory('next'); f.discover(next, { limit: 1 });
  assert.deepEqual([...next.ordered()], ['fixture~0', 'fixture~b', 'fixture~c', 'fixture~d']);
});

test('replaced selected streams directory refuses checkpoint advancement', t => {
  const f = fixture(t); f.store.append('fixture~a', turn(1)); f.store.append('fixture~b', turn(2));
  let inventory = f.inventory('replace'); inventory.discover(f.index);
  inventory.discover(f.index, { limit: 1 });
  const before = inventory.current(); inventory.close(); f.reopen(); inventory = f.inventory('replace');
  fs.renameSync(f.store.streamsDir(), join(f.root, 'old-streams'));
  fs.mkdirSync(f.store.streamsDir());
  assert.throws(() => inventory.discover(f.index), /inventory directory changed/);
  assert.deepEqual(inventory.current(), before); assert.equal(f.count('replace'), 1);
});

test('durable index admission rotates a finite union without asserting index or pass completion', t => {
  const f = fixture(t), streams = ['fixture~a', 'fixture~b', 'fixture~c'];
  streams.forEach((stream, i) => f.store.append(stream, turn(i)));
  const inventory = f.inventory('rotate'); f.discover(inventory);
  assert.equal(inventory.current().phase, 'complete');
  assert.equal(f.index.db.prepare('SELECT count(*) AS n FROM turns').get().n, 0);
  const run = new CaptureRun(f.root, f.state, { id: 'rotation' });
  for (const stream of streams) {
    const result = captureIndexWork(f.index, f.state, inventory.ordered(), run, { budget: new CaptureBudget() }, { limit: 1 });
    assert.deepEqual(result.streams, [{ stream, phase: 'complete' }]);
  }
  assert.deepEqual([...inventory.ordered()], streams, 'rotation wraps and retains names for later cursor validation');
  const snapshot = run.publish({ pending: true });
  assert.equal(snapshot.lastRun.counts.turnsIndexed, 3); assert.equal(snapshot.lastRun.outcome, 'running');
});

test('lost inventory restarts enumeration only; retired scopes clean in bounded units', t => {
  const f = fixture(t); f.seedIndexed(260);
  let inventory = f.inventory('old'); f.discover(inventory);
  f.state.transaction(() => f.state.set('capture-retry', 'sentinel', { unchanged: true }));
  const indexRows = f.index.db.prepare('SELECT * FROM index_state ORDER BY stream').all();
  f.state.db.exec('DROP TABLE capture_index_inventory');
  inventory = f.inventory('old');
  assert.equal(inventory.current().phase, 'index'); assert.equal(f.count('old'), 0);
  assert.deepEqual(f.state.get('capture-retry', 'sentinel'), { unchanged: true });
  f.discover(inventory);
  const current = f.inventory('current'); f.discover(current);
  assert.throws(() => f.inventory('old'), /identity was retired/);
  for (const expected of [128, 128, 4]) {
    assert.equal(f.state.transaction(() => current.cleanup()), expected);
    assert.equal(f.count('current'), 260);
  }
  assert.equal(f.count('old'), 0);
  assert.equal(f.state.get('index-inventory-garbage', 'old'), null);
  assert.deepEqual(f.index.db.prepare('SELECT * FROM index_state ORDER BY stream').all(), indexRows);
  assert.deepEqual(f.state.get('capture-retry', 'sentinel'), { unchanged: true });
  f.state.transaction(() => f.state.set('index-inventory-garbage', 'current', true));
  assert.throws(() => f.state.transaction(() => current.cleanup()), /active capture index inventory cannot be deleted/);
  assert.equal(f.count('current'), 260);
});
