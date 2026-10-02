/** Background spawns (Spec C): the spawn dialog closes on a confirmed press and hands its
 * transaction here. The store outlives the dialog: it runs the existing confirmed transaction
 * (prepare → the decision on screen → apply, and `result` for recovery) on the /api/spawn contract,
 * owns the roster's pending rows and the outcome notifications, and keeps the operator's draft
 * until the spawn completes or its failure is dismissed (Reopen spawn restores it).
 *
 * Truthfulness (the async-intent lesson): creation, roster presence and a live terminal are separate
 * observations. A pending row says "Spawning…" until the roster reports the instance; "complete"
 * is reported (the shell follows it there, or marks its row New; no toast) only once the roster shows
 * it running with a session; nothing is inferred
 * from a name or a missing answer, and an unknown outcome stays pending with Check result.
 *
 * Ownership: each job is its own intent. Every completion checks the store is alive and the job is
 * still the one in the store; outcomes belong to the job's workspace and are held while another
 * workspace is on screen, then posted on return. Pending rows are Desktop-local.
 *
 * Reload (Spec D, #383): with a `storage` (the shell passes sessionStorage), every submitted job is kept
 * as { workspace, deployment, spawnRef, soul, selector, instance, home, placement, startedAt } until its outcome has
 * been reported: in flight, unknown, failed (until dismissed or reopened), or settled with a notice still
 * held for its workspace. Never its opening instruction or a key (the renderer never holds the idempotency
 * key; spawnRef is the server's opaque handle, kept 30 min after it settles). After a window reload,
 * recover() brings each back as a pending row and reads the existing `result` action, so settling and
 * reporting stay separate events across a reload.
 *
 * Deployments (#482): a job is OWNED by its workspace view (`workspace`: is that view on screen, where
 * its pending row and notices belong) and ADDRESSED to the deployment it spawns in (`deployment`: every
 * /api/spawn request and the reply it checks). Without a deployment the view id addresses it, as before.
 * A created spawn records its deployment as the view's last used (the spawn dialog's default).
 * `rehome(map)` moves owners onto views (workspace-rehome.mjs); a job's address never changes. */
import { spawnApplyView, spawnApplyReason } from './spawn-apply-contract.mjs';
import { sameSpawnDecision } from './spawn-decision.mjs';
import { spawnProblem } from './spawn-messages.mjs';
import { rememberSpawnDeployment } from './spawn-deployment-field.mjs';

/** How long a created instance may take to appear in the roster before the row goes and the
 * notification says so (the dialog's former wait: 20 reads 700 ms apart). */
export const SPAWN_VISIBLE_WITHIN_MS = 14000;
export const DRIFT_TEXT = 'These values changed since you last looked. Reopen spawn to check them.';
export const SPAWN_STORAGE_KEY = 'oats.spawnJobs.v1';
/** A recovered job reads `result` this often while the server says pending, for up to the apply deadline. */
export const RECOVER_POLL_MS = 2000;
export const RECOVER_WITHIN_MS = 65000;
const PENDING_TEXT = 'The spawn is still running. Check result again in a moment; nothing else was started.';
const FLIGHT = ['spawning', 'checking'];

/** Where the roster will place the real row: the relation the kernel records (instance-tree.mjs
 * `instanceLinks` reads parentInstance / siblingInstance). A child's parent is its anchor; a
 * sibling shares its anchor's parent, or links to a root anchor; a parent-of spawn joins its
 * anchor's cluster (the anchor's own lineage is the kernel's to rewrite, never guessed here). */
export function pendingPlacement(relation, instances = []) {
  const anchor = relation?.anchor;
  if (!anchor || relation.kind === 'unrelated') return {};
  if (relation.kind === 'child') return { parentInstance: anchor.instance };
  if (relation.kind === 'sibling') {
    const row = instances.find(i => i.instance === anchor.instance && i.agentsRoot === anchor.agentsRoot && !i.server);
    return row?.parentInstance ? { parentInstance: row.parentInstance } : { siblingInstance: anchor.instance };
  }
  return { siblingInstance: anchor.instance };
}

/**
 * @param post(deployment, body)  POST /api/spawn?ws=<deployment> → the raw reply (throws on transport failure)
 * @param notify(message, options)  the notification center's notify → a handle { dismiss(), shown } | false
 * @param notifySpawned(row, workspace, epoch, { id, complete })  the created instance is running in the roster: the shell
 *   takes the operator to it or marks its row New, and announces it (Spec E; spawn-follow.mjs). complete false: a
 *   launched partial spawn, whose own notice already spoke, is only followed
 * @param reopen(job)  open the spawn dialog for job.soul with job.draft restored
 * @param viewSchedules()  the existing "View schedules" destination
 * @param onChange()  the roster repaints its pending rows
 * @param rememberDeployment(view, deployment)  a created spawn's deployment becomes the view's last used
 */
export function createSpawnJobs({ post, notify, notifySpawned = () => {}, reopen = () => {}, viewSchedules = () => {},
  currentWorkspace = () => '', connection = () => 0, onChange = () => {}, now = () => Date.now(), visibleWithinMs = SPAWN_VISIBLE_WITHIN_MS,
  storage = null, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), pollMs = RECOVER_POLL_MS, recoverWithinMs = RECOVER_WITHIN_MS,
  rememberDeployment = rememberSpawnDeployment } = {}) {
  let alive = true, serial = 0;
  const jobs = new Map(), tokens = new WeakSet(), listeners = new Set();
  // Spec E: rows of a complete spawn the operator was not taken to, which say New until first opened
  // (by workspace and home: the identity a roster row keeps). Desktop-local, never stored.
  const fresh = new Set();
  const freshKey = (workspace, row) => JSON.stringify([workspace, row?.server || null, row?.home ?? null]);
  const sameSoul = (job, workspace, soul) => job.workspace === workspace && job.soul?.name === soul?.name && job.soul?.agentsRoot === soul?.agentsRoot;
  const flightOf = (workspace, soul) => [...jobs.values()].find(j => FLIGHT.includes(j.state) && sameSoul(j, workspace, soul)) || null;
  /** Submitted jobs whose outcome has not been reported survive a window reload (never the task text):
   * a failure until it is dismissed or reopened, any other outcome until its notice is posted. */
  const unreported = j => ['spawning', 'checking', 'unknown', 'failed'].includes(j.state) || !j.notice?.posted;
  function save() {
    if (!alive || !storage) return;
    const kept = [...jobs.values()].filter(j => j.spawnRef && unreported(j))
      .map(j => ({ workspace: j.workspace, deployment: j.deployment, spawnRef: j.spawnRef, soul: j.soul, selector: j.selector, instance: j.instance, home: j.home, placement: j.placement, startedAt: j.startedAt }));
    try { if (kept.length) storage.setItem(SPAWN_STORAGE_KEY, JSON.stringify(kept)); else storage.removeItem(SPAWN_STORAGE_KEY); } catch { /* storage is a convenience */ }
  }
  const changed = () => {
    if (!alive) return;
    save();
    try { onChange(); } catch { /* a repaint must not break a spawn */ }
    for (const fn of [...listeners]) { try { fn(); } catch { /* one listener must not break another */ } }
  };
  const live = job => alive && jobs.get(job.id) === job;
  const forget = job => { if (jobs.get(job.id) === job) { jobs.delete(job.id); changed(); } };

  // ── notifications, held per workspace
  function deliver(job) {
    if (!live(job) || currentWorkspace() !== job.workspace) return; // held until its workspace is on screen
    // Spec E: a launched partial spawn is followed to its instance too, with no second notice (its own
    // notice already said what went wrong with its wake schedule).
    if (job.arrived) {
      const row = job.arrived; job.arrived = null;
      notifySpawned(row, job.workspace, connection(), { id: job.id, complete: false });
      if (!live(job)) return;
      if (!job.notice || job.notice.posted) { forget(job); return; }
    }
    const n = job.notice;
    if (!n) return;
    if (n.sticky) { if (!n.handle?.shown) n.handle = notify(n.message, n.options) || null; return; }
    if (n.posted) return;
    n.posted = true;
    if (n.spawned) notifySpawned(n.spawned, job.workspace, connection(), { id: job.id, complete: true }); else notify(n.message, n.options);
    if (job.state === 'done') forget(job); else save();
  }
  function say(job, message, options = {}, sticky = false) { job.notice = { message, options, sticky, posted: false, handle: null }; deliver(job); }
  const details = problem => problem?.detail ? { detail: problem.detail } : {};

  /** Refused, failed or drifted: nothing was created. The row goes; the draft stays for Reopen. */
  function refuse(job, message, problem = null) {
    job.state = 'failed'; changed();
    say(job, message, { ...details(problem), sticky: true, group: 'spawn-failed', groupLabel: n => `${n} spawns failed`,
      buttons: [{ label: 'Reopen spawn', ariaLabel: `Reopen spawn for ${job.instance}`, activate: async () => {
        if (!live(job)) return;
        job.notice.handle?.dismiss?.(); forget(job); reopen(job);
      } }],
      onDismiss: () => forget(job) }, true);
  }
  /** The outcome is not known: the row stays pending ("Outcome unknown") with Check result. */
  function unknown(job, reason = spawnApplyReason('E_OUTCOME_UNKNOWN'), message = null) {
    job.state = 'unknown'; changed();
    const problem = spawnProblem(reason, 'spawn');
    say(job, message || problem.text, details(problem));
  }
  /** Created (complete, partial or incomplete): the row stays "Spawning…" until the roster reports it. */
  function created(job, view) {
    job.state = 'created'; job.receipt = view.receipt || null; job.createdAt = now();
    if (job.deployment !== job.workspace) { try { rememberDeployment(job.workspace, job.deployment); } catch { /* a convenience */ } }
    if (view.status === 'partial') {
      // Created; only its wake schedule failed. A launched one is still awaited running, to be followed to (Spec E).
      job.wantRunning = view.receipt?.launched === true; job.quiet = true;
      say(job, view.reason?.message || `Created ${job.instance}.`, { buttons: [{ label: 'View schedules', ariaLabel: `View schedules for ${job.instance}`, activate: async () => viewSchedules() }] });
    } else if (view.status === 'incomplete') {
      job.wantRunning = false;
      const problem = spawnProblem(view.reason, 'spawn');
      say(job, `${view.incomplete.instance} was created but didn’t finish starting. Open it from the instance list instead of spawning again.`, details(problem));
    } else if (!view.receipt.launched) {
      job.wantRunning = false;
      say(job, `Created ${job.instance} — not launched. Open its session from the roster.`);
    } else job.wantRunning = true; // "<name> spawned" waits for the roster to show it running with a session
    changed();
  }
  /** A refusal before anything was applied, or one the kernel reports: the kernel's reason, and that nothing was created. */
  function refuseWith(job, problem) { refuse(job, /Nothing was created/.test(problem.text) ? problem.text : `${problem.text} Nothing was created.`, problem); }
  function settle(job, view) {
    if (['complete', 'partial', 'incomplete'].includes(view.status)) return created(job, view);
    if (view.status === 'pending') return unknown(job, null, 'The spawn is still running. Check result again in a moment; nothing else was started.');
    if (view.status === 'unknown') return unknown(job);
    if (view.status === 'prepared') return refuse(job, 'That spawn was never submitted. Reopen spawn to spawn with these values.');
    // E_INTENT_EXPIRED: the record is gone (a backend restart): not proof of anything — stay unknown.
    if (view.reason?.code === 'E_INTENT_EXPIRED' && job.submitted) return unknown(job, view.reason);
    if (view.reason?.code === 'E_DECISION_STALE') return refuse(job, DRIFT_TEXT, spawnProblem(view.reason, 'spawn'));
    refuseWith(job, spawnProblem(view.reason, 'spawn'));
  }

  // ── the transaction (the dialog's former run(), unchanged in substance)
  async function request(job, body) {
    const raw = await post(job.deployment, body);
    if (!live(job)) return null;
    const view = spawnApplyView(raw, { workspace: job.deployment, ref: body.spawnRef, selector: job.selector });
    if (!view || view.preview && job.prepared && body.action !== 'prepare' && !sameSpawnDecision(view.preview.decision, job.prepared.preview.decision)) throw Object.assign(Error(), { code: 'E_CLI_PROTOCOL' });
    return view;
  }
  async function run(job) {
    try {
      const prepared = await request(job, job.input);
      if (!prepared) return;
      if (prepared.status !== 'prepared') return refuseWith(job, spawnProblem(prepared.reason, 'spawn'));
      // Apply only the decision the operator saw; the kernel's --expect-decision guards it again at apply.
      if (!sameSpawnDecision(prepared.preview.decision, job.decision)) return refuse(job, DRIFT_TEXT);
      job.prepared = prepared; job.spawnRef = prepared.spawnRef; job.submitted = true; save();
      const view = await request(job, { action: 'apply', spawnRef: job.spawnRef });
      if (view) settle(job, view);
    } catch (error) {
      if (!live(job)) return;
      if (job.submitted) unknown(job);
      else refuseWith(job, spawnProblem(spawnApplyReason(error?.code), 'spawn'));
    }
  }

  /** A job recovered after a reload: read `result` while the server says pending, then settle it. */
  async function follow(job) {
    try {
      for (;;) {
        const view = await request(job, { action: 'result', spawnRef: job.spawnRef });
        if (!view) return;
        if (view.status !== 'pending') return settle(job, view);
        if (now() - job.recoveredAt >= recoverWithinMs) return unknown(job, null, PENDING_TEXT);
        await sleep(pollMs);
        if (!live(job)) return;
      }
    } catch { if (live(job)) unknown(job); }
  }
  const text = (v, max = 4096) => typeof v === 'string' && v.length > 0 && v.length <= max;

  return {
    /** Take a confirmed press over: { token, workspace (the view), deployment?, soul, selector, input, decision, placement, draft }.
     * Single-flight per dialog press (token): the same press never starts two spawns. Returns the job id or null. */
    submit(spec) {
      if (!alive || !spec?.token || tokens.has(spec.token) || typeof spec.workspace !== 'string' || !spec.input || !spec.decision) return null;
      // Single-flight per soul (Spec D): while a spawn of this soul is in flight here, no second one starts.
      if (flightOf(spec.workspace, spec.soul)) return null;
      tokens.add(spec.token);
      const job = { id: `spawn-${++serial}`, workspace: spec.workspace, deployment: text(spec.deployment) ? spec.deployment : spec.workspace, soul: spec.soul, selector: spec.selector, input: structuredClone(spec.input),
        decision: structuredClone(spec.decision), instance: spec.decision.instance, home: spec.decision.home, placement: { ...(spec.placement || {}) },
        draft: structuredClone(spec.draft ?? {}), state: 'spawning', submitted: false, spawnRef: null, prepared: null, notice: null, announced: false, startedAt: now() };
      jobs.set(job.id, job); changed();
      void run(job);
      return job.id;
    },
    /** The pending rows of one workspace, for the roster: what the kernel decided, never a guessed state. */
    rows(workspace) {
      return [...jobs.values()].filter(j => j.workspace === workspace && ['spawning', 'checking', 'unknown', 'created'].includes(j.state))
        .map(j => ({ id: j.id, instance: j.instance, home: j.home, agent: j.soul?.name, agentsRoot: j.selector?.agentsRoot, ...j.placement,
          deployment: { id: j.deployment }, // the roster groups a pending row under its deployment
          pending: j.state === 'unknown' ? 'unknown' : j.state === 'checking' ? 'checking' : 'spawning', ...(j.revealed ? { revealed: true } : {}) }));
    },
    /** Spec E: the pending row of the spawn just pressed is highlighted (the shell reveals it). */
    reveal(id) { const j = jobs.get(id); if (!j) return false; for (const other of jobs.values()) other.revealed = other === j; return true; },
    /** Spec E: a complete spawn's real row says New until it or its tab is first opened. */
    markNew(workspace, row) { if (!alive || !row?.home) return; fresh.add(freshKey(workspace, row)); changed(); },
    isNew: (workspace, row) => fresh.has(freshKey(workspace, row)),
    /** Its row or its tab was opened: no longer New. Silent (the caller paints the row as it is now). */
    seen(workspace, row) { return fresh.delete(freshKey(workspace, row)); },
    /** Announce a pending row once (the roster's polite live region). */
    announce(id) { const j = jobs.get(id); if (!j || j.announced) return false; j.announced = true; return true; },
    /** Check result for an unknown outcome: the existing recovery (result; an unknown result re-applies the SAME ref). */
    async check(id) {
      const job = jobs.get(id);
      if (!job || job.state !== 'unknown' || !job.spawnRef) return;
      job.state = 'checking'; changed();
      try {
        let view = await request(job, { action: 'result', spawnRef: job.spawnRef });
        if (!view) return;
        if (view.status === 'unknown') { view = await request(job, { action: 'apply', spawnRef: job.spawnRef }); if (!view) return; }
        settle(job, view);
      } catch { if (live(job)) unknown(job); }
    },
    /** The roster observed `workspace` (called on every paint of the current workspace): created rows that the
     * roster now reports become real, held notifications of this workspace are posted. */
    observe(workspace, instances = []) {
      if (!alive) return;
      for (const job of [...jobs.values()]) {
        if (job.workspace !== workspace) continue;
        if (job.state === 'created') {
          const same = instances.filter(i => i.instance === job.instance && i.home === job.home && i.agentsRoot === job.selector?.agentsRoot && i.agent === job.soul?.name && !i.server
            && (!i.deployment || i.deployment.id === job.deployment));
          const ready = same.length === 1 && (!job.wantRunning || same[0].running === true && !!same[0].tmux?.session);
          if (ready) {
            job.state = 'done';
            if (job.wantRunning && job.quiet) job.arrived = { ...same[0] };
            else if (job.wantRunning) job.notice = { spawned: { ...same[0] }, posted: false };
            else if (!job.notice || job.notice.posted) { forget(job); continue; }
            changed();
          } else if (now() - job.createdAt >= visibleWithinMs) {
            job.state = 'done';
            if (job.wantRunning && !job.quiet) job.notice = { message: `Created ${job.instance} — not yet visible as a running session. Open it from the roster when it appears.`, options: {}, posted: false };
            else if (!job.notice || job.notice.posted) { forget(job); continue; }
            changed();
          }
        }
        deliver(job);
      }
    },
    /** Whether a created instance of `workspace` is still awaited in the roster (the shell then reads it sooner). */
    settling: workspace => alive && [...jobs.values()].some(j => j.workspace === workspace && j.state === 'created'),
    /** The spawn of this soul in flight in `workspace` (Spawning… or Checking result), or null. */
    inFlight(workspace, soul) { const j = flightOf(workspace, soul); return j ? { id: j.id, instance: j.instance, home: j.home } : null; },
    /** Listen to every change (the open dialog re-reads inFlight); returns the unsubscribe. */
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** After a window reload: bring back the jobs storage kept and read their outcome (result action only). */
    recover() {
      if (!alive || !storage) return 0;
      let kept;
      try { kept = JSON.parse(storage.getItem(SPAWN_STORAGE_KEY) || '[]'); } catch { kept = []; }
      if (!Array.isArray(kept)) kept = [];
      let n = 0;
      for (const e of kept) {
        if (!e || !text(e.workspace) || !text(e.spawnRef, 256) || !text(e.instance, 256) || !text(e.home) || !text(e.soul?.name, 256)
          || !text(e.selector?.soul, 256) || [...jobs.values()].some(j => j.spawnRef === e.spawnRef)) continue;
        const placement = {};
        for (const k of ['parentInstance', 'siblingInstance']) if (text(e.placement?.[k], 256)) placement[k] = e.placement[k];
        const job = { id: `spawn-${++serial}`, workspace: e.workspace, deployment: text(e.deployment) ? e.deployment : e.workspace, soul: { name: e.soul.name, agentsRoot: e.soul.agentsRoot },
          selector: { soul: e.selector.soul, agentsRoot: e.selector.agentsRoot }, input: null, decision: null, instance: e.instance, home: e.home, placement,
          // Reopen after a reload restores the soul and the exact name; the opening instruction is never stored.
          draft: { layout: 'scoped', restore: { choices: { name: e.instance } } }, state: 'spawning', submitted: true, spawnRef: e.spawnRef,
          prepared: null, notice: null, announced: false, startedAt: Number.isFinite(e.startedAt) ? e.startedAt : now(), recoveredAt: now(), recovered: true };
        jobs.set(job.id, job); n++;
        void follow(job);
      }
      if (n) changed(); else save();
      return n;
    },
    /** Move job owners onto workspace views: `map` is `Map<old id, view id>` (workspace-rehome.mjs). */
    rehome(map) {
      let moved = 0;
      for (const job of jobs.values()) { const to = map?.get?.(job.workspace); if (to && to !== job.workspace) { job.workspace = to; moved++; } }
      if (moved) changed();
      return moved;
    },
    /** A job's draft and soul, for tests and the Reopen path. */
    get(id) { const j = jobs.get(id); return j ? { id: j.id, state: j.state, instance: j.instance, workspace: j.workspace, deployment: j.deployment, draft: structuredClone(j.draft), soul: j.soul } : null; },
    size: () => jobs.size,
    dispose() { alive = false; jobs.clear(); fresh.clear(); },
  };
}
