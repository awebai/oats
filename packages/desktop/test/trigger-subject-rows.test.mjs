import test from 'node:test';
import assert from 'node:assert/strict';
import { eventLabel, firedEntry, testResult, triggerStatus, onSummary } from '../renderer/automation-rows.mjs';
import { DETAIL_WITHHELD } from '../renderer/display-text.mjs';

// OATS 0.49 (#669) trigger fields: an event's `subject`, `wouldFire[].instance`/`nameCut`, and the
// `status` row's pending, live, lastPoll and lastError, projected for display (docs/desktop-cli-api.md
// § `oats trigger`). Every field is optional: an older kernel's answer projects as before.
const PR = 'github.pull_request';
const status = (row, opts) => triggerStatus({ triggers: [{ id: 'agents/pr-review', ...row }] }, 'agents/pr-review', opts);

test('eventLabel: the subject, else the number; # only for a pull request source; else the key; never "#null"', () => {
  assert.equal(eventLabel({ subject: '42', number: 42 }, PR), '#42');
  assert.equal(eventLabel({ subject: '42', number: 42 }, 'capability.event'), '42', 'any other source: the subject as plain text');
  assert.equal(eventLabel({ subject: 'release v2', number: null, key: 'k1' }, 'capability.event'), 'release v2');
  assert.equal(eventLabel({ number: 41 }, PR), '#41', 'pre-0.49: #<number> for a PR trigger, as before');
  assert.equal(eventLabel({ number: 41 }), '41', 'no source known: no #');
  assert.equal(eventLabel({ subject: null, number: null, key: 'cap:evt-7' }, PR), 'cap:evt-7', 'both absent: the key, never #null');
  assert.equal(eventLabel({ subject: 7, number: 'x', key: 'k' }, PR), 'k', 'wrong types are ignored');
  assert.equal(eventLabel({ subject: '  ', number: 9 }, PR), '#9', 'a subject with nothing to show is absent');
  assert.equal(eventLabel({}, PR), null); assert.equal(eventLabel(null, PR), null); assert.equal(eventLabel('42', PR), null);
  assert.equal(eventLabel({ subject: 'a‮b\u0007' }, 'x'), DETAIL_WITHHELD, 'a C0 control withholds it whole');
  assert.equal(eventLabel({ subject: 'a‮b' }, 'x'), 'a�b', 'a bidi override is replaced, never kept');
  assert.equal(eventLabel({ subject: 'token=abc123' }, PR), DETAIL_WITHHELD, 'withheld, and never prefixed');
});

test('firedEntry: a fire (or a list row lastRun) with its label, event in words and instance, filtered', () => {
  assert.deepEqual(firedEntry({ key: 'k', at: '2026-09-26T15:32:00.000Z', instance: 'rev-42', event: 'ready_for_review', number: 42, subject: '42' }, PR),
    { key: 'k', at: '2026-09-26T15:32:00.000Z', outcome: null, event: 'ready for review', label: '#42', instance: 'rev-42' });
  assert.deepEqual(firedEntry({ at: 'x', outcome: 'launched', number: 41 }, PR), { key: null, at: 'x', outcome: 'launched', event: null, label: '#41', instance: null });
  assert.equal(firedEntry('nope', PR), null);
});

test('testResult: wouldFire entries carry the label, the instance it would derive and whether the name was cut', () => {
  const t = testResult({ ok: true, wouldFire: [
    { key: 'k1', number: 1, subject: '1', instance: 'oats-okf--harvester-review-1', nameCut: false },
    { key: 'k2', number: 2, subject: '2', instance: 'oats-okf--harvester-review-pr-a1b2c3', nameCut: true, held: true },
    { key: 'k3', number: 3, instance: null, nameCut: null, held: true },
    { key: 'k4', number: 4, subject: '4', instance: 5, nameCut: true },
    'junk', null, { nothing: true },
  ] }, 'trigger', { source: PR });
  assert.deepEqual(t.wouldFire, [
    { key: 'k1', label: '#1', instance: 'oats-okf--harvester-review-1', nameCut: false, held: false },
    { key: 'k2', label: '#2', instance: 'oats-okf--harvester-review-pr-a1b2c3', nameCut: true, held: true },
    { key: 'k3', label: '#3', instance: null, nameCut: false, held: true },
    { key: 'k4', label: '#4', instance: null, nameCut: false, held: false },
  ], 'malformed entries skipped; a wrong-typed instance is absent, and so is its nameCut');
  assert.deepEqual(testResult({ wouldFire: [{ key: 'k', number: 7 }] }, 'trigger').wouldFire, [{ key: 'k', label: '7', instance: null, nameCut: false, held: false }],
    'a pre-0.49 entry; with no source passed, no #');
  assert.equal(testResult({ ok: true }, 'trigger').wouldFire, null, 'not reported: no would-fire line');
  assert.deepEqual(testResult({ wouldFire: [{ key: 'k', subject: 'x⁦y', instance: 'a\nb' }] }, 'trigger', { source: 'cap' }).wouldFire[0],
    { key: 'k', label: 'x�y', instance: 'a b', nameCut: false, held: false }, 'displayLine on every string');
});

test('triggerStatus: pending newest first (unparseable last, kernel order among ties), filtered and labelled', () => {
  const pending = Array.from({ length: 12 }, (_, i) => ({ key: `k${i}`, event: 'opened', number: i + 1, subject: String(i + 1), url: `https://x/${i}`, observedAt: `2026-09-26T15:${String(10 + i).padStart(2, '0')}:00.000Z` }));
  pending[3].observedAt = 'garbage'; delete pending[5].observedAt; pending[7].observedAt = pending[9].observedAt;
  const st = status({ pending: [...pending, 'junk', { key: null }] }, { source: PR });
  assert.equal(st.pending.length, 12, 'all kept for the count; the view shows 10 and "and 2 more"');
  assert.deepEqual(st.pending.map(e => e.label), ['#12', '#11', '#8', '#10', '#9', '#7', '#5', '#3', '#2', '#1', '#4', '#6'], '#8 and #10 tie: kernel order');
  assert.deepEqual(st.pending[0], { key: 'k11', label: '#12', event: 'opened', observedAt: '2026-09-26T15:21:00.000Z' });
  assert.deepEqual(status({ pending: [{ key: 'cap:1', event: 'ready_for_review', number: null, subject: 'deploy 7' }] }, { source: 'cap' }).pending,
    [{ key: 'cap:1', label: 'deploy 7', event: 'ready for review', observedAt: null }], 'a capability source: plain subject, no time');
  assert.deepEqual(status({ pending: [{ key: 'cap:2', number: null, subject: null }] }, { source: PR }).pending[0].label, 'cap:2', 'no subject or number: the key');
});

test('triggerStatus: live instances, last poll and the last error; malformed parts ignored', () => {
  const st = status({ liveCount: 2, live: [
    { instance: 'rev-42', home: '/h', repo: 'github.com/a/b', number: 42, subject: '42', event: 'opened' },
    { instance: 'cap-run', home: '/h2', repo: null, number: null, subject: 'deploy 7', event: 'x' },
    { home: '/h3' }, 7, null,
  ], lastPoll: { at: '2026-09-26T15:39:00.000Z', ok: true, prs: 12, matching: 3 },
  lastError: { at: '2026-09-26T15:38:00.000Z', code: 'E_INSTANCE_NAME_INVALID', message: 'The soul name is too long for a triggered spawn', key: 'k' } }, { source: PR });
  assert.deepEqual(st.live, [{ instance: 'rev-42', label: '#42', event: 'opened' }, { instance: 'cap-run', label: '#deploy 7', event: 'x' }],
    'an entry with nothing to show is skipped; the # follows the trigger source, never the entry');
  assert.deepEqual(st.lastPoll, { at: '2026-09-26T15:39:00.000Z', ok: true, prs: 12, matching: 3 });
  assert.deepEqual(st.lastError, { at: '2026-09-26T15:38:00.000Z', code: 'E_INSTANCE_NAME_INVALID', message: 'The soul name is too long for a triggered spawn', key: 'k' });
  const poll = lastPoll => status({ lastPoll }).lastPoll, at = '2026-09-26T15:39:00.000Z';
  assert.deepEqual(poll({ at, ok: false, error: 'gh: HTTP 502' }), { at, ok: false, error: 'gh: HTTP 502' });
  assert.deepEqual(poll({ at, ok: false, error: { code: 'E_GH', message: 'rate limited' } }), { at, ok: false, error: 'rate limited' });
  assert.deepEqual(poll({ at, ok: false, error: 'see https://user:pw@example.com/x' }), { at, ok: false, error: DETAIL_WITHHELD }, 'a credentialed URL is withheld');
  assert.deepEqual(poll({ at, ok: false }), { at, ok: false, error: null });
  for (const bad of [null, undefined, 'x', { ok: true }, { at: 'nope', ok: true, prs: 1, matching: 1 }, { at, ok: true, prs: -1, matching: 0 }, { at, ok: true, prs: 1.5, matching: 0 },
    { at, ok: true, prs: 2 ** 53, matching: 0 }, { at, ok: true, prs: '3', matching: 1 }, { at, ok: 'yes', prs: 1, matching: 1 }]) assert.equal(poll(bad), null, JSON.stringify(bad));
  assert.deepEqual(status({ lastError: { code: 'E_X', message: 'password: hunter2' } }).lastError, { at: null, code: 'E_X', message: DETAIL_WITHHELD, key: null }, 'a secret-looking message is withheld');
  assert.equal(status({ lastError: { at: 'x' } }).lastError, null, 'nothing to say: no error line');
  assert.equal(status({ lastError: { code: 'E_‮X', message: 'm n' } }).lastError.code, 'E_�X');
  assert.equal(status({ lastError: { code: 'E_X', message: 'm n' } }).lastError.message, 'm n');
});

test('an older kernel (no 0.49 fields) projects as before; repo null never prints "null"', () => {
  const st = status({ liveCount: 1, live: [{ instance: 'old-41', number: 41 }], fired: [{ key: 'k41', at: '2026-09-26T15:32:00.000Z', number: 41, event: 'opened' }], pending: [{ key: 'k43', number: 43, event: 'opened' }] }, { source: PR });
  assert.deepEqual([st.live[0].label, st.fired[0].label, st.pending[0].label, st.lastPoll, st.lastError], ['#41', '#41', '#43', null, null]);
  assert.deepEqual(status({}), { fired: [], firedTotal: null, live: [], liveCount: null, max: null, pending: [], lastPoll: null, lastError: null });
  // A capability source (#669 2b): repo null on the row and the trigger's `on`.
  assert.deepEqual(onSummary({ source: 'capability.release', repo: null, events: ['published'] }), { title: 'capability.release published', repo: null, labels: [], base: null, poll: null });
  assert.equal(status({ repo: null, fired: [{ key: 'cap:9', number: null, subject: null, event: 'published' }] }, { source: 'capability.release' }).fired[0].label, 'cap:9');
});
