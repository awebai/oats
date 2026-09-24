import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as remote from '../server/remote-roster.mjs';
import { normalizeSoulColor } from '../renderer/soul-colors.mjs';
import { deploymentStatusData } from '../deployment-data.mjs';

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

test('kernel-reported soul metadata reaches the actual agents response with only named colors', () => {
  // Variants of the captured row: the kernel passes a soul's optional
  // canonical color through; the Desktop admits named colors only.
  const raw = structuredClone(status);
  const base = raw.agents[0];
  const variant = (name, extra) => ({ ...structuredClone(base), ...extra, name, dir: `${context}/agents/${name}`, instances: [] });
  raw.agents = [{ ...base, color: 'SAGE' }, variant('helper', { color: ' slate ' }),
    variant('invalid', { color: 'url(https://invalid.example)' }), variant('missing', {})];
  const roster = deploymentStatusData(raw, context);
  const souls = roster.agents.map(({ instances: _i, ...soul }) => soul);
  const snapshot = { byWs: new Map([[context, { deployment: { status: 'observed', root: roster.root, souls } }]]) };
  const result = project({ id: context, name: 'northwind', roots: [roster.root] }, snapshot);
  assert.deepEqual(result.workspace, { id: context, name: 'northwind' });
  const rows = Object.fromEntries(result.agents.map(row => [row.name, row]));
  assert.equal(rows['release-manager'].color, 'sage'); assert.equal(rows.helper.color, 'slate');
  for (const name of ['invalid', 'missing']) assert.equal(Object.hasOwn(rows[name], 'color'), false);
  assert.equal(rows['release-manager'].team, 'engineering');
  assert.deepEqual(rows['release-manager'].soulSource, status.agents[0].soulSource);
  for (const row of result.agents) { assert.equal(row.agentsRoot, roster.root); assert.equal(row.workspace, context); }
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
