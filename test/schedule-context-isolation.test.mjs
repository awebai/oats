import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { addSchedule, runNow } from "../lib/schedule.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const CLI = realpathSync(new URL("../bin/oats.mjs", import.meta.url));
const IDENTITY = ["OATS_INSTANCE", "OATS_INSTANCE_HOME", "OATS_HOME", "OATS_AGENT", "OATS_SOUL", "OATS_ROOT", "OATS_CONTEXT", "OATS_WORKSPACE", "OATS_EVENT", "OATS_SETTINGS", "OATS_CLI_BIN", "PI_AGENT_INSTANCE", "PI_AGENT_HOME", "PI_AGENTS_ROOT", "OATS_CAPABILITY", "OATS_LAYER", "OATS_LEVEL", "OATS_META", "OATS_OPERATION", "OATS_REPO", "OATS_BRANCH", "OATS_WORK", "OATS_KIND", "OATS_TASK", "OATS_RUNTIME", "OATS_PREVIOUS_RUNTIME", "OATS_RETIRE_INTENT", "OATS_TEAM_NAME", "OATS_TEAM_ID", "OATS_TEAM_SCOPE"];
const CAPTURE_IDENTITY = ["OATS_DEPLOYMENT", "OATS_RESOLUTION"];
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
  // A schedule scope is a deployment: the directory holding oats-local.yaml.
  const ws = join(base, "workspace"); mkdirSync(ws);
  write(join(ws, "oats-local.yaml"), "schemaVersion: 2\nworkspace: example.invalid/acme/workspace\n");
  return { base, ws };
}
function add(ws, id, cwd, argv) { addSchedule(ws, { id, kind: "command", cwd, argv, cron: "* * * * *", tz: "UTC" }); }

test("scheduled child process clears all kernel-authored instance context without dropping host settings", (t) => {
  const { base, ws } = fixture(t);
  const child = join(base, "observe.mjs"), receipt = join(ws, "receipt.json");
  write(child, `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(receipt)}, JSON.stringify({ cwd: process.cwd(), env: process.env, argv: process.argv.slice(2) }));
console.log(JSON.stringify({ schemaVersion: 1, ok: true, result: {} }));`);
  for (const key of [...IDENTITY, ...CAPTURE_IDENTITY]) process.env[key] = `poison-${key}`;
  process.env.TEST_HOST_CREDENTIAL = "kept";
  add(ws, "env", ws, ["oats", "status"]);
  const result = runNow(ws, "env", { io: { oatsBin: child } });
  assert.equal(result.run.outcome, "launched", JSON.stringify(result));
  const observed = JSON.parse(readFileSync(receipt));
  for (const key of [...IDENTITY, ...CAPTURE_IDENTITY]) assert.equal(observed.env[key], undefined, key);
  assert.equal(observed.env.OATS_HOME_DIR, process.env.OATS_HOME_DIR);
  assert.equal(observed.env.HOME, process.env.HOME);
  assert.equal(observed.env.TEST_HOST_CREDENTIAL, "kept");
  assert.equal(observed.cwd, ws);
  assert.deepEqual(observed.argv, ["status", "--json"]);
});

test("direct and CLI scheduler dispatch resolve job cwd and explicit soul, never a caller's frozen home snapshot", (t) => {
  // Two deployments whose member capability test.dispatch answers with its own
  // host setting: the job's (target) and the caller's (other, WRONG). The job
  // runs `oats ctxprobe run --soul worker` in a directory of the target
  // deployment while the invoking process carries the other deployment's home.
  const probe = (value) => {
    const fx = v2Deployment({
      souls: { worker: { soul: { capabilities: { "test.dispatch": { from: "here" } } } } },
      capabilities: { "test.dispatch": { manifest: { description: "Dispatch fixture.", compatibility: { oats: ">=0.6.2" }, command: "ctxprobe", commands: { run: "run.mjs" } },
        files: { "run.mjs": `import { writeFileSync } from 'node:fs';
const result = { provider: ${JSON.stringify(value)}, cwd: process.cwd(), settings: JSON.parse(process.env.OATS_SETTINGS), cli: process.env.OATS_CLI_BIN, inheritedHome: process.env.OATS_HOME || null };
writeFileSync('dispatch.json', JSON.stringify(result));
console.log(JSON.stringify({ schemaVersion: 1, ok: true, result }));` } } },
      local: { settings: { "test.dispatch": { selected: value } } },
    });
    t.after(() => fx.cleanup());
    return fx;
  };
  const target = probe("target"), other = probe("WRONG");
  fixture(t);
  const ws = target.dep, cwd = join(ws, "jobs"); mkdirSync(cwd);
  const caller = join(other.root, "worker", "instances", "worker-caller");
  write(join(caller, "instance.json"), JSON.stringify({ instance: "worker-caller", agent: "worker", repo: other.dep, capabilities: [{ id: "test.dispatch", settings: { selected: "frozen-caller" } }] }));
  for (const key of IDENTITY) process.env[key] = `poison-${key}`;
  process.env.OATS_HOME = caller; process.env.PI_AGENT_HOME = caller;
  process.env.OATS_INSTANCE_HOME = caller; process.env.PI_AGENTS_ROOT = other.root;
  process.env.OATS_REMOTE_CACHE = target.env.OATS_REMOTE_CACHE; process.env.PATH = target.env.PATH;
  for (const id of ["direct", "cli"]) {
    add(ws, id, cwd, ["oats", "ctxprobe", "run", "--soul", "worker"]);
    let result;
    if (id === "direct") result = runNow(ws, id);
    else {
      const r = spawnSync(process.execPath, [CLI, "schedule", "run", id, "--dir", ws, "--json"], { cwd: caller, env: process.env, encoding: "utf8" });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const envelope = JSON.parse(r.stdout); assert.equal(envelope.ok, true, JSON.stringify(envelope)); result = envelope.result;
    }
    assert.equal(result.run.outcome, "launched", JSON.stringify(result));
    assert.deepEqual(JSON.parse(readFileSync(join(cwd, "dispatch.json"))), { provider: "target", cwd, settings: { selected: "target" }, cli: CLI, inheritedHome: null });
    rmSync(join(cwd, "dispatch.json"));
  }
});

