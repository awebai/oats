import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  CAPABILITY_PATH, EXPERT_PATH, REPO_ROOT, SKILL_PATH,
  checkKnowledgeTheoryPackage, checkReferenceClosure, syncKnowledgeTheoryReferences,
} from "../scripts/check-knowledge-theory-package.mjs";

const PACKAGE_ROOT = join(REPO_ROOT, "oats-package");
const PACKAGE_META = JSON.parse(readFileSync(join(PACKAGE_ROOT, "oats-package.json"), "utf8"));
const CAP_ROOT = join(PACKAGE_ROOT, CAPABILITY_PATH);
function write(file, body) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, body); }
function temp(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-theory-test-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  return base;
}
function copyPackage(base) {
  const dest = join(base, "source");
  cpSync(PACKAGE_ROOT, dest, { recursive: true, verbatimSymlinks: true });
  return dest;
}

test("framework distribution validates theory plus core/setup resource-only manifests and skill inventory", () => {
  assert.deepEqual(checkKnowledgeTheoryPackage(), { ok: true, package: PACKAGE_META.package, version: PACKAGE_META.version, references: 8 });
  const frontmatter = readFileSync(join(CAP_ROOT, SKILL_PATH, "SKILL.md"), "utf8");
  assert.match(frontmatter, /^---\nname: knowledge-capability-authoring\ndescription: >-\n/);
  assert.ok(frontmatter.split("\n").length < 500);
  assert.equal(readlinkSync(join(CAP_ROOT, EXPERT_PATH, "CLAUDE.md")), "AGENTS.md");
});

test("canonical references regenerate byte-for-byte; drift and extra copies fail", (t) => {
  const base = temp(t);
  cpSync(PACKAGE_ROOT, join(base, "oats-package"), { recursive: true, verbatimSymlinks: true });
  cpSync(join(REPO_ROOT, "docs/knowledge-reference"), join(base, "docs/knowledge-reference"), { recursive: true });
  write(join(base, "docs/knowledge-capability-authoring.md"), readFileSync(join(REPO_ROOT, "docs/knowledge-capability-authoring.md")));
  const refs = join(base, "oats-package", CAPABILITY_PATH, SKILL_PATH, "references");
  writeFileSync(join(refs, "knowledge-reference/model.md"), "# Stale copy\n");
  assert.throws(() => checkKnowledgeTheoryPackage({ repoRoot: base }), /reference drift/);
  syncKnowledgeTheoryReferences(base);
  assert.equal(checkKnowledgeTheoryPackage({ repoRoot: base }).ok, true);
  write(join(refs, "orphan.md"), "# Orphan\n");
  assert.throws(() => checkKnowledgeTheoryPackage({ repoRoot: base }), /unreachable curriculum/);
});

test("closure traversal rejects missing, escaping, remote and stale-anchor references", (t) => {
  const base = temp(t);
  const copied = copyPackage(base);
  const skill = join(copied, CAPABILITY_PATH, SKILL_PATH);
  const skillFile = join(skill, "SKILL.md");
  const original = readFileSync(skillFile, "utf8");
  assert.equal(checkReferenceClosure(skill).length, 9);
  for (const [target, error] of [["missing.md", /missing curriculum/], ["https://example.invalid/mutable.md", /nonlocal/], ["references/knowledge-reference/model.md#absent", /missing heading/]]) {
    writeFileSync(skillFile, `${original}\n[bad](${target})\n`);
    assert.throws(() => checkReferenceClosure(skill), error);
  }
  const outside = join(copied, CAPABILITY_PATH, "outside.md");
  write(outside, "# Outside skill closure\n");
  writeFileSync(skillFile, `${original}\n[escape](../../outside.md)\n`);
  assert.throws(() => checkReferenceClosure(skill), /reference escapes/);
  writeFileSync(skillFile, original);
  symlinkSync("../../outside.md", join(skill, "escaped.md"));
  assert.throws(() => checkReferenceClosure(skill), /reference escapes/);
});

test("policy additions and escaping soul compatibility symlinks fail the package gate", (t) => {
  const base = temp(t);
  const copied = copyPackage(base);
  const manifestPath = join(copied, CAPABILITY_PATH, "oats.json");
  const original = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const patch of [{ layer: "knowledge" }, { inject: "mandatory.md" }, { hooks: { spawn: "hook.mjs" } }]) {
    writeFileSync(manifestPath, JSON.stringify({ ...original, ...patch }));
    assert.throws(() => checkKnowledgeTheoryPackage({ packageRoot: copied, parity: false }), assert.AssertionError);
  }
  writeFileSync(manifestPath, JSON.stringify(original));
  const alias = join(copied, CAPABILITY_PATH, EXPERT_PATH, "CLAUDE.md");
  rmSync(alias);
  symlinkSync(join(CAP_ROOT, EXPERT_PATH, "AGENTS.md"), alias);
  assert.throws(() => checkKnowledgeTheoryPackage({ packageRoot: copied, parity: false }), /absolute symlink/);
});

test("a missing npm-style source alias or a regular compatibility copy fails the source gate", (t) => {
  const copied = copyPackage(temp(t));
  const alias = join(copied, CAPABILITY_PATH, EXPERT_PATH, "CLAUDE.md");
  rmSync(alias);
  assert.throws(() => checkKnowledgeTheoryPackage({ packageRoot: copied, parity: false }), /source CLAUDE.md must be/);
  write(alias, readFileSync(join(copied, CAPABILITY_PATH, EXPERT_PATH, "AGENTS.md")));
  assert.throws(() => checkKnowledgeTheoryPackage({ packageRoot: copied, parity: false }), /source CLAUDE.md must be/);
  rmSync(alias);
  symlinkSync("AGENTS.md", alias);
  assert.equal(checkKnowledgeTheoryPackage({ packageRoot: copied, parity: false }).ok, true);
});
