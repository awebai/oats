// The OATS tmux server's scope warning in the answers (awebai/oats#915, C3, condition 1): `oats spawn`
// and `oats session start`, run for real on the fixture's own tmux server, as a creator inside a
// systemd service (OATS_TEST_CGROUP) whose system directories (OATS_TEST_SYSTEM_TOOL_DIRS) hold no
// systemd-run, or a fake one that runs the command after `--`, as a scope does. And each agent's
// harness in a scope of its own: the pane's command, what is recorded, and the fallback's warning.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { killTmuxServer, oatsSocket, systemExecutable, waitUntil } from "./helpers/host-fixture.mjs";
import { historicalSessionRoots, nativeHistoryPath } from "../packages/record/lib/native-history.mjs";
import { agentScopeUnit, agentScopeWarning, serverScopeWarning } from "../lib/tmux-server-scope.mjs";
import { readEvents } from "../lib/instance-events.mjs";
import { retirementBaselinePath } from "../lib/core.mjs";

const TICK = "0::/user.slice/user-1000.slice/user@1000.service/app.slice/oats-schedule-tick.service\n";

function deployment(t) {
  const fx = v2Deployment({ t });
  const socket = oatsSocket(fx.env.TMUX_TMPDIR);
  const killServer = () => killTmuxServer(socket);
  fx.beforeCleanup(() => { try { execFileSync("tmux", ["-S", socket, "kill-server"], { stdio: "ignore" }); } catch { /* none */ } });
  const sessions = () => { try { return execFileSync("tmux", ["-S", socket, "list-sessions", "-F", "#{session_name}"], { encoding: "utf8" }).split("\n").filter(Boolean); } catch { return []; } };
  return { fx, socket, killServer, sessions };
}
/** A fake system directory with the host's env and true and, unless `body` is null, a systemd-run
 *  running `body`, which first appends its arguments, one call per line, to `calls` (calls(dir)). */
function systemDir(fx, name, body) {
  const dir = join(fx.base, name);
  mkdirSync(dir, { recursive: true });
  for (const tool of ["env", "true"]) symlinkSync(systemExecutable(tool), join(dir, tool));
  if (body !== null) { writeFileSync(join(dir, "systemd-run"), `#!/bin/sh\nprintf '%s\\t' "$@" >> '${join(dir, "calls")}'\necho >> '${join(dir, "calls")}'\n${body}\n`); chmodSync(join(dir, "systemd-run"), 0o755); }
  return dir;
}
/** The calls a fake systemd-run received, each its arguments. */
const calls = (dir) => (existsSync(join(dir, "calls")) ? readFileSync(join(dir, "calls"), "utf8").split("\n").filter(Boolean).map((line) => line.split("\t").slice(0, -1)) : []);
const RUNS_COMMAND = `while [ "$1" != "--" ]; do shift; done; shift\nexec "$@"`;
/** Every native start receipt of a home, by state, once none is pending: each launch prepares one
 *  native start, for the command it dispatches, and that command's recorder marks it started. */
async function nativeStarts(home) {
  const states = () => readdirSync(nativeHistoryPath(home)).filter((n) => n !== "history.json" && n.endsWith(".json")).map((n) => JSON.parse(readFileSync(join(nativeHistoryPath(home), n), "utf8")).state);
  await waitUntil(() => !states().includes("pending"), `the native starts of ${home} recorded: ${JSON.stringify(states())}`);
  assert.doesNotThrow(() => historicalSessionRoots(home), "the home's native history reads");
  return states();
}
/** The command the pane of a spawned home's window was started with, as tmux holds it. */
function paneStartCommand(home) {
  const { tmux } = JSON.parse(readFileSync(join(home, "instance.json"), "utf8"));
  return execFileSync("tmux", ["-S", tmux.socket, "display-message", "-p", "-t", `=${tmux.session}:=${tmux.window}`, "#{pane_start_command}"], { encoding: "utf8" });
}
const answer = (r) => { assert.equal(r.status, 0, r.stdout + r.stderr); return r.json().result; };
/** A server-scope warning, whatever its unit and reason: other warnings may name the server too
 *  (a folder-trust warning names where its file comes from). */
const SCOPE = serverScopeWarning({ unit: "\0", reason: "\0" }).split("\0")[0];
const isScopeWarning = (w) => w.startsWith(SCOPE);
/** The agent-scope warnings of an answer (others, such as folder trust's, are not this test's). */
const agentWarnings = (r) => (r.warnings ?? []).filter((w) => w.startsWith(agentScopeWarning("")));

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
  const dir = systemDir(fx, "scope", RUNS_COMMAND);
  const spawned = answer(fx.cli(["spawn", "dev", "--harness", "claude", "--json"], { env: { OATS_TEST_CGROUP: TICK, OATS_TEST_SYSTEM_TOOL_DIRS: dir } }));
  assert.equal((spawned.warnings ?? []).some(isScopeWarning), false, JSON.stringify(spawned.warnings));
  assert.ok(sessions().length > 0);
  const args = calls(dir).find((call) => call.includes("new-session"));
  assert.deepEqual(args.slice(0, 5), ["--user", "--scope", "--collect", "--quiet", "--unit"]);
  assert.match(args[5], /^oats-tmux-[0-9a-f]{12}-[0-9a-f]{8}$/); assert.deepEqual(args.slice(6, 10), ["--", join(dir, "env"), "-u", "INVOCATION_ID"]);
});

test("a fixture's own kernel never starts the server through systemd-run (its placement is a scope outside the user manager)", (t) => {
  const { fx } = deployment(t);
  const dir = systemDir(fx, "tripwire", "exit 1");
  answer(fx.cli(["spawn", "dev", "--harness", "claude", "--json"], { env: { OATS_TEST_SYSTEM_TOOL_DIRS: dir } }));
  assert.equal(calls(dir).some((call) => call.includes("new-session")), false, JSON.stringify(calls(dir)));
});

// ---- the agent's scope -------------------------------------------------------------------------------

test("the spawn's pane runs the harness under systemd-run --scope, named for its home; nothing recorded carries it", async (t) => {
  const { fx } = deployment(t);
  const dir = systemDir(fx, "agent-scope", RUNS_COMMAND);
  const env = { OATS_TEST_SYSTEM_TOOL_DIRS: dir };
  const preview = answer(fx.cli(["spawn", "dev", "--harness", "claude", "--preview", "--json"], { env }));
  assert.doesNotMatch(JSON.stringify(preview), /systemd-run|oats-agent-/, "a preview does not show it");
  assert.deepEqual(calls(dir), [], "and a preview probes nothing");
  const spawned = answer(fx.cli(["spawn", "dev", "--harness", "claude", "--json"], { env }));
  assert.deepEqual(agentWarnings(spawned), [], "a scope was started: nothing to say");
  assert.deepEqual(calls(dir)[0], ["--user", "--scope", "--collect", "--quiet", "--", join(dir, "true")], "the probe, before the launch");
  const command = paneStartCommand(spawned.home);
  const unit = /'--unit' '(oats-agent-[0-9a-f]{12}-[0-9a-f]{8})'/.exec(command)?.[1];
  assert.ok(unit, command);
  assert.equal(unit.slice(0, 23), agentScopeUnit({ home: spawned.home }).slice(0, 23), "named for the home");
  assert.ok(command.includes(` '${join(dir, "systemd-run")}' '--user' '--scope' '--collect' '--quiet' '--unit' '${unit}' '--' '${join(dir, "env")}' '-u' 'INVOCATION_ID' /bin/sh -c '`), command);
  assert.ok(command.indexOf("/.oats/bin") < command.indexOf("systemd-run"), "after the shim's PATH prefix");
  const meta = JSON.parse(readFileSync(join(spawned.home, "instance.json"), "utf8"));
  assert.doesNotMatch(JSON.stringify({ command: meta.command, launch: meta.launch }), /systemd-run|oats-agent-|INVOCATION_ID/, "the persisted command and recipe never carry it");
  assert.doesNotMatch(readFileSync(retirementBaselinePath(spawned.home), "utf8"), /systemd-run|oats-agent-/, "nor the retirement baseline");
  assert.deepEqual(await nativeStarts(spawned.home), ["started"], "one native start, the dispatched command's");
  // A start of the same home: a scope of its own again, under another name.
  execFileSync("tmux", ["-S", meta.tmux.socket, "kill-window", "-t", `=${meta.tmux.session}:=${meta.tmux.window}`]);
  const started = answer(fx.cli(["session", "start", "--home", spawned.home, "--json"], { env }));
  assert.deepEqual(agentWarnings(started), []);
  const again = /'--unit' '(oats-agent-[0-9a-f]{12}-[0-9a-f]{8})' '--' /.exec(paneStartCommand(spawned.home))?.[1];
  assert.ok(again && again !== unit && again.slice(0, 23) === unit.slice(0, 23), `${unit} then ${again}`);
  const after = JSON.parse(readFileSync(join(spawned.home, "instance.json"), "utf8"));
  assert.doesNotMatch(JSON.stringify({ command: after.command, launch: after.launch, session: after.session }), /systemd-run|oats-agent-|INVOCATION_ID/, "what the start records never carries it");
  assert.deepEqual(await nativeStarts(spawned.home), ["started", "started"], "and one more for the start");
});

test("the probe runs with the bus values the launch's command sets, literal or referenced, over the pane's", async (t) => {
  const fx = v2Deployment({ t, local: { "launch-configs": {
    unreachable: { harness: "claude", env: { DBUS_SESSION_BUS_ADDRESS: "unix:path=/missing-bus" } },
    referenced: { harness: "claude", env: { XDG_RUNTIME_DIR: { fromEnv: "SCOPE_TEST_RUNTIME" } } },
  } } });
  const socket = oatsSocket(fx.env.TMUX_TMPDIR);
  fx.beforeCleanup(() => { try { execFileSync("tmux", ["-S", socket, "kill-server"], { stdio: "ignore" }); } catch { /* none */ } });
  // The probe (its command is the system's true) records what it ran with, and fails on the missing bus.
  const dir = systemDir(fx, "bus", `last=; for a do last=$a; done\nif [ "$last" = '${join(fx.base, "bus", "true")}' ]; then printf '%s|%s\\n' "$DBUS_SESSION_BUS_ADDRESS" "$XDG_RUNTIME_DIR" >> '${join(fx.base, "bus", "probes")}'; [ "$DBUS_SESSION_BUS_ADDRESS" = unix:path=/missing-bus ] && { echo 'Failed to connect to bus: No such file or directory' >&2; exit 1; }; fi\n${RUNS_COMMAND}`);
  const probes = () => readFileSync(join(dir, "probes"), "utf8").split("\n").filter(Boolean);
  const unreachable = answer(fx.cli(["spawn", "dev", "--launch-config", "unreachable", "--json"], { env: { OATS_TEST_SYSTEM_TOOL_DIRS: dir } }));
  assert.equal(probes().at(-1).split("|")[0], "unix:path=/missing-bus", "the configuration's literal value");
  assert.deepEqual(agentWarnings(unreachable), [agentScopeWarning("`systemd-run --user --scope` could not start a scope in the pane's environment: Failed to connect to bus: No such file or directory")]);
  assert.doesNotMatch(paneStartCommand(unreachable.home), /systemd-run/, "so the launch is unwrapped");
  const referenced = answer(fx.cli(["spawn", "dev", "--launch-config", "referenced", "--json"], { env: { OATS_TEST_SYSTEM_TOOL_DIRS: dir, SCOPE_TEST_RUNTIME: "/run/referenced" } }));
  assert.equal(probes().at(-1).split("|")[1], "/run/referenced", "a reference's value, which the pane gets with -e");
  assert.deepEqual(agentWarnings(referenced), []);
  assert.match(paneStartCommand(referenced.home), /systemd-run' '--user' '--scope'/);
  // A start of the same home probes with the same values.
  const meta = JSON.parse(readFileSync(join(unreachable.home, "instance.json"), "utf8"));
  execFileSync("tmux", ["-S", meta.tmux.socket, "kill-window", "-t", `=${meta.tmux.session}:=${meta.tmux.window}`]);
  const started = answer(fx.cli(["session", "start", "--home", unreachable.home, "--json"], { env: { OATS_TEST_SYSTEM_TOOL_DIRS: dir } }));
  assert.equal(probes().at(-1).split("|")[0], "unix:path=/missing-bus");
  assert.equal(agentWarnings(started).length, 1);
  assert.doesNotMatch(paneStartCommand(unreachable.home), /systemd-run/);
});

test("a failed probe: the spawn and the start launch as before, and say once why the harness has no scope", async (t) => {
  const { fx } = deployment(t);
  const dir = systemDir(fx, "no-bus", "echo 'Failed to connect to bus: No medium found' >&2\nexit 1");
  const env = { OATS_TEST_SYSTEM_TOOL_DIRS: dir };
  const warning = agentScopeWarning("`systemd-run --user --scope` could not start a scope in the pane's environment: Failed to connect to bus: No medium found");
  const spawned = answer(fx.cli(["spawn", "dev", "--harness", "claude", "--json"], { env }));
  assert.deepEqual(agentWarnings(spawned), [warning], "said once");
  assert.doesNotMatch(paneStartCommand(spawned.home), /systemd-run|INVOCATION_ID/, "the pane's command is today's");
  assert.equal(calls(dir).length, 1, "the probe alone ran systemd-run");
  const meta = JSON.parse(readFileSync(join(spawned.home, "instance.json"), "utf8"));
  execFileSync("tmux", ["-S", meta.tmux.socket, "kill-window", "-t", `=${meta.tmux.session}:=${meta.tmux.window}`]);
  const started = answer(fx.cli(["session", "start", "--home", spawned.home, "--json"], { env }));
  assert.deepEqual(agentWarnings(started), [warning]);
  assert.doesNotMatch(paneStartCommand(spawned.home), /systemd-run|INVOCATION_ID/);
  assert.deepEqual(readEvents(spawned.home).events.filter((e) => e.kind === "launch-warning" && e.data.message === warning).length, 1, "the start's warning is a launch-warning event");
  // Without systemd-run at all: the same, naming that.
  const none = systemDir(fx, "none", null);
  execFileSync("tmux", ["-S", meta.tmux.socket, "kill-window", "-t", `=${meta.tmux.session}:=${meta.tmux.window}`]);
  const bare = answer(fx.cli(["session", "start", "--home", spawned.home, "--json"], { env: { OATS_TEST_SYSTEM_TOOL_DIRS: none } }));
  assert.deepEqual(agentWarnings(bare), [agentScopeWarning(`no executable systemd-run in ${none}`)]);
});

test("on a cgroup hierarchy other than the unified one: no scope, no probe, nothing said", (t) => {
  const { fx } = deployment(t);
  const dir = systemDir(fx, "v1", RUNS_COMMAND);
  const spawned = answer(fx.cli(["spawn", "dev", "--harness", "claude", "--json"], { env: { OATS_TEST_SYSTEM_TOOL_DIRS: dir, OATS_TEST_CGROUP: "12:cpu,cpuacct:/\n1:name=systemd:/user.slice/user-1000.slice/session-3.scope\n" } }));
  assert.deepEqual(agentWarnings(spawned), []);
  assert.deepEqual(calls(dir), []);
  assert.doesNotMatch(paneStartCommand(spawned.home), /systemd-run/);
});
