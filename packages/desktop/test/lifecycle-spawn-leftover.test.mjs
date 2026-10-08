// A home a spawn left (#801, OATS 0.49.0): the retire receipt's `spawnCompensation`, read tolerantly and shown
// in the result, and the kernel's E_LIFECYCLE_BUSY for a quarantined (`rollbackIncomplete`) row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createLifecycleDialog } from '../renderer/lifecycle-dialog.mjs';
import { lifecycleReceipt, publicLifecycleReceipt, lifecycleReason, spawnCompensationOf } from '../renderer/lifecycle-contract.mjs';
import { createLifecycleBoundary } from '../server/instance-lifecycle.mjs';
import { context, envelope, instance, retirePlan, retireReceipt, tick } from './helpers/lifecycle-fixture.mjs';
import { assertIsolatedDetail, MESSY, MESSY_LINE } from './helpers/detail-line.mjs';

const LEFTOVER_BUSY = "OATS can't confirm that the spawn which left this home has stopped, so it won't retire it yet. Check the process it names, then retire it from the CLI with --force.";
const KERNEL_BUSY = 'dev-1 is a spawn still running its worktree hooks (pid 4242, started 2026-10-08T10:00:00Z)';
const plan = retirePlan(), args = { key: 'k', revision: plan.planRevision };
const raw = (extra = {}) => ({ ...retireReceipt(args), ...extra });

test('spawnCompensation is projected: deleted, or kept with its reason, through the server and the public re-read', () => {
  for (const compensation of [{ branch: 'agents/dev-1', branchDeleted: true },
    { branch: 'agents/dev-1', branchDeleted: false, reason: 'the tip moved since the spawn created it' }]) {
    const receipt = lifecycleReceipt(raw({ spawnCompensation: { ...compensation, extra: 'ignored' } }), plan, 'k');
    assert.ok(receipt);
    assert.deepEqual(receipt.spawnCompensation, compensation);
    assert.deepEqual(publicLifecycleReceipt(structuredClone(receipt), plan), receipt, 'the renderer reads what the server sent');
  }
  assert.equal(Object.hasOwn(lifecycleReceipt(raw(), plan, 'k'), 'spawnCompensation'), false, 'absent stays absent');
});

for (const [label, value] of [['null', null], ['a string', 'agents/dev-1'], ['an array', [{ branch: 'b', branchDeleted: true }]],
  ['no branch', { branchDeleted: true }], ['an empty branch', { branch: '', branchDeleted: true }], ['a numeric branch', { branch: 7, branchDeleted: true }],
  ['branchDeleted a string', { branch: 'b', branchDeleted: 'true' }], ['branchDeleted absent', { branch: 'b' }],
  ['kept without a reason', { branch: 'b', branchDeleted: false }], ['kept with a numeric reason', { branch: 'b', branchDeleted: false, reason: 1 }],
]) test(`a malformed spawnCompensation (${label}) is ignored and never refuses the receipt`, () => {
  const receipt = lifecycleReceipt(raw({ spawnCompensation: value }), plan, 'k');
  assert.ok(receipt, 'the receipt is accepted');
  assert.equal(Object.hasOwn(receipt, 'spawnCompensation'), false);
  assert.equal(spawnCompensationOf(value), null);
});

test("retire's own branch reports stay refused whole, spawnCompensation or not", () => {
  const compensation = { spawnCompensation: { branch: 'agents/dev-1', branchDeleted: true } };
  assert.equal(lifecycleReceipt(raw({ ...compensation, branchDeleted: true }), plan, 'k'), null);
  for (const key of ['branchDeleted', 'branchDeletionSkipped']) {
    const r = raw(compensation); r.retention = { ...r.retention, [key]: false };
    assert.equal(lifecycleReceipt(r, plan, 'k'), null, `retention.${key}`);
  }
});

/** The dialog over the real server boundary, for a local workspace; `row` is the roster row it opens for. */
function mount(t, { apply, row = instance }) {
  const dom = new JSDOM('<!doctype html><button id="opener">Actions</button>', { pretendToBeVisual: true });
  const doc = dom.window.document, ctx = context();
  const service = createLifecycleBoundary({ invoke: async (_bin, a) => a.phase === 'plan' ? envelope(retirePlan()) : apply(a) });
  const dialog = createLifecycleDialog({ doc, request: (_ws, body) => service(body, () => ctx) });
  t.after(() => { dialog.dispose(); dom.window.close(); });
  return { doc, async retire() { dialog.open({ operation: 'retire', instance: row, workspace: 'team' }); await tick();
    doc.querySelector('.lifecycle-confirm').click(); await tick(); },
  status: () => doc.querySelector('.lifecycle-dialog [role=status]').textContent, lines: () => [...doc.querySelectorAll('.lifecycle-result li')].map(li => li.textContent) };
}
const compensated = compensation => a => envelope({ ...retireReceipt(a), spawnCompensation: compensation });

test('the retire result says the interrupted spawn\'s branch was deleted', async t => {
  const u = mount(t, { apply: compensated({ branch: 'agents/dev-1', branchDeleted: true }) });
  await u.retire();
  assert.ok(u.lines().includes('Branch agents/dev-1 deleted: an interrupted spawn left it, and it held no work.'), u.lines().join('|'));
});

test('the retire result says the branch was kept, and why', async t => {
  const u = mount(t, { apply: compensated({ branch: 'agents/dev-1', branchDeleted: false, reason: 'it is checked out in a worktree' }) });
  await u.retire();
  assert.ok(u.lines().includes('Branch agents/dev-1 kept: it is checked out in a worktree'), u.lines().join('|'));
});

test('the branch and the reason are shown through displayLine, as text', async t => {
  const u = mount(t, { apply: compensated({ branch: `agents/<b>dev</b>\n1`, branchDeleted: false, reason: MESSY }) });
  await u.retire();
  assert.ok(u.lines().includes(`Branch agents/<b>dev</b> 1 kept: ${MESSY_LINE}`), u.lines().join('|'));
  assert.equal(u.doc.querySelector('.lifecycle-result b'), null);
  const v = mount(t, { apply: compensated({ branch: 'agents/dev-1', branchDeleted: false, reason: 'see https://user:pw@host/x' }) });
  await v.retire();
  assert.ok(v.lines().includes('Branch agents/dev-1 kept: [Detail withheld]'), v.lines().join('|'));
  assert.doesNotMatch(v.doc.body.textContent, /user:pw/);
});

test('without spawnCompensation the retire result has no branch line', async t => {
  const u = mount(t, { apply: a => envelope(retireReceipt(a)) });
  await u.retire();
  assert.equal(u.lines().some(line => line.startsWith('Branch ')), false, u.lines().join('|'));
});

const busy = message => () => ({ schemaVersion: 1, ok: false, error: { code: 'E_LIFECYCLE_BUSY', message } });

test('a kernel E_LIFECYCLE_BUSY on a quarantined row says the spawn may still run, with the kernel\'s message under it', async t => {
  const u = mount(t, { apply: busy(KERNEL_BUSY), row: { ...instance, rollbackIncomplete: true } });
  await u.retire();
  assert.equal(u.status(), LEFTOVER_BUSY);
  assert.doesNotMatch(u.doc.body.textContent, /already running/);
  const shown = u.doc.querySelector('.lifecycle-result p');
  assertIsolatedDetail(shown, { before: '', detail: KERNEL_BUSY });
  assert.equal(u.doc.querySelector('.lifecycle-details'), null, 'shown, not behind Details');
  assert.equal(u.doc.querySelector('.lifecycle-dialog h2').textContent, "dev-1 wasn't retired");
  assert.doesNotMatch(u.doc.body.textContent.replace(LEFTOVER_BUSY, ''), /--force/, 'Desktop offers no --force');
});

test('the kernel message under the quarantined busy sentence is one display line', async t => {
  const u = mount(t, { apply: busy(MESSY), row: { ...instance, rollbackIncomplete: true } });
  await u.retire();
  assert.equal(u.status(), LEFTOVER_BUSY);
  assertIsolatedDetail(u.doc.querySelector('.lifecycle-result p'), { before: '', detail: MESSY_LINE });
});

test('every other E_LIFECYCLE_BUSY keeps today\'s sentence', async t => {
  // An ordinary row, the kernel's busy: today's sentence, its message in Details.
  const u = mount(t, { apply: busy(KERNEL_BUSY) });
  await u.retire();
  assert.equal(u.status(), lifecycleReason('E_LIFECYCLE_BUSY').message);
  assert.equal(u.doc.querySelector('.lifecycle-details p').textContent, `E_LIFECYCLE_BUSY: ${KERNEL_BUSY}`);
  // A quarantined row, Desktop's own busy (no kernel message): today's sentence.
  const dom = new JSDOM('<!doctype html>', { pretendToBeVisual: true }), doc = dom.window.document;
  const dialog = createLifecycleDialog({ doc, request: async (_ws, body) => body.action === 'plan'
    ? { lifecycleApi: 1, status: 'plan', target: { ...instance, workspace: 'team', server: null }, planRef: 'd'.repeat(64), plan: retirePlan(), options: { discardWorktree: false }, receipt: null, reason: null }
    : { lifecycleApi: 1, status: 'refused', target: { ...instance, workspace: 'team', server: null }, planRef: null, plan: null, receipt: null, reason: lifecycleReason('E_LIFECYCLE_BUSY') } });
  t.after(() => { dialog.dispose(); dom.window.close(); });
  dialog.open({ operation: 'retire', instance: { ...instance, rollbackIncomplete: true }, workspace: 'team' }); await tick();
  doc.querySelector('.lifecycle-confirm').click(); await tick();
  assert.equal(doc.querySelector('.lifecycle-dialog [role=status]').textContent, lifecycleReason('E_LIFECYCLE_BUSY').message);
});
