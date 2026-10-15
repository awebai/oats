// The retires a client started, held as Retiring… before the roster says so (awebai/oats#1247,
// packages/client/retire-in-flight.mjs). A row is held from the send of its retire until the answer is in and a
// roster read begun after that answer was read; an answer that ran nothing lets it go at once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRetiresInFlight, retiringRows } from '../packages/client/retire-in-flight.mjs';
import { heldHome, instanceId } from '../packages/client/instance-tree.mjs';

const home = name => `/agents/dev/instances/${name}`;
const target = (name = 'dev-1', server = null) => ({ instance: name, agent: 'dev', agentsRoot: '/agents', home: home(name), workspace: 'team', server });
const row = (name = 'dev-1', extra = {}) => ({ instance: name, home: home(name), running: true, ...extra });

/** A tracker over a read counter: `read()` begins a roster read and answers its mark. */
function tracked() {
  let reads = 0, changes = 0;
  const retires = createRetiresInFlight({ mark: () => reads, onChange: () => { changes++; } });
  return { retires, read: () => ++reads, changes: () => changes };
}

test('begin holds the row at once: ids, holds, and the rows read Retiring…, over the kernel\'s failed too', () => {
  const t = tracked();
  t.retires.begin(target());
  assert.deepEqual([...t.retires.ids()], [instanceId(target())]); assert.equal(t.changes(), 1);
  assert.equal(t.retires.holds(row()), true); assert.equal(t.retires.holds(row('dev-2')), false);
  assert.equal(t.retires.holds(null), false); assert.equal(t.retires.holds(undefined), false);
  const failed = row('dev-1', { retire: { state: 'failed', since: '2026-10-15T00:00:00Z', self: true, code: 'E_RETIRE_FAILED', message: 'boom' } });
  const rows = [failed, row('dev-2')], marked = retiringRows(rows, t.retires.ids());
  assert.deepEqual(marked[0], { ...failed, retireInFlight: true }); assert.equal(marked[1], rows[1], 'a row not held is passed as it is');
  assert.equal(Object.hasOwn(rows[0], 'retireInFlight'), false, 'the rows given are not changed');
  assert.equal(heldHome(marked[0]).kind, 'retiring'); assert.deepEqual(heldHome(marked[0]).said, { sentence: 'dev-1 is being retired.' });
  assert.equal(heldHome(marked[1]), null);
  // ids() is a copy: changing it holds nothing.
  t.retires.ids().clear(); assert.equal(t.retires.holds(row()), true);
});

test('retiringRows: nothing held is the same rows', () => {
  const rows = [row()];
  for (const ids of [new Set(), undefined, null]) assert.equal(retiringRows(rows, ids), rows, String(ids));
});

test('an answer that ran nothing (refused, stale) lets the row go at once', () => {
  for (const kind of ['refused', 'stale']) {
    const t = tracked(), hold = t.retires.begin(target());
    hold.settle(kind);
    assert.equal(t.retires.holds(row()), false, kind); assert.equal(t.retires.ids().size, 0, kind);
    assert.equal(t.changes(), 2, `${kind}: begin and the release are each a change`);
  }
});

test('any other answer holds the row until a read begun after the answer is read', () => {
  for (const kind of ['complete', 'partial', 'unknown', 'pending', 'invalid']) {
    const t = tracked(), hold = t.retires.begin(target());
    const before = t.read();            // a read begun before the answer
    hold.settle(kind);                  // the answer, at mark `before`
    assert.equal(t.retires.holds(row()), true, `${kind}: held after the answer`); assert.equal(t.changes(), 1, `${kind}: settling to hold is no change`);
    t.retires.landed(before);
    assert.equal(t.retires.holds(row()), true, `${kind}: a read begun before the answer does not let it go`);
    t.retires.landed(before - 1);
    assert.equal(t.retires.holds(row()), true, `${kind}: nor an older one`);
    const after = t.read();
    t.retires.landed(after);
    assert.equal(t.retires.holds(row()), false, `${kind}: the read after the answer lets it go`); assert.equal(t.changes(), 2, kind);
  }
});

test('a read that lands before the answer lets nothing go, however late it began', () => {
  const t = tracked(); t.retires.begin(target());
  t.retires.landed(t.read()); t.retires.landed(1_000);
  assert.equal(t.retires.holds(row()), true); assert.equal(t.changes(), 1, 'a landing that lets nothing go is no change');
});

test('covers restricts a landing to the rows its read covers', () => {
  const t = tracked(), local = target('dev-a'), remote = target('dev-b', 'build');
  const one = t.retires.begin(local), two = t.retires.begin(remote);
  one.settle('complete'); two.settle('complete');
  const at = t.read(), seen = [];
  t.retires.landed(at, covered => { seen.push(covered.instance); return covered.server === null; });
  assert.deepEqual(seen.sort(), ['dev-a', 'dev-b'], 'covers is asked with each settled target');
  assert.equal(t.retires.holds(row('dev-a')), false);
  assert.equal(t.retires.holds({ ...row('dev-b'), server: 'build' }), true, 'the other machine\'s row waits for a read of its own');
  t.retires.landed(at);
  assert.equal(t.retires.ids().size, 0);
});

test('a row is told apart by its machine: a hold on a remote row does not hold the local row of the same home', () => {
  const t = tracked(); t.retires.begin(target('dev-1', 'build'));
  assert.equal(t.retires.holds(row()), false); assert.equal(t.retires.holds({ ...row(), server: 'build' }), true);
  assert.deepEqual(retiringRows([row()], t.retires.ids()), [row()]);
});

test('a second begin for the same row supersedes the first: the first answer is then a no-op', () => {
  const t = tracked(), first = t.retires.begin(target()), second = t.retires.begin(target());
  first.settle('refused');
  assert.equal(t.retires.holds(row()), true, 'the earlier send\'s refusal does not let the newer one go');
  second.settle('complete'); first.settle('stale');
  assert.equal(t.retires.holds(row()), true);
  t.retires.landed(t.read());
  assert.equal(t.retires.holds(row()), false);
  // Once let go, an old answer holds nothing again.
  first.settle('complete'); second.settle('complete');
  assert.equal(t.retires.ids().size, 0);
});

test('an answer settles once: a later settle of the same send changes nothing', () => {
  const t = tracked(), hold = t.retires.begin(target());
  hold.settle('complete'); hold.settle('refused');
  assert.equal(t.retires.holds(row()), true, 'the first answer stands');
});

test('onChange is told each change, and one that throws changes nothing here', () => {
  let calls = 0, reads = 0;
  const retires = createRetiresInFlight({ mark: () => reads, onChange: () => { calls++; throw new Error('drawing failed'); } });
  const a = retires.begin(target('dev-a')), b = retires.begin(target('dev-b'));
  assert.equal(calls, 2);
  a.settle('refused'); assert.equal(calls, 3);
  b.settle('unknown'); assert.equal(calls, 3);
  retires.landed(++reads); assert.equal(calls, 4, 'one change for the landing, whatever it let go');
  assert.equal(retires.ids().size, 0);
  // Without an onChange, nothing is told and nothing fails.
  const quiet = createRetiresInFlight({ mark: () => 0 }); quiet.begin(target()).settle('refused');
  assert.equal(quiet.ids().size, 0);
});

test('a tracker needs the client\'s read mark', () => {
  for (const options of [undefined, {}, { mark: 1 }, { onChange: () => {} }])
    assert.throws(() => createRetiresInFlight(options), { name: 'TypeError', message: /^createRetiresInFlight: a mark/ });
});
