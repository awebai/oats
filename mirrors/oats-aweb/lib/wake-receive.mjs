// Live receive for joined teams through the host wake broker (oats.aweb 1.15).
//
// aw >= 1.36.7 accepts one registration per instance home carrying several
// broker-owned receive identities (`aw wake register --registration-json -`):
// - external-session homes (delivery: session): the broker owns every identity;
//   the primary keeps the runtime controls, joined homes add mail/chat streams;
// - native homes (delivery: channel on Claude or pi): the Claude channel
//   (native-channel) or the Pi extension (native-pi) keeps the primary
//   identity, and the broker attaches only the joined homes, disjoint from the
//   primary (aw's mixed mode).
// Under delivery: channel a runtime with no native surface (Codex, unknown) is
// an external-session home like any session home (brokerDelivers).
import {readFileSync, realpathSync} from 'node:fs';
import {join, resolve} from 'node:path';

const JOINED_EVENT_CLASSES = ['mail', 'chat'];

const NATIVE_CHANNEL_RUNTIMES = ['claude', 'pi'];

/** Whether the host wake broker delivers the home's primary identity:
 *  delivery: session sends every runtime through it; delivery: channel only a
 *  runtime with no native channel (Claude has its channel plugin, pi its
 *  extension). The broker typing into a session that also has a live channel
 *  doubles every wake, so this is the one path, never both. */
export function brokerDelivers({delivery, runtime}) {
  return delivery === 'session' || !NATIVE_CHANNEL_RUNTIMES.includes(runtime);
}

/** What the kernel recorded for a home's last start: this provider's meta
 *  (capabilityMeta) and the harness it launched. Empty when unreadable. */
export function recordedStart(home) {
  let doc;
  try { doc = JSON.parse(readFileSync(join(home, 'instance.json'), 'utf8')); } catch { return {}; }
  const meta = doc?.capabilityMeta?.['oats.aweb'];
  const harness = typeof doc?.launch?.harness === 'string' ? doc.launch.harness : typeof doc?.harness === 'string' ? doc.harness : undefined;
  return {meta: meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : undefined, harness};
}

/** The runtime a home's last start ran under: what this provider recorded
 *  (an empty string is a start with no runtime, so no channel), else the
 *  harness the kernel launched, for a meta that recorded none. */
export function recordedRuntime(meta, harness) {
  return typeof meta?.runtime === 'string' ? meta.runtime : harness;
}

/** Claude Code loads aweb-channel only with
 *  --dangerously-load-development-channels, because the plugin is not on
 *  Claude Code's approved channel list (the Anthropic default list, or a
 *  Team/Enterprise organization's managed allowedChannelPlugins). Before every
 *  session that flag starts, Claude Code shows a confirmation that waits for a
 *  human answer in the terminal; nothing may answer it for them. */
export const CHANNEL_DEV_CONFIRMATION = {
  code: 'channel-dev-confirmation',
  message: 'Claude Code stops at its development-channels confirmation ("Loading development channels") before the session starts, and waits until someone answers it in the instance\'s terminal: aweb-channel is not on Claude Code\'s approved channel list, so it is loaded with --dangerously-load-development-channels',
};

/** external-session | native-channel | native-pi. */
export function runtimeDeliveryFor({delivery, runtime}) {
  if (brokerDelivers({delivery, runtime})) return 'external-session';
  return runtime === 'claude' ? 'native-channel' : 'native-pi';
}

/** The multi-identity registration document for this home, or null when it
 *  has no joined team: a native home then needs none, and an external-session
 *  home keeps the one-identity register. */
export function wakeRegistration({home, primaryIdentityHome, delivery, runtime, joined = [], backend}) {
  const rt = runtimeDeliveryFor({delivery, runtime});
  if (!joined.length) return null;
  const receive = joined.map((j) => ({identity_home: j.identityHome, label: j.label, event_classes: JOINED_EVENT_CLASSES}));
  const doc = rt === 'external-session'
    ? {home, delivery: 'session', runtime_delivery: rt, identity_home: primaryIdentityHome, receive_identities: [{identity_home: primaryIdentityHome, label: 'default', controls: true}, ...receive]}
    : {home, delivery: rt, runtime_delivery: rt, primary_identity_home: primaryIdentityHome, receive_identities: receive};
  if (backend) doc.backend = backend;
  return doc;
}

const canon = (p) => { try { return realpathSync(p); } catch { return resolve(String(p || '')); } };

/** Whether `aw wake status --json` lists this home; a status without an
 *  instances list proves nothing, so it counts as listed. */
export function statusListsHome(status, home) {
  if (!Array.isArray(status?.instances)) return true;
  const want = canon(home);
  return status.instances.some((i) => i && canon(i.home) === want);
}

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
