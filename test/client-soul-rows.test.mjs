// The soul row of the shared home (packages/client/soul-rows.mjs): the rows the Desktop's /api/agents lists for a
// local deployment, now built by `soulRows` for every client. The expected rows below are what the backend's
// agentsData built at main 643447e2, before the move: its per-soul projection (server/oats-web.mjs lines
// 158-190 there) was run on the same deployment and catalog, and its output written here as it came, key order
// included. A row that differs from it in a field, a value or the order of its keys fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import { soulRows } from '../packages/client/soul-rows.mjs';

const ROSTER = [
  { name: 'zeta', color: 'Sage ' }, { name: 'mid', color: 'neon' }, { name: 'ext', color: 'clay' }, { name: 'beta' },
];
const MEMBERS = [{ key: 'oats', name: 'OATS core' }, { key: 'tools' }];
const LAUNCH = { declared: { harness: 'claude', model: 'claude-opus-5-5' }, effective: { harness: 'pi', model: null, launchConfig: null }, from: 'local-default', at: 'oats-local.yaml#/launch/default', problem: null };
const CATALOG = [
  { name: 'zeta', origin: 'oats:souls/zeta', kind: 'member', repoKey: 'oats', commit: 'c1', team: 'eng', path: 'souls/zeta', work: 'worktree', description: 'Zeta does things',
    labels: ['eng', 'ops'], spawnable: false, problem: { code: 'E_SPAWN_REFUSED', message: 'It would be refused.' }, file: { path: 'souls/zeta/soul.yaml', url: 'https://example.test/souls/zeta/soul.yaml' },
    teams: [{ label: 'eng', default: true, mapped: true }, { label: 'ops', default: false, mapped: false }], defaultTeam: { label: 'eng', team: 'eng:example.test' },
    launch: LAUNCH, capabilities: [{ id: 'oats.aweb', slot: 'messaging' }], key: 'zeta' },
  { name: 'alpha', origin: 'tools:souls/alpha', kind: 'member', repoKey: 'tools', commit: 'c2', team: null, path: 'souls/alpha', work: 'checkout', description: '',
    spawnable: true, defaultTeam: null, capabilities: null, key: 'alpha' },
  { name: 'mid', origin: 'package:oats.framework', kind: 'package', repoKey: null, commit: null, team: null, path: null, work: 'worktree', description: 'From a package',
    package: 'oats.framework', version: '1.2.0', qualifiedName: 'oats.framework/mid', key: 'oats.framework/mid' },
  { name: 'ext', origin: 'https://example.test/ext.git', kind: 'external', repoKey: null, commit: null, team: null, path: null, work: 'directory', key: 'ext' },
  { name: 'beta', origin: 'gone:souls/beta', kind: 'member', repoKey: 'gone', commit: 'c3', team: null, path: 'souls/beta', work: 'attached', description: 'No member name' },
];
const deployment = (catalog) => ({ status: 'observed', root: '/a/oats/agents', souls: structuredClone(ROSTER), workspaceStatus: { members: structuredClone(MEMBERS) },
  catalog: catalog === undefined ? { reason: null, ambiguous: [] } : catalog });

/** agentsData's rows at 643447e2 for the table: sorted by name; a member's name where workspace status gives one,
 * its key where the member has none (tools) or is not listed (gone); "external" and "package <id>" otherwise;
 * a palette colour from the roster only when the roster's value is a palette name (zeta: "Sage "; mid: "neon" is none). */
const AT_BASE = [
  {
    "name": "alpha",
    "description": "",
    "kind": "persistent",
    "work": "checkout",
    "spawnable": true,
    "problem": null,
    "defaultTeam": null,
    "capabilities": null,
    "key": "alpha",
    "origin": "tools:souls/alpha",
    "soulKind": "member",
    "repo": "tools",
    "capability": null,
    "soulSource": {
      "repoKey": "tools",
      "commit": "c2",
      "path": "souls/alpha"
    },
    "agentsRoot": "/a/oats/agents",
    "workspace": "/a/oats",
    "repoName": "tools"
  },
  {
    "name": "beta",
    "description": "No member name",
    "kind": "persistent",
    "work": "attached",
    "origin": "gone:souls/beta",
    "soulKind": "member",
    "repo": "gone",
    "capability": null,
    "soulSource": {
      "repoKey": "gone",
      "commit": "c3",
      "path": "souls/beta"
    },
    "agentsRoot": "/a/oats/agents",
    "workspace": "/a/oats",
    "repoName": "gone"
  },
  {
    "name": "ext",
    "description": "",
    "kind": "persistent",
    "work": "directory",
    "color": "clay",
    "key": "ext",
    "origin": "https://example.test/ext.git",
    "soulKind": "external",
    "repo": null,
    "capability": null,
    "soulSource": {
      "repoKey": null,
      "commit": null,
      "path": null
    },
    "agentsRoot": "/a/oats/agents",
    "workspace": "/a/oats",
    "repoName": "external"
  },
  {
    "name": "mid",
    "description": "From a package",
    "kind": "persistent",
    "work": "worktree",
    "key": "oats.framework/mid",
    "package": "oats.framework",
    "version": "1.2.0",
    "qualifiedName": "oats.framework/mid",
    "origin": "package:oats.framework",
    "soulKind": "package",
    "repo": null,
    "capability": null,
    "soulSource": {
      "repoKey": null,
      "commit": null,
      "path": null
    },
    "agentsRoot": "/a/oats/agents",
    "workspace": "/a/oats",
    "repoName": "package oats.framework"
  },
  {
    "name": "zeta",
    "description": "Zeta does things",
    "kind": "persistent",
    "work": "worktree",
    "color": "sage",
    "team": "eng",
    "labels": [
      "eng",
      "ops"
    ],
    "spawnable": false,
    "problem": {
      "code": "E_SPAWN_REFUSED",
      "message": "It would be refused."
    },
    "file": {
      "path": "souls/zeta/soul.yaml",
      "url": "https://example.test/souls/zeta/soul.yaml"
    },
    "teams": [
      {
        "label": "eng",
        "default": true,
        "mapped": true
      },
      {
        "label": "ops",
        "default": false,
        "mapped": false
      }
    ],
    "defaultTeam": {
      "label": "eng",
      "team": "eng:example.test"
    },
    "launch": {
      "declared": {
        "harness": "claude",
        "model": "claude-opus-5-5"
      },
      "effective": {
        "harness": "pi",
        "model": null,
        "launchConfig": null
      },
      "from": "local-default",
      "at": "oats-local.yaml#/launch/default",
      "problem": null
    },
    "capabilities": [
      {
        "id": "oats.aweb",
        "slot": "messaging"
      }
    ],
    "key": "zeta",
    "origin": "oats:souls/zeta",
    "soulKind": "member",
    "repo": "oats",
    "capability": null,
    "soulSource": {
      "repoKey": "oats",
      "commit": "c1",
      "path": "souls/zeta"
    },
    "agentsRoot": "/a/oats/agents",
    "workspace": "/a/oats",
    "repoName": "OATS core"
  }
];

/** Equal field for field, value for value, and in the same key order. */
function same(actual, expected, what) {
  assert.deepStrictEqual(actual, expected, what);
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), `${what}: the key order`);
}

test('soulRows gives the rows agentsData gave at the base commit, for every kind of soul', () => {
  const catalog = structuredClone(CATALOG);
  same(soulRows(deployment(), catalog), AT_BASE, 'the table');
  assert.deepEqual(catalog, CATALOG, 'the catalog is not changed');
  // Each case of the table, by name: what decides it.
  const row = name => AT_BASE.find(r => r.name === name);
  assert.equal(row('zeta').color, 'sage', 'a roster colour, normalised');
  assert.equal(Object.hasOwn(row('alpha'), 'color'), false, 'a soul not in the roster has no colour');
  assert.equal(Object.hasOwn(row('mid'), 'color'), false, 'a roster value that is no palette name is no colour');
  assert.equal(row('mid').repoName, 'package oats.framework', 'a package soul');
  assert.equal(row('ext').repoName, 'external', 'an external soul');
  assert.equal(row('alpha').repoName, 'tools', 'a member whose key has no name: the key');
  assert.equal(row('zeta').repoName, 'OATS core', 'a member with a name');
});

test('soulRows with no catalog, a catalog without souls, or an empty one: no rows, as agentsData gave', () => {
  same(soulRows(deployment(null), null), [], 'catalog null');
  same(soulRows(deployment(null), undefined), [], 'catalog absent');
  same(soulRows(deployment(null), []), [], 'an empty catalog');
});

test('soulRows copies what a row carries in lists and records, so a client may keep a row', () => {
  const catalog = structuredClone(CATALOG), rows = soulRows(deployment(), catalog), zeta = rows.find(r => r.name === 'zeta');
  const source = catalog.find(s => s.name === 'zeta');
  for (const key of ['labels', 'teams', 'defaultTeam', 'launch', 'capabilities']) assert.notEqual(zeta[key], source[key], key);
  assert.notEqual(zeta.teams[0], source.teams[0]);
  assert.notEqual(zeta.capabilities[0], source.capabilities[0]);
  // Two calls on the same input give equal rows, and share none.
  const again = soulRows(deployment(), catalog);
  same(again, rows, 'a second call');
  assert.notEqual(again[0], rows[0]);
});
