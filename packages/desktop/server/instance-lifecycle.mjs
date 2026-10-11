/** K3 transactions: immutable admitted plan -> one explicit confirmation intent.
 * No direct Git, kernel import, PID/tmux control or legacy mutation fallback. */
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { admitInstance, instanceSelector } from '../../client/instance-admission.mjs';
import { cliLifecycle } from '../../client/lifecycle-cli.mjs';
import { gitTargetKey } from '../../client/instance-git-contract.mjs';
import { hostReason } from '../../client/remote-address.mjs';
import { displayLine } from '../../client/display-text.mjs';
import { object, lifecycleOptions, lifecyclePlan, lifecycleReceipt, stoppedTargets, planReference, lifecycleChoicesApplicable,
  lifecycleFailure, lifecycleReason, lifecycleDetailCode, answeringFeatures, busyHolder, busyHeadline, busyAbout, undescribedAnswer } from '../../client/lifecycle-contract.mjs';
import { DESKTOP_TERMS } from '../renderer/desktop-terms.mjs';
const clone = value => structuredClone(value);
const cliIdentity = cli => JSON.stringify([cli?.bin, cli?.version, cli?.lifecycleApi,
  Array.isArray(cli?.features) ? [...cli.features].sort() : null]);
export function supportsLifecycle(cli, operation, apply = false) {
  return cli?.ok === true && cli.lifecycleApi === 1 && Array.isArray(cli.features)
    && cli.features.length <= 128 && cli.features.every(f => typeof f === 'string')
    && cli.features.includes('lifecycle-plans')
    && (!apply || operation !== 'retire' || cli.features.includes('retire-retention') && cli.features.includes('retire-home'));
}
/** The codes of an apply's error answer that Desktop reads as "refused, nothing was done to the instance",
 * for a stop and for a retire alike. Every other code is an unknown outcome. Exported so that the kernel's
 * tests can hold this list inside the kernel's own list of the codes it answers only before any effect: a
 * code joins here only once the kernel promises that of it. The promise is about the instance (its sessions,
 * its home), not about the workspace log: a guarded retire may have appended its plan's event there by then,
 * so no sentence built on this list says that nothing was recorded. A routed command's router refuses
 * E_REMOTE_INCOMPATIBLE, E_AMBIGUOUS and E_SNAPSHOT_UNKNOWN before sending, and the host's own resolution
 * refuses them (and E_HOME_MISMATCH) before any effect. */
export const BEFORE_EFFECT_CODES = Object.freeze(['E_BAD_ARGS', 'E_PLAN_STALE', 'E_INSTANCE_RETIRING', 'E_LIFECYCLE_BUSY',
  'E_HOME_MISMATCH', 'E_SESSION_UNKNOWN', 'E_AMBIGUOUS_INSTANCE', 'E_UNIDENTIFIED_INSTANCE_HOME', 'E_REMOTE_INCOMPATIBLE', 'E_AMBIGUOUS', 'E_SNAPSHOT_UNKNOWN']);
const beforeEffect = new Set(BEFORE_EFFECT_CODES);
/** The installed CLI printed this error envelope: the kernel answered. Said by the adapter where it builds
 * the envelope (`origin`), never inferred from the envelope's shape: the adapter's own failures and this
 * boundary's have the same shape, and no origin. */
const kernelAnswered = envelope => envelope?.origin === 'kernel' && envelope.schemaVersion === 1 && envelope.ok === false;
/** A failed command's reason. Remote: the host's code and message under its headline. Local: the fixed
 * sentence for `code`, and the kernel's own message beside it as `detail`, through the display filter, only
 * when the kernel answered (kernelAnswered) and the code may show one (lifecycleDetailCode: it has its own
 * sentence and is not one Desktop raises). Otherwise the reason is `{code, message}` alone.
 * A code the kernel answered that has no sentence keeps its own code and reads by the fallback sentence
 * (undescribedAnswer), with the kernel's message as its detail: "OATS couldn't be run for this." is never
 * the sentence for an answer the kernel gave. A code that did not come from the kernel never reaches it.
 * A kernel's E_LIFECYCLE_BUSY whose kernel (`features`: the answering kernel's) says who holds the claim
 * reads by that (`holder`, busyHolder), local or remote, and names the target of `plan` the refusal is
 * about when that is not the instance acted on (`about`). */
function failureReason(envelope, remote, { code = envelope?.error?.code, features = null, plan = null } = {}) {
  const kernel = kernelAnswered(envelope), undescribed = kernel ? undescribedAnswer(code, DESKTOP_TERMS) : null;
  const reason = undescribed || lifecycleReason(code, DESKTOP_TERMS), details = envelope?.error?.details;
  const holder = kernel ? busyHolder(code, details, features) : null, about = holder ? busyAbout(plan, details?.home) : null;
  const busy = holder ? { holder, ...(about ? { about } : {}) } : {};
  const message = holder ? busyHeadline(holder) : reason.message;
  if (remote) { const host = hostReason({ ...envelope?.error, code }, remote.label, message); return host ? { ...host, ...busy } : reason; }
  const detail = kernel && (undescribed || lifecycleDetailCode(code)) ? displayLine(envelope.error?.message) : null;
  return { ...reason, message, ...(detail ? { detail } : {}), ...busy };
}
export function createLifecycleBoundary({ invoke = cliLifecycle, now = () => performance.now(), mint = () => randomBytes(32).toString('hex') } = {}) {
  const plans = new Map(), actions = new Map(), reads = new Map();
  let reservedPlans = 0, activeApply = null;
  const sweep = () => { for (const map of [plans, actions]) for (const [key, value] of map) {
    if (!value.pending && value.expires <= now()) map.delete(key);
  } };
  const denied = (code, target = null, extra = {}) => lifecycleFailure(code, DESKTOP_TERMS, { target, ...extra });
  function admitted(selector, operation, getContext, apply = false) {
    const context = getContext();
    const result = admitInstance(selector, { ...context, operation: 'lifecycle-plans' });
    if (result.code) return { failure: denied(result.code, result.target, result.reason ? { reason: result.reason } : {}) };
    if (!supportsLifecycle(context.cli, operation, apply)) return { failure: denied('E_LIFECYCLE_UNAVAILABLE', result.target) };
    // Which kernel answers the command this read admits: its features decide how its answer is read.
    return { ...result, identity: cliIdentity(context.cli),
      features: answeringFeatures({ cli: context.cli, routed: !!result.remote, group: context.workspace?.group }) };
  }
  const same = (a, b) => !b.failure && a.bin === b.bin && a.context === b.context && a.identity === b.identity && gitTargetKey(a.target) === gitTargetKey(b.target);
  function storePlan(plan, selection, choices) {
    if (plans.size + reservedPlans >= 32) return null;
    const id = mint(); if (!planReference(id) || plans.has(id) || actions.has(id)) return null;
    const entry = { target: clone(selection.target), context: selection.context, scope: selection.scope, remote: selection.remote ? clone(selection.remote) : null, bin: selection.bin,
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
      const args = { operation: request.operation, phase: 'plan', instance: selected.target.instance, home: selected.target.home, context: selected.context,
        ...(selected.remote ? { server: selected.remote.server } : {}), choices };
      const pending = Promise.resolve().then(() => invoke(selected.bin, args)).catch(() => ({ ok: false, error: { code: 'E_CLI_FAILED' } })).finally(() => reads.delete(key));
      reads.set(key, pending);
    }
    reservedPlans++;
    let envelope;
    try { envelope = await reads.get(key); } finally { reservedPlans--; }
    // The CLI read can be shared, but each confirmation gets its OWN ref/key.
    const current = admitted(request.selector, request.operation, getContext);
    if (!same(selected, current)) return denied('E_PLAN_CHANGED', selected.target);
    if (envelope?.schemaVersion !== 1 || envelope.ok !== true) {
      const code = envelope?.error?.code || 'E_CLI_PROTOCOL';
      return denied(code, selected.target, { reason: failureReason(envelope, selected.remote, { code, features: selected.features }) });
    }
    const data = lifecyclePlan(envelope.result, selected.target, request.operation, choices);
    if (!data) return denied('E_CLI_PROTOCOL', selected.target);
    const entry = storePlan(data, { ...selected, scope: getContext().workspace.scope, selector: clone(request.selector) }, choices);
    return entry ? displayed(entry) : denied('E_LIFECYCLE_BUSY', selected.target);
  }
  function interpret(envelope, entry, features) {
    const extra = { planRef: entry.id, options: entry.choices };
    const failure = (code, status, more = {}) => denied(code, entry.target, { ...extra, status, ...more });
    if (envelope?.schemaVersion !== 1 || typeof envelope.ok !== 'boolean') return failure('E_OUTCOME_UNKNOWN', 'unknown');
    // A failed retire can still carry a bounded incomplete-cleanup receipt.
    if (envelope.result) {
      const receipt = lifecycleReceipt(envelope.result, entry.plan, entry.key, { server: entry.remote?.server ?? null, features });
      if (!receipt) return failure('E_OUTCOME_UNKNOWN', 'unknown', { cause: lifecycleReason('E_CLI_PROTOCOL', DESKTOP_TERMS) });
      const complete = receipt.action === 'stop' ? receipt.ok : receipt.removedDir && !receipt.incomplete;
      return { lifecycleApi: 1, status: receipt.deferred ? 'pending' : complete ? 'complete' : 'partial', target: entry.target, planRef: entry.id,
        options: entry.choices, plan: null, receipt, reason: complete ? null : lifecycleReason(receipt.action === 'stop' ? 'E_SESSION_STOP_FAILED' : 'E_RETIRE_INCOMPLETE', DESKTOP_TERMS) };
    }
    const code = envelope.error?.code;
    if (code === 'E_PLAN_STALE') {
      const fresh = lifecyclePlan(envelope.error?.details?.plan, entry.target, entry.plan.action, entry.choices);
      if (!fresh) return failure('E_OUTCOME_UNKNOWN', 'unknown', { cause: lifecycleReason('E_CLI_PROTOCOL', DESKTOP_TERMS) });
      const replacement = storePlan(fresh, entry, entry.choices);
      return replacement ? displayed(replacement, 'stale', lifecycleReason(code, DESKTOP_TERMS)) : failure(code, 'stale', { plan: fresh });
    }
    if (code === 'E_CHILDREN_RUNNING' && entry.plan.action === 'retire') {
      const fresh = lifecyclePlan(envelope.error?.details?.plan, entry.target, 'retire', entry.choices);
      const childrenStopped = fresh && stoppedTargets(envelope.error?.details?.childrenStopped, fresh.facts.children, false, { features });
      if (!childrenStopped || childrenStopped.every(c => c.ok)) return failure('E_OUTCOME_UNKNOWN', 'unknown');
      // This is the attempted plan, NOT a new executable confirmation: some
      // children have already stopped. The user must explicitly read a new plan.
      return failure(code, 'refused', { plan: fresh, childrenStopped });
    }
    if (beforeEffect.has(code)) return failure(code, 'refused', { reason: failureReason(envelope, entry.remote, { features, plan: entry.plan }) });
    return failure('E_OUTCOME_UNKNOWN', 'unknown', { cause: failureReason(envelope, entry.remote, { features }) });
  }
  function apply(request, getContext, ws) {
    if (Object.keys(request).some(k => !['action', 'planRef'].includes(k)) || !planReference(request.planRef)) return Promise.resolve(denied('E_BAD_ARGS'));
    const entry = actions.get(request.planRef) || plans.get(request.planRef);
    if (!entry) return Promise.resolve(denied('E_PLAN_EXPIRED'));
    const context = getContext();
    if (!context.workspace || context.workspace.id !== ws || ws !== entry.target.workspace || context.workspace.scope !== entry.scope
      || cliIdentity(context.cli) !== entry.identity
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
      context: entry.context, ...(entry.remote ? { server: entry.remote.server } : {}), choices: clone(entry.choices), revision: entry.plan.planRevision, key: entry.key };
    entry.pending = Promise.resolve().then(() => invoke(entry.bin, args)).then(result => interpret(result, entry, current.features))
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
