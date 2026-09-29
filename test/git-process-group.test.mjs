import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// A remote that accepts and never answers: the ssh "transport" records its pid and sleeps.
// GIT_SSH_COMMAND must be set before remote.mjs first reads it (it is memoised per process).
const dir = mkdtempSync(join(tmpdir(), "oats-git-group-"));
const pids = join(dir, "pids");
const fakeSsh = join(dir, "ssh");
writeFileSync(fakeSsh, `#!/bin/sh\necho $$ >> "${pids}"\nexec sleep 30\n`);
chmodSync(fakeSsh, 0o755);
process.env.GIT_SSH_COMMAND = fakeSsh;
const { runGit, classifyRemoteFailure, createReadSession, observeRemote } = await import("../lib/remote.mjs");

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (check, ms) => { const end = Date.now() + ms; while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 25)); return check(); };
const started = () => existsSync(pids) ? readFileSync(pids, "utf8").split("\n").filter(Boolean).map(Number) : [];

test.after(() => { for (const pid of started()) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } } rmSync(dir, { recursive: true, force: true }); });

test("a timed-out git takes its ssh with it: no child outlives the timeout", async () => {
  const before = started().length;
  const error = await runGit(["ls-remote", "ssh://example.invalid/r.git"], { timeout: 1500 }).then(() => null, (e) => e);
  assert.ok(error, "the hung remote rejects");
  assert.equal(error.timedOut, true); assert.equal(classifyRemoteFailure(error), "timeout");
  const ssh = started().slice(before);
  assert.equal(ssh.length, 1, "the fake ssh ran");
  assert.equal(await until(() => !alive(ssh[0]), 3000), true, "the ssh child is gone after the timeout");
});

test("an aborted git takes its ssh with it, and the abort rejects at once", async () => {
  const before = started().length;
  const controller = new AbortController();
  const pending = runGit(["ls-remote", "ssh://example.invalid/r.git"], { timeout: 20000, signal: controller.signal }).then(() => null, (e) => e);
  assert.equal(await until(() => started().length > before, 5000), true, "the fake ssh started");
  const t0 = Date.now();
  controller.abort();
  const error = await pending;
  assert.ok(Date.now() - t0 < 1000, "the abort does not wait for the remote");
  assert.equal(error.code, "ABORT_ERR"); assert.equal(error.timedOut, false);
  const ssh = started().slice(before);
  assert.equal(await until(() => !alive(ssh[0]), 3000), true, "the ssh child is gone after the abort");
});

test("a timed-out https read takes its remote helper with it: the connection closes", async () => {
  let closed = false, connected = false;
  const sockets = new Set();
  const server = createServer((socket) => { connected = true; sockets.add(socket); socket.resume(); socket.on("close", () => { closed = true; }); socket.on("error", () => {}); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const { port } = server.address();
    const error = await runGit(["ls-remote", `http://127.0.0.1:${port}/r.git`], { timeout: 1500 }).then(() => null, (e) => e);
    assert.equal(error?.timedOut, true);
    assert.equal(connected, true, "the helper reached the server");
    assert.equal(await until(() => closed, 3000), true, "the helper's connection is closed after the timeout");
  } finally {
    // A regression leaves the helper connected: close its socket so the test fails instead of hanging.
    for (const socket of sockets) socket.destroy();
    server.close();
  }
});

test("closing a read session kills the ssh of a remote read still running for it", async () => {
  const before = started().length;
  const session = createReadSession();
  const pending = observeRemote("ssh://example.invalid/org/r.git", { cacheDir: join(dir, "cache"), session }).then(() => null, (e) => e);
  assert.equal(await until(() => started().length > before, 5000), true, "the fake ssh started");
  await session.close();
  const error = await pending;
  assert.equal(error?.code, "E_REMOTE_UNREADABLE");
  const ssh = started().slice(before);
  assert.equal(await until(() => !alive(ssh[0]), 3000), true, "the ssh child is gone after the close");
});

test("a SIGTERM to the CLI mid-read closes its session: the command exits 143 and no ssh outlives it", async () => {
  const before = started().length;
  const dep = join(dir, "dep"); mkdirSync(dep, { recursive: true });
  writeFileSync(join(dep, "oats-local.yaml"), "schemaVersion: 2\nworkspace: ssh://example.invalid/org/ws.git\n");
  const cli = fileURLToPath(new URL("../bin/oats.mjs", import.meta.url));
  const env = { ...process.env, GIT_SSH_COMMAND: fakeSsh, OATS_REMOTE_CACHE: join(dir, "cli-cache"), HOME: join(dir, "home") };
  const child = spawn(process.execPath, [cli, "souls", "--json"], { cwd: dep, env, stdio: ["ignore", "ignore", "ignore"] });
  let exited = null;
  const done = new Promise((r) => child.on("exit", (code, signal) => { exited = { code, signal }; r(); }));
  try {
    assert.equal(await until(() => started().length > before || exited !== null, 8000) && exited === null, true, "the read reached ssh while the command was running");
    child.kill("SIGTERM");
    await done;
    assert.deepEqual(exited, { code: 143, signal: null }, "the command closes its session and exits 128 + 15");
    const ssh = started().slice(before);
    assert.equal(await until(() => !alive(ssh[0]), 3000), true, "the ssh child is gone with the command");
  } finally {
    if (exited === null) { child.kill("SIGKILL"); await done; }
  }
});

test("an already aborted signal runs no git", async () => {
  const before = started().length;
  const controller = new AbortController(); controller.abort();
  const error = await runGit(["ls-remote", "ssh://example.invalid/r.git"], { signal: controller.signal }).then(() => null, (e) => e);
  assert.equal(error.code, "ABORT_ERR");
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(started().length, before);
});
