// OATS desktop — preload. The ONLY bridge between the isolated renderer and
// the main process. Exposes a minimal, promise-based surface; no Node objects
// cross the boundary.
const { contextBridge, ipcRenderer, webUtils } = require("electron");
const { createTerminalBridge } = require('./terminal-bridge.cjs');

contextBridge.exposeInMainWorld("oatsDesktop", {
  /** ctx.api backing: proxied fetch against the oats-web server. */
  api: (pathname, opts) => ipcRenderer.invoke("api", pathname, opts),

  /** Leased terminal wire v2; no bare-ID or one-way close compatibility path. */
  ...createTerminalBridge(ipcRenderer, webUtils),

  /** Closed-purpose gh sign-in. No generic executable, cwd, byte/paste or file API. */
  forgeConnect: (connectionRef) => ipcRenderer.invoke('forge:connect', connectionRef),
  forgeDisconnect: (connectionRef) => ipcRenderer.invoke('forge:disconnect', connectionRef),
  forgeAuthKey: (lease, key) => ipcRenderer.invoke('forge:auth-key', lease, key),
  forgeAuthResize: (lease, cols, rows) => ipcRenderer.invoke('forge:auth-resize', lease, cols, rows),
  forgeAuthClose: (lease) => ipcRenderer.invoke('forge:auth-close', lease),
  onForgeChanged: (cb) => {
    const fn = (_e, generation) => cb(generation); ipcRenderer.on('forge:changed', fn);
    return () => ipcRenderer.removeListener('forge:changed', fn);
  },
  onForgeAuthData: (lease, cb) => {
    const channel = `forge:auth-data:${lease}`, fn = (_e, data) => cb(data);
    ipcRenderer.on(channel, fn); return () => ipcRenderer.removeListener(channel, fn);
  },
  onForgeAuthExit: (lease, cb) => {
    const channel = `forge:auth-exit:${lease}`, fn = (_e, data) => cb(data);
    ipcRenderer.on(channel, fn); return () => ipcRenderer.removeListener(channel, fn);
  },

  /** The theme of this computer (#602): plain state (colours and polarity, or the system
   * appearance), never a path or file content. The renderer validates it again before use. */
  hostTheme: () => ipcRenderer.invoke("host-theme:get"),
  onHostThemeChanged: (cb) => {
    const fn = (_e, state) => cb(state); ipcRenderer.on("host-theme:changed", fn);
    return () => ipcRenderer.removeListener("host-theme:changed", fn);
  },

  /** The chord family on Linux/Windows (keys.json, shared with the TUI; chord-family.mjs): plain
   * state ({ family, why, note }), never a path or file content. The Shortcuts page sets it, which
   * writes the file; every window hears the change. The renderer validates it again before use. */
  chordFamily: () => ipcRenderer.invoke("chord-family:get"),
  setChordFamily: (family) => ipcRenderer.invoke("chord-family:set", family),
  onChordFamilyChanged: (cb) => {
    const fn = (_e, state) => cb(state); ipcRenderer.on("chord-family:changed", fn);
    return () => ipcRenderer.removeListener("chord-family:changed", fn);
  },

  /** Runtime workspace switcher (privileged; renderer modal is the UX layer). */
  workspaceSuggestions: () => ipcRenderer.invoke("workspace:suggestions"),
  workspaceAdd: (path) => ipcRenderer.invoke("workspace:add", path),
  workspacePick: () => ipcRenderer.invoke("workspace:pick"),
  /** Onboard the folder behind a picker offer (single-use token) — kernel `oats onboard`. */
  workspaceOnboard: (token, ref) => ipcRenderer.invoke("workspace:onboard", token, ref),
  /** Remove a row of this computer's deployments list (#1390) — kernel `oats deployments remove`. */
  workspaceRemoveListed: (path) => ipcRenderer.invoke("workspace:remove-listed", path),

  /** One window per workspace (#481). Bind this window to a workspace in place (null: to none); a
   * workspace another window holds is refused, and that window focused unless `focus` is false; with
   * `takeOver`, it moves here from that window instead. */
  windowClaimWorkspace: (id, options) => ipcRenderer.invoke("window:claim-workspace", id, options),
  /** A take-over: another window took this window's workspace. `cb({ request, workspace, workspaces })`;
   * the window answers `request` once (windowReleaseAnswer), then leaves that workspace. */
  onWorkspaceRelease: (cb) => {
    const fn = (_e, message) => cb(message); ipcRenderer.on("window:release-workspace", fn);
    return () => ipcRenderer.removeListener("window:release-workspace", fn);
  },
  windowReleaseAnswer: (request, payload) => ipcRenderer.invoke("window:release-answer", request, payload),
  /** A window with no workspace: the served choices, re-read now (#521). */
  windowChoices: () => ipcRenderer.invoke("window:choices"),
  /** Open a workspace's window, or focus the one it has; null opens a New Window (the switcher). */
  windowOpenWorkspace: (id) => ipcRenderer.invoke("window:open-workspace", id),

  /** CLI degradation affordances: native binary picker (Choose oats…) and
   * focus-triggered re-probe notifications (contract re-probe triggers). */
  cliPickBinary: () => ipcRenderer.invoke("cli:pick"),
  onAppFocus: (cb) => {
    const fn = () => cb();
    ipcRenderer.on("app:focus", fn);
    return () => ipcRenderer.removeListener("app:focus", fn);
  },
});
