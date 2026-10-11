// An attached spawn on an extra tree of a home (awebai/oats#958). An extra tree of a home is that
// home's tree, as its `work` is: `oats spawn --work attached --work-dir <home>/.work-<purpose>`
// derives the owner (that home's instance, whose child the new instance is) and the repository (the
// tree's, as Git names it). The tree is an extra tree by the kernel's one test of it (a registered
// linked worktree in a home), never by the shape of its path. A tree in no known instance's home
// needs both flags, and one refusal names every one still missing. Every case runs the real CLI
// against a scratch deployment whose member clone the trees are worktrees of.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, symlinkSync } from "node:fs";
import { join, relative } from "node:path";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const NO_TREE = /^attached workDir .+ is not a known instance's <home>\/work or an extra tree of a known instance's home \(<home>\/\.work-<purpose>\), so /;
const BOTH = /so neither its owner nor its repository is derived — pass both: --parent <instance> \(the owning instance\) and --repo <repository>$/;
const PARENT_ONLY = /so its owner is not derived — name the owning instance explicitly \(--parent <instance>\)$/;
const REPO_ONLY = /so its repository is not derived — pass --repo <repository>$/;

/** A deployment with one worktree-mode instance of `dev`, the owner, and what the cases need of it. */
async function deployment(t, { souls = { dev: { soul: { work: "worktree" } } }, owner: ownerName = "dev-owner", ownerSoul = "dev" } = {}) {
  const fx = v2Deployment({ souls, t });
  const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", env: fx.env, stdio: ["ignore", "pipe", "pipe"] }).trim();
  const owner = await fx.spawn(ownerSoul, { instance: ownerName });
  /** An extra tree of `home`: a linked worktree of `repo` at `<home>/.work-<purpose>`. */
  const tree = (purpose, { home = owner.home, repo = fx.member } = {}) => {
    const path = join(home, `.work-${purpose}`);
    git(repo, "worktree", "add", "-q", "--detach", path);
    return path;
  };
  /** `oats spawn dev --work attached --work-dir <dir> …` → the CLI's one envelope. */
  const attach = (purpose, dir, extra = [], { cwd } = {}) => {
    const r = fx.cli(["spawn", "dev", "--work", "attached", "--work-dir", dir, "--purpose", purpose, "--no-launch", "--json", ...extra], cwd ? { cwd } : {});
    let envelope;
    try { envelope = r.json(); } catch { assert.fail(`no envelope: ${r.stdout}${r.stderr}`); }
    return envelope;
  };
  const spawned = (envelope) => { assert.equal(envelope.ok, true, JSON.stringify(envelope.error)); return envelope.result; };
  const refused = (envelope, code) => { assert.equal(envelope.ok, false, JSON.stringify(envelope.result)); if (code) assert.equal(envelope.error.code, code, envelope.error.message); return envelope.error.message; };
  /** The names of the homes of `dev`'s instances: a refused spawn leaves none behind. */
  const homes = () => readdirSync(join(fx.root, "dev", "instances")).filter((n) => !n.startsWith(".")).sort();
  const children = (name) => { const p = fx.cli(["retire", name, "--plan", "--json"]); assert.equal(p.status, 0, p.stdout + p.stderr); return p.json().result.facts.children.map((c) => c.instance); };
  return { fx, git, owner, tree, attach, spawned, refused, homes, children };
}

test("an attached spawn on a home's extra tree derives its owner and its repository: no --repo, no relation flag", async (t) => {
  const d = await deployment(t);
  const path = d.tree("docs");
  const kid = d.spawned(d.attach("on-tree", path));
  assert.equal(kid.work, "attached");
  assert.equal(kid.parent, d.owner.instance, "the owner is the instance in whose home the tree is");
  assert.equal(kid.repo, d.fx.member, "the repository is the tree's");
  const meta = readJson(join(kid.home, "instance.json"));
  assert.equal(meta.parentInstance, d.owner.instance);
  assert.equal(meta.repo, d.fx.member);
  assert.equal(meta.work, "attached");
  assert.equal(readlinkSync(join(kid.home, "work")), path, "its work is the tree named on the command line");
  assert.deepEqual(d.children(d.owner.instance), [kid.instance], "the owner's record of its children lists it");

  // No key or field changes. The record of a spawn on the tree is the record of the same spawn on
  // the owner's <home>/work, but for what names the instance and for the branch the tree is on: with
  // nothing given, and with both flags given (which also records the relation the caller named).
  const record = (r) => { const m = readJson(join(r.home, "instance.json")); const { instance, home, createdAt, spawnedAt, decision, tmux, branch, ...rest } = m; return JSON.parse(JSON.stringify(rest).replaceAll(m.instance, "<instance>")); };
  const flags = ["--parent", d.owner.instance, "--repo", d.fx.member];
  const onWork = d.spawned(d.attach("on-work", join(d.owner.home, "work")));
  assert.deepEqual(record(kid), record(onWork), "nothing given: as for <home>/work");
  const explicit = d.spawned(d.attach("on-tree-explicit", path, flags));
  assert.equal(explicit.parent, d.owner.instance);
  assert.equal(explicit.repo, d.fx.member);
  assert.deepEqual(record(explicit), record(d.spawned(d.attach("on-work-explicit", join(d.owner.home, "work"), flags))), "both flags given: as for <home>/work");
  assert.deepEqual(record(explicit), { ...record(kid), relation: "child", relativeTo: d.owner.instance }, "the flags given add the relation the caller named, and nothing else");
  assert.deepEqual(d.children(d.owner.instance).sort(), [kid.instance, onWork.instance, explicit.instance, "dev-on-work-explicit"].sort());

  // A relation that is not "child of the owner" is refused in the words <home>/work gets.
  const other = await d.fx.spawn("dev", { instance: "dev-other" });
  const said = (dir, extra) => d.refused(d.attach("on-tree-not-child", dir, extra));
  for (const extra of [["--parent", other.instance], ["--relation", "child", "--relative-to", other.instance]]) {
    const onTree = said(path, extra);
    assert.equal(onTree, `attached agents are always children of the work-tree owner (${d.owner.instance}) — drop the relation flags or use --work worktree for a different relation`);
    assert.equal(said(join(d.owner.home, "work"), extra), onTree, "the same sentence as for <home>/work");
  }
  assert.equal(existsSync(join(d.fx.root, "dev", "instances", "dev-on-tree-not-child")), false, "a refused spawn leaves no home");
});

test("the extra tree as it is named: through a link, with a trailing slash, relative; a preview derives the same and creates nothing; a locked tree is a tree", async (t) => {
  const d = await deployment(t);
  const path = d.tree("named");
  const link = join(d.fx.base, "link-to-tree"); symlinkSync(path, link);
  const cwd = d.fx.dep;
  for (const [purpose, dir] of [["via-link", link], ["trailing-slash", `${path}/`], ["relative", relative(realpathSync(cwd), realpathSync(path))]]) {
    const kid = d.spawned(d.attach(purpose, dir, [], { cwd }));
    assert.equal(kid.parent, d.owner.instance, purpose);
    assert.equal(kid.repo, d.fx.member, purpose);
  }
  const before = d.homes();
  const preview = d.spawned(d.attach("previewed", path, ["--preview"]));
  assert.equal(preview.work, "attached");
  assert.equal(preview.repo, d.fx.member, "the preview names the tree's repository");
  assert.equal(preview.parent ?? preview.lineage?.parent ?? preview.parentInstance, d.owner.instance, `the preview names the owner: ${JSON.stringify(preview).slice(0, 400)}`);
  assert.deepEqual(d.homes(), before, "a preview creates nothing");

  d.git(d.fx.member, "worktree", "lock", "--reason", "held", path);
  assert.equal(d.spawned(d.attach("locked", path)).parent, d.owner.instance, "a locked extra tree is still the home's tree");
});

test("an extra tree of another repository than the owner's: the repository recorded is the tree's", async (t) => {
  const d = await deployment(t);
  const otherRepo = join(d.fx.base, "other-repo");
  mkdirSync(otherRepo);
  d.git(otherRepo, "init", "-q");
  d.git(otherRepo, "config", "maintenance.auto", "false");
  d.git(otherRepo, "commit", "-q", "--allow-empty", "-m", "another repository");
  const path = d.tree("other", { repo: otherRepo });
  const kid = d.spawned(d.attach("on-other-repo", path));
  assert.equal(kid.parent, d.owner.instance);
  assert.equal(readJson(join(d.owner.home, "instance.json")).repo, d.fx.member, "the owner's own repository is another");
  assert.equal(kid.repo, realpathSync(otherRepo));
  assert.equal(readJson(join(kid.home, "instance.json")).repo, realpathSync(otherRepo));
});

test("a .work-x that is not a registered tree of a home is a tree of no instance: one refusal names both flags, or the one still missing", async (t) => {
  const d = await deployment(t);
  const before = d.homes();
  const plain = join(d.owner.home, ".work-plain"); mkdirSync(plain);
  const clone = join(d.owner.home, ".work-clone"); mkdirSync(clone); d.git(clone, "init", "-q"); d.git(clone, "commit", "-q", "--allow-empty", "-m", "a repository of its own");
  // A repository inside the home, and a linked worktree of it in the home: home bytes, not an extra tree.
  const inner = join(d.owner.home, "inner-repo"); mkdirSync(inner); d.git(inner, "init", "-q"); d.git(inner, "commit", "-q", "--allow-empty", "-m", "inside the home");
  const ofInner = d.tree("of-inner", { repo: inner });
  // A tree whose registration was pruned: its admin entry is gone, its directory is left.
  const pruned = d.tree("pruned");
  const admin = readFileSync(join(pruned, ".git"), "utf8").replace(/^gitdir:\s*/, "").trim();
  execFileSync("rm", ["-rf", admin]);
  // A path inside an extra tree is not the tree.
  const real = d.tree("real"); mkdirSync(join(real, "sub"));
  // A path shaped like an extra tree in a directory that is no home.
  const nowhere = join(d.fx.base, "no-home", ".work-x"); mkdirSync(nowhere, { recursive: true });

  for (const [what, dir] of [["a plain directory", plain], ["a clone of its own", clone], ["a tree of a repository inside the home", ofInner], ["a pruned tree", pruned], ["a path inside an extra tree", join(real, "sub")], ["a directory in no home", nowhere]]) {
    const both = d.refused(d.attach("no-tree", dir), "E_BAD_ARGS");
    assert.match(both, NO_TREE, what); assert.match(both, BOTH, what);
    assert.ok(both.includes(`attached workDir ${dir} is not`), `${what}: the path is named`);
    const repoGiven = d.refused(d.attach("no-tree", dir, ["--repo", d.fx.member]), "E_BAD_ARGS");
    assert.match(repoGiven, NO_TREE, what); assert.match(repoGiven, PARENT_ONLY, what);
    for (const parentGiven of [d.refused(d.attach("no-tree", dir, ["--parent", d.owner.instance]), "E_BAD_ARGS"), d.refused(d.attach("no-tree", dir, ["--relation", "child", "--relative-to", d.owner.instance]), "E_BAD_ARGS")]) {
      assert.match(parentGiven, NO_TREE, what); assert.match(parentGiven, REPO_ONLY, what);
    }
  }
  assert.deepEqual(d.homes(), before, "no refused spawn left a home");
  // With both flags it attaches, as a tree of no instance always did.
  const kid = d.spawned(d.attach("plain-both", plain, ["--parent", d.owner.instance, "--repo", d.fx.member]));
  assert.equal(kid.parent, d.owner.instance);
  assert.equal(lstatSync(join(kid.home, "work")).isSymbolicLink(), true);
});

test("the owner is one this deployment root knows: from another root the tree is of no instance, and a name that resolves elsewhere is refused as ambiguous", async (t) => {
  const d = await deployment(t);
  const path = d.tree("shared");
  // Another deployment: its root holds no home with this tree.
  const elsewhere = await deployment(t, { owner: "dev-there" });
  const fromElsewhere = elsewhere.refused(elsewhere.attach("from-elsewhere", path), "E_BAD_ARGS");
  assert.match(fromElsewhere, NO_TREE); assert.match(fromElsewhere, BOTH);

  // Two instances of one name under one root: the tree's owner is the second, the name resolves to the first.
  const dup = await deployment(t, { souls: { dev: { soul: { work: "checkout" } }, "dev-foo": { soul: { work: "checkout" } } }, owner: "dev-foo-1", ownerSoul: "dev-foo" });
  await dup.fx.spawn("dev", { instance: "dev-foo-1" });
  const dupTree = dup.tree("mine");
  const ambiguous = (dir) => dup.refused(dup.attach("ambiguous", dir)).replace(dir, "<dir>");
  const onTree = ambiguous(dupTree);
  assert.equal(onTree, `attached workDir <dir> belongs to instance "dev-foo-1" (${join(realpathSync(dup.fx.root), "dev-foo", "instances", "dev-foo-1")}), but that name resolves to a different instance from this deployment root — the parent link would be ambiguous; retire/rename the shadowing instance or attach to a tree owned here`);
  assert.equal(ambiguous(join(dup.owner.home, "work")), onTree, "the same refusal, in the same sentence, as for <home>/work");
});
