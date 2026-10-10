// The deployments the switcher offers without being told (#518): the direct children of ~/Agents
// that hold a regular oats-local.yaml, read once per suggestion list, bounded and never parsed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deploymentsInside, PICK_SCAN_LIMIT } from '../../client/workspace-admission.mjs';
import { workspaceSuggestions, pickedFolderChoices } from '../workspace-registry.mjs';

const listing = (names, { links = [] } = {}) => (_dir, limit) => {
  const entries = [...names.map((name) => ({ name, isDirectory: true })), ...links.map((name) => ({ name, isDirectory: false }))];
  return { entries: entries.slice(0, limit), limited: entries.length > limit };
};

test('deploymentsInside: the direct children holding a deployment, sorted; links, files and others are not offered', () => {
  const deployments = new Set(['/h/Agents/oats', '/h/Agents/aweb', '/h/Agents/tsm', '/h/Agents/linked']);
  const found = deploymentsInside('/h/Agents', { list: listing(['tsm', 'notes', 'oats', 'aweb'], { links: ['linked'] }), isDeployment: (p) => deployments.has(p) });
  assert.deepEqual(found, { paths: ['/h/Agents/aweb', '/h/Agents/oats', '/h/Agents/tsm'], limited: false });
});

test('deploymentsInside: at most PICK_SCAN_LIMIT entries are read; an unreadable or missing folder offers nothing', () => {
  const names = Array.from({ length: PICK_SCAN_LIMIT + 5 }, (_, i) => `d${String(i).padStart(3, '0')}`);
  const found = deploymentsInside('/h/Agents', { list: listing(names), isDeployment: () => true });
  assert.equal(found.paths.length, PICK_SCAN_LIMIT); assert.equal(found.limited, true);
  assert.deepEqual(deploymentsInside('/h/Agents', { list: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); }, isDeployment: () => true }),
    { paths: [], limited: false });
  assert.deepEqual(deploymentsInside('/h/Agents', { list: listing(['a']), isDeployment: () => { throw new Error('EACCES'); } }), { paths: [], limited: false });
});

test('a picked parent folder still offers the deployments inside it, through the same scan', () => {
  const answer = pickedFolderChoices('/h/Agents', { list: listing(['tsm', 'oats']), isDeployment: (p) => p !== '/h/Agents' && p.startsWith('/h/Agents/') });
  assert.deepEqual(answer.choices.map((c) => [c.path, c.kind]), [['/h/Agents/oats', 'inside'], ['/h/Agents/tsm', 'inside']]);
});

test('suggestions offer the discovered deployments after the known and recent ones, once each, never one already served', () => {
  const real = new Set(['/h/Agents/aweb', '/h/Agents/oats', '/h/Agents/tsm', '/h/recent']);
  const validate = (p) => (real.has(p) ? { id: p, name: p.split('/').pop(), team: null, path: p } : null);
  const list = workspaceSuggestions({ knownPaths: ['/h/Agents/tsm'], recents: ['/h/recent', '/h/Agents/oats'],
    discovered: ['/h/Agents/aweb', '/h/Agents/oats', '/h/Agents/tsm', '/h/Agents/jro', '/h/Agents/served'],
    advertised: new Set(['/h/Agents/served']), validate });
  assert.deepEqual(list.map((s) => [s.path, s.reason]), [['/h/Agents/tsm', 'known workspace'], ['/h/recent', 'recently used'],
    ['/h/Agents/oats', 'recently used'], ['/h/Agents/aweb', 'found in ~/Agents']]);
  assert.deepEqual(workspaceSuggestions({ knownPaths: [], recents: [], advertised: new Set(), validate }), [], 'discovered is optional');
});
