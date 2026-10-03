// Spec D ("Needs input"): the waitingOnYou validator, its one liveness gate, the words and the collapsed roll-up.
// Pure module: no DOM, no server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { waitingOnYouData, waitingMessage, waitingClaim, waitingLabel, waitedText, waitingClock, waitingNames,
  waitingBelowText, waitingSentence, waitingRollup } from '../renderer/waiting-on-you.mjs';
import { collapseKey, instanceId } from '../renderer/instance-tree.mjs';

const since = '2026-10-03T10:00:00.000Z';
const claim = (extra = {}) => ({ since, producer: 'claude-hook', reason: 'permission', message: 'Allow Bash(rm -rf build)?', ...extra });

test('a valid claim validates to exactly { since, producer, reason, message }; extra keys are ignored', () => {
  assert.deepEqual(waitingOnYouData(claim({ future: { nested: true } })),
    { since, producer: 'claude-hook', reason: 'permission', message: 'Allow Bash(rm -rf build)?' });
});

for (const [label, value] of [
  ['null', null], ['a string', 'waiting'], ['an array', [claim()]], ['a number', 1],
  ['missing since', claim({ since: undefined })], ['a date-only since', claim({ since: '2026-10-03' })],
  ['a since without millis', claim({ since: '2026-10-03T10:00:00Z' })], ['an impossible since', claim({ since: '2026-02-30T00:00:00.000Z' })],
  ['an offset since', claim({ since: '2026-10-03T10:00:00.000+02:00' })], ['a numeric since', claim({ since: 1759485600000 })],
  ['missing producer', claim({ producer: undefined })], ['an empty producer', claim({ producer: '' })],
  ['a 257-char producer', claim({ producer: 'p'.repeat(257) })], ['a producer with a newline', claim({ producer: 'a\nb' })],
  ['a producer with a control char', claim({ producer: 'a\x07b' })], ['a producer that is a URL', claim({ producer: 'https://evil.example/x' })],
  ['a producer carrying a token', claim({ producer: 'token=abcdef' })], ['a producer carrying a GitHub token', claim({ producer: `ghp_${'a'.repeat(20)}` })],
  ['a non-string producer', claim({ producer: 7 })],
]) test(`a claim with ${label} is dropped (null), never thrown`, () => {
  assert.doesNotThrow(() => waitingOnYouData(value));
  assert.equal(waitingOnYouData(value), null);
});

test('a 256-char producer is accepted', () => {
  assert.equal(waitingOnYouData(claim({ producer: 'p'.repeat(256) })).producer, 'p'.repeat(256));
});

for (const [label, reason] of [['missing', undefined], ['null', null], ['a number', 3], ['an object', { kind: 'permission' }], ['over 64 chars', 'r'.repeat(65)]]) {
  test(`a ${label} reason keeps the claim with reason null (only since and producer drop a claim)`, () => {
    const value = claim(); if (reason === undefined) delete value.reason; else value.reason = reason;
    const out = waitingOnYouData(value);
    assert.ok(out); assert.equal(out.reason, null); assert.equal(out.producer, 'claude-hook');
  });
}
test('a 64-char unknown reason is kept verbatim for mapping', () => {
  assert.equal(waitingOnYouData(claim({ reason: 'r'.repeat(64) })).reason, 'r'.repeat(64));
});

for (const [label, message] of [['absent', undefined], ['null', null], ['empty', ''], ['a newline', 'line one\nline two'],
  ['a carriage return', 'a\rb'], ['a tab', 'a\tb'], ['a control char', 'a\x1bb'], ['DEL', 'a\x7fb'], ['201 chars', 'm'.repeat(201)],
  ['a number', 42], ['an object', { text: 'x' }]]) {
  test(`a message that is ${label} reads null and the claim is kept`, () => {
    const value = claim(); if (message === undefined) delete value.message; else value.message = message;
    const out = waitingOnYouData(value);
    assert.ok(out); assert.equal(out.message, null); assert.equal(out.since, since);
  });
}
test('a 200-char message is kept; markup is kept verbatim (rendered as text by the caller)', () => {
  assert.equal(waitingMessage('m'.repeat(200)), 'm'.repeat(200));
  assert.equal(waitingMessage('<b>x</b><script>alert(1)</script>'), '<b>x</b><script>alert(1)</script>');
});
test('an unsafe message (a URL, a token assignment) is withheld, never shown', () => {
  assert.equal(waitingMessage('open https://private.example/secret'), '[Detail withheld]');
  assert.equal(waitingMessage('password: hunter2'), '[Detail withheld]');
  assert.equal(waitingOnYouData(claim({ message: 'api_key=abc123' })).message, '[Detail withheld]');
});

test('reasons map to fixed words; an unknown or null reason reads "Needs input" and the raw value is never returned', () => {
  assert.equal(waitingLabel({ reason: 'permission' }), 'Waiting for a tool approval');
  assert.equal(waitingLabel({ reason: 'question' }), 'Asked you a question');
  assert.equal(waitingLabel({ reason: 'attention' }), 'Asked for your attention');
  for (const reason of ['approval', null, '', 'toString', '__proto__', 'constructor']) assert.equal(waitingLabel({ reason }), 'Needs input', String(reason));
  assert.equal(waitingLabel(null), 'Needs input');
});

test('waitedText floors into under a minute / min / h / d buckets; a future since reads under a minute', () => {
  const at = Date.parse(since), min = 60000, h = 60 * min;
  for (const [offset, text] of [[0, 'under a minute'], [59999, 'under a minute'], [-5 * min, 'under a minute'], [min, '1 min'],
    [59 * min + 59999, '59 min'], [60 * min, '1 h'], [23 * h + 59 * min, '23 h'], [24 * h, '1 d'], [3 * 24 * h + 5 * h, '3 d']]) {
    assert.equal(waitedText(since, at + offset), text, String(offset));
  }
  assert.equal(waitedText('not a date', at), 'under a minute');
});

test('waitingClock is the claim start in local HH:MM', () => {
  const local = new Date(since);
  const expected = `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`;
  assert.equal(waitingClock(since), expected);
  assert.match(waitingClock(since), /^\d{2}:\d{2}$/);
});

test('waitingNames lists up to three names, then "and N more"', () => {
  const rows = names => names.map(instance => ({ instance }));
  assert.equal(waitingNames(rows(['a'])), 'a');
  assert.equal(waitingNames(rows(['a', 'b', 'c'])), 'a, b, c');
  assert.equal(waitingNames(rows(['a', 'b', 'c', 'd', 'e'])), 'a, b, c and 2 more');
  assert.equal(waitingBelowText(rows(['a', 'b'])), '2 need input: a, b');
  assert.equal(waitingBelowText(rows(['a'])), '1 needs input: a');
});

test('waitingSentence (unavailable rows) names the message or label and an absolute time', () => {
  const at = waitingClock(since);
  assert.equal(waitingSentence(waitingOnYouData(claim())), ` · Needs input: Allow Bash(rm -rf build)? since ${at}`);
  assert.equal(waitingSentence(waitingOnYouData(claim({ message: null, reason: 'question' }))), ` · Needs input: Asked you a question since ${at}`);
  assert.equal(waitingSentence(null, [{ instance: 'dev-a' }, { instance: 'dev-b' }]), ' · 2 below need input: dev-a, dev-b');
  assert.equal(waitingSentence(null, []), '');
});

// The gate: Desktop liveness decides, whatever the kernel said.
const row = (extra = {}) => ({ instance: 'dev-1', running: true, runtimeState: 'running', waitingOnYou: claim(), ...extra });
test('waitingClaim: a running row (Desktop liveness running, or runtimeState absent) shows its claim', () => {
  assert.deepEqual(waitingClaim(row()), waitingOnYouData(claim()));
  const { runtimeState: _absent, ...noState } = row();
  assert.ok(waitingClaim(noState));
});
for (const [label, extra, options] of [
  ['tmux says shell', { running: false, runtimeState: 'shell' }], ['shell even if running were true', { runtimeState: 'shell' }],
  ['stopped', { running: false, runtimeState: 'stopped' }], ['unreachable', { running: null, runtimeState: 'unreachable' }],
  ['unsupported', { running: null, runtimeState: 'unsupported' }], ['running false', { running: false, runtimeState: undefined }],
  ['running null', { running: null, runtimeState: undefined }], ['running "true" (string)', { running: 'true' }],
  ['server unreached', { serverUnreached: true }], ['held stale', {}, { stale: true }],
  ['no claim', { waitingOnYou: null }], ['an absent claim', { waitingOnYou: undefined }], ['a malformed claim', { waitingOnYou: { since: 'now', producer: 'x' } }],
]) test(`waitingClaim: ${label} → null`, () => {
  assert.equal(waitingClaim(row(extra), options), null);
});
test('waitingClaim never throws on a non-record row', () => {
  for (const value of [null, undefined, 'row', 3, []]) assert.equal(waitingClaim(value), null);
});

// Roll-up: waiting rows hidden by a collapse, attributed to the nearest visible ancestor.
const ws = 'ws';
const inst = (name, parentInstance, extra = {}) => ({ instance: name, agent: 'dev', home: `/d/agents/dev/instances/${name}`, agentsRoot: '/d/agents',
  running: true, runtimeState: 'running', ...(parentInstance ? { parentInstance } : {}), ...extra });
const waiting = (name, parent, extra = {}) => inst(name, parent, { waitingOnYou: claim(), ...extra });
const collapsedOf = (...rows) => new Set(rows.map(r => collapseKey(ws, instanceId(r))));
const rollup = (rows, collapsed, options) => Object.fromEntries([...waitingRollup(rows, collapsed, ws, options)].map(([id, list]) => [id, list.map(r => r.instance)]));

test('a collapsed parent collects its hidden waiting children', () => {
  const root = inst('root'), a = waiting('dev-a', 'root'), b = waiting('dev-b', 'root'), quiet = inst('dev-c', 'root');
  assert.deepEqual(rollup([root, a, b, quiet], collapsedOf(root)), { [instanceId(root)]: ['dev-a', 'dev-b'] });
});
test('a grandchild under a collapsed root and a collapsed middle goes to the nearest VISIBLE ancestor', () => {
  const root = inst('root'), mid = inst('mid', 'root'), leaf = waiting('leaf', 'mid');
  assert.deepEqual(rollup([root, mid, leaf], collapsedOf(root, mid)), { [instanceId(root)]: ['leaf'] });
  assert.deepEqual(rollup([root, mid, leaf], collapsedOf(mid)), { [instanceId(mid)]: ['leaf'] });
});
test('a visible waiting row is not rolled up (expanding the parent removes the roll-up)', () => {
  const root = inst('root'), a = waiting('dev-a', 'root');
  assert.deepEqual(rollup([root, a], new Set()), {});
  const other = inst('other');
  assert.deepEqual(rollup([root, a, other], collapsedOf(other)), {});
});
test('filtering on: nothing is collapsed, no roll-up', () => {
  const root = inst('root'), a = waiting('dev-a', 'root');
  assert.deepEqual(rollup([root, a], collapsedOf(root), { filtering: true }), {});
});
test('a hidden row that is not running, or held stale, contributes nothing', () => {
  const root = inst('root'), shell = waiting('dev-a', 'root', { running: false, runtimeState: 'shell' }), stale = waiting('dev-b', 'root');
  assert.deepEqual(rollup([root, shell, stale], collapsedOf(root), { stale: r => r.instance === 'dev-b' }), {});
});
test('a parent cycle or a missing parent degrades to no roll-up, never a crash', () => {
  const a = waiting('a', 'b'), b = inst('b', 'a');
  assert.doesNotThrow(() => waitingRollup([a, b], collapsedOf(a, b), ws));
  assert.deepEqual(rollup([a, b], collapsedOf(a, b)), {});
  const orphan = waiting('orphan', 'ghost'), other = inst('other');
  assert.deepEqual(rollup([orphan, other], collapsedOf(other)), {});
});
test('a roll-up never crosses a remote server boundary', () => {
  const local = inst('root'), remote = waiting('dev-r', 'root', { server: 's1', home: '/r/agents/dev/instances/dev-r', agentsRoot: '/r/agents' });
  assert.deepEqual(rollup([local, remote], collapsedOf(local)), {});
});
