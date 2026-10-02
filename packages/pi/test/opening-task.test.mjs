// The opening task reaches the transcript exactly once, whenever the
// @awebai/pi welcome turn starts (awebai/oats#469). The bridge runs in a
// PiHost (pi-host.mjs), which models pi 0.85.1's prompt() refusal rules;
// opening-task-real-pi.test.mjs runs the same races in pi itself.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCENARIOS, assertScenario } from "./opening-scenarios.mjs";

const RUNNER = fileURLToPath(new URL("./run-opening-scenario.mjs", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function run(t, scenario) {
  const home = mkdtempSync(join(tmpdir(), "oats-pi-opening-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  writeFileSync(join(home, "instance.json"), "{}\n");
  const env = { ...process.env, OATS_PKG_ROOT: REPO_ROOT };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", RUNNER, scenario, home], { env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
  return JSON.parse(r.stdout);
}
for (const scenario of SCENARIOS) test(scenario.title, (t) => assertScenario(run(t, scenario.name), scenario));

test("later input is not the opening task: the bridge leaves it to pi", (t) => {
  const result = run(t, "no-race");
  assert.notEqual(result.laterError, null, "the bridge neither held nor took the prompt over");
  assert.deepEqual(result.bridgeSent, []);
});
