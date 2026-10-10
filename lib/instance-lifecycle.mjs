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
import { attachedWorkLink, extraWorktreePlan, findInstanceHomes, inspectInstanceSession, listAgents, listInstances, observeSessionWithoutReceipt, retirePendingMarkerPath, retirementRecoveryFacts, stillRunningOf, stopInstanceSession } from "./core.mjs";
import { groupedByOwner } from "./retire-output.mjs";
import { observeInstanceGit } from "./instance-git.mjs";
import { appendEvent } from "./instance-events.mjs";
import { isAnswerCode, kernelCode, oatsError, reportDefect } from "./errors.mjs";

export const LIFECYCLE_API = 1;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const stopPendingPath = (home) => join(home, ".oats-stop-pending.json");
const stopReceiptPath = (home, key) => join(home, `.oats-stop-receipt.${key}.json`);

function readJson(path) { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; } }
function planRevision(facts) { return createHash("sha256").update(JSON.stringify(facts)).digest("hex").slice(0, 24); }

/** Resolve `<name>` under the deployment's agents root to exactly one home. */
export function resolveInstance(ctx, root, name, { home } = {}) {
  const roots = [root];
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
  // Recorded parentage is a BARE name, and names are unique only per agent
  // directory. An edge whose parent name resolves to several homes under this
  // root is ambiguous: it is reported, never acted on (nothing is inferred).
  const homesByName = new Map();
  for (const r of rows) { if (!homesByName.has(r.instance)) homesByName.set(r.instance, []); homesByName.get(r.instance).push(r); }
  const byParent = new Map();
  const ambiguous = [];
  for (const r of rows) {
    if (r.parent && (homesByName.get(r.parent) || []).length > 1) { ambiguous.push({ ...r, reason: `parent name ${JSON.stringify(r.parent)} resolves to ${homesByName.get(r.parent).length} homes; edge not followed` }); continue; }
    if (!byParent.has(r.parent)) byParent.set(r.parent, []); byParent.get(r.parent).push(r);
  }
  const out = [];
  const walk = (parent, depth) => { for (const c of byParent.get(parent) || []) { if (c.instance === parent) continue; walk(c.instance, depth + 1); out.push({ ...c, depth }); } };
  walk(name, 1);
  out.ambiguous = ambiguous.filter((r) => r.parent === name); // edges pointing at THIS name that could not be followed
  return out; // deepest first
}

/** `state` is the session backend's word: "shell"/"stopped"/"not-launched" are
 *  idle; "unknown" means a NON-shell process is running whose identity tmux
 *  cannot name (the ordinary case for a launched harness). "Could not be
 *  established" is a different thing and is `present: null` with a reason:
 *  the kernel code of what failed, never a system error's (E_SESSION_UNAVAILABLE
 *  for one that has none; workFacts: E_GIT_FAILED). */
function sessionFacts(home) {
  try { const s = inspectInstanceSession(home); return { state: s.state, present: s.present, backend: s.backend ?? null, established: true }; }
  catch (e) { return { state: "unestablished", present: null, backend: null, established: false, reason: kernelCode(e, "E_SESSION_UNAVAILABLE") }; }
}
/** Retire's view of a home without its session receipt (before 0.25.9): the
 *  retirement needs only absence, which it can observe — `{state: "absent",
 *  present: false, established: true, note}`; live or ambiguous stays
 *  unestablished, with the note saying why (retire refuses it). */
function retireSessionFacts(home, session) {
  if (session.established || session.reason !== "E_RUNTIME_ENDPOINT_UNKNOWN") return session;
  const meta = readJson(join(home, "instance.json"));
  if (!meta) return session;
  const seen = observeSessionWithoutReceipt(home, meta);
  return seen.absent ? { state: "absent", present: false, backend: seen.backend, established: true, note: seen.note } : { ...session, note: seen.note };
}
const running = (s) => s.established && s.present === true && !["shell", "stopped", "not-launched"].includes(s.state);
function workFacts(home) {
  if (!existsSync(join(home, "work"))) return { observed: false, reason: "no-worktree" };
  try {
    const g = observeInstanceGit(home);
    return { observed: true, revision: g.observation.revision, branch: g.observation.branch, detached: g.observation.detached, drift: g.recorded.drift,
      changed: g.summary.changed + g.summary.renamed + g.summary.copied + g.summary.unmerged, untracked: g.summary.untracked,
      upstream: g.upstream, base: { ref: g.base.ref, ahead: g.base.ahead, behind: g.base.behind }, remote: g.remote ? { host: g.remote.host, path: g.remote.path } : null };
  } catch (e) { return { observed: false, reason: kernelCode(e, "E_GIT_FAILED") }; }
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
  const ambiguousEdges = (kids.ambiguous || []).map((c) => ({ instance: c.instance, agent: c.agent, home: c.home, reason: c.reason }));
  const plan = { lifecycleApi: LIFECYCLE_API, action: "stop", instance: name, home: me.home, recursive, at: new Date().toISOString(),
    targets, skipped: recursive ? [] : descendantsOf(me.root, name).map((c) => ({ instance: c.instance, agent: c.agent, home: c.home, reason: "recursive=false" })),
    ambiguous: ambiguousEdges,
    planRevision: planRevision(safety),
    notes: [...(ambiguousEdges.length ? [`${ambiguousEdges.length} instance(s) record this name as parent but the name is not unique under this root; they are listed under ambiguous and NOT acted on`] : []),
      ...(targets.some((t) => t.retiring) ? ["a target is being retired; apply will refuse it"] : []), ...(targets.some((t) => !t.session.established) ? ["a session state could not be established; it is reported unestablished, not idle"] : [])] };
  return plan;
}

/** A stored receipt's results as this kernel answers them. A receipt stored by a kernel from before
 *  feature `lifecycle-kernel-codes` can hold the system's own code in a failed target's row; a
 *  replay is an answer of this kernel, and carries a kernel code there like every other (the row's
 *  message keeps the system's text). The stored file is evidence and is never rewritten. */
function replayedResults(results) {
  if (!Array.isArray(results)) return results;
  return results.map((r) => r && typeof r === "object" && "code" in r && !isAnswerCode(r.code) ? { ...r, code: "E_SESSION_STOP_FAILED" } : r);
}

/** Apply a Stop plan: revalidate the revision, take the stop-pending marker
 *  per target (refusing retiring targets), stop deepest-first, record a
 *  receipt keyed by idempotency key. A retried apply with the same key
 *  returns the recorded receipt without acting again (replayedResults). */
export function applyStop(ctx, root, name, { home, recursive = true, planRevision: expected, idempotencyKey, graceMs } = {}) {
  if (typeof expected !== "string" || !expected) throw oatsError("E_BAD_ARGS", "apply needs --plan-revision from a prior `--plan`");
  if (typeof idempotencyKey !== "string" || !KEY.test(idempotencyKey)) throw oatsError("E_BAD_ARGS", "apply needs --idempotency-key (1-128 chars of [A-Za-z0-9._:-])");
  const plan = planStop(ctx, root, name, { home, recursive });
  const prior = readJson(stopReceiptPath(plan.home, idempotencyKey));
  if (prior && prior.idempotencyKey === idempotencyKey) return { ...prior, results: replayedResults(prior.results), replayed: true };
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
        reportDefect(e); // the error becomes a row here: its stack would otherwise be lost
        results.push({ instance: t.instance, home: t.home, ok: false, code: kernelCode(e, "E_SESSION_STOP_FAILED"), message: e.message, stillRunning: stillRunningOf(e) });
      }
    }
  } finally { for (const t of plan.targets) rmSync(stopPendingPath(t.home), { force: true }); }
  const receipt = { lifecycleApi: LIFECYCLE_API, action: "stop", instance: name, home: plan.home, idempotencyKey, planRevision: expected, at: new Date().toISOString(),
    ok: results.every((r) => r.ok), results, retained: ["home", "work", "transcript", "launch"], replayed: false };
  // One receipt file per key: a retry of ANY earlier key replays its own
  // receipt for as long as the home exists (the replay horizon).
  try { writeFileSyncAtomic(stopReceiptPath(plan.home, idempotencyKey), receipt); } catch { /* receipt is evidence, not authority */ }
  return receipt;
}

function writeFileSyncAtomic(path, value) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2)); renameSync(tmp, path);
}

/** What the Desktop reads of a plan's notes (packages/desktop/renderer/lifecycle-contract.mjs): at
 *  most 64, each at most 4096 characters; it refuses a plan with more, so every note is built to fit
 *  (#658). A path is never cut: what does not fit is left to the plan JSON or the receipt. */
const PLAN_NOTES_MAX = 64;
const PLAN_NOTE_MAX = 4096;
/** The characters a note spends listing names (declared roots, attached children) before `, and N more`. */
const PLAN_LIST_BUDGET = 1024;
const SEE_EXTRA = "facts.extraWorktrees in the plan JSON";
/** The first `max` of `items` that fit `budget` characters as `render(shown)`, the rest counted as
 *  `, and N more`. → the text, or null when not even one fits. */
function listWithin(items, render, budget, max = items.length) {
  for (let n = Math.min(items.length, max); n > 0; n--) {
    const text = `${render(items.slice(0, n))}${n < items.length ? `, and ${items.length - n} more` : ""}`;
    if (text.length <= budget) return text;
  }
  return null;
}

/** `render(parts)` within PLAN_NOTE_MAX: `parts` maps each name to [its full text, a pointer to where
 *  the plan JSON holds it]; while the note is too long, the longest part that a pointer shortens is
 *  replaced by it. → the note, or null when it still does not fit. */
function fitParts(render, parts) {
  const shown = Object.fromEntries(Object.entries(parts).map(([key, [full]]) => [key, full]));
  let note = render(shown);
  for (const key of Object.keys(parts).sort((a, b) => String(parts[b][0]).length - String(parts[a][0]).length)) {
    if (note.length <= PLAN_NOTE_MAX) return note;
    if (String(parts[key][0]).length <= parts[key][1].length) continue; // the pointer would not shorten it
    shown[key] = parts[key][1];
    note = render(shown);
  }
  return note.length <= PLAN_NOTE_MAX ? note : null;
}

/** A retire plan's note for one extra tree (core extraWorktreePlan row). Too long for the Desktop, its
 *  longest parts go to the plan JSON, longest first; the tree's path stays whole, or the note says it
 *  is too long and where it is. */
function extraWorktreeNote(t) {
  const parts = {
    at: [t.branch ? `branch ${t.branch}` : t.detachedAt ? `detached at ${t.detachedAt.slice(0, 12)}` : "a HEAD that could not be read", `its HEAD: see ${SEE_EXTRA}`],
    repo: [t.repo, `its repository (see ${SEE_EXTRA})`],
    movedTo: [t.movedTo, `the path ${SEE_EXTRA} names`],
    reason: [t.reason, `${SEE_EXTRA} says why`],
  };
  const render = (p) => t.disposition === "remove" ? `extra worktree ${t.path} (${p.at}) is clean and would be removed; its branch and commits stay in ${p.repo}`
    : t.disposition === "retain" ? `extra worktree ${t.path} (${p.at}) would be re-homed to ${p.movedTo}: ${p.reason}`
    : `extra worktree ${t.path} (${p.at}): retire refuses, ${p.reason}`;
  const note = fitParts(render, parts);
  if (note !== null) return note;
  const outcome = t.disposition === "remove" ? "would be removed" : t.disposition === "retain" ? "would be re-homed" : "makes retire refuse";
  return `an extra worktree whose path is too long for this note ${outcome}; ${SEE_EXTRA} lists it`;
}
/** The plan's note when the worktree is not on the recorded branch: both names, or, too long for the
 *  note, pointers to the plan JSON fields that hold them. */
function driftNote(work, recordedBranch) {
  const on = work.branch ?? (work.detached ? "a detached HEAD" : "a ref OATS carries no branch name for");
  return fitParts((p) => `the worktree is on ${p.on}, not the recorded ${p.recorded}`, {
    on: [on, "the branch facts.work.branch in the plan JSON names"],
    recorded: [recordedBranch, "branch, which facts.recordedBranch in the plan JSON names"],
  }) ?? "the worktree is not on the recorded branch; facts.work.branch and facts.recordedBranch in the plan JSON name both";
}
/** The plan's note on a home without its session receipt: the observation's reason, or, too long
 *  for the note (a process's command line, a tmux error), a pointer to facts.session.note. */
function sessionNote(session) {
  const [head, tail] = session.established ? ["session absent", "nothing needs quiescing"] : ["session not observably absent", "retire refuses until it is stopped"];
  const note = `${head}: ${session.note}; ${tail}`;
  return note.length <= PLAN_NOTE_MAX ? note : `${head}: the reason is too long for this note (facts.session.note in the plan JSON); ${tail}`;
}
/** The plan's recovery note: where a recovery would be written, and the declared roots it leaves
 *  out, listed within PLAN_LIST_BUDGET (at most 16). A recovery path too long for the note is named
 *  by where to find it instead. */
function recoveryNote(recovery) {
  const roots = recovery.disposableHome;
  const notCopied = (head) => {
    if (!roots.length) return "";
    const room = Math.min(PLAN_LIST_BUDGET, PLAN_NOTE_MAX - head.length - "; not copied: ".length);
    const listed = room > 0 ? listWithin(roots, (shown) => groupedByOwner(shown, "root"), room, PLAN_NOT_COPIED_CAP) : null;
    return `; not copied: ${listed ?? `${roots.length} declared root${roots.length === 1 ? "" : "s"}, too long to list here`}`;
  };
  const head = `recovery: the home is copied to ${recovery.recoveryRoot} before the home is removed, when it changed since spawn`;
  const note = `${head}${notCopied(head)}`;
  if (note.length <= PLAN_NOTE_MAX) return note;
  const elsewhere = "recovery: the home is copied to the recovery directory beside the home before the home is removed, when it changed since spawn (its path is too long for this note: the retire receipt names it as workRecovery.path, and the retire summary prints it)";
  return `${elsewhere}${notCopied(elsewhere)}`;
}
/** How many declared roots a retire plan's recovery note lists before `, and N more`. */
const PLAN_NOT_COPIED_CAP = 16;
/** Facts for Remove (retire): what retirement would touch, with the design's
 *  defaults (retain worktree and branch; never touch a PR). `oats retire`
 *  itself applies them: plain retire re-homes the worktree; --discard-worktree
 *  is the dialog's opt-in. No retire deletes a branch: `deleteBranch` is
 *  always false. */
export function planRetire(ctx, root, name, { home } = {}) {
  const me = resolveInstance(ctx, root, name, { home });
  const kids = descendantsOf(me.root, name);
  const target = targetFacts({ ...me, instance: name, depth: 0 });
  target.session = retireSessionFacts(me.home, target.session);
  const meta = readJson(join(me.home, "instance.json")) || {};
  // The home's extra trees and what retire does with each: listed, and bound
  // into the revision (below), so that an apply refuses as stale when a tree
  // was created, removed, dirtied or cleaned, or its target was taken.
  const extraWorktrees = extraWorktreePlan(me.home, me.root);
  // A home spawned before #641 may record the word "HEAD" for a detached checkout: not a branch name.
  const facts = { session: target.session, work: target.work, workMode: meta.work ?? null, repo: meta.repo ?? null, recordedBranch: meta.branch === "HEAD" ? null : meta.branch ?? null,
    extraWorktrees,
    children: kids.map((c) => ({ instance: c.instance, agent: c.agent, home: c.home, session: sessionFacts(c.home) })),
    ambiguous: (kids.ambiguous || []).map((c) => ({ instance: c.instance, agent: c.agent, home: c.home, reason: c.reason })),
    pullRequest: "unknown" /* forge facts are the ADE's (P1); the kernel never claims 'no PR' */ };
  const defaults = { retainWorktree: meta.work === "worktree", deleteBranch: false, stopChildren: true, retainChildren: true };
  const safety = [me.home, target.session.state, target.launched, facts.work.observed ? [facts.work.revision, facts.work.branch, facts.work.changed, facts.work.untracked] : null, kids.map((c) => c.home),
    // Only when there are any: a home without extra trees keeps the revision it had.
    ...(extraWorktrees.length ? [extraWorktrees] : [])];
  // What retire would preserve and where, read from the spawn baseline and the
  // work mode: nothing is hashed, and the plan revision does not depend on it.
  // The declared roots are listed as written, bounded so one note stays short.
  const recovery = retirementRecoveryFacts(me.home);
  // Attached children whose work is this home's work/ (#718): a retire that keeps the worktree
  // repoints them to it. One note holds whatever the dialog then picks.
  const attached = meta.work === "worktree" ? kids.filter((c) => attachedWorkLink(c.home, me.home) !== null) : [];
  appendEvent(me.home, { kind: "retire-planned", data: { planRevision: planRevision(safety), children: kids.length, dirty: facts.work.observed ? facts.work.changed + facts.work.untracked : null } }, { workspaceOnly: true });
  return { lifecycleApi: LIFECYCLE_API, action: "retire", instance: name, home: me.home, at: new Date().toISOString(), facts, defaults, planRevision: planRevision(safety),
    notes: boundedNotes(extraWorktrees.map(extraWorktreeNote), [
      ...(facts.work.observed && facts.work.drift ? [driftNote(facts.work, facts.recordedBranch)] : []),
      ...(facts.work.observed && facts.work.changed + facts.work.untracked > 0 ? [`${facts.work.changed} changed and ${facts.work.untracked} untracked file(s) would be retained with the worktree`] : []),
    ], [
      ...(kids.length ? [`${kids.length} recorded child instance(s) are stopped first (bounded SIGTERM, never escalated) and retained (their homes are not removed); a child still running after the grace refuses the retirement`] : []),
      ...(attached.length ? [`attached child instance(s) ${listWithin(attached.map((c) => c.instance), (shown) => shown.join(", "), PLAN_LIST_BUDGET) ?? attached.length} use this home's work/ as their work: a retire that keeps the worktree repoints their work link to it; with --discard-worktree the worktree is removed and their work link will dangle`] : []),
      ...((kids.ambiguous || []).length ? [`${kids.ambiguous.length} instance(s) record this name as parent but the name is not unique under this root; they are listed under ambiguous and NOT acted on`] : []),
      ...(target.session.note ? [sessionNote(target.session)] : []),
      "pull request state is unknown to the kernel; the ADE reports it when a forge connection exists",
      recoveryNote(recovery),
      ...(meta.work === "worktree" ? ["recovery: uncommitted worktree state is copied there too"] : meta.work === "directory" ? ["recovery: work/ is copied there when it is not empty"] : []),
    ]) };
}

/** A retire plan's notes in order: `before`, one per extra tree, `after`. The extra trees are the
 *  only notes without a fixed count: past PLAN_NOTES_MAX the last one kept counts the rest. Each note
 *  is built to fit PLAN_NOTE_MAX; one that still does not (a new note that forgot to) is replaced
 *  rather than let the Desktop refuse the whole plan. */
function boundedNotes(trees, before, after) {
  const room = PLAN_NOTES_MAX - before.length - after.length;
  const shown = trees.length <= room ? trees : [...trees.slice(0, room - 1), `and ${trees.length - room + 1} more extra worktrees (${SEE_EXTRA} lists every one)`];
  return [...before, ...shown, ...after].map((note) => note.length <= PLAN_NOTE_MAX ? note : "a note too long for this plan was left out; the plan JSON's facts hold what it said");
}
