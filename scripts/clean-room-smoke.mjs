#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// Test-driver helpers only. Runtime imports resolve against installed bytes.
// The optional Git payload is copied once into an isolated fixture repository;
// all post-acquisition curriculum reads use installed bytes after its deletion.
import { CAPABILITY_PATH, EXPERT_PATH, SKILL_PATH, checkKnowledgeTheoryPackage, checkReferenceClosure, treeFiles } from "./check-knowledge-theory-package.mjs";
import { checkJavaScript, checkKernelPackFiles } from "./check-package-dry-runs.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const room = mkdtempSync(join(tmpdir(), "oats-packed-smoke-"));
const keep = process.env.OATS_KEEP_SMOKE === "1";
const run = (command, args, options = {}) => execFileSync(command, args, {
  encoding: "utf8", stdio: options.capture ? ["ignore", "pipe", "pipe"] : "ignore", ...options,
});
const write = (path, content) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); };

function pack(cwd, destination) {
  const output = run("npm", ["pack", "--json", "--pack-destination", destination], { cwd, capture: true });
  const parsed = JSON.parse(output);
  if (parsed.length !== 1) throw new Error(`unexpected npm pack output from ${cwd}`);
  if (cwd === repo) checkKernelPackFiles(parsed[0]);
  return join(destination, parsed[0].filename);
}
function gitRepo(path) {
  mkdirSync(path, { recursive: true });
  run("git", ["init", "-q", path]);
  run("git", ["-C", path, "config", "user.name", "OATS Smoke"]);
  run("git", ["-C", path, "config", "user.email", "smoke@example.invalid"]);
  write(join(path, ".gitignore"), "\n");
  run("git", ["-C", path, "add", "."]);
  run("git", ["-C", path, "commit", "-qm", "smoke fixture"]);
}

try {
  const app = join(room, "app");
  const kernelRoot = join(app, "node_modules", "@awebai", "oats");
  const adapterRoot = join(app, "node_modules", "@awebai", "oats-pi");
  const oats = join(app, "node_modules", ".bin", "oats");
  const catalog = join(room, "catalog.json");
  const home = join(room, "home"); const fakeBin = join(room, "bin"); mkdirSync(home); mkdirSync(fakeBin);
  for (const name of ["pi", "claude", "codex", "tmux", "herdr", "launchctl", "systemctl", "crontab", "schtasks"]) {
    write(join(fakeBin, name), '#!/bin/sh\nprintf "%s\\n" "$0 $*" >> "$OATS_SMOKE_UNEXPECTED_EXEC"\nexit 97\n');
    chmodSync(join(fakeBin, name), 0o755);
  }

  // No inherited instance identity, provider credentials, custom native roots,
  // scheduler config, npm/node hooks or real user Git configuration. Set this
  // BEFORE any npm/git command and before importing the installed kernel.
  const env = Object.fromEntries(["PATH", "SystemRoot", "ComSpec", "PATHEXT", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL"]
    .filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
  Object.assign(env, {
    HOME: home, SHELL: "/bin/sh",
    OATS_HOME_DIR: join(home, ".oats"),
    OATS_PKG_ROOT: kernelRoot,
    OATS_PACKAGE_CATALOG: catalog,
    OATS_SMOKE_UNEXPECTED_EXEC: join(room, "unexpected-exec"),
    CLAUDE_CONFIG_DIR: join(home, ".claude"), PI_CODING_AGENT_DIR: join(home, ".pi/agent"), CODEX_HOME: join(home, ".codex"),
    XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, ".local/share"),
    XDG_STATE_HOME: join(home, ".local/state"), XDG_CACHE_HOME: join(home, ".cache"), XDG_RUNTIME_DIR: join(home, "run"),
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(home, "empty-gitconfig"),
    PATH: `${fakeBin}:${dirname(oats)}:${process.env.PATH}`,
  });
  write(env.GIT_CONFIG_GLOBAL, "");
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);

  const tarballs = join(room, "tarballs"); mkdirSync(tarballs);
  const kernelTgz = pack(repo, tarballs);
  const adapterTgz = pack(join(repo, "packages", "pi"), tarballs);

  mkdirSync(app);
  write(join(app, "package.json"), JSON.stringify({ name: "oats-clean-room", private: true, type: "module" }, null, 2));
  run("npm", ["install", "--ignore-scripts", "--legacy-peer-deps", "--no-audit", "--no-fund", kernelTgz, adapterTgz], { cwd: app });

  for (const path of [join(kernelRoot, "lib", "core.mjs"), join(kernelRoot, "capabilities", "oats-okf", "oats.json"), join(adapterRoot, "extension", "index.ts"), oats]) {
    if (!existsSync(path)) throw new Error(`packed install missing ${path}`);
  }
  if (kernelRoot.startsWith(repo) || adapterRoot.startsWith(repo)) throw new Error("smoke install did not leave the checkout");
  const installedJsChecked = checkJavaScript(kernelRoot);
  run(process.execPath, ["--check", join(adapterRoot, "extension/core-loader.mjs")]);
  run(process.execPath, ["--experimental-strip-types", "--check", join(adapterRoot, "extension/index.ts")]);

  // After npm dependency installation, enforce offline Git acquisition.
  env.GIT_ALLOW_PROTOCOL = process.env.GIT_ALLOW_PROTOCOL = "file";
  assert.ok(!existsSync(join(kernelRoot, "oats-package")), "npm kernel must not ship a partial Git-only optional package");
  // Without a bound catalog, `oats init` resolves
  // its official layers through the real published catalog and fetches over
  // the wire: a release machine behind a firewall would fail this smoke and
  // the failure would look like a packaging defect. So the room publishes its
  // own official package — the PACKED kernel's own bundled oats.okf, wrapped in
  // a distribution manifest inside a local Git repository — and a catalog
  // naming it. The materialization route is exercised for real, offline.
  //
  // Wrapping the bundled tree is only honest while the bundled tree IS the
  // published payload. That parity was established by comparing the bundled
  // trees byte for byte against the catalog-pinned payloads when they were
  // synced; NOTHING here re-establishes it, and this check must not be read as
  // doing so. Version equality is a weak signal on its own — the bundled
  // oats.okf this replaced also claimed 1.4.1 while differing in content.
  //
  // What this check catches is exactly VERSION drift: the bundled manifest
  // claiming a version the catalog does not pin. It is checked HERE, against
  // the packed artifact, before anything is built on it. The architectural
  // violation that made the old copy wrong — reaching into the kernel — is
  // caught by the no-private-import assertion in test/capabilities.test.mjs,
  // not by this.
  const officialRepo = join(room, "official", "oats-okf");
  const payload = join(officialRepo, "oats-package");
  const packedCatalog = JSON.parse(readFileSync(join(kernelRoot, "package-catalog.json"), "utf8"));
  const pinnedRef = packedCatalog.packages?.["oats.okf"]?.ref;
  if (!pinnedRef) throw new Error("packed package-catalog.json does not pin a ref for oats.okf");
  const pinnedVersion = String(pinnedRef).replace(/^v/, "");
  const bundledVersion = JSON.parse(readFileSync(join(kernelRoot, "capabilities", "oats-okf", "oats.json"), "utf8")).version;
  if (bundledVersion !== pinnedVersion) {
    throw new Error(`bundled capabilities/oats-okf claims version ${bundledVersion} but package-catalog.json pins oats.okf at ${pinnedRef} — resync the bundled tree from the pinned payload, or move the pin`);
  }
  write(join(payload, "oats-package.json"), JSON.stringify({
    package: "oats.okf", version: pinnedVersion, description: "clean-room official oats.okf",
    compatibility: { oats: ">=0.1.0" }, capabilities: ["capabilities/oats-okf"],
  }, null, 2));
  cpSync(join(kernelRoot, "capabilities", "oats-okf"), join(payload, "capabilities", "oats-okf"), { recursive: true });
  gitRepo(officialRepo);
  write(catalog, JSON.stringify({ packages: { "oats.okf": { url: `file://${officialRepo}`, path: "oats-package" } }, capabilities: {} }, null, 2));

  const adapterLoader = await import(pathToFileURL(join(adapterRoot, "extension", "core-loader.mjs")).href);
  if (adapterLoader.OATS_PKG_ROOT !== kernelRoot) throw new Error("packed pi adapter did not resolve packed kernel");
  const kernelPackage = JSON.parse(readFileSync(join(kernelRoot, "package.json"), "utf8"));
  if (adapterLoader.kernelVersion() !== kernelPackage.version) throw new Error("packed adapter/kernel version mismatch");
  const core = await import(pathToFileURL(join(kernelRoot, "lib", "core.mjs")).href);

  const workspace = join(room, "workspace"); const agentsRoot = join(workspace, "agents");
  const modernRepo = join(workspace, "modern"); gitRepo(modernRepo); mkdirSync(agentsRoot, { recursive: true });
  run(oats, ["init", "--raw", "--knowledge", "oats.okf", "--no-tmux-mouse", "--dir", modernRepo], { env });
  const initConfig = readFileSync(join(modernRepo, "oats-config.yaml"), "utf8");
  if (!/oats\.okf/.test(initConfig)) throw new Error("packed oats init did not activate declared knowledge package");

  // What a fresh deployment must look like, checked from the PACKED kernel:
  // a capability-materialization lock, a flat artifact, no package store, no
  // v1 residue, and nothing trusted at acquisition.
  const initLock = JSON.parse(readFileSync(join(modernRepo, "oats-lock.json"), "utf8"));
  if (initLock.lockfileVersion !== 2) throw new Error(`fresh init wrote lockfileVersion ${initLock.lockfileVersion}`);
  if (!initLock.packages || !initLock.capabilities) throw new Error("fresh lock is missing a required top-level map");
  if (initLock.capabilities["oats.okf"]?.package !== "oats.okf") throw new Error("capability row lost its provider back-reference");
  if (initLock.capabilities["oats.okf"].trusted !== false) throw new Error("acquisition granted executable trust");
  for (const retired of ["capabilities", "trustedCapabilities", "depsIntegrity"]) {
    if (Object.hasOwn(initLock.packages["oats.okf"], retired)) throw new Error(`package row carries retired key "${retired}"`);
  }
  if (!existsSync(join(modernRepo, ".agents", "capabilities", "installed", "oats.okf", "oats.json"))) throw new Error("capability was not materialized flat");
  if (existsSync(join(modernRepo, ".agents", "packages"))) throw new Error("a package store was materialized");
  if (!/installed/.test(readFileSync(join(modernRepo, ".agents", "capabilities", ".gitignore"), "utf8"))) throw new Error("materialized artifacts were not ignored");
  // And the packed doctor must not greet a deployment created seconds ago with
  // a migration: that regression shipped through 0.19.4.
  const freshDoctor = JSON.parse(run(oats, ["doctor", modernRepo, "--json"], { env, capture: true }));
  if (freshDoctor.lockError) throw new Error(`fresh scope has a lock the kernel refuses: ${freshDoctor.lockError.message}`);
  if (freshDoctor.legacyLockFiles.length || freshDoctor.officialMigration) throw new Error("packed doctor asked a fresh deployment to migrate");

  core.createAgent(agentsRoot, { name: "probe", repo: modernRepo, work: "checkout", runtime: "pi", instructions: "# Packed probe\n\nCanonical instructions.\n" });
  const agent = core.findAgent(agentsRoot, "probe");
  write(join(agent._dir, "soul", "skills", "private", "SKILL.md"), "---\nname: private\ndescription: Packed private smoke skill.\n---\n# Private\n");
  const canonical = readFileSync(join(agent._dir, "soul", "AGENTS.md"), "utf8");
  const spawned = core.spawnInstance(agentsRoot, agent, { instance: "probe-packed", repo: modernRepo, launch: false });
  const meta = JSON.parse(readFileSync(join(spawned.home, "instance.json"), "utf8"));
  const skills = readdirSync(join(spawned.home, ".agents", "skills")).sort();
  if (JSON.stringify(skills) !== JSON.stringify(["memory-harvest", "oats", "oats-config", "oats-packages", "okf", "private"])) throw new Error(`unexpected packed skills: ${skills.join(", ")}`);
  if (lstatSync(join(spawned.home, "AGENTS.md")).isSymbolicLink()) throw new Error("instance AGENTS.md was not generated");
  if (readlinkSync(join(spawned.home, "CLAUDE.md")) !== "AGENTS.md") throw new Error("instance CLAUDE.md is not canonical");
  if (readFileSync(join(agent._dir, "soul", "AGENTS.md"), "utf8") !== canonical) throw new Error("spawn mutated packed canonical soul");
  if (!meta.capabilities.some((cap) => cap.id === "oats.okf") || !/--skill /.test(meta.command)) throw new Error("packed instance metadata/isolation missing");
  const doctor = JSON.parse(run(oats, ["doctor", modernRepo, "--soul", "probe", "--json"], { env: { ...env, PI_AGENTS_ROOT: agentsRoot }, capture: true }));
  if (!doctor.composedInstructions.includes("Canonical instructions") || !doctor.composedInstructions.includes("Knowledge: OKF")) throw new Error("packed doctor composition incomplete");
  core.retireInstance(agentsRoot, spawned.instance);
  if (existsSync(spawned.home)) throw new Error("packed probe did not retire cleanly");

  // Optional theory uses a DIFFERENT release channel: the exact self-contained
  // Git payload, not an npm copy with its source CLAUDE.md symlink missing.
  // Copy the whole candidate payload verbatim, record it only in an isolated
  // Git fixture, and acquire via the installed CLI's normal direct/catalog
  // paths. No alias synthesis or generic integrity exception is permissible.
  checkKnowledgeTheoryPackage({ repoRoot: repo });
  const theoryRepo = join(room, "official", "knowledge-theory");
  const theorySource = join(theoryRepo, "oats-package");
  cpSync(join(repo, "oats-package"), theorySource, { recursive: true, verbatimSymlinks: true });
  checkKnowledgeTheoryPackage({ packageRoot: theorySource, parity: false });
  gitRepo(theoryRepo);
  const theoryCommit = run("git", ["-C", theoryRepo, "rev-parse", "HEAD"], { capture: true }).trim();
  const aliasPath = `oats-package/${CAPABILITY_PATH}/${EXPERT_PATH}/CLAUDE.md`;
  assert.match(run("git", ["-C", theoryRepo, "ls-tree", theoryCommit, "--", aliasPath], { capture: true }), /^120000 blob /, "Git payload must track the source alias as a symlink");
  assert.equal(run("git", ["-C", theoryRepo, "show", `${theoryCommit}:${aliasPath}`], { capture: true }), "AGENTS.md");
  const theoryUrl = pathToFileURL(theoryRepo).href;
  const directTheorySource = `${theoryUrl}@${theoryCommit}`; // normal default oats-package/ selection
  const fixtureCatalog = JSON.parse(readFileSync(catalog, "utf8"));
  fixtureCatalog.packages["oats.knowledge-theory"] = { url: theoryUrl, ref: theoryCommit, path: "oats-package" };
  write(catalog, JSON.stringify(fixtureCatalog));
  const theoryCap = join(theorySource, CAPABILITY_PATH);
  const theorySkill = join(theoryCap, SKILL_PATH);
  const expectedClosure = checkReferenceClosure(theorySkill);
  const canonicalRefs = ["knowledge-capability-authoring.md", ...treeFiles(join(kernelRoot, "docs/knowledge-reference")).map((f) => `knowledge-reference/${f}`)];
  assert.deepEqual(treeFiles(join(theorySkill, "references")), canonicalRefs.sort());
  for (const file of canonicalRefs) assert.ok(readFileSync(join(kernelRoot, "docs", file)).equals(readFileSync(join(theorySkill, "references", file))), `packed reference drift: ${file}`);
  const fingerprint = (root) => treeFiles(root).map((file) => {
    const path = join(root, file);
    return `${file}:${lstatSync(path).isSymbolicLink() ? `link:${readlinkSync(path)}` : createHash("sha256").update(readFileSync(path)).digest("hex")}`;
  });
  const skillFingerprint = fingerprint(theorySkill);
  const capFingerprint = fingerprint(theoryCap);
  const expertInstructions = readFileSync(join(theoryCap, EXPERT_PATH, "AGENTS.md"), "utf8");
  assert.equal(readlinkSync(join(theoryCap, EXPERT_PATH, "CLAUDE.md")), "AGENTS.md");
  const theoryManifest = core.loadPackageManifestAt(theorySource);
  assert.equal(theoryManifest.package, "oats.knowledge-theory");
  assert.deepEqual(theoryManifest._capabilities.map((c) => c.id), ["oats.knowledge-theory"]);
  core.assertCapabilitySelfContained(theoryCap, JSON.parse(readFileSync(join(theoryCap, "oats.json"), "utf8")));
  const disabled = "capabilities:\n  layers:\n    knowledge: none\n    messaging: none\n    tasks: none\n";
  const theoryScopes = [];
  for (const work of ["checkout", "directory"]) {
    const scope = join(room, `theory-${work}`);
    if (work === "checkout") gitRepo(scope);
    else mkdirSync(scope);
    const roots = join(scope, "agents"); mkdirSync(roots);
    const config = join(scope, "oats-config.yaml"); write(config, disabled);
    const source = work === "checkout" ? directTheorySource : "oats.knowledge-theory";
    run(oats, ["install", source, "--dir", scope], { env });
    assert.equal(readFileSync(config, "utf8"), disabled, "acquisition must not activate the package");
    assert.deepEqual(core.resolveOatsConfig(scope, "author").capabilities, []);
    assert.equal(core.findCapabilityAgent(scope, roots, "knowledge-theory-expert"), undefined);
    const lock = JSON.parse(readFileSync(join(scope, "oats-lock.json"), "utf8"));
    assert.equal(lock.lockfileVersion, 2);
    assert.deepEqual(Object.keys(lock.packages), ["oats.knowledge-theory"]);
    assert.deepEqual(Object.keys(lock.capabilities), ["oats.knowledge-theory"]);
    const packageRow = lock.packages["oats.knowledge-theory"];
    assert.equal(packageRow.commit, theoryCommit, "normal Git acquisition exact-locks the fixture commit");
    assert.equal(packageRow.path, "oats-package");
    assert.equal(packageRow.source, work === "checkout" ? `git:${directTheorySource}` : "catalog:oats.knowledge-theory");
    assert.equal(packageRow.version, theoryManifest.version);
    assert.match(packageRow.integrity, /^sha256-/);
    const installed = core.installedCapabilityDir(scope, "oats.knowledge-theory");
    const provenance = JSON.parse(readFileSync(join(installed, ".oats-installation.json"), "utf8"));
    assert.equal(provenance.commit, theoryCommit);
    assert.deepEqual(fingerprint(installed).filter((row) => !row.startsWith(".oats-installation.json:")), capFingerprint, "Git acquisition preserves the full capability including the source alias");
    const trust = core.capabilityTrust(scope, "oats.knowledge-theory");
    assert.equal(trust.trusted, true, "non-executable capability needs integrity, not approval");
    assert.deepEqual(trust.executableSurface, { commands: [], hooks: [], environment: [] });
    run(oats, ["use", "oats.knowledge-theory", "--soul", "author", "--dir", scope], { env });
    assert.deepEqual(core.resolveOatsConfig(scope, "author").capabilities.map((cap) => cap.id), ["oats.knowledge-theory"]);
    const listed = core.listCapabilityAgents(scope);
    assert.deepEqual(listed.map((a) => a.name), ["knowledge-theory-expert"]);
    assert.deepEqual(listed.diagnostics, []);
    const expert = core.findCapabilityAgent(scope, roots, "knowledge-theory-expert");
    assert.equal(expert.capability, "oats.knowledge-theory");
    theoryScopes.push({ scope, roots, config, expert, work });
  }
  // Remove the entire fixture checkout AND its Git database. All subsequent
  // resolution, scaffolding and reference traversal must use installed bytes.
  rmSync(theoryRepo, { recursive: true });
  assert.ok(!existsSync(theoryRepo));
  assert.ok(!existsSync(theorySource));
  const theoryProbes = [];
  for (const { scope, roots, config, expert, work } of theoryScopes) {
    const installed = core.installedCapabilityDir(scope, "oats.knowledge-theory");
    const before = fingerprint(installed);
    assert.ok(lstatSync(join(installed, EXPERT_PATH, "CLAUDE.md")).isSymbolicLink());
    assert.equal(readlinkSync(join(installed, EXPERT_PATH, "CLAUDE.md")), "AGENTS.md", "installed source alias survives Git transport and source deletion");
    assert.equal(core.capabilityTrust(scope, "oats.knowledge-theory").trusted, true, "source-free artifact still passes ordinary integrity checks");
    assert.deepEqual(checkReferenceClosure(join(installed, SKILL_PATH)), expectedClosure);
    for (const runtime of ["pi", "claude"]) {
      const instance = core.spawnInstance(roots, { ...expert, repo: scope }, {
        instance: `knowledge-theory-expert-${runtime}`, runtime, work, launch: false,
        task: "Explain adoption versus alternative theory using only the packaged curriculum.",
      });
      try {
        const meta = JSON.parse(readFileSync(join(instance.home, "instance.json"), "utf8"));
        assert.equal(meta.launched, false);
        assert.equal(meta.work, work);
        assert.equal(readlinkSync(join(instance.home, "CLAUDE.md")), "AGENTS.md");
        const materialized = join(instance.home, ".agents", SKILL_PATH);
        assert.deepEqual(fingerprint(materialized), skillFingerprint, "complete packed skill materialized without a source");
        assert.deepEqual(checkReferenceClosure(materialized), expectedClosure);
        assert.deepEqual(meta.skills.map((s) => s.name).sort(), ["knowledge-capability-authoring", "oats", "oats-config", "oats-packages"]);
        const text = readFileSync(join(instance.home, "AGENTS.md"), "utf8");
        assert.ok(text.includes(expertInstructions.trim()));
        assert.ok(!meta.capabilities.some((c) => c.id === "oats.okf"));
        for (const absent of ["STATE.md", "notes", "log.md", "soul/knowledge"]) assert.ok(!existsSync(join(instance.home, absent)), `knowledge none created ${absent}`);
      } finally {
        core.retireInstance(roots, instance.instance, { home: instance.home });
        assert.ok(!existsSync(instance.home), "packed expert did not retire");
      }
      theoryProbes.push(`${work}/${runtime}`);
    }
    assert.deepEqual(fingerprint(installed), before, "scaffold/retire mutated the installed expert");

    // Globally enabling authoring resources must NOT inject reference theory
    // into an ordinary worker. Knowledge runtime remains capability-owned.
    const alternative = join(scope, ".agents/capabilities/owned/alternative");
    write(join(alternative, "oats.json"), JSON.stringify({ capability: "example.alternative", version: "1.0.0", description: "Packed smoke alternative", layer: "knowledge", inject: "alternative.md" }));
    write(join(alternative, "alternative.md"), "## Alternative fixture model\n\nUse the selected native retrieval contract.\n");
    core.createAgent(roots, { name: "worker", repo: scope, work, runtime: "pi", instructions: "# Worker\n" });
    const worker = core.findAgent(roots, "worker");
    const alternativeConfig = "capabilities:\n  layers:\n    knowledge:\n      capability: example.alternative\n      from: owned\n      global: true\n    messaging: none\n    tasks: none\n";
    const composed = [];
    for (const additive of [true, false]) {
      write(config, alternativeConfig + (additive ? "  additive:\n    oats.knowledge-theory:\n      from: installed\n      global: true\n" : ""));
      const instance = core.spawnInstance(roots, worker, { instance: `worker-${additive}`, work, launch: false });
      try {
        const text = readFileSync(join(instance.home, "AGENTS.md"), "utf8");
        assert.match(text, /Alternative fixture model/);
        assert.doesNotMatch(text, /Knowledge theory expert|Knowledge: OKF|oats:capability:oats\.knowledge-theory/);
        composed.push(text);
      } finally { core.retireInstance(roots, instance.instance, { home: instance.home }); }
      assert.ok(!existsSync(instance.home));
    }
    assert.equal(composed[0], composed[1], "optional theory injected mandatory policy");
  }
  assert.ok(!existsSync(env.OATS_SMOKE_UNEXPECTED_EXEC), "a runtime/backend/host scheduler was invoked");

  console.log(JSON.stringify({
    passed: true,
    kernelTarball: basename(kernelTgz), adapterTarball: basename(adapterTgz),
    initDoctor: true, exactSkills: skills, canonicalSoulUnchanged: true,
    offlineOfficialCatalog: true, freshInitMaterialized: true, nothingToMigrate: true,
    adapterResolvedPackedKernel: true, cleanContractConfigAndSpawn: true, installedJsChecked,
    optionalTheory: { excludedFromNpm: true, acquiredFromGitFixture: true, acquisitionRoutes: ["direct-git", "catalog-git"],
      exactCommit: theoryCommit, sourceRemoved: true, references: expectedClosure.length - 1,
      trackedSourceAliasPreserved: true, generatedAliases: true, scaffoldedAndRetired: theoryProbes, alternativeIsolated: true, liveLaunches: 0 },
    bundledOkfVersion: bundledVersion, catalogOkfRef: pinnedRef,
  }, null, 2));
} finally {
  if (keep) console.error(`OATS_KEEP_SMOKE=1: retained ${room}`);
  else rmSync(room, { recursive: true, force: true });
}
