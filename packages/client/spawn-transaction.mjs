/** The spawn transaction, the client's half (#855, 6b-2): prepare, apply only the decision the operator confirmed,
 * follow a `pending` apply, check an unknown outcome and recover a reference after a reload, on the /api/spawn
 * contract (spawn-apply-contract.mjs). Each answer is classified into an outcome; what a client shows for it,
 * and where it keeps the job, stay the client's own. No notifications, rows, storage, DOM or timers beyond `sleep`,
 * and no module-level state: each client makes its own transaction.
 *
 * `createSpawnTransaction({ request, now, sleep, pollMs })`:
 *   request(body, job)  the client's boundary: answers the raw reply to `body` for the job's `address` (the
 *                       Desktop posts it to /api/spawn?ws=<address>); throws on transport failure
 *   now()               the clock the deadline is read on (Date.now)
 *   sleep(ms)           the wait between two `result` reads while the apply is pending
 *   pollMs              that wait (RECOVER_POLL_MS)
 * answers `{ submit, check, recover }`. Each takes `{ alive, progress }` for its own call and resolves an outcome
 * `{ kind, view, reason, job }`, or null once `alive()` answers false (the client's owner went away: nothing is
 * reported). `progress(event, job)` hears 'submitted' after a prepare whose decision is the confirmed one, before
 * the apply is requested (`spawnRef` and `deadline` set), and 'pending' on each pending answer it goes on following.
 *
 *   submit({ address, selector, input, decision })  prepares `input` (the prepare body), applies the prepared
 *       reference when its decision is `decision` (spawn-decision.mjs `sameSpawnDecision`), and follows it
 *   check(job)    reads `result`; an `unknown` result re-applies the same reference, never a new one
 *   recover(job)  reads `result` for a reference kept across a reload ({ address, selector, spawnRef, deadline? }):
 *                 one that was submitted, which it records
 *
 * `job` is the transaction's record of the intent, { address, selector, spawnRef, deadline, submitted, prepared },
 * the object `submit` made (or the one a client passes to check and recover); a client stores it as it likes.
 * The deadline is the broker's CLI deadline (`applyWithinMs`, else SPAWN_APPLY_MS) plus FOLLOW_MARGIN_MS from the
 * press, an absolute time; a recovered job without one follows RECOVER_WITHIN_MS from now.
 *
 * `kind`, in the order an answer is classified:
 *   created          complete, partial or incomplete (`view.status` says which); `reason` the view's
 *   pending-expired  still pending past the deadline; `reason` null
 *   cleanup-owed     unknown with a rolled-back code (ROLLED_BACK_CODES); `reason` the view's
 *   unknown          an unknown answer, a failure after the apply was requested, or E_INTENT_EXPIRED once
 *                    submitted (the record is gone: proof of nothing); `reason` E_OUTCOME_UNKNOWN's, or the
 *                    E_INTENT_EXPIRED reason itself; `view` null after a failure
 *   rolled-back      refused with a rolled-back code; `reason` the view's
 *   never-submitted  the reference was prepared and never applied; `reason` the view's
 *   drifted          the prepared decision is not the confirmed one (`view` the prepared one, `reason` null), or
 *                    E_DECISION_STALE (`reason` it)
 *   refused          everything else: a prepare that did not prepare, a refusal, or a failure before the apply
 *                    was requested (`reason` spawnApplyReason(code), `view` null). Nothing was submitted or the
 *                    kernel says so. */
import { spawnApplyView, spawnApplyReason, SPAWN_APPLY_MS, ROLLED_BACK_CODES } from './spawn-apply-contract.mjs';
import { sameSpawnDecision } from './spawn-decision.mjs';

/** A pending apply reads `result` this often, until the job's deadline. */
export const RECOVER_POLL_MS = 2000;
/** A job's deadline is the broker's CLI deadline (applyWithinMs) plus this margin, from the press. */
export const FOLLOW_MARGIN_MS = 30000;
/** The CLI deadline of a spawn without `worktree` hooks, plus the margin: what a recovered job without a deadline follows. */
export const RECOVER_WITHIN_MS = SPAWN_APPLY_MS + FOLLOW_MARGIN_MS;

export function createSpawnTransaction({ request, now = () => Date.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), pollMs = RECOVER_POLL_MS } = {}) {
  if (typeof request !== 'function') throw new TypeError('createSpawnTransaction: request must be a function');
  const outcome = (kind, view, reason, job) => ({ kind, view, reason, job });
  const calls = ({ alive = () => true, progress = () => {} } = {}) => ({ alive, progress });

  /** One reply, projected; null once the owner went away. A reply without a view, or whose decision is not
   * the prepared one, is a protocol failure. */
  async function ask(job, body, { alive }) {
    const raw = await request(body, job);
    if (!alive()) return null;
    const view = spawnApplyView(raw, { workspace: job.address, ref: body.spawnRef, selector: job.selector });
    if (!view || view.preview && job.prepared && body.action !== 'prepare' && !sameSpawnDecision(view.preview.decision, job.prepared.preview.decision)) throw Object.assign(Error(), { code: 'E_CLI_PROTOCOL' });
    return view;
  }
  /** An answer after the apply was requested, read as data (a pending one is followed). */
  function classify(job, view, call) {
    if (['complete', 'partial', 'incomplete'].includes(view.status)) return outcome('created', view, view.reason ?? null, job);
    if (view.status === 'pending') return follow(job, view, call);
    if (view.status === 'unknown' && ROLLED_BACK_CODES.includes(view.reason?.code)) return outcome('cleanup-owed', view, view.reason, job);
    if (view.status === 'unknown') return outcome('unknown', view, spawnApplyReason('E_OUTCOME_UNKNOWN'), job);
    if (view.status === 'refused' && ROLLED_BACK_CODES.includes(view.reason?.code)) return outcome('rolled-back', view, view.reason, job);
    if (view.status === 'prepared') return outcome('never-submitted', view, view.reason ?? null, job);
    if (view.reason?.code === 'E_INTENT_EXPIRED' && job.submitted) return outcome('unknown', view, view.reason, job);
    if (view.reason?.code === 'E_DECISION_STALE') return outcome('drifted', view, view.reason, job);
    return outcome('refused', view, view.reason ?? null, job);
  }
  /** Still running in the broker: read `result` every pollMs until it settles or the deadline passes. */
  async function follow(job, view, call) {
    for (;;) {
      if (now() >= job.deadline) return outcome('pending-expired', view, null, job);
      call.progress('pending', job);
      await sleep(pollMs);
      if (!call.alive()) return null;
      view = await ask(job, { action: 'result', spawnRef: job.spawnRef }, call);
      if (!view) return null;
      if (view.status !== 'pending') return classify(job, view, call);
    }
  }
  /** After the apply was requested a failure proves nothing: the outcome is unknown. */
  const failed = (job, call) => call.alive() ? outcome('unknown', null, spawnApplyReason('E_OUTCOME_UNKNOWN'), job) : null;
  const referenced = (job, name) => { if (!job || typeof job.spawnRef !== 'string' || !job.spawnRef) throw new TypeError(`${name}: job.spawnRef is required`); };

  return {
    async submit(intent, options) {
      const call = calls(options);
      const job = { address: intent.address, selector: intent.selector, spawnRef: null, deadline: null, submitted: false, prepared: null };
      try {
        const prepared = await ask(job, intent.input, call);
        if (!prepared) return null;
        if (prepared.status !== 'prepared') return outcome('refused', prepared, prepared.reason ?? null, job);
        // Apply only the decision the operator saw; the kernel's --expect-decision guards it again at apply.
        if (!sameSpawnDecision(prepared.preview.decision, intent.decision)) return outcome('drifted', prepared, null, job);
        job.prepared = prepared; job.spawnRef = prepared.spawnRef; job.submitted = true;
        job.deadline = now() + (prepared.applyWithinMs ?? SPAWN_APPLY_MS) + FOLLOW_MARGIN_MS;
        call.progress('submitted', job);
        const view = await ask(job, { action: 'apply', spawnRef: job.spawnRef }, call);
        return view ? await classify(job, view, call) : null;
      } catch (error) {
        if (!call.alive()) return null;
        return job.submitted ? failed(job, call) : outcome('refused', null, spawnApplyReason(error?.code), job);
      }
    },
    async check(job, options) {
      referenced(job, 'check');
      const call = calls(options);
      try {
        let view = await ask(job, { action: 'result', spawnRef: job.spawnRef }, call);
        if (!view) return null;
        if (view.status === 'unknown') { view = await ask(job, { action: 'apply', spawnRef: job.spawnRef }, call); if (!view) return null; }
        return await classify(job, view, call);
      } catch { return failed(job, call); }
    },
    async recover(job, options) {
      referenced(job, 'recover');
      const call = calls(options);
      job.submitted = true;
      if (!Number.isFinite(job.deadline)) job.deadline = now() + RECOVER_WITHIN_MS;
      try {
        const view = await ask(job, { action: 'result', spawnRef: job.spawnRef }, call);
        return view ? await classify(job, view, call) : null;
      } catch { return failed(job, call); }
    },
  };
}
