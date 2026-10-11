import {serverTime} from './probe-proof.mjs';
export const unknownVersion = () => ({status: 'unknown', version: null, source: null, observedAt: null});
export function initialDiagnostics() {
  return {
    readiness: {status: 'unknown', source: null, observedAt: null},
    pane: {status: 'unknown', state: null, present: null, source: null, observedAt: null},
    mailRead: {status: 'unknown', readAt: null, source: null, observedAt: null},
    versions: {aw: unknownVersion(), oatsKernel: unknownVersion(), oatsAweb: unknownVersion(), harness: {name: null, ...unknownVersion(), binarySha256: null}},
  };
}
export function projectReadiness(envelope, home) {
  const doc = envelope?.result, s = doc?.summary;
  if (envelope?.schemaVersion !== 1 || envelope.ok !== true || doc?.readinessApi !== 2 || doc.subject?.home !== home || doc.subject.kind !== 'instance' || !serverTime(doc.at) || !s || !['required', 'fail', 'unknown', 'pass'].every(key => Number.isSafeInteger(s[key]) && s[key] >= 0) || typeof s.ready !== 'boolean') return null;
  const status = s.ready && s.required > 0 && s.fail === 0 && s.unknown === 0 ? 'ready' : s.fail > 0 ? 'not-ready' : 'unknown';
  return {status, source: 'oats.readiness.readinessApi2', observedAt: doc.at};
}
export function projectPane(envelope, home, at) {
  const doc = envelope?.result;
  if (envelope?.schemaVersion !== 1 || envelope.ok !== true || doc?.home !== home || !['stopped', 'not-launched', 'shell', 'unknown'].includes(doc.state) || typeof doc.present !== 'boolean') return null;
  return {status: 'observed', state: doc.state, present: doc.present, source: 'oats.session.inspect', observedAt: at};
}
export function projectMailRead(message, at) {
  if (message?.read_at === null) return {status: 'unread', readAt: null, source: 'aw.mail.show.message-id', observedAt: at};
  const readAt = serverTime(message?.read_at);
  return readAt ? {status: 'read-unanswered', readAt, source: 'aw.mail.show.message-id', observedAt: at} : {status: 'unknown', readAt: null, source: 'aw.mail.show.message-id', observedAt: at};
}
