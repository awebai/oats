// Historical target-index helper (Slice G). Production now uses the owner/lease
// broker in terminal-owner.mjs and imports only MAX_TERMINALS from this module.
// The helper semantics below are not the active IPC/resource boundary.
//
// Why reuse and the ceiling sit in the main process (Slice G, 2026-07-24): it
// owns every node-pty and its `oatsdesk-*` tmux viewer session. The renderer's
// tab-key dedupe is a best-effort UX nicety scoped to one workspace's tab
// list, NOT a resource bound. Neither the ceiling nor this helper proves the
// host cannot be overloaded: a count alone cannot (see MAX_TERMINALS below).
//
// Two guarantees:
//   1. DEDUPE by intended target: one live pty/viewer per distinct terminal
//      target. Repeated opens of the same target (clicks, re-renders,
//      polling, focus, reconnect, stale async completion) REUSE the existing
//      terminal — they never create a second viewer.
//   2. HARD CAP: at most `max` (default 200) simultaneous terminals. A
//      distinct open beyond the cap is REJECTED, visibly and actionably —
//      never a silent eviction, never a silent extra create.
//
// The registry is pure and synchronous. main.mjs completes bounded remote
// preparation before plan()->create->commit(); that final sequence contains
// no await, so concurrent IPC opens cannot interleave to exceed the cap.

// The cap stops a runaway of DISTINCT opens; it is not what stops repeated or
// leaked ones. Those are stopped in terminal-owner.mjs: reuse by target per
// window document, lease revocation on reload, navigation and renderer crash,
// and confirmed viewer cleanup. 200 is a number a person does not meet in
// ordinary use. A terminal costs one pty and one attached tmux client on a
// small viewer session; a remote terminal costs an `oats session attach`
// process and its ssh. Measured on 2026-10-04 on Linux with tmux 3.7, on a
// private tmux server, following openTerm's command sequence: 200
// linked-window viewers with attached clients took 24 MB in the tmux server,
// about 5 MB per client, no idle CPU, and 30 to 90 ms per open.
export const MAX_TERMINALS = 200;

/**
 * @param {{ max?: number }} [opts]
 * @returns {{
 *   plan(targetKey: string): { action: "reuse", id: any }
 *                          | { action: "cap", active: number, max: number }
 *                          | { action: "create" },
 *   commit(targetKey: string, id: any): void,
 *   release(id: any): void,
 *   has(targetKey: string): boolean,
 *   activeCount(): number,
 *   ids(): any[],
 * }}
 */
export function createTerminalRegistry({ max = MAX_TERMINALS } = {}) {
  const byKey = new Map(); // targetKey -> id
  const byId = new Map();  // id -> targetKey

  return {
    /** Decide the action for an open of `targetKey` WITHOUT mutating state.
     * The caller creates the pty only on "create", then commit()s it. */
    plan(targetKey) {
      if (byKey.has(targetKey)) return { action: "reuse", id: byKey.get(targetKey) };
      if (byKey.size >= max) return { action: "cap", active: byKey.size, max };
      return { action: "create" };
    },
    /** Record a successfully created terminal. Idempotent per (key,id). */
    commit(targetKey, id) {
      // Defensive: a commit for a key that somehow already exists must not
      // orphan the prior id — release it first (should not happen given
      // plan() gates creation, but keeps the maps consistent).
      const prior = byKey.get(targetKey);
      if (prior !== undefined && prior !== id) byId.delete(prior);
      byKey.set(targetKey, id);
      byId.set(id, targetKey);
    },
    /** Drop a terminal by id (pty exit, tab close, failed/aborted open). */
    release(id) {
      const key = byId.get(id);
      if (key === undefined) return;
      byId.delete(id);
      // Only clear the key if it still points at THIS id (a reuse could have
      // re-pointed it — it cannot today, but keep the maps honest).
      if (byKey.get(key) === id) byKey.delete(key);
    },
    has(targetKey) { return byKey.has(targetKey); },
    activeCount() { return byKey.size; },
    ids() { return [...byId.keys()]; },
  };
}

/** Stable target key for a tmux terminal target. NUL-joined so no
 * session/window value can forge a different key (both are already charset-
 * validated by tmuxAttachTarget before a viewer is ever built). */
export function terminalTargetKey(session, window, socket) {
  return `${String(session)}\u0000${window === undefined || window === null ? "" : String(window)}${socket ? `\u0000${socket}` : ""}`;
}
