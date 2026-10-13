// A retire plan's revision binds the record's work mode and the reading of `work/`, in every home
// (awebai/oats#1065).
//
// A plan's revision is hashed from the facts that make the retire safe, and a guarded apply is
// refused `E_PLAN_STALE` when one of them moved since the plan was shown. What the retire does with
// `work/` follows from two things: the record's work mode, which the instance can write, and what
// `work/` is by the one reading the retire makes too (core instanceWork). Before #1065 the reading
// was bound only where its answer was not the one the mode alone gives (#962, #973), and the mode
// itself was in no revision: wherever the reading follows the record, the record could be rewritten
// between a plan and its apply and the revision did not move. Two plans that showed different
// things shared one revision, and with nothing at `work/` the apply went through.
//
// What the tests below hold, through the real CLI against a scratch deployment:
//   - the property, over each thing at `work/` and every record of one home: two plans that differ
//     in `facts.workMode`, `facts.ownWorktree`, `defaults.retainWorktree`, a note or the text's
//     `defaults:` line never share a revision;
//   - a guarded apply with a plan's revision after the record was rewritten is refused as stale,
//     with the fresh plan, before any effect: where it went through, and where the retire refused
//     for a reason of its own;
//   - the reading is bound by itself: with the record, the session and Git's answer as they were,
//     a plan is stale once the spawn's receipt says that no tree was given and the same directory
//     reads as a directory of the home;
//   - the repository Git names for work/ is bound wherever work/ is a registered work tree, a
//     directory of the home included: with the record, the receipt and Git's answer as they were,
//     a plan is stale once work/ is a work tree of another repository, or was none and is one;
//   - what the plan reports of the record is bound, field by field: a rewrite of any field of the
//     record that a retire plan reads either leaves the plan as it was, whole, or gives it another
//     revision, and the apply is then stale before any hook; in a home without its session receipt
//     the record decides what the plan shows of the session, and each such plan has its revision;
//   - what a plan shows of other homes' records is bound too: the children attached to this work
//     and the edges it could not follow;
//   - and the other half: two reads of a home nobody touched give one revision, in every session
//     state these fixtures reach, the ones that are not established included;
//   - what a client relies on: the revision's form, the fresh plan in the refusal, and a repeated
//     apply with the same key answered from its stored receipt whatever revision it carries;
//   - the revision of a plain `worktree` home is not the one the rule before #1065 gave it: every
//     home's plan has a new revision once, and that is meant.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { killAndReap, waitUntil } from "./helpers/host-fixture.mjs";

/** A retire hook that records each run in `<agents root>/retire-hook-ran-<instance>`, outside every home. */
const HOOK = `import { appendFileSync } from "node:fs";
import { join } from "node:path";
appendFileSync(join(process.env.OATS_ROOT, "retire-hook-ran-" + process.env.OATS_INSTANCE), "ran\\n");
console.log(JSON.stringify({ meta: { retired: true } }));
`;
const CAPABILITY = "test.plan-revision";

/** The records of one home the property is held over: each work mode the kernel knows, none, and a
 *  value it does not know. `undefined` is a record without the key. */
const RECORDS = [["worktree", "worktree"], ["attached", "attached"], ["checkout", "checkout"], ["workspace", "workspace"], ["directory", "directory"], ["none", undefined], ["unknown", "elsewhere"]];
const FORM = /^[0-9a-f]{24}$/;

/** A scratch deployment whose soul `dev` works in a worktree and has a retire hook, and what the
 *  cases do in it. */
function deployment(t) {
  const fx = v2Deployment({ t,
    souls: { dev: { soul: { work: "worktree", capabilities: { [CAPABILITY]: { from: "here" } } } } },
    capabilities: { [CAPABILITY]: { manifest: { hooks: { retire: "hook.mjs" } }, files: { "hook.mjs": HOOK } } },
  });
  // An in-process spawn looks for the harness's executable on this process's PATH, with
  // `launch: false` too: the fixture's PATH has the inert harnesses, a bare runner's has none.
  const hostPath = process.env.PATH; process.env.PATH = fx.env.PATH; t.after(() => { process.env.PATH = hostPath; });
  const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", env: fx.env, stdio: ["ignore", "pipe", "pipe"] }).trim();
  const envelope = (r) => { try { return r.json(); } catch { assert.fail(`no envelope: ${r.stdout}${r.stderr}`); } };
  /** `--home <home>` for a name that more than one home has. */
  const at = (home) => (home === undefined ? [] : ["--home", home]);
  const d = {
    fx, git, envelope,
    /** The retire plan of `instance`, as the CLI answers it. */
    plan(instance, home) { const e = envelope(fx.cli(["retire", instance, "--plan", "--json", ...at(home)])); assert.equal(e.ok, true, `a plan of ${instance}: ${JSON.stringify(e.error)}`); return e.result; },
    /** The plan, read twice: an unchanged home gives the same revision both times, whatever its
     *  session reads as. → the plan. */
    planTwice(instance, home, what = instance) {
      const plan = d.plan(instance, home), again = d.plan(instance, home);
      assert.equal(again.planRevision, plan.planRevision, `${what}: two reads of a home nobody touched, one revision\n${JSON.stringify(plan.facts.session)}\n${JSON.stringify(again.facts.session)}`);
      return plan;
    },
    /** The `defaults:` line of the plan's text. */
    line(instance, home) {
      const r = fx.cli(["retire", instance, "--plan", ...at(home)]);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const lines = r.stdout.split("\n").filter((l) => /^\s*defaults:/.test(l));
      assert.equal(lines.length, 1, `one defaults: line in the text of a plan:\n${r.stdout}`);
      return lines[0].trim();
    },
    /** Write the record's work mode (`undefined`: no such key), and nothing else of it. */
    say(home, mode) {
      const path = join(home, "instance.json"), meta = JSON.parse(readFileSync(path, "utf8"));
      if (mode === undefined) delete meta.work; else meta.work = mode;
      writeFileSync(path, JSON.stringify(meta, null, 2) + "\n");
    },
    record: (home) => JSON.parse(readFileSync(join(home, "instance.json"), "utf8")),
    /** A guarded apply: → `{ status, ok: true, result }` or `{ status, ok: false, error }`. A
     *  retire that is done prints its receipt, over several lines; one that is refused prints the
     *  envelope. */
    apply(instance, revision, key, home) {
      const r = fx.cli(["retire", instance, "--plan-revision", revision, "--idempotency-key", key, "--json", ...at(home)]);
      let out;
      try { out = JSON.parse(r.stdout); } catch { assert.fail(`no JSON: ${r.stdout}${r.stderr}`); }
      return out.ok === false ? { status: r.status, ok: false, error: out.error } : { status: r.status, ok: true, result: out.ok === true ? out.result : out };
    },
    hookRan: (instance) => existsSync(join(fx.root, `retire-hook-ran-${instance}`)),
    /** An instance attached to `owner`'s work/: a home that was given a link. */
    attached(owner, purpose) {
      const e = envelope(fx.cli(["spawn", "dev", "--work", "attached", "--work-dir", join(owner.home, "work"), "--repo", fx.member, "--purpose", purpose, "--no-launch", "--json"]));
      assert.equal(e.ok, true, JSON.stringify(e.error));
      return e.result;
    },
    /** A `worktree` instance whose tree was removed through Git: nothing at work/. */
    async withoutTree(instance) {
      const i = await fx.spawn("dev", { instance });
      git(fx.member, "worktree", "remove", "--force", join(i.home, "work"));
      assert.equal(existsSync(join(i.home, "work")), false);
      return i;
    },
  };
  return d;
}

/** What a plan shows of `work/` and of what the retire does with it: the values that may not
 *  differ between two plans of one revision. */
const shown = (plan, line) => ({ workMode: plan.facts.workMode, ownWorktree: plan.facts.ownWorktree, retainWorktree: plan.defaults.retainWorktree, notes: plan.notes, line });
const same = (a, b) => { try { assert.deepEqual(a, b); return true; } catch { return false; } };
/** A plan without the instant it was read at. */
const timeless = (plan) => ({ ...plan, at: typeof plan.at });

/** A home as `{ <relative path>: what it is }`, links not followed: two that are deep-equal are the
 *  same home. `.oats-events.jsonl` is left out: the home's own log, which a refusal may write to. */
function snapshot(home) {
  const seen = {};
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name), at = rel ? `${rel}/${name}` : name, st = lstatSync(path);
      if (at === ".oats-events.jsonl") continue;
      if (st.isSymbolicLink()) seen[at] = `link ${readlinkSync(path)}`;
      else if (st.isDirectory()) { seen[`${at}/`] = "directory"; walk(path, at); }
      else seen[at] = `file ${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
    }
  };
  walk(home, "");
  return seen;
}

test("two plans of one home that differ in facts.workMode, facts.ownWorktree, defaults.retainWorktree, a note or the text's defaults: line never share a revision: for each thing at work/ (the own tree, nothing, a file, a link, a directory of the home, a work directory without its Git admin entry), over the records worktree, attached, checkout, workspace, directory, none and a mode the kernel does not know (#1065)", async (t) => {
  const d = deployment(t);
  const owner = await d.fx.spawn("dev", { instance: "dev-owner" });
  const things = {
    "the instance's own tree": () => d.fx.spawn("dev", { instance: "dev-tree" }),
    "nothing": () => d.withoutTree("dev-none"),
    "a file": async () => { const i = await d.withoutTree("dev-file"); writeFileSync(join(i.home, "work"), "a file where work/ was\n"); return i; },
    "a link": () => d.attached(owner, "link"),
    "a directory of the home": () => {
      const i = d.attached(owner, "plain");
      rmSync(join(i.home, "work")); mkdirSync(join(i.home, "work")); writeFileSync(join(i.home, "work", "a.txt"), "bytes of the home\n");
      return i;
    },
    "a work directory without its Git admin entry": async () => {
      const i = await d.fx.spawn("dev", { instance: "dev-orphan" }), work = join(i.home, "work");
      rmSync(d.git(work, "rev-parse", "--path-format=absolute", "--git-dir"), { recursive: true });
      assert.throws(() => d.git(work, "rev-parse", "--git-dir"), "fixture premise: Git no longer knows the directory");
      return i;
    },
  };
  let plans = 0;
  for (const [thing, make] of Object.entries(things)) {
    const inst = await make();
    const rows = [];
    for (const [label, mode] of RECORDS) {
      d.say(inst.home, mode);
      const plan = d.plan(inst.instance);
      assert.equal(plan.facts.workMode, mode ?? null, `${thing}, record ${label}: the plan reports the record's value`);
      assert.match(plan.planRevision, FORM, `${thing}, record ${label}: the revision's form`);
      rows.push({ label, revision: plan.planRevision, shown: shown(plan, d.line(inst.instance)) });
      plans++;
    }
    for (const r of rows) t.diagnostic(`${thing} | ${r.label} | ${r.revision.slice(0, 8)} | own ${r.shown.ownWorktree} retain ${r.shown.retainWorktree} notes ${r.shown.notes.length} | ${r.shown.line}`);
    // The property, over every pair of plans of this home.
    for (const [i, a] of rows.entries()) for (const b of rows.slice(i + 1)) {
      if (!same(a.shown, b.shown)) assert.notEqual(a.revision, b.revision, `${thing}: the plans under the records ${a.label} and ${b.label} differ in what they show and share the revision ${a.revision}\n${JSON.stringify(a.shown)}\n${JSON.stringify(b.shown)}`);
    }
    // Every record gives another `facts.workMode`, so the property says seven revisions.
    assert.equal(new Set(rows.map((r) => r.revision)).size, RECORDS.length, `${thing}: one revision per record`);
    // And the revision is of the facts, not of the order they were read in: the first record again.
    d.say(inst.home, RECORDS[0][1]);
    assert.equal(d.plan(inst.instance).planRevision, rows[0].revision, `${thing}: the same home under the same record, the same revision`);
  }
  assert.equal(plans, Object.keys(things).length * RECORDS.length, "every thing under every record gave a plan");
});

test("a guarded apply with a plan's revision after the record's work mode was rewritten is refused E_PLAN_STALE with the fresh plan, before any effect: where the apply went through (nothing at work/, worktree then attached), and where the retire refused for a reason of its own, which the fresh plan's revision still meets (#1065)", async (t) => {
  const d = deployment(t);
  const owner = await d.fx.spawn("dev", { instance: "dev-owner" });
  writeFileSync(join(owner.home, "work", "wip-owner.txt"), "the owner's uncommitted work\n");
  const cases = [
    { what: "nothing at work/, worktree then attached", to: "attached", then: "retired",
      make: () => d.withoutTree("dev-none") },
    { what: "a file at work/, worktree then attached", to: "attached", then: "E_WORK_INSPECTION_FAILED",
      make: async () => { const i = await d.withoutTree("dev-file"); writeFileSync(join(i.home, "work"), "a file where work/ was\n"); return i; } },
    { what: "the own tree with an untracked file, worktree then directory", to: "directory", then: "E_WORK_INSPECTION_FAILED",
      make: async () => { const i = await d.fx.spawn("dev", { instance: "dev-tree" }); writeFileSync(join(i.home, "work", "wip-own.txt"), "uncommitted work\n"); return i; } },
    { what: "a link to an owner's tree, attached then directory", to: "directory", then: "E_WORK_INSPECTION_FAILED",
      make: () => d.attached(owner, "link") },
  ];
  for (const [n, c] of cases.entries()) await t.test(c.what, async () => {
    const inst = await c.make();
    const first = d.plan(inst.instance);
    d.say(inst.home, c.to);
    const fresh = d.plan(inst.instance);
    assert.equal(fresh.facts.workMode, c.to, c.what);
    assert.notEqual(fresh.planRevision, first.planRevision, `${c.what}: the record is part of the revision`);

    const before = snapshot(inst.home), ownerBefore = snapshot(owner.home);
    const stale = d.apply(inst.instance, first.planRevision, `shown-${n}`);
    assert.deepEqual([stale.status, stale.ok, stale.error?.code], [1, false, "E_PLAN_STALE"], `${c.what}: ${JSON.stringify(stale.error ?? stale.result)}`);
    assert.equal(stale.error.message, `the retire plan changed since it was shown (${first.planRevision} → ${fresh.planRevision}); review the fresh plan`, c.what);
    assert.deepEqual(timeless(stale.error.details.plan), timeless(fresh), `${c.what}: the refusal carries the fresh plan, whole`);
    assert.match(stale.error.details.plan.planRevision, FORM);
    // Before any effect: the home is as it was, no hook ran, and the owner's tree is untouched.
    assert.deepEqual(snapshot(inst.home), before, `${c.what}: the home is as it was`);
    assert.deepEqual(snapshot(owner.home), ownerBefore, `${c.what}: the owner's home and tree are as they were`);
    assert.equal(d.hookRan(inst.instance), false, `${c.what}: no retire hook ran`);
    assert.equal(d.plan(inst.instance).planRevision, fresh.planRevision, `${c.what}: and the plan reads as the refusal gave it`);

    // The fresh plan's revision is not stale: the retire goes on to what it does for this home.
    const now = d.apply(inst.instance, fresh.planRevision, `fresh-${n}`);
    if (c.then === "retired") {
      assert.deepEqual([now.status, now.ok, now.result?.retired, now.result?.replayed], [0, true, inst.instance, false], `${c.what}: ${JSON.stringify(now.error ?? now.result)}`);
      assert.equal(existsSync(inst.home), false, `${c.what}: the home is retired`);
      assert.equal(d.hookRan(inst.instance), true);
    } else {
      assert.deepEqual([now.status, now.ok, now.error?.code], [1, false, c.then], `${c.what}: the retire's own refusal, once the plan is not stale: ${JSON.stringify(now.error ?? now.result)}`);
      assert.deepEqual(snapshot(inst.home), before, `${c.what}: and nothing was stopped, run or removed`);
      assert.equal(d.hookRan(inst.instance), false);
    }
  });
  assert.equal(readFileSync(join(owner.home, "work", "wip-owner.txt"), "utf8"), "the owner's uncommitted work\n");
});

test("the reading of work/ is part of the revision by itself: under a record that stays as it is, with the session and what Git says of work/ as they were, a plan read while work/ was the instance's own tree by the spawn's receipt is stale once the receipt says that no tree was given and the same directory reads as a directory of the home (#1065)", async (t) => {
  const d = deployment(t);
  const inst = await d.fx.spawn("dev", { instance: "dev-receipt" });
  // The record says `attached` from here on, and nothing else of it is written below. The spawn's
  // receipt says that a tree was given, so the reading answers the own tree against the record.
  d.say(inst.home, "attached");
  const own = d.plan(inst.instance), ownLine = d.line(inst.instance);
  assert.deepEqual([own.facts.workMode, own.facts.ownWorktree, own.defaults.retainWorktree], ["attached", true, true]);
  // The receipt is made to say that no tree was given, and nothing else of it is touched (the
  // session's receipt is in the same file: a receipt that is gone moves the session's state too,
  // which is part of the revision by itself). The same registered tree is now a directory of the home.
  const baselines = join(dirname(inst.home), ".oats-retirement", "baselines"), files = readdirSync(baselines);
  assert.equal(files.length, 1, `fixture premise: one receipt, this home's: ${files}`);
  const receipt = JSON.parse(readFileSync(join(baselines, files[0]), "utf8"));
  assert.equal(typeof receipt.generatedWorkFingerprint, "string", "fixture premise: the receipt says that a tree was given");
  delete receipt.generatedWorkFingerprint;
  writeFileSync(join(baselines, files[0]), JSON.stringify(receipt, null, 2) + "\n");
  const fresh = d.plan(inst.instance);
  assert.deepEqual([fresh.facts.workMode, fresh.facts.ownWorktree, fresh.defaults.retainWorktree], ["attached", false, false]);
  assert.deepEqual([fresh.facts.session, { ...fresh.facts.work, upstream: null }], [own.facts.session, { ...own.facts.work, upstream: null }], "the session and what Git says of work/ are the same");
  assert.notEqual(d.line(inst.instance), ownLine, "fixture premise: the two plans differ in the text's line too");
  assert.notEqual(fresh.planRevision, own.planRevision, "the two plans differ in the fact and the default under one record: not one revision");
  const before = snapshot(inst.home);
  const stale = d.apply(inst.instance, own.planRevision, "shown-as-own");
  assert.deepEqual([stale.status, stale.ok, stale.error?.code], [1, false, "E_PLAN_STALE"], JSON.stringify(stale.error ?? stale.result));
  assert.deepEqual(timeless(stale.error.details.plan), timeless(fresh), "the refusal carries the fresh plan, whole");
  assert.deepEqual(snapshot(inst.home), before, "the home is as it was");
  assert.equal(d.hookRan(inst.instance), false, "no retire hook ran");
});

test("the repository Git names for work/ is part of the revision for a directory of the home too: under a record and a receipt that stay as they are, with the same commit checked out clean at work/, the plans of a repository of its own, of a registered work tree of one repository and of a registered work tree of another differ in a note and never share a revision, and a guarded apply with the revision of one is stale under the next (#1065)", async (t) => {
  const d = deployment(t);
  const owner = await d.fx.spawn("dev", { instance: "dev-owner" });
  const inst = d.attached(owner, "registered"), work = join(inst.home, "work");
  // Two disposable repositories outside every home that hold one commit: B is a clone of A.
  const a = join(d.fx.base, "repository-a"), b = join(d.fx.base, "repository-b");
  mkdirSync(a);
  d.git(a, "init", "-q");
  d.git(a, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-qm", "one commit");
  const commit = d.git(a, "rev-parse", "HEAD");
  d.git(d.fx.base, "clone", "-q", a, b);
  const registered = (repository) => `work/ is registered as a worktree of ${repository}:`;
  const noteOf = (plan) => plan.notes.filter((note) => note.startsWith("work/ is registered as a worktree of "));
  /** The plan now, with what the case holds fixed stated: the record, the reading, Git's answer. */
  const read = (what) => {
    const plan = d.plan(inst.instance);
    assert.deepEqual([plan.facts.workMode, plan.facts.ownWorktree, plan.defaults.retainWorktree], ["attached", false, false], what);
    assert.deepEqual([plan.facts.work.observed, plan.facts.work.revision, plan.facts.work.branch, plan.facts.work.changed, plan.facts.work.untracked], [true, commit, null, 0, 0], `${what}: Git's answer for work/`);
    return { what, plan, line: d.line(inst.instance) };
  };
  const steps = [];
  // A repository of its own at work/, on that commit, detached and clean: no work tree of another's.
  rmSync(work);
  d.git(d.fx.base, "clone", "-q", a, work);
  d.git(work, "checkout", "-q", "--detach", commit);
  steps.push(read("a repository of its own at work/"));
  assert.deepEqual(noteOf(steps[0].plan), [], "fixture premise: no note of a registered work tree");
  // The same commit as a registered work tree of A, then of B, at the same path.
  rmSync(work, { recursive: true });
  d.git(a, "worktree", "add", "-q", "--detach", work, commit);
  steps.push(read("a registered work tree of repository A"));
  d.git(a, "worktree", "remove", "--force", work);
  d.git(b, "worktree", "add", "-q", "--detach", work, commit);
  steps.push(read("a registered work tree of repository B"));
  for (const [step, repository] of [[steps[1], a], [steps[2], b]]) {
    const notes = noteOf(step.plan);
    assert.equal(notes.length, 1, `${step.what}: ${JSON.stringify(step.plan.notes)}`);
    assert.equal(notes[0].startsWith(registered(realpathSync(repository))), true, `${step.what}: the note names that repository: ${notes[0]}`);
  }
  assert.deepEqual(steps.map((step) => step.plan.facts.session), [steps[0].plan.facts.session, steps[0].plan.facts.session, steps[0].plan.facts.session], "the session is the same throughout");
  // The property: the three plans differ in a note, pairwise, so no two share a revision.
  const shared = [];
  for (const [i, x] of steps.entries()) for (const y of steps.slice(i + 1)) {
    assert.notDeepEqual(x.plan.notes, y.plan.notes, `fixture premise: ${x.what} and ${y.what} differ in a note`);
    if (x.plan.planRevision === y.plan.planRevision) shared.push(`${x.what} / ${y.what}`);
  }
  assert.deepEqual(shared, [], "pairs of plans that differ in a note and share a revision");
  // And the apply: the revision of each earlier plan is stale now, with the plan of repository B.
  const fresh = steps[2].plan, before = snapshot(inst.home);
  for (const [n, earlier] of steps.slice(0, 2).entries()) {
    const stale = d.apply(inst.instance, earlier.plan.planRevision, `shown-${n}`);
    assert.deepEqual([stale.status, stale.ok, stale.error?.code], [1, false, "E_PLAN_STALE"], `${earlier.what}: ${JSON.stringify(stale.error ?? stale.result)}`);
    assert.deepEqual(timeless(stale.error.details.plan), timeless(fresh), `${earlier.what}: the refusal carries the fresh plan, whole`);
    assert.deepEqual(snapshot(inst.home), before, `${earlier.what}: the home is as it was`);
    assert.equal(d.hookRan(inst.instance), false, `${earlier.what}: no retire hook ran`);
  }
});

test("the repository the retire takes from Git because the record names none is part of the revision through the record's own: the plan of an own tree whose record names its repository, and the plan of the same tree once the record names none, differ in a note and do not share a revision (#962, kept by #1065)", async (t) => {
  const d = deployment(t);
  const inst = await d.fx.spawn("dev", { instance: "dev-unnamed" });
  const NOTE = "the record names no repository for the work tree: the retire uses the one Git names for it, ";
  const named = d.plan(inst.instance);
  assert.equal(typeof named.facts.repo, "string", "fixture premise: the record names the repository");
  assert.equal(named.notes.some((note) => note.startsWith(NOTE)), false);
  const path = join(inst.home, "instance.json"), meta = JSON.parse(readFileSync(path, "utf8"));
  delete meta.repo;
  writeFileSync(path, JSON.stringify(meta, null, 2) + "\n");
  const unnamed = d.plan(inst.instance);
  assert.deepEqual([unnamed.facts.repo, unnamed.facts.workMode, unnamed.facts.ownWorktree, unnamed.defaults.retainWorktree], [null, "worktree", true, true]);
  assert.equal(unnamed.notes.filter((note) => note.startsWith(NOTE)).length, 1, JSON.stringify(unnamed.notes));
  assert.deepEqual({ ...unnamed.facts.work, upstream: null }, { ...named.facts.work, upstream: null }, "what Git says of work/ is the same");
  assert.notEqual(unnamed.planRevision, named.planRevision, "the two plans differ in a note: not one revision");
  const stale = d.apply(inst.instance, named.planRevision, "shown-as-named");
  assert.deepEqual([stale.status, stale.ok, stale.error?.code], [1, false, "E_PLAN_STALE"], JSON.stringify(stale.error ?? stale.result));
  assert.deepEqual(timeless(stale.error.details.plan), timeless(unnamed), "the refusal carries the fresh plan, whole");
  assert.equal(d.hookRan(inst.instance), false, "no retire hook ran");
});

/** A plan as a whole, with the text's line, without the instant it was read at and its revision:
 *  everything a plan shows. */
const whole = (plan, line) => ({ ...plan, at: null, planRevision: null, line });

test("a rewrite of any field of the record that a retire plan reads either leaves the plan as it was, whole, or gives it another revision, and a guarded apply with the first revision is then stale before any hook: work, repo, branch, launched, the session's endpoint and target fields, each in turn; the fields a plan reads and does not show leave plan and revision as they were (#1065)", async (t) => {
  const d = deployment(t);
  const inst = await d.fx.spawn("dev", { instance: "dev-fields" });
  const path = join(inst.home, "instance.json"), asSpawned = readFileSync(path, "utf8");
  const rewrite = (change) => { const meta = JSON.parse(asSpawned); change(meta); writeFileSync(path, JSON.stringify(meta, null, 2) + "\n"); };
  const read = (what) => { const plan = d.planTwice(inst.instance, undefined, what); return { plan, shown: whole(plan, d.line(inst.instance)) }; };
  const first = read("as spawned");
  assert.deepEqual([typeof first.plan.facts.repo, typeof first.plan.facts.recordedBranch, first.plan.facts.session.state], ["string", "string", "not-launched"], "fixture premise: a worktree home as spawned, not launched, its record naming its repository and its branch");
  // Each field of the record that planRetire and what it calls read (the list is on the issue), and
  // whether the plan shows another thing once it is rewritten. A field missing here that a plan
  // reads is a hole in this test.
  const REWRITES = [
    ["work: another mode", (m) => { m.work = "attached"; }, true],
    ["work: removed", (m) => { delete m.work; }, true],
    ["work: a mode the kernel does not know", (m) => { m.work = "elsewhere"; }, true],
    ["repo: a path that is no repository", (m) => { m.repo = join(d.fx.base, "no-repository"); }, true],
    ["repo: removed", (m) => { delete m.repo; }, true],
    ["branch: another name", (m) => { m.branch = "agents/some-other-branch"; }, true],
    ["branch: removed", (m) => { delete m.branch; }, true],
    ["branch: the word HEAD", (m) => { m.branch = "HEAD"; }, true],
    ["launched: true, against the session's receipt", (m) => { m.launched = true; }, true],
    ["sessionTarget: set", (m) => { m.sessionTarget = { kind: "elsewhere" }; }, true],
    ["backend: herdr", (m) => { m.backend = "herdr"; }, true],
    // Read, and deciding nothing in a home that was not launched: the endpoint is compared with
    // the receipt's only for a launch, and the prompt's status only excuses a record that says
    // no launch against a receipt that says one.
    ["tmux: another socket, in a home that was not launched", (m) => { m.tmux = { ...(m.tmux ?? {}), socket: join(d.fx.base, "another-socket") }; }, false],
    ["tmux: removed, in a home that was not launched", (m) => { delete m.tmux; }, false],
    ["launchPrompts.status: blocked, in a home that was not launched", (m) => { m.launchPrompts = { ...(m.launchPrompts ?? {}), status: "blocked" }; }, false],
    // Read on the way, and shown by no plan.
    ["instance: another name", (m) => { m.instance = "another-name"; }, false],
    ["agent: another name", (m) => { m.agent = "another-agent"; }, false],
    ["parentInstance: a name", (m) => { m.parentInstance = "nobody"; }, false],
    ["createdAt: another instant", (m) => { m.createdAt = "2001-01-01T00:00:00.000Z"; }, false],
  ];
  const seen = new Map();
  for (const [n, [what, change, moves]] of REWRITES.entries()) {
    rewrite(change);
    const now = read(what);
    seen.set(what, now);
    assert.equal(!same(now.shown, first.shown), moves, `${what}: the plan ${moves ? "shows another thing" : "is what it was, whole"}\n${JSON.stringify(now.shown)}\n${JSON.stringify(first.shown)}`);
    if (!moves) { assert.equal(now.plan.planRevision, first.plan.planRevision, `${what}: and so is its revision`); continue; }
    assert.match(now.plan.planRevision, FORM);
    assert.notEqual(now.plan.planRevision, first.plan.planRevision, `${what}: the plan shows another thing under the revision ${first.plan.planRevision}`);
    const stale = d.apply(inst.instance, first.plan.planRevision, `as-spawned-${n}`);
    assert.deepEqual([stale.status, stale.ok, stale.error?.code], [1, false, "E_PLAN_STALE"], `${what}: ${JSON.stringify(stale.error ?? stale.result)}`);
    assert.deepEqual(timeless(stale.error.details.plan), timeless(now.plan), `${what}: the refusal carries the fresh plan, whole`);
    assert.equal(d.hookRan(inst.instance), false, `${what}: no retire hook ran`);
    assert.equal(existsSync(join(inst.home, "work", ".git")), true, `${what}: the tree is where it was`);
  }
  // Every pair of these plans, not only each against the first: what differs has another revision.
  const all = [["as spawned", first], ...seen];
  for (const [i, [a, x]] of all.entries()) for (const [b, y] of all.slice(i + 1)) {
    if (!same(x.shown, y.shown)) assert.notEqual(x.plan.planRevision, y.plan.planRevision, `the plans after "${a}" and after "${b}" differ in what they show and share a revision`);
  }
  // The word HEAD and no branch are one value to a plan (a home from before #641).
  assert.deepEqual(seen.get("branch: the word HEAD").shown, seen.get("branch: removed").shown);
  writeFileSync(path, asSpawned);
  assert.equal(d.plan(inst.instance).planRevision, first.plan.planRevision, "the record as spawned again: the first revision");
});

test("in a home without its session receipt the record decides what the plan shows of the session, and each of those plans has a revision of its own: no launch recorded, a launch with no endpoint, an endpoint on one socket, on another, another window (#1065)", async (t) => {
  const d = deployment(t);
  const inst = await d.fx.spawn("dev", { instance: "dev-legacy" });
  const baselines = join(dirname(inst.home), ".oats-retirement", "baselines"), files = readdirSync(baselines);
  assert.equal(files.length, 1, `fixture premise: one receipt, this home's: ${files}`);
  rmSync(join(baselines, files[0]));
  const path = join(inst.home, "instance.json"), asSpawned = readFileSync(path, "utf8");
  const rewrite = (change) => { const meta = JSON.parse(asSpawned); change(meta); writeFileSync(path, JSON.stringify(meta, null, 2) + "\n"); };
  const socket = (name) => join(d.fx.base, name);
  const STATES = [
    ["no launch recorded", (m) => { m.launched = false; delete m.tmux; }],
    ["a launch with no endpoint", (m) => { m.launched = true; delete m.tmux; }],
    ["a launch with an incomplete endpoint", (m) => { m.launched = true; m.tmux = { session: "s" }; }],
    ["an endpoint on one socket", (m) => { m.launched = true; m.tmux = { session: "s", window: "w", socket: socket("no-server-a") }; }],
    ["the same on another socket", (m) => { m.launched = true; m.tmux = { session: "s", window: "w", socket: socket("no-server-b") }; }],
  ];
  const rows = STATES.map(([what, change]) => {
    rewrite(change);
    const plan = d.planTwice(inst.instance, undefined, what);
    assert.equal(typeof plan.facts.session.note, "string", `${what}: fixture premise, the session is read without its receipt: ${JSON.stringify(plan.facts.session)}`);
    t.diagnostic(`${what} | ${plan.planRevision.slice(0, 8)} | ${plan.facts.session.state} | ${plan.facts.session.note.replaceAll(d.fx.base, "<base>")}`);
    return { what, plan, shown: whole(plan, d.line(inst.instance)) };
  });
  // A process that works in the home: the note names it, and two reads name it alike.
  writeFileSync(path, asSpawned);
  const worker = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { cwd: inst.home, stdio: "ignore" });
  try {
    await waitUntil(() => /a process works in this home/.test(d.plan(inst.instance).facts.session.note), "the plan to see the process that works in the home");
    const plan = d.planTwice(inst.instance, undefined, "a process works in the home");
    assert.equal(plan.facts.session.state, "unestablished");
    assert.match(plan.facts.session.note, new RegExp(`pid ${worker.pid} `));
    t.diagnostic(`a process works in the home | ${plan.planRevision.slice(0, 8)} | ${plan.facts.session.state} | ${plan.facts.session.note.replaceAll(d.fx.base, "<base>").replace(/pid \d+/, "pid <n>")}`);
    rows.push({ what: "a process works in the home", plan, shown: whole(plan, d.line(inst.instance)) });
  } finally { await killAndReap(worker.pid); }
  for (const [i, x] of rows.entries()) for (const y of rows.slice(i + 1)) {
    assert.equal(same(x.shown, y.shown), false, `fixture premise: "${x.what}" and "${y.what}" differ in what the plan shows of the session`);
    assert.notEqual(x.plan.planRevision, y.plan.planRevision, `"${x.what}" and "${y.what}" differ in what they show and share the revision ${x.plan.planRevision}`);
  }
});

test("what a plan shows of other homes' records is part of its revision: the children attached to this home's work (a note), and the edges it could not follow because the parent's name is not unique (facts.ambiguous and a note); a child's record rewritten into and out of each gives another revision, and a guarded apply with the earlier one is stale (#1065)", async (t) => {
  const d = deployment(t);
  const parent = await d.fx.spawn("dev", { instance: "dev-parent" });
  const kid = d.attached(parent, "kid");
  const kidPath = join(kid.home, "instance.json"), kidAsSpawned = readFileSync(kidPath, "utf8");
  const kidSays = (change) => { const meta = JSON.parse(kidAsSpawned); change(meta); writeFileSync(kidPath, JSON.stringify(meta, null, 2) + "\n"); };
  assert.equal(JSON.parse(kidAsSpawned).parentInstance, parent.instance, "fixture premise: an attached instance is its owner's child");
  const ATTACHED = /^attached child instance\(s\) .* use this home's work\/ as their work/, AMBIGUOUS = /record this name as parent but the name is not unique/;
  const read = (what, home) => { const plan = d.planTwice(parent.instance, home, what); return { what, plan, shown: whole(plan, d.line(parent.instance, home)) }; };
  const stale = (earlier, fresh, key, home) => {
    assert.equal(same(earlier.shown, fresh.shown), false, `fixture premise: "${earlier.what}" and "${fresh.what}" differ in what the plan shows`);
    assert.notEqual(fresh.plan.planRevision, earlier.plan.planRevision, `"${earlier.what}" and "${fresh.what}" differ in what they show and share the revision ${earlier.plan.planRevision}`);
    const refused = d.apply(parent.instance, earlier.plan.planRevision, key, home);
    assert.deepEqual([refused.status, refused.ok, refused.error?.code], [1, false, "E_PLAN_STALE"], `${fresh.what}: ${JSON.stringify(refused.error ?? refused.result)}`);
    assert.deepEqual(timeless(refused.error.details.plan), timeless(fresh.plan), `${fresh.what}: the refusal carries the fresh plan, whole`);
    assert.equal(d.hookRan(parent.instance), false, `${fresh.what}: no retire hook ran`);
  };

  // The children attached to this work. The child stays a child throughout: only its record's
  // work mode is rewritten, out of `attached` and back.
  const attached = read("a child attached to this work");
  assert.deepEqual([attached.plan.facts.children.map((c) => c.home), attached.plan.notes.filter((n) => ATTACHED.test(n)).length], [[kid.home], 1]);
  kidSays((m) => { m.work = "directory"; });
  const notAttached = read("the same child, its record no longer saying attached");
  assert.deepEqual([notAttached.plan.facts.children.map((c) => c.home), notAttached.plan.notes.filter((n) => ATTACHED.test(n)).length], [[kid.home], 0]);
  stale(attached, notAttached, "shown-with-an-attached-child");
  writeFileSync(kidPath, kidAsSpawned);
  assert.equal(d.plan(parent.instance).planRevision, attached.plan.planRevision, "attached again: the first revision");

  // The edges a plan could not follow. A second home of the parent's name, under another agent,
  // makes the name not unique; the plan is then asked for by its home.
  const twin = join(d.fx.root, "twin", "instances", parent.instance);
  mkdirSync(join(d.fx.root, "twin", "soul"), { recursive: true });
  writeFileSync(join(d.fx.root, "twin", "soul", "soul.yaml"), "name: twin\nwork: directory\n");
  writeFileSync(join(d.fx.root, "twin", "soul", "AGENTS.md"), "# twin\n");
  mkdirSync(twin, { recursive: true });
  writeFileSync(join(twin, "instance.json"), JSON.stringify({ agent: "twin", instance: parent.instance, home: twin, work: "directory", launched: false }) + "\n");
  const ambiguous = read("the child's edge not followed: the parent's name is not unique", parent.home);
  assert.deepEqual([ambiguous.plan.facts.children, ambiguous.plan.facts.ambiguous.map((c) => c.home), ambiguous.plan.notes.filter((n) => AMBIGUOUS.test(n)).length], [[], [kid.home], 1]);
  kidSays((m) => { delete m.parentInstance; });
  const noEdge = read("no edge: the child's record names no parent", parent.home);
  assert.deepEqual([noEdge.plan.facts.children, noEdge.plan.facts.ambiguous, noEdge.plan.notes.filter((n) => AMBIGUOUS.test(n)).length], [[], [], 0]);
  stale(ambiguous, noEdge, "shown-with-an-ambiguous-edge", parent.home);
  kidSays((m) => { m.parentInstance = parent.instance; });
  assert.equal(d.plan(parent.instance, parent.home).planRevision, ambiguous.plan.planRevision, "the edge again: the revision it had");
});

test("a repeated apply with the same idempotency key, for a retire that did run, is answered from its stored receipt whatever revision it carries: the one it was applied with, the one the rule before #1065 gave the home, and one no plan has (#1065)", async (t) => {
  const d = deployment(t);
  const inst = await d.fx.spawn("dev", { instance: "dev-replayed" });
  const plan = d.plan(inst.instance);
  const before = formerRevision(plan, d.record(inst.home));
  const first = d.apply(inst.instance, plan.planRevision, "check-result");
  assert.deepEqual([first.status, first.ok, first.result?.retired, first.result?.replayed, first.result?.planRevision], [0, true, inst.instance, false, plan.planRevision], JSON.stringify(first.error ?? first.result));
  assert.equal(existsSync(inst.home), false, "fixture premise: the retire ran, and the home is gone");
  for (const [what, revision] of [["the revision it was applied with", plan.planRevision], ["the revision an older kernel's plan of the home had", before], ["a revision no plan has", "0".repeat(24)]]) {
    const again = d.apply(inst.instance, revision, "check-result");
    assert.deepEqual([again.status, again.ok, again.error], [0, true, undefined], `${what}: answered, and not E_PLAN_STALE: ${JSON.stringify(again.error)}`);
    assert.deepEqual(again.result, { ...first.result, replayed: true }, `${what}: the first receipt, replayed`);
  }
});

/** The revision the rule before #1065 gave a plain home (no extra tree, a reading that is the one
 *  the record's mode alone gives): the same facts, without the record's work mode and the reading. */
function formerRevision(plan, record) {
  const work = plan.facts.work;
  const safety = [plan.home, plan.facts.session.state, record.launched === true, work.observed ? [work.revision, work.branch, work.changed, work.untracked] : null, plan.facts.children.map((c) => c.home)];
  return createHash("sha256").update(JSON.stringify(safety)).digest("hex").slice(0, 24);
}

test("the upgrade: the revision of a plain worktree home's retire plan is not the one the rule before #1065 gave it, so a plan read under an older kernel is refused E_PLAN_STALE with the fresh plan, and the plan it carries is applied (#1065)", async (t) => {
  const d = deployment(t);
  const inst = await d.fx.spawn("dev", { instance: "dev-plain" });
  const plan = d.plan(inst.instance);
  assert.deepEqual([plan.facts.workMode, plan.facts.ownWorktree, plan.facts.extraWorktrees, plan.facts.children], ["worktree", true, [], []], "fixture premise: a plain worktree home");
  const former = formerRevision(plan, d.record(inst.home));
  assert.match(plan.planRevision, FORM);
  assert.match(former, FORM);
  assert.notEqual(plan.planRevision, former, "every home's retire plan has a new revision under this rule: the record's work mode and the reading are part of it in a home where they agree, too");
  // A plan read under the older kernel carries that former revision.
  const stale = d.apply(inst.instance, former, "read-before-the-upgrade");
  assert.deepEqual([stale.status, stale.ok, stale.error?.code], [1, false, "E_PLAN_STALE"], JSON.stringify(stale.error ?? stale.result));
  assert.deepEqual(timeless(stale.error.details.plan), timeless(plan), "with the fresh plan, which is the plan as it reads now");
  assert.equal(existsSync(join(inst.home, "work", ".git")), true, "nothing was done");
  assert.equal(d.hookRan(inst.instance), false);
  const done = d.apply(inst.instance, stale.error.details.plan.planRevision, "confirmed-again");
  assert.deepEqual([done.status, done.ok, done.result?.retired], [0, true, inst.instance], JSON.stringify(done.error ?? done.result));
});
