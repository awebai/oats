// OATS desktop — application menu policy (pure; unit-tested).
//
// macOS: without an Edit role menu, Cmd+C/V/X/A are dead in the renderer —
// transcript text could be selected but never copied. Cmd-based accelerators
// cannot collide with terminal control chords (those are Ctrl-based), so the
// full role menu is safe there.
//
// Linux/Windows: role menus register Ctrl accelerators (Ctrl+C, Ctrl+A,
// Ctrl+Z, Ctrl+R, Ctrl+W, …) that fire BEFORE web content and would steal
// core terminal chords from xterm — interrupt, line-start, suspend, history
// search, delete-word (review befe75b important 1). Chromium already handles
// clipboard shortcuts natively in web content on these platforms, so the
// correct menu is NO menu: return null and the caller installs none.
//
// One window per workspace (#481): on macOS, File holds New Window ⌘⇧N
// (`newWindow` opens a window with no workspace) before the standard Close
// Window, and the standard Window menu stays, so ⌘` cycles the windows.
// Linux/Windows reach New Window from the palette and the switcher.
export function appMenuTemplate(platform, { newWindow }) {
  if (platform !== "darwin") return null;
  return [
    { role: "appMenu" },
    { label: "File", submenu: [
      { label: "New Window", accelerator: "CmdOrCtrl+Shift+N", click: () => newWindow() },
      { type: "separator" },
      { role: "close" },
    ] },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
}
