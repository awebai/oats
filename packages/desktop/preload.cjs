// OATS desktop — preload. The ONLY bridge between the isolated renderer and
// the main process. Exposes a minimal, promise-based surface; no Node objects
// cross the boundary.
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("oatsDesktop", {
  /** ctx.api backing: proxied fetch against the oats-web server. */
  api: (pathname, opts) => ipcRenderer.invoke("api", pathname, opts),

  /** Integrated terminal channels (one pty per open terminal tab). */
  termOpen: (spec) => ipcRenderer.invoke("term:open", spec),
  termWrite: (id, data) => ipcRenderer.send("term:write", id, data),
  termResize: (id, cols, rows) => ipcRenderer.send("term:resize", id, cols, rows),
  termClose: (id) => ipcRenderer.send("term:close", id),
  termAttachFiles: async (id, files) => {
    if (!Array.isArray(files) || !files.length || files.length > 16) throw new Error("Choose between 1 and 16 files.");
    if (files.reduce((n, f) => n + f.size, 0) > 25 * 1024 * 1024) throw new Error("Attachments must total 25 MB or less.");
    const items = await Promise.all(files.map(async file => {
      const path = webUtils.getPathForFile(file);
      if (path) return { path };
      if (!file.type.startsWith("image/")) throw new Error("This file has no local path.");
      return { type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) };
    }));
    return ipcRenderer.invoke("term:attachments", id, items);
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
  onTermData: (id, cb) => {
    const ch = `term:data:${id}`;
    const fn = (_e, data) => cb(data);
    ipcRenderer.on(ch, fn);
    return () => ipcRenderer.removeListener(ch, fn);
  },
  onTermExit: (id, cb) => {
    const ch = `term:exit:${id}`;
    const fn = (_e, code) => cb(code);
    ipcRenderer.on(ch, fn);
    return () => ipcRenderer.removeListener(ch, fn);
  },
});
