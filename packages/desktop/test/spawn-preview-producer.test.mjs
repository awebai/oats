// Kernel spawn previews (test/fixtures/workspace-v2/f3, main's kernel 0.25.9 on a
// scratch Northwind build) replayed as inert bytes through the real adapter
// and boundary. The Desktop's argv must be the argv the kernel was captured with.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cliSpawnPreview } from '../spawn-preview-cli.mjs';
import { createSpawnPreviewBoundary } from '../server/spawn-preview.mjs';
import { previewData } from '../renderer/spawn-preview-contract.mjs';
import { cli, kernel, DEPLOYMENT, ROOT } from './helpers/spawn-preview-fixture.mjs';
const provenance = JSON.parse(readFileSync(new URL('./fixtures/workspace-v2/f3/provenance.json', import.meta.url), 'utf8'));
const souls = { 'release-manager': 'worktree', 'platform-reviewer': 'checkout', 'support-triager': 'directory', 'no-such-soul': 'worktree' };
const purpose = p => ({ purpose: p });
const cases = {
  'preview-worktree-default': ['release-manager', {}],
  'preview-worktree-purpose': ['release-manager', purpose('api-v2')],
  'preview-runtime-claude': ['release-manager', { ...purpose('api-v2'), runtime: 'claude', model: { kind: 'custom', value: 'opus' } }],
  'preview-native-default': ['release-manager', { ...purpose('api-v2'), model: { kind: 'native-default' } }],
  'preview-yolo': ['release-manager', { ...purpose('api-v2'), yolo: true }],
  'preview-branch-base': ['release-manager', { ...purpose('api-v2'), branch: 'feat/api-v2', base: 'HEAD' }],
  'preview-base-unknown': ['release-manager', { ...purpose('api-v2'), base: 'no-such-ref' }],
  'preview-checkout-default': ['platform-reviewer', purpose('review')],
  'preview-checkout-as-worktree': ['platform-reviewer', { ...purpose('review'), work: 'worktree' }],
  'preview-directory': ['support-triager', purpose('inbox')],
  'preview-soul-unknown': ['no-such-soul', {}],
  'preview-clone-missing': ['release-manager', purpose('api-v2')],
  'preview-after-apply': ['release-manager', purpose('api-v2')],
  'preview-other': ['release-manager', purpose('docs')],
  'preview-race': ['release-manager', purpose('race')],
  // spawn-name: exact names; invalid (uppercase) and a soul's name; taken by the same and by another soul
  'preview-name': ['release-manager', { name: 'api-gateway' }],
  'preview-name-early': ['release-manager', { name: 'api-gateway' }],
  'preview-name-invalid': ['release-manager', { name: 'Api-Gateway' }],
  'preview-name-soul': ['release-manager', { name: 'support-triager' }],
  'preview-name-taken': ['release-manager', { name: 'api-gateway' }],
  'preview-name-taken-other-soul': ['support-triager', { name: 'api-gateway' }],
};
test('every captured preview is replayed here', () => {
  assert.equal(provenance.kernel, '0.25.9');
  assert.deepEqual(Object.keys(provenance.files).filter(name => name.startsWith('preview-')).sort(), Object.keys(cases).sort());
});
for (const [name, [soul, choices]] of Object.entries(cases)) test(`kernel preview through adapter/boundary: ${name}`, async () => {
  const envelope = kernel(name), selector = { soul, agentsRoot: ROOT }, target = { workspace: 'northwind', context: DEPLOYMENT, selector };
  const context = () => ({ workspace: { id: 'northwind', scope: DEPLOYMENT }, cli, agents: [{ name: soul, agentsRoot: ROOT, work: souls[soul] }], instances: [] });
  let calls = 0, seen;
  const read = createSpawnPreviewBoundary({ invoke: (c, opts) => cliSpawnPreview(c, opts, { env: {}, exec: (_bin, argv, _options, callback) => {
    calls++; seen = argv; callback(envelope.ok ? null : { code: 1 }, JSON.stringify(envelope));
  } }) });
  const response = await read({ action: 'preview', selector, choices }, context);
  assert.equal(calls, 1, 'no fallback/retry');
  const captured = provenance.files[name].argv.slice(1).map(v => v.replaceAll('<base>', '/fixture/base'));
  // Same tokens in the same order; only where `--preview` sits differs (order-free for the CLI).
  const withoutPreview = argv => argv.filter(v => v !== '--preview');
  assert.ok(seen.includes('--preview') && captured.includes('--preview'));
  assert.deepEqual(withoutPreview(seen), withoutPreview(captured), 'the Desktop argv is the argv the kernel was captured with');
  if (!envelope.ok) {
    assert.equal(response.status, 'unavailable'); assert.equal(response.data, null);
    assert.deepEqual(response.reason, { code: envelope.error.code, message: envelope.error.message }, 'the kernel refusal crosses verbatim');
    return;
  }
  assert.equal(response.status, 'available');
  const r = envelope.result;
  assert.deepEqual(response.data.subject, r.subject); assert.deepEqual(response.data.decision.revision, r.decision.revision);
  assert.equal(response.data.decision.resolution, r.resolution);
  for (const key of ['instance', 'work', 'runtime', 'model', 'modelSource', 'branch', 'worktree', 'backend']) assert.deepEqual(response.data[key], r[key], key);
  assert.deepEqual(response.data.base, r.base); assert.equal(response.data.yolo, r.yolo ?? null);
  for (const key of ['task', 'executable', 'env', 'modules', 'capabilities', 'skills', 'settings', 'providers']) assert.equal(Object.hasOwn(response.data, key), false, key);
});
test('the worktree override is the kernel\'s: a checkout soul previews as a worktree with branch and base', () => {
  const plain = kernel('preview-checkout-default').result, asWorktree = kernel('preview-checkout-as-worktree').result;
  assert.equal(plain.work, 'checkout'); assert.equal(plain.branch, null); assert.equal(plain.worktree, null);
  assert.equal(asWorktree.work, 'worktree'); assert.equal(asWorktree.branch, 'agents/platform-reviewer-review'); assert.ok(asWorktree.base.oid);
});
test('kernel preview subject binding is byte-exact; canonicalization cannot excuse a mismatch', () => {
  const raw = kernel('preview-worktree-purpose').result, target = { workspace: 'northwind', context: DEPLOYMENT, selector: { soul: 'release-manager', agentsRoot: ROOT } };
  assert.ok(previewData(raw, target));
  for (const key of ['dir', 'agentsRoot']) {
    const bad = structuredClone(raw); bad.subject[key] = bad.subject[key].replace('/fixture/', '/fixture/./');
    assert.equal(previewData(bad, target), null);
  }
});
test('spawn-name: the kernel names the instance exactly and refuses taken names across souls', () => {
  assert.equal(kernel('preview-name').result.instance, 'api-gateway');
  for (const name of ['preview-name-taken', 'preview-name-taken-other-soul']) {
    const e = kernel(name).error;
    assert.equal(e.code, 'E_INSTANCE_NAME_TAKEN'); assert.equal(e.details.instance, 'api-gateway');
  }
  for (const name of ['preview-name-invalid', 'preview-name-soul']) assert.equal(kernel(name).error.code, 'E_INSTANCE_NAME_INVALID');
});
