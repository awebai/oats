// oats operation run — the generic runner on the workspace model (lead decision 4):
// the provider filling a layer is the home's own module copy, run in the home (or
// the deployment, context scope) with its recorded payload as OATS_SETTINGS; its
// envelope is relayed, a launch receipt surfaced, unconfirmed outcomes carry what
// was observed, and a scheduled operation tracks the receipt like a command job.
//
// Runs the REAL CLI over the Northwind fixture. Each test spawns its own
// release-manager home and overlays that home's oats.okf copy (what `operation
// run --home` executes) with a recording provider — the runner is generic, any
// provider. Never bare `oats setup`; HOME, the remote cache and tmux are isolated.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { buildNorthwind } from "./fixtures/northwind/build.mjs";
import { inertRuntimePath } from "./helpers/runtime-stub.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-operation-")));
// The scheduler runs its jobs with this process's environment: isolate it here.
Object.assign(process.env, {
  OATS_HOME_DIR: join(base, "oats-home"), HOME: join(base, "home"), OATS_REMOTE_CACHE: join(base, "cache"), PATH: inertRuntimePath(base),
  OATS_TMUX_SESSION: `none-${process.pid}`, PI_AGENTS_TMUX_SESSION: `none-${process.pid}`, OATS_PACKAGE_CATALOG: join(base, "catalog.json"),
});
for (const k of ["OATS_INSTANCE", "OATS_INSTANCE_HOME", "OATS_HOME", "PI_AGENT_INSTANCE", "PI_AGENT_HOME", "PI_AGENTS_ROOT", "OATS_ROOT"]) delete process.env[k];
mkdirSync(process.env.HOME, { recursive: true });
const S = await import("../lib/schedule.mjs");
test.after(() => rmSync(base, { recursive: true, force: true }));
function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }
// The invoking process carries ANOTHER home's identity and context (a
// coordinator running this for a teammate): none of it may reach the provider.
const ambient = { OATS_INSTANCE: "other-seat", OATS_INSTANCE_HOME: "/elsewhere/other-seat", OATS_HOME: "/elsewhere/other-seat", OATS_AGENT: "other", OATS_SOUL: "/elsewhere/other/soul", OATS_CONTEXT: "/elsewhere", OATS_ROOT: "/elsewhere/agents", OATS_WORKSPACE: "/elsewhere", OATS_EVENT: "spawn", PI_AGENT_HOME: "/elsewhere/other-seat", PI_AGENTS_ROOT: "/elsewhere/agents" };
function oats(args, { cwd = base, env = ambient } = {}) { const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: { ...process.env, ...env }, cwd }); const json = () => { try { return JSON.parse(r.stdout.trim()); } catch { throw new Error(`no JSON: ${r.stdout}\n${r.stderr}`); } }; return { ...r, json }; }

const fx = await buildNorthwind(join(base, "fx"));
writeFileSync(process.env.OATS_PACKAGE_CATALOG, JSON.stringify({ packages: fx.catalog }, null, 2));
const dep = join(base, "northwind-workspace");
const agentsRoot = join(dep, "agents");
mkdirSync(agentsRoot, { recursive: true });
writeFileSync(join(dep, "oats-local.yaml"), `schemaVersion: 2\nworkspace: ${fx.refs.agents}\n`);
{ const r = oats(["sync", "--dir", dep, "--json"], { cwd: dep, env: {} }); assert.equal(r.status, 0, r.stdout + r.stderr); }

/** A release-manager home whose oats.okf copy is overlaid with a recording
 *  provider: its commands record how they were invoked (cwd, env, args) and
 *  answer real envelopes. Its digest "launches" a named harvester instance (a
 *  receipt), its memory view answers MEMORY.md, the rest answer the edge cases. */
function provider(purpose) {
  const r = oats(["spawn", "release-manager", "--dir", dep, "--purpose", purpose, "--work", "directory", "--no-launch", "--provider", "oats.okf", "state-dir=/tmp/nw-state", "--json"], { cwd: dep, env: {} });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const home = r.json().result.home;
  const meta = JSON.parse(readFileSync(join(home, "instance.json"), "utf8"));
  const okf = join(home, ".oats", "modules", "oats.okf");
  const manifestPath = join(okf, "oats.json");
  const m = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const c of ["digest", "memory", "badview", "fail", "sweep", "liar", "noisy", "liarnamed", "retained"]) m.commands[c] = `bin/notes.mjs ${c}`;
  Object.assign(m.operations, {
    harvest: { kind: "action", command: "digest", context: "home", description: "Digest MEMORY.md", args: [{ name: "depth", required: true, description: "how deep" }, { name: "dry" }] },
    memory: { kind: "view", command: "memory", context: "home" },
    badview: { kind: "view", command: "badview", context: "home" },
    fail: { command: "fail", context: "home" },
    sweep: { command: "sweep", context: "scope" },
    liar: { command: "liar", context: "home" },
    liarnamed: { command: "liarnamed", context: "home" },
    retained: { command: "retained", context: "home" },
    noisy: { command: "noisy", context: "home" },
  });
  writeFileSync(manifestPath, JSON.stringify(m, null, 2));
  write(join(okf, "bin", "notes.mjs"), `
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const [cmd, ...rest] = process.argv.slice(2);
const pick = (k) => process.env[k] === undefined ? null : process.env[k];
const record = { cmd, rest, cwd: process.cwd(), env: Object.fromEntries(["OATS_HOME", "OATS_INSTANCE", "OATS_INSTANCE_HOME", "OATS_SETTINGS", "OATS_OPERATION", "OATS_CAPABILITY", "OATS_CLI_BIN", "OATS_AGENT", "OATS_SOUL", "OATS_CONTEXT", "OATS_ROOT", "OATS_WORKSPACE", "OATS_EVENT", "PI_AGENT_HOME", "PI_AGENTS_ROOT"].map((k) => [k, pick(k)])) };
writeFileSync(join(process.cwd(), "notes-invocation.json"), JSON.stringify(record));
if (cmd === "digest") { console.error("digesting"); console.log(JSON.stringify({ schemaVersion: 1, ok: true, result: { digested: true, instance: "notes-harvester-1", home: join(process.cwd(), "..", "notes-harvester-1") } })); }
else if (cmd === "memory") { const f = join(process.cwd(), "MEMORY.md"); console.log(JSON.stringify({ schemaVersion: 1, ok: true, result: { summary: "one file", documents: [{ label: "Memory", kind: "markdown", path: f, text: existsSync(f) ? readFileSync(f, "utf8") : null }] } })); }
else if (cmd === "badview") console.log(JSON.stringify({ schemaVersion: 1, ok: true, result: { documents: [{ kind: "markdown" }] } }));
else if (cmd === "fail") { console.log(JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_NOTES_EMPTY", message: "nothing to digest" } })); process.exit(1); }
else if (cmd === "sweep") console.log(JSON.stringify({ schemaVersion: 1, ok: true, result: { swept: process.cwd() } }));
else if (cmd === "liar") { console.log(JSON.stringify({ schemaVersion: 1, ok: true, result: { done: true } })); process.exit(1); }
else if (cmd === "liarnamed") { console.log(JSON.stringify({ schemaVersion: 1, ok: true, result: { instance: "notes-harvester-9" } })); process.exit(1); }
else if (cmd === "retained") { console.log(JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_SPAWN_FAILED", message: "harvester pane could not be stopped; rollback INCOMPLETE, home retained" }, result: { instance: "notes-harvester-3", home: join(process.cwd(), "..", "notes-harvester-3") } })); process.exit(1); }
else if (cmd === "noisy") { console.log("progress 1/2"); console.log(JSON.stringify({ schemaVersion: 1, ok: true, result: { done: true } })); }
`);
  write(join(home, "MEMORY.md"), "# remembered\n");
  return { home, meta, manifestPath, instance: meta.instance };
}

test("operation run resolves the home's provider from its modules, runs the provider command in the home with the recorded payload, relays the envelope and surfaces a launch receipt", () => {
  const { home, meta, instance } = provider("s1");
  let r = oats(["operation", "run", "knowledge:harvest", "--home", home, "--arg", "depth=2", "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const res = r.json().result;
  assert.equal(res.operationsApi, 2);
  assert.equal(res.operation, "knowledge:harvest"); assert.equal(res.capability, "oats.okf"); assert.deepEqual(res.argv, ["okf", "digest", "--depth", "2"]); assert.equal(res.cwd, home);
  assert.deepEqual(res.target, { home, instance });
  assert.equal(res.instance, "notes-harvester-1", "the provider's launch receipt is surfaced"); assert.equal(res.home, join(home, "..", "notes-harvester-1"));
  assert.equal(res.result.digested, true); assert.equal(res.stderr, "digesting");
  const inv = JSON.parse(readFileSync(join(home, "notes-invocation.json"), "utf8"));
  assert.equal(inv.cmd, "digest"); assert.deepEqual(inv.rest, ["--depth", "2", "--json"]); assert.equal(inv.cwd, home);
  assert.equal(inv.env.OATS_HOME, home); assert.equal(inv.env.OATS_INSTANCE, instance); assert.equal(inv.env.OATS_OPERATION, "knowledge:harvest"); assert.equal(inv.env.OATS_CAPABILITY, "oats.okf");
  assert.equal(inv.env.OATS_AGENT, "release-manager"); assert.equal(inv.env.OATS_SOUL, meta.soulDir, "the home's recorded per-commit soulDir"); assert.equal(inv.env.OATS_ROOT, agentsRoot); assert.equal(inv.env.PI_AGENTS_ROOT, agentsRoot);
  assert.equal(inv.env.OATS_CONTEXT, dep); assert.equal(inv.env.OATS_WORKSPACE, dep); assert.equal(inv.env.OATS_EVENT, null); assert.equal(inv.env.PI_AGENT_HOME, home);
  for (const v of Object.values(inv.env)) assert.ok(!String(v).startsWith("/elsewhere") && v !== "other-seat" && v !== "other", `ambient identity leaked: ${v}`);
  assert.deepEqual(JSON.parse(inv.env.OATS_SETTINGS), meta.providers["oats.okf"], "the home's recorded payload");
  assert.equal(JSON.parse(inv.env.OATS_SETTINGS)["state-dir"], "/tmp/nw-state");
  assert.equal(inv.env.OATS_CLI_BIN, CLI);
  // A view operation answers validated documents.
  r = oats(["operation", "run", "knowledge:memory", "--home", home, "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(r.json().result.result.documents, [{ label: "Memory", kind: "markdown", path: join(home, "MEMORY.md"), text: "# remembered\n" }]);
  // A view that answers the wrong shape, a failing command, missing/unknown args, an unknown operation, a home operation without a home.
  assert.equal(oats(["operation", "run", "knowledge:badview", "--home", home, "--json"]).json().error.code, "E_OPERATION_RESULT");
  const f = oats(["operation", "run", "knowledge:fail", "--home", home, "--json"]).json(); assert.equal(f.error.code, "E_NOTES_EMPTY"); assert.match(f.error.message, /nothing to digest/);
  assert.equal(oats(["operation", "run", "knowledge:harvest", "--home", home, "--json"]).json().error.code, "E_BAD_ARGS", "required arg missing");
  assert.equal(oats(["operation", "run", "knowledge:harvest", "--home", home, "--arg", "depth=1", "--arg", "nope=1", "--json"]).json().error.code, "E_BAD_ARGS");
  assert.equal(oats(["operation", "run", "knowledge:polish", "--home", home, "--json"]).json().error.code, "E_OPERATION_UNKNOWN");
  assert.equal(oats(["operation", "run", "knowledge:status", "--soul", "release-manager", "--dir", dep, "--json"]).json().error.code, "E_OPERATION_UNAVAILABLE", "a home operation for a soul");
  assert.equal(oats(["operation", "run", "messaging:anything", "--home", home, "--json"]).json().error.code, "E_OPERATION_UNAVAILABLE", "no provider fills the layer");
  assert.equal(oats(["operation", "run", "bogus:x", "--home", home, "--json"]).json().error.code, "E_BAD_ARGS");
  assert.equal(oats(["operation", "run", "knowledge:harvest", "--home", home, "--dir", join(base, "elsewhere"), "--json"]).json().error.code, "E_HOME_MISMATCH", "--dir must be the home's own deployment");
  // A scope-context operation runs in the deployment, with the payload but no instance env.
  r = oats(["operation", "run", "knowledge:sweep", "--home", home, "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.equal(r.json().result.cwd, dep);
  const inv2 = JSON.parse(readFileSync(join(dep, "notes-invocation.json"), "utf8"));
  assert.deepEqual(JSON.parse(inv2.env.OATS_SETTINGS), meta.providers["oats.okf"]); assert.equal(inv2.env.OATS_HOME, null, "no instance env outside the home"); assert.equal(inv2.env.OATS_INSTANCE, null); assert.equal(inv2.env.PI_AGENT_HOME, null);
  assert.equal(inv2.env.OATS_AGENT, "release-manager"); assert.equal(inv2.env.OATS_SOUL, meta.soulDir); assert.equal(inv2.env.OATS_ROOT, agentsRoot); assert.equal(inv2.env.OATS_CONTEXT, dep);
  for (const v of Object.values(inv2.env)) assert.ok(!String(v).startsWith("/elsewhere") && v !== "other-seat" && v !== "other", `ambient identity leaked: ${v}`);
  // --agents-root is honoured for a soul selection: a wrong root is E_SOUL_UNKNOWN, the right one resolves the soul.
  assert.equal(oats(["operation", "run", "knowledge:status", "--soul", "release-manager", "--dir", dep, "--agents-root", join(base, "elsewhere", "agents"), "--json"]).json().error.code, "E_SOUL_UNKNOWN");
  assert.equal(oats(["operation", "run", "knowledge:status", "--soul", "release-manager", "--dir", dep, "--agents-root", agentsRoot, "--json"]).json().error.code, "E_OPERATION_UNAVAILABLE", "the root is accepted; the home operation still needs a home");
  // A success envelope from a process that then exits nonzero is not a receipt; contaminated stdout is not a receipt.
  const liar = oats(["operation", "run", "knowledge:liar", "--home", home, "--json"]).json(); assert.equal(liar.error.code, "E_OPERATION_RESULT"); assert.match(liar.error.message, /exited 1/);
  const noisy = oats(["operation", "run", "knowledge:noisy", "--home", home, "--json"]).json(); assert.equal(noisy.error.code, "E_OPERATION_RESULT"); assert.match(noisy.error.message, /exactly one JSON-v1 envelope/);
  // --dir with --home may be the home's own deployment; an unknown soul is refused.
  assert.equal(oats(["operation", "run", "knowledge:sweep", "--home", home, "--dir", dep, "--json"]).status, 0);
  assert.equal(oats(["operation", "run", "knowledge:sweep", "--soul", "ghost", "--dir", dep, "--json"]).json().error.code, "E_SOUL_UNKNOWN");
});

test("a schedule of kind operation resolves the provider when it runs and tracks the provider's launch receipt like a command job", () => {
  const { home, manifestPath } = provider("s2");
  const ws = dep;
  assert.throws(() => S.validateDefinition(ws, { id: "h", cron: "* * * * *", tz: "UTC", kind: "operation", operation: "harvest", home }), (e) => e.code === "E_SCHEDULE_INVALID" && e.field === "operation");
  assert.throws(() => S.validateDefinition(ws, { id: "h", cron: "* * * * *", tz: "UTC", kind: "operation", operation: "knowledge:harvest", home: join(base, "nowhere") }), (e) => e.code === "E_SCHEDULE_INVALID" && e.field === "home");
  const def = S.addSchedule(ws, { id: "h", cron: "0 * * * *", tz: "UTC", kind: "operation", operation: "knowledge:harvest", home });
  assert.equal(def.kind, "operation"); assert.equal(def.operation, "knowledge:harvest"); assert.equal(def.home, home);
  assert.deepEqual(S.operationAsCommand(def).argv, ["oats", "operation", "run", "knowledge:harvest", "--home", home]);
  // Run through the real CLI: the provider needs its required arg, so the operation fails with the provider's own code and the slot is released.
  let c = S.tickWorkspace(ws, { now: new Date("2026-09-08T10:00:00Z"), io: { inspect: () => ({ present: true, state: "unknown" }) }, reg: { maxConcurrent: 1 } });
  assert.equal(c[0].action, "launch-failed"); assert.match(c[0].error, /needs --arg depth/);
  assert.equal(S.describe(ws, "h").running, false);
  // A receipt-carrying run: redeclare harvest without args so the digest answers its launched harvester; the scheduler tracks that home, never the source home.
  const m = JSON.parse(readFileSync(manifestPath, "utf8")); m.operations.harvest.args = []; writeFileSync(manifestPath, JSON.stringify(m));
  write(join(home, "..", "notes-harvester-1", "instance.json"), JSON.stringify({ instance: "notes-harvester-1", agent: "release-manager" }));
  c = S.tickWorkspace(ws, { now: new Date("2026-09-08T11:00:00Z"), io: { inspect: () => ({ present: true, state: "unknown" }) }, reg: { maxConcurrent: 1 } });
  assert.equal(c[0].action, "launched", JSON.stringify(c[0])); assert.equal(c[0].instance, "notes-harvester-1");
  const d = S.describe(ws, "h", { inspect: () => ({ present: true, state: "unknown" }) });
  assert.equal(d.running, true); assert.equal(d.lastRun.home, join(home, "..", "notes-harvester-1")); assert.notEqual(d.lastRun.home, home);
  // The operation address is part of the guarded identity while the job runs.
  assert.throws(() => S.updateSchedule(ws, "h", { cron: "0 * * * *", tz: "UTC", kind: "operation", operation: "knowledge:memory", home }), (e) => e.code === "E_SCHEDULE_RUNNING");
  // No ambient root here: schedule scope resolution on a v2 deployment is (c3)'s (it still honours an ambient OATS_ROOT over --dir).
  const listed = oats(["schedule", "list", "--dir", ws, "--json"], { env: {} }).json().result.schedules.find((j) => j.id === "h");
  assert.equal(listed.operation, "knowledge:harvest");
});

test("an unconfirmed operation outcome carries what was observed in error.details, and a scheduled operation keeps its slot as unknown and reconciles by the answered name", () => {
  const { home } = provider("s3");
  const e = oats(["operation", "run", "knowledge:liarnamed", "--home", home, "--json"]).json().error;
  assert.equal(e.code, "E_OPERATION_RESULT"); assert.equal(e.details.unconfirmed, true); assert.equal(e.details.exit, 1); assert.equal(e.details.envelope.result.instance, "notes-harvester-9");
  const ws = dep;
  S.addSchedule(ws, { id: "u", cron: "0 * * * *", tz: "UTC", kind: "operation", operation: "knowledge:liarnamed", home });
  const io = { inspect: () => ({ present: true, state: "unknown" }) };
  const c = S.tickWorkspace(ws, { now: new Date("2026-09-08T12:00:00Z"), io, reg: { maxConcurrent: 8 }, only: "u" });
  assert.equal(c[0].action, "unknown", "not a confirmed failure"); assert.match(c[0].error, /unconfirmed/);
  const d = S.describe(ws, "u", io);
  assert.equal(d.running, true, "the slot is kept"); assert.ok(d.attempt); assert.equal(d.lastRun.instance, "notes-harvester-9", "the answered name is kept for reconcile");
  write(join(home, "..", "notes-harvester-9", "instance.json"), JSON.stringify({ instance: "notes-harvester-9", agent: "release-manager" }));
  const r = S.reconcile(ws, "u", { io });
  assert.equal(r.reconciled, "adopted"); assert.equal(r.schedule.lastRun.instance, "notes-harvester-9");
});

test("a provider whose manifest requires a command missing from PATH is reported unavailable by inspect and refused by operation run", () => {
  const { home, manifestPath } = provider("s4");
  const m = JSON.parse(readFileSync(manifestPath, "utf8")); m.requires = [{ command: "definitely-missing-tool-xyz", why: "digests need it", install: "brew install xyz" }]; writeFileSync(manifestPath, JSON.stringify(m));
  const ins = oats(["inspect", "--home", home, "--json"]).json().result;
  const okf = ins.capabilities.find((c) => c.id === "oats.okf");
  assert.deepEqual(okf.missingRequires, [{ command: "definitely-missing-tool-xyz", why: "digests need it", install: "brew install xyz" }]);
  const memory = okf.operations.find((o) => o.name === "memory");
  assert.equal(memory.available, false); assert.match(memory.reason, /requires "definitely-missing-tool-xyz" on PATH \(digests need it\)/);
  const e = oats(["operation", "run", "knowledge:memory", "--home", home, "--json"]).json().error;
  assert.equal(e.code, "E_CAPABILITY_REQUIRES"); assert.match(e.message, /install: brew install xyz/);
  assert.equal(existsSync(join(home, "notes-invocation.json")), false, "the provider was not run");
});

test("a provider's ordinary ok:false answer with a partial receipt keeps that receipt in error.details; a scheduled operation stays unknown and reconciles to the reported target", () => {
  const { home } = provider("s5");
  const e = oats(["operation", "run", "knowledge:retained", "--home", home, "--json"]).json().error;
  assert.equal(e.code, "E_SPAWN_FAILED"); assert.equal(e.details.unconfirmed, true); assert.equal(e.details.envelope.result.instance, "notes-harvester-3"); assert.equal(e.details.exit, 1);
  const ws = dep;
  S.addSchedule(ws, { id: "r", cron: "0 * * * *", tz: "UTC", kind: "operation", operation: "knowledge:retained", home });
  const io = { inspect: () => ({ present: true, state: "unknown" }) };
  const c = S.tickWorkspace(ws, { now: new Date("2026-09-08T14:00:00Z"), io, reg: { maxConcurrent: 8 }, only: "r" });
  assert.equal(c[0].action, "unknown");
  const d = S.describe(ws, "r", io); assert.equal(d.running, true); assert.equal(d.lastRun.instance, "notes-harvester-3");
  write(join(home, "..", "notes-harvester-3", "instance.json"), JSON.stringify({ instance: "notes-harvester-3", agent: "release-manager" }));
  const rec = S.reconcile(ws, "r", { io }); assert.equal(rec.reconciled, "adopted"); assert.equal(rec.schedule.lastRun.instance, "notes-harvester-3");
});

test("operation run relays a provider's view whole when it exceeds a pipe buffer (generic runner, any provider)", () => {
  const { home } = provider("bigview");
  const memory = "# remembered\n" + "one remembered line, long enough that the document outgrows a pipe buffer many times over\n".repeat(4000);
  assert.ok(Buffer.byteLength(memory) > 256 * 1024);
  write(join(home, "MEMORY.md"), memory);
  const r = oats(["operation", "run", "knowledge:memory", "--home", home, "--json"]);
  assert.equal(r.status, 0, r.stdout.slice(0, 300) + r.stderr);
  const out = JSON.parse(r.stdout.trim());
  assert.equal(out.ok, true, String(JSON.stringify(out.error ?? null)).slice(0, 300));
  assert.equal(out.result.result.documents[0].text, memory, "the whole document, byte-exact, through two pipes");
});

test("in-home capability dispatch: OATS_SOUL is the home's recorded soulDir, and an ambient OATS_SOUL never reaches the command when the home records none", () => {
  const { home, meta } = provider("dispatch");
  const dispatch = () => spawnSync(process.execPath, [CLI, "okf", "sweep"], { encoding: "utf8", cwd: home, env: { ...process.env, ...ambient, PI_AGENT_HOME: home, OATS_HOME: home } });
  let r = dispatch();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(readFileSync(join(home, "notes-invocation.json"), "utf8")).env.OATS_SOUL, meta.soulDir);
  const recorded = JSON.parse(readFileSync(join(home, "instance.json"), "utf8"));
  delete recorded.soulDir;
  writeFileSync(join(home, "instance.json"), JSON.stringify(recorded));
  r = dispatch();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(readFileSync(join(home, "notes-invocation.json"), "utf8")).env.OATS_SOUL, null, "no record → no OATS_SOUL (the ambient /elsewhere one is dropped)");
});
