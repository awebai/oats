import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { findAgent, OATS_VERSION, runLifecycleHooks, spawnInstance } from "../lib/core.mjs";

const CLI = realpathSync(new URL("../bin/oats.mjs", import.meta.url));
const quote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
function write(path, text) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); }
function fixture(t, { probeCli = false } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-hook-context-")));
  const saved = { ...process.env };
  t.after(() => {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    rmSync(base, { recursive: true, force: true });
  });
  for (const k of Object.keys(process.env)) if (k.startsWith("OATS_") || k.startsWith("PI_AGENT")) delete process.env[k];
  process.env.HOME = join(base, "user"); mkdirSync(process.env.HOME);
  process.env.OATS_HOME_DIR = join(base, "store");
  const fakeBin = join(base, "bin");
  for (const [name, text] of [["oats", "#!/bin/sh\necho POISONED\nexit 99\n"], ["claude", "#!/bin/sh\nexit 0\n"]]) {
    write(join(fakeBin, name), text); chmodSync(join(fakeBin, name), 0o755);
  }
  process.env.PATH = `${fakeBin}:${process.env.PATH}`;
  process.env.OATS_CLI_BIN = join(fakeBin, "oats");
  process.env.OATS_ROOT = join(base, "wrong-agents");
  const hook = join(base, "hook.mjs");
  write(hook, `import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const cli = process.env.OATS_CLI_BIN;
const meta = { cli, root: process.env.OATS_ROOT, home: process.env.OATS_INSTANCE_HOME };
if (${probeCli}) meta.version = JSON.parse(execFileSync(cli, ['version', '--json'], { encoding: 'utf8' }));
writeFileSync(process.env.OATS_INSTANCE_HOME + '/hook-result.json', JSON.stringify(meta));
console.log(JSON.stringify({ meta }));
`);
  return { base, hook };
}
function check(result, root, home) {
  assert.equal(result.cli, CLI);
  assert.equal(result.root, root);
  assert.equal(result.home, home);
  if (result.version) {
    assert.equal(result.version.schemaVersion, 1);
    assert.equal(result.version.name, "@awebai/oats");
    assert.equal(result.version.version, OATS_VERSION);
  }
}

test("direct lifecycle calls author the kernel CLI even with poisoned ambient and extra env, for every event", (t) => {
  const { base, hook } = fixture(t);
  const home = join(base, "hook-home"), root = join(base, "agents"); mkdirSync(home);
  for (const event of ["soul-scaffold", "spawn", "launch", "retire"]) {
    const result = runLifecycleHooks(event, {
      home, instance: "dev-probe", agentName: "dev", rootDir: root, contextDir: base,
      resolved: { capabilities: [{ id: "test.context", hooks: { [event]: `${quote(process.execPath)} ${quote(hook)}` } }] },
      extraEnv: { OATS_CLI_BIN: "/poison/from-extra-env" },
    });
    assert.deepEqual(result.failures, [], JSON.stringify(result.warnings));
    check(result.meta["test.context"], root, home);
  }
});

test("direct core and CLI scaffold spawns supply the known agents root and an executable canonical CLI", (t) => {
  const { base, hook } = fixture(t, { probeCli: true });
  const repo = join(base, "repo"), root = join(repo, "agents"), soul = join(root, "dev", "soul");
  mkdirSync(repo); execFileSync("git", ["init", "-q", repo]);
  write(join(soul, "soul.yaml"), "name: dev\nkind: persistent\nrepo: .\nwork: checkout\nruntime: claude\n");
  write(join(soul, "AGENTS.md"), "# Dev\n"); symlinkSync("AGENTS.md", join(soul, "CLAUDE.md"));
  const cap = join(repo, ".agents", "capabilities", "owned", "context");
  write(join(cap, "hook.mjs"), readFileSync(hook, "utf8"));
  write(join(cap, "oats.json"), JSON.stringify({ capability: "test.context", version: "1.0.0", description: "Lifecycle fixture.", compatibility: { oats: ">=0.6.2" }, hooks: { spawn: "hook.mjs" } }));
  write(join(repo, "oats-config.yaml"), "capabilities:\n  additive:\n    test.context:\n      global: true\n");
  const direct = spawnInstance(root, findAgent(root, "dev"), { purpose: "direct", launch: false });
  check(JSON.parse(readFileSync(join(direct.home, "hook-result.json"))), root, direct.home);
  const child = spawnSync(process.execPath, [CLI, "spawn", "dev", "--dir", repo, "--purpose", "cli", "--no-launch", "--json"], { cwd: repo, env: process.env, encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr + child.stdout);
  const envelope = JSON.parse(child.stdout); assert.equal(envelope.ok, true, JSON.stringify(envelope));
  check(JSON.parse(readFileSync(join(envelope.result.home, "hook-result.json"))), root, envelope.result.home);
});
