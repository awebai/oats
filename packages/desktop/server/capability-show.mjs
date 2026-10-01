/** POST /api/capabilities { action: show|file, capability, path? } — what one capability ships
 * (`oats capabilities show`, feature capability-show, capabilityShowApi 1), for the capability
 * page's Contents reader. Local deployments only.
 *
 * The renderer's selector is never trusted: it must name exactly ONE row of the capabilities
 * table this server holds for the workspace (the same kernel answer the renderer listed from), and
 * the verb runs with that row's coordinates. A refusal is the kernel's code and message verbatim;
 * an answer this Desktop cannot decode (renderer/capability-show-contract.mjs, strict) is
 * E_CLI_PROTOCOL. Nothing here reads a capability file itself or infers one the kernel did not list:
 * a `file` request is answered only for a path the show listing names (E_CAPABILITY_FILE_UNKNOWN
 * otherwise, before any `--file` run).
 *
 * Successful decoded answers are held in a small LRU keyed by (deployment, selector, the catalog
 * row's commit[, path]): a capability's content at one commit cannot change, so the key is the
 * whole invalidation story — a sync or pull moves the commit and the next read misses. A row
 * without a commit (nothing would tell its content moved) and an answer about another commit than
 * the row's (the head moved between the two reads) are returned but never held, only coalesced.
 * Identical concurrent requests share one kernel run; failures are never held. */
import { cliWorkspace, workspaceFailure } from '../workspace-cli.mjs';
import {
  CAPABILITY_SHOW_UNREADABLE, capabilityFileData, capabilitySelector, capabilityShowData, capabilityShowSupported,
  listedFiles, sameSelector, selectorOf, validRelativePath,
} from '../renderer/capability-show-contract.mjs';

export const CAPABILITY_SHOW_CACHE_MAX = 48;
const MESSAGE_MAX = 4096;
const MESSAGES = {
  E_BAD_ARGS: 'The capability request was not valid.',
  E_WORKSPACE_UNKNOWN: 'Select a known workspace.',
  E_REMOTE_UNSUPPORTED: 'Not available for a remote workspace yet.',
  E_CAPABILITY_SHOW_FEATURE: "The installed OATS CLI can't show what a capability ships. Update OATS and retry.",
  E_CAPABILITY_UNKNOWN: "This capability is not in the workspace's capability list. Refresh the list and try again.",
  E_CAPABILITY_FILE_UNKNOWN: 'Not available.',
  E_CLI_PROTOCOL: CAPABILITY_SHOW_UNREADABLE,
};
const record = v => !!v && typeof v === 'object' && !Array.isArray(v);
const fail = (code, message = MESSAGES[code]) => { throw Object.assign(new Error(String(message).slice(0, MESSAGE_MAX)), { code }); };

/** Every coordinate travels, absent ones as null: two subjects that differ in any never share an entry. */
export function capabilityShowKey({ deployment, selector, commit, path = null }) {
  return JSON.stringify([deployment, selector.name, selector.kind, selector.repoKey ?? null, selector.package ?? null, commit, path]);
}

/** A bounded LRU of settled successful answers with in-flight coalescing. `read(key, produce, { keep })`:
 * a held answer is served (a copy); otherwise an identical flight is joined or `produce` runs once.
 * `keep` (a boolean, or a predicate on the produced value) says whether the answer may be held;
 * false coalesces without holding. A flight that started before `clear()` never stores. */
export function createCapabilityShowCache({ max = CAPABILITY_SHOW_CACHE_MAX } = {}) {
  const entries = new Map(); // insertion order is recency: the first key is the LRU
  const flights = new Map();
  let generation = 0;
  function store(key, value) {
    entries.delete(key); entries.set(key, value);
    while (entries.size > max) entries.delete(entries.keys().next().value);
  }
  return {
    async read(key, produce, { keep = true } = {}) {
      if (entries.has(key)) { const value = entries.get(key); store(key, value); return structuredClone(value); }
      let flight = flights.get(key);
      if (!flight) {
        const startedAt = generation;
        flight = Promise.resolve().then(produce).then(value => {
          if ((typeof keep === 'function' ? keep(value) : keep) && startedAt === generation) store(key, value);
          return value;
        });
        flights.set(key, flight);
        flight.finally(() => { if (flights.get(key) === flight) flights.delete(key); }).catch(() => {});
      }
      return structuredClone(await flight);
    },
    clear() { generation++; entries.clear(); flights.clear(); },
    get size() { return entries.size; },
  };
}

/** `request`: { action: 'show', capability } | { action: 'file', capability, path } (exact keys).
 * `catalog`: the held capability rows for this workspace (array or null), or a function yielding them,
 * called only once the request is otherwise admissible. Resolves with the decoded answer; throws an
 * Error carrying a stable `code`. */
export async function capabilityShowRequest(request, { workspace, cli, catalog = null, invoke = cliWorkspace, cache = null, maxAge } = {}) {
  if (!workspace) fail('E_WORKSPACE_UNKNOWN');
  if (!record(request) || !['show', 'file'].includes(request.action)) fail('E_BAD_ARGS');
  const keys = Object.keys(request).sort().join(',');
  if (keys !== (request.action === 'show' ? 'action,capability' : 'action,capability,path')) fail('E_BAD_ARGS');
  const asked = selectorOf(request.capability);
  if (!asked) fail('E_BAD_ARGS');
  if (request.action === 'file' && !validRelativePath(request.path)) fail('E_BAD_ARGS');
  if (workspace.remote || workspace.server) fail('E_REMOTE_UNSUPPORTED');
  if (typeof workspace.scope !== 'string') fail('E_WORKSPACE_UNKNOWN');
  if (!capabilityShowSupported(cli)) fail('E_CAPABILITY_SHOW_FEATURE');
  // The row the server holds, never the renderer's word for it: one exact match or nothing.
  let rows;
  try { rows = typeof catalog === 'function' ? await catalog() : catalog; } catch { rows = null; }
  const matches = Array.isArray(rows) ? rows.filter(row => sameSelector(capabilitySelector(row), asked)) : [];
  if (matches.length !== 1) fail('E_CAPABILITY_UNKNOWN');
  const row = matches[0], selector = capabilitySelector(row);
  const commit = typeof row.commit === 'string' && row.commit ? row.commit : null;
  /** One read (the listing when `path` is null, else that file), through the cache when there is one.
   * An answer is held only when it is about the row's commit (and, for a file, the listing's): when the
   * head moved between the catalog read and this one it is returned unheld, so nothing is ever held
   * under a commit it does not describe (the renderer refreshes the catalog on the commit change). */
  const read = (path, listing = null) => {
    const options = { action: 'capability-show', context: workspace.scope, name: selector.name,
      ...(selector.kind === 'member' ? { member: selector.repoKey } : { package: selector.package }),
      ...(path !== null ? { path } : {}), ...(maxAge !== undefined ? { maxAge } : {}) };
    const produce = async () => {
      let result;
      try { result = await invoke(cli, options); } catch { result = workspaceFailure('E_CLI_FAILED'); }
      if (result?.ok !== true) {
        // The kernel's (or the adapter's) code and message, verbatim; only a missing message gets the stock one.
        const code = typeof result?.reason?.code === 'string' && result.reason.code ? result.reason.code : 'E_CLI_FAILED';
        const message = result?.reason?.message;
        fail(code, typeof message === 'string' && message ? message : MESSAGES[code] ?? workspaceFailure(code).reason.message);
      }
      const data = path === null ? capabilityShowData(result.document?.result, { selector })
        : capabilityFileData(result.document?.result, { selector, path });
      if (!data) fail('E_CLI_PROTOCOL');
      return data;
    };
    return cache ? cache.read(capabilityShowKey({ deployment: workspace.scope, selector, commit, path }), produce, { keep: value => commit !== null && value.commit === commit && (listing === null || listing.commit === value.commit) })
      : produce();
  };
  if (request.action === 'show') return read(null);
  // A file is readable only when the listing names it (the inject, or a skill's listed file): the listing is
  // the same cached read the Contents view made, so this costs a kernel run only on a cold cache, and an
  // unlisted path never reaches `--file`. A failed listing fails the file request with its own error.
  const listing = await read(null);
  if (!listedFiles(listing).has(request.path)) fail('E_CAPABILITY_FILE_UNKNOWN');
  return read(request.path, listing);
}
