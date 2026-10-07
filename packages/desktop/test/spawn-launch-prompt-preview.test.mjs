import test from 'node:test';
import assert from 'node:assert/strict';
import { previewData } from '../renderer/spawn-preview-contract.mjs';
import { createSpawnPreviewBoundary } from '../server/spawn-preview.mjs';
import { data, target, envelope, request, context } from './helpers/spawn-preview-fixture.mjs';
import { mountSpawn, kernel } from './helpers/spawn-dialog-host.mjs';

test('preview launch-prompt policy is optional, bounded, and idempotent through the server projection', async () => {
  assert.equal(Object.hasOwn(previewData(data(), target), 'launchPromptAnswers'), false);
  for (const awebDevelopmentChannel of [false, true]) {
    const policy = { awebDevelopmentChannel, consentSource: awebDevelopmentChannel ? '/fixture/oats.yaml#/launch/consent' : null };
    const v = data(); v.launchPromptAnswers = { ...policy, futureField: 'PRIVATE', workspaceTrust: true };
    const projected = previewData(v, target);
    assert.deepEqual(projected.launchPromptAnswers, policy);
    assert.deepEqual(previewData(projected, target), projected);
    assert.doesNotMatch(JSON.stringify(projected), /PRIVATE|workspaceTrust/);
    const result = await createSpawnPreviewBoundary({ invoke: async () => envelope(v) })(request(), context);
    assert.equal(result.status, 'available');
    assert.deepEqual(result.data.launchPromptAnswers, policy);
  }
});

const malformed = [null, [], {}, { awebDevelopmentChannel: 'true', consentSource: null },
  { awebDevelopmentChannel: true }, { awebDevelopmentChannel: false, consentSource: 1 },
  ...['', 'bad\nsource', 'x'.repeat(4097), 'https://user:secret@example.com/x'].map(consentSource => ({ awebDevelopmentChannel: true, consentSource }))];
test('malformed launch-prompt policy refuses projection and the preview boundary', async () => {
  for (const launchPromptAnswers of malformed) {
    const v = data(); v.launchPromptAnswers = launchPromptAnswers;
    assert.equal(previewData(v, target), null);
    const result = await createSpawnPreviewBoundary({ invoke: async () => envelope(v) })(request(), context);
    assert.equal(result.reason.code, 'E_CLI_PROTOCOL');
  }
});

for (const mode of ['on', 'off', 'absent', 'malformed']) test(`spawn dialog launch-prompt policy: ${mode}`, async t => {
  const u = await mountSpawn(t, { kernel: () => {
    const v = kernel('preview-worktree-default');
    if (mode !== 'absent') v.result.launchPromptAnswers = mode === 'malformed' ? { awebDevelopmentChannel: 'true' }
      : { awebDevelopmentChannel: mode === 'on', consentSource: mode === 'on' ? '/fixture/oats.yaml#/launch/consent' : null };
    return v;
  } });
  await u.open();
  const facts = u.q('.spawn-preview-facts');
  const label = [...(facts?.querySelectorAll('dt') ?? [])].find(n => n.textContent === 'Launch prompts');
  if (mode === 'absent' || mode === 'malformed') assert.equal(label, undefined);
  else {
    assert.ok(label);
    if (mode === 'on') {
      assert.match(facts.textContent, /Prompt consent source.*\/fixture\/oats.yaml#/);
      assert.match(label.nextElementSibling.textContent, /A harness update can block the launch until its prompt fixtures are refreshed; no fallback key is sent/);
    }
    assert.match(label.nextElementSibling.textContent, mode === 'on'
      ? /will answer the aweb development-channel confirmation for this home/
      : /None\. The launcher will not answer prompts for this home/);
    assert.match(label.nextElementSibling.textContent, /does not confirm readiness/);
    assert.equal(label.nextElementSibling.querySelector('input,button,select'), null);
  }
  assert.equal(u.q('.fspawn').disabled, mode === 'malformed');
  assert.equal(u.spawns().length, 0);
});
