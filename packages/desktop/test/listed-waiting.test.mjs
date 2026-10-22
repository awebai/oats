// The slow schedule of the listed deployments' needs-input reads (packages/client/listed-waiting.mjs): one
// read in flight, each path at most once per interval (60 s focused, the default; 5 min blurred), the
// path most due first, one timer, failures as null, removed paths forgotten, stop for good, and onChange
// only when a value changes. A fake clock and timers, and a fake `read` whose answers the test gives.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createListedWaiting, LISTED_WAITING_FOCUSED_MS, LISTED_WAITING_BLURRED_MS, LISTED_WAITING_MAX_AGE } from '../../client/listed-waiting.mjs';

const flush = () => new Promise((resolve) => setImmediate(resolve));

/** A clock and timers that move only when the test says: `advance(ms)` runs each timer due on the way, in
 * time order, letting the promises it settles run before the next. `armed()` is how many are pending. */
function fakeTime() {
  let t = 0, seq = 0, unrefs = 0;
  const pending = new Map();
  const timers = {
    setTimeout(fn, ms) { const handle = { id: ++seq, unref() { unrefs++; return handle; } }; pending.set(handle, { fn, at: t + ms }); return handle; },
    clearTimeout(handle) { pending.delete(handle); },
  };
  async function advance(ms) {
    const end = t + ms;
    await flush();
    for (;;) {
      const next = [...pending].filter(([, p]) => p.at <= end).sort((x, y) => x[1].at - y[1].at)[0];
      if (!next) break;
      t = next[1].at; pending.delete(next[0]); next[1].fn();
      await flush();
    }
    t = end;
    await flush();
  }
  return { timers, now: () => t, advance, armed: () => pending.size, unrefs: () => unrefs };
}

/** A `read` whose every call waits for the test: `calls[i].answer(value)` / `.fail(error)`. */
function fakeReads() {
  const calls = [];
  const read = (path, options) => new Promise((resolve, reject) => calls.push({ path, options, answer: resolve, fail: reject }));
  return { calls, read, paths: () => calls.map((c) => c.path) };
}

function setup(over = {}) {
  const time = fakeTime(), reads = fakeReads();
  let changes = 0;
  const listed = createListedWaiting({ read: reads.read, timers: time.timers, now: time.now, onChange: () => { changes++; }, ...over });
  return { time, reads, listed, changes: () => changes };
}
const YES = { ok: true, workspace: null, waiting: true }, NO = { ok: true, workspace: null, waiting: false };

test('the bounds as exported: 60 s focused, 5 min blurred, --max-age 300 on every read', () => {
  assert.deepEqual([LISTED_WAITING_FOCUSED_MS, LISTED_WAITING_BLURRED_MS, LISTED_WAITING_MAX_AGE], [60_000, 300_000, 300]);
});

test('one read in flight at a time, in the set\'s order; one timer, unref\'d; asking never reads', async () => {
  const { time, reads, listed } = setup();
  listed.setPaths(['/a', '/b', '/c']);
  assert.equal(time.armed(), 1, 'one timer for the next due time');
  assert.ok(time.unrefs() >= 1, 'the timer keeps no process alive');
  await time.advance(0);
  assert.deepEqual(reads.paths(), ['/a']);
  assert.deepEqual(reads.calls[0].options, { maxAge: 300 });
  assert.equal(time.armed(), 0, 'no timer while a read is in flight');
  await time.advance(10_000);
  assert.deepEqual(reads.paths(), ['/a'], 'the others wait for it, however long it takes');
  for (let i = 0; i < 5; i++) { listed.waiting('/b'); listed.snapshot(); listed.waiting('/nope'); }
  assert.deepEqual(reads.paths(), ['/a'], 'a caller\'s ask starts no read');
  reads.calls[0].answer(NO); await time.advance(0);
  assert.deepEqual(reads.paths(), ['/a', '/b']);
  reads.calls[1].answer(YES); await time.advance(0);
  reads.calls[2].answer(NO); await time.advance(0);
  assert.deepEqual(reads.paths(), ['/a', '/b', '/c']);
  assert.equal(time.armed(), 1, 'all read: one timer, for the next interval');
  assert.deepEqual([...listed.snapshot()], [['/a', false], ['/b', true], ['/c', false]]);
});

test('focused by default: each path again after 60 s from its last read\'s start, not before', async () => {
  const { time, reads, listed } = setup();
  listed.setPaths(['/a']);
  await time.advance(0); reads.calls[0].answer(NO);
  await time.advance(LISTED_WAITING_FOCUSED_MS - 1);
  assert.equal(reads.calls.length, 1, 'not before its interval');
  await time.advance(1);
  assert.equal(reads.calls.length, 2, 'at its interval');
  // A slow read: the interval still counts from the start, and nothing else is read meanwhile.
  await time.advance(20_000); reads.calls[1].answer(NO);
  await time.advance(LISTED_WAITING_FOCUSED_MS - 20_001);
  assert.equal(reads.calls.length, 2);
  await time.advance(1);
  assert.equal(reads.calls.length, 3);
});

test('blurred: every 5 min; the switch moves the armed timer, and focus again makes the 60 s apply from now', async () => {
  const { time, reads, listed } = setup();
  listed.setPaths(['/a']);
  await time.advance(0); reads.calls[0].answer(NO); await time.advance(0);
  listed.setFocused(false);
  assert.equal(time.armed(), 1, 'still one timer');
  await time.advance(LISTED_WAITING_FOCUSED_MS);
  assert.equal(reads.calls.length, 1, 'blurred: 60 s is not enough');
  await time.advance(LISTED_WAITING_BLURRED_MS - LISTED_WAITING_FOCUSED_MS - 1);
  assert.equal(reads.calls.length, 1);
  await time.advance(1);
  assert.equal(reads.calls.length, 2, 'at 5 min');
  reads.calls[1].answer(NO); await time.advance(0);
  listed.setFocused(false);
  assert.equal(time.armed(), 1, 'the same focus again changes nothing');
  // 2 min into the blurred wait, focus comes back: read more than 60 s ago, so due at once.
  await time.advance(120_000);
  assert.equal(reads.calls.length, 2);
  listed.setFocused(true);
  await time.advance(0);
  assert.equal(reads.calls.length, 3, 'due at once');
  reads.calls[2].answer(NO); await time.advance(0);
  // Read 30 s ago when focus comes back: due 60 s after that read, not at once.
  listed.setFocused(false); await time.advance(30_000); listed.setFocused(true);
  await time.advance(29_999);
  assert.equal(reads.calls.length, 3);
  await time.advance(1);
  assert.equal(reads.calls.length, 4);
});

test('the path most due first: never read before read, then the oldest read', async () => {
  const { time, reads, listed } = setup();
  listed.setPaths(['/a', '/b']);
  await time.advance(0); // /a begins at 0
  await time.advance(10_000); reads.calls[0].answer(NO); await time.advance(0); // /b begins at 10 s
  reads.calls[1].answer(NO);
  await time.advance(50_000); // 60 s: /a is due first, the older read
  assert.deepEqual(reads.paths(), ['/a', '/b', '/a']);
  await time.advance(40_000); // 100 s: /b is due too, and a new path arrives meanwhile
  listed.setPaths(['/a', '/b', '/c']);
  await time.advance(100_000); // 200 s: /a's read ends
  assert.deepEqual(reads.paths(), ['/a', '/b', '/a'], 'still one in flight');
  reads.calls[2].answer(NO); await time.advance(0);
  assert.deepEqual(reads.paths(), ['/a', '/b', '/a', '/c'], 'never read, before /b (read at 10 s)');
  reads.calls[3].answer(NO); await time.advance(0);
  assert.deepEqual(reads.paths(), ['/a', '/b', '/a', '/c', '/b'], 'then the oldest read');
  reads.calls[4].answer(NO); await time.advance(0);
  assert.deepEqual(reads.paths().slice(5), ['/a'], '/a (read at 60 s) is overdue at 200 s; /c (read at 200 s) is not');
});

test('a failed read is null: a rejection, a throw, `{ ok: false }`, or no boolean `waiting`; no retry before the interval', async () => {
  const thrown = [];
  const time = fakeTime();
  let changes = 0, call = 0;
  const answers = [() => Promise.resolve(YES), () => Promise.reject(new Error('boom')), () => Promise.resolve(YES),
    () => { throw new Error('sync'); }, () => Promise.resolve(YES), () => Promise.resolve({ ok: false, reason: { code: 'E_CLI_TIMEOUT' } }),
    () => Promise.resolve(YES), () => Promise.resolve({ ok: true, workspace: null, waiting: null }),
    () => Promise.resolve(YES), () => Promise.resolve({ ok: true, waiting: 'yes' }), () => Promise.resolve(YES), () => Promise.resolve(undefined)];
  const listed = createListedWaiting({ read: () => { thrown.push(call); return answers[call++](); }, timers: time.timers, now: time.now, onChange: () => { changes++; } });
  listed.setPaths(['/a']);
  const seen = [];
  for (let i = 0; i < answers.length; i++) {
    await time.advance(i === 0 ? 0 : LISTED_WAITING_FOCUSED_MS);
    seen.push(listed.waiting('/a'));
  }
  assert.deepEqual(seen, [true, null, true, null, true, null, true, null, true, null, true, null]);
  assert.equal(changes, answers.length, 'each answer changed the value');
  assert.equal(thrown.length, answers.length, 'one read per interval, failures included: no retry');
  await time.advance(LISTED_WAITING_FOCUSED_MS - 1);
  assert.equal(thrown.length, answers.length);
});

test('setPaths replaces the set: a removed path loses its value and its late answer is dropped; a new one is due at once', async () => {
  const { time, reads, listed, changes } = setup();
  listed.setPaths(['/a', '/b']);
  await time.advance(0); reads.calls[0].answer(YES); await time.advance(0);
  assert.equal(listed.waiting('/a'), true);
  assert.equal(changes(), 1);
  // /b in flight; both are removed.
  listed.setPaths(['/c']);
  assert.equal(listed.waiting('/a'), null, 'no longer listed: no value');
  assert.deepEqual([...listed.snapshot()], [['/c', null]]);
  assert.equal(changes(), 1, 'setPaths reports nothing: its caller made the change');
  reads.calls[1].answer(YES); await time.advance(0);
  assert.equal(listed.waiting('/b'), null, 'the answer of a removed path is dropped');
  assert.equal(changes(), 1, 'and changes nothing');
  assert.deepEqual(reads.paths(), ['/a', '/b', '/c'], 'the new path next, at once');
  // Removed and given again while its read is in flight: a new path, the old answer dropped, read again at once.
  listed.setPaths(['/c', '/a']); await time.advance(0);
  assert.deepEqual(reads.paths(), ['/a', '/b', '/c'], '/c is in flight');
  listed.setPaths(['/a']); listed.setPaths(['/a', '/c']);
  reads.calls[2].answer(YES); await time.advance(0);
  assert.equal(listed.waiting('/c'), null, 'the answer for the earlier /c is dropped');
  assert.deepEqual(reads.paths().slice(3), ['/a'], 'never read: /a first (its value was dropped with it), in the set\'s order');
  reads.calls[3].answer(NO); await time.advance(0);
  assert.deepEqual(reads.paths().slice(4), ['/c']);
  // The same set again keeps every value and reads nothing early; an empty set arms no timer.
  reads.calls[4].answer(YES); await time.advance(0);
  listed.setPaths(['/a', '/c', '/a', 7, null]);
  assert.deepEqual([...listed.snapshot()], [['/a', false], ['/c', true]], 'each path once, strings only');
  await time.advance(1000);
  assert.equal(reads.calls.length, 5);
  listed.setPaths([]);
  assert.equal(time.armed(), 0);
  assert.deepEqual([...listed.snapshot()], []);
});

test('onChange only when a value changes, never for a read that changed nothing', async () => {
  const { time, reads, listed, changes } = setup();
  listed.setPaths(['/a']);
  await time.advance(0); reads.calls[0].answer(NO); await time.advance(0);
  assert.equal(changes(), 1, 'null to false is a change');
  await time.advance(LISTED_WAITING_FOCUSED_MS); reads.calls[1].answer(NO); await time.advance(0);
  assert.equal(changes(), 1, 'false again: none');
  await time.advance(LISTED_WAITING_FOCUSED_MS); reads.calls[2].answer(YES); await time.advance(0);
  assert.equal(changes(), 2);
  assert.equal(listed.waiting('/a'), true);
  await time.advance(LISTED_WAITING_FOCUSED_MS); reads.calls[3].answer(YES); await time.advance(0);
  assert.equal(changes(), 2);
});

test('stop: the timer cleared, nothing more read or reported, a late answer dropped', async () => {
  const { time, reads, listed, changes } = setup();
  listed.setPaths(['/a', '/b']);
  await time.advance(0); reads.calls[0].answer(YES); await time.advance(0);
  assert.equal(changes(), 1);
  listed.stop();
  assert.equal(time.armed(), 0);
  reads.calls[1].answer(YES); await time.advance(0);
  assert.equal(changes(), 1, 'the answer after stop is not reported');
  assert.equal(listed.waiting('/b'), null, 'nor kept');
  listed.setPaths(['/a', '/b', '/c']); listed.setFocused(false); listed.setFocused(true);
  await time.advance(LISTED_WAITING_BLURRED_MS * 2);
  assert.equal(reads.calls.length, 2, 'nothing more is read');
  assert.equal(time.armed(), 0);
  assert.equal(listed.waiting('/a'), true, 'what was answered before stays readable');
});
