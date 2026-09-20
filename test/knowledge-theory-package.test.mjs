import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CAPABILITY_PATH, EXPERT_PATH, REPO_ROOT, SKILL_PATH,
  checkKnowledgeTheoryPackage, checkReferenceClosure, syncKnowledgeTheoryReferences, treeFiles,
} from "../scripts/check-knowledge-theory-package.mjs";

const PACKAGE_ROOT = join(REPO_ROOT, "oats-package");
const PACKAGE_META = JSON.parse(readFileSync(join(PACKAGE_ROOT, "oats-package.json"), "utf8"));
const PACKAGE_CAPABILITIES = ["oats.knowledge-theory", "oats.core", "oats.setup"];
const CAP_ROOT = join(PACKAGE_ROOT, CAPABILITY_PATH);
const THIS_FILE = fileURLToPath(import.meta.url);
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
function fingerprint(root) {
  return treeFiles(root).map((file) => {
    const path = join(root, file);
    return `${file}:${lstatSync(path).isSymbolicLink() ? `link:${readlinkSync(path)}` : createHash("sha256").update(readFileSync(path)).digest("hex")}`;
  });
}

// Fixture runs in a separate process: env is set BEFORE importing core (which
// freezes HOME-derived constants). No mutation of the test runner's environment,
// no inherited deployment, and no live runtime/timer even if launch:false regresses.
function fixtureEnv(base) {
  // Allow only process bootstrap/locale variables. In particular, never carry
  // provider credentials, runtime identity, NODE_OPTIONS or host config into it.
  const env = Object.fromEntries(["PATH", "SystemRoot", "ComSpec", "PATHEXT", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "SHELL"]
    .filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
  Object.assign(env, {
    HOME: join(base, "home"), OATS_HOME_DIR: join(base, "oats-state"),
    PI_CODING_AGENT_DIR: join(base, "pi-state"),
    XDG_CONFIG_HOME: join(base, "xdg-config"), XDG_DATA_HOME: join(base, "xdg-data"),
    XDG_STATE_HOME: join(base, "xdg-state"), XDG_CACHE_HOME: join(base, "xdg-cache"),
    XDG_RUNTIME_DIR: join(base, "xdg-runtime"),
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(base, "empty-gitconfig"),
    OATS_PACKAGE_CATALOG: join(base, "empty-catalog.json"),
    OATS_THEORY_FIXTURE: base,
  });
  mkdirSync(env.HOME, { recursive: true });
  write(env.GIT_CONFIG_GLOBAL, "");
  write(env.OATS_PACKAGE_CATALOG, '{"packages":{}}\n');
  const bin = join(base, "bin");
  // Runtimes need to exist for preflight, but MUST NOT be invoked. Blocking host
  // schedulers/backends as well makes accidental execution fail closed and visible.
  for (const name of ["pi", "claude", "tmux", "herdr", "launchctl", "systemctl", "crontab", "schtasks"]) {
    const path = join(bin, name);
    write(path, '#!/bin/sh\nprintf "%s\\n" "$0 $*" >> "$OATS_THEORY_FIXTURE/unexpected-exec"\nexit 97\n');
    chmodSync(path, 0o755);
  }
  env.PATH = `${bin}:${process.env.PATH}`;
  return env;
}

async function installedFixture() {
  const base = process.env.OATS_THEORY_FIXTURE;
  assert.ok(base && process.cwd() === base, "fixture must run only in its isolated cwd");
  const core = await import("@awebai/oats");
  const source = copyPackage(base);
  const sourceManifest = core.loadPackageManifestAt(source);
  assert.equal(sourceManifest.package, PACKAGE_META.package);
  assert.deepEqual(sourceManifest._capabilities.map((c) => c.id), PACKAGE_CAPABILITIES);
  for (const path of PACKAGE_META.capabilities) {
    core.assertCapabilitySelfContained(join(source, path), JSON.parse(readFileSync(join(source, path, "oats.json"))));
  }
  const scope = join(base, "scope");
  const root = join(scope, "agents");
  mkdirSync(root, { recursive: true });
  // The compatibility baseline requires a Git repo for checkout mode. An
  // unborn fixture is sufficient: never commit, switch branches or use worktrees.
  const initialized = spawnSync("git", ["init", "-q", scope], { encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);
  const configFile = join(scope, "oats-config.yaml");
  const config = "capabilities:\n  layers:\n    knowledge: none\n    messaging: none\n    tasks: none\n";
  write(configFile, config);
  core.acquirePackage(scope, source);
  assert.equal(readFileSync(configFile, "utf8"), config, "acquisition must not activate");
  assert.deepEqual(core.resolveOatsConfig(scope, "any").capabilities, []);
  assert.equal(core.findCapabilityAgent(scope, root, "knowledge-theory-expert"), undefined);
  const lock = JSON.parse(readFileSync(join(scope, "oats-lock.json"), "utf8"));
  assert.equal(lock.lockfileVersion, 2);
  assert.deepEqual(Object.keys(lock.packages), [PACKAGE_META.package]);
  assert.deepEqual(Object.keys(lock.capabilities).sort(), [...PACKAGE_CAPABILITIES].sort());
  assert.equal(lock.packages[PACKAGE_META.package].version, PACKAGE_META.version);
  const trust = core.capabilityTrust(scope, "oats.knowledge-theory");
  assert.equal(trust.trusted, true, JSON.stringify(trust));
  assert.deepEqual(trust.executableSurface, { commands: [], hooks: [], environment: [] });
  const installed = core.installedCapabilityDir(scope, "oats.knowledge-theory");
  const sourceSkill = join(source, CAPABILITY_PATH, SKILL_PATH);
  const skillFingerprint = fingerprint(sourceSkill);
  const coreSkillFingerprints = Object.fromEntries(["oats-operate", "oats-souls"].map(name =>
    [name, fingerprint(join(source, "capabilities/oats-core/skills", name))]));
  const installedFingerprint = fingerprint(installed);
  rmSync(source, { recursive: true });
  assert.ok(!existsSync(source));

  // Activate through fixture config and the real resolver (not a mocked
  // composition). Target an unrelated author; experts still carry their skill.
  write(configFile, config + "  additive:\n    oats.knowledge-theory:\n      from: installed\n      souls:\n        author: true\n    oats.core:\n      from: installed\n      souls:\n        knowledge-theory-expert: true\n");
  assert.deepEqual(core.resolveOatsConfig(scope, "author").capabilities.map((c) => c.id), ["oats.knowledge-theory"]);
  assert.equal(core.resolveOatsConfig(scope, "knowledge-theory-expert").layers.knowledge, undefined);
  const listed = core.listCapabilityAgents(scope);
  assert.deepEqual(listed.map((a) => a.name), ["knowledge-theory-expert"]);
  assert.deepEqual(listed.diagnostics, []);
  const agent = core.findCapabilityAgent(scope, root, "knowledge-theory-expert");
  assert.equal(agent.capability, "oats.knowledge-theory");
  assert.equal(agent._soulDir, join(installed, EXPERT_PATH));
  const homes = [];
  try {
    for (const runtime of ["pi", "claude"]) {
      const instance = core.spawnInstance(root, { ...agent, repo: scope }, {
        instance: `knowledge-theory-expert-${runtime}`, runtime, launch: false,
        task: "Explain adoption versus alternative theory from the packaged local authoring skill.",
        tmuxSession: "oats-theory-fixture-only",
      });
      homes.push(instance);
      const meta = JSON.parse(readFileSync(join(instance.home, "instance.json"), "utf8"));
      assert.equal(meta.launched, false);
      assert.equal(meta.work, "checkout");
      assert.equal(readlinkSync(join(instance.home, "CLAUDE.md")), "AGENTS.md");
      assert.equal(realpathSync(join(instance.home, "soul")), realpathSync(agent._soulDir));
      assert.deepEqual(meta.skills.map((s) => s.name).sort(), ["knowledge-capability-authoring", "oats", "oats-config", "oats-operate", "oats-packages", "oats-souls"]);
      for (const [name, expected] of Object.entries(coreSkillFingerprints)) {
        assert.deepEqual(fingerprint(join(instance.home, ".agents/skills", name)), expected, `source-independent core skill: ${name}`);
      }
      const materializedSkill = join(instance.home, ".agents/skills/knowledge-capability-authoring");
      assert.deepEqual(fingerprint(materializedSkill), skillFingerprint, "complete source-independent skill copy");
      assert.equal(checkReferenceClosure(materializedSkill).length, 9);
      assert.equal(realpathSync(join(instance.home, ".claude/skills")), realpathSync(join(instance.home, ".agents/skills")));
      for (const absent of ["STATE.md", "notes", "log.md", "soul/knowledge"]) {
        assert.ok(!existsSync(join(instance.home, absent)), `knowledge none must not create ${absent}`);
      }
      assert.ok(!meta.capabilities.some((c) => c.id === "oats.okf"));
      const instructions = readFileSync(join(instance.home, "AGENTS.md"), "utf8");
      assert.match(instructions, /knowledge-capability-authoring\/SKILL\.md/);
      assert.match(instructions, /oats:capability:oats\.core/);
      assert.match(instructions, /Load the oats-operate skill/);
      const expertInstructions = readFileSync(join(installed, EXPERT_PATH, "AGENTS.md"), "utf8");
      assert.ok(instructions.includes(expertInstructions.trim()), "canonical expert instructions were composed");
      assert.doesNotMatch(expertInstructions, /\.\/work\/docs|https?:\/\//, "expert curriculum does not reach into a checkout or mutable web docs");
    }
  } finally {
    for (const instance of homes) {
      core.retireInstance(root, instance.instance, { home: instance.home, tmuxSession: "oats-theory-fixture-only" });
      assert.ok(!existsSync(instance.home), "scaffold-only expert retired");
    }
  }
  assert.deepEqual(fingerprint(installed), installedFingerprint, "scaffold/retire does not mutate packaged soul/curriculum");

  // Real composition with an alternative theory; no automatic reference
  // injection, judge, OKF dependency or forced runtime convention is allowed.
  const alternative = join(scope, ".agents/capabilities/owned/alternative");
  write(join(alternative, "oats.json"), JSON.stringify({ capability: "example.alternative", version: "1.0.0", description: "Fixture alternative knowledge model", layer: "knowledge", inject: "alternative.md" }));
  write(join(alternative, "alternative.md"), "## Alternative fixture model\n\nUse only the selected native retrieval contract. No promotion judge is defined.\n");
  const soul = join(root, "worker/soul");
  write(join(soul, "soul.yaml"), "name: worker\nkind: persistent\nwork: checkout\n");
  write(join(soul, "AGENTS.md"), "# Worker fixture\n");
  symlinkSync("AGENTS.md", join(soul, "CLAUDE.md"));
  const alternativeConfig = "capabilities:\n  layers:\n    knowledge:\n      capability: example.alternative\n      from: owned\n      global: true\n    messaging: none\n    tasks: none\n";
  const runWorker = (suffix) => {
    const worker = core.findAgent(root, "worker");
    const instance = core.spawnInstance(root, { ...worker, repo: scope }, { instance: `worker-${suffix}`, runtime: "pi", launch: false });
    try {
      const text = readFileSync(join(instance.home, "AGENTS.md"), "utf8");
      assert.match(text, /Alternative fixture model/);
      assert.doesNotMatch(text, /durable AND|promotion bar|Knowledge theory expert|oats:capability:oats\.knowledge-theory/i);
      const selected = core.resolveOatsConfig(scope, "worker");
      assert.equal(selected.layers.knowledge.id, "example.alternative");
      assert.ok(!existsSync(join(instance.home, ".agents/skills/memory-harvest")));
      return text;
    } finally {
      core.retireInstance(root, instance.instance, { home: instance.home });
      assert.ok(!existsSync(instance.home));
    }
  };
  write(configFile, alternativeConfig + "  additive:\n    oats.knowledge-theory:\n      from: installed\n      global: true\n");
  const withAuthoring = runWorker("with-authoring");
  write(configFile, alternativeConfig);
  const withoutAuthoring = runWorker("without-authoring");
  assert.equal(withAuthoring, withoutAuthoring, "adding the theory skill must not inject runtime policy");
  assert.ok(!existsSync(join(base, "unexpected-exec")), "no runtime, backend or host scheduler was invoked");
  assert.notEqual(spawnSync("git", ["-C", scope, "rev-parse", "--verify", "HEAD"]).status, 0, "fixture never creates commits");
  console.log(JSON.stringify({ ok: true, acquired: true, sourceRemoved: true, scaffoldedAndRetired: ["pi", "claude"], alternativeIsolated: true, liveLaunches: 0 }));
}

if (process.argv.includes("--isolated-fixture")) {
  await installedFixture();
} else {
  test("framework distribution validates theory plus core/setup resource-only manifests and skill inventory", () => {
    assert.deepEqual(checkKnowledgeTheoryPackage(), { ok: true, package: PACKAGE_META.package, version: PACKAGE_META.version, references: 8 });
    // The isolated acquisition test also runs the kernel's real manifest and
    // self-containment validators. No schema-only or string-only acceptance.
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

  test("actual acquire/activate/discover, source-free pi and Claude scaffolds, retire and alternative policy isolation", { timeout: 120_000 }, (t) => {
    const base = temp(t);
    const beforeEnv = { ...process.env };
    const result = spawnSync(process.execPath, [THIS_FILE, "--isolated-fixture"], {
      cwd: base, env: fixtureEnv(base), encoding: "utf8", timeout: 110_000,
    });
    assert.deepEqual({ ...process.env }, beforeEnv, "parent environment is unchanged");
    assert.equal(result.status, 0, `${result.error || ""}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /"sourceRemoved":true/);
    assert.match(result.stdout, /"alternativeIsolated":true/);
    assert.ok(!existsSync(join(base, "unexpected-exec")), "blocked executables must never be invoked");
  });
}
