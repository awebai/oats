// #1421 §1: every skill a spawn gives the instance, `inspect --soul --composed-skills` (kernel feature
// soul-composed-skills, `souls[0].composedSkills`), through the server's one optional `composedSkills` key, gated
// exactly as `skills` is (soul-skills-gating.test.mjs): locally, this computer's CLI advertising soul-composed-skills is
// the gate; routed, that CLI must also advertise server-probe-features AND the roster row the server holds must have
// `probe.features` (an array) naming soul-composed-skills. Unknown is not supported. The rosters are
// fixtures/remote-composed/ (README.md); a host that lists composed skills is built here from g-composes with its own
// list changed, since no fixture names the feature.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cliCapability } from '../../client/cli-adapter.mjs';
import { capabilityRequest } from '../server/capabilities.mjs';
import { createInspectCache, inspectKey } from '../../client/inspect-cache.mjs';
import { remoteWorkspace, remoteAgents } from '../../client/remote-roster.mjs';
import { composedSkillsSupported, routedComposedSkillsSupported, hostComposesSkills, hostReportsSkills, COMPOSED_SKILLS_FEATURE, SKILLS_FEATURE,
  COMPOSED_FEATURE, PROBE_FEATURES_FEATURE } from '../../client/composed-gate.mjs';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/remote-composed/${name}`, import.meta.url), 'utf8'));
const roster = fixture('roster.json').result.groups;
const captured = fixture('roster-captured.json').result.groups[0];
const group = id => structuredClone(roster.find(g => g.id === id));
/** A host that lists composed skills: g-composes (same target and souls) whose own list also names the feature. */
function listingGroup(features = ['operations', 'observe-max-age', COMPOSED_FEATURE, PROBE_FEATURES_FEATURE, SKILLS_FEATURE, COMPOSED_SKILLS_FEATURE]) {
  const g = group('g-composes'); g.probe.features = features; return g;
}
const BASE = ['operations', 'observe-max-age'];
const cliWith = features => ({ ok: true, operationsApi: 2, bin: '/b/oats', features: [...BASE, ...features], remote: ['operations', 'roster'] });
const NEW_CLI = cliWith([COMPOSED_SKILLS_FEATURE, PROBE_FEATURES_FEATURE]);
/** Every host case: the listing one is built; a host that reports only the soul's own skills does not list them. */
const HOSTS = { present: listingGroup, 'own skills only': () => listingGroup(['operations', PROBE_FEATURES_FEATURE, SKILLS_FEATURE]),
  'composes only': () => group('g-composes'), absent: () => group('g-other'), none: () => group('g-none'),
  'unknown (null)': () => group('g-older'), 'unknown (failed pull)': () => group('g-failed') };
const ROUTED = ['inspect', '--dir', '/srv/northwind', '--server', 'build', '--soul', 'release-manager', '--agents-root', '/srv/northwind/agents'];
const local = { id: '/w/northwind', scope: '/w/northwind' };
const localAgents = [{ name: 'release-manager', agentsRoot: '/w/northwind/agents' }];
const envelope = result => JSON.stringify({ schemaVersion: 1, ok: true, result });
const agentsOf = g => g.probe.ok ? remoteAgents(g) : [{ name: 'release-manager', agentsRoot: g.agentsRoot }];

/** One soul inspect through the server boundary and the real adapter: the argv the CLI would run. */
async function argvFor({ cli, workspace, agents, ...flags }) {
  const calls = [];
  const exec = (_bin, argv, _o, done) => { calls.push(argv); done(null, envelope({ subject: { kind: 'soul' } })); };
  const soul = agents[0];
  await capabilityRequest({ action: 'inspect', selector: { soul: soul.name, agentsRoot: soul.agentsRoot }, ...flags },
    { workspace, cli, agents, instances: [], localCwd: '/l', invoke: (bin, options) => cliCapability(bin, options, { exec }) });
  assert.equal(calls.length, 1); return calls[0];
}

test('gate: the truth table (local/routed × this CLI’s features × the host’s probe.features)', () => {
  const clis = { old: cliWith([]), lists: cliWith([COMPOSED_SKILLS_FEATURE]), relaysOnly: cliWith([PROBE_FEATURES_FEATURE]), both: NEW_CLI,
    ownSkillsOnly: cliWith([SKILLS_FEATURE, PROBE_FEATURES_FEATURE]) };
  assert.deepEqual(Object.fromEntries(Object.entries(clis).map(([k, c]) => [k, [composedSkillsSupported(c), routedComposedSkillsSupported(c)]])),
    { old: [false, false], lists: [true, false], relaysOnly: [false, false], both: [true, true], ownSkillsOnly: [false, false] });
  for (const [cliName, cli] of Object.entries(clis)) for (const [host, make] of Object.entries(HOSTS))
    assert.equal(hostComposesSkills(cli, make()), cliName === 'both' && host === 'present', `${cliName} × ${host}`);
  // Only an array counts; a probe that failed never lists, whatever it says; a missing key is unknown.
  for (const features of [COMPOSED_SKILLS_FEATURE, { 0: COMPOSED_SKILLS_FEATURE }, undefined, null, 1, true])
    assert.equal(hostComposesSkills(NEW_CLI, { probe: { ok: true, features } }), false, JSON.stringify(features));
  assert.equal(hostComposesSkills(NEW_CLI, { probe: { ok: false, features: [COMPOSED_SKILLS_FEATURE] } }), false);
  assert.equal(hostComposesSkills({ ...NEW_CLI, ok: false }, listingGroup()), false, 'no usable CLI');
  for (const g of [null, undefined, {}, { probe: null }]) assert.equal(hostComposesSkills(NEW_CLI, g), false, JSON.stringify(g));
  assert.equal(hostComposesSkills(NEW_CLI, captured), false, 'the captured (older) host is unknown');
  // Independent of soul-skills: a host listing composed skills only does not report the soul's own, and the other way round.
  const all = cliWith([SKILLS_FEATURE, COMPOSED_SKILLS_FEATURE, PROBE_FEATURES_FEATURE]);
  const composedOnly = listingGroup(['operations', PROBE_FEATURES_FEATURE, COMPOSED_SKILLS_FEATURE]);
  assert.deepEqual([hostReportsSkills(all, composedOnly), hostComposesSkills(all, composedOnly)], [false, true]);
  assert.deepEqual([hostReportsSkills(all, HOSTS['own skills only']()), hostComposesSkills(all, HOSTS['own skills only']())], [true, false]);
});

test('adapter: --composed-skills only to a CLI advertising soul-composed-skills, after --skills; never with --home or a run', async () => {
  const io = { calls: [], exec(_b, argv, _o, done) { io.calls.push(argv); done(null, envelope({})); } };
  const soulArgs = { action: 'inspect', context: '/w/northwind', soul: 'release-manager', agentsRoot: '/w/northwind/agents', localCwd: '/w/northwind' };
  const plain = ['inspect', '--dir', '/w/northwind', '--soul', 'release-manager', '--agents-root', '/w/northwind/agents'];
  await cliCapability('/b/oats', { ...soulArgs, composedSkills: true, features: [COMPOSED_SKILLS_FEATURE] }, io);
  for (const features of [[], undefined, [SKILLS_FEATURE], [COMPOSED_FEATURE]]) await cliCapability('/b/oats', { ...soulArgs, composedSkills: true, features }, io);
  await cliCapability('/b/oats', { ...soulArgs, features: [COMPOSED_SKILLS_FEATURE] }, io);
  await cliCapability('/b/oats', { ...soulArgs, instructions: true, skills: true, composedSkills: true, features: [COMPOSED_FEATURE, SKILLS_FEATURE, COMPOSED_SKILLS_FEATURE] }, io);
  await cliCapability('/b/oats', { ...soulArgs, instructions: true, skills: true, composedSkills: true, features: [COMPOSED_FEATURE, SKILLS_FEATURE] }, io);
  // Routed with --server it goes too (the server asks only for a host that lists them).
  await cliCapability('/b/oats', { action: 'inspect', server: 'build', soul: 'release-manager', agentsRoot: '/srv/northwind/agents', localCwd: '/l', composedSkills: true, features: [COMPOSED_SKILLS_FEATURE] }, io);
  assert.deepEqual(io.calls, [[...plain, '--composed-skills', '--json'], ...Array(4).fill([...plain, '--json']), [...plain, '--json'],
    [...plain, '--instructions', '--skills', '--composed-skills', '--json'], [...plain, '--instructions', '--skills', '--json'],
    ['inspect', '--server', 'build', '--soul', 'release-manager', '--agents-root', '/srv/northwind/agents', '--composed-skills', '--json']]);
  for (const bad of [{ action: 'inspect', home: '/h', localCwd: '/h' }, { action: 'inspect', server: 'build', home: '/h', localCwd: '/l' },
    { action: 'run', home: '/h', localCwd: '/h', operation: 'knowledge:harvest' }, { action: 'inspect', context: '/w', localCwd: '/w' }])
    await assert.rejects(cliCapability('/b/oats', { ...bad, composedSkills: true, features: [COMPOSED_SKILLS_FEATURE] }, { exec: assert.fail }),
      { code: 'E_BAD_ARGS', message: 'Composed skills belong to a soul inspection' }, JSON.stringify(bad));
});

test('server: one optional boolean, a soul inspect only; sent locally when asked; the cache key includes it', async () => {
  const cli = cliWith([COMPOSED_SKILLS_FEATURE]), instances = [{ instance: 'release-manager-1', home: '/h' }];
  const calls = [], invoke = async (_bin, options) => { calls.push(options); return JSON.parse(envelope({ subject: { kind: 'soul' } })); };
  const soul = { action: 'inspect', selector: { soul: 'release-manager', agentsRoot: '/w/northwind/agents' } };
  for (const bad of [{ ...soul, composedSkills: 'yes' }, { ...soul, composedSkills: 1 }, { action: 'inspect', selector: { home: '/h' }, composedSkills: true },
    { action: 'run', selector: { home: '/h' }, operation: 'knowledge:x', composedSkills: false }])
    await assert.rejects(capabilityRequest(bad, { workspace: local, cli, agents: localAgents, instances, localCwd: '/w/northwind', invoke }),
      { code: 'E_BAD_ARGS', message: 'Invalid composed skills flag' }, JSON.stringify(bad));
  assert.equal(calls.length, 0);
  const cache = createInspectCache(), ask = request => capabilityRequest(request, { workspace: local, cli, agents: localAgents, instances, localCwd: '/w/northwind', invoke, cache });
  await ask({ ...soul, composedSkills: true });
  await ask(soul);
  assert.deepEqual(calls.map(c => c.composedSkills === true), [true, false], 'two reads: the flag is part of the cache key');
  assert.equal(Object.hasOwn(calls[1], 'composedSkills'), false, 'an unflagged read carries no composedSkills option');
  await ask({ ...soul, composedSkills: true });
  assert.equal(calls.length, 2, 'the flagged read is cached under its own key');
  const key = over => inspectKey({ deployment: '/team', kind: 'soul', soul: 'dev', agentsRoot: '/team/agents', catalogKey: 'k1', ...over });
  assert.equal(new Set([key({}), key({ skills: true }), key({ composedSkills: true }), key({ skills: true, composedSkills: true })]).size, 4);
  // Locally, server-probe-features plays no part: soul-composed-skills alone is the gate.
  assert.ok((await argvFor({ cli: cliWith([COMPOSED_SKILLS_FEATURE]), workspace: local, agents: localAgents, composedSkills: true })).includes('--composed-skills'));
  assert.ok(!(await argvFor({ cli: cliWith([PROBE_FEATURES_FEATURE, SKILLS_FEATURE]), workspace: local, agents: localAgents, composedSkills: true })).includes('--composed-skills'));
});

test('server: a routed soul inspect carries --composed-skills only for a host whose held row names the feature', async () => {
  for (const [host, make] of Object.entries(HOSTS)) {
    const g = make(), workspace = remoteWorkspace(g), agents = agentsOf(g);
    const flagged = await argvFor({ cli: NEW_CLI, workspace, agents, composedSkills: true });
    const plain = await argvFor({ cli: NEW_CLI, workspace, agents });
    if (host === 'present') {
      assert.deepEqual(flagged, [...ROUTED, '--composed-skills', '--json']);
      assert.deepEqual(plain, [...ROUTED, '--json']);
    } else assert.deepEqual(flagged, plain, `${host}: the ask is dropped, the read is today's`);
  }
  const workspace = remoteWorkspace(structuredClone(captured)), agents = remoteAgents(structuredClone(captured));
  assert.deepEqual(await argvFor({ cli: NEW_CLI, workspace, agents, composedSkills: true }), await argvFor({ cli: NEW_CLI, workspace, agents }));
  // All three asked of a host that has all three, through a CLI that routes all three; a host with the soul's own
  // skills only keeps --skills and drops --composed-skills.
  const all = cliWith([COMPOSED_FEATURE, SKILLS_FEATURE, COMPOSED_SKILLS_FEATURE, PROBE_FEATURES_FEATURE]);
  const flags = { instructions: true, skills: true, composedSkills: true };
  assert.deepEqual(await argvFor({ cli: all, workspace: remoteWorkspace(listingGroup()), agents: remoteAgents(listingGroup()), ...flags }),
    [...ROUTED, '--instructions', '--skills', '--composed-skills', '--json']);
  const older = listingGroup(['operations', COMPOSED_FEATURE, PROBE_FEATURES_FEATURE, SKILLS_FEATURE]);
  assert.deepEqual(await argvFor({ cli: all, workspace: remoteWorkspace(older), agents: remoteAgents(older), ...flags }), [...ROUTED, '--instructions', '--skills', '--json']);
  // A CLI that does not relay the hosts' features never routes it.
  for (const cli of [cliWith([]), cliWith([COMPOSED_SKILLS_FEATURE]), cliWith([PROBE_FEATURES_FEATURE])]) {
    const g = listingGroup();
    assert.deepEqual(await argvFor({ cli, workspace: remoteWorkspace(g), agents: remoteAgents(g), composedSkills: true }),
      await argvFor({ cli, workspace: remoteWorkspace(g), agents: remoteAgents(g) }), JSON.stringify(cli.features));
  }
  // A workspace object without its roster group (no held row) is unknown.
  const { group: _held, ...bare } = remoteWorkspace(listingGroup());
  assert.ok(!(await argvFor({ cli: NEW_CLI, workspace: bare, agents: remoteAgents(listingGroup()), composedSkills: true })).includes('--composed-skills'));
});
