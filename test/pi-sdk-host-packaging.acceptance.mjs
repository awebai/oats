// Explicit integrated-tree pack check. Run ONLY after the lifecycle-owned SDK
// host files are present; absence fails, never skips or fabricates a host stub.
// No installed SDK, model, backend, credentials or package install is invoked.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { requireFiles } from "../scripts/check-package-dry-runs.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const entries = ["bin/oats-pi-sdk-host.mjs", "lib/pi-sdk-host.mjs", "lib/captured-pi-host.mjs"];

test("actual kernel npm inventory includes all three SDK host entry files", { timeout: 30_000 }, () => {
  const [pack] = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"],
    { cwd: root, encoding: "utf8", timeout: 25_000, maxBuffer: 8 * 1024 * 1024 }));
  assert.equal(pack.name, "@awebai/oats");
  requireFiles(pack, entries);
  assert.ok(readFileSync(new URL("../bin/oats-pi-sdk-host.mjs", import.meta.url), "utf8").startsWith("#!/usr/bin/env node\n"));
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.exports["./package.json"], "./package.json");
  assert.equal(Object.hasOwn(manifest.bin, "oats-pi-sdk-host"), false, "host is addressed by its retained explicit file");
  // Inventory is not an installed SDK/runtime/root-witness or real-model proof.
  // Parent's installed-artifact and actual retained-execution gates remain required.
});
