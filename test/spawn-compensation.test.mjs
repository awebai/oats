import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../bin/oats.mjs", import.meta.url));
const directories = [];
const write = (path, text, mode) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, mode ? { mode } : undefined);
};

function fixture({ runtime = true, runtimeName = "pi", backend = "tmux", platform = true, taskDirectory = false, retireFailure = false, stubbornWindow = false, launchFailure = false, allocationFailure = false } = {}) {
  const base = mkdtempSync(join(tmpdir(), "oats-spawn-compensation-"));
  directories.push(base);
  const repo = join(base, "repo");
  const root = join(base, "agents");
  const home = join(root, "dev", "instances", "dev-probe");
  const resource = join(base, "external-resource");
  const events = join(base, "events");
  const window = join(base, "window");
  const bin = join(base, "bin");
  mkdirSync(repo);
  mkdirSync(bin);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(OATS|PI)_/.test(key)));
  // PATH is the fixture's bin directory ONLY. The "missing platform" case
  // relies on tmux being absent from PATH, and a system directory defeats
  // that: on the Ubuntu CI runner /usr/bin (and /bin, which is the same
  // directory there) carries a real tmux, so the spawn that must refuse
  // succeeded and the test failed only in CI. Everything the kernel invokes
  // by name is provided here explicitly: node and git as symlinks to the
  // real binaries, pi and tmux as the stubs the case asks for. Shells and
  // hook interpreters run by absolute path and need no PATH entry.
  Object.assign(env, { HOME: join(base, "home"), PATH: bin, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" });
  mkdirSync(env.HOME);
  delete env.TMUX;
  symlinkSync(process.execPath, join(bin, "node"));
  symlinkSync(execFileSync("which", ["git"], { encoding: "utf8" }).trim(), join(bin, "git"));
  execFileSync("git", ["init", "-q", repo], { env });
  execFileSync("git", ["-C", repo, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-qm", "initial"], { env });
  write(join(root, "dev", "soul", "soul.yaml"), `name: dev\nrepo: ${repo}\nwork: worktree\nruntime: ${runtimeName}\n`);
  write(join(root, "dev", "soul", "AGENTS.md"), "# Developer\n");
  write(join(base, "oats-config.yaml"), "capabilities:\n  layers:\n    knowledge: none\n    messaging:\n      capability: test.messaging\n      from: owned\n    tasks: none\n");
  const cap = join(base, ".agents", "capabilities", "owned", "test-messaging");
  write(join(cap, "oats.json"), JSON.stringify({
    capability: "test.messaging", version: "1.0.0", description: "Compensatable test resource", layer: "messaging",
    hooks: { spawn: { command: "spawn.mjs", required: true }, retire: "retire.mjs" },
  }));
  write(join(cap, "spawn.mjs"), `
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(events)}, 'spawn\\n');
writeFileSync(${JSON.stringify(resource)}, 'created');
if (${taskDirectory}) mkdirSync(process.env.OATS_HOME + '/TASK.md');
console.log(JSON.stringify({meta:{alias:'test-resource'}}));
`);
  write(join(cap, "retire.mjs"), `
import { appendFileSync, rmSync } from 'node:fs';
appendFileSync(${JSON.stringify(events)}, 'retire\\n');
if (JSON.parse(process.env.OATS_META).alias !== 'test-resource') throw new Error('lost spawn receipt');
if (${retireFailure}) { console.log(JSON.stringify({meta:{retired:false,reason:'test failure'}})); }
else { rmSync(${JSON.stringify(resource)}); console.log(JSON.stringify({meta:{retired:true}})); }
`);
  if (runtime) write(join(bin, runtimeName), "#!/bin/sh\nexit 0\n", 0o755);
  if (platform) write(join(bin, "tmux"), `#!${process.execPath}
const { existsSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === '-S') args.splice(0, 2);
const command = args[0];
const state = ${JSON.stringify(window)};
if (command === 'display-message') console.log(${JSON.stringify(join(base, "tmux.sock"))});
if (command === 'list-windows' && existsSync(state)) console.log(readFileSync(state, 'utf8'));
if (command === 'new-window') {
  writeFileSync(state, args[args.indexOf('-n') + 1]);
  if (${launchFailure}) { console.error('launch failed after creating window'); process.exit(1); }
}
if (command === 'kill-window' && !${stubbornWindow}) rmSync(state, {force:true});
`, 0o755);
  if (platform && backend === "herdr") write(join(bin, "herdr"), `#!${process.execPath}
const { existsSync, writeFileSync, rmSync } = require('node:fs');
const args = process.argv.slice(2);
const state = ${JSON.stringify(window)};
const pane = {pane_id:'w1:p1', terminal_id:'term_fixture', workspace_id:'w1'};
if (args[0] === 'api') console.log(JSON.stringify({result:{snapshot:{protocol:20,panes:existsSync(state)?[pane]:[],agents:[]}}}));
if (args[1] === 'process-info') console.log(JSON.stringify({result:{process_info:{foreground_processes:[{name:'codex'}]}}}));
if (args[0] === 'workspace') {
  writeFileSync(state, 'allocated');
  if (${allocationFailure}) { console.error('lost allocation receipt'); process.exit(1); }
  console.log(JSON.stringify({result:{root_pane:pane}}));
}
if (args[1] === 'run' && ${launchFailure}) {console.error('launch failed after creating pane'); process.exit(1);}
if (args[1] === 'close' && !${stubbornWindow}) rmSync(state, {force:true});
`, 0o755);
  const run = (args) => spawnSync(process.execPath, [CLI, ...args, "--dir", root, "--json"], { env, encoding: "utf8" });
  const spawn = (launch = true) => run(["spawn", "dev", "--purpose", "probe", ...(launch ? [] : ["--no-launch"]), ...(backend === "herdr" ? ["--backend", "herdr", "--herdr-socket", join(base, "herdr.sock")] : [])]);
  return { base, repo, root, home, resource, events, window, spawn, run, env };
}

function assertClean(f) {
  assert.equal(existsSync(f.home), false, "failed instance home removed");
  assert.equal(existsSync(f.resource), false, "hook resource compensated");
  assert.equal(existsSync(f.window), false, "runtime stopped");
  assert.equal(execFileSync("git", ["-C", f.repo, "branch", "--list", "agents/dev-probe"], { encoding: "utf8", env: f.env }).trim(), "", "failed branch removed");
  assert.equal(execFileSync("git", ["-C", f.repo, "worktree", "list", "--porcelain"], { encoding: "utf8", env: f.env }).includes("dev-probe"), false, "failed worktree deregistered");
}

for (const missing of ["runtime", "platform"]) {
  test(`missing ${missing} fails before the home, Git topology, or required hooks exist`, () => {
    const f = fixture({ [missing]: false });
    const result = f.spawn();
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, missing === "runtime" ? /pi binary not found/ : /tmux not installed/);
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
  assert.match(result.stdout, /launch failed after creating window/);
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
  assert.equal(readFileSync(f.events, "utf8"), "spawn\n", "no credentials removed while runtime still runs");
  const marker = JSON.parse(readFileSync(join(f.home, ".oats-rollback-incomplete.json"), "utf8"));
  assert.equal(marker.cleanup.launched, true);
  assert.deepEqual(marker.cleanup.outstanding.git, ["worktree", "branch"]);
});

test("native Codex launch preserves its prompt, configured policy and assigned work directory", () => {
  const f = fixture({ runtimeName: "codex" });
  const taskFile = join(f.base, "task.md");
  const prompt = "Read the soul. Literal task: $(touch NEVER_RUN) `touch NEVER_RUN` 'quotes'\nsecond line";
  write(taskFile, prompt);
  symlinkSync("/bin/cat", join(f.env.PATH, "cat"));
  const captured = join(f.base, "argv.json");
  write(join(f.env.PATH, "codex"), `#!${process.execPath}
require('node:fs').writeFileSync(${JSON.stringify(captured)}, JSON.stringify({argv:process.argv.slice(2),cwd:process.cwd(),home:process.env.OATS_INSTANCE_HOME}));
`, 0o755);
  const result = f.run(["spawn", "dev", "--purpose", "probe", "--model", "anthropic/claude-test,openai-codex/gpt-test:high", "--task-file", taskFile, "--no-launch"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const meta = JSON.parse(readFileSync(join(f.home, "instance.json"), "utf8"));
  assert.equal(meta.runtime, "codex");
  assert.match(readFileSync(join(f.home, "TASK.md"), "utf8"), /Follow the explicit delivery briefing for this instance/);
  assert.equal(meta.model, "gpt-test");
  execFileSync("/bin/sh", ["-c", meta.command], { cwd: f.home, env: f.env });
  const invocation = JSON.parse(readFileSync(captured, "utf8"));
  const args = invocation.argv;
  assert.deepEqual(args.slice(0, 5), ["--cd", f.home, "--model", "gpt-test", "--"]);
  assert.equal(args.length, 6, "task is exactly one prompt and no policy is overridden");
  assert.ok(args[5].includes(prompt), "task bytes reach the harness without shell evaluation");
  assert.equal(invocation.home, f.home);
  assert.equal(existsSync(join(f.home, "NEVER_RUN")), false);
  assert.ok(readFileSync(join(f.home, "AGENTS.md"), "utf8").includes("Developer"));
  assert.ok(existsSync(join(f.home, ".agents", "skills")));
});

test("unsupported runtime fails before provisioning external state", () => {
  const f = fixture();
  const result = f.run(["spawn", "dev", "--purpose", "probe", "--runtime", "unsupported", "--no-launch"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /unknown runtime/);
  assert.equal(existsSync(f.events), false);
  assertClean(f);
});

test("Herdr spawn persists a receipt and retirement proves quiescence before releasing identity", () => {
  const f = fixture({ backend: "herdr" });
  const spawned = f.spawn();
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  const meta = JSON.parse(readFileSync(join(f.home, "instance.json"), "utf8"));
  assert.equal(meta.sessionTarget.terminalId, "term_fixture");
  assert.equal(meta.tmux, undefined);
  const retired = f.run(["retire", "dev-probe"]);
  assert.equal(retired.status, 0, retired.stdout + retired.stderr);
  assert.equal(existsSync(f.window), false);
  assert.equal(existsSync(f.resource), false);
  assert.equal(existsSync(f.home), false);
});

test("Herdr spawn compensation keeps credentials when the original terminal cannot be stopped", () => {
  const f = fixture({ backend: "herdr", launchFailure: true, stubbornWindow: true });
  const result = f.spawn();
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /rollback INCOMPLETE/);
  assert.equal(existsSync(f.resource), true);
  const marker = JSON.parse(readFileSync(join(f.home, ".oats-rollback-incomplete.json"), "utf8"));
  assert.equal(marker.cleanup.sessionTarget.terminalId, "term_fixture");
  assert.equal(readFileSync(f.events, "utf8"), "spawn\n");
});

test("Herdr retirement refuses mutable metadata that redirects its endpoint", () => {
  const f = fixture({ backend: "herdr" });
  assert.equal(f.spawn().status, 0);
  const file = join(f.home, "instance.json");
  const meta = JSON.parse(readFileSync(file, "utf8"));
  meta.sessionTarget.terminalId = "term_someone_else";
  writeFileSync(file, JSON.stringify(meta));
  const result = f.run(["retire", "dev-probe"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /disagrees with independent runtime endpoint/);
  assert.equal(existsSync(f.resource), true);
  assert.equal(existsSync(f.window), true);
});

test("Herdr self-retirement completes in the detached child without an operator", async () => {
  const f = fixture({ backend: "herdr" });
  assert.equal(f.spawn().status, 0);
  f.env.OATS_INSTANCE = "dev-probe";
  const result = f.run(["retire", "dev-probe", "--self"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /deferred/);
  assert.equal(existsSync(f.home), true, "caller gets a chance to finish before retirement");
  const deadline = Date.now() + 15000;
  while (existsSync(f.home) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  assert.equal(existsSync(f.home), false, "detached child completed retirement");
  assert.equal(existsSync(f.window), false);
  assert.equal(existsSync(f.resource), false, "identity hook ran after quiescence");
});

test.after(() => { for (const dir of directories) rmSync(dir, { recursive: true, force: true }); });

for (const runtimeName of ["codex", "claude", "pi"]) {
  test(`shared yolo maps only permission bypass for ${runtimeName}`, () => {
    const f = fixture({ runtimeName });
    const result = f.run(["spawn", "dev", "--purpose", "probe", "--no-launch", "--yolo"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const meta = JSON.parse(readFileSync(join(f.home, "instance.json"), "utf8"));
    assert.equal(meta.yolo, true);
    assert.equal(meta.command.includes(" --yolo"), runtimeName === "codex");
    assert.equal(meta.command.includes(" --dangerously-skip-permissions"), runtimeName === "claude");
  });
}
for (const [soul, cli, expected] of [[undefined, [], true], ["false", [], false], ["false", ["--yolo"], true], ["true", ["--no-yolo"], false]]) {
  test(`yolo precedence config=true soul=${soul} cli=${cli}`, () => {
    const f = fixture({ runtimeName: "codex" });
    const cfg = join(f.base, "oats-config.yaml");
    write(cfg, readFileSync(cfg, "utf8") + "yolo: true\n");
    if (soul !== undefined) {
      const path = join(f.root, "dev", "soul", "soul.yaml");
      write(path, readFileSync(path, "utf8") + `yolo: ${soul}\n`);
    }
    const result = f.run(["spawn", "dev", "--purpose", "probe", "--no-launch", ...cli]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const meta = JSON.parse(readFileSync(join(f.home, "instance.json"), "utf8"));
    assert.equal(meta.yolo, expected);
    assert.equal(meta.command.includes(" --yolo"), expected);
  });
}
test("invalid or contradictory yolo fails before provisioning", () => {
  const f = fixture();
  let result = f.run(["spawn", "dev", "--yolo", "--no-yolo"]);
  assert.notEqual(result.status, 0);
  assert.equal(JSON.parse(result.stdout).error.code, "E_BAD_ARGS");
  assert.match(JSON.parse(result.stdout).error.message, /choose --yolo or --no-yolo/);
  assert.equal(existsSync(f.resource), false);
  const cfg = join(f.base, "oats-config.yaml");
  write(cfg, readFileSync(cfg, "utf8") + "yolo: maybe\n");
  result = f.spawn();
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /yolo.*true or false/);
  assert.equal(existsSync(f.home), false);
});
test("session CLI uses original Herdr receipt and rejects metadata drift", () => {
  const f = fixture({ backend: "herdr" });
  assert.equal(f.spawn().status, 0);
  let result = f.run(["session", "inspect", "--home", f.home]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).result.present, true);
  const file = join(f.base, "message.txt");
  write(file, "literal $(touch NO)\nnext line");
  result = f.run(["session", "input", "--home", f.home, "--text-file", file]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).result.submitted, true);
  const path = join(f.home, "instance.json");
  const meta = JSON.parse(readFileSync(path, "utf8"));
  meta.sessionTarget.terminalId = "term_other";
  write(path, JSON.stringify(meta));
  result = f.run(["session", "input", "--home", f.home, "--text-file", file]);
  assert.notEqual(result.status, 0);
  assert.equal(JSON.parse(result.stdout).error.code, "E_RUNTIME_AUTHORITY_MISMATCH");
});

test("create persists both yolo choices in the new soul", () => {
  const f = fixture();
  for (const [name, flag, value] of [["yes", "--yolo", "true"], ["no", "--no-yolo", "false"]]) {
    const r = f.run(["create", name, "--local", "--repo", f.repo, flag]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const soul = JSON.parse(r.stdout).soul;
    assert.match(readFileSync(join(soul, "soul.yaml"), "utf8"), new RegExp(`yolo: ${value}`));
  }
});
test("new spawn flags fail with actionable argument errors before local upsert", () => {
  const f = fixture();
  const instructions = join(f.base, "instructions.md"); write(instructions, "probe");
  for (const flags of [["--yolo", "--no-yolo"], ["--backend"], ["--herdr-socket"]]) {
    const r = f.run(["spawn", "new-local", "--instructions-file", instructions, ...flags]);
    assert.notEqual(r.status, 0);
    assert.equal(JSON.parse(r.stdout).error.code, "E_BAD_ARGS");
    assert.equal(existsSync(join(f.base, "local-agents", "new-local")), false);
  }
});
test("status uses the host Herdr executable, never the mutable metadata binary", () => {
  const f = fixture({ backend: "herdr" }); assert.equal(f.spawn().status, 0);
  const path = join(f.home, "instance.json"), meta = JSON.parse(readFileSync(path, "utf8"));
  const marker = join(f.base, "unexpected-execution");
  const executable = join(f.base, "bad-binary");
  write(executable, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)},'bad');\n`, 0o755);
  meta.sessionTarget.binary = executable; write(path, JSON.stringify(meta));
  const result = f.run(["status"]); assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(existsSync(marker), false);
});
test("lost Herdr allocation receipt reports the potentially remaining empty workspace", () => {
  const f = fixture({ backend: "herdr", allocationFailure: true });
  const result = f.spawn(); assert.notEqual(result.status, 0);
  assert.match(result.stdout, /allocation may have completed/);
  assert.equal(existsSync(f.window), true);
  assert.equal(existsSync(f.resource), false, "harness never launched; external hooks compensated");
  assert.equal(existsSync(f.home), false);
});
