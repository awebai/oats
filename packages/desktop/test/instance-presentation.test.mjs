import test from "node:test";
import assert from "node:assert/strict";
import { runtimeState, retirementSummary } from "../renderer/instance-presentation.mjs";
import { httpError } from "../renderer/views/common.mjs";

test("unreachable and missing runtime state are unknown, distinct from an observed stop", () => {
  assert.equal(runtimeState({ running: null }), "unknown");
  assert.equal(runtimeState({}), "unknown");
  assert.equal(runtimeState({ running: false }), "stopped");
  assert.equal(runtimeState({ running: true }), "running");
});

test("retirement feedback preserves all recovery paths, classes, and incomplete results", () => {
  const result = { server: "build", workRecoveries: [
    { path: "/first", classes: ["tracked work"] },
    { path: "/second", classes: ["changed instance-home bytes"], repoCopy: { copied: false, reason: "Home only" } },
  ] };
  const text = retirementSummary(result);
  for (const value of ["on build", "/first", "/second", "tracked work", "Home only"]) assert.ok(text.includes(value));
  assert.match(retirementSummary({ workRecovery: result.workRecoveries[0] }), /\/first/);
  assert.equal(httpError({ status: 502, body: { error: "Incomplete", result } }, "/retire").result, result);
});
