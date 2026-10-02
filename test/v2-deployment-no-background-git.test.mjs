// The deployment fixture's repositories never start background git (awebai/oats#451). A commit runs
// `git maintenance run --auto --detach` (Git >= 2.47), a daemon that outlives the commit and can repack into
// the member clone while a fast test's cleanup removes the deployment: ENOTEMPTY on the base directory. The
// fixture's repositories turn auto maintenance off, so no git run in them, a test's or the kernel's, leaves one.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

test("a commit in a spawned worktree starts no background maintenance", async (t) => {
  const fx = v2Deployment({ souls: { dev: { soul: { work: "worktree" } } } });
  t.after(fx.cleanup);
  const hostPath = process.env.PATH; process.env.PATH = fx.env.PATH; t.after(() => { process.env.PATH = hostPath; });
  const r = await fx.spawn("dev", { instance: "dev-bg", work: "worktree" });
  const work = join(r.home, "work");
  writeFileSync(join(work, "u.txt"), "x\n");
  const trace = join(fx.base, "git-trace.log");
  const git = (...a) => execFileSync("git", ["-C", work, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a], { env: { ...process.env, GIT_TRACE: trace } });
  git("add", "u.txt"); git("commit", "-qm", "u");
  assert.ok(existsSync(trace), "git traced the commit");
  assert.doesNotMatch(readFileSync(trace, "utf8"), /maintenance run --auto/, "no auto maintenance was started");
  for (const repo of [fx.repo, fx.member]) {
    assert.equal(execFileSync("git", ["-C", repo, "config", "--get", "maintenance.auto"], { encoding: "utf8" }).trim(), "false", repo);
  }
});

test("the kernel's remote cache starts no background maintenance when it fetches", async (t) => {
  const fx = v2Deployment({ souls: { dev: { soul: { work: "worktree" } } } });
  t.after(fx.cleanup);
  const saved = { PATH: process.env.PATH, GIT_TRACE: process.env.GIT_TRACE };
  const trace = join(fx.base, "kernel-trace.log");
  process.env.PATH = fx.env.PATH; process.env.GIT_TRACE = trace;
  t.after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  await fx.spawn("dev", { instance: "dev-cache", work: "worktree" });
  delete process.env.GIT_TRACE;
  const text = readFileSync(trace, "utf8");
  assert.match(text, /built-in: git fetch -q --depth 1 /, "the spawn fetched a commit into the remote cache");
  assert.doesNotMatch(text, /maintenance run --auto/, "no auto maintenance was started");
});
