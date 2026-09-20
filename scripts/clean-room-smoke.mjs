#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// Test-driver helpers only. Runtime imports resolve against installed bytes.
// The optional Git payload is copied once into an isolated fixture repository;
// all post-acquisition curriculum reads use installed bytes after its deletion.
import { CAPABILITY_PATH, EXPERT_PATH, SKILL_PATH, checkKnowledgeTheoryPackage, checkReferenceClosure, treeFiles } from "./check-knowledge-theory-package.mjs";
import { checkJavaScript, checkKernelPackFiles, checkNpmOkfPayload } from "./check-package-dry-runs.mjs";
import { checkOkfMirror, checkOkfPayload, materializeOkfGitPayload, payloadEntries } from "./check-okf-mirror.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const room = realpathSync(mkdtempSync(join(tmpdir(), "oats-packed-smoke-")));
const keep = process.env.OATS_KEEP_SMOKE === "1";
const run = (command, args, options = {}) => execFileSync(command, args, {
  encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 120_000, stdio: options.capture ? ["ignore", "pipe", "pipe"] : "ignore", ...options,
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
  const unexpectedExec = join(room, "unexpected-exec");
  const statusProbes = join(room, "stubbed-status-probes");
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  for (const name of ["pi", "claude", "codex", "tmux", "herdr", "gh", "launchctl", "systemctl", "crontab", "schtasks"]) {
    // Public CLI discovery can query session/timer status even for no-launch.
    // Answer only those read-only probes locally (inactive); every other
    // invocation still fails the no-runtime/no-host-mutation marker. Embed the
    // paths: capability cleanEnv intentionally strips arbitrary OATS_* vars.
    const status = name === "tmux" ? '[ "$1" = has-session ]'
      : name === "launchctl" ? '[ "$1" = print ]'
      : name === "systemctl" ? '[ "$1" = --user ] && [ "$2" = is-active ]' : "false";
    write(join(fakeBin, name), `#!/bin/sh\nif ${status}; then\n  printf "%s\\n" "$0 $*" >> ${quote(statusProbes)}\n  exit 1\nfi\nprintf "%s\\n" "$0 $*" >> ${quote(unexpectedExec)}\nexit 97\n`);
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
    OATS_SMOKE_UNEXPECTED_EXEC: unexpectedExec,
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
  // npm intentionally omits source symlinks. Its regular bytes must match the
  // checked-in standalone inventory, but it is NOT a self-contained OKF Git
  // distribution. Materialize the actual verified source payload instead;
  // never wrap an npm copy, invent wrapper bytes or synthesize CLAUDE.md.
  const inventory = checkOkfMirror({ repoRoot: repo });
  const npmOkf = checkNpmOkfPayload(join(kernelRoot, "capabilities/oats-okf"), inventory);
  const officialRepo = join(room, "official", "oats-okf");
  const payload = join(officialRepo, "oats-package");
  materializeOkfGitPayload(payload, { repoRoot: repo });
  checkOkfPayload(join(payload, "capabilities/oats-okf"), inventory);
  assert.equal(readFileSync(join(payload, "oats-package.json"), "utf8"), inventory.distributionManifestText);
  assert.equal(readFileSync(join(payload, "LICENSE"), "utf8"), inventory.distributionLicenseText);
  const packedCatalog = JSON.parse(readFileSync(join(kernelRoot, "package-catalog.json"), "utf8"));
  const pinnedRef = packedCatalog.packages?.["oats.okf"]?.ref;
  const bundledVersion = JSON.parse(readFileSync(join(kernelRoot, "capabilities/oats-okf/oats.json"), "utf8")).version;
  assert.equal(pinnedRef, `v${bundledVersion}`, "npm mirror and official catalog version drift");
  assert.equal(bundledVersion, "2.1.2");
  gitRepo(officialRepo);
  const okfCommit = run("git", ["-C", officialRepo, "rev-parse", "HEAD"], { capture: true }).trim();
  const okfAlias = "agents/memory-harvest/CLAUDE.md";
  const trackedAlias = `oats-package/capabilities/oats-okf/${okfAlias}`;
  assert.match(run("git", ["-C", officialRepo, "ls-tree", okfCommit, "--", trackedAlias], { capture: true }), /^120000 blob /);
  assert.equal(run("git", ["-C", officialRepo, "show", `${okfCommit}:${trackedAlias}`], { capture: true }), "AGENTS.md");
  write(catalog, JSON.stringify({ packages: { "oats.okf": { url: pathToFileURL(officialRepo).href, ref: okfCommit, path: "oats-package" } }, capabilities: {} }, null, 2));

  const adapterLoader = await import(pathToFileURL(join(adapterRoot, "extension", "core-loader.mjs")).href);
  if (adapterLoader.OATS_PKG_ROOT !== kernelRoot) throw new Error("packed pi adapter did not resolve packed kernel");
  const kernelPackage = JSON.parse(readFileSync(join(kernelRoot, "package.json"), "utf8"));
  if (adapterLoader.kernelVersion() !== kernelPackage.version) throw new Error("packed adapter/kernel version mismatch");
  // Resolve the installed public export, not a private kernel filesystem path.
  const installedRequire = createRequire(join(app, "package.json"));
  assert.equal(installedRequire.resolve("@awebai/oats/package.json"), join(kernelRoot, "package.json"));
  const core = await import(pathToFileURL(installedRequire.resolve("@awebai/oats")).href);

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

  const installedOkf = core.installedCapabilityDir(modernRepo, "oats.okf");
  assert.equal(JSON.parse(readFileSync(join(installedOkf, "oats.json"), "utf8")).hooks.spawn.required, true);
  // Installed acquisition adds only its provenance file; the source gate owns
  // all source bytes, including the relative compatibility alias.
  const checkInstalledOkf = () => {
    const entries = payloadEntries(installedOkf);
    const provenance = entries.filter((entry) => entry.path === ".oats-installation.json");
    assert.equal(provenance.length, 1);
    assert.equal(provenance[0].type, "file");
    assert.equal(JSON.parse(readFileSync(join(installedOkf, ".oats-installation.json"), "utf8")).commit, okfCommit);
    assert.deepEqual(entries.filter((entry) => entry.path !== ".oats-installation.json"), inventory.entries,
      "installed Git source must match the entire inventory; only kernel-authored provenance is additional");
  };
  checkInstalledOkf();
  assert.equal(initLock.packages["oats.okf"].commit, okfCommit);
  assert.equal(initLock.packages["oats.okf"].path, "oats-package");
  assert.equal(initLock.packages["oats.okf"].source, "catalog:oats.okf");
  assert.ok(lstatSync(join(installedOkf, okfAlias)).isSymbolicLink());
  assert.equal(readlinkSync(join(installedOkf, okfAlias)), "AGENTS.md");
  rmSync(officialRepo, { recursive: true });
  assert.ok(!existsSync(officialRepo), "all OKF runtime work must survive source fixture removal");
  run(oats, ["trust", "oats.okf", "--dir", modernRepo], { env });
  assert.equal(core.capabilityTrust(modernRepo, "oats.okf").trusted, true);

  const bindings = join(room, "okf-bindings.json");
  const accepted = join(room, "accepted");
  write(bindings, JSON.stringify({ version: 1, stateDir: join(room, "okf-state"), bases: {
    project: { id: "smoke-base", kind: "directory", path: accepted },
  } }));
  // Explicit bindings and stable owner, not legacy implicit soul/knowledge.
  // Target the source soul so the independent service worker gets no source
  // memory policy. Setup never installs a host backend or starts a runtime.
  run(oats, ["use", "oats.okf", "--soul", "probe", "--settings", `bindings-file=${bindings}`, "--dir", modernRepo], { env });
  core.createAgent(agentsRoot, { name: "probe", repo: modernRepo, work: "checkout", runtime: "pi", instructions: "# Packed probe\n\nCanonical instructions.\n" });
  const agent = core.findAgent(agentsRoot, "probe");
  write(join(agent._dir, "soul", "okf.json"), JSON.stringify({ version: 1, owner: "smoke-owner", owns: ["project/expert"], reads: [] }));
  assert.ok(!existsSync(join(agent._dir, "soul", "knowledge")), "soul-scaffold must not create legacy knowledge");
  write(join(agent._dir, "soul", "skills", "private", "SKILL.md"), "---\nname: private\ndescription: Packed private smoke skill.\n---\n# Private\n");
  const canonical = readFileSync(join(agent._dir, "soul", "AGENTS.md"), "utf8");
  const nodes = join(room, "okf-nodes.json");
  write(nodes, JSON.stringify({ expert: { path: "expert", owner: "smoke-owner" } }));
  const cliEnv = { ...env, PI_AGENTS_ROOT: agentsRoot };
  const boundary = (args, cwd = modernRepo) => {
    // Scaffold-only probes have no harness to supply the normal launch identity.
    const identity = cwd === modernRepo ? {} : {
      OATS_INSTANCE: basename(cwd), OATS_INSTANCE_HOME: cwd,
      PI_AGENT_INSTANCE: basename(cwd), PI_AGENT_HOME: cwd,
    };
    const text = run(oats, args, { cwd, env: { ...cliEnv, ...identity }, capture: true });
    const answer = JSON.parse(text);
    assert.equal(answer.schemaVersion, 1, text);
    assert.equal(answer.ok, true, text);
    return answer.result;
  };
  assert.equal(boundary(["okf", "init", "--base", "project", "--nodes", nodes, "--confirm", "--soul", "probe", "--json"]).status, "accepted");
  const spawned = core.spawnInstance(agentsRoot, agent, { instance: "probe-packed", repo: modernRepo, launch: false });
  const meta = JSON.parse(readFileSync(join(spawned.home, "instance.json"), "utf8"));
  const skills = readdirSync(join(spawned.home, ".agents", "skills")).sort();
  assert.deepEqual(skills, ["memory-harvest", "oats", "oats-config", "oats-packages", "okf", "private"]);
  assert.equal(meta.launched, false);
  assert.equal(lstatSync(join(spawned.home, "AGENTS.md")).isSymbolicLink(), false);
  assert.equal(readlinkSync(join(spawned.home, "CLAUDE.md")), "AGENTS.md");
  assert.equal(readFileSync(join(agent._dir, "soul", "AGENTS.md"), "utf8"), canonical);
  assert.ok(meta.capabilities.some((cap) => cap.id === "oats.okf") && /--skill /.test(meta.command));
  const marker = JSON.parse(readFileSync(join(spawned.home, ".okf-source.json"), "utf8"));
  assert.ok(existsSync(marker.source), "required spawn hook registered durable source");
  assert.ok(existsSync(join(spawned.home, "knowledge/view.json")), "required hook built immutable reader view");
  const doctor = JSON.parse(run(oats, ["doctor", modernRepo, "--soul", "probe", "--json"], { env: cliEnv, capture: true }));
  assert.ok(doctor.composedInstructions.includes("Canonical instructions") && doctor.composedInstructions.includes("Knowledge: OKF"));

  // Both the provider's stdout and the kernel operation envelope cross real
  // pipes. All documents exceed a pipe buffer but stay under the documented
  // per-document preview cap; compare complete Unicode bodies, not prefixes.
  const largeState = "# Working state\n" + "Live state α, not a processing receipt.\n".repeat(5000);
  const largeLog = "# Log\n" + "Observed β limitation in the source.\n".repeat(5000);
  const largeNote = "# Pending note\n" + "A live γ note for inspection.\n".repeat(6000);
  for (const text of [largeState, largeLog, largeNote]) assert.ok(Buffer.byteLength(text) > 128 * 1024 && Buffer.byteLength(text) < 256 * 1024);
  write(join(spawned.home, "STATE.md"), largeState);
  write(join(spawned.home, "log.md"), largeLog);
  write(join(spawned.home, "notes/live.md"), largeNote);
  const inspectSource = () => boundary(["okf", "inspect", "--source", marker.source, "--soul", "probe", "--json"]);
  const discovered = boundary(["inspect", "--home", spawned.home, "--json"]);
  assert.equal(discovered.knowledge.provider, "oats.okf");
  assert.equal(discovered.knowledge.operations.find((op) => op.name === "inspect").available, true);
  for (const result of [
    boundary(["okf", "inspect", "--json"], spawned.home),
    boundary(["operation", "run", "knowledge:inspect", "--home", spawned.home, "--json"]).result,
    inspectSource(),
  ]) {
    assert.equal(result.liveMemory.available, true);
    assert.deepEqual(result.documents.slice(0, 3).map(({ label, kind, text, truncated }) => [label, kind, text, truncated]), [
      ["Working state (STATE.md)", "markdown", largeState, undefined],
      ["Log (log.md)", "markdown", largeLog, undefined],
      ["Pending note: live.md", "markdown", largeNote, undefined],
    ]);
    assert.equal(result.documents.at(-1).label, "Durable processing receipts");
    assert.ok(result.acceptedView.project.digest);
  }
  const preservedHome = join(room, "temporarily-missing-source");
  renameSync(spawned.home, preservedHome);
  assert.equal(inspectSource().liveMemory.reason, "missing-home");
  write(join(spawned.home, "STATE.md"), "DO_NOT_EXPOSE_REUSED_HOME");
  write(join(spawned.home, ".okf-source.json"), JSON.stringify({ version: 1, id: "00000000-0000-0000-0000-000000000000", source: marker.source }));
  const reused = inspectSource();
  assert.equal(reused.liveMemory.reason, "identity-mismatch");
  assert.equal(reused.documents.length, 1);
  assert.doesNotMatch(JSON.stringify(reused), /DO_NOT_EXPOSE_REUSED_HOME/);
  rmSync(spawned.home, { recursive: true });
  renameSync(preservedHome, spawned.home);

  core.retireInstance(agentsRoot, spawned.instance, { home: spawned.home });
  assert.ok(!existsSync(spawned.home), "packed source retired after final durable capture");
  const durable = inspectSource();
  assert.equal(durable.liveMemory.reason, "retired");
  assert.equal(durable.status.retired, true);
  assert.equal(durable.status.lastCapture.complete, true);
  assert.equal(durable.documents.length, 1);
  const refresh = boundary(["okf", "refresh", "--source", marker.source, "--soul", "probe", "--json"]);
  assert.equal(dirname(refresh.path), join(dirname(marker.source), "views"));
  const read = boundary(["okf", "read", "--source", marker.source, "--base", "project", "--path", "expert/index.md", "--soul", "probe", "--json"]);
  assert.equal(read.text, readFileSync(join(accepted, "expert/index.md"), "utf8"));

  // No source home exists. The real capability asks the installed public CLI
  // for its own independent directory worker, then stages durable evidence.
  const requested = boundary(["okf", "run-source", "--source", marker.source, "--manual", "--no-launch", "--soul", "probe", "--json"]);
  assert.equal(requested.status, "ready");
  const workerMeta = JSON.parse(readFileSync(join(requested.home, "instance.json"), "utf8"));
  assert.equal(workerMeta.launched, false);
  assert.equal(workerMeta.work, "directory");
  assert.equal(workerMeta.kind, "capability");
  assert.equal(lstatSync(join(requested.home, "work")).isSymbolicLink(), false);
  assert.ok(!existsSync(join(requested.home, ".okf-source.json")), "service worker must not become another working-memory source");
  const workerWork = join(requested.home, "work");
  const input = JSON.parse(readFileSync(join(workerWork, "input.json"), "utf8"));
  assert.equal(input.inputs.length, 1);
  assert.equal(input.inputs[0].text, largeNote, "full note survived source deletion into durable worker custody");
  const inputId = input.inputs[0].id;
  const stage = JSON.parse(readFileSync(join(workerWork, "staging.json"), "utf8")).project.root;
  const concept = "---\ntype: Decision\ntitle: Explicit custody\ndescription: Why explicit custody was chosen.\n---\n\nHuman accepted explicit custody to avoid silent fallback.\n" + `Evidence: OKF input ${inputId}.\n`;
  write(join(stage, "expert/decision.md"), concept);
  write(join(stage, "expert/index.md"), readFileSync(join(stage, "expert/index.md"), "utf8") + "* [Explicit custody](decision.md) - Why explicit custody was chosen.\n");
  const judgment = join(workerWork, "judgment.json");
  write(judgment, JSON.stringify({ version: 1, exclusionsReviewed: true, outcomes: [{ input: inputId, verdict: "promote", reason: "Accepted rationale, not a code description.", concepts: [{ base: "project", path: "expert/decision.md" }] }] }));
  const completed = boundary(["okf", "complete", "--source", marker.source, "--run", requested.run, "--judgment", judgment, "--soul", "probe", "--json"]);
  assert.equal(completed.receipts.project.status, "accepted");
  assert.equal(completed.processed, true);
  assert.equal(readFileSync(join(accepted, "expert/decision.md"), "utf8"), concept);
  assert.deepEqual(boundary(["okf", "complete", "--source", marker.source, "--run", requested.run, "--soul", "probe", "--json"]), completed, "completion receipt is idempotent");
  core.retireInstance(agentsRoot, requested.instance, { home: requested.home });
  assert.ok(!existsSync(requested.home), "independent scaffold-only worker retired");
  const fresh = core.spawnInstance(agentsRoot, agent, { instance: "probe-fresh", repo: modernRepo, launch: false });
  assert.equal(readFileSync(join(fresh.home, "knowledge/bases/project/expert/decision.md"), "utf8"), concept);
  core.retireInstance(agentsRoot, fresh.instance, { home: fresh.home });
  assert.ok(!existsSync(fresh.home));
  assert.notEqual(boundary(["schedule", "list", "--dir", modernRepo, "--json"]).scheduler.active, true);
  assert.equal(core.capabilityTrust(modernRepo, "oats.okf").trusted, true, "lifecycle never mutates installed OKF");
  checkInstalledOkf();

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
  const distribution = JSON.parse(readFileSync(join(theorySource, "oats-package.json"), "utf8"));
  const distributionCapabilities = ["oats.knowledge-theory", "oats.core", "oats.setup"];
  delete fixtureCatalog.packages["oats.knowledge-theory"]; // replace the old fixture package identity, not capability IDs
  fixtureCatalog.packages[distribution.package] = { url: theoryUrl, ref: theoryCommit, path: "oats-package" };
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
  assert.equal(theoryManifest.package, distribution.package);
  assert.deepEqual(theoryManifest._capabilities.map((c) => c.id), distributionCapabilities);
  core.assertCapabilitySelfContained(theoryCap, JSON.parse(readFileSync(join(theoryCap, "oats.json"), "utf8")));
  const disabled = "capabilities:\n  layers:\n    knowledge: none\n    messaging: none\n    tasks: none\n";
  const theoryScopes = [];
  for (const work of ["checkout", "directory"]) {
    const scope = join(room, `theory-${work}`);
    if (work === "checkout") gitRepo(scope);
    else mkdirSync(scope);
    const roots = join(scope, "agents"); mkdirSync(roots);
    const config = join(scope, "oats-config.yaml"); write(config, disabled);
    const source = work === "checkout" ? directTheorySource : distribution.package;
    run(oats, ["install", source, "--dir", scope], { env });
    assert.equal(readFileSync(config, "utf8"), disabled, "acquisition must not activate the package");
    assert.deepEqual(core.resolveOatsConfig(scope, "author").capabilities, []);
    assert.equal(core.findCapabilityAgent(scope, roots, "knowledge-theory-expert"), undefined);
    const lock = JSON.parse(readFileSync(join(scope, "oats-lock.json"), "utf8"));
    assert.equal(lock.lockfileVersion, 2);
    assert.deepEqual(Object.keys(lock.packages), [distribution.package]);
    assert.deepEqual(Object.keys(lock.capabilities).sort(), [...distributionCapabilities].sort());
    const packageRow = lock.packages[distribution.package];
    assert.equal(packageRow.commit, theoryCommit, "normal Git acquisition exact-locks the fixture commit");
    assert.equal(packageRow.path, "oats-package");
    assert.equal(packageRow.source, work === "checkout" ? `git:${directTheorySource}` : `catalog:${distribution.package}`);
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
    stubbedInactiveStatusProbes: existsSync(statusProbes) ? readFileSync(statusProbes, "utf8").trim().split("\n").length : 0,
    optionalTheory: { excludedFromNpm: true, acquiredFromGitFixture: true, acquisitionRoutes: ["direct-git", "catalog-git"],
      exactCommit: theoryCommit, sourceRemoved: true, references: expectedClosure.length - 1,
      trackedSourceAliasPreserved: true, generatedAliases: true, scaffoldedAndRetired: theoryProbes, alternativeIsolated: true, liveLaunches: 0 },
    okf: { version: bundledVersion, catalogRef: pinnedRef, npm: npmOkf,
      acquiredFromVerifiedGit: true, exactCommit: okfCommit, sourceRemoved: true,
      trackedSourceAliasPreserved: true, requiredHooks: true, largePipedInspection: true,
      sourceCustody: true, independentWorker: true, acceptedCompletion: true,
      scaffoldedAndRetired: ["source", "worker", "fresh-reader"], liveLaunches: 0 },
  }, null, 2));
} finally {
  if (keep) console.error(`OATS_KEEP_SMOKE=1: retained ${room}`);
  else rmSync(room, { recursive: true, force: true });
}
