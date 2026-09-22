// Inert adapter/admission tests. No HTTP route, CLI, Git or native app is run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cliInstanceGit } from '../cli-adapter.mjs';
import { createInstanceGitBoundary } from '../server/instance-git.mjs';
const rev = 'a'.repeat(40), idx = 'b'.repeat(40), id = 'c'.repeat(24);
const cli = { ok: true, bin: '/installed/oats', version: '0.24.7' };
const workspace = { id: '/team', scope: '/server scope; $(literal)' };
const instance = { instance: 'dev-1', agent: 'dev', agentsRoot: '/team/agents', home: '/team/agents/dev/instances/dev-1' };
const options = { cli, workspace, instances: [instance] };
const selector = { instance: instance.instance, agent: instance.agent, agentsRoot: instance.agentsRoot, server: null };
const observe = { action: 'git', selector }, patch = { action: 'diff', selector, fileId: id, revision: rev, indexRevision: idx };
const observation = () => ({ revision: rev, indexRevision: idx, at: '2026-09-22T00:00:00.000Z', worktree: `${instance.home}/work`, branch: 'main', detached: false, unborn: false });
const file = () => ({ id, kind: 'changed', xy: '.M', submodule: false, path: 'file.txt', origPath: null });
const state = () => ({ instanceGitApi: 1, instance: instance.instance, agent: instance.agent, home: instance.home, workMode: 'worktree', observation: observation(),
  recorded: { branch: 'main', repo: '/repo', drift: false }, upstream: { ref: null, ahead: null, behind: null }, base: { ref: null, source: null, mergeBase: null, ahead: null, behind: null },
  summary: { changed: 1, renamed: 0, copied: 0, unmerged: 0, untracked: 0 }, files: [file()], notes: [] });
const diff = () => ({ instanceGitApi: 1, observation: observation(), file: file(), against: rev, binary: false, bytes: 2, truncated: false, limit: 262144, patch: '+x',
  readOnly: { helpers: 'disabled', optionalLocks: 'off', objectsWritten: 0 } });
const envelope = result => ({ schemaVersion: 1, ok: true, result });
const failure = (code, details) => ({ schemaVersion: 1, ok: false, error: { code, message: 'SECRET raw child diagnostic', details } });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(r => setImmediate(r));
function unavailable(value, code) {
  assert.equal(value.status, code === 'E_STALE_OBSERVATION' ? 'stale' : 'unavailable'); assert.equal(value.data, null);
  assert.equal(value.reason.code, code); assert.doesNotMatch(JSON.stringify(value), /SECRET/);
}

test('adapter fixes argv/cwd, forwards both opaque revisions, bounds execution and never uses a shell', async () => {
  for (const action of ['git', 'diff']) {
    const args = { action, instance: instance.instance, home: instance.home, context: workspace.scope, ...(action === 'diff' ? { fileId: id, revision: rev, indexRevision: idx } : {}) };
    const expected = ['instance', action, 'dev-1', '--dir', workspace.scope, '--home', instance.home,
      ...(action === 'diff' ? ['--file', id, '--revision', rev, '--index-revision', idx] : []), '--json'];
    const got = await cliInstanceGit(cli.bin, args, { timeout: 60000, exec(bin, argv, opts, done) {
      assert.equal(bin, cli.bin); assert.deepEqual(argv, expected); assert.equal(opts.cwd, workspace.scope); assert.equal(opts.shell, false);
      assert.equal(opts.timeout, 15000); assert.equal(opts.maxBuffer, 4 * 1024 * 1024); assert.equal(Object.hasOwn(opts, 'env'), false);
      done(null, JSON.stringify(envelope(action === 'diff' ? diff() : state())));
    } });
    assert.equal(got.ok, true);
  }
});

test('adapter rejects unknown options, path-as-file, missing index revision and option-shaped names without execution', async () => {
  const base = { action: 'git', instance: 'dev-1', home: instance.home, context: workspace.scope };
  const inputs = [null, [], {}, { ...base, instance: '--home' }, { ...base, home: '--dir' }, { ...base, context: '/bad\0cwd' },
    ...['argv', 'server', 'env', 'bin', 'localCwd', 'fileId', 'revision'].map(k => ({ ...base, [k]: 'forbidden' })),
    { ...base, action: 'diff', fileId: '../file.txt', revision: rev, indexRevision: idx }, { ...base, action: 'diff', fileId: id, revision: rev }];
  for (const input of inputs) assert.equal((await cliInstanceGit(cli.bin, input, { exec: assert.fail })).error.code, 'E_BAD_ARGS');
  assert.equal((await cliInstanceGit('oats', base, { exec: assert.fail })).error.code, 'E_BAD_ARGS');
});

test('adapter failures resolve sanitized codes; nonzero success is refused; stale preserves only validated observation details', async () => {
  const args = { action: 'diff', instance: 'dev-1', home: instance.home, context: workspace.scope, fileId: id, revision: rev, indexRevision: idx };
  for (const [exec, code] of [
    [(_b, _a, _o, done) => done(new Error('SECRET'), JSON.stringify(envelope(diff()))), 'E_CLI_FAILED'],
    [(_b, _a, _o, done) => done({ killed: true }, ''), 'E_CLI_TIMEOUT'],
    [(_b, _a, _o, done) => done({ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }, ''), 'E_CLI_OUTPUT_LIMIT'],
    [(_b, _a, _o, done) => done(null, 'SECRET not JSON'), 'E_CLI_PROTOCOL'],
    [() => { throw new Error('SECRET spawn'); }, 'E_CLI_FAILED'],
    [(_b, _a, _o, done) => done(new Error('exit1'), JSON.stringify(failure('E_NO_WORKTREE'))), 'E_NO_WORKTREE'],
    [(_b, _a, _o, done) => done(new Error('exit1'), JSON.stringify(failure('E_STALE_OBSERVATION', { observation: { ...observation(), raw: 'SECRET' }, stack: 'SECRET' }))), 'E_STALE_OBSERVATION'],
  ]) {
    const result = await cliInstanceGit(cli.bin, args, { exec }); assert.equal(result.ok, false); assert.equal(result.error.code, code);
    assert.doesNotMatch(JSON.stringify(result), /SECRET/);
    if (code === 'E_STALE_OBSERVATION') assert.deepEqual(result.error.details, { observation: observation() });
  }
});

test('server roster owns home and context; tuple distinguishes same-root same-name souls', async () => {
  let calls = 0;
  const read = createInstanceGitBoundary({ invoke: async (bin, args) => {
    calls++; assert.equal(bin, cli.bin); assert.deepEqual(args, { action: 'git', instance: 'dev-1', home: instance.home, context: workspace.scope }); return envelope(state());
  } });
  const twin = { ...instance, agent: 'ops', home: '/team/agents/ops/instances/dev-1' };
  const result = await read(observe, { ...options, instances: [twin, instance] });
  assert.equal(result.status, 'available'); assert.equal(result.target.home, instance.home); assert.equal(result.target.workspace, workspace.id); assert.equal(calls, 1);
  assert.equal(result.data.upstream.ahead, null); assert.equal(result.data.base.behind, null);
});

test('request rejects home/cwd/path/bin/env/argv and malformed selectors before any invocation', async () => {
  const read = createInstanceGitBoundary({ invoke: assert.fail });
  for (const key of ['home', 'cwd', 'context', 'worktree', 'repo', 'path', 'bin', 'env', 'argv', 'ws']) {
    unavailable(await read({ ...observe, [key]: 'foreign' }, options), 'E_BAD_ARGS');
    unavailable(await read({ ...observe, selector: { ...selector, [key]: 'foreign' } }, options), 'E_BAD_ARGS');
  }
  for (const body of [null, [], {}, { action: 'other', selector }, { ...observe, selector: null }, { ...observe, fileId: id },
    { ...observe, selector: { ...selector, agent: undefined } }, { ...observe, selector: { ...selector, agentsRoot: 'relative' } },
    { ...patch, fileId: '/path' }, { ...patch, revision: 'HEAD' }, { ...patch, indexRevision: undefined }]) unavailable(await read(body, options), 'E_BAD_ARGS');
});

test('unknown workspace, root, host, duplicate roster rows and malformed server homes never execute', async () => {
  const read = createInstanceGitBoundary({ invoke: assert.fail });
  unavailable(await read(observe, { ...options, workspace: null }), 'E_WORKSPACE_UNKNOWN');
  unavailable(await read({ ...observe, selector: { ...selector, agentsRoot: '/foreign/agents' } }, options), 'E_SESSION_UNKNOWN');
  unavailable(await read({ ...observe, selector: { ...selector, server: 'foreign-host' } }, options), 'E_SESSION_UNKNOWN');
  unavailable(await read(observe, { ...options, instances: [instance, instance] }), 'E_AMBIGUOUS_INSTANCE');
  for (const home of [undefined, 'relative', '/another-instance', '/bad\0dev-1']) unavailable(await read(observe, { ...options, instances: [{ ...instance, home }] }), 'E_HOME_MISMATCH');
});

test('remote workspaces and remote roster records are explicitly unavailable, never local fallback', async () => {
  const read = createInstanceGitBoundary({ invoke: assert.fail });
  for (const ws of [{ ...workspace, remote: true }, { ...workspace, server: 'host-a' }]) unavailable(await read(observe, { ...options, workspace: ws }), 'unsupported-remote-operation');
  unavailable(await read(observe, { ...options, instances: [{ ...instance, remote: true }] }), 'unsupported-remote-operation');
  unavailable(await read({ ...observe, selector: { ...selector, server: 'host-a' } }, { ...options, instances: [{ ...instance, server: 'host-a' }] }), 'unsupported-remote-operation');
});

test('outer compatibility and released0.24.7 floor precede invocation; command unknown stays unavailable', async () => {
  const read = createInstanceGitBoundary({ invoke: assert.fail });
  for (const c of [null, { ...cli, ok: false }, { ...cli, ok: 'true' }, { ...cli, bin: 'oats' }]) unavailable(await read(observe, { ...options, cli: c }), 'cli-unavailable');
  for (const version of [undefined, 'bad', '0.24.6', '0.24.7-rc.1']) unavailable(await read(observe, { ...options, cli: { ...cli, version } }), 'cli-no-instance-git');
  const good = createInstanceGitBoundary({ invoke: async () => envelope(state()) });
  for (const version of ['0.24.7', '0.24.7+local']) assert.equal((await good(observe, { ...options, cli: { ...cli, version } })).status, 'available');
  const missing = createInstanceGitBoundary({ invoke: async () => failure('E_USAGE') }); unavailable(await missing(observe, options), 'E_USAGE');
});

for (const outcome of ['success', 'reject']) test(`identical flights coalesce; ${outcome} releases capacity; no persistent cache`, async () => {
  const pending = deferred(); let calls = 0;
  const read = createInstanceGitBoundary({ invoke: () => { calls++; return calls === 1 ? pending.promise : envelope(state()); } });
  const reads = Array.from({ length: 8 }, () => read(observe, options)); await tick(); assert.equal(calls, 1);
  if (outcome === 'success') pending.resolve(envelope(state())); else pending.reject(new Error('SECRET'));
  const all = await Promise.all(reads); assert.ok(all.every(r => r.status === (outcome === 'success' ? 'available' : 'unavailable')));
  await read(observe, options); assert.equal(calls, 2);
});

test('four distinct flights cap across invokers; IDs, revisions and CLI identities are coalescing keys', async () => {
  const pending = deferred(); let calls = 0;
  const invoke = () => { calls++; return pending.promise; }, other = () => { calls++; return pending.promise; };
  const read = createInstanceGitBoundary({ invoke });
  const reads = [read(observe, options), read(patch, options), read({ ...patch, indexRevision: 'd'.repeat(40) }, options), read(observe, { ...options, invoke: other })];
  const duplicate = read(patch, options); await tick(); assert.equal(calls, 4);
  unavailable(await read(observe, { ...options, cli: { ...cli, bin: '/other/oats' } }), 'E_GIT_BUSY');
  pending.resolve(failure('E_NO_WORKTREE')); await Promise.all([...reads, duplicate]);
  const result = await read(observe, { ...options, invoke: async () => envelope(state()) }); assert.equal(result.status, 'available');
});

test('responses validate version, exact home/instance/agent, summary and hardened diff id/revisions', async () => {
  for (const mutate of [s => { s.instanceGitApi = 2; }, s => { s.home = '/foreign'; }, s => { s.agent = 'other'; }, s => { s.instance = 'other-1'; }, s => { s.files = []; }]) {
    const s = state(); mutate(s); const read = createInstanceGitBoundary({ invoke: async () => envelope(s) }); unavailable(await read(observe, options), 'E_CLI_PROTOCOL');
  }
  const read = createInstanceGitBoundary({ invoke: async (_b, args) => { assert.equal(args.fileId, id); assert.equal(args.indexRevision, idx); return envelope(diff()); } });
  assert.equal((await read(patch, options)).status, 'available');
  for (const mutate of [d => { d.file.id = 'd'.repeat(24); }, d => { d.observation.revision = 'e'.repeat(40); }, d => { d.against = 'HEAD'; }, d => { delete d.readOnly; }, d => { d.patch = 'x'.repeat(262145); d.bytes = 262145; }]) {
    const d = diff(); mutate(d); const bad = createInstanceGitBoundary({ invoke: async () => envelope(d) }); unavailable(await bad(patch, options), 'E_CLI_PROTOCOL');
  }
});

test('stale details are validated/projected and free-form errors never cross even an injected boundary', async () => {
  for (const details of [{ observation: { ...observation(), secret: 'SECRET' }, secret: 'SECRET' }, { observation: { revision: 'SECRET' } }, undefined]) {
    const read = createInstanceGitBoundary({ invoke: async () => failure('E_STALE_OBSERVATION', details) });
    const result = await read(patch, options); unavailable(result, 'E_STALE_OBSERVATION');
    assert.deepEqual(result.reason.observation, details?.observation?.indexRevision ? observation() : undefined);
  }
  for (const code of ['E_GIT_FAILED', 'unsupported-action', 'SECRET']) {
    const read = createInstanceGitBoundary({ invoke: async () => failure(code, { secret: 'SECRET' }) });
    unavailable(await read(observe, options), code === 'SECRET' ? 'E_CLI_FAILED' : code);
  }
});
