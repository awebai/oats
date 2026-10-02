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
import { app, BrowserWindow, dialog, ipcMain, Menu, screen, shell } from "electron";
import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync, lstatSync, statSync, opendirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { apiUrl, apiInit, classifyApiRoute, createUnservedRefusal, servedSelectors, windowRefusal } from "./api-url.mjs";
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
import { cliWorkspace, validWorkspaceRef } from "./workspace-cli.mjs";
import { onboardData } from "./deployment-data.mjs";
import { validateWorkspace, workspaceSuggestions, parseRecents, pushRecent, decideAdd, createGenerations, createAddExecutor, restoreWorkspaceDirs, saveWorkspaceDirs, commitOpenSet, startupOpenSet, matchWorkspaceDirs, createOnboardOffers, createOnboardExecutor,
  savedWorkspacePaths, persistableDirs, stageDirs, pickedFolderChoices, createPerformAdd, createSuggestionCalls } from "./workspace-registry.mjs";
import { workspaceNotServed } from "./renderer/deployment-header.mjs";
import { appMenuTemplate } from "./app-menu.mjs";
import { resolveLoginPath } from "./login-path.mjs";
import { pickerDefaultPath, workspacePickerCandidates, cliPickerCandidates, parseLastWorkspaceParent, lastWorkspaceParentState } from "./picker-default-path.mjs";
import { proxyReadiness } from './readiness-proxy.mjs';
import { proxySpawnPreview } from './spawn-preview-proxy.mjs';
import { proxyInstanceEvents } from './instance-events-proxy.mjs';
import { proxySpawnApply } from './spawn-apply-proxy.mjs';
import { startSingleInstance, launchDirectory, createLaunchOpener } from "./single-instance.mjs";
import { createActivityNotifier } from "./window-activity.mjs";
import { frameWorkspace, trustedRendererUrl, workspaceHash } from "./renderer/window-binding.mjs";
import { validWorkspaceId } from "./renderer/workspace-id.mjs";
import { createWindowSet } from "./window-set.mjs";
import { parseWindowRecords, resolveView, restorePlan, clampBounds, windowTitle, createWindowRecords } from "./window-records.mjs";

const require = createRequire(import.meta.url);
const pty = require("node-pty");

const HERE = dirname(fileURLToPath(import.meta.url));

let port = Number(process.env.OATS_DESKTOP_PORT || 4820);
const base = () => `http://127.0.0.1:${port}`;
// Window activity → backend refresh cadence: the server backs its kernel
// polling off while every window is blurred/hidden and refreshes promptly
// when one returns. Main posts directly (as it already does for /api/panel
// and /api/cli): it alone sees all windows, and the renderer must not gain a
// new IPC surface for a fact main already holds. Edge-triggered in
// window-activity.mjs so an event burst is one POST.
const activity = createActivityNotifier({
  post: body => fetch(`${base()}/api/window-state`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(1500),
  }),
});
const noteWindowActivity = () => { activity.update(BrowserWindow.getAllWindows()); };
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
// The persisted open set (workspace-open.json): the saved paths, kept even while they do not
// validate, plus what was added. The served set above is only what validates (#472).
let openDirs = [];
// Every deployment path this Desktop has had open or saved this session (the saved set as read,
// the open set, each committed add). A known deployment the server does not serve is reported
// (E_WORKSPACE_NOT_SERVED) and may be re-added; an unknown id is adopted as before (#461).
const knownDirs = new Set();
const knowDirs = (dirs) => { for (const d of dirs) if (typeof d === "string" && d.startsWith("/")) knownDirs.add(d); };

// ---- the login shell's PATH (login-path.mjs, awebai/oats#468) ----------
// Opened from Finder or the Dock, the app inherits launchd's PATH, which has
// no Homebrew or nvm node for a `#!/usr/bin/env node` CLI (nor tmux, nor gh's
// git). Resolved once at startup, BEFORE anything is spawned, and merged into
// this process's own PATH, so the backend server, every oats call, the CLI
// probe, tmux and terminals inherit it. Only PATH is taken from the shell.
let loginPath = { source: "inherited", error: null };
async function applyLoginPath() {
  const r = await resolveLoginPath({ env: process.env });
  loginPath = { source: r.source, error: r.error };
  if (r.source !== "login-shell") { console.error(`oats-desktop: keeping the inherited PATH: ${r.error}`); return; }
  process.env.PATH = r.path;
  forgeEnv.PATH = r.path; // the one environment copied at module load
}

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
      ...dirs.flatMap((d) => ["--dir", d]), ...(chosen ? ["--oats-bin", chosen] : []),
      // Where the PATH it inherits came from, for /api/cli diagnostics.
      "--path-source", loginPath.source, ...(loginPath.error ? ["--path-error", loginPath.error] : []),
      // The remembered remote workspace identities (#482): the server owns the file, written atomically.
      "--remote-identity", REMOTE_IDENTITY_FILE()], {
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
  onInvalidate: () => { if (allowedWs.size) advertisedBefore = allowedWs; allowedWs = new Set(); serverEpoch++; invalidateForgeReads(); invalidateTerminalPreparations(); },
});
let wsId = null;        // verified workspace id on the server we use
let allowedWs = new Set(); // workspace ids the connected server advertises
// What the outgoing server advertised, kept only to refuse an unserved deployment's reads while a
// restart is in flight: they never validate a ?ws=, they only stop one from being rewritten.
let advertisedBefore = new Set();
let serverEpoch = 0;    // prevents an outgoing server response restoring its allowlist
let servedList = [];    // the served workspace views (/api/panel `workspaces`): window titles and restore
/** The served list changed: remember it, retitle every window from it, and keep each window's record
 * of the deployments its view holds (written only when that changed). */
function noteServed(list) {
  servedList = list;
  for (const [win, key] of windows.entries()) {
    win.setTitle(windowTitle(key, servedList));
    if (key !== null) windowRecords?.bind(win, key, undefined, servedList);
  }
}
/** What the server advertises, or while a restart is in flight what the outgoing one did. */
const advertisedNow = () => (allowedWs.size ? allowedWs : advertisedBefore);

async function panelWorkspaces() {
  try {
    const r = await fetch(`${base()}/api/panel`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return null;
    const d = await r.json();
    const list = d.workspaces || [];
    allowedWs = servedSelectors(list);
    noteServed(list);
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
// Privileged channels answer ONLY the app's own renderer file, with no hash
// or the #ws= that binds its window (renderer/window-binding.mjs, #481).
// Should any navigation slip through (or a compromised page end up in the
// window), a foreign frame gets nothing — not the API proxy, not the terminals.
const RENDERER_URL = `${pathToFileURL(join(HERE, "renderer", "index.html"))}`;
function trustedFrame(e) {
  return trustedRendererUrl(e.senderFrame?.url, RENDERER_URL);
}
function guard(e) { if (!trustedFrame(e)) throw new Error("forbidden: untrusted frame"); }

// ---- IPC: workspace suggestions + runtime add ---------------------------
// Privileged side of the runtime workspace switcher (phase-2 hook 3; the
// renderer owns the modal). Discovery is bounded: known deployment
// dirs and validated recents. The kernel reads the deployment itself.
// workspace:add only ever replaces an app-OWNED server; foreign servers fail
// closed.
const wsGens = createGenerations();
/** The window a privileged workspace call comes from (#481): its own generations and provenance. */
const windowScope = (e) => String(e.sender.id);
const RECENTS_FILE = () => join(app.getPath("userData"), "workspace-recents.json");
const OPEN_WORKSPACES_FILE = () => join(app.getPath("userData"), "workspace-open.json");
// The last workspace identity each remote roster group reported (server/remote-identity.mjs, #482).
const REMOTE_IDENTITY_FILE = () => join(app.getPath("userData"), "remote-identity.json");

// A workspace-model v2 deployment is a directory holding a regular (lstat,
// non-following) oats-local.yaml. Existence only: never parsed here.
const wsValidate = (p) => validateWorkspace(p, {
  isDeployment: (path) => {
    try { return lstatSync(join(path, "oats-local.yaml")).isFile(); } catch { return false; }
  },
});

function readRecents() {
  try { return parseRecents(readFileSync(RECENTS_FILE(), "utf8"), (p) => !!wsValidate(p)); }
  catch { return []; }
}
function writeRecents(recents) {
  try { writeFileSync(RECENTS_FILE(), JSON.stringify(recents, null, 2)); } catch { /* best-effort */ }
}
// Where Add workspace → Browse… opens next (picker-default-path.mjs): the
// parent of the workspace most recently added or opened, across launches.
const LAST_WORKSPACE_PARENT_FILE = () => join(app.getPath("userData"), "last-workspace-parent.json");
function readLastWorkspaceParent() {
  try { return parseLastWorkspaceParent(readFileSync(LAST_WORKSPACE_PARENT_FILE(), "utf8")); }
  catch { return null; }
}
function rememberWorkspaceParent(workspacePath) {
  try { writeFileSync(LAST_WORKSPACE_PARENT_FILE(), lastWorkspaceParentState(workspacePath)); } catch { /* best-effort */ }
}

// Per window: the deployments offered beside its latest refused pick (#461).
const lastPickChoices = new Map();

const executeAdd = createAddExecutor({
  getDirs: () => [...workspaceDirs],
  stage: (dirs, path) => stageDirs(dirs, path, wsValidate),
  commitDirs: (dirs) => {
    // Persistence failure leaves the old set intact; the executor restores
    // the previous backend and reports the failed add to the user. The persisted
    // set keeps every saved deployment, served or not (#472).
    const next = commitOpenSet({ open: openDirs }, dirs, (open) => saveWorkspaceDirs(OPEN_WORKSPACES_FILE(), open));
    openDirs = next.open;
    workspaceDirs.length = 0; workspaceDirs.push(...next.served);
    knowDirs(dirs);
  },
  commitRecent: (p) => writeRecents(pushRecent(readRecents(), p)),
  replaceServer,
  refreshAdvertised: async () => (await panelWorkspaces()) !== null, // true only when the server ANSWERED
  probeVersion,
  // any 2xx is NOT enough during a same-port race — identity must match
  isCompatible: (v) => serverCompatible(v, localServerIdentity()).compatible,
  advertises: async (id) => { await panelWorkspaces(); return allowedWs.has(id); },
});

// Each window's latest call, and the canonical paths it offered (createSuggestionCalls).
const suggestionCalls = createSuggestionCalls({
  generations: wsGens,
  refresh: () => panelWorkspaces(), // refresh allowedWs from the live server
  list: () => workspaceSuggestions({
    knownPaths: [...workspaceDirs],
    recents: readRecents(),
    advertised: allowedWs,
    validate: wsValidate,
  }),
});
ipcMain.handle("workspace:suggestions", async (e) => {
  guard(e);
  return suggestionCalls.suggest(windowScope(e));
});

// The entry point of every add (workspace-registry.mjs createPerformAdd): a refusal returns before
// any effect, a non-deployment pick is answered with where the deployment is (or, with none near,
// the onboarding offer), and an accepted add runs the transactional executor (serialized adds,
// staged dirs, identity-checked readiness, commit-after-ready, restore-on-failure). Terminals are
// unaffected throughout: viewers attach to tmux, not the backend.
const performAdd = createPerformAdd({
  generations: wsGens,
  decide: (requestedPath, fromPicker, scope) => decideAdd(requestedPath, {
    realpath: (p) => realpathSync(p),
    validate: wsValidate,
    // Provenance: a suggestion or a deployment offered beside a refused pick in the asking window, or
    // one this Desktop knows (Re-add of a deployment the server stopped serving). Never an arbitrary path.
    suggestedPaths: new Set([...suggestionCalls.offered(scope), ...(lastPickChoices.get(scope) || []), ...knownDirs]),
    fromPicker,
    serverOwned: serverHost.owned(),
    advertised: allowedWs,
  }),
  realpath: (p) => realpathSync(p),
  choices: (dir, scope) => {
    const found = pickedFolderChoices(dir, { list: listEntries, isDeployment: (p) => !!wsValidate(p) });
    lastPickChoices.set(scope, new Set(found.choices.map((c) => c.path)));
    return found;
  },
  offer: (path) => onboardOffers.offer(path),
  execute: (ws, isCurrent) => executeAdd(ws, isCurrent),
  // An add that opened a workspace (or found it already open) remembers its parent for the picker (#460).
  added: (ws) => rememberWorkspaceParent(ws.path),
});

/** At most `limit` entries of `dir`, typed by the entry itself (a link is not a directory). */
function listEntries(dir, limit) {
  const handle = opendirSync(dir);
  const entries = [];
  try {
    for (let entry; entries.length < limit && (entry = handle.readSync());) entries.push({ name: entry.name, isDirectory: entry.isDirectory() });
    return { entries, limited: entries.length >= limit && handle.readSync() !== null };
  } finally { handle.closeSync(); }
}

const onboardOffers = createOnboardOffers({ token: () => randomBytes(16).toString("hex") });
const onboardExecutor = createOnboardExecutor({
  take: (token) => onboardOffers.take(token),
  offer: (path) => onboardOffers.offer(path),
  realpath: (p) => realpathSync(p),
  isDeployment: (p) => !!wsValidate(p),
  // The server's accepted probe: the same binary every other kernel verb uses.
  readCli: async () => (await fetch(`${base()}/api/cli`, { signal: AbortSignal.timeout(10_000) })).json(),
  run: (cli, options) => cliWorkspace(cli, options),
  project: onboardData,
  add: (dir, scope) => performAdd(dir, true, scope),
  validRef: validWorkspaceRef,
});
ipcMain.handle("workspace:onboard", async (e, token, ref) => {
  guard(e);
  return onboardExecutor(token, ref, windowScope(e));
});

ipcMain.handle("workspace:add", async (e, requestedPath) => {
  guard(e);
  if (typeof requestedPath !== "string" || !requestedPath.startsWith("/")) return { ok: false, code: "bad-path", reason: "path must be an absolute string" };
  return performAdd(requestedPath, false, windowScope(e));
});

const isDirectory = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
ipcMain.handle("workspace:pick", async (e) => {
  guard(e);
  // Explicit separate action: native directory picker feeding the SAME
  // validation path (fromPicker bypasses only the suggestion-set provenance
  // check — canonicalization and workspace validation still apply).
  const win = BrowserWindow.fromWebContents(e.sender);
  // Opens beside the most recently added workspace (picker-default-path.mjs).
  const defaultPath = pickerDefaultPath({
    candidates: workspacePickerCandidates({
      last: readLastWorkspaceParent(), recents: readRecents(), open: workspaceDirs.filter((p) => !!wsValidate(p)),
    }),
    exists: isDirectory,
    home: app.getPath("home"),
  });
  const r = await dialog.showOpenDialog(win, { defaultPath, properties: ["openDirectory"] });
  if (r.canceled || !r.filePaths?.[0]) return { ok: false, code: "cancelled", reason: "picker cancelled" };
  return performAdd(r.filePaths[0], true, windowScope(e));
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
// The CLI the backend resolved, for the picker's starting directory only.
async function resolvedCliBin() {
  try { const bin = (await (await fetch(`${base()}/api/cli`, { signal: AbortSignal.timeout(1500) })).json()).bin; return typeof bin === "string" ? bin : null; }
  catch { return null; }
}
ipcMain.handle("cli:pick", async (e) => {
  guard(e);
  const win = BrowserWindow.fromWebContents(e.sender);
  // Opens in the chosen or resolved CLI's directory (picker-default-path.mjs).
  const defaultPath = pickerDefaultPath({
    candidates: cliPickerCandidates({ chosen: readCliChoice(), resolved: await resolvedCliBin() }),
    exists: isDirectory,
    home: app.getPath("home"),
  });
  const r = await dialog.showOpenDialog(win, {
    defaultPath,
    title: "Choose the oats CLI binary",
    properties: ["openFile", "showHiddenFiles"],
    message: "Select the oats executable (e.g. from `command -v oats`)",
  });
  if (r.canceled || !r.filePaths?.[0]) return { path: null };
  writeCliChoice(r.filePaths[0]);           // persisted — top discovery priority next launch
  return { path: r.filePaths[0] };
});

// ---- IPC: API proxy -----------------------------------------------------
// The roster/agents read of a deployment this Desktop knows (and that is still one) but the
// server does not advertise: refused with E_WORKSPACE_NOT_SERVED, never fetched (api-url.mjs).
const unservedRefusal = createUnservedRefusal({ base, body: workspaceNotServed,
  state: () => ({ allowedWs: allowedWs.size ? allowedWs : advertisedBefore, known: (path) => knownDirs.has(path) && !!wsValidate(path) }) });

// The renderer never talks to the network directly; ctx.api() lands here.
ipcMain.handle("api", async (e, pathname, opts) => {
  // The workspace the sending window is bound to (#481): a request from it carries that workspace,
  // never another's. An unbound window keeps the verified workspace and its rewrite (#461 adoption).
  const bound = (() => { try { return frameWorkspace(e.senderFrame?.url, RENDERER_URL); } catch { return undefined; } })();
  const windowWs = typeof bound === "string" ? bound : null;
  // A workspace the server does not serve, asked by a bound window, is refused on every
  // workspace-scoped route — never answered with another workspace's data. Main learns what the
  // server advertises from panel replies, so it re-reads that first: a view observed since (its
  // identity is read after the server starts) is served, and a refused window would never bring the
  // reply that says so.
  let notServed = windowRefusal(pathname, base(), windowWs, advertisedNow());
  if (notServed) { await panelWorkspaces(); notServed = windowRefusal(pathname, base(), windowWs, advertisedNow()); }
  // The served choices go with it: the window finds the view that holds its deployments now (#482's
  // rehome) without another read, which would name the same unserved workspace.
  if (notServed) return { ok: false, status: 404, body: { ...workspaceNotServed(notServed), workspaces: servedList } };
  // One normalized classifier owns every specialized routing decision;
  // aliases cannot bypass frame/epoch guards, deadlines or typed failures.
  const route = classifyApiRoute(pathname, base());
  const connection = () => ({ base: base(), wsId: windowWs ?? wsId, allowedWs, bound: windowWs !== null, epoch: serverEpoch, transition: serverHost.inTransition() });
  if (route === 'spawn-apply') return proxySpawnApply(e, pathname, opts, { rendererURL: RENDERER_URL, connection });
  if (route === 'spawn-preview') return proxySpawnPreview(e, pathname, opts, { rendererURL: RENDERER_URL, connection });
  if (route === 'instance-events') return proxyInstanceEvents(e, pathname, opts, { rendererURL: RENDERER_URL, connection });
  if (route === 'readiness') return proxyReadiness(e, pathname, opts, { rendererURL: RENDERER_URL, connection });
  const lifecycle = route === 'lifecycle';
  const forgeRequest = lifecycle || route === 'forge';
  const failure = lifecycle ? lifecycleFailure : forgeFailure;
  const mutation = lifecycle && (() => { try { return (typeof opts?.body === 'string' ? JSON.parse(opts.body) : opts?.body)?.action === 'apply'; } catch { return false; } })();
  if (forgeRequest && !trustedForgeFrame(e, RENDERER_URL)) return { ok: false, status: 403, body: failure('E_FORBIDDEN_FRAME') };
  const forgeFrame = forgeRequest ? e.senderFrame : null;
  const ownsForgeFrame = () => trustedForgeFrame(e, RENDERER_URL) && e.sender.mainFrame === forgeFrame;
  try {
  guard(e);
  // A deployment this Desktop knows (and that is still one) but the server does not serve is
  // refused by name, never answered with another workspace's data (#461). A bound window's were
  // refused above.
  const refusal = windowWs === null ? unservedRefusal(pathname) : null;
  if (refusal) return refusal;
  // apiUrl rejects off-origin resolution (e.g. "//attacker/x"), and pins
  // the window's workspace (else the verified one) on scoped endpoints
  // unless the caller selects a workspace this server actually advertises
  // (the views' ws switcher).
  const url = apiUrl(pathname, base(), windowWs ?? wsId, allowedWs, { bound: windowWs !== null });
  const epoch = serverHost.inTransition() ? null : serverEpoch;
  // apiInit forwards pre-serialized (string) bodies and headers unchanged —
  // views serialize once in common.mjs::postJson — and serializes object
  // bodies itself.
  // Provider actions may perform bounded work before returning their receipt.
  // Let the CLI's five-minute limit report the outcome before the proxy times out.
  const forge = route === 'forge' ? forgeProxyOptions(url.pathname, opts, currentForgeEpoch()) : null;
  // automations: `trigger test` polls the forge (the adapter allows the CLI 60 s).
  // A plan or an instance Git read may be routed to a server (a 45 s CLI deadline): 50 s lets it report itself.
  const timeout = lifecycle ? mutation ? 610_000 : 50_000 : forge?.timeout ?? (route === 'capabilities' || route === 'workspace-sync' ? 310_000
    : route === 'automations' ? 90_000 : route === 'instance-git' ? 50_000 : 20_000);
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
    allowedWs = servedSelectors(json.workspaces);
    noteServed(json.workspaces);
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
  const template = appMenuTemplate(process.platform, { newWindow: () => openNewWindow() });
  Menu.setApplicationMenu(template ? Menu.buildFromTemplate(template) : null);
}

// ---- windows: one per workspace (#481) ----------------------------------
// window-set.mjs holds at most one window per workspace view id; a window's
// workspace is its renderer URL's #ws= (renderer/window-binding.mjs).
// windows.json (window-records.mjs) brings them back at the next launch.
const WINDOWS_FILE = () => join(app.getPath("userData"), "windows.json");
const windows = createWindowSet({ create: (key, record) => createWindow(key, record) });
let windowRecords = null; // created at startup, once userData is known
// Windows opened by New Window: their first claim never takes the shared default (they show the switcher).
const choosers = new WeakSet();
/** A window's bounds and state, as a record keeps them. */
const windowState = (win) => ({ bounds: win.getNormalBounds(), maximized: win.isMaximized(), fullscreen: win.isFullScreen() });
const served = (key) => typeof key === "string" && advertisedNow().has(key);
/** The view a served selector names (a deployment id is answered with the view that holds it, as the
 * server's viewFor does): the one key a workspace's window is registered under. */
const viewKey = (id) => resolveView(id, servedList) ?? id;
/** Bind a window to a workspace: its record and title follow (a restored record is rewritten to the view, Q6). */
function bindWindow(win, key) {
  windowRecords?.bind(win, key, windowState(win), servedList);
  win.setTitle(windowTitle(key, servedList));
}
/** Open (or focus) the workspace's window; a restored record brings its bounds. */
function openWorkspaceWindow(key, record = null) {
  const result = windows.open(key, record);
  if (result.opened) {
    if (record) windowRecords?.adopt(result.win, record);
    bindWindow(result.win, key);
  }
  return result;
}
/** File → New Window, the palette's New Window: a window with no workspace, showing the switcher. */
function openNewWindow() {
  const win = windows.openUnbound();
  choosers.add(win);
  return win;
}
/** Launch and macOS `activate`: every recorded window whose workspace is served, plus the launch's own
 * deployment; with none, one window that takes the shared default, as before. */
function restoreWindows(launchKey = null) {
  for (const { key, record } of restorePlan(windowRecords?.records() ?? [], servedList)) openWorkspaceWindow(key, record);
  if (launchKey) openWorkspaceWindow(launchKey);
  if (!windows.entries().length) windows.openUnbound();
}

// A window binding itself in place (a switch, or a view that moved under it). A deployment id binds
// the view that holds it, and a success names the workspace bound (`workspace`). `id` null leaves it
// unbound. A workspace another window holds is refused: that window is focused (`focused-other`),
// or not when `focus` is false (`open-elsewhere`). A New Window's first claim of the shared default
// (`initial`) is refused with `choose`: it shows the switcher instead. A default the server does not
// serve is refused with `not-served`. A refusal carries the served choices (the switcher's list), so
// a window left choosing reads no workspace to offer them.
ipcMain.handle("window:claim-workspace", (e, id, options) => {
  if (!trustedForgeFrame(e, RENDERER_URL)) return { ok: false, code: "forbidden" };
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || windows.keyOf(win) === undefined) return { ok: false, code: "unknown-window" };
  if (options?.initial === true && choosers.has(win)) return { ok: false, code: "choose", workspaces: servedList };
  if (id === null) {
    windows.unbind(win);
    windowRecords?.close(win, { served: false }); // the record stays; the window no longer owns it
    win.setTitle(windowTitle(null, servedList));
    return { ok: true };
  }
  if (!validWorkspaceId(id)) return { ok: false, code: "bad-workspace" };
  // The shared default is taken only while the server serves it; otherwise the window reads with
  // the verified workspace and adopts the one served, as before, then binds that.
  if (options?.initial === true && !served(id)) return { ok: false, code: "not-served" };
  const key = viewKey(id);
  const result = windows.claim(win, key, { focus: options?.focus !== false });
  if (!result.ok) return { ...result, workspaces: servedList };
  choosers.delete(win);
  bindWindow(win, key);
  return { ok: true, workspace: key };
});
// Open in new window, and New Window (`id` null): the workspace's window is focused if it has one.
ipcMain.handle("window:open-workspace", (e, id) => {
  if (!trustedForgeFrame(e, RENDERER_URL)) return { ok: false, code: "forbidden" };
  if (id === null) { openNewWindow(); return { ok: true, opened: true }; }
  if (!validWorkspaceId(id)) return { ok: false, code: "bad-workspace" };
  const result = openWorkspaceWindow(viewKey(id));
  return { ok: true, ...(result.opened ? { opened: true } : { focused: true }) };
});

function createWindow(workspaceId, record = null) {
  const bounds = record ? clampBounds(record.bounds, screen.getAllDisplays()) : null;
  const win = new BrowserWindow({
    ...(bounds ?? { width: 1400, height: 900 }),
    title: windowTitle(workspaceId, servedList),
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
  if (record?.maximized) win.maximize();
  if (record?.fullscreen) win.setFullScreen(true);
  // Titles are main's, from the served list (window-records.mjs windowTitle), never the page's.
  win.on("page-title-updated", (event) => event.preventDefault());
  win.on("focus", () => windows.focused(win));
  for (const ev of ["move", "resize", "maximize", "unmaximize", "enter-full-screen", "leave-full-screen"]) {
    win.on(ev, () => windowRecords?.update(win, windowState(win)));
  }
  // The operator closing a window whose workspace is served forgets it; quitting forgets nothing, and
  // neither does closing a window whose workspace isn't served (#472).
  win.on("close", () => { if (!quitStarted) windowRecords?.close(win, { served: served(windows.keyOf(win)) }); });
  const scope = String(win.webContents.id);
  win.on("closed", () => { windows.remove(win); suggestionCalls.forget(scope); lastPickChoices.delete(scope); });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  // Navigation lock: the window may only ever show our renderer file. Links
  // in future views (markdown, chat) open externally; everything else is
  // denied — a navigated-to page would otherwise inherit the preload bridge.
  win.webContents.on("will-navigate", (event, url) => {
    if (trustedRendererUrl(url, RENDERER_URL)) return;
    event.preventDefault();
    if (/^https?:/.test(url)) shell.openExternal(url);
  });
  win.loadFile(join(HERE, "renderer", "index.html"), workspaceId ? { hash: workspaceHash(workspaceId).slice(1) } : {})
    .catch((error) => console.error(`oats-desktop: window did not load: ${error.message}`));
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
  return win;
}

// A repeated launch (single-instance.mjs): its --dir, or a working directory that is a deployment, is
// admitted through the validated add path and its workspace's window opened or focused.
const openLaunch = createLaunchOpener({
  isDeployment: (dir) => !!wsValidate(realpathSync(dir)),
  admit: async (dir) => {
    const result = await performAdd(dir, true, "launch");
    if (!result?.ok) return null;
    return resolveView(result.workspace.id, (await panelWorkspaces()) ?? servedList);
  },
  open: (key) => { openWorkspaceWindow(key); },
  focusRecent: () => { windows.focusRecent(); },
});

const primaryInstance = startSingleInstance(app, (argv, workingDirectory) => openLaunch(launchDirectory(argv, workingDirectory)), async () => {
  await applyLoginPath(); // first: everything below may spawn
  installAppMenu();
  let savedWindows = "[]";
  try { savedWindows = readFileSync(WINDOWS_FILE(), "utf8"); } catch { /* first launch */ }
  windowRecords = createWindowRecords({ file: WINDOWS_FILE(), initial: parseWindowRecords(savedWindows) });
  app.on("will-quit", () => windowRecords.flush());
  sweepOrphanViewers(); // default socket now; saved sockets are swept when opened
  let saved = "[]";
  try { saved = readFileSync(OPEN_WORKSPACES_FILE(), "utf8"); } catch { /* first launch */ }
  workspaceDirs.splice(0, workspaceDirs.length,
    ...restoreWorkspaceDirs(WORKSPACE, saved, (p) => wsValidate(realpathSync(p))));
  // Launching on a workspace (--dir, or a workspace cwd) is an open.
  try { const launched = wsValidate(realpathSync(WORKSPACE)); if (launched) rememberWorkspaceParent(launched.path); } catch { /* not a workspace */ }
  knowDirs([...savedWorkspacePaths(saved), ...workspaceDirs]);
  // A launch from a folder that is not a deployment (a parent such as ~/Agents as the cwd or
  // --dir) opens the saved set and nothing else, and says so (#461).
  const startupIsDeployment = (() => { try { return !!wsValidate(realpathSync(WORKSPACE)); } catch { return false; } })();
  if (!startupIsDeployment) console.log(persistableDirs(workspaceDirs, wsValidate).length
    ? `oats-desktop: ${WORKSPACE} is not an OATS deployment (no oats-local.yaml); opened the saved workspaces instead`
    : `oats-desktop: ${WORKSPACE} is not an OATS deployment (no oats-local.yaml) and no saved workspace could be opened`);
  // Deployments only, and never an empty set over the saved one: a launch from a parent folder
  // must not replace the open set with that folder (#461). A saved deployment that is missing for
  // a moment (a volume not mounted yet) stays saved, served again once it is back (#472).
  const startupSet = startupOpenSet(saved, workspaceDirs, wsValidate);
  openDirs = startupSet.open;
  try {
    await ensureServer();
    // Written only when the launch opened a deployment the saved set lacks.
    if (serverHost.owned() && startupSet.write) saveWorkspaceDirs(OPEN_WORKSPACES_FILE(), startupSet.open);
  }
  catch (e) { console.error(`oats-desktop: ${e.message}`); }
  // Window activity: visibility flips that are not focus flips, hooked on
  // every window BEFORE the first one exists (focus/blur are app-level below).
  app.on("browser-window-created", (_event, win) => {
    for (const ev of ["show", "hide", "minimize", "restore"]) win.on(ev, noteWindowActivity);
  });
  // The launch's own deployment (--dir, or a cwd that is one) gets its window beside the restored ones.
  const servedViews = (await panelWorkspaces()) ?? [];
  let launchKey = null;
  try { if (startupIsDeployment) launchKey = resolveView(realpathSync(WORKSPACE), servedViews); } catch { /* gone since */ }
  restoreWindows(launchKey);
  // Contract re-probe trigger "app focus": notify the renderer, which calls
  // POST /api/cli/reprobe (the server owns probe state and rate semantics).
  app.on("browser-window-focus", () => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.webContents.isDestroyed()) w.webContents.send("app:focus");
    }
    noteWindowActivity();
  });
  app.on("browser-window-blur", noteWindowActivity);
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) restoreWindows(); });
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
