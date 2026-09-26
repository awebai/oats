// Per-file line counts (kernel #238, 0.29.1) through the instance-git projection: additions /
// deletions (non-negative integers or null = unknown, NOT zero) and binary (boolean or null).
// Real capture: test/fixtures/workspace-v2/instance-git-counts (a worktree home with a modified
// text file, a staged new file, a modified committed binary, an untracked file).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gitState, gitFile } from '../renderer/instance-git-contract.mjs';
import { target } from './helpers/forge-fixture.mjs';

const doc = JSON.parse(readFileSync(new URL('./fixtures/workspace-v2/instance-git-counts/instance-git.json', import.meta.url), 'utf8')).result;
const own = { ...target, instance: doc.instance, agent: doc.agent, home: doc.home };

test('the real counts pass through: text +/−, a staged file, binary (unknown counts), untracked (all unknown)', () => {
  const files = Object.fromEntries(gitState(doc, own).files.map(f => [f.path, f]));
  assert.deepEqual([files['NEW.md'].additions, files['NEW.md'].deletions, files['NEW.md'].binary], [2, 0, false]);
  assert.deepEqual([files['blob.bin'].additions, files['blob.bin'].deletions, files['blob.bin'].binary], [null, null, true], 'binary: unknown, not zero');
  const text = Object.values(files).find(f => f.path.endsWith('house-style.md'));
  assert.deepEqual([text.additions, text.deletions, text.binary], [4, 1, false]);
  assert.deepEqual([files['scratch.txt'].additions, files['scratch.txt'].deletions, files['scratch.txt'].binary], [null, null, null]);
});

test('an older kernel reports none: the keys stay absent; malformed counts refuse the observation', () => {
  const before = structuredClone(doc); for (const f of before.files) { delete f.additions; delete f.deletions; delete f.binary; }
  const older = gitState(before, own);
  assert.ok(older && older.files.length === doc.files.length);
  for (const f of older.files) for (const k of ['additions', 'deletions', 'binary']) assert.equal(Object.hasOwn(f, k), false, k);
  for (const [k, v] of [['additions', -1], ['additions', 1.5], ['deletions', '3'], ['binary', 'yes'], ['binary', 0]]) {
    const bad = structuredClone(doc); bad.files[0][k] = v;
    assert.equal(gitState(bad, own), null, `${k}=${JSON.stringify(v)}`);
  }
  assert.equal(Object.hasOwn(gitFile(doc.files[0]), 'additions'), false, 'the diff selection keeps its identity fields only');
});
