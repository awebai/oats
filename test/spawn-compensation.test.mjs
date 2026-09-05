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

function fixture({ runtime = true, platform = true, taskDirectory = false, retireFailure = false, stubbornWindow = false, launchFailure = false } = {}) {
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
  write(join(root, "dev", "soul", "soul.yaml"), `name: dev\nrepo: ${repo}\nwork: worktree\nruntime: pi\n`);
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
  if (runtime) write(join(bin, "pi"), "#!/bin/sh\nexit 0\n", 0o755);
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
  const run = (args) => spawnSync(process.execPath, [CLI, ...args, "--dir", root, "--json"], { env, encoding: "utf8" });
  const spawn = (launch = true) => run(["spawn", "dev", "--purpose", "probe", ...(launch ? [] : ["--no-launch"])]);
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

test.after(() => { for (const dir of directories) rmSync(dir, { recursive: true, force: true }); });
