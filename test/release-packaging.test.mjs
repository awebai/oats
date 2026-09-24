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
import { checkOkfMirror } from "../scripts/check-okf-mirror.mjs";
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
  assert.equal(json("capabilities/oats-okf/oats.json").version, "2.1.5");
  assert.equal(json("capabilities/oats-okf/oats.json").compatibility.oats, ">=0.24.4", "OKF 2.1.x declares binding.reasons, which lib/provider-binding.mjs validates from 0.24.4");
  assert.equal(json("package-catalog.json").packages["oats.okf"].ref, "v2.1.5");
  const catalog = json("package-catalog.json");
  assert.equal(catalog.packages["oats.knowledge-theory"], undefined, "the theory package identity was renamed to oats.framework");
  const framework = catalog.packages["oats.framework"];
  assert.equal(framework.ref, "oats-framework/v1.1.3", "catalog uses the published distribution tag, not a pending kernel release tag");
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
  execFileSync("tar", ["-xzf", join(root, pack.filename), "-C", root, "package/capabilities/oats-okf"]);
  const cap = join(root, "package/capabilities/oats-okf");
  const result = checkNpmOkfPayload(cap, inventory);
  assert.equal(result.selfContainedGitPayload, false);
  assert.deepEqual(result.omittedSourceSymlinks, ["agents/memory-harvest/CLAUDE.md"]);
  assert.ok(!existsSync(join(cap, result.omittedSourceSymlinks[0])), "npm did not ship the source alias; no repair");
  assert.equal(result.regularFiles, inventory.entries.filter((entry) => entry.type === "file").length);
  const file = join(cap, "lib/inspection.mjs");
  const original = readFileSync(file);
  const corrupt = Buffer.from(original); corrupt[0] ^= 1;
  writeFileSync(file, corrupt);
  assert.throws(() => checkNpmOkfPayload(cap, inventory), /byte drift/, "equal-size corruption must fail actual-byte verification");
  writeFileSync(file, original);
  rmSync(file);
  assert.throws(() => checkNpmOkfPayload(cap, inventory), /file-set drift/);
  writeFileSync(file, original);
  const extra = join(cap, "obsolete-v1.mjs"); writeFileSync(extra, "obsolete");
  assert.throws(() => checkNpmOkfPayload(cap, inventory), /file-set drift/);
  rmSync(extra);
  // Regular compatibility copies are no more acceptable than unexpected links.
  const alias = join(cap, "agents/memory-harvest/CLAUDE.md");
  writeFileSync(alias, readFileSync(join(cap, "agents/memory-harvest/AGENTS.md")));
  assert.throws(() => checkNpmOkfPayload(cap, inventory), /file-set drift/);
  rmSync(alias);
  assert.deepEqual(checkNpmOkfPayload(cap, inventory), result);
});

test("every framework-shipped capability with an inject declares a helperInjection policy", () => {
  // Second-operator finding (2026-09-21): oats.okf adopted the helper-injection contract while its
  // siblings oats.core and oats.aweb shipped an inject without a policy, so no edition's harvest
  // helper could compose and no resolution could publish. The framework's own packages must pass
  // the contract the kernel imposes; this guards every bundled and exported capability.
  const manifests = execFileSync("git", ["ls-files", "capabilities/*/oats.json", "oats-package/capabilities/*/oats.json"], { cwd: ROOT, encoding: "utf8" })
    .split("\n").filter(Boolean);
  assert.ok(manifests.length >= 5, `expected framework capability manifests, found ${manifests.length}`);
  // Bundled mirrors of separately-released tasks providers (jira, linear, review) are fixed in their
  // own repositories; no framework soul edition requires them today, so they cannot block an edition.
  // Remove an entry here the moment its upstream declares the policy — never add one.
  const PENDING_UPSTREAM = new Set(["oats.jira", "oats.linear", "oats.review"]);
  let checked = 0;
  for (const rel of manifests) {
    const m = json(rel);
    if (m.inject === undefined) continue;
    if (PENDING_UPSTREAM.has(m.capability)) {
      assert.equal(m.helperInjection, undefined, `${m.capability} now declares helperInjection upstream: drop it from PENDING_UPSTREAM`);
      continue;
    }
    checked += 1;
    assert.ok(m.helperInjection && m.helperInjection.version === 1 && ["inherit", "omit", "file"].includes(m.helperInjection.mode),
      `${rel} (${m.capability}) ships inject ${m.inject} without a helperInjection policy`);
  }
  assert.ok(checked >= 3, "oats.core, oats.okf and oats.aweb must be checked");
});
