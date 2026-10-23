// Acquire Electron's process lock before starting a backend or any viewers.
// A repeated launch never starts another app process or server: it is handed
// to the running one with its argv and working directory. A launch naming a
// deployment (--dir, or a working directory that is one) opens or focuses
// that workspace's window, admitting it through the validated add path if
// needed; any other launch focuses the most recently focused window (#481).
//
// A launch of another version (an AppImage or DEB installed while an older Desktop runs) reaches the
// running app too, which then says so and offers to restart into the launched copy: replacing the
// installer never changes a running app. Nothing here imports Electron: main shows the box and
// relaunches.
import { isAbsolute, resolve } from "node:path";

const LAUNCH_ARGS_MAX = 1000;
const VERSION = /^[0-9A-Za-z.+-]{1,64}$/;
const EXEC_PATH_MAX = 4096;
/** The launch a second instance sent with its lock request, when it has the shape sent. `version` and
 * `execPath` are null when absent or malformed (every Desktop before them sends neither). */
function sentLaunch(data) {
  const argv = data?.argv;
  if (!Array.isArray(argv) || argv.length > LAUNCH_ARGS_MAX || !argv.every((a) => typeof a === "string")) return null;
  if (typeof data.workingDirectory !== "string") return null;
  const version = typeof data.version === "string" && VERSION.test(data.version) ? data.version : null;
  const execPath = typeof data.execPath === "string" && data.execPath.length <= EXEC_PATH_MAX
    && isAbsolute(data.execPath) && !data.execPath.includes("\0") ? data.execPath : null;
  return { argv, workingDirectory: data.workingDirectory, version, execPath };
}

/**
 * What this process sends with its lock request: its own argv and working directory, its version, and
 * what relaunches this copy. In an AppImage that is the image file (`APPIMAGE`, the launcher's: main
 * cleans nothing of its own environment); its `execPath` is inside the image's mount, gone once it quits.
 */
export function ownLaunch(app, proc = process) {
  return { argv: proc.argv, workingDirectory: proc.cwd(), version: app.getVersion(),
    execPath: proc.env.APPIMAGE || proc.execPath };
}

/**
 * `launch` is this process's own launch (`ownLaunch`). A second instance sends it with its lock
 * request: Chromium reorders the argv the running instance is handed (switches first, loose arguments
 * last), which can separate --dir from its value. A launch of a version other than this app's is handed
 * to `onOtherVersion(launch, handled)` once `onSecondLaunch` has resolved with `handled` (the window it
 * opened or focused), with the validated launch it sent.
 */
export function startSingleInstance(app, onSecondLaunch, start, launch = ownLaunch(app), onOtherVersion = () => {}) {
  if (!app.requestSingleInstanceLock(launch)) {
    app.quit();
    return false;
  }
  const running = app.getVersion();
  const ready = app.whenReady().then(start);
  app.on("second-instance", (_event, argv, workingDirectory, data) => {
    const sent = sentLaunch(data);
    // A second launch can arrive while the first backend is still starting.
    // Wait for that startup instead of creating a competing window/server.
    void ready.then(async () => {
      const handled = await onSecondLaunch(sent?.argv ?? argv, sent?.workingDirectory ?? workingDirectory);
      if (sent?.version && sent.version !== running) await onOtherVersion(sent, handled);
    }, () => { /* startup reports its own failure */ })
      .catch((error) => console.error(`oats-desktop: second launch not handled: ${error?.message ?? error}`));
  });
  return true;
}

/** The native message box for a launch of `launched` reaching a running `running`: Restart (0) or Keep
 * (1, also Esc) when the launch can be relaunched, else one OK. */
export function versionHandoffBox(launched, running, restartable) {
  const message = `OATS Desktop ${launched} was opened, but ${running} is still running.`;
  const first = "The version you opened takes effect only after this one quits.";
  return restartable
    ? { type: "info", title: "OATS Desktop", message, noLink: true,
      detail: `${first} Restarting closes Desktop's windows and starts ${launched}; your agents keep running in their sessions.`,
      buttons: [`Restart into ${launched}`, `Keep ${running}`], defaultId: 0, cancelId: 1 }
    : { type: "info", title: "OATS Desktop", message, noLink: true,
      detail: `${first} Quit OATS Desktop, then open it again.`, buttons: ["OK"], defaultId: 0, cancelId: 0 };
}

/** `app.relaunch` options that start the launched copy with its own argv (never Chromium's reordered one). */
export function relaunchOptions(launch) {
  return { execPath: launch.execPath, args: launch.argv.slice(1) };
}

/**
 * The running app's answer to a launch of another version (`onOtherVersion`).
 * @param {object} io
 * @param {string} io.running                        this app's version
 * @param {(win: object|null, box: object) => Promise<{response: number}>} io.ask  show the box, over `win` when given
 * @param {(path: string) => boolean} io.isRegularFile  an existing regular file (following links)
 * @param {(options: {execPath: string, args: string[]}) => void} io.relaunch  start it once this app exits
 * @param {() => void} io.quit                       the normal quit path
 * Only one box at a time: a launch arriving while one is open is not asked about. Keep changes nothing;
 * the next launch asks again.
 */
export function createVersionHandoff({ running, ask, isRegularFile, relaunch, quit }) {
  let asking = false;
  const runnable = (path) => { try { return !!path && isRegularFile(path); } catch { return false; } };
  return async function offerRestart(launch, win) {
    if (asking) return;
    asking = true;
    try {
      const restartable = runnable(launch.execPath);
      const { response } = await ask(win ?? null, versionHandoffBox(launch.version, running, restartable));
      if (!restartable || response !== 0) return;
      // Checked again: the file may have gone while the box was open. Never relaunch a path that is not one.
      if (!runnable(launch.execPath)) {
        await ask(win ?? null, versionHandoffBox(launch.version, running, false));
        return;
      }
      relaunch(relaunchOptions(launch));
      quit();
    } catch (error) {
      console.error(`oats-desktop: version message not shown: ${error?.message ?? error}`);
    } finally {
      asking = false;
    }
  };
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
 * @param {(key: string) => object} io.open             open or focus that workspace's window; it
 * @param {() => object|null} io.focusRecent            focus the most recently focused window; it, or null
 * The opener resolves with the window the launch opened or focused, or null.
 */
export function createLaunchOpener({ isDeployment, admit, open, focusRecent }) {
  return async function openLaunch(dir) {
    let deployment = false;
    try { deployment = !!dir && isDeployment(dir); } catch { deployment = false; }
    if (!deployment) return focusRecent();
    const key = await admit(dir);
    return key ? open(key) : focusRecent();
  };
}
