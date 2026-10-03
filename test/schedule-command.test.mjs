import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runScheduleCommand } from "../lib/schedule-command.mjs";

const options = { timeout: 500, graceMs: 100, maxBuffer: 4096 };
const run = (script, opts = {}) => runScheduleCommand(process.execPath, ["--input-type=module", "-e", script], { ...options, ...opts });

test("the synchronous schedule runner preserves status, output, cwd, environment and literal argv", () => {
  const r = runScheduleCommand(process.execPath, ["-e", 'console.log(JSON.stringify({cwd:process.cwd(), value:process.env.TEST_SCHEDULE_VALUE, args:process.argv.slice(1)})); console.error("error text"); process.exit(7)', "--", "--not-an-option", "literal $(text)"], { ...options, cwd: tmpdir(), env: { ...process.env, TEST_SCHEDULE_VALUE: "exact value" } });
  assert.equal(r.status, 7); assert.equal(r.signal, null); assert.equal(r.error, undefined);
  assert.deepEqual(JSON.parse(r.stdout), { cwd: realpathSync(tmpdir()), value: "exact value", args: ["--not-an-option", "literal $(text)"] });
  assert.equal(r.stderr, "error text\n");
});

test("a failed launch has no observed exit", () => {
  const r = runScheduleCommand("/no/such/oats-test-executable", [], options);
  assert.equal(r.error.code, "ENOENT");
  assert.equal(r.status, null); assert.equal(r.signal, null);
});

test("timeout remains ETIMEDOUT when SIGTERM cleanup exits successfully", () => {
  const r = run('process.on("SIGTERM", () => { console.log("cleaned"); process.exit(0); }); setInterval(() => {}, 100);');
  assert.equal(r.error.code, "ETIMEDOUT"); assert.equal(r.status, 0); assert.equal(r.signal, null);
  assert.equal(r.stdout, "cleaned\n");
});

test("output is bounded and overflow terminates a producer even if it ignores SIGTERM", () => {
  const r = run('process.on("SIGTERM", () => {}); setInterval(() => process.stdout.write("x".repeat(2000)), 5);', { timeout: 3000 });
  assert.equal(r.error.code, "ENOBUFS"); assert.equal(r.signal, "SIGKILL");
  assert.ok(Buffer.byteLength(r.stdout) <= options.maxBuffer);
});

test("a detached descendant retaining stdout cannot prevent the exited command from returning", { skip: process.platform === "win32" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "oats-command-pipe-")), pidFile = join(dir, "pid");
  try {
    const r = run(`import { spawn } from "node:child_process"; import { writeFileSync } from "node:fs";
      const child = spawn(process.execPath, ["-e", 'process.on("SIGTERM",()=>{}); setInterval(()=>{}, 100);'], { detached: true, stdio: ["ignore", "inherit", "inherit"] });
      writeFileSync(${JSON.stringify(pidFile)}, String(child.pid)); child.unref();`, { timeout: 300 });
    assert.equal(r.error.code, "ETIMEDOUT"); assert.equal(r.status, 0); assert.equal(r.signal, null);
  } finally {
    try { process.kill(Number(readFileSync(pidFile, "utf8")), "SIGKILL"); } catch { /* gone */ }
    rmSync(dir, { recursive: true, force: true });
  }
});
