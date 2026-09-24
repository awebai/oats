#!/usr/bin/env node
// Canonical docs -> optional Git package curriculum. No deployment/config effects.
// This is a complete source-payload gate, not an npm regular-file subset gate.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CAPABILITY_PATH = "capabilities/oats-knowledge-theory";
export const DISTRIBUTION_PACKAGE_ID = "oats.framework";
export const DISTRIBUTION_CAPABILITIES = [CAPABILITY_PATH, "capabilities/oats-core", "capabilities/oats-setup"];
// Dev-only validators load lazily so syntax-only checks (release lane, --syntax-only)
// work in a checkout without node_modules; a missing dependency then fails only
// the manifest/frontmatter checks that actually need it.
const require = createRequire(import.meta.url);
let capabilityValidator, yamlParser;
function validateCapability(value) {
  capabilityValidator ??= new (require("ajv/dist/2020.js"))({ allErrors: true, strict: false }).compile(
    JSON.parse(readFileSync(join(REPO_ROOT, "docs/capability-manifest.schema.json"), "utf8")),
  );
  const ok = capabilityValidator(value); validateCapability.errors = capabilityValidator.errors; return ok;
}
function parseYaml(text) { yamlParser ??= require("yaml").parse; return yamlParser(text); }
export const SKILL_PATH = "skills/knowledge-capability-authoring";
export const EXPERT_PATH = "agents/knowledge-theory-expert";

function inside(root, path) {
  const rel = relative(realpathSync(root), realpathSync(path));
  assert.ok(!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`), `reference escapes ${root}: ${path}`);
}

// Do not descend through symlinks. Every link must itself be relative, readable,
// and contained; the only shipped link is the canonical CLAUDE.md compatibility view.
export function treeFiles(root) {
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, e.name);
      if (e.isSymbolicLink()) {
        assert.ok(!isAbsolute(readlinkSync(path)), `absolute symlink: ${path}`);
        inside(root, path);
        assert.ok(lstatSync(realpathSync(path)).isFile(), `directory symlink is not a curriculum resource: ${path}`);
        files.push(relative(root, path));
      } else if (e.isDirectory()) walk(path);
      else {
        assert.ok(e.isFile(), `non-file resource: ${path}`);
        files.push(relative(root, path));
      }
    }
  };
  walk(root);
  return files.sort();
}

function markdownTargets(text) {
  // References use simple inline Markdown. Also account for reference-style and
  // HTML links so a later author cannot bypass the closure check with those forms.
  const body = text.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, "");
  const targets = [];
  for (const m of body.matchAll(/!?\[[^\]\n]*\]\(([^)\n]+)\)/g)) targets.push(m[1].trim().replace(/^<([^>]+)>$/, "$1"));
  const definitions = new Map();
  for (const m of body.matchAll(/^\s*\[([^\]]+)\]:\s*(\S+)/gm)) {
    definitions.set(m[1].toLowerCase(), m[2]);
    targets.push(m[2]);
  }
  for (const m of body.matchAll(/!?\[([^\]\n]+)\]\[([^\]\n]*)\]/g)) {
    const id = (m[2] || m[1]).toLowerCase();
    assert.ok(definitions.has(id), `undefined Markdown reference: ${id}`);
  }
  for (const m of body.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/g)) targets.push(m[1]);
  return targets;
}

/** Traverse all required links after source removal, without repo/network access. */
export function checkReferenceClosure(skillRoot) {
  const root = realpathSync(skillRoot);
  const files = treeFiles(root);
  const seen = new Set();
  const visit = (file) => {
    inside(root, file);
    const rel = relative(root, file);
    if (seen.has(rel)) return;
    assert.ok(lstatSync(file).isFile(), `curriculum link must name a file: ${rel}`);
    seen.add(rel);
    if (!file.endsWith(".md")) return;
    for (const raw of markdownTargets(readFileSync(file, "utf8"))) {
      assert.ok(!/^(?:[a-z][a-z0-9+.-]*:|\/)|[\\\s?]/i.test(raw), `nonlocal/unsupported curriculum reference in ${rel}: ${raw}`);
      const decoded = decodeURIComponent(raw);
      assert.ok(!/^(?:[a-z][a-z0-9+.-]*:|\/)|[\\\s?]/i.test(decoded), `nonlocal curriculum reference in ${rel}: ${raw}`);
      const [path, anchor] = decoded.split("#");
      const target = path ? resolve(dirname(file), path) : file;
      assert.ok(existsSync(target), `missing curriculum reference in ${rel}: ${raw}`);
      inside(root, target);
      if (anchor) {
        const headings = [...readFileSync(target, "utf8").matchAll(/^#{1,6}\s+(.+)$/gm)]
          .map((m) => m[1].toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").trim().replace(/\s/g, "-"));
        assert.ok(headings.includes(anchor), `missing heading in ${rel}: ${raw}`);
      }
      visit(target);
    }
  };
  visit(join(root, "SKILL.md"));
  for (const file of files.filter((f) => f.endsWith(".md"))) {
    assert.ok(seen.has(file), `unreachable curriculum document: ${file}`);
  }
  return [...seen].sort();
}

function referenceSources(repoRoot) {
  const refRoot = join(repoRoot, "docs/knowledge-reference");
  return ["knowledge-capability-authoring.md", ...treeFiles(refRoot).map((f) => join("knowledge-reference", f))];
}

export function syncKnowledgeTheoryReferences(repoRoot = REPO_ROOT) {
  const dest = join(repoRoot, "oats-package", CAPABILITY_PATH, SKILL_PATH, "references");
  for (const file of referenceSources(repoRoot)) {
    const out = join(dest, file);
    mkdirSync(dirname(out), { recursive: true });
    // Reject source or destination symlinks rather than writing through them.
    assert.ok(lstatSync(join(repoRoot, "docs", file)).isFile(), `not a regular canonical reference: ${file}`);
    inside(join(repoRoot, "oats-package", CAPABILITY_PATH), dirname(out));
    if (existsSync(out)) assert.ok(lstatSync(out).isFile(), `not a regular generated reference: ${out}`);
    writeFileSync(out, readFileSync(join(repoRoot, "docs", file)));
  }
}

// Keep the moved capabilities narrowly resource-only. Use the kernel's actual
// schema, not a copied validator; files must survive acquiring each own root.
export function checkOperationalCapabilities(packageRoot) {
  for (const [slug, names, injection] of [
    ["oats-core", ["oats-operate", "oats-souls"], "injects/oats.md"],
    ["oats-setup", ["oats-onboarding", "oats-package-pins", "oats-rebuild"], null],
  ]) {
    const root = join(packageRoot, "capabilities", slug);
    const cap = JSON.parse(readFileSync(join(root, "oats.json"), "utf8"));
    assert.ok(validateCapability(cap), `${slug}: ${JSON.stringify(validateCapability.errors)}`);
    // An inject without a helperInjection policy refuses helper composition (second-operator
    // finding, 2026-09-21): every injecting framework capability declares its policy explicitly.
    assert.deepEqual(Object.keys(cap).sort(), ["capability", "version", "description", "compatibility", "requires", "skills", ...(injection ? ["inject", "helperInjection"] : [])].sort());
    if (injection) assert.deepEqual(cap.helperInjection, { version: 1, mode: "inherit" }, `${slug}: helper instances are OATS instances too; the briefing is inherited`);
    assert.equal(cap.capability, slug.replace("oats-", "oats."));
    assert.match(cap.version, /^\d+\.\d+\.\d+$/);
    assert.deepEqual(cap.compatibility, { oats: ">=0.25.5" }); // the workspace-model surface these skills teach
    assert.deepEqual(cap.requires, []);
    assert.deepEqual(cap.skills, names.map(name => `skills/${name}`));
    assert.deepEqual(treeFiles(root), ["oats.json", ...names.map(name => `skills/${name}/SKILL.md`), ...(injection ? [injection] : [])].sort());
    for (const name of names) {
      const file = join(root, "skills", name, "SKILL.md"), text = readFileSync(file, "utf8");
      assert.ok(lstatSync(file).isFile(), `skill must be a contained regular file: ${name}`);
      const match = text.match(/^---\n([\s\S]*?)\n---\n/);
      assert.ok(match, `missing frontmatter: ${name}`);
      const fields = parseYaml(match[1]);
      assert.equal(fields.name, name);
      assert.ok(typeof fields.description === "string" && fields.description.trim() && fields.description.length <= 1024, `invalid description: ${name}`);
      assert.ok(text.split("\n").length <= 500, `oversized skill: ${name}`);
    }
    if (injection) {
      assert.equal(cap.inject, injection);
      const text = readFileSync(join(root, injection), "utf8");
      assert.match(text, /oats-operate/); assert.match(text, /oats-souls/);
    }
  }
}

export function checkKnowledgeTheoryPackage({ repoRoot = REPO_ROOT, packageRoot = join(repoRoot, "oats-package"), parity = true } = {}) {
  const capRoot = join(packageRoot, CAPABILITY_PATH);
  const pkg = JSON.parse(readFileSync(join(packageRoot, "oats-package.json"), "utf8"));
  const cap = JSON.parse(readFileSync(join(capRoot, "oats.json"), "utf8"));
  // Deliberately narrow: adding any runtime policy, dependency, template or
  // executable surface is a boundary change, not unnoticed manifest growth.
  assert.deepEqual(Object.keys(pkg).sort(), ["package", "version", "description", "compatibility", "capabilities"].sort());
  assert.deepEqual(Object.keys(cap).sort(), ["capability", "version", "description", "compatibility", "requires", "skills", "agents"].sort());
  assert.equal(pkg.package, DISTRIBUTION_PACKAGE_ID);
  assert.equal(cap.capability, "oats.knowledge-theory");
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(cap.version, "1.0.1");
  assert.deepEqual(cap.compatibility, { oats: ">=0.22.19" });
  assert.deepEqual(pkg.compatibility, { oats: ">=0.24.0" });
  assert.deepEqual(pkg.capabilities, DISTRIBUTION_CAPABILITIES);
  assert.ok(validateCapability(cap), JSON.stringify(validateCapability.errors));
  checkOperationalCapabilities(packageRoot);
  assert.deepEqual(cap.requires, []);
  assert.deepEqual(cap.skills, [SKILL_PATH]);
  assert.deepEqual(cap.agents, [EXPERT_PATH]);
  treeFiles(packageRoot);
  treeFiles(capRoot);
  const soul = join(capRoot, EXPERT_PATH);
  const alias = join(soul, "CLAUDE.md");
  assert.ok(existsSync(alias) && lstatSync(alias).isSymbolicLink(), "source CLAUDE.md must be a tracked relative symlink, never omitted or synthesized during acquisition");
  assert.equal(readlinkSync(alias), "AGENTS.md");
  assert.ok(lstatSync(join(soul, "AGENTS.md")).isFile(), "AGENTS.md is canonical");
  assert.ok(!existsSync(join(soul, "knowledge")), "the expert does not carry a soul knowledge bundle");
  const skill = join(capRoot, SKILL_PATH);
  const closure = checkReferenceClosure(skill);
  if (parity) {
    const expected = referenceSources(repoRoot).sort();
    const refs = join(skill, "references");
    assert.deepEqual(treeFiles(refs), expected, "generated reference file set differs from canonical docs");
    for (const file of expected) {
      assert.ok(readFileSync(join(repoRoot, "docs", file)).equals(readFileSync(join(refs, file))), `reference drift: ${file}; run node scripts/check-knowledge-theory-package.mjs --write`);
    }
  }
  return { ok: true, package: pkg.package, version: pkg.version, references: closure.length - 1 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.ok(process.argv.slice(2).every((arg) => arg === "--write"), "usage: node scripts/check-knowledge-theory-package.mjs [--write]");
    if (process.argv.includes("--write")) syncKnowledgeTheoryReferences();
    console.log(JSON.stringify(checkKnowledgeTheoryPackage()));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
