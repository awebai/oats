import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forgeEnvironment, ghVersion, discoverGh, ghStatus, ghLogin, ghPullRequest, createGhRunner, STATUS_PROJECTION } from '../forge-cli.mjs';
import { reportedCheck, pullRequest, PR_FIELDS } from '../renderer/forge-contract.mjs';
import { cli, status, pr, output, tick } from './helpers/forge-fixture.mjs';
const route = { host: 'github.com', path: 'owner/repo', branch: 'feat/a' };
const secret = `ghp_${'X'.repeat(36)}`;

test('gh environment is an allowlist: native profile survives, credentials and command/debug overrides do not', () => {
  const env = forgeEnvironment({ HOME: '/home/operator', PATH: '/usr/bin', GH_CONFIG_DIR: '/native-gh',
    GH_TOKEN: secret, GITHUB_TOKEN: secret, GH_ENTERPRISE_TOKEN: secret, GITHUB_ENTERPRISE_TOKEN: secret,
    GH_HOST: 'evil', GH_REPO: 'evil/repo', GH_DEBUG: 'api', BROWSER: 'evil', GH_BROWSER: 'evil', PAGER: 'evil', GH_PAGER: 'evil',
    LD_PRELOAD: 'evil', NODE_OPTIONS: 'evil', GIT_CONFIG_GLOBAL: 'evil', GH_FORCE_TTY: '1' });
  assert.equal(env.HOME, '/home/operator'); assert.equal(env.GH_CONFIG_DIR, '/native-gh');
  assert.equal(env.GH_PROMPT_DISABLED, '1'); assert.doesNotMatch(JSON.stringify(env), /evil|ghp_/);
  assert.equal(forgeEnvironment(env, true).GH_PROMPT_DISABLED, undefined);
});
test('gh version gate is released2.81 through major2 only', () => {
  for (const v of ['gh version 2.81.0 (2025-10-01)\nhttps://github.com/cli/cli/releases', 'gh version 2.99.3']) assert.ok(ghVersion(v));
  for (const v of ['', 'gh version 2.80.9', 'gh version 3.0.0', 'gh version 2.81.0-rc.1', 'other gh version 2.81.0', 'gh version 2.81.0 extra']) assert.equal(ghVersion(v), null);
});
test('locator probes absolute candidates and rejects nonzero plausible versions without exposing diagnostics', async () => {
  const discover = run => discoverGh({ run, candidates: ['/fake/gh'], executable: bin => ({ bin, stamp: '1:2:3:4' }), env: { HOME: '/home' } });
  assert.equal((await discover(async (bin, args, opts) => { assert.equal(bin, '/fake/gh'); assert.deepEqual(args, ['--version']); assert.equal(opts.timeout, 2000); return output('gh version 2.81.0'); })).ok, true);
  for (const value of [output('gh version 2.81.0', 1, secret), output(secret), { ok: false, code: 'E_GH_TIMEOUT' }]) {
    const result = await discover(async () => value); assert.equal(result.ok, false); assert.doesNotMatch(JSON.stringify(result), /ghp_/);
  }
  assert.equal((await discoverGh({ candidates: [], run: assert.fail })).code, 'E_GH_MISSING');
});
test('status uses a literal safe projection, exit0 is not connected, and secret-shaped stderr is discarded', async () => {
  for (const [value, expected] of [[status(), 'candidate'], [status('github.com', 'operator', 'error', 'auth'), 'not-connected'],
    [status('github.com', 'operator', 'error', 'unavailable'), 'unavailable'], [status('github.com', 'operator', 'timeout'), 'unavailable']]) {
    const result = await ghStatus(cli, async (bin, args) => {
      assert.equal(bin, cli.bin); assert.deepEqual(args, ['auth', 'status', '--active', '--json', 'hosts', '--jq', STATUS_PROJECTION]);
      assert.ok(!args.includes('--show-token')); return output(value, 0, secret);
    });
    assert.equal(result.hosts.get('github.com').status, expected); assert.doesNotMatch(JSON.stringify([...result.hosts]), /ghp_/);
  }
  assert.equal((await ghStatus(cli, async () => output([]))).hosts.size, 0);
});
test('closed status/login parser refuses extra token fields, multiple active records, nonzero and wrong identity', async () => {
  const token = status(); token[0].accounts[0].token = secret;
  const multi = status(); multi[0].accounts.push({ ...multi[0].accounts[0] });
  for (const value of [output(token), output(multi), output(secret), output(status(), 1, secret), output(status('bad/path'))]) {
    const result = await ghStatus(cli, async () => value); assert.equal(result.ok, false); assert.doesNotMatch(JSON.stringify(result), /ghp_/);
  }
  assert.equal((await ghLogin(cli, 'github.com', 'operator', async (_bin, args) => {
    assert.deepEqual(args, ['api', 'user', '--hostname', 'github.com', '--jq', '.login']); return output('operator\n', 0, secret);
  })).login, 'operator');
  for (const value of [output('another'), output(secret), output('operator', 1, secret)]) assert.equal((await ghLogin(cli, 'github.com', 'operator', async () => value)).ok, false);
});
test('PR argv is explicit-host and end-of-options; exact no-PR diagnostic alone is absence', async () => {
  const got = await ghPullRequest(cli, route, async (_bin, args) => {
    assert.deepEqual(args, ['pr', 'view', '--repo', 'github.com/owner/repo', '--json', PR_FIELDS, '--', 'feat/a']); return output(pr(), 0, secret);
  });
  assert.equal(got.data.number, 42);
  const absent = 'no pull requests found for branch "feat/a"';
  assert.deepEqual(await ghPullRequest(cli, route, async () => output('', 1, absent)), { ok: true, data: null });
  for (const stderr of [absent + '\n' + secret, 'not authorized', 'no pull requests found for branch "other"', secret]) {
    const result = await ghPullRequest(cli, route, async () => output('', 1, stderr)); assert.equal(result.ok, false); assert.doesNotMatch(JSON.stringify(result), /ghp_/);
  }
});
test('PR projection refuses wrong head, credentials/foreign URLs and malformed unions; neutral/skipped are not passes', () => {
  for (const conclusion of ['NEUTRAL', 'SKIPPED']) assert.equal(reportedCheck({ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion }).outcome, 'neutral');
  assert.equal(reportedCheck({ __typename: 'StatusContext', context: 'ci', state: 'PENDING' }).outcome, 'pending');
  assert.equal(reportedCheck({ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'MADE_UP' }), null);
  for (const delta of [{ headRefName: 'other' }, { url: 'https://evil/owner/repo/pull/42' }, { url: 'https://user:secret@github.com/owner/repo/pull/42' },
    { url: 'https://github.com/owner/repo/pull/42?token=private' }, { url: 'https://github.com/other/repo/pull/42' }, { title: secret }]) assert.equal(pullRequest({ ...pr(), ...delta }, route), null);
  assert.equal(pullRequest({ ...pr(), statusCheckRollup: null }, route).checks, null);
  assert.deepEqual(pullRequest(pr(), route).checks, []);
});
test('runner caps concurrent processes, output and time; shell is never used', async () => {
  const children = [];
  const run = createGhRunner({ env: { HOME: '/native' }, cwd: '/neutral', launch(bin, args, opts) {
    assert.equal(bin, '/fake/gh'); assert.equal(opts.shell, false); assert.equal(opts.cwd, '/neutral');
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.kill = () => { children.push('killed'); child.emit('close', null); };
    children.push(child); return child;
  } });
  const flights = Array.from({ length: 4 }, () => run('/fake/gh', ['--version'], { timeout: 2000 }));
  assert.equal((await run('/fake/gh', ['--version'])).code, 'E_FORGE_BUSY');
  for (const child of [...children]) child.emit('close', 0);
  assert.ok((await Promise.all(flights)).every(v => v.ok));
  const limited = run('/fake/gh', ['--version'], { limit: 2 }); children.at(-1).stdout.emit('data', 'BIG');
  assert.equal((await limited).code, 'E_FORGE_LIMIT');
  const timed = run('/fake/gh', ['--version'], { timeout: 1 }); await tick(); assert.equal((await timed).code, 'E_GH_TIMEOUT');
});
test('real inert executable can print a token-looking stderr without any token reaching the status projection', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oats-fake-gh-'));
  try {
    const binary = join(dir, 'gh');
    writeFileSync(binary, `#!${process.execPath}\nprocess.stderr.write(${JSON.stringify(secret)});process.stdout.write(${JSON.stringify(JSON.stringify(status()))});\n`, { mode: 0o700 });
    const result = await ghStatus({ ...cli, bin: binary }, createGhRunner());
    assert.equal(result.ok, true); assert.doesNotMatch(JSON.stringify([...result.hosts]), /ghp_/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
