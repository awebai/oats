export const cli = { ok: true, bin: '/fixture/oats', version: '0.24.8', features: ['readiness'], readinessApi: 1 };
export const workspace = { id: 'team', scope: '/team' };
export const soul = { name: 'dev', agentsRoot: '/team/agents' };
export const instance = { instance: 'dev-1', agent: 'dev', agentsRoot: '/team/agents', home: '/team/agents/dev/instances/dev-1', server: null };
export const selector = { kind: 'scope', context: '/team' };
export const target = { workspace: 'team', context: '/team', observedAs: 'scope', selector };
export const context = () => ({ cli: structuredClone(cli), workspace: { ...workspace }, agents: [{ ...soul }], instances: [{ ...instance }] });
export const item = (status = 'pass', fields = {}) => ({ subject: 'fixture.cap', status, required: true, producer: 'kernel', reason: null, evidence: { integrity: 'sha256-fixture' }, remedy: null, ...fields });
export function data(t = target) {
  return { readinessApi: 1, subject: t.observedAs === 'scope' ? { kind: 'scope', context: t.selector.context } : { kind: 'soul', name: t.selector.soul || t.selector.agent }, at: '2026-09-22T10:00:00.000Z',
    checks: { installed: { status: 'pass', items: [item()] }, trusted: { status: 'pass', items: [item('pass', { signature: { status: 'unknown', signer: null, reason: 'Raw diagnostics must not cross' } })] },
      configured: { status: 'unknown', items: [item('unknown', { subject: 'fixture.cap activation', remedy: 'oats use fixture.cap', reason: 'not observed' })] },
      enrolled: { status: 'not-applicable', items: [item('not-applicable', { subject: 'workspace membership', required: false, reason: 'standalone' })] } },
    summary: { ready: false, required: 3, pass: 2, fail: 0, unknown: 1 },
    policy: { childSpawns: { allowed: true, enforced: false, origin: { kind: 'default', detail: 'not recorded' } }, worktrees: { allowed: null, mode: null, enforced: false, origin: { kind: 'unknown' } } }, notes: ['Fixture observations only.'] };
}
export const envelope = v => ({ schemaVersion: 1, ok: true, result: v });
export const view = (t = target, value = data(t)) => ({ readinessViewApi: 1, status: 'available', target: t, data: value, reason: null });
export const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
export const tick = () => new Promise(resolve => setImmediate(resolve));
