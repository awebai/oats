import test from 'node:test';
import assert from 'node:assert/strict';
import { createLifecycleBoundary } from '../server/instance-lifecycle.mjs';
import { cliLifecycle, lifecycleArgv } from '../lifecycle-cli.mjs';
import { lifecycleReceipt } from '../renderer/lifecycle-contract.mjs';
import { cli, instance, stopPlan, retirePlan, stopReceipt, retireReceipt, envelope, options } from './helpers/lifecycle-fixture.mjs';

const remoteRow = { ...instance, server: 'build', addressable: true, missingRemotely: false, savedRoute: false, running: true };
const remoteContext = () => ({ cli: { ...structuredClone(cli), remote: ['lifecycle-plans'] }, localCwd: '/Users/me/work',
  workspace: { id: 'remote:build:3f2a', name: 'Build box', scope: '/srv', remote: true, server: 'build' }, instances: [structuredClone(remoteRow)] });
const remoteRequest = (operation = 'stop') => ({ action: 'plan', operation, selector: { instance: instance.instance, agent: instance.agent,
  agentsRoot: instance.agentsRoot, server: 'build' }, options: options(operation) });
const routedRetire = args => ({ ...retireReceipt(args), server: 'build', target: { sshHost: 'build-host', workspace: '/srv', oatsPath: 'oats' } });
function fixture(respond = {}) {
  const ctx = remoteContext(), calls = [];
  const invoke = async (bin, args) => {
    calls.push(structuredClone(args));
    const custom = respond[args.phase]?.(args);
    if (custom) return custom;
    return envelope(args.phase === 'plan' ? args.operation === 'stop' ? stopPlan() : retirePlan()
      : args.operation === 'stop' ? stopReceipt(args) : routedRetire(args));
  };
  const service = createLifecycleBoundary({ invoke });
  return { ctx, calls, plan: (operation = 'stop') => service(remoteRequest(operation), () => ctx),
    apply: planRef => service({ action: 'apply', planRef }, () => ctx) };
}

test('remote stop: plan and guarded apply are routed by server and home, run from this machine, never --dir', async () => {
  const f = fixture();
  const plan = await f.plan('stop');
  assert.equal(plan.status, 'plan');
  assert.deepEqual(plan.target, { workspace: 'remote:build:3f2a', instance: 'dev-1', agent: 'dev', agentsRoot: instance.agentsRoot, home: instance.home, server: 'build' });
  assert.deepEqual(f.calls[0], { operation: 'stop', phase: 'plan', instance: 'dev-1', home: instance.home, context: '/Users/me/work', server: 'build', choices: { recursive: true } });
  assert.deepEqual(lifecycleArgv(f.calls[0]), ['instance', 'stop', 'dev-1', '--plan', '--home', instance.home, '--server', 'build', '--json']);
  const done = await f.apply(plan.planRef);
  assert.equal(done.status, 'complete');
  assert.deepEqual(lifecycleArgv(f.calls[1]), ['instance', 'stop', 'dev-1', '--apply', '--plan-revision', 'a'.repeat(24), '--idempotency-key', f.calls[1].key,
    '--home', instance.home, '--server', 'build', '--json']);
});

test('remote retire: the guarded apply carries revision and key; its routed receipt (server, target) is accepted', async () => {
  const f = fixture();
  const plan = await f.plan('retire');
  assert.deepEqual(lifecycleArgv(f.calls[0]), ['retire', 'dev-1', '--plan', '--home', instance.home, '--server', 'build', '--json']);
  const done = await f.apply(plan.planRef);
  assert.equal(done.status, 'complete', JSON.stringify(done.reason));
  assert.deepEqual(lifecycleArgv(f.calls[1]), ['retire', 'dev-1', '--plan-revision', 'b'.repeat(24), '--idempotency-key', f.calls[1].key,
    '--home', instance.home, '--server', 'build', '--json']);
  assert.equal(JSON.stringify(done).includes('build-host'), false, 'the routing keys are not relayed to the renderer');
});

test('retire receipt decoder: server and target only on a remote request, and only those two', () => {
  const plan = { ...retirePlan(), facts: { ...retirePlan().facts, children: [] } };
  const args = { revision: plan.planRevision, key: 'k1' };
  assert.ok(lifecycleReceipt(retireReceipt(args), plan, 'k1'), 'local, as before');
  assert.equal(lifecycleReceipt(routedRetire(args), plan, 'k1'), null, 'routing keys on a local request are refused');
  assert.equal(lifecycleReceipt({ ...retireReceipt(args), server: 'build' }, plan, 'k1'), null);
  assert.ok(lifecycleReceipt(routedRetire(args), plan, 'k1', { server: 'build' }));
  assert.ok(lifecycleReceipt(retireReceipt(args), plan, 'k1', { server: 'build' }), 'a host may omit them');
  assert.equal(lifecycleReceipt({ ...routedRetire(args), server: 'other' }, plan, 'k1', { server: 'build' }), null, 'another server');
  assert.equal(lifecycleReceipt({ ...routedRetire(args), target: 'build-host' }, plan, 'k1', { server: 'build' }), null, 'a malformed target');
});

test('remote plan refused by the host: the kernel\'s code and message verbatim under the spec headline, never a local read', async () => {
  const cases = {
    E_REMOTE_INCOMPATIBLE: "Build box runs an OATS that can't do this yet.",
    E_SNAPSHOT_UNKNOWN: "Build box doesn't list this instance any more.",
    E_HOME_MISMATCH: 'Build box answered for a different instance. Nothing was changed.',
    E_AMBIGUOUS: 'Build box answered for a different instance. Nothing was changed.',
    E_SSH: "Couldn't reach Build box.",
    E_REMOTE_ENVELOPE: 'The lifecycle CLI is unavailable.',
  };
  for (const [code, headline] of Object.entries(cases)) {
    const f = fixture({ plan: () => ({ schemaVersion: 1, ok: false, error: { code, message: `host says ${code}` } }) });
    const result = await f.plan('stop');
    assert.equal(result.status, 'unavailable');
    assert.deepEqual(result.reason, { code, message: headline, detail: `host says ${code}`, remote: true });
    assert.equal(f.calls.length, 1);
  }
});

test('remote apply: codes the host refuses before any effect are "refused" with their headline', async () => {
  for (const code of ['E_REMOTE_INCOMPATIBLE', 'E_AMBIGUOUS', 'E_HOME_MISMATCH', 'E_SNAPSHOT_UNKNOWN']) {
    const f = fixture({ apply: () => ({ schemaVersion: 1, ok: false, error: { code, message: `host: ${code}` } }) });
    const result = await f.apply((await f.plan('retire')).planRef);
    assert.equal(result.status, 'refused', code);
    assert.equal(result.reason.code, code);
    assert.equal(result.reason.detail, `host: ${code}`);
  }
});

test('remote apply: a transport failure or timeout may have acted on the host, so it is "unknown", never a failure', async () => {
  for (const code of ['E_SSH', 'E_CLI_TIMEOUT']) {
    const f = fixture({ apply: () => ({ schemaVersion: 1, ok: false, error: { code, ...(code === 'E_SSH' ? { message: 'ssh failed: timed out' } : {}) } }) });
    const plan = await f.plan('stop');
    const result = await f.apply(plan.planRef);
    assert.equal(result.status, 'unknown', code);
    assert.equal(result.reason.code, 'E_OUTCOME_UNKNOWN');
    assert.equal(result.cause.message, "Couldn't reach Build box.");
    // "Check recorded result" re-shows the recorded outcome; nothing is sent again.
    const again = await f.apply(plan.planRef);
    assert.equal(again.status, 'unknown'); assert.equal(again.repeated, true); assert.equal(f.calls.length, 2);
  }
});

test('remote refusals before invocation: no probe entry, not addressable, a local selector', async () => {
  const f = fixture();
  f.ctx.cli.remote = ['session'];
  const unroutable = await f.plan('stop');
  assert.deepEqual(unroutable.reason, { code: 'unsupported-remote-operation', message: "This computer's OATS can't route this to Build box. Update OATS here.", detail: null, remote: true });
  f.ctx.cli.remote = ['lifecycle-plans'];
  f.ctx.instances[0].addressable = false; f.ctx.instances[0].missingRemotely = true;
  assert.equal((await f.plan('retire')).reason.message, 'dev-1 is no longer on Build box. Remove it from this computer with: oats server forget build --instance dev-1');
  assert.equal(f.calls.length, 0, 'nothing was sent');
});

test('remote apply is revalidated like a local one: the row going unaddressable revokes the plan', async () => {
  const f = fixture();
  const plan = await f.plan('stop');
  f.ctx.instances[0].addressable = false;
  assert.equal((await f.apply(plan.planRef)).reason.code, 'E_PLAN_CHANGED');
  assert.equal(f.calls.length, 1);
});

test('cliLifecycle: a remote plan gets 45 s and keeps the host\'s message; an apply keeps 600 s; cwd is this machine\'s', async () => {
  const seen = [];
  const exec = (bin, argv, opts, done) => { seen.push({ argv, opts }); done(Object.assign(new Error('x'), { code: 1 }), JSON.stringify({ schemaVersion: 1, ok: false, error: { code: 'E_REMOTE_INCOMPATIBLE', message: 'needs 0.31' } })); };
  const plan = await cliLifecycle('/installed/oats', { operation: 'stop', phase: 'plan', instance: 'dev-1', home: instance.home, context: '/Users/me/work', server: 'build', choices: { recursive: true } }, { exec });
  assert.deepEqual(plan, { schemaVersion: 1, ok: false, error: { code: 'E_REMOTE_INCOMPATIBLE', message: 'needs 0.31', details: undefined } });
  assert.equal(seen[0].opts.timeout, 45_000); assert.equal(seen[0].opts.cwd, '/Users/me/work');
  await cliLifecycle('/installed/oats', { operation: 'stop', phase: 'plan', instance: 'dev-1', home: instance.home, context: '/team', choices: { recursive: true } }, { exec });
  assert.equal(seen[1].opts.timeout, 30_000, 'local plans keep 30 s');
  await cliLifecycle('/installed/oats', { operation: 'stop', phase: 'apply', instance: 'dev-1', home: instance.home, context: '/Users/me/work', server: 'build',
    choices: { recursive: true }, revision: 'a'.repeat(24), key: 'k1' }, { exec });
  assert.equal(seen[2].opts.timeout, 600_000);
  assert.equal(lifecycleArgv({ operation: 'stop', phase: 'plan', instance: 'dev-1', home: instance.home, context: '/x', server: 'Bad Id', choices: { recursive: true } }), null);
});
