import test from 'node:test';
import assert from 'node:assert/strict';
import { replayKernelApply, APPLY_CASES } from './helpers/spawn-apply-producer.mjs';
test('kernel apply bound to its preview: created (no launch), receipt decision is the preview decision', async () => {
  const { raw, view, commands } = await replayKernelApply('apply-bound');
  assert.equal(view.status, 'complete'); assert.equal(commands, 1);
  assert.deepEqual(view.receipt.decision.revision, raw.result.decision.revision); assert.equal(view.receipt.replayed, false);
  assert.equal(view.receipt.launched, false, 'captured with --no-launch, never native session acceptance');
});
test('a lost first outcome is retried on the SAME key and the kernel replays the recorded receipt', async () => {
  const { raw, view, commands } = await replayKernelApply('apply-replayed');
  assert.equal(raw.result.replayed, true); assert.equal(view.status, 'complete'); assert.equal(view.receipt.replayed, true); assert.equal(commands, 2);
});
for (const [name, code] of [['apply-stale', 'E_DECISION_STALE'], ['apply-idempotency-conflict', 'E_IDEMPOTENCY_CONFLICT'], ['apply-concurrent-a', 'E_PLACEMENT_TAKEN']])
  test(`kernel refusal ${code} is stale: nothing created, no retry`, async () => {
    const { raw, view, commands } = await replayKernelApply(name);
    assert.equal(raw.error.code, code); assert.equal(view.status, 'stale'); assert.equal(view.reason.code, code); assert.equal(commands, 1);
  });
test('two concurrent applies of one decision: the kernel admitted exactly one', async () => {
  const a = await replayKernelApply('apply-concurrent-a'), b = await replayKernelApply('apply-concurrent-b');
  assert.deepEqual([a.raw.ok, b.raw.ok].sort(), [false, true]);
  assert.equal(b.view.status, 'complete'); assert.equal(b.view.receipt.instance, 'release-manager-race');
  assert.equal(Object.keys(APPLY_CASES).length, 6);
});
