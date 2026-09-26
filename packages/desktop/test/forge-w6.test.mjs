// W6 forge facts (the maintainer's items 2, 3 and 5): closing issues, unresolved review
// threads and check start/finish times, projected from real, read-only gh reads of the
// public github.com/cli/cli (test/fixtures/forge-w6, provenance.json).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pullRequest, projectedPullRequest, PR_FIELDS } from '../renderer/forge-contract.mjs';
import { ghPullRequest, ghUnresolvedThreads, REVIEW_THREADS_QUERY } from '../forge-cli.mjs';
import { cli, output } from './helpers/forge-fixture.mjs';

const fx = name => JSON.parse(readFileSync(new URL(`./fixtures/forge-w6/${name}.json`, import.meta.url), 'utf8'));
const route = raw => ({ host: 'github.com', path: 'cli/cli', branch: raw.headRefName });

test('the read asks gh for closingIssuesReferences (the captured field list)', () => {
  assert.deepEqual(fx('provenance').files['pr-14516'].argv.at(-1), PR_FIELDS);
});

test('closing issues: [{number, url}] on the same forge; check rows keep their reported start and finish', () => {
  const raw = fx('pr-14516'), pr = pullRequest(raw, route(raw));
  assert.deepEqual(pr.closingIssues, [{ number: 14495, url: 'https://github.com/cli/cli/issues/14495' }], 'no ids, no repository object');
  assert.equal(pr.checks.length, raw.statusCheckRollup.length);
  assert.deepEqual(pr.checks[0], { name: 'label-external', conclusion: 'SKIPPED', outcome: 'neutral', startedAt: '2026-09-24T23:51:58Z', completedAt: '2026-09-24T23:51:57Z' },
    'as reported, never corrected or computed');
  assert.ok(pr.checks.every(c => typeof c.startedAt === 'string' && typeof c.completedAt === 'string'));
  assert.equal(pr.unresolvedThreads, null, 'counted only by the thread read');
  const none = pullRequest(fx('pr-14430'), route(fx('pr-14430')));
  assert.deepEqual(none.closingIssues, []);
  // Not reported (an older gh, or a field gh omits) is null; a malformed or foreign reference refuses the PR like any other field.
  const { closingIssuesReferences: _c, ...older } = raw;
  assert.equal(pullRequest(older, route(raw)).closingIssues, null);
  for (const url of ['http://github.com/cli/cli/issues/14495', 'https://evil.example/cli/cli/issues/14495', 'https://github.com/cli/cli/issues/1', 'https://github.com/cli/cli/pull/14495', 'https://github.com/cli/cli/issues/14495?x=1']) {
    assert.equal(pullRequest({ ...raw, closingIssuesReferences: [{ number: 14495, url }] }, route(raw)), null, url);
  }
  const noTimes = structuredClone(raw); delete noTimes.statusCheckRollup[0].startedAt; noTimes.statusCheckRollup[0].completedAt = '0001-01-01T00:00:00Z';
  assert.deepEqual([pullRequest(noTimes, route(raw)).checks[0].startedAt, pullRequest(noTimes, route(raw)).checks[0].completedAt], [null, null], 'gh\'s zero time is not a time');
});

test('unresolved threads: one GraphQL read with typed variables and the host\'s auth; 2 of the captured 3', async () => {
  const calls = [];
  const run = async (bin, argv, opts) => { calls.push({ bin, argv, opts }); return output(fx('threads-14430')); };
  assert.equal(await ghUnresolvedThreads(cli, { host: 'github.com', path: 'cli/cli', number: 14430 }, run), 2);
  assert.deepEqual(calls[0].argv, ['api', 'graphql', '--hostname', 'github.com', '-f', `query=${REVIEW_THREADS_QUERY}`, '-F', 'owner=cli', '-F', 'name=cli', '-F', 'number=14430']);
  assert.equal(calls[0].bin, cli.bin); assert.doesNotMatch(JSON.stringify(calls), /token/i);
  assert.equal(await ghUnresolvedThreads(cli, { host: 'github.com', path: 'cli/cli', number: 14516 }, async () => output(fx('threads-14516'))), 0);
  // Anything partial or unreadable is null, never a guessed count.
  const threads = fx('threads-14430'), variant = change => { const v = structuredClone(threads); change(v.data.repository.pullRequest.reviewThreads); return async () => output(v); };
  for (const r of [variant(t => { t.pageInfo.hasNextPage = true; }), variant(t => { t.totalCount = 150; }), variant(t => { t.nodes[0].isResolved = 'no'; }),
    async () => output('not json'), async () => output('', 1, 'HTTP 401'), async () => ({ ok: false, code: 'E_GH_TIMEOUT' })]) {
    assert.equal(await ghUnresolvedThreads(cli, { host: 'github.com', path: 'cli/cli', number: 14430 }, r), null);
  }
  assert.equal(await ghUnresolvedThreads(cli, { host: 'github.com', path: '../x', number: 1 }, () => assert.fail('never run')), null);
});

test('ghPullRequest: threads only when asked (the single-PR read), and the renderer re-validation keeps every new fact', async () => {
  const raw = fx('pr-14430'), calls = [];
  const run = async (_bin, argv) => { calls.push(argv[0] === 'api' ? 'graphql' : 'pr'); return argv[0] === 'api' ? output(fx('threads-14430')) : output(raw); };
  const asked = await ghPullRequest(cli, route(raw), run, 10_000, { threads: true });
  assert.equal(asked.data.unresolvedThreads, 2); assert.deepEqual(calls, ['pr', 'graphql']);
  calls.length = 0;
  const plain = await ghPullRequest(cli, route(raw), run);
  assert.equal(plain.data.unresolvedThreads, null); assert.deepEqual(calls, ['pr'], 'the roster read never pays for threads');
  const closing = pullRequest(fx('pr-14516'), route(fx('pr-14516')));
  for (const data of [asked.data, closing]) {
    const r = { host: 'github.com', path: 'cli/cli', branch: data.headRefName };
    assert.deepEqual(projectedPullRequest(data, r), data, 'the renderer\'s re-validation round-trips the DTO');
  }
  const tampered = structuredClone(closing); tampered.checks[0].startedAt = 'yesterday';
  assert.equal(projectedPullRequest(tampered, { host: 'github.com', path: 'cli/cli', branch: closing.headRefName }), null);
  const foreign = structuredClone(closing); foreign.closingIssues[0].url = 'https://evil.example/cli/cli/issues/14495';
  assert.equal(projectedPullRequest(foreign, { host: 'github.com', path: 'cli/cli', branch: closing.headRefName }), null);
});
