// lib/remote.mjs (#728): a peel git did not finish in time is the read's timeout, never a missing commit. It is
// judged by git's own result (`timedOut`), not by the wall clock: git's timer can fire a moment before Date.now()
// reaches the deadline, and the commit fetched a moment earlier was then reported "missing, not a commit".
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReadSession, observeRemote, runGit } from "../lib/remote.mjs";

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd, ...args) => execFileSync("git", args, { cwd, env: GIT_ENV, stdio: ["ignore", "pipe", "pipe"] }).toString("utf8").trim();
const roots = [];
test.after(() => { for (const d of roots) rmSync(d, { recursive: true, force: true }); });
function fixture() {
  const base = mkdtempSync(join(tmpdir(), "oats-peel-timeout-")); roots.push(base);
  const bare = join(base, "remote.git"), work = join(base, "work");
  git(base, "init", "-q", "--bare", "-b", "main", bare);
  git(base, "init", "-q", "-b", "main", work);
  writeFileSync(join(work, "README.md"), "# hi\n");
  git(work, "add", "-A"); git(work, "commit", "-q", "-m", "one"); git(work, "push", "-q", bare, "HEAD:main");
  return { bare, cacheDir: join(base, "cache"), commit: git(work, "rev-parse", "HEAD") };
}
const caught = (promise) => promise.then(() => assert.fail("expected a refusal"), (e) => e);
/** git's own timeout, as runGit's timer reports it. */
const gitTimedOut = (args) => Object.assign(new Error(`Command failed: git ${args.join(" ")} (timed out)`),
  { code: null, killed: true, signal: "SIGTERM", timedOut: true, overflowed: false, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) });

test("a peel git's timer ends 1 ms before the deadline is the read's timeout, never a missing commit", async (t) => {
  const f = fixture();
  // The test owns Date.now(): git's timer fires 1 ms before the wall clock reaches the deadline.
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const deadline = Date.now() + 20_000;
  let fetched = false;
  const exec = async (args, opts) => {
    if (fetched && args.includes("rev-parse")) { t.mock.timers.tick(opts.timeout - 1); throw gitTimedOut(args); }
    const out = await runGit(args, opts);
    if (args.includes("fetch")) fetched = true;
    return out;
  };
  const session = createReadSession({ deadline });
  const e = await caught(observeRemote(f.bare, { cacheDir: f.cacheDir, at: f.commit, session, exec }));
  await session.close();
  assert.equal(fetched, true, "the commit was fetched");
  assert.ok(Date.now() < deadline, "the wall clock had not reached the deadline");
  assert.deepEqual([e.code, e.details.reason, e.details.commit, e.details.stage], ["E_REMOTE_UNREADABLE", "timeout", f.commit, "fetch"]);
});

test("a peel of a commit already in the cache that times out is a timeout too, not a refetch or a missing commit; no deadline needed", async () => {
  const f = fixture();
  await observeRemote(f.bare, { cacheDir: f.cacheDir, at: f.commit }); // in the cache now
  const calls = [];
  const exec = async (args, opts) => {
    calls.push(args[0] === "-C" ? args[2] : args[0]);
    if (args.includes("rev-parse") && args.some((a) => a.endsWith("^{commit}"))) throw gitTimedOut(args);
    return runGit(args, opts);
  };
  const e = await caught(observeRemote(f.bare, { cacheDir: f.cacheDir, at: f.commit, exec }));
  assert.deepEqual([e.code, e.details.reason, e.details.commit, e.details.stage], ["E_REMOTE_UNREADABLE", "timeout", f.commit, "fetch"]);
  assert.ok(!calls.includes("fetch"), `nothing was refetched (${calls.join(", ")})`);
});

test("a peel that answers keeps its answer: a commit already in the cache resolves", async () => {
  const f = fixture();
  await observeRemote(f.bare, { cacheDir: f.cacheDir, at: f.commit });
  const obs = await observeRemote(f.bare, { cacheDir: f.cacheDir, at: f.commit });
  assert.equal(obs.commit, f.commit);
});
