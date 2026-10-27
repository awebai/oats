// Whether the OATS tmux server is started in its own systemd scope (awebai/oats#915, C1): only on
// Linux, only from inside a systemd service or a scope of the user manager, only on the unified cgroup
// hierarchy; and whether each agent's harness is launched in a scope of its own (agentScope).
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { SCOPE_ENV_NAMES, agentScope, agentScopeArgv, agentScopeHost, agentScopeUnit, agentScopeWarning, creatorPlacement, serverScopePlan, serverScopeUnit, serverScopeWarning } from "../lib/tmux-server-scope.mjs";
import { shq } from "../lib/shell-word.mjs";

const TICK = "0::/user.slice/user-1000.slice/user@1000.service/app.slice/oats-schedule-tick.service\n";
const plan = (cgroup, extra = {}) => serverScopePlan({ platform: "linux", cgroup, invocationId: undefined, ...extra });

test("inside a service on the unified hierarchy: wrapped, naming the service", () => {
  assert.deepEqual(plan(TICK), { wrap: true, unit: "oats-schedule-tick.service" });
  assert.deepEqual(plan("0::/system.slice/oats-desktop.service"), { wrap: true, unit: "oats-desktop.service" }, "a system service, no trailing newline: as #915 began");
  assert.deepEqual(plan("0::/user.slice/user-1000.slice/user@1000.service/app.slice/app-oats\\x2ddesktop@x.service\n"), { wrap: true, unit: "app-oats\\x2ddesktop@x.service" });
});

test("inside any scope of the user manager: wrapped, naming the scope", () => {
  const um = "0::/user.slice/user-1000.slice/user@1000.service";
  for (const [cgroup, unit] of [
    [`${um}/app.slice/app-gnome-oats\\x2ddesktop-1234.scope\n`, "app-gnome-oats\\x2ddesktop-1234.scope"], // a client launched from a desktop session
    [`${um}/app.slice/vte-spawn-0f1e2d3c.scope\n`, "vte-spawn-0f1e2d3c.scope"], // a terminal's shell
    [`${um}/app.slice/tmux-spawn-6f1c.scope\n`, "tmux-spawn-6f1c.scope"],
    [`${um}/app.slice/oats-agent-0123456789ab-89abcdef.scope\n`, "oats-agent-0123456789ab-89abcdef.scope"], // an agent that spawns
    [`${um}/app.slice/oats-tmux-0123456789ab-89abcdef.scope\n`, "oats-tmux-0123456789ab-89abcdef.scope"], // a pane of a scoped server
    [`${um}/init.scope\n`, "init.scope"], // the user manager's own scope: a unit of it like any other
  ]) assert.deepEqual(plan(cgroup, { invocationId: "abc" }), { wrap: true, unit }, cgroup);
});

test("a login session's scope, a scope outside the user manager, the root and macOS: not wrapped, nothing to say", () => {
  for (const cgroup of [
    "0::/user.slice/user-1000.slice/session-3.scope\n", // an ssh or tty login: beside the user manager, not in it
    "0::/system.slice/docker-0123.scope\n",
    "0::/oats-fixture.scope\n",
    "0::/user.slice/user@x.service/app.slice/app-a.scope\n", // no uid: no user manager
    "0::/\n",
  ]) assert.deepEqual(plan(cgroup, { invocationId: "abc" }), { wrap: false }, cgroup);
  assert.deepEqual(serverScopePlan({ platform: "darwin", cgroup: TICK, invocationId: "abc" }), { wrap: false });
  assert.deepEqual(serverScopePlan({ platform: "darwin", cgroup: "0::/user.slice/user-1000.slice/user@1000.service/app.slice/app-a.scope\n", invocationId: "abc" }), { wrap: false });
});

test("the old or hybrid hierarchy, or a path that cannot be judged: not wrapped; a warning only for a known service", () => {
  const hybrid = "12:cpu,cpuacct:/user.slice\n1:name=systemd:/user.slice/user-1000.slice/user@1000.service/app.slice/oats-schedule-tick.service\n0::/user.slice/user-1000.slice/user@1000.service/app.slice/oats-schedule-tick.service\n";
  const v1 = "12:cpu,cpuacct:/\n1:name=systemd:/system.slice/oats-desktop.service\n";
  const v1Scope = "12:cpu,cpuacct:/\n1:name=systemd:/user.slice/user-1000.slice/user@1000.service/app.slice/app-a.scope\n";
  for (const cgroup of [hybrid, v1, v1Scope, "0::relative/path.service\n", "0::relative/user@1000.service/a.scope\n", "0::\n"]) {
    assert.deepEqual(plan(cgroup), { wrap: false }, `no INVOCATION_ID: ${JSON.stringify(cgroup)}`);
    const known = plan(cgroup, { invocationId: "0123abcd" });
    assert.equal(known.wrap, false);
    assert.match(known.warn.reason, /unified/);
  }
  assert.equal(plan(hybrid, { invocationId: "x" }).warn.unit, "oats-schedule-tick.service", "the service the systemd hierarchy names");
  assert.equal(plan(v1, { invocationId: "x" }).warn.unit, "oats-desktop.service");
  assert.equal(plan("0::\n", { invocationId: "x" }).warn.unit, "a systemd service");
  assert.equal(plan(v1Scope, { invocationId: "x" }).warn.unit, "a systemd service", "a scope there is named as before: the warning path is #915's");
});

test("an unreadable cgroup: as today, no warning", () => {
  assert.deepEqual(plan(null, { invocationId: "abc" }), { wrap: false });
  assert.deepEqual(plan(undefined), { wrap: false });
});

test("the unit name: one per start, under a prefix that is stable per server address and differs between them", () => {
  const prefix = (unit) => unit.slice(0, "oats-tmux-".length + 12);
  const a = serverScopeUnit({ socket: null, env: { TMUX_TMPDIR: "/tmp/a" } });
  assert.match(a, /^oats-tmux-[0-9a-f]{12}-[0-9a-f]{8}$/);
  const again = serverScopeUnit({ socket: null, env: { TMUX_TMPDIR: "/tmp/a" } });
  assert.notEqual(again, a, "a later start never reuses a scope a server left behind");
  assert.equal(prefix(again), prefix(a));
  assert.notEqual(prefix(serverScopeUnit({ socket: null, env: { TMUX_TMPDIR: "/tmp/b" } })), prefix(a));
  assert.equal(prefix(serverScopeUnit({ socket: null, env: {} })), prefix(serverScopeUnit({ socket: null, env: { TMUX_TMPDIR: "/tmp" } })), "tmux's default directory");
  const s = serverScopeUnit({ socket: "/run/user/1000/tmux-1000/oats", env: { TMUX_TMPDIR: "/tmp/a" } });
  assert.notEqual(prefix(s), prefix(a)); assert.equal(prefix(s), prefix(serverScopeUnit({ socket: "/run/user/1000/tmux-1000/oats", env: {} })), "a known socket is the address");
  assert.notEqual(prefix(serverScopeUnit({ socket: "/x/oats", env: {} })), prefix(s));
});

test("the warning names the unit, the consequence, the fixes and the reason", () => {
  assert.equal(serverScopeWarning({ unit: "oats-schedule-tick.service", reason: "Failed to connect to bus: No medium found" }),
    "the OATS tmux server was started inside oats-schedule-tick.service: it ends when that unit stops; start the OATS tmux server from your own shell, or enable the user systemd bus (Failed to connect to bus: No medium found)");
});

test("a launch configuration cannot set the #915 test seams: reserved, so no launch chooses the systemd-run the kernel runs or where it judges itself", async () => {
  const { validateLaunchConfig, RESERVED_LAUNCH_ENV } = await import("../lib/core.mjs");
  for (const name of ["OATS_TEST_CGROUP", "OATS_TEST_SYSTEM_TOOL_DIRS"]) {
    assert.ok(RESERVED_LAUNCH_ENV.has(name), name);
    assert.throws(() => validateLaunchConfig("seam", { harness: "claude", env: { [name]: "/fixture" } }), (e) => e.code === "E_LAUNCH_CONFIG_INVALID" && e.message.includes(name));
  }
});

// ---- each agent's harness in a scope of its own ------------------------------------------------------

const UNIFIED = "0::/user.slice/user-1000.slice/session-3.scope\n"; // any unified path: the creator's unit does not matter
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "oats-agent-scope-")));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
/** A fake system directory holding `names` (links to /bin/sh: what they are is never run here). */
function tools(name, names = ["systemd-run", "env", "true"]) {
  const dir = join(scratch, name);
  mkdirSync(dir, { recursive: true });
  for (const tool of names) symlinkSync("/bin/sh", join(dir, tool));
  return dir;
}
const SYS = tools("all");
/** A probe that records what it is given and answers `answer`. */
function probe(answer = { ok: true }) {
  const calls = [];
  return { calls, fn: (given) => { calls.push(given); return typeof answer === "function" ? answer(given) : answer; } };
}
const paneOf = (env) => () => ({ env });

test("the agent's host: Linux on the unified hierarchy, whatever unit the creator is in", () => {
  for (const cgroup of [UNIFIED, TICK, "0::/\n", "0::/oats-fixture.scope\n"]) assert.equal(agentScopeHost({ platform: "linux", cgroup }), true, cgroup);
  for (const [platform, cgroup] of [["darwin", TICK], ["linux", null], ["linux", "12:cpu:/\n1:name=systemd:/a.service\n"], ["linux", "1:name=systemd:/a\n0::/a.scope\n"], ["linux", "0::relative\n"]]) assert.equal(agentScopeHost({ platform, cgroup }), false, `${platform} ${cgroup}`);
});

test("the agent's unit name: a prefix per canonical home, a random part per launch", () => {
  const home = join(scratch, "home");
  mkdirSync(home, { recursive: true });
  symlinkSync(home, join(scratch, "home-link"));
  const a = agentScopeUnit({ home });
  assert.match(a, /^oats-agent-[0-9a-f]{12}-[0-9a-f]{8}$/);
  assert.equal(a.slice(11, 23), createHash("sha256").update(home).digest("hex").slice(0, 12), "the first 12 hex of the sha256 of the canonical home path");
  const again = agentScopeUnit({ home });
  assert.notEqual(again, a, "a later launch never reuses a scope's name");
  assert.equal(agentScopeUnit({ home: join(scratch, "home-link") }).slice(0, 23), a.slice(0, 23), "one home, one prefix, whatever its spelling");
  assert.notEqual(agentScopeUnit({ home: join(scratch, "other") }).slice(0, 23), a.slice(0, 23));
});

test("the wrapper's words: the absolute tools, the unit, INVOCATION_ID removed", () => {
  assert.deepEqual(agentScopeArgv({ systemdRun: "/usr/bin/systemd-run", env: "/usr/bin/env" }, "oats-agent-0123456789ab-89abcdef"),
    ["/usr/bin/systemd-run", "--user", "--scope", "--collect", "--quiet", "--unit", "oats-agent-0123456789ab-89abcdef", "--", "/usr/bin/env", "-u", "INVOCATION_ID"]);
});

test("a probe that starts a scope in the pane's environment: wrapped, with the system's tools", () => {
  const p = probe();
  const env = { XDG_RUNTIME_DIR: "/run/user/1000", DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus" };
  assert.deepEqual(agentScope({ io: { platform: "linux", cgroup: UNIFIED, systemToolDirs: [SYS], scopeProbe: p.fn }, paneEnv: paneOf(env) }),
    { wrapper: { systemdRun: join(SYS, "systemd-run"), env: join(SYS, "env") } });
  assert.deepEqual(p.calls, [{ systemdRun: join(SYS, "systemd-run"), trueFile: join(SYS, "true"), env }], "the probe runs with the pane's values, and only those");
});

test("off Linux, on another hierarchy, or with a test's io that brings no probe: no scope and nothing said", () => {
  const p = probe();
  let read = 0;
  const paneEnv = () => { read++; return { env: {} }; };
  for (const io of [
    { platform: "darwin", cgroup: TICK, systemToolDirs: [SYS], scopeProbe: p.fn },
    { platform: "linux", cgroup: "12:cpu:/\n1:name=systemd:/user.slice/a.scope\n", systemToolDirs: [SYS], scopeProbe: p.fn },
    { platform: "linux", cgroup: null, systemToolDirs: [SYS], scopeProbe: p.fn },
    { platform: "linux", cgroup: UNIFIED, systemToolDirs: [SYS] },
  ]) assert.deepEqual(agentScope({ io, paneEnv }), {}, JSON.stringify(io));
  assert.equal(p.calls.length, 0, "no probe"); assert.equal(read, 0, "the pane's environment is not read");
});

test("a missing tool, an unreadable pane or a failed probe: unwrapped, with one warning naming why", () => {
  const io = (extra) => ({ platform: "linux", cgroup: UNIFIED, systemToolDirs: [SYS], ...extra });
  for (const missing of ["systemd-run", "env", "true"]) {
    const dir = tools(`without-${missing}`, ["systemd-run", "env", "true"].filter((t) => t !== missing));
    const p = probe();
    assert.deepEqual(agentScope({ io: io({ systemToolDirs: [dir], scopeProbe: p.fn }), paneEnv: paneOf({}) }), { warning: agentScopeWarning(`no executable ${missing} in ${dir}`) });
    assert.equal(p.calls.length, 0);
  }
  const p = probe();
  assert.deepEqual(agentScope({ io: io({ scopeProbe: p.fn }), paneEnv: () => ({ reason: "the pane's XDG_RUNTIME_DIR cannot be read (x)" }) }), { warning: agentScopeWarning("the pane's XDG_RUNTIME_DIR cannot be read (x)") });
  assert.equal(p.calls.length, 0, "nothing is probed with an environment that is not the pane's");
  const failed = probe({ reason: "Failed to connect to bus: No medium found" });
  const answer = agentScope({ io: io({ scopeProbe: failed.fn }), paneEnv: paneOf({}) });
  assert.deepEqual(answer, { warning: "the agent's harness runs in the OATS tmux server's cgroup, not a scope of its own: `systemd-run --user --scope` could not start a scope in the pane's environment: Failed to connect to bus: No medium found" });
});

test("the probe's answer is kept per systemd-run and the pane's bus names: a sweep of starts probes once", () => {
  const p = probe(({ env }) => (env.XDG_RUNTIME_DIR ? { ok: true } : { reason: "no bus" }));
  const io = { platform: "linux", cgroup: UNIFIED, systemToolDirs: [SYS], scopeProbe: p.fn };
  const run = { XDG_RUNTIME_DIR: "/run/user/1000" };
  for (let i = 0; i < 5; i++) assert.ok(agentScope({ io, paneEnv: paneOf(run) }).wrapper);
  assert.equal(p.calls.length, 1, "five launches, one probe");
  assert.ok(agentScope({ io, paneEnv: paneOf({}) }).warning);
  assert.ok(agentScope({ io, paneEnv: paneOf({}) }).warning);
  assert.ok(agentScope({ io, paneEnv: paneOf({ ...run, DBUS_SESSION_BUS_ADDRESS: "unix:path=/x" }) }).wrapper);
  assert.equal(p.calls.length, 3, "one more for each other environment");
  const other = tools("other");
  agentScope({ io: { ...io, systemToolDirs: [other] }, paneEnv: paneOf(run) });
  assert.equal(p.calls.length, 4, "and for another systemd-run");
});

// ---- for real: a stand-in harness in a scope of its own, on a private tmux server -----------------------

/** Why this host cannot run the real test, or null: Linux on the unified hierarchy, with a user manager
 *  that starts a scope for this process's environment (the real probe, not a fake). */
function realScopeUnavailable() {
  if (process.env.OATS_TEST_CGROUP !== undefined) return "OATS_TEST_CGROUP is set: this process's placement is a test's";
  if (!agentScopeHost(creatorPlacement())) return `${process.platform} on ${readFileSafe("/proc/self/cgroup") ?? "no readable cgroup"}: not Linux on the unified cgroup hierarchy`;
  if (spawnSync("tmux", ["-V"]).status !== 0) return "no tmux on PATH";
  const env = Object.fromEntries(SCOPE_ENV_NAMES.filter((n) => process.env[n]).map((n) => [n, process.env[n]]));
  const answer = agentScope({ paneEnv: () => ({ env }) });
  return answer.wrapper ? null : answer.warning;
}
function readFileSafe(path) { try { return JSON.stringify(readFileSync(path, "utf8")); } catch { return null; } }

test("for real: the harness runs as the pane's direct child in its own oats-agent scope, and its exit status reaches the pane's shell", async (t) => {
  const unavailable = realScopeUnavailable();
  if (unavailable) { t.diagnostic(`skipped: ${unavailable}`); t.skip(`no user manager to start a scope with: ${unavailable}`); return; }
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-agent-scope-real-")));
  const label = `oats-agent-scope-${process.pid}`;
  const env = { ...process.env, TMUX_TMPDIR: dir, SHELL: "/bin/sh" };
  delete env.TMUX; delete env.TMUX_PANE;
  const tmux = (...args) => execFileSync("tmux", ["-L", label, "-f", "/dev/null", ...args], { env, encoding: "utf8" }).trim();
  t.after(() => { try { tmux("kill-server"); } catch { /* gone */ } rmSync(dir, { recursive: true, force: true }); });
  const { wrapper } = agentScope({ paneEnv: () => ({ env: Object.fromEntries(SCOPE_ENV_NAMES.filter((n) => env[n]).map((n) => [n, env[n]])) }) });
  // The stand-in harness: says its pid, then exits 3 or waits to be ended.
  const harness = join(dir, "harness");
  writeFileSync(harness, `#!/bin/sh\necho $$ > "$1.pid"\n[ "$2" = exit3 ] && exit 3\nexec sleep 600\n`);
  chmodSync(harness, 0o755);
  tmux("new-session", "-d", "-s", "t", "-x", "80", "-y", "24");
  const wait = async (file) => { for (let i = 0; i < 200 && !existsSync(file); i++) await new Promise((r) => setTimeout(r, 50)); return readFileSync(file, "utf8").trim(); };
  /** The pane's command, as nativeRecordCommand renders a wrapped launch (less the shim's PATH prefix). */
  const launch = (name, mode, { scoped = true } = {}) => {
    const run = join(dir, name), unit = agentScopeUnit({ home: dir });
    const inner = `exec ${shq(harness)} ${shq(run)} ${shq(mode)}`;
    const command = `${scoped ? `${agentScopeArgv(wrapper, unit).map(shq).join(" ")} ` : ""}/bin/sh -c ${shq(inner)}; echo $? > ${shq(`${run}.status`)}; exec sleep 600`;
    const panePid = Number(tmux("new-window", "-P", "-F", "#{pane_pid}", "-t", "=t:", "-n", name, command));
    return { run, unit, panePid };
  };
  const ended = launch("ended", "wait");
  const pid = Number(await wait(`${ended.run}.pid`));
  assert.equal(Number(readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1].split(" ")[1]), ended.panePid, "the harness is the pane's direct child");
  assert.match(readFileSync(`/proc/${pid}/cgroup`, "utf8"), new RegExp(`^0::/.*/${ended.unit}\\.scope\\n$`), "in its own scope");
  assert.equal(readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").some((e) => e.startsWith("INVOCATION_ID=")), false, "the scope's INVOCATION_ID is removed");
  // What status reads of the pane is what it reads of an unwrapped launch.
  const plain = launch("plain", "wait", { scoped: false });
  const plainPid = Number(await wait(`${plain.run}.pid`));
  assert.equal(tmux("display-message", "-p", "-t", "=t:=ended", "#{pane_current_command}"), tmux("display-message", "-p", "-t", "=t:=plain", "#{pane_current_command}"), "the pane's current command, as unwrapped");
  assert.doesNotMatch(readFileSync(`/proc/${plainPid}/cgroup`, "utf8"), /oats-agent-/, "premise: the unwrapped one has no scope of its own");
  process.kill(plainPid, "SIGTERM");
  process.kill(pid, "SIGTERM");
  assert.equal(await wait(`${ended.run}.status`), "143", "a TERM'd harness: the pane's shell reads 143");
  const exited = launch("exited", "exit3");
  assert.equal(await wait(`${exited.run}.status`), "3", "the harness's own exit status");
});
