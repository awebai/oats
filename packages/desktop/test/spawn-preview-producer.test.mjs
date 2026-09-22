// Actual PR76 producer envelopes, anonymized once and replayed as inert bytes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cliSpawnPreview } from '../spawn-preview-cli.mjs';
import { createSpawnPreviewBoundary } from '../server/spawn-preview.mjs';
import { previewData } from '../renderer/spawn-preview-contract.mjs';
import { cli } from './helpers/spawn-preview-fixture.mjs';
const stored = JSON.parse(readFileSync(new URL('./fixtures/spawn-preview-api2.json', import.meta.url), 'utf8'));
const selector = { soul: 'probe', agentsRoot: '/fixture/k6/agents' }, target = { workspace: 'fixture', context: '/fixture/k6', selector };
const context = () => ({ workspace: { id: 'fixture', scope: target.context }, cli, agents: [{ name: selector.soul, agentsRoot: selector.agentsRoot, work: 'worktree' }] });
for (const [name, envelope] of Object.entries(stored.fixtures)) test(`stored producer: ${name}`, async () => {
  assert.equal(stored.producerMerge, '6402b0f1fd541c8120dec6f12697973c228c1b19');
  if (name.startsWith('apply-')) {
    assert.equal(previewData(envelope.result ?? envelope.error?.details?.decision, target), null, 'apply is not preview data');
    return;
  }
  let calls = 0;
  const read = createSpawnPreviewBoundary({ invoke: (c, opts) => cliSpawnPreview(c, opts, { env: {}, exec: (_bin, argv, _options, callback) => {
    calls++; assert.ok(argv.includes('--preview')); assert.ok(argv.includes('--agents-root'));
    for (const flag of ['--expect-decision', '--task', '--task-file', '--no-launch']) assert.equal(argv.includes(flag), false);
    callback(envelope.ok ? null : { code: 1 }, JSON.stringify(envelope));
  } }) });
  const choices = name.includes('native-default') ? { model: { kind: 'native-default' } } : name.includes('base-unknown') ? { base: 'nope' } : {};
  const response = await read({ action: 'preview', selector, choices }, context);
  assert.equal(calls, 1, 'no fallback/retry');
  if (!envelope.ok) { assert.equal(response.status, 'unavailable'); assert.equal(response.reason.code, envelope.error.code); assert.equal(response.data, null); return; }
  assert.equal(response.status, 'available');
  assert.deepEqual(response.data.subject, envelope.result.subject); assert.deepEqual(response.data.decision, envelope.result.decision);
  assert.deepEqual(response.data.backendStatus, envelope.result.backendStatus); assert.deepEqual(response.data.preflight, envelope.result.preflight);
  assert.equal(response.data.yolo, null, 'omitted is unknown, not false');
  for (const key of ['task', 'executable', 'launch', 'env']) assert.equal(Object.hasOwn(response.data, key), false);
});
test('stored preview subject binding is byte-exact; canonicalization cannot excuse a mismatch', () => {
  const raw = stored.fixtures['preview-success-worktree.json'].result;
  for (const key of ['dir', 'agentsRoot']) {
    const bad = structuredClone(raw); bad.subject[key] = bad.subject[key].replace('/fixture/', '/fixture/./');
    assert.equal(previewData(bad, target), null);
  }
});
