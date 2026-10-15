// The client's half of a Stop or Retire confirmation (packages/client/lifecycle-confirmation.mjs): what a plan and
// its answer say, and the transaction's closed set of states. A key is one intent: "check again" asks for the answer
// to the confirmation already sent, by the same reference; trying again is a new plan, so a new reference.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLifecycleConfirmation, planView, outcomeView, unavailableView, applyRunningSentence } from '../packages/client/lifecycle-confirmation.mjs';
import { createLifecycleBoundary } from '../packages/client/instance-lifecycle.mjs';
import { createRetiresInFlight } from '../packages/client/retire-in-flight.mjs';
import { clientTerms } from '../packages/client/client-terms.mjs';
import { context, target, stopPlan, retirePlan, stopReceipt, retireReceipt, envelope, options, deferred, tick } from '../packages/desktop/test/helpers/lifecycle-fixture.mjs';

const terms = clientTerms({ name: 'the test client', self: 'this test client', selfInitial: 'This test client', update: 'Update the test client.', thisMachine: 'This machine' });
const reference = n => String(n).repeat(64);
const planned = (operation, planRef, raw = operation === 'stop' ? stopPlan() : retirePlan()) =>
  ({ lifecycleApi: 1, status: 'plan', target, planRef, plan: raw, options: options(operation), receipt: null, reason: null });

/** A confirmation over a scripted boundary: each plan read answers the next reference; `answer(body)` answers an apply. */
function scripted(operation, answer) {
  const sent = [], events = [], settled = []; let plans = 0;
  const confirmation = createLifecycleConfirmation({ target, operation, terms, onChange: event => events.push(event), onSettled: result => settled.push(result),
    request: async body => { sent.push(body); return body.action === 'plan' ? { ...planned(operation, reference(++plans)), options: body.options } : answer(body); } });
  return { confirmation, sent, events, settled, applies: () => sent.filter(b => b.action === 'apply').map(b => b.planRef) };
}
const refused = code => ({ lifecycleApi: 1, status: 'refused', target, planRef: null, plan: null, receipt: null, reason: { code } });
const unknown = { lifecycleApi: 1, status: 'unknown', target, planRef: null, plan: null, receipt: null, reason: { code: 'E_OUTCOME_UNKNOWN' } };
const partial = () => { const raw = stopReceipt({ revision: stopPlan().planRevision, key: 'k' }); raw.ok = false;
  raw.results[0] = { ...raw.results[0], ok: false, code: 'E_SESSION_STOP_FAILED', stillRunning: null }; delete raw.results[0].stopped; delete raw.results[0].alreadyIdle; delete raw.results[0].state;
  return { lifecycleApi: 1, status: 'partial', target, receipt: { ...raw, idempotencyKey: undefined }, reason: { code: 'E_SESSION_STOP_FAILED' } }; };
const complete = () => { const raw = stopReceipt({ revision: stopPlan().planRevision, key: 'k' });
  return { lifecycleApi: 1, status: 'complete', target, receipt: raw, reason: null }; };

test('every wording function and the factory refuse a call without the client\'s terms', () => {
  const plan = { ...stopPlan(), targets: stopPlan().targets };
  for (const [name, call] of [['planView', t => planView(plan, { choices: { recursive: true } }, t)], ['outcomeView', t => outcomeView(unknown, { target, operation: 'stop', choices: { recursive: true }, plan }, t)],
    ['unavailableView', t => unavailableView(null, { target, operation: 'stop' }, t)], ['applyRunningSentence', t => applyRunningSentence({ target, operation: 'stop', since: 1 }, t)],
    ['createLifecycleConfirmation', t => createLifecycleConfirmation({ request: async () => ({}), target, operation: 'stop', terms: t })]])
    for (const t of [undefined, null, { ...terms }]) assert.throws(() => call(t), { name: 'TypeError', message: new RegExp(`^${name}: terms`) }, name);
});

test('the offers table: each state offers exactly its row, and an act not offered sends nothing', async () => {
  const row = c => c.state().offers;
  const gate = deferred(), s = scripted('stop', () => gate.promise);
  assert.deepEqual(s.confirmation.state(), { phase: 'reading', outcome: null, notice: null, offers: ['close'], running: null });
  assert.equal(s.confirmation.apply(), false); assert.equal(s.confirmation.checkAgain(), false); assert.equal(s.confirmation.refresh(), false);
  await tick();
  assert.deepEqual(s.confirmation.state(), { phase: 'review', outcome: null, notice: null, offers: ['apply', 'refresh', 'close'], running: null });
  assert.equal(s.confirmation.checkAgain(), false);
  assert.equal(s.confirmation.apply(), true);
  assert.deepEqual(s.confirmation.state(), { phase: 'applying', outcome: null, notice: null, offers: ['close'], running: null }, 'applying: close, which cancels nothing');
  const before = s.sent.length;
  assert.equal(s.confirmation.apply(), false); assert.equal(s.confirmation.refresh(), false); assert.equal(s.confirmation.checkAgain(), false);
  assert.equal(s.confirmation.setChoice('recursive', false), false, 'nothing is read while an apply is in flight');
  assert.equal(s.sent.length, before);
  gate.resolve(complete()); await tick();
  assert.deepEqual(s.confirmation.state(), { phase: 'settled', outcome: 'complete', notice: null, offers: ['close'], running: null });
  assert.equal(s.confirmation.apply(), false); assert.equal(s.confirmation.checkAgain(), false); assert.equal(s.confirmation.refresh(), false);
  for (const [answer, outcome, offered] of [[partial(), 'partial', ['refresh', 'close']], [refused('E_INSTANCE_RETIRING'), 'refused', ['refresh', 'close']],
    [unknown, 'unknown', ['check-again', 'close']], [{ lifecycleApi: 1, status: 'complete', target: { ...target, instance: 'other' } }, 'invalid', ['check-again', 'close']]]) {
    const t = scripted('stop', () => answer); await tick(); t.confirmation.apply(); await tick();
    assert.equal(t.confirmation.state().outcome, outcome); assert.deepEqual(row(t.confirmation), offered, outcome);
    const sent = t.sent.length;
    if (!offered.includes('refresh')) assert.equal(t.confirmation.refresh(), false, outcome);
    if (!offered.includes('check-again')) assert.equal(t.confirmation.checkAgain(), false, outcome);
    assert.equal(t.confirmation.apply(), false, outcome); assert.equal(t.sent.length, sent, `${outcome}: an act not offered sends nothing`);
  }
  const failed = createLifecycleConfirmation({ target, operation: 'stop', terms, request: async () => refused('E_SESSION_UNKNOWN') }); await tick();
  assert.deepEqual(failed.state(), { phase: 'settled', outcome: 'unavailable', notice: null, offers: ['refresh', 'close'], running: null });
});

test('check again sends the same reference and reads no plan; after partial or refused, refresh then apply sends a new one', async () => {
  let answer = unknown; const s = scripted('stop', () => answer);
  await tick(); s.confirmation.apply(); await tick();
  assert.equal(s.confirmation.checkAgain(), true); await tick();
  assert.deepEqual(s.applies(), [reference(1), reference(1)], 'one intent, one reference');
  assert.equal(s.sent.filter(b => b.action === 'plan').length, 1, 'check again reads no plan');
  for (const settledAs of [partial(), refused('E_LIFECYCLE_BUSY')]) {
    const t = scripted('stop', () => settledAs); await tick(); t.confirmation.apply(); await tick();
    assert.equal(t.confirmation.refresh(), true); await tick();
    assert.equal(t.confirmation.state().phase, 'review'); t.confirmation.apply(); await tick();
    assert.deepEqual(t.applies(), [reference(1), reference(2)], `${settledAs.status}: trying again is a new plan`);
  }
});

test('a stale answer returns to review with the fresh plan and its notice, and applies nothing by itself', async () => {
  const fresh = stopPlan(); fresh.planRevision = 'c'.repeat(24);
  const s = scripted('stop', () => ({ ...planned('stop', reference(9), fresh), status: 'stale', reason: { code: 'E_PLAN_STALE' } }));
  await tick(); s.confirmation.apply(); await tick(); await tick();
  const state = s.confirmation.state();
  assert.equal(state.phase, 'review'); assert.equal(state.notice.code, 'E_PLAN_STALE'); assert.deepEqual(state.offers, ['apply', 'refresh', 'close']);
  assert.deepEqual(s.applies(), [reference(1)]); assert.equal(s.settled.length, 0, 'a return to review is not an answer');
  s.confirmation.apply(); await tick(); assert.deepEqual(s.applies(), [reference(1), reference(9)]);
});

test('an answer to a superseded step, or one after close, is not told: the latest choice wins', async () => {
  const gates = [], events = [];
  const c = createLifecycleConfirmation({ target, operation: 'retire', terms, onChange: (e, d) => events.push([e, d.view?.kind ?? null]),
    request: body => { const gate = deferred(); gates.push(gate); return gate.promise.then(() => ({ ...planned('retire', reference(gates.indexOf(gate) + 1)), options: body.options })); } });
  assert.equal(c.setChoice('discardWorktree', true), true); assert.equal(c.setChoice('recursive', true), false, 'not a choice of a retire');
  gates[0].resolve(); await tick();
  assert.equal(c.state().phase, 'reading', 'the first read was superseded');
  gates[1].resolve(); await tick();
  assert.equal(c.state().phase, 'review'); assert.equal(c.view().choices[0].value, true);
  c.close(); assert.deepEqual(c.state().offers, []);
  assert.equal(c.setChoice('discardWorktree', false), false);
  assert.deepEqual(events.map(([e]) => e), ['reading', 'reading', 'plan']);
});

test('two confirmations share nothing: what one holds is unknown to the other', async () => {
  const boundary = createLifecycleBoundary({ terms, invoke: async (_bin, args) => envelope(args.phase === 'plan' ? stopPlan() : stopReceipt(args)) });
  const ctx = context(), request = body => boundary(body, () => ctx);
  const one = createLifecycleConfirmation({ target, operation: 'stop', terms, request }), other = createLifecycleConfirmation({ target, operation: 'stop', terms, request });
  await tick();
  assert.equal(one.apply(), true); await tick();
  assert.equal(one.state().outcome, 'complete');
  assert.deepEqual(other.state().offers, ['apply', 'refresh', 'close'], 'the other is still in review, with its own reference');
  other.close(); assert.deepEqual(one.state().offers, ['close']);
});

test('applyRunningSentence names the running apply, through the display filter', () => {
  assert.equal(applyRunningSentence({ target: { ...target, instance: 'dev-1' }, operation: 'stop', since: 5 }, terms),
    'The stop of dev-1 is still running. Wait for it to finish, then review again.');
  assert.equal(applyRunningSentence({ target: { ...target, instance: 'dev-1' }, operation: 'retire', since: 5 }, terms),
    'The removal of dev-1 is still running. Wait for it to finish, then review again.');
  const shown = applyRunningSentence({ target: { ...target, instance: 'dev‮-1\u0007x' }, operation: 'stop', since: 5 }, terms);
  assert.doesNotMatch(shown, /[‮\u0007]/); assert.match(shown, /^The stop of /);
});

test('a next step that names a client\'s own furniture is a code, never a sentence of the shared home', () => {
  const plan = retirePlan();
  const deferredReceipt = { lifecycleApi: 1, status: 'pending', target, receipt: { action: 'retire', instance: plan.instance, home: plan.home, planRevision: plan.planRevision, replayed: false, deferred: true } };
  const view = outcomeView(deferredReceipt, { target, operation: 'retire', choices: options('retire'), plan }, terms);
  assert.equal(view.kind, 'pending'); assert.equal(view.status.next, 'check-roster'); assert.doesNotMatch(view.status.headline, /roster/);
  const busy = { lifecycleApi: 1, status: 'refused', target, reason: { code: 'E_LIFECYCLE_BUSY', message: 'x', detail: 'pid 42 still runs' } };
  const leftover = outcomeView(busy, { target, operation: 'retire', choices: options('retire'), plan, leftover: true }, terms);
  assert.equal(leftover.status.next, 'retire-with-force'); assert.doesNotMatch(leftover.status.headline, /--force|CLI/);
  assert.deepEqual(leftover.blocks, [{ type: 'quote', text: 'pid 42 still runs' }]);
});

test('this client\'s own running apply: its busy refusal names it, the unknown after its wait says it still runs, and state() carries it', async () => {
  const running = { target: { ...target }, operation: 'retire', since: 1_700_000_000_000 };
  const busy = { lifecycleApi: 1, status: 'unavailable', target, planRef: null, plan: null, receipt: null, reason: { code: 'E_LIFECYCLE_BUSY', message: 'x' }, running };
  const at = { target, operation: 'stop', choices: options('stop'), plan: stopPlan() };
  const refusedView = outcomeView(busy, at, terms);
  assert.equal(refusedView.kind, 'refused'); assert.equal(refusedView.status.headline, 'The removal of dev-1 is still running. Wait for it to finish, then review again.');
  assert.deepEqual(refusedView.running, running);
  // The kernel's busy answer is never read as this client's, even beside a `running` it should not carry.
  const kernel = outcomeView({ ...busy, reason: { ...busy.reason, holder: 'running' } }, at, terms);
  assert.equal(Object.hasOwn(kernel, 'running'), false); assert.doesNotMatch(kernel.status.headline, /still running\. Wait/);
  // A malformed `running` is not read: the code's own sentence.
  for (const bad of [{ ...running, operation: 'start' }, { ...running, since: 'now' }, { ...running, target: { instance: 7 } }, 'stop'])
    assert.equal(Object.hasOwn(outcomeView({ ...busy, running: bad }, at, terms), 'running'), false, JSON.stringify(bad));
  const waited = { ...unknown, planRef: reference(1), cause: { code: 'E_CLI_TIMEOUT', message: "OATS didn't answer in time." }, running: { ...running, operation: 'stop' } };
  const s = scripted('stop', () => waited); await tick(); s.confirmation.apply(); await tick();
  const view = s.confirmation.view();
  assert.equal(view.kind, 'unknown'); assert.deepEqual(view.blocks.at(-1), { type: 'note', text: 'The stop of dev-1 is still running. Check again to read its result.' });
  assert.equal(view.blocks.some(b => /in time/.test(b.text ?? '')), false, 'the timeout ended only the wait: it is not said');
  assert.deepEqual(s.confirmation.state(), { phase: 'settled', outcome: 'unknown', notice: null, offers: ['check-again', 'close'], running: { ...running, operation: 'stop' } });
});

test('a code beside every sentence: each refusal, partial, uncertain, invalid and unavailable view carries its code, and the kernel\'s holder', () => {
  const stop = { target, operation: 'stop', choices: options('stop'), plan: stopPlan() }, retire = { target, operation: 'retire', choices: options('retire'), plan: retirePlan() };
  const busy = { lifecycleApi: 1, status: 'refused', target, reason: { code: 'E_LIFECYCLE_BUSY', message: 'x' } };
  const running = { target: { ...target }, operation: 'stop', since: 1 };
  for (const [name, view, code, holder] of [
    ['no answer at all (invalid)', outcomeView(null, stop, terms), 'E_OUTCOME_UNKNOWN'],
    ['a partial stop', outcomeView(partial(), stop, terms), 'E_SESSION_STOP_FAILED'],
    ['a refusal by the shared table', outcomeView(refused('E_INSTANCE_RETIRING'), stop, terms), 'E_INSTANCE_RETIRING'],
    ['an unknown outcome', outcomeView(unknown, stop, terms), 'E_OUTCOME_UNKNOWN'],
    ['this client\'s own busy, naming the running apply', outcomeView({ ...busy, running }, stop, terms), 'E_LIFECYCLE_BUSY'],
    ['the unknown after a wait, still running', outcomeView({ ...unknown, cause: { code: 'E_CLI_TIMEOUT' }, running }, stop, terms), 'E_OUTCOME_UNKNOWN'],
    ['the kernel\'s busy, holder none, with its detail', outcomeView({ ...busy, reason: { ...busy.reason, holder: 'none', detail: 'stop the other one first' } }, stop, terms), 'E_LIFECYCLE_BUSY', 'none'],
    ['the kernel\'s busy, holder running', outcomeView({ ...busy, reason: { ...busy.reason, holder: 'running' } }, stop, terms), 'E_LIFECYCLE_BUSY', 'running'],
    ['a held home a spawn left', outcomeView({ ...busy, reason: { ...busy.reason, detail: 'pid 42 still runs' } }, { ...retire, leftover: true }, terms), 'E_LIFECYCLE_BUSY'],
    ['a remote host\'s refusal', outcomeView({ ...busy, reason: { code: 'E_INSTANCE_RETIRING', message: 'build: retiring', detail: null, remote: true } }, stop, terms), 'E_INSTANCE_RETIRING'],
    ['a code the table does not describe', outcomeView({ ...busy, reason: { code: 'E_NOT_IN_THE_TABLE', message: 'm' } }, stop, terms), 'E_NOT_IN_THE_TABLE'],
    ['a plan that could not be read', unavailableView({ code: 'E_SESSION_UNKNOWN' }, { target, operation: 'stop' }, terms), 'E_SESSION_UNKNOWN'],
    ['no reply that names this target', unavailableView(null, { target, operation: 'stop' }, terms), 'E_CLI_PROTOCOL'],
  ]) {
    assert.equal(view.status.code, code, name);
    assert.equal(view.status.holder, holder, `${name}: holder`);
  }
});

test('a plan reply that is no reply (null, {}, a reason with no code) settles unavailable with a code, through the confirmation', async () => {
  for (const reply of [null, {}, { lifecycleApi: 1, status: 'unavailable', target, reason: {} }]) {
    const c = createLifecycleConfirmation({ target, operation: 'stop', terms, request: async () => reply }); await tick();
    assert.equal(c.state().outcome, 'unavailable', JSON.stringify(reply));
    assert.equal(typeof c.view().status.code, 'string', `${JSON.stringify(reply)}: a code beside the sentence`);
    assert.match(c.view().status.code, /^E_[A-Z_]+$/);
  }
});

test('when the ten-minute wait ends: the result is not confirmed, the stop is still running, Check again reads it, and "didn\'t answer in time" is never said', async () => {
  const timers = [], applies = [];
  const boundary = createLifecycleBoundary({ terms, clock: () => 1_700_000_000_000,
    after: (ms, fn) => { timers.push({ ms, fn }); return () => {}; },
    invoke: async (_bin, args) => { if (args.phase === 'plan') return envelope(stopPlan()); applies.push(args); return new Promise(() => {}); } });
  const ctx = context(), c = createLifecycleConfirmation({ target, operation: 'stop', terms, request: body => boundary(body, () => ctx) });
  await tick(); assert.equal(c.apply(), true); await tick();
  assert.equal(c.state().phase, 'applying'); assert.deepEqual(timers.map(t => t.ms), [600_000]);
  timers[0].fn(); await tick();
  const view = c.view(), said = JSON.stringify(view);
  assert.equal(view.kind, 'unknown'); assert.equal(view.title, 'Result not confirmed');
  assert.equal(view.status.headline, "OATS didn't confirm the result. Check again before assuming nothing happened."); assert.equal(view.status.code, 'E_OUTCOME_UNKNOWN');
  assert.deepEqual(view.blocks, [{ type: 'note', text: 'The stop of dev-1 is still running. Check again to read its result.' }]);
  assert.doesNotMatch(said, /in time/, 'the deadline ended the wait, not the command: it is not said as a timeout');
  assert.deepEqual(c.state(), { phase: 'settled', outcome: 'unknown', notice: null, offers: ['check-again', 'close'], running: { target, operation: 'stop', since: 1_700_000_000_000 } });
  assert.equal(c.checkAgain(), true); await tick();
  assert.equal(c.view().kind, 'unknown', 'still running: answered at once'); assert.equal(applies.length, 1, 'Check again ran no second command'); assert.equal(timers.length, 1, 'and started no second wait');
});

// #1247: the client's retires in flight (retire-in-flight.mjs). A retire's apply holds its row from the send until
// the roster was read after the answer; a refusal lets it go at once; a stop holds nothing.
/** A tracker that logs what it is told, over the real one: `log` is [['begin', instance] | ['settle', kind]]. */
function logged() {
  let reads = 0; const log = [], inner = createRetiresInFlight({ mark: () => reads });
  const retires = { begin: t => { log.push(['begin', t.instance]); const hold = inner.begin(t); return { settle: kind => { log.push(['settle', kind]); hold.settle(kind); } }; } };
  return { retires, log, holds: () => inner.holds(target), read: () => inner.landed(++reads) };
}
/** A retire confirmation whose apply answers through `gate` when it is given one. */
function retireWith(tracker, answer) {
  const sent = [];
  const confirmation = createLifecycleConfirmation({ target, operation: 'retire', terms, retires: tracker.retires,
    request: async body => { sent.push(body); return body.action === 'plan' ? { ...planned('retire', reference(sent.length)), options: body.options } : answer(body); } });
  return { confirmation, sent };
}

test('a retire apply holds its row from the send, before the answer, and settles it with the answer\'s kind', async () => {
  const tracker = logged(), gate = deferred(), { confirmation } = retireWith(tracker, () => gate.promise);
  await tick();
  assert.deepEqual(tracker.log, [], 'reading and reviewing a plan holds nothing');
  assert.equal(confirmation.apply(), true);
  assert.deepEqual(tracker.log, [['begin', 'dev-1']], 'begun with the send');
  assert.equal(tracker.holds(), true, 'held while the request is still pending');
  await tick(); assert.equal(confirmation.state().phase, 'applying'); assert.equal(tracker.holds(), true);
  gate.resolve(unknown); await tick();
  assert.deepEqual(tracker.log, [['begin', 'dev-1'], ['settle', 'unknown']]);
  assert.equal(tracker.holds(), true, 'an answer that may have run holds the row until a read');
  tracker.read(); assert.equal(tracker.holds(), false, 'the read after the answer lets it go');
});

test('a retire\'s outcome kinds reach the tracker: complete and invalid hold until a read, refused and stale let go at once', async () => {
  const boundary = createLifecycleBoundary({ terms, invoke: async (_bin, args) => envelope(args.phase === 'plan' ? retirePlan() : retireReceipt(args)) });
  const ctx = context(), tracker = logged();
  const done = createLifecycleConfirmation({ target, operation: 'retire', terms, retires: tracker.retires, request: body => boundary(body, () => ctx) });
  await tick(); done.apply(); await tick(); await tick();
  assert.equal(done.state().outcome, 'complete'); assert.deepEqual(tracker.log.at(-1), ['settle', 'complete']); assert.equal(tracker.holds(), true);
  tracker.read(); assert.equal(tracker.holds(), false);
  const thrown = logged(), { confirmation: broken } = retireWith(thrown, async () => { throw new Error('the request failed'); });
  await tick(); broken.apply(); await tick();
  assert.equal(broken.state().outcome, 'invalid'); assert.deepEqual(thrown.log, [['begin', 'dev-1'], ['settle', 'invalid']]); assert.equal(thrown.holds(), true);
  const refusing = logged(), { confirmation: refusal } = retireWith(refusing, () => refused('E_INSTANCE_RETIRING'));
  await tick(); refusal.apply(); await tick();
  assert.equal(refusal.state().outcome, 'refused'); assert.deepEqual(refusing.log, [['begin', 'dev-1'], ['settle', 'refused']]);
  assert.equal(refusing.holds(), false, 'a refusal ran nothing: the row reads as the roster says at once');
  const fresh = retirePlan(); fresh.planRevision = 'c'.repeat(24);
  const staling = logged(), { confirmation: stale } = retireWith(staling, () => ({ ...planned('retire', reference(9), fresh), status: 'stale', reason: { code: 'E_PLAN_STALE' } }));
  await tick(); stale.apply(); await tick();
  assert.equal(stale.state().phase, 'review'); assert.deepEqual(staling.log, [['begin', 'dev-1'], ['settle', 'stale']]); assert.equal(staling.holds(), false);
});

test('a stop never begins a hold, and a retire\'s check again begins a new one for the same row', async () => {
  const stopping = logged(), stop = createLifecycleConfirmation({ target, operation: 'stop', terms, retires: stopping.retires,
    request: async body => body.action === 'plan' ? { ...planned('stop', reference(1)), options: body.options } : complete() });
  await tick(); stop.apply(); await tick();
  assert.equal(stop.state().outcome, 'complete'); assert.deepEqual(stopping.log, []); assert.equal(stopping.holds(), false);
  const tracker = logged(), { confirmation } = retireWith(tracker, () => unknown);
  await tick(); confirmation.apply(); await tick();
  assert.equal(confirmation.checkAgain(), true); await tick();
  assert.deepEqual(tracker.log, [['begin', 'dev-1'], ['settle', 'unknown'], ['begin', 'dev-1'], ['settle', 'unknown']]);
});

test('closing the dialog before the answer still settles the hold', async () => {
  for (const [answer, held] of [[unknown, true], [refused('E_LIFECYCLE_BUSY'), false]]) {
    const tracker = logged(), gate = deferred(), events = [];
    const confirmation = createLifecycleConfirmation({ target, operation: 'retire', terms, retires: tracker.retires, onChange: event => events.push(event),
      request: async body => body.action === 'plan' ? { ...planned('retire', reference(1)), options: body.options } : gate.promise });
    await tick(); confirmation.apply(); confirmation.close();
    const told = events.length;
    gate.resolve(answer); await tick();
    assert.deepEqual(tracker.log, [['begin', 'dev-1'], ['settle', answer.status]], answer.status);
    assert.equal(tracker.holds(), held, `${answer.status}: settled though closed`);
    assert.equal(events.length, told, `${answer.status}: the closed confirmation is told nothing`);
  }
});

test('a tracker that throws changes nothing of the apply: the hold is a drawing aid only', async () => {
  for (const retires of [{ begin: () => { throw new Error('begin'); } }, { begin: () => ({ settle: () => { throw new Error('settle'); } }) }, { begin: () => null }, {}]) {
    const sent = [];
    const c = createLifecycleConfirmation({ target, operation: 'retire', terms, retires,
      request: async body => { sent.push(body); return body.action === 'plan' ? { ...planned('retire', reference(1)), options: body.options } : refused('E_INSTANCE_RETIRING'); } });
    await tick(); assert.equal(c.apply(), true); await tick();
    assert.equal(c.state().outcome, 'refused'); assert.equal(sent.filter(b => b.action === 'apply').length, 1);
  }
});
