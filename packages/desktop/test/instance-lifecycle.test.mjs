import test from 'node:test';
import assert from 'node:assert/strict';
import { createLifecycleBoundary } from '../server/instance-lifecycle.mjs';
import { cliLifecycle, lifecycleArgv } from '../lifecycle-cli.mjs';
import { lifecycleOptions, lifecyclePlan, lifecycleReceipt, publicLifecycleReceipt, lifecycleReason, lifecycleDetailCode } from '../renderer/lifecycle-contract.mjs';
import { displayLine } from '../renderer/display-text.mjs';
import { discover } from '../cli-locator.mjs';
import { cli, target, instance, context, request, stopPlan, retirePlan, stopReceipt, retireReceipt, envelope, options, deferred, tick } from './helpers/lifecycle-fixture.mjs';
function fixture(overrides = {}) {
  const ctx = context(), calls = [];
  const invoke = async (bin, args) => { calls.push({ bin, args: structuredClone(args) }); return envelope(args.phase === 'plan'
    ? args.operation === 'stop' ? stopPlan(args.choices.recursive) : retirePlan() : args.operation === 'stop' ? stopReceipt(args) : retireReceipt(args)); };
  const service = createLifecycleBoundary({ invoke, ...overrides });
  return { service, ctx, calls, plan: operation => service(request(operation), () => ctx), apply: planRef => service({ action: 'apply', planRef }, () => ctx) };
}
test('positive feature/API gate precedes EVERY plan command, never version-only or optimistic invocation', async () => {
  for (const change of [c => delete c.lifecycleApi, c => { c.lifecycleApi = '1'; }, c => { c.lifecycleApi = true; },
    c => { c.features = 'lifecycle-plans'; }, c => { c.features = []; }, c => { c.features = ['lifecycle-plans', {}]; }, c => { c.ok = false; }]) {
    let invocations = 0;
    const f = fixture({ invoke: async (_bin, args) => { invocations++; return envelope(args.operation === 'stop' ? stopPlan() : retirePlan()); } });
    f.ctx.cli.version = '0.24.99'; change(f.ctx.cli);
    assert.equal((await f.plan('stop')).status, 'unavailable'); assert.equal((await f.plan('retire')).status, 'unavailable');
    assert.equal(invocations, 0, 'a swallowed command failure is NOT zero invocation');
  }
  const f = fixture(); assert.equal((await f.plan('stop')).status, 'plan', 'advertisement works within accepted CLI state, not a guessed K1 floor');
});
test('locator preserves only the exact lifecycleApi integer', async () => {
  for (const value of [1, true, '1', 2, undefined]) {
    const found = await discover({ env: { PATH: '/bin' }, isExecutableFile: () => true }, async () => ({ stdout: JSON.stringify({ schemaVersion: 1, name: '@awebai/oats', desktopApi: 1, version: '0.25.8', features: ['lifecycle-plans'], lifecycleApi: value }) }));
    assert.equal(found.lifecycleApi, value === 1 ? 1 : undefined);
  }
});
test('qualified admission refuses a local/remote crossing, forged scope/home/options and duplicate targets before invocation', async () => {
  const f = fixture({ invoke: assert.fail });
  // A local selector never resolves in a remote workspace (remote routing: remote-lifecycle.test.mjs).
  Object.assign(f.ctx.workspace, { remote: true, server: 'build' }); assert.equal((await f.plan()).reason.code, 'E_SESSION_UNKNOWN');
  delete f.ctx.workspace.remote; delete f.ctx.workspace.server;
  f.ctx.instances.push(structuredClone(instance)); assert.equal((await f.plan()).reason.code, 'E_AMBIGUOUS_INSTANCE'); f.ctx.instances.pop();
  for (const extra of ['home', 'cwd', 'argv', 'env', 'force', 'self', 'key', 'revision']) {
    assert.equal((await f.service({ ...request(), [extra]: 'forged' }, () => f.ctx)).reason.code, 'E_BAD_ARGS');
    const r = request(); r.selector[extra] = 'forged'; assert.equal((await f.service(r, () => f.ctx)).reason.code, 'E_BAD_ARGS');
  }
  // Remove has one choice: a request that names a branch choice is refused before any CLI call, whatever its value.
  for (const deleteBranch of [true, false]) for (const discardWorktree of [true, false]) {
    const r = request('retire'); r.options = { discardWorktree, deleteBranch }; assert.equal((await f.service(r, () => f.ctx)).reason.code, 'E_BAD_ARGS');
  }
});
test('coalesced plan commands issue different immutable refs; first confirmation alone mints/uses key', async () => {
  const gate = deferred(); let reads = 0, writes = 0, captured;
  const f = fixture({ invoke: async (_bin, args) => {
    if (args.phase === 'plan') { reads++; return gate.promise; }
    writes++; captured = args; return envelope(stopReceipt(args));
  } });
  const a = f.plan(), b = f.plan(); await tick(); assert.equal(reads, 1); gate.resolve(envelope(stopPlan()));
  const [first, second] = await Promise.all([a, b]); assert.equal(first.status, 'plan'); assert.equal(second.status, 'plan');
  assert.match(second.planRef, /^[a-f0-9]{64}$/); assert.notEqual(first.planRef, second.planRef); assert.equal(writes, 0);
  first.options.recursive = false; first.plan.targets[0].home = '/forged';
  const [x, y] = await Promise.all([f.apply(first.planRef), f.apply(first.planRef)]);
  assert.equal(writes, 1); assert.equal(captured.home, instance.home); assert.equal(captured.choices.recursive, true); assert.match(captured.key, /^[a-f0-9]{64}$/);
  assert.equal(x.status, 'complete'); assert.equal(y.status, 'complete'); assert.doesNotMatch(JSON.stringify(x), new RegExp(captured.key));
});
test('one apply slot covers different confirmations, while duplicate attempts share their pending command', async () => {
  const gate = deferred(); let call, writes = 0;
  const f = fixture({ invoke: async (_bin, args) => args.phase === 'plan' ? envelope(stopPlan()) : (writes++, call = args, gate.promise) });
  const a = await f.plan(), b = await f.plan(), pending = f.apply(a.planRef); await tick();
  const other = f.apply(b.planRef); await tick(); assert.equal(writes, 1, 'global slot precedes invocation');
  assert.equal((await other).reason.code, 'E_LIFECYCLE_BUSY');
  gate.resolve(envelope(stopReceipt(call))); assert.equal((await pending).status, 'complete');
  assert.equal((await f.apply(a.planRef)).repeated, true);
});
test('cached Remove receipt never resolves a new same-name home; changed CLI/scope revokes the reference', async () => {
  const f = fixture(), p = await f.plan('retire'), done = await f.apply(p.planRef); assert.equal(done.status, 'complete');
  const before = f.calls.length; f.ctx.instances = [{ ...instance, home: '/other/dev-1', agentsRoot: '/other' }];
  const replay = await f.apply(p.planRef); assert.equal(replay.repeated, true); assert.equal(replay.target.home, instance.home); assert.equal(f.calls.length, before);
  f.ctx.cli.version = '0.24.9'; assert.equal((await f.apply(p.planRef)).reason.code, 'E_PLAN_CHANGED'); assert.equal(f.calls.length, before);
});
test('Remove requires additional retention/home features; no legacy invocation is a fallback', async () => {
  for (const removed of ['retire-retention', 'retire-home']) {
    const f = fixture(); f.ctx.cli.features = f.ctx.cli.features.filter(x => x !== removed);
    const p = await f.plan('retire'); assert.equal(p.status, 'plan');
    assert.equal((await f.apply(p.planRef)).reason.code, 'E_PLAN_CHANGED'); assert.equal(f.calls.length, 1);
  }
});
test('stale producer plan yields a new explicit-confirmation ref and a NEW key, never auto-applies', async () => {
  let writes = 0; const keys = [], fresh = stopPlan(); fresh.planRevision = 'c'.repeat(24);
  const f = fixture({ invoke: async (_bin, args) => {
    if (args.phase === 'plan') return envelope(stopPlan());
    keys.push(args.key); return ++writes === 1 ? { schemaVersion: 1, ok: false, error: { code: 'E_PLAN_STALE', message: 'PRIVATE', details: { plan: fresh } } }
      : envelope(stopReceipt(args, fresh));
  } });
  const p = await f.plan(), stale = await f.apply(p.planRef); assert.equal(stale.status, 'stale'); assert.notEqual(stale.planRef, p.planRef); assert.equal(writes, 1);
  assert.equal((await f.apply(stale.planRef)).status, 'complete'); assert.notEqual(keys[0], keys[1]);
});
test('unknown outcome remains unknown on retry, never a second native command or invented no-effect claim', async () => {
  let writes = 0;
  const f = fixture({ invoke: async (_bin, args) => args.phase === 'plan' ? envelope(stopPlan())
    : (writes++, { schemaVersion: 1, ok: false, error: { code: 'E_CLI_TIMEOUT', message: 'PRIVATE ghp_SECRET' } }) });
  const p = await f.plan(); const r = await f.apply(p.planRef); assert.equal(r.status, 'unknown'); assert.doesNotMatch(JSON.stringify(r), /PRIVATE|ghp_/);
  assert.equal((await f.apply(p.planRef)).status, 'unknown'); assert.equal(writes, 1);
});
test('E_WORK_INSPECTION_FAILED keeps its code and its own sentence: refused, home kept, session possibly stopped', () => {
  const reason = lifecycleReason('E_WORK_INSPECTION_FAILED');
  assert.equal(reason.code, 'E_WORK_INSPECTION_FAILED'); assert.notEqual(reason.message, lifecycleReason('E_CLI_FAILED').message);
  // The facts, not the bytes: a rewording that keeps all three needs no edit here.
  assert.match(reason.message, /\brefused\b/i, 'the retire was refused');
  assert.match(reason.message, /\bhome\b[^.;]*\b(?:kept|retained)\b/i, 'the home is kept');
  assert.match(reason.message, /\bsession\b[^.;]*\bmay\b[^.;]*\bstopped\b/i, 'the session may already have been stopped');
});
test("a local Remove refused by inspection is an unknown outcome with its own fixed cause; the CLI's message is its detail, through the display filter, and nowhere else", async () => {
  const path = '/srv/unreadable/dev-1/work', remedy = 'restore the owned work root before retrying cleanup';
  // As a CLI can send it: a line break, a tab and a character of the set.
  const message = `directory work must remain an owned directory, not missing, a link or another filesystem type: ${path};\n\t${remedy}\u202E`;
  const line = `directory work must remain an owned directory, not missing, a link or another filesystem type: ${path}; ${remedy}\uFFFD`;
  let writes = 0;
  const f = fixture({ invoke: async (_bin, args) => args.phase === 'plan' ? envelope(retirePlan())
    : (writes++, { schemaVersion: 1, ok: false, error: { code: 'E_WORK_INSPECTION_FAILED', message } }) });
  const p = await f.plan('retire'), result = await f.apply(p.planRef);
  // Never "refused": the kernel can raise it after the children stop, the session stop and the retire hooks.
  assert.equal(result.status, 'unknown'); assert.deepEqual(result.reason, lifecycleReason('E_OUTCOME_UNKNOWN')); assert.equal(writes, 1);
  assert.deepEqual(result.cause, { ...lifecycleReason('E_WORK_INSPECTION_FAILED'), detail: line }, "the sentence is Desktop's own; the detail is one display line");
  assert.equal(result.cause.detail, displayLine(message));
  // Nowhere else: without the detail, the reply holds none of the CLI's text.
  const { detail: _detail, ...cause } = result.cause, rest = JSON.stringify({ ...result, cause });
  for (const raw of [path, remedy, 'directory work']) assert.equal(rest.includes(raw), false, raw);
  // The recorded reply, not a second command.
  const again = await f.apply(p.planRef);
  assert.equal(again.repeated, true); assert.deepEqual(again.cause, result.cause); assert.equal(writes, 1);
});
test("a local refusal's detail is withheld whole when the message looks like a credential, and absent when the CLI sent no message or nothing to show", async () => {
  const cause = async error => {
    const f = fixture({ invoke: async (_bin, args) => args.phase === 'plan' ? envelope(retirePlan()) : { schemaVersion: 1, ok: false, error } });
    return (await f.apply((await f.plan('retire')).planRef)).cause;
  };
  const fixed = lifecycleReason('E_WORK_INSPECTION_FAILED');
  assert.deepEqual(await cause({ code: 'E_WORK_INSPECTION_FAILED', message: 'could not read the work root\ntoken=abc123' }), { ...fixed, detail: '[Detail withheld]' });
  for (const none of [undefined, null, '', ' \n\t ', 7, { text: 'not a string' }]) assert.deepEqual(await cause({ code: 'E_WORK_INSPECTION_FAILED', message: none }), fixed, JSON.stringify(none));
});
test('a failure Desktop raises itself never carries a detail, whatever the envelope holds; a code without its own sentence keeps the fixed reply', async () => {
  const outcomes = async code => {
    const answer = { schemaVersion: 1, ok: false, error: { code, message: 'TEXT FROM THE ENVELOPE' } };
    const f = fixture({ invoke: async (_bin, args) => args.phase === 'plan' ? envelope(stopPlan()) : answer });
    return { applied: await f.apply((await f.plan()).planRef), planned: await fixture({ invoke: async () => answer }).plan() };
  };
  for (const code of ['E_CLI_TIMEOUT', 'E_CLI_OUTPUT_LIMIT', 'E_CLI_PROTOCOL', 'E_CLI_FAILED', 'E_OUTCOME_UNKNOWN', 'E_PLAN_EXPIRED', 'E_PLAN_CHANGED', 'E_PLAN_LIMIT',
    'E_PLAN_REQUIRED', 'E_OPTION_UNAVAILABLE', 'E_LIFECYCLE_UNAVAILABLE', 'E_FORBIDDEN_FRAME', 'E_WORKSPACE_UNKNOWN', 'cli-unavailable', 'unsupported-remote-operation']) {
    assert.equal(lifecycleDetailCode(code), false, code);
    const { applied, planned } = await outcomes(code);
    assert.equal(applied.status, 'unknown', code); assert.deepEqual(applied.cause, lifecycleReason(code), code);
    assert.deepEqual(planned.reason, lifecycleReason(code), code);
    assert.doesNotMatch(JSON.stringify([applied, planned]), /TEXT FROM/, code);
  }
  // A code Desktop has no sentence for (#603): today's reply, unchanged.
  const { applied, planned } = await outcomes('E_NOT_IN_THE_TABLE');
  assert.equal(lifecycleDetailCode('E_NOT_IN_THE_TABLE'), false);
  assert.deepEqual(applied.cause, lifecycleReason('E_CLI_FAILED')); assert.deepEqual(planned.reason, lifecycleReason('E_CLI_FAILED'));
  assert.doesNotMatch(JSON.stringify([applied, planned]), /TEXT FROM|E_NOT_IN_THE_TABLE/);
  // The codes the kernel raises and Desktop has a sentence for.
  for (const code of ['E_BAD_ARGS', 'E_SESSION_UNKNOWN', 'E_AMBIGUOUS_INSTANCE', 'E_HOME_MISMATCH', 'E_PLAN_STALE', 'E_LIFECYCLE_BUSY', 'E_INSTANCE_RETIRING', 'E_CHILDREN_RUNNING',
    'E_SESSION_STOP_FAILED', 'E_WORK_PRESERVATION_FAILED', 'E_WORK_INSPECTION_FAILED', 'E_RETIRE_INCOMPLETE']) assert.equal(lifecycleDetailCode(code), true, code);
  for (const none of [undefined, null, '', 7, {}]) assert.equal(lifecycleDetailCode(none), false);
});
test("a local plan refusal and a refusal before any effect carry the CLI's message as their detail; an answer that is not an error envelope never does", async () => {
  const error = { code: 'E_INSTANCE_RETIRING', message: 'dev-1 is already being retired\n(since 12:00)' }, fixed = lifecycleReason('E_INSTANCE_RETIRING');
  const shown = { ...fixed, detail: 'dev-1 is already being retired (since 12:00)' };
  const planned = await fixture({ invoke: async () => ({ schemaVersion: 1, ok: false, error }) }).plan('retire');
  assert.equal(planned.status, 'unavailable'); assert.deepEqual(planned.reason, shown);
  const f = fixture({ invoke: async (_bin, args) => args.phase === 'plan' ? envelope(retirePlan()) : { schemaVersion: 1, ok: false, error } });
  const refused = await f.apply((await f.plan('retire')).planRef);
  assert.equal(refused.status, 'refused'); assert.deepEqual(refused.reason, shown); assert.equal(Object.hasOwn(refused, 'cause'), false);
  // Not the installed CLI's error envelope: another schema version, or `ok` that is not false.
  for (const answer of [{ schemaVersion: 2, ok: false, error }, { ok: false, error }, { schemaVersion: 1, error }, { schemaVersion: 1, ok: 'false', error }]) {
    const reply = await fixture({ invoke: async () => answer }).plan('retire');
    assert.deepEqual(reply.reason, fixed, JSON.stringify(Object.keys(answer)));
  }
});
test("the adapter keeps an error envelope's code, message and details for a local command; stderr, the process error and other fields never leave it", async () => {
  const args = { operation: 'retire', phase: 'apply', instance: instance.instance, home: instance.home, context: '/team', choices: options('retire'), revision: 'b'.repeat(24), key: 'server-key' };
  const sent = { schemaVersion: 1, ok: false, error: { code: 'E_WORK_INSPECTION_FAILED', message: 'could not inspect the work tree', details: { path: '/team/x' }, stack: 'PRIVATE stack' }, debug: 'PRIVATE field' };
  const result = await cliLifecycle(cli.bin, args, { exec: (_b, _a, _o, done) => done(Object.assign(new Error('PRIVATE process error'), { code: 1 }), JSON.stringify(sent), 'PRIVATE stderr') });
  assert.deepEqual(result, { schemaVersion: 1, ok: false, error: { code: 'E_WORK_INSPECTION_FAILED', message: 'could not inspect the work tree', details: { path: '/team/x' } } });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
});
test('expired plans, malformed/oversized DTOs, stale admission and hostile returned aliases cannot authorize an apply', async () => {
  let clock = 0; const f = fixture({ now: () => clock }); const p = await f.plan(); clock += 300_001;
  assert.equal((await f.apply(p.planRef)).reason.code, 'E_PLAN_EXPIRED'); assert.equal(f.calls.length, 1);
  for (const mutate of [v => { v.home = '/foreign'; }, v => { v.targets = Array(129).fill(v.targets[0]); }, v => { v.targets[0].session.established = false; }, v => { delete v.ambiguous; }]) {
    const value = stopPlan(); mutate(value); const bad = fixture({ invoke: async () => envelope(value) }); assert.equal((await bad.plan()).status, 'unavailable');
  }
  const wait = deferred(), moving = fixture({ invoke: () => wait.promise }); const late = moving.plan(); await tick(); moving.ctx.cli.lifecycleApi = 2;
  wait.resolve(envelope(stopPlan())); assert.equal((await late).reason.code, 'E_PLAN_CHANGED');
});
test('four plan flights and32 independent confirmation refs are bounded, without truncating executable targets', async () => {
  const gates = [], f = fixture({ invoke: () => { const gate = deferred(); gates.push(gate); return gate.promise; } });
  // Four distinct CLI identities create four distinct flights.
  const attempts = [];
  for (let n = 0; n < 4; n++) { f.ctx.cli.version = `0.24.${n}`; attempts.push(f.plan()); }
  f.ctx.cli.version = '0.24.9'; assert.equal((await f.plan()).reason.code, 'E_LIFECYCLE_BUSY');
  await tick(); gates.forEach(g => g.resolve(envelope(stopPlan()))); await Promise.all(attempts);
  const many = fixture(); for (let n = 0; n < 32; n++) assert.equal((await many.plan()).status, 'plan');
  assert.equal((await many.plan()).reason.code, 'E_LIFECYCLE_BUSY'); assert.equal(many.calls.length, 32);
});
test('ambiguous edges, unknown observations and reported child refusal stay distinct from safe empty/idle', () => {
  const raw = stopPlan(); raw.targets[0].session = { established: false, present: null, backend: null, state: 'unestablished', reason: 'E_UNKNOWN' };
  raw.targets[0].work = { observed: false, reason: 'no-worktree' }; raw.targets[0].midTask = 'unknown';
  raw.ambiguous = [{ instance: 'kid', agent: 'dev', home: '/team/agents/dev/instances/kid', reason: 'parent name not unique' }];
  const p = lifecyclePlan(raw, target, 'stop', options('stop')); assert.equal(p.targets[0].midTask, 'unknown'); assert.equal(p.targets[0].work.observed, false); assert.equal(p.ambiguous.length, 1);
  assert.equal(p.targets.length, 1);
});
test('Remove has one choice, the worktree: options with a deleteBranch key are refused whatever its value, and no retire argument list holds --delete-branch', () => {
  for (const discardWorktree of [true, false]) {
    assert.deepEqual(lifecycleOptions('retire', { discardWorktree }), { discardWorktree });
    for (const deleteBranch of [true, false, undefined, null, 'false']) assert.equal(lifecycleOptions('retire', { discardWorktree, deleteBranch }), null, String(deleteBranch));
    const base = { operation: 'retire', instance: instance.instance, home: instance.home, context: '/team' }, sent = { revision: 'b'.repeat(24), key: 'server-key' };
    const planArgv = lifecycleArgv({ ...base, phase: 'plan', choices: { discardWorktree } }), applyArgv = lifecycleArgv({ ...base, phase: 'apply', choices: { discardWorktree }, ...sent });
    assert.deepEqual(planArgv, ['retire', instance.instance, '--plan', '--home', instance.home, '--dir', '/team', '--json']);
    assert.deepEqual(applyArgv, ['retire', instance.instance, '--plan-revision', sent.revision, '--idempotency-key', sent.key,
      ...(discardWorktree ? ['--discard-worktree'] : []), '--home', instance.home, '--dir', '/team', '--json']);
    for (const argv of [planArgv, applyArgv, lifecycleArgv({ ...base, phase: 'apply', server: 'build', choices: { discardWorktree }, ...sent })]) assert.ok(!argv.includes('--delete-branch'), argv.join(' '));
    // Choices that name a branch build no argument list at all.
    for (const deleteBranch of [true, false]) {
      assert.equal(lifecycleArgv({ ...base, phase: 'plan', choices: { discardWorktree, deleteBranch } }), null);
      assert.equal(lifecycleArgv({ ...base, phase: 'apply', choices: { discardWorktree, deleteBranch }, ...sent }), null);
    }
  }
  assert.equal(lifecycleOptions('retire', { deleteBranch: false }), null); assert.equal(lifecycleOptions('retire', {}), null);
});
test('a retire plan is accepted with defaults.deleteBranch false or absent and refused with any other value; the projection carries no deleteBranch', async () => {
  for (const [value, accepted] of [[undefined, true], [false, true], [true, false], [null, false], ['false', false], [0, false]]) {
    const raw = retirePlan(); if (value === undefined) delete raw.defaults.deleteBranch; else raw.defaults.deleteBranch = value;
    const projected = lifecyclePlan(structuredClone(raw), target, 'retire', options('retire'));
    assert.equal(projected !== null, accepted, String(value));
    const f = fixture({ invoke: async () => envelope(raw) }), reply = await f.plan('retire');
    if (!accepted) { assert.equal(reply.status, 'unavailable', String(value)); assert.equal(reply.reason.code, 'E_CLI_PROTOCOL'); assert.equal(reply.plan, null); continue; }
    assert.deepEqual(projected.defaults, { retainWorktree: true, stopChildren: true, retainChildren: true });
    assert.equal(reply.status, 'plan', String(value)); assert.deepEqual(reply.plan.defaults, projected.defaults); assert.deepEqual(reply.options, { discardWorktree: false });
    // The renderer's pass over the server's projection accepts it again.
    assert.deepEqual(lifecyclePlan(reply.plan, target, 'retire', reply.options), reply.plan);
  }
});
/** A removed worktree, with a branch name and a reason that must never leave a refused receipt. */
const removedRetention = () => ({ worktree: 'removed', branch: 'UNSHOWN-branch', recordedBranch: 'UNSHOWN-recorded' });
const branchReports = [['branchDeleted: true', r => { r.branchDeleted = true; }], ['retention.branchDeleted', r => { r.retention.branchDeleted = 'UNSHOWN-branch'; }],
  ['both deletion fields', r => { r.branchDeleted = true; r.retention.branchDeleted = 'feat/work'; }],
  ['retention.branchDeletionSkipped', r => { r.retention.branchDeletionSkipped = { expected: 'feat/work', actual: 'UNSHOWN-branch', reason: 'UNSHOWN reason' }; }],
  ['retention.branchDeleted: undefined', r => { r.retention.branchDeleted = undefined; }], ['retention.branchDeletionSkipped: false', r => { r.retention.branchDeletionSkipped = false; }]];
function retireWith(change) {
  let writes = 0;
  const f = fixture({ invoke: async (_bin, args) => {
    if (args.phase === 'plan') return envelope(retirePlan());
    writes++; const r = retireReceipt(args); r.worktreeRemoved = true; r.retention = removedRetention(); change(r); return envelope(r);
  } });
  return { ...f, writes: () => writes };
}
test('a retire receipt without branchDeleted, or with false, is accepted and complete when the home was removed; the projection carries no branchDeleted', async () => {
  for (const change of [r => { delete r.branchDeleted; }, r => { r.branchDeleted = false; }]) {
    const f = retireWith(change), p = await f.plan('retire'), outcome = await f.apply(p.planRef);
    assert.equal(outcome.status, 'complete'); assert.equal(outcome.reason, null); assert.equal(outcome.receipt.removedDir, true);
    assert.equal(Object.hasOwn(outcome.receipt, 'branchDeleted'), false); assert.deepEqual(outcome.receipt.retention, removedRetention());
    // The renderer's pass accepts the server's projection, and one that still says false (an earlier Desktop server).
    assert.deepEqual(publicLifecycleReceipt(outcome.receipt, p.plan), outcome.receipt);
    assert.deepEqual(publicLifecycleReceipt({ ...outcome.receipt, branchDeleted: false }, p.plan), outcome.receipt);
  }
});
test('a retire receipt that reports a branch deletion or a skip is refused whole: unknown outcome, no receipt, nothing of it in the reply', async () => {
  for (const [name, change] of branchReports) {
    const f = retireWith(change), p = await f.plan('retire'), outcome = await f.apply(p.planRef);
    assert.equal(outcome.status, 'unknown', name); assert.equal(outcome.reason.code, 'E_OUTCOME_UNKNOWN', name);
    assert.deepEqual(outcome.reason, lifecycleReason('E_OUTCOME_UNKNOWN')); assert.deepEqual(outcome.cause, lifecycleReason('E_CLI_PROTOCOL'));
    assert.equal(outcome.receipt, null, name); assert.equal(outcome.plan, null, name);
    assert.deepEqual(Object.keys(outcome).sort(), ['cause', 'lifecycleApi', 'options', 'plan', 'planRef', 'reason', 'receipt', 'status', 'target'], name);
    assert.doesNotMatch(JSON.stringify(outcome), /UNSHOWN|feat\/work|branch/i, name);
    // The recorded reply, not a second command.
    const again = await f.apply(p.planRef); assert.equal(again.repeated, true); assert.equal(again.receipt, null); assert.equal(f.writes(), 1, name);
  }
});
test('publicLifecycleReceipt refuses a projection that reports a branch deletion or a skip', async () => {
  const f = retireWith(() => {}), p = await f.plan('retire'), accepted = (await f.apply(p.planRef)).receipt;
  assert.ok(publicLifecycleReceipt(structuredClone(accepted), p.plan), 'the same receipt without a report is accepted');
  for (const [name, change] of branchReports) {
    const reported = structuredClone(accepted); change(reported);
    assert.equal(publicLifecycleReceipt(reported, p.plan), null, name);
  }
  // A plain lifecycleReceipt, as the server reads the kernel's answer.
  const raw = retireReceipt({ key: 'k', revision: p.plan.planRevision }); assert.ok(lifecycleReceipt(structuredClone(raw), p.plan, 'k'));
  for (const [name, change] of branchReports) { const reported = structuredClone(raw); change(reported); assert.equal(lifecycleReceipt(reported, p.plan, 'k'), null, name); }
});
test('a retire receipt with incomplete items, or with the home not removed, is still partial', async () => {
  for (const [change, ok] of [[r => { r.rollbackIncomplete = ['cleanup']; }, false], [r => { r.removedDir = false; r.retainedHome = instance.home; r.rollbackIncomplete = ['cleanup']; }, false], [r => { r.removedDir = false; }, true]]) {
    const f = fixture({ invoke: async (_bin, args) => {
      if (args.phase === 'plan') return envelope(retirePlan());
      const r = retireReceipt(args); change(r);
      return ok ? envelope(r) : { schemaVersion: 1, ok: false, result: r, error: { code: 'E_RETIRE_INCOMPLETE', message: 'PRIVATE' } };
    } });
    const p = await f.plan('retire'), outcome = await f.apply(p.planRef);
    assert.equal(outcome.status, 'partial'); assert.deepEqual(outcome.reason, lifecycleReason('E_RETIRE_INCOMPLETE'));
    assert.equal(outcome.receipt.incomplete, !ok); assert.doesNotMatch(JSON.stringify(outcome), /PRIVATE/);
    assert.deepEqual(publicLifecycleReceipt(outcome.receipt, p.plan), outcome.receipt);
  }
});
test('deleting the worktree cannot be authorized for a work mode that owns none; the refusal is raised before any apply command', async () => {
  for (const mode of ['checkout', 'directory', 'workspace', null]) {
    const raw = retirePlan(); raw.facts.workMode = mode; let calls = 0;
    const f = fixture({ invoke: async (_bin, args) => { calls++; assert.equal(args.phase, 'plan'); return envelope(raw); } });
    const r = request('retire'); r.options = { discardWorktree: true };
    const p = await f.service(r, () => f.ctx); assert.equal(p.status, 'plan');
    const refused = await f.apply(p.planRef); assert.deepEqual(refused.reason, lifecycleReason('E_OPTION_UNAVAILABLE')); assert.equal(calls, 1);
    assert.equal(refused.reason.message, 'Review the choices: deleting work requires an owned worktree.');
  }
  // Unobserved or detached work does not make the one choice unavailable: it needs an owned worktree and nothing else.
  for (const mutate of [p => { p.facts.work = { observed: false, reason: 'unavailable' }; }, p => { p.facts.work.branch = null; p.facts.work.detached = true; }]) {
    const raw = retirePlan(); mutate(raw);
    const f = fixture({ invoke: async (_bin, args) => envelope(args.phase === 'plan' ? raw : retireReceipt(args)) });
    const r = request('retire'); r.options = { discardWorktree: true };
    const p = await f.service(r, () => f.ctx); assert.equal(p.status, 'plan'); assert.equal((await f.apply(p.planRef)).status, 'complete');
  }
});
test('E_CHILDREN_RUNNING preserves partial child outcomes without minting an executable fresh confirmation', async () => {
  const raw = retirePlan(); raw.facts.children = [{ instance: 'kid', agent: 'dev', home: '/team/agents/dev/instances/kid', session: { state: 'unknown', present: true, established: true, backend: 'tmux' } }];
  const f = fixture({ invoke: async (_bin, args) => args.phase === 'plan' ? envelope(raw) : ({ schemaVersion: 1, ok: false,
    error: { code: 'E_CHILDREN_RUNNING', message: 'PRIVATE', details: { plan: raw, childrenStopped: [{ instance: 'kid', home: raw.facts.children[0].home, ok: false, code: 'E_SESSION_STOP_FAILED', message: 'PRIVATE', stillRunning: [4321] }] } } }) });
  const p = await f.plan('retire'), result = await f.apply(p.planRef);
  assert.equal(result.status, 'refused'); assert.deepEqual(result.childrenStopped[0].stillRunning, [4321]); assert.equal(result.planRef, p.planRef);
  assert.equal((await f.apply(p.planRef)).repeated, true); assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
});
test('Stop nested ok:false is partial even inside a successful envelope; all target identities are checked', async () => {
  const f = fixture({ invoke: async (_bin, args) => {
    if (args.phase === 'plan') return envelope(stopPlan());
    const receipt = stopReceipt(args); receipt.ok = false; receipt.results = [{ instance: instance.instance, home: instance.home, ok: false, code: 'E_SESSION_STOP_FAILED', stillRunning: [42], message: 'PRIVATE' }];
    return envelope(receipt);
  } });
  const p = await f.plan(), result = await f.apply(p.planRef); assert.equal(result.status, 'partial'); assert.equal(result.receipt.ok, false); assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  const hostile = stopReceipt({ revision: p.plan.planRevision, key: 'k' }); hostile.results[0].home = '/elsewhere';
  assert.equal(lifecycleReceipt(hostile, p.plan, 'k'), null);
});

test('CLI fixes every argv, caps timeout/output, supports raw/replayed retire and suppresses errors', async () => {
  for (const operation of ['stop', 'retire']) for (const phase of ['plan', 'apply']) {
    const args = { operation, phase, instance: instance.instance, home: instance.home, context: '/team;literal', choices: options(operation),
      ...(phase === 'apply' ? { revision: (operation === 'stop' ? 'a' : 'b').repeat(24), key: 'server-key' } : {}) };
    const r = await cliLifecycle(cli.bin, args, { timeout: 999_999, exec(bin, argv, opts, done) {
      assert.equal(bin, cli.bin); assert.deepEqual(argv, lifecycleArgv(args)); assert.equal(opts.cwd, args.context); assert.equal(opts.shell, false);
      assert.equal(opts.timeout, phase === 'plan' ? 30000 : 600000); assert.equal(opts.maxBuffer, (phase === 'plan' ? 1 : 4) * 1024 * 1024);
      assert.ok(argv.includes('--home') && argv.includes('--dir') && argv.includes('--json')); assert.ok(!argv.includes('--force'));
      const value = phase === 'plan' ? envelope(operation === 'stop' ? stopPlan() : retirePlan()) : operation === 'stop' ? envelope(stopReceipt(args)) : retireReceipt(args);
      done(null, JSON.stringify(value), 'PRIVATE stderr');
    } }); assert.equal(r.ok, true); assert.doesNotMatch(JSON.stringify(r), /PRIVATE/);
  }
  assert.equal((await cliLifecycle('relative', {}, { exec: assert.fail })).error.code, 'E_BAD_ARGS');
  for (const error of [{ killed: true }, { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }, new Error('PRIVATE')]) {
    const args = { operation: 'stop', phase: 'apply', instance: instance.instance, home: instance.home, context: '/team', choices: options('stop'), revision: 'a'.repeat(24), key: 'x' };
    const result = await cliLifecycle(cli.bin, args, { exec: (_b, _a, _o, done) => done(error, 'PRIVATE') }); assert.equal(result.ok, false); assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  }
});
test('a Herdr-recorded instance still plans and applies Retire: the kernel decides, the Desktop never blocks it', async () => {
  const f = fixture(), reason = 'E_HERDR_REMOVED: Herdr is no longer supported by OATS (removed in 0.31.0); tmux is the only session backend.';
  Object.assign(f.ctx.instances[0], { running: null, runtimeState: 'unsupported', runtimeError: reason, sessionTarget: { backend: 'herdr' } });
  const plan = await f.plan('retire');
  assert.equal(plan.status, 'plan');
  assert.equal((await f.apply(plan.planRef)).status, 'complete');
  assert.deepEqual(f.calls.map(c => [c.args.operation, c.args.phase]), [['retire', 'plan'], ['retire', 'apply']]);
});
