// Live receive for joined teams through the host wake broker (oats.aweb 1.15).
//
// aw >= 1.36.7 accepts one registration per instance home carrying several
// broker-owned receive identities (`aw wake register --registration-json -`):
// - external-session homes (delivery: session): the broker owns every identity;
//   the primary keeps the runtime controls, joined homes add mail/chat streams;
// - native homes (delivery: channel): the Claude channel (native-channel) or the
//   Pi extension (native-pi) keeps the primary identity, and the broker attaches
//   only the joined homes, disjoint from the primary (aw's mixed mode).
// A runtime with no native surface (Codex, unknown) is not registered: its
// joined teams stay poll-only and readiness says so.
import {realpathSync} from 'node:fs';
import {resolve} from 'node:path';

const JOINED_EVENT_CLASSES = ['mail', 'chat'];

/** external-session | native-channel | native-pi | null (no broker receive). */
export function runtimeDeliveryFor({delivery, runtime}) {
  if (delivery === 'session') return 'external-session';
  if (runtime === 'claude') return 'native-channel';
  if (runtime === 'pi') return 'native-pi';
  return null;
}

/** The registration document for this home, or null when the home needs none
 *  (native home with no joined team, or a runtime the broker cannot type into).
 *  A session home with no joined team keeps the legacy one-identity register. */
export function wakeRegistration({home, primaryIdentityHome, delivery, runtime, joined = [], backend}) {
  const rt = runtimeDeliveryFor({delivery, runtime});
  if (!rt || !joined.length) return null;
  const receive = joined.map((j) => ({identity_home: j.identityHome, label: j.label, event_classes: JOINED_EVENT_CLASSES}));
  const doc = rt === 'external-session'
    ? {home, delivery: 'session', runtime_delivery: rt, identity_home: primaryIdentityHome, receive_identities: [{identity_home: primaryIdentityHome, label: 'personal', controls: true}, ...receive]}
    : {home, delivery: rt, runtime_delivery: rt, primary_identity_home: primaryIdentityHome, receive_identities: receive};
  if (backend) doc.backend = backend;
  return doc;
}

const canon = (p) => { try { return realpathSync(p); } catch { return resolve(String(p || '')); } };

/** Each joined team's actual receive mode from `aw wake status --json`:
 *  native only when the home is registered with that identity home AND the
 *  host daemon runs; otherwise poll with the reason. */
export function joinedReceiveModes(status, {home, joined = []}) {
  const running = status?.daemon_running === true || status?.daemon_version_state === 'reported';
  const want = canon(home);
  const row = (Array.isArray(status?.instances) ? status.instances : []).find((i) => i && canon(i.home) === want);
  const identities = Array.isArray(row?.receive_identities) ? row.receive_identities : [];
  return joined.map((j) => {
    const hit = identities.find((r) => r && canon(r.identity_home) === canon(j.identityHome));
    if (!hit) return {label: j.label, receive: 'poll', reason: row ? 'not-registered-with-broker' : 'home-not-registered'};
    if (!running) return {label: j.label, receive: 'poll', reason: 'wake-daemon-not-running'};
    if (hit.stream_error || hit.stream_admitted === false) return {label: j.label, receive: 'poll', reason: 'stream-not-admitted', detail: String(hit.stream_error || hit.stream_phase || 'not admitted').slice(0, 160)};
    return {label: j.label, receive: 'native', phase: hit.stream_phase || row.phase || 'unknown'};
  });
}
