import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleReadId, scheduleReadSupported, scheduleReadRequest, scheduleReadAlias, scheduleReadFailure,
  CAPTURED_SCHEDULE_EDIT_UNAVAILABLE, SCHEDULE_TRANSCRIPT_UNAVAILABLE } from '../renderer/schedule-read-contract.mjs';
import { cliScheduleRead, SCHEDULE_READ_TIMEOUT, SCHEDULE_READ_MAX_BUFFER } from '../schedule-read-cli.mjs';
const cli = { ok: true, bin: '/inert/oats', scheduleApi: 2, scheduleHistoryApi: 3, features: ['schedule-read-2'] };
const context = '/inert/workspace';
// Transport-only fixtures with the merged API3 nesting; full DTO tests are separate.
const result = (action = 'list', id = 'Daily.Job_1') => action === 'show' ? { schedule: { scope: context, id } } : { scope: context };
const envelope = value => ({ schemaVersion: 1, ok: true, result: value });
const execReply = (doc, error = null) => (_bin, _argv, _opts, cb) => cb(error, JSON.stringify(doc));

test('read fence is exact History API3/new feature, independent of version and mutation API', () => {
  assert.equal(scheduleReadSupported(cli), true);
  assert.equal(scheduleReadSupported({ ...cli, version: undefined, scheduleApi: undefined }), true);
  assert.equal(scheduleReadSupported({ ...cli, features: ['schedule', 'schedule-history', 'schedule-read-2'] }), true);
});
for (const [label, status] of [
  ['missing CLI', null], ['failed CLI', { ...cli, ok: false }], ['coerced ok', { ...cli, ok: 1 }],
  ['relative binary', { ...cli, bin: 'oats' }], ['binary NUL', { ...cli, bin: '/oats\0' }], ['oversize binary', { ...cli, bin: '/' + 'x'.repeat(4096) }],
  ['old API', { ...cli, scheduleHistoryApi: 2 }], ['missing API', { ...cli, scheduleHistoryApi: undefined }],
  ['string API', { ...cli, scheduleHistoryApi: '3' }], ['boolean API', { ...cli, scheduleHistoryApi: true }],
  ['future API', { ...cli, scheduleHistoryApi: 4 }], ['old history feature', { ...cli, features: ['schedule', 'schedule-history'] }],
  ['missing feature', { ...cli, features: [] }], ['string features', { ...cli, features: 'schedule-read-2' }],
  ['version-only', { ok: true, bin: '/inert/oats', version: '99.0.0', scheduleApi: 2, features: ['schedule'] }],
]) test(`actual read exec refuses ${label} before process work`, async () => {
  assert.equal(scheduleReadSupported(status), false); let calls = 0;
  const out = await cliScheduleRead(status, { context, action: 'list' }, { exec: () => { calls++; throw Error('must not run'); } });
  assert.equal(out.error?.code, 'E_SCHEDULE_READ_UNAVAILABLE'); assert.equal(calls, 0);
});

test('new and legacy READ spellings normalize without sharing a mutation adapter', () => {
  for (const action of ['list', 'show']) {
    const req = { action, ...(action === 'show' ? { id: 'Daily.Job_1' } : {}) };
    assert.deepEqual(scheduleReadRequest(req), req);
    assert.deepEqual(scheduleReadAlias({ operation: action, ...(action === 'show' ? { id: req.id } : {}) }), req);
    assert.notEqual(scheduleReadRequest(req), req);
  }
  assert.equal(scheduleReadRequest({ action: 'list', id: undefined }), null, 'list never silently discards an ID');
  assert.equal(scheduleReadAlias({ operation: 'list', id: null }), null);
  assert.equal(scheduleReadAlias({ operation: 'list', action: 'list' }), null);
  assert.equal(scheduleReadRequest({ action: 'list', context }), null, 'public input cannot supply private context');
  assert.equal(scheduleReadAlias({ operation: 'list', context }), null);
});
for (const id of ['A', 'Daily.Job_1', 'a'.repeat(128)]) test(`bounded non-option schedule ID retained exactly (${id.length})`, async () => {
  assert.equal(scheduleReadId(id), true); assert.equal(scheduleReadRequest({ action: 'show', id }).id, id);
  const out = await cliScheduleRead(cli, { context, action: 'show', id }, { exec: (_b, argv, _o, cb) => {
    assert.deepEqual(argv, ['schedule', 'show', id, '--dir', context, '--json']); cb(null, JSON.stringify(envelope(result('show', id))));
  } });
  assert.equal(out.ok, true);
});
for (const id of [undefined, null, false, 1, '', '-x', '--force', '../other', 'a/b', 'a b', 'a\nflag', 'a\0', '.hidden', '_hidden', 'a'.repeat(129)]) test(`invalid schedule ID ${JSON.stringify(id)} refuses without command`, async () => {
  assert.equal(scheduleReadId(id), false);
  assert.equal(scheduleReadRequest({ action: 'show', id }), null);
  assert.equal(scheduleReadAlias({ operation: 'show', id }), null);
  assert.equal((await cliScheduleRead(cli, { context, action: 'show', id }, { exec: assert.fail })).error?.code, 'E_BAD_ARGS');
});
for (const action of ['add', 'update', 'enable', 'disable', 'remove', 'run', 'tick', 'reconcile', 'host-install', 'host-status', 'attach']) test(`read lane never dispatches ${action}`, async () => {
  assert.equal(scheduleReadRequest({ action, id: 'daily' }), null);
  assert.equal(scheduleReadAlias({ operation: action, id: 'daily' }), null);
  assert.equal((await cliScheduleRead(cli, { context, action, id: 'daily' }, { exec: assert.fail })).error?.code, 'E_BAD_ARGS');
});
for (const [key, value] of [['spec', {}], ['task', 'PRIVATE'], ['home', '/home'], ['file', '/file'], ['cwd', '/other'], ['server', 'remote'], ['force', true], ['clear', true], ['env', {}], ['since', 'now'], ['cursor', 'next'], ['limit', 1]]) test(`request/alias/transport reject caller ${key}`, async () => {
  assert.equal(scheduleReadRequest({ action: 'list', [key]: value }), null);
  assert.equal(scheduleReadAlias({ operation: 'list', [key]: value }), null);
  assert.equal((await cliScheduleRead(cli, { context, action: 'list', [key]: value }, { exec: assert.fail })).error?.code, 'E_BAD_ARGS');
});
test('fixed read argv/cwd/30s/4MiB, no shell/temp files/env selector inheritance or budget override', async () => {
  for (const action of ['list', 'show']) {
    const env = { PATH: '/inert/bin', HOME: '/inert/home', OATS_HOME_DIR: '/inert/host-registry', PI_AGENTS_ROOT: '/foreign', OATS_DEPLOYMENT: '/captured', OATS_RESOLUTION: '/capture.json' };
    let seen;
    const out = await cliScheduleRead(cli, { context, action, ...(action === 'show' ? { id: 'Daily.Job_1' } : {}) }, {
      env, timeout: 9999999, maxBuffer: 999999999, exec: (bin, argv, options, cb) => { seen = { bin, argv, options }; cb(null, JSON.stringify(envelope(result(action)))); },
    });
    assert.equal(out.ok, true); assert.equal(seen.bin, cli.bin);
    assert.deepEqual(seen.argv, ['schedule', action, ...(action === 'show' ? ['Daily.Job_1'] : []), '--dir', context, '--json']);
    assert.equal(seen.options.cwd, context); assert.equal(seen.options.shell, false); assert.equal(seen.options.encoding, 'utf8');
    assert.equal(seen.options.timeout, 30000); assert.equal(SCHEDULE_READ_TIMEOUT, 30000);
    assert.equal(seen.options.maxBuffer, 4194304); assert.equal(SCHEDULE_READ_MAX_BUFFER, 4194304);
    assert.deepEqual(seen.options.env, { PATH: '/inert/bin', HOME: '/inert/home', OATS_HOME_DIR: '/inert/host-registry' });
    assert.equal(env.OATS_RESOLUTION, '/capture.json', 'caller environment untouched');
  }
});
test('private context is bounded syntax, not renderer path authority; malformed options resolve', async () => {
  for (const ctx of [undefined, null, '', 'relative', '/x\0', '/x\n', '/' + 'x'.repeat(4096)]) {
    assert.equal((await cliScheduleRead(cli, { action: 'list', context: ctx }, { exec: assert.fail })).error?.code, 'E_BAD_ARGS');
  }
  for (const opts of [null, [], {}, { context, action: 'list', id: 'unused' }, { context, operation: 'list' }]) {
    assert.equal((await cliScheduleRead(cli, opts, { exec: assert.fail })).error?.code, 'E_BAD_ARGS');
  }
});
for (const [error, code] of [[{ killed: true }, 'E_CLI_TIMEOUT'], [{ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }, 'E_CLI_OUTPUT_LIMIT'], [{ code: 1 }, 'E_CLI_FAILED']]) test(`clean-exit rule refuses valid-looking data on ${code}`, async () => {
  const out = await cliScheduleRead(cli, { context, action: 'list' }, { exec: execReply(envelope(result()), error) });
  assert.equal(out.ok, false); assert.equal(out.error?.code, code);
});
test('byte cap, single envelope, string output and exact scope echo are enforced before any projection', async () => {
  for (const stdout of [undefined, Buffer.from('{}'), 'PRIVATE', '{}', JSON.stringify({ schemaVersion: 2, ok: true, result: result() }),
    JSON.stringify(envelope([])), JSON.stringify(envelope({})), JSON.stringify(envelope({ scope: '/other' }))]) {
    const out = await cliScheduleRead(cli, { context, action: 'list' }, { exec: (_b, _a, _o, cb) => cb(null, stdout) });
    assert.equal(out.error?.code, 'E_CLI_PROTOCOL'); assert.doesNotMatch(JSON.stringify(out), /PRIVATE/);
  }
  const raw = JSON.stringify(envelope({ ...result(), padding: '🚫'.repeat(1048576) }));
  assert.equal((await cliScheduleRead(cli, { context, action: 'list' }, { exec: (_b, _a, _o, cb) => cb(null, raw) })).error?.code, 'E_CLI_OUTPUT_LIMIT');
});
test('show requires the actual nested canonical job and scope, not an invented definition echo', async () => {
  for (const bad of [{ schedule: { scope: context, id: 'other' } }, { scope: context, id: 'Daily.Job_1' }, { schedule: { scope: '/other', id: 'Daily.Job_1' } }, { schedule: [] }, { schedule: { id: 'Daily.Job_1' } }]) {
    assert.equal((await cliScheduleRead(cli, { context, action: 'show', id: 'Daily.Job_1' }, { exec: execReply(envelope(bad)) })).error?.code, 'E_CLI_PROTOCOL');
  }
});
test('typed producer refusal retained, raw diagnostics withheld, no retry on callback/throw failure', async () => {
  for (const code of ['E_SCHEDULE_STATE_OVERSIZE', 'E_SCHEDULE_IDENTITY', 'E_SCHEDULE_UNKNOWN', 'E_SCHEDULE_INVALID', 'PRIVATE_UNKNOWN']) {
    let calls = 0;
    const out = await cliScheduleRead(cli, { context, action: 'list' }, { exec: (_b, _a, _o, cb) => {
      calls++; cb({ code: 1 }, JSON.stringify({ schemaVersion: 1, ok: false, error: { code, message: 'PRIVATE', details: { path: '/PRIVATE', stack: 'PRIVATE' } } }));
    } });
    assert.equal(calls, 1); assert.equal(out.error?.code, code === 'PRIVATE_UNKNOWN' ? 'E_CLI_FAILED' : code);
    assert.doesNotMatch(JSON.stringify(out), /PRIVATE/);
  }
  assert.equal((await cliScheduleRead(cli, { context, action: 'list' }, { exec: () => { throw Error('PRIVATE'); } })).error?.code, 'E_CLI_FAILED');
});
test('malformed producer error codes cannot throw from an asynchronous process callback', async () => {
  for (const code of [null, [], 1, true, { toString: null }, { toString: 'PRIVATE' }]) {
    const out = await cliScheduleRead(cli, { context, action: 'list' }, { exec: (_b, _a, _o, cb) => queueMicrotask(() => cb({ code: 1 }, JSON.stringify({ schemaVersion: 1, ok: false, error: { code, message: 'PRIVATE' } }))) });
    assert.equal(out.error.code, 'E_CLI_FAILED'); assert.doesNotMatch(JSON.stringify(out), /PRIVATE/);
  }
});
test('failure wrapper is fixed/bounded and missing transcript/captured-edit contracts are honest', () => {
  assert.deepEqual(scheduleReadFailure('E_BUSY', context), { scheduleReadViewApi: 1, status: 'unavailable', scope: context, data: null,
    reason: { code: 'E_BUSY', message: 'Two schedule reads are already in progress. Retry when one finishes.' } });
  assert.equal(scheduleReadFailure('constructor', '/x\0').reason.code, 'E_CLI_FAILED');
  assert.equal(scheduleReadFailure('E_BAD_ARGS', '/x\0').scope, null);
  assert.equal(CAPTURED_SCHEDULE_EDIT_UNAVAILABLE, 'this schedule carries an execution policy the editor cannot preserve; edit via CLI');
  assert.match(SCHEDULE_TRANSCRIPT_UNAVAILABLE, /provenance, not a transcript.*K12/);
});
