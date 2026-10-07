import test from 'node:test';
import assert from 'node:assert/strict';
import { launchPromptOutcome, retainedSpawnDetails, retainedSpawnMessage } from '../renderer/launch-prompt-outcome.mjs';
import { launchPrompts, retained } from './helpers/launch-prompt-fixture.mjs';
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
