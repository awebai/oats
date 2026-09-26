// W6 Pull request (design) from real `gh pr view --json <PR_FIELDS>` captures of this
// repository, projected by the server's own pullRequest(): #239 (open, checks running)
// and #237 (merged, one check failed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createForgePrPanel, checkRows } from '../renderer/forge-pr.mjs';
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
    meta: li.querySelector('.forge-check-meta')?.textContent ?? '', mark: li.querySelector('.forge-mark').textContent, label: li.getAttribute('aria-label') }));
  return { raw, data, root, rows, opened };
}

test('#239, open with its checks running: the title, "#239 · open", one row per running check, and Open on GitHub', async t => {
  const u = await card(t, 239);
  assert.equal(u.root.querySelector('.forge-title').textContent, u.raw.title);
  assert.equal(u.root.querySelector('.forge-sub').textContent, '#239 · open');
  assert.match(u.root.querySelector('.forge-sub').title, /^main ← agents\/ux-designer-w6-git · updated /);
  assert.equal(u.rows.length, u.raw.statusCheckRollup.length);
  assert.ok(u.rows.every(r => r.outcome === 'pending' && r.mark === '◔' && r.meta === 'in progress'));
  assert.equal(u.root.querySelector('.forge-review'), null, 'no review decision reported: no Review row');
  u.root.querySelector('button.forge-open').click(); assert.deepEqual(u.opened, [u.raw.url]);
  assert.equal(u.root.querySelector('button.forge-open').getAttribute('aria-label'), 'Open pull request #239 on GitHub');
});

test('#237, merged with one failed check: the failure first, then the passing checks as one row', async t => {
  const u = await card(t, 237);
  assert.equal(u.root.querySelector('.forge-sub').textContent, '#237 · merged');
  const failed = u.raw.statusCheckRollup.filter(c => c.conclusion === 'FAILURE'), passed = u.raw.statusCheckRollup.filter(c => c.conclusion === 'SUCCESS');
  assert.deepEqual(u.rows[0], { outcome: 'fail', name: failed[0].name, meta: 'failure', mark: '✕', label: `${failed[0].name}: failure` });
  assert.deepEqual(u.rows.slice(1).map(r => [r.outcome, r.name, r.label]), [['pass', `${passed.length} checks passed`, `${passed.length} checks passed: passed`]]);
  assert.equal(u.root.querySelectorAll('.forge-check')[1].title, passed.map(c => c.name).join('\n'), 'the names are in its title');
});

test('checkRows: failing, then running, then passing (named when three or fewer), then neutral; the review row follows', () => {
  const c = (name, outcome, conclusion) => ({ name, outcome, conclusion });
  assert.deepEqual(checkRows([c('lint', 'pass', 'SUCCESS'), c('e2e', 'pending', 'IN_PROGRESS'), c('docs', 'neutral', 'SKIPPED'), c('build', 'pass', 'SUCCESS'), c('unit', 'fail', 'FAILURE')]),
    [{ outcome: 'fail', name: 'unit', meta: 'failure' }, { outcome: 'pending', name: 'e2e', meta: 'in progress' },
     { outcome: 'pass', name: 'lint · build', meta: '' }, { outcome: 'neutral', name: 'docs', meta: 'skipped' }]);
});
