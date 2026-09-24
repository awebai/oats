import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseConfigData } from "../lib/config-data.mjs";

test("direct main pushes retain the same read-only CI gates as pull requests", () => {
  const workflow = parseConfigData(readFileSync(new URL("../.github/workflows/pull-request.yml", import.meta.url))).value;
  assert.deepEqual(workflow.on.push.branches, ["main", "release/**"]);
  assert.deepEqual(workflow.on.pull_request.branches, workflow.on.push.branches);
  assert.equal(workflow.permissions.contents, "read");
  assert.match(workflow.concurrency.group, /github\.event\.pull_request\.number \|\| github\.ref/);
  const steps = workflow.jobs.verify.steps, commands = steps.map((step) => step.run);
  for (const command of ["npm test", "npm run check", "npm run check:pi", "npm run validate", "npm run validate:okf", "npm run pack:check", "npm run smoke:tarball"]) {
    assert.ok(commands.includes(command), `missing gate: ${command}`);
  }
  assert.ok(steps.some((step) => step.run === "npm ci" && step["working-directory"] === "packages/desktop"), "Desktop regressions must not be silently skipped");
});
