// The recovery copier and the exact digest are one pair: every property the copier gives a copied path
// (an entry's name, its kind, a file's bytes, a link's target, the permission bits of each entry and of
// the path itself) is held by the digest, so a source and its copy digest alike, and a change to any of
// those properties moves the digest. A copied path is compared with its own permission bits: the copier
// ends with a chmod of what it made, the root included.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as core from "../lib/core.mjs";
import { copyTreeSafe } from "../lib/tree-copy.mjs";

const temporaryDirectories = [];
test.afterEach(() => {
  for (const dir of temporaryDirectories.splice(0)) {
    // A directory without the owner's write bit cannot be emptied: give each one back first.
    const unlock = (path) => { const st = lstatSync(path); if (!st.isDirectory()) return; chmodSync(path, 0o700); for (const name of readdirSync(path)) unlock(join(path, name)); };
    try { unlock(dir); } catch { /* removed below or already gone */ }
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Whether the file system keeps the bits this test uses. Where it does not, the test is skipped with the
 *  reason; on Linux that is a failure. */
function oddModesKept(t, root) {
  const probe = join(root, "probe");
  mkdirSync(probe);
  const kept = (mode) => { chmodSync(probe, mode); return (lstatSync(probe).mode & 0o7777) === mode; };
  const ok = kept(0o2750) && kept(0o1755) && kept(0o751);
  rmSync(probe, { recursive: true, force: true });
  if (ok) return true;
  const reason = "the file system does not keep the setgid, sticky or other permission bits on a directory";
  assert.notEqual(process.platform, "linux", `this test is not skipped on Linux: ${reason}`);
  t.skip(reason);
  return false;
}

/** A tree with every kind the copier takes, and odd bits: files, an executable and a setuid one, a
 *  directory with setgid, an empty sticky directory, a link and a link whose target is not UTF-8. */
function oddTree(root) {
  const tree = join(root, "source");
  mkdirSync(tree);
  writeFileSync(join(tree, "a.txt"), "a\n"); chmodSync(join(tree, "a.txt"), 0o640);
  writeFileSync(join(tree, "run.sh"), "#!/bin/sh\n"); chmodSync(join(tree, "run.sh"), 0o751);
  writeFileSync(join(tree, "setuid"), "s\n"); chmodSync(join(tree, "setuid"), 0o4750);
  mkdirSync(join(tree, "sub"));
  writeFileSync(join(tree, "sub", "c.txt"), "c\n"); chmodSync(join(tree, "sub", "c.txt"), 0o600);
  chmodSync(join(tree, "sub"), 0o2750);
  mkdirSync(join(tree, "empty")); chmodSync(join(tree, "empty"), 0o1755);
  symlinkSync("a.txt", join(tree, "link"));
  symlinkSync(Buffer.from([0x74, 0x80]), join(tree, "odd-link"));
  chmodSync(tree, 0o751);
  return tree;
}

/** The changes to each property the copier sets, one at a time. */
const CHANGES = [
  ["a file's bytes", (tree) => writeFileSync(join(tree, "a.txt"), "b\n")],
  ["a file's permission bits", (tree) => chmodSync(join(tree, "run.sh"), 0o750)],
  ["a file's setuid bit", (tree) => chmodSync(join(tree, "setuid"), 0o750)],
  ["a directory's permission bits", (tree) => chmodSync(join(tree, "sub"), 0o750)],
  ["a directory's sticky bit", (tree) => chmodSync(join(tree, "empty"), 0o755)],
  ["the permission bits of the copied path itself", (tree) => chmodSync(tree, 0o700)],
  ["a link's target", (tree) => { unlinkSync(join(tree, "link")); symlinkSync("sub", join(tree, "link")); }],
  ["a link's target in one byte that is not UTF-8", (tree) => { unlinkSync(join(tree, "odd-link")); symlinkSync(Buffer.from([0x74, 0x81]), join(tree, "odd-link")); }],
  ["an entry's name", (tree) => renameSync(join(tree, "a.txt"), join(tree, "b.txt"))],
  ["an entry added", (tree) => mkdirSync(join(tree, "added"))],
  ["an entry removed", (tree) => rmSync(join(tree, "empty"), { recursive: true })],
  ["an entry's kind", (tree) => { rmSync(join(tree, "a.txt")); symlinkSync("sub/c.txt", join(tree, "a.txt")); }],
];

test("the exact digest is the copier's pair: a tree of every kind with odd bits and its copy digest alike, and so does each changed tree and its copy", (t) => {
  assert.equal(typeof core.exactTreeDigest, "function", "lib/core.mjs exports exactTreeDigest, the digest a copied path is compared with");
  const root = mkdtempSync(join(tmpdir(), "oats-copy-pair-"));
  temporaryDirectories.push(root);
  if (!oddModesKept(t, root)) return;
  const source = oddTree(root);
  const copy = join(root, "copy");
  copyTreeSafe(source, copy);
  assert.equal(lstatSync(copy).mode & 0o7777, 0o751, "fixture premise: the copier gives the copied path its source's bits");
  assert.equal(core.exactTreeDigest(copy), core.exactTreeDigest(source), "a tree and its copy digest alike");
  for (const [n, [what, change]] of CHANGES.entries()) {
    const variant = join(root, `variant-${n}`);
    copyTreeSafe(source, variant);
    change(variant);
    const again = join(root, `variant-${n}-copy`);
    copyTreeSafe(variant, again);
    assert.equal(core.exactTreeDigest(again), core.exactTreeDigest(variant), `${what}: the changed tree and its copy digest alike`);
  }
});

for (const [what, change] of CHANGES) {
  test(`the exact digest moves when ${what} changes`, (t) => {
    assert.equal(typeof core.exactTreeDigest, "function", "lib/core.mjs exports exactTreeDigest, the digest a copied path is compared with");
    const root = mkdtempSync(join(tmpdir(), "oats-copy-pair-"));
    temporaryDirectories.push(root);
    if (!oddModesKept(t, root)) return;
    const source = oddTree(root);
    const variant = join(root, "variant");
    copyTreeSafe(source, variant);
    assert.equal(core.exactTreeDigest(variant), core.exactTreeDigest(source), "fixture premise: the copy digests like its source");
    change(variant);
    assert.notEqual(core.exactTreeDigest(variant), core.exactTreeDigest(source), `${what} is part of the digest`);
  });
}

test("a name that is not valid UTF-8: a tree and its copy digest alike, and a change of that one byte moves the digest", (t) => {
  const root = mkdtempSync(join(tmpdir(), "oats-copy-pair-"));
  temporaryDirectories.push(root);
  const named = (dir, byte) => Buffer.concat([Buffer.from(join(dir, "caf")), Buffer.from([byte])]);
  const source = join(root, "source");
  mkdirSync(source);
  try { writeFileSync(named(source, 0xe9), "bytes\n"); }
  catch (e) {
    const reason = `the file system refuses a name that is not valid UTF-8 (${e.code}), as APFS does`;
    assert.notEqual(process.platform, "linux", `this test is not skipped on Linux: ${reason}`);
    t.skip(reason);
    return;
  }
  const copy = join(root, "copy");
  copyTreeSafe(source, copy);
  assert.equal(core.exactTreeDigest(copy), core.exactTreeDigest(source), "the tree and its copy digest alike");
  renameSync(named(copy, 0xe9), named(copy, 0xe8));
  assert.notEqual(core.exactTreeDigest(copy), core.exactTreeDigest(source), "one byte of a name that reads alike as text is part of the digest");
});

// A worktree's byte digest (what a work copy is verified with) leaves out exact paths, never a name: the
// worktree's own `.git` and that of each repository the copier rebuilds from a clone (awebai/oats#663).

/** A worktree-shaped tree: its own `.git` file, a nested repository whose `.git` is a file, a repository
 *  inside that one whose `.git` is a gitfile, and a dangling `.git` link in a directory of its own. */
function worktreeTree(root) {
  const work = join(root, "work");
  mkdirSync(join(work, "a", "nested", "inner"), { recursive: true });
  mkdirSync(join(work, "deep", "b"), { recursive: true });
  writeFileSync(join(work, ".git"), "gitdir: /elsewhere/worktrees/work\n");
  writeFileSync(join(work, "a", "nested", ".git"), "gitdir: /elsewhere/nested\n");
  writeFileSync(join(work, "a", "nested", "file.txt"), "nested\n");
  writeFileSync(join(work, "a", "nested", "inner", ".git"), "gitdir: /elsewhere/inner-a\n");
  symlinkSync("missing-a", join(work, "deep", "b", ".git"));
  return work;
}

test("worktreeGitPaths is the worktree's own .git and that of each repository the copier rebuilds, as exact paths", () => {
  const root = mkdtempSync(join(tmpdir(), "oats-copy-pair-"));
  temporaryDirectories.push(root);
  const work = worktreeTree(root);
  assert.deepEqual(core.worktreeGitPaths(work).map((path) => path.toString()), [".git", join("a", "nested", ".git")], "the repository inside the nested one and the dangling link are not in it");
});

for (const [what, change, moves] of [
  ["a dangling .git link's target, at depth", (work) => { unlinkSync(join(work, "deep", "b", ".git")); symlinkSync("missing-b", join(work, "deep", "b", ".git")); }, true],
  ["the gitfile of a repository inside a nested one", (work) => writeFileSync(join(work, "a", "nested", "inner", ".git"), "gitdir: /elsewhere/inner-b\n"), true],
  ["a file of the nested repository", (work) => writeFileSync(join(work, "a", "nested", "file.txt"), "changed\n"), true],
  ["the worktree's own .git", (work) => writeFileSync(join(work, ".git"), "gitdir: /another/place\n"), false],
  ["a rebuilt repository's .git, a file in the source and a directory in the copy", (work) => { rmSync(join(work, "a", "nested", ".git")); mkdirSync(join(work, "a", "nested", ".git", "objects"), { recursive: true }); writeFileSync(join(work, "a", "nested", ".git", "HEAD"), "ref: refs/heads/main\n"); }, false],
]) {
  test(`worktreeBytes, with the source's Git directories, ${moves ? "moves" : "does not move"} when ${what} changes`, () => {
    const root = mkdtempSync(join(tmpdir(), "oats-copy-pair-"));
    temporaryDirectories.push(root);
    const work = worktreeTree(root);
    const gitPaths = core.worktreeGitPaths(work);
    const copy = join(root, "copy");
    copyTreeSafe(work, copy);
    assert.equal(core.worktreeBytes(copy, gitPaths), core.worktreeBytes(work, gitPaths), "fixture premise: the copy digests like its source");
    change(copy);
    (moves ? assert.notEqual : assert.equal)(core.worktreeBytes(copy, gitPaths), core.worktreeBytes(work, gitPaths), `${what} ${moves ? "is" : "is not"} part of the digest`);
  });
}
