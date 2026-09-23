/**
 * lib/packages.mjs — lock v3, resolvePackages, executablesDigest, approve, packageProviding.
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
  approve, classifyPackageValue, executablesDigest, manifestExecutables, packageProviding, parsePackageRequest,
  readLock, readPackageManifests, readPackageTree, resolvePackages, writeLock, canonicalLock, validateLock,
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

test("first resolve creates v3 entries: approved null, approvalNeeded true, exact commit + integrity + capabilities", async () => {
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
  assert.equal(okf.approved, null);

  const fw = lock.packages["oats.framework"];
  assert.equal(fw.commit, f.commits.fw113, "a prefixed catalog tag (oats-framework/v1.1.3) is recomposed from the version");
  assert.deepEqual(fw.capabilities, ["oats.core", "oats.setup"]);

  const nw = lock.packages["nw.tools"];
  assert.equal(nw.source, "git:github.com/northwind/tooling@v0.3.0");
  assert.equal(nw.version, "0.3.0");
  assert.equal(nw.commit, f.commits.nwMain);

  assert.deepEqual(changes.map((c) => [c.id, c.from, c.to, c.approvalNeeded]), [
    ["nw.tools", null, "0.3.0", true], ["oats.framework", null, "1.1.3", true], ["oats.okf", null, "2.1.3", true],
  ]);
  for (const c of changes) assert.match(c.commit, /^[0-9a-f]{40}$/);
  for (const e of Object.values(lock.packages)) assert.deepEqual(Object.keys(e).sort(), ["approved", "capabilities", "commit", "integrity", "path", "source", "url", "version"]);
  // Phase B (e2e MED): the lock records the repo url it read each package from, so resolve/materialize
  // of a catalog-locked package need no catalog at spawn time.
  assert.equal(okf.url, f.repos.okf.url);
  assert.equal(nw.url, f.repos.nw.url);
  const second = await resolvePackages(ws, { catalog: f.catalog, lock, remote: f.remote });
  assert.equal(second.lock.packages["oats.okf"].url, f.repos.okf.url, "url survives an unchanged re-sync");
  assert.equal(JSON.parse(JSON.stringify(canonicalLock(lock))).packages["oats.okf"].url, f.repos.okf.url, "canonical form keeps url");
  assert.throws(() => validateLock({ lockfileVersion: 3, packages: { x: { ...okf, url: 7 } } }), (e) => e.code === "E_LOCK_SCHEMA" && e.details.path === "/packages/x/url");
});

test("second resolve with unchanged versions is a no-op and keeps approvals; input lock not mutated", async () => {
  const f = fixture();
  const ws = workspace({ "oats.okf": "v2.1.3", "nw.tools": "git:github.com/northwind/tooling@v0.3.0" });
  const first = await resolvePackages(ws, { catalog: f.catalog, remote: f.remote });
  const digest = executablesDigest(await readPackageTree(f.remote, f.repos.okf.url, f.commits.okf213, "oats-package"));
  const approved = approve(first.lock, "oats.okf", digest, "2026-09-23T09:02:11Z");
  const snapshot = JSON.stringify(approved);

  const second = await resolvePackages(ws, { catalog: f.catalog, lock: approved, remote: f.remote });
  assert.deepEqual(second.changes, []);
  assert.deepEqual(second.lock, approved);
  assert.notEqual(second.lock, approved, "a new object is returned");
  assert.equal(JSON.stringify(approved), snapshot, "the input lock is untouched");
  assert.equal(second.lock.packages["oats.okf"].approved.executables, digest);
});

test("a version bump changes the commit and needs approval again", async () => {
  const f = fixture();
  const first = await resolvePackages(workspace({ "oats.okf": "v2.1.3" }), { catalog: f.catalog, remote: f.remote });
  const approved = approve(first.lock, "oats.okf", `sha256-${"b".repeat(64)}`, "2026-09-23T09:02:11Z");

  const bumped = await resolvePackages(workspace({ "oats.okf": "v2.2.0" }), { catalog: f.catalog, lock: approved, remote: f.remote });
  assert.deepEqual(bumped.changes, [{ id: "oats.okf", from: "2.1.3", to: "2.2.0", commit: f.commits.okf220, approvalNeeded: true }]);
  const e = bumped.lock.packages["oats.okf"];
  assert.equal(e.version, "2.2.0");
  assert.equal(e.commit, f.commits.okf220);
  assert.notEqual(e.commit, first.lock.packages["oats.okf"].commit);
  assert.notEqual(e.integrity, first.lock.packages["oats.okf"].integrity);
  assert.equal(e.approved, null);
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
  assert.deepEqual(next.changes, [{ id: "oats.framework", from: "1.1.3", to: null, commit: null, approvalNeeded: false }]);
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

// ---------- approve / packageProviding ----------

test("approve records digest + at (normalized to ISO UTC) and returns a NEW lock", async () => {
  const f = fixture();
  const { lock } = await resolvePackages(workspace({ "oats.okf": "v2.1.3" }), { catalog: f.catalog, remote: f.remote });
  const digest = `sha256-${"c".repeat(64)}`;
  const next = approve(lock, "oats.okf", digest, "2026-09-23T09:02:11Z");
  assert.notEqual(next, lock);
  assert.notEqual(next.packages, lock.packages);
  assert.equal(lock.packages["oats.okf"].approved, null, "original untouched");
  assert.deepEqual(next.packages["oats.okf"].approved, { executables: digest, at: "2026-09-23T09:02:11.000Z" });

  const auto = approve(lock, "oats.okf", digest);
  assert.match(auto.packages["oats.okf"].approved.at, /^\d{4}-\d{2}-\d{2}T.*Z$/);

  assert.throws(() => approve(lock, "ghost", digest), (e) => e.code === "E_PACKAGE_MISSING" && e.details.id === "ghost");
  assert.throws(() => approve(lock, "oats.okf", "md5-nope"), (e) => e.code === "E_PACKAGE_INTEGRITY");
  assert.throws(() => approve(lock, "oats.okf", digest, "yesterday"), (e) => e.code === "E_LOCK_SCHEMA");
});

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
    const approved = approve(lock, "oats.okf", `sha256-${"d".repeat(64)}`, "2026-09-23T09:02:11Z");
    const file = writeLock(dir, approved);
    assert.equal(file, join(dir, LOCK_FILE));
    const text = readFileSync(file, "utf8");
    assert.ok(text.endsWith("\n"));
    assert.ok(text.indexOf('"oats.framework"') < text.indexOf('"oats.okf"'), "package ids sorted");
    assert.deepEqual(readLock(dir), approved);

    writeFileSync(join(dir, LOCK_FILE), JSON.stringify({ lockfileVersion: 3, packages: { x: { source: "catalog:x", path: "p", version: "1", commit: "short", integrity: `sha256-${"0".repeat(64)}`, capabilities: [], approved: null } } }));
    assert.throws(() => readLock(dir), (e) => e.code === "E_LOCK_SCHEMA" && e.details.path === "/packages/x/commit");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------- executablesDigest ----------

test("executablesDigest: deterministic over command targets, order-independent, sensitive to bytes, ignores non-command files", () => {
  const tree = (toolA, toolB, extra = "x") => ({
    manifests: [
      { name: "b.cap", manifest: { commands: { run: "bin/b.mjs run --flag", check: "bin/b.mjs check" } }, files: new Map([["bin/b.mjs", Buffer.from(toolB)], ["skills/s/SKILL.md", Buffer.from(extra)]]) },
      { name: "a.cap", manifest: { commands: { cut: "bin/a.mjs cut" } }, files: new Map([["bin/a.mjs", Buffer.from(toolA)]]) },
    ],
  });
  const d1 = executablesDigest(tree("A", "B"));
  assert.match(d1, /^sha256-[0-9a-f]{64}$/);
  assert.equal(executablesDigest(tree("A", "B", "other skill text")), d1, "non-command files do not affect the digest");
  const reordered = { manifests: [...tree("A", "B").manifests].reverse() };
  assert.equal(executablesDigest(reordered), d1, "manifest order does not matter");
  assert.notEqual(executablesDigest(tree("A2", "B")), d1);
  assert.notEqual(executablesDigest(tree("A", "B2")), d1);
  assert.equal(executablesDigest({ manifests: [{ name: "n", manifest: {}, files: new Map() }] }), executablesDigest({ manifests: [] }), "no commands → digest of nothing");

  assert.throws(() => executablesDigest({ manifests: [{ name: "c", manifest: { commands: { go: "bin/missing.mjs" } }, files: new Map() }] }),
    (e) => e.code === "E_PACKAGE_MANIFEST" && e.details.capability === "c" && e.details.command === "go" && e.details.target === "bin/missing.mjs");
  assert.throws(() => executablesDigest({ manifests: [{ name: "c", manifest: { commands: { go: "../escape.mjs" } }, files: new Map() }] }), (e) => e.code === "E_PACKAGE_MANIFEST");
  assert.throws(() => executablesDigest(null), (e) => e.code === "E_PACKAGE_MANIFEST");
});

test("readPackageTree builds a packageTree from the remote; digest changes with the executable across versions", async () => {
  const f = fixture();
  const t213 = await readPackageTree(f.remote, f.repos.okf.url, f.commits.okf213, "oats-package");
  assert.deepEqual(t213.manifests.map((m) => m.name), ["oats.okf"]);
  assert.ok(t213.manifests[0].files.has("bin/tool.mjs"));
  assert.ok(t213.manifests[0].files.has("skills/s/SKILL.md"));
  const t220 = await readPackageTree(f.remote, f.repos.okf.url, f.commits.okf220, "oats-package");
  assert.notEqual(executablesDigest(t213), executablesDigest(t220));
  const fw = await readPackageTree(f.remote, f.repos.fw.url, f.commits.fw113, "oats-package");
  assert.deepEqual(fw.manifests.map((m) => m.name), ["oats.core", "oats.setup"]);
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

test("HIGH: executablesDigest is locale-independent (codepoint order) and pinned to a known constant", () => {
  const tree = { manifests: [
    { name: "\u00e4", manifest: { commands: { run: "bin/x.mjs" } }, files: new Map([["bin/x.mjs", Buffer.from("A")]]) },
    { name: "z", manifest: { commands: { run: "bin/x.mjs" } }, files: new Map([["bin/x.mjs", Buffer.from("A")]]) },
  ] };
  // "z" (U+007A) sorts BEFORE "ä" (U+00E4) by codepoint; ICU en/sv locales would disagree with each other.
  const expected = (() => {
    const h = createHash("sha256");
    for (const name of ["z", "\u00e4"]) { h.update(`${name}\x00run\x00bin/x.mjs\x001\x00`); h.update("A"); h.update("\x00"); }
    return `sha256-${h.digest("hex")}`;
  })();
  assert.equal(executablesDigest(tree), expected);
  assert.equal(executablesDigest({ manifests: [...tree.manifests].reverse() }), expected);
  assert.equal(executablesDigest({ manifests: [] }), `sha256-${"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}`);
});

test("MED: hooks.*.command targets enter the executables digest; commands and hooks of the same name do not collide", () => {
  const mk = (hookBody) => ({ manifests: [{ name: "c", manifest: { commands: { spawn: "bin/cmd.mjs" }, hooks: { spawn: { command: "bin/hook.mjs spawn", required: true }, retire: { command: "bin/hook.mjs retire" } } },
    files: new Map([["bin/cmd.mjs", Buffer.from("cmd")], ["bin/hook.mjs", Buffer.from(hookBody)]]) }] });
  assert.notEqual(executablesDigest(mk("benign")), executablesDigest(mk("rm -rf ~")), "a hook body change changes the digest");
  assert.deepEqual(manifestExecutables(mk("x").manifests[0].manifest).map((e) => [e.kind, e.name, e.target]),
    [["command", "spawn", "bin/cmd.mjs"], ["hook", "retire", "bin/hook.mjs"], ["hook", "spawn", "bin/hook.mjs"]]);
  assert.throws(() => executablesDigest({ manifests: [{ name: "c", manifest: { hooks: { spawn: { command: "bin/nope.mjs" } } }, files: new Map() }] }), (e) => e.code === "E_PACKAGE_MANIFEST" && e.details.kind === "hook");
  // Phase B (CLI M2): a hook object WITHOUT `command` is malformed — E_PACKAGE_MANIFEST, never an invisible no-op.
  assert.equal(manifestExecutables({ hooks: { spawn: { script: "bin/hidden.mjs", required: true } } }).length, 1, "the malformed hook is listed (spec undefined)");
  assert.throws(() => executablesDigest({ manifests: [{ name: "c", manifest: { hooks: { spawn: { script: "bin/hidden.mjs", required: true } } }, files: new Map([["bin/hidden.mjs", Buffer.from("x")]]) }] }),
    (e) => e.code === "E_PACKAGE_MANIFEST" && e.details.kind === "hook" && e.details.command === "spawn");
});

test("MED: a recorded approval that does not match the tree's executables → E_PACKAGE_UNAPPROVED on the fast path", async () => {
  const f = fixture();
  const ws = workspace({ "oats.okf": "v2.1.3" });
  const { lock } = await resolvePackages(ws, { catalog: f.catalog, remote: f.remote });
  const bogus = approve(lock, "oats.okf", `sha256-${"f".repeat(64)}`);
  await assert.rejects(resolvePackages(ws, { catalog: f.catalog, lock: bogus, remote: f.remote }), (e) => {
    assert.equal(e.code, "E_PACKAGE_UNAPPROVED"); assert.equal(e.details.id, "oats.okf");
    assert.match(e.details.executables, /^sha256-/); assert.equal(e.details.approved.executables, `sha256-${"f".repeat(64)}`);
    return true;
  });
});

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
  assert.equal(second.changes.length, 1); assert.equal(second.lock.packages["oats.okf"].approved, null);
});

test("MED: duplicate capability providers fail closed — intra-package E_PACKAGE_MANIFEST, cross-package E_PACKAGE_MISSING{ambiguous}", async () => {
  const f = fixture();
  const dup = new FakeRepo("github.com/x/dup");
  const c = dup.commit("1", pkgFiles("x.dup", "1.0.0", [{ dir: "a", name: "shared" }, { dir: "b", name: "shared" }]));
  dup.tag("v1.0.0", c);
  const remote = fakeRemote([dup]);
  await assert.rejects(readPackageManifests(remote, dup.url, c, "oats-package"), (e) => e.code === "E_PACKAGE_MANIFEST" && e.details.duplicate === "shared");
  const lock = { lockfileVersion: 3, packages: {
    aaa: { source: "catalog:aaa", path: "p", version: "1", commit: "a".repeat(40), integrity: `sha256-${"a".repeat(64)}`, capabilities: ["shared", "only-a"], approved: null },
    zzz: { source: "catalog:zzz", path: "p", version: "1", commit: "b".repeat(40), integrity: `sha256-${"b".repeat(64)}`, capabilities: ["shared"], approved: null },
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

test("LOW: manifest/tree hygiene — missing capability dir is E_PACKAGE_MANIFEST, deep blobs are read, prototype keys and backslash paths are refused", async () => {
  const f = fixture();
  const ghost = new FakeRepo("github.com/x/ghost");
  const c = ghost.commit("1", { "oats-package/oats-package.json": JSON.stringify({ package: "x.ghost", version: "1.0.0", capabilities: ["capabilities/ghost"] }) });
  ghost.tag("v1.0.0", c);
  const remote = fakeRemote([ghost]);
  await assert.rejects(readPackageManifests(remote, ghost.url, c, "oats-package"), (e) => e.code === "E_PACKAGE_MANIFEST" && /missing/.test(e.message) && e.details.cause === "E_REMOTE_PATH_MISSING");
  await assert.rejects(readPackageManifests(remote, ghost.url, c, "nope"), (e) => e.code === "E_PACKAGE_MANIFEST");

  const deep = new FakeRepo("github.com/x/deep");
  const deepPath = "a/b/c/d/e/f/g/h/i/tool.mjs";
  const dc = deep.commit("1", pkgFiles("x.deep", "1.0.0", [{ dir: "d", name: "x.deep", commands: { go: `${deepPath} go` } }]));
  deep.commits.get(dc).set(`oats-package/capabilities/d/${deepPath}`, Buffer.from("deep"));
  const t = await readPackageTree(fakeRemote([deep]), deep.url, dc, "oats-package");
  assert.ok(t.manifests[0].files.has(deepPath), "9-segment target is read");
  assert.match(executablesDigest(t), /^sha256-/);

  assert.throws(() => executablesDigest({ manifests: [{ name: "c", manifest: { commands: { go: "constructor" } }, files: {} }] }), (e) => e.code === "E_PACKAGE_MANIFEST" && /not in the package/.test(e.message));
  assert.throws(() => executablesDigest({ manifests: [{ name: "c", manifest: { commands: { go: 42 } }, files: {} }] }), (e) => e.code === "E_PACKAGE_MANIFEST" && /must be a string/.test(e.message));
  assert.throws(() => executablesDigest({ manifests: [{ name: "c", manifest: { commands: { go: "..\\x.mjs" } }, files: { "..\\x.mjs": "x" } }] }), (e) => e.code === "E_PACKAGE_MANIFEST" && /relative path/.test(e.message));
});
