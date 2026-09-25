// Package-manifest, lock-row and materialization primitives that outlive the
// 0.25 package engine (docs/design/package-engine-contract.md): manifest
// validation, lock-entry validation, self-containment, the npm closure checks
// and copyTreeSafe. The engine itself (acquire/update/approve, the installed-store
// trust and discovery) was removed in 0.26.0; its last writer is
// lib/captured-store-writer.mjs, deleted with the captured path.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";

import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  assertCapabilitySelfContained, copyTreeSafe, loadPackageManifestAt, materializeCapabilityDeps, normalizePackagePath, isCanonicalTemplatePath, platformVariantLockPackages, validateCapabilityLockEntry, validateLockEntry,
} from "../lib/core.mjs";

function temp() { return mkdtempSync(join(tmpdir(), "oats-pkg-test-")); }
function write(path, content) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); }
/** Author a package source tree: oats-package.json + capability dirs. */
function pkgSource(dir, manifest, capabilities = {}) {
  const caps = [];
  for (const [rel, cm] of Object.entries(capabilities)) {
    caps.push(rel);
    write(join(dir, rel, "oats.json"), JSON.stringify({ version: "1.0.0", description: "cap", ...cm }, null, 2));
  }
  write(join(dir, "oats-package.json"), JSON.stringify({ package: `x.${dir.split("/").pop().toLowerCase().replace(/[^a-z0-9._-]/g, "")}`, version: "1.0.0", description: "pkg", compatibility: { oats: ">=0.1.0" }, capabilities: caps, ...manifest }, null, 2));
  return dir;
}
function throwsCode(fn, code, label = code) {
  try { fn(); assert.fail(`expected ${label} but nothing was thrown`); }
  catch (e) { assert.equal(e.code, code, `${label}: got ${e.code} — ${e.message}`); return e; }
}

// ---------- source parsing ----------

test("normalizePackagePath: canonical form, and fail-closed on ambient/absolute/traversal spellings", () => {
  for (const spelling of ["", ".", "./", "./."]) assert.equal(normalizePackagePath(spelling), ".");
  assert.equal(normalizePackagePath("a//b/"), "a/b");
  assert.equal(normalizePackagePath(undefined), undefined, "absent means absent, so the caller can apply its own default");
  throwsCode(() => normalizePackagePath("~/x"), "invalid-source", "tilde");
  throwsCode(() => normalizePackagePath("/abs"), "invalid-source", "absolute");
  throwsCode(() => normalizePackagePath("C:/x"), "invalid-source", "drive");
  throwsCode(() => normalizePackagePath("a\\b"), "invalid-source", "backslash");
  throwsCode(() => normalizePackagePath("a/../b"), "path-escape", "traversal");
  // A present null is a violation, not a fall-through to the caller's default.
  throwsCode(() => normalizePackagePath(null), "invalid-source", "null");
});

// ---------- manifest validation ----------

test("loadPackageManifestAt: capabilities are REQUIRED and non-empty — config-only and empty packages are rejected", () => {
  const t = temp();
  const ok = pkgSource(join(t, "ok"), {}, { "capabilities/a": { capability: "x.a" } });
  const m = loadPackageManifestAt(ok);
  assert.deepEqual(m._capabilities.map((c) => c.id), ["x.a"]);
  assert.equal(m._legacySpelling, false);

  const empty = join(t, "empty");
  write(join(empty, "oats-package.json"), JSON.stringify({ package: "x.empty", version: "1.0.0", description: "d", compatibility: { oats: ">=0.1.0" }, capabilities: [] }));
  throwsCode(() => loadPackageManifestAt(empty), "invalid-package-manifest", "empty capabilities");

  const none = join(t, "none");
  write(join(none, "oats-package.json"), JSON.stringify({ package: "x.none", version: "1.0.0", description: "d", compatibility: { oats: ">=0.1.0" } }));
  throwsCode(() => loadPackageManifestAt(none), "invalid-package-manifest", "absent capabilities");

  const cfgOnly = join(t, "cfgonly");
  write(join(cfgOnly, "config-templates/d/oats-config.yaml"), "name: x\n");
  write(join(cfgOnly, "oats-package.json"), JSON.stringify({ package: "x.cfg", version: "1.0.0", description: "d", compatibility: { oats: ">=0.1.0" }, capabilities: [], configTemplates: { d: { path: "config-templates/d/oats-config.yaml" } } }));
  throwsCode(() => loadPackageManifestAt(cfgOnly), "invalid-package-manifest", "config-only package");
});

test('legacy "." capability roots are discriminated by configTemplates, NEVER by configs', () => {
  const t = temp();
  // The published shape this compatibility exists for: oats.authoring@1.0.0 is
  // capabilities:["."] and ships NO template map in either spelling. Keying
  // acceptance on `configs` would strand it.
  const authoring = join(t, "authoring");
  write(join(authoring, "oats.json"), JSON.stringify({ capability: "oats.authoring", version: "1.0.0", description: "authoring" }));
  write(join(authoring, "oats-package.json"), JSON.stringify({ package: "oats.authoring", version: "1.0.0", description: "d", compatibility: { oats: ">=0.1.0" }, capabilities: ["."] }));
  const m = loadPackageManifestAt(authoring);
  assert.deepEqual(m._capabilities.map((c) => c.rel), ["."]);
  assert.equal(m._legacySpelling, false, "no template map at all — the legacy spelling is not what makes it legacy");

  // Deprecated `configs` spelling with "." also reads.
  const withConfigs = join(t, "withconfigs");
  write(join(withConfigs, "oats.json"), JSON.stringify({ capability: "x.flat", version: "1.0.0", description: "d" }));
  write(join(withConfigs, "configs/d/oats-config.yaml"), "name: x\n");
  write(join(withConfigs, "oats-package.json"), JSON.stringify({ package: "x.flat", version: "1.0.0", description: "d", compatibility: { oats: ">=0.1.0" }, capabilities: ["."], configs: { d: { path: "configs/d/oats-config.yaml" } } }));
  const legacy = loadPackageManifestAt(withConfigs);
  assert.equal(legacy._legacySpelling, true);
  assert.deepEqual(Object.keys(legacy._configTemplates), ["d"]);

  // A manifest carrying configTemplates is unambiguously new: "." is rejected.
  const modern = join(t, "modern");
  write(join(modern, "oats.json"), JSON.stringify({ capability: "x.new", version: "1.0.0", description: "d" }));
  write(join(modern, "config-templates/d/oats-config.yaml"), "name: x\n");
  write(join(modern, "oats-package.json"), JSON.stringify({ package: "x.new", version: "1.0.0", description: "d", compatibility: { oats: ">=0.1.0" }, capabilities: ["."], configTemplates: { d: { path: "config-templates/d/oats-config.yaml" } } }));
  throwsCode(() => loadPackageManifestAt(modern), "invalid-package-manifest", 'new-format "."');

  // Both spellings at once is invalid.
  const both = join(t, "both");
  write(join(both, "capabilities/a/oats.json"), JSON.stringify({ capability: "x.b", version: "1.0.0", description: "d" }));
  write(join(both, "config-templates/oats-config.yaml"), "name: x\n");
  write(join(both, "oats-package.json"), JSON.stringify({ package: "x.both", version: "1.0.0", description: "d", compatibility: { oats: ">=0.1.0" }, capabilities: ["capabilities/a"], configs: { d: { path: "config-templates/oats-config.yaml" } }, configTemplates: { d: { path: "config-templates/oats-config.yaml" } } }));
  throwsCode(() => loadPackageManifestAt(both), "invalid-package-manifest", "both spellings");
});

test('"." remains exclusive with any other capability path', () => {
  const t = temp();
  const d = join(t, "p");
  write(join(d, "oats.json"), JSON.stringify({ capability: "x.root", version: "1.0.0", description: "d" }));
  write(join(d, "sub/oats.json"), JSON.stringify({ capability: "x.sub", version: "1.0.0", description: "d" }));
  write(join(d, "oats-package.json"), JSON.stringify({ package: "x.p", version: "1.0.0", description: "d", compatibility: { oats: ">=0.1.0" }, capabilities: [".", "sub"] }));
  throwsCode(() => loadPackageManifestAt(d), "invalid-package-manifest", '"." with siblings');
});

test("loadPackageManifestAt: identity, unknown keys, missing paths, duplicate capability, multi-default, compatibility grammar", () => {
  const t = temp();
  const mk = (patch, caps = { "capabilities/a": { capability: "x.a" } }) => pkgSource(join(t, `p${Math.random().toString(36).slice(2)}`), { package: "x.p", ...patch }, caps);
  throwsCode(() => loadPackageManifestAt(mk({ package: "Bad Id" })), "invalid-package-manifest", "identity charset");
  throwsCode(() => loadPackageManifestAt(mk({ nope: 1 })), "invalid-package-manifest", "unknown key");
  throwsCode(() => loadPackageManifestAt(mk({ version: 1 })), "invalid-package-manifest", "numeric version");
  throwsCode(() => loadPackageManifestAt(mk({ dependencies: ["a", "a"] })), "invalid-package-manifest", "duplicate dependencies");
  // Two capability paths exporting one ID.
  throwsCode(() => loadPackageManifestAt(mk({}, { "capabilities/a": { capability: "x.dup" }, "capabilities/b": { capability: "x.dup" } })), "duplicate-capability-id", "same id twice");
  // compatibility.oats: required, exact grammar.
  for (const oats of [">=0.1.0", "^0.1.0", "0.1.0"]) loadPackageManifestAt(mk({ compatibility: { oats } }));
  for (const oats of ["banana", ">=1.2", "~1.2.3", ">= 1.2.3", 1]) {
    throwsCode(() => loadPackageManifestAt(mk({ compatibility: { oats } })), "invalid-package-manifest", `compat ${JSON.stringify(oats)}`);
  }
  const noCompat = mk({});
  const doc = JSON.parse(readFileSync(join(noCompat, "oats-package.json"), "utf8"));
  delete doc.compatibility;
  writeFileSync(join(noCompat, "oats-package.json"), JSON.stringify(doc));
  throwsCode(() => loadPackageManifestAt(noCompat), "invalid-package-manifest", "missing compatibility");
  // At most one default template.
  const multi = join(t, "multi");
  write(join(multi, "capabilities/a/oats.json"), JSON.stringify({ capability: "x.a", version: "1.0.0", description: "d" }));
  write(join(multi, "config-templates/a.yaml"), "a: 1\n"); write(join(multi, "config-templates/b.yaml"), "b: 1\n");
  write(join(multi, "oats-package.json"), JSON.stringify({ package: "x.multi", version: "1.0.0", description: "d", compatibility: { oats: ">=0.1.0" }, capabilities: ["capabilities/a"], configTemplates: { a: { path: "config-templates/a.yaml", default: true }, b: { path: "config-templates/b.yaml", default: true } } }));
  throwsCode(() => loadPackageManifestAt(multi), "invalid-package-manifest", "two defaults");
});

test("loadPackageManifestAt: hostile roots are typed, never a TypeError", () => {
  const t = temp();
  for (const raw of ["null", '"str"', "[]", "3", "{"]) {
    const d = join(t, `h${Math.random().toString(36).slice(2)}`);
    write(join(d, "oats-package.json"), raw);
    throwsCode(() => loadPackageManifestAt(d), "invalid-package-manifest", `root ${raw}`);
  }
});

test("loadPackageManifestAt: declared paths cannot escape the package root, lexically or through a symlink", () => {
  const t = temp();
  const outside = join(t, "outside"); write(join(outside, "oats.json"), JSON.stringify({ capability: "x.out", version: "1.0.0", description: "d" }));
  const d = join(t, "p");
  write(join(d, "capabilities/a/oats.json"), JSON.stringify({ capability: "x.a", version: "1.0.0", description: "d" }));
  write(join(d, "oats-package.json"), JSON.stringify({ package: "x.p", version: "1.0.0", description: "d", compatibility: { oats: ">=0.1.0" }, capabilities: ["../outside"] }));
  throwsCode(() => loadPackageManifestAt(d), "path-escape", "lexical ..");
  symlinkSync(outside, join(d, "linked"));
  writeFileSync(join(d, "oats-package.json"), JSON.stringify({ package: "x.p", version: "1.0.0", description: "d", compatibility: { oats: ">=0.1.0" }, capabilities: ["linked"] }));
  throwsCode(() => loadPackageManifestAt(d), "path-escape", "symlinked escape");
});

// ---------- self-containment ----------

test("assertCapabilitySelfContained: every declared resource must exist inside the capability root", () => {
  const t = temp();
  const cap = join(t, "cap");
  const manifest = { capability: "x.a", version: "1.0.0", description: "d", skills: ["skills/s"], inject: "inject.md", commands: { go: "bin/go.mjs run" }, hooks: { spawn: "bin/hook.mjs spawn" }, agents: ["agents/a"] };
  write(join(cap, "skills/s/SKILL.md"), "# s\n");
  write(join(cap, "inject.md"), "x\n");
  write(join(cap, "bin/go.mjs"), "//\n");
  write(join(cap, "bin/hook.mjs"), "//\n");
  write(join(cap, "agents/a/soul.yaml"), "name: a\n");
  assertCapabilitySelfContained(cap, manifest); // all present

  // A declared-but-missing artifact is not projectable.
  rmSync(join(cap, "inject.md"));
  throwsCode(() => assertCapabilitySelfContained(cap, manifest), "capability-not-self-contained", "missing inject");
  write(join(cap, "inject.md"), "x\n");

  // A resource reaching OUTSIDE the capability root — the package-only path case.
  write(join(t, "package-shared/SKILL.md"), "# shared\n");
  symlinkSync(join(t, "package-shared"), join(cap, "skills/shared"));
  throwsCode(() => assertCapabilitySelfContained(cap, { ...manifest, skills: ["skills/shared"] }), "capability-not-self-contained", "escaping skill tree");
  // ...and a descendant link that escapes, under a contained declared root.
  symlinkSync(join(t, "package-shared"), join(cap, "skills/s/nested"));
  throwsCode(() => assertCapabilitySelfContained(cap, manifest), "capability-not-self-contained", "escaping descendant");
});

test("dependencies is REQUIRED on every package row (empty array when none)", () => {
  const base = { source: "path:/tmp/x", path: ".", version: "1", commit: "local", integrity: `sha256-${"a".repeat(64)}` };
  throwsCode(() => validateLockEntry("x.p", base, { "x.p": base }), "invalid-lock", "absent dependencies");
  assert.equal(validateLockEntry("x.p", { ...base, dependencies: [] }, { "x.p": base }), true);
});

test("capability rows must reference a locked provider package", () => {
  const packages = { "x.p": { source: "path:/tmp/x", path: ".", version: "1", commit: "local", integrity: `sha256-${"a".repeat(64)}`, dependencies: [] } };
  const row = { version: "1", package: "x.p", path: "capabilities/a", integrity: `sha256-${"b".repeat(64)}`, trusted: false };
  assert.equal(validateCapabilityLockEntry("x.a", row, packages), true);
  throwsCode(() => validateCapabilityLockEntry("x.a", { ...row, package: "x.missing" }, packages), "invalid-lock", "dangling provider");
  throwsCode(() => validateCapabilityLockEntry("x.a", { ...row, trusted: "yes" }, packages), "invalid-lock", "non-boolean trusted");
  throwsCode(() => validateCapabilityLockEntry("x.a", { ...row, path: "./a" }, packages), "invalid-lock", "non-canonical path");
});

test("validateLockEntry: source/commit pairing, canonical path, self-dependency, locked-graph cycle, duplicates", () => {
  const good = { source: "git:https://h/r.git@v1", path: "oats-package", version: "1", commit: "0".repeat(40), integrity: `sha256-${"a".repeat(64)}`, dependencies: [] };
  assert.equal(validateLockEntry("x.p", good, { "x.p": good }), true);
  throwsCode(() => validateLockEntry("x.p", { ...good, commit: "abc" }, { "x.p": good }), "invalid-lock", "short git commit");
  throwsCode(() => validateLockEntry("x.p", { ...good, source: "path:/d", commit: "0".repeat(40) }, {}), "invalid-lock", "path source needs commit local");
  throwsCode(() => validateLockEntry("x.p", { ...good, source: "path:/d", commit: "local", path: "sub" }, {}), "invalid-lock", "path source needs path .");
  throwsCode(() => validateLockEntry("x.p", { ...good, path: "sub/" }, { "x.p": good }), "invalid-lock", "non-canonical path");
  throwsCode(() => validateLockEntry("x.p", { ...good, dependencies: ["x.p"] }, { "x.p": good }), "invalid-lock", "self-dependency");
  throwsCode(() => validateLockEntry("x.p", { ...good, dependencies: ["x.q"] }, { "x.p": good }), "invalid-lock", "unlocked dependency");
  throwsCode(() => validateLockEntry("x.p", { ...good, dependencies: ["x.q", "x.q"] }, { "x.p": good, "x.q": good }), "invalid-lock", "duplicate dependency");
  // Reclassification defence: a payload that merely starts with a known scheme.
  for (const source of ["catalog:../evil", "path:relative/dir", "git:not-a-url", "git:https://h/r.git#frag"]) {
    throwsCode(() => validateLockEntry("x.p", { ...good, source }, { "x.p": good }), "invalid-lock", `source ${source}`);
  }
  // Cycle over the locked graph.
  const a = { ...good, dependencies: ["x.b"] }, b = { ...good, dependencies: ["x.a"] };
  throwsCode(() => validateLockEntry("x.a", a, { "x.a": a, "x.b": b }), "invalid-lock", "cycle");
});

test("the CANONICAL template location is enforced, and the deprecated spelling stays exempt", () => {
  const t = temp();
  const mk = (name, templates, key = "configTemplates") => {
    const d = join(t, name);
    pkgSource(d, { package: `x.${name}` }, { "capabilities/a": { capability: `x.${name}cap` } });
    for (const tpl of Object.values(templates)) write(join(d, tpl.path), "name: x\n");
    const m = JSON.parse(readFileSync(join(d, "oats-package.json"), "utf8"));
    delete m.configTemplates;
    m[key] = templates;
    write(join(d, "oats-package.json"), JSON.stringify(m, null, 2));
    return d;
  };

  // Canonical: accepted.
  const ok = mk("okpkg", { default: { path: "config-templates/default/oats-config.yaml", default: true } });
  assert.equal(loadPackageManifestAt(ok)._configTemplates.default.path, "config-templates/default/oats-config.yaml");

  // Outside the canonical prefix, and near-misses that only look like it.
  for (const path of [
    "c/d.yaml",
    "oats-config.yaml",
    "capabilities/a/oats-config.yaml",   // a file a capability root already owns
    "config-templates",                 // the root itself, no file
    "config-templates/",                // empty remainder
    "config-templatesx/d.yaml",         // prefix look-alike
    "./config-templates/d.yaml",
    "config-templates/./d.yaml",
    "config-templates/../d.yaml",
  ]) {
    const d = join(t, `bad-${path.replace(/\W+/g, "_")}`);
    pkgSource(d, { package: "x.bad" }, { "capabilities/a": { capability: "x.badcap" } });
    write(join(d, "config-templates/default/oats-config.yaml"), "name: x\n");
    const m = JSON.parse(readFileSync(join(d, "oats-package.json"), "utf8"));
    m.configTemplates = { default: { path } };
    write(join(d, "oats-package.json"), JSON.stringify(m, null, 2));
    throwsCode(() => loadPackageManifestAt(d), "invalid-package-manifest", `non-canonical template path ${JSON.stringify(path)}`);
  }

  // The DEPRECATED spelling keeps read compatibility: published 0.19 tags are
  // immutable and cannot be re-cut to satisfy a rule added after they shipped.
  const legacy = mk("legacypkg", { default: { path: "configs/default/oats-config.yaml", default: true } }, "configs");
  const lm = loadPackageManifestAt(legacy);
  assert.equal(lm._configTemplates.default.path, "configs/default/oats-config.yaml");
  assert.equal(lm._legacySpelling, true);
});

test("schema and runtime agree on the canonical template path — no drift between the two rules", () => {
  const schema = JSON.parse(readFileSync(resolve(new URL("../docs/oats-package.schema.json", import.meta.url).pathname), "utf8"));
  const pattern = new RegExp(schema.properties.configTemplates.additionalProperties.properties.path.pattern);
  // Both rules are hand-written in different languages; the only thing keeping
  // them honest is checking them against the same inputs.
  const cases = [
    ["config-templates/default/oats-config.yaml", true],
    ["config-templates/a.yaml", true],
    ["config-templates/nested/deep/a.yaml", true],
    ["c/d.yaml", false],
    ["oats-config.yaml", false],
    ["config-templates", false],
    ["config-templates/", false],
    ["config-templatesx/d.yaml", false],
    ["./config-templates/d.yaml", false],
    ["config-templates/../d.yaml", false],
    ["config-templates/./d.yaml", false],
    ["config-templates/a\\b.yaml", false],
    ["/config-templates/d.yaml", false],
  ];
  for (const [path, want] of cases) {
    assert.equal(isCanonicalTemplatePath(path), want, `runtime disagrees on ${JSON.stringify(path)}`);
    assert.equal(pattern.test(path), want, `schema disagrees on ${JSON.stringify(path)}`);
  }
});

// A package-closure dependency test needs a real npm on PATH.
function hasNpm() { return spawnSync("npm", ["--version"], { encoding: "utf8" }).status === 0; }
test("materializeCapabilityDeps: npm ci --ignore-scripts only; lifecycle scripts never run", { skip: !hasNpm() }, () => {
  const t = temp();
  const capDir = join(t, "cap");
  write(join(capDir, "oats.json"), JSON.stringify({ capability: "x.a", version: "1.0.0", description: "d" }));
  write(join(capDir, "package.json"), JSON.stringify({ name: "x", version: "1.0.0", private: true, scripts: { preinstall: `node -e "require('fs').writeFileSync('${join(t, "SCRIPT-RAN")}','x')"` }, dependencies: {} }));
  write(join(capDir, "package-lock.json"), JSON.stringify({ name: "x", version: "1.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: "x", version: "1.0.0" } } }));
  const r = materializeCapabilityDeps(capDir);
  assert.equal(r.error, undefined);
  assert.equal(existsSync(join(t, "SCRIPT-RAN")), false, "no npm lifecycle script ever runs");
  // A root with no lockfile is a successful no-op, not a failure.
  assert.equal(materializeCapabilityDeps(join(t, "nolock")).empty, true);
});

test("platformVariantLockPackages: os/cpu/libc, optional variance and install scripts are rejected; dev/peer are out of scope", () => {
  const t = temp();
  const lock = (packages) => { const f = join(t, `l${Math.random().toString(36).slice(2)}.json`); write(f, JSON.stringify({ lockfileVersion: 3, packages })); return f; };
  assert.deepEqual(platformVariantLockPackages(lock({ "": {}, "node_modules/a": {} })), []);
  assert.match(platformVariantLockPackages(lock({ "node_modules/a": { os: ["darwin"] } }))[0], /os\/cpu\/libc/);
  assert.match(platformVariantLockPackages(lock({ "node_modules/a": { cpu: ["arm64"] } }))[0], /os\/cpu\/libc/);
  assert.match(platformVariantLockPackages(lock({ "node_modules/a": { libc: ["glibc"] } }))[0], /os\/cpu\/libc/);
  assert.match(platformVariantLockPackages(lock({ "node_modules/a": { optional: true } }))[0], /optional/);
  assert.match(platformVariantLockPackages(lock({ "node_modules/a": { hasInstallScript: true } }))[0], /install script/);
  // Truly dev-only / peer-only entries are never materialized, so they cannot fail a valid closure.
  assert.deepEqual(platformVariantLockPackages(lock({ "node_modules/a": { dev: true, os: ["darwin"] }, "node_modules/b": { peer: true, hasInstallScript: true } })), []);
  // npm lockfileVersion 1 has no packages map: fail closed rather than under-scan.
  const v1 = join(t, "v1.json"); write(v1, JSON.stringify({ lockfileVersion: 1, dependencies: {} }));
  assert.match(platformVariantLockPackages(v1)[0], /unsupported npm lockfileVersion/);
});

test("copyTreeSafe: verbatim symlinks, deterministic order, modes after children, fail-closed on special files", () => {
  const t = temp();
  const src = join(t, "src");
  write(join(src, "b.txt"), "b\n");
  write(join(src, "a/inner.txt"), "inner\n");
  symlinkSync("./b.txt", join(src, "link"));
  chmodSync(join(src, "a"), 0o500); // read-only directory: children must still copy
  const dest = join(t, "dest");
  copyTreeSafe(src, dest);
  assert.equal(readFileSync(join(dest, "a/inner.txt"), "utf8"), "inner\n");
  assert.equal(lstatSync(join(dest, "link")).isSymbolicLink(), true);
  assert.equal(execFileSync("readlink", [join(dest, "link")], { encoding: "utf8" }).trim(), "./b.txt", "link target is verbatim, never rewritten");
  assert.equal(lstatSync(join(dest, "a")).mode & 0o777, 0o500, "directory mode is applied after its children");
  chmodSync(join(dest, "a"), 0o700);
  // A FIFO is not distributable content.
  const fifoDir = join(t, "fifo");
  mkdirSync(fifoDir, { recursive: true });
  const mk = spawnSync("mkfifo", [join(fifoDir, "pipe")]);
  if (mk.status === 0) throwsCode(() => copyTreeSafe(fifoDir, join(t, "fifo-dest")), "invalid-source", "FIFO");
});

// A regression here ABORTS the process (native cpSync recursion on an unreadable
// directory raises an uncaught libc++ filesystem_error), so it runs in a child:
// a failure must not take the whole test runner down with it.