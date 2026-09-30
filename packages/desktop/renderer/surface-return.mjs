// oats desktop — "back to where you were" for a flow that moves the main surface.
//
// Quick Open's soul pick (spec F) opens the spawn dialog in the Workspace view, so the stage
// switches under it. Dismissing the dialog (Cancel, Esc, ×, backdrop) returns the operator to the
// surface they left: the same tab re-activated (its terminal focused when that is where they
// were), or the same stage with focus back on the control they left, falling back to that
// region's current item. A successful spawn is not a dismissal: it opens the new terminal.
//
// The return is refused (restore() answers false, and the dialog restores focus itself) when the
// operator has moved on while the dialog was open: another workspace, a tab brought forward, or
// a different stage than the one hosting the dialog.

/**
 * @param {object} deps
 * @param {Document} deps.doc
 * @param {() => string} deps.currentWorkspace
 * @param {() => number} deps.workspaceGeneration
 * @param {() => {stage: string|null, tab: number|null, tabLayerVisible: boolean}} deps.surface
 *        the shell's current surface: the mounted stage, the active tab and whether tabs cover it
 * @param {(id: number) => HTMLElement|null} deps.tabPane  a tab's pane, or null when it is gone
 *        or not activatable in the current workspace
 * @param {(name: string) => Promise<void>} deps.showStage
 * @param {(id: number, opts: {focusContent: boolean}) => boolean} deps.selectTab
 * @param {(region: string) => boolean} deps.focusRegion  focus a region's current item
 * @param {string} deps.host  the stage that hosts the flow ("spawn": Workspace)
 */
export function createSurfaceReturn({ doc, currentWorkspace, workspaceGeneration, surface, tabPane, showStage, selectTab, focusRegion, host }) {
  /** Where the operator is now. `opener` is the focus-return handle of the control they left
   * (captureFocusReturn / takePickerFocusReturn); its original element is resolved here, while
   * it is still visible. */
  function capture(opener) {
    const now = surface();
    const original = opener?.resolve?.() ?? null;
    return {
      workspace: currentWorkspace(), generation: workspaceGeneration(),
      stage: now.stage, tab: now.tabLayerVisible ? now.tab : null, opener, original,
    };
  }

  const idle = () => !doc.activeElement || doc.activeElement === doc.body;

  /** Return to `origin`. True when the return is under way (the caller must not move focus);
   * false when the operator has moved on and the caller restores focus itself. */
  function restore(origin) {
    if (!origin || origin.workspace !== currentWorkspace() || origin.generation !== workspaceGeneration()) return false;
    const now = surface();
    if (now.tabLayerVisible || now.stage !== host) return false;
    if (origin.tab != null) {
      const pane = tabPane(origin.tab);
      if (!pane) return false;
      // The stage under the tabs is part of where they were too (the nav highlight, the sidebar).
      if (origin.stage && origin.stage !== now.stage) void showStage(origin.stage);
      const inPane = !!origin.original && pane.contains(origin.original);
      if (!selectTab(origin.tab, { focusContent: inPane || !origin.opener })) return false;
      // Focus was outside the tab's content (the roster, the tab strip): put it back there.
      if (!inPane && origin.opener && !origin.opener.restore()) selectTab(origin.tab, { focusContent: true });
      return true;
    }
    if (!origin.stage || origin.stage === now.stage) {
      // Same stage (Workspace itself): only the control they left; else the dialog's own restore.
      return !!origin.opener?.restore();
    }
    const switching = showStage(origin.stage);
    Promise.resolve(switching).then(() => {
      const after = surface();
      // Only if nothing newer happened: the same workspace and stage, no tab over it, focus unclaimed.
      if (origin.workspace !== currentWorkspace() || origin.generation !== workspaceGeneration()) return;
      if (after.tabLayerVisible || after.stage !== origin.stage || !idle()) return;
      if (!origin.opener?.restore()) focusRegion("main");
    }, () => {});
    return true;
  }

  return { capture, restore };
}
