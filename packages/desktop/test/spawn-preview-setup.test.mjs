// The spawn dialog's Setup fact (#801, OATS 0.49.0): the capabilities whose `worktree` hook will set up ./work,
// from the preview's `worktreeHooks`, in order; nothing for [], null, an absent key or a malformed value.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountSpawn, kernel } from './helpers/spawn-dialog-host.mjs';

const NOTE = 'Runs after the worktree is made. Can take several minutes.';
async function mount(t, worktreeHooks) {
  const u = await mountSpawn(t, { kernel: () => {
    const v = kernel('preview-worktree-default');
    if (worktreeHooks !== undefined) v.result.worktreeHooks = worktreeHooks;
    return v;
  } });
  await u.open();
  const terms = [...(u.q('.spawn-preview-facts')?.querySelectorAll('dt') ?? [])];
  return { u, terms, setup: terms.find(n => n.textContent === 'Setup') };
}

test('Setup lists the hooks in order, "(required)" on required ones, then the muted note', async t => {
  const { u, terms, setup } = await mount(t, [{ capability: 'nw-tools', required: true }, { capability: 'nw-lint', required: false },
    { capability: 'nw-cache', required: true }]);
  assert.ok(setup);
  const dd = setup.nextElementSibling;
  assert.equal(dd.firstChild.nodeType, 3, 'the list is text');
  assert.equal(dd.firstChild.textContent, 'nw-tools (required), nw-lint, nw-cache (required)');
  const note = dd.querySelector('.spawn-fact-sub');
  assert.equal(note.textContent, NOTE); assert.ok(note.classList.contains('muted'));
  assert.equal(dd.textContent, `nw-tools (required), nw-lint, nw-cache (required)${NOTE}`);
  // After the Relationship fact (when there is one), before Runs on (when there is one).
  const labels = terms.map(n => n.textContent), at = labels.indexOf('Setup');
  assert.ok(labels.slice(at + 1).every(l => l === 'Runs on'), labels.join('|'));
  assert.equal(u.q('.fspawn').disabled, false);
});

for (const [label, value] of [['[]', []], ['null', null], ['absent', undefined], ['a string', 'nw-tools'],
  ['an entry without required', [{ capability: 'nw-tools' }]], ['an empty capability', [{ capability: '', required: true }]]]) {
  test(`no Setup for ${label}, and the preview is not refused`, async t => {
    const { u, terms, setup } = await mount(t, value);
    assert.equal(setup, undefined);
    assert.ok(terms.length, 'the facts are shown');
    assert.doesNotMatch(u.q('.spawn-preview-facts').textContent, /Runs after the worktree is made/);
    assert.equal(u.q('.fspawn').disabled, false);
  });
}

test('a capability name is shown through displayLine, as text', async t => {
  const { setup } = await mount(t, [{ capability: 'nw-<b>tools</b> x', required: true }]);
  assert.ok(setup);
  const dd = setup.nextElementSibling;
  assert.equal(dd.firstChild.textContent, 'nw-<b>tools</b> x (required)');
  assert.equal(dd.querySelector('b'), null);
});
