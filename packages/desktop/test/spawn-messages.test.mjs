import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnProblem, catalogProblem } from '../renderer/spawn-messages.mjs';

// Every code the preview and apply contracts can report, read from their tables.
const codes = file => {
  const source = readFileSync(new URL(`../renderer/${file}`, import.meta.url), 'utf8'), start = source.indexOf('const errors = {');
  const table = source.slice(start, source.indexOf('\n};', start));
  return [...table.matchAll(/'?(E_[A-Z0-9_]+|unsupported-remote-operation)'?:\s*'/g)].map(m => m[1]);
};
const PREVIEW = codes('spawn-preview-contract.mjs'), APPLY = codes('spawn-apply-contract.mjs');
const plain = text => { assert.ok(text && text.length < 200, text); assert.doesNotMatch(text, /E_[A-Z]|`|\/|--|sha256|[0-9a-f]{12}/, text); };

test('every contract code has a plain sentence, for reading defaults and for spawning', () => {
  assert.ok(PREVIEW.length > 25 && APPLY.length > 15, 'the tables were found');
  for (const code of [...PREVIEW, ...APPLY]) for (const stage of ['preview', 'spawn']) {
    const problem = spawnProblem({ code, message: 'technical text' }, stage);
    plain(problem.text); assert.equal(problem.code, code); assert.equal(problem.detail, `${code} · technical text`);
  }
});

test('kernel refusals keep their own text only behind Details; unknown codes still read plainly', () => {
  const clone = spawnProblem({ code: 'E_CLONE_MISSING', message: 'soul x … `git clone /r /d` …' });
  plain(clone.text); assert.match(clone.detail, /git clone \/r \/d/);
  for (const stage of ['preview', 'spawn']) {
    const odd = spawnProblem({ code: 'E_SOMETHING_NEW', message: 'raw' }, stage);
    plain(odd.text); assert.equal(odd.detail, 'E_SOMETHING_NEW · raw');
  }
  assert.equal(spawnProblem(undefined).code, 'E_CLI_FAILED'); assert.equal(spawnProblem({ code: 'E_BUSY' }).detail, 'E_BUSY');
  assert.notEqual(spawnProblem({ code: 'E_CLI_TIMEOUT' }, 'preview').text, spawnProblem({ code: 'E_CLI_TIMEOUT' }, 'spawn').text,
    'a timed-out spawn may have created the instance; a timed-out read did not');
});

test('the soul chooser explains a catalog problem without codes', () => {
  assert.equal(catalogProblem(null), '');
  plain(catalogProblem({ reason: { code: 'E_WORKSPACE', message: '/abs/path failed' }, ambiguous: [] }));
  assert.match(catalogProblem({ reason: null, ambiguous: ['twin', 'other'] }), /twin, other\.$/);
});

test('there is no package approval: no sentence mentions it; integrity names the lock', () => {
  for (const code of [...PREVIEW, ...APPLY]) for (const stage of ['preview', 'spawn']) {
    assert.doesNotMatch(spawnProblem({ code, message: 'x' }, stage).text, /approv/i, code);
  }
  assert.equal(spawnProblem({ code: 'E_PACKAGE_INTEGRITY', message: 'x' }).text, 'A package this soul uses no longer matches the lock. Run Sync in the Workspace view.');
});
