import test from 'node:test';
import assert from 'node:assert/strict';
import { cliInstanceGit } from '../cli-adapter.mjs';
import { createInstanceGitBoundary } from '../server/instance-git.mjs';
import { createForgeBoundary } from '../server/forge.mjs';

const rev = 'a'.repeat(40), idx = 'b'.repeat(40), id = 'c'.repeat(24);
const home = '/srv/agents/dev/instances/dev-1';
const cli = { ok: true, bin: '/installed/oats', version: '0.31.0', remote: ['instance-git'] };
const workspace = { id: 'remote:build:3f2a', name: 'Build box', scope: '/srv', remote: true, server: 'build' };
const row = { instance: 'dev-1', agent: 'dev', agentsRoot: '/srv/agents', home, server: 'build', addressable: true, missingRemotely: false, running: true };
const selector = { instance: 'dev-1', agent: 'dev', agentsRoot: '/srv/agents', server: 'build' };
const observation = () => ({ revision: rev, indexRevision: idx, at: '2026-09-22T00:00:00.000Z', worktree: `${home}/work`, branch: 'main', detached: false, unborn: false });
const file = () => ({ id, kind: 'changed', xy: '.M', submodule: false, path: 'file.txt', origPath: null });
const state = () => ({ instanceGitApi: 1, instance: 'dev-1', agent: 'dev', home, workMode: 'worktree', observation: observation(),
  recorded: { branch: 'main', repo: '/repo', drift: false }, upstream: { ref: null, ahead: null, behind: null }, base: { ref: null, source: null, mergeBase: null, ahead: null, behind: null },
  summary: { changed: 1, renamed: 0, copied: 0, unmerged: 0, untracked: 0 }, files: [file()], notes: [] });
const diff = () => ({ instanceGitApi: 1, observation: observation(), file: file(), against: rev, binary: false, bytes: 2, truncated: false, limit: 262144, patch: '+x',
  readOnly: { helpers: 'disabled', optionalLocks: 'off', objectsWritten: 0 } });
const envelope = result => ({ schemaVersion: 1, ok: true, result });
const context = (extra = {}) => ({ cli: structuredClone(cli), workspace: { ...workspace }, instances: [{ ...row }], localCwd: '/Users/me/work', ...extra });
function boundary(respond) {
  const calls = [];
  const read = createInstanceGitBoundary({ invoke: (bin, options) => cliInstanceGit(bin, options, { exec: (_b, argv, opts, done) => { calls.push({ argv, opts }); respond(done, argv); } }) });
  return { calls, read };
}

test('remote git and diff: routed by server and home from this machine\'s cwd with 45 s, no --dir', async () => {
  const { calls, read } = boundary((done, argv) => done(null, JSON.stringify(envelope(argv[1] === 'diff' ? diff() : state()))));
  const git = await read({ action: 'git', selector }, context());
  assert.equal(git.status, 'available', JSON.stringify(git.reason));
  assert.deepEqual(git.target, { workspace: workspace.id, instance: 'dev-1', agent: 'dev', agentsRoot: '/srv/agents', home, server: 'build' });
  assert.deepEqual(calls[0].argv, ['instance', 'git', 'dev-1', '--server', 'build', '--home', home, '--json']);
  assert.equal(calls[0].opts.cwd, '/Users/me/work'); assert.equal(calls[0].opts.timeout, 45_000);
  const patch = await read({ action: 'diff', selector, fileId: id, revision: rev, indexRevision: idx }, context());
  assert.equal(patch.status, 'available');
  assert.deepEqual(calls[1].argv, ['instance', 'diff', 'dev-1', '--server', 'build', '--home', home, '--file', id, '--revision', rev, '--index-revision', idx, '--json']);
});

test('remote git: the host\'s refusal keeps its code and message under the headline, never a local read', async () => {
  const { calls, read } = boundary(done => done(Object.assign(new Error('exit 1'), { code: 1 }),
    JSON.stringify({ schemaVersion: 1, ok: false, error: { code: 'E_SNAPSHOT_UNKNOWN', message: 'build does not list dev-1' } })));
  const value = await read({ action: 'git', selector }, context());
  assert.equal(value.status, 'unavailable'); assert.equal(calls.length, 1);
  assert.deepEqual(value.reason, { code: 'E_SNAPSHOT_UNKNOWN', message: "Build box doesn't list this instance any more.", detail: 'build does not list dev-1', remote: true });
  const lost = boundary(done => done({ killed: true }, ''));
  assert.deepEqual((await lost.read({ action: 'git', selector }, context())).reason,
    { code: 'E_CLI_TIMEOUT', message: "Couldn't reach Build box.", detail: 'The installed OATS CLI read timed out', remote: true });
});

test('remote git: refused before any process without the probe entry or for an unaddressable row', async () => {
  const { calls, read } = boundary(assert.fail);
  const noEntry = await read({ action: 'git', selector }, context({ cli: { ...cli, remote: ['session'] } }));
  assert.equal(noEntry.reason.message, "This computer's OATS can't route this to Build box. Update OATS here.");
  const gone = await read({ action: 'git', selector }, context({ instances: [{ ...row, addressable: false, missingRemotely: true }] }));
  assert.equal(gone.reason.message, 'dev-1 is no longer on Build box. Remove it from this computer with: oats server forget build --instance dev-1');
  assert.equal(calls.length, 0);
});

test('remote git: two same-named instances under different souls are each read at their own home', async () => {
  const twin = { ...row, agent: 'qa', home: '/srv/agents/qa/instances/dev-1' };
  const { calls, read } = boundary(done => done(null, JSON.stringify(envelope({ ...state(), agent: 'qa', home: twin.home,
    observation: { ...observation(), worktree: `${twin.home}/work` } }))));
  const value = await read({ action: 'git', selector: { ...selector, agent: 'qa' } }, context({ instances: [{ ...row }, twin] }));
  assert.equal(value.status, 'available', JSON.stringify(value.reason));
  assert.equal(calls[0].argv[calls[0].argv.indexOf('--home') + 1], twin.home);
});

test('adapter: a server route replaces --dir; an invalid server id is refused unrun', async () => {
  const base = { action: 'git', instance: 'dev-1', home, context: '/Users/me/work' };
  for (const server of ['Bad Id', '--dir', '', 7]) assert.equal((await cliInstanceGit(cli.bin, { ...base, server }, { exec: assert.fail })).error.code, 'E_BAD_ARGS');
});

test('a remote instance\'s pull request stays unavailable (the forge reads this machine\'s repositories only)', async () => {
  const service = createForgeBoundary({ run: assert.fail, discover: assert.fail, invokeGit: assert.fail });
  const result = await service.pull({ selector, observationKey: 'd'.repeat(64) }, () => context());
  assert.equal(result.reason.code, 'unsupported-remote-operation');
});
