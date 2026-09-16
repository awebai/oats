import test from "node:test";
import assert from "node:assert/strict";
import { capturedSelector } from "../lib/captured-selector.mjs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const id = `sha256-${"a".repeat(64)}`;
test("public malformed captured selectors preserve the JSON error envelope", () => {
  const cli = fileURLToPath(new URL("../bin/oats.mjs", import.meta.url));
  for (const [args, code] of [
    [["inspect", "--deployment", "/nonexistent-captured-test", "--json"], "E_BAD_ARGS"],
    [["inspect", "--deployment", "/nonexistent-captured-test", "--resolution", "invalid", "--json"], "invalid-declaration"],
  ]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
    assert.equal(result.status, 1);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.schemaVersion, 1); assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, code);
    assert.equal(result.stdout.trim(), JSON.stringify(envelope));
    assert.equal(result.stderr, "");
  }
});
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
