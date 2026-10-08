// Spec R, part RD: a routed soul page's composed AGENTS.md. `instructions` reaches `inspect --server` only when this
// computer's CLI advertises soul-composed-instructions and server-probe-features AND the roster row the server holds
// for that workspace has `probe.features` (an array) naming soul-composed-instructions. Unknown is not supported.
// The rosters (fixtures/remote-composed/README.md): a redacted real capture from a kernel at the #795 merge commit
// (an older host: features null), and hand-written groups on its shape for the other cases.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cliCapability } from '../cli-adapter.mjs';
import { capabilityRequest } from '../server/capabilities.mjs';
import { createInspectCache } from '../server/inspect-cache.mjs';
import { remoteWorkspace, remoteAgents } from '../server/remote-roster.mjs';
import { composedSupported, routedComposedSupported, hostComposes, COMPOSED_FEATURE, PROBE_FEATURES_FEATURE } from '../renderer/composed-gate.mjs';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/remote-composed/${name}`, import.meta.url), 'utf8'));
const roster = fixture('roster.json').result.groups;
const captured = fixture('roster-captured.json').result.groups[0];
const group = id => structuredClone(roster.find(g => g.id === id));
const BASE = ['operations', 'observe-max-age'];
const cliWith = features => ({ ok: true, operationsApi: 2, bin: '/b/oats', features: [...BASE, ...features], remote: ['operations', 'roster'] });
const NEW_CLI = cliWith([COMPOSED_FEATURE, PROBE_FEATURES_FEATURE]);
const HOSTS = { present: 'g-composes', absent: 'g-other', none: 'g-none', 'unknown (null)': 'g-older', 'unknown (failed pull)': 'g-failed' };
const local = { id: '/w/northwind', scope: '/w/northwind' };
const localAgents = [{ name: 'release-manager', agentsRoot: '/w/northwind/agents' }];

/** One soul inspect through the server boundary and the real adapter: the argv the CLI would run. */
async function argvFor({ cli, workspace, agents, instructions }) {
  const calls = [];
  const exec = (_bin, argv, _o, done) => { calls.push(argv); done(null, JSON.stringify({ schemaVersion: 1, ok: true, result: { subject: { kind: 'soul' } } })); };
  const soul = agents[0];
  await capabilityRequest({ action: 'inspect', selector: { soul: soul.name, agentsRoot: soul.agentsRoot }, ...(instructions === undefined ? {} : { instructions }) },
    { workspace, cli, agents, instances: [], localCwd: '/l', invoke: (bin, options) => cliCapability(bin, options, { exec }) });
  assert.equal(calls.length, 1); return calls[0];
}

test('gate: the truth table (local/routed × this CLI’s features × the host’s probe.features)', () => {
  const clis = { old: cliWith([]), composes: cliWith([COMPOSED_FEATURE]), relaysOnly: cliWith([PROBE_FEATURES_FEATURE]), both: NEW_CLI };
  assert.deepEqual(Object.fromEntries(Object.entries(clis).map(([k, c]) => [k, [composedSupported(c), routedComposedSupported(c)]])),
    { old: [false, false], composes: [true, false], relaysOnly: [false, false], both: [true, true] });
  for (const [cliName, cli] of Object.entries(clis)) for (const [host, id] of Object.entries(HOSTS))
    assert.equal(hostComposes(cli, group(id)), cliName === 'both' && host === 'present', `${cliName} × ${host}`);
  // Only an array counts; a probe that failed never composes, whatever it lists.
  for (const features of ['soul-composed-instructions', { 0: COMPOSED_FEATURE }, undefined, 1, true])
    assert.equal(hostComposes(NEW_CLI, { probe: { ok: true, features } }), false, JSON.stringify(features));
  assert.equal(hostComposes(NEW_CLI, { probe: { ok: false, features: [COMPOSED_FEATURE] } }), false);
  assert.equal(hostComposes({ ...NEW_CLI, ok: false }, group('g-composes')), false, 'no usable CLI');
  for (const g of [null, undefined, {}, { probe: null }]) assert.equal(hostComposes(NEW_CLI, g), false, JSON.stringify(g));
});

test('fixtures: the hand-written groups have the captured group’s shape; the captured host is unknown', () => {
  const keys = v => Object.keys(v).sort();
  assert.deepEqual(captured.probe, { ok: true, features: null }, 'captured from an older host');
  for (const g of roster) {
    assert.deepEqual(keys(g), keys(captured), g.id);
    for (const part of ['target', 'workspace']) assert.deepEqual(keys(g[part]), keys(captured[part]), `${g.id} ${part}`);
    assert.deepEqual(keys(g.souls[0]), keys(captured.souls[0]), `${g.id} souls`);
    // A good pull always has a features key (array or null); a failed one has none (RK).
    assert.deepEqual(keys(g.probe), g.probe.ok ? ['features', 'ok'] : ['error', 'ok'], `${g.id} probe`);
  }
  assert.equal(hostComposes(NEW_CLI, captured), false);
});

test('server: the captured roster row (an older host) gets today’s argv', async () => {
  const workspace = remoteWorkspace(structuredClone(captured)), agents = remoteAgents(structuredClone(captured));
  const flagged = await argvFor({ cli: NEW_CLI, workspace, agents, instructions: true });
  assert.deepEqual(flagged, ['inspect', '--dir', '/srv/northwind', '--server', 'build', '--soul', 'release-manager', '--agents-root', '/srv/northwind/agents', '--json']);
  assert.deepEqual(flagged, await argvFor({ cli: NEW_CLI, workspace, agents }));
});

test('server: a routed soul inspect carries --instructions only for a host whose held row names the feature', async () => {
  for (const [host, id] of Object.entries(HOSTS)) {
    const g = group(id);
    const workspace = remoteWorkspace(g), agents = id === 'g-failed' ? [{ name: 'release-manager', agentsRoot: g.agentsRoot }] : remoteAgents(g);
    const flagged = await argvFor({ cli: NEW_CLI, workspace, agents, instructions: true });
    const plain = await argvFor({ cli: NEW_CLI, workspace, agents });
    if (host === 'present') {
      assert.deepEqual(flagged, ['inspect', '--dir', '/srv/northwind', '--server', 'build', '--soul', 'release-manager', '--agents-root', '/srv/northwind/agents', '--instructions', '--json']);
      assert.deepEqual(plain, flagged.filter(a => a !== '--instructions'));
    } else assert.deepEqual(flagged, plain, `${host}: the ask is dropped, the read is today's`);
  }
});

test('server: an older CLI changes nothing, local or routed', async () => {
  const workspace = remoteWorkspace(group('g-composes')), agents = remoteAgents(group('g-composes'));
  for (const cli of [cliWith([]), cliWith([COMPOSED_FEATURE]), cliWith([PROBE_FEATURES_FEATURE])])
    assert.deepEqual(await argvFor({ cli, workspace, agents, instructions: true }), await argvFor({ cli, workspace, agents }), JSON.stringify(cli.features));
  // Locally, server-probe-features plays no part: soul-composed-instructions alone is the gate (spec D, B2).
  assert.ok((await argvFor({ cli: cliWith([COMPOSED_FEATURE]), workspace: local, agents: localAgents, instructions: true })).includes('--instructions'));
  assert.ok(!(await argvFor({ cli: cliWith([PROBE_FEATURES_FEATURE]), workspace: local, agents: localAgents, instructions: true })).includes('--instructions'));
});

test('server: the decision is the row it holds, not the caller’s; a row that loses the feature stops the flag', async () => {
  const g = group('g-composes'), agents = remoteAgents(g);
  // The workspace a request resolves to is rebuilt from the held roster on each request (oats-web deployments()).
  assert.ok((await argvFor({ cli: NEW_CLI, workspace: remoteWorkspace(g), agents, instructions: true })).includes('--instructions'));
  const downgraded = { ...g, probe: { ok: true, features: null } };
  assert.ok(!(await argvFor({ cli: NEW_CLI, workspace: remoteWorkspace(downgraded), agents, instructions: true })).includes('--instructions'), 'a host now unknown');
  const failed = { ...g, probe: { ok: false, error: { code: 'E_SSH', message: 'down' } } };
  assert.ok(!(await argvFor({ cli: NEW_CLI, workspace: remoteWorkspace(failed), agents, instructions: true })).includes('--instructions'), 'the last pull failed');
  // A workspace object without its roster group (no held row) is unknown.
  const { group: _held, ...bare } = remoteWorkspace(g);
  assert.ok(!(await argvFor({ cli: NEW_CLI, workspace: bare, agents, instructions: true })).includes('--instructions'));
  // The flag stays validated as before, routed too.
  await assert.rejects(capabilityRequest({ action: 'inspect', selector: { soul: 'release-manager', agentsRoot: g.agentsRoot }, instructions: 'yes' },
    { workspace: remoteWorkspace(g), cli: NEW_CLI, agents, instances: [], localCwd: '/l', invoke: assert.fail }), { code: 'E_BAD_ARGS', message: 'Invalid instructions flag' });
});

test('server: a routed flagged read is coalesced under its own key and never stored', async () => {
  const g = group('g-composes'), agents = remoteAgents(g), cache = createInspectCache(), seen = [];
  let release; const gate = new Promise(r => { release = r; });
  const invoke = async (_bin, options) => { seen.push(options.instructions === true); await gate; return { schemaVersion: 1, ok: true, result: { subject: { kind: 'soul' } } }; };
  const ask = instructions => capabilityRequest({ action: 'inspect', selector: { soul: 'release-manager', agentsRoot: g.agentsRoot }, ...(instructions ? { instructions } : {}) },
    { workspace: remoteWorkspace(g), cli: NEW_CLI, agents, instances: [], localCwd: '/l', invoke, cache });
  const reads = [ask(true), ask(true), ask(false)];
  await new Promise(r => setTimeout(r, 0)); release(); await Promise.all(reads);
  assert.deepEqual(seen, [true, false], 'two concurrent flagged reads share one flight; the plain one is another key');
  await ask(true); assert.deepEqual(seen, [true, false, true], 'a routed inspection is never served from an earlier visit');
});

test('adapter: --instructions routes with --server, after the soul target; never with --home or a run', async () => {
  const io = { calls: [], exec(_b, argv, _o, done) { io.calls.push(argv); done(null, JSON.stringify({ schemaVersion: 1, ok: true, result: {} })); } };
  const routed = { action: 'inspect', server: 'build', soul: 'release-manager', agentsRoot: '/srv/northwind/agents', localCwd: '/l' };
  await cliCapability('/b/oats', { ...routed, instructions: true, features: [COMPOSED_FEATURE] }, io);
  await cliCapability('/b/oats', { ...routed, instructions: true, features: [] }, io);
  assert.deepEqual(io.calls, [['inspect', '--server', 'build', '--soul', 'release-manager', '--agents-root', '/srv/northwind/agents', '--instructions', '--json'],
    ['inspect', '--server', 'build', '--soul', 'release-manager', '--agents-root', '/srv/northwind/agents', '--json']]);
  for (const bad of [{ action: 'inspect', server: 'build', home: '/h', localCwd: '/l' }, { action: 'run', server: 'build', home: '/h', localCwd: '/l', operation: 'knowledge:harvest' }])
    await assert.rejects(cliCapability('/b/oats', { ...bad, instructions: true, features: [COMPOSED_FEATURE] }, { exec: assert.fail }), { code: 'E_BAD_ARGS' }, JSON.stringify(bad));
});
