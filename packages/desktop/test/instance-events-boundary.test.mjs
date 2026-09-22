import test from 'node:test';
import assert from 'node:assert/strict';
import { createInstanceEventsBoundary } from '../server/instance-events.mjs';
import { cliInstanceEvents } from '../instance-events-cli.mjs';
import { context, target, request, data, envelope, deferred, tick } from './helpers/instance-events-fixture.mjs';

test('actual admitted read reaches fixed adapter with exact target/birth and projects producer output', async () => {
  const c = context(); let seen;
  const read = createInstanceEventsBoundary({ invoke: (cli, opts) => {
    seen = structuredClone(opts);
    return cliInstanceEvents(cli, opts, { env: {}, exec: (_bin, argv, _exec, cb) => {
      assert.deepEqual(argv, ['instance', 'events', target.selector.instance, '--dir', target.context, '--home', target.home, '--limit', '100', '--json']);
      cb(null, JSON.stringify(envelope()));
    } });
  } });
  const result = await read(request(), () => c);
  assert.deepEqual(seen, { target, limit: 100 }); assert.equal(result.status, 'available');
  assert.deepEqual(result.target, target); assert.equal(result.data.returned, 1);
});
for (const [label, alter, code] of [
  ['unknown workspace', c => c.workspace = null, 'E_WORKSPACE_UNKNOWN'],
  ['vanished instance', c => c.instances = [], 'E_SESSION_UNKNOWN'],
  ['duplicate exact selection', c => c.instances.push({ ...c.instances[0] }), 'E_AMBIGUOUS_INSTANCE'],
  ['other root', c => c.instances[0].agentsRoot = '/other/agents', 'E_SESSION_UNKNOWN'],
  ['wrong home', c => c.instances[0].home = '/other/instance', 'E_HOME_MISMATCH'],
  ['remote workspace', c => c.workspace.remote = true, 'unsupported-remote-operation'],
  ['server workspace', c => c.workspace.server = 'other', 'unsupported-remote-operation'],
  ['remote instance', c => c.instances[0].remote = true, 'unsupported-remote-operation'],
  ['captured instance', c => c.instances[0].captured = true, 'E_UNSUPPORTED_MODE'],
  ['captured workspace', c => c.workspace.captured = true, 'E_UNSUPPORTED_MODE'],
  ['unknown CLI', c => c.cli.ok = false, 'cli-unavailable'],
  ['old API', c => c.cli.eventsApi = 1, 'E_EVENTS_UNAVAILABLE'],
  ['coerced API', c => c.cli.eventsApi = '2', 'E_EVENTS_UNAVAILABLE'],
  ['old feature', c => c.cli.features = ['instance-events'], 'E_EVENTS_UNAVAILABLE'],
  ['malformed birth', c => c.instances[0].createdAt = 'guessed', 'E_HOME_MISMATCH'],
]) test(`${label} refuses at admission without exec/fallback`, async () => {
  const c = context(); alter(c); let calls = 0;
  const out = await createInstanceEventsBoundary({ invoke: () => { calls++; throw Error('PRIVATE'); } })(request(), () => c);
  assert.equal(out.reason?.code, code); assert.equal(calls, 0); assert.equal(out.data, null);
});
test('same-name row in another root neither steals identity nor makes exact selection ambiguous', async () => {
  const c = context(); c.instances.unshift({ ...c.instances[0], agentsRoot: '/other/agents', home: '/other/dev/instances/dev-a' });
  const out = await createInstanceEventsBoundary({ invoke: async () => envelope() })(request(), () => c);
  assert.equal(out.status, 'available'); assert.equal(out.target.home, target.home);
});
test('global two-slot cap/coalescing before await; success and rejection release; no settled cache', async () => {
  const c = context(), gates = []; let calls = 0;
  const invoke = () => { calls++; const gate = deferred(); gates.push(gate); return gate.promise; };
  const read = createInstanceEventsBoundary({ invoke });
  const a = read(request(), () => c), same = createInstanceEventsBoundary({ invoke })(request(), () => c), b = read(request({ limit: 50 }), () => c);
  try {
    assert.equal((await createInstanceEventsBoundary({ invoke: assert.fail })(request(), () => c)).reason?.code, 'E_BUSY');
    await tick(); assert.equal(calls, 2);
    gates[0].resolve(envelope()); gates[1].reject(Error('PRIVATE'));
    const one = await a, two = await same;
    assert.equal(one.status, 'available'); assert.deepEqual(one, two); assert.notEqual(one, two);
    one.data.events[0].data.agent = 'changed'; assert.equal(two.data.events[0].data.agent, 'dev');
    assert.equal((await b).reason?.code, 'E_CLI_FAILED');
    const next = read(request(), () => c); await tick(); assert.equal(calls, 3); gates[2].resolve(envelope()); await next;
  } finally { for (const gate of gates) gate.resolve(envelope()); await Promise.all([a, same, b]); }
});
for (const reject of [false, true]) for (const [label, alter] of [
  ['workspace', c => c.workspace.scope = '/other'], ['workspace ABA generation', c => { c.workspace.scope = '/other'; c.workspace.scope = '/inert/ws'; c.workspace.revision++; }],
  ['CLI', c => c.cli.bin = '/different/oats'], ['feature array', c => c.cli.features.length = 0],
  ['incarnation', c => c.instances[0].createdAt = '2026-09-23T00:00:00.000Z'], ['removed target', c => c.instances = []],
  ['epoch', c => c.epoch = 2],
]) test(`${label} revokes late ${reject ? 'rejection' : 'success'}`, async () => {
  const c = context(), gate = deferred();
  const pending = createInstanceEventsBoundary({ invoke: () => gate.promise })(request(), () => c);
  await tick(); alter(c);
  if (reject) gate.reject(Error('PRIVATE')); else gate.resolve(envelope());
  const out = await pending; assert.equal(out.reason?.code, 'E_TARGET_CHANGED'); assert.equal(out.data, null);
  assert.doesNotMatch(JSON.stringify(out), /PRIVATE/);
});
test('a superseded request cannot invoke from its scheduled microtask', async () => {
  const c = context(); let calls = 0;
  const pending = createInstanceEventsBoundary({ invoke: () => { calls++; return envelope(); } })(request(), () => c);
  c.instances = [];
  assert.equal((await pending).reason?.code, 'E_TARGET_CHANGED'); assert.equal(calls, 0);
});
test('coalesced callers validate independent ownership on completion', async () => {
  const a = context(), b = context(), gate = deferred(); let calls = 0;
  const read = createInstanceEventsBoundary({ invoke: () => { calls++; return gate.promise; } });
  const one = read(request(), () => a), two = read(request(), () => b); await tick(); a.instances = []; gate.resolve(envelope());
  assert.equal((await one).reason?.code, 'E_TARGET_CHANGED'); assert.equal((await two).status, 'available'); assert.equal(calls, 1);
});
test('context rejection cannot publish a settled read; domain results resolve', async () => {
  const c = context(), gate = deferred(); let disposed = false;
  const pending = createInstanceEventsBoundary({ invoke: () => gate.promise })(request(), () => { if (disposed) throw Error('PRIVATE'); return c; });
  await tick(); disposed = true; gate.reject(Error('PRIVATE'));
  assert.equal((await pending).reason?.code, 'E_TARGET_CHANGED');
});
test('request and CLI arguments are copied before await; no ambient mutation of caller objects', async () => {
  const c = context(), raw = request(), before = structuredClone(c), gate = deferred(); let args;
  const pending = createInstanceEventsBoundary({ invoke: (cli, options) => { args = options; cli.features.push('private-only'); return gate.promise; } })(raw, () => c);
  raw.selector.instance = 'changed'; await tick();
  assert.equal(args.target.selector.instance, 'dev-a'); assert.deepEqual(c, before);
  gate.resolve(envelope()); assert.equal((await pending).status, 'available');
});
for (const response of [null, {}, { ok: true, result: data() }, { schemaVersion: 1, ok: true, result: { ...data(), home: '/foreign' } }]) test(`malformed transport ${JSON.stringify(response).slice(0, 48)} cannot produce available data`, async () => {
  const out = await createInstanceEventsBoundary({ invoke: async () => response })(request(), context);
  assert.equal(out.reason?.code, 'E_CLI_PROTOCOL'); assert.equal(out.data, null);
});
test('producer mode refusal and unknown failure preserve no raw diagnostics or fallback', async () => {
  for (const code of ['E_UNSUPPORTED_MODE', 'E_HOME_MISMATCH', 'PRIVATE_UNKNOWN']) {
    let calls = 0;
    const out = await createInstanceEventsBoundary({ invoke: async () => { calls++; return { schemaVersion: 1, ok: false, error: { code, message: 'PRIVATE', details: { path: '/PRIVATE' } } }; } })(request(), context);
    assert.equal(out.reason?.code, code === 'PRIVATE_UNKNOWN' ? 'E_CLI_FAILED' : code); assert.equal(calls, 1);
    assert.doesNotMatch(JSON.stringify(out), /PRIVATE/);
  }
});
