// A grant seat's expiry, from the grant recorded at its last mint
// (identity.grant.expiresAt, aw's `id grant mint` expires_at), with no aw or
// custody call. A finite expiry applies even when ttl is never: the team or
// issuing certificate can cap the request. A seat that is not restarted in
// time loses messaging. Runtime policy or certificate limits can end a grant
// sooner, including one recorded as expiresAt "never".
import {parseTimestamp} from './wake-receive.mjs';
import {NEVER_GRANT_TTL, renewalGrantTTL, resolveGrantTTL} from './grant-duration.mjs';

/** A never request may be capped by the team or issuing certificate. Trust
 *  the finite receipt as the deadline; duration requests still require one. */
export function mintedExpiryProblem(expiresAt, ttl) {
  if ((ttl === 'never' && expiresAt === 'never') || Number.isFinite(parseTimestamp(expiresAt))) return undefined;
  const shown = JSON.stringify(expiresAt) ?? 'undefined';
  return `aw id grant mint returned expires_at ${shown.slice(0, 64)} for a ${ttl} grant`;
}

export const GRANT_EXPIRY_WARNING_MS = 7 * 24 * 3600 * 1000;

/** True when the seat's captured identity.ttl is a duration. A recorded
 *  grant.ttl does not say this: a seat from before 1.25.0 renews at 720h and
 *  records it without any setting. */
function explicitDuration(ttl) {
  try { return typeof ttl === 'string' && resolveGrantTTL(ttl) !== NEVER_GRANT_TTL; } catch { return false; }
}

/** This seat's remedy, from the renew mode its grant recorded and the
 *  identity.ttl it captured. Under renew: launch a restart re-mints: a seat
 *  with a set duration requests another one. A never request with a finite
 *  receipt remains subject to the team or issuing certificate limit. Under
 *  renew: off a restart keeps the grant. A grant minted before oats.aweb
 *  1.25.0 records no renew mode, so its remedy also covers renew: off. */
export function grantExpiryRemedy(home, grant, configuredTtl) {
  if (grant?.renew === 'off') return 'respawn the seat (or set `renew: launch` and respawn): with renew off a restart keeps this grant';
  let nextTtl;
  try { nextTtl = renewalGrantTTL(configuredTtl, grant?.ttl); } catch { /* readiness still explains expiry when a captured ttl is invalid */ }
  const cappedNever = nextTtl === NEVER_GRANT_TTL && Number.isFinite(parseTimestamp(grant?.expiresAt));
  const restart = cappedNever
    ? `restart the seat to renew it up to the team's limit (\`oats session restart --home ${home}\`)`
    : explicitDuration(configuredTtl)
    ? `a restart requests another ${configuredTtl} (\`oats session restart --home ${home}\`); removing identity.ttl and respawning requests never; team or certificate limits still apply`
    : `restart the seat to renew it (\`oats session restart --home ${home}\`)`;
  return grant?.renew === 'launch' ? restart : `${restart}; if its identity.renew is off, respawn it instead`;
}

const shown = value => value === undefined ? 'absent' : JSON.stringify(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, 80);

/** {problems, warnings} for the recorded `identity`: `grant-expired` at or
 *  after an expiry, `grant-expiring` within 7 days of it, and
 *  `grant-expiry-unknown` when none can be read. Nothing for a never-grant,
 *  whose expiry is never read as a date (the healthy default: readiness has no
 *  informational channel, so the brief says it never expires), and nothing for
 *  a seat without a grant. */
export function grantExpiryAssessment(identity, {home, now, configuredTtl}) {
  const grant = identity?.mode === 'global' ? identity.grant : undefined;
  if (!grant || typeof grant !== 'object' || typeof grant.id !== 'string') return {problems: [], warnings: []};
  if (grant.expiresAt === 'never') return {problems: [], warnings: []};
  const remedy = grantExpiryRemedy(home, grant, configuredTtl), expiresAt = grant.expiresAt, at = parseTimestamp(expiresAt);
  if (Number.isNaN(at)) return {problems: [], warnings: [{code: 'grant-expiry-unknown', message: `grant ${grant.id} has no readable expiry (recorded expiresAt: ${shown(expiresAt)}), so readiness does not know when it expires: ${remedy}`}]};
  if (at <= now) return {problems: [{code: 'grant-expired', message: `grant ${grant.id} expired at ${expiresAt}: ${remedy}`}], warnings: []};
  if (at - now < GRANT_EXPIRY_WARNING_MS) return {problems: [], warnings: [{code: 'grant-expiring', message: `grant ${grant.id} expires at ${expiresAt}, within 7 days: ${remedy}`}]};
  return {problems: [], warnings: []};
}
