// lib/resolve.mjs — from a soul to an immutable resolution (module contract §3).
// Runs against an in-memory discovery shaped like lib/workspace.mjs#discoverWorkspace output,
// an in-memory lock v3, and a fake contract-§1 remote (real parseRepoRef) — no git, no network.
import test from "node:test";
import assert from "node:assert/strict";
import { oatsError } from "../lib/errors.mjs";
import { parseRepoRef } from "../lib/remote.mjs";
import { standaloneRepo } from "../lib/workspace.mjs";
import {
  canonicalJson, composeCapabilities, manifestDefaultsPayload, mergePayload, parseVersion, payloadOrigins, refForKey, resolveSoul, revisionOf,
  satisfiesRange, skillsInListing,
} from "../lib/resolve.mjs";
// The teams-contract exports are reached through the namespace so this file also loads against a
// resolver that predates them (the single-label pin below was checked against main's resolver).
import * as resolveLib from "../lib/resolve.mjs";

/* ───────────────────────────── identities ─────────────────────────────── */

const OID = (seed) => seed.repeat(40).slice(0, 40);
const DIGEST = (seed) => `sha256-${seed.repeat(64).slice(0, 64)}`;
const R = {
  agents: "git:github.com/northwind/agents",
  platform: "git:github.com/northwind/platform",
  data: "git:github.com/northwind/data",
  marketing: "git:github.com/northwind/marketing",
  billing: "git:github.com/northwind/billing",   // listed, no backlink
  tools: "git:github.com/northwind/nw-tools",    // member AND package publisher (nw.tools)
  okf: "git:github.com/awebai/oats-okf",         // catalog package repo
  framework: "git:github.com/awebai/oats",       // catalog package repo
  experts: "git:github.com/oss-collective/experts",
  stranger: "git:github.com/acme/stranger",
};
const K = Object.fromEntries(Object.entries(R).map(([n, ref]) => [n, parseRepoRef(ref).key]));
const C = { agents: OID("a"), platform: OID("b"), data: OID("c"), marketing: OID("d"), billing: OID("e"), tools: OID("f"), okf: OID("1"), framework: OID("2"), toolsPkg: OID("3"), experts: OID("9") };

const detailed = (code, message, details) => { const e = oatsError(code, message, details); e.details = details; return e; };

/* ───────────────────────────── fake remote (contract §1) ──────────────── */

/** repos: { <key>: { <commit>: { <path>: string|object } } } — object values are JSON-encoded. */
function fakeRemote(repos) {
  const calls = [];
  const treeOf = (ref, commit) => {
    const { key, url } = parseRepoRef(ref);
    const repo = repos[key];
    if (!repo) throw detailed("E_REMOTE_UNREADABLE", `cannot read ${url}`, { url, reason: "not-found" });
    const tree = repo[commit];
    if (!tree) throw detailed("E_REMOTE_UNREADABLE", `unknown commit ${commit} in ${url}`, { url, reason: "not-found" });
    return tree;
  };
  const encode = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n");
  return {
    calls,
    parseRepoRef,
    async observeRemote(ref, { at } = {}) {
      calls.push(["observeRemote", ref, at]);
      const { key, url } = parseRepoRef(ref);
      const commit = Object.keys(repos[key] || {})[0];
      if (!commit) throw detailed("E_REMOTE_UNREADABLE", `cannot read ${url}`, { url, reason: "not-found" });
      return { key, url, commit, ref: null, observedAt: "2026-09-23T10:00:00.000Z" };
    },
    async readRemoteFile(ref, commit, path) {
      calls.push(["readRemoteFile", ref, commit, path]);
      const tree = treeOf(ref, commit);
      if (!Object.hasOwn(tree, path)) throw detailed("E_REMOTE_PATH_MISSING", `${path} is not in ${ref}@${commit}`, { path });
      const bytes = encode(tree[path]);
      return { bytes, size: bytes.length };
    },
    async listRemoteTree(ref, commit, dir, { depth = 2 } = {}) {
      calls.push(["listRemoteTree", ref, commit, dir]);
      const tree = treeOf(ref, commit);
      const out = [];
      const seenDirs = new Set();
      for (const path of Object.keys(tree)) {
        if (!path.startsWith(`${dir}/`)) continue;
        const rel = path.slice(dir.length + 1);
        const parts = rel.split("/");
        if (parts.length <= depth) out.push({ path: rel, type: "blob", size: encode(tree[path]).length });
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

const skillDoc = (name) => `---\nname: ${name}\ndescription: ${name} skill\n---\n\n${name}\n`;
const soulDef = (name, extra = {}) => ({ schemaVersion: 2, name, description: `${name} soul`, work: "directory", capabilities: {}, ...extra });
const manifest = (capability, extra = {}) => ({ capability, version: "0.0.0-workspace", description: `${capability} capability`, ...extra });

const M = {
  releaseTooling: manifest("nw-release-tooling", { team: "engineering", skills: ["skills/cut-release"], inject: "injects/release-policy.md", commands: { cut: "bin/nw-release.mjs cut" } }),
  houseStyle: manifest("nw-house-style", { inject: "injects/house-style.md" }),
  secrets: manifest("nw-secrets", { private: true, skills: ["skills/rotate-secrets"] }),
  warehouse: manifest("nw-warehouse-access", { team: "engineering", skills: ["skills/query-warehouse"], commands: { query: "bin/nw-wh.mjs query" } }),
  brandVoice: manifest("nw-brand-voice", { team: "marketing", inject: "injects/brand-voice.md", skills: ["skills/tone-check"] }),
  toolsDev: manifest("nw-tools-dev", { team: "engineering", skills: ["skills/package-conventions"], inject: "injects/nw-tools-dev.md" }),
  altOkf: manifest("nw-notes", { layer: "knowledge", skills: ["skills/notes"] }),
  chat: manifest("nw-chat", { layer: "messaging", skills: ["skills/chat"] }),
  // Package-tier manifests (read over the remote from oats-package/)
  core: manifest("oats.core", { version: "1.1.3", skills: ["skills/oats-operate"], inject: "injects/oats.md" }),
  okf: manifest("oats.okf", { version: "2.1.3", layer: "knowledge", skills: ["skills/okf"], inject: "injects/okf.md", commands: { validate: "bin/okf.mjs validate" } }),
  lint: manifest("nw-lint", { version: "0.4.0", skills: ["skills/lint"], commands: { lint: "bin/nw-lint.mjs" } }),
  deploy: manifest("nw-deploy", { version: "0.4.0", skills: ["skills/deploy"], commands: { deploy: "bin/nw-deploy.mjs" } }),
};

/** Remote trees: member capability dirs (skills only need to exist) + package repos. */
function remoteRepos() {
  return {
    [K.agents]: { [C.agents]: {
      "capabilities/nw-chat/oats.json": M.chat,
      "capabilities/nw-chat/skills/chat/SKILL.md": skillDoc("chat"),
      "capabilities/nw-release-tooling/oats.json": M.releaseTooling,
      "capabilities/nw-release-tooling/skills/cut-release/SKILL.md": skillDoc("cut-release"),
      "capabilities/nw-release-tooling/injects/release-policy.md": "## Release policy\n",
      "capabilities/nw-house-style/oats.json": M.houseStyle,
      "capabilities/nw-house-style/injects/house-style.md": "## House style\n",
      "capabilities/nw-secrets/oats.json": M.secrets,
      "capabilities/nw-secrets/skills/rotate-secrets/SKILL.md": skillDoc("rotate-secrets"),
      "capabilities/nw-notes/oats.json": M.altOkf,
      "capabilities/nw-notes/skills/notes/SKILL.md": skillDoc("notes"),
    } },
    [K.data]: { [C.data]: {
      "capabilities/nw-warehouse-access/oats.json": M.warehouse,
      "capabilities/nw-warehouse-access/skills/query-warehouse/SKILL.md": skillDoc("query-warehouse"),
    } },
    [K.marketing]: { [C.marketing]: {
      "capabilities/nw-brand-voice/oats.json": M.brandVoice,
      "capabilities/nw-brand-voice/skills/tone-check/SKILL.md": skillDoc("tone-check"),
      "capabilities/nw-brand-voice/injects/brand-voice.md": "## Brand voice\n",
    } },
    [K.tools]: {
      [C.tools]: {
        "capabilities/nw-tools-dev/oats.json": M.toolsDev,
        "capabilities/nw-tools-dev/skills/package-conventions/SKILL.md": skillDoc("package-conventions"),
        "capabilities/nw-tools-dev/injects/nw-tools-dev.md": "## nw-tools dev\n",
      },
      [C.toolsPkg]: {
        "oats-package/oats-package.json": { package: "nw.tools", version: "0.4.0", capabilities: ["capabilities/nw-lint", "capabilities/nw-deploy"] },
        "oats-package/capabilities/nw-lint/oats.json": M.lint,
        "oats-package/capabilities/nw-lint/skills/lint/SKILL.md": skillDoc("lint"),
        "oats-package/capabilities/nw-lint/bin/nw-lint.mjs": "#!/usr/bin/env node\n",
        "oats-package/capabilities/nw-deploy/oats.json": M.deploy,
        "oats-package/capabilities/nw-deploy/skills/deploy/SKILL.md": skillDoc("deploy"),
        "oats-package/capabilities/nw-deploy/bin/nw-deploy.mjs": "#!/usr/bin/env node\n",
      },
    },
    [K.okf]: { [C.okf]: {
      "oats-package/oats-package.json": { package: "oats.okf", version: "2.1.3", capabilities: ["capabilities/oats-okf"] },
      "oats-package/capabilities/oats-okf/oats.json": M.okf,
      "oats-package/capabilities/oats-okf/skills/okf/SKILL.md": skillDoc("okf"),
      "oats-package/capabilities/oats-okf/injects/okf.md": "## OKF\n",
      "oats-package/capabilities/oats-okf/bin/okf.mjs": "#!/usr/bin/env node\n",
    } },
    [K.framework]: { [C.framework]: {
      "oats-package/oats-package.json": { package: "oats.framework", version: "1.1.3", capabilities: ["capabilities/oats-core"] },
      "oats-package/capabilities/oats-core/oats.json": M.core,
      "oats-package/capabilities/oats-core/skills/oats-operate/SKILL.md": skillDoc("oats-operate"),
      "oats-package/capabilities/oats-core/injects/oats.md": "## You run on OATS\n",
    } },
  };
}

const catalog = {
  "oats.okf": { url: R.okf, ref: "v2.1.3", path: "oats-package" },
  "oats.framework": { url: R.framework, ref: "oats-framework/v1.1.3", path: "oats-package" },
};

/** In-memory lock v3 (contract §4 shape; no approval record — declaring a package is the trust decision). */
function lockV3({ packages = {} } = {}) {
  return {
    lockfileVersion: 3,
    packages: {
      "nw.tools": { source: `git:${K.tools}@v0.4.0`, path: "oats-package", version: "0.4.0", commit: C.toolsPkg, integrity: DIGEST("3"), capabilities: ["nw-deploy", "nw-lint"] },
      "oats.framework": { source: "catalog:oats.framework", path: "oats-package", version: "1.1.3", commit: C.framework, integrity: DIGEST("2"), capabilities: ["oats.core"] },
      "oats.okf": { source: "catalog:oats.okf", path: "oats-package", version: "2.1.3", commit: C.okf, integrity: DIGEST("1"), capabilities: ["oats.okf"] },
      ...packages,
    },
  };
}

function workspaceFile(overrides = {}) {
  return {
    schemaVersion: 2,
    name: "northwind",
    members: [R.agents, R.platform, R.data, R.marketing, R.billing, R.tools],
    packages: { "oats.framework": "v1.1.3", "oats.okf": "v2.1.3", "nw.tools": `git:${K.tools}@v0.4.0` },
    teams: { global: { description: "Org-wide" }, engineering: { description: "Platform + data" }, marketing: { description: "Campaigns" } },
    defaults: {
      capabilities: { "oats.core": { from: "package" }, "nw-house-style": { from: K.agents } },
      knowledge: { "oats.okf": { from: "package" } },
      messaging: "none",
      tasks: "none",
      byTeam: {
        engineering: { capabilities: { "nw-release-tooling": { from: K.agents } } },
        marketing: { capabilities: { "nw-brand-voice": { from: K.marketing } } },
      },
    },
    stores: { org: "git:github.com/northwind/knowledge" },
    messaging: { private: "per-human", channels: ["northwind-eng", "northwind-mkt"] },
    external: [{ source: `${R.experts}@${C.experts}`, soul: "souls/security-reviewer" }],
    ...overrides,
  };
}

const soulEntry = (repoKey, commit, team, definition, path = `souls/${definition.name}`) => ({ name: definition.name, path, repoKey, commit, team, private: definition.private === true, definition });
const capEntry = (repoKey, commit, m, team = m.team ?? null) => ({ name: m.capability, path: `capabilities/${m.capability}`, repoKey, commit, team, private: m.private === true, manifest: m });

/** discoverWorkspace(...)-shaped picture. `souls` lets a test add/replace soul definitions in agents. */
function discovery({ workspace = workspaceFile(), souls = {}, agentsCaps = null } = {}) {
  const agentsSouls = {
    "release-manager": soulDef("release-manager", { work: "worktree", team: "engineering", capabilities: { "nw-release-tooling": { from: "here" }, "nw-deploy": { from: "package" } }, knowledge: { owns: "release-manager", reads: ["platform-engineer"] }, messaging: { channels: ["northwind-eng"] } }),
    "support-triager": soulDef("support-triager", { capabilities: { "nw-house-style": "off" }, knowledge: "none" }),
    ...souls,
  };
  const row = (key, commit, team, soulsList, caps, publishes = null) => ({ key, commit, confirmed: true, team, souls: soulsList, capabilities: caps, publishes });
  return {
    workspace, key: K.agents, url: parseRepoRef(R.agents).url, commit: C.agents, observedAt: "2026-09-23T10:00:00.000Z", local: null,
    members: [
      row(K.agents, C.agents, "global",
        Object.values(agentsSouls).map((d) => soulEntry(K.agents, C.agents, d.team ?? "global", d)),
        agentsCaps ?? [capEntry(K.agents, C.agents, M.releaseTooling), capEntry(K.agents, C.agents, M.houseStyle, "global"), capEntry(K.agents, C.agents, M.secrets, "global"), capEntry(K.agents, C.agents, M.chat, "global"), capEntry(K.agents, C.agents, M.altOkf, "global")]),
      row(K.platform, C.platform, "engineering", [soulEntry(K.platform, C.platform, "engineering", soulDef("platform-engineer", { team: "engineering" }))], []),
      row(K.data, C.data, "engineering", [soulEntry(K.data, C.data, "engineering", soulDef("data-analyst", { capabilities: { "nw-warehouse-access": { from: "here" } } }))], [capEntry(K.data, C.data, M.warehouse)]),
      row(K.marketing, C.marketing, "marketing", [soulEntry(K.marketing, C.marketing, "marketing", soulDef("campaign-writer", { capabilities: { "nw-brand-voice": { from: "here" } } }))], [capEntry(K.marketing, C.marketing, M.brandVoice)]),
      { key: K.billing, commit: null, confirmed: false, reason: "no-backlink", detail: `${K.billing} has no oats-membership.yaml`, team: null, souls: [], capabilities: [], publishes: null },
      row(K.tools, C.tools, "engineering", [soulEntry(K.tools, C.tools, "engineering", soulDef("tools-expert", { capabilities: { "nw-tools-dev": { from: "here" } } }))], [capEntry(K.tools, C.tools, M.toolsDev)], { package: "nw.tools", version: "0.4.0" }),
    ],
    external: [{ source: `${R.experts}@${C.experts}`, key: K.experts, commit: C.experts, soul: soulEntry(K.experts, C.experts, null, soulDef("security-reviewer", { capabilities: {} })) }],
    problems: [],
  };
}
const findSoul = (d, name) => d.members.flatMap((m) => m.souls).find((s) => s.name === name) || d.external.find((e) => e.soul.name === name)?.soul;

const rejectsCode = async (promise, code, check) => {
  const err = await promise.then(() => null, (e) => e);
  assert.ok(err, `expected ${code}, resolved instead`);
  assert.equal(err.code, code, `expected ${code}, got ${err.code}: ${err.message}`);
  assert.ok(err.details, `${code} carries details`);
  assert.deepEqual(err.provenance, err.details, "details are attached as both e.provenance and e.details");
  if (check) check(err);
  return err;
};

const opts = (extra = {}) => ({ lock: lockV3(), catalog, remote: fakeRemote(remoteRepos()), ...extra });

/* ───────────────────────────── happy path ─────────────────────────────── */

test("happy path: release-manager = workspace defaults ⊕ engineering team default ⊕ soul (here + package), slots filled", async () => {
  const d = discovery();
  const r = await resolveSoul(d, findSoul(d, "release-manager"), opts());
  assert.equal(r.resolutionApi, 1);
  assert.deepEqual(r.soul, { name: "release-manager", repoKey: K.agents, commit: C.agents, team: "engineering", path: "souls/release-manager" });
  assert.deepEqual(r.modules.map((m) => m.name), ["nw-deploy", "nw-house-style", "nw-release-tooling", "oats.core", "oats.okf"], "sorted by name");
  const byName = Object.fromEntries(r.modules.map((m) => [m.name, m]));
  // member modules: latest commit of the confirmed member
  assert.deepEqual(byName["nw-release-tooling"].from, { kind: "member", repoKey: K.agents, commit: C.agents });
  assert.deepEqual(byName["nw-house-style"].from, { kind: "member", repoKey: K.agents, commit: C.agents });
  assert.equal(byName["nw-release-tooling"].dir, "capabilities/nw-release-tooling");
  // package modules: locked commit + integrity, version from the lock
  assert.deepEqual(byName["oats.okf"].from, { kind: "package", package: "oats.okf", version: "2.1.3", commit: C.okf, integrity: DIGEST("1"), repoKey: K.okf });
  assert.deepEqual(byName["nw-deploy"].from, { kind: "package", package: "nw.tools", version: "0.4.0", commit: C.toolsPkg, integrity: DIGEST("3"), repoKey: K.tools });
  assert.equal(byName["nw-deploy"].dir, "oats-package/capabilities/nw-deploy");
  assert.equal(byName["oats.core"].from.package, "oats.framework");
  // layers + slots
  assert.equal(byName["oats.okf"].layer, "knowledge");
  assert.equal(byName["nw-release-tooling"].layer, null);
  assert.deepEqual(r.slots, { knowledge: "oats.okf", messaging: null, tasks: null });
  for (const m of r.modules) { assert.equal(typeof m.private, "boolean"); assert.deepEqual(m.manifest.capability, m.name); }
  // skills (module, name, path relative to the capability dir) and injects
  assert.deepEqual(r.skills, [
    { module: "nw-deploy", name: "deploy", path: "skills/deploy" },
    { module: "nw-release-tooling", name: "cut-release", path: "skills/cut-release" },
    { module: "oats.core", name: "oats-operate", path: "skills/oats-operate" },
    { module: "oats.okf", name: "okf", path: "skills/okf" },
  ]);
  assert.deepEqual(r.injects, [
    { module: "nw-house-style", path: "injects/house-style.md" },
    { module: "nw-release-tooling", path: "injects/release-policy.md" },
    { module: "oats.core", path: "injects/oats.md" },
    { module: "oats.okf", path: "injects/okf.md" },
  ]);
  // payloads: the knowledge slot module carries the soul's knowledge payload; others are empty objects
  assert.deepEqual(r.payloads["oats.okf"], { owns: "release-manager", reads: ["platform-engineer"] });
  assert.deepEqual(r.payloads["nw-release-tooling"], {});
  assert.deepEqual(Object.keys(r.payloads).sort(), Object.keys(byName).sort(), "one payload per module");
  // revision = hash(declRevision, payloadRevision) (L6): declarations and payload fingerprinted apart, bound together
  assert.match(r.revision, /^[0-9a-f]{24}$/);
  assert.equal(r.declRevision, revisionOf({ resolutionApi: 1, soul: r.soul, modules: r.modules, slots: r.slots, skills: r.skills, injects: r.injects }));
  assert.equal(r.payloadRevision, revisionOf(r.payloads));
  assert.equal(r.revision, revisionOf({ declRevision: r.declRevision, payloadRevision: r.payloadRevision }));
  // immutable + JSON-serializable
  assert.ok(Object.isFrozen(r) && Object.isFrozen(r.modules) && Object.isFrozen(r.modules[0].manifest));
  assert.throws(() => { r.modules.push({}); }, TypeError);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
});

test("`off` removes a workspace default; `none` empties the slot instead of the default filling it", async () => {
  const d = discovery();
  const r = await resolveSoul(d, findSoul(d, "support-triager"), opts());
  assert.deepEqual(r.modules.map((m) => m.name), ["oats.core"], "nw-house-style is off, knowledge none → no oats.okf");
  assert.deepEqual(r.slots, { knowledge: null, messaging: null, tasks: null });
  assert.equal(r.soul.team, "global", "the repo's default team applies");
});

test("team defaults: marketing byTeam adds nw-brand-voice; engineering byTeam does not leak to marketing", async () => {
  const d = discovery();
  const r = await resolveSoul(d, findSoul(d, "campaign-writer"), opts());
  assert.deepEqual(r.modules.map((m) => m.name), ["nw-brand-voice", "nw-house-style", "oats.core", "oats.okf"]);
  assert.equal(r.modules.find((m) => m.name === "nw-brand-voice").from.repoKey, K.marketing);
  assert.ok(!r.modules.some((m) => m.name === "nw-release-tooling"));
});

test("a soul may add a team default of another team explicitly and override a default's `from`", async () => {
  const d = discovery({ souls: { "release-manager": soulDef("release-manager", { team: "engineering", capabilities: { "nw-brand-voice": { from: K.marketing }, "nw-warehouse-access": { from: K.data } } }) } });
  const r = await resolveSoul(d, findSoul(d, "release-manager"), opts());
  assert.deepEqual(r.modules.map((m) => m.name), ["nw-brand-voice", "nw-house-style", "nw-release-tooling", "nw-warehouse-access", "oats.core", "oats.okf"]);
});

test("from:here resolves to the soul's own repo (data-analyst → northwind/data)", async () => {
  const d = discovery();
  const r = await resolveSoul(d, findSoul(d, "data-analyst"), opts());
  const wh = r.modules.find((m) => m.name === "nw-warehouse-access");
  assert.deepEqual(wh.from, { kind: "member", repoKey: K.data, commit: C.data });
  assert.deepEqual(r.skills.filter((s) => s.module === "nw-warehouse-access"), [{ module: "nw-warehouse-access", name: "query-warehouse", path: "skills/query-warehouse" }]);
});

test("composeCapabilities: order and `off` semantics, soul wins", () => {
  const ws = workspaceFile();
  const rows = composeCapabilities(ws, { capabilities: { "nw-release-tooling": { from: "here" }, "oats.core": "off" } }, { team: "engineering" });
  assert.deepEqual(rows, [
    { name: "nw-house-style", from: K.agents, via: "defaults.capabilities" },
    { name: "nw-release-tooling", from: "here", via: "soul" },
    { name: "oats.okf", from: "package", via: "defaults.knowledge" },
  ]);
  // byTeam `off` removes a workspace default for every soul of the team
  const ws2 = workspaceFile({ defaults: { ...ws.defaults, byTeam: { engineering: { capabilities: { "nw-house-style": "off" } } } } });
  assert.deepEqual(composeCapabilities(ws2, { capabilities: {} }, { team: "engineering" }).map((r) => r.name), ["oats.core", "oats.okf"]);
  // no workspace (standalone) → only the soul's own
  assert.deepEqual(composeCapabilities(null, { capabilities: { x: { from: "here" } } }).map((r) => r.name), ["x"]);
});

/* ───────────────────────────── private ────────────────────────────────── */

test("private capability: allowed from its own repo, refused from another member (E_CAPABILITY_PRIVATE)", async () => {
  const d = discovery({ souls: { keeper: soulDef("keeper", { capabilities: { "nw-secrets": { from: "here" } } }) } });
  const r = await resolveSoul(d, findSoul(d, "keeper"), opts());
  const s = r.modules.find((m) => m.name === "nw-secrets");
  assert.equal(s.private, true);
  assert.deepEqual(s.from, { kind: "member", repoKey: K.agents, commit: C.agents });

  const d2 = discovery();
  d2.members[2].souls[0].definition.capabilities["nw-secrets"] = { from: K.agents }; // data-analyst asks for agents' private cap
  await rejectsCode(resolveSoul(d2, findSoul(d2, "data-analyst"), opts()), "E_CAPABILITY_PRIVATE", (e) => {
    assert.equal(e.details.capability, "nw-secrets");
    assert.equal(e.details.owner, K.agents);
    assert.equal(e.details.soulRepo, K.data);
  });
});

/* ───────────────────────────── membership ─────────────────────────────── */

test("from:<repo> requires a CONFIRMED member: not listed and unconfirmed → E_NOT_A_MEMBER", async () => {
  const d = discovery({ souls: { s1: soulDef("s1", { capabilities: { x: { from: K.stranger } } }), s2: soulDef("s2", { capabilities: { x: { from: K.billing } } }) } });
  await rejectsCode(resolveSoul(d, findSoul(d, "s1"), opts()), "E_NOT_A_MEMBER", (e) => { assert.equal(e.details.repoKey, K.stranger); assert.equal(e.details.reason, "not-listed"); });
  await rejectsCode(resolveSoul(d, findSoul(d, "s2"), opts()), "E_NOT_A_MEMBER", (e) => { assert.equal(e.details.repoKey, K.billing); assert.equal(e.details.reason, "no-backlink"); });
});

test("an external soul's from:here is E_NOT_A_MEMBER (a stranger's repo is never a member)", async () => {
  const d = discovery();
  d.external[0].soul.definition.capabilities = { "threat-model": { from: "here" } };
  await rejectsCode(resolveSoul(d, findSoul(d, "security-reviewer"), opts()), "E_NOT_A_MEMBER", (e) => assert.equal(e.details.repoKey, K.experts));
  // and with no capability of its own it resolves to the workspace defaults only
  d.external[0].soul.definition.capabilities = {};
  const r = await resolveSoul(d, findSoul(d, "security-reviewer"), opts());
  assert.deepEqual(r.modules.map((m) => m.name), ["nw-house-style", "oats.core", "oats.okf"]);
  assert.equal(r.soul.repoKey, K.experts);
});

test("E_CAPABILITY_MISSING when a confirmed member has no such capability", async () => {
  const d = discovery({ souls: { s: soulDef("s", { capabilities: { "nw-nothing": { from: K.platform } } }) } });
  await rejectsCode(resolveSoul(d, findSoul(d, "s"), opts()), "E_CAPABILITY_MISSING", (e) => {
    assert.equal(e.details.capability, "nw-nothing");
    assert.equal(e.details.repoKey, K.platform);
    assert.equal(e.details.hint, undefined, "no package hint when nothing provides it");
  });
});

/* ───────────────────────────── non-collapse ───────────────────────────── */

test("non-collapse: from:<repo> never reaches inside the repo's package — E_CAPABILITY_MISSING with details.hint", async () => {
  const d = discovery({ souls: { s: soulDef("s", { capabilities: { "nw-lint": { from: K.tools } } }) } });
  await rejectsCode(resolveSoul(d, findSoul(d, "s"), opts()), "E_CAPABILITY_MISSING", (e) => {
    assert.equal(e.details.capability, "nw-lint");
    assert.equal(e.details.repoKey, K.tools);
    assert.equal(e.details.hint, "provided by package nw.tools; use from: package");
  });
  // even with no lock, the publisher row alone yields a package-tier hint
  await rejectsCode(resolveSoul(d, findSoul(d, "s"), opts({ lock: null })), "E_CAPABILITY_MISSING", (e) => assert.match(e.details.hint, /publishes package nw\.tools/));
});

test("non-collapse: from:package never reaches member capabilities, even when the package's repo is a member", async () => {
  // nw-tools-dev is a MEMBER capability of the nw-tools repo (a package publisher). from: package must not find it.
  const d = discovery({ souls: { s: soulDef("s", { capabilities: { "nw-tools-dev": { from: "package" } } }) } });
  await rejectsCode(resolveSoul(d, findSoul(d, "s"), opts()), "E_PACKAGE_MISSING", (e) => {
    assert.equal(e.details.capability, "nw-tools-dev");
    assert.deepEqual(e.details.locked, ["nw.tools", "oats.framework", "oats.okf"]);
  });
  // and the member tier still serves it the right way
  const d2 = discovery({ souls: { s: soulDef("s", { capabilities: { "nw-tools-dev": { from: K.tools } } }) } });
  const r = await resolveSoul(d2, findSoul(d2, "s"), opts());
  assert.deepEqual(r.modules.find((m) => m.name === "nw-tools-dev").from, { kind: "member", repoKey: K.tools, commit: C.tools });
});

test("from:package with a member capability of the same name elsewhere resolves ONLY through the lock", async () => {
  // Member `agents` carries nw-notes (layer knowledge); from: package for it is E_PACKAGE_MISSING, not a fallback.
  const d = discovery({ souls: { s: soulDef("s", { knowledge: "none", capabilities: { "nw-notes": { from: "package" } } }) } });
  await rejectsCode(resolveSoul(d, findSoul(d, "s"), opts()), "E_PACKAGE_MISSING");
});

/* ───────────────────────────── packages ───────────────────────────────── */

test("E_PACKAGE_MISSING without a lock, and ambiguous providers fail closed", async () => {
  const d = discovery();
  await rejectsCode(resolveSoul(d, findSoul(d, "release-manager"), opts({ lock: null })), "E_PACKAGE_MISSING", (e) => assert.equal(e.details.reason, "no-lock"));
  const lock = lockV3({ packages: { "nw.other": { source: "git:github.com/x/y@v1.0.0", path: "oats-package", version: "1.0.0", commit: OID("7"), integrity: DIGEST("7"), capabilities: ["nw-deploy"] } } });
  await rejectsCode(resolveSoul(d, findSoul(d, "release-manager"), opts({ lock })), "E_PACKAGE_MISSING", (e) => assert.deepEqual(e.details.ambiguous, ["nw.other", "nw.tools"]));
});

test("a catalog-sourced lock entry needs the catalog to say which repo it lives in", async () => {
  const d = discovery();
  await rejectsCode(resolveSoul(d, findSoul(d, "support-triager"), opts({ catalog: null })), "E_PACKAGE_MISSING", (e) => assert.equal(e.details.reason, "no-catalog"));
});

test("a lock whose capability list differs from the package tree's is E_PACKAGE_INTEGRITY why:capabilities (extra or missing)", async () => {
  const d = discovery({ souls: { s: soulDef("s", { capabilities: { "nw-ghost": { from: "package" } } }) } });
  const lock = lockV3();
  lock.packages["nw.tools"].capabilities = ["nw-deploy", "nw-ghost", "nw-lint"];
  await rejectsCode(resolveSoul(d, findSoul(d, "s"), opts({ lock })), "E_PACKAGE_INTEGRITY", (e) => {
    assert.equal(e.details.id, "nw.tools");
    assert.equal(e.details.why, "capabilities");
    assert.deepEqual(e.details.listed, ["nw-deploy", "nw-lint"]);
    assert.deepEqual(e.details.locked, ["nw-deploy", "nw-ghost", "nw-lint"]);
  });
  // a lock listing FEWER capabilities than the tree declares is refused the same way
  const d2 = discovery();
  const drifted = lockV3(); drifted.packages["nw.tools"].capabilities = ["nw-deploy"];
  await rejectsCode(resolveSoul(d2, findSoul(d2, "release-manager"), opts({ lock: drifted })), "E_PACKAGE_INTEGRITY", (e) => {
    assert.equal(e.details.why, "capabilities"); assert.deepEqual(e.details.listed, ["nw-deploy", "nw-lint"]); assert.deepEqual(e.details.locked, ["nw-deploy"]);
    assert.match(e.message, /the lock says package nw\.tools v0\.4\.0 provides \[nw-deploy\], but .*declares \[nw-deploy, nw-lint\]/);
  });
});

/* ───────────────────────────── slots ──────────────────────────────────── */

test("E_SLOT_CONFLICT: two modules with layer knowledge; names both modules", async () => {
  const d = discovery({ souls: { s: soulDef("s", { capabilities: { "nw-notes": { from: K.agents } } }) } });
  await rejectsCode(resolveSoul(d, findSoul(d, "s"), opts()), "E_SLOT_CONFLICT", (e) => {
    assert.equal(e.details.slot, "knowledge");
    assert.deepEqual([...e.details.modules].sort(), ["nw-notes", "oats.okf"]);
  });
});

test("`none` empties a slot; a soul naming another knowledge capability with `none` on the slot is a conflict", async () => {
  const d = discovery({ souls: { s: soulDef("s", { knowledge: "none", capabilities: { "nw-notes": { from: K.agents } } }) } });
  await rejectsCode(resolveSoul(d, findSoul(d, "s"), opts()), "E_SLOT_CONFLICT", (e) => assert.equal(e.details.reason, "none"));
  // replacing the default with another provider (no `none`) fills the slot with the soul's choice
  const ws = workspaceFile({ defaults: { ...workspaceFile().defaults, knowledge: "none" } });
  const d2 = discovery({ workspace: ws, souls: { s: soulDef("s", { capabilities: { "nw-notes": { from: K.agents } } }) } });
  const r = await resolveSoul(d2, findSoul(d2, "s"), opts());
  assert.deepEqual(r.slots, { knowledge: "nw-notes", messaging: null, tasks: null });
});

/* ───────────────────────────── skills ─────────────────────────────────── */

test("E_SKILL_DUPLICATE names both modules", async () => {
  const repos = remoteRepos();
  // give nw-warehouse-access a second skill dir named like nw-release-tooling's
  repos[K.data][C.data]["capabilities/nw-warehouse-access/skills/cut-release/SKILL.md"] = skillDoc("cut-release");
  const d = discovery({ souls: { s: soulDef("s", { team: "engineering", capabilities: { "nw-warehouse-access": { from: K.data } } }) } });
  d.members[2].capabilities[0].manifest = { ...M.warehouse, skills: ["skills/query-warehouse", "skills/cut-release"] };
  await rejectsCode(resolveSoul(d, findSoul(d, "s"), opts({ remote: fakeRemote(repos) })), "E_SKILL_DUPLICATE", (e) => {
    assert.equal(e.details.name, "cut-release");
    assert.deepEqual([...e.details.modules].sort(), ["nw-release-tooling", "nw-warehouse-access"]);
  });
});

test("a skills[] entry may be a directory OF skills; a declared entry without SKILL.md is E_CAPABILITY_MISSING", async () => {
  const repos = remoteRepos();
  repos[K.data][C.data]["capabilities/nw-warehouse-access/skills/query-warehouse/SKILL.md"] = skillDoc("query-warehouse");
  repos[K.data][C.data]["capabilities/nw-warehouse-access/skills/explain-plan/SKILL.md"] = skillDoc("explain-plan");
  const d = discovery({ souls: { s: soulDef("s", { capabilities: { "nw-warehouse-access": { from: K.data } } }) } });
  d.members[2].capabilities[0].manifest = { ...M.warehouse, skills: ["skills"] };
  const r = await resolveSoul(d, findSoul(d, "s"), opts({ remote: fakeRemote(repos) }));
  assert.deepEqual(r.skills.filter((s) => s.module === "nw-warehouse-access"), [
    { module: "nw-warehouse-access", name: "explain-plan", path: "skills/explain-plan" },
    { module: "nw-warehouse-access", name: "query-warehouse", path: "skills/query-warehouse" },
  ]);
  d.members[2].capabilities[0].manifest = { ...M.warehouse, skills: ["skills/missing"] };
  await rejectsCode(resolveSoul(d, findSoul(d, "s"), opts({ remote: fakeRemote(repos) })), "E_CAPABILITY_MISSING", (e) => { assert.equal(e.details.why, "skill-missing"); assert.equal(e.details.skill, "skills/missing"); });
  d.members[2].capabilities[0].manifest = { ...M.warehouse, skills: ["../escape"] };
  await rejectsCode(resolveSoul(d, findSoul(d, "s"), opts({ remote: fakeRemote(repos) })), "E_CAPABILITY_MISSING", (e) => assert.equal(e.details.why, "unsafe"));
});

test("a discovery-provided capability listing is used instead of listing the remote", async () => {
  const remote = fakeRemote(remoteRepos());
  const d = discovery();
  const rt = d.members[0].capabilities.find((c) => c.name === "nw-release-tooling");
  rt.listing = [{ path: "skills", type: "tree" }, { path: "skills/cut-release", type: "tree" }, { path: "skills/cut-release/SKILL.md", type: "blob" }, { path: "oats.json", type: "blob" }];
  const r = await resolveSoul(d, findSoul(d, "release-manager"), opts({ remote }));
  assert.ok(r.skills.some((s) => s.module === "nw-release-tooling" && s.name === "cut-release"));
  assert.ok(!remote.calls.some((c) => c[0] === "listRemoteTree" && c[3].startsWith("capabilities/nw-release-tooling")), "no remote listing for the pre-listed capability");
  assert.ok(remote.calls.some((c) => c[0] === "listRemoteTree" && c[3].startsWith("capabilities/nw-house-style") === false), "other modules still listed");
});

test("skillsInListing: entry IS a skill vs entry holds skills", () => {
  assert.deepEqual(skillsInListing("skills/x", [{ path: "SKILL.md", type: "blob" }]), [{ name: "x", path: "skills/x" }]);
  assert.deepEqual(skillsInListing("skills", [{ path: "b/SKILL.md", type: "blob" }, { path: "a/SKILL.md", type: "blob" }, { path: "a", type: "tree" }, { path: "c/README.md", type: "blob" }]), [{ name: "a", path: "skills/a" }, { name: "b", path: "skills/b" }]);
  assert.deepEqual(skillsInListing("skills", []), []);
});

/* ───────────────────────────── payloads ───────────────────────────────── */

test("payload merge order: workspace.messaging ⊕ soul ⊕ local.settings ⊕ spawn.providers (the retained-seat case)", async () => {
  const ws = workspaceFile({ defaults: { ...workspaceFile().defaults, messaging: { "oats.aweb": { from: "package" } } } });
  const repos = remoteRepos();
  repos[K.okf][C.okf]["oats-package/oats-package.json"] = { package: "oats.okf", version: "2.1.3", capabilities: ["capabilities/oats-okf", "capabilities/oats-aweb"] };
  repos[K.okf][C.okf]["oats-package/capabilities/oats-aweb/oats.json"] = manifest("oats.aweb", { version: "2.1.3", layer: "messaging" });
  const lock = lockV3();
  lock.packages["oats.okf"].capabilities = ["oats.aweb", "oats.okf"];
  const d = discovery({ workspace: ws });
  const local = { schemaVersion: 2, workspace: R.agents, settings: { "oats.aweb": { stateRoot: "/Users/bo/.aweb", identity: { mode: "fresh", team: "hosted" } }, "oats.okf": { storeRoot: "/Users/bo/kb" }, "unknown-cap": { x: 1 } } };
  const base = opts({ lock, remote: fakeRemote(repos), local });
  const r1 = await resolveSoul(d, findSoul(d, "release-manager"), base);
  assert.deepEqual(r1.payloads["oats.aweb"], { private: "per-human", channels: ["northwind-eng"], stateRoot: "/Users/bo/.aweb", identity: { mode: "fresh", team: "hosted" } }, "soul array replaces the workspace array; local adds keys");
  assert.deepEqual(r1.payloads["oats.okf"], { owns: "release-manager", reads: ["platform-engineer"], storeRoot: "/Users/bo/kb" });
  assert.ok(!("unknown-cap" in r1.payloads), "settings for a capability the soul does not resolve are ignored");
  // the retained seat: exactly one spawn takes it
  const r2 = await resolveSoul(d, findSoul(d, "release-manager"), { ...base, spawn: { providers: { "oats.aweb": { identity: { mode: "retained", seat: "release-manager@northwind" } } } } });
  assert.deepEqual(r2.payloads["oats.aweb"], { private: "per-human", channels: ["northwind-eng"], stateRoot: "/Users/bo/.aweb", identity: { mode: "retained", seat: "release-manager@northwind", team: "hosted" } }, "spawn deep-merges over local and soul; scalars later-wins");
  assert.equal(r2.slots.messaging, "oats.aweb");
  assert.notEqual(r1.revision, r2.revision, "the instance-level payload is part of the revision");
  // a provider for a capability the soul does not resolve is refused
  await rejectsCode(resolveSoul(d, findSoul(d, "release-manager"), { ...base, spawn: { providers: { "nw-nothing": { a: 1 } } } }), "E_CAPABILITY_MISSING", (e) => assert.equal(e.details.capability, "nw-nothing"));
});

test("manifest setting defaults are a payload layer; payloadOrigins names the last layer that set each leaf (addendum 5)", () => {
  const manifest = { settings: { identity: { default: { mode: "local" } }, tone: { description: "no default" }, retries: { default: 0 }, "a/b": { default: "x" } } };
  const defaults = manifestDefaultsPayload(manifest);
  assert.deepEqual(defaults, { identity: { mode: "local" }, retries: 0, "a/b": "x" }, "only declared defaults, falsy ones included");
  assert.deepEqual(manifestDefaultsPayload({}), {});
  const D = { kind: "manifest-default" }, S = { kind: "soul" }, H = { kind: "host" }, P = { kind: "spawn" };
  // An object layer merges per leaf: the default keeps the leaves nobody overrode.
  assert.deepEqual(payloadOrigins([{ payload: defaults, origin: D }, { payload: { identity: { resident: "r" } }, origin: S }]),
    { "/identity/mode": D, "/identity/resident": S, "/retries": D, "/a~1b": D });
  // A scalar replaces the whole subtree, taking its leaves' origins with it; a later object starts afresh.
  assert.deepEqual(payloadOrigins([{ payload: { identity: { mode: "local" } }, origin: D }, { payload: { identity: "flat" }, origin: H }]), { "/identity": H });
  assert.deepEqual(payloadOrigins([{ payload: { identity: "flat" }, origin: H }, { payload: { identity: { mode: "global" } }, origin: P }]), { "/identity/mode": P });
});

test("mergePayload: deep-merge objects, later wins on scalars and arrays, inputs untouched", () => {
  const a = { x: 1, o: { p: 1, q: [1, 2] }, arr: [1] };
  const b = { x: 2, o: { q: [3] }, arr: [9, 9] };
  assert.deepEqual(mergePayload(a, b), { x: 2, o: { p: 1, q: [3] }, arr: [9, 9] });
  assert.deepEqual(a, { x: 1, o: { p: 1, q: [1, 2] }, arr: [1] });
  assert.deepEqual(mergePayload(undefined, null, { k: "v" }), { k: "v" });
  assert.deepEqual(mergePayload(), {});
  assert.throws(() => mergePayload("nope"), TypeError);
});

/* ───────────────────────────── revision ───────────────────────────────── */

test("revision: same input → same revision; any change → a different one", async () => {
  const d = discovery();
  const a = await resolveSoul(d, findSoul(d, "release-manager"), opts());
  const b = await resolveSoul(discovery(), findSoul(discovery(), "release-manager"), opts());
  assert.equal(a.revision, b.revision, "deterministic across fresh inputs");
  assert.notEqual(a, b);
  // remote call order or key order must not matter: shuffle discovery member order + lock key order
  const d3 = discovery(); d3.members.reverse();
  const lock3 = lockV3(); lock3.packages = Object.fromEntries(Object.entries(lock3.packages).reverse());
  assert.equal((await resolveSoul(d3, findSoul(d3, "release-manager"), opts({ lock: lock3 }))).revision, a.revision);
  const seen = new Set([a.revision]);
  const distinct = async (label, dd, o = opts()) => {
    const r = await resolveSoul(dd, findSoul(dd, "release-manager"), o);
    assert.ok(!seen.has(r.revision), `${label} changes the revision`);
    seen.add(r.revision);
  };
  // the member moved
  const moved = discovery(); moved.members[0].commit = OID("b"); for (const c of moved.members[0].capabilities) c.commit = OID("b"); for (const s of moved.members[0].souls) s.commit = OID("b");
  const movedRepos = remoteRepos(); movedRepos[K.agents][OID("b")] = movedRepos[K.agents][C.agents];
  await distinct("member commit", moved, opts({ remote: fakeRemote(movedRepos) }));
  // a package bumped
  const bumped = lockV3(); bumped.packages["nw.tools"].version = "0.5.0";
  await distinct("package version", discovery(), opts({ lock: bumped }));
  // a manifest changed
  const mf = discovery(); mf.members[0].capabilities[0].manifest = { ...M.releaseTooling, description: "changed" };
  await distinct("manifest", mf);
  // a payload changed
  await distinct("local settings", discovery(), opts({ local: { schemaVersion: 2, workspace: R.agents, settings: { "oats.okf": { storeRoot: "/x" } } } }));
  // a default removed
  const off = discovery({ souls: { "release-manager": { ...discovery().members[0].souls[0].definition, capabilities: { "nw-release-tooling": { from: "here" }, "nw-deploy": { from: "package" }, "nw-house-style": "off" } } } });
  await distinct("capability off", off);
});

test("canonicalJson sorts keys recursively; revisionOf is 24 hex chars", () => {
  assert.equal(canonicalJson({ b: [1, { z: 1, a: 2 }], a: null, u: undefined }), '{"a":null,"b":[1,{"a":2,"z":1}],"u":null}');
  assert.equal(revisionOf({ a: 1, b: 2 }), revisionOf({ b: 2, a: 1 }));
  assert.match(revisionOf({}), /^[0-9a-f]{24}$/);
});

/* ───────────────────────────── compatibility ──────────────────────────── */

test("compatibility floors: pass, fail (E_COMPATIBILITY), and floors on member modules are not enforced", async () => {
  const pass = discovery({ souls: { s: soulDef("s", { capabilities: { "nw-deploy": { from: "package" } }, compatibility: { "oats.okf": ">=2.1.0", "nw-deploy": "^0.4.0", "oats.core": "~1.1.0" } }) } });
  const r = await resolveSoul(pass, findSoul(pass, "s"), opts());
  assert.equal(r.modules.find((m) => m.name === "nw-deploy").from.version, "0.4.0");

  const failSoul = discovery({ souls: { s: soulDef("s", { compatibility: { "oats.okf": ">=2.2.0" } }) } });
  await rejectsCode(resolveSoul(failSoul, findSoul(failSoul, "s"), opts()), "E_COMPATIBILITY", (e) => {
    assert.equal(e.details.capability, "oats.okf");
    assert.equal(e.details.package, "oats.okf");
    assert.equal(e.details.version, "2.1.3");
    assert.equal(e.details.range, ">=2.2.0");
  });
  const caret = discovery({ souls: { s: soulDef("s", { compatibility: { "oats.core": "^2.0.0" } }) } });
  await rejectsCode(resolveSoul(caret, findSoul(caret, "s"), opts()), "E_COMPATIBILITY");

  // member capabilities carry "0.0.0-workspace": a floor naming one is informational, never enforced
  const member = discovery({ souls: { s: soulDef("s", { compatibility: { "nw-house-style": ">=1.0.0" } }) } });
  await resolveSoul(member, findSoul(member, "s"), opts());

  const bad = discovery({ souls: { s: soulDef("s", { compatibility: { "oats.okf": "banana" } }) } });
  await rejectsCode(resolveSoul(bad, findSoul(bad, "s"), opts()), "E_COMPATIBILITY", (e) => assert.equal(e.details.why, "range"));
});

test("a capability's own kernel range (manifest compatibility.oats) must admit the running kernel: E_CAPABILITY_INCOMPATIBLE for package and member capabilities", async () => {
  const pkgKernel = JSON.parse((await import("node:fs")).readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  assert.equal(resolveLib.KERNEL_VERSION, pkgKernel, "the running kernel is this package's version");
  const d = discovery({ souls: { s: soulDef("s") } });
  const withRange = async (m, range, fn) => { const had = Object.hasOwn(m, "compatibility"), was = m.compatibility; m.compatibility = { oats: range };
    try { return await fn(); } finally { if (had) m.compatibility = was; else delete m.compatibility; } };
  // A package capability (oats.okf, a workspace default) whose floor no kernel meets.
  await withRange(M.okf, ">=99.0.0", () => rejectsCode(resolveSoul(d, findSoul(d, "s"), opts()), "E_CAPABILITY_INCOMPATIBLE", (e) => {
    assert.deepEqual([e.details.capability, e.details.range, e.details.kernel, e.details.from.kind, e.details.from.package], ["oats.okf", ">=99.0.0", pkgKernel, "package", "oats.okf"]);
    assert.match(e.message, /oats\.okf requires oats >=99\.0\.0; this kernel is .*pin a release of oats\.okf/);
  }));
  // A member capability is held to its range too.
  await withRange(M.houseStyle, ">=99.0.0", () => rejectsCode(resolveSoul(d, findSoul(d, "s"), opts()), "E_CAPABILITY_INCOMPATIBLE", (e) => {
    assert.deepEqual([e.details.capability, e.details.from.kind], ["nw-house-style", "member"]);
    assert.match(e.message, /update nw-house-style in /);
  }));
  // The kernel is the running one unless given: a range admits exactly the kernels it names.
  await withRange(M.okf, ">=0.26.0", async () => {
    const r = await resolveSoul(d, findSoul(d, "s"), opts({ kernel: "0.26.0" }));
    assert.ok(r.modules.some((m) => m.name === "oats.okf"));
    await rejectsCode(resolveSoul(d, findSoul(d, "s"), opts({ kernel: "0.25.9" })), "E_CAPABILITY_INCOMPATIBLE");
    await rejectsCode(resolveSoul(d, findSoul(d, "s"), opts({ kernel: "0.26.0-rc.1" })), "E_CAPABILITY_INCOMPATIBLE", undefined, "a prerelease is below its release");
  });
  await withRange(M.okf, "^0.25.0", () => rejectsCode(resolveSoul(d, findSoul(d, "s"), opts({ kernel: "1.0.0" })), "E_CAPABILITY_INCOMPATIBLE"));
  // An unparseable range is refused, typed, with why: "range".
  await withRange(M.okf, "banana", () => rejectsCode(resolveSoul(d, findSoul(d, "s"), opts({ kernel: "0.26.0" })), "E_CAPABILITY_INCOMPATIBLE", (e) => assert.equal(e.details.why, "range")));
  // No range: always compatible.
  assert.deepEqual(resolveLib.kernelCompatibility({ capability: "x" }, "0.26.0"), { ok: true, range: null, kernel: "0.26.0" });
  assert.deepEqual(resolveLib.kernelCompatibility({ capability: "x", compatibility: { oats: ">=0.25.0" } }, "0.26.0"), { ok: true, range: ">=0.25.0", kernel: "0.26.0" });
});

test("satisfiesRange: >=, ^, ~, exact, partial, *, AND, ||, prereleases (no dependency)", () => {
  const cases = [
    ["2.1.3", ">=2.1.0", true], ["2.1.3", ">=2.2.0", false], ["2.1.3", ">2.1.3", false], ["2.1.3", "<=2.1.3", true], ["2.1.3", "<2.1.3", false],
    ["2.1.3", "^2.0.0", true], ["3.0.0", "^2.0.0", false], ["0.4.0", "^0.4.0", true], ["0.5.0", "^0.4.0", false], ["0.0.3", "^0.0.3", true], ["0.0.4", "^0.0.3", false],
    ["2.1.3", "~2.1.0", true], ["2.2.0", "~2.1.0", false], ["0.4.9", "~0.4", true],
    ["2.1.3", "2.1.3", true], ["2.1.3", "=2.1.3", true], ["2.1.3", "2.1.4", false], ["2.1.3", "2.1", true], ["2.1.3", "2", true], ["3.0.0", "2", false],
    ["2.1.3", "*", true], ["2.1.3", "", true], ["2.1.3", ">=1 <3", true], ["3.1.0", ">=1 <3", false], ["1.0.0", "0.9.0 || >=1.0.0", true],
    ["v2.1.3", ">=2.1.3", true], ["1.0.0-rc.1", ">=1.0.0", false], ["1.0.0", ">=1.0.0-rc.1", true], ["1.0.0-rc.2", ">=1.0.0-rc.1", true], ["1.0.0-beta", ">=1.0.0-alpha", true],
  ];
  for (const [v, r, expected] of cases) assert.equal(satisfiesRange(v, r), expected, `${v} ${JSON.stringify(r)}`);
  assert.throws(() => satisfiesRange("1.0.0", ">=x.y"), (e) => e.code === "E_COMPATIBILITY" && e.details.why === "range");
  assert.throws(() => satisfiesRange("1.2.3.4", ">=1"), (e) => e.code === "E_COMPATIBILITY" && e.details.why === "version");
  assert.throws(() => satisfiesRange("not-a-version", ">=1"), (e) => e.code === "E_COMPATIBILITY" && e.details.why === "version");
  assert.deepEqual(parseVersion("v1.2.3-rc.1+build.5"), { major: 1, minor: 2, patch: 3, prerelease: ["rc", 1] });
  assert.equal(parseVersion("1.2.3.4"), null);
});

/* ───────────────────────────── standalone + misc ──────────────────────── */

test("standalone discovery: from:here resolves against the soul's own repo; defaults do not apply", async () => {
  // standaloneRepo(...) output for northwind/data whose workspace cannot be read
  const enumeration = { key: K.data, commit: C.data, membership: { schemaVersion: 2, workspace: R.agents, team: "engineering" }, souls: [soulEntry(K.data, C.data, "engineering", soulDef("data-analyst", { capabilities: { "nw-warehouse-access": { from: "here" }, "nw-house-style": { from: K.agents } } }))], capabilities: [capEntry(K.data, C.data, M.warehouse)], publishes: null, problems: [] };
  const sd = standaloneRepo(R.data, C.data, enumeration);
  assert.equal(sd.standalone, true);
  const r = await resolveSoul(sd, sd.members[0].souls[0], opts());
  assert.deepEqual(r.modules.map((m) => m.name), ["nw-warehouse-access", "oats.core"], "no workspace defaults except the kernel's own (decision 25); the unresolvable from:<other> is dropped by standaloneRepo as a problem");
  assert.equal(r.modules.find((m) => m.name === "oats.core").from.kind, "package", "oats.core comes from the operator's lock, standalone too");
  assert.equal(r.slots.knowledge, null);
});

test("decision 25: standalone `oats.core: off` opts out; standalone without a lock is E_PACKAGE_UNLOCKED, not a silent hollow spawn", async () => {
  const off = { key: K.data, commit: C.data, membership: null, souls: [soulEntry(K.data, C.data, null, soulDef("lone", { capabilities: { "oats.core": "off", "nw-warehouse-access": { from: "here" } } }))], capabilities: [capEntry(K.data, C.data, M.warehouse)], problems: [] };
  const sd = standaloneRepo(R.data, C.data, off);
  const r = await resolveSoul(sd, sd.members[0].souls[0], opts());
  assert.deepEqual(r.modules.map((m) => m.name), ["nw-warehouse-access"]);
  const on = { ...off, souls: [soulEntry(K.data, C.data, null, soulDef("lone", { capabilities: { "nw-warehouse-access": { from: "here" } } }))] };
  const sd2 = standaloneRepo(R.data, C.data, on);
  const err = await resolveSoul(sd2, sd2.members[0].souls[0], opts({ lock: null })).then(() => null, (e) => e);
  assert.ok(err && /^E_PACKAGE_/.test(err.code), `a missing lock refuses with a package error, got ${err?.code}`);
});

test("decision 23 + teams amendment K: byTeam is stripped and NEVER merged into the provider's settings (the primary's included); each label's base ⊕ byTeam[label] is only in teams[].payload; a host team still reaches settings", async () => {
  const ws = workspaceFile();
  ws.teams = { ...ws.teams, cloud: { description: "hosted" } };
  ws.defaults = { ...ws.defaults, messaging: { "nw-chat": { from: K.agents } } };
  ws.messaging = { private: "per-human", byTeam: { engineering: { team: "aweb:example.oss", channels: ["eng"] }, cloud: { team: "aweb:example.cloud" } } };
  const d = discovery({ workspace: ws, souls: { hosted: soulDef("hosted", { team: "cloud" }), untagged: soulDef("untagged", {}) } });
  const rm = await resolveSoul(d, findSoul(d, "release-manager"), opts());
  // base ⊕ the soul's own messaging payload: the mapped primary (engineering) contributes NOTHING to settings…
  assert.deepEqual(rm.payloads["nw-chat"], { private: "per-human", channels: ["northwind-eng"] });
  assert.equal(Object.values(rm.payloadOrigins["nw-chat"]).some((o) => o.kind === "workspace-team"), false, "no byTeam origin row");
  // …its payload is the eligible team's, beside the settings.
  assert.deepEqual(rm.teams[0], { label: "engineering", team: "aweb:example.oss", mapped: true, payload: { private: "per-human", team: "aweb:example.oss", channels: ["eng"] } });
  const hosted = await resolveSoul(d, findSoul(d, "hosted"), opts());
  assert.deepEqual(hosted.payloads["nw-chat"], { private: "per-human" }, "the mapped cloud team is not in settings");
  assert.equal(hosted.teams[0].payload.team, "aweb:example.cloud");
  const plain = await resolveSoul(d, findSoul(d, "untagged"), opts());
  assert.deepEqual(plain.payloads["nw-chat"], { private: "per-human" }, "no team → base only");
  for (const r of [rm, hosted, plain]) assert.equal("byTeam" in r.payloads["nw-chat"], false);
  // The personal team a HOST sets still reaches settings.team (→ OATS_TEAM_ID), whatever the label maps.
  const personal = await resolveSoul(d, findSoul(d, "hosted"), opts({ local: { schemaVersion: 2, settings: { "nw-chat": { team: "aweb:me.personal" } } } }));
  assert.equal(personal.payloads["nw-chat"].team, "aweb:me.personal");
  assert.equal(personal.payloadOrigins["nw-chat"]["/team"].kind, "host");
  assert.equal(personal.teams[0].payload.team, "aweb:example.cloud", "the label's own payload is untouched");
  // A byTeam entry is still validated where it would be delivered: a nested byTeam is refused.
  const bad = structuredClone(ws); bad.messaging.byTeam.cloud = { team: "aweb:x", byTeam: {} };
  const d2 = discovery({ workspace: bad, souls: { hosted: soulDef("hosted", { team: "cloud" }) } });
  await rejectsCode(resolveSoul(d2, findSoul(d2, "hosted"), opts()), "E_WORKSPACE_SCHEMA");
});

test("refForKey round-trips hosted and local keys through parseRepoRef", () => {
  assert.equal(parseRepoRef(refForKey(K.agents)).key, K.agents);
  const local = parseRepoRef("/tmp/oats-fixture/remotes/agents.git");
  assert.equal(parseRepoRef(refForKey(local.key)).key, local.key);
  assert.throws(() => refForKey(""), (e) => e.code === "E_REPO_REF");
});

test("input validation: soulEntry shape and spawn type", async () => {
  await assert.rejects(resolveSoul(discovery(), { name: "x" }, opts()), TypeError);
  await assert.rejects(resolveSoul(discovery(), findSoul(discovery(), "release-manager"), opts({ spawn: "nope" })), TypeError);
  await assert.rejects(resolveSoul(discovery(), findSoul(discovery(), "release-manager"), opts({ remote: {} })), TypeError);
});

/* ───────────────────────────── Phase B regressions (adversarial review) ── */

test("HIGH: a `__proto__` payload key (yaml/JSON produce it as an own key) is refused at every payload source, not merged into the prototype", async () => {
  const poison = (inner) => JSON.parse(`{"oats.okf":{"__proto__":${JSON.stringify(inner)}}}`);
  const d = discovery();
  // in-memory helper
  assert.throws(() => mergePayload({ a: 1 }, JSON.parse('{"__proto__":{"evil":1}}')), (e) => e.code === "E_WORKSPACE_SCHEMA" && e.details.reason === "poison-key");
  assert.throws(() => mergePayload({ a: { b: 1 } }, JSON.parse('{"a":{"constructor":{"x":1}}}')), (e) => e.code === "E_WORKSPACE_SCHEMA" && e.details.path === "/a/constructor");
  // spawn --provider
  await rejectsCode(resolveSoul(d, findSoul(d, "release-manager"), opts({ spawn: { providers: poison({ owns: "HIJACKED" }) } })), "E_WORKSPACE_SCHEMA", (e) => assert.equal(e.details.key, "__proto__"));
  // oats-local.yaml settings
  await rejectsCode(resolveSoul(d, findSoul(d, "release-manager"), opts({ local: { settings: poison({ storeRoot: "/evil" }) } })), "E_WORKSPACE_SCHEMA");
  // soul-level slot payload
  const d2 = discovery({ souls: { s: soulDef("s", { knowledge: JSON.parse('{"__proto__":{"owns":"x"}}') }) } });
  await rejectsCode(resolveSoul(d2, findSoul(d2, "s"), opts()), "E_WORKSPACE_SCHEMA");
  // a clean resolution's payload has the ordinary prototype and no hidden properties
  const r = await resolveSoul(d, findSoul(d, "release-manager"), opts());
  assert.equal(Object.getPrototypeOf(r.payloads["oats.okf"]), Object.prototype);
  assert.equal(({}).polluted, undefined);
});

test("MED: the soul must be one discovery listed — unconfirmed member → E_MEMBERSHIP_UNCONFIRMED; unknown repo → E_NOT_A_MEMBER; stale entry → stale", async () => {
  const d = discovery();
  const rogue = soulEntry(K.billing, null, null, soulDef("rogue"));
  await rejectsCode(resolveSoul(d, rogue, opts()), "E_MEMBERSHIP_UNCONFIRMED", (e) => { assert.equal(e.details.repoKey, K.billing); assert.equal(e.details.reason, "no-backlink"); });
  const fabricated = soulEntry(K.stranger, OID("7"), "engineering", soulDef("ghost"));
  await rejectsCode(resolveSoul(d, fabricated, opts()), "E_NOT_A_MEMBER", (e) => assert.equal(e.details.reason, "not-listed"));
  // a confirmed member that does not carry this soul at this commit (fabricated name or another observation)
  const stale = soulEntry(K.agents, OID("5"), "engineering", soulDef("release-manager"));
  await rejectsCode(resolveSoul(d, stale, opts()), "E_MEMBERSHIP_UNCONFIRMED", (e) => assert.equal(e.details.reason, "stale"));
  const notThere = soulEntry(K.agents, C.agents, "engineering", soulDef("invented"));
  await rejectsCode(resolveSoul(d, notThere, opts()), "E_MEMBERSHIP_UNCONFIRMED", (e) => assert.equal(e.details.reason, "stale"));
  // external souls and member souls pass the gate as before
  assert.ok(await resolveSoul(d, findSoul(d, "security-reviewer"), opts()));
  assert.ok(await resolveSoul(d, findSoul(d, "campaign-writer"), opts()));
});

test("MED: a slot default must be a capability of THAT layer — no layer / wrong layer → E_SLOT_CONFLICT layer-mismatch", async () => {
  const noLayer = { ...M.altOkf }; delete noLayer.layer;
  const caps = (notes) => [capEntry(K.agents, C.agents, M.releaseTooling), capEntry(K.agents, C.agents, M.houseStyle, "global"), capEntry(K.agents, C.agents, notes, "global")];
  const ws = workspaceFile({ defaults: { ...workspaceFile().defaults, knowledge: { "nw-notes": { from: K.agents } } } });
  const d1 = discovery({ workspace: ws, agentsCaps: caps(noLayer) });
  await rejectsCode(resolveSoul(d1, findSoul(d1, "release-manager"), opts()), "E_SLOT_CONFLICT", (e) => { assert.equal(e.details.reason, "layer-mismatch"); assert.equal(e.details.slot, "knowledge"); assert.equal(e.details.layer, null); });
  const d2 = discovery({ workspace: ws, agentsCaps: caps({ ...M.altOkf, layer: "messaging" }) });
  await rejectsCode(resolveSoul(d2, findSoul(d2, "release-manager"), opts()), "E_SLOT_CONFLICT", (e) => { assert.equal(e.details.reason, "layer-mismatch"); assert.equal(e.details.layer, "messaging"); });
  // the right layer fills the slot
  const d3 = discovery({ workspace: ws, agentsCaps: caps(M.altOkf) });
  assert.equal((await resolveSoul(d3, findSoul(d3, "release-manager"), opts())).slots.knowledge, "nw-notes");
});

test("MED: compatibility floors: an unversioned package (git:<repo>@<OID>, even all digits) is E_COMPATIBILITY why:unversioned; details always name capability + package", async () => {
  const soul = soulDef("s", { capabilities: { "nw-deploy": { from: "package" } }, compatibility: { "nw-deploy": ">=0.4.0" } });
  for (const version of ["3".repeat(40), "a1b2".repeat(10), "release-2026-q3"]) {
    const lock = lockV3(); lock.packages["nw.tools"].version = version;
    const d = discovery({ souls: { s: soul } });
    await rejectsCode(resolveSoul(d, findSoul(d, "s"), opts({ lock })), "E_COMPATIBILITY", (e) => {
      assert.equal(e.details.why, "unversioned"); assert.equal(e.details.capability, "nw-deploy"); assert.equal(e.details.package, "nw.tools"); assert.equal(e.details.version, version);
    });
  }
  // an unparseable RANGE also names the capability and package
  const d = discovery({ souls: { s: soulDef("s", { capabilities: { "nw-deploy": { from: "package" } }, compatibility: { "nw-deploy": ">=>x" } }) } });
  await rejectsCode(resolveSoul(d, findSoul(d, "s"), opts()), "E_COMPATIBILITY", (e) => { assert.equal(e.details.why, "range"); assert.equal(e.details.package, "nw.tools"); });
});

test("LOW: `from: here` in a WORKSPACE default (any tier) is E_WORKSPACE_SCHEMA; in a soul it is fine", async () => {
  assert.throws(() => composeCapabilities(workspaceFile({ defaults: { capabilities: { "nw-house-style": { from: "here" } } } }), {}), (e) => e.code === "E_WORKSPACE_SCHEMA" && e.details.path === "/defaults/capabilities/nw-house-style/from");
  assert.throws(() => composeCapabilities(workspaceFile({ defaults: { byTeam: { engineering: { capabilities: { x: { from: "here" } } } } } }), {}, { team: "engineering" }), (e) => e.code === "E_WORKSPACE_SCHEMA");
  assert.equal(composeCapabilities(null, { capabilities: { x: { from: "here" } } })[0].from, "here");
});

test("LOW: lock shape is validated in memory (E_LOCK_SCHEMA); a pre-0.26 `approved` field (null, legacy, malformed) is ignored", async () => {
  const d = discovery();
  const v2 = lockV3(); v2.lockfileVersion = 2;
  await rejectsCode(resolveSoul(d, findSoul(d, "release-manager"), opts({ lock: v2 })), "E_LOCK_SCHEMA");
  const legacy = lockV3();
  legacy.packages["nw.tools"].approved = null;
  legacy.packages["oats.okf"].approved = { executables: "sha256-000", at: "2026-09-23T00:00:00.000Z" };
  legacy.packages["oats.framework"].approved = { executables: DIGEST("e"), at: "2026-09-23T09:02:11.000Z" };
  const r = await resolveSoul(d, findSoul(d, "release-manager"), opts({ lock: legacy }));
  assert.equal(r.modules.find((m) => m.name === "nw-deploy").from.commit, C.toolsPkg, "an unapproved package resolves: declaring it is the trust decision");
  assert.equal(r.revision, (await resolveSoul(d, findSoul(d, "release-manager"), opts())).revision, "the legacy field does not enter the revision");
});

test("e2e MED: a catalog-locked package resolves from the lock's recorded url without a catalog", async () => {
  const d = discovery();
  const lock = lockV3();
  lock.packages["oats.okf"].url = parseRepoRef(R.okf).url;
  lock.packages["oats.framework"].url = parseRepoRef(R.framework).url;
  const r = await resolveSoul(d, findSoul(d, "release-manager"), opts({ lock, catalog: null }));
  assert.equal(r.modules.find((m) => m.name === "oats.okf").from.repoKey, K.okf);
  assert.equal(r.modules.find((m) => m.name === "oats.okf").dir, "oats-package/capabilities/oats-okf", "module.dir is the manifest-listed directory (≠ the capability name)");
});

/* ───────────────────────────── Phase C regressions (adversarial review) ── */

test("M9: `byTeam` is reserved — refused (E_WORKSPACE_SCHEMA reason reserved-key, path named) in spawn.providers[cap], local.settings[cap], a soul slot payload and NESTED inside workspace.messaging.byTeam[label]", async () => {
  const ws = workspaceFile();
  ws.defaults = { ...ws.defaults, messaging: { "nw-chat": { from: K.agents } } };
  ws.messaging = { private: "per-human", byTeam: { engineering: { channels: ["eng"] } } };
  const d = discovery({ workspace: ws });
  const rm = () => findSoul(d, "release-manager");
  // spawn --provider
  await rejectsCode(resolveSoul(d, rm(), opts({ spawn: { providers: { "nw-chat": { byTeam: { engineering: { channels: ["hijack"] } } } } } })), "E_WORKSPACE_SCHEMA", (e) => {
    assert.equal(e.details.reason, "reserved-key"); assert.equal(e.details.path, "/spawn/providers/nw-chat/byTeam");
  });
  // oats-local.yaml settings
  await rejectsCode(resolveSoul(d, rm(), opts({ local: { schemaVersion: 2, workspace: R.agents, settings: { "nw-chat": { byTeam: {} } } } })), "E_WORKSPACE_SCHEMA", (e) => {
    assert.equal(e.details.reason, "reserved-key"); assert.equal(e.details.path, "/settings/nw-chat/byTeam");
  });
  // soul slot payload — even when the slot resolves to no module
  const d2 = discovery({ workspace: ws, souls: { s: soulDef("s", { team: "engineering", messaging: { byTeam: { engineering: {} } } }) } });
  await rejectsCode(resolveSoul(d2, findSoul(d2, "s"), opts()), "E_WORKSPACE_SCHEMA", (e) => { assert.equal(e.details.reason, "reserved-key"); assert.equal(e.details.path, "/messaging/byTeam"); });
  const d3 = discovery({ souls: { s: soulDef("s", { knowledge: { byTeam: { x: 1 } } }) } });
  await rejectsCode(resolveSoul(d3, findSoul(d3, "s"), opts()), "E_WORKSPACE_SCHEMA", (e) => { assert.equal(e.details.reason, "reserved-key"); assert.equal(e.details.path, "/knowledge/byTeam"); });
  // nested inside a team's own payload (the top-level byTeam is the legal one; a second level is not)
  const ws4 = { ...ws, messaging: { private: "per-human", byTeam: { engineering: { channels: ["eng"], byTeam: { engineering: { channels: ["deeper"] } } } } } };
  const d4 = discovery({ workspace: ws4 });
  await rejectsCode(resolveSoul(d4, findSoul(d4, "release-manager"), opts()), "E_WORKSPACE_SCHEMA", (e) => { assert.equal(e.details.reason, "reserved-key"); assert.equal(e.details.path, "/messaging/byTeam/engineering/byTeam"); });
  // the legal top-level byTeam still works and never reaches the provider
  const ok = await resolveSoul(d, rm(), opts());
  assert.deepEqual(ok.payloads["nw-chat"], { private: "per-human", channels: ["northwind-eng"] });
  assert.equal("byTeam" in ok.payloads["nw-chat"], false);
});

test("M5: spawn.providers keyed by a poison name (constructor) is E_WORKSPACE_SCHEMA poison-key; an inherited (non-own) provider key is not a request", async () => {
  const d = discovery();
  await rejectsCode(resolveSoul(d, findSoul(d, "release-manager"), opts({ spawn: { providers: { constructor: { x: "1" } } } })), "E_WORKSPACE_SCHEMA", (e) => assert.equal(e.details.reason, "poison-key"));
  // a providers object that only INHERITS a key for a resolved module must not merge it (own keys only)
  const inherited = Object.create({ "oats.okf": { owns: "HIJACKED" } });
  const r = await resolveSoul(d, findSoul(d, "release-manager"), opts({ spawn: { providers: inherited } }));
  assert.deepEqual(r.payloads["oats.okf"], { owns: "release-manager", reads: ["platform-engineer"] });
  assert.equal(({}).constructor.x, undefined, "Object.prototype untouched");
});

/* ───────────────────────────── 0.25.1 fix lanes: L1 / L6 (lane 4) ── */

test("an edited lock pointing at another commit: resolves when that commit declares the locked capabilities, E_PACKAGE_INTEGRITY why:capabilities when it declares others", async () => {
  const B = OID("4"), X = OID("5");
  const repos = remoteRepos();
  // B: same id, version and capabilities, a different executable body — the lock is reproducibility, not approval
  repos[K.tools][B] = { ...repos[K.tools][C.toolsPkg], "oats-package/capabilities/nw-deploy/bin/nw-deploy.mjs": "#!/usr/bin/env node\n// other body\n" };
  // X: the package there declares only nw-deploy
  repos[K.tools][X] = { ...repos[K.tools][C.toolsPkg], "oats-package/oats-package.json": { package: "nw.tools", version: "0.4.0", capabilities: ["capabilities/nw-deploy"] } };
  const remote = fakeRemote(repos);
  const d = discovery();
  const toB = lockV3(); toB.packages["nw.tools"].commit = B;
  const rB = await resolveSoul(d, findSoul(d, "release-manager"), opts({ remote, lock: toB }));
  assert.equal(rB.modules.find((m) => m.name === "nw-deploy").from.commit, B);
  const toX = lockV3(); toX.packages["nw.tools"].commit = X;
  await rejectsCode(resolveSoul(d, findSoul(d, "release-manager"), opts({ remote, lock: toX })), "E_PACKAGE_INTEGRITY", (e) => {
    assert.equal(e.details.why, "capabilities"); assert.equal(e.details.commit, X);
    assert.deepEqual(e.details.listed, ["nw-deploy"]); assert.deepEqual(e.details.locked, ["nw-deploy", "nw-lint"]);
  });
});

test("L1: a soul's `<slot>: none` EMPTIES the slot — it drops a layer-bearing capability the WORKSPACE DEFAULTS contributed (defaults.capabilities and defaults.byTeam); a layer-bearing capability the SOUL declares beside none stays E_SLOT_CONFLICT reason none", async () => {
  // defaults.capabilities carries a knowledge-layer capability (nw-notes, a member cap of agents); defaults.knowledge is off
  const ws = workspaceFile({ defaults: { capabilities: { "oats.core": { from: "package" }, "nw-notes": { from: K.agents } }, knowledge: "none", messaging: "none", tasks: "none", byTeam: { engineering: { capabilities: { "nw-chat": { from: K.agents } } } } } });
  const d = discovery({ workspace: ws, souls: {
    quiet: soulDef("quiet", { team: "engineering", knowledge: "none", messaging: "none" }),
    talkative: soulDef("talkative", { team: "engineering", knowledge: "none" }),
    contradictory: soulDef("contradictory", { team: "engineering", knowledge: "none", capabilities: { "nw-notes": { from: K.agents } } }),
    redeclared: soulDef("redeclared", { team: "engineering", messaging: "none", capabilities: { "nw-chat": { from: K.agents } } }),
  } });
  // none on knowledge drops defaults.capabilities' nw-notes; none on messaging drops byTeam's nw-chat → both slots empty, no conflict
  const quiet = await resolveSoul(d, findSoul(d, "quiet"), opts());
  assert.deepEqual(quiet.modules.map((m) => m.name), ["oats.core"]);
  assert.deepEqual(quiet.slots, { knowledge: null, messaging: null, tasks: null });
  assert.ok(!("nw-notes" in quiet.payloads) && !("nw-chat" in quiet.payloads) && !quiet.skills.some((s) => s.module === "nw-notes" || s.module === "nw-chat"), "a dropped capability leaves no payload, skill or inject behind");
  // only knowledge is none: the byTeam messaging capability still fills its slot
  const talkative = await resolveSoul(d, findSoul(d, "talkative"), opts());
  assert.deepEqual(talkative.modules.map((m) => m.name), ["nw-chat", "oats.core"]);
  assert.deepEqual(talkative.slots, { knowledge: null, messaging: "nw-chat", tasks: null });
  // the soul ITSELF names a knowledge capability next to knowledge: none → contradiction, loud
  await rejectsCode(resolveSoul(d, findSoul(d, "contradictory"), opts()), "E_SLOT_CONFLICT", (e) => { assert.equal(e.details.reason, "none"); assert.equal(e.details.slot, "knowledge"); assert.deepEqual(e.details.modules, ["nw-notes"]); assert.equal(e.details.via, "soul"); });
  // re-declaring a byTeam default in the soul makes it the soul's own: `none` on that slot is a conflict, not a silent drop
  await rejectsCode(resolveSoul(d, findSoul(d, "redeclared"), opts()), "E_SLOT_CONFLICT", (e) => { assert.equal(e.details.reason, "none"); assert.equal(e.details.slot, "messaging"); });
  // the default workspace file (knowledge default via defaults.knowledge) keeps behaving: none empties, off removes (regression guard)
  const d0 = discovery();
  assert.deepEqual((await resolveSoul(d0, findSoul(d0, "support-triager"), opts())).slots.knowledge, null);
  // a dropped default is dropped BEFORE lookup: a knowledge default from an unconfirmed member does not fail a soul that says none
  const wsBad = workspaceFile({ defaults: { capabilities: { "oats.core": { from: "package" }, "nw-notes": { from: K.billing } }, knowledge: "none", messaging: "none", tasks: "none" } });
  const dBad = discovery({ workspace: wsBad, souls: { quiet: soulDef("quiet", { knowledge: "none" }), loud: soulDef("loud", {}) } });
  await rejectsCode(resolveSoul(dBad, findSoul(dBad, "loud"), opts()), "E_NOT_A_MEMBER", undefined);
  // …but the LAYER is only known after lookup; an unresolvable default is a workspace problem the soul cannot paper over
  await rejectsCode(resolveSoul(dBad, findSoul(dBad, "quiet"), opts()), "E_NOT_A_MEMBER", undefined);
});

test("L6: declRevision and payloadRevision are fingerprinted apart; revision = hash(both) — a settings-only difference moves payloadRevision (and revision) but not declRevision; a member move moves declRevision", async () => {
  const d = discovery();
  const a = await resolveSoul(d, findSoul(d, "release-manager"), opts());
  assert.match(a.declRevision, /^[0-9a-f]{24}$/); assert.match(a.payloadRevision, /^[0-9a-f]{24}$/);
  assert.equal(a.revision, revisionOf({ declRevision: a.declRevision, payloadRevision: a.payloadRevision }));
  // settings-only (oats-local.yaml settings / --provider)
  const b = await resolveSoul(d, findSoul(d, "release-manager"), opts({ local: { schemaVersion: 2, workspace: R.agents, settings: { "oats.okf": { storeRoot: "/x" } } } }));
  assert.equal(b.declRevision, a.declRevision, "declarations unchanged");
  assert.notEqual(b.payloadRevision, a.payloadRevision, "payload changed");
  assert.notEqual(b.revision, a.revision, "the decision still binds the payload");
  const c = await resolveSoul(d, findSoul(d, "release-manager"), opts({ spawn: { providers: { "oats.okf": { seat: "one" } } } }));
  assert.equal(c.declRevision, a.declRevision); assert.notEqual(c.payloadRevision, a.payloadRevision);
  // member moved: declarations change, payload does not
  const moved = discovery(); moved.members[0].commit = OID("b"); for (const x of moved.members[0].capabilities) x.commit = OID("b"); for (const s of moved.members[0].souls) s.commit = OID("b");
  const movedRepos = remoteRepos(); movedRepos[K.agents][OID("b")] = movedRepos[K.agents][C.agents];
  const m = await resolveSoul(moved, findSoul(moved, "release-manager"), opts({ remote: fakeRemote(movedRepos) }));
  assert.notEqual(m.declRevision, a.declRevision); assert.equal(m.payloadRevision, a.payloadRevision); assert.notEqual(m.revision, a.revision);
  // both
  const both = await resolveSoul(moved, findSoul(moved, "release-manager"), opts({ remote: fakeRemote(movedRepos), local: { schemaVersion: 2, workspace: R.agents, settings: { "oats.okf": { storeRoot: "/x" } } } }));
  assert.notEqual(both.declRevision, a.declRevision); assert.notEqual(both.payloadRevision, a.payloadRevision);
  // frozen + serializable with the new fields
  assert.ok(Object.isFrozen(a)); assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
});

/* ─────────────────── teams contract 2026-09-25 (several labels) ─────────────────── */

// decl: pinned before teams (129bcbf3), unchanged. payload/revision: re-pinned for amendment K (were 1e84c24d04acb86a36a46494 / 41a494f695699d3afbe615be).
const PIN_SINGLE_LABEL = { decl: "ce27f0e0fa837d02d037d752", payload: "a1b3a13c66f57295da2e910f", revision: "b0ac0ddcc0398857d686a839" };
/** A soul entry carrying several labels, as discovery lists one (`team` is the primary). */
const labelled = (d, name, labels) => {
  const entry = { ...findSoul(d, name), team: labels[0] ?? null, labels };
  for (const m of d.members) m.souls = m.souls.map((s) => (s.name === name ? entry : s));
  return entry;
};
const teamsWorkspace = () => {
  const ws = workspaceFile();
  ws.teams = { ...ws.teams, cloud: { description: "hosted" } };
  ws.defaults = { ...ws.defaults, messaging: { "nw-chat": { from: K.agents } } };
  ws.messaging = { private: "per-human", byTeam: { engineering: { team: "aweb:example.oss", channels: ["eng"] }, cloud: { team: "aweb:example.cloud" } } };
  return ws;
};

test("single label: composition and declRevision are byte-identical to the pre-teams resolver (pinned); the payload moves only by amendment K", async () => {
  // declRevision pinned from origin/main's lib/resolve.mjs (129bcbf3) on this fixture: a one-label soul's
  // COMPOSITION must not move. Amendment K (teams contract, co-lead ruling) drops the mapped primary's
  // byTeam entry from the messaging settings, so payloadRevision and revision were re-pinned for it.
  const d = discovery({ workspace: teamsWorkspace() });
  const r = await resolveSoul(d, findSoul(d, "release-manager"), opts());
  assert.deepEqual(r.payloads["nw-chat"], { private: "per-human", channels: ["northwind-eng"] });
  assert.deepEqual({ decl: r.declRevision, payload: r.payloadRevision, revision: r.revision }, PIN_SINGLE_LABEL);
  assert.deepEqual(r.modules.map((m) => m.name), ["nw-chat", "nw-deploy", "nw-house-style", "nw-release-tooling", "oats.core", "oats.okf"]);
});

test("several labels: byTeam capabilities apply for each label in soul order, `via` names the label; the soul still wins", async () => {
  const d = discovery({ workspace: teamsWorkspace() });
  const entry = labelled(d, "release-manager", ["engineering", "marketing"]);
  const r = await resolveSoul(d, entry, opts());
  assert.equal(r.soul.team, "engineering", "the first label is the primary");
  assert.ok(r.modules.some((m) => m.name === "nw-brand-voice"), "marketing's team default applies too");
  assert.ok(r.modules.some((m) => m.name === "nw-release-tooling"));
  const vias = Object.fromEntries(composeCapabilities(teamsWorkspace(), { capabilities: {} }, { labels: ["engineering", "marketing"] }).map((c) => [c.name, c.via]));
  assert.equal(vias["nw-release-tooling"], "defaults.byTeam.engineering");
  assert.equal(vias["nw-brand-voice"], "defaults.byTeam.marketing");
  // …and the soul's own `off` still removes a label's default.
  assert.ok(!composeCapabilities(teamsWorkspace(), { capabilities: { "nw-brand-voice": "off" } }, { labels: ["engineering", "marketing"] }).some((c) => c.name === "nw-brand-voice"));
  // Amendment K: no label's byTeam entry is merged into the messaging settings, the primary's included;
  // both labels' payloads are in teams[], in soul order.
  assert.deepEqual(r.payloads["nw-chat"], { private: "per-human", channels: ["northwind-eng"] });
  assert.deepEqual(r.teams.map((t) => [t.label, t.team]), [["engineering", "aweb:example.oss"], ["marketing", null]]);
});

test("layers-from: each filled slot records where its capability came from — slot default / defaults.capabilities → workspace, defaults.byTeam.<label> → team:<label>, the soul's own → soul; an empty slot → null; outside every fingerprint", async () => {
  // slot default (defaults.knowledge)
  const d = discovery();
  const rm = await resolveSoul(d, findSoul(d, "release-manager"), opts());
  assert.deepEqual(rm.slotsFrom, { knowledge: "workspace", messaging: null, tasks: null });
  // defaults.capabilities fills the messaging slot
  const wsCaps = workspaceFile(); wsCaps.defaults = { ...wsCaps.defaults, capabilities: { ...wsCaps.defaults.capabilities, "nw-chat": { from: K.agents } } };
  const dc = discovery({ workspace: wsCaps });
  assert.equal((await resolveSoul(dc, findSoul(dc, "release-manager"), opts())).slotsFrom.messaging, "workspace");
  // defaults.byTeam.<label>: on a two-label soul, the label that gave it
  const wsTeam = teamsWorkspace(); wsTeam.defaults = { ...wsTeam.defaults, messaging: "none", byTeam: { ...wsTeam.defaults.byTeam, cloud: { capabilities: { "nw-chat": { from: K.agents } } } } };
  const dt = discovery({ workspace: wsTeam });
  const two = await resolveSoul(dt, labelled(dt, "release-manager", ["engineering", "cloud"]), opts());
  assert.equal(two.slots.messaging, "nw-chat");
  assert.deepEqual(two.slotsFrom, { knowledge: "workspace", messaging: "team:cloud", tasks: null });
  // the soul's own entry (it wins over the workspace default of the same capability)
  const ds = discovery({ workspace: wsCaps, souls: { s: soulDef("s", { capabilities: { "nw-chat": { from: "here" } } }) } });
  assert.equal((await resolveSoul(ds, findSoul(ds, "s"), opts())).slotsFrom.messaging, "soul");
  // the soul's `none` empties the slot: no origin
  const st = await resolveSoul(d, findSoul(d, "support-triager"), opts());
  assert.equal(st.slots.knowledge, null); assert.equal(st.slotsFrom.knowledge, null);
  // Provenance only: the same capability reached another way moves no fingerprint.
  const same = await resolveSoul(ds, findSoul(ds, "s"), opts());
  const dw = discovery({ workspace: wsCaps, souls: { s: soulDef("s") } });
  const viaWs = await resolveSoul(dw, findSoul(dw, "s"), opts());
  assert.equal(viaWs.slotsFrom.messaging, "workspace");
  assert.equal(viaWs.declRevision, same.declRevision);
  assert.deepEqual(["soul", "defaults.knowledge", "defaults.capabilities", "defaults.byTeam.a.b", undefined].map(resolveLib.fromOfVia), ["soul", "workspace", "workspace", "team:a.b", null]);
});

test("E_TEAM_CONFLICT: two labels giving one capability different entries is refused naming both; identical entries are not a conflict", () => {
  const ws = workspaceFile({ defaults: { ...workspaceFile().defaults, byTeam: {
    engineering: { capabilities: { "nw-shared": { from: K.agents } } },
    marketing: { capabilities: { "nw-shared": "off" } },
    global: { capabilities: { "nw-shared": { from: K.agents } } },
  } } });
  assert.throws(() => composeCapabilities(ws, {}, { labels: ["engineering", "marketing"] }), (e) => {
    assert.equal(e.code, "E_TEAM_CONFLICT");
    assert.deepEqual(e.details.labels, ["engineering", "marketing"]);
    assert.equal(e.details.capability, "nw-shared");
    assert.match(e.message, /"engineering" and "marketing"/);
    return true;
  });
  assert.throws(() => composeCapabilities(ws, {}, { labels: ["marketing", "engineering"] }), (e) => e.code === "E_TEAM_CONFLICT" && e.details.labels.join() === "marketing,engineering");
  const same = composeCapabilities(ws, {}, { labels: ["engineering", "global"] });
  assert.equal(same.find((c) => c.name === "nw-shared").via, "defaults.byTeam.global", "identical entries: the later label is recorded, nothing refused");
  // The soul's own entry wins over every label, so naming the capability settles it (the remedy the message names).
  const settled = composeCapabilities(ws, { capabilities: { "nw-shared": "off" } }, { labels: ["engineering", "marketing"] });
  assert.ok(!settled.some((c) => c.name === "nw-shared"));
});

test("teams: one eligible entry per label in soul order — mapped (base ⊕ byTeam, team id) or unmapped (base, team null); no label → []", async () => {
  const d = discovery({ workspace: teamsWorkspace() });
  const r = await resolveSoul(d, labelled(d, "release-manager", ["engineering", "marketing", "cloud"]), opts());
  assert.deepEqual(r.teams, [
    { label: "engineering", team: "aweb:example.oss", mapped: true, payload: { private: "per-human", team: "aweb:example.oss", channels: ["eng"] } },
    { label: "marketing", team: null, mapped: false, payload: { private: "per-human" } },
    { label: "cloud", team: "aweb:example.cloud", mapped: true, payload: { private: "per-human", team: "aweb:example.cloud" } },
  ]);
  for (const t of r.teams) assert.equal("byTeam" in t.payload, false, "byTeam never reaches a provider");
  const none = await resolveSoul(d, labelled(d, "release-manager", []), opts());
  assert.deepEqual(none.teams, []);
  assert.equal(none.soul.team, null);
  // Teams are live messaging state, not composition: changing a non-primary label's mapping moves no fingerprint.
  const ws2 = teamsWorkspace(); ws2.messaging.byTeam.marketing = { team: "aweb:example.mkt" };
  const d2 = discovery({ workspace: ws2 });
  const r2 = await resolveSoul(d2, labelled(d2, "release-manager", ["engineering", "marketing", "cloud"]), opts());
  assert.equal(r2.teams[1].team, "aweb:example.mkt");
  assert.equal(r2.revision, r.revision);
  assert.deepEqual(resolveLib.teamsOf(null, ["x"]), [{ label: "x", team: null, mapped: false, payload: {} }], "no workspace (standalone): every label unmapped");
});

test("teams: EVERY carried label's byTeam entry is validated like the primary's — a hostOnly key or a nested byTeam in a secondary label's entry is refused, path named", async () => {
  // Each label's base ⊕ byTeam[label] reaches the provider in OATS_TEAMS, so a secondary label's entry
  // meets the primary's bar: same error, same reason, pointer /messaging/byTeam/<label>.
  const chat = { ...M.chat, settings: { root: { hostOnly: true, description: "host-owned root" } } };
  const caps = [capEntry(K.agents, C.agents, M.releaseTooling), capEntry(K.agents, C.agents, M.houseStyle, "global"), capEntry(K.agents, C.agents, chat, "global")];
  const withEntry = (label, entry) => { const ws = teamsWorkspace(); ws.messaging.byTeam[label] = entry; return ws; };
  for (const label of ["engineering", "cloud"]) { // the primary, then a secondary
    const d = discovery({ workspace: withEntry(label, { team: "aweb:x", root: "/evil" }), agentsCaps: caps });
    await rejectsCode(resolveSoul(d, labelled(d, "release-manager", ["engineering", "cloud"]), opts()), "E_WORKSPACE_SCHEMA", (e) => {
      assert.equal(e.details.reason, "host-only-key"); assert.equal(e.details.key, "root"); assert.equal(e.details.capability, "nw-chat");
      assert.equal(e.details.path, `/messaging/byTeam/${label}/root`);
    });
    const n = discovery({ workspace: withEntry(label, { team: "aweb:x", byTeam: { cloud: {} } }), agentsCaps: caps });
    await rejectsCode(resolveSoul(n, labelled(n, "release-manager", ["engineering", "cloud"]), opts()), "E_WORKSPACE_SCHEMA", (e) => {
      assert.equal(e.details.reason, "reserved-key"); assert.equal(e.details.path, `/messaging/byTeam/${label}/byTeam`);
    });
  }
  // A label the soul does NOT carry is not its payload: a bad entry there does not block this soul.
  const other = discovery({ workspace: withEntry("marketing", { root: "/evil", byTeam: {} }), agentsCaps: caps });
  const ok = await resolveSoul(other, labelled(other, "release-manager", ["engineering", "cloud"]), opts());
  assert.deepEqual(ok.teams.map((t) => t.label), ["engineering", "cloud"]);
  // A clean secondary entry still resolves, and the host layer may carry the hostOnly key.
  const clean = discovery({ workspace: teamsWorkspace(), agentsCaps: caps });
  const r = await resolveSoul(clean, labelled(clean, "release-manager", ["engineering", "cloud"]), opts({ local: { schemaVersion: 2, workspace: R.agents, settings: { "nw-chat": { root: "/srv/aweb" } } } }));
  assert.equal(r.payloads["nw-chat"].root, "/srv/aweb");
  assert.deepEqual(r.teams[1], { label: "cloud", team: "aweb:example.cloud", mapped: true, payload: { private: "per-human", team: "aweb:example.cloud" } });
});
