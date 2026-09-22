import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsSupported, eventsSelector, eventsRequest, eventsTarget, eventsFailure } from '../renderer/instance-events-contract.mjs';
import { cliInstanceEvents, EVENTS_CLI_TIMEOUT, EVENTS_CLI_MAX_BUFFER } from '../instance-events-cli.mjs';
const cli = { ok: true, bin: '/fixture/bin/oats', version: '0.24.12', eventsApi: 2, features: ['instance-events-2'] };
const selector = { instance: 'dev-probe', agent: 'dev', agentsRoot: '/team/agents', server: null };
const target = { workspace: 'team', context: '/team', selector, home: '/team/agents/dev/instances/dev-probe', incarnation: '2026-09-22T00:00:00.000Z' };
const request = extra => ({ action: 'read', selector, ...extra });
// Transport-only fixture, deliberately NOT a claimed complete producer receipt.
// Full result/claim projection is qualified after the K7b merge + stored receipts.
const envelope = result => ({ schemaVersion: 1, ok: true, result: { eventsApi: 2, ...result } });
const execResult = (doc, err = null) => (_bin, _argv, _opts, cb) => cb(err, JSON.stringify(doc));

test('API2 + explicit feature, never a version-only or old feature fence', () => {
  assert.equal(eventsSupported(cli), true);
  assert.equal(eventsSupported({ ...cli, version: undefined }), true, 'version is not the mode fence');
  assert.equal(eventsSupported({ ...cli, features: ['instance-events', 'instance-events-2'] }), true);
});
for (const [label, status] of [
  ['absent CLI', null], ['failed discovery', { ...cli, ok: false }], ['coerced ok', { ...cli, ok: 1 }],
  ['relative binary', { ...cli, bin: 'oats' }], ['binary NUL', { ...cli, bin: '/oats\0' }],
  ['oversize binary', { ...cli, bin: '/' + 'x'.repeat(4096) }],
  ['API1', { ...cli, eventsApi: 1 }], ['absent API', { ...cli, eventsApi: undefined }],
  ['string API', { ...cli, eventsApi: '2' }], ['boolean API', { ...cli, eventsApi: true }],
  ['future API', { ...cli, eventsApi: 3 }], ['old feature only', { ...cli, features: ['instance-events'] }],
  ['string features', { ...cli, features: 'instance-events-2' }], ['missing features', { ...cli, features: undefined }],
]) test(`exec owner refuses ${label} before process work`, async () => {
  assert.equal(eventsSupported(status), false);
  let calls = 0;
  const r = await cliInstanceEvents(status, { target }, { exec: () => { calls++; throw Error('must not run'); } });
  assert.equal(r.error.code, 'E_EVENTS_UNAVAILABLE'); assert.equal(calls, 0);
});

test('bounded request copies exact selector and defaults to100 without mutating input', () => {
  const raw = structuredClone(request());
  const parsed = eventsRequest(raw);
  assert.deepEqual(parsed, { action: 'read', selector, limit: 100 });
  assert.equal(Object.hasOwn(raw, 'limit'), false);
  raw.selector.instance = 'other'; assert.equal(parsed.selector.instance, selector.instance);
  const admitted = eventsTarget(target);
  assert.deepEqual(admitted, target); assert.notEqual(admitted.selector, selector);
});
for (const limit of [50, 100, 200]) test(`approved limit${limit} stays an exact integer argv`, async () => {
  assert.equal(eventsRequest(request({ limit })).limit, limit);
  let seen;
  const result = await cliInstanceEvents(cli, { target, limit }, { exec: (bin, argv, opts, cb) => {
    seen = { bin, argv, opts }; cb(null, JSON.stringify(envelope()));
  }, env: { PATH: '/fixture/bin', HOME: '/fixture/home', PI_AGENTS_ROOT: '/other', OATS_DEPLOYMENT: '/captured', OATS_RESOLUTION: '/captured/resolution.json' } });
  assert.equal(result.ok, true);
  assert.equal(seen.bin, cli.bin);
  assert.deepEqual(seen.argv, ['instance', 'events', selector.instance, '--dir', '/team', '--home', target.home, '--limit', String(limit), '--json']);
  assert.equal(seen.opts.cwd, target.context); assert.equal(seen.opts.shell, false); assert.equal(seen.opts.encoding, 'utf8');
  assert.equal(seen.opts.timeout, 15_000); assert.equal(EVENTS_CLI_TIMEOUT, 15_000);
  assert.equal(seen.opts.maxBuffer, 4 * 1024 * 1024); assert.equal(EVENTS_CLI_MAX_BUFFER, 4 * 1024 * 1024);
  assert.deepEqual(seen.opts.env, { PATH: '/fixture/bin', HOME: '/fixture/home' });
});
for (const limit of [undefined, null, false, '100', 0, 1, 49, 51, 100.1, 201, Infinity, NaN]) test(`invalid explicit limit ${String(limit)} is not defaulted/coerced`, async () => {
  assert.equal(eventsRequest(request({ limit })), null);
  let calls = 0;
  assert.equal((await cliInstanceEvents(cli, { target, limit }, { exec: () => calls++ })).error.code, 'E_BAD_ARGS');
  assert.equal(calls, 0);
});
for (const [key, value] of [['since', '2026-01-01'], ['cursor', 'next'], ['home', '/elsewhere'], ['cwd', '/elsewhere'], ['env', {}], ['command', 'spawn'], ['path', '/log'], ['server', 'remote'], ['task', 'PRIVATE']]) test(`request refuses caller ${key}`, async () => {
  assert.equal(eventsRequest(request({ [key]: value })), null);
  const result = await cliInstanceEvents(cli, { target, [key]: value }, { exec: assert.fail });
  assert.equal(result.error.code, 'E_BAD_ARGS');
});
test('selectors reject malformed, remote and path-authority extensions', () => {
  assert.deepEqual(eventsSelector(selector), selector);
  for (const v of [null, [], {}, { ...selector, instance: '--json' }, { ...selector, instance: '../other' },
    { ...selector, instance: 'a'.repeat(257) }, { ...selector, agent: 'dev\nflag' }, { ...selector, agent: '' },
    { ...selector, agentsRoot: 'relative' }, { ...selector, agentsRoot: '/x\0' }, { ...selector, agentsRoot: '/' + 'a'.repeat(4096) },
    { ...selector, server: 'remote' }, { ...selector, server: undefined }, { ...selector, home: target.home }, { ...selector, incarnation: 'guessed' }]) {
    assert.equal(eventsSelector(v), null); assert.equal(eventsRequest({ action: 'read', selector: v }), null);
  }
  for (const v of [null, [], {}, { action: 'clear', selector }, { action: 'read', selector, target }, { action: 'watch', selector }]) assert.equal(eventsRequest(v), null);
});
test('admitted target syntactic validation is strict but does not replace roster admission', async () => {
  for (const v of [null, [], { ...target, workspace: '' }, { ...target, context: 'relative' }, { ...target, context: '/x\n' },
    { ...target, home: '/team/agents/dev/instances/other' }, { ...target, home: target.home + '/' },
    { ...target, selector: { ...selector, server: 'remote' } }, { ...target, home: 'relative/dev-probe' }]) {
    assert.equal(eventsTarget(v), null);
    assert.equal((await cliInstanceEvents(cli, { target: v }, { exec: assert.fail })).error.code, 'E_BAD_ARGS');
  }
  for (const options of [null, [], {}, { target, argv: ['spawn'] }]) assert.equal((await cliInstanceEvents(cli, options, { exec: assert.fail })).error.code, 'E_BAD_ARGS');
});
test('omitted transport limit defaults, no ambient mutation or caller budget override', async () => {
  const env = { PATH: '/fixture/bin', OATS_RESOLUTION: '/captured' };
  await cliInstanceEvents(cli, { target }, { env, timeout: 999999, maxBuffer: 999999999, exec: (_b, argv, opts, cb) => {
    assert.equal(argv[argv.indexOf('--limit') + 1], '100'); assert.equal(opts.timeout, 15000); assert.equal(opts.maxBuffer, 4194304);
    assert.equal(opts.env.OATS_RESOLUTION, undefined); cb(null, JSON.stringify(envelope()));
  } });
  assert.equal(env.OATS_RESOLUTION, '/captured');
});
for (const [err, expected] of [[{ killed: true }, 'E_CLI_TIMEOUT'], [{ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }, 'E_CLI_OUTPUT_LIMIT'], [{ code: 1 }, 'E_CLI_FAILED']]) test(`clean-exit rule ${expected}`, async () => {
  const r = await cliInstanceEvents(cli, { target }, { exec: execResult(envelope(), err) });
  assert.equal(r.ok, false); assert.equal(r.error.code, expected);
});
test('non-JSON, old API, non-string or oversized UTF8 output never passes', async () => {
  for (const stdout of ['PRIVATE', '', undefined, Buffer.from('{}'), JSON.stringify(envelope({ eventsApi: 1 })), JSON.stringify(envelope({ eventsApi: '2' })), JSON.stringify({ schemaVersion: 2, ok: true, result: { eventsApi: 2 } })]) {
    const r = await cliInstanceEvents(cli, { target }, { exec: (_b, _a, _o, cb) => cb(null, stdout) });
    assert.equal(r.error?.code, 'E_CLI_PROTOCOL'); assert.doesNotMatch(JSON.stringify(r), /PRIVATE/);
  }
  const huge = JSON.stringify(envelope({ detail: '🚫'.repeat(1048576) }));
  const r = await cliInstanceEvents(cli, { target }, { exec: (_b, _a, _o, cb) => cb(null, huge) });
  assert.equal(r.error?.code, 'E_CLI_OUTPUT_LIMIT');
});
test('typed refusals, callback errors and synchronous failures resolve without raw diagnostics', async () => {
  for (const code of ['E_NOT_IN_SCOPE', 'E_BAD_ARGS', 'E_UNSUPPORTED_MODE', 'PRIVATE_UNKNOWN']) {
    let calls = 0;
    const r = await cliInstanceEvents(cli, { target }, { exec: (_b, _a, _o, cb) => {
      calls++; cb({ code: 1 }, JSON.stringify({ schemaVersion: 1, ok: false, error: { code, message: 'PRIVATE', details: { path: 'PRIVATE', stack: 'PRIVATE' } } }));
    } });
    assert.equal(calls, 1); assert.equal(r.error.code, code === 'PRIVATE_UNKNOWN' ? 'E_CLI_FAILED' : code);
    assert.doesNotMatch(JSON.stringify(r), /PRIVATE/);
  }
  const r = await cliInstanceEvents(cli, { target }, { exec: () => { throw Error('PRIVATE'); } });
  assert.equal(r.error.code, 'E_CLI_FAILED'); assert.doesNotMatch(JSON.stringify(r), /PRIVATE/);
});
test('failure wrapper projects its target and never reflects arbitrary error objects', () => {
  const out = eventsFailure('E_BUSY', { ...target, token: 'PRIVATE' });
  assert.deepEqual(out.target, target); assert.equal(out.instanceEventsViewApi, 1); assert.equal(out.status, 'unavailable');
  assert.equal(out.data, null); assert.equal(out.reason.code, 'E_BUSY'); assert.doesNotMatch(JSON.stringify(out), /PRIVATE/);
  assert.equal(eventsFailure('constructor').reason.code, 'E_CLI_FAILED');
  assert.equal(eventsFailure('E_BAD_ARGS', { home: '/bad' }).target, null);
});
