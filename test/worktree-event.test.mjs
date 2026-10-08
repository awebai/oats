// The `worktree` hook event and `oats worktree add|remove` (#796), against a real scratch
// deployment: the member clone has a bare `origin`, the soul composes a capability whose
// `worktree` hook records what it saw (cwd, stdin, env) and can be told to fail, sleep, or
// return env. Every `add` runs through the real CLI from the instance home.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn as spawnChild } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLI, v2Deployment } from "./helpers/v2-deployment.mjs";
import { listInstances, retireInstance } from "../lib/core.mjs";

/** The hook: appends one JSON line of facts to <OATS_ROOT>/hook-runs.jsonl, then acts on files in
 *  <OATS_ROOT>: `hook-fail` (exit 3), `hook-sleep` (sleep N s, writing its pid first), `hook-env`
 *  (answer env), `hook-warning` (answer a warning), `hook-rm-tree` (remove the tree). */
const HOOK = `import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const root = process.env.OATS_ROOT;
let stdin = "";
try { stdin = readFileSync(0, "utf8"); } catch (e) { stdin = "ERR:" + e.code; }
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith("OATS_")));
appendFileSync(join(root, "hook-runs.jsonl"), JSON.stringify({ cwd: process.cwd(), stdin, tty: process.stdin.isTTY === true, env, pid: process.pid, spawnRanBefore: existsSync(join(root, "spawn-ran")) }) + "\\n");
console.log("hook says hello on stdout");
console.log("SECRET-MARKER-OUT"); console.error("SECRET-MARKER-ERR");
console.error("hook says hello on stderr");
if (existsSync(join(root, "hook-rm-tree"))) rmSync(process.env.OATS_TREE, { recursive: true, force: true });
if (existsSync(join(root, "hook-stubborn"))) {
  // A member of the hook's group that ignores SIGTERM: only the SIGKILL ends it.
  const { spawn } = await import("node:child_process");
  // One process (exec), so the pid written is the member itself: no child of it can outlive a kill of that pid.
  const c = spawn("/bin/sh", ["-c", "trap '' TERM; exec sleep 60"], { stdio: "ignore" });
  writeFileSync(join(root, "hook-stubborn-pid"), String(c.pid));
}
if (existsSync(join(root, "hook-sleep"))) {
  writeFileSync(join(root, "hook-sleeping"), String(process.pid));
  await new Promise((r) => setTimeout(r, Number(readFileSync(join(root, "hook-sleep"), "utf8")) * 1000));
}
if (existsSync(join(root, "hook-fail"))) { console.log(JSON.stringify({ warning: "setup broke: run the install by hand" })); process.exit(3); }
if (existsSync(join(root, "hook-env"))) { console.log(JSON.stringify({ env: { TEST_X: "1" } })); process.exit(0); }
if (existsSync(join(root, "hook-warning"))) { console.log(JSON.stringify({ warning: "node_modules is large", meta: { ignored: true } })); process.exit(0); }
`;

const LIFECYCLE = { "spawn.mjs": `import { appendFileSync } from "node:fs"; import { join } from "node:path"; appendFileSync(join(process.env.OATS_ROOT, "spawn-ran"), "x\\n"); console.log(JSON.stringify({ meta: { made: true } }));\n`,
  "retire.mjs": `import { appendFileSync } from "node:fs"; import { join } from "node:path"; appendFileSync(join(process.env.OATS_ROOT, "retire-ran"), process.env.OATS_INSTANCE + "\\n"); console.log(JSON.stringify({ meta: { retired: true } }));\n` };
/** The kernel runs a hook as `/bin/sh -c "node '<script>'"`. bash execs that single command in place, so
 *  the hook's own pid leads its group; dash forks it, so `sh` leads the group and the hook is its child.
 *  OATS_TEST_FORK_HOOK_SHELL=1 gives the fixture's hook dash's shape under any /bin/sh (`hook.mjs ; exit $?`
 *  makes every shell fork). The tests never assume the hook's pid is its group's: they read it (pgidOf). */
const HOOK_COMMAND = process.env.OATS_TEST_FORK_HOOK_SHELL === "1" ? "hook.mjs ; exit $?" : "hook.mjs";
/** A process's group id, as `ps` reports it (Linux and macOS). */
const pgidOf = (pid) => Number(execFileSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8" }).trim());
function deployment(t, { required = true, work = "checkout", hookless = false, lifecycle = false } = {}) {
  const hooks = { worktree: required ? { command: HOOK_COMMAND, required: true } : HOOK_COMMAND, ...(lifecycle ? { spawn: "spawn.mjs", retire: "retire.mjs" } : {}) };
  const capabilities = hookless ? {} : { "test.setup": { manifest: { hooks }, files: { "hook.mjs": HOOK, ...(lifecycle ? LIFECYCLE : {}) } } };
  const fx = v2Deployment({ souls: { dev: { soul: { work, ...(hookless ? {} : { capabilities: { "test.setup": { from: "here" } } }) } } }, capabilities });
  t.after(fx.cleanup);
  // The kernel's git keeps the invoker's configuration (private repositories need its credential helpers).
  // Its tests must not: a system or global helper (macOS Git's osxkeychain) can wait on a prompt nobody
  // answers. So no system or global config, no prompt, no askpass, and no credential helper.
  Object.assign(fx.env, { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "",
    GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "credential.helper", GIT_CONFIG_VALUE_0: "" });
  const hostPath = process.env.PATH; process.env.PATH = fx.env.PATH; t.after(() => { process.env.PATH = hostPath; });
  return fx;
}
const gitIn = (fx, cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", env: fx.env, stdio: ["ignore", "pipe", "pipe"] }).trim();
const tipOf = (fx, branch) => { try { return gitIn(fx, fx.member, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`); } catch { return null; } };
const registered = (fx, path) => gitIn(fx, fx.member, "worktree", "list", "--porcelain").split("\n").includes(`worktree ${path}`);
const runs = (fx) => existsSync(join(fx.root, "hook-runs.jsonl")) ? readFileSync(join(fx.root, "hook-runs.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
/** `oats worktree …` from the home, as an agent runs it. */
const wt = (fx, home, args, extra = {}) => fx.cli(["worktree", ...args], { cwd: home, env: { OATS_INSTANCE_HOME: home, ...extra } });
const add = (fx, home, purpose = "feat", more = []) => wt(fx, home, ["add", "--purpose", purpose, "--branch", `agents/${purpose}`, "--base", "main", "--json", ...more]);
const originMain = (fx) => gitIn(fx, fx.repo, "rev-parse", "refs/heads/main");

test("add: the tree starts at origin's base, the hook runs in it without stdin, its output is logged and on stderr only", async (t) => {
  const fx = deployment(t);
  const { home } = await fx.spawn("dev", { instance: "dev-a", work: "checkout" });
  // The clone is behind origin: the tree must start at origin's main, not the clone's checkout.
  const ahead = fx.commit({ "later.txt": "x\n" });
  gitIn(fx, fx.member, "reset", "-q", "--hard", "HEAD~1");
  const cloneHead = gitIn(fx, fx.member, "rev-parse", "HEAD");
  const r = add(fx, home);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const lines = r.stdout.trim().split("\n");
  assert.equal(lines.length, 1, "stdout holds exactly one envelope");
  const res = JSON.parse(lines[0]).result;
  const tree = join(home, ".work-feat");
  assert.equal(res.path, tree);
  assert.equal(res.baseOid, ahead);
  assert.equal(gitIn(fx, tree, "rev-parse", "HEAD"), ahead, "HEAD is the fetched base");
  assert.equal(gitIn(fx, tree, "rev-parse", "--abbrev-ref", "HEAD"), "agents/feat");
  assert.equal(gitIn(fx, fx.member, "rev-parse", "HEAD"), cloneHead, "the clone's checkout did not move");
  assert.deepEqual(res.hooks.map(({ capability, ok, required }) => ({ capability, ok, required })), [{ capability: "test.setup", ok: true, required: true }]);
  const [run] = runs(fx);
  assert.equal(run.cwd, tree, "cwd is the new tree");
  assert.equal(run.stdin, "", "stdin is empty (EOF)");
  assert.equal(run.tty, false);
  assert.equal(run.env.OATS_EVENT, "worktree");
  assert.equal(run.env.OATS_TREE, tree);
  assert.equal(run.env.OATS_TREE_CLONE, fx.member);
  assert.equal(run.env.OATS_TREE_REMOTE, fx.repo);
  assert.equal(run.env.OATS_TREE_MEMBER, fx.key);
  assert.equal(run.env.OATS_BRANCH, "agents/feat");
  assert.equal(run.env.OATS_TREE_BASE, "main");
  assert.equal(run.env.OATS_TREE_BASE_OID, ahead);
  assert.equal(run.env.OATS_PURPOSE, "feat");
  assert.equal(run.env.OATS_TREE_ORIGIN, "add");
  assert.equal(run.env.OATS_INSTANCE_HOME, home);
  assert.equal(run.env.OATS_CAPABILITY, "test.setup");
  const log = res.hooks[0].log;
  assert.equal(log, join(home, ".oats", "logs", "worktree-feat-test.setup.log"));
  assert.match(readFileSync(log, "utf8"), /hello on stdout[\s\S]*hello on stderr|hello on stderr[\s\S]*hello on stdout/);
  assert.equal(statSync(log).mode & 0o777, 0o600);
  assert.match(r.stderr, /hook says hello on stdout/, "the hook's output is streamed to stderr");
  const rec = JSON.parse(readFileSync(join(home, ".oats", "trees", "feat.json"), "utf8"));
  assert.equal(rec.state, "ready");
  assert.equal(rec.baseOid, ahead);
  const events = readFileSync(join(home, ".oats-events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(events.some((e) => e.kind === "worktree-added" && e.data.purpose === "feat" && e.data.baseOid === ahead));
});

test("add again with the same arguments is a no-op: no git step, no hook; different arguments are refused naming the field", async (t) => {
  const fx = deployment(t);
  const { home } = await fx.spawn("dev", { instance: "dev-b", work: "checkout" });
  const first = add(fx, home);
  assert.equal(first.status, 0, first.stderr);
  const again = add(fx, home);
  assert.equal(again.status, 0, again.stderr);
  const res = again.json().result;
  assert.equal(res.resumed, true);
  assert.equal(res.hooks.length, 1, "the recorded receipt");
  assert.equal(runs(fx).length, 1, "the hook ran once");
  const other = wt(fx, home, ["add", "--purpose", "feat", "--branch", "agents/other", "--base", "main", "--json"]);
  assert.notEqual(other.status, 0);
  const err = other.json().error;
  assert.equal(err.code, "E_PLACEMENT_TAKEN");
  assert.deepEqual(err.details.differ, ["branch"]);
  assert.equal(runs(fx).length, 1);
});

test("a required hook failure removes the tree, deletes the branch it made and exits nonzero naming the capability and its log", async (t) => {
  const fx = deployment(t);
  const { home } = await fx.spawn("dev", { instance: "dev-c", work: "checkout" });
  writeFileSync(join(fx.root, "hook-fail"), "");
  const r = add(fx, home);
  assert.notEqual(r.status, 0);
  const err = r.json().error;
  assert.equal(err.code, "E_REQUIRED_HOOK_FAILED");
  assert.match(err.message, /test\.setup: setup broke: run the install by hand/);
  assert.match(err.message, /worktree-feat-test\.setup\.log/);
  assert.equal(err.details.rolledBack, true);
  assert.equal(err.details.hooks[0].capability, "test.setup");
  assert.equal(existsSync(join(home, ".work-feat")), false, "the tree is removed");
  assert.equal(registered(fx, join(home, ".work-feat")), false);
  assert.equal(tipOf(fx, "agents/feat"), null, "the branch is deleted");
  assert.equal(existsSync(join(home, ".oats", "trees", "feat.json")), false, "the record is dropped");
  assert.ok(existsSync(join(home, ".oats", "logs", "worktree-feat-test.setup.log")), "the log stays");
});

test("a hook that is not required warns and keeps the tree; a returned env is a contract error that rolls back", async (t) => {
  const fx = deployment(t, { required: false });
  const { home } = await fx.spawn("dev", { instance: "dev-d", work: "checkout" });
  writeFileSync(join(fx.root, "hook-fail"), "");
  const r = add(fx, home);
  assert.equal(r.status, 0, r.stderr);
  const res = r.json().result;
  assert.equal(res.hooks[0].ok, false);
  assert.ok(res.warnings.some((w) => /test\.setup worktree hook failed \(the tree is kept\)/.test(w)), JSON.stringify(res.warnings));
  assert.ok(existsSync(join(home, ".work-feat")));
  assert.equal(res.state, "ready");
  execFileSync("rm", [join(fx.root, "hook-fail")]);
  writeFileSync(join(fx.root, "hook-env"), "");
  const e = add(fx, home, "envy");
  assert.notEqual(e.status, 0);
  assert.equal(e.json().error.code, "E_HOOK_ENVIRONMENT_CONTRACT");
  assert.equal(existsSync(join(home, ".work-envy")), false);
  assert.equal(tipOf(fx, "agents/envy"), null);
});

test("a hook answer's warning is reported and the rest of the answer is ignored", async (t) => {
  const fx = deployment(t);
  const { home } = await fx.spawn("dev", { instance: "dev-w", work: "checkout" });
  writeFileSync(join(fx.root, "hook-warning"), "");
  const r = add(fx, home);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.json().result.warnings, ["test.setup worktree hook: node_modules is large"]);
});

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const waitFor = async (cond, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (cond()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };

test("a hook past the timeout has its process group ended and fails as a required hook", async (t) => {
  const fx = deployment(t);
  const { home } = await fx.spawn("dev", { instance: "dev-e", work: "checkout" });
  writeFileSync(join(fx.root, "hook-sleep"), "60");
  const rr = wt(fx, home, ["add", "--purpose", "slow2", "--branch", "agents/slow2", "--base", "main", "--json"], { OATS_TEST_WORKTREE_HOOK_TIMEOUT_MS: "1500" });
  assert.notEqual(rr.status, 0);
  const err = rr.json().error;
  assert.equal(err.code, "E_REQUIRED_HOOK_FAILED");
  assert.match(err.message, /timed out/);
  assert.equal(err.details.hooks.at(-1).timedOut, true);
  const pid = Number(readFileSync(join(fx.root, "hook-sleeping"), "utf8"));
  assert.ok(await waitFor(() => !alive(pid), 5000), "the hook process is gone");
  assert.equal(existsSync(join(home, ".work-slow2")), false);
});

test("a timed-out hook's group member that ignores SIGTERM is SIGKILLed before the answer", async (t) => {
  const fx = deployment(t);
  const { home } = await fx.spawn("dev", { instance: "dev-g", work: "checkout" });
  writeFileSync(join(fx.root, "hook-sleep"), "60");
  writeFileSync(join(fx.root, "hook-stubborn"), "");
  const r = wt(fx, home, ["add", "--purpose", "slow", "--branch", "agents/slow", "--base", "main", "--json"], { OATS_TEST_WORKTREE_HOOK_TIMEOUT_MS: "1500" });
  assert.equal(r.json().error.code, "E_REQUIRED_HOOK_FAILED");
  const stubborn = Number(readFileSync(join(fx.root, "hook-stubborn-pid"), "utf8"));
  assert.equal(alive(stubborn), false, "the SIGTERM-ignoring member is gone when add answers");
});

/** The CLI as a child we can signal: → { child, done: Promise<{ status, signal, stdout, stderr }> }. */
function cliChild(fx, args, { cwd, env = {} }) {
  const child = spawnChild(process.execPath, [CLI, ...args], { cwd, env: { ...fx.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", (c) => { stdout += c; });
  child.stderr.on("data", (c) => { stderr += c; });
  const done = new Promise((resolve) => child.on("close", (status, signal) => resolve({ status, signal, stdout, stderr })));
  return { child, done };
}

test("killed parent, add: SIGTERM mid-hook rolls back and exits 143; SIGKILL leaves a record the next add completes, ending the orphaned hook", async (t) => {
  const fx = deployment(t);
  const { home } = await fx.spawn("dev", { instance: "dev-k", work: "checkout" });
  writeFileSync(join(fx.root, "hook-sleep"), "60");
  const argv = (p) => ["worktree", "add", "--purpose", p, "--branch", `agents/${p}`, "--base", "main", "--json"];

  const term = cliChild(fx, argv("term"), { cwd: home, env: { OATS_INSTANCE_HOME: home } });
  assert.ok(await waitFor(() => existsSync(join(fx.root, "hook-sleeping"))), "the hook started");
  const termHook = Number(readFileSync(join(fx.root, "hook-sleeping"), "utf8"));
  term.child.kill("SIGTERM");
  const tr = await term.done;
  assert.equal(tr.status, 143, tr.stderr);
  const env = JSON.parse(tr.stdout.trim().split("\n").pop());
  assert.equal(env.error.code, "E_INTERRUPTED");
  assert.equal(env.error.details.rolledBack, true);
  assert.ok(await waitFor(() => !alive(termHook), 5000), "the hook's group was ended");
  assert.equal(existsSync(join(home, ".work-term")), false);
  assert.equal(tipOf(fx, "agents/term"), null);
  assert.equal(existsSync(join(home, ".oats", "trees", "term.json")), false);

  execFileSync("rm", [join(fx.root, "hook-sleeping")]);
  const kill = cliChild(fx, argv("gone"), { cwd: home, env: { OATS_INSTANCE_HOME: home } });
  assert.ok(await waitFor(() => existsSync(join(fx.root, "hook-sleeping"))));
  const orphan = Number(readFileSync(join(fx.root, "hook-sleeping"), "utf8"));
  kill.child.kill("SIGKILL");
  await kill.done;
  const rec = JSON.parse(readFileSync(join(home, ".oats", "trees", "gone.json"), "utf8"));
  assert.equal(rec.state, "creating");
  assert.equal(rec.hookPgid, pgidOf(orphan), "the record names the hook's group");
  assert.equal(alive(orphan), true, "the hook outlived its parent");
  assert.ok(existsSync(join(home, ".work-gone")));
  // The next add of that purpose finishes the rollback (ending the orphan) and proceeds fresh.
  execFileSync("rm", [join(fx.root, "hook-sleep")]);
  const again = add(fx, home, "gone");
  assert.equal(again.status, 0, again.stderr + again.stdout);
  assert.equal(alive(orphan), false, "the orphaned hook group was ended");
  assert.equal(again.json().result.state, "ready");
  assert.equal(again.json().result.resumed, false);
});

test("killed parent, add: remove completes an interrupted add instead", async (t) => {
  const fx = deployment(t);
  const { home } = await fx.spawn("dev", { instance: "dev-r", work: "checkout" });
  writeFileSync(join(fx.root, "hook-sleep"), "60");
  const kill = cliChild(fx, ["worktree", "add", "--purpose", "gone", "--branch", "agents/gone", "--base", "main", "--json"], { cwd: home, env: { OATS_INSTANCE_HOME: home } });
  assert.ok(await waitFor(() => existsSync(join(fx.root, "hook-sleeping"))));
  const orphan = Number(readFileSync(join(fx.root, "hook-sleeping"), "utf8"));
  kill.child.kill("SIGKILL");
  await kill.done;
  const r = wt(fx, home, ["remove", "--purpose", "gone", "--json"]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(r.json().result.rolledBack, true);
  assert.equal(alive(orphan), false);
  assert.equal(existsSync(join(home, ".work-gone")), false);
  assert.equal(tipOf(fx, "agents/gone"), null, "the branch the add made at its base is deleted");
});

test("a live creating record is busy; a raw-git tree, a file or a symlink at the path is refused and never followed", async (t) => {
  const fx = deployment(t);
  const { home } = await fx.spawn("dev", { instance: "dev-z", work: "checkout" });
  mkdirSync(join(home, ".oats", "trees"), { recursive: true });
  // This test process stands in for a running add: its pid and start token are alive.
  const { selfIdentity } = await import("../lib/worktree-hooks.mjs");
  writeFileSync(join(home, ".oats", "trees", "busy.json"), JSON.stringify({ version: 1, purpose: "busy", state: "creating", clone: fx.member, branch: "agents/busy", base: "main", ...selfIdentity(), startedAt: "now" }));
  const busy = add(fx, home, "busy");
  assert.equal(busy.json().error.code, "E_LIFECYCLE_BUSY");
  gitIn(fx, fx.member, "worktree", "add", "-q", "--detach", join(home, ".work-raw"));
  const raw = add(fx, home, "raw");
  assert.equal(raw.json().error.code, "E_PLACEMENT_TAKEN");
  assert.match(raw.json().error.message, /git worktree remove/);
  writeFileSync(join(home, ".work-file"), "x");
  assert.equal(add(fx, home, "file").json().error.code, "E_PLACEMENT_TAKEN");
  const outside = join(fx.base, "outside"); mkdirSync(outside);
  symlinkSync(outside, join(home, ".work-link"));
  const link = add(fx, home, "link");
  assert.equal(link.json().error.code, "E_PLACEMENT_TAKEN");
  assert.match(link.json().error.message, /symbolic link/);
  assert.deepEqual(readdirSync(outside), [], "nothing was written through the link");
  assert.equal(runs(fx).length, 0, "no hook ran");
});

test("remove: a dirty tree is refused with E_WORKTREE_DIRTY and kept; a clean one is removed and its branch kept", async (t) => {
  const fx = deployment(t);
  const { home } = await fx.spawn("dev", { instance: "dev-m", work: "checkout" });
  assert.equal(add(fx, home).status, 0);
  const tree = join(home, ".work-feat");
  writeFileSync(join(tree, "scratch.txt"), "untracked\n");
  const dirty = wt(fx, home, ["remove", "--purpose", "feat", "--json"]);
  assert.notEqual(dirty.status, 0);
  assert.equal(dirty.json().error.code, "E_WORKTREE_DIRTY");
  assert.match(dirty.json().error.message, /commit and push/);
  assert.ok(existsSync(tree) && existsSync(join(home, ".oats", "trees", "feat.json")));
  execFileSync("rm", [join(tree, "scratch.txt")]);
  const tip = tipOf(fx, "agents/feat");
  const clean = wt(fx, home, ["remove", "--purpose", "feat", "--json"]);
  assert.equal(clean.status, 0, clean.stderr + clean.stdout);
  assert.equal(clean.json().result.branchKept, true);
  assert.equal(existsSync(tree), false);
  assert.equal(registered(fx, tree), false);
  assert.equal(tipOf(fx, "agents/feat"), tip, "the branch stays");
  assert.equal(existsSync(join(home, ".oats", "trees", "feat.json")), false);
  assert.equal(runs(fx).length, 1, "remove ran no hook");
  const none = wt(fx, home, ["remove", "--purpose", "feat", "--json"]);
  assert.equal(none.json().error.code, "E_BAD_ARGS");
});

test("A1: a value git could read as an option is refused before any write, for --purpose, --branch and --base", async (t) => {
  const fx = deployment(t);
  const { home } = await fx.spawn("dev", { instance: "dev-i", work: "checkout" });
  const marker = join(fx.base, "pwned");
  const evil = `--upload-pack=touch ${marker}`;
  for (const [flag, args] of [
    ["--purpose", ["--purpose", evil, "--branch", "agents/x", "--base", "main"]],
    ["--branch", ["--purpose", "x", "--branch", evil, "--base", "main"]],
    ["--base", ["--purpose", "x", "--branch", "agents/x", "--base", evil]],
  ]) {
    // Both spellings: `--flag value` and `--flag=value`.
    for (const form of [args, args.flatMap((a, i, all) => (i % 2 === 0 ? [] : [`${all[i - 1]}=${a}`]))]) {
      const r = wt(fx, home, ["add", ...form, "--json"]);
      assert.notEqual(r.status, 0, `${flag}: ${r.stdout}`);
      assert.equal(r.json().error.code, "E_BAD_ARGS", `${flag}: ${r.stdout}`);
      assert.equal(existsSync(marker), false, `${flag}: git ran the injected option`);
      assert.equal(existsSync(join(home, ".oats", "trees")), false, `${flag}: nothing was written`);
    }
  }
  for (const [flag, value] of [["--branch", "a..b"], ["--branch", "@{-1}"], ["--base", "main:refs/heads/x"], ["--purpose", "Has Caps"]]) {
    const r = wt(fx, home, ["add", "--purpose", flag === "--purpose" ? value : "x", "--branch", flag === "--branch" ? value : "agents/x", "--base", flag === "--base" ? value : "main", "--json"]);
    assert.equal(r.json().error.code, "E_BAD_ARGS", `${flag} ${value}`);
  }
  assert.equal(runs(fx).length, 0);
});

/** A smart-HTTP git server for `bare` (git http-backend), credentials ignored. → { url(base), close } */
async function httpGit(t, bare) {
  const { createServer } = await import("node:http");
  const { spawn } = await import("node:child_process");
  const server = createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const cgi = spawn("git", ["http-backend"], { env: { ...process.env, GIT_PROJECT_ROOT: join(bare, ".."), GIT_HTTP_EXPORT_ALL: "1", PATH_INFO: u.pathname.replace(/^\/[^/]+/, ""), QUERY_STRING: u.search.slice(1), REQUEST_METHOD: req.method, CONTENT_TYPE: req.headers["content-type"] ?? "", REMOTE_ADDR: "127.0.0.1", GIT_HTTP_MAX_REQUEST_BUFFER: "100M" } });
    req.pipe(cgi.stdin);
    let head = Buffer.alloc(0), headed = false;
    cgi.stdout.on("data", (chunk) => {
      if (headed) return res.write(chunk);
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf("\r\n\r\n");
      if (end < 0) return;
      headed = true;
      let status = 200;
      for (const line of head.slice(0, end).toString().split("\r\n")) { const [k, ...v] = line.split(":"); if (/^status$/i.test(k)) status = parseInt(v.join(":"), 10); else res.setHeader(k, v.join(":").trim()); }
      res.writeHead(status);
      res.write(head.slice(end + 4));
    });
    cgi.stdout.on("end", () => res.end());
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  return { port: server.address().port };
}
const runCli = async (fx, args, opts) => (await cliChild(fx, args, opts).done);

test("A2: origin's userinfo never reaches the hook, the record, the event, the answer or the log", async (t) => {
  const fx = deployment(t);
  const { home } = await fx.spawn("dev", { instance: "dev-s", work: "checkout" });
  const { port } = await httpGit(t, fx.repo);
  const repoName = fx.repo.split("/").pop();
  // A fake ssh that serves the scp-style remote from the bare repository.
  const ssh = join(fx.base, "fake-ssh.mjs");
  writeFileSync(ssh, `#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const cmd = process.argv.at(-1);
const m = /^(git-upload-pack) '(.*)'$/.exec(cmd);
const r = spawnSync(m[1], [${JSON.stringify(fx.repo)}], { stdio: "inherit" });
process.exit(r.status ?? 1);
`.replace(/require\("node:child_process"\)/, 'require("node:child_process")'));
  writeFileSync(ssh.replace(/\.mjs$/, ".cjs"), readFileSync(ssh, "utf8"));
  const sshCjs = ssh.replace(/\.mjs$/, ".cjs");
  execFileSync("chmod", ["+x", sshCjs]);
  const cases = [
    [`http://user:tok@127.0.0.1:${port}/remotes/${repoName}`, `http://127.0.0.1:${port}/remotes/${repoName}`],
    [`http://tok@127.0.0.1:${port}/remotes/${repoName}`, `http://127.0.0.1:${port}/remotes/${repoName}`],
    ["git@fakehost:o/r.git", "fakehost:o/r.git"],
  ];
  let n = 0;
  for (const [url, scrubbed] of cases) {
    n++;
    gitIn(fx, fx.member, "remote", "set-url", "origin", url);
    const r = await runCli(fx, ["worktree", "add", "--purpose", `cred${n}`, "--branch", `agents/cred${n}`, "--base", "main", "--json"], { cwd: home, env: { OATS_INSTANCE_HOME: home, GIT_SSH_COMMAND: sshCjs, OATS_TEST_WORKTREE_FETCH_TIMEOUT_MS: "30000" } });
    assert.equal(r.status, 0, `${url}: ${r.stderr}${r.stdout}`);
    const res = JSON.parse(r.stdout.trim().split("\n").pop()).result;
    assert.equal(res.remote, scrubbed);
    assert.equal(runs(fx).at(-1).env.OATS_TREE_REMOTE, scrubbed);
    const everything = [r.stdout, r.stderr, readFileSync(join(home, ".oats", "trees", `cred${n}.json`), "utf8"), readFileSync(join(home, ".oats-events.jsonl"), "utf8"),
      readFileSync(join(fx.root, "hook-runs.jsonl"), "utf8"), readFileSync(res.hooks[0].log, "utf8")].join("\n");
    assert.doesNotMatch(everything, /tok/, url);
    assert.doesNotMatch(everything, /user:/, url);
    if (url.startsWith("git@")) assert.doesNotMatch(everything, /git@fakehost/, url);
  }
});

test("the clone: --repo by member key or path; not a repository, a linked worktree, no origin; a fetch that fails removes the tree", async (t) => {
  const fx = deployment(t);
  const { home } = await fx.spawn("dev", { instance: "dev-q", work: "checkout" });
  const byKey = wt(fx, home, ["add", "--purpose", "k", "--branch", "agents/k", "--base", "main", "--repo", fx.key, "--json"]);
  assert.equal(byKey.status, 0, byKey.stderr + byKey.stdout);
  assert.equal(runs(fx).at(-1).env.OATS_TREE_MEMBER, fx.key);
  const byPath = wt(fx, home, ["add", "--purpose", "p", "--branch", "agents/p", "--base", "main", "--repo", fx.member, "--json"]);
  assert.equal(byPath.status, 0, byPath.stderr + byPath.stdout);
  assert.equal(runs(fx).at(-1).env.OATS_TREE_MEMBER, "", "a path names no member");
  const plain = join(fx.base, "plain"); mkdirSync(plain);
  assert.equal(wt(fx, home, ["add", "--purpose", "n", "--branch", "agents/n", "--base", "main", "--repo", plain, "--json"]).json().error.code, "E_CLONE_MISSING");
  assert.equal(wt(fx, home, ["add", "--purpose", "n", "--branch", "agents/n", "--base", "main", "--repo", join(home, ".work-k"), "--json"]).json().error.code, "E_CLONE_MISMATCH");
  const lonely = join(fx.base, "lonely"); mkdirSync(lonely); gitIn(fx, lonely, "init", "-q");
  const noOrigin = wt(fx, home, ["add", "--purpose", "n", "--branch", "agents/n", "--base", "main", "--repo", lonely, "--json"]);
  assert.equal(noOrigin.json().error.code, "E_CLONE_MISMATCH");
  assert.match(noOrigin.json().error.message, /origin/);
  const missing = wt(fx, home, ["add", "--purpose", "m", "--branch", "agents/m", "--base", "no-such-branch", "--json"]);
  assert.equal(missing.json().error.code, "E_REMOTE_UNREADABLE");
  assert.equal(existsSync(join(home, ".work-m")), false);
  assert.equal(existsSync(join(home, ".oats", "trees", "m.json")), false);
  assert.equal(registered(fx, join(home, ".work-m")), false);
  const exists = wt(fx, home, ["add", "--purpose", "e", "--branch", "agents/k", "--base", "main", "--json"]);
  assert.equal(exists.json().error.code, "E_BRANCH_EXISTS");
  assert.match(exists.json().error.message, /dev-q\/agents\/k/);
});

test("a hook that removes the tree: required → the add rolls back; preview shows the plan and writes nothing", async (t) => {
  const fx = deployment(t);
  const { home } = await fx.spawn("dev", { instance: "dev-v", work: "checkout" });
  const pv = wt(fx, home, ["add", "--purpose", "feat", "--branch", "agents/feat", "--base", "main", "--preview", "--json"]);
  assert.equal(pv.status, 0, pv.stderr);
  const plan = pv.json().result;
  assert.equal(plan.preview, true);
  assert.equal(plan.clone, fx.member);
  assert.equal(plan.path, join(home, ".work-feat"));
  assert.deepEqual(plan.hooks, [{ capability: "test.setup", required: true }]);
  assert.equal(existsSync(join(home, ".oats", "trees")), false);
  assert.equal(existsSync(join(home, ".work-feat")), false);
  const text = wt(fx, home, ["add", "--purpose", "feat", "--branch", "agents/feat", "--base", "main", "--preview"]);
  assert.match(text.stdout, /worktree hooks: test\.setup \(required\)/);
  writeFileSync(join(fx.root, "hook-rm-tree"), "");
  const r = add(fx, home);
  assert.equal(r.json().error.code, "E_REQUIRED_HOOK_FAILED");
  assert.match(r.json().error.message, /no longer there/);
  assert.equal(tipOf(fx, "agents/feat"), null);
});

const spawnArgs = (name) => ["spawn", "dev", "--name", name, "--work", "worktree", "--no-launch", "--json"];

test("spawn (work: worktree): the worktree hooks fire once, after the spawn hooks, in ./work; the result and the spawned event carry their receipt", async (t) => {
  const fx = deployment(t, { work: "worktree", lifecycle: true });
  const r = fx.cli(spawnArgs("dev-sp"));
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const res = r.json().result;
  const [run] = runs(fx);
  assert.equal(runs(fx).length, 1);
  assert.equal(run.spawnRanBefore, true, "after the spawn hooks");
  assert.equal(run.cwd, join(res.home, "work"));
  assert.equal(run.env.OATS_TREE, join(res.home, "work"));
  assert.equal(run.env.OATS_TREE_ORIGIN, "spawn");
  assert.equal(run.env.OATS_PURPOSE, "");
  assert.equal(run.env.OATS_BRANCH, res.branch);
  assert.equal(run.env.OATS_TREE_BASE_OID, res.base.oid);
  assert.equal(run.env.OATS_TREE_BASE, res.base.ref);
  assert.equal(run.env.OATS_TREE_MEMBER, fx.key);
  assert.equal(run.stdin, "");
  assert.equal(res.worktreeHooks[0].log, join(res.home, ".oats", "logs", "worktree-work-test.setup.log"));
  assert.equal(res.worktreeHooks[0].ok, true);
  const spawned = readFileSync(join(res.home, ".oats-events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).find((e) => e.kind === "spawned");
  assert.deepEqual(spawned.data.worktreeHooks.map((h) => h.capability), ["test.setup"]);
  assert.equal(existsSync(join(res.home, ".oats-rollback-incomplete.json")), false, "the in-progress marker is gone at the commit point");
  assert.doesNotMatch(r.stdout, /hook says hello/, "a spawn's hook output stays out of stdout");
  // A checkout spawn of the same soul fires nothing.
  const c = fx.cli(["spawn", "dev", "--name", "dev-co", "--work", "checkout", "--no-launch", "--json"]);
  assert.equal(c.status, 0, c.stderr);
  assert.equal(runs(fx).length, 1, "checkout mode never fires the event");
  assert.equal(c.json().result.worktreeHooks, undefined);
});

test("spawn --preview lists the worktree hooks (null outside worktree mode); Desktop's preview reader passes the new key", async (t) => {
  const fx = deployment(t, { work: "worktree" });
  const p = fx.cli(["spawn", "dev", "--name", "dev-pv", "--work", "worktree", "--preview", "--json"]);
  assert.equal(p.status, 0, p.stderr);
  assert.deepEqual(p.json().result.worktreeHooks, [{ capability: "test.setup", required: true }]);
  assert.equal(typeof p.json().result.worktree, "string", "the existing worktree path is unchanged");
  const c = fx.cli(["spawn", "dev", "--name", "dev-pc", "--work", "checkout", "--preview", "--json"]);
  assert.equal(c.json().result.worktreeHooks, null);
  const text = fx.cli(["spawn", "dev", "--name", "dev-pv", "--work", "worktree", "--preview"]);
  assert.match(text.stdout, /worktree hooks: test\.setup \(required\)/);
  assert.equal(runs(fx).length, 0, "a preview runs nothing");
  const { previewData } = await import("../packages/desktop/renderer/spawn-preview-contract.mjs");
  const { data, target } = await import("../packages/desktop/test/helpers/spawn-preview-fixture.mjs");
  const captured = data();
  assert.ok(previewData(structuredClone(captured), target), "the captured preview reads");
  assert.ok(previewData({ ...structuredClone(captured), worktreeHooks: [{ capability: "acme.setup", required: true }] }, target), "an unknown top-level key passes the reader");
  assert.ok(previewData({ ...structuredClone(captured), worktreeHooks: null }, target));
});

test("spawn: a required worktree hook failure fails the spawn closed — retire hooks compensate, the tree, the branch and the home are gone", async (t) => {
  const fx = deployment(t, { work: "worktree", lifecycle: true });
  writeFileSync(join(fx.root, "hook-fail"), "");
  const r = fx.cli(spawnArgs("dev-sf"));
  assert.notEqual(r.status, 0);
  const err = r.json().error;
  assert.match(err.message, /test\.setup worktree hook \(declared required\): setup broke/);
  assert.match(err.message, /worktree-work-test\.setup\.log/);
  assert.match(err.message, /spawn rolled back/);
  const home = join(fx.root, "dev", "instances", "dev-sf");
  assert.equal(existsSync(home), false, "the home is deleted");
  assert.equal(tipOf(fx, "agents/dev-sf"), null, "the branch is deleted");
  assert.equal(registered(fx, join(home, "work")), false);
  assert.match(readFileSync(join(fx.root, "retire-ran"), "utf8"), /dev-sf/, "the retire hook compensated");
});

test("spawn: when its own start time cannot be read it refuses before any worktree hook, inside the transaction — retire hooks compensate, the tree, the branch, the home and the marker are gone", async (t) => {
  const fx = deployment(t, { work: "worktree", lifecycle: true });
  // A `ps` that cannot read its caller's own pid (the spawning kernel's) and is the real one otherwise.
  const real = execFileSync("sh", ["-c", "command -v ps"], { encoding: "utf8" }).trim();
  const dir = join(fx.base, "ps-unreadable-self"); mkdirSync(dir);
  writeFileSync(join(dir, "ps"), `#!/bin/sh\nfor a in "$@"; do [ "$a" = "$PPID" ] && { echo "ps: simulated failure" >&2; exit 2; }; done\nexec ${JSON.stringify(real)} "$@"\n`, { mode: 0o755 });
  const r = fx.cli(spawnArgs("dev-self"), { env: { OATS_TEST_PROCESS_START_PS: "1", PATH: `${dir}:${fx.env.PATH}` } });
  assert.notEqual(r.status, 0);
  const err = r.json().error;
  assert.equal(err.code, "E_SPAWN_FAILED", r.stdout);
  assert.match(err.message, /start time cannot be read.*no worktree hook ran/);
  assert.deepEqual(runs(fx), [], "the worktree hook never ran");
  assert.match(readFileSync(join(fx.root, "spawn-ran"), "utf8"), /x/, "the spawn hooks had run");
  assert.match(readFileSync(join(fx.root, "retire-ran"), "utf8"), /dev-self/, "the retire hook compensated");
  const home = join(fx.root, "dev", "instances", "dev-self");
  assert.equal(existsSync(home), false, "the home is deleted");
  assert.equal(registered(fx, join(home, "work")), false, "git worktree list does not list the tree");
  assert.equal(tipOf(fx, "agents/dev-self"), null, "the branch is deleted");
  assert.equal(existsSync(join(home, ".oats-rollback-incomplete.json")), false, "no marker is left");
});

test("killed parent, spawn: SIGTERM mid-hook rolls back and exits 143 with E_INTERRUPTED", async (t) => {
  const fx = deployment(t, { work: "worktree", lifecycle: true });
  writeFileSync(join(fx.root, "hook-sleep"), "60");
  const sp = cliChild(fx, spawnArgs("dev-st"), { cwd: fx.dep });
  assert.ok(await waitFor(() => existsSync(join(fx.root, "hook-sleeping"))));
  const hook = Number(readFileSync(join(fx.root, "hook-sleeping"), "utf8"));
  sp.child.kill("SIGTERM");
  const r = await sp.done;
  assert.equal(r.status, 143, r.stderr + r.stdout);
  const err = JSON.parse(r.stdout.trim().split("\n").pop()).error;
  assert.equal(err.code, "E_INTERRUPTED");
  assert.match(err.message, /spawn rolled back/);
  assert.ok(await waitFor(() => !alive(hook), 5000));
  assert.equal(existsSync(join(fx.root, "dev", "instances", "dev-st")), false);
  assert.equal(tipOf(fx, "agents/dev-st"), null);
});

test("killed parent, spawn: while alive the home reads as a spawn in progress and retire refuses; after SIGKILL status shows the quarantine and retire completes it", async (t) => {
  const fx = deployment(t, { work: "worktree", lifecycle: true });
  writeFileSync(join(fx.root, "hook-sleep"), "60");
  const sp = cliChild(fx, spawnArgs("dev-sk"), { cwd: fx.dep });
  assert.ok(await waitFor(() => existsSync(join(fx.root, "hook-sleeping"))));
  const orphan = Number(readFileSync(join(fx.root, "hook-sleeping"), "utf8"));
  const home = join(fx.root, "dev", "instances", "dev-sk");
  const marker = JSON.parse(readFileSync(join(home, ".oats-rollback-incomplete.json"), "utf8"));
  assert.equal(marker.inProgress.pid, sp.child.pid);
  assert.equal(marker.inProgress.hookPgid, pgidOf(orphan));
  assert.deepEqual(marker.cleanup.outstanding, { hooks: ["test.setup"], git: ["worktree", "branch"] });
  const rowOf = async () => (await fx.inEnv(() => listInstances(fx.root, "oats-test-nosuch"))).flatMap((a) => a.instances).find((i) => i.instance === "dev-sk");
  const live = await rowOf();
  assert.equal(live.spawnInProgress, true);
  assert.equal(live.rollbackIncomplete, undefined);
  await assert.rejects(fx.inEnv(() => retireInstance(fx.root, "dev-sk", { tmuxSession: "oats-test-nosuch", force: true })), (e) => e.code === "E_LIFECYCLE_BUSY");
  sp.child.kill("SIGKILL");
  await sp.done;
  assert.equal(alive(orphan), true, "the hook outlived its parent");
  const dead = await rowOf();
  assert.equal(dead.spawnInProgress, undefined);
  assert.ok(dead.rollbackIncomplete, "a dead spawn reads as the quarantine");
  const r = await fx.inEnv(() => retireInstance(fx.root, "dev-sk", { tmuxSession: "oats-test-nosuch" }));
  assert.equal(alive(orphan), false, "retire ended the orphaned hook group");
  assert.match(readFileSync(join(fx.root, "retire-ran"), "utf8"), /dev-sk/, "the retire hooks compensated");
  assert.equal(registered(fx, join(home, "work")), false, "the worktree is removed");
  // The one exception to "no retire deletes a branch": the killed spawn's own compensation, finished.
  assert.equal(r.removedDir, true, JSON.stringify(r));
  assert.equal(existsSync(home), false);
  assert.equal(tipOf(fx, "agents/dev-sk"), null, "the branch, still at its creation commit, is deleted");
  assert.equal(r.branchDeleted, false, "the receipt's own branchDeleted keeps meaning a retire's --delete-branch");
  assert.deepEqual(r.spawnCompensation, { branch: "agents/dev-sk", branchDeleted: true });
});

/** A spawn SIGKILLed mid-hook: → { home, orphan }. */
async function killedSpawn(fx, name) {
  writeFileSync(join(fx.root, "hook-sleep"), "60");
  const sp = cliChild(fx, spawnArgs(name), { cwd: fx.dep });
  assert.ok(await waitFor(() => existsSync(join(fx.root, "hook-sleeping"))));
  const orphan = Number(readFileSync(join(fx.root, "hook-sleeping"), "utf8"));
  sp.child.kill("SIGKILL");
  await sp.done;
  return { home: join(fx.root, "dev", "instances", name), orphan };
}

test("killed parent, spawn: a branch that moved, or is checked out elsewhere, is kept and named; the home is retained", async (t) => {
  const fx = deployment(t, { work: "worktree", lifecycle: true });
  const moved = await killedSpawn(fx, "dev-mv");
  const tree = join(moved.home, "work");
  writeFileSync(join(tree, "work.txt"), "work\n"); gitIn(fx, tree, "add", "work.txt"); gitIn(fx, tree, "commit", "-qm", "work");
  const tip = tipOf(fx, "agents/dev-mv");
  const r = await fx.inEnv(() => retireInstance(fx.root, "dev-mv", { tmuxSession: "oats-test-nosuch" }));
  assert.equal(alive(moved.orphan), false);
  assert.equal(r.removedDir, false);
  assert.equal(r.spawnCompensation?.branchDeleted ?? false, false, JSON.stringify(r));
  assert.ok(existsSync(moved.home), "the home is retained");
  assert.equal(tipOf(fx, "agents/dev-mv"), tip, "the branch with work on it is kept");
  assert.ok(r.rollbackIncomplete.some((m) => /branch the failed spawn created is left/.test(m)));

  execFileSync("rm", [join(fx.root, "hook-sleeping")]);
  const out = await killedSpawn(fx, "dev-co2");
  const elsewhere = join(fx.base, "elsewhere");
  // The branch is checked out in another worktree (the spawn's own is detached, and retire removes it).
  gitIn(fx, join(out.home, "work"), "switch", "-q", "--detach");
  gitIn(fx, fx.member, "worktree", "add", "-q", elsewhere, "agents/dev-co2");
  const r2 = await fx.inEnv(() => retireInstance(fx.root, "dev-co2", { tmuxSession: "oats-test-nosuch" }));
  assert.equal(r2.removedDir, false, JSON.stringify(r2));
  assert.deepEqual(r2.spawnCompensation, { branch: "agents/dev-co2", branchDeleted: false, reason: "it is checked out in a worktree" });
  assert.ok(tipOf(fx, "agents/dev-co2"));
});

test("killed parent, spawn: the plan/apply retire receipt reports the compensation, and Desktop's retire-receipt reader accepts it", async (t) => {
  const fx = deployment(t, { work: "worktree", lifecycle: true });
  await killedSpawn(fx, "dev-dk");
  const p = fx.cli(["retire", "dev-dk", "--plan", "--json"]);
  assert.equal(p.status, 0, p.stderr + p.stdout);
  const plan = JSON.parse(p.stdout).result;
  const a = fx.cli(["retire", "dev-dk", "--plan-revision", plan.planRevision, "--idempotency-key", "k-dk", "--json"]);
  assert.equal(a.status, 0, a.stderr + a.stdout);
  const receipt = JSON.parse(a.stdout);
  assert.equal(receipt.branchDeleted, false);
  assert.deepEqual(receipt.spawnCompensation, { branch: "agents/dev-dk", branchDeleted: true });
  assert.equal(tipOf(fx, "agents/dev-dk"), null);
  const { lifecycleReceipt } = await import("../packages/desktop/renderer/lifecycle-contract.mjs");
  const read = lifecycleReceipt(receipt, plan, "k-dk");
  assert.ok(read, "Desktop's reader accepts a receipt carrying spawnCompensation.branchDeleted: true");
  assert.equal(read.removedDir, true);
});

test("hook output stays in its 0600 log: never in the envelope, the record, the events, the spawn result or a marker", async (t) => {
  const fx = deployment(t, { work: "worktree", lifecycle: true });
  const SECRET = /SECRET-MARKER/;
  // add, success and required failure
  const { home } = await fx.spawn("dev", { instance: "dev-x", work: "checkout" });
  const ok = add(fx, home);
  assert.equal(ok.status, 0, ok.stderr);
  assert.doesNotMatch(ok.stdout, SECRET, "the add envelope");
  assert.match(ok.stderr, /SECRET-MARKER-OUT/, "the stream goes to stderr");
  writeFileSync(join(fx.root, "hook-fail"), "");
  const bad = add(fx, home, "bad");
  assert.doesNotMatch(bad.stdout, SECRET, "the failed add's envelope");
  execFileSync("rm", [join(fx.root, "hook-fail")]);
  assert.doesNotMatch(readFileSync(join(home, ".oats", "trees", "feat.json"), "utf8"), SECRET, "the record");
  assert.doesNotMatch(readFileSync(join(home, ".oats-events.jsonl"), "utf8"), SECRET, "the events");
  const log = join(home, ".oats", "logs", "worktree-feat-test.setup.log");
  assert.match(readFileSync(log, "utf8"), /SECRET-MARKER-OUT[\s\S]*|SECRET-MARKER-ERR/);
  assert.equal(statSync(log).mode & 0o777, 0o600);
  // spawn: the result, the spawned event, and the in-progress marker while the hook runs
  const sp = fx.cli(spawnArgs("dev-xs"));
  assert.equal(sp.status, 0, sp.stderr);
  assert.doesNotMatch(sp.stdout, SECRET, "the spawn result");
  const spHome = join(fx.root, "dev", "instances", "dev-xs");
  assert.doesNotMatch(readFileSync(join(spHome, ".oats-events.jsonl"), "utf8"), SECRET);
  assert.doesNotMatch(readFileSync(join(spHome, "instance.json"), "utf8"), SECRET);
  assert.match(readFileSync(join(spHome, ".oats", "logs", "worktree-work-test.setup.log"), "utf8"), SECRET);
  writeFileSync(join(fx.root, "hook-sleep"), "60");
  const running = cliChild(fx, spawnArgs("dev-xm"), { cwd: fx.dep });
  assert.ok(await waitFor(() => existsSync(join(fx.root, "hook-sleeping"))));
  const markerPath = join(fx.root, "dev", "instances", "dev-xm", ".oats-rollback-incomplete.json");
  assert.ok(await waitFor(() => existsSync(join(fx.root, "dev", "instances", "dev-xm", ".oats", "logs", "worktree-work-test.setup.log"))
    && SECRET.test(readFileSync(join(fx.root, "dev", "instances", "dev-xm", ".oats", "logs", "worktree-work-test.setup.log"), "utf8"))));
  assert.doesNotMatch(readFileSync(markerPath, "utf8"), SECRET, "the in-progress marker");
  running.child.kill("SIGTERM");
  const ended = await running.done;
  assert.doesNotMatch(ended.stdout, SECRET, "the interrupted spawn's envelope");
});

// ---------- review round 1: ownership, serialization, the branch a rollback keeps ----------

/** A `git` on PATH that runs the real one, pausing first at the step `gate` (a JS expression over
 *  `a`, the argv) until `<base>/<release>` exists, after writing its own pid to `<base>/<entered>`; `after`, when given, is written once that step's real git returned. Each is
 *  a JS expression for a file name. */
function gatedGit(fx, name, { gate, entered, release, after = "null" }) {
  const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8", env: fx.env }).trim();
  const dir = join(fx.base, `git-${name}`); mkdirSync(dir);
  writeFileSync(join(dir, "git"), `#!${process.execPath}
const { existsSync, writeFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const a = process.argv.slice(2), base = ${JSON.stringify(fx.base)};
const gated = ${gate};
if (gated) {
  writeFileSync(base + "/" + (${entered}), String(process.pid));
  for (let n = 0; n < 1500 && !existsSync(base + "/" + (${release})); n++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
}
const r = spawnSync(${JSON.stringify(real)}, a, { stdio: "inherit" });
if (gated && (${after})) writeFileSync(base + "/" + (${after}), "");
process.exit(r.status ?? 1);
`, { mode: 0o700 });
  return `${dir}:${fx.env.PATH}`;
}
/** A dead adder's record, as a SIGKILL leaves it: the ready record turned back into `creating`. */
function asKilledAdd(home, purpose, drop = []) {
  const p = join(home, ".oats", "trees", `${purpose}.json`);
  const rec = JSON.parse(readFileSync(p, "utf8"));
  for (const k of drop) delete rec[k];
  writeFileSync(p, JSON.stringify({ ...rec, state: "creating", pid: 2147483647, processStart: "proc:gone", startedAt: "earlier" }));
}

test("two adds racing for one branch: the loser's rollback keeps the winner's branch, and says why", async (t) => {
  const fx = deployment(t, { hookless: true });
  const { home } = await fx.spawn("dev", { instance: "dev-race", work: "checkout" });
  const argv = (p) => ["worktree", "add", "--purpose", p, "--branch", "agents/shared", "--base", "main", "--json"];
  // Both pass the branch precheck: "one" runs its switch only once "two" reached its own, and "two" only after "one" made the branch.
  const one1 = `a[1].endsWith(".work-one")`;
  const path = gatedGit(fx, "race", { gate: `a.includes("switch") && a.includes("-c")`,
    entered: `${one1} ? "one-at-switch" : "two-at-switch"`, release: `${one1} ? "two-at-switch" : "one-done"`, after: `${one1} ? "one-done" : null` });
  const one = cliChild(fx, argv("one"), { cwd: home, env: { OATS_INSTANCE_HOME: home, PATH: path } });
  const two = cliChild(fx, argv("two"), { cwd: home, env: { OATS_INSTANCE_HOME: home, PATH: path } });
  const [r1, r2] = await Promise.all([one.done, two.done]);
  assert.equal(r1.status, 0, r1.stderr + r1.stdout);
  const lost = JSON.parse(r2.stdout.trim().split("\n").pop()).error;
  assert.equal(lost.code, "E_BRANCH_EXISTS");
  assert.equal(lost.details.rolledBack, true);
  assert.equal(lost.details.branchKept, true);
  assert.match(lost.details.branchKeptReason, /not proven/);
  const winner = join(home, ".work-one");
  assert.equal(tipOf(fx, "agents/shared"), originMain(fx), "the winner's branch is still there");
  assert.equal(gitIn(fx, winner, "symbolic-ref", "HEAD"), "refs/heads/agents/shared");
  assert.equal(gitIn(fx, winner, "status", "--porcelain"), "", "the winner's tree is clean, not every file staged as new");
  assert.equal(existsSync(join(home, ".work-two")), false);
});

test("recoveries of one purpose are serialized: a remove that cannot claim it is busy, and never touches the tree the add then made", async (t) => {
  const fx = deployment(t);
  const { home } = await fx.spawn("dev", { instance: "dev-ser", work: "checkout" });
  writeFileSync(join(fx.root, "hook-sleep"), "60");
  const killed = cliChild(fx, ["worktree", "add", "--purpose", "feat", "--branch", "agents/feat", "--base", "main", "--json"], { cwd: home, env: { OATS_INSTANCE_HOME: home } });
  assert.ok(await waitFor(() => existsSync(join(fx.root, "hook-sleeping"))));
  killed.child.kill("SIGKILL");
  await killed.done;
  execFileSync("rm", [join(fx.root, "hook-sleep")]);
  // The recovering add holds the claim inside its rollback's `git worktree remove --force`.
  const path = gatedGit(fx, "ser", { gate: `a.includes("worktree") && a.includes("remove") && a.includes("--force")`, entered: `"recovering"`, release: `"release-add"` });
  const recovering = cliChild(fx, ["worktree", "add", "--purpose", "feat", "--branch", "agents/feat", "--base", "main", "--json"], { cwd: home, env: { OATS_INSTANCE_HOME: home, PATH: path } });
  assert.ok(await waitFor(() => existsSync(join(fx.base, "recovering"))));
  const stale = wt(fx, home, ["remove", "--purpose", "feat", "--json"]);
  assert.equal(stale.json().error.code, "E_LIFECYCLE_BUSY", stale.stdout);
  assert.equal(stale.json().error.details.lock, join(home, ".oats", "trees", "feat.lock"));
  writeFileSync(join(fx.base, "release-add"), "");
  const done = await recovering.done;
  assert.equal(done.status, 0, done.stderr + done.stdout);
  const tree = join(home, ".work-feat");
  writeFileSync(join(tree, "authored-after-success.txt"), "work\n");
  const later = wt(fx, home, ["remove", "--purpose", "feat", "--json"]);
  assert.equal(later.json().error.code, "E_WORKTREE_DIRTY", "a ready tree is removed only as git allows");
  assert.ok(existsSync(join(tree, "authored-after-success.txt")), "the work in the fresh tree survives");
  assert.equal(existsSync(join(home, ".oats", "trees", "feat.lock")), false, "the claim is released");
});

test("an interrupted add's rollback: deletes a branch only its add created, and reports one it keeps (moved, checked out)", async (t) => {
  const fx = deployment(t, { hookless: true });
  const { home } = await fx.spawn("dev", { instance: "dev-own", work: "checkout" });
  // Killed between `git switch -c` and the record saying so: the tree's own HEAD proves the add made the branch.
  assert.equal(add(fx, home, "window").status, 0);
  asKilledAdd(home, "window", ["branchCreated"]);
  const window = wt(fx, home, ["remove", "--purpose", "window", "--json"]).json().result;
  assert.equal(window.rolledBack, true);
  assert.equal(window.branchKept, false);
  assert.equal(tipOf(fx, "agents/window"), null);
  // A commit on the branch: kept, and the answer says so.
  assert.equal(add(fx, home, "moved").status, 0);
  gitIn(fx, join(home, ".work-moved"), "commit", "--allow-empty", "-qm", "made by a hook");
  const moved = tipOf(fx, "agents/moved");
  asKilledAdd(home, "moved");
  const kept = wt(fx, home, ["remove", "--purpose", "moved", "--json"]);
  assert.equal(kept.status, 0, kept.stdout);
  assert.equal(kept.json().result.branchKept, true);
  assert.match(kept.json().result.branchKeptReason, /tip moved/);
  assert.equal(tipOf(fx, "agents/moved"), moved);
  assert.equal(existsSync(join(home, ".oats", "trees", "moved.json")), false, "a branch kept on purpose is not owed: the record is gone");
  // Checked out in another worktree: kept.
  assert.equal(add(fx, home, "shared").status, 0);
  const other = join(fx.base, "other-tree");
  gitIn(fx, fx.member, "worktree", "add", "-q", "--force", other, "agents/shared");
  asKilledAdd(home, "shared");
  const out = wt(fx, home, ["remove", "--purpose", "shared"]);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /branch agents\/shared kept \(it is checked out in a worktree\)/);
  assert.equal(tipOf(fx, "agents/shared"), originMain(fx));
});

test("a killed add whose hook leader exited: the group left behind is never signalled, the warning names it, the rollback completes", async (t) => {
  const fx = deployment(t);
  const { home } = await fx.spawn("dev", { instance: "dev-lead", work: "checkout" });
  writeFileSync(join(fx.root, "hook-stubborn"), "");
  writeFileSync(join(fx.root, "hook-sleep"), "60");
  const killed = cliChild(fx, ["worktree", "add", "--purpose", "feat", "--branch", "agents/feat", "--base", "main", "--json"], { cwd: home, env: { OATS_INSTANCE_HOME: home } });
  assert.ok(await waitFor(() => existsSync(join(fx.root, "hook-sleeping"))));
  const hook = Number(readFileSync(join(fx.root, "hook-sleeping"), "utf8"));
  // The group's leader: the hook itself where /bin/sh execs it (bash), `sh` where it forks (dash).
  const leader = pgidOf(hook);
  const member = Number(readFileSync(join(fx.root, "hook-stubborn-pid"), "utf8"));
  // The kernel deliberately leaves this group running (its leader is gone, so it cannot be proven to be the
  // hook's); the test ends what it started, whatever the outcome.
  t.after(() => { for (const pid of [member, hook]) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } } });
  killed.child.kill("SIGKILL");
  await killed.done;
  assert.equal(JSON.parse(readFileSync(join(home, ".oats", "trees", "feat.json"), "utf8")).hookPgid, leader);
  process.kill(leader, "SIGKILL");
  assert.ok(await waitFor(() => !alive(leader), 5000));
  const r = wt(fx, home, ["remove", "--purpose", "feat", "--json"]);
  assert.equal(r.status, 0, r.stdout);
  const res = r.json().result;
  assert.equal(res.rolledBack, true);
  assert.ok(res.warnings.some((w) => w.includes(`hook process group ${leader} was not signalled: its leader exited`)), JSON.stringify(res.warnings));
  assert.equal(alive(member), true, "the leaderless group was not signalled");
  assert.equal(existsSync(join(home, ".work-feat")), false);
});

test("a recovery killed while it holds the purpose's claim: the next command takes the claim over and completes the rollback", async (t) => {
  const fx = deployment(t);
  const { home } = await fx.spawn("dev", { instance: "dev-claim", work: "checkout" });
  writeFileSync(join(fx.root, "hook-sleep"), "60");
  const argv = ["worktree", "add", "--purpose", "feat", "--branch", "agents/feat", "--base", "main", "--json"];
  const first = cliChild(fx, argv, { cwd: home, env: { OATS_INSTANCE_HOME: home } });
  assert.ok(await waitFor(() => existsSync(join(fx.root, "hook-sleeping"))));
  first.child.kill("SIGKILL");
  await first.done;
  // The recovering add is killed inside its rollback, holding the claim.
  const path = gatedGit(fx, "claim", { gate: `a.includes("worktree") && a.includes("remove") && a.includes("--force")`, entered: `"recovering"`, release: `"release-old-git"` });
  const recovering = cliChild(fx, argv, { cwd: home, env: { OATS_INSTANCE_HOME: home, PATH: path } });
  assert.ok(await waitFor(() => existsSync(join(fx.base, "recovering"))));
  const lock = join(home, ".oats", "trees", "feat.lock");
  const oldGit = Number(readFileSync(join(fx.base, "recovering"), "utf8"));
  const held = JSON.parse(readFileSync(lock, "utf8"));
  assert.equal(held.pid, recovering.child.pid, "the recovering add holds the claim");
  assert.equal(held.gitPid, oldGit, "and the claim records its running git step");
  recovering.child.kill("SIGKILL");
  await recovering.done;
  assert.ok(existsSync(lock), "the killed recovery left its claim");
  assert.equal(alive(oldGit), true, "its git step outlived it");
  // The next add takes the claim over: it ends that git first, then rolls back and adds afresh.
  execFileSync("rm", [join(fx.root, "hook-sleep")]);
  const again = add(fx, home);
  assert.equal(again.status, 0, again.stderr + again.stdout);
  assert.equal(alive(oldGit), false, "the old git step was ended before the takeover");
  const tree = join(home, ".work-feat");
  writeFileSync(join(tree, "authored-after-recovery.txt"), "work\n");
  writeFileSync(join(fx.base, "release-old-git"), ""); // had it survived, it would run now
  await new Promise((r) => setTimeout(r, 1500));
  assert.ok(existsSync(join(tree, "authored-after-recovery.txt")), "the new tree and its work survive");
  assert.equal(JSON.parse(readFileSync(join(home, ".oats", "trees", "feat.json"), "utf8")).state, "ready");
  assert.deepEqual(readdirSync(join(home, ".oats", "trees")).sort(), ["feat.json"], "no claim or takeover claim is left");
});

test("an add killed during its own git step: the recovery ends that git first, so it never creates the branch late", async (t) => {
  const fx = deployment(t, { hookless: true });
  const { home } = await fx.spawn("dev", { instance: "dev-late", work: "checkout" });
  const path = gatedGit(fx, "late", { gate: `a.includes("switch") && a.includes("-c")`, entered: `"switching"`, release: `"release-switch"` });
  const killed = cliChild(fx, ["worktree", "add", "--purpose", "feat", "--branch", "agents/feat", "--base", "main", "--json"], { cwd: home, env: { OATS_INSTANCE_HOME: home, PATH: path } });
  assert.ok(await waitFor(() => existsSync(join(fx.base, "switching"))));
  const switchGit = Number(readFileSync(join(fx.base, "switching"), "utf8"));
  assert.equal(JSON.parse(readFileSync(join(home, ".oats", "trees", "feat.json"), "utf8")).gitPid, switchGit, "the record names the running git step");
  killed.child.kill("SIGKILL");
  await killed.done;
  assert.equal(alive(switchGit), true);
  const r = wt(fx, home, ["remove", "--purpose", "feat", "--json"]);
  assert.equal(r.status, 0, r.stdout);
  assert.equal(r.json().result.rolledBack, true);
  assert.equal(alive(switchGit), false, "the git step was ended before the rollback");
  writeFileSync(join(fx.base, "release-switch"), "");
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(tipOf(fx, "agents/feat"), null, "no branch appears late");
  assert.equal(existsSync(join(home, ".work-feat")), false);
});

test("a git step that fails on its own answers E_GIT_FAILED, not a clone or branch class, and rolls back", async (t) => {
  const fx = deployment(t, { hookless: true });
  const { home } = await fx.spawn("dev", { instance: "dev-gitfail", work: "checkout" });
  // `git worktree add` refuses a path the clone still registers (made, then deleted without a prune).
  const stale = join(home, ".work-stale");
  gitIn(fx, fx.member, "worktree", "add", "-q", "--detach", stale);
  execFileSync("rm", ["-rf", stale]);
  const r = add(fx, home, "stale");
  const e = r.json().error;
  assert.equal(e.code, "E_GIT_FAILED", r.stdout);
  assert.match(e.message, /^git worktree add failed in /);
  assert.equal(e.details.rolledBack, true);
  assert.equal(existsSync(join(home, ".oats", "trees", "stale.json")), false);
  // `git switch -c` failing while the branch does not exist is git's failure, not E_BRANCH_EXISTS.
  const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8", env: fx.env }).trim();
  const dir = join(fx.base, "git-switchfail"); mkdirSync(dir);
  writeFileSync(join(dir, "git"), `#!/bin/sh\ncase " $* " in *" switch "*) echo "fatal: simulated switch failure" >&2; exit 128;; esac\nexec ${JSON.stringify(real)} "$@"\n`, { mode: 0o755 });
  const sw = wt(fx, home, ["add", "--purpose", "sw", "--branch", "agents/sw", "--base", "main", "--json"], { PATH: `${dir}:${fx.env.PATH}` });
  const se = sw.json().error;
  assert.equal(se.code, "E_GIT_FAILED", sw.stdout);
  assert.match(se.message, /^git switch failed in .*simulated switch failure/);
  assert.equal(se.details.rolledBack, true);
  assert.equal(tipOf(fx, "agents/sw"), null);
});

// ---------- a process whose start cannot be read is never taken for gone ----------

/** A `ps` on PATH that cannot read `pid` (exit 2, an error on stderr) and is the real `ps` for any other
 *  pid. With OATS_TEST_PROCESS_START_PS=1 the kernel reads start times through it. */
function unreadablePs(fx, pid) {
  const real = execFileSync("sh", ["-c", "command -v ps"], { encoding: "utf8" }).trim();
  const dir = join(fx.base, `ps-unreadable-${pid}`); mkdirSync(dir);
  writeFileSync(join(dir, "ps"), `#!/bin/sh\nfor a in "$@"; do [ "$a" = "${pid}" ] && { echo "ps: simulated failure" >&2; exit 2; }; done\nexec ${JSON.stringify(real)} "$@"\n`, { mode: 0o755 });
  return `${dir}:${fx.env.PATH}`;
}
/** A live process that is no oats command, standing in for a holder whose start cannot be read; ended by the test. */
function bystander(t) {
  const c = spawnChild("sleep", ["60"], { stdio: "ignore" });
  t.after(() => { try { c.kill("SIGKILL"); } catch { /* gone */ } });
  return c.pid;
}
const SOME_START = "ps:Thu Jan  1 00:00:00 2026";

test("an adder or claim holder whose start cannot be read: add and remove refuse, naming the pid and the exact path to remove, and nothing is removed", async (t) => {
  const fx = deployment(t, { hookless: true });
  const { home } = await fx.spawn("dev", { instance: "dev-unk", work: "checkout" });
  assert.equal(add(fx, home).status, 0);
  const tree = join(home, ".work-feat");
  const recPath = join(home, ".oats", "trees", "feat.json");
  const lock = join(home, ".oats", "trees", "feat.lock");
  const pid = bystander(t);
  const env = { OATS_TEST_PROCESS_START_PS: "1", PATH: unreadablePs(fx, pid) };
  const commands = [["add", "--purpose", "feat", "--branch", "agents/feat", "--base", "main", "--json"], ["remove", "--purpose", "feat", "--json"]];
  const ready = readFileSync(recPath, "utf8");
  // A `creating` record naming it: never rolled back.
  writeFileSync(recPath, JSON.stringify({ ...JSON.parse(ready), state: "creating", pid, processStart: SOME_START, startedAt: "earlier" }));
  const creating = readFileSync(recPath, "utf8");
  for (const args of commands) {
    const r = wt(fx, home, args, env);
    const e = r.json().error;
    assert.equal(e.code, "E_LIFECYCLE_BUSY", r.stdout);
    assert.match(e.message, /cannot be read/);
    assert.ok(e.message.includes(`pid ${pid},`), e.message);
    assert.ok(e.message.includes(`remove ${recPath},`), e.message);
    assert.equal(readFileSync(recPath, "utf8"), creating, `${args[0]}: the record is kept`);
    assert.ok(existsSync(tree) && registered(fx, tree), `${args[0]}: the tree is kept`);
  }
  // A claim naming it: never taken over.
  writeFileSync(recPath, ready);
  writeFileSync(lock, JSON.stringify({ pid, processStart: SOME_START, nonce: "c".repeat(32) }));
  const held = readFileSync(lock, "utf8");
  for (const args of commands) {
    const r = wt(fx, home, args, env);
    const e = r.json().error;
    assert.equal(e.code, "E_LIFECYCLE_BUSY", r.stdout);
    assert.ok(e.message.includes(`pid ${pid} `), e.message);
    assert.ok(e.message.includes(`remove ${lock},`), e.message);
    assert.equal(e.details.lock, lock);
    assert.equal(readFileSync(lock, "utf8"), held, `${args[0]}: the claim is kept`);
    assert.ok(existsSync(tree) && registered(fx, tree), `${args[0]}: the tree is kept`);
  }
});

test("a spawn whose start cannot be read: status shows the quarantine, not in progress; retire refuses naming the pid and `oats retire --force`; --force retires and keeps the branch", async (t) => {
  const fx = deployment(t, { work: "worktree", lifecycle: true });
  const { home, orphan } = await killedSpawn(fx, "dev-unk");
  const orphanGroup = pgidOf(orphan);
  t.after(() => { try { process.kill(-orphanGroup, "SIGKILL"); } catch { /* gone */ } });
  const pid = bystander(t);
  const markerPath = join(home, ".oats-rollback-incomplete.json");
  const marker = JSON.parse(readFileSync(markerPath, "utf8"));
  writeFileSync(markerPath, JSON.stringify({ ...marker, inProgress: { ...marker.inProgress, pid, processStart: SOME_START } }));
  const saved = { PATH: process.env.PATH, seam: process.env.OATS_TEST_PROCESS_START_PS };
  process.env.PATH = unreadablePs(fx, pid);
  process.env.OATS_TEST_PROCESS_START_PS = "1";
  try {
    const row = (await fx.inEnv(() => listInstances(fx.root, "oats-test-nosuch"))).flatMap((a) => a.instances).find((i) => i.instance === "dev-unk");
    // Not shown in progress (a host that never reads it would say "setting up" forever): the quarantine, naming the pid.
    assert.equal(row.spawnInProgress, undefined, "unreadable is not shown as alive");
    assert.equal(row.rollbackIncomplete?.inProgress?.pid, pid, "the row shows the quarantine, its inProgress naming the pid");
    await assert.rejects(fx.inEnv(() => retireInstance(fx.root, "dev-unk", { tmuxSession: "oats-test-nosuch" })), (e) => {
      assert.equal(e.code, "E_LIFECYCLE_BUSY");
      assert.ok(e.message.includes(`pid ${pid},`) && e.message.includes(SOME_START), e.message);
      assert.ok(e.message.includes("`oats retire dev-unk --force`"), e.message);
      return true;
    });
    assert.ok(existsSync(home), "nothing was retired");
    const r = await fx.inEnv(() => retireInstance(fx.root, "dev-unk", { tmuxSession: "oats-test-nosuch", force: true }));
    assert.ok(r.forcedIncomplete?.some((x) => /branch the failed spawn created is left/.test(x)), JSON.stringify(r));
    assert.equal(r.spawnCompensation.branchDeleted, false);
    assert.match(r.spawnCompensation.reason, /could not be verified gone/);
    assert.ok(r.warnings.some((w) => w.includes(`whether its spawn (pid ${pid}) still runs could not be read`)), JSON.stringify(r.warnings));
    assert.equal(tipOf(fx, "agents/dev-unk") !== null, true, "the branch is kept");
  } finally {
    process.env.PATH = saved.PATH;
    if (saved.seam === undefined) delete process.env.OATS_TEST_PROCESS_START_PS; else process.env.OATS_TEST_PROCESS_START_PS = saved.seam;
  }
});

// A recorded git step or hook group with members whose leader's start cannot be read may be that
// step, still running: it is never signalled, and never taken for gone. What names it (the claim, the
// record, the marker) is kept, and the refusal names the group, its recorded start and the way out.
const endGroupByHand = async (pgid) => { process.kill(-pgid, "SIGTERM"); assert.ok(await waitFor(() => !alive(pgid), 5000)); };

test("a killed recovery's git step whose start cannot be read: the next add refuses, keeping the claim and that git; once it is ended by hand, the add completes", async (t) => {
  const fx = deployment(t);
  const { home } = await fx.spawn("dev", { instance: "dev-unkgit", work: "checkout" });
  writeFileSync(join(fx.root, "hook-sleep"), "60");
  const argv = ["worktree", "add", "--purpose", "feat", "--branch", "agents/feat", "--base", "main", "--json"];
  const first = cliChild(fx, argv, { cwd: home, env: { OATS_INSTANCE_HOME: home } });
  assert.ok(await waitFor(() => existsSync(join(fx.root, "hook-sleeping"))));
  first.child.kill("SIGKILL");
  await first.done;
  const path = gatedGit(fx, "unkgit", { gate: `a.includes("worktree") && a.includes("remove") && a.includes("--force")`, entered: `"recovering"`, release: `"release-old-git"`, after: `"old-git-done"` });
  const recovering = cliChild(fx, argv, { cwd: home, env: { OATS_INSTANCE_HOME: home, PATH: path } });
  assert.ok(await waitFor(() => existsSync(join(fx.base, "recovering"))));
  const oldGit = Number(readFileSync(join(fx.base, "recovering"), "utf8"));
  t.after(() => { try { process.kill(-oldGit, "SIGKILL"); } catch { /* gone */ } });
  recovering.child.kill("SIGKILL");
  await recovering.done;
  const lock = join(home, ".oats", "trees", "feat.lock");
  const held = readFileSync(lock, "utf8");
  assert.equal(JSON.parse(held).gitPid, oldGit);
  execFileSync("rm", [join(fx.root, "hook-sleep")]);
  // The claim's holder is gone (read normally); only its git step's start cannot be read.
  const env = { OATS_TEST_PROCESS_START_PS: "1", PATH: unreadablePs(fx, oldGit) };
  const r = wt(fx, home, argv.slice(1), env);
  const e = r.json().error;
  assert.equal(e.code, "E_LIFECYCLE_BUSY", r.stdout);
  for (const part of [`git process group ${oldGit} (leader pid ${oldGit}, recorded start ${JSON.parse(held).gitStart})`, "ps: simulated failure", "was not signalled", `${lock} is kept`, `kill -TERM -- -${oldGit}`, `remove ${lock} and retry`]) assert.ok(e.message.includes(part), `${part}: ${e.message}`);
  assert.equal(e.details.gitPid, oldGit);
  assert.equal(e.details.lock, lock);
  assert.equal(readFileSync(lock, "utf8"), held, "the claim is kept");
  assert.equal(alive(oldGit), true, "that git is not signalled");
  assert.ok(existsSync(join(home, ".work-feat")) && registered(fx, join(home, ".work-feat")), "nothing was rolled back");
  // The way out it names: end that group by hand, and retry (ps still failing for that pid).
  await endGroupByHand(oldGit);
  const again = wt(fx, home, argv.slice(1), env);
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.equal(again.json().result.state, "ready");
  assert.equal(existsSync(join(fx.base, "old-git-done")), false, "the old git never ran its removal");
  assert.deepEqual(readdirSync(join(home, ".oats", "trees")).sort(), ["feat.json"]);
});

test("an interrupted add's git step or hook group whose start cannot be read: add and remove refuse, keeping the record, the tree and that process; once it is ended by hand, the rollback completes", async (t) => {
  const fx = deployment(t);
  const { home } = await fx.spawn("dev", { instance: "dev-unkrec", work: "checkout" });
  const recPath = (p) => join(home, ".oats", "trees", `${p}.json`);
  const check = (r, { pgid, start, what, purpose }) => {
    const e = r.json().error;
    assert.equal(e.code, "E_LIFECYCLE_BUSY", r.stdout);
    for (const part of [`${what} process group ${pgid} (leader pid ${pgid}, recorded start ${start})`, "ps: simulated failure", "was not signalled", "nothing was rolled back", `kill -TERM -- -${pgid}`, `remove ${recPath(purpose)},`]) assert.ok(e.message.includes(part), `${part}: ${e.message}`);
  };
  // A git step: the add killed inside its `git switch -c`.
  const path = gatedGit(fx, "unkrec", { gate: `a.includes("switch") && a.includes("-c")`, entered: `"switching"`, release: `"release-switch"`, after: `"switch-done"` });
  const killed = cliChild(fx, ["worktree", "add", "--purpose", "sw", "--branch", "agents/sw", "--base", "main", "--json"], { cwd: home, env: { OATS_INSTANCE_HOME: home, PATH: path } });
  assert.ok(await waitFor(() => existsSync(join(fx.base, "switching"))));
  const switchGit = Number(readFileSync(join(fx.base, "switching"), "utf8"));
  t.after(() => { try { process.kill(-switchGit, "SIGKILL"); } catch { /* gone */ } });
  killed.child.kill("SIGKILL");
  await killed.done;
  const swRec = readFileSync(recPath("sw"), "utf8");
  let env = { OATS_TEST_PROCESS_START_PS: "1", PATH: unreadablePs(fx, switchGit) };
  for (const args of [["add", "--purpose", "sw", "--branch", "agents/sw", "--base", "main", "--json"], ["remove", "--purpose", "sw", "--json"]]) {
    check(wt(fx, home, args, env), { pgid: switchGit, start: JSON.parse(swRec).gitStart, what: "git", purpose: "sw" });
    assert.equal(readFileSync(recPath("sw"), "utf8"), swRec, `${args[0]}: the record is kept`);
    assert.equal(alive(switchGit), true, `${args[0]}: that git is not signalled`);
    assert.ok(existsSync(join(home, ".work-sw")), `${args[0]}: the tree is kept`);
  }
  await endGroupByHand(switchGit);
  const swDone = wt(fx, home, ["remove", "--purpose", "sw", "--json"], env);
  assert.equal(swDone.status, 0, swDone.stdout);
  assert.equal(swDone.json().result.rolledBack, true);
  assert.equal(existsSync(join(fx.base, "switch-done")), false, "the switch never ran");
  assert.equal(tipOf(fx, "agents/sw"), null);

  // A hook group: the add killed while its hook runs.
  writeFileSync(join(fx.root, "hook-sleep"), "60");
  const hooked = cliChild(fx, ["worktree", "add", "--purpose", "hk", "--branch", "agents/hk", "--base", "main", "--json"], { cwd: home, env: { OATS_INSTANCE_HOME: home } });
  assert.ok(await waitFor(() => existsSync(join(fx.root, "hook-sleeping"))));
  hooked.child.kill("SIGKILL");
  await hooked.done;
  const hkRec = readFileSync(recPath("hk"), "utf8");
  const { hookPgid, hookStart } = JSON.parse(hkRec);
  t.after(() => { try { process.kill(-hookPgid, "SIGKILL"); } catch { /* gone */ } });
  execFileSync("rm", [join(fx.root, "hook-sleep")]);
  env = { OATS_TEST_PROCESS_START_PS: "1", PATH: unreadablePs(fx, hookPgid) };
  for (const args of [["add", "--purpose", "hk", "--branch", "agents/hk", "--base", "main", "--json"], ["remove", "--purpose", "hk", "--json"]]) {
    check(wt(fx, home, args, env), { pgid: hookPgid, start: hookStart, what: "hook", purpose: "hk" });
    assert.equal(readFileSync(recPath("hk"), "utf8"), hkRec, `${args[0]}: the record is kept`);
    assert.equal(alive(hookPgid), true, `${args[0]}: the hook group is not signalled`);
    assert.ok(existsSync(join(home, ".work-hk")), `${args[0]}: the tree is kept`);
  }
  await endGroupByHand(hookPgid);
  const hkDone = wt(fx, home, ["add", "--purpose", "hk", "--branch", "agents/hk", "--base", "main", "--json"], env);
  assert.equal(hkDone.status, 0, hkDone.stdout + hkDone.stderr);
  assert.equal(hkDone.json().result.state, "ready");
});

test("a killed spawn's hook group whose start cannot be read: retire refuses naming it and `oats retire --force`, never signalling it; --force retires and keeps the branch", async (t) => {
  const fx = deployment(t, { work: "worktree", lifecycle: true });
  const { home, orphan } = await killedSpawn(fx, "dev-unkhook");
  const group = pgidOf(orphan);
  t.after(() => { try { process.kill(-group, "SIGKILL"); } catch { /* gone */ } });
  const { hookStart } = JSON.parse(readFileSync(join(home, ".oats-rollback-incomplete.json"), "utf8")).inProgress;
  const saved = { PATH: process.env.PATH, seam: process.env.OATS_TEST_PROCESS_START_PS };
  process.env.PATH = unreadablePs(fx, group);
  process.env.OATS_TEST_PROCESS_START_PS = "1";
  try {
    await assert.rejects(fx.inEnv(() => retireInstance(fx.root, "dev-unkhook", { tmuxSession: "oats-test-nosuch" })), (e) => {
      assert.equal(e.code, "E_LIFECYCLE_BUSY");
      for (const part of [`hook process group ${group} (leader pid ${group}, recorded start ${hookStart})`, "was not signalled", `kill -TERM -- -${group}`, "`oats retire dev-unkhook --force`"]) assert.ok(e.message.includes(part), `${part}: ${e.message}`);
      assert.equal(e.details.hookPgid, group);
      assert.equal(e.details.remedy, "oats retire dev-unkhook --force");
      return true;
    });
    assert.ok(existsSync(home), "nothing was retired");
    assert.equal(alive(orphan), true, "the hook group is not signalled");
    const r = await fx.inEnv(() => retireInstance(fx.root, "dev-unkhook", { tmuxSession: "oats-test-nosuch", force: true }));
    assert.equal(r.spawnCompensation.branchDeleted, false);
    assert.match(r.spawnCompensation.reason, /could not be verified gone/);
    assert.ok(r.warnings.some((w) => w.includes(`hook process group ${group}`) && w.includes("its branch is kept")), JSON.stringify(r.warnings));
    assert.equal(alive(orphan), true, "--force does not signal it either");
    assert.equal(tipOf(fx, "agents/dev-unkhook") !== null, true, "the branch is kept");
  } finally {
    process.env.PATH = saved.PATH;
    if (saved.seam === undefined) delete process.env.OATS_TEST_PROCESS_START_PS; else process.env.OATS_TEST_PROCESS_START_PS = saved.seam;
  }
});
