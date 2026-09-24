// OATS desktop — Electron main process.
//
// Responsibilities (per the desktop-app contract):
//   * window + security posture: contextIsolation ON, nodeIntegration OFF,
//     all privileged work behind explicit IPC channels.
//   * server management: connect to a running desktop backend server (default
//     127.0.0.1:4820) or spawn the bundled `server/oats-web.mjs start`
//     as a child; the renderer's ctx.api() proxies to it over IPC.
//   * integrated terminal: node-pty running `tmux attach-session` per
//     terminal tab, bytes streamed to xterm.js over IPC. Closing a tab kills
//     the pty ONLY — the tmux session is the durable host and must survive.
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync, lstatSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { apiUrl, apiInit, classifyApiRoute } from "./api-url.mjs";
import { forgeProxyOptions, FORGE_EPOCH_HEADER, installForgeAuthHandlers, trustedForgeFrame } from "./forge-proxy.mjs";
import { createGhRunner, forgeEnvironment } from "./forge-cli.mjs";
import { createForgeAuthBroker, verifyAuthCli } from "./forge-auth.mjs";
import { forgeFailure } from "./renderer/forge-contract.mjs";
import { lifecycleFailure } from './renderer/lifecycle-contract.mjs';
import { sweepViewers } from "./tmux-target.mjs";
import { tmuxSocketArgs } from "./local-tmux-io.mjs";
import { createTerminalOwnerBroker, installTerminalHandlers } from './terminal-owner.mjs';
import { createTerminalIo } from './terminal-io.mjs';
import { ensureServerOnPort, serverCompatible } from "./server-compat.mjs";
import { createServerHost, createServerAdapter } from "./server-host.mjs";
import { validateWorkspace, workspaceSuggestions, parseRecents, pushRecent, decideAdd, createGenerations, createAddExecutor, restoreWorkspaceDirs, saveWorkspaceDirs, matchWorkspaceDirs } from "./workspace-registry.mjs";
import { resolveDeployment, teamAgentRoots } from "./server/deployment.mjs";
import { appMenuTemplate } from "./app-menu.mjs";
import { proxyReadiness } from './readiness-proxy.mjs';
import { proxySpawnPreview } from './spawn-preview-proxy.mjs';
import { proxyInstanceEvents } from './instance-events-proxy.mjs';
import { proxyScheduleRead, isScheduleReadAlias } from './schedule-read-proxy.mjs';
import { proxySpawnApply } from './spawn-apply-proxy.mjs';
import { startSingleInstance } from "./single-instance.mjs";

const require = createRequire(import.meta.url);
const pty = require("node-pty");

const HERE = dirname(fileURLToPath(import.meta.url));

let port = Number(process.env.OATS_DESKTOP_PORT || 4820);
const base = () => `http://127.0.0.1:${port}`;
// Workspace the panel shows: --dir <path> or OATS_DESKTOP_DIR or the cwd the
// app was launched from. The packaged app never infers a framework repo root
// — with no OATS deployment in view the renderer shows the workspace picker.
const argDir = (() => {
  const i = process.argv.indexOf("--dir");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : undefined;
})();
const WORKSPACE = resolve(argDir || process.env.OATS_DESKTOP_DIR || process.cwd());
// Mutable workspace set: startup workspace plus runtime-added ones — the
// repeated --dir list an app-owned server is (re)started with.
const workspaceDirs = [WORKSPACE];

// ---- backend server management ----------------------------------------
// Server host (server-host.mjs): owns the child lifecycle, the ownership-
// through-transition invariant, and trust-state invalidation on replace.
let invalidateForgeReads = () => {};
let invalidateTerminalPreparations = () => {};
const serverHost = createServerHost({
  spawnChild: (dirs, onPort) => {
    const bin = join(HERE, "server", "oats-web.mjs");
    if (!existsSync(bin)) throw new Error(`desktop backend server not found at ${bin} and no usable server on port ${onPort}`);
    // The persisted user-chosen oats binary (if any) rides along as the
    // server's top-priority discovery candidate; the server re-probes it.
    const chosen = readCliChoice();
    const child = spawn(process.execPath, [bin, "start", "--port", String(onPort),
      ...dirs.flatMap((d) => ["--dir", d]), ...(chosen ? ["--oats-bin", chosen] : [])], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: WORKSPACE,
      // process.execPath is the packaged Electron executable. The backend
      // and its collector children must run as Node, not relaunch the app.
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    child.stdout.on("data", (d) => process.stdout.write(`[oats-desktop-server] ${d}`));
    child.stderr.on("data", (d) => process.stderr.write(`[oats-desktop-server] ${d}`));
    return child;
  },
  // trust state belongs to the outgoing server — stale entries must never
  // validate ?ws= or decideAdd; repopulated only from the current server.
  onInvalidate: () => { allowedWs = new Set(); serverEpoch++; invalidateForgeReads(); invalidateTerminalPreparations(); },
});
let wsId = null;        // verified workspace id on the server we use
let allowedWs = new Set(); // workspace ids the connected server advertises
let serverEpoch = 0;    // prevents an outgoing server response restoring its allowlist

async function panelWorkspaces() {
  try {
    const r = await fetch(`${base()}/api/panel`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return null;
    const d = await r.json();
    const list = d.workspaces || [];
    allowedWs = new Set(list.map((w) => w.id));
    return list;
  } catch { return null; }
}

/** This checkout's bundled-server identity, for the reuse compatibility probe. */
function localServerIdentity() {
  const m = JSON.parse(readFileSync(join(HERE, "package.json"), "utf8"));
  return { capability: m.name, version: m.version };
}

/** Probe GET /api/version on the current port; null on network failure. */
async function probeVersion() {
  try {
    const r = await fetch(`${base()}/api/version`, { signal: AbortSignal.timeout(1500) });
    let body = null; try { body = await r.json(); } catch { /* non-JSON */ }
    return { ok: r.ok, status: r.status, body };
  } catch { return null; }
}

/** The backend must cover every restored workspace before it can be reused. */
function matchWorkspace(workspaces) {
  return matchWorkspaceDirs(workspaceDirs, workspaces);
}

async function freePort(from) {
  const { createServer } = await import("node:net");
  for (let p = from; p < from + 50; p++) {
    const ok = await new Promise((res) => {
      const s = createServer();
      s.once("error", () => res(false));
      s.listen(p, "127.0.0.1", () => s.close(() => res(true)));
    });
    if (ok) return p;
  }
  throw new Error(`no free port in ${from}..${from + 49}`);
}

// Port-committing adapter (server-host.mjs): the production wiring between
// selection and the host — commits the module port before the child starts.
const serverAdapter = createServerAdapter({
  host: serverHost,
  getPort: () => port,
  setPort: (p) => { port = p; },
});
const spawnServer = (onPort, dirs = workspaceDirs) => serverAdapter.spawnServer(onPort, dirs);
const replaceServer = (dirs) => serverAdapter.replaceServer(dirs);

async function ensureServer() {
  // ensureServerOnPort (server-compat.mjs) is the testable seam for the
  // whole step: reuse only a server that covers OUR workspace AND identifies
  // as this checkout via /api/version; otherwise leave it alone and spawn
  // our own — on the next free port when the current one is occupied.
  const r = await ensureServerOnPort({
    panelWorkspaces, probeVersion, matchWorkspace, local: localServerIdentity(),
    port, freePort: (from) => freePort(from), spawnServer: (p) => spawnServer(p),
    log: (m) => console.log(`oats-desktop: ${m}`),
  });
  port = r.port;
  if (!r.spawned) { wsId = r.wsId; return { spawned: false }; }
  // wait for the server to come up (max ~10s) and verify its workspace
  for (let i = 0; i < 40; i++) {
    const ws = await panelWorkspaces();
    if (ws) {
      const id = matchWorkspace(ws);
      if (!id) throw new Error(`spawned backend serves ${ws.map((w) => w.id).join(", ")} — does not cover ${workspaceDirs.join(", ")}`);
      wsId = id;
      return { spawned: true };
    }
    await new Promise((ok) => setTimeout(ok, 250));
  }
  throw new Error("spawned backend server but it never answered /api/panel");
}

// ---- IPC hardening -------------------------------------------------------
// Privileged channels answer ONLY the app's own renderer file. Should any
// navigation slip through (or a compromised page end up in the window), a
// foreign frame gets nothing — not the API proxy, not the terminals.
const RENDERER_URL = `${pathToFileURL(join(HERE, "renderer", "index.html"))}`;
function trustedFrame(e) {
  const url = e.senderFrame?.url || "";
  return url === RENDERER_URL || url.startsWith(`${RENDERER_URL}#`);
}
function guard(e) { if (!trustedFrame(e)) throw new Error("forbidden: untrusted frame"); }

// ---- IPC: workspace suggestions + runtime add ---------------------------
// Privileged side of the runtime workspace switcher (phase-2 hook 3; the
// renderer modal is the designer's). Discovery is bounded: known dirs, team
// siblings via the app-owned read-only deployment reader, validated recents.
// workspace:add only ever replaces an app-OWNED server; foreign servers fail
// closed.
const wsGens = createGenerations();
const RECENTS_FILE = () => join(app.getPath("userData"), "workspace-recents.json");
const OPEN_WORKSPACES_FILE = () => join(app.getPath("userData"), "workspace-open.json");

const wsValidate = (p) => validateWorkspace(p, {
  resolveConfig: (path) => resolveDeployment(path),
  // agents/ OR local-agents/ qualifies — OATS is fully usable with local souls alone.
  hasAgentsRoot: (path) => ["agents", "local-agents"].some((d) => {
    try { return existsSync(join(path, d)) && lstatSync(join(path, d)).isDirectory(); } catch { return false; }
  }),
});

function teamSiblingsOf(p) {
  // Sibling workspaces within p's team scope — same seams as the server's
  // workspaceEntry: the team scope's child repos that themselves validate.
  try {
    const cfg = resolveDeployment(p);
    const scope = cfg?.team?.scope;
    if (!scope) return [];
    return teamAgentRoots(scope).map((root) => dirname(root)).filter((d) => d !== p);
  } catch { return []; }
}

function readRecents() {
  try { return parseRecents(readFileSync(RECENTS_FILE(), "utf8"), (p) => !!wsValidate(p)); }
  catch { return []; }
}
function writeRecents(recents) {
  try { writeFileSync(RECENTS_FILE(), JSON.stringify(recents, null, 2)); } catch { /* best-effort */ }
}

let lastSuggested = new Set(); // canonical paths offered by the latest suggestions call

const executeAdd = createAddExecutor({
  getDirs: () => [...workspaceDirs],
  commitDirs: (dirs) => {
    // Persistence failure leaves the old set intact; the executor restores
    // the previous backend and reports the failed add to the user.
    saveWorkspaceDirs(OPEN_WORKSPACES_FILE(), dirs);
    workspaceDirs.length = 0; workspaceDirs.push(...dirs);
  },
  commitRecent: (p) => writeRecents(pushRecent(readRecents(), p)),
  replaceServer,
  refreshAdvertised: async () => (await panelWorkspaces()) !== null, // true only when the server ANSWERED
  probeVersion,
  // any 2xx is NOT enough during a same-port race — identity must match
  isCompatible: (v) => serverCompatible(v, localServerIdentity()).compatible,
  advertises: async (id) => { await panelWorkspaces(); return allowedWs.has(id); },
});

ipcMain.handle("workspace:suggestions", async (e) => {
  guard(e);
  const gen = wsGens.next("suggestions");
  await panelWorkspaces(); // refresh allowedWs from the live server
  const list = workspaceSuggestions({
    knownPaths: [...workspaceDirs],
    teamSiblings: teamSiblingsOf,
    recents: readRecents(),
    advertised: allowedWs,
    validate: wsValidate,
  });
  if (!wsGens.isCurrent("suggestions", gen)) return { stale: true, suggestions: [] };
  lastSuggested = new Set(list.map((s) => s.path));
  return { stale: false, suggestions: list };
});

async function performAdd(requestedPath, fromPicker) {
  const gen = wsGens.next("add");
  const decision = decideAdd(requestedPath, {
    realpath: (p) => realpathSync(p),
    validate: wsValidate,
    suggestedPaths: lastSuggested,
    fromPicker,
    serverOwned: serverHost.owned(),
    advertised: allowedWs,
  });
  if (!decision.ok) return { ok: false, code: decision.code, reason: decision.reason };
  const ws = decision.workspace;
  if (decision.action === "already-advertised") return { ok: true, workspace: ws };
  // Transactional executor (workspace-registry.mjs): serialized adds, staged
  // dirs, identity-checked readiness, commit-after-ready, restore-on-failure.
  // Terminals are unaffected throughout: viewers attach to tmux, not the backend.
  return executeAdd(ws, () => wsGens.isCurrent("add", gen));
}

ipcMain.handle("workspace:add", async (e, requestedPath) => {
  guard(e);
  if (typeof requestedPath !== "string" || !requestedPath.startsWith("/")) return { ok: false, code: "bad-path", reason: "path must be an absolute string" };
  return performAdd(requestedPath, false);
});

ipcMain.handle("workspace:pick", async (e) => {
  guard(e);
  // Explicit separate action: native directory picker feeding the SAME
  // validation path (fromPicker bypasses only the suggestion-set provenance
  // check — canonicalization and workspace validation still apply).
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
  if (r.canceled || !r.filePaths?.[0]) return { ok: false, code: "cancelled", reason: "picker cancelled" };
  return performAdd(r.filePaths[0], true);
});

// ---- IPC: CLI binary picker (Choose oats…) --------------------------------
// Native file picker for the degradation card. Persistence lives here (the
// main process owns userData); the picked path goes to the server via the
// renderer's POST /api/cli/reprobe {bin} — the server re-validates with the
// full probe, so a bad pick degrades with diagnostics, never trusts a path.
const CLI_CHOICE_FILE = () => join(app.getPath("userData"), "oats-cli-choice.json");
function readCliChoice() {
  try { const p = JSON.parse(readFileSync(CLI_CHOICE_FILE(), "utf8")).bin; return typeof p === "string" && p.startsWith("/") ? p : null; }
  catch { return null; }
}
function writeCliChoice(bin) {
  try { writeFileSync(CLI_CHOICE_FILE(), JSON.stringify({ bin })); } catch { /* best-effort */ }
}
ipcMain.handle("cli:pick", async (e) => {
  guard(e);
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win, {
    title: "Choose the oats CLI binary",
    properties: ["openFile", "showHiddenFiles"],
    message: "Select the oats executable (e.g. from `command -v oats`)",
  });
  if (r.canceled || !r.filePaths?.[0]) return { path: null };
  writeCliChoice(r.filePaths[0]);           // persisted — top discovery priority next launch
  return { path: r.filePaths[0] };
});

// ---- IPC: API proxy -----------------------------------------------------
// The renderer never talks to the network directly; ctx.api() lands here.
ipcMain.handle("api", async (e, pathname, opts) => {
  // One normalized classifier owns every specialized routing decision;
  // aliases cannot bypass frame/epoch guards, deadlines or typed failures.
  const route = classifyApiRoute(pathname, base());
  if (route === 'spawn-apply') {
    return proxySpawnApply(e, pathname, opts, { rendererURL: RENDERER_URL,
      connection: () => ({ base: base(), wsId, allowedWs, epoch: serverEpoch, transition: serverHost.inTransition() }) });
  }
  if (route === 'spawn-preview') {
    return proxySpawnPreview(e, pathname, opts, { rendererURL: RENDERER_URL,
      connection: () => ({ base: base(), wsId, allowedWs, epoch: serverEpoch, transition: serverHost.inTransition() }) });
  }
  if (route === 'instance-events') {
    return proxyInstanceEvents(e, pathname, opts, { rendererURL: RENDERER_URL,
      connection: () => ({ base: base(), wsId, allowedWs, epoch: serverEpoch, transition: serverHost.inTransition() }) });
  }
  if (route === 'schedule-read' || route === 'schedules' && isScheduleReadAlias(opts)) {
    return proxyScheduleRead(e, pathname, opts, { rendererURL: RENDERER_URL,
      connection: () => ({ base: base(), wsId, allowedWs, epoch: serverEpoch, transition: serverHost.inTransition() }) });
  }
  if (route === 'readiness') {
    return proxyReadiness(e, pathname, opts, { rendererURL: RENDERER_URL,
      connection: () => ({ base: base(), wsId, allowedWs, epoch: serverEpoch, transition: serverHost.inTransition() }) });
  }
  const lifecycle = route === 'lifecycle';
  const forgeRequest = lifecycle || route === 'forge';
  const failure = lifecycle ? lifecycleFailure : forgeFailure;
  const mutation = lifecycle && (() => { try { return (typeof opts?.body === 'string' ? JSON.parse(opts.body) : opts?.body)?.action === 'apply'; } catch { return false; } })();
  if (forgeRequest && !trustedForgeFrame(e, RENDERER_URL)) return { ok: false, status: 403, body: failure('E_FORBIDDEN_FRAME') };
  const forgeFrame = forgeRequest ? e.senderFrame : null;
  const ownsForgeFrame = () => trustedForgeFrame(e, RENDERER_URL) && e.sender.mainFrame === forgeFrame;
  try {
  guard(e);
  // apiUrl rejects off-origin resolution (e.g. "//attacker/x"), and pins
  // the verified workspace on scoped endpoints unless the caller selects a
  // workspace this server actually advertises (the views' ws switcher).
  const url = apiUrl(pathname, base(), wsId, allowedWs);
  const epoch = serverHost.inTransition() ? null : serverEpoch;
  // apiInit forwards pre-serialized (string) bodies and headers unchanged —
  // views serialize once in common.mjs::postJson — and serializes object
  // bodies itself.
  // Provider actions may perform bounded work before returning their receipt.
  // Let the CLI's five-minute limit report the outcome before the proxy times out.
  const forge = route === 'forge' ? forgeProxyOptions(url.pathname, opts, currentForgeEpoch()) : null;
  const timeout = lifecycle ? mutation ? 610_000 : 35_000 : forge?.timeout ?? (route === 'capabilities' ? 310_000 : 20_000);
  const init = { ...(forge?.init ?? apiInit(opts)), signal: AbortSignal.timeout(timeout) };
  const r = await fetch(url, init);
  const text = await r.text();
  if ((forge || lifecycle) && !ownsForgeFrame()) return { ok: false, status: 403, body: failure('E_FORBIDDEN_FRAME') };
  let json; try { json = JSON.parse(text); } catch { json = lifecycle ? failure(mutation ? 'E_OUTCOME_UNKNOWN' : 'E_CLI_PROTOCOL', { status: mutation ? 'unknown' : 'unavailable' })
    : forge ? forgeFailure('E_GH_PROTOCOL') : { raw: text }; }
  if ((forge || lifecycle) && (epoch !== serverEpoch || serverHost.inTransition()
    || forge && forge.init.headers[FORGE_EPOCH_HEADER] !== currentForgeEpoch())) json = lifecycle
      ? failure(mutation ? 'E_OUTCOME_UNKNOWN' : 'E_PLAN_CHANGED', { status: mutation ? 'unknown' : 'unavailable' }) : forgeFailure('E_CONNECTION_CHANGED');
  // Remote discovery can finish after startup. Accept the same server-owned
  // choices the menu receives, without adding requests to workspace polling.
  if (epoch === serverEpoch && !serverHost.inTransition() && r.ok && route === 'panel' && Array.isArray(json?.workspaces)) {
    allowedWs = new Set(json.workspaces.map((w) => w?.id).filter((id) => typeof id === "string"));
  }
  return { ok: r.ok, status: r.status, body: json };
  } catch (error) {
    if (forgeRequest) return ownsForgeFrame() ? { ok: false, status: 503, body: lifecycle
      ? failure(mutation ? 'E_OUTCOME_UNKNOWN' : 'E_CLI_FAILED', { status: mutation ? 'unknown' : 'unavailable' }) : forgeFailure('E_GH_FAILED') }
      : { ok: false, status: 403, body: failure('E_FORBIDDEN_FRAME') };
    throw error;
  }
});

// ---- IPC: workstation forge auth (separate from ALL agent terminals) ----
const forgeClient = randomBytes(16).toString('hex');
const forgeEnv = forgeEnvironment();
const runGh = createGhRunner({ env: forgeEnv });
const currentForgeEpoch = () => `${forgeClient}:${forgeAuth.generation()}`;
const forgeAuth = createForgeAuthBroker({
  env: forgeEnv,
  readConnection: async connectionRef => {
    const serverLease = serverEpoch, readEpoch = currentForgeEpoch();
    if (serverHost.inTransition()) return forgeFailure('E_CONNECTION_CHANGED');
    try {
      const response = await fetch(`${base()}/api/forge-connections`, {
        method: 'POST', headers: { 'content-type': 'application/json', [FORGE_EPOCH_HEADER]: readEpoch },
        body: JSON.stringify({ hostRef: connectionRef }), signal: AbortSignal.timeout(25_000),
      });
      const result = await response.json();
      if (!response.ok || serverLease !== serverEpoch || serverHost.inTransition() || readEpoch !== currentForgeEpoch()
        || result?.readEpoch !== readEpoch) return forgeFailure('E_CONNECTION_CHANGED');
      return result;
    } catch { return forgeFailure('E_GH_FAILED'); }
  },
  verify: cli => verifyAuthCli(cli, runGh, forgeEnv),
  launchPty: (bin, args, options) => pty.spawn(bin, args, options),
  run: runGh,
  confirm: async ({ owner, host, login, signal }) => {
    const result = await dialog.showMessageBox(BrowserWindow.fromWebContents(owner), {
      type: 'warning', title: 'Disconnect GitHub', message: `Sign out ${login} on ${host}?`,
      detail: 'This removes this account from GitHub CLI on this machine, affecting all workspaces and other uses of gh. It does not revoke the token on GitHub. Another stored account may become active.',
      buttons: ['Cancel', 'Sign out'], defaultId: 0, cancelId: 0, noLink: true, signal,
    });
    return result.response === 1;
  },
  alive: owner => trustedForgeFrame({ sender: owner, senderFrame: owner.mainFrame }, RENDERER_URL),
  emit: (owner, lease, kind, data) => owner.send(`forge:auth-${kind}:${lease}`, data),
  changed: generation => {
    for (const win of BrowserWindow.getAllWindows()) {
      try { if (!win.webContents.isDestroyed()) win.webContents.send('forge:changed', generation); } catch { /* closing window */ }
    }
  },
});
invalidateForgeReads = () => forgeAuth.invalidate();
const forgeOwners = new WeakSet();
installForgeAuthHandlers({ ipc: ipcMain, broker: forgeAuth, rendererUrl: RENDERER_URL, wireOwner: owner => {
  if (forgeOwners.has(owner)) return; forgeOwners.add(owner);
  const drop = () => forgeAuth.dropOwner(owner);
  owner.on('did-start-navigation', (_event, _url, inPlace, isMainFrame) => { if (isMainFrame && !inPlace) drop(); });
  owner.on('render-process-gone', drop); owner.once('destroyed', drop);
} });

// ---- IPC: integrated terminal (leased linked-window viewers) ------------
// The shared broker owns process-wide reservations, document principals,
// current-owner output and confirmed cleanup. No numeric-ID IPC lane.
const terminalContext = () => serverHost.inTransition() ? null : `${serverEpoch}:${base()}`;
const terminalBroker = createTerminalOwnerBroker({ rendererUrl: RENDERER_URL, context: terminalContext,
  io: createTerminalIo({ base, context: terminalContext,
    attachmentDirectory: () => join(app.getPath('userData'), 'attachments'),
    spawnPty: (...args) => pty.spawn(...args), execFileSync, sweep: sweepOrphanViewers,
  }),
});
invalidateTerminalPreparations = () => terminalBroker.invalidatePreparations();
installTerminalHandlers(ipcMain, terminalBroker);

const tmuxRun = (args) => execFileSync("tmux", args, { stdio: "ignore", timeout: 4000 });

/** Sweep crashed Desktop viewers on one socket (dead oatsdesk-<pid>- owners only).
 * Startup/quit sweep the default socket; opening a terminal also sweeps its
 * saved socket. Normal close/quit uses each viewer's own scoped cleanup. */
function sweepOrphanViewers(socket) {
  try {
    const prefix = tmuxSocketArgs(socket);
    const names = execFileSync("tmux", [...prefix, "list-sessions", "-F", "#{session_name}"], { encoding: "utf8", timeout: 4000 })
      .split("\n").filter(Boolean);
    const swept = sweepViewers({
      listSessions: () => names,
      killSession: (name) => tmuxRun([...prefix, "kill-session", "-t", `=${name}`]),
      pidAlive: (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } },
    });
    if (swept.length) console.log(`oats-desktop: swept ${swept.length} orphaned viewer session(s): ${swept.join(", ")}`);
  } catch { /* no tmux server — nothing to sweep */ }
}

// ---- window -------------------------------------------------------------
// Application menu policy lives in app-menu.mjs (pure, unit-tested):
// role menu on macOS only (Cmd accelerators cannot collide with terminal
// Ctrl chords); NO menu elsewhere — role menus on Linux/Windows register
// Ctrl accelerators that steal xterm's terminal control keys (review
// befe75b important 1), and Chromium handles clipboard shortcuts natively.
function installAppMenu() {
  const template = appMenuTemplate(process.platform);
  Menu.setApplicationMenu(template ? Menu.buildFromTemplate(template) : null);
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "OATS Desktop",
    backgroundColor: "#16161e",
    webPreferences: {
      preload: join(HERE, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload needs require() for contextBridge; renderer stays isolated
    },
  });
  // Register hooks before loadFile or any terminal request/preparation.
  terminalBroker.register(win.webContents);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  // Navigation lock: the window may only ever show our renderer file. Links
  // in future views (markdown, chat) open externally; everything else is
  // denied — a navigated-to page would otherwise inherit the preload bridge.
  win.webContents.on("will-navigate", (event, url) => {
    if (url === RENDERER_URL || url.startsWith(`${RENDERER_URL}#`)) return;
    event.preventDefault();
    if (/^https?:/.test(url)) shell.openExternal(url);
  });
  await win.loadFile(join(HERE, "renderer", "index.html"));
  // Right-click copy for selected transcript/view text (and standard edit
  // actions in editable fields). Menu items come from Electron's editFlags —
  // nothing shows when nothing is applicable.
  win.webContents.on("context-menu", (_event, params) => {
    const items = [];
    if (params.isEditable) {
      items.push({ role: "cut", enabled: params.editFlags.canCut });
      items.push({ role: "copy", enabled: params.editFlags.canCopy });
      items.push({ role: "paste", enabled: params.editFlags.canPaste });
      items.push({ role: "selectAll", enabled: params.editFlags.canSelectAll });
    } else if (params.selectionText.trim()) {
      items.push({ role: "copy", enabled: params.editFlags.canCopy });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });
}

const primaryInstance = startSingleInstance(app, () => BrowserWindow.getAllWindows(), async () => {
  installAppMenu();
  sweepOrphanViewers(); // default socket now; saved sockets are swept when opened
  let saved = "[]";
  try { saved = readFileSync(OPEN_WORKSPACES_FILE(), "utf8"); } catch { /* first launch */ }
  workspaceDirs.splice(0, workspaceDirs.length,
    ...restoreWorkspaceDirs(WORKSPACE, saved, (p) => wsValidate(realpathSync(p))));
  try {
    await ensureServer();
    if (serverHost.owned()) saveWorkspaceDirs(OPEN_WORKSPACES_FILE(), workspaceDirs);
  }
  catch (e) { console.error(`oats-desktop: ${e.message}`); }
  await createWindow();
  // Contract re-probe trigger "app focus": notify the renderer, which calls
  // POST /api/cli/reprobe (the server owns probe state and rate semantics).
  app.on("browser-window-focus", () => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.webContents.isDestroyed()) w.webContents.send("app:focus");
    }
  });
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

if (primaryInstance) app.on("window-all-closed", () => { app.quit(); });

async function shutdown() {
  try { forgeAuth.dispose(); } catch { /* other resource cleanup must still run */ } // ephemeral gh child only
  // Detach every pty and kill its viewer session (never the durable
  // sessions); stop the server only if we started it; sweep any orphans.
  await terminalBroker.dispose(); // bounded grace for async viewer cleanup, never a fake release
  sweepOrphanViewers();
  serverHost.stop();
}
let quitStarted = false, quitReady = false;
if (primaryInstance) app.on('before-quit', event => {
  if (quitReady) return;
  event.preventDefault();
  if (quitStarted) return;
  quitStarted = true;
  void shutdown().catch(() => { /* quit remains bounded; no raw errors/extra signals */ })
    .finally(() => { quitReady = true; app.quit(); });
});
// Existing quit signals enter the same bounded cleanup path; no extra signal
// or PID fallback is sent to terminals or their durable sources.
for (const sig of primaryInstance ? ["SIGTERM", "SIGINT", "SIGHUP"] : []) {
  process.on(sig, () => app.quit());
}
