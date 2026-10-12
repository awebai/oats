// A job the host tick launches finds its harness through the unit's PATH alone (awebai/oats#902):
// the unit carries the installer's PATH without its hazards, so a harness installed in a
// `~/.local/bin`-shaped directory of the installer's PATH is what the spawn resolves.
// This is the lookup's fallback, the case where the login environment the OATS tmux server is created
// with cannot be read (the fixture's OATS_TEST_LOGIN_SHELL makes that read fail): otherwise a pane's
// harness is looked up on that login environment's PATH (docs/execution-targets.md).
// The tick is the real CLI, run with the PATH a unit would carry. Everything is the fixture's: its
// HOME, OATS_HOME_DIR, deployment and private tmux server; launchctl/systemctl are the fixture's
// stubs (they are on the installer's PATH too), so no real host timer is read or touched.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLI, v2Deployment } from "./helpers/v2-deployment.mjs";
import { linkExecutables } from "./helpers/host-fixture.mjs";
import { hostUnitPlan, unitPathEntries } from "../lib/schedule-host.mjs";

test("a spawn started by the host tick resolves its harness from a directory of the installer's PATH", async (t) => {
  const fx = v2Deployment({ t });
  await fx.prepare("dev"); // the soul under the deployment's agents/, as a spawn leaves it
  const home = fx.env.HOME;
  // The installer's PATH: the fixture's scheduler stubs, the operator's ~/.local/bin (the harness),
  // an instance's .oats/bin (a hazard the unit drops), and the system tools the kernel runs.
  const localBin = join(home, ".local", "bin"), system = join(fx.base, "system-tools"), instanceBin = join(fx.dep, "agents", "dev", "instances", "dev-x", ".oats", "bin");
  mkdirSync(localBin, { recursive: true }); mkdirSync(instanceBin, { recursive: true });
  const harness = join(localBin, "claude");
  writeFileSync(harness, "#!/bin/sh\nexit 0\n"); chmodSync(harness, 0o755);
  writeFileSync(join(instanceBin, "claude"), "#!/bin/sh\nexit 7\n"); chmodSync(join(instanceBin, "claude"), 0o755);
  linkExecutables(system, ["git", "tmux", "sh", "cat", "env", "ps"]);
  const stubs = fx.env.PATH.split(":").find((p) => p.endsWith("fixture-bin"));
  assert.ok(stubs, "the fixture's launchctl/systemctl stubs");
  const installerPath = [stubs, instanceBin, localBin, system].join(":");
  const plan = hostUnitPlan({ execPath: process.execPath, envPath: installerPath, instanceHome: undefined });
  assert.ok(!plan.path.split(":").includes(instanceBin), "the instance's .oats/bin is not in the unit PATH");
  assert.ok(unitPathEntries(installerPath).includes(localBin));

  const spec = { kind: "spawn", cron: "* * * * *", tz: "UTC", agent: "dev", harness: "claude", task: "fixture task" };
  const added = fx.cli(["schedule", "add", "nightly", `--spec-json=${JSON.stringify(spec)}`, "--json"]);
  assert.equal(added.status, 0, added.stdout + added.stderr);
  mkdirSync(join(fx.env.OATS_HOME_DIR, "schedules"), { recursive: true });
  writeFileSync(join(fx.env.OATS_HOME_DIR, "schedules", "registry.json"), JSON.stringify({ version: 1, capsVersion: 2, tickIntervalSec: 60, workspaces: [fx.dep] }));

  // The unit's environment: its PATH (and OATS_HOME_DIR); the fixture adds only its isolation.
  const env = { ...fx.env, PATH: plan.path };
  const out = execFileSync(plan.node, [CLI, "schedule", "tick", "--host", "--json"], { cwd: "/", env, encoding: "utf8", timeout: 120000 });
  const row = JSON.parse(out.trim().split("\n").pop()).result.considered.find((x) => x.id === "nightly");
  assert.equal(row?.action, "launched", out);
  const instances = join(fx.dep, "agents", "dev", "instances");
  const spawned = readdirSync(instances).filter((name) => name.startsWith("dev-nightly-"));
  assert.equal(spawned.length, 1, `one scheduled instance in ${instances}`);
  const launch = JSON.parse(readFileSync(join(instances, spawned[0], "instance.json"), "utf8")).launch;
  assert.equal(launch.executable, harness, "the harness the installer's PATH holds");
  assert.equal(launch.executableResolvedFrom, "PATH");
});
