/** The one aw client floor: every path that needs aw, the probe and a grant
 *  seat's custody are held to it. aw 1.36.31 can reply to a sender outside
 *  the team roster; aw 1.36.32 mints grants that never expire. Their custody
 *  reports mail_reply_continuation.v1 and grant_never_ttl.v1. aw 1.36.33 is
 *  the aw `oats aweb resident create` is built and tested on: its custody
 *  starts when its working directory is reached through a symlink. */
export const AW_MIN = '1.36.33';

/** The highest aw the provider's CI journeys pass on (ci.yml's resident-journey
 *  matrix, whose top a test holds equal to this). It moves only once that aw is
 *  in the matrix, never ahead of it. */
export const AW_TESTED = '1.36.53';
/** The aweb Cloud's service origins. aw reaches npm `latest` only after the
 *  Cloud runs a server that supports it, so a Cloud home is never warned that
 *  its aw is newer than tested. */
export const AWEB_CLOUD_ORIGINS = Object.freeze(['https://app.aweb.ai']);

const IDENT = '(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)';
const VERSION_RE = new RegExp(`^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-(${IDENT}(?:\\.${IDENT})*))?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`);
/** A semver major.minor.patch with an optional pre-release (`1.36.53-rc.3`), as
 *  `{release, pre}`, or null for anything else (leading zeros). Build metadata
 *  (`+abc`) is accepted and, as semver says, has no precedence. */
export function parseVersion(value) {
  const m = typeof value === 'string' ? VERSION_RE.exec(value) : null;
  if (!m) return null;
  const release = [m[1], m[2], m[3]].map(Number);
  return release.every(Number.isSafeInteger) ? { release, pre: m[4] ? m[4].split('.') : [] } : null;
}
/** Semver precedence: negative, zero or positive as a is below, equal to or
 *  above b. A pre-release is below its own release and above every lower one. */
export function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) if (a.release[i] !== b.release[i]) return a.release[i] - b.release[i];
  if (!a.pre.length || !b.pre.length) return b.pre.length - a.pre.length;
  for (let i = 0; i < Math.min(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i], y = b.pre[i], xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (x === y) continue;
    // Numeric identifiers have no leading zeros, so the longer is the larger;
    // comparing as text keeps ids beyond Number.MAX_SAFE_INTEGER exact.
    if (xn && yn) return x.length !== y.length ? x.length - y.length : x < y ? -1 : 1;
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return a.pre.length - b.pre.length;
}
/** Whether `version` is at least `floor`, by semver precedence: 1.36.53-rc.3
 *  meets 1.36.38, and 1.36.38-rc.1 doesn't. Every version gate in the
 *  provider compares this way. A version that isn't semver never is. */
export function versionAtLeast(version, floor) {
  const v = parseVersion(version), f = parseVersion(floor);
  return !!(v && f) && compareVersions(v, f) >= 0;
}

/** Whether a service URL is the aweb Cloud: its scheme, host and port equal a
 *  Cloud origin exactly, with no suffix match. */
export function awebCloudService(url) {
  try { return AWEB_CLOUD_ORIGINS.includes(new URL(url).origin); } catch { return false; }
}

/** The warning for an aw above AW_TESTED on a service that isn't the Cloud, or
 *  undefined. A server on an older aweb may refuse a newer aw; the fix the
 *  warning names first is the server's, since a deployment on this host may
 *  need the newer aw. No service named (aw's default, the Cloud) warns
 *  nothing; a named service that isn't a Cloud origin, or isn't a URL at all,
 *  warns. The service text only decides; it never reaches the message. */
export function awNewerThanTestedMessage(version, awebUrl) {
  if (!awebUrl || awebCloudService(awebUrl)) return undefined;
  const v = parseVersion(version), tested = parseVersion(AW_TESTED);
  if (!v || compareVersions(v, tested) <= 0) return undefined;
  return `aw ${version} is newer than the aw this oats.aweb is tested with (${AW_TESTED}). A server on an older aweb may refuse it, for example when minting an identity at spawn; if that happens, the server's aweb needs upgrading, or the host's aw pinned to ${AW_TESTED} (\`npm i -g @awebai/aw@${AW_TESTED}\`) if no deployment on this host needs a newer one.`;
}
