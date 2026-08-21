// Un-migrated OAS scopes must be LOUD (aweb-abfy.1).
//
// A deployment created by OAS (@oas-framework/oas) has oas-config.yaml,
// oas-lock.json and installed oas.* capability dirs — none of which this
// kernel recognizes. Without detection it reads as an EMPTY scope: doctor
// shows no config and `oats migrate` reports "nothing to migrate" with exit
// 0, while spawns would silently lose the knowledge and messaging layers.
// These are the first oas-* named fixtures in the suite, on purpose: the
// rename shipped with zero tests over legacy-named state.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { detectOasScopes } from "../lib/core.mjs";
import { discoverOasScopes } from "../lib/packages.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
import { spawnSync } from "node:child_process";

function temp() { return mkdtempSync(join(tmpdir(), "oats-oas-scope-")); }
function write(path, content) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); }

/** Hermetic child environment: close the HOME walk and the ambient OATS/PI
 * variable leaks, same as official-migration.test.mjs (this suite runs inside
 * an OATS instance in this fleet). */
const HERMETIC_HOME = mkdtempSync(join(tmpdir(), "oats-oas-scope-home-"));
function cli(cwd, ...argv) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(OATS|PI)_/.test(k)) env[k] = v;
  env.HOME = HERMETIC_HOME;
  env.OATS_HOME_DIR = join(HERMETIC_HOME, ".oats");
  return spawnSync(process.execPath, [CLI, ...argv], { cwd, env, encoding: "utf8" });
}
function json(r) {
  const doc = JSON.parse(r.stdout);
  assert.equal(r.stdout.trim(), JSON.stringify(doc), "stdout is exactly one JSON document");
  return doc;
}

/** A realistic pre-rename OAS deployment: both scope files plus an installed
 * legacy capability artifact. Contents are real OAS shapes, but detection is
 * by NAME only — the kernel must never need to parse what it cannot own. */
function oasFixture(dir) {
  write(join(dir, "oas-config.yaml"), [
    "name: legacy-deployment",
    "oas:",
    "  injection: injects/oas.md",
    "capabilities:",
    "  layers:",
    "    knowledge:",
    "      capability: oas.okf",
    "      from: installed",
    "",
  ].join("\n"));
  write(join(dir, "oas-lock.json"), JSON.stringify({
    lockfileVersion: 1,
    capabilities: { "oas.okf": { source: "marketplace:oas.okf@1.3.0", version: "1.3.0", integrity: "sha256-0000" } },
  }, null, 2));
  write(join(dir, ".agents", "capabilities", "installed", "oas.okf", "oas.json"), JSON.stringify({ capability: "oas.okf", version: "1.3.0" }));
  return dir;
}

// ---------- detection primitives ----------

test("detectOasScopes finds both files on the ancestor chain, closest first", () => {
  const root = temp();
  oasFixture(root);
  const nested = join(root, "sub", "deeper");
  mkdirSync(nested, { recursive: true });
  const found = detectOasScopes(nested);
  assert.equal(found.length, 1);
  assert.equal(found[0].dir, root);
  assert.deepEqual(found[0].files, ["oas-config.yaml", "oas-lock.json"]);
});

test("detectOasScopes is empty on an OATS-named scope", () => {
  const root = temp();
  write(join(root, "oats-config.yaml"), "name: modern\n");
  write(join(root, "oats-lock.json"), JSON.stringify({ lockfileVersion: 2, packages: {}, capabilities: {} }));
  assert.deepEqual(detectOasScopes(root), []);
});

test("discoverOasScopes unions the ancestor chain with the boundary walk", () => {
  const boundary = temp();
  const nestedOas = oasFixture(join(boundary, "legacy-repo"));
  mkdirSync(join(boundary, "modern-repo"), { recursive: true });
  write(join(boundary, "modern-repo", "oats-config.yaml"), "name: modern\n");
  const found = discoverOasScopes(boundary, { teamScope: boundary });
  assert.deepEqual(found.map((f) => f.dir), [nestedOas]);
  assert.deepEqual(found[0].files, ["oas-config.yaml", "oas-lock.json"]);
});

// ---------- oats migrate: never silent success over an OAS scope ----------

test("guided dry run on an OAS scope exits nonzero and names the remedy", () => {
  const scope = oasFixture(temp());
  const r = cli(scope, "migrate", "--official", "--dry-run", "--dir", scope);
  assert.notEqual(r.status, 0, `expected nonzero exit, got 0\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  const all = r.stdout + r.stderr;
  assert.match(all, /UN-MIGRATED OAS SCOPE/);
  assert.match(all, /docs\/migration-from-oas\.md/);
  assert.match(all, /@oas-framework\/oas/);
  assert.doesNotMatch(all, /\(no oats-lock\.json found — nothing to migrate\)/);
});

test("guided dry run --json on an OAS scope is a single nonzero envelope carrying the scopes", () => {
  const scope = oasFixture(temp());
  const r = cli(scope, "migrate", "--official", "--dry-run", "--dir", scope, "--json");
  assert.notEqual(r.status, 0);
  const doc = json(r);
  assert.equal(doc.ok, false);
  assert.equal(doc.error.code, "E_MIGRATE_FAILED");
  assert.match(doc.error.message, /un-migrated OAS scope/);
  assert.deepEqual(doc.error.details.oasScopes.map((f) => f.dir), [scope]);
  assert.deepEqual(doc.error.details.oasScopes[0].files, ["oas-config.yaml", "oas-lock.json"]);
  assert.match(doc.error.details.oasRemedy, /migration-from-oas\.md/);
});

test("guided recursive dry run finds an OAS scope nested under the boundary", () => {
  const boundary = temp();
  const nested = oasFixture(join(boundary, "legacy-repo"));
  const r = cli(boundary, "migrate", "--official", "--recursive", "--dry-run", "--dir", boundary, "--json");
  assert.notEqual(r.status, 0);
  const doc = json(r);
  assert.equal(doc.error.code, "E_MIGRATE_FAILED");
  assert.deepEqual(doc.error.details.oasScopes.map((f) => f.dir), [nested]);
});

test("guided apply on an OAS scope fails with oas-scope-unmigrated, never overall success", () => {
  const scope = oasFixture(temp());
  const r = cli(scope, "migrate", "--official", "--dir", scope, "--json");
  assert.notEqual(r.status, 0);
  const doc = json(r);
  assert.equal(doc.ok, false);
  assert.equal(doc.error.code, "E_MIGRATE_FAILED");
  assert.match(doc.error.message, /not migrated/);
});

test("plain dry run on an OAS scope fails loud instead of 'Nothing to migrate'", () => {
  const scope = oasFixture(temp());
  const text = cli(scope, "migrate", "--dry-run", "--dir", scope);
  assert.notEqual(text.status, 0);
  assert.match(text.stderr, /un-migrated OAS scope files exist/);
  assert.match(text.stderr, /migration-from-oas\.md/);
  assert.doesNotMatch(text.stdout, /Nothing to migrate/);

  const j = cli(scope, "migrate", "--dry-run", "--dir", scope, "--json");
  assert.notEqual(j.status, 0);
  const doc = json(j);
  assert.equal(doc.ok, false);
  assert.equal(doc.error.code, "oas-scope-unmigrated");
});

test("plain apply on an OAS scope carries the OAS note on its failure", () => {
  const scope = oasFixture(temp());
  const r = cli(scope, "migrate", "--dir", scope, "--json");
  assert.notEqual(r.status, 0);
  const doc = json(r);
  assert.equal(doc.ok, false);
  assert.match(doc.error.message, /un-migrated OAS scope files exist/);
});

test("a mixed boundary (one OATS scope ready, one OAS scope) still exits nonzero", () => {
  const boundary = temp();
  oasFixture(join(boundary, "legacy-repo"));
  // An empty v1 lock is trivially convertible — without the OAS neighbor this
  // dry run would be a clean "1 scope ready" success.
  write(join(boundary, "modern-repo", "oats-lock.json"), JSON.stringify({ lockfileVersion: 1, capabilities: {} }, null, 2));
  const r = cli(boundary, "migrate", "--official", "--recursive", "--dry-run", "--dir", boundary, "--json");
  assert.notEqual(r.status, 0);
  const doc = json(r);
  assert.equal(doc.error.code, "E_MIGRATE_FAILED");
  assert.match(doc.error.message, /1 ready/);
  assert.match(doc.error.message, /un-migrated OAS scope/);
});

test("an OATS-only scope is unaffected: guided dry run still succeeds", () => {
  const scope = temp();
  write(join(scope, "oats-lock.json"), JSON.stringify({ lockfileVersion: 1, capabilities: {} }, null, 2));
  const r = cli(scope, "migrate", "--official", "--dry-run", "--dir", scope, "--json");
  assert.equal(r.status, 0, `expected success\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  const doc = json(r);
  assert.equal(doc.ok, true);
  assert.deepEqual(doc.result.oasScopes, []);
  assert.equal(doc.result.oasRemedy, null);
});

// ---------- oats doctor: the un-migrated scope is named ----------

test("doctor names an un-migrated OAS scope with the remedy", () => {
  const scope = oasFixture(temp());
  const r = cli(scope, "doctor");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /UN-MIGRATED OAS SCOPE/);
  assert.match(r.stdout, /oas-config\.yaml, oas-lock\.json/);
  assert.match(r.stdout, /migration-from-oas\.md/);
});

test("doctor --json carries oasScopes and oasRemedy", () => {
  const scope = oasFixture(temp());
  const r = cli(scope, "doctor", "--json");
  assert.equal(r.status, 0);
  const doc = JSON.parse(r.stdout);
  // doctor resolves its context from the child's cwd, which the OS realpaths
  // (/var vs /private/var on macOS) — compare realpaths, not spellings.
  assert.deepEqual(doc.oasScopes.map((f) => f.dir), [realpathSync(scope)]);
  assert.deepEqual(doc.oasScopes[0].files, ["oas-config.yaml", "oas-lock.json"]);
  assert.match(doc.oasRemedy, /migration-from-oas\.md/);
});

test("doctor --json on an OATS scope reports no OAS artifacts", () => {
  const scope = temp();
  write(join(scope, "oats-config.yaml"), "name: modern\n");
  const r = cli(scope, "doctor", "--json");
  assert.equal(r.status, 0);
  const doc = JSON.parse(r.stdout);
  assert.deepEqual(doc.oasScopes, []);
  assert.equal(doc.oasRemedy, null);
});
