/** The one aw client floor: every path that needs aw, the probe and a grant
 *  seat's custody are held to it. aw 1.36.31 can reply to a sender outside
 *  the team roster; aw 1.36.32 mints grants that never expire. Their custody
 *  reports mail_reply_continuation.v1 and grant_never_ttl.v1. aw 1.36.33 is
 *  the aw `oats aweb resident create` is built and tested on: its custody
 *  starts when its working directory is reached through a symlink. */
export const AW_MIN = '1.36.33';

/** The parts of a plain major.minor.patch version (no leading zeros, no
 *  pre-release), or null for anything else. */
export function stableVersion(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) return null;
  const parts = value.split('.').map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

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
