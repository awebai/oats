/** The deployment's capability table: `oats capabilities --json`, held per
 * deployment and keyed by the workspace state it describes, so a read costs
 * a kernel run only when that state moved (or the caller forces a live one),
 * never on every poll or view open. The holding rules (one flight per
 * deployment, last good table kept with the failure next to it, retry after
 * RETRY_MS, unbound prefetch bound by the same cycle's settle) are
 * keyed-catalog.mjs's; this module is the kernel read, the key and the shape. */
import { cliWorkspace } from '../workspace-cli.mjs';
import { capabilitiesData } from '../deployment-data.mjs';
import { soulCatalogKey } from './soul-catalog.mjs';
import { createKeyedCatalog } from './keyed-catalog.mjs';

export const CAPABILITY_CATALOG_RETRY_MS = 60_000;
/** Desktop-side transport/probe codes (workspace-cli.mjs); any other code on
 * an ok:false result is the kernel's own refusal, reported verbatim. */
const LOCAL_CODES = new Set(['E_CLI_UNAVAILABLE', 'E_WORKSPACE_FEATURE', 'E_CLI_FAILED', 'E_CLI_PROTOCOL', 'E_CLI_TIMEOUT', 'E_CLI_OUTPUT_LIMIT']);

/** What the catalog table depends on, from `oats workspace status --json` as
 * projected by workspaceStatusData. Member capabilities move with member
 * commits and the workspace commit (the soul key carries those, plus the
 * CLI); package capabilities move with package identity (id/version/commit/
 * integrity, i.e. the lock rows); whether the lock is current moves with
 * declaredPackages/unsynced/stale (oats-local.yaml or the lock changed). The
 * lock fact itself has no hash, so the package rows are its identity and
 * its path/lockfileVersion only mark a different lock file altogether.
 * Names, warnings, problems, defaults and clones are deliberately not here:
 * they change without the table changing. */
export function capabilityCatalogKey(cli, workspaceStatus) {
  const ws = workspaceStatus || {};
  return JSON.stringify([soulCatalogKey(cli, workspaceStatus),
    (ws.packages || []).map(p => [p.id ?? null, p.version ?? null, p.commit ?? null, p.integrity ?? null]),
    ws.declaredPackages ?? [], ws.unsynced ?? [], ws.stale ?? [],
    ws.lock ? [ws.lock.path ?? null, ws.lock.lockfileVersion ?? null] : null]);
}

export function createCapabilityCatalog({ invoke = cliWorkspace, now = () => Date.now() } = {}) {
  async function read(deployment, cli, options) {
    let result;
    try { result = await invoke(cli, { action: 'capabilities', context: deployment, ...options }); }
    catch { return { value: null, reason: { code: 'E_CLI_FAILED', message: '', kernel: false } }; }
    if (result?.ok !== true) {
      const code = typeof result?.reason?.code === 'string' ? result.reason.code : 'E_CLI_FAILED';
      return { value: null, reason: { code, message: String(result?.reason?.message || ''), kernel: !LOCAL_CODES.has(code) } };
    }
    try {
      const stamp = result.document?.result?.observation?.observedAt;
      return { value: capabilitiesData(result.document), observedAt: typeof stamp === 'string' ? stamp : null };
    } catch { return { value: null, reason: { code: 'E_CLI_PROTOCOL', message: '', kernel: false } }; }
  }
  const catalog = createKeyedCatalog({ read, retryMs: CAPABILITY_CATALOG_RETRY_MS, now });
  const project = (deployment, entry) => entry && { key: entry.key, capabilities: entry.value, reason: entry.reason, at: entry.at, observedAt: entry.observedAt, refreshing: catalog.refreshing(deployment) };
  const key = (cli, workspaceStatus) => capabilityCatalogKey(cli, workspaceStatus);
  return {
    /** Cold cycle: start the read alongside the roster reads, before the key is known. */
    prefetch(deployment, cli, options = {}) { return catalog.prefetch(deployment, cli, options); },
    /** Bind this cycle's key: a read starts only when the held table is not for this state (or its
     * failure is old enough to retry) and none is in flight. Never awaits. */
    ensure(deployment, cli, workspaceStatus, options = {}) { catalog.settle(deployment, cli, key(cli, workspaceStatus), options); },
    /** The held table, immediately, with any needed re-read started behind it; awaited only when
     * nothing is held yet or the caller forces a live read (refresh: true → maxAge 0, joining an
     * in-flight read). */
    async read(deployment, cli, workspaceStatus, { refresh = false, maxAge } = {}) {
      if (refresh) return project(deployment, await catalog.refresh(deployment, cli, key(cli, workspaceStatus)));
      const { entry, pending } = catalog.settle(deployment, cli, key(cli, workspaceStatus), maxAge !== undefined ? { maxAge } : {});
      return project(deployment, entry ?? (pending ? await pending : null));
    },
    held(deployment) { return project(deployment, catalog.held(deployment)); },
    refreshing: catalog.refreshing,
    forget: catalog.forget,
    forgetAll: catalog.forgetAll,
  };
}
