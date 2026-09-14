import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  acquirePackage, capabilityArtifactIntegrity, installedCapabilityDir,
  OATS_LOCK_FILE, parseLockFileStrict, updatePackage,
} from "../lib/core.mjs";
import {
  retainCapabilityArtifact, retainedCapabilityDir, verifyRetainedCapability,
} from "../lib/capability-artifacts.mjs";

const ID = "example.expert";
const write = (path, bytes) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); };
function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), "oats-retained-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const scope = join(base, "scope");
  const source = join(base, "source");
  write(join(scope, "oats-config.yaml"), "name: test\n");
  write(join(source, "oats-package.json"), JSON.stringify({
    package: "example.package", version: "1.0.0", description: "Example package",
    compatibility: { oats: ">=0.1.0" }, capabilities: ["expert"],
  }));
  write(join(source, "expert", "oats.json"), JSON.stringify({
    capability: ID, version: "1.0.0", description: "Example expert", skills: ["skills/expert"],
  }));
  write(join(source, "expert", "skills/expert/SKILL.md"), "# Expert\nRevision A\n");
  write(join(source, "expert", "version.mjs"), "console.log('A');\n");
  symlinkSync("version.mjs", join(source, "expert", "current.mjs"));
  acquirePackage(scope, `path:${source}`);
  return {
    base, scope, source, installed: installedCapabilityDir(scope, ID),
    lock: parseLockFileStrict(join(scope, OATS_LOCK_FILE)),
  };
}

test("retained A and B execute independently after update and removal of the source and flat store", (t) => {
  const f = fixture(t);
  const a = retainCapabilityArtifact(f.scope, f.installed, ID, f.lock);
  write(join(f.source, "expert", "version.mjs"), "console.log('B');\n");
  write(join(f.source, "expert", "skills/expert/SKILL.md"), "# Expert\nRevision B\n");
  updatePackage(f.scope, "example.package");
  const lockB = parseLockFileStrict(join(f.scope, OATS_LOCK_FILE));
  const b = retainCapabilityArtifact(f.scope, f.installed, ID, lockB);
  assert.notEqual(a.integrity, b.integrity);
  assert.notEqual(a.dir, b.dir);
  rmSync(f.source, { recursive: true });
  rmSync(f.installed, { recursive: true });
  rmSync(join(f.scope, OATS_LOCK_FILE));
  for (const [receipt, lock, expected] of [[a, f.lock, "A"], [b, lockB, "B"]]) {
    assert.equal(verifyRetainedCapability(f.scope, ID, lock).dir, receipt.dir);
    assert.equal(execFileSync(process.execPath, [join(receipt.dir, "current.mjs")], { encoding: "utf8" }).trim(), expected);
  }
});

test("retaining identical bytes keeps the original tree and does not select or approve it", (t) => {
  const f = fixture(t);
  const before = readFileSync(join(f.scope, OATS_LOCK_FILE));
  const a = retainCapabilityArtifact(f.scope, f.installed, ID, f.lock);
  const original = statSync(join(a.dir, "oats.json"));
  const b = retainCapabilityArtifact(f.scope, f.installed, ID, f.lock);
  assert.equal(a.status, "retained");
  assert.equal(b.status, "kept");
  assert.equal(statSync(join(b.dir, "oats.json")).ino, original.ino);
  assert.deepEqual(readFileSync(join(f.scope, OATS_LOCK_FILE)), before);
  assert.equal(f.lock.capabilities[ID].trusted, false);
  assert.equal(Object.hasOwn(b, "trusted"), false);
  assert.equal(readdirSync(dirname(a.dir)).some((name) => name.startsWith(".staging-")), false);
});

test("source drift or incorrect provenance refuses retention before creating a store", (t) => {
  const f = fixture(t);
  const wrong = structuredClone(f.lock);
  wrong.packages["example.package"].source = "path:/different-source";
  assert.throws(() => retainCapabilityArtifact(f.scope, f.installed, ID, wrong), { code: "invalid-lock" });
  write(join(f.installed, "version.mjs"), "console.log('changed');\n");
  assert.throws(() => retainCapabilityArtifact(f.scope, f.installed, ID, f.lock), { code: "integrity-drift" });
  assert.equal(existsSync(join(f.scope, ".agents/capabilities/artifacts")), false);
});

test("damaged retained content is never repaired from an otherwise valid source", (t) => {
  const f = fixture(t);
  const a = retainCapabilityArtifact(f.scope, f.installed, ID, f.lock);
  const marker = join(a.dir, "version.mjs");
  write(marker, "damaged retained content\n");
  assert.throws(() => verifyRetainedCapability(f.scope, ID, f.lock), { code: "integrity-drift" });
  assert.throws(() => retainCapabilityArtifact(f.scope, f.installed, ID, f.lock), { code: "integrity-drift" });
  assert.equal(readFileSync(marker, "utf8"), "damaged retained content\n");
});

test("missing scope, store or revision is distinct from damaged retained content", (t) => {
  const f = fixture(t);
  assert.throws(() => verifyRetainedCapability(join(f.base, "absent"), ID, f.lock), { code: "artifact-not-found" });
  assert.throws(() => retainCapabilityArtifact(join(f.base, "absent"), f.installed, ID, f.lock), { code: "artifact-not-found" });
  assert.throws(() => verifyRetainedCapability(f.scope, ID, f.lock), { code: "artifact-not-found" });
  const a = retainCapabilityArtifact(f.scope, f.installed, ID, f.lock);
  rmSync(a.dir, { recursive: true });
  assert.throws(() => verifyRetainedCapability(f.scope, ID, f.lock), { code: "artifact-not-found" });
  write(a.dir, "not a tree\n");
  assert.throws(() => verifyRetainedCapability(f.scope, ID, f.lock), { code: "invalid-artifact" });
  rmSync(a.dir);
  mkdirSync(a.dir);
  assert.throws(() => verifyRetainedCapability(f.scope, ID, f.lock), { code: "integrity-drift" });
});

test("retention rejects links to mutable external sources even when the lock matches", (t) => {
  const f = fixture(t);
  for (const target of [join(f.installed, "version.mjs"), join(f.source, "expert/version.mjs"), "../../outside"]) {
    const link = join(f.installed, "extra-link");
    symlinkSync(target, link);
    const lock = structuredClone(f.lock);
    lock.capabilities[ID].integrity = capabilityArtifactIntegrity(f.installed);
    assert.throws(() => retainCapabilityArtifact(f.scope, f.installed, ID, lock), { code: "artifact-not-contained" });
    rmSync(link);
  }
});

test("store symlinks and invalid artifact references cannot redirect publication", (t) => {
  const f = fixture(t);
  for (const id of ["../elsewhere", "/tmp/elsewhere", "", "__proto__"]) {
    assert.throws(() => retainedCapabilityDir(f.scope, id, f.lock.capabilities[ID].integrity), { code: "invalid-artifact-reference" });
  }
  assert.throws(() => retainedCapabilityDir(f.scope, ID, "sha256-abcd"), { code: "invalid-artifact-reference" });
  const outside = join(f.base, "elsewhere");
  mkdirSync(outside);
  symlinkSync(outside, join(f.scope, ".agents/capabilities/artifacts"));
  assert.throws(() => retainCapabilityArtifact(f.scope, f.installed, ID, f.lock), { code: "invalid-artifact-store" });
  assert.deepEqual(readdirSync(outside), []);
});

test("retained payload is ignored by Git, while authored capabilities remain visible", (t) => {
  const f = fixture(t);
  execFileSync("git", ["init", "-q", f.scope]);
  const a = retainCapabilityArtifact(f.scope, f.installed, ID, f.lock);
  const ignored = execFileSync("git", ["-C", f.scope, "check-ignore", join(a.dir, "oats.json")], { encoding: "utf8" });
  assert.match(ignored, /oats\.json/);
  write(join(f.scope, ".agents/capabilities/owned/example/oats.json"), "{}\n");
  assert.match(execFileSync("git", ["-C", f.scope, "ls-files", "--others", "--exclude-standard"], { encoding: "utf8" }), /owned\/example\/oats.json/);
});

test("two preparers can retain the same revision without replacing each other's result", async (t) => {
  const f = fixture(t);
  const module = new URL("../lib/capability-artifacts.mjs", import.meta.url).href;
  const script = `
    import { readFileSync } from 'node:fs';
    import { retainCapabilityArtifact } from ${JSON.stringify(module)};
    const [scope, source, id, lockFile] = process.argv.slice(1);
    const result = retainCapabilityArtifact(scope, source, id, JSON.parse(readFileSync(lockFile)));
    console.log(JSON.stringify(result));
  `;
  const publish = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script, f.scope, f.installed, ID, join(f.scope, OATS_LOCK_FILE)], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) { reject(new Error(stderr || `publisher exited ${code}`)); return; }
      try { resolve(JSON.parse(stdout)); } catch (e) { reject(e); }
    });
  });
  const [a, b] = await Promise.all([publish(), publish()]);
  assert.equal(a.dir, b.dir);
  assert.deepEqual([a.status, b.status].sort(), ["kept", "retained"]);
  assert.equal(verifyRetainedCapability(f.scope, ID, f.lock).dir, a.dir);
  assert.deepEqual(readdirSync(dirname(a.dir)), [a.integrity]);
});
