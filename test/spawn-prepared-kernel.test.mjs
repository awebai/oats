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

/** Build the fixture + a deployment, run `oats sync` (child process, like an operator) and approve
 *  every package by editing the lock (what a TTY sync records). Returns everything a spawn needs. */
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
  assert.equal(r.status, 2, `sync exits 2 with approvals pending\n${r.stdout}\n${r.stderr}`);
  const lockFile = join(dep, "oats-lock.json");
  const lock = JSON.parse(readFileSync(lockFile, "utf8"));
  const approvalNeeded = JSON.parse(r.stdout.trim().split("\n").pop()).result.approvalNeeded;
  for (const [id, p] of Object.entries(lock.packages)) p.approved = { executables: approvalNeeded.find((a) => a.id === id).executables, at: "2026-09-23T00:00:00.000Z" };
  writeFileSync(lockFile, JSON.stringify(lock, null, 2) + "\n");
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
