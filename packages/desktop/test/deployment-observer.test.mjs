import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createDeploymentObserver, MAX_DEPLOYMENT_OBSERVATIONS } from '../server/deployment-observer.mjs';
import { specProbe } from './helpers/no-approval-spec.mjs';
const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/workspace-v2/${name}.json`, import.meta.url), 'utf8'));
const status = fixture('status'), header = fixture('workspace-status'), version = fixture('version');
const context = dirname(status.root);
// packages-no-approval per the published spec until the 0.26.0 capture (helpers/no-approval-spec.mjs).
const cli = () => ({ ...specProbe(structuredClone(version)), ok: true, bin: '/fixture/bin/oats' });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let n = 0; n < 8; n++) await Promise.resolve(); };
const answer = (action, dir = context) => ({ ok: true, document: JSON.parse(JSON.stringify(action === 'status' ? status : header).replaceAll(context, dir)) });
function setup(read) {
  const state = { deployment: context, revision: 1, cli: cli() };
  const observer = createDeploymentObserver({ getContext: id => id === state.deployment ? state : null, read });
  return { state, ...observer };
}

test('observer joins native producer documents, coalesces in flight only, and isolates waiters', async () => {
  const waiting = deferred(); let calls = 0;
  const owner = setup(async (_cli, { action }) => { calls++; await waiting.promise; return answer(action); });
  const first = owner.observe(context), second = owner.observe(context); await flush(); assert.equal(calls, 2);
  waiting.resolve(); const [a, b] = await Promise.all([first, second]);
  assert.equal(a.ok, true); assert.deepEqual(a, b);
  assert.equal(a.deployment, context); assert.equal(a.workspaceStatus.workspace.name, 'northwind');
  assert.equal(a.roster.agents[0].instances[0].modules.length, 5);
  a.roster.agents[0].name = 'caller changed'; assert.notEqual(b.roster.agents[0].name, a.roster.agents[0].name);
  await owner.observe(context); assert.equal(calls, 4, 'settled observations are not an authority cache');
});

test('unknown deployment and missing capability do not dispatch', async () => {
  const owner = setup(() => assert.fail('unexpected read'));
  assert.equal((await owner.observe('/unregistered')).reason.code, 'E_BAD_ARGS');
  owner.state.cli.features = owner.state.cli.features.filter(f => f !== 'instance-modules');
  assert.equal((await owner.observe(context)).reason.feature, 'instance-modules');
});

test('invalidation before dispatch is inert', async () => {
  const owner = setup(() => assert.fail('revoked read dispatched'));
  const pending = owner.observe(context); owner.state.revision++;
  assert.equal((await pending).reason?.code, 'E_DEPLOYMENT_STALE');
});

test('ownership is checked before each actual invocation, not just before batching', async () => {
  let calls = 0; let owner;
  owner = setup((_cli, { action }) => { calls++; owner.state.revision++; return answer(action); });
  assert.equal((await owner.observe(context)).reason?.code, 'E_DEPLOYMENT_STALE');
  assert.equal(calls, 1);
});

for (const reject of [false, true]) for (const invalidate of ['revision', 'bin', 'features', 'dispose']) test(`${reject ? 'rejection' : 'success'} after ${invalidate} invalidation is stale`, async () => {
  const waiting = deferred();
  const owner = setup(async (_cli, { action }) => { await waiting.promise; return answer(action); });
  const pending = owner.observe(context); await flush();
  if (invalidate === 'revision') owner.state.revision++;
  if (invalidate === 'bin') owner.state.cli.bin = '/different/bin/oats';
  if (invalidate === 'features') owner.state.cli.features = owner.state.cli.features.filter(f => f !== 'served-identity');
  if (invalidate === 'dispose') owner.dispose();
  if (reject) waiting.reject(new Error('untrusted invoker error')); else waiting.resolve();
  assert.equal((await pending).reason?.code, 'E_DEPLOYMENT_STALE');
});

test('pending revoked reservations count across generations; no queue or early release after sibling rejection', async () => {
  const waiting = [], state = { deployment: context, revision: 0, cli: cli() };
  const owner = createDeploymentObserver({ getContext: () => state, read(_cli, { action }) {
    const item = deferred(); waiting.push({ action, ...item }); return item.promise;
  } });
  const first = owner.observe(context); await flush();
  state.revision++; const second = owner.observe(context); await flush();
  assert.equal(waiting.length, MAX_DEPLOYMENT_OBSERVATIONS * 2);
  state.revision++; const blocked = owner.observe(context); await flush();
  assert.equal(waiting.length, MAX_DEPLOYMENT_OBSERVATIONS * 2, 'saturated read must not dispatch or queue');
  assert.equal((await blocked).reason?.code, 'E_DEPLOYMENT_BUSY');
  waiting[0].reject(new Error('first child failed')); await flush();
  const stillBlocked = owner.observe(context); await flush();
  assert.equal(waiting.length, MAX_DEPLOYMENT_OBSERVATIONS * 2, 'rejected child does not release its pending sibling');
  assert.equal((await stillBlocked).reason?.code, 'E_DEPLOYMENT_BUSY', 'other child still owns resources');
  waiting[1].resolve(answer(waiting[1].action)); await first;
  const third = owner.observe(context); await flush(); assert.equal(waiting.length, 6);
  for (const item of waiting.slice(2)) item.resolve(answer(item.action));
  assert.equal((await second).reason?.code, 'E_DEPLOYMENT_STALE'); assert.equal((await third).ok, true);
});

test('foreign producer scope cannot become a public observation', async () => {
  const owner = setup((_cli, { action }) => answer(action, '/another/deployment'));
  assert.equal((await owner.observe(context)).reason?.code, 'E_DEPLOYMENT_SCOPE');
});

test('a current invoker rejection is a stable result, not a promise rejection', async () => {
  const owner = setup(() => { throw new Error('private argv'); });
  const result = await owner.observe(context); assert.equal(result.reason.code, 'E_CLI_PROTOCOL');
  assert.equal(JSON.stringify(result).includes('private argv'), false);
});
