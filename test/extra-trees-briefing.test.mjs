// The "Extra trees" briefing. The worktree and checkout work-mode injects share one section that
// tells an agent how to make a tree of its own for another branch or repository. These tests hold
// that section to two things: it is the same text in both injects (and so in every composed
// AGENTS.md of those modes), and its commands do what the prose around them says — run verbatim, as
// shell lines taken from the inject itself, against a hermetic upstream and clone:
//   - the tree starts from the remote's current state even when the clone's remote-tracking refs
//     are stale, and creating it moves none of the clone's refs beyond the new branch;
//   - `switch -c` refuses a branch name that already exists in the clone;
//   - reworking an existing remote branch under `<instance>/<branch>` and pushing with
//     `HEAD:<remote-branch>` changes that one remote branch and nothing else.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const HEADING = "### Extra trees";
const injectText = (mode) => readFileSync(join(ROOT, "injects", `work-${mode}.md`), "utf8");
const sectionOf = (text) => {
  const at = text.indexOf(HEADING);
  return at < 0 ? null : text.slice(at);
};
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** The briefing's commands, read from the inject text rather than retyped here. */
function briefingCommands() {
  const section = sectionOf(injectText("worktree"));
  const create = section.split("\n").filter((line) => line.startsWith("    git ")).map((line) => line.slice(4));
  const remove = section.match(/`(git -C <clone> worktree remove [^`]+)`/)?.[1];
  const push = section.match(/`(git push origin HEAD:<remote-branch>)`/)?.[1];
  assert.equal(create.length, 3, "the briefing has three indented create commands");
  assert.ok(remove, "the briefing names its worktree remove command");
  assert.ok(push, "the briefing names its push command");
  return { create, remove, push };
}

const cleanups = [];
test.afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** A scratch world: a bare upstream on main, a seed repo that pushes to it, a clone, an instance home. */
function world() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-extra-trees-")));
  cleanups.push(() => rmSync(base, { recursive: true, force: true }));
  const env = {
    PATH: process.env.PATH,
    HOME: base,
    LANG: "C",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.invalid",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.invalid",
    OATS_INSTANCE_HOME: join(base, "home"),
  };
  const git = (...args) => execFileSync("git", args, { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const upstream = join(base, "upstream.git");
  const seed = join(base, "seed");
  const clone = join(base, "clone");
  mkdirSync(env.OATS_INSTANCE_HOME, { recursive: true });
  git("init", "-q", "--bare", "-b", "main", upstream);
  git("init", "-q", "-b", "main", seed);
  git("-C", seed, "remote", "add", "origin", upstream);
  let n = 0;
  /** Commit on the seed's current branch and push it to upstream; returns the commit. */
  const seedCommit = (branch) => {
    writeFileSync(join(seed, "file.txt"), `change ${++n}\n`);
    git("-C", seed, "add", "file.txt");
    git("-C", seed, "commit", "-q", "-m", `change ${n}`);
    git("-C", seed, "push", "-q", "origin", `HEAD:refs/heads/${branch}`);
    return git("-C", seed, "rev-parse", "HEAD").trim();
  };
  /** Run one briefing line through /bin/sh, its placeholders substituted. */
  const sh = (line, values) => {
    let cmd = line.replaceAll("<clone>", shq(clone));
    for (const [name, value] of Object.entries(values)) cmd = cmd.replaceAll(`<${name}>`, value);
    assert.doesNotMatch(cmd, /<[a-z-]+>/, `every placeholder is substituted in: ${cmd}`);
    return spawnSync("/bin/sh", ["-c", cmd], { env, encoding: "utf8" });
  };
  const ok = (result) => assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  const refs = (repo, ...patterns) => git("-C", repo, "for-each-ref", ...patterns);
  return { base, env, git, upstream, seed, clone, seedCommit, sh, ok, refs, tree: (purpose) => join(env.OATS_INSTANCE_HOME, `.work-${purpose}`) };
}

const lines = (text) => text.split("\n").filter(Boolean);

test("the Extra trees section is byte-identical in the worktree and checkout injects", () => {
  const worktree = sectionOf(injectText("worktree"));
  const checkout = sectionOf(injectText("checkout"));
  assert.ok(worktree, "work-worktree.md has the Extra trees section");
  assert.ok(checkout, "work-checkout.md has the Extra trees section");
  assert.equal(checkout, worktree);
});

test("every composed worktree and checkout golden carries the shared section with its placeholders intact", () => {
  const section = sectionOf(injectText("worktree")).trim();
  const cases = readdirSync(join(ROOT, "test", "golden")).filter((name) => /-(worktree|checkout)-/.test(name));
  assert.ok(cases.some((name) => name.includes("-worktree-")) && cases.some((name) => name.includes("-checkout-")));
  for (const name of cases) {
    const agents = readFileSync(join(ROOT, "test", "golden", name, "AGENTS.md"), "utf8");
    assert.ok(agents.includes(section), `${name}/AGENTS.md contains the Extra trees section verbatim`);
    for (const literal of ['"$OATS_INSTANCE_HOME/.work-<purpose>"', "git -C <clone> worktree add --detach", "fetch --refmap= origin <base>", "switch -c <branch> FETCH_HEAD", "git push origin HEAD:<remote-branch>"]) {
      assert.ok(agents.includes(literal), `${name}/AGENTS.md keeps ${literal}`);
    }
  }
});

test("a fresh extra tree starts from the remote's tip, not the clone's stale origin/main, and moves no clone ref", () => {
  const { create, remove } = briefingCommands();
  const w = world();
  w.seedCommit("main");
  w.git("clone", "-q", w.upstream, w.clone);
  const tip = w.seedCommit("main"); // the clone's origin/main is now stale
  const stale = w.git("-C", w.clone, "rev-parse", "origin/main").trim();
  assert.notEqual(stale, tip);

  const clonesFetchHead = join(w.clone, ".git", "FETCH_HEAD");
  const fetchHeadBefore = existsSync(clonesFetchHead) ? readFileSync(clonesFetchHead) : null;
  const refsBefore = w.refs(w.clone, "refs/heads", "refs/remotes");
  const values = { purpose: "x", base: "main", branch: "agents/inst-x" };
  for (const line of create) w.ok(w.sh(line, values));

  const tree = w.tree("x");
  assert.equal(w.git("-C", tree, "rev-parse", "HEAD").trim(), tip, "the tree is at the upstream tip");
  assert.equal(w.git("-C", tree, "symbolic-ref", "HEAD").trim(), "refs/heads/agents/inst-x");

  const after = lines(w.refs(w.clone, "refs/heads", "refs/remotes"));
  const added = after.filter((line) => !lines(refsBefore).includes(line));
  assert.deepEqual(added, [`${tip} commit\trefs/heads/agents/inst-x`], "exactly one new ref: the tree's branch");
  assert.equal(after.filter((line) => !added.includes(line)).join("\n") + "\n", refsBefore, "every other clone ref is byte-identical");
  if (fetchHeadBefore === null) assert.equal(existsSync(clonesFetchHead), false, "the clone's own FETCH_HEAD is not written");
  else assert.deepEqual(readFileSync(clonesFetchHead), fetchHeadBefore, "the clone's own FETCH_HEAD is unchanged");

  w.ok(w.sh(remove, values));
  const list = w.git("-C", w.clone, "worktree", "list", "--porcelain", "-z");
  assert.equal(list.includes(tree), false, "the clone no longer lists the tree");
  assert.equal(existsSync(tree), false);
});

test("switch -c refuses a branch name that already exists in the clone, and leaves that branch alone", () => {
  const { create, remove } = briefingCommands();
  const w = world();
  w.seedCommit("main");
  w.git("clone", "-q", w.upstream, w.clone);
  w.seedCommit("main");
  w.git("-C", w.clone, "branch", "agents/inst-x", "origin/main");
  const existing = w.git("-C", w.clone, "rev-parse", "refs/heads/agents/inst-x").trim();

  const values = { purpose: "x", base: "main", branch: "agents/inst-x" };
  w.ok(w.sh(create[0], values));
  w.ok(w.sh(create[1], values));
  const refused = w.sh(create[2], values);
  assert.notEqual(refused.status, 0, "switch -c fails on an existing branch name");
  assert.match(refused.stderr, /already exists/, "it fails because the branch exists");
  assert.equal(w.git("-C", w.clone, "rev-parse", "refs/heads/agents/inst-x").trim(), existing, "the existing branch did not move");

  w.ok(w.sh(remove, values));
});

test("reworking an existing remote branch as <instance>/<branch> and pushing HEAD:<remote-branch> changes only that remote branch", () => {
  const { create, push } = briefingCommands();
  const w = world();
  w.seedCommit("main");
  w.git("-C", w.seed, "switch", "-q", "-c", "feature");
  w.seedCommit("feature");
  w.git("clone", "-q", w.upstream, w.clone);
  w.git("-C", w.clone, "branch", "feature", "origin/feature"); // the name collides with the remote branch
  const featureTip = w.seedCommit("feature"); // and the clone is stale against it

  const cloneBefore = w.refs(w.clone, "refs/heads", "refs/remotes");
  const localFeature = w.git("-C", w.clone, "rev-parse", "refs/heads/feature").trim();
  const values = { purpose: "feature", base: "feature", branch: "inst/feature" };
  for (const line of create) w.ok(w.sh(line, values));
  const tree = w.tree("feature");
  assert.equal(w.git("-C", tree, "rev-parse", "HEAD").trim(), featureTip);

  writeFileSync(join(tree, "rework.txt"), "rework\n");
  w.git("-C", tree, "add", "rework.txt");
  w.git("-C", tree, "commit", "-q", "-m", "rework");
  const pushed = w.git("-C", tree, "rev-parse", "HEAD").trim();

  const upstreamBefore = w.refs(w.upstream);
  w.ok(w.sh(`cd ${shq(tree)} && ${push}`, { "remote-branch": "feature" }));

  const upstreamOld = lines(upstreamBefore), upstreamNew = lines(w.refs(w.upstream));
  assert.deepEqual(upstreamOld.filter((line) => !upstreamNew.includes(line)), [`${featureTip} commit\trefs/heads/feature`]);
  assert.deepEqual(upstreamNew.filter((line) => !upstreamOld.includes(line)), [`${pushed} commit\trefs/heads/feature`], "upstream changed only refs/heads/feature, to the pushed commit");

  const cloneOld = lines(cloneBefore), cloneNew = lines(w.refs(w.clone, "refs/heads", "refs/remotes"));
  const gone = cloneOld.filter((line) => !cloneNew.includes(line));
  const added = cloneNew.filter((line) => !cloneOld.includes(line));
  assert.deepEqual(added.filter((line) => line.includes("\trefs/heads/")), [`${pushed} commit\trefs/heads/inst/feature`], "the clone's branches gained only inst/feature");
  assert.equal(gone.some((line) => line.includes("\trefs/heads/")), false, "no clone branch moved");
  assert.equal(w.git("-C", w.clone, "rev-parse", "refs/heads/feature").trim(), localFeature, "the clone's local feature is unchanged");
  assert.deepEqual(gone.filter((line) => line.includes("\trefs/remotes/")).map((line) => line.split("\t")[1]), ["refs/remotes/origin/feature"]);
  assert.deepEqual(added.filter((line) => line.includes("\trefs/remotes/")), [`${pushed} commit\trefs/remotes/origin/feature`], "only origin/feature moved, to the pushed commit");
});

test("the instance-boundary block, composed into every instance, defers extra trees to the mode block and no longer says `only there`", () => {
  const boundary = readFileSync(join(ROOT, "injects", "instance-boundary.md"), "utf8");
  const rule = "- **Repository work happens there, or in the extra trees your mode block\n  grants, and nowhere else**: reading, editing, building, testing, git and\n  commits, on repository content. Never from the main checkout or from your\n  home root, beyond what your mode block names.\n";
  assert.ok(boundary.includes(rule), "the boundary rule grants extra trees only through the mode block");
  assert.ok(!boundary.includes("there and only there"), "the old rule, which contradicted the extra-trees paragraph, is gone");
  assert.ok(!/\b(worktree|checkout|attached|workspace|directory)` mode/.test(boundary), "the boundary block names no work mode");
  for (const dir of readdirSync(join(ROOT, "test", "golden"))) {
    const composed = readFileSync(join(ROOT, "test", "golden", dir, "AGENTS.md"), "utf8");
    assert.ok(composed.includes(rule), `${dir}: the composed boundary carries the rule`);
  }
});
