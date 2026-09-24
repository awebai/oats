import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { acquirePackage, approveCapability, createAgent, ensureRoot, findAgent, findCapabilityAgent, findRoot, listCapabilityAgents, listInstances, resolveWorkMode, retireInstance, spawnInstance, startInstanceSession } from "../lib/core.mjs";

const CLI = realpathSync(new URL("../bin/oats.mjs", import.meta.url));
const HOST_PATH = process.env.PATH;
function write(file, body) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, body); }
function fixture(t, { git = false, hook = false, packaged = false } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-directory-")));
  const saved = { ...process.env };
  t.after(() => {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    rmSync(base, { recursive: true, force: true });
  });
  // No host identity, credentials, config, runtime, Git, or scheduler can leak
  // into a no-launch probe. Runtimes are inert executables for preflight only.
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, { HOME: join(base, "user"), OATS_HOME_DIR: join(base, "store"), PATH: join(base, "bin"), GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(base, "gitconfig") });
  mkdirSync(process.env.HOME); write(process.env.GIT_CONFIG_GLOBAL, "");
  mkdirSync(process.env.PATH);
  symlinkSync(process.execPath, join(process.env.PATH, "node"));
  for (const name of ["pi", "claude", "codex"]) {
    write(join(process.env.PATH, name), `#!/bin/sh\necho unexpected-runtime-launch >&2\nexit 99\n`);
    chmodSync(join(process.env.PATH, name), 0o755);
  }
  const context = join(base, "context"), root = join(context, "agents");
  mkdirSync(context);
  if (git) {
    process.env.PATH += `:${HOST_PATH}`;
    execFileSync("git", ["init", "-q", context]);
    execFileSync("git", ["-C", context, "-c", "user.name=Fixture", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-qm", "baseline"]);
  }
  const cap = join(context, ".agents", "capabilities", "owned", "worker");
  const manifest = { capability: "example.worker", version: "1.0.0", description: "Provider-neutral execution fixture.", compatibility: { oats: ">=0.6.2" }, skills: ["skills"], inject: "inject.md", ...(packaged ? { agents: ["agents/worker"] } : {}), ...(hook ? { hooks: { spawn: "spawn.mjs", retire: "retire.mjs" } } : {}) };
  write(join(cap, "oats.json"), JSON.stringify(manifest));
  write(join(cap, "skills", "worker-skill", "SKILL.md"), "---\nname: worker-skill\ndescription: Generic worker fixture.\n---\n# Worker skill\n");
  write(join(cap, "inject.md"), "## Generic worker capability\n");
  const soul = packaged ? join(cap, "agents", "worker") : join(root, "worker", "soul");
  write(join(soul, "soul.yaml"), "name: worker\nwork: directory\nruntime: claude\n");
  write(join(soul, "AGENTS.md"), "# Generic worker\n");
  symlinkSync("AGENTS.md", join(soul, "CLAUDE.md"));
  if (hook) {
    write(join(cap, "spawn.mjs"), `import { writeFileSync } from 'node:fs';
const e = process.env;
writeFileSync(e.OATS_INSTANCE_HOME + '/work/from-hook.txt', 'spawn bytes');
console.log(JSON.stringify({meta: {context: e.OATS_CONTEXT, repo: e.OATS_REPO, root: e.OATS_ROOT, work: e.OATS_WORK, branch: e.OATS_BRANCH, cli: e.OATS_CLI_BIN}}));\n`);
    write(join(cap, "retire.mjs"), `console.log(JSON.stringify({meta: {retired: true}}));\n`);
  }
  write(join(context, "oats-config.yaml"), "capabilities:\n  additive:\n    example.worker:\n      from: owned\n      global: true\n");
  const agent = () => packaged ? findCapabilityAgent(context, root, "worker") : findAgent(root, "worker");
  const spawn = (purpose, options = {}) => spawnInstance(root, agent(), { purpose, launch: false, ...options });
  return { base, context, root, cap, soul, agent, spawn };
}
function cli(f, args, cwd = f.context) {
  return spawnSync(process.execPath, [CLI, ...args, "--dir", f.context, "--json"], { cwd, env: process.env, encoding: "utf8" });
}
function cliSpawn(f, args = [], cwd) {
  const result = cli(f, ["spawn", "worker", "--purpose", "cli", "--no-launch", ...args], cwd);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.ok, true);
  return envelope.result;
}
function readJson(file) { return JSON.parse(readFileSync(file, "utf8")); }

test("actual core spawn: directory mode has no Git dependency, canonical composition and launch metadata", (t) => {
  const f = fixture(t, { hook: true });
  assert.equal(spawnSync("git", ["--version"]).error?.code, "ENOENT");
  const result = f.spawn("core");
  assert.equal(result.work, "directory");
  assert.equal(result.repo, f.context);
  assert.equal(result.branch, undefined);
  assert.equal(result.launched, false);
  assert.equal(result.launch.runtime, "claude");
  assert.equal(result.capabilityRuntime[0].trust.trusted, true);
  assert.equal(lstatSync(join(result.home, "work")).isDirectory(), true);
  assert.equal(lstatSync(join(result.home, "work")).isSymbolicLink(), false);
  assert.equal(existsSync(join(result.home, "work", ".git")), false);
  assert.equal(readlinkSync(join(result.home, "CLAUDE.md")), "AGENTS.md");
  assert.equal(readlinkSync(join(result.home, ".claude", "skills")), "../.agents/skills");
  assert.ok(result.skills.some((s) => s.name === "worker-skill"));
  assert.match(readFileSync(join(result.home, "AGENTS.md"), "utf8"), /Work mode: directory/);
  assert.match(readFileSync(join(result.home, "TASK.md"), "utf8"), /configuration only/);
  assert.deepEqual(result.capabilityMeta["example.worker"], { context: f.context, repo: f.context, root: f.root, work: "directory", branch: "", cli: CLI });
  assert.equal(listInstances(f.root)[0].instances[0].instance, result.instance);
  const retired = retireInstance(f.root, result.instance);
  assert.equal(retired.worktreeRemoved, false);
  assert.equal(retired.branchDeleted, false);
  assert.equal(readFileSync(join(retired.workRecovery.path, "work", "from-hook.txt"), "utf8"), "spawn bytes");
});

test("package-only non-Git configured workspace is discoverable and CLI-spawnable before local directories exist", (t) => {
  const f = fixture(t, { packaged: true });
  assert.equal(existsSync(f.root), false);
  assert.equal(existsSync(join(f.context, "local-agents")), false);
  assert.equal(ensureRoot(f.context), f.root);
  assert.equal(listCapabilityAgents(f.context)[0].name, "worker");
  const result = cliSpawn(f);
  assert.equal(result.work, "directory");
  assert.equal(result.home, join(f.context, "local-agents", "worker", "instances", "worker-cli"));
  assert.equal(existsSync(join(result.home, "soul")), false, "an instance home carries no soul link");
  assert.equal(JSON.parse(readFileSync(join(result.home, "instance.json"), "utf8")).soulDir, f.soul);
  const status = cli(f, ["status"]);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).agents[0].instances[0].instance, result.instance);
  const retired = cli(f, ["retire", result.instance]);
  assert.equal(retired.status, 0, retired.stderr);
  assert.equal(JSON.parse(retired.stdout).worktreeRemoved, false);
  assert.equal(existsSync(result.home), false);
  assert.equal(readFileSync(join(f.soul, "AGENTS.md"), "utf8"), "# Generic worker\n");
});

test("laptop config alone is not a deployment; existing agents root still wins over nested config", (t) => {
  const f = fixture(t);
  write(join(process.env.HOME, "oats-config.yaml"), "name: laptop\n");
  const unrelated = join(process.env.HOME, "unconfigured"); mkdirSync(unrelated);
  assert.equal(findRoot(unrelated), undefined);
  const nested = join(f.context, "nested"); mkdirSync(nested);
  write(join(nested, "oats-config.yaml"), "name: nested\n");
  assert.equal(findRoot(nested), f.root);
});

test("explicit CLI directory override works; ambient source context and workDir are never adopted", (t) => {
  const f = fixture(t);
  write(join(f.soul, "soul.yaml"), "name: worker\nwork: checkout\nruntime: claude\n");
  const source = join(f.base, "source"); write(join(source, "sentinel.txt"), "source");
  const result = cliSpawn(f, ["--work", "directory"], source);
  const meta = readJson(join(result.home, "instance.json"));
  assert.equal(meta.repo, f.context);
  assert.equal(meta.work, "directory");
  assert.deepEqual(readdirSync(join(result.home, "work")), []);
  retireInstance(f.root, result.instance);
  assert.equal(readFileSync(join(source, "sentinel.txt"), "utf8"), "source");
});

test("directory repo selector resolves only config, including a non-Git relative path", (t) => {
  const f = fixture(t);
  const external = join(f.base, "other-context"); write(join(external, "sentinel.txt"), "not owned");
  const result = f.spawn("context", { repo: "../other-context" });
  assert.equal(result.repo, external);
  assert.deepEqual(readdirSync(join(result.home, "work")), []);
  assert.equal(result.skills.some((s) => s.name === "worker-skill"), false, "uses the selected context, not source bindings");
  retireInstance(f.root, result.instance, { deleteBranch: true });
  assert.equal(readFileSync(join(external, "sentinel.txt"), "utf8"), "not owned");
});

test("core rejects contradictory, poisoned or escaping options before creating homes", (t) => {
  const f = fixture(t);
  const outside = join(f.base, "outside"); write(join(outside, "sentinel"), "keep");
  for (const options of [
    ...[outside, "../../outside", "", true, false, "--branch", "/tmp/x\0y"].map((workDir) => ({ workDir })),
    ...["main", "../../outside", "", true, false, "--worktree"].map((branch) => ({ branch })),
    ...[null, true, false, "", "missing", "bad\0path", join(outside, "sentinel")].map((repo) => ({ repo })),
  ]) {
    assert.throws(() => f.spawn("invalid", options), (e) => e.code === "E_BAD_ARGS", JSON.stringify(options));
    assert.equal(existsSync(join(f.root, "worker", "instances", "worker-invalid")), false);
  }
  assert.equal(readFileSync(join(outside, "sentinel"), "utf8"), "keep");
});

test("CLI rejects directory branch/work-dir combinations and missing values as E_BAD_ARGS", (t) => {
  const f = fixture(t);
  const outside = join(f.base, "outside"); write(join(outside, "sentinel"), "keep");
  for (const args of [["--branch", "main"], ["--work-dir", outside], ["--work-dir", "../../outside"], ["--work-dir"], ["--branch"], ["--repo"], ["--work", "directory", "--branch", "main"]]) {
    const result = cli(f, ["spawn", "worker", "--purpose", "invalid", "--no-launch", ...args]);
    assert.notEqual(result.status, 0, JSON.stringify(args));
    assert.equal(JSON.parse(result.stdout).error.code, "E_BAD_ARGS", result.stdout + result.stderr);
    assert.equal(existsSync(join(f.root, "worker", "instances", "worker-invalid")), false);
  }
  assert.equal(readFileSync(join(outside, "sentinel"), "utf8"), "keep");
});

test("directory spawn rejects symlink escapes in home placement", (t) => {
  const f = fixture(t);
  const outside = join(f.base, "outside"); mkdirSync(outside);
  symlinkSync(outside, join(f.root, "worker", "instances"));
  assert.throws(() => f.spawn("escape"), (e) => e.code === "E_NO_CANONICAL_ROOT");
  assert.deepEqual(readdirSync(outside), []);
});

test("ordinary directory work, hidden files, empty directories, executable bits and links survive verified recovery", (t) => {
  const f = fixture(t);
  const result = f.spawn("recover");
  const work = join(result.home, "work");
  write(join(work, "authored.txt"), "precious\n");
  write(join(work, ".hidden"), "hidden\n");
  write(join(work, "run"), "#!/bin/sh\nexit 0\n"); chmodSync(join(work, "run"), 0o755);
  mkdirSync(join(work, "empty"));
  const external = join(f.base, "external"); write(external, "external");
  symlinkSync(external, join(work, "link")); symlinkSync("missing", join(work, "dangling"));
  write(join(result.home, "notes.txt"), "home notes\n");
  const retired = retireInstance(f.root, result.instance);
  assert.equal(existsSync(result.home), false);
  assert.ok(retired.workRecovery.classes.includes("directory work bytes"));
  const recovered = join(retired.workRecovery.path, "work");
  assert.equal(readFileSync(join(recovered, "authored.txt"), "utf8"), "precious\n");
  assert.equal(readFileSync(join(recovered, ".hidden"), "utf8"), "hidden\n");
  assert.equal(lstatSync(join(recovered, "run")).mode & 0o777, 0o755);
  assert.equal(lstatSync(join(recovered, "empty")).isDirectory(), true);
  assert.equal(readlinkSync(join(recovered, "link")), external);
  assert.equal(readlinkSync(join(recovered, "dangling")), "missing");
  assert.equal(readFileSync(join(retired.workRecovery.path, "home", "notes.txt"), "utf8"), "home notes\n");
  assert.equal(readFileSync(external, "utf8"), "external");
});

test("post-retire-hook changes with unchanged filenames get a second verified directory snapshot", (t) => {
  const f = fixture(t, { hook: true });
  write(join(f.cap, "retire.mjs"), `import { writeFileSync } from 'node:fs';
writeFileSync(process.env.OATS_INSTANCE_HOME + '/work/from-hook.txt', 'retire bytes');
console.log(JSON.stringify({meta: {retired: true}}));\n`);
  const result = f.spawn("post-hook");
  const retired = retireInstance(f.root, result.instance);
  assert.equal(retired.workRecoveries.length, 2);
  assert.equal(readFileSync(join(retired.workRecoveries[0].path, "work", "from-hook.txt"), "utf8"), "spawn bytes");
  assert.equal(readFileSync(join(retired.workRecoveries[1].path, "work", "from-hook.txt"), "utf8"), "retire bytes");
});

test("incomplete retire hooks retain directory work and cleanup metadata for a safe retry", (t) => {
  const f = fixture(t, { hook: true });
  write(join(f.cap, "retire.mjs"), `import { existsSync } from 'node:fs';
console.log(JSON.stringify({meta: {retired: existsSync(process.env.OATS_CONTEXT + '/retry-ready')}}));\n`);
  const result = f.spawn("retry");
  const first = retireInstance(f.root, result.instance);
  assert.ok(first.rollbackIncomplete?.length);
  assert.equal(existsSync(result.home), true);
  assert.equal(readFileSync(join(first.workRecovery.path, "work", "from-hook.txt"), "utf8"), "spawn bytes");
  write(join(f.context, "retry-ready"), "ready");
  const second = retireInstance(f.root, result.instance);
  assert.equal(second.rollbackIncomplete, undefined);
  assert.equal(existsSync(result.home), false);
});

test("retirement fails closed for exchanged work roots, missing authority and poisoned work-mode metadata", (t) => {
  const f = fixture(t);
  for (const kind of ["symlink", "dangling-root", "metadata", "missing-authority"]) {
    const result = f.spawn(kind);
    const work = join(result.home, "work"); write(join(work, "authored"), "keep");
    if (kind === "symlink" || kind === "dangling-root") {
      rmSync(work, { recursive: true });
      const outside = join(f.base, kind); if (kind === "symlink") write(join(outside, "sentinel"), "keep");
      symlinkSync(outside, work);
    } else if (kind === "metadata") {
      const file = join(result.home, "instance.json"), meta = readJson(file);
      meta.work = "checkout"; meta.branch = "main"; write(file, JSON.stringify(meta));
    } else rmSync(join(dirname(result.home), ".oats-retirement", "baselines"), { recursive: true });
    assert.throws(() => retireInstance(f.root, result.instance, { force: true, deleteBranch: true }), (e) => e.code === "E_WORK_INSPECTION_FAILED");
    assert.equal(existsSync(result.home), true);
  }
});

test("retirement preserves work in place if recovery storage is unusable", (t) => {
  const f = fixture(t);
  const result = f.spawn("blocked-recovery");
  write(join(result.home, "work", "authored"), "keep");
  write(join(dirname(result.home), ".oats-retirement", "recovery"), "not a directory");
  assert.throws(() => retireInstance(f.root, result.instance));
  assert.equal(readFileSync(join(result.home, "work", "authored"), "utf8"), "keep");
});

test("directory mode never uses worktree setup or disposable exemptions", (t) => {
  const f = fixture(t);
  write(join(f.context, "oats-config.yaml"), `work-modes:\n  directory:\n    setup: missing-script\n    retirement-disposable: [cache]\n`);
  assert.ok(resolveWorkMode(f.context, "directory").inject.endsWith("work-directory.md"));
  const result = f.spawn("no-disposable");
  assert.equal(result.warnings, undefined);
  write(join(result.home, "work", "cache", "authored"), "keep");
  const retired = retireInstance(f.root, result.instance);
  assert.equal(readFileSync(join(retired.workRecovery.path, "work", "cache", "authored"), "utf8"), "keep");
});

test("directory souls can be created with non-Git context without weakening other modes", (t) => {
  const f = fixture(t);
  const created = createAgent(f.root, { name: "new-worker", work: "directory", repo: ".", runtime: "claude" });
  assert.equal(existsSync(join(created.soul, "soul.yaml")), true);
  for (const work of ["checkout", "worktree", "attached", "workspace"]) {
    assert.throws(() => f.spawn(`not-${work}`, { work, repo: ".", ...(work === "attached" ? { workDir: f.context } : {}) }), /not a git repo/);
  }
  const unknown = cli(f, ["spawn", "worker", "--work", "nonGit", "--no-launch"]);
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stdout, /unknown work mode/);
});

test("existing Git checkout, worktree, attached and workspace modes keep their layout and retirement semantics", (t) => {
  const f = fixture(t, { git: true });
  const checkout = f.spawn("checkout", { work: "checkout", repo: "." });
  assert.equal(realpathSync(join(checkout.home, "work")), f.context);
  const worktree = f.spawn("tree", { work: "worktree", repo: "." });
  assert.equal(existsSync(join(worktree.home, "work", ".git")), true);
  assert.equal(worktree.branch, `agents/${worktree.instance}`);
  const attached = f.spawn("attached", { work: "attached", repo: ".", workDir: join(worktree.home, "work") });
  assert.equal(attached.parentInstance, worktree.instance);
  assert.equal(realpathSync(join(attached.home, "work")), realpathSync(join(worktree.home, "work")));
  const workspace = f.spawn("workspace", { work: "workspace", repo: "." });
  assert.equal(realpathSync(join(workspace.home, "work")), f.context);
  assert.equal(workspace.branch, undefined);
  retireInstance(f.root, attached.instance);
  assert.equal(existsSync(join(worktree.home, "work")), true);
  retireInstance(f.root, workspace.instance);
  retireInstance(f.root, checkout.instance);
  assert.equal(existsSync(join(f.context, ".git")), true);
  retireInstance(f.root, worktree.instance, { deleteBranch: true });
  assert.equal(existsSync(worktree.home), false);
});

test("Git-owned home placement still fails closed when Git is unavailable even for explicit directory execution", (t) => {
  const f = fixture(t, { git: true });
  process.env.PATH = join(f.base, "bin");
  assert.throws(() => f.spawn("no-git-owned"), (e) => e.code === "E_NO_CANONICAL_ROOT");
});

test("installed package agent integrity and executable trust remain enforced in a non-Git workspace", (t) => {
  const f = fixture(t, { packaged: true });
  const source = join(f.base, "package"), sourceCap = join(source, "capabilities", "worker");
  // Use the real acquisition engine, not a fabricated lock/store.
  mkdirSync(sourceCap, { recursive: true });
  for (const [rel, content] of [
    ["oats.json", JSON.stringify({ capability: "example.installed", version: "1.0.0", description: "Installed worker.", compatibility: { oats: ">=0.6.2" }, agents: ["agents/installed"], hooks: { spawn: { command: "spawn.mjs", required: true } } })],
    ["agents/installed/soul.yaml", "name: installed\nwork: directory\nruntime: claude\n"],
    ["agents/installed/AGENTS.md", "# Installed worker\n"],
    ["spawn.mjs", "console.log(JSON.stringify({meta: {ready: true}}));\n"],
  ]) write(join(sourceCap, rel), content);
  symlinkSync("AGENTS.md", join(sourceCap, "agents", "installed", "CLAUDE.md"));
  write(join(source, "oats-package.json"), JSON.stringify({ package: "example.workers", version: "1.0.0", description: "Worker fixtures.", compatibility: { oats: ">=0.6.2" }, capabilities: ["capabilities/worker"] }));
  acquirePackage(f.context, source);
  write(join(f.context, "oats-config.yaml"), "capabilities:\n  additive:\n    example.installed:\n      from: installed\n      global: true\n");
  const agent = findCapabilityAgent(f.context, f.root, "installed");
  assert.ok(agent);
  assert.throws(() => spawnInstance(f.root, agent, { purpose: "untrusted", launch: false }), /trust|blocked|could not configure/i);
  approveCapability(f.context, "example.installed");
  const launched = spawnInstance(f.root, agent, { purpose: "trusted", launch: false });
  assert.equal(launched.capabilityMeta["example.installed"].ready, true);
  retireInstance(f.root, launched.instance);
  write(join(agent._soulDir, "AGENTS.md"), "tampered");
  assert.throws(() => findCapabilityAgent(f.context, f.root, "installed"), (e) => e.code === "integrity-drift");
  assert.ok(listCapabilityAgents(f.context).diagnostics.length);
});

test("the Desktop work-mode schema forwards explicit directory mode without loosening argv validation", async () => {
  const { spawnArgv } = await import("../packages/desktop/cli-adapter.mjs");
  const argv = spawnArgv("worker", "/context", "/task", { work: "directory" });
  assert.equal(argv[argv.indexOf("--work") + 1], "directory");
  assert.throws(() => spawnArgv("worker", "/context", "/task", { work: "directory --work-dir /source" }), /invalid/);
});

test("CLI --dir isolates directory execution from the invoking Git checkout", (t) => {
  const f = fixture(t);
  const source = join(f.base, "source-repo"); mkdirSync(source);
  process.env.PATH += `:${HOST_PATH}`;
  execFileSync("git", ["init", "-q", source]);
  write(join(source, "oats-config.yaml"), "name: unrelated-source\n");
  const result = cliSpawn(f, [], source);
  assert.equal(readJson(join(result.home, "instance.json")).repo, f.context);
  assert.equal(existsSync(join(result.home, "work", ".git")), false);
  retireInstance(f.root, result.instance);
  assert.equal(existsSync(join(source, ".git")), true);
});

test("failed spawn preserves directory results before and after compensation instead of deleting them", (t) => {
  const f = fixture(t, { hook: true });
  const manifest = readJson(join(f.cap, "oats.json"));
  manifest.hooks.spawn = { command: "spawn.mjs", required: true };
  write(join(f.cap, "oats.json"), JSON.stringify(manifest));
  write(join(f.cap, "spawn.mjs"), `import { writeFileSync } from 'node:fs';
writeFileSync(process.env.OATS_INSTANCE_HOME + '/work/result.txt', 'before compensation');
process.exitCode = 1;\n`);
  write(join(f.cap, "retire.mjs"), `import { writeFileSync } from 'node:fs';
writeFileSync(process.env.OATS_INSTANCE_HOME + '/work/result.txt', 'after compensation');
console.log(JSON.stringify({meta: {retired: true}}));\n`);
  assert.throws(() => f.spawn("rollback"), (e) => e.code === "E_REQUIRED_HOOK_FAILED" && /directory work preserved at/.test(e.message));
  const home = join(f.root, "worker", "instances", "worker-rollback");
  assert.equal(existsSync(home), false);
  const recovery = join(dirname(home), ".oats-retirement", "recovery");
  const copies = readdirSync(recovery).map((entry) => readFileSync(join(recovery, entry, "work", "result.txt"), "utf8")).sort();
  assert.deepEqual(copies, ["after compensation", "before compensation"]);
});

test("directory recovery refuses storage redirected into disposable work or an arbitrary outside path", (t) => {
  const f = fixture(t);
  for (const target of ["work", "outside"]) {
    const result = f.spawn(`redirected-${target}`);
    write(join(result.home, "work", "authored"), "keep");
    const recovery = join(dirname(result.home), ".oats-retirement", "recovery");
    const destination = target === "work" ? join(result.home, "work") : join(f.base, "outside-recovery");
    if (target === "outside") mkdirSync(destination);
    symlinkSync(destination, recovery);
    assert.throws(() => retireInstance(f.root, result.instance), (e) => e.code === "E_WORK_PRESERVATION_FAILED");
    assert.equal(readFileSync(join(result.home, "work", "authored"), "utf8"), "keep");
    rmSync(recovery);
  }
});

test("unsupported filesystem entries fail retirement closed, even with force", (t) => {
  const f = fixture(t);
  const result = f.spawn("fifo");
  write(join(result.home, "work", "authored"), "keep");
  execFileSync("mkfifo", [join(result.home, "work", "pipe")], { env: { ...process.env, PATH: HOST_PATH } });
  assert.throws(() => retireInstance(f.root, result.instance, { force: true }), (e) => e.code === "E_WORK_INSPECTION_FAILED");
  assert.equal(readFileSync(join(result.home, "work", "authored"), "utf8"), "keep");
});

test("explicit contradictory directory CLI options cannot upsert a local soul", (t) => {
  const f = fixture(t);
  const instructions = join(f.base, "instructions.md"); write(instructions, "# Local instructions\n");
  const result = cli(f, ["spawn", "new-local", "--instructions-file", instructions, "--work", "directory", "--branch", "main", "--no-launch"]);
  assert.notEqual(result.status, 0);
  assert.equal(JSON.parse(result.stdout).error.code, "E_BAD_ARGS");
  assert.equal(existsSync(join(f.context, "local-agents")), false);
});

test("directory mode is runtime-neutral and records the frozen no-launch recipe for every supported runtime", (t) => {
  const f = fixture(t);
  for (const runtime of ["pi", "claude", "codex"]) {
    const result = f.spawn(`runtime-${runtime}`, { runtime });
    const meta = readJson(join(result.home, "instance.json"));
    assert.equal(meta.launch.runtime, runtime);
    assert.equal(meta.runtime, runtime);
    assert.equal(meta.launched, false);
    assert.equal(meta.work, "directory");
    assert.ok(meta.command.includes(result.home));
    assert.equal(lstatSync(join(result.home, "work")).isDirectory(), true);
    retireInstance(f.root, result.instance);
  }
});

test("keep-dir retirement retains the owned directory as well as a recovery receipt", (t) => {
  const f = fixture(t);
  const result = f.spawn("keep");
  write(join(result.home, "work", "authored"), "keep");
  const retired = retireInstance(f.root, result.instance, { keepDir: true });
  assert.equal(retired.removedDir, false);
  assert.equal(readFileSync(join(result.home, "work", "authored"), "utf8"), "keep");
  assert.equal(readFileSync(join(retired.workRecovery.path, "work", "authored"), "utf8"), "keep");
});

for (const phase of ["before", "after-incomplete", "after-complete"]) {
  test(`failed directory spawn: recovery failure ${phase} compensation retains original cleanup authority without instance.json`, (t) => {
    const f = fixture(t, { hook: true });
    const manifest = readJson(join(f.cap, "oats.json"));
    manifest.hooks.spawn = { command: "spawn.mjs", required: true };
    write(join(f.cap, "oats.json"), JSON.stringify(manifest));
    const home = join(f.root, "worker/instances/worker-recovery-fail");
    const recovery = join(dirname(home), ".oats-retirement/recovery");
    const events = join(f.context, "compensation.jsonl");
    write(join(f.cap, "spawn.mjs"), `import { writeFileSync } from 'node:fs';
writeFileSync(process.env.OATS_INSTANCE_HOME + '/work/result.txt', 'before compensation');
console.log(JSON.stringify({meta: {receipt: 'original-external-id'}}));
process.exitCode = 1;`);
    write(join(f.cap, "retire.mjs"), `import { appendFileSync, existsSync, renameSync, writeFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(events)}, process.env.OATS_META + '\\n');
writeFileSync(process.env.OATS_INSTANCE_HOME + '/work/result.txt', 'after compensation');
const retry = existsSync(process.env.OATS_CONTEXT + '/retry-ready');
if (${phase !== "before"} && !retry) {
  renameSync(${JSON.stringify(recovery)}, ${JSON.stringify(recovery + "-first")});
  writeFileSync(${JSON.stringify(recovery)}, 'storage temporarily unavailable');
}
console.log(JSON.stringify({meta: {retired: retry || ${phase === "after-complete"}, receipt: 'not-the-spawn-receipt'}}));`);
    if (phase === "before") write(recovery, "storage temporarily unavailable");
    assert.throws(() => f.spawn("recovery-fail"), (e) => e.code === "E_REQUIRED_HOOK_FAILED" && /home is RETAINED/.test(e.message));
    assert.equal(existsSync(join(home, "instance.json")), false);
    const markerPath = join(home, ".oats-rollback-incomplete.json");
    const marker = readJson(markerPath);
    assert.deepEqual(marker.cleanup.capabilityMeta, { "example.worker": { receipt: "original-external-id" } });
    assert.deepEqual(marker.cleanup.outstanding, { hooks: ["example.worker"], git: [], directory: true });
    assert.equal(marker.cleanup.work, "directory");
    assert.equal(marker.cleanup.launched, false);
    assert.ok(marker.cleanup.capabilityRuntime[0].hooks.retire);
    if (phase !== "before") assert.equal(marker.compensationReported["example.worker"].receipt, "not-the-spawn-receipt");
    const baselines = join(dirname(home), ".oats-retirement/baselines");
    const baseline = readJson(join(baselines, readdirSync(baselines)[0]));
    assert.equal(baseline.home, home);
    assert.equal(baseline.directoryWork, true);
    assert.deepEqual(baseline.runtime, { launched: false });
    // A retry while storage is still broken must keep the receipt and must not
    // run the destructive hook ahead of preserving the outstanding work bytes.
    assert.throws(() => retireInstance(f.root, "worker-recovery-fail"));
    assert.deepEqual(readJson(markerPath), marker);
    assert.equal(existsSync(events), phase !== "before");
    assert.equal(readFileSync(join(home, "work/result.txt"), "utf8"), phase === "before" ? "before compensation" : "after compensation");
    rmSync(recovery);
    if (phase !== "before") renameSync(recovery + "-first", recovery);
    write(join(f.context, "retry-ready"), "ready");
    const retired = retireInstance(f.root, "worker-recovery-fail");
    assert.equal(retired.rollbackIncomplete, undefined);
    assert.equal(retired.removedDir, true);
    assert.equal(existsSync(home), false);
    const receipts = readFileSync(events, "utf8").trim().split("\n").map(JSON.parse);
    assert.deepEqual(receipts, Array(phase === "before" ? 1 : 2).fill({ receipt: "original-external-id" }));
    const copies = readdirSync(recovery).map((entry) => readFileSync(join(recovery, entry, "work/result.txt"), "utf8"));
    assert.ok(copies.includes("before compensation"));
    assert.ok(copies.includes("after compensation"));
  });
}

for (const launch of [false, true]) for (const kind of ["symlink", "dangling", "missing", "file"]) {
  test(`post-spawn hook work root ${kind} cannot succeed or reach backend (launch=${launch})`, (t) => {
    const f = fixture(t, { hook: true });
    const events = join(f.base, "backend.jsonl");
    write(join(f.base, "bin/tmux"), `#!${process.execPath}
const { appendFileSync } = require('node:fs');
appendFileSync(${JSON.stringify(events)}, JSON.stringify(process.argv.slice(2)) + '\\n');
if (process.argv[2] === 'display-message') console.log(${JSON.stringify(join(f.base, "fake.sock"))});
`);
    chmodSync(join(f.base, "bin/tmux"), 0o755);
    write(join(f.context, "sentinel"), "not owned");
    const untouched = readdirSync(f.context).sort();
    write(join(f.cap, "spawn.mjs"), `import { renameSync, symlinkSync, writeFileSync } from 'node:fs';
const home = process.env.OATS_INSTANCE_HOME;
writeFileSync(home + '/work/authored', 'keep original work');
renameSync(home + '/work', home + '/original-work');
if (${kind === "symlink" || kind === "dangling"}) symlinkSync(process.env.OATS_CONTEXT + ${JSON.stringify(kind === "dangling" ? "/absent" : "")}, home + '/work');
if (${kind === "file"}) writeFileSync(home + '/work', 'not a directory');
console.log(JSON.stringify({meta: {receipt: 'original-hook-receipt'}}));`);
    write(join(f.cap, "retire.mjs"), `import { writeFileSync } from 'node:fs';
writeFileSync(process.env.OATS_CONTEXT + '/retired.json', process.env.OATS_META);
console.log(JSON.stringify({meta: {retired: true}}));`);
    const home = join(f.root, "worker/instances/worker-substituted");
    assert.throws(() => f.spawn("substituted", { launch, tmuxSession: "inert-fixture-only" }), (e) => e.code === "E_WORK_INSPECTION_FAILED" && /RETAINED/.test(e.message));
    assert.equal(existsSync(events), false, "no backend command may run with the substituted root");
    assert.equal(existsSync(join(home, "instance.json")), false);
    assert.equal(existsSync(join(home, "TASK.md")), false);
    assert.deepEqual(readdirSync(f.context).sort(), untouched, "must not compensate through or write into the substituted target");
    const marker = readJson(join(home, ".oats-rollback-incomplete.json"));
    assert.deepEqual(marker.cleanup.capabilityMeta, { "example.worker": { receipt: "original-hook-receipt" } });
    assert.deepEqual(marker.cleanup.outstanding.hooks, ["example.worker"]);
    assert.equal(marker.cleanup.outstanding.directory, true);
    assert.throws(() => retireInstance(f.root, "worker-substituted", { force: true, deleteBranch: true }), (e) => e.code === "E_WORK_INSPECTION_FAILED");
    assert.equal(readFileSync(join(f.context, "sentinel"), "utf8"), "not owned");
    if (kind !== "missing") rmSync(join(home, "work")); // unlink only; never recurse through a target
    renameSync(join(home, "original-work"), join(home, "work"));
    const retired = retireInstance(f.root, "worker-substituted");
    assert.equal(retired.rollbackIncomplete, undefined);
    assert.equal(readFileSync(join(retired.workRecovery.path, "work/authored"), "utf8"), "keep original work");
    assert.deepEqual(readJson(join(f.context, "retired.json")), { receipt: "original-hook-receipt" });
    assert.equal(existsSync(home), false);
    assert.equal(existsSync(events), false);
  });
}

for (const kind of ["symlink", "missing", "file"]) {
  test(`post-spawn hook ${kind} home keeps cleanup beside it without following the replacement`, (t) => {
    const f = fixture(t, { hook: true });
    const savedHome = join(f.base, "original-home");
    write(join(f.context, "sentinel"), "keep");
    const untouched = readdirSync(f.context).sort();
    write(join(f.cap, "spawn.mjs"), `import { renameSync, symlinkSync, writeFileSync } from 'node:fs';
const home = process.env.OATS_INSTANCE_HOME;
writeFileSync(home + '/work/authored', 'keep');
renameSync(home, ${JSON.stringify(savedHome)});
if (${kind === "symlink"}) symlinkSync(process.env.OATS_CONTEXT, home);
if (${kind === "file"}) writeFileSync(home, 'not the home');
console.log(JSON.stringify({meta: {receipt: 'original-home-receipt'}}));`);
    write(join(f.cap, "retire.mjs"), `import { writeFileSync } from 'node:fs';
writeFileSync(process.env.OATS_CONTEXT + '/retired.json', process.env.OATS_META);
console.log(JSON.stringify({meta: {retired: true}}));`);
    const home = join(f.root, "worker/instances/worker-home-replaced");
    assert.throws(() => f.spawn("home-replaced"), (e) => e.code === "E_WORK_INSPECTION_FAILED");
    assert.deepEqual(readdirSync(f.context).sort(), untouched);
    const markerPath = join(dirname(home), ".oats-directory-rollback-worker-home-replaced.json");
    const marker = readJson(markerPath);
    assert.deepEqual(marker.cleanup.capabilityMeta, { "example.worker": { receipt: "original-home-receipt" } });
    assert.deepEqual(marker.cleanup.outstanding, { hooks: ["example.worker"], git: [], directory: true });
    if (kind === "missing") assert.throws(() => f.spawn("home-replaced"), /cleanup is still owed/);
    assert.throws(() => retireInstance(f.root, "worker-home-replaced", { force: true }));
    assert.throws(() => startInstanceSession(home), (e) => e.code === "E_INSTANCE_RETIRING");
    assert.deepEqual(readdirSync(f.context).sort(), untouched);
    if (kind !== "missing") rmSync(home);
    renameSync(savedHome, home);
    assert.ok(listInstances(f.root)[0].instances[0].rollbackIncomplete);
    assert.throws(() => startInstanceSession(home), (e) => e.code === "E_INSTANCE_RETIRING");
    const retired = retireInstance(f.root, "worker-home-replaced");
    assert.equal(retired.removedDir, true);
    assert.equal(retired.rollbackIncomplete, undefined);
    assert.equal(existsSync(markerPath), false);
    assert.deepEqual(readJson(join(f.context, "retired.json")), { receipt: "original-home-receipt" });
    assert.equal(readFileSync(join(retired.workRecovery.path, "work/authored"), "utf8"), "keep");
  });
}

test("directory preservation alone is retryable debt; it does not invent a missing retire hook", (t) => {
  const f = fixture(t, { hook: true });
  const manifest = readJson(join(f.cap, "oats.json"));
  delete manifest.hooks.retire;
  write(join(f.cap, "oats.json"), JSON.stringify(manifest));
  write(join(f.cap, "spawn.mjs"), `import { mkdirSync, writeFileSync } from 'node:fs';
writeFileSync(process.env.OATS_INSTANCE_HOME + '/work/authored', 'keep');
mkdirSync(process.env.OATS_INSTANCE_HOME + '/TASK.md');`);
  const home = join(f.root, "worker/instances/worker-preservation-only");
  const recovery = join(dirname(home), ".oats-retirement/recovery");
  write(recovery, "temporarily unavailable");
  assert.throws(() => f.spawn("preservation-only"), /RETAINED/);
  const marker = readJson(join(home, ".oats-rollback-incomplete.json"));
  assert.deepEqual(marker.cleanup.outstanding, { hooks: [], git: [], directory: true });
  assert.equal(existsSync(join(home, "instance.json")), false);
  rmSync(recovery);
  const retired = retireInstance(f.root, "worker-preservation-only");
  assert.equal(retired.rollbackIncomplete, undefined);
  assert.equal(retired.removedDir, true);
  assert.equal(readFileSync(join(retired.workRecovery.path, "work/authored"), "utf8"), "keep");
});

test("compensation cannot substitute the directory root or replace the original retry receipt", (t) => {
  const f = fixture(t, { hook: true });
  const manifest = readJson(join(f.cap, "oats.json"));
  manifest.hooks.spawn = { command: "spawn.mjs", required: true };
  write(join(f.cap, "oats.json"), JSON.stringify(manifest));
  write(join(f.context, "sentinel"), "not owned");
  write(join(f.cap, "spawn.mjs"), `import { writeFileSync } from 'node:fs';
writeFileSync(process.env.OATS_INSTANCE_HOME + '/work/authored', 'keep');
console.log(JSON.stringify({meta: {receipt: 'original'}}));
process.exitCode = 1;`);
  write(join(f.cap, "retire.mjs"), `import { appendFileSync, existsSync, renameSync, symlinkSync } from 'node:fs';
appendFileSync(process.env.OATS_CONTEXT + '/receipts.jsonl', process.env.OATS_META + '\\n');
const retry = existsSync(process.env.OATS_CONTEXT + '/retry-ready');
if (!retry) {
  renameSync(process.env.OATS_INSTANCE_HOME + '/work', process.env.OATS_INSTANCE_HOME + '/original-work');
  symlinkSync(process.env.OATS_CONTEXT, process.env.OATS_INSTANCE_HOME + '/work');
}
console.log(JSON.stringify({meta: {retired: retry, receipt: 'compensation-report-only'}}));`);
  const home = join(f.root, "worker/instances/worker-compensation-swap");
  assert.throws(() => f.spawn("compensation-swap"), (e) => e.code === "E_REQUIRED_HOOK_FAILED" && /prior work recovery/.test(e.message));
  const marker = readJson(join(home, ".oats-rollback-incomplete.json"));
  assert.deepEqual(marker.cleanup.capabilityMeta, { "example.worker": { receipt: "original" } });
  assert.equal(marker.compensationReported["example.worker"].receipt, "compensation-report-only");
  assert.throws(() => retireInstance(f.root, "worker-compensation-swap", { force: true }), (e) => e.code === "E_WORK_INSPECTION_FAILED");
  assert.equal(readFileSync(join(f.context, "sentinel"), "utf8"), "not owned");
  rmSync(join(home, "work"));
  renameSync(join(home, "original-work"), join(home, "work"));
  write(join(f.context, "retry-ready"), "ready");
  const retired = retireInstance(f.root, "worker-compensation-swap");
  assert.equal(retired.removedDir, true);
  assert.equal(retired.rollbackIncomplete, undefined);
  assert.deepEqual(readFileSync(join(f.context, "receipts.jsonl"), "utf8").trim().split("\n").map(JSON.parse), [{ receipt: "original" }, { receipt: "original" }]);
  assert.equal(readFileSync(join(retired.workRecovery.path, "work/authored"), "utf8"), "keep");
});

test("directory preservation debt never clears an external receipt with no retire hook", (t) => {
  const f = fixture(t, { hook: true });
  const manifest = readJson(join(f.cap, "oats.json"));
  manifest.hooks.spawn = { command: "spawn.mjs", required: true };
  delete manifest.hooks.retire;
  write(join(f.cap, "oats.json"), JSON.stringify(manifest));
  write(join(f.cap, "spawn.mjs"), `import { writeFileSync } from 'node:fs';
writeFileSync(process.env.OATS_INSTANCE_HOME + '/work/authored', 'keep');
console.log(JSON.stringify({meta: {receipt: 'external-state'}}));
process.exitCode = 1;`);
  const home = join(f.root, "worker/instances/worker-missing-cleanup");
  const recovery = join(dirname(home), ".oats-retirement/recovery");
  write(recovery, "blocked");
  assert.throws(() => f.spawn("missing-cleanup"), (e) => e.code === "E_REQUIRED_HOOK_FAILED");
  rmSync(recovery);
  const retired = retireInstance(f.root, "worker-missing-cleanup");
  assert.equal(retired.removedDir, false);
  assert.match(retired.rollbackIncomplete.join("\n"), /declares no retire hook/);
  assert.equal(readFileSync(join(home, "work/authored"), "utf8"), "keep");
  assert.deepEqual(readJson(join(home, ".oats-rollback-incomplete.json")).cleanup.capabilityMeta, { "example.worker": { receipt: "external-state" } });
});
