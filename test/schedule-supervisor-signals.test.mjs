import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const supervisor = fileURLToPath(new URL("../lib/schedule-command-child.mjs", import.meta.url));
const posix = { skip: process.platform === "win32" };
const graceMs = 200;

function kill(pid, signal = "SIGKILL") {
  if (!Number.isSafeInteger(pid) || pid === 0) return;
  try { process.kill(pid, signal); } catch (error) { if (error.code !== "ESRCH") throw error; }
}
function running(pid) {
  try { process.kill(pid, 0); } catch (error) { if (error.code === "ESRCH") return false; throw error; }
  // A reparented zombie is already dead and cannot retain pipes or execute.
  try { return !/^Z/.test(execFileSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).trim()); }
  catch { return false; }
}
async function until(predicate, message, timeout = 2500) {
  const end = Date.now() + timeout;
  while (!predicate()) {
    assert.ok(Date.now() < end, message);
    await delay(10);
  }
}

function fixture(t, { mode = "graceful", descendant = false, pipes = true, escaped = false, timeout = 3000, preload = "", file, args } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "oats-supervisor-signals-"));
  const actor = join(dir, "actor.mjs"), loader = join(dir, "preload.mjs");
  const path = (name) => join(dir, name);
  const pid = (name) => existsSync(path(`${name}.pid`)) ? Number(readFileSync(path(`${name}.pid`), "utf8")) : null;
  writeFileSync(actor, `
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
const dir = ${JSON.stringify(dir)};
const grandchild = process.argv.includes('descendant');
const name = grandchild ? 'descendant' : 'child';
process.on('SIGTERM', () => {
  appendFileSync(dir + '/' + name + '.terms', 'TERM\\n');
  if (!grandchild && ${JSON.stringify(mode)} === 'graceful') process.exit(0);
});
writeFileSync(dir + '/' + name + '.pid', String(process.pid));
if (!grandchild && ${descendant}) {
  const child = spawn(process.execPath, [${JSON.stringify(actor)}, 'descendant'], {
    detached: ${escaped}, stdio: ${JSON.stringify(pipes ? ["ignore", "inherit", "inherit"] : "ignore")}
  });
  child.unref();
  const ready = setInterval(() => {
    if (existsSync(dir + '/descendant.pid')) {
      clearInterval(ready);
      writeFileSync(dir + '/ready', 'ready');
      if (${escaped}) process.exit(0);
    }
  }, 5);
} else if (!grandchild) writeFileSync(dir + '/ready', 'ready');
setInterval(() => {}, 1000);
`);
  if (preload) writeFileSync(loader, `const fixtureDir = ${JSON.stringify(dir)};\n${preload}`);
  const child = spawn(process.execPath, [...(preload ? ["--import", loader] : []), supervisor], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "", expired = false;
  child.stdout.on("data", (data) => { stdout += data; });
  child.stderr.on("data", (data) => { stderr += data; });
  // A fixture watchdog kills only the supervisor and its recorded owned actors.
  const cleanupActors = () => {
    const leader = pid("child"), other = pid("descendant");
    if (leader) kill(-leader);
    if (other) kill(other);
    if (leader) kill(leader);
  };
  const watchdog = setTimeout(() => { expired = true; cleanupActors(); kill(child.pid); }, 5500);
  const closed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => { clearTimeout(watchdog); resolve({ code, signal }); });
  });
  child.stdin.end(JSON.stringify({ file: file ?? process.execPath, args: args ?? [actor], timeout, graceMs, maxBuffer: 4096 }));
  t.after(async () => {
    cleanupActors();
    if (child.exitCode === null && child.signalCode === null) kill(child.pid);
    await closed;
    for (const name of ["child", "descendant"]) {
      const actorPid = pid(name);
      if (actorPid) await until(() => !running(actorPid), `${name} fixture must not leave a live process`);
    }
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    path, pid, signal: (signal) => kill(child.pid, signal),
    ready: () => until(() => existsSync(path("ready")), "actor becomes ready"),
    async result() {
      const receipt = await closed;
      assert.equal(expired, false, "bounded cleanup must finish before the fixture watchdog");
      assert.equal(receipt.signal, null, `supervisor must settle normally: ${stderr}`);
      assert.equal(receipt.code, 0, stderr);
      return JSON.parse(stdout);
    },
    async assertActorsExited() {
      for (const name of ["child", "descendant"]) {
        const actorPid = pid(name);
        if (actorPid) await until(() => !running(actorPid), `${name} must actually exit before cleanup assertions pass`);
      }
    },
  };
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  for (const mode of ["graceful", "ignoring"]) {
    test(`${signal} to the supervisor cleans up ${mode === "graceful" ? "a" : "an"} ${mode} owned child group`, posix, async (t) => {
      const f = fixture(t, { mode, descendant: mode === "ignoring" });
      await f.ready();
      const started = Date.now();
      f.signal(signal);
      const result = await f.result();
      assert.equal(result.error?.code, "EINTR");
      assert.match(result.error.message, new RegExp(signal));
      assert.equal(result.status, mode === "graceful" ? 0 : null);
      assert.equal(result.signal, mode === "graceful" ? null : "SIGKILL");
      assert.ok(Date.now() - started < 2000, "signal cleanup is bounded independently of the command timeout");
      await f.assertActorsExited();
    });
  }
}

test("repeated supervisor signals retain the first cause and do not skip group cleanup", posix, async (t) => {
  const f = fixture(t, { mode: "ignoring", descendant: true });
  await f.ready();
  f.signal("SIGINT");
  await delay(30);
  f.signal("SIGTERM");
  await delay(30);
  f.signal("SIGHUP");
  const result = await f.result();
  assert.equal(result.error?.code, "EINTR");
  assert.match(result.error.message, /SIGINT/);
  assert.equal(result.signal, "SIGKILL");
  for (const name of ["child", "descendant"]) assert.equal(readFileSync(f.path(`${name}.terms`), "utf8"), "TERM\n", "cleanup sends TERM exactly once");
  await f.assertActorsExited();
});

test("supervisor shutdown waits for a pipe-free TERM-ignoring descendant after leader exit", posix, async (t) => {
  const f = fixture(t, { descendant: true, pipes: false });
  await f.ready();
  const started = Date.now();
  f.signal("SIGTERM");
  const result = await f.result();
  assert.equal(result.error?.code, "EINTR");
  assert.equal(result.status, 0);
  assert.equal(result.signal, null);
  assert.ok(Date.now() - started >= graceMs - 30, "direct-child success cannot bypass descendant escalation");
  await f.assertActorsExited();
});

test("a signal during timeout cleanup preserves ETIMEDOUT and completes escalation", posix, async (t) => {
  const f = fixture(t, { mode: "ignoring", descendant: true, timeout: 500 });
  await f.ready();
  await until(() => existsSync(f.path("child.terms")), "timeout starts TERM cleanup");
  f.signal("SIGTERM");
  f.signal("SIGHUP");
  const result = await f.result();
  assert.equal(result.error?.code, "ETIMEDOUT");
  assert.equal(result.signal, "SIGKILL");
  await f.assertActorsExited();
});

test("a signal during spawn assignment still cleans up the newly owned child", posix, async (t) => {
  const f = fixture(t, { preload: `
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { writeFileSync } from 'node:fs';
const spawn = cp.spawn;
cp.spawn = function (...args) {
  const child = spawn(...args);
  writeFileSync(fixtureDir + '/child.pid', String(child.pid));
  process.emit('SIGTERM');
  return child;
};
syncBuiltinESMExports();
` });
  const result = await f.result();
  assert.equal(result.error?.code, "EINTR");
  assert.match(result.error.message, /SIGTERM/);
  assert.ok((result.status === 0 && result.signal === null)
    || (result.status === null && ["SIGTERM", "SIGKILL"].includes(result.signal)), JSON.stringify(result));
  await f.assertActorsExited();
});

test("leader exit probes its empty group immediately and never signals a simulated reused ID", posix, async (t) => {
  const f = fixture(t, { descendant: true, escaped: true, timeout: 700, preload: `
import cp from 'node:child_process';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const spawn = cp.spawn, originalKill = process.kill.bind(process);
let leader, exited = false, observedEmpty = false;
const record = (value) => appendFileSync(fixtureDir + '/probes', JSON.stringify(value) + '\\n');
cp.spawn = function (...args) {
  const child = spawn(...args); leader = child.pid;
  child.once('exit', () => {
    exited = true;
    writeFileSync(fixtureDir + '/leader-exit', 'exited');
    queueMicrotask(() => writeFileSync(fixtureDir + '/after-exit', 'handlers completed'));
  });
  return child;
};
process.kill = function (pid, signal) {
  if (pid !== -leader) return originalKill(pid, signal);
  record({ signal, exited, observedEmpty, duringExit: !existsSync(fixtureDir + '/after-exit') });
  // Once this actual owned group disappears, simulate reuse without sending
  // any real signal or probe to a hypothetical unrelated process group.
  if (observedEmpty) return true;
  try { return originalKill(pid, signal); }
  catch (error) { if (signal === 0 && error.code === 'ESRCH') observedEmpty = true; throw error; }
};
syncBuiltinESMExports();
` });
  await f.ready();
  await until(() => existsSync(f.path("leader-exit")), "direct leader exits while escaped descendant retains the pipes");
  const result = await f.result();
  assert.equal(result.error?.code, "ETIMEDOUT");
  assert.equal(result.status, 0);
  const records = readFileSync(f.path("probes"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(records.length, 1, "observed-empty group is never probed or signalled again");
  assert.equal(records[0].signal, 0);
  assert.equal(records[0].exited, true);
  assert.equal(records[0].duringExit, true, "empty-group observation belongs to the exit handler, before its microtask checkpoint");
  assert.ok(running(f.pid("descendant")), "escaped process is outside the supervisor's owned group; fixture cleanup owns it");
});

test("immediate child exit remains a confirmed observed exit", async (t) => {
  const f = fixture(t, { args: ["-e", "process.exit(7)"] });
  const result = await f.result();
  assert.equal(result.status, 7);
  assert.equal(result.signal, null);
  assert.equal(result.error, undefined);
});

test("pre-spawn launch failure does not invent child exit evidence", async (t) => {
  const f = fixture(t, { file: "/no/such/oats-supervisor-signal-fixture", args: [] });
  const result = await f.result();
  assert.equal(result.error?.code, "ENOENT");
  assert.equal(result.status, null);
  assert.equal(result.signal, null);
});
