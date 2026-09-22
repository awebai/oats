import test from 'node:test';
import assert from 'node:assert/strict';
import { createLifecycleBoundary } from '../server/instance-lifecycle.mjs';
import { cliLifecycle, lifecycleArgv } from '../lifecycle-cli.mjs';
import { lifecyclePlan, lifecycleReceipt, publicLifecycleReceipt } from '../renderer/lifecycle-contract.mjs';
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
    const found = await discover({ env: { PATH: '/bin' }, isExecutableFile: () => true }, async () => ({ stdout: JSON.stringify({ schemaVersion: 1, name: '@awebai/oats', desktopApi: 1, version: '0.24.8', features: ['lifecycle-plans'], lifecycleApi: value }) }));
    assert.equal(found.lifecycleApi, value === 1 ? 1 : undefined);
  }
});
test('qualified admission refuses remote, forged scope/home/options and duplicate targets before invocation', async () => {
  const f = fixture({ invoke: assert.fail });
  f.ctx.workspace.remote = true; assert.equal((await f.plan()).reason.code, 'unsupported-remote-operation'); delete f.ctx.workspace.remote;
  f.ctx.instances.push(structuredClone(instance)); assert.equal((await f.plan()).reason.code, 'E_AMBIGUOUS_INSTANCE'); f.ctx.instances.pop();
  for (const extra of ['home', 'cwd', 'argv', 'env', 'force', 'self', 'key', 'revision']) {
    assert.equal((await f.service({ ...request(), [extra]: 'forged' }, () => f.ctx)).reason.code, 'E_BAD_ARGS');
    const r = request(); r.selector[extra] = 'forged'; assert.equal((await f.service(r, () => f.ctx)).reason.code, 'E_BAD_ARGS');
  }
  const r = request('retire'); r.options = { discardWorktree: false, deleteBranch: true }; assert.equal((await f.service(r, () => f.ctx)).reason.code, 'E_BAD_ARGS');
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
test('branch deletion skipped is partial, not branch deletion success; public projection preserves safe retention only', async () => {
  const f = fixture({ invoke: async (_bin, args) => {
    if (args.phase === 'plan') return envelope(retirePlan());
    const r = retireReceipt(args); r.retention = { worktree: 'removed', branch: 'other', recordedBranch: 'agents/dev-1', branchDeletionSkipped: { expected: 'feat/work', actual: 'other', reason: 'changed' } }; r.worktreeRemoved = true;
    return envelope(r);
  } });
  const p = await f.plan('retire'), outcome = await f.apply(p.planRef);
  assert.equal(outcome.status, 'partial'); assert.equal(outcome.receipt.removedDir, true); assert.equal(outcome.receipt.branchDeleted, false);
  assert.equal(publicLifecycleReceipt(outcome.receipt, p.plan).retention.branchDeletionSkipped.actual, 'other');
});
test('named branch deletion cannot be authorized from unknown/detached work or a non-owned work mode', async () => {
  for (const mutate of [p => { p.facts.work = { observed: false, reason: 'unavailable' }; }, p => { p.facts.work.branch = null; p.facts.work.detached = true; }, p => { p.facts.workMode = 'checkout'; }]) {
    const raw = retirePlan(); mutate(raw); let calls = 0;
    const f = fixture({ invoke: async (_bin, args) => { calls++; assert.equal(args.phase, 'plan'); return envelope(raw); } });
    const r = request('retire'); r.options = { discardWorktree: true, deleteBranch: true };
    const p = await f.service(r, () => f.ctx); assert.equal(p.status, 'plan');
    assert.equal((await f.apply(p.planRef)).reason.code, 'E_OPTION_UNAVAILABLE'); assert.equal(calls, 1);
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
