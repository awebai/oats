// lib/instance-resolution.mjs — the bridge from the workspace model into a spawn.
// Phase C adversarial-review regressions: M5 (parseProviderFlags prototype pollution),
// M6 (explicit standalone must be a MEMBER), M7 (standalone fallback only on ACCESS failure,
// reason exposed), and the ensureWorkspaceSoul refresh (H2 in bin relies on it).
// Fake contract-§1 remote (real parseRepoRef) for discovery; the real lib/remote.mjs over the
// Northwind fixture (local bare repos) for the soul fetch/refresh.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import YAML from "yaml";
import { oatsError } from "../lib/errors.mjs";
import { parseRepoRef } from "../lib/remote.mjs";
import { discoverOrStandalone, ensureWorkspaceSoul, findSoulEntry, parseProviderFlags, prepareInstance } from "../lib/instance-resolution.mjs";
import { buildNorthwind, moveMember } from "./fixtures/northwind/build.mjs";

/* ───────────────────────────── fake remote (contract §1) ──────────────── */

const OID = (seed) => seed.repeat(40).slice(0, 40);
const detailed = (code, message, details) => { const e = oatsError(code, message, details); e.details = details; return e; };

/** repos: { <key>: { commit, files: { <path>: string|object }, fail?: E_REMOTE_UNREADABLE reason } } */
function fakeRemote(repos) {
  const repoOf = (ref) => {
    const parsed = parseRepoRef(ref);
    const repo = repos[parsed.key];
    if (!repo) throw detailed("E_REMOTE_UNREADABLE", `cannot read remote ${parsed.url} (not-found)`, { url: parsed.url, key: parsed.key, reason: "not-found" });
    if (repo.fail) throw detailed("E_REMOTE_UNREADABLE", `cannot read remote ${parsed.url} (${repo.fail})`, { url: parsed.url, key: parsed.key, reason: repo.fail });
    return { parsed, repo };
  };
  const encode = (path, value) => (typeof value === "string" ? Buffer.from(value) : Buffer.from(path.endsWith(".json") ? JSON.stringify(value, null, 2) + "\n" : YAML.stringify(value, { lineWidth: 0 })));
  return {
    parseRepoRef,
    async observeRemote(ref, { at } = {}) {
      const { parsed, repo } = repoOf(ref);
      return { key: parsed.key, url: parsed.url, commit: at && /^[0-9a-f]{40}$/.test(at) ? at : repo.commit, ref: "refs/heads/main", observedAt: "2026-09-23T10:00:00.000Z" };
    },
    async readRemoteFile(ref, commit, path) {
      const { repo } = repoOf(ref);
      if (!Object.hasOwn(repo.files, path)) throw detailed("E_REMOTE_PATH_MISSING", `${path} is not in ${ref}@${commit}`, { path });
      const bytes = encode(path, repo.files[path]);
      return { bytes, size: bytes.length };
    },
    async listRemoteTree(ref, commit, dir, { depth = 2 } = {}) {
      const { repo } = repoOf(ref);
      const out = []; const seen = new Set();
      for (const path of Object.keys(repo.files)) {
        if (!path.startsWith(`${dir}/`)) continue;
        const rel = path.slice(dir.length + 1); const parts = rel.split("/");
        if (parts.length <= depth) out.push({ path: rel, type: "blob", size: 1 });
        for (let i = 1; i < Math.min(parts.length, depth + 1); i++) { const d = parts.slice(0, i).join("/"); if (!seen.has(d)) { seen.add(d); out.push({ path: d, type: "tree" }); } }
      }
      return out;
    },
  };
}

const R = { agents: "git:github.com/northwind/agents", data: "git:github.com/northwind/data", lone: "git:github.com/acme/lone" };
const K = Object.fromEntries(Object.entries(R).map(([n, ref]) => [n, parseRepoRef(ref).key]));
const soul = (name, extra = {}) => ({ schemaVersion: 2, name, description: `${name} soul`, work: "directory", capabilities: {}, ...extra });
const manifest = (capability, extra = {}) => ({ capability, version: "0.0.0-workspace", description: `${capability} capability`, ...extra });

function repos({ host = {} } = {}) {
  return {
    [K.agents]: {
      commit: OID("a"), ...host,
      files: {
        "oats-workspace.yaml": { schemaVersion: 2, name: "northwind", members: [R.agents, R.data], teams: { engineering: { description: "eng" } }, defaults: { capabilities: { "nw-house-style": { from: K.agents } } } },
        "oats-membership.yaml": { schemaVersion: 2, workspace: R.agents },
        "capabilities/nw-house-style/oats.json": manifest("nw-house-style"),
      },
    },
    [K.data]: {
      commit: OID("c"),
      files: {
        "oats-membership.yaml": { schemaVersion: 2, workspace: R.agents, team: "engineering" },
        "souls/data-analyst/soul.yaml": soul("data-analyst", { capabilities: { "nw-warehouse-access": { from: "here" }, "oats.core": "off" } }),
        "capabilities/nw-warehouse-access/oats.json": manifest("nw-warehouse-access", { skills: ["skills/query"] }),
        "capabilities/nw-warehouse-access/skills/query/SKILL.md": "---\nname: query\ndescription: q\n---\n",
      },
    },
    // A lone repo: souls and capabilities but NO oats-membership.yaml — a member of nothing.
    [K.lone]: {
      commit: OID("e"),
      files: {
        "souls/hermit/soul.yaml": soul("hermit", { capabilities: { "nw-secret-tool": { from: "here" }, "oats.core": "off" } }),
        "capabilities/nw-secret-tool/oats.json": manifest("nw-secret-tool", { commands: { run: "bin/run.mjs" } }),
      },
    },
  };
}

/* ───────────────────────────── M5 ─────────────────────────────────────── */

test("M5: parseProviderFlags never writes through to Object.prototype — poison capability names and path segments are E_WORKSPACE_SCHEMA poison-key; inherited names are own keys of a null-prototype accumulator", () => {
  const before = JSON.stringify(Object.getOwnPropertyNames(Object.prototype).sort());
  for (const [cap, kv] of [["constructor", "x=1"], ["prototype", "x=1"]]) {
    assert.throws(() => parseProviderFlags([[cap, kv]]), (e) => e.code === "E_WORKSPACE_SCHEMA" && e.details.reason === "poison-key" && e.details.key === cap, `capability ${cap}`);
  }
  // `__proto__` fails the capability-name grammar first (leading `_`): refused either way, and never as a key
  assert.throws(() => parseProviderFlags([["__proto__", "x=1"]]), (e) => e.code === "E_BAD_ARGS" || (e.code === "E_WORKSPACE_SCHEMA" && e.details.reason === "poison-key"));
  for (const kv of ["constructor.x=1", "a.__proto__.b=1", "prototype=1", "a.constructor=1"]) {
    assert.throws(() => parseProviderFlags([["oats.okf", kv]]), (e) => e.code === "E_WORKSPACE_SCHEMA" && e.details.reason === "poison-key" && e.details.path.startsWith("/oats.okf/"), `key ${kv}`);
  }
  assert.equal(Object.prototype.constructor.x, undefined);
  assert.equal(Object.prototype.toString.y, undefined);
  // Names that exist on Object.prototype but are not poison are ordinary own keys of the result.
  const out = parseProviderFlags([["toString", "y=2"], ["hasOwnProperty", "z=3"], ["oats.okf", "toString.a=1"], ["oats.okf", "valueOf=2"]]);
  assert.deepEqual(out, { toString: { y: "2" }, hasOwnProperty: { z: "3" }, "oats.okf": { toString: { a: "1" }, valueOf: "2" } });
  assert.equal(Object.getPrototypeOf(out), Object.prototype, "the result is an ordinary, JSON-clean object");
  assert.equal(typeof Object.prototype.toString, "function"); assert.equal(Object.prototype.toString.y, undefined);
  assert.equal(typeof ({}).hasOwnProperty, "function"); assert.equal(({}).hasOwnProperty.z, undefined);
  assert.equal(JSON.stringify(Object.getOwnPropertyNames(Object.prototype).sort()), before, "Object.prototype untouched after parsing");
  // dotted nesting and later-wins still work; a scalar re-nested becomes an object (own-key check, not truthiness)
  assert.deepEqual(parseProviderFlags([["oats.aweb", "identity.mode=retained"], ["oats.aweb", "identity.seat=a@b"], ["oats.aweb", "x=1"], ["oats.aweb", "x.y=2"]]), { "oats.aweb": { identity: { mode: "retained", seat: "a@b" }, x: { y: "2" } } });
  // M9 at the flag: byTeam is reserved in a spawn payload, any depth
  for (const kv of ["byTeam=1", "byTeam.engineering=1", "a.byTeam.x=1"]) {
    assert.throws(() => parseProviderFlags([["oats.aweb", kv]]), (e) => e.code === "E_WORKSPACE_SCHEMA" && e.details.reason === "reserved-key" && e.details.key === "byTeam", `key ${kv}`);
  }
  // still E_BAD_ARGS for malformed input
  assert.throws(() => parseProviderFlags([["oats.okf", "novalue"]]), (e) => e.code === "E_BAD_ARGS");
  assert.throws(() => parseProviderFlags([["bad name", "a=1"]]), (e) => e.code === "E_BAD_ARGS");
});

/* ───────────────────────────── M6 / M7 ────────────────────────────────── */

test("M6: explicit `standalone: <ref>` requires membership too — a lone repo with no oats-membership.yaml is E_MEMBERSHIP_UNCONFIRMED no-backlink, never a capability source", async () => {
  const remote = fakeRemote(repos());
  const err = await discoverOrStandalone({ schemaVersion: 2, standalone: R.lone }, { remote }).then(() => null, (e) => e);
  assert.ok(err, "a lone repo must be refused");
  assert.equal(err.code, "E_MEMBERSHIP_UNCONFIRMED");
  assert.equal(err.details.reason, "no-backlink");
  assert.equal(err.details.key, K.lone);
  assert.match(err.message, /a standalone view is a MEMBER whose workspace cannot be read/);
  assert.match(err.message, new RegExp(`${K.lone.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} declares no workspace`));
  // the same repo WITH a backlink is a fine explicit standalone view, with the reason exposed
  const rs = repos(); rs[K.lone].files["oats-membership.yaml"] = { schemaVersion: 2, workspace: "git:github.com/acme/private-ws" };
  const d = await discoverOrStandalone({ schemaVersion: 2, standalone: R.lone }, { remote: fakeRemote(rs) });
  assert.equal(d.standalone, true); assert.equal(d.standaloneReason, "explicit"); assert.equal(d.key, K.lone);
  assert.deepEqual(d.members[0].souls.map((s) => s.name), ["hermit"]);
  // and prepareInstance carries the standalone marker through (the shared contract)
  const prepared = await prepareInstance("/nonexistent", "hermit", { local: { schemaVersion: 2, standalone: R.lone }, remote: fakeRemote(rs) });
  assert.equal(prepared.discovery.standalone, true); assert.equal(prepared.discovery.standaloneReason, "explicit");
  assert.deepEqual(prepared.resolution.modules.map((m) => m.name), ["nw-secret-tool"]);
});

test("M7: readable host → workspace; access-denied host (auth / not-found) → standalone with standaloneReason unreadable-host; transient host failure (network / timeout) → the original error is rethrown, never a silent standalone", async () => {
  const local = { schemaVersion: 2, workspace: R.data }; // oats-local.yaml points at a MEMBER
  // readable host: the member's declared workspace is used
  const ws = await discoverOrStandalone(local, { remote: fakeRemote(repos()) });
  assert.equal(ws.standalone, undefined); assert.equal(ws.key, K.agents); assert.equal(ws.workspace.name, "northwind");
  assert.equal(ws.members.find((m) => m.key === K.data).confirmed, true);
  // access failures on the host → standalone, reason exposed
  for (const reason of ["auth", "not-found"]) {
    const d = await discoverOrStandalone(local, { remote: fakeRemote(repos({ host: { fail: reason } })) });
    assert.equal(d.standalone, true, reason); assert.equal(d.standaloneReason, "unreadable-host", reason);
    assert.equal(d.hostFailure.reason, reason); assert.equal(d.key, K.data);
    assert.deepEqual(d.members[0].souls.map((s) => s.name), ["data-analyst"]);
    assert.deepEqual(d.members[0].souls[0].capabilities, { "nw-warehouse-access": { from: "here" } });
  }
  // transient failures → rethrown as-is
  for (const reason of ["network", "timeout"]) {
    const err = await discoverOrStandalone(local, { remote: fakeRemote(repos({ host: { fail: reason } })) }).then(() => null, (e) => e);
    assert.ok(err, `${reason} must not fall back to standalone`);
    assert.equal(err.code, "E_REMOTE_UNREADABLE"); assert.equal(err.details.reason, reason); assert.equal(err.details.key, K.agents);
  }
  // an E_REMOTE_UNREADABLE without a reason is not an access failure either
  const bare = fakeRemote(repos());
  const orig = bare.observeRemote.bind(bare);
  bare.observeRemote = async (ref, o) => { if (parseRepoRef(ref).key === K.agents) throw detailed("E_REMOTE_UNREADABLE", "boom", { url: "x" }); return orig(ref, o); };
  await assert.rejects(discoverOrStandalone(local, { remote: bare }), (e) => e.code === "E_REMOTE_UNREADABLE" && e.details.reason === undefined);
  // a lone repo pointed at as `workspace:` is still the original not-a-host error (unchanged fallback rule)
  await assert.rejects(discoverOrStandalone({ schemaVersion: 2, workspace: R.lone }, { remote: fakeRemote(repos()) }), (e) => e.code === "E_WORKSPACE_SCHEMA" && e.details.notAHost === true);
});

test("findSoulEntry admits the standalone view's own (unconfirmed) row and refuses unconfirmed rows otherwise", async () => {
  const d = await discoverOrStandalone({ schemaVersion: 2, workspace: R.data }, { remote: fakeRemote(repos({ host: { fail: "auth" } })) });
  const e = findSoulEntry(d, "data-analyst");
  assert.equal(e.repoKey, K.data); assert.equal(e.external, false);
  assert.throws(() => findSoulEntry({ ...d, standalone: false }, "data-analyst"), (x) => x.code === "E_SOUL_UNKNOWN");
});

/* ───────────────────────────── ensureWorkspaceSoul refresh ────────────── */

test("ensureWorkspaceSoul: fetches the soul source once per (repo, commit), and a moved commit gets its OWN per-commit directory while the pointer swaps (H2 → M1)", { timeout: 180_000 }, async () => {
  const base = mkdtempSync(join(tmpdir(), "oats-ir-soul-"));
  try {
    const fx = await buildNorthwind(join(base, "fx"));
    const remoteOptions = { cacheDir: join(base, "cache") };
    const agentsRoot = join(base, "agents");
    const entry = (commit) => ({ name: "release-manager", repoKey: fx.keys.agents, commit, path: "souls/release-manager" });
    const p1 = { soulEntry: entry(fx.commits.agents), remoteOptions };
    const agentDir = join(agentsRoot, "release-manager");
    const pointer = join(agentDir, "soul");
    const c12 = (c) => String(c).slice(0, 12);
    // M1 (0.25.1): per-commit cache agents/<name>/souls/<commit12>/ (immutable, never removed);
    // agents/<name>/soul is an atomically swapped SYMLINK to the current commit's directory.
    const soulDir = await ensureWorkspaceSoul(p1, agentsRoot);
    assert.equal(soulDir, realpathSync(join(agentDir, "souls", c12(fx.commits.agents))));
    assert.ok(lstatSync(pointer).isSymbolicLink(), "agents/<name>/soul is the kernel pointer");
    assert.equal(realpathSync(pointer), soulDir);
    assert.ok(existsSync(join(soulDir, "soul.yaml")) && existsSync(join(soulDir, "AGENTS.md")) && existsSync(join(soulDir, "CLAUDE.md")));
    const stamp = () => JSON.parse(readFileSync(join(agentDir, ".oats-soul-source.json"), "utf8"));
    assert.equal(stamp().commit, fx.commits.agents);
    const before = readFileSync(join(soulDir, "AGENTS.md"), "utf8");
    // same commit → reused, not refetched (a local marker survives)
    writeFileSync(join(soulDir, ".marker"), "x");
    assert.equal(await ensureWorkspaceSoul(p1, agentsRoot), soulDir);
    assert.ok(existsSync(join(soulDir, ".marker")), "same commit: the per-commit dir is reused as is");
    // the soul moves upstream → a NEW per-commit dir; the pointer swaps; the OLD dir is untouched (a running instance links it)
    const moved = await moveMember(fx, "agents", async (work, { fs, path }) => {
      await fs.appendFile(path.join(work, "souls/release-manager/AGENTS.md"), "\n## Refreshed\n");
    });
    assert.notEqual(moved.commit, moved.previous);
    const p2 = { soulEntry: entry(moved.commit), remoteOptions };
    const soulDir2 = await ensureWorkspaceSoul(p2, agentsRoot);
    assert.equal(soulDir2, realpathSync(join(agentDir, "souls", c12(moved.commit))));
    assert.notEqual(soulDir2, soulDir);
    assert.match(readFileSync(join(soulDir2, "AGENTS.md"), "utf8"), /## Refreshed/);
    assert.equal(readFileSync(join(soulDir, "AGENTS.md"), "utf8"), before, "the previous commit's directory is untouched");
    assert.ok(existsSync(join(soulDir, ".marker")), "…including local state in it");
    assert.equal(realpathSync(pointer), soulDir2, "the pointer now shows the new commit");
    assert.equal(stamp().commit, moved.commit);
    const leftovers = readdirSync(join(agentDir, "souls")).filter((n) => n.startsWith("."));
    assert.deepEqual(leftovers, [], "no staging directories remain");
    // a damaged entry (soul.yaml gone) is set aside and refetched; the pointer still resolves
    rmSync(join(soulDir2, "soul.yaml"));
    const refetched = await ensureWorkspaceSoul(p2, agentsRoot);
    assert.ok(existsSync(join(refetched, "soul.yaml")));
    assert.equal(realpathSync(pointer), refetched);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
