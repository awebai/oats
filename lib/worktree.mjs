/** `oats worktree add|remove` (#796): the extra trees an instance makes, created the
 *  way the work-mode briefing's raw-git recipe made them, plus the `worktree` event.
 *
 *  A tree is `<home>/.work-<purpose>`. `add` runs, as argument vectors:
 *    git -C <clone> worktree add --detach <tree>
 *    git -C <tree> fetch --refmap= origin <base>
 *    git -C <tree> switch -c <branch> <fetched oid>
 *  so it moves no ref of the clone and starts from the remote's state, never the
 *  clone's checkout. Then it fires every composed capability's `worktree` hook
 *  (lib/worktree-hooks.mjs), records `<home>/.oats/trees/<purpose>.json` and appends
 *  a `worktree-added` event. To retirement the tree is like any raw-git extra tree.
 *
 *  The record is the recovery marker. `creating` (with the adding process's pid and
 *  start time) until the tree is ready; a later `add` or `remove` that finds it with
 *  that process gone finishes the rollback first. `ready` makes `add` a no-op.
 *
 *  Every user value is checked before any write (amendment A1): no leading `-`, a
 *  purpose in the instance-name grammar, the branch and base valid branch names; each
 *  is passed after `--end-of-options` where the git subcommand honours it. The
 *  remote URL is recorded, printed and handed to hooks without userinfo (A2). */
import { execFileSync, spawn as spawnChild, spawnSync } from "node:child_process";
import { existsSync, linkSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { oatsError } from "./errors.mjs";
import { appendEvent } from "./instance-events.mjs";
import { recordedTeams } from "./teams.mjs";
import { canonicalCloneKey, memberCloneOf } from "./instance-resolution.mjs";
import { loadLocal } from "./workspace.mjs";
import { GIT_FETCH_TIMEOUT_MS } from "./remote.mjs";
import { randomBytes } from "node:crypto";
import { terminateGroup, watchGroup } from "./process-group.mjs";
import {
  cloneOfMember, instanceSoulDir, isCapturedHome, isWorkspaceHome, capturedHomeRefusal, preWorkspaceHome, lifecycleHookEnv,
  retirePendingMarkerPath, stableSoulId, workspaceOf,
} from "./core.mjs";
import {
  endOwnGroupSync, interruptExitStatus, processStartToken, runWorktreeHooks, scrubRemoteUrl, selfIdentity, signalGuard, terminateRecordedGroup, treeStillThere,
  processLiveness, unverifiedGroupWarning, verifiedAlive, worktreeHooksOf,
} from "./worktree-hooks.mjs";

const PURPOSE_RE = /^[a-z0-9][a-z0-9-]*$/; // the instance-name grammar (lib/core.mjs INSTANCE_NAME_RE)
const PURPOSE_MAX = 64;
const RECORD_VERSION = 1;

/** The fetch's timeout: the kernel's (GIT_FETCH_TIMEOUT_MS, 10 minutes), or the test seam
 *  OATS_TEST_WORKTREE_FETCH_TIMEOUT_MS (a positive integer of milliseconds; not a setting). */
export function worktreeFetchTimeoutMs(env = process.env) {
  const seam = Number(env.OATS_TEST_WORKTREE_FETCH_TIMEOUT_MS);
  return Number.isSafeInteger(seam) && seam > 0 ? seam : GIT_FETCH_TIMEOUT_MS;
}
/** The git environment of every step: the invoker's, never prompting for credentials. */
const gitEnv = () => ({ ...process.env, GIT_TERMINAL_PROMPT: "0" });
/** Run git → { ok, out, err, status }. Never a shell. */
function git(argv, { timeout = 120_000 } = {}) {
  const r = spawnSync("git", argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: gitEnv(), timeout, maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0 && !r.error, out: String(r.stdout ?? ""), err: String(r.stderr ?? "").trim() || r.error?.message || "", status: r.status };
}
/** Run a git step that changes something (a tree, a ref, the worktree list) as a recorded child:
 *  → Promise<{ ok, out, err, status }>. A parent killed outright does not take its git with it, and
 *  a recovery that went ahead while that git still ran could see it finish late, on the tree or
 *  branch the recovery just made. So the step starts in its own process group, held in
 *  `read` before git exists; `track({ gitPid, gitStart })` records it (in the purpose's claim or
 *  the tree record) and only then is it released to `exec git`. A parent killed before that
 *  closes the step's stdin, and git never runs. A recovery ends a recorded git that still runs
 *  (endRecordedGit) before it acts. `track(null)` clears it once git has exited and, after a
 *  timeout, once its whole group is verified gone; a group that survives SIGKILL rejects with
 *  E_LIFECYCLE_BUSY (`keepClaim`), leaving the identity recorded for the next command. Exported for its tests. */
export function trackedGit(argv, { track, timeout = 120_000 }) {
  return new Promise((resolve, fail) => {
    let child;
    try {
      child = spawnChild("/bin/sh", ["-c", 'read _ || exit 125; exec git "$@"', "oats-git", ...argv], { detached: true, stdio: ["pipe", "pipe", "pipe"], env: gitEnv() });
    } catch (e) { resolve({ ok: false, out: "", err: `git could not be started: ${e.message}`, status: null }); return; }
    watchGroup(child);
    let out = "", err = "", tracked = false, timedOut = false, settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
    child.stdout.on("data", (c) => { out += c; });
    child.stderr.on("data", (c) => { err += c; });
    child.stdin.on("error", () => { /* the step ended before reading */ });
    child.on("error", (e) => done({ ok: false, out, err: `git could not be started: ${e.message}`, status: null }));
    const gitStart = child.pid ? processStartToken(child.pid) : null;
    let trackError = null;
    if (gitStart) { try { track({ gitPid: child.pid, gitStart }); tracked = true; } catch (e) { trackError = e; } }
    child.stdin.end(tracked ? "\n" : "");
    const timer = setTimeout(() => { timedOut = true; terminateGroup(child); }, timeout);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      // A timed-out step's group is ended for certain before its identity is cleared: terminateGroup's
      // SIGKILL is an unref'd timer this process may exit before, and a member that ignores SIGTERM and
      // holds no pipe would outlive it. One that survives SIGKILL keeps its identity recorded, and the
      // command stops here (keepClaim: the claim holding it is not released).
      if (timedOut && tracked && endOwnGroupSync(child.pid) === "survived") {
        return fail(Object.assign(oatsError("E_LIFECYCLE_BUSY", `a git step that timed out could not be ended (process group ${child.pid} survived SIGKILL); it stays recorded, and nothing more was done — end that process, then retry`), { details: { gitPid: child.pid }, keepClaim: true }));
      }
      if (!tracked) return done({ ok: false, out: "", err: `the git step was not run: ${trackError ? `its process could not be recorded (${trackError.message})` : "its start time could not be read"}`, status: null });
      try { track(null); } catch { /* the record or claim is gone: nothing left to clear */ }
      done({ ok: code === 0, out, err: err.trim() || (timedOut ? `timed out after ${Math.round(timeout / 1000)} s` : signal ? `ended by ${signal}` : ""), status: code });
    });
  });
}

/** End the git step a dead holder recorded (`{ gitPid, gitStart }`), only when its leader runs with
 *  the recorded start time (terminateRecordedGroup): SIGTERM, which git answers by removing its lock
 *  files, then SIGKILL. → { owed?, warning? }. */
function endRecordedGit(holder) {
  if (!holder?.gitPid) return {};
  const ended = terminateRecordedGroup({ hookPgid: holder.gitPid, hookStart: holder.gitStart });
  if (ended === "survived") return { owed: `git process group ${holder.gitPid}, left running by a killed oats worktree command, survived SIGKILL` };
  if (ended === "unverified") return { warning: unverifiedGroupWarning(holder.gitPid, "git") };
  return {};
}

const firstLine = (text) => String(text).split("\n").map((l) => l.trim()).find((l) => /^(fatal|error):/.test(l)) ?? String(text).split("\n").map((l) => l.trim()).find(Boolean) ?? "";

export const treeRecordPath = (home, purpose) => join(home, ".oats", "trees", `${purpose}.json`);
export const extraTreePath = (home, purpose) => join(home, `.work-${purpose}`);

// ---------- arguments ----------

function badArgs(message, details) { return Object.assign(oatsError("E_BAD_ARGS", message), details ? { details } : {}); }

/** A1: refuse what git could read as an option, and anything not a valid name, before any write. */
export function validateTreeArgs({ purpose, branch, base }, { forRemove = false } = {}) {
  const check = (flag, value) => {
    if (typeof value !== "string" || !value) throw badArgs(`--${flag} needs a value`);
    if (value.startsWith("-")) throw badArgs(`--${flag} ${JSON.stringify(value)} starts with "-", which git would read as an option; nothing was done`, { flag: `--${flag}` });
  };
  check("purpose", purpose);
  if (!PURPOSE_RE.test(purpose) || purpose.length > PURPOSE_MAX) throw badArgs(`--purpose ${JSON.stringify(purpose)} must be a slug: lowercase letters, digits and "-", starting with a letter or digit, at most ${PURPOSE_MAX} characters`, { flag: "--purpose" });
  if (forRemove) return;
  check("branch", branch);
  check("base", base);
  for (const [flag, value] of [["branch", branch], ["base", base]]) {
    // `@{-N}` is a previous-branch shorthand check-ref-format --branch would expand: never a name here.
    if (value.includes("@{")) throw badArgs(`--${flag} ${JSON.stringify(value)} is not a branch name`, { flag: `--${flag}` });
    // check-ref-format honours no --end-of-options; the leading "-" refusal above is what keeps the value a value.
    const r = git(["check-ref-format", "--branch", value]);
    if (!r.ok) throw badArgs(`--${flag} ${JSON.stringify(value)} is not a valid branch name (git check-ref-format --branch)`, { flag: `--${flag}` });
  }
}

// ---------- the home ----------

/** The instance home `oats worktree` acts in, read and checked: a workspace-model home, not
 *  quarantined or being retired. → { home, meta }. */
export function readTreeHome(home) {
  if (typeof home !== "string" || !isAbsolute(home)) throw badArgs("oats worktree runs from an instance home (in the home, or with $OATS_INSTANCE_HOME set to it)");
  let meta;
  try { meta = JSON.parse(readFileSync(join(home, "instance.json"), "utf8")); }
  catch { throw badArgs(`${home} is not an instance home (no readable instance.json); oats worktree runs from an instance home`); }
  if (isCapturedHome(meta)) throw capturedHomeRefusal(home, "no tree was made");
  if (!isWorkspaceHome(meta)) throw preWorkspaceHome(home, "no tree was made");
  if (existsSync(join(home, ".oats-rollback-incomplete.json"))) throw oatsError("E_INSTANCE_RETIRING", `${home} is a quarantined home (or a spawn still in progress); finish its retirement (oats retire) before making trees in it`);
  if (existsSync(retirePendingMarkerPath(home))) throw oatsError("E_INSTANCE_RETIRING", `${basename(home)} is being retired; no tree was made`);
  return { home, meta };
}

// ---------- the clone ----------

/** `--repo` → { clone (canonical, the main worktree or the bare repository), member (key or "") }.
 *  Default: the instance's repository. A key resolves through the kernel's clone lookup
 *  (oats-local.yaml clones:, then <deployment>/<member name>); a path through realpath. */
export function resolveTreeClone(meta, repo) {
  let path, member = "";
  if (repo === undefined) {
    if (typeof meta.repo !== "string" || !meta.repo) throw oatsError("E_CLONE_MISSING", "this instance records no repository; pass --repo <member key|clone path>");
    path = meta.repo;
    const key = meta.workspace?.soul?.repoKey;
    if (typeof key === "string" && key && cloneOfMember(path, key)) member = key;
  } else if (isAbsolute(repo) || repo.startsWith(".") || repo.startsWith("~")) {
    path = repo.startsWith("~") ? join(process.env.HOME ?? "", repo.slice(1)) : resolve(repo);
  } else {
    const key = canonicalCloneKey(repo);
    const deployment = meta.workspace?.deployment;
    if (typeof deployment !== "string" || !deployment) throw oatsError("E_CLONE_MISSING", `--repo ${repo}: this home records no deployment to look its clone up in; pass a clone path instead`);
    let local = {};
    try { local = loadLocal(deployment)?.local ?? {}; } catch (e) { throw Object.assign(oatsError(e.code || "E_CONFIG_BROKEN", e.message), { details: e.details }); }
    const found = memberCloneOf(deployment, local, key);
    if (!found.path) throw Object.assign(oatsError("E_CLONE_MISSING", `--repo ${repo}: this machine has no clone of ${key} — clone it to <deployment>/<member name> or name it in oats-local.yaml clones: { ${key}: <abs path> }; or pass a clone path`), { details: { repoKey: key, deployment } });
    path = found.path;
    member = key;
  }
  let real;
  try { real = realpathSync(path); if (!statSync(real).isDirectory()) throw new Error("not a directory"); }
  catch { throw Object.assign(oatsError("E_CLONE_MISSING", `${path} is not a Git repository (it does not exist or is not a directory); pass --repo <clone>`), { details: { path } }); }
  const dirs = git(["-C", real, "rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir", "--is-bare-repository"]);
  if (!dirs.ok) throw Object.assign(oatsError("E_CLONE_MISSING", `${real} is not a Git repository (${firstLine(dirs.err)})`), { details: { path: real } });
  const [gitDir, commonDir, bare] = dirs.out.trim().split("\n");
  if (realpathOr(gitDir) !== realpathOr(commonDir)) throw Object.assign(oatsError("E_CLONE_MISMATCH", `${real} is a linked worktree, not a clone; trees are added from the clone itself (its main worktree)`), { details: { path: real } });
  let clone = realpathOr(commonDir);
  if (bare !== "true") {
    const top = git(["-C", real, "rev-parse", "--path-format=absolute", "--show-toplevel"]);
    if (!top.ok) throw Object.assign(oatsError("E_CLONE_MISSING", `${real} is not a Git work tree (${firstLine(top.err)})`), { details: { path: real } });
    clone = realpathOr(top.out.trim());
  }
  const origin = git(["-C", clone, "remote", "get-url", "--end-of-options", "origin"]);
  if (!origin.ok || !origin.out.trim()) throw Object.assign(oatsError("E_CLONE_MISMATCH", `${clone} has no "origin" remote; a tree starts from origin's branch`), { details: { path: clone } });
  return { clone, member, remote: scrubRemoteUrl(origin.out.trim()) };
}
const realpathOr = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };

// ---------- the record ----------

function readRecord(path) {
  if (!existsSync(path)) return null;
  try {
    const r = JSON.parse(readFileSync(path, "utf8"));
    if (r && typeof r === "object" && ["creating", "ready"].includes(r.state)) return r;
  } catch { /* below */ }
  return { state: "unreadable" };
}
function writeRecord(path, rec) {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(rec, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, path);
}
/** Create the record only if none exists (two concurrent adds: one wins, the other sees it). */
function createRecord(path, rec) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(rec, null, 2) + "\n", { mode: 0o600 });
  try { linkSync(tmp, path); }
  catch (e) { if (e.code === "EEXIST") throw oatsError("E_LIFECYCLE_BUSY", `another oats worktree add of purpose ${rec.purpose} started at the same moment; nothing was done`); throw e; }
  finally { try { unlinkSync(tmp); } catch { /* gone */ } }
}

// ---------- rollback ----------

/** Whether this add created its branch: the record says so (`branchCreated`, written as soon as
 *  `git switch -c` returned), or — for a kill in between — the tree itself is a worktree whose HEAD
 *  is that branch, which only this add's switch can have made it. A branch that matches `baseOid`
 *  proves nothing: another add may have created the same name at the same base. */
function addCreatedBranch(rec, tree) {
  if (rec.branchCreated === true) return true;
  if (!existsSync(tree)) return false;
  const top = git(["-C", tree, "rev-parse", "--path-format=absolute", "--show-toplevel"]);
  if (!top.ok || realpathOr(top.out.trim()) !== realpathOr(tree)) return false;
  const head = git(["-C", tree, "symbolic-ref", "--quiet", "HEAD"]);
  return head.ok && head.out.trim() === `refs/heads/${rec.branch}`;
}

/** Undo an add from its record: end a hook group a killed adder left (only when it is
 *  verifiably that group), remove the tree, prune, verify it is gone, delete the branch only
 *  when this add created it, nothing has it checked out and it still points where the add
 *  created it, and drop the record.
 *  Its own git steps are recorded through `track` (trackedGit): in the claim for a recovery, in the
 *  tree record for the adder's own rollback.
 *  → { owed, warnings, branchDeleted, branchKept, branchKeptReason? }: `owed` is [] when all of
 *  that is verified, else what is still owed (the record is then kept, so the next add or remove
 *  tries again); a branch kept on purpose is not owed. `branchKept`: the branch exists afterwards. */
export async function rollbackTree(home, rec, { track }) {
  const owed = [], warnings = [];
  const tree = extraTreePath(home, rec.purpose);
  if (rec.hookPgid) {
    const ended = terminateRecordedGroup(rec);
    if (ended === "survived") owed.push(`hook process group ${rec.hookPgid} survived SIGKILL`);
    if (ended === "unverified") warnings.push(unverifiedGroupWarning(rec.hookPgid));
  }
  // A git step the killed adder left running is ended before anything is touched; one that cannot be
  // ended stops the rollback, since it may still change the tree or the branch.
  const git0 = endRecordedGit(rec);
  if (git0.warning) warnings.push(git0.warning);
  if (git0.owed) return { owed: [git0.owed], warnings, branchDeleted: false };
  const ownsBranch = typeof rec.branch === "string" && rec.branch && addCreatedBranch(rec, tree);
  const clone = rec.clone;
  let registered = false, list = null;
  if (typeof clone === "string" && clone) {
    if (existsSync(tree)) await trackedGit(["-C", clone, "worktree", "remove", "--force", "--end-of-options", tree], { track });
    await trackedGit(["-C", clone, "worktree", "prune"], { track });
    list = git(["-C", clone, "worktree", "list", "--porcelain", "-z"]);
    if (!list.ok) owed.push(`git worktree ${tree}: could not verify removal (${firstLine(list.err)})`);
    else {
      const treeReal = realpathOr(tree);
      registered = worktreeFields(list.out, "worktree").map(realpathOr).includes(treeReal);
      if (registered) owed.push(`git worktree ${tree}: still registered`);
    }
  }
  // A directory left at the path while a `creating` record held it is this add's own (git worktree add
  // made it, or failed half-way): never a symlink, which is not followed.
  if (!registered) {
    try { const st = lstatSync(tree); if (st.isDirectory()) rmSync(tree, { recursive: true, force: true }); } catch { /* not there */ }
    if (existsSync(tree)) owed.push(`${tree}: still present`);
  }
  let branchDeleted = false, branchKept = false, branchKeptReason;
  if (typeof rec.branch === "string" && rec.branch && typeof clone === "string" && clone) {
    const ref = `refs/heads/${rec.branch}`;
    const before = git(["-C", clone, "rev-parse", "--verify", "--quiet", "--end-of-options", ref]);
    branchKept = true;
    if (!before.ok && before.status === 1 && !before.err) branchKept = false; // never made, or already gone
    else if (!before.ok) owed.push(`git branch ${rec.branch}: could not be read (${firstLine(before.err) || `exit ${before.status}`})`);
    else if (!ownsBranch) branchKeptReason = "this add's creation of it is not proven (another add, or a kill inside git switch, may have made it)";
    else if (typeof rec.baseOid !== "string" || !rec.baseOid) branchKeptReason = "the record names no base commit to compare it with";
    else if (!list?.ok) branchKeptReason = "whether it is checked out could not be read";
    else if (worktreeFields(list.out, "branch").includes(ref)) branchKeptReason = "it is checked out in a worktree";
    else {
      await trackedGit(["-C", clone, "update-ref", "-d", ref, rec.baseOid], { track });
      const left = git(["-C", clone, "rev-parse", "--verify", "--quiet", "--end-of-options", ref]);
      if (!left.ok && left.status === 1 && !left.err) { branchDeleted = true; branchKept = false; }
      else if (!left.ok) owed.push(`git branch ${rec.branch}: could not verify deletion (${firstLine(left.err) || `exit ${left.status}`})`);
      else if (left.out.trim() !== rec.baseOid) branchKeptReason = `its tip moved from ${rec.baseOid.slice(0, 12)}, where this add created it`;
      else owed.push(`git branch ${rec.branch}: still exists`);
    }
  }
  if (!owed.length) rmSync(treeRecordPath(home, rec.purpose), { force: true });
  return { owed, warnings, branchDeleted, branchKept, ...(branchKept && branchKeptReason ? { branchKeptReason } : {}) };
}
/** The values of one field (`worktree`, `branch`) across `git worktree list --porcelain -z`. */
const worktreeFields = (out, field) => out.split("\0").filter((f) => f.startsWith(`${field} `)).map((f) => f.slice(field.length + 1));

// ---------- the claim ----------

/** Run `fn` holding the purpose's claim (`<home>/.oats/trees/<purpose>.lock`): every read of a
 *  record that may lead to recovering it, every rollback a recovery does, every record an add
 *  creates and every removal happens under it, so two recoveries never act on the same snapshot
 *  and a recovery never acts on a tree made after it read. A live adder's own record is left to it
 *  (others refuse it as busy), so the claim is not held while hooks run.
 *
 *  Unlike lib/dir-lock.mjs, a claim left by a process that died (SIGKILL in the middle of a
 *  recovery) is taken over, so a killed command can always be run again: the owner is named by
 *  pid AND start time (processLiveness), never by a pid alone, and a holder whose start cannot be
 *  read is never taken for gone. A claim held by a live process is
 *  waited for up to `CLAIM_WAIT_MS`, then refused as E_LIFECYCLE_BUSY. The holder's git steps
 *  are recorded in the claim (trackedGit), and a takeover ends one still running first: a dead
 *  holder's git never finishes late on a tree made after the takeover.
 *  `fn({ track, warnings })`; → Promise of what `fn` returns. */
function withPurposeClaim(home, purpose, fn) {
  const dir = join(home, ".oats", "trees");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lock = join(dir, `${purpose}.lock`);
  const busy = (holder, unknown, at = lock) => Object.assign(oatsError("E_LIFECYCLE_BUSY", unknown
    ? `whether pid ${holder?.pid ?? "?"} (recorded start ${holder?.processStart ?? "none"}), which holds ${at}, still runs cannot be read (${unknown}); nothing was done — check that pid by hand, and if it is not an oats worktree command, remove ${at}, then retry`
    : `another oats worktree add or remove of purpose ${purpose} is running (pid ${holder?.pid ?? "?"} holds ${at}); nothing was done — retry when it has finished`), { details: { purpose, lock: at, ...(holder?.pid ? { pid: holder.pid } : {}), ...(unknown ? { unknown } : {}) } });
  return withClaim(lock, fn, { busy });
}

const CLAIM_WAIT_MS = 3000;
const CLAIM_MAX_DEPTH = 8;
const pauseSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function readClaim(path) {
  try { const o = JSON.parse(readFileSync(path, "utf8")); return o && typeof o === "object" ? o : { unreadable: true }; }
  catch (e) { return e.code === "ENOENT" ? null : { unreadable: true }; }
}

/** Run `fn` holding the claim file `path`. Exported for its tests.
 *
 *  - Taking it: the owner's facts `{ pid, processStart, nonce }` are written to a private file and
 *    hard-linked to `path`, which fails if `path` exists. So a claim is never seen without its
 *    owner, and the nonce makes each holding distinct, even for the same process.
 *  - Its owner is gone (processLiveness "gone"; "unknown" is refused, never taken over): the claim
 *    is removed under a second claim,
 *    `<path>.reclaim-<owner nonce>`, taken by this same protocol. Its holder re-reads `path` and
 *    removes it only if it still names that owner. Nothing else removes another's claim: its
 *    owner never releases it, and a new acquirer cannot write over an existing file. Two takeovers
 *    of one dead owner are therefore serialized, and neither removes a claim made after it read.
 *    A takeover cut short leaves its own claim behind, which the next takeover takes over in
 *    turn, up to CLAIM_MAX_DEPTH nested levels.
 *  - The holder's running git step (`gitPid`, `gitStart`; trackedGit) is in the claim. A takeover
 *    ends it first (endRecordedGit) and refuses, keeping the claim, if it cannot be ended.
 *  - Released by unlinking `path`, only while it still names this holding.
 *  - An unreadable claim file is never removed: the command is refused as busy, naming the file. */
export async function withClaim(path, fn, { busy, waitMs = CLAIM_WAIT_MS } = {}) {
  const warnings = [];
  const me = acquireClaim(path, { busy, waitMs, warnings }, 0);
  // Record (or clear) the holder's running git step in the claim; only its live holder writes it.
  const track = (gitStep) => {
    const tmp = `${path}.tmp-${process.pid}-${me.nonce}`;
    writeFileSync(tmp, JSON.stringify({ ...me, ...(gitStep ?? {}) }) + "\n", { mode: 0o600 });
    renameSync(tmp, path);
  };
  let keep = false;
  try { return await fn({ track, warnings }); }
  catch (e) { keep = e?.keepClaim === true; throw e; }
  finally { if (!keep) releaseClaim(path, me); }
}

function acquireClaim(path, opts, depth) {
  const { busy, waitMs } = opts;
  const self = selfIdentity();
  if (!self.processStart) throw Object.assign(busy(null), { message: `this process's start time cannot be read, so it cannot hold ${path} verifiably; nothing was done` });
  const me = { ...self, nonce: randomBytes(16).toString("hex"), at: new Date().toISOString() };
  const tmp = `${path}.tmp-${process.pid}-${me.nonce}`;
  writeFileSync(tmp, JSON.stringify(me) + "\n", { mode: 0o600 });
  try {
    const deadline = Date.now() + waitMs;
    for (;;) {
      try { linkSync(tmp, path); return me; }
      catch (e) { if (e.code !== "EEXIST") throw e; }
      const holder = readClaim(path);
      if (holder === null) continue; // released in between
      if (holder.unreadable) throw Object.assign(busy(null), { message: `${path} is not a readable claim; inspect it and remove it if no oats worktree command holds it; nothing was done` });
      const live = processLiveness(holder);
      // Unreadable is never taken for gone: the claim is kept, and the refusal names the way out.
      if (live.state === "unknown") throw busy(holder, live.reason, path);
      if (live.state === "gone") {
        if (depth >= CLAIM_MAX_DEPTH || typeof holder.nonce !== "string" || !/^[0-9a-f]{32}$/.test(holder.nonce)) throw busy(holder, null, path);
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
      const ended = endRecordedGit(now);
      if (ended.owed) throw Object.assign(opts.busy(now), { message: `${ended.owed}; ${path} is kept and nothing was done — end that process, then retry` });
      if (ended.warning) opts.warnings?.push(ended.warning);
      unlinkSync(path);
    }
  } finally {
    releaseClaim(reclaim, me);
  }
}

function releaseClaim(path, me) {
  if (readClaim(path)?.nonce === me.nonce) { try { unlinkSync(path); } catch { /* gone */ } }
}

/** A `creating` record whose adder may still run: its start cannot be read. Never rolled back on
 *  that; the refusal names the pid and the record's exact path, the way out once the pid is
 *  checked by hand. */
function unknownAdderRefusal({ purpose, tree, recPath, rec, reason }) {
  return Object.assign(oatsError("E_LIFECYCLE_BUSY", `whether the oats worktree add of purpose ${purpose} (pid ${rec.pid}, recorded start ${rec.processStart ?? "none"}) still runs cannot be read (${reason}); nothing was done — check that pid by hand, and if it is not an oats worktree add, remove ${recPath}, then remove what that add left (the tree ${tree}: git worktree remove --force ${tree}; the branch ${rec.branch}, if it holds nothing of yours) and retry`), { details: { purpose, path: tree, record: recPath, pid: rec.pid, unknown: reason } });
}

// ---------- add ----------

/** The hook context of a home, as its other lifecycle hooks get it. */
function hookContext(home, meta) {
  const root = dirname(dirname(dirname(home)));
  const ws = meta.workspace && typeof meta.workspace === "object" ? meta.workspace : {};
  const t = recordedTeams(meta);
  const soulDir = instanceSoulDir(home, meta);
  return {
    home, instance: meta.instance ?? basename(home), agentName: meta.agent, soulDir,
    soulId: stableSoulId({ home, soulDir, agentName: meta.agent }), contextDir: meta.repo ?? "", workspaceDir: workspaceOf(root), rootDir: root,
    resolved: { workspace: { key: ws.key, name: ws.name, deployment: ws.deployment }, teams: t.teams, defaultTeam: t.defaultTeam, teamsSource: "recorded" },
    priorMeta: meta.capabilityMeta && typeof meta.capabilityMeta === "object" ? meta.capabilityMeta : {},
  };
}

const sameRecordFields = (rec, want) => ["clone", "branch", "base"].filter((k) => rec[k] !== want[k]);
const publicReceipt = (rec, extra = {}) => ({
  purpose: rec.purpose, path: rec.path, clone: rec.clone, remote: rec.remote, member: rec.member || null, branch: rec.branch, base: rec.base,
  baseOid: rec.baseOid ?? null, state: rec.state, hooks: rec.hooks ?? [], ...(rec.treeMissing ? { treeMissing: true } : {}), record: extra.record, ...extra,
});

/** `oats worktree add`. `o`: { purpose, branch, base, repo?, preview?, stream? }.
 *  → the receipt ({ ..., resumed }) or, with preview, the plan. Throws typed errors. */
export async function worktreeAdd(homeArg, o = {}) {
  validateTreeArgs(o);
  const { home, meta } = readTreeHome(homeArg);
  const { purpose, branch, base } = o;
  const recPath = treeRecordPath(home, purpose);
  const tree = extraTreePath(home, purpose);
  const { clone, member, remote } = resolveTreeClone(meta, o.repo);
  const hooks = worktreeHooksOf(meta.capabilityRuntime);
  const want = { clone, branch, base };
  const unknownAdder = (found, reason) => unknownAdderRefusal({ purpose, tree, recPath, rec: found, reason });
  // What the record says, read under the claim when this add acts on it (the preview only reads).
  const decide = () => {
    const found = readRecord(recPath);
    if (found?.state === "unreadable") throw Object.assign(oatsError("E_PLACEMENT_TAKEN", `${recPath} is not a readable tree record; inspect it (and the tree at ${tree}), remove what is not yours, then retry`), { details: { purpose, path: tree, record: recPath } });
    if (found?.state === "creating") {
      const live = processLiveness(found);
      if (live.state === "alive") throw Object.assign(oatsError("E_LIFECYCLE_BUSY", `an oats worktree add of purpose ${purpose} is still running (pid ${found.pid}, since ${found.startedAt}); nothing was done`), { details: { purpose, path: tree, pid: found.pid } });
      if (live.state === "unknown") throw unknownAdder(found, live.reason);
      return { recover: found };
    }
    if (found?.state === "ready") {
      const differ = sameRecordFields(found, want);
      if (differ.length) throw Object.assign(oatsError("E_PLACEMENT_TAKEN", `the tree of purpose ${purpose} exists with a different ${differ.join(", ")} (${differ.map((k) => `${k}: ${found[k]}, asked ${want[k]}`).join("; ")}); use another --purpose, or \`oats worktree remove --purpose ${purpose}\` first`), { details: { purpose, path: tree, differ, record: recPath } });
      return { ready: found };
    }
    checkFresh();
    return {};
  };
  // A fresh add: the path is free and the branch does not exist.
  const checkFresh = (after = "") => {
    let st; try { st = lstatSync(tree); } catch { /* free */ }
    if (st) throw Object.assign(oatsError("E_PLACEMENT_TAKEN", after ? `${tree} is still there ${after}; remove it yourself, then retry`
      : st.isSymbolicLink() || !st.isDirectory()
      ? `${tree} exists and is ${st.isSymbolicLink() ? "a symbolic link" : "not a directory"}; it is never followed or replaced — use another --purpose`
      : `${tree} exists and no oats worktree add made it (no record); use another --purpose, or remove that tree yourself (git worktree remove ${tree})`), { details: { purpose, path: tree } });
    const exists = git(["-C", clone, "rev-parse", "--verify", "--quiet", "--end-of-options", `refs/heads/${branch}`]);
    if (exists.ok) throw Object.assign(oatsError("E_BRANCH_EXISTS", `branch ${branch} already exists in ${clone}; a tree never reuses or resets a branch — name another, e.g. ${meta.instance ?? basename(home)}/${branch}`), { details: { branch, clone, remedy: `${meta.instance ?? basename(home)}/${branch}` } });
  };

  if (o.preview) {
    const d = decide();
    if (d.ready) return { preview: true, ...publicReceipt(d.ready, { record: recPath }), resume: "noop", hooksToRun: [] };
    return { preview: true, purpose, path: tree, clone, remote, member: member || null, branch, base, record: recPath, resume: d.recover ? "recover" : null,
      hooks: hooks.map((h) => ({ capability: h.id, required: h.required })) };
  }
  let rec;
  const claimed = await withPurposeClaim(home, purpose, async ({ track, warnings: claimWarnings }) => {
    const d = decide();
    if (d.ready) return publicReceipt(d.ready, { record: recPath, resumed: true, warnings: existsSync(tree) ? [] : [`the recorded tree ${tree} is no longer there; \`oats worktree remove --purpose ${purpose}\` drops the record`] });
    const recoveryWarnings = [...claimWarnings];
    if (d.recover) {
      const rb = await rollbackTree(home, d.recover, { track });
      recoveryWarnings.push(...rb.warnings);
      if (rb.owed.length) throw Object.assign(oatsError("E_LIFECYCLE_BUSY", `an earlier oats worktree add of purpose ${purpose} was interrupted and its rollback could not be completed: ${rb.owed.join("; ")}; nothing new was done`), { details: { purpose, path: tree, owed: rb.owed, ...(rb.warnings.length ? { warnings: rb.warnings } : {}) } });
      checkFresh("after the rollback of an interrupted add");
    }
    rec = { version: RECORD_VERSION, purpose, state: "creating", path: tree, clone, remote, member, branch, base, ...selfIdentity(), startedAt: new Date().toISOString() };
    createRecord(recPath, rec);
    return { recoveryWarnings };
  });
  if (!claimed.recoveryWarnings) return claimed;
  const { recoveryWarnings } = claimed;
  // This add's own git steps are recorded in its record (trackedGit), for a recovery after a SIGKILL.
  const track = (gitStep) => {
    const { gitPid: _gp, gitStart: _gs, ...rest } = rec;
    rec = gitStep ? { ...rest, ...gitStep } : rest;
    writeRecord(recPath, rec);
  };
  const fail = async (code, message, details = {}) => {
    const rb = await rollbackTree(home, rec, { track });
    const kept = rb.branchKept ? `; branch ${branch} kept${rb.branchKeptReason ? ` (${rb.branchKeptReason})` : ""}` : "";
    const note = rb.owed.length ? ` — rollback INCOMPLETE (${rb.owed.join("; ")}); the record ${recPath} is kept, and the next oats worktree add or remove of this purpose finishes it` : ` — the tree was removed${kept}`;
    const warned = [...recoveryWarnings, ...rb.warnings];
    return Object.assign(oatsError(code, `${message}${note}`), { details: { purpose, path: tree, rolledBack: rb.owed.length === 0, branchKept: rb.branchKept, ...(rb.branchKeptReason ? { branchKeptReason: rb.branchKeptReason } : {}), ...(rb.owed.length ? { owed: rb.owed } : {}), ...(warned.length ? { warnings: warned } : {}), ...details } });
  };

  const add = await trackedGit(["-C", clone, "worktree", "add", "--detach", "--end-of-options", tree], { track });
  if (!add.ok) throw await fail("E_GIT_FAILED", `git worktree add failed in ${clone}: ${firstLine(add.err) || "unknown error"}`);
  const treeReal = realpathOr(tree);
  const fetch = await trackedGit(["-C", tree, "fetch", "--refmap=", "--end-of-options", "origin", base], { track, timeout: worktreeFetchTimeoutMs() });
  if (!fetch.ok) throw await fail("E_REMOTE_UNREADABLE", `cannot fetch ${base} from origin (${remote}): ${firstLine(fetch.err) || "timeout"}`, { base, remote });
  const fetched = git(["-C", tree, "rev-parse", "--verify", "--quiet", "FETCH_HEAD^{commit}"]);
  const oid = fetched.out.trim();
  if (!fetched.ok || !/^[0-9a-f]{40,64}$/.test(oid)) throw await fail("E_BASE_UNKNOWN", `the fetch of ${base} from origin left no commit in FETCH_HEAD`, { base });
  rec = { ...rec, baseOid: oid };
  writeRecord(recPath, rec); // before the branch exists: a rollback deletes it only at this oid, and only if this add made it
  const sw = await trackedGit(["-C", tree, "switch", "--no-guess", "-c", branch, "--end-of-options", oid], { track });
  if (!sw.ok) {
    // Another add created the branch first (the precheck passed for both): that is E_BRANCH_EXISTS; any other failure is git's.
    const taken = git(["-C", clone, "rev-parse", "--verify", "--quiet", "--end-of-options", `refs/heads/${branch}`]).ok;
    if (taken) throw await fail("E_BRANCH_EXISTS", `git switch -c ${branch} failed: ${firstLine(sw.err)}`, { branch });
    throw await fail("E_GIT_FAILED", `git switch failed in ${tree}: ${firstLine(sw.err) || "unknown error"}`, { branch });
  }
  rec = { ...rec, branchCreated: true };
  writeRecord(recPath, rec); // a kill before this line is covered by the tree's own HEAD (addCreatedBranch)
  const head = git(["-C", tree, "rev-parse", "--verify", "HEAD"]).out.trim();
  if (head !== oid) throw await fail("E_BASE_UNKNOWN", `HEAD of the new tree is ${head || "unreadable"}, not the fetched commit ${oid} of ${base}`, { base, head: head || null, fetched: oid });

  const env = { OATS_TREE: treeReal, OATS_TREE_CLONE: clone, OATS_TREE_REMOTE: remote, OATS_TREE_MEMBER: member, OATS_BRANCH: branch, OATS_TREE_BASE: base, OATS_TREE_BASE_OID: oid, OATS_PURPOSE: purpose, OATS_TREE_ORIGIN: "add" };
  const ctx = hookContext(home, meta);
  const warnings = [...recoveryWarnings];
  let run = { receipt: [], failures: [], warnings: [], interrupted: null };
  if (hooks.length) {
    const guard = signalGuard();
    try {
      run = await runWorktreeHooks(hooks, {
        envFor: (cap) => lifecycleHookEnv("worktree", cap, { ...ctx, extraEnv: env }),
        cwd: treeReal, home, purpose, stream: o.stream !== false, guard,
        onStart: ({ pgid, hookStart }) => { rec = { ...rec, hookPgid: pgid, hookStart }; writeRecord(recPath, rec); },
      });
      warnings.push(...run.warnings);
      if (run.interrupted) {
        throw Object.assign(await fail("E_INTERRUPTED", `oats worktree add was interrupted by ${run.interrupted} while the worktree hooks ran; the running hook's process group was ended`, { signal: run.interrupted, hooks: run.receipt }), { exitStatus: interruptExitStatus(run.interrupted) });
      }
      let treeMissing = false;
      if (!treeStillThere(treeReal)) {
        const msg = `the tree ${treeReal} is no longer there (or no longer a worktree) after the worktree hooks ran`;
        if (hooks.some((h) => h.required)) run.failures.push({ capability: "oats.kernel", event: "worktree", message: msg, required: true });
        else { warnings.push(msg); treeMissing = true; }
      }
      const required = run.failures.filter((f) => f.required);
      for (const f of run.failures.filter((x) => !x.required)) warnings.push(`${f.capability} worktree hook failed (the tree is kept): ${f.message}`);
      if (required.length) {
        const logOf = (id) => run.receipt.find((r) => r.capability === id)?.log;
        const detail = required.map((f) => `${f.capability}: ${f.message}${logOf(f.capability) ? ` (log: ${logOf(f.capability)})` : ""}`).join("; ");
        throw await fail(required.some((f) => f.contract === "environment") ? "E_HOOK_ENVIRONMENT_CONTRACT" : "E_REQUIRED_HOOK_FAILED", `a required worktree hook failed: ${detail}`, { hooks: run.receipt });
      }
      if (treeMissing) rec = { ...rec, treeMissing: true };
    } finally {
      guard.restore();
    }
  }
  const { pid: _pid, processStart: _ps, hookPgid: _pg, hookStart: _hs, branchCreated: _bc, gitPid: _gp, gitStart: _gs, ...kept } = rec;
  rec = { ...kept, state: "ready", hooks: run.receipt, readyAt: new Date().toISOString() };
  writeRecord(recPath, rec);
  appendEvent(home, { kind: "worktree-added", data: { purpose, path: tree, branch, base, baseOid: oid, remote, member: member || null, hooks: run.receipt } });
  return publicReceipt(rec, { record: recPath, resumed: false, warnings });
}

// ---------- remove ----------

/** `oats worktree remove --purpose <p>`: `git worktree remove` (which refuses a dirty tree),
 *  the branch kept, no hook, the record dropped. A `creating` record whose adder is gone is
 *  rolled back instead. Only recorded trees: a hand-made one is git's to remove. */
export async function worktreeRemove(homeArg, o = {}) {
  validateTreeArgs(o, { forRemove: true });
  const home = homeArg;
  if (typeof home !== "string" || !isAbsolute(home) || !existsSync(join(home, "instance.json"))) throw badArgs("oats worktree runs from an instance home (in the home, or with $OATS_INSTANCE_HOME set to it)");
  const { purpose } = o;
  const recPath = treeRecordPath(home, purpose);
  const tree = extraTreePath(home, purpose);
  return withPurposeClaim(home, purpose, async ({ track, warnings: claimWarnings }) => {
    const rec = readRecord(recPath);
    if (!rec) throw badArgs(`no tree of purpose ${purpose} was made by oats worktree add in this home (no ${recPath})${existsSync(tree) ? `; to remove a tree made another way: git worktree remove ${tree}` : ""}`, { purpose, path: tree });
    if (rec.state === "unreadable") throw Object.assign(oatsError("E_PLACEMENT_TAKEN", `${recPath} is not a readable tree record; inspect it and the tree at ${tree}`), { details: { purpose, path: tree, record: recPath } });
    if (rec.state === "creating") {
      const live = processLiveness(rec);
      if (live.state === "alive") throw Object.assign(oatsError("E_LIFECYCLE_BUSY", `an oats worktree add of purpose ${purpose} is still running (pid ${rec.pid}); nothing was removed`), { details: { purpose, path: tree, pid: rec.pid } });
      if (live.state === "unknown") throw unknownAdderRefusal({ purpose, tree, recPath, rec, reason: live.reason });
      const rb = await rollbackTree(home, rec, { track });
      const warned = [...claimWarnings, ...rb.warnings];
      if (rb.owed.length) throw Object.assign(oatsError("E_LIFECYCLE_BUSY", `the rollback of an interrupted add of purpose ${purpose} could not be completed: ${rb.owed.join("; ")}`), { details: { purpose, path: tree, owed: rb.owed, ...(warned.length ? { warnings: warned } : {}) } });
      return { purpose, path: tree, removed: true, rolledBack: true, branch: rec.branch, branchKept: rb.branchKept, ...(rb.branchKeptReason ? { branchKeptReason: rb.branchKeptReason } : {}), ...(warned.length ? { warnings: warned } : {}) };
    }
    const clone = rec.clone;
    if (existsSync(tree)) {
      const status = git(["-C", tree, "status", "--porcelain", "--ignore-submodules=none"]);
      const r = await trackedGit(["-C", clone, "worktree", "remove", "--end-of-options", tree], { track });
      if (!r.ok) {
        if (status.ok && status.out.trim()) throw Object.assign(oatsError("E_WORKTREE_DIRTY", `git refused to remove ${tree}: ${firstLine(r.err)}; commit and push its changes, or discard them, then retry (the record is kept)`), { details: { purpose, path: tree, git: r.err } });
        throw Object.assign(oatsError("E_WORK_PRESERVATION_FAILED", `git refused to remove ${tree}: ${firstLine(r.err)}; nothing was removed (the record is kept)`), { details: { purpose, path: tree, git: r.err } });
      }
    }
    await trackedGit(["-C", clone, "worktree", "prune"], { track });
    if (existsSync(tree)) throw Object.assign(oatsError("E_WORK_PRESERVATION_FAILED", `${tree} is still there after git worktree remove; the record is kept`), { details: { purpose, path: tree } });
    rmSync(recPath, { force: true });
    return { purpose, path: tree, removed: true, rolledBack: false, branch: rec.branch, branchKept: true, ...(claimWarnings.length ? { warnings: claimWarnings } : {}) };
  });
}
