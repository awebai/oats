// A worktree that cannot be proven unchanged, what the copy takes as a file (awebai/oats#1029), the one
// recovery written after the hooks, and an entry that is not a file, a directory or a link. One part of what
// was retire-work-safety.test.mjs (awebai/oats#1061); the fixtures it shares with the other parts are in
// helpers/retire-work-safety-fixture.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { basename, join } from "node:path";
import {
  HOOK_BYTES, REFUSED_AFTER_HOOKS, assertBothCopiedAgain, cli, commonDirOf, entryIsThere, fixture, fixtureGit,
  headOf, hookCapability, hookRan, installFakeTmux, nestedRepository, nestedUnder, porcelain, quietHook,
  readJson, recoveryRootOf, refusedBeforeHooks, retireAfterQuietHook, spawn, stashEntries, write,
} from "./helpers/retire-work-safety-fixture.mjs";

// ---- A worktree that cannot be proven unchanged ----
// A read of the Git state that fails is never taken for "not set" or for "unchanged", and it does not
// refuse by itself: the worktree is not provable, and the copy decides. With nothing to preserve the
// retire goes through. With anything to preserve the work goes into the snapshot before the hooks, also
// when only the home has something: a snapshot that held the home only could, after the hooks, neither
// be proven to stand for the work nor be given it.

test("a nested repository whose Git state cannot be read refuses the retire at the copy, as it always did, and nothing is removed", () => {
  // A pin, not a difference: the copy asks the nested repository for its commit and fails.
  const f = fixture();
  const spawned = spawn(f, "nested-unreadable");
  const work = join(spawned.home, "work");
  // A nested repository whose Git file names a directory that is not there: Git cannot answer for it.
  write(join(work, "human-ignored", "broken", ".git"), "gitdir: /nonexistent/oats-fixture/git\n");
  write(join(work, "human-ignored", "broken", "kept.txt"), "bytes that must not be lost\n");
  const retired = cli(f, ["retire", "dev-nested-unreadable", "--discard-worktree", "--json"]);
  assert.notEqual(retired.status, 0, "a work state that cannot be read was taken for one that can");
  assert.equal(JSON.parse(retired.stdout).error.code, "E_WORK_PRESERVATION_FAILED", retired.stdout);
  assert.equal(existsSync(spawned.home), true);
  assert.equal(readFileSync(join(work, "human-ignored", "broken", "kept.txt"), "utf8"), "bytes that must not be lost\n");
  assert.deepEqual(readdirSync(recoveryRootOf(spawned.home)), [], "neither a recovery nor its staging is left behind");
});

/** Put a directory where the worktree's repository would keep info/attributes: `git status` still works,
 *  the kernel cannot read the file, and a work copy cannot carry it. */
function unreadableAttributes(work) {
  mkdirSync(join(commonDirOf(work), "info", "attributes"), { recursive: true });
  assert.equal(porcelain(work), "", "fixture premise: Git's status still works, and reports a clean worktree");
}

test("a worktree whose Git state cannot be read, with nothing to preserve, retires: its retire hook runs and the home is removed", () => {
  const f = fixture({ capabilities: hookCapability(quietHook("", { home: false })) });
  const spawned = spawn(f, "unreadable-clean");
  unreadableAttributes(join(spawned.home, "work"));

  const retired = cli(f, ["retire", basename(spawned.home), "--discard-worktree", "--json"]);
  assert.equal(retired.status, 0, `a state that cannot be read refused a retire with nothing to preserve: ${retired.stderr}\n${retired.stdout}`);
  assert.equal(hookRan(spawned.home), true, "the retire hook ran");
  assert.equal(JSON.parse(retired.stdout).workRecovery, undefined, "nothing to preserve: no recovery");
  assert.equal(existsSync(spawned.home), false, "the home is removed");
});

for (const { preserves, prepare } of [
  // A pin, not a difference: this retire copied its work before, and that copy refused on the same file.
  { preserves: "an untracked file", prepare: (home) => write(join(home, "work", "scratch.txt"), "untracked\n") },
  // New: a snapshot of the home only would leave the work neither proven nor copied after the hooks.
  { preserves: "only a home note", prepare: (home) => write(join(home, "notes", "x.md"), "an authored note\n") },
]) {
  test(`a worktree whose Git state cannot be read, with ${preserves} to preserve, has its work copied before the hooks: the copy cannot be made, so the retire refuses with E_WORK_PRESERVATION_FAILED before any hook runs and leaves no recovery`, () => {
    const f = fixture({ capabilities: hookCapability(quietHook("")) });
    const spawned = spawn(f, preserves.startsWith("only") ? "unreadable-home-only" : "unreadable-work");
    unreadableAttributes(join(spawned.home, "work"));
    prepare(spawned.home);

    const retired = cli(f, ["retire", basename(spawned.home), "--discard-worktree", "--json"]);
    assert.notEqual(retired.status, 0, `a worktree that could be neither proven nor copied was retired: ${retired.stdout}`);
    const error = JSON.parse(retired.stdout).error;
    assert.equal(error.code, "E_WORK_PRESERVATION_FAILED", retired.stdout);
    assert.match(error.message, /attributes/, "the message names what the copy could not carry");
    assert.match(error.message, new RegExp(refusedBeforeHooks(basename(spawned.home))), "the message says what this retire did and did not do");
    assert.equal(hookRan(spawned.home), false, "no retire hook ran");
    assert.deepEqual(readdirSync(recoveryRootOf(spawned.home)), [], "neither a recovery nor its staging is left behind");
    assert.equal(existsSync(join(spawned.home, "work", "tracked.txt")), true, "the home and the work are kept");
  });
}

/** Put a directory where the worktree's repository would keep the stash's log, with no stash: `git status`
 *  still works and so does a work copy, which has no stash to carry; the kernel cannot read the log. */
function unreadableStashLog(work) {
  mkdirSync(join(commonDirOf(work), "logs", "refs", "stash"), { recursive: true });
  assert.equal(porcelain(work), "", "fixture premise: Git's status still works, and reports a clean worktree");
}
/** A retire hook's body that does to its worktree what `unreadableStashLog` and `unreadableAttributes` do: a directory at `...path` under the repository's common directory. */
const hookMakesDirectory = (...path) => `import { mkdirSync } from 'node:fs';
mkdirSync(join(git('rev-parse', '--path-format=absolute', '--git-common-dir').trim(), ${path.map((part) => JSON.stringify(part)).join(", ")}), { recursive: true });`;

test("a worktree whose Git state cannot be read while its copy can be made, with only a home note to preserve: the work is in the snapshot before the hooks, is copied again after them, and the retire goes through", () => {
  const f = fixture({ capabilities: hookCapability(quietHook("")) });
  const spawned = spawn(f, "unreadable-copied");
  const work = join(spawned.home, "work");
  unreadableStashLog(work);
  write(join(spawned.home, "notes", "x.md"), "an authored note\n");
  const commit = headOf(work);

  const { recovery, afterRepo } = retireAfterQuietHook(f, spawned, "");
  assert.equal(existsSync(join(recovery.path, "repo", ".git")), true, "the work is in the snapshot taken before the hooks, although only the home had something to preserve: nothing could prove it unchanged after them");
  assert.equal(recovery.repoCopy, undefined, "the snapshot is not home-only");
  assert.equal(headOf(join(recovery.path, "repo")), commit);
  assert.equal(readFileSync(join(recovery.path, "repo", "tracked.txt"), "utf8"), "base\n");
  assert.equal(readFileSync(join(recovery.path, "home", "notes", "x.md"), "utf8"), "an authored note\n");
  assert.equal(existsSync(join(afterRepo, ".git")), true, "the work is copied again under after-hooks/repo/: nothing proves it unchanged");
  assert.equal(headOf(afterRepo), commit);
  assertBothCopiedAgain(recovery);
});

// A retire hook can leave the worktree in that state too. The snapshot before the hooks was then taken of
// a provable worktree and may hold the home only; after the hooks the work is copied, or the retire refuses.

test("a retire hook that leaves the worktree's Git state unreadable while its copy can be made: a snapshot that was home-only gets the work under after-hooks/repo/, and the retire goes through", () => {
  const f = fixture({ capabilities: hookCapability(quietHook(hookMakesDirectory("logs", "refs", "stash"))) });
  const spawned = spawn(f, "hook-unreadable-copied");
  const work = join(spawned.home, "work");
  write(join(spawned.home, "notes", "x.md"), "an authored note\n");
  const commit = headOf(work);
  const statusBefore = porcelain(work);
  assert.equal(statusBefore, "", "fixture premise: a clean worktree before the retire");

  const { recovery, afterRepo } = retireAfterQuietHook(f, spawned, statusBefore);
  assert.equal(recovery.repoCopy?.copied, false, "fixture premise: the snapshot before the hooks is home-only, of a worktree that was provable then");
  assert.equal(existsSync(join(recovery.path, "repo")), false);
  assert.equal(existsSync(join(afterRepo, ".git")), true, "the work is copied under after-hooks/repo/, although no status row, commit or byte moved: nothing proves that after the hook");
  assert.equal(headOf(afterRepo), commit);
  assert.equal(readFileSync(join(afterRepo, "tracked.txt"), "utf8"), "base\n");
  assert.equal(readFileSync(join(recovery.path, "home", "notes", "x.md"), "utf8"), "an authored note\n", "the snapshot taken before the hooks is intact");
  assertBothCopiedAgain(recovery);
});

test("a retire hook that leaves the worktree's Git state unreadable and its copy impossible: the retire refuses with E_WORK_PRESERVATION_FAILED after the hooks, and the home, the work and the recovery written before the hooks are all kept", () => {
  const f = fixture({ capabilities: hookCapability(quietHook(hookMakesDirectory("info", "attributes"))) });
  const spawned = spawn(f, "hook-unreadable-refused");
  const work = join(spawned.home, "work");
  write(join(spawned.home, "notes", "x.md"), "an authored note\n");
  assert.equal(porcelain(work), "", "fixture premise: a clean worktree before the retire");

  const retired = cli(f, ["retire", basename(spawned.home), "--discard-worktree", "--json"]);
  assert.notEqual(retired.status, 0, `a worktree that could be neither proven nor copied after the hooks was retired: ${retired.stdout}`);
  const error = JSON.parse(retired.stdout).error;
  assert.equal(error.code, "E_WORK_PRESERVATION_FAILED", retired.stdout);
  assert.match(error.message, /attributes/, "the message names what the copy could not carry");
  assert.doesNotMatch(error.message, /No retire hook has run/, "the hooks have run: the message does not say otherwise");
  assert.equal(hookRan(spawned.home), true, "fixture premise: the retire hook ran to its end");
  // Everything is kept: the home with the hook's write, the work, and the snapshot taken before the hooks.
  assert.equal(readFileSync(join(spawned.home, "hook-note.txt"), "utf8"), HOOK_BYTES, "the home is kept");
  assert.equal(readFileSync(join(work, "tracked.txt"), "utf8"), "base\n", "the work is kept");
  const recoveries = readdirSync(recoveryRootOf(spawned.home));
  assert.equal(recoveries.length, 1, `one recovery directory: ${recoveries.join(", ")}`);
  const recovery = join(recoveryRootOf(spawned.home), recoveries[0]);
  const manifest = readJson(join(recovery, "recovery.json"));
  assert.equal(manifest.phase, "before-hooks", "the recovery still says the post-hook check has not concluded");
  assert.equal(manifest.repoCopy?.copied, false, "fixture premise: the snapshot before the hooks is home-only, of a worktree that was provable then");
  assert.equal(readFileSync(join(recovery, "home", "notes", "x.md"), "utf8"), "an authored note\n", "the snapshot taken before the hooks is intact");
  assert.deepEqual(readdirSync(recovery).filter((name) => name.includes("after-hooks")), [], "nothing was added to it, and no staging is left in it");
});

// ---- What the copy takes "as a file" is a regular file, by the kernel's look (awebai/oats#1029) ----
// The tests above ask for a refusal that names the path. These ask for the kernel's own sentence, which
// it gives before it copies: the system's call answers differently by file system (an empty directory
// copied "as a file" fails on one and leaves an empty file on another, where a directory's size is 0),
// so a test that waited for the call would pass on one and see a retire on the other.

/** The copier's refusal for `what` at a path that ends in `...path`, as regular-expression source. */
const notCopiedAsFile = (what, ...path) => String.raw`the recovery copies \S*/${path.join("/")} as a file, and ${what} is there`;
/** Retire an instance whose work must be copied and cannot be: → the refusal, checked to keep everything. */
function refusedAtTheCopy(f, spawned) {
  const retired = cli(f, ["retire", basename(spawned.home), "--discard-worktree", "--json"]);
  assert.notEqual(retired.status, 0, `a path that is not a file was copied as one, or left out: ${retired.stdout}`);
  const error = JSON.parse(retired.stdout).error;
  assert.equal(error.code, "E_WORK_PRESERVATION_FAILED", retired.stdout);
  assert.doesNotMatch(error.message, /EISDIR|ENOENT|copyfile/, "the kernel's words, not the system call's");
  assert.match(error.message, new RegExp(refusedBeforeHooks(basename(spawned.home))), "the message says what this retire did and did not do");
  assert.deepEqual(readdirSync(recoveryRootOf(spawned.home)), [], "neither a recovery nor its staging is left behind");
  assert.equal(readFileSync(join(spawned.home, "work", "scratch.txt"), "utf8"), "untracked\n", "the home and the work are kept");
  return error;
}

for (const { state, fill } of [
  { state: "an empty directory", fill: () => {} },
  { state: "a directory with a file in it", fill: (dir) => write(join(dir, "inside"), "x\n") },
]) {
  test(`${state} where info/attributes belongs refuses the copy in the kernel's words, on any file system`, () => {
    const f = fixture();
    const spawned = spawn(f, "attributes-directory");
    const work = join(spawned.home, "work");
    unreadableAttributes(work);
    fill(join(commonDirOf(work), "info", "attributes"));
    write(join(work, "scratch.txt"), "untracked\n");
    assert.match(refusedAtTheCopy(f, spawned).message, new RegExp(notCopiedAsFile("a directory", "info", "attributes")));
  });
}

test("a directory where the log of a stash that is there belongs refuses the copy in the kernel's words", () => {
  const f = fixture();
  const spawned = spawn(f, "stash-log-directory");
  const work = join(spawned.home, "work");
  stashEntries(work, "tracked.txt", 1);
  const log = join(commonDirOf(work), "logs", "refs", "stash");
  rmSync(log);
  mkdirSync(log);
  assert.match(fixtureGit(work, ["rev-parse", "--verify", "--quiet", "refs/stash"], { encoding: "utf8" }), /^[0-9a-f]{40,64}\n$/, "fixture premise: the stash is there, so the copy carries its log");
  write(join(work, "scratch.txt"), "untracked\n");
  assert.match(refusedAtTheCopy(f, spawned).message, new RegExp(notCopiedAsFile("a directory", "logs", "refs", "stash")));
});

test("a directory where a nested repository keeps a branch's log refuses the copy in the kernel's words", () => {
  const f = fixture();
  const spawned = spawn(f, "nested-log-directory");
  const work = join(spawned.home, "work");
  const nested = nestedRepository(work);
  // A branch made with no log, and an empty directory at its log's path: Git reads no log for it.
  fixtureGit(nested, ["-c", "core.logAllRefUpdates=false", "branch", "quiet"]);
  mkdirSync(join(nested, ".git", "logs", "refs", "heads", "quiet"), { recursive: true });
  assert.equal(fixtureGit(nested, ["reflog", "show", "quiet"], { encoding: "utf8" }), "", "fixture premise: Git reads no log there");
  write(join(work, "scratch.txt"), "untracked\n");
  assert.match(refusedAtTheCopy(f, spawned).message, new RegExp(notCopiedAsFile("a directory", "nested", ".git", "logs", "refs", "heads", "quiet")));
});

test("a link where info/attributes and a nested repository's log belong is followed, as Git follows it: the recovery holds a plain file with what Git reads through it, and a link that leads nowhere is a path that is not there", () => {
  const f = fixture();
  const spawned = spawn(f, "copied-through-links");
  const work = join(spawned.home, "work");
  const elsewhere = join(f.base, "elsewhere");
  // info/attributes of the worktree's repository: a link to a file that sets an attribute.
  write(join(elsewhere, "attributes"), "*.txt oats-fixture=through-the-link\n");
  symlinkSync(join(elsewhere, "attributes"), join(commonDirOf(work), "info", "attributes"));
  const attributeOf = (repo) => fixtureGit(repo, ["check-attr", "oats-fixture", "tracked.txt"], { encoding: "utf8" });
  assert.equal(attributeOf(work), "tracked.txt: oats-fixture: through-the-link\n", "fixture premise: Git reads info/attributes through the link");
  // A nested repository: HEAD's log moved elsewhere and linked, its branch's log a link that leads nowhere.
  const nested = nestedRepository(work);
  const branch = fixtureGit(nested, ["symbolic-ref", "--short", "HEAD"], { encoding: "utf8" }).trim();
  const headLog = readFileSync(join(nested, ".git", "logs", "HEAD"), "utf8");
  renameSync(join(nested, ".git", "logs", "HEAD"), join(elsewhere, "head-log"));
  symlinkSync(join(elsewhere, "head-log"), join(nested, ".git", "logs", "HEAD"));
  rmSync(join(nested, ".git", "logs", "refs", "heads", branch));
  symlinkSync(join(elsewhere, "no-such-log"), join(nested, ".git", "logs", "refs", "heads", branch));
  assert.equal(fixtureGit(nested, ["reflog", "show", "HEAD"], { encoding: "utf8" }).split("\n").filter(Boolean).length, 1, "fixture premise: Git reads HEAD's log through the link");
  assert.equal(fixtureGit(nested, ["reflog", "show", branch], { encoding: "utf8" }), "", "fixture premise: Git reads no log through a link that leads nowhere");
  write(join(work, "scratch.txt"), "untracked\n");

  const retired = cli(f, ["retire", basename(spawned.home), "--discard-worktree", "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const repo = join(JSON.parse(retired.stdout).workRecovery.path, "repo");
  const copied = join(repo, ".git", "info", "attributes");
  assert.equal(lstatSync(copied).isFile(), true, "the recovery's info/attributes is a plain file, not a link");
  assert.equal(readFileSync(copied, "utf8"), "*.txt oats-fixture=through-the-link\n");
  assert.equal(attributeOf(repo), "tracked.txt: oats-fixture: through-the-link\n", "and Git reads from it what it read through the link");
  const nestedCopy = nestedUnder(repo);
  assert.equal(lstatSync(join(nestedCopy, ".git", "logs", "HEAD")).isFile(), true, "the nested recovery's log of HEAD is a plain file");
  assert.equal(readFileSync(join(nestedCopy, ".git", "logs", "HEAD"), "utf8"), headLog, "with the bytes the link led to");
  assert.equal(entryIsThere(join(nestedCopy, ".git", "logs", "refs", "heads", branch)), false, "a log that is not there is not in the copy: the clone's own was removed");
});

// ---- The one recovery of an instance that had nothing to preserve before its hooks ----
// It is written after the hooks, whole and verified, before the worktree step and before the home
// is removed. It is a complete recovery of its own: nothing in it says a snapshot was taken before.

test("a worktree that cannot be proven unchanged, with nothing to preserve before the hooks and a home write by the retire hook: the one recovery is written after the hooks and holds the work too, not the home only", () => {
  const f = fixture({ capabilities: hookCapability(quietHook("")) });
  const spawned = spawn(f, "unprovable-late");
  const work = join(spawned.home, "work");
  unreadableStashLog(work);
  const commit = headOf(work);

  const retired = cli(f, ["retire", basename(spawned.home), "--discard-worktree", "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const recovery = JSON.parse(retired.stdout).workRecovery;
  assert.equal(hookRan(spawned.home), true, "fixture premise: the retire hook ran to its end");
  assert.deepEqual(recovery.classes, ["changed instance-home bytes"], "the one class, and it appeared after the hooks");
  assert.deepEqual(readdirSync(recoveryRootOf(spawned.home)), [basename(recovery.path)], "one recovery");
  // Written after the hooks as the first and only recovery: the hook's write is in home/, and nothing is under after-hooks/.
  assert.equal(readFileSync(join(recovery.path, "home", "hook-note.txt"), "utf8"), HOOK_BYTES);
  assert.equal(existsSync(join(recovery.path, "after-hooks")), false);
  assert.equal(recovery.afterHooks, undefined);
  const manifest = readJson(join(recovery.path, "recovery.json"));
  assert.equal(manifest.phase, "complete");
  assert.equal(manifest.afterHooks, undefined);
  // Only the home has something to preserve, and the worktree is not provable: its work is copied all the same.
  assert.equal(existsSync(join(recovery.path, "repo", ".git")), true, "the work is in the recovery: a worktree that cannot be proven unchanged is never left out as having nothing to preserve");
  assert.equal(recovery.repoCopy, undefined, "the recovery is not home-only");
  assert.equal(headOf(join(recovery.path, "repo")), commit);
  assert.equal(readFileSync(join(recovery.path, "repo", "tracked.txt"), "utf8"), "base\n");
  assert.equal(existsSync(spawned.home), false, "the home is removed");
});

test("the one recovery written after the hooks cannot be made: an instance with nothing to preserve before them, whose retire hook writes the home and leaves the worktree impossible to copy, is refused with E_WORK_PRESERVATION_FAILED, and the home and the work are kept", () => {
  const f = fixture({ capabilities: hookCapability(quietHook(hookMakesDirectory("info", "attributes"))) });
  const spawned = spawn(f, "late-refused");
  const work = join(spawned.home, "work");
  assert.equal(porcelain(work), "", "fixture premise: a clean worktree before the retire, in a home that has nothing to preserve");

  const retired = cli(f, ["retire", basename(spawned.home), "--discard-worktree", "--json"]);
  assert.notEqual(retired.status, 0, `an instance whose one recovery could not be made was retired: ${retired.stdout}`);
  const error = JSON.parse(retired.stdout).error;
  assert.equal(error.code, "E_WORK_PRESERVATION_FAILED", retired.stdout);
  assert.match(error.message, /attributes/, "the message names what the copy could not carry");
  assert.doesNotMatch(error.message, /No retire hook has run/, "the hooks have run: the message does not say otherwise");
  assert.equal(hookRan(spawned.home), true, "fixture premise: the retire hook ran to its end");
  assert.equal(readFileSync(join(spawned.home, "hook-note.txt"), "utf8"), HOOK_BYTES, "the home is kept, with the hook's write");
  assert.equal(readFileSync(join(work, "tracked.txt"), "utf8"), "base\n", "the work is kept");
  assert.deepEqual(readdirSync(recoveryRootOf(spawned.home)), [], "neither a recovery nor its staging is left behind");
});

test("an instance with nothing to preserve before the hooks, whose retire hook writes the home and reports incomplete cleanup: the one recovery is written, and the home and the work are kept for the retry as for any incomplete cleanup", () => {
  const retire = `import { writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
const home = process.env.OATS_INSTANCE_HOME;
writeFileSync(join(home, 'hook-note.txt'), ${JSON.stringify(HOOK_BYTES)});
writeFileSync(join(dirname(home), 'hook-saw-' + basename(home)), '{}');
console.log(JSON.stringify({ meta: { retired: false, reason: 'remote unreachable' } }));
`;
  const f = fixture({ capabilities: hookCapability(retire) });
  const spawned = spawn(f, "late-owed");
  const work = join(spawned.home, "work");
  assert.equal(porcelain(work), "", "fixture premise: a clean worktree before the retire, in a home that has nothing to preserve");

  const retired = cli(f, ["retire", basename(spawned.home), "--json"]);
  assert.equal(retired.status, 1, `${retired.stderr}\n${retired.stdout}`);
  const receipt = JSON.parse(retired.stdout);
  assert.equal(hookRan(spawned.home), true, "fixture premise: the retire hook ran to its end");
  assert.ok(receipt.rollbackIncomplete?.some((item) => /acme\.hook: reported incomplete cleanup \(remote unreachable\)/.test(item)), retired.stdout);
  assert.equal(receipt.retainedHome, spawned.home);
  assert.equal(receipt.removedDir, false);
  assert.equal(existsSync(join(spawned.home, ".oats-rollback-incomplete.json")), true, "the home is kept with its cleanup marker");
  assert.equal(readFileSync(join(work, "tracked.txt"), "utf8"), "base\n", "the worktree is where it was: its step waits for the cleanup");
  // The recovery is the one written after the hooks, complete, with the hook's home write.
  const recovery = receipt.workRecovery;
  assert.deepEqual(readdirSync(recoveryRootOf(spawned.home)), [basename(recovery.path)], "one recovery");
  assert.deepEqual(recovery.classes, ["changed instance-home bytes"]);
  assert.equal(readFileSync(join(recovery.path, "home", "hook-note.txt"), "utf8"), HOOK_BYTES);
  assert.equal(readJson(join(recovery.path, "recovery.json")).phase, "complete");
  assert.equal(recovery.afterHooks, undefined);
  assert.equal(existsSync(join(recovery.path, "after-hooks")), false);
});

// ---- An entry that is not a file, a directory or a symbolic link ----
// Proving the work unchanged reads the whole worktree, and such an entry (a socket, a FIFO, a device)
// has no bytes to read or to copy. Git prints no status row for it, so a worktree that holds one can
// read as clean. The retire refuses, names the entry and says what to do; it never says to remove it.
// Before the hooks it also says what this retire has and has not done by then.
const UNSUPPORTED_ENTRY_TEXT = String.raw`\/work\/pipe has an unsupported filesystem type: it is not a file, a directory or a symbolic link, so it cannot be read or copied\. Safely stop the process or resource that owns it, or move the entry elsewhere, before retrying`;
const UNSUPPORTED_ENTRY = new RegExp(`${UNSUPPORTED_ENTRY_TEXT}$`);

test("a FIFO in a worktree that Git reports as clean refuses the retire before its hooks: the message names it, says what to do and says that the instance is not retired, no retire hook runs, no recovery is written and nothing is deleted, however often it is retried", () => {
  const f = fixture({ capabilities: hookCapability(quietHook("")) });
  const spawned = spawn(f, "fifo-before-hooks");
  const work = join(spawned.home, "work");
  write(join(spawned.home, "notes", "x.md"), "an authored note\n");
  const fifo = join(work, "pipe");
  execFileSync("mkfifo", [fifo]);
  assert.equal(porcelain(work), "", "fixture premise: Git has no status row for a FIFO, so the worktree reads as clean and the snapshot before the hooks would hold the home only");

  for (const attempt of ["first", "second"]) {
    const retired = cli(f, ["retire", basename(spawned.home), "--discard-worktree", "--json"]);
    assert.notEqual(retired.status, 0, `${attempt} attempt: a worktree that cannot be read was retired: ${retired.stdout}`);
    const error = JSON.parse(retired.stdout).error;
    assert.equal(error.code, "E_WORK_INSPECTION_FAILED", retired.stdout);
    assert.match(error.message, new RegExp(`${UNSUPPORTED_ENTRY_TEXT}\\. No recovery was written and nothing was deleted: ${basename(spawned.home)} is not retired and its home is kept; this retire stopped no session$`), "the message names the entry, says what to do, and says what this retire did and did not do: this instance was never launched, so no session was stopped");
    assert.doesNotMatch(error.message, /\b(remove|delete)\b/i, "the entry may be a live endpoint: the message does not say to remove it");
    assert.equal(hookRan(spawned.home), false, `${attempt} attempt: no retire hook ran`);
    assert.equal(existsSync(recoveryRootOf(spawned.home)), false, `${attempt} attempt: no recovery was written`);
    assert.equal(readFileSync(join(spawned.home, "notes", "x.md"), "utf8"), "an authored note\n", "the home is kept");
    assert.equal(lstatSync(fifo).isFIFO(), true, "the worktree is kept as it was");
  }
});

test("a FIFO in the worktree of a launched instance refuses the retire before its hooks, after the retire stopped its session: the message says that its session has been stopped", () => {
  const f = fixture();
  const state = installFakeTmux(f);
  // The spawn opens its window on the OATS server (tmux -L oats), which the fake keeps at $TMUX_FAKE_OATS.
  const socket = join(f.base, "socket-fifo");
  f.env.TMUX_FAKE_OATS = socket;
  const launched = cli(f, ["spawn", "dev", "--purpose", "fifo-launched", "--json"]);
  assert.equal(launched.status, 0, `${launched.stderr}\n${launched.stdout}`);
  const spawned = JSON.parse(launched.stdout).result;
  const window = join(state, socket.replaceAll("/", "_"), "window");
  assert.equal(existsSync(window), true, "fixture premise: the instance was launched, and its window is there");
  assert.equal(JSON.parse(readFileSync(join(spawned.home, "instance.json"), "utf8")).tmux?.socket, socket, "fixture premise: the retire addresses the endpoint the window is on");
  assert.equal(readFileSync(join(spawned.home, "early-harness.txt"), "utf8"), "early-harness-bytes\n", "fixture premise: the home has something to preserve");
  const work = join(spawned.home, "work");
  const fifo = join(work, "pipe");
  execFileSync("mkfifo", [fifo]);
  assert.equal(porcelain(work), "", "fixture premise: Git has no status row for a FIFO, so the worktree reads as clean");

  const retired = cli(f, ["retire", basename(spawned.home), "--discard-worktree", "--json"]);
  assert.notEqual(retired.status, 0, `a worktree that cannot be read was retired: ${retired.stdout}`);
  const error = JSON.parse(retired.stdout).error;
  assert.equal(error.code, "E_WORK_INSPECTION_FAILED", retired.stdout);
  assert.match(error.message, new RegExp(`${UNSUPPORTED_ENTRY_TEXT}\\. No recovery was written and nothing was deleted: ${basename(spawned.home)} is not retired and its home is kept; its session has been stopped$`), "the message says what this retire did by then: it stopped the session of a launched instance");
  assert.equal(existsSync(window), false, "the retire stopped the session before it refused");
  assert.equal(existsSync(recoveryRootOf(spawned.home)), false, "no recovery was written");
  assert.equal(readFileSync(join(spawned.home, "early-harness.txt"), "utf8"), "early-harness-bytes\n", "the home is kept");
  assert.equal(lstatSync(fifo).isFIFO(), true, "the worktree is kept as it was");
});

for (const { leaves, body, code, message } of [
  { leaves: "and leaves Git's state as it was", body: "", code: "E_WORK_INSPECTION_FAILED", message: new RegExp(`${UNSUPPORTED_ENTRY_TEXT}${REFUSED_AFTER_HOOKS}`) },
  // The Git state moved, so the work is copied without the proof's read, and the copy meets the entry: the tree copy's own refusal.
  { leaves: "and also rewrites a tracked file", body: "writeFileSync(join(work, 'tracked.txt'), 'rewritten by the retire hook\\n');", code: "E_WORK_PRESERVATION_FAILED", message: new RegExp(String.raw`\/work\/pipe is not a regular file, directory or symlink \(FIFO\).*${REFUSED_AFTER_HOOKS}`) },
]) {
  test(`a retire hook that leaves a FIFO in the worktree ${leaves}: the retire refuses with ${code}, and the home, the work and the recovery written before the hooks are all kept`, () => {
    const retire = quietHook(`execFileSync('mkfifo', [join(work, 'pipe')]);
${body}`);
    const f = fixture({ capabilities: hookCapability(retire) });
    const spawned = spawn(f, body ? "fifo-by-hook-moved" : "fifo-by-hook");
    const work = join(spawned.home, "work");
    write(join(spawned.home, "notes", "x.md"), "an authored note\n");
    assert.equal(porcelain(work), "", "fixture premise: a clean worktree before the retire");

    const retired = cli(f, ["retire", basename(spawned.home), "--discard-worktree", "--json"]);
    assert.notEqual(retired.status, 0, `a worktree that cannot be read was retired: ${retired.stdout}`);
    const error = JSON.parse(retired.stdout).error;
    assert.equal(error.code, code, retired.stdout);
    assert.match(error.message, message, "the message names the entry, and says the hooks have run and what is kept");
    assert.equal(hookRan(spawned.home), true, "fixture premise: the retire hook ran to its end");
    // Everything is kept: the home with the hook's write, the work with the entry, and the snapshot taken before the hooks.
    assert.equal(readFileSync(join(spawned.home, "hook-note.txt"), "utf8"), HOOK_BYTES, "the home is kept");
    assert.equal(lstatSync(join(work, "pipe")).isFIFO(), true, "the work is kept");
    const recoveries = readdirSync(recoveryRootOf(spawned.home));
    assert.equal(recoveries.length, 1, `one recovery directory: ${recoveries.join(", ")}`);
    const recovery = join(recoveryRootOf(spawned.home), recoveries[0]);
    assert.equal(readJson(join(recovery, "recovery.json")).phase, "before-hooks", "the recovery still says the post-hook check has not concluded");
    assert.equal(readFileSync(join(recovery, "home", "notes", "x.md"), "utf8"), "an authored note\n", "the snapshot taken before the hooks is intact");
    assert.deepEqual(readdirSync(recovery).filter((name) => name.includes("after-hooks")), [], "nothing was added to it, and no staging is left in it");
  });
}
