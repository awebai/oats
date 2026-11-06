/** `spawnedBy` as a status row shows it (feature spawn-attribution, awebai/oats#1665): the spawner a spawn
 *  recorded in instance.json, `{ instance, home }`, read by one rule for a local row (lib/instance-listing.mjs)
 *  and a remote one (lib/servers.mjs REMOTE_ROW_FACTS). Dependency-free, so the remote status read loads
 *  nothing more for it. */
import { isAbsolute } from "node:path";

/** The instance-name grammar (lib/soul-listing.mjs INSTANCE_NAME_RE). */
const INSTANCE_NAME = /^[a-z0-9][a-z0-9-]*$/;

/** `{ instance, home }` when `value` is exactly that: an instance-name slug and an absolute path, and no
 *  other key. Anything else (a hand-edited record, a remote host's answer) is null, never an error. */
export function readSpawnedBy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes("instance") || !keys.includes("home")) return null;
  const { instance, home } = value;
  return typeof instance === "string" && INSTANCE_NAME.test(instance) && typeof home === "string" && isAbsolute(home) ? { instance, home } : null;
}
