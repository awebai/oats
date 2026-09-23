import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduleReadBoundary } from '../server/schedule-read.mjs';
import { cliScheduleRead } from '../schedule-read-cli.mjs';
import { context, scope, request, data, entry, envelope, deferred, tick } from './helpers/schedule-read-fixture.mjs';
test('admitted list/show reaches actual fixed transport and private projection with copied scope/job', async () => {
  for (const id of [undefined, 'nightly']) {
    const c = context(); let seen;
    const out = await createScheduleReadBoundary({ invoke: (cli, opts) => cliScheduleRead(cli, opts, { exec: (_b, argv, _o, cb) => {
      seen = argv; cb(null, JSON.stringify(envelope(id ? { schedule: entry() } : data())));
    } }) })(request(id), () => c);
    assert.equal(out.status, 'available'); assert.equal(out.workspace, 'ws'); assert.equal(out.scope, scope);
    assert.deepEqual(seen, ['schedule', id ? 'show' : 'list', ...(id ? [id] : []), '--dir', scope, '--json']);
  }
});
for (const [label, alter, code] of [
  ['unknown', c => c.workspace = null, 'E_WORKSPACE_UNKNOWN'], ['bad scope', c => c.workspace.scope = 'relative', 'E_WORKSPACE_UNKNOWN'],
  ['remote', c => c.workspace.remote = true, 'unsupported-remote-operation'], ['server', c => c.workspace.server = 'peer', 'unsupported-remote-operation'],
  ['CLI missing', c => c.cli.ok = false, 'cli-unavailable'], ['old API', c => c.cli.scheduleHistoryApi = 2, 'E_SCHEDULE_READ_UNAVAILABLE'],
  ['coerced API', c => c.cli.scheduleHistoryApi = '3', 'E_SCHEDULE_READ_UNAVAILABLE'], ['old feature', c => c.cli.features = ['schedule-history'], 'E_SCHEDULE_READ_UNAVAILABLE'],
]) test(`${label} refuses before any exec`, async () => {
  const c = context(); alter(c);
  const out = await createScheduleReadBoundary({ invoke: assert.fail })(request(), () => c); assert.equal(out.reason?.code, code);
});
test('two slots global across factories/invokers, exact inflight coalescing, both outcomes release, no settled cache', async () => {
  const c = context(), gates = []; let calls = 0;
  const invoke = () => { calls++; const g = deferred(); gates.push(g); return g.promise; };
  const read = createScheduleReadBoundary({ invoke });
  const a = read(request(), () => c), same = createScheduleReadBoundary({ invoke })(request(), () => c), b = read(request('nightly'), () => c);
  try {
    assert.equal((await createScheduleReadBoundary({ invoke: assert.fail })(request(), () => c)).reason.code, 'E_BUSY');
    await tick(); assert.equal(calls, 2); gates[0].resolve(envelope()); gates[1].reject(Error('PRIVATE'));
    const one = await a, two = await same; assert.deepEqual(one, two); assert.notEqual(one, two);
    one.data.schedules[0].id = 'changed'; assert.equal(two.data.schedules[0].id, 'nightly'); assert.equal((await b).reason.code, 'E_CLI_FAILED');
    const next = read(request(), () => c); await tick(); assert.equal(calls, 3); gates[2].resolve(envelope()); await next;
  } finally { for (const g of gates) g.resolve(envelope()); await Promise.all([a, same, b]); }
});
for (const reject of [false, true]) for (const [label, alter] of [
  ['workspace scope', c => c.workspace.scope = '/other'], ['workspace ID', c => c.workspace.id = 'other'], ['workspace removed', c => c.workspace = null],
  ['ABA revision', c => c.workspace.revision++], ['roots', c => c.workspace.roots.push('/other/agents')], ['epoch', c => c.epoch++],
  ['CLI path', c => c.cli.bin = '/other/oats'], ['mode', c => c.cli.scheduleHistoryApi = 2], ['features', c => c.cli.features.length = 0],
]) test(`${label} revokes late ${reject ? 'failure' : 'success'}`, async () => {
  const c = context(), g = deferred();
  const pending = createScheduleReadBoundary({ invoke: () => g.promise })(request(), () => c);
  await tick(); alter(c); if (reject) g.reject(Error('PRIVATE')); else g.resolve(envelope());
  const out = await pending; assert.equal(out.reason?.code, 'E_TARGET_CHANGED'); assert.equal(out.data, null); assert.doesNotMatch(JSON.stringify(out), /PRIVATE/);
});
test('changed admission before scheduled dispatch never invokes', async () => {
  const c = context(); let calls = 0;
  const pending = createScheduleReadBoundary({ invoke: () => { calls++; return envelope(); } })(request(), () => c);
  c.workspace = null; assert.equal((await pending).reason.code, 'E_TARGET_CHANGED'); assert.equal(calls, 0);
});
test('coalesced waiters retain independent both-path lifetime and no shared mutable result', async () => {
  for (const reject of [false, true]) {
    const a = context(), b = context(), g = deferred(); let calls = 0;
    const read = createScheduleReadBoundary({ invoke: () => { calls++; return g.promise; } });
    const one = read(request(), () => a), two = read(request(), () => b); await tick(); a.workspace = null;
    if (reject) g.reject(Error()); else g.resolve(envelope());
    assert.equal((await one).reason.code, 'E_TARGET_CHANGED'); assert.equal((await two).status, reject ? 'unavailable' : 'available'); assert.equal(calls, 1);
  }
});
test('input and CLI copy, getContext failures resolve safely', async () => {
  const c = context(), input = request('nightly'), g = deferred(); let disposed = false, seen;
  const pending = createScheduleReadBoundary({ invoke: (cli, opts) => { seen = opts; cli.features.push('private'); return g.promise; } })(input, () => { if (disposed) throw Error('PRIVATE'); return c; });
  input.id = 'changed'; await tick(); assert.equal(seen.id, 'nightly'); assert.equal(c.cli.features.includes('private'), false);
  disposed = true; g.reject(Error('PRIVATE')); assert.equal((await pending).reason.code, 'E_TARGET_CHANGED');
});
test('read gate is not mutation authority and malformed requests cannot reach adapter', async () => {
  const c = context(); delete c.cli.scheduleApi; c.cli.features = ['schedule-read-2'];
  assert.equal((await createScheduleReadBoundary({ invoke: async () => envelope() })(request(), () => c)).status, 'available');
  for (const input of [null, {}, { action: 'run', id: 'nightly' }, { action: 'list', spec: {} }, { operation: 'list' }]) {
    assert.equal((await createScheduleReadBoundary({ invoke: assert.fail })(input, () => c)).reason.code, 'E_BAD_ARGS');
  }
});
test('typed failure source facts retained; private errors and malformed producer results withheld', async () => {
  const c = context();
  const fail = { schemaVersion: 1, ok: false, error: { code: 'E_SCHEDULE_STATE_OVERSIZE', message: 'PRIVATE', details: { source: { path: 'state', status: 'oversize', bytes: 2000000, secret: 'PRIVATE' } } } };
  const out = await createScheduleReadBoundary({ invoke: async () => fail })(request(), () => c);
  assert.equal(out.reason.details.source.bytes, 2000000); assert.doesNotMatch(JSON.stringify(out), /PRIVATE/);
  for (const v of [null, { ok: true, result: data() }, envelope({ ...data(), scope: '/other' })]) assert.equal((await createScheduleReadBoundary({ invoke: async () => v })(request(), () => c)).reason.code, 'E_CLI_PROTOCOL');
});
