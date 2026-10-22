// Removal recovery uses real Git, including its partial deletion of a tree containing
// a read-only Go-style module cache. No git wrapper simulates a successful clean check.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

function writable(path) {
  let st;
  try { st = lstatSync(path); } catch (e) { if (e.code === "ENOENT") return; throw e; }
  if (st.isSymbolicLink()) return;
  chmodSync(path, st.mode | 0o200);
  if (st.isDirectory()) for (const name of readdirSync(path)) writable(join(path, name));
}

async function fixture(t) {
  const fx = v2Deployment({ souls: { dev: { soul: { work: "checkout" } } }, files: {
    ".gitignore": "cache/\n", "tracked.txt": "committed\n", "deleted.txt": "also committed\n",
  } });
  t.after(() => { writable(fx.base); fx.cleanup(); });
  const { home } = await fx.spawn("dev", { instance: "dev-residue", work: "checkout" });
  const cli = (...args) => fx.cli(["worktree", ...args, "--purpose", "residue", "--json"], { cwd: home, env: { OATS_INSTANCE_HOME: home } });
  const added = cli("add", "--branch", "agents/residue", "--base", "main");
  assert.equal(added.status, 0, added.stderr + added.stdout);
  const tree = join(home, ".work-residue");
  const record = join(home, ".oats", "trees", "residue.json");
  const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { env: { ...fx.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const registered = () => git(fx.member, "worktree", "list", "--porcelain").split("\n").includes(`worktree ${tree}`);
  const gitdir = git(tree, "rev-parse", "--absolute-git-dir");
  const branchTip = git(tree, "rev-parse", "HEAD");
  const cloneIndex = join(git(fx.member, "rev-parse", "--absolute-git-dir"), "index");
  const indexBefore = readFileSync(cloneIndex);
  const cache = join(tree, "cache", "module");
  mkdirSync(cache, { recursive: true });
  writeFileSync(join(cache, "go.mod"), "module example.invalid/cache\n", { mode: 0o444 });
  chmodSync(cache, 0o555);
  const orphan = () => {
    rmSync(gitdir, { recursive: true });
    rmSync(join(tree, "deleted.txt"));
    assert.equal(registered(), false);
    assert.ok(existsSync(join(tree, ".git")), "the dangling .git file survives");
  };
  const removed = () => {
    const result = cli("remove");
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.json().result.branchKept, true);
    assert.equal(existsSync(tree), false);
    assert.equal(existsSync(record), false);
    assert.equal(registered(), false);
    assert.equal(git(fx.member, "rev-parse", "refs/heads/agents/residue"), branchTip);
    assert.deepEqual(readFileSync(cloneIndex), indexBefore, "the clone's index stays untouched");
  };
  return { fx, tree, record, cache, cli, git, registered, orphan, removed };
}

test("remove finishes Git's partial deletion around a read-only ignored cache", async (t) => {
  const w = await fixture(t);
  w.removed();
});

test("remove retries an unregistered tree with missing tracked files and a read-only ignored cache", async (t) => {
  const w = await fixture(t);
  w.orphan();
  w.removed();
});

for (const [name, file, contents] of [["modified tracked", "tracked.txt", "changed\n"], ["untracked", "scratch.txt", "new work\n"]]) {
  test(`remove refuses ${name} residue, lists its path and keeps the record`, async (t) => {
    const w = await fixture(t);
    w.orphan();
    writeFileSync(join(w.tree, file), contents);
    const result = w.cli("remove");
    assert.notEqual(result.status, 0);
    assert.equal(result.json().error.code, "E_WORKTREE_DIRTY", result.stdout);
    assert.ok(result.json().error.message.includes(file), result.stdout);
    assert.equal(readFileSync(join(w.tree, file), "utf8"), contents);
    assert.ok(existsSync(w.record));
    assert.equal(lstatSync(w.cache).mode & 0o777, 0o555, "refusal changes no permissions");
  });
}

test("remove keeps unregistered residue when its recorded branch is unreadable", async (t) => {
  const w = await fixture(t);
  w.orphan();
  w.git(w.fx.member, "update-ref", "-d", "refs/heads/agents/residue");
  const result = w.cli("remove");
  assert.notEqual(result.status, 0);
  assert.equal(result.json().error.code, "E_WORK_PRESERVATION_FAILED", result.stdout);
  assert.match(result.json().error.message, /branch|agents\/residue/);
  assert.ok(existsSync(w.record));
  assert.equal(readFileSync(join(w.tree, "tracked.txt"), "utf8"), "committed\n");
  assert.equal(lstatSync(w.cache).mode & 0o777, 0o555);
});

test("remove does not make an ignored symlink's external target writable", async (t) => {
  const w = await fixture(t);
  w.orphan();
  const outside = join(w.fx.base, "external");
  mkdirSync(outside, { mode: 0o555 });
  chmodSync(w.cache, 0o755);
  symlinkSync(outside, join(w.cache, "external"));
  chmodSync(w.cache, 0o555);
  w.removed();
  assert.equal(lstatSync(outside).mode & 0o777, 0o555);
});

test("remove does not chmod a dirty registered tree before Git's clean check", async (t) => {
  const w = await fixture(t);
  writeFileSync(join(w.tree, "scratch.txt"), "untracked\n");
  const result = w.cli("remove");
  assert.equal(result.json().error.code, "E_WORKTREE_DIRTY", result.stdout);
  assert.ok(w.registered());
  assert.ok(existsSync(w.record));
  assert.equal(lstatSync(w.cache).mode & 0o777, 0o555);
});

test("remove keeps the record when the recorded path is a dangling symlink", async (t) => {
  const w = await fixture(t);
  w.orphan();
  writable(w.tree);
  rmSync(w.tree, { recursive: true });
  symlinkSync(join(w.fx.base, "missing-target"), w.tree);
  const result = w.cli("remove");
  assert.notEqual(result.status, 0);
  assert.equal(result.json().error.code, "E_WORK_PRESERVATION_FAILED", result.stdout);
  assert.ok(existsSync(w.record));
  assert.ok(lstatSync(w.tree).isSymbolicLink());
});

test("a failure after Git's partial deletion describes it truthfully and can be retried", { skip: process.platform !== "darwin" }, async (t) => {
  const w = await fixture(t);
  const locked = join(w.cache, "go.mod");
  execFileSync("chflags", ["uchg", locked]);
  try {
    const result = w.cli("remove");
    assert.notEqual(result.status, 0);
    assert.equal(result.json().error.code, "E_WORK_PRESERVATION_FAILED", result.stdout);
    assert.doesNotMatch(result.json().error.message, /nothing was removed/);
    assert.match(result.json().error.message, /registration.*gone/);
    assert.match(result.json().error.message, /retry/);
    assert.equal(w.registered(), false);
    assert.ok(existsSync(locked), "the residue remains after the registration is gone");
    assert.ok(existsSync(w.record));
  } finally { execFileSync("chflags", ["nouchg", locked]); }
  w.removed();
});
