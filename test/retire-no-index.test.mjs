// A work tree with no index file can be retired (awebai/oats#1048). Git reads such a tree as one
// whose index lists nothing: every committed file is a staged deletion, and every file in the tree
// is untracked. It is what `git worktree add --no-checkout` leaves, and what a tree is once its
// index file is removed. The retire always copies such a tree, and the copy carries "no index" as
// no index: the recovery's repository has no index file either, so Git reads it as it read the
// tree. Every case goes through a real retire of a real scratch clone, as a child process.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { devNull } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const UNCOMMITTED = "it holds uncommitted, untracked or ignored files";

/** A deployment whose soul dev works in a worktree of the member clone, and one instance of it,
 *  never launched. `git` runs in the fixture's environment, with nothing of the operator's. */
function instance(t, purpose) {
  const fx = v2Deployment({ souls: { dev: { soul: { work: "worktree" }, agents: "# Dev\n" } }, files: { ".gitignore": "human-ignored/\n", "tracked.txt": "base\n" } });
  t.after(fx.cleanup);
  const bin = join(fx.base, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "pi"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const env = { ...fx.env, PATH: `${bin}:${fx.env.PATH}` };
  for (const key of Object.keys(env)) if (key.startsWith("GIT_") || /_proxy$/i.test(key) || key.endsWith("TMUX_SESSION")) delete env[key];
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: devNull, GIT_TERMINAL_PROMPT: "0" });
  const gitEnv = { PATH: process.env.PATH, HOME: fx.base, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: devNull, GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.invalid" };
  const git = (repo, ...args) => execFileSync("git", [...(repo === null ? [] : ["-C", repo]), "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: gitEnv });
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args, "--dir", fx.dep], { cwd: fx.dep, encoding: "utf8", env });
  const spawned = cli("spawn", "dev", "--purpose", purpose, "--no-launch", "--json");
  assert.equal(spawned.status, 0, `${spawned.stderr}\n${spawned.stdout}`);
  const home = JSON.parse(spawned.stdout).result.home;
  return { fx, home, work: join(home, "work"), name: basename(home), git, cli };
}
const gitDirOf = (w, tree) => w.git(tree, "rev-parse", "--absolute-git-dir").trim();
/** What Git reads in `tree`: every row, the ignored files too. */
const statusOf = (w, tree) => w.git(tree, "status", "--porcelain=v2", "-z", "--untracked-files=all", "--ignored=matching", "--ignore-submodules=none");
const rowsOf = (status) => status.split("\0").filter(Boolean);
/** No entry at all, not even a link: the tree has no index file. */
const noEntryAt = (path) => { try { lstatSync(path); return false; } catch (e) { return e.code === "ENOENT"; } };
/** Every committed file of `tree` is a staged deletion, and nothing else is staged: Git reads an index that lists nothing. */
function readsAsNoIndex(w, tree) {
  const committed = w.git(tree, "ls-tree", "-r", "--name-only", "-z", "HEAD").split("\0").filter(Boolean).sort();
  const staged = rowsOf(statusOf(w, tree)).filter((row) => row.startsWith("1 "));
  assert.deepEqual(staged.map((row) => row.slice(2, 4)), committed.map(() => "D."), "every staged row is a deletion");
  assert.deepEqual(staged.map((row) => row.split(" ").slice(8).join(" ")).sort(), committed, "of every committed file");
}
/** Retire the instance: → its receipt. The retire must complete and remove the home. */
function retired(w, ...flags) {
  const r = w.cli("retire", w.name, ...flags, "--json");
  assert.equal(r.status, 0, `the retire was refused: ${r.stdout}\n${r.stderr}`);
  const receipt = JSON.parse(r.stdout);
  assert.equal(existsSync(w.home), false, "the home is removed");
  assert.deepEqual((receipt.warnings ?? []).filter((warning) => /index/.test(warning)), [], "the receipt says nothing of the index: nothing is owed to the operator for it");
  return receipt;
}
/** The recovery's copy of the work, checked to have no index file and to read to Git as the source did. */
function recoveredWithNoIndex(w, receipt, source, ...under) {
  assert.ok(receipt.workRecovery?.path, `a recovery was written: ${JSON.stringify(receipt)}`);
  const repo = join(receipt.workRecovery.path, "repo", ...under);
  assert.equal(noEntryAt(join(repo, ".git", "index")), true, "the recovery's repository has no index file either");
  assert.equal(statusOf(w, repo), source.status, "the recovery's repository reads to Git as the tree did");
  assert.equal(w.git(repo, "rev-parse", "HEAD").trim(), source.head, "at the same commit");
  return repo;
}
/** What the tree is before the retire, checked to be one with no index file. */
function sourceOf(w, tree) {
  assert.equal(existsSync(join(gitDirOf(w, tree), "index")), false, "fixture premise: Git finds no index file");
  readsAsNoIndex(w, tree);
  return { status: statusOf(w, tree), head: w.git(tree, "rev-parse", "HEAD").trim() };
}

/** What stands under the recovery root of the instance's soul: recoveries, and a staging while one is written. */
const recoveriesOf = (w) => { const root = join(dirname(w.home), ".oats-retirement", "recovery"); return existsSync(root) ? readdirSync(root) : []; };
const removeIndex = (w, tree = w.work) => rmSync(join(gitDirOf(w, tree), "index"));
/** The instance's own tree, made again by Git with no checkout: no index file, and no file in the tree. */
function ownTreeWithNoCheckout(w) {
  const branch = w.git(w.work, "rev-parse", "--abbrev-ref", "HEAD").trim();
  w.git(w.fx.member, "worktree", "remove", "--force", w.work);
  w.git(w.fx.member, "worktree", "add", "--quiet", "--no-checkout", w.work, branch);
  assert.deepEqual(readdirSync(w.work), [".git"], "fixture premise: nothing is checked out");
}

// ---- The instance's own tree: it is copied, and until this change the copy refused it ----

for (const { state, stage, holds = {} } of [
  { state: "its index file removed from a clean tree", stage: (w) => removeIndex(w), holds: { "tracked.txt": "base\n" } },
  { state: "its index file removed from a tree with a changed file and an untracked one",
    stage: (w) => { writeFileSync(join(w.work, "tracked.txt"), "changed\n"); writeFileSync(join(w.work, "scratch.txt"), "untracked\n"); removeIndex(w); },
    holds: { "tracked.txt": "changed\n", "scratch.txt": "untracked\n" } },
  { state: "made by `git worktree add --no-checkout`", stage: ownTreeWithNoCheckout },
  { state: "a link that leads nowhere where its index belongs", stage: (w) => { removeIndex(w); symlinkSync(join(w.fx.base, "no-index-here"), join(gitDirOf(w, w.work), "index")); }, holds: { "tracked.txt": "base\n" } },
]) {
  test(`an instance whose own tree has no index file (${state}) is retired: the recovery's repository has none either, and reads to Git as the tree did`, (t) => {
    const w = instance(t, "own");
    stage(w);
    const source = sourceOf(w, w.work);
    const receipt = retired(w, "--discard-worktree");
    assert.equal(receipt.retention.worktree, "removed");
    const repo = recoveredWithNoIndex(w, receipt, source);
    for (const [file, bytes] of Object.entries(holds)) assert.equal(readFileSync(join(repo, file), "utf8"), bytes, `the recovery holds ${file}: the files of such a tree are the work`);
    if (!Object.keys(holds).length) assert.deepEqual(readdirSync(repo), [".git"], "a tree with no file is copied as one");
  });
}

for (const flags of [[], ["--force"]]) {
  test(`a retire${flags.length ? ` with ${flags.join(" ")}` : ""} that keeps the work re-homes a tree with no index file as it is, and its recovery has none either`, (t) => {
    const w = instance(t, "kept");
    writeFileSync(join(w.work, "scratch.txt"), "untracked\n");
    removeIndex(w);
    const source = sourceOf(w, w.work);
    const receipt = retired(w, ...flags);
    assert.equal(receipt.retention.worktree, "retained");
    assert.equal(noEntryAt(join(gitDirOf(w, receipt.retention.movedTo), "index")), true, "the re-homed tree still has no index file");
    assert.equal(statusOf(w, receipt.retention.movedTo), source.status, "and reads to Git as it did");
    recoveredWithNoIndex(w, receipt, source);
  });
}

test("a retire with --force --discard-worktree of a tree with no index file completes as with --discard-worktree alone", (t) => {
  const w = instance(t, "forced");
  removeIndex(w);
  const source = sourceOf(w, w.work);
  const receipt = retired(w, "--force", "--discard-worktree");
  assert.equal(receipt.retention.worktree, "removed");
  recoveredWithNoIndex(w, receipt, source);
});

test("`git reset` in a recovery with no index file makes one from HEAD: the committed files are tracked again, and what was changed in the tree shows as changed", (t) => {
  const w = instance(t, "reset");
  writeFileSync(join(w.work, "tracked.txt"), "changed\n");
  writeFileSync(join(w.work, "scratch.txt"), "untracked\n");
  removeIndex(w);
  const source = sourceOf(w, w.work);
  const repo = recoveredWithNoIndex(w, retired(w, "--discard-worktree"), source);
  w.git(repo, "reset", "--quiet");
  assert.equal(lstatSync(join(repo, ".git", "index")).isFile(), true);
  assert.deepEqual(rowsOf(w.git(repo, "status", "--porcelain=v1", "-z", "--untracked-files=all")).sort(), [" M tracked.txt", "?? scratch.txt"]);
});

test("a tree with no index file and a merge left open is retired, and the recovery carries the merge with no index", (t) => {
  const w = instance(t, "merge");
  const head = w.git(w.work, "rev-parse", "HEAD").trim();
  const other = w.git(w.work, "commit-tree", "-p", head, "-m", "other", `${head}^{tree}`).trim();
  w.git(w.work, "merge", "--no-commit", "--no-ff", "--quiet", other);
  assert.equal(readFileSync(join(gitDirOf(w, w.work), "MERGE_HEAD"), "utf8").trim(), other, "fixture premise: the merge is open");
  removeIndex(w);
  const source = sourceOf(w, w.work);
  const repo = recoveredWithNoIndex(w, retired(w, "--discard-worktree"), source);
  assert.equal(readFileSync(join(repo, ".git", "MERGE_HEAD"), "utf8").trim(), other, "the recovery's repository is in the same merge");
});

/** A repository of its own under the instance's tree, in a directory the tree ignores, with one commit. */
function nestedRepository(w) {
  const nested = join(w.work, "human-ignored", "nested");
  mkdirSync(nested, { recursive: true });
  w.git(null, "init", "--quiet", nested);
  writeFileSync(join(nested, "nested.txt"), "nested\n");
  w.git(nested, "add", ".");
  w.git(nested, "commit", "--quiet", "-m", "nested");
  return nested;
}

test("a nested repository that has a commit and no index file is copied with none, and reads to Git as it did", (t) => {
  const w = instance(t, "nested");
  const nested = nestedRepository(w);
  removeIndex(w, nested);
  const source = sourceOf(w, nested);
  const receipt = retired(w, "--discard-worktree");
  assert.ok(receipt.workRecovery?.classes?.includes("nested repository state"), JSON.stringify(receipt.workRecovery));
  const repo = recoveredWithNoIndex(w, receipt, source, "human-ignored", "nested");
  assert.equal(readFileSync(join(repo, "nested.txt"), "utf8"), "nested\n");
});

// ---- An extra tree is never copied: it is re-homed as it is, before this change and after it ----

for (const { state, add } of [
  { state: "made by `git worktree add --no-checkout`", add: (w, path) => w.git(w.work, "worktree", "add", "--quiet", "--no-checkout", "-b", "agents/extra-1048", path) },
  { state: "whose index file was removed", add: (w, path) => { w.git(w.work, "worktree", "add", "--quiet", "-b", "agents/extra-1048", path); removeIndex(w, path); } },
]) {
  test(`an extra tree with no index file (${state}) is re-homed as it is: it holds uncommitted work by Git's reading, and no copy is made of it`, (t) => {
    const w = instance(t, "extra");
    const path = join(w.home, ".work-extra");
    add(w, path);
    const source = sourceOf(w, path);
    const receipt = retired(w);
    assert.equal(receipt.extraWorktrees.length, 1, JSON.stringify(receipt.extraWorktrees));
    const [row] = receipt.extraWorktrees;
    assert.deepEqual({ path: row.path, branch: row.branch, disposition: row.disposition, reason: row.reason, outcome: row.outcome },
      { path, branch: "agents/extra-1048", disposition: "retain", reason: UNCOMMITTED, outcome: "retained" });
    assert.equal(noEntryAt(join(gitDirOf(w, row.movedTo), "index")), true, "the re-homed tree still has no index file");
    assert.equal(statusOf(w, row.movedTo), source.status, "and reads to Git as it did");
    assert.equal(receipt.workRecovery?.path ?? null, null, "no recovery is written: the tree itself is kept");
  });
}

// ---- An index that is there, in place or not, is answered as before ----

test("an index that is a link to a regular file is copied as that file: the recovery's index is a plain file that Git reads the same way", (t) => {
  const w = instance(t, "linked");
  writeFileSync(join(w.work, "tracked.txt"), "changed\n");
  w.git(w.work, "add", "tracked.txt");
  writeFileSync(join(w.work, "scratch.txt"), "untracked\n");
  const index = join(gitDirOf(w, w.work), "index");
  renameSync(index, join(w.fx.base, "index-elsewhere"));
  symlinkSync(join(w.fx.base, "index-elsewhere"), index);
  const status = statusOf(w, w.work);
  assert.deepEqual(rowsOf(status).map((row) => row.slice(0, 4)), ["1 M.", "? sc"], "fixture premise: Git reads the index through the link");
  const receipt = retired(w, "--discard-worktree");
  const repo = join(receipt.workRecovery.path, "repo");
  assert.equal(lstatSync(join(repo, ".git", "index")).isFile(), true, "a plain file, not a link");
  assert.equal(statusOf(w, repo), status);
});

test("a directory where the index belongs is not a tree with no index: Git cannot read the tree, and the retire refuses before it touches anything", (t) => {
  const w = instance(t, "directory");
  writeFileSync(join(w.work, "scratch.txt"), "untracked\n");
  removeIndex(w);
  mkdirSync(join(gitDirOf(w, w.work), "index"));
  const r = w.cli("retire", w.name, "--discard-worktree", "--json");
  assert.notEqual(r.status, 0, `a tree that Git cannot read was retired: ${r.stdout}`);
  assert.equal(JSON.parse(r.stdout).error.code, "E_WORK_INSPECTION_FAILED", r.stdout);
  assert.equal(readFileSync(join(w.work, "scratch.txt"), "utf8"), "untracked\n", "the home and the work are kept");
  assert.deepEqual(recoveriesOf(w), [], "neither a recovery nor its staging is left behind");
});

test("a directory where a nested repository's index belongs: Git cannot read that repository, and the retire refuses with Git's message when it reads its state for the copy", (t) => {
  const w = instance(t, "nested-directory");
  const nested = nestedRepository(w);
  removeIndex(w, nested);
  mkdirSync(join(nested, ".git", "index"));
  const r = w.cli("retire", w.name, "--discard-worktree", "--json");
  assert.notEqual(r.status, 0, `a nested repository that Git cannot read was retired: ${r.stdout}`);
  const error = JSON.parse(r.stdout).error;
  assert.equal(error.code, "E_WORK_PRESERVATION_FAILED", r.stdout);
  assert.match(error.message, /nested\/\.git\/index/, "the message names the index");
  assert.doesNotMatch(error.message, /as a file, and/, "it is Git's failure, met before the copier looks at the index");
  assert.match(error.message, /No retire hook has run, no recovery was written and nothing was deleted/);
  assert.equal(readFileSync(join(nested, "nested.txt"), "utf8"), "nested\n", "the home and the work are kept");
  assert.deepEqual(recoveriesOf(w), [], "neither a recovery nor its staging is left behind");
});
