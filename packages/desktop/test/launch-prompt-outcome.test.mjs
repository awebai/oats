import test from 'node:test';
import assert from 'node:assert/strict';
import { launchPromptOutcome, launchPromptDiffered, retainedSpawnDetails, retainedSpawnMessage, boundedWarnings, boundedWarningsValid, launchFlagIgnored, FLAG_IGNORED_WARNINGS, FLAG_IGNORED_UNITS } from '../../client/launch-prompt-outcome.mjs';
import { DETAIL_WITHHELD, MAX_DISPLAY_LINE } from '../../client/display-text.mjs';
import { launchPrompts, retained, differed, DIFFERED } from './helpers/launch-prompt-fixture.mjs';
const d = { instance: 'dev-one', home: '/example/dev-one' };
test('optional/partial target and diagnostics never turn retention into success or input authority', () => {
  for (const target of [{}, { pid: '123' }, { paneId: '%2' }, null, { pid: {}, socket: 'token=PRIVATE' }]) {
    const r = retainedSpawnDetails({ ...retained(d), target });
    assert.equal(r.instance, d.instance); assert.equal(r.launched, 'unknown');
    assert.equal(r.launchPrompts.answers[0].status, 'submitted');
    assert.doesNotMatch(JSON.stringify(r), /PRIVATE/);
  }
});
test('malformed, huge, future or unsafe diagnostics remain inspection-only', () => {
  for (const p of [null, {}, { status: 'completed' }, { ...launchPrompts(), reason: 'token=PRIVATE' },
    { ...launchPrompts(), reason: 'a new reason' }, { ...launchPrompts(), receipt: 'bad' },
    { ...launchPrompts(), padding: 'x'.repeat(32769) }]) {
    const r = retainedSpawnDetails({ ...retained(d), launchPrompts: p });
    assert.ok(r); assert.notEqual(r.launchPrompts.status, 'completed');
    assert.doesNotMatch(JSON.stringify(r), /PRIVATE/);
    assert.match(retainedSpawnMessage(r), /Inspect its existing pane, then use oats session start --home/);
    assert.match(retainedSpawnMessage(r), /Do not spawn again/);
  }
});
test('submitted answers and failed audit with empty answers cannot imply no input', () => {
  const blocked = retainedSpawnMessage(retainedSpawnDetails(retained(d)));
  assert.match(blocked, /blocked: unexpected prompt/); assert.match(blocked, /answer was submitted/);
  assert.match(blocked, /does not confirm readiness/);
  const incomplete = retainedSpawnMessage(retainedSpawnDetails(retained(d, 'incomplete')));
  assert.match(incomplete, /audit failed after possible input/); assert.match(incomplete, /Input may already have been sent/);
  const p = launchPromptOutcome(launchPrompts()); assert.deepEqual(launchPromptOutcome(p), p);
});

test('dialog retains the incomplete result and disables another spawn', async t => {
  const { mountSpawn, kernel, settle } = await import('./helpers/spawn-dialog-host.mjs');
  const u = await mountSpawn(t, { apply: () => ({ started: true, envelope: { schemaVersion: 1, ok: false,
    error: { code: 'E_SPAWN_INCOMPLETE', details: retained(kernel('preview-worktree-purpose').result.decision) } } }) });
  await u.open(); await u.type('.fpurpose', 'api-v2'); u.q('.fspawn').click(); await settle(20);
  assert.match(u.dialog().textContent, /blocked: unexpected prompt/);
  assert.match(u.dialog().textContent, /Inspect its existing pane, then use oats session start --home/);
  assert.equal(u.q('.fspawn').disabled, true);
  u.q('.fspawn').click(); await settle();
  assert.deepEqual(u.spawns().map(b => b.action), ['prepare', 'apply']);
});

// Retained-result vocabulary captured from writer 28e0a633: core.mjs's
// incompleteLaunchPrompt/retainedPromptError call sites and launch-prompts.mjs's
// controller exits (including both dynamic input outcomes). This independent
// fixture must be refreshed when the writer adds reasons; no kernel execution.
const writerReasons = {
  blocked: [
    'blocked: unexpected prompt', 'blocked: observation timeout', 'blocked: launch observation failed',
    'blocked: invalid target', 'blocked: respawn ownership not proven',
    'blocked: respawn geometry changed before fresh screen', 'blocked: launch geometry not pinned',
    'blocked: repeated or unsupported prompt', 'blocked: prompt consent absent',
    'blocked: prompt changed before input', 'blocked: launch authority already used',
  ],
  incomplete: [
    'launch prompt audit failed', 'launch prompt audit failed after possible input',
    'launch prompt audit failed before geometry pin', 'launch prompt audit failed after geometry pin',
    'launch prompt geometry pin failed', 'launch prompt geometry restoration incomplete',
    'launch prompt input failed', 'launch prompt input uncertain',
    'launch prompt dispatch or recording incomplete', 'launch prompt metadata recording incomplete',
    'launch prompt pending receipt incomplete', 'launch home identity changed; metadata retained at original home',
  ],
};
for (const [status, reasons] of Object.entries(writerReasons)) for (const reason of reasons) {
  test(`writer retained reason is shown: ${reason}`, () => {
    const r = retainedSpawnDetails({ ...retained(d), launchPrompts: { status, reason, answers: [], receipt: [] } });
    assert.equal(r.launchPrompts.reason, reason);
    assert.equal(launchPromptOutcome(r.launchPrompts).reason, reason);
    assert.ok(retainedSpawnMessage(r).includes(reason));
    assert.match(retainedSpawnMessage(r), /Inspect its existing pane, then use oats session start --home/);
  });
}

// The kernel's evidence-retention reasons. Hand-written from the kernel's writer at head 7dc5a20c of
// awebai/oats#917 (lib/launch-prompts.mjs `retain`, `blocked` and `finish`); no kernel execution. 0.51.0
// writes the reason alone and as the suffix of `blocked: unexpected prompt`; 0.52.0 writes all four.
const retentionReasons = {
  blocked: [
    'blocked: unexpected prompt; private launch evidence retention failed',
    'blocked: repeated or unsupported prompt; private launch evidence retention failed',
    'blocked: observation timeout; private launch evidence retention failed',
  ],
  incomplete: ['private launch evidence retention failed'],
};
for (const [status, reasons] of Object.entries(retentionReasons)) for (const reason of reasons) {
  test(`an evidence-retention reason is shown, not "Launch requires inspection": ${reason}`, () => {
    const r = retainedSpawnDetails({ ...retained(d), launchPrompts: { status, reason, answers: [], receipt: [] } });
    assert.equal(r.launchPrompts.reason, reason);
    assert.equal(launchPromptOutcome(r.launchPrompts).reason, reason);
    assert.ok(retainedSpawnMessage(r).includes(reason));
    assert.doesNotMatch(retainedSpawnMessage(r), /Launch requires inspection/);
  });
}
test('the six reasons a 0.52 kernel no longer writes stay read: a 0.44 to 0.51 kernel and its recorded homes send them', () => {
  for (const [status, reason] of [['blocked', 'blocked: launch geometry not pinned'], ['blocked', 'blocked: prompt consent absent'],
    ['incomplete', 'launch prompt audit failed before geometry pin'], ['incomplete', 'launch prompt audit failed after geometry pin'],
    ['incomplete', 'launch prompt geometry pin failed'], ['incomplete', 'launch prompt geometry restoration incomplete']]) {
    assert.equal(launchPromptOutcome({ status, reason, answers: [], receipt: [] }).reason, reason);
  }
});
test('reasons are matched whole: no prefix and no suffix is accepted', () => {
  for (const reason of ['blocked: invalid target; private launch evidence retention failed', 'private launch evidence retention failed; blocked: unexpected prompt',
    'blocked: unexpected prompt; ', 'private launch evidence retention failed.', ' private launch evidence retention failed']) {
    assert.equal(launchPromptOutcome({ status: 'blocked', reason, answers: [], receipt: [] }).reason, 'Launch requires inspection');
  }
});

const flat = DIFFERED;
test('differed: the kernel shape decodes to {nearest, index, expected, found}', () => {
  assert.deepEqual(launchPromptDiffered(differed()), flat);
  assert.deepEqual(launchPromptDiffered(differed({ index: 212 })), { ...flat, index: 212 });
  // Keys the reader does not list are not carried.
  assert.deepEqual(launchPromptDiffered({ ...differed({ screen: 'PRIVATE' }), raw: 'PRIVATE' }), flat);
});
test('differed: each malformed part drops the whole fact', () => {
  const forty = 'x'.repeat(40);
  assert.deepEqual(launchPromptDiffered(differed({ expected: forty, found: forty })), { ...flat, expected: forty, found: forty });
  for (const bad of [undefined, null, 'aweb-dev-channel-confirmation-1', 7, [], {}, { nearest: 'aweb-dev-channel-confirmation-1' }, { ...differed(), firstDifference: null }, { ...differed(), firstDifference: 'x' },
    { ...differed(), firstDifference: [] }, differed({}, ''), differed({}, 7), differed({}, null), differed({}, 'x'.repeat(257)), differed({}, 'entry\n2'), differed({}, 'token=PRIVATE'),
    differed({ index: -1 }), differed({ index: 1.5 }), differed({ index: '3' }), differed({ index: 2 ** 53 }), differed({ index: null }), differed({ index: undefined }),
    differed({ expected: 7 }), differed({ expected: null }), differed({ expected: undefined }), differed({ expected: `${forty}x` }),
    differed({ found: 7 }), differed({ found: null }), differed({ found: undefined }), differed({ found: `${forty}x` }), differed({ found: ['x'] })]) {
    assert.equal(launchPromptDiffered(bad), undefined, JSON.stringify(bad));
  }
  assert.equal(launchPromptDiffered(differed({}, 'x'.repeat(256))).nearest.length, 256);
});
test('differed: each side is one display line, or null when there is nothing to show', () => {
  const side = found => launchPromptDiffered(differed({ found })).found;
  assert.equal(side(''), null);
  assert.equal(side(' \t '), null);
  assert.equal(launchPromptDiffered(differed({ expected: '' })).expected, null);
  assert.equal(side('Yes\tNo\u2028Maybe'), 'Yes No Maybe');
  assert.equal(side('abc\u202Edef\u2066ghi'), 'abc\uFFFDdef\uFFFDghi');
  assert.equal(side('abc\u001b[31mdef'), DETAIL_WITHHELD);
  // Withheld for that side only: the other side and the fact stay.
  assert.deepEqual(launchPromptDiffered(differed({ found: 'password: hunter2' })), { ...flat, found: DETAIL_WITHHELD });
  assert.deepEqual(launchPromptDiffered(differed({ expected: 'api_key=abc', found: 'ok' })), { ...flat, expected: DETAIL_WITHHELD, found: 'ok' });
  // The kernel cuts at 40 UTF-16 units, so a side can end in half a pair: kept as sent, and it survives JSON.
  const cut = `${'x'.repeat(39)}\uD83D`;
  const decoded = launchPromptDiffered(differed({ found: cut }));
  assert.equal(decoded.found, cut);
  assert.deepEqual(launchPromptDiffered(JSON.parse(JSON.stringify(decoded))), decoded);
});
test('differed: decoding its own answer gives the same answer', () => {
  for (const d of [differed(), differed({ index: 212 }), differed({ expected: '' }), differed({ found: '' }), differed({ expected: '', found: '' }),
    differed({ found: 'password: hunter2' }), differed({ found: 'a\u202Eb\tc' }), differed({ found: `${'x'.repeat(39)}\uD83D` })]) {
    const once = launchPromptDiffered(d);
    assert.ok(once);
    assert.deepEqual(launchPromptDiffered(once), once);
    assert.deepEqual(launchPromptDiffered(JSON.parse(JSON.stringify(once))), once);
  }
  // Only this module's own answer holds null; its other parts are held to the same rules.
  assert.equal(launchPromptDiffered({ ...flat, index: -1 }), undefined);
  assert.equal(launchPromptDiffered({ ...flat, found: 'x'.repeat(41) }), undefined);
  assert.equal(launchPromptDiffered({ ...flat, found: undefined }), undefined);
});
test('outcome: only a blocked result carries what differed', () => {
  const blocked = launchPromptOutcome({ ...launchPrompts(), differed: differed() });
  assert.deepEqual(blocked.differed, flat);
  assert.deepEqual(launchPromptOutcome(blocked), blocked);
  for (const status of ['incomplete', 'unknown']) assert.equal(Object.hasOwn(launchPromptOutcome({ ...launchPrompts(status), status, differed: differed() }), 'differed'), false);
  // A blocked result without it (an invalid target has no screen): no key.
  assert.equal(Object.hasOwn(launchPromptOutcome({ status: 'blocked', reason: 'blocked: invalid target', answers: [], receipt: [] }), 'differed'), false);
  // The suffixed reason and what differed travel together.
  const suffixed = launchPromptOutcome({ ...launchPrompts(), reason: 'blocked: unexpected prompt; private launch evidence retention failed', differed: differed() });
  assert.equal(suffixed.reason, 'blocked: unexpected prompt; private launch evidence retention failed');
  assert.deepEqual(suffixed.differed, flat);
});
test('outcome: a malformed differed drops that fact and nothing else', () => {
  const plain = launchPromptOutcome(launchPrompts());
  for (const bad of [null, 'x', 7, [], {}, differed({ index: -1 }), differed({ found: 7 }), differed({ expected: 'x'.repeat(41) }), differed({}, '')]) {
    const r = launchPromptOutcome({ ...launchPrompts(), differed: bad });
    assert.deepEqual(r, plain, JSON.stringify(bad));
    const kept = retainedSpawnDetails({ ...retained(d), launchPrompts: { ...launchPrompts(), differed: bad } });
    assert.equal(kept.home, d.home); assert.deepEqual(kept.launchPrompts, plain);
  }
});
test('outcome: at the byte limit it is still unknown, with or without differed', () => {
  const r = launchPromptOutcome({ ...launchPrompts(), differed: differed(), padding: 'x'.repeat(32769) });
  assert.deepEqual(r, { status: 'unknown', answers: [], reason: 'Launch requires inspection', receipt: [] });
});
test('differed crosses the apply view twice (server, then main and renderer) unchanged', async () => {
  const { spawnApplyView } = await import('../../client/spawn-apply-contract.mjs');
  const incomplete = retainedSpawnDetails({ ...retained(d), launchPrompts: { ...launchPrompts(), differed: differed({ found: 'a\u202Eb' }) } });
  const target = { workspace: '/example', context: '/example', selector: { soul: 'dev', agentsRoot: '/example/agents' } };
  const view = { spawnApplyViewApi: 1, status: 'incomplete', target, spawnRef: 'a'.repeat(64), preview: null, receipt: null,
    reason: { code: 'E_SPAWN_INCOMPLETE', message: 'x' }, incomplete };
  const once = spawnApplyView(view), twice = spawnApplyView(JSON.parse(JSON.stringify(once)));
  assert.deepEqual(once.incomplete.launchPrompts.differed, { ...flat, found: 'a\uFFFDb' });
  assert.deepEqual(twice, once);
});

// The reader's answer is read again by the renderer, so it is held to the bound it was read under.
const size = v => new TextEncoder().encode(JSON.stringify(v)).length;
/** `base` with the 16 receipts of two paths the reader keeps, filled to exactly `bytes`. */
function filled(base, bytes = 32768) {
  const receipt = last => Array.from({ length: 16 }, (_, i) => ({ ok: true,
    results: [{ path: `/${'p'.repeat(990)}`, ok: true }, { path: `/${'p'.repeat(i === 15 ? last : 990)}`, ok: true }] }));
  const v = { ...base, receipt: receipt(1 + bytes - size({ ...base, receipt: receipt(1) })) };
  assert.equal(size(v), bytes);
  return v;
}
test('outcome: a side withheld at the exact bound drops what differed, and the answer reads back the same', () => {
  // Built in this module's own form (the renderer's second read): the kernel's form has a firstDifference
  // wrapper the answer drops, which can outweigh what the withheld word adds. How much the answer grows is
  // measured, never assumed from the word's length; the fill then puts the answer with what differed one
  // byte over the bound, and exactly at it.
  const base = { status: 'blocked', reason: 'blocked: unexpected prompt', answers: [], differed: { ...DIFFERED, expected: '\u007f', found: '\u007f' } };
  const small = filled(base, 32768 - 256), read = launchPromptOutcome(small);
  assert.deepEqual(read.differed, { ...DIFFERED, expected: DETAIL_WITHHELD, found: DETAIL_WITHHELD }, 'both sides are withheld');
  const growth = size(read) - size(small);
  assert.ok(growth > 0, `withholding the sides makes the answer longer than what was read (${growth} bytes)`);
  const at = filled(base, 32768 + 1 - growth), once = launchPromptOutcome(at);
  assert.equal(size({ ...once, differed: read.differed }), 32769, 'with what differed, the answer is one byte over the bound');
  assert.equal(Object.hasOwn(once, 'differed'), false);
  assert.equal(once.status, 'blocked'); assert.equal(once.reason, 'blocked: unexpected prompt'); assert.equal(once.receipt.length, 16);
  assert.ok(size(once) <= 32768);
  assert.deepEqual(launchPromptOutcome(JSON.parse(JSON.stringify(once))), once);
  const kept = retainedSpawnDetails({ ...retained(d), launchPrompts: at });
  assert.equal(kept.home, d.home); assert.deepEqual(kept.launchPrompts, once);
  // One byte less: the answer with what differed is exactly at the bound, and keeps it.
  const fits = launchPromptOutcome(filled(base, 32768 - growth));
  assert.deepEqual(fits.differed, read.differed); assert.equal(size(fits), 32768);
  assert.deepEqual(launchPromptOutcome(JSON.parse(JSON.stringify(fits))), fits);
});
test('outcome: what differed is kept at the exact bound when the answer with it fits', () => {
  const once = launchPromptOutcome(filled({ status: 'blocked', reason: 'blocked: unexpected prompt', answers: [], differed: differed() }));
  assert.deepEqual(once.differed, DIFFERED);
  assert.ok(size(once) <= 32768);
  assert.deepEqual(launchPromptOutcome(JSON.parse(JSON.stringify(once))), once);
});
test('outcome: an answer the generic reason takes over the bound is unknown at the first read, as at the second', () => {
  const once = launchPromptOutcome(filled({ status: 'blocked', answers: [] }));
  assert.deepEqual(once, { status: 'unknown', answers: [], reason: 'Launch requires inspection', receipt: [] });
  assert.deepEqual(launchPromptOutcome(once), once);
  // One byte of room for nothing: with its reason in the set, the same input is read whole.
  const whole = launchPromptOutcome(filled({ status: 'blocked', reason: 'blocked: unexpected prompt', answers: [] }));
  assert.equal(whole.status, 'blocked'); assert.equal(whole.receipt.length, 16);
  assert.deepEqual(launchPromptOutcome(whole), whole);
});

test('boundedWarnings: display lines in order, cut by position at both bounds; launchFlagIgnored uses it', () => {
  assert.deepEqual(boundedWarnings(undefined), { warnings: [], omitted: 0 });
  assert.deepEqual(boundedWarnings('one warning'), { warnings: [], omitted: 0 });
  assert.deepEqual(boundedWarnings(['a', '', 7, null, 'token=abc123secret', 'b\nc']), { warnings: ['a', DETAIL_WITHHELD, 'b c'], omitted: 0 });
  const many = Array.from({ length: FLAG_IGNORED_WARNINGS + 3 }, (_, i) => `w${i}`);
  assert.deepEqual(boundedWarnings(many), { warnings: many.slice(0, FLAG_IGNORED_WARNINGS), omitted: 3 });
  const long = 'x'.repeat(MAX_DISPLAY_LINE);
  assert.equal(FLAG_IGNORED_UNITS, 2 * MAX_DISPLAY_LINE);
  assert.deepEqual(boundedWarnings([long, 'a', long, 'b']), { warnings: [long, 'a'], omitted: 2 });
  for (const raw of [many, [long, 'a', long, 'b'], ['a']]) {
    const b = boundedWarnings(raw);
    assert.ok(boundedWarningsValid(b.warnings, b.omitted));
    assert.deepEqual(launchFlagIgnored({ launchPrompts: { status: 'flag-ignored' }, warnings: raw }), { reason: null, ...b });
  }
  assert.equal(boundedWarningsValid(['a'], 1), false);
  assert.equal(boundedWarningsValid([], 0), true);
});
