import test from 'node:test';
import assert from 'node:assert/strict';
import { teamMembers } from '../server/team-members.mjs';
import { remotePanel } from '../server/remote-roster.mjs';
import { apiUrl } from '../api-url.mjs';

const TEAM = 'aweb:juan.aweb.ai';
const local = { id: '/w', name: 'w', scope: '/w' };
const localRow = (name, extra = {}) => ({ instance: name, agent: 'dev', agentsRoot: '/w/agents', home: `/w/agents/dev/instances/${name}`,
  running: true, createdAt: '2026-09-30T00:00:00.000Z', identity: { alias: name, team: TEAM }, ...extra });
const group = (server, extra = {}) => ({ id: `${server}:1a2b`, server, label: `${server} box`, registrationPresent: true,
  target: { sshHost: server, workspace: '/srv' }, probe: { ok: true }, agentsRoot: '/srv/agents',
  souls: [{ name: 'dev', agentsRoot: '/srv/agents' }, { name: 'qa', agentsRoot: '/srv/agents' }], instances: [], ...extra });
const remoteRow = (name, extra = {}) => ({ instance: name, agent: 'dev', agentsRoot: '/srv/agents', home: `/srv/agents/dev/instances/${name}`,
  running: true, savedRoute: false, addressable: true, missingRemotely: false, createdAt: null, identity: { alias: name, team: TEAM }, ...extra });
const project = ({ rows = [localRow('dev-a')], groups = [], workspace = local } = {}) =>
  teamMembers({ workspace, instances: rows, groups: groups.map(g => ({ group: g, panel: remotePanel(g) })) });

test('members: this workspace\'s rows and every remote panel\'s rows with a team; rows without one are not members', () => {
  const build = group('build', { instances: [remoteRow('far-a'), remoteRow('no-team', { identity: null }), remoteRow('blank', { identity: { team: '' } })] });
  const result = project({ rows: [localRow('dev-a'), localRow('solo', { identity: { alias: 'solo' } })], groups: [build] });
  assert.deepEqual(result.members.map(m => [m.server, m.instance]), [[null, 'dev-a'], ['build', 'far-a']]);
  assert.deepEqual(result.members[0], { workspace: '/w', server: null, serverLabel: null, instance: 'dev-a', agent: 'dev', agentsRoot: '/w/agents',
    home: '/w/agents/dev/instances/dev-a', team: TEAM, running: true, addressable: true, missingRemotely: false, reason: null, reasonLabel: null, createdAt: '2026-09-30T00:00:00.000Z' });
  assert.deepEqual(result.members[1], { workspace: 'remote:build:1a2b', server: 'build', serverLabel: 'build box', instance: 'far-a', agent: 'dev',
    agentsRoot: '/srv/agents', home: '/srv/agents/dev/instances/far-a', team: TEAM, running: true, addressable: true, missingRemotely: false, reason: null, reasonLabel: null, createdAt: null });
});

test('members: a row that cannot be opened carries the roster\'s own reason; missingRemotely is kept', () => {
  const build = group('build', { instances: [remoteRow('gone', { addressable: false, missingRemotely: true, running: null }), remoteRow('hidden', { addressable: false })] });
  const [gone, hidden] = project({ rows: [], groups: [build] }).members;
  assert.equal(gone.missingRemotely, true); assert.equal(gone.addressable, false);
  assert.equal(gone.reason, 'gone is no longer on build box. Remove it from this computer with: oats server forget build --instance gone');
  assert.equal(hidden.reason, 'build box did not report this instance as reachable.');
  assert.deepEqual([gone.reasonLabel, hidden.reasonLabel], ['gone from build box', 'not reachable on build box'], 'the roster\'s short label, for the state word');
});

test('servers: every remote group, reached or not; an unreached group keeps its last-known rows, their state unknown', () => {
  const down = group('down', { probe: { ok: false, error: { code: 'E_SSH', message: 'ssh failed: timeout' } }, instances: [remoteRow('kept')] });
  const result = project({ rows: [], groups: [group('build'), down] });
  assert.deepEqual(result.servers, [
    { server: 'build', label: 'build box', group: 'build:1a2b', reached: true, error: null, registered: true },
    { server: 'down', label: 'down box', group: 'down:1a2b', reached: false, error: 'ssh failed: timeout', registered: true },
  ]);
  assert.equal(result.members[0].running, null, 'last-known, state unknown');
  assert.equal(result.members[0].reason, 'ssh failed: timeout');
});

test('not reached: every failed group holding no rows is named; one with last-known rows is a group on the cards instead; nothing before the first answer', () => {
  const empty = group('empty', { probe: { ok: false, error: { message: 'ssh failed' } } });
  const kept = group('kept', { probe: { ok: false, error: { message: 'ssh failed' } }, instances: [remoteRow('k')] });
  assert.deepEqual(project({ rows: [], groups: [group('build'), empty, kept] }).notReached, [{ server: 'empty', label: 'empty box' }]);
  assert.deepEqual(project({ rows: [], groups: [] }).notReached, [], 'before the first roster answer there is nothing to name');
});

test('a server with two groups (an edited registration keeps its old group): each is listed, and only the registered one is marked so', () => {
  const old = group('build', { id: 'build:old', registrationPresent: false, target: { sshHost: 'old-host', workspace: '/old' }, instances: [remoteRow('legacy')] });
  const result = project({ rows: [], groups: [old, group('build')] });
  assert.deepEqual(result.servers.map(s => [s.group, s.registered]), [['build:old', false], ['build:1a2b', true]]);
  assert.equal(result.members[0].workspace, 'remote:build:old', 'a member navigates to its own group');
});

test('the same instance seen from two machines is two members, each labelled (never merged)', () => {
  const loop = group('loop', { instances: [remoteRow('dev-a', { home: '/w/agents/dev/instances/dev-a', agentsRoot: '/w/agents' })] });
  const members = project({ rows: [localRow('dev-a')], groups: [loop] }).members;
  assert.deepEqual(members.map(m => [m.server, m.home]), [[null, '/w/agents/dev/instances/dev-a'], ['loop', '/w/agents/dev/instances/dev-a']]);
});

test('a remote workspace has no team roster (the Teams board is local)', () => {
  assert.deepEqual(project({ workspace: { id: 'remote:build:1a2b', remote: true, server: 'build', scope: '/srv' } }),
    { error: 'unsupported-remote-operation' });
});

test('/api/team-members is workspace-scoped at the proxy: an unadvertised ws is replaced, duplicates are kept for the server to refuse', () => {
  const base = 'http://127.0.0.1:4820';
  assert.equal(apiUrl('/api/team-members?ws=evil', base, '/w', new Set(['/w'])).searchParams.get('ws'), '/w');
  assert.equal(apiUrl('/api/team-members', base, '/w', new Set(['/w'])).searchParams.get('ws'), '/w');
  assert.deepEqual(apiUrl('/api/team-members?ws=/w&ws=/x', base, '/w', new Set(['/w'])).searchParams.getAll('ws'), ['/w', '/x']);
});

test('GET /api/team-members over the shipped handler: Host guard, one ws, 409 for a remote workspace, served from the held snapshot', async () => {
  const { readFileSync } = await import('node:fs');
  const { EventEmitter } = await import('node:events');
  const remote = await import('../server/remote-roster.mjs');
  const source = readFileSync(new URL('../server/oats-web.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('const send = (res, code, body, type'), end = source.indexOf('\nserver.on("error",');
  const build = group('build', { instances: [remoteRow('far-a')] });
  const remoteWs = remote.remoteWorkspace(build);
  const deps = { createServer: fn => fn, teamMembers, remote, remoteGroups: [build], workspaces: () => [local, remoteWs],
    snapshot: { byWs: new Map([['/w', { instances: [localRow('dev-a')] }]]) },
    // Nothing may run a command or read the registry.
    adapter: new Proxy({}, { get: () => assert.fail }), cliState: { ok: true, bin: '/oats' } };
  const handler = new Function(...Object.keys(deps), `${source.slice(start, end)}\nreturn server;`)(...Object.values(deps));
  const ask = async (url, headers = { host: '127.0.0.1:4820' }) => {
    const req = new EventEmitter(); Object.assign(req, { url, method: 'GET', headers }); let result;
    const res = { writeHead(status) { result = { status }; }, end(text) { result.body = JSON.parse(text); } };
    const done = handler(req, res); req.emit('end'); await done; return result;
  };
  const ok = await ask('/api/team-members?ws=%2Fw');
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.members.map(m => [m.server, m.instance]), [[null, 'dev-a'], ['build', 'far-a']]);
  assert.deepEqual(ok.body.notReached, []);
  assert.equal((await ask(`/api/team-members?ws=${encodeURIComponent(remoteWs.id)}`)).status, 409);
  assert.equal((await ask(`/api/team-members?ws=${encodeURIComponent(remoteWs.id)}`)).body.code, 'unsupported-remote-operation');
  for (const url of ['/api/team-members', '/api/team-members?ws=%2Fw&ws=%2Fw', '/api/team-members?ws=%2Fw&x=1']) assert.equal((await ask(url)).status, 400, url);
  assert.equal((await ask('/api/team-members?ws=%2Fnope')).body.code, 'E_WORKSPACE_UNKNOWN');
  assert.equal((await ask('/api/team-members?ws=%2Fw', { host: 'evil.example' })).status, 403);
});

test('a member is addressable exactly when the roster can open it: a saved-route row from a local OATS before 0.31 is, an explicit false is not', () => {
  const build = group('build', { instances: [remoteRow('older', { addressable: undefined, savedRoute: true }), remoteRow('refused', { addressable: false, savedRoute: true })] });
  const [older, refused] = project({ rows: [], groups: [build] }).members;
  assert.deepEqual([older.addressable, older.reason], [true, null]);
  assert.equal(refused.addressable, false); assert.equal(refused.reason, 'build box did not report this instance as reachable.');
});
