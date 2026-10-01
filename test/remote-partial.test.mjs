/** lib/remote.mjs — partial fetches into the cache (awebai/oats#384): a commit arrives with its trees and only
 * the blobs up to SMALL_BLOB_LIMIT; a read or a materialization fetches the larger blobs it needs, one batched
 * fetch per request; a server that cannot serve that gets whole trees, recorded per cache and said once; git
 * never fetches lazily. Tests build SMALL repos inline. */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  contentDigest, createReadSession, fetchRemoteTree, listRemoteTree, observeRemote, parseRepoRef, readRemoteFile, runGit,
  FILE_BUDGET, SMALL_BLOB_LIMIT,
} from "../lib/remote.mjs";

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" };
const git = (cwd, ...args) => execFileSync("git", args, { cwd, env: GIT_ENV, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 }).toString("utf8").trim();
const gitInput = (cwd, input, ...args) => execFileSync("git", args, { cwd, env: { ...GIT_ENV, GIT_NO_LAZY_FETCH: "1" }, input, stdio: ["pipe", "pipe", "pipe"] }).toString("utf8").trim();

const roots = [];
function scratch() { const d = mkdtempSync(join(tmpdir(), "oats-remote-partial-")); roots.push(d); return d; }
test.after(() => { for (const d of roots) rmSync(d, { recursive: true, force: true }); });

const write = (dir, rel, content) => { mkdirSync(join(dir, rel, ".."), { recursive: true }); writeFileSync(join(dir, rel), content); };
/** `n` bytes that do not compress, the same for the same seed. */
function noise(n, seed = "oats") {
  const out = Buffer.alloc(n);
  let h = createHash("sha256").update(seed).digest();
  for (let i = 0; i < n; i += 32) { h = createHash("sha256").update(h).digest(); h.copy(out, i); }
  return out;
}

/** A bare remote whose server is configured by `server` ("partial": serves filters and blob wants, as GitHub
 *  does; "plain": a default git, no filters; "no-blob-wants": filters, but protocol v0 without
 *  allowAnySHA1InWant, so it refuses a want of a blob by id). The tree: small files the kernel would read, a
 *  module dir with one large file, and large files nothing reads. */
function fixture(server = "partial") {
  const base = scratch();
  const bare = join(base, "remote.git"), work = join(base, "work");
  git(base, "init", "-q", "--bare", "-b", "main", bare);
  if (server !== "plain") git(bare, "config", "uploadpack.allowFilter", "true");
  if (server === "partial") git(bare, "config", "uploadpack.allowAnySHA1InWant", "true");
  git(base, "init", "-q", "-b", "main", work);
  git(work, "remote", "add", "origin", bare);
  write(work, "oats-membership.yaml", "schemaVersion: 2\n");
  write(work, "souls/dev/soul.yaml", "name: dev\n");
  write(work, "souls/dev/AGENTS.md", "# dev\n");
  write(work, "elsewhere/tools/oats.json", "{\"capability\":\"tools\"}\n");
  write(work, "elsewhere/tools/data/model.bin", noise(SMALL_BLOB_LIMIT * 3, "model"));
  write(work, "assets/huge-1.bin", noise(SMALL_BLOB_LIMIT * 4, "huge-1"));
  write(work, "assets/huge-2.bin", noise(SMALL_BLOB_LIMIT * 4, "huge-2"));
  git(work, "add", "-A");
  git(work, "commit", "-q", "-m", "one");
  git(work, "push", "-q", "origin", "HEAD:main");
  const commit = git(work, "rev-parse", "HEAD");
  const blob = (path) => git(work, "rev-parse", `HEAD:${path}`);
  const cacheDir = join(base, "cache");
  const repoDir = join(cacheDir, createHash("sha256").update(parseRepoRef(bare).key).digest("hex"));
  /** Which of `paths` have their blob in the cache (never fetching one to find out). */
  const present = (...paths) => Object.fromEntries(paths.map((p) => [p, !gitInput(repoDir, `${blob(p)}\n`, "cat-file", "--batch-check").endsWith(" missing")]));
  return { base, bare, work, commit, blob, cacheDir, repoDir, present };
}

/** The fetches an exec wrapper saw, and what each asked for on stdin. */
function counting() {
  const fetches = [];
  const exec = (args, o) => { if (args.includes("fetch")) fetches.push({ args, input: o?.input ?? null }); return runGit(args, o); };
  return { fetches, exec };
}

/** Run `fn` with git's global config replaced by `text` (the cache's git reads it, as an operator's would). */
async function withGlobalGitConfig(base, text, fn) {
  const file = join(base, "global.gitconfig");
  writeFileSync(file, text);
  const saved = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = file;
  try { return await fn(); } finally { if (saved === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = saved; }
}

// ---------------------------------------------------------------------------
// a server that serves partial fetches
// ---------------------------------------------------------------------------

test("a commit arrives with its trees and its small blobs only; the cache never stores the url", async () => {
  const f = fixture();
  const obs = await observeRemote(f.bare, { cacheDir: f.cacheDir });
  assert.equal(obs.commit, f.commit);
  assert.deepEqual(f.present("oats-membership.yaml", "souls/dev/soul.yaml", "elsewhere/tools/oats.json", "elsewhere/tools/data/model.bin", "assets/huge-1.bin"),
    { "oats-membership.yaml": true, "souls/dev/soul.yaml": true, "elsewhere/tools/oats.json": true, "elsewhere/tools/data/model.bin": false, "assets/huge-1.bin": false });
  assert.equal(git(f.repoDir, "config", "--get", "oats.fetch"), "partial");
  assert.equal(git(f.repoDir, "config", "--get", "remote.origin.promisor"), "true");
  assert.throws(() => git(f.repoDir, "config", "--get-all", "remote.origin.url"), "the url (it may carry credentials) is never written");
});

test("listing never needs a blob: complete listings, no fetch, and rows carry no size", async () => {
  const f = fixture();
  const { fetches, exec } = counting();
  const opts = { cacheDir: f.cacheDir, exec };
  const listed = await listRemoteTree(f.bare, f.commit, "", { ...opts, depth: 3 });
  assert.deepEqual(listed.map((r) => r.path), ["assets", "assets/huge-1.bin", "assets/huge-2.bin", "elsewhere", "elsewhere/tools", "elsewhere/tools/data",
    "elsewhere/tools/oats.json", "oats-membership.yaml", "souls", "souls/dev", "souls/dev/AGENTS.md", "souls/dev/soul.yaml"]);
  assert.ok(listed.every((r) => !("size" in r)), "no row carries a size");
  assert.equal(fetches.length, 1, "only the commit's own fetch");
});

test("reading a small file costs no fetch; reading a large one fetches exactly that blob", async () => {
  for (const withSession of [false, true]) {
    const f = fixture();
    const { fetches, exec } = counting();
    const session = withSession ? createReadSession() : undefined;
    const opts = { cacheDir: f.cacheDir, exec, ...(session ? { session } : {}) };
    try {
      assert.equal((await readRemoteFile(f.bare, f.commit, "souls/dev/soul.yaml", opts)).bytes.toString(), "name: dev\n");
      assert.equal(fetches.length, 1, "the commit's fetch only");
      const big = await readRemoteFile(f.bare, f.commit, "elsewhere/tools/data/model.bin", opts);
      assert.ok(big.bytes.equals(noise(SMALL_BLOB_LIMIT * 3, "model")));
      assert.equal(fetches.length, 2, "one more fetch, for that blob");
      assert.equal(fetches[1].input, `${f.blob("elsewhere/tools/data/model.bin")}\n`);
      assert.deepEqual(f.present("assets/huge-1.bin"), { "assets/huge-1.bin": false }, "nothing else came with it");
      await readRemoteFile(f.bare, f.commit, "elsewhere/tools/data/model.bin", opts);
      assert.equal(fetches.length, 2, "a blob already fetched is never fetched again");
    } finally { await session?.close(); }
  }
});

test("materializing a directory fetches its missing blobs in ONE fetch, and digests like a checkout", async () => {
  const f = fixture();
  const { fetches, exec } = counting();
  const opts = { cacheDir: f.cacheDir, exec };
  await observeRemote(f.bare, { ...opts, at: f.commit });
  const dest = join(f.base, "out", "tools");
  const r = await fetchRemoteTree(f.bare, f.commit, "elsewhere/tools", dest, opts);
  assert.equal(fetches.length, 2, "the commit, then one fetch for the directory");
  assert.equal(r.digest, contentDigest(join(f.work, "elsewhere", "tools")));
  assert.equal(r.files, 2);
  assert.deepEqual(f.present("assets/huge-1.bin", "assets/huge-2.bin"), { "assets/huge-1.bin": false, "assets/huge-2.bin": false });
});

test("an unknown size never passes a budget: a missing blob is fetched, then FILE_BUDGET and TREE_BUDGET apply before any write", async () => {
  const f = fixture();
  write(f.work, "big/over.bin", noise(FILE_BUDGET + 1, "over"));
  git(f.work, "add", "-A"); git(f.work, "commit", "-q", "-m", "two"); git(f.work, "push", "-q", "origin", "HEAD:main");
  const c2 = git(f.work, "rev-parse", "HEAD");
  const opts = { cacheDir: f.cacheDir };
  await observeRemote(f.bare, { ...opts, at: c2 });
  // What git itself reports for a blob the cache lacks: the size is "BAD", and the listing still succeeds.
  assert.match(gitInput(f.repoDir, "", "ls-tree", "-l", c2, "big/over.bin"), /\sBAD\tbig\/over\.bin$/);
  const e = await readRemoteFile(f.bare, c2, "big/over.bin", opts).then(() => assert.fail("expected oversize"), (x) => x);
  assert.equal(e.code, "E_REMOTE_FILE_OVERSIZE");
  assert.equal(e.details.size, FILE_BUDGET + 1);
  // fetchRemoteTree: the sizes it budgets are the fetched blobs' real sizes, never NaN.
  const { fetches, exec } = counting();
  const dest = join(f.base, "out", "big");
  const r = await fetchRemoteTree(f.bare, c2, "big", dest, { ...opts, exec });
  assert.equal(r.bytes, FILE_BUDGET + 1);
  assert.equal(fetches.length, 0, "the blob fetched for the refused read is not fetched again");
});

test("a read whose blob was not fetched fails loudly: git never fetches lazily from a cache", async () => {
  const f = fixture();
  await observeRemote(f.bare, { cacheDir: f.cacheDir });
  const e = await runGit(["-C", f.repoDir, "cat-file", "blob", f.blob("assets/huge-1.bin")]).then(() => assert.fail("expected a failure"), (x) => x);
  assert.match(e.stderr.toString(), new RegExp(`${f.blob("assets/huge-1.bin")}: bad file`));
  assert.deepEqual(f.present("assets/huge-1.bin"), { "assets/huge-1.bin": false }, "and nothing was fetched");
});

test("a cache filled by whole-tree fetches keeps working and fetches the next commit partially", async () => {
  const f = fixture();
  mkdirSync(f.repoDir, { recursive: true });
  git(f.base, "init", "-q", "--bare", f.repoDir);
  git(f.repoDir, "fetch", "-q", "--depth", "1", "--no-tags", f.bare, f.commit);
  git(f.repoDir, "update-ref", `refs/oats/commits/${f.commit}`, f.commit);
  const { fetches, exec } = counting();
  const opts = { cacheDir: f.cacheDir, exec };
  assert.ok((await readRemoteFile(f.bare, f.commit, "assets/huge-1.bin", opts)).bytes.equals(noise(SMALL_BLOB_LIMIT * 4, "huge-1")));
  assert.equal(fetches.length, 0, "every blob is already there");
  write(f.work, "assets/huge-3.bin", noise(SMALL_BLOB_LIMIT * 4, "huge-3"));
  git(f.work, "add", "-A"); git(f.work, "commit", "-q", "-m", "two"); git(f.work, "push", "-q", "origin", "HEAD:main");
  const c2 = git(f.work, "rev-parse", "HEAD");
  await observeRemote(f.bare, { ...opts, at: c2 });
  assert.equal(git(f.repoDir, "config", "--get", "oats.fetch"), "partial");
  assert.equal(gitInput(f.repoDir, `${git(f.work, "rev-parse", "HEAD:assets/huge-3.bin")}\n`, "cat-file", "--batch-check").endsWith(" missing"), true);
});

// ---------------------------------------------------------------------------
// servers that cannot serve partial fetches
// ---------------------------------------------------------------------------

test("a server without filters: whole trees, recorded per cache, said once in the session's notices", async () => {
  const f = fixture("plain");
  const session = createReadSession();
  try {
    const opts = { cacheDir: f.cacheDir, session };
    assert.equal((await readRemoteFile(f.bare, f.commit, "elsewhere/tools/data/model.bin", opts)).bytes.length, SMALL_BLOB_LIMIT * 3);
    assert.deepEqual(f.present("assets/huge-1.bin"), { "assets/huge-1.bin": true }, "the whole tree arrived");
    assert.equal(git(f.repoDir, "config", "--get", "oats.fetch"), "full");
    write(f.work, "x.txt", "x\n");
    git(f.work, "add", "-A"); git(f.work, "commit", "-q", "-m", "two"); git(f.work, "push", "-q", "origin", "HEAD:main");
    await observeRemote(f.bare, { ...opts, at: git(f.work, "rev-parse", "HEAD") });
    assert.deepEqual(session.notices, [`${f.bare} does not serve partial fetches; OATS fetches whole trees from it`]);
  } finally { await session.close(); }
  // A later command does not say it again: the cache remembers.
  const later = createReadSession();
  try {
    await readRemoteFile(f.bare, f.commit, "souls/dev/soul.yaml", { cacheDir: f.cacheDir, session: later });
    assert.deepEqual(later.notices, []);
  } finally { await later.close(); }
});

test("a server that filters but refuses blob wants: the commit is fetched again in full, recorded, said once", async () => {
  const f = fixture("no-blob-wants");
  await withGlobalGitConfig(f.base, "[protocol]\n\tversion = 0\n", async () => {
    const session = createReadSession();
    try {
      const opts = { cacheDir: f.cacheDir, session };
      await observeRemote(f.bare, { ...opts, at: f.commit });
      assert.deepEqual(f.present("assets/huge-1.bin"), { "assets/huge-1.bin": false }, "the filter was honoured");
      const r = await readRemoteFile(f.bare, f.commit, "elsewhere/tools/data/model.bin", opts);
      assert.ok(r.bytes.equals(noise(SMALL_BLOB_LIMIT * 3, "model")));
      assert.equal(git(f.repoDir, "config", "--get", "oats.fetch"), "full");
      assert.deepEqual(f.present("assets/huge-1.bin"), { "assets/huge-1.bin": true }, "the refetch brought the whole tree");
      const dest = join(f.base, "out", "tools");
      assert.equal((await fetchRemoteTree(f.bare, f.commit, "elsewhere/tools", dest, opts)).digest, contentDigest(join(f.work, "elsewhere", "tools")));
      assert.deepEqual(session.notices, [`${f.bare} does not serve partial fetches; OATS fetches whole trees from it`]);
    } finally { await session.close(); }
  });
});

test("without a session a fallback is recorded and nothing is printed", async () => {
  const f = fixture("plain");
  assert.equal((await observeRemote(f.bare, { cacheDir: f.cacheDir })).commit, f.commit);
  assert.equal(git(f.repoDir, "config", "--get", "oats.fetch"), "full");
});
