// Whose tree `work/` is, read from a retire plan's `facts.ownWorktree` (awebai/oats#1071, the reader of #988).
// The record's work mode can disagree with what is at `work/` (#962, #973), so a kernel that lists the feature
// `retire-plan-own-worktree` says it as a fact, and one function of the shared home answers it for every
// reader: ownWorktreeOf (packages/client/lifecycle-contract.mjs).
//
//   1. the reader, lifecyclePlan, by the features of the kernel that answered: the table below, called
//      directly and through the server's boundary, for a local plan and for one relayed from a server;
//   2. the function, and the one check of the discard choice that reads it;
//   3. the server's refusal of a choice that does not apply, raised before any apply command;
//   4. the Remove dialog's four cases: the sentences, the choice, the rows and the pull request row;
//   5. a fresh plan that flips the fact while the choice is checked;
//   6. that no other line of packages/client or packages/desktop compares a plan's work mode with a word.
//
// The kernel's own plans, read the same way, are test/desktop-own-worktree-kernel.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createLifecycleDialog } from '../renderer/lifecycle-dialog.mjs';
import { createLifecycleBoundary } from '../../client/instance-lifecycle.mjs';
import { lifecyclePlan, lifecycleChoicesApplicable, lifecycleReason, ownWorktreeOf, OWN_WORKTREE_FEATURE } from '../../client/lifecycle-contract.mjs';
import { DESKTOP_TERMS } from '../renderer/desktop-terms.mjs';
import { cli, context, envelope, instance, target, stopPlan, retirePlan, retireReceipt, session, tick } from './helpers/lifecycle-fixture.mjs';

const PROBE_FEATURES = 'server-probe-features';
// Each sentence whole, once: every assertion below names it.
const STOPS = 'Stops its session.', SAVES = `Saves a recovery copy of any uncommitted work, then deletes its home folder.${instance.home}`;
const BRANCHES = 'Branches and pull requests are not changed.';
const KEEPS = branch => `Keeps its worktree, moved aside, on branch ${branch}.`;
const DELETES = branch => `Deletes its worktree. Branch ${branch} stays in the repository.`;
const KEEPS_UNCHECKED = "Keeps its worktree, moved aside, if there is one. It couldn't be checked.";
const DELETES_UNCHECKED = "Deletes its worktree, if there is one. It couldn't be checked.";
const WARNS_UNCHECKED = "Deletes the worktree folder, if there is one, with any uncommitted changes (a recovery copy is saved first). It couldn't be checked.";
const NOT_ITS_OWN = 'It has no worktree of its own, so no worktree is kept or deleted. A tree it links to is not touched.';
const UNAVAILABLE = 'Only an instance with its own worktree can delete it. Review the choice again.';
const STALE = 'Something changed since you opened this. Review it and confirm again.';
const DRIFT = 'The worktree is on feat/work, not the branch it was spawned on (agents/dev-1).';
const UNKNOWN_WORK = "Unknown (couldn't be checked)";
/** The kernel's four reasons for work it did not observe (docs/desktop-cli-api.md, the retire plan). */
const UNOBSERVED = ['no-worktree', 'E_NO_WORKTREE', 'E_GIT_FAILED', 'E_WORK_INSPECTION_FAILED'];
/** What a record can say of the work mode: the kernel's five, none, and a word this kernel does not know. */
const RECORDS = ['worktree', 'attached', 'checkout', 'workspace', 'directory', null, 'elsewhere'];
/** A key that is there and is not a boolean. */
const NOT_BOOLEAN = [null, 'true', 'false', 1, 0, {}, []];

/** A kernel's retire plan: the fixture's (a record that says `worktree`; work observed on feat/work, 2 changed
 * and 1 untracked, drifted from the recorded agents/dev-1), with the record's `mode`, the fact `own` (not
 * given: the key is absent, as from a kernel that does not list the feature) and `work`. */
function retire({ mode = 'worktree', work, ...rest } = {}) {
  const plan = retirePlan();
  plan.facts.workMode = mode;
  if (Object.hasOwn(rest, 'own')) plan.facts.ownWorktree = rest.own;
  if (work) plan.facts.work = work;
  plan.defaults.retainWorktree = typeof rest.own === 'boolean' ? rest.own : mode === 'worktree';
  return plan;
}
const unobserved = reason => ({ observed: false, reason });
const has = plan => Object.hasOwn(plan.facts, 'ownWorktree');
const choices = { discardWorktree: false };

// ── 1. The reader ─────────────────────────────────────────────────────────────

const LISTED = ['lifecycle-plans', OWN_WORKTREE_FEATURE], NOT_LISTED = ['lifecycle-plans'];
/** "Features not known", in every way a caller can say it: null, nothing, an empty bag, no bag, and a value that is no list. */
const NOT_KNOWN = [[{ features: null }], [{ features: undefined }], [{}], [], [{ features: OWN_WORKTREE_FEATURE }]];

test('the reader, called with the answering kernel\'s features: listed, the key is required and a boolean; not listed, it is not read; not known, it is read when it is a boolean', () => {
  const read = (raw, ...bag) => lifecyclePlan(raw, target, 'retire', choices, ...bag);
  for (const mode of RECORDS) {
    const where = `record ${mode}`;
    // Listed: a boolean is the plan's fact, whatever the record says; anything else is no plan.
    for (const own of [true, false]) {
      const plan = read(retire({ mode, own }), { features: LISTED });
      assert.ok(plan, `${where}, listed, ${own}`);
      assert.equal(plan.facts.ownWorktree, own, `${where}, listed, ${own}`);
      assert.equal(plan.facts.workMode, mode, 'the record\'s value is kept as it came');
    }
    assert.equal(read(retire({ mode }), { features: LISTED }), null, `${where}, listed, the key missing: malformed`);
    for (const own of NOT_BOOLEAN) assert.equal(read(retire({ mode, own }), { features: LISTED }), null, `${where}, listed, ${JSON.stringify(own)}: malformed`);
    // Not listed: the key is not read, whatever it holds, and the plan is the one read without it.
    const without = read(retire({ mode }), { features: NOT_LISTED });
    assert.ok(without && !has(without), `${where}, not listed, no key`);
    for (const features of [NOT_LISTED, []]) for (const own of [true, false, ...NOT_BOOLEAN]) {
      const plan = read(retire({ mode, own }), { features });
      assert.ok(plan, `${where}, not listed, ${JSON.stringify(own)}`);
      assert.equal(has(plan), false, `${where}, not listed, ${JSON.stringify(own)}: not read`);
      assert.deepEqual({ ...plan, defaults: null }, { ...without, defaults: null }, 'the plan a kernel without the key gives');
    }
    // Not known: read when it is there as a boolean; missing or anything else, the plan has none.
    for (const bag of NOT_KNOWN) {
      for (const own of [true, false]) assert.equal(read(retire({ mode, own }), ...bag)?.facts.ownWorktree, own, `${where}, not known ${JSON.stringify(bag)}, ${own}`);
      for (const raw of [retire({ mode }), ...NOT_BOOLEAN.map(own => retire({ mode, own }))]) {
        const plan = read(raw, ...bag);
        assert.ok(plan, `${where}, not known ${JSON.stringify(bag)}, ${JSON.stringify(raw.facts.ownWorktree)}: still a plan`);
        assert.equal(has(plan), false, `${where}, not known ${JSON.stringify(bag)}, ${JSON.stringify(raw.facts.ownWorktree)}: the plan has none`);
      }
    }
  }
  // The key sits in `facts` and nowhere else: one written beside `facts`, or in `defaults`, is not it.
  const elsewhere = retire(); elsewhere.ownWorktree = false; elsewhere.defaults.ownWorktree = false;
  assert.equal(read(elsewhere, { features: LISTED }), null, 'listed: a key outside facts does not stand for it');
  assert.equal(has(read(elsewhere, { features: null })), false);
  assert.doesNotMatch(JSON.stringify(read(elsewhere, { features: null })), /ownWorktree/);
});

test('a stop plan carries no such key and none is read, whatever the kernel lists', () => {
  for (const bag of [[{ features: LISTED }], [{ features: NOT_LISTED }], ...NOT_KNOWN]) {
    const plain = lifecyclePlan(stopPlan(), target, 'stop', { recursive: true }, ...bag);
    assert.ok(plain, `a stop plan from a kernel that lists the word has no key and is a plan (${JSON.stringify(bag)})`);
    const carrying = stopPlan(); carrying.ownWorktree = false; carrying.facts = { ownWorktree: false }; carrying.targets[0].ownWorktree = false;
    const read = lifecyclePlan(carrying, target, 'stop', { recursive: true }, ...bag);
    assert.deepEqual(read, plain, 'and one written into it is dropped');
    assert.doesNotMatch(JSON.stringify(read), /ownWorktree/);
  }
});

test('the projection holds the key exactly when it was read, and the renderer\'s second pass (no features) reads the projection as it is', () => {
  for (const [features, raw, held] of [[LISTED, retire({ own: true }), true], [LISTED, retire({ own: false }), true], [NOT_LISTED, retire({ own: false }), false],
    [NOT_LISTED, retire(), false], [null, retire({ own: false }), true], [null, retire({ own: 'false' }), false], [null, retire(), false]]) {
    const projected = structuredClone(lifecyclePlan(raw, target, 'retire', choices, { features }));
    assert.equal(has(projected), held, `${JSON.stringify(features)}, ${JSON.stringify(raw.facts.ownWorktree)}`);
    assert.deepEqual(Object.keys(projected.facts).includes('ownWorktree'), held, 'no key that holds undefined');
    assert.deepEqual(lifecyclePlan(projected, target, 'retire', choices), projected, 'the second pass');
    assert.deepEqual(ownWorktreeOf(lifecyclePlan(projected, target, 'retire', choices)), ownWorktreeOf(projected));
  }
});

// ── 2. The function ───────────────────────────────────────────────────────────

test('ownWorktreeOf: the fact when the plan has it, whatever the record says; else the record, as before the fact', () => {
  const read = raw => lifecyclePlan(raw, target, 'retire', choices);
  for (const mode of RECORDS) {
    for (const own of [true, false]) assert.deepEqual(ownWorktreeOf(read(retire({ mode, own }))), { own, from: 'fact' }, `record ${mode}, fact ${own}`);
    assert.deepEqual(ownWorktreeOf(read(retire({ mode }))), { own: mode === 'worktree', from: 'record' }, `record ${mode}, no fact`);
  }
  // Unobserved work changes nothing of whose tree it is.
  for (const reason of UNOBSERVED) {
    assert.deepEqual(ownWorktreeOf(read(retire({ own: true, work: unobserved(reason) }))), { own: true, from: 'fact' }, reason);
    assert.deepEqual(ownWorktreeOf(read(retire({ mode: 'attached', own: false, work: unobserved(reason) }))), { own: false, from: 'fact' }, reason);
  }
  // `defaults.retainWorktree` is the default of an option and is never read as the fact.
  for (const retainWorktree of [true, false]) {
    const withFact = retire({ own: true }), without = retire({ mode: 'attached' });
    withFact.defaults.retainWorktree = retainWorktree; without.defaults.retainWorktree = retainWorktree;
    assert.deepEqual(ownWorktreeOf(read(withFact)), { own: true, from: 'fact' });
    assert.deepEqual(ownWorktreeOf(read(without)), { own: false, from: 'record' });
  }
  // Nor are the plan's notes, whatever they say.
  const noted = retire({ own: true }); noted.notes = ['work/ is a link and not a work tree of the instance\'s own'];
  assert.deepEqual(ownWorktreeOf(read(noted)), { own: true, from: 'fact' });
});

test('lifecycleChoicesApplicable: deleting the worktree applies exactly when the function says the tree is the instance\'s own; a stop\'s choice always applies', () => {
  const read = raw => lifecyclePlan(raw, target, 'retire', choices);
  for (const mode of RECORDS) {
    for (const own of [true, false]) {
      assert.equal(lifecycleChoicesApplicable(read(retire({ mode, own })), { discardWorktree: true }), own, `record ${mode}, fact ${own}`);
      assert.equal(lifecycleChoicesApplicable(read(retire({ mode, own })), { discardWorktree: false }), true, 'keeping it always applies');
    }
    assert.equal(lifecycleChoicesApplicable(read(retire({ mode })), { discardWorktree: true }), mode === 'worktree', `record ${mode}, no fact`);
  }
  for (const recursive of [true, false]) assert.equal(lifecycleChoicesApplicable(lifecyclePlan(stopPlan(recursive), target, 'stop', { recursive }), { recursive }), true);
});

// ── The server's boundary: which kernel answers decides how its plan is read ──────────────────────────

const localContext = (features = []) => { const ctx = context(); ctx.cli.features.push(...features); return ctx; };
/** A routed context: this computer's CLI names `local`, and the host's roster group reports `probe`. */
const routedContext = ({ local = [PROBE_FEATURES], probe } = {}) => ({ cli: { ...structuredClone(cli), features: [...cli.features, ...local], remote: ['lifecycle-plans'] }, localCwd: '/Users/me/work',
  workspace: { id: 'team', name: 'Build box', scope: '/srv', remote: true, server: 'build', group: probe === undefined ? {} : { probe } },
  instances: [{ ...instance, server: 'build', addressable: true, missingRemotely: false, savedRoute: false, running: true }] });
/** Each kernel that can answer, with how its plan is read. A relayed plan is held to its host's list: this computer's says nothing of it. */
const KERNELS = [
  ['local, the CLI lists the word', () => localContext([OWN_WORKTREE_FEATURE]), 'listed'],
  ['local, the CLI does not list it', () => localContext(), 'not listed'],
  ['relayed, the host lists the word and this computer does not', () => routedContext({ probe: { ok: true, features: [...NOT_LISTED, OWN_WORKTREE_FEATURE] } }), 'listed'],
  ['relayed, this computer lists the word and the host does not', () => routedContext({ local: [PROBE_FEATURES, OWN_WORKTREE_FEATURE], probe: { ok: true, features: NOT_LISTED } }), 'not listed'],
  ['relayed, a host whose features are not known (features: null)', () => routedContext({ local: [PROBE_FEATURES, OWN_WORKTREE_FEATURE], probe: { ok: true, features: null } }), 'not known'],
  ['relayed, a failed roster read', () => routedContext({ local: [PROBE_FEATURES, OWN_WORKTREE_FEATURE], probe: { ok: false, features: [OWN_WORKTREE_FEATURE] } }), 'not known'],
  ['relayed, no probe', () => routedContext({ local: [PROBE_FEATURES, OWN_WORKTREE_FEATURE] }), 'not known'],
  ['relayed, this computer\'s CLI does not relay the hosts\' lists', () => routedContext({ local: [OWN_WORKTREE_FEATURE], probe: { ok: true, features: NOT_LISTED } }), 'not known'],
];
/** What a plan carries in the key, and how each kind of kernel's plan is then read: the fact, 'none' (a plan without it) or 'malformed' (no plan). */
const KEYS = [
  ['true', p => { p.facts.ownWorktree = true; }, { listed: true, 'not listed': 'none', 'not known': true }],
  ['false', p => { p.facts.ownWorktree = false; }, { listed: false, 'not listed': 'none', 'not known': false }],
  ['missing', () => {}, { listed: 'malformed', 'not listed': 'none', 'not known': 'none' }],
  ['null', p => { p.facts.ownWorktree = null; }, { listed: 'malformed', 'not listed': 'none', 'not known': 'none' }],
  ['the word "true"', p => { p.facts.ownWorktree = 'true'; }, { listed: 'malformed', 'not listed': 'none', 'not known': 'none' }],
];
const selectorOf = ctx => ({ instance: instance.instance, agent: instance.agent, agentsRoot: instance.agentsRoot, server: ctx.workspace.server ?? null });
const planRequest = (ctx, options = choices) => ({ action: 'plan', operation: 'retire', selector: selectorOf(ctx), options });
/** The kernel's error envelope as the adapter passes it on (`origin: 'kernel'`). */
const refused = (code, details) => ({ schemaVersion: 1, ok: false, origin: 'kernel', error: { code, message: 'a stand-in for the kernel message', details } });
const keyed = change => { const plan = retire(); change(plan); return plan; };
const assertRead = (plan, expected, where) => {
  assert.ok(plan, where);
  if (expected === 'none') assert.equal(has(plan), false, `${where}: the plan has no key`);
  else assert.equal(plan.facts.ownWorktree, expected, `${where}: the plan's fact`);
  assert.equal(Object.values(plan.facts).includes(undefined), false, `${where}: no key that holds undefined`);
};

test('the boundary, a plan: read by the features of the kernel that answered, local or relayed; a malformed fact is no plan', async () => {
  for (const [name, ctx, kind] of KERNELS) for (const [key, change, reads] of KEYS) {
    const c = ctx(), where = `${name}; the key is ${key}`;
    const service = createLifecycleBoundary({ terms: DESKTOP_TERMS, invoke: async () => envelope(keyed(change)) });
    const reply = await service(planRequest(c), () => c);
    if (reads[kind] === 'malformed') {
      assert.equal(reply.status, 'unavailable', where); assert.equal(reply.reason.code, 'E_CLI_PROTOCOL', where);
      assert.equal(reply.plan, null, where); assert.equal(reply.planRef, null, `${where}: nothing to confirm`);
    } else {
      assert.equal(reply.status, 'plan', `${where}: ${JSON.stringify(reply.reason)}`);
      assertRead(reply.plan, reads[kind], where);
      // The renderer's pass over the reply: it has no features, and reads what the server read.
      assert.deepEqual(lifecyclePlan(reply.plan, reply.target, 'retire', choices), reply.plan, where);
    }
  }
});

test('the boundary, the fresh plan of E_PLAN_STALE: read by the same rule, and a malformed one leaves an unknown outcome and no plan to confirm', async () => {
  for (const [name, ctx, kind] of KERNELS) for (const [key, change, reads] of KEYS) {
    const c = ctx(), where = `${name}; the fresh plan's key is ${key}`;
    const fresh = keyed(change); fresh.planRevision = 'c'.repeat(24);
    // The first plan is one this kernel's rule accepts: it carries the fact.
    const service = createLifecycleBoundary({ terms: DESKTOP_TERMS, invoke: async (_bin, args) => args.phase === 'plan' ? envelope(retire({ own: true })) : refused('E_PLAN_STALE', { plan: fresh }) });
    const planned = await service(planRequest(c), () => c);
    assert.equal(planned.status, 'plan', where);
    const reply = await service({ action: 'apply', planRef: planned.planRef }, () => c);
    if (reads[kind] === 'malformed') {
      assert.equal(reply.status, 'unknown', where); assert.equal(reply.reason.code, 'E_OUTCOME_UNKNOWN', where);
      assert.equal(reply.cause.code, 'E_CLI_PROTOCOL', where); assert.equal(reply.plan, null, where);
    } else {
      assert.equal(reply.status, 'stale', `${where}: ${JSON.stringify(reply.reason)}`);
      assert.notEqual(reply.planRef, planned.planRef, `${where}: a new reference`);
      assert.equal(reply.plan.planRevision, fresh.planRevision);
      assertRead(reply.plan, reads[kind], where);
    }
  }
});

test('the boundary, the plan of E_CHILDREN_RUNNING: read by the same rule', async () => {
  const kid = { instance: 'kid', agent: 'dev', home: '/team/agents/dev/instances/kid' };
  for (const [name, ctx, kind] of KERNELS) for (const [key, change, reads] of KEYS) {
    const c = ctx(), where = `${name}; the refused plan's key is ${key}`;
    const withKid = plan => { plan.facts.children = [{ ...kid, session: session() }]; return plan; };
    const answer = refused('E_CHILDREN_RUNNING', { plan: withKid(keyed(change)), childrenStopped: [{ ...kid, ok: false, code: 'E_SESSION_STOP_FAILED', stillRunning: [4242] }] });
    const service = createLifecycleBoundary({ terms: DESKTOP_TERMS, invoke: async (_bin, args) => args.phase === 'plan' ? envelope(withKid(retire({ own: true }))) : answer });
    const planned = await service(planRequest(c), () => c);
    assert.equal(planned.status, 'plan', where);
    const reply = await service({ action: 'apply', planRef: planned.planRef }, () => c);
    if (reads[kind] === 'malformed') { assert.equal(reply.status, 'unknown', where); assert.equal(reply.reason.code, 'E_OUTCOME_UNKNOWN', where); assert.equal(reply.plan, null, where); }
    else { assert.equal(reply.status, 'refused', `${where}: ${JSON.stringify(reply.reason)}`); assert.equal(reply.reason.code, 'E_CHILDREN_RUNNING', where); assertRead(reply.plan, reads[kind], where); }
  }
});

// ── 3. The server's refusal of a choice that does not apply ───────────────────

test('deleting the worktree is authorized by the fact where the plan has it: refused before any apply command for a tree that is not the instance\'s, whatever the record says', async () => {
  const discard = { discardWorktree: true };
  const boundary = (raw, calls) => createLifecycleBoundary({ terms: DESKTOP_TERMS, invoke: async (_bin, args) => { calls.push(structuredClone(args)); return envelope(args.phase === 'plan' ? raw : retireReceipt(args)); } });
  for (const mode of RECORDS) {
    // The fact is false: refused, under a record that says `worktree` too (a link, a directory of the home: #962, #973).
    const c = localContext([OWN_WORKTREE_FEATURE]), calls = [], service = boundary(retire({ mode, own: false }), calls);
    const planned = await service(planRequest(c, discard), () => c);
    assert.equal(planned.status, 'plan', `record ${mode}: a plan can be read with the choice, as today`);
    const reply = await service({ action: 'apply', planRef: planned.planRef }, () => c);
    assert.deepEqual(reply.reason, lifecycleReason('E_OPTION_UNAVAILABLE', DESKTOP_TERMS), `record ${mode}, fact false`);
    assert.equal(reply.reason.message, UNAVAILABLE);
    assert.deepEqual(calls.map(call => call.phase), ['plan'], `record ${mode}, fact false: no apply command`);
    // The fact is true: authorized, under a record that does not say `worktree` too (no work mode and a registered tree: #962).
    const own = [], allowed = boundary(retire({ mode, own: true }), own);
    const ok = await allowed(planRequest(c, discard), () => c);
    assert.equal((await allowed({ action: 'apply', planRef: ok.planRef }, () => c)).status, 'complete', `record ${mode}, fact true`);
    assert.deepEqual(own.map(call => [call.phase, call.choices.discardWorktree]), [['plan', true], ['apply', true]]);
  }
  // Unobserved work does not make the choice unavailable: it needs an owned worktree and nothing else.
  for (const reason of UNOBSERVED) {
    const c = localContext([OWN_WORKTREE_FEATURE]), calls = [], service = boundary(retire({ own: true, work: unobserved(reason) }), calls);
    const planned = await service(planRequest(c, discard), () => c);
    assert.equal((await service({ action: 'apply', planRef: planned.planRef }, () => c)).status, 'complete', reason);
  }
  // A kernel that does not list the word: its key is not read, and the record decides, as today.
  for (const [mode, applies] of [['worktree', true], ['attached', false]]) {
    const c = localContext(), calls = [], service = boundary(retire({ mode, own: !applies }), calls);
    const planned = await service(planRequest(c, discard), () => c);
    const reply = await service({ action: 'apply', planRef: planned.planRef }, () => c);
    assert.equal(applies ? reply.status : reply.reason.code, applies ? 'complete' : 'E_OPTION_UNAVAILABLE', `not listed, record ${mode}`);
  }
});

test('a stale apply whose fresh plan says the tree is not the instance\'s: the new reference cannot delete it, and no further command runs', async () => {
  for (const [name, ctx] of KERNELS.filter(([, , kind]) => kind === 'listed')) {
    const c = ctx(), calls = [], fresh = retire({ own: false }); fresh.planRevision = 'c'.repeat(24);
    const service = createLifecycleBoundary({ terms: DESKTOP_TERMS, invoke: async (_bin, args) => { calls.push(args.phase); return args.phase === 'plan' ? envelope(retire({ own: true })) : refused('E_PLAN_STALE', { plan: fresh }); } });
    const planned = await service(planRequest(c, { discardWorktree: true }), () => c);
    const stale = await service({ action: 'apply', planRef: planned.planRef }, () => c);
    assert.equal(stale.status, 'stale', name); assert.equal(stale.plan.facts.ownWorktree, false, name); assert.deepEqual(stale.options, { discardWorktree: true }, name);
    const again = await service({ action: 'apply', planRef: stale.planRef }, () => c);
    assert.equal(again.reason.code, 'E_OPTION_UNAVAILABLE', name); assert.equal(again.reason.message, UNAVAILABLE);
    assert.deepEqual(calls, ['plan', 'apply'], `${name}: the refused confirmation ran nothing`);
  }
});

// ── 4. The dialog ─────────────────────────────────────────────────────────────

const reference = 'd'.repeat(64), newReference = 'e'.repeat(64);
const planned = (raw, body, planRef = reference) => ({ lifecycleApi: 1, status: 'plan', target, planRef, plan: structuredClone(raw), options: body.options, receipt: null, reason: null });
/** A Remove dialog over `answer(body, calls)`, with a forge that answers "no pull request" for the fixture's tree and counts its reads. */
function mount(t, answer) {
  const dom = new JSDOM('<!doctype html><button id="opener">Actions</button>', { pretendToBeVisual: true }), doc = dom.window.document;
  const calls = [], reads = { git: 0, forge: 0 }; let connectionsChanged = () => {};
  const observation = { revision: 'a'.repeat(40), branch: 'feat/work' };
  const dialog = createLifecycleDialog({ doc, subscribeConnections: fn => { connectionsChanged = fn; return () => {}; },
    request: async (_workspace, body) => { calls.push(structuredClone(body)); return answer(body, calls); },
    gitRequest: async () => { reads.git++; return { target, status: 'available', observationKey: reference, data: { observation } }; },
    forgeRequest: async () => { reads.forge++; return { forgeApi: 1, target, status: 'no-pull-request', data: null, observation: { key: reference, ...observation }, host: 'github.com', repository: 'owner/repo' }; } });
  t.after(() => { dialog.dispose(); dom.window.close(); });
  const one = selector => doc.querySelector(selector), all = selector => [...doc.querySelectorAll(selector)];
  return { doc, calls, reads, connectionsChanged: () => connectionsChanged(),
    open: async () => { dialog.open({ operation: 'retire', instance, workspace: 'team' }); await settled(); },
    title: () => one('.lifecycle-dialog h2').textContent, status: () => one('.lifecycle-dialog [role=status]').textContent,
    happen: () => all('.lifecycle-happen li').map(li => li.textContent),
    rows: () => all('.lifecycle-facts dt').map(dt => [dt.textContent, dt.nextElementSibling.textContent]),
    notes: () => all('.lifecycle-facts p').map(p => p.textContent),
    forge: () => one('.lifecycle-forge').textContent,
    options: () => one('.lifecycle-options'), discard: () => all('.lifecycle-dialog input')[1], warning: () => one('.lifecycle-warning'),
    confirm: () => one('.lifecycle-confirm'), checkAgain: () => one('.lifecycle-check'),
    /** Whether "Also delete the worktree" is on screen. */
    offered: () => !one('.lifecycle-options').hidden && !all('.lifecycle-dialog input')[1].parentElement.hidden,
    check: async checked => { const input = all('.lifecycle-dialog input')[1]; input.checked = checked; input.dispatchEvent(new dom.window.Event('change')); await settled(); },
    /** Everything a person or a screen reader is told: the text, and every attribute that is read out or shown on hover. */
    told: () => [doc.body.textContent, ...all('*').flatMap(el => ['title', 'aria-label', 'aria-description', 'placeholder', 'value', 'alt'].map(name => el.getAttribute(name)).filter(Boolean))].join('\n') };
}
/** Long enough for a plan to land and for the Git and forge reads behind it to answer. */
const settled = async () => { for (let i = 0; i < 6; i++) await tick(); };

test('case 1, the fact is true and work/ was read: today\'s sentences, the choice, the rows and the pull request row, whatever the record says', async t => {
  for (const mode of RECORDS) {
    const f = mount(t, body => planned(retire({ mode, own: true }), body)), where = `record ${mode}`;
    await f.open();
    assert.deepEqual(f.happen(), [STOPS, SAVES, KEEPS('feat/work'), BRANCHES], where);
    assert.equal(f.offered(), true, where);
    assert.deepEqual(f.rows(), [['Session', 'Running'], ['Uncommitted work', '2 changed, 1 untracked'], ['Branch', 'feat/work']], where);
    assert.deepEqual(f.notes(), [DRIFT], where);
    assert.equal(f.forge(), 'Pull requestNone for this branch', where); assert.deepEqual(f.reads, { git: 1, forge: 1 }, where);
    await f.check(true);
    assert.deepEqual(f.happen(), [STOPS, SAVES, DELETES('feat/work'), BRANCHES], where);
    assert.equal(f.warning().hidden, false, where);
    assert.equal(f.warning().textContent, 'Deletes the worktree folder, including 3 uncommitted changes (a recovery copy is saved first). Branch feat/work stays in the repository.', where);
    assert.equal(f.confirm().disabled, false, where); assert.equal(f.status(), '', where);
  }
});

test('case 2, the fact is true and work/ could not be read: the sentences promise no tree and name no branch; the choice stays, and its warning says the same', async t => {
  for (const reason of UNOBSERVED) for (const mode of ['worktree', 'attached', null]) {
    const f = mount(t, body => planned(retire({ mode, own: true, work: unobserved(reason) }), body)), where = `${reason}, record ${mode}`;
    await f.open();
    assert.deepEqual(f.happen(), [STOPS, SAVES, KEEPS_UNCHECKED, BRANCHES], where);
    assert.equal(f.offered(), true, where);
    assert.deepEqual(f.rows(), [['Session', 'Running'], ['Uncommitted work', UNKNOWN_WORK]], where);
    assert.equal(f.doc.querySelectorAll('.lifecycle-facts dd')[1].title, reason, `${where}: the reason only in the row's title, as today`);
    assert.deepEqual(f.notes(), [], where);
    assert.equal(f.forge(), '', where); assert.deepEqual(f.reads, { git: 0, forge: 0 }, `${where}: nothing to correlate a pull request with`);
    // The only branch known there is the record's: it is named nowhere.
    assert.doesNotMatch(f.told(), /agents\/dev-1|on branch|stays in the repository/, where);
    await f.check(true);
    assert.deepEqual(f.happen(), [STOPS, SAVES, DELETES_UNCHECKED, BRANCHES], where);
    assert.equal(f.warning().hidden, false, where); assert.equal(f.warning().textContent, WARNS_UNCHECKED, where);
    assert.doesNotMatch(f.told(), /agents\/dev-1|on branch|stays in the repository/, where);
    assert.equal(f.confirm().disabled, false, `${where}: the choice applies`); assert.equal(f.status(), '', where);
  }
});

/** Homes the kernel answers `false` for: a link under a record that says `worktree` (#973) and an attached
 * instance, each over a tree with uncommitted work on another branch; a directory instance; a record that
 * says `worktree` over work that could not be read. */
const NOT_OWN = [['a link under a worktree record', { mode: 'worktree', own: false }], ['an attached instance', { mode: 'attached', own: false }],
  ['a checkout instance', { mode: 'checkout', own: false }], ['no work mode', { mode: null, own: false }],
  ['a directory instance', { mode: 'directory', own: false, work: unobserved('E_NO_WORKTREE') }],
  ['a worktree record, work not read', { mode: 'worktree', own: false, work: unobserved('E_GIT_FAILED') }]];

test('case 3, the fact is false: one sentence in the place of the worktree line, and the choice is not offered', async t => {
  for (const [name, shape] of NOT_OWN) {
    const f = mount(t, body => planned(retire(shape), body));
    await f.open();
    assert.deepEqual(f.happen(), [STOPS, SAVES, NOT_ITS_OWN, BRANCHES], name);
    assert.equal(f.options().hidden, true, `${name}: no choice to make, so no checkbox`);
    assert.equal(f.offered(), false, name);
    assert.doesNotMatch(f.told(), /Keeps its worktree|Deletes its worktree|moved aside|Deletes the worktree folder/, name);
    assert.equal(f.warning().hidden, true, name);
    assert.equal(f.confirm().disabled, false, `${name}: the retire itself can be confirmed`); assert.equal(f.status(), '', name);
  }
});

test('case 3, the fact is false: no row of facts.work (no Uncommitted work, no Branch, no drift sentence) and no pull request row; no Git or forge read is made', async t => {
  for (const [name, shape] of NOT_OWN) {
    const f = mount(t, body => planned(retire(shape), body));
    await f.open();
    assert.deepEqual(f.rows(), [['Session', 'Running']], name);
    assert.deepEqual(f.notes(), [], `${name}: no drift sentence`);
    assert.equal(f.forge(), '', name); assert.deepEqual(f.reads, { git: 0, forge: 0 }, `${name}: no read for a tree that is not the instance's`);
    // Nothing of another instance's tree is told: its counts, its branch, the branch of the record, a reason code.
    assert.doesNotMatch(f.told(), /Uncommitted work|\d+ changed|untracked|feat\/work|agents\/dev-1|spawned on|Pull request|E_NO_WORKTREE|E_GIT_FAILED|couldn't be checked/, name);
    // A new forge account asks nothing either.
    f.connectionsChanged(); await settled();
    assert.equal(f.forge(), '', name); assert.deepEqual(f.reads, { git: 0, forge: 0 }, `${name}: after a connection change`);
  }
});

test('a pull request row on screen leaves at once when a fresh plan says the tree is not the instance\'s, and nothing is read for it', async t => {
  let own = true;
  const f = mount(t, body => planned(retire({ own }), body));
  await f.open();
  assert.equal(f.forge(), 'Pull requestNone for this branch'); assert.deepEqual(f.reads, { git: 1, forge: 1 });
  // The same revision, branch and remote: only the fact changed.
  own = false; f.checkAgain().click(); await settled();
  assert.equal(f.forge(), ''); assert.deepEqual(f.reads, { git: 1, forge: 1 }, 'no read after the swap');
  assert.deepEqual(f.rows(), [['Session', 'Running']]);
  // And back: the row is read again for the instance's own tree.
  own = true; f.checkAgain().click(); await settled();
  assert.equal(f.forge(), 'Pull requestNone for this branch'); assert.deepEqual(f.reads, { git: 2, forge: 2 });
});

test('case 4, no fact (a kernel that does not list the word): every sentence and every row as today, from the record', async t => {
  // A record that says `worktree`, work read.
  const own = mount(t, body => planned(retire(), body));
  await own.open();
  assert.deepEqual(own.happen(), [STOPS, SAVES, KEEPS('feat/work'), BRANCHES]); assert.equal(own.offered(), true);
  assert.deepEqual(own.rows(), [['Session', 'Running'], ['Uncommitted work', '2 changed, 1 untracked'], ['Branch', 'feat/work']]);
  assert.deepEqual(own.notes(), [DRIFT]); assert.equal(own.forge(), 'Pull requestNone for this branch');
  // A record that says `worktree`, work not read: the record's branch, as today.
  const unread = mount(t, body => planned(retire({ work: unobserved('E_NO_WORKTREE') }), body));
  await unread.open();
  assert.deepEqual(unread.happen(), [STOPS, SAVES, KEEPS('agents/dev-1'), BRANCHES]); assert.equal(unread.offered(), true);
  assert.deepEqual(unread.rows(), [['Session', 'Running'], ['Uncommitted work', UNKNOWN_WORK]]);
  await unread.check(true);
  assert.deepEqual(unread.happen(), [STOPS, SAVES, DELETES('agents/dev-1'), BRANCHES]);
  assert.equal(unread.warning().textContent, 'Deletes the worktree folder, including uncommitted changes, if any (a recovery copy is saved first). Branch agents/dev-1 stays in the repository.');
  // An attached instance whose owner's tree has uncommitted work: the rows of that tree and its pull request row stay.
  for (const mode of ['attached', 'checkout', 'workspace', null]) {
    const attached = mount(t, body => planned(retire({ mode }), body));
    await attached.open();
    assert.deepEqual(attached.happen(), [STOPS, SAVES, BRANCHES], `record ${mode}: no worktree line, and not the sentence of a fact`);
    assert.equal(attached.offered(), false, `record ${mode}`);
    assert.deepEqual(attached.rows(), [['Session', 'Running'], ['Uncommitted work', '2 changed, 1 untracked'], ['Branch', 'feat/work']], `record ${mode}`);
    assert.deepEqual(attached.notes(), [DRIFT], `record ${mode}`);
    assert.equal(attached.forge(), 'Pull requestNone for this branch', `record ${mode}`); assert.deepEqual(attached.reads, { git: 1, forge: 1 }, `record ${mode}`);
  }
  // A directory instance, work not read: no row for it, as today.
  const directory = mount(t, body => planned(retire({ mode: 'directory', work: unobserved('E_NO_WORKTREE') }), body));
  await directory.open();
  assert.deepEqual(directory.happen(), [STOPS, SAVES, BRANCHES]); assert.deepEqual(directory.rows(), [['Session', 'Running']]); assert.equal(directory.offered(), false);
  // A stale choice over a record that is not `worktree` keeps today's warning: this change is for a plan with the fact.
  let mode = 'worktree';
  const stale = mount(t, body => planned(retire({ mode }), body));
  await stale.open(); await stale.check(true);
  mode = 'attached'; stale.checkAgain().click(); await settled();
  assert.equal(stale.status(), UNAVAILABLE); assert.equal(stale.confirm().disabled, true);
  assert.equal(stale.warning().textContent, 'Deletes the worktree folder, including 3 uncommitted changes (a recovery copy is saved first). Branch feat/work stays in the repository.');
});

// ── 5. A fresh plan flips the fact while the choice is checked ────────────────

test('a fresh plan after E_PLAN_STALE says the tree is not the instance\'s while "Also delete the worktree" is checked: the choice stays so it can be undone, the status says why, and no warning stands under it', async t => {
  const f = mount(t, (body, calls) => {
    if (body.action === 'plan') return planned(retire({ own: !calls.some(call => call.action === 'apply') }), body, calls.some(call => call.action === 'apply') ? 'f'.repeat(64) : reference);
    return { ...planned(retire({ own: false }), { options: { discardWorktree: true } }, newReference), status: 'stale', reason: { code: 'E_PLAN_STALE' } };
  });
  await f.open(); await f.check(true);
  assert.equal(f.warning().hidden, false, 'premise: the warning of the instance\'s own tree is on screen');
  f.confirm().click(); await settled();
  assert.deepEqual(f.calls.map(call => call.action), ['plan', 'plan', 'apply']);
  assert.equal(f.title(), 'Retire dev-1?', 'back in review');
  assert.equal(f.status(), UNAVAILABLE, 'the status says why this cannot be confirmed');
  assert.equal(f.confirm().disabled, true); assert.equal(f.confirm().getAttribute('aria-describedby'), f.doc.querySelector('.lifecycle-status').id);
  assert.equal(f.offered(), true, 'the choice stays on screen'); assert.equal(f.discard().checked, true); assert.equal(f.discard().disabled, false, 'and can be undone');
  assert.equal(f.warning().hidden, true, 'no warning under it'); assert.equal(f.warning().textContent, '');
  assert.deepEqual(f.happen(), [STOPS, SAVES, NOT_ITS_OWN, BRANCHES]);
  assert.doesNotMatch(f.told(), /Deletes its worktree|Deletes the worktree folder|uncommitted changes|stays in the repository/, 'nothing promises a deletion, or counts another tree\'s changes');
  // It never applies by itself, and the disabled confirm submits nothing.
  f.confirm().click(); await settled();
  assert.deepEqual(f.calls.map(call => call.action), ['plan', 'plan', 'apply']);
  // Undoing the choice reads a plan without it, and the retire can be confirmed.
  await f.check(false);
  assert.deepEqual(f.calls.at(-1), { action: 'plan', operation: 'retire', selector: f.calls[0].selector, options: { discardWorktree: false } });
  assert.equal(f.status(), ''); assert.equal(f.confirm().disabled, false); assert.equal(f.offered(), false, 'nothing to choose any more');
  assert.deepEqual(f.happen(), [STOPS, SAVES, NOT_ITS_OWN, BRANCHES]);
});

test('Check again says the tree is not the instance\'s while the choice is checked: the same; and a fresh plan whose tree could not be read swaps in the warning that promises none', async t => {
  let shape = { own: true };
  const f = mount(t, body => planned(retire(shape), body));
  await f.open(); await f.check(true);
  shape = { own: false }; f.checkAgain().click(); await settled();
  assert.equal(f.status(), UNAVAILABLE); assert.equal(f.confirm().disabled, true);
  assert.equal(f.offered(), true); assert.equal(f.discard().checked, true);
  assert.equal(f.warning().hidden, true); assert.equal(f.warning().textContent, '');
  assert.deepEqual(f.happen(), [STOPS, SAVES, NOT_ITS_OWN, BRANCHES]);
  // The instance's own tree again, and now unreadable: the choice applies, and its words promise no tree.
  shape = { own: true, work: unobserved('no-worktree') }; f.checkAgain().click(); await settled();
  assert.equal(f.status(), ''); assert.equal(f.confirm().disabled, false);
  assert.deepEqual(f.happen(), [STOPS, SAVES, DELETES_UNCHECKED, BRANCHES]);
  assert.equal(f.warning().hidden, false); assert.equal(f.warning().textContent, WARNS_UNCHECKED);
});

test('a fresh plan after E_PLAN_STALE whose tree could not be read, while the choice is checked: the stale sentence, and the words that promise no tree', async t => {
  const f = mount(t, body => body.action === 'plan' ? planned(retire({ own: true }), body)
    : { ...planned(retire({ own: true, work: unobserved('E_NO_WORKTREE') }), { options: { discardWorktree: true } }, newReference), status: 'stale', reason: { code: 'E_PLAN_STALE' } });
  await f.open(); await f.check(true); f.confirm().click(); await settled();
  assert.equal(f.status(), STALE); assert.equal(f.confirm().disabled, false);
  assert.deepEqual(f.happen(), [STOPS, SAVES, DELETES_UNCHECKED, BRANCHES]);
  assert.equal(f.warning().textContent, WARNS_UNCHECKED);
  assert.deepEqual(f.rows(), [['Session', 'Running'], ['Uncommitted work', UNKNOWN_WORK]]);
});

// ── 6. No other line compares a plan's work mode with a word ──────────────────
//
// A reading test: it reads the sources of the two packages and runs none of them. Its rule is wider than
// the sentence above, on purpose: it finds every comparison of anything named `workMode` with a word, a
// plan's or not (the Git view shows `workMode` of `oats instance git` as text and compares nothing). What
// it cannot see: a comparison through another name (`const mode = facts.workMode; mode === …`). It reads
// comments as it reads code, so a comment that spells a comparison is found too.

const REPOSITORY = fileURLToPath(new URL('../../../', import.meta.url));
const PACKAGES = ['packages/client', 'packages/desktop'];
/** Not the packages' own source: dependencies, tests, generated bundles, build output, pages that are not code. */
const NOT_SOURCE = new Set(['node_modules', 'test', 'vendor', 'dist', 'out', 'docs', 'assets']);
const NAME = String.raw`[\w$.?\[\]]*\bworkMode\b`, WORD = String.raw`['"\x60]`, IS = String.raw`(?:===|!==|==|!=)`;
/** Each way to compare the name with a word. */
const COMPARISONS = [
  new RegExp(String.raw`\bworkMode\b\s*\)*\s*${IS}\s*${WORD}`, 'g'),            // x.workMode === 'word'
  new RegExp(String.raw`${WORD}\s*${IS}\s*\(*\s*${NAME}`, 'g'),                  // 'word' === x.workMode
  new RegExp(String.raw`\.includes\(\s*${NAME}\s*[,)]`, 'g'),                    // ['word'].includes(x.workMode)
  new RegExp(String.raw`\b(?:switch|case)\b\s*\(?\s*${NAME}`, 'g'),              // switch (x.workMode)
  new RegExp(String.raw`\.(?:test|exec)\(\s*${NAME}\s*\)`, 'g'),                 // /^word/.test(x.workMode)
  new RegExp(String.raw`\bworkMode\b\s*\??\.\s*(?:startsWith|endsWith|includes|match|matchAll|search|localeCompare)\(`, 'g'), // x.workMode.startsWith('w')
];
/** Where `source` compares the name with a word: the offset of each. */
const comparisons = source => [...new Set(COMPARISONS.flatMap(pattern => [...source.matchAll(pattern)].map(match => match.index)))].sort((a, b) => a - b);
function sourcesOf(dir, found = []) {
  for (const entry of readdirSync(join(REPOSITORY, dir), { withFileTypes: true })) {
    if (entry.name.startsWith('.') || NOT_SOURCE.has(entry.name)) continue;
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) sourcesOf(path, found);
    else if (/\.(?:mjs|cjs|js|html)$/.test(entry.name)) found.push(path);
  }
  return found;
}

test('no line of packages/client or packages/desktop compares a work mode with a word, except the one function that answers whose tree it is', () => {
  const files = PACKAGES.flatMap(dir => sourcesOf(dir));
  const found = files.flatMap(path => { const source = readFileSync(join(REPOSITORY, path), 'utf8');
    return comparisons(source).map(index => ({ path, line: source.slice(0, index).split('\n').length, text: source.slice(source.lastIndexOf('\n', index) + 1).split('\n')[0].trim().slice(0, 160) })); });
  const CONTRACT = 'packages/client/lifecycle-contract.mjs', source = readFileSync(join(REPOSITORY, CONTRACT), 'utf8');
  const start = source.indexOf('export function ownWorktreeOf('), end = source.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start, 'the function is there');
  const first = source.slice(0, start).split('\n').length, last = source.slice(0, end).split('\n').length;
  assert.deepEqual(found.filter(hit => !(hit.path === CONTRACT && hit.line >= first && hit.line <= last)), [], 'a reader asks ownWorktreeOf whose tree it is');
  assert.equal(found.length, 1, 'and the function compares it once');
  // Not vacuous: the sources were read, and the readers of the name are among them.
  assert.ok(files.length > 100, `${files.length} files read`);
  for (const path of [CONTRACT, 'packages/desktop/renderer/lifecycle-dialog.mjs', 'packages/client/instance-lifecycle.mjs', 'packages/desktop/renderer/instance-git.mjs', 'packages/client/instance-git-contract.mjs'])
    assert.ok(files.includes(path), `${path} was read`);
  assert.ok(files.every(path => !path.includes('/test/') && !path.includes('node_modules')), 'only the packages\' own source');
  assert.ok(files.filter(path => /\bworkMode\b/.test(readFileSync(join(REPOSITORY, path), 'utf8'))).length >= 3, 'the name is still read where it is validated and shown');
});

test('the reading rule finds each way to compare the name with a word, and leaves alone a line that only validates, copies or shows it', () => {
  const FOUND = [
    // The two lines this change replaced, as they stood.
    "  return !choices.discardWorktree || plan.facts.workMode === 'worktree';",
    "    const option = shown && (retire() ? shown.facts.workMode === 'worktree' || choices.discardWorktree : true);",
    "    if (f.workMode === 'worktree') lines.push(line('x'));",
    "      if (f.work.observed || f.workMode === 'worktree') row('Uncommitted work', workText(f.work));",
    'if (f.workMode !== "attached") x();', 'if (plan?.facts?.workMode == `worktree`) x();', "if ('worktree' === value.facts.workMode) x();", "if ('worktree' !== (f.workMode)) x();",
    "if (['worktree', 'checkout'].includes(f.workMode)) x();", "if (OWNED.includes(plan.facts.workMode, 0)) x();", 'switch (f.workMode) { default: }', "switch (workMode) { case 'worktree': }",
    'if (/^work/.test(f.workMode)) x();', "if (f.workMode.startsWith('work')) x();", "if (f.workMode?.includes('tree')) x();", "if ((f.workMode) === 'worktree') x();",
    "// a comment that spells it: f.workMode === 'worktree'",
  ];
  for (const line of FOUND) assert.equal(comparisons(line).length >= 1, true, line);
  const NOT_FOUND = [
    "  if (!object(f) || !object(d) || !nullable(f.workMode) || !(f.repo === null || absolute(f.repo))) return null;",
    "      return i && session && work && count(t.depth) && nullable(t.workMode) && typeof t.launched === 'boolean'",
    '  return { ...common, facts: { session, work, workMode: f.workMode, repo: f.repo } };',
    "    workMode.textContent = data.workMode || '';", "  const toolbar = node('div', undefined, 'git-toolbar git-head'), workMode = node('span', '', 'git-head-aside');",
    "    || v.home !== target.home || v.agent !== target.agent || !nullable(v.workMode)", 'if (f.workMode === null) x();', 'if (f.workMode === undefined || f.workMode == null) x();',
    "const own = typeof f.ownWorktree === 'boolean' ? f.ownWorktree : null;",
  ];
  for (const line of NOT_FOUND) assert.deepEqual(comparisons(line), [], line);
});
