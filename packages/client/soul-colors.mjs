/** Display-only identity colors. Zero dependencies, DOM, IO or resolver behavior.
 * Palette names are the entire accepted metadata contract, never CSS or URLs.
 * This helper can also be used by a future read-only backend projection. */
export const SOUL_COLORS = Object.freeze(['sand', 'sage', 'slate', 'mauve', 'clay', 'olive']);

export function normalizeSoulColor(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim().toLowerCase();
  return SOUL_COLORS.includes(name) ? name : null;
}

const text = value => typeof value === 'string' ? value : '';

/** Qualified CURRENT identity, not a basename, roster index, or worktree guess.
 * Tuple encoding avoids delimiter collisions; the fixed hash/avalanche gives
 * stable, muted, random-looking distribution. Six colors are NOT unique IDs. */
export function colorForIdentity({ root, name, host } = {}) {
  const key = JSON.stringify([text(root), text(name), text(host)]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 0x01000193);
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return SOUL_COLORS[((hash ^ (hash >>> 16)) >>> 0) % SOUL_COLORS.length];
}

/** Roster/inspection soul shape. Do not infer a host or canonical source path. */
export function soulColor(soul) {
  return normalizeSoulColor(soul?.color) || colorForIdentity({
    root: soul?.agentsRoot, name: soul?.name, host: soul?.server,
  });
}
