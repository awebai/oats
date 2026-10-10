// Retire and the home's extra trees (awebai/oats#674). The work-mode briefings let an agent create
// linked worktrees in its home as `.work-<purpose>`; retirement must never lose what they hold. A
// verified extra tree is left out of the home's recovery bytes and handled by its own step: removed
// when clean (its branch stays), re-homed under <workspace>/.agents/worktrees otherwise, refused when
// Git will not move it. The retire plan lists each tree's disposition and binds them into its
// revision. Every case runs against a real scratch clone (the deployment's member clone).
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { RETAINED_LEAF_MAX, completeDeferredRetirement, retireInstance } from "../lib/core.mjs";
import { pathLimitSkip } from "./helpers/path-limit.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { killAndReap } from "./helpers/host-fixture.mjs";

/** A capability whose retire hook records that it ran (`<root>/retire-hook-ran`) and, when the home holds
 *  `.lock-on-retire`, locks every `.work-*` tree in it: a lock that appears while the hooks run. */
const recordingHook = {
  manifest: { hooks: { retire: "hook.mjs" } },
  files: { "hook.mjs": `import { appendFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
appendFileSync(join(process.env.OATS_ROOT, "retire-hook-ran"), "ran\\n");
const home = process.env.OATS_INSTANCE_HOME;
if (existsSync(join(home, ".lock-on-retire"))) for (const n of readdirSync(home)) if (n.startsWith(".work-")) execFileSync("git", ["-C", join(home, n), "worktree", "lock", "--reason", "during hooks", join(home, n)]);
` },
};

async function instance(t, name, { work = "worktree", hook = false } = {}) {
  const fx = v2Deployment(hook
    ? { souls: { dev: { soul: { work, capabilities: { "test.recording": { from: "here" } } } } }, capabilities: { "test.recording": recordingHook } }
    : { souls: { dev: { soul: { work } } } });
  t.after(fx.cleanup);
  const hostPath = process.env.PATH; process.env.PATH = fx.env.PATH; t.after(() => { process.env.PATH = hostPath; });
  const r = await fx.spawn("dev", { instance: name, work });
  const home = r.home;
  const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", env: fx.env, stdio: ["ignore", "pipe", "pipe"] }).trim();
  /** An extra tree made the way the briefing says: detached, fetched inside it, switched to `branch`. */
  const tree = (purpose, branch) => {
    const path = join(home, `.work-${purpose}`);
    git(fx.member, "worktree", "add", "-q", "--detach", path);
    git(path, "fetch", "-q", "--refmap=", "origin", "main");
    if (branch) git(path, "switch", "-q", "-c", branch, "FETCH_HEAD");
    else git(path, "checkout", "-q", "--detach", "FETCH_HEAD");
    return path;
  };
  const registered = (path) => git(fx.member, "worktree", "list", "--porcelain").split("\n").includes(`worktree ${path}`);
  const branchTip = (branch) => { try { return git(fx.member, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`); } catch { return null; } };
  const retire = (o = {}) => fx.inEnv(() => retireInstance(fx.root, name, { tmuxSession: "oats-test-nosuch", ...o }));
  const retained = (leaf) => join(fx.dep, ".agents", "worktrees", "ws", leaf);
  const plan = () => { const p = fx.cli(["retire", name, "--plan", "--json"]); assert.equal(p.status, 0, p.stderr + p.stdout); return p.json().result; };
  const apply = (revision, key) => fx.cli(["retire", name, "--plan-revision", revision, "--idempotency-key", key, "--json"]);
  const hookRan = () => existsSync(join(fx.root, "retire-hook-ran"));
  return { fx, home, git, tree, registered, branchTip, retire, retained, plan, apply, hookRan };
}
const commit = (w, path, file, text, msg = "work") => { writeFileSync(join(path, file), text); w.git(path, "add", file); w.git(path, "commit", "-qm", msg); return w.git(path, "rev-parse", "HEAD"); };

test("a clean extra tree is removed and pruned, its branch kept in the clone, and the home removed", async (t) => {
  const w = await instance(t, "dev-clean");
  const path = w.tree("clean", "agents/dev-clean-x");
  const gitFile = readFileSync(join(path, ".git"), "utf8").replace(/^gitdir:\s*/, "").trim();
  const tip = w.branchTip("agents/dev-clean-x");
  const r = await w.retire();
  assert.deepEqual(r.extraWorktrees, [{ path, repo: w.fx.member, branch: "agents/dev-clean-x", detachedAt: null, disposition: "remove", movedTo: null, reason: null, outcome: "removed" }]);
  assert.equal(existsSync(w.home), false, "the home is removed");
  assert.equal(w.registered(path), false, "the tree is no longer in the clone's worktree list");
  assert.equal(existsSync(gitFile), false, "its admin entry is pruned");
  assert.equal(w.branchTip("agents/dev-clean-x"), tip, "its branch stays in the clone");
  assert.equal(r.retention.worktree, "retained", "work/ is retained as before");
});

test("a tree with a modified tracked file is re-homed with its bytes and its index", async (t) => {
  const w = await instance(t, "dev-dirty");
  const path = w.tree("dirty", "agents/dev-dirty-x");
  const file = w.git(path, "ls-files").split("\n")[0];
  writeFileSync(join(path, file), "staged\n"); w.git(path, "add", file);
  writeFileSync(join(path, file), "in the tree\n");
  const r = await w.retire();
  const [row] = r.extraWorktrees;
  assert.equal(row.outcome, "retained");
  assert.equal(row.movedTo, w.retained("agents-dev-dirty-x"));
  assert.match(row.reason, /uncommitted, untracked or ignored files/);
  assert.equal(readFileSync(join(row.movedTo, file), "utf8"), "in the tree\n", "the tree's bytes");
  assert.equal(w.git(row.movedTo, "show", `:${file}`), "staged", "the index");
  assert.equal(w.registered(row.movedTo), true);
  assert.equal(existsSync(w.home), false);
});

test("an untracked file, and an ignored file alone, each re-home the tree", async (t) => {
  const w = await instance(t, "dev-untracked");
  const untracked = w.tree("untracked", "agents/u");
  writeFileSync(join(untracked, "new.txt"), "untracked\n");
  const ignored = w.tree("ignored", "agents/i");
  const common = w.git(ignored, "rev-parse", "--path-format=absolute", "--git-common-dir");
  mkdirSync(join(common, "info"), { recursive: true });
  writeFileSync(join(common, "info", "exclude"), "*.ignored\n");
  writeFileSync(join(ignored, "scratch.ignored"), "ignored bytes\n");
  assert.equal(w.git(ignored, "status", "--porcelain"), "", "without --ignored the tree reads clean");
  const r = await w.retire();
  assert.deepEqual(r.extraWorktrees.map((x) => [x.path, x.outcome]), [[ignored, "retained"], [untracked, "retained"]]);
  const byPath = Object.fromEntries(r.extraWorktrees.map((x) => [x.path, x]));
  assert.equal(readFileSync(join(byPath[untracked].movedTo, "new.txt"), "utf8"), "untracked\n");
  assert.equal(readFileSync(join(byPath[ignored].movedTo, "scratch.ignored"), "utf8"), "ignored bytes\n");
});

test("an unpushed commit on a clean tree's branch: the tree is removed and the branch keeps the commit", async (t) => {
  const w = await instance(t, "dev-unpushed");
  const path = w.tree("unpushed", "agents/unpushed");
  const tip = commit(w, path, "only-here.txt", "unpushed\n");
  const r = await w.retire();
  assert.equal(r.extraWorktrees[0].outcome, "removed");
  assert.equal(w.registered(path), false);
  assert.equal(w.branchTip("agents/unpushed"), tip, "the branch with the unpushed commit survives in the clone");
});

test("a detached HEAD on a commit no ref reaches is re-homed, and the commit is still there", async (t) => {
  const w = await instance(t, "dev-detached");
  const path = w.tree("detached");
  const tip = commit(w, path, "lost.txt", "only reachable from HEAD\n");
  const r = await w.retire();
  const [row] = r.extraWorktrees;
  assert.equal(row.outcome, "retained");
  assert.equal(row.branch, null);
  assert.equal(row.detachedAt, tip);
  assert.equal(row.movedTo, w.retained(`detached-${tip.slice(0, 12)}`));
  assert.match(row.reason, /reached by no ref/);
  assert.equal(w.git(row.movedTo, "rev-parse", "HEAD"), tip);
});

test("a commit only the tree's own refs reach is re-homed: refs/worktree/ and the tree's HEAD go with its admin entry", async (t) => {
  const w = await instance(t, "dev-private");
  const path = w.tree("private");
  const tip = commit(w, path, "private.txt", "reached only from this tree\n");
  w.git(path, "update-ref", "refs/worktree/save", "HEAD");
  const r = await w.retire();
  const [row] = r.extraWorktrees;
  assert.equal(row.outcome, "retained", "a per-worktree ref does not count: it is removed with the tree");
  assert.match(row.reason, /reached by no ref/);
  assert.equal(w.git(row.movedTo, "rev-parse", "HEAD"), tip);
});

test("the retire's Git commands run helper-free: a repository's core.fsmonitor does not run while a tree is removed", async (t) => {
  const w = await instance(t, "dev-helper", { work: "directory" });
  const path = w.tree("clean", "agents/helper");
  const marker = join(w.fx.base, "fsmonitor-ran");
  const script = join(w.fx.base, "fsmonitor.sh");
  writeFileSync(script, `#!/bin/sh\ntouch '${marker}'\n`); chmodSync(script, 0o755);
  w.git(w.fx.member, "config", "core.fsmonitor", script);
  const r = await w.retire();
  assert.equal(r.extraWorktrees[0].outcome, "removed");
  assert.equal(existsSync(marker), false, "no helper the repository names was run");
});

/** A core.fsmonitor in the repository that work/ belongs to, which leaves `<base>/fsmonitor-ran` when Git runs it. */
function fsmonitorMarker(w) {
  const marker = join(w.fx.base, "fsmonitor-ran");
  const script = join(w.fx.base, "fsmonitor.sh");
  writeFileSync(script, `#!/bin/sh\ntouch '${marker}'\n`); chmodSync(script, 0o755);
  w.git(w.fx.member, "config", "core.fsmonitor", script);
  return marker;
}

// awebai/oats#679 and #662: the work/ step, the inspection's status reads and the copy's reads of the work run
// no helper the repository names either. work/ holds uncommitted work, so the copier reads it too.
for (const discardWorktree of [false, true]) {
  test(`work/ ${discardWorktree ? "removed with --discard-worktree" : "re-homed by default"}: the repository's core.fsmonitor runs neither in the inspection, the copy nor the step`, async (t) => {
    const w = await instance(t, discardWorktree ? "dev-fsm-discard" : "dev-fsm-rehome");
    const marker = fsmonitorMarker(w);
    writeFileSync(join(w.home, "work", "wip.txt"), "uncommitted\n");
    const r = await w.retire({ discardWorktree });
    assert.equal(r.retention.worktree, discardWorktree ? "removed" : "retained");
    assert.ok(r.workRecovery, "the uncommitted work was copied");
    assert.equal(existsSync(join(w.home, "work")), false);
    assert.equal(existsSync(marker), false, "no helper the repository names was run");
  });
}

test("the first inspection's status of work/ runs no helper the repository names: a retire that refuses right after it (a locked extra tree) leaves no fsmonitor trace", async (t) => {
  const w = await instance(t, "dev-fsm-inspect");
  const path = w.tree("locked", "agents/fsm-locked");
  w.git(w.fx.member, "worktree", "lock", path);
  const marker = fsmonitorMarker(w);
  writeFileSync(join(w.home, "work", "wip.txt"), "uncommitted\n");
  await assert.rejects(() => w.retire(), (e) => e.code === "E_WORK_PRESERVATION_FAILED" && /nothing was run or removed/.test(e.message));
  assert.equal(existsSync(marker), false, "the inspection's git status did not run the fsmonitor");
});

test("a rebase in progress on an otherwise clean tree re-homes it", async (t) => {
  const w = await instance(t, "dev-rebase");
  const path = w.tree("rebase", "agents/rebase");
  commit(w, path, "a.txt", "a\n");
  // An --exec step that fails stops the rebase with a clean tree: only the admin dir says it is running.
  assert.throws(() => w.git(path, "rebase", "-q", "--exec", "false", "HEAD~1"));
  assert.equal(w.git(path, "status", "--porcelain", "--ignored"), "", "the tree itself is clean");
  const r = await w.retire();
  const [row] = r.extraWorktrees;
  assert.equal(row.outcome, "retained");
  assert.match(row.reason, /an operation is in progress/);
  assert.ok(existsSync(join(w.git(row.movedTo, "rev-parse", "--path-format=absolute", "--git-dir"), "rebase-merge")), "the rebase moved with it");
});

test("a locked tree refuses before anything runs: no retire hook, --force included; the home, the tree and work/ are kept", async (t) => {
  const w = await instance(t, "dev-locked", { hook: true });
  const path = w.tree("locked", "agents/locked");
  writeFileSync(join(path, "keep.txt"), "dirty\n");
  w.git(w.fx.member, "worktree", "lock", "--reason", "in use", path);
  const work = join(w.home, "work");
  const refused = (e) => e.code === "E_WORK_PRESERVATION_FAILED" && e.message.includes(path) && /locked \(in use\)/.test(e.message) && /nothing was run or removed/.test(e.message);
  await assert.rejects(() => w.retire(), refused);
  await assert.rejects(() => w.retire({ force: true }), refused, "--force does not bypass it");
  assert.equal(w.hookRan(), false, "no retire hook ran");
  assert.equal(existsSync(w.home), true, "the home is kept");
  assert.equal(existsSync(join(w.home, ".oats-rollback-incomplete.json")), false, "and not quarantined");
  assert.equal(readFileSync(join(path, "keep.txt"), "utf8"), "dirty\n", "the tree is kept");
  assert.equal(w.registered(path), true);
  assert.equal(w.registered(work), true, "work/ is untouched");
  // The plan says so too.
  const p = w.plan();
  assert.equal(p.facts.extraWorktrees[0].disposition, "refuse");
  assert.ok(p.notes.some((n) => n.includes(path) && n.includes("retire refuses")), p.notes.join("\n"));
  // Unlocked, the same retire runs its hook and re-homes the tree.
  w.git(w.fx.member, "worktree", "unlock", path);
  const r = await w.retire();
  assert.equal(w.hookRan(), true, "the hook runs once nothing refuses");
  assert.equal(r.extraWorktrees[0].outcome, "retained");
});

test("a lock that appears while the retire hooks run is refused at the step: the home and the tree are kept, work/ untouched", async (t) => {
  const w = await instance(t, "dev-late-lock", { hook: true });
  const path = w.tree("late", "agents/late-lock");
  writeFileSync(join(path, "keep.txt"), "dirty\n");
  writeFileSync(join(w.home, ".lock-on-retire"), "");
  await assert.rejects(() => w.retire(), (e) => e.code === "E_WORK_PRESERVATION_FAILED" && e.message.includes(path) && /locked \(during hooks\)/.test(e.message) && /work\/ is untouched/.test(e.message) && /retire hooks have run/.test(e.message));
  assert.equal(w.hookRan(), true);
  assert.equal(existsSync(w.home), true, "the home is kept");
  assert.equal(readFileSync(join(path, "keep.txt"), "utf8"), "dirty\n");
  assert.equal(w.registered(path), true);
  assert.equal(w.registered(join(w.home, "work")), true, "work/ is untouched");
});
test("unverified .work-* entries are home bytes: copied by the home recovery, not treated as extra trees", async (t) => {
  const w = await instance(t, "dev-unverified");
  mkdirSync(join(w.home, ".work-x"));
  writeFileSync(join(w.home, ".work-x", "notes.txt"), "plain directory\n");
  mkdirSync(join(w.home, ".work-y"));
  writeFileSync(join(w.home, ".work-y", ".git"), `gitdir: ${join(w.fx.base, "no-such-admin-dir")}\n`);
  writeFileSync(join(w.home, ".work-y", "file.txt"), "orphaned gitfile\n");
  const verified = w.tree("ok", "agents/ok");
  const r = await w.retire();
  assert.deepEqual(r.extraWorktrees.map((x) => x.path), [verified], "only the verified tree is an extra tree");
  assert.ok(r.workRecovery, "the unverified entries changed the home, so it is recovered");
  assert.equal(readFileSync(join(r.workRecovery.path, "home", ".work-x", "notes.txt"), "utf8"), "plain directory\n");
  assert.equal(readFileSync(join(r.workRecovery.path, "home", ".work-y", "file.txt"), "utf8"), "orphaned gitfile\n");
  assert.equal(existsSync(join(r.workRecovery.path, "home", ".work-ok")), false, "the verified tree is not copied");
  assert.deepEqual(r.workRecovery.notCopied, [{ scope: "home", path: ".work-ok", owner: "kernel:extra-worktree" }]);
});

test("a .work-* tree of a repository inside the home is home bytes: it goes to recovery with that repository", async (t) => {
  const w = await instance(t, "dev-inner");
  const inner = join(w.home, ".scratch-repo");
  mkdirSync(inner);
  w.git(inner, "init", "-q", "-b", "main");
  commit(w, inner, "a.txt", "a\n");
  w.git(inner, "worktree", "add", "-q", "-b", "side", join(w.home, ".work-inner"));
  writeFileSync(join(w.home, ".work-inner", "b.txt"), "only here\n");
  const r = await w.retire();
  assert.equal(r.extraWorktrees, undefined, "not an extra tree: its repository goes with the home");
  assert.equal(readFileSync(join(r.workRecovery.path, "home", ".work-inner", "b.txt"), "utf8"), "only here\n");
  assert.ok(existsSync(join(r.workRecovery.path, "home", ".scratch-repo", ".git")), "the repository is recovered with it");
  assert.equal(r.workRecovery.notCopied, undefined);
});

test("--keep-dir leaves the extra trees untouched", async (t) => {
  const w = await instance(t, "dev-keep");
  const clean = w.tree("clean", "agents/keep-clean");
  const dirty = w.tree("dirty", "agents/keep-dirty");
  writeFileSync(join(dirty, "x.txt"), "x\n");
  const r = await w.retire({ keepDir: true });
  assert.equal(r.extraWorktrees, undefined);
  assert.equal(w.registered(clean), true);
  assert.equal(w.registered(dirty), true);
  assert.equal(readFileSync(join(dirty, "x.txt"), "utf8"), "x\n");
});

test("a re-home target that exists takes the next suffix, as for work/", async (t) => {
  const w = await instance(t, "dev-collide");
  const path = w.tree("collide", "agents/collide");
  writeFileSync(join(path, "x.txt"), "x\n");
  mkdirSync(w.retained("agents-collide"), { recursive: true });
  const r = await w.retire();
  assert.equal(r.extraWorktrees[0].movedTo, w.retained("agents-collide-2"));
  assert.equal(readFileSync(join(w.retained("agents-collide-2"), "x.txt"), "utf8"), "x\n");
});

test("the retire plan lists each tree's disposition and target and binds them: a change refuses the apply as stale", async (t) => {
  const w = await instance(t, "dev-plan");
  const clean = w.tree("clean", "agents/plan-clean");
  const dirty = w.tree("dirty", "agents/plan-dirty");
  writeFileSync(join(dirty, "x.txt"), "x\n");
  const first = w.plan();
  assert.deepEqual(first.facts.extraWorktrees, [
    { path: clean, repo: w.fx.member, branch: "agents/plan-clean", detachedAt: null, disposition: "remove", movedTo: null, reason: null },
    { path: dirty, repo: w.fx.member, branch: "agents/plan-dirty", detachedAt: null, disposition: "retain", movedTo: w.retained("agents-plan-dirty"), reason: "it holds uncommitted, untracked or ignored files" },
  ]);
  assert.ok(first.notes.some((n) => n.includes(clean) && n.includes("would be removed")), first.notes.join("\n"));
  assert.ok(first.notes.some((n) => n.includes(dirty) && n.includes(w.retained("agents-plan-dirty"))), first.notes.join("\n"));
  const stale = (revision, key) => {
    const r = w.apply(revision, key);
    assert.notEqual(r.status, 0, r.stdout);
    assert.equal(JSON.parse(r.stdout.trim().split("\n").pop()).error.code, "E_PLAN_STALE", r.stdout);
    assert.equal(existsSync(w.home), true);
    assert.equal(w.registered(clean), true, "nothing was removed");
    assert.equal(w.registered(dirty), true, "nothing was moved");
  };
  // Dirtied after the plan.
  writeFileSync(join(clean, "late.txt"), "late\n");
  stale(first.planRevision, "k1");
  // Cleaned after the plan.
  const second = w.plan();
  rmFile(join(clean, "late.txt"));
  stale(second.planRevision, "k2");
  // Created after the plan.
  const third = w.plan();
  const created = w.tree("created", "agents/plan-created");
  stale(third.planRevision, "k3");
  // The target taken after the plan.
  const fourth = w.plan();
  mkdirSync(w.retained("agents-plan-dirty"), { recursive: true });
  stale(fourth.planRevision, "k4");
  // Unchanged: the apply does what the plan said.
  const fifth = w.plan();
  const r = w.apply(fifth.planRevision, "k5");
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const done = JSON.parse(r.stdout); // the receipt, printed whole
  assert.deepEqual(done.extraWorktrees, fifth.facts.extraWorktrees.map((x) => ({ ...x, outcome: x.disposition === "remove" ? "removed" : "retained" })));
  assert.equal(w.registered(created), false);
  assert.equal(done.extraWorktrees.find((x) => x.path === dirty).movedTo, w.retained("agents-plan-dirty-2"));
});

test("a retire given a plan's rows refuses as stale when the trees no longer read that way, before touching any", async (t) => {
  const w = await instance(t, "dev-bound");
  const path = w.tree("bound", "agents/bound");
  const planned = w.plan().facts.extraWorktrees;
  writeFileSync(join(path, "x.txt"), "x\n");
  await assert.rejects(() => w.retire({ plannedExtraWorktrees: planned }), (e) => e.code === "E_PLAN_STALE");
  assert.equal(existsSync(w.home), true);
  assert.equal(w.registered(path), true);
  assert.equal(w.registered(join(w.home, "work")), true, "work/ is untouched");
});

test("a planned self-retire carries the plan's trees to its deferred completion, which refuses as stale on a tree the plan did not name", async (t) => {
  const w = await instance(t, "dev-self");
  const planned = w.plan().facts.extraWorktrees;
  assert.deepEqual(planned, []);
  const scheduled = await w.fx.inEnv(() => retireInstance(w.fx.root, "dev-self", { self: true, selfKillDelaySec: 600, tmuxSession: "oats-test-nosuch", plannedExtraWorktrees: planned }));
  assert.equal(scheduled.deferred, true);
  // The completion is run here instead: the scheduled one, which the marker names, is gone first.
  await killAndReap(scheduled.completionPid);
  const intent = JSON.parse(readFileSync(scheduled.pendingMarker, "utf8"));
  assert.deepEqual(intent.options.plannedExtraWorktrees, [], "the intent carries the binding, empty included");
  const late = w.tree("late", "agents/late");
  writeFileSync(join(late, "x.txt"), "x\n");
  const ok = await w.fx.inEnv(() => completeDeferredRetirement(intent, { delaySec: 0, quiesce: false }));
  assert.equal(ok, false);
  assert.equal(JSON.parse(readFileSync(intent.resultPath, "utf8")).error.code, "E_PLAN_STALE");
  assert.equal(existsSync(w.home), true, "the home is kept");
  assert.equal(w.registered(late), true, "the unplanned tree was not moved");
});

test("the step does not depend on the work mode: a directory-mode home's extra trees are handled", async (t) => {
  const w = await instance(t, "dev-directory", { work: "directory" });
  assert.equal(lstatSync(join(w.home, "work")).isDirectory(), true);
  const clean = w.tree("clean", "agents/dir-clean");
  const dirty = w.tree("dirty", "agents/dir-dirty");
  writeFileSync(join(dirty, "x.txt"), "x\n");
  const r = await w.retire();
  assert.deepEqual(r.extraWorktrees.map((x) => [x.path, x.outcome]), [[clean, "removed"], [dirty, "retained"]]);
  assert.equal(readFileSync(join(w.retained("agents-dir-dirty"), "x.txt"), "utf8"), "x\n");
  assert.equal(existsSync(w.home), false);
});

function rmFile(p) { execFileSync("rm", ["-f", p]); }

test("a tree made by `oats worktree add` (#796) is retired exactly like a raw-git one; its record is not changed home bytes", async (t) => {
  const w = await instance(t, "dev-added");
  const add = w.fx.cli(["worktree", "add", "--purpose", "added", "--branch", "agents/dev-added-x", "--base", "main", "--json"], { cwd: w.home, env: { OATS_INSTANCE_HOME: w.home } });
  assert.equal(add.status, 0, add.stderr + add.stdout);
  const path = join(w.home, ".work-added");
  assert.ok(existsSync(join(w.home, ".oats", "trees", "added.json")), "add recorded the tree");
  const plan = w.plan();
  assert.deepEqual(plan.facts.extraWorktrees, [{ path, repo: w.fx.member, branch: "agents/dev-added-x", detachedAt: null, disposition: "remove", movedTo: null, reason: null }]);
  const tip = w.branchTip("agents/dev-added-x");
  const r = await w.retire();
  assert.equal(r.extraWorktrees[0].outcome, "removed");
  assert.equal(r.workRecovery?.classes?.includes("changed instance-home bytes") ?? false, false, JSON.stringify(r.workRecovery));
  assert.equal(existsSync(w.home), false);
  assert.equal(w.registered(path), false);
  assert.equal(w.branchTip("agents/dev-added-x"), tip, "its branch stays in the clone");
});

// ---- #658: each tree's note fits what the Desktop reads (at most 64 notes, each at most 4096 characters) ----

const SEE = "facts.extraWorktrees in the plan JSON";
/** The plan's notes, each checked against the Desktop's limits. */
function boundedNotes(plan) {
  assert.ok(plan.notes.length <= 64, `at most 64 notes: ${plan.notes.length}`);
  for (const note of plan.notes) assert.ok(note.length <= 4096, `a note of ${note.length} characters: ${note.slice(0, 200)}…`);
  return plan.notes;
}
/** A branch name of about 3900 characters, in components Git can store as files. */
const LONG_BRANCH = Array.from({ length: 16 }, (_, i) => `${String(i).padStart(2, "0")}${"b".repeat(243)}`).join("/");

test("a tree whose branch name is too long for its note: the note keeps the tree's path and names the plan JSON for its HEAD; a re-home target is written out, its last component bounded however long the branch", async (t) => {
  const w = await instance(t, "dev-longbranch");
  // Git writes the longer branch as refs/heads/<name>.lock: a path that macOS does not open.
  const skip = pathLimitSkip(join(w.fx.member, ".git", "refs", "heads", `${LONG_BRANCH}-d.lock`).length, dirname(w.fx.member));
  if (skip) { t.skip(skip); return; }
  const clean = w.tree("clean", LONG_BRANCH);
  const dirty = w.tree("dirty", `${LONG_BRANCH}-d`);
  writeFileSync(join(dirty, "x.txt"), "x\n");
  const plan = w.plan();
  const notes = boundedNotes(plan);
  const rows = Object.fromEntries(plan.facts.extraWorktrees.map((r) => [r.path, r]));
  assert.equal(rows[clean].branch, LONG_BRANCH, "the plan JSON has the whole name");
  assert.ok(`extra worktree ${clean} (branch ${LONG_BRANCH}) is clean and would be removed; its branch and commits stay in ${w.fx.member}`.length > 4096, "fixture premise: the full note is too long");
  assert.ok(notes.includes(`extra worktree ${clean} (its HEAD: see ${SEE}) is clean and would be removed; its branch and commits stay in ${w.fx.member}`), notes.join("\n"));
  // Re-homed: the branch is the longest part and goes to the plan JSON. The target is named after the
  // branch, but its last component is cut to a bound (#821), so it is short, fits and is written out; the
  // reason stays.
  assert.equal(rows[dirty].disposition, "retain");
  assert.equal(dirname(rows[dirty].movedTo), dirname(w.retained("leaf")));
  assert.ok(Buffer.byteLength(basename(rows[dirty].movedTo)) <= RETAINED_LEAF_MAX + 8, `the target's last component is bounded: ${basename(rows[dirty].movedTo)}`);
  assert.ok(notes.includes(`extra worktree ${dirty} (its HEAD: see ${SEE}) would be re-homed to ${rows[dirty].movedTo}: ${rows[dirty].reason}`), notes.join("\n"));
});

/** `w`'s deployment spelled in `length` characters, through links in its parent that lead back to it: the
 *  paths of a plan read with `--dir <that>` are that spelling. */
function spelledDeployment(w, length) {
  const base = dirname(w.fx.dep);
  let need = length - w.fx.dep.length;
  const links = [];
  while (need > 0) {
    const segment = need > 251 ? (need - 251 < 2 ? 249 : 251) : need;
    const name = "l".repeat(segment - 1);
    try { lstatSync(join(base, name)); } catch { symlinkSync(".", join(base, name)); }
    links.push(name); need -= segment;
  }
  const dep = [base, ...links, "deployment"].join("/");
  assert.equal(dep.length, length); assert.equal(realpathSync(dep), w.fx.dep);
  return dep;
}

test("a tree whose path alone is too long for its note is named by where it is listed, and a path that fits is never cut", async (t) => {
  const w = await instance(t, "dev-deeptree");
  const base = dirname(w.fx.dep);
  const spelled = (length) => spelledDeployment(w, length);
  w.tree("deep", "agents/deep");
  const planAt = (dep) => { const p = w.fx.cli(["retire", "dev-deeptree", "--plan", "--json", "--dir", dep]); assert.equal(p.status, 0, p.stderr + p.stdout); return p.json().result; };
  const treeAt = (dep) => `${dep}/agents/dev/instances/dev-deeptree/.work-deep`;
  // The tree's other parts are short here, shorter than the pointers to the plan JSON that would replace
  // them: the full note is the shortest one, `rest` characters beside the path.
  const full = (path) => `extra worktree ${path} (branch agents/deep) is clean and would be removed; its branch and commits stay in ${w.fx.member}`;
  const rest = full("").length;
  // The longest path the plan opens: the .git of the tree whose path is one character too long.
  const skip = pathLimitSkip(4096 - rest + 1 + "/.git".length, base);
  if (skip) { t.skip(skip); return; }
  // A note of exactly 4096 characters: whole.
  let dep = spelled(4096 - rest - treeAt("").length);
  let plan = planAt(dep);
  assert.equal(plan.facts.extraWorktrees[0].path, treeAt(dep));
  assert.equal(plan.facts.extraWorktrees[0].disposition, "remove", JSON.stringify(plan.facts.extraWorktrees[0]));
  assert.equal(full(treeAt(dep)).length, 4096, "fixture premise");
  assert.ok(boundedNotes(plan).includes(full(treeAt(dep))), plan.notes.join("\n"));
  // One character more: the note says the path is too long and where the tree is listed.
  dep = spelled(4096 - rest - treeAt("").length + 1);
  plan = planAt(dep);
  assert.equal(plan.facts.extraWorktrees[0].path, treeAt(dep), "the plan JSON has the whole path");
  const notes = boundedNotes(plan);
  assert.ok(notes.includes(`an extra worktree whose path is too long for this note would be removed; ${SEE} lists it`), notes.join("\n"));
  assert.equal(notes.some((n) => n.includes(".work-deep")), false, "no note holds a cut piece of the path");
});

test("a re-homed tree whose path and target together are too long for its note: the note keeps the tree's path and names the plan JSON for the target", async (t) => {
  const w = await instance(t, "dev-deeptarget");
  const base = dirname(w.fx.dep);
  writeFileSync(join(w.tree("deep", "agents/deep"), "x.txt"), "x\n");
  const planAt = (dep) => { const p = w.fx.cli(["retire", "dev-deeptarget", "--plan", "--json", "--dir", dep]); assert.equal(p.status, 0, p.stderr + p.stdout); return p.json().result; };
  const treeAt = (dep) => `${dep}/agents/dev/instances/dev-deeptarget/.work-deep`;
  // The target is under the deployment, as the tree is: a long spelling of the deployment makes both
  // long, whatever the bound on the target's last component.
  const targetAt = (dep) => `${dep}/.agents/worktrees/ws/agents-deep`;
  const { reason } = w.plan().facts.extraWorktrees[0];
  const full = (dep) => `extra worktree ${treeAt(dep)} (branch agents/deep) would be re-homed to ${targetAt(dep)}: ${reason}`;
  // The spelling is in the path and in the target: each character of it is two of the note's.
  const fits = Math.floor((4096 - full("").length) / 2);
  // The longest path the plan opens: the .git of the tree under the longer spelling.
  const skip = pathLimitSkip(treeAt("").length + fits + 1 + "/.git".length, base);
  if (skip) { t.skip(skip); return; }
  // The longest spelling whose note fits: whole, the target written out.
  let dep = spelledDeployment(w, fits);
  let plan = planAt(dep);
  assert.deepEqual(plan.facts.extraWorktrees.map((r) => [r.path, r.disposition, r.movedTo]), [[treeAt(dep), "retain", targetAt(dep)]]);
  assert.ok(full(dep).length === 4095 || full(dep).length === 4096, `fixture premise: ${full(dep).length}`);
  assert.ok(boundedNotes(plan).includes(full(dep)), plan.notes.join("\n"));
  // One character more: the path still fits, the path and the target together do not. The target is the
  // longest part and goes to the plan JSON; the branch and the reason stay.
  dep = spelledDeployment(w, fits + 1);
  plan = planAt(dep);
  assert.ok(full(dep).length > 4096, `fixture premise: ${full(dep).length}`);
  assert.deepEqual(plan.facts.extraWorktrees.map((r) => [r.path, r.disposition, r.movedTo]), [[treeAt(dep), "retain", targetAt(dep)]], "the plan JSON has the whole target");
  const notes = boundedNotes(plan);
  assert.ok(notes.includes(`extra worktree ${treeAt(dep)} (branch agents/deep) would be re-homed to the path ${SEE} names: ${reason}`), notes.join("\n"));
  assert.equal(notes.some((n) => n.includes("/.agents/worktrees")), false, "no note holds a cut piece of the target");
});

test("more extra trees than 64 notes hold: the last tree note counts the rest, and the plan JSON lists every tree", async (t) => {
  const w = await instance(t, "dev-manytrees");
  const commit = w.git(w.fx.member, "rev-parse", "HEAD");
  const paths = Array.from({ length: 70 }, (_, i) => {
    const path = join(w.home, `.work-${String(i).padStart(2, "0")}`);
    w.git(w.fx.member, "worktree", "add", "-q", "-b", `agents/many-${i}`, path, commit);
    return path;
  });
  const plan = w.plan();
  const notes = boundedNotes(plan);
  assert.equal(notes.length, 64, "the cap is reached exactly");
  assert.deepEqual(plan.facts.extraWorktrees.map((r) => r.path), paths, "the plan JSON lists all 70");
  const shown = notes.filter((n) => n.startsWith("extra worktree "));
  assert.deepEqual(shown.map((n) => n.split(" ")[2]), paths.slice(0, shown.length), "the first trees, in order");
  const more = notes.indexOf(notes.find((n) => n.startsWith("and ")));
  assert.equal(notes[more], `and ${70 - shown.length} more extra worktrees (${SEE} lists every one)`);
  assert.equal(more, notes.indexOf(shown.at(-1)) + 1, "right after the last tree note");
});
