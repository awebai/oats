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

  /** Runtime workspace switcher (privileged; renderer modal is the UX layer). */
  workspaceSuggestions: () => ipcRenderer.invoke("workspace:suggestions"),
  workspaceAdd: (path) => ipcRenderer.invoke("workspace:add", path),
  workspacePick: () => ipcRenderer.invoke("workspace:pick"),

  /** CLI degradation affordances: native binary picker (Choose oats…) and
   * focus-triggered re-probe notifications (contract re-probe triggers). */
  cliPickBinary: () => ipcRenderer.invoke("cli:pick"),
  onAppFocus: (cb) => {
    const fn = () => cb();
    ipcRenderer.on("app:focus", fn);
    return () => ipcRenderer.removeListener("app:focus", fn);
  },
});
