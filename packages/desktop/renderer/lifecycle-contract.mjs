/** K3 projection/validation only. No IO, kernel decisions or executable paths. */
import { gitRevision } from './instance-git-contract.mjs';
export const LIFECYCLE_API = 1;
export const MAX_LIFECYCLE_TARGETS = 128;
export const object = v => !!v && typeof v === 'object' && !Array.isArray(v);
export const text = (v, max = 4096) => typeof v === 'string' && v.length <= max && !v.includes('\0')
  && !/(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{16,}|https?:\/\/[^/\s]+@/.test(v);
const nullable = v => v === null || text(v);
const absolute = v => text(v) && v.startsWith('/');
const count = v => Number.isSafeInteger(v) && v >= 0;
const numberOrNull = v => v === null || count(v);
export const planRevision = v => typeof v === 'string' && /^[a-f0-9]{24}$/.test(v);
export const planReference = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const at = v => typeof v === 'string' && Number.isFinite(Date.parse(v));
const strings = v => Array.isArray(v) && v.length <= 64 && v.every(n => text(n));
const messages = {
  E_BAD_ARGS: 'Invalid lifecycle request.', E_WORKSPACE_UNKNOWN: 'Choose an advertised workspace.',
  E_SESSION_UNKNOWN: 'This instance is no longer in the current roster.', E_AMBIGUOUS_INSTANCE: 'Select an exact instance home.',
  E_HOME_MISMATCH: 'The instance home no longer matches this selection.',
  'cli-unavailable': 'Choose a compatible installed OATS CLI.',
  E_LIFECYCLE_UNAVAILABLE: "This OATS can't stop or retire instances from Desktop. Update OATS.",
  'unsupported-remote-operation': "This computer's OATS can't route this to the server. Update OATS here.",
  E_PLAN_REQUIRED: 'Open a fresh Stop or Retire confirmation; unguarded retirement is unavailable.',
  E_PLAN_EXPIRED: 'This confirmation expired. Review again to check the current state.',
  E_PLAN_CHANGED: 'The instance or OATS changed. Review again before confirming.',
  E_OPTION_UNAVAILABLE: 'Only an instance with its own worktree can delete it. Review the choice again.',
  E_PLAN_STALE: 'Something changed since you opened this. Review it and confirm again.',
  E_PLAN_LIMIT: 'This would act on more instances than Desktop can show. Nothing was submitted.',
  E_LIFECYCLE_BUSY: 'Another stop or retire is already running. Wait for it to finish, then review again.',
  E_INSTANCE_RETIRING: 'An instance in this plan is already being retired.',
  E_CHILDREN_RUNNING: "A child instance wouldn't stop, so nothing was retired. Other children may already have stopped.",
  E_SESSION_STOP_FAILED: "The session didn't stop in time. Nothing was forced.",
  E_WORK_PRESERVATION_FAILED: "Its work couldn't be saved safely, so the home folder is kept. Earlier retirement steps may have run.",
  E_WORK_INSPECTION_FAILED: "Retirement was refused: OATS couldn't inspect the instance's home or work. The home folder is kept; its session may already have been stopped, and earlier retirement steps may have run.",
  E_RETIRE_INCOMPLETE: "Retirement didn't finish cleaning up. Check what was kept before trying again.",
  E_CLI_TIMEOUT: "OATS didn't answer in time.", E_CLI_OUTPUT_LIMIT: "OATS's answer was larger than Desktop reads safely.",
  E_CLI_PROTOCOL: "OATS answered in a form Desktop can't read.", E_CLI_FAILED: "OATS couldn't be run for this.",
  E_OUTCOME_UNKNOWN: "OATS didn't confirm the result. Check again before assuming nothing happened.",
  E_FORBIDDEN_FRAME: 'This window cannot request a lifecycle operation.',
};
export const lifecycleReason = code => ({ code: Object.hasOwn(messages, code) ? code : 'E_CLI_FAILED', message: messages[code] || messages.E_CLI_FAILED });
/** Codes only Desktop raises (its CLI adapter, its lifecycle boundary, main): the kernel never answers with
 * one. A new entry of `messages` that the kernel does not raise is listed here too. */
const desktopCodes = new Set(['E_WORKSPACE_UNKNOWN', 'cli-unavailable', 'E_LIFECYCLE_UNAVAILABLE', 'unsupported-remote-operation',
  'E_PLAN_REQUIRED', 'E_PLAN_EXPIRED', 'E_PLAN_CHANGED', 'E_OPTION_UNAVAILABLE', 'E_PLAN_LIMIT',
  'E_CLI_TIMEOUT', 'E_CLI_OUTPUT_LIMIT', 'E_CLI_PROTOCOL', 'E_CLI_FAILED', 'E_OUTCOME_UNKNOWN', 'E_FORBIDDEN_FRAME']);
/** A code whose local failure may show the CLI's own message as a detail beside the fixed sentence: the
 * code has its own sentence and the kernel raises it. Never one of Desktop's own, whatever came with it;
 * a code without a sentence shows no CLI text either. */
export const lifecycleDetailCode = code => Object.hasOwn(messages, code) && !desktopCodes.has(code);
export function lifecycleFailure(code, extra = {}) {
  return { lifecycleApi: LIFECYCLE_API, status: 'unavailable', target: null, planRef: null, plan: null, receipt: null,
    reason: lifecycleReason(code), ...extra };
}
export function lifecycleOptions(operation, v) {
  if (!object(v)) return null;
  if (operation === 'stop' && Object.keys(v).length === 1 && Object.hasOwn(v, 'recursive') && typeof v.recursive === 'boolean') return { recursive: v.recursive };
  // Retire has one choice, the worktree. It never deletes a branch: any other key is refused.
  if (operation === 'retire' && Object.keys(v).length === 1 && Object.hasOwn(v, 'discardWorktree')
    && typeof v.discardWorktree === 'boolean') return { discardWorktree: v.discardWorktree };
  return null;
}
export function lifecycleChoicesApplicable(plan, choices) {
  if (plan.action === 'stop') return true;
  return !choices.discardWorktree || plan.facts.workMode === 'worktree';
}
export function lifecycleSession(v) {
  if (!object(v) || !text(v.state, 128) || !v.state || typeof v.established !== 'boolean' || ![null, true, false].includes(v.present)
    || !nullable(v.backend) || (!v.established && (v.state !== 'unestablished' || v.present !== null))
    || (v.established && (v.present === null || v.state === 'unestablished'))) return null;
  return { state: v.state, established: v.established, present: v.present, backend: v.backend,
    ...(!v.established ? { reason: text(v.reason, 256) ? v.reason : 'unavailable' } : {}) };
}
export function lifecycleWork(v) {
  if (!object(v) || typeof v.observed !== 'boolean') return null;
  if (!v.observed) return text(v.reason, 256) ? { observed: false, reason: v.reason } : null;
  if (!gitRevision(v.revision) || !nullable(v.branch) || typeof v.detached !== 'boolean' || typeof v.drift !== 'boolean'
    || (v.detached && v.branch !== null) || !count(v.changed) || !count(v.untracked)) return null;
  for (const c of [v.upstream, v.base]) if (!object(c) || !nullable(c.ref) || !numberOrNull(c.ahead) || !numberOrNull(c.behind)
    || (c.ref === null && (c.ahead !== null || c.behind !== null))) return null;
  if (v.remote !== null && (!object(v.remote) || !nullable(v.remote.host) || !nullable(v.remote.path))) return null;
  return { observed: true, revision: v.revision, branch: v.branch, detached: v.detached, drift: v.drift,
    changed: v.changed, untracked: v.untracked,
    upstream: { ref: v.upstream.ref, ahead: v.upstream.ahead, behind: v.upstream.behind },
    base: { ref: v.base.ref, ahead: v.base.ahead, behind: v.base.behind },
    remote: v.remote === null ? null : { host: v.remote.host, path: v.remote.path } };
}
function identity(v) {
  return object(v) && text(v.instance, 255) && !!v.instance && text(v.agent, 255) && !!v.agent && absolute(v.home)
    && v.home.split('/').at(-1) === v.instance ? { instance: v.instance, agent: v.agent, home: v.home } : null;
}
function rows(value, project) {
  if (!Array.isArray(value) || value.length > MAX_LIFECYCLE_TARGETS) return null;
  const result = value.map(project);
  return result.some(v => !v) || new Set(result.map(v => v.home)).size !== result.length ? null : result;
}
const excluded = v => { const i = identity(v); return i && text(v.reason) ? { ...i, reason: v.reason } : null; };
export function lifecyclePlan(v, target, operation, options) {
  if (!object(v) || v.lifecycleApi !== 1 || v.action !== operation || v.instance !== target.instance || v.home !== target.home
    || !planRevision(v.planRevision) || !at(v.at) || !strings(v.notes)) return null;
  const common = { lifecycleApi: 1, action: operation, instance: v.instance, home: v.home, planRevision: v.planRevision, at: v.at, notes: [...v.notes] };
  if (operation === 'stop') {
    if (v.recursive !== options.recursive) return null;
    const targets = rows(v.targets, t => {
      const i = identity(t), session = lifecycleSession(t?.session), work = lifecycleWork(t?.work);
      return i && session && work && count(t.depth) && nullable(t.workMode) && typeof t.launched === 'boolean'
        && typeof t.retiring === 'boolean' && typeof t.stopPending === 'boolean' && [true, false, 'unknown'].includes(t.midTask)
        ? { ...i, depth: t.depth, workMode: t.workMode, launched: t.launched, session, work, retiring: t.retiring, stopPending: t.stopPending, midTask: t.midTask } : null;
    });
    const skipped = rows(v.skipped, excluded), ambiguous = rows(v.ambiguous, excluded);
    if (!targets?.length || !skipped || !ambiguous || targets.length + skipped.length + ambiguous.length > MAX_LIFECYCLE_TARGETS
      || targets.at(-1).home !== target.home || targets.at(-1).agent !== target.agent || targets.at(-1).depth !== 0
      || targets.slice(0, -1).some(t => !t.depth) || (!options.recursive && targets.length !== 1)
      || (options.recursive && skipped.length) || [...skipped, ...ambiguous].some(t => targets.some(x => x.home === t.home))) return null;
    return { ...common, recursive: v.recursive, targets, skipped, ambiguous };
  }
  const f = v.facts, d = v.defaults;
  if (!object(f) || !object(d) || !nullable(f.workMode) || !(f.repo === null || absolute(f.repo)) || !nullable(f.recordedBranch) || f.pullRequest !== 'unknown'
    || typeof d.retainWorktree !== 'boolean' || !(d.deleteBranch === undefined || d.deleteBranch === false) || d.stopChildren !== true || d.retainChildren !== true) return null;
  const session = lifecycleSession(f.session), work = lifecycleWork(f.work);
  const children = rows(f.children, t => { const i = identity(t), s = lifecycleSession(t?.session); return i && s ? { ...i, session: s } : null; });
  const ambiguous = rows(f.ambiguous, excluded);
  if (!session || !work || !children || !ambiguous || children.length + ambiguous.length + 1 > MAX_LIFECYCLE_TARGETS
    || [...children, ...ambiguous].some(t => t.home === target.home) || ambiguous.some(t => children.some(c => c.home === t.home))) return null;
  return { ...common, facts: { session, work, workMode: f.workMode, repo: f.repo, recordedBranch: f.recordedBranch,
    children, ambiguous, pullRequest: 'unknown' }, defaults: { retainWorktree: d.retainWorktree, stopChildren: true, retainChildren: true } };
}
export function stoppedTargets(value, expected, withState = false) {
  if (!Array.isArray(value) || value.length !== expected.length || value.length > MAX_LIFECYCLE_TARGETS) return null;
  const result = value.map((v, index) => {
    if (!object(v) || v.home !== expected[index].home || v.instance !== expected[index].instance || typeof v.ok !== 'boolean') return null;
    if (v.ok) return typeof v.stopped === 'boolean' && typeof v.alreadyIdle === 'boolean' && (!withState || text(v.state, 128))
      ? { instance: v.instance, home: v.home, ok: true, stopped: v.stopped, alreadyIdle: v.alreadyIdle, ...(withState ? { state: v.state } : {}) } : null;
    if (v.stillRunning !== null && (!Array.isArray(v.stillRunning) || v.stillRunning.length > 128 || v.stillRunning.some(p => !Number.isSafeInteger(p) || p <= 0))) return null;
    return { instance: v.instance, home: v.home, ok: false, code: lifecycleReason(v.code).code, stillRunning: v.stillRunning === null ? null : [...v.stillRunning] };
  });
  return result.some(v => !v) ? null : result;
}
/** `server`: the request was routed there. The routed retire's result then may also carry `server`
 * and `target` (its route); a local result carrying them is refused.
 * Desktop asks for no branch deletion, so a retire result that reports one, or a skipped one, is not the
 * answer to its request and is refused whole, a deferred one too: nothing of it is projected. */
export function lifecycleReceipt(v, plan, key, { server = null } = {}) {
  if (!object(v) || v.idempotencyKey !== key || v.planRevision !== plan.planRevision || typeof v.replayed !== 'boolean') return null;
  if (!server ? Object.hasOwn(v, 'server') || Object.hasOwn(v, 'target')
    : plan.action !== 'retire' && (Object.hasOwn(v, 'server') || Object.hasOwn(v, 'target'))
      || Object.hasOwn(v, 'server') && v.server !== server || Object.hasOwn(v, 'target') && !object(v.target)) return null;
  if (plan.action === 'stop') {
    const results = stoppedTargets(v.results, plan.targets, true);
    if (v.lifecycleApi !== 1 || v.action !== 'stop' || v.instance !== plan.instance || v.home !== plan.home || !at(v.at)
      || !results || v.ok !== results.every(r => r.ok) || !Array.isArray(v.retained)
      || JSON.stringify(v.retained) !== JSON.stringify(['home', 'work', 'transcript', 'launch'])) return null;
    return { action: 'stop', instance: v.instance, home: v.home, planRevision: v.planRevision, replayed: v.replayed, at: v.at,
      ok: v.ok, results, retained: [...v.retained] };
  }
  if (!(v.branchDeleted === undefined || v.branchDeleted === false)
    || object(v.retention) && (Object.hasOwn(v.retention, 'branchDeleted') || Object.hasOwn(v.retention, 'branchDeletionSkipped'))) return null;
  if (v.retired === plan.instance && v.deferred === true) return { action: 'retire', instance: plan.instance, home: plan.home,
    planRevision: v.planRevision, replayed: v.replayed, deferred: true };
  if (v.retired !== plan.instance || typeof v.removedDir !== 'boolean' || typeof v.worktreeRemoved !== 'boolean'
    || (v.rollbackIncomplete !== undefined && !strings(v.rollbackIncomplete)) || !(v.retainedHome === undefined || v.retainedHome === plan.home)) return null;
  const childrenStopped = stoppedTargets(v.childrenStopped, plan.facts.children);
  if (!childrenStopped || childrenStopped.some(c => !c.ok)) return null;
  let retention = null;
  if (v.retention !== null) {
    const r = v.retention;
    if (!object(r) || !['retained', 'removed', 'absent'].includes(r.worktree) || !nullable(r.branch) || !nullable(r.recordedBranch)
      || (r.worktree === 'retained' && (!absolute(r.movedTo) || !nullable(r.detachedAt)))) return null;
    retention = { worktree: r.worktree, branch: r.branch, recordedBranch: r.recordedBranch,
      ...(r.worktree === 'retained' ? { movedTo: r.movedTo, detachedAt: r.detachedAt } : {}) };
  }
  const recovery = v.workRecovery?.path;
  return { action: 'retire', instance: plan.instance, home: plan.home, planRevision: v.planRevision, replayed: v.replayed,
    removedDir: v.removedDir, worktreeRemoved: v.worktreeRemoved, retention, childrenStopped,
    incomplete: !!v.rollbackIncomplete?.length, retainedHome: v.retainedHome ?? null,
    recoveryPath: absolute(recovery) ? recovery : null };
}
/** Validate the public projection without exposing the server's private key. */
export function publicLifecycleReceipt(v, plan) {
  if (!object(v) || v.action !== plan.action || v.instance !== plan.instance || v.home !== plan.home) return null;
  if (v.action === 'stop') return lifecycleReceipt({ ...v, lifecycleApi: 1, idempotencyKey: 'public' }, plan, 'public');
  if (v.deferred !== true && (typeof v.incomplete !== 'boolean' || !(v.retainedHome === null || v.retainedHome === plan.home)
    || !(v.recoveryPath === null || absolute(v.recoveryPath)))) return null;
  return lifecycleReceipt({ ...v, retired: v.instance, idempotencyKey: 'public',
    retainedHome: v.retainedHome || undefined, rollbackIncomplete: v.incomplete ? ['reported incomplete cleanup'] : undefined,
    workRecovery: v.recoveryPath ? { path: v.recoveryPath } : undefined }, plan, 'public');
}
