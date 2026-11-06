// Display-only broker failure observation. Never acknowledge mail or copy any
// external error text into the claim shared by CLI/Desktop clients.
import {createHash} from 'node:crypto';
import {isAbsolute, join, resolve} from 'node:path';

const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const path = v => typeof v === 'string' && isAbsolute(v) && !v.includes('\0');
const sameHome = (a, b) => path(a) && path(b) && resolve(a) === resolve(b);
const present = v => v !== undefined && v !== null && v !== '';
const errorShape = v => v === undefined || v === null || typeof v === 'string';
const validErrors = row => object(row.channel_core) && errorShape(row.channel_core.last_error) &&
  errorShape(row.registered_at) && errorShape(row.channel_core.last_input_at) && errorShape(row.channel_core.last_success_at) &&
  (row.channel_core.binding_errors === undefined || (object(row.channel_core.binding_errors) && Object.values(row.channel_core.binding_errors).every(errorShape))) &&
  row.receive_identities.every(b => errorShape(b.stream_error));

/** Fixed classes, never extracted substrings: errors may contain mail content,
 * paths, sender aliases, tokens or trace ids, even when they resemble codes. */
export function brokerFailure(row) {
  if (object(row?.channel_core?.binding_errors) && Object.values(row.channel_core.binding_errors).some(present)) return 'broker-binding-error';
  if (row?.receive_identities?.some(b => present(b?.stream_error))) return 'broker-stream-error';
  return null;
}

const observationFile = home => join(home, '.oats-aweb', 'unread-observation.json');
/** Historical last_error alone is not active failure evidence. Require two
 * successive minute observations, no unread drop and no input/success progress.
 * Keep only a digest, never the potentially sensitive diagnostic itself. */
async function workerFailure(row, target, unread, host, now) {
  const file = observationFile(row.home);
  if (!present(target.channel_core.last_error) || unread === 0) {
    await host.writeCache(file, {}).catch(() => {});
    return null;
  }
  const fingerprint = createHash('sha256').update(JSON.stringify([
    target.channel_core.last_error, target.registered_at ?? null,
    target.channel_core.last_input_at ?? null, target.channel_core.last_success_at ?? null,
    target.receive_identities.map(b => b.identity_home).sort(),
  ])).digest('hex');
  const previous = await host.readCache(file);
  const at = now(), tick = Math.floor(at / 60000);
  const age = at - previous?.at;
  const persisted = previous?.fingerprint === fingerprint && age >= 0 && age <= 120000 &&
    ((previous.tick === tick - 1 && age >= 30000) ||
      (previous.qualified === true && [tick, tick - 1].includes(previous.tick))) &&
    Number.isSafeInteger(previous.unread) && previous.unread > 0 && unread >= previous.unread;
  const observedAt = previous?.tick === tick && previous.fingerprint === fingerprint && unread >= previous.unread ? previous.at : at;
  await host.writeCache(file, {fingerprint, tick, at: observedAt, unread, qualified: persisted});
  return persisted ? 'broker-worker-error' : null;
}

/** One tick, covering roster homes independently of publication eligibility:
 * no minting root or status designation is needed for a local waiting claim.
 * Unknown observations preserve claims. Clear only our producer's claim. */
export async function observeUnreadAttention({host, rows, clear = false, budgetMs = 45000, now = Date.now}) {
  const result = {set: 0, cleared: 0, unknown: 0, failed: 0};
  if (!(await host.supportsWaiting())) return {...result, supported: false};
  let homes = (rows ?? (await host.status()).agents.flatMap(a => a.instances ?? []))
    .filter(r => r.capabilityMeta?.['oats.aweb']);
  const status = clear ? null : await host.wakeStatus();
  if (!clear && (!Array.isArray(status?.instances) || status.instances.some(t => !path(t?.home)))) return {...result, unknown: homes.length};
  // Advance the first home each minute. Repeated slow counts must not starve
  // a fixed tail of the roster. Explicit disable cleanup visits every home.
  if (!clear && homes.length) {
    const start = Math.floor(now() / 60000) % homes.length;
    homes = [...homes.slice(start), ...homes.slice(0, start)];
  }
  const deadline = clear ? Infinity : now() + budgetMs;
  let next = 0;
  const visit = async () => {
    for (;;) {
      const row = homes[next++];
      if (!row) return;
      if (now() >= deadline) { result.unknown++; continue; }
      try {
        const targets = clear ? [] : status.instances.filter(t => sameHome(t?.home, row.home));
        if (targets.length > 1) { result.unknown++; continue; }
        const target = targets[0];
        // Channel homes have no external-session registration. A mixed native
        // row (joined-team streams) is also outside this observer's scope.
        const meta = row.capabilityMeta['oats.aweb'];
        // A read-only grant can present mail without server acknowledgement.
        // Until ack authority is exposed explicitly, exclude all grant seats.
        const grantSeat = meta.identity?.mode === 'global' && !meta.retained;
        if (clear || row.retirePending || !target || grantSeat || ['native-channel', 'native-pi'].includes(target.delivery)) {
          await host.waiting(row.home, null);
          await host.writeCache(observationFile(row.home), {}).catch(() => {});
          result.cleared++; continue;
        }
        if (target.delivery !== 'session' || !Array.isArray(target.receive_identities) || !target.receive_identities.length ||
            target.receive_identities.some(b => !path(b?.identity_home)) || !validErrors(target)) { result.unknown++; continue; }
        const identities = [...new Set(target.receive_identities.map(b => b.identity_home))];
        // Query each registered identity, never the stream's cached count.
        // Any failed count makes this home's aggregate unknown, including a
        // partial positive count. A failed observation cannot set OR clear.
        let unread = 0, unknown = false;
        for (const identityHome of identities) {
          if (now() >= deadline) { unknown = true; break; }
          const count = await host.unreadCount(identityHome);
          if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(unread + count)) { unknown = true; break; }
          unread += count;
        }
        if (unknown) { result.unknown++; continue; }
        const code = unread === 0 ? await workerFailure(row, target, unread, host, now)
          : brokerFailure(target) ?? await workerFailure(row, target, unread, host, now);
        const message = unread > 0 && code ? `aweb: ${unread} unread; broker error (${code})` : null;
        await host.waiting(row.home, message);
        result[message ? 'set' : 'cleared']++;
      } catch { result.failed++; } // no external output in shared tick summaries
    }
  };
  await Promise.all(Array.from({length: Math.min(4, homes.length)}, visit));
  return result;
}
