import test from 'node:test';
import assert from 'node:assert/strict';
import { lifecyclePlan, lifecycleReceipt } from '../../client/lifecycle-contract.mjs';
import { target, retirePlan, retireReceipt, options } from './helpers/lifecycle-fixture.mjs';

// What an OATS 0.42 kernel adds to a retire plan and to a retire receipt: two
// recovery notes in the plan, and `home`, `notCopied` and `afterHooks` in the
// receipt's workRecovery. The readers accept both and project what they did.
const RECOVERY_ROOT = '/team/agents/dev/instances/.oats-retirement/recovery';
const NOTES = [
  'pull request state is unknown to the kernel; the ADE reports it when a forge connection exists',
  `recovery: the home is copied to ${RECOVERY_ROOT} before the home is removed, when it changed since spawn; not copied: .aw, .aweb-identity, .aweb-identity-*, .oats-aweb (oats.aweb)`,
  'recovery: uncommitted worktree state is copied there too',
];
const plan042 = () => ({ ...retirePlan(), notes: [...NOTES] });

test('a 0.42 retire plan with its two recovery notes is accepted, and the notes are kept as they came', () => {
  const plan = lifecyclePlan(plan042(), target, 'retire', options('retire'));
  assert.ok(plan, 'the reader refused a 0.42 retire plan');
  assert.deepEqual(plan.notes, NOTES);
  assert.equal(plan.action, 'retire');
  assert.equal(plan.facts.workMode, 'worktree');
});

test('a 0.42 retire receipt with workRecovery.home, notCopied and afterHooks is accepted, and only the recovery path is projected', () => {
  const plan = lifecyclePlan(plan042(), target, 'retire', options('retire'));
  const recoveryPath = `${RECOVERY_ROOT}/dev-1-AbC123`;
  const raw = { ...retireReceipt({ revision: plan.planRevision, key: 'k' }), agent: 'dev',
    workRecovery: { path: recoveryPath, classes: ['changed instance-home bytes', 'untracked or ignored worktree bytes'], bytes: 48444211,
      home: { paths: [{ path: '.oats/', bytes: 874696 }, { path: '.agents/', bytes: 141312 }, { path: 'notes/', bytes: 2048 }, { path: 'STATE.md', bytes: 512 }], bytes: 1018568 },
      outputs: { paths: [{ path: 'scratch/', bytes: 1258291 }, { path: 'note.txt', bytes: 12 }], bytes: 1258303 },
      notCopied: [{ scope: 'home', path: '.aw', owner: 'oats.aweb' }],
      afterHooks: { home: true, work: false } } };
  const receipt = lifecycleReceipt(raw, plan, 'k');
  assert.ok(receipt, 'the reader refused a 0.42 retire receipt');
  assert.deepEqual(receipt, { action: 'retire', instance: target.instance, home: target.home, planRevision: plan.planRevision, replayed: false,
    removedDir: true, worktreeRemoved: false,
    retention: { worktree: 'retained', branch: 'feat/work', recordedBranch: 'agents/dev-1', movedTo: '/team/.agents/worktrees/repo/feat-work', detachedAt: null },
    childrenStopped: [], incomplete: false, retainedHome: null, recoveryPath });
});
