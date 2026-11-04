// Semver precedence, as oats.aweb's lib/aw-floor.mjs has it. This module is
// copied into a home on its own, so it cannot import oats.aweb's; the rules are
// the same as its parseVersion, compareVersions and versionAtLeast, and
// test/aweb-tasks-claim-floors.test.mjs holds the two equal.

const IDENT = '(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)';
const VERSION_RE = new RegExp(`^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-(${IDENT}(?:\\.${IDENT})*))?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`);

/** The complete token as a semver major.minor.patch with an optional
 *  pre-release, as `{release, pre}`, or null for anything else (leading zeros,
 *  a missing part, text around it). Build metadata (`+abc`) is accepted and has
 *  no precedence. */
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

/** Whether `version` is at least `floor` by semver precedence. A version that
 *  isn't semver never is. */
export function versionAtLeast(version, floor) {
  const v = parseVersion(version), f = parseVersion(floor);
  return !!(v && f) && compareVersions(v, f) >= 0;
}
