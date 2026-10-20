/* oats desktop — sidebar roster tree keyboard policy (pure, but for the keymap it asks).
   The persistent instance roster is a tree: Up/Down walk the VISIBLE rows,
   Right expands (or moves down when already open/leaf), Left collapses (or
   jumps to the parent row), Home/End jump, PageUp/PageDown move by the rows
   that fit the list, Enter is the row button's native activation. The TUI's
   letters do the same beside the arrows (k j g G h l, read from the shared
   PLAIN_KEYS of packages/client/keymap.mjs: up, down, top, bottom, collapse,
   expand). These are DOM-local focus keys (roving tabindex), NOT global
   chords — only "focus the roster" is a registered keybinding action; the
   sidebar's other plain keys are the `sidebar` context's (keybindings.mjs).
   A named key the keymap takes (keymapTakes: a live binding, the shared
   Alt+Shift+↑/↓ or a rebind) is the keymap's, not the tree's.
   Extracted so the policy is unit-testable without booting the shell. */

import { plainKeys } from "../../client/keymap.mjs";
import { keymapTakes } from "./keybindings.mjs";

// A keydown's key id, the shared keymap's spelling (`ArrowUp` is `up`; a character is itself).
const NAMED = Object.freeze({ __proto__: null, ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
  Home: "home", End: "end", PageUp: "pageup", PageDown: "pagedown" });
const TREE = Object.freeze(["up", "down", "top", "bottom", "page-up", "page-down", "collapse", "expand"]);
const TREE_KEYS = new Map(TREE.flatMap((does) => plainKeys(does).map((key) => [key, does])));

/** What the tree does for a keydown (`up`, `collapse`, …), or null. A letter held with Ctrl, Alt
 * or ⌘ is not the tree's; the arrows, Home, End and the page keys are, with any modifier, as they
 * always were, unless the keymap binds that chord (Alt+Shift+↑/↓ and ⌘⌥↑/↓ open the previous /
 * next instance's terminal, from a row as from anywhere; a rebind follows). */
export function rosterKeyDoes(event) {
  const key = String(event.key ?? "");
  const named = NAMED[key];
  if (!named && (event.ctrlKey || event.altKey || event.metaKey)) return null;
  if (named && keymapTakes(event)) return null;
  return TREE_KEYS.get(named ?? key) ?? null;
}

/** Decide the tree action for a keydown on a roster row.
 * `row` = { hasChildren, collapsed }. Returns null for keys the tree does
 * not own (they bubble: Enter activates the button natively). */
export function rosterKeyAction(event, row = {}) {
  switch (rosterKeyDoes(event)) {
    case "down": return { type: "move", delta: 1 };
    case "up": return { type: "move", delta: -1 };
    case "top": return { type: "move", to: "first" };
    case "bottom": return { type: "move", to: "last" };
    case "page-down": return { type: "move", page: 1 };
    case "page-up": return { type: "move", page: -1 };
    case "expand":
      if (row.hasChildren && row.collapsed) return { type: "expand" };
      return { type: "move", delta: 1 };
    case "collapse":
      if (row.hasChildren && !row.collapsed) return { type: "collapse" };
      return { type: "parent" };
    default: return null;
  }
}

/** Resolve a move action to a target index over `count` visible rows,
 * clamped (tree navigation does not wrap — matching VS Code's explorer).
 * A page move goes `pageSize` rows (the rows that fit the list; at least one). */
export function moveTarget(action, index, count, pageSize = 1) {
  if (!count) return -1;
  if (action.to === "first") return 0;
  if (action.to === "last") return count - 1;
  const delta = action.page ? action.page * Math.max(1, Math.floor(pageSize) || 1) : (action.delta || 0);
  const next = index + delta;
  return Math.max(0, Math.min(count - 1, next));
}

/** Roving tabindex assignment: exactly one row is tabbable — the focused
 * one, else the first. Returns the tabbable index. */
export function rovingIndex(count, focusedIndex) {
  if (!count) return -1;
  return focusedIndex >= 0 && focusedIndex < count ? focusedIndex : 0;
}
