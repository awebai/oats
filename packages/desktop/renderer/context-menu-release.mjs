/** A row's context menu (the workspace row's, an instance row's) opens once the right-click that asked for it is over.
 * Linux and macOS fire a right-click's `contextmenu` on the press; the release that follows, outside the popover just
 * opened, would light-dismiss it at once (the popover's pointerdown/pointerup rule). With a right button still down,
 * `run` waits for its release (nothing on a cancel), and runs in the next task, after the release's light dismiss;
 * otherwise (a key: Shift+F10, the Menu key; Windows, which fires on the release) it runs now. */
export function whenRightButtonReleased(event, run) {
  const win = event.view || event.target?.ownerDocument?.defaultView;
  if (!win || !(event.buttons & 2)) { run(); return; }
  const settle = (end) => {
    win.removeEventListener("pointerup", settle, true); win.removeEventListener("pointercancel", settle, true);
    if (end.type === "pointerup") win.setTimeout(run);
  };
  win.addEventListener("pointerup", settle, true); win.addEventListener("pointercancel", settle, true);
}
