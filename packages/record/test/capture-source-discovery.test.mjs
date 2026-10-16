import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { DerivedState } from '../lib/derived-state.mjs';
import { CaptureSourceQueue } from '../lib/capture-source-queue.mjs';
import { CaptureSourceDiscovery } from '../lib/capture-source-discovery.mjs';
import { SESSION_FORMATS } from '../lib/formats.mjs';

function fixture(t) {
  const base = fs.mkdtempSync(join(tmpdir(), 'capture-source-discovery-')), root = join(base, 'record');
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return { base, root,
    put(name) { const path = join(base, name); fs.mkdirSync(dirname(path), { recursive: true }); fs.writeFileSync(path, 'unread source bytes\n'); return path; },
    open(roots) { const state = new DerivedState(root), queue = new CaptureSourceQueue(state, { owner: 'fixture', selection: 'fixture' });
      return { state, queue, discovery: new CaptureSourceDiscovery(queue, roots) }; },
  };
}
function close(open) { open.discovery.close(); open.state.close(); }
const rows = state => state.db.prepare('SELECT source,path,stream,outcome FROM capture_sources ORDER BY position').all().map(row => ({ ...row }));
const owned = runId => ({ runId, workerNonce: `worker-${runId}` });

test('format rotation and restart retain public file order within each format and native root precedence', t => {
  const f = fixture(t);
  for (const path of ['cc-a/project/a.jsonl', 'cc-a/project/z.jsonl', 'cc-b/project/a.jsonl',
    'pi/s/a.jsonl', 'codex/y/m/d/a.jsonl', 'aw/z.jsonl', 'aw/A.jsonl', 'aw/a.jsonl', 'aw/ignored.txt']) f.put(path);
  const roots = [{ source: 'cc', path: join(f.base, 'cc-a') }, { source: 'cc', path: join(f.base, 'cc-b') },
    ...['pi', 'codex', 'aw'].map(source => ({ source, path: join(f.base, source) }))];
  const turns = []; let done = false;
  for (let n = 0; n < 50; n++) {
    const opened = f.open(roots);
    const result = opened.discovery.advance({ limit: 1 });
    assert.ok(result.visited <= 1 && result.added <= 1); turns.push(result.source); done = result.complete;
    assert.equal(opened.state.get('capture-run', 'current'), null, 'enumeration never writes processing counters');
    if (done) {
      const found = rows(opened.state);
      for (const source of ['cc', 'pi', 'codex']) {
        const expected = SESSION_FORMATS[source].listFiles(roots.filter(root => root.source === source).map(root => root.path));
        assert.deepEqual(found.filter(row => row.source === source).map(row => row.path), expected);
        for (const row of found.filter(row => row.source === source))
          assert.equal(row.stream, `fixture~${source}.${SESSION_FORMATS[source].sessionId(row.path)}`);
      }
      assert.deepEqual(found.filter(row => row.source === 'aw').map(row => row.path), ['A', 'a', 'z'].map(name => join(f.base, 'aw', name + '.jsonl')));
      assert.ok(found.every(row => row.outcome === 'ready'));
      assert.equal(opened.state.transaction(() => opened.queue.finish()), false, 'enumeration is not source processing completion');
    }
    close(opened); if (done) break;
  }
  assert.equal(done, true); assert.deepEqual(turns.slice(0, 4), ['cc', 'pi', 'codex', 'aw']);
});

test('page insertion and checkpoint rollback together and the same live bridge replays its durable position', t => {
  const f = fixture(t); f.put('cc/a.jsonl'); f.put('cc/b.jsonl');
  const opened = f.open([{ source: 'cc', path: join(f.base, 'cc') }]);
  try {
    opened.discovery.advance({ limit: 1 });
    const before = opened.queue.current(), found = rows(opened.state), set = opened.state.set.bind(opened.state);
    opened.state.set = (kind, key, value) => { set(kind, key, value); if (kind === 'source-sweep') throw Error('injected discovery checkpoint failure'); };
    assert.throws(() => opened.discovery.advance({ limit: 1 }), /injected discovery checkpoint failure/);
    assert.deepEqual(opened.queue.current(), before); assert.deepEqual(rows(opened.state), found);
    assert.equal(opened.discovery.readers.size, 0, 'advanced volatile state is discarded after rollback');
    opened.state.set = set;
    assert.equal(opened.discovery.advance({ limit: 1 }).added, 1);
    while (!opened.discovery.advance({ limit: 1 }).complete) {}
    assert.deepEqual(rows(opened.state).map(row => row.path), [join(f.base, 'cc/a.jsonl'), join(f.base, 'cc/b.jsonl')]);
  } finally { close(opened); }
});

for (const source of ['cc', 'aw']) for (const restart of [false, true])
test(`${source} selected directory replacement refuses page advancement (${restart ? 'reopened' : 'cached'})`, t => {
  const f = fixture(t); f.put(`${source}/a.jsonl`); f.put(`${source}/b.jsonl`);
  const path = join(f.base, source), roots = [{ source, path }]; let opened = f.open(roots);
  try {
    opened.discovery.advance({ limit: 1 }); const before = opened.queue.current(), found = rows(opened.state);
    if (restart) { close(opened); opened = f.open(roots); }
    fs.renameSync(path, path + '.old'); f.put(`${source}/a.jsonl`); f.put(`${source}/c.jsonl`);
    assert.throws(() => opened.discovery.advance({ limit: 1 }), /identity changed/);
    assert.deepEqual(opened.queue.current(), before); assert.deepEqual(rows(opened.state), found);
    assert.equal(opened.discovery.readers.size, 0);
  } finally { close(opened); }
});

test('AW removed anchor resumes by name and an earlier arrival belongs to the next sweep', t => {
  const f = fixture(t); for (const name of ['a', 'b', 'z']) f.put(`aw/${name}.jsonl`);
  const roots = [{ source: 'aw', path: join(f.base, 'aw') }]; let opened = f.open(roots);
  opened.discovery.advance({ limit: 2 }); close(opened);
  fs.unlinkSync(join(f.base, 'aw/b.jsonl')); f.put('aw/0.jsonl'); opened = f.open(roots);
  try {
    assert.equal(opened.discovery.advance({ limit: 2 }).complete, true);
    assert.deepEqual(rows(opened.state).map(row => row.path), ['a', 'b', 'z'].map(name => join(f.base, 'aw', name + '.jsonl')));
    // Model the caller completing visits, not a successful pass receipt.
    opened.state.transaction(() => {
      opened.state.db.exec("UPDATE capture_sources SET outcome='complete'");
      assert.equal(opened.queue.finish(), true);
    });
  } finally { close(opened); }
  opened = f.open(roots);
  try {
    while (!opened.discovery.advance({ limit: 2 }).complete) {}
    const current = opened.state.db.prepare('SELECT path FROM capture_sources WHERE scope=? ORDER BY position').all(opened.queue.current().id);
    assert.deepEqual(current.map(row => row.path), ['0', 'a', 'z'].map(name => join(f.base, 'aw', name + '.jsonl')));
  } finally { close(opened); }
});

test('AW enumeration counts irrelevant names against its bounded page allowance', t => {
  const f = fixture(t);
  for (let n = 0; n < 259; n++) f.put(`aw/${String(n).padStart(3, '0')}.txt`);
  f.put('aw/z.jsonl');
  const opened = f.open([{ source: 'aw', path: join(f.base, 'aw') }]), work = {};
  try {
    for (const count of [128, 128, 4]) {
      const result = opened.discovery.advance({ work });
      assert.equal(result.visited, count); assert.equal(result.added, count === 4 ? 1 : 0);
      assert.equal(result.complete, count === 4);
    }
    assert.equal(work.entriesVisited, 260); assert.equal(work.directoryEntriesRead, 260); assert.equal(work.directoriesRead, 1);
    assert.equal(rows(opened.state).length, 1);
  } finally { close(opened); }
});

test('plan mismatch and stopped discovery cannot advance a queue; absent fresh roots enumerate without success', t => {
  const f = fixture(t); f.put('aw/a.jsonl'); f.put('aw/b.jsonl');
  const roots = [{ source: 'aw', path: join(f.base, 'aw') }], opened = f.open(roots);
  try {
    assert.equal(opened.discovery.advance({ stopped: () => true }).stopped, true);
    assert.equal(opened.queue.current().discovery, null); assert.deepEqual(rows(opened.state), []);
    opened.discovery.advance({ limit: 1 }); const before = opened.queue.current();
    assert.throws(() => new CaptureSourceDiscovery(opened.queue, [{ source: 'aw', path: join(f.base, 'elsewhere') }]), /plan or checkpoint changed/);
    assert.throws(() => new CaptureSourceDiscovery(opened.queue, [{ source: 'pi', path: join(f.base, 'pi'), capturedPi: {} }]), /root plan/);
    fs.rmSync(join(f.base, 'aw'), { recursive: true });
    assert.throws(() => opened.discovery.advance(), /ENOENT/); assert.deepEqual(opened.queue.current(), before);
  } finally { close(opened); }
  const g = fixture(t), empty = g.open([{ source: 'aw', path: join(g.base, 'absent') }]);
  try {
    assert.equal(empty.discovery.advance().complete, true); assert.equal(empty.queue.current().discovered, true);
    assert.equal(empty.state.get('capture-run', 'current'), null); assert.equal(fs.existsSync(join(g.root, 'capture-status.json')), false);
  } finally { close(empty); }
});

test('failed-root publication rolls back on storage failure and partial due recovery retains per-root precedence', t => {
  const f = fixture(t);
  for (const name of ['a', 'b', 'c']) f.put(`aw/${name}.jsonl`);
  f.put('later/z.jsonl');
  const path = join(f.base, 'aw'), opened = f.open([{ source: 'aw', path }, { source: 'aw', path: join(f.base, 'later') }]);
  const now = Date.parse('2026-01-01T00:00:00.000Z');
  try {
    opened.discovery.advance({ limit: 1 });
    const before = opened.queue.current(), set = opened.state.set.bind(opened.state);
    fs.renameSync(path, path + '.saved'); f.put('aw/replacement.jsonl');
    opened.state.set = (kind, key, value) => {
      set(kind, key, value); if (kind === 'capture-discovery-failure') throw Error('injected failure-evidence storage error');
    };
    assert.throws(() => opened.discovery.advance({ ...owned('failed'), now }), /failure-evidence storage error/);
    assert.deepEqual(opened.queue.current(), before);
    assert.equal(opened.state.get('capture-discovery-failure', 'last'), null);
    assert.equal(opened.discovery.readers.size, 0);
    const retained = opened.discovery.active();
    assert.equal(retained.runId, 'failed'); assert.deepEqual(retained.group, before.discovery.groups[3]);
    opened.state.set = set;
    assert.throws(() => opened.discovery.advance({ ...owned('failed'), now }), /unreconciled/);
    assert.throws(() => opened.discovery.reconcile({ workerNonce: 'worker-failed', pass: { runId: 'failed' } }, { now }), /not been replaced/);
    opened.discovery.reconcile({ workerNonce: 'replacement', pass: { runId: 'failed' } }, { now, reason: 'io' });
    assert.equal(opened.discovery.active(), null);
    const refused = opened.queue.current().discovery.groups[3], due = Date.parse(refused.failure.nextRetryAt);
    assert.deepEqual(refused.checkpoint, before.discovery.groups[3].checkpoint);
    assert.equal(opened.discovery.healthyPending(), false, 'later roots cannot bypass a refused root in their format');
    assert.equal(opened.discovery.advance({ ...owned('failed'), now: due, retry: true }).deferred, true);
    assert.equal(opened.discovery.advance({ ...owned('early'), now: due - 1, retry: true }).deferred, true);
    fs.rmSync(path, { recursive: true }); fs.renameSync(path + '.saved', path);
    assert.equal(opened.discovery.advance({ limit: 1, ...owned('recovery'), now: due, retry: true }).added, 1);
    assert.equal(opened.discovery.active(), null);
    const partial = opened.queue.current().discovery.groups[3];
    assert.equal(partial.root, 0); assert.equal(partial.failure.attempts, 1);
    assert.equal(partial.failure.nextRetryAt, refused.failure.nextRetryAt); assert.equal(partial.failure.attemptedRun, 'recovery');
    assert.equal(opened.discovery.advance({ ...owned('recovery'), now: due, retry: true }).deferred, true);
    assert.equal(opened.discovery.advance({ limit: 1, ...owned('next-pass'), now: due, retry: true }).added, 1);
    assert.equal(opened.queue.current().discovery.groups[3].root, 1);
    assert.equal(opened.queue.current().discovery.groups[3].failure, undefined);
    assert.equal(opened.discovery.healthyPending(), true);
    assert.equal(opened.discovery.advance({ ...owned('next-pass'), now: due }).complete, true);
    assert.equal(opened.discovery.active(), null);
    assert.deepEqual(rows(opened.state).map(row => row.path), ['a', 'b', 'c'].map(name => join(path, name + '.jsonl')).concat(join(f.base, 'later/z.jsonl')));
    assert.equal(opened.state.get('capture-discovery-failure', 'last').runId, 'failed', 'recovery retains failure history');
  } finally { close(opened); }
});

test('a root refused before its first checkpoint cannot become an absent optional root on retry', t => {
  const f = fixture(t), path = f.put('not-directory');
  const opened = f.open([{ source: 'aw', path }]), now = Date.parse('2026-01-01T00:00:00.000Z');
  try {
    assert.throws(() => opened.discovery.advance({ ...owned('first'), now }), /identity changed/);
    const failed = opened.queue.current().discovery.groups[3];
    assert.equal(failed.checkpoint, null); assert.equal(failed.failure.attempts, 1);
    fs.unlinkSync(path);
    assert.throws(() => opened.discovery.advance({ ...owned('later'), now: Date.parse(failed.failure.nextRetryAt), retry: true }), /ENOENT/);
    const pending = opened.queue.current();
    assert.equal(pending.discovered, false); assert.equal(pending.discovery.groups[3].root, 0);
    assert.equal(pending.discovery.groups[3].failure.attempts, 2); assert.deepEqual(rows(opened.state), []);
  } finally { close(opened); }
});

test('owned page admission and atomic retirement survive publication rollback and reopen', t => {
  const f = fixture(t); f.put('aw/a.jsonl');
  const roots = [{ source: 'aw', path: join(f.base, 'aw') }], now = Date.parse('2026-01-01T00:00:00.000Z');
  let opened = f.open(roots);
  try {
    const before = opened.queue.current(), set = opened.state.set.bind(opened.state), work = {};
    opened.state.set = (kind, key, value) => {
      set(kind, key, value); if (kind === 'capture-discovery-attempt') throw Error('injected admission rollback');
    };
    assert.throws(() => opened.discovery.advance({ ...owned('old'), now, work }), /admission rollback/);
    assert.equal(opened.discovery.active(), null); assert.deepEqual(work, {});
    assert.equal(opened.discovery.readers.size, 0, 'no reader work precedes admission commit');
    assert.deepEqual(opened.queue.current(), before); assert.deepEqual(rows(opened.state), []);
    opened.state.set = set;
    const remove = opened.state.delete.bind(opened.state);
    opened.state.delete = (kind, key) => {
      remove(kind, key); if (kind === 'capture-discovery-attempt') throw Error('injected retirement rollback');
    };
    assert.throws(() => opened.discovery.advance({ ...owned('old'), now }), /retirement rollback/);
    const attempt = opened.discovery.active();
    assert.equal(attempt.runId, 'old'); assert.equal(attempt.workerNonce, 'worker-old');
    assert.equal(attempt.group.checkpoint, null); assert.equal(attempt.scope, before.id);
    assert.deepEqual(opened.queue.current(), before); assert.deepEqual(rows(opened.state), []);
    close(opened); opened = f.open(roots);
    assert.deepEqual(opened.discovery.active(), attempt);
    opened.discovery.reconcile({ workerNonce: 'new-worker', pass: { runId: 'new-pass' } }, { now });
    const pending = opened.queue.current().discovery.groups[3];
    assert.equal(pending.failure.runId, 'old', 'replacement cannot relabel an older admission as a current-pass failure');
    assert.equal(pending.failure.attemptedRun, 'old'); assert.equal(pending.failure.reason, 'interrupted');
    assert.equal(pending.checkpoint, null); assert.equal(pending.complete, false);
    assert.equal(opened.discovery.active(), null); assert.deepEqual(rows(opened.state), []);
    assert.equal(opened.state.get('capture-run', 'current'), null, 'intent and reconciliation invent no processing counts');
    assert.equal(opened.discovery.advance({ ...owned('new-pass'), now, retry: true }).deferred, true);
  } finally { close(opened); }
});
