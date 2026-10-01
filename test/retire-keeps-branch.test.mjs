// Retire never deletes a branch unless the operator asked (--delete-branch), and then only the verified one
// (awebai/oats#436): a retire whose hook reports incomplete cleanup quarantines the home, and its retry (or
// --force) must not take the instance's branch, unpushed commits and all, with it.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { retireInstance } from "../lib/core.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

/** A capability whose retire hook always reports incomplete cleanup. */
const stubbornCleanup = {
  manifest: { hooks: { retire: "hook.mjs" } },
  files: { "hook.mjs": `console.log(JSON.stringify({ meta: { retired: false, reason: "self-delete-failed" } }));\n` },
};

async function worktreeInstance(t, name) {
  const fx = v2Deployment({ souls: { dev: { soul: { work: "worktree", capabilities: { "test.stubborn": { from: "here" } } } } }, capabilities: { "test.stubborn": stubbornCleanup } });
  t.after(fx.cleanup);
  const hostPath = process.env.PATH; process.env.PATH = fx.env.PATH; t.after(() => { process.env.PATH = hostPath; });
  const r = await fx.spawn("dev", { instance: name, work: "worktree" });
  const meta = JSON.parse(readFileSync(join(r.home, "instance.json"), "utf8"));
  const git = (...args) => execFileSync("git", ["-C", join(r.home, "work"), "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" }).trim();
  writeFileSync(join(r.home, "work", "unpushed.txt"), "work nobody else has\n");
  git("add", "unpushed.txt"); git("commit", "-qm", "unpushed work");
  const tip = git("rev-parse", "HEAD");
  const branchTip = () => { try { return execFileSync("git", ["-C", meta.repo, "rev-parse", "--verify", "--quiet", `refs/heads/${meta.branch}`], { encoding: "utf8" }).trim(); } catch { return null; } };
  const retire = (o = {}) => fx.inEnv(() => retireInstance(fx.root, name, { tmuxSession: "oats-test-nosuch", ...o }));
  return { fx, home: r.home, meta, tip, branchTip, retire };
}

test("a retire whose hook reports incomplete cleanup keeps the branch: on the quarantine, its retry and --force", async (t) => {
  const w = await worktreeInstance(t, "dev-keep");
  assert.ok(w.meta.branch, "a worktree instance records its branch");
  // --discard-worktree frees the branch (no worktree has it checked out), as in the report: only the
  // missing --delete-branch protects it.
  const first = await w.retire({ discardWorktree: true });
  assert.ok(first.rollbackIncomplete, "the hook's incomplete cleanup quarantines the home");
  assert.equal(existsSync(w.home), true);
  assert.equal(w.branchTip(), w.tip, "the quarantine keeps the branch");
  const retry = await w.retire();
  assert.ok(retry.rollbackIncomplete);
  assert.equal(retry.branchDeleted, false);
  assert.equal(w.branchTip(), w.tip, "a retry keeps the branch and its unpushed commit");
  const forced = await w.retire({ force: true });
  assert.equal(existsSync(w.home), false, "--force removes the home");
  assert.equal(forced.branchDeleted, false);
  assert.equal(w.branchTip(), w.tip, "and still keeps the branch");
});

test("with --delete-branch, a quarantine retry deletes the instance's verified branch", async (t) => {
  const w = await worktreeInstance(t, "dev-delete");
  await w.retire({ discardWorktree: true });
  assert.equal(w.branchTip(), w.tip);
  const forced = await w.retire({ force: true, deleteBranch: true });
  assert.equal(existsSync(w.home), false);
  assert.equal(w.branchTip(), null, "the operator asked: the branch is gone");
  assert.equal(forced.branchDeleted, true);
});

/** A capability whose required spawn hook fails; with `commit`, it first commits into the new worktree. */
const failingSpawn = (commit) => ({
  manifest: { hooks: { spawn: { command: "hook.mjs", required: true } } },
  files: { "hook.mjs": `import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const work = join(process.env.OATS_INSTANCE_HOME, "work");
if (${commit}) {
  writeFileSync(join(work, "hook-work.txt"), "made during the spawn\\n");
  const git = (...a) => execFileSync("git", ["-C", work, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a]);
  git("add", "hook-work.txt"); git("commit", "-qm", "hook work");
}
process.exit(1);
` },
});

for (const [commit, title] of [[false, "a failed spawn's rollback deletes the branch it created, when its tip has not moved"], [true, "a failed spawn's rollback keeps its branch when the tip moved, and says so"]]) {
  test(title, async (t) => {
    const fx = v2Deployment({ souls: { dev: { soul: { work: "worktree", capabilities: { "test.fail": { from: "here" } } } } }, capabilities: { "test.fail": failingSpawn(commit) } });
    t.after(fx.cleanup);
    const hostPath = process.env.PATH; process.env.PATH = fx.env.PATH; t.after(() => { process.env.PATH = hostPath; });
    const name = commit ? "dev-moved" : "dev-clean";
    const e = await fx.spawn("dev", { instance: name, work: "worktree" }).then(() => null, (x) => x);
    assert.equal(e?.code, "E_REQUIRED_HOOK_FAILED", String(e?.message));
    const branches = execFileSync("git", ["-C", fx.member, "for-each-ref", "--format=%(refname:short)", "refs/heads/"], { encoding: "utf8" }).split("\n").filter((b) => b.includes(name));
    if (!commit) assert.deepEqual(branches, [], "nothing was committed: the spawn's branch goes");
    else {
      assert.equal(branches.length, 1, "the branch with a commit on it stays");
      assert.match(execFileSync("git", ["-C", fx.member, "log", "-1", "--format=%s", branches[0]], { encoding: "utf8" }), /hook work/);
      assert.match(e.message, new RegExp(`git branch ${branches[0]}: kept; its tip moved from [0-9a-f]{12}, where this spawn created it`));
    }
  });
}
