/** Exact local soul/anchor admission against the deployment's spawn catalog,
 * the two-slot read-only preview budget, and the dialog's settled-answer cache.
 *
 * The cache (60 s, keyed by the admission identity) serves only the dialog's
 * preview route: an answer is still admitted against the current context before
 * it is returned, and a workspace's entries go when Desktop observes a change
 * that can alter a preview (oats-web.mjs). Prepare reads through the uncached
 * `spawnPreviewRequest`, so the decision a spawn binds is always a fresh read. */
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { cliSpawnPreview } from '../spawn-preview-cli.mjs';
import { admitInstance } from './instance-admission.mjs';
import { absolute, record, previewSelector, previewChoices, previewSupported, previewFailure, previewData, previewComposedFrom } from '../renderer/spawn-preview-contract.mjs';
const flights = new Set(), byInvoker = new WeakMap();
// A monotonic clock orders flight starts against invalidations: a flight that
// started before its workspace was invalidated never fills the cache, even when
// a later request coalesced onto it.
let clock = 0;
const flightStarted = new WeakMap();
export const PREVIEW_CACHE_TTL_MS = 60000;
// A name refusal answers the same name the same way until something changes.
const CACHED_REFUSALS = ['E_INSTANCE_NAME_TAKEN', 'E_INSTANCE_NAME_INVALID'];
const cacheable = result => result?.status === 'available' || result?.status === 'unavailable' && CACHED_REFUSALS.includes(result.reason?.code);
export function createSpawnPreviewCache({ ttlMs = PREVIEW_CACHE_TTL_MS, limit = 64, now = () => performance.now() } = {}) {
  const entries = new Map(), invalidatedAt = new Map();
  let clearedAt = 0;
  return {
    get(identity) {
      const entry = entries.get(identity);
      if (!entry) return null;
      if (now() >= entry.expires) { entries.delete(identity); return null; }
      return structuredClone(entry.result);
    },
    set(identity, workspace, result, startedAt) {
      if (!cacheable(result) || typeof startedAt !== 'number' || startedAt <= clearedAt || startedAt <= (invalidatedAt.get(workspace) ?? 0)) return;
      entries.delete(identity); entries.set(identity, { workspace, result: structuredClone(result), expires: now() + ttlMs });
      for (const [key, entry] of entries) if (now() >= entry.expires) entries.delete(key);
      while (entries.size > limit) entries.delete(entries.keys().next().value);
    },
    /** A workspace's answers go (no argument: every workspace's), and no flight in the air may refill them. */
    invalidate(workspace) {
      if (workspace === undefined) { clearedAt = ++clock; entries.clear(); return; }
      invalidatedAt.set(workspace, ++clock);
      for (const [key, entry] of entries) if (entry.workspace === workspace) entries.delete(key);
    },
    size: () => entries.size,
  };
}
export function admitSpawnSelection(selector, choices, { workspace: w, cli, agents = [], instances = [] } = {}) {
  const fail = error => ({ error });
  if (!w || typeof w.id !== 'string' || !w.id || !absolute(w.scope)) return fail('E_WORKSPACE_UNKNOWN');
  if (w.remote || w.server) return fail('unsupported-remote-operation');
  if (!previewSupported(cli)) return fail('E_PREVIEW_UNAVAILABLE');
  const rows = agents.filter(a => a.name === selector.soul && a.agentsRoot === selector.agentsRoot);
  if (rows.length !== 1) return fail('E_SOUL_UNKNOWN');
  const soul = rows[0];
  if (soul.remote || soul.server) return fail('unsupported-remote-operation');
  if (soul.work === 'attached') return fail('E_UNSUPPORTED_MODE'); // no renderer workDir authority
  // An exact (unprefixed) name only where the CLI advertises it.
  if (choices.name !== undefined && !cli.features.includes('spawn-name')) return fail('E_UNSUPPORTED_OPTION');
  if (choices.identity !== undefined && !cli.features.includes('spawn-provider-payload')) return fail('E_UNSUPPORTED_OPTION');
  // The one work override offered: a checkout soul asked for a worktree.
  if (choices.work !== undefined && soul.work !== 'checkout') return fail('E_UNSUPPORTED_OPTION');
  const work = choices.work ?? soul.work;
  if ((choices.base !== undefined || choices.branch !== undefined) && work !== 'worktree') return fail('E_UNSUPPORTED_OPTION');
  const supports = (values, value) => Array.isArray(values) && values.includes(value);
  if (choices.harness && !supports(cli.harnesses, choices.harness) || choices.backend && !supports(cli.sessionBackends, choices.backend)
    || choices.yolo !== undefined && !supports(cli.launchOptions, 'yolo') || choices.launchConfig && !cli.features.includes('launch-config')) return fail('E_UNSUPPORTED_OPTION');
  let anchorIdentity = null;
  if (choices.relation.kind !== 'unrelated') {
    const a = choices.relation.anchor, admitted = admitInstance(a, { workspace: w, cli, instances });
    if (admitted.code) return fail(admitted.code);
    // The CLI takes name+root, not agent+name+root. Do not pretend that a more
    // precise renderer selector can disambiguate what its public argv cannot.
    const expressible = instances.filter(i => i.instance === a.instance && i.agentsRoot === a.agentsRoot && (i.server ?? null) === null);
    if (expressible.length !== 1) return fail('E_RELATIVE_AMBIGUOUS');
    anchorIdentity = [admitted.target, expressible[0].createdAt ?? null];
  }
  const target = { workspace: w.id, context: dirname(soul.agentsRoot), selector };
  const identity = JSON.stringify([w.id, w.scope, target, soul.work, soul.repo, soul.capability, anchorIdentity, choices,
    cli.bin, cli.version, cli.spawnPreviewApi, cli.spawnApplyApi, cli.features, cli.harnesses, cli.sessionBackends, cli.launchOptions]);
  return { target, identity, cli: structuredClone(cli) };
}
export function createSpawnPreviewBoundary({ invoke = cliSpawnPreview, cache = null } = {}) {
  return async function read(request, getContext) {
    try {
      if (!record(request) || request.action !== 'preview' || Object.keys(request).some(k => !['action', 'selector', 'choices'].includes(k))) return previewFailure('E_BAD_ARGS');
      const selector = previewSelector(request.selector), choices = previewChoices(request.choices);
      if (!selector || !choices) return previewFailure('E_BAD_ARGS');
      const selected = admitSpawnSelection(selector, choices, getContext());
      if (selected.error) return previewFailure(selected.error);
      const { target, identity, cli } = selected;
      const held = cache?.get(identity);
      if (held) return held; // admitted above against the current context, like a fresh answer
      let pending = byInvoker.get(invoke); if (!pending) { pending = new Map(); byInvoker.set(invoke, pending); }
      if (!pending.has(identity)) {
        if (flights.size >= 2) return previewFailure('E_BUSY', target);
        const slot = {}; flights.add(slot);
        const flight = Promise.resolve().then(() => invoke(cli, { target, choices })).then(envelope => {
          if (envelope?.schemaVersion !== 1 || envelope.ok !== true) return previewFailure(envelope?.error?.code, target, envelope?.error?.message, envelope?.error?.details?.fix);
          const data = previewData(envelope.result, target, { composedFrom: previewComposedFrom(cli) });
          return data ? { spawnPreviewViewApi: 1, status: 'available', target, data, reason: null } : previewFailure('E_CLI_PROTOCOL', target);
        }).catch(() => previewFailure('E_CLI_FAILED', target)).finally(() => { flights.delete(slot); pending.delete(identity); });
        flightStarted.set(flight, ++clock); pending.set(identity, flight);
      }
      const flight = pending.get(identity), result = await flight, current = admitSpawnSelection(selector, choices, getContext());
      if (current.identity !== identity) return previewFailure('E_TARGET_CHANGED', target);
      cache?.set(identity, target.workspace, result, flightStarted.get(flight));
      return result;
    } catch { return previewFailure('E_CLI_FAILED'); }
  };
}
/** Uncached: prepare's read (spawn-apply.mjs). */
export const spawnPreviewRequest = createSpawnPreviewBoundary();
/** The dialog's preview route: settled answers reused within the TTL. */
export const spawnPreviewCache = createSpawnPreviewCache();
export const spawnPreviewCachedRequest = createSpawnPreviewBoundary({ cache: spawnPreviewCache });
