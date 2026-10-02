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
   The selected workspace is shared across views and persisted, so switching
   in one view switches everywhere. Views subscribe to react to changes made
   elsewhere (e.g. a shell-level switcher can call setWorkspace too). */
const WS_KEY = "oats.desktop.ws";
const wsListeners = new Set();
/* In-memory source of truth; localStorage is persistence only (absent in
   node tests and storage-less shells). */
let wsCurrent = (() => { try { return localStorage.getItem(WS_KEY) || ""; } catch { return ""; } })();
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
export function setWorkspace(id) {
  wsCurrent = id || "";
  wsGen++;                                   // invalidate all in-flight ws-scoped work
  try { localStorage.setItem(WS_KEY, wsCurrent); } catch { /* storage-less env */ }
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
   the server resolve globally — an Interrupt viewed in workspace B could
   Ctrl-C workspace A's session, and chat could leak A's data. Every
   per-instance call (interrupt, chat, session, keys…) must be built
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
