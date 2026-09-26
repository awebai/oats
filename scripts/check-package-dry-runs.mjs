#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CAPABILITY_PATHS, checkOkfMirror } from "./check-okf-mirror.mjs";
import { checkKnowledgeTheoryPackage, treeFiles } from "./check-knowledge-theory-package.mjs";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// One recursive inventory for local check, PR/release CI and the runnerless
// lane. Do not rely on git ls-files: a new candidate file needs checking BEFORE
// it is committed too. Capability libs and nested record/package scripts must
// not silently fall between hand-maintained one-level globs.
export const JS_ROOTS = [
  "bin", "lib", "capabilities", "oats-package", "packages/record/bin",
  "packages/record/lib", "packages/pi/extension", "scripts",
];
export function shippedJavaScript(root = ROOT) {
  const files = [];
  function walk(dir) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      // Never follow links into a checkout, installed dependencies or state.
      if (entry.isDirectory() && !["node_modules", ".git", ".agents"].includes(entry.name)) walk(path);
      else if (entry.isFile() && [".mjs", ".js", ".cjs"].includes(extname(path))) files.push(relative(root, path));
    }
  }
  for (const dir of JS_ROOTS) walk(join(root, dir));
  return [...new Set(files)].sort();
}
export function checkJavaScript(root = ROOT) {
  const files = shippedJavaScript(root);
  assert.ok(files.length, "no shipped/support JavaScript found");
  for (const file of files) {
    try { execFileSync(process.execPath, ["--check", join(root, file)], { stdio: ["ignore", "pipe", "pipe"] }); }
    catch (error) { throw new Error(`syntax error in ${file}: ${error.stderr || error.message}`); }
  }
  return files.length;
}

function dryRun(cwd) {
  return JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }))[0];
}
export function requireFiles(pack, required) {
  const files = new Set(pack.files.map((file) => file.path));
  for (const path of required) if (!files.has(path)) throw new Error(`${pack.name} dry run missing ${path}`);
  return files;
}
export function checkKernelPackFiles(pack, root = ROOT) {
  // The optional package is a separate Git payload, NOT an npm payload.
  // Keep its strict source alias/closure gate; never bless npm's partial copy
  // by checking only regular files or by manufacturing a missing source alias.
  checkKnowledgeTheoryPackage({ repoRoot: root });
  const inventory = checkOkfMirror({ repoRoot: root });
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.ok(!manifest.files.some((path) => /^\/?oats-package(?:\/|$)/.test(path)), "npm files must not include the Git-only oats-package payload");
  const canonicalFiles = ["docs/knowledge-capability-authoring.md", ...treeFiles(join(root, "docs/knowledge-reference")).map((f) => `docs/knowledge-reference/${f}`)];
  const files = requireFiles(pack, [
    "bin/oats.mjs", "lib/core.mjs", "lib/tmux-config.mjs", "capabilities/oats-okf/oats.json",
    "capabilities/oats-authoring/oats.json", "docs/capabilities.md", "docs/capability-manifest.schema.json",
    "package-catalog.json", "package.json", "packages/record/bin/capture.mjs", "packages/record/bin/recall.mjs",
    ...canonicalFiles,
    ...inventory.entries.filter((entry) => entry.type === "file").map((entry) => entry.path),
  ]);
  for (const path of files) {
    if (path === "oats-package" || path.startsWith("oats-package/")) {
      throw new Error(`kernel tarball contains Git-only optional package file ${path}`);
    }
    if (path.startsWith("agents/") || path === "oats-config.yaml" || path === "oats-lock.json"
      || path.startsWith("test/") || path.startsWith("tests/") || path.split("/").some((part) => [".agents", ".git", "instances"].includes(part))) {
      throw new Error(`kernel tarball leaks non-runtime file ${path}`);
    }
  }
  const expected = inventory.entries.filter((entry) => entry.type === "file");
  assert.deepEqual([...files].filter((path) => CAPABILITY_PATHS.some((cap) => path.startsWith(`${cap}/`))).sort(),
    expected.map((entry) => entry.path).sort(),
    "npm OKF regular file-set drift; source symlinks must be omitted, never synthesized");
  const sizes = new Map(pack.files.map((entry) => [entry.path, entry.size]));
  for (const entry of expected) assert.equal(sizes.get(entry.path), entry.size, `npm OKF size drift: ${entry.path}`);
  return files;
}

// npm deliberately drops the canonical source symlink. Compare its complete
// regular-file projection to the verified standalone inventory, WITHOUT calling
// that projection a self-contained distribution or manufacturing the alias.
// `root` holds the packed capabilities/oats-okf* directories (the unpacked npm package root).
export function checkNpmOkfPayload(root, inventory = checkOkfMirror()) {
  const expected = inventory.entries.filter((entry) => entry.type === "file");
  assert.deepEqual(CAPABILITY_PATHS.flatMap((cap) => treeFiles(join(root, cap)).map((file) => `${cap}/${file}`)).sort(), expected.map((entry) => entry.path).sort(), "npm OKF regular file-set drift");
  for (const entry of expected) {
    const path = join(root, entry.path);
    assert.ok(lstatSync(path).isFile(), `npm OKF requires regular bytes: ${entry.path}`);
    const bytes = readFileSync(path);
    assert.equal(bytes.length, entry.size, `npm OKF size drift: ${entry.path}`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256, `npm OKF byte drift: ${entry.path}`);
  }
  return { regularFiles: expected.length,
    omittedSourceSymlinks: inventory.entries.filter((entry) => entry.type === "symlink").map((entry) => entry.path),
    selfContainedGitPayload: false };
}

function checkPackedOkfBytes(root) {
  const inventory = checkOkfMirror({ repoRoot: root });
  const scratch = mkdtempSync(join(tmpdir(), "oats-pack-byte-check-"));
  try {
    const [pack] = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", scratch], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
    checkKernelPackFiles(pack, root);
    const unpacked = join(scratch, "unpacked"); mkdirSync(unpacked);
    execFileSync("tar", ["-xzf", join(scratch, pack.filename), "-C", unpacked, ...CAPABILITY_PATHS.map((cap) => `package/${cap}`)], { stdio: "pipe" });
    return checkNpmOkfPayload(join(unpacked, "package"), inventory);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

export function checkReleaseVersions(root = ROOT) {
  const json = (file) => JSON.parse(readFileSync(join(root, file), "utf8"));
  const version = json("package.json").version;
  for (const path of ["packages/pi/package.json", "packages/desktop/package.json", "package-lock.json", "packages/desktop/package-lock.json"]) {
    const value = json(path);
    assert.equal(value.version, version, `${path} release version differs`);
    if (path.endsWith("package-lock.json")) assert.equal(value.packages[""].version, version, `${path} root entry version differs`);
  }
  return version;
}
export function checkPackages(root = ROOT) {
  const version = checkReleaseVersions(root);
  const kernel = dryRun(root);
  checkKernelPackFiles(kernel, root);
  const adapter = dryRun(resolve(root, "packages", "pi"));
  requireFiles(adapter, ["extension/index.ts", "extension/core-loader.mjs", "README.md", "package.json"]);
  assert.equal(kernel.version, version);
  assert.equal(adapter.version, version);
  const okfNpm = checkPackedOkfBytes(root);
  return { version, kernelFiles: kernel.entryCount, adapterFiles: adapter.entryCount, okfNpm };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.ok(process.argv.slice(2).every((arg) => arg === "--syntax-only"), "usage: node scripts/check-package-dry-runs.mjs [--syntax-only]");
    if (process.argv.includes("--syntax-only")) console.log(`JavaScript syntax passed: ${checkJavaScript()} shipped/support files.`);
    else console.log(`Package dry runs passed: ${JSON.stringify(checkPackages())}; public curriculum present; OKF regular bytes match the standalone inventory (npm omits source symlinks, not a self-contained Git payload); Git-only optional package and workspace state excluded.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
