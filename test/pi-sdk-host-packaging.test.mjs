import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { requireFiles } from "../scripts/check-package-dry-runs.mjs";

// These are kernel-addressed shipped files, not a new public SDK module API.
const hostFiles = ["bin/oats-pi-sdk-host.mjs", "lib/pi-sdk-host.mjs", "lib/captured-pi-host.mjs", "lib/captured-pi-custody.mjs"];
const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("kernel package exports cover the explicit SDK host without a second CLI or library API", () => {
  assert.ok(manifest.files.includes("bin/"));
  assert.ok(manifest.files.includes("lib/"));
  assert.equal(manifest.bin.oats, "./bin/oats.mjs");
  assert.equal(manifest.exports["./core"], "./lib/core.mjs");
  assert.equal(manifest.exports["./package.json"], "./package.json");
  assert.equal(Object.hasOwn(manifest.bin, "oats-pi-sdk-host"), false, "kernel uses the exact shipped host file");
  assert.equal(Object.hasOwn(manifest.exports, "./pi-sdk-host"), false, "no public internal-host import contract");
});

test("SDK host package inventory refuses any missing host closure entry", () => {
  // Pure inventory-codec negatives, NOT an actual pack or a runtime-host fixture.
  const pack = { name: "@awebai/oats", files: hostFiles.map(path => ({ path })) };
  assert.deepEqual([...requireFiles(pack, hostFiles)], hostFiles);
  for (const missing of hostFiles) {
    assert.throws(() => requireFiles({ ...pack, files: pack.files.filter(row => row.path !== missing) }, hostFiles),
      error => error.message.includes(`missing ${missing}`));
  }
});
