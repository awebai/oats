// A retire whose hook reports incomplete cleanup leaves the worktree exactly as it was (awebai/oats#444): the
// home is quarantined before any worktree step, so the retry can still reach the hook and the work it needs.
// The retry does the worktree step only once nothing else is outstanding (retain by default, remove with
// --discard-worktree), and a work directory whose git admin entry is gone is reported, never removed: --force
// refuses it before any hook runs.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { retireInstance } from "../lib/core.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

/** A deployment whose retire hook reports incomplete cleanup while `<flags>/stubborn` exists, and records each
 *  run in `<flags>/ran`. */
async function stubbornInstance(t, name) {
  const flags = mkdtempSync(join(tmpdir(), "oats-retire-flags-")); t.after(() => rmSync(flags, { recursive: true, force: true }));
  const hook = `import { appendFileSync, existsSync } from "node:fs";
appendFileSync(${JSON.stringify(join(flags, "ran"))}, "ran\\n");
console.log(JSON.stringify({ meta: existsSync(${JSON.stringify(join(flags, "stubborn"))}) ? { retired: false, reason: "capture-unfinished" } : { retired: true } }));
`;
  const fx = v2Deployment({ souls: { dev: { soul: { work: "worktree", capabilities: { "test.stubborn": { from: "here" } } } } },
    capabilities: { "test.stubborn": { manifest: { hooks: { retire: "hook.mjs" } }, files: { "hook.mjs": hook } } } });
  t.after(fx.cleanup);
  const hostPath = process.env.PATH; process.env.PATH = fx.env.PATH; t.after(() => { process.env.PATH = hostPath; });
  const r = await fx.spawn("dev", { instance: name, work: "worktree" });
  const meta = JSON.parse(readFileSync(join(r.home, "instance.json"), "utf8"));
  const work = join(r.home, "work");
  const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" }).trim();
  writeFileSync(join(work, "unpushed.txt"), "work nobody else has\n");
  git("-C", work, "add", "unpushed.txt"); git("-C", work, "commit", "-qm", "unpushed work");
  const tip = git("-C", work, "rev-parse", "HEAD");
  writeFileSync(join(flags, "stubborn"), "");
  return {
    fx, home: r.home, work, meta, tip, git,
    settle: () => rmSync(join(flags, "stubborn")),
    runs: () => (existsSync(join(flags, "ran")) ? readFileSync(join(flags, "ran"), "utf8").split("\n").filter(Boolean).length : 0),
    registered: () => git("-C", meta.repo, "worktree", "list", "--porcelain").split("\n").filter((l) => l.startsWith("worktree ")).map((l) => l.slice("worktree ".length)),
    branchTip: () => { try { return git("-C", meta.repo, "rev-parse", "--verify", "--quiet", `refs/heads/${meta.branch}`); } catch { return null; } },
    retire: (o = {}) => fx.inEnv(() => retireInstance(fx.root, name, { tmuxSession: "oats-test-nosuch", ...o })),
  };
}

for (const [flags, label] of [[{}, "plain"], [{ discardWorktree: true }, "--discard-worktree"]]) {
  test(`(a) ${label}: a hook reporting incomplete cleanup quarantines the home before any worktree step`, async (t) => {
    const w = await stubbornInstance(t, label === "plain" ? "dev-plain" : "dev-discard");
    const r = await w.retire(flags);
    assert.ok(r.rollbackIncomplete?.length, "the home is quarantined");
    // The worktree step did not run: no retention record, and the incomplete list says why.
    assert.equal(r.retention, null);
    assert.equal(r.worktreeRemoved, false);
    assert.ok(r.rollbackIncomplete.some((m) => m.startsWith(`git worktree ${w.work}: kept for the retry; outstanding: `)), JSON.stringify(r.rollbackIncomplete));
    assert.equal(existsSync(join(w.work, "unpushed.txt")), true, "the worktree is where it was");
    assert.ok(w.registered().includes(w.work), "its admin entry is untouched");
    assert.equal(w.git("-C", w.work, "rev-parse", "HEAD"), w.tip);
    assert.equal(w.branchTip(), w.tip, "the branch is untouched");
  });
}

test("(b) a retry that is still incomplete keeps the worktree for the next retry; the hook runs every time", async (t) => {
  const w = await stubbornInstance(t, "dev-again");
  await w.retire({ discardWorktree: true });
  const r = await w.retire({ discardWorktree: true });
  assert.ok(r.rollbackIncomplete?.length);
  assert.equal(r.retention, null);
  assert.equal(r.worktreeRemoved, false);
  assert.equal(w.runs(), 2, "the retry reached the hook");
  assert.ok(w.registered().includes(w.work));
  assert.equal(w.branchTip(), w.tip);
});

test("(b) once nothing is outstanding, the retry retains the worktree by default", async (t) => {
  const w = await stubbornInstance(t, "dev-retain");
  await w.retire();
  w.settle();
  const r = await w.retire();
  assert.equal(r.rollbackIncomplete, undefined, JSON.stringify(r.rollbackIncomplete));
  assert.equal(existsSync(w.home), false, "the home is retired");
  assert.equal(r.retention.worktree, "retained");
  assert.equal(r.worktreeRemoved, false);
  assert.equal(w.git("-C", r.retention.movedTo, "rev-parse", "HEAD"), w.tip, "the retained worktree has the work");
  assert.ok(w.registered().includes(r.retention.movedTo));
  assert.equal(w.branchTip(), w.tip);
});

test("(b) once nothing is outstanding, the retry removes the worktree with --discard-worktree, and keeps the branch", async (t) => {
  const w = await stubbornInstance(t, "dev-remove");
  await w.retire({ discardWorktree: true });
  w.settle();
  const r = await w.retire({ discardWorktree: true });
  assert.equal(r.rollbackIncomplete, undefined, JSON.stringify(r.rollbackIncomplete));
  assert.equal(existsSync(w.home), false);
  assert.equal(r.retention.worktree, "removed");
  assert.equal(r.worktreeRemoved, true);
  assert.ok(!w.registered().includes(w.work));
  assert.equal(w.branchTip(), w.tip, "only --delete-branch deletes a branch");
});

test("(c) a work directory whose admin entry is gone is an incomplete item: the hooks run, the directory stays", async (t) => {
  const w = await stubbornInstance(t, "dev-orphan");
  w.settle();
  const admin = w.git("-C", w.work, "rev-parse", "--absolute-git-dir");
  rmSync(admin, { recursive: true, force: true });
  const r = await w.retire();
  assert.equal(w.runs(), 1, "the hook ran");
  assert.ok((r.rollbackIncomplete || []).some((m) => m.includes(w.work) && /admin entry is missing/.test(m)), JSON.stringify(r.rollbackIncomplete));
  assert.equal(existsSync(join(w.work, "unpushed.txt")), true, "the directory is kept");
  const again = await w.retire();
  assert.equal(w.runs(), 2, "a retry reaches the hook again");
  assert.ok(again.rollbackIncomplete?.length);
  assert.equal(existsSync(join(w.work, "unpushed.txt")), true);
});

test("--force with an incomplete hook retains the worktree before the home goes: no admin entry is left dangling", async (t) => {
  const w = await stubbornInstance(t, "dev-forced");
  const r = await w.retire({ force: true });
  assert.equal(existsSync(w.home), false, "--force removes the home");
  assert.ok(r.forcedIncomplete?.length, "and reports what stays outstanding");
  assert.equal(r.retention.worktree, "retained");
  assert.equal(w.git("-C", r.retention.movedTo, "rev-parse", "HEAD"), w.tip);
  assert.ok(w.registered().includes(r.retention.movedTo));
  assert.ok(!w.registered().includes(w.work), "no entry points into the removed home");
  assert.equal(w.branchTip(), w.tip);
});

test("(c) --force refuses an orphaned work directory before any hook runs", async (t) => {
  const w = await stubbornInstance(t, "dev-orphan-force");
  rmSync(w.git("-C", w.work, "rev-parse", "--absolute-git-dir"), { recursive: true, force: true });
  const e = await w.retire({ force: true }).then(() => null, (x) => x);
  assert.equal(e?.code, "E_WORK_PRESERVATION_FAILED", String(e?.message));
  assert.ok(e.message.includes(w.work) && /move it out or delete it/.test(e.message), e.message);
  assert.equal(w.runs(), 0, "no hook ran");
  assert.equal(existsSync(join(w.work, "unpushed.txt")), true, "the directory is kept");
});
