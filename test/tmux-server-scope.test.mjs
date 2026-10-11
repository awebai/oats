// Whether the OATS tmux server is started in its own systemd scope (awebai/oats#915, C1): only on
// Linux, only from inside a systemd service, only on the unified cgroup hierarchy.
import test from "node:test";
import assert from "node:assert/strict";
import { serverScopePlan, serverScopeUnit, serverScopeWarning } from "../lib/tmux-server-scope.mjs";

const TICK = "0::/user.slice/user-1000.slice/user@1000.service/app.slice/oats-schedule-tick.service\n";
const plan = (cgroup, extra = {}) => serverScopePlan({ platform: "linux", cgroup, invocationId: undefined, ...extra });

test("inside a service on the unified hierarchy: wrapped, naming the service", () => {
  assert.deepEqual(plan(TICK), { wrap: true, unit: "oats-schedule-tick.service" });
  assert.deepEqual(plan("0::/system.slice/oats-desktop.service"), { wrap: true, unit: "oats-desktop.service" }, "no trailing newline");
  assert.deepEqual(plan("0::/user.slice/user-1000.slice/user@1000.service/app.slice/app-oats\\x2ddesktop@x.service\n"), { wrap: true, unit: "app-oats\\x2ddesktop@x.service" });
});

test("a session scope, an agent's pane, the root and macOS: not wrapped, nothing to say", () => {
  for (const cgroup of [
    "0::/user.slice/user-1000.slice/session-3.scope\n",
    "0::/user.slice/user-1000.slice/user@1000.service/app.slice/tmux-spawn-6f1c.scope\n",
    "0::/user.slice/user-1000.slice/user@1000.service/app.slice/oats-tmux-0123456789ab.scope\n",
    "0::/user.slice/user-1000.slice/user@1000.service/init.scope\n",
    "0::/\n",
  ]) assert.deepEqual(plan(cgroup, { invocationId: "abc" }), { wrap: false }, cgroup);
  assert.deepEqual(serverScopePlan({ platform: "darwin", cgroup: TICK, invocationId: "abc" }), { wrap: false });
});

test("the old or hybrid hierarchy, or a path that cannot be judged: not wrapped; a warning only for a known service", () => {
  const hybrid = "12:cpu,cpuacct:/user.slice\n1:name=systemd:/user.slice/user-1000.slice/user@1000.service/app.slice/oats-schedule-tick.service\n0::/user.slice/user-1000.slice/user@1000.service/app.slice/oats-schedule-tick.service\n";
  const v1 = "12:cpu,cpuacct:/\n1:name=systemd:/system.slice/oats-desktop.service\n";
  for (const cgroup of [hybrid, v1, "0::relative/path.service\n", "0::\n"]) {
    assert.deepEqual(plan(cgroup), { wrap: false }, `no INVOCATION_ID: ${JSON.stringify(cgroup)}`);
    const known = plan(cgroup, { invocationId: "0123abcd" });
    assert.equal(known.wrap, false);
    assert.match(known.warn.reason, /unified/);
  }
  assert.equal(plan(hybrid, { invocationId: "x" }).warn.unit, "oats-schedule-tick.service", "the service the systemd hierarchy names");
  assert.equal(plan(v1, { invocationId: "x" }).warn.unit, "oats-desktop.service");
  assert.equal(plan("0::\n", { invocationId: "x" }).warn.unit, "a systemd service");
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
