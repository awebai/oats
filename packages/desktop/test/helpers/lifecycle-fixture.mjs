export const cli = { ok: true, bin: '/installed/oats', version: '0.24.6', lifecycleApi: 1, features: ['lifecycle-plans', 'retire-retention', 'retire-home'] };
export const instance = { instance: 'dev-1', agent: 'dev', agentsRoot: '/team/agents', home: '/team/agents/dev/instances/dev-1' };
export const target = { ...instance, workspace: 'team', server: null };
export const selector = { instance: instance.instance, agent: instance.agent, agentsRoot: instance.agentsRoot, server: null };
export const context = () => ({ cli: structuredClone(cli), workspace: { id: 'team', scope: '/team' }, instances: [structuredClone(instance)] });
export const session = () => ({ state: 'unknown', present: true, established: true, backend: 'tmux' });
export const work = () => ({ observed: true, revision: 'a'.repeat(40), branch: 'feat/work', detached: false, drift: true, changed: 2, untracked: 1,
  upstream: { ref: null, ahead: null, behind: null }, base: { ref: null, ahead: null, behind: null }, remote: { host: 'github.com', path: 'owner/repo' } });
export const stopPlan = (recursive = true) => ({ lifecycleApi: 1, action: 'stop', instance: instance.instance, home: instance.home,
  recursive, at: '2026-09-22T00:00:00Z', planRevision: 'a'.repeat(24), notes: [], skipped: [], ambiguous: [], targets: [{
    ...instance, depth: 0, session: session(), work: work(), workMode: 'worktree', launched: true, retiring: false, stopPending: false, midTask: true }] });
export const retirePlan = () => ({ lifecycleApi: 1, action: 'retire', instance: instance.instance, home: instance.home,
  at: '2026-09-22T00:00:00Z', planRevision: 'b'.repeat(24), notes: [],
  facts: { session: session(), work: work(), workMode: 'worktree', repo: '/repo', recordedBranch: 'agents/dev-1', children: [], ambiguous: [], pullRequest: 'unknown' },
  defaults: { retainWorktree: true, deleteBranch: false, stopChildren: true, retainChildren: true } });
export const options = operation => operation === 'stop' ? { recursive: true } : { discardWorktree: false, deleteBranch: false };
export const request = (operation = 'stop') => ({ action: 'plan', operation, selector: structuredClone(selector), options: options(operation) });
export const envelope = result => ({ schemaVersion: 1, ok: true, result });
export const stopReceipt = (args, plan = stopPlan()) => ({ lifecycleApi: 1, action: 'stop', instance: plan.instance, home: plan.home,
  planRevision: args.revision, idempotencyKey: args.key, at: '2026-09-22T00:01:00Z', replayed: false, ok: true,
  retained: ['home', 'work', 'transcript', 'launch'], results: plan.targets.map(t => ({ instance: t.instance, home: t.home, ok: true, stopped: true, alreadyIdle: false, state: 'stopped' })) });
export const retireReceipt = args => ({ retired: instance.instance, planRevision: args.revision, idempotencyKey: args.key, replayed: false,
  childrenStopped: [], removedDir: true, worktreeRemoved: false, branchDeleted: false,
  retention: { worktree: 'retained', movedTo: '/team/.agents/worktrees/repo/feat-work', branch: 'feat/work', recordedBranch: 'agents/dev-1', detachedAt: null } });
export const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
export const tick = () => new Promise(resolve => setImmediate(resolve));
