/** The claim: one file that says which process is doing a thing that must happen once at a time.
 *  One protocol, used by `oats worktree add|remove` (the purpose's claim, lib/worktree.mjs
 *  `withClaim`) and by `oats retire` and `oats instance stop` (the home's claim, lib/core.mjs
 *  `claimHomeFor`).
 *
 *  Unlike lib/dir-lock.mjs, a claim left by a process that died is taken over, so a killed command
 *  can always be run again: the owner is named by pid AND start time (processLiveness), never by a
 *  pid alone, and a holder whose start cannot be read is never taken for gone.
 *
 *  - Taking it: the owner's facts `{ pid, processStart, nonce, at }`, with what the caller adds to
 *    them (`facts`), are written to a private file and hard-linked to `path`, which fails if
 *    `path` exists. So a claim is never seen without its owner, and the nonce makes each holding
 *    distinct, even for the same process.
 *  - Its owner is alive: waited for up to `waitMs`, then refused (`busy`).
 *  - Its owner is gone (processLiveness "gone", which a zombie is too; "unknown" is refused, never
 *    taken over): the claim is removed under a second claim, `<path>.reclaim-<owner nonce>`, taken
 *    by this same protocol.
 *    Its holder re-reads `path` and removes it only if it still names that owner. Nothing else
 *    removes another's claim: its owner never releases it, and a new acquirer cannot write over an
 *    existing file. Two takeovers of one dead owner are therefore serialized, and neither removes
 *    a claim made after it read. A takeover cut short leaves its own claim behind, which the next
 *    takeover takes over in turn, up to CLAIM_MAX_DEPTH nested levels.
 *  - Its owner is gone and the file cannot be taken over: refused with `cannotTakeOver`, which
 *    says that the holder is gone and what to do with the file. Never with `busy`: nobody is
 *    running (awebai/oats#874). That is a file whose `nonce` is not the 32 hex digits a claim
 *    carries, so no takeover can be serialized on it; the claim of a takeover nested
 *    CLAIM_MAX_DEPTH deep; and, which comes first on the file systems there are, one whose
 *    takeover claim the system refuses to name: each nested level adds 41 bytes to the name, so a
 *    chain of four or five dead takeovers reaches the limit of a file name (ENAMETOOLONG). The
 *    refusal names the file whose takeover could not be named, the one to remove.
 *  - A step the holder recorded in its claim (recordInClaim) is ended by a takeover first
 *    (`endHolderStep`), which refuses, keeping the claim, if the step cannot be ended.
 *  - Once a takeover has ended a holder's step, no later answer of that acquisition says that
 *    nothing was done: whatever it is then refused with, or fails on, is answered
 *    E_LIFECYCLE_FAILED, naming first what was ended. Every refusal is handed what was ended so
 *    far (`ended`, the clauses in order; empty before any effect) and writes its own sentence
 *    for it (lib/errors.mjs nothingAfter, afterEndedSteps; lifecycleBusy takes `ended`): no
 *    message is rewritten here. A refusal that was made without them is still answered after
 *    them (claimUnavailable). A refusal before any effect stays what its caller made it.
 *  - Released by unlinking `path`, only while it still names this holding.
 *  - An unreadable claim file is never removed: the command is refused, naming the file. So is a
 *    path that exists and keeps reading as absent (a dangling symbolic link where the claim
 *    belongs), once the retries below are spent.
 *  - Every pass that does not take the claim falls through one check of its time and one pause
 *    (takeClaim): none starts the next pass at once, so no state of the path makes it spin, and
 *    each ends in a refusal within `waitMs` plus CLAIM_FREED_RETRIES pauses (awebai/oats#874).
 *    A claim that every one of those passes found held again by a process that is gone, after it
 *    took the one before over, is refused with `heldAgain`: an ordinary claim, which the next
 *    run takes over.
 *  - A claim that cannot be taken for a reason of the system's (its directory cannot be made, its
 *    private file cannot be written, the link fails otherwise than because the claim exists) is
 *    refused as E_LIFECYCLE_FAILED (claimUnavailable), never with the system's code
 *    (awebai/oats#874): the claim was not taken, so nothing was done.
 *
 *  Everything is synchronous. What is the caller's own goes in `opts`. Each refusal is an error
 *  whose message states its effects, once: in the caller's words for "nothing was done" before
 *  any effect, and as "nothing else was done" when `ended`, its last argument, names what this
 *  acquisition's takeovers ended before it:
 *    busy(holder, unknown, at, ended)       the refusal for a holder that lives (`unknown` unset)
 *                                           or whose liveness cannot be read (`unknown` is the
 *                                           reason); `at` is the claim file that names it
 *    ownStartUnreadable(reason, at, ended)  the refusal when this process's own start cannot be
 *                                           read, so it could not hold `at` verifiably
 *    unreadableClaim(at, ended)             the refusal for a claim file that does not parse, or
 *                                           for a path that exists and cannot be read as one
 *    cannotTakeOver(holder, at, why, ended) the refusal for a holder that is gone and whose claim
 *                                           file `at` this kernel cannot take over; `why` is a
 *                                           clause saying what stops it
 *    heldAgain(holder, at, times, ended)    the refusal for a claim that this command found
 *                                           without a live holder `times` times and that was
 *                                           taken again each time, the last time by `holder`,
 *                                           which is gone: nothing is wrong with `at`
 *    endHolderStep(holder, at, ended)       optional: end the step a dead holder recorded
 *                                           → { refusal?, warning?, ended? }; `refusal` is the
 *                                           caller's answer for a step that could not be ended
 *                                           (`at` is kept); `ended` is a clause naming what it
 *                                           ended, when it ended something
 *    waitMs                          how long a live holder is waited for (default CLAIM_WAIT_MS)
 *    warnings                        optional array a takeover's warnings are pushed to
 *    facts                           optional object, what the caller's claim says besides its
 *                                    owner (a home's lifecycle claim: `action`, the holder's verb).
 *                                    It is in the record that is linked, so the claim is never
 *                                    seen without it; the owner's four fields win over it */
import { linkSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { processLiveness, processStart } from "./worktree-hooks.mjs";
import { NOTHING_ELSE, afterEndedSteps, asKernelError, nothingAfter } from "./errors.mjs";

export const CLAIM_WAIT_MS = 3000;
const CLAIM_MAX_DEPTH = 8;
/** How long a pass that did not take the claim pauses before the next one. */
const CLAIM_PAUSE_MS = 50;
/** How many passes that found nobody holding the claim (it read as absent, or its holder was gone
 *  and it was taken over) are followed by another once `waitMs` is over; passes before that are
 *  not counted. With `waitMs: 0` that is every retry there is: enough for the true race, a claim
 *  released or freed between two steps of this process, and an end for a path that never becomes
 *  a claim. */
const CLAIM_FREED_RETRIES = 5;
const NONCE_RE = /^[0-9a-f]{32}$/;
const pauseSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** The claim at `path` → its record, `{ unreadable: true }` when it does not parse, null when there is none. */
export function readClaim(path) {
  try { const o = JSON.parse(readFileSync(path, "utf8")); return o && typeof o === "object" ? o : { unreadable: true }; }
  catch (e) { return e.code === "ENOENT" ? null : { unreadable: true }; }
}

/** The refusal for a claim `path` that could not be taken because of `e`, an error that is not the
 *  kernel's. The caller's command did nothing: it acts only once it holds its claim. Also for a
 *  caller that fails to make the claim's directory. `ended` is what this acquisition's takeovers
 *  ended before `e`: with it the answer names that first and says "nothing else was done". An
 *  error that is the kernel's is returned as it is before any effect, and after what was ended
 *  otherwise: the refusals of a claim are made for `ended` already, and one that was not still
 *  never says, by its code, that nothing happened. The one error on the way to a claim that itself
 *  comes after something was done says so (takeOver: the claim of a gone holder that cannot be
 *  removed once that holder's step was ended). */
export function claimUnavailable(path, e, ended) {
  return afterEndedSteps(ended, asKernelError(e, "E_LIFECYCLE_FAILED", `the claim ${path} could not be taken (${e?.message ?? e}); ${nothingAfter(ended)}`));
}

/** Take the claim `path` → this holding (`{ pid, processStart, nonce, at }`, with `opts.facts`), to
 *  pass to releaseClaim. Throws the caller's refusal when it cannot be taken, and claimUnavailable for
 *  any error that is not the kernel's. The directory exists. */
export function acquireClaim(path, opts, depth = 0) {
  const endedSteps = [];
  try { return takeClaim(path, opts, depth, endedSteps); }
  catch (e) { throw claimUnavailable(path, e, endedSteps); }
}

/** `endedSteps` collects what the takeovers of one acquisition ended, nested ones included; every
 *  refusal is handed it as it is when the refusal is made. */
function takeClaim(path, opts, depth, endedSteps) {
  const { busy, waitMs = CLAIM_WAIT_MS } = opts;
  const own = processStart(process.pid);
  if (own.state !== "alive") throw opts.ownStartUnreadable(own.reason ?? `pid ${process.pid} reads as ${own.state}`, path, endedSteps);
  const me = { ...opts.facts, pid: process.pid, processStart: own.token, nonce: randomBytes(16).toString("hex"), at: new Date().toISOString() };
  const tmp = `${path}.tmp-${process.pid}-${me.nonce}`;
  writeFileSync(tmp, JSON.stringify(me) + "\n", { mode: 0o600 });
  try {
    const deadline = Date.now() + waitMs;
    for (let freed = 0; ;) {
      try { linkSync(tmp, path); return me; }
      catch (e) { if (e?.code !== "EEXIST") throw e; }
      const holder = readClaim(path);
      if (holder?.unreadable) throw opts.unreadableClaim(path, endedSteps);
      const live = holder ? processLiveness(holder) : null;
      // Unreadable is never taken for gone: the claim is kept, and the refusal names the way out.
      if (live?.state === "unknown") throw busy(holder, live.reason, path, endedSteps);
      const gone = live?.state === "gone";
      const stuck = gone ? cannotBeTakenOver(holder, depth) : null;
      if (stuck) throw opts.cannotTakeOver(holder, path, stuck, endedSteps);
      // Nobody holds it: the link said it exists and it reads as absent (released in between; or a
      // path that never reads, a dangling symbolic link), or its holder is gone and it is taken
      // over below. The next pass is owed even with no time to wait, but not for ever.
      const free = !holder || gone;
      // What this pass answers once its time is up, about the file as it has just been read. A
      // gone holder here is the last of several: each pass took the one before over, and the
      // claim was taken again before this process could. The file is a claim like any other.
      const refusal = !holder ? () => opts.unreadableClaim(path, endedSteps)
        : gone ? () => opts.heldAgain(holder, path, freed, endedSteps)
        : () => busy(holder, null, path, endedSteps);
      // One check of its time and one pause for every pass that did not take the claim: nothing
      // above starts the next pass (lib/remote.mjs withCacheWriteLock, the same rule).
      if (Date.now() >= deadline) {
        if (!(free && freed < CLAIM_FREED_RETRIES)) throw refusal();
        freed++;
      }
      if (gone) takeOver(path, holder, opts, depth, endedSteps);
      pauseSync(CLAIM_PAUSE_MS);
    }
  } finally {
    try { unlinkSync(tmp); } catch { /* gone */ }
  }
}

/** Why the claim of the gone `holder`, met at `depth`, cannot be taken over → a clause, or null
 *  when it can. A takeover is serialized on the holder's nonce, so a file without one that this
 *  kernel writes is not removed by anybody (removeGoneClaim skips it too). */
function cannotBeTakenOver(holder, depth) {
  if (typeof holder.nonce !== "string" || !NONCE_RE.test(holder.nonce)) return "its nonce is not the 32 hexadecimal digits a claim carries";
  if (depth >= CLAIM_MAX_DEPTH) return `it is the claim of a takeover nested ${CLAIM_MAX_DEPTH} deep`;
  return null;
}

/** Remove `path`, held by the dead `holder`, under the claim that serializes takeovers of it. What
 *  it ended of the holder's goes to `endedSteps`, once the claim is removed. */
function takeOver(path, holder, opts, depth, endedSteps) {
  const reclaim = `${path}.reclaim-${holder.nonce}`;
  let me;
  try { me = takeClaim(reclaim, opts, depth + 1, endedSteps); }
  catch (e) {
    // The system will not name the claim of this takeover: `path` is as deep as takeovers nest
    // here. Its own answer is read, never a limit assumed, so this holds on any file system; and
    // it comes before the holder's step is ended or anything is removed. A refusal from a level
    // below is a kernel error and passes as it is, so the answer names the deepest claim reached.
    if (e?.code === "ENAMETOOLONG") throw opts.cannotTakeOver(holder, path, "the claim of one more takeover would have a name longer than this file system allows", endedSteps);
    throw claimUnavailable(reclaim, e, endedSteps);
  }
  try {
    const now = readClaim(path);
    if (now?.nonce === holder.nonce) {
      const ended = opts.endHolderStep?.(now, path, endedSteps) ?? {};
      if (ended.refusal) throw ended.refusal;
      if (ended.warning) opts.warnings?.push(ended.warning);
      try { unlinkSync(path); }
      catch (e) {
        // The holder's step is ended by now: "nothing was done" (claimUnavailable) would not be true.
        if (!ended.ended) throw e;
        throw asKernelError(e, "E_LIFECYCLE_FAILED", `the claim ${path} could not be taken (${e?.message ?? e}): ${ended.ended}, and the claim it left is kept; ${NOTHING_ELSE}`);
      }
      if (ended.ended) endedSteps.push(ended.ended);
    }
  } finally {
    releaseClaim(reclaim, me);
  }
}

/** Release the claim `path`, only while it still names the holding `me`. */
export function releaseClaim(path, me) {
  if (readClaim(path)?.nonce === me.nonce) { try { unlinkSync(path); } catch { /* gone */ } }
}

/** Record (or, with null, clear) a step of the holding `me` in its claim `path`, for a takeover to
 *  end (`endHolderStep`). Only the live holder writes its claim. */
export function recordInClaim(path, me, step) {
  const tmp = `${path}.tmp-${process.pid}-${me.nonce}`;
  writeFileSync(tmp, JSON.stringify({ ...me, ...(step ?? {}) }) + "\n", { mode: 0o600 });
  renameSync(tmp, path);
}

/** Remove the claim `path` when its holder is verifiably gone, through the takeover above, and
 *  take nothing: for a claim nobody will come back for. → whether it was removed. A claim whose
 *  holder is alive, unknown or unreadable, or that cannot be taken over (cannotBeTakenOver), is
 *  left as it is. Throws what a takeover throws. */
export function removeGoneClaim(path, opts) {
  const holder = readClaim(path);
  if (!holder || holder.unreadable || cannotBeTakenOver(holder, 0)) return false;
  if (processLiveness(holder).state !== "gone") return false;
  takeOver(path, holder, opts, 0, []);
  return readClaim(path)?.nonce !== holder.nonce;
}
