/** lib/remote.mjs — observe Git remotes (contract §1). Tests build SMALL bare repos
 * inline; they never depend on the Northwind fixture and never run `oats setup`. */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  contentDigest, fetchRemoteTree, listRemoteTree, observeRemote, parseRepoRef, readRemoteFile, runGit, FILE_BUDGET,
} from "../lib/remote.mjs";

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" };
const git = (cwd, ...args) => execFileSync("git", args, { cwd, env: GIT_ENV, stdio: ["ignore", "pipe", "pipe"] }).toString("utf8").trim();

/** Return the thrown/rejected error (assert.throws/rejects do not return it). */
function caught(fn) { try { fn(); } catch (e) { return e; } assert.fail("expected a throw"); }
async function caughtAsync(promise) { try { await promise; } catch (e) { return e; } assert.fail("expected a rejection"); }

const roots = [];
function scratch(name = "oats-remote-") { const d = mkdtempSync(join(tmpdir(), name)); roots.push(d); return d; }
test.after(() => { for (const d of roots) { try { chmodSync(d, 0o755); } catch {} rmSync(d, { recursive: true, force: true }); } });

/** Build a bare repo + a working clone; `write(files)` commits and pushes; returns oids. */
function makeRepo(base, { branch = "main" } = {}) {
  const bare = join(base, "remote.git"), work = join(base, "work");
  git(base, "init", "-q", "--bare", "-b", branch, bare);
  git(base, "init", "-q", "-b", branch, work);
  git(work, "remote", "add", "origin", bare);
  const commit = (message, mutate) => {
    mutate(work);
    git(work, "add", "-A");
    git(work, "commit", "-q", "--allow-empty", "-m", message);
    git(work, "push", "-q", "origin", `HEAD:${branch}`);
    return git(work, "rev-parse", "HEAD");
  };
  return { bare, work, branch, commit };
}

const write = (dir, rel, content) => { mkdirSync(join(dir, rel, ".."), { recursive: true }); writeFileSync(join(dir, rel), content); };

function fixture() {
  const base = scratch();
  const repo = makeRepo(base);
  const c1 = repo.commit("one", (w) => {
    write(w, "README.md", "# hello\n");
    write(w, "capabilities/nw-tool/oats.json", JSON.stringify({ capability: "nw-tool" }) + "\n");
    write(w, "capabilities/nw-tool/skills/cut/SKILL.md", "---\nname: cut\n---\nbody\n");
    write(w, "capabilities/nw-tool/bin/run.mjs", "#!/usr/bin/env node\nconsole.log(1)\n");
    chmodSync(join(w, "capabilities/nw-tool/bin/run.mjs"), 0o755);
    write(w, "capabilities/nw-tool/deep/a/b/c.txt", "deep\n");
  });
  git(repo.work, "tag", "v1.0.0");
  git(repo.work, "tag", "-a", "v1.0.0-annotated", "-m", "release");
  git(repo.work, "push", "-q", "origin", "--tags");
  const c2 = repo.commit("two", (w) => { write(w, "README.md", "# hello again\n"); });
  return { base, repo, c1, c2, cacheDir: join(base, "cache") };
}

// ---------------------------------------------------------------------------
// parseRepoRef
// ---------------------------------------------------------------------------

test("parseRepoRef: every hosted form gives ONE key; the fetch url honours the form written (M2)", () => {
  const key = "github.com/org/repo";
  // https forms canonicalise; the bare git: scheme defaults to https.
  for (const text of ["git:github.com/org/repo", "git:github.com/org/repo.git", "https://github.com/org/repo", "https://github.com/org/repo.git", "https://GitHub.com/org/repo"]) {
    assert.deepEqual({ ...parseRepoRef(text) }, { host: "github.com", path: "org/repo", url: "https://github.com/org/repo.git", key }, text);
  }
  // ssh forms: same key, url kept AS WRITTEN (the operator's ssh access is what gets used).
  for (const text of ["git@github.com:org/repo.git", "git@GitHub.com:org/repo", "ssh://git@github.com/org/repo.git", "ssh://git@github.com:2222/org/repo", "ssh://github.com/org/repo"]) {
    const r = parseRepoRef(text);
    assert.equal(r.key, key, text); assert.equal(r.url, text, `${text}: url is the ssh form as written`);
    assert.equal(r.host, "github.com");
  }
  assert.equal(parseRepoRef("git:gitlab.com/group/sub/repo").key, "gitlab.com/group/sub/repo");
  // remoteOptions.transport steers ONLY the bare git: scheme.
  assert.equal(parseRepoRef("git:github.com/org/repo", { transport: "ssh" }).url, "git@github.com:org/repo.git");
  assert.equal(parseRepoRef("git:github.com/org/repo", { transport: "https" }).url, "https://github.com/org/repo.git");
  assert.equal(parseRepoRef("git:github.com/org/repo", { cacheDir: "/x" }).url, "https://github.com/org/repo.git", "default https; unrelated options ignored");
  assert.equal(parseRepoRef("https://github.com/org/repo", { transport: "ssh" }).url, "https://github.com/org/repo.git", "an explicit https form stays https");
  assert.equal(parseRepoRef("git@github.com:org/repo.git", { transport: "https" }).url, "git@github.com:org/repo.git", "an explicit ssh form stays ssh");
  assert.equal(caught(() => parseRepoRef("git:github.com/org/repo", { transport: "scp" })).code, "E_REPO_REF");
  // Parsed ssh refs round-trip and compare by KEY.
  const ssh = parseRepoRef("git@github.com:org/repo.git");
  assert.equal(parseRepoRef(ssh), ssh);
  assert.equal(parseRepoRef("https://github.com/org/repo").key, ssh.key, "the identity is the key, whatever the transport");
});

test("parseRepoRef accepts absolute paths and file:// URLs as local refs", () => {
  const local = parseRepoRef("/tmp/some/bare.git/");
  assert.deepEqual({ ...local }, { host: "local", path: "/tmp/some/bare.git", url: "/tmp/some/bare.git", key: "local//tmp/some/bare.git" });
  assert.equal(parseRepoRef("file:///tmp/some/bare.git").key, "local//tmp/some/bare.git");
  assert.equal(parseRepoRef(local), local, "already-parsed refs pass through");
});

test("parseRepoRef rejects malformed references with E_REPO_REF and details", () => {
  for (const bad of ["github.com/org/repo", "git:github.com/only", "https://github.com/org/../repo", "", 42, "relative/path.git", "git:github.com/org/re po"]) {
    const e = caught(() => parseRepoRef(bad));
    assert.equal(e.code, "E_REPO_REF", String(bad));
    assert.ok(e.details && "ref" in e.details, "details carries the ref");
    assert.deepEqual(e.provenance, e.details, "details is also exposed as provenance");
  }
});

// ---------------------------------------------------------------------------
// observeRemote
// ---------------------------------------------------------------------------

test("observeRemote resolves the default branch, a branch name, tags and OIDs", async () => {
  const f = fixture();
  const opts = { cacheDir: f.cacheDir };
  const head = await observeRemote(f.repo.bare, opts);
  assert.equal(head.commit, f.c2);
  assert.equal(head.ref, "refs/heads/main");
  assert.equal(head.key, `local/${f.repo.bare}`);
  assert.equal(head.url, f.repo.bare);
  assert.match(head.observedAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);

  assert.equal((await observeRemote(f.repo.bare, { ...opts, at: "main" })).ref, "refs/heads/main");
  const tag = await observeRemote(f.repo.bare, { ...opts, at: "v1.0.0" });
  assert.equal(tag.commit, f.c1); assert.equal(tag.ref, "refs/tags/v1.0.0");
  const annotated = await observeRemote(f.repo.bare, { ...opts, at: "v1.0.0-annotated" });
  assert.equal(annotated.commit, f.c1, "annotated tags peel to the commit, not the tag object");
  assert.equal(annotated.ref, "refs/tags/v1.0.0-annotated");
  const oid = await observeRemote(pathToFileURL(f.repo.bare).href, { ...opts, at: f.c1 });
  assert.equal(oid.commit, f.c1); assert.equal(oid.ref, null);
});

test("observeRemote follows a default branch that is not main", async () => {
  const base = scratch();
  const repo = makeRepo(base, { branch: "trunk" });
  const c = repo.commit("init", (w) => write(w, "a.txt", "a\n"));
  const obs = await observeRemote(repo.bare, { cacheDir: join(base, "cache") });
  assert.equal(obs.commit, c);
  assert.equal(obs.ref, "refs/heads/trunk");
});

test("observeRemote: unknown ref → E_REMOTE_UNREADABLE not-found", async () => {
  const f = fixture();
  const e = await caughtAsync(observeRemote(f.repo.bare, { cacheDir: f.cacheDir, at: "no-such-branch" }));
  assert.equal(e.code, "E_REMOTE_UNREADABLE");
  assert.equal(e.details.reason, "not-found");
  assert.equal(e.details.url, f.repo.bare);
  assert.equal(e.details.at, "no-such-branch");
});

test("observeRemote: nonexistent path → E_REMOTE_UNREADABLE not-found; unreadable bare → auth-or-not-found", async () => {
  const base = scratch();
  const missing = join(base, "nope.git");
  const e1 = await caughtAsync(observeRemote(missing, { cacheDir: join(base, "cache") }));
  assert.equal(e1.code, "E_REMOTE_UNREADABLE");
  assert.equal(e1.details.reason, "not-found");
  assert.equal(e1.details.url, missing);
  assert.deepEqual(e1.provenance, e1.details);

  const repo = makeRepo(base);
  repo.commit("init", (w) => write(w, "a.txt", "a\n"));
  chmodSync(repo.bare, 0o000);
  try {
    if (process.getuid?.() === 0) return; // root ignores permission bits
    const e2 = await caughtAsync(observeRemote(repo.bare, { cacheDir: join(base, "cache") }));
    assert.equal(e2.code, "E_REMOTE_UNREADABLE");
    assert.ok(["auth", "not-found"].includes(e2.details.reason), `reason ${e2.details.reason}`);
  } finally { chmodSync(repo.bare, 0o755); }
});

test("observeRemote never half-succeeds: the failing observation leaves no pinned commit", async () => {
  const f = fixture();
  const cacheDir = f.cacheDir;
  await assert.rejects(observeRemote(f.repo.bare, { cacheDir, at: "0000000000000000000000000000000000000001" }), (e) => e.code === "E_REMOTE_UNREADABLE" && e.details.reason === "not-found");
  const [hash] = readdirSync(cacheDir);
  assert.equal(git(join(cacheDir, hash), "for-each-ref", "refs/oats/"), "", "no pin recorded for a failed fetch");
});

test("observeRemote reuses the cache: a second observe of the same commit does not fetch", async () => {
  const f = fixture();
  const calls = [];
  const exec = (args, opts) => { calls.push(args); return runGit(args, opts); };
  const opts = { cacheDir: f.cacheDir, exec };
  const count = (word) => calls.filter((a) => a.includes(word)).length;

  const first = await observeRemote(f.repo.bare, opts);
  assert.equal(count("fetch"), 1, "first observe fetches once");
  assert.equal(count("ls-remote"), 1);

  const second = await observeRemote(f.repo.bare, opts);
  assert.equal(second.commit, first.commit);
  assert.equal(count("fetch"), 1, "second observe of the default branch re-lists but does not refetch");
  assert.equal(count("ls-remote"), 2, "a symbolic ref is always re-resolved against the remote");

  await observeRemote(f.repo.bare, { ...opts, at: first.commit });
  assert.equal(count("fetch"), 1, "a full OID already cached costs no fetch");
  assert.equal(count("ls-remote"), 2, "…and no ls-remote either");

  // Reads reuse the same cache (no fetch), and a new commit fetches exactly once more.
  await readRemoteFile(f.repo.bare, first.commit, "README.md", opts);
  await listRemoteTree(f.repo.bare, first.commit, "capabilities", opts);
  assert.equal(count("fetch"), 1);
  await readRemoteFile(f.repo.bare, f.c1, "README.md", opts);
  await readRemoteFile(f.repo.bare, f.c1, "capabilities/nw-tool/oats.json", opts);
  assert.equal(count("fetch"), 2);
});

// ---------------------------------------------------------------------------
// readRemoteFile
// ---------------------------------------------------------------------------

test("readRemoteFile returns bytes and size; missing → E_REMOTE_PATH_MISSING; oversize → E_REMOTE_FILE_OVERSIZE", async () => {
  const f = fixture();
  const opts = { cacheDir: f.cacheDir };
  const r = await readRemoteFile(f.repo.bare, f.c1, "README.md", opts);
  assert.ok(Buffer.isBuffer(r.bytes));
  assert.equal(r.bytes.toString(), "# hello\n"); assert.equal(r.size, 8);
  assert.equal((await readRemoteFile(f.repo.bare, f.c2, "README.md", opts)).bytes.toString(), "# hello again\n", "the commit selects the state");
  assert.equal((await readRemoteFile(f.repo.bare, f.c1, "./capabilities/nw-tool//oats.json", opts)).size, 25, "paths are normalized");

  const missing = await caughtAsync(readRemoteFile(f.repo.bare, f.c1, "capabilities/nope/oats.json", opts));
  assert.equal(missing.code, "E_REMOTE_PATH_MISSING"); assert.equal(missing.details.path, "capabilities/nope/oats.json");
  const isDir = await caughtAsync(readRemoteFile(f.repo.bare, f.c1, "capabilities", opts));
  assert.equal(isDir.code, "E_REMOTE_PATH_MISSING", "a directory is not a file");
  const escape = await caughtAsync(readRemoteFile(f.repo.bare, f.c1, "../etc/passwd", opts));
  assert.equal(escape.code, "E_REPO_REF");
  const badCommit = await caughtAsync(readRemoteFile(f.repo.bare, "v1.0.0", "README.md", opts));
  assert.equal(badCommit.code, "E_REPO_REF", "commit must be a full OID");

  const big = f.repo.commit("big", (w) => write(w, "big.bin", Buffer.alloc(FILE_BUDGET + 1, 7)));
  const over = await caughtAsync(readRemoteFile(f.repo.bare, big, "big.bin", opts));
  assert.equal(over.code, "E_REMOTE_FILE_OVERSIZE");
  assert.deepEqual({ path: over.details.path, size: over.details.size, budget: over.details.budget }, { path: "big.bin", size: FILE_BUDGET + 1, budget: FILE_BUDGET });
});

// ---------------------------------------------------------------------------
// listRemoteTree
// ---------------------------------------------------------------------------

test("listRemoteTree lists relative entries bounded by depth; missing dir → []", async () => {
  const f = fixture();
  const opts = { cacheDir: f.cacheDir };
  const depth1 = await listRemoteTree(f.repo.bare, f.c1, "capabilities/nw-tool", { ...opts, depth: 1 });
  assert.deepEqual(depth1, [
    { path: "bin", type: "tree" }, { path: "deep", type: "tree" }, { path: "oats.json", type: "blob", size: 25 }, { path: "skills", type: "tree" },
  ]);
  const depth2 = await listRemoteTree(f.repo.bare, f.c1, "capabilities/nw-tool", opts);
  assert.deepEqual(depth2.map((e) => e.path), ["bin", "bin/run.mjs", "deep", "deep/a", "oats.json", "skills", "skills/cut"]);
  const root = await listRemoteTree(f.repo.bare, f.c1, "", { ...opts, depth: 1 });
  assert.deepEqual(root.map((e) => e.path), ["README.md", "capabilities"]);
  assert.deepEqual(await listRemoteTree(f.repo.bare, f.c1, "nope/nowhere", opts), []);
  assert.deepEqual(await listRemoteTree(f.repo.bare, f.c1, "README.md", opts), [], "a file is not a dir");
});

// ---------------------------------------------------------------------------
// fetchRemoteTree + contentDigest
// ---------------------------------------------------------------------------

test("fetchRemoteTree copies the subtree; digest equals contentDigest of a manual checkout", async () => {
  const f = fixture();
  const dest = join(f.base, "out", "nw-tool");
  const r = await fetchRemoteTree(f.repo.bare, f.c1, "capabilities/nw-tool", dest, { cacheDir: f.cacheDir });
  assert.equal(r.files, 4);
  assert.match(r.digest, /^sha256-[0-9a-f]{64}$/);
  assert.ok(r.bytes > 0);
  assert.equal(readFileSync(join(dest, "skills/cut/SKILL.md"), "utf8"), "---\nname: cut\n---\nbody\n");
  assert.equal(statSync(join(dest, "bin/run.mjs")).mode & 0o111, 0o111, "exec bit preserved");
  assert.equal(statSync(join(dest, "oats.json")).mode & 0o111, 0, "non-exec stays non-exec");
  assert.equal(contentDigest(dest), r.digest, "digest over the materialized copy");

  // A manual checkout of the same commit digests identically (mode is git-normalized).
  const checkout = join(f.base, "checkout");
  git(f.base, "clone", "-q", f.repo.bare, checkout);
  git(checkout, "checkout", "-q", f.c1);
  assert.equal(contentDigest(join(checkout, "capabilities/nw-tool")), r.digest);
  assert.notEqual(contentDigest(join(checkout, "capabilities")), r.digest, "different tree → different digest");

  // Whole-tree fetch (dir = "") and content sensitivity.
  const whole = await fetchRemoteTree(f.repo.bare, f.c2, "", join(f.base, "out", "whole"), { cacheDir: f.cacheDir });
  assert.equal(whole.files, 5);
  assert.equal(contentDigest(join(f.base, "out", "whole")), whole.digest);
  const wholeC1 = await fetchRemoteTree(f.repo.bare, f.c1, ".", join(f.base, "out", "whole1"), { cacheDir: f.cacheDir });
  assert.notEqual(wholeC1.digest, whole.digest, "README changed between c1 and c2");
});

test("fetchRemoteTree refuses an existing destDir and a missing dir, leaving nothing behind", async () => {
  const f = fixture();
  const opts = { cacheDir: f.cacheDir };
  const exists = join(f.base, "exists"); mkdirSync(exists);
  await assert.rejects(fetchRemoteTree(f.repo.bare, f.c1, "capabilities", exists, opts), (e) => e.code === "E_REMOTE_TREE_UNSAFE" && e.details.why === "exists");
  const dest = join(f.base, "out2", "x");
  const e = await caughtAsync(fetchRemoteTree(f.repo.bare, f.c1, "capabilities/nope", dest, opts));
  assert.equal(e.code, "E_REMOTE_PATH_MISSING"); assert.equal(e.details.path, "capabilities/nope");
  assert.ok(!existsSync(dest));
  assert.deepEqual(existsSync(join(f.base, "out2")) ? readdirSync(join(f.base, "out2")) : [], [], "no staging dir left");
});

test("fetchRemoteTree refuses a symlink in the tree (E_REMOTE_TREE_UNSAFE symlink) without writing", async () => {
  const f = fixture();
  const c = f.repo.commit("link", (w) => { symlinkSync("oats.json", join(w, "capabilities/nw-tool/alias.json")); });
  const dest = join(f.base, "out3", "nw-tool");
  const e = await caughtAsync(fetchRemoteTree(f.repo.bare, c, "capabilities/nw-tool", dest, { cacheDir: f.cacheDir }));
  assert.equal(e.code, "E_REMOTE_TREE_UNSAFE");
  assert.deepEqual({ path: e.details.path, why: e.details.why }, { path: "capabilities/nw-tool/alias.json", why: "symlink" });
  assert.ok(!existsSync(dest)); assert.ok(!existsSync(join(f.base, "out3")) || readdirSync(join(f.base, "out3")).length === 0);

  const read = await caughtAsync(readRemoteFile(f.repo.bare, c, "capabilities/nw-tool/alias.json", { cacheDir: f.cacheDir }));
  assert.equal(read.code, "E_REMOTE_TREE_UNSAFE"); assert.equal(read.details.why, "symlink");
  const listed = await listRemoteTree(f.repo.bare, c, "capabilities/nw-tool", { cacheDir: f.cacheDir, depth: 1 });
  assert.deepEqual(listed.find((x) => x.path === "alias.json"), { path: "alias.json", type: "symlink", size: 9 });
});

test("contentDigest is canonical: order-independent, mode-normalized, refuses symlinks, missing dir → E_REMOTE_PATH_MISSING", () => {
  const base = scratch();
  const a = join(base, "a"), b = join(base, "b");
  write(a, "z.txt", "z"); write(a, "sub/y.txt", "y"); write(a, "x.sh", "#!/bin/sh\n"); chmodSync(join(a, "x.sh"), 0o700);
  mkdirSync(join(a, "empty-dir"));
  write(b, "sub/y.txt", "y"); write(b, "x.sh", "#!/bin/sh\n"); chmodSync(join(b, "x.sh"), 0o755); write(b, "z.txt", "z");
  assert.equal(contentDigest(a), contentDigest(b), "umask/extra mode bits and empty dirs do not enter identity");
  chmodSync(join(b, "x.sh"), 0o644);
  assert.notEqual(contentDigest(a), contentDigest(b), "the exec bit does");
  write(b, "z.txt", "zz");
  assert.notEqual(contentDigest(a), contentDigest(b));
  const empty = join(base, "empty"); mkdirSync(empty);
  assert.equal(contentDigest(empty), `sha256-${"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}`, "empty tree digests the empty input");

  symlinkSync("z.txt", join(a, "link"));
  const e = caught(() => contentDigest(a));
  assert.equal(e.code, "E_REMOTE_TREE_UNSAFE"); assert.deepEqual({ path: e.details.path, why: e.details.why }, { path: "link", why: "symlink" });
  assert.equal(caught(() => contentDigest(join(base, "nope"))).code, "E_REMOTE_PATH_MISSING");
  assert.equal(caught(() => contentDigest("relative")).code, "E_REPO_REF");
});

// ---------------------------------------------------------------------------
// adversarial review regressions
// ---------------------------------------------------------------------------

/** Push a commit whose tree carries hand-crafted entry names (git's transport does not fsck them). */
function craftedCommit(repo, entries) {
  const w = repo.work;
  const run = (input, ...args) => execFileSync("git", args, { cwd: w, env: GIT_ENV, input, stdio: ["pipe", "pipe", "pipe"] }).toString("utf8").trim();
  const blob = run("evil\n", "hash-object", "-w", "--stdin");
  const raw = Buffer.concat(entries.map(({ mode, name, oid }) => Buffer.concat([Buffer.from(`${mode} ${name}\0`), Buffer.from(oid ?? blob, "hex")])));
  const tree = run(raw, "hash-object", "-w", "-t", "tree", "--stdin", "--literally");
  const commit = run("", "commit-tree", tree, "-m", "crafted");
  git(w, "push", "-q", "origin", `${commit}:refs/heads/crafted-${commit.slice(0, 8)}`);
  return commit;
}

test("HIGH: fetchRemoteTree refuses tree entry names that escape or subvert the checkout (../, .., .git, backslash) before writing", async () => {
  const f = fixture();
  const opts = { cacheDir: f.cacheDir };
  const top = join(f.base, "top");
  const cases = [
    [{ mode: "100644", name: "../../escape.txt" }, { mode: "100644", name: "ok.txt" }],
    [{ mode: "040000", name: "..", oid: git(f.repo.work, "rev-parse", `${f.c1}^{tree}`) }, { mode: "100644", name: "ok.txt" }],
    [{ mode: "100644", name: ".git" }, { mode: "100644", name: "ok.txt" }],
    [{ mode: "100644", name: ".GIT" }],
    [{ mode: "100644", name: "a\\b.txt" }],
  ];
  for (const entries of cases) {
    const c = craftedCommit(f.repo, entries);
    const dest = join(top, "inner", "dest");
    const e = await caughtAsync(fetchRemoteTree(f.repo.bare, c, "", dest, opts));
    assert.equal(e.code, "E_REMOTE_TREE_UNSAFE", entries[0].name);
    assert.equal(e.details.why, "path");
    assert.ok(!existsSync(top), `nothing written for ${entries[0].name}`);
    // listRemoteTree refuses the same names AT a kept depth (deep enough to see every crafted entry).
    const listed = await caughtAsync(listRemoteTree(f.repo.bare, c, "", { ...opts, depth: 8 }));
    assert.equal(listed.code, "E_REMOTE_TREE_UNSAFE", "listRemoteTree refuses the same names");
  }
});

test("L3: listRemoteTree filters by depth BEFORE the entry-name check — one deep unsafe name does not blank the listing; an unsafe name at a kept depth is still refused", async () => {
  const f = fixture();
  const opts = { cacheDir: f.cacheDir };
  const w = f.repo.work;
  const run = (input, ...args) => execFileSync("git", args, { cwd: w, env: GIT_ENV, input, stdio: ["pipe", "pipe", "pipe"] }).toString("utf8").trim();
  const blob = run("x\n", "hash-object", "-w", "--stdin");
  const mkTree = (entries) => run(Buffer.concat(entries.map(({ mode, name, oid }) => Buffer.concat([Buffer.from(`${mode} ${name}\0`), Buffer.from(oid, "hex")]))), "hash-object", "-w", "-t", "tree", "--stdin", "--literally");
  // souls/a/soul.yaml (good) + souls/a/deep/bad\name.txt (unsafe, depth 3 under souls/)
  const deep = mkTree([{ mode: "100644", name: "bad\\name.txt", oid: blob }]);
  const a = mkTree([{ mode: "100644", name: "soul.yaml", oid: blob }, { mode: "040000", name: "deep", oid: deep }]);
  const souls = mkTree([{ mode: "040000", name: "a", oid: a }]);
  const root = mkTree([{ mode: "040000", name: "souls", oid: souls }]);
  const c = run("", "commit-tree", root, "-m", "deep-unsafe");
  git(w, "push", "-q", "origin", `${c}:refs/heads/deep-unsafe`);

  const listed = await listRemoteTree(f.repo.bare, c, "souls", { ...opts, depth: 2 });
  assert.deepEqual(listed.map((e) => e.path), ["a", "a/deep", "a/soul.yaml"], "the member's souls are listed; the deep bad name is below the requested depth");
  const e = await caughtAsync(listRemoteTree(f.repo.bare, c, "souls", { ...opts, depth: 3 }));
  assert.equal(e.code, "E_REMOTE_TREE_UNSAFE"); assert.equal(e.details.why, "path"); assert.equal(e.details.path, "souls/a/deep/bad\\name.txt");
  // fetchRemoteTree still inspects the WHOLE subtree: the deep bad name refuses the fetch.
  const fetched = await caughtAsync(fetchRemoteTree(f.repo.bare, c, "souls", join(f.base, "l3-out"), opts));
  assert.equal(fetched.code, "E_REMOTE_TREE_UNSAFE"); assert.equal(fetched.details.why, "path");
  assert.ok(!existsSync(join(f.base, "l3-out")));
});

test("MED: fetchRemoteTree refuses case-/normalization-colliding entries and a dangling-symlink destDir as oats errors", async () => {
  const f = fixture();
  const opts = { cacheDir: f.cacheDir };
  const c = craftedCommit(f.repo, [{ mode: "100644", name: "README.md" }, { mode: "100644", name: "readme.md" }]);
  const e = await caughtAsync(fetchRemoteTree(f.repo.bare, c, "", join(f.base, "col"), opts));
  assert.equal(e.code, "E_REMOTE_TREE_UNSAFE"); assert.equal(e.details.why, "collision"); assert.equal(e.details.other, "README.md");
  const nfd = craftedCommit(f.repo, [{ mode: "100644", name: "café.md".normalize("NFC") }, { mode: "100644", name: "café.md".normalize("NFD") }]);
  assert.equal((await caughtAsync(fetchRemoteTree(f.repo.bare, nfd, "", join(f.base, "col2"), opts))).details.why, "collision");
  assert.ok(!existsSync(join(f.base, "col")) && !existsSync(join(f.base, "col2")));

  const dangling = join(f.base, "dangling"); symlinkSync(join(f.base, "nowhere"), dangling);
  const d = await caughtAsync(fetchRemoteTree(f.repo.bare, f.c1, "capabilities", dangling, opts));
  assert.equal(d.code, "E_REMOTE_TREE_UNSAFE"); assert.equal(d.details.why, "exists");
});

test("HIGH: observeRemote refuses a tag or OID that names a tree/blob, and readRemoteFile refuses a non-commit OID", async () => {
  const f = fixture();
  const opts = { cacheDir: f.cacheDir };
  const tree = git(f.repo.work, "rev-parse", `${f.c1}^{tree}`);
  const blob = git(f.repo.work, "rev-parse", `${f.c1}:README.md`);
  git(f.repo.work, "tag", "treetag", tree); git(f.repo.work, "tag", "blobtag", blob);
  git(f.repo.work, "push", "-q", "origin", "refs/tags/treetag", "refs/tags/blobtag");
  for (const at of ["treetag", "blobtag", tree, blob]) {
    const e = await caughtAsync(observeRemote(f.repo.bare, { ...opts, at }));
    assert.equal(e.code, "E_REMOTE_UNREADABLE", at); assert.equal(e.details.reason, "not-found");
    assert.ok(["tree", "blob"].includes(e.details.type), `type reported (${e.details.type})`);
  }
  assert.equal((await caughtAsync(readRemoteFile(f.repo.bare, tree, "README.md", opts))).code, "E_REMOTE_UNREADABLE");
  const [hash] = readdirSync(f.cacheDir);
  assert.equal(git(join(f.cacheDir, hash), "for-each-ref", "refs/oats/"), "", "no pin for a non-commit");
});

test("MED: concurrent observes of one key never surface raw git errors; a wiped object store is refetched, not trusted", async () => {
  const f = fixture();
  const opts = { cacheDir: f.cacheDir };
  const c3 = f.repo.commit("three", (w) => write(w, "c.txt", "c\n"));
  const results = await Promise.all([f.c1, f.c2, c3, f.c1, f.c2, c3].map((at) => observeRemote(f.repo.bare, { ...opts, at }).then((r) => r.commit, (e) => `${e.code}/${e.details?.reason}`)));
  assert.deepEqual(results, [f.c1, f.c2, c3, f.c1, f.c2, c3]);

  // pin survives, objects gone → the cache must not claim the remote lacks a.txt / README.md
  const [hash] = readdirSync(f.cacheDir);
  rmSync(join(f.cacheDir, hash, "objects"), { recursive: true, force: true }); mkdirSync(join(f.cacheDir, hash, "objects"));
  const calls = [];
  const exec = (args, o) => { calls.push(args); return runGit(args, o); };
  const r = await readRemoteFile(f.repo.bare, f.c1, "README.md", { ...opts, exec });
  assert.equal(r.bytes.toString(), "# hello\n");
  assert.equal(calls.filter((a) => a.includes("fetch")).length, 1, "refetched once");
});

test("MED: ssh always runs in BatchMode even when the operator set GIT_SSH_COMMAND", async () => {
  const { sshCommand } = await import("../lib/remote.mjs");
  const cmd = sshCommand();
  assert.match(cmd, /-o BatchMode=yes/);
  if (process.env.GIT_SSH_COMMAND) assert.ok(cmd.startsWith(process.env.GIT_SSH_COMMAND.trim()), "operator's command is kept as the base");
});

test("LOW: `at` must be a plain ref name or full OID (no options, revision syntax or arrays); parsed ref objects are re-validated", async () => {
  const f = fixture();
  const opts = { cacheDir: f.cacheDir };
  for (const at of ["--upload-pack=touch /tmp/x", "HEAD^", "main~1", "main^{tree}", "*", "refs/heads/*", "  main  ", ["main"], 42, "a..b", "-x"]) {
    const e = await caughtAsync(observeRemote(f.repo.bare, { ...opts, at }));
    assert.equal(e.code, "E_REPO_REF", JSON.stringify(at));
  }
  assert.equal((await observeRemote(f.repo.bare, { ...opts, at: "v1.0.0" })).commit, f.c1, "ordinary tags still resolve");
  const e = caught(() => parseRepoRef({ key: "../../x", url: "ext::sh -c id" }));
  assert.equal(e.code, "E_REPO_REF");
  const bad = caught(() => parseRepoRef({ key: "github.com/other/repo", url: "https://github.com/org/repo.git" }));
  assert.match(bad.message, /inconsistent/);
});

test("LOW: contentDigest ignores a top-level .git directory (a local checkout digests like the fetched tree)", () => {
  const f = fixture();
  const checkout = join(f.base, "checkout");
  git(f.base, "clone", "-q", f.repo.bare, checkout);
  git(checkout, "checkout", "-q", f.c1);
  const copy = join(f.base, "copy");
  mkdirSync(copy);
  for (const rel of ["README.md", "capabilities/nw-tool/oats.json", "capabilities/nw-tool/skills/cut/SKILL.md", "capabilities/nw-tool/bin/run.mjs", "capabilities/nw-tool/deep/a/b/c.txt"]) {
    write(copy, rel, readFileSync(join(checkout, rel)));
  }
  chmodSync(join(copy, "capabilities/nw-tool/bin/run.mjs"), 0o755);
  assert.equal(contentDigest(checkout), contentDigest(copy));
});

// ---------------------------------------------------------------------------
// post-0.25.0 fixes (M2, M4, L4)
// ---------------------------------------------------------------------------

test("M2: the fetch url is the form written — an ssh ref is fetched over ssh, the bare git: scheme follows remoteOptions.transport, and every form shares ONE cache keyed by identity", async () => {
  const base = scratch();
  const calls = [];
  // A fake exec: records the url handed to ls-remote/fetch and answers as an unreachable host
  // (no real network). What matters is WHICH url git was asked for.
  const exec = async (args) => {
    calls.push(args);
    if (args[0] === "init") { execFileSync("git", args, { env: GIT_ENV, stdio: "ignore" }); return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }; }
    if (args.includes("rev-parse")) { const e = new Error("missing"); e.code = 128; e.stderr = Buffer.from("fatal: Needed a single revision"); throw e; }
    const e = new Error("fail"); e.code = 128; e.stderr = Buffer.from("ssh: Could not resolve hostname example.invalid"); throw e;
  };
  const cacheDir = join(base, "cache");
  const urlOf = (word) => calls.filter((a) => a.includes(word)).map((a) => a[a.indexOf(word) + (word === "fetch" ? 6 : 2)]);
  const oid = "0123456789abcdef0123456789abcdef01234567";

  const sshRef = "git@example.invalid:org/repo.git";
  const e1 = await caughtAsync(observeRemote(sshRef, { cacheDir, exec }));
  assert.equal(e1.code, "E_REMOTE_UNREADABLE"); assert.equal(e1.details.url, sshRef, "the error names the ssh url as written");
  assert.deepEqual(urlOf("ls-remote"), [sshRef], "ls-remote asked the SSH url, not an https rewrite");
  await caughtAsync(observeRemote(sshRef, { cacheDir, exec, at: oid }));
  assert.deepEqual(urlOf("fetch"), [sshRef], "fetch asked the SSH url too");

  calls.length = 0;
  await caughtAsync(observeRemote("git:example.invalid/org/repo", { cacheDir, exec }));
  assert.deepEqual(urlOf("ls-remote"), ["https://example.invalid/org/repo.git"], "bare git: scheme → https by default");
  calls.length = 0;
  await caughtAsync(observeRemote("git:example.invalid/org/repo", { cacheDir, exec, transport: "ssh" }));
  assert.deepEqual(urlOf("ls-remote"), ["git@example.invalid:org/repo.git"], "…and ssh when remoteOptions.transport asks for it");
  calls.length = 0;
  await caughtAsync(observeRemote("https://example.invalid/org/repo", { cacheDir, exec, transport: "ssh" }));
  assert.deepEqual(urlOf("ls-remote"), ["https://example.invalid/org/repo.git"], "an explicit https form is never rewritten to ssh");

  // ONE cache repo for the identity, whatever the transport: the cache is keyed by `key`.
  assert.equal(readdirSync(cacheDir).length, 1, "ssh/https/git: forms of one repo share one cache dir");
  assert.equal(caught(() => parseRepoRef("git:example.invalid/org/repo", { transport: "rsync" })).code, "E_REPO_REF");
});

test("M4: an annotated tag's own OID given as `at` is accepted but the PEELED commit is what gets recorded (result, pin, errors)", async () => {
  const f = fixture();
  const opts = { cacheDir: f.cacheDir };
  const tagOid = git(f.repo.work, "rev-parse", "refs/tags/v1.0.0-annotated");
  assert.equal(git(f.repo.work, "cat-file", "-t", tagOid), "tag");
  assert.notEqual(tagOid, f.c1);

  const obs = await observeRemote(f.repo.bare, { ...opts, at: tagOid });
  assert.equal(obs.commit, f.c1, "observeRemote records the peeled commit, not the tag OID");
  assert.equal(obs.ref, null);
  const [hash] = readdirSync(f.cacheDir);
  const pins = git(join(f.cacheDir, hash), "for-each-ref", "--format=%(refname) %(objectname)", "refs/oats/").split("\n");
  assert.ok(pins.includes(`refs/oats/commits/${f.c1} ${f.c1}`), `the pin is on the commit: ${pins}`);
  assert.ok(!pins.includes(`refs/oats/commits/${tagOid} ${tagOid}`), "the tag OID is never pinned as a commit");

  // The reads accept the tag OID too and use the peeled commit for the tree.
  assert.equal((await readRemoteFile(f.repo.bare, tagOid, "README.md", opts)).bytes.toString(), "# hello\n");
  assert.deepEqual((await listRemoteTree(f.repo.bare, tagOid, "", { ...opts, depth: 1 })).map((e) => e.path), ["README.md", "capabilities"]);
  const missing = await caughtAsync(fetchRemoteTree(f.repo.bare, tagOid, "nope", join(f.base, "m4"), opts));
  assert.equal(missing.code, "E_REMOTE_PATH_MISSING"); assert.equal(missing.details.commit, f.c1, "errors carry the peeled commit");
  const r = await fetchRemoteTree(f.repo.bare, tagOid, "capabilities/nw-tool", join(f.base, "m4-ok"), opts);
  assert.equal(r.files, 4);

  // A second observe of the tag OID is a cache hit (the tag object is pinned alongside).
  const calls = [];
  const exec = (a, o) => { calls.push(a); return runGit(a, o); };
  assert.equal((await observeRemote(f.repo.bare, { ...opts, exec, at: tagOid })).commit, f.c1);
  assert.equal(calls.filter((a) => a.includes("fetch")).length, 0, "no refetch");
  // A tag of a tree/blob still does not peel to a commit → refused (unchanged).
  const tree = git(f.repo.work, "rev-parse", `${f.c1}^{tree}`);
  git(f.repo.work, "tag", "-a", "treetag-a", "-m", "t", tree); git(f.repo.work, "push", "-q", "origin", "refs/tags/treetag-a");
  const treeTagOid = git(f.repo.work, "rev-parse", "refs/tags/treetag-a");
  const bad = await caughtAsync(observeRemote(f.repo.bare, { ...opts, at: treeTagOid }));
  assert.equal(bad.code, "E_REMOTE_UNREADABLE"); assert.equal(bad.details.reason, "not-found"); assert.equal(bad.details.type, "tag");
});

test("L4: a maxBuffer overflow is NOT a timeout; a timeout kill is; an unclassified ls-tree failure becomes E_REMOTE_UNREADABLE { reason: unknown }, never a raw error", async () => {
  const { classifyRemoteFailure } = await import("../lib/remote.mjs");
  const f = fixture();
  const opts = { cacheDir: f.cacheDir };
  const blob = git(f.repo.work, "rev-parse", `${f.c1}:README.md`);

  // 1. overflow: Node kills the child, but that is not the timeout.
  const over = await caughtAsync(runGit(["-C", f.repo.bare, "cat-file", "blob", blob], { maxBuffer: 1 }));
  assert.equal(over.overflowed, true); assert.equal(over.timedOut, false);
  assert.notEqual(classifyRemoteFailure(over), "timeout", "overflow never reads as timeout");
  // 2. a real timeout kill is a timeout.
  const slow = await caughtAsync(runGit(["-C", f.repo.bare, "log", "--all", "-p", "--stdin"], { timeout: 50 }));
  assert.equal(slow.timedOut, true); assert.equal(slow.overflowed, false);
  assert.equal(classifyRemoteFailure(slow), "timeout");
  // Synthetic shapes classifyRemoteFailure must get right.
  assert.equal(classifyRemoteFailure({ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", killed: true, signal: "SIGKILL", stderr: Buffer.alloc(0) }), "network", "a maxBuffer kill is not a timeout even when Node reports killed/signal");
  assert.equal(classifyRemoteFailure({ killed: true, signal: "SIGKILL", stderr: Buffer.alloc(0) }), "timeout");

  // 3. an unclassified listing failure surfaces as E_REMOTE_UNREADABLE unknown (enumerateRepo → problem row).
  const overflowLs = (args, o) => args.includes("ls-tree") ? runGit(args, { ...o, maxBuffer: 1 }) : runGit(args, o);
  const e = await caughtAsync(listRemoteTree(f.repo.bare, f.c1, "", { ...opts, exec: overflowLs }));
  assert.equal(e.code, "E_REMOTE_UNREADABLE"); assert.equal(e.details.reason, "unknown"); assert.equal(e.details.overflowed, true);
  assert.equal(e.details.key, `local/${f.repo.bare}`); assert.equal(e.details.commit, f.c1);
  const crash = (args, o) => { if (args.includes("ls-tree")) { const x = new Error("boom"); x.code = 137; x.stderr = Buffer.from("fatal: something git never said before"); return Promise.reject(x); } return runGit(args, o); };
  const e2 = await caughtAsync(fetchRemoteTree(f.repo.bare, f.c1, "", join(f.base, "l4"), { ...opts, exec: crash }));
  assert.equal(e2.code, "E_REMOTE_UNREADABLE"); assert.equal(e2.details.reason, "unknown"); assert.match(e2.message, /something git never said before/);
  assert.ok(!existsSync(join(f.base, "l4")));
  const e3 = await caughtAsync(readRemoteFile(f.repo.bare, f.c1, "README.md", { ...opts, exec: crash }));
  assert.equal(e3.code, "E_REMOTE_UNREADABLE"); assert.equal(e3.details.reason, "unknown");
  // A missing tree still answers the contract's shapes, not "unknown".
  assert.deepEqual(await listRemoteTree(f.repo.bare, f.c1, "nope", opts), []);
});
