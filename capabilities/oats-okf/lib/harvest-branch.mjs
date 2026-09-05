// A workspace-mode harvest delivers its promotion as a PR from a branch named
// memory-harvest/<slug> in the soul's repository. After that PR merges, the
// local branch may still exist and the next harvest's spawn would refuse it.
// A branch fully merged into the base is stale and is deleted before the
// spawn; an unmerged one is the previous harvester's unfinished work and the
// harvest refuses with the exact remedy instead of touching it.
import { execFileSync } from "node:child_process";

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** The repository's base branch: origin/HEAD's target when known, else main, else master. */
export function baseBranchOf(repo) {
  try { const ref = git(repo, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]); if (ref) return ref.replace(/^refs\/remotes\//, ""); } catch { /* no origin/HEAD */ }
  for (const b of ["origin/main", "main", "origin/master", "master"]) {
    try { git(repo, ["rev-parse", "--verify", "--quiet", b]); return b; } catch { /* next */ }
  }
  return undefined;
}

/** Returns { action: "absent" | "deleted", base } or throws E_HARVEST_BRANCH_EXISTS. */
export function reclaimHarvestBranch(repo, branch) {
  try { git(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]); }
  catch { return { action: "absent" }; }
  const base = baseBranchOf(repo);
  let merged = false;
  if (base) { try { git(repo, ["merge-base", "--is-ancestor", branch, base]); merged = true; } catch { merged = false; } }
  if (!merged) {
    const err = new Error(`branch ${branch} already exists in ${repo} and is not merged into ${base || "any base branch"}: a previous harvest's promotion is unfinished — review and merge or delete it (git -C ${repo} branch -D ${branch}) before harvesting again`);
    err.code = "E_HARVEST_BRANCH_EXISTS";
    throw err;
  }
  git(repo, ["branch", "-d", branch]);
  return { action: "deleted", base };
}
