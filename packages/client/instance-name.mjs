/** The instance-name rule a typed name follows before it reaches `oats spawn --name`: the soul's role is its
 * suffix. One copy for the clients (the Desktop's spawn dialog today); the kernel keeps its own for the
 * suggestion it will make, and test/client-instance-name.test.mjs pins the cases both must agree on.
 *
 * A soul's role is the last word of its name: `oats-desktop-expert` → `expert`, `code-reviewer` → `reviewer`,
 * `cloner` → `cloner`. A package qualifier is dropped first (what follows the last `/` or `--`, as the
 * identity marks read a name: renderer/identity-marks.mjs markText), so `acme-pkg--keeper` → `keeper`.
 * A typed name gets the role once: `desktop-improvements` → `desktop-improvements-expert`, while
 * `desktop-improvements-expert` and `expert` stay as typed. Nothing here validates a name: the
 * kernel owns that grammar and refuses a name that breaks it (E_INSTANCE_NAME_INVALID).
 * DOM-free and import-free, with no module state. */

/** The role of a soul name: its last `-`-separated word after any package qualifier; '' when there is none. */
export function soulRole(soulName) {
  if (typeof soulName !== 'string') return '';
  const slash = soulName.lastIndexOf('/'), dashes = soulName.lastIndexOf('--');
  const bare = soulName.slice(Math.max(slash < 0 ? 0 : slash + 1, dashes < 0 ? 0 : dashes + 2));
  return bare.slice(bare.lastIndexOf('-') + 1);
}

/** `name` with the role of `soulName` as its suffix, unless it already ends in `-<role>` or is the role itself;
 * the name as given when the soul has no role, and '' for no name (the kernel numbers it). */
export function nameWithRole(name, soulName) {
  if (typeof name !== 'string' || !name) return '';
  const role = soulRole(soulName);
  if (!role || name === role || name.endsWith(`-${role}`)) return name;
  return `${name}-${role}`;
}
