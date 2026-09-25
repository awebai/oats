import test from "node:test";
import assert from "node:assert/strict";
import { capturedSelector } from "../lib/captured-selector.mjs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const id = `sha256-${"a".repeat(64)}`;
test("captured selectors are an explicit pair; child arguments and legacy invocations remain distinct", () => {
  assert.equal(capturedSelector(["status"], {}), null);
  assert.deepEqual(capturedSelector(["--deployment=/scope", "demo", "run", "--resolution", id, "--", "--resolution", "child"], {}), {
    deployment: "/scope", resolution: { schemaVersion: 1, id }, args: ["demo", "run", "--", "--resolution", "child"], explicit: true,
  });
  for (const args of [["--deployment", "/scope"], ["--resolution", id], ["--deployment", "/scope", "--deployment", "/other", "--resolution", id], ["--deployment", "relative", "--resolution", id]]) {
    assert.throws(() => capturedSelector(args, {}), { code: "E_BAD_ARGS" });
  }
  assert.equal(capturedSelector(["demo", "run"], { OATS_DEPLOYMENT: "/scope", OATS_RESOLUTION: id }).explicit, false);
});
