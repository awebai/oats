import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { CODEX_TASK_PROMPT } from "../lib/core.mjs";

const CLI = fileURLToPath(new URL("../bin/oats.mjs", import.meta.url));
const directories = [];
const write = (path, text, mode) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, mode ? { mode } : undefined);
};

function fixture({ harness = true, harnessName = "pi", platform = true, taskDirectory = false, retireFailure = false, stubbornWindow = false, launchFailure = false } = {}) {
  const resourceHolder = mkdtempSync(join(tmpdir(), "oats-spawn-compensation-"));
  directories.push(resourceHolder);
  const resource = join(resourceHolder, "external-resource");
  const events = join(resourceHolder, "events");
  const window = join(resourceHolder, "window");
  const tmuxCalls = join(resourceHolder, "tmux-calls.jsonl");
  const bin = join(resourceHolder, "bin");
  mkdirSync(bin);
  // A workspace deployment: soul dev (worktree) with one member capability
  // whose required spawn hook creates an external resource and whose retire
  // hook releases it — the compensation this suite exercises.
  const fx = v2Deployment({
    souls: { dev: { soul: { work: "worktree", capabilities: { "test.messaging": { from: "here" } } }, agents: "# Developer\n" } },
    capabilities: { "test.messaging": {
      manifest: { description: "Compensatable test resource", hooks: { spawn: { command: "spawn.mjs", required: true }, retire: "retire.mjs" } },
      files: {
        "spawn.mjs": `
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(events)}, 'spawn\\n');
writeFileSync(${JSON.stringify(resource)}, 'created');
if (${taskDirectory}) mkdirSync(process.env.OATS_HOME + '/TASK.md');
console.log(JSON.stringify({meta:{alias:'test-resource'}}));
`,
        "retire.mjs": `
import { appendFileSync, rmSync } from 'node:fs';
appendFileSync(${JSON.stringify(events)}, 'retire\\n');
if (JSON.parse(process.env.OATS_META).alias !== 'test-resource') throw new Error('lost spawn receipt');
if (${retireFailure}) { console.log(JSON.stringify({meta:{retired:false,reason:'test failure'}})); }
else { rmSync(${JSON.stringify(resource)}); console.log(JSON.stringify({meta:{retired:true}})); }
`,
      },
    } },
  });
  directories.push(fx.base);
  const { base, dep, root, member: repo } = fx;
  const home = join(root, "dev", "instances", "dev-probe");
  const env = Object.fromEntries(Object.entries(fx.env).filter(([key]) => !/^(OATS|PI)_/.test(key) || key === "OATS_REMOTE_CACHE" || key === "OATS_HOME_DIR"));
  // PATH is the fixture's bin directory ONLY. The "missing platform" case
  // relies on tmux being absent from PATH, and a system directory defeats
  // that: on the Ubuntu CI runner /usr/bin (and /bin, which is the same
  // directory there) carries a real tmux, so the spawn that must refuse
  // succeeded and the test failed only in CI. Everything the kernel invokes
  // by name is provided here explicitly: node and git as symlinks to the
  // real binaries, pi and tmux as the stubs the case asks for. Shells and
  // hook interpreters run by absolute path and need no PATH entry.
  Object.assign(env, { PATH: bin, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" });
  delete env.TMUX;
  symlinkSync(process.execPath, join(bin, "node"));
  symlinkSync(execFileSync("which", ["git"], { encoding: "utf8" }).trim(), join(bin, "git"));
  if (harness) write(join(bin, harnessName), "#!/bin/sh\nexit 0\n", 0o755);
  if (platform) write(join(bin, "tmux"), `#!${process.execPath}
const { existsSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const args = process.argv.slice(2);
require('node:fs').appendFileSync(${JSON.stringify(tmuxCalls)}, JSON.stringify(args) + '\\n');
// The kernel addresses a server first: -u, then -L oats (to ensure the session) or -S <socket>.
while (['-u', '-S', '-L'].includes(args[0])) args.splice(0, args[0] === '-u' ? 1 : 2);
const command = args[0];
const state = ${JSON.stringify(window)};
// No session yet (list-sessions prints nothing): the one created answers its socket and first window.
if (command === 'new-session') console.log(${JSON.stringify(join(base, "tmux.sock"))} + '\t@0');
if (command === 'list-windows' && existsSync(state)) console.log(readFileSync(state, 'utf8'));
if (command === 'new-window') {
  writeFileSync(state, args[args.indexOf('-n') + 1]);
  if (${launchFailure}) { console.error('launch failed after creating window'); process.exit(1); }
  console.log('@1');
}
if (command === 'kill-window' && !${stubbornWindow}) rmSync(state, {force:true});
`, 0o755);
  const run = (args) => spawnSync(process.execPath, [CLI, ...args, "--dir", dep, "--json"], { cwd: dep, env, encoding: "utf8" });
  // The harness is a spawn choice (a v2 soul declares none); pi is the default.
  const harnessFlag = harnessName === "pi" ? [] : ["--harness", harnessName];
  const spawn = (launch = true) => run(["spawn", "dev", "--purpose", "probe", ...harnessFlag, ...(launch ? [] : ["--no-launch"])]);
  return { base, dep, repo, root, home, resource, events, window, tmuxCalls, spawn, run, env, harnessFlag };
}

function assertClean(f) {
  assert.equal(existsSync(f.home), false, "failed instance home removed");
  assert.equal(existsSync(f.resource), false, "hook resource compensated");
  assert.equal(existsSync(f.window), false, "harness stopped");
  assert.equal(execFileSync("git", ["-C", f.repo, "branch", "--list", "agents/dev-probe"], { encoding: "utf8", env: f.env }).trim(), "", "failed branch removed");
  assert.equal(execFileSync("git", ["-C", f.repo, "worktree", "list", "--porcelain"], { encoding: "utf8", env: f.env }).includes("dev-probe"), false, "failed worktree deregistered");
}

for (const missing of ["harness", "platform"]) {
  test(`missing ${missing} fails before the home, Git topology, or required hooks exist`, () => {
    const f = fixture({ [missing]: false });
    const result = f.spawn();
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, missing === "harness" ? /pi binary not found/ : /tmux not installed/);
    assert.equal(existsSync(f.events), false, "no hook ran");
    assertClean(f);
  });
}

test("briefing write failure compensates successful required hooks", () => {
  const f = fixture({ taskDirectory: true });
  const result = f.spawn(false);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /spawn rolled back/);
  assert.equal(readFileSync(f.events, "utf8"), "spawn\nretire\n");
  assertClean(f);
});

test("failed platform launch removes a window created before the failure and compensates once", () => {
  const f = fixture({ launchFailure: true });
  const result = f.spawn();
  assert.notEqual(result.status, 0);
  // The backend's own output is withheld from the answer (it can carry the
  // rendered command and reference values); the failure is named generically.
  assert.match(result.stdout, /tmux new-window failed for dev-probe/);
  assert.doesNotMatch(result.stdout, /launch failed after creating window/);
  // The message's hint and the compensation both name the socket this spawn recorded: the one the
  // session's creation answered, never the ambient server.
  const socket = join(f.base, "tmux.sock");
  assert.ok(JSON.parse(result.stdout.trim().split("\n").pop()).error.message.includes(`run tmux -S ${socket} list-windows -t `), result.stdout);
  const calls = readFileSync(f.tmuxCalls, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const launched = calls.findIndex((call) => call.includes("new-window"));
  assert.deepEqual(calls[launched].slice(0, 3), ["-u", "-S", socket]);
  const cleanup = calls.slice(launched + 1);
  assert.deepEqual(cleanup.map((call) => call[3]), ["kill-window", "list-windows"], "the kill, then the probe that verifies it");
  for (const call of cleanup) assert.deepEqual(call.slice(0, 3), ["-u", "-S", socket]);
  assert.match(result.stdout, /spawn rolled back/);
  assert.equal(readFileSync(f.events, "utf8"), "spawn\nretire\n");
  assertClean(f);
});

test("post-hook failure preserves the spawn receipt when compensation cannot finish", () => {
  const f = fixture({ taskDirectory: true, retireFailure: true });
  const result = f.spawn(false);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /rollback INCOMPLETE/);
  assert.equal(existsSync(f.resource), true);
  const marker = JSON.parse(readFileSync(join(f.home, ".oats-rollback-incomplete.json"), "utf8"));
  assert.deepEqual(marker.cleanup.capabilityMeta["test.messaging"], { alias: "test-resource" });
  assert.deepEqual(marker.cleanup.outstanding.hooks, ["test.messaging"]);
});

test("an unquiesced partial launch retains work and credentials for retry", () => {
  const f = fixture({ launchFailure: true, stubbornWindow: true });
  const result = f.spawn();
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /rollback INCOMPLETE/);
  assert.equal(existsSync(f.window), true);
  assert.equal(existsSync(f.resource), true);
  assert.equal(existsSync(join(f.home, "work")), true);
  assert.equal(readFileSync(f.events, "utf8"), "spawn\n", "no credentials removed while harness still runs");
  const marker = JSON.parse(readFileSync(join(f.home, ".oats-rollback-incomplete.json"), "utf8"));
  assert.equal(marker.cleanup.launched, true);
  assert.deepEqual(marker.cleanup.outstanding.git, ["worktree", "branch"]);
});

test("native Codex launch preserves its prompt, configured policy and assigned work directory", () => {
  const f = fixture({ harnessName: "codex" });
  const taskFile = join(f.base, "task.md");
  const prompt = "Read the soul. Literal task: $(touch NEVER_RUN) `touch NEVER_RUN` 'quotes'\nsecond line";
  write(taskFile, prompt);
  symlinkSync("/bin/cat", join(f.env.PATH, "cat"));
  const captured = join(f.base, "argv.json");
  write(join(f.env.PATH, "codex"), `#!${process.execPath}
require('node:fs').writeFileSync(${JSON.stringify(captured)}, JSON.stringify({argv:process.argv.slice(2),cwd:process.cwd(),home:process.env.OATS_INSTANCE_HOME}));
`, 0o755);
  const result = f.run(["spawn", "dev", "--purpose", "probe", ...f.harnessFlag, "--model", "anthropic/claude-test,openai-codex/gpt-test:high", "--task-file", taskFile, "--no-launch"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const meta = JSON.parse(readFileSync(join(f.home, "instance.json"), "utf8"));
  assert.equal(meta.harness, "codex");
  assert.match(readFileSync(join(f.home, "TASK.md"), "utf8"), /Follow the explicit delivery briefing for this instance/);
  assert.equal(meta.model, "gpt-test");
  execFileSync("/bin/sh", ["-c", meta.command], { cwd: f.home, env: f.env });
  const invocation = JSON.parse(readFileSync(captured, "utf8"));
  const args = invocation.argv;
  const toolEnv = [["OATS_INSTANCE", "dev-probe"], ["OATS_INSTANCE_HOME", f.home]]
    .flatMap(([name, value]) => ["-c", `shell_environment_policy.set.${name}=${JSON.stringify(value)}`]);
  assert.deepEqual(args.slice(0, -1), ["--cd", f.home, "-c", "check_for_update_on_startup=false", ...toolEnv, "--model", "gpt-test", "--"]);
  // The task reaches the harness as TASK.md, byte for byte and never evaluated; argv names the file only (#427).
  assert.equal(args.at(-1), CODEX_TASK_PROMPT, "the prompt is the fixed pointer to TASK.md");
  assert.ok(!args.some((a) => a.includes("Literal task")), "the task's text is in no argument");
  assert.ok(readFileSync(join(f.home, "TASK.md"), "utf8").includes(prompt), "TASK.md carries the task's bytes");
  assert.equal(invocation.home, f.home);
  assert.equal(existsSync(join(f.home, "NEVER_RUN")), false);
  assert.ok(readFileSync(join(f.home, "AGENTS.md"), "utf8").includes("Developer"));
  assert.ok(existsSync(join(f.home, ".agents", "skills")));
});

test("unsupported harness fails before provisioning external state", () => {
  const f = fixture();
  const result = f.run(["spawn", "dev", "--purpose", "probe", "--harness", "unsupported", "--no-launch"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /unknown harness/);
  assert.equal(existsSync(f.events), false);
  assertClean(f);
});

test.after(() => { for (const dir of directories) rmSync(dir, { recursive: true, force: true }); });

for (const harnessName of ["codex", "claude", "pi"]) {
  test(`shared yolo maps only permission bypass for ${harnessName}`, () => {
    const f = fixture({ harnessName });
    const result = f.run(["spawn", "dev", "--purpose", "probe", ...f.harnessFlag, "--no-launch", "--yolo"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const meta = JSON.parse(readFileSync(join(f.home, "instance.json"), "utf8"));
    assert.equal(meta.yolo, true);
    assert.equal(meta.command.includes(" --yolo"), harnessName === "codex");
    assert.equal(meta.command.includes(" --dangerously-skip-permissions"), harnessName === "claude");
  });
}
test("contradictory yolo fails before provisioning", () => {
  const f = fixture();
  const result = f.run(["spawn", "dev", "--yolo", "--no-yolo"]);
  assert.notEqual(result.status, 0);
  assert.equal(JSON.parse(result.stdout).error.code, "E_BAD_ARGS");
  assert.match(JSON.parse(result.stdout).error.message, /choose --yolo or --no-yolo/);
  assert.equal(existsSync(f.resource), false);
  assert.equal(existsSync(f.home), false);
});
test("bad spawn flags and the removed local-soul flags fail as argument errors before anything is written", () => {
  const f = fixture();
  const instructions = join(f.base, "instructions.md"); write(instructions, "probe");
  for (const flags of [["--yolo", "--no-yolo"], ["--backend"], ["--instructions-file", instructions], ["--def-file", instructions]]) {
    const r = f.run(["spawn", "dev", "--purpose", "flags", ...flags]);
    assert.notEqual(r.status, 0);
    assert.equal(JSON.parse(r.stdout).error.code, "E_BAD_ARGS", flags.join(" "));
    assert.equal(existsSync(join(f.root, "dev", "instances", "dev-flags")), false);
  }
});
