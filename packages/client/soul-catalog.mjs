/** The deployment's spawn catalog: `oats souls --json`, read only when the
 * workspace it describes moved (member/external commits, the workspace
 * commit) or the accepted CLI changed — never on every roster poll. One read
 * per deployment at a time; a failed read is retried after RETRY_MS, and the
 * last good catalog stays in place with the failure reported next to it.
 *
 * On a cold cycle the server starts this read alongside status/workspace status
 * (`prefetch`) and binds it to the key that cycle's workspace status produces
 * (`settle`); the holding rules are keyed-catalog.mjs's.
 *
 * A client makes its own catalog and owns it: nothing is held at module level, so two catalogs
 * share no flight, no held entry and no cycle. It takes the client's terms (client-terms.mjs),
 * which the default kernel read words its refusals with, and an optional `exec` that read
 * runs the CLI through (cli-adapter.mjs `runJson`'s `io.exec`). */
import { cliWorkspace } from './workspace-cli.mjs';
import { requireTerms } from './client-terms.mjs';
import { soulsData, observationData } from './deployment-data.mjs';
import { createKeyedCatalog } from './keyed-catalog.mjs';

export const SOUL_CATALOG_RETRY_MS = 60_000;

/** The state a souls catalog was read under: the CLI, the workspace and member commits and the
 * externals — everything `workspace status` reports that moves the list. What it cannot see
 * (local configuration edited outside Desktop: teams, launch preferences) is bounded by the held
 * result's TTL (keyed-catalog HELD_TTL_MS); the client names no deployment file to find out. */
export function soulCatalogKey(cli, workspaceStatus) {
  const ws = workspaceStatus || {};
  return JSON.stringify([cli?.bin ?? null, cli?.version ?? null, ws.workspace?.key ?? null, ws.workspace?.commit ?? null,
    (ws.members || []).map(m => [m.key ?? null, m.commit ?? null, m.status ?? null]),
    (ws.external || []).map(e => [e.source ?? null, e.soul ?? null])]);
}

export function createSoulCatalog({ terms, exec, invoke = (cli, options) => exec ? cliWorkspace(cli, options, terms, { exec }) : cliWorkspace(cli, options, terms), now = () => Date.now() } = {}) {
  requireTerms(terms, 'createSoulCatalog');
  async function read(deployment, cli, options) {
    try {
      // `maxAge` only reaches argv when the kernel declares observe-max-age (the adapter's call).
      const result = await invoke(cli, { action: 'souls', context: deployment, ...options });
      if (result?.ok !== true) return { value: null, reason: result?.reason?.code ? { code: result.reason.code, message: String(result.reason.message || '') } : { code: 'E_CLI_FAILED', message: '' } };
      const souls = soulsData(result.document), { observedAt } = observationData(result.document); // a malformed stamp is no stamp; the catalog stands
      return { value: { souls: souls.souls, ambiguous: souls.ambiguous, workspace: souls.workspace, problems: souls.problems }, observedAt };
    } catch (error) { return { value: null, reason: { code: error?.code === 'E_CLI_PROTOCOL' ? 'E_CLI_PROTOCOL' : 'E_CLI_FAILED', message: '' } }; }
  }
  const catalog = createKeyedCatalog({ read, retryMs: SOUL_CATALOG_RETRY_MS, now });
  /** The public entry: the catalog fields at the top, the failure next to them. */
  const project = entry => entry && { key: entry.key, souls: entry.value?.souls ?? null, ambiguous: entry.value?.ambiguous ?? [],
    workspace: entry.value?.workspace ?? null, problems: entry.value?.problems ?? [], reason: entry.reason, at: entry.at, observedAt: entry.observedAt, stale: entry.stale };
  function settle(deployment, cli, workspaceStatus, options = {}) {
    const { entry, pending } = catalog.settle(deployment, cli, soulCatalogKey(cli, workspaceStatus), options);
    return { entry: project(entry), pending: pending && pending.then(project) };
  }
  /** The request path (/api/agents) found the held catalog for this state past its TTL: start one re-read
   * behind the answer (or join the one in flight) and resolve with the landed, projected entry — null when
   * nothing stale is held for this key (fresh, missing or another state's: the cycle owns those). */
  function revalidate(deployment, cli, workspaceStatus, options = {}) {
    const key = soulCatalogKey(cli, workspaceStatus), held = catalog.held(deployment);
    if (!held || held.key !== key || held.reason || !held.stale) return null;
    const pending = catalog.revalidate(deployment, cli, key, options);
    return pending && pending.then(project);
  }
  /** A LIVE read for this workspace state (maxAge 0), asked for by the user (the TUI's `r`): one read under
   * the state's key, or the live same-key read in flight, joined. What is held stays held beside it, so a
   * read that fails lands as the held souls with its `reason` next to them, as a failed read of a moved key
   * does. Resolves with the landed, projected entry. */
  function refresh(deployment, cli, workspaceStatus) {
    return catalog.refresh(deployment, cli, soulCatalogKey(cli, workspaceStatus)).then(project);
  }
  return {
    /** The catalog for this workspace state, reading it only when needed. */
    async observe(deployment, cli, workspaceStatus, options = {}) {
      const { entry, pending } = settle(deployment, cli, workspaceStatus, options);
      return pending ? await pending : entry;
    },
    /** Synchronous decision for this workspace state: what is held now, and what (if anything) is still coming. */
    settle,
    revalidate,
    refresh,
    /** Start an unbound read when nothing usable is held and nothing is in flight; null when nothing started. */
    prefetch(deployment, cli, options = {}) { const flight = catalog.prefetch(deployment, cli, options); return flight && flight.then(project); },
    refreshing: catalog.refreshing,
    /** Read-only view of what is held (tests and diagnostics); the server reads catalogs through settle. */
    held(deployment) { return project(catalog.held(deployment)); },
    forget: catalog.forget,
  };
}
