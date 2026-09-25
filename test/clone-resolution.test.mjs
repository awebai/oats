// lib/instance-resolution.mjs — resolveMemberClone / requireMemberClone (0.25.2 R1) and the
// E_NO_DEPLOYMENT remedy for a deployment that has oats-local.yaml but no agents/ (0.25.2 R2).
//
// R1: docs/workspaces.md, docs/configuration.md and `oats onboard` all say "the kernel finds a
// member's clone through oats-local.yaml (`clones:`) or at <deployment>/<member name>"; the 0.25.0/1
// kernel never read either and refused every worktree|checkout spawn until --repo was given. These
// tests pin the lookup order and the verification (a found path must be a clone of THAT member).
// Real Git repos under a temp dir; no fixture, no network, no `oats setup`.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveMemberClone, requireMemberClone, conventionCloneDir, memberNameOf, verifyMemberClone } from "../lib/instance-resolution.mjs";
import { ensureRoot } from "../lib/core.mjs";
import { inertRuntimePath } from "./helpers/runtime-stub.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
/** Run fn, expecting an oatsError with `code`; returns the error (assert.throws returns nothing). */
function caught(fn, code) {
  try { fn(); } catch (e) { assert.equal(e.code, code, e.message); return e; }
  assert.fail(`expected ${code} to be thrown`);
}
const git = (cwd, ...argv) => execFileSync("git", ["-C", cwd, ...argv], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
/** A repo whose remote `name` points at `url` (no commits needed for a remote lookup). */
function repoWithRemote(dir, url, name = "origin") {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q");
  if (url) git(dir, "remote", "add", name, url);
  return dir;
}
const prepared = (deployment, repoKey, { clones, members, name = "platform-engineer", work = "worktree" } = {}) => ({
  deployment,
  local: { schemaVersion: 2, workspace: "git:github.com/northwind/agents", ...(clones ? { clones } : {}) },
  soulEntry: { name, repoKey, definition: { work } },
  discovery: { workspace: { members: members ?? [] } },
});

test("memberNameOf / conventionCloneDir: last key segment without .git; a member called agents → agents-repo (matches onboard's cloneDirOf)", () => {
  assert.equal(memberNameOf("github.com/northwind/platform"), "platform");
  assert.equal(memberNameOf("github.com/northwind/platform.git"), "platform");
  assert.equal(memberNameOf("local//tmp/x/remotes/data.git"), "data");
  assert.equal(conventionCloneDir("/dep", "github.com/northwind/platform"), "/dep/platform");
  assert.equal(conventionCloneDir("/dep", "github.com/northwind/agents"), "/dep/agents-repo");
});

test("R1: lookup order — --repo wins (unverified, relative to the deployment); then clones: (key as written, any ref spelling); then <deployment>/<member>; then null", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-clone-res-"));
  try {
    const dep = join(base, "dep"); mkdirSync(dep);
    const key = "github.com/northwind/platform";
    // (4) nothing anywhere → null (E_CLONE_MISSING is the caller's — requireMemberClone below)
    assert.equal(resolveMemberClone(prepared(dep, key)), null);
    // (3) the convention path, a clone of the member
    repoWithRemote(join(dep, "platform"), "https://github.com/northwind/platform.git");
    assert.equal(resolveMemberClone(prepared(dep, key)), join(dep, "platform"));
    // a remote other than origin is enough (any remote)
    rmSync(join(dep, "platform"), { recursive: true });
    repoWithRemote(join(dep, "platform"), "git@github.com:northwind/platform.git", "upstream");
    assert.equal(resolveMemberClone(prepared(dep, key)), join(dep, "platform"));
    // (2) clones: beats the convention; the key may be spelled as the canonical key…
    const elsewhere = repoWithRemote(join(base, "elsewhere", "plat"), "https://github.com/northwind/platform.git");
    assert.equal(resolveMemberClone(prepared(dep, key, { clones: { [key]: elsewhere } })), elsewhere);
    // …or in any ref form the operator may have written (normalised through parseRepoRef)
    for (const written of ["git:github.com/northwind/platform", "https://github.com/northwind/platform.git", "git@github.com:northwind/platform.git", "GitHub.com/northwind/platform.git"]) {
      assert.equal(resolveMemberClone(prepared(dep, key, { clones: { [written]: elsewhere } })), elsewhere, `clones key spelled ${written}`);
    }
    // a clones: entry for ANOTHER member is ignored (falls through to the convention)
    assert.equal(resolveMemberClone(prepared(dep, key, { clones: { "github.com/northwind/data": elsewhere } })), join(dep, "platform"));
    // a relative clones: path is relative to the deployment
    assert.equal(resolveMemberClone(prepared(dep, key, { clones: { [key]: "platform" } })), join(dep, "platform"));
    // (1) --repo wins over everything, even a clones: entry; relative → deployment
    assert.equal(resolveMemberClone(prepared(dep, key, { clones: { [key]: elsewhere } }), { explicit: "/somewhere/else" }), "/somewhere/else");
    assert.equal(resolveMemberClone(prepared(dep, key), { explicit: "rel" }), join(dep, "rel"));
    // the `agents` member lives at agents-repo/ (agents/ is the instance root)
    mkdirSync(join(dep, "agents"));
    repoWithRemote(join(dep, "agents-repo"), "https://github.com/northwind/agents.git");
    assert.equal(resolveMemberClone(prepared(dep, "github.com/northwind/agents")), join(dep, "agents-repo"));
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("R1: a found path must be a clone of THAT member — wrong repo, no remotes, not a repo, clones: path absent → E_CLONE_MISMATCH { path, expected, found }", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-clone-res-"));
  try {
    const dep = join(base, "dep"); mkdirSync(dep);
    const key = "github.com/northwind/platform";
    // the wrong repo at the convention path
    repoWithRemote(join(dep, "platform"), "https://github.com/northwind/data.git");
    let e = caught(() => resolveMemberClone(prepared(dep, key)), "E_CLONE_MISMATCH");
    assert.equal(e.details.path, join(dep, "platform"));
    assert.equal(e.details.expected, key);
    assert.deepEqual(e.details.found, ["github.com/northwind/data"]);
    assert.match(e.message, /is not a clone of github\.com\/northwind\/platform/);
    // a repo with no remotes
    rmSync(join(dep, "platform"), { recursive: true });
    repoWithRemote(join(dep, "platform"), null);
    e = caught(() => resolveMemberClone(prepared(dep, key)), "E_CLONE_MISMATCH");
    assert.deepEqual(e.details.found, []);
    assert.match(e.message, /no remotes/);
    // a plain directory (not a repo)
    rmSync(join(dep, "platform"), { recursive: true }); mkdirSync(join(dep, "platform"));
    e = caught(() => resolveMemberClone(prepared(dep, key)), "E_CLONE_MISMATCH");
    assert.equal(e.details.found, null); assert.match(e.message, /not a Git repository/);
    // a file where the clone should be
    rmSync(join(dep, "platform"), { recursive: true }); writeFileSync(join(dep, "platform"), "x");
    e = caught(() => resolveMemberClone(prepared(dep, key)), "E_CLONE_MISMATCH");
    assert.match(e.message, /not a directory/);
    // a clones: entry whose path does not exist: the operator NAMED it — a mismatch, never silently "missing"
    e = caught(() => resolveMemberClone(prepared(dep, key, { clones: { [key]: join(base, "nope") } })), "E_CLONE_MISMATCH");
    assert.equal(e.details.path, join(base, "nope")); assert.equal(e.details.found, null); assert.match(e.message, /does not exist/);
    assert.match(e.details.via, /clones:/);
    // a clones: entry pointing at the wrong repo
    const wrong = repoWithRemote(join(base, "wrong"), "https://github.com/northwind/data.git");
    e = caught(() => resolveMemberClone(prepared(dep, key, { clones: { [key]: wrong } })), "E_CLONE_MISMATCH");
    assert.equal(e.details.path, wrong); assert.deepEqual(e.details.found, ["github.com/northwind/data"]);
    // verifyMemberClone accepts a matching clone and returns the path
    const ok = repoWithRemote(join(base, "ok"), "git:github.com/northwind/platform".replace("git:", "https://") + ".git");
    assert.equal(verifyMemberClone(ok, key), ok);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("R1: local/<abs> keys compare by realpath (a clone made through a symlinked tmpdir still matches its bare remote)", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-clone-res-"));
  try {
    const bare = join(base, "remotes", "platform.git"); mkdirSync(bare, { recursive: true }); git(bare, "init", "-q", "--bare");
    const dep = join(base, "dep"); mkdirSync(dep);
    // the clone's remote url is the lexical path; the key may carry the realpath (or vice versa)
    repoWithRemote(join(dep, "platform"), bare);
    assert.equal(resolveMemberClone(prepared(dep, `local/${realpathSync(bare)}`)), join(dep, "platform"));
    assert.equal(resolveMemberClone(prepared(dep, `local/${bare}`)), join(dep, "platform"));
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("R1: requireMemberClone → E_CLONE_MISSING naming BOTH remedies (git clone <url> <deployment>/<name>; clones: { <key>: <abs path> }) and --repo", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-clone-res-"));
  try {
    const dep = join(base, "dep"); mkdirSync(dep);
    const key = "github.com/northwind/platform";
    const e = caught(() => requireMemberClone(prepared(dep, key, { members: ["git:github.com/northwind/agents", "git@github.com:northwind/platform.git"] })), "E_CLONE_MISSING");
    assert.equal(e.details.repoKey, key); assert.equal(e.details.soul, "platform-engineer"); assert.equal(e.details.work, "worktree");
    assert.equal(e.details.convention, join(dep, "platform"));
    assert.equal(e.details.url, "git@github.com:northwind/platform.git", "the url is the member ref AS THE WORKSPACE WROTE IT (ssh stays ssh)");
    assert.match(e.message, new RegExp(`git clone git@github\\.com:northwind/platform\\.git ${join(dep, "platform").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), "remedy 1: the convention clone");
    assert.match(e.message, /clones: \{ github\.com\/northwind\/platform: <abs path> \}/, "remedy 2: the oats-local.yaml clones: entry");
    assert.match(e.message, /--repo <path>/, "…and --repo for a one-off");
    assert.deepEqual(e.details.remedies.local, { clones: { [key]: "<abs path>" } });
    // a member not listed in the workspace (standalone / external) still gets a usable url
    const e2 = caught(() => requireMemberClone(prepared(dep, key)), "E_CLONE_MISSING");
    assert.equal(e2.details.url, "https://github.com/northwind/platform.git");
    // with a clone present, requireMemberClone returns it
    repoWithRemote(join(dep, "platform"), "https://github.com/northwind/platform.git");
    assert.equal(requireMemberClone(prepared(dep, key)), join(dep, "platform"));
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("R2: ensureRoot with an oats-local.yaml above but no agents/ → E_NO_DEPLOYMENT whose remedy is `mkdir <deployment>/agents (or run oats sync)`, never a v1 verb", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-clone-res-"));
  try {
    const dep = join(base, "northwind-workspace"); mkdirSync(join(dep, "deeper"), { recursive: true });
    writeFileSync(join(dep, "oats-local.yaml"), "schemaVersion: 2\nworkspace: git:github.com/northwind/agents\n");
    const prev = process.env.PI_AGENTS_ROOT; delete process.env.PI_AGENTS_ROOT;
    try {
      for (const from of [dep, join(dep, "deeper")]) {
        const e = caught(() => ensureRoot(from), "E_NO_DEPLOYMENT");
        assert.match(e.message, new RegExp(`mkdir ${join(dep, "agents").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(or run \`oats sync`), from);
        assert.doesNotMatch(e.message, /oats create/, "no v1 verb in the remedy");
        assert.doesNotMatch(e.message, /oats-config\.yaml/);
        const details = e.details ?? e.provenance;
        assert.equal(details.deployment, dep); assert.equal(details.local, join(dep, "oats-local.yaml"));
        assert.equal(details.remedy, `mkdir ${join(dep, "agents")} (or run oats sync)`);
      }
      // no oats-local.yaml anywhere above → the classic message (unchanged)
      const bare = join(base, "bare"); mkdirSync(bare);
      const e = caught(() => ensureRoot(bare), "E_NO_DEPLOYMENT");
      assert.doesNotMatch(e.message, /oats-local\.yaml names this deployment/);
      // through the CLI: one JSON envelope, the same remedy
      const r = spawnSync(process.execPath, [CLI, "spawn", "platform-engineer", "--dir", dep, "--no-launch", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PATH: inertRuntimePath(base), PI_AGENTS_ROOT: "", PI_AGENT_HOME: "", OATS_HOME: "", HOME: join(base, "home") } });
      assert.equal(r.status, 1, r.stdout + r.stderr);
      const doc = JSON.parse(r.stdout);
      assert.equal(doc.error.code, "E_NO_DEPLOYMENT");
      assert.match(doc.error.message, /mkdir .*agents \(or run `oats sync/);
      assert.doesNotMatch(doc.error.message, /oats create/);
    } finally { if (prev !== undefined) process.env.PI_AGENTS_ROOT = prev; }
  } finally { rmSync(base, { recursive: true, force: true }); }
});
