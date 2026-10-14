// The OATS tmux server's scope warning in the answers (awebai/oats#915, C3, condition 1): `oats spawn`
// and `oats session start`, run for real on the fixture's own tmux server, as a creator inside a
// systemd service (OATS_TEST_CGROUP) whose system directories (OATS_TEST_SYSTEM_TOOL_DIRS) hold no
// systemd-run, or a fake one that runs the command after `--`, as a scope does.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { killTmuxServer, oatsSocket, systemExecutable } from "./helpers/host-fixture.mjs";
import { serverScopeWarning } from "../lib/tmux-server-scope.mjs";

const TICK = "0::/user.slice/user-1000.slice/user@1000.service/app.slice/oats-schedule-tick.service\n";

function deployment(t) {
  const fx = v2Deployment({ t });
  const socket = oatsSocket(fx.env.TMUX_TMPDIR);
  const killServer = () => killTmuxServer(socket);
  fx.beforeCleanup(() => { try { execFileSync("tmux", ["-S", socket, "kill-server"], { stdio: "ignore" }); } catch { /* none */ } });
  const sessions = () => { try { return execFileSync("tmux", ["-S", socket, "list-sessions", "-F", "#{session_name}"], { encoding: "utf8" }).split("\n").filter(Boolean); } catch { return []; } };
  return { fx, socket, killServer, sessions };
}
/** A fake system directory with the host's env and, unless `body` is null, a systemd-run running `body`. */
function systemDir(fx, name, body) {
  const dir = join(fx.base, name);
  mkdirSync(dir, { recursive: true });
  symlinkSync(systemExecutable("env"), join(dir, "env"));
  if (body !== null) { writeFileSync(join(dir, "systemd-run"), `#!/bin/sh\nprintf '%s\\n' "$@" > '${join(dir, "args")}'\n${body}\n`); chmodSync(join(dir, "systemd-run"), 0o755); }
  return dir;
}
const answer = (r) => { assert.equal(r.status, 0, r.stdout + r.stderr); return r.json().result; };
/** A server-scope warning, whatever its unit and reason: other warnings may name the server too
 *  (a folder-trust warning names where its file comes from). */
const SCOPE = serverScopeWarning({ unit: "\0", reason: "\0" }).split("\0")[0];
const isScopeWarning = (w) => w.startsWith(SCOPE);

test("without systemd-run, the spawn and the session start that start the server say it lives inside the service", async (t) => {
  const { fx, killServer, sessions } = deployment(t);
  const service = { OATS_TEST_CGROUP: TICK, OATS_TEST_SYSTEM_TOOL_DIRS: systemDir(fx, "no-systemd-run", null) };
  const warning = serverScopeWarning({ unit: "oats-schedule-tick.service", reason: `no executable systemd-run in ${join(fx.base, "no-systemd-run")}` });
  const spawned = answer(fx.cli(["spawn", "dev", "--harness", "claude", "--json"], { env: service }));
  assert.ok(spawned.warnings?.includes(warning), JSON.stringify(spawned.warnings));
  assert.ok(sessions().length > 0, "the server started all the same");
  // The server goes; the session start that starts it again says the same.
  await killServer();
  const started = answer(fx.cli(["session", "start", "--home", spawned.home, "--json"], { env: service }));
  assert.ok(started.warnings?.includes(warning), JSON.stringify(started.warnings));
  // A start that finds the server running starts none, and says nothing.
  execFileSync("tmux", ["-S", oatsSocket(fx.env.TMUX_TMPDIR), "kill-window", "-t", `${started.target.session}:${started.target.window}`]);
  const again = answer(fx.cli(["session", "start", "--home", spawned.home, "--json"], { env: service }));
  assert.equal(again.warnings?.includes(warning) ?? false, false);
});

test("with the system's systemd-run, the spawn starts the server through it and has nothing to say", (t) => {
  const { fx, sessions } = deployment(t);
  const dir = systemDir(fx, "scope", `while [ "$1" != "--" ]; do shift; done; shift\nexec "$@"`);
  const spawned = answer(fx.cli(["spawn", "dev", "--harness", "claude", "--json"], { env: { OATS_TEST_CGROUP: TICK, OATS_TEST_SYSTEM_TOOL_DIRS: dir } }));
  assert.equal((spawned.warnings ?? []).some(isScopeWarning), false, JSON.stringify(spawned.warnings));
  assert.ok(sessions().length > 0);
  const args = readFileSync(join(dir, "args"), "utf8").split("\n");
  assert.deepEqual(args.slice(0, 5), ["--user", "--scope", "--collect", "--quiet", "--unit"]);
  assert.match(args[5], /^oats-tmux-[0-9a-f]{12}-[0-9a-f]{8}$/); assert.deepEqual(args.slice(6, 10), ["--", join(dir, "env"), "-u", "INVOCATION_ID"]);
  assert.ok(args.includes("new-session"));
});

test("a fixture's own kernel never reaches for systemd-run (its placement is a scope)", (t) => {
  const { fx } = deployment(t);
  const dir = systemDir(fx, "tripwire", `echo called > '${join(fx.base, "systemd-run-was-run")}'\nexit 1`);
  answer(fx.cli(["spawn", "dev", "--harness", "claude", "--json"], { env: { OATS_TEST_SYSTEM_TOOL_DIRS: dir } }));
  assert.equal(existsSync(join(fx.base, "systemd-run-was-run")), false);
});
