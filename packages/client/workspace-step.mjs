/** The workspace the leader's ↑ and ↓ move to (keymap.mjs `workspace-previous`, `workspace-next`): the
 * next openable row of the sidebar's list of workspaces, as each client draws it, in one direction. Both
 * clients read it; each draws its own list and opens what this answers. The Desktop's moves wrap; the
 * TUI's do not.
 *
 * Pure: arguments in, a key out, nothing changed. A page loads this module: it imports nothing. */

/**
 * The key of the next row with `openable` true from the row `currentKey`, in the direction `step`
 * (+1, down the list; −1, up it). Rows that are not openable are passed over. Without `wrap` (the TUI)
 * the list does not wrap: null at an end. With `wrap` (the Desktop) it goes on from the other end, and
 * when no other row can be opened it answers `currentKey` itself (an openable current row: the only
 * one), so a caller can tell "only this one" from "none". With `currentKey` not among the rows (null
 * included: nothing is open, or what is open is not listed), the first openable row for +1 and the
 * last for −1, or null when none is, wrapping or not.
 * @param {{ key: string, openable: boolean }[]} rows the list as drawn, in its order
 * @param {string | null} currentKey the row the client is on
 * @param {1 | -1} step
 * @param {{ wrap?: boolean }} [options]
 * @returns {string | null}
 */
export function workspaceStep(rows, currentKey, step, { wrap = false } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const at = currentKey === null || currentKey === undefined ? -1 : list.findIndex((row) => row?.key === currentKey);
  const dir = step < 0 ? -1 : 1;
  if (wrap && at !== -1) {
    for (let n = 1; n < list.length; n++) {
      const row = list[(((at + dir * n) % list.length) + list.length) % list.length];
      if (row?.openable === true) return row.key;
    }
    return list[at]?.openable === true ? list[at].key : null;
  }
  for (let i = at === -1 ? (dir === 1 ? 0 : list.length - 1) : at + dir; i >= 0 && i < list.length; i += dir) {
    if (list[i]?.openable === true) return list[i].key;
  }
  return null;
}
