// A work tree that holds a nested repository with no commit at its HEAD can be retired
// (awebai/oats#1078). `git init` in a directory of the work, and nobody commits in it: a scratch
// directory, a tool's cache, a repository an agent started. Its HEAD names a branch that is not
// born. So does the HEAD of a repository with commits after `git switch --orphan`. The recovery
// rebuilds every nested repository from a clone, and holds this one as Git read it in the source:
// HEAD on the same name with no commit, the same local branches, the same index and status, and
// every file. Every case goes through a real retire of a real scratch clone, as a child process.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { devNull } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
/** Where the nested repositories of these tests stand, under a directory the instance's tree ignores. */
const NESTED = join("human-ignored", "nested");

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
  const run = (repo, args, options = {}) => execFileSync("git", [...(repo === null ? [] : ["-C", repo]), "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", ...args], { stdio: ["ignore", "pipe", "pipe"], env: gitEnv, ...options });
  const git = (repo, ...args) => run(repo, args, { encoding: "utf8" });
  /** One value Git may not have → its text, or null when Git answers quietly that it has none (exit 1). */
  const gitValue = (repo, ...args) => { try { return git(repo, ...args).trim(); } catch (e) { if (e.status === 1) return null; throw e; } };
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args, "--dir", fx.dep], { cwd: fx.dep, encoding: "utf8", env });
  const spawned = cli("spawn", "dev", "--purpose", purpose, "--no-launch", "--json");
  assert.equal(spawned.status, 0, `${spawned.stderr}\n${spawned.stdout}`);
  const home = JSON.parse(spawned.stdout).result.home;
  return { fx, home, work: join(home, "work"), name: basename(home), git, gitValue, cli };
}
/** `git init` in a directory of the instance's tree → its path. */
function init(w, rel = NESTED) {
  const dir = join(w.work, rel);
  mkdirSync(dir, { recursive: true });
  w.git(null, "init", "--quiet", dir);
  return dir;
}
const commitFile = (w, repo, file, text) => { writeFileSync(join(repo, file), text); w.git(repo, "add", file); w.git(repo, "commit", "--quiet", "-m", file); return w.git(repo, "rev-parse", "HEAD").trim(); };
/** No entry at all, not even a link. */
const noEntryAt = (path) => { try { lstatSync(path); return false; } catch (e) { return e.code === "ENOENT"; } };
/** The files under `dir` with their bytes, Git's own directory left out. */
function filesOf(dir, rel = "") {
  const out = {};
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git") continue;
    if (e.isDirectory()) Object.assign(out, filesOf(join(dir, e.name), `${rel}${e.name}/`));
    else out[`${rel}${e.name}`] = readFileSync(join(dir, e.name), "utf8");
  }
  return out;
}
/** What Git reads of a repository, and what the tree holds: what a recovery of it must give back. */
const read = (w, repo) => ({
  head: w.gitValue(repo, "symbolic-ref", "--quiet", "HEAD"),
  commit: w.gitValue(repo, "rev-parse", "--verify", "--quiet", "HEAD"),
  branches: w.git(repo, "for-each-ref", "--format=%(refname) %(objectname)", "refs/heads/"),
  index: w.git(repo, "ls-files", "--stage", "-z"),
  hasIndex: !noEntryAt(join(repo, ".git", "index")),
  status: w.git(repo, "status", "--porcelain=v2", "-z", "--untracked-files=all", "--ignored=matching"),
  files: filesOf(repo),
});
/** What the repository is before the retire, checked to be one whose HEAD names a branch with no commit. */
function unborn(w, repo, branch = "main") {
  const source = read(w, repo);
  assert.equal(source.head, `refs/heads/${branch}`, "fixture premise: HEAD names a branch");
  assert.equal(source.commit, null, "fixture premise: and has no commit");
  return source;
}
/** Retire the instance: → its receipt. The retire must complete and remove the home. */
function retired(w, ...flags) {
  const r = w.cli("retire", w.name, ...flags, "--json");
  assert.equal(r.status, 0, `the retire was refused: ${r.stdout}\n${r.stderr}`);
  const receipt = JSON.parse(r.stdout);
  assert.equal(existsSync(w.home), false, "the home is removed");
  assert.deepEqual(receipt.warnings ?? [], [], "no warning is new: the receipt has none for it");
  assert.ok(receipt.workRecovery?.path, `a recovery was written: ${r.stdout}`);
  assert.ok(receipt.workRecovery.classes.includes("nested repository state"), `under the class nested repositories have: ${JSON.stringify(receipt.workRecovery.classes)}`);
  return receipt;
}
/** The recovery's copy of a nested repository at `rel`, checked to be a repository of its own that reads as `source` did. */
function recovered(w, receipt, source, rel = NESTED) {
  const repo = join(receipt.workRecovery.path, "repo", rel);
  assert.equal(lstatSync(join(repo, ".git")).isDirectory(), true, "the recovery holds a repository there");
  assert.deepEqual(read(w, repo), source, "the recovery's repository reads to Git as the source did, and holds every file");
  assert.equal(noEntryAt(join(repo, ".git", "objects", "info", "alternates")), true, "and stands on its own objects");
  assert.equal(w.gitValue(repo, "config", "--get", "remote.origin.url"), null, "with no remote left to the source");
  return repo;
}
const recoveriesOf = (w) => { const root = join(dirname(w.home), ".oats-retirement", "recovery"); return existsSync(root) ? readdirSync(root) : []; };

// ---- `git init`, and nobody committed ----

for (const flags of [["--discard-worktree"], [], ["--force"]]) {
  test(`a retire${flags.length ? ` with ${flags.join(" ")}` : ""} completes for a work tree that holds a repository after \`git init\` and nothing else: the recovery's is on the same branch, with no commit and no index file`, (t) => {
    const w = instance(t, "init");
    const nested = init(w);
    const source = unborn(w, nested);
    assert.equal(source.hasIndex, false, "fixture premise: `git init` writes no index");
    const receipt = retired(w, ...flags);
    recovered(w, receipt, source);
    assert.equal(receipt.retention.worktree, flags.includes("--discard-worktree") ? "removed" : "retained");
    if (receipt.retention.worktree === "retained") assert.deepEqual(read(w, join(receipt.retention.movedTo, NESTED)), source, "the re-homed tree holds the repository as it was");
  });
}

test("`git init` and untracked files: the recovery's repository holds them, untracked, on the branch that is not born", (t) => {
  const w = instance(t, "untracked");
  const nested = init(w);
  writeFileSync(join(nested, "a.txt"), "a\n");
  mkdirSync(join(nested, "sub"));
  writeFileSync(join(nested, "sub", "b.txt"), "b\n");
  const source = unborn(w, nested);
  assert.deepEqual(source.files, { "a.txt": "a\n", "sub/b.txt": "b\n" });
  recovered(w, retired(w, "--discard-worktree"), source);
});

test("`git init` and staged files: the recovery's index names the staged blobs and its object store has them, also where the file was changed after the `git add`", (t) => {
  const w = instance(t, "staged");
  const nested = init(w);
  writeFileSync(join(nested, "staged.txt"), "staged\n");
  writeFileSync(join(nested, "later.txt"), "as staged\n");
  w.git(nested, "add", "staged.txt", "later.txt");
  writeFileSync(join(nested, "later.txt"), "changed after the add\n");
  const source = unborn(w, nested);
  assert.equal(source.hasIndex, true);
  const repo = recovered(w, retired(w, "--discard-worktree"), source);
  assert.equal(w.git(repo, "show", ":staged.txt"), "staged\n");
  assert.equal(w.git(repo, "show", ":later.txt"), "as staged\n", "the staged bytes, which no file and no commit holds");
  assert.equal(readFileSync(join(repo, "later.txt"), "utf8"), "changed after the add\n");
});

test("a repository that does not tell a clone which branch its HEAD names (`lsrefs.unborn=ignore`): the recovery's HEAD is on that branch all the same, put there by the copy and not by the clone", (t) => {
  const w = instance(t, "untold");
  const nested = init(w);
  w.git(nested, "symbolic-ref", "HEAD", "refs/heads/trunk-1078");
  w.git(nested, "config", "lsrefs.unborn", "ignore");
  writeFileSync(join(nested, "a.txt"), "a\n");
  const source = unborn(w, nested, "trunk-1078");
  recovered(w, retired(w, "--discard-worktree"), source);
});

// ---- A repository with commits whose HEAD was moved to a branch that does not exist ----

test("a repository with commits after `git switch --orphan`: the recovery has its other branches with their commits and their logs, and its HEAD on the name that is not born", (t) => {
  const w = instance(t, "orphan");
  const nested = init(w);
  const one = commitFile(w, nested, "one.txt", "one\n");
  w.git(nested, "branch", "side");
  const two = commitFile(w, nested, "two.txt", "two\n");
  // A commit only HEAD's log names: made detached, on no branch.
  w.git(nested, "checkout", "--quiet", "--detach");
  const loose = commitFile(w, nested, "loose.txt", "loose\n");
  w.git(nested, "switch", "--quiet", "--orphan", "fresh");
  writeFileSync(join(nested, "new.txt"), "new\n");
  const source = unborn(w, nested, "fresh");
  assert.equal(source.branches, `refs/heads/main ${two}\nrefs/heads/side ${one}\n`, "fixture premise: the other branches are there");
  const logOf = (repo, ...ref) => readFileSync(join(repo, ".git", "logs", ...ref), "utf8");
  const headLog = logOf(nested, "HEAD"), mainLog = logOf(nested, "refs", "heads", "main");
  const repo = recovered(w, retired(w, "--discard-worktree"), source);
  assert.equal(w.git(repo, "show", "main:two.txt"), "two\n", "a branch's commit can be read in the recovery");
  assert.equal(logOf(repo, "refs", "heads", "main"), mainLog, "a branch's log is the source's");
  assert.equal(logOf(repo, "HEAD"), headLog, "HEAD's log is the source's");
  assert.equal(w.git(repo, "show", `${loose}:loose.txt`), "loose\n", "and a commit only that log names is in the recovery");
});

test("a repository with no commit beside one with commits, in the same work tree: both are in the recovery, each as Git read it", (t) => {
  const w = instance(t, "beside");
  const empty = init(w);
  writeFileSync(join(empty, "a.txt"), "a\n");
  const other = join("human-ignored", "with-commits");
  const full = init(w, other);
  const head = commitFile(w, full, "one.txt", "one\n");
  writeFileSync(join(full, "one.txt"), "changed\n");
  const sourceEmpty = unborn(w, empty), sourceFull = read(w, full);
  assert.equal(sourceFull.commit, head, "fixture premise: the other repository has a commit at its HEAD");
  const receipt = retired(w, "--discard-worktree");
  recovered(w, receipt, sourceEmpty);
  recovered(w, receipt, sourceFull, other);
});

// ---- What is not this change: answered as before. (The instance's own tree with no commit at its HEAD
// is refused at the inspection: test/retire-leaves-branches.test.mjs holds that.) ----

test("a repository with no commit inside a nested repository is no repository of its own to the copy: it comes along as its parent's files, its Git directory included", (t) => {
  const w = instance(t, "inner");
  const outer = init(w);
  commitFile(w, outer, "one.txt", "one\n");
  const inner = init(w, join(NESTED, "inner"));
  writeFileSync(join(inner, "a.txt"), "a\n");
  w.git(inner, "add", "a.txt");
  const sourceInner = unborn(w, inner);
  const receipt = retired(w, "--discard-worktree");
  assert.deepEqual(read(w, join(receipt.workRecovery.path, "repo", NESTED, "inner")), sourceInner);
});

for (const { what, point } of [
  { what: "a ref outside refs/heads", point: (w, nested) => w.git(nested, "symbolic-ref", "HEAD", "refs/elsewhere/x") },
  // HEAD is a file, and a branch that is not born has no file of its own: the name is written as bytes.
  { what: "a branch whose name is not UTF-8", point: (w, nested) => writeFileSync(join(nested, ".git", "HEAD"), Buffer.concat([Buffer.from("ref: refs/heads/caf"), Buffer.from([0xe9]), Buffer.from("\n")])) },
]) {
  test(`a HEAD with no commit that names no local branch the kernel carries (${what}) is refused as before, in the kernel's words and with nothing touched, and \`git switch -c\` there makes the work tree retirable`, (t) => {
    const w = instance(t, "no-branch");
    const nested = init(w);
    point(w, nested);
    writeFileSync(join(nested, "a.txt"), "a\n");
    // Git must read that HEAD as a symbolic ref with no commit, or this is another case.
    try { assert.match(w.git(nested, "symbolic-ref", "--quiet", "HEAD"), /^refs\//); assert.equal(w.gitValue(nested, "rev-parse", "--verify", "--quiet", "HEAD"), null); }
    catch (e) { t.skip(`Git here does not read such a HEAD as a ref with no commit (${String(e.stderr ?? e.message).trim().split("\n")[0]})`); return; }
    const r = w.cli("retire", w.name, "--discard-worktree", "--json");
    assert.notEqual(r.status, 0, `a repository whose HEAD the copy cannot stand on was retired: ${r.stdout}`);
    const error = JSON.parse(r.stdout).error;
    assert.equal(error.code, "E_WORK_PRESERVATION_FAILED", r.stdout);
    assert.ok(error.message.includes(`nested repository ${nested} has no commit at its HEAD, and its HEAD names no local branch.`), `the kernel's sentence, with the repository's path and without what its HEAD holds: ${error.message}`);
    assert.doesNotMatch(error.message, /ambiguous argument|elsewhere|caf/, "not Git's message, and not the name in HEAD");
    assert.match(error.message, /No retire hook has run, no recovery was written and nothing was deleted/);
    assert.equal(readFileSync(join(nested, "a.txt"), "utf8"), "a\n", "the home and the work are kept");
    assert.deepEqual(recoveriesOf(w), [], "neither a recovery nor its staging is left behind");
    // The way out the docs give: on a local branch, the same work tree is retired.
    w.git(nested, "switch", "--quiet", "-c", "main");
    const source = unborn(w, nested);
    recovered(w, retired(w, "--discard-worktree"), source);
  });
}
