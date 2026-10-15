// The apply boundary's `applyTimer` (packages/client/spawn-apply.mjs createSpawnApplyBoundary): the timer the
// apply's own deadline and SIGTERM grace are armed on, passed to the transport as `io.timer`. A client that lets
// go of an apply when it ends (the TUI on quit) gives its own and clears it then; without one the transport arms
// them on setTimeout, as it always has, and the Desktop passes none. Through the real transport (cliSpawnApply,
// the boundary's default `invoke`) on a worktree-event kernel, whose deadline is the boundary's to keep; the
// child is a fake whose signals are recorded, and no process is started.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpawnApplyBoundary } from '../packages/client/spawn-apply.mjs';
import { SIGTERM_GRACE_MS } from '../packages/client/spawn-apply-cli.mjs';
import { SPAWN_APPLY_MS } from '../packages/client/spawn-apply-contract.mjs';
import { selector, target } from '../packages/desktop/test/helpers/spawn-preview-fixture.mjs';
import { applyContext, applyPreview, creation, envelope } from '../packages/desktop/test/helpers/spawn-apply-fixture.mjs';

/** A boundary over the real transport: its exec records each apply and returns a child whose signals are kept;
 *  the boundary's own wait for an answer is a timer that never fires. */
function fixture(extra = {}) {
  const c = applyContext();
  c.cli.features = [...c.cli.features.filter(f => f !== 'worktree-event'), 'worktree-event'];
  const applies = [];
  const exec = (bin, argv, options, callback) => {
    const child = { signals: [], kill(signal) { child.signals.push(signal); return true; }, stdout: null, stderr: null };
    applies.push({ argv, options, callback, child });
    return child;
  };
  const broker = createSpawnApplyBoundary({ read: async () => ({ status: 'available', data: applyPreview(target) }), exec, timer: () => () => {}, ...extra });
  return { applies, send: request => broker(request, () => c) };
}
/** Prepare, then apply without waiting for its answer: resolves once the transport has started the child. */
async function applying(f) {
  const prepared = await f.send({ action: 'prepare', selector, choices: {}, task: '' });
  assert.equal(prepared.status, 'prepared');
  const answer = f.send({ action: 'apply', spawnRef: prepared.spawnRef });
  for (let i = 0; i < 100 && !f.applies.length; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.applies.length, 1, 'the apply started its child');
  return { answer, apply: f.applies[0] };
}
/** The child ends with the kernel's creation envelope: the apply settles and removes its task file. */
const finish = apply => apply.callback(null, JSON.stringify(envelope(creation(applyPreview(target)))), '');

test('a given applyTimer reaches cliSpawnApply: the deadline and the grace are armed on it, and the answer cancels them through it', async () => {
  const armed = [];
  const applyTimer = (fn, ms) => { const t = { fn, ms, cancelled: false }; armed.push(t); return () => { t.cancelled = true; }; };
  const f = fixture({ applyTimer });
  const { answer, apply } = await applying(f);
  assert.deepEqual(armed.map(t => t.ms), [SPAWN_APPLY_MS], 'the deadline, on the given timer');
  assert.equal(apply.options.timeout, undefined, 'not the exec\'s own timeout: the deadline is the boundary\'s');
  armed[0].fn();
  assert.deepEqual(apply.child.signals, ['SIGTERM']);
  assert.deepEqual(armed.map(t => t.ms), [SPAWN_APPLY_MS, SIGTERM_GRACE_MS], 'the grace, on the given timer too');
  finish(apply);
  assert.equal((await answer).status, 'complete');
  assert.equal(armed[1].cancelled, true, 'the answer cancels the grace through it');
  assert.throws(() => createSpawnApplyBoundary({ read: async () => null, applyTimer: 60000 }), TypeError);
});

test('without applyTimer the timer is today\'s: the transport arms the deadline and the grace on setTimeout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  const { answer, apply } = await applying(f);
  t.mock.timers.tick(SPAWN_APPLY_MS - 1);
  assert.deepEqual(apply.child.signals, [], 'not before its deadline');
  t.mock.timers.tick(1);
  assert.deepEqual(apply.child.signals, ['SIGTERM'], 'at it, on setTimeout');
  t.mock.timers.tick(SIGTERM_GRACE_MS);
  assert.deepEqual(apply.child.signals, ['SIGTERM', 'SIGKILL'], 'and the grace after it');
  finish(apply);
  await answer;
});
