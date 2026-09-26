// W6 (design: "Git & GitHub 2"): the tab counts the pull request's unresolved review
// threads, as the forge read reports them (#241); unknown, none, or another instance's
// read shows nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createContextPanel, contextPanelCSS } from '../renderer/context-panel.mjs';
import { createInstanceGitPanel } from '../renderer/instance-git.mjs';
import { gitTargetKey } from '../renderer/instance-git-contract.mjs';
import { pullRequest } from '../renderer/forge-contract.mjs';
import { ghUnresolvedThreads } from '../forge-cli.mjs';
import { cli, output } from './helpers/forge-fixture.mjs';

const HOME = '/team/agents/dev/instances/dev-1';
const instance = (extra = {}) => ({ instance: 'dev-1', agent: 'dev', agentsRoot: '/team/agents', home: HOME, running: true, ...extra });

function fixture(t) {
  const dom = new JSDOM('<!doctype html><body><aside id="context-panel"></aside></body>'), document = dom.window.document;
  const style = document.createElement('style'); style.textContent = contextPanelCSS; document.head.append(style);
  let hooks = null, gen = 0, onConn = null;
  const panel = createContextPanel({ document, root: document.getElementById('context-panel'), connectionGeneration: () => gen,
    subscribeConnections: fn => { onConn = fn; return () => {}; },
    createGitPanel: (_parent, focus) => { hooks = focus; return { update() {}, dispose() {} }; } });
  t.after(() => { panel.dispose(); dom.window.close(); });
  const tab = () => document.querySelector('[data-context-tab="git"]'), rail = () => document.querySelector('[data-context-rail="git"]');
  // The identity the panel tags its own summaries with (the Git panel echoes it back).
  const identity = inst => JSON.stringify(['A', inst.home, inst.home, inst.agent, inst.agentsRoot, null, inst.createdAt ?? null]);
  return { panel, tab, rail, hooks: () => hooks, identity, bump: () => { gen++; onConn(); }, gen: () => gen,
    select: inst => panel.setContext({ workspace: 'A', instance: inst, key: inst.home }) };
}

test('the tab shows the count beside its name, and says it in words; unknown or none shows nothing', t => {
  const u = fixture(t); u.select(instance());
  const report = n => u.hooks().onPullRequest({ identity: u.identity(instance()), connection: u.gen(), unresolvedThreads: n });
  report(2);
  assert.equal(u.tab().querySelector('.context-panel-tab-count').textContent, '2');
  assert.equal(u.tab().getAttribute('aria-label'), 'Git & GitHub, 2 unresolved review threads');
  assert.match(u.rail().getAttribute('aria-label'), /2 unresolved review threads$/, 'the collapsed rail says it too');
  for (const n of [null, 0]) {
    report(n);
    assert.equal(u.tab().querySelector('.context-panel-tab-count').textContent, ''); assert.equal(u.tab().hasAttribute('aria-label'), false);
  }
  report(1); assert.equal(u.tab().getAttribute('aria-label'), 'Git & GitHub, 1 unresolved review thread');
  u.hooks().onPullRequest(null); assert.equal(u.tab().querySelector('.context-panel-tab-count').textContent, '', 'no PR painted: no badge');
});

test('another instance\'s read, a new selection or a connection change never keeps a stale badge', t => {
  const u = fixture(t); u.select(instance());
  u.hooks().onPullRequest({ identity: u.identity(instance({ home: '/other/home' })), connection: u.gen(), unresolvedThreads: 3 });
  assert.equal(u.tab().querySelector('.context-panel-tab-count').textContent, '', 'a read for another instance');
  u.hooks().onPullRequest({ identity: u.identity(instance()), connection: u.gen(), unresolvedThreads: 3 });
  assert.equal(u.tab().querySelector('.context-panel-tab-count').textContent, '3');
  u.bump(); assert.equal(u.tab().querySelector('.context-panel-tab-count').textContent, '', 'connection changed');
  u.hooks().onPullRequest({ identity: u.identity(instance()), connection: u.gen(), unresolvedThreads: 3 });
  u.select(instance({ home: '/team/agents/dev/instances/dev-2', instance: 'dev-2' }));
  assert.equal(u.tab().querySelector('.context-panel-tab-count').textContent, '', 'another instance selected');
});

test('the Git panel reports the painted PR\'s threads (the engineer\'s real cli/cli read: 2), and null when the PR clears', async t => {
  const w6 = name => JSON.parse(readFileSync(new URL(`./fixtures/forge-w6/${name}.json`, import.meta.url), 'utf8'));
  const raw = w6('pr-14430'), branch = raw.headRefName;
  const unresolvedThreads = await ghUnresolvedThreads(cli, { host: 'github.com', path: 'cli/cli', number: 14430 }, async () => output(w6('threads-14430')));
  const data = { ...pullRequest(raw, { host: 'github.com', path: 'cli/cli', branch }), unresolvedThreads };
  const target = { workspace: '/team', instance: 'dev-1', agent: 'dev', agentsRoot: '/team/agents', home: HOME, server: null };
  const oid = 'a'.repeat(40), key = 'e'.repeat(64);
  const git = { instanceGitApi: 1, instance: 'dev-1', agent: 'dev', home: HOME, workMode: 'worktree',
    observation: { revision: oid, indexRevision: 'b'.repeat(40), at: '2026-09-26T00:00:00.000Z', worktree: '/fixture/work', branch, detached: false, unborn: false },
    recorded: { branch, repo: '/fixture/repo', drift: false }, upstream: { ref: null, ahead: null, behind: null },
    base: { ref: null, source: null, mergeBase: null, ahead: null, behind: null }, summary: { changed: 0, renamed: 0, copied: 0, unmerged: 0, untracked: 0 }, files: [], notes: [] };
  const dom = new JSDOM('<!doctype html><body><aside></aside></body>'), host = dom.window.document.querySelector('aside'), seen = [];
  const view = createInstanceGitPanel(host, { onPullRequest: s => seen.push(s),
    request: () => ({ instanceGitApi: 1, minimumVersion: '0.24.7', status: 'available', target, data: git, reason: null, observationKey: key }),
    requestForge: async () => ({ forgeApi: 1, status: 'available', target, observation: { key, branch, revision: oid }, host: 'github.com', repository: 'cli/cli', data, reason: null }) });
  t.after(() => { view.dispose(); dom.window.close(); });
  await view.update({ active: true, workspace: '/team', instance: target, key: gitTargetKey(target) });
  for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
  const last = seen.at(-1);
  assert.equal(unresolvedThreads, 2); assert.equal(last.unresolvedThreads, 2);
  assert.equal(last.identity, JSON.stringify(['/team', gitTargetKey(target), HOME, 'dev', '/team/agents', null, null]), 'tagged like onObservation');
  await view.refresh(); assert.equal(seen.includes(null), true, 'a new read clears the PR first');
});
