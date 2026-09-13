// Foreground selection is independent of retained tab/attachment lifetime.
// begin() starts an explicit action; its callable ticket guards BOTH success
// and rejection. focus() binds that action to content, never just visibility.
export function createSelectionOwnership({ currentWorkspace, workspaceGeneration }) {
  let serial = 0;
  let focus = null;
  let applyingFocus = false;
  const invalidate = () => { serial++; focus = null; };
  return {
    begin() {
      invalidate();
      const token = serial;
      const workspace = currentWorkspace();
      const generation = workspaceGeneration();
      return () => token === serial && workspace === currentWorkspace()
        && generation === workspaceGeneration();
    },
    invalidate,
    focus(id, owns) {
      if (!owns()) return false;
      focus = { id, owns };
      return true;
    },
    ownsFocus: id => focus?.id === id && focus.owns(),
    // Suppress only the synchronous focusin caused by our own focus call,
    // not a later genuine keyboard entry into the same already-selected pane.
    applyFocus(callback) {
      const previous = applyingFocus;
      applyingFocus = true;
      try { return callback(); } finally { applyingFocus = previous; }
    },
    isApplyingFocus: () => applyingFocus,
  };
}

// Pointer/focus entry is explicit even in an already-selected/flat pane: an
// older open might still be pending. Programmatic content focus is applied
// under a synchronous guard, so its focusin does not mint a second ticket.
export function wirePaneSelection(paneEl, { isVisible, isApplyingFocus, select }) {
  const pointer = () => { if (isVisible()) select(); };
  const focus = () => { if (isVisible() && !isApplyingFocus()) select(); };
  paneEl.addEventListener("pointerdown", pointer);
  paneEl.addEventListener("focusin", focus);
  return () => {
    paneEl.removeEventListener("pointerdown", pointer);
    paneEl.removeEventListener("focusin", focus);
  };
}
