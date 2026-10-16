// The opening task reaches the transcript exactly once, whenever the
// @awebai/pi welcome turn starts (awebai/oats#469), and on a pi that counts
// a run as active from before its before_agent_start (1.2 and later) the hold
// never waits for the task's own run (awebai/oats#1322). The bridge runs in a
// PiHost (pi-host.mjs), which models pi 0.85.1's prompt() refusal rules and,
// with startsRunFirst, pi 1.3.0's; opening-task-real-pi.test.mjs runs the
// same races in pi itself.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCENARIOS, assertScenario, expected } from "./opening-scenarios.mjs";

const RUNNER = fileURLToPath(new URL("./run-opening-scenario.mjs", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function run(t, scenario, model = "") {
  const home = mkdtempSync(join(tmpdir(), "oats-pi-opening-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  writeFileSync(join(home, "instance.json"), "{}\n");
  const env = { ...process.env, OATS_PKG_ROOT: REPO_ROOT };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", RUNNER, scenario, home, model], { env, encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
  return JSON.parse(r.stdout);
}
for (const scenario of SCENARIOS) test(scenario.title, (t) => assertScenario(run(t, scenario.name), scenario));
for (const scenario of SCENARIOS.filter((s) => !s.beforeAgentSettled)) {
  const want = expected(scenario, true);
  test(`pi 1.2 and later, ${want.title}`, (t) => assertScenario(run(t, scenario.name, "starts-run-first"), want));
}

test("later input is not the opening task: the bridge leaves it to pi", (t) => {
  const result = run(t, "no-race");
  assert.notEqual(result.laterError, null, "the bridge neither held nor took the prompt over");
  assert.deepEqual(result.bridgeSent, []);
});
