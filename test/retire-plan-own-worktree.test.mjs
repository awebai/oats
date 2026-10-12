// A retire plan says as a fact whether `work/` is the instance's own work tree, the one the retire
// retains or removes (awebai/oats#988): `facts.ownWorktree`, a boolean, the answer of the one
// reading of `work/` that the retire acts on (core instanceWork). `facts.workMode` is the record's
// value, which the instance can write, and `facts.work` observes through any link: neither says
// whose tree it is. `defaults.retainWorktree` is the default of one option, and follows the fact
// today; a client reads neither as the other, so every row here states both. Every case runs the
// real CLI against a scratch deployment.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const SOULS = { dev: { soul: { work: "worktree" } }, dir: { soul: { work: "directory" } }, wsp: { soul: { work: "workspace" } }, chk: { soul: { work: "checkout" } } };

/** A scratch deployment whose directory is a Git checkout (so that a workspace instance's link
 *  leads to a repository), and what the cases do in it. */
function deployment(t) {
  const fx = v2Deployment({ souls: SOULS, t });
  const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", env: fx.env, stdio: ["ignore", "pipe", "pipe"] }).trim();
  execFileSync("git", ["init", "-q", fx.dep], { env: fx.env });
  git(fx.dep, "commit", "--allow-empty", "-qm", "the deployment is a checkout");
  const envelope = (r) => { try { return r.json(); } catch { assert.fail(`no envelope: ${r.stdout}${r.stderr}`); } };
  const plan = (instance) => { const e = envelope(fx.cli(["retire", instance, "--plan", "--json"])); assert.equal(e.ok, true, JSON.stringify(e.error)); return e.result; };
  const record = (home, change) => {
    const path = join(home, "instance.json"), meta = JSON.parse(readFileSync(path, "utf8"));
    change(meta);
    writeFileSync(path, JSON.stringify(meta, null, 2) + "\n");
  };
  /** An instance attached to `owner`'s work/: a home that was given a link. */
  const attached = (owner, purpose) => {
    const e = envelope(fx.cli(["spawn", "dev", "--work", "attached", "--work-dir", join(owner.home, "work"), "--repo", fx.member, "--purpose", purpose, "--no-launch", "--json"]));
    assert.equal(e.ok, true, JSON.stringify(e.error));
    return e.result;
  };
  return { fx, git, envelope, plan, record, attached };
}

/** Both values of one row, each stated: the fact, and the default that follows it today. */
function assertRow(seen, own, label) {
  assert.equal(Object.hasOwn(seen.facts, "ownWorktree"), true, `${label}: the key is always present`);
  assert.equal(seen.facts.ownWorktree, own, `${label}: facts.ownWorktree`);
  assert.equal(seen.defaults.retainWorktree, own, `${label}: defaults.retainWorktree`);
}

test("facts.ownWorktree is true exactly when work/ is the instance's own tree, whatever the record says and whatever a link leads to; defaults.retainWorktree is stated beside it in every row (#988)", async (t) => {
  const d = deployment(t);
  const owner = await d.fx.spawn("dev", { instance: "dev-owner" });
  const ownerWork = join(owner.home, "work");

  // A worktree instance with its own tree.
  const own = d.plan(owner.instance);
  assertRow(own, true, "a worktree instance with its own tree");
  assert.equal(own.facts.workMode, "worktree");

  // A record with no work mode whose work/ Git confirms is a registered worktree (#962).
  const bare = await d.fx.spawn("dev", { instance: "dev-no-mode" });
  d.record(bare.home, (meta) => { delete meta.work; delete meta.repo; delete meta.branch; });
  const noMode = d.plan(bare.instance);
  assertRow(noMode, true, "no work mode, a registered worktree at work/");
  assert.equal(noMode.facts.workMode, null);

  // A directory home.
  const dir = await d.fx.spawn("dir", { instance: "dir-a" });
  const directory = d.plan(dir.instance);
  assertRow(directory, false, "a directory home");
  assert.equal(directory.facts.workMode, "directory");

  // A link at work/ under a record that says worktree (#973).
  const linked = d.attached(owner, "linked");
  d.record(linked.home, (meta) => { meta.work = "worktree"; });
  const link = d.plan(linked.instance);
  assertRow(link, false, "a link under a worktree record");
  assert.equal(link.facts.workMode, "worktree", "the record's value says worktree, and the fact says it is not the instance's");
  assert.equal(link.facts.work.observed, true, "and what the link leads to is observed");

  // A real directory that is not the own tree, under a record that says worktree (#962): the
  // spawn's receipt says that no tree was given.
  const real = d.attached(owner, "real-directory");
  rmSync(join(real.home, "work")); mkdirSync(join(real.home, "work")); writeFileSync(join(real.home, "work", "a.txt"), "bytes of the home\n");
  d.record(real.home, (meta) => { meta.work = "worktree"; });
  const homeDirectory = d.plan(real.instance);
  assertRow(homeDirectory, false, "a directory of the home under a worktree record");
  assert.equal(homeDirectory.facts.workMode, "worktree");

  // A checkout and a workspace instance.
  const chk = await d.fx.spawn("chk", { instance: "chk-a" });
  assertRow(d.plan(chk.instance), false, "a checkout instance");
  const wsp = await d.fx.spawn("wsp", { instance: "wsp-a" });
  assertRow(d.plan(wsp.instance), false, "a workspace instance");

  // A worktree record whose work/ is gone: the reading answers the own tree by the record (nothing
  // is there to say otherwise), the retire runs its worktree step and finds the tree absent.
  const gone = await d.fx.spawn("dev", { instance: "dev-gone" });
  d.git(d.fx.member, "worktree", "remove", "--force", join(gone.home, "work"));
  const absent = d.plan(gone.instance);
  assertRow(absent, true, "a worktree record whose work/ is gone");
  assert.deepEqual(absent.facts.work, { observed: false, reason: "no-worktree" });

  // An attached instance over a tree on another branch: observed, drifted, and not its own. Last:
  // the owner's tree moves to another branch.
  const kid = d.attached(owner, "kid");
  d.git(ownerWork, "checkout", "-q", "-b", "elsewhere");
  const drifted = d.plan(kid.instance);
  assertRow(drifted, false, "an attached instance over a tree on another branch");
  assert.equal(drifted.facts.workMode, "attached");
  assert.equal(drifted.facts.work.drift, true, "fixture premise: the tree is not on the recorded branch");
  // The owner's own plan, with the same observation of the same tree: its own.
  assertRow(d.plan(owner.instance), true, "the owner of that tree");
});

test("for an entry at work/ that no retire removes, the fact is the reading's answer and not a promise: a file is the own tree under a worktree record alone, and a work directory whose Git admin entry is missing is the own tree by the spawn's receipt, whatever the record says (#988, #1019)", async (t) => {
  const d = deployment(t);
  const owner = await d.fx.spawn("dev", { instance: "dev-owner" });
  /** `home`'s work/ made a file, whatever it was: a registered tree, a link or a directory. */
  const fileAt = (home) => {
    const work = join(home, "work");
    if (lstatSync(work).isSymbolicLink()) rmSync(work);
    else if (existsSync(join(work, ".git"))) d.git(d.fx.member, "worktree", "remove", "--force", work);
    else rmSync(work, { recursive: true });
    writeFileSync(work, "a file where work/ was\n");
    assert.equal(lstatSync(work).isFile(), true);
  };

  // A file at work/, in a home of each work mode as it was given. An entry that is neither a link
  // nor a directory is what the record says: the own tree under `worktree`, and nothing of the
  // instance's under any other record.
  const given = [
    ["worktree", await d.fx.spawn("dev", { instance: "dev-file" }), true],
    ["attached", d.attached(owner, "file"), false],
    ["checkout", await d.fx.spawn("chk", { instance: "chk-file" }), false],
    ["workspace", await d.fx.spawn("wsp", { instance: "wsp-file" }), false],
    ["directory", await d.fx.spawn("dir", { instance: "dir-file" }), false],
  ];
  for (const [mode, inst, own] of given) {
    fileAt(inst.home);
    const seen = d.plan(inst.instance);
    assertRow(seen, own, `a file at work/ under a record that says ${mode}`);
    assert.equal(seen.facts.workMode, mode);
  }
  // The same file under each other record of the same home: the record alone decides, not what
  // the home was given.
  const [, rewritten] = given[0];
  for (const [label, work, own] of [["attached", "attached", false], ["no work mode", undefined, false], ["a work mode this kernel does not know", "elsewhere", false], ["worktree again", "worktree", true]]) {
    d.record(rewritten.home, (meta) => { if (work === undefined) delete meta.work; else meta.work = work; });
    const seen = d.plan(rewritten.instance);
    assertRow(seen, own, `a file at work/ in a home that was given a worktree, its record saying ${label}`);
    assert.equal(seen.facts.workMode, work ?? null);
  }

  // A work directory whose Git admin entry is missing (the retire runs its hooks and keeps it as
  // an incomplete item). The spawn's receipt says that a tree was given, so it is the own tree
  // under every record but `directory`, which the retire holds against the receipt.
  const orphan = await d.fx.spawn("dev", { instance: "dev-orphan" });
  const work = join(orphan.home, "work");
  rmSync(d.git(work, "rev-parse", "--path-format=absolute", "--git-dir"), { recursive: true });
  assert.throws(() => d.git(work, "rev-parse", "--git-dir"), "fixture premise: Git no longer knows the directory");
  assert.equal(lstatSync(work).isDirectory(), true);
  for (const [label, mode, own] of [["worktree", "worktree", true], ["attached", "attached", true], ["no work mode", undefined, true], ["directory", "directory", false]]) {
    d.record(orphan.home, (meta) => { if (mode === undefined) delete meta.work; else meta.work = mode; });
    const seen = d.plan(orphan.instance);
    assertRow(seen, own, `a work directory without its admin entry, the record saying ${label}`);
    assert.equal(seen.facts.workMode, mode ?? null);
  }
});

test("every answer that holds a retire plan holds the fact: the plan, and the fresh plan of a stale guarded apply; a stop plan does not; the feature word is listed (#988)", async (t) => {
  const d = deployment(t);
  const owner = await d.fx.spawn("dev", { instance: "dev-owner" });
  const kid = d.attached(owner, "kid");
  for (const [inst, own] of [[owner, true], [kid, false]]) {
    const stale = d.envelope(d.fx.cli(["retire", inst.instance, "--plan-revision", "0".repeat(24), "--idempotency-key", `stale-${own}`, "--json"]));
    assert.equal(stale.ok, false);
    assert.equal(stale.error.code, "E_PLAN_STALE", stale.error.message);
    assertRow(stale.error.details.plan, own, `E_PLAN_STALE details.plan of ${inst.instance}`);
    assert.deepEqual({ ...stale.error.details.plan, at: null }, { ...d.plan(inst.instance), at: null }, "the same builder: the plan as it reads now");
    // A stop plan carries no such key, in the plan or in any of its targets.
    const stop = d.envelope(d.fx.cli(["instance", "stop", inst.instance, "--plan", "--json"]));
    assert.equal(stop.ok, true, JSON.stringify(stop.error));
    assert.equal(stop.result.action, "stop");
    assert.doesNotMatch(JSON.stringify(stop.result), /ownWorktree/);
  }
  // The text of a plan is what it was: the fact is in the JSON alone.
  const text = d.fx.cli(["retire", owner.instance, "--plan"]);
  assert.equal(text.status, 0, text.stdout + text.stderr);
  assert.doesNotMatch(text.stdout, /ownWorktree|own worktree/);
  const version = JSON.parse(d.fx.cli(["version", "--json"]).stdout);
  assert.ok(version.features.includes("retire-plan-own-worktree"), JSON.stringify(version.features));
});
