/** lib/remote.mjs read-session deadline (the module header's DEADLINE; `oats status` and `oats workspace
 *  status` only): every remote step gets what is left of it — git timeouts, the write lock's wait, the
 *  half-initialised cache's wait, the batch readers — and ends as a `timeout`; a wait it cuts never steals a
 *  live lock or replaces a directory it has not waited for in full. Without a deadline, nothing changes. */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReadSession, observeRemote, GIT_TIMEOUT_MS, READ_REMOTE_BUDGET_MS } from "../lib/remote.mjs";

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd, ...args) => execFileSync("git", args, { cwd, env: GIT_ENV, stdio: ["ignore", "pipe", "pipe"] }).toString("utf8").trim();
const roots = [];
function scratch() { const d = mkdtempSync(join(tmpdir(), "oats-deadline-")); roots.push(d); return d; }
test.after(() => { for (const d of roots) rmSync(d, { recursive: true, force: true }); });

function fixture() {
  const base = scratch();
  const bare = join(base, "remote.git"), work = join(base, "work");
  git(base, "init", "-q", "--bare", "-b", "main", bare);
  git(base, "init", "-q", "-b", "main", work);
  writeFileSync(join(work, "README.md"), "# hi\n");
  git(work, "add", "-A"); git(work, "commit", "-q", "-m", "one"); git(work, "push", "-q", bare, "HEAD:main");
  const cacheDir = join(base, "cache");
  const repoDir = join(cacheDir, createHash("sha256").update(`local/${bare}`).digest("hex"));
  return { base, bare, cacheDir, repoDir, commit: git(work, "rev-parse", "HEAD") };
}
const caught = (promise) => promise.then(() => assert.fail("expected a refusal"), (e) => e);

/** An exec that answers nothing until its timeout, then fails as runGit's own timer does. */
function hangingExec(calls) {
  return (args, opts = {}) => {
    calls.push({ args, timeout: opts.timeout });
    return new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error(`Command failed: git ${args.join(" ")} (timed out after ${opts.timeout} ms)`),
      { code: null, killed: true, signal: "SIGTERM", timedOut: true, overflowed: false, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) })), opts.timeout ?? GIT_TIMEOUT_MS));
  };
}

test("the budget is 12 s; a session takes a deadline or none, and remaining() cuts a wait to it", () => {
  assert.equal(READ_REMOTE_BUDGET_MS, 12_000);
  assert.throws(() => createReadSession({ deadline: "soon" }), TypeError);
  const open = createReadSession();
  assert.equal(open.remaining(30_000), 30_000);
  assert.equal(open.expired(), false);
  const bounded = createReadSession({ deadline: Date.now() + 5_000 });
  assert.ok(bounded.remaining(30_000) <= 5_000 && bounded.remaining(30_000) > 4_000);
  assert.equal(bounded.remaining(100), 100);
  const past = createReadSession({ deadline: Date.now() - 1 });
  assert.equal(past.remaining(30_000), 0);
  assert.equal(past.expired(), true);
});

test("an observation not done by the deadline is a timeout at the deadline; past it, no git starts", async () => {
  const calls = [];
  const session = createReadSession({ deadline: Date.now() + 400 });
  const started = Date.now();
  const e = await caught(observeRemote("https://example.invalid/org/slow", { cacheDir: scratch(), session, exec: hangingExec(calls) }));
  const elapsed = Date.now() - started;
  assert.equal(e.code, "E_REMOTE_UNREADABLE");
  assert.deepEqual([e.details.reason, e.details.url, e.details.at], ["timeout", "https://example.invalid/org/slow.git", null]);
  assert.ok(elapsed >= 300 && elapsed < 3_000, `ended at the deadline (${elapsed} ms)`);
  const lsRemote = calls.filter((c) => c.args.includes("ls-remote"));
  assert.equal(lsRemote.length, 1);
  assert.ok(lsRemote[0].timeout > 0 && lsRemote[0].timeout <= 400, `ls-remote got what was left (${lsRemote[0].timeout} ms)`);
  // Past the deadline: the same typed timeout, and no git process at all.
  const before = calls.length;
  const late = await caught(observeRemote("https://example.invalid/org/other", { cacheDir: scratch(), session, exec: hangingExec(calls) }));
  assert.deepEqual([late.code, late.details.reason], ["E_REMOTE_UNREADABLE", "timeout"]);
  assert.equal(calls.length, before, "no git started after the deadline");
  await session.close();
});

test("without a deadline every git call keeps its own timeout (ls-remote GIT_TIMEOUT_MS)", async () => {
  const f = fixture();
  const seen = [];
  const { runGit } = await import("../lib/remote.mjs");
  const exec = (args, opts) => { seen.push({ verb: args.find((a) => ["ls-remote", "fetch", "init", "rev-parse"].includes(a)), timeout: opts?.timeout }); return runGit(args, opts); };
  const session = createReadSession();
  await observeRemote(f.bare, { cacheDir: f.cacheDir, session, exec });
  await session.close();
  assert.equal(seen.find((s) => s.verb === "ls-remote").timeout, GIT_TIMEOUT_MS);
  assert.equal(seen.find((s) => s.verb === "rev-parse").timeout, undefined, "a cache plumbing call passes no timeout of its own, as before");
});

test("the cache write lock's wait ends at the deadline as a timeout naming the live holder, whose lock is untouched", async () => {
  const f = fixture();
  const holder = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"], { stdio: "ignore" });
  try {
    const lock = join(f.cacheDir, ".locks", `${f.repoDir.split("/").pop()}.lock`);
    mkdirSync(join(lock, ".."), { recursive: true });
    writeFileSync(lock, JSON.stringify({ pid: holder.pid, token: "t".repeat(24), startedAt: "2026-10-01T00:00:00.000Z" }) + "\n");
    const before = readFileSync(lock, "utf8");
    const session = createReadSession({ deadline: Date.now() + 600 }); // the lock's own wait is 11 minutes
    const started = Date.now();
    const e = await caught(observeRemote(f.bare, { cacheDir: f.cacheDir, at: f.commit, session }));
    const elapsed = Date.now() - started;
    await session.close();
    assert.ok(elapsed >= 500 && elapsed < 5_000, `waited until the deadline only (${elapsed} ms)`);
    assert.equal(e.code, "E_REMOTE_UNREADABLE");
    assert.deepEqual([e.details.reason, e.details.stage, e.details.cacheDir, e.details.lock, e.details.holderPid], ["timeout", "fetch", f.repoDir, lock, holder.pid]);
    assert.match(e.message, new RegExp(`\\(timeout, fetch\\): the read budget ended while oats process ${holder.pid} held its write lock `));
    assert.equal(readFileSync(lock, "utf8"), before, "the live holder's lock is untouched");
    assert.equal(existsSync(f.repoDir), false, "nothing was written");
  } finally { holder.kill(); }
});

test("a half-initialised cache directory is never replaced on a wait the deadline cut short: the read is a timeout", async () => {
  const f = fixture();
  mkdirSync(f.repoDir, { recursive: true });
  writeFileSync(join(f.repoDir, "leftover"), "an older kernel initialising in place\n"); // no HEAD
  const session = createReadSession({ deadline: Date.now() + 500 }); // the directory's own wait is 2 s
  const started = Date.now();
  const e = await caught(observeRemote(f.bare, { cacheDir: f.cacheDir, at: f.commit, session }));
  const elapsed = Date.now() - started;
  await session.close();
  assert.equal(e.code, "E_REMOTE_UNREADABLE");
  assert.deepEqual([e.details.reason, e.details.stage, e.details.cacheDir], ["timeout", "init", f.repoDir]);
  assert.ok(elapsed < 1_800, `ended before the directory's own wait (${elapsed} ms)`);
  assert.equal(readFileSync(join(f.repoDir, "leftover"), "utf8"), "an older kernel initialising in place\n", "the directory is untouched");
  // Without a deadline the same directory is waited for in full, then taken for a leftover (today's rule).
  const open = createReadSession();
  const obs = await observeRemote(f.bare, { cacheDir: f.cacheDir, at: f.commit, session: open });
  await open.close();
  assert.equal(obs.commit, f.commit);
});

/** A `git` first on PATH whose `ls-remote` records its pid, then every SIGTERM it gets (`ignore`: and keeps
 *  running), and never answers; every other git call is the real git. */
function lsRemoteShim(base, mode) {
  const dir = join(base, "shim"), log = join(base, "signals");
  const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  mkdirSync(dir, { recursive: true });
  writeFileSync(log, "");
  writeFileSync(join(dir, "git"), `#!/bin/bash
ls=""; for a in "$@"; do [ "$a" = "ls-remote" ] && ls=1; done
[ -z "$ls" ] && exec "${realGit}" "$@"
trap 'echo TERM >> "${log}"; ${mode === "ignore" ? ":" : "exit 143"}' TERM
echo "pid $$" >> "${log}"
while true; do sleep 0.05; done
`, { mode: 0o755 });
  return { dir, log };
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(check, ms) { const end = Date.now() + ms; while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 25)); return check(); }

test("a git the deadline ends gets SIGTERM first (terminateGroup), never a bare SIGKILL; SIGKILL only reaches a group still populated after the grace", { timeout: 30_000 }, async () => {
  for (const mode of ["exit", "ignore"]) {
    const f = fixture();
    const shim = lsRemoteShim(f.base, mode);
    const saved = process.env.PATH;
    process.env.PATH = `${shim.dir}:${saved}`;
    try {
      // Long enough for the shim to start and trap SIGTERM on a loaded machine.
      const session = createReadSession({ deadline: Date.now() + 2_000 });
      const e = await caught(observeRemote(f.bare, { cacheDir: f.cacheDir, session }));
      assert.deepEqual([e.code, e.details.reason], ["E_REMOTE_UNREADABLE", "timeout"], mode);
      const lines = () => readFileSync(shim.log, "utf8").split("\n").filter(Boolean);
      const started = lines().find((l) => l.startsWith("pid "));
      assert.ok(started, `${mode}: the ls-remote shim started before the deadline`);
      const pid = Number(started.split(" ")[1]);
      assert.ok(await until(() => lines().includes("TERM"), 2_000), `${mode}: the deadline's kill is a SIGTERM git can act on`);
      if (mode === "exit") assert.ok(await until(() => !alive(pid), 2_000), "a git that ends on SIGTERM is gone, before any SIGKILL");
      else {
        await new Promise((r) => setTimeout(r, 1_000));
        assert.equal(alive(pid), true, "within the grace a group still populated is not SIGKILLed");
        assert.ok(await until(() => !alive(pid), 4_000), "after the grace it is");
      }
      await session.close();
    } finally { process.env.PATH = saved; }
  }
});

test("a lock wait the deadline cuts never steals or deletes a lock: an ownerless, recent one stays too", async () => {
  const f = fixture();
  const lock = join(f.cacheDir, ".locks", `${f.repoDir.split("/").pop()}.lock`);
  mkdirSync(join(lock, ".."), { recursive: true });
  writeFileSync(lock, "not a lock record\n"); // no readable owner, younger than the 30 s it is judged by
  const session = createReadSession({ deadline: Date.now() + 400 });
  const e = await caught(observeRemote(f.bare, { cacheDir: f.cacheDir, at: f.commit, session }));
  await session.close();
  assert.deepEqual([e.code, e.details.reason, e.details.stage, e.details.lock, e.details.holderPid], ["E_REMOTE_UNREADABLE", "timeout", "fetch", lock, undefined]);
  assert.match(e.message, /the read budget ended while another process held its write lock /);
  assert.equal(readFileSync(lock, "utf8"), "not a lock record\n", "the lock is untouched");
  assert.equal(existsSync(`${lock}.reclaim`), false, "no reclaim was attempted");
  assert.equal(existsSync(f.repoDir), false, "nothing was written");
});

test("the git version probe is bounded too: asked with what is left, waited for no longer, never taken for an older git", async () => {
  const f = fixture();
  await observeRemote(f.bare, { cacheDir: f.cacheDir, at: f.commit }); // a warm cache: only local plumbing remains
  const { runGit } = await import("../lib/remote.mjs");
  let versionOpts = null;
  const slowVersion = async (args, opts) => {
    if (args[0] === "--version") { versionOpts = opts; await new Promise((r) => setTimeout(r, 1_500)); }
    return runGit(args, opts);
  };
  const session = createReadSession({ deadline: Date.now() + 300 });
  const started = Date.now();
  const e = await caught(observeRemote(f.bare, { cacheDir: f.cacheDir, at: f.commit, session, exec: slowVersion }));
  const elapsed = Date.now() - started;
  await session.close();
  assert.deepEqual([e.code, e.details.reason], ["E_REMOTE_UNREADABLE", "timeout"]);
  assert.ok(elapsed < 1_200, `ended at the deadline, not when the probe answered (${elapsed} ms)`);
  assert.ok(versionOpts.timeout > 0 && versionOpts.timeout <= 300, "the probe got what was left");
  assert.ok(versionOpts.signal instanceof AbortSignal, "and the session's signal");
});

test("a deadline that ends the peel of a commit just fetched is a timeout, never a missing commit", async () => {
  const f = fixture();
  const { runGit } = await import("../lib/remote.mjs");
  let fetched = false;
  const exec = async (args, opts) => {
    if (fetched && args.includes("rev-parse")) {
      await new Promise((r) => setTimeout(r, opts.timeout)); // the peel runs until the deadline's timeout
      throw Object.assign(new Error("timed out"), { code: null, killed: true, signal: "SIGTERM", timedOut: true, overflowed: false, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) });
    }
    const out = await runGit(args, opts);
    if (args.includes("fetch")) fetched = true;
    return out;
  };
  const session = createReadSession({ deadline: Date.now() + 1_500 });
  const e = await caught(observeRemote(f.bare, { cacheDir: f.cacheDir, at: f.commit, session, exec }));
  await session.close();
  assert.equal(fetched, true);
  assert.deepEqual([e.code, e.details.reason, e.details.commit, e.details.stage], ["E_REMOTE_UNREADABLE", "timeout", f.commit, "fetch"]);
});

test("past the deadline no lock is taken or reclaimed: a stale one stays, whether the deadline passed before the wait or during it", async () => {
  const f = fixture();
  const { utimesSync } = await import("node:fs");
  const lock = join(f.cacheDir, ".locks", `${f.repoDir.split("/").pop()}.lock`);
  mkdirSync(join(lock, ".."), { recursive: true });
  // Already expired, an abandoned (ownerless, old) lock in place.
  writeFileSync(lock, "unreadable owner\n");
  utimesSync(lock, new Date(0), new Date(0));
  let session = createReadSession({ deadline: Date.now() - 1 });
  let e = await caught(observeRemote(f.bare, { cacheDir: f.cacheDir, at: f.commit, session }));
  await session.close();
  assert.deepEqual([e.details.reason, existsSync(lock)], ["timeout", true]);
  // A lock that turns stale while the waiter is descheduled across the deadline.
  const now = Date.now();
  utimesSync(lock, new Date(now - 29_800), new Date(now - 29_800));
  session = createReadSession({ deadline: now + 200 });
  const block = setTimeout(() => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150); }, 150);
  e = await caught(observeRemote(f.bare, { cacheDir: f.cacheDir, at: f.commit, session }));
  clearTimeout(block);
  await session.close();
  assert.deepEqual([e.details.reason, existsSync(lock)], ["timeout", true]);
  assert.equal(readFileSync(lock, "utf8"), "unreadable owner\n");
  assert.equal(existsSync(`${lock}.reclaim`), false);
});
