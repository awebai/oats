// The local-config fingerprint: file metadata of oats-local.yaml and oats-config.yaml, a cache-validity
// key component (server/deployment-fingerprint.mjs). Metadata only: the Desktop parses no deployment file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deploymentFingerprint, FINGERPRINTED_FILES } from '../server/deployment-fingerprint.mjs';

const stats = table => ({ stat: path => { const name = path.slice(path.lastIndexOf('/') + 1); if (!(name in table)) throw new Error('ENOENT'); return table[name]; } });

test('the fingerprint moves with size or mtime of either file, and with a file appearing or vanishing; never reads content', () => {
  assert.deepEqual(FINGERPRINTED_FILES, ['oats-local.yaml', 'oats-config.yaml']);
  const base = { 'oats-local.yaml': { size: 120, mtimeMs: 1000.7 }, 'oats-config.yaml': { size: 40, mtimeMs: 2000 } };
  const a = deploymentFingerprint('/dep', stats(base));
  assert.equal(a, deploymentFingerprint('/dep', stats(structuredClone(base))), 'deterministic');
  assert.equal(a, JSON.stringify([['oats-local.yaml', 120, 1000], ['oats-config.yaml', 40, 2000]]), 'whole milliseconds, no content');
  assert.notEqual(a, deploymentFingerprint('/dep', stats({ ...base, 'oats-local.yaml': { size: 121, mtimeMs: 1000.7 } })), 'size');
  assert.notEqual(a, deploymentFingerprint('/dep', stats({ ...base, 'oats-local.yaml': { size: 120, mtimeMs: 1001 } })), 'mtime');
  assert.notEqual(a, deploymentFingerprint('/dep', stats({ ...base, 'oats-config.yaml': { size: 41, mtimeMs: 2000 } })), 'the other file');
  const missing = deploymentFingerprint('/dep', stats({ 'oats-local.yaml': base['oats-local.yaml'] }));
  assert.equal(missing, JSON.stringify([['oats-local.yaml', 120, 1000], ['oats-config.yaml', null, null]]), 'a missing file is a state, not an error');
  assert.equal(deploymentFingerprint('/nowhere', stats({})), JSON.stringify([['oats-local.yaml', null, null], ['oats-config.yaml', null, null]]));
  assert.equal(typeof deploymentFingerprint('/definitely/not/a/deployment'), 'string', 'the real stat is defensive too');
});
