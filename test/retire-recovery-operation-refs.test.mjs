// A retire's recovery of a worktree carries an operation that stopped, in both ref formats
// (awebai/oats#1038): its refs, the objects they name, a link at a copied name, and the stash.
//
// The recovery is a fresh clone into which the copier copies the index and named entries of the
// worktree's own Git directory (restoreStandaloneGitState, lib/core.mjs). In the reftable format
// CHERRY_PICK_HEAD, REVERT_HEAD, REBASE_HEAD and AUTO_MERGE are refs, not files, and the stash's
// log is not a file either: a copy of paths took none of them. A link at a copied name was looked
// at through `existsSync`, which follows it, so a link that leads nowhere was left out. And in
// every format the commit or tree such a ref names is often in no branch (a commit reset away, a
// conflict's tree), which a clone does not bring.
//
// Each case is staged by Git in the instance's own worktree, the instance is retired through the
// kernel (retireInstance), and Git is asked the same questions in the source, before the retire,
// and in the recovery: `git status`, the refs by `git rev-parse --verify --quiet`, whether each
// object they name is there (`git cat-file -e`), and `git stash list`. The recovery's clone is in
// the files format whatever the source's is, so every comparison goes through Git, not files;
// a link is compared as a link (lstat, readlink), since `git status` does not see one.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { retireInstance } from "../lib/core.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { skipFor } from "./helpers/reftable.mjs";

const OPERATION_REFS = ["CHERRY_PICK_HEAD", "REVERT_HEAD", "REBASE_HEAD", "AUTO_MERGE", "MERGE_HEAD"];

/** Git in `cwd` with the fixture's environment → its trimmed stdout; throws when Git exits non-zero. */
const gitWith = (env) => (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@example.test", "-c", "commit.gpgsign=false", ...args],
  { encoding: "utf8", env: { ...env, GIT_EDITOR: "true" }, stdio: ["ignore", "pipe", "pipe"] }).trim();
const commitFile = (g, tree, file, text) => { writeFileSync(join(tree, file), text); g(tree, "add", file); g(tree, "commit", "-qm", `${file}: ${text.trim()}`); return g(tree, "rev-parse", "HEAD"); };
/** Three commits of one file, then HEAD back on the second's parent with a third: `theirs` (the
 *  commit returned) conflicts with HEAD, and no branch holds it. */
const conflictOn = (g, tree, file) => { commitFile(g, tree, file, "zero\n"); const theirs = commitFile(g, tree, file, "theirs\n"); g(tree, "reset", "-q", "--hard", "HEAD~1"); commitFile(g, tree, file, "mine\n"); return theirs; };
/** A commit on top of HEAD that adds `file`, made without moving any ref: no branch holds it. */
const looseChild = (g, tree, file, text) => {
  const blob = execFileSync("git", ["-C", tree, "hash-object", "-w", "--stdin"], { input: text, encoding: "utf8" }).trim();
  const index = join(tree, "..", `index-${file}`);
  const env = { GIT_INDEX_FILE: index };
  execFileSync("git", ["-C", tree, "read-tree", "HEAD"], { env: { ...process.env, ...env } });
  execFileSync("git", ["-C", tree, "update-index", "--add", "--cacheinfo", `100644,${blob},${file}`], { env: { ...process.env, ...env } });
  const t = execFileSync("git", ["-C", tree, "write-tree"], { env: { ...process.env, ...env }, encoding: "utf8" }).trim();
  rmSync(index, { force: true });
  return g(tree, "commit-tree", t, "-p", "HEAD", "-m", `adds ${file}`);
};
const stops = (fn, what) => assert.throws(fn, undefined, `premise: ${what} stops`);
const gitDirOf = (g, tree) => g(tree, "rev-parse", "--absolute-git-dir");

/** What Git says in `repo`, as compared between the source and its recovery. */
function gitSays(g, repo) {
  const value = (...args) => { const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" }); return r.status === 0 ? r.stdout.trim() : null; };
  const refs = Object.fromEntries(OPERATION_REFS.map((name) => [name, value("rev-parse", "--verify", "--quiet", name)]));
  const dir = gitDirOf(g, repo);
  // MERGE_HEAD as the file Git writes: a merge of several commits names one per line.
  const mergeHeads = existsSync(join(dir, "MERGE_HEAD")) && lstatSync(join(dir, "MERGE_HEAD")).isFile() ? readFileSync(join(dir, "MERGE_HEAD"), "utf8").split("\n").filter(Boolean) : [];
  // Read as an answer, not a premise: a recovery that lacks AUTO_MERGE's tree lists nothing here.
  const autoMergeBlobs = refs.AUTO_MERGE ? value("ls-tree", "-r", "--format=%(objectname)", "AUTO_MERGE")?.split("\n").filter(Boolean) ?? [] : [];
  const stashed = value("log", "-g", "--format=%H", "refs/stash")?.split("\n").filter(Boolean) ?? [];
  const named = [...new Set([...Object.values(refs).filter(Boolean), ...mergeHeads, ...autoMergeBlobs, ...stashed])].sort();
  return {
    status: g(repo, "status", "--porcelain=v1", "--untracked-files=all"),
    operation: g(repo, "-c", "advice.statusHints=false", "status").split("\n").filter((line) => !/^(On branch|HEAD detached|Your branch|$)/.test(line)).join("\n"),
    refs,
    mergeHeads,
    objects: Object.fromEntries(named.map((oid) => [oid, value("cat-file", "-e", oid) !== null])),
    stash: g(repo, "stash", "list"),
  };
}

/** A retire hook that runs, in the retiring instance's work, the one Git step that
 *  `<agents root>/retire-step.json` names (a list of arguments), if there is one. */
const RETIRE_STEP = `import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
const step = join(process.env.OATS_ROOT, "retire-step.json");
if (existsSync(step)) execFileSync("git", ["-C", join(process.env.OATS_INSTANCE_HOME, "work"), ...JSON.parse(readFileSync(step, "utf8"))], { stdio: "ignore" });
console.log(JSON.stringify({ meta: { retired: true } }));
`;

/** A deployment whose soul works in a worktree of a member clone whose refs are in `format`, and
 *  runs RETIRE_STEP as its retire hook. */
function deployment(t, format) {
  const fx = v2Deployment({
    souls: { dev: { soul: { work: "worktree", capabilities: { "test.step": { from: "here" } } } } },
    capabilities: { "test.step": { manifest: { hooks: { retire: "hook.mjs" } }, files: { "hook.mjs": RETIRE_STEP } } },
  });
  t.after(fx.cleanup);
  const g = gitWith(fx.env);
  if (format === "reftable") g(fx.member, "refs", "migrate", "--ref-format=reftable");
  assert.equal(g(fx.member, "rev-parse", "--show-ref-format"), format, `premise: the clone's refs are in the ${format} format`);
  const hostPath = process.env.PATH; process.env.PATH = fx.env.PATH; t.after(() => { process.env.PATH = hostPath; });
  return {
    fx, g,
    /** Spawn `name`, stage its tree with `stage(g, work)`, read what Git says there, retire it.
     *  → { source, work, home, retire: the retire's answer, repo: the recovery's tree } */
    async retired(name, stage, { hookStep = null, env = {} } = {}) {
      const { home } = await fx.spawn("dev", { instance: name, work: "worktree" });
      const work = join(home, "work");
      stage(g, work);
      const source = gitSays(g, work);
      const step = join(fx.root, "retire-step.json");
      if (hookStep) writeFileSync(step, JSON.stringify(hookStep(g, work))); else rmSync(step, { force: true });
      const retire = await fx.inEnv(() => { Object.assign(process.env, env); return retireInstance(fx.root, name, { tmuxSession: "oats-test-nosuch" }); });
      assert.ok(retire.workRecovery?.path, `a recovery was made: ${JSON.stringify(retire.workRecovery)}`);
      const repo = join(retire.workRecovery.path, "repo");
      assert.ok(existsSync(join(repo, ".git")), "the recovery holds the tree");
      return { source, work, home, retire, repo };
    },
  };
}

const OPERATIONS = [
  { key: "cherry-pick", what: "a cherry-pick stopped on a conflict", ref: "CHERRY_PICK_HEAD",
    stage: (g, t) => { const theirs = conflictOn(g, t, "f.txt"); stops(() => g(t, "cherry-pick", theirs), "the cherry-pick"); } },
  { key: "revert", what: "a revert stopped on a conflict", ref: "REVERT_HEAD",
    stage: (g, t) => { commitFile(g, t, "f.txt", "zero\n"); const one = commitFile(g, t, "f.txt", "one\n"); commitFile(g, t, "f.txt", "two\n"); stops(() => g(t, "revert", "--no-edit", one), "the revert"); } },
  { key: "rebase", what: "a rebase stopped on a conflict", ref: "REBASE_HEAD",
    stage: (g, t) => { const theirs = conflictOn(g, t, "f.txt"); stops(() => g(t, "rebase", theirs), "the rebase"); } },
  { key: "merge", what: "a merge stopped on a conflict, which leaves AUTO_MERGE", ref: "MERGE_HEAD",
    stage: (g, t) => { const theirs = conflictOn(g, t, "f.txt"); stops(() => g(t, "merge", "--no-edit", theirs), "the merge"); } },
  { key: "octopus", what: "a merge of two commits left uncommitted, whose MERGE_HEAD names both", ref: "MERGE_HEAD", heads: 2,
    stage: (g, t) => { commitFile(g, t, "f.txt", "zero\n"); const a = looseChild(g, t, "a.txt", "a\n"), b = looseChild(g, t, "b.txt", "b\n"); g(t, "merge", "--no-commit", "--no-ff", "-q", a, b); } },
];

for (const format of ["files", "reftable"]) {
  test(`[${format}] an operation that stopped: the recovery reads as the source to \`git status\`, holds its refs at the same ids and the objects they name (AUTO_MERGE's tree and the conflict's blobs under it included) (#1038)`, skipFor(format), async (t) => {
    const d = deployment(t, format);
    for (const op of OPERATIONS) {
      await t.test(op.what, async () => {
        const { source, repo } = await d.retired(`dev-${op.key}`, op.stage);
        assert.ok(source.refs[op.ref], `premise: the source's Git holds ${op.ref}: ${JSON.stringify(source.refs)}`);
        if (op.heads) assert.equal(source.mergeHeads.length, op.heads, `premise: MERGE_HEAD names ${op.heads} commits`);
        if (op.key !== "octopus") assert.ok(source.refs.AUTO_MERGE, "premise: the conflict left AUTO_MERGE");
        assert.ok(Object.values(source.objects).every(Boolean), `premise: the source holds every object its refs name: ${JSON.stringify(source.objects)}`);
        const recovered = gitSays(d.g, repo);
        assert.deepEqual(recovered.refs, source.refs, "the operation's refs, at the same ids");
        assert.deepEqual(recovered.mergeHeads, source.mergeHeads, "MERGE_HEAD, line for line");
        assert.deepEqual(recovered.objects, source.objects, "every object the refs name is there, as in the source");
        assert.equal(recovered.status, source.status, "git status --porcelain");
        assert.equal(recovered.operation, source.operation, "git status: the operation it reports");
      });
    }
  });

  test(`[${format}] a link that leads nowhere at a copied name (MERGE_HEAD) is carried as the same link (#1038)`, skipFor(format), async (t) => {
    const d = deployment(t, format);
    let link;
    const { source, repo } = await d.retired("dev-link", (g, t) => {
      commitFile(g, t, "f.txt", "zero\n");
      link = join(gitDirOf(g, t), "MERGE_HEAD");
      symlinkSync("nowhere", link);
      writeFileSync(join(t, "wip.txt"), "uncommitted\n");
    });
    const copy = join(repo, ".git", "MERGE_HEAD");
    assert.equal(lstatSync(copy).isSymbolicLink(), true, "the recovery's MERGE_HEAD is a link");
    assert.equal(readlinkSync(copy), "nowhere", "to the same target");
    assert.deepEqual(gitSays(d.g, repo), source, "and Git reads the recovery as it read the source");
  });

  test(`[${format}] a stash of two entries: \`git stash list\` reads the same in the recovery, messages and order, at the same commits (#1038)`, skipFor(format), async (t) => {
    const d = deployment(t, format);
    const { source, repo } = await d.retired("dev-stash", (g, t) => {
      commitFile(g, t, "f.txt", "zero\n");
      writeFileSync(join(t, "f.txt"), "first change\n"); g(t, "stash", "push", "-q", "-m", "first message");
      writeFileSync(join(t, "f.txt"), "second change\n"); g(t, "stash", "push", "-q", "-m", "second message");
      writeFileSync(join(t, "wip.txt"), "uncommitted\n");
    });
    assert.match(source.stash, /^stash@\{0\}: On [^\n]+: second message\nstash@\{1\}: On [^\n]+: first message$/, `premise: two entries: ${source.stash}`);
    const recovered = gitSays(d.g, repo);
    assert.equal(recovered.stash, source.stash, "git stash list");
    assert.deepEqual(recovered.objects, source.objects, "each entry's commit is there");
    assert.equal(recovered.status, source.status, "git status --porcelain");
  });

  test(`[${format}] a branch and a tag named as two of the operation's refs are not those refs: the recovery holds no CHERRY_PICK_HEAD and no AUTO_MERGE (#1038)`, skipFor(format), async (t) => {
    const d = deployment(t, format);
    const { repo } = await d.retired("dev-names", (g, t) => {
      commitFile(g, t, "f.txt", "zero\n");
      g(t, "branch", "CHERRY_PICK_HEAD");
      g(t, "tag", "AUTO_MERGE");
      assert.ok(g(t, "rev-parse", "--verify", "--quiet", "CHERRY_PICK_HEAD"), "premise: rev-parse finds the branch by that name");
      writeFileSync(join(t, "wip.txt"), "uncommitted\n");
    });
    for (const name of ["CHERRY_PICK_HEAD", "AUTO_MERGE"]) {
      assert.equal(spawnSync("git", ["-C", repo, "show-ref", "--verify", "--quiet", name]).status, 1, `no ref named exactly ${name} in the recovery`);
      assert.equal(existsSync(join(repo, ".git", name)), false, `nothing at .git/${name}`);
    }
  });

  test(`[${format}] a MERGE_HEAD that names a commit the source lacks is carried as it is: the recovery names it too, and lacks it too (#1038)`, skipFor(format), async (t) => {
    const d = deployment(t, format);
    const absent = "1".repeat(40);
    const { source, repo } = await d.retired("dev-dangling", (g, t) => {
      commitFile(g, t, "f.txt", "zero\n");
      writeFileSync(join(gitDirOf(g, t), "MERGE_HEAD"), `${absent}\n`);
      writeFileSync(join(t, "wip.txt"), "uncommitted\n");
    });
    assert.deepEqual([source.mergeHeads, source.objects[absent]], [[absent], false], "premise: the source names a commit it lacks");
    assert.deepEqual(gitSays(d.g, repo), source, "the recovery reads as the source");
  });
}

test("[reftable] an operation's ref the source holds without its object cannot be written into the recovery: the retire is refused as a failed copy, and the home is kept (#1038)", skipFor("reftable"), async (t) => {
  const d = deployment(t, "reftable");
  const { home } = await d.fx.spawn("dev", { instance: "dev-lost", work: "worktree" });
  const work = join(home, "work");
  const theirs = conflictOn(d.g, work, "f.txt");
  stops(() => d.g(work, "cherry-pick", theirs), "the cherry-pick");
  // The cherry-picked commit is loose (nothing packed it) and no branch holds it: removing its file
  // leaves CHERRY_PICK_HEAD naming nothing, in the source as in its Git directory.
  const loose = join(d.g(work, "rev-parse", "--path-format=absolute", "--git-common-dir"), "objects", theirs.slice(0, 2), theirs.slice(2));
  rmSync(loose);
  assert.equal(spawnSync("git", ["-C", work, "cat-file", "-e", theirs]).status !== 0, true, "premise: the source lacks the commit");
  await assert.rejects(() => d.fx.inEnv(() => retireInstance(d.fx.root, "dev-lost", { tmuxSession: "oats-test-nosuch" })),
    (e) => e.code === "E_WORK_PRESERVATION_FAILED" && /CHERRY_PICK_HEAD/.test(e.message), "refused as a recovery that could not be made");
  assert.equal(existsSync(join(home, "instance.json")), true, "the home is kept");
});

/** The recovery of the work as the retire hooks left it: `after-hooks/repo` when the work changed
 *  while they ran, else `repo`. */
const latestCopy = (retire) => (existsSync(join(retire.workRecovery.path, "after-hooks", "repo")) ? join(retire.workRecovery.path, "after-hooks", "repo") : join(retire.workRecovery.path, "repo"));

for (const format of ["files", "reftable"]) {
  test(`[${format}] a retire hook that moves only an operation's ref: the change is seen, and the copy of the work after the hooks holds the ref where the hook left it (#1038)`, skipFor(format), async (t) => {
    const d = deployment(t, format);
    let moved;
    const { retire } = await d.retired("dev-hook-ref", (g, w) => {
      commitFile(g, w, "f.txt", "zero\n"); commitFile(g, w, "f.txt", "one\n");
      g(w, "update-ref", "CHERRY_PICK_HEAD", "HEAD");
      writeFileSync(join(w, "wip.txt"), "uncommitted\n");
    }, { hookStep: (g, w) => { moved = g(w, "rev-parse", "HEAD~1"); return ["update-ref", "CHERRY_PICK_HEAD", moved]; } });
    assert.equal(existsSync(join(retire.workRecovery.path, "after-hooks", "repo")), true, "the work after the hooks differed from the work before them, and was copied again");
    assert.equal(spawnSync("git", ["-C", latestCopy(retire), "rev-parse", "--verify", "--quiet", "CHERRY_PICK_HEAD"], { encoding: "utf8" }).stdout.trim(), moved, "the copy holds CHERRY_PICK_HEAD where the hook left it");
  });

  test(`[${format}] a retire hook that drops one stash entry, leaving the stash's tip: the change is seen, and the copy after the hooks lists the stash as the hook left it (#1038)`, skipFor(format), async (t) => {
    const d = deployment(t, format);
    let left;
    const { retire } = await d.retired("dev-hook-stash", (g, w) => {
      commitFile(g, w, "f.txt", "zero\n");
      writeFileSync(join(w, "f.txt"), "first change\n"); g(w, "stash", "push", "-q", "-m", "first message");
      writeFileSync(join(w, "f.txt"), "second change\n"); g(w, "stash", "push", "-q", "-m", "second message");
      writeFileSync(join(w, "wip.txt"), "uncommitted\n");
    }, { hookStep: (g, w) => { left = g(w, "stash", "list").split("\n")[0]; return ["stash", "drop", "-q", "stash@{1}"]; } });
    assert.equal(existsSync(join(retire.workRecovery.path, "after-hooks", "repo")), true, "the work after the hooks differed from the work before them, and was copied again");
    assert.equal(spawnSync("git", ["-C", latestCopy(retire), "stash", "list"], { encoding: "utf8" }).stdout.trim(), left, "the copy lists the one entry the hook left");
  });

  test(`[${format}] an operator whose Git makes new repositories in the reftable format (init.defaultRefFormat, GIT_DEFAULT_REF_FORMAT): the recovery's refs are still files, and it holds the operation's ref (#1038)`, skipFor("reftable"), async (t) => {
    const d = deployment(t, format);
    for (const [how, env] of [
      ["init.defaultRefFormat in the operator's global configuration", (dir) => { const file = join(dir, "global-gitconfig"); writeFileSync(file, "[init]\n\tdefaultRefFormat = reftable\n"); return { GIT_CONFIG_GLOBAL: file }; }],
      ["GIT_DEFAULT_REF_FORMAT in the environment", () => ({ GIT_DEFAULT_REF_FORMAT: "reftable" })],
    ]) {
      await t.test(how, async () => {
        let held;
        const name = `dev-format-${how.startsWith("init") ? "config" : "env"}`;
        const { repo, source } = await d.retired(name, (g, w) => {
          commitFile(g, w, "f.txt", "zero\n");
          g(w, "update-ref", "CHERRY_PICK_HEAD", "HEAD");
          held = g(w, "rev-parse", "HEAD");
          writeFileSync(join(w, "wip.txt"), "uncommitted\n");
        }, { env: env(d.fx.base) });
        assert.equal(source.refs.CHERRY_PICK_HEAD, held, "premise: the source holds CHERRY_PICK_HEAD");
        assert.equal(d.g(repo, "rev-parse", "--show-ref-format"), "files", "the recovery stores its refs as files");
        assert.equal(gitSays(d.g, repo).refs.CHERRY_PICK_HEAD, held, "and holds CHERRY_PICK_HEAD");
      });
    }
  });
}
