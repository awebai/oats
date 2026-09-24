import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTermLifecycle } from '../renderer/term-lifecycle.mjs';
import { handle, confirmed } from './helpers/terminal-wire.mjs';
import { terminalFailure } from '../renderer/terminal-contract.mjs';
const deferred = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };

test('close before open resolves: original leased PTY detached once, no late setup, UI only after confirmation', async () => {
  const gate = deferred(), closed = [], order = [];
  const life = createTermLifecycle({ open: () => gate.promise, closePty: h => { closed.push(h); order.push('detach'); return confirmed(h); } });
  const starting = life.start(() => assert.fail('late setup'), () => assert.fail('late error'));
  const closing = life.close(() => order.push('dispose'));
  gate.resolve(handle(42)); await starting; assert.equal((await closing).ok, true);
  assert.deepEqual(closed, [handle(42)]); assert.deepEqual(order, ['detach', 'dispose']); assert.equal(life.ptyId(), null);
});

test('close before start completes without acquiring later', async () => {
  let disposed = 0;
  const life = createTermLifecycle({ open: () => assert.fail('closed mount must not acquire'), closePty: assert.fail });
  assert.equal((await life.close(() => disposed++)).ok, true);
  await life.start(assert.fail, assert.fail); assert.equal(disposed, 1);
});

test('late rejection after close never repaints and disposes without detach', async () => {
  const gate = deferred(); let disposed = 0;
  const life = createTermLifecycle({ open: () => gate.promise, closePty: () => assert.fail('no resource') });
  const starting = life.start(() => assert.fail('late setup'), () => assert.fail('late error'));
  const closing = life.close(() => disposed++); gate.reject(new Error('refused')); await starting; await closing;
  assert.equal(disposed, 1);
});

test('live open rejection reports error; numeric open is not a wire compatibility lane', async () => {
  for (const open of [() => Promise.reject(new Error('bad target')), () => Promise.resolve(7)]) {
    let errors = 0;
    const life = createTermLifecycle({ open, closePty: () => assert.fail('no valid resource') });
    await life.start(() => assert.fail('not ready'), () => errors++); assert.equal(errors, 1);
    assert.equal((await life.close()).ok, true);
  }
});

test('normal path closes copied handle exactly once and disposes exactly once', async () => {
  const h = handle(7), calls = []; let disposed = 0;
  const life = createTermLifecycle({ open: async () => h, closePty: original => { calls.push(original); return confirmed(original); } });
  await life.start(ready => assert.deepEqual(ready, h), assert.fail);
  assert.notEqual(life.ptyId(), h); assert.deepEqual(life.ptyId(), h); assert.ok(Object.isFrozen(life.ptyId()));
  await life.close(() => disposed++); await life.close(() => disposed++);
  assert.deepEqual(calls, [h]); assert.equal(disposed, 1);
});

test('matching confirmed exit prevents a double kill; stale handle cannot forget a successor', async () => {
  const h = handle(9), life = createTermLifecycle({ open: async () => h, closePty: () => assert.fail('already exited') });
  await life.start(() => {}, assert.fail); life.forget(handle(8)); assert.deepEqual(life.ptyId(), h);
  life.forget(h); assert.equal((await life.close()).ok, true);
});

test('pending/transport close retains handle and UI; an explicit retry can confirm without repeating disposal', async () => {
  for (const rejection of [false, true]) {
    let attempts = 0, disposed = 0; const errors = [];
    const life = createTermLifecycle({ open: async () => handle(3), closePty: h => {
      if (++attempts === 1) { if (rejection) throw new Error('transport'); return terminalFailure('E_TERM_CLOSE_PENDING'); }
      return confirmed(h);
    } }, e => errors.push(e));
    await life.start(() => {}, assert.fail);
    assert.equal((await life.close(() => disposed++)).code, 'E_TERM_CLOSE_PENDING');
    assert.equal(disposed, 0); assert.deepEqual(life.ptyId(), handle(3));
    assert.equal((await life.close()).ok, true); assert.equal(disposed, 1); assert.equal(attempts, 2);
    assert.equal(errors.length, Number(rejection));
  }
});

test('close-during-pending setup waits for asynchronous ready setup before cleanup/disposal', async () => {
  const setup = deferred(), entered = deferred(), order = [];
  const life = createTermLifecycle({ open: async () => handle(12), closePty: h => { order.push('detach'); return confirmed(h); } });
  const starting = life.start(async () => { order.push('setup'); entered.resolve(); await setup.promise; order.push('setup done'); }, assert.fail);
  await entered.promise; const closing = life.close(() => order.push('dispose'));
  assert.deepEqual(order, ['setup']); setup.resolve(); await starting; await closing;
  assert.deepEqual(order, ['setup', 'setup done', 'detach', 'dispose']);
});

test('late materialization with uncertain close does not automatically retry or dispose', async () => {
  const gate = deferred(); let closes = 0, disposed = 0;
  const life = createTermLifecycle({ open: () => gate.promise, closePty: () => { closes++; return terminalFailure('E_TERM_CLOSE_PENDING'); } });
  const starting = life.start(() => assert.fail('closed'), assert.fail), closing = life.close(() => disposed++);
  gate.resolve(handle(10)); await starting; assert.equal((await closing).ok, false);
  assert.equal(closes, 1); assert.equal(disposed, 0);
});
