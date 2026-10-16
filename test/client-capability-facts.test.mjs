// A capability's facts in the shared home (packages/client/capability-facts.mjs): the "Comes from" rows and
// what it provides, exactly what the Desktop's capability page draws, and the page's own words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilityFacts, fingerprint, packageOrigin, CAPABILITY_COPY } from '../packages/client/capability-facts.mjs';

const SHA = 'a'.repeat(40), TREE = 'b'.repeat(40), HEX = '9f2c' + '0'.repeat(56) + 'a71e';
const STATUS = {
  members: [{ key: 'github.com/acme/agents', name: 'agents' }],
  packages: [{ id: 'acme.tools', version: '1.2.0', source: 'catalog:acme.tools', integrity: `sha256-${HEX}` }, { id: 'acme.git', source: 'git:https://forge.example/acme/git.git' }],
};

test('capabilityFacts: the table of rows, as the page draws them', () => {
  const table = [
    ['a package from the official catalog', { name: 'tracker', kind: 'package', package: 'acme.tools', version: '1.2.0', commit: SHA, skills: ['plan'], commands: [], hooks: null },
      [['Package', 'acme.tools'], ['Pinned', '1.2.0 · official catalog'], ['Commit', SHA.slice(0, 7), SHA], ['Fingerprint', 'sha256:9f2c…a71e', `sha256-${HEX}`]],
      [['Skills', ['plan']], ['Commands', []], ['Hooks', null]]],
    ['a package from a git source, no version or commit, and the resolved capability\'s integrity', { name: 'gitcap', kind: 'package', package: 'acme.git', resolved: { from: { integrity: 'opaque' } } },
      [['Package', 'acme.git'], ['Pinned', 'git · forge.example'], ['Fingerprint', 'opaque']], []],
    ['a package workspace status does not list', { name: 'lost', kind: 'package', package: 'acme.gone', version: '0.1.0' },
      [['Package', 'acme.gone'], ['Pinned', '0.1.0']], []],
    ['a member capability', { name: 'notes', kind: 'member', repoKey: 'github.com/acme/agents', commit: SHA, path: 'capabilities/notes', tree: TREE, private: false, skills: null },
      [['Repository', 'agents', 'github.com/acme/agents'], ['Latest', SHA.slice(0, 7), SHA], ['Path', 'capabilities/notes'], ['Fingerprint', TREE.slice(0, 7), TREE]],
      [['Skills', null]]],
    ['a private member capability, of a member status does not name', { name: 'own', kind: 'member', repoKey: 'github.com/acme/else', commit: 'short', private: true },
      [['Repository', 'else', 'github.com/acme/else'], ['Latest', 'short'], ['Owned', 'this repo\'s souls only']], []],
    ['an external capability', { name: 'ext', kind: 'external', repoKey: 'github.com/other/tools', path: 'caps/ext', commands: ['run'] },
      [['Repository', 'tools', 'github.com/other/tools'], ['Path', 'caps/ext']], [['Commands', ['run']]]],
    ['an external capability with no repository: its label is all there is', { name: 'bare', kind: 'external' },
      [['Repository', 'external']], []],
    ['missing facts: empty, null and non-text values are no row', { name: 'thin', kind: 'member', repoKey: '', commit: null, path: '', tree: 7 },
      [['Repository', 'member']], []],
  ];
  for (const [what, row, origin, provides] of table) assert.deepEqual(capabilityFacts(row, { status: STATUS }), { origin, provides }, what);
});

test('capabilityFacts reads member names from status, or from the names it is given, and needs no status', () => {
  const row = { name: 'notes', kind: 'member', repoKey: 'github.com/acme/agents' };
  assert.deepEqual(capabilityFacts(row, { status: STATUS }).origin, [['Repository', 'agents', 'github.com/acme/agents']]);
  assert.deepEqual(capabilityFacts(row, { names: new Map([['github.com/acme/agents', 'Given']]) }).origin, [['Repository', 'Given', 'github.com/acme/agents']]);
  assert.deepEqual(capabilityFacts(row).origin, [['Repository', 'agents', 'github.com/acme/agents']], 'the key\'s tail without status');
  assert.deepEqual(capabilityFacts({ name: 'p', kind: 'package', package: 'acme.tools' }).origin, [['Package', 'acme.tools']]);
});

test('fingerprint and packageOrigin: the shortened integrity and where a package comes from', () => {
  assert.equal(fingerprint(`sha256-${HEX}`), 'sha256:9f2c…a71e');
  assert.equal(fingerprint('sha512-abc'), 'sha512-abc');
  assert.equal(fingerprint(''), null);
  assert.equal(fingerprint(undefined), null);
  assert.equal(packageOrigin('catalog:acme.tools'), 'official catalog');
  assert.equal(packageOrigin('git:https://forge.example/acme/x.git'), 'git · forge.example');
  assert.equal(packageOrigin('git:ssh://git@forge.example:acme/x.git'), 'git · forge.example');
  assert.equal(packageOrigin('path:/some/where'), 'path:/some/where');
  assert.equal(packageOrigin(null), null);
});

test('CAPABILITY_COPY: the page\'s own words, frozen', () => {
  assert.ok(Object.isFrozen(CAPABILITY_COPY));
  const { souls, behind, ...words } = CAPABILITY_COPY;
  assert.deepEqual(words, { comesFrom: 'Comes from', provides: 'Provides', usedBy: 'Used by', unlistable: 'Not listable: a spawn of it would refuse.', none: 'None',
    noSoul: 'No soul here includes it.', noInstance: 'No instance carries it yet.' });
  assert.deepEqual([0, 1, 2].map(souls), ['0 souls', '1 soul', '2 souls']);
  assert.deepEqual([1, 3].map(behind), ['1 on an older version', '3 on an older version']);
});
