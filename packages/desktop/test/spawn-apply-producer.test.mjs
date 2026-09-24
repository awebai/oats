import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { replayKernelApply, APPLY_CASES } from './helpers/spawn-apply-producer.mjs';
// Which concurrent apply lost is the kernel's race, recorded in the capture.
const captured = name => JSON.parse(readFileSync(new URL(`./fixtures/workspace-v2/f3/${name}.json`, import.meta.url), 'utf8'));
const [RACE_WINNER, RACE_LOSER] = ['apply-concurrent-a', 'apply-concurrent-b'].sort((x, y) => Number(captured(y).ok) - Number(captured(x).ok));
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
for (const [name, code] of [['apply-stale', 'E_DECISION_STALE'], ['apply-idempotency-conflict', 'E_IDEMPOTENCY_CONFLICT'], [RACE_LOSER, 'E_PLACEMENT_TAKEN'], ['apply-name-taken', 'E_INSTANCE_NAME_TAKEN']])
  test(`kernel refusal ${code} is stale: nothing created, no retry`, async () => {
    const { raw, view, commands } = await replayKernelApply(name);
    assert.equal(raw.error.code, code); assert.equal(view.status, 'stale'); assert.equal(view.reason.code, code); assert.equal(commands, 1);
  });
test('two concurrent applies of one decision: the kernel admitted exactly one', async () => {
  const winner = await replayKernelApply(RACE_WINNER), loser = await replayKernelApply(RACE_LOSER);
  assert.deepEqual([winner.raw.ok, loser.raw.ok], [true, false]);
  assert.equal(winner.view.status, 'complete'); assert.equal(winner.view.receipt.instance, 'release-manager-race');
  assert.equal(loser.view.status, 'stale');
  assert.equal(Object.keys(APPLY_CASES).length, 8);
});
test('spawn-name: the kernel creates exactly the confirmed name, with no soul prefix', async () => {
  const { raw, view } = await replayKernelApply('apply-name');
  assert.equal(raw.result.instance, 'api-gateway'); assert.equal(view.status, 'complete'); assert.equal(view.receipt.instance, 'api-gateway');
});
