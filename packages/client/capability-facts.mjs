/** A capability's facts as its page shows them, for any client: the "Comes from" rows and what it
 * provides, projected from the catalog row (`oats capabilities`, or a soul's resolved capability in the
 * same shape) and workspace status. Only reported facts: a fact the kernel did not report is no row, and
 * nothing is invented. The page's own words are CAPABILITY_COPY, so no client writes its own. */
import { memberNames, capabilitySource } from './capability-rows.mjs';

const text = v => typeof v === 'string' && v ? v : null;
const list = v => Array.isArray(v) ? v : [];
const short = v => typeof v === 'string' && /^[0-9a-f]{40}$/i.test(v) ? v.slice(0, 7) : v;

/** The capability page's own words. `souls(n)` is the "Used by" count; `behind(n)` follows an instance count, joined with ` · `. */
export const CAPABILITY_COPY = Object.freeze({
  comesFrom: 'Comes from',
  provides: 'Provides',
  usedBy: 'Used by',
  unlistable: 'Not listable: a spawn of it would refuse.',
  none: 'None',
  noSoul: 'No soul here includes it.',
  noInstance: 'No instance carries it yet.',
  souls: n => `${n} soul${n === 1 ? '' : 's'}`,
  behind: n => `${n} on an older version`,
});

/** Where a package comes from, in workspace status terms: the official catalog or a git source. */
export function packageOrigin(source) {
  if (!text(source)) return null;
  if (source.startsWith('catalog:')) return 'official catalog';
  const git = /^git:(?:[a-z]+:\/\/)?(?:[^@/]+@)?([^/:@]+)/i.exec(source);
  return git ? `git · ${git[1]}` : source;
}
/** sha256-<64 hex> → sha256:9f2c…a71e (the full value stays in the title). */
export function fingerprint(integrity) {
  const m = /^sha256-([0-9a-f]{64})$/i.exec(integrity || '');
  return m ? `sha256:${m[1].slice(0, 4)}…${m[1].slice(-4)}` : text(integrity);
}

/** One "Comes from" row, [label, value] or [label, value, full], or none when the value is not reported text.
 * `full` (the whole value, where the row shows it shortened) is kept only when it says more than the value. */
const fact = (label, value, full) => !text(value) ? [] : [text(full) && full !== value ? [label, value, full] : [label, value]];

/** `{ origin, provides }`. `origin`: the "Comes from" rows, in order: a package's Package, Pinned (its version
 * and where it comes from), Commit and Fingerprint (the integrity workspace status reports for it, else the
 * resolved capability's); a member or external capability's Repository, Latest, Path, Fingerprint (the Git
 * tree of its directory, kernel #217) and Owned when it is private. `provides`: [label, names] for Skills,
 * Commands and Hooks, each only when the row carries it; names is an array, or null when the kernel could
 * not list them (a spawn of it would refuse). `names`: memberNames(status), when the caller holds it. */
export function capabilityFacts(row, { status, names = memberNames(status) } = {}) {
  let origin;
  if (row.kind === 'package') {
    const pkg = list(status?.packages).find(p => p.id === row.package), integrity = pkg?.integrity || row.resolved?.from?.integrity;
    origin = [...fact('Package', row.package), ...fact('Pinned', [row.version, packageOrigin(pkg?.source)].filter(Boolean).join(' · ')),
      ...fact('Commit', short(row.commit), row.commit), ...fact('Fingerprint', fingerprint(integrity), integrity)];
  } else {
    origin = [...fact('Repository', capabilitySource(row, names).label, row.repoKey), ...fact('Latest', short(row.commit), row.commit), ...fact('Path', row.path),
      ...fact('Fingerprint', short(row.tree), row.tree), ...(row.private === true ? fact('Owned', 'this repo\'s souls only') : [])];
  }
  const provides = [['Skills', row.skills], ['Commands', row.commands], ['Hooks', row.hooks]].filter(([, names]) => names !== undefined);
  return { origin, provides };
}
