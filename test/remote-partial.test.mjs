/** lib/remote.mjs — partial fetches into the cache (awebai/oats#384): a commit arrives with its trees and only
 * the blobs up to SMALL_BLOB_LIMIT; a read or a materialization fetches the larger blobs it needs, one batched
 * fetch per request; a server that cannot serve that gets whole trees, recorded per cache and said once; git
 * never fetches lazily. Tests build SMALL repos inline. */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, lutimesSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyRemoteFailure, contentDigest, createReadSession, fetchRemoteTree, listRemoteTree, observeRemote, parseRepoRef, readRemoteFile, runGit,
  FILE_BUDGET, PARTIAL_FETCH_GIT, SMALL_BLOB_LIMIT, gitVersion, keepsPartialCache,
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
