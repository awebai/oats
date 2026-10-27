// oats desktop — where the keyboard was in a workspace, so that switching back to it puts the focus back
// there (docs/desktop.md, "Tabs belong to their window"; the TUI does the same, docs/tui.md "Tabs").
//
// A focus place is one of:
//   { kind: "tab", tab, content, handle }   the tab layer: in the active tab's content (content: true: a
//                                           terminal's input, a file viewer), or on one of its controls (a strip
//                                           trigger, the split controls, an empty group: content: false)
//   { kind: "roster", instance, handle }    a roster row (its data-tree-instance key) or one of its tools
//   { kind: "other", region, handle }       anything else in the window: its F6 region (focus-regions.mjs
//                                           REGIONS), or null for the sidebar's foot
// `handle` is captureFocusReturn's, taken when the place was described: roster rows are replaced by every
// paint, so a place is found again by identity, never by node.
//
// Transit surfaces are never a place: the list of workspaces and its heading's controls, the palette and
// Quick Open, a dialog, a popup menu or a listbox. The place of a workspace is the last focus outside them
// while it was shown: a pick from the list leaves the workspace with the focus on a row of the list, and
// the place remembered is where the focus was before the operator went to the list.

import { captureFocusReturn } from "./focus-return.mjs";

const TRANSIT = ".side-head, #ws-list, .palette-overlay, dialog, [role=\"dialog\"], [role=\"alertdialog\"], "
  + "[aria-modal=\"true\"], [role=\"menu\"], [role=\"listbox\"], [popover]";

/** Is `el` on a transit surface (above)? */
export function isTransit(el) {
  return !!el?.closest?.(TRANSIT);
}

/**
 * @param {object} deps
 * @param {Document} deps.doc
 * @param {() => string|null} deps.regionOfFocus  the F6 region holding the focus (focus-regions.mjs), or null
 * @param {() => {id: number, paneEl: HTMLElement}|null} deps.activeTab  the tab the tab layer shows, or null
 */
export function createFocusPlaces({ doc, regionOfFocus, activeTab }) {
  let last = null; // { workspace, place }: the last focus outside the transit surfaces

  /** The place of the focus now, or null: on <body> or on a transit surface. */
  function describe() {
    const el = doc.activeElement;
    if (!el || el === doc.body || isTransit(el)) return null;
    const handle = captureFocusReturn(doc);
    if (doc.getElementById("tabhost")?.contains(el) || doc.getElementById("tabstrip")?.contains(el)) {
      const tab = activeTab();
      return { kind: "tab", tab: tab?.id ?? null, content: !!tab?.paneEl?.contains(el), handle };
    }
    if (doc.getElementById("instance-roster")?.contains(el)) {
      const row = el.closest(".ctx-tree-row")?.querySelector(".ctx-inst") ?? null;
      return { kind: "roster", instance: row?.dataset.treeInstance ?? null, handle };
    }
    return { kind: "other", region: regionOfFocus(), handle };
  }

  return {
    describe,
    /** The focus moved (a focusin) while `workspace` is shown: kept when it is a place. */
    note(workspace) {
      const place = describe();
      if (place) last = { workspace, place };
    },
    /** `workspace` is being left: the place of the focus now, else the last one it had there, else null. */
    take(workspace) {
      return describe() ?? (last?.workspace === workspace ? last.place : null);
    },
    /** Views (#482, workspace-rehome.mjs): the last place moves with its workspace's id. */
    rehome(map) {
      if (last && map.has(last.workspace)) last = { ...last, workspace: map.get(last.workspace) };
    },
    /** A workspace this window no longer has (a take-over): its last place goes. */
    forget(workspace) {
      if (last?.workspace === workspace) last = null;
    },
  };
}
