import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { addSchedule, tickWorkspace, withHostLock } from "../lib/schedule.mjs";
import { inspectInstanceSession, inputInstanceSession } from "../lib/core.mjs";

// Exercise the actual scheduler -> session start -> tmux -> harness stdin
// boundary. All homes, receipts, binaries and the tmux socket are fixtures;
// no model, identity, user's tmux server or host timer is involved.
test("scheduled wakes deliver literal text once and give the next cold home the slot after a runtime stops", async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-schedule-session-")));
  const socket = join(base, "tmux.sock"), ws = join(base, "team");
  const savedEnv = new Map(["OATS_HOME_DIR", "SHELL", "ENV", "BASH_ENV", "OATS_INSTANCE", "OATS_INSTANCE_HOME", "PI_AGENT_INSTANCE", "PI_AGENT_HOME", "PI_AGENTS_ROOT"].map(k => [k, process.env[k]]));
  process.env.OATS_HOME_DIR = join(base, "host");
  process.env.SHELL = "/bin/sh";
  for (const key of ["ENV", "BASH_ENV", "OATS_INSTANCE", "OATS_INSTANCE_HOME", "PI_AGENT_INSTANCE", "PI_AGENT_HOME", "PI_AGENTS_ROOT"]) delete process.env[key];
  const tmux = (...args) => execFileSync("tmux", ["-u", "-S", socket, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const shq = s => `'${s.replace(/'/g, `'\\''`)}'`;
  const waitFor = async (fn, why) => {
    const deadline = Date.now() + 10000;
    while (!fn()) { assert.ok(Date.now() < deadline, why); await new Promise(r => setTimeout(r, 75)); }
  };
  const received = h => existsSync(h.log) ? readFileSync(h.log, "utf8").trim().split("\n").map(line => JSON.parse(line)).join("") : "";
  try {
    const soul = join(ws, "agents", "dev", "soul"); mkdirSync(soul, { recursive: true });
    writeFileSync(join(soul, "soul.yaml"), "name: dev\nwork: worktree\nruntime: claude\n");
    writeFileSync(join(soul, "AGENTS.md"), "# Fixture\n");
    tmux("-f", "/dev/null", "new-session", "-d", "-s", "fixture", "-n", "anchor", "-c", base, "/bin/sh");
    tmux("set-option", "-g", "default-shell", "/bin/sh");
    tmux("set-environment", "-g", "SHELL", "/bin/sh");
    const homes = [];
    for (const id of ["one", "two"]) {
      const instance = `dev-${id}`, home = join(ws, "agents", "dev", "instances", instance);
      mkdirSync(home, { recursive: true });
      const harness = join(base, `fixture-${id}.mjs`), log = join(home, "received.jsonl");
      writeFileSync(harness, `#!${process.execPath}\nimport {appendFileSync} from 'node:fs';
process.stdin.setEncoding('utf8'); let input='';
process.stdin.on('data',data=>{appendFileSync(${JSON.stringify(log)},JSON.stringify(data)+'\\n');input+=data;if(input.includes('STOP-FIXTURE'))process.exit(0);});
setTimeout(()=>process.exit(0),30000);\n`);
      chmodSync(harness, 0o755);
      writeFileSync(join(home, "TASK.md"), "Fixture only\n");
      const command = `OATS_INSTANCE=${shq(instance)} OATS_INSTANCE_HOME=${shq(home)} ${shq(harness)} --dangerously-skip-permissions -- "$(cat TASK.md)"`;
      const target = { session: "fixture", window: instance, socket };
      writeFileSync(join(home, "instance.json"), JSON.stringify({ agent: "dev", instance, home, repo: ws, work: "worktree", runtime: "claude", tmux: target, command, launched: false }));
      // Same isolated receipt fixture as session-start.test.mjs; no receipt
      // for a real home is created or modified.
      const baseline = join(dirname(home), ".oats-retirement", "baselines", createHash("sha256").update(home).digest("hex") + ".json");
      mkdirSync(dirname(baseline), { recursive: true });
      writeFileSync(baseline, JSON.stringify({ version: 2, home, runtime: { launched: false }, homeFingerprint: { files: 3, digest: "fixture" }, disposableReceipts: [], generatedWorkFingerprint: { digest: "fixture" } }));
      const message = `literal ${id}: $(touch NEVER) and \`echo no\``;
      addSchedule(ws, { id, cron: "* * * * *", tz: "UTC", kind: "wake", home, message });
      homes.push({ home, log, message });
    }
    const tick = time => withHostLock(() => tickWorkspace(ws, { now: new Date(time), reg: { maxConcurrent: 1 }, wsList: [ws] }));
    let result = tick("2026-09-07T12:00:00Z");
    assert.equal(result.find(r => r.id === "one").action, "started");
    assert.equal(result.find(r => r.id === "two").action, "skipped", "two cold homes cannot both start under cap one");
    assert.equal(existsSync(homes[1].log), false);
    await waitFor(() => inspectInstanceSession(homes[0].home).state === "unknown", "first dummy runtime becomes active");
    result = tick("2026-09-07T12:00:10Z");
    assert.equal(result.find(r => r.id === "one").action, "delivered");
    await waitFor(() => received(homes[0]).includes("\n"), "wake reaches real stdin");
    const before = received(homes[0]);
    assert.equal(before, homes[0].message + "\n", "shell metacharacters arrive as literal text");
    assert.equal(existsSync(join(homes[0].home, "NEVER")), false);
    result = tick("2026-09-07T12:00:20Z");
    assert.equal(result.some(r => r.id === "one" && r.action === "delivered"), false, "same-minute tick sends no duplicate");
    assert.equal(received(homes[0]), before);
    inputInstanceSession(homes[0].home, "STOP-FIXTURE");
    await waitFor(() => existsSync(join(homes[0].home, ".oats-start-exited")) && inspectInstanceSession(homes[0].home).state === "shell", "dummy exits to fallback shell");
    result = tick("2026-09-07T12:01:00Z");
    assert.equal(result.find(r => r.id === "two").action, "started", "the never-launched home gets the free slot");
    assert.ok(existsSync(homes[0].home), "stopping a runtime does not require deleting its persistent home");
  } finally {
    try { tmux("kill-server"); } catch { /* fixture server already gone */ }
    rmSync(base, { recursive: true, force: true });
    for (const [key, value] of savedEnv) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
