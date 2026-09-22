export const birth = '2026-09-22T00:00:00.000Z';
export const cli = { ok: true, bin: '/inert/bin/oats', version: '0.24.12', eventsApi: 2, features: ['instance-events-2'] };
export const selector = { instance: 'dev-a', agent: 'dev', agentsRoot: '/inert/ws/agents', server: null };
export const target = { workspace: 'ws', context: '/inert/ws', selector, home: '/inert/ws/agents/dev/instances/dev-a', incarnation: birth };
export const request = (extra = {}) => ({ action: 'read', selector: { ...selector }, ...extra });
export function context() { return { workspace: { id: 'ws', scope: '/inert/ws', revision: 1 }, cli: structuredClone(cli),
  instances: [{ ...selector, home: target.home, createdAt: birth }] }; }
export const event = (extra = {}) => ({ eventsApi: 2, instance: selector.instance, home: target.home, incarnation: birth,
  producer: 'kernel', kind: 'spawned', at: '2026-09-22T01:00:00.000Z', data: { agent: 'dev', work: 'worktree', launched: false }, ...extra });
export function data(events = [event()]) {
  const last = events.at(-1);
  return { eventsApi: 2, instance: selector.instance, home: target.home, incarnation: birth,
    count: events.length, returned: events.length, truncated: false,
    integrity: { unreadableRows: 0, foreignRows: 0, sources: [{ path: 'home', status: 'ok', bytes: 1024 }, { path: 'workspace', status: 'ok', bytes: 1024 }] },
    events, lastEvent: last ? { kind: last.kind, at: last.at, producer: last.producer, incarnation: last.incarnation } : null,
    waitingOnYou: null, waitingClaims: [], notes: [] };
}
export const envelope = (value = data()) => ({ schemaVersion: 1, ok: true, result: value });
export const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
export const tick = () => new Promise(resolve => setImmediate(resolve));
