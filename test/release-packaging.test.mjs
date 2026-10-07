import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  ROOT, checkJavaScript, checkKernelPackFiles, checkReleaseVersions, shippedJavaScript,
} from "../scripts/check-package-dry-runs.mjs";
import { EXPERT_PATH, checkKnowledgeTheoryPackage, treeFiles } from "../scripts/check-knowledge-theory-package.mjs";
import { MIRROR_PATHS } from "../scripts/check-okf-mirror.mjs";
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
  for (const dir of ["capabilities/", "mirrors/"]) assert.ok(!json("package.json").files.includes(dir), `${dir} is Git content, not an npm export`);
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
  for (const cap of MIRROR_PATHS) {
    assert.equal(json(`${cap}/oats.json`).version, "4.1.1");
    assert.equal(json(`${cap}/oats.json`).compatibility.oats, ">=0.29.0", `${cap}: OKF 4.0.0 declares the 0.29.0 floor (package souls with triggers, the harvester spawn by --name)`);
  }
  assert.equal(json("package-catalog.json").packages["oats.okf"].ref, "v4.1.1");
  const catalog = json("package-catalog.json");
  assert.equal(catalog.packages["oats.knowledge-theory"], undefined, "the theory package identity was renamed to oats.framework");
  const framework = catalog.packages["oats.framework"];
  assert.equal(framework.ref, "oats-framework/v1.8.0", "catalog uses the published distribution tag, not a pending kernel release tag");
  assert.equal(framework.path, "oats-package");
  for (const id of ["oats.knowledge-theory", "oats.core", "oats.setup"]) assert.equal(catalog.capabilities[id], "oats.framework");
});

test("syntax inventory recurses through new capability libs, record and package scripts without Git", (t) => {
  const root = scratch(t);
  write(join(root, "package.json"), '{"type":"module"}\n');
  const files = ["bin/oats.mjs", "lib/core.mjs", "capabilities/provider/lib/nested/io.mjs", "capabilities/provider/scripts/nested/check.js", "mirrors/provider/lib/nested/io.mjs", "oats-package/capabilities/theory/lib/deep/entry.mjs", "oats-package/prepare.cjs", "packages/record/lib/capture/deep.mjs", "packages/record/bin/recall.mjs", "packages/pi/extension/core-loader.mjs", "scripts/pack/new-gate.mjs"];
  for (const file of files) write(join(root, file), "console.log('valid');\n");
  for (const file of [".agents/ignored.mjs", "agents/fixture/state.mjs", "capabilities/provider/node_modules/dep/broken.mjs", "oats-package/.agents/scratch.mjs"]) write(join(root, file), "export const = broken;\n");
  const outside = join(root, "outside"); write(join(outside, "broken.mjs"), "export const = broken;\n");
  symlinkSync(outside, join(root, "capabilities/link"));
  assert.deepEqual(shippedJavaScript(root), files.sort());
  assert.equal(checkJavaScript(root), files.length);
  for (const file of files.filter((f) => /capabilities|mirrors|record|scripts/.test(f))) {
    write(join(root, file), "export const = broken;\n");
    assert.throws(() => checkJavaScript(root), (error) => error.message.includes(`syntax error in ${file}`), `must check ${file}`);
    write(join(root, file), "console.log('valid');\n");
  }
});

test("actual npm inventory ships public docs but no partial optional package, capabilities or mirrors; omissions and leaks fail", { timeout: 60_000 }, () => {
  const [pack] = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: ROOT, encoding: "utf8" }));
  const files = checkKernelPackFiles(pack);
  const canonical = ["docs/knowledge-capability-authoring.md", ...treeFiles(join(ROOT, "docs/knowledge-reference")).map((file) => `docs/knowledge-reference/${file}`)];
  for (const file of ["bin/oats.mjs", "package-catalog.json", ...canonical]) {
    assert.ok(files.has(file));
    assert.throws(() => checkKernelPackFiles({ ...pack, files: pack.files.filter((f) => f.path !== file) }), (error) => error.message.includes(`missing ${file}`));
  }
  for (const path of ["oats-package", ...treeFiles(join(ROOT, "oats-package")).map((file) => `oats-package/${file}`)]) {
    assert.ok(!files.has(path), `Git-only file must not be shipped in npm: ${path}`);
    assert.throws(() => checkKernelPackFiles({ ...pack, files: [...pack.files, { path }] }), /Git-only optional package/);
  }
  // The package mirrors and the repository's own capabilities are Git content:
  // capabilities resolve from their remotes at the locked commit, never from the kernel package.
  for (const dir of ["capabilities", "mirrors"]) {
    const shipped = [...files].filter((path) => path === dir || path.startsWith(`${dir}/`));
    assert.deepEqual(shipped, [], `npm must not ship ${dir}/`);
    for (const path of [`${dir}/oats-okf/oats.json`, `${dir}/oats-workspace-experts/injects/oats-experts.md`]) {
      assert.throws(() => checkKernelPackFiles({ ...pack, files: [...pack.files, { path }] }), /Git-only capability file/);
    }
  }
  for (const path of ["agents/live/soul/AGENTS.md", "oats-config.yaml", "oats-lock.json", "capabilities/example/.agents/state.json", "capabilities/example/agents/expert/instances/live/instance.json"]) {
    assert.throws(() => checkKernelPackFiles({ ...pack, files: [...pack.files, { path }] }), /leaks non-runtime/);
  }
  // The separate Git payload remains full and canonical, including its SOURCE
  // alias. No npm hooks, duplicate CLAUDE.md, or acquisition-time alias repair.
  assert.equal(checkKnowledgeTheoryPackage().ok, true);
  const soul = join(ROOT, "oats-package", EXPERT_PATH);
  assert.equal(readlinkSync(join(soul, "CLAUDE.md")), "AGENTS.md");
  assert.equal(lstatSync(join(soul, "AGENTS.md")).isFile(), true);
});


// Retired 0.29.0: "every framework-shipped capability with an inject declares a helperInjection policy".
// A manifest's helperInjection has been IGNORED since 0.26 (docs/capabilities.md: it served the captured
// path 0.26 removed). okf 4.0.0's new capabilities (oats.okf-harvest, oats.okf-maintenance) ship injects
// without one, legitimately: the guard enforced a contract with no effect.
