/** The instance-name rules of the clients. A typed name follows one before it reaches `oats spawn --name`: the
 * soul's role is its suffix. One copy for the clients (the Desktop's spawn dialog today); the kernel keeps its own
 * for the suggestion it will make, and test/client-instance-name.test.mjs pins the cases both must agree on.
 *
 * A soul's role is the last word of its name: `oats-desktop-expert` → `expert`, `code-reviewer` → `reviewer`,
 * `cloner` → `cloner`. A package qualifier is dropped first (what follows the last `/` or `--`, as the
 * identity marks read a name: renderer/identity-marks.mjs markText), so `acme-pkg--keeper` → `keeper`.
 * A typed name gets the role once: `desktop-improvements` → `desktop-improvements-expert`, while
 * `desktop-improvements-expert` and `expert` stay as typed; the kernel refuses a typed name that breaks its
 * grammar (E_INSTANCE_NAME_INVALID).
 *
 * The grammar itself, the kernel's `--name` check (lib/core.mjs explicitInstanceName: a slug of at most
 * MAX_INSTANCE_NAME characters), is mirrored here for a client that must judge a name with no kernel call (the
 * Desktop's `--instance` launch argument, a spawn's suggested name); the agreement test drives the kernel's own
 * check over the same cases.
 * DOM-free and import-free, with no module state. */

/** The kernel's longest instance name (lib/core.mjs MAX_INSTANCE_NAME). */
export const INSTANCE_NAME_MAX = 64;
const INSTANCE_NAME = new RegExp(`^(?=.{1,${INSTANCE_NAME_MAX}}$)[a-z0-9]+(?:-[a-z0-9]+)*$`);

/** Whether `name` is one the kernel's `--name` check takes: lowercase letters and digits, single dashes between
 * them, at most INSTANCE_NAME_MAX characters. */
export function validInstanceName(name) {
  return typeof name === 'string' && INSTANCE_NAME.test(name);
}

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
