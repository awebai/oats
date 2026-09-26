// W6 Git & GitHub (design): Branch and Changes from a real `oats instance git` /
// `oats instance diff` capture (the CLI's own JSON, paths under /fixture/base).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createInstanceGitPanel, instanceGitCSS, changeLetter } from '../renderer/instance-git.mjs';
import { gitTargetKey } from '../renderer/instance-git-contract.mjs';

const capture = name => JSON.parse(readFileSync(new URL(`./fixtures/instance-git/w6-${name}.json`, import.meta.url), 'utf8')).result;
const tick = () => new Promise(resolve => setImmediate(resolve));
const git = capture('git'), diff = capture('diff');
const target = { workspace: '/fixture/base/oats', instance: git.instance, agent: git.agent, agentsRoot: git.home.split(`/${git.agent}/instances/`)[0], home: git.home, server: null };
const answer = data => ({ instanceGitApi: 1, minimumVersion: '0.24.7', status: 'available', target, data, reason: null, observationKey: null });

function mount(t) {
  const dom = new JSDOM('<!doctype html><body><aside></aside></body>'), doc = dom.window.document, host = doc.querySelector('aside');
  const style = doc.createElement('style'); style.textContent = instanceGitCSS; doc.head.append(style);
  const calls = [];
  const view = createInstanceGitPanel(host, { request: (_ws, body) => { calls.push(body); return answer(body.action === 'git' ? git : diff); } });
  t.after(() => { view.dispose(); dom.window.close(); });
  return { doc, host, calls, one: s => host.querySelector(s), show: () => view.update({ active: true, workspace: target.workspace, instance: target, key: gitTargetKey(target) }) };
}

test('Branch: the branch, its distance from the default branch, the work mode, the repo and how clean it is', async t => {
  const u = mount(t); await u.show();
  const heads = [...u.host.querySelectorAll('.git-head h3')].map(h => h.textContent);
  assert.deepEqual(heads.slice(0, 2), ['Branch', 'Changes'], 'the design\'s section order');
  assert.equal(u.one('.git-head-aside').textContent, git.workMode);
  assert.equal(u.one('.git-branch').textContent, git.observation.branch);
  const { ahead, behind } = git.base;
  assert.equal(u.one('.git-ahead').textContent, `↑${ahead}${behind ? ` ↓${behind}` : ''} from main`);
  assert.equal(u.one('.git-ahead').title, `${ahead} ahead of, ${behind} behind origin/main`);
  assert.equal(u.one('.git-branch-sub').textContent, `oats · clean except ${git.files.length} files`);
  assert.match(u.one('.git-more').textContent, /No upstream branch is reported\./, 'the rest of the read sits behind Details');
  assert.equal(u.one('.git-more').open, false);
});

test('Changes: one row per file with its status letter and path; Open diff reads the first file, a row reads its own', async t => {
  const u = mount(t); await u.show();
  const rows = [...u.host.querySelectorAll('button.git-file')];
  assert.deepEqual(rows.map(r => [r.querySelector('.git-letter').textContent, r.querySelector('.git-file-path').textContent]),
    git.files.map(f => [changeLetter(f), f.path]));
  assert.ok(git.files.some(f => f.kind === 'untracked') && rows.some(r => r.querySelector('.git-letter').textContent === '?'), 'an untracked file reads "?"');
  assert.match(rows.find(r => r.querySelector('.git-letter').textContent === '?').title, /^untracked · read diff: /);
  const open = u.one('.git-changes-section .git-head button.git-link');
  assert.equal(open.textContent, 'Open diff'); open.click(); await tick();
  const first = git.files.find(f => f.id === diff.file.id);
  assert.deepEqual(u.calls.at(-1), { action: 'diff', selector: { instance: target.instance, agent: target.agent, agentsRoot: target.agentsRoot, server: null },
    fileId: git.files[0].id, revision: git.observation.revision, indexRevision: git.observation.indexRevision });
  assert.equal(first, git.files[0], 'the capture\'s diff is the first file\'s');
  assert.equal(rows[0].getAttribute('aria-pressed'), 'true');
  assert.equal(u.one('.git-diff h4').textContent, first.path); assert.ok(u.one('.git-patch').textContent.length > 0);
});

test('a clean worktree says so and offers no Open diff', async t => {
  const clean = { ...git, files: [], summary: { changed: 0, renamed: 0, copied: 0, unmerged: 0, untracked: 0 } };
  const dom = new JSDOM('<!doctype html><body><aside></aside></body>'), host = dom.window.document.querySelector('aside');
  const view = createInstanceGitPanel(host, { request: () => answer(clean) }); t.after(() => { view.dispose(); dom.window.close(); });
  await view.update({ active: true, workspace: target.workspace, instance: target, key: gitTargetKey(target) });
  assert.equal(host.querySelector('.git-branch-sub').textContent, 'oats · clean');
  assert.equal(host.querySelector('.git-changes-section .git-link').hidden, true);
  assert.match(host.querySelector('.git-files').textContent, /No changes reported in this observation\./);
});
