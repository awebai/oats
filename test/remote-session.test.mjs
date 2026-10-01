/** lib/remote.mjs read sessions (docs/implementation.md "The remote read path"): the tree index answers
 *  exactly as per-path listings do, the `cat-file --batch` reader fails exactly as per-blob reads do,
 *  and every memo is session-scoped — no session, today's behaviour. Small inline bare repos only. */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  contentDigest, createReadSession, fetchRemoteTree, listRemoteTree, observeRemote, readRemoteFile, remoteTreeOids, runGit,
  FILE_BUDGET, OATS_ALIAS_SYMLINK, TREE_BUDGET,
} from "../lib/remote.mjs";

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" };
const git = (cwd, ...args) => execFileSync("git", args, { cwd, env: GIT_ENV, stdio: ["ignore", "pipe", "pipe"] }).toString("utf8").trim();
const REAL_GIT = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();

const roots = [];
function scratch() { const d = mkdtempSync(join(tmpdir(), "oats-session-")); roots.push(d); return d; }
test.after(() => { for (const d of roots) rmSync(d, { recursive: true, force: true }); });
const write = (dir, rel, content) => { mkdirSync(join(dir, rel, ".."), { recursive: true }); writeFileSync(join(dir, rel), content); };

/** A bare repo with nested trees, a symlink, an executable, a submodule gitlink, a name that is unsafe
 *  deep down, and an oversize blob. */
function fixture() {
  const base = scratch();
  const bare = join(base, "remote.git"), work = join(base, "work");
  git(base, "init", "-q", "--bare", "-b", "main", bare);
  git(base, "init", "-q", "-b", "main", work);
  write(work, "README.md", "# hi\n");
  write(work, "souls/dev/soul.yaml", "schemaVersion: 2\nname: dev\n");
  write(work, "souls/dev/AGENTS.md", "# dev\n");
  symlinkSync("AGENTS.md", join(work, "souls/dev/CLAUDE.md"));
  write(work, "capabilities/tool/oats.json", "{\"capability\":\"tool\"}\n");
  write(work, "capabilities/tool/skills/cut/SKILL.md", "cut\n");
  write(work, "capabilities/tool/bin/run", "#!/bin/sh\n");
  chmodSync(join(work, "capabilities/tool/bin/run"), 0o755);
  write(work, "capabilities/tool/deep/a/b/c.txt", "deep\n");
  write(work, "capabilities/tool-x/oats.json", "{}\n");        // a sibling sorting next to "tool"
  write(work, "capabilities/tool.y", "file\n");                 // a blob sorting before "tool/"
  write(work, "big/blob.bin", Buffer.alloc(FILE_BUDGET + 10, 97));
  git(work, "add", "-A");
  // A submodule gitlink inside capabilities/tool (listed as type commit, never part of the tree).
  git(work, "update-index", "--add", "--cacheinfo", `160000,${"1".repeat(40)},capabilities/tool/vendor`);
  git(work, "commit", "-q", "-m", "one");
  git(work, "push", "-q", bare, "HEAD:main");
  return { base, bare, work, commit: git(work, "rev-parse", "HEAD"), cacheDir: join(base, "cache") };
}

async function outcome(promise) {
  try { return { value: await promise }; } catch (e) { return { error: { code: e.code, message: e.message, details: e.details ?? null } }; }
}

test("the session's tree index answers entryAt/listRemoteTree/remoteTreeOids exactly as per-path listings do", async () => {
  const fx = fixture();
  const session = createReadSession();
  const dirs = ["", ".", "souls", "souls/dev", "capabilities", "capabilities/tool", "capabilities/tool/deep", "capabilities/tool-x", "capabilities/nope", "README.md", "capabilities/tool.y"];
  for (const dir of dirs) for (const depth of [1, 2, 3, 5]) {
    const plain = await outcome(listRemoteTree(fx.bare, fx.commit, dir, { depth, cacheDir: fx.cacheDir }));
    const indexed = await outcome(listRemoteTree(fx.bare, fx.commit, dir, { depth, cacheDir: fx.cacheDir, session }));
    assert.deepStrictEqual(indexed, plain, `listRemoteTree ${JSON.stringify(dir)} depth ${depth}`);
  }
  for (const path of ["README.md", "souls/dev/soul.yaml", "souls/dev/CLAUDE.md", "souls", "capabilities/tool/bin/run", "capabilities/tool/vendor", "nope.txt", "big/blob.bin", "capabilities/tool.y"]) {
    const plain = await outcome(readRemoteFile(fx.bare, fx.commit, path, { cacheDir: fx.cacheDir }));
    const indexed = await outcome(readRemoteFile(fx.bare, fx.commit, path, { cacheDir: fx.cacheDir, session }));
    assert.deepStrictEqual(indexed, plain, `readRemoteFile ${path}`);
  }
  const dirsList = ["souls/dev", "capabilities/tool", "README.md", "missing/dir", "capabilities/tool/vendor"];
  assert.deepStrictEqual(await remoteTreeOids(fx.bare, fx.commit, dirsList, { cacheDir: fx.cacheDir, session }), await remoteTreeOids(fx.bare, fx.commit, dirsList, { cacheDir: fx.cacheDir }));
  // One recursive listing served every one of those reads.
  assert.equal(session.trees.size, 1);
  await session.close();
});

test("an unsafe entry name below the kept depth is ignored, at a kept depth refused — the same with the index", async () => {
  const base = scratch();
  const bare = join(base, "r.git");
  git(base, "init", "-q", "--bare", "-b", "main", bare);
  const blob = execFileSync("git", ["-C", bare, "hash-object", "-w", "--stdin"], { input: "x\n" }).toString().trim();
  const mktree = (lines) => execFileSync("git", ["-C", bare, "mktree"], { input: lines.join("\n") + "\n" }).toString().trim();
  const inner = mktree([`100644 blob ${blob}\t..`]);                 // a hostile name, two levels down
  const mid = mktree([`040000 tree ${inner}\tdeep`, `100644 blob ${blob}\tok.txt`]);
  const root = mktree([`040000 tree ${mid}\tcaps`]);
  const commit = execFileSync("git", ["-C", bare, "commit-tree", root, "-m", "hostile"], { env: GIT_ENV }).toString().trim();
  git(bare, "update-ref", "refs/heads/main", commit);
  const cacheDir = join(base, "cache");
  const session = createReadSession();
  for (const depth of [1, 2, 3]) {
    const plain = await outcome(listRemoteTree(bare, commit, "caps", { depth, cacheDir }));
    const indexed = await outcome(listRemoteTree(bare, commit, "caps", { depth, cacheDir, session }));
    assert.deepStrictEqual(indexed, plain, `depth ${depth}`);
  }
  assert.equal((await outcome(listRemoteTree(bare, commit, "caps", { depth: 3, cacheDir, session }))).error.code, "E_REMOTE_TREE_UNSAFE");
  await session.close();
});

test("a tree index over its output budget is unusable for that commit: the per-path fallback gives the same answers", async () => {
  const fx = fixture();
  const calls = [];
  const exec = (args, opts) => { calls.push(args.filter((a) => a !== "-C" && a !== fx.cacheDir).join(" ")); return runGit(args, opts); };
  const small = createReadSession({ treeIndexBudget: 16 });   // the listing overflows: never an error
  const normal = createReadSession();
  for (const dir of ["souls", "capabilities/tool", ""]) {
    assert.deepStrictEqual(await listRemoteTree(fx.bare, fx.commit, dir, { depth: 2, cacheDir: fx.cacheDir, exec, session: small }), await listRemoteTree(fx.bare, fx.commit, dir, { depth: 2, cacheDir: fx.cacheDir, session: normal }));
  }
  assert.deepStrictEqual(await readRemoteFile(fx.bare, fx.commit, "README.md", { cacheDir: fx.cacheDir, exec, session: small }), await readRemoteFile(fx.bare, fx.commit, "README.md", { cacheDir: fx.cacheDir }));
  assert.equal(await small.trees.values().next().value, null, "the overflowed index is marked unusable");
  assert.ok(calls.some((c) => c.includes("ls-tree") && c.includes(" -- ")), "per-path listings answered instead");
  await small.close(); await normal.close();
});

test("batch reads: one cat-file --batch per cache repo; oversize keeps today's refusal and details", async () => {
  const fx = fixture();
  const session = createReadSession();
  const a = await readRemoteFile(fx.bare, fx.commit, "README.md", { cacheDir: fx.cacheDir, session });
  const b = await readRemoteFile(fx.bare, fx.commit, "souls/dev/soul.yaml", { cacheDir: fx.cacheDir, session });
  assert.equal(a.bytes.toString(), "# hi\n");
  assert.equal(b.bytes.toString(), "schemaVersion: 2\nname: dev\n");
  assert.equal(session.batches.size, 1);
  const plain = await outcome(readRemoteFile(fx.bare, fx.commit, "big/blob.bin", { cacheDir: fx.cacheDir }));
  const batched = await outcome(readRemoteFile(fx.bare, fx.commit, "big/blob.bin", { cacheDir: fx.cacheDir, session }));
  assert.equal(batched.error.code, "E_REMOTE_FILE_OVERSIZE");
  assert.deepStrictEqual(batched, plain);
  await session.close();
  assert.equal(session.batches.size, 0);
});

/** A `git` shim first on PATH whose `cat-file --batch` misbehaves as OATS_TEST_BATCH says; every other
 *  git call is the real git. Each batch child records its pid. */
function batchShim(base) {
  const dir = join(base, "shim");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "git"), `#!/bin/bash
batch=""; for a in "$@"; do [ "$a" = "--batch" ] && batch=1; done
[ -z "$batch" ] && exec "${REAL_GIT}" "$@"
echo $$ >> "$OATS_TEST_BATCH_PIDS"
n=0
while IFS= read -r oid; do
  n=$((n+1))
  case "$OATS_TEST_BATCH" in
    oversize) if [ $n = 1 ]; then printf '%s blob %d\\n' "$oid" ${FILE_BUDGET + 1}; head -c ${FILE_BUDGET + 1} /dev/zero; printf '\\n'; else printf '%s blob 2\\nok\\n' "$oid"; fi ;;
    tree) printf '%s tree 3\\nabc\\n' "$oid" ;;
    missing) printf '%s missing\\n' "$oid" ;;
    die) echo "fatal: the batch died" >&2; exit 1 ;;
    hang) sleep 30 ;;
  esac
done
`, { mode: 0o755 });
  return dir;
}
async function withShim(mode, fn) {
  const fx = fixture();
  const pids = join(fx.base, "pids");
  writeFileSync(pids, "");
  const saved = { PATH: process.env.PATH, B: process.env.OATS_TEST_BATCH, P: process.env.OATS_TEST_BATCH_PIDS };
  process.env.PATH = `${batchShim(fx.base)}:${process.env.PATH}`;
  process.env.OATS_TEST_BATCH = mode;
  process.env.OATS_TEST_BATCH_PIDS = pids;
  try { return await fn(fx, () => execFileSync("cat", [pids], { encoding: "utf8" }).split("\n").filter(Boolean).map(Number)); }
  finally {
    process.env.PATH = saved.PATH;
    if (saved.B === undefined) delete process.env.OATS_TEST_BATCH; else process.env.OATS_TEST_BATCH = saved.B;
    if (saved.P === undefined) delete process.env.OATS_TEST_BATCH_PIDS; else process.env.OATS_TEST_BATCH_PIDS = saved.P;
  }
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const settle = async (pids) => { for (let i = 0; i < 50 && pids().some(alive); i++) await new Promise((r) => setTimeout(r, 20)); };

test("batch: a header over the budget is E_REMOTE_FILE_OVERSIZE with today's details, its body skipped (the next read is intact)", async () => {
  await withShim("oversize", async (fx) => {
    const session = createReadSession();
    const e = (await outcome(readRemoteFile(fx.bare, fx.commit, "README.md", { cacheDir: fx.cacheDir, session }))).error;
    assert.equal(e.code, "E_REMOTE_FILE_OVERSIZE");
    assert.deepStrictEqual(e.details, { path: "README.md", size: FILE_BUDGET + 1, budget: FILE_BUDGET, key: `local/${fx.bare}`, commit: fx.commit });
    assert.equal((await readRemoteFile(fx.bare, fx.commit, "souls/dev/soul.yaml", { cacheDir: fx.cacheDir, session })).bytes.toString(), "ok");
    await session.close();
  });
});

test("batch: a non-blob answer, `missing`, a dying child and ENOENT are typed E_REMOTE_UNREADABLE with today's reasons; no child is left", async () => {
  for (const [mode, reason] of [["tree", "network"], ["missing", "not-found"], ["die", "network"]]) {
    await withShim(mode, async (fx, pids) => {
      const session = createReadSession();
      const e = (await outcome(readRemoteFile(fx.bare, fx.commit, "README.md", { cacheDir: fx.cacheDir, session }))).error;
      assert.equal(e.code, "E_REMOTE_UNREADABLE", mode);
      assert.equal(e.details.reason, reason, mode);
      assert.equal(e.details.path, "README.md");
      await session.close();
      await settle(pids);
      assert.deepEqual(pids().filter(alive), [], `${mode}: no batch child outlives the session`);
    });
  }
  // git missing from PATH when the batch starts (the commit and index are already known): never a hang.
  const fx = fixture();
  const session = createReadSession();
  await readRemoteFile(fx.bare, fx.commit, "README.md", { cacheDir: fx.cacheDir, session });
  for (const reader of session.batches.values()) reader.kill();
  const saved = process.env.PATH;
  process.env.PATH = join(fx.base, "empty-path");
  try {
    const e = (await outcome(readRemoteFile(fx.bare, fx.commit, "souls/dev/soul.yaml", { cacheDir: fx.cacheDir, session }))).error;
    assert.equal(e.code, "E_REMOTE_UNREADABLE");
    assert.equal(e.details.reason, "network");
  } finally { process.env.PATH = saved; }
  await session.close();
});

test("batch: no answer within the timeout rejects with reason timeout and kills the child", async () => {
  await withShim("hang", async (fx, pids) => {
    const session = createReadSession({ batchTimeoutMs: 300 });
    const e = (await outcome(readRemoteFile(fx.bare, fx.commit, "README.md", { cacheDir: fx.cacheDir, session }))).error;
    assert.equal(e.code, "E_REMOTE_UNREADABLE");
    assert.equal(e.details.reason, "timeout");
    await settle(pids);
    assert.deepEqual(pids().filter(alive), []);
    await session.close();
  });
});

test("every memo is session-scoped: without a session each observation asks the remote and sees a new head", async () => {
  const fx = fixture();
  let lsRemote = 0;
  const exec = (args, opts) => { if (args[0] === "ls-remote") lsRemote++; return runGit(args, opts); };
  const first = await observeRemote(fx.bare, { cacheDir: fx.cacheDir, exec });
  write(fx.work, "README.md", "# two\n");
  git(fx.work, "commit", "-q", "-am", "two");
  git(fx.work, "push", "-q", fx.bare, "HEAD:main");
  const second = await observeRemote(fx.bare, { cacheDir: fx.cacheDir, exec });
  assert.equal(lsRemote, 2);
  assert.notEqual(second.commit, first.commit, "no session: the new head is seen");
  // In a session: one ls-remote for the command, every reader sees the same commit.
  const session = createReadSession();
  const a = await observeRemote(fx.bare, { cacheDir: fx.cacheDir, exec, session });
  const b = await observeRemote(`file://${fx.bare}`, { cacheDir: fx.cacheDir, exec, session });
  assert.equal(lsRemote, 3);
  assert.equal(a.commit, second.commit);
  assert.equal(b.commit, a.commit);
  // A failed observation is not kept: the next caller retries.
  let failing = true;
  const flaky = (args, opts) => { if (args[0] === "ls-remote") { lsRemote++; if (failing) { failing = false; return Promise.reject(Object.assign(new Error("x"), { stderr: Buffer.from("fatal: unable to access: Could not resolve host") })); } } return runGit(args, opts); };
  const fresh = createReadSession();
  assert.equal((await outcome(observeRemote(fx.bare, { cacheDir: fx.cacheDir, exec: flaky, session: fresh }))).error.details.reason, "network");
  assert.equal((await observeRemote(fx.bare, { cacheDir: fx.cacheDir, exec: flaky, session: fresh })).commit, second.commit);
  await session.close(); await fresh.close();
});

test("peels: a positive peel is kept per session, a negative one never; no session re-checks the object store", async () => {
  const fx = fixture();
  const revParses = [];
  const exec = (args, opts) => { if (args.includes("rev-parse")) revParses.push(args.at(-1)); return runGit(args, opts); };
  const session = createReadSession();
  await readRemoteFile(fx.bare, fx.commit, "README.md", { cacheDir: fx.cacheDir, exec, session });
  await readRemoteFile(fx.bare, fx.commit, "souls/dev/AGENTS.md", { cacheDir: fx.cacheDir, exec, session });
  assert.equal(revParses.length, 2, "the first read peels before and after its fetch; the second peels nothing");
  const missing = "2".repeat(40);
  for (let i = 0; i < 2; i++) assert.equal((await outcome(readRemoteFile(fx.bare, missing, "README.md", { cacheDir: fx.cacheDir, exec, session }))).error.code, "E_REMOTE_UNREADABLE");
  assert.equal(revParses.filter((r) => r.startsWith(missing)).length, 2, "a negative peel is asked again");
  revParses.length = 0;
  await readRemoteFile(fx.bare, fx.commit, "README.md", { cacheDir: fx.cacheDir, exec });
  await readRemoteFile(fx.bare, fx.commit, "README.md", { cacheDir: fx.cacheDir, exec });
  assert.equal(revParses.length, 2, "without a session every read checks the store");
  await session.close();
});

// ---------------------------------------------------------------------------
// fetchRemoteTree through the session's batch reader (no `cat-file blob` process per blob)
// ---------------------------------------------------------------------------

/** Every file under `dir` (relative path → { mode, content | link }), for comparing two written trees. */
function snapshot(dir) {
  const out = {};
  const walk = (abs, rel) => {
    for (const name of readdirSync(abs).sort()) {
      const p = join(abs, name), r = rel ? `${rel}/${name}` : name, s = lstatSync(p);
      if (s.isSymbolicLink()) out[r] = { link: readlinkSync(p) };
      else if (s.isDirectory()) walk(p, r);
      else out[r] = { mode: s.mode & 0o777, content: readFileSync(p).toString("base64") };
    }
  };
  walk(dir, "");
  return out;
}
/** What is left beside `dest` (a staging directory would be here). */
const beside = (dest) => (existsSync(join(dest, "..")) ? readdirSync(join(dest, "..")) : []);

/** A bare repo whose `mod/` holds nested files, an executable, the CLAUDE.md alias and a blob over FILE_BUDGET. */
function treeFixture() {
  const base = scratch();
  const bare = join(base, "remote.git"), work = join(base, "work");
  git(base, "init", "-q", "--bare", "-b", "main", bare);
  git(base, "init", "-q", "-b", "main", work);
  write(work, "mod/AGENTS.md", "# mod\n");
  symlinkSync("AGENTS.md", join(work, "mod/CLAUDE.md"));
  write(work, "mod/bin/run", "#!/bin/sh\necho hi\n");
  chmodSync(join(work, "mod/bin/run"), 0o755);
  write(work, "mod/deep/a/b/c.txt", "deep\n");
  write(work, "mod/empty.txt", "");
  write(work, "mod/big.bin", Buffer.alloc(FILE_BUDGET + 10, 97));
  write(work, "other.txt", "outside\n");
  git(work, "add", "-A");
  git(work, "commit", "-q", "-m", "one");
  git(work, "push", "-q", bare, "HEAD:main");
  return { base, bare, work, commit: git(work, "rev-parse", "HEAD"), cacheDir: join(base, "cache") };
}

/** A `git` shim first on PATH that logs every invocation's arguments, then runs the real git. */
async function withGitLog(base, fn) {
  const dir = join(base, "log-shim"), log = join(base, "git.log");
  mkdirSync(dir, { recursive: true });
  writeFileSync(log, "");
  writeFileSync(join(dir, "git"), `#!/bin/bash\necho "$*" >> "${log}"\nexec "${REAL_GIT}" "$@"\n`, { mode: 0o755 });
  const saved = process.env.PATH;
  process.env.PATH = `${dir}:${saved}`;
  try { return await fn(() => readFileSync(log, "utf8").split("\n").filter(Boolean)); }
  finally { process.env.PATH = saved; }
}

test("fetchRemoteTree in a session reads through one cat-file --batch: the same files, modes and digest, no process per blob", async () => {
  const fx = treeFixture();
  const opts = { cacheDir: fx.cacheDir, allowSymlinks: OATS_ALIAS_SYMLINK };
  await withGitLog(fx.base, async (calls) => {
    const plainDest = join(fx.base, "plain", "mod");
    const plain = await fetchRemoteTree(fx.bare, fx.commit, "mod", plainDest, opts);
    const perBlob = calls().filter((c) => c.includes("cat-file blob")).length;
    assert.equal(perBlob, 6, "without a session: one cat-file blob per file and link");
    const before = calls().length;
    const session = createReadSession();
    const batchDest = join(fx.base, "batch", "mod");
    const batched = await fetchRemoteTree(fx.bare, fx.commit, "mod", batchDest, { ...opts, session });
    const mine = calls().slice(before);
    assert.deepEqual(mine.filter((c) => c.includes("cat-file blob")), [], "no cat-file blob process under a session");
    assert.equal(mine.filter((c) => c.includes("cat-file --batch")).length, 1, "one batch reader for the cache repo");
    assert.deepStrictEqual(batched, plain);
    assert.equal(batched.digest, contentDigest(batchDest, { allowSymlinks: OATS_ALIAS_SYMLINK }));
    assert.deepStrictEqual(snapshot(batchDest), snapshot(plainDest));
    assert.equal(lstatSync(join(batchDest, "CLAUDE.md")).isSymbolicLink(), true, "the alias is a symlink through the batch path");
    assert.equal(lstatSync(join(batchDest, "big.bin")).size, FILE_BUDGET + 10, "a blob over FILE_BUDGET, inside TREE_BUDGET, copies");
    // The whole tree too.
    const rootPlain = await fetchRemoteTree(fx.bare, fx.commit, "", join(fx.base, "plain", "root"), opts);
    assert.deepStrictEqual(await fetchRemoteTree(fx.bare, fx.commit, "", join(fx.base, "batch", "root"), { ...opts, session }), rootPlain);
    await session.close();
  });
});

test("fetchRemoteTree in a session refuses an oversize tree from the listing, exactly as without one", async () => {
  const base = scratch();
  const bare = join(base, "r.git");
  git(base, "init", "-q", "--bare", "-b", "main", bare);
  const big = execFileSync("git", ["-C", bare, "hash-object", "-w", "--stdin"], { input: Buffer.alloc(FILE_BUDGET + 10, 98) }).toString().trim();
  // One blob listed 16 times: 64 MiB + 160 bytes, without storing 64 MiB.
  const many = execFileSync("git", ["-C", bare, "mktree"], { input: Array.from({ length: 16 }, (_, i) => `100644 blob ${big}\tf${String(i).padStart(2, "0")}`).join("\n") + "\n" }).toString().trim();
  const root = execFileSync("git", ["-C", bare, "mktree"], { input: `040000 tree ${many}\tmod\n` }).toString().trim();
  const commit = execFileSync("git", ["-C", bare, "commit-tree", root, "-m", "big"], { env: GIT_ENV }).toString().trim();
  git(bare, "update-ref", "refs/heads/main", commit);
  const cacheDir = join(base, "cache");
  const plain = await outcome(fetchRemoteTree(bare, commit, "mod", join(base, "plain", "mod"), { cacheDir }));
  const session = createReadSession();
  const batched = await outcome(fetchRemoteTree(bare, commit, "mod", join(base, "batch", "mod"), { cacheDir, session }));
  assert.equal(batched.error.code, "E_REMOTE_TREE_UNSAFE");
  assert.equal(batched.error.details.why, "oversize");
  assert.equal(batched.error.details.budget, TREE_BUDGET);
  assert.deepStrictEqual(batched, plain);
  assert.equal(session.batches.size, 0, "refused before any blob was read");
  assert.deepEqual(beside(join(base, "batch", "mod")), []);
  await session.close();
});

test("fetchRemoteTree: a batch reader that dies, times out or is ended mid-tree fails E_REMOTE_UNREADABLE and leaves nothing; one that answers `missing` is checked by a read alone", async () => {
  // A blob the reader calls missing is read once more without it, as a copy without a session reads it: here it is
  // there, so the copy succeeds, identical.
  await withShim("missing", async (fx, pids) => {
    const session = createReadSession({ batchTimeoutMs: 300 });
    const opts = { cacheDir: fx.cacheDir, allowSymlinks: OATS_ALIAS_SYMLINK };
    const batched = await fetchRemoteTree(fx.bare, fx.commit, "souls/dev", join(fx.base, "batch", "dev"), { ...opts, session });
    assert.ok(pids().length > 0, "the reader was asked");
    assert.deepStrictEqual(batched, await fetchRemoteTree(fx.bare, fx.commit, "souls/dev", join(fx.base, "plain", "dev"), opts));
    await session.close();
    await settle(pids);
    assert.deepEqual(pids().filter(alive), [], "missing: no batch child outlives the session");
  });
  for (const [mode, reason] of [["die", "network"], ["hang", "timeout"]]) {
    await withShim(mode, async (fx, pids) => {
      const session = createReadSession({ batchTimeoutMs: 300 });
      const dest = join(fx.base, "out", "dev");
      const e = (await outcome(fetchRemoteTree(fx.bare, fx.commit, "souls/dev", dest, { cacheDir: fx.cacheDir, session, allowSymlinks: OATS_ALIAS_SYMLINK }))).error;
      assert.equal(e.code, "E_REMOTE_UNREADABLE", mode);
      assert.equal(e.details.reason, reason, mode);
      assert.equal(e.details.commit, fx.commit, mode);
      assert.equal(e.details.path, "AGENTS.md", mode);
      assert.equal(existsSync(dest), false, mode);
      assert.deepEqual(beside(dest), [], `${mode}: no staging directory left`);
      await session.close();
      await settle(pids);
      assert.deepEqual(pids().filter(alive), [], `${mode}: no batch child outlives the session`);
    });
  }
  // The session ended (a signal's closeNow) while a read is waiting on the reader.
  await withShim("hang", async (fx, pids) => {
    const session = createReadSession();
    const dest = join(fx.base, "out", "dev");
    const pending = outcome(fetchRemoteTree(fx.bare, fx.commit, "souls/dev", dest, { cacheDir: fx.cacheDir, session, allowSymlinks: OATS_ALIAS_SYMLINK }));
    for (let i = 0; i < 250 && !pids().length; i++) await new Promise((r) => setTimeout(r, 20));
    session.closeNow();
    const e = (await pending).error;
    assert.equal(e.code, "E_REMOTE_UNREADABLE");
    assert.equal(existsSync(dest), false);
    assert.deepEqual(beside(dest), [], "no staging directory left");
    await settle(pids);
    assert.deepEqual(pids().filter(alive), []);
  });
});

test("fetchRemoteTree in a session: more module repos than batch readers (BATCH_LIMIT) all copy, concurrently", async () => {
  const base = scratch();
  const repos = Array.from({ length: 16 }, (_, i) => {
    const bare = join(base, `r${i}.git`), work = join(base, `w${i}`);
    git(base, "init", "-q", "--bare", "-b", "main", bare);
    git(base, "init", "-q", "-b", "main", work);
    for (let f = 0; f < 5; f++) write(work, `mod/f${f}.txt`, `repo ${i} file ${f}\n`);
    git(work, "add", "-A"); git(work, "commit", "-q", "-m", "one"); git(work, "push", "-q", bare, "HEAD:main");
    return { bare, commit: git(work, "rev-parse", "HEAD") };
  });
  const cacheDir = join(base, "cache");
  const session = createReadSession();
  const results = await Promise.all(repos.map((r, i) => fetchRemoteTree(r.bare, r.commit, "mod", join(base, "batch", `m${i}`), { cacheDir, session })));
  assert.ok(session.batches.size < repos.length, "evicted readers were ended, not kept");
  for (const [i, r] of repos.entries()) {
    assert.deepStrictEqual(results[i], await fetchRemoteTree(r.bare, r.commit, "mod", join(base, "plain", `m${i}`), { cacheDir }));
  }
  await session.close();
});
