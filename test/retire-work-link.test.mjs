// A link at `<home>/work` is never the instance's own tree (awebai/oats#973). The record is a file
// the instance can write; what the link leads to is not the instance's. So a home whose record says
// `worktree` and whose `work/` is a link plans and retires as a home that was given a link: the
// link goes with the home, and what it leads to is not copied, moved, removed or read through Git,
// whatever the flags. The plan says so beforehand, and the receipt says where the link led. Every
// case runs the real CLI against a scratch deployment.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { REFUSED_TEXT, terminalText } from "../lib/refused-text.mjs";

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const FILE = "only-copy.txt", BYTES = "work that exists nowhere else\n";
const REST = ", delete branch false, stop children true";
const LINK_LINE = `  defaults: no work tree of its own (work/ is a link, though the record says worktree: what it leads to is not touched)${REST}`;
const OWN_TREE_LINE = `  defaults: retain worktree true${REST}`;
const LINK_NOTE = "the record says work mode worktree, but work/ is a link and not a work tree of the instance's own: the retire removes the link with the home and does not touch what it leads to, with --discard-worktree as well";
const MODE_LINES = {
  attached: `  defaults: no work tree of its own (work/ links to its owner's tree and that tree is not touched)${REST}`,
  checkout: `  defaults: no work tree of its own (work/ links to the shared checkout and that checkout is not touched)${REST}`,
  workspace: `  defaults: no work tree of its own (work/ links to the deployment directory and that directory is not touched)${REST}`,
};
/** The notes that are true of the instance's own tree alone. */
const OWN_TREE_NOTES = /would be retained with the worktree|the worktree is on|uncommitted worktree state|use this home's work\/ as their work/;
const DEFAULTS = (retainWorktree) => ({ retainWorktree, deleteBranch: false, stopChildren: true, retainChildren: true });
const led = (home, to) => `${join(home, "work")} was a link though the record says work mode worktree: nothing was retained or removed as a work tree, and ${to === null ? "it led nowhere that could be read" : `what it led to (${to}) was not touched`}`;

/** Every entry under `dir`, a top-level `.git` left out (Git's own state is compared through Git)
 *  → Map(path relative to it → what it is and holds). What "byte for byte" compares. */
function entries(dir, out = new Map(), root = dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, e.name), rel = relative(root, path);
    if (rel === ".git") continue;
    if (e.isSymbolicLink()) out.set(rel, `link:${readlinkSync(path)}`);
    else if (e.isDirectory()) { out.set(rel, "dir"); entries(path, out, root); }
    else out.set(rel, `file:${readFileSync(path).toString("base64")}`);
  }
  return out;
}

/** A scratch deployment and what the cases do in it. The deployment directory is a Git checkout, so
 *  that a workspace instance's link leads to a repository too. Soul `hooked` has a retire hook that
 *  does nothing until a case asks: with `<flags>/stubborn` it reports incomplete cleanup, and with
 *  `<flags>/swap` (`{home, kind}`) it puts a real directory, or a file, where that home's `work/`
 *  link was. Souls `hooked-chk` and `hooked-wsp` have the same hook in checkout and workspace mode. */
function deployment(t) {
  const flags = mkdtempSync(join(tmpdir(), "oats-link-flags-")); t.after(() => rmSync(flags, { recursive: true, force: true }));
  const hook = `import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const swap = ${JSON.stringify(join(flags, "swap"))};
if (existsSync(swap)) {
  const { home, kind } = JSON.parse(readFileSync(swap, "utf8"));
  const work = join(home, "work");
  rmSync(work, { force: true });
  if (kind === "file") writeFileSync(work, ${JSON.stringify(BYTES)});
  else { mkdirSync(work); writeFileSync(join(work, ${JSON.stringify(FILE)}), ${JSON.stringify(BYTES)}); }
  rmSync(swap);
}
console.log(JSON.stringify({ meta: existsSync(${JSON.stringify(join(flags, "stubborn"))}) ? { retired: false, reason: "capture-unfinished" } : { retired: true } }));
`;
  const fx = v2Deployment({ t,
    souls: { dev: { soul: { work: "worktree" } }, dir: { soul: { work: "directory" } }, wsp: { soul: { work: "workspace" } }, chk: { soul: { work: "checkout" } },
      hooked: { soul: { work: "worktree", capabilities: { "test.link": { from: "here" } } } },
      "hooked-chk": { soul: { work: "checkout", capabilities: { "test.link": { from: "here" } } } },
      "hooked-wsp": { soul: { work: "workspace", capabilities: { "test.link": { from: "here" } } } } },
    capabilities: { "test.link": { manifest: { hooks: { retire: "hook.mjs" } }, files: { "hook.mjs": hook } } } });
  const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", env: fx.env, stdio: ["ignore", "pipe", "pipe"] }).trim();
  execFileSync("git", ["init", "-q", fx.dep], { env: fx.env });
  writeFileSync(join(fx.dep, "tracked.txt"), "of the deployment's checkout\n");
  git(fx.dep, "add", "tracked.txt"); git(fx.dep, "commit", "-qm", "the deployment is a checkout");
  const envelope = (r) => { try { return r.json(); } catch { assert.fail(`no envelope: ${r.stdout}${r.stderr}`); } };
  /** The plan of one instance: its JSON result, its text, and the text's `defaults:` line. */
  const plan = (instance) => {
    const json = envelope(fx.cli(["retire", instance, "--plan", "--json"]));
    assert.equal(json.ok, true, JSON.stringify(json.error));
    const text = fx.cli(["retire", instance, "--plan"]);
    assert.equal(text.status, 0, text.stdout + text.stderr);
    const lines = text.stdout.split("\n").filter((l) => l.startsWith("  defaults: "));
    assert.equal(lines.length, 1, text.stdout);
    return { ...json.result, text: text.stdout, line: lines[0] };
  };
  /** `oats retire <instance> --json` → { status, result } or { status, error }. A retire that is
   *  done prints its receipt, over several lines; one that is refused prints the envelope. */
  const retire = (instance, flags = [], env) => {
    const r = fx.cli(["retire", instance, "--json", ...flags], env ? { env } : {});
    let out;
    try { out = JSON.parse(r.stdout); } catch { assert.fail(`no JSON: ${r.stdout}${r.stderr}`); }
    return out.ok === false ? { status: r.status, error: out.error } : { status: r.status, result: out.ok === true ? out.result : out };
  };
  const retired = (instance, flags, env) => { const r = retire(instance, flags, env); assert.equal(r.status, 0, JSON.stringify(r.error ?? r.result)); return r.result; };
  const refused = (instance, flags, code) => { const r = retire(instance, flags); assert.equal(r.status, 1, JSON.stringify(r.result)); assert.equal(r.error.code, code, r.error.message); return r.error; };
  const instanceGit = (instance) => envelope(fx.cli(["instance", "git", instance, "--json"]));
  /** Rewrite a home's record through `change(record)`. */
  const record = (home, change) => {
    const path = join(home, "instance.json"), meta = readJson(path);
    change(meta);
    writeFileSync(path, JSON.stringify(meta, null, 2) + "\n");
  };
  /** An instance of `soul` attached to `owner`'s work/: a home that was given a link. */
  const attached = (owner, purpose, soul = "dev") => {
    const e = envelope(fx.cli(["spawn", soul, "--work", "attached", "--work-dir", join(owner.home, "work"), "--repo", fx.member, "--purpose", purpose, "--no-launch", "--json"]));
    assert.equal(e.ok, true, JSON.stringify(e.error));
    return e.result;
  };
  /** The record says `worktree`, with the repository and the branch of what the link leads to: the
   *  record that fits a worktree's best. */
  const sayWorktree = (home, tree) => record(home, (meta) => { meta.work = "worktree"; meta.repo = realpathSync(git(tree, "rev-parse", "--path-format=absolute", "--show-toplevel")) === realpathSync(fx.dep) ? fx.dep : fx.member; meta.branch = git(tree, "symbolic-ref", "--short", "HEAD"); });
  /** What Git says of a tree and of its repository: its status and index, its HEAD and branch, the
   *  repository's worktrees and branches. `untracked`: `no` for the deployment directory, whose
   *  untracked files are the homes themselves. */
  const gitState = (tree, untracked = "all") => ({
    status: git(tree, "status", "--porcelain=v2", "--branch", `--untracked-files=${untracked}`),
    index: git(tree, "ls-files", "--stage"),
    head: git(tree, "rev-parse", "HEAD"),
    branch: git(tree, "symbolic-ref", "HEAD"),
    worktrees: git(tree, "worktree", "list", "--porcelain"),
    branches: git(tree, "for-each-ref", "--format=%(refname) %(objectname)", "refs/heads"),
  });
  /** A `git` first on PATH that writes one line per launch (where, and its arguments) and then
   *  runs the real one. → { env, launches() }. */
  const loggedGit = () => {
    const bin = mkdtempSync(join(tmpdir(), "oats-link-git-")); t.after(() => rmSync(bin, { recursive: true, force: true }));
    const real = execFileSync("sh", ["-c", "command -v git"], { env: fx.env, encoding: "utf8" }).trim();
    const log = join(bin, "launches.log");
    writeFileSync(join(bin, "git"), `#!/bin/sh\nprintf '%s\\t%s\\n' "$PWD" "$*" >> ${JSON.stringify(log)}\nexec ${JSON.stringify(real)} "$@"\n`);
    chmodSync(join(bin, "git"), 0o755);
    return { env: { PATH: `${bin}:${fx.env.PATH}` }, launches: () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : []) };
  };
  return { fx, flags, git, plan, retire, retired, refused, instanceGit, record, attached, sayWorktree, gitState, loggedGit };
}

/** What a plan says of a link under a record that says `worktree`. */
function assertPlansLink(seen, label) {
  assert.deepEqual(seen.defaults, DEFAULTS(false), label);
  assert.equal(seen.facts.workMode, "worktree", label);
  assert.equal(seen.line, LINK_LINE, label);
  assert.doesNotMatch(seen.text, /retain worktree/, label);
  assert.equal(seen.notes.filter((n) => n === LINK_NOTE).length, 1, `${label}: ${JSON.stringify(seen.notes)}`);
  for (const note of seen.notes) assert.doesNotMatch(note, OWN_TREE_NOTES, label);
}
/** What a retire of such a home answers: the receipt of a home that was given a link, with the one
 *  warning. Nothing of the work is in a recovery. */
function assertLinkRetired(result, home, to, label) {
  assert.equal(result.removedDir, true, label);
  assert.equal(result.retention, null, `${label}: no worktree step`);
  assert.equal(result.worktreeRemoved, false, label);
  assert.equal(result.branchDeleted, false, label);
  assert.equal(result.spawnCompensation, undefined, label);
  assert.equal(result.extraWorktrees, undefined, label);
  assert.equal(existsSync(home), false, `${label}: the home is removed`);
  assert.deepEqual(result.warnings, [led(home, to)], label);
  // The record was changed since the spawn, so the home is copied; the work is not.
  if (result.workRecovery) {
    assert.deepEqual(result.workRecovery.classes, ["changed instance-home bytes"], label);
    assert.deepEqual(readdirSync(result.workRecovery.path).filter((n) => n === "work" || n === "repo"), [], `${label}: no copy of what the link led to`);
  }
}

test("a link at work/ under a record that says worktree is a link: the plan says so, the retire completes with every flag, and what the link leads to is as it was (#973)", async (t) => {
  const d = deployment(t);
  const owner = await d.fx.spawn("dev", { instance: "dev-owner" });
  const ownerWork = join(owner.home, "work");
  // What each link leads to is dirty: a file in its index and one that is not.
  for (const tree of [ownerWork, d.fx.member, d.fx.dep]) {
    writeFileSync(join(tree, "staged.txt"), "in the index\n"); d.git(tree, "add", "staged.txt");
    writeFileSync(join(tree, FILE), BYTES);
  }
  const make = {
    attached: (i) => d.attached(owner, `kid-${i}`),
    checkout: (i) => d.fx.spawn("chk", { instance: `chk-${i}` }),
    workspace: (i) => d.fx.spawn("wsp", { instance: `wsp-${i}` }),
  };
  const target = { attached: ownerWork, checkout: d.fx.member, workspace: d.fx.dep };
  const runs = [[], ["--discard-worktree"], ["--force"], ["--discard-worktree", "--force"]];
  for (const mode of ["attached", "checkout", "workspace"]) {
    for (const [i, flags] of runs.entries()) {
      const label = `${mode}${flags.length ? `, ${flags.join(" ")}` : ""}`;
      const inst = await make[mode](i);
      const tree = target[mode], real = realpathSync(tree);
      assert.equal(lstatSync(join(inst.home, "work")).isSymbolicLink(), true, label);
      assert.equal(realpathSync(join(inst.home, "work")), real, label);
      const given = d.plan(inst.instance);
      assert.equal(given.line, MODE_LINES[mode], label);
      d.sayWorktree(inst.home, tree);
      const seen = d.plan(inst.instance);
      assertPlansLink(seen, label);
      // A plan takes no option: with --discard-worktree it is this same plan, whose note names the flag.
      const withFlag = d.fx.cli(["retire", inst.instance, "--plan", "--discard-worktree", "--json"]).json();
      assert.equal(withFlag.ok, true, JSON.stringify(withFlag.error));
      assert.equal(withFlag.result.planRevision, seen.planRevision, label);
      assert.deepEqual({ ...withFlag.result, at: null }, { ...JSON.parse(JSON.stringify({ ...seen, text: undefined, line: undefined })), at: null }, label);
      assert.match(seen.notes.find((n) => n === LINK_NOTE), /, with --discard-worktree as well$/, label);
      // What is observed is what the link leads to, as for every home whose work/ is a link.
      assert.deepEqual({ ...seen.facts.work, drift: null }, { ...given.facts.work, drift: null }, label);
      assert.equal(seen.facts.work.observed, true, label);
      assert.equal(seen.facts.work.drift, false, `${label}: the record's branch fits`);
      assert.ok(seen.facts.work.changed + seen.facts.work.untracked > 0, label);
      // The revision binds what work/ is, where that is not what the record's mode alone gives.
      assert.notEqual(seen.planRevision, given.planRevision, label);
      // `oats instance git` is as it was: it reads through a link, and its mode is the record's.
      const read = d.instanceGit(inst.instance);
      assert.equal(read.ok, true, JSON.stringify(read.error));
      assert.equal(read.result.workMode, "worktree", label);
      assert.equal(read.result.observation.branch, d.git(tree, "symbolic-ref", "--short", "HEAD"), label);
      const untracked = mode === "workspace" ? "no" : "all";
      // The deployment directory holds the homes: its files are compared through Git alone.
      const before = { git: d.gitState(tree, untracked), files: mode === "workspace" ? null : entries(tree) };
      const logged = d.loggedGit();
      const result = d.retired(inst.instance, flags, logged.env);
      assertLinkRetired(result, inst.home, real, label);
      assert.deepEqual({ git: d.gitState(tree, untracked), files: mode === "workspace" ? null : entries(tree) }, before, `${label}: what the link led to is as it was`);
      // No Git command of the retire ran in the owner's tree or named it, or the link. (A checkout
      // instance's link leads to its repository and a workspace instance's to the deployment, which
      // a retire reads for other reasons: there the comparison above is the evidence.)
      if (mode === "attached") {
        assert.ok(logged.launches().length > 0, `${label}: fixture premise: the retire's Git launches are logged`);
        const named = logged.launches().filter((l) => l.includes(real) || l.includes(tree) || l.includes(join(inst.home, "work")));
        assert.deepEqual(named, [], label);
      }
    }
  }
  assert.equal(readFileSync(join(ownerWork, FILE), "utf8"), BYTES);
});

test("a plan read while work/ was a link is stale once work/ is the instance's own tree, and the other way round; a tree that was moved away and linked back is not touched and stays registered (#973)", async (t) => {
  const d = deployment(t);
  const inst = await d.fx.spawn("dev", { instance: "dev-moved" });
  const work = join(inst.home, "work"), away = join(d.fx.base, "moved-away");
  writeFileSync(join(work, FILE), BYTES);
  const branch = d.git(work, "symbolic-ref", "--short", "HEAD");
  const registered = () => d.git(d.fx.member, "worktree", "list", "--porcelain").split("\n").filter((l) => l.startsWith("worktree ")).map((l) => l.slice("worktree ".length));
  // Somebody moves the instance's registered worktree elsewhere and puts a link in its place.
  const moveAway = () => { d.git(d.fx.member, "worktree", "move", work, away); symlinkSync(away, work); };
  const moveBack = () => { rmSync(work); d.git(d.fx.member, "worktree", "move", away, work); };
  const guarded = (revision, key) => ["--plan-revision", revision, "--idempotency-key", key];
  const own = d.plan(inst.instance);
  assert.deepEqual(own.defaults, DEFAULTS(true));
  assert.equal(own.line, OWN_TREE_LINE);
  assert.equal(own.notes.includes(LINK_NOTE), false);
  assert.ok(own.notes.includes("0 changed and 1 untracked file(s) would be retained with the worktree"), JSON.stringify(own.notes));
  moveAway();
  const linked = d.plan(inst.instance);
  assertPlansLink(linked, "the tree moved away and linked");
  assert.equal(linked.facts.work.untracked, 1, "what the link leads to is observed");
  assert.notEqual(linked.planRevision, own.planRevision);
  // The plan that said "retained" does not apply to a link.
  const stale = d.refused(inst.instance, guarded(own.planRevision, "shown-as-own"), "E_PLAN_STALE");
  assert.equal(stale.details.plan.planRevision, linked.planRevision, "the refusal carries the fresh plan");
  // The other way round: the plan that said "a link" does not apply to the instance's own tree.
  moveBack();
  assert.equal(d.plan(inst.instance).planRevision, own.planRevision, "the same home, the same plan");
  d.refused(inst.instance, guarded(linked.planRevision, "shown-as-link"), "E_PLAN_STALE");
  assert.equal(readFileSync(join(work, FILE), "utf8"), BYTES, "nothing was done");
  // The plan as it is applies: the link goes with the home, and the tree it led to is as it was.
  moveAway();
  const before = { git: d.gitState(away), files: entries(away) };
  const result = d.retired(inst.instance, guarded(linked.planRevision, "as-it-is"));
  assertLinkRetired(result, inst.home, realpathSync(away), "the tree moved away and linked");
  assert.deepEqual({ git: d.gitState(away), files: entries(away) }, before);
  assert.ok(registered().includes(realpathSync(away)), "still a registered worktree of its repository");
  assert.equal(d.git(away, "symbolic-ref", "--short", "HEAD"), branch);
  assert.equal(readFileSync(join(away, FILE), "utf8"), BYTES);
});

test("a link that leads nowhere, to a file, or to an extra tree of the home is a link all the same (#973)", async (t) => {
  const d = deployment(t);
  const owner = await d.fx.spawn("dev", { instance: "dev-owner" });
  const relink = (home, to) => { rmSync(join(home, "work")); symlinkSync(to, join(home, "work")); };
  // Nowhere.
  const dangling = d.attached(owner, "dangling");
  d.sayWorktree(dangling.home, join(owner.home, "work"));
  relink(dangling.home, join(d.fx.base, "nothing-here"));
  const danglingPlan = d.plan(dangling.instance);
  assertPlansLink(danglingPlan, "a dangling link");
  assert.deepEqual(danglingPlan.facts.work, { observed: false, reason: "no-worktree" });
  assertLinkRetired(d.retired(dangling.instance), dangling.home, null, "a dangling link");
  // A file.
  const file = join(d.fx.base, "a-file.txt");
  writeFileSync(file, BYTES);
  const toFile = d.attached(owner, "to-file");
  d.sayWorktree(toFile.home, join(owner.home, "work"));
  relink(toFile.home, file);
  const filePlan = d.plan(toFile.instance);
  assertPlansLink(filePlan, "a link to a file");
  assert.equal(filePlan.facts.work.observed, false);
  assertLinkRetired(d.retired(toFile.instance), toFile.home, realpathSync(file), "a link to a file");
  assert.equal(readFileSync(file, "utf8"), BYTES);
  // An extra tree of the home: handled by its own step, as an extra tree. The link is only a link,
  // and by the time the home is removed it leads to a path that is gone.
  const inst = await d.fx.spawn("dev", { instance: "dev-extra" });
  const add = d.fx.cli(["worktree", "add", "--purpose", "side", "--branch", "agents/dev-extra-side", "--base", "main", "--json"], { cwd: inst.home });
  assert.equal(add.status, 0, add.stdout + add.stderr);
  const extra = join(inst.home, ".work-side");
  writeFileSync(join(extra, FILE), BYTES);
  d.git(d.fx.member, "worktree", "remove", "--force", join(inst.home, "work"));
  symlinkSync(extra, join(inst.home, "work"));
  const extraPlan = d.plan(inst.instance);
  assertPlansLink(extraPlan, "a link to an extra tree");
  assert.deepEqual(extraPlan.facts.extraWorktrees.map((x) => [x.path, x.disposition]), [[extra, "retain"]]);
  const result = d.retired(inst.instance);
  assert.equal(result.removedDir, true);
  assert.equal(result.retention, null);
  assert.equal(result.worktreeRemoved, false);
  assert.deepEqual(result.extraWorktrees.map((x) => [x.path, x.outcome]), [[extra, "retained"]]);
  assert.equal(readFileSync(join(result.extraWorktrees[0].movedTo, FILE), "utf8"), BYTES);
  assert.deepEqual(result.warnings, [led(inst.home, null)]);
});

/** The refusal of a retire whose link at work/ is `now` by its second inspection, up to where the
 *  retire says what it had done by then. */
const NO_LONGER_A_LINK = (home, instance, now) => `${join(home, "work")} was a link when this retire first read the home, and ${now} is there now. The home is kept and nothing of it was removed. \`oats retire ${instance} --plan\` shows what a retire would do with what is there now, and running the retire again does that. `;
/** The retire of `inst` during which its hook puts a directory or a file where the link was:
 *  refused, --force included, with the home and what is there now kept. */
function swappedDuringRetire(d, inst, kind, label) {
  writeFileSync(join(d.flags, "swap"), JSON.stringify({ home: inst.home, kind }));
  const error = d.refused(inst.instance, ["--force"], "E_WORK_INSPECTION_FAILED");
  assert.equal(existsSync(join(d.flags, "swap")), false, "fixture premise: the hook ran");
  assert.ok(error.message.startsWith(NO_LONGER_A_LINK(inst.home, inst.instance, kind === "file" ? "a file" : "a directory")), `${label}: ${error.message}`);
  assert.match(error.message, /The retire hooks have run; the home, its work and the pre-hook recovery \(if any\) are kept/, label);
  assert.equal(readFileSync(kind === "file" ? join(inst.home, "work") : join(inst.home, "work", FILE), "utf8"), BYTES, `${label}: the home and what is there now are kept`);
}

test("a link that became a directory during the retire keeps the home and says how it ends; for a home that was given a link, the next retire copies the directory and removes it with the home (#973)", async (t) => {
  const d = deployment(t);
  const owner = await d.fx.spawn("dev", { instance: "dev-owner" });
  const homes = [
    ["an attached instance as it was given", () => d.attached(owner, "swap-a", "hooked")],
    ["an attached instance whose record says worktree", () => { const kid = d.attached(owner, "swap-w", "hooked"); d.sayWorktree(kid.home, join(owner.home, "work")); return kid; }],
    ["a checkout instance", () => d.fx.spawn("hooked-chk", { instance: "hooked-chk-swap" })],
    ["a workspace instance", () => d.fx.spawn("hooked-wsp", { instance: "hooked-wsp-swap" })],
  ];
  for (const [label, make] of homes) {
    const inst = await make();
    assert.equal(lstatSync(join(inst.home, "work")).isSymbolicLink(), true, label);
    swappedDuringRetire(d, inst, "directory", label);
    // The plan the refusal points to says what the next retire does: a directory of the home (#962).
    const seen = d.plan(inst.instance);
    assert.deepEqual(seen.defaults, DEFAULTS(false), label);
    assert.ok(seen.notes.includes("recovery: work/ is copied there when it is not empty"), `${label}: ${JSON.stringify(seen.notes)}`);
    const result = d.retired(inst.instance);
    assert.ok(result.workRecovery?.classes.includes("directory work bytes"), `${label}: ${JSON.stringify(result.workRecovery?.classes)}`);
    assert.equal(readFileSync(join(result.workRecovery.path, "work", FILE), "utf8"), BYTES, label);
    assert.equal(existsSync(inst.home), false, label);
  }
  assert.equal(lstatSync(join(owner.home, "work")).isDirectory(), true);
});

test("what replaced the link under a worktree's receipt and record, and a file in any home, are kept by the next retire until a person moves them: it says so, --force included, and completes after that (#973)", async (t) => {
  const d = deployment(t);
  const owner = await d.fx.spawn("dev", { instance: "dev-owner" });
  // A home that was given a worktree, whose tree was moved away and linked: what replaces the link is
  // read as the instance's own tree by the spawn's receipt, and it has no Git admin entry.
  for (const kind of ["directory", "file"]) {
    const label = `a worktree's receipt and record, ${kind === "file" ? "a file" : "a directory"} there now`;
    const inst = await d.fx.spawn("hooked", { instance: `hooked-own-${kind}` });
    const work = join(inst.home, "work"), away = join(d.fx.base, `away-${kind}`);
    writeFileSync(join(work, "theirs.txt"), "of the tree that was moved away\n");
    d.git(d.fx.member, "worktree", "move", work, away); symlinkSync(away, work);
    const before = { git: d.gitState(away), files: entries(away) };
    swappedDuringRetire(d, inst, kind, label);
    const held = () => readFileSync(kind === "file" ? work : join(work, FILE), "utf8");
    const ITEM = `git worktree ${work}: its admin entry is missing; the directory is kept — move it out or delete it by hand, then retire again`;
    for (const flags of [[], ["--discard-worktree"]]) {
      const kept = d.retire(inst.instance, flags);
      assert.equal(kept.status, 1, `${label} ${flags.join(" ")}: ${JSON.stringify(kept)}`);
      assert.deepEqual(kept.result.rollbackIncomplete, [ITEM], label);
      assert.equal(kept.result.removedDir, false, label);
      assert.equal(held(), BYTES, label);
    }
    const forced = d.refused(inst.instance, ["--force"], "E_WORK_PRESERVATION_FAILED");
    assert.match(forced.message, /has no git admin entry in .*move it out or delete it by hand, then retire again; nothing was run or removed$/, label);
    assert.equal(held(), BYTES, label);
    // A person moves it out: the retire then completes.
    rmSync(work, { recursive: true });
    const done = d.retired(inst.instance);
    assert.equal(done.removedDir, true, label);
    assert.equal(done.rollbackIncomplete, undefined, label);
    assert.equal(existsSync(inst.home), false, label);
    assert.deepEqual({ git: d.gitState(away), files: entries(away) }, before, `${label}: the tree that was moved away is as it was`);
  }
  // A home that was given a link, with a file there now: read as a worktree, and its inspection refuses.
  const kid = d.attached(owner, "swap-f", "hooked");
  swappedDuringRetire(d, kid, "file", "a home that was given a link, a file there now");
  for (const flags of [[], ["--force"]]) {
    const error = d.refused(kid.instance, flags, "E_WORK_INSPECTION_FAILED");
    assert.match(error.message, /^could not read the top level of the worktree at .*\. Nothing was stopped, run or removed\.$/s, flags.join(" "));
    assert.equal(readFileSync(join(kid.home, "work"), "utf8"), BYTES);
  }
  rmSync(join(kid.home, "work"));
  const done = d.retired(kid.instance);
  assert.equal(done.removedDir, true);
  assert.equal(done.retention, null);
  assert.equal(existsSync(kid.home), false);
});

test("a retry of a rollback marker over a link does nothing through Git to what the link leads to and deletes no branch: Git debt stays unverified, and --force removes the home alone (#973)", async (t) => {
  const d = deployment(t);
  const inst = await d.fx.spawn("hooked", { instance: "hooked-q" });
  const work = join(inst.home, "work"), away = join(d.fx.base, "moved-away");
  writeFileSync(join(work, FILE), BYTES);
  const branch = d.git(work, "symbolic-ref", "--short", "HEAD");
  // A retire whose hook reports incomplete cleanup leaves the home with its marker.
  writeFileSync(join(d.flags, "stubborn"), "");
  const first = d.retire(inst.instance);
  assert.equal(first.status, 1, JSON.stringify(first));
  assert.ok(first.result?.rollbackIncomplete?.length, JSON.stringify(first));
  const markerPath = join(inst.home, ".oats-rollback-incomplete.json");
  assert.equal(existsSync(markerPath), true, "fixture premise: the home carries a rollback marker");
  // The tree is moved elsewhere and a link put in its place; the marker owes what a failed spawn's does.
  d.git(d.fx.member, "worktree", "move", work, away); symlinkSync(away, work);
  const marker = readJson(markerPath);
  marker.cleanup.outstanding = { ...marker.cleanup.outstanding, git: ["worktree", "branch"] };
  writeFileSync(markerPath, JSON.stringify(marker, null, 2));
  rmSync(join(d.flags, "stubborn"));
  // A link that leads nowhere is not a worktree that is gone: the retry does not ask Git for the branch.
  rmSync(work); symlinkSync(join(d.fx.base, "nothing-here"), work);
  const logged = d.loggedGit();
  const dangling = d.retire(inst.instance, [], logged.env);
  assert.deepEqual(dangling.result.rollbackIncomplete, ["git worktree, branch: not re-verified on this retry, so the cleanup they owed is unverified"]);
  assert.ok(logged.launches().length > 0, "fixture premise: the retry's Git launches are logged");
  assert.deepEqual(logged.launches().filter((l) => l.includes(branch)), [], "no Git command names the recorded branch");
  rmSync(work); symlinkSync(away, work);
  const before = { git: d.gitState(away), files: entries(away) };
  const intact = (label) => {
    assert.deepEqual({ git: d.gitState(away), files: entries(away) }, before, label);
    assert.equal(d.git(d.fx.member, "rev-parse", "--verify", `refs/heads/${branch}`), before.git.head, `${label}: the branch is where it was`);
  };
  const retry = d.retire(inst.instance);
  assert.equal(retry.status, 1, JSON.stringify(retry));
  assert.deepEqual(retry.result.rollbackIncomplete, ["git worktree, branch: not re-verified on this retry, so the cleanup they owed is unverified"]);
  assert.equal(retry.result.retention, null);
  assert.equal(retry.result.spawnCompensation, undefined);
  assert.equal(lstatSync(work).isSymbolicLink(), true, "the home and its link are kept");
  intact("the retry");
  const forced = d.retire(inst.instance, ["--force"]);
  assert.equal(forced.result.removedDir, true, JSON.stringify(forced));
  assert.deepEqual(forced.result.forcedIncomplete, ["git worktree, branch: not re-verified on this retry, so the cleanup they owed is unverified"]);
  assert.equal(forced.result.branchDeleted, false);
  assert.equal(forced.result.spawnCompensation, undefined);
  assert.deepEqual(forced.result.warnings, [led(inst.home, realpathSync(away))]);
  assert.equal(existsSync(inst.home), false);
  intact("the forced retire");
});

test("the retire's text spells the characters of a link's target that a terminal would act on; the receipt holds the path as the system resolved it (#973)", async (t) => {
  const d = deployment(t);
  const owner = await d.fx.spawn("dev", { instance: "dev-owner" });
  // A directory whose name clears the screen and writes a line of its own, if printed as it is.
  const target = join(d.fx.base, "led-\x1b[2J-here\nRetired everything\u202e");
  mkdirSync(target);
  writeFileSync(join(target, FILE), BYTES);
  const linked = (purpose) => {
    const kid = d.attached(owner, purpose);
    d.sayWorktree(kid.home, join(owner.home, "work"));
    rmSync(join(kid.home, "work")); symlinkSync(target, join(kid.home, "work"));
    return kid;
  };
  // The receipt: the path exactly.
  const asJson = linked("json");
  assertLinkRetired(d.retired(asJson.instance), asJson.home, realpathSync(target), "the receipt");
  // The text: one line for the warning, with each such character spelled out.
  const asText = linked("text");
  const r = d.fx.cli(["retire", asText.instance]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout + r.stderr, /[\x1b\u202e]/u, "no escape and no bidi override reaches the terminal");
  const spelled = realpathSync(target).replace("\x1b", "\\u{1b}").replace("\n", "\\u{a}").replace("\u202e", "\\u{202e}");
  const lines = r.stdout.split("\n").filter((l) => l.includes("WARNING"));
  assert.deepEqual(lines, [`  WARNING: ${join(asText.home, "work")} was a link though the record says work mode worktree: nothing was retained or removed as a work tree, and what it led to (${spelled}) was not touched`]);
  assert.equal(r.stdout.split("\n").filter((l) => l.startsWith("Retired")).length, 1, r.stdout);
  assert.equal(readFileSync(join(target, FILE), "utf8"), BYTES);
});

test("terminalText spells every refused character as \\u{hex} and leaves the rest of a line as it is (#973)", () => {
  assert.equal(terminalText("plain é 日本 — text, with 'quotes' and \\ a backslash"), "plain é 日本 — text, with 'quotes' and \\ a backslash");
  assert.equal(terminalText("a\x1b[2Jb\nc\td\x7f\u0085e"), "a\\u{1b}[2Jb\\u{a}c\\u{9}d\\u{7f}\\u{85}e");
  assert.equal(terminalText("\u2028\u2029\u202e\u2066\u200b\u2060\ufeff\u{e0041}"), "\\u{2028}\\u{2029}\\u{202e}\\u{2066}\\u{200b}\\u{2060}\\u{feff}\\u{e0041}");
  // Not refused: joiners and direction marks that text in several scripts needs.
  assert.equal(terminalText("\u200c\u200d\u200e\u200f\u061c"), "\u200c\u200d\u200e\u200f\u061c");
  // Every character of the set, and nothing of it left in what comes back.
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    const ch = String.fromCodePoint(cp);
    if (REFUSED_TEXT.test(ch)) assert.equal(terminalText(`x${ch}y`), `x\\u{${cp.toString(16)}}y`);
  }
  assert.equal(terminalText(undefined), "undefined", "whatever it is given is text");
});

test("the notes about a worktree that is retained are for the instance's own tree alone: none for an attached, checkout or workspace instance over a tree that is dirty or on another branch (#973)", async (t) => {
  const d = deployment(t);
  const owner = await d.fx.spawn("dev", { instance: "dev-owner" });
  const ownerWork = join(owner.home, "work");
  const kid = d.attached(owner, "kid");
  const chk = await d.fx.spawn("chk", { instance: "chk-a" });
  const wsp = await d.fx.spawn("wsp", { instance: "wsp-a" });
  // The records name the branches the trees were on at the spawn; then each tree moves on and is dirtied.
  d.record(chk.home, (meta) => { meta.branch = d.git(d.fx.member, "symbolic-ref", "--short", "HEAD"); });
  d.record(wsp.home, (meta) => { meta.branch = d.git(d.fx.dep, "symbolic-ref", "--short", "HEAD"); });
  const recorded = readJson(join(owner.home, "instance.json")).branch;
  for (const [i, tree] of [ownerWork, d.fx.member, d.fx.dep].entries()) {
    d.git(tree, "checkout", "-q", "-b", `elsewhere-${i}`);
    writeFileSync(join(tree, "staged.txt"), "in the index\n"); d.git(tree, "add", "staged.txt");
    writeFileSync(join(tree, FILE), BYTES);
  }
  for (const [inst, mode] of [[kid, "attached"], [chk, "checkout"], [wsp, "workspace"]]) {
    const seen = d.plan(inst.instance);
    assert.equal(seen.facts.work.observed, true, mode);
    assert.equal(seen.facts.work.drift, true, `${mode}: the tree is not on the recorded branch`);
    assert.ok(seen.facts.work.changed >= 1 && seen.facts.work.untracked >= 1, `${mode}: ${JSON.stringify(seen.facts.work)}`);
    assert.deepEqual(seen.defaults, DEFAULTS(false), mode);
    assert.equal(seen.line, MODE_LINES[mode], mode);
    assert.equal(seen.notes.includes(LINK_NOTE), false, mode);
    for (const note of seen.notes) assert.doesNotMatch(note, OWN_TREE_NOTES, mode);
    assert.doesNotMatch(seen.text, /would be retained with the worktree|the worktree is on/, mode);
  }
  // The owner's own tree: both notes, as before.
  const own = d.plan(owner.instance);
  assert.deepEqual(own.defaults, DEFAULTS(true));
  assert.ok(own.notes.includes(`the worktree is on elsewhere-0, not the recorded ${recorded}`), JSON.stringify(own.notes));
  assert.ok(own.notes.includes("1 changed and 1 untracked file(s) would be retained with the worktree"), JSON.stringify(own.notes));
  assert.ok(own.notes.includes("recovery: uncommitted worktree state is copied there too"), JSON.stringify(own.notes));
});

test("a worktree record whose work/ is gone, or is a file, answers as it did (#973)", async (t) => {
  const d = deployment(t);
  // Gone: the record decides, the plan says retained, and the retire finds no worktree to retain.
  const gone = await d.fx.spawn("dev", { instance: "dev-gone" });
  d.git(d.fx.member, "worktree", "remove", "--force", join(gone.home, "work"));
  const gonePlan = d.plan(gone.instance);
  assert.deepEqual(gonePlan.defaults, DEFAULTS(true));
  assert.equal(gonePlan.line, OWN_TREE_LINE);
  assert.equal(gonePlan.notes.includes(LINK_NOTE), false);
  assert.deepEqual(gonePlan.facts.work, { observed: false, reason: "no-worktree" });
  const goneResult = d.retired(gone.instance);
  assert.equal(goneResult.retention.worktree, "absent");
  assert.equal(goneResult.warnings, undefined);
  // A file: read as a worktree whose admin entry is missing. The home is kept with it.
  const file = await d.fx.spawn("dev", { instance: "dev-file" });
  d.git(d.fx.member, "worktree", "remove", "--force", join(file.home, "work"));
  writeFileSync(join(file.home, "work"), BYTES);
  const filePlan = d.plan(file.instance);
  assert.deepEqual(filePlan.defaults, DEFAULTS(true));
  assert.equal(filePlan.line, OWN_TREE_LINE);
  assert.equal(filePlan.notes.includes(LINK_NOTE), false);
  const kept = d.retire(file.instance);
  assert.equal(kept.status, 1, JSON.stringify(kept));
  assert.deepEqual(kept.result.rollbackIncomplete, [`git worktree ${join(file.home, "work")}: its admin entry is missing; the directory is kept — move it out or delete it by hand, then retire again`]);
  assert.equal(kept.result.removedDir, false);
  assert.equal(readFileSync(join(file.home, "work"), "utf8"), BYTES, "the home is kept");
});
