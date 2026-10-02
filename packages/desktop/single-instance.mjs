// Acquire Electron's process lock before starting a backend or any viewers.
// A repeated launch never starts another app process or server: it is handed
// to the running one with its argv and working directory. A launch naming a
// deployment (--dir, or a working directory that is one) opens or focuses
// that workspace's window, admitting it through the validated add path if
// needed; any other launch focuses the most recently focused window (#481).
import { resolve } from "node:path";

const LAUNCH_ARGS_MAX = 1000;
/** The launch a second instance sent with its lock request, when it has the shape sent. */
function sentLaunch(data) {
  const argv = data?.argv;
  if (!Array.isArray(argv) || argv.length > LAUNCH_ARGS_MAX || !argv.every((a) => typeof a === "string")) return null;
  if (typeof data.workingDirectory !== "string") return null;
  return { argv, workingDirectory: data.workingDirectory };
}

/**
 * `launch` is this process's own argv and working directory. A second instance sends them with its
 * lock request: Chromium reorders the argv the running instance is handed (switches first, loose
 * arguments last), which can separate --dir from its value.
 */
export function startSingleInstance(app, onSecondLaunch, start, launch = { argv: process.argv, workingDirectory: process.cwd() }) {
  if (!app.requestSingleInstanceLock(launch)) {
    app.quit();
    return false;
  }
  const ready = app.whenReady().then(start);
  app.on("second-instance", (_event, argv, workingDirectory, data) => {
    const sent = sentLaunch(data);
    // A second launch can arrive while the first backend is still starting.
    // Wait for that startup instead of creating a competing window/server.
    void ready.then(() => onSecondLaunch(sent?.argv ?? argv, sent?.workingDirectory ?? workingDirectory),
      () => { /* startup reports its own failure */ })
      .catch((error) => console.error(`oats-desktop: second launch not handled: ${error?.message ?? error}`));
  });
  return true;
}

/** The directory a launch names: its `--dir` (relative to its working directory), else that working
 * directory, else null. */
export function launchDirectory(argv, workingDirectory) {
  const args = Array.isArray(argv) ? argv : [];
  const i = args.indexOf("--dir");
  const cwd = typeof workingDirectory === "string" && workingDirectory ? workingDirectory : null;
  // A value that is itself a switch is no value (an argv whose switches were reordered).
  const dir = i >= 0 && typeof args[i + 1] === "string" && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
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
