import test from "node:test";
import assert from "node:assert/strict";
import fs, {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as core from "../lib/core.mjs";
import { capabilityArtifactIntegrity, copyTreeSafe, publishArtifactTree } from "../lib/artifact-tree.mjs";
import * as provenance from "../lib/capability-provenance.mjs";
import { oatsError } from "../lib/errors.mjs";

const write = (file, bytes) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, bytes); };
function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-artifact-tree-")));
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
// Synchronous, fixture-local fault windows; restore even if an assertion fails.
// Test files run in separate processes and these tests do not run concurrently.
function withFsOverrides(overrides, run) {
  const originals = Object.fromEntries(Object.keys(overrides).map((key) => [key, fs[key]]));
  Object.assign(fs, overrides);
  syncBuiltinESMExports();
  try { return run(); }
  finally { Object.assign(fs, originals); syncBuiltinESMExports(); }
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
    assert.match(checked[0], /\.staging-[^/]+$/);
    assert.equal(dirname(checked[0]), dirname(published), "publication keeps the read-only root under the same parent");
  } finally { process.umask(mask); }
  assert.deepEqual(snapshot(published), before);
  assert.deepEqual(snapshot(source), before, "copying does not mutate the source");
  assert.equal(readdirSync(base).some((name) => name.startsWith(".staging-")), false);
  rmSync(join(source, "current.mjs"));
  symlinkSync("nested/run.mjs", join(source, "current.mjs"));
  assert.notEqual(capabilityArtifactIntegrity(source), VECTOR_DIGEST, "equivalent target with different spelling changes digest");
});

for (const rootMode of [0o500, 0o550, 0o555]) {
  test(`read-only artifact root ${rootMode.toString(8)} publishes and reuses a winner without mode changes`, (t) => {
    const base = fixture(t), source = join(base, "source");
    vector(source);
    chmodSync(source, rootMode);
    const before = snapshot(source);
    for (const competing of [false, true]) {
      const dest = join(base, competing ? "competing" : "single");
      let winnerInode, checked = 0;
      const verify = (tree) => {
        checked++;
        assert.deepEqual(snapshot(tree), before);
        if (tree !== dest) {
          assert.equal(dirname(tree), dirname(dest));
          if (competing) {
            assert.equal(publishArtifactTree(source, dest, (copy) => assert.deepEqual(snapshot(copy), before)), "retained");
            winnerInode = lstatSync(dest).ino;
          }
        }
      };
      assert.equal(publishArtifactTree(source, dest, verify), competing ? "kept" : "retained");
      assert.equal(checked, competing ? 2 : 1);
      assert.deepEqual(snapshot(source), before);
      assert.deepEqual(snapshot(dest), before);
      if (competing) assert.equal(lstatSync(dest).ino, winnerInode);
      assert.equal(readdirSync(base).some((name) => name.startsWith(".staging-")), false);
    }
  });
}

for (const winner of ["absent", "valid", "damaged", "symlink"]) {
  test(`rename permission denial requires a verified competing destination: ${winner}`, (t) => {
    const base = fixture(t), source = join(base, "source"), dest = join(base, "dest");
    vector(source);
    chmodSync(source, 0o500);
    const before = snapshot(source);
    const denied = Object.freeze(Object.assign(new Error("publication denied"), { code: "EACCES" }));
    const damaged = Object.freeze(oatsError("integrity-drift", "competing artifact is damaged"));
    let reached = false, destinationBefore;
    withFsOverrides({ renameSync(from, to) {
      reached = true;
      assert.equal(dirname(from), dirname(to));
      if (winner === "symlink") symlinkSync(source, to);
      else if (winner !== "absent") {
        copyTreeSafe(source, to);
        if (winner === "damaged") writeFileSync(join(to, "z.txt"), "not the approved payload");
      }
      if (winner !== "absent") destinationBefore = snapshot(to);
      throw denied;
    } }, () => {
      const run = () => publishArtifactTree(source, dest, (tree) => {
        if (!lstatSync(tree).isDirectory()) throw oatsError("invalid-artifact", "not a directory");
        if (capabilityArtifactIntegrity(tree) !== VECTOR_DIGEST) throw damaged;
      });
      if (winner === "valid") assert.equal(run(), "kept");
      else assert.throws(run, (error) => winner === "absent" ? error === denied
        : winner === "damaged" ? error === damaged : error.code === "invalid-artifact");
    });
    assert.equal(reached, true);
    assert.deepEqual(snapshot(source), before);
    if (winner !== "absent") assert.deepEqual(snapshot(dest), destinationBefore);
    else assert.equal(existsSync(dest), false);
    assert.equal(readdirSync(base).some((name) => name.startsWith(".staging-")), false);
  });
}

test("successful publication transfers staging ownership without a later cleanup or chmod", (t) => {
  const base = fixture(t), source = join(base, "source"), dest = join(base, "published");
  vector(source);
  chmodSync(source, 0o500);
  const before = snapshot(source), chmod = fs.chmodSync;
  let verified = false;
  withFsOverrides({
    rmSync() { assert.fail("the successful sibling rename leaves no owned staging to remove"); },
    chmodSync(path, mode) {
      assert.equal(verified, false, "publication never relaxes modes after verification");
      return chmod(path, mode);
    },
  }, () => {
    assert.equal(publishArtifactTree(source, dest, (tree) => {
      assert.deepEqual(snapshot(tree), before);
      verified = true;
    }), "retained");
  });
  assert.deepEqual(snapshot(source), before);
  assert.deepEqual(snapshot(dest), before);
  assert.deepEqual(readdirSync(base).sort(), ["published", "source"]);
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

test("a competing nonempty read-only publication is verified, reused or refused, never replaced", (t) => {
  const base = fixture(t), source = join(base, "source");
  vector(source);
  const before = snapshot(source);
  for (const valid of [true, false]) {
    const dest = join(base, valid ? "valid" : "damaged");
    const checked = [];
    let originalInode, winner;
    const refusal = oatsError("integrity-drift", "winner damaged");
    const publish = () => publishArtifactTree(source, dest, (tree) => {
      checked.push(tree);
      if (tree !== dest) {
        // Deterministically reproduce another preparer winning the real rename.
        copyTreeSafe(source, dest);
        if (!valid) writeFileSync(join(dest, "a.bin"), "damaged\n");
        originalInode = lstatSync(dest).ino;
        winner = snapshot(dest);
      }
      if (capabilityArtifactIntegrity(tree) !== VECTOR_DIGEST) throw refusal;
    });
    if (valid) assert.equal(publish(), "kept");
    else assert.throws(publish, (e) => e === refusal);
    assert.equal(checked.length, 2);
    assert.equal(checked[1], dest);
    assert.equal(lstatSync(dest).ino, originalInode);
    assert.deepEqual(snapshot(dest), winner, "winner bytes, modes and links are untouched");
    assert.deepEqual(snapshot(source), before);
    assert.equal(readdirSync(base).some((name) => name.startsWith(".staging-")), false);
  }
});

test("copy failure after a completed read-only subtree removes only the partial staging tree", (t) => {
  const base = fixture(t), source = join(base, "source"), dest = join(base, "dest");
  vector(source);
  writeFileSync(join(source, "zz-stop"), "unavailable later in copy\n");
  chmodSync(join(source, "nested/run.mjs"), 0o400);
  chmodSync(source, 0o550);
  const before = snapshot(source), copy = fs.copyFileSync;
  const refusal = Object.freeze(oatsError("EIO", "bounded copy failure"));
  let injected = false;
  withFsOverrides({ copyFileSync(src, target, ...args) {
    if (src === join(source, "zz-stop")) {
      assert.equal(lstatSync(join(dirname(target), "nested")).mode & 0o777, 0o550);
      assert.equal(lstatSync(join(dirname(target), "nested/run.mjs")).mode & 0o777, 0o400);
      injected = true;
      throw refusal;
    }
    return copy(src, target, ...args);
  } }, () => {
    assert.throws(() => publishArtifactTree(source, dest, () => assert.fail("partial copy must not verify")), (e) => e === refusal);
  });
  assert.equal(injected, true);
  assert.deepEqual(snapshot(source), before);
  assert.equal(existsSync(dest), false);
  assert.deepEqual(readdirSync(base), ["source"]);
});

test("verification failure removes read-only staging top-down and preserves the exact primary error", (t) => {
  const base = fixture(t), source = join(base, "source"), dest = join(base, "dest");
  vector(source);
  chmodSync(source, 0o550);
  const before = snapshot(source);
  const refusal = Object.freeze(oatsError("integrity-drift", "copied bytes drifted", [{ origin: "copy" }]));
  for (const mode of [0o550, 0o000]) {
    assert.throws(() => publishArtifactTree(source, dest, (tree) => {
      assert.deepEqual(snapshot(tree), before);
      // Even a staged directory made unsearchable at the failure boundary is
      // disposable. No source permission or published permission is relaxed.
      chmodSync(tree, mode);
      throw refusal;
    }), (e) => e === refusal);
    assert.deepEqual(snapshot(source), before);
    assert.equal(existsSync(dest), false);
    assert.deepEqual(readdirSync(base), ["source"]);
  }
});

test("rollback never follows directory/file, broken or cyclic symlinks out of owned staging", (t) => {
  const base = fixture(t), source = join(base, "source"), dest = join(base, "winner");
  const published = join(base, "published"), peer = join(base, ".staging-peer");
  vector(source); vector(dest); vector(published); vector(peer);
  symlinkSync(join(source, "nested"), join(source, "source-link"));
  symlinkSync(join(dest, "nested"), join(source, "winner-link"));
  symlinkSync(published, join(source, "published-link"));
  symlinkSync(peer, join(source, "peer-staging-link"));
  symlinkSync(join(published, "a.bin"), join(source, "file-link"));
  symlinkSync(".", join(source, "cycle"));
  symlinkSync("missing", join(source, "broken"));
  chmodSync(published, 0o550);
  chmodSync(peer, 0o550);
  const protectedRoots = [source, dest, published, peer];
  const before = protectedRoots.map(snapshot);
  const chmod = fs.chmodSync, changed = [];
  withFsOverrides({ chmodSync(path, mode) {
    assert.match(path, /\/\.staging-[^/]+(?:\/|$)/, "never chmod a source, winner, published tree or link target");
    assert.equal(lstatSync(path).isSymbolicLink(), false, "never chmod a symlink");
    changed.push(path);
    return chmod(path, mode);
  } }, () => {
    const refusal = oatsError("artifact-not-contained", "caller refuses links");
    assert.throws(() => publishArtifactTree(source, dest, () => { throw refusal; }), (e) => e === refusal);
    // Mechanical reuse exercises cleanup of the same links. The retention
    // caller's containment refusal is tested separately with its real verifier.
    assert.equal(publishArtifactTree(source, dest, () => {}), "kept");
  });
  assert.ok(changed.length > 0, "permission instrumentation was exercised");
  assert.deepEqual(protectedRoots.map(snapshot), before);
  assert.deepEqual(readdirSync(base).filter((name) => name.startsWith(".staging-")), [".staging-peer"], "never clean another preparer's staging");
});

test("rollback unlinks a staged tree-root symlink without changing its read-only target", (t) => {
  const base = fixture(t), source = join(base, "source-link"), published = join(base, "published");
  vector(published);
  chmodSync(published, 0o550);
  symlinkSync(published, source);
  const before = snapshot(published), refusal = oatsError("invalid-artifact", "root is a symlink");
  withFsOverrides({ chmodSync() { assert.fail("neither the staged symlink nor its target needs chmod"); } }, () => {
    assert.throws(() => publishArtifactTree(source, join(base, "dest"), (tree) => {
      assert.equal(lstatSync(tree).isSymbolicLink(), true);
      throw refusal;
    }), (e) => e === refusal);
  });
  assert.deepEqual(snapshot(published), before);
  assert.equal(readlinkSync(source), published);
  assert.deepEqual(readdirSync(base).sort(), ["published", "source-link"]);
});

for (const outcome of ["copy", "verification", "invalid-winner", "kept"]) {
  test(`cleanup failure is reported honestly after ${outcome}, without hiding primary diagnostics or changing published modes`, (t) => {
    const base = fixture(t), source = join(base, "source"), dest = join(base, "dest");
    vector(source);
    chmodSync(source, ["copy", "verification"].includes(outcome) ? 0o550 : 0o750);
    const before = snapshot(source), copy = fs.copyFileSync;
    const primary = Object.freeze(oatsError(outcome === "copy" ? "EIO" : "integrity-drift", "original failure", [{ origin: outcome }]));
    const cleanup = Object.freeze(Object.assign(new Error("bounded cleanup I/O failure"), { code: "EACCES" }));
    let staging, winner, inode;
    withFsOverrides({
      copyFileSync(src, target, ...args) {
        if (outcome === "copy" && src === join(source, "z.txt")) throw primary;
        return copy(src, target, ...args);
      },
      rmSync(path) {
        assert.match(path, /\/\.staging-[^/]+$/);
        staging = path;
        throw cleanup;
      },
    }, () => {
      assert.throws(() => publishArtifactTree(source, dest, (tree) => {
        if (outcome === "verification" || (tree === dest && outcome === "invalid-winner")) throw primary;
        if (tree !== dest && ["kept", "invalid-winner"].includes(outcome)) {
          copyTreeSafe(source, dest);
          if (outcome === "invalid-winner") writeFileSync(join(dest, "a.bin"), "damaged winner\n");
          winner = snapshot(dest);
          inode = lstatSync(dest).ino;
        }
      }), (e) => {
        assert.equal(e.stagingPath, staging);
        assert.equal(existsSync(staging), true, "leftover staging is not claimed removed");
        assert.match(e.message, /artifact staging cleanup failed at .*\.staging-.*bounded cleanup I\/O failure/);
        if (outcome === "kept") {
          assert.equal(e.code, "EACCES");
          assert.equal(e.cause, cleanup, "do not return a success receipt on cleanup failure");
        } else {
          assert.ok(e instanceof AggregateError);
          assert.equal(e.code, primary.code);
          assert.equal(e.cause, primary);
          assert.equal(e.provenance, primary.provenance);
          assert.deepEqual(e.errors, [primary, cleanup]);
          assert.match(e.message, /^original failure; /);
        }
        return true;
      });
    });
    assert.deepEqual(snapshot(source), before);
    if (["kept", "invalid-winner"].includes(outcome)) {
      assert.deepEqual(snapshot(dest), winner ?? before);
      if (inode !== undefined) assert.equal(lstatSync(dest).ino, inode);
      assert.equal(existsSync(staging), true);
    } else assert.equal(existsSync(dest), false);
  });
}

test("failure to make an owned read-only directory removable is reported alongside the primary refusal", (t) => {
  const base = fixture(t), source = join(base, "source"), dest = join(base, "dest");
  vector(source);
  chmodSync(source, 0o550);
  const before = snapshot(source), chmod = fs.chmodSync;
  const primary = Object.freeze(oatsError("integrity-drift", "verification refused"));
  const cleanup = Object.assign(new Error("cannot chmod owned staging"), { code: "EPERM" });
  let tree;
  withFsOverrides({ chmodSync(path, mode) {
    if (path === tree && mode === 0o750) throw cleanup;
    return chmod(path, mode);
  } }, () => {
    assert.throws(() => publishArtifactTree(source, dest, (staged) => { tree = staged; throw primary; }), (e) => {
      assert.equal(e.code, "integrity-drift");
      assert.equal(e.cause, primary);
      assert.deepEqual(e.errors, [primary, cleanup]);
      assert.equal(e.stagingPath, tree);
      assert.match(e.message, /verification refused; .*cannot chmod owned staging/);
      return true;
    });
  });
  assert.deepEqual(snapshot(source), before);
  assert.deepEqual(snapshot(tree), before, "refused chmod leaves the unpublished copy available for diagnosis");
  assert.equal(existsSync(dest), false);
});
