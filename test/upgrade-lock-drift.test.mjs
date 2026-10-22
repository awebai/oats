import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { packageRepo } from "./helpers/package-repo.mjs";
import { isolateSessionEnvironment, oatsSocket, waitUntil } from "./helpers/host-fixture.mjs";

// Real package copies and sessions, on the isolated server the kernel itself selects.
const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-lock-drift-")));
const restoreEnvironment = isolateSessionEnvironment(base);
const socket = oatsSocket();
const session = "lock-drift";
const tmux = (...args) => execFileSync("tmux", ["-u", "-S", socket, ...args], {
  encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"],
}).trim();
const harness = join(base, "harness");
writeFileSync(harness, '#!/bin/sh\necho $$ > "$OATS_INSTANCE_HOME/pid.txt"\nexec sleep 86400\n');
chmodSync(harness, 0o755);
const pkg = packageRepo();
const fx = v2Deployment({
  workspace: { packages: { "acme.pkg": `${pkg.ref}@v1.0.0` } },
  local: { "launch-configs": { fixture: { harness: "claude", executable: harness } } },
});
fx.env.OATS_TMUX_SESSION = session;
fx.env.PI_AGENTS_TMUX_SESSION = session;
const lockPath = join(fx.dep, "oats-lock.json");
test.after(() => {
  try { tmux("kill-server"); } catch { /* already gone */ }
  try { fx.cleanup(); } finally {
    try { pkg.cleanup(); } finally { restoreEnvironment(); rmSync(base, { recursive: true, force: true }); }
  }
});
const synced = fx.cli(["sync", "--json"]);
assert.equal(synced.status, 0, synced.stdout + synced.stderr);
const validLock = readFileSync(lockPath);
const runningPid = home => {
  try {
    const pid = Number(readFileSync(join(home, "pid.txt"), "utf8").trim());
    if (!Number.isSafeInteger(pid) || pid <= 1) return null;
    process.kill(pid, 0);
    return pid;
  } catch { return null; }
};

for (const invalid of [
  { name: "malformed JSON", key: "malformed", bytes: "{ broken lock", reason: /not valid JSON/ },
  { name: "unsupported lock version", key: "unsupported", bytes: JSON.stringify({ lockfileVersion: 99, packages: { "acme.pkg": { version: "x" } } }), reason: /lockfileVersion 99 is not supported/ },
]) {
  test(`package drift lock read is advisory for ${invalid.name} on start and restart`, async () => {
    const spawned = fx.cli(["spawn", "acme.pkg/keeper", "--name", `drift-${invalid.key}`, "--harness", "claude", "--no-launch", "--launch-config", "fixture", "--json"]);
    assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
    const { home } = JSON.parse(spawned.stdout).result;
    const before = JSON.parse(readFileSync(join(home, "instance.json"), "utf8")).modules;
    try { tmux("has-session", "-t", session); }
    catch { tmux("new-session", "-d", "-s", session, "-n", "hq", "-c", base); }
    writeFileSync(lockPath, invalid.bytes);
    try {
      let priorPid = null;
      for (const verb of ["start", "restart"]) {
        const run = fx.cli(["session", verb, "--home", home, "--json"]);
        assert.equal(run.status, 0, `${verb}: ${run.stdout}\n${run.stderr}`);
        const envelope = JSON.parse(run.stdout);
        assert.equal(envelope.ok, true);
        const result = envelope.result;
        assert.equal(Object.hasOwn(result, "drift"), false, "an unreadable lock cannot certify package drift");
        assert.equal(result.warnings.length, 1, "one advisory lock-read warning per successful start");
        assert.ok(result.warnings[0].includes(lockPath), result.warnings[0]);
        assert.match(result.warnings[0], invalid.reason);
        assert.equal(result.target.socket, socket, "the launched harness belongs to the private fixture server");
        await waitUntil(() => runningPid(home) !== null && runningPid(home) !== priorPid, `${verb} fixture harness ready`);
        priorPid = runningPid(home);
        assert.deepEqual(JSON.parse(readFileSync(join(home, "instance.json"), "utf8")).modules, before, "advisory drift never replaces recorded modules");
      }
    } finally { writeFileSync(lockPath, validLock); }
  });
}
