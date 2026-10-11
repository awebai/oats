/** The claim: one file that says which process is doing a thing that must happen once at a time.
 *  One protocol, used by `oats worktree add|remove` (the purpose's claim, lib/worktree.mjs
 *  `withClaim`) and by `oats retire` (the home's claim, lib/core.mjs `retireInstance`).
 *
 *  Unlike lib/dir-lock.mjs, a claim left by a process that died is taken over, so a killed command
 *  can always be run again: the owner is named by pid AND start time (processLiveness), never by a
 *  pid alone, and a holder whose start cannot be read is never taken for gone.
 *
 *  - Taking it: the owner's facts `{ pid, processStart, nonce, at }` are written to a private file
 *    and hard-linked to `path`, which fails if `path` exists. So a claim is never seen without its
 *    owner, and the nonce makes each holding distinct, even for the same process.
 *  - Its owner is alive: waited for up to `waitMs`, then refused (`busy`).
 *  - Its owner is gone (processLiveness "gone"; "unknown" is refused, never taken over): the claim
 *    is removed under a second claim, `<path>.reclaim-<owner nonce>`, taken by this same protocol.
 *    Its holder re-reads `path` and removes it only if it still names that owner. Nothing else
 *    removes another's claim: its owner never releases it, and a new acquirer cannot write over an
 *    existing file. Two takeovers of one dead owner are therefore serialized, and neither removes
 *    a claim made after it read. A takeover cut short leaves its own claim behind, which the next
 *    takeover takes over in turn, up to CLAIM_MAX_DEPTH nested levels.
 *  - A step the holder recorded in its claim (recordInClaim) is ended by a takeover first
 *    (`endHolderStep`), which refuses, keeping the claim, if the step cannot be ended.
 *  - Released by unlinking `path`, only while it still names this holding.
 *  - An unreadable claim file is never removed: the command is refused, naming the file.
 *  - A claim that cannot be taken for a reason of the system's (its directory cannot be made, its
 *    private file cannot be written, the link fails otherwise than because the claim exists) is
 *    refused as E_LIFECYCLE_FAILED (claimUnavailable), never with the system's code
 *    (awebai/oats#874): the claim was not taken, so nothing was done.
 *
 *  Everything is synchronous. What is the caller's own goes in `opts`:
 *    busy(holder, unknown, at)       the refusal for a holder that lives (`unknown` unset) or whose
 *                                    liveness cannot be read (`unknown` is the reason); `at` is the
 *                                    claim file that names it
 *    ownStartUnreadable(reason, at)  the refusal when this process's own start cannot be read, so
 *                                    it could not hold `at` verifiably
 *    unreadableClaim(at)             the refusal for a claim file that does not parse
 *    endHolderStep(holder, at)       optional: end the step a dead holder recorded
 *                                    → { owed?, remedy?, warning?, details? }
 *    waitMs                          how long a live holder is waited for (default CLAIM_WAIT_MS)
 *    warnings                        optional array a takeover's warnings are pushed to */
import { linkSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { processLiveness, processStart } from "./worktree-hooks.mjs";
import { asKernelError } from "./errors.mjs";

export const CLAIM_WAIT_MS = 3000;
const CLAIM_MAX_DEPTH = 8;
const NONCE_RE = /^[0-9a-f]{32}$/;
const pauseSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** The claim at `path` → its record, `{ unreadable: true }` when it does not parse, null when there is none. */
export function readClaim(path) {
  try { const o = JSON.parse(readFileSync(path, "utf8")); return o && typeof o === "object" ? o : { unreadable: true }; }
  catch (e) { return e.code === "ENOENT" ? null : { unreadable: true }; }
}

/** The refusal for a claim `path` that could not be taken because of `e`, an error that is not the
 *  kernel's (one that is, is returned as it is). The caller's command did nothing: it acts only
 *  once it holds its claim. Also for a caller that fails to make the claim's directory. */
export function claimUnavailable(path, e) {
  return asKernelError(e, "E_LIFECYCLE_FAILED", `the claim ${path} could not be taken (${e?.message ?? e}); nothing was done`);
}

/** Take the claim `path` → this holding (`{ pid, processStart, nonce, at }`), to pass to
 *  releaseClaim. Throws the caller's refusal when it cannot be taken, and claimUnavailable for
 *  any error that is not the kernel's. The directory exists. */
export function acquireClaim(path, opts, depth = 0) {
  try { return takeClaim(path, opts, depth); }
  catch (e) { throw claimUnavailable(path, e); }
}
function takeClaim(path, opts, depth) {
  const { busy, waitMs = CLAIM_WAIT_MS } = opts;
  const own = processStart(process.pid);
  if (own.state !== "alive") throw opts.ownStartUnreadable(own.reason ?? `pid ${process.pid} reads as ${own.state}`, path);
  const me = { pid: process.pid, processStart: own.token, nonce: randomBytes(16).toString("hex"), at: new Date().toISOString() };
  const tmp = `${path}.tmp-${process.pid}-${me.nonce}`;
  writeFileSync(tmp, JSON.stringify(me) + "\n", { mode: 0o600 });
  try {
    const deadline = Date.now() + waitMs;
    for (;;) {
      try { linkSync(tmp, path); return me; }
      catch (e) { if (e.code !== "EEXIST") throw e; }
      const holder = readClaim(path);
      if (holder === null) continue; // released in between
      if (holder.unreadable) throw opts.unreadableClaim(path);
      const live = processLiveness(holder);
      // Unreadable is never taken for gone: the claim is kept, and the refusal names the way out.
      if (live.state === "unknown") throw busy(holder, live.reason, path);
      if (live.state === "gone") {
        if (depth >= CLAIM_MAX_DEPTH || typeof holder.nonce !== "string" || !NONCE_RE.test(holder.nonce)) throw busy(holder, null, path);
        takeOver(path, holder, opts, depth);
        continue;
      }
      if (Date.now() >= deadline) throw busy(holder, null, path);
      pauseSync(50);
    }
  } finally {
    try { unlinkSync(tmp); } catch { /* gone */ }
  }
}

/** Remove `path`, held by the dead `holder`, under the claim that serializes takeovers of it. */
function takeOver(path, holder, opts, depth) {
  const reclaim = `${path}.reclaim-${holder.nonce}`;
  const me = acquireClaim(reclaim, opts, depth + 1);
  try {
    const now = readClaim(path);
    if (now?.nonce === holder.nonce) {
      const ended = opts.endHolderStep?.(now, path) ?? {};
      if (ended.owed) {
        const e = opts.busy(now);
        throw Object.assign(e, { message: `${ended.owed}; ${path} is kept and nothing was done — ${ended.remedy}`, details: { ...e.details, ...ended.details } });
      }
      if (ended.warning) opts.warnings?.push(ended.warning);
      unlinkSync(path);
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
 *  holder is alive, unknown or unreadable is left as it is. Throws what a takeover throws. */
export function removeGoneClaim(path, opts) {
  const holder = readClaim(path);
  if (!holder || holder.unreadable || typeof holder.nonce !== "string" || !NONCE_RE.test(holder.nonce)) return false;
  if (processLiveness(holder).state !== "gone") return false;
  takeOver(path, holder, opts, 0);
  return readClaim(path)?.nonce !== holder.nonce;
}
