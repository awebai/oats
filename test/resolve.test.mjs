// lib/resolve.mjs — from a soul to an immutable resolution (module contract §3).
// Runs against an in-memory discovery shaped like lib/workspace.mjs#discoverWorkspace output,
// an in-memory lock v3, and a fake contract-§1 remote (real parseRepoRef) — no git, no network.
import test from "node:test";
import assert from "node:assert/strict";
import { oatsError } from "../lib/errors.mjs";
import { parseRepoRef } from "../lib/remote.mjs";
import { standaloneRepo } from "../lib/workspace.mjs";
import {
  canonicalJson, composeCapabilities, mergePayload, parseVersion, refForKey, resolveSoul, revisionOf,
  satisfiesRange, skillsInListing,
} from "../lib/resolve.mjs";

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

/** In-memory lock v3 (contract §4 shape), all approved unless overridden. */
function lockV3({ approved = true, packages = {} } = {}) {
  const ok = approved ? { executables: DIGEST("e"), at: "2026-09-23T09:02:11.000Z" } : null;
  return {
    lockfileVersion: 3,
    packages: {
      "nw.tools": { source: `git:${K.tools}@v0.4.0`, path: "oats-package", version: "0.4.0", commit: C.toolsPkg, integrity: DIGEST("3"), capabilities: ["nw-deploy", "nw-lint"], approved: ok },
      "oats.framework": { source: "catalog:oats.framework", path: "oats-package", version: "1.1.3", commit: C.framework, integrity: DIGEST("2"), capabilities: ["oats.core"], approved: ok },
      "oats.okf": { source: "catalog:oats.okf", path: "oats-package", version: "2.1.3", commit: C.okf, integrity: DIGEST("1"), capabilities: ["oats.okf"], approved: ok },
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
        agentsCaps ?? [capEntry(K.agents, C.agents, M.releaseTooling), capEntry(K.agents, C.agents, M.houseStyle, "global"), capEntry(K.agents, C.agents, M.secrets, "global"), capEntry(K.agents, C.agents, M.altOkf, "global")]),
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
  // revision
  assert.match(r.revision, /^[0-9a-f]{24}$/);
  assert.equal(r.revision, revisionOf({ resolutionApi: 1, soul: r.soul, modules: r.modules, slots: r.slots, payloads: r.payloads, skills: r.skills, injects: r.injects }));
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

test("E_PACKAGE_UNAPPROVED when the providing package's approval is null", async () => {
  const d = discovery();
  const lock = lockV3();
  lock.packages["nw.tools"].approved = null;
  await rejectsCode(resolveSoul(d, findSoul(d, "release-manager"), opts({ lock })), "E_PACKAGE_UNAPPROVED", (e) => {
    assert.equal(e.details.id, "nw.tools");
    assert.equal(e.details.version, "0.4.0");
    assert.equal(e.details.commit, C.toolsPkg);
  });
});

test("E_PACKAGE_MISSING without a lock, and ambiguous providers fail closed", async () => {
  const d = discovery();
  await rejectsCode(resolveSoul(d, findSoul(d, "release-manager"), opts({ lock: null })), "E_PACKAGE_MISSING", (e) => assert.equal(e.details.reason, "no-lock"));
  const lock = lockV3({ packages: { "nw.other": { source: "git:github.com/x/y@v1.0.0", path: "oats-package", version: "1.0.0", commit: OID("7"), integrity: DIGEST("7"), capabilities: ["nw-deploy"], approved: null } } });
  await rejectsCode(resolveSoul(d, findSoul(d, "release-manager"), opts({ lock })), "E_PACKAGE_MISSING", (e) => assert.deepEqual(e.details.ambiguous, ["nw.other", "nw.tools"]));
});

test("a catalog-sourced lock entry needs the catalog to say which repo it lives in", async () => {
  const d = discovery();
  await rejectsCode(resolveSoul(d, findSoul(d, "support-triager"), opts({ catalog: null })), "E_PACKAGE_MISSING", (e) => assert.equal(e.details.reason, "no-catalog"));
});

test("a lock that claims a capability the package tree does not carry is E_PACKAGE_INTEGRITY", async () => {
  const d = discovery({ souls: { s: soulDef("s", { capabilities: { "nw-ghost": { from: "package" } } }) } });
  const lock = lockV3();
  lock.packages["nw.tools"].capabilities = ["nw-deploy", "nw-ghost", "nw-lint"];
  await rejectsCode(resolveSoul(d, findSoul(d, "s"), opts({ lock })), "E_PACKAGE_INTEGRITY", (e) => {
    assert.equal(e.details.id, "nw.tools");
    assert.deepEqual(e.details.listed, ["nw-deploy", "nw-lint"]);
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
  assert.deepEqual(r.modules.map((m) => m.name), ["nw-warehouse-access"], "no workspace defaults; the unresolvable from:<other> is dropped by standaloneRepo as a problem");
  assert.equal(r.slots.knowledge, null);
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
