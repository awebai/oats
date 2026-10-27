// The machine sweep's reader (packages/client/session-resume.mjs): `oats session resume --json` read into a
// summary of facts, the boundary decoder main and the renderer share, and the notice in the clients' words.
// The answers are hand-written from the agreed kernel contract (the kernel is built in parallel); their
// warnings and messages are examples, not the kernel's sentences. Every sentence of the notice is pinned here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readResumeSweep, resumeSummaryFact, resumeNotice, RESUME_SUMMARY_ROWS, RESUME_SUMMARY_DEPLOYMENTS, RESUME_ANSWER_ENTRIES } from '../../client/session-resume.mjs';
import { boundedWarnings, FLAG_IGNORED_WARNINGS, FLAG_IGNORED_UNITS } from '../../client/launch-prompt-outcome.mjs';
import { DETAIL_WITHHELD, MAX_DISPLAY_LINE } from '../../client/display-text.mjs';

const A = '/home/ana/agents', B = '/home/ana/work/team';
const answer = (rows = [], deployments = [], extra = {}) => ({ schemaVersion: 1, ok: true, result: { schemaVersion: 1, plan: false, deployments, rows, ...extra } });
const row = (instance, outcome, more = {}) => ({ deployment: A, instance, home: `${A}/agents/x/instances/${instance}`, outcome, ...more });
const refusal = (code, message = 'm') => ({ schemaVersion: 1, ok: false, error: { code, message } });
const summaryOf = (...args) => readResumeSweep(answer(...args)).summary;
const label = (d) => d.replace(/^\/home\/ana/, '~');
const notice = (...args) => resumeNotice(summaryOf(...args), { label });
const lines = (n) => n.detail.split('\n');
const totals = (resumed = 0, fresh = 0, waiting = 0, refused = 0) => ({ resumed, fresh, waiting, refused });
const empty = { resumed: [], fresh: [], waiting: [], refused: [], optedOut: [], unswept: [], omitted: 0, totals: totals() };

test('reader: a refusal reads as unsupported, busy or failed with its code', () => {
  assert.deepEqual(readResumeSweep(refusal('E_CLI_UNAVAILABLE')), { kind: 'unsupported' });
  assert.deepEqual(readResumeSweep(refusal('E_RESUME_FEATURE')), { kind: 'unsupported' });
  assert.deepEqual(readResumeSweep(refusal('E_RESUME_BUSY')), { kind: 'busy' });
  assert.deepEqual(readResumeSweep(refusal('E_CLI_OUTPUT_LIMIT')), { kind: 'failed', code: 'E_CLI_OUTPUT_LIMIT' });
  assert.deepEqual(readResumeSweep(refusal('E_CLI_FAILED')), { kind: 'failed', code: 'E_CLI_FAILED' });
  // A code not of the kernel's form is never relayed.
  for (const code of ['e_lower', 'E_', 'E_BAD-CODE', `E_${'X'.repeat(65)}`, 'token=abc', 7, null, undefined]) {
    assert.deepEqual(readResumeSweep(refusal(code)), { kind: 'failed', code: 'E_CLI_PROTOCOL' }, String(code));
  }
  assert.deepEqual(readResumeSweep({ schemaVersion: 1, ok: false }), { kind: 'failed', code: 'E_CLI_PROTOCOL' });
  assert.deepEqual(readResumeSweep({ schemaVersion: 1, ok: false, error: 'E_RESUME_BUSY' }), { kind: 'failed', code: 'E_CLI_PROTOCOL' });
});

test('reader: an answer that is not the document is a protocol failure, never read in part', () => {
  const failed = { kind: 'failed', code: 'E_CLI_PROTOCOL' };
  const result = { schemaVersion: 1, plan: false, deployments: [], rows: [] };
  for (const bad of [null, undefined, 'x', [], {}, { ok: true }, { ok: 'true', result }]) assert.deepEqual(readResumeSweep(bad), failed);
  for (const r of [null, [], { ...result, schemaVersion: 2 }, { ...result, schemaVersion: undefined }, { ...result, plan: 'false' },
    { ...result, plan: undefined }, { ...result, rows: {} }, { ...result, rows: undefined }, { ...result, deployments: null },
    { ...result, rows: new Array(RESUME_ANSWER_ENTRIES + 1).fill(null) },
    { ...result, deployments: new Array(RESUME_ANSWER_ENTRIES + 1).fill(null) }]) {
    assert.deepEqual(readResumeSweep({ schemaVersion: 1, ok: true, result: r }), failed);
  }
  // At the bound it is read; extra keys of the kernel's are tolerated.
  assert.equal(readResumeSweep({ schemaVersion: 1, ok: true, result: { ...result, rows: new Array(RESUME_ANSWER_ENTRIES).fill(null), more: 1 } }).kind, 'quiet');
});

test('reader: every outcome and reason, unknown reasons as null', () => {
  const s = summaryOf([
    row('r1', 'resumed', { sessionId: 's' }),
    row('f1', 'fresh', { reason: 'no-conversation' }), row('f2', 'fresh', { reason: 'no-receipts' }),
    row('f3', 'fresh', { reason: 'resume-unproven' }), row('f4', 'fresh', { reason: 'later-reason' }), row('f5', 'fresh'),
    row('b1', 'blocked', { reason: 'resume-confirmation' }),
    row('b2', 'blocked', { reason: 'launch-prompt', code: 'E_SPAWN_INCOMPLETE', launchPrompts: { status: 'blocked' } }),
    row('b3', 'blocked', { reason: 'other' }),
    row('x1', 'refused', { reason: 'start-refused', code: 'E_START_REFUSED', message: 'the harness is not installed' }),
    row('x2', 'refused', { reason: 'refused-this-boot', code: 'E_RESUME_REFUSED', message: 'refused earlier' }),
    row('x3', 'refused', { reason: 'nope', code: 'bad code' }),
    row('a1', 'already-running'),
    row('s1', 'skipped', { reason: 'unknown' }), row('s2', 'skipped', { reason: 'start-busy' }), row('s3', 'skipped', { reason: 'not-lost' }),
    row('u1', 'vanished'), row('u2', undefined), row('u3', 'RESUMED'),
  ]);
  assert.deepEqual(s, {
    resumed: [{ instance: 'r1', deployment: A, warnings: [], omitted: 0 }],
    fresh: [
      { instance: 'f1', deployment: A, reason: 'no-conversation', warnings: [], omitted: 0 },
      { instance: 'f2', deployment: A, reason: 'no-receipts', warnings: [], omitted: 0 },
      { instance: 'f3', deployment: A, reason: 'resume-unproven', warnings: [], omitted: 0 },
      { instance: 'f4', deployment: A, reason: null, warnings: [], omitted: 0 },
      { instance: 'f5', deployment: A, reason: null, warnings: [], omitted: 0 },
    ],
    waiting: [
      { instance: 'b1', deployment: A, reason: 'resume-confirmation' },
      { instance: 'b2', deployment: A, reason: 'launch-prompt' },
      { instance: 'b3', deployment: A, reason: null },
    ],
    refused: [
      { instance: 'x1', deployment: A, reason: 'start-refused', code: 'E_START_REFUSED', message: 'the harness is not installed' },
      { instance: 'x2', deployment: A, reason: 'refused-this-boot', code: 'E_RESUME_REFUSED', message: 'refused earlier' },
      { instance: 'x3', deployment: A, reason: null, code: null, message: null },
    ],
    optedOut: [], unswept: [], omitted: 0, totals: totals(1, 5, 3, 3),
  });
});

test('reader: deployments: opted out, unswept with its reason or null, swept ones not shown', () => {
  const s = summaryOf([], [
    { deployment: A, state: 'ok', swept: true },
    { deployment: B, state: 'ok', swept: false, reason: 'opted-out' },
    { deployment: '/srv/c', state: 'not-ok', swept: false, reason: 'not-ok', code: 'E_X', message: 'm' },
    { deployment: '/srv/d', state: 'unreadable', swept: false, reason: 'unreadable' },
    { deployment: '/srv/e', state: 'ok', swept: false },
    { deployment: '/srv/f', state: 'ok', reason: 'tomorrow' },
    { deployment: '/srv/g', swept: true, reason: 'opted-out' },
    null, 'x', { deployment: 7, swept: false }, { deployment: '', swept: false }, { deployment: '/srv/token=abcdef', swept: false },
  ]);
  assert.deepEqual(s.optedOut, [B, '/srv/g']);
  assert.deepEqual(s.unswept, [
    { deployment: '/srv/c', reason: 'not-ok' }, { deployment: '/srv/d', reason: 'unreadable' },
    { deployment: '/srv/e', reason: null }, { deployment: '/srv/f', reason: null },
  ]);
});

test('reader: quiet when only running or skipped rows, or only deployment lines, or a plan', () => {
  const only = answer([row('a', 'already-running'), row('b', 'skipped', { reason: 'not-lost' })]);
  assert.deepEqual(readResumeSweep(only), { kind: 'quiet', summary: empty });
  const lines = readResumeSweep(answer([row('a', 'already-running')], [{ deployment: A, swept: false, reason: 'opted-out' }, { deployment: B, swept: false, reason: 'unreadable' }]));
  assert.equal(lines.kind, 'quiet');
  assert.deepEqual(lines.summary.optedOut, [A]);
  assert.equal(resumeNotice(lines.summary, { label }), null);
  // A plan started nothing: its rows and deployments are not read, and it is the empty summary.
  const plan = answer([row('r', 'resumed'), row('x', 'refused', { code: 'E_X' })], [{ deployment: A, swept: false, reason: 'opted-out' }], { plan: true });
  assert.deepEqual(readResumeSweep(plan), { kind: 'quiet', summary: empty });
  assert.deepEqual(readResumeSweep(answer()), { kind: 'quiet', summary: empty });
  assert.equal(readResumeSweep(answer([row('r', 'resumed')])).kind, 'notice');
  for (const outcome of ['fresh', 'blocked', 'refused']) assert.equal(readResumeSweep(answer([row('r', outcome)])).kind, 'notice');
});

test('reader: a withheld or empty name or path drops the row; names and messages are display lines', () => {
  const s = summaryOf([
    row('token=abc123secret', 'resumed'), row('ok-one', 'resumed', { deployment: '/srv/password=hunter2' }),
    row('', 'resumed'), row('  \n ', 'fresh'), row(7, 'resumed'), row('no-dep', 'resumed', { deployment: undefined }),
    null, 'row', [row('arr', 'resumed')],
    row('two\nlines', 'resumed', { deployment: `${A}\t` }),
    row('quoted', 'refused', { message: 'token=abc123secret' }),
    row('folded', 'refused', { message: 'line one\nline two' }),
  ]);
  assert.deepEqual(s.resumed, [{ instance: 'two lines', deployment: A, warnings: [], omitted: 0 }]);
  assert.deepEqual(s.refused.map((r) => r.message), [DETAIL_WITHHELD, 'line one line two']);
  assert.deepEqual(s.totals, totals(1, 0, 0, 2));
});

test('reader: warnings are display lines, the withheld marker shown, cut by position and never matched', () => {
  const kernelish = 'OATS resumed 3 instances whose sessions were lost.';
  const s = summaryOf([
    row('r', 'resumed', { warnings: ['first', 'token=abc123secret', '', 7, null, kernelish, 'It is waiting for you: open its terminal.'] }),
    row('f', 'fresh', { reason: 'no-receipts', warnings: 'not an array' }),
  ]);
  assert.deepEqual(s.resumed[0].warnings, ['first', DETAIL_WITHHELD, kernelish, 'It is waiting for you: open its terminal.']);
  assert.equal(s.resumed[0].omitted, 0);
  assert.deepEqual(s.fresh[0].warnings, []);
  // A warning that reads like a sentence of the notice changes nothing: the headline is the counts'.
  const n = resumeNotice(s, { label });
  assert.equal(n.headline, 'OATS resumed 2 instances whose sessions were lost. 1 of them started fresh from its briefing.');
  assert.deepEqual(lines(n), [
    'f: started fresh from its briefing, OATS has no record of where its conversations are kept.',
    'r: resumed in its own conversation.', 'OATS says:', 'first', DETAIL_WITHHELD, kernelish, 'It is waiting for you: open its terminal.',
  ]);

  // The line bound: the first FLAG_IGNORED_WARNINGS lines, in order, the rest counted.
  const many = Array.from({ length: FLAG_IGNORED_WARNINGS + 4 }, (_, i) => i === 3 ? kernelish : `w${i}`);
  const cut = summaryOf([row('r', 'resumed', { warnings: many })]).resumed[0];
  assert.deepEqual(cut.warnings, many.slice(0, FLAG_IGNORED_WARNINGS));
  assert.equal(cut.omitted, 4);
  assert.deepEqual(cut, { instance: 'r', deployment: A, ...boundedWarnings(many) });
  const tail = lines(resumeNotice(summaryOf([row('r', 'resumed', { warnings: many })]), { label }));
  assert.equal(tail.at(-1), '4 more not shown.');
  assert.equal(tail.length, 2 + FLAG_IGNORED_WARNINGS + 1);

  // The unit bound: no line is cut inside; the first line that does not fit and every later one are left out.
  const long = 'x'.repeat(MAX_DISPLAY_LINE);
  const units = summaryOf([row('f', 'fresh', { warnings: [long, long, 'short', long] })]).fresh[0];
  assert.equal(FLAG_IGNORED_UNITS, 2 * MAX_DISPLAY_LINE);
  assert.deepEqual(units.warnings, [long, long]);
  assert.equal(units.omitted, 2);
});

test('reader: at most RESUME_SUMMARY_ROWS rows in the answer\'s order, with the real totals', () => {
  const kinds = ['resumed', 'fresh', 'blocked', 'refused'];
  const rows = Array.from({ length: 150 }, (_, i) => row(`i${i}`, kinds[i % 4]));
  rows.splice(10, 0, row('run', 'already-running'), row('bad', 'unknown-outcome'));
  const s = summaryOf(rows);
  assert.equal(RESUME_SUMMARY_ROWS, 100);
  assert.equal(s.resumed.length + s.fresh.length + s.waiting.length + s.refused.length, 100);
  assert.deepEqual(s.resumed.map((r) => r.instance), Array.from({ length: 25 }, (_, i) => `i${i * 4}`));
  assert.equal(s.refused.at(-1).instance, 'i99');
  assert.deepEqual(s.totals, totals(38, 38, 37, 37));
  assert.equal(s.omitted, 50);
  const n = resumeNotice(s, { label });
  assert.equal(n.headline, 'OATS resumed 113 instances whose sessions were lost. 38 of them started fresh from their briefing. 37 of them are waiting for you: open their terminals. 37 could not be resumed.');
  assert.equal(lines(n).at(-1), '50 more not shown.');
  assert.deepEqual(resumeSummaryFact(s), s);
});

test('reader: at most RESUME_SUMMARY_DEPLOYMENTS deployment lines; the rest counted in omitted', () => {
  const deployments = Array.from({ length: RESUME_SUMMARY_DEPLOYMENTS + 20 }, (_, i) => ({ deployment: `/srv/d${i}`, swept: false, reason: i % 2 ? 'opted-out' : 'not-ok' }));
  const s = summaryOf([row('r', 'resumed')], deployments);
  assert.equal(s.optedOut.length + s.unswept.length, RESUME_SUMMARY_DEPLOYMENTS);
  assert.equal(s.optedOut.at(-1), '/srv/d99');
  assert.equal(s.omitted, 20);
  assert.deepEqual(resumeSummaryFact(s), s);
  assert.equal(lines(resumeNotice(s, { label })).at(-1), '20 more not shown.');
});

test('resumeSummaryFact: idempotent, a fresh copy, and the reader\'s summary decodes to itself', () => {
  const s = summaryOf([
    row('r', 'resumed', { warnings: ['a', 'token=abc123secret'] }), row('f', 'fresh', { reason: 'no-receipts', deployment: B }),
    row('b', 'blocked', { reason: 'launch-prompt' }), row('x', 'refused', { reason: 'refused-this-boot', code: 'E_X', message: 'said' }),
  ], [{ deployment: A, swept: false, reason: 'opted-out' }, { deployment: B, swept: false, reason: 'unreadable' }]);
  const once = resumeSummaryFact(s);
  assert.deepEqual(once, s);
  assert.deepEqual(resumeSummaryFact(once), once);
  assert.notEqual(once, s);
  once.resumed[0].warnings.push('mutated'); once.optedOut.push('/x'); once.totals.resumed = 9; once.unswept[0].reason = null;
  assert.deepEqual(resumeSummaryFact(s), summaryOf([
    row('r', 'resumed', { warnings: ['a', 'token=abc123secret'] }), row('f', 'fresh', { reason: 'no-receipts', deployment: B }),
    row('b', 'blocked', { reason: 'launch-prompt' }), row('x', 'refused', { reason: 'refused-this-boot', code: 'E_X', message: 'said' }),
  ], [{ deployment: A, swept: false, reason: 'opted-out' }, { deployment: B, swept: false, reason: 'unreadable' }]));
  assert.deepEqual(resumeSummaryFact(empty), empty);
  // Through structured clone, as IPC carries it.
  assert.deepEqual(resumeSummaryFact(structuredClone(s)), s);
});

test('resumeSummaryFact: refuses extra or missing keys, bad bounds, bad codes and anything else', () => {
  const base = () => structuredClone(summaryOf([
    row('r', 'resumed'), row('f', 'fresh', { reason: 'no-conversation' }), row('b', 'blocked'), row('x', 'refused', { code: 'E_X', message: 'm' }),
  ], [{ deployment: A, swept: false, reason: 'opted-out' }, { deployment: B, swept: false, reason: 'not-ok' }]));
  assert.ok(resumeSummaryFact(base()));
  const bad = {
    'extra top key': (s) => { s.extra = 1; },
    'missing top key': (s) => { delete s.unswept; },
    'extra row key': (s) => { s.resumed[0].code = null; },
    'missing row key': (s) => { delete s.refused[0].reason; },
    'extra totals key': (s) => { s.totals.skipped = 0; },
    'extra unswept key': (s) => { s.unswept[0].code = 'E_X'; },
    'unknown fresh reason': (s) => { s.fresh[0].reason = 'later'; },
    'unknown waiting reason': (s) => { s.waiting[0].reason = 'later'; },
    'unknown refused reason': (s) => { s.refused[0].reason = 'later'; },
    'unknown unswept reason': (s) => { s.unswept[0].reason = 'opted-out'; },
    'bad code': (s) => { s.refused[0].code = 'E_bad'; },
    'code not a string': (s) => { s.refused[0].code = 1; },
    'message not a display line': (s) => { s.refused[0].message = 'two\nlines'; },
    'message empty': (s) => { s.refused[0].message = ''; },
    'withheld instance': (s) => { s.resumed[0].instance = DETAIL_WITHHELD; },
    'empty instance': (s) => { s.resumed[0].instance = ''; },
    'instance not a display line': (s) => { s.waiting[0].instance = ' padded'; },
    'withheld opted-out path': (s) => { s.optedOut[0] = DETAIL_WITHHELD; },
    'deployment not a string': (s) => { s.fresh[0].deployment = 7; },
    'warning not a display line': (s) => { s.resumed[0].warnings = ['a\tb']; },
    'warnings over the line bound': (s) => { s.resumed[0].warnings = Array(FLAG_IGNORED_WARNINGS + 1).fill('w'); },
    'warnings over the unit bound': (s) => { s.resumed[0].warnings = Array(3).fill('x'.repeat(MAX_DISPLAY_LINE)); },
    'warnings omitted with room left': (s) => { s.resumed[0].warnings = ['w']; s.resumed[0].omitted = 1; },
    'warnings omitted negative': (s) => { s.fresh[0].omitted = -1; },
    'totals below kept': (s) => { s.totals.waiting = 0; },
    'totals not integers': (s) => { s.totals.resumed = 1.5; },
    'totals negative': (s) => { s.totals.refused = -1; },
    'omitted rows without a full set': (s) => { s.totals.resumed = 2; s.omitted = 1; },
    'omitted below the rows over the bound': (s) => { s.omitted = -1; },
    'omitted lines without a full set': (s) => { s.omitted = 1; },
    'omitted not an integer': (s) => { s.omitted = '0'; },
    'rows not an array': (s) => { s.refused = {}; },
    'opted out not an array': (s) => { s.optedOut = A; },
    'totals not a record': (s) => { s.totals = [1, 1, 1, 1]; },
  };
  for (const [name, mutate] of Object.entries(bad)) {
    const s = base(); mutate(s);
    assert.equal(resumeSummaryFact(s), undefined, name);
  }
  for (const v of [null, undefined, [], 'summary', 0]) assert.equal(resumeSummaryFact(v), undefined);

  // The row bound and its omitted: a full set beside a larger total decodes; one more row does not.
  const full = summaryOf(Array.from({ length: 103 }, (_, i) => row(`i${i}`, 'resumed')));
  assert.deepEqual(resumeSummaryFact(full), full);
  assert.equal(resumeSummaryFact({ ...full, omitted: 2 }), undefined);
  assert.equal(resumeSummaryFact({ ...full, omitted: 4 }), undefined, 'lines over the bound need a full set of lines');
  const over = structuredClone(full); over.resumed.push({ instance: 'more', deployment: A, warnings: [], omitted: 0 }); over.omitted = 2;
  assert.equal(resumeSummaryFact(over), undefined);
  const lines = summaryOf([], Array.from({ length: RESUME_SUMMARY_DEPLOYMENTS }, (_, i) => ({ deployment: `/srv/${i}`, swept: false })));
  assert.deepEqual(resumeSummaryFact({ ...lines, omitted: 5 }), { ...lines, omitted: 5 });
  assert.equal(resumeSummaryFact({ ...lines, optedOut: ['/srv/one-more'], omitted: 0 }), undefined);
});

test('notice: label is required, before anything else', () => {
  const s = summaryOf([row('r', 'resumed')]);
  for (const options of [undefined, null, {}, { label: 'x' }, { label: null }]) {
    assert.throws(() => resumeNotice(s, options), TypeError);
    assert.throws(() => resumeNotice(undefined, options), TypeError);
  }
  assert.equal(resumeNotice(undefined, { label }), null);
  assert.equal(resumeNotice({ ...s, extra: 1 }, { label }), null);
  assert.equal(resumeNotice(empty, { label }), null);
});

test('notice: every headline sentence, singular and plural', () => {
  const head = (rows) => notice(rows).headline;
  const r = (n, outcome, more) => Array.from({ length: n }, (_, i) => row(`${outcome}${i}`, outcome, more));
  assert.equal(head(r(1, 'resumed')), 'OATS resumed 1 instance whose session was lost.');
  assert.equal(head(r(3, 'resumed')), 'OATS resumed 3 instances whose sessions were lost.');
  assert.equal(head(r(1, 'fresh')), 'OATS resumed 1 instance whose session was lost. It started fresh from its briefing.');
  assert.equal(head(r(2, 'fresh')), 'OATS resumed 2 instances whose sessions were lost. 2 of them started fresh from their briefing.');
  assert.equal(head([...r(2, 'resumed'), ...r(1, 'fresh')]), 'OATS resumed 3 instances whose sessions were lost. 1 of them started fresh from its briefing.');
  assert.equal(head(r(1, 'blocked')), 'OATS resumed 1 instance whose session was lost. It is waiting for you: open its terminal.');
  assert.equal(head([...r(1, 'resumed'), ...r(1, 'blocked')]), 'OATS resumed 2 instances whose sessions were lost. 1 of them is waiting for you: open its terminal.');
  assert.equal(head(r(2, 'blocked')), 'OATS resumed 2 instances whose sessions were lost. 2 of them are waiting for you: open their terminals.');
  assert.equal(head([...r(1, 'resumed'), ...r(1, 'fresh'), ...r(1, 'blocked')]),
    'OATS resumed 3 instances whose sessions were lost. 1 of them started fresh from its briefing. 1 of them is waiting for you: open its terminal.');
  assert.equal(head([...r(1, 'resumed'), ...r(2, 'fresh'), ...r(2, 'blocked'), ...r(2, 'refused')]),
    'OATS resumed 5 instances whose sessions were lost. 2 of them started fresh from their briefing. 2 of them are waiting for you: open their terminals. 2 could not be resumed.');
  assert.equal(head([...r(1, 'resumed'), ...r(1, 'refused')]), 'OATS resumed 1 instance whose session was lost. 1 could not be resumed.');
  assert.equal(head(r(1, 'refused')), 'OATS could not resume 1 lost session.');
  assert.equal(head(r(3, 'refused')), 'OATS could not resume 3 lost sessions.');
});

test('notice: every detail line, in order: waiting, refused, fresh, resumed, opted out, unswept, more', () => {
  const n = notice([
    row('res', 'resumed', { warnings: ['a warning'] }),
    row('f1', 'fresh', { reason: 'no-conversation' }), row('f2', 'fresh', { reason: 'no-receipts' }),
    row('f3', 'fresh', { reason: 'resume-unproven' }), row('f4', 'fresh', { reason: 'later' }),
    row('x1', 'refused', { reason: 'start-refused', code: 'E_START_REFUSED', message: 'the harness is missing' }),
    row('x2', 'refused', { reason: 'refused-this-boot', code: 'E_START_REFUSED', message: 'token=abc123secret' }),
    row('x3', 'refused', { reason: 'refused-this-boot', code: 'E_START_REFUSED' }),
    row('x4', 'refused', { code: 'E_START_REFUSED' }),
    row('w1', 'blocked', { reason: 'launch-prompt' }), row('w2', 'blocked', { reason: 'resume-confirmation' }), row('w3', 'blocked'),
  ], [
    { deployment: '/srv/n', swept: false, reason: 'not-ok' }, { deployment: '/srv/u', swept: false, reason: 'unreadable' },
    { deployment: '/srv/z', swept: false }, { deployment: B, swept: false, reason: 'opted-out' },
  ]);
  assert.deepEqual(lines(n), [
    'w1: waiting at a launch prompt. Open its terminal.',
    'w2: waiting for you to choose how to resume it. Open its terminal.',
    'w3: waiting at a launch prompt. Open its terminal.',
    'x1: could not be resumed.',
    'OATS says: the harness is missing',
    'x2: could not be resumed. It was refused earlier since this computer started, so OATS did not try again.',
    `OATS says: ${DETAIL_WITHHELD}`,
    'x3: could not be resumed. It was refused earlier since this computer started, so OATS did not try again.',
    'x4: could not be resumed.',
    'f1: started fresh from its briefing, no saved conversation was found.',
    'f2: started fresh from its briefing, OATS has no record of where its conversations are kept.',
    "f3: started fresh from its briefing, resuming this harness's conversations isn't supported yet.",
    'f4: started fresh from its briefing, its conversation could not be resumed.',
    'res: resumed in its own conversation.',
    'OATS says:',
    'a warning',
    'Not checked in ~/work/team: resuming is turned off for this deployment (session.resume: off).',
    "Not checked in /srv/n: its deployment isn't ready.",
    'Not checked in /srv/u: it could not be read.',
    'Not checked in /srv/z: it could not be checked.',
  ]);
  // No line shows a code on its own.
  assert.ok(!n.detail.includes('E_START_REFUSED'));
});

test('notice: " in {d}" only when the kept rows name more than one deployment; label falls back to the path', () => {
  const one = notice([row('a', 'resumed'), row('b', 'blocked')], [{ deployment: B, swept: false, reason: 'opted-out' }]);
  assert.deepEqual(lines(one), ['b: waiting at a launch prompt. Open its terminal.', 'a: resumed in its own conversation.',
    'Not checked in ~/work/team: resuming is turned off for this deployment (session.resume: off).']);
  const two = notice([row('a', 'resumed'), row('b', 'refused', { deployment: B })]);
  assert.deepEqual(lines(two), ['b in ~/work/team: could not be resumed.', 'a in ~/agents: resumed in its own conversation.']);
  for (const bad of [() => '', () => null, () => 7, () => undefined]) {
    assert.deepEqual(lines(resumeNotice(summaryOf([row('a', 'resumed'), row('b', 'fresh', { deployment: B, reason: 'no-conversation' })]), { label: bad })),
      [`b in ${B}: started fresh from its briefing, no saved conversation was found.`, `a in ${A}: resumed in its own conversation.`]);
  }
  const seen = [];
  resumeNotice(summaryOf([row('a', 'resumed')], [{ deployment: B, swept: false, reason: 'opted-out' }]), { label: (d) => { seen.push(d); return d; } });
  assert.deepEqual(seen, [B], 'one deployment among the rows is not labelled for the rows');
});
