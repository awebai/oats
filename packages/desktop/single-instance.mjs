// Acquire Electron's process lock before starting a backend or any viewers.
// A repeated launch never starts another app process or server: it is handed
// to the running one with its argv and working directory. A launch naming a
// deployment (--dir, or a working directory that is one) opens or focuses
// that workspace's window, admitting it through the validated add path if
// needed; any other launch focuses the most recently focused window (#481).
import { resolve } from "node:path";

export function startSingleInstance(app, onSecondLaunch, start) {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }
  const ready = app.whenReady().then(start);
  app.on("second-instance", (_event, argv, workingDirectory) => {
    // A second launch can arrive while the first backend is still starting.
    // Wait for that startup instead of creating a competing window/server.
    void ready.then(() => onSecondLaunch(argv, workingDirectory))
      .catch(() => { /* startup and the launch report their own failures */ });
  });
  return true;
}

/** The directory a launch names: its `--dir` (relative to its working directory), else that working
 * directory, else null. */
export function launchDirectory(argv, workingDirectory) {
  const args = Array.isArray(argv) ? argv : [];
  const i = args.indexOf("--dir");
  const cwd = typeof workingDirectory === "string" && workingDirectory ? workingDirectory : null;
  const dir = i >= 0 && typeof args[i + 1] === "string" && args[i + 1] ? args[i + 1] : null;
  if (dir) return resolve(cwd || "/", dir);
  return cwd;
}

/**
 * What a launch naming `dir` does in the running app.
 * @param {object} io
 * @param {(dir: string) => boolean} io.isDeployment   a workspace-model v2 deployment (oats-local.yaml)
 * @param {(dir: string) => Promise<string|null>} io.admit  the validated add path; the view key that
 *                                                       holds the deployment, or null when it failed
 * @param {(key: string) => void} io.open               open or focus that workspace's window
 * @param {() => void} io.focusRecent                   focus the most recently focused window
 */
export function createLaunchOpener({ isDeployment, admit, open, focusRecent }) {
  return async function openLaunch(dir) {
    let deployment = false;
    try { deployment = !!dir && isDeployment(dir); } catch { deployment = false; }
    if (!deployment) { focusRecent(); return; }
    const key = await admit(dir);
    if (key) open(key);
    else focusRecent();
  };
}
