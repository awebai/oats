// The one reader of what a work tree's HEAD names (lib/instance-git.mjs): headName, and worktreeHead,
// which adds the commit. Plain repositories made here; nothing of a deployment.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { headName, worktreeHead } from "../lib/instance-git.mjs";

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
const commitIn = (dir) => { git(dir, "-c", "commit.gpgSign=false", "commit", "--quiet", "--allow-empty", "-m", "a commit"); return git(dir, "rev-parse", "HEAD"); };
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
