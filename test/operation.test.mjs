import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-operation-")));
process.env.OATS_HOME_DIR = join(base, "oats-home");
for (const k of ["OATS_INSTANCE", "OATS_INSTANCE_HOME", "PI_AGENT_INSTANCE", "PI_AGENT_HOME", "PI_AGENTS_ROOT"]) delete process.env[k];
const S = await import("../lib/schedule.mjs");
test.after(() => rmSync(base, { recursive: true, force: true }));
function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }
function gitRepo(dir) {
  mkdirSync(dir, { recursive: true }); execFileSync("git", ["init", "-q", dir]);
  execFileSync("git", ["-C", dir, "config", "user.email", "t@example.invalid"]); execFileSync("git", ["-C", dir, "config", "user.name", "T"]);
  write(join(dir, ".gitignore"), "\n"); execFileSync("git", ["-C", dir, "add", "."]); execFileSync("git", ["-C", dir, "commit", "-qm", "init"]);
}
function oats(args, cwd = base) { const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: { ...process.env }, cwd }); const json = () => { try { return JSON.parse(r.stdout.trim()); } catch { throw new Error(`no JSON: ${r.stdout}\n${r.stderr}`); } }; return { ...r, json }; }

/** An alternative knowledge provider whose commands record how they were
 *  invoked (cwd, env, args) and answer real envelopes. Its digest "launches"
 *  a named harvester instance (a receipt), its inspect answers documents
 *  from MEMORY.md, and a third command answers a bad view shape. */
function scope(name) {
  const repo = join(base, name); gitRepo(repo);
  const notes = join(repo, ".agents", "capabilities", "owned", "notes");
  write(join(notes, "oats.json"), JSON.stringify({
    capability: "test.notes", version: "0.1.0", description: "Test knowledge provider", compatibility: { oats: ">=0.6.2" }, layer: "knowledge", command: "notes",
    commands: { digest: "bin/notes.mjs digest", inspect: "bin/notes.mjs inspect", badview: "bin/notes.mjs badview", fail: "bin/notes.mjs fail", sweep: "bin/notes.mjs sweep" },
    operations: {
      harvest: { kind: "action", command: "digest", context: "home", description: "Digest MEMORY.md", args: [{ name: "depth", required: true, description: "how deep" }, { name: "dry" }] },
      inspect: { kind: "view", command: "inspect", context: "home" },
      badview: { kind: "view", command: "badview", context: "home" },
      fail: { command: "fail", context: "home" },
      sweep: { command: "sweep", context: "scope" },
    },
    settings: { tone: { description: "digest tone" } },
  }, null, 2));
  write(join(notes, "bin", "notes.mjs"), `
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const [cmd, ...rest] = process.argv.slice(2);
const record = { cmd, rest, cwd: process.cwd(), env: { OATS_HOME: process.env.OATS_HOME || null, OATS_INSTANCE: process.env.OATS_INSTANCE || null, OATS_SETTINGS: process.env.OATS_SETTINGS || null, OATS_OPERATION: process.env.OATS_OPERATION || null, OATS_CAPABILITY: process.env.OATS_CAPABILITY || null, OATS_CLI_BIN: process.env.OATS_CLI_BIN || null } };
writeFileSync(join(process.cwd(), "notes-invocation.json"), JSON.stringify(record));
if (cmd === "digest") { console.error("digesting"); console.log(JSON.stringify({ schemaVersion: 1, ok: true, result: { digested: true, instance: "notes-harvester-1", home: join(process.cwd(), "..", "notes-harvester-1") } })); }
else if (cmd === "inspect") { const f = join(process.cwd(), "MEMORY.md"); console.log(JSON.stringify({ schemaVersion: 1, ok: true, result: { summary: "one file", documents: [{ label: "Memory", kind: "markdown", path: f, text: existsSync(f) ? readFileSync(f, "utf8") : null }] } })); }
else if (cmd === "badview") console.log(JSON.stringify({ schemaVersion: 1, ok: true, result: { documents: [{ kind: "markdown" }] } }));
else if (cmd === "fail") { console.log(JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_NOTES_EMPTY", message: "nothing to digest" } })); process.exit(1); }
else if (cmd === "sweep") console.log(JSON.stringify({ schemaVersion: 1, ok: true, result: { swept: process.cwd() } }));
`);
  write(join(repo, "oats-config.yaml"), "name: t\ncapabilities:\n  layers:\n    knowledge:\n      capability: test.notes\n      from: owned\n      global: true\n      settings:\n        tone: dry\n    messaging: none\n    tasks: none\n");
  write(join(repo, "agents", "dev", "soul", "soul.yaml"), "name: dev\nrepo: .\nwork: worktree\nruntime: claude\n");
  write(join(repo, "agents", "dev", "soul", "AGENTS.md"), "# dev\n");
  const home = join(repo, "agents", "dev", "instances", "dev-one");
  write(join(home, "instance.json"), JSON.stringify({ agent: "dev", instance: "dev-one", home, repo, work: "worktree", runtime: "claude", launched: true, layers: { knowledge: "test.notes [global @ " + repo + "]" }, capabilities: [{ id: "test.notes", level: repo, settings: { tone: "cold" } }] }));
  write(join(home, "MEMORY.md"), "# remembered\n");
  return { repo, home };
}

test("operation run resolves the home's provider from its snapshot, runs the provider command in the home with the snapshot settings, relays the envelope and surfaces a launch receipt", () => {
  const { repo, home } = scope("s1");
  let r = oats(["operation", "run", "knowledge:harvest", "--home", home, "--arg", "depth=2", "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const res = r.json().result;
  assert.equal(res.operation, "knowledge:harvest"); assert.equal(res.capability, "test.notes"); assert.deepEqual(res.argv, ["notes", "digest", "--depth", "2"]); assert.equal(res.cwd, home);
  assert.deepEqual(res.target, { home, instance: "dev-one" });
  assert.equal(res.instance, "notes-harvester-1", "the provider's launch receipt is surfaced"); assert.equal(res.home, join(home, "..", "notes-harvester-1"));
  assert.equal(res.result.digested, true); assert.equal(res.stderr, "digesting");
  const inv = JSON.parse(readFileSync(join(home, "notes-invocation.json"), "utf8"));
  assert.equal(inv.cmd, "digest"); assert.deepEqual(inv.rest, ["--depth", "2", "--json"]); assert.equal(inv.cwd, home);
  assert.equal(inv.env.OATS_HOME, home); assert.equal(inv.env.OATS_INSTANCE, "dev-one"); assert.equal(inv.env.OATS_OPERATION, "knowledge:harvest"); assert.equal(inv.env.OATS_CAPABILITY, "test.notes");
  assert.deepEqual(JSON.parse(inv.env.OATS_SETTINGS), { tone: "cold" }, "the snapshot's captured settings, not the current config's");
  assert.equal(inv.env.OATS_CLI_BIN, CLI);
  // A view operation answers validated documents.
  r = oats(["operation", "run", "knowledge:inspect", "--home", home, "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(r.json().result.result.documents, [{ label: "Memory", kind: "markdown", path: join(home, "MEMORY.md"), text: "# remembered\n" }]);
  // A view that answers the wrong shape, a failing command, missing/unknown args, an unknown operation, a home operation without a home.
  assert.equal(oats(["operation", "run", "knowledge:badview", "--home", home, "--json"]).json().error.code, "E_OPERATION_RESULT");
  const f = oats(["operation", "run", "knowledge:fail", "--home", home, "--json"]).json(); assert.equal(f.error.code, "E_NOTES_EMPTY"); assert.match(f.error.message, /nothing to digest/);
  assert.equal(oats(["operation", "run", "knowledge:harvest", "--home", home, "--json"]).json().error.code, "E_BAD_ARGS", "required arg missing");
  assert.equal(oats(["operation", "run", "knowledge:harvest", "--home", home, "--arg", "depth=1", "--arg", "nope=1", "--json"]).json().error.code, "E_BAD_ARGS");
  assert.equal(oats(["operation", "run", "knowledge:polish", "--home", home, "--json"]).json().error.code, "E_OPERATION_UNKNOWN");
  assert.equal(oats(["operation", "run", "knowledge:harvest", "--soul", "dev", "--dir", repo, "--arg", "depth=1", "--json"]).json().error.code, "E_OPERATION_UNAVAILABLE");
  assert.equal(oats(["operation", "run", "messaging:anything", "--home", home, "--json"]).json().error.code, "E_OPERATION_UNAVAILABLE", "disabled layer");
  assert.equal(oats(["operation", "run", "bogus:x", "--home", home, "--json"]).json().error.code, "E_BAD_ARGS");
  assert.equal(oats(["operation", "run", "knowledge:harvest", "--home", home, "--dir", join(base, "elsewhere"), "--json"]).json().error.code, "E_HOME_MISMATCH", "--dir must be the home's own context");
  // Scope-context operation for a soul: runs in the scope with the config's settings.
  r = oats(["operation", "run", "knowledge:sweep", "--soul", "dev", "--dir", repo, "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.equal(r.json().result.cwd, repo); assert.equal(r.json().result.target, null);
  const inv2 = JSON.parse(readFileSync(join(repo, "notes-invocation.json"), "utf8"));
  assert.deepEqual(JSON.parse(inv2.env.OATS_SETTINGS), { tone: "dry" }); assert.equal(inv2.env.OATS_HOME, null, "no instance env outside a home");
  assert.equal(oats(["operation", "run", "knowledge:sweep", "--soul", "ghost", "--dir", repo, "--json"]).json().error.code, "E_SOUL_UNKNOWN");
});

test("a schedule of kind operation resolves the provider when it runs and tracks the provider's launch receipt like a command job", () => {
  const { repo, home } = scope("s2");
  const ws = repo;
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
  const manifestPath = join(repo, ".agents", "capabilities", "owned", "notes", "oats.json");
  const m = JSON.parse(readFileSync(manifestPath, "utf8")); m.operations.harvest.args = []; writeFileSync(manifestPath, JSON.stringify(m));
  mkdirSync(join(home, "..", "notes-harvester-1"), { recursive: true }); write(join(home, "..", "notes-harvester-1", "instance.json"), JSON.stringify({ instance: "notes-harvester-1", agent: "dev" }));
  c = S.tickWorkspace(ws, { now: new Date("2026-09-08T11:00:00Z"), io: { inspect: () => ({ present: true, state: "unknown" }) }, reg: { maxConcurrent: 1 } });
  assert.equal(c[0].action, "launched"); assert.equal(c[0].instance, "notes-harvester-1");
  const d = S.describe(ws, "h", { inspect: () => ({ present: true, state: "unknown" }) });
  assert.equal(d.running, true); assert.equal(d.lastRun.home, join(home, "..", "notes-harvester-1")); assert.notEqual(d.lastRun.home, home);
  // The operation address is part of the guarded identity while the job runs.
  assert.throws(() => S.updateSchedule(ws, "h", { cron: "0 * * * *", tz: "UTC", kind: "operation", operation: "knowledge:inspect", home }), (e) => e.code === "E_SCHEDULE_RUNNING");
  const listed = oats(["schedule", "list", "--dir", ws, "--json"]).json().result.schedules.find((j) => j.id === "h");
  assert.equal(listed.operation, "knowledge:harvest");
});
