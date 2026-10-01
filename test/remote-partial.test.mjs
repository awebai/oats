/** lib/remote.mjs — partial fetches into the cache (awebai/oats#384): a commit arrives with its trees and only
 * the blobs up to SMALL_BLOB_LIMIT; a read or a materialization fetches the larger blobs it needs, one batched
 * fetch per request; a server that cannot serve that gets whole trees, recorded per cache and said once; git
 * never fetches lazily. Tests build SMALL repos inline. */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, lutimesSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import {
  classifyRemoteFailure, contentDigest, createReadSession, fetchRemoteTree, listRemoteTree, observeRemote, parseRepoRef, readRemoteFile, runGit,
  FILE_BUDGET, OATS_ALIAS_SYMLINK, PARTIAL_FETCH_GIT, SMALL_BLOB_LIMIT, gitVersion, keepsPartialCache,
} from "../lib/remote.mjs";
import { PARTIAL_GIT, olderGitNotice, skipPartialMechanics } from "./helpers/partial-git.mjs";

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

test("a commit arrives with its trees and its small blobs only (with an older git, its whole tree, said once); the cache never stores the url", async () => {
  const f = fixture();
  const session = createReadSession();
  try {
    const obs = await observeRemote(f.bare, { cacheDir: f.cacheDir, session });
    assert.equal(obs.commit, f.commit);
    const large = !PARTIAL_GIT; // an older git (#389) fetches every blob: the fallback is the assertion there
    assert.deepEqual(f.present("oats-membership.yaml", "souls/dev/soul.yaml", "elsewhere/tools/oats.json", "elsewhere/tools/data/model.bin", "assets/huge-1.bin"),
      { "oats-membership.yaml": true, "souls/dev/soul.yaml": true, "elsewhere/tools/oats.json": true, "elsewhere/tools/data/model.bin": large, "assets/huge-1.bin": large });
    if (PARTIAL_GIT) {
      assert.equal(git(f.repoDir, "config", "--get", "oats.fetch"), "partial");
      assert.equal(git(f.repoDir, "config", "--get", "remote.origin.promisor"), "true");
      assert.deepEqual(session.notices, []);
    } else {
      assert.equal(git(f.repoDir, "config", "--get", "oats.fetch"), "full");
      assert.deepEqual(session.notices, [olderGitNotice(f.bare)]);
    }
    assert.throws(() => git(f.repoDir, "config", "--get-all", "remote.origin.url"), "the url (it may carry credentials) is never written");
  } finally { await session.close(); }
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

test("reading a small file costs no fetch; reading a large one fetches exactly that blob", { skip: skipPartialMechanics }, async () => {
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

test("materializing a directory fetches its missing blobs in ONE fetch, and digests like a checkout", { skip: skipPartialMechanics }, async () => {
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

test("an unknown size never passes a budget: a missing blob is fetched, then FILE_BUDGET and TREE_BUDGET apply before any write", { skip: skipPartialMechanics }, async () => {
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

test("a read whose blob was not fetched fails loudly: git never fetches lazily from a cache", { skip: skipPartialMechanics }, async () => {
  const f = fixture();
  await observeRemote(f.bare, { cacheDir: f.cacheDir });
  const e = await runGit(["-C", f.repoDir, "cat-file", "blob", f.blob("assets/huge-1.bin")]).then(() => assert.fail("expected a failure"), (x) => x);
  assert.match(e.stderr.toString(), new RegExp(`${f.blob("assets/huge-1.bin")}: bad file`));
  assert.deepEqual(f.present("assets/huge-1.bin"), { "assets/huge-1.bin": false }, "and nothing was fetched");
});

test("a cache filled by whole-tree fetches keeps working and fetches the next commit partially", { skip: skipPartialMechanics }, async () => {
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

test("a server without filters: whole trees, recorded per cache, said once in the session's notices", { skip: skipPartialMechanics }, async () => {
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

test("a server that filters but refuses blob wants: the commit is fetched again in full, recorded, said once", { skip: skipPartialMechanics }, async () => {
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

// ---------------------------------------------------------------------------
// a git too old to keep a partial cache honest
// ---------------------------------------------------------------------------

/** An exec that runs real git but answers `git --version` as `version` (an older git than the one installed). */
const olderGit = (version) => (args, o) => args.length === 1 && args[0] === "--version"
  ? Promise.resolve({ stdout: Buffer.from(`git version ${version}\n`), stderr: Buffer.alloc(0) })
  : runGit(args, o);

test(`a git older than ${PARTIAL_FETCH_GIT.join(".")} (no GIT_NO_LAZY_FETCH) fetches whole trees, recorded per cache, said once`, async () => {
  const f = fixture();
  const fetches = [];
  const older = olderGit("2.43.0");
  const exec = (args, o) => { if (args.includes("fetch")) fetches.push(args); return older(args, o); };
  const session = createReadSession();
  try {
    const opts = { cacheDir: f.cacheDir, exec, session };
    assert.ok((await readRemoteFile(f.bare, f.commit, "elsewhere/tools/data/model.bin", opts)).bytes.equals(noise(SMALL_BLOB_LIMIT * 3, "model")));
    assert.ok(fetches.length > 0 && fetches.every((a) => !a.some((x) => x.startsWith("--filter"))), `no fetch asks the (partial-capable) server for a filter: ${JSON.stringify(fetches)}`);
    assert.deepEqual(f.present("assets/huge-1.bin"), { "assets/huge-1.bin": true }, "a whole tree, never a partial one");
    assert.equal(git(f.repoDir, "config", "--get", "oats.fetch"), "full");
    assert.deepEqual(session.notices, [olderGitNotice(f.bare, "2.43.0")]);
  } finally { await session.close(); }
});

test(`the kernel's git probe: a partial cache from ${PARTIAL_FETCH_GIT.join(".")} on, never from an older or unreadable git`, async () => {
  for (const [text, keeps] of [["2.44.9", false], ["2.45.0", true], ["2.45.0.windows.1", true], ["2.54.0", true], ["3.0.0", true], ["1.99.0", false]]) {
    assert.equal(keepsPartialCache(await gitVersion(olderGit(text))), keeps, text);
  }
  assert.equal(await gitVersion((args, o) => Promise.reject(new Error("no git"))), null);
  assert.equal(keepsPartialCache(null), false);
});

test("a partial cache met by an older git is rebuilt with whole trees, and reads keep working", { skip: skipPartialMechanics }, async () => {
  const f = fixture();
  await observeRemote(f.bare, { cacheDir: f.cacheDir, at: f.commit });
  assert.equal(git(f.repoDir, "config", "--get", "oats.fetch"), "partial");
  const exec = olderGit("2.39.5");
  const opts = { cacheDir: f.cacheDir, exec };
  assert.ok((await readRemoteFile(f.bare, f.commit, "assets/huge-2.bin", opts)).bytes.equals(noise(SMALL_BLOB_LIMIT * 4, "huge-2")));
  assert.equal(git(f.repoDir, "config", "--get", "oats.fetch"), "full");
  assert.deepEqual(f.present("assets/huge-1.bin"), { "assets/huge-1.bin": true });
  const dest = join(f.base, "out", "tools");
  assert.equal((await fetchRemoteTree(f.bare, f.commit, "elsewhere/tools", dest, opts)).digest, contentDigest(join(f.work, "elsewhere", "tools")));
});

// ---------------------------------------------------------------------------
// two processes on one fresh cache
// ---------------------------------------------------------------------------

/** Run observeRemote(bare, { cacheDir, at: commit }) in `n` separate processes at once → each one's printed outcome. */
function firstFetchRace(f, n) {
  const script = `import { observeRemote } from ${JSON.stringify(new URL("../lib/remote.mjs", import.meta.url).href)};
    try { const r = await observeRemote(process.argv[1], { cacheDir: process.argv[2], at: process.argv[3] }); console.log(r.commit); }
    catch (e) { console.log(\`FAIL \${e.code} \${e.details?.reason} \${e.message}\`); }`;
  const run = () => new Promise((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script, f.bare, f.cacheDir, f.commit], { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.on("close", () => resolve(out.trim()));
  });
  return Promise.all(Array.from({ length: n }, run));
}

// awebai/oats#386: processes making the first fetch of one cache at once (two spawns, two Desktop previews) all
// succeed — the cache's `git init`, its config and its pins are each written by whichever gets there first, and
// a lost race is never an error, let alone a "network" one.
test("processes making the first fetch of one cache all succeed: git init included, then config and pins (#386)", { timeout: 300_000 }, async () => {
  const f = fixture();
  for (let round = 0; round < 6; round++) {
    rmSync(f.cacheDir, { recursive: true, force: true });
    assert.deepEqual(await firstFetchRace(f, 6), Array(6).fill(f.commit), `round ${round}`);
    assert.equal(git(f.repoDir, "config", "--get", "oats.fetch"), PARTIAL_GIT ? "partial" : "full");
    assert.equal(git(f.repoDir, "rev-parse", `refs/oats/commits/${f.commit}`), f.commit);
    assert.deepEqual(readdirSync(f.cacheDir).filter((n) => n.includes(".init-") || n.includes(".stale-")), [], "no private init directory left");
  }
});

test("processes making the first fetch of an already-initialised cache all succeed (git's config lock is a race, not a failure)", { timeout: 300_000 }, async () => {
  const f = fixture();
  for (let round = 0; round < 4; round++) {
    rmSync(f.repoDir, { recursive: true, force: true });
    mkdirSync(f.repoDir, { recursive: true });
    git(f.base, "init", "-q", "--bare", f.repoDir);
    assert.deepEqual(await firstFetchRace(f, 4), Array(4).fill(f.commit), `round ${round}`);
    assert.equal(git(f.repoDir, "config", "--get", "oats.fetch"), PARTIAL_GIT ? "partial" : "full");
  }
});

/** Hold `<repoDir>/<ref>.lock` as a concurrent writer would; `release()` removes it. */
function holdRefLock(f, ref) {
  const lock = join(f.repoDir, `${ref}.lock`);
  mkdirSync(join(lock, ".."), { recursive: true });
  writeFileSync(lock, "");
  return { lock, release: () => rmSync(lock, { force: true }) };
}

test("a pin whose ref another process holds locked is written once the lock is released (update-ref retries a lost race)", async () => {
  const f = fixture();
  git(f.base, "init", "-q", "--bare", f.repoDir);
  const held = holdRefLock(f, `refs/oats/commits/${f.commit}`);
  setTimeout(held.release, 2_000); // held past the fetch: the pin meets it
  const r = await observeRemote(f.bare, { cacheDir: f.cacheDir, at: f.commit });
  assert.equal(r.commit, f.commit);
  assert.equal(git(f.repoDir, "rev-parse", `refs/oats/commits/${f.commit}`), f.commit);
});

test("a pin another process already wrote with the same value counts as written, even while its lock is still held", async () => {
  const f = fixture();
  git(f.base, "init", "-q", "--bare", f.repoDir);
  // The other writer's result (a loose ref holding the commit) and its lock, not yet removed.
  mkdirSync(join(f.repoDir, "refs", "oats", "commits"), { recursive: true });
  writeFileSync(join(f.repoDir, "refs", "oats", "commits", f.commit), `${f.commit}\n`);
  const held = holdRefLock(f, `refs/oats/commits/${f.commit}`);
  try {
    assert.equal((await observeRemote(f.bare, { cacheDir: f.cacheDir, at: f.commit })).commit, f.commit);
  } finally { held.release(); }
});

test("a stale pin lock (its process died) fails bounded, as reason cache naming the cache directory — never network", async () => {
  const f = fixture();
  git(f.base, "init", "-q", "--bare", f.repoDir);
  const held = holdRefLock(f, `refs/oats/commits/${f.commit}`);
  try {
    const started = Date.now();
    const e = await observeRemote(f.bare, { cacheDir: f.cacheDir, at: f.commit }).then(() => assert.fail("expected a failure"), (x) => x);
    assert.equal(e.code, "E_REMOTE_UNREADABLE");
    assert.equal(e.details.reason, "cache");
    assert.equal(e.details.stage, "pin");
    assert.equal(e.details.cacheDir, f.repoDir);
    const lock = join(f.repoDir, "refs", "oats", "commits", `${f.commit}.lock`);
    assert.equal(e.details.lock.replace(/^\/private\//, "/"), lock.replace(/^\/private\//, "/"), "the lock file, named");
    assert.ok(e.message.includes(e.details.lock), e.message);
    assert.match(e.message, /\(cache, pin\): .*\.lock is still held by another git process, or left by one that died; it is safe to remove once no oats or git process is running$/);
    assert.ok(Date.now() - started < 15_000, "bounded wait (LOCK_WAIT_MS), never unbounded");
  } finally { held.release(); }
  // Once the lock is gone the next read pins and succeeds.
  assert.equal((await observeRemote(f.bare, { cacheDir: f.cacheDir, at: f.commit })).commit, f.commit);
});

test("a half-initialised cache directory (no HEAD: a crash's leftover) is replaced, never wedging the cache", async () => {
  const f = fixture();
  mkdirSync(join(f.repoDir, "objects"), { recursive: true });
  writeFileSync(join(f.repoDir, "config"), "[core]\n");
  const r = await observeRemote(f.bare, { cacheDir: f.cacheDir, at: f.commit });
  assert.equal(r.commit, f.commit);
  assert.equal(git(f.repoDir, "rev-parse", `refs/oats/commits/${f.commit}`), f.commit);
  assert.deepEqual(readdirSync(f.cacheDir).filter((n) => n.includes(".init-") || n.includes(".stale-")), []);
  // An empty directory (an older kernel's mkdir before its init) is simply taken.
  const g = fixture();
  mkdirSync(g.repoDir, { recursive: true });
  assert.equal((await observeRemote(g.bare, { cacheDir: g.cacheDir, at: g.commit })).commit, g.commit);
});

test("a cache init that fails is reason cache, stage init, naming the directory — never network", async () => {
  const f = fixture();
  const exec = (args, o) => (args[0] === "init" ? Promise.reject(Object.assign(new Error("init failed"), { code: 128, stderr: Buffer.from("fatal: cannot mkdir: Permission denied\n") })) : runGit(args, o));
  const e = await observeRemote(f.bare, { cacheDir: f.cacheDir, at: f.commit, exec }).then(() => assert.fail("expected a failure"), (x) => x);
  assert.equal(e.code, "E_REMOTE_UNREADABLE");
  assert.deepEqual([e.details.reason, e.details.stage, e.details.cacheDir], ["cache", "init", f.repoDir]);
  assert.match(e.message, /^cannot write the cache of .* at .* \(cache, init\): fatal: cannot mkdir: Permission denied$/, "git's own words");
  assert.equal(existsSync(f.repoDir), false, "nothing half-made in its place");
  assert.deepEqual(readdirSync(f.cacheDir), [".locks"], "only the write locks' directory");
  assert.deepEqual(readdirSync(join(f.cacheDir, ".locks")), [], "the write lock was released");
});

test("classifyRemoteFailure: a git lock still held is cache, never network; a timeout stays timeout", () => {
  const lock = (text) => Object.assign(new Error("x"), { code: 128, stderr: Buffer.from(text) });
  assert.equal(classifyRemoteFailure(lock("fatal: Unable to create '/c/refs/oats/commits/a.lock': File exists.\n")), "cache");
  assert.equal(classifyRemoteFailure(lock("error: could not lock config file /c/config: File exists\n")), "cache");
  assert.equal(classifyRemoteFailure(lock("fatal: unable to access 'https://h/r/': Could not resolve host: h\n")), "network");
  assert.equal(classifyRemoteFailure({ ...lock("Unable to create 'x.lock': File exists"), timedOut: true }), "timeout");
});
// ---------------------------------------------------------------------------
// #386 addendum: the cache write lock, stale git locks, and the graceful kill
// ---------------------------------------------------------------------------

const HOUR_AGO = () => new Date(Date.now() - 60 * 60 * 1000);
/** A git lock file `rel` in the cache repo, as a git killed mid-write leaves it; `old` dates it past the longest fetch. */
function leftoverGitLock(f, rel, { old = true } = {}) {
  const file = join(f.repoDir, rel);
  writeFileSync(file, "");
  if (old) utimesSync(file, HOUR_AGO(), HOUR_AGO());
  return file;
}
const initCache = (f) => { mkdirSync(f.cacheDir, { recursive: true }); git(f.base, "init", "-q", "--bare", f.repoDir); };

test("a killed fetch's shallow.lock (older than the longest fetch) is removed under the write lock, said once, and the fetch succeeds", async () => {
  const f = fixture();
  initCache(f);
  const lock = leftoverGitLock(f, "shallow.lock");
  const session = createReadSession();
  try {
    const r = await observeRemote(f.bare, { cacheDir: f.cacheDir, at: f.commit, session });
    assert.equal(r.commit, f.commit);
    assert.equal(existsSync(lock), false, "the stale lock is gone");
    assert.equal(session.notices.length, 1);
    assert.match(session.notices[0], /^removed a stale git lock .*shallow\.lock \(left by a git process that was killed mid-write\)$/);
  } finally { await session.close(); }
  // Only a lock git names is ever removed: fetchRemoteTree's blob fetch (no shallow update) never meets this one,
  // copies the tree, and leaves it alone.
  const g = fixture();
  await observeRemote(g.bare, { cacheDir: g.cacheDir, at: g.commit });
  const lock2 = leftoverGitLock(g, "shallow.lock");
  const s2 = createReadSession();
  try {
    const r = await fetchRemoteTree(g.bare, g.commit, "elsewhere/tools", join(g.base, "out", "tools"), { cacheDir: g.cacheDir, session: s2 });
    assert.equal(r.digest, contentDigest(join(g.work, "elsewhere", "tools")));
    assert.equal(existsSync(lock2), true, "a lock no write met is not touched");
    assert.deepEqual(s2.notices, []);
  } finally { await s2.close(); }
});

test("a young git lock (it may be an older oats's live fetch) is never removed: reason cache, naming the file and what to do", async () => {
  const f = fixture();
  initCache(f);
  const lock = leftoverGitLock(f, "shallow.lock", { old: false });
  const session = createReadSession();
  try {
    const e = await observeRemote(f.bare, { cacheDir: f.cacheDir, at: f.commit, session }).then(() => assert.fail("expected a refusal"), (x) => x);
    assert.equal(e.code, "E_REMOTE_UNREADABLE");
    assert.equal(e.details.reason, "cache");
    assert.equal(e.details.stage, "fetch");
    assert.ok(e.message.includes(e.details.lock) && e.details.lock.endsWith("/shallow.lock"), e.message);
    assert.match(e.message, /is still held by another git process, or left by one that died; it is safe to remove once no oats or git process is running$/);
    assert.equal(existsSync(lock), true, "never deleted");
    assert.deepEqual(session.notices, []);
  } finally { await session.close(); }
});

test("a symlinked git lock is never removed, whatever its age, and neither is what it points to", async () => {
  const f = fixture();
  initCache(f);
  const target = join(f.base, "outside.txt");
  writeFileSync(target, "keep me\n");
  const link = join(f.repoDir, "shallow.lock");
  symlinkSync(target, link);
  lutimesSync(link, HOUR_AGO(), HOUR_AGO());
  const e = await observeRemote(f.bare, { cacheDir: f.cacheDir, at: f.commit }).then(() => assert.fail("expected a refusal"), (x) => x);
  assert.equal(e.details.reason, "cache");
  assert.equal(lstatSync(link).isSymbolicLink(), true, "the link is left");
  assert.equal(readFileSync(target, "utf8"), "keep me\n", "its target is untouched");
});

test("a git lock git names OUTSIDE the cache repo is never removed", async () => {
  const f = fixture();
  initCache(f);
  const outside = join(f.base, "elsewhere.lock");
  writeFileSync(outside, "");
  utimesSync(outside, HOUR_AGO(), HOUR_AGO());
  // A git whose fetch reports a lock outside the cache (a hostile or confused path): only that report is faked.
  const dir = join(f.base, "outside-shim");
  mkdirSync(dir, { recursive: true });
  const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  writeFileSync(join(dir, "git"), `#!/bin/bash\nfor a in "$@"; do if [ "$a" = "fetch" ]; then echo "fatal: Unable to create '${outside}': File exists." >&2; exit 128; fi; done\nexec "${real}" "$@"\n`, { mode: 0o755 });
  const saved = process.env.PATH;
  process.env.PATH = `${dir}:${saved}`;
  try {
    const e = await observeRemote(f.bare, { cacheDir: f.cacheDir, at: f.commit }).then(() => assert.fail("expected a refusal"), (x) => x);
    assert.equal(e.details.reason, "cache");
    assert.equal(e.details.lock, outside);
  } finally { process.env.PATH = saved; }
  assert.equal(existsSync(outside), true, "never deleted");
});

/** The cache repo's write lock file, held by `pid` (a JSON owner as this kernel writes it). */
function holdWriteLock(f, pid) {
  const lock = join(f.cacheDir, ".locks", `${f.repoDir.split("/").pop()}.lock`);
  mkdirSync(join(lock, ".."), { recursive: true });
  writeFileSync(lock, JSON.stringify({ pid, token: "t".repeat(24), startedAt: "2026-10-01T00:00:00.000Z" }) + "\n");
  return lock;
}

test("a live holder of the cache write lock is waited for (bounded) and never stolen from: reason cache naming its pid", async () => {
  const f = fixture();
  const holder = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"], { stdio: "ignore" });
  try {
    const lock = holdWriteLock(f, holder.pid);
    const before = readFileSync(lock, "utf8");
    const session = createReadSession({ cacheWriteWaitMs: 800 });
    const started = Date.now();
    const e = await observeRemote(f.bare, { cacheDir: f.cacheDir, at: f.commit, session }).then(() => assert.fail("expected a refusal"), (x) => x);
    await session.close();
    assert.ok(Date.now() - started >= 700, "it waited");
    assert.equal(e.code, "E_REMOTE_UNREADABLE");
    assert.deepEqual([e.details.reason, e.details.stage, e.details.holderPid, e.details.lock], ["cache", "fetch", holder.pid, lock]);
    assert.match(e.message, new RegExp(`oats process ${holder.pid} has been writing it since .*; try again once it finishes$`));
    assert.equal(readFileSync(lock, "utf8"), before, "the live holder's lock is untouched");
    assert.equal(existsSync(f.repoDir), false, "nothing was written");
  } finally { holder.kill(); }
});

test("a dead holder's cache write lock is reclaimed at once, and the fetch proceeds", async () => {
  const f = fixture();
  const dead = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await new Promise((r) => dead.on("close", r));
  const lock = holdWriteLock(f, dead.pid);
  const r = await observeRemote(f.bare, { cacheDir: f.cacheDir, at: f.commit });
  assert.equal(r.commit, f.commit);
  assert.equal(existsSync(lock), false, "reclaimed, then released");
});

test("a fetch our own timer ends gets SIGTERM first: git's lock files are cleaned up, and the failure is still reason timeout", async () => {
  const f = fixture();
  initCache(f);
  // A git whose fetch holds a lock file the way git does: removed on SIGTERM (git's lockfile signal cleanup), never on SIGKILL.
  const lock = join(f.repoDir, "shallow.lock");
  const dir = join(f.base, "slow-shim");
  mkdirSync(dir, { recursive: true });
  const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  writeFileSync(join(dir, "git"), `#!/bin/bash
for a in "$@"; do if [ "$a" = "fetch" ]; then
  trap 'rm -f "${lock}"; exit 143' TERM
  : > "${lock}"
  sleep 30 & wait
fi; done
exec "${real}" "$@"
`, { mode: 0o755 });
  const saved = process.env.PATH;
  process.env.PATH = `${dir}:${saved}`;
  const session = createReadSession({ fetchTimeoutMs: 500 });
  try {
    const e = await observeRemote(f.bare, { cacheDir: f.cacheDir, at: f.commit, session }).then(() => assert.fail("expected a timeout"), (x) => x);
    assert.equal(e.code, "E_REMOTE_UNREADABLE");
    assert.equal(e.details.reason, "timeout", "our own timer's kill is a timeout, whichever signal ended git");
    for (let i = 0; i < 50 && existsSync(lock); i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(existsSync(lock), false, "git cleaned up its lock: it was sent SIGTERM, not SIGKILL");
  } finally { process.env.PATH = saved; await session.close(); }
});

// ---------------------------------------------------------------------------
// #386 review regressions
// ---------------------------------------------------------------------------

test("two processes reclaiming one dead write lock never both write: one paused before its unlink cannot delete the other's live lock", { timeout: 120_000 }, async () => {
  const base = scratch();
  const script = new URL("./fixtures/remote-reclaim/reclaimer.mjs", import.meta.url).pathname;
  const remoteUrl = new URL("../lib/remote.mjs", import.meta.url).href;
  const code = await new Promise((r) => spawn(process.execPath, [script, "A", remoteUrl, base], { stdio: "inherit" }).on("close", r));
  assert.equal(code, 0);
  const report = JSON.parse(execFileSync("cat", [join(base, "report.json")], { encoding: "utf8" }));
  assert.deepEqual(report, { bActiveDuringPause: false, simultaneous: false, lockLeft: false },
    "B could not take the lock while A was paused inside the reclaim, the two never fetched at once, and both released");
});

test("a reclaim guard left by a reclaimer that died is never removed: every contender refuses at once naming it, none writes; removed by hand, the cache heals", { timeout: 60_000 }, async () => {
  const f = fixture();
  const dead = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await new Promise((r) => dead.on("close", r));
  const lock = holdWriteLock(f, dead.pid);
  const guard = `${lock}.reclaim`;
  writeFileSync(guard, JSON.stringify({ pid: dead.pid, token: "g".repeat(24) }) + "\n");
  const remoteUrl = new URL("../lib/remote.mjs", import.meta.url).href;
  // Three processes meet the dead lock and the dead guard at once (the interleaving where removing a dead guard
  // let two reclaimers each delete the other's live guard, then lock, and both fetch).
  const code = `const { observeRemote } = await import(${JSON.stringify(remoteUrl)});
    try { await observeRemote(${JSON.stringify(f.bare)}, { cacheDir: ${JSON.stringify(f.cacheDir)}, at: ${JSON.stringify(f.commit)} }); console.log(JSON.stringify({ ok: true })); }
    catch (e) { console.log(JSON.stringify({ code: e.code, details: e.details, message: e.message })); }`;
  const started = Date.now();
  const outs = await Promise.all([0, 1, 2].map(() => new Promise((r) => {
    let out = "";
    const c = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "pipe", "inherit"] });
    c.stdout.on("data", (d) => { out += d; });
    c.on("close", () => r(JSON.parse(out)));
  })));
  assert.ok(Date.now() - started < 15_000, "refused at once, not at the write deadline");
  for (const e of outs) {
    assert.equal(e.code, "E_REMOTE_UNREADABLE");
    assert.deepEqual([e.details.reason, e.details.stage, e.details.guard, e.details.lock, e.details.holderPid], ["cache", "fetch", guard, lock, dead.pid]);
    assert.ok(e.message.endsWith(`: ${guard} was left by oats process ${dead.pid}, which died while reclaiming the write lock ${lock}; it is safe to remove once no oats process is running`), e.message);
  }
  assert.equal(existsSync(guard), true, "no contender removes the guard");
  assert.equal(readFileSync(lock, "utf8").includes(`"pid":${dead.pid}`), true, "nor the lock it guards");
  assert.equal(existsSync(join(f.repoDir, "HEAD")), false, "and none wrote the cache");
  rmSync(guard);
  assert.equal((await observeRemote(f.bare, { cacheDir: f.cacheDir, at: f.commit })).commit, f.commit, "the dead lock is then reclaimed");
  assert.equal(existsSync(lock), false);
});

/** Record every process.kill to a group (a negative pid) while `fn` runs. */
async function spyGroupKills(fn) {
  const kills = [], real = process.kill;
  process.kill = function (pid, signal) { if (pid < 0) kills.push([-pid, signal]); return real.call(process, pid, signal); };
  try { await fn(kills); } finally { process.kill = real; }
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test("terminateGroup sends no SIGKILL to a group that closed within the grace, and no signal at all once closed (its id may be reused)", async () => {
  const { terminateGroup, watchGroup } = await import("../lib/process-group.mjs");
  await spyGroupKills(async (kills) => {
    const child = watchGroup(spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: ["ignore", "pipe", "pipe"] }));
    await new Promise((r) => child.once("spawn", r));
    assert.equal(terminateGroup(child, 300), true);
    await new Promise((r) => child.once("close", r));
    await new Promise((r) => setTimeout(r, 600));
    assert.deepEqual(kills.filter(([, sig]) => sig !== 0), [[child.pid, "SIGTERM"]], "the group was empty at close: no SIGKILL");
    assert.equal(terminateGroup(child, 300), false);
    await new Promise((r) => setTimeout(r, 400));
    assert.deepEqual(kills, [[child.pid, "SIGTERM"], [child.pid, 0]], "a closed child's group is never signalled again (one probe, at its close)");
  });
});

/** A detached leader that starts a descendant in its group; the descendant handles SIGTERM with `onTerm` (code). The
 *  leader ends on SIGTERM. `pipes`: the leader's stdio are pipes and the descendant inherits them (an ssh, a remote
 *  helper); else the descendant holds none (stdio "ignore"), so the leader's 'close' comes while it still runs. */
async function groupWithDescendant(onTerm, { pipes }) {
  const { watchGroup } = await import("../lib/process-group.mjs");
  const pidFile = join(scratch(), "descendant.pid");
  const descendantCode = `process.on('SIGTERM', () => { ${onTerm} }); require('node:fs').writeFileSync(process.env.PID_FILE, String(process.pid)); setInterval(() => {}, 1000);`;
  const leaderCode = `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(descendantCode)}], { stdio: ${JSON.stringify(pipes ? "inherit" : "ignore")} }); setInterval(() => {}, 1000);`;
  const leader = watchGroup(spawn(process.execPath, ["-e", leaderCode], { detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PID_FILE: pidFile } }));
  leader.stdout.resume(); leader.stderr.resume();
  for (let i = 0; i < 250 && !existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 20));
  return { leader, descendant: Number(readFileSync(pidFile, "utf8")), closed: new Promise((r) => leader.once("close", r)) };
}

for (const pipes of [true, false]) {
  test(`terminateGroup kills a descendant that survives SIGTERM after its leader exits, ${pipes ? "holding the leader's pipes (an ssh or remote helper)" : "holding none of its pipes (so the leader's close comes first)"}`, { timeout: 30_000 }, async () => {
    const { terminateGroup } = await import("../lib/process-group.mjs");
    const { leader, descendant, closed } = await groupWithDescendant("", { pipes });
    try {
      await spyGroupKills(async (kills) => {
        assert.equal(terminateGroup(leader, 400), true);
        await new Promise((r) => leader.once("exit", r));
        assert.equal(leader.signalCode, "SIGTERM", "the leader ended on SIGTERM");
        await closed;
        // Killed, it may linger briefly as a zombie until its new parent reaps it (Linux: kill(pid, 0) still succeeds).
        for (let i = 0; i < 100 && alive(descendant); i++) await new Promise((r) => setTimeout(r, 50));
        assert.equal(alive(descendant), false, "the TERM-resistant descendant was killed after the grace");
        assert.deepEqual(kills.filter(([, sig]) => sig !== 0), [[leader.pid, "SIGTERM"], [leader.pid, "SIGKILL"]]);
      });
    } finally { try { process.kill(descendant, "SIGKILL"); } catch { /* gone */ } }
  });
}

test("terminateGroup sends no SIGKILL once the group is seen empty: a descendant that ends within the grace, after its leader closed", { timeout: 30_000 }, async () => {
  const { terminateGroup } = await import("../lib/process-group.mjs");
  const { leader, descendant, closed } = await groupWithDescendant("setTimeout(() => process.exit(0), 300);", { pipes: false });
  try {
    await spyGroupKills(async (kills) => {
      // The grace is long enough for the exited descendant to be reaped: a zombie is still a member of its group.
      const grace = 6_000, end = Date.now() + grace;
      assert.equal(terminateGroup(leader, grace), true);
      await closed;
      for (let i = 0; i < 100 && alive(descendant); i++) await new Promise((r) => setTimeout(r, 50));
      assert.equal(alive(descendant), false, "the descendant ended on its own");
      await new Promise((r) => setTimeout(r, end + 500 - Date.now()));
      assert.deepEqual(kills.filter(([, sig]) => sig !== 0), [[leader.pid, "SIGTERM"]], "the group was seen empty: no SIGKILL at the end of the grace");
    });
  } finally { try { process.kill(descendant, "SIGKILL"); } catch { /* gone */ } }
});

test("runGit's kill (an abort, or its timeout: one path) reaches a descendant that survives SIGTERM and holds git's output: it is killed after the grace", { timeout: 30_000 }, async () => {
  const { TERM_GRACE_MS } = await import("../lib/process-group.mjs");
  const base = scratch();
  const dir = join(base, "shim"), pidFile = join(base, "descendant.pid");
  mkdirSync(dir, { recursive: true });
  // git starts a helper that ignores SIGTERM and inherits git's stdout, as ssh does.
  writeFileSync(join(dir, "git"), `#!/bin/bash
( trap '' TERM; exec sh -c 'echo $$ > "${pidFile}"; exec sleep 60' ) &
sleep 60
`, { mode: 0o755 });
  const saved = process.env.PATH;
  process.env.PATH = `${dir}:${saved}`;
  let descendant = null;
  try {
    const aborter = new AbortController();
    const run = runGit(["fetch"], { cwd: base, signal: aborter.signal }).then(() => assert.fail("expected an abort"), (x) => x);
    for (let i = 0; i < 500 && !existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 20));
    for (let i = 0; i < 100 && !(descendant > 0); i++) { await new Promise((r) => setTimeout(r, 20)); descendant = Number(readFileSync(pidFile, "utf8")); }
    assert.ok(descendant > 0, "the helper started");
    aborter.abort();
    assert.equal((await run).code, "ABORT_ERR");
    assert.equal(alive(descendant), true, "SIGTERM alone does not end it");
    for (let i = 0; i < (TERM_GRACE_MS + 2_000) / 50 && alive(descendant); i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(alive(descendant), false, "the group SIGKILL ended it");
  } finally { process.env.PATH = saved; if (descendant) try { process.kill(descendant, "SIGKILL"); } catch { /* gone */ } }
});

test("an old config.lock (git names it relatively) is recovered; a young one is refused naming its absolute path", async () => {
  const f = fixture();
  initCache(f);
  const lock = leftoverGitLock(f, "config.lock");
  const session = createReadSession();
  try {
    assert.equal((await observeRemote(f.bare, { cacheDir: f.cacheDir, at: f.commit, session })).commit, f.commit);
    assert.equal(existsSync(lock), false);
    assert.ok(session.notices.some((n) => /^removed a stale git lock \/.*\/config\.lock /.test(n)), session.notices.join("\n"));
  } finally { await session.close(); }
  const g = fixture();
  initCache(g);
  const young = leftoverGitLock(g, "config.lock", { old: false });
  const e = await observeRemote(g.bare, { cacheDir: g.cacheDir, at: g.commit }).then(() => assert.fail("expected a refusal"), (x) => x);
  assert.deepEqual([e.details.reason, e.details.stage], ["cache", "config"]);
  assert.ok(isAbsolute(e.details.lock) && e.details.lock.endsWith("/config.lock"), e.details.lock);
  assert.ok(e.message.includes(e.details.lock));
  assert.equal(existsSync(young), true, "never deleted");
});

test("a fetch that cannot write the local cache (FETCH_HEAD unwritable, or a directory) is reason cache with git's words — never auth or network", async () => {
  for (const [name, spoil] of [
    ["unwritable", (file) => { writeFileSync(file, ""); chmodSync(file, 0o444); }],
    ["a directory", (file) => mkdirSync(file)],
  ]) {
    const f = fixture();
    initCache(f);
    spoil(join(f.repoDir, "FETCH_HEAD"));
    const e = await observeRemote(f.bare, { cacheDir: f.cacheDir, at: f.commit }).then(() => assert.fail("expected a refusal"), (x) => x);
    assert.equal(e.code, "E_REMOTE_UNREADABLE", name);
    assert.deepEqual([e.details.reason, e.details.stage, e.details.cacheDir], ["cache", "fetch", f.repoDir], name);
    assert.match(e.message, /\(cache, fetch\): .*cannot open 'FETCH_HEAD': .*; check that .* is writable by this user and its disk has room$/, name);
  }
});

// ---------------------------------------------------------------------------
// fetchRemoteTree through a read session's `cat-file --batch` reader, on a partial cache
// ---------------------------------------------------------------------------

test("a session's batch reader opened before ensureBlobs fetched a blob reads it afterwards: the tree copies as a checkout", { skip: skipPartialMechanics }, async () => {
  const f = fixture();
  const session = createReadSession();
  try {
    const opts = { cacheDir: f.cacheDir, session };
    // A small read opens the cache's reader while model.bin (over SMALL_BLOB_LIMIT) is not in the cache.
    await readRemoteFile(f.bare, f.commit, "souls/dev/soul.yaml", opts);
    const reader = session.batches.get(f.repoDir);
    assert.ok(reader, "the reader is open");
    assert.deepEqual(f.present("elsewhere/tools/data/model.bin"), { "elsewhere/tools/data/model.bin": false });
    const dest = join(f.base, "out", "tools");
    const r = await fetchRemoteTree(f.bare, f.commit, "elsewhere/tools", dest, opts);
    assert.equal(r.digest, contentDigest(join(f.work, "elsewhere", "tools")));
    assert.equal(r.digest, contentDigest(dest));
    assert.equal(session.batches.get(f.repoDir), reader, "the same reader read the blob ensureBlobs fetched after it opened");
    assert.deepEqual(f.present("assets/huge-1.bin"), { "assets/huge-1.bin": false }, "nothing beyond the subtree was fetched");
  } finally { await session.close(); }
});

/** A `git` shim first on PATH whose `cat-file --batch-check` says every MISSING object is a 9-byte blob (so
 *  ensureBlobs believes a blob is present and fetches nothing); every other call, `--batch` included, is the
 *  real git. Each `fetch` is logged. */
async function withLyingBatchCheck(base, fn) {
  const dir = join(base, "lying-shim"), log = join(base, "fetches.log");
  mkdirSync(dir, { recursive: true });
  writeFileSync(log, "");
  const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  writeFileSync(join(dir, "git"), `#!/bin/bash
for a in "$@"; do [ "$a" = "fetch" ] && echo "$*" >> "${log}"; done
for a in "$@"; do
  if [ "$a" = "--batch-check" ]; then "${real}" "$@" | sed -E 's/^([0-9a-f]{40}) missing$/\\1 blob 9/'; exit "\${PIPESTATUS[0]}"; fi
done
exec "${real}" "$@"
`, { mode: 0o755 });
  const saved = process.env.PATH;
  process.env.PATH = `${dir}:${saved}`;
  try { return await fn(() => execFileSync("cat", [log], { encoding: "utf8" }).split("\n").filter(Boolean)); }
  finally { process.env.PATH = saved; }
}

test("a blob still missing when the batch reader reads it fails exactly as without a session: never a lazy fetch, never a hang, nothing left", { skip: skipPartialMechanics }, async () => {
  const f = fixture();
  await observeRemote(f.bare, { cacheDir: f.cacheDir, at: f.commit });
  assert.deepEqual(f.present("elsewhere/tools/data/model.bin"), { "elsewhere/tools/data/model.bin": false });
  await withLyingBatchCheck(f.base, async (fetches) => {
    const session = createReadSession({ batchTimeoutMs: 10_000 });
    const dest = join(f.base, "out", "tools");
    const failure = (opts) => fetchRemoteTree(f.bare, f.commit, "elsewhere/tools", dest, { cacheDir: f.cacheDir, ...opts }).then(() => assert.fail("expected a failure"), (x) => x);
    const shape = (x) => ({ code: x.code, reason: x.details.reason, path: x.details.path, commit: x.details.commit });
    const plain = await failure({});
    const started = Date.now();
    const e = await failure({ session });
    assert.deepEqual(shape(e), shape(plain), "the same error as without a session");
    assert.equal(e.code, "E_REMOTE_UNREADABLE");
    assert.equal(e.details.path, "data/model.bin");
    assert.ok(Date.now() - started < 5_000, "answered at once, not by a timeout");
    assert.deepEqual(fetches(), [], "neither ensureBlobs (it was lied to) nor git (GIT_NO_LAZY_FETCH) fetched");
    assert.deepEqual(f.present("elsewhere/tools/data/model.bin"), { "elsewhere/tools/data/model.bin": false });
    assert.deepEqual(readdirSync(join(f.base, "out")), [], "no staging directory, no destination");
    await session.close();
  });
});

test("a symlink target over its 64 KiB cap fails exactly as without a session, whatever its id spells (an oid holding 403 is not an auth failure)", async () => {
  const f = fixture();
  // The reviewer's deterministic blob: 65,540 bytes, oid 8cc834859992ea403d394e514826263be431fb85.
  const oid = execFileSync("git", ["-C", f.work, "hash-object", "-w", "--stdin"], { input: "a".repeat(65537) + "216", encoding: "utf8" }).trim();
  assert.equal(oid, "8cc834859992ea403d394e514826263be431fb85");
  write(f.work, "aliased/AGENTS.md", "# aliased\n");
  git(f.work, "add", "-A");
  git(f.work, "update-index", "--add", "--cacheinfo", `120000,${oid},aliased/CLAUDE.md`);
  git(f.work, "commit", "-q", "-m", "long link"); git(f.work, "push", "-q", "origin", "HEAD:main");
  const commit = git(f.work, "rev-parse", "HEAD");
  const failure = (opts, out) => fetchRemoteTree(f.bare, commit, "aliased", join(f.base, out, "aliased"), { cacheDir: f.cacheDir, allowSymlinks: OATS_ALIAS_SYMLINK, ...opts })
    .then(() => assert.fail("expected a failure"), (x) => x);
  const shape = (x) => ({ code: x.code, reason: x.details?.reason, path: x.details?.path });
  const plain = await failure({}, "plain");
  const session = createReadSession();
  try {
    const batched = await failure({ session }, "batch");
    assert.deepEqual(shape(batched), shape(plain), "the same error as without a session");
    assert.deepEqual(shape(batched), { code: "E_REMOTE_UNREADABLE", reason: "network", path: "CLAUDE.md" });
    assert.deepEqual(readdirSync(join(f.base, "batch")), [], "nothing left");
  } finally { await session.close(); }
});

test("a full-mode cache (a server without filters) copies the same tree through the batch reader as without a session", async () => {
  const f = fixture("plain");
  const session = createReadSession();
  try {
    const batched = await fetchRemoteTree(f.bare, f.commit, "elsewhere/tools", join(f.base, "batch", "tools"), { cacheDir: f.cacheDir, session });
    assert.equal(git(f.repoDir, "config", "--get", "oats.fetch"), "full");
    assert.equal(session.batches.size, 1, "read through the batch reader");
    const plain = await fetchRemoteTree(f.bare, f.commit, "elsewhere/tools", join(f.base, "plain", "tools"), { cacheDir: f.cacheDir });
    assert.deepStrictEqual(batched, plain);
    assert.equal(batched.digest, contentDigest(join(f.work, "elsewhere", "tools")));
  } finally { await session.close(); }
});
