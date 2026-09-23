// lib/workspace.mjs — declarations, membership, discovery (module contract §2).
// Runs against an in-memory fake remote (contract §1 API, REAL parseRepoRef) — no git, no network —
// plus one integration pass over the Northwind fixture with the real lib/remote.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import YAML from "yaml";
import { oatsError } from "../lib/errors.mjs";
import { parseRepoRef } from "../lib/remote.mjs";
import {
  confirmMembership, discoverRepo, discoverWorkspace, loadLocal, observeWorkspace, standaloneRepo,
  validateLocal, validateMembership, validateSoul, validateWorkspace,
} from "../lib/workspace.mjs";

/* ───────────────────────────── fake remote (contract §1) ──────────────── */

const OID = (seed) => seed.repeat(40).slice(0, 40);
const detailed = (code, message, details) => { const e = oatsError(code, message, details); e.details = details; return e; };

/**
 * repos: { <key>: { commit, files: { <path>: string|object }, unreadable?: true } }
 * Object file values are YAML-encoded (or JSON for *.json).
 */
function fakeRemote(repos) {
  const calls = [];
  const repoOf = (ref) => {
    const parsed = parseRepoRef(ref);
    const repo = repos[parsed.key];
    if (!repo) throw detailed("E_REMOTE_UNREADABLE", `cannot read ${parsed.url}`, { url: parsed.url, reason: "not-found" });
    if (repo.unreadable) throw detailed("E_REMOTE_UNREADABLE", `cannot read ${parsed.url}`, { url: parsed.url, reason: "auth" });
    return { parsed, repo };
  };
  const encode = (path, value) => {
    if (typeof value === "string" || Buffer.isBuffer(value)) return Buffer.from(value);
    return Buffer.from(path.endsWith(".json") ? JSON.stringify(value, null, 2) + "\n" : YAML.stringify(value, { lineWidth: 0 }));
  };
  return {
    calls,
    parseRepoRef,
    async observeRemote(ref, { at } = {}) {
      calls.push(["observeRemote", ref, at]);
      const { parsed, repo } = repoOf(ref);
      const commit = at && /^[0-9a-f]{40}$/.test(at) ? at : repo.commit;
      return { key: parsed.key, url: parsed.url, commit, ref: at ? null : "refs/heads/main", observedAt: "2026-09-23T10:00:00.000Z" };
    },
    async readRemoteFile(ref, commit, path) {
      calls.push(["readRemoteFile", ref, commit, path]);
      const { repo } = repoOf(ref);
      if (repo.faults?.read?.[path]) throw repo.faults.read[path];
      const tree = repo.history?.[commit] ?? (commit === repo.commit ? repo.files : null);
      if (!tree) throw detailed("E_REMOTE_UNREADABLE", `unknown commit ${commit}`, { url: ref, reason: "not-found" });
      if (!Object.hasOwn(tree, path)) throw detailed("E_REMOTE_PATH_MISSING", `${path} is not in ${ref}@${commit}`, { path });
      const bytes = encode(path, tree[path]);
      return { bytes, size: bytes.length };
    },
    async listRemoteTree(ref, commit, dir, { depth = 2 } = {}) {
      calls.push(["listRemoteTree", ref, commit, dir]);
      const { repo } = repoOf(ref);
      if (repo.faults?.list?.[dir]) throw repo.faults.list[dir];
      const tree = repo.history?.[commit] ?? (commit === repo.commit ? repo.files : {});
      const out = [];
      const seenDirs = new Set();
      for (const path of Object.keys(tree)) {
        if (!path.startsWith(`${dir}/`)) continue;
        const rel = path.slice(dir.length + 1);
        const parts = rel.split("/");
        if (parts.length <= depth) out.push({ path: rel, type: "blob", size: encode(path, tree[path]).length });
        for (let i = 1; i < Math.min(parts.length, depth + 1); i++) {
          const d = parts.slice(0, i).join("/");
          if (!seenDirs.has(d)) { seenDirs.add(d); out.push({ path: d, type: "tree" }); }
        }
      }
      return out;
    },
  };
}

/* ───────────────────────────── mini Northwind ─────────────────────────── */

const WS = "git:github.com/northwind/agents";
const R = {
  agents: "git:github.com/northwind/agents",
  platform: "git:github.com/northwind/platform",
  data: "git:github.com/northwind/data",
  billing: "git:github.com/northwind/billing",   // listed, no backlink
  vault: "git:github.com/northwind/vault",       // listed, unreadable
  fork: "git:github.com/northwind/fork",         // listed, backlinks elsewhere
  knowledge: "git:github.com/northwind/knowledge",
  experts: "git:github.com/oss-collective/experts",
  stranger: "git:github.com/acme/stranger",      // not listed
};
const K = Object.fromEntries(Object.entries(R).map(([n, ref]) => [n, parseRepoRef(ref).key]));
const C = { agents: OID("a"), platform: OID("b"), data: OID("c"), billing: OID("d"), vault: OID("e"), fork: OID("f"), experts: OID("9"), stranger: OID("5") };

const soul = (name, extra = {}) => ({ schemaVersion: 2, name, description: `${name} soul`, work: "directory", capabilities: {}, ...extra });
const manifest = (capability, extra = {}) => ({ capability, version: "0.0.0-workspace", description: `${capability} capability`, compatibility: { oats: ">=0.24.0" }, ...extra });

function workspaceFile(overrides = {}) {
  return {
    schemaVersion: 2,
    name: "northwind",
    members: [R.agents, R.platform, R.data, R.billing, R.vault, R.fork],
    packages: { "oats.framework": "v1.1.3", "oats.okf": "v2.1.3" },
    teams: {
      global: { description: "Org-wide" },
      engineering: { description: "Platform + data" },
      marketing: { description: "Campaigns" },
    },
    defaults: {
      capabilities: { "oats.core": { from: "package" }, "nw-house-style": { from: K.agents } },
      knowledge: { "oats.okf": { from: "package" } },
      messaging: "none",
      tasks: "none",
      byTeam: { engineering: { capabilities: { "nw-release-tooling": { from: K.agents } } } },
    },
    stores: { org: R.knowledge },
    messaging: { private: "per-human", channels: ["northwind-eng"] },
    external: [{ source: `${R.experts}@${C.experts}`, soul: "souls/security-reviewer" }],
    ...overrides,
  };
}

function northwind({ workspace = workspaceFile(), mutate = () => {} } = {}) {
  const repos = {
    [K.agents]: {
      commit: C.agents,
      files: {
        "oats-workspace.yaml": workspace,
        "oats-membership.yaml": { schemaVersion: 2, workspace: WS, team: "global" },
        "souls/release-manager/soul.yaml": soul("release-manager", { work: "worktree", team: "engineering", capabilities: { "nw-release-tooling": { from: "here" } }, knowledge: { owns: "release-manager" } }),
        "souls/release-manager/AGENTS.md": "# release-manager\n",
        "souls/support-triager/soul.yaml": soul("support-triager", { capabilities: { "nw-house-style": "off" }, knowledge: "none" }),
        "capabilities/nw-release-tooling/oats.json": manifest("nw-release-tooling", { team: "engineering", commands: { cut: "bin/nw-release.mjs cut" } }),
        "capabilities/nw-release-tooling/bin/nw-release.mjs": "#!/usr/bin/env node\n",
        "capabilities/nw-house-style/oats.json": manifest("nw-house-style", { inject: "injects/house-style.md" }),
        "capabilities/nw-house-style/injects/house-style.md": "## House style\n",
      },
    },
    [K.platform]: {
      commit: C.platform,
      files: {
        "src/index.mjs": "export {};\n",
        "oats-membership.yaml": { schemaVersion: 2, workspace: WS, team: "engineering" },
        "souls/platform-engineer/soul.yaml": soul("platform-engineer", { work: "worktree" }),
        "souls/platform-reviewer/soul.yaml": soul("platform-reviewer", { work: "checkout", private: true }),
        "souls/README.md": "not a soul\n",
        "capabilities/nw-experimental-linter/oats.json": manifest("nw-experimental-linter", { private: true }),
      },
    },
    [K.data]: {
      commit: C.data,
      files: {
        "oats-membership.yaml": { schemaVersion: 2, workspace: `https://github.com/northwind/agents.git`, team: "engineering" }, // same key, other spelling
        "souls/data-analyst/soul.yaml": soul("data-analyst", { capabilities: { "nw-warehouse-access": { from: "here" }, "nw-house-style": { from: K.agents }, "oats.core": { from: "package" } } }),
        "souls/growth-hacker/soul.yaml": soul("growth-hacker", { team: "growth" }),            // unknown team label
        "souls/broken/soul.yaml": { schemaVersion: 2, name: "Broken Name", work: "nowhere" },  // schema problems
        "souls/legacy/soul.yaml": { schemaVersion: 1, name: "legacy" },                        // v1 file at a v2 path
        "capabilities/nw-warehouse-access/oats.json": manifest("nw-warehouse-access", { team: "engineering", commands: { query: "bin/nw-wh.mjs query" } }),
        "capabilities/nw-secret/oats.json": manifest("nw-secret", { team: "ops" }),            // unknown team label
        "capabilities/nw-garbage/oats.json": "{ not json",
      },
    },
    [K.billing]: { commit: C.billing, files: { "souls/biller/soul.yaml": soul("biller") } },   // no oats-membership.yaml
    [K.vault]: { commit: C.vault, unreadable: true, files: {} },
    [K.fork]: { commit: C.fork, files: { "oats-membership.yaml": { schemaVersion: 2, workspace: "git:github.com/someone-else/agents" } } },
    [K.stranger]: { commit: C.stranger, files: { "oats-membership.yaml": { schemaVersion: 2, workspace: WS }, "souls/intruder/soul.yaml": soul("intruder") } },
    [K.experts]: {
      commit: OID("8"), // default branch moved past the pin
      files: { "souls/security-reviewer/soul.yaml": soul("security-reviewer", { description: "NEWER — must not be read" }) },
      history: { [C.experts]: { "souls/security-reviewer/soul.yaml": soul("security-reviewer", { work: "worktree", compatibility: { "oats.okf": ">=2.1" } }) } },
    },
  };
  mutate(repos);
  return fakeRemote(repos);
}

/* ───────────────────────────── schema tests ───────────────────────────── */

test("workspace schema accepts the Northwind file", () => {
  const remote = northwind();
  assert.deepEqual(validateWorkspace(workspaceFile(), { remote }), []);
});

test("workspace schema refusals each name the offending path", () => {
  const remote = northwind();
  const refuse = (overrides, path, re) => {
    const problems = validateWorkspace(workspaceFile(overrides), { remote });
    assert.ok(problems.length, `expected refusal for ${JSON.stringify(overrides)}`);
    const hit = problems.find((p) => p.path === path);
    assert.ok(hit, `expected a problem at ${path}, got ${JSON.stringify(problems)}`);
    if (re) assert.match(hit.message, re);
  };
  refuse({ members: [R.agents, `${R.platform}@main`] }, "/members/1", /does not match/);
  refuse({ members: [R.agents, "git:github.com/northwind/platform@" + OID("1")] }, "/members/1");
  refuse({ bogus: 1 }, "/bogus", /unknown property/);
  refuse({ name: "North Wind" }, "/name", /does not match/);
  refuse({ name: "Northwind" }, "/name");
  refuse({ schemaVersion: 1 }, "/schemaVersion", /expected 2/);
  refuse({ stores: { org: "/Users/ana/knowledge" } }, "/stores/org", /absolute paths are refused/);
  refuse({ messaging: { statePath: "/var/oats/state" } }, "/messaging/statePath", /absolute paths are refused/);
  refuse({ messaging: { statePath: "C:\\oats" } }, "/messaging/statePath", /absolute paths are refused/);
  refuse({ external: [{ source: `${R.experts}@9c4e1f2a`, soul: "souls/x" }] }, "/external/0/source", /does not match/);
  refuse({ external: [{ source: R.experts, soul: "souls/x" }] }, "/external/0/source");
  refuse({ external: [{ source: `${R.experts}@${C.experts}`, soul: "../escape" }] }, "/external/0/soul");
  refuse({ external: [{ source: `${R.experts}@${C.experts}`, soul: "souls/x", team: "nobody" }] }, "/external/0/team", /not declared/);
  refuse({ defaults: { knowledge: { a: { from: "package" }, b: { from: "package" } } } }, "/defaults/knowledge", /at most 1/);
  refuse({ defaults: { knowledge: { a: "off" } } }, "/defaults/knowledge/a");
  refuse({ defaults: { capabilities: { x: { from: "package", version: "1" } } } }, "/defaults/capabilities/x/version", /unknown property/);
  refuse({ defaults: { capabilities: { x: { from: "/abs/path" } } } }, "/defaults/capabilities/x/from");
  refuse({ defaults: { capabilities: { x: "maybe" } } }, "/defaults/capabilities/x");
  refuse({ defaults: { byTeam: { sales: { capabilities: {} } } } }, "/defaults/byTeam/sales", /not declared/);
  refuse({ teams: { "Eng Team": {} } }, "/teams/Eng Team", /invalid key/);
  refuse({ members: [R.agents, "nonsense:not-a-ref"] }, "/members/1", /not a repo ref/);
  refuse({ members: [R.agents, "https://github.com/northwind/agents.git"] }, "/members/1", /duplicates member 0/);
  refuse({ packages: { "oats.okf": "" } }, "/packages/oats.okf");
});

test("workspace schema hint names schemaVersion 2 when a v1 file sits at the v2 path", async () => {
  const remote = northwind({ workspace: { schemaVersion: 1, name: "northwind", members: [] } });
  await assert.rejects(observeWorkspace(WS, { remote }), (e) => {
    assert.equal(e.code, "E_WORKSPACE_SCHEMA");
    assert.match(e.message, /schemaVersion 2 only; found 1/);
    assert.equal(e.details.path, "oats-workspace.yaml");
    assert.equal(e.provenance, e.details);
    assert.ok(e.details.problems.some((p) => p.path === "/schemaVersion"));
    return true;
  });
});

test("membership, soul and local schemas", () => {
  assert.deepEqual(validateMembership({ schemaVersion: 2, workspace: WS, team: "global" }), []);
  assert.deepEqual(validateMembership({ schemaVersion: 2, workspace: WS }), []);
  assert.equal(validateMembership({ schemaVersion: 2, workspace: WS, exports: {} })[0].path, "/exports");
  assert.equal(validateMembership({ schemaVersion: 2, workspace: `${WS}@main` })[0].path, "/workspace");
  assert.equal(validateMembership({ schemaVersion: 1, exports: {} }).length, 3);

  assert.deepEqual(validateSoul(soul("release-manager", { team: "engineering", private: true, capabilities: { a: { from: "here" }, b: { from: "package" }, c: { from: K.data }, d: "off" }, knowledge: "none", messaging: { channels: ["x"] }, compatibility: { "oats.okf": ">=2.1" } })), []);
  const soulProblems = validateSoul({ schemaVersion: 2, name: "Bad", work: "nowhere", capabilities: { a: { from: "package", version: "1.0" }, b: { source: "git:x" } }, private: "yes", extra: 1 });
  const at = (p) => soulProblems.find((x) => x.path === p);
  assert.ok(at("/name"), JSON.stringify(soulProblems));
  assert.ok(at("/work"));
  assert.ok(at("/capabilities/a/version"));
  assert.match(at("/capabilities/b").message, /missing required property "from"/);
  assert.ok(at("/private"));
  assert.match(at("/extra").message, /unknown property/);

  assert.deepEqual(validateLocal({ schemaVersion: 2, workspace: WS, clones: { [K.platform]: "~/src/nw-platform" }, settings: { "oats.okf": { "state-dir": "/Users/ana/.oats/okf" } }, souls: { disabled: ["data-analyst"] } }), []);
  assert.equal(validateLocal({ schemaVersion: 2, workspace: WS, souls: { disabled: ["Data Analyst"] } })[0].path, "/souls/disabled/0");
  assert.equal(validateLocal({ schemaVersion: 2, workspace: WS, capabilities: {} })[0].path, "/capabilities");
  assert.equal(validateLocal({ schemaVersion: 2 })[0].message, 'missing required property "workspace"');
});

/* ───────────────────────────── observe + confirm ──────────────────────── */

test("observeWorkspace returns the parsed, validated file with its commit", async () => {
  const remote = northwind();
  const obs = await observeWorkspace(WS, { remote });
  assert.equal(obs.key, K.agents);
  assert.equal(obs.commit, C.agents);
  assert.equal(obs.workspace.name, "northwind");
  assert.equal(obs.observedAt, "2026-09-23T10:00:00.000Z");
  assert.ok(remote.calls.some(([fn, , at]) => fn === "observeRemote" && at === undefined));
});

test("observeWorkspace with `at` reads at that commit and E_REMOTE_UNREADABLE propagates", async () => {
  const remote = northwind();
  const obs = await observeWorkspace(WS, { at: C.agents, remote });
  assert.equal(obs.commit, C.agents);
  await assert.rejects(observeWorkspace(R.vault, { remote }), (e) => e.code === "E_REMOTE_UNREADABLE" && e.details.reason === "auth");
  // a member handed in as the workspace: not a workspace host → E_WORKSPACE_SCHEMA (contract), never a leaked E_REMOTE_PATH_MISSING
  await assert.rejects(observeWorkspace(R.platform, { remote }), (e) => e.code === "E_WORKSPACE_SCHEMA" && e.details.cause === "E_REMOTE_PATH_MISSING" && /not a workspace host/.test(e.message));
});

test("confirmMembership: confirmed (same key across ref spellings) carries commit and team", async () => {
  const remote = northwind();
  const ws = await observeWorkspace(WS, { remote });
  const platform = await confirmMembership(ws, R.platform, { remote });
  assert.deepEqual(platform, { key: K.platform, commit: C.platform, confirmed: true, team: "engineering" });
  // data backlinks with the https spelling — parseRepoRef(...).key makes them equal
  const data = await confirmMembership(ws, "https://github.com/northwind/data", { remote });
  assert.equal(data.confirmed, true);
  assert.equal(data.key, K.data);
  // the host repo backlinks to itself like any other member
  const self = await confirmMembership(ws, R.agents, { remote });
  assert.equal(self.confirmed, true);
  assert.equal(self.team, "global");
});

test("confirmMembership: all four unconfirmed reasons, never a throw", async () => {
  const remote = northwind();
  const ws = await observeWorkspace(WS, { remote });
  const stranger = await confirmMembership(ws, R.stranger, { remote });
  assert.equal(stranger.confirmed, false);
  assert.equal(stranger.reason, "not-listed");
  assert.match(stranger.detail, /not in members/);
  assert.ok(!remote.calls.some(([fn, ref]) => fn === "observeRemote" && ref === R.stranger), "not-listed must not touch the remote");

  const billing = await confirmMembership(ws, R.billing, { remote });
  assert.equal(billing.reason, "no-backlink");
  assert.equal(billing.commit, C.billing);
  assert.match(billing.detail, /no oats-membership.yaml/);

  const fork = await confirmMembership(ws, R.fork, { remote });
  assert.equal(fork.reason, "backlink-elsewhere");
  assert.equal(fork.backlink, "github.com/someone-else/agents");
  assert.match(fork.detail, /someone-else\/agents, not github.com\/northwind\/agents/);

  const vault = await confirmMembership(ws, R.vault, { remote });
  assert.equal(vault.reason, "cannot-read");
  assert.equal(vault.url, "https://github.com/northwind/vault.git");
  assert.match(vault.detail, /cannot read .*vault.*\(auth\)/);
});

test("confirmMembership: an invalid backlink file is no-backlink with the schema problems in detail", async () => {
  const remote = northwind({ mutate: (repos) => { repos[K.platform].files["oats-membership.yaml"] = { schemaVersion: 1, workspace: { source: WS }, exports: {} }; } });
  const ws = await observeWorkspace(WS, { remote });
  const row = await confirmMembership(ws, R.platform, { remote });
  assert.equal(row.reason, "no-backlink");
  assert.ok(row.problems.some((p) => p.path === "/schemaVersion"));
  assert.ok(row.problems.some((p) => p.path === "/exports"));
});

test("confirmMembership throws only for a broken WORKSPACE file", async () => {
  const remote = northwind();
  const ws = await observeWorkspace(WS, { remote });
  const broken = { ...ws, workspace: { ...ws.workspace, members: [...ws.workspace.members, `${R.platform}@main`] } };
  await assert.rejects(confirmMembership(broken, R.platform, { remote }), (e) => e.code === "E_WORKSPACE_SCHEMA" && e.details.problems.some((p) => p.path === "/members/6"));
});

/* ───────────────────────────── discovery ──────────────────────────────── */

test("discoverWorkspace: the whole picture — rows, souls, capabilities, private, team, external, problems", async () => {
  const remote = northwind();
  const d = await discoverWorkspace(WS, { remote });
  assert.equal(d.workspace.name, "northwind");
  assert.equal(d.key, K.agents);
  assert.equal(d.commit, C.agents);
  const rows = Object.fromEntries(d.members.map((m) => [m.key, m]));
  assert.deepEqual(Object.keys(rows), [K.agents, K.platform, K.data, K.billing, K.vault, K.fork]);

  // unconfirmed rows contribute nothing but the row
  assert.equal(rows[K.billing].confirmed, false); assert.equal(rows[K.billing].reason, "no-backlink"); assert.deepEqual(rows[K.billing].souls, []);
  assert.equal(rows[K.vault].reason, "cannot-read"); assert.equal(rows[K.vault].commit, null);
  assert.equal(rows[K.fork].reason, "backlink-elsewhere");

  // agents (team global default; release-manager overrides to engineering)
  const agents = rows[K.agents];
  assert.equal(agents.confirmed, true); assert.equal(agents.team, "global");
  const rm = agents.souls.find((s) => s.name === "release-manager");
  assert.equal(rm.team, "engineering"); assert.equal(rm.private, false); assert.equal(rm.path, "souls/release-manager");
  assert.equal(rm.repoKey, K.agents); assert.equal(rm.commit, C.agents); assert.equal(rm.definition.work, "worktree");
  assert.equal(agents.souls.find((s) => s.name === "support-triager").team, "global");
  const tooling = agents.capabilities.find((c) => c.name === "nw-release-tooling");
  assert.equal(tooling.team, "engineering"); assert.equal(tooling.path, "capabilities/nw-release-tooling"); assert.equal(tooling.manifest.commands.cut, "bin/nw-release.mjs cut");
  assert.equal(agents.capabilities.find((c) => c.name === "nw-house-style").team, "global");

  // platform: private soul + private capability are LISTED with private:true; README ignored
  const platform = rows[K.platform];
  assert.deepEqual(platform.souls.map((s) => [s.name, s.private, s.team]).sort(), [["platform-engineer", false, "engineering"], ["platform-reviewer", true, "engineering"]]);
  assert.deepEqual(platform.capabilities.map((c) => [c.name, c.private]), [["nw-experimental-linter", true]]);

  // data: good items listed, bad items become problems without aborting the repo
  const data = rows[K.data];
  assert.deepEqual(data.souls.map((s) => s.name).sort(), ["data-analyst", "growth-hacker"]);
  assert.equal(data.souls.find((s) => s.name === "growth-hacker").team, "growth"); // still listed
  assert.deepEqual(data.capabilities.map((c) => c.name).sort(), ["nw-secret", "nw-warehouse-access"]);

  // external: read at the pinned OID only
  assert.equal(d.external.length, 1);
  const ext = d.external[0];
  assert.equal(ext.commit, C.experts); assert.equal(ext.key, K.experts);
  assert.equal(ext.soul.name, "security-reviewer"); assert.equal(ext.soul.definition.work, "worktree"); assert.equal(ext.soul.team, null);
  assert.ok(!remote.calls.some(([fn, ref]) => fn === "observeRemote" && ref === R.experts), "external must not consult the default branch");
  assert.ok(remote.calls.some(([fn, ref, commit]) => fn === "readRemoteFile" && ref === R.experts && commit === C.experts));

  // problems: collected, not thrown
  const codes = d.problems.map((p) => [p.code, p.repoKey, p.path]);
  assert.ok(codes.some(([c, k, p]) => c === "E_TEAM_UNKNOWN" && k === K.data && p === "souls/growth-hacker/soul.yaml#/team"), JSON.stringify(codes));
  assert.ok(codes.some(([c, k, p]) => c === "E_TEAM_UNKNOWN" && k === K.data && p === "capabilities/nw-secret/oats.json#/team"));
  assert.ok(codes.some(([c, k, p]) => c === "E_WORKSPACE_SCHEMA" && k === K.data && p === "souls/broken/soul.yaml#/name"));
  assert.ok(codes.some(([c, k, p]) => c === "E_WORKSPACE_SCHEMA" && k === K.data && p === "souls/broken/soul.yaml#/work"));
  const legacy = d.problems.find((p) => p.path === "souls/legacy/soul.yaml#/schemaVersion");
  assert.match(legacy.message, /schemaVersion 2 only; found 1/);
  assert.ok(codes.some(([c, k, p]) => c === "E_WORKSPACE_SCHEMA" && k === K.data && p.startsWith("capabilities/nw-garbage/oats.json#")));
  assert.ok(!d.problems.some((p) => p.code === "E_MEMBERSHIP_UNCONFIRMED"), "unconfirmed members are rows, not problems");
  for (const p of d.problems) { assert.equal(typeof p.code, "string"); assert.equal(typeof p.path, "string"); assert.equal(typeof p.message, "string"); }
});

test("discoverWorkspace: an unreadable or missing external is a problem, not a throw", async () => {
  const remote = northwind({ workspace: workspaceFile({ external: [
    { source: `${R.experts}@${C.experts}`, soul: "souls/nobody" },
    { source: `${R.vault}@${C.vault}`, soul: "souls/x" },
  ] }) });
  const d = await discoverWorkspace(WS, { remote });
  assert.equal(d.external.length, 0);
  assert.ok(d.problems.some((p) => p.code === "E_REMOTE_PATH_MISSING" && p.path === "external/0:souls/nobody/soul.yaml"));
  assert.ok(d.problems.some((p) => p.code === "E_REMOTE_UNREADABLE" && p.path.startsWith("external/1:")));
});

test("discoverWorkspace: a membership default team not in teams is E_TEAM_UNKNOWN; a broken workspace file throws", async () => {
  const remote = northwind({ mutate: (repos) => { repos[K.platform].files["oats-membership.yaml"].team = "skunkworks"; } });
  const d = await discoverWorkspace(WS, { remote });
  const row = d.members.find((m) => m.key === K.platform);
  assert.equal(row.confirmed, true); assert.equal(row.team, "skunkworks");
  assert.ok(d.problems.some((p) => p.code === "E_TEAM_UNKNOWN" && p.repoKey === K.platform && p.path === "oats-membership.yaml#/team"));
  const bad = northwind({ workspace: workspaceFile({ members: [`${R.platform}@v1`] }) });
  await assert.rejects(discoverWorkspace(WS, { remote: bad }), (e) => e.code === "E_WORKSPACE_SCHEMA" && e.details.problems[0].path === "/members/0");
});

/* ───────────────────────────── standalone ─────────────────────────────── */

test("standaloneRepo: from:here only; other froms become problems; workspace defaults absent", async () => {
  const remote = northwind({ mutate: (repos) => { repos[K.agents].unreadable = true; } });
  await assert.rejects(observeWorkspace(WS, { remote }), (e) => e.code === "E_REMOTE_UNREADABLE");
  const repo = await discoverRepo(R.data, { remote });
  assert.equal(repo.key, K.data); assert.equal(repo.commit, C.data); assert.equal(repo.membership.team, "engineering");
  const s = standaloneRepo(R.data, C.data, repo, { remote });
  assert.equal(s.standalone, true); assert.equal(s.workspace, null); assert.deepEqual(s.external, []);
  assert.equal(s.members.length, 1);
  const row = s.members[0];
  assert.equal(row.key, K.data); assert.equal(row.confirmed, false); assert.equal(row.reason, "cannot-read"); assert.equal(row.team, "engineering");
  const analyst = row.souls.find((x) => x.name === "data-analyst");
  assert.deepEqual(analyst.capabilities, { "nw-warehouse-access": { from: "here" } });
  assert.ok(row.capabilities.some((c) => c.name === "nw-warehouse-access"));
  const codes = s.problems.map((p) => [p.code, p.path]);
  assert.ok(codes.some(([c, p]) => c === "E_NOT_A_MEMBER" && p === "souls/data-analyst/soul.yaml#/capabilities/nw-house-style"), JSON.stringify(codes));
  assert.ok(codes.some(([c, p]) => c === "E_PACKAGE_MISSING" && p === "souls/data-analyst/soul.yaml#/capabilities/oats.core"));
  // no workspace teams to check against standalone → the unknown label is not a problem here
  assert.ok(!s.problems.some((p) => p.code === "E_TEAM_UNKNOWN"));
  // also accepts a full discovery as input, and refuses a mismatched commit
  const full = await discoverWorkspace(WS, { remote: northwind() });
  assert.equal(standaloneRepo(R.data, C.data, full, { remote }).members[0].souls.length, 2);
  assert.throws(() => standaloneRepo(R.data, OID("0"), repo, { remote }), (e) => e.code === "E_MEMBERSHIP_UNCONFIRMED");
  assert.throws(() => standaloneRepo(R.data, C.data, undefined, { remote }), (e) => e.code === "E_MEMBERSHIP_UNCONFIRMED");
});

/* ───────────────────────────── loadLocal ──────────────────────────────── */

test("loadLocal walks up to oats-local.yaml, validates it, and E_LOCAL_MISSING names the search", () => {
  const root = mkdtempSync(join(tmpdir(), "oats-local-"));
  try {
    const deep = join(root, "platform", "src", "deep");
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(root, "oats-local.yaml"), YAML.stringify({ schemaVersion: 2, workspace: WS, clones: { [K.platform]: join(root, "platform") }, settings: { "oats.okf": { "state-dir": join(root, ".oats") } }, souls: { disabled: ["data-analyst"] } }));
    const found = loadLocal(deep);
    assert.equal(found.path, join(root, "oats-local.yaml"));
    assert.equal(found.local.workspace, WS);
    assert.deepEqual(found.local.souls.disabled, ["data-analyst"]);
    assert.equal(found.local.settings["oats.okf"]["state-dir"], join(root, ".oats"));

    const isolated = mkdtempSync(join(tmpdir(), "oats-nolocal-"));
    try {
      assert.throws(() => loadLocal(join(isolated, "nowhere")), (e) => {
        assert.equal(e.code, "E_LOCAL_MISSING");
        assert.ok(e.details.searched.includes(join(isolated, "nowhere", "oats-local.yaml")));
        return true;
      });
    } finally { rmSync(isolated, { recursive: true, force: true }); }

    writeFileSync(join(root, "oats-local.yaml"), "schemaVersion: 1\nworkspace: x\n");
    assert.throws(() => loadLocal(deep), (e) => e.code === "E_WORKSPACE_SCHEMA" && e.details.path === join(root, "oats-local.yaml") && e.details.problems.some((p) => p.path === "/schemaVersion"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

/* ───────────────────────────── adversarial review regressions ─────────── */

test("HIGH: a listed-but-unconfirmed repo can never abort discovery — an oversize/unsafe membership file is an unconfirmed row", async () => {
  const oversize = detailed("E_REMOTE_FILE_OVERSIZE", "oats-membership.yaml is 5242880 bytes (budget 4194304)", { path: "oats-membership.yaml", size: 5242880, budget: 4194304 });
  const remote = northwind({ mutate: (repos) => { repos[K.billing].faults = { read: { "oats-membership.yaml": oversize } }; } });
  const d = await discoverWorkspace(WS, { remote });
  const row = d.members.find((m) => m.key === K.billing);
  assert.equal(row.confirmed, false); assert.equal(row.reason, "no-backlink"); assert.match(row.detail, /oversize|bytes/);
  assert.equal(d.members.find((m) => m.key === K.platform).confirmed, true, "the other members are still discovered");
  const ws = await observeWorkspace(WS, { remote });
  const symlinked = detailed("E_REMOTE_TREE_UNSAFE", "oats-membership.yaml is a symlink", { path: "oats-membership.yaml", why: "symlink" });
  remote.calls.length = 0;
  const r2 = northwind({ mutate: (repos) => { repos[K.platform].faults = { read: { "oats-membership.yaml": symlinked } }; } });
  const row2 = await confirmMembership(ws, R.platform, { remote: r2 });
  assert.equal(row2.reason, "no-backlink"); assert.equal(row2.cause, "E_REMOTE_TREE_UNSAFE");
});

test("MED: a listing failure inside ONE confirmed member is a problem of that member, not an abort", async () => {
  const net = detailed("E_REMOTE_UNREADABLE", "cannot read (network)", { url: "x", reason: "network" });
  const remote = northwind({ mutate: (repos) => { repos[K.platform].faults = { list: { capabilities: net } }; } });
  const d = await discoverWorkspace(WS, { remote });
  const platform = d.members.find((m) => m.key === K.platform);
  assert.equal(platform.confirmed, true);
  assert.deepEqual(platform.souls.map((x) => x.name).sort(), ["platform-engineer", "platform-reviewer"], "souls listed before the failing dir");
  assert.deepEqual(platform.capabilities, []);
  assert.ok(d.problems.some((p) => p.code === "E_REMOTE_UNREADABLE" && p.repoKey === K.platform && p.path === "capabilities"));
  assert.ok(d.members.find((m) => m.key === K.data).souls.length > 0, "later members still enumerated");
});

test("MED: validateWorkspace catches duplicates/bad refs by default (no remote needed) and validates packages: values", () => {
  const dup = validateWorkspace(workspaceFile({ members: ["git:github.com/org/repo", "https://github.com/org/repo.git"] }));
  assert.ok(dup.some((p) => p.path === "/members/1" && /duplicates member 0/.test(p.message)));
  const okPkgs = validateWorkspace(workspaceFile({ packages: { "oats.okf": "v2.1.3", "nw.tools": "git:github.com/northwind/nw-tools@v0.4.0", "loc.pkg": "git:/abs/bare.git@v1", "f.pkg": "git:file:///abs/x.git@v1" } }));
  assert.deepEqual(okPkgs, []);
  for (const [value, re] of [["git:nonsense@v1", /not a repo ref/], ["git:github.com/a/b", /no @<ref>/], ["git:@v1", /git:<repo>@<ref>/], ["git@github.com:a/b.git@v1", /git:<repo>@<ref>/], ["main", /neither a version/], ["https://github.com/a/b@v1", /git:<repo>@<ref>/]]) {
    const problems = validateWorkspace(workspaceFile({ packages: { "oats.okf": value } })).filter((p) => p.path === "/packages/oats.okf");
    assert.ok(problems.length, `refused ${value}`);
    assert.ok(problems.some((p) => re.test(p.message) || /does not match/.test(p.message)), `${value}: ${JSON.stringify(problems)}`);
  }
});

test("MED: capability manifests use the capabilityName grammar (no `/` or `..`), need a version, and duplicate names in one repo are problems", async () => {
  const remote = northwind({ mutate: (repos) => {
    repos[K.platform].files["capabilities/x/oats.json"] = { capability: "x/../../etc", version: "1" };
    repos[K.platform].files["capabilities/y/oats.json"] = { capability: "oats.core/sub", version: "1" };
    repos[K.platform].files["capabilities/z/oats.json"] = { capability: "z" };
    repos[K.platform].files["capabilities/dup1/oats.json"] = manifest("nw-experimental-linter");
    repos[K.platform].files["souls/imposter/soul.yaml"] = soul("platform-engineer");
  } });
  const d = await discoverWorkspace(WS, { remote });
  const platform = d.members.find((m) => m.key === K.platform);
  assert.deepEqual(platform.capabilities.map((c) => c.name), ["nw-experimental-linter"]);
  assert.equal(platform.capabilities[0].path, "capabilities/nw-experimental-linter", "first declaration wins, deterministic");
  assert.deepEqual(platform.souls.map((x) => x.name).sort(), ["platform-engineer", "platform-reviewer"]);
  const paths = d.problems.filter((p) => p.repoKey === K.platform).map((p) => p.path);
  for (const want of ["capabilities/x/oats.json#/capability", "capabilities/y/oats.json#/capability", "capabilities/z/oats.json#", "capabilities/dup1/oats.json#/capability", "souls/imposter/soul.yaml#/name"]) {
    assert.ok(paths.some((p) => p.startsWith(want)), `${want} in ${JSON.stringify(paths)}`);
  }
});

test("MED: non-collapse — a member's oats-package/ is reported as publishes and its capabilities are NOT member capabilities", async () => {
  const remote = northwind({ mutate: (repos) => {
    repos[K.data].files["oats-package/oats-package.json"] = { package: "nw.data", version: "0.9.1", capabilities: ["capabilities/nw-etl"] };
    repos[K.data].files["oats-package/capabilities/nw-etl/oats.json"] = manifest("nw-etl");
    repos[K.platform].files["oats-package/oats-package.json"] = "{ not json";
  } });
  const d = await discoverWorkspace(WS, { remote });
  const data = d.members.find((m) => m.key === K.data);
  assert.deepEqual(data.publishes, { package: "nw.data", version: "0.9.1" });
  assert.ok(!data.capabilities.some((c) => c.name === "nw-etl"), "package capabilities are not member capabilities");
  assert.equal(d.members.find((m) => m.key === K.agents).publishes, null);
  assert.equal(d.members.find((m) => m.key === K.billing).publishes, null, "unconfirmed rows carry publishes: null");
  assert.equal(d.members.find((m) => m.key === K.platform).publishes, null);
  assert.ok(d.problems.some((p) => p.repoKey === K.platform && p.path.startsWith("oats-package/oats-package.json#")), "a broken package manifest is a problem, not a throw");
});

test("LOW: confirmMembership never throws for an unparseable memberRef; a case-only backlink mismatch says so in detail", async () => {
  const remote = northwind({ mutate: (repos) => { repos[K.fork].files["oats-membership.yaml"] = { schemaVersion: 2, workspace: "git:github.com/Northwind/Agents" }; } });
  const ws = await observeWorkspace(WS, { remote });
  const bad = await confirmMembership(ws, "not a ref", { remote });
  assert.equal(bad.confirmed, false); assert.equal(bad.reason, "not-listed"); assert.match(bad.detail, /not a repo ref/);
  const fork = await confirmMembership(ws, R.fork, { remote });
  assert.equal(fork.reason, "backlink-elsewhere"); assert.equal(fork.caseOnly, true); assert.match(fork.detail, /letter case/);
});

/* ───────────────────────────── integration: real remote + Northwind fixture ─ */

test("integration: real lib/remote.mjs over the Northwind fixture — nw-tools publishes nw.tools, its package caps are not member caps, and packages resolve the git:<abs path>@v0.4.0 form", { timeout: 180_000 }, async () => {
  const { buildNorthwind } = await import("./fixtures/northwind/build.mjs");
  const { resolvePackages, packageProviding, executablesDigest, readPackageTree } = await import("../lib/packages.mjs");
  const remote = await import("../lib/remote.mjs");
  const base = mkdtempSync(join(tmpdir(), "oats-ws-int-"));
  try {
    const fx = await buildNorthwind(base);
    const remoteOptions = { cacheDir: join(base, "cache") };
    const d = await discoverWorkspace(fx.refs.agents, { remoteOptions });
    assert.ok(existsSync(join(base, "cache")), "remoteOptions.cacheDir reaches the real remote (nothing under ~/.cache from this test)");
    assert.deepEqual(d.problems, []);
    assert.equal(d.members.length, 5);
    const rows = Object.fromEntries(d.members.map((m) => [m.key, m]));
    const tools = rows[fx.keys["nw-tools"]];
    assert.equal(tools.confirmed, true); assert.equal(tools.team, "engineering"); assert.equal(tools.commit, fx.commits["nw-tools"]);
    assert.deepEqual(tools.publishes, { package: "nw.tools", version: "0.4.0" });
    assert.deepEqual(tools.capabilities.map((c) => c.name), ["nw-tools-dev"], "oats-package/capabilities/* are NOT member capabilities");
    assert.deepEqual(tools.souls.map((s) => s.name), ["tools-expert"]);
    for (const k of ["agents", "platform", "data", "marketing"]) assert.equal(rows[fx.keys[k]].publishes, null);

    // packages: bare versions through the catalog + the direct git ref to a local bare repo
    const { lock, changes } = await resolvePackages(d.workspace, { catalog: fx.catalog, remoteOptions });
    assert.deepEqual(Object.keys(lock.packages), ["nw.tools", "oats.framework", "oats.okf"]);
    const nw = lock.packages["nw.tools"];
    assert.equal(nw.source, `git:${fx.keys["nw-tools"]}@v0.4.0`);
    assert.equal(nw.version, "0.4.0"); assert.equal(nw.commit, fx.commits["nw-tools"]);
    assert.deepEqual(nw.capabilities, ["nw-deploy", "nw-lint"]);
    assert.match(nw.integrity, /^sha256-[0-9a-f]{64}$/);
    assert.equal(changes.length, 3);
    assert.equal(packageProviding(lock, "nw-deploy").id, "nw.tools");
    assert.equal(packageProviding(lock, "nw-tools-dev"), null, "member capabilities are never provided by the lock");
    const digest = executablesDigest(await readPackageTree(remote, fx.refs["nw-tools"], nw.commit, "oats-package", { remoteOptions }));
    assert.match(digest, /^sha256-/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
