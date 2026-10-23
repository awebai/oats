/** The workspace the leader's ↑ and ↓ move to (keymap.mjs `workspace-previous`, `workspace-next`): the
 * next openable row of the sidebar's list of workspaces, as each client draws it, in one direction. Both
 * clients read it; each draws its own list and opens what this answers.
 *
 * Pure: arguments in, a key out, nothing changed. A page loads this module: it imports nothing. */

/**
 * The key of the next row with `openable` true from the row `currentKey`, in the direction `step`
 * (+1, down the list; −1, up it), or null at an end: the list does not wrap. Rows that are not
 * openable are passed over. With `currentKey` not among the rows (null included: nothing is open, or
 * what is open is not listed), the first openable row for +1 and the last for −1, or null when none is.
 * @param {{ key: string, openable: boolean }[]} rows the list as drawn, in its order
 * @param {string | null} currentKey the row the client is on
 * @param {1 | -1} step
 * @returns {string | null}
 */
export function workspaceStep(rows, currentKey, step) {
  const list = Array.isArray(rows) ? rows : [];
  const at = currentKey === null || currentKey === undefined ? -1 : list.findIndex((row) => row?.key === currentKey);
  const dir = step < 0 ? -1 : 1;
  for (let i = at === -1 ? (dir === 1 ? 0 : list.length - 1) : at + dir; i >= 0 && i < list.length; i += dir) {
    if (list[i]?.openable === true) return list[i].key;
  }
  return null;
}
