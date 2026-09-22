/** K3 — lifecycle plans for the Desktop's Stop and Remove confirmations.
 *
 * A plan is a read-only statement of what an action WOULD touch, with the
 * facts a human needs to decide (session state, children, dirty work) and a
 * `planRevision` hashed from the facts that make the action safe. Apply
 * takes that revision back: if reality moved, apply refuses with the fresh
 * plan instead of acting on a world the human did not see. Idempotency keys
 * make a retried apply return the first receipt rather than act twice.
 * Unknown is reported as unknown — never as "clean" or "no children". */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { findInstanceHomes, inspectInstanceSession, listAgents, listInstances, retirePendingMarkerPath, stopInstanceSession, teamAgentRoots, resolveOatsConfig } from "./core.mjs";
import { observeInstanceGit } from "./instance-git.mjs";
import { oatsError } from "./errors.mjs";

export const LIFECYCLE_API = 1;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const stopPendingPath = (home) => join(home, ".oats-stop-pending.json");
const stopReceiptPath = (home) => join(home, ".oats-stop-receipt.json");

function readJson(path) { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; } }
function planRevision(facts) { return createHash("sha256").update(JSON.stringify(facts)).digest("hex").slice(0, 24); }

/** Resolve `<name>` under the scope's agents roots to exactly one home. */
export function resolveInstance(ctx, root, name, { home } = {}) {
  let r; try { r = resolveOatsConfig(ctx); } catch { r = {}; }
  const roots = [...new Set([root, ...(r.team ? teamAgentRoots(r.team.scope) : [])])];
  const candidates = [];
  for (const rt of roots) for (const hit of findInstanceHomes(rt, name)) candidates.push({ root: rt, agent: hit.agent?.name ?? null, home: hit.home });
  if (home !== undefined) {
    const found = candidates.find((c) => c.home === home);
    if (!found) throw oatsError("E_HOME_MISMATCH", `--home ${home} is not a home of instance ${JSON.stringify(name)} under ${roots.join(", ")}`);
    return found;
  }
  if (!candidates.length) throw oatsError("E_SESSION_UNKNOWN", `no instance ${JSON.stringify(name)} under ${roots.join(", ")}`);
  if (candidates.length > 1) throw Object.assign(oatsError("E_AMBIGUOUS_INSTANCE", `instance ${JSON.stringify(name)} has ${candidates.length} homes; pass --home <abs>`), { candidates });
  return candidates[0];
}

/** Every instance under the roots whose recorded parent chain reaches `name`,
 *  deepest first (children are acted on before their parent). Recorded
 *  parentage is the only relation the kernel knows; it is reported as such. */
export function descendantsOf(root, name) {
  const rows = [];
  for (const a of listAgents(root)) for (const i of listInstances(root).filter((x) => x.name === a.name)) for (const inst of i.instances || []) {
    const home = join(a._dir, "instances", inst.instance);
    const meta = readJson(join(home, "instance.json"));
    if (meta) rows.push({ instance: inst.instance, agent: a.name, home, parent: meta.parentInstance ?? null });
  }
  const byParent = new Map();
  for (const r of rows) { if (!byParent.has(r.parent)) byParent.set(r.parent, []); byParent.get(r.parent).push(r); }
  const out = [];
  const walk = (parent, depth) => { for (const c of byParent.get(parent) || []) { if (c.instance === parent) continue; walk(c.instance, depth + 1); out.push({ ...c, depth }); } };
  walk(name, 1);
  return out; // deepest first
}

/** `state` is the session backend's word: "shell"/"stopped"/"not-launched" are
 *  idle; "unknown" means a NON-shell process is running whose identity tmux
 *  cannot name (the ordinary case for a launched harness). "Could not be
 *  established" is a different thing and is `present: null` with a reason. */
function sessionFacts(home) {
  try { const s = inspectInstanceSession(home); return { state: s.state, present: s.present, backend: s.backend ?? null, established: true }; }
  catch (e) { return { state: "unestablished", present: null, backend: null, established: false, reason: e.code || "E_SESSION_UNAVAILABLE" }; }
}
const running = (s) => s.established && s.present === true && !["shell", "stopped", "not-launched"].includes(s.state);
function workFacts(home) {
  if (!existsSync(join(home, "work"))) return { observed: false, reason: "no-worktree" };
  try {
    const g = observeInstanceGit(home);
    return { observed: true, revision: g.observation.revision, branch: g.observation.branch, detached: g.observation.detached, drift: g.recorded.drift,
      changed: g.summary.changed + g.summary.renamed + g.summary.copied + g.summary.unmerged, untracked: g.summary.untracked,
      upstream: g.upstream, base: { ref: g.base.ref, ahead: g.base.ahead, behind: g.base.behind }, remote: g.remote ? { host: g.remote.host, path: g.remote.path } : null };
  } catch (e) { return { observed: false, reason: e.code || "E_GIT_FAILED" }; }
}
function targetFacts(row) {
  const meta = readJson(join(row.home, "instance.json")) || {};
  return { instance: row.instance, agent: row.agent, home: row.home, depth: row.depth ?? 0, workMode: meta.work ?? null, launched: meta.launched === true,
    session: sessionFacts(row.home), work: workFacts(row.home),
    retiring: existsSync(retirePendingMarkerPath(row.home)), stopPending: existsSync(stopPendingPath(row.home)) };
}

/** Facts for Stop: the instance, its recorded descendants (deepest first),
 *  each with session state and dirty-work counts. `midTask` is REPORTED
 *  activity: dirty work or a running session; unknown says unknown. */
export function planStop(ctx, root, name, { home, recursive = true } = {}) {
  const me = resolveInstance(ctx, root, name, { home });
  const kids = recursive ? descendantsOf(me.root, name) : [];
  const targets = [...kids.map(targetFacts), targetFacts({ ...me, instance: name, depth: 0 })];
  // Reported activity: a running session or dirty work is mid-task; when the
  // session could not be established and work is not observed, say unknown.
  for (const t of targets) t.midTask = running(t.session) || (t.work.observed && t.work.changed + t.work.untracked > 0) ? true : (!t.session.established || !t.work.observed) ? "unknown" : false;
  const safety = targets.map((t) => [t.home, t.session.state, t.session.present, t.launched, t.retiring]);
  const plan = { lifecycleApi: LIFECYCLE_API, action: "stop", instance: name, home: me.home, recursive, at: new Date().toISOString(),
    targets, skipped: recursive ? [] : descendantsOf(me.root, name).map((c) => ({ instance: c.instance, agent: c.agent, home: c.home, reason: "recursive=false" })),
    planRevision: planRevision(safety),
    notes: [...(targets.some((t) => t.retiring) ? ["a target is being retired; apply will refuse it"] : []), ...(targets.some((t) => !t.session.established) ? ["a session state could not be established; it is reported unestablished, not idle"] : [])] };
  return plan;
}

/** Apply a Stop plan: revalidate the revision, take the stop-pending marker
 *  per target (refusing retiring targets), stop deepest-first, record a
 *  receipt keyed by idempotency key. A retried apply with the same key
 *  returns the recorded receipt without acting again. */
export function applyStop(ctx, root, name, { home, recursive = true, planRevision: expected, idempotencyKey, graceMs } = {}) {
  if (typeof expected !== "string" || !expected) throw oatsError("E_BAD_ARGS", "apply needs --plan-revision from a prior `--plan`");
  if (typeof idempotencyKey !== "string" || !KEY.test(idempotencyKey)) throw oatsError("E_BAD_ARGS", "apply needs --idempotency-key (1-128 chars of [A-Za-z0-9._:-])");
  const plan = planStop(ctx, root, name, { home, recursive });
  const prior = readJson(stopReceiptPath(plan.home));
  if (prior && prior.idempotencyKey === idempotencyKey) return { ...prior, replayed: true };
  if (plan.planRevision !== expected) throw Object.assign(oatsError("E_PLAN_STALE", `the stop plan changed since it was shown (${expected} → ${plan.planRevision}); review the fresh plan`), { plan });
  const retiring = plan.targets.filter((t) => t.retiring);
  if (retiring.length) throw Object.assign(oatsError("E_INSTANCE_RETIRING", `${retiring.map((t) => t.instance).join(", ")} ${retiring.length === 1 ? "is" : "are"} being retired; nothing was stopped`), { plan });
  const pending = plan.targets.filter((t) => t.stopPending);
  if (pending.length) throw Object.assign(oatsError("E_LIFECYCLE_BUSY", `${pending.map((t) => t.instance).join(", ")} already ${pending.length === 1 ? "has" : "have"} a stop in progress`), { plan });
  const results = [];
  const marker = { action: "stop", idempotencyKey, planRevision: expected, at: new Date().toISOString() };
  for (const t of plan.targets) { try { writeFileSyncAtomic(stopPendingPath(t.home), marker); } catch { /* best effort marker; the lock is advisory across our own apply paths */ } }
  try {
    for (const t of plan.targets) {
      try {
        const r = stopInstanceSession(t.home, { graceMs });
        results.push({ instance: t.instance, home: t.home, ok: true, stopped: r.stopped, alreadyIdle: r.alreadyIdle, state: r.state });
      } catch (e) {
        results.push({ instance: t.instance, home: t.home, ok: false, code: e.code || "E_SESSION_STOP_FAILED", message: e.message, stillRunning: e.receipt?.stillRunning ?? null });
      }
    }
  } finally { for (const t of plan.targets) rmSync(stopPendingPath(t.home), { force: true }); }
  const receipt = { lifecycleApi: LIFECYCLE_API, action: "stop", instance: name, home: plan.home, idempotencyKey, planRevision: expected, at: new Date().toISOString(),
    ok: results.every((r) => r.ok), results, retained: ["home", "work", "transcript", "launch"], replayed: false };
  try { writeFileSyncAtomic(stopReceiptPath(plan.home), receipt); } catch { /* receipt is evidence, not authority */ }
  return receipt;
}

function writeFileSyncAtomic(path, value) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2)); renameSync(tmp, path);
}

/** Facts for Remove (retire): what retirement would touch, with the design's
 *  defaults (retain worktree and branch; never touch a PR). `oats retire`
 *  itself applies them: plain retire re-homes the worktree; --discard-worktree
 *  / --delete-branch are the dialog's opt-ins. */
export function planRetire(ctx, root, name, { home } = {}) {
  const me = resolveInstance(ctx, root, name, { home });
  const kids = descendantsOf(me.root, name);
  const target = targetFacts({ ...me, instance: name, depth: 0 });
  const meta = readJson(join(me.home, "instance.json")) || {};
  const facts = { session: target.session, work: target.work, workMode: meta.work ?? null, repo: meta.repo ?? null, recordedBranch: meta.branch ?? null,
    children: kids.map((c) => ({ instance: c.instance, agent: c.agent, home: c.home, session: sessionFacts(c.home) })),
    pullRequest: "unknown" /* forge facts are the ADE's (P1); the kernel never claims 'no PR' */ };
  const defaults = { retainWorktree: meta.work === "worktree", deleteBranch: false, stopChildren: true, retainChildren: true };
  const safety = [me.home, target.session.state, target.launched, facts.work.observed ? [facts.work.revision, facts.work.branch, facts.work.changed, facts.work.untracked] : null, kids.map((c) => c.home)];
  return { lifecycleApi: LIFECYCLE_API, action: "retire", instance: name, home: me.home, at: new Date().toISOString(), facts, defaults, planRevision: planRevision(safety),
    notes: [
      ...(facts.work.observed && facts.work.drift ? [`the worktree is on ${facts.work.branch}, not the recorded ${facts.recordedBranch}; branch actions use the worktree's branch`] : []),
      ...(facts.work.observed && facts.work.changed + facts.work.untracked > 0 ? [`${facts.work.changed} changed and ${facts.work.untracked} untracked file(s) would be retained with the worktree`] : []),
      ...(kids.length ? [`${kids.length} recorded child instance(s) would be stopped and retained (their homes are not removed)`] : []),
      "pull request state is unknown to the kernel; the ADE reports it when a forge connection exists",
    ] };
}
