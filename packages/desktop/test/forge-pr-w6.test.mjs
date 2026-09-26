// W6 Pull request (design) from real `gh pr view --json <PR_FIELDS>` captures of this
// repository, projected by the server's own pullRequest(): #239 (open, checks running)
// and #237 (merged, one check failed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createForgePrPanel, checkRows, checkDuration } from '../renderer/forge-pr.mjs';
import { pullRequest } from '../renderer/forge-contract.mjs';
import { target } from './helpers/forge-fixture.mjs';

const gh = n => JSON.parse(readFileSync(new URL(`./fixtures/instance-git/w6-gh-pr-${n}.json`, import.meta.url), 'utf8'));
const key = 'e'.repeat(64), revision = 'a'.repeat(40);
async function card(t, n) {
  const raw = gh(n), branch = raw.headRefName, route = { host: 'github.com', path: 'awebai/oats', branch };
  const data = pullRequest(raw, route); assert.ok(data, 'the capture passes the server projection');
  const dom = new JSDOM('<!doctype html><main></main>', { pretendToBeVisual: true }), root = dom.window.document.querySelector('main'), opened = [];
  const panel = createForgePrPanel(root, { openExternal: url => opened.push(url), request: async () => ({ forgeApi: 1, status: 'available', target,
    observation: { key, branch, revision }, host: 'github.com', repository: 'awebai/oats', data, reason: null }) });
  t.after(() => { panel.dispose(); dom.window.close(); });
  await panel.update({ target, key, branch, revision });
  const rows = [...root.querySelectorAll('.forge-check')].map(li => ({ outcome: li.dataset.outcome, name: li.querySelector('.forge-check-name').textContent,
    meta: li.querySelector('.forge-check-meta')?.textContent ?? '', mark: li.querySelector('.forge-mark').dataset.mark, label: li.getAttribute('aria-label') }));
  return { raw, data, root, rows, opened };
}

test('#239, open with its checks running: the title, "#239 · open", one row per running check, and Open on GitHub', async t => {
  const u = await card(t, 239);
  assert.equal(u.root.querySelector('.forge-title').textContent, u.raw.title);
  assert.equal(u.root.querySelector('.forge-sub').textContent, '#239 · open');
  assert.match(u.root.querySelector('.forge-sub').title, /^main ← agents\/ux-designer-w6-git · updated /);
  assert.equal(u.rows.length, u.raw.statusCheckRollup.length);
  assert.ok(u.rows.every(r => r.outcome === 'pending' && r.mark === 'pending' && r.meta === 'in progress'));
  assert.equal(u.root.querySelector('.forge-review'), null, 'no review decision reported: no Review row');
  u.root.querySelector('button.forge-open').click(); assert.deepEqual(u.opened, [u.raw.url]);
  assert.equal(u.root.querySelector('button.forge-open').getAttribute('aria-label'), 'Open pull request #239 on GitHub');
});

test('#237, merged with one failed check: the failure first, then the passing checks as one row', async t => {
  const u = await card(t, 237);
  assert.equal(u.root.querySelector('.forge-sub').textContent, '#237 · merged');
  const failed = u.raw.statusCheckRollup.filter(c => c.conclusion === 'FAILURE'), passed = u.raw.statusCheckRollup.filter(c => c.conclusion === 'SUCCESS');
  // The failure's duration comes from gh's own start and finish (#241).
  const took = checkDuration(failed[0]); assert.match(took, /^\d+(s|m|h \d+m)$/);
  assert.deepEqual(u.rows[0], { outcome: 'fail', name: failed[0].name, meta: `failure · ${took}`, mark: 'fail', label: `${failed[0].name}: failure · ${took}` });
  assert.deepEqual(u.rows.slice(1).map(r => [r.outcome, r.name, r.label]), [['pass', `${passed.length} checks passed`, `${passed.length} checks passed: passed`]]);
  assert.equal(u.root.querySelectorAll('.forge-check')[1].title, passed.map(c => c.name).join('\n'), 'the names are in its title');
});

test('checkRows: failing, then running, then passing (named when three or fewer), then neutral; the review row follows', () => {
  const c = (name, outcome, conclusion) => ({ name, outcome, conclusion });
  assert.deepEqual(checkRows([c('lint', 'pass', 'SUCCESS'), c('e2e', 'pending', 'IN_PROGRESS'), c('docs', 'neutral', 'SKIPPED'), c('build', 'pass', 'SUCCESS'), c('unit', 'fail', 'FAILURE')]),
    [{ outcome: 'fail', name: 'unit', meta: 'failure' }, { outcome: 'pending', name: 'e2e', meta: 'in progress' },
     { outcome: 'pass', name: 'lint · build', meta: '' }, { outcome: 'neutral', name: 'docs', meta: 'skipped' }]);
});

// W6 forge facts (#241), on the engineer's real reads of github.com/cli/cli (test/fixtures/forge-w6).
import { ghUnresolvedThreads } from '../forge-cli.mjs';
import { cli, output } from './helpers/forge-fixture.mjs';
const w6 = name => JSON.parse(readFileSync(new URL(`./fixtures/forge-w6/${name}.json`, import.meta.url), 'utf8'));
async function cliCard(t, n, extra = {}) {
  const raw = w6(`pr-${n}`), branch = raw.headRefName, route = { host: 'github.com', path: 'cli/cli', branch };
  const unresolvedThreads = await ghUnresolvedThreads(cli, { host: 'github.com', path: 'cli/cli', number: n }, async () => output(w6(`threads-${n}`)));
  const data = { ...pullRequest(raw, route), unresolvedThreads, ...extra };
  const dom = new JSDOM('<!doctype html><main></main>', { pretendToBeVisual: true }), root = dom.window.document.querySelector('main'), opened = [];
  const panel = createForgePrPanel(root, { openExternal: url => opened.push(url), request: async () => ({ forgeApi: 1, status: 'available', target,
    observation: { key, branch, revision }, host: 'github.com', repository: 'cli/cli', data, reason: null }) });
  t.after(() => { panel.dispose(); dom.window.close(); });
  await panel.update({ target, key, branch, revision });
  return { raw, data, root, opened, review: () => root.querySelector('.forge-review .forge-check-meta')?.textContent ?? null };
}

test('closing issues: "#N · state · closes #14495", each opening its issue; none says nothing', async t => {
  const u = await cliCard(t, 14516);
  assert.equal(u.root.querySelector('.forge-sub').textContent, `#14516 · ${u.raw.isDraft ? 'draft' : u.raw.state.toLowerCase()} · closes #14495`);
  const issue = u.root.querySelector('button.forge-issue');
  assert.equal(issue.getAttribute('aria-label'), 'Open issue #14495 on GitHub');
  issue.click(); assert.deepEqual(u.opened, ['https://github.com/cli/cli/issues/14495']);
  const none = await cliCard(t, 14430);
  assert.deepEqual(none.data.closingIssues, []); assert.doesNotMatch(none.root.querySelector('.forge-sub').textContent, /closes/);
  const unknown = await cliCard(t, 14430, { closingIssues: null }); assert.equal(unknown.root.querySelector('.forge-issue'), null);
});

test('unresolved threads on the Review row; null (unknown) and 0 say nothing', async t => {
  const u = await cliCard(t, 14430);
  assert.equal(u.data.unresolvedThreads, 2, 'the captured read: 2 of 3 threads unresolved');
  assert.match(u.review(), /(^|· )2 unresolved threads$/);
  for (const unresolvedThreads of [null, 0]) {
    const v = await cliCard(t, 14430, { unresolvedThreads });
    assert.doesNotMatch(v.root.textContent, /unresolved/);
  }
});

test('durations: only when gh reports both times and the finish is not before the start', async t => {
  const u = await cliCard(t, 14516);
  const first = u.raw.statusCheckRollup[0];
  assert.ok(Date.parse(first.completedAt) < Date.parse(first.startedAt), 'the capture has a skipped check that "finished" before it started');
  const row = [...u.root.querySelectorAll('.forge-check')].find(li => li.querySelector('.forge-check-name').textContent === first.name);
  assert.equal(row.querySelector('.forge-check-meta').textContent, 'skipped', 'no negative or invented duration');
  assert.equal(row.title, `started ${first.startedAt}\nfinished ${first.completedAt}`, 'the reported times, as-is');
  const at = s => new Date(Date.UTC(2026, 8, 26, 10, 0, s)).toISOString();
  assert.deepEqual([[0, 45], [0, 150], [0, 3900]].map(([a, b]) => checkDuration({ startedAt: at(a), completedAt: at(b) })), ['45s', '2m', '1h 5m']);
  for (const c of [{ startedAt: null, completedAt: at(5) }, { startedAt: at(5), completedAt: null }, { startedAt: at(9), completedAt: at(1) }]) assert.equal(checkDuration(c), null);
});
