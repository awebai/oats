/* oats desktop — when each instance was last focused (Spec C: the command
   palette lists instances by last focus, most recent first).
   An instance is focused when its terminal tab becomes the active tab, for any
   reason (shell.mjs activateTab records it; a terminal taking keyboard focus
   selects its tab through wirePaneSelection, so it lands there too). Entries are
   keyed by the window's workspace and the instance's exact identity: the id the
   terminal tab key carries (terminalKey = `term:<workspace>:<instanceId>`), so
   same-named instances of different agents roots, hosts or workspaces are
   different entries.
   Per-machine UI state only: one localStorage key, never written to a deployment
   or sent to the server. It survives an app restart. Reads are defensive (missing,
   corrupt or foreign values read as empty), each workspace keeps its RECENCY_CAP
   most recent entries, and every write re-reads storage first, so windows of
   other workspaces (one window per workspace) never overwrite each other. */
import { validWorkspaceId, WORKSPACE_ID_MAX } from "./workspace-id.mjs";

export const RECENCY_STORAGE_KEY = "oats-desktop-instance-recency";
/** Entries kept per workspace (the most recent). */
export const RECENCY_CAP = 200;

const defaultStorage = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
// "" is the unbound/default workspace (views/common.mjs setWorkspace).
const validWorkspace = (ws) => ws === "" || validWorkspaceId(ws);
const validId = (id) => typeof id === "string" && id.length > 0 && id.length <= 2 * WORKSPACE_ID_MAX;
const validTime = (t) => Number.isFinite(t) && t > 0;
const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** One workspace's entries, cleaned and capped: [[id, time], ...], most recent first. */
function cleanEntries(value) {
  if (!isObject(value)) return [];
  return Object.entries(value).filter(([id, t]) => validId(id) && validTime(t))
    .sort((a, b) => b[1] - a[1]).slice(0, RECENCY_CAP);
}

/** The terminal tab key's instance id (`term:<workspace>:<id>`), or null when the key is not that workspace's. */
export function recencyIdFromTerminalKey(workspace, key) {
  const prefix = `term:${workspace}:`;
  return typeof key === "string" && key.startsWith(prefix) && key.length > prefix.length ? key.slice(prefix.length) : null;
}

/**
 * @param {object} [deps]
 * @param {Storage|null} [deps.storage] localStorage by default; null keeps nothing.
 * @param {() => number} [deps.now]
 */
export function createInstanceRecency({ storage = defaultStorage(), now = () => Date.now() } = {}) {
  function read() {
    try {
      const value = JSON.parse(storage?.getItem(RECENCY_STORAGE_KEY) || "{}");
      return isObject(value) ? value : {};
    } catch { return {}; }
  }
  function write(all) {
    const out = {};
    for (const [ws, entries] of Object.entries(all)) {
      if (!validWorkspace(ws)) continue;
      const kept = cleanEntries(entries);
      if (kept.length) out[ws] = Object.fromEntries(kept);
    }
    try { storage?.setItem(RECENCY_STORAGE_KEY, JSON.stringify(out)); } catch { /* storage is a convenience */ }
  }
  // The id last recorded per workspace by this window: re-activating the
  // already most recent tab (a layout re-projection) changes no order, so it
  // writes nothing.
  const last = new Map();

  return {
    /** Record a focus of instance `id` in `workspace` now. */
    record(workspace, id) {
      if (!storage || !validWorkspace(workspace) || !validId(id) || last.get(workspace) === id) return;
      const all = read();
      const entries = cleanEntries(all[workspace]);
      // Strictly after the newest entry: two focuses in one millisecond keep their order.
      const time = Math.max(now(), (entries[0]?.[1] ?? 0) + 1);
      all[workspace] = Object.fromEntries([[id, time], ...entries.filter(([other]) => other !== id)]);
      write(all);
      last.set(workspace, id);
    },
    /** `workspace`'s entries as Map<instance id, time>, most recent first (a copy). */
    snapshot(workspace) {
      return validWorkspace(workspace) ? new Map(cleanEntries(read()[workspace])) : new Map();
    },
    /** Workspace re-homing (workspace-rehome.mjs rehomeMap: old id → new id): a re-homed
     * workspace's entries join its new id, the newer time winning for an instance in both. */
    rehome(map) {
      if (!storage || !map?.size) return;
      const all = read();
      let changed = false;
      for (const [from, to] of map) {
        if (from === to || !Object.hasOwn(all, from) || !validWorkspace(to)) continue;
        const merged = new Map(cleanEntries(all[to]));
        for (const [id, t] of cleanEntries(all[from])) if (!(merged.get(id) >= t)) merged.set(id, t);
        all[to] = Object.fromEntries(merged);
        delete all[from];
        last.delete(from); last.delete(to);
        changed = true;
      }
      if (changed) write(all);
    },
  };
}
