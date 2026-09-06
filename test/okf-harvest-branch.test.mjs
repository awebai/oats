import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baseBranchOf, reclaimHarvestBranch } from "../capabilities/oats-okf/lib/harvest-branch.mjs";

const git = (repo, ...a) => execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.invalid", ...a], { encoding: "utf8" }).trim();

test("a merged memory-harvest branch is deleted before the next harvest; an unmerged one refuses with the remedy; absent is fine", () => {
  const base = mkdtempSync(join(tmpdir(), "okf-branch-"));
  try {
    const repo = join(base, "re po's"); execFileSync("git", ["init", "-q", "-b", "main", repo]);
    writeFileSync(join(repo, "a.md"), "a\n"); git(repo, "add", "-A"); git(repo, "commit", "-qm", "init");
    assert.equal(reclaimHarvestBranch(repo, "memory-harvest/x").action, "absent");
    // A promotion branch merged into main (as a merged PR leaves it).
    git(repo, "checkout", "-qb", "memory-harvest/x"); writeFileSync(join(repo, "lesson.md"), "l\n"); git(repo, "add", "-A"); git(repo, "commit", "-qm", "promote");
    git(repo, "checkout", "-q", "main"); git(repo, "merge", "-q", "--no-ff", "memory-harvest/x", "-m", "merge");
    const r = reclaimHarvestBranch(repo, "memory-harvest/x");
    assert.equal(r.action, "deleted"); assert.equal(r.base, "main");
    assert.equal(git(repo, "branch", "--list", "memory-harvest/x"), "");
    // An unmerged one is refused, and left alone.
    git(repo, "checkout", "-qb", "memory-harvest/y"); writeFileSync(join(repo, "wip.md"), "w\n"); git(repo, "add", "-A"); git(repo, "commit", "-qm", "wip"); git(repo, "checkout", "-q", "main");
    assert.throws(() => reclaimHarvestBranch(repo, "memory-harvest/y"), (e) => e.code === "E_HARVEST_BRANCH_EXISTS" && e.message.includes(`git -C '${repo.replace(/'/g, "'\\''")}' branch -D 'memory-harvest/y'`));
    assert.equal(git(repo, "branch", "--list", "memory-harvest/y"), "memory-harvest/y");
    assert.equal(baseBranchOf(repo), "main");
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("a branch merged into origin/main is reclaimed even when the soul's local main is behind (branch -d would refuse it)", () => {
  const base = mkdtempSync(join(tmpdir(), "okf-branch-remote-"));
  try {
    const origin = join(base, "origin.git"); execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
    const repo = join(base, "repo"); execFileSync("git", ["clone", "-q", origin, repo]);
    writeFileSync(join(repo, "a.md"), "a\n"); git(repo, "add", "-A"); git(repo, "commit", "-qm", "init"); git(repo, "push", "-q", "-u", "origin", "main");
    // The harvester's promotion merged upstream (the PR merge), local main never advanced.
    git(repo, "checkout", "-qb", "memory-harvest/z"); writeFileSync(join(repo, "lesson.md"), "l\n"); git(repo, "add", "-A"); git(repo, "commit", "-qm", "promote");
    git(repo, "push", "-q", "origin", "memory-harvest/z:main");
    git(repo, "checkout", "-q", "main"); git(repo, "fetch", "-q", "origin");
    assert.notEqual(git(repo, "rev-parse", "main"), git(repo, "rev-parse", "origin/main"), "local main is behind origin/main");
    assert.equal(baseBranchOf(repo), "origin/main");
    // Positive control for the defect: plain -d refuses this exact state.
    assert.throws(() => git(repo, "branch", "-d", "memory-harvest/z"), /not fully merged/);
    const r = reclaimHarvestBranch(repo, "memory-harvest/z");
    assert.equal(r.action, "deleted"); assert.equal(r.base, "origin/main");
    assert.equal(git(repo, "branch", "--list", "memory-harvest/z"), "");
    // A branch NOT in origin/main is still refused even though local HEAD contains it.
    git(repo, "checkout", "-qb", "memory-harvest/w"); writeFileSync(join(repo, "wip.md"), "w\n"); git(repo, "add", "-A"); git(repo, "commit", "-qm", "wip");
    assert.throws(() => reclaimHarvestBranch(repo, "memory-harvest/w"), (e) => e.code === "E_HARVEST_BRANCH_EXISTS");
    assert.equal(git(repo, "branch", "--list", "memory-harvest/w"), "* memory-harvest/w");
  } finally { rmSync(base, { recursive: true, force: true }); }
});
