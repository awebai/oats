import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsData, eventsIncomplete, eventIncarnation } from '../renderer/instance-events-data.mjs';
import { target, birth, event, data } from './helpers/instance-events-fixture.mjs';

test('address history preserves earlier/current/unknown incarnations without runtime inference', () => {
  const rows = [event({ incarnation: '2025-01-01T00:00:00.000Z' }), event({ incarnation: null }), event()];
  const out = eventsData(data(rows), target);
  assert.ok(out); assert.deepEqual(out.events.map(r => eventIncarnation(r, out)), ['earlier', 'unknown', 'current']);
  assert.equal(out.waitingOnYou, null); assert.equal(Object.hasOwn(out, 'running'), false);
  assert.equal(eventsIncomplete(out), false);
  assert.deepEqual(eventsData(out, target, 100, { publicView: true }), out);
});
test('empty is recorded-empty, not idle/not-waiting; absent sources remain typed', () => {
  const value = data([]); value.integrity.sources.forEach(s => { s.status = 'absent'; s.bytes = 0; });
  const out = eventsData(value, target); assert.ok(out); assert.equal(out.returned, 0);
  assert.equal(out.lastEvent, null); assert.equal(out.waitingOnYou, null); assert.deepEqual(out.waitingClaims, []);
  assert.equal(eventsIncomplete(out), false);
});
for (const [label, alter] of [
  ['torn', v => v.integrity.unreadableRows = 2], ['foreign', v => v.integrity.foreignRows = 1],
  ['refused home', v => { v.integrity.sources[0].status = 'refused'; v.integrity.sources[0].bytes = 0; }],
  ['tail source', v => { v.integrity.sources[0].status = 'tail'; v.integrity.sources[0].bytes = 5000000; v.truncated = true; }],
]) test(`${label} incompleteness survives even an empty selected window`, () => {
  const value = data([]); alter(value);
  const out = eventsData(value, target); assert.ok(out); assert.equal(out.returned, 0); assert.equal(eventsIncomplete(out), true);
  assert.deepEqual(out.integrity, value.integrity);
});
test('source byte count is total size, not bytes read; window count is observed rows, not current instances', () => {
  const rows = Array.from({ length: 50 }, () => event()); const value = data(rows);
  value.count = 9535; value.truncated = true; value.integrity.sources[0] = { path: 'home', status: 'tail', bytes: 5000000 };
  const out = eventsData(value, target, 50); assert.ok(out); assert.equal(out.count, 9535); assert.equal(out.returned, 50);
  assert.equal(eventsData(value, target, 100), null, 'echo must agree with the requested limit');
  assert.equal(out.events.length, 50, 'never dedup already projected rows by guessed identity');
});
test('positive claims are attributed; cleared producers stay false and top must match newest positive', () => {
  const value = data();
  value.waitingClaims = [{ producer: 'provider.a', waiting: true, since: '2026-09-22T01:00:00.000Z', reason: 'review requested' },
    { producer: 'provider.b', waiting: true, since: '2026-09-22T02:00:00.000Z', reason: 'answer requested' },
    { producer: 'provider.c', waiting: false, since: '2026-09-22T03:00:00.000Z', reason: null }];
  value.waitingOnYou = { producer: 'provider.b', since: '2026-09-22T02:00:00.000Z', reason: 'answer requested' };
  const out = eventsData(value, target); assert.ok(out); assert.equal(out.waitingOnYou.producer, 'provider.b'); assert.equal(out.waitingClaims[2].waiting, false);
  assert.deepEqual(eventsData(out, target, 100, { publicView: true }), out);
  value.waitingOnYou.producer = 'provider.a'; assert.equal(eventsData(value, target), null);
});
test('claim can predate row window; consumer does not infer a clear from absence in selected rows', () => {
  const value = data(Array.from({ length: 50 }, () => event())); value.count = 500; value.truncated = true;
  value.waitingClaims = [{ producer: 'provider.a', waiting: true, since: birth, reason: null }];
  value.waitingOnYou = { producer: 'provider.a', since: birth, reason: null };
  assert.ok(eventsData(value, target, 50));
});
test('null incarnation never licenses a current waiting state, even from a previously tagged row', () => {
  const value = data(); value.incarnation = null;
  assert.ok(eventsData(value, { ...target, incarnation: null }), 'address history remains observable, not current-incarnation proof');
  value.waitingClaims = [{ producer: 'old', waiting: true, since: birth, reason: null }];
  value.waitingOnYou = { producer: 'old', since: birth, reason: null };
  assert.equal(eventsData(value, { ...target, incarnation: null }), null);
  value.waitingClaims[0].waiting = false; value.waitingOnYou = null;
  assert.equal(eventsData(value, { ...target, incarnation: null }), null, 'an unknown incarnation cannot certify cleared state either');
});
for (const [label, alter] of [
  ['API1 result', v => v.eventsApi = 1], ['wrong address', v => v.home = '/elsewhere'], ['wrong name', v => v.instance = 'other'],
  ['wrong birth', v => v.incarnation = '2025-01-01T00:00:00.000Z'], ['invalid birth', v => v.incarnation = 'today'],
  ['future row', v => v.events[0].eventsApi = 3], ['foreign row', v => v.events[0].home = '/foreign'],
  ['foreign row name', v => v.events[0].instance = 'other'], ['row missing birth', v => delete v.events[0].incarnation],
  ['invalid ISO', v => v.events[0].at = '2026-02-30T00:00:00.000Z'], ['row count', v => v.returned = 0],
  ['unsafe count', v => v.count = Number.MAX_SAFE_INTEGER + 1], ['missing truncation', v => v.count = 500],
  ['false truncation', v => v.truncated = true], ['stale summary', v => v.lastEvent.kind = 'stopped'],
  ['missing summary', v => v.lastEvent = null], ['incorrect summary birth', v => v.lastEvent.incarnation = null],
  ['negative corruption', v => v.integrity.unreadableRows = -1], ['source missing', v => v.integrity.sources.pop()],
  ['source duplicated', v => v.integrity.sources[1].path = 'home'], ['source filesystem path', v => v.integrity.sources[0].path = '/private/log'],
  ['tail without flag', v => { v.integrity.sources[0].status = 'tail'; v.integrity.sources[0].bytes = 5000000; }],
  ['oversize ok source', v => v.integrity.sources[0].bytes = 5000000], ['absent with bytes', v => v.integrity.sources[0].status = 'absent'],
  ['unbacked rows', v => v.integrity.sources.forEach(s => { s.status = 'refused'; s.bytes = 0; })],
  ['invented waiting', v => v.waitingOnYou = { producer: 'x', since: birth, reason: null }],
  ['oversize claims', v => v.waitingClaims = Array(201).fill({ producer: 'x', waiting: false, since: birth, reason: null })],
  ['nonboolean claim', v => v.waitingClaims = [{ producer: 'x', waiting: 'false', since: birth, reason: null }]],
  ['duplicate claim', v => v.waitingClaims = Array(2).fill({ producer: 'x', waiting: false, since: birth, reason: null })],
  ['false reason', v => v.waitingClaims = [{ producer: 'x', waiting: false, since: birth, reason: 'not current' }]],
  ['unbounded reason', v => v.events[0].data.reason = 'x'.repeat(2049)],
]) test(`malformed or contradictory ${label} refuses instead of certifying healthy evidence`, () => {
  const value = data(); alter(value); assert.equal(eventsData(value, target), null);
});
test('rows must preserve producer chronology; earlier-incarnation last row is not replaced with current', () => {
  const value = data([event({ at: '2026-09-22T02:00:00.000Z' }), event()]); assert.equal(eventsData(value, target), null);
  const earlier = data([event({ incarnation: '2025-01-01T00:00:00.000Z', kind: 'retired', data: {} })]);
  const out = eventsData(earlier, target); assert.equal(out.lastEvent.kind, 'retired'); assert.equal(eventIncarnation(out.lastEvent, out), 'earlier');
});
test('allowlisted facts redact reason credentials/URLs, omit task/env/commands and expose target counts only', () => {
  const value = data([event({ kind: 'stopped', data: { signal: 'SIGTERM', waitedMs: 10, state: 'shell', stillRunning: [{ pid: 123, comm: 'PRIVATE' }],
    reason: 'token=PRIVATE', task: 'PRIVATE', env: { secret: 'PRIVATE' }, command: 'PRIVATE' } })]);
  value.notes = ['PRIVATE']; value.recipe = 'PRIVATE';
  const out = eventsData(value, target); assert.ok(out);
  assert.deepEqual(out.events[0].data, { signal: 'SIGTERM', state: 'shell', waitedMs: 10, reason: '[Detail withheld]', stillRunningCount: 1 });
  assert.doesNotMatch(JSON.stringify(out), /PRIVATE|"pid"|"comm"|"task"|"env"|"recipe"/);
  assert.deepEqual(eventsData(out, target, 100, { publicView: true }), out);
  value.events[0].data.reason = 'visit https://private.example/secret'; assert.equal(eventsData(value, target).events[0].data.reason, '[Detail withheld]');
});
test('unknown kinds remain explicit rows, not fabricated current activity or silently omitted', () => {
  const value = data([event({ kind: 'future-kind', data: { task: 'PRIVATE' } })]);
  const out = eventsData(value, target); assert.equal(out.events.length, 1); assert.equal(out.lastEvent.kind, 'future-kind');
  assert.deepEqual(out.events[0].data, {}); assert.equal(out.waitingOnYou, null);
});
test('projection owns copied data and does not mutate producer rows, claims or integrity', () => {
  const raw = data(), before = structuredClone(raw), out = eventsData(raw, target);
  assert.deepEqual(raw, before); out.events[0].data.agent = 'changed'; out.integrity.sources[0].bytes = 0;
  assert.deepEqual(raw, before);
});
