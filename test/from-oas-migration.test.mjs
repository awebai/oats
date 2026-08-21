// `oats migrate --from-oas` (aweb-abfy.3): one transactional conversion from
// a live OAS deployment to a green OATS scope.
//
// The fixture replicates the REAL deployment shape at a live OAS install:
// oas-config.yaml with comments and oas.* capability ids, a v1 oas-lock.json
// with marketplace:oas.* sources, hyphen-named installed artifact dirs each
// carrying an oas.json manifest, a local-agents soul with
// .oas-scaffold-owners.json whose owner VALUES are oas.* ids, and a committed
// soul to spawn afterwards — the anti-silent-regression check is that the
// composed instance AGENTS.md carries the knowledge and messaging injections.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { OATS_LOCK_FILE, installedCapabilitiesDir } from "../lib/core.mjs";
import { oasRenameMap, transformOasConfigText } from "../lib/packages.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
function temp() { return mkdtempSync(join(tmpdir(), "oats-from-oas-")); }
function write(path, content) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); }
function gitify(dir) {
  execFileSync("git", ["init", "-q", dir]);
  execFileSync("git", ["-C", dir, "config", "user.email", "t@example.invalid"]);
  execFileSync("git", ["-C", dir, "config", "user.name", "T"]);
  execFileSync("git", ["-C", dir, "add", "-A"]);
  execFileSync("git", ["-C", dir, "commit", "-qm", "init"]);
}

const HERMETIC_HOME = mkdtempSync(join(tmpdir(), "oats-from-oas-home-"));
function cli(cwd, catalogFile, ...argv) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(OATS|PI)_/.test(k)) env[k] = v;
  env.HOME = HERMETIC_HOME;
  env.OATS_HOME_DIR = join(HERMETIC_HOME, ".oats");
  if (catalogFile) env.OATS_PACKAGE_CATALOG = catalogFile;
  return spawnSync(process.execPath, [CLI, ...argv], { cwd, env, encoding: "utf8" });
}
function json(r) {
  const doc = JSON.parse(r.stdout);
  assert.equal(r.stdout.trim(), JSON.stringify(doc), "stdout is exactly one JSON document");
  return doc;
}

/** Content hash of every file under a tree — the byte-identical rollback oracle. */
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out[relative(dir, p)] = createHash("sha256").update(readFileSync(p)).digest("hex");
    }
  };
  walk(dir);
  return out;
}

// ---------- official package sources: okf + aweb with inject files ----------

function pkgSource(dir, pkgId, rel, manifest, files) {
  for (const [file, body] of Object.entries(files || {})) write(join(dir, rel, file), body);
  write(join(dir, rel, "oats.json"), JSON.stringify({ version: "2.0.0", description: "official", ...manifest }, null, 2));
  write(join(dir, "oats-package.json"), JSON.stringify({
    package: pkgId, version: "2.0.0", description: `official ${pkgId}`,
    compatibility: { oats: ">=0.1.0" }, capabilities: [rel],
  }, null, 2));
  gitify(dir);
  return dir;
}

function officialFixture(base) {
  const okf = pkgSource(join(base, "pkgs", "okf"), "oats.okf", "okf",
    { capability: "oats.okf", layer: "knowledge", inject: "injects/okf.md" },
    { "injects/okf.md": "OKF-INJECT-MARKER: capture without judging.\n" });
  const aweb = pkgSource(join(base, "pkgs", "aweb"), "oats.aweb", "aweb",
    { capability: "oats.aweb", layer: "messaging", inject: "injects/aweb.md" },
    { "injects/aweb.md": "AWEB-INJECT-MARKER: mail and chat identities.\n" });
  const catalog = join(base, "catalog.json");
  write(catalog, JSON.stringify({
    packages: { "oats.okf": { url: okf, path: "." }, "oats.aweb": { url: aweb, path: "." } },
    capabilities: {
      "oas.okf": { package: "oats.okf", capability: "oats.okf" },
      "oas.aweb": { package: "oats.aweb", capability: "oats.aweb" },
    },
  }, null, 2));
  return catalog;
}

/** The live-deployment shape: comments, agent-types, oas.* ids, hyphen dirs. */
function oasDeployment(scope) {
  write(join(scope, "oas-config.yaml"), [
    "name: cjr-like",
    "",
    "# ── Agent types — capability entries can target them.",
    "agent-types:",
    "  reviewers:",
    "    description: Fresh-eyes reviewers",
    "",
    "capabilities:",
    "  # Fundamental layers — exclusive slots.",
    "  layers:",
    "    knowledge:",
    "      capability: oas.okf",
    "      from: installed",
    "      global: true",
    "      # injection-override: .agents/injections/capabilities/oas.okf.md",
    "    messaging:",
    "      capability: oas.aweb",
    "      from: installed",
    "      global: true",
    "    tasks: none",
    "",
  ].join("\n"));
  write(join(scope, "oas-lock.json"), JSON.stringify({
    lockfileVersion: 1,
    capabilities: {
      "oas.okf": { source: "marketplace:oas.okf@1.4.0", version: "1.4.0", integrity: `sha256-${"0".repeat(64)}`, trustedExecutables: true },
      "oas.aweb": { source: "marketplace:oas.aweb@1.5.1", version: "1.5.1", integrity: `sha256-${"1".repeat(64)}`, trustedExecutables: true },
    },
  }, null, 2));
  write(join(scope, ".agents", "capabilities", "installed", "oas-okf", "oas.json"), JSON.stringify({ capability: "oas.okf", version: "1.4.0" }));
  write(join(scope, ".agents", "capabilities", "installed", "oas-aweb", "oas.json"), JSON.stringify({ capability: "oas.aweb", version: "1.5.1" }));
  write(join(scope, "local-agents", "scratch", "soul", ".oas-scaffold-owners.json"), JSON.stringify({ "knowledge/index.md": "oas.okf", "knowledge/log.md": "oas.okf" }, null, 2));
  // Two committed souls, one spawnable against a plain project dir.
  write(join(scope, "project", "README.md"), "fixture project\n");
  gitify(join(scope, "project"));
  write(join(scope, "agents", "dev", "soul", "soul.yaml"), "name: dev\ndescription: fixture developer\nrepo: project\nwork: checkout\nruntime: pi\n");
  write(join(scope, "agents", "dev", "soul", "AGENTS.md"), "# Dev soul\n");
  write(join(scope, "agents", "docs", "soul", "soul.yaml"), "name: docs\ndescription: fixture docs\nrepo: project\nwork: checkout\nruntime: pi\n");
  write(join(scope, "agents", "docs", "soul", "AGENTS.md"), "# Docs soul\n");
  return scope;
}

// ---------- unit: the transform primitives ----------

test("transformOasConfigText renames the oas: block and mapped ids, preserving comments", () => {
  const renames = { "oas.okf": "oats.okf" };
  const { text, changes } = transformOasConfigText([
    "name: x",
    "oas:",
    "  defaults: here",
    "# a comment naming oas.okf stays put",
    "capabilities:",
    "  layers:",
    "    knowledge:",
    "      capability: oas.okf",
    "  additive:",
    "    oas.okf:",
    "      from: installed",
    "",
  ].join("\n"), renames);
  assert.match(text, /^oats:$/m);
  assert.match(text, /capability: oats\.okf/);
  assert.match(text, /^    oats\.okf:$/m);
  assert.match(text, /# a comment naming oas\.okf stays put/);
  assert.equal(changes.length, 3);
});

test("oasRenameMap derives every pair from the catalog renaming aliases only", () => {
  const map = oasRenameMap();
  assert.equal(map["oas.okf"], "oats.okf");
  assert.equal(map["oas.review"], "oats.review");
  assert.equal(map["oats.review"], undefined, "plain aliases are not renames");
});

// ---------- end to end ----------

test("dry run reports every step and the package plan, touching nothing", () => {
  const base = temp();
  const catalog = officialFixture(base);
  const scope = oasDeployment(join(base, "scope"));
  const before = snapshot(scope);

  const r = cli(scope, catalog, "migrate", "--from-oas", "--dry-run", "--dir", scope, "--json");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const doc = json(r);
  const row = doc.result.scopes[0];
  assert.equal(row.status, "ready");
  const tos = row.steps.map((s) => s.to);
  assert.ok(tos.some((t) => t.endsWith("oats-config.yaml")));
  assert.ok(tos.some((t) => t.endsWith("oats-lock.json")));
  assert.ok(tos.some((t) => t.endsWith(join("oas-okf", "oats.json"))));
  assert.ok(tos.some((t) => t.endsWith(".oats-scaffold-owners.json")));
  const okf = row.plan.find((p) => p.capability === "oas.okf");
  assert.equal(okf.action, "acquire");
  assert.equal(okf.migratesTo, "oats.okf");
  assert.deepEqual(snapshot(scope), before, "dry run must not touch the scope");
  rmSync(base, { recursive: true, force: true });
});

test("apply converts the scope end to end and spawn composes both injections", () => {
  const base = temp();
  const catalog = officialFixture(base);
  const scope = oasDeployment(join(base, "scope"));

  const r = cli(scope, catalog, "migrate", "--from-oas", "--dir", scope, "--json");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const doc = json(r);
  const row = doc.result.scopes[0];
  assert.equal(row.status, "migrated");
  assert.deepEqual(row.migrated.map((m) => `${m.capability}>${m.migratedTo}`).sort(), ["oas.aweb>oats.aweb", "oas.okf>oats.okf"]);

  // Break 1+2: files renamed, config transformed, comments preserved.
  assert.ok(!existsSync(join(scope, "oas-config.yaml")));
  assert.ok(!existsSync(join(scope, "oas-lock.json")));
  const cfg = readFileSync(join(scope, "oats-config.yaml"), "utf8");
  assert.match(cfg, /capability: oats\.okf/);
  assert.match(cfg, /capability: oats\.aweb/);
  assert.match(cfg, /# ── Agent types/);

  // Break 3+4: v2 lock names only successors; artifacts re-acquired; the
  // stale hyphen-named OAS dirs are gone.
  const lock = JSON.parse(readFileSync(join(scope, OATS_LOCK_FILE), "utf8"));
  assert.equal(lock.lockfileVersion, 2);
  assert.deepEqual(Object.keys(lock.capabilities).sort(), ["oats.aweb", "oats.okf"]);
  assert.ok(existsSync(join(installedCapabilitiesDir(scope), "oats.okf")));
  assert.ok(!existsSync(join(installedCapabilitiesDir(scope), "oas-okf")));
  assert.ok(!existsSync(join(installedCapabilitiesDir(scope), "oas-aweb")));

  // Scaffold owners: renamed AND owner values mapped.
  const owners = JSON.parse(readFileSync(join(scope, "local-agents", "scratch", "soul", ".oats-scaffold-owners.json"), "utf8"));
  assert.deepEqual(owners, { "knowledge/index.md": "oats.okf", "knowledge/log.md": "oats.okf" });
  assert.ok(!existsSync(join(scope, "local-agents", "scratch", "soul", ".oas-scaffold-owners.json")));

  // Doctor green: layers resolve, no OAS residue, no lock error.
  const doctor = JSON.parse(cli(scope, catalog, "doctor", "--json").stdout);
  assert.equal(doctor.layers.knowledge.integration, "oats.okf");
  assert.equal(doctor.layers.messaging.integration, "oats.aweb");
  assert.deepEqual(doctor.oasScopes, []);
  assert.equal(doctor.lockError, null);

  // THE anti-silent-regression check: a spawned instance's composed AGENTS.md
  // carries the knowledge and messaging injections.
  const spawn = cli(scope, catalog, "spawn", "dev", "--task", "fixture task", "--no-launch", "--json");
  assert.equal(spawn.status, 0, spawn.stdout + spawn.stderr);
  const sdoc = json(spawn);
  const home = sdoc.result.home || sdoc.result.instanceHome || sdoc.result.dir;
  assert.ok(home, JSON.stringify(sdoc.result));
  const agentsMd = readFileSync(join(home, "AGENTS.md"), "utf8");
  assert.match(agentsMd, /OKF-INJECT-MARKER/);
  assert.match(agentsMd, /AWEB-INJECT-MARKER/);

  // Idempotent: a second run is a clean no-op.
  const again = cli(scope, catalog, "migrate", "--from-oas", "--dir", scope);
  assert.equal(again.status, 0);
  assert.match(again.stdout, /nothing to migrate from OAS/);
  rmSync(base, { recursive: true, force: true });
});

test("a phase-2 failure rolls the scope back byte-identically to its OAS state", () => {
  const base = temp();
  // A lying catalog: oats.aweb exists but does not export oats.okf, so the
  // chained conversion fails AFTER the renames — the journal must restore
  // every original byte, oas-names included.
  const aweb = pkgSource(join(base, "pkgs", "aweb"), "oats.aweb", "aweb",
    { capability: "oats.aweb", layer: "messaging" }, {});
  const catalog = join(base, "catalog.json");
  write(catalog, JSON.stringify({
    packages: { "oats.aweb": { url: aweb, path: "." } },
    capabilities: {
      "oas.okf": { package: "oats.aweb", capability: "oats.okf" },
      "oas.aweb": { package: "oats.aweb", capability: "oats.aweb" },
    },
  }, null, 2));
  const scope = oasDeployment(join(base, "scope"));
  const before = snapshot(scope);

  const r = cli(scope, catalog, "migrate", "--from-oas", "--dir", scope, "--json");
  assert.notEqual(r.status, 0);
  const doc = json(r);
  assert.equal(doc.ok, false);
  assert.equal(doc.error.code, "E_FROM_OAS_FAILED");
  assert.ok(doc.error.details.scopes[0].errors.some((e) => /restored to its original OAS state/.test(e)), JSON.stringify(doc.error.details.scopes[0].errors));
  assert.deepEqual(snapshot(scope), before, "scope must be byte-identical after rollback");
  rmSync(base, { recursive: true, force: true });
});

test("recursive discovers and converts a nested OAS scope from the boundary", () => {
  const base = temp();
  const catalog = officialFixture(base);
  const scope = oasDeployment(join(base, "workspace", "legacy"));
  const r = cli(join(base, "workspace"), catalog, "migrate", "--from-oas", "--recursive", "--dir", join(base, "workspace"), "--json");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const doc = json(r);
  assert.equal(doc.result.scopes.length, 1);
  assert.equal(doc.result.scopes[0].scope, scope);
  assert.equal(doc.result.scopes[0].status, "migrated");
  rmSync(base, { recursive: true, force: true });
});

test("non-recursive from a child directory points at the ancestor scope instead of guessing", () => {
  const base = temp();
  const catalog = officialFixture(base);
  const scope = oasDeployment(join(base, "scope"));
  const child = join(scope, "project");
  const r = cli(child, catalog, "migrate", "--from-oas", "--dir", child, "--json");
  assert.notEqual(r.status, 0);
  const doc = json(r);
  assert.equal(doc.error.code, "E_BAD_ARGS");
  assert.match(doc.error.message, /--recursive/);
  rmSync(base, { recursive: true, force: true });
});
