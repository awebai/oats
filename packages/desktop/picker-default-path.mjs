// Where the native pickers open (awebai/oats#460). Without an explicit
// defaultPath macOS reopens a picker wherever it last was, often ~/Downloads.
// Pure decisions only: main.mjs supplies the remembered state and the
// filesystem check, and passes the result as showOpenDialog's defaultPath.
import { dirname, isAbsolute, join } from "node:path";

/**
 * The first candidate directory that still exists, else the home directory.
 * ~/Downloads is never returned: it is the very location the OS falls back
 * to, so a candidate that happens to be it gives way to the next one.
 * @param {object} io
 * @param {Iterable<string|null|undefined>} io.candidates  directories, most preferred first
 * @param {(dir: string) => boolean} io.exists             the directory exists (and is one)
 * @param {string} io.home                                 the user's home directory
 * @returns {string}
 */
export function pickerDefaultPath({ candidates, exists, home }) {
  const downloads = join(home, "Downloads");
  for (const dir of candidates) {
    if (typeof dir !== "string" || !isAbsolute(dir) || dir === downloads) continue;
    try { if (exists(dir)) return dir; } catch { /* unreadable: try the next one */ }
  }
  return home;
}

/**
 * Add workspace → Browse… candidates: the remembered parent of the most
 * recently added or opened workspace first, then the parents of the
 * recents (most-recent-first) and of the open set. The open set is restored
 * startup-first, so it is a fallback, never an order.
 * @param {object} state
 * @param {string|null} [state.last]  parseLastWorkspaceParent(last-workspace-parent.json)
 * @param {string[]} [state.recents]  validated workspace-recents.json entries
 * @param {string[]} [state.open]     validated open workspaces
 * @returns {string[]}
 */
export function workspacePickerCandidates({ last = null, recents = [], open = [] }) {
  const parents = [...recents, ...open]
    .filter((p) => typeof p === "string" && isAbsolute(p))
    .map((p) => dirname(p));
  return [...new Set([last, ...parents].filter((p) => typeof p === "string" && isAbsolute(p)))];
}

/**
 * The remembered parent directory, written by main.mjs whenever a workspace
 * add or open succeeds (rememberWorkspaceParent). Malformed state is no state.
 * @param {string} raw  file contents
 * @returns {string|null}
 */
export function parseLastWorkspaceParent(raw) {
  try {
    const parent = JSON.parse(raw)?.parent;
    return typeof parent === "string" && isAbsolute(parent) ? parent : null;
  } catch { return null; }
}

/** The state to persist for a workspace that was just added or opened. */
export function lastWorkspaceParentState(workspacePath) {
  return JSON.stringify({ parent: dirname(workspacePath) });
}

/**
 * Choose the oats CLI binary candidates: the directory of the user's
 * persisted choice, then of the CLI the backend resolved.
 * @param {object} state
 * @param {string|null} [state.chosen]    readCliChoice()
 * @param {string|null} [state.resolved]  GET /api/cli `bin`
 * @returns {string[]}
 */
export function cliPickerCandidates({ chosen = null, resolved = null }) {
  return [...new Set([chosen, resolved]
    .filter((p) => typeof p === "string" && isAbsolute(p))
    .map((p) => dirname(p)))];
}
