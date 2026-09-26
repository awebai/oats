import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseConfigData } from "../lib/config-data.mjs";

test("direct main pushes retain the same read-only CI gates as pull requests", () => {
  const workflow = parseConfigData(readFileSync(new URL("../.github/workflows/pull-request.yml", import.meta.url))).value;
  // main and every release/** maintenance branch (release/0.24 → 0.24.x) get the
  // same gate on push and on pull request — the two lists must stay equal.
  assert.deepEqual(workflow.on.push.branches, ["main", "release/**"]);
  assert.deepEqual(workflow.on.pull_request.branches, workflow.on.push.branches);
  assert.equal(workflow.permissions.contents, "read");
  assert.match(workflow.concurrency.group, /github\.event\.pull_request\.number \|\| github\.sha/);
  const steps = workflow.jobs.verify.steps, commands = steps.map((step) => step.run);
  for (const command of ["npm run check", "npm run check:pi", "npm run validate", "npm run validate:okf", "npm run pack:check", "npm run smoke:tarball"]) {
    assert.ok(commands.includes(command), `missing gate: ${command}`);
  }
  // The suite runs sharded: every shard of the matrix runs `npm test -- --test-shard=k/N`,
  // and each shard installs the desktop deps (no Desktop suite silently skipped).
  const tests = workflow.jobs.tests, shards = tests.strategy.matrix.shard;
  const n = shards.length;
  assert.deepEqual(shards, Array.from({ length: n }, (_, i) => i + 1));
  assert.ok(tests.steps.some((step) => step.run === `npm test -- --test-shard=\${{ matrix.shard }}/${n}`), "every shard must run npm test with its shard");
  assert.ok(tests.steps.some((step) => step.run === "npm ci" && step["working-directory"] === "packages/desktop"), "Desktop regressions must not be silently skipped");
  assert.equal(tests.strategy["fail-fast"], false);
  // One stable check name gates on BOTH the shards and the static gates.
  const gate = workflow.jobs.gate;
  assert.equal(gate.name, "Node 22 / test, validate, pack, smoke");
  assert.deepEqual(gate.needs, ["tests", "verify"]);
  assert.equal(gate.if, "always()");
});
