import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as core from "../lib/core.mjs";
import { capabilityArtifactIntegrity, copyTreeSafe, publishArtifactTree } from "../lib/artifact-tree.mjs";
import * as provenance from "../lib/capability-provenance.mjs";
import { oatsError } from "../lib/errors.mjs";

const write = (file, bytes) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, bytes); };
function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), "oats-artifact-tree-"));
  t.after(() => {
    // Some cases deliberately copy read-only directories. Restore ONLY fixture
    // directory permissions for cleanup, without following links.
    const writable = (dir) => {
      chmodSync(dir, 0o700);
      for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) writable(join(dir, e.name));
    };
    writable(base);
    rmSync(base, { recursive: true, force: true });
  });
  return base;
}
function vector(root) {
  // Deliberately created out of order; includes former exclusion candidates.
  const files = {
    "z.txt": "last\n",
    "nested/run.mjs": 'console.log("artifact");\n',
    "a.bin": Buffer.from([0, 1, 255, 128, 10, 13, 0]),
    "node_modules/vendor/index.mjs": "export default 42;\n",
    ".git/HEAD": "payload, not excluded\n",
    "oats-lock.json": '{"payload":true}\n',
    ".oats-installation.json": '{"schemaVersion":1}\n',
  };
  for (const [path, bytes] of Object.entries(files)) write(join(root, path), bytes);
  mkdirSync(join(root, "empty"));
  symlinkSync("./nested/run.mjs", join(root, "current.mjs"));
  symlinkSync("nested", join(root, "linked-dir"));
  symlinkSync("../a.bin", join(root, "nested/binary-link"));
  chmodSync(join(root, "nested/run.mjs"), 0o751);
  chmodSync(join(root, "a.bin"), 0o640);
  chmodSync(join(root, "empty"), 0o710);
  chmodSync(join(root, "nested"), 0o550);
  chmodSync(root, 0o750);
}
function snapshot(root) {
  const entries = [];
  const walk = (path, name) => {
    const st = lstatSync(path);
    if (st.isSymbolicLink()) entries.push([name, "symlink", readlinkSync(path)]);
    else if (st.isFile()) entries.push([name, "file", st.mode & 0o7777, readFileSync(path).toString("hex")]);
    else {
      entries.push([name, "directory", st.mode & 0o7777]);
      for (const e of readdirSync(path).sort()) walk(join(path, e), `${name}/${e}`);
    }
  };
  walk(root, ".");
  return entries;
}

// Produced with the original core helper at 428cd9af615652c4a93d754c1106674abd18545b.
// This is the OLD digest: bytes and symlink spelling only, not executable modes.
const VECTOR_DIGEST = "sha256-2cf61435ad1d59ca75f453b5325f5d7bb39f4a29a9b62892577f5041cb6919bb";

test("core re-exports the exact existing helpers and contracts, not wrappers", () => {
  assert.equal(core.copyTreeSafe, copyTreeSafe);
  assert.equal(core.capabilityArtifactIntegrity, capabilityArtifactIntegrity);
  assert.equal(core.oatsError, oatsError);
  for (const name of [
    "CAPABILITIES_DIRNAME", "INSTALLED_SUBDIR", "CAPABILITY_ID_RE",
    "isMaterializedCapabilityId", "capabilityIdViolation", "CAPABILITY_INSTALLATION_FILE",
    "normalizePackagePath", "validateLockEntry", "validateCapabilityLockEntry", "verifyCapabilityInstallation",
  ]) assert.equal(core[name], provenance[name], name);
  for (const name of ["publishArtifactTree", "parseLockSource", "PACKAGE_ID_RE", "TRANSITIONAL_ROW_FIELDS"]) {
    assert.equal(Object.hasOwn(core, name), false, `${name} is not a new core API`);
  }
  const details = [{ file: "lock.json", violation: "source" }];
  const error = oatsError("invalid-lock", "original diagnostic", details);
  assert.equal(error.message, "original diagnostic");
  assert.equal(error.code, "invalid-lock");
  assert.equal(error.provenance, details);
  assert.equal(Object.hasOwn(oatsError("test", "no provenance"), "provenance"), false);
});

test("copy and publish preserve bytes, directory/file modes and verbatim symlinks under a restrictive umask", (t) => {
  const base = fixture(t), source = join(base, "source"), copied = join(base, "copy"), published = join(base, "published");
  vector(source);
  const before = snapshot(source);
  assert.equal(capabilityArtifactIntegrity(source), VECTOR_DIGEST);
  const mask = process.umask(0o077);
  try {
    copyTreeSafe(source, copied);
    assert.deepEqual(snapshot(copied), before);
    assert.equal(capabilityArtifactIntegrity(copied), VECTOR_DIGEST);
    const checked = [];
    const status = publishArtifactTree(source, published, (tree) => {
      checked.push(tree);
      assert.equal(existsSync(published), false, "verification precedes publication");
      assert.deepEqual(snapshot(tree), before);
      assert.equal(capabilityArtifactIntegrity(tree), VECTOR_DIGEST);
    });
    assert.equal(status, "retained");
    assert.equal(checked.length, 1);
    assert.match(checked[0], /\.staging-[^/]+\/tree$/);
  } finally { process.umask(mask); }
  assert.deepEqual(snapshot(published), before);
  assert.deepEqual(snapshot(source), before, "copying does not mutate the source");
  assert.equal(readdirSync(base).some((name) => name.startsWith(".staging-")), false);
  rmSync(join(source, "current.mjs"));
  symlinkSync("nested/run.mjs", join(source, "current.mjs"));
  assert.notEqual(capabilityArtifactIntegrity(source), VECTOR_DIGEST, "equivalent target with different spelling changes digest");
});

test("legacy artifact digest still ignores modes and empty directories but excludes no files", (t) => {
  const base = fixture(t), source = join(base, "source");
  vector(source);
  chmodSync(join(source, "nested/run.mjs"), 0o640);
  chmodSync(join(source, "a.bin"), 0o751);
  chmodSync(source, 0o700);
  mkdirSync(join(source, "another-empty-directory"));
  assert.equal(capabilityArtifactIntegrity(source), VECTOR_DIGEST, "no new executable-bit digest default");
  for (const path of [".git/HEAD", "oats-lock.json", ".oats-installation.json", "node_modules/vendor/index.mjs", "a.bin"]) {
    const file = join(source, path), bytes = readFileSync(file);
    writeFileSync(file, Buffer.concat([bytes, Buffer.from([0])]));
    assert.notEqual(capabilityArtifactIntegrity(source), VECTOR_DIGEST, path);
    writeFileSync(file, bytes);
  }
  assert.equal(capabilityArtifactIntegrity(source), VECTOR_DIGEST);
});

test("mechanical copy preserves even broken/external links; containment remains the retention caller's policy", (t) => {
  const base = fixture(t), source = join(base, "source"), copy = join(base, "copy");
  mkdirSync(source);
  const external = join(base, "external");
  writeFileSync(external, "must not copy or follow\n");
  symlinkSync(external, join(source, "absolute"));
  symlinkSync("missing", join(source, "broken"));
  copyTreeSafe(source, copy);
  assert.deepEqual(snapshot(copy), snapshot(source));
  assert.deepEqual(readdirSync(copy).sort(), ["absolute", "broken"]);
});

test("publication cleans staging on copy, validation and unrelated rename errors", (t) => {
  const base = fixture(t), source = join(base, "source"), dest = join(base, "dest");
  write(join(source, "payload"), "bytes\n");
  let checked = false;
  assert.throws(() => publishArtifactTree(join(base, "absent"), dest, () => { checked = true; }), { code: "ENOENT" });
  assert.equal(checked, false);
  const refusal = oatsError("integrity-drift", "copied bytes drifted");
  assert.throws(() => publishArtifactTree(source, dest, () => { throw refusal; }), (e) => e === refusal);
  assert.equal(existsSync(dest), false);
  writeFileSync(dest, "obstruction\n");
  assert.throws(() => publishArtifactTree(source, dest, () => {}), (e) => ["ENOTDIR", "EISDIR"].includes(e.code));
  assert.equal(readFileSync(dest, "utf8"), "obstruction\n");
  assert.equal(readdirSync(base).some((name) => name.startsWith(".staging-")), false);
});

test("a competing nonempty publication is verified, reused or refused, never replaced", (t) => {
  const base = fixture(t), source = join(base, "source");
  write(join(source, "payload"), "expected\n");
  for (const valid of [true, false]) {
    const dest = join(base, valid ? "valid" : "damaged");
    const checked = [];
    let originalInode;
    const publish = () => publishArtifactTree(source, dest, (tree) => {
      checked.push(tree);
      if (tree !== dest) {
        // Deterministically reproduce another preparer winning the rename.
        write(join(dest, "payload"), valid ? "expected\n" : "damaged\n");
        originalInode = lstatSync(dest).ino;
      }
      if (readFileSync(join(tree, "payload"), "utf8") !== "expected\n") throw oatsError("integrity-drift", "winner damaged");
    });
    if (valid) assert.equal(publish(), "kept");
    else assert.throws(publish, { code: "integrity-drift" });
    assert.equal(checked.length, 2);
    assert.equal(checked[1], dest);
    assert.equal(lstatSync(dest).ino, originalInode);
    assert.equal(readFileSync(join(dest, "payload"), "utf8"), valid ? "expected\n" : "damaged\n");
    assert.equal(readdirSync(base).some((name) => name.startsWith(".staging-")), false);
  }
});
