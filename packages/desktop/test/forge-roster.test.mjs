// forge-roster: the PR of each LOCAL instance's branch, for the roster. The repository is
// the kernel's (#217 clones[] member key); the Desktop derives no remote. Maintainer
// conditions: realpath on both sides and the LONGEST containing clone; gh as the host's own
// auth (E_GH_UNAVAILABLE when missing or signed out); only instances with a branch; rows
// exactly { home, number, state, isDraft, url }; a non-admitted or non-github repo is never
// queried; one flight per workspace under the shared forge cap (E_FORGE_BUSY); a TTL cache.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rosterTargets, ROSTER_LIMIT } from '../server/forge-roster.mjs';
import { createForgeBoundary } from '../server/forge.mjs';
import { cli, status, output, deferred, tick } from './helpers/forge-fixture.mjs';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'oats-forge-roster-')));
process.on('exit', () => rmSync(root, { recursive: true, force: true }));
const ws = join(root, 'ws'), agents = join(ws, 'agents-repo'), tools = join(agents, 'tools'), vendor = join(agents, 'vendor'), other = join(ws, 'other');
for (const d of [tools, vendor, other, join(root, 'elsewhere')]) mkdirSync(d, { recursive: true });
symlinkSync(tools, join(root, 'tools-link')); symlinkSync(agents, join(root, 'agents-link'));
const clones = [
  { key: 'github.com/acme/agents', name: 'agents', path: join(root, 'agents-link'), rule: 'clones' }, // a link: realpath'd too
  { key: 'github.com/acme/tools', name: 'tools', path: tools, rule: 'convention' },
  { key: 'local/fx/remotes/vendor.git', name: 'vendor', path: vendor, rule: 'convention' },
  { key: 'gitlab.com/acme/other', name: 'other', path: other, rule: 'convention' },
  { key: 'github.com/acme/absent', name: 'absent', path: null, rule: null },
];
const home = name => join(ws, 'agents', name, 'instances', `${name}-1`);
const inst = (name, repo, branch) => ({ instance: `${name}-1`, home: home(name), repo, branch });
const realpath = realpathSync.native;

test('targets: realpath on both sides, the longest containing clone, github.com keys only, branch required', () => {
  const instances = [
    inst('lead', agents, 'feat/lead'),                          // → acme/agents
    inst('tooler', join(root, 'tools-link'), 'feat/tools'),      // a link into the nested clone → acme/tools (longest)
    inst('vendored', vendor, 'feat/v'),                          // a non-github member inside acme/agents: no fact, no fallback
    inst('gitlab', other, 'feat/g'),                             // non-github key: never queried
    inst('outside', join(root, 'elsewhere'), 'feat/o'),          // in no clone (not admitted): never queried
    inst('detached', agents, null), inst('empty', agents, ''),   // no branch: no fact
    inst('relative', 'agents-repo', 'feat/r'), inst('missing', join(root, 'gone'), 'feat/m'),
  ];
  assert.deepEqual(rosterTargets({ instances, clones, realpath }), [
    { home: home('lead'), host: 'github.com', path: 'acme/agents', branch: 'feat/lead' },
    { home: home('tooler'), host: 'github.com', path: 'acme/tools', branch: 'feat/tools' },
  ]);
  const many = Array.from({ length: ROSTER_LIMIT + 5 }, (_, i) => inst(`n${i}`, agents, `b${i}`));
  assert.equal(rosterTargets({ instances: many, clones, realpath }).length, ROSTER_LIMIT, 'bounded');
});

function fixture({ configured = status(), discover, prFor } = {}) {
  const calls = []; let clock = 0;
  const service = createForgeBoundary({ realpath, now: () => clock, invokeGit: assert.fail,
    discover: discover || (async () => cli),
    run: async (bin, args, opts) => {
      calls.push(args); assert.equal(bin, cli.bin);
      assert.doesNotMatch(JSON.stringify([args, opts]), /token|GH_TOKEN|GITHUB_TOKEN/i, 'never a token in argv or options');
      if (args[0] === 'auth') return output(configured);
      if (args[0] === 'api') return output('operator');
      const repo = args[args.indexOf('--repo') + 1].replace('github.com/', ''), branch = args.at(-1);
      if (prFor) return prFor(repo, branch);
      if (branch === 'feat/none') return output('', 1, `no pull requests found for branch ${JSON.stringify(branch)}`);
      return output({ number: 7, title: 'x', state: 'OPEN', isDraft: branch === 'feat/tools', baseRefName: 'main', headRefName: branch,
        url: `https://github.com/${repo}/pull/7`, reviewDecision: null, statusCheckRollup: null, updatedAt: '2026-09-26T00:00:00Z' });
    } });
  return { service, calls, tick: ms => { clock += ms; } };
}
const prCalls = calls => calls.filter(a => a[0] === 'pr').map(a => [a[a.indexOf('--repo') + 1], a.at(-1)]);
const context = (instances, extra = {}) => () => ({ workspace: { id: ws, scope: ws }, instances, clones, ...extra });

test('rows are exactly {home, number, state, isDraft, url}; only admitted github repos are queried; no PR, no row', async () => {
  const f = fixture();
  const instances = [inst('lead', agents, 'feat/lead'), inst('tooler', tools, 'feat/tools'), inst('quiet', agents, 'feat/none'),
    inst('gitlab', other, 'feat/g'), inst('outside', join(root, 'elsewhere'), 'feat/o'), inst('detached', agents, null)];
  const r = await f.service.roster({}, context(instances));
  assert.equal(r.status, 'ok'); assert.equal(r.reason, null);
  assert.deepEqual(r.rows, [
    { home: home('lead'), number: 7, state: 'OPEN', isDraft: false, url: 'https://github.com/acme/agents/pull/7' },
    { home: home('tooler'), number: 7, state: 'OPEN', isDraft: true, url: 'https://github.com/acme/tools/pull/7' }]);
  assert.deepEqual(prCalls(f.calls), [['github.com/acme/agents', 'feat/lead'], ['github.com/acme/tools', 'feat/tools'], ['github.com/acme/agents', 'feat/none']],
    'the gitlab member, the unadmitted path and the detached instance are never queried');
});

test('gh missing or signed out: E_GH_UNAVAILABLE, and no PR is queried', async () => {
  const missing = fixture({ discover: async () => ({ ok: false, code: 'E_GH_MISSING' }) });
  const signedOut = fixture({ configured: status('github.example.com') }); // gh knows another host only
  for (const f of [missing, signedOut]) {
    const r = await f.service.roster({}, context([inst('lead', agents, 'feat/lead')]));
    assert.equal(r.reason.code, 'E_GH_UNAVAILABLE'); assert.equal(r.rows, null); assert.deepEqual(prCalls(f.calls), []);
  }
});

test('a TTL cache: a second read inside 60 s asks gh nothing new; after it, gh again', async () => {
  const f = fixture(), read = () => f.service.roster({}, context([inst('lead', agents, 'feat/lead')]));
  await read(); await read(); assert.equal(prCalls(f.calls).length, 1);
  f.tick(61_000); await read(); assert.equal(prCalls(f.calls).length, 2);
});

test('the shared forge cap: a fifth concurrent flight is E_FORGE_BUSY', async () => {
  const gate = deferred();
  const f = fixture({ prFor: () => gate.promise });
  const pending = [1, 2, 3, 4].map(n => f.service.roster({}, () => ({ workspace: { id: `ws${n}`, scope: ws }, instances: [inst('lead', agents, 'feat/lead')], clones })));
  await tick(); await tick();
  const busy = await f.service.roster({}, () => ({ workspace: { id: 'ws5', scope: ws }, instances: [inst('lead', agents, 'feat/lead')], clones }));
  assert.equal(busy.reason.code, 'E_FORGE_BUSY');
  gate.resolve(output('', 1, 'no pull requests found for branch "feat/lead"')); await Promise.all(pending);
});

test('admission: an empty body only; a known local workspace; nothing to read reads nothing', async () => {
  const f = fixture({ discover: assert.fail });
  assert.equal((await f.service.roster({ extra: 1 }, context([]))).reason.code, 'E_BAD_ARGS');
  assert.equal((await f.service.roster({}, () => ({ workspace: undefined }))).reason.code, 'E_WORKSPACE_UNKNOWN');
  assert.equal((await f.service.roster({}, context([], { workspace: { id: 'r', remote: true } }))).status, 'unavailable');
  assert.deepEqual((await f.service.roster({}, context([inst('detached', agents, null)]))).rows, []);
});
