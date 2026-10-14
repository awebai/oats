// The lifecycle boundary of the shared home (packages/client/instance-lifecycle.mjs): a client makes its own,
// and two boundaries share nothing. What one holds (its plans, its kept answers, its one apply at a time) is
// unknown to the other; between them only the kernel's answers hold.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLifecycleBoundary, APPLY_WAIT_MS } from '../packages/client/instance-lifecycle.mjs';
import { clientTerms } from '../packages/client/client-terms.mjs';
import { context, target, request, stopPlan, stopReceipt, envelope, deferred, tick } from '../packages/desktop/test/helpers/lifecycle-fixture.mjs';

const terms = clientTerms({ name: 'the test client', self: 'this test client', selfInitial: 'This test client', update: 'Update the test client.', thisMachine: 'This machine' });

/** A boundary whose CLI answers every plan, and every apply when `held` (if given) settles. */
function boundary({ held = null } = {}) {
  const calls = [];
  const service = createLifecycleBoundary({ terms, invoke: async (_bin, args) => {
    calls.push(args.phase);
    if (args.phase === 'plan') return envelope(stopPlan());
    if (held) await held.promise;
    return envelope(stopReceipt(args));
  } });
  const ctx = context();
  return { calls, plan: () => service(request('stop'), () => ctx), apply: planRef => service({ action: 'apply', planRef }, () => ctx) };
}

test('a plan read through one boundary is unknown to another: applying it there answers E_PLAN_EXPIRED and runs nothing', async () => {
  const one = boundary(), other = boundary();
  const read = await one.plan();
  assert.equal(read.status, 'plan');
  const elsewhere = await other.apply(read.planRef);
  assert.equal(elsewhere.status, 'unavailable');
  assert.equal(elsewhere.reason.code, 'E_PLAN_EXPIRED');
  assert.deepEqual(other.calls, [], 'the other boundary ran no command');
  assert.equal((await one.apply(read.planRef)).status, 'complete', 'the boundary that read it still applies it');
});

test('an apply in flight in one boundary does not make another busy', async () => {
  const held = deferred(), one = boundary({ held }), other = boundary();
  const first = await one.plan(), second = await one.plan();
  const running = one.apply(first.planRef); await tick();
  assert.equal((await one.apply(second.planRef)).reason.code, 'E_LIFECYCLE_BUSY', 'premise: the first boundary is busy');
  const read = await other.plan();
  assert.equal(read.status, 'plan');
  assert.equal((await other.apply(read.planRef)).status, 'complete', 'the other applies while the first is busy');
  held.resolve();
  assert.equal((await running).status, 'complete');
});

// The wait for an apply's answer ends; the apply does not (#889). A boundary over a CLI that answers when told,
// with its timers and its wall clock in the test's hands.
function waiting({ features = cli().features } = {}) {
  const timers = [], applies = [];
  const service = createLifecycleBoundary({ terms, clock: () => 1_700_000_000_000,
    after: (ms, fn) => { const timer = { ms, fn, live: true }; timers.push(timer); return () => { timer.live = false; }; },
    invoke: async (_bin, args) => {
      if (args.phase === 'plan') return envelope(stopPlan());
      const gate = deferred(); applies.push({ args, gate }); return gate.promise;
    } });
  const ctx = { ...context(), cli: { ...cli(), features } };
  const end = () => { for (const t of timers.filter(t => t.live)) { t.live = false; t.fn(); } };
  return { timers, applies, end, plan: () => service(request('stop'), () => ctx), apply: planRef => service({ action: 'apply', planRef }, () => ctx) };
}
const cli = () => context().cli;
const running = { target: { ...target }, operation: 'stop', since: 1_700_000_000_000 };

test('an apply whose wait ends is unknown and still running: the same reference is answered at once, the CLI runs once, and its late answer is kept', async () => {
  const b = waiting(), read = await b.plan();
  const first = b.apply(read.planRef); await tick();
  assert.deepEqual(b.timers.map(t => t.ms), [APPLY_WAIT_MS]); assert.equal(APPLY_WAIT_MS, 600_000);
  b.end();
  const waited = await first;
  assert.equal(waited.status, 'unknown'); assert.equal(waited.reason.code, 'E_OUTCOME_UNKNOWN'); assert.equal(waited.cause.code, 'E_CLI_TIMEOUT');
  assert.deepEqual(waited.running, running);
  assert.equal(waited.planRef, read.planRef, 'check again asks by the same reference');
  const again = await b.apply(read.planRef);
  assert.deepEqual(again, waited, 'answered at once: no second wait'); assert.equal(b.timers.length, 1);
  assert.equal(b.applies.length, 1, 'the CLI ran once');
  b.applies[0].gate.resolve(envelope(stopReceipt(b.applies[0].args))); await tick();
  const late = await b.apply(read.planRef);
  assert.equal(late.status, 'complete'); assert.equal(late.repeated, true); assert.equal(Object.hasOwn(late, 'running'), false);
  assert.equal(b.applies.length, 1, 'the late answer is read from what was kept');
});

test('another apply while one runs, before or after its wait, is refused busy and names the running one; the 32-action cap names none', async () => {
  const b = waiting(), one = await b.plan(), two = await b.plan();
  const first = b.apply(one.planRef); await tick();
  for (const moment of ['in its wait', 'after its wait']) {
    const busy = await b.apply(two.planRef);
    assert.equal(busy.status, 'unavailable', moment); assert.equal(busy.reason.code, 'E_LIFECYCLE_BUSY', moment);
    assert.deepEqual(busy.running, running, moment);
    assert.equal(Object.hasOwn(busy, 'details'), false, moment); assert.equal(Object.hasOwn(busy.reason, 'holder'), false, `${moment}: the kernel's holder is never read of it`);
    if (moment === 'in its wait') { b.end(); await first; }
  }
  assert.equal(b.applies.length, 1, 'the refused apply ran nothing');
  b.applies[0].gate.resolve(envelope(stopReceipt(b.applies[0].args))); await tick();
  const second = b.apply(two.planRef); await tick(); b.end();
  assert.equal((await second).status, 'unknown', 'once the first has answered, the second runs (and waits)');
  assert.equal(b.applies.length, 2);
  // The cap: 32 kept actions, none running.
  const capped = waiting(), refs = [];
  for (let i = 0; i < 32; i++) refs.push((await capped.plan()).planRef);
  for (const [i, ref] of refs.entries()) { const p = capped.apply(ref); await tick(); capped.applies[i].gate.resolve(envelope(stopReceipt(capped.applies[i].args))); await p; }
  const full = await capped.apply((await capped.plan()).planRef);
  assert.equal(full.reason.code, 'E_LIFECYCLE_BUSY'); assert.equal(Object.hasOwn(full, 'running'), false, 'the cap is no running apply');
});

test('the kernel\'s own busy answer carries no running, and its holder is read as the kernel\'s', async () => {
  const b = waiting({ features: [...cli().features, 'lifecycle-claim-stop'] }), read = await b.plan();
  const answer = b.apply(read.planRef); await tick();
  b.applies[0].gate.resolve({ schemaVersion: 1, ok: false, origin: 'kernel', error: { code: 'E_LIFECYCLE_BUSY', message: 'held', details: { holder: 'running', home: target.home } } });
  const busy = await answer;
  assert.equal(busy.status, 'refused'); assert.equal(busy.reason.holder, 'running'); assert.equal(Object.hasOwn(busy, 'running'), false);
  assert.equal(b.timers.filter(t => t.live).length, 0, 'an answered apply leaves no wait behind');
});
