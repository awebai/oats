export const cli = { ok: true, bin: '/native/gh', version: '2.81.0', stamp: '1:2:3:4', profile: 'd'.repeat(64) };
export const oats = { ok: true, bin: '/native/oats', version: '0.24.7' };
export const instance = { instance: 'dev-1', agent: 'dev', agentsRoot: '/team/agents', home: '/team/agents/dev/instances/dev-1' };
export const context = { cli: oats, workspace: { id: 'team', scope: '/team' }, instances: [instance] };
export const target = { ...instance, workspace: 'team', server: null };
export const selector = { instance: instance.instance, agent: instance.agent, agentsRoot: instance.agentsRoot, server: null };
export const state = () => ({ instanceGitApi: 1, instance: instance.instance, agent: instance.agent, home: instance.home, workMode: 'worktree',
  observation: { revision: 'a'.repeat(40), indexRevision: 'b'.repeat(40), branch: 'feat/a', worktree: `${instance.home}/work`, detached: false, unborn: false, at: '2026-09-22T00:00:00Z' },
  remote: { name: 'origin', url: 'https://userinfo:PRIVATE@github.com/owner/repo.git', host: 'github.com', path: 'owner/repo', source: 'origin' },
  recorded: { branch: 'feat/a', repo: '/repo', drift: false }, upstream: { ref: null, ahead: null, behind: null },
  base: { ref: null, source: null, mergeBase: null, ahead: null, behind: null }, summary: { changed: 0, renamed: 0, copied: 0, unmerged: 0, untracked: 0 }, files: [], notes: [] });
export const envelope = result => ({ schemaVersion: 1, ok: true, result });
export const pr = () => ({ number: 42, title: 'A real PR', state: 'OPEN', isDraft: true, baseRefName: 'main', headRefName: 'feat/a',
  url: 'https://github.com/owner/repo/pull/42', reviewDecision: 'REVIEW_REQUIRED', statusCheckRollup: [], updatedAt: '2026-09-22T00:00:00Z' });
export const status = (host = 'github.com', login = 'operator', state = 'success', category = null) => [{ host, accounts: [{ host, login, state, category, active: true }] }];
export const output = (value, exitCode = 0, stderr = '') => ({ ok: true, exitCode, stdout: typeof value === 'string' ? value : JSON.stringify(value), stderr });
export const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
export const tick = () => new Promise(resolve => setImmediate(resolve));
