import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCapabilityMaterializer } from "../lib/package-materialization.mjs";
import { acquirePackage, loadPackageManifestAt, materializeCapabilityDeps, assertCapabilitySelfContained, assertMaterializedDepsContained, assertNoNativeBinaries } from "../lib/core.mjs";
import { treeIntegrity } from "../lib/portable-digest.mjs";

const materialize = createCapabilityMaterializer({ materializeCapabilityDeps, assertCapabilitySelfContained, assertMaterializedDepsContained, assertNoNativeBinaries });

test("shared materialization keeps exact provenance v1 bytes, source modes and links without selecting or approving", (t) => {
  const root = mkdtempSync(join(tmpdir(), "oats-materialization-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pkgRoot = join(root, "payload"), capRoot = join(pkgRoot, "capabilities/action");
  mkdirSync(capRoot, { recursive: true });
  writeFileSync(join(pkgRoot, "oats-package.json"), JSON.stringify({ package: "example.package", version: "1.0.0", description: "Fixture package", compatibility: { oats: ">=0.1.0" }, capabilities: ["capabilities/action"] }));
  writeFileSync(join(capRoot, "oats.json"), JSON.stringify({ capability: "example.action", version: "1.0.0", description: "Fixture capability", command: "example", commands: { run: "entry.mjs" } }));
  writeFileSync(join(capRoot, "run.mjs"), "console.log('fixture');\n", { mode: 0o755 }); symlinkSync("run.mjs", join(capRoot, "entry.mjs"));
  const pkg = { package: "example.package", version: "1.0.0", source: "git:https://example.invalid/tools.git@stable", commit: "a".repeat(40), path: "packages/tools" };
  const cap = loadPackageManifestAt(pkgRoot)._capabilities[0];
  const result = materialize({ cap, pkg, artifactsDir: join(root, "staged-artifacts") });
  const expected = { schemaVersion: 1, capability: "example.action", version: "1.0.0", package: "example.package", packageVersion: "1.0.0",
    source: pkg.source, commit: pkg.commit, packagePath: "packages/tools", capabilityPath: "capabilities/action" };
  assert.equal(readFileSync(join(result.dir, ".oats-installation.json"), "utf8"), JSON.stringify(expected, null, 2) + "\n");
  assert.equal(readlinkSync(join(result.dir, "entry.mjs")), "run.mjs");
  assert.equal(lstatSync(join(result.dir, "run.mjs")).mode & 0o100, 0o100);
  assert.equal(treeIntegrity(result.dir).format, "oats.tree-exec.v1");
  assert.equal(Object.hasOwn(result, "trusted"), false);
  assert.equal(existsSync(join(root, "oats-lock.json")), false);
  assert.equal(existsSync(join(root, ".agents")), false);
  assert.throws(() => createCapabilityMaterializer({}), TypeError);
});

test("acquisition refuses source-controlled provenance links and aliased capability roots before writes", (t) => {
  const root = mkdtempSync(join(tmpdir(), "oats-provenance-write-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const payload = join(root, "payload"), cap = join(payload, "capabilities/action"), deployment = join(root, "deployment"), victim = join(root, "unrelated.json");
  mkdirSync(cap, { recursive: true }); mkdirSync(deployment);
  writeFileSync(join(payload, "oats-package.json"), JSON.stringify({ package: "example.package", version: "1.0.0", description: "Fixture", compatibility: { oats: ">=0.1.0" }, capabilities: ["capabilities/action"] }));
  writeFileSync(join(cap, "oats.json"), JSON.stringify({ capability: "example.action", version: "1.0.0", description: "Fixture", commands: { run: "run.mjs" } }));
  writeFileSync(join(cap, "run.mjs"), "// not executed\n"); writeFileSync(victim, "preserve");
  symlinkSync(victim, join(cap, ".oats-installation.json"));
  let failure;
  try { acquirePackage(deployment, `path:${payload}`); } catch (error) { failure = error; }
  assert.equal(readFileSync(victim, "utf8"), "preserve", "unapproved package data must not overwrite a provenance-link target");
  assert.equal(failure?.code, "invalid-package-manifest");
  assert.equal(existsSync(join(deployment, "oats-lock.json")), false);
  rmSync(join(cap, ".oats-installation.json"));
  renameSync(cap, join(payload, "actual-capability")); symlinkSync("../actual-capability", cap);
  assert.throws(() => acquirePackage(deployment, `path:${payload}`), { code: "invalid-package-manifest" });
  assert.equal(readFileSync(victim, "utf8"), "preserve");
});
