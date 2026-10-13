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
//   - what a client relies on: the revision's form, the fresh plan in the refusal, and a repeated
//     apply with the same key answered from its stored receipt whatever revision it carries;
//   - the revision of a plain `worktree` home is not the one the rule before #1065 gave it: every
//     home's plan has a new revision once, and that is meant.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

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
  const d = {
    fx, git, envelope,
    /** The retire plan of `instance`, as the CLI answers it. */
    plan(instance) { const e = envelope(fx.cli(["retire", instance, "--plan", "--json"])); assert.equal(e.ok, true, `a plan of ${instance}: ${JSON.stringify(e.error)}`); return e.result; },
    /** The `defaults:` line of the plan's text. */
    line(instance) {
      const r = fx.cli(["retire", instance, "--plan"]);
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
    apply(instance, revision, key) {
      const r = fx.cli(["retire", instance, "--plan-revision", revision, "--idempotency-key", key, "--json"]);
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
