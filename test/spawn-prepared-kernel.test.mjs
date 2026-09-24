// lib/core.mjs — the KERNEL half of a prepared (workspace-model) spawn, in-process over the
// Northwind fixture (adversarial-review fix round, findings H1 M1 M2 M3 M11 M16 S1).
//
//   H1  a prepared spawn runs with the resolution's capability rows: instance.json.capabilities
//       and capabilityRuntime carry one row per module, the oats.okf spawn hook (required:true)
//       RUNS and is recorded on the `spawned` event, and retire runs (and records) the retire hook.
//   M1  materialize → launch is one rollback: a failure after the home is populated removes it
//       whole, and a retry gets the SAME instance name (no auto-suffix -2). Backend presence is
//       checked before anything is placed.
//   M2  recompose on a home with materialized modules is refused (E_UNSUPPORTED_MODE), never
//       silently stripped of its capability blocks.
//   M3  preview == apply: capabilities[] are {name, origin} from the resolution's modules and
//       skills[] include every module skill as {name, source: "module:<cap>"}.
//   M11 workspace.key is the discovery's key (never null) and workspace.standalone is recorded,
//       in the preview, the composed resolved view and instance.json.
//   M16 E_REQUIREMENT_INACTIVE's remedy names oats-local.yaml + oats sync, not removed verbs.
//   S1  meta.instructions and composition.expected include the capability blocks materialize
//       appended (read back from the written AGENTS.md).
//
// Uses prepareInstance/ensureWorkspaceSoul from lib/instance-resolution.mjs exactly as bin does,
// then spawnInstanceAsync directly. Never bare `oats setup`; HOME and the remote cache are isolated.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildNorthwind } from "./fixtures/northwind/build.mjs";
import { prepareInstance, ensureWorkspaceSoul, toCapabilityRows, modulesPreview, materializePrepared } from "../lib/instance-resolution.mjs";
import { spawnInstanceAsync, findAgent, retireInstance, recomposeInstanceInstructions, composeInstanceAgentsMd, planInstanceResources } from "../lib/core.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const HEX40 = /^[0-9a-f]{40}$/;
const EXPECTED_MODULES = ["nw-deploy", "nw-house-style", "nw-release-tooling", "oats.core", "oats.okf"];

/** Build the fixture + a deployment and run `oats sync` (child process, like an operator).
 *  Returns everything a spawn needs. */
async function deployment() {
  const base = mkdtempSync(join(tmpdir(), "oats-prepared-kernel-"));
  if (/[\s@]/.test(base)) { rmSync(base, { recursive: true, force: true }); throw new Error(`tmpdir ${base} contains whitespace or @`); }
  const fx = await buildNorthwind(join(base, "fx"));
  const catalogFile = join(base, "catalog.json");
  writeFileSync(catalogFile, JSON.stringify({ packages: fx.catalog }, null, 2));
  const dep = join(base, "northwind-workspace");
  const root = join(dep, "agents");
  mkdirSync(root, { recursive: true });
  mkdirSync(join(base, "home"));
  writeFileSync(join(dep, "oats-local.yaml"), `schemaVersion: 2\nworkspace: ${fx.refs.agents}\n`);
  const env = { ...process.env, PI_AGENT_HOME: "", OATS_HOME: "", PI_AGENTS_ROOT: "", OATS_PACKAGE_CATALOG: catalogFile, OATS_REMOTE_CACHE: join(base, "cache"), HOME: join(base, "home"), OATS_TMUX_SESSION: `none-${process.pid}`, PI_AGENTS_TMUX_SESSION: `none-${process.pid}` };
  const r = spawnSync(process.execPath, [CLI, "sync", "--dir", dep, "--json"], { cwd: dep, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env });
  assert.equal(r.status, 0, `sync exits 0\n${r.stdout}\n${r.stderr}`);
  return { base, fx, dep, root, env, remoteOptions: { cacheDir: join(base, "cache") } };
}

/** What bin/oats.mjs hands spawnInstanceAsync: the prepared resolution, the fetched soul, the agent. */
async function prepare(d, soul, providers = { "oats.okf": { "state-dir": "/tmp/x" } }) {
  const prepared = await prepareInstance(d.dep, soul, { spawn: { providers }, remoteOptions: d.remoteOptions });
  await ensureWorkspaceSoul(prepared, d.root);
  prepared.capabilityRows = []; // bin passes [] — the kernel must not run on it (H1)
  prepared.preview = modulesPreview(prepared.resolution, d.root, soul);
  prepared.toCapabilityRows = toCapabilityRows;
  const agent = findAgent(d.root, soul);
  assert.ok(agent, `soul ${soul} readable at ${d.root}`);
  return { prepared, agent };
}
const events = (home) => readFileSync(join(home, ".oats-events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const wsEvents = (dep, soul, instance) => readFileSync(join(dep, ".agents", "events", `${soul}--${instance}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("H1/M3/M11/S1: a prepared spawn runs with the resolution's capability rows — preview matches apply, hooks run and are recorded, retire runs the retire hook", { timeout: 300_000 }, async () => {
  const d = await deployment();
  // The fixture's OATS_PACKAGE_CATALOG must be visible to THIS process for prepareInstance (package resolution).
  const saved = { ...process.env };
  Object.assign(process.env, { OATS_PACKAGE_CATALOG: d.env.OATS_PACKAGE_CATALOG, OATS_REMOTE_CACHE: d.env.OATS_REMOTE_CACHE, OATS_TMUX_SESSION: d.env.OATS_TMUX_SESSION, PI_AGENTS_TMUX_SESSION: d.env.PI_AGENTS_TMUX_SESSION });
  try {
    const { prepared, agent } = await prepare(d, "release-manager");
    const common = { prepared, purpose: "x", work: "directory", repo: d.dep, launch: false };

    // ---- M3 + M11: the preview reports what apply will produce ----
    const preview = await spawnInstanceAsync(d.root, agent, { ...common, preview: true });
    assert.equal(preview.preview, true);
    assert.deepEqual(preview.capabilities.map((c) => c.name).sort(), EXPECTED_MODULES, "M3: capabilities[] are the resolution's modules");
    for (const c of preview.capabilities) assert.match(c.origin, /^(package:[^@]+@\S+|member:\S+@[0-9a-f]{40})$/, `M3: ${c.name} carries an origin (${c.origin})`);
    assert.equal(preview.capabilities.find((c) => c.name === "nw-deploy").origin, "package:nw.tools@0.4.0");
    assert.equal(preview.capabilities.find((c) => c.name === "nw-house-style").origin, `member:${d.fx.keys.agents}@${d.fx.commits.agents}`);
    const moduleSkills = preview.skills.filter((s) => typeof s === "object");
    assert.deepEqual(moduleSkills.map((s) => `${s.source}/${s.name}`).sort(), ["module:nw-deploy/deploy", "module:nw-release-tooling/cut-release", "module:oats.core/oats-operate", "module:oats.okf/okf"], "M3: every module skill is listed as {name, source: module:<cap>}");
    assert.ok(preview.skills.includes("release-checklist"), "the soul's own skill is still listed by name");
    assert.equal(preview.workspace, d.fx.keys.agents, "M11: preview.workspace is the discovery key, not null");
    assert.equal(preview.standalone, false, "M11: standalone is recorded on the preview");
    const instancesDir = join(d.root, "release-manager", "instances");
    assert.ok(!existsSync(instancesDir) || readdirSync(instancesDir).length === 0, "a preview creates nothing");

    // ---- M11 in the composed resolved view (what hooks/environment see) ----
    const composition = composeInstanceAgentsMd(join(d.root, "release-manager", "soul"), d.dep, "release-manager", "directory", "persistent", prepared);
    assert.equal(composition.resolved.workspace.key, d.fx.keys.agents, "M11: resolved.workspace.key");
    assert.equal(composition.resolved.workspace.standalone, false);
    assert.equal(composition.resolved.capabilities.length, EXPECTED_MODULES.length, "planned rows exist before the home does (H1: never zero)");
    assert.ok(composition.resolved.capabilities.every((c) => c.planned === true && c.skills.length === 0 && c.inject === undefined), "planned rows defer skills/inject to materialize");
    const planned = planInstanceResources({ resolved: composition.resolved, soulDir: join(d.root, "release-manager", "soul"), agent, contextDir: d.dep, composition, prepared });
    assert.ok(planned.some((r) => r.type === "skill-tree" && r.source === "oats.okf" && r.deferred === "materialize"), "module skills are expected (deferred to materialize)");
    assert.ok(planned.some((r) => r.type === "injection" && r.source === "oats.okf" && r.deferred === "materialize"), "module injects are expected (deferred to materialize)");

    // ---- H1: apply ----
    const spawned = await spawnInstanceAsync(d.root, agent, common);
    assert.equal(spawned.instance, "release-manager-x");
    const home = spawned.home;
    const meta = JSON.parse(readFileSync(join(home, "instance.json"), "utf8"));
    assert.deepEqual(Object.keys(meta.modules).sort(), EXPECTED_MODULES);
    assert.equal(meta.capabilities.length, Object.keys(meta.modules).length, "H1: instance.json.capabilities has one row per module");
    assert.deepEqual(meta.capabilities.map((c) => c.id).sort(), EXPECTED_MODULES);
    assert.deepEqual(meta.capabilityRuntime.map((c) => c.id).sort(), EXPECTED_MODULES, "H1: capabilityRuntime (what retire runs) has one row per module");
    const okf = meta.capabilities.find((c) => c.id === "oats.okf");
    assert.equal(okf.layer, "knowledge"); assert.equal(okf.origin, "package:oats.okf@2.1.3"); assert.equal(okf.trusted, true);
    assert.equal(okf.settings["state-dir"], "/tmp/x", "the merged provider payload is the row's settings");
    assert.deepEqual(okf.hooks.sort(), ["retire", "spawn"]);
    assert.equal(okf.skills.length, 1); assert.ok(okf.skills[0].startsWith(join(home, ".agents", "skills", "oats.okf")), "skill paths point INTO the home");
    const okfRuntime = meta.capabilityRuntime.find((c) => c.id === "oats.okf");
    assert.match(okfRuntime.hooks.spawn, /^node '.*\/\.oats\/modules\/oats\.okf\/bin\/oats-okf\.mjs' spawn$/, "hooks are shell strings into the module copy (what the runner and retire execute)");
    assert.match(okfRuntime.hooks.retire, /^node '.*\/\.oats\/modules\/oats\.okf\/bin\/oats-okf\.mjs' retire$/);
    assert.deepEqual(okfRuntime.requiredHooks, ["spawn"]);
    // The oats.okf spawn hook (required:true) RAN and is recorded on the spawned event.
    const ev = events(home);
    const spawnedEv = ev.find((e) => e.kind === "spawned");
    assert.ok(spawnedEv, "spawned event");
    assert.deepEqual(spawnedEv.data.hooks, [{ capability: "oats.okf", ok: true, meta: false }], "H1: the oats.okf spawn hook ran (the only module with a spawn hook)");
    // M11 in instance.json
    assert.equal(meta.workspace.key, d.fx.keys.agents, "M11: instance.json.workspace.key");
    assert.equal(meta.workspace.standalone, false, "M11: instance.json.workspace.standalone");
    assert.match(meta.workspace.commit, HEX40); assert.match(meta.workspace.resolution, /^[0-9a-f]{24}$/);
    assert.equal(meta.workspace.soul.team, "engineering");
    // S1: instructions and composition.expected include the materialized capability blocks.
    const capabilityMarkers = (readFileSync(join(home, "AGENTS.md"), "utf8").match(/<!-- oats:capability:[^\s]+ src=/g) || []).map((m) => m.slice("<!-- oats:".length, -" src=".length));
    assert.deepEqual(capabilityMarkers, ["capability:nw-house-style", "capability:nw-release-tooling", "capability:oats.core", "capability:oats.okf"]);
    assert.deepEqual(meta.instructions.map((b) => b.source).filter((s) => s.startsWith("capability:")), capabilityMarkers, "S1: meta.instructions lists every capability block in the written AGENTS.md");
    for (const b of meta.instructions.filter((b) => b.source.startsWith("capability:"))) assert.ok(b.file.startsWith(join(home, ".oats", "modules")), `S1: ${b.source} block file is the module copy (${b.file})`);
    assert.deepEqual(meta.composition.expected.filter((r) => r.type === "instruction-block").map((r) => r.source).filter((s) => s.startsWith("capability:")), capabilityMarkers, "S1: composition.expected carries the capability blocks");
    assert.deepEqual(meta.composition.materialized.instructions.map((b) => b.source).filter((s) => s.startsWith("capability:")), capabilityMarkers);
    const expectedOkfSkill = meta.composition.expected.find((r) => r.type === "skill-tree" && r.source === "oats.okf");
    assert.equal(expectedOkfSkill.deferred, "materialize"); assert.equal(expectedOkfSkill.resolved, join(home, ".agents", "skills", "oats.okf"), "deferred module skills resolve to the landed copy");
    const expectedOkfInject = meta.composition.expected.find((r) => r.type === "injection" && r.source === "oats.okf");
    assert.equal(expectedOkfInject.resolved, join(home, ".oats", "modules", "oats.okf", "injects", "okf.md"));
    // the preview's capability list IS the applied one
    assert.deepEqual(preview.capabilities.map((c) => c.name).sort(), meta.capabilities.map((c) => c.id).sort(), "M3: preview == apply");
    assert.deepEqual(preview.capabilities.map((c) => [c.name, c.origin]).sort(), meta.capabilities.map((c) => [c.id, c.origin]).sort());

    // ---- M2: recompose refuses a materialized home ----
    assert.throws(() => recomposeInstanceInstructions(home, { dryRun: true }), (e) => e.code === "E_UNSUPPORTED_MODE" && /recompose from materialized modules is not supported yet; re-spawn/.test(e.message));
    assert.equal((readFileSync(join(home, "AGENTS.md"), "utf8").match(/<!-- oats:capability:/g) || []).length, 4, "M2: nothing was stripped");

    // ---- H1: retire runs the retire hook (recorded on the retired event in the workspace log) ----
    const retired = retireInstance(d.root, "release-manager-x");
    assert.equal(retired.removedDir, true);
    assert.ok(!existsSync(home));
    const ws = wsEvents(d.dep, "release-manager", "release-manager-x");
    const retiredEv = ws.find((e) => e.kind === "retired");
    assert.ok(retiredEv, "retired event in the workspace log");
    assert.deepEqual(retiredEv.data.hooks, [{ capability: "oats.okf", ok: true, meta: false }], "H1: the oats.okf retire hook ran at retire");
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test("M1: materialize → launch is one rollback — a failure after the home is populated removes it whole and a retry keeps the same name; an absent backend fails before anything is placed", { timeout: 300_000 }, async () => {
  const d = await deployment();
  const saved = { ...process.env };
  Object.assign(process.env, { OATS_PACKAGE_CATALOG: d.env.OATS_PACKAGE_CATALOG, OATS_REMOTE_CACHE: d.env.OATS_REMOTE_CACHE, OATS_TMUX_SESSION: d.env.OATS_TMUX_SESSION, PI_AGENTS_TMUX_SESSION: d.env.PI_AGENTS_TMUX_SESSION });
  try {
    const { prepared, agent } = await prepare(d, "release-manager");
    const instancesDir = join(d.root, "release-manager", "instances");
    const left = () => (existsSync(instancesDir) ? readdirSync(instancesDir).filter((n) => !n.startsWith(".")) : []);

    // (a) a materialize that copies everything and THEN fails: nothing is left behind.
    let landed = null;
    await assert.rejects(spawnInstanceAsync(d.root, agent, { prepared, purpose: "m1", work: "directory", repo: d.dep, launch: false,
      materialize: async (p, home) => { await materializePrepared(p, home); landed = readdirSync(join(home, ".oats", "modules")).sort(); throw Object.assign(new Error("boom after copy"), { code: "E_TEST_AFTER_COPY" }); } }),
      (e) => e.code === "E_TEST_AFTER_COPY");
    assert.deepEqual(landed, EXPECTED_MODULES, "the home WAS populated before the failure");
    assert.deepEqual(left(), [], "M1: the populated home is removed whole (recursive), not left behind");

    // (b) the retry is not auto-suffixed: it gets the very same name and runs with rows.
    const ok = await spawnInstanceAsync(d.root, agent, { prepared, purpose: "m1", work: "directory", repo: d.dep, launch: false });
    assert.equal(ok.instance, "release-manager-m1", "M1: a retry after a rolled-back failure keeps its name (no -2)");
    assert.equal(ok.capabilities.length, EXPECTED_MODULES.length);
    retireInstance(d.root, "release-manager-m1");
    assert.deepEqual(left(), []);

    // (c) backend absent: refused BEFORE placement — no home, and materialize is never called.
    const bin = join(d.base, "bin"); mkdirSync(bin);
    for (const n of ["node", "git", "sh", "pi"]) { const p = spawnSync("sh", ["-c", `command -v ${n}`], { encoding: "utf8" }).stdout.trim(); if (p) symlinkSync(p, join(bin, n)); }
    const pathBefore = process.env.PATH; process.env.PATH = bin;
    let materializeCalls = 0;
    try {
      await assert.rejects(spawnInstanceAsync(d.root, agent, { prepared, purpose: "m1c", work: "directory", repo: d.dep, launch: true, backend: "herdr", materialize: async () => { materializeCalls++; throw new Error("must not be reached"); } }),
        (e) => /herdr not installed/.test(e.message) && /nothing was created/.test(e.message));
    } finally { process.env.PATH = pathBefore; }
    assert.equal(materializeCalls, 0, "M1: backend presence is checked before placement/materialize");
    assert.deepEqual(left(), [], "M1: an absent backend leaves no home");
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test("M16: E_REQUIREMENT_INACTIVE's remedy names oats-local.yaml + oats sync (no removed verbs) in remedy, details.remedy and the message", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-m16-"));
  const root = join(base, "agents"); const soulDir = join(root, "plain", "soul");
  mkdirSync(soulDir, { recursive: true });
  writeFileSync(join(soulDir, "soul.yaml"), "name: plain\ndescription: d\nwork: directory\nrequires:\n  capabilities:\n    oats.core: {}\n");
  writeFileSync(join(soulDir, "AGENTS.md"), "# plain\n");
  const composition = composeInstanceAgentsMd(soulDir, base, "plain", "directory", "persistent");
  assert.throws(() => planInstanceResources({ resolved: composition.resolved, soulDir, agent: { name: "plain" }, contextDir: base, composition }), (e) => {
    assert.equal(e.code, "E_REQUIREMENT_INACTIVE");
    assert.equal(e.remedy, "add oats-local.yaml (workspace: <ref> or standalone: <ref>) beside agents/ and run oats sync");
    assert.equal(e.details.remedy, e.remedy);
    assert.deepEqual(e.details.capabilities, ["oats.core"]);
    assert.doesNotMatch(e.message, /oats (use|install)\b/, "no removed verb in the message");
    assert.doesNotMatch(e.remedy, /oats (use|install)\b/);
    assert.match(e.message, /oats sync/);
    return true;
  });
});

// ---- lane 2 (0.25.2 operator-rebuild round): R3 kernel block, R5 preview payloads ----
//
//   R3  a workspace spawn whose RESOLUTION carries oats.core (here: the Northwind workspace default)
//       composes exactly one "You run on OATS" section — the module's — and no `kernel:oats` block,
//       whatever the soul's v1 `requires:` block says; a soul that resolves NO oats.core/oats.setup
//       module (`oats.core: off`) still gets the kernel block. The kernel's bundled operational
//       skill trio is never consulted for a prepared spawn.
//   R5  the prepared preview shows `providers` (the --provider map as parsed) and `settings.<cap>`
//       (the MERGED payload per module — what the provider will receive, == instance.json.providers).
import { moveMember } from "./fixtures/northwind/build.mjs";

/** bin/oats.mjs' hand-over plus the parsed --provider map on prepared.spawn (what R5 reads). */
async function prepareWithProviders(d, soul, providers) {
  const { prepared, agent } = await prepare(d, soul, providers);
  prepared.spawn = { providers };
  return { prepared, agent };
}
const withFixtureEnv = async (d, fn) => {
  const saved = { ...process.env };
  Object.assign(process.env, { OATS_PACKAGE_CATALOG: d.env.OATS_PACKAGE_CATALOG, OATS_REMOTE_CACHE: d.env.OATS_REMOTE_CACHE, OATS_TMUX_SESSION: d.env.OATS_TMUX_SESSION, PI_AGENTS_TMUX_SESSION: d.env.PI_AGENTS_TMUX_SESSION });
  try { return await fn(); } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
};

test("R3: the resolution decides the kernel 'You run on OATS' block — oats.core as a workspace module suppresses it (one section, no kernel:oats marker); `oats.core: off` keeps it; the bundled kernel skill trio is never composed for a prepared spawn", { timeout: 300_000 }, async () => {
  const d = await deployment();
  // A member soul that switches the workspace default oats.core OFF (members resolve at latest; no re-sync needed).
  await moveMember(d.fx, "agents", async (_work, { writeTree }) => writeTree({
    "souls/no-core/soul.yaml": { yaml: { schemaVersion: 2, name: "no-core", description: "No operational module.", work: "directory", capabilities: { "oats.core": "off" }, knowledge: "none" } },
    "souls/no-core/AGENTS.md": "# no-core\n",
  }));
  await withFixtureEnv(d, async () => {
    // (a) release-manager: oats.core arrives through the workspace default; the soul has no v1 `requires:`.
    const rm = await prepareWithProviders(d, "release-manager", { "oats.okf": { "state-dir": "/tmp/x" } });
    assert.ok(rm.prepared.resolution.modules.some((m) => m.name === "oats.core"), "precondition: oats.core is a module of the resolution");
    const rmSoulDir = join(d.root, "release-manager", "soul");
    const rmComposition = composeInstanceAgentsMd(rmSoulDir, d.dep, "release-manager", "directory", "persistent", rm.prepared);
    assert.equal(rmComposition.resolved.kernelInjection.inject, undefined, "R3: no kernel inject when the resolution carries oats.core");
    assert.equal(rmComposition.resolved.kernelInjection.provenance, "declared oats.core (workspace module)");
    assert.equal(rmComposition.oatsCoreDeclared, true, "doctor's operational-knowledge note reads the same answer");
    assert.ok(!rmComposition.blocks.some((b) => b.source === "kernel:oats"), "R3: no kernel:oats block composed");
    const rmPlanned = planInstanceResources({ resolved: rmComposition.resolved, soulDir: rmSoulDir, agent: rm.agent, contextDir: d.dep, composition: rmComposition, prepared: rm.prepared });
    assert.ok(!rmPlanned.some((r) => r.type === "skill-tree" && r.source === "kernel"), "R3: legacyOperationalSkills is not consulted for a prepared spawn");
    const rmSpawned = await spawnInstanceAsync(d.root, rm.agent, { prepared: rm.prepared, purpose: "r3", work: "directory", repo: d.dep, launch: false });
    const rmMd = readFileSync(join(rmSpawned.home, "AGENTS.md"), "utf8");
    assert.equal((rmMd.match(/You run on OATS/g) || []).length, 1, "R3: exactly ONE 'You run on OATS' section");
    assert.doesNotMatch(rmMd, /<!-- oats:kernel:oats /, "R3: no kernel:oats marker");
    assert.match(rmMd, /<!-- oats:capability:oats\.core /, "the module's inject is the one section");
    assert.doesNotMatch(rmMd, /Load the oats skill before/, "the kernel's text naming the bundled `oats` skill is gone");
    const rmSkills = readdirSync(join(rmSpawned.home, ".agents", "skills")).sort();
    assert.deepEqual(rmSkills, ["nw-deploy", "nw-release-tooling", "oats.core", "oats.okf", "release-checklist"], "R3: module skills + the soul's own; none of the kernel's bundled trio (oats, oats-config, oats-packages)");
    retireInstance(d.root, rmSpawned.instance);

    // (b) no-core: the soul turned oats.core OFF → no oats.core/oats.setup module → the kernel block stays.
    const nc = await prepareWithProviders(d, "no-core", {});
    assert.deepEqual(nc.prepared.resolution.modules.map((m) => m.name), ["nw-house-style"], "precondition: oats.core is off");
    const ncSoulDir = join(d.root, "no-core", "soul");
    const ncComposition = composeInstanceAgentsMd(ncSoulDir, d.dep, "no-core", "directory", "persistent", nc.prepared);
    assert.ok(ncComposition.resolved.kernelInjection.inject, "R3: the kernel block is kept when no operational module resolves");
    assert.equal(ncComposition.resolved.kernelInjection.provenance, "default");
    assert.equal(ncComposition.oatsCoreDeclared, false);
    assert.equal(ncComposition.blocks.filter((b) => b.source === "kernel:oats").length, 1);
    const ncPlanned = planInstanceResources({ resolved: ncComposition.resolved, soulDir: ncSoulDir, agent: nc.agent, contextDir: d.dep, composition: ncComposition, prepared: nc.prepared });
    assert.ok(!ncPlanned.some((r) => r.type === "skill-tree" && r.source === "kernel"), "R3: even with the kernel block, a prepared spawn gets no bundled kernel skills");
    const ncSpawned = await spawnInstanceAsync(d.root, nc.agent, { prepared: nc.prepared, purpose: "r3", work: "directory", repo: d.dep, launch: false });
    const ncMd = readFileSync(join(ncSpawned.home, "AGENTS.md"), "utf8");
    assert.equal((ncMd.match(/You run on OATS/g) || []).length, 1, "R3: still exactly one section — the kernel's");
    assert.match(ncMd, /<!-- oats:kernel:oats /);
    assert.doesNotMatch(ncMd, /<!-- oats:capability:oats\.core /);
    const ncSkillsDir = join(ncSpawned.home, ".agents", "skills");
    assert.ok(!existsSync(ncSkillsDir) || !readdirSync(ncSkillsDir).some((n) => ["oats", "oats-config", "oats-packages"].includes(n)), "R3: no bundled kernel skill tree in the home");
    retireInstance(d.root, ncSpawned.instance);
  });
});

test("R5: a prepared preview shows `providers` (the --provider map as parsed) and `settings.<cap>` (the merged payload the provider receives); without --provider, settings come from soul/local only", { timeout: 300_000 }, async () => {
  const d = await deployment();
  // Machine-level payload (oats-local.yaml settings.<cap>) so the merge has a second layer to show.
  writeFileSync(join(d.dep, "oats-local.yaml"), `schemaVersion: 2\nworkspace: ${d.fx.refs.agents}\nsettings:\n  oats.okf:\n    state-dir: /tmp/from-local\n    verbose: true\n`);
  await withFixtureEnv(d, async () => {
    const common = { purpose: "r5", work: "directory", repo: d.dep, launch: false, preview: true };
    // (a) with --provider: the key shows under BOTH providers.<cap> (as given) and settings.<cap> (merged, --provider wins).
    const withP = await prepareWithProviders(d, "release-manager", { "oats.okf": { "state-dir": "/tmp/x", extra: { nested: 1 } } });
    const pv = await spawnInstanceAsync(d.root, withP.agent, { prepared: withP.prepared, ...common });
    assert.deepEqual(pv.providers, { "oats.okf": { "state-dir": "/tmp/x", extra: { nested: 1 } } }, "R5: providers is the --provider map exactly as parsed");
    assert.deepEqual(Object.keys(pv.settings).sort(), EXPECTED_MODULES, "R5: one settings entry per module");
    assert.equal(pv.settings["oats.okf"]["state-dir"], "/tmp/x", "R5: --provider wins over oats-local.yaml settings in the merged payload");
    assert.equal(pv.settings["oats.okf"].verbose, true, "R5: the local layer is in the merged payload");
    assert.deepEqual(pv.settings["oats.okf"].extra, { nested: 1 });
    assert.equal(pv.settings["oats.okf"].owns, "release-manager", "R5: the soul's knowledge: payload is in the merged payload");
    assert.deepEqual(pv.settings["oats.okf"], withP.prepared.resolution.payloads["oats.okf"], "R5: settings.<cap> IS the resolution's merged payload");
    assert.deepEqual(pv.settings["nw-deploy"], {}, "a module with no payload shows an empty object, not undefined");
    // preview == apply: what apply records as instance.json.providers is exactly the preview's settings.
    const applied = await spawnInstanceAsync(d.root, withP.agent, { prepared: withP.prepared, purpose: "r5", work: "directory", repo: d.dep, launch: false });
    const meta = JSON.parse(readFileSync(join(applied.home, "instance.json"), "utf8"));
    assert.deepEqual(meta.providers["oats.okf"], pv.settings["oats.okf"], "R5: preview settings.<cap> == instance.json.providers.<cap> after apply");
    assert.equal(meta.capabilities.find((c) => c.id === "oats.okf").settings["state-dir"], "/tmp/x");
    retireInstance(d.root, applied.instance);

    // (b) without --provider: providers is empty and settings carry soul + local only.
    const noP = await prepareWithProviders(d, "release-manager", {});
    const pv2 = await spawnInstanceAsync(d.root, noP.agent, { prepared: noP.prepared, ...common });
    assert.deepEqual(pv2.providers, {}, "R5: no --provider → an empty map (not null)");
    assert.equal(pv2.settings["oats.okf"]["state-dir"], "/tmp/from-local", "R5: settings from oats-local.yaml only");
    assert.equal(pv2.settings["oats.okf"].owns, "release-manager", "R5: soul payload still present");
    assert.equal(pv2.settings["oats.okf"].extra, undefined, "nothing from a --provider that was not given");

    // (c) the preview's payload objects are copies: mutating them never reaches the frozen resolution.
    pv2.settings["oats.okf"].mutated = true;
    assert.equal(noP.prepared.resolution.payloads["oats.okf"].mutated, undefined);

    // (d) a classic (non-prepared) preview carries neither field.
    const classic = await spawnInstanceAsync(d.root, noP.agent, { ...common });
    assert.equal(classic.providers, undefined); assert.equal(classic.settings, undefined);
  });
});

test("decision 27 K1′: the spawn decision binds the merged per-module payloads as effective.providers (exactly the resolution's payloads); the revision changes when a payload changes", { timeout: 300_000 }, async () => {
  const d = await deployment();
  await withFixtureEnv(d, async () => {
    const common = { purpose: "k1", work: "directory", repo: d.dep, launch: false, preview: true };
    const a = await prepareWithProviders(d, "release-manager", { "oats.okf": { "state-dir": "/tmp/x" } });
    const pa = await spawnInstanceAsync(d.root, a.agent, { prepared: a.prepared, ...common });
    assert.ok(pa.decision?.effective, "preview carries the decision");
    assert.deepEqual(pa.decision.effective.providers, a.prepared.resolution.payloads, "effective.providers is the resolution's merged payloads by value");
    assert.equal(pa.decision.effective.providers["oats.okf"]["state-dir"], "/tmp/x");
    const b = await prepareWithProviders(d, "release-manager", { "oats.okf": { "state-dir": "/tmp/y" } });
    const pb = await spawnInstanceAsync(d.root, b.agent, { prepared: b.prepared, ...common });
    assert.notEqual(pb.decision.revision, pa.decision.revision, "a different provider fact is a different decision");
    assert.equal(pb.decision.effective.providers["oats.okf"]["state-dir"], "/tmp/y");
  });
});

test("oats.aweb 1.12.2: workspace-file root is refused because the manifest marks it hostOnly", { timeout: 300_000 }, async () => {
  const d = await deployment();
  await moveMember(d.fx, "agents", async (work, { fs, path }) => {
    await fs.mkdir(path.join(work, "capabilities/oats-aweb"), { recursive: true });
    await fs.writeFile(path.join(work, "capabilities/oats-aweb/oats.json"), JSON.stringify({
      capability: "oats.aweb",
      version: "1.12.2",
      compatibility: { oats: ">=0.25.6" },
      description: "aweb hostOnly root fixture",
      layer: "messaging",
      settings: {
        root: { hostOnly: true, description: "host-owned aweb root" },
        team: { description: "target aweb team" },
      },
    }, null, 2) + "\n");
    const file = path.join(work, "oats-workspace.yaml");
    const text = await fs.readFile(file, "utf8");
    await fs.writeFile(file, text
      .replace("messaging: none", `messaging:\n            oats.aweb:\n              from: ${d.fx.keys.agents}`)
      .replace("messaging:\n  private: per-human", "messaging:\n  root: /must-live-in-oats-local\n  private: per-human"));
  });
  await withFixtureEnv(d, async () => {
    await assert.rejects(prepareInstance(d.dep, "release-manager", { spawn: { providers: {} }, remoteOptions: d.remoteOptions }),
      (e) => e.code === "E_WORKSPACE_SCHEMA" && e.details?.reason === "host-only-key" && e.details.key === "root" && e.details.capability === "oats.aweb" && e.details.path === "/messaging/root");
  });
});

test("decision 27 K1″: a settings key the manifest marks hostOnly is accepted from oats-local.yaml only — refused in a --provider flag, the soul's slot payload and the workspace messaging payload with E_WORKSPACE_SCHEMA reason host-only-key", { timeout: 300_000 }, async () => {
  const d = await deployment();
  await withFixtureEnv(d, async () => {
    // --provider (per-spawn layer): refused, path and key named.
    await assert.rejects(prepareInstance(d.dep, "release-manager", { spawn: { providers: { "oats.okf": { "custody-root": "/srv/custody" } } }, remoteOptions: d.remoteOptions }),
      (e) => e.code === "E_WORKSPACE_SCHEMA" && e.details?.reason === "host-only-key" && e.details.key === "custody-root" && e.details.capability === "oats.okf" && /\/spawn\/providers\/oats\.okf\/custody-root/.test(e.details.path) && /oats-local\.yaml/.test(e.message));
    // oats-local.yaml settings.<cap> (the host layer): accepted and reaches the merged payload.
    writeFileSync(join(d.dep, "oats-local.yaml"), `schemaVersion: 2\nworkspace: ${d.fx.refs.agents}\nsettings:\n  oats.okf:\n    custody-root: /srv/custody\n`);
    const ok = await prepareInstance(d.dep, "release-manager", { spawn: { providers: {} }, remoteOptions: d.remoteOptions });
    assert.equal(ok.resolution.payloads["oats.okf"]["custody-root"], "/srv/custody", "the host layer may carry a hostOnly key");
    // a key that is NOT hostOnly stays legal everywhere (control).
    const ctl = await prepareInstance(d.dep, "release-manager", { spawn: { providers: { "oats.okf": { "state-dir": "/tmp/z" } } }, remoteOptions: d.remoteOptions });
    assert.equal(ctl.resolution.payloads["oats.okf"]["state-dir"], "/tmp/z");
    // the soul's committed slot payload (knowledge:): refused — a committed file must never point a spawn at a custody root.
    const moved = await moveMember(d.fx, "agents", async (work, { fs, path }) => {
      const file = path.join(work, "souls/release-manager/soul.yaml");
      const text = await fs.readFile(file, "utf8");
      assert.match(text, /^knowledge:\n/m, "fixture soul declares a knowledge: block");
      await fs.writeFile(file, text.replace(/^knowledge:\n/m, "knowledge:\n  custody-root: /evil\n"));
    });
    assert.ok(moved.commit);
    await assert.rejects(prepareInstance(d.dep, "release-manager", { spawn: { providers: {} }, remoteOptions: d.remoteOptions }),
      (e) => e.code === "E_WORKSPACE_SCHEMA" && e.details?.reason === "host-only-key" && e.details.path === "/knowledge/custody-root");
  });
});
