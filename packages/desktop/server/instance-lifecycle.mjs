/** K3 transactions: immutable admitted plan -> one explicit confirmation intent.
 * No direct Git, kernel import, PID/tmux control or legacy mutation fallback. */
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { admitInstance, instanceSelector } from './instance-admission.mjs';
import { cliLifecycle } from '../lifecycle-cli.mjs';
import { gitTargetKey } from '../renderer/instance-git-contract.mjs';
import { object, lifecycleOptions, lifecyclePlan, lifecycleReceipt, stoppedTargets, planReference, lifecycleChoicesApplicable,
  lifecycleFailure, lifecycleReason } from '../renderer/lifecycle-contract.mjs';
const clone = value => structuredClone(value);
const cliIdentity = cli => JSON.stringify([cli?.bin, cli?.version, cli?.lifecycleApi,
  Array.isArray(cli?.features) ? [...cli.features].sort() : null]);
export function supportsLifecycle(cli, operation, apply = false) {
  return cli?.ok === true && cli.lifecycleApi === 1 && Array.isArray(cli.features)
    && cli.features.length <= 128 && cli.features.every(f => typeof f === 'string')
    && cli.features.includes('lifecycle-plans')
    && (!apply || operation !== 'retire' || cli.features.includes('retire-retention') && cli.features.includes('retire-home'));
}
const beforeEffect = new Set(['E_BAD_ARGS', 'E_PLAN_STALE', 'E_INSTANCE_RETIRING', 'E_LIFECYCLE_BUSY',
  'E_HOME_MISMATCH', 'E_SESSION_UNKNOWN', 'E_AMBIGUOUS_INSTANCE']);
export function createLifecycleBoundary({ invoke = cliLifecycle, now = () => performance.now(), mint = () => randomBytes(32).toString('hex') } = {}) {
  const plans = new Map(), actions = new Map(), reads = new Map();
  let reservedPlans = 0, activeApply = null;
  const sweep = () => { for (const map of [plans, actions]) for (const [key, value] of map) {
    if (!value.pending && value.expires <= now()) map.delete(key);
  } };
  const denied = (code, target = null, extra = {}) => lifecycleFailure(code, { target, ...extra });
  function admitted(selector, operation, getContext, apply = false) {
    const context = getContext();
    const result = admitInstance(selector, context);
    if (result.code) return { failure: denied(result.code, result.target) };
    if (!supportsLifecycle(context.cli, operation, apply)) return { failure: denied('E_LIFECYCLE_UNAVAILABLE', result.target) };
    return { ...result, identity: cliIdentity(context.cli) };
  }
  const same = (a, b) => !b.failure && a.bin === b.bin && a.context === b.context && a.identity === b.identity && gitTargetKey(a.target) === gitTargetKey(b.target);
  function storePlan(plan, selection, choices) {
    if (plans.size + reservedPlans >= 32) return null;
    const id = mint(); if (!planReference(id) || plans.has(id) || actions.has(id)) return null;
    const entry = { target: clone(selection.target), context: selection.context, bin: selection.bin,
      identity: selection.identity, selector: clone(selection.selector), choices: clone(choices), plan: clone(plan), id, expires: now() + 300_000 };
    plans.set(id, entry); return entry;
  }
  const displayed = (entry, status = 'plan', reason = null) => ({ lifecycleApi: 1, status, target: entry.target, planRef: entry.id,
    plan: entry.plan, options: entry.choices, receipt: null, reason });
  async function plan(request, getContext) {
    const choices = lifecycleOptions(request.operation, request.options);
    if (!choices || !instanceSelector(request.selector) || Object.keys(request).some(k => !['action', 'operation', 'selector', 'options'].includes(k))) return denied('E_BAD_ARGS');
    const selected = admitted(request.selector, request.operation, getContext);
    if (selected.failure) return selected.failure;
    if (plans.size + reservedPlans >= 32) return denied('E_LIFECYCLE_BUSY', selected.target);
    const key = JSON.stringify([selected.identity, selected.context, gitTargetKey(selected.target), request.operation, choices]);
    if (!reads.has(key) && reads.size >= 4) return denied('E_LIFECYCLE_BUSY', selected.target);
    if (!reads.has(key)) {
      const args = { operation: request.operation, phase: 'plan', instance: selected.target.instance, home: selected.target.home, context: selected.context, choices };
      const pending = Promise.resolve().then(() => invoke(selected.bin, args)).catch(() => ({ ok: false, error: { code: 'E_CLI_FAILED' } })).finally(() => reads.delete(key));
      reads.set(key, pending);
    }
    reservedPlans++;
    let envelope;
    try { envelope = await reads.get(key); } finally { reservedPlans--; }
    // The CLI read can be shared, but each confirmation gets its OWN ref/key.
    const current = admitted(request.selector, request.operation, getContext);
    if (!same(selected, current)) return denied('E_PLAN_CHANGED', selected.target);
    if (envelope?.schemaVersion !== 1 || envelope.ok !== true) return denied(envelope?.error?.code || 'E_CLI_PROTOCOL', selected.target);
    const data = lifecyclePlan(envelope.result, selected.target, request.operation, choices);
    if (!data) return denied('E_CLI_PROTOCOL', selected.target);
    const entry = storePlan(data, { ...selected, selector: clone(request.selector) }, choices);
    return entry ? displayed(entry) : denied('E_LIFECYCLE_BUSY', selected.target);
  }
  function interpret(envelope, entry) {
    const extra = { planRef: entry.id, options: entry.choices };
    const failure = (code, status, more = {}) => denied(code, entry.target, { ...extra, status, ...more });
    if (envelope?.schemaVersion !== 1 || typeof envelope.ok !== 'boolean') return failure('E_OUTCOME_UNKNOWN', 'unknown');
    // A failed retire can still carry a bounded incomplete-cleanup receipt.
    if (envelope.result) {
      const receipt = lifecycleReceipt(envelope.result, entry.plan, entry.key);
      if (!receipt) return failure('E_OUTCOME_UNKNOWN', 'unknown', { cause: lifecycleReason('E_CLI_PROTOCOL') });
      const complete = receipt.action === 'stop' ? receipt.ok : receipt.removedDir && !receipt.incomplete && !receipt.retention?.branchDeletionSkipped;
      return { lifecycleApi: 1, status: receipt.deferred ? 'pending' : complete ? 'complete' : 'partial', target: entry.target, planRef: entry.id,
        options: entry.choices, plan: null, receipt, reason: complete ? null : lifecycleReason(receipt.action === 'stop' ? 'E_SESSION_STOP_FAILED' : 'E_RETIRE_INCOMPLETE') };
    }
    const code = envelope.error?.code;
    if (code === 'E_PLAN_STALE') {
      const fresh = lifecyclePlan(envelope.error?.details?.plan, entry.target, entry.plan.action, entry.choices);
      if (!fresh) return failure('E_OUTCOME_UNKNOWN', 'unknown', { cause: lifecycleReason('E_CLI_PROTOCOL') });
      const replacement = storePlan(fresh, entry, entry.choices);
      return replacement ? displayed(replacement, 'stale', lifecycleReason(code)) : failure(code, 'stale', { plan: fresh });
    }
    if (code === 'E_CHILDREN_RUNNING' && entry.plan.action === 'retire') {
      const fresh = lifecyclePlan(envelope.error?.details?.plan, entry.target, 'retire', entry.choices);
      const childrenStopped = fresh && stoppedTargets(envelope.error?.details?.childrenStopped, fresh.facts.children);
      if (!childrenStopped || childrenStopped.every(c => c.ok)) return failure('E_OUTCOME_UNKNOWN', 'unknown');
      // This is the attempted plan, NOT a new executable confirmation: some
      // children have already stopped. The user must explicitly read a new plan.
      return failure(code, 'refused', { plan: fresh, childrenStopped });
    }
    if (beforeEffect.has(code)) return failure(code, 'refused');
    return failure('E_OUTCOME_UNKNOWN', 'unknown', { cause: lifecycleReason(code) });
  }
  function apply(request, getContext, ws) {
    if (Object.keys(request).some(k => !['action', 'planRef'].includes(k)) || !planReference(request.planRef)) return Promise.resolve(denied('E_BAD_ARGS'));
    const entry = actions.get(request.planRef) || plans.get(request.planRef);
    if (!entry) return Promise.resolve(denied('E_PLAN_EXPIRED'));
    const context = getContext();
    if (!context.workspace || context.workspace.id !== ws || ws !== entry.target.workspace || context.workspace.scope !== entry.context
      || context.workspace.remote || context.workspace.server || cliIdentity(context.cli) !== entry.identity
      || !supportsLifecycle(context.cli, entry.plan.action, true)) return Promise.resolve(denied('E_PLAN_CHANGED', entry.target));
    if (entry.pending) return entry.pending;
    if (entry.reply) return Promise.resolve({ ...entry.reply, repeated: true }); // no CLI, even if home was removed/recreated
    if (activeApply || actions.size >= 32) return Promise.resolve(denied('E_LIFECYCLE_BUSY', entry.target));
    if (!lifecycleChoicesApplicable(entry.plan, entry.choices)) return Promise.resolve(denied('E_OPTION_UNAVAILABLE', entry.target));
    const current = admitted(entry.selector, entry.plan.action, getContext, true);
    if (!same(entry, current)) return Promise.resolve(denied('E_PLAN_CHANGED', entry.target));
    // Reserve synchronously, before any awaited work. One ref = one submitted
    // intent; loss of an HTTP response cannot mint a second idempotency key.
    entry.key = mint(); entry.expires = Infinity; activeApply = entry;
    plans.delete(entry.id); actions.set(entry.id, entry);
    const args = { operation: entry.plan.action, phase: 'apply', instance: entry.target.instance, home: entry.target.home,
      context: entry.context, choices: clone(entry.choices), revision: entry.plan.planRevision, key: entry.key };
    entry.pending = Promise.resolve().then(() => invoke(entry.bin, args)).then(result => interpret(result, entry))
      .catch(() => denied('E_OUTCOME_UNKNOWN', entry.target, { status: 'unknown', planRef: entry.id }))
      .then(result => { entry.reply = clone(result); return result; })
      .finally(() => { entry.pending = null; entry.expires = now() + 30 * 60_000; if (activeApply === entry) activeApply = null; });
    return entry.pending;
  }
  return async function lifecycleRequest(request, getContext) {
    try {
      sweep();
      if (!object(request) || !['plan', 'apply'].includes(request.action)) return denied('E_BAD_ARGS');
      const context = getContext();
      if (!context.workspace || typeof context.workspace.id !== 'string') return denied('E_WORKSPACE_UNKNOWN');
      return clone(await (request.action === 'plan' ? plan(request, getContext) : apply(request, getContext, context.workspace.id)));
    } catch { return denied('E_CLI_FAILED'); }
  };
}
export const lifecycleRequest = createLifecycleBoundary();
