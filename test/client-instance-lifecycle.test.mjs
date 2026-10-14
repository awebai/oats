// The lifecycle boundary of the shared home (packages/client/instance-lifecycle.mjs): a client makes its own,
// and two boundaries share nothing. What one holds (its plans, its kept answers, its one apply at a time) is
// unknown to the other; between them only the kernel's answers hold.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLifecycleBoundary } from '../packages/client/instance-lifecycle.mjs';
import { clientTerms } from '../packages/client/client-terms.mjs';
import { context, request, stopPlan, stopReceipt, envelope, deferred, tick } from '../packages/desktop/test/helpers/lifecycle-fixture.mjs';

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
