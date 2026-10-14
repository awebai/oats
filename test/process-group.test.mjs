// startGroup and closeGroup (test/helpers/process-group.mjs): closing a process a test started
// waits for what that process started, kills none of it, and fails by name when it does not end;
// and a test process that is interrupted ends the groups it started.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeGroup, startGroup } from "./helpers/process-group.mjs";

const HELPER = new URL("./helpers/process-group.mjs", import.meta.url).href;
const INTERRUPTS = ["SIGINT", "SIGTERM", "SIGHUP"];
/** The program of a process that starts one child, which runs `script`, says so and then stays. */
const leaderOf = (script) => `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(script)}], { stdio: "ignore" });
  process.stdout.write("started\\n"); setInterval(() => {}, 1000);`;
/** The first output of `proc`; rejects if it ends without any. */
const firstOutput = (proc) => new Promise((resolve, reject) => {
  proc.stdout.once("data", (data) => resolve(String(data)));
  proc.once("exit", (code, signal) => reject(new Error(`the process ended before it said anything: ${code ?? signal}`)));
});
/** Kill the group of `proc`, a process started with `startGroup`, whole, and close it. */
async function endGroup(proc) {
  try { process.kill(-proc.pid, "SIGKILL"); } catch { /* the group is gone */ }
  await closeGroup(proc);
}
/** A process started with `startGroup` that has started one child, which runs `script`. Its group is
 *  ended when the test has ended, whatever its outcome. */
async function parentOf(t, script) {
  const proc = startGroup(process.execPath, ["-e", leaderOf(script)], { stdio: ["ignore", "pipe", "inherit"] });
  t.after(() => endGroup(proc));
  await firstOutput(proc);
  return proc;
}
const groupLeft = (pgid) => { try { process.kill(-pgid, 0); return true; } catch { return false; } };
const listening = () => INTERRUPTS.map((signal) => process.listenerCount(signal));

test("closeGroup waits for a child that outlives the process, and does not kill it", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "oats-pg-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const out = join(dir, "late");
  const before = listening();
  const proc = await parentOf(t, `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(out)}, "written"), 500);`);
  assert.deepEqual(listening(), before.map((n) => n + 1), "while a group runs, this process listens for an interrupt");
  await closeGroup(proc);
  assert.equal(proc.signalCode, "SIGTERM", "the process itself was killed");
  assert.equal(existsSync(out) && readFileSync(out, "utf8"), "written", "the child was left to finish, and the wait ended after it");
  assert.equal(groupLeft(proc.pid), false, "nothing of the group is left");
  assert.deepEqual(listening(), before, "and with no group left it listens no more");
});

test("closeGroup fails by name when what the process started does not end in time", async (t) => {
  const proc = await parentOf(t, `/* oats-pg-stays */ setTimeout(() => {}, 60000);`);
  await assert.rejects(closeGroup(proc, { wait: 300 }), (e) => {
    assert.match(e.message, new RegExp(`^the process ${proc.pid} was closed 300 ms ago and its group still runs:`));
    assert.match(e.message, /oats-pg-stays/, "the process that is left is named by its command line");
    assert.equal(e.message.split("\n").length, 2, "and only that one: the process that was killed is gone");
    return true;
  });
});

// The bound is of the whole close, from its start: a process that does not end on its kill is one of
// its group, and is named with what is left of it.
test("closeGroup fails within its bound, naming the process itself, when the process does not end on its kill", { timeout: 10000 }, async (t) => {
  const proc = startGroup(process.execPath, ["-e", `/* oats-pg-leader-stays */ process.on("SIGTERM", () => {}); process.stdout.write("started\\n"); setInterval(() => {}, 1000);`], { stdio: ["ignore", "pipe", "inherit"] });
  t.after(() => endGroup(proc));
  await firstOutput(proc);
  const started = Date.now();
  await assert.rejects(closeGroup(proc, { wait: 300 }), (e) => {
    assert.match(e.message, new RegExp(`^the process ${proc.pid} was closed 300 ms ago and its group still runs:`));
    assert.match(e.message, new RegExp(`^\\s*${proc.pid}\\s+${proc.pid}\\s.*oats-pg-leader-stays`, "m"), "the process itself is named, by its id and command line");
    return true;
  });
  assert.ok(Date.now() - started < 300 + 2000, `closeGroup returned ${Date.now() - started} ms after it started, with a bound of 300 ms`);
  assert.equal(proc.exitCode, null, "the process ignored its kill and still runs");
});

test("closeGroup returns for a process that has already ended and started nothing", async () => {
  const proc = startGroup(process.execPath, ["-e", ""], { stdio: "ignore" });
  await new Promise((r) => proc.once("exit", r));
  await closeGroup(proc);
  assert.equal(proc.exitCode, 0);
});

// A group of its own is not reached by an interrupt of the process that started it: without the
// helper passing it on, the leader and its child would stay.
for (const signal of INTERRUPTS) {
  test(`a process that is interrupted (${signal}) ends the groups it started, and ends as the signal ends it`, async (t) => {
    const worker = `import { startGroup } from ${JSON.stringify(HELPER)};
      const leader = startGroup(process.execPath, ["-e", ${JSON.stringify(leaderOf("setTimeout(() => {}, 60000);"))}], { stdio: ["ignore", "pipe", "inherit"] });
      leader.stdout.once("data", () => process.stdout.write(String(leader.pid)));
      setInterval(() => {}, 1000);`;
    const proc = spawn(process.execPath, ["--input-type=module", "-e", worker], { stdio: ["ignore", "pipe", "inherit"] });
    t.after(() => proc.kill("SIGKILL"));
    const pgid = Number(await firstOutput(proc));
    t.after(() => { try { process.kill(-pgid, "SIGKILL"); } catch { /* the group is gone */ } });
    assert.equal(groupLeft(pgid), true, "the group runs: its leader and the child the leader started");
    const ended = new Promise((resolve) => proc.once("exit", (code, by) => resolve([code, by])));
    proc.kill(signal);
    assert.deepEqual(await ended, [null, signal], "the process ended by the signal, as it does without the helper");
    // The group was killed, not asked: it is gone once the system has collected its processes.
    for (const deadline = Date.now() + 5000; groupLeft(pgid);) {
      assert.ok(Date.now() < deadline, `a process of the group ${pgid} is left 5 s after the interrupt`);
      await new Promise((r) => setTimeout(r, 10));
    }
  });
}
