import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilityShowData, capabilityFileData, capabilityShowSupported, capabilitySelector, selectorOf, sameSelector, validRelativePath,
  listedFiles, skillFilePath, FILE_TEXT_MAX_BYTES } from '../renderer/capability-show-contract.mjs';

const commit = 'a'.repeat(40);
const show = (over = {}) => ({
  capabilityShowApi: 1, name: 'oats.aweb', kind: 'package', repoKey: null, package: 'oats.aweb', version: '1.17.0', commit, path: 'capabilities/oats.aweb',
  inject: { path: 'inject.md', bytes: 12, text: '# Messaging\n', binary: false, truncated: false },
  skills: [{ name: 'oats-aweb', path: 'skills/oats-aweb', description: 'The playbook. Use it first.', files: [{ path: 'skills/oats-aweb/SKILL.md', bytes: 40 }, { path: 'skills/oats-aweb/refs/a.md', bytes: 3 }], filesTruncated: false }],
  problems: [], ...over,
});

test('the gate is the feature AND the API integer, never a version', () => {
  assert.equal(capabilityShowSupported({ ok: true, features: ['capability-show'], capabilityShowApi: 1 }), true);
  assert.equal(capabilityShowSupported({ ok: true, features: ['capability-show'] }), false);
  assert.equal(capabilityShowSupported({ ok: true, features: [], capabilityShowApi: 1 }), false);
  assert.equal(capabilityShowSupported({ ok: true, features: ['capability-show'], capabilityShowApi: 2 }), false);
  assert.equal(capabilityShowSupported({ ok: false, features: ['capability-show'], capabilityShowApi: 1 }), false);
});

test('the selector comes from the catalog row: member by repoKey, package by id, external none', () => {
  assert.deepEqual(capabilitySelector({ name: 'oats.desktop-ui', kind: 'member', repoKey: 'github.com/awebai/oats', commit }), { name: 'oats.desktop-ui', kind: 'member', repoKey: 'github.com/awebai/oats' });
  assert.deepEqual(capabilitySelector({ name: 'oats.aweb', kind: 'package', package: 'oats.aweb' }), { name: 'oats.aweb', kind: 'package', package: 'oats.aweb' });
  assert.equal(capabilitySelector({ name: 'x', kind: 'external' }), null);
  assert.equal(capabilitySelector({ name: 'x', kind: 'member', repoKey: '--upload-pack=evil' }), null, 'never an option-looking argv value');
  assert.equal(capabilitySelector({ name: '-x', kind: 'package', package: 'p' }), null);
  assert.equal(selectorOf({ name: 'x', kind: 'member', repoKey: 'r', extra: 1 }), null, 'exact keys only');
  assert.equal(selectorOf({ name: 'x', kind: 'member', package: 'p' }), null);
  assert.equal(sameSelector({ name: 'x', kind: 'member', repoKey: 'r' }, { name: 'x', kind: 'member', repoKey: 'r2' }), false);
});

test('a good answer decodes; listed files are joined to the capability root', () => {
  const data = capabilityShowData(show(), { name: 'oats.aweb' });
  assert.equal(data.inject.text, '# Messaging\n');
  assert.equal(skillFilePath(data.skills[0], data.skills[0].files[1]), 'skills/oats-aweb/refs/a.md');
  assert.deepEqual([...listedFiles(data).keys()], ['inject.md', 'skills/oats-aweb/SKILL.md', 'skills/oats-aweb/refs/a.md']);
  assert.equal(capabilityShowData(show({ inject: null, skills: null }), { name: 'oats.aweb' }).skills, null);
  // Kernel refinements: an unlistable skill (files: null, a problem names it), an unsafe inject value (path: null).
  const odd = capabilityShowData(show({ inject: { path: null, bytes: null, text: null, binary: false, truncated: false },
    skills: [{ name: 's', path: 'skills/s', description: null, files: null, filesTruncated: false }],
    problems: [{ code: 'E_X', message: 'inject "../x" is not a safe path', path: null }, { code: 'E_Y', message: 'cannot list', path: 'skills/s' }] }));
  assert.equal(odd.inject.path, null); assert.equal(odd.skills[0].files, null);
  assert.deepEqual([...listedFiles(odd).keys()], [], 'neither is readable through --file');
  assert.equal(capabilityShowData(show({ skills: [{ name: 's', path: 'skills/s', description: null, files: null, filesTruncated: true }] })), null);
  assert.equal(capabilityShowData(show({ skills: [{ name: 's', path: 'skills/s', description: null, files: [], filesTruncated: false }] })), null, '[] never means unlisted');
  assert.equal(capabilityShowData(show({ inject: { path: null, bytes: 3, text: 'abc', binary: false, truncated: false } })), null, 'no content without a path');
  assert.ok(capabilityShowData({ ...show(), observation: { observedAt: '2026-10-01T00:00:00Z', reused: true, localRevision: 'x' } }), 'an observation block is accepted');
  const member = capabilityShowData(show({ kind: 'member', repoKey: 'github.com/awebai/oats', package: null }));
  const asked = { name: 'oats.aweb', kind: 'package', package: 'oats.aweb' };
  assert.ok(capabilityShowData(show(), { selector: asked }));
  assert.equal(capabilityShowData(show({ package: 'other.pkg' }), { selector: asked }), null, 'the same name from another package');
  assert.equal(capabilityShowData(show({ kind: 'member', repoKey: 'r', package: null }), { selector: asked }), null);
  assert.equal(capabilityShowData(show({ kind: 'member', repoKey: 'a/b', package: null }), { selector: { name: 'oats.aweb', kind: 'member', repoKey: 'a/c' } }), null, 'another member');
  assert.equal(member.package, null);
});

test('malformed answers refuse the whole document', () => {
  const bad = [
    show({ capabilityShowApi: 2 }), show({ commit: 'abc' }), show({ kind: 'external' }), show({ name: 'other' }),
    show({ problems: null }), show({ skills: {} }), show({ inject: { path: 'a', bytes: -1, text: '', binary: false, truncated: false } }),
    show({ inject: { path: 'a', bytes: 1, text: 'x', binary: true, truncated: false } }), // binary with text
    show({ inject: { path: 'a', bytes: 1, text: null, binary: false, truncated: true } }), // truncated without text
    show({ skills: [{ name: 's', path: 's', description: null, files: [{ path: 's/A', bytes: 1 }, { path: 's/A', bytes: 1 }], filesTruncated: false }] }), // duplicate
    show({ skills: [{ name: 's', path: 's', description: null, files: [{ path: 's/a', bytes: 1 }], filesTruncated: 'no' }] }),
    show({ problems: [{ code: 'has space', message: 'm', path: null }] }),
    show({ kind: 'member', repoKey: null }),
    show({ inject: { path: 'a', bytes: 1, text: null, binary: true, truncated: true } }), // binary is never truncated
    show({ skills: [{ name: 's', path: 'skills/s', description: null, files: [{ path: 'skills/other/SKILL.md', bytes: 1 }], filesTruncated: false }] }), // outside its skill
    show({ skills: [{ name: 's', path: 'skills/s', description: null, files: [{ path: 'SKILL.md', bytes: 1 }], filesTruncated: false }] }), // skill-relative: not the kernel's shape
    null, [], 'x',
  ];
  for (const v of bad) assert.equal(capabilityShowData(v, { name: 'oats.aweb' }), null, JSON.stringify(v)?.slice(0, 120));
});

test('oversize strings and lists refuse', () => {
  const big = 'x'.repeat(FILE_TEXT_MAX_BYTES + 1);
  assert.equal(capabilityShowData(show({ inject: { path: 'a', bytes: 1, text: big, binary: false, truncated: true } })), null);
  // 256 KiB of characters that are 3 bytes each in UTF-8: over budget by bytes.
  assert.equal(capabilityShowData(show({ inject: { path: 'a', bytes: 1, text: '€'.repeat(FILE_TEXT_MAX_BYTES / 2), binary: false, truncated: true } })), null);
  assert.equal(capabilityShowData(show({ skills: [{ name: 's', path: 's', description: 'é'.repeat(600), files: [], filesTruncated: false }] })), null, 'description over 1 KiB');
  const files = Array.from({ length: 201 }, (_, i) => ({ path: `s/f${i}`, bytes: 1 }));
  assert.equal(capabilityShowData(show({ skills: [{ name: 's', path: 's', description: null, files, filesTruncated: true }] })), null);
  assert.equal(capabilityShowData(show({ problems: Array.from({ length: 65 }, () => ({ code: 'E_X', message: 'm', path: null })) })), null);
});

test('paths: relative POSIX inside the capability only', () => {
  for (const p of ['SKILL.md', 'skills/a/SKILL.md', 'a b/c.md', '.hidden/x']) assert.equal(validRelativePath(p), true, p);
  for (const p of ['', '/etc/passwd', '../x', 'a/../../x', 'a/./b', 'a//b', 'a\\b', 'a/', '-x', 'a\u0000b', 'a\nb', 'x'.repeat(1025)]) assert.equal(validRelativePath(p), false, JSON.stringify(p));
  assert.equal(capabilityShowData(show({ inject: { path: '../outside.md', bytes: 1, text: 'x', binary: false, truncated: false } })), null);
  assert.equal(capabilityShowData(show({ skills: [{ name: 's', path: '/abs', description: null, files: [], filesTruncated: false }] })), null);
  assert.equal(capabilityShowData(show({ problems: [{ code: 'E_X', message: 'm', path: '../x' }] })), null);
});

test('a --file answer decodes only for the path asked', () => {
  const answer = { capabilityShowApi: 1, name: 'oats.aweb', kind: 'package', commit, file: { path: 'skills/oats-aweb/SKILL.md', bytes: 4, text: 'body', binary: false, truncated: false } };
  assert.equal(capabilityFileData(answer, { name: 'oats.aweb', path: 'skills/oats-aweb/SKILL.md' }).file.text, 'body');
  assert.equal(capabilityFileData(answer, { name: 'oats.aweb', path: 'skills/oats-aweb/other.md' }), null);
  assert.equal(capabilityFileData({ ...answer, capabilityShowApi: 3 }, { name: 'oats.aweb' }), null);
  assert.equal(capabilityFileData({ ...answer, file: { ...answer.file, path: '../x' } }), null);
  assert.equal(capabilityFileData({ ...answer, file: { ...answer.file, bytes: null } }), null, 'a --file answer always has a size');
  assert.equal(capabilityFileData({ ...answer, file: { ...answer.file, text: null } }), null, 'text: null on a text file is the inject case only');
  assert.equal(capabilityFileData({ ...answer, file: { ...answer.file, text: null, binary: true } }).file.binary, true);
});
