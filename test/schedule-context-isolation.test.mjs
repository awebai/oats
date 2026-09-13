import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { addSchedule, runNow } from "../lib/schedule.mjs";

const CLI = realpathSync(new URL("../bin/oats.mjs", import.meta.url));
const IDENTITY = ["OATS_INSTANCE", "OATS_INSTANCE_HOME", "OATS_HOME", "OATS_AGENT", "OATS_SOUL", "OATS_ROOT", "OATS_CONTEXT", "OATS_WORKSPACE", "OATS_EVENT", "OATS_SETTINGS", "OATS_CLI_BIN", "PI_AGENT_INSTANCE", "PI_AGENT_HOME", "PI_AGENTS_ROOT", "OATS_CAPABILITY", "OATS_LAYER", "OATS_LEVEL", "OATS_META", "OATS_OPERATION", "OATS_REPO", "OATS_BRANCH", "OATS_WORK", "OATS_KIND", "OATS_TASK", "OATS_RUNTIME", "OATS_PREVIOUS_RUNTIME", "OATS_RETIRE_INTENT", "OATS_TEAM_NAME", "OATS_TEAM_ID", "OATS_TEAM_SCOPE"];
function write(path, text) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); }
function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-schedule-context-")));
  const saved = { ...process.env };
  t.after(() => {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    rmSync(base, { recursive: true, force: true });
  });
  for (const k of Object.keys(process.env)) if (k.startsWith("OATS_") || k.startsWith("PI_AGENT")) delete process.env[k];
  process.env.HOME = join(base, "user"); mkdirSync(process.env.HOME);
  process.env.OATS_HOME_DIR = join(base, "host-store");
  const ws = join(base, "workspace"); mkdirSync(ws);
  write(join(ws, "oats-config.yaml"), "name: test-schedule\n");
  return { base, ws };
}
function add(ws, id, cwd, argv) { addSchedule(ws, { id, kind: "command", cwd, argv, cron: "* * * * *", tz: "UTC" }); }

test("scheduled child process clears all kernel-authored instance context without dropping host settings", (t) => {
  const { base, ws } = fixture(t);
  const child = join(base, "observe.mjs"), receipt = join(ws, "receipt.json");
  write(child, `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(receipt)}, JSON.stringify({ cwd: process.cwd(), env: process.env, argv: process.argv.slice(2) }));
console.log(JSON.stringify({ schemaVersion: 1, ok: true, result: {} }));`);
  for (const key of IDENTITY) process.env[key] = `poison-${key}`;
  process.env.TEST_HOST_CREDENTIAL = "kept";
  add(ws, "env", ws, ["oats", "status"]);
  const result = runNow(ws, "env", { io: { oatsBin: child } });
  assert.equal(result.run.outcome, "launched", JSON.stringify(result));
  const observed = JSON.parse(readFileSync(receipt));
  for (const key of IDENTITY) assert.equal(observed.env[key], undefined, key);
  assert.equal(observed.env.OATS_HOME_DIR, process.env.OATS_HOME_DIR);
  assert.equal(observed.env.HOME, process.env.HOME);
  assert.equal(observed.env.TEST_HOST_CREDENTIAL, "kept");
  assert.equal(observed.cwd, ws);
  assert.deepEqual(observed.argv, ["status", "--json"]);
});

test("direct and CLI scheduler dispatch resolve job cwd and explicit soul, never a caller's frozen home snapshot", (t) => {
  const { base, ws } = fixture(t);
  const target = join(ws, "target"), other = join(ws, "other"), caller = join(other, "agents", "dev", "instances", "dev-caller");
  for (const [dir, value] of [[target, "target"], [other, "WRONG"]]) {
    write(join(dir, "agents", "worker", "soul", "soul.yaml"), "name: worker\n");
    const cap = join(dir, ".agents", "capabilities", "owned", "probe");
    write(join(cap, "oats.json"), JSON.stringify({ capability: "test.dispatch", version: "1.0.0", description: "Dispatch fixture.", compatibility: { oats: ">=0.6.2" }, command: "ctxprobe", commands: { run: "run.mjs" } }));
    write(join(cap, "run.mjs"), `import { writeFileSync } from 'node:fs';
const result = { provider: ${JSON.stringify(value)}, cwd: process.cwd(), settings: JSON.parse(process.env.OATS_SETTINGS), cli: process.env.OATS_CLI_BIN, inheritedHome: process.env.OATS_HOME || null };
writeFileSync('dispatch.json', JSON.stringify(result));
console.log(JSON.stringify({ schemaVersion: 1, ok: true, result }));`);
    write(join(dir, "oats-config.yaml"), `capabilities:\n  additive:\n    test.dispatch:\n      global: false\n      souls:\n        worker:\n          enabled: true\n          settings:\n            selected: ${value}\n`);
  }
  write(join(caller, "instance.json"), JSON.stringify({ instance: "dev-caller", agent: "dev", repo: other, capabilities: [{ id: "test.dispatch", settings: { selected: "frozen-caller" } }] }));
  for (const key of IDENTITY) process.env[key] = `poison-${key}`;
  process.env.OATS_HOME = caller; process.env.PI_AGENT_HOME = caller;
  process.env.OATS_INSTANCE_HOME = caller; process.env.PI_AGENTS_ROOT = join(other, "agents");
  for (const id of ["direct", "cli"]) {
    add(ws, id, target, ["oats", "ctxprobe", "run", "--soul", "worker"]);
    let result;
    if (id === "direct") result = runNow(ws, id);
    else {
      const r = spawnSync(process.execPath, [CLI, "schedule", "run", id, "--dir", ws, "--json"], { cwd: caller, env: process.env, encoding: "utf8" });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const envelope = JSON.parse(r.stdout); assert.equal(envelope.ok, true, JSON.stringify(envelope)); result = envelope.result;
    }
    assert.equal(result.run.outcome, "launched", JSON.stringify(result));
    assert.deepEqual(JSON.parse(readFileSync(join(target, "dispatch.json"))), { provider: "target", cwd: target, settings: { selected: "target" }, cli: CLI, inheritedHome: null });
    rmSync(join(target, "dispatch.json"));
  }
});
