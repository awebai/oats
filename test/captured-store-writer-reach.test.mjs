// The captured path's installed-store writer (lib/captured-store-writer.mjs:
// acquirePackage / updatePackage, the 0.25 package engine's last remainder) is
// reachable from NOTHING but the captured-path test fixtures. This test is the
// proof, and the list (e) deletes together with the captured path.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const WRITER = "captured-store-writer";
// Exactly who may import it, and why: both build the installed store that
// lib/capability-artifacts.mjs verifies. (e) deletes all three files.
const FIXTURE_USERS = ["test/capability-artifacts.test.mjs", "test/captured-resolutions.test.mjs"];

function sources(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(mjs|cjs|js|ts)$/.test(e.name)) out.push(p);
    }
  };
  walk(join(ROOT, dir));
  return out;
}
const importers = (dirs) => dirs.flatMap(sources)
  .filter((f) => !f.endsWith(`${WRITER}.mjs`))
  .filter((f) => new RegExp(`['"][^'"]*${WRITER}(\\.mjs)?['"]`).test(readFileSync(f, "utf8")))
  .map((f) => relative(ROOT, f)).sort();

test("no CLI, kernel, script, package or capability module imports the captured store writer", () => {
  assert.deepEqual(importers(["bin", "lib", "scripts", "packages", "capabilities"]), []);
});

test("its only importers are the captured-path fixtures (e) deletes with it", () => {
  assert.deepEqual(importers(["test"]).filter((f) => f !== "test/captured-store-writer-reach.test.mjs"), FIXTURE_USERS);
});

test("the kernel's public surface no longer carries the package engine", async () => {
  const core = await import("../lib/core.mjs");
  for (const name of ["acquirePackage", "updatePackage", "approveCapability", "installedCapabilityDir", "parsePackageSource"]) {
    assert.equal(name in core, false, `lib/core.mjs still exports ${name}`);
  }
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const exported = JSON.stringify(pkg.exports ?? {});
  assert.doesNotMatch(exported, new RegExp(WRITER), "package.json exports must not name the writer");
});
