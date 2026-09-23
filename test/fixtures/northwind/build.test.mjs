// Tests for the Northwind fixture (module contracts §7).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import {
  buildNorthwind,
  moveMember,
  dropBacklink,
  makeUnreadable,
  REPO_NAMES,
  PACKAGE_TAGS,
  repoKey,
} from "./build.mjs";

const OID = /^[0-9a-f]{40}$/;
const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: "1" };
const git = (cwd, ...args) => execFileSync("git", args, { cwd, env: gitEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const show = (bare, spec) => git(bare, "show", spec);

let base;
let fixture;
const cleanups = [];

before(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "northwind-fixture-"));
  fixture = await buildNorthwind(base);
});

after(async () => {
  for (const c of cleanups.reverse()) await c();
  await fs.rm(base, { recursive: true, force: true });
});

test("builds nine bare repos with default branch main and full-OID commits", () => {
  assert.equal(REPO_NAMES.length, 9);
  assert.deepEqual(Object.keys(fixture.refs).sort(), [...REPO_NAMES].sort());
  assert.deepEqual(Object.keys(fixture.commits).sort(), [...REPO_NAMES].sort());
  for (const name of REPO_NAMES) {
    const bare = fixture.refs[name];
    assert.ok(path.isAbsolute(bare), `${name} ref is absolute`);
    assert.equal(bare, path.join(base, "remotes", `${name}.git`));
    assert.equal(git(bare, "rev-parse", "--is-bare-repository"), "true");
    assert.equal(git(bare, "symbolic-ref", "HEAD"), "refs/heads/main");
    assert.match(fixture.commits[name], OID, `${name} commit is a full OID`);
    assert.equal(git(bare, "rev-parse", "refs/heads/main"), fixture.commits[name]);
    assert.equal(fixture.keys[name], repoKey(bare));
    assert.ok(fixture.urls[name].startsWith("file:///"), `${name} url is a file:// URL`);
  }
  const lsRemote = git(base, "ls-remote", "--symref", fixture.refs.agents, "HEAD");
  assert.match(lsRemote, /^ref: refs\/heads\/main\tHEAD$/m);
});

test("workspace host carries the v2 workspace file with members, packages, teams, byTeam defaults, store, external", () => {
  const bare = fixture.refs.agents;
  const ws = YAML.parse(show(bare, "HEAD:oats-workspace.yaml"));
  assert.equal(ws.schemaVersion, 2);
  assert.equal(ws.name, "northwind");
  assert.deepEqual(ws.members, ["agents", "platform", "data", "marketing", "nw-tools"].map((n) => fixture.urls[n]));
  for (const m of ws.members) assert.doesNotMatch(m, /@/, "members carry no @revision");
  assert.deepEqual(ws.packages, { "oats.framework": "v1.1.3", "oats.okf": "v2.1.3", "nw.tools": `git:${fixture.urls["nw-tools"]}@v0.4.0` });
  assert.deepEqual(Object.keys(ws.teams), ["global", "engineering", "marketing"]);
  assert.deepEqual(ws.defaults.capabilities["oats.core"], { from: "package" });
  assert.deepEqual(ws.defaults.capabilities["nw-house-style"], { from: fixture.keys.agents });
  assert.deepEqual(ws.defaults.knowledge, { "oats.okf": { from: "package" } });
  assert.equal(ws.defaults.messaging, "none");
  assert.equal(ws.defaults.tasks, "none");
  assert.deepEqual(ws.defaults.byTeam.engineering.capabilities, { "nw-release-tooling": { from: fixture.keys.agents } });
  assert.deepEqual(ws.defaults.byTeam.marketing.capabilities, { "nw-brand-voice": { from: fixture.keys.marketing } });
  assert.deepEqual(ws.stores, { org: fixture.urls.knowledge });
  assert.deepEqual(ws.messaging, { private: "per-human", channels: ["northwind-eng", "northwind-mkt"] });
  assert.deepEqual(ws.external, [{ source: `${fixture.urls.experts}@${fixture.commits.experts}`, soul: "souls/security-reviewer" }]);

  const membership = YAML.parse(show(bare, "HEAD:oats-membership.yaml"));
  assert.deepEqual(membership, { schemaVersion: 2, workspace: fixture.urls.agents, team: "global" });
});

test("every member backlinks to the workspace with its team; the store has no membership file", () => {
  const teams = { platform: "engineering", data: "engineering", marketing: "marketing", "nw-tools": "engineering" };
  for (const [name, team] of Object.entries(teams)) {
    const m = YAML.parse(show(fixture.refs[name], "HEAD:oats-membership.yaml"));
    assert.deepEqual(m, { schemaVersion: 2, workspace: fixture.urls.agents, team });
  }
  const knowledgeTree = git(fixture.refs.knowledge, "ls-tree", "-r", "--name-only", "HEAD").split("\n");
  assert.deepEqual(knowledgeTree, ["README.md"]);
  const expertsTree = git(fixture.refs.experts, "ls-tree", "-r", "--name-only", "HEAD").split("\n");
  assert.ok(!expertsTree.includes("oats-membership.yaml"), "external repo has no backlink");
});

test("souls: every soul dir has soul.yaml v2, AGENTS.md, a relative CLAUDE.md symlink and a skill; platform-reviewer is private", () => {
  const souls = {
    agents: ["release-manager", "support-triager"],
    platform: ["platform-engineer", "platform-reviewer"],
    data: ["data-analyst"],
    marketing: ["campaign-writer", "positioning-analyst"],
    "nw-tools": ["tools-expert"],
    experts: ["security-reviewer"],
  };
  for (const [repo, names] of Object.entries(souls)) {
    const bare = fixture.refs[repo];
    for (const soul of names) {
      const def = YAML.parse(show(bare, `HEAD:souls/${soul}/soul.yaml`));
      assert.equal(def.schemaVersion, 2, `${soul} schemaVersion`);
      assert.equal(def.name, soul);
      assert.ok(["worktree", "checkout", "directory", "workspace"].includes(def.work), `${soul} work mode`);
      assert.ok(show(bare, `HEAD:souls/${soul}/AGENTS.md`).length > 0);
      const claude = git(bare, "ls-tree", "HEAD", `souls/${soul}/CLAUDE.md`);
      assert.match(claude, /^120000 blob /, `${soul} CLAUDE.md is a symlink`);
      assert.equal(show(bare, `HEAD:souls/${soul}/CLAUDE.md`), "AGENTS.md", `${soul} CLAUDE.md → AGENTS.md (relative)`);
      const skills = git(bare, "ls-tree", "-r", "--name-only", "HEAD", `souls/${soul}/skills`).split("\n").filter(Boolean);
      assert.ok(skills.some((p) => /^souls\/[^/]+\/skills\/[^/]+\/SKILL\.md$/.test(p)), `${soul} has a skill`);
    }
  }
  const reviewer = YAML.parse(show(fixture.refs.platform, "HEAD:souls/platform-reviewer/soul.yaml"));
  assert.equal(reviewer.private, true);
  const engineer = YAML.parse(show(fixture.refs.platform, "HEAD:souls/platform-engineer/soul.yaml"));
  assert.equal(engineer.private, undefined);

  const rm = YAML.parse(show(fixture.refs.agents, "HEAD:souls/release-manager/soul.yaml"));
  assert.equal(rm.team, "engineering");
  assert.deepEqual(rm.capabilities, { "nw-release-tooling": { from: "here" }, "nw-deploy": { from: "package" } }, "nw-deploy comes from the package, never from the member repo (example §3.5)");
  const st = YAML.parse(show(fixture.refs.agents, "HEAD:souls/support-triager/soul.yaml"));
  assert.equal(st.capabilities["nw-house-style"], "off");
  assert.equal(st.knowledge, "none");
  const cw = YAML.parse(show(fixture.refs.marketing, "HEAD:souls/campaign-writer/soul.yaml"));
  assert.deepEqual(cw.capabilities["nw-release-tooling"], { from: fixture.keys.agents });
  const sr = YAML.parse(show(fixture.refs.experts, "HEAD:souls/security-reviewer/soul.yaml"));
  assert.deepEqual(sr.compatibility, { "oats.okf": ">=2.1" });
});

test("capabilities: manifests, teams, executables (mode 100755)", () => {
  const caps = {
    agents: { "nw-release-tooling": { team: "engineering", bin: "bin/nw-release.mjs" }, "nw-house-style": { team: undefined, bin: null } },
    data: { "nw-warehouse-access": { team: "engineering", bin: "bin/nw-wh.mjs" } },
    marketing: { "nw-brand-voice": { team: "marketing", bin: null }, "nw-campaign-metrics": { team: "marketing", bin: "bin/nw-cm.mjs" } },
    "nw-tools": { "nw-tools-dev": { team: "engineering", bin: null } },
  };
  for (const [repo, byName] of Object.entries(caps)) {
    const bare = fixture.refs[repo];
    for (const [name, want] of Object.entries(byName)) {
      const manifest = JSON.parse(show(bare, `HEAD:capabilities/${name}/oats.json`));
      assert.equal(manifest.capability, name);
      assert.equal(manifest.team, want.team);
      if (want.bin) {
        const entry = git(bare, "ls-tree", "HEAD", `capabilities/${name}/${want.bin}`);
        assert.match(entry, /^100755 blob /, `${name} executable bit`);
        assert.ok(Object.values(manifest.commands).some((c) => c.startsWith(want.bin)), `${name} commands point at ${want.bin}`);
      } else {
        assert.equal(manifest.commands, undefined);
      }
    }
  }
  const rt = JSON.parse(show(fixture.refs.agents, "HEAD:capabilities/nw-release-tooling/oats.json"));
  assert.deepEqual(rt.requires, ["oats.core"]);
  assert.equal(rt.inject, "injects/release-policy.md");
  assert.ok(show(fixture.refs.agents, `HEAD:${rt.inject}`.replace("HEAD:", "HEAD:capabilities/nw-release-tooling/")).length > 0);
});

test("packages: tags exist, catalog points at them, manifests list capabilities; oats.okf is the knowledge layer with a real executable", () => {
  assert.deepEqual(Object.keys(fixture.catalog).sort(), ["oats.framework", "oats.okf"]);
  const expect = { "oats.okf": "pkg-okf", "oats.framework": "pkg-framework" };
  for (const [id, repo] of Object.entries(expect)) {
    const entry = fixture.catalog[id];
    assert.equal(entry.url, fixture.refs[repo]);
    assert.equal(entry.ref, PACKAGE_TAGS[repo]);
    assert.equal(entry.path, "oats-package");
    const tags = git(base, "ls-remote", "--tags", entry.url);
    assert.match(tags, new RegExp(`^${fixture.commits[repo]}\\trefs/tags/${entry.ref.replace(".", "\\.")}$`, "m"), `${id} tag ${entry.ref} at the repo's commit`);
    assert.equal(git(entry.url, "rev-parse", `refs/tags/${entry.ref}^{commit}`), fixture.commits[repo]);
    assert.equal(fixture.tags[repo].commit, fixture.commits[repo]);

    const pkg = JSON.parse(show(entry.url, `HEAD:${entry.path}/oats-package.json`));
    assert.equal(pkg.package, id);
    assert.equal(`v${pkg.version}`, entry.ref);
    assert.ok(Array.isArray(pkg.capabilities) && pkg.capabilities.length === 1);
    const manifest = JSON.parse(show(entry.url, `HEAD:${entry.path}/${pkg.capabilities[0]}/oats.json`));
    assert.equal(manifest.capability, id === "oats.okf" ? "oats.okf" : "oats.core");
  }
  const okf = JSON.parse(show(fixture.refs["pkg-okf"], "HEAD:oats-package/capabilities/oats-okf/oats.json"));
  assert.equal(okf.layer, "knowledge");
  assert.equal(okf.binding.version, 1);
  assert.ok(okf.commands[okf.binding.normalize] && okf.commands[okf.binding.bind] && okf.commands[okf.binding.check]);
  for (const target of Object.values(okf.commands)) assert.ok(target.startsWith("bin/oats-okf.mjs "));
  assert.match(git(fixture.refs["pkg-okf"], "ls-tree", "HEAD", "oats-package/capabilities/oats-okf/bin/oats-okf.mjs"), /^100755 blob /);

  const core = JSON.parse(show(fixture.refs["pkg-framework"], "HEAD:oats-package/capabilities/oats-core/oats.json"));
  assert.equal(core.capability, "oats.core");
  assert.deepEqual(core.skills, ["skills/oats-operate"]);
  assert.ok(show(fixture.refs["pkg-framework"], "HEAD:oats-package/capabilities/oats-core/skills/oats-operate/SKILL.md").includes("name: oats-operate"));
  assert.ok(show(fixture.refs["pkg-framework"], `HEAD:oats-package/capabilities/oats-core/${core.inject}`).length > 0);
});

test("the package executable actually runs", () => {
  const tmp = execFileSync("mktemp", ["-d"], { encoding: "utf8" }).trim();
  cleanups.push(() => fs.rm(tmp, { recursive: true, force: true }));
  git(tmp, "clone", "-q", "--depth", "1", "--branch", "v2.1.3", fixture.refs["pkg-okf"], "okf");
  const script = path.join(tmp, "okf", "oats-package", "capabilities", "oats-okf", "bin", "oats-okf.mjs");
  const r = spawnSync(process.execPath, [script, "binding-check", "--x"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { ok: true, action: "binding-check", args: ["--x"] });
});

test("moveMember commits a change on main and updates fixture.commits", async () => {
  const before = fixture.commits.data;
  const r = await moveMember(fixture, "data", async (work, { writeTree }) => {
    await writeTree({ "capabilities/nw-warehouse-access/bin/nw-wh.mjs": { mode: 0o755, text: "#!/usr/bin/env node\nconsole.log('v2');\n" } });
  });
  assert.equal(r.name, "data");
  assert.equal(r.previous, before);
  assert.match(r.commit, OID);
  assert.notEqual(r.commit, before);
  assert.equal(fixture.commits.data, r.commit);
  assert.equal(git(fixture.refs.data, "rev-parse", "refs/heads/main"), r.commit);
  assert.equal(git(fixture.refs.data, "rev-parse", "refs/heads/main~1"), before);
  // `show` trims; compare the raw blob.
  const raw = execFileSync("git", ["show", "HEAD:capabilities/nw-warehouse-access/bin/nw-wh.mjs"], { cwd: fixture.refs.data, env: gitEnv, encoding: "utf8" });
  assert.equal(raw, "#!/usr/bin/env node\nconsole.log('v2');\n");
  assert.match(git(fixture.refs.data, "ls-tree", "HEAD", "capabilities/nw-warehouse-access/bin/nw-wh.mjs"), /^100755 blob /, "mode preserved through moveMember");
  assert.equal(git(fixture.refs.data, "symbolic-ref", "HEAD"), "refs/heads/main");
});

test("moveMember on an unknown repo throws E_FIXTURE_UNKNOWN_REPO with details", async () => {
  await assert.rejects(
    () => moveMember(fixture, "billing", async () => {}),
    (e) => e.code === "E_FIXTURE_UNKNOWN_REPO" && e.details.name === "billing" && e.provenance.name === "billing",
  );
});

test("dropBacklink removes oats-membership.yaml from the member's default branch", async () => {
  const before = fixture.commits.marketing;
  const r = await dropBacklink(fixture, "marketing");
  assert.notEqual(r.commit, before);
  const tree = git(fixture.refs.marketing, "ls-tree", "-r", "--name-only", "HEAD").split("\n");
  assert.ok(!tree.includes("oats-membership.yaml"), "backlink removed");
  assert.ok(tree.includes("souls/campaign-writer/soul.yaml"), "souls still present");
  assert.equal(git(fixture.refs.marketing, "rev-parse", "refs/heads/main~1"), before);
});

test("makeUnreadable makes git ls-remote fail; restore brings it back", async () => {
  const bare = fixture.refs.platform;
  const okBefore = spawnSync("git", ["ls-remote", bare], { env: gitEnv, encoding: "utf8" });
  assert.equal(okBefore.status, 0);

  const u = await makeUnreadable(fixture, "platform");
  cleanups.push(u.restore);
  assert.equal(u.path, bare);
  const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
  const r = spawnSync("git", ["ls-remote", bare], { env: gitEnv, encoding: "utf8", timeout: 30000 });
  if (isRoot) {
    // root ignores mode bits; nothing to assert about failure
  } else {
    assert.notEqual(r.status, 0, "ls-remote must fail on an unreadable bare repo");
  }

  await u.restore();
  const okAfter = spawnSync("git", ["ls-remote", bare], { env: gitEnv, encoding: "utf8" });
  assert.equal(okAfter.status, 0, okAfter.stderr);
});

test("determinism: two builds of the same fixture produce identical commit OIDs", async () => {
  // Same baseDir → every OID identical (content embeds file:// refs to baseDir).
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "northwind-det-"));
  cleanups.push(() => fs.rm(dir, { recursive: true, force: true }));
  const a = await buildNorthwind(dir);
  await fs.rm(path.join(dir, "remotes"), { recursive: true, force: true });
  const b = await buildNorthwind(dir);
  assert.deepEqual(b.commits, a.commits);
  assert.deepEqual(b.tags, a.tags);

  // Different baseDir → repos that embed no path (packages, external, store) still hash identically,
  // so package integrity digests are stable across machines.
  for (const name of ["pkg-okf", "pkg-framework", "experts", "knowledge"]) {
    assert.equal(a.commits[name], fixture.commits[name], `${name} OID is location-independent`);
  }
  // …and the path-embedding repos differ only because the refs differ.
  assert.notEqual(a.commits.agents, fixture.commits.agents);
});

test("nw-tools: a member (team engineering, tools-expert, nw-tools-dev) that ALSO publishes package nw.tools v0.4.0 — pinned as git:<ref>@v0.4.0, not in the catalog", () => {
  const bare = fixture.refs["nw-tools"];
  assert.equal(PACKAGE_TAGS["nw-tools"], "v0.4.0");
  assert.deepEqual(fixture.tags["nw-tools"], { tag: "v0.4.0", commit: fixture.commits["nw-tools"] });
  assert.equal(git(bare, "rev-parse", "refs/tags/v0.4.0^{commit}"), fixture.commits["nw-tools"]);
  assert.match(git(base, "ls-remote", "--tags", bare), new RegExp(`^${fixture.commits["nw-tools"]}\\trefs/tags/v0\\.4\\.0$`, "m"));
  assert.ok(!("nw.tools" in fixture.catalog), "a direct git ref is not a catalog entry (there is no third form)");

  const soul = YAML.parse(show(bare, "HEAD:souls/tools-expert/soul.yaml"));
  assert.equal(soul.work, "worktree");
  assert.deepEqual(soul.capabilities, { "nw-tools-dev": { from: "here" }, "nw-lint": { from: "package" } });

  const pkg = JSON.parse(show(bare, "HEAD:oats-package/oats-package.json"));
  assert.deepEqual({ package: pkg.package, version: pkg.version, capabilities: pkg.capabilities }, { package: "nw.tools", version: "0.4.0", capabilities: ["capabilities/nw-lint", "capabilities/nw-deploy"] });
  assert.equal(JSON.parse(show(bare, "HEAD:oats-package/capabilities/nw-lint/oats.json")).capability, "nw-lint");
  const deploy = JSON.parse(show(bare, "HEAD:oats-package/capabilities/nw-deploy/oats.json"));
  assert.equal(deploy.capability, "nw-deploy");
  for (const target of Object.values(deploy.commands)) assert.ok(target.startsWith("bin/nw-deploy.mjs "));
  assert.match(git(bare, "ls-tree", "HEAD", "oats-package/capabilities/nw-deploy/bin/nw-deploy.mjs"), /^100755 blob /);
  // the package executable is real
  const tmp = execFileSync("mktemp", ["-d"], { encoding: "utf8" }).trim();
  cleanups.push(() => fs.rm(tmp, { recursive: true, force: true }));
  git(tmp, "clone", "-q", "--depth", "1", "--branch", "v0.4.0", bare, "t");
  const r = spawnSync(process.execPath, [path.join(tmp, "t", "oats-package", "capabilities", "nw-deploy", "bin", "nw-deploy.mjs"), "plan"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { tool: "nw-deploy", cmd: "plan", args: [] });
  // member tier and package tier do not collapse: no nw-lint/nw-deploy under capabilities/
  const memberCaps = git(bare, "ls-tree", "--name-only", "HEAD:capabilities").split("\n");
  assert.deepEqual(memberCaps, ["nw-tools-dev"]);
});

test("determinism: an operator's default excludes/attributes files (~/.config/git/ignore) cannot change the trees", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "northwind-home-"));
  cleanups.push(() => fs.rm(home, { recursive: true, force: true }));
  await fs.mkdir(path.join(home, ".config", "git"), { recursive: true });
  await fs.writeFile(path.join(home, ".config", "git", "ignore"), "bin/\n*.json\n");
  await fs.writeFile(path.join(home, ".config", "git", "attributes"), "* text eol=crlf\n");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "northwind-hm-"));
  cleanups.push(() => fs.rm(dir, { recursive: true, force: true }));
  const saved = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  process.env.HOME = home; delete process.env.XDG_CONFIG_HOME;
  let polluted;
  try { polluted = await buildNorthwind(dir); } finally { process.env.HOME = saved.HOME; if (saved.XDG_CONFIG_HOME !== undefined) process.env.XDG_CONFIG_HOME = saved.XDG_CONFIG_HOME; }
  for (const name of ["pkg-okf", "pkg-framework", "experts", "knowledge"]) assert.equal(polluted.commits[name], fixture.commits[name], `${name} OID unchanged under a polluted HOME`);
  const tree = git(polluted.refs["pkg-okf"], "ls-tree", "-r", "--name-only", "HEAD").split("\n");
  assert.ok(tree.includes("oats-package/oats-package.json") && tree.includes("oats-package/capabilities/oats-okf/bin/oats-okf.mjs"), "ignored patterns did not drop fixture files");
});

test("buildNorthwind refuses a baseDir with whitespace or @ (repo keys would violate the workspace schema)", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "northwind space-"));
  cleanups.push(() => fs.rm(dir, { recursive: true, force: true }));
  await assert.rejects(() => buildNorthwind(dir), (e) => e.code === "E_FIXTURE_BASEDIR" && e.details.baseDir === dir);
});

test("buildNorthwind refuses to build over an existing fixture", async () => {
  await assert.rejects(
    () => buildNorthwind(base),
    (e) => e.code === "E_FIXTURE_EXISTS" && e.details.remotesDir === path.join(base, "remotes"),
  );
});
