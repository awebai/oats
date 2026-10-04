// Retire never deletes a branch (awebai/oats#436): a retire whose hook reports incomplete cleanup
// quarantines the home, and its retry (or --force) must not take the instance's branch, unpushed commits
// and all, with it. --delete-branch is refused before anything happens.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FAILED_SPAWN_BRANCH_LEFT, retireInstance } from "../lib/core.mjs";
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
  // --discard-worktree frees the branch (no worktree has it checked out), as in the report: a retire
  // still leaves it.
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

test("--delete-branch is refused before anything happens, also on a quarantine retry with --force: the home and the branch stay", async (t) => {
  const w = await worktreeInstance(t, "dev-delete");
  await w.retire({ discardWorktree: true });
  assert.equal(w.branchTip(), w.tip);
  await assert.rejects(() => w.retire({ force: true, deleteBranch: true }), (e) => e.code === "E_BAD_ARGS"
    && e.message === "oats retire no longer deletes branches: --delete-branch is not accepted. Retire without it; the branch is left in the repository. Inspect it there and delete it with Git if it is no longer wanted.");
  assert.equal(existsSync(w.home), true, "the quarantined home is kept");
  assert.equal(w.branchTip(), w.tip, "and the branch, with its unpushed commit");
});

test("oats retire names the branch a quarantine still owes on the line after its item, from the retained home when no worktree step ran", async (t) => {
  const w = await worktreeInstance(t, "dev-named");
  await w.retire();
  const markerPath = join(w.home, ".oats-rollback-incomplete.json");
  const marker = JSON.parse(readFileSync(markerPath, "utf8"));
  marker.cleanup.outstanding = { ...marker.cleanup.outstanding, git: ["branch"] };
  writeFileSync(markerPath, JSON.stringify(marker, null, 2));
  // The hook is still incomplete, so the worktree step does not run: the receipt has no retention.
  const json = w.fx.cli(["retire", "dev-named", "--json"]);
  assert.equal(json.status, 1, json.stderr + json.stdout);
  const receipt = JSON.parse(json.stdout); // the raw receipt, printed whole
  assert.equal(receipt.retention, null);
  assert.ok(receipt.rollbackIncomplete.includes(FAILED_SPAWN_BRANCH_LEFT), JSON.stringify(receipt.rollbackIncomplete));
  const text = w.fx.cli(["retire", "dev-named"]);
  assert.equal(text.status, 1, text.stderr + text.stdout);
  const lines = text.stderr.split("\n");
  const at = lines.indexOf(`  ${FAILED_SPAWN_BRANCH_LEFT}`);
  assert.ok(at >= 0, text.stderr);
  assert.equal(lines[at + 1], `  branch: ${w.meta.branch}`, "the branch the retained home records");
  assert.equal(w.branchTip(), w.tip, "the branch is left");
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

test("a forced retry of a worktree switched to another branch deletes neither the worktree's branch nor the recorded one", async (t) => {
  const w = await worktreeInstance(t, "dev-switched");
  const first = await w.retire();
  assert.equal(first.retention, null, "the quarantine kept the worktree in the home for the retry");
  // The worktree, still under the home, now on another branch.
  const work = join(w.home, "work");
  execFileSync("git", ["-C", work, "checkout", "-q", "-b", "feature-x"]);
  const r = await w.retire({ force: true });
  assert.equal(r.branchDeleted, false);
  assert.equal(Object.hasOwn(r.retention, "branchDeleted"), false);
  assert.equal(r.retention.branch, "feature-x");
  const exists = (b) => { try { execFileSync("git", ["-C", w.meta.repo, "rev-parse", "--verify", "--quiet", `refs/heads/${b}`]); return true; } catch { return false; } };
  assert.equal(exists("feature-x"), true, "the worktree's branch is left");
  assert.equal(w.branchTip(), w.tip, "the recorded branch keeps its commit");
});
