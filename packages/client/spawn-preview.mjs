/** Exact local soul/anchor admission against the deployment's spawn catalog,
 * the two-slot read-only preview budget, and the dialog's settled-answer cache.
 *
 * A client makes its own preview (createSpawnPreview) and owns it: nothing here is
 * held at module level, so two clients' budgets, caches and flights never meet.
 * The cache (keyed by the admission identity) serves the dialog's preview read for
 * 60 s and prepare's for PREPARE_REUSE_MS (#1246: the prepared intent's own lifetime,
 * so a press after the operator lingered over the form runs no second kernel preview):
 * an answer is still admitted against the current context before it is returned, and a
 * workspace's entries go when the client observes a change that can alter a preview (the
 * Desktop's: server/oats-web.mjs). Prepare taking a held decision is safe because apply
 * binds it with the kernel's --expect-decision: a decision the kernel no longer makes is
 * refused there (E_DECISION_STALE, read as drifted), never applied. */
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { cliSpawnPreview, cliInstanceSuggestName } from './spawn-preview-cli.mjs';
import { admitInstance } from './instance-admission.mjs';
import { absolute, record, previewSelector, previewChoices, previewSupported, previewFailure, previewData, previewComposedFrom, suggestSupported, suggestTask,
  instanceSuggestSupported, instanceSuggestRequest, instanceSuggestion } from './spawn-preview-contract.mjs';
/** One preview's flights: its two-slot budget (`slots`), the flights in the air per invoker (`byInvoker`, where
 * exact duplicates coalesce), and the monotonic clock that stamps each flight's start (`started`). The cache is
 * given the same clock: it orders flight starts against invalidations, so a flight that started before its
 * workspace was invalidated never fills the cache, even when a later request coalesced onto it. */
export function createSpawnPreviewFlights() {
  let stamp = 0;
  return { slots: new Set(), byInvoker: new WeakMap(), started: new WeakMap(), clock: () => ++stamp };
}
const missing = (factory, what) => new TypeError(`${factory}: ${what} is required`);
export const PREVIEW_CACHE_TTL_MS = 60000;
/** How old a held answer prepare may take (#1246): the lifetime of the intent it prepares. */
export const PREPARE_REUSE_MS = 300000;
// A name refusal answers the same name the same way until something changes.
const CACHED_REFUSALS = ['E_INSTANCE_NAME_TAKEN', 'E_INSTANCE_NAME_INVALID'];
const cacheable = result => result?.status === 'available' || result?.status === 'unavailable' && CACHED_REFUSALS.includes(result.reason?.code);
/** `clock` is the flights' clock (createSpawnPreviewFlights): required, never a clock of its own. An entry is kept
 * for `keepMs` (at least `ttlMs`) from when it was read; `get(identity, maxAgeMs)` answers it only while it is
 * younger than `maxAgeMs` (default `ttlMs`): the dialog's reads take 60 s, prepare's PREPARE_REUSE_MS. */
export function createSpawnPreviewCache({ ttlMs = PREVIEW_CACHE_TTL_MS, keepMs = ttlMs, limit = 64, now = () => performance.now(), clock } = {}) {
  if (typeof clock !== 'function') throw missing('createSpawnPreviewCache', 'clock (the flights\' clock)');
  const entries = new Map(), invalidatedAt = new Map();
  let clearedAt = 0;
  const kept = Math.max(ttlMs, keepMs);
  return {
    get(identity, maxAgeMs = ttlMs) {
      const entry = entries.get(identity);
      if (!entry) return null;
      if (now() >= entry.expires) { entries.delete(identity); return null; }
      if (now() - entry.readAt >= maxAgeMs) return null; // too old for this reader; a longer-lived one may still take it
      return structuredClone(entry.result);
    },
    set(identity, workspace, result, startedAt) {
      if (!cacheable(result) || typeof startedAt !== 'number' || startedAt <= clearedAt || startedAt <= (invalidatedAt.get(workspace) ?? 0)) return;
      const readAt = now();
      entries.delete(identity); entries.set(identity, { workspace, result: structuredClone(result), readAt, expires: readAt + kept });
      for (const [key, entry] of entries) if (now() >= entry.expires) entries.delete(key);
      while (entries.size > limit) entries.delete(entries.keys().next().value);
    },
    /** A workspace's answers go (no argument: every workspace's), and no flight in the air may refill them. */
    invalidate(workspace) {
      if (workspace === undefined) { clearedAt = clock(); entries.clear(); return; }
      invalidatedAt.set(workspace, clock());
      for (const [key, entry] of entries) if (entry.workspace === workspace) entries.delete(key);
    },
    size: () => entries.size,
    clock,
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
  // Run in background (#1579): --background / --no-background only where the CLI lists instance-background.
  if (choices.background !== undefined && !cli.features.includes('instance-background')) return fail('E_UNSUPPORTED_OPTION');
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
/** One read of a preview. `flights` (createSpawnPreviewFlights) is required: the reads of one preview share it,
 * and a cache given here must run on its clock. maxAge: the dialog's reads may reuse member heads the kernel
 * observed within that many seconds (feature spawn-preview-max-age, passed only when the admitted CLI
 * advertises it). Prepare's reads never do. heldMs: how old a held answer this read takes (default: the cache's
 * TTL). exec: as createSpawnPreview's. */
export function createSpawnPreviewBoundary({ invoke = cliSpawnPreview, cache = null, maxAge = null, heldMs, flights, exec } = {}) {
  if (!flights?.slots || !flights.byInvoker || !flights.started || typeof flights.clock !== 'function') throw missing('createSpawnPreviewBoundary', 'flights (createSpawnPreviewFlights)');
  if (cache && cache.clock !== flights.clock) throw new TypeError('createSpawnPreviewBoundary: the cache must run on the flights\' clock');
  const { slots, byInvoker, started } = flights, io = exec ? [{ exec }] : [];
  return async function read(request, getContext) {
    try {
      if (!record(request) || request.action !== 'preview' || Object.keys(request).some(k => !['action', 'selector', 'choices'].includes(k))) return previewFailure('E_BAD_ARGS');
      const selector = previewSelector(request.selector), choices = previewChoices(request.choices);
      if (!selector || !choices) return previewFailure('E_BAD_ARGS');
      const selected = admitSpawnSelection(selector, choices, getContext());
      if (selected.error) return previewFailure(selected.error);
      const { target, identity, cli } = selected;
      const held = cache?.get(identity, heldMs);
      if (held) return held; // admitted above against the current context, like a fresh answer
      let pending = byInvoker.get(invoke); if (!pending) { pending = new Map(); byInvoker.set(invoke, pending); }
      const reuse = maxAge !== null && cli.features.includes('spawn-preview-max-age') ? { maxAge } : {};
      // A reusing read and a live one never coalesce: prepare must not ride on a dialog read's older heads.
      const key = reuse.maxAge ? `${identity}\u0000max-age` : identity;
      if (!pending.has(key)) {
        if (slots.size >= 2) return previewFailure('E_BUSY', target);
        const slot = {}; slots.add(slot);
        const flight = Promise.resolve().then(() => invoke(cli, { target, choices, ...reuse }, ...io)).then(envelope => {
          if (envelope?.schemaVersion !== 1 || envelope.ok !== true) return previewFailure(envelope?.error?.code, target, envelope?.error?.message, envelope?.error?.details?.fix);
          const data = previewData(envelope.result, target, { composedFrom: previewComposedFrom(cli) });
          return data ? { spawnPreviewViewApi: 1, status: 'available', target, data, reason: null } : previewFailure('E_CLI_PROTOCOL', target);
        }).catch(() => previewFailure('E_CLI_FAILED', target)).finally(() => { slots.delete(slot); pending.delete(key); });
        started.set(flight, flights.clock()); pending.set(key, flight);
      }
      const flight = pending.get(key), result = await flight, current = admitSpawnSelection(selector, choices, getContext());
      if (current.identity !== identity) return previewFailure('E_TARGET_CHANGED', target);
      cache?.set(identity, target.workspace, result, started.get(flight));
      return result;
    } catch { return previewFailure('E_CLI_FAILED'); }
  };
}
/** The suggest read (feature spawn-suggest-name, awebai/oats#1421 §3): a preview that also names the instance from its
 * task, `{ action: 'suggest', selector, choices, task }`, with no name or purpose among the choices. It has its own
 * lane, outside the previews' two slots: ONE read per workspace, and a newer one ends the older (its CLI gets
 * SIGTERM, which ends the kernel's naming call too) and the older answers E_SUPERSEDED. Nothing of it is cached here
 * (the dialog caches by task), except that a suggested answer IS the preview of `--name <instance>` (the kernel's
 * contract), so it is held as that preview's answer, for the dialog's next read and for prepare. */
export function createSpawnSuggestBoundary({ invoke = cliSpawnPreview, cache = null, maxAge = null, flights, exec } = {}) {
  if (!flights?.clock) throw missing('createSpawnSuggestBoundary', 'flights (createSpawnPreviewFlights)');
  if (cache && cache.clock !== flights.clock) throw new TypeError('createSpawnSuggestBoundary: the cache must run on the flights\' clock');
  const lanes = new Map(), io = exec ? [{ exec }] : [];
  return async function suggest(request, getContext) {
    let lane = null, workspace = null;
    try {
      if (!record(request) || request.action !== 'suggest' || Object.keys(request).some(k => !['action', 'selector', 'choices', 'task'].includes(k))) return previewFailure('E_BAD_ARGS');
      const selector = previewSelector(request.selector), choices = previewChoices(request.choices);
      if (!selector || !choices || !suggestTask(request.task) || choices.name !== undefined || choices.purpose !== undefined) return previewFailure('E_BAD_ARGS');
      const context = getContext(), selected = admitSpawnSelection(selector, choices, context);
      if (selected.error) return previewFailure(selected.error);
      const { target, identity, cli } = selected;
      if (!suggestSupported(cli)) return previewFailure('E_UNSUPPORTED_OPTION', target);
      workspace = target.workspace;
      lanes.get(workspace)?.abort();
      lane = new AbortController(); lanes.set(workspace, lane);
      const startedAt = flights.clock();
      const reuse = maxAge !== null && cli.features.includes('spawn-preview-max-age') ? { maxAge } : {};
      const envelope = await invoke(cli, { target, choices, task: request.task, signal: lane.signal, ...reuse }, ...io);
      if (lane.signal.aborted) return previewFailure('E_SUPERSEDED', target);
      if (envelope?.schemaVersion !== 1 || envelope.ok !== true) return previewFailure(envelope?.error?.code, target, envelope?.error?.message, envelope?.error?.details?.fix);
      const data = previewData(envelope.result, target, { composedFrom: previewComposedFrom(cli) });
      if (!data?.naming) return previewFailure('E_CLI_PROTOCOL', target);
      const current = admitSpawnSelection(selector, choices, getContext());
      if (current.identity !== identity) return previewFailure('E_TARGET_CHANGED', target);
      const result = { spawnPreviewViewApi: 1, status: 'available', target, data, reason: null };
      if (cache && data.naming.source === 'suggested') {
        // The choices as a read of `--name <instance>` admits them (previewChoices's order), so its identity is the same.
        const namedChoices = previewChoices({ ...choices, name: data.instance }), named = namedChoices && admitSpawnSelection(selector, namedChoices, getContext());
        if (named && !named.error) { const { naming, ...plain } = data; cache.set(named.identity, workspace, { ...result, data: plain }, startedAt); }
      }
      return result;
    } catch { return previewFailure('E_CLI_FAILED'); }
    finally { if (lane && lanes.get(workspace) === lane) lanes.delete(workspace); }
  };
}
/** The suggest-name read (feature instance-suggest-name, awebai/oats#1490 §2): a name, chosen on this computer, for a spawn
 * on another machine, `{ action: 'suggest-name', soul, task, harness?, model? }` (instanceSuggestRequest). It is addressed
 * to one of this computer's deployments, whose launch configurations the kernel reads (`--dir`); nothing of the soul is
 * admitted here (it is the host's). One read per deployment: a newer one ends the older (its CLI gets SIGTERM, which ends
 * the kernel's naming call too) and the older answers E_SUPERSEDED. Nothing is cached here (the dialog caches by task).
 * Answers `{ spawnPreviewViewApi: 1, status: 'available', workspace, data: { name?, naming }, reason: null }`. */
export function createInstanceSuggestBoundary({ invoke = cliInstanceSuggestName, exec } = {}) {
  const lanes = new Map(), io = exec ? [{ exec }] : [];
  return async function suggestName(request, getContext) {
    let lane = null, workspace = null;
    try {
      const asked = instanceSuggestRequest(request);
      if (!asked) return previewFailure('E_BAD_ARGS');
      const { workspace: w, cli } = getContext();
      if (!w || typeof w.id !== 'string' || !w.id || !absolute(w.scope)) return previewFailure('E_WORKSPACE_UNKNOWN');
      if (w.remote || w.server) return previewFailure('unsupported-remote-operation');
      if (!instanceSuggestSupported(cli)) return previewFailure('E_UNSUPPORTED_OPTION');
      workspace = w.id;
      lanes.get(workspace)?.abort();
      lane = new AbortController(); lanes.set(workspace, lane);
      const envelope = await invoke(cli, { request: asked, dir: w.scope, signal: lane.signal }, ...io);
      if (lane.signal.aborted) return previewFailure('E_SUPERSEDED');
      if (envelope?.schemaVersion !== 1 || envelope.ok !== true) return previewFailure(envelope?.error?.code, null, envelope?.error?.message, envelope?.error?.details?.fix);
      const data = instanceSuggestion(envelope.result);
      if (!data) return previewFailure('E_CLI_PROTOCOL');
      return { spawnPreviewViewApi: 1, status: 'available', workspace, data, reason: null };
    } catch { return previewFailure('E_CLI_FAILED'); }
    finally { if (lane && lanes.get(workspace) === lane) lanes.delete(workspace); }
  };
}
export const PREVIEW_MAX_AGE_S = 60;
/** One client's spawn preview: `{ read, prepareRead, suggest, cache }`.
 *   read         the dialog's read, through the cache; its kernel reads may reuse recent member heads (maxAge,
 *                where the CLI declares spawn-preview-max-age)
 *   suggest      the suggest read (createSpawnSuggestBoundary): its own lane, one per workspace, the newer ending the older
 *   suggestName  the suggest-name read (createInstanceSuggestBoundary): a name chosen here for a spawn on another machine
 *   prepareRead  prepare's read (spawn-apply.mjs createSpawnApplyBoundary's `read`), through the same cache,
 *                taking a held answer up to `prepareReuseMs` old (PREPARE_REUSE_MS), never with maxAge; a reusing
 *                read and a live one never coalesce
 *   cache        `invalidate(workspace?)` (no argument: every workspace's answers) and `size()`
 * The two reads share one two-slot budget, one set of coalesced flights and one clock, the cache's too.
 *   exec  optional: the client's own execFile, passed to `invoke` as `invoke(cli, options, { exec })` for both
 *         reads (cli-adapter.mjs `runJson` has the rule); without it `invoke` is given no third argument and
 *         cliSpawnPreview's own default runs. A read is a read: its options carry no `detached` and a 30 s
 *         deadline, and it ends with its caller. */
export function createSpawnPreview({ invoke = cliSpawnPreview, exec, now = () => performance.now(), ttlMs = PREVIEW_CACHE_TTL_MS,
  prepareReuseMs = PREPARE_REUSE_MS, limit = 64, maxAge = PREVIEW_MAX_AGE_S } = {}) {
  const flights = createSpawnPreviewFlights();
  const cache = createSpawnPreviewCache({ ttlMs, keepMs: prepareReuseMs, limit, now, clock: flights.clock });
  return {
    read: createSpawnPreviewBoundary({ invoke, cache, maxAge, heldMs: ttlMs, flights, exec }),
    prepareRead: createSpawnPreviewBoundary({ invoke, cache, heldMs: prepareReuseMs, flights, exec }),
    suggest: createSpawnSuggestBoundary({ invoke, cache, maxAge, flights, exec }),
    suggestName: createInstanceSuggestBoundary({ exec }),
    cache: { invalidate: workspace => cache.invalidate(workspace), size: () => cache.size() },
  };
}
