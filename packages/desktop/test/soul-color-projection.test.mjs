import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import * as deployment from '../server/deployment.mjs';
import * as remote from '../server/remote-roster.mjs';
import { normalizeSoulColor } from '../renderer/soul-colors.mjs';

// Exercise the actual response projection without starting the backend, CLI or
// tmux. Capability resolution is injected; its existing trust/containment tests
// remain authoritative. Local canonical metadata uses the real read-only reader.
const source = readFileSync(new URL('../server/oats-web.mjs', import.meta.url), 'utf8');
const start = source.indexOf('function agentsData(');
const end = source.indexOf('/* ── Model catalog', start);
assert.ok(start >= 0 && end > start);
const project = (ws, reader) => new Function('workspaceById', 'workspaces', 'reader', 'remote', 'dirname', 'resolve', 'normalizeSoulColor',
  `${source.slice(start, end)}; return agentsData;`)(() => ws, () => [ws], reader, remote, dirname, resolve, normalizeSoulColor)();

test('canonical local metadata and capability rows reach the actual agents response with only named colors', t => {
  const dir = mkdtempSync(join(tmpdir(), 'oats-desktop-colors-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, 'agents');
  function soul(base, name, metadata, file = 'soul.yaml') {
    const home = join(base, name, 'soul'); mkdirSync(home, { recursive: true });
    writeFileSync(join(home, file), `name: ${name}\nruntime: pi\n${metadata}\n`);
  }
  soul(root, 'dev', 'color: "SAGE"');
  soul(join(dir, 'local-agents'), 'local', 'color: clay');
  soul(root, 'invalid', 'color: url(https://invalid.example)');
  soul(root, 'missing', 'description: no color');
  soul(root, 'wrong-file', 'color: sage', 'soul.yml');
  const resolved = [];
  const reader = { ...deployment,
    listCapabilityAgents: () => [{ name: 'dev' }, { name: 'helper' }, { name: 'bad-capability' }],
    findCapabilityAgent: (_context, agentsRoot, name) => {
      assert.equal(agentsRoot, root); resolved.push(name);
      return { name, kind: 'capability', capability: 'fixture.notes', color: name === 'helper' ? ' slate ' : '#ffffff' };
    },
  };
  const result = project({ id: 'fixture', name: 'Fixture', roots: [root] }, reader);
  assert.deepEqual(result.workspace, { id: 'fixture', name: 'Fixture' });
  const rows = Object.fromEntries(result.agents.map(row => [row.name, row]));
  assert.equal(rows.dev.color, 'sage'); assert.equal(rows.local.color, 'clay');
  assert.equal(rows.helper.color, 'slate'); assert.equal(rows.helper.capability, 'fixture.notes');
  assert.equal(rows.local.kind, 'local'); assert.equal(rows.dev.runtime, 'pi');
  for (const name of ['invalid', 'missing', 'bad-capability']) assert.equal(Object.hasOwn(rows[name], 'color'), false);
  assert.equal(rows['wrong-file'], undefined);
  assert.deepEqual(resolved, ['helper', 'bad-capability'], 'local soul retains precedence');
  for (const row of result.agents) assert.equal(row.agentsRoot, root);
});

test('remote projection never reads a remote soul path or invents missing color', () => {
  const group = { id: 'host', server: 'host', registrationPresent: true, probe: { ok: true },
    target: { workspace: '/remote' }, agentsRoot: '/remote/agents', souls: [{ name: 'dev' }] };
  const ws = remote.remoteWorkspace(group);
  const reader = new Proxy({}, { get() { assert.fail('remote metadata must not use the local reader'); } });
  const result = project(ws, reader);
  assert.equal(result.agents[0].server, 'host');
  assert.equal(Object.hasOwn(result.agents[0], 'color'), false);
  group.registrationPresent = false;
  assert.deepEqual(project(ws, reader).agents, []);
});
