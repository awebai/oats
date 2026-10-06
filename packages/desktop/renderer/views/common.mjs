import { hashWorkspace, workspaceHash } from "../window-binding.mjs";
import { validWorkspaceId } from "../workspace-id.mjs";
import { remoteReason } from "../remote-address.mjs";

/* oats desktop — shared helpers for renderer views.
   Plain ES module, DOM-only, no frameworks (contract). Views import from
   here; the shell provides ctx = { api(pathname, opts), openFile(path),
   openTerminal(instance) } per the desktop-app contract. */

/** HTML-escape text for BOTH element content and quoted attribute values:
 * quotes are escaped too, so an interpolated value can never close its
 * attribute and inject another (e.g. a data-open-file or data-action). */
export function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* Tiny markdown for agent prose: fenced blocks, inline code, bold — the
   panel's transcript never needed more. Input is escaped first. */
export function miniMarkdown(s) {
  return escapeHtml(s)
    .replace(/```\w*\n?([\s\S]*?)```/g, (m, code) => `<code class="block">${code.replace(/\n$/, "")}</code>`)
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
}

/* Fetch JSON via the shell's ctx.api — one seam so a base-URL change (remote
   panel, port) never touches the views. Tolerates BOTH ctx.api shapes:
   a Fetch Response (harness: ctx.api = (p, o) => fetch(base + p, o)) and a
   shell that resolves already-parsed JSON (throwing on non-2xx itself).
   Throws with the server's error message when it sends one. */
export async function apiJson(ctx, pathname, opts) {
  const r = await ctx.api(pathname, opts);
  if (!r || typeof r.json !== "function") return r; // shell returned parsed data
  let d;
  try { d = await r.json(); } catch { d = {}; }
  if (!r.ok) {
    const err = new Error(d.error || `HTTP ${r.status}`);
    if (d.code) err.code = d.code; // stable CLI/domain code (e.g. cli-unavailable, E_RELATIVE_AMBIGUOUS)
    if (Array.isArray(d.labels)) err.labels = d.labels; // E_TEAM_CONFLICT: the disagreeing team labels
    const reason = remoteReason(d.reason); // a remote refusal's reason, only once re-validated
    if (reason) err.reason = reason;
    throw err;
  }
  return d;
}

/* Error for a RECEIVED non-2xx {ok,status,body} response (the Electron
   bridge shape) — used by the SHELL's ctx.api so consumers can distinguish
   HTTP errors (status present) from transport failures. Must carry the
   server's stable domain CODE: dropping it made doSpawn's
   E_RELATIVE_AMBIGUOUS branch unreachable in production while fetch-shaped
   tests stayed green (merged-state review @3e76616). Exported from here —
   not defined in shell.mjs — so the parsed-path shaping is testable. */
export function httpError(r, pathname) {
  const err = new Error(r.body?.error || `HTTP ${r.status} for ${pathname}`);
  err.status = r.status;
  if (r.body?.code) err.code = r.body.code;
  if (r.body?.result) err.result = r.body.result;
  if (Array.isArray(r.body?.labels)) err.labels = r.body.labels;
  // A remote refusal's reason (server → main → renderer): kept only once re-validated, else dropped.
  const reason = remoteReason(r.body?.reason);
  if (reason) err.reason = reason;
  // A window's refusal for a workspace not served carries the served choices (#481).
  if (Array.isArray(r.body?.workspaces)) err.workspaces = r.body.workspaces;
  return err;
}
export function postJson(ctx, pathname, body) {
  return apiJson(ctx, pathname, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/* ── workspace switching (?ws=) ──
   The backend server scopes /api/panel and /api/agents by workspace id.
   The selected workspace is shared across views, so switching in one view
   switches everywhere in this window. Views subscribe to react to changes
   made elsewhere (e.g. a shell-level switcher can call setWorkspace too).

   One window per workspace (#481): a window's workspace is its URL's hash
   (`#ws=<id>`, window-binding.mjs), rewritten in place with
   history.replaceState, so a reload keeps it. The shared localStorage
   selection is only the default of a window opened with none. Main binds
   every switch first (window:claim-workspace): a workspace another window
   has is refused, and that window is focused instead. */
const WS_KEY = "oats.desktop.ws";
const wsListeners = new Set();
const startHash = (() => { try { return hashWorkspace(globalThis.location?.hash ?? ""); } catch { return { ok: false }; } })();
const boundAtStart = startHash.ok && startHash.workspace !== null;
/* In-memory source of truth; the hash binds it to this window, localStorage
   holds the default for a new one (both absent in node tests and storage-less
   shells). */
let wsCurrent = boundAtStart ? startHash.workspace
  : (() => { try { return localStorage.getItem(WS_KEY) || ""; } catch { return ""; } })();
/* Workspace GENERATION — bumped on every switch. Async paths capture it at
   dispatch and discard completions from an older generation: a deferred
   roster/agents response — or a finished spawn — from workspace A must
   never paint or act after the user switched to B (same-named instances
   across workspaces make identity checks insufficient; see the ws-scoping
   lesson). */
let wsGen = 0;
export function workspaceGeneration() { return wsGen; }
export function currentWorkspace() {
  return wsCurrent;
}
/* Commit a workspace main has bound this window to (switchWorkspace), or the
   plain selection where there is no window binding (the browser harness). */
export function setWorkspace(id) {
  wsCurrent = id || "";
  wsGen++;                                   // invalidate all in-flight ws-scoped work
  try { localStorage.setItem(WS_KEY, wsCurrent); } catch { /* storage-less env */ }
  writeHash(wsCurrent);
  if (wsCurrent) setWindowState("bound");
  for (const fn of [...wsListeners]) { try { fn(wsCurrent); } catch { /* listener error must not break others */ } }
}
/* Adopt a server-resolved workspace id WITHOUT notifying listeners — used
   when the server maps a stale/empty selection to a real workspace. Silent
   on purpose: the adoption is not a user switch, so it must not bump the
   generation (which would discard the very reply that resolved it in the
   other roster path) nor run the workspace-change listeners (tab-layer
   restore, picker closes, a second /api/panel round trip). */
export function adoptWorkspace(id) {
  wsCurrent = id || "";
  try { localStorage.setItem(WS_KEY, wsCurrent); } catch { /* storage-less env */ }
  // The window is bound to what it adopted through main, without focusing anything: a window opened
  // with no default (adopting), or a bound window whose id the server answered with its view now (a
  // deployment id saved before views, #482). Another window having it leaves this one choosing.
  if (!claimBridge()) { writeHash(wsCurrent); return; }
  if (!wsCurrent) return;
  const adopted = wsCurrent, initial = windowMode === "adopting";
  void claim(adopted, initial ? { focus: false, initial: true } : { focus: false }).then((r) => {
    if (wsCurrent !== adopted) return;       // switched since: that switch was bound on its own
    if (r?.ok) { wsCurrent = boundTo(r, adopted); writeHash(wsCurrent); setWindowState("bound"); }
    else if (r?.code === "open-elsewhere" || r?.code === "choose") void chooseWorkspace(r.workspaces);
  });
}

/* ── one window per workspace (#481) ──
   The window's state: "bound" (to wsCurrent), "adopting" (opened with no
   default: the first roster reply's workspace is adopted, then bound) or
   "choosing" (no workspace: the switcher and its choices, no workspace read). */
let windowMode = boundAtStart ? "bound" : "adopting";
let windowChoices = [];
const windowListeners = new Set();
const claimBridge = () => { try { const fn = globalThis.oatsDesktop?.windowClaimWorkspace; return typeof fn === "function" ? fn : null; } catch { return null; } };
async function claim(id, options) {
  try { return await claimBridge()(id, options); } catch { return { ok: false, code: "failed" }; }
}
/* The workspace main bound a claim to: a deployment id is bound as the view that holds it. */
const boundTo = (r, id) => (validWorkspaceId(r?.workspace) ? r.workspace : id);
function writeHash(id) {
  try {
    const { pathname, search } = globalThis.location;
    globalThis.history.replaceState(globalThis.history.state, "", id ? workspaceHash(id) : `${pathname}${search}`);
  } catch { /* no window history (node tests), or an id the binding refuses */ }
}
function setWindowState(state) {
  if (windowMode === state) return;
  windowMode = state;
  for (const fn of [...windowListeners]) { try { fn(state); } catch { /* listener error must not break others */ } }
}
export function windowState() { return windowMode; }
export function onWindowState(fn) {
  windowListeners.add(fn);
  return () => windowListeners.delete(fn);
}
/* The served choices main gave a choosing window (it reads nothing itself). */
export function choosingWorkspaces() { return windowChoices; }
/* A choosing window's choices follow what main serves (#521): workspaces served after its first claim
   (remote views arrive seconds after launch) become choices. Resolves to the new list, or null when
   this window is not choosing, main refused, or a newer refresh or a bind superseded this one. */
let choicesIntent = 0;
const choicesBridge = () => { try { const fn = globalThis.oatsDesktop?.windowChoices; return typeof fn === "function" ? fn : null; } catch { return null; } };
export async function refreshChoices() {
  const bridge = choicesBridge();
  if (windowMode !== "choosing" || !bridge) return null;
  const intent = ++choicesIntent;
  let r = null;
  try { r = await bridge(); } catch { r = null; }
  if (intent !== choicesIntent || windowMode !== "choosing" || !r?.ok || !Array.isArray(r.workspaces)) return null;
  windowChoices = r.workspaces;
  return windowChoices;
}

/* At start: a window with no hash takes the shared default only when main says no other window has
   it (and it is not a New Window); otherwise it chooses. With no default it adopts, as before.
   Resolves to the window's state. */
export async function startWindow() {
  if (windowMode !== "adopting" || !claimBridge()) return windowMode === "adopting" ? "bound" : windowMode;
  const r = await claim(wsCurrent, { focus: false, initial: true });
  if (r?.ok) { wsCurrent = boundTo(r, wsCurrent); writeHash(wsCurrent); setWindowState("bound"); }
  else if (r?.code === "choose" || r?.code === "open-elsewhere") enterChoosing(r.workspaces);
  return windowMode;
}

function enterChoosing(workspaces) {
  windowChoices = Array.isArray(workspaces) ? workspaces : [];
  wsCurrent = "";
  wsGen++;                                   // nothing in flight may paint a workspace into this window
  writeHash("");
  // The state is "choosing" while the workspace listeners run (they read nothing), and is announced
  // after them, so the switcher's choosing presentation is the last word.
  const changed = windowMode !== "choosing";
  windowMode = "choosing";
  for (const fn of [...wsListeners]) { try { fn(wsCurrent); } catch { /* listener error must not break others */ } }
  if (changed) for (const fn of [...windowListeners]) { try { fn(windowMode); } catch { /* listener error must not break others */ } }
}

/* Leave this window with no workspace (a view moved under it to one another window has, #482): main
   unbinds it, and it shows the switcher. The shared default is kept. */
export async function chooseWorkspace(workspaces) {
  if (claimBridge()) await claim(null);
  enterChoosing(workspaces);
}

/* Switch this window to `id`. Main binds it first; a workspace another window has is refused (that
   window is focused, unless `focus` is false) and this window does not change. Switches run one at a
   time, so this window's state never differs from main's: a switch superseded before it is sent is
   never sent; one main has already bound is followed even when a newer one waits behind it. */
let switching = Promise.resolve(), switchIntent = 0;
export function switchWorkspace(id, { focus = true } = {}) {
  const intent = ++switchIntent;
  const run = switching.then(async () => {
    if (intent !== switchIntent) return { ok: false, code: "superseded" };
    if (!claimBridge()) { setWorkspace(id); return { ok: true }; }
    const r = await claim(id, { focus });
    if (r?.ok) { setWorkspace(boundTo(r, id)); return { ok: true }; }
    return r ?? { ok: false, code: "failed" };
  });
  switching = run.catch(() => {});
  return run;
}
/* Is the selection a roster reply was requested with STALE? A persisted
   selection can name a workspace the server no longer serves (a deleted
   deployment): the server then answers with its own workspace, and refusing
   that reply as a mismatch leaves no way out of the UI — the switcher already
   shows the served workspace as active. Stale means: non-empty and absent
   from the served choices, i.e. `panel.workspaces` plus `panel.workspace`
   (what the switcher renders). Both roster paths (the hierarchy refresh and
   the shell's context roster) treat stale exactly like empty: adopt the
   served id. The decision needs the served list: when a server does not
   report one (older server, empty list) nothing is guessed, the selection
   stands and a differing reply is still a real mismatch. A selection that
   IS a served choice and gets a reply for another workspace is never stale. */
export function staleWorkspaceSelection(requested, panel) {
  if (!requested) return false;
  const served = Array.isArray(panel?.workspaces) ? panel.workspaces : [];
  if (!served.length) return false;
  if (panel.workspace?.id === requested) return false;
  return !served.some((w) => w && w.id === requested);
}
export function onWorkspaceChange(fn) {
  wsListeners.add(fn);
  return () => wsListeners.delete(fn);
}
export function wsQuery(prefix = "?") {
  const ws = currentWorkspace();
  return ws ? `${prefix}ws=${encodeURIComponent(ws)}` : "";
}

/* The deployment a roster row belongs to (#482): where EVERY request about that row is addressed.
   A workspace view can hold several deployments (this computer's and other machines'), and the
   server resolves an instance only inside its own deployment, by its exact id; a view id is refused
   there. A row the server tagged carries `deployment.id`; an untagged row (an older server, a test
   double) belongs to the selected workspace, which was then a deployment. Ownership checks ("is
   this still the workspace on screen?") keep using currentWorkspace(), never this. */
export function rowDeployment(row) {
  const id = row && typeof row === "object" ? row.deployment?.id : null;
  return typeof id === "string" && id ? id : currentWorkspace();
}

/* Per-instance endpoint path, ALWAYS scoped to the row's deployment (rowDeployment).
   Same-named instances exist across workspaces; an unscoped request lets
   the server resolve globally — a Start viewed in workspace B could
   launch workspace A's instance, and chat could leak A's data. Every
   per-instance call (chat, start, restart, harvest) must be built
   through here. `instance` may be a bare name (legacy) or a roster object
   { instance, home } — pass the OBJECT whenever you have it: same-named
   instances also exist across roots WITHIN a workspace, and the server
   refuses ambiguous bare names (409 E_INSTANCE_AMBIGUOUS) rather than
   act on an arbitrary pick (merged-state review @7dd1e7b). `query` is the
   extra query string without a leading ?/&. */
export function instanceApiPath(kind, instance, query = "") {
  const name = typeof instance === "string" ? instance : instance.instance;
  const home = typeof instance === "object" && instance.home ? `home=${encodeURIComponent(instance.home)}` : "";
  const server = typeof instance === "object" && instance.server ? `server=${encodeURIComponent(instance.server)}` : "";
  const ws = typeof instance === "object" ? rowDeployment(instance) : currentWorkspace();
  const scope = ws ? `ws=${encodeURIComponent(ws)}` : "";
  const q = [query, home, server, scope].filter(Boolean).join("&");
  return `/api/${kind}/${encodeURIComponent(name)}${q ? `?${q}` : ""}`;
}

/* Render the workspace <select> into an element; hidden when the server
   watches a single workspace. `list` is panel.workspaces. */
export function renderWorkspaceSelect(selectEl, list, current) {
  if (!Array.isArray(list) || list.length <= 1) { selectEl.style.display = "none"; return; }
  selectEl.style.display = "";
  // Values are DOM properties, never parsed markup: a workspace id is a path
  // and may contain any character. Rebuild only when the list changes.
  const signature = JSON.stringify(list.map((w) => [String(w.id), String(w.name), w.team ? String(w.team.name) : null]));
  if (selectEl.dataset.options !== signature) {
    const doc = selectEl.ownerDocument;
    selectEl.replaceChildren(...list.map((w) => {
      const option = doc.createElement("option");
      option.value = String(w.id);
      option.textContent = `${w.name}${w.team ? ` · ${w.team.name}` : ""}`;
      return option;
    }));
    selectEl.dataset.options = signature;
  }
  selectEl.value = current;
}

/* Load the shared token stylesheet once per document (views are mounted by
   the shell, which may or may not include theme.css itself). */
export function ensureTheme(doc = document) {
  if (doc.querySelector('link[data-oats-theme], style[data-oats-theme]')) return;
  const link = doc.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("../theme.css", import.meta.url).href; // views/ → renderer/theme.css
  link.dataset.oatsTheme = "1";
  doc.head.appendChild(link);
}

/* ── roster grouping: workspace → repo → instances, children indented under
   parents — ported verbatim from the panel. */
export function groupInstances(list) {
  const workspaces = new Map();
  for (const i of list) {
    const wsName = (i.workspace || "?").split("/").pop();
    if (!workspaces.has(wsName)) workspaces.set(wsName, new Map());
    const repos = workspaces.get(wsName);
    const rName = i.repoName || "?";
    if (!repos.has(rName)) repos.set(rName, []);
    repos.get(rName).push(i);
  }
  for (const repos of workspaces.values()) {
    for (const [rName, items] of repos) {
      const byName = new Map(items.map((i) => [i.instance, i]));
      const roots = items.filter((i) => !i.parentInstance || !byName.has(i.parentInstance));
      const kids = (p) => items.filter((i) => i.parentInstance === p.instance);
      const rank = (a, b) => (a.running === b.running ? a.instance.localeCompare(b.instance) : a.running ? -1 : 1);
      roots.sort(rank);
      const ordered = [];
      const walk = (i, depth) => { ordered.push({ ...i, depth }); kids(i).sort(rank).forEach((k) => walk(k, depth + 1)); };
      roots.forEach((r) => walk(r, 0));
      for (const i of items) if (!ordered.some((o) => o.instance === i.instance)) ordered.push({ ...i, depth: 0 });
      repos.set(rName, ordered);
    }
  }
  return workspaces;
}
