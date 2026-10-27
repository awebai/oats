// The machine sweep's reader (packages/client/session-resume.mjs): `oats session resume --json` read into a
// summary of facts, the boundary decoder main and the renderer share, and the notice in the clients' words.
// The answers are hand-written from the agreed kernel contract (the kernel is built in parallel); their
// warnings and messages are examples, not the kernel's sentences. Every sentence of the notice is pinned here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readResumeSweep, resumeSummaryFact, resumeNotice, sweepSettlement, withoutReported, RESUME_SUMMARY_ROWS, RESUME_SUMMARY_DEPLOYMENTS,
  RESUME_ANSWER_ENTRIES, REFUSED_REASONS, RESUME_OUTCOMES, SKIPPED_REASONS, SETTLING_SKIPPED_REASONS } from '../../client/session-resume.mjs';
import { boundedWarnings, FLAG_IGNORED_WARNINGS, FLAG_IGNORED_UNITS } from '../../client/launch-prompt-outcome.mjs';
import { DETAIL_WITHHELD, MAX_DISPLAY_LINE } from '../../client/display-text.mjs';
import { SWEEP_DEPLOYMENT as A, sweepAnswer as answer, sweepRow as row, sweepRefusal as refusal, sweepHome,
  resumedRow, freshRow, blockedRow, refusedRow, runningRow, skippedRow } from './helpers/resume-sweep.mjs';

const B = '/home/ana/work/team';
const O = RESUME_OUTCOMES;
const summaryOf = (...args) => readResumeSweep(answer(...args)).summary;
const label = (d) => d.replace(/^\/home\/ana/, '~');
const notice = (...args) => resumeNotice(summaryOf(...args), { label });
const lines = (n) => n.detail.split('\n');
const totals = (resumed = 0, fresh = 0, waiting = 0, refused = 0) => ({ resumed, fresh, waiting, refused });
const empty = { resumed: [], fresh: [], waiting: [], refused: [], unswept: [], omitted: 0, totals: totals() };

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
    resumedRow('r1', { sessionId: 's' }),
    freshRow('f1', { reason: 'no-conversation' }), freshRow('f2', { reason: 'no-receipts' }),
    freshRow('f3', { reason: 'resume-unproven' }), freshRow('f4', { reason: 'later-reason' }), freshRow('f5'),
    blockedRow('b1', { reason: 'resume-confirmation' }),
    blockedRow('b2', { reason: 'launch-prompt', code: 'E_SPAWN_INCOMPLETE', launchPrompts: { status: 'blocked' } }),
    blockedRow('b3', { reason: 'other' }),
    refusedRow('x1', { reason: 'start-refused', code: 'E_START_REFUSED', message: 'the harness is not installed' }),
    refusedRow('x2', { reason: 'refused-this-boot', code: 'E_RESUME_REFUSED', message: 'refused earlier' }),
    refusedRow('x3', { reason: 'nope', code: 'bad code' }),
    refusedRow('x4', { reason: 'keeps-getting-lost', code: 'E_RESUME_REFUSED' }),
    runningRow('a1'),
    skippedRow('s1', { reason: SKIPPED_REASONS.unknown }), skippedRow('s2', { reason: SKIPPED_REASONS.startBusy }), skippedRow('s3', { reason: SKIPPED_REASONS.notLost }),
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
      { instance: 'x4', deployment: A, reason: 'keeps-getting-lost', code: 'E_RESUME_REFUSED', message: null },
    ],
    unswept: [], omitted: 0, totals: totals(1, 5, 3, 4),
  });
});

test('reader: deployments: unswept with its reason or null, an older kernel\'s opted-out among them; swept ones not shown', () => {
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
  assert.equal(Object.hasOwn(s, 'optedOut'), false, 'there is no opt-out');
  assert.deepEqual(s.unswept, [
    { deployment: B, reason: null },
    { deployment: '/srv/c', reason: 'not-ok' }, { deployment: '/srv/d', reason: 'unreadable' },
    { deployment: '/srv/e', reason: null }, { deployment: '/srv/f', reason: null },
  ]);
});

test('reader: quiet when only running or skipped rows, or only deployment lines, or a plan', () => {
  const only = answer([runningRow('a'), skippedRow('b', { reason: SKIPPED_REASONS.notLost })]);
  assert.deepEqual(readResumeSweep(only), { kind: 'quiet', summary: empty });
  // A home the kernel did not recently see running is skipped: never a notice of its own, counted nowhere.
  for (const reason of Object.values(SKIPPED_REASONS)) {
    assert.deepEqual(readResumeSweep(answer([skippedRow('c', { reason, code: 'E_X', message: 'm' })])), { kind: 'quiet', summary: empty }, reason);
  }
  const beside = readResumeSweep(answer([resumedRow('r'), skippedRow('c', { reason: SKIPPED_REASONS.notSeenRecently })]));
  assert.deepEqual([beside.kind, beside.summary.totals], ['notice', totals(1)]);
  assert.equal(resumeNotice(beside.summary, { label }).detail, 'r: resumed in its own conversation.');
  const lines = readResumeSweep(answer([runningRow('a')], [{ deployment: A, swept: false, reason: 'opted-out' }, { deployment: B, swept: false, reason: 'unreadable' }]));
  assert.equal(lines.kind, 'quiet');
  assert.deepEqual(lines.summary.unswept, [{ deployment: A, reason: null }, { deployment: B, reason: 'unreadable' }]);
  assert.equal(resumeNotice(lines.summary, { label }), null);
  // A plan started nothing: its rows and deployments are not read, and it is the empty summary.
  const plan = answer([resumedRow('r'), refusedRow('x', { code: 'E_X' })], [{ deployment: A, swept: false, reason: 'opted-out' }], { plan: true });
  assert.deepEqual(readResumeSweep(plan), { kind: 'quiet', summary: empty });
  assert.deepEqual(readResumeSweep(answer()), { kind: 'quiet', summary: empty });
  assert.equal(readResumeSweep(answer([resumedRow('r')])).kind, 'notice');
  for (const outcome of [O.fresh, O.blocked, O.refused]) assert.equal(readResumeSweep(answer([row('r', outcome)])).kind, 'notice');
});

test('reader: a withheld or empty name or path drops the row; names and messages are display lines', () => {
  const s = summaryOf([
    resumedRow('token=abc123secret'), resumedRow('ok-one', { deployment: '/srv/password=hunter2' }),
    resumedRow(''), freshRow('  \n '), resumedRow(7), resumedRow('no-dep', { deployment: undefined }),
    null, 'row', [resumedRow('arr')],
    resumedRow('two\nlines', { deployment: `${A}\t` }),
    refusedRow('quoted', { message: 'token=abc123secret' }),
    refusedRow('folded', { message: 'line one\nline two' }),
  ]);
  assert.deepEqual(s.resumed, [{ instance: 'two lines', deployment: A, warnings: [], omitted: 0 }]);
  assert.deepEqual(s.refused.map((r) => r.message), [DETAIL_WITHHELD, 'line one line two']);
  assert.deepEqual(s.totals, totals(1, 0, 0, 2));
});

test('reader: warnings are display lines, the withheld marker shown, cut by position and never matched', () => {
  const kernelish = 'OATS resumed 3 instances whose sessions were lost.';
  const s = summaryOf([
    resumedRow('r', { warnings: ['first', 'token=abc123secret', '', 7, null, kernelish, 'It is waiting for you: open its terminal.'] }),
    freshRow('f', { reason: 'no-receipts', warnings: 'not an array' }),
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
  const cut = summaryOf([resumedRow('r', { warnings: many })]).resumed[0];
  assert.deepEqual(cut.warnings, many.slice(0, FLAG_IGNORED_WARNINGS));
  assert.equal(cut.omitted, 4);
  assert.deepEqual(cut, { instance: 'r', deployment: A, ...boundedWarnings(many) });
  const tail = lines(resumeNotice(summaryOf([resumedRow('r', { warnings: many })]), { label }));
  assert.equal(tail.at(-1), '4 more not shown.');
  assert.equal(tail.length, 2 + FLAG_IGNORED_WARNINGS + 1);

  // The unit bound: no line is cut inside; the first line that does not fit and every later one are left out.
  const long = 'x'.repeat(MAX_DISPLAY_LINE);
  const units = summaryOf([freshRow('f', { warnings: [long, long, 'short', long] })]).fresh[0];
  assert.equal(FLAG_IGNORED_UNITS, 2 * MAX_DISPLAY_LINE);
  assert.deepEqual(units.warnings, [long, long]);
  assert.equal(units.omitted, 2);
});

test('reader: at most RESUME_SUMMARY_ROWS rows in the answer\'s order, with the real totals', () => {
  const kinds = [O.resumed, O.fresh, O.blocked, O.refused];
  const rows = Array.from({ length: 150 }, (_, i) => row(`i${i}`, kinds[i % 4]));
  rows.splice(10, 0, runningRow('run'), row('bad', 'unknown-outcome'));
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
  const s = summaryOf([resumedRow('r')], deployments);
  assert.equal(s.unswept.length, RESUME_SUMMARY_DEPLOYMENTS);
  assert.deepEqual(s.unswept.at(-1), { deployment: '/srv/d99', reason: null });
  assert.deepEqual(s.unswept.at(-2), { deployment: '/srv/d98', reason: 'not-ok' });
  assert.equal(s.omitted, 20);
  assert.deepEqual(resumeSummaryFact(s), s);
  assert.equal(lines(resumeNotice(s, { label })).at(-1), '20 more not shown.');
});

test('resumeSummaryFact: idempotent, a fresh copy, and the reader\'s summary decodes to itself', () => {
  const s = summaryOf([
    resumedRow('r', { warnings: ['a', 'token=abc123secret'] }), freshRow('f', { reason: 'no-receipts', deployment: B }),
    blockedRow('b', { reason: 'launch-prompt' }), refusedRow('x', { reason: 'refused-this-boot', code: 'E_X', message: 'said' }),
  ], [{ deployment: A, swept: false, reason: 'opted-out' }, { deployment: B, swept: false, reason: 'unreadable' }]);
  const once = resumeSummaryFact(s);
  assert.deepEqual(once, s);
  assert.deepEqual(resumeSummaryFact(once), once);
  assert.notEqual(once, s);
  once.resumed[0].warnings.push('mutated'); once.unswept.push({ deployment: '/x', reason: null }); once.totals.resumed = 9; once.unswept[0].reason = 'not-ok';
  assert.deepEqual(resumeSummaryFact(s), summaryOf([
    resumedRow('r', { warnings: ['a', 'token=abc123secret'] }), freshRow('f', { reason: 'no-receipts', deployment: B }),
    blockedRow('b', { reason: 'launch-prompt' }), refusedRow('x', { reason: 'refused-this-boot', code: 'E_X', message: 'said' }),
  ], [{ deployment: A, swept: false, reason: 'opted-out' }, { deployment: B, swept: false, reason: 'unreadable' }]));
  assert.deepEqual(resumeSummaryFact(empty), empty);
  // Through structured clone, as IPC carries it.
  assert.deepEqual(resumeSummaryFact(structuredClone(s)), s);
});

test('resumeSummaryFact: refuses extra or missing keys, bad bounds, bad codes and anything else', () => {
  const base = () => structuredClone(summaryOf([
    resumedRow('r'), freshRow('f', { reason: 'no-conversation' }), blockedRow('b'), refusedRow('x', { code: 'E_X', message: 'm' }),
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
    'an opted-out list': (s) => { s.optedOut = []; },
    'bad code': (s) => { s.refused[0].code = 'E_bad'; },
    'code not a string': (s) => { s.refused[0].code = 1; },
    'message not a display line': (s) => { s.refused[0].message = 'two\nlines'; },
    'message empty': (s) => { s.refused[0].message = ''; },
    'withheld instance': (s) => { s.resumed[0].instance = DETAIL_WITHHELD; },
    'empty instance': (s) => { s.resumed[0].instance = ''; },
    'instance not a display line': (s) => { s.waiting[0].instance = ' padded'; },
    'withheld unswept path': (s) => { s.unswept[0].deployment = DETAIL_WITHHELD; },
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
    'unswept not an array': (s) => { s.unswept = A; },
    'totals not a record': (s) => { s.totals = [1, 1, 1, 1]; },
  };
  for (const [name, mutate] of Object.entries(bad)) {
    const s = base(); mutate(s);
    assert.equal(resumeSummaryFact(s), undefined, name);
  }
  for (const v of [null, undefined, [], 'summary', 0]) assert.equal(resumeSummaryFact(v), undefined);

  // The row bound and its omitted: a full set beside a larger total decodes; one more row does not.
  const full = summaryOf(Array.from({ length: 103 }, (_, i) => resumedRow(`i${i}`)));
  assert.deepEqual(resumeSummaryFact(full), full);
  assert.equal(resumeSummaryFact({ ...full, omitted: 2 }), undefined);
  assert.equal(resumeSummaryFact({ ...full, omitted: 4 }), undefined, 'lines over the bound need a full set of lines');
  const over = structuredClone(full); over.resumed.push({ instance: 'more', deployment: A, warnings: [], omitted: 0 }); over.omitted = 2;
  assert.equal(resumeSummaryFact(over), undefined);
  const lines = summaryOf([], Array.from({ length: RESUME_SUMMARY_DEPLOYMENTS }, (_, i) => ({ deployment: `/srv/${i}`, swept: false })));
  assert.deepEqual(resumeSummaryFact({ ...lines, omitted: 5 }), { ...lines, omitted: 5 });
  assert.equal(resumeSummaryFact({ ...lines, unswept: [...lines.unswept, { deployment: '/srv/one-more', reason: null }], omitted: 0 }), undefined);
});

test('notice: label is required, before anything else', () => {
  const s = summaryOf([resumedRow('r')]);
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
  assert.equal(head(r(1, O.resumed)), 'OATS resumed 1 instance whose session was lost.');
  assert.equal(head(r(3, O.resumed)), 'OATS resumed 3 instances whose sessions were lost.');
  assert.equal(head(r(1, O.fresh)), 'OATS resumed 1 instance whose session was lost. It started fresh from its briefing.');
  assert.equal(head(r(2, O.fresh)), 'OATS resumed 2 instances whose sessions were lost. 2 of them started fresh from their briefing.');
  assert.equal(head([...r(2, O.resumed), ...r(1, O.fresh)]), 'OATS resumed 3 instances whose sessions were lost. 1 of them started fresh from its briefing.');
  assert.equal(head(r(1, O.blocked)), 'OATS resumed 1 instance whose session was lost. It is waiting for you: open its terminal.');
  assert.equal(head([...r(1, O.resumed), ...r(1, O.blocked)]), 'OATS resumed 2 instances whose sessions were lost. 1 of them is waiting for you: open its terminal.');
  assert.equal(head(r(2, O.blocked)), 'OATS resumed 2 instances whose sessions were lost. 2 of them are waiting for you: open their terminals.');
  assert.equal(head([...r(1, O.resumed), ...r(1, O.fresh), ...r(1, O.blocked)]),
    'OATS resumed 3 instances whose sessions were lost. 1 of them started fresh from its briefing. 1 of them is waiting for you: open its terminal.');
  assert.equal(head([...r(1, O.resumed), ...r(2, O.fresh), ...r(2, O.blocked), ...r(2, O.refused)]),
    'OATS resumed 5 instances whose sessions were lost. 2 of them started fresh from their briefing. 2 of them are waiting for you: open their terminals. 2 could not be resumed.');
  assert.equal(head([...r(1, O.resumed), ...r(1, O.refused)]), 'OATS resumed 1 instance whose session was lost. 1 could not be resumed.');
  assert.equal(head(r(1, O.refused)), 'OATS could not resume 1 lost session.');
  assert.equal(head(r(3, O.refused)), 'OATS could not resume 3 lost sessions.');
});

test('notice: every detail line, in order: waiting, refused, fresh, resumed, unswept, more', () => {
  const n = notice([
    resumedRow('res', { warnings: ['a warning'] }),
    freshRow('f1', { reason: 'no-conversation' }), freshRow('f2', { reason: 'no-receipts' }),
    freshRow('f3', { reason: 'resume-unproven' }), freshRow('f4', { reason: 'later' }),
    refusedRow('x1', { reason: 'start-refused', code: 'E_START_REFUSED', message: 'the harness is missing' }),
    refusedRow('x2', { reason: 'refused-this-boot', code: 'E_START_REFUSED', message: 'token=abc123secret' }),
    refusedRow('x3', { reason: 'refused-this-boot', code: 'E_START_REFUSED' }),
    refusedRow('x4', { code: 'E_START_REFUSED' }),
    refusedRow('x5', { reason: 'keeps-getting-lost', code: 'E_RESUME_REFUSED', message: 'lost 3 times since boot' }),
    refusedRow('x6', { reason: 'keeps-getting-lost', code: 'E_RESUME_REFUSED' }),
    blockedRow('w1', { reason: 'launch-prompt' }), blockedRow('w2', { reason: 'resume-confirmation' }), blockedRow('w3'),
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
    "x5: keeps losing its session; it won't be resumed again until this computer restarts.",
    'OATS says: lost 3 times since boot',
    "x6: keeps losing its session; it won't be resumed again until this computer restarts.",
    'f1: started fresh from its briefing, no saved conversation was found.',
    'f2: started fresh from its briefing, OATS has no record of where its conversations are kept.',
    "f3: started fresh from its briefing, resuming this harness's conversations isn't supported yet.",
    'f4: started fresh from its briefing, its conversation could not be resumed.',
    'res: resumed in its own conversation.',
    'OATS says:',
    'a warning',
    "Not checked in /srv/n: its deployment isn't ready.",
    'Not checked in /srv/u: it could not be read.',
    'Not checked in /srv/z: it could not be checked.',
    'Not checked in ~/work/team: it could not be checked.',
  ]);
  // No line shows a code on its own, and nothing speaks of an opt-out.
  assert.ok(!n.detail.includes('E_START_REFUSED') && !n.detail.includes('E_RESUME_REFUSED'));
  assert.ok(!/turned off|session\.resume/.test(n.detail));
  assert.equal(n.headline, 'OATS resumed 8 instances whose sessions were lost. 4 of them started fresh from their briefing. 3 of them are waiting for you: open their terminals. 6 could not be resumed.');
});

test('notice: keeps-getting-lost: its own line in place of "could not be resumed.", the kernel\'s message after it, counted as refused', () => {
  const keeps = (more = {}) => refusedRow('k', { reason: 'keeps-getting-lost', code: 'E_RESUME_REFUSED', ...more });
  assert.ok(REFUSED_REASONS.includes('keeps-getting-lost'));
  const alone = notice([keeps()]);
  assert.deepEqual(alone, { headline: 'OATS could not resume 1 lost session.',
    detail: "k: keeps losing its session; it won't be resumed again until this computer restarts." });
  const said = notice([keeps({ message: 'resumed 3 times since boot' })]);
  assert.deepEqual(lines(said), ["k: keeps losing its session; it won't be resumed again until this computer restarts.", 'OATS says: resumed 3 times since boot']);
  const mixed = notice([resumedRow('a'), keeps({ deployment: B }), refusedRow('x', { reason: 'start-refused' })]);
  assert.equal(mixed.headline, 'OATS resumed 1 instance whose session was lost. 2 could not be resumed.');
  assert.deepEqual(lines(mixed), [
    "k in ~/work/team: keeps losing its session; it won't be resumed again until this computer restarts.",
    'x in ~/agents: could not be resumed.', 'a in ~/agents: resumed in its own conversation.']);
  assert.deepEqual(resumeSummaryFact(summaryOf([keeps()])).refused, [{ instance: 'k', deployment: A, reason: 'keeps-getting-lost', code: 'E_RESUME_REFUSED', message: null }]);
});

test('notice: " in {d}" only when the kept rows name more than one deployment; label falls back to the path', () => {
  const one = notice([resumedRow('a'), blockedRow('b')], [{ deployment: B, swept: false, reason: 'opted-out' }]);
  assert.deepEqual(lines(one), ['b: waiting at a launch prompt. Open its terminal.', 'a: resumed in its own conversation.',
    'Not checked in ~/work/team: it could not be checked.']);
  const two = notice([resumedRow('a'), refusedRow('b', { deployment: B })]);
  assert.deepEqual(lines(two), ['b in ~/work/team: could not be resumed.', 'a in ~/agents: resumed in its own conversation.']);
  for (const bad of [() => '', () => null, () => 7, () => undefined]) {
    assert.deepEqual(lines(resumeNotice(summaryOf([resumedRow('a'), freshRow('b', { deployment: B, reason: 'no-conversation' })]), { label: bad })),
      [`b in ${B}: started fresh from its briefing, no saved conversation was found.`, `a in ${A}: resumed in its own conversation.`]);
  }
  const seen = [];
  resumeNotice(summaryOf([resumedRow('a')], [{ deployment: B, swept: false, reason: 'opted-out' }]), { label: (d) => { seen.push(d); return d; } });
  assert.deepEqual(seen, [B], 'one deployment among the rows is not labelled for the rows');
});

test('the answer\'s outcome and skipped-reason names, pinned', () => {
  assert.deepEqual(RESUME_OUTCOMES, { resumed: 'resumed', fresh: 'fresh', blocked: 'blocked', refused: 'refused', alreadyRunning: 'already-running', skipped: 'skipped' });
  assert.deepEqual(SKIPPED_REASONS, { notLost: 'not-lost', notSeenRecently: 'not-seen-recently', startBusy: 'start-busy', unknown: 'unknown' });
  assert.deepEqual(SETTLING_SKIPPED_REASONS, ['not-lost', 'not-seen-recently']);
  assert.deepEqual(REFUSED_REASONS, ['start-refused', 'refused-this-boot', 'keeps-getting-lost']);
  for (const list of [RESUME_OUTCOMES, SKIPPED_REASONS, SETTLING_SKIPPED_REASONS, REFUSED_REASONS]) assert.ok(Object.isFrozen(list));
});

test('sweepSettlement: refused (any reason) and skipped not-lost or not-seen-recently settle; started or running release; the rest neither', () => {
  const h = sweepHome;
  assert.deepEqual(sweepSettlement(answer([
    ...REFUSED_REASONS.map((reason, i) => refusedRow(`x${i}`, { reason, code: 'E_X' })), refusedRow('xn'),
    ...SETTLING_SKIPPED_REASONS.map((reason, i) => skippedRow(`n${i}`, { reason })),
    resumedRow('r'), freshRow('f'), blockedRow('b'), runningRow('a'),
    skippedRow('sb', { reason: SKIPPED_REASONS.startBusy }), skippedRow('su', { reason: SKIPPED_REASONS.unknown }), skippedRow('s0'),
    row('v', 'vanished'), row('v2', undefined),
  ])), { settle: [h('x0'), h('x1'), h('x2'), h('xn'), h('n0'), h('n1')], release: [h('r'), h('f'), h('b'), h('a')] });
  // A home's last row decides; it is listed once, where its last row puts it.
  assert.deepEqual(sweepSettlement(answer([refusedRow('a'), resumedRow('b'), resumedRow('a'), refusedRow('b'), skippedRow('a', { reason: SKIPPED_REASONS.startBusy })])),
    { settle: [h('b')], release: [h('a')] });
  // Rows without a home to name, or not records, are ignored.
  assert.deepEqual(sweepSettlement(answer([null, 'row', [refusedRow('arr')], refusedRow('n7', { home: 7 }), refusedRow('ne', { home: '' }), refusedRow('nu', { home: undefined })])),
    { settle: [], release: [] });
  // Anything but an ok:true answer with a rows array: nothing.
  for (const envelope of [refusal('E_RESUME_BUSY'), { schemaVersion: 1, ok: true, result: { rows: 'x' } }, { ok: true }, { ok: true, result: [] }, null, 'text', undefined,
    { ok: 'true', result: { rows: [refusedRow('x')] } }, answer(new Array(RESUME_ANSWER_ENTRIES + 1).fill(refusedRow('x')))]) {
    assert.deepEqual(sweepSettlement(envelope), { settle: [], release: [] }, JSON.stringify(envelope)?.slice(0, 80));
  }
});

test('withoutReported: a copy without the refusals already reported, and every refusal\'s key of this answer', () => {
  const x = (more = {}) => refusedRow('x', { reason: REFUSED_REASONS[0], code: 'E_START_REFUSED', ...more });
  const first = answer([x(), x(), resumedRow('r')]);
  const once = withoutReported(first, new Set());
  assert.deepEqual(once.envelope, first, 'nothing reported yet: every row');
  assert.notEqual(once.envelope, first);
  assert.equal(once.keys.length, 2);
  assert.equal(once.keys[0], once.keys[1], 'the same refusal twice in one answer: both kept, one key');
  const reported = new Set(once.keys);
  // Again: the repeat is left out, everything else kept, in order; the given envelope is not changed.
  const second = answer([resumedRow('r'), x(), freshRow('f'), x({ message: 'said otherwise' })], [{ deployment: A, swept: false }]);
  const before = structuredClone(second), rows = second.result.rows;
  const again = withoutReported(second, reported);
  assert.deepEqual(second, before);
  assert.equal(second.result.rows, rows);
  assert.deepEqual(again.envelope, { ...before, result: { ...before.result, rows: [before.result.rows[0], before.result.rows[2]] } });
  assert.deepEqual(again.keys, [...reported, ...reported], 'a message is not part of the key');
  assert.equal(reported.size, 1, 'the caller adds the keys; the set is only read');
  // A changed reason, code or home is news; so is a reason or code that was absent.
  for (const changed of [x({ reason: REFUSED_REASONS[2] }), x({ code: 'E_RESUME_REFUSED' }), x({ home: sweepHome('y') }), refusedRow('x')]) {
    const out = withoutReported(answer([changed]), reported);
    assert.deepEqual(out.envelope.result.rows, [changed]);
    assert.equal(out.keys.length, 1);
    assert.equal(reported.has(out.keys[0]), false);
  }
  // A refusal without a home to key it by is always kept, with no key; other outcomes are never keyed.
  const homeless = refusedRow('h', { home: 7 });
  assert.deepEqual(withoutReported(answer([homeless, resumedRow('r'), skippedRow('s', { reason: SKIPPED_REASONS.notLost })]), reported).keys, []);
  // Anything but an ok:true answer with a rows array comes back as it is, with no keys.
  for (const envelope of [refusal('E_RESUME_BUSY'), { ok: true, result: { rows: 'x' } }, null, 'text']) {
    const out = withoutReported(envelope, reported);
    assert.equal(out.envelope, envelope);
    assert.deepEqual(out.keys, []);
  }
});
