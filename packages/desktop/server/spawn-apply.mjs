/** One backend-owned confirmed-spawn broker across all workspaces.
 * RAM custody only. No kernel imports, placement logic, persistent instructions,
 * implicit retry, name-based recovery, or mutation from result/prepare. */
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { cliSpawnApply } from '../spawn-apply-cli.mjs';
import { admitSpawnSelection, spawnPreviewRequest } from './spawn-preview.mjs';
import { record } from '../renderer/spawn-preview-contract.mjs';
import { spawnApplySupported, spawnApplyChoicesSupported, spawnPrepareInput, spawnRefInput, spawnPreparedData, spawnReference,
  spawnCreationReceipt, spawnApplyFailure, WAKE_OUTCOME_UNKNOWN } from '../renderer/spawn-apply-contract.mjs';
const clone = v => structuredClone(v);
const byteSize = v => Buffer.byteLength(JSON.stringify(v));
const scopeKey = c => JSON.stringify([c?.workspace?.id, c?.workspace?.scope, c?.workspace?.remote, c?.workspace?.server,
  c?.cli?.bin, c?.cli?.version, c?.cli?.spawnPreviewApi, c?.cli?.spawnApplyApi, c?.cli?.features, c?.cli?.runtimes, c?.cli?.sessionBackends, c?.cli?.launchOptions]);
export function createSpawnApplyBoundary({ read = spawnPreviewRequest, invoke = cliSpawnApply,
  now = () => performance.now(), mint = () => randomBytes(32).toString('hex') } = {}) {
  const prepared = new Map(), submitted = new Map();
  let preparing = 0, reservedBytes = 0, active = null;
  const denied = (code, entry = null, status = 'unavailable') => spawnApplyFailure(code, { target: entry?.target, spawnRef: entry?.ref, status });
  const sweep = () => { for (const map of [prepared, submitted]) for (const [ref, entry] of map) if (!entry.pending && entry.expires <= now()) map.delete(ref); };
  const usedBytes = () => reservedBytes + [...prepared.values(), ...submitted.values()].reduce((sum, e) => sum + e.bytes, 0);
  const freshId = () => {
    const id = mint();
    return spawnReference(id) && !prepared.has(id) && !submitted.has(id) && ![...submitted.values()].some(e => e.key === id) ? id : null;
  };
  function select(input, getContext) {
    const c = getContext();
    if (!spawnApplySupported(c?.cli)) return { error: 'E_APPLY_UNAVAILABLE' };
    if (!spawnApplyChoicesSupported(c.cli, input.choices, !!input.wake)) return { error: 'E_UNSUPPORTED_OPTION' };
    const s = admitSpawnSelection(input.selector, input.choices, c);
    if (s.error) return s;
    const soul = c.agents.find(a => a.name === input.selector.soul && a.agentsRoot === input.selector.agentsRoot);
    const anchor = input.choices.relation.anchor;
    if (soul?.captured || anchor && c.instances?.some(i => i.instance === anchor.instance && i.agentsRoot === anchor.agentsRoot && i.captured)) return { error: 'E_UNSUPPORTED_MODE' };
    return { ...s, scope: scopeKey(c) };
  }
  const same = (a, b) => !b.error && a.identity === b.identity && a.scope === b.scope;
  const ownsScope = (e, getContext) => { try { const c = getContext(); return spawnApplySupported(c?.cli) && !c.workspace?.remote && !c.workspace?.server && scopeKey(c) === e.scope; } catch { return false; } };
  const display = (entry, status, receipt = null, reason = null, extra = {}) => ({ spawnApplyViewApi: 1, status, target: entry.target, spawnRef: entry.ref,
    preview: entry.preview, wakeRequested: !!entry.input.wake, receipt, reason, ...extra });
  async function prepare(input, getContext) {
    const selection = select(input, getContext);
    if (selection.error) return denied(selection.error);
    const reservation = byteSize(input);
    if (prepared.size + preparing >= 32 || usedBytes() + reservation > 8 * 1024 * 1024) return denied('E_BUSY');
    preparing++; reservedBytes += reservation;
    let observed;
    try { observed = await read({ action: 'preview', selector: clone(input.selector), choices: clone(input.choices) }, getContext); }
    catch { observed = { status: 'unavailable', reason: { code: 'E_CLI_FAILED' } }; }
    finally { preparing--; reservedBytes -= reservation; }
    const current = select(input, getContext);
    if (!same(selection, current)) return denied('E_PLAN_CHANGED', { target: selection.target });
    if (observed?.status !== 'available') return denied(observed?.reason?.code, { target: selection.target });
    if (observed.data?.preflight?.status !== 'complete') return denied('E_PREFLIGHT_INCOMPLETE', { target: selection.target });
    const preview = spawnPreparedData(observed.data, selection.target);
    if (!preview) return denied('E_CLI_PROTOCOL', { target: selection.target });
    if (!preview.backendStatus.installed) return denied('E_BACKEND_UNAVAILABLE', { target: selection.target });
    const entry = { ...selection, input: clone(input), preview, ref: freshId(), key: null, expires: now() + 300000,
      pending: false, reply: null, seenHome: false, seenBirth: null, bytes: 0 };
    if (!entry.ref) return denied('E_BUSY', entry);
    // Reserve bounded outcome storage before dispatch. A settled reply shares
    // this immutable preview internally; public responses are always cloned.
    entry.bytes = byteSize(entry) + 3 * byteSize(preview.decision) + 2 * byteSize(entry.target) + 4096;
    if (usedBytes() + entry.bytes > 8 * 1024 * 1024) return denied('E_BUSY', entry);
    prepared.set(entry.ref, entry);
    return display(entry, 'prepared');
  }
  function observedGone(entry, getContext) {
    // A prior positive observation can block retry after disappearance/replacement.
    // Absence alone is NOT success/retirement proof and does not close a concurrent
    // retire race. The kernel key's documented lifetime is only its surviving home.
    const rows = getContext().instances || [];
    const matches = rows.filter(i => i.instance === entry.preview.decision.instance && i.home === entry.preview.decision.home
      && i.agent === entry.input.selector.soul && i.agentsRoot === entry.input.selector.agentsRoot && !i.server && !i.remote);
    const own = matches.length === 1 && matches[0].spawnIdempotencyKey === entry.key ? matches[0] : null;
    if (own) {
      const birth = typeof own.createdAt === 'string' && own.createdAt.length <= 128 ? own.createdAt : null;
      if (entry.seenBirth !== null && entry.seenBirth !== birth) return true;
      entry.seenHome = true; entry.seenBirth = birth; return false;
    }
    return entry.seenHome || matches.some(i => typeof i.spawnIdempotencyKey === 'string' && i.spawnIdempotencyKey !== entry.key);
  }
  function interpret(result, entry) {
    const envelope = result?.envelope;
    if (typeof result?.started !== 'boolean' || envelope?.schemaVersion !== 1 || typeof envelope.ok !== 'boolean') return denied('E_OUTCOME_UNKNOWN', entry, 'unknown');
    if (envelope.ok) {
      if (!result.started) return denied('E_OUTCOME_UNKNOWN', entry, 'unknown');
      const receipt = spawnCreationReceipt(envelope.result, { target: entry.target, preview: entry.preview, wakeRequested: !!entry.input.wake });
      if (!receipt) return denied('E_OUTCOME_UNKNOWN', entry, 'unknown');
      const partial = !!entry.input.wake && receipt.wake.saved !== true;
      const reason = !partial ? null : receipt.wake.error ?? { code: 'E_WAKE_OUTCOME_UNKNOWN', message: WAKE_OUTCOME_UNKNOWN };
      return display(entry, partial ? 'partial' : 'complete', receipt, reason);
    }
    const code = envelope.error?.code;
    if (!result.started) return denied(code, entry, 'refused');
    if (code === 'E_SPAWN_INCOMPLETE') {
      const d = envelope.error.details;
      if (d?.instance !== entry.preview.decision.instance || d?.home !== entry.preview.decision.home || ![false, 'unknown'].includes(d.launched)) return denied('E_OUTCOME_UNKNOWN', entry, 'unknown');
      return { ...denied(code, entry, 'incomplete'), incomplete: { instance: d.instance, home: d.home, launched: d.launched } };
    }
    // A taken explicit name (spawn-name) refuses before any home is kept: the
    // confirmation is consumed and a fresh preview reports the taken name.
    if (['E_DECISION_STALE', 'E_IDEMPOTENCY_CONFLICT', 'E_PLACEMENT_TAKEN', 'E_INSTANCE_NAME_TAKEN'].includes(code)) return denied(code, entry, 'stale');
    // Do not infer rollback from arbitrary kernel/hook failures. Only the
    // explicit binding/reservation/incomplete contracts above establish scope.
    return denied('E_OUTCOME_UNKNOWN', entry, 'unknown');
  }
  function get(ref, getContext) {
    const e = submitted.get(ref) || prepared.get(ref);
    if (!e) return { failure: denied('E_INTENT_EXPIRED') };
    if (!ownsScope(e, getContext)) return { failure: denied('E_PLAN_CHANGED', e) };
    return { entry: e };
  }
  async function apply(entry, getContext) {
    if (entry.pending) return display(entry, 'pending');
    if (entry.reply && entry.reply.status !== 'unknown') return { ...entry.reply, repeated: true };
    if (active || !submitted.has(entry.ref) && submitted.size >= 32) return denied('E_BUSY', entry);
    const current = select(entry.input, getContext);
    if (!same(entry, current)) return denied('E_PLAN_CHANGED', entry);
    if (entry.key && observedGone(entry, getContext)) {
      entry.reply = denied('E_INSTANCE_GONE', entry, 'refused'); return entry.reply;
    }
    const key = entry.key || freshId();
    if (!key) return denied('E_BUSY', entry);
    // Reserve key, slot and submitted record BEFORE any await. Key persists on
    // this intent through unknown results; neither result nor retry can mint one.
    entry.key = key; entry.pending = true; entry.expires = Infinity; active = entry;
    prepared.delete(entry.ref); submitted.set(entry.ref, entry);
    let reply;
    try {
      const latest = select(entry.input, getContext);
      if (!same(entry, latest)) reply = denied('E_PLAN_CHANGED', entry, 'refused');
      else {
        const result = await invoke(latest.cli, { target: clone(entry.target), choices: clone(entry.input.choices), task: entry.input.task,
          ...(entry.input.wake ? { wake: clone(entry.input.wake) } : {}), decision: clone(entry.preview.decision), key: entry.key });
        reply = interpret(result, entry);
      }
    } catch { reply = denied('E_OUTCOME_UNKNOWN', entry, 'unknown'); }
    finally { entry.pending = false; entry.expires = now() + 30 * 60000; if (active === entry) active = null; }
    // This result belongs to its original entry even if a view/workspace changed.
    // The caller's current context is checked separately on both settlement paths.
    entry.reply = reply; // internal preview sharing; every outward response is cloned
    return ownsScope(entry, getContext) ? reply : denied('E_OUTCOME_UNKNOWN', entry, 'unknown');
  }
  return async function spawnApplyRequest(request, getContext) {
    try {
      sweep();
      if (!record(request)) return denied('E_BAD_ARGS');
      if (request.action === 'prepare') {
        const input = spawnPrepareInput(request);
        return clone(input ? await prepare(input, getContext) : denied('E_BAD_ARGS'));
      }
      const r = spawnRefInput(request);
      if (!r) return denied('E_BAD_ARGS');
      const found = get(r.spawnRef, getContext);
      if (found.failure) return clone(found.failure);
      const e = found.entry;
      if (r.action === 'result') return clone(e.pending ? display(e, 'pending') : e.reply || display(e, 'prepared'));
      return clone(await apply(e, getContext));
    } catch { return denied('E_CLI_FAILED'); }
  };
}
export const spawnApplyRequest = createSpawnApplyBoundary();
