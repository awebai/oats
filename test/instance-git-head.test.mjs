// The one reader of what a work tree's HEAD names (lib/instance-git.mjs): headName, and worktreeHead,
// which adds the commit. Plain repositories made here; nothing of a deployment.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSameWorktreeHead, headName, observeInstanceGit, worktreeCommitUnreached, worktreeHead } from "../lib/instance-git.mjs";

const temporaryDirectories = [];
test.afterEach(() => { for (const dir of temporaryDirectories.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).replace(/\n$/, "");
/** A new repository with no commit. */
function repository() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-head-")));
  temporaryDirectories.push(dir);
  execFileSync("git", ["init", "--quiet", dir], { stdio: ["ignore", "pipe", "pipe"] });
  git(dir, "config", "user.email", "test@example.invalid");
  git(dir, "config", "user.name", "Test");
  return dir;
}
const commitIn = (dir, message = "a commit") => { git(dir, "-c", "commit.gpgSign=false", "commit", "--quiet", "--allow-empty", "-m", message); return git(dir, "rev-parse", "HEAD"); };
/** Point HEAD at a ref by its bytes, as Git stores it. */
const pointHeadAt = (dir, ref) => writeFileSync(join(dir, ".git", "HEAD"), Buffer.concat([Buffer.from("ref: "), Buffer.isBuffer(ref) ? ref : Buffer.from(ref), Buffer.from("\n")]));
const isInspectionFailure = (e) => e?.code === "E_WORK_INSPECTION_FAILED";

test("headName keeps a branch name as it is: a leading U+FEFF, a trailing U+00A0, U+2028 and U+3000 are part of the name", () => {
  for (const name of ["﻿lead", "trail ", "line sep", "wide　"]) {
    const dir = repository();
    pointHeadAt(dir, `refs/heads/${name}`);
    const head = headName(dir);
    assert.equal(head.branch, name, JSON.stringify(name));
    assert.equal(head.detached, false);
    assert.equal(head.ref.toString("hex"), Buffer.from(`refs/heads/${name}`).toString("hex"), "the ref is the bytes Git prints, without the line feed that ends them");
  }
});

test("headName gives no name, and the ref's bytes, for a branch whose name is not valid UTF-8 and for a HEAD outside refs/heads/: neither is called detached", () => {
  const notUtf8 = Buffer.concat([Buffer.from("refs/heads/caf"), Buffer.from([0xe9])]);
  for (const ref of [notUtf8, Buffer.from("refs/tags/v1")]) {
    const dir = repository();
    pointHeadAt(dir, ref);
    assert.equal(execFileSync("git", ["-C", dir, "symbolic-ref", "HEAD"]).toString("hex"), Buffer.concat([ref, Buffer.from("\n")]).toString("hex"), "fixture premise: Git gives those bytes back for HEAD");
    const head = headName(dir);
    assert.equal(head.branch, null);
    assert.equal(head.detached, false);
    assert.equal(head.ref.toString("hex"), ref.toString("hex"));
  }
});

test("headName through a chain of symbolic refs names the last one, the branch the commits go to", () => {
  const dir = repository();
  git(dir, "symbolic-ref", "HEAD", "refs/heads/main");
  commitIn(dir);
  git(dir, "symbolic-ref", "refs/heads/alias", "refs/heads/main");
  git(dir, "symbolic-ref", "HEAD", "refs/heads/alias");
  const head = headName(dir);
  assert.equal(head.branch, "main");
  assert.equal(head.ref.toString(), "refs/heads/main");
});

test("headName says detached only for a detached HEAD, and a read that fails throws", () => {
  const dir = repository();
  commitIn(dir);
  git(dir, "checkout", "--quiet", "--detach");
  assert.deepEqual(headName(dir), { branch: null, detached: true, ref: null });
  assert.throws(() => headName(join(dir, "not-there")), isInspectionFailure, "a directory that is not there is a failed read, not a detached HEAD");
  writeFileSync(join(dir, ".git", "HEAD"), "not a HEAD\n");
  assert.throws(() => headName(dir), isInspectionFailure, "a HEAD Git cannot read is a failed read, not a detached HEAD");
});

test("worktreeHead adds the commit HEAD is at, and a HEAD that has no commit is a failed read", () => {
  const dir = repository();
  git(dir, "symbolic-ref", "HEAD", "refs/heads/main");
  assert.throws(() => worktreeHead(dir), (e) => isInspectionFailure(e) && /has no commit that could be read/.test(e.message), "a branch that is not born yet");
  const commit = commitIn(dir);
  const head = worktreeHead(dir);
  assert.equal(head.commit, commit);
  assert.equal(head.branch, "main");
  assert.equal(head.detached, false);
  assert.equal(head.ref.toString(), "refs/heads/main");
  git(dir, "checkout", "--quiet", "--detach");
  assert.deepEqual(worktreeHead(dir), { commit, branch: null, detached: true, ref: null });
});

test("the HEAD the reader and the plan report is the work tree's, whatever repository the caller's GIT_DIR, GIT_WORK_TREE or GIT_INDEX_FILE name", () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "oats-head-home-")));
  temporaryDirectories.push(home);
  const work = join(home, "work");
  mkdirSync(work);
  execFileSync("git", ["init", "--quiet", work], { stdio: ["ignore", "pipe", "pipe"] });
  git(work, "config", "user.email", "test@example.invalid");
  git(work, "config", "user.name", "Test");
  git(work, "symbolic-ref", "HEAD", "refs/heads/selected");
  const commit = commitIn(work, "the work tree's commit");
  writeFileSync(join(home, "instance.json"), JSON.stringify({ instance: "dev-1", agent: "dev", work: "worktree", branch: "selected" }));
  const other = repository();
  git(other, "symbolic-ref", "HEAD", "refs/heads/other");
  const otherCommit = commitIn(other, "the other repository's commit");
  assert.notEqual(otherCommit, commit, "fixture premise: the two repositories are at two commits");
  const saved = { ...process.env };
  Object.assign(process.env, { GIT_DIR: join(other, ".git"), GIT_WORK_TREE: other, GIT_INDEX_FILE: join(other, ".git", "index") });
  try {
    assert.equal(execFileSync("git", ["-C", work, "symbolic-ref", "HEAD"], { encoding: "utf8" }).trim(), "refs/heads/other", "fixture premise: with these variables, Git asked about the work tree answers for the other repository");
    assert.equal(headName(work).branch, "selected");
    assert.equal(worktreeHead(work).commit, commit);
    const observed = observeInstanceGit(home);
    assert.equal(observed.observation.branch, "selected", "the plan's name is the work tree's");
    assert.equal(observed.observation.revision, commit, "beside the work tree's commit");
    assert.equal(observed.recorded.drift, false);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

test("assertSameWorktreeHead passes the same commit with the same ref's bytes, or the same detached commit, and refuses every other pair", () => {
  const A = "a".repeat(40), B = "b".repeat(40);
  const on = (commit, ref, branch = null) => ({ commit, branch, detached: false, ref: Buffer.from(ref) });
  const detached = (commit) => ({ commit, branch: null, detached: true, ref: null });
  const moved = (e) => e?.code === "E_WORK_PRESERVATION_FAILED" && e.message === "the worktree's HEAD changed after it was inspected, so the worktree was not removed. The home and the worktree are kept, and so is any recovery the retire wrote; retry the retire.";
  assert.doesNotThrow(() => assertSameWorktreeHead(on(A, "refs/heads/x", "x"), on(A, "refs/heads/x", "x")));
  assert.doesNotThrow(() => assertSameWorktreeHead(detached(A), detached(A)));
  assert.throws(() => assertSameWorktreeHead(on(A, "refs/heads/x", "x"), on(B, "refs/heads/x", "x")), moved, "another commit");
  assert.throws(() => assertSameWorktreeHead(on(A, "refs/heads/x", "x"), on(A, "refs/heads/y", "y")), moved, "another ref");
  assert.throws(() => assertSameWorktreeHead(detached(A), on(A, "refs/heads/x", "x")), moved, "detached, then on a ref");
  assert.throws(() => assertSameWorktreeHead(on(A, "refs/heads/x", "x"), detached(A)), moved, "on a ref, then detached");
  const notUtf8 = (byte) => ({ commit: A, branch: null, detached: false, ref: Buffer.concat([Buffer.from("refs/heads/caf"), Buffer.from([byte])]) });
  assert.throws(() => assertSameWorktreeHead(notUtf8(0xe9), notUtf8(0xe8)), moved, "two refs OATS carries no name for, with different bytes");
  assert.doesNotThrow(() => assertSameWorktreeHead(notUtf8(0xe9), notUtf8(0xe9)));
  assert.throws(() => assertSameWorktreeHead(undefined, detached(A)), moved, "a HEAD the final inspection did not read");
});

test("worktreeCommitUnreached, in a repository with a branch whose name is not valid UTF-8 and a damaged ref file: decided both ways, and nothing refuses", (t) => {
  const repo = repository();
  // Git stores a loose ref as a file of that name: a filesystem that refuses names that are not
  // valid UTF-8 (APFS) cannot hold this fixture.
  const probe = Buffer.concat([Buffer.from(join(repo, "probe-caf")), Buffer.from([0xe9])]);
  try { writeFileSync(probe, ""); rmSync(probe); }
  catch (e) {
    if (e.code !== "EILSEQ") throw e;
    t.skip("filesystem refuses non-UTF-8 names (APFS); covered on Linux CI");
    return;
  }
  git(repo, "symbolic-ref", "HEAD", "refs/heads/main");
  const base = commitIn(repo);
  const notUtf8 = Buffer.concat([Buffer.from("refs/heads/caf"), Buffer.from([0xe9])]);
  writeFileSync(join(repo, ".git", "refs", "heads", "damaged"), "not an object id\n");
  const work = join(repo, "..", `${repo.split("/").pop()}-work`);
  temporaryDirectories.push(work);
  git(repo, "worktree", "add", "--quiet", "--detach", work, base);
  const commit = commitIn(work);
  // No ref reaches the worktree's commit: only its HEAD does.
  execFileSync("git", ["-C", repo, "update-ref", "--stdin"], { input: Buffer.concat([Buffer.from("update "), notUtf8, Buffer.from(` ${base}\n`)]), stdio: ["pipe", "pipe", "pipe"] });
  const first = worktreeCommitUnreached(repo, work);
  assert.equal(first.unreached, true, "a commit only the worktree's HEAD reaches");
  assert.equal(first.head.commit, commit);
  assert.equal(first.head.detached, true);
  // The branch whose name is not valid UTF-8 now reaches it.
  execFileSync("git", ["-C", repo, "update-ref", "--stdin"], { input: Buffer.concat([Buffer.from("update "), notUtf8, Buffer.from(` ${commit}\n`)]), stdio: ["pipe", "pipe", "pipe"] });
  assert.equal(worktreeCommitUnreached(repo, work).unreached, false, "a commit that branch reaches");
});

test("a home spawned before #641 that records the branch \"HEAD\" observes no recorded branch and no drift, detached or not; a recorded branch still drifts", () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "oats-head-home-")));
  temporaryDirectories.push(home);
  const work = join(home, "work");
  mkdirSync(work);
  execFileSync("git", ["init", "--quiet", work], { stdio: ["ignore", "pipe", "pipe"] });
  git(work, "config", "user.email", "test@example.invalid");
  git(work, "config", "user.name", "Test");
  git(work, "symbolic-ref", "HEAD", "refs/heads/main");
  commitIn(work);
  const record = (branch) => writeFileSync(join(home, "instance.json"), JSON.stringify({ instance: "dev-1", agent: "dev", work: "checkout", repo: work, ...(branch === undefined ? {} : { branch }) }));
  const recorded = () => observeInstanceGit(home).recorded;

  record("HEAD");
  assert.deepEqual(recorded(), { branch: null, repo: work, drift: false }, "on a branch: \"HEAD\" names none");
  record("main");
  assert.deepEqual(recorded(), { branch: "main", repo: work, drift: false });
  record("other");
  assert.deepEqual(recorded(), { branch: "other", repo: work, drift: true }, "a recorded branch the tree is not on drifts");

  git(work, "checkout", "--quiet", "--detach");
  record("HEAD");
  assert.deepEqual(recorded(), { branch: null, repo: work, drift: false }, "detached: \"HEAD\" names none");
  record(null);
  assert.deepEqual(recorded(), { branch: null, repo: work, drift: false }, "the null a detached spawn records now");
  record(undefined);
  assert.deepEqual(recorded(), { branch: null, repo: work, drift: false }, "no key, as for a tree that was not Git");
  record("main");
  assert.deepEqual(recorded(), { branch: "main", repo: work, drift: true }, "a recorded branch drifts when the tree is detached, as before");
});
