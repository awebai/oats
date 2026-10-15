// A Git operation is "in progress" in a tree by what Git itself reads for it (awebai/oats#1008).
// One function answers the question (gitOperationInProgress, lib/core.mjs) for the three places
// that ask it: a retire's extra trees, the recovery of the instance's own tree, and the listing of
// what retires retained. What an operation that ended left in the Git directory is not an
// operation: such a tree is clean. Every state below is staged in a linked worktree of a real
// scratch clone, most of them by Git itself, and each is made so that `git status` reports no
// file: the operation, or its leftover, is then the only thing that tells the tree from a clean one.
// Each place is walked twice: in a repository whose refs are files, and in one that stores them in
// the reftable format, where CHERRY_PICK_HEAD and REVERT_HEAD are no files and Git is asked.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GIT_OPERATION_ENTRIES, RECOVERABLE_GIT_ADMIN, gitOperationInProgress, retireInstance } from "../lib/core.mjs";
import { gitRefPresenceOf } from "../lib/instance-git.mjs";
import { fixtureBase } from "./helpers/host-fixture.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { skipFor } from "./helpers/reftable.mjs";

const IN_PROGRESS = "an operation is in progress in it";
const UNCOMMITTED = "it holds uncommitted, untracked or ignored files";

/** Git in `cwd` with the fixture's environment → its trimmed stdout; throws when Git exits non-zero. */
const gitWith = (env) => (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@example.test", "-c", "commit.gpgsign=false", ...args],
  { encoding: "utf8", env: { ...env, GIT_EDITOR: "true" }, stdio: ["ignore", "pipe", "pipe"] }).trim();
const commitFile = (g, tree, file, text) => { writeFileSync(join(tree, file), text); g(tree, "add", file); g(tree, "commit", "-qm", `${file}: ${text.trim()}`); return g(tree, "rev-parse", "HEAD"); };
/** A commit on top of `parent` (HEAD by default) that changes nothing, made without moving any ref. */
const emptyChild = (g, tree, parent = "HEAD") => g(tree, "commit-tree", "HEAD^{tree}", "-p", parent, "-m", "changes nothing");
/** `fn` is a Git command that must stop: an operation that ran to its end would stage nothing. */
const stops = (fn, what) => assert.throws(fn, undefined, `premise: ${what} stops`);
const gitDirOf = (g, tree) => g(tree, "rev-parse", "--absolute-git-dir");
/** What a Git directory holds beside what every worktree's has, for a failure's message. */
const left = (dir) => readdirSync(dir).filter((n) => !["HEAD", "ORIG_HEAD", "FETCH_HEAD", "COMMIT_EDITMSG", "commondir", "gitdir", "index", "logs", "refs", "reftable"].includes(n))
  .map((n) => { if (n !== "sequencer") return n; try { return `sequencer/{${readdirSync(join(dir, n)).join(",")}}`; } catch (e) { return `sequencer (${e.code})`; } }).join(", ") || "nothing";
const inGitDir = (file, text) => (g, tree) => writeFileSync(join(gitDirOf(g, tree), file), text);
/** Three commits of one file, then the step that conflicts in it. */
const conflictOn = (g, tree, file) => { commitFile(g, tree, file, "zero\n"); const theirs = commitFile(g, tree, file, "theirs\n"); g(tree, "reset", "-q", "--hard", "HEAD~1"); commitFile(g, tree, file, "mine\n"); return theirs; };

const PATCH = `From 1111111111111111111111111111111111111111 Mon Sep 17 00:00:00 2001
From: t <t@example.test>
Date: Mon, 1 Jan 2024 00:00:00 +0000
Subject: [PATCH] a patch for a file that is not there

---
 absent-1008.txt | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)

diff --git a/absent-1008.txt b/absent-1008.txt
--- a/absent-1008.txt
+++ b/absent-1008.txt
@@ -1 +1 @@
-what is not there
+other
--
2.0.0

`;

/** Every state: `key` (a tree's purpose and an instance's name), what it is, `operation` (whether
 *  the kernel must answer that an operation is in progress there), `entry` (the entry of the Git
 *  directory that says so), `ref` (Git wrote that entry as a ref: a file in the files format, no
 *  file at all in the reftable format), `conflict` (the tree also holds unmerged files) and
 *  `stage(g, tree, scratch)`, which makes it in a tree on a branch. */
const STATES = [
  // An operation, by each entry Git reads. `git status` lists no file in any of them.
  { key: "rebase", what: "a rebase stopped at an exec step", operation: true, entry: "rebase-merge",
    stage: (g, tree) => { commitFile(g, tree, "a-1008.txt", "a\n"); stops(() => g(tree, "rebase", "-q", "--exec", "false", "HEAD~1"), "a rebase whose exec step fails"); } },
  { key: "am", what: "a `git am` whose patch does not apply", operation: true, entry: "rebase-apply",
    stage: (g, tree, scratch) => { writeFileSync(join(scratch, "absent.mbox"), PATCH); stops(() => g(tree, "am", join(scratch, "absent.mbox")), "git am of a patch for a file that is not there"); } },
  { key: "merge", what: "a merge stopped before its commit", operation: true, entry: "MERGE_HEAD",
    stage: (g, tree) => { g(tree, "merge", "-q", "--no-commit", "--no-ff", emptyChild(g, tree)); } },
  { key: "pick", what: "a cherry-pick of a commit that changes nothing", operation: true, ref: true, entry: "CHERRY_PICK_HEAD",
    stage: (g, tree) => { stops(() => g(tree, "cherry-pick", emptyChild(g, tree)), "a cherry-pick that would make an empty commit"); } },
  { key: "revert", what: "a revert whose conflict was resolved to what HEAD has, not continued", operation: true, ref: true, entry: "REVERT_HEAD",
    stage: (g, tree) => { for (const text of ["zero\n", "one\n", "two\n"]) commitFile(g, tree, "r-1008.txt", text); stops(() => g(tree, "revert", "--no-edit", "HEAD~1"), "a revert that conflicts"); g(tree, "checkout", "-q", "--ours", "r-1008.txt"); g(tree, "add", "r-1008.txt"); } },
  { key: "picks", what: "a cherry-pick of several commits whose first was committed by hand", operation: true, entry: "sequencer/todo",
    stage: (g, tree) => {
      const first = emptyChild(g, tree), second = emptyChild(g, tree, first), third = emptyChild(g, tree, second);
      stops(() => g(tree, "cherry-pick", first, second, third), "a cherry-pick whose first commit would be empty");
      g(tree, "commit", "-q", "--allow-empty", "-m", "by hand");
      assert.throws(() => g(tree, "rev-parse", "-q", "--verify", "CHERRY_PICK_HEAD"), undefined, "premise: the commit by hand removed CHERRY_PICK_HEAD");
    } },
  { key: "bisect", what: "a bisect that was started", operation: true, entry: "BISECT_LOG",
    stage: (g, tree) => { g(tree, "bisect", "start"); } },
  // An operation that Git would not report, and the kernel keeps: the function tests that an
  // entry is there, and an entry it cannot look at is an operation.
  { key: "badpick", what: "a CHERRY_PICK_HEAD that resolves to no commit", operation: true, entry: "CHERRY_PICK_HEAD", stage: inGitDir("CHERRY_PICK_HEAD", "not an object name\n") },
  { key: "badtodo", what: "a sequencer/todo whose first word is no command", operation: true, entry: "sequencer/todo",
    stage: (g, tree) => { mkdirSync(join(gitDirOf(g, tree), "sequencer")); writeFileSync(join(gitDirOf(g, tree), "sequencer", "todo"), "neither of the two words\n"); } },
  { key: "dangling", what: "a dangling symbolic link at MERGE_HEAD", operation: true, entry: "MERGE_HEAD", stage: (g, tree) => symlinkSync("nowhere-1008", join(gitDirOf(g, tree), "MERGE_HEAD")) },
  { key: "loop", what: "a sequencer that is a symbolic link to itself (its todo cannot be looked at: ELOOP)", operation: true, entry: "sequencer/todo", stage: (g, tree) => symlinkSync("sequencer", join(gitDirOf(g, tree), "sequencer")) },
  // An operation with a conflict left in the tree: kept for both reasons.
  { key: "crebase", what: "a rebase stopped on a conflict", operation: true, conflict: true, entry: "rebase-merge",
    // A stopped rebase has HEAD on the commit it rebases onto: a branch keeps that commit reached by a ref.
    stage: (g, tree) => { const theirs = conflictOn(g, tree, "c-1008.txt"); g(tree, "branch", `${g(tree, "branch", "--show-current")}-onto`, theirs); stops(() => g(tree, "rebase", "-q", theirs), "a rebase that conflicts"); } },
  { key: "cmerge", what: "a merge with a conflict", operation: true, conflict: true, entry: "MERGE_HEAD",
    stage: (g, tree) => { const theirs = conflictOn(g, tree, "c-1008.txt"); stops(() => g(tree, "merge", "-q", theirs), "a merge that conflicts"); } },
  { key: "cpick", what: "a cherry-pick stopped on a conflict", operation: true, ref: true, conflict: true, entry: "CHERRY_PICK_HEAD",
    stage: (g, tree) => { const theirs = conflictOn(g, tree, "c-1008.txt"); stops(() => g(tree, "cherry-pick", theirs), "a cherry-pick that conflicts"); } },
  { key: "crevert", what: "a revert stopped on a conflict", operation: true, ref: true, conflict: true, entry: "REVERT_HEAD",
    stage: (g, tree) => { for (const text of ["zero\n", "one\n", "two\n"]) commitFile(g, tree, "c-1008.txt", text); stops(() => g(tree, "revert", "--no-edit", "HEAD~1"), "a revert that conflicts"); } },
  // What Git leaves when an operation ended: made by Git, whatever this Git leaves.
  { key: "rebased", what: "a rebase that stopped on a conflict and was continued to its end", operation: false,
    stage: (g, tree) => {
      const theirs = conflictOn(g, tree, "d-1008.txt");
      stops(() => g(tree, "rebase", "-q", theirs), "a rebase that conflicts");
      writeFileSync(join(tree, "d-1008.txt"), "resolved\n"); g(tree, "add", "d-1008.txt"); g(tree, "rebase", "--continue");
    } },
  { key: "picked", what: "a cherry-pick that ran to its end", operation: false,
    stage: (g, tree) => { const picked = commitFile(g, tree, "p-1008.txt", "p\n"); g(tree, "reset", "-q", "--hard", "HEAD~1"); g(tree, "cherry-pick", picked); } },
  { key: "bisected", what: "a bisect that was started and reset", operation: false, stage: (g, tree) => { g(tree, "bisect", "start"); g(tree, "bisect", "reset"); } },
  // The same leftovers written by hand, one at a time: no Git version decides whether they are there.
  { key: "rebasehead", what: "REBASE_HEAD alone", operation: false, stage: (g, tree) => inGitDir("REBASE_HEAD", `${g(tree, "rev-parse", "HEAD")}\n`)(g, tree) },
  { key: "automerge", what: "AUTO_MERGE alone", operation: false, stage: (g, tree) => inGitDir("AUTO_MERGE", `${g(tree, "rev-parse", "HEAD^{tree}")}\n`)(g, tree) },
  { key: "mergemsg", what: "MERGE_MSG alone", operation: false, stage: inGitDir("MERGE_MSG", "a message nobody committed\n") },
  { key: "bisectstart", what: "BISECT_START alone", operation: false, stage: inGitDir("BISECT_START", "main\n") },
  { key: "bisectnames", what: "BISECT_NAMES alone", operation: false, stage: inGitDir("BISECT_NAMES", "\n") },
  { key: "sequencer", what: "a sequencer directory with no todo", operation: false,
    stage: (g, tree) => { mkdirSync(join(gitDirOf(g, tree), "sequencer")); writeFileSync(join(gitDirOf(g, tree), "sequencer", "head"), `${g(tree, "rev-parse", "HEAD")}\n`); } },
  { key: "leftovers", what: "every leftover at once", operation: false,
    stage: (g, tree) => {
      for (const [file, text] of [["REBASE_HEAD", `${g(tree, "rev-parse", "HEAD")}\n`], ["AUTO_MERGE", `${g(tree, "rev-parse", "HEAD^{tree}")}\n`], ["MERGE_MSG", "a message\n"], ["BISECT_START", "main\n"], ["BISECT_NAMES", "\n"]]) inGitDir(file, text)(g, tree);
      mkdirSync(join(gitDirOf(g, tree), "sequencer"));
    } },
];

const FORMATS = ["files", "reftable"];
/** A deployment whose member clone stores its refs in `format`, turned before any worktree is made.
 *  The files format is every Git's own and is checked without a command an older Git lacks. */
function deployment(t, format, opts) {
  const fx = v2Deployment(opts);
  t.after(fx.cleanup);
  const g = gitWith(fx.env);
  if (format === "reftable") {
    g(fx.member, "refs", "migrate", "--ref-format=reftable");
    assert.equal(g(fx.member, "rev-parse", "--show-ref-format"), "reftable", "premise: the clone's refs are in the reftable format");
  } else assert.equal(existsSync(join(fx.member, ".git", "reftable")), false, "premise: the clone's refs are files");
  return { fx, g };
}

/** Stage `state` in `tree` and check its premises: what `git status` lists, and that the entry
 *  that should say "an operation" is there: as a file, or, for a ref in the reftable format, as a
 *  ref Git resolves with no file of the seven in the Git directory. → that directory. */
function staged(state, g, tree, scratch, format) {
  state.stage(g, tree, scratch);
  const dir = gitDirOf(g, tree);
  const status = g(tree, "status", "--porcelain", "--ignored", "--untracked-files=all");
  if (state.conflict) assert.notEqual(status, "", `premise (${state.key}): the conflict is in the tree`);
  else assert.equal(status, "", `premise (${state.key}): git status lists no file; its Git directory holds ${left(dir)}`);
  if (state.ref && format === "reftable") {
    assert.ok(g(tree, "rev-parse", "-q", "--verify", state.entry), `premise (${state.key}): Git resolves ${state.entry}`);
    const files = GIT_OPERATION_ENTRIES.filter((entry) => { try { lstatSync(join(dir, entry)); return true; } catch { return false; } });
    assert.deepEqual(files, [], `premise (${state.key}): in the reftable format no entry is a file; its Git directory holds ${left(dir)}`);
  } else if (state.entry) assert.ok(readdirSync(dir).includes(state.entry.split("/")[0]), `premise (${state.key}): ${state.entry} is in the Git directory, which holds ${left(dir)}`);
  return dir;
}

test("the entries are the seven `git status` decides from, each alone is an operation, and nothing else of what a recovery copies is one", (t) => {
  assert.deepEqual([...GIT_OPERATION_ENTRIES], ["rebase-apply", "rebase-merge", "MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "sequencer/todo", "BISECT_LOG"]);
  assert.ok(Object.isFrozen(GIT_OPERATION_ENTRIES));
  // What a recovery copies is not this list and did not change.
  assert.deepEqual(RECOVERABLE_GIT_ADMIN, ["MERGE_HEAD", "MERGE_MSG", "AUTO_MERGE", "CHERRY_PICK_HEAD", "REVERT_HEAD", "REBASE_HEAD", "BISECT_LOG", "BISECT_START", "BISECT_NAMES", "rebase-apply", "rebase-merge", "sequencer"]);
  const base = fixtureBase("oats-gitop-");
  t.after(() => rmSync(base, { recursive: true, force: true }));
  let n = 0;
  /** A directory that stands for a Git directory, holding what `make(dir)` puts there. */
  const dirWith = (make) => { const dir = join(base, `d${n++}`); mkdirSync(dir); make(dir); return dir; };
  const DIRECTORIES = ["rebase-apply", "rebase-merge"];
  const put = (dir, entry) => {
    if (DIRECTORIES.includes(entry) || entry === "sequencer") return mkdirSync(join(dir, entry));
    if (entry.includes("/")) mkdirSync(join(dir, entry.split("/")[0]), { recursive: true });
    writeFileSync(join(dir, entry), "x\n");
  };

  assert.equal(gitOperationInProgress(dirWith(() => {})), false, "an empty Git directory");
  assert.equal(gitOperationInProgress(join(base, "absent")), false, "a Git directory that is not there");
  for (const entry of GIT_OPERATION_ENTRIES) assert.equal(gitOperationInProgress(dirWith((dir) => put(dir, entry))), true, `${entry} alone`);
  const others = RECOVERABLE_GIT_ADMIN.filter((name) => !GIT_OPERATION_ENTRIES.includes(name));
  assert.deepEqual(others, ["MERGE_MSG", "AUTO_MERGE", "REBASE_HEAD", "BISECT_START", "BISECT_NAMES", "sequencer"], "what a copy takes and no operation is read from");
  for (const name of others) assert.equal(gitOperationInProgress(dirWith((dir) => put(dir, name))), false, `${name} alone`);
  assert.equal(gitOperationInProgress(dirWith((dir) => { for (const name of others) put(dir, name); writeFileSync(join(dir, "sequencer", "head"), "x\n"); writeFileSync(join(dir, "MERGE_MODE"), ""); })), false, "all of them at once, and a sequencer that holds no todo");

  // An entry is there as whatever it is, and a link is not followed.
  assert.equal(gitOperationInProgress(dirWith((dir) => writeFileSync(join(dir, "rebase-merge"), "a file\n"))), true, "rebase-merge as a file");
  assert.equal(gitOperationInProgress(dirWith((dir) => mkdirSync(join(dir, "MERGE_HEAD")))), true, "MERGE_HEAD as a directory");
  assert.equal(gitOperationInProgress(dirWith((dir) => symlinkSync("nowhere", join(dir, "BISECT_LOG")))), true, "a dangling link at BISECT_LOG");
  assert.equal(gitOperationInProgress(dirWith((dir) => { mkdirSync(join(dir, "sequencer")); symlinkSync("nowhere", join(dir, "sequencer", "todo")); })), true, "a dangling link at sequencer/todo");
  // Absent, in both of the system's spellings.
  assert.equal(gitOperationInProgress(dirWith((dir) => writeFileSync(join(dir, "sequencer"), "a file\n"))), false, "a sequencer that is a file has no todo (ENOTDIR)");
  // An entry that cannot be looked at is an operation.
  assert.equal(gitOperationInProgress(dirWith((dir) => symlinkSync("sequencer", join(dir, "sequencer")))), true, "a sequencer that links to itself (ELOOP)");
  if (process.getuid?.() !== 0) {
    const closed = dirWith((dir) => mkdirSync(join(dir, "sequencer"))), shut = dirWith(() => {});
    try {
      chmodSync(join(closed, "sequencer"), 0o000);
      assert.equal(gitOperationInProgress(closed), true, "a sequencer that cannot be searched (EACCES)");
      chmodSync(shut, 0o000);
      assert.equal(gitOperationInProgress(shut), true, "a Git directory that cannot be searched (EACCES)");
    } finally { chmodSync(join(closed, "sequencer"), 0o700); chmodSync(shut, 0o700); }
  }
});

/** A `git` alone on PATH that records that it ran and answers as the file `answer` beside it says.
 *  It uses the shell's own words only: nothing else is on that PATH. */
function fakeGit(dir) {
  mkdirSync(dir);
  writeFileSync(join(dir, "git"), `#!/bin/sh
here=\${0%/*}
echo "$*" >> "$here/ran"
read -r answer < "$here/answer"
case "$answer" in
  there) echo 1111111111111111111111111111111111111111; exit 0 ;;
  absent) exit 1 ;;
  said) echo "something on standard output"; exit 1 ;;
  complained) echo "fatal: something" >&2; exit 1 ;;
  failed) exit 128 ;;
  killed) kill -9 $$ ;;
esac
`, { mode: 0o755 });
  return { answer: (word) => { writeFileSync(join(dir, "answer"), `${word}\n`); rmSync(join(dir, "ran"), { force: true }); }, ran: () => (existsSync(join(dir, "ran")) ? readFileSync(join(dir, "ran"), "utf8").trim().split("\n") : []) };
}

test("the two refs are asked of Git where the refs may be in the reftable format, and nowhere else; whatever is not Git's plain `not there` is an operation", (t) => {
  const base = fixtureBase("oats-gitop-");
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const git = fakeGit(join(base, "bin"));
  const hostPath = process.env.PATH; process.env.PATH = join(base, "bin"); t.after(() => { process.env.PATH = hostPath; });
  const tree = join(base, "tree"); mkdirSync(tree);
  let n = 0;
  const dirWith = (make) => { const dir = join(base, `d${n++}`); mkdirSync(dir); make(dir); return dir; };
  const asked = () => git.ran().map((line) => line.split(" ").slice(-4).join(" "));
  const BOTH = ["rev-parse -q --verify CHERRY_PICK_HEAD", "rev-parse -q --verify REVERT_HEAD"];

  // The files format: no Git command, whatever Git would say.
  const files = dirWith(() => {});
  git.answer("there");
  assert.equal(gitOperationInProgress(files, tree), false, "no entry and no reftable: no operation");
  assert.deepEqual(git.ran(), [], "no Git command ran");
  const linkedFiles = dirWith((dir) => { mkdirSync(join(dir, "common")); writeFileSync(join(dir, "commondir"), "common\n"); });
  assert.equal(gitOperationInProgress(linkedFiles, tree), false, "a linked worktree of a repository in the files format");
  assert.deepEqual(git.ran(), [], "no Git command ran for it either");

  // The reftable format, by the worktree's own Git directory or by the common one.
  const own = dirWith((dir) => mkdirSync(join(dir, "reftable")));
  const common = dirWith((dir) => { mkdirSync(join(dir, "elsewhere", "reftable"), { recursive: true }); writeFileSync(join(dir, "commondir"), "elsewhere\n"); });
  const absolute = dirWith((dir) => writeFileSync(join(dir, "commondir"), `${own}\n`));
  for (const [dir, where] of [[own, "its own Git directory"], [common, "the common directory, named relative to it"], [absolute, "the common directory, named by its path"]]) {
    git.answer("absent");
    assert.equal(gitOperationInProgress(dir, tree), false, `a reftable entry in ${where}: Git says neither ref is there`);
    assert.deepEqual(asked(), BOTH, `both refs were asked of Git, in the tree (${where})`);
    assert.ok(git.ran().every((line) => line.startsWith(`-C ${tree} `)), `in the tree: ${git.ran()[0]}`);
    git.answer("there");
    assert.equal(gitOperationInProgress(dir, tree), true, `a reftable entry in ${where}: Git resolves the ref`);
    assert.deepEqual(asked(), BOTH.slice(0, 1), "the first ref that is there answers");
  }
  // An entry that is a file answers before Git is asked.
  git.answer("absent");
  assert.equal(gitOperationInProgress(dirWith((dir) => { mkdirSync(join(dir, "reftable")); mkdirSync(join(dir, "rebase-merge")); }), tree), true);
  assert.deepEqual(git.ran(), [], "a file entry needs no Git command");

  // Whatever is not the plain "not there" keeps the tree.
  for (const [word, what] of [["said", "status 1 with something printed"], ["complained", "status 1 with an error printed"], ["failed", "another status"], ["killed", "ended by a signal"]]) {
    git.answer(word);
    assert.equal(gitOperationInProgress(own, tree), true, `Git's answer is ${what}`);
  }
  // The same from the probe's result alone, for what no quick process can stage: a Git ended at the
  // timeout that handles the signal exits 1 and prints nothing, and is not "not there".
  const result = (over) => ({ status: 1, signal: null, error: undefined, stdout: "", stderr: "", ...over });
  const timedOut = Object.assign(new Error("spawnSync git ETIMEDOUT"), { code: "ETIMEDOUT" });
  assert.equal(gitRefPresenceOf(result()), "absent", "status 1, nothing printed, no error");
  assert.equal(gitRefPresenceOf(result({ status: 0, stdout: "1111111111111111111111111111111111111111\n" })), "there");
  assert.equal(gitRefPresenceOf(result({ error: timedOut })), "unknown", "timed out, and the child exited 1 with nothing printed");
  assert.equal(gitRefPresenceOf(result({ error: timedOut, status: null, signal: "SIGTERM" })), "unknown", "timed out, and the child was ended by the signal");
  assert.equal(gitRefPresenceOf(result({ status: null, signal: "SIGKILL" })), "unknown", "ended by a signal");
  assert.equal(gitRefPresenceOf(result({ status: null, error: Object.assign(new Error("spawnSync git ENOENT"), { code: "ENOENT" }) })), "unknown", "no Git");
  assert.equal(gitRefPresenceOf(result({ stdout: "x\n" })), "unknown", "status 1 with something printed");
  assert.equal(gitRefPresenceOf(result({ stderr: "fatal: x\n" })), "unknown", "status 1 with an error printed");
  assert.equal(gitRefPresenceOf(result({ status: 128 })), "unknown", "another status");
  git.answer("absent");
  assert.equal(gitOperationInProgress(own), true, "no tree to ask in");
  assert.equal(gitOperationInProgress(own, ""), true, "an empty tree path");
  assert.deepEqual(git.ran(), [], "and Git was not run with no tree");
  process.env.PATH = join(base, "no-git-here");
  assert.equal(gitOperationInProgress(own, tree), true, "no Git on PATH");
  process.env.PATH = join(base, "bin");
  // A commondir that cannot be read is not "the files format".
  assert.equal(gitOperationInProgress(dirWith((dir) => mkdirSync(join(dir, "commondir"))), tree), false, "premise: Git answers `absent` for a commondir that is a directory, and it was asked");
  assert.deepEqual(asked(), BOTH, "a commondir that cannot be read as a file: Git is asked");
  if (process.getuid?.() !== 0) {
    const shut = dirWith((dir) => { mkdirSync(join(dir, "closed")); writeFileSync(join(dir, "commondir"), "closed\n"); });
    git.answer("absent");
    try {
      chmodSync(join(shut, "closed"), 0o000);
      assert.equal(gitOperationInProgress(shut, tree), false, "premise: Git answers `absent` for a common directory that cannot be searched, and it was asked");
      assert.deepEqual(asked(), BOTH, "a common directory that cannot be searched: Git is asked");
    } finally { chmodSync(join(shut, "closed"), 0o700); }
  }
  git.answer("there");
  assert.equal(gitOperationInProgress(dirWith((dir) => symlinkSync("reftable", join(dir, "reftable"))), tree), true, "a reftable entry that is a link to itself is a reftable entry");
});

for (const format of FORMATS) {
  test(`[${format}] a retire's extra trees: an operation keeps a tree, with today's sentence; what an ended operation left does not, and the tree is removed`, skipFor(format), async (t) => {
    const { fx, g } = deployment(t, format, { souls: { dev: { soul: { work: "worktree" } } } });
    const hostPath = process.env.PATH; process.env.PATH = fx.env.PATH; t.after(() => { process.env.PATH = hostPath; });
    const { home } = await fx.spawn("dev", { instance: "dev-trees", work: "worktree" });
    const held = new Map();
    for (const state of STATES) {
      // An extra tree made the way the briefing says: detached, fetched inside it, switched to its branch.
      const tree = join(home, `.work-${state.key}`);
      g(fx.member, "worktree", "add", "-q", "--detach", tree);
      g(tree, "fetch", "-q", "--refmap=", "origin", "main");
      g(tree, "switch", "-q", "-c", `agents/1008-${state.key}`, "FETCH_HEAD");
      held.set(state.key, left(staged(state, g, tree, fx.base, format)));
    }
    const reasonOf = (state) => (!state.operation ? null : state.conflict ? `${UNCOMMITTED}; ${IN_PROGRESS}` : IN_PROGRESS);
    const about = (state) => `${state.key} (${state.what}; its Git directory held ${held.get(state.key)})`;

    const planned = fx.cli(["retire", "dev-trees", "--plan", "--json"]);
    assert.equal(planned.status, 0, planned.stderr + planned.stdout);
    const plan = new Map(planned.json().result.facts.extraWorktrees.map((row) => [row.path, row]));
    for (const state of STATES) {
      const row = plan.get(join(home, `.work-${state.key}`));
      assert.equal(row.disposition, state.operation ? "retain" : "remove", `the plan: ${about(state)}`);
      assert.equal(row.reason, reasonOf(state), `the plan's reason: ${about(state)}`);
    }

    const r = await fx.inEnv(() => retireInstance(fx.root, "dev-trees", { tmuxSession: "oats-test-nosuch" }));
    const rows = new Map(r.extraWorktrees.map((row) => [row.path, row]));
    for (const state of STATES) {
      const tree = join(home, `.work-${state.key}`), row = rows.get(tree);
      assert.equal(row.outcome, state.operation ? "retained" : "removed", `the retire: ${about(state)}`);
      assert.equal(row.reason, reasonOf(state), `the retire's reason: ${about(state)}`);
      assert.equal(existsSync(tree), false, `${state.key}: the tree left the home`);
      if (state.operation) {
        // The operation moved with the tree: nothing of it was lost.
        const moved = gitDirOf(g, row.movedTo);
        assert.equal(gitOperationInProgress(moved, row.movedTo), true, `${state.key}: the operation moved with the tree (its Git directory holds ${left(moved)})`);
      } else {
        assert.equal(row.movedTo, null, `${state.key}: nothing was re-homed`);
        assert.ok(g(fx.member, "rev-parse", "--verify", `refs/heads/agents/1008-${state.key}`), `${state.key}: its branch stays in the clone`);
      }
    }
    assert.equal(existsSync(home), false, "the home is removed");

    // The listing of what the retire retained says the same of the same trees.
    const doctor = fx.cli(["doctor", "--json"]);
    assert.equal(doctor.status, 0, doctor.stderr);
    const lines = JSON.parse(doctor.stdout).information.filter((line) => line.startsWith("retained-worktree: /"));
    for (const state of STATES.filter((s) => s.operation)) {
      const line = lines.find((l) => l.startsWith(`retained-worktree: ${rows.get(join(home, `.work-${state.key}`)).movedTo}: `));
      assert.match(line ?? "", state.conflict ? /; not clean; uncommitted: [^;]*conflicts[^;]*, an operation in progress; / : /; not clean; uncommitted: an operation in progress; /, `doctor's line for ${about(state)}`);
    }
  });

  test(`[${format}] the listing of what retires retained: a tree that holds only what an ended operation left is clean; an operation is \`an operation in progress\``, skipFor(format), (t) => {
    const { fx, g } = deployment(t, format);
    const retained = join(fx.dep, ".agents", "worktrees", "ws");
    mkdirSync(retained, { recursive: true });
    const held = new Map();
    for (const state of STATES) {
      const tree = join(retained, `agents-${state.key}`);
      g(fx.member, "worktree", "add", "-q", "-b", `agents/${state.key}`, tree);
      held.set(state.key, left(staged(state, g, tree, fx.base, format)));
    }
    const doctor = fx.cli(["doctor", "--json"]);
    assert.equal(doctor.status, 0, doctor.stderr);
    const lines = JSON.parse(doctor.stdout).information.filter((line) => line.startsWith("retained-worktree: /"));
    assert.equal(lines.length, STATES.length);
    for (const state of STATES) {
      const line = lines.find((l) => l.startsWith(`retained-worktree: ${join(retained, `agents-${state.key}`)}: `));
      const expected = !state.operation ? /; clean; commits: / : state.conflict ? /; not clean; uncommitted: [^;]*conflicts[^;]*, an operation in progress; commits: / : /; not clean; uncommitted: an operation in progress; commits: /;
      assert.match(line ?? "", expected, `${state.key} (${state.what}; its Git directory holds ${held.get(state.key)})`);
    }
  });

  test(`[${format}] the instance's own tree: with only the home changed, an operation keeps the full recovery of the tree, and what an ended operation left gets the home-only one`, skipFor(format), async (t) => {
    const { fx, g } = deployment(t, format, { souls: { dev: { soul: { work: "worktree" } } } });
    const hostPath = process.env.PATH; process.env.PATH = fx.env.PATH; t.after(() => { process.env.PATH = hostPath; });
    // A conflict changes the tree itself, which is a recovery of the tree for that reason alone.
    for (const state of STATES.filter((s) => !s.conflict)) {
      const name = `dev-${state.key}`;
      const { home } = await fx.spawn("dev", { instance: name, work: "worktree" });
      const dir = staged(state, g, join(home, "work"), fx.base, format);
      const about = `${state.key} (${state.what}; its Git directory held ${left(dir)})`;
      writeFileSync(join(home, "notes.md"), "a note of the home\n");
      const r = await fx.inEnv(() => retireInstance(fx.root, name, { tmuxSession: "oats-test-nosuch" }));
      assert.ok(r.workRecovery, `a recovery was made: ${about}`);
      assert.deepEqual(r.workRecovery.classes, ["changed instance-home bytes"], `premise: only the home changed: ${about}`);
      const repo = join(r.workRecovery.path, "repo");
      if (state.operation) {
        assert.notEqual(r.workRecovery.repoCopy?.copied, false, `the recovery holds the tree: ${about}`);
        // The copy takes a link as a link, and writes a ref of the reftable format through Git (#1038).
        assert.equal(gitOperationInProgress(join(repo, ".git"), repo), true, `the copy carries the operation (its Git directory holds ${existsSync(join(repo, ".git")) ? left(join(repo, ".git")) : "nothing: no copy"}): ${about}`);
      } else {
        assert.equal(r.workRecovery.repoCopy?.copied, false, `the recovery holds the home only: ${about}`);
        assert.equal(existsSync(repo), false, `no copy of the tree: ${about}`);
      }
    }
  });
}

test("what a recovery copies did not change: a tree with a change still takes REBASE_HEAD, AUTO_MERGE, MERGE_MSG, BISECT_START, BISECT_NAMES and the whole sequencer directory", async (t) => {
  const { fx, g } = deployment(t, "files", { souls: { dev: { soul: { work: "worktree" } } } });
  const hostPath = process.env.PATH; process.env.PATH = fx.env.PATH; t.after(() => { process.env.PATH = hostPath; });
  const { home } = await fx.spawn("dev", { instance: "dev-copy", work: "worktree" });
  const work = join(home, "work");
  const dir = staged(STATES.find((s) => s.key === "leftovers"), g, work, fx.base, "files");
  writeFileSync(join(dir, "sequencer", "head"), "kept\n");
  writeFileSync(join(work, "wip-1008.txt"), "uncommitted\n");
  const r = await fx.inEnv(() => retireInstance(fx.root, "dev-copy", { tmuxSession: "oats-test-nosuch" }));
  const copy = join(r.workRecovery.path, "repo", ".git");
  for (const name of ["REBASE_HEAD", "AUTO_MERGE", "MERGE_MSG", "BISECT_START", "BISECT_NAMES", join("sequencer", "head")]) assert.ok(existsSync(join(copy, name)), `${name} is in the copy, which holds ${left(copy)}`);
});
