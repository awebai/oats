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

/** Whether `version` is at least `floor`; a version that is not a plain
 *  major.minor.patch never is. */
export function versionAtLeast(version, floor) {
  const v = stableVersion(version), f = stableVersion(floor);
  if (!v || !f) return false;
  for (let i = 0; i < 3; i++) if (v[i] !== f[i]) return v[i] > f[i];
  return true;
}
