import test from 'node:test';
import assert from 'node:assert/strict';
import { createForgeBoundary } from '../server/forge.mjs';
import { forgeObservation } from '../server/forge-observation.mjs';
import { createInstanceGitBoundary } from '../server/instance-git.mjs';
import { cli, oats, context, target, selector, state, envelope, pr, status, output, deferred, tick } from './helpers/forge-fixture.mjs';
const keyFor = raw => forgeObservation(raw, target, oats).observationKey;
function fixture({ raw = state(), configured = status(), invokeGit, discover, run, now } = {}) {
  const calls = [];
  const service = createForgeBoundary({ discover: discover || (async () => { calls.push('discover'); return cli; }),
    invokeGit: invokeGit || (async () => { calls.push('git'); return envelope(structuredClone(raw)); }), now,
    run: run || (async (_bin, args) => {
      calls.push(args);
      if (args[0] === 'auth') return output(configured);
      if (args[0] === 'api') return output('operator');
      return output(pr());
    }) });
  return { service, calls, raw, request: { selector, observationKey: keyFor(raw) } };
}
test('K1 exposes opaque comparison key but never remote.url, even on a producer predating0.24.8', async () => {
  const raw = state(), read = createInstanceGitBoundary({ invoke: async () => envelope(raw) });
  const result = await read({ action: 'git', selector }, context);
  assert.equal(result.observationKey, keyFor(raw)); assert.equal(result.data.remote, undefined);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|userinfo|remote\.url/);
  const changed = state(); changed.remote.url += '?changed'; assert.notEqual(keyFor(changed), keyFor(raw));
});
test('qualified PR uses K1 before and after, echoes correlation, and projects no raw remote', async () => {
  const f = fixture(); const result = await f.service.pull(f.request, () => context);
  assert.equal(result.status, 'available'); assert.equal(result.observation.revision, f.raw.observation.revision);
  assert.equal(result.observation.branch, 'feat/a'); assert.equal(result.data.number, 42);
  assert.equal(f.calls.filter(c => c === 'git').length, 2); assert.doesNotMatch(JSON.stringify(result), /PRIVATE|userinfo/);
});
test('missing/null/local/unknown remote are distinct; absence is presence-gated not version-gated', async () => {
  for (const [alter, expected, code] of [
    [r => delete r.remote, 'unavailable', 'E_REMOTE_NOT_REPORTED'],
    [r => { r.remote = null; }, 'no-remote', 'E_NO_REMOTE'],
    [r => { r.remote.host = null; r.remote.path = null; }, 'unsupported-forge', 'E_UNSUPPORTED_FORGE'],
    [r => { r.remote.host = 'gitlab.example'; }, 'unsupported-forge', 'E_UNSUPPORTED_FORGE'],
  ]) {
    const raw = state(); alter(raw); const f = fixture({ raw }); const result = await f.service.pull(f.request, () => context);
    assert.equal(result.status, expected); assert.equal(result.reason.code, code);
    if (raw.remote?.host === 'gitlab.example') assert.match(result.remedy, /configure it in GitHub CLI first/);
    else assert.equal(f.calls.includes('discover'), false);
  }
});
test('remote workspaces/instances, unknown/ambiguous homes and bad selectors refuse before ANY process', async () => {
  const service = createForgeBoundary({ run: assert.fail, discover: assert.fail, invokeGit: assert.fail });
  const request = { selector, observationKey: keyFor(state()) };
  for (const c of [{ ...context, workspace: { ...context.workspace, remote: true } },
    { ...context, instances: [{ ...context.instances[0], remote: true }] }, { ...context, instances: [] },
    { ...context, instances: [context.instances[0], context.instances[0]] }]) assert.equal((await service.pull(request, () => c)).status, 'unavailable');
  for (const extra of ['home', 'cwd', 'argv', 'env', 'branch', 'host', 'repo']) assert.equal((await service.pull({ ...request, [extra]: 'evil' }, () => context)).reason.code, 'E_BAD_ARGS');
});
test('stale key or changed branch/remote after gh never returns the old PR', async () => {
  const stale = fixture();
  assert.equal((await stale.service.pull({ ...stale.request, observationKey: '0'.repeat(64) }, () => context)).reason.code, 'E_OBSERVATION_CHANGED');
  assert.equal(stale.calls.includes('discover'), false);
  for (const change of [r => { r.observation.branch = 'new'; }, r => { r.remote.url += '?new'; }, r => { r.observation.revision = 'c'.repeat(40); }]) {
    const raw = state(); let n = 0; const f = fixture({ raw, invokeGit: async () => {
      const value = structuredClone(raw); if (++n === 2) change(value); return envelope(value);
    } });
    assert.equal((await f.service.pull(f.request, () => context)).reason.code, 'E_OBSERVATION_CHANGED');
  }
});
test('connections require matched api user, allow admitted Enterprise only and preserve typed missing/version states', async () => {
  for (const [code, expected] of [['E_GH_MISSING', 'cli-not-installed'], ['E_GH_VERSION', 'unavailable']]) {
    const f = fixture({ discover: async () => ({ ok: false, code }) }); assert.equal((await f.service.connections({})).status, expected);
  }
  const notConnected = fixture({ configured: [] }); assert.equal((await notConnected.service.connections({})).status, 'not-connected');
  const ent = fixture({ configured: [...status(), ...status('github.corp')] });
  const base = await ent.service.connections({}), chosen = base.hosts.find(h => h.host === 'github.corp');
  const remote = await ent.service.connections({ hostRef: chosen.hostRef }); assert.equal(remote.host, 'github.corp'); assert.equal(remote.status, 'connected');
  assert.equal((await ent.service.connections({ host: 'attacker' })).reason.code, 'E_BAD_ARGS');
});
test('main resolves a connection reference against fresh status; changed account cannot authorize logout', async () => {
  let login = 'operator';
  const f = fixture({ run: async (_bin, args) => args[0] === 'auth' ? output(status('github.com', login)) : output(login) });
  const before = await f.service.connections({});
  assert.equal((await f.service.connections({ hostRef: before.connectionRef })).login, 'operator');
  login = 'different';
  assert.equal((await f.service.connections({ hostRef: before.connectionRef })).reason.code, 'E_CONNECTION_CHANGED');
});
test('same reads coalesce, auth epoch partitions them, and flights leave after rejection', async () => {
  const gate = deferred(); let count = 0;
  const f = fixture({ discover: async () => { count++; return gate.promise; } });
  const a = f.service.connections({}, 'client:0'), b = f.service.connections({}, 'client:0'), c = f.service.connections({}, 'client:1');
  await tick(); assert.equal(count, 2); gate.resolve(cli);
  const results = await Promise.all([a, b, c]); assert.equal(results[0], results[1]); assert.notEqual(results[0], results[2]);
  const failed = fixture({ discover: async () => { throw new Error('PRIVATE'); } });
  assert.equal((await failed.service.connections({})).reason.code, 'E_GH_FAILED');
  assert.doesNotMatch(JSON.stringify(await failed.service.connections({})), /PRIVATE/);
});
test('four-flight cap and bounded expiring references cannot be bypassed by distinct read epochs', async () => {
  const gate = deferred(); const f = fixture({ discover: () => gate.promise });
  const flights = [0, 1, 2, 3].map(i => f.service.connections({}, `client:${i}`));
  assert.equal((await f.service.connections({}, 'client:4')).reason.code, 'E_FORGE_BUSY');
  gate.resolve(cli); await Promise.all(flights);
  let time = 0; const expiry = fixture({ now: () => time }); const before = await expiry.service.connections({});
  time += 121_000; assert.equal((await expiry.service.connections({ hostRef: before.connectionRef })).reason.code, 'E_CONNECTION_CHANGED');
});
test('W6: the single-PR read counts unresolved review threads (GraphQL, the host auth); the count reaches the DTO', async () => {
  const threads = { data: { repository: { pullRequest: { reviewThreads: { totalCount: 2, pageInfo: { hasNextPage: false }, nodes: [{ isResolved: false }, { isResolved: true }] } } } } };
  const f = fixture({ run: async (_bin, args) => {
    f.calls.push(args);
    if (args[0] === 'auth') return output(status());
    if (args[0] === 'api' && args[1] === 'graphql') return output(threads);
    if (args[0] === 'api') return output('operator');
    return output(pr());
  } });
  const result = await f.service.pull(f.request, () => context);
  assert.equal(result.status, 'available'); assert.equal(result.data.unresolvedThreads, 1);
  const q = f.calls.find(a => a[0] === 'api' && a[1] === 'graphql');
  assert.deepEqual(q.slice(-6), ['-F', 'owner=owner', '-F', 'name=repo', '-F', 'number=42']);
});
