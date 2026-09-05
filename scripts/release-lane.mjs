#!/usr/bin/env node
// Runnerless release lane — .github/workflows/release.yml, off GitHub Actions.
//
// Policy (CLAUDE.md, "Shipping operating policy"): no release capability may
// permanently depend on GitHub or GitHub Actions. This script is the
// first-class build-once / stage / publish lane: each phase mirrors one job or
// step of release.yml, runs on an operator's machine, and writes its outputs
// under a stage directory (default stage/<tag>/, gitignored) so a release can
// be resumed phase by phase — including days later, or from another host for
// the Desktop legs this machine cannot build.
//
//   build           build-and-test job: clean detached export of the SHA,
//                   version bump, syntax check, tests, pack checks, tarball
//                   clean-room smoke, version probe, then `npm pack` into
//                   stage/<tag>/npm/ and MANIFEST.json.
//   desktop         one desktop-build matrix leg for the current host/arch.
//   stage           the publish job's "Checksums" step (SHA256SUMS.txt).
//   publish-npm     the publish job's two guarded `npm publish` steps.
//   tag             the tag push that would have triggered release.yml.
//   release-github  the publish job's `gh release create|upload` step.
//   status          what has run, what exists, what remains.
//
// What the lane cannot produce: GitHub build-provenance attestations
// (actions/attest-build-provenance) and npm provenance. Pushing the tag
// afterwards runs release.yml, whose steps are idempotent, so a later runner
// pass fills those in without republishing anything already live.
//
// Discipline: the checkout this runs from is never mutated beyond creating
// stage/; every build command runs inside the export. Every external command
// is printed before it runs and its output is logged under stage/<tag>/logs/.
// Zero dependencies beyond node builtins and the repository's own scripts.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync,
  rmSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const KERNEL = "@awebai/oats";
const ADAPTER = "@awebai/oats-pi";
const SHIPPED_JS = ["bin/*.mjs", "lib/*.mjs", "capabilities/*/bin/*.mjs", "capabilities/*/skills/*/scripts/*.mjs"];
const DESKTOP_LEGS = [
  { os: "mac", arch: "arm64", exts: ["dmg", "zip"], host: "macOS (arm64 host)" },
  { os: "mac", arch: "x64", exts: ["dmg", "zip"], host: "macOS (x64 host, or arm64 host with Rosetta)" },
  { os: "linux", arch: "x64", exts: ["AppImage", "deb"], host: "Linux x64 host" },
];
const PHASES = ["build", "desktop", "stage", "publish-npm", "tag", "release-github", "status"];

const HELP = `usage: node scripts/release-lane.mjs <phase> --tag vX.Y.Z [options]

Runnerless mirror of .github/workflows/release.yml. Outputs accumulate under
the stage directory (default: stage/<tag>/ in this checkout, gitignored) so a
release is resumable phase by phase. The checkout itself is never modified.

phases (in release order)
  build           Build once from a clean detached export of --sha (default
                  HEAD): release-notes gate, version bump of root, packages/pi
                  and packages/desktop, node --check on every shipped .mjs,
                  npm ci, npm run check, desktop test deps, npm test,
                  pack:check, smoke:tarball, the version --json probe, then
                  npm pack both packages into stage/<tag>/npm/ and write
                  MANIFEST.json. Refuses on a dirty tree.
  desktop         One desktop-build matrix leg on THIS machine: desktop
                  npm ci, npm test, npm run dist -- --<arch>, strict deep
                  codesign verification (macOS), dist:smoke in build-verify
                  mode, then copy dist/oats-desktop-* into stage/<tag>/assets/.
                  macOS legs (arm64, and x64 via Rosetta) run on a Mac. The
                  Linux AppImage/DEB leg needs a Linux host: copy or check out
                  the repo there and run this same command (--arch x64), then
                  bring stage/<tag>/assets/ back together before "stage".
  stage           Write stage/<tag>/assets/SHA256SUMS.txt (shasum -a 256, the
                  workflow's format) and report which assets are staged and
                  which are missing.
  publish-npm     Publish the staged tarballs: ${KERNEL} first, then
                  ${ADAPTER}, --access public, each skipped when
                  npm view reports that exact version live (same-tag retry).
                  Auth is whatever npm is logged in as, or NPM_TOKEN if set
                  (written to a temporary .npmrc, never into the repo).
                  Off-runner publishes carry NO npm provenance attestation.
  tag             Create the annotated tag on the SHA recorded in
                  MANIFEST.json if it does not exist; push it only with
                  --push --yes. Pushing triggers release.yml, whose steps are
                  idempotent: a later runner pass only fills in what this lane
                  cannot produce (GitHub provenance attestations).
  release-github  gh release create <tag> stage/<tag>/assets/* (or gh release
                  upload --clobber when the release exists). Requires the tag
                  on origin at the recorded SHA.
  status          Print MANIFEST.json, which phases have run, which artifacts
                  exist, and what remains.

options
  --tag vX.Y.Z       release tag; the version is derived from it (required)
  --sha <commit>     build: commit to export (default HEAD)
  --arch arm64|x64   desktop: electron-builder target arch (required)
  --stage <dir>      stage directory (default <repo>/stage/<tag>)
  --export <dir>     export directory (default: recorded in MANIFEST.json, or
                     <tmpdir>/oats-release-lane/<tag>-<sha>)
  --allow-off-main   build: skip the "SHA is on origin/main" gate (the
                     workflow's gate; the risk is yours to report)
  --force            build: discard a stage directory built from another SHA
  --dry-run          publish-npm: pass --dry-run to npm publish
  --yes              publish-npm, release-github: actually publish;
                     tag: required together with --push
  --push             tag: push the tag to origin (needs --yes)
  --help             this text

exit status: 0 ok, 1 a step failed (the log path is printed), 2 refused.
`;

// ----------------------------------------------------------------- utilities

class LaneError extends Error {
  constructor(message, { exitCode = 1 } = {}) { super(message); this.exitCode = exitCode; }
}
const refuse = (message) => new LaneError(message, { exitCode: 2 });
const say = (line) => console.log(`[lane] ${line}`);

function parseArgs(argv) {
  const opts = { _: [] };
  const withValue = new Set(["tag", "sha", "arch", "stage", "export"]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) { opts._.push(arg); continue; }
    const [key, inline] = arg.slice(2).split("=", 2);
    if (withValue.has(key)) {
      const value = inline ?? argv[++i];
      if (value === undefined) throw refuse(`--${key} needs a value`);
      opts[key] = value;
    } else opts[key] = true;
  }
  return opts;
}

function versionFromTag(tag) {
  const m = /^v(\d+\.\d+\.\d+)$/.exec(tag || "");
  if (!m) throw refuse(`--tag must look like vX.Y.Z (got ${JSON.stringify(tag ?? "")})`);
  return m[1];
}

const shellQuote = (s) => (/^[\w./:@=+,-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`);
function describe(command, args, { cwd, env } = {}) {
  const envText = Object.entries(env || {}).map(([k, v]) => `${k}=${shellQuote(String(v))} `).join("");
  const text = `${envText}${[command, ...args].map(shellQuote).join(" ")}`;
  return cwd ? `(cd ${shellQuote(cwd)} && ${text})` : text;
}

/** Synchronous capture for short git/npm queries; never logged, printed only when `show`. */
function capture(command, args, { cwd, env, show = false } = {}) {
  if (show) say(`$ ${describe(command, args, { cwd })}`);
  const r = spawnSync(command, args, { cwd, env: env ? { ...process.env, ...env } : process.env, encoding: "utf8" });
  if (r.error) throw new LaneError(`${command}: ${r.error.message}`);
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}
function git(repo, args, options = {}) {
  const r = capture("git", ["-C", repo, ...args], options);
  if (r.status !== 0 && !options.allowFailure) throw new LaneError(`git ${args.join(" ")} failed:\n${r.stderr.trim()}`);
  return r.stdout.trim();
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function writeJson(path, value) { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); }

// ------------------------------------------------------------------ the lane

class Lane {
  constructor(opts) {
    this.opts = opts;
    this.tag = opts.tag;
    this.version = versionFromTag(opts.tag);
    this._repoRoot = null;
    this.stageDir = opts.stage ? resolve(opts.stage) : join(this.repoRoot, "stage", this.tag);
    this.logsDir = join(this.stageDir, "logs");
    this.manifestPath = join(this.stageDir, "MANIFEST.json");
    this.stepCount = 0;
    this.phase = null;
    this.manifest = existsSync(this.manifestPath) ? JSON.parse(readFileSync(this.manifestPath, "utf8")) : null;
  }

  get repoRoot() {
    if (!this._repoRoot) {
      const r = capture("git", ["rev-parse", "--show-toplevel"]);
      if (r.status !== 0) throw refuse("not inside a git checkout (run from the repository, or pass --stage)");
      this._repoRoot = r.stdout.trim();
    }
    return this._repoRoot;
  }

  requireManifest() {
    if (!this.manifest) throw refuse(`${this.manifestPath} does not exist — run "build --tag ${this.tag}" first`);
    if (this.manifest.tag !== this.tag) throw new LaneError(`${this.manifestPath} is for ${this.manifest.tag}, not ${this.tag}`);
    return this.manifest;
  }

  saveManifest() { mkdirSync(this.stageDir, { recursive: true }); writeJson(this.manifestPath, this.manifest); }

  recordPhase(name, extra = {}) {
    this.manifest.phases ??= {};
    this.manifest.phases[name] = { completedAt: new Date().toISOString(), host: `${process.platform}-${process.arch}`, ...extra };
    this.saveManifest();
  }

  /**
   * Run one logged step. Prints the command, tees stdout/stderr to the
   * terminal and to logs/<phase>-<NN>-<slug>.log, and throws with the log
   * path on a non-zero exit (unless allowFailure).
   */
  step(name, command, args, { cwd, env = {}, allowFailure = false, quiet = false } = {}) {
    this.stepCount++;
    mkdirSync(this.logsDir, { recursive: true });
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const logPath = join(this.logsDir, `${this.phase}-${String(this.stepCount).padStart(2, "0")}-${slug}.log`);
    const shown = describe(command, args, { cwd, env });
    say(`step ${this.stepCount}: ${name}`);
    say(`$ ${shown}`);
    const log = createWriteStream(logPath);
    log.write(`# ${name}\n# ${new Date().toISOString()}\n# ${shown}\n\n`);
    const started = Date.now();
    return new Promise((resolvePromise, reject) => {
      let child;
      try {
        child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
      } catch (error) { reject(new LaneError(`${name}: ${error.message}`)); return; }
      let stdout = "", stderr = "", combined = "";
      const tee = (stream, sink) => stream.on("data", (chunk) => {
        const text = String(chunk);
        combined += text;
        if (sink === "out") stdout += text; else stderr += text;
        log.write(chunk);
        if (!quiet) process[sink === "out" ? "stdout" : "stderr"].write(chunk);
      });
      tee(child.stdout, "out"); tee(child.stderr, "err");
      child.on("error", (error) => { log.end(); reject(new LaneError(`${name}: ${error.message} (log: ${logPath})`)); });
      child.on("close", (status) => {
        const seconds = ((Date.now() - started) / 1000).toFixed(1);
        log.end(`\n# exit ${status} after ${seconds}s\n`);
        const result = { status, stdout, stderr, combined, logPath, seconds };
        if (status === 0 || allowFailure) { say(`${status === 0 ? "ok" : `exit ${status} (allowed)`} (${seconds}s) — ${logPath}`); resolvePromise(result); }
        else reject(new LaneError(`${name} failed (exit ${status}) after ${seconds}s — log: ${logPath}`));
      });
    });
  }

  // --------------------------------------------------------------- export
  defaultExportDir(sha) { return join(tmpdir(), "oats-release-lane", `${this.tag}-${sha.slice(0, 12)}`); }

  removeExport(dir) {
    if (!existsSync(dir)) { git(this.repoRoot, ["worktree", "prune"]); return; }
    say(`removing previous export ${dir}`);
    const r = capture("git", ["-C", this.repoRoot, "worktree", "remove", "--force", dir], { show: true });
    if (r.status !== 0) rmSync(dir, { recursive: true, force: true });
    git(this.repoRoot, ["worktree", "prune"]);
  }

  /** Clean detached export of `sha`: a git worktree so `git ls-files` works exactly as in the workflow. */
  createExport(dir, sha) {
    this.removeExport(dir);
    mkdirSync(resolve(dir, ".."), { recursive: true });
    say(`$ ${describe("git", ["-C", this.repoRoot, "worktree", "add", "--detach", dir, sha])}`);
    git(this.repoRoot, ["worktree", "add", "--detach", dir, sha]);
    const head = git(dir, ["rev-parse", "HEAD"]);
    if (head !== sha) throw new LaneError(`export HEAD is ${head}, expected ${sha}`);
    return dir;
  }

  /**
   * The three-manifest bump the workflow performs in every job (uncommitted,
   * export only). A manifest that already reads the tag version is left alone:
   * `npm version` exits 1 with "Version not changed" there, and the step's
   * intent — every manifest reads X.Y.Z — is already met.
   */
  async bumpManifests(exportDir) {
    for (const sub of [".", "packages/pi", "packages/desktop"]) {
      const name = sub === "." ? "root" : sub;
      const current = JSON.parse(readFileSync(join(exportDir, sub, "package.json"), "utf8")).version;
      if (current === this.version) { say(`${name} package.json already at ${this.version} — no bump needed`); continue; }
      await this.step(`bump ${name} ${current} -> ${this.version}`, "npm", ["version", this.version, "--no-git-tag-version"], { cwd: join(exportDir, sub) });
    }
  }

  /** Reuse the recorded export when it is still the right SHA; otherwise recreate it deterministically. */
  async ensureExport() {
    const { sha } = this.requireManifest();
    const dir = this.opts.export ? resolve(this.opts.export) : (this.manifest.export || this.defaultExportDir(sha));
    if (existsSync(join(dir, "package.json"))) {
      const head = capture("git", ["-C", dir, "rev-parse", "HEAD"]);
      const desktopVersion = JSON.parse(readFileSync(join(dir, "packages/desktop/package.json"), "utf8")).version;
      if (head.status === 0 && head.stdout.trim() === sha && desktopVersion === this.version) { say(`reusing export ${dir} (HEAD ${sha})`); return dir; }
      say(`export ${dir} is stale (HEAD ${head.stdout.trim() || "?"}, desktop ${desktopVersion}) — recreating`);
    }
    this.createExport(dir, sha);
    await this.bumpManifests(dir);
    this.manifest.export = dir;
    this.saveManifest();
    return dir;
  }

  // ---------------------------------------------------------------- build
  async build() {
    this.phase = "build";
    const repo = this.repoRoot;
    const dirty = git(repo, ["status", "--porcelain"]);
    if (dirty) throw refuse(`working tree is not clean — commit or stash first:\n${dirty}`);
    const sha = git(repo, ["rev-parse", "--verify", `${this.opts.sha || "HEAD"}^{commit}`]);
    say(`tag ${this.tag} (version ${this.version}) from ${sha}`);

    // release.yml: "Verify the tag is on main" (against the LOCAL origin/main —
    // fetch first if it may be stale; --allow-off-main is the human override).
    if (!this.opts["allow-off-main"]) {
      const onMain = capture("git", ["-C", repo, "merge-base", "--is-ancestor", sha, "origin/main"]);
      if (onMain.status !== 0) throw refuse(`${sha} is not on origin/main (or origin/main is unknown here) — releases are cut from main only. Fetch, or pass --allow-off-main and report the risk.`);
    }

    if (this.manifest && this.manifest.sha !== sha) {
      if (!this.opts.force) throw refuse(`${this.stageDir} was built from ${this.manifest.sha}, not ${sha} — remove it or pass --force`);
      say(`--force: discarding ${this.stageDir}`);
      rmSync(this.stageDir, { recursive: true, force: true });
      this.manifest = null;
    }
    const npmDir = join(this.stageDir, "npm");
    rmSync(npmDir, { recursive: true, force: true });
    mkdirSync(npmDir, { recursive: true });
    this.manifest = {
      lane: "scripts/release-lane.mjs", tag: this.tag, version: this.version, sha,
      createdAt: new Date().toISOString(),
      node: process.version, npm: capture("npm", ["--version"]).stdout.trim(), platform: `${process.platform}-${process.arch}`,
      export: null, phases: {}, npm: { tarballs: [] }, assets: this.manifest?.assets ?? [],
    };
    this.saveManifest();

    const exportDir = this.opts.export ? resolve(this.opts.export) : this.defaultExportDir(sha);
    this.createExport(exportDir, sha);
    this.manifest.export = exportDir;
    this.saveManifest();

    // release.yml: "Verify release notes exist for this tag" — before any build spend.
    const notes = `docs/release-notes/${this.tag}.md`;
    if (!existsSync(join(exportDir, notes))) throw new LaneError(`missing ${notes} at ${sha} — the release-notes filename must match the tag`);
    say(`release notes present: ${notes}`);

    await this.bumpManifests(exportDir);

    // "Syntax-check all shipped JS" — same pathspecs, same node --check.
    const shipped = git(exportDir, ["ls-files", ...SHIPPED_JS]).split("\n").filter(Boolean);
    if (!shipped.length) throw new LaneError("git ls-files found no shipped .mjs files");
    for (const file of shipped) await this.step(`node --check ${file}`, "node", ["--check", file], { cwd: exportDir, quiet: true });

    // "Test capability resolution and package commands"
    await this.step("npm ci --ignore-scripts", "npm", ["ci", "--ignore-scripts"], { cwd: exportDir });
    await this.step("npm run check", "npm", ["run", "check"], { cwd: exportDir });
    await this.step("desktop test deps", "npm", ["ci"], { cwd: join(exportDir, "packages/desktop"), env: { ELECTRON_SKIP_BINARY_DOWNLOAD: "1" } });
    await this.step("npm test", "npm", ["test"], { cwd: exportDir });

    // "Sanity-check tarballs" — pack:check plus the workflow's own greps.
    await this.step("npm run pack:check", "npm", ["run", "pack:check"], { cwd: exportDir });
    const kernelDry = await this.step("kernel pack dry run", "npm", ["pack", "--dry-run"], { cwd: exportDir, quiet: true });
    if (!kernelDry.combined.includes(`name: ${KERNEL}`)) throw new LaneError(`kernel pack check failed — log: ${kernelDry.logPath}`);
    const leaked = kernelDry.combined.split("\n").filter((line) => /^npm notice/.test(line) && / (agents\/|oats-config\.yaml)/.test(line));
    if (leaked.length) throw new LaneError(`kernel tarball contains workspace state:\n${leaked.join("\n")}`);
    const adapterDry = await this.step("adapter pack dry run", "npm", ["pack", "--dry-run"], { cwd: join(exportDir, "packages/pi"), quiet: true });
    if (!adapterDry.combined.includes(`name: ${ADAPTER}`)) throw new LaneError(`adapter pack check failed — log: ${adapterDry.logPath}`);

    // "Clean-room tarball smoke"
    await this.step("npm run smoke:tarball", "npm", ["run", "smoke:tarball"], { cwd: exportDir });

    // "Probe the Desktop CLI API v1 contract from the bumped tree"
    await this.step("version --json probe", "node", ["scripts/check-version-probe.mjs", this.version], { cwd: exportDir });

    // Pack once; everything downstream publishes these exact bytes.
    for (const [pkg, sub] of [[KERNEL, "."], [ADAPTER, "packages/pi"]]) {
      const packed = await this.step(`npm pack ${pkg}`, "npm", ["pack", "--json", "--pack-destination", npmDir], { cwd: join(exportDir, sub), quiet: true });
      const [info] = JSON.parse(packed.stdout);
      const path = join(npmDir, info.filename);
      this.manifest.npm.tarballs.push({ package: pkg, version: this.version, filename: info.filename, sha256: await sha256(path), size: statSync(path).size });
      say(`packed ${info.filename} (${info.entryCount} files)`);
    }
    this.recordPhase("build", { export: exportDir, steps: this.stepCount, shippedJsChecked: shipped.length });
    say(`build complete — ${this.manifestPath}`);
    say(`export kept for the desktop phase: ${exportDir}`);
  }

  // -------------------------------------------------------------- desktop
  async desktop() {
    this.phase = "desktop";
    const arch = this.opts.arch;
    if (!["arm64", "x64"].includes(arch)) throw refuse("desktop needs --arch arm64|x64");
    const manifest = this.requireManifest();
    if (!manifest.phases?.build) throw refuse(`build has not completed for ${this.tag} — run build first`);
    const os = process.platform === "darwin" ? "mac" : process.platform === "linux" ? "linux" : null;
    if (!os) throw refuse(`desktop legs build on macOS or Linux only (this is ${process.platform})`);
    if (os === "mac" && arch === "x64" && process.arch === "arm64") say("x64 cross-build on an arm64 host: Rosetta must be installed for the packaged-app ABI probe");
    const leg = DESKTOP_LEGS.find((l) => l.os === os && l.arch === arch);
    if (!leg) throw refuse(`no release matrix leg for ${os}-${arch}`);
    const exportDir = await this.ensureExport();
    const desktopDir = join(exportDir, "packages/desktop");
    const env = { CSC_IDENTITY_AUTO_DISCOVERY: "false" };

    // "Build Desktop distributables"
    rmSync(join(desktopDir, "dist"), { recursive: true, force: true });
    await this.step("desktop npm ci", "npm", ["ci"], { cwd: desktopDir, env });
    await this.step("desktop npm test", "npm", ["test"], { cwd: desktopDir, env });
    await this.step(`npm run dist -- --${arch}`, "npm", ["run", "dist", "--", `--${arch}`], { cwd: desktopDir, env });

    // "Verify macOS ad-hoc signature (strict deep codesign)"
    if (os === "mac") {
      const app = findApp(join(desktopDir, "dist"));
      if (!app) throw new LaneError("no packaged .app found under dist/");
      say(`strict deep codesign verification: ${app}`);
      await this.step("codesign verify", "codesign", ["--verify", "--deep", "--strict", "--verbose=2", app], { cwd: desktopDir });
    }

    // "Installed-artifact smoke (build-verify)"
    await this.step("npm run dist:smoke", "npm", ["run", "dist:smoke"], {
      cwd: desktopDir, env: { ...env, OATS_SMOKE_SKIP_LAUNCH: "1", OATS_SMOKE_BUILD_VERIFY: "1", OATS_SMOKE_TARGET_ARCH: arch },
    });

    // upload-artifact: dist/oats-desktop-* → stage/<tag>/assets/
    const assetsDir = join(this.stageDir, "assets");
    mkdirSync(assetsDir, { recursive: true });
    const produced = readdirSync(join(desktopDir, "dist")).filter((f) => f.startsWith("oats-desktop-") && statSync(join(desktopDir, "dist", f)).isFile());
    if (!produced.length) throw new LaneError("npm run dist produced no dist/oats-desktop-* files");
    const built = [];
    for (const file of produced) {
      copyFileSync(join(desktopDir, "dist", file), join(assetsDir, file));
      built.push({ filename: file, sha256: await sha256(join(assetsDir, file)), size: statSync(join(assetsDir, file)).size, os, arch });
      say(`staged ${file}`);
    }
    this.manifest.assets = [...(this.manifest.assets || []).filter((a) => !produced.includes(a.filename)), ...built];
    this.manifest.phases[`desktop-${os}-${arch}`] = { completedAt: new Date().toISOString(), host: `${process.platform}-${process.arch}`, files: produced };
    this.recordPhase("desktop", { legs: Object.keys(this.manifest.phases).filter((p) => p.startsWith("desktop-")) });
    say(`desktop ${os}-${arch} complete — ${produced.length} file(s) in ${assetsDir}`);
  }

  // ---------------------------------------------------------------- stage
  async stage() {
    this.phase = "stage";
    const manifest = this.requireManifest();
    const assetsDir = join(this.stageDir, "assets");
    const files = existsSync(assetsDir) ? readdirSync(assetsDir).filter((f) => f !== "SHA256SUMS.txt" && statSync(join(assetsDir, f)).isFile()).sort() : [];
    if (!files.length) throw refuse(`${assetsDir} has no assets — run the desktop legs first`);
    // release.yml: "Checksums" — shasum -a 256 * > SHA256SUMS.txt
    const sums = await this.step("SHA256SUMS", "shasum", ["-a", "256", ...files], { cwd: assetsDir, quiet: true });
    writeFileSync(join(assetsDir, "SHA256SUMS.txt"), sums.stdout);
    const digests = Object.fromEntries(sums.stdout.split("\n").filter(Boolean).map((line) => { const [hex, name] = line.split(/\s+/); return [name, hex]; }));

    const expected = DESKTOP_LEGS.flatMap((leg) => leg.exts.map((ext) => ({ leg, file: `oats-desktop-${manifest.version}-${leg.os}-${leg.arch}.${ext}` })));
    const staged = files;
    const missing = expected.filter(({ file }) => !files.includes(file));
    manifest.assets = files.map((file) => ({
      ...(manifest.assets || []).find((a) => a.filename === file), filename: file, sha256: digests[file], size: statSync(join(assetsDir, file)).size,
    }));
    this.recordPhase("stage", { checksums: "assets/SHA256SUMS.txt", staged, missing: missing.map((m) => m.file) });

    say(`staged in ${assetsDir}:`);
    for (const file of files) say(`  ${digests[file]}  ${file}`);
    if (missing.length) {
      say("missing (build these legs on the host named, then rerun stage):");
      for (const { leg, file } of missing) say(`  ${file} — ${leg.host}`);
    } else say("all release-matrix assets present");
    say("SHA256SUMS.txt written; provenance attestations cannot be produced off-runner");
  }

  // ---------------------------------------------------------- publish-npm
  async publishNpm() {
    this.phase = "publish-npm";
    const manifest = this.requireManifest();
    const tarballs = manifest.npm?.tarballs || [];
    if (tarballs.length !== 2) throw refuse(`MANIFEST.json lists ${tarballs.length} tarball(s); build must have packed both packages`);
    const ordered = [KERNEL, ADAPTER].map((pkg) => {
      const entry = tarballs.find((t) => t.package === pkg);
      if (!entry) throw new LaneError(`no staged tarball for ${pkg}`);
      return { ...entry, path: join(this.stageDir, "npm", entry.filename) };
    });
    for (const t of ordered) {
      if (!existsSync(t.path)) throw new LaneError(`staged tarball missing: ${t.path}`);
      const digest = await sha256(t.path);
      if (digest !== t.sha256) throw new LaneError(`${t.filename} sha256 ${digest} differs from MANIFEST.json (${t.sha256}) — rebuild`);
    }
    const dryRun = Boolean(this.opts["dry-run"]);
    say(`would publish (${dryRun ? "npm --dry-run" : "LIVE"}), in order:`);
    for (const t of ordered) say(`  ${t.package}@${t.version}  ${t.filename}  sha256 ${t.sha256}`);
    say("note: an off-runner publish carries no npm provenance attestation");
    if (!this.opts.yes) throw refuse("refusing to publish without --yes");

    let userconfigDir = null;
    const env = {};
    if (process.env.NPM_TOKEN) {
      userconfigDir = mkdtempSync(join(tmpdir(), "oats-release-npmrc-"));
      writeFileSync(join(userconfigDir, ".npmrc"), `//registry.npmjs.org/:_authToken=${process.env.NPM_TOKEN}\n`, { mode: 0o600 });
      env.NPM_CONFIG_USERCONFIG = join(userconfigDir, ".npmrc");
      say(`NPM_TOKEN set — using a temporary userconfig ${env.NPM_CONFIG_USERCONFIG}`);
    } else say("NPM_TOKEN not set — publishing as whatever npm is logged in as");

    const results = [];
    try {
      for (const t of ordered) {
        const spec = `${t.package}@${t.version}`;
        // release.yml: "Publish ... (idempotent — skip if this exact version is live)"
        const live = await this.step(`npm view ${spec}`, "npm", ["view", spec, "version"], { allowFailure: true, quiet: true, env });
        if (live.status === 0) { say(`${spec} already published — skipping (same-tag retry)`); results.push({ package: t.package, status: "already-published" }); continue; }
        const args = ["publish", t.path, "--access", "public", ...(dryRun ? ["--dry-run"] : [])];
        await this.step(`npm publish ${t.filename}`, "npm", args, { cwd: this.stageDir, env });
        results.push({ package: t.package, status: dryRun ? "dry-run" : "published" });
      }
    } finally {
      if (userconfigDir) rmSync(userconfigDir, { recursive: true, force: true });
    }
    if (!dryRun) this.recordPhase("publish-npm", { results });
    else say("dry run: MANIFEST.json not marked as published");
    for (const r of results) say(`${r.package}: ${r.status}`);
  }

  // ------------------------------------------------------------------ tag
  async tagPhase() {
    this.phase = "tag";
    const { sha } = this.requireManifest();
    const repo = this.repoRoot;
    const existing = capture("git", ["-C", repo, "rev-parse", "--verify", "-q", `refs/tags/${this.tag}^{commit}`]);
    if (existing.status === 0) {
      const at = existing.stdout.trim();
      if (at !== sha) throw new LaneError(`tag ${this.tag} already exists at ${at}, but the staged build is ${sha}`);
      say(`tag ${this.tag} already exists at ${sha}`);
    } else {
      await this.step(`git tag ${this.tag}`, "git", ["tag", "-a", this.tag, sha, "-m", `OATS ${this.tag}`], { cwd: repo });
      say(`created annotated tag ${this.tag} at ${sha}`);
    }
    if (this.opts.push) {
      if (!this.opts.yes) throw refuse("refusing to push the tag without --yes");
      await this.step(`git push origin ${this.tag}`, "git", ["push", "origin", `refs/tags/${this.tag}`], { cwd: repo });
      this.recordPhase("tag", { sha, pushed: true });
      say("tag pushed. This triggers .github/workflows/release.yml; its steps are idempotent, so a runner pass skips already-live npm versions, re-uploads the same assets, and only adds what this lane cannot produce: GitHub build-provenance attestations.");
    } else {
      this.recordPhase("tag", { sha, pushed: false });
      say(`tag not pushed. Push with: node scripts/release-lane.mjs tag --tag ${this.tag} --push --yes (this triggers release.yml, whose idempotent steps only fill in attestations).`);
    }
  }

  // ------------------------------------------------------- release-github
  async releaseGithub() {
    this.phase = "release-github";
    const { sha } = this.requireManifest();
    const repo = this.repoRoot;
    const assetsDir = join(this.stageDir, "assets");
    if (!existsSync(join(assetsDir, "SHA256SUMS.txt"))) throw refuse("assets/SHA256SUMS.txt missing — run stage first");
    const assets = readdirSync(assetsDir).filter((f) => statSync(join(assetsDir, f)).isFile()).sort().map((f) => join(assetsDir, f));
    // The tag must be on origin at the recorded SHA (release.yml only ever runs from a pushed tag).
    const remote = git(repo, ["ls-remote", "--tags", "origin", `refs/tags/${this.tag}`, `refs/tags/${this.tag}^{}`]);
    if (!remote) throw refuse(`tag ${this.tag} is not on origin — run "tag --tag ${this.tag} --push --yes" first`);
    const peeled = remote.split("\n").map((l) => l.split(/\s+/)).find(([, ref]) => ref.endsWith("^{}")) || remote.split("\n")[0].split(/\s+/);
    if (peeled[0] !== sha) throw new LaneError(`origin tag ${this.tag} points at ${peeled[0]}, but the staged build is ${sha}`);
    const notesPath = join(this.stageDir, `${this.tag}.notes.md`);
    writeFileSync(notesPath, git(repo, ["show", `${sha}:docs/release-notes/${this.tag}.md`]));
    say(`would attach ${assets.length} asset(s) from ${assetsDir} with notes docs/release-notes/${this.tag}.md@${sha.slice(0, 12)}`);
    if (!this.opts.yes) throw refuse("refusing to create the GitHub Release without --yes");

    // release.yml: "Create the GitHub Release (idempotent — upload assets if it exists)"
    const view = await this.step(`gh release view ${this.tag}`, "gh", ["release", "view", this.tag], { cwd: repo, allowFailure: true, quiet: true });
    if (view.status === 0) {
      say(`release ${this.tag} exists — re-uploading assets (same-tag retry)`);
      await this.step("gh release upload --clobber", "gh", ["release", "upload", this.tag, ...assets, "--clobber"], { cwd: repo });
    } else {
      await this.step("gh release create", "gh", ["release", "create", this.tag, ...assets, "--title", `OATS ${this.tag}`, "--notes-file", notesPath, "--verify-tag"], { cwd: repo });
    }
    this.recordPhase("release-github", { assets: assets.map((a) => basename(a)) });
    say("GitHub Release done. Not produced off-runner: build-provenance attestations (a release.yml run from the pushed tag adds them).");
  }

  // --------------------------------------------------------------- status
  status() {
    if (!this.manifest) { say(`${this.manifestPath} does not exist — nothing has run for ${this.tag}; start with: node scripts/release-lane.mjs build --tag ${this.tag}`); return; }
    const m = this.requireManifest();
    console.log(JSON.stringify(m, null, 2));
    say(`stage: ${this.stageDir}`);
    say(`export: ${m.export || "-"} (${m.export && existsSync(m.export) ? "present" : "absent — the desktop phase recreates it"})`);
    say("phases:");
    const ran = m.phases || {};
    for (const p of PHASES.filter((p) => p !== "status")) say(`  ${ran[p] ? "done" : "    "}  ${p}${ran[p] ? `  ${ran[p].completedAt}` : ""}`);
    for (const p of Object.keys(ran).filter((p) => p.startsWith("desktop-"))) say(`  done  ${p}  ${ran[p].completedAt}`);
    say("artifacts:");
    for (const t of m.npm?.tarballs || []) say(`  ${existsSync(join(this.stageDir, "npm", t.filename)) ? "ok " : "MISSING"}  npm/${t.filename}`);
    const assetsDir = join(this.stageDir, "assets");
    for (const leg of DESKTOP_LEGS) for (const ext of leg.exts) {
      const file = `oats-desktop-${m.version}-${leg.os}-${leg.arch}.${ext}`;
      say(`  ${existsSync(join(assetsDir, file)) ? "ok " : "   "}  assets/${file}${existsSync(join(assetsDir, file)) ? "" : `  (desktop --arch ${leg.arch} on ${leg.host})`}`);
    }
    say(`  ${existsSync(join(assetsDir, "SHA256SUMS.txt")) ? "ok " : "   "}  assets/SHA256SUMS.txt`);
    const remaining = PHASES.filter((p) => p !== "status" && !ran[p]);
    say(`remaining: ${remaining.length ? remaining.join(", ") : "nothing — release complete (attestations require a release.yml run)"}`);
  }
}

function findApp(dist) {
  if (!existsSync(dist)) return null;
  for (const entry of readdirSync(dist)) {
    const path = join(dist, entry);
    if (entry.endsWith(".app")) return path;
    if (statSync(path).isDirectory()) for (const inner of readdirSync(path)) if (inner.endsWith(".app")) return join(path, inner);
  }
  return null;
}

// ----------------------------------------------------------------- main

async function main(argv) {
  const opts = parseArgs(argv);
  const phase = opts._[0];
  if (opts.help || !phase) { process.stdout.write(HELP); return opts.help ? 0 : 2; }
  if (!PHASES.includes(phase)) throw refuse(`unknown phase ${JSON.stringify(phase)} — one of ${PHASES.join(", ")}`);
  if (opts._.length > 1) throw refuse(`unexpected argument ${JSON.stringify(opts._[1])}`);
  const lane = new Lane(opts);
  switch (phase) {
    case "build": await lane.build(); break;
    case "desktop": await lane.desktop(); break;
    case "stage": await lane.stage(); break;
    case "publish-npm": await lane.publishNpm(); break;
    case "tag": await lane.tagPhase(); break;
    case "release-github": await lane.releaseGithub(); break;
    case "status": lane.status(); break;
  }
  return 0;
}

main(process.argv.slice(2)).then((code) => process.exit(code), (error) => {
  console.error(`[lane] ${error instanceof LaneError ? "" : "unexpected: "}${error.message}`);
  process.exit(error instanceof LaneError ? error.exitCode : 1);
});
