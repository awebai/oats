// A local spawn that worked while Claude Code ignored the channel option (OATS 0.52.0): a launched spawn's
// successful answer carries `launchPrompts: {status: "flag-ignored", ...}` in the start's shape. The creation
// receipt carries the reader's fact for it as `flagIgnored`, the view reads it again at each boundary, and the
// place that ends the apply says it once in a notice: the background store in the shipped shell, the dialog
// itself where it runs its own apply. The store's own tests are in spawn-instant.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnCreationReceipt, spawnApplyView } from '../../client/spawn-apply-contract.mjs';
import { launchFlagIgnored, flagIgnoredFact, FLAG_IGNORED_WARNINGS, FLAG_IGNORED_UNITS, FLAG_IGNORED_BYTES, LAUNCH_DIAGNOSTIC_BYTES } from '../../client/launch-prompt-outcome.mjs';
import { DETAIL_WITHHELD, MAX_DISPLAY_LINE } from '../../client/display-text.mjs';
import { createSpawnApplyBoundary } from '../server/spawn-apply.mjs';
import { target, selector, data, kernel, cli as CLI, DEPLOYMENT, ROOT } from './helpers/spawn-preview-fixture.mjs';
import { creation } from './helpers/spawn-apply-fixture.mjs';
import { flagIgnored, FLAG_IGNORED_WARNING, DEV_CHANNEL_STATEMENT } from './helpers/launch-prompt-fixture.mjs';
import { mountSpawn, settle } from './helpers/spawn-dialog-host.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const preview = () => data();
const NAME = preview().decision.instance;
const UNAVAILABLE = `${NAME} started. Claude Code reported that channels are not available and ignored the channel option, so mail and chat will not wake this instance.`;
const numbered = n => Array.from({ length: n }, (_, i) => `warning ${i + 1}`);
/** The kernel's answer to a launched spawn, as `oats spawn --json` gives it from 0.52.0. */
const answer = (changes = {}) => creation(preview(), { launchPrompts: flagIgnored(), warnings: [DEV_CHANNEL_STATEMENT, FLAG_IGNORED_WARNING], ...changes });
const receiptOf = changes => spawnCreationReceipt(answer(changes), { target, preview: preview() });
const FACT = { reason: 'channels-unavailable', warnings: [DEV_CHANNEL_STATEMENT, FLAG_IGNORED_WARNING], omitted: 0 };
const REF = 'a'.repeat(64);
const viewOf = (receipt, extra = {}) => ({ spawnApplyViewApi: 1, status: 'complete', target, spawnRef: REF, preview: preview(), wakeRequested: false, receipt, reason: null, ...extra });
const without = receipt => { const { flagIgnored: _dropped, ...rest } = receipt; return rest; };

test('the receipt carries the reader\'s own answer as `flagIgnored`, and nothing else of the warnings', () => {
  const receipt = receiptOf();
  assert.deepEqual(receipt.flagIgnored, FACT);
  assert.deepEqual(receipt.flagIgnored, launchFlagIgnored(answer()), 'the same reader as the start\'s');
  assert.equal(receipt.warningCount, 2, 'the count stays what it was');
  assert.deepEqual(Object.keys(receipt).at(-1), 'flagIgnored');
  // Facts only: the three keys of the reader's answer, so no headline and no sentence of the Desktop's.
  assert.deepEqual(Object.keys(receipt.flagIgnored), ['reason', 'warnings', 'omitted']);
  assert.doesNotMatch(JSON.stringify(receiptOf({ warnings: ['a launch hook said something'] })), /started\.|mail and chat|OATS says|not shown/);
  // The other reason, and no warnings at all.
  assert.deepEqual(receiptOf({ launchPrompts: flagIgnored({ reason: 'another-reason' }) }).flagIgnored, { ...FACT, reason: null });
  assert.deepEqual(receiptOf({ warnings: [] }).flagIgnored, { reason: 'channels-unavailable', warnings: [], omitted: 0 });
  // Bounded: the first 16 display lines; a withheld one is its marker and counts.
  assert.deepEqual(receiptOf({ warnings: numbered(40) }).flagIgnored, { reason: 'channels-unavailable', warnings: numbered(FLAG_IGNORED_WARNINGS), omitted: 24 });
  assert.equal(receiptOf({ warnings: numbered(40) }).warningCount, 40, '`omitted` is not derived from the count');
  assert.deepEqual(receiptOf({ warnings: ['', 'token=ghp_abcdefghijklmnopqrstuvwxyz012345', 'kept'] }).flagIgnored.warnings, [DETAIL_WITHHELD, 'kept']);
  assert.equal(receiptOf({ warnings: ['', 'kept'] }).warningCount, 2, 'the count is of entries; the lines are fewer');
});

test('any other status, no `launchPrompts`, one that does not decode, or a spawn that was not launched: the receipt of today', () => {
  const today = receiptOf({ launchPrompts: undefined });
  assert.equal(Object.hasOwn(today, 'flagIgnored'), false);
  for (const launchPrompts of [undefined, null, 'flag-ignored', 7, [], [flagIgnored()], {}, { reason: 'channels-unavailable' }, { status: 'Flag-Ignored' }, { status: 'flag-ignored ' },
    { status: 'not-engaged', startId: 's', at: 't' }, { status: 'completed', answers: [], reason: 'recognized launch boundary', receipt: [] },
    { status: 'blocked', reason: 'channels-unavailable' }, { status: 'flag-future', reason: 'channels-unavailable' }])
    assert.deepEqual(receiptOf({ launchPrompts }), today, JSON.stringify(launchPrompts));
  // A `--no-launch` spawn has no `launchPrompts`. An answer that says both "not launched" and "flag-ignored"
  // contradicts itself: the notice says "started", so it reads as today's "not launched".
  const scaffold = receiptOf({ launched: false, launchPrompts: undefined });
  assert.deepEqual(receiptOf({ launched: false }), scaffold); assert.equal(Object.hasOwn(scaffold, 'flagIgnored'), false);
  // The receipt's own refusals do not change: a malformed answer is still no receipt.
  assert.equal(receiptOf({ warnings: 'none' }), null); assert.equal(receiptOf({ launched: 'yes' }), null);
});

test('a replayed spawn keeps the key: the replay is the home\'s own record, with whatever warnings the answer has', () => {
  // lib/core.mjs `spawnInstanceAsync`, key recovery: `{...prior, replayed: true, warnings: replayedContractWarnings(home)}`.
  // `launched` and `launchPrompts` are what the first spawn recorded; the flag-ignored warning is not repeated.
  const replayed = receiptOf({ replayed: true, warnings: [] });
  assert.equal(replayed.replayed, true); assert.equal(replayed.launched, true);
  assert.deepEqual(replayed.flagIgnored, { reason: 'channels-unavailable', warnings: [], omitted: 0 });
  assert.deepEqual(receiptOf({ replayed: true, warnings: ['a hook event this kernel ignores'] }).flagIgnored.warnings, ['a hook event this kernel ignores']);
  // A replayed scaffold recorded `launched: false`: no key.
  assert.equal(Object.hasOwn(receiptOf({ replayed: true, launched: false, launchPrompts: undefined }), 'flagIgnored'), false);
});

test('the view reads the key again through the reader\'s decoder, and crossing it twice changes nothing', () => {
  const receipt = receiptOf({ warnings: [...numbered(20)] });
  const once = spawnApplyView(JSON.parse(JSON.stringify(viewOf(receipt))), { workspace: target.workspace, ref: REF, selector });
  assert.deepEqual(once.receipt.flagIgnored, { reason: 'channels-unavailable', warnings: numbered(16), omitted: 4 });
  assert.deepEqual(once.receipt, receipt);
  const twice = spawnApplyView(JSON.parse(JSON.stringify(once)), { workspace: target.workspace, ref: REF, selector });
  assert.deepEqual(twice, once);
  // It is read from the receipt's own key, never composed again from the warnings, which are a count here:
  // a view whose receipt also holds the kernel's `launchPrompts` gets nothing from it.
  const smuggled = spawnApplyView(viewOf({ ...without(receipt), launchPrompts: flagIgnored(), warnings: [FLAG_IGNORED_WARNING] }));
  assert.deepEqual(smuggled.receipt, without(receipt));
  // An older server sends none; a partial apply keeps it beside its own reason.
  assert.deepEqual(spawnApplyView(viewOf(without(receipt))).receipt, without(receipt));
  const wake = { requested: true, saved: false, error: { code: 'E_SCHEDULE', message: 'x' } };
  const partial = spawnCreationReceipt(answer({ wake }), { target, preview: preview(), wakeRequested: true });
  const partialView = spawnApplyView(viewOf(partial, { status: 'partial', wakeRequested: true }));
  assert.deepEqual(partialView.receipt.flagIgnored, FACT); assert.equal(partialView.reason.code, 'E_WAKE_SAVE_FAILED');
});

test('a malformed fact at the boundary is dropped and the receipt stands, equal to today\'s', () => {
  const receipt = receiptOf(), today = spawnApplyView(viewOf(without(receipt)));
  assert.ok(today.receipt); assert.equal(Object.hasOwn(today.receipt, 'flagIgnored'), false);
  for (const value of [null, undefined, 'flag-ignored', 7, true, [], [FACT], {}, { ...FACT, headline: 'x' }, { reason: 'channels-unavailable', warnings: [] },
    { ...FACT, reason: 'another-reason' }, { ...FACT, warnings: 'one' }, { ...FACT, warnings: [7] }, { ...FACT, warnings: ['two\nlines'] }, { ...FACT, warnings: [' padded '] },
    { ...FACT, warnings: ['x'.repeat(MAX_DISPLAY_LINE + 1)] }, { ...FACT, warnings: numbered(17) }, { ...FACT, omitted: -1 }, { ...FACT, omitted: 1.5 }, { ...FACT, omitted: 3 },
    { ...FACT, warnings: ['token=ghp_abcdefghijklmnopqrstuvwxyz012345'] }, flagIgnored(), answer()]) {
    const view = spawnApplyView(viewOf({ ...receipt, flagIgnored: value }));
    assert.deepEqual(view, today, JSON.stringify(value)?.slice(0, 80));
  }
  // A receipt that says "not launched" carries none, whatever its key holds.
  const scaffold = receiptOf({ launched: false, launchPrompts: undefined });
  assert.equal(Object.hasOwn(spawnApplyView(viewOf({ ...scaffold, flagIgnored: FACT })).receipt, 'flagIgnored'), false);
  // The receipt's own checks are untouched by the key: a view that was refused is still refused.
  assert.equal(spawnApplyView(viewOf({ ...receipt, workspace: 'elsewhere' })), null);
});

test('the broker keeps the fact on its reply, for the apply and for every later `result`, and reserves its bytes', async () => {
  const context = () => ({ workspace: { id: 'northwind', scope: DEPLOYMENT }, cli: structuredClone(CLI), agents: [{ name: 'release-manager', agentsRoot: ROOT, work: 'worktree' }], instances: [] });
  let ids = 0;
  const broker = createSpawnApplyBoundary({ mint: () => (++ids).toString(16).padStart(64, '0'), read: async () => ({ status: 'available', data: preview() }),
    invoke: async () => ({ started: true, envelope: { schemaVersion: 1, ok: true, result: answer({ warnings: numbered(18) }) } }) });
  const prepared = await broker({ action: 'prepare', selector, choices: { purpose: 'api-v2' }, task: '' }, context);
  assert.equal(prepared.status, 'prepared');
  const applied = await broker({ action: 'apply', spawnRef: prepared.spawnRef }, context);
  assert.equal(applied.status, 'complete');
  const fact = { reason: 'channels-unavailable', warnings: numbered(16), omitted: 2 };
  assert.deepEqual(applied.receipt.flagIgnored, fact);
  for (const action of ['result', 'result', 'apply']) {
    const again = await broker({ action, spawnRef: prepared.spawnRef }, context);
    assert.deepEqual(again.receipt.flagIgnored, fact, action);
    // Main's proxy and the renderer each read it again: the same fact.
    const main = spawnApplyView(JSON.parse(JSON.stringify(again)), { workspace: 'northwind', ref: prepared.spawnRef });
    assert.deepEqual(spawnApplyView(JSON.parse(JSON.stringify(main)), { workspace: 'northwind', ref: prepared.spawnRef, selector }).receipt.flagIgnored, fact);
  }
  // The server holds no logic of its own for it: it passes the kernel's result to the receipt and reserves the bound.
  const server = read('../server/spawn-apply.mjs');
  assert.doesNotMatch(server, /'flag-ignored'|\.flagIgnored|launchFlagIgnored|flagIgnoredFact|flagIgnoredNotice|channels-unavailable|launchPrompts\.status/);
  assert.match(server, /Math\.max\(LAUNCH_DIAGNOSTIC_BYTES, FLAG_IGNORED_BYTES\)/);
});

test('the largest fact the decoder accepts fits the byte bound, and the broker\'s reservation is what it was', () => {
  const bytes = v => Buffer.byteLength(JSON.stringify(v)); // as the broker counts (byteSize)
  // The largest facts: the bound on the total filled, by two lines of the longest a line can be, or by 16 lines.
  const shapes = unit => [[2, MAX_DISPLAY_LINE], [FLAG_IGNORED_WARNINGS, FLAG_IGNORED_UNITS / FLAG_IGNORED_WARNINGS]].map(([lines, units]) =>
    ({ reason: 'channels-unavailable', warnings: Array(lines).fill(unit.repeat(units / unit.length)), omitted: Number.MAX_SAFE_INTEGER }));
  // A lone surrogate is one UTF-16 unit and six bytes as JSON (an escape): the most a unit of a display line costs.
  const lone = String.fromCharCode(0xD83D);
  const sizes = {};
  for (const [name, unit] of [['ascii', 'x'], ['quote', '"'], ['backslash', '\\'], ['bmp', String.fromCharCode(0x4E2D)], ['astral', String.fromCodePoint(0x1F600)], ['lone', lone], ['replacement', String.fromCharCode(0xFFFD)]]) {
    for (const fact of shapes(unit)) {
      assert.deepEqual(flagIgnoredFact(fact), fact, `${name}: the decoder accepts it`);
      assert.equal(fact.warnings.join('').length, FLAG_IGNORED_UNITS);
      sizes[name] = Math.max(sizes[name] ?? 0, bytes(fact));
      assert.ok(bytes(fact) <= FLAG_IGNORED_BYTES, `${name}: ${bytes(fact)} bytes`);
    }
  }
  assert.equal(Math.max(...Object.values(sizes)), sizes.lone);
  const frame = bytes({ reason: 'channels-unavailable', warnings: Array(FLAG_IGNORED_WARNINGS).fill(''), omitted: Number.MAX_SAFE_INTEGER });
  assert.equal(sizes.lone, FLAG_IGNORED_UNITS * 6 + frame, 'six bytes a unit, plus the keys and punctuation');
  assert.ok(FLAG_IGNORED_BYTES - sizes.lone < 256, 'and the bound is no looser than its margin');
  // One unit more in total, or one line more, is not a fact the decoder accepts.
  assert.equal(flagIgnoredFact({ ...shapes(lone)[0], warnings: [lone.repeat(MAX_DISPLAY_LINE), lone.repeat(MAX_DISPLAY_LINE), 'x'] }), undefined);
  assert.equal(flagIgnoredFact({ ...shapes('x')[1], warnings: Array(FLAG_IGNORED_WARNINGS + 1).fill('x') }), undefined);
  // The numbers: the fact's bound is under the retained diagnostics', so a transaction reserves what it did before.
  assert.equal(FLAG_IGNORED_BYTES, 24832); assert.equal(LAUNCH_DIAGNOSTIC_BYTES, 32768);
  assert.equal(4096 + Math.max(LAUNCH_DIAGNOSTIC_BYTES, FLAG_IGNORED_BYTES), 36864);
  assert.equal(4096 + Math.max(LAUNCH_DIAGNOSTIC_BYTES, FLAG_IGNORED_BYTES), 4096 + LAUNCH_DIAGNOSTIC_BYTES);
});

test('the broker holds as many transactions as before: the two counts bind first, 64 with the fixture\'s preview', async () => {
  const context = () => ({ workspace: { id: 'northwind', scope: DEPLOYMENT }, cli: structuredClone(CLI), agents: [{ name: 'release-manager', agentsRoot: ROOT, work: 'worktree' }], instances: [] });
  let ids = 0;
  const broker = createSpawnApplyBoundary({ mint: () => (++ids).toString(16).padStart(64, '0'), read: async () => ({ status: 'available', data: preview() }),
    invoke: async () => ({ started: false, envelope: { schemaVersion: 1, ok: false, error: { code: 'E_BRANCH_EXISTS', message: 'x' } } }) });
  let held = 0, last;
  for (let i = 0; i < 80; i++) {
    last = await broker({ action: 'prepare', selector, choices: { purpose: 'api-v2' }, task: '' }, context);
    if (last.status !== 'prepared') break;
    held++;
    // The first 32 are submitted, so their outcomes are kept; the rest stay prepared.
    if (i < 32) assert.equal((await broker({ action: 'apply', spawnRef: last.spawnRef }, context)).status, 'refused');
  }
  assert.equal(held, 64, '32 kept outcomes and 32 prepared confirmations');
  assert.equal(last.reason.code, 'E_BUSY');
});

// ── the dialog that runs its own apply (no store: the view harness). In the shipped shell the store ends every local spawn.
const press = async (t, apply, wake = null) => {
  const u = await mountSpawn(t, { apply });
  const notices = []; u.ctx.notify = (...args) => { notices.push(args); };
  await u.open(); await u.type('.fpurpose', 'api-v2');
  if (wake) await wake(u);
  u.q('.fspawn').click(); await settle(30);
  return { u, notices };
};
const kernelAnswer = (changes = {}) => () => ({ started: true, envelope: { schemaVersion: 1, ok: true, result: answer(changes) } });

test('dialog: its own completion shows the notice once, beside what the completion says', async t => {
  const { u, notices } = await press(t, kernelAnswer());
  assert.match(u.text('.fstatus'), new RegExp(`^Created ${NAME}`));
  assert.deepEqual(notices, [[UNAVAILABLE, { detail: `OATS says:\n${DEV_CHANNEL_STATEMENT}\n${FLAG_IGNORED_WARNING}` }]]);
  // The press is spent: the completion cannot be reached a second time from this dialog.
  assert.equal(u.q('.fspawn').disabled, true);
  u.q('.fspawn').click(); await settle(10);
  assert.equal(notices.length, 1); assert.equal(u.applied.length, 1);
});

test('dialog: a partial apply shows both facts: the notice once, and the wake schedule that was not saved, with View schedules', async t => {
  const requestWake = async u => {
    u.q('.spawn-advanced').open = true; u.q('.fwake-enabled').checked = true; u.q('.fwake-enabled').dispatchEvent(new u.dom.window.Event('change', { bubbles: true }));
    u.q('.fwake-message').value = 'check in'; await settle();
  };
  const { u, notices } = await press(t, kernelAnswer({ wake: { requested: true, saved: false, error: { code: 'E_SCHEDULE', message: 'PRIVATE scheduler text' } } }), requestWake);
  assert.equal(u.spawns().at(0).wake.message, 'check in', 'the wake was requested');
  // The channel notice, exactly and once.
  assert.deepEqual(notices, [[UNAVAILABLE, { detail: `OATS says:\n${DEV_CHANNEL_STATEMENT}\n${FLAG_IGNORED_WARNING}` }]]);
  // And the partial apply's own fact is not lost to it: its status, and the way to the schedules.
  assert.match(u.text('.fstatus'), /wake schedule was not saved/); assert.doesNotMatch(u.text('.fstatus'), /PRIVATE/);
  assert.equal(u.dialog().querySelector('.guarded-schedules').textContent, 'View schedules');
  assert.equal(u.q('.fspawn').textContent, 'Created'); assert.equal(u.q('.fspawn').disabled, true);
  // Created: another press applies nothing and says nothing again.
  u.q('.fspawn').click(); await settle(10);
  assert.equal(u.applied.length, 1); assert.equal(notices.length, 1);
  assert.equal(u.dialog().querySelectorAll('.guarded-schedules').length, 1);
});

test('dialog: a replay shows it too; no warnings, no detail; more than 16 says how many more', async t => {
  const replay = await press(t, kernelAnswer({ replayed: true, warnings: [] }));
  assert.deepEqual(replay.notices, [[UNAVAILABLE, undefined]]);
  const many = await press(t, kernelAnswer({ warnings: numbered(19) }));
  assert.deepEqual(many.notices, [[UNAVAILABLE, { detail: ['OATS says:', ...numbered(16), '3 more not shown.'].join('\n') }]]);
});

test('dialog: any other spawn that worked reads as today, with no notice, whatever its warnings say', async t => {
  for (const changes of [{ launchPrompts: undefined }, { launchPrompts: { status: 'not-engaged', startId: 's', at: 't' } },
    { launchPrompts: { status: 'completed', answers: [], reason: 'recognized launch boundary', receipt: [] } }, { launchPrompts: 'flag-ignored' },
    { launched: false }, { launched: false, launchPrompts: undefined }]) {
    const { u, notices } = await press(t, kernelAnswer(changes));
    assert.deepEqual(notices, [], JSON.stringify(changes));
    assert.match(u.text('.fstatus'), new RegExp(`^Created ${NAME}`));
  }
});

test('the spawn\'s path holds no sentence of its own and never looks at a warning\'s words', () => {
  const reader = read('../../client/launch-prompt-outcome.mjs');
  assert.equal(reader.match(/'flag-ignored'/g).length, 1, 'the status is read in the reader, once');
  // The contract passes the answer to the reader and the key to the decoder; the two callers make the notice from the fact.
  const contract = read('../../client/spawn-apply-contract.mjs');
  assert.doesNotMatch(contract, /'flag-ignored'|'channels-unavailable'|\.status\s*[!=]==\s*'flag|started\.|OATS says|not shown/);
  assert.equal(contract.match(/launchFlagIgnored\(/g).length, 1); assert.equal(contract.match(/flagIgnoredFact\(/g).length, 1);
  for (const path of ['../renderer/spawn-jobs.mjs', '../renderer/spawn-dialog.mjs']) {
    const source = read(path);
    assert.doesNotMatch(source, /'flag-ignored'|channels-unavailable|will not wake this|OATS says|more not shown|launchFlagIgnored|flagIgnored\??\.warnings|receipt\??\.warnings/, path);
    assert.equal(source.match(/flagIgnoredNotice\(/g).length, 1, path);
  }
  // Main's proxy, the CLI adapter, the Spawn view and the spawn's sentences know nothing of it.
  for (const path of ['../spawn-apply-proxy.mjs', '../../client/spawn-apply-cli.mjs', '../renderer/views/spawn.mjs', '../../client/spawn-messages.mjs'])
    assert.doesNotMatch(read(path), /flag-ignored|flagIgnored|FlagIgnored|FLAG_IGNORED|channels-unavailable/, path);
});

test('the kernel\'s captured apply, which predates `launchPrompts`, still gives today\'s receipt', () => {
  const raw = kernel('apply-bound').result;
  assert.equal(Object.hasOwn(raw, 'launchPrompts'), false);
  assert.equal(Object.hasOwn(spawnCreationReceipt(creation(preview()), { target, preview: preview() }), 'flagIgnored'), false);
});
