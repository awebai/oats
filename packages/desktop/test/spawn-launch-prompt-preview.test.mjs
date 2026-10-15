import test from 'node:test';
import assert from 'node:assert/strict';
import { previewData } from '../../client/spawn-preview-contract.mjs';
import { createSpawnPreviewBoundary, createSpawnPreviewFlights } from '../../client/spawn-preview.mjs';
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
    const result = await createSpawnPreviewBoundary({ flights: createSpawnPreviewFlights(), invoke: async () => envelope(v) })(request(), context);
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
    const result = await createSpawnPreviewBoundary({ flights: createSpawnPreviewFlights(), invoke: async () => envelope(v) })(request(), context);
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
  // A policy note at the end of "What will be created", out of the facts grid: never a fact.
  const facts = u.q('.spawn-preview-prompts');
  const label = [...(facts?.querySelectorAll('dt') ?? [])].find(n => n.textContent === 'Launch prompts');
  assert.equal([...(u.q('.spawn-preview-facts')?.querySelectorAll('dt') ?? [])].some(n => /Launch prompts|Prompt consent/.test(n.textContent)), false);
  if (mode === 'absent' || mode === 'malformed') assert.equal(label, undefined);
  else {
    assert.ok(label);
    assert.equal(facts.parentElement.lastElementChild, facts, 'the last block of the section');
    assert.equal(facts.previousElementSibling, u.q('.spawn-preview-facts'), 'after the facts');
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

// OATS 0.52.0 (awebai/oats#917): no preview carries `launchPromptAnswers` (the kernel confirms the prompt on
// every start that passes the flag, and `oats spawn --preview` cannot report it). The note is keyed on the
// decoded field, never on the kernel's version or a feature: a 0.44 to 0.51 kernel's preview keeps it.
const NOTE_ON = 'The launcher will answer the aweb development-channel confirmation for this home. This policy does not confirm readiness. A harness update can block the launch until its prompt fixtures are refreshed; no fallback key is sent.';
const NOTE_OFF = 'None. The launcher will not answer prompts for this home. This policy does not confirm readiness.';
const noteOf = u => { const box = u.q('.spawn-preview-prompts'); return box ? [...box.children].map(n => [n.tagName, n.textContent]) : null; };
test('the Launch prompts note by kernel generation: none for a 0.52 preview, the present words for a 0.44 to 0.51 preview', async t => {
  const { cli } = await import('./helpers/spawn-preview-fixture.mjs');
  const cli052 = { ...cli, version: '0.52.0', features: [...cli.features, 'launch-prompt-dev-channel'] };
  const with051 = policy => () => { const v = kernel('preview-worktree-default'); v.result.launchPromptAnswers = policy; return v; };
  // 0.52.0: no field, no note, and nothing in its place about the confirmation.
  const now = await mountSpawn(t, { cli: cli052, kernel: () => kernel('preview-worktree-default') });
  await now.open();
  assert.equal(noteOf(now), null);
  assert.doesNotMatch(now.q('.spawn-preview').textContent, /Launch prompts|development-channel|confirmation|Prompt consent/);
  assert.equal(now.text('.fstatus'), 'Preview ready'); assert.equal(now.q('.fspawn').disabled, false);
  // 0.44 to 0.51: the two sentences, word for word, and the consent source when there is one.
  const on = await mountSpawn(t, { kernel: with051({ awebDevelopmentChannel: true, consentSource: '/fixture/oats-local.yaml#/launchPromptAnswers/homes/~1fixture~1home' }) });
  await on.open();
  assert.deepEqual(noteOf(on), [['DT', 'Launch prompts'], ['DD', NOTE_ON], ['DT', 'Prompt consent source'], ['DD', '/fixture/oats-local.yaml#/launchPromptAnswers/homes/~1fixture~1home']]);
  const off = await mountSpawn(t, { kernel: with051({ awebDevelopmentChannel: false, consentSource: null }) });
  await off.open();
  assert.deepEqual(noteOf(off), [['DT', 'Launch prompts'], ['DD', NOTE_OFF]]);
  // Keyed on the data: a kernel that advertises the 0.52 feature and still sends the field (a routed or
  // intermediate one) is shown what it sent.
  const both = await mountSpawn(t, { cli: cli052, kernel: with051({ awebDevelopmentChannel: false, consentSource: null }) });
  await both.open();
  assert.deepEqual(noteOf(both), [['DT', 'Launch prompts'], ['DD', NOTE_OFF]]);
});
