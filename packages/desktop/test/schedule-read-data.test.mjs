import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleReadData, scheduleRecentRuns, scheduleReadIncomplete, scheduleDraft } from '../renderer/schedule-read-data.mjs';
import { scheduleReadFailure, scheduleSource } from '../renderer/schedule-read-contract.mjs';
import { scope, session, run, entry, data, request } from './helpers/schedule-read-fixture.mjs';
const project = (value = data(), input = request()) => scheduleReadData(value, scope, input);
const roundtrip = (value, input = request()) => {
  const out = project(value, input); assert.ok(out);
  assert.deepEqual(scheduleReadData(out, scope, input, { publicView: true }), out); return out;
};
test('actual list/show nesting, list-only integrity and separate lossless draft channel', () => {
  const list = roundtrip(data()); assert.equal(list.draft, null);
  assert.equal(list.schedules[0].task, undefined); assert.equal(list.schedules[0].wake, undefined);
  const show = roundtrip({ schedule: entry() }, request('nightly'));
  assert.equal(show.integrity, null); assert.equal(show.scheduler, null);
  assert.equal(show.draft.task, '  Full draft\r\nbytes  '); assert.equal(show.draft.wake.message, '  Wake\r\nbytes  ');
  assert.equal(show.draft.yolo, false); assert.equal(show.draft.purpose, 'review');
  show.draft.wake.message = 'changed'; assert.equal(entry().wake.message, '  Wake\r\nbytes  ');
});
for (const [label, change] of [
  ['scope', v => v.scope = '/other'], ['old API', v => v.scheduleHistoryApi = 2], ['string API', v => v.scheduleHistoryApi = '3'],
  ['missing integrity', v => delete v.integrity], ['duplicate source', v => v.integrity.sources[1] = v.integrity.sources[0]],
  ['absent bytes', v => v.integrity.sources[0] = { path: 'definitions', status: 'absent', bytes: 3 }],
  ['oversized ok', v => v.integrity.sources[0].bytes = 1048577], ['duplicate IDs', v => v.schedules.push(entry())],
  ['201 definitions', v => v.schedules = Array.from({ length: 201 }, (_, i) => entry({ id: `j${i}` }))],
  ['entry scope', v => v.schedules[0].scope = '/other'], ['entry API', v => v.schedules[0].scheduleHistoryApi = 4],
  ['option ID', v => v.schedules[0].id = '--run'], ['stored count', v => v.schedules[0].history.stored = 2],
  ['invented truncation', v => v.schedules[0].history.truncated = true], ['corrupt with rows', v => v.schedules[0].history.status = 'corrupt'],
]) test(`invalid ${label} cannot be available`, () => { const v = data(); change(v); assert.equal(project(v), null); });
test('canonical show ID/scope are exact, not outer aliases or a list fallback', () => {
  for (const raw of [{ scope, id: 'nightly', definition: entry() }, data(), { schedule: entry({ id: 'other' }) }, { schedule: entry({ scope: '/other' }) }]) assert.equal(project(raw, request('nightly')), null);
});
test('opaque producer identity/order retained; unknown→ended is one row, never manufactured success', () => {
  const out = roundtrip(data([entry({ recentRuns: [run({ runId: 'r0' })] })]));
  const r = out.schedules[0].recentRuns[0]; assert.equal(r.runId, 'r0'); assert.deepEqual(r.transitions, ['started', 'unknown', 'ended']);
  assert.equal(r.outcome, 'ended'); assert.equal(r.settled, true); assert.equal(out.schedules[0].lastRun.settled, undefined);
});
test('legacy rows never merge; missing recordedAt and settlement stay unknown', () => {
  const r = run({ runId: null, legacy: true, settled: null, transitions: null }); delete r.recordedAt;
  const out = roundtrip(data([entry({ history: { status: 'ok', stored: 2, truncated: false }, recentRuns: [r, { ...r, outcome: 'unknown' }] })]));
  const rows = out.schedules[0].recentRuns; assert.equal(rows.length, 2); assert.equal(rows[0].recordedAt, null); assert.equal(rows[0].settled, null);
  assert.equal(scheduleRecentRuns(out).length, 2);
});
test('corrupt elements stay visible and per-job corrupt history does not erase other jobs', () => {
  const out = roundtrip(data([entry({ recentRuns: [{ runId: null, legacy: true, corrupt: true }] }), entry({ id: 'bad', history: { status: 'corrupt', stored: null, truncated: false }, recentRuns: [] })]));
  assert.deepEqual(out.schedules[0].recentRuns[0], { runId: null, legacy: true, corrupt: true }); assert.equal(out.schedules[1].history.status, 'corrupt'); assert.equal(scheduleReadIncomplete(out), true);
});
test('list unreadable identity is isolated and its raw error is never public', () => {
  const bad = { id: 'bad', scope, scheduleApi: 2, scheduleHistoryApi: 3, unreadable: { code: 'E_SCHEDULE_IDENTITY', message: 'PRIVATE raw state' }, history: { status: 'corrupt', stored: null, truncated: false }, recentRuns: [] };
  const out = roundtrip(data([entry(), bad])); assert.equal(out.schedules.length, 2); assert.equal(out.schedules[1].unreadable.code, 'E_SCHEDULE_IDENTITY'); assert.doesNotMatch(JSON.stringify(out), /PRIVATE/);
  assert.equal(project({ schedule: bad }, request('bad')), null);
});
test('an unreadable malformed schedule key stays an isolated non-actionable row', () => {
  const bad = { id: '--option', scope, scheduleApi: 2, scheduleHistoryApi: 3, unreadable: { code: 'E_BAD_ARGS', message: 'PRIVATE' }, history: { status: 'corrupt', stored: null, truncated: false }, recentRuns: [] };
  const out = roundtrip(data([entry(), bad])); assert.equal(out.schedules.length, 2); assert.equal(out.schedules[1].id, '--option'); assert.equal(out.schedules[1].unreadable.code, 'E_BAD_ARGS');
  assert.equal(project({ schedule: bad }, { action: 'show', id: '--option' }), null);
});
test('stored61/returned50, workspace aggregate50 and no client-side dedup', () => {
  const rows = Array.from({ length: 50 }, () => run({ runId: 'same' }));
  const out = roundtrip(data([entry({ history: { status: 'ok', stored: 61, truncated: true }, recentRuns: rows }), entry({ id: 'another' })]));
  assert.equal(out.schedules[0].recentRuns.length, 50); assert.equal(scheduleRecentRuns(out).length, 50); assert.equal(scheduleReadIncomplete(out), true);
});
test('malformed date strings cannot create dates/durations; active delivery is not a launch claim', () => {
  const out = roundtrip(data([entry({ recentRuns: [run({ startedAt: 's0', session: { ...session(), instance: null, delivery: 'delivered-active' } })] })]));
  const r = out.schedules[0].recentRuns[0]; assert.equal(r.startedAt, null); assert.equal(r.invalidTimes, true); assert.equal(r.session.instance, null); assert.equal(r.session.delivery, 'delivered-active');
});
for (const [label, extra] of [['false settlement', { pending: true, settled: true }], ['bad transitions', { transitions: ['started'] }], ['empty transitions', { transitions: [] }], ['huge transitions', { transitions: Array(257).fill('ended') }], ['modern missing recording date', { recordedAt: undefined }], ['bad legacy', { legacy: true }], ['no session', { session: null }], ['raw session transcript', { session: { transcript: '/PRIVATE' } }]]) test(`${label} is corrupt, not trusted run facts`, () => {
  const out = roundtrip(data([entry({ recentRuns: [run(extra)] })])); assert.equal(out.schedules[0].recentRuns[0].corrupt, true);
});
test('no raw task/env/argv/diagnostics/transcript/host path; credentials and URLs redacted', () => {
  const v = data([entry({ task: 'PRIVATE', env: { PRIVATE: 'secret' }, argv: ['PRIVATE'], home: 'https://user:password@host/path', recentRuns: [run({ error: 'PRIVATE', reason: 'PRIVATE', env: 'PRIVATE', transcript: '/PRIVATE', session: { ...session(), home: 'https://host/private', server: 'token=PRIVATE' } })] })]);
  v.scheduler.unit = '/PRIVATE'; v.scheduler.workspaces = ['PRIVATE'];
  const out = roundtrip(v); assert.doesNotMatch(JSON.stringify(out), /PRIVATE|https:|transcript|argv|env/); assert.equal(out.schedules[0].recentRuns[0].hasError, true);
});
for (const key of ['definitionVersion', 'recurrencePolicy', 'execution', 'preparation', 'executionBinding', 'responsibleHuman']) test(`${key} blocks editable draft even when null`, () => {
  const v = entry({ [key]: null }); const out = roundtrip({ schedule: v }, request('nightly'));
  assert.equal(out.draft, null); assert.equal(out.schedules[0].editReason, 'captured'); assert.equal(scheduleDraft(v), null);
});
test('unpreservable legacy inputs and command kind get no invented default or stripped policy', () => {
  for (const v of [entry({ tz: undefined }), entry({ kind: 'command', argv: ['oats', 'PRIVATE'] }), entry({ backend: 'future' }), entry({ runtime: 'future' }), entry({ wake: { cron: '* * * * *', tz: 'UTC', message: 'wake', enabled: false } })]) {
    const out = roundtrip({ schedule: v }, request('nightly')); assert.equal(out.draft, null); assert.ok(out.schedules[0].editReason);
  }
});
test('public reprojection cannot switch scope/job/action or smuggle a list draft', () => {
  const out = project();
  for (const bad of [{ ...out, scope: '/other' }, { ...out, action: 'show' }, { ...out, draft: entry() }]) assert.equal(scheduleReadData(bad, scope, request(), { publicView: true }), null);
  const show = project({ schedule: entry() }, request('nightly')); show.draft.id = 'other'; assert.equal(scheduleReadData(show, scope, request('nightly'), { publicView: true }), null);
});
test('typed logical refusal source facts survive while raw diagnostics/identity details do not', () => {
  const source = { path: 'state', status: 'oversize', bytes: 1100026, filename: '/PRIVATE' };
  assert.deepEqual(scheduleReadFailure('E_SCHEDULE_STATE_OVERSIZE', scope, { source, stack: 'PRIVATE' }).reason.details, { source: { path: 'state', status: 'oversize', bytes: 1100026 } });
  assert.equal(scheduleReadFailure('E_SCHEDULE_IDENTITY', scope, { key: 'secret', declared: 'PRIVATE' }).reason.details, undefined);
  assert.equal(scheduleSource({ ...source, path: '/PRIVATE' }), null); assert.equal(scheduleSource({ ...source, bytes: -1 }), null);
});
