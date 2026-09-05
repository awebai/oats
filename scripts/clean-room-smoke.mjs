#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
  const tarballs = join(room, "tarballs"); mkdirSync(tarballs);
  const kernelTgz = pack(repo, tarballs);
  const adapterTgz = pack(join(repo, "packages", "pi"), tarballs);

  const app = join(room, "app"); mkdirSync(app);
  write(join(app, "package.json"), JSON.stringify({ name: "oats-clean-room", private: true, type: "module" }, null, 2));
  run("npm", ["install", "--ignore-scripts", "--legacy-peer-deps", "--no-audit", "--no-fund", kernelTgz, adapterTgz], { cwd: app });

  const kernelRoot = join(app, "node_modules", "@awebai", "oats");
  const adapterRoot = join(app, "node_modules", "@awebai", "oats-pi");
  const oats = join(app, "node_modules", ".bin", "oats");
  for (const path of [join(kernelRoot, "lib", "core.mjs"), join(kernelRoot, "capabilities", "oats-okf", "oats.json"), join(adapterRoot, "extension", "index.ts"), oats]) {
    if (!existsSync(path)) throw new Error(`packed install missing ${path}`);
  }
  if (kernelRoot.startsWith(repo) || adapterRoot.startsWith(repo)) throw new Error("smoke install did not leave the checkout");

  const home = join(room, "home"); const fakeBin = join(room, "bin"); mkdirSync(home); mkdirSync(fakeBin);
  write(join(fakeBin, "pi"), "#!/bin/sh\nexit 0\n"); chmodSync(join(fakeBin, "pi"), 0o755);

  // A CLEAN ROOM has no network. Without a bound catalog, `oats init` resolves
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
  const catalog = join(room, "catalog.json");
  write(catalog, JSON.stringify({ packages: { "oats.okf": { url: `file://${officialRepo}`, path: "oats-package" } }, capabilities: {} }, null, 2));

  const env = {
    ...process.env,
    HOME: home,
    OATS_HOME_DIR: join(home, ".oats"),
    OATS_PKG_ROOT: kernelRoot,
    OATS_PACKAGE_CATALOG: catalog,
    PATH: `${fakeBin}:${dirname(oats)}:${process.env.PATH}`,
  };
  Object.assign(process.env, env);

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

  console.log(JSON.stringify({
    passed: true,
    kernelTarball: basename(kernelTgz), adapterTarball: basename(adapterTgz),
    initDoctor: true, exactSkills: skills, canonicalSoulUnchanged: true,
    offlineOfficialCatalog: true, freshInitMaterialized: true, nothingToMigrate: true,
    adapterResolvedPackedKernel: true, cleanContractConfigAndSpawn: true,
  }, null, 2));
} finally {
  if (keep) console.error(`OATS_KEEP_SMOKE=1: retained ${room}`);
  else rmSync(room, { recursive: true, force: true });
}
