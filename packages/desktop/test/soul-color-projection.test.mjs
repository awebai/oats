import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as remote from '../server/remote-roster.mjs';
import { normalizeSoulColor } from '../renderer/soul-colors.mjs';
import { deploymentStatusData, soulsData } from '../deployment-data.mjs';

// Exercise the actual response projection without starting the backend, CLI or
// tmux. Local souls are the kernel's `oats status --json` rows, captured from a
// real Northwind run; the Desktop reads no soul.yaml.
const source = readFileSync(new URL('../server/oats-web.mjs', import.meta.url), 'utf8');
const start = source.indexOf('function agentsData(');
const end = source.indexOf('/* ── Model catalog', start);
assert.ok(start >= 0 && end > start);
const project = (ws, snapshot) => new Function('workspaceById', 'workspaces', 'snapshot', 'remote', 'dirname', 'resolve', 'normalizeSoulColor',
  `${source.slice(start, end)}; return agentsData;`)(() => ws, () => [ws], snapshot, remote, dirname, resolve, normalizeSoulColor)();
const status = JSON.parse(readFileSync(new URL('./fixtures/workspace-v2/status.json', import.meta.url), 'utf8'));
const context = dirname(status.root);

const catalog = soulsData(JSON.parse(readFileSync(new URL('./fixtures/workspace-v2/f3/souls.json', import.meta.url), 'utf8')));

test('the spawn catalog (oats souls) is the soul list; the status row only lends its named color', () => {
  // Variants of the captured status row: the kernel passes a soul's optional
  // canonical color through; the Desktop admits named colors only.
  const raw = structuredClone(status);
  const base = raw.agents[0], souls = catalog.souls.slice(0, 4);
  const variant = (name, extra) => ({ ...structuredClone(base), ...extra, name, dir: `${context}/agents/${name}`, instances: [] });
  raw.agents = [variant(souls[0].name, { color: 'SAGE' }), variant(souls[1].name, { color: ' slate ' }),
    variant(souls[2].name, { color: 'url(https://invalid.example)' }), variant('not-in-catalog', { color: 'sage' })];
  const roster = deploymentStatusData(raw, context);
  const snapshot = { byWs: new Map([[context, { deployment: { status: 'observed', root: roster.root,
    souls: roster.agents.map(({ instances: _i, ...soul }) => soul), catalog: { souls, ambiguous: ['twin'], reason: null } } }]]) };
  const result = project({ id: context, name: 'northwind', roots: [roster.root] }, snapshot);
  assert.deepEqual(result.workspace, { id: context, name: 'northwind' });
  assert.deepEqual(result.catalog, { reason: null, ambiguous: ['twin'] });
  assert.deepEqual(result.agents.map(a => a.name), souls.map(s => s.name).sort(), 'only catalog souls are spawnable');
  const rows = Object.fromEntries(result.agents.map(row => [row.name, row]));
  assert.equal(rows[souls[0].name].color, 'sage'); assert.equal(rows[souls[1].name].color, 'slate');
  for (const name of [souls[2].name, souls[3].name]) assert.equal(Object.hasOwn(rows[name], 'color'), false);
  for (const soul of souls) {
    const row = rows[soul.name];
    assert.equal(row.work, soul.work); assert.equal(row.soulKind, soul.kind); assert.equal(row.origin, soul.origin);
    assert.deepEqual(row.soulSource, { repoKey: soul.repoKey ?? null, commit: soul.commit ?? null });
    assert.equal(row.agentsRoot, roster.root); assert.equal(row.workspace, context);
  }
});

test('a catalog that could not be read yields no souls and says why — the roster is never a fallback', () => {
  const roster = deploymentStatusData(structuredClone(status), context);
  const reason = { code: 'E_WORKSPACE', message: 'members not ready' };
  const snapshot = { byWs: new Map([[context, { deployment: { status: 'observed', root: roster.root,
    souls: roster.agents.map(({ instances: _i, ...soul }) => soul), catalog: { souls: null, ambiguous: [], reason } } }]]) };
  const result = project({ id: context, name: 'northwind', roots: [roster.root] }, snapshot);
  assert.deepEqual(result.agents, []); assert.deepEqual(result.catalog, { reason, ambiguous: [] });
});

test('an unobserved deployment has no spawnable souls — never a filesystem fallback', () => {
  for (const deployment of [undefined, { status: 'pending' }, { status: 'unavailable', reason: { code: 'E_DEPLOYMENT_FEATURE', feature: 'workspace-v2' } }]) {
    const snapshot = { byWs: new Map([[context, { deployment }]]) };
    assert.deepEqual(project({ id: context, name: 'x', roots: [] }, snapshot).agents, []);
  }
});

test('remote projection never reads a remote soul path or invents missing color', () => {
  const group = { id: 'host', server: 'host', registrationPresent: true, probe: { ok: true },
    target: { workspace: '/remote' }, agentsRoot: '/remote/agents', souls: [{ name: 'dev' }] };
  const ws = remote.remoteWorkspace(group);
  const snapshot = new Proxy({}, { get() { assert.fail('remote metadata must not use the local observation'); } });
  const result = project(ws, snapshot);
  assert.equal(result.agents[0].server, 'host');
  assert.equal(Object.hasOwn(result.agents[0], 'color'), false);
  group.registrationPresent = false;
  assert.deepEqual(project(ws, snapshot).agents, []);
});
