// Acquire Electron's process lock before starting a backend or any viewers.
// A repeated launch only raises the existing window; workspace changes use
// that window's validated switcher rather than creating another app process.
export function startSingleInstance(app, getWindows, start) {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }
  const ready = app.whenReady().then(start);
  app.on("second-instance", () => {
    // A second launch can arrive while the first backend is still starting.
    // Wait for that startup instead of creating a competing window/server.
    void ready.then(() => {
      const win = getWindows().find((w) => !w.isDestroyed());
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }).catch(() => { /* startup reports its own failure */ });
  });
  return true;
}
