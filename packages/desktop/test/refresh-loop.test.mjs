import test from 'node:test';
import assert from 'node:assert/strict';
import { createRefreshLoop, REFRESH_FOCUSED_MS, REFRESH_BLURRED_MS } from '../server/refresh-loop.mjs';

const flush = () => new Promise(r => setImmediate(r));

/** Fake clock and timers, advanced by hand; every run is a deferred the test completes. */
function harness(options = {}) {
  let clock = 0, seq = 0;
  const timers = new Map(), runs = [];
  const fake = {
    setTimeout(fn, ms) { const handle = { id: ++seq, at: clock + ms, fn, unrefd: false, unref() { this.unrefd = true; } }; timers.set(handle.id, handle); return handle; },
    clearTimeout(handle) { timers.delete(handle?.id); },
  };
  const loop = createRefreshLoop({
    run: ({ live }) => new Promise((resolve, reject) => { runs.push({ live, at: clock, resolve, reject }); }),
    timers: fake, now: () => clock, ...options,
  });
  async function advance(ms) {
    const target = clock + ms;
    for (;;) {
      const due = [...timers.values()].filter(t => t.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      clock = due.at; timers.delete(due.id); due.fn(); await flush();
    }
    clock = target;
  }
  return { loop, runs, advance, flush, pending: () => [...timers.values()].map(t => t.at), tick: ms => { clock += ms; },
    complete: async (i = runs.length - 1) => { runs[i].resolve(); await flush(); } };
}

test('exports the focused and blurred intervals', () => {
  assert.equal(REFRESH_FOCUSED_MS, 5000); assert.equal(REFRESH_BLURRED_MS, 30000);
});

test('start runs once now; the interval is measured from completion, not from the start of the run', async () => {
  const h = harness(); h.loop.start(); await h.flush();
  assert.deepEqual(h.runs.map(r => [r.live, r.at]), [[false, 0]]); assert.equal(h.loop.running(), true);
  h.tick(3000); await h.complete(0);
  assert.equal(h.loop.running(), false); assert.deepEqual(h.pending(), [8000], '5000 after the completion at 3000');
  await h.advance(4999); assert.equal(h.runs.length, 1);
  await h.advance(1); assert.equal(h.runs.length, 2); assert.equal(h.runs[1].at, 8000);
});

test('a run that outlasts the interval is never followed back to back', async () => {
  const h = harness(); h.loop.start(); await h.flush();
  await h.advance(7000); assert.equal(h.runs.length, 1, 'nothing starts while a run is in flight');
  await h.complete(0); assert.deepEqual(h.pending(), [12000]);
  await h.advance(5000); assert.equal(h.runs.length, 2); assert.equal(h.runs[1].at, 12000);
});

test('the timer handle is unref-ed so the loop never keeps the process alive', async () => {
  let handle = null;
  const h = harness({ timers: { setTimeout(fn, ms) { handle = { fn, ms, unrefd: false, unref() { this.unrefd = true; } }; return handle; }, clearTimeout() {} } });
  h.loop.start(); await h.flush(); await h.complete(0);
  assert.equal(handle.ms, 5000); assert.equal(handle.unrefd, true);
});

test('blurred: the next run is blurredMs after completion; blurring with a timer pending re-arms it from the last completion', async () => {
  const h = harness(); h.loop.start(); await h.flush(); h.tick(1000); await h.complete(0);
  assert.deepEqual(h.pending(), [6000]);
  h.tick(2000); h.loop.setFocused(false);
  assert.equal(h.loop.focused(), false); assert.deepEqual(h.pending(), [31000], 'completion at 1000 + 30000');
  assert.equal(h.runs.length, 1, 'blur runs nothing');
  await h.advance(28000); assert.equal(h.runs.length, 2); assert.equal(h.runs[1].at, 31000);
  h.tick(500); await h.complete(1); assert.deepEqual(h.pending(), [61500], 'still blurred: 30000 after completion');
});

test('focus return runs at once when idle (cancelling the pending timer) and queues nothing when a run is in flight', async () => {
  const h = harness(); h.loop.start(); await h.flush(); await h.complete(0);
  h.loop.setFocused(false); assert.deepEqual(h.pending(), [30000]);
  h.tick(10000); h.loop.setFocused(true); await h.flush();
  assert.equal(h.runs.length, 2); assert.equal(h.runs[1].at, 10000); assert.deepEqual(h.pending(), [], 'the blurred timer is gone');
  h.loop.setFocused(false); h.loop.setFocused(true); await h.flush();
  assert.equal(h.runs.length, 2, 'the run in flight is the prompt refresh');
  h.tick(100); await h.complete(1);
  assert.equal(h.runs.length, 2, 'no follow-up was queued by the focus change'); assert.deepEqual(h.pending(), [15100]);
  h.loop.setFocused(true); assert.equal(h.runs.length, 2, 'focused → focused is a no-op');
});

test('request during a run yields exactly one follow-up, live when any requester asked live, and resolves when it completes', async () => {
  const h = harness(); h.loop.start(); await h.flush();
  let done = 0;
  const a = h.loop.request().then(() => { done++; }), b = h.loop.request({ live: true }).then(() => { done++; }), c = h.loop.request().then(() => { done++; });
  await h.flush(); assert.equal(h.runs.length, 1);
  h.tick(200); await h.complete(0);
  assert.equal(h.runs.length, 2, 'one follow-up, not three'); assert.equal(h.runs[1].live, true); assert.equal(h.runs[1].at, 200);
  assert.equal(done, 0, 'requesters wait for the follow-up, not the run they interrupted'); assert.deepEqual(h.pending(), [], 'no timer until the follow-up completes');
  h.tick(300); await h.complete(1); await Promise.all([a, b, c]);
  assert.equal(done, 3); assert.equal(h.runs.length, 2); assert.deepEqual(h.pending(), [5500]);
});

test('request while idle cancels the pending timer, runs now with the requested liveness and resolves on completion', async () => {
  const h = harness(); h.loop.start(); await h.flush(); await h.complete(0); assert.deepEqual(h.pending(), [5000]);
  h.tick(1000); let settled = false;
  const p = h.loop.request({ live: true }).then(() => { settled = true; }); await h.flush();
  assert.deepEqual(h.pending(), []); assert.deepEqual(h.runs.map(r => [r.live, r.at]), [[false, 0], [true, 1000]]);
  assert.equal(settled, false); assert.equal(h.loop.running(), true);
  await h.complete(1); await p; assert.equal(settled, true); assert.deepEqual(h.pending(), [6000]);
  const q = h.loop.request(); await h.flush(); assert.equal(h.runs[2].live, false); await h.complete(2); await q;
});

test('a rejected run does not stop the loop, and its requesters still resolve', async () => {
  const h = harness(); h.loop.start(); await h.flush();
  const p = h.loop.request(); await h.flush();
  h.runs[0].reject(new Error('kernel gone')); await h.flush();
  assert.equal(h.runs.length, 2, 'the follow-up still runs');
  h.runs[1].reject(new Error('still gone')); await p;
  assert.equal(h.loop.running(), false); assert.deepEqual(h.pending(), [5000]);
  await h.advance(5000); assert.equal(h.runs.length, 3);
});

test('stop clears the timer; a run in flight completes without scheduling another', async () => {
  const h = harness(); h.loop.start(); await h.flush(); await h.complete(0); assert.deepEqual(h.pending(), [5000]);
  h.loop.stop(); assert.deepEqual(h.pending(), []);
  await h.advance(60000); assert.equal(h.runs.length, 1);
  const g = harness(); g.loop.start(); await g.flush(); g.loop.stop(); await g.complete(0);
  assert.deepEqual(g.pending(), []); assert.equal(g.loop.running(), false);
  g.loop.setFocused(false); g.loop.setFocused(true); await g.flush(); assert.equal(g.runs.length, 1, 'a stopped loop never runs on focus');
});

test('custom intervals are honoured', async () => {
  const h = harness({ focusedMs: 100, blurredMs: 700 }); h.loop.start(); await h.flush(); await h.complete(0);
  assert.deepEqual(h.pending(), [100]); h.loop.setFocused(false); assert.deepEqual(h.pending(), [700]);
});
