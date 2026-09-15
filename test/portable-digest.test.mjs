import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson, decodeUtf8, parseStrictJson } from "../lib/portable-values.mjs";
import { BYTES_FORMAT, JSON_FORMAT, PACKAGE_FORMAT, TREE_FORMAT, bytesIntegrity, jsonIntegrity, treeIntegrity, validateIntegrity } from "../lib/portable-digest.mjs";
import { capabilityArtifactIntegrity } from "../lib/artifact-tree.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oats-portable-digest-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("canonical records use UTF-8 key order, preserve arrays and include exactly one LF", () => {
  assert.equal(canonicalJson({ 2: 2, 10: 1, nested: { z: -0, a: [true, null, "😀"] } }),
    '{"10":1,"2":2,"nested":{"a":[true,null,"😀"],"z":0}}\n');
  const a = { z: 2, a: 1 }, b = { a: 1, z: 2 };
  assert.deepEqual(jsonIntegrity(a), jsonIntegrity(b));
  assert.equal(jsonIntegrity(a).format, JSON_FORMAT);
  assert.notEqual(jsonIntegrity([1, 2]).value, jsonIntegrity([2, 1]).value);
  const raw = bytesIntegrity(Buffer.from(canonicalJson(a)));
  assert.equal(raw.format, BYTES_FORMAT);
  assert.equal(raw.value, jsonIntegrity(a).value, "JSON hash includes its final LF, no implicit prefix");
});

test("canonical data refuses lossy strings, cycles and caller hooks without invoking them", () => {
  let called = false;
  const accessor = Object.defineProperty({}, "secret", { enumerable: true, get() { called = true; return 1; } });
  const hook = { toJSON() { called = true; return {}; } };
  const cyclic = {}; cyclic.self = cyclic;
  for (const value of [accessor, hook, cyclic, new Date(0), NaN, Infinity, undefined, 1n, "\ud800", [, 1]]) {
    assert.throws(() => canonicalJson(value), { code: "invalid-declaration" });
  }
  assert.equal(called, false);
  assert.throws(() => canonicalJson({ a: { b: 1 } }, { maxDepth: 1 }), { code: "resource-limit" });
  assert.throws(() => canonicalJson([1, 2], { maxEntries: 2 }), { code: "resource-limit" });
  assert.throws(() => canonicalJson("long", { maxBytes: 3 }), { code: "resource-limit" });
});

test("strict JSON preserves own-key data and refuses duplicate decoded keys or invalid bounded input", () => {
  const value = parseStrictJson('{"__proto__":{"safe":true},"array":[0,false,null,"x"]}');
  assert.equal(Object.getPrototypeOf(value), null);
  assert.equal(Object.hasOwn(value, "__proto__"), true);
  assert.equal(value.__proto__.safe, true);
  assert.equal(Object.hasOwn({}, "safe"), false);
  assert.equal(canonicalJson(value), '{"__proto__":{"safe":true},"array":[0,false,null,"x"]}\n');
  for (const text of ['{"a":1,"\\u0061":2}', '{"x":1,}', '[1,]', '01', '1e400', 'true false', '"\\ud800"']) {
    assert.throws(() => parseStrictJson(text), { code: "invalid-declaration" }, text);
  }
  assert.throws(() => parseStrictJson(Buffer.from([0xff])), { code: "invalid-declaration" });
  assert.throws(() => parseStrictJson('[[[1]]]', { maxDepth: 1 }), { code: "resource-limit" });
  assert.throws(() => parseStrictJson('{}', { maxBytes: 1 }), { code: "resource-limit" });
  assert.equal(decodeUtf8(Buffer.from("\ufeffname")), "\ufeffname", "no silent BOM stripping in source names");
});

test("byte budgets and integrity validation never invoke caller-owned accessors", () => {
  let calls = 0;
  const view = new Uint8Array(Buffer.from("[true]"));
  for (const key of ["byteLength", "buffer", "byteOffset"]) {
    Object.defineProperty(view, key, { get() { calls++; return 0; } });
  }
  assert.throws(() => parseStrictJson(view, { maxBytes: 1 }), { code: "resource-limit" });
  assert.deepEqual(parseStrictJson(view), [true]);
  assert.throws(() => parseStrictJson({ get byteLength() { calls++; return 0; } }), { code: "invalid-declaration" });
  const reference = { value: `sha256-${"a".repeat(64)}` };
  Object.defineProperty(reference, "format", { enumerable: true, get() { calls++; return TREE_FORMAT; } });
  assert.throws(() => validateIntegrity(reference), { code: "invalid-artifact-reference" });
  assert.equal(calls, 0);
});

test("length-framed new digest separates the real legacy binary collision without changing the old verifier", (t) => {
  const root = fixture(t), a = join(root, "a"), b = join(root, "b"), empty = join(root, "empty");
  for (const dir of [a, b, empty]) mkdirSync(dir);
  writeFileSync(join(a, "a"), Buffer.from("X\0b\0file\0Y"));
  writeFileSync(join(b, "a"), "X"); writeFileSync(join(b, "b"), "Y");
  for (const file of [join(a, "a"), join(b, "a"), join(b, "b")]) chmodSync(file, 0o644);
  assert.equal(capabilityArtifactIntegrity(a), capabilityArtifactIntegrity(b), "legacy evidence keeps its literal old meaning");
  assert.deepEqual(treeIntegrity(a), { format: TREE_FORMAT, value: "sha256-3c9b46604cda25ff0be52b3b6ee8a5f430e5cd4732d7e2fb486872f755354596" });
  assert.equal(treeIntegrity(b).value, "sha256-d5bfeee09d73f8566ddf8095a60e214df7adac76d300e7165f9e90444f00e2e7");
  assert.equal(treeIntegrity(empty).value, "sha256-5f82a0b17e70d470f72811399b20c3b083783a1d2b68ec3be3e2163ac51bb21f");
  assert.throws(() => treeIntegrity(a, { format: "future" }), { code: "unsupported-wire-version" });
  assert.throws(() => validateIntegrity({ value: treeIntegrity(a).value }), { code: "invalid-artifact-reference" });
});

test("owner execute and literal link targets enter identity, other mode bits and empty directories do not", (t) => {
  const root = fixture(t), file = join(root, "run");
  writeFileSync(file, "payload"); chmodSync(file, 0o644);
  const original = treeIntegrity(root);
  chmodSync(file, 0o655);
  assert.deepEqual(treeIntegrity(root), original);
  chmodSync(file, 0o755);
  assert.notEqual(treeIntegrity(root).value, original.value);
  chmodSync(file, 0o600); mkdirSync(join(root, "empty"));
  assert.deepEqual(treeIntegrity(root), original);
  symlinkSync("run", join(root, "current"));
  const link = treeIntegrity(root);
  rmSync(join(root, "current")); symlinkSync("./run", join(root, "current"));
  assert.notEqual(treeIntegrity(root).value, link.value);
  assert.throws(() => treeIntegrity(root, { maxBytes: 1 }), { code: "resource-limit" });
});

test("Git and path materialization agree on owner-execute identity despite umask and group bits", (t) => {
  const root = fixture(t), repo = join(root, "repo"), out = join(root, "out");
  mkdirSync(join(repo, "pkg"), { recursive: true }); mkdirSync(out);
  writeFileSync(join(repo, "pkg/run"), "#!/bin/sh\nexit 0\n"); chmodSync(join(repo, "pkg/run"), 0o751);
  writeFileSync(join(repo, "pkg/data"), "data"); chmodSync(join(repo, "pkg/data"), 0o640);
  symlinkSync("run", join(repo, "pkg/current"));
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" };
  const git = (...args) => execFileSync("git", ["-C", repo, ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
  git("init", "--template=", "-q"); git("add", "pkg");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--no-gpg-sign", "-qm", "fixture");
  const mask = process.umask(0o077);
  try { execFileSync("tar", ["-xf", "-", "-C", out], { input: git("archive", "--format=tar", "HEAD", "pkg"), env }); }
  finally { process.umask(mask); }
  assert.deepEqual(treeIntegrity(join(repo, "pkg")), treeIntegrity(join(out, "pkg")));
  assert.equal(readFileSync(join(out, "pkg/run"), "utf8"), "#!/bin/sh\nexit 0\n");
});

test("package payload exclusions are explicit and do not weaken full retained artifact identity", (t) => {
  const root = fixture(t);
  writeFileSync(join(root, "payload"), "source");
  const payload = treeIntegrity(root, { format: PACKAGE_FORMAT });
  const artifact = treeIntegrity(root);
  mkdirSync(join(root, "node_modules"));
  writeFileSync(join(root, "node_modules/dependency"), "runtime bytes");
  writeFileSync(join(root, "oats-lock.json"), "local lock");
  assert.deepEqual(treeIntegrity(root, { format: PACKAGE_FORMAT }), payload);
  assert.notDeepEqual(treeIntegrity(root), artifact);
});
