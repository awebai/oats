// Workspace suggestions + runtime add — the privileged side's testable core.
// (Phase-2 hook 3; the renderer switcher/modal is the UX designer's.)
//
// Discovery is BOUNDED and deterministic — never arbitrary filesystem
// scanning: (a) deployments the app already knows, (b) a persisted
// recently-added list. Every candidate must still be a workspace-model v2
// deployment directory AT SUGGESTION TIME; `reason` says why it is offered.
// The deployment's content is the kernel's to read (`oats workspace status`);
// the registry never parses it and knows no team scope. workspace:add canonicalizes, re-validates, persists to a recents
// store (path-validated on read-back — never trusted blindly), and the
// caller replaces only an app-OWNED backend server.
import { mkdirSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";

/** Restore explicitly opened workspaces, independently of recent suggestions.
 * Re-validate on startup: moved/deleted deployments are skipped and
 * symlinks resolving to the same canonical deployment open only once. */
export function restoreWorkspaceDirs(startup, raw, validate) {
  let saved;
  try { saved = JSON.parse(raw); } catch { saved = []; }
  const dirs = new Set();
  for (const path of [startup, ...(Array.isArray(saved) ? saved : [])]) {
    if (typeof path !== "string" || !path.startsWith("/")) continue;
    try {
      const workspace = validate(path);
      if (workspace) dirs.add(workspace.path);
    } catch { /* missing or no longer a workspace */ }
  }
  // Keep the existing empty-workspace/picker journey on first launch.
  return dirs.size ? [...dirs] : [startup];
}

/** Reuse a backend only when it covers the whole restored open set. */
export function matchWorkspaceDirs(dirs, workspaces) {
  const matches = dirs.map((path) => workspaces.find((w) =>
    path === w.id || path.startsWith(`${w.id}/`))?.id);
  return matches.length && matches.every(Boolean) ? matches[0] : null;
}

/** Commit the open set atomically, so interrupted writes retain the last set. */
export function saveWorkspaceDirs(file, dirs) {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(dirs, null, 2), { mode: 0o600 });
    renameSync(temporary, file);
  } catch (error) {
    try { rmSync(temporary, { force: true }); } catch { /* preserve original error */ }
    throw error;
  }
}

/**
 * Validate a directory as a workspace-model v2 deployment and derive its
 * identity: the canonical deployment directory itself.
 * @param {string} path       canonicalized absolute path
 * @param {object} io
 * @param {(p: string) => boolean} io.isDeployment  the directory holds its
 *        deployment file (a regular, non-symlink oats-local.yaml); existence
 *        only — the kernel reads and validates it
 * @returns {{ id: string, name: string, team: null, path: string } | null}
 */
export function validateWorkspace(path, io) {
  if (typeof path !== "string" || !path.startsWith("/")) return null;
  let deployment = false;
  try { deployment = io.isDeployment(path) === true; } catch { return null; }
  return deployment ? { id: path, name: path.split("/").pop() || path, team: null, path } : null;
}

/**
 * Assemble the suggestion list: validated candidates NOT currently advertised.
 * @param {object} io
 * @param {string[]} io.knownPaths      deployment paths the app already knows (startup --dir set)
 * @param {string[]} io.recents         persisted recently-added paths (validated on read)
 * @param {Set<string>} io.advertised   workspace ids the current server advertises
 * @param {(p: string) => ReturnType<typeof validateWorkspace>} io.validate
 * @returns {Array<{ id, name, team, path, reason }>}
 */
export function workspaceSuggestions(io) {
  const out = new Map(); // id -> candidate (first reason wins; dedup)
  const consider = (path, reason) => {
    const v = io.validate(path);
    if (!v) return;                       // must be a real workspace NOW
    if (io.advertised.has(v.id)) return;  // already advertised — not a suggestion
    if (!out.has(v.id)) out.set(v.id, { ...v, reason });
  };
  for (const p of io.knownPaths) consider(p, "known workspace");
  for (const p of io.recents) consider(p, "recently used");
  return [...out.values()];
}

/**
 * Recents store shape (app userData JSON). Read-back is VALIDATED — paths
 * that no longer resolve as workspaces are dropped, non-arrays/garbage
 * rejected; the store can never smuggle an arbitrary path into privileged
 * flows.
 */
export function parseRecents(raw, validate) {
  let data;
  try { data = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(data)) return [];
  const out = [];
  for (const entry of data.slice(0, 20)) {
    if (typeof entry !== "string" || !entry.startsWith("/")) continue;
    if (validate(entry)) out.push(entry);
  }
  return out;
}

export function pushRecent(recents, path, max = 10) {
  return [path, ...recents.filter((p) => p !== path)].slice(0, max);
}

/**
 * The workspace:add decision — canonicalize, validate, check candidate
 * provenance, and describe the required server action. Effects (persist,
 * server replacement, readiness wait) belong to the caller.
 *
 * @param {string} requestedPath
 * @param {object} io
 * @param {(p: string) => string} io.realpath      canonicalize; throws on nonexistent
 * @param {(p: string) => ReturnType<typeof validateWorkspace>} io.validate
 * @param {Set<string>} io.suggestedPaths          current suggestion-set paths
 * @param {boolean} io.fromPicker                  explicit native-picker action
 * @param {boolean} io.serverOwned                 the current server is app-owned
 * @param {Set<string>} io.advertised
 * @returns {{ ok: true, workspace: object, action: "already-advertised" | "replace-server" }
 *          | { ok: false, code: "not-found"|"not-suggested"|"not-a-workspace"|"foreign-server", reason: string }}
 *   code is the STABLE machine discriminator (renderer switches on it);
 *   reason is human-renderable prose and may be reworded freely.
 */
export function decideAdd(requestedPath, io) {
  let canonical;
  try { canonical = io.realpath(requestedPath); } catch { return { ok: false, code: "not-found", reason: "path does not exist" }; }
  // Provenance: only suggestion-set members or an explicit picker path may
  // enter the privileged flow — a renderer cannot inject arbitrary paths.
  if (!io.fromPicker && !io.suggestedPaths.has(canonical) && !io.suggestedPaths.has(requestedPath)) {
    return { ok: false, code: "not-suggested", reason: "path is not in the suggestion set (use the directory picker)" };
  }
  const ws = io.validate(canonical);
  if (!ws) return { ok: false, code: "not-a-workspace", reason: "not an OATS deployment (no oats-local.yaml)" };
  if (io.advertised.has(ws.id)) return { ok: true, workspace: ws, action: "already-advertised" };
  if (!io.serverOwned) {
    // Never mutate or kill a foreign server — fail closed with a reason.
    return { ok: false, code: "foreign-server", reason: "the panel server on this port is not owned by the app — cannot extend its workspaces" };
  }
  return { ok: true, workspace: ws, action: "replace-server" };
}

/** Latest-intent generation guard (house standard): completions of stale
 * requests must be inert. One counter per verb. */
export function createGenerations() {
  const gens = new Map();
  return {
    next(verb) { const g = (gens.get(verb) || 0) + 1; gens.set(verb, g); return g; },
    isCurrent(verb, g) { return gens.get(verb) === g; },
  };
}

/**
 * Transactional add executor — the effectful lifecycle around decideAdd,
 * extracted so its ordering/rollback properties are testable (review wsadd:
 * privileged state committed before readiness/currency; kill/spawn raced;
 * readiness accepted any 2xx).
 *
 * Properties:
 *  - SERIALIZED: adds run one at a time (in-flight adds queue); a request
 *    superseded while queued or during readiness commits NOTHING.
 *  - STAGED: the prospective --dir list is passed to the server replacement
 *    but workspaceDirs/recents are committed only AFTER readiness; on any
 *    failure the previous server configuration is RESTORED (respawn with
 *    the old dirs).
 *  - Readiness = identity match (isCompatible on /api/version response,
 *    i.e. serverCompatible against the local oats.json — any 2xx is NOT
 *    enough during a same-port race) AND the new workspace id advertised.
 *
 * @param {object} io
 * @param {() => string[]} io.getDirs            current committed dir list
 * @param {(dirs: string[]) => void} io.commitDirs
 * @param {(path: string) => void} io.commitRecent
 * @param {(dirs: string[]) => Promise<void>} io.replaceServer  stop owned server
 *        (awaiting its exit) and start one with `dirs`; must not return
 *        until the old process released the port. Implementations must
 *        INVALIDATE any cached advertised-workspace state when the
 *        replacement starts — the executor repopulates it only from the
 *        server that successfully becomes current (readiness or restore).
 * @param {() => Promise<boolean>} io.refreshAdvertised  repopulate the cached
 *        advertised set from the CURRENT server; returns whether the server
 *        ANSWERED (an unreachable just-spawned server is not success — the
 *        executor retries until it answers or attempts exhaust)
 * @param {() => Promise<{ok:boolean,status?:number,body?:any}|null>} io.probeVersion
 * @param {(v: any) => boolean} io.isCompatible  serverCompatible(v, local).compatible
 * @param {(id: string) => Promise<boolean>} io.advertises
 * @param {(ms: number) => Promise<void>} [io.delay]
 * @param {number} [io.attempts]
 * @returns {(workspace: { id: string, path: string }, isCurrent: () => boolean) => Promise<object>}
 */
export function createAddExecutor(io) {
  const delay = io.delay || ((ms) => new Promise((ok) => setTimeout(ok, ms)));
  const attempts = io.attempts ?? 40;
  let chain = Promise.resolve();

  async function run(workspace, isCurrent) {
    if (!isCurrent()) return { ok: false, code: "superseded", reason: "superseded by a newer request" };
    const previousDirs = io.getDirs();
    const stagedDirs = [...previousDirs, workspace.path];
    // The WHOLE effectful lifecycle — including the staging replacement
    // itself — runs inside the guarded transaction (round-3 finished-product
    // review: replaceServer(stagedDirs) threw AFTER the previous child was
    // stopped, skipping rollback — the renderer got a transport rejection
    // and the app was left server-less with invalidated trust state).
    // EVERY non-commit exit — staging failure, timeout, supersession, or a
    // throw from any probe/compat/advertise callback — must attempt to
    // restore the previous configuration AND its trust state.
    let committed = false;
    let thrown = null;
    try {
      await io.replaceServer(stagedDirs);
      for (let i = 0; i < attempts; i++) {
        const v = await io.probeVersion();
        if (v?.ok && io.isCompatible(v) && await io.advertises(workspace.id)) {
          if (!isCurrent()) break; // superseded during readiness — roll back
          io.commitDirs(stagedDirs);
          io.commitRecent(workspace.path);
          committed = true;
          return { ok: true, workspace };
        }
        await delay(250);
      }
    } catch (e) {
      thrown = e;
    } finally {
      if (!committed) {
        // restore the previous server, then rebuild advertised state from
        // the RESTORED server — readiness-aware: the fresh child is not
        // guaranteed to be listening yet (spawn returns immediately), and a
        // connection-refused refresh is NOT success; retry with an identity
        // check until it answers or attempts exhaust (review wsadd3).
        await io.replaceServer(previousDirs).catch(() => { /* best-effort restore */ });
        for (let i = 0; i < attempts; i++) {
          try {
            const v = await io.probeVersion();
            if (v?.ok && io.isCompatible(v) && await io.refreshAdvertised()) break;
          } catch { /* not up yet */ }
          await delay(250);
        }
      }
    }
    if (thrown) return { ok: false, code: "server-error", reason: `readiness check failed: ${thrown.message || thrown}` };
    return isCurrent()
      ? { ok: false, code: "server-timeout", reason: "replacement server did not advertise the new workspace in time" }
      : { ok: false, code: "superseded", reason: "superseded by a newer request" };
  }

  return (workspace, isCurrent) => {
    const p = chain.then(() => run(workspace, isCurrent));
    chain = p.catch(() => { /* keep the chain alive after failures */ });
    return p;
  };
}

/* ── Onboarding (workspace model v2, decision 9) ───────────────────────────
   A folder the operator PICKED that has no oats-local.yaml may be onboarded:
   the kernel's `oats onboard <dir> --workspace <ref>` writes the deployment
   files there, then the ordinary transactional add registers it. The renderer
   never names the directory: it receives a single-use offer token bound to
   the canonical picked path, and returns only that token plus the ref. */
export const MAX_ONBOARD_OFFERS = 4;
export function createOnboardOffers({ token }) {
  const offers = new Map(); // token -> canonical path (insertion order = age)
  return {
    offer(path) {
      if (typeof path !== "string" || !path.startsWith("/")) return null;
      const id = token();
      offers.set(id, path);
      while (offers.size > MAX_ONBOARD_OFFERS) offers.delete(offers.keys().next().value);
      return id;
    },
    take(id) {
      if (typeof id !== "string" || !offers.has(id)) return null;
      const path = offers.get(id); offers.delete(id); return path;
    },
  };
}

/**
 * @param {object} io
 * @param {(token: string) => string|null} io.take      offers.take
 * @param {(p: string) => string|null} io.offer        offers.offer — a fresh token for a retry
 * @param {(p: string) => string} io.realpath           canonicalize (throws when gone)
 * @param {(p: string) => boolean} io.isDeployment      oats-local.yaml present (existence only)
 * @param {() => Promise<object>} io.readCli            the server's accepted CLI probe
 * @param {(cli, options) => Promise<object>} io.run    workspace-cli.mjs cliWorkspace
 * @param {(document, dir) => object} io.project        deployment-data.mjs onboardData
 * @param {(dir: string) => Promise<object>} io.add     the transactional add (fromPicker)
 * @param {(ref: string) => boolean} io.validRef        workspace-cli.mjs validWorkspaceRef
 */
export function createOnboardExecutor(io) {
  let busy = false;
  return async function onboard(offerToken, ref) {
    if (!io.validRef(ref)) return { ok: false, code: "bad-ref", reason: "Enter the workspace repository reference (for example github.com/org/agents)." };
    if (busy) return { ok: false, code: "busy", reason: "An onboarding is already running." };
    const dir = io.take(offerToken);
    if (!dir) return { ok: false, code: "offer-expired", reason: "Choose the folder again: this onboarding offer is no longer valid." };
    busy = true;
    try {
      let canonical;
      try { canonical = io.realpath(dir); } catch { return { ok: false, code: "not-found", reason: "The chosen folder no longer exists." }; }
      if (canonical !== dir) return { ok: false, code: "offer-expired", reason: "The chosen folder changed. Choose it again." };
      if (io.isDeployment(dir)) return { ok: false, code: "E_ALREADY_ONBOARDED", reason: "This folder already realizes a workspace. Add it instead of onboarding it." };
      // A refused onboarding that left no deployment behind may be retried
      // for the same folder (e.g. a mistyped ref) with a FRESH single-use offer.
      const retry = () => { try { return io.isDeployment(dir) ? {} : { retry: io.offer(dir) }; } catch { return {}; } };
      let cli;
      try { cli = await io.readCli(); } catch { cli = null; }
      const result = await io.run(cli, { action: "onboard", dir, workspace: ref });
      if (!result?.ok) {
        const reason = result?.reason || {};
        return { ok: false, code: reason.code || "E_CLI_FAILED", reason: reason.message || "The installed OATS CLI could not onboard this folder.",
          ...(reason.rolledBack ? { rolledBack: true } : {}), ...retry() };
      }
      let report;
      try { report = io.project(result.document, dir); } catch { return { ok: false, code: "E_CLI_PROTOCOL", reason: "The installed OATS CLI returned an invalid onboarding result.", ...retry() }; }
      if (result.pending !== report.sync.approvalNeeded.length > 0) return { ok: false, code: "E_CLI_PROTOCOL", reason: "The installed OATS CLI returned an inconsistent onboarding result.", ...retry() };
      // The deployment exists now; registering it is the ordinary add. An add
      // failure is reported with the onboarding result, never rolled back here.
      const added = await io.add(dir);
      return { ok: true, pending: result.pending, onboard: report, added };
    } finally { busy = false; }
  };
}
