// The tick's own record of a run carries its launch's warnings (feature schedule-run-warnings,
// awebai/oats#915 condition 1): a scheduled spawn that is the first to start the OATS tmux server
// from inside a systemd service, with no systemd-run to scope it, says so in its lastRun and history.
// The tick runs in process on the fixture's own tmux server; its spawn is the real `oats spawn`, run
// by a stand-in CLI that plays the creator inside the tick's service. A real spawn child inherits
// the service's cgroup, but the test seams that stand for it are reserved names, which the tick
// strips from its children's environment (childEnv), so the stand-in sets them on the spawn itself.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { oatsSocket } from "./helpers/host-fixture.mjs";
import { serverScopeWarning } from "../lib/tmux-server-scope.mjs";

const S = await import("../lib/schedule.mjs");
const TICK = "0::/user.slice/user-1000.slice/user@1000.service/app.slice/oats-schedule-tick.service\n";
const answer = (r) => { assert.equal(r.status, 0, r.stdout + r.stderr); return r.json().result; };
/** A server-scope warning, whatever its unit and reason: other warnings may name the server too
 *  (a folder-trust warning names where its file comes from). */
const SCOPE = serverScopeWarning({ unit: "\0", reason: "\0" }).split("\0")[0];
const isScopeWarning = (w) => w.startsWith(SCOPE);
/** The real CLI, run as a process inside `cgroup` whose system directories are `dirs`. */
function inService(fx, dirs) {
  const bin = join(fx.base, "in-service-oats.mjs"), real = fileURLToPath(new URL("../bin/oats.mjs", import.meta.url));
  writeFileSync(bin, `import { spawnSync } from "node:child_process";\nconst r = spawnSync(process.execPath, [${JSON.stringify(real)}, ...process.argv.slice(2)], { stdio: "inherit", env: { ...process.env, OATS_TEST_CGROUP: ${JSON.stringify(TICK)}, OATS_TEST_SYSTEM_TOOL_DIRS: ${JSON.stringify(dirs)} } });\nprocess.exit(r.status ?? 1);\n`);
  return bin;
}

test("a scheduled spawn that starts the server unscoped inside a service records the warning; one that does not, records none", async (t) => {
  const fx = v2Deployment({ t });
  const socket = oatsSocket(fx.env.TMUX_TMPDIR);
  fx.beforeCleanup(() => { try { execFileSync("tmux", ["-S", socket, "kill-server"], { stdio: "ignore" }); } catch { /* none */ } });
  await fx.prepare("dev");
  const empty = join(fx.base, "no-systemd-run"); mkdirSync(empty, { recursive: true });
  const io = { oatsBin: inService(fx, empty) };
  const spec = { kind: "spawn", cron: "* * * * *", tz: "UTC", agent: "dev", harness: "claude", task: "fixture task" };
  answer(fx.cli(["schedule", "add", "nightly", `--spec-json=${JSON.stringify(spec)}`, "--json"]));
  // The fixture's PATH (its inert harnesses), never this test runner's: a host's own claude must not decide the launch.
  // The tick launches through a child, its `oats spawn`: what that launch says is on the child's
  // stderr and goes to the run's record, and the tick writes nothing on this process's own stderr.
  // The test holds stderr around the tick to say so.
  const tick = () => fx.inEnv(() => {
    const path = process.env.PATH, write = process.stderr.write;
    let written = "", considered;
    process.env.PATH = fx.env.PATH;
    process.stderr.write = (chunk) => { written += String(chunk); return true; };
    try { considered = S.withHostLock(() => S.tickWorkspace(fx.dep, { io, reg: S.readRegistry(), wsList: [fx.dep] })); } finally { process.stderr.write = write; process.env.PATH = path; }
    assert.equal(written, "", "the tick writes nothing on its own stderr: what its launch says is the run's record's");
    return considered;
  });

  const first = await tick();
  assert.equal(first.find((x) => x.id === "nightly")?.action, "launched", JSON.stringify(first));
  const warning = serverScopeWarning({ unit: "oats-schedule-tick.service", reason: `no executable systemd-run in ${empty}` });
  const run = answer(fx.cli(["schedule", "show", "nightly", "--json"])).schedule.lastRun;
  assert.ok(run.warnings?.includes(warning), JSON.stringify(run));
  // The run settles (its home is gone): the history row keeps what that run said.
  rmSync(run.home, { recursive: true, force: true });
  // Another job launched with the server running (the first tick's): it started none and says nothing
  // about one. (A record carries all of its answer's warnings: here the harness's folder-trust one.)
  answer(fx.cli(["schedule", "add", "other", `--spec-json=${JSON.stringify(spec)}`, "--json"]));
  const second = await tick();
  assert.equal(second.find((x) => x.id === "other")?.action, "launched", JSON.stringify(second));
  const settled = answer(fx.cli(["schedule", "show", "nightly", "--json"])).schedule.recentRuns.find((r) => r.home === run.home);
  assert.ok(settled?.warnings?.includes(warning), JSON.stringify(settled));
  const other = answer(fx.cli(["schedule", "show", "other", "--json"])).schedule.lastRun;
  assert.equal(other.outcome, "launched");
  assert.equal((other.warnings ?? []).some(isScopeWarning), false, JSON.stringify(other));
});
