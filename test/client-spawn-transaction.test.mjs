// The spawn transaction in the shared home (packages/client/spawn-transaction.mjs, #855 6b-2): prepare, apply the
// confirmed decision, follow a pending apply, check and recover, each answer classified into one outcome kind.
// The replies are real /api/spawn views over the Desktop's captured kernel answers, projected by the transaction
// as every client's are; the client's boundary is a scripted `request`, and the clock and the waits are the test's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpawnTransaction, RECOVER_POLL_MS, FOLLOW_MARGIN_MS, RECOVER_WITHIN_MS } from '../packages/client/spawn-transaction.mjs';
import { spawnApplyFailure, spawnApplyReason, spawnCreationReceipt, SPAWN_APPLY_MS, WORKTREE_HOOK_MS } from '../packages/client/spawn-apply-contract.mjs';
import { target, selector, data } from '../packages/desktop/test/helpers/spawn-preview-fixture.mjs';
import { creation } from '../packages/desktop/test/helpers/spawn-apply-fixture.mjs';
import { retained } from '../packages/desktop/test/helpers/launch-prompt-fixture.mjs';

const REF = 'a'.repeat(64), OTHER = 'b'.repeat(64);
const preview = () => data();
const decision = () => structuredClone(preview().decision);
const view = (status, extra = {}) => ({ spawnApplyViewApi: 1, status, target, spawnRef: REF, preview: preview(), wakeRequested: false, receipt: null, reason: null, ...extra });
const receipt = (changes = {}, wakeRequested = false) => spawnCreationReceipt(creation(preview(), changes), { target, preview: preview(), wakeRequested });
const REPLY = {
  prepared: (extra = {}) => view('prepared', extra),
  pending: () => view('pending'),
  complete: () => view('complete', { receipt: receipt() }),
  partial: () => view('partial', { wakeRequested: true, receipt: receipt({ wake: { requested: true, saved: false, error: { code: 'E_X' } } }, true) }),
  incomplete: () => ({ ...spawnApplyFailure('E_SPAWN_INCOMPLETE', { target, spawnRef: REF, status: 'incomplete' }), incomplete: retained(preview().decision) }),
  failed: (code, status = 'refused', message) => spawnApplyFailure(code, { target, spawnRef: REF, status, message }),
};
const INTENT = () => ({ address: target.workspace, selector, input: { action: 'prepare', selector, choices: {}, task: 'Cut 3.2' }, decision: decision() });

/** A scripted boundary: `replies` answers each body in turn (a function of the body, a value, or an Error to throw). */
function boundary(replies, { start = 1000 } = {}) {
  const bodies = [], jobs = [], slept = []; let clock = start;
  const tx = createSpawnTransaction({
    request: async (body, job) => {
      bodies.push(structuredClone(body)); jobs.push(job);
      const next = replies.shift();
      assert.ok(next !== undefined, `no reply scripted for ${body.action}`);
      const reply = typeof next === 'function' ? next(body) : next;
      if (reply instanceof Error) throw reply;
      return reply;
    },
    now: () => clock, sleep: async ms => { slept.push(ms); clock += ms; } });
  return { tx, bodies, jobs, slept, actions: () => bodies.map(b => b.action), advance: ms => { clock += ms; }, now: () => clock };
}
const events = () => { const heard = []; return { heard, progress: (event, job) => heard.push([event, { ...job }]) }; };

test('the module answers its constants, and a transaction needs its boundary', () => {
  assert.equal(RECOVER_POLL_MS, 2000); assert.equal(FOLLOW_MARGIN_MS, 30000); assert.equal(RECOVER_WITHIN_MS, SPAWN_APPLY_MS + FOLLOW_MARGIN_MS);
  assert.throws(() => createSpawnTransaction({}), { name: 'TypeError', message: 'createSpawnTransaction: request must be a function' });
});

test('created: prepare, then apply of the prepared reference; submitted is heard once, before the apply, with its deadline', async () => {
  const b = boundary([REPLY.prepared(), REPLY.complete()]), p = events();
  const out = await b.tx.submit(INTENT(), p);
  assert.deepEqual(b.actions(), ['prepare', 'apply']);
  assert.equal(b.bodies[0].task, 'Cut 3.2', 'the prepare is the intent\'s input, as given');
  assert.deepEqual(b.bodies[1], { action: 'apply', spawnRef: REF });
  assert.equal(out.kind, 'created'); assert.equal(out.view.status, 'complete'); assert.equal(out.reason, null);
  assert.equal(out.view.receipt.instance, preview().decision.instance);
  const deadline = 1000 + SPAWN_APPLY_MS + FOLLOW_MARGIN_MS;
  assert.deepEqual(Object.keys(out.job).sort(), ['address', 'deadline', 'prepared', 'selector', 'spawnRef', 'submitted']);
  assert.equal(out.job.spawnRef, REF); assert.equal(out.job.submitted, true); assert.equal(out.job.deadline, deadline);
  assert.equal(out.job.address, target.workspace); assert.equal(out.job.prepared.status, 'prepared');
  assert.deepEqual(p.heard.map(([e, j]) => [e, j.spawnRef, j.deadline, j.submitted]), [['submitted', REF, deadline, true]]);
  assert.ok(b.jobs.every(j => j === out.job), 'the client\'s boundary is handed the job, for its address');
});

test('created keeps the view\'s status: partial with its wake reason, and incomplete', async () => {
  const partial = await boundary([REPLY.prepared(), REPLY.partial()]).tx.submit(INTENT());
  assert.equal(partial.kind, 'created'); assert.equal(partial.view.status, 'partial');
  assert.equal(partial.reason.code, 'E_WAKE_SAVE_FAILED');
  const incomplete = await boundary([REPLY.prepared(), REPLY.incomplete()]).tx.submit(INTENT());
  assert.equal(incomplete.kind, 'created'); assert.equal(incomplete.view.status, 'incomplete');
  assert.equal(incomplete.reason.code, 'E_SPAWN_INCOMPLETE');
});

test('the deadline follows the broker\'s applyWithinMs when the prepared view carries one', async () => {
  const within = 2 * SPAWN_APPLY_MS + WORKTREE_HOOK_MS;
  const out = await boundary([REPLY.prepared({ applyWithinMs: within }), REPLY.complete()]).tx.submit(INTENT());
  assert.equal(out.job.deadline, 1000 + within + FOLLOW_MARGIN_MS);
});

test('pending: result every pollMs, pending heard on each answer it goes on following, then the settled kind', async () => {
  const b = boundary([REPLY.prepared(), REPLY.pending(), REPLY.pending(), REPLY.complete()]), p = events();
  const out = await b.tx.submit(INTENT(), p);
  assert.deepEqual(b.actions(), ['prepare', 'apply', 'result', 'result']);
  assert.deepEqual(b.bodies.slice(2), [{ action: 'result', spawnRef: REF }, { action: 'result', spawnRef: REF }]);
  assert.deepEqual(b.slept, [RECOVER_POLL_MS, RECOVER_POLL_MS]);
  assert.deepEqual(p.heard.map(([e]) => e), ['submitted', 'pending', 'pending']);
  assert.equal(out.kind, 'created');
});

test('pending-expired: still pending at the deadline, with no reason and no further read', async () => {
  const b = boundary([REPLY.prepared(), () => { b.advance(SPAWN_APPLY_MS + FOLLOW_MARGIN_MS - RECOVER_POLL_MS); return REPLY.pending(); }, REPLY.pending()]), p = events();
  const out = await b.tx.submit(INTENT(), p);
  assert.deepEqual(b.actions(), ['prepare', 'apply', 'result']);
  assert.deepEqual(p.heard.map(([e]) => e), ['submitted', 'pending']);
  assert.equal(out.kind, 'pending-expired'); assert.equal(out.reason, null); assert.equal(out.view.status, 'pending');
  // A pending answer past the deadline is not followed at all.
  const late = boundary([REPLY.prepared(), () => { late.advance(SPAWN_APPLY_MS + FOLLOW_MARGIN_MS); return REPLY.pending(); }]), q = events();
  assert.equal((await late.tx.submit(INTENT(), q)).kind, 'pending-expired');
  assert.deepEqual(q.heard.map(([e]) => e), ['submitted']); assert.deepEqual(late.slept, []);
});

test('cleanup-owed and rolled-back: the rolled-back codes, unknown and refused', async () => {
  for (const code of ['E_INTERRUPTED', 'E_REQUIRED_HOOK_FAILED', 'E_HOOK_ENVIRONMENT_CONTRACT']) {
    const owed = await boundary([REPLY.prepared(), REPLY.failed(code, 'unknown', 'hook log /x')]).tx.submit(INTENT());
    assert.equal(owed.kind, 'cleanup-owed'); assert.equal(owed.reason.code, code); assert.equal(owed.reason.message, 'hook log /x');
    const back = await boundary([REPLY.prepared(), REPLY.failed(code, 'refused', 'hook log /y')]).tx.submit(INTENT());
    assert.equal(back.kind, 'rolled-back'); assert.equal(back.reason.code, code); assert.equal(back.reason.message, 'hook log /y');
  }
});

test('unknown: an unknown answer reads E_OUTCOME_UNKNOWN\'s reason, whatever its own', async () => {
  const out = await boundary([REPLY.prepared(), REPLY.failed('E_CLI_TIMEOUT', 'unknown')]).tx.submit(INTENT());
  assert.equal(out.kind, 'unknown'); assert.equal(out.view.status, 'unknown');
  assert.deepEqual(out.reason, spawnApplyReason('E_OUTCOME_UNKNOWN'));
});

test('unknown: E_INTENT_EXPIRED once submitted is proof of nothing, with its own reason (decision A)', async () => {
  const out = await boundary([REPLY.prepared(), REPLY.failed('E_INTENT_EXPIRED')]).tx.submit(INTENT());
  assert.equal(out.kind, 'unknown'); assert.equal(out.reason.code, 'E_INTENT_EXPIRED');
  assert.deepEqual(out.reason, spawnApplyReason('E_INTENT_EXPIRED'));
});

test('unknown: a failure once the apply was requested, with no view', async () => {
  const thrown = await boundary([REPLY.prepared(), new Error('socket hang up')]).tx.submit(INTENT());
  assert.equal(thrown.kind, 'unknown'); assert.equal(thrown.view, null); assert.deepEqual(thrown.reason, spawnApplyReason('E_OUTCOME_UNKNOWN'));
  // A reply that is not a view, or whose decision is not the prepared one, is a protocol failure: after the press, unknown.
  const garbage = await boundary([REPLY.prepared(), { spawnApplyViewApi: 1 }]).tx.submit(INTENT());
  assert.equal(garbage.kind, 'unknown');
  const other = decision(); other.home = `${other.home}-other`;
  const moved = await boundary([REPLY.prepared(), REPLY.pending(), () => view('pending', { preview: { ...preview(), decision: other } })]).tx.submit(INTENT());
  assert.equal(moved.kind, 'unknown', 'a follow-up whose decision moved is not the confirmed spawn');
  // While following, too.
  const lost = await boundary([REPLY.prepared(), REPLY.pending(), new Error('gone')]).tx.submit(INTENT());
  assert.equal(lost.kind, 'unknown'); assert.equal(lost.view, null);
});

test('never-submitted: a reference that reads prepared after the apply', async () => {
  const out = await boundary([REPLY.prepared(), REPLY.prepared()]).tx.submit(INTENT());
  assert.equal(out.kind, 'never-submitted'); assert.equal(out.view.status, 'prepared');
});

test('drifted: the prepared decision is not the confirmed one (no apply, no reason), or E_DECISION_STALE', async () => {
  const intent = INTENT(); intent.decision.instance = 'someone-else';
  const b = boundary([REPLY.prepared()]), p = events();
  const at = await b.tx.submit(intent, p);
  assert.deepEqual(b.actions(), ['prepare'], 'nothing is applied');
  assert.equal(at.kind, 'drifted'); assert.equal(at.reason, null); assert.equal(at.view.status, 'prepared');
  assert.equal(at.job.submitted, false); assert.equal(at.job.spawnRef, null); assert.deepEqual(p.heard, []);
  const stale = await boundary([REPLY.prepared(), REPLY.failed('E_DECISION_STALE')]).tx.submit(INTENT());
  assert.equal(stale.kind, 'drifted'); assert.equal(stale.reason.code, 'E_DECISION_STALE');
});

test('refused: a prepare that did not prepare, a refusal, and a failure before the apply was requested', async () => {
  const b = boundary([REPLY.failed('E_PLACEMENT_TAKEN')]), p = events();
  const prepare = await b.tx.submit(INTENT(), p);
  assert.equal(prepare.kind, 'refused'); assert.equal(prepare.reason.code, 'E_PLACEMENT_TAKEN'); assert.equal(prepare.job.submitted, false);
  assert.deepEqual(b.actions(), ['prepare']); assert.deepEqual(p.heard, []);
  const refusal = await boundary([REPLY.prepared(), REPLY.failed('E_BRANCH_EXISTS')]).tx.submit(INTENT());
  assert.equal(refusal.kind, 'refused'); assert.equal(refusal.job.submitted, true);
  // E_INTENT_EXPIRED before submission is an ordinary refusal: nothing was submitted.
  const expired = await boundary([REPLY.failed('E_INTENT_EXPIRED')]).tx.submit(INTENT());
  assert.equal(expired.kind, 'refused'); assert.equal(expired.reason.code, 'E_INTENT_EXPIRED');
  const thrown = await boundary([Object.assign(new Error('x'), { code: 'E_FORBIDDEN_FRAME' })]).tx.submit(INTENT());
  assert.equal(thrown.kind, 'refused'); assert.equal(thrown.view, null); assert.deepEqual(thrown.reason, spawnApplyReason('E_FORBIDDEN_FRAME'));
  const transport = await boundary([new Error('offline')]).tx.submit(INTENT());
  assert.deepEqual(transport.reason, spawnApplyReason(undefined), 'no code: E_CLI_FAILED');
  const garbage = await boundary([{ nope: true }]).tx.submit(INTENT());
  assert.equal(garbage.kind, 'refused'); assert.equal(garbage.reason.code, 'E_CLI_PROTOCOL');
});

test('check: result, and an unknown result re-applies the same reference, never a new one; it never prepares', async () => {
  const first = boundary([REPLY.prepared(), REPLY.failed('E_CLI_TIMEOUT', 'unknown')]);
  const unknown = await first.tx.submit(INTENT());
  assert.equal(unknown.kind, 'unknown');
  const b = boundary([REPLY.failed('E_CLI_TIMEOUT', 'unknown'), REPLY.complete()]);
  const out = await b.tx.check(unknown.job);
  assert.deepEqual(b.bodies, [{ action: 'result', spawnRef: REF }, { action: 'apply', spawnRef: REF }]);
  assert.equal(out.kind, 'created'); assert.equal(out.job, unknown.job);
  // A settled result is classified as it is; a pending one is followed to the job's own deadline.
  const settled = boundary([REPLY.failed('E_BRANCH_EXISTS')]);
  assert.equal((await settled.tx.check(unknown.job)).kind, 'refused'); assert.deepEqual(settled.actions(), ['result']);
  const followed = boundary([REPLY.pending(), REPLY.complete()]);
  assert.equal((await followed.tx.check(unknown.job)).kind, 'created'); assert.deepEqual(followed.actions(), ['result', 'result']);
  const failing = boundary([new Error('gone')]);
  assert.equal((await failing.tx.check(unknown.job)).kind, 'unknown');
  await assert.rejects(b.tx.check({ address: target.workspace, selector }), { name: 'TypeError', message: 'check: job.spawnRef is required' });
});

test('recover: result for a kept reference; one without a deadline follows RECOVER_WITHIN_MS from now', async () => {
  const b = boundary([REPLY.pending(), REPLY.complete()], { start: 5000 });
  const kept = { address: target.workspace, selector, spawnRef: REF };
  const out = await b.tx.recover(kept);
  assert.deepEqual(b.bodies, [{ action: 'result', spawnRef: REF }, { action: 'result', spawnRef: REF }]);
  assert.equal(out.kind, 'created'); assert.equal(out.job, kept);
  assert.equal(kept.deadline, 5000 + RECOVER_WITHIN_MS); assert.equal(kept.submitted, true);
  // Kept with its deadline: that one, already past here.
  const past = { address: target.workspace, selector, spawnRef: REF, deadline: 10, submitted: true };
  assert.equal((await boundary([REPLY.pending()], { start: 5000 }).tx.recover(past)).kind, 'pending-expired');
  assert.equal(past.deadline, 10);
  // A recovered reference whose intent expired is unknown, never "nothing was created".
  assert.equal((await boundary([REPLY.failed('E_INTENT_EXPIRED')]).tx.recover({ address: target.workspace, selector, spawnRef: REF })).kind, 'unknown');
  assert.equal((await boundary([new Error('gone')]).tx.recover({ address: target.workspace, selector, spawnRef: REF })).kind, 'unknown');
  // A reply for another reference is not this job's.
  assert.equal((await boundary([{ ...REPLY.complete(), spawnRef: OTHER }]).tx.recover({ address: target.workspace, selector, spawnRef: REF })).kind, 'unknown');
  await assert.rejects(b.tx.recover({}), { name: 'TypeError', message: 'recover: job.spawnRef is required' });
});

test('alive() false: the call resolves null and reports nothing, at every await', async () => {
  // After the prepare's reply.
  let on = true;
  const b1 = boundary([() => { on = false; return REPLY.prepared(); }]);
  assert.equal(await b1.tx.submit(INTENT(), { alive: () => on }), null); assert.deepEqual(b1.actions(), ['prepare']);
  // After the apply's reply, and after a failure.
  on = true;
  const b2 = boundary([REPLY.prepared(), () => { on = false; return REPLY.complete(); }]);
  assert.equal(await b2.tx.submit(INTENT(), { alive: () => on }), null);
  on = true;
  const b3 = boundary([REPLY.prepared(), () => { on = false; return new Error('x'); }]);
  assert.equal(await b3.tx.submit(INTENT(), { alive: () => on }), null);
  on = true;
  const b4 = boundary([() => { on = false; return new Error('x'); }]);
  assert.equal(await b4.tx.submit(INTENT(), { alive: () => on }), null);
  // While following: the owner went away during the wait, so the next read is never made.
  on = true;
  const heard = [];
  const b5 = boundary([REPLY.prepared(), REPLY.pending()]);
  const following = b5.tx.submit(INTENT(), { alive: () => on, progress: e => { heard.push(e); if (e === 'pending') on = false; } });
  assert.equal(await following, null); assert.deepEqual(b5.actions(), ['prepare', 'apply']); assert.deepEqual(heard, ['submitted', 'pending']);
  // check and recover alike.
  on = true;
  const job = { address: target.workspace, selector, spawnRef: REF, deadline: Infinity, submitted: true };
  assert.equal(await boundary([() => { on = false; return REPLY.complete(); }]).tx.check(job, { alive: () => on }), null);
  on = true;
  assert.equal(await boundary([() => { on = false; return new Error('x'); }]).tx.recover(job, { alive: () => on }), null);
});

test('two transactions share nothing: one client\'s jobs, clock and waits are its own', async () => {
  const a = boundary([REPLY.prepared(), REPLY.pending(), REPLY.complete()], { start: 0 });
  const b = boundary([REPLY.prepared(), REPLY.failed('E_BRANCH_EXISTS')], { start: 100000 });
  const [outA, outB] = await Promise.all([a.tx.submit(INTENT()), b.tx.submit(INTENT())]);
  assert.equal(outA.kind, 'created'); assert.equal(outB.kind, 'refused');
  assert.notEqual(outA.job, outB.job);
  assert.equal(outA.job.deadline, SPAWN_APPLY_MS + FOLLOW_MARGIN_MS); assert.equal(outB.job.deadline, 100000 + SPAWN_APPLY_MS + FOLLOW_MARGIN_MS);
  assert.deepEqual(a.actions(), ['prepare', 'apply', 'result']); assert.deepEqual(b.actions(), ['prepare', 'apply']);
  assert.deepEqual(a.slept, [RECOVER_POLL_MS]); assert.deepEqual(b.slept, []);
  // Two submits of one transaction are two jobs.
  const c = boundary([REPLY.prepared(), REPLY.complete(), REPLY.prepared(), REPLY.complete()]);
  const [one, two] = [await c.tx.submit(INTENT()), await c.tx.submit(INTENT())];
  assert.notEqual(one.job, two.job);
});

test('no mint: every reference the transaction sends is one the boundary answered', async () => {
  const b = boundary([REPLY.prepared(), REPLY.failed('E_CLI_TIMEOUT', 'unknown')]);
  const out = await b.tx.submit(INTENT());
  const c = boundary([REPLY.failed('E_CLI_TIMEOUT', 'unknown'), REPLY.pending(), REPLY.complete()]);
  await c.tx.check(out.job);
  const sent = [...b.bodies, ...c.bodies].filter(body => body.action !== 'prepare');
  assert.ok(sent.length >= 4);
  assert.ok(sent.every(body => body.spawnRef === REF && Object.keys(body).sort().join() === 'action,spawnRef'), 'only the reference and the action, never a key');
  assert.ok(b.bodies.concat(c.bodies).every(body => !('key' in body) && !('idempotencyKey' in body)));
});
