import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TREE_FORMAT, treeIntegrity } from "../lib/portable-digest.mjs";
import { portableArtifactDir, retainPortableArtifact, verifyPortableArtifact } from "../lib/portable-artifacts.mjs";

function removable(path) {
  if (!lstatSync(path).isDirectory()) return;
  chmodSync(path, 0o700);
  for (const child of readdirSync(path)) removable(join(path, child));
}
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oats-portable-store-"));
  t.after(() => { removable(root); rmSync(root, { recursive: true, force: true }); });
  const scope = join(root, "deployment"), source = join(root, "source");
  mkdirSync(scope); mkdirSync(source);
  writeFileSync(join(source, "AGENTS.md"), "Revision A\n");
  symlinkSync("AGENTS.md", join(source, "CLAUDE.md"));
  return { root, scope, source };
}
const identity = { kind: "git-soul", repository: { kind: "provider-repository", provider: "github", host: "github.com", id: "123" }, exportPath: "agents/research-expert" };

test("new-format soul artifacts coexist after source removal without ambient lock/config or alias authority", (t) => {
  const { scope, source } = fixture(t);
  chmodSync(source, 0o500);
  const a = { kind: "soul", identity, integrity: treeIntegrity(source) };
  const first = retainPortableArtifact(scope, source, a);
  assert.equal(first.status, "retained");
  assert.equal(retainPortableArtifact(scope, source, a).status, "kept");
  assert.equal(lstatSync(first.dir).mode & 0o777, 0o500);
  writeFileSync(join(source, "AGENTS.md"), "Revision B\n");
  const b = { kind: "soul", identity, integrity: treeIntegrity(source) };
  const second = retainPortableArtifact(scope, source, b);
  assert.notEqual(first.dir, second.dir);
  removable(source); rmSync(source, { recursive: true });
  writeFileSync(join(scope, "oats-lock.json"), "invalid ambient lock");
  writeFileSync(join(scope, "oats-config.yaml"), "invalid ambient config");
  for (const [reference, expected] of [[a, "Revision A\n"], [b, "Revision B\n"]]) {
    const result = verifyPortableArtifact(scope, reference);
    assert.equal(readFileSync(join(result.dir, "CLAUDE.md"), "utf8"), expected);
    assert.equal(Object.hasOwn(result, "trusted"), false);
    assert.equal(lstatSync(result.dir).mode & 0o777, 0o500);
  }
  assert.throws(() => portableArtifactDir(scope, { ...a, alias: "another-local-name" }), { code: "invalid-artifact-reference" });
});

test("new-format capability/resource stores separate references, refuse damage and distinguish absence", (t) => {
  const { scope, source } = fixture(t);
  const integrity = treeIntegrity(source);
  const capability = { kind: "capability", capability: "example.expert", integrity };
  const resource = { kind: "resource", integrity };
  const a = retainPortableArtifact(scope, source, capability), b = retainPortableArtifact(scope, source, resource);
  assert.notEqual(a.dir, b.dir);
  chmodSync(join(a.dir, "AGENTS.md"), 0o755);
  assert.throws(() => verifyPortableArtifact(scope, capability), { code: "integrity-drift" });
  assert.throws(() => retainPortableArtifact(scope, source, capability), { code: "integrity-drift" });
  assert.equal(lstatSync(join(a.dir, "AGENTS.md")).mode & 0o777, 0o755, "never repair a damaged published artifact");
  assert.equal(verifyPortableArtifact(scope, resource).dir, b.dir);
  rmSync(b.dir, { recursive: true });
  assert.throws(() => verifyPortableArtifact(scope, resource), { code: "artifact-not-found" });
  assert.throws(() => portableArtifactDir(".", resource), { code: "invalid-artifact-store" });
  assert.throws(() => portableArtifactDir(scope, { ...resource, integrity: { ...integrity, format: "legacy" } }), { code: "invalid-artifact-reference" });
  assert.equal(integrity.format, TREE_FORMAT);
});

test("retention rejects escaping source links and redirected managed stores before publishing payload", (t) => {
  const { root, scope, source } = fixture(t), outside = join(root, "outside");
  mkdirSync(outside); writeFileSync(join(outside, "data"), "not an artifact resource");
  symlinkSync(join(outside, "data"), join(source, "escape"));
  assert.throws(() => retainPortableArtifact(scope, source, { kind: "resource", integrity: treeIntegrity(source) }), { code: "artifact-not-contained" });
  assert.equal(existsSync(join(scope, ".agents")), false);
  rmSync(join(source, "escape"));
  mkdirSync(join(scope, ".agents")); symlinkSync(outside, join(scope, ".agents/soul-artifacts"));
  assert.throws(() => retainPortableArtifact(scope, source, { kind: "soul", identity, integrity: treeIntegrity(source) }), { code: "invalid-artifact-store" });
  assert.deepEqual(readdirSync(outside), ["data"]);
});
