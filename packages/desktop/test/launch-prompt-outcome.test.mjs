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
