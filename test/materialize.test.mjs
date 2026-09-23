/** lib/materialize.mjs — copy whole, compose, record (contract §5).
 *
 * The fetch is IN-MEMORY: a fixture map of (repoKey@commit:dir) → files, written to the
 * destination the way fetchRemoteTree would (staging dir + rename, exec bits from the
 * fixture). The digest it reports is the REAL lib/remote.mjs#contentDigest over what it
 * wrote, so the module under test verifies against the real framing. `remote` stays the
 * real lib/remote.mjs (parseRepoRef + contentDigest). No git, no network, no `oats setup`. */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { contentDigest } from "../lib/remote.mjs";
import { driftOf, materialize, refForKey } from "../lib/materialize.mjs";

const roots = [];
function scratch() { const d = mkdtempSync(join(tmpdir(), "oats-materialize-")); roots.push(d); return d; }
test.after(() => { for (const d of roots) rmSync(d, { recursive: true, force: true }); });
async function caughtAsync(promise) { try { await promise; } catch (e) { return e; } assert.fail("expected a rejection"); }

const COMMIT_A = "a".repeat(40), COMMIT_B = "b".repeat(40), COMMIT_P = "c".repeat(40);
const AGENTS_KEY = "github.com/northwind/agents";
const PLATFORM_KEY = "github.com/northwind/platform";
const PKG_KEY = "github.com/northwind/pkg-okf";

/** file spec: string → 0644 text; { text, exec: true } → 0755. */
const fixtures = {
  [`${AGENTS_KEY}@${COMMIT_A}:capabilities/nw-release-tooling`]: {
    "oats.json": JSON.stringify({ capability: "nw-release-tooling", version: "1.0.0", skills: ["skills/cut-release"], inject: "injects/release-policy.md" }),
    "skills/cut-release/SKILL.md": "---\nname: cut-release\ndescription: Cut a release.\n---\n\nRun `nw-release cut`.\n",
    "skills/cut-release/scripts/cut.sh": { text: "#!/bin/sh\necho cut\n", exec: true },
    "skills/cut-release/reference/notes/steps.md": "1. tag\n2. push\n",
    "injects/release-policy.md": "## Release policy\n\nEvery release is cut from main.\n",
    "bin/nw-release": { text: "#!/bin/sh\nexit 0\n", exec: true },
  },
  [`${PLATFORM_KEY}@${COMMIT_B}:capabilities/nw-house-style`]: {
    "oats.json": JSON.stringify({ capability: "nw-house-style", version: "0.2.0", inject: "injects/house-style.md" }),
    "injects/house-style.md": "## House style\n\nShort sentences.\n",
  },
  [`${PKG_KEY}@${COMMIT_P}:oats-package/capabilities/oats.okf`]: {
    "oats.json": JSON.stringify({ capability: "oats.okf", version: "2.1.3", layer: "knowledge", skills: ["skills"], inject: "injects/okf.md" }),
    "skills/okf/SKILL.md": "---\nname: okf\ndescription: Knowledge bundles.\n---\n\nValidate with okf-validate.\n",
    "skills/okf/scripts/okf-validate.mjs": { text: "#!/usr/bin/env node\nconsole.log('ok')\n", exec: true },
    "injects/okf.md": "## Knowledge (OKF)\n\nYour soul is a bundle.\n",
  },
};

/** An in-memory fetch with fetchRemoteTree's shape: (ref, commit, dir, destDir) → { files, bytes, digest }. */
function memoryFetch({ failOn, digestOf = contentDigest, calls = [] } = {}) {
  return async (ref, commit, dir, destDir) => {
    calls.push({ ref, commit, dir, destDir });
    const key = ref.startsWith("git:") ? ref.slice(4) : `local/${ref}`;
    const spec = fixtures[`${key}@${commit}:${dir}`];
    if (!spec) { const e = new Error(`${dir} missing in ${key}@${commit}`); e.code = "E_REMOTE_PATH_MISSING"; e.details = { path: dir, key, commit }; throw e; }
    if (failOn && key.endsWith(failOn)) throw Object.assign(new Error(`network down for ${key}`), { code: "E_REMOTE_UNREADABLE", details: { url: key, reason: "network" } });
    const staging = `${destDir}.tmp-${process.pid}`;
    mkdirSync(staging, { recursive: true, mode: 0o755 });
    let files = 0, bytes = 0;
    for (const [rel, value] of Object.entries(spec)) {
      const text = typeof value === "string" ? value : value.text;
      const target = join(staging, ...rel.split("/"));
      mkdirSync(dirname(target), { recursive: true, mode: 0o755 });
      writeFileSync(target, text, { mode: typeof value === "object" && value.exec ? 0o755 : 0o644 });
      files += 1; bytes += Buffer.byteLength(text);
    }
    renameSync(staging, destDir);
    return { files, bytes, digest: digestOf(destDir) };
  };
}

function makeHome(base, { soulAgents = "# Soul\n\nYou are the release expert.\n", instance } = {}) {
  const home = join(base, "instances", "release-expert-1");
  mkdirSync(join(home, "soul"), { recursive: true });
  writeFileSync(join(home, "soul", "AGENTS.md"), soulAgents);
  if (instance) writeFileSync(join(home, "instance.json"), JSON.stringify(instance, null, 2) + "\n");
  return home;
}

const LOCK = {
  lockfileVersion: 3,
  packages: {
    "oats.okf": { source: `git:${PKG_KEY}@v2.1.3`, path: "oats-package", version: "2.1.3", commit: COMMIT_P, integrity: `sha256-${"0".repeat(64)}`, capabilities: ["oats.okf"], approved: { executables: `sha256-${"1".repeat(64)}`, at: "2026-09-23T00:00:00.000Z" } },
  },
};

function resolution({ modules, skills, injects, payloads } = {}) {
  return {
    resolutionApi: 1,
    soul: { name: "release-expert", repoKey: AGENTS_KEY, commit: COMMIT_A, team: "engineering", path: "souls/release-expert" },
    modules: modules ?? [
      { name: "nw-release-tooling", from: { kind: "member", repoKey: AGENTS_KEY, commit: COMMIT_A }, manifest: { capability: "nw-release-tooling", version: "1.0.0", skills: ["skills/cut-release"], inject: "injects/release-policy.md" }, layer: null, private: false },
      { name: "nw-house-style", from: { kind: "member", repoKey: PLATFORM_KEY, commit: COMMIT_B }, manifest: { capability: "nw-house-style", version: "0.2.0", inject: "injects/house-style.md" }, layer: null, private: false },
      { name: "oats.okf", from: { kind: "package", package: "oats.okf", version: "2.1.3", commit: COMMIT_P, integrity: LOCK.packages["oats.okf"].integrity }, manifest: { capability: "oats.okf", version: "2.1.3", layer: "knowledge", skills: ["skills"], inject: "injects/okf.md" }, layer: "knowledge", private: false },
    ],
    slots: { knowledge: "oats.okf", messaging: null, tasks: null },
    payloads: payloads ?? { "oats.okf": { bundle: "soul/knowledge" } },
    skills: skills ?? [
      { module: "nw-release-tooling", name: "cut-release", path: "skills/cut-release" },
      { module: "oats.okf", name: "okf", path: "skills/okf" },
    ],
    injects: injects ?? [
      { module: "nw-release-tooling", path: "injects/release-policy.md" },
      { module: "nw-house-style", path: "injects/house-style.md" },
      { module: "oats.okf", path: "injects/okf.md" },
    ],
    revision: "0123456789abcdef01234567",
  };
}

function listAll(dir, prefix = "") {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name), rel = prefix ? `${prefix}/${name}` : name, st = lstatSync(p);
    out.push(rel + (st.isDirectory() ? "/" : st.isSymbolicLink() ? "@" : ""));
    if (st.isDirectory()) out.push(...listAll(p, rel));
  }
  return out;
}

/* ───────────────────────────── happy path ─────────────────────────────── */

test("materialize: whole-copy layout — modules, skills copied (not linked), exec bit, AGENTS.md markers, aliases, instance.json", async () => {
  const base = scratch();
  const home = makeHome(base, { instance: { instance: "release-expert-1", agent: "release-expert", createdAt: "2026-09-23T10:00:00.000Z", backend: "tmux" } });
  const calls = [];
  const kernelBlock = { source: "kernel:instance-boundary", file: "/framework/injects/instance-boundary.md", content: "## Your two directories\n\nHome and work." };
  const out = await materialize(resolution(), home, {
    fetch: memoryFetch({ calls }), lock: LOCK, blocks: [kernelBlock], now: () => "2026-09-23T12:00:00.000Z",
  });

  // Sources fetched exactly per contract: member → capabilities/<name>; package → <lock.path>/capabilities/<name>.
  assert.deepEqual(calls.map((c) => [c.ref, c.commit, c.dir]), [
    [`git:${AGENTS_KEY}`, COMMIT_A, "capabilities/nw-release-tooling"],
    [`git:${PLATFORM_KEY}`, COMMIT_B, "capabilities/nw-house-style"],
    [`git:${PKG_KEY}`, COMMIT_P, "oats-package/capabilities/oats.okf"],
  ]);
  for (const c of calls) assert.ok(c.destDir.includes(`${join(".oats", ".staging-")}`), "fetch writes into the staging dir, never the final path");

  // Modules: whole capability dirs, including bin/ and oats.json.
  const modulesRoot = join(home, ".oats", "modules");
  assert.deepEqual(readdirSync(modulesRoot).sort(), ["nw-house-style", "nw-release-tooling", "oats.okf"]);
  assert.ok(statSync(join(modulesRoot, "nw-release-tooling", "bin", "nw-release")).isFile());
  assert.ok(statSync(join(modulesRoot, "nw-release-tooling", "oats.json")).isFile());
  assert.equal(statSync(join(modulesRoot, "nw-release-tooling", "bin", "nw-release")).mode & 0o111, 0o111);
  for (const m of out.modules) {
    assert.equal(m.digest, contentDigest(join(modulesRoot, m.name)), `${m.name} recorded digest is the on-disk digest`);
    assert.match(m.digest, /^sha256-[0-9a-f]{64}$/);
  }
  assert.deepEqual(out.modules.map((m) => m.name), ["nw-release-tooling", "nw-house-style", "oats.okf"]);
  assert.equal(out.modules[2].from.kind, "package");

  // Skills: FULL copies under .agents/skills/<module>/<skill>/, nested dirs and exec bits preserved.
  const skillsRoot = join(home, ".agents", "skills");
  assert.deepEqual(readdirSync(skillsRoot).sort(), ["nw-release-tooling", "oats.okf"], "a module without skills gets no skills dir");
  const cut = join(skillsRoot, "nw-release-tooling", "cut-release");
  assert.ok(lstatSync(join(skillsRoot, "nw-release-tooling")).isDirectory() && !lstatSync(join(skillsRoot, "nw-release-tooling")).isSymbolicLink());
  assert.ok(lstatSync(cut).isDirectory() && !lstatSync(cut).isSymbolicLink(), "skill dir is a real directory");
  assert.ok(lstatSync(join(cut, "SKILL.md")).isFile() && !lstatSync(join(cut, "SKILL.md")).isSymbolicLink(), "skill files are copies");
  assert.equal(readFileSync(join(cut, "SKILL.md"), "utf8"), fixtures[`${AGENTS_KEY}@${COMMIT_A}:capabilities/nw-release-tooling`]["skills/cut-release/SKILL.md"]);
  assert.equal(readFileSync(join(cut, "reference", "notes", "steps.md"), "utf8"), "1. tag\n2. push\n", "nested dirs copied");
  assert.equal(statSync(join(cut, "scripts", "cut.sh")).mode & 0o111, 0o111, "executable bit kept on the copied script");
  assert.equal(statSync(join(cut, "SKILL.md")).mode & 0o111, 0, "non-executables stay non-executable");
  assert.equal(statSync(join(skillsRoot, "oats.okf", "okf", "scripts", "okf-validate.mjs")).mode & 0o111, 0o111);
  assert.deepEqual(out.skills.map((s) => [s.module, s.name]), [["nw-release-tooling", "cut-release"], ["oats.okf", "okf"]]);
  assert.equal(out.skills[0].path, cut);
  assert.ok(!listAll(home).some((p) => p.endsWith("@") && !/^(CLAUDE\.md|\.claude\/skills)@$/.test(p)), `no symlinks besides the two aliases: ${listAll(home).filter((p) => p.endsWith("@"))}`);

  // AGENTS.md: soul body first, then the caller's kernel block, then each module's inject in module order, same markers as the kernel.
  const agents = readFileSync(join(home, "AGENTS.md"), "utf8");
  assert.equal(out.agentsMd, join(home, "AGENTS.md"));
  assert.ok(agents.startsWith("# Soul\n\nYou are the release expert.\n"));
  const markers = [...agents.matchAll(/<!-- (\/?)oats:([^ >]+)(?: src=([^ >]+))? -->/g)].map((m) => [m[1] ? "close" : "open", m[2], m[3]]);
  assert.deepEqual(markers, [
    ["open", "kernel:instance-boundary", "/framework/injects/instance-boundary.md"], ["close", "kernel:instance-boundary", undefined],
    ["open", "capability:nw-release-tooling", join(modulesRoot, "nw-release-tooling", "injects", "release-policy.md")], ["close", "capability:nw-release-tooling", undefined],
    ["open", "capability:nw-house-style", join(modulesRoot, "nw-house-style", "injects", "house-style.md")], ["close", "capability:nw-house-style", undefined],
    ["open", "capability:oats.okf", join(modulesRoot, "oats.okf", "injects", "okf.md")], ["close", "capability:oats.okf", undefined],
  ]);
  assert.ok(agents.includes("\n<!-- oats:capability:nw-release-tooling src="), "marker format matches lib/instruction-composition.mjs");
  assert.ok(agents.includes("## Release policy\n\nEvery release is cut from main.\n<!-- /oats:capability:nw-release-tooling -->"));
  for (const m of markers) if (m[2]) assert.ok(existsSync(m[2]) || m[1].startsWith("kernel"), `src ${m[2]} points at the materialized module file`);

  // Aliases: relative symlinks.
  assert.ok(lstatSync(join(home, "CLAUDE.md")).isSymbolicLink());
  assert.equal(readlinkSync(join(home, "CLAUDE.md")), "AGENTS.md");
  assert.ok(lstatSync(join(home, ".claude", "skills")).isSymbolicLink());
  assert.equal(readlinkSync(join(home, ".claude", "skills")), join("..", ".agents", "skills"));
  assert.equal(readFileSync(join(home, ".claude", "skills", "nw-release-tooling", "cut-release", "SKILL.md"), "utf8"), readFileSync(join(cut, "SKILL.md"), "utf8"));

  // instance.json: modules + providers recorded, existing keys preserved.
  const ij = JSON.parse(readFileSync(join(home, "instance.json"), "utf8"));
  assert.equal(ij.instance, "release-expert-1");
  assert.equal(ij.agent, "release-expert");
  assert.equal(ij.createdAt, "2026-09-23T10:00:00.000Z");
  assert.equal(ij.backend, "tmux");
  assert.deepEqual(Object.keys(ij.modules).sort(), ["nw-house-style", "nw-release-tooling", "oats.okf"]);
  assert.deepEqual(ij.modules["nw-release-tooling"], {
    from: { kind: "member", repoKey: AGENTS_KEY, commit: COMMIT_A }, commit: COMMIT_A,
    digest: contentDigest(join(modulesRoot, "nw-release-tooling")), materializedAt: "2026-09-23T12:00:00.000Z",
  });
  assert.equal(ij.modules["oats.okf"].from.kind, "package");
  assert.equal(ij.modules["oats.okf"].commit, COMMIT_P);
  assert.deepEqual(ij.providers, { "oats.okf": { bundle: "soul/knowledge" } });
  assert.equal(ij.resolutionRevision, "0123456789abcdef01234567");
  assert.deepEqual(out.instanceJson, ij);

  // Nothing staged is left behind.
  assert.deepEqual(readdirSync(join(home, ".oats")), ["modules"]);
});

test("materialize: manifest fallback enumerates skills when the resolution carries no skill rows", async () => {
  const base = scratch();
  const home = makeHome(base);
  const res = resolution({ skills: [], injects: [] }); // fall back to manifests
  const out = await materialize(res, home, { fetch: memoryFetch(), lock: LOCK });
  assert.deepEqual(out.skills.map((s) => [s.module, s.name]), [["nw-release-tooling", "cut-release"], ["oats.okf", "okf"]]);
  const agents = readFileSync(join(home, "AGENTS.md"), "utf8");
  assert.ok(agents.includes("<!-- oats:capability:nw-house-style src=") && agents.includes("## House style"));
});

test("materialize: package repo derived from the lock's git: source and from a catalog source; from.repoKey wins", async () => {
  const base = scratch();
  const only = (extra) => resolution({ modules: [{ name: "oats.okf", from: { kind: "package", package: "oats.okf", version: "2.1.3", commit: COMMIT_P, ...extra }, manifest: { capability: "oats.okf", version: "2.1.3" } }], skills: [], injects: [], payloads: {} });
  // git: source in the lock
  const h1 = makeHome(join(base, "one")); const c1 = [];
  await materialize(only(), h1, { fetch: memoryFetch({ calls: c1 }), lock: LOCK });
  assert.deepEqual(c1.map((c) => [c.ref, c.dir]), [[`git:${PKG_KEY}`, "oats-package/capabilities/oats.okf"]]);
  // catalog source → options.catalog[id].url
  const catalogLock = { lockfileVersion: 3, packages: { "oats.okf": { ...LOCK.packages["oats.okf"], source: "catalog:oats.okf" } } };
  const h2 = makeHome(join(base, "two")); const c2 = [];
  await materialize(only(), h2, { fetch: memoryFetch({ calls: c2 }), lock: catalogLock, catalog: { "oats.okf": { url: `https://${PKG_KEY}.git`, ref: "v2.1.3", path: "oats-package" } } });
  assert.deepEqual(c2.map((c) => [c.ref, c.dir]), [[`git:${PKG_KEY}`, "oats-package/capabilities/oats.okf"]]);
  // no way to know the repo → E_MATERIALIZE_SOURCE, home untouched
  const h3 = makeHome(join(base, "three"));
  const e = await caughtAsync(materialize(only(), h3, { fetch: memoryFetch(), lock: catalogLock }));
  assert.equal(e.code, "E_MATERIALIZE_SOURCE");
  assert.equal(e.details.package, "oats.okf");
  assert.deepEqual(listAll(h3), ["soul/", "soul/AGENTS.md"]);
  // from.repoKey recorded by the resolver wins over the lock
  const h4 = makeHome(join(base, "four")); const c4 = [];
  await materialize(only({ repoKey: PKG_KEY }), h4, { fetch: memoryFetch({ calls: c4 }), lock: catalogLock });
  assert.deepEqual(c4.map((c) => c.ref), [`git:${PKG_KEY}`]);
  // lock commit disagreeing with the resolution's pin → integrity
  const moved = { lockfileVersion: 3, packages: { "oats.okf": { ...LOCK.packages["oats.okf"], commit: COMMIT_B } } };
  const h5 = makeHome(join(base, "five"));
  const e5 = await caughtAsync(materialize(only(), h5, { fetch: memoryFetch(), lock: moved }));
  assert.equal(e5.code, "E_MATERIALIZE_INTEGRITY");
  assert.equal(e5.details.why, "lock");
  assert.equal(e5.provenance.why, "lock", "details reachable as provenance too");
});

/* ───────────────────────────── failure atomicity ─────────────────────────────── */

test("materialize: a fetch that throws midway leaves the home untouched and no staging dir", async () => {
  const base = scratch();
  const instance = { instance: "release-expert-1", createdAt: "2026-09-23T10:00:00.000Z" };
  const home = makeHome(base, { instance });
  const before = listAll(home);
  const calls = [];
  const e = await caughtAsync(materialize(resolution(), home, { fetch: memoryFetch({ failOn: "platform", calls }), lock: LOCK }));
  assert.equal(e.code, "E_REMOTE_UNREADABLE");
  assert.equal(calls.length, 2, "the first module was fetched, the second failed, the third was never attempted");
  assert.deepEqual(listAll(home), before, "home is exactly as it was");
  assert.ok(!existsSync(join(home, ".oats")), ".oats created only for staging is removed again");
  assert.ok(!existsSync(join(home, ".agents")));
  assert.ok(!existsSync(join(home, "AGENTS.md")));
  assert.ok(!existsSync(join(home, "CLAUDE.md")));
  assert.deepEqual(JSON.parse(readFileSync(join(home, "instance.json"), "utf8")), instance);
});

test("materialize: a pre-existing .oats/ survives a failure; only our staging dir is removed", async () => {
  const base = scratch();
  const home = makeHome(base);
  mkdirSync(join(home, ".oats"));
  writeFileSync(join(home, ".oats", "history.jsonl"), "");
  const e = await caughtAsync(materialize(resolution(), home, { fetch: memoryFetch({ failOn: "platform" }), lock: LOCK }));
  assert.equal(e.code, "E_REMOTE_UNREADABLE");
  assert.deepEqual(readdirSync(join(home, ".oats")), ["history.jsonl"]);
});

test("materialize: a capability absent at the source is E_CAPABILITY_MISSING and leaves nothing", async () => {
  const base = scratch();
  const home = makeHome(base);
  const res = resolution({ modules: [{ name: "nw-nope", from: { kind: "member", repoKey: AGENTS_KEY, commit: COMMIT_A }, manifest: {} }], skills: [], injects: [] });
  const e = await caughtAsync(materialize(res, home, { fetch: memoryFetch() }));
  assert.equal(e.code, "E_CAPABILITY_MISSING");
  assert.equal(e.details.path, "capabilities/nw-nope");
  assert.deepEqual(listAll(home), ["soul/", "soul/AGENTS.md"]);
});

test("materialize: digest mismatch between fetch report and the copy → E_MATERIALIZE_INTEGRITY, nothing left", async () => {
  const base = scratch();
  const home = makeHome(base);
  const lying = memoryFetch({ digestOf: () => `sha256-${"f".repeat(64)}` });
  const e = await caughtAsync(materialize(resolution(), home, { fetch: lying, lock: LOCK }));
  assert.equal(e.code, "E_MATERIALIZE_INTEGRITY");
  assert.equal(e.details.module, "nw-release-tooling");
  assert.equal(e.details.why, "copy");
  assert.equal(e.details.expected, `sha256-${"f".repeat(64)}`);
  assert.equal(e.details.actual, contentDigestOfFixture(`${AGENTS_KEY}@${COMMIT_A}:capabilities/nw-release-tooling`));
  assert.deepEqual(listAll(home), ["soul/", "soul/AGENTS.md"]);
});

test("materialize: a resolution-pinned module.digest that disagrees with the copy → E_MATERIALIZE_INTEGRITY (why: resolution)", async () => {
  const base = scratch();
  const home = makeHome(base);
  const res = resolution();
  res.modules[1].digest = `sha256-${"e".repeat(64)}`;
  const e = await caughtAsync(materialize(res, home, { fetch: memoryFetch(), lock: LOCK }));
  assert.equal(e.code, "E_MATERIALIZE_INTEGRITY");
  assert.equal(e.details.module, "nw-house-style");
  assert.equal(e.details.why, "resolution");
  assert.deepEqual(listAll(home), ["soul/", "soul/AGENTS.md"]);
  // and a matching pin passes, recording it
  const home2 = makeHome(join(base, "two"));
  const res2 = resolution();
  res2.modules[1].digest = contentDigestOfFixture(`${PLATFORM_KEY}@${COMMIT_B}:capabilities/nw-house-style`);
  const out = await materialize(res2, home2, { fetch: memoryFetch(), lock: LOCK });
  assert.equal(out.modules[1].digest, res2.modules[1].digest);
});

/** Digest of a fixture spec as fetchRemoteTree would report it (computed by writing it once). */
function contentDigestOfFixture(id) {
  const d = mkdtempSync(join(tmpdir(), "oats-materialize-fx-")); roots.push(d);
  const dest = join(d, "tree");
  mkdirSync(dest);
  for (const [rel, value] of Object.entries(fixtures[id])) {
    const text = typeof value === "string" ? value : value.text;
    const target = join(dest, ...rel.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text, { mode: typeof value === "object" && value.exec ? 0o755 : 0o644 });
  }
  return contentDigest(dest);
}

test("materialize: duplicate skill names across modules → E_SKILL_DUPLICATE naming both; declared-but-missing skill/inject → E_MATERIALIZE_RESOLUTION", async () => {
  const base = scratch();
  const home = makeHome(base);
  const dup = resolution({ skills: [
    { module: "nw-release-tooling", name: "cut-release", path: "skills/cut-release" },
    { module: "oats.okf", name: "cut-release", path: "skills/okf" },
  ] });
  const e = await caughtAsync(materialize(dup, home, { fetch: memoryFetch(), lock: LOCK }));
  assert.equal(e.code, "E_SKILL_DUPLICATE");
  assert.deepEqual(e.details, { name: "cut-release", modules: ["nw-release-tooling", "oats.okf"] });
  assert.deepEqual(listAll(home), ["soul/", "soul/AGENTS.md"]);

  const missingSkill = resolution({ skills: [{ module: "nw-house-style", name: "ghost", path: "skills/ghost" }] });
  const e2 = await caughtAsync(materialize(missingSkill, home, { fetch: memoryFetch(), lock: LOCK }));
  assert.equal(e2.code, "E_MATERIALIZE_RESOLUTION");
  assert.equal(e2.details.skill, "ghost");

  const escaping = resolution({ skills: [{ module: "nw-house-style", name: "x", path: "../../etc" }] });
  const e3 = await caughtAsync(materialize(escaping, home, { fetch: memoryFetch(), lock: LOCK }));
  assert.equal(e3.code, "E_MATERIALIZE_RESOLUTION");
  assert.match(e3.message, /does not stay inside the module/);

  const missingInject = resolution({ injects: [{ module: "nw-house-style", path: "injects/nope.md" }] });
  const e4 = await caughtAsync(materialize(missingInject, home, { fetch: memoryFetch(), lock: LOCK }));
  assert.equal(e4.code, "E_MATERIALIZE_RESOLUTION");
  assert.equal(e4.details.path, "injects/nope.md");
  assert.deepEqual(listAll(home), ["soul/", "soul/AGENTS.md"]);
});

test("materialize: refuses to overwrite a module already in the home; invalid resolution / missing home are named errors", async () => {
  const base = scratch();
  const home = makeHome(base);
  mkdirSync(join(home, ".oats", "modules", "nw-house-style"), { recursive: true });
  const e = await caughtAsync(materialize(resolution(), home, { fetch: memoryFetch(), lock: LOCK }));
  assert.equal(e.code, "E_MATERIALIZE_HOME");
  assert.equal(e.details.module, "nw-house-style");
  assert.deepEqual(readdirSync(join(home, ".oats")), ["modules"], "nothing staged when preflight refuses");

  const e2 = await caughtAsync(materialize({ resolutionApi: 2, modules: [] }, home, { fetch: memoryFetch() }));
  assert.equal(e2.code, "E_MATERIALIZE_RESOLUTION");
  const e3 = await caughtAsync(materialize(resolution({ modules: [{ name: "../evil", from: { kind: "member", repoKey: AGENTS_KEY, commit: COMMIT_A } }] }), home, { fetch: memoryFetch() }));
  assert.equal(e3.code, "E_MATERIALIZE_RESOLUTION");
  assert.equal(e3.details.path, "/modules/0/name");
  const e4 = await caughtAsync(materialize(resolution(), join(base, "nowhere"), { fetch: memoryFetch(), lock: LOCK }));
  assert.equal(e4.code, "E_MATERIALIZE_HOME");
});

/* ───────────────────────────── instance.json merge & aliases ─────────────────────────────── */

test("materialize: instance.json merge preserves other keys and replaces modules/providers; soul body from options; aliases kept when present", async () => {
  const base = scratch();
  const home = join(base, "home");
  mkdirSync(join(home, ".claude"), { recursive: true });
  // No soul/ link in this home: body comes from options.soulAgentsMd. Pre-existing aliases point elsewhere and must be left alone.
  writeFileSync(join(home, "instance.json"), JSON.stringify({
    instance: "x-1", parent: "coordinator-3", work: { mode: "worktree", path: "/tmp/wt" },
    modules: { stale: { from: { kind: "member", repoKey: "old", commit: COMMIT_B }, commit: COMMIT_B, digest: "sha256-00", materializedAt: "2020-01-01T00:00:00.000Z" } },
    providers: { "oats.aweb": { seat: "retained" } },
  }));
  writeFileSync(join(home, "CLAUDE.md"), "custom alias content\n");
  const { symlinkSync } = await import("node:fs");
  symlinkSync(join("..", "elsewhere"), join(home, ".claude", "skills"));
  const res = resolution({ modules: [{ name: "nw-house-style", from: { kind: "member", repoKey: PLATFORM_KEY, commit: COMMIT_B }, manifest: { inject: "injects/house-style.md" } }], skills: [], injects: [], payloads: { "nw-house-style": { tone: "dry" } } });
  const out = await materialize(res, home, { fetch: memoryFetch(), soulAgentsMd: "# From options\n" });
  const ij = JSON.parse(readFileSync(join(home, "instance.json"), "utf8"));
  assert.equal(ij.instance, "x-1");
  assert.equal(ij.parent, "coordinator-3");
  assert.deepEqual(ij.work, { mode: "worktree", path: "/tmp/wt" });
  assert.deepEqual(Object.keys(ij.modules), ["nw-house-style"], "modules is REPLACED by this materialization (no stale rows)");
  assert.deepEqual(ij.providers, { "nw-house-style": { tone: "dry" } }, "providers = resolution.payloads");
  assert.ok(readFileSync(join(home, "AGENTS.md"), "utf8").startsWith("# From options\n"));
  assert.equal(readFileSync(join(home, "CLAUDE.md"), "utf8"), "custom alias content\n", "an existing CLAUDE.md is not replaced");
  assert.equal(readlinkSync(join(home, ".claude", "skills")), join("..", "elsewhere"), "an existing .claude/skills is not replaced");
  assert.equal(out.skills.length, 0);
  assert.ok(!existsSync(join(home, ".agents", "skills", "nw-house-style")), "no skills dir for a module without skills");
  assert.ok(lstatSync(join(home, ".agents", "skills")).isDirectory(), "the canonical skills root exists regardless");
});

test("materialize: AGENTS.md body may come from options.soulDir; a missing body is E_MATERIALIZE_RESOLUTION before anything is fetched", async () => {
  const base = scratch();
  const home = join(base, "home"); mkdirSync(home);
  const soulDir = join(base, "souls", "x"); mkdirSync(soulDir, { recursive: true });
  writeFileSync(join(soulDir, "AGENTS.md"), "# Soul from dir\n");
  const calls = [];
  const e = await caughtAsync(materialize(resolution(), home, { fetch: memoryFetch({ calls }), lock: LOCK }));
  assert.equal(e.code, "E_MATERIALIZE_RESOLUTION");
  assert.equal(calls.length, 0);
  assert.deepEqual(listAll(home), []);
  await materialize(resolution(), home, { fetch: memoryFetch(), lock: LOCK, soulDir });
  assert.ok(readFileSync(join(home, "AGENTS.md"), "utf8").startsWith("# Soul from dir\n"));
});

/* ───────────────────────────── driftOf ─────────────────────────────── */

test("driftOf: current / moved / missing (unconfirmed member, capability absent); packages against the lock", () => {
  const instanceJson = {
    modules: {
      "nw-release-tooling": { from: { kind: "member", repoKey: AGENTS_KEY, commit: COMMIT_A }, commit: COMMIT_A, digest: "sha256-x", materializedAt: "t" },
      "nw-house-style": { from: { kind: "member", repoKey: PLATFORM_KEY, commit: COMMIT_B }, commit: COMMIT_B, digest: "sha256-y", materializedAt: "t" },
      "nw-brand-voice": { from: { kind: "member", repoKey: "github.com/northwind/marketing", commit: COMMIT_B }, commit: COMMIT_B, digest: "sha256-z", materializedAt: "t" },
      "nw-warehouse-access": { from: { kind: "member", repoKey: "github.com/northwind/data", commit: COMMIT_B }, commit: COMMIT_B, digest: "sha256-w", materializedAt: "t" },
      "oats.okf": { from: { kind: "package", package: "oats.okf", version: "2.1.3", commit: COMMIT_P }, commit: COMMIT_P, digest: "sha256-p", materializedAt: "t" },
    },
  };
  const NEW = "d".repeat(40);
  const discovery = {
    members: [
      { key: AGENTS_KEY, commit: COMMIT_A, confirmed: true, capabilities: [{ name: "nw-release-tooling" }] },
      { key: PLATFORM_KEY, commit: NEW, confirmed: true, capabilities: [{ name: "nw-house-style" }] },
      { key: "github.com/northwind/marketing", commit: NEW, confirmed: true, capabilities: [{ name: "nw-campaign-metrics" }] }, // capability removed
      { key: "github.com/northwind/data", commit: null, confirmed: false, reason: "cannot-read" },
    ],
  };
  const rows = driftOf(instanceJson, discovery);
  const byName = Object.fromEntries(rows.map((r) => [r.module, r]));
  assert.deepEqual(rows.map((r) => r.module), ["nw-brand-voice", "nw-house-style", "nw-release-tooling", "nw-warehouse-access", "oats.okf"], "sorted by module");
  assert.equal(byName["nw-release-tooling"].status, "current");
  assert.deepEqual(byName["nw-release-tooling"].recorded, { repoKey: AGENTS_KEY, commit: COMMIT_A });
  assert.deepEqual(byName["nw-release-tooling"].current, { commit: COMMIT_A });
  assert.equal(byName["nw-house-style"].status, "moved");
  assert.deepEqual(byName["nw-house-style"].current, { commit: NEW });
  assert.equal(byName["nw-brand-voice"].status, "missing");
  assert.equal(byName["nw-brand-voice"].reason, "capability-absent");
  assert.deepEqual(byName["nw-brand-voice"].current, { commit: NEW }, "the member's current commit is still reported");
  assert.equal(byName["nw-warehouse-access"].status, "missing");
  assert.equal(byName["nw-warehouse-access"].reason, "cannot-read");
  assert.equal(byName["nw-warehouse-access"].current, null);
  // a member no longer listed at all
  const gone = driftOf(instanceJson, { members: [] });
  assert.ok(gone.every((r) => r.from.kind === "package" || (r.status === "missing" && r.reason === "unconfirmed")));
  // packages: no lock → current; lock decides otherwise
  assert.equal(byName["oats.okf"].status, "current");
  const withLock = Object.fromEntries(driftOf(instanceJson, discovery, { lock: LOCK }).map((r) => [r.module, r]));
  assert.equal(withLock["oats.okf"].status, "current");
  assert.deepEqual(withLock["oats.okf"].current, { commit: COMMIT_P, version: "2.1.3" });
  const bumped = { lockfileVersion: 3, packages: { "oats.okf": { ...LOCK.packages["oats.okf"], version: "2.2.0", commit: NEW } } };
  assert.equal(Object.fromEntries(driftOf(instanceJson, discovery, { lock: bumped }).map((r) => [r.module, r]))["oats.okf"].status, "moved");
  const dropped = { lockfileVersion: 3, packages: {} };
  const d = Object.fromEntries(driftOf(instanceJson, discovery, { lock: dropped }).map((r) => [r.module, r]))["oats.okf"];
  assert.equal(d.status, "missing"); assert.equal(d.reason, "package-absent");
  // empty / malformed input → no rows, no throw
  assert.deepEqual(driftOf({}, discovery), []);
  assert.deepEqual(driftOf(null, null), []);
});

test("refForKey: hosted keys → git:<key>; local keys → the absolute path", () => {
  assert.equal(refForKey("github.com/org/repo"), "git:github.com/org/repo");
  assert.equal(refForKey("local//tmp/remotes/agents.git"), "/tmp/remotes/agents.git");
});

/* ───────────────────────────── default fetch: real lib/remote.mjs over a local bare repo ─────────────────────────────── */

test("materialize: default fetch (remote.fetchRemoteTree) copies a member capability from a real bare repo; remoteOptions.cacheDir threaded", async () => {
  const { execFileSync } = await import("node:child_process");
  const base = scratch();
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
    GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" };
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] }).toString("utf8").trim();
  const bare = join(base, "agents.git"), work = join(base, "work");
  git(base, "init", "-q", "--bare", "-b", "main", bare);
  git(base, "init", "-q", "-b", "main", work);
  mkdirSync(join(work, "capabilities", "nw-x", "skills", "do-x", "scripts"), { recursive: true });
  mkdirSync(join(work, "capabilities", "nw-x", "injects"), { recursive: true });
  writeFileSync(join(work, "capabilities", "nw-x", "oats.json"), JSON.stringify({ capability: "nw-x", version: "1.0.0", skills: ["skills/do-x"], inject: "injects/x.md" }));
  writeFileSync(join(work, "capabilities", "nw-x", "skills", "do-x", "SKILL.md"), "---\nname: do-x\ndescription: X.\n---\n\nDo x.\n");
  writeFileSync(join(work, "capabilities", "nw-x", "skills", "do-x", "scripts", "x.sh"), "#!/bin/sh\necho x\n", { mode: 0o755 });
  writeFileSync(join(work, "capabilities", "nw-x", "injects", "x.md"), "## X\n\nInject x.\n");
  git(work, "add", "-A"); git(work, "commit", "-q", "-m", "cap"); git(work, "remote", "add", "origin", bare); git(work, "push", "-q", "origin", "HEAD:main");
  const commit = git(work, "rev-parse", "HEAD");
  const key = `local/${bare}`;

  const home = makeHome(base);
  const cacheDir = join(base, "cache");
  const res = resolution({ modules: [{ name: "nw-x", from: { kind: "member", repoKey: key, commit }, manifest: { capability: "nw-x", version: "1.0.0", skills: ["skills/do-x"], inject: "injects/x.md" } }], skills: [], injects: [], payloads: {} });
  const out = await materialize(res, home, { remoteOptions: { cacheDir } });
  assert.ok(existsSync(cacheDir), "the remote cache lives where remoteOptions said, not under ~/.cache");
  assert.equal(out.modules[0].digest, contentDigest(join(home, ".oats", "modules", "nw-x")));
  assert.equal(statSync(join(home, ".agents", "skills", "nw-x", "do-x", "scripts", "x.sh")).mode & 0o111, 0o111);
  assert.ok(readFileSync(join(home, "AGENTS.md"), "utf8").includes("<!-- oats:capability:nw-x src="));
  assert.equal(JSON.parse(readFileSync(join(home, "instance.json"), "utf8")).modules["nw-x"].from.repoKey, key);
});
