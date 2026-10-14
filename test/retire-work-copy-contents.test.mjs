// What the recovery copy holds: every object its Git metadata names, the repository's own state, names and
// links as bytes, a copy that mirrors the tree, and the home's comparison. One part of what was
// retire-work-safety.test.mjs (awebai/oats#1061); the fixtures it shares with the other parts are in
// helpers/retire-work-safety-fixture.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fingerprintTree } from "../lib/core.mjs";
import {
  SCRATCH_BYTES, STATUS_WITH_SCRATCH, WRITES_SCRATCH, assertBothCopiedAgain, baselineOf, cli, commonDirOf,
  entryIsThere, excludeRulesOf, fixture, fixtureGit, gitDirOf, gitTextIn, hasObject, headOf, hookCapability,
  namesStartingWith, nestedRepository, nestedUnder, porcelain, quietHook, readJson, retireAfterQuietHook,
  spawn, stashEntries, stashListOf, statusRowsIn, storedBytes, tagNamesOf, temporaryDirectories, under,
  withByte, write,
} from "./helpers/retire-work-safety-fixture.mjs";

// ---- Every object the copied Git metadata names is in the copy (#654, #655, #657) ----

/** The commits a reflog file names: the new object id of each entry, the zero id left out. */
const reflogNames = (file) => readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => line.split(" ")[1]).filter((oid) => !/^0+$/.test(oid));
/** Put `file` in conflict with three sides no commit has, then resolve it with `resolved`: the index keeps
 *  resolve-undo records naming the three blobs. → the three blobs. */
function resolvedConflict(repo, file, resolved) {
  const git = gitTextIn(repo);
  const blobOf = (text) => execFileSync("git", ["-C", repo, "hash-object", "-w", "--stdin"], { input: text, encoding: "utf8" }).trim();
  const sides = ["base side\n", "our side\n", "their side\n"].map(blobOf);
  const rows = [`0 ${"0".repeat(sides[0].length)}\t${file}`, ...sides.map((oid, i) => `100644 ${oid} ${i + 1}\t${file}`)];
  execFileSync("git", ["-C", repo, "update-index", "--index-info"], { input: rows.join("\n") + "\n" });
  write(join(repo, file), resolved);
  git("add", file);
  assert.deepEqual(git("ls-files", "--resolve-undo", "-z").split("\0").filter(Boolean).map((row) => row.split(" ")[1]), sides, "fixture premise: the index has resolve-undo records for the three sides");
  return sides;
}

test("#654 a worktree's recovery holds every stash entry the copied stash log names, not just the latest: three entries, and one dropped from between them that the log no longer names", () => {
  const f = fixture();
  const spawned = spawn(f, "stashes");
  const work = join(spawned.home, "work");
  const all = stashEntries(work, "tracked.txt", 4);
  gitTextIn(work)("stash", "drop", "--quiet", "stash@{1}");
  const named = gitTextIn(work)("log", "-g", "--format=%H", "refs/stash").split("\n").filter(Boolean);
  assert.deepEqual(named, [all[0], all[2], all[3]], "fixture premise: the stash log names three entries, the dropped one not");
  write(join(work, "untracked.txt"), "a work copy is needed\n");

  const retired = cli(f, ["retire", "dev-stashes", "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const copy = join(JSON.parse(retired.stdout).workRecovery.path, "repo");
  for (const oid of named) assert.equal(hasObject(copy, oid), true, `the copy has the stash entry ${oid}`);
  const copiedLog = reflogNames(join(copy, ".git", "logs", "refs", "stash"));
  assert.deepEqual(copiedLog.slice().reverse(), named, "the copied stash log names the three entries");
  assert.deepEqual(copiedLog.filter((oid) => !hasObject(copy, oid)), [], "the copied stash log names nothing the copy lacks");
  assert.match(gitTextIn(copy)("stash", "show", "-p", "stash@{2}"), /^\+stash entry 1$/m, "the oldest entry opens in the copy");
});

test("#655 a worktree's recovery holds the blobs that a resolved conflict's resolve-undo records name, though no commit has them: `git checkout -m` recreates the conflict in the copy", () => {
  const f = fixture();
  const spawned = spawn(f, "resolve-undo-blobs");
  const work = join(spawned.home, "work");
  const sides = resolvedConflict(work, "tracked.txt", "resolved\n");
  for (const oid of sides) assert.equal(hasObject(f.repo, oid), true, "fixture premise: the source has each side");

  const retired = cli(f, ["retire", "dev-resolve-undo-blobs", "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const copy = join(JSON.parse(retired.stdout).workRecovery.path, "repo");
  for (const oid of sides) assert.equal(hasObject(copy, oid), true, `the copy has the conflict side ${oid}`);
  gitTextIn(copy)("checkout", "-m", "tracked.txt");
  const recreated = readFileSync(join(copy, "tracked.txt"), "utf8");
  assert.match(recreated, /^<<<<<<< /m, "the conflict is back");
  assert.match(recreated, /^our side$/m);
  assert.match(recreated, /^their side$/m);
});

test("#657 a nested repository's copy is on its source's branch, has every local branch at its commit, the reflogs of HEAD and of each branch with every commit they name, every stash entry and its resolve-undo blobs, and none of its local configuration but the status settings; a submodule gitlink names no object the copy must hold", () => {
  const f = fixture();
  const spawned = spawn(f, "nested-refs");
  const work = join(spawned.home, "work");
  const nested = nestedRepository(work);
  const git = gitTextIn(nested);
  const base = git("symbolic-ref", "--short", "HEAD").trim();
  git("switch", "--quiet", "-c", "other");
  write(join(nested, "other.txt"), "only the branch other has this\n");
  git("add", "other.txt");
  git("commit", "--quiet", "-m", "on other");
  git("switch", "--quiet", "-c", "feature", base);
  // A commit only the reflogs reach: made, then left by a reset.
  write(join(nested, "lost.txt"), "only a reflog reaches this\n");
  git("add", "lost.txt");
  git("commit", "--quiet", "-m", "lost");
  const lost = headOf(nested);
  git("reset", "--quiet", "--hard", "HEAD~1");
  // A gitlink to a commit of another repository, which the nested repository does not have.
  const gitlink = headOf(f.repo);
  mkdirSync(join(nested, "sub"));
  git("update-index", "--add", "--cacheinfo", `160000,${gitlink},sub`);
  git("commit", "--quiet", "-m", "gitlink");
  assert.equal(hasObject(nested, gitlink), false, "fixture premise: the gitlink names a commit the nested repository does not have");
  const stashes = stashEntries(nested, "nested.txt", 3);
  const sides = resolvedConflict(nested, "nested.txt", "resolved in the nested repository\n");
  git("config", "remote.upstream.url", "https://example.invalid/nested.git");
  const branches = git("for-each-ref", "--format=%(objectname) %(refname)", "refs/heads");
  assert.equal(branches.split("\n").filter(Boolean).length, 3, "fixture premise: three local branches");
  const reflogs = Object.fromEntries(["HEAD", "refs/heads/feature", "refs/heads/other", `refs/heads/${base}`].map((ref) => [ref, git("reflog", "show", "--format=%H", ref)]));
  assert.match(reflogs.HEAD, new RegExp(`^${lost}$`, "m"), "fixture premise: HEAD's reflog names the lost commit");
  const head = headOf(nested);

  const retired = cli(f, ["retire", "dev-nested-refs", "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const copy = nestedUnder(join(JSON.parse(retired.stdout).workRecovery.path, "repo"));
  const inCopy = gitTextIn(copy);
  assert.equal(inCopy("symbolic-ref", "HEAD").trim(), "refs/heads/feature", "HEAD is on the source's branch");
  assert.equal(headOf(copy), head);
  assert.equal(inCopy("for-each-ref", "--format=%(objectname) %(refname)", "refs/heads"), branches, "every local branch, under its name, at its commit");
  assert.equal(hasObject(copy, lost), true, "the commit only a reflog reaches is in the copy");
  for (const [ref, log] of Object.entries(reflogs)) assert.equal(inCopy("reflog", "show", "--format=%H", ref), log, `the reflog of ${ref} is the source's`);
  for (const log of ["HEAD", join("refs", "heads", "feature"), join("refs", "heads", "other"), join("refs", "heads", base), join("refs", "stash")]) {
    assert.deepEqual(reflogNames(join(copy, ".git", "logs", log)).filter((oid) => !hasObject(copy, oid)), [], `the copied log ${log} names nothing the copy lacks`);
  }
  for (const oid of stashes) assert.equal(hasObject(copy, oid), true, `the copy has the stash entry ${oid}`);
  assert.equal(stashListOf(copy).split("\n").filter(Boolean).length, 3);
  for (const oid of sides) assert.equal(hasObject(copy, oid), true, `the copy has the conflict side ${oid}`);
  assert.equal(hasObject(copy, gitlink), false, "the gitlink's commit is its own repository's to hold");
  assert.equal(inCopy("remote"), "", "no remote");
  assert.equal(spawnSync("git", ["-C", copy, "config", "--local", "--get", "user.email"]).status, 1, "the source's local configuration is not carried");
  inCopy("checkout", "-m", "nested.txt");
  assert.match(readFileSync(join(copy, "nested.txt"), "utf8"), /^<<<<<<< /m, "the resolved conflict can be recreated");
});

test("#657 a nested repository's branch that its configuration hides from a clone (uploadpack.hideRefs), on a commit nothing else reaches, is in the copy under its name, with its reflog", () => {
  const f = fixture();
  const spawned = spawn(f, "nested-hidden");
  const work = join(spawned.home, "work");
  const nested = nestedRepository(work);
  const git = gitTextIn(nested);
  const hidden = git("commit-tree", "-p", "HEAD", "-m", "only the hidden branch reaches this", `${headOf(nested)}^{tree}`).trim();
  git("update-ref", "--create-reflog", "refs/heads/hidden", hidden);
  git("config", "uploadpack.hideRefs", "refs/heads/hidden");
  assert.doesNotMatch(git("reflog", "show", "--format=%H", "HEAD"), new RegExp(hidden), "fixture premise: HEAD's reflog does not name the hidden tip");
  const branches = git("for-each-ref", "--format=%(objectname) %(refname)", "refs/heads");
  const hiddenLog = git("reflog", "show", "--format=%H", "refs/heads/hidden");

  const retired = cli(f, ["retire", "dev-nested-hidden", "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const copy = nestedUnder(join(JSON.parse(retired.stdout).workRecovery.path, "repo"));
  assert.equal(hasObject(copy, hidden), true, "the hidden branch's commit is in the copy");
  assert.equal(gitTextIn(copy)("for-each-ref", "--format=%(objectname) %(refname)", "refs/heads"), branches, "every local branch, the hidden one included");
  assert.equal(gitTextIn(copy)("reflog", "show", "--format=%H", "refs/heads/hidden"), hiddenLog, "with its reflog");
});

test("#657 a detached nested repository's copy is detached at the source's commit, which no branch reaches, with the source's other branches", () => {
  const f = fixture();
  const spawned = spawn(f, "nested-detached");
  const work = join(spawned.home, "work");
  const nested = nestedRepository(work);
  const git = gitTextIn(nested);
  git("branch", "kept");
  git("switch", "--quiet", "--detach");
  write(join(nested, "detached.txt"), "only HEAD reaches this\n");
  git("add", "detached.txt");
  git("commit", "--quiet", "-m", "detached");
  const branches = git("for-each-ref", "--format=%(objectname) %(refname)", "refs/heads");
  assert.equal(git("for-each-ref", "--contains", "HEAD", "refs/heads"), "", "fixture premise: no branch reaches HEAD");
  const head = headOf(nested);

  const retired = cli(f, ["retire", "dev-nested-detached", "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const copy = nestedUnder(join(JSON.parse(retired.stdout).workRecovery.path, "repo"));
  assert.equal(spawnSync("git", ["-C", copy, "symbolic-ref", "--quiet", "HEAD"]).status, 1, "HEAD is detached");
  assert.equal(headOf(copy), head);
  assert.equal(gitTextIn(copy)("for-each-ref", "--format=%(objectname) %(refname)", "refs/heads"), branches);
});

test("#654 a stash entry whose commit the nested repository itself lacks refuses the copy with E_WORK_PRESERVATION_FAILED naming the commit, and the home is kept", () => {
  const f = fixture();
  const spawned = spawn(f, "nested-stash-missing");
  const work = join(spawned.home, "work");
  const nested = nestedRepository(work);
  const stashes = stashEntries(nested, "nested.txt", 3);
  const gone = stashes[1];
  rmSync(join(nested, ".git", "objects", gone.slice(0, 2), gone.slice(2)));
  assert.equal(hasObject(nested, gone), false, "fixture premise: the stash log names a commit the repository lacks");

  const retired = cli(f, ["retire", "dev-nested-stash-missing", "--json"]);
  assert.notEqual(retired.status, 0, retired.stdout);
  const { error } = JSON.parse(retired.stdout);
  assert.equal(error.code, "E_WORK_PRESERVATION_FAILED", retired.stdout);
  assert.ok(error.message.includes(gone), error.message);
  assert.equal(existsSync(join(spawned.home, "instance.json")), true, "the home is kept");
  assert.equal(existsSync(join(nested, "nested.txt")), true, "and the nested repository");
});

for (const [shape, gitfile, refused] of [
  ["`gitdir:` with no space after it", (admin) => `gitdir:${admin}\n`, true],
  ["a path with a trailing space, where only the path without it exists", (admin) => `gitdir: ${admin} \n`, true],
  ["a path ending in a carriage return and a line feed", (admin) => `gitdir: ${admin}\r\n`, false],
]) {
  test(`#647 a worktree's .git file is read as Git reads it (setup.c read_gitfile_gently): ${shape} ${refused ? "names no admin entry, so the retire keeps the directory and the home and does not complete" : "is read, and the retire goes on"}`, () => {
    const f = fixture();
    const spawned = spawn(f, "gitfile");
    const work = join(spawned.home, "work");
    writeFileSync(join(work, ".git"), gitfile(gitDirOf(work)));
    const retired = cli(f, ["retire", "dev-gitfile", "--json"]);
    if (!refused) {
      assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
      assert.equal(existsSync(spawned.home), false);
      return;
    }
    assert.notEqual(retired.status, 0, retired.stdout);
    const result = JSON.parse(retired.stdout);
    assert.deepEqual(result.rollbackIncomplete, [`git worktree ${work}: its admin entry is missing; the directory is kept — move it out or delete it by hand, then retire again`], retired.stdout);
    assert.equal(result.worktreeRemoved, false);
    assert.equal(existsSync(join(spawned.home, "instance.json")), true, "the home is kept");
    assert.equal(existsSync(join(work, "tracked.txt")), true, "and the work");
  });
}

// What a work copy holds of the worktree's own repository is state as well: the exclude rules and status
// settings the copy is given, the stash and the tags. They are kept by the repository the worktree belongs
// to, so a hook can change them without touching a file or a status row of the worktree.

test("a retire hook that adds an exclude rule to the repository the worktree belongs to, with no status row changing: the work copied under after-hooks/repo/ carries the rule", () => {
  const retire = quietHook(`import { mkdirSync } from 'node:fs';
const common = git('rev-parse', '--path-format=absolute', '--git-common-dir').trim();
mkdirSync(join(common, 'info'), { recursive: true });
writeFileSync(join(common, 'info', 'exclude'), '.by-hook/\\n');`);
  const f = fixture({ capabilities: hookCapability(retire) });
  const spawned = spawn(f, "hook-worktree-exclude");
  const work = join(spawned.home, "work");
  write(join(work, "tracked.txt"), "changed before the retire\n");
  const statusBefore = porcelain(work);
  assert.deepEqual(statusRowsIn(statusBefore), [" M tracked.txt"], "fixture premise: one modified tracked file before the retire");

  const { recovery, afterRepo } = retireAfterQuietHook(f, spawned, statusBefore);
  assert.equal(readFileSync(join(commonDirOf(f.repo), "info", "exclude"), "utf8"), ".by-hook/\n", "fixture premise: the hook wrote the rule; it matches nothing, so no status row moved");
  assert.equal(existsSync(join(recovery.path, "repo", ".git")), true);
  assert.equal(excludeRulesOf(join(recovery.path, "repo")).includes(".by-hook/"), false, "the pre-hook snapshot does not have the rule");
  assert.equal(existsSync(join(afterRepo, ".git")), true, "the work is copied again under after-hooks/repo/: its exclude rules moved");
  assert.match(excludeRulesOf(afterRepo), /^\.by-hook\/$/m);
  assert.equal(readFileSync(join(afterRepo, "tracked.txt"), "utf8"), "changed before the retire\n", "its files are the same in both copies");
  assertBothCopiedAgain(recovery);
});

test("a retire hook that tags the instance's commit, with no status row changing: the work copied under after-hooks/repo/ carries the tag", () => {
  const retire = quietHook(`git('tag', 'by-the-retire-hook');
seen.tags = git('tag', '--list');`);
  const f = fixture({ capabilities: hookCapability(retire) });
  const spawned = spawn(f, "hook-worktree-tag");
  const work = join(spawned.home, "work");
  write(join(work, "tracked.txt"), "changed before the retire\n");
  const statusBefore = porcelain(work);
  assert.deepEqual(statusRowsIn(statusBefore), [" M tracked.txt"], "fixture premise: one modified tracked file before the retire");

  const { recovery, seen, afterRepo } = retireAfterQuietHook(f, spawned, statusBefore);
  assert.equal(seen.tags.split("\n").includes("by-the-retire-hook"), true, "fixture premise: the hook made a tag");
  assert.equal(existsSync(join(recovery.path, "repo", ".git")), true);
  assert.equal(tagNamesOf(join(recovery.path, "repo")).includes("by-the-retire-hook"), false, "the pre-hook snapshot does not have the tag");
  assert.equal(existsSync(join(afterRepo, ".git")), true, "the work is copied again under after-hooks/repo/: a work copy carries the tags, and they moved");
  assert.equal(tagNamesOf(afterRepo).includes("by-the-retire-hook"), true);
  assertBothCopiedAgain(recovery);
});

/** Detach the worktree's HEAD and make one commit there that a second local branch, `keep`, reaches: no
 *  other ref does, the instance's branch included. → that commit. */
function commitOnlyKeepReaches(work) {
  execFileSync("git", ["-C", work, "checkout", "--quiet", "--detach"]);
  write(join(work, "committed.txt"), "committed on the detached HEAD\n");
  execFileSync("git", ["-C", work, "add", "committed.txt"]);
  execFileSync("git", ["-C", work, "commit", "-qm", "the instance's commit"]);
  execFileSync("git", ["-C", work, "branch", "keep"]);
  return headOf(work);
}

test("a snapshot that was home-only before the hooks gets a work copy when a retire hook deletes the one branch that reached the worktree's detached commit, in a worktree the retire removes", () => {
  const retire = quietHook(`git('branch', '--quiet', '-D', 'keep');
seen.head = git('rev-parse', 'HEAD').trim();
seen.branches = git('branch', '--list', 'keep');`);
  const f = fixture({ capabilities: hookCapability(retire) });
  const spawned = spawn(f, "hook-drops-branch");
  const work = join(spawned.home, "work");
  const commit = commitOnlyKeepReaches(work);
  write(join(spawned.home, "notes", "x.md"), "an authored note\n");
  const statusBefore = porcelain(work);
  assert.equal(statusBefore, "", "fixture premise: a clean worktree before the retire");

  const { recovery, seen, afterRepo } = retireAfterQuietHook(f, spawned, statusBefore);
  // The status, the commit and the bytes did not move. Only another ref did: the one that reached the commit.
  assert.equal(seen.head, commit, "fixture premise: the hook did not move HEAD");
  assert.equal(seen.branches, "", "fixture premise: the hook deleted the other branch");
  assert.equal(recovery.repoCopy?.copied, false, "fixture premise: the snapshot before the hooks is home-only, because a ref reached the commit then");
  assert.equal(existsSync(join(recovery.path, "repo")), false);
  assert.ok(recovery.classes.includes("worktree commits no ref reaches"), `the class appeared after the hooks: ${recovery.classes.join(", ")}`);
  assert.equal(execFileSync("git", ["-C", f.repo, "for-each-ref", "--contains", commit, "--format=%(refname)"], { encoding: "utf8" }).trim(), "", "no ref reaches the commit any more");
  assert.equal(existsSync(join(afterRepo, ".git")), true, "the work is copied under after-hooks/repo/: the recovery held no work copy, and no ref that outlives the worktree reaches its commit now");
  assert.equal(headOf(afterRepo), commit, "the commit is in the recovery");
  assert.equal(readFileSync(join(afterRepo, "committed.txt"), "utf8"), "committed on the detached HEAD\n");
  assertBothCopiedAgain(recovery);
});

test("a snapshot that was home-only before the hooks gets a work copy when the retire hook removes the instance's retirement baseline", () => {
  const retire = quietHook(`import { readdirSync, rmSync } from 'node:fs';
const baselines = join(dirname(home), '.oats-retirement', 'baselines');
for (const name of readdirSync(baselines)) rmSync(join(baselines, name));`);
  const f = fixture({ capabilities: hookCapability(retire) });
  const spawned = spawn(f, "hook-drops-baseline");
  const work = join(spawned.home, "work");
  write(join(spawned.home, "notes", "x.md"), "an authored note\n");
  assert.equal(existsSync(baselineOf(spawned.home)), true, "fixture premise: the baseline is where the hook will look");
  const statusBefore = porcelain(work);
  assert.equal(statusBefore, "", "fixture premise: a clean worktree before the retire");

  const { recovery, afterRepo } = retireAfterQuietHook(f, spawned, statusBefore);
  assert.equal(existsSync(baselineOf(spawned.home)), false, "fixture premise: the hook removed the baseline");
  assert.equal(recovery.repoCopy?.copied, false, "fixture premise: the snapshot before the hooks is home-only");
  assert.equal(existsSync(join(recovery.path, "repo")), false);
  assert.ok(recovery.classes.includes("unknown instance-home provenance"), `the class appeared after the hooks: ${recovery.classes.join(", ")}`);
  assert.equal(existsSync(join(afterRepo, ".git")), true, "without the baseline nothing says the work is disposable: it is copied under after-hooks/repo/");
  assert.equal(readFileSync(join(afterRepo, "tracked.txt"), "utf8"), "base\n");
  assertBothCopiedAgain(recovery);
});

test("an instance with nothing to preserve before the hooks gets its one recovery when a class appears after them, although nothing in its home or its files moved: a retire hook deletes the one branch that reached the worktree's detached commit, in a worktree the retire removes", () => {
  const retire = quietHook(`git('branch', '--quiet', '-D', 'keep');
seen.head = git('rev-parse', 'HEAD').trim();
seen.branches = git('branch', '--list', 'keep');`, { home: false });
  const f = fixture({ capabilities: hookCapability(retire) });
  const spawned = spawn(f, "late-class");
  const work = join(spawned.home, "work");
  const commit = commitOnlyKeepReaches(work);
  const statusBefore = porcelain(work);
  assert.equal(statusBefore, "", "fixture premise: a clean worktree before the retire");

  const { recovery, seen } = retireAfterQuietHook(f, spawned, statusBefore, { home: false });
  assert.equal(seen.head, commit, "fixture premise: the hook did not move HEAD");
  assert.equal(seen.branches, "", "fixture premise: the hook deleted the other branch");
  assert.deepEqual(recovery.classes, ["worktree commits no ref reaches"], "the one class, and it appeared after the hooks");
  assert.equal(execFileSync("git", ["-C", f.repo, "for-each-ref", "--contains", commit, "--format=%(refname)"], { encoding: "utf8" }).trim(), "", "no ref reaches the commit any more");
  // Written by the post-hook pass as the first and only recovery: the work is at its top level.
  assert.equal(existsSync(join(recovery.path, "repo", ".git")), true);
  assert.equal(headOf(join(recovery.path, "repo")), commit, "the commit is in the recovery");
  assert.equal(readFileSync(join(recovery.path, "repo", "committed.txt"), "utf8"), "committed on the detached HEAD\n");
  assert.equal(existsSync(join(recovery.path, "after-hooks")), false);
  assert.equal(recovery.afterHooks, undefined);
  assert.equal(readJson(join(recovery.path, "recovery.json")).phase, "complete");
});

// ---- Bytes, not text ----
// Git's output, the names in a worktree and the targets of its links are compared as their bytes. Read
// as text, a byte that is not valid UTF-8 becomes U+FFFD, and two different such bytes read alike.

/** The tag refs of a repository as Git prints them, as the hex of those bytes. */
const tagRefBytesOf = (repo) => execFileSync("git", ["-C", repo, "for-each-ref", "--format=%(refname)", "refs/tags"], { stdio: ["ignore", "pipe", "pipe"] }).toString("hex");
const tagRefWith = (byte) => Buffer.concat([Buffer.from("refs/tags/tag-"), Buffer.from([byte]), Buffer.from("\n")]).toString("hex");

test("a retire hook that changes one byte of a packed tag's name in a nested repository, from one byte that is not UTF-8 to another, with no status row, index entry, HEAD or stash changing: the work is copied again, and the nested repository under after-hooks/repo/ has the tag as the hook left it", () => {
  // The tag is in packed-refs, so no file has the byte in its name. Read as text, both names are
  // "tag-" and U+FFFD: only their bytes tell them apart.
  const STATUS = "'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching', '--ignore-submodules=none'";
  const retire = quietHook(`import { readFileSync } from 'node:fs';
const nested = join(work, 'human-ignored', 'nested');
const inNested = gitIn(nested);
const tagBytes = () => execFileSync('git', ['-C', nested, 'for-each-ref', '--format=%(refname)', 'refs/tags']).toString('hex');
const stateOf = () => ({ status: inNested(${STATUS}), head: inNested('rev-parse', 'HEAD'), branch: inNested('symbolic-ref', 'HEAD'), index: inNested('ls-files', '-s', '-v', '-z'), stash: inNested('for-each-ref', 'refs/stash') });
seen.before = stateOf();
seen.tagBefore = tagBytes();
const packed = join(nested, '.git', 'packed-refs');
const bytes = readFileSync(packed);
seen.at = bytes.indexOf(0x80);
bytes[seen.at] = 0x81;
writeFileSync(packed, bytes);
seen.after = stateOf();
seen.tagAfter = tagBytes();`);
  const f = fixture({ capabilities: hookCapability(retire) });
  const spawned = spawn(f, "hook-tag-byte");
  const work = join(spawned.home, "work");
  const nested = nestedRepository(work);
  const commit = headOf(nested);
  writeFileSync(join(nested, ".git", "packed-refs"), Buffer.concat([Buffer.from(`${commit} refs/tags/tag-`), Buffer.from([0x80]), Buffer.from("\n")]));
  assert.equal(tagRefBytesOf(nested), tagRefWith(0x80), "fixture premise: Git reads the packed tag and prints its name with the byte 0x80");
  const statusBefore = porcelain(work);
  assert.deepEqual(statusRowsIn(statusBefore), ["!! human-ignored/"], "fixture premise: the outer status has one row, the ignored directory that holds the nested repository");

  const { recovery, seen, afterRepo } = retireAfterQuietHook(f, spawned, statusBefore);
  assert.ok(seen.at >= 0, "fixture premise: the hook found the byte 0x80 in packed-refs");
  assert.equal(seen.tagBefore, tagRefWith(0x80), "fixture premise: the hook saw the tag with the byte 0x80");
  assert.equal(seen.tagAfter, tagRefWith(0x81), "fixture premise: the hook left the tag with the byte 0x81");
  assert.equal(Buffer.from(seen.tagBefore, "hex").toString("utf8"), Buffer.from(seen.tagAfter, "hex").toString("utf8"), "fixture premise: read as text, the two names are the same");
  assert.deepEqual(seen.after, seen.before, "fixture premise: the hook changed no status row, HEAD, checked-out branch, index entry or stash of the nested repository");
  assert.equal(tagRefBytesOf(nestedUnder(join(recovery.path, "repo"))), tagRefWith(0x80), "the snapshot taken before the hooks has the tag as it was then, and is as it was written");
  assert.equal(existsSync(join(nestedUnder(afterRepo), ".git")), true, "the work is copied again under after-hooks/repo/: the tag's name changed, in a byte that text does not tell apart");
  assert.equal(tagRefBytesOf(nestedUnder(afterRepo)), tagRefWith(0x81), "the nested repository copied after the hooks has the tag as the hook left it");
  assert.equal(headOf(nestedUnder(afterRepo)), commit);
  assertBothCopiedAgain(recovery);
});

test("a retire hook that replaces an untracked symbolic link by one whose target differs in one byte that is not UTF-8, with the same status rows: the snapshot before the hooks holds the first target byte for byte, the work is copied again, and the link under after-hooks/repo/ holds the second", (t) => {
  const retire = quietHook(`import { symlinkSync, unlinkSync } from 'node:fs';
const link = join(work, 'link');
unlinkSync(link);
symlinkSync(Buffer.from([0x74, 0x81]), link);`);
  const f = fixture({ capabilities: hookCapability(retire) });
  const spawned = spawn(f, "hook-link-byte");
  const work = join(spawned.home, "work");
  const link = join(work, "link");
  const targetOf = (path) => readlinkSync(path, "buffer").toString("hex");
  if (!storedBytes(t, () => symlinkSync(Buffer.from([0x74, 0x80]), link), () => targetOf(link), "7480")) return;
  const statusBefore = porcelain(work);
  assert.deepEqual(statusRowsIn(statusBefore), ["?? link"], "fixture premise: the link is untracked, and Git's row names it, not its target");

  const { recovery, afterRepo } = retireAfterQuietHook(f, spawned, statusBefore);
  assert.equal(targetOf(join(recovery.path, "repo", "link")), "7480", "the snapshot taken before the hooks holds the link with its target byte for byte");
  assert.equal(existsSync(join(afterRepo, ".git")), true, "the work is copied again under after-hooks/repo/: the link's target changed, in a byte that text does not tell apart");
  assert.equal(targetOf(join(afterRepo, "link")), "7481", "the link copied after the hooks has the target the hook gave it");
  assertBothCopiedAgain(recovery);
});

test("a clean worktree with a committed file whose name is not UTF-8, and only a home note to preserve: the retire completes with a home-only recovery", (t) => {
  const f = fixture();
  const spawned = spawn(f, "name-byte");
  const work = join(spawned.home, "work");
  const named = Buffer.concat([Buffer.from(join(work, "x")), Buffer.from([0x80])]);
  const namesWithX = () => readdirSync(work, { encoding: "buffer" }).filter((name) => name[0] === 0x78).map((name) => name.toString("hex")).join(",");
  if (!storedBytes(t, () => writeFileSync(named, "bytes\n"), namesWithX, "7880")) return;
  execFileSync("git", ["-C", work, "add", "-A"]);
  execFileSync("git", ["-C", work, "commit", "-qm", "a file whose name is not UTF-8"]);
  assert.equal(execFileSync("git", ["-C", work, "ls-files", "-z"]).includes(Buffer.from([0x78, 0x80, 0x00])), true, "fixture premise: Git tracks the file under its name, byte for byte");
  assert.equal(porcelain(work), "", "fixture premise: the file is committed and the worktree is clean");
  write(join(spawned.home, "notes", "x.md"), "an authored note\n");

  const retired = cli(f, ["retire", basename(spawned.home), "--discard-worktree", "--json"]);
  assert.equal(retired.status, 0, `a retire with only the home to preserve was refused for a file's name: ${retired.stderr}\n${retired.stdout}`);
  const recovery = JSON.parse(retired.stdout).workRecovery;
  assert.deepEqual(recovery.classes, ["changed instance-home bytes"]);
  assert.equal(recovery.repoCopy?.copied, false, "the recovery holds the home only");
  assert.equal(existsSync(join(recovery.path, "repo")), false);
  assert.equal(readFileSync(join(recovery.path, "home", "notes", "x.md"), "utf8"), "an authored note\n");
  assert.equal(existsSync(join(recovery.path, "after-hooks")), false, "nothing moved after the snapshot");
  assert.equal(readJson(join(recovery.path, "recovery.json")).phase, "complete");
  assert.equal(existsSync(spawned.home), false, "the home is removed");
});

// ---- The recovery copy mirrors the tree ----
// A work copy is a clone with the source's files put over it, so each top level (the worktree's and
// each nested repository's) is made the source's: an entry the clone checked out that the source no
// longer has is removed, `.git` aside (#656). Names are carried as bytes (#645).

/** Commit everything in `repo` (fixtureGit: a test identity, never signed). */
const commitAll = (repo, message) => {
  fixtureGit(repo, ["add", "-A"]);
  fixtureGit(repo, ["commit", "-qm", message]);
};

test("#656 a worktree with uncommitted deletions of a tracked top-level file, directory and symbolic link, and with top-level renames staged and not: the retire completes, and the copy holds exactly the source's top level", () => {
  const f = fixture();
  const spawned = spawn(f, "top-level-deleted");
  const work = join(spawned.home, "work");
  write(join(work, "gone.txt"), "deleted\n");
  write(join(work, "gone-dir", "inner.txt"), "deleted with its directory\n");
  symlinkSync("tracked.txt", join(work, "gone-link"));
  write(join(work, "moved.txt"), "renamed, not staged\n");
  write(join(work, "staged.txt"), "renamed and staged\n");
  commitAll(work, "top-level entries to delete");
  rmSync(join(work, "gone.txt"));
  rmSync(join(work, "gone-dir"), { recursive: true });
  rmSync(join(work, "gone-link"));
  renameSync(join(work, "moved.txt"), join(work, "moved-to.txt"));
  fixtureGit(work, ["mv", "staged.txt", "staged-to.txt"]);
  const statusBefore = porcelain(work);
  for (const row of [" D gone.txt", " D gone-dir/inner.txt", " D gone-link", " D moved.txt", "?? moved-to.txt", "R  staged-to.txt"]) {
    assert.ok(statusRowsIn(statusBefore).includes(row), `fixture premise: the status has ${row}: ${JSON.stringify(statusBefore)}`);
  }

  const retired = cli(f, ["retire", basename(spawned.home), "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const repo = join(JSON.parse(retired.stdout).workRecovery.path, "repo");
  for (const name of ["gone.txt", "gone-dir", "gone-link", "moved.txt", "staged.txt"]) assert.equal(entryIsThere(join(repo, name)), false, `the copy does not hold ${name}, which the source deleted or renamed`);
  assert.equal(readFileSync(join(repo, "moved-to.txt"), "utf8"), "renamed, not staged\n");
  assert.equal(readFileSync(join(repo, "staged-to.txt"), "utf8"), "renamed and staged\n");
  assert.equal(porcelain(repo), statusBefore, "the copy's status is the source's");
  assert.equal(existsSync(spawned.home), false, "the home is removed");
});

test("#656 #663 a nested repository and a repository inside it, each with an uncommitted deletion of a tracked top-level entry, and a repository there whose .git is a gitfile: the retire completes, each copy holds exactly its source's top level, and the inner ones are carried byte for byte", () => {
  const f = fixture();
  const spawned = spawn(f, "nested-deleted");
  const work = join(spawned.home, "work");
  const nested = nestedRepository(work);
  write(join(nested, "gone-dir", "x.txt"), "deleted with its directory\n");
  commitAll(nested, "a directory to delete");
  rmSync(join(nested, "nested.txt"));
  rmSync(join(nested, "gone-dir"), { recursive: true });
  const inner = join(nested, "inner");
  mkdirSync(inner);
  fixtureGit(null, ["init", "-q", inner]);
  write(join(inner, "kept.txt"), "kept\n");
  write(join(inner, "inner-gone.txt"), "deleted\n");
  commitAll(inner, "inner");
  rmSync(join(inner, "inner-gone.txt"));
  // A repository there whose .git is a gitfile naming no admin directory: the copy carries it as a file.
  write(join(nested, "linked", ".git"), "gitdir: ../missing-admin\n");
  write(join(nested, "linked", "file.txt"), "beside a gitfile\n");
  const nestedBefore = porcelain(nested), innerBefore = porcelain(inner);
  assert.ok(statusRowsIn(nestedBefore).includes(" D nested.txt") && statusRowsIn(nestedBefore).includes(" D gone-dir/x.txt"), `fixture premise: ${JSON.stringify(nestedBefore)}`);
  assert.ok(statusRowsIn(innerBefore).includes(" D inner-gone.txt"), `fixture premise: ${JSON.stringify(innerBefore)}`);

  const retired = cli(f, ["retire", basename(spawned.home), "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const copy = nestedUnder(join(JSON.parse(retired.stdout).workRecovery.path, "repo"));
  assert.equal(entryIsThere(join(copy, "nested.txt")), false, "the nested copy does not hold the file its source deleted");
  assert.equal(entryIsThere(join(copy, "gone-dir")), false, "nor the directory");
  assert.equal(porcelain(copy), nestedBefore, "the nested copy's status is its source's");
  const innerCopy = join(copy, "inner");
  assert.equal(entryIsThere(join(innerCopy, "inner-gone.txt")), false, "the repository inside it does not hold the file its source deleted");
  assert.equal(readFileSync(join(innerCopy, "kept.txt"), "utf8"), "kept\n");
  assert.equal(lstatSync(join(innerCopy, ".git")).isDirectory(), true, "its Git directory is carried as files");
  assert.equal(porcelain(innerCopy), innerBefore, "and its status is its source's");
  assert.equal(readFileSync(join(copy, "linked", ".git"), "utf8"), "gitdir: ../missing-admin\n", "the gitfile is carried byte for byte");
});

test("#645 a home holding a scratch repository with a branch whose name is not valid UTF-8 (its ref and its reflog): the retire completes, and the recovery's home holds both under their names, byte for byte", (t) => {
  const f = fixture();
  const spawned = spawn(f, "home-name-byte");
  const scratch = join(spawned.home, "scratch");
  fixtureGit(null, ["init", "-q", "--initial-branch=main", scratch]);
  write(join(scratch, "a.txt"), "a\n");
  commitAll(scratch, "scratch");
  const head = headOf(scratch);
  const branch = withByte("refs/heads/caf", 0xe9);
  const logs = join(scratch, ".git", "logs", "refs", "heads");
  const make = () => fixtureGit(scratch, ["update-ref", "--create-reflog", "--stdin", "-z"], { input: Buffer.concat([Buffer.from("create "), branch, Buffer.from(`\0${head}\0`)]), stdio: ["pipe", "ignore", "pipe"] });
  if (!storedBytes(t, make, () => namesStartingWith(logs, "caf"), withByte("caf", 0xe9).toString("hex"))) return;
  assert.equal(namesStartingWith(join(scratch, ".git", "refs", "heads"), "caf"), withByte("caf", 0xe9).toString("hex"), "fixture premise: the branch's ref is a file of that name");

  const retired = cli(f, ["retire", basename(spawned.home), "--json"]);
  assert.equal(retired.status, 0, `the retire refused for a file's name: ${retired.stderr}\n${retired.stdout}`);
  const recovery = JSON.parse(retired.stdout).workRecovery;
  assert.ok(recovery.classes.includes("changed instance-home bytes"), retired.stdout);
  const copied = join(recovery.path, "home", "scratch", ".git");
  assert.equal(namesStartingWith(join(copied, "logs", "refs", "heads"), "caf"), withByte("caf", 0xe9).toString("hex"), "the reflog, under its name");
  assert.equal(readFileSync(under(join(copied, "refs", "heads"), withByte("caf", 0xe9)), "utf8"), `${head}\n`, "the ref, under its name, with its bytes");
  assert.equal(existsSync(spawned.home), false, "the home is removed");
});

test("#645 an untracked work file, an ignored output and a file in a nested repository, each named with a byte that is not valid UTF-8: the retire completes, the copy holds each byte for byte, and the outputs count their bytes", (t) => {
  const f = fixture();
  const spawned = spawn(f, "work-name-byte");
  const work = join(spawned.home, "work");
  const name = withByte("caf", 0xe9);
  if (!storedBytes(t, () => writeFileSync(under(work, name), "untracked\n"), () => namesStartingWith(work, "caf"), name.toString("hex"))) return;
  mkdirSync(join(work, "cache"));
  writeFileSync(under(join(work, "cache"), name), "ignored output\n");
  const nested = nestedRepository(work);
  writeFileSync(under(nested, name), "in the nested repository\n");
  const statusBefore = porcelain(work), nestedBefore = porcelain(nested);
  assert.deepEqual(statusRowsIn(statusBefore).sort(), ["!! cache/", "!! human-ignored/", "?? caf\uFFFD"], "fixture premise: the untracked file and the two ignored directories");

  const retired = cli(f, ["retire", basename(spawned.home), "--json"]);
  assert.equal(retired.status, 0, `the retire refused for a file's name: ${retired.stderr}\n${retired.stdout}`);
  const recovery = JSON.parse(retired.stdout).workRecovery;
  const repo = join(recovery.path, "repo");
  assert.equal(readFileSync(under(repo, name), "utf8"), "untracked\n", "the untracked file, under its name");
  assert.equal(readFileSync(under(join(repo, "cache"), name), "utf8"), "ignored output\n", "the ignored output, under its name");
  assert.equal(readFileSync(under(nestedUnder(repo), name), "utf8"), "in the nested repository\n", "the nested repository's file, under its name");
  assert.equal(porcelain(nestedUnder(repo)), nestedBefore, "the nested copy's status is its source's");
  const outputs = Object.fromEntries(recovery.outputs.paths.map((p) => [p.path, p.bytes]));
  assert.equal(outputs["caf\uFFFD"], "untracked\n".length, "the untracked file is named as text and counted by its bytes");
  assert.equal(outputs["cache/"], "ignored output\n".length, "the ignored output is counted by its bytes");
});

test("#645 a nested repository whose own path is not valid UTF-8: Git cannot be run on that path, so the retire refuses with E_WORK_PRESERVATION_FAILED naming the limit, and nothing is removed", (t) => {
  const f = fixture();
  const spawned = spawn(f, "nested-path-byte");
  const work = join(spawned.home, "work");
  const parent = join(work, "human-ignored");
  const made = nestedRepository(work);
  const odd = under(parent, withByte("caf", 0xe9));
  if (!storedBytes(t, () => renameSync(made, odd), () => namesStartingWith(parent, "caf"), withByte("caf", 0xe9).toString("hex"))) return;

  const retired = cli(f, ["retire", basename(spawned.home), "--json"]);
  assert.notEqual(retired.status, 0, retired.stdout);
  const { error } = JSON.parse(retired.stdout);
  assert.equal(error.code, "E_WORK_PRESERVATION_FAILED", retired.stdout);
  assert.match(error.message, /caf\uFFFD has a path that is not valid UTF-8, and Git cannot be run on such a path; rename the directory, then retire again/, error.message);
  assert.equal(existsSync(join(spawned.home, "instance.json")), true, "the home is kept");
  assert.equal(readFileSync(under(odd, "nested.txt"), "utf8"), "nested-commit\n", "and the nested repository");
  assert.equal(lstatSync(under(odd, ".git")).isDirectory(), true);
});

// The home's instance.json. The spawn baseline compares it without the two fields the kernel writes
// later, through a parse. The proof that the hooks left the home as it was compares its bytes.

/** Where the test's own field of instance.json has its one byte: right after this, in a JSON string. */
const PAYLOAD_MARKER = '"reviewPayload": "t';
const payloadByteIn = (file) => { const bytes = readFileSync(file); return bytes[bytes.indexOf(PAYLOAD_MARKER) + PAYLOAD_MARKER.length]; };
/** Give a home's instance.json a field that is not the kernel's, whose string holds the byte 0x80:
 *  not UTF-8. Read as text it is U+FFFD, so the file is still JSON every reader of the kernel accepts. */
function writePayloadByte(home) {
  const file = join(home, "instance.json");
  const bytes = Buffer.from(`${JSON.stringify({ ...readJson(file), reviewPayload: "tX" }, null, 2)}\n`);
  bytes[bytes.indexOf(PAYLOAD_MARKER) + PAYLOAD_MARKER.length] = 0x80;
  writeFileSync(file, bytes);
  assert.equal(payloadByteIn(file), 0x80, "fixture premise: the file holds the byte");
  assert.equal(readJson(file).reviewPayload, "t�", "fixture premise: read as text the field holds the replacement character, and the file is JSON");
}
/** quietHook body: change that byte to 0x81, and nothing else of the file. */
const CHANGES_PAYLOAD_BYTE = `import { readFileSync } from 'node:fs';
const file = join(home, 'instance.json');
const bytes = readFileSync(file);
const at = bytes.indexOf(${JSON.stringify(PAYLOAD_MARKER)}) + ${PAYLOAD_MARKER.length};
seen.byteBefore = bytes[at];
bytes[at] = 0x81;
writeFileSync(file, bytes);`;

test("a retire hook that changes one byte that is not UTF-8 in a field of the home's instance.json that is not the kernel's, and also writes a file in the work: the home is copied again with the work, and the file under after-hooks/home/ holds the hook's byte", () => {
  // The hook writes no note in the home: the only thing it changes there is that byte.
  const f = fixture({ capabilities: hookCapability(quietHook(`${CHANGES_PAYLOAD_BYTE}\n${WRITES_SCRATCH}`, { home: false })) });
  const spawned = spawn(f, "hook-instance-byte-work");
  const work = join(spawned.home, "work");
  writePayloadByte(spawned.home);
  assert.equal(porcelain(work), "", "fixture premise: the worktree is clean before the retire");

  // The helper is given the status the hook leaves: the one new row.
  const { recovery, seen, afterRepo } = retireAfterQuietHook(f, spawned, STATUS_WITH_SCRATCH, { home: false });
  assert.equal(seen.byteBefore, 0x80, "fixture premise: the retire left the byte as it was until the hook ran");
  assert.equal(readFileSync(join(afterRepo, "scratch.txt"), "utf8"), SCRATCH_BYTES, "fixture premise: the work moved and is copied under after-hooks/repo/");
  assert.equal(payloadByteIn(join(recovery.path, "home", "instance.json")), 0x80, "the snapshot taken before the hooks holds the file as it was then");
  const after = join(recovery.path, "after-hooks", "home", "instance.json");
  assert.equal(existsSync(after), true, "the home is copied again under after-hooks/home/: the hook changed a byte of instance.json that text does not tell apart");
  assert.equal(payloadByteIn(after), 0x81, "the file copied after the hooks has the byte the hook gave it");
  assertBothCopiedAgain(recovery);
});

test("a retire hook that changes only that byte of the home's instance.json: the home is copied again, and the file under after-hooks/home/ holds the hook's byte", () => {
  // The kernel before one recovery per retire had this loss too: it copied again when the home's
  // fingerprint or the status text moved, and this change moves neither.
  const f = fixture({ capabilities: hookCapability(quietHook(CHANGES_PAYLOAD_BYTE, { home: false })) });
  const spawned = spawn(f, "hook-instance-byte");
  const work = join(spawned.home, "work");
  writePayloadByte(spawned.home);
  const statusBefore = porcelain(work);
  assert.equal(statusBefore, "", "fixture premise: the worktree is clean");

  const { recovery, seen } = retireAfterQuietHook(f, spawned, statusBefore, { home: false });
  assert.equal(seen.byteBefore, 0x80, "fixture premise: the retire left the byte as it was until the hook ran");
  assert.deepEqual(recovery.classes, ["changed instance-home bytes"]);
  assert.equal(payloadByteIn(join(recovery.path, "home", "instance.json")), 0x80, "the snapshot taken before the hooks holds the file as it was then");
  const after = join(recovery.path, "after-hooks", "home", "instance.json");
  assert.equal(existsSync(after), true, "the home is copied again under after-hooks/home/: the hook changed a byte of instance.json that text does not tell apart (a loss the earlier kernel had as well, with nothing else changed)");
  assert.equal(payloadByteIn(after), 0x81, "the file copied after the hooks has the byte the hook gave it");
  assert.deepEqual(recovery.afterHooks, { home: true, work: false }, "the home moved; the clean worktree did not");
  assert.deepEqual(readJson(join(recovery.path, "recovery.json")).afterHooks, { home: true, work: false });
});

test("a retire hook that rewrites the home's instance.json to the same value in other bytes (other white space), and also writes a file in the work: the home is copied again, and the file under after-hooks/home/ holds the hook's bytes", () => {
  // All of it valid UTF-8, and JSON that parses to what it was: only the bytes differ.
  const retire = quietHook(`import { readFileSync } from 'node:fs';
const file = join(home, 'instance.json');
seen.jsonBefore = readFileSync(file, 'utf8');
seen.jsonAfter = JSON.stringify(JSON.parse(seen.jsonBefore));
writeFileSync(file, seen.jsonAfter);
${WRITES_SCRATCH}`, { home: false });
  const f = fixture({ capabilities: hookCapability(retire) });
  const spawned = spawn(f, "hook-instance-space");
  const work = join(spawned.home, "work");
  const atRetire = readFileSync(join(spawned.home, "instance.json"), "utf8");
  // Something to preserve before the hooks, so that a snapshot is taken before them: a note in the home.
  write(join(spawned.home, "notes", "x.md"), "an authored note\n");
  assert.equal(porcelain(work), "", "fixture premise: the worktree is clean before the retire");

  // The helper is given the status the hook leaves: the one new row.
  const { recovery, seen, afterRepo } = retireAfterQuietHook(f, spawned, STATUS_WITH_SCRATCH, { home: false });
  assert.equal(seen.jsonBefore, atRetire, "fixture premise: the retire left the file as it was until the hook ran");
  assert.notEqual(seen.jsonAfter, seen.jsonBefore, "fixture premise: the hook wrote other bytes");
  assert.deepEqual(JSON.parse(seen.jsonAfter), JSON.parse(seen.jsonBefore), "fixture premise: the two files parse to the same value");
  assert.equal(readFileSync(join(afterRepo, "scratch.txt"), "utf8"), SCRATCH_BYTES, "fixture premise: the work moved and is copied under after-hooks/repo/");
  assert.equal(readFileSync(join(recovery.path, "home", "instance.json"), "utf8"), atRetire, "the snapshot taken before the hooks holds the file as it was then");
  const after = join(recovery.path, "after-hooks", "home", "instance.json");
  assert.equal(existsSync(after), true, "the home is copied again under after-hooks/home/: the hook rewrote instance.json, and a parse does not tell the two files apart");
  assert.equal(readFileSync(after, "utf8"), seen.jsonAfter, "the file copied after the hooks has the bytes the hook wrote");
  assertBothCopiedAgain(recovery);
});

// The home's comparison holds every entry the home copy carries. Before, it passed over the kernel's own
// files and the harness settings by their names, so a hook's write there was lost whenever the work moved
// too: the work was copied again and the home was not. The earlier kernel kept that write, in the second
// recovery it made whole. One case per way of passing over: the kernel's event log (a name), a previous
// AGENTS.md (a pattern), and the harness settings (a path under .claude/).
/** One JSON line, so that the event log stays a log of JSON lines. */
const HOME_WRITE = `${JSON.stringify({ kind: "written-by-the-retire-hook" })}\n`;
for (const { what, slug, path } of [
  { what: "the kernel's event log", slug: "events", path: [".oats-events.jsonl"] },
  { what: "a previous AGENTS.md", slug: "agents-md", path: [".oats-agents-md.by-hook.previous"] },
  { what: "the harness settings", slug: "settings", path: [".claude", "settings.json"] },
]) {
  test(`a retire hook that writes ${what} in the home (${path.join("/")}) and also writes a file in the work: the home is copied again with the work, and after-hooks/home/ holds the hook's bytes`, () => {
    const retire = quietHook(`import { appendFileSync, mkdirSync } from 'node:fs';
const file = join(home, ...${JSON.stringify(path)});
mkdirSync(dirname(file), { recursive: true });
appendFileSync(file, ${JSON.stringify(HOME_WRITE)});
${WRITES_SCRATCH}`, { home: false });
    const f = fixture({ capabilities: hookCapability(retire) });
    const spawned = spawn(f, `hook-home-${slug}`);
    const work = join(spawned.home, "work");
    // Something to preserve before the hooks, so that a snapshot is taken before them: a note in the home.
    write(join(spawned.home, "notes", "x.md"), "an authored note\n");
    assert.equal(porcelain(work), "", "fixture premise: the worktree is clean before the retire");

    // The helper is given the status the hook leaves: the one new row.
    const { recovery, afterRepo } = retireAfterQuietHook(f, spawned, STATUS_WITH_SCRATCH, { home: false });
    assert.equal(readFileSync(join(afterRepo, "scratch.txt"), "utf8"), SCRATCH_BYTES, "fixture premise: the work moved and is copied under after-hooks/repo/");
    const before = join(recovery.path, "home", ...path);
    assert.equal(existsSync(before) && readFileSync(before, "utf8").includes(HOME_WRITE), false, "the snapshot taken before the hooks does not have the hook's write");
    const after = join(recovery.path, "after-hooks", "home", ...path);
    assert.equal(existsSync(after), true, `the home is copied again under after-hooks/home/: the hook wrote ${what}, which the home copy carries`);
    assert.equal(readFileSync(after, "utf8").endsWith(HOME_WRITE), true, "the file copied after the hooks has the hook's write");
    assertBothCopiedAgain(recovery);
  });
}

test("fingerprintTree of an instance home tells apart two instance.json files that differ in one byte that is not UTF-8, and still leaves the kernel's own fields out of a file that is valid", () => {
  const root = mkdtempSync(join(tmpdir(), "oats-fingerprint-home-"));
  temporaryDirectories.push(root);
  const file = join(root, "instance.json");
  const withByte = (byte, fields) => {
    const bytes = Buffer.from(JSON.stringify({ instance: "dev-1", reviewPayload: "tX", ...fields }));
    bytes[bytes.indexOf('"reviewPayload":"t') + '"reviewPayload":"t'.length] = byte;
    writeFileSync(file, bytes);
    return fingerprintTree(root, { instanceHome: true });
  };
  assert.notEqual(withByte(0x80), withByte(0x81), "two files that differ in a byte that is not UTF-8 have two digests");
  // 0x58 is the X the field was written with: a file that is valid UTF-8.
  assert.equal(withByte(0x58, { spawnCompleted: false, wake: null }), withByte(0x58, { spawnCompleted: true, wake: { saved: true } }), "a valid file is compared without the fields the kernel writes after spawn, as before");
  assert.notEqual(withByte(0x58), withByte(0x59), "and with every other byte of it");
});
