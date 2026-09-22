// API2 shape pinned to PR76's published DTO and stored real producer receipts.
export const cli = { ok: true, bin: '/fixture/oats', version: '0.24.9', spawnPreviewApi: 2, features: ['spawn-preview-2', 'launch-config'], runtimes: ['pi', 'claude', 'codex'], sessionBackends: ['tmux', 'herdr'], launchOptions: ['yolo'] };
export const workspace = { id: 'team', scope: '/team' };
export const soul = { name: 'dev', agentsRoot: '/team/agents', work: 'worktree' };
export const selector = { soul: soul.name, agentsRoot: soul.agentsRoot };
export const target = { workspace: 'team', context: '/team', selector };
export const anchor = { instance: 'boss-1', agent: 'boss', agentsRoot: '/team/agents', server: null };
export const context = () => ({ workspace: { ...workspace }, cli: structuredClone(cli), agents: [{ ...soul }], instances: [{ ...anchor, home: '/team/agents/boss/instances/boss-1', createdAt: 'first' }] });
export const request = choices => ({ action: 'preview', selector, choices: choices ?? {} });
export function data(t = target) {
  const decision = { instance: 'dev-1', home: '/team/agents/dev/instances/dev-1', branch: 'agents/dev-1', base: { ref: 'HEAD', oid: 'a'.repeat(40) }, revision: 'b'.repeat(24) };
  return { spawnPreviewApi: 2, preview: true, subject: { ...t.selector, dir: t.context }, decision,
    agent: t.selector.soul, ...decision, kind: 'persistent', repo: '/repo', work: 'worktree', worktree: '/team/agents/dev/instances/dev-1/work', runtime: 'claude', model: null,
    modelSource: 'native default', launchConfig: null, backend: 'tmux', backendStatus: { name: 'tmux', installed: true, started: false }, preflight: { status: 'complete', budgetMs: 20000, elapsedMs: 55 },
    relation: null, parentInstance: null, policy: { childSpawns: { allowed: true, origin: { kind: 'default', detail: 'children allowed' } } },
    capabilities: ['fixture.cap'], skills: ['fixture-skill'], task: null };
}
export const view = (t = target, v = data(t)) => ({ spawnPreviewViewApi: 1, status: 'available', target: t, data: v, reason: null });
export const envelope = v => ({ schemaVersion: 1, ok: true, result: v });
export const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
export const tick = () => new Promise(resolve => setImmediate(resolve));
