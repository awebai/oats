/**
 * lib/packages.mjs — lock v3, resolvePackages, packageProviding. No approval step (human decision
 * 2026-09-24): declaring a package in `packages:` is the trust decision.
 * Runs without git: the remote is an in-memory fake implementing the lib/remote.mjs surface.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import * as packages from "../lib/packages.mjs";
import {
  classifyPackageValue, packageProviding, parsePackageRequest,
  readLock, readPackageManifests, resolvePackages, writeLock, canonicalLock, validateLock,
  LOCK_FILE, DEFAULT_PACKAGE_PATH,
} from "../lib/packages.mjs";

// ---------- in-memory fake remote ----------

const sha = (s) => createHash("sha256").update(s).digest("hex");
const oid = (s) => sha(s).slice(0, 40);

/** A fake repo: named commits, each a flat { relpath: string|Buffer } tree; refs map tag/branch → commit. */
class FakeRepo {
  constructor(key) { this.key = key; this.url = `https://${key}.git`; this.commits = new Map(); this.refs = new Map(); this.head = null; this.branches = new Map(); }
  commit(label, files) {
    const c = oid(`${this.key}:${label}`);
    this.commits.set(c, new Map(Object.entries(files).map(([k, v]) => [k, Buffer.isBuffer(v) ? v : Buffer.from(v)])));
    return c;
  }
  tag(name, commit) { this.refs.set(name, commit); return this; }
  branch(name, commit) { this.branches.set(name, commit); if (name === "main") this.head = commit; return this; }
}

function fakeRemote(repos) {
  const find = (ref) => {
    const text = String(ref).replace(/^git:/, "").replace(/^https:\/\//, "").replace(/\.git$/, "");
    const repo = repos.find((r) => r.key === text);
    if (!repo) { const e = new Error(`not found: ${ref}`); e.code = "E_REMOTE_UNREADABLE"; e.details = { url: ref, reason: "not-found" }; throw e; }
    return repo;
  };
  const tree = (ref, commit) => {
    const t = find(ref).commits.get(commit);
    if (!t) { const e = new Error(`no commit ${commit}`); e.code = "E_REMOTE_UNREADABLE"; throw e; }
    return t;
  };
  const norm = (p) => p.replace(/^\.\/?/, "").replace(/\/+$/, "");
  const remote = {
    calls: [],
    async observeRemote(ref, { at } = {}) {
      remote.calls.push(["observeRemote", ref, at]);
      const repo = find(ref);
      let commit, refName = null;
      if (at === undefined) { commit = repo.head; refName = "refs/heads/main"; }
      else if (repo.commits.has(at)) commit = at;
      else if (repo.refs.has(at)) { commit = repo.refs.get(at); refName = `refs/tags/${at}`; }
      else if (repo.branches.has(at)) { commit = repo.branches.get(at); refName = `refs/heads/${at}`; }
      if (!commit) { const e = new Error(`unknown ref ${at} in ${repo.key}`); e.code = "E_REMOTE_UNREADABLE"; e.details = { url: repo.url, reason: "not-found" }; throw e; }
      return { key: repo.key, url: repo.url, commit, ref: refName, observedAt: "2026-09-23T00:00:00.000Z" };
    },
    async readRemoteFile(ref, commit, path) {
      const bytes = tree(ref, commit).get(norm(path));
      if (!bytes) { const e = new Error(`missing ${path}`); e.code = "E_REMOTE_PATH_MISSING"; e.details = { path }; throw e; }
      return { bytes, size: bytes.length };
    },
    async listRemoteTree(ref, commit, dir, { depth = 2 } = {}) {
      const prefix = norm(dir) ? norm(dir) + "/" : "";
      const out = [];
      for (const [p, bytes] of tree(ref, commit)) {
        if (!p.startsWith(prefix)) continue;
        const rel = p.slice(prefix.length);
        if (rel.split("/").length > depth) continue;
        out.push({ path: rel, type: "blob", size: bytes.length });
      }
      return out.sort((a, b) => a.path.localeCompare(b.path));
    },
    // Same surface as lib/remote.mjs: the digest is what fetchRemoteTree reports (no copy is made here).
    async fetchRemoteTree(ref, commit, dir, destDir) {
      remote.calls.push(["fetchRemoteTree", ref, commit, dir]);
      const prefix = norm(dir) ? norm(dir) + "/" : "";
      const items = [...tree(ref, commit)].filter(([p]) => p.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      if (norm(dir) && items.length === 0) { const e = new Error(`missing ${dir}`); e.code = "E_REMOTE_PATH_MISSING"; e.details = { path: dir }; throw e; }
      const h = createHash("sha256");
      for (const [p, bytes] of items) { h.update(`${p.slice(prefix.length)}\0${0o644}\0`); h.update(bytes); h.update("\0"); }
      return { files: items.length, bytes: items.reduce((n, [, b]) => n + b.length, 0), digest: `sha256-${h.digest("hex")}`, destDir };
    },
  };
  return remote;
}

const pkgFiles = (id, version, caps, { toolBody = "#!/usr/bin/env node\nconsole.log('ok')\n", path = DEFAULT_PACKAGE_PATH } = {}) => {
  const files = {
    [`${path}/oats-package.json`]: JSON.stringify({ package: id, version, capabilities: caps.map((c) => `capabilities/${c.dir}`) }),
  };
  for (const c of caps) {
    files[`${path}/capabilities/${c.dir}/oats.json`] = JSON.stringify({ capability: c.name, version, ...(c.commands ? { commands: c.commands } : {}) });
    files[`${path}/capabilities/${c.dir}/skills/s/SKILL.md`] = `# ${c.name}\n`;
    if (c.commands) files[`${path}/capabilities/${c.dir}/bin/tool.mjs`] = toolBody;
  }
  return files;
};

/** Northwind-like fixture: catalog package oats.okf (v2.1.3 → v2.2.0), framework with a prefixed tag, a git-ref package. */
function fixture() {
  const okf = new FakeRepo("github.com/awebai/oats-okf");
  const okf213 = okf.commit("2.1.3", pkgFiles("oats.okf", "2.1.3", [{ dir: "oats-okf", name: "oats.okf", commands: { harvest: "bin/tool.mjs harvest", inspect: "bin/tool.mjs inspect" } }]));
  const okf220 = okf.commit("2.2.0", pkgFiles("oats.okf", "2.2.0", [{ dir: "oats-okf", name: "oats.okf", commands: { harvest: "bin/tool.mjs harvest" } }], { toolBody: "// v2.2.0\n" }));
  okf.tag("v2.1.3", okf213).tag("v2.2.0", okf220);

  const fw = new FakeRepo("github.com/awebai/oats");
  const fw113 = fw.commit("1.1.3", pkgFiles("oats.framework", "1.1.3", [{ dir: "oats-core", name: "oats.core" }, { dir: "oats-setup", name: "oats.setup" }]));
  fw.tag("oats-framework/v1.1.3", fw113);

  const nw = new FakeRepo("github.com/northwind/tooling");
  const nwMain = nw.commit("main", pkgFiles("nw.tools", "0.3.0", [{ dir: "nw-release", name: "nw-release-tooling", commands: { cut: "bin/tool.mjs cut" } }]));
  nw.tag("v0.3.0", nwMain); nw.branch("main", nwMain);

  const catalog = {
    policy: "docs/official-marketplace.md",
    packages: {
      "oats.okf": { url: okf.url, ref: "v2.1.3", path: "oats-package" },
      "oats.framework": { url: fw.url, ref: "oats-framework/v1.1.3", path: "oats-package" },
    },
  };
  return { repos: { okf, fw, nw }, commits: { okf213, okf220, fw113, nwMain }, catalog, remote: fakeRemote([okf, fw, nw]) };
}

const workspace = (pkgs) => ({ schemaVersion: 2, name: "northwind", packages: pkgs });

// ---------- resolvePackages ----------

test("first resolve creates v3 entries: exact commit + integrity + capabilities, no approval record", async () => {
  const f = fixture();
  const ws = workspace({ "oats.okf": "v2.1.3", "oats.framework": "v1.1.3", "nw.tools": "git:github.com/northwind/tooling@v0.3.0" });
  const { lock, changes } = await resolvePackages(ws, { catalog: f.catalog, remote: f.remote });

  assert.equal(lock.lockfileVersion, 3);
  assert.deepEqual(Object.keys(lock.packages), ["nw.tools", "oats.framework", "oats.okf"]);

  const okf = lock.packages["oats.okf"];
  assert.equal(okf.source, "catalog:oats.okf");
  assert.equal(okf.path, "oats-package");
  assert.equal(okf.version, "2.1.3");
  assert.equal(okf.commit, f.commits.okf213);
  assert.match(okf.commit, /^[0-9a-f]{40}$/);
  assert.match(okf.integrity, /^sha256-[0-9a-f]{64}$/);
  assert.equal(okf.integrity, (await f.remote.fetchRemoteTree(f.repos.okf.url, f.commits.okf213, "oats-package", "/dev/null")).digest, "integrity is the digest fetchRemoteTree reports for the package tree");
  assert.deepEqual(okf.capabilities, ["oats.okf"]);
  assert.ok(!("approved" in okf), "lock v3 entries carry no approval record");

  const fw = lock.packages["oats.framework"];
  assert.equal(fw.commit, f.commits.fw113, "a prefixed catalog tag (oats-framework/v1.1.3) is recomposed from the version");
  assert.deepEqual(fw.capabilities, ["oats.core", "oats.setup"]);

  const nw = lock.packages["nw.tools"];
  assert.equal(nw.source, "git:github.com/northwind/tooling@v0.3.0");
  assert.equal(nw.version, "0.3.0");
  assert.equal(nw.commit, f.commits.nwMain);

  assert.deepEqual(changes.map((c) => [c.id, c.from, c.to]), [
    ["nw.tools", null, "0.3.0"], ["oats.framework", null, "1.1.3"], ["oats.okf", null, "2.1.3"],
  ]);
  for (const c of changes) { assert.match(c.commit, /^[0-9a-f]{40}$/); assert.deepEqual(Object.keys(c).sort(), ["commit", "from", "id", "to"]); }
  for (const e of Object.values(lock.packages)) assert.deepEqual(Object.keys(e).sort(), ["capabilities", "commit", "integrity", "path", "source", "url", "version"]);
  // Phase B (e2e MED): the lock records the repo url it read each package from, so resolve/materialize
  // of a catalog-locked package need no catalog at spawn time.
  assert.equal(okf.url, f.repos.okf.url);
  assert.equal(nw.url, f.repos.nw.url);
  const second = await resolvePackages(ws, { catalog: f.catalog, lock, remote: f.remote });
  assert.equal(second.lock.packages["oats.okf"].url, f.repos.okf.url, "url survives an unchanged re-sync");
  assert.equal(JSON.parse(JSON.stringify(canonicalLock(lock))).packages["oats.okf"].url, f.repos.okf.url, "canonical form keeps url");
  assert.throws(() => validateLock({ lockfileVersion: 3, packages: { x: { ...okf, url: 7 } } }), (e) => e.code === "E_LOCK_SCHEMA" && e.details.path === "/packages/x/url");
});

test("second resolve with unchanged versions is a no-op; input lock not mutated", async () => {
  const f = fixture();
  const ws = workspace({ "oats.okf": "v2.1.3", "nw.tools": "git:github.com/northwind/tooling@v0.3.0" });
  const first = await resolvePackages(ws, { catalog: f.catalog, remote: f.remote });
  const snapshot = JSON.stringify(first.lock);

  const second = await resolvePackages(ws, { catalog: f.catalog, lock: first.lock, remote: f.remote });
  assert.deepEqual(second.changes, []);
  assert.deepEqual(second.lock, first.lock);
  assert.notEqual(second.lock, first.lock, "a new object is returned");
  assert.equal(JSON.stringify(first.lock), snapshot, "the input lock is untouched");
});

test("a version bump changes the commit and the integrity", async () => {
  const f = fixture();
  const first = await resolvePackages(workspace({ "oats.okf": "v2.1.3" }), { catalog: f.catalog, remote: f.remote });

  const bumped = await resolvePackages(workspace({ "oats.okf": "v2.2.0" }), { catalog: f.catalog, lock: first.lock, remote: f.remote });
  assert.deepEqual(bumped.changes, [{ id: "oats.okf", from: "2.1.3", to: "2.2.0", commit: f.commits.okf220 }]);
  const e = bumped.lock.packages["oats.okf"];
  assert.equal(e.version, "2.2.0");
  assert.equal(e.commit, f.commits.okf220);
  assert.notEqual(e.commit, first.lock.packages["oats.okf"].commit);
  assert.notEqual(e.integrity, first.lock.packages["oats.okf"].integrity);
});

test("a moved tag (same version string, different commit) → E_PACKAGE_INTEGRITY with details", async () => {
  const f = fixture();
  const ws = workspace({ "oats.okf": "v2.1.3" });
  const { lock } = await resolvePackages(ws, { catalog: f.catalog, remote: f.remote });
  // Someone force-moves v2.1.3 onto the 2.2.0 commit.
  f.repos.okf.tag("v2.1.3", f.commits.okf220);

  await assert.rejects(resolvePackages(ws, { catalog: f.catalog, lock, remote: f.remote }), (e) => {
    assert.equal(e.code, "E_PACKAGE_INTEGRITY");
    assert.equal(e.details.id, "oats.okf");
    assert.equal(e.details.version, "2.1.3");
    assert.equal(e.details.locked.commit, f.commits.okf213);
    assert.equal(e.details.observed.commit, f.commits.okf220);
    assert.deepEqual(e.provenance, e.details, "details are attached under both names");
    assert.match(e.message, /moved/);
    return true;
  });
});

test("same commit but changed content digest → E_PACKAGE_INTEGRITY", async () => {
  const f = fixture();
  const ws = workspace({ "oats.okf": "v2.1.3" });
  const { lock } = await resolvePackages(ws, { catalog: f.catalog, remote: f.remote });
  const tampered = { ...lock, packages: { "oats.okf": { ...lock.packages["oats.okf"], integrity: `sha256-${"0".repeat(64)}` } } };
  await assert.rejects(resolvePackages(ws, { catalog: f.catalog, lock: tampered, remote: f.remote }), (e) => e.code === "E_PACKAGE_INTEGRITY" && /digest/.test(e.message));
});

test("a package removed from the workspace is dropped from the lock and reported", async () => {
  const f = fixture();
  const { lock } = await resolvePackages(workspace({ "oats.okf": "v2.1.3", "oats.framework": "v1.1.3" }), { catalog: f.catalog, remote: f.remote });
  const next = await resolvePackages(workspace({ "oats.okf": "v2.1.3" }), { catalog: f.catalog, lock, remote: f.remote });
  assert.deepEqual(Object.keys(next.lock.packages), ["oats.okf"]);
  assert.deepEqual(next.changes, [{ id: "oats.framework", from: "1.1.3", to: null, commit: null }]);
});

test("catalog miss → E_PACKAGE_MISSING; malformed git value → E_REPO_REF; unknown tag → E_REMOTE_UNREADABLE", async () => {
  const f = fixture();
  await assert.rejects(resolvePackages(workspace({ "oats.nope": "v1.0.0" }), { catalog: f.catalog, remote: f.remote }), (e) => e.code === "E_PACKAGE_MISSING" && e.details.id === "oats.nope");
  await assert.rejects(resolvePackages(workspace({ "x": "git:github.com/a/b" }), { catalog: f.catalog, remote: f.remote }), (e) => e.code === "E_REPO_REF");
  await assert.rejects(resolvePackages(workspace({ "oats.okf": "v9.9.9" }), { catalog: f.catalog, remote: f.remote }), (e) => e.code === "E_REMOTE_UNREADABLE");
  await assert.rejects(resolvePackages(workspace({ "oats.okf": "v2.1.3" }), { catalog: f.catalog, remote: {} }), (e) => e instanceof TypeError && /remote/.test(e.message));
  assert.equal(typeof packages.resolvePackages, "function");
});

test("catalog may be passed as the bare packages map", async () => {
  const f = fixture();
  const { lock } = await resolvePackages(workspace({ "oats.okf": "2.1.3" }), { catalog: f.catalog.packages, remote: f.remote });
  assert.equal(lock.packages["oats.okf"].commit, f.commits.okf213, "a version without the leading v still selects the v-tag");
});

// ---------- packageProviding ----------

test("packageProviding finds the package providing a capability, null otherwise", async () => {
  const f = fixture();
  const { lock } = await resolvePackages(workspace({ "oats.okf": "v2.1.3", "oats.framework": "v1.1.3" }), { catalog: f.catalog, remote: f.remote });
  const hit = packageProviding(lock, "oats.setup");
  assert.equal(hit.id, "oats.framework");
  assert.equal(hit.entry, lock.packages["oats.framework"]);
  assert.equal(packageProviding(lock, "oats.okf").id, "oats.okf");
  assert.equal(packageProviding(lock, "nw-release-tooling"), null);
  assert.equal(packageProviding({ lockfileVersion: 3, packages: {} }, "x"), null);
  assert.equal(packageProviding(null, "x"), null);
});

// ---------- readLock / writeLock ----------

test("readLock: missing file → empty v3; lockfileVersion 2 → E_LOCK_SCHEMA naming the version; write/read round-trips canonically", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oats-lock-"));
  try {
    assert.deepEqual(readLock(dir), { lockfileVersion: 3, packages: {} });

    writeFileSync(join(dir, LOCK_FILE), JSON.stringify({ lockfileVersion: 2, packages: {} }));
    assert.throws(() => readLock(dir), (e) => {
      assert.equal(e.code, "E_LOCK_SCHEMA");
      assert.match(e.message, /lockfileVersion 2 is not supported/);
      assert.match(e.message, /lockfileVersion 3/);
      assert.equal(e.details.found, 2);
      assert.equal(e.details.expected, 3);
      assert.equal(e.details.path, "/lockfileVersion");
      return true;
    });

    writeFileSync(join(dir, LOCK_FILE), "{not json");
    assert.throws(() => readLock(dir), (e) => e.code === "E_LOCK_SCHEMA" && /valid JSON/.test(e.message));

    const f = fixture();
    const { lock } = await resolvePackages(workspace({ "oats.okf": "v2.1.3", "oats.framework": "v1.1.3" }), { catalog: f.catalog, remote: f.remote });
    const file = writeLock(dir, lock);
    assert.equal(file, join(dir, LOCK_FILE));
    const text = readFileSync(file, "utf8");
    assert.ok(text.endsWith("\n"));
    assert.ok(text.indexOf('"oats.framework"') < text.indexOf('"oats.okf"'), "package ids sorted");
    assert.deepEqual(readLock(dir), lock);

    writeFileSync(join(dir, LOCK_FILE), JSON.stringify({ lockfileVersion: 3, packages: { x: { source: "catalog:x", path: "p", version: "1", commit: "short", integrity: `sha256-${"0".repeat(64)}`, capabilities: [] } } }));
    assert.throws(() => readLock(dir), (e) => e.code === "E_LOCK_SCHEMA" && e.details.path === "/packages/x/commit");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------- deprecated shims ----------

test("phase-A shims: kernel-imported names still exist and throw E_REMOVED pointing at the contract", () => {
  const shims = [
    "aggregateMissingRequirements", "applyFromOasScope", "beginRunJournal", "discoverMigrationScopes", "discoverOasScopes", "discoverWorkspaceScopes", "planFromOasScope",
    "adoptedTemplateDir", "applyConfigMerge", "lockedPackageCapabilities", "planConfigMerge", "readAdoptedTemplate", "requirementInstallPlan",
    "runRequirementInstall", "selectConfigTemplate", "validateConfigTemplate", "writeAdoptedTemplate",
    "capabilityRuntimeTargets", "commandOnPath", "splitConfigLines", "normalizeRequirement", "packageSpecIdentity", "runtimePackageInstalled", "runtimePackageStatus",
    "oasRenameMap", "transformOasConfigText",
  ];
  for (const name of shims) {
    assert.equal(typeof packages[name], "function", name);
    assert.throws(() => packages[name](), (e) => e.code === "E_REMOVED" && e.message.includes(name) && /workspace-module-contracts/.test(e.message), name);
  }
  assert.throws(() => packages.REQUIREMENT_MANAGERS.npm, (e) => e.code === "E_REMOVED");
  // Generic file-safety helpers are NOT removed: bin/oats.mjs uses them outside package code.
  for (const kept of ["writeFileAtomic", "copyFileAtomic", "assertNoSymlinkedParents"]) assert.equal(typeof packages[kept], "function", kept);
  const dir = mkdtempSync(join(tmpdir(), "oats-atomic-"));
  try {
    packages.writeFileAtomic(join(dir, "a", "f.txt"), "hi");
    packages.copyFileAtomic(join(dir, "a", "f.txt"), join(dir, "g.txt"));
    assert.equal(readFileSync(join(dir, "g.txt"), "utf8"), "hi");
    packages.assertNoSymlinkedParents(dir, join(dir, "a", "new"), "probe");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------- adversarial review regressions ----------

test("MED: a branch is refused as a package version (E_PACKAGE_INTEGRITY why:branch); a full OID is accepted", async () => {
  const f = fixture();
  await assert.rejects(resolvePackages(workspace({ "nw.tools": "git:github.com/northwind/tooling@main" }), { remote: f.remote }),
    (e) => e.code === "E_PACKAGE_INTEGRITY" && e.details.why === "branch" && e.details.ref === "refs/heads/main");
  const pinned = await resolvePackages(workspace({ "nw.tools": `git:github.com/northwind/tooling@${f.commits.nwMain}` }), { remote: f.remote });
  assert.equal(pinned.lock.packages["nw.tools"].commit, f.commits.nwMain);
  assert.equal(pinned.lock.packages["nw.tools"].version, f.commits.nwMain);
  // through the catalog too
  const cat = { packages: { "oats.okf": { url: f.repos.okf.url, ref: "main", path: "oats-package" } } };
  f.repos.okf.branch("main", f.commits.okf213);
  await assert.rejects(resolvePackages(workspace({ "oats.okf": "main" }), { catalog: cat, remote: f.remote }), (e) => e.code === "E_WORKSPACE_SCHEMA", "\"main\" is not a version");
});

test("MED: a catalog path change at the same version is a new entry, not a silently kept old path", async () => {
  const f = fixture();
  const alt = pkgFiles("oats.okf", "2.1.3", [{ dir: "oats-okf", name: "oats.okf" }], { path: "pkg2" });
  const c = f.repos.okf.commit("2.1.3-moved", { ...alt, ...pkgFiles("oats.okf", "2.1.3", [{ dir: "oats-okf", name: "oats.okf", commands: { harvest: "bin/tool.mjs harvest" } }]) });
  f.repos.okf.tag("v2.1.3", c);
  const ws = workspace({ "oats.okf": "v2.1.3" });
  const first = await resolvePackages(ws, { catalog: f.catalog, remote: f.remote });
  assert.equal(first.lock.packages["oats.okf"].path, "oats-package");
  const moved = { packages: { "oats.okf": { url: f.repos.okf.url, ref: "v2.1.3", path: "pkg2" } } };
  const second = await resolvePackages(ws, { catalog: moved, lock: first.lock, remote: f.remote });
  assert.equal(second.lock.packages["oats.okf"].path, "pkg2");
  assert.equal(second.changes.length, 1);
});

test("MED: duplicate capability providers fail closed — intra-package E_PACKAGE_MANIFEST, cross-package E_PACKAGE_MISSING{ambiguous}", async () => {
  const f = fixture();
  const dup = new FakeRepo("github.com/x/dup");
  const c = dup.commit("1", pkgFiles("x.dup", "1.0.0", [{ dir: "a", name: "shared" }, { dir: "b", name: "shared" }]));
  dup.tag("v1.0.0", c);
  const remote = fakeRemote([dup]);
  await assert.rejects(readPackageManifests(remote, dup.url, c, "oats-package"), (e) => e.code === "E_PACKAGE_MANIFEST" && e.details.duplicate === "shared");
  const lock = { lockfileVersion: 3, packages: {
    aaa: { source: "catalog:aaa", path: "p", version: "1", commit: "a".repeat(40), integrity: `sha256-${"a".repeat(64)}`, capabilities: ["shared", "only-a"] },
    zzz: { source: "catalog:zzz", path: "p", version: "1", commit: "b".repeat(40), integrity: `sha256-${"b".repeat(64)}`, capabilities: ["shared"] },
  } };
  assert.throws(() => packageProviding(lock, "shared"), (e) => e.code === "E_PACKAGE_MISSING" && JSON.stringify(e.details.ambiguous) === JSON.stringify(["aaa", "zzz"]));
  assert.equal(packageProviding(lock, "only-a").id, "aaa");
});

test("HIGH: packages: values accept exactly two forms — a catalog version or git:<repo>@<ref> (incl. local/file/https repos) — and nothing else", () => {
  assert.deepEqual(classifyPackageValue("v2.1.3"), { kind: "catalog", version: "2.1.3" });
  assert.deepEqual(classifyPackageValue("2.1.3"), { kind: "catalog", version: "2.1.3" });
  assert.deepEqual(classifyPackageValue("git:github.com/a/b@v1"), { kind: "git", repo: "git:github.com/a/b", at: "v1" });
  assert.deepEqual(classifyPackageValue("git:/tmp/x/nw-tools.git@v0.4.0"), { kind: "git", repo: "/tmp/x/nw-tools.git", at: "v0.4.0" });
  assert.deepEqual(classifyPackageValue("git:file:///tmp/x.git@v0.4.0"), { kind: "git", repo: "file:///tmp/x.git", at: "v0.4.0" });
  assert.deepEqual(classifyPackageValue("git:https://github.com/a/b.git@v1"), { kind: "git", repo: "https://github.com/a/b.git", at: "v1" });
  assert.deepEqual(classifyPackageValue(`git:github.com/a/b@${"0".repeat(40)}`).at, "0".repeat(40));
  for (const bad of ["git:github.com/a/b", "git:@v1", "git:h/r@", "git:h/r@ v1 ", " v1", "git:h/r@v1/", "git:h/r@-x", "git:h/r@a..b", "git@github.com:a/b.git@v1", "https://github.com/a/b@v1", "main", "latest", "", 3, null]) {
    assert.ok(classifyPackageValue(bad).problem, `refused: ${JSON.stringify(bad)}`);
  }
  assert.throws(() => parsePackageRequest("x", "git:github.com/a/b", {}), (e) => e.code === "E_REPO_REF");
  assert.throws(() => parsePackageRequest("x", "main", {}), (e) => e.code === "E_WORKSPACE_SCHEMA" && e.details.path === "/packages/x");
  assert.throws(() => parsePackageRequest("x", "git@github.com:a/b.git@v1", {}), (e) => e.code === "E_WORKSPACE_SCHEMA");
  assert.deepEqual(parsePackageRequest("x", "git:/abs/bare.git@v0.4.0", {}), { kind: "git", remoteRef: "/abs/bare.git", at: "v0.4.0", path: "oats-package" });
});

test("LOW: manifest hygiene — a missing capability dir or package path is E_PACKAGE_MANIFEST", async () => {
  const ghost = new FakeRepo("github.com/x/ghost");
  const c = ghost.commit("1", { "oats-package/oats-package.json": JSON.stringify({ package: "x.ghost", version: "1.0.0", capabilities: ["capabilities/ghost"] }) });
  ghost.tag("v1.0.0", c);
  const remote = fakeRemote([ghost]);
  await assert.rejects(readPackageManifests(remote, ghost.url, c, "oats-package"), (e) => e.code === "E_PACKAGE_MANIFEST" && /missing/.test(e.message) && e.details.cause === "E_REMOTE_PATH_MISSING");
  await assert.rejects(readPackageManifests(remote, ghost.url, c, "nope"), (e) => e.code === "E_PACKAGE_MANIFEST");
});

test("a package capability manifest that breaks the kernel contract is E_PACKAGE_MANIFEST at read, naming the pointer", async () => {
  const bad = new FakeRepo("github.com/x/bad");
  const c = bad.commit("1", {
    "oats-package/oats-package.json": JSON.stringify({ package: "x.bad", version: "1.0.0", capabilities: ["capabilities/tool"] }),
    "oats-package/capabilities/tool/oats.json": JSON.stringify({ capability: "x.tool", version: "1.0.0", description: "d", hooks: { launch: { command: "bin/t.mjs launch", required: true } } }),
  });
  bad.tag("v1.0.0", c);
  await assert.rejects(readPackageManifests(fakeRemote([bad]), bad.url, c, "oats-package"),
    (e) => e.code === "E_PACKAGE_MANIFEST" && e.details.pointer === "/hooks/launch/required" && /hook "launch" cannot be required/.test(e.message));
});

// ---------- pre-0.26 locks (approval removed, human decision 2026-09-24) ----------

test("a pre-0.26 lock carrying approved { executables, at } or approved: null validates; writeLock/canonicalLock/resolvePackages drop the field", async () => {
  const f = fixture();
  const ws = workspace({ "oats.okf": "v2.1.3", "oats.framework": "v1.1.3" });
  const { lock } = await resolvePackages(ws, { catalog: f.catalog, remote: f.remote });
  const legacy = { lockfileVersion: 3, packages: {
    "oats.framework": { ...lock.packages["oats.framework"], approved: null },
    "oats.okf": { ...lock.packages["oats.okf"], approved: { executables: `sha256-${"d".repeat(64)}`, at: "2026-09-23T09:02:11.000Z" } },
  } };
  assert.equal(validateLock(legacy), legacy, "the legacy field is ignored, not refused");
  // even a malformed legacy approval is ignored — the field has no meaning any more
  assert.doesNotThrow(() => validateLock({ lockfileVersion: 3, packages: { "oats.okf": { ...lock.packages["oats.okf"], approved: "yes" } } }));

  const canon = canonicalLock(legacy);
  for (const e of Object.values(canon.packages)) assert.ok(!("approved" in e), "canonicalLock drops approved");
  assert.deepEqual(canon, canonicalLock(lock));

  const dir = mkdtempSync(join(tmpdir(), "oats-lock-legacy-"));
  try {
    writeFileSync(join(dir, LOCK_FILE), JSON.stringify(legacy));
    assert.deepEqual(readLock(dir), legacy, "readLock accepts the legacy file");
    writeLock(dir, readLock(dir));
    const text = readFileSync(join(dir, LOCK_FILE), "utf8");
    assert.ok(!text.includes("approved"), "writeLock output has no approved key");
    assert.deepEqual(readLock(dir), canonicalLock(lock));
  } finally { rmSync(dir, { recursive: true, force: true }); }

  const resynced = await resolvePackages(ws, { catalog: f.catalog, lock: legacy, remote: f.remote });
  assert.deepEqual(resynced.changes, [], "dropping the legacy field is not a change");
  for (const e of Object.values(resynced.lock.packages)) assert.ok(!("approved" in e), "resolvePackages drops approved on write");
  assert.ok("approved" in legacy.packages["oats.okf"], "the input lock is untouched");
});
