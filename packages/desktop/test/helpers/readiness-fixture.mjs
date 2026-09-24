// Readiness on the workspace model (readinessApi 2) for the boundary, HTTP,
// proxy and view tests. `data()` is the kernel capture (fixtures/workspace-v2/
// f3b2, main c9dc6012 with #162 merged) retargeted to the test's soul or instance; the
// subject is a soul or an instance, never a scope. The default captures carry
// oats.okf's real `needs-configuration` answer (no state-dir); the
// `readiness-instance-provider-pass` capture is a home spawned with one.
import { readFileSync } from 'node:fs';

const captured = name => JSON.parse(readFileSync(new URL(`../fixtures/workspace-v2/f3b2/${name}.json`, import.meta.url), 'utf8')).result;
export const cli = { ok: true, bin: '/fixture/oats', version: '0.25.9', features: ['readiness'], readinessApi: 2 };
export const workspace = { id: 'team', scope: '/team' };
export const soul = { name: 'dev', agentsRoot: '/team/agents' };
export const instance = { instance: 'dev-1', agent: 'dev', agentsRoot: '/team/agents', home: '/team/agents/dev/instances/dev-1', server: null };
export const selector = { kind: 'soul', soul: 'dev', agentsRoot: '/team/agents' };
export const target = { workspace: 'team', context: '/team', observedAs: 'soul', selector };
export const instanceTarget = { workspace: 'team', context: '/team', observedAs: 'instance', home: instance.home,
  selector: { kind: 'instance', instance: instance.instance, agent: instance.agent, agentsRoot: instance.agentsRoot, server: null } };
export const context = () => ({ cli: structuredClone(cli), workspace: { ...workspace }, agents: [{ ...soul }], instances: [{ ...instance }] });
/** A readinessApi 2 item (the kernel's item fields). */
export const item = (status = 'pass', fields = {}) => ({ subject: 'fixture.cap', status, required: true, producer: 'workspace resolution', reason: null,
  evidence: { from: { kind: 'package', package: 'fixture.cap', version: '1.0.0', commit: 'a'.repeat(40), integrity: 'sha256-fixture' } }, remedy: null,
  capability: { id: 'fixture.cap' }, ...fields });
/** The captured readiness document for this target (soul or instance). */
export function data(t = target, capture = t.observedAs === 'instance' ? 'readiness-instance' : 'readiness-soul') {
  const v = structuredClone(captured(capture));
  if (t.observedAs === 'instance') {
    v.subject = { kind: 'instance', instance: t.selector.instance, home: t.home, soul: t.selector.agent };
    v.selector = { kind: 'home', home: t.home, soul: t.selector.agent, agentsRoot: t.selector.agentsRoot };
  } else {
    v.subject = { ...v.subject, soul: t.selector.soul };
    v.selector = { kind: 'soul', soul: t.selector.soul, agentsRoot: t.selector.agentsRoot, dir: t.context };
  }
  return v;
}
export const envelope = v => ({ schemaVersion: 1, ok: true, result: v });
export const view = (t = target, value = data(t)) => ({ readinessViewApi: 1, status: 'available', target: t, data: value, reason: null });
export const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
export const tick = () => new Promise(resolve => setImmediate(resolve));
