// awebai/oats#1490: a spawn on another machine keeps the exact name the dialog gives it. The plumbing below the
// dialog: the adapter's --name rule and the backend's spawnAgent, which forwards it only where it may.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnArgv, cliSpawn } from '../../client/cli-adapter.mjs';
import { namingOf, APPLY_SUGGEST_FEATURE } from '../../client/spawn-preview-contract.mjs';

test('spawnArgv: --name is the kernel\'s lowercase slug, used as given; never beside --purpose', () => {
  assert.deepEqual(spawnArgv('dev', '/ws', '/t/TASK.md', { name: 'api-v2-dev', server: 'build' }),
    ['spawn', 'dev', '--task-file', '/t/TASK.md', '--name', 'api-v2-dev', '--server', 'build', '--json']);
  for (const name of ['API-v2', '-x', '--json', 'a b', 'a_b', 'é', 'a/b']) assert.throws(() => spawnArgv('dev', '/ws', '/t/TASK.md', { name }), /invalid name/, name);
  assert.throws(() => spawnArgv('dev', '/ws', '/t/TASK.md', { name: 'api-v2-dev', purpose: 'api-v2' }), e => e.code === 'E_BAD_ARGS' && /--name or --purpose/.test(e.message));
  assert.deepEqual(spawnArgv('dev', '/ws', '/t/TASK.md', { name: '', purpose: 'api-v2' }).slice(-3), ['--purpose', 'api-v2', '--json'], 'an empty name is no name');
});

test('cliSpawn: a name with a purpose resolves E_BAD_ARGS without running the CLI', async () => {
  const env = await cliSpawn('/no/oats', { agent: 'dev', workspaceDir: '/ws', task: 't', name: 'x-dev', purpose: 'x' }, { execFile: () => assert.fail('never runs') });
  assert.equal(env.ok, false); assert.equal(env.error.code, 'E_BAD_ARGS');
});

/** The shipped spawnAgent, with doubles for what it reads: this computer's CLI and the adapter call it makes. */
function spawnAgentWith(features, answer = {}) {
  const source = readFileSync(new URL('../server/oats-web.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('async function spawnAgent('), end = source.indexOf('\n}\n', start) + 2;
  const sent = [];
  const deps = {
    deployments: () => [], held: () => ({}), remoteGroups: [{ server: 'build' }],
    remote: { remoteAgents: () => [{ name: 'dev', agentsRoot: '/srv/agents' }], spawnedWorkspace: () => null },
    cliState: { ok: true, bin: '/oats', features }, locator: { requireRemoteSupport: () => {}, relationSupportError: () => null },
    adapter: { cliSpawn: async (_bin, opts) => { sent.push(opts); return { ok: true, result: { instance: opts.name || `dev-${opts.purpose}`, agent: 'dev', home: '/h', ...answer } }; } },
    ctxs: [], homedir: () => '/home', resolve, namingOf, APPLY_SUGGEST_FEATURE, harnessFlag: () => '--harness', refreshRemoteSnapshot: async () => {}, viewFor: () => null, DESKTOP_TERMS: {},
  };
  const spawnAgent = new Function(...Object.keys(deps), `${source.slice(start, end)}\nreturn spawnAgent;`)(...Object.values(deps));
  return { spawnAgent, sent };
}
const body = { agent: 'dev', agentsRoot: '/srv/agents', serverId: 'build', task: 'go' };

test('spawnAgent: a name goes to the CLI where it advertises spawn-name; a purpose as before', async () => {
  const { spawnAgent, sent } = spawnAgentWith(['spawn-name']);
  assert.equal((await spawnAgent({ ...body, name: 'api-v2-dev' })).instance, 'api-v2-dev');
  assert.equal(sent[0].name, 'api-v2-dev'); assert.equal(sent[0].purpose, undefined); assert.equal(sent[0].server, 'build');
  await spawnAgent({ ...body, purpose: 'api-v2' });
  assert.equal(sent[1].purpose, 'api-v2'); assert.equal(sent[1].name, undefined);
});

test('spawnAgent: refuses a name beside a purpose (E_BAD_ARGS), a name that is not text, and a name this CLI cannot send (cli-no-spawn-name)', async () => {
  const { spawnAgent, sent } = spawnAgentWith(['spawn-name']);
  await assert.rejects(spawnAgent({ ...body, name: 'api-v2-dev', purpose: 'api-v2' }), e => e.code === 'E_BAD_ARGS');
  for (const name of [['api-v2-dev'], 7, { toString: () => 'x' }]) await assert.rejects(spawnAgent({ ...body, name }), e => e.code === 'E_BAD_ARGS', JSON.stringify(name));
  const older = spawnAgentWith(['launch-config']);
  await assert.rejects(older.spawnAgent({ ...body, name: 'api-v2-dev' }), e => e.code === 'cli-no-spawn-name');
  assert.equal((await older.spawnAgent({ ...body, purpose: 'api-v2' })).instance, 'dev-api-v2', 'a purpose needs no spawn-name');
  assert.equal(sent.length + older.sent.length, 1, 'only the purpose spawn reached the CLI');
});

test('spawnAgent: --suggest-name only where this CLI knows it, never beside a name or a purpose; the host\'s naming re-validated', async () => {
  const naming = { source: 'numbered', reason: 'timeout', message: 'PRIVATE', ms: 20000 };
  const { spawnAgent, sent } = spawnAgentWith(['spawn-name', APPLY_SUGGEST_FEATURE], { naming });
  const r = await spawnAgent({ ...body, suggestName: true });
  assert.equal(sent[0].suggestName, true); assert.deepEqual(r.naming, { source: 'numbered', reason: 'timeout', ms: 20000 }, 'no kernel message');
  assert.equal(Object.hasOwn(await spawnAgent({ ...body, purpose: 'x' }), 'naming'), false, 'only an apply that asked carries it');
  for (const extra of [{ name: 'x-dev' }, { purpose: 'x' }]) await assert.rejects(spawnAgent({ ...body, suggestName: true, ...extra }), e => e.code === 'E_BAD_ARGS');
  await assert.rejects(spawnAgent({ ...body, suggestName: 'yes' }), e => e.code === 'E_BAD_ARGS');
  await assert.rejects(spawnAgentWith(['spawn-name']).spawnAgent({ ...body, suggestName: true }), e => e.code === 'cli-no-apply-suggest-name');
  const odd = spawnAgentWith(['spawn-name', APPLY_SUGGEST_FEATURE], { naming: { source: 'auto' } });
  assert.equal(Object.hasOwn(await odd.spawnAgent({ ...body, suggestName: true }), 'naming'), false, 'a malformed naming is dropped');
});
