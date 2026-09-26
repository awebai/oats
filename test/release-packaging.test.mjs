import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  ROOT, checkJavaScript, checkKernelPackFiles, checkNpmOkfPayload, checkReleaseVersions, shippedJavaScript,
} from "../scripts/check-package-dry-runs.mjs";
import { CAPABILITY_PATH, EXPERT_PATH, checkKnowledgeTheoryPackage, treeFiles } from "../scripts/check-knowledge-theory-package.mjs";
import { CAPABILITY_PATHS, checkOkfMirror } from "../scripts/check-okf-mirror.mjs";
import { acceptProbe } from "../packages/desktop/cli-locator.mjs";

function scratch(t) {
  const root = mkdtempSync(join(tmpdir(), "oats-release-packaging-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function write(path, text) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); }
const json = (file) => JSON.parse(readFileSync(join(ROOT, file), "utf8"));

test("all release manifests and lock roots agree; Desktop accepts the actual CLI probe", () => {
  const version = checkReleaseVersions();
  const probe = JSON.parse(execFileSync(process.execPath, [join(ROOT, "bin/oats.mjs"), "version", "--json"], { encoding: "utf8" }));
  assert.equal(probe.version, version);
  assert.equal(probe.desktopApi, 1);
  assert.equal(acceptProbe(probe).ok, true);
  assert.ok(existsSync(join(ROOT, "docs/release-notes", `v${version}.md`)), "candidate needs matching release notes");
  assert.ok(!json("package.json").files.includes("oats-package/"), "Git-only optional payload is not an npm export");
});

test("release alignment rejects stale lock metadata even when all three manifests agree", (t) => {
  const root = scratch(t);
  for (const file of ["package.json", "package-lock.json", "packages/pi/package.json", "packages/desktop/package.json", "packages/desktop/package-lock.json"]) {
    write(join(root, file), readFileSync(join(ROOT, file)));
  }
  assert.equal(checkReleaseVersions(root), json("package.json").version);
  const file = join(root, "packages/desktop/package-lock.json");
  const lock = JSON.parse(readFileSync(file));
  lock.packages[""].version = "0.0.0";
  write(file, JSON.stringify(lock));
  assert.throws(() => checkReleaseVersions(root), /root entry version differs/);
});

test("v2 preparation aligns standalone OKF and Git-only theory catalog pins", () => {
  for (const cap of CAPABILITY_PATHS) {
    assert.equal(json(`${cap}/oats.json`).version, "4.0.0");
    assert.equal(json(`${cap}/oats.json`).compatibility.oats, ">=0.29.0", `${cap}: OKF 4.0.0 declares the 0.29.0 floor (package souls with triggers, the harvester spawn by --name)`);
  }
  assert.equal(json("package-catalog.json").packages["oats.okf"].ref, "v4.0.0");
  const catalog = json("package-catalog.json");
  assert.equal(catalog.packages["oats.knowledge-theory"], undefined, "the theory package identity was renamed to oats.framework");
  const framework = catalog.packages["oats.framework"];
  assert.equal(framework.ref, "oats-framework/v1.2.0", "catalog uses the published distribution tag, not a pending kernel release tag");
  assert.equal(framework.path, "oats-package");
  for (const id of ["oats.knowledge-theory", "oats.core", "oats.setup"]) assert.equal(catalog.capabilities[id], "oats.framework");
});

test("syntax inventory recurses through new capability libs, record and package scripts without Git", (t) => {
  const root = scratch(t);
  write(join(root, "package.json"), '{"type":"module"}\n');
  const files = ["bin/oats.mjs", "lib/core.mjs", "capabilities/provider/lib/nested/io.mjs", "capabilities/provider/scripts/nested/check.js", "oats-package/capabilities/theory/lib/deep/entry.mjs", "oats-package/prepare.cjs", "packages/record/lib/capture/deep.mjs", "packages/record/bin/recall.mjs", "packages/pi/extension/core-loader.mjs", "scripts/pack/new-gate.mjs"];
  for (const file of files) write(join(root, file), "console.log('valid');\n");
  for (const file of [".agents/ignored.mjs", "agents/fixture/state.mjs", "capabilities/provider/node_modules/dep/broken.mjs", "oats-package/.agents/scratch.mjs"]) write(join(root, file), "export const = broken;\n");
  const outside = join(root, "outside"); write(join(outside, "broken.mjs"), "export const = broken;\n");
  symlinkSync(outside, join(root, "capabilities/link"));
  assert.deepEqual(shippedJavaScript(root), files.sort());
  assert.equal(checkJavaScript(root), files.length);
  for (const file of files.filter((f) => /capabilities|record|scripts/.test(f))) {
    write(join(root, file), "export const = broken;\n");
    assert.throws(() => checkJavaScript(root), (error) => error.message.includes(`syntax error in ${file}`), `must check ${file}`);
    write(join(root, file), "console.log('valid');\n");
  }
});

test("actual npm inventory ships public docs but no partial optional package; omissions and leaks fail", { timeout: 60_000 }, () => {
  const [pack] = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: ROOT, encoding: "utf8" }));
  const files = checkKernelPackFiles(pack);
  const canonical = ["docs/knowledge-capability-authoring.md", ...treeFiles(join(ROOT, "docs/knowledge-reference")).map((file) => `docs/knowledge-reference/${file}`)];
  for (const file of ["bin/oats.mjs", "capabilities/oats-okf/lib/inspection.mjs", "capabilities/oats-okf/lib/worker.mjs", ...canonical]) {
    assert.ok(files.has(file));
    assert.throws(() => checkKernelPackFiles({ ...pack, files: pack.files.filter((f) => f.path !== file) }), (error) => error.message.includes(`missing ${file}`));
  }
  for (const path of ["oats-package", ...treeFiles(join(ROOT, "oats-package")).map((file) => `oats-package/${file}`)]) {
    assert.ok(!files.has(path), `Git-only file must not be shipped in npm: ${path}`);
    assert.throws(() => checkKernelPackFiles({ ...pack, files: [...pack.files, { path }] }), /Git-only optional package/);
  }
  for (const path of ["agents/live/soul/AGENTS.md", "oats-config.yaml", "oats-lock.json", "capabilities/example/.agents/state.json", "capabilities/example/agents/expert/instances/live/instance.json"]) {
    assert.throws(() => checkKernelPackFiles({ ...pack, files: [...pack.files, { path }] }), /leaks non-runtime/);
  }
  // The separate Git payload remains full and canonical, including its SOURCE
  // alias. No npm hooks, duplicate CLAUDE.md, or acquisition-time alias repair.
  assert.equal(checkKnowledgeTheoryPackage().ok, true);
  const soul = join(ROOT, "oats-package", CAPABILITY_PATH, EXPERT_PATH);
  assert.equal(readlinkSync(join(soul, "CLAUDE.md")), "AGENTS.md");
  assert.equal(lstatSync(join(soul, "AGENTS.md")).isFile(), true);
});


test("actual npm OKF regular bytes match inventory; symlink omission is explicit, drift never blessed", { timeout: 60_000 }, (t) => {
  const root = scratch(t);
  const inventory = checkOkfMirror();
  const [pack] = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", root], { cwd: ROOT, encoding: "utf8" }));
  checkKernelPackFiles(pack);
  execFileSync("tar", ["-xzf", join(root, pack.filename), "-C", root, ...CAPABILITY_PATHS.map((c) => `package/${c}`)]);
  const pkg = join(root, "package"), cap = join(pkg, "capabilities/oats-okf");
  const result = checkNpmOkfPayload(pkg, inventory);
  assert.equal(result.selfContainedGitPayload, false);
  assert.deepEqual(result.omittedSourceSymlinks, [], "3.0.0 ships no symlink for npm to omit");
  assert.ok(!existsSync(join(cap, "agents")), "okf 4.0.0 has no capability agents, and nothing is synthesized");
  assert.equal(result.regularFiles, inventory.entries.filter((entry) => entry.type === "file").length);
  const file = join(cap, "lib/inspection.mjs");
  const original = readFileSync(file);
  const corrupt = Buffer.from(original); corrupt[0] ^= 1;
  writeFileSync(file, corrupt);
  assert.throws(() => checkNpmOkfPayload(pkg, inventory), /byte drift/, "equal-size corruption must fail actual-byte verification");
  writeFileSync(file, original);
  rmSync(file);
  assert.throws(() => checkNpmOkfPayload(pkg, inventory), /file-set drift/);
  writeFileSync(file, original);
  const extra = join(cap, "obsolete-v1.mjs"); writeFileSync(extra, "obsolete");
  assert.throws(() => checkNpmOkfPayload(pkg, inventory), /file-set drift/);
  rmSync(extra);
  // A file in another exported capability counts too; regular copies are no more acceptable than links.
  const alias = join(pkg, "capabilities/oats-okf-harvest/CLAUDE.md");
  writeFileSync(alias, "stray\n");
  assert.throws(() => checkNpmOkfPayload(pkg, inventory), /file-set drift/);
  rmSync(alias);
  assert.deepEqual(checkNpmOkfPayload(pkg, inventory), result);
});

// Retired 0.29.0: "every framework-shipped capability with an inject declares a helperInjection policy".
// A manifest's helperInjection has been IGNORED since 0.26 (docs/capabilities.md: it served the captured
// path 0.26 removed). okf 4.0.0's new capabilities (oats.okf-harvest, oats.okf-maintenance) ship injects
// without one, legitimately: the guard enforced a contract with no effect.
