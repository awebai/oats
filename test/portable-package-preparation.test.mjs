import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as core from "../lib/core.mjs";
import { createCapabilityMaterializer } from "../lib/package-materialization.mjs";
import { createRepositoryTransaction } from "../lib/repository-observation.mjs";
import { parsePortableSource } from "../lib/source-spec.mjs";
import { preparePackageArtifacts } from "../lib/portable-package-preparation.mjs";
import { verifyPortableArtifact } from "../lib/portable-artifacts.mjs";

const origin = { kind: "operator", document: { kind: "operator", id: "package-prepare" }, pointer: "/source" };
const kernel = { loadPackageManifestAt: core.loadPackageManifestAt, capabilityCompatibility: core.capabilityCompatibility,
  assertPlatformInvariantLocks: core.assertPlatformInvariantLocks, materializeCapability: createCapabilityMaterializer(core) };
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oats-portable-packages-")), deployment = join(root, "deployment");
  mkdirSync(deployment); t.after(() => rmSync(root, { recursive: true, force: true }));
  const pkg = (directory, id, capability, dependencies = [], marker = "A") => {
    mkdirSync(join(directory, "cap"), { recursive: true });
    writeFileSync(join(directory, "oats-package.json"), JSON.stringify({ package: id, version: "1.0.0", description: "Fixture", compatibility: { oats: ">=0.1.0" }, capabilities: ["cap"], dependencies }));
    writeFileSync(join(directory, "cap/oats.json"), JSON.stringify({ capability, version: "1.0.0", description: "Fixture", commands: { run: "run.mjs" } }));
    writeFileSync(join(directory, "cap/run.mjs"), `console.log(${JSON.stringify(marker)});\n`);
    return directory;
  };
  return { root, deployment, pkg };
}

test("local package preparation reuses the kernel engine, retains exact trees and never invents staging provenance or approval", (t) => {
  const f = fixture(t), a = f.pkg(join(f.root, "a"), "example.a", "example.action", ["../b"]);
  const b = f.pkg(join(f.root, "b"), "example.b", "example.dependency");
  const request = { source: parsePortableSource(`path:${a}`, { allowLocalPaths: true }), capability: "example.action", origin };
  writeFileSync(join(f.deployment, "oats-lock.json"), "existing selection is caller-owned");
  const prepared = preparePackageArtifacts({ requests: [request], deployment: f.deployment, directory: f.root, kernel, allowLocalPaths: true });
  try {
    assert.deepEqual(prepared.artifactSet.packages["example.a"].dependencies, ["example.b"]);
    assert.equal(prepared.artifactSet.packages["example.a"].source, `path:${a}`);
    const reference = prepared.artifactSet.capabilities["example.action"].artifact;
    const artifact = verifyPortableArtifact(f.deployment, reference).dir;
    assert.equal(JSON.parse(readFileSync(join(artifact, ".oats-installation.json"), "utf8")).source, `path:${a}`);
    prepared.cleanup(); rmSync(a, { recursive: true }); rmSync(b, { recursive: true });
    assert.equal(verifyPortableArtifact(f.deployment, reference).dir, artifact);
    assert.equal(readFileSync(join(f.deployment, "oats-lock.json"), "utf8"), "existing selection is caller-owned");
    assert.equal(existsSync(join(f.deployment, ".agents/portable/approvals.json")), false);
    assert.equal(existsSync(join(f.deployment, ".agents/capabilities/installed")), false);
  } finally { prepared.cleanup(); }
});

test("Git package and repo dependency preparation use the same frozen source commit after upstream advances", (t) => {
  const f = fixture(t), repo = join(f.root, "repo"), source = "git:https://example.invalid/packages.git";
  f.pkg(join(repo, "packages/a"), "example.a", "example.action", ["repo:packages/b"]);
  f.pkg(join(repo, "packages/b"), "example.b", "example.dependency");
  const config = join(f.root, "gitconfig"); writeFileSync(config, "");
  const environment = { PATH: process.env.PATH, HOME: f.root, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const git = (...args) => execFileSync("git", ["-C", repo, ...args], { env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "--quiet", "--initial-branch=topic"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
  git("config", "uploadpack.allowFilter", "true"); git("config", "uploadpack.allowAnySHA1InWant", "true");
  git("config", "--file", config, `url.${pathToFileURL(repo).href}.insteadOf`, source.slice(4));
  git("add", "."); git("commit", "--quiet", "-m", "A");
  const repositories = createRepositoryTransaction({ directory: f.root, accessContextKey: "fixture", environment, allowLocalGit: true });
  try {
    const observation = repositories.observe(source, { revision: "topic", origin });
    writeFileSync(join(repo, "packages/a/cap/run.mjs"), "console.log('B');\n"); git("add", "."); git("commit", "--quiet", "-m", "B");
    const prepared = preparePackageArtifacts({ requests: [{ source: parsePortableSource(`${source}@topic#packages/a`), capability: "example.action", origin }],
      deployment: f.deployment, directory: f.root, repositories, observations: [observation], kernel });
    try {
      for (const row of Object.values(prepared.artifactSet.packages)) assert.equal(row.commit, observation.source.commit);
      assert.equal(prepared.artifactSet.packages["example.a"].source, `${source}@topic`);
      assert.equal(prepared.artifactSet.packages["example.b"].source, `${source}@${observation.source.commit}`);
      const artifact = verifyPortableArtifact(f.deployment, prepared.artifactSet.capabilities["example.action"].artifact).dir;
      assert.equal(readFileSync(join(artifact, "run.mjs"), "utf8"), 'console.log("A");\n');
    } finally { prepared.cleanup(); }
  } finally { repositories.close(); }
});

test("required export and private local-state failures publish no selectable artifacts", (t) => {
  const f = fixture(t), source = f.pkg(join(f.root, "source"), "example.source", "example.action");
  const request = { source: parsePortableSource(`path:${source}`, { allowLocalPaths: true }), capability: "example.missing", origin };
  const run = () => preparePackageArtifacts({ requests: [request], deployment: f.deployment, directory: f.root, kernel, allowLocalPaths: true });
  assert.throws(run, { code: "capability-list-mismatch" });
  assert.equal(existsSync(join(f.deployment, ".agents")), false);
  request.capability = "example.action"; mkdirSync(join(source, ".aw"));
  assert.throws(run, { code: "source-incomplete" });
  assert.equal(existsSync(join(f.deployment, ".agents")), false);
});
