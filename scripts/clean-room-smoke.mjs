#!/usr/bin/env node
// Clean-room tarball smoke for the WORKSPACE MODEL (lock v3, oats-local.yaml,
// oats-workspace.yaml, materialized per-instance modules). It packs the kernel
// and the pi adapter, installs both into an isolated app from the tarballs, and
// drives the packed CLI end to end against the REAL official OKF package and the
// packed kernel's own oats.framework payload — never against the checkout.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// Test-driver helpers only. Runtime imports resolve against installed bytes.
// The optional Git payloads are copied once into isolated fixture repositories;
// all post-sync reads use installed/materialized bytes after their deletion.
import { CAPABILITY_PATH, EXPERT_PATH, SKILL_PATH, checkKnowledgeTheoryPackage, checkReferenceClosure, treeFiles } from "./check-knowledge-theory-package.mjs";
import { checkJavaScript, checkKernelPackFiles, checkNpmOkfPayload } from "./check-package-dry-runs.mjs";
import { checkOkfMirror, checkOkfPayload, materializeOkfGitPayload, payloadEntries } from "./check-okf-mirror.mjs";

const started = Date.now();
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const room = realpathSync(mkdtempSync(join(tmpdir(), "oats-packed-smoke-")));
const keep = process.env.OATS_KEEP_SMOKE === "1";
const run = (command, args, options = {}) => execFileSync(command, args, {
  encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 120_000, stdio: options.capture ? ["ignore", "pipe", "pipe"] : "ignore", ...options,
});
const write = (path, content) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); };
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

function pack(cwd, destination) {
  const output = run("npm", ["pack", "--json", "--pack-destination", destination], { cwd, capture: true });
  const parsed = JSON.parse(output);
  if (parsed.length !== 1) throw new Error(`unexpected npm pack output from ${cwd}`);
  if (cwd === repo) checkKernelPackFiles(parsed[0]);
  return join(destination, parsed[0].filename);
}
function gitRepo(path, message = "smoke fixture") {
  mkdirSync(path, { recursive: true });
  if (!existsSync(join(path, ".git"))) run("git", ["init", "-q", path]);
  run("git", ["-C", path, "config", "user.name", "OATS Smoke"]);
  run("git", ["-C", path, "config", "user.email", "smoke@example.invalid"]);
  run("git", ["-C", path, "add", "-A"]);
  run("git", ["-C", path, "commit", "-qm", message]);
  return run("git", ["-C", path, "rev-parse", "HEAD"], { capture: true }).trim();
}
const fingerprint = (root) => treeFiles(root).map((file) => {
  const path = join(root, file);
  return `${file}:${lstatSync(path).isSymbolicLink() ? `link:${readlinkSync(path)}` : createHash("sha256").update(readFileSync(path)).digest("hex")}`;
});

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
  // The remote cache lives under $HOME/.cache (kernel default) — inside the room.
  const env = Object.fromEntries(["PATH", "SystemRoot", "ComSpec", "PATHEXT", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL"]
    .filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
  Object.assign(env, {
    HOME: home, SHELL: "/bin/sh",
    OATS_HOME_DIR: join(home, ".oats"),
    OATS_PKG_ROOT: kernelRoot,
    OATS_PACKAGE_CATALOG: catalog,
    OATS_TMUX_SESSION: `none-${process.pid}`,
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
  const packedCatalog = readJson(join(kernelRoot, "package-catalog.json"));
  const pinnedRef = packedCatalog.packages?.["oats.okf"]?.ref;
  const bundledVersion = readJson(join(kernelRoot, "capabilities/oats-okf/oats.json")).version;
  assert.equal(pinnedRef, `v${bundledVersion}`, "npm mirror and official catalog version drift");
  assert.equal(bundledVersion, "3.0.0");
  const okfCommit = gitRepo(officialRepo, "okf");
  const okfTag = `v${bundledVersion}`;
  run("git", ["-C", officialRepo, "tag", okfTag]);
  const okfAlias = "agents/memory-harvest/CLAUDE.md";
  const trackedAlias = `oats-package/capabilities/oats-okf/${okfAlias}`;
  assert.match(run("git", ["-C", officialRepo, "ls-tree", okfCommit, "--", trackedAlias], { capture: true }), /^120000 blob /);
  assert.equal(run("git", ["-C", officialRepo, "show", `${okfCommit}:${trackedAlias}`], { capture: true }), "AGENTS.md");

  // Optional theory uses a DIFFERENT release channel: the exact self-contained
  // Git payload (oats.framework), not an npm copy with its source CLAUDE.md
  // symlink missing. Copy the whole candidate payload verbatim into an isolated
  // Git fixture tagged with its manifest version; the catalog resolves it.
  checkKnowledgeTheoryPackage({ repoRoot: repo });
  const theoryRepo = join(room, "official", "oats-framework");
  const theorySource = join(theoryRepo, "oats-package");
  cpSync(join(repo, "oats-package"), theorySource, { recursive: true, verbatimSymlinks: true });
  checkKnowledgeTheoryPackage({ packageRoot: theorySource, parity: false });
  const distribution = readJson(join(theorySource, "oats-package.json"));
  assert.equal(distribution.package, "oats.framework");
  const theoryTag = `v${distribution.version}`;
  const theoryCommit = gitRepo(theoryRepo, "framework");
  run("git", ["-C", theoryRepo, "tag", theoryTag]);
  const theoryAliasPath = `oats-package/${CAPABILITY_PATH}/${EXPERT_PATH}/CLAUDE.md`;
  assert.match(run("git", ["-C", theoryRepo, "ls-tree", theoryCommit, "--", theoryAliasPath], { capture: true }), /^120000 blob /, "Git payload must track the source alias as a symlink");
  assert.equal(run("git", ["-C", theoryRepo, "show", `${theoryCommit}:${theoryAliasPath}`], { capture: true }), "AGENTS.md");
  const theoryCap = join(theorySource, CAPABILITY_PATH);
  const theorySkill = join(theoryCap, SKILL_PATH);
  const expectedClosure = checkReferenceClosure(theorySkill);
  const canonicalRefs = ["knowledge-capability-authoring.md", ...treeFiles(join(kernelRoot, "docs/knowledge-reference")).map((f) => `knowledge-reference/${f}`)];
  assert.deepEqual(treeFiles(join(theorySkill, "references")), canonicalRefs.sort());
  for (const file of canonicalRefs) assert.ok(readFileSync(join(kernelRoot, "docs", file)).equals(readFileSync(join(theorySkill, "references", file))), `packed reference drift: ${file}`);
  const skillFingerprint = fingerprint(theorySkill);
  const capFingerprint = fingerprint(theoryCap);
  const expertInstructions = readFileSync(join(theoryCap, EXPERT_PATH, "AGENTS.md"), "utf8");
  assert.equal(readlinkSync(join(theoryCap, EXPERT_PATH, "CLAUDE.md")), "AGENTS.md");

  // The offline official catalog: both packages by tag, from file:// fixtures.
  write(catalog, JSON.stringify({ packages: {
    "oats.okf": { url: pathToFileURL(officialRepo).href, ref: okfTag, path: "oats-package" },
    "oats.framework": { url: pathToFileURL(theoryRepo).href, ref: theoryTag, path: "oats-package" },
  } }, null, 2));

  const adapterLoader = await import(pathToFileURL(join(adapterRoot, "extension", "core-loader.mjs")).href);
  if (adapterLoader.OATS_PKG_ROOT !== kernelRoot) throw new Error("packed pi adapter did not resolve packed kernel");
  const kernelPackage = readJson(join(kernelRoot, "package.json"));
  if (adapterLoader.kernelVersion() !== kernelPackage.version) throw new Error("packed adapter/kernel version mismatch");
  // Resolve the installed public export, not a private kernel filesystem path.
  const installedRequire = createRequire(join(app, "package.json"));
  assert.equal(installedRequire.resolve("@awebai/oats/package.json"), join(kernelRoot, "package.json"));
  const core = await import(pathToFileURL(installedRequire.resolve("@awebai/oats")).href);
  // The package's declared capabilities, as the workspace sync below resolves and the
  // spawn of the theory's author soul copies them (the v2 path reads them there).
  assert.deepEqual(distribution.capabilities.map((path) => readJson(join(theorySource, path, "oats.json")).capability), ["oats.knowledge-theory", "oats.core", "oats.setup"]);

  // ---- The workspace: one host repo that is also its single member, holding
  // the souls. The deployment is a separate directory with only oats-local.yaml.
  const hostRepo = join(room, "workspace-host");
  const hostRef = pathToFileURL(hostRepo).href; // bare absolute paths are refused in oats-workspace.yaml
  const soulsDir = join(hostRepo, "souls");
  write(join(hostRepo, "oats-workspace.yaml"), [
    "schemaVersion: 2", "name: smoke",
    "members:", `  - ${hostRef}`,
    "packages:", `  oats.okf: ${okfTag}`, `  oats.framework: ${theoryTag}`,
    "teams:", "  global: { description: all }",
    "defaults:", "  knowledge:", "    oats.okf: { from: package }",
    "",
  ].join("\n"));
  write(join(hostRepo, "oats-membership.yaml"), `schemaVersion: 2\nworkspace: ${hostRef}\n`);
  const canonical = "# Packed probe\n\nCanonical instructions.\n";
  write(join(soulsDir, "probe/soul.yaml"), "schemaVersion: 2\nname: probe\ndescription: Packed OKF probe\nwork: directory\n");
  write(join(soulsDir, "probe/AGENTS.md"), canonical);
  write(join(soulsDir, "probe/okf.json"), JSON.stringify({ version: 1, owner: "smoke-owner", owns: ["project/expert"], reads: [] }));
  write(join(soulsDir, "probe/skills/private/SKILL.md"), "---\nname: private\ndescription: Packed private smoke skill.\n---\n# Private\n");
  // A soul that opts out of the knowledge default and pulls the optional theory
  // from the oats.framework package (a package without executables).
  write(join(soulsDir, "author/soul.yaml"), "schemaVersion: 2\nname: author\ndescription: Knowledge theory author\nwork: directory\nknowledge: none\ncapabilities:\n  oats.knowledge-theory: { from: package }\n");
  write(join(soulsDir, "author/AGENTS.md"), "# Author\n\nAuthor canonical instructions.\n");
  const hostCommit = gitRepo(hostRepo, "workspace host");

  const deployment = join(room, "deployment"); const agentsRoot = join(deployment, "agents"); mkdirSync(agentsRoot, { recursive: true });
  const bindings = join(room, "okf-bindings.json");
  const accepted = join(room, "accepted"); // created by `okf init`, never pre-seeded
  // Explicit bindings and stable owner: state-dir/bases live in the bindings
  // document; the manifest's `bindings-file` setting is the only host value.
  write(bindings, JSON.stringify({ version: 1, stateDir: join(room, "okf-state"), bases: {
    project: { id: "smoke-base", kind: "directory", path: accepted },
  } }));
  write(join(deployment, "oats-local.yaml"), `schemaVersion: 2\nworkspace: ${hostRef}\nsettings:\n  oats.okf:\n    bindings-file: ${bindings}\n`);

  const cliEnv = { ...env, PI_AGENTS_ROOT: agentsRoot };
  const cli = (args, { cwd = deployment, identity = false, env: extra = {}, expectExit = 0 } = {}) => {
    // Scaffold-only probes have no harness to supply the normal launch identity.
    const id = identity ? { OATS_INSTANCE: basename(cwd), OATS_INSTANCE_HOME: cwd, PI_AGENT_INSTANCE: basename(cwd), PI_AGENT_HOME: cwd } : {};
    const r = spawnSync(oats, args, { cwd, env: { ...cliEnv, ...id, ...extra }, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 120_000 });
    if (r.error) throw r.error;
    assert.equal(r.status, expectExit, `oats ${args.join(" ")} exited ${r.status}\n${r.stdout}\n${r.stderr}`);
    return r.stdout;
  };
  const boundary = (args, options = {}) => {
    const text = cli(args, options);
    const answer = JSON.parse(text);
    assert.equal(answer.schemaVersion, 1, text);
    assert.equal(answer.ok, true, text);
    return answer.result;
  };
  // `oats retire --json` answers with the retirement record itself (no envelope).
  const retire = (instance, homeDir) => {
    const r = JSON.parse(cli(["retire", instance, "--dir", deployment, "--home", homeDir, "--json"]));
    assert.equal(r.retired, instance, JSON.stringify(r));
    assert.equal(r.removedDir, true, JSON.stringify(r));
    assert.ok(!existsSync(homeDir), `${instance} home survived retirement`);
    return r;
  };

  // ---- sync: resolve + lock (v3) both packages at exact commit + integrity.
  // No approval step: declaring a package in packages: is the trust decision.
  const syncText = cli(["sync", "--dir", deployment, "--json"]);
  const synced = JSON.parse(syncText);
  assert.equal(synced.ok, true, syncText);
  assert.deepEqual(synced.result.members.map((m) => m.status), ["confirmed"], syncText);
  assert.deepEqual(synced.result.packages.map((p) => p.id).sort(), ["oats.framework", "oats.okf"]);
  assert.ok(!Object.hasOwn(synced.result, "approvalNeeded"), "sync reports no approval");
  const lockPath = join(deployment, "oats-lock.json");
  const checkLockShape = (lock) => {
    assert.equal(lock.lockfileVersion, 3);
    assert.ok(!Object.hasOwn(lock, "capabilities"), "lock v3 has no top-level capabilities map");
    assert.deepEqual(Object.keys(lock.packages).sort(), ["oats.framework", "oats.okf"]);
    for (const [id, row] of Object.entries(lock.packages)) {
      assert.match(row.commit, /^[0-9a-f]{40}$/, id);
      assert.match(row.integrity, /^sha256-[0-9a-f]{64}$/, id);
      assert.equal(row.path, "oats-package", id);
      assert.equal(row.source, `catalog:${id}`, id);
    }
    assert.equal(lock.packages["oats.okf"].commit, okfCommit);
    assert.equal(lock.packages["oats.okf"].version, bundledVersion);
    assert.equal(lock.packages["oats.framework"].commit, theoryCommit);
    assert.equal(lock.packages["oats.framework"].version, distribution.version);
    assert.doesNotMatch(JSON.stringify(lock), /"lockfileVersion":\s*2/);
  };
  const locked = readJson(lockPath);
  checkLockShape(locked);
  for (const row of Object.values(locked.packages)) assert.ok(!Object.hasOwn(row, "approved"), "lock v3 entries carry no approval");
  assert.ok(!Object.hasOwn(JSON.parse(cli(["sync", "--dir", deployment, "--json"])).result, "approvalNeeded"), "a second sync exits 0");
  assert.deepEqual(readJson(lockPath), locked, "a second sync is a no-op on the lock");
  for (const residue of [".agents/capabilities/installed", ".agents/capabilities", "oats-config.yaml", ".agents/packages"]) {
    assert.ok(!existsSync(join(deployment, residue)), `workspace model wrote v1 residue ${residue}`);
  }
  const freshDoctor = JSON.parse(cli(["doctor", deployment, "--json"]));
  assert.equal(freshDoctor.lockError ?? null, null, `packed doctor refuses the lock it just wrote: ${JSON.stringify(freshDoctor.lockError)}`);
  assert.ok(!freshDoctor.legacyLockFiles?.length && !freshDoctor.officialMigration, "packed doctor asked a fresh deployment to migrate");

  // ---- OKF's own provisioning: the accepted base must exist before the soul
  // can spawn (its required spawn hook refuses to bootstrap on read).
  const nodes = join(room, "okf-nodes.json");
  write(nodes, JSON.stringify({ expert: { path: "expert", owner: "smoke-owner" } }));
  // Operator-level dispatch (contracts doc, "Post-0.25.0 clarifications"): from
  // the deployment (no instance home) `oats okf init --soul probe` resolves
  // exactly as `oats spawn probe` would, fetches oats.okf into the deployment's
  // module store <deployment>/.oats/modules/oats.okf@<commit12>/ and runs THAT
  // copy with the soul's merged oats.okf payload (bindings-file) as OATS_SETTINGS.
  // Without --soul there is no resolution to answer from: E_BAD_ARGS naming it.
  const noSoul = JSON.parse(cli(["okf", "init", "--base", "project", "--nodes", nodes, "--confirm", "--json"], { expectExit: 1 }));
  assert.equal(noSoul.ok, false); assert.equal(noSoul.error.code, "E_BAD_ARGS", JSON.stringify(noSoul)); assert.match(noSoul.error.message, /--soul/);
  assert.ok(!existsSync(join(deployment, ".oats", "modules")), "a refused dispatch fetches nothing");
  const okfInitAnswer = boundary(["okf", "init", "--base", "project", "--nodes", nodes, "--confirm", "--soul", "probe", "--json"]);
  assert.equal(okfInitAnswer.status, "accepted", JSON.stringify(okfInitAnswer));
  assert.ok(existsSync(join(accepted, "okf-base.json")), "okf init wrote the accepted base");
  const storeEntries = readdirSync(join(deployment, ".oats", "modules")).filter((n) => !n.startsWith("."));
  assert.deepEqual(storeEntries.map((n) => n.replace(/@[0-9a-f]{12}$/, "@<commit12>")), ["oats.okf@<commit12>"], `module store: ${storeEntries.join(", ")}`);
  assert.equal(storeEntries[0].slice("oats.okf@".length), locked.packages["oats.okf"].commit.slice(0, 12), "the store copy is the LOCKED commit");
  assert.ok(existsSync(join(deployment, ".oats", "modules", storeEntries[0], "bin", "oats-okf.mjs")), "the store copy carries the executable that ran");
  assert.ok(!existsSync(join(agentsRoot, "probe", "instances")), "init ran before any instance existed");

  // ---- spawn the OKF probe through the packed CLI, scaffold only.
  const spawned = boundary(["spawn", "probe", "--dir", deployment, "--agents-root", agentsRoot, "--purpose", "packed", "--no-launch", "--json"]);
  const probeHome = realpathSync(spawned.home);
  assert.equal(probeHome, join(realpathSync(agentsRoot), "probe", "instances", spawned.instance));
  const meta = readJson(join(probeHome, "instance.json"));
  assert.equal(meta.launched, false);
  assert.equal(meta.work, "directory");
  assert.ok(meta.modules && typeof meta.modules === "object", "instance.json records materialized modules");
  assert.equal(meta.modules["oats.okf"].commit, okfCommit);
  assert.equal(meta.modules["oats.okf"].from.kind, "package");
  assert.equal(meta.modules["oats.okf"].from.package, "oats.okf");
  const okfRow = meta.capabilities.find((c) => c.id === "oats.okf");
  assert.ok(okfRow, "instance.json.capabilities lists oats.okf");
  assert.deepEqual([...okfRow.hooks].sort(), ["retire", "soul-scaffold", "spawn"], "capability row carries its hooks");
  assert.equal(okfRow.settings?.["bindings-file"], bindings, "effective settings come from oats-local.yaml");
  const okfModule = join(probeHome, ".oats/modules/oats.okf");
  assert.equal(readJson(join(okfModule, "oats.json")).hooks.spawn.required, true);
  assert.ok(lstatSync(join(okfModule, okfAlias)).isSymbolicLink(), "tracked alias materialized as a symlink");
  assert.equal(readlinkSync(join(okfModule, okfAlias)), "AGENTS.md");
  // The materialized module is the ENTIRE verified inventory: nothing added,
  // nothing dropped, the alias included.
  const checkOkfModule = () => assert.deepEqual(payloadEntries(okfModule), inventory.entries, "materialized package module must match the OKF source inventory exactly");
  checkOkfModule();
  // Skills are materialized per module (<home>/.agents/skills/<module>/<skill>)
  // next to the soul's own skills; the harness discovers them from the home.
  const skillsRoot = join(probeHome, ".agents", "skills");
  const skills = readdirSync(skillsRoot).sort();
  assert.deepEqual(skills, ["oats.okf", "private"], "module skill dirs plus the soul's private skill");
  assert.deepEqual(readdirSync(join(skillsRoot, "oats.okf")).sort(), ["memory-harvest", "okf"], "oats.okf → okf + memory-harvest");
  assert.ok(existsSync(join(skillsRoot, "oats.okf/okf/SKILL.md")) && existsSync(join(skillsRoot, "private/SKILL.md")));
  // The soul's own skill and each module skill by its `module:<cap>` source (record order is not a contract).
  assert.deepEqual(meta.skills.map((s) => [s.name, s.source]).sort(), [["memory-harvest", "module:oats.okf"], ["okf", "module:oats.okf"], ["private", "soul"]]);
  assert.equal(lstatSync(join(probeHome, "AGENTS.md")).isSymbolicLink(), false);
  assert.equal(readlinkSync(join(probeHome, "CLAUDE.md")), "AGENTS.md");
  const composed = readFileSync(join(probeHome, "AGENTS.md"), "utf8");
  assert.ok(composed.includes("Canonical instructions"), "canonical soul instructions composed");
  assert.ok(composed.includes("<!-- oats:capability:oats.okf"), "OKF injection composed");
  assert.equal(readFileSync(join(agentsRoot, "probe/soul/AGENTS.md"), "utf8"), canonical, "the fetched soul copy is the member's soul");
  assert.doesNotMatch(meta.command, /--no-skills/, "the launch command must let the harness load the materialized skills");
  assert.ok(meta.command.includes(join(probeHome, "AGENTS.md")), meta.command);
  const marker = readJson(join(probeHome, ".okf-source.json"));
  assert.ok(existsSync(marker.source), "required spawn hook registered durable source");
  assert.ok(existsSync(join(probeHome, "knowledge/view.json")), "required hook built immutable reader view");
  const doctor = JSON.parse(cli(["doctor", deployment, "--json"]));
  assert.equal(doctor.lockError ?? null, null);

  // The fixture repositories are gone from here on: every resolution, module
  // materialization and read must come from the lock + the deployment's own
  // remote cache, never from a source checkout.
  rmSync(officialRepo, { recursive: true });
  rmSync(theoryRepo, { recursive: true });
  assert.ok(!existsSync(officialRepo) && !existsSync(theoryRepo));

  // Both the provider's stdout and the kernel operation envelope cross real
  // pipes. All documents exceed a pipe buffer but stay under the documented
  // per-document preview cap; compare complete Unicode bodies, not prefixes.
  const largeState = "# Working state\n" + "Live state α, not a processing receipt.\n".repeat(5000);
  const largeLog = "# Log\n" + "Observed β limitation in the source.\n".repeat(5000);
  const largeNote = "# Pending note\n" + "A live γ note for inspection.\n".repeat(6000);
  for (const text of [largeState, largeLog, largeNote]) assert.ok(Buffer.byteLength(text) > 128 * 1024 && Buffer.byteLength(text) < 256 * 1024);
  write(join(probeHome, "STATE.md"), largeState);
  write(join(probeHome, "log.md"), largeLog);
  write(join(probeHome, "notes/live.md"), largeNote);
  // Scope commands (no home) run from the source home with its identity: the
  // dispatcher resolves the capability from that instance's materialized modules.
  const inHome = { cwd: probeHome, identity: true };
  const inspectSource = () => boundary(["okf", "inspect", "--source", marker.source, "--soul", "probe", "--json"], inHome);
  const discovered = boundary(["inspect", "--home", probeHome, "--json"]);
  assert.equal(discovered.knowledge.provider, "oats.okf");
  assert.equal(discovered.knowledge.operations.find((op) => op.name === "inspect").available, true);
  for (const result of [
    boundary(["okf", "inspect", "--json"], inHome),
    boundary(["operation", "run", "knowledge:inspect", "--home", probeHome, "--json"]).result,
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
  // A scope command needs SOME materialized module set to dispatch from; keep a
  // pristine module copy for after the source home is gone.
  const scopeHome = join(room, "scope-home");
  cpSync(probeHome, scopeHome, { recursive: true, verbatimSymlinks: true });
  for (const f of ["STATE.md", "log.md", "notes", ".okf-source.json", "knowledge"]) rmSync(join(scopeHome, f), { recursive: true, force: true });
  const inScope = { cwd: scopeHome, identity: true };
  const scopeInspect = () => boundary(["okf", "inspect", "--source", marker.source, "--soul", "probe", "--json"], inScope);
  const preservedHome = join(room, "temporarily-missing-source");
  renameSync(probeHome, preservedHome);
  assert.equal(scopeInspect().liveMemory.reason, "missing-home");
  write(join(probeHome, "STATE.md"), "DO_NOT_EXPOSE_REUSED_HOME");
  write(join(probeHome, ".okf-source.json"), JSON.stringify({ version: 1, id: "00000000-0000-0000-0000-000000000000", source: marker.source }));
  const reused = scopeInspect();
  assert.equal(reused.liveMemory.reason, "identity-mismatch");
  assert.equal(reused.documents.length, 1);
  assert.doesNotMatch(JSON.stringify(reused), /DO_NOT_EXPOSE_REUSED_HOME/);
  rmSync(probeHome, { recursive: true });
  renameSync(preservedHome, probeHome);

  const retiredProbe = retire(spawned.instance, probeHome);
  assert.equal(retiredProbe.capabilityMeta["oats.okf"].capture.complete, true, "retire hook captured the source before removal");
  assert.equal(retiredProbe.capabilityMeta["oats.okf"].capture.inputs, 1);
  const durable = scopeInspect();
  assert.equal(durable.liveMemory.reason, "retired");
  assert.equal(durable.status.retired, true);
  assert.equal(durable.status.lastCapture.complete, true);
  assert.equal(durable.documents.length, 1);
  const refresh = boundary(["okf", "refresh", "--source", marker.source, "--soul", "probe", "--json"], inScope);
  assert.equal(dirname(refresh.path), join(dirname(marker.source), "views"));
  const read = boundary(["okf", "read", "--source", marker.source, "--base", "project", "--path", "expert/index.md", "--soul", "probe", "--json"], inScope);
  assert.equal(read.text, readFileSync(join(accepted, "expert/index.md"), "utf8"));

  // No source home exists. The real capability asks the installed public CLI
  // for its own independent directory worker, then stages durable evidence.
  // memory-harvest is a CAPABILITY-DEFINED agent (oats.okf agents/): with no live instance carrying
  // the module, the kernel resolves it from the deployment's lock (locked package → fetched into
  // <deployment>/.oats/modules/<cap>@<commit>/) and homes it under <deployment>/agents/memory-harvest/instances/.
  const requested = boundary(["okf", "run-source", "--source", marker.source, "--manual", "--no-launch", "--soul", "probe", "--json"], inScope);
  assert.equal(requested.status, "ready");
  const workerMeta = readJson(join(requested.home, "instance.json"));
  assert.equal(workerMeta.launched, false);
  assert.equal(workerMeta.work, "directory");
  assert.equal(workerMeta.kind, "capability");
  assert.equal(dirname(dirname(realpathSync(requested.home))), realpathSync(join(agentsRoot, "memory-harvest")), "a capability agent homes under the agents root");
  assert.equal(lstatSync(join(requested.home, "work")).isSymbolicLink(), false);
  assert.ok(!existsSync(join(requested.home, ".okf-source.json")), "service worker must not become another working-memory source");
  const workerWork = join(requested.home, "work");
  const input = readJson(join(workerWork, "input.json"));
  assert.equal(input.inputs.length, 1);
  assert.equal(input.inputs[0].text, largeNote, "full note survived source deletion into durable worker custody");
  const inputId = input.inputs[0].id;
  const stage = readJson(join(workerWork, "staging.json")).project.root;
  const concept = "---\ntype: Decision\ntitle: Explicit custody\ndescription: Why explicit custody was chosen.\n---\n\nHuman accepted explicit custody to avoid silent fallback.\n" + `Evidence: OKF input ${inputId}.\n`;
  write(join(stage, "expert/decision.md"), concept);
  write(join(stage, "expert/index.md"), readFileSync(join(stage, "expert/index.md"), "utf8") + "* [Explicit custody](decision.md) - Why explicit custody was chosen.\n");
  const judgment = join(workerWork, "judgment.json");
  write(judgment, JSON.stringify({ version: 1, exclusionsReviewed: true, outcomes: [{ input: inputId, verdict: "promote", reason: "Accepted rationale, not a code description.", concepts: [{ base: "project", path: "expert/decision.md" }] }] }));
  const completed = boundary(["okf", "complete", "--source", marker.source, "--run", requested.run, "--judgment", judgment, "--soul", "probe", "--json"], inScope);
  assert.equal(completed.receipts.project.status, "accepted");
  assert.equal(completed.processed, true);
  assert.equal(readFileSync(join(accepted, "expert/decision.md"), "utf8"), concept);
  assert.deepEqual(boundary(["okf", "complete", "--source", marker.source, "--run", requested.run, "--soul", "probe", "--json"], inScope), completed, "completion receipt is idempotent");
  // A capability agent homes under <deployment>/agents/<name>/instances/; retire through that agents root.
  core.retireInstance(agentsRoot, requested.instance, { home: requested.home });
  assert.ok(!existsSync(requested.home), "independent scaffold-only worker retired");
  // A fresh reader of the same soul sees the accepted concept; its modules are
  // materialized again from the cache — the source fixture no longer exists.
  const fresh = boundary(["spawn", "probe", "--dir", deployment, "--agents-root", agentsRoot, "--purpose", "fresh", "--no-launch", "--json"]);
  const freshHome = realpathSync(fresh.home);
  assert.equal(readFileSync(join(freshHome, "knowledge/bases/project/expert/decision.md"), "utf8"), concept);
  assert.equal(readJson(join(freshHome, "instance.json")).modules["oats.okf"].commit, okfCommit);
  assert.deepEqual(payloadEntries(join(freshHome, ".oats/modules/oats.okf")), inventory.entries);
  retire(fresh.instance, freshHome);
  assert.notEqual(boundary(["schedule", "list", "--dir", deployment, "--json"]).scheduler.active, true);
  assert.deepEqual(readJson(lockPath), locked, "lifecycle never mutates the lock");
  // Module copies are per-instance and gone with their homes; the lock is the
  // durable trust record and the scope copy's module set is still pristine.
  assert.deepEqual(payloadEntries(join(scopeHome, ".oats/modules/oats.okf")), inventory.entries, "lifecycle never mutates a materialized module");
  rmSync(scopeHome, { recursive: true });

  // ---- Optional theory from the oats.framework package: a soul that opts out
  // of the knowledge default and pulls oats.knowledge-theory from the package.
  // capability-defined agents (knowledge-theory-expert, memory-harvest as a
  // spawnable soul) resolve from materialized modules in a later phase; here
  // the module bytes and the composed instance are what is asserted.
  const theoryProbes = [];
  for (const harness of ["pi", "claude"]) {
    const author = boundary(["spawn", "author", "--dir", deployment, "--agents-root", agentsRoot, "--purpose", `theory-${harness}`, "--harness", harness, "--no-launch", "--json"]);
    const authorHome = realpathSync(author.home);
    try {
      const authorMeta = readJson(join(authorHome, "instance.json"));
      assert.equal(authorMeta.launched, false);
      assert.equal(authorMeta.harness, harness);
      assert.equal(readlinkSync(join(authorHome, "CLAUDE.md")), "AGENTS.md");
      assert.deepEqual(Object.keys(authorMeta.modules).sort(), ["oats.knowledge-theory"], "knowledge: none drops the OKF default; the theory package is the only module");
      assert.equal(authorMeta.modules["oats.knowledge-theory"].commit, theoryCommit);
      assert.equal(authorMeta.modules["oats.knowledge-theory"].from.package, "oats.framework");
      const theoryModule = join(authorHome, ".oats/modules/oats.knowledge-theory");
      assert.deepEqual(fingerprint(theoryModule), capFingerprint, "materialized module preserves the full capability including the source alias");
      assert.ok(lstatSync(join(theoryModule, EXPERT_PATH, "CLAUDE.md")).isSymbolicLink());
      assert.equal(readlinkSync(join(theoryModule, EXPERT_PATH, "CLAUDE.md")), "AGENTS.md", "package alias survives Git transport, cache and source deletion");
      const materializedSkill = join(authorHome, ".agents/skills/oats.knowledge-theory", basename(SKILL_PATH));
      assert.deepEqual(fingerprint(materializedSkill), skillFingerprint, "complete packed skill materialized without a source");
      assert.deepEqual(checkReferenceClosure(materializedSkill), expectedClosure);
      assert.deepEqual(readdirSync(join(authorHome, ".agents/skills")).sort(), ["oats.knowledge-theory"]);
      assert.deepEqual(readdirSync(join(authorHome, ".agents/skills/oats.knowledge-theory")), [basename(SKILL_PATH)]);
      const text = readFileSync(join(authorHome, "AGENTS.md"), "utf8");
      assert.ok(text.includes("Author canonical instructions"));
      assert.doesNotMatch(text, /Knowledge: OKF|oats:capability:oats\.okf/, "theory must not inject knowledge runtime policy");
      assert.ok(!text.includes(expertInstructions.trim()), "the expert's instructions are the expert agent's, not the author's");
      assert.ok(!authorMeta.capabilities.some((c) => c.id === "oats.okf"));
      for (const absent of ["STATE.md", "notes", "log.md", ".okf-source.json", "soul/knowledge"]) assert.ok(!existsSync(join(authorHome, absent)), `knowledge none created ${absent}`);
    } finally {
      retire(author.instance, authorHome);
    }
    theoryProbes.push(`directory/${harness}`);
  }
  assert.deepEqual(readJson(lockPath), locked, "theory spawns never mutate the lock");
  assert.ok(!existsSync(env.OATS_SMOKE_UNEXPECTED_EXEC), "a runtime/backend/host scheduler was invoked");

  console.log(JSON.stringify({
    passed: true, seconds: Math.round((Date.now() - started) / 1000),
    kernelTarball: basename(kernelTgz), adapterTarball: basename(adapterTgz),
    adapterResolvedPackedKernel: true, installedJsChecked,
    workspace: { host: hostCommit, lockfileVersion: 3, packages: Object.keys(locked.packages).sort(), okfIntegrity: locked.packages["oats.okf"].integrity, v1Residue: false, doctorLockError: null },
    exactSkills: skills, canonicalSoulUnchanged: true, launchLoadsSkills: true,
    stubbedInactiveStatusProbes: existsSync(statusProbes) ? readFileSync(statusProbes, "utf8").trim().split("\n").length : 0,
    okf: { version: bundledVersion, catalogRef: pinnedRef, npm: npmOkf,
      acquiredFromVerifiedGit: true, exactCommit: okfCommit, sourceRemoved: true,
      trackedSourceAliasPreserved: true, moduleMatchesInventory: true, requiredHooks: true, dispatchFromModules: true, largePipedInspection: true,
      sourceCustody: true, independentWorker: true, acceptedCompletion: true,
      scaffoldedAndRetired: ["source", "worker", "fresh-reader"], liveLaunches: 0,
      operatorDispatchFromDeployment: { command: "okf init --soul probe", store: storeEntries[0], soulRequired: true } },
    optionalTheory: { package: distribution.package, excludedFromNpm: true, acquiredFromGitFixture: true, exactCommit: theoryCommit, sourceRemoved: true,
      references: expectedClosure.length - 1, trackedSourceAliasPreserved: true, scaffoldedAndRetired: theoryProbes, liveLaunches: 0 },
  }, null, 2));
} finally {
  if (keep) console.error(`OATS_KEEP_SMOKE=1: retained ${room}`);
  else rmSync(room, { recursive: true, force: true });
}
