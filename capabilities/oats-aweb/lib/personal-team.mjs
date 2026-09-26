// Per-workspace personal team: deferred to oats.aweb 1.16.
//
// A host's `aw auth` login is one file per OS user, and `aw auth status` does not
// name the account, so enrolling a workspace's personal team from that login could
// mint it (and every instance) into whichever account logged in last. 1.16 brings
// a per-deployment credential location and an expected owner. Until then oats.aweb
// makes no `aw auth` or `aw team ensure` call on any path, the primary team
// resolves as in 1.14.2 (settings.team, else the root's active team), and a
// declared settings.oats.aweb.roots.personal is ignored with a readiness warning.

export const PERSONAL_ROOT_KEY = 'settings.oats.aweb.roots.personal';
export const PERSONAL_ROOT_DEFERRED_WARNING = `${PERSONAL_ROOT_KEY} is ignored: per-workspace personal-team enrollment arrives in oats.aweb 1.16; the primary team is settings.oats.aweb.team, else the aweb root's active team`;

const obj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** True when the host declared roots.personal (any value): 1.15 ignores it and says so. */
export function personalRootDeclared(settings) {
  return obj(settings?.roots) && Object.hasOwn(settings.roots, 'personal');
}
