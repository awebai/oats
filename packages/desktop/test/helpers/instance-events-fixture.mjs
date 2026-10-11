export const birth = '2026-09-22T00:00:00.000Z';
export const cli = { ok: true, bin: '/inert/bin/oats', version: '0.24.12', eventsApi: 2, features: ['instance-events-2'] };
export const selector = { instance: 'dev-a', agent: 'dev', agentsRoot: '/inert/ws/agents', server: null };
export const target = { workspace: 'ws', context: '/inert/ws', selector, home: '/inert/ws/agents/dev/instances/dev-a', incarnation: birth };
export const request = (extra = {}) => ({ action: 'read', selector: { ...selector }, ...extra });
export function context() { return { workspace: { id: 'ws', scope: '/inert/ws', revision: 1 }, cli: structuredClone(cli),
  instances: [{ ...selector, home: target.home, createdAt: birth }] }; }
export const event = (extra = {}) => ({ eventsApi: 2, instance: selector.instance, home: target.home, incarnation: birth,
  producer: 'kernel', kind: 'spawned', at: '2026-09-22T01:00:00.000Z', data: { agent: 'dev', work: 'worktree', launched: false }, ...extra });
// The launch controller's audit shape; all identities and paths are inert.
export const launchPromptEvent = (facts = {}) => event({ kind: 'launch-prompt', data: {
  home: target.home, startId: 'fixture-launch', socket: 'inert', windowId: '@1', paneId: '%2', pid: 123,
  consentSource: '/inert/ws/.oats/local.yaml#/launchPromptAnswers/homes/~1inert~1dev-a',
  signatureId: 'fixture-aweb', signatureDigest: 'a'.repeat(64), version: '2.1.289', platform: 'darwin-arm64',
  class: 'awebDevelopmentChannel', key: 'Enter', status: 'submitted', ...facts,
} });
// OATS 0.52.0 (awebai/oats#917): the same row as the controller writes it there. Hand-written from the
// documented shape at kernel head 881ecc1f (lib/launch-prompts.mjs `record` and `finish`): no
// `consentSource`; `claudeVersion` and `claudeVersionSource`; the matched entry's `signatureId` on the rows
// of an answer; on a miss, `differed`. All identities and paths are inert.
export const launchPromptEvent052 = (facts = {}) => event({ kind: 'launch-prompt', data: {
  home: target.home, startId: 'fixture-launch-052', socket: 'inert', windowId: '@1', paneId: '%2', pid: 123,
  claudeVersion: '2.1.296', claudeVersionSource: 'executable-path',
  signatureId: 'aweb-dev-channel-confirmation-1', signatureDigest: 'b'.repeat(64),
  class: 'awebDevelopmentChannel', key: 'Enter', status: 'submitted', ...facts,
} });
/** The row of a miss: no answer was sent, so no signature id, class or key. */
export const launchPromptMiss052 = (differed, facts = {}) => event({ kind: 'launch-prompt', data: {
  home: target.home, startId: 'fixture-launch-052', socket: 'inert', windowId: '@1', paneId: '%2', pid: 123,
  claudeVersion: '2.1.296', claudeVersionSource: 'executable-path', status: 'blocked', reason: 'blocked: unexpected prompt',
  signatureDigest: 'c'.repeat(64), differed, ...facts,
} });
/** The one row of a start where Claude ignored the flag (kernel head 7dc5a20c of awebai/oats#917, docs/desktop-cli-api.md
 * "Launch prompt results"): the notice's entry as `signatureId`, no key, class or answer. */
export const launchPromptFlagIgnored052 = (facts = {}) => event({ kind: 'launch-prompt', data: {
  home: target.home, startId: 'fixture-launch-052', socket: 'inert', windowId: '@1', paneId: '%2', pid: 123,
  claudeVersion: '2.1.296', claudeVersionSource: 'executable-path', status: 'flag-ignored', reason: 'channels-unavailable',
  signatureId: 'aweb-dev-channel-flag-ignored-1', signatureDigest: 'd'.repeat(64), ...facts,
} });
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
