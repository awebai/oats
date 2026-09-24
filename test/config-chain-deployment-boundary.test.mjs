// A v2 deployment (a directory holding oats-local.yaml) is a configuration
// boundary: the ancestor walk that composes the legacy oats-config.yaml chain
// must stop there. Found by the Desktop engineer's Phase F study (2026-09-24):
// a scratch deployment created under an operator's workspace reported the
// operator's oats-config.yaml files in `oats inspect` scope.chain and named the
// operator checkout as scope.workspace — configuration leaking across a
// deployment boundary that docs/configuration.md says does not compose.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { configChain } from "../lib/core.mjs";

function layout() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oats-chain-")));
  const operator = join(root, "operator-workspace");
  const scratch = join(operator, "tmp", "scratch-deployment");
  mkdirSync(join(scratch, "agents"), { recursive: true });
  writeFileSync(join(operator, "oats-config.yaml"), "yolo: true\n");
  writeFileSync(join(root, "oats-config.yaml"), "yolo: false\n");
  return { root, operator, scratch };
}

test("configChain stops at a v2 deployment root (oats-local.yaml) and does not read ancestors", () => {
  const { operator, scratch } = layout();
  writeFileSync(join(scratch, "oats-local.yaml"), "workspace: { repository: 'https://example.invalid/acme/workspace.git' }\n");
  writeFileSync(join(scratch, "oats-config.yaml"), "yolo: true\n"); // a legacy file inside the deployment still counts
  const levels = configChain(scratch).map((c) => c._level);
  assert.deepEqual(levels, [scratch], `ancestor configs above the deployment leaked in: ${levels.join(", ")}`);
  assert.ok(!levels.includes(operator));
});

test("configChain stops at the deployment even when the start directory is below it", () => {
  const { operator, scratch } = layout();
  writeFileSync(join(scratch, "oats-local.yaml"), "workspace: { repository: 'https://example.invalid/acme/workspace.git' }\n");
  const home = join(scratch, "agents", "x", "instances", "x-1");
  mkdirSync(home, { recursive: true });
  const levels = configChain(home).map((c) => c._level);
  assert.deepEqual(levels, []);
  assert.ok(!levels.includes(operator));
});

test("without a deployment boundary the legacy chain still composes ancestors (classic deployments unchanged)", () => {
  const { root, operator, scratch } = layout();
  const levels = configChain(scratch).map((c) => c._level);
  assert.deepEqual(levels, [operator, root]);
});
