import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const lockUrl = new URL("../lib/dir-lock.mjs", import.meta.url).href;

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oats-dir-lock-"));
  const dir = join(root, "registry.lock");
  mkdirSync(dir);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { dir, owner: join(dir, "owner.json") };
}

// Each contender imports the real lock in a separate process. The read seam
// only announces that it encountered the mkdir/owner publication or removal
// window; all lock acquisition, retries and filesystem operations stay real.
function contender(t, dir, retryMs) {
  const script = `
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const dir = ${JSON.stringify(dir)};
const read = fs.readFileSync;
let announced = false;
fs.readFileSync = function (path, ...args) {
  try { return read.call(this, path, ...args); }
  finally {
    if (!announced && path === dir + '/owner.json') {
      announced = true;
      process.send({ event: 'owner-read' });
    }
  }
};
syncBuiltinESMExports();
const { withDirLock } = await import(${JSON.stringify(lockUrl)});
let entered = false;
const start = Date.now();
try {
  const value = withDirLock(dir, 'isolated contender', () => {
    entered = true;
    return 'acquired';
  }, { retryMs: ${retryMs}, busy: (why) => Object.assign(new Error(why), { code: 'E_TEST_BUSY' }) });
  console.log(JSON.stringify({ value, entered, elapsedMs: Date.now() - start }));
} catch (error) {
  console.log(JSON.stringify({ code: error.code, message: error.message, entered, elapsedMs: Date.now() - start }));
}
process.disconnect();
`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let stdout = "", stderr = "", expired = false;
  child.stdout.on("data", (data) => { stdout += data; });
  child.stderr.on("data", (data) => { stderr += data; });
  let observed;
  const ownerRead = new Promise((resolve) => { observed = resolve; });
  child.on("message", (message) => { if (message.event === "owner-read") observed(); });
  const watchdog = setTimeout(() => { expired = true; child.kill("SIGKILL"); }, 4000);
  const closed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => { clearTimeout(watchdog); resolve({ code, signal }); });
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await closed;
  });
  return {
    ownerRead: Promise.race([ownerRead, closed.then(() => { throw new Error(`contender exited before reading owner: ${stderr}`); })]),
    async result() {
      const { code, signal } = await closed;
      assert.equal(expired, false, "contender obeys its retry deadline, without a watchdog kill");
      assert.equal(signal, null, stderr);
      assert.equal(code, 0, stderr);
      return JSON.parse(stdout);
    },
  };
}

for (const window of ["owner publication", "owner removal"]) {
  test(`mkdir lock waits through the ${window} window without stealing`, async (t) => {
    const { dir, owner } = fixture(t);
    const ownerBytes = JSON.stringify({ pid: process.pid, what: "real holder", at: "preserve me" }) + "\n";
    if (window === "owner removal") {
      writeFileSync(owner, ownerBytes);
      rmSync(owner); // Holder has removed owner.json but has not removed its directory yet.
    }
    const child = contender(t, dir, 1500);
    await child.ownerRead;
    if (window === "owner publication") writeFileSync(owner, ownerBytes);
    await delay(120);
    assert.ok(existsSync(dir), "contender must not steal the holder's directory");
    if (window === "owner publication") assert.equal(readFileSync(owner, "utf8"), ownerBytes, "contender must not change or delete the owner record");
    else assert.equal(existsSync(owner), false, "contender must not create an owner record in the holder's directory");
    rmSync(dir, { recursive: true }); // Only the actual holder releases the lock.
    const result = await child.result();
    assert.equal(result.value, "acquired", JSON.stringify(result));
    assert.equal(result.entered, true);
    assert.ok(result.elapsedMs >= 100 && result.elapsedMs < 2500, JSON.stringify(result));
    assert.equal(existsSync(dir), false, "successful contender releases its own lock");
  });
}

for (const state of ["missing", "unreadable", "dead", "live"]) {
  test(`mkdir lock bounds waiting for a persistent ${state} owner without theft`, async (t) => {
    const { dir, owner } = fixture(t);
    let bytes;
    if (state === "unreadable") bytes = "{incomplete owner JSON\n";
    if (state === "live") bytes = JSON.stringify({ pid: process.pid, what: "holder" }) + "\n";
    if (state === "dead") {
      const exited = spawnSync(process.execPath, ["-e", "console.log(process.pid)"], { encoding: "utf8", timeout: 3000 });
      assert.equal(exited.status, 0, exited.stderr);
      const pid = Number(exited.stdout.trim());
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
      bytes = JSON.stringify({ pid, what: "exited holder" }) + "\n";
    }
    if (bytes !== undefined) writeFileSync(owner, bytes);
    const child = contender(t, dir, 180);
    await child.ownerRead;
    const result = await child.result();
    assert.equal(result.code, "E_TEST_BUSY", JSON.stringify(result));
    assert.equal(result.entered, false);
    assert.ok(result.elapsedMs >= 170 && result.elapsedMs < 2000, JSON.stringify(result));
    assert.ok(existsSync(dir), "deadline refusal preserves the held directory");
    if (bytes === undefined) assert.equal(existsSync(owner), false);
    else assert.equal(readFileSync(owner, "utf8"), bytes, "deadline refusal preserves exact owner bytes");
  });
}

test("mkdir lock with no retry refuses immediately without changing an unreadable owner", async (t) => {
  const { dir, owner } = fixture(t);
  const bytes = "partial owner";
  writeFileSync(owner, bytes);
  const child = contender(t, dir, 0);
  await child.ownerRead;
  const result = await child.result();
  assert.equal(result.code, "E_TEST_BUSY");
  assert.equal(result.entered, false);
  assert.ok(result.elapsedMs < 1000, JSON.stringify(result));
  assert.equal(readFileSync(owner, "utf8"), bytes);
});
