// Pure request-URL shaping for the desktop app's privileged API proxy.
// Kept dependency-free and separate from main.mjs so the root `node --test`
// suite can cover it without loading Electron.

/** Classify specialized behavior from the pathname the backend will see.
 * This is NOT authorization: apiUrl must still enforce input/origin/workspace
 * constraints. In particular, even off-origin aliases need the same typed
 * refusal path and must never fall through a weaker raw-prefix guard. */
export function classifyApiRoute(pathname, base) {
  if (typeof pathname !== 'string') return null;
  try {
    switch (new URL(pathname, base).pathname) {
      case '/api/workspace-readiness': return 'readiness';
      case '/api/workspace-spawn-preview': return 'spawn-preview';
      case '/api/spawn': return 'spawn-apply';
      case '/api/instance-lifecycle': return 'lifecycle';
      case '/api/instance-events': return 'instance-events';
      case '/api/instance-git': return 'instance-git';
      case '/api/schedules': return 'schedules';
      case '/api/automations': return 'automations';
      case '/api/forge-connections':
      case '/api/instance-forge':
      case '/api/forge-roster':
      case '/api/instance-review-threads': return 'forge';
      case '/api/capabilities': return 'capabilities';
      case '/api/workspace-sync': return 'workspace-sync';
      case '/api/panel': return 'panel';
      default: return null;
    }
  } catch { return null; }
}

/** Workspace-scoped endpoints: the roster/agents/brain reads AND the whole instance-addressed family.
 * The server resolves instance names per workspace, and same-named instances exist across workspaces. */
export function workspaceScoped(pathname) {
  return pathname === "/api/panel" || pathname === "/api/agents" || pathname === '/api/spawn' || pathname === '/api/automations' || pathname === '/api/forge-roster'
    || pathname === '/api/team-members'
    || /^\/api\/(?:instance|workspace)-[a-z-]+$/.test(pathname) // entire body-addressed scoped families
    || /^\/api\/(brain|session|keys|interrupt|chat)\//.test(pathname);
}

/**
 * A window-bound request for a workspace the server does not serve (#481): the workspace id to
 * refuse with E_WORKSPACE_NOT_SERVED, or null to proxy it. `window` is the workspace the sending
 * window is bound to (null or undefined: an unbound window, never refused here). The request names
 * its workspaces with ?ws=, or, with none, it is the window's own. Any of them outside `advertised`
 * is refused, on every workspace-scoped route. With no advertised set known (startup, a restart with
 * nothing advertised before) nothing is refused: the request passes unrewritten and the server's own
 * refusal applies. Off-origin or malformed input is left to apiUrl, which throws.
 * @param {string} pathname
 * @param {string} base
 * @param {string|null|undefined} window
 * @param {Set<string>|null|undefined} advertised
 * @returns {string|null}
 */
export function windowRefusal(pathname, base, window, advertised) {
  if (typeof window !== 'string' || !(advertised instanceof Set) || !advertised.size || typeof pathname !== 'string' || !pathname.startsWith('/')) return null;
  let url;
  try { url = new URL(pathname, base); } catch { return null; }
  if (url.origin !== new URL(base).origin || !workspaceScoped(url.pathname)) return null;
  const asked = url.searchParams.getAll('ws');
  return (asked.length ? asked : [window]).find((id) => !advertised.has(id)) ?? null;
}

/**
 * Build the URL the main process will fetch for a renderer api() call.
 *
 * SECURITY: the renderer (or anything that reaches the preload bridge) must
 * never be able to steer the privileged fetch off the loopback backend
 * origin. `new URL("//host/x", base)` — and the backslash variant
 * "/\\host/x", which WHATWG URL normalizes the same way — would resolve to a
 * DIFFERENT origin, so the resolved origin is checked, not just the input
 * shape.
 *
 * @param {string} pathname  must start with "/" and stay on `base`'s origin
 * @param {string} base      the backend server origin, e.g. http://127.0.0.1:4820
 * @param {string|null} wsId verified workspace id — pinned onto
 *                           workspace-scoped endpoints unless the caller
 *                           selects a workspace the server itself advertises
 * @param {Set<string>} [allowedWs] workspace ids the connected server
 *                           advertises (from /api/panel `workspaces[]`); a
 *                           caller ?ws= outside this set is overwritten
 * @param {{ bound?: boolean }} [options] `bound`: the request comes from a
 *                           window bound to `wsId` (#481). An omitted ?ws= is
 *                           that window's workspace and an explicit one is
 *                           never overwritten: main refuses an unadvertised
 *                           one first (windowRefusal).
 * @returns {URL}
 * @throws  on off-origin or malformed input
 */
export function apiUrl(pathname, base, wsId = null, allowedWs = undefined, { bound = false } = {}) {
  if (typeof pathname !== "string" || !pathname.startsWith("/")) {
    throw new Error("api: pathname must start with /");
  }
  const baseUrl = new URL(base);
  const url = new URL(pathname, baseUrl);
  if (url.origin !== baseUrl.origin) {
    throw new Error("api: pathname resolved off-origin");
  }
  // Pinning here makes an omitted ?ws= fail SAFE (the verified workspace, or
  // a bound window's own) even before views append it themselves.
  if (wsId && workspaceScoped(url.pathname)) {
    // Preserve duplicate selectors for the strict server boundary to REFUSE;
    // set() must not turn malformed requests into an admitted read.
    if ((url.pathname === '/api/spawn' || url.pathname === '/api/automations' || url.pathname === '/api/forge-roster' || url.pathname === '/api/team-members' || /^\/api\/(?:instance|workspace)-[a-z-]+$/.test(url.pathname)) && url.searchParams.getAll('ws').length > 1) return url;
    const asked = url.searchParams.get("ws");
    // Workspace switching is a real feature on shared multi-workspace
    // servers — but only to workspaces the server actually advertises;
    // anything else from an unbound window is overwritten with the verified
    // id. A bound window's unadvertised one was refused before this.
    if (!asked || !bound && (!(allowedWs instanceof Set) || !allowedWs.has(asked))) {
      url.searchParams.set("ws", wsId);
    }
  }
  return url;
}

/**
 * The selectors a caller may name with ?ws= on the connected server (#482): every workspace view the
 * switcher lists (`/api/panel` `workspaces[].id`) and every deployment those views hold
 * (`workspaces[].deployments[]`). Rows are addressed to their deployment, so a deployment id must
 * survive apiUrl unchanged; a view id is still refused by the server on instance-addressed routes.
 * @param {unknown} workspaces  the panel's `workspaces` list
 * @returns {Set<string>}
 */
export function servedSelectors(workspaces) {
  const ids = new Set();
  for (const w of Array.isArray(workspaces) ? workspaces : []) {
    if (typeof w?.id === 'string' && w.id) ids.add(w.id);
    for (const id of Array.isArray(w?.deployments) ? w.deployments : []) if (typeof id === 'string' && id) ids.add(id);
  }
  return ids;
}

/**
 * Build fetch init for a proxied api() call. Views follow the Fetch
 * contract: common.mjs::postJson already serializes the body and sets
 * content-type — string bodies and supplied headers must pass through
 * UNCHANGED (double-serialization made /api/spawn parse a JSON string and
 * reject every spawn). Object bodies (the shell's own convenience calls)
 * are serialized here, exactly once.
 */
export function apiInit(opts) {
  const init = { method: opts?.method || "GET" };
  if (opts?.headers && typeof opts.headers === "object") init.headers = { ...opts.headers };
  if (opts?.body !== undefined) {
    if (typeof opts.body === "string") {
      init.body = opts.body;
      init.headers = { "content-type": "application/json", ...init.headers };
    } else {
      init.body = JSON.stringify(opts.body);
      init.headers = { ...init.headers, "content-type": "application/json" };
    }
  }
  return init;
}

/**
 * A read of a deployment this Desktop knows but its server does not advertise (#461): the
 * workspace id to refuse with E_WORKSPACE_NOT_SERVED, or null to proxy as usual. Only the roster
 * and agents reads, only a local deployment (an absolute path), only once an advertised set is
 * known (during a server replacement, the outgoing server's: the deployment is not served until the
 * new server advertises it, and its read must not be rewritten to another), and only for a path the
 * Desktop itself knows (`known`, checked before anything touches the filesystem). An unknown id
 * keeps today's rewrite to the verified workspace, which the renderer adopts.
 * @param {string} pathname
 * @param {string} base
 * @param {{ allowedWs: Set<string>, known: (path: string) => boolean }} state
 * @returns {string|null}
 */
export function unservedWorkspace(pathname, base, { allowedWs, known }) {
  if (!(allowedWs instanceof Set) || !allowedWs.size || typeof pathname !== 'string') return null;
  let url;
  try { url = new URL(pathname, base); } catch { return null; }
  if (url.origin !== new URL(base).origin || !['/api/panel', '/api/agents'].includes(url.pathname)) return null;
  const asked = url.searchParams.getAll('ws');
  if (asked.length !== 1 || !asked[0].startsWith('/') || allowedWs.has(asked[0])) return null;
  try { return known(asked[0]) === true ? asked[0] : null; } catch { return null; }
}

/**
 * The proxy's refusal for an unserved deployment, as main wires it: `state()` reads the live
 * connection facts at call time. Returns the `{ ok, status, body }` the api channel resolves
 * with (404 E_WORKSPACE_NOT_SERVED, `body(workspace)`), or null to proxy as usual.
 * @param {{ base: () => string, state: () => { allowedWs: Set<string>, known: (path: string) => boolean },
 *           body: (workspace: string) => object }} io
 */
export function createUnservedRefusal({ base, state, body }) {
  return (pathname) => {
    const workspace = unservedWorkspace(pathname, base(), state());
    return workspace ? { ok: false, status: 404, body: body(workspace) } : null;
  };
}
